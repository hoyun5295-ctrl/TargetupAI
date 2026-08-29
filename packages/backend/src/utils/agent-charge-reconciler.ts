/**
 * agent-charge-reconciler.ts — 에이전트 충전 주문 대사 워커 (★2026-08-29 신설 · Codex 2R high 수용)
 *
 * **왜 필요한가.** `agent_charge_orders`의 `processing → fulfilled` 전이가 관리자 화면의 상태 폴링
 * 부수효과로만 일어났다. 그 폴링은 **그 화면에서 새 충전을 제출했을 때만** 시작되므로, 문자 링크로
 * 승인된 건은 실제로 반영이 끝나도 영영 processing에 남는다. processing 잔존은 표시만의 문제가 아니다:
 *   - 접수함(pending 목록)에서 사라져 아무도 그 건을 다시 보지 못한다
 *   - 고객사 중복 접수 검사는 `status='pending'`만 보므로 **같은 금액의 새 요청이 통과**한다
 *
 * 그래서 상태 수렴 책임을 화면에서 서버로 옮긴다. 브라우저가 한 번도 안 열려도 수렴한다.
 *
 * 하는 일 = `charge_request_id`가 붙은 `processing` 주문을 찾아, 그 실행 원장의 SeqNo로 게이트웨이
 * 반영(RsApplyFlag='Y')을 조회하고 **전건 반영일 때만** `fulfilled`로 넘긴다(6원칙 ② 효과 검증).
 *
 * ⛔ 여기서 잔액을 만들지 않는다. 게이트웨이 원장이 진실이고 이 워커는 **읽고 표시 상태만 맞춘다**.
 * ⛔ 전건 반영이 아니면 그대로 둔다 — 부분 반영을 완료로 적으면 시스템이 거짓말한다.
 * ⛔ `uncertain`·`not_applied` 요청에 걸린 주문은 건드리지 않는다(해소는 사람의 판단 · resolve 라우트 소유).
 */
import { query } from '../config/database';
import { getAgentChargeStatus, isPayStatsConfigured } from './pay-stats';

const LOG = '[agent-charge-reconciler]';
/** 5분 주기 — 게이트웨이 반영은 즉시가 아니고, 이 축은 표시 수렴이라 촘촘할 이유가 없다 */
const TICK_MS = 5 * 60 * 1000;
/** 한 틱에 볼 요청 수 상한(운영 규모상 넉넉하다) */
const MAX_PER_TICK = 20;

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function reconcileAgentChargeOrdersOnce(): Promise<{ checked: number; fulfilled: number }> {
  if (!isPayStatsConfigured()) return { checked: 0, fulfilled: 0 };

  // 대상 = processing 주문이 걸려 있고, 실행 원장이 registered(= 게이트웨이 등록 확정)인 요청.
  //   reserved(확정 기록 유실)·uncertain·not_applied는 제외 — 사람이 해소할 축이다.
  // ★2026-08-29 Codex 3R high — SeqNo가 없는 registered(해소 confirmed 경유 등)는 **영원히 판정 불가**라
  //   oldest-first 상위를 점유하면 그 뒤 요청이 한 번도 검사되지 않는다(기아). SQL에서 제외한다.
  //   표현식은 기존 전역 게이트(charges->0->>'seqNo')와 같은 한 벌이다.
  const targets = await query(
    `SELECT r.id, r.charges
       FROM agent_charge_requests r
      WHERE r.status = 'registered'
        AND (r.charges->0->>'seqNo') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM agent_charge_orders o
           WHERE o.charge_request_id = r.id AND o.status = 'processing'
        )
      ORDER BY r.created_at ASC
      LIMIT $1`,
    [MAX_PER_TICK],
  );

  let fulfilled = 0;
  for (const row of targets.rows) {
    const charges = Array.isArray(row.charges) ? row.charges : [];
    const seqNos = charges.map((c: any) => Number(c?.seqNo)).filter((n: number) => Number.isInteger(n) && n > 0);
    if (seqNos.length === 0 || seqNos.length !== charges.length) continue; // SeqNo 미확정 = 판정 불가

    let applied: Array<{ seqNo: number; applied?: boolean }>;
    try {
      applied = await getAgentChargeStatus(seqNos);
    } catch (err: any) {
      console.error(`${LOG} 게이트웨이 조회 실패(다음 틱 재시도):`, err?.message || err);
      continue;
    }
    // 전건 반영일 때만 완료 — 하나라도 미반영이면 다음 틱에 다시 본다
    if (applied.length !== seqNos.length || !applied.every((a) => !!a.applied)) continue;

    try {
      const done = await query(
        `UPDATE agent_charge_orders SET status = 'fulfilled', resolved_at = NOW()
          WHERE charge_request_id = $1::uuid AND status = 'processing'`,
        [row.id],
      );
      const n = done.rowCount ?? 0;
      if (n > 0) {
        fulfilled += n;
        console.log(`${LOG} 충전 요청 ${n}건 완료 처리 (req ${row.id})`);
      }
    } catch (err: any) {
      console.error(`${LOG} 완료 처리 실패(다음 틱 재시도):`, err?.message || err);
    }
  }
  return { checked: targets.rows.length, fulfilled };
}

async function tick(): Promise<void> {
  if (running) return; // 겹침 방지 — 느린 틱이 다음 틱과 포개지지 않게
  running = true;
  try {
    await reconcileAgentChargeOrdersOnce();
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('relation') && msg.includes('does not exist')) return; // 테이블 생성 전 = 조용히
    console.error(`${LOG} tick 실패:`, msg || err);
  } finally {
    running = false;
  }
}

export function startAgentChargeReconciler(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  console.log(`${LOG} 기동 (${TICK_MS / 60000}분 주기)`);
}
