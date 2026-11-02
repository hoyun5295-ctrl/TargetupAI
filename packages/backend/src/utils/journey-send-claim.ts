/**
 * CT: 여정 발송 '적재 중' 표식 판정 — ★ 2026-09-26 한줄로 V2 m105 (Codex 1R ④ · 2R ③④⑤ · 3R ②③④⑤ · 4R ①②)
 *
 * 여정 실행기는 [차감 → step_log 'sending'(적재 중 표식) → 큐 적재 → 'sent' 확정] 순서로 보낸다.
 * 적재 결과가 불확정(응답 유실 · 중단 · 확정 실패)이면 표식은 'sending'으로 남고, 그 시도가 큐에 들어갔는지는 여기서 판정한다.
 * 판정 규칙이 두 곳(다음 실행의 가드 · 재시도 소진 분기)에서 갈리지 않게 이 한 곳에 둔다.
 *
 * ★ 4R 구조 정정 — **추정하지 않고 증명될 때만 판정한다.**
 *   MySQL 행에는 시도 식별자가 없다(app_etc1 = 하루 단계 캠페인을 여러 실행이 공유 · 29컬럼에 남는 칸 없음: bill_id = 사용자·발신자 ·
 *   sender_code = 중계 에이전트 사용). 2R(표식 시각 창)·3R(장부 건수 + 지금 번호)의 추정은 조회 대기 · 번호 변경 · 라이브·이력 이동 중복에서 샜다.
 *   그래서 부풀 수만 있는 상한과 모자랄 수만 있는 하한으로 **증명되는 쪽만** 판정하고, 증명되지 않으면 보류한다.
 *   보류가 1시간을 넘으면 다시 보내지 않고 닫는다(★ 0926 Harold 결정 — 두 번 보내는 일은 없게 · 그 1건 요금은 정산이 미적재로 돌려준다).
 *
 * 확정은 표식 'sent'와 단계 캠페인 발송 수 +n을 **한 문장**으로 한다(★1102 confirmLoadUnit). 발송 수는 정산 스위퍼가 여정의 적재 수로 읽는다 —
 * 확정만 되고 발송 수가 빠지면 보낸 몫을 미적재로 환불하고, 발송 수만 오르면 적재 실패분을 환불하지 않는다.
 * ★ 2026-11-02 묶음 발송 — 판정 단위 = 적재 단위(INSERT 한 문장 · judgeLoadUnit · 아래 3-8 절). 옛 한 건 판정(resolveJourneyClaim)은 없앴다(판정 한 벌).
 */
import { query } from '../config/database';
import { getCampaignSmsTablesWide, smsCountAll, smsCampaignCountsSafe, smsMsgTypeScopeSql, isMysqlThreadAlive } from './sms-queue';
import { LOAD_PROTOCOL_UNIT } from './journey-step-campaign';
/** 증명을 기다리는 상한 — 넘으면 다시 보내지 않고 닫는다(★ 0926 Harold 결정) */
export const CLAIM_PROOF_LIMIT_SEC = 60 * 60;

export interface JourneyClaimOwner {
  company_id: string;
  created_by?: string | null;
  customer_id: string;
}

export type ClaimLoadVerdict = 'loaded' | 'not_loaded' | 'unprovable';

/**
 * 표식이 가리키는 시도가 큐에 들어갔는가 — 하루 단계 캠페인 전체 장부로 **증명되는 쪽만** 답한다.
 *   확정('sent') 발송 하나는 원 행 하나를 가진다(적재 성공 뒤에만 확정). 미확정('sending') 표식에는 이 표식 자신이 들어 있다.
 *   증명 못 해 닫은 표식('failed' · load_unprovable)은 원 행을 가졌을 수도 없을 수도 있다(★ 5R ②).
 *   · 상한(원 행을 라이브 + 이력 그대로 합산 · 옮기는 순간 중복은 있어도 누락은 없다) − 확정 ≤ 0
 *       → 미확정·닫힌 표식 어느 것도 안 들어갔다 = **not_loaded**(다시 보내도 두 번이 아니다)
 *   · 하한(원 행만 안전 집계 한 번 · 이력 먼저 라이브 나중 · 중복 없음 · 통신사 결과를 기다리는 행은 빠질 수 있다)
 *       − 확정 − 닫힌 표식 ≥ 미확정 표식 수 → 닫힌 표식이 전부 원 행을 가졌다 쳐도 미확정 표식 전부 들어갔다 = **loaded**
 *       (★ 5R ③ 전체 − 대체 행을 두 번 조회해 빼면 사이에 옮겨진 행 때문에 하한이 부푼다 → 원 행 범위 한 번으로 센다)
 *   · 그 밖 = **unprovable**(보류) — 번호·시각으로 가리지 않는다.
 * 테이블 = 그 캠페인의 발송 기록 테이블 ∪ 회사 전 라인, 각각 캠페인 날짜 기준월 전후 이력(getCampaignSmsTablesWide).
 * PG 장부를 MySQL보다 **먼저** 읽는다 — 사이에 끼어든 적재·확정은 상한·하한을 모두 키우는 쪽이라 "안 들어갔다"를 거짓으로 만들지 못한다.
 * 캠페인 id가 없으면 적재 전에 멈춘 것이다(not_loaded). 캠페인 행·테이블이 없거나 조회가 실패하면 던진다.
 */
export async function attributeClaimLoad(owner: JourneyClaimOwner, campaignId: string | null): Promise<ClaimLoadVerdict> {
  if (!campaignId) return 'not_loaded';
  const camp = await query(
    `SELECT created_by, send_config, sent_at, scheduled_at, created_at FROM campaigns WHERE id = $1::uuid`,
    [campaignId],
  );
  if (!camp.rows[0]) throw new Error('단계 캠페인을 찾지 못해 적재 여부를 확인할 수 없다');
  const tables = await getCampaignSmsTablesWide(owner.company_id, camp.rows[0]);
  if (tables.length === 0) throw new Error('발송 테이블을 찾지 못해 적재 여부를 확인할 수 없다');

  const ledger = await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'sent')::int AS confirmed,
            COUNT(*) FILTER (WHERE status = 'sending')::int AS unresolved,
            COUNT(*) FILTER (WHERE status = 'failed' AND error_reason = 'load_unprovable')::int AS closed
       FROM journey_step_logs WHERE campaign_id = $1::uuid`,
    [campaignId],
  );
  const confirmed = Number(ledger.rows[0]?.confirmed || 0);
  const unresolved = Math.max(1, Number(ledger.rows[0]?.unresolved || 0));   // 이 표식 자신은 늘 미확정이다
  const closed = Number(ledger.rows[0]?.closed || 0);

  const upper = await smsCountAll(tables, `app_etc1 = ? AND ${smsMsgTypeScopeSql('primary')}`, [campaignId]);
  if (upper - confirmed <= 0) return 'not_loaded';

  const safe = (await smsCampaignCountsSafe(tables, [campaignId], 'app_etc1', 'primary')).get(campaignId);
  const lower = Number(safe?.total || 0);
  if (lower - confirmed - closed >= unresolved) return 'loaded';
  return 'unprovable';
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-11-02 적재 단위(설계서 docs/2026-11-02-journey-batch-send-design.md 3-8 적재 증명 계약 · Codex 설계 7R approve)
//   단위 = MySQL INSERT 한 문장 · 한 캠페인에 미확정 단위 1 이하(I2) · 단위 기록(연결 번호)을 적재 앞에 PG 에(I4)
//   · 판정 = 기록 없음이면 안 들어감(새 규약 캠페인만 · I5) / 그 연결이 처리 목록에 없을 때만 장부 상한 · 하한(I4)
//   / 1시간 증명 못 함 = 다시 안 보내고 닫음(★ 0926 Harold) + 봉인(I3) · 옛 표식(새 규약 표식 없는 캠페인) = 다시 보내는 갈래 없음(I5).
// ════════════════════════════════════════════════════════════════════

export interface LoadUnitRecord { threadId: number; table: string; count: number }

/** 단위 기록 = 적재 문장을 보내기 **전에** 쓴다(실패 = 던짐 → 적재 CT 가 문장을 보내지 않는다 · rejected). */
export async function recordLoadUnit(campaignId: string, u: LoadUnitRecord): Promise<void> {
  const r = await query(
    `UPDATE campaigns SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{loadUnit}',
              jsonb_build_object('threadId', $2::bigint, 'table', $3::text, 'count', $4::int, 'at', NOW()))
      WHERE id = $1::uuid RETURNING id`,
    [campaignId, u.threadId, u.table, u.count],
  );
  if (r.rows.length === 0) throw new Error('단계 캠페인을 찾지 못해 적재 여부를 확인할 수 없다');
}

/** 안 들어감이 증명된 단위 = 표식 지움 + 단위 기록 지움(한 문장 · 다시 보내도 두 번이 아니다) */
export async function clearLoadUnit(campaignId: string, claimIds: string[]): Promise<number> {
  const r = await query(
    `WITH gone AS (DELETE FROM journey_step_logs WHERE id = ANY($2::uuid[]) AND status = 'sending' RETURNING id)
     UPDATE campaigns SET send_config = COALESCE(send_config, '{}'::jsonb) - 'loadUnit'
      WHERE id = $1::uuid
      RETURNING (SELECT COUNT(*) FROM gone)::int AS n`,
    [campaignId, claimIds],
  );
  return Number(r.rows[0]?.n || 0);
}

/**
 * 들어간 단위 확정 = 한 문장(표식 'sent' + 단계 캠페인 발송 수 + n + 단위 기록 지움 + 변이 보상 변이별 합 · 설계서 ⑤-3 · SC-6).
 *   withStats = 전진 없이 확정하는 자리(활성 아닌 실행의 표식 정리)는 실행 · 여정 비용 통계도 같은 문장에서.
 *   돌려주는 것 = 이번 문장이 확정한 표식(다른 쪽이 먼저 확정한 표식은 빠진다 = 비용 이중 0).
 */
export async function confirmLoadUnit(
  campaignId: string, claimIds: string[],
  opts: { variantCounts?: Array<{ variantId: string; sent: number }>; withStats?: boolean } = {},
): Promise<Array<{ id: string; executionId: string; cost: number }>> {
  const vIds = (opts.variantCounts || []).filter((v) => v.sent > 0).map((v) => v.variantId);
  const vNs = (opts.variantCounts || []).filter((v) => v.sent > 0).map((v) => v.sent);
  const r = await query(
    `WITH confirmed AS (
       UPDATE journey_step_logs SET status = 'sent'
        WHERE id = ANY($2::uuid[]) AND status = 'sending' AND campaign_id = $1::uuid
        RETURNING id, execution_id, COALESCE(cost, 0) AS cost
     ), camp AS (
       UPDATE campaigns SET target_count = target_count + (SELECT COUNT(*) FROM confirmed),
                            sent_count = sent_count + (SELECT COUNT(*) FROM confirmed),
                            send_config = COALESCE(send_config, '{}'::jsonb) - 'loadUnit',
                            updated_at = NOW()
        WHERE id = $1::uuid RETURNING id
     ), var AS (
       UPDATE journey_step_variants v SET sent_count = v.sent_count + x.n, updated_at = NOW()
         FROM unnest($3::uuid[], $4::int[]) AS x(id, n)
        WHERE v.id = x.id AND (SELECT COUNT(*) FROM confirmed) > 0
        RETURNING v.id
     ), ex AS (
       UPDATE journey_executions e SET total_cost = e.total_cost + c.cost
         FROM confirmed c WHERE $5::boolean AND e.id = c.execution_id
        RETURNING e.journey_id, c.cost
     ), jr AS (
       UPDATE journeys j SET stats_total_cost = j.stats_total_cost + s.cost, updated_at = NOW()
         FROM (SELECT journey_id, SUM(cost) AS cost FROM ex GROUP BY journey_id) s
        WHERE $5::boolean AND j.id = s.journey_id
        RETURNING j.id
     )
     SELECT id, execution_id, cost FROM confirmed`,
    [campaignId, claimIds, vIds, vNs, opts.withStats === true],
  );
  return r.rows.map((x: any) => ({ id: String(x.id), executionId: String(x.execution_id), cost: Number(x.cost) || 0 }));
}

export interface PendingClaim { id: string; executionId: string; cost: number; sentAt: Date }
export type UnitJudgment =
  | { result: 'none' }
  | { result: 'sent'; claims: PendingClaim[]; confirmed: Array<{ id: string; executionId: string; cost: number }>; sentAt: Date }
  | { result: 'cleared'; claims: PendingClaim[] }
  | { result: 'held'; claims: PendingClaim[] }
  | { result: 'closed'; claims: PendingClaim[] };

/**
 * 한 단계 캠페인의 미확정 단위 판정(설계서 ⑤-5 · 3-8 · 부르는 곳 = 실행기 묶음 가드 · 활성 아닌 표식 정리 둘).
 *   새 규약(loadProtocol = unit): 단위 기록 없음 = 안 들어감 → 지움 · 기록 있음 = 그 연결이 처리 목록에 없을 때만 장부 판정
 *     (살아 있음 · 조회 실패 = 보류 · 1시간 넘음 = 닫음 + 봉인).
 *   옛 표식(표식 없는 캠페인): 들어감 증명 = 확정 · 그 밖 = 다시 보내지 않고 1시간 뒤 닫음(옛 INSERT 종료를 증명할 수 없다 · Codex 설계 4R).
 *   판정 = 그 캠페인의 'sending' 표식 전부 = 한 단위(I2 · 봉인 I3 = 한 캠페인에 증명 못 한 단위 0).
 */
export async function judgeLoadUnit(
  owner: JourneyClaimOwner, campaignId: string,
  opts: { beforeConfirm?: (sentAt: Date) => Promise<void>; withStats?: boolean } = {},
): Promise<UnitJudgment> {
  const camp = await query(
    `SELECT send_config->>'loadProtocol' AS protocol, send_config->'loadUnit' AS unit FROM campaigns WHERE id = $1::uuid`,
    [campaignId],
  );
  if (!camp.rows[0]) throw new Error('단계 캠페인을 찾지 못해 적재 여부를 확인할 수 없다');
  const unitProtocol = camp.rows[0].protocol === LOAD_PROTOCOL_UNIT;
  const unit = camp.rows[0].unit && typeof camp.rows[0].unit === 'object' ? camp.rows[0].unit : null;
  const cl = await query(
    `SELECT id, execution_id, COALESCE(cost, 0) AS cost, sent_at, EXTRACT(EPOCH FROM (NOW() - sent_at)) AS age_sec
       FROM journey_step_logs WHERE campaign_id = $1::uuid AND status = 'sending' ORDER BY sent_at ASC`,
    [campaignId],
  );
  const claims: PendingClaim[] = cl.rows.map((x: any) => ({ id: String(x.id), executionId: String(x.execution_id), cost: Number(x.cost) || 0, sentAt: new Date(x.sent_at) }));
  if (claims.length === 0) {
    if (unit) await query(`UPDATE campaigns SET send_config = COALESCE(send_config, '{}'::jsonb) - 'loadUnit' WHERE id = $1::uuid`, [campaignId]);
    return { result: 'none' };
  }
  const ids = claims.map((c) => c.id);
  const oldestAgeSec = Math.max(...cl.rows.map((x: any) => Number(x.age_sec) || 0));
  // 닫음 + 단위 기록 지움 + 봉인 = 한 문장(I3 · 사이에 끊겨 봉인 안 된 캠페인에 새 단위가 들어가는 길 0 · Codex 구현 1R)
  const close = async (): Promise<UnitJudgment> => {
    await query(
      `WITH closed AS (
         UPDATE journey_step_logs SET status = 'failed', error_reason = 'load_unprovable', cost = 0
          WHERE id = ANY($2::uuid[]) AND status = 'sending' RETURNING id
       )
       UPDATE campaigns SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb) - 'loadUnit', '{loadSealed}', 'true'::jsonb), updated_at = NOW()
        WHERE id = $1::uuid`,
      [campaignId, ids],
    );
    return { result: 'closed', claims };
  };
  const overLimit = oldestAgeSec >= CLAIM_PROOF_LIMIT_SEC;

  if (unitProtocol && !unit) {
    await clearLoadUnit(campaignId, ids);
    return { result: 'cleared', claims };
  }
  if (unitProtocol && unit) {
    let alive = true;
    try {
      alive = await isMysqlThreadAlive(Number(unit.threadId));
    } catch (e: any) {
      console.error(`[journey-send-claim] 처리 목록 조회 실패 campaign=${campaignId} — 보류:`, e?.message || e);
    }
    if (alive) return overLimit ? await close() : { result: 'held', claims };
  }

  let verdict: ClaimLoadVerdict;
  try {
    verdict = await attributeClaimLoad(owner, campaignId);
  } catch (e: any) {
    console.error(`[journey-send-claim] 단위 판정 조회 실패 campaign=${campaignId} — 증명 안 됨으로 다룬다:`, e?.message || e);
    verdict = 'unprovable';
  }
  if (verdict === 'loaded') {
    const sentAt = claims[0].sentAt;
    if (opts.beforeConfirm) await opts.beforeConfirm(sentAt);
    const confirmed = await confirmLoadUnit(campaignId, ids, { withStats: opts.withStats });
    return { result: 'sent', claims, confirmed, sentAt };
  }
  if (verdict === 'not_loaded' && unitProtocol) {
    await clearLoadUnit(campaignId, ids);
    return { result: 'cleared', claims };
  }
  // 옛 표식의 안 들어감 · 증명 안 됨 = 다시 보내지 않는다(1시간까지 보류 · 넘으면 닫음)
  return overLimit ? await close() : { result: 'held', claims };
}
