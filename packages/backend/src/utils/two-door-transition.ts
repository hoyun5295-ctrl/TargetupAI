/**
 * two-door-transition.ts — 두 문 전환 패스(★ 2026-11-04 C99 · 설계서 docs/2026-11-03-two-door-purchase-design.md §4 T1 · Codex 설계 4R #1 · 5R #2)
 *
 * 왜 있나
 *   회사 갈래(두 문 = 요약 칸 진실이 두 문 사실)는 회사 전체가 한 번에 바뀌는데, CT-D3 는 그 순간 들어온 고객만 센다.
 *   쓰기가 없는 고객(구매 0건 포함)은 옛 정의 값(원본 위 증분 · 원장만 재계산)으로 남는다. 이 패스가 그 고객들을 CT-D3 로 한 번씩 센다.
 *
 * 규칙
 *   - 5분마다 · 두 문 회사(two_door_since 있음 또는 몰 매출 표식 + 원장 행)마다 d2 표식 없는 고객을 id 순 커서로 한 묶음(500명).
 *     회사마다 한 회차에 한 묶음(회사 사이 공정성 · 한 회사가 회차를 다 쓰지 않는다).
 *   - 묶음 = 회사 잠금 → 갈래 다시 판정 → CT-D3(고객 잠금 · 번호 · id 순). 묶음이 실패하면 그 묶음을 한 명씩(실패 고객만 남고 커서는 지나간다 · 진행 보장).
 *   - 커서가 그 회사 끝에 닿았는데 d2 없는 고객이 남아 있으면 다음 회차에 처음부터 다시(일시 실패 고객 재방문 · d2 거름이라 끝난 고객은 다시 안 셈).
 *     커서 = 프로세스 메모리(재시작 = 처음부터 · 옳음은 d2 표식이 지킨다).
 *   - 남은 수 · 실패 수 = 로그 · 처음 남은 것을 본 뒤 24시간이 넘도록 남으면 운영 경보 한 번(회사마다).
 *   - 완료 = 그 회사 d2 없는 고객 0(확인 SQL = 설계서 §9).
 */
import { query, withTransaction } from '../config/database';
import { lockCompanyPurchaseSummary, resolvePurchaseSummaryBranch } from './two-door-purchase';
import { recomputeCustomerPurchaseSummary } from './customer-purchase-aggregates';
import { sendSystemAlert } from './system-alert';
import { netPurchaseSql } from './cdp-order-revenue';

const BATCH = 500;
const INTERVAL_MS = 5 * 60 * 1000;
const STUCK_ALERT_MS = 24 * 3600 * 1000;
const ZERO_ID = '00000000-0000-0000-0000-000000000000';

const cursorByCompany = new Map<string, string>();
const remainingSince = new Map<string, number>();
let running = false;

/** 시험 전용 — 프로세스 메모리 커서 · 경보 시각 비우기. */
export function resetTwoDoorTransitionState(): void {
  cursorByCompany.clear();
  remainingSince.clear();
}

const NO_D2 = `NOT (COALESCE(c.summary_source, '{}'::jsonb) ? 'd2')`;

async function recomputeOne(companyId: string, ids: string[]): Promise<void> {
  await withTransaction(async (run) => {
    await lockCompanyPurchaseSummary(run, companyId);
    if ((await resolvePurchaseSummaryBranch(run, companyId)) !== 'two_door') return;
    await recomputeCustomerPurchaseSummary(run, companyId, ids);
  });
}

/** 한 회사 한 묶음. 반환 = { done(이번 묶음에서 센 고객) · failed · remaining(d2 없는 고객 · 묶음 뒤) } */
async function passCompany(companyId: string): Promise<{ done: number; failed: number; remaining: number }> {
  const after = cursorByCompany.get(companyId) ?? ZERO_ID;
  const batch = await query(
    `SELECT c.id FROM customers c WHERE c.company_id = $1::uuid AND c.id > $2::uuid AND ${NO_D2} ORDER BY c.id LIMIT $3::int`,
    [companyId, after, BATCH],
  );
  const ids: string[] = batch.rows.map((x: any) => String(x.id));
  let done = 0;
  let failed = 0;
  if (ids.length > 0) {
    try {
      await recomputeOne(companyId, ids);
      done = ids.length;
    } catch (err: any) {
      console.warn(`[TwoDoorPass] 묶음 실패 → 한 명씩 company=${companyId}: ${err?.code || ''} ${err?.message || err}`);
      for (const id of ids) {
        try { await recomputeOne(companyId, [id]); done++; } catch { failed++; }
      }
    }
    cursorByCompany.set(companyId, ids[ids.length - 1]);
  }
  // 처음부터 훑어 빈 묶음 = 남은 고객 0(셈 없음 · 전환이 끝난 회사가 5분마다 고객 전체를 세지 않게) · 그 밖 = 셈(로그 · 경보)
  const remaining = ids.length === 0 && after === ZERO_ID
    ? 0
    : Number((await query(`SELECT COUNT(*)::int AS n FROM customers c WHERE c.company_id = $1::uuid AND ${NO_D2}`, [companyId])).rows[0]?.n || 0);
  // 커서가 끝에 닿았다(이번 묶음이 비거나 덜 찼다) = 남은 고객이 있으면 다음 회차는 처음부터 · 없으면 끝
  if (ids.length < BATCH) cursorByCompany.delete(companyId);
  return { done, failed, remaining };
}

export async function runTwoDoorTransitionPass(): Promise<{ companies: number; done: number; failed: number; remaining: number }> {
  const out = { companies: 0, done: 0, failed: 0, remaining: 0 };
  if (running) return out;
  running = true;
  try {
    let cos;
    try {
      cos = await query(
        `SELECT c.id FROM companies c
          WHERE c.two_door_since IS NOT NULL
             OR (EXISTS (SELECT 1 FROM cdp_events e WHERE e.company_id = c.id AND ${netPurchaseSql('e')})   -- 회사 갈래(resolvePurchaseSummaryBranch)와 같은 판정
                 AND EXISTS (SELECT 1 FROM purchases p WHERE p.company_id = c.id))
          ORDER BY c.id`,
      );
    } catch (err: any) {
      // 칸 없음(C99-DDL-2 전) = 이 회차 쉰다(배포 앞 DDL 이라 정상 운영에서는 오지 않는다 · 꺼짐도 기록)
      if (err?.code === '42703') { console.warn('[TwoDoorPass] companies.two_door_since 칸 없음 — C99-DDL-2 필요 · 이번 회차 쉼'); return out; }
      throw err;
    }
    for (const row of cos.rows as any[]) {
      const companyId = String(row.id);
      out.companies++;
      try {
        const r = await passCompany(companyId);
        out.done += r.done;
        out.failed += r.failed;
        out.remaining += r.remaining;
        if (r.done > 0 || r.failed > 0) console.log(`[TwoDoorPass] company=${companyId} 셈 ${r.done} · 실패 ${r.failed} · 남은 ${r.remaining}`);
        if (r.remaining === 0) { remainingSince.delete(companyId); continue; }
        const since = remainingSince.get(companyId) ?? Date.now();
        remainingSince.set(companyId, since);
        if (Date.now() - since >= STUCK_ALERT_MS) {
          void sendSystemAlert({
            companyId, dedupKey: `two-door-transition-stuck:${companyId}`, cooldownMs: 7 * 24 * 3600 * 1000,
            message: `두 문(자사몰 + 매장) 회사의 고객 구매 요약 전환이 24시간 넘게 끝나지 않았습니다. 남은 고객 ${r.remaining}명 · 마지막 회차 실패 ${r.failed}명.`,
          }).catch(() => undefined);
        }
      } catch (err: any) {
        console.warn(`[TwoDoorPass] company=${companyId} 실패(다음 회차 재시도): ${err?.code || ''} ${err?.message || err}`);
      }
    }
  } finally {
    running = false;
  }
  return out;
}

export function startTwoDoorTransitionWorker(): void {
  setInterval(() => {
    runTwoDoorTransitionPass().catch((err) => console.error('[TwoDoorPass] 예외:', err?.message || err));
  }, INTERVAL_MS);
  console.log('[TwoDoorPass] 두 문 전환 패스 시작 (5분 주기)');
}
