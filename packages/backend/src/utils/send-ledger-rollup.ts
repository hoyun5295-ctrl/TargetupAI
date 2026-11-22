/**
 * send-ledger-rollup.ts — 발송 원장 굴리기(★ 2026-11-22 C154 · 설계서 docs/2026-11-22-c154-send-ledger-rollup-design.md)
 *
 * 왜 있나
 *   발송 결과의 낱행(받는 번호 · 캠페인 · 결과 코드 · 통신사)은 MySQL 큐 · 월별 이력 표에만 있고 PG 에는 캠페인 합계만 올라온다.
 *   통신사 · 받은 고객 축으로 자르려면 결과가 확정된 캠페인의 낱행을 한 번 읽어 PG 에 굴려 둬야 한다.
 *   산출 = ① 캠페인 × 통신사 성공 · 실패(통신사별 발송 성공률) ② 캠페인 × 고객 칸 성과(받은 고객 · 산 고객 · 매출 · 비용).
 *
 * ⛔ 영구 원칙
 *   - 읽기만 한다 — 발송 길 · 결과 동기화 · 환불은 건드리지 않는다. 큐 표 SQL 은 CT-04(sms-queue) 함수로만.
 *   - MySQL 읽기는 굴리기 단계(V3_STAGE_ROLLUP)가 열린 회사만. 닫기 · 굳히기 · 정리는 PG 만 쓰므로 단계와 무관하게 돈다.
 *   - 한 구매는 한 발송에만: 발송 순서 = (sent_at, campaign_id) · 한 고객의 하루 구매는 주인 장부가 한 캠페인에만 준다.
 *   - 묶음(칸)은 발송 시점의 것(굴린 시점의 것이 아니다).
 */
import { SUCCESS_CODES, PENDING_CODES, CARRIER_NETS, carrierKey, carrierNet, carrierNetSql, type CarrierKey, type CarrierNet } from './sms-result-map';
import { query, withTransaction } from '../config/database';
import { resolveChargeUnitPrice } from './unit-price';
import { purchaseFactsSql, companyLedgerExistsSql } from './two-door-purchase';
import { netPurchaseSql } from './cdp-order-revenue';
import { askCellOfSql, askGroupOfCell, ASK_NOBUY, ASK_GROUPS, type AskGroupKey } from './ask-segments';
import { getCampaignSmsTablesFor, smsCampaignRowsAfter } from './sms-queue';
import { classifyResultTables } from './sms-table-split';
import { v3Live, v3StageScope } from './v3-stage';

// ── 낱행 세기(순수) ──

/** 큐 · 이력 표의 한 줄(읽기 함수 sms-queue smsCampaignRowsAfter 가 내는 꼴) */
export interface LedgerRow { seqno: number; dest_no: string; status_code: number; mob_company: string | null }

export interface RowTally {
  rows: number;
  success: number;
  fail: number;
  /** 굳힌 뒤에도 남은 대기 행(PG 합계에도 없다 = 어긋남이 아니다) */
  pending: number;
  carriers: Map<CarrierKey, { success: number; fail: number }>;
  /** 받은 번호(숫자만) → 성공 건수(비용 = 성공 건수 × 단가) */
  phones: Map<string, number>;
}

export function newTally(): RowTally {
  return { rows: 0, success: 0, fail: 0, pending: 0, carriers: new Map(), phones: new Map() };
}

const SUCCESS_SET = new Set<number>(SUCCESS_CODES as readonly number[]);
const PENDING_SET = new Set<number>(PENDING_CODES as readonly number[]);

/** 낱행을 세어 더한다 — 성공 · 대기 = 결과 코드 표(sms-result-map) · 그 밖 = 실패(캠페인 합계 CT 와 같은 가름) */
export function tallyRows(t: RowTally, rows: readonly LedgerRow[]): void {
  for (const r of rows) {
    t.rows++;
    const code = Number(r.status_code);
    if (PENDING_SET.has(code)) { t.pending++; continue; }
    const ok = SUCCESS_SET.has(code);
    const key = carrierKey(r.mob_company);
    const c = t.carriers.get(key) || { success: 0, fail: 0 };
    if (ok) {
      t.success++;
      c.success++;
      const phone = String(r.dest_no || '').replace(/[^0-9]/g, '');
      if (phone) t.phones.set(phone, (t.phones.get(phone) || 0) + 1);
    } else {
      t.fail++;
      c.fail++;
    }
    t.carriers.set(key, c);
  }
}

// ── 상수(설계서 §2) ──

/** 굴리는 창(발송 뒤 일수) */
export const ROLLUP_WINDOW_DAYS = 35;
/** 한 회차에 고르는 캠페인 수 */
export const ROLLUP_BATCH = 20;
/** 어긋난 합계에 대한 재시도 상한 · 재시도 간격(분 × 횟수) */
export const ROLLUP_RETRY_MAX = 3;
export const ROLLUP_RETRY_MINUTES = 30;
/** 받은 고객 낱행을 만드는 한계 — 굴리는 시각이 발송 뒤 이 일수를 넘기면 만들지 않는다(늦을수록 발송 시점의 칸을 되짚기 어렵다 · 설계서 D5) */
export const CELLS_ROLL_WITHIN_DAYS = 3;
/** 받은 번호를 고객 원장에 맞추는 묶음 크기 */
export const RECIPIENT_CHUNK = 5000;
/** 묶음을 정하지 못한 받은 고객의 칸 값 */
export const CELL_UNKNOWN = 'unknown';
/** 귀속 창(발송 뒤 일수) · 닫을 수 있는 때(귀속 창 + 늦게 확정되는 캠페인의 여유 3일) · 굳히는 때(정해지지 않은 채 지난 일수) */
export const ATTRIBUTION_DAYS = 7;
export const CLOSE_AFTER_DAYS = 10;
export const SKIP_AFTER_DAYS = 14;
/** 한 회차의 귀속 닫기 예산(ms) */
export const CLOSE_BUDGET_MS = 20_000;
/** 보관: 굴린 줄(일) · 닫히지 않은 낱행(일) · 주인 장부(구매 날짜 기준 일) */
export const ROLLUP_KEEP_DAYS = 400;
export const RECIPIENT_KEEP_DAYS = 30;
export const CLAIM_KEEP_DAYS = 40;
/** 낱행 읽기: 한 번에 읽는 줄 수 · 캠페인 하나의 상한(넘으면 그 캠페인은 실패 시도) · 한 회차의 굴리기 예산(ms) */
export const ROLL_PAGE = 5000;
export const ROLL_ROWS_MAX = 1_000_000;
export const ROLL_BUDGET_MS = 40_000;
/** 캠페인 한 건을 읽는 상한(ms) — 회차의 **첫 캠페인만** 이만큼까지 읽을 수 있다(큰 캠페인이 회차 예산에 막혀 영영 못 굴려지지 않게) */
export const ROLL_CAMPAIGN_MAX_MS = 120_000;
/** 통신사별 발송 성공률: 읽는 창(일) · 칸을 그리는 최소 건수(성공 + 실패) */
export const CARRIER_WINDOW_DAYS = 30;
export const CARRIER_MIN_SENT = 100;
/** 고객 묶음별 성과: 읽는 창(일) · 숫자를 보이는 최소 받은 고객 수 */
export const GROUP_PERF_WINDOW_DAYS = 90;
export const GROUP_PERF_MIN_N = 30;

/** 굴리는 대상의 채널 = 문자(SMS · LMS · MMS) 캠페인만 — 알림톡 · 브랜드 · 함께 보내기는 낱행 하나의 값이 결과마다 달라 대상 밖(설계서 D1) */
export const rollupScopeSql = (a: string): string => `COALESCE(NULLIF(${a}.send_channel, ''), 'sms') = 'sms'`;

export interface RollupCampaign {
  id: string;
  companyId: string;
  sentAt: Date;
  messageType: string | null;
  /** 아래 넷 = 그 캠페인의 큐 · 이력 표를 고를 때 쓴다(sms-queue getCampaignSmsTablesFor) */
  createdBy: string | null;
  sendConfig: any;
  scheduledAt: Date | null;
  createdAt: Date | null;
}

// ── 대상 고르기 ──

const PG_COUNTS_CHANGED = `(COALESCE(c.success_count, 0), COALESCE(c.fail_count, 0)) IS DISTINCT FROM (r.tried_success, r.tried_fail)`;

/**
 * 굴릴 캠페인($1 전 회사인가 · $2 회사들 · $3 창 일수 · $4 건수 · $5 재시도 상한).
 *   ① 상태 줄이 없다 ② PG 합계가 마지막으로 **시도한** 합계와 다르다(새 정보) ③ 어긋남 재시도 차례.
 *   result_synced_at 은 보지 않는다(값이 같아도 새로 쓰이는 칸). 차례 = ① → ② → ③ · 같은 갈래 안에서는 발송 순서.
 */
export const ROLL_PICK_SQL = `
  SELECT c.id, c.company_id, c.created_by, c.send_config, c.sent_at, c.scheduled_at, c.created_at, c.message_type
    FROM campaigns c
    LEFT JOIN campaign_send_rollup r ON r.campaign_id = c.id
   WHERE c.status = 'completed' AND c.result_final = true AND ${rollupScopeSql('c')}
     AND c.sent_at IS NOT NULL AND c.sent_at > NOW() - ($3::int * INTERVAL '1 day')
     AND ($1::boolean OR c.company_id = ANY($2::uuid[]))
     AND (r.campaign_id IS NULL
          OR ${PG_COUNTS_CHANGED}
          OR (r.drift <> 0 AND r.tries < $5::int AND r.next_try_at <= NOW()))
   ORDER BY (CASE WHEN r.campaign_id IS NULL THEN 0 WHEN ${PG_COUNTS_CHANGED} THEN 1 ELSE 2 END), c.sent_at, c.id
   LIMIT $4::int`;

export async function pickRollCandidates(scope: { all: boolean; ids: string[] }, limit: number = ROLLUP_BATCH): Promise<RollupCampaign[]> {
  if (!scope.all && scope.ids.length === 0) return [];
  const r = await query(ROLL_PICK_SQL, [scope.all, scope.ids, ROLLUP_WINDOW_DAYS, limit, ROLLUP_RETRY_MAX]);
  return r.rows.map((x: any) => ({
    id: String(x.id), companyId: String(x.company_id), sentAt: new Date(x.sent_at), messageType: x.message_type ?? null,
    createdBy: x.created_by ?? null, sendConfig: x.send_config ?? null,
    scheduledAt: x.scheduled_at ? new Date(x.scheduled_at) : null, createdAt: x.created_at ? new Date(x.created_at) : null,
  }));
}

// ── 캠페인 하나 굴리기 ──

/** 이번 시도가 새 합계에 대한 것인가(저장된 시도 합계와 다르다) → 횟수를 0 에서 다시 센다. 상태 줄 UPDATE 안에서만 쓴다(옛 줄 값 기준) */
const NEW_TOTALS = `(campaign_send_rollup.tried_success, campaign_send_rollup.tried_fail) IS DISTINCT FROM (EXCLUDED.tried_success, EXCLUDED.tried_fail)`;
const NEXT_TRIES = `(CASE WHEN ${NEW_TOTALS} THEN 1 ELSE campaign_send_rollup.tries + 1 END)`;

/** 어긋남을 적는다 — 통신사 줄 · 받은 고객은 손대지 않는다. 횟수 판정 · 시도 합계 쓰기가 한 문장($5 · $6 = 방금 읽은 PG 합계) */
export const ROLL_DRIFT_SQL = `
  INSERT INTO campaign_send_rollup (campaign_id, company_id, sent_at, sent_day, message_type, cells_state, tried_success, tried_fail, drift, tries, next_try_at, tried_at)
  VALUES ($1::uuid, $2::uuid, $3::timestamptz, ($3::timestamptz AT TIME ZONE 'Asia/Seoul')::date, $4, 'pending', $5::int, $6::int, $7::int, 1,
          NOW() + ($8::int * INTERVAL '1 minute'), NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    tries = ${NEXT_TRIES},
    next_try_at = NOW() + (${NEXT_TRIES} * $8::int * INTERVAL '1 minute'),
    cells_state = CASE WHEN campaign_send_rollup.cells_state = 'pending' AND ${NEXT_TRIES} >= $9::int THEN 'none' ELSE campaign_send_rollup.cells_state END,
    tried_success = EXCLUDED.tried_success, tried_fail = EXCLUDED.tried_fail, drift = EXCLUDED.drift, tried_at = NOW()`;

/** 맞게 굴린 상태 줄($12 = 낱행을 만들지의 판정 값 · 끝 상태(none · closed · skipped)와 open 은 바꾸지 않는다 · 단가는 처음 값을 지킨다) */
export const ROLL_OK_SQL = `
  INSERT INTO campaign_send_rollup (campaign_id, company_id, sent_at, sent_day, message_type, unit_cost, success, fail, pending, unknown_fail,
                                    cells_state, seen_success, seen_fail, tried_success, tried_fail, drift, tries, next_try_at, rolled_at, tried_at)
  VALUES ($1::uuid, $2::uuid, $3::timestamptz, ($3::timestamptz AT TIME ZONE 'Asia/Seoul')::date, $4, $5::numeric, $6::int, $7::int, $8::int, $9::int,
          $12, $10::int, $11::int, $10::int, $11::int, 0, 0, NULL, NOW(), NOW())
  ON CONFLICT (campaign_id) DO UPDATE SET
    success = EXCLUDED.success, fail = EXCLUDED.fail, pending = EXCLUDED.pending, unknown_fail = EXCLUDED.unknown_fail,
    unit_cost = COALESCE(campaign_send_rollup.unit_cost, EXCLUDED.unit_cost),
    cells_state = CASE WHEN campaign_send_rollup.cells_state = 'pending' THEN EXCLUDED.cells_state ELSE campaign_send_rollup.cells_state END,
    seen_success = EXCLUDED.seen_success, seen_fail = EXCLUDED.seen_fail, tried_success = EXCLUDED.tried_success, tried_fail = EXCLUDED.tried_fail,
    drift = 0, tries = 0, next_try_at = NULL, rolled_at = NOW(), tried_at = NOW()`;

/** 이 회사에 구매 사실이 올라오는가(별칭 co = companies) — 매장 원장 줄이 있거나 최근 90일 몰 결제가 있다 */
export const COMPANY_HAS_FACTS_SQL = `(${companyLedgerExistsSql('co')} OR EXISTS (
    SELECT 1 FROM cdp_events hf WHERE hf.company_id = co.id AND hf.occurred_at > NOW() - INTERVAL '90 days' AND ${netPurchaseSql('hf')}))`;

/**
 * 받은 고객 낱행 넣기($1 회사 · $2 캠페인 · $3 번호들(숫자만) · $4 번호마다 성공 건수 · $5 발송 시각) — 칸 = **발송 시점의 것**.
 *   구매 사실을 발송 기준으로 가른다: 앞 = 몰 결제 시각 < 발송 시각 · 원장 구매 날짜 < 발송 날짜 / 뒤 = 몰 ≥ 발송 시각 · 원장 > 발송 날짜 /
 *   가를 수 없음 = 원장 구매 날짜 = 발송 날짜(날짜만 있어 앞뒤를 모른다).
 *   판정 차례: ① 가를 수 없음이 있다 → unknown ② 뒤가 없다 → 요약 칸 그대로(기준 날짜 = 발송한 날 · 요약 날짜가 발송 날짜 이후인데
 *   그 날짜의 앞 구매 사실이 없으면 unknown) ③ 뒤가 있다 → 앞 구매 횟수 = 요약 횟수 − 뒤 구매 수(몰 주문 수 + 원장 구매 날짜 수):
 *   0 이하 = 구매 기록 없음 / 앞 구매 사실이 있다 = 그 가장 늦은 날짜 · 앞 구매 횟수로 칸 / 없다 = unknown.
 *   이미 있는 줄 = 성공 건수만 갱신(처음 정한 칸 유지).
 */
export const RECIPIENT_CELLS_SQL = `
  WITH inp AS (SELECT * FROM unnest($3::text[], $4::int[]) AS u(phone, sends)),
  sd AS (SELECT ($5::timestamptz AT TIME ZONE 'Asia/Seoul')::date AS day),
  cand AS (
    SELECT c.id, i.sends, c.recent_purchase_date AS rpd, COALESCE(c.purchase_count, 0) AS pc
      FROM inp i JOIN customers c ON c.company_id = $1::uuid AND c.phone = i.phone
  ),
  facts AS (${purchaseFactsSql({ companyRef: '$1::uuid', customerIdsRef: '(SELECT array_agg(id) FROM cand)::uuid[]' })}),
  agg AS (
    SELECT x.customer_id,
           BOOL_OR(x.door = 'ledger' AND x.kst_day = sd.day) AS same_day,
           (COUNT(*) FILTER (WHERE x.door = 'mall' AND x.at >= $5::timestamptz)
            + COUNT(DISTINCT x.kst_day) FILTER (WHERE x.door = 'ledger' AND x.kst_day > sd.day))::int AS post_n,
           MAX(x.kst_day) FILTER (WHERE (x.door = 'mall' AND x.at < $5::timestamptz) OR (x.door = 'ledger' AND x.kst_day < sd.day)) AS prior_day
      FROM facts x, sd
     GROUP BY x.customer_id
  )
  INSERT INTO campaign_recipient_cells (campaign_id, company_id, customer_id, cell, sends, sent_at)
  SELECT $2::uuid, $1::uuid, cand.id,
         CASE
           WHEN COALESCE(a.same_day, false) THEN '${CELL_UNKNOWN}'
           WHEN COALESCE(a.post_n, 0) = 0 THEN
             CASE WHEN cand.rpd IS NOT NULL AND cand.rpd >= sd.day AND (a.prior_day IS NULL OR a.prior_day < cand.rpd) THEN '${CELL_UNKNOWN}'
                  ELSE ${askCellOfSql('sd.day', 'cand.rpd', 'cand.pc')} END
           WHEN cand.pc - a.post_n <= 0 THEN '${ASK_NOBUY}'
           WHEN a.prior_day IS NULL THEN '${CELL_UNKNOWN}'
           ELSE ${askCellOfSql('sd.day', 'a.prior_day', '(cand.pc - a.post_n)')}
         END,
         cand.sends, $5::timestamptz
    FROM cand CROSS JOIN sd LEFT JOIN agg a ON a.customer_id = cand.id
  ON CONFLICT (campaign_id, customer_id) DO UPDATE SET sends = EXCLUDED.sends`;

/**
 * 캠페인 하나를 굴린다 — 낱행을 센 값(t)과 지금 PG 합계가 같을 때만 통신사 줄 · 받은 고객을 쓴다.
 *   다르면 통신사 줄 · 받은 고객은 손대지 않고 어긋남 · 재시도 시각만 적는다(같은 합계의 재시도는 대기 시간 · 세 번 상한).
 */
export async function rollCampaign(c: RollupCampaign, t: RowTally): Promise<'ok' | 'drift'> {
  return withTransaction(async (run) => {
    await run(`SET LOCAL statement_timeout = 120000`);
    const cur = (await run(
      `SELECT COALESCE(c.success_count, 0)::int AS s, COALESCE(c.fail_count, 0)::int AS f, row_to_json(co) AS company
         FROM campaigns c JOIN companies co ON co.id = c.company_id WHERE c.id = $1::uuid`, [c.id])).rows[0];
    if (!cur) return 'drift';
    const pgSuccess = Number(cur.s);
    const pgFail = Number(cur.f);
    const drift = Math.abs(t.success - pgSuccess) + Math.abs(t.fail - pgFail);
    if (drift !== 0) {
      await run(ROLL_DRIFT_SQL, [c.id, c.companyId, c.sentAt, c.messageType, pgSuccess, pgFail, drift, ROLLUP_RETRY_MINUTES, ROLLUP_RETRY_MAX]);
      return 'drift';
    }
    const unitCost = resolveChargeUnitPrice(cur.company, String(c.messageType || 'LMS'));
    // 낱행을 만들지 = 처음 정할 때 한 번(줄이 없거나 pending) — 구매 사실이 있는 회사이고 굴리는 시각이 발송 3일 안일 때만. 끝 상태는 SQL 이 지킨다
    const want = (await run(
      `SELECT ((NOW() <= $2::timestamptz + ($3::int * INTERVAL '1 day')) AND (${COMPANY_HAS_FACTS_SQL})) AS open FROM companies co WHERE co.id = $1::uuid`,
      [c.companyId, c.sentAt, CELLS_ROLL_WITHIN_DAYS])).rows[0]?.open === true ? 'open' : 'none';
    const cellsState = String((await run(ROLL_OK_SQL + ' RETURNING cells_state', [
      c.id, c.companyId, c.sentAt, c.messageType, unitCost, t.success, t.fail, t.pending, t.carriers.get('unknown')?.fail || 0,
      pgSuccess, pgFail, want,
    ])).rows[0].cells_state);
    if (cellsState === 'open') {
      const phones = [...t.phones.keys()];
      for (let i = 0; i < phones.length; i += RECIPIENT_CHUNK) {
        const part = phones.slice(i, i + RECIPIENT_CHUNK);
        await run(RECIPIENT_CELLS_SQL, [c.companyId, c.id, part, part.map((p) => t.phones.get(p) || 1), c.sentAt]);
      }
      await run(
        `UPDATE campaign_send_rollup r SET matched = x.n, unmatched = GREATEST($2::int - x.n, 0)
           FROM (SELECT COUNT(*)::int AS n FROM campaign_recipient_cells WHERE campaign_id = $1::uuid) x
          WHERE r.campaign_id = $1::uuid`, [c.id, phones.length]);
    }
    await run(`DELETE FROM campaign_carrier_results WHERE campaign_id = $1::uuid`, [c.id]);
    const keys = [...t.carriers.keys()].filter((k) => (t.carriers.get(k)!.success + t.carriers.get(k)!.fail) > 0);
    if (keys.length > 0) {
      await run(
        `INSERT INTO campaign_carrier_results (campaign_id, company_id, carrier, success, fail, sent_day)
         SELECT $1::uuid, $2::uuid, u.carrier, u.success, u.fail, ($3::timestamptz AT TIME ZONE 'Asia/Seoul')::date
           FROM unnest($4::text[], $5::int[], $6::int[]) AS u(carrier, success, fail)`,
        [c.id, c.companyId, c.sentAt, keys, keys.map((k) => t.carriers.get(k)!.success), keys.map((k) => t.carriers.get(k)!.fail)],
      );
    }
    return 'ok';
  });
}

// ── 귀속 닫기(설계서 S5 · MySQL 을 읽지 않는다) ──

/** 낱행을 만들지가 아직 정해지지 않은 캠페인(별칭 c = campaigns · x = 그 상태 줄(LEFT JOIN)) — 상태 줄이 없거나 pending */
const UNDECIDED = `(x.campaign_id IS NULL OR x.cells_state = 'pending')`;
/** 굴리는 범위의 발송한 캠페인(별칭 c) — 창 안($1 = 창 일수) */
const sentInWindow = (daysParam: string) => `${rollupScopeSql('c')} AND c.sent_at IS NOT NULL AND c.sent_at > NOW() - (${daysParam}::int * INTERVAL '1 day')`;

/**
 * 굳히기($1 굳히는 일수 · $2 창 일수) — 발송한 지 굳히는 일수가 지나도록 정해지지 않은 캠페인을 skipped 로 끝낸다(줄이 없으면 만든다).
 *   낱행이 열린(open) 캠페인이 있는 회사만(닫기를 막을 수 있는 것은 그 회사의 캠페인뿐 · 그 밖 회사에 줄을 만들지 않는다).
 */
export const SKIP_STALE_SQL = `
  INSERT INTO campaign_send_rollup (campaign_id, company_id, sent_at, sent_day, message_type, cells_state)
  SELECT c.id, c.company_id, c.sent_at, (c.sent_at AT TIME ZONE 'Asia/Seoul')::date, c.message_type, 'skipped'
    FROM campaigns c LEFT JOIN campaign_send_rollup x ON x.campaign_id = c.id
   WHERE ${sentInWindow('$2')} AND c.sent_at <= NOW() - ($1::int * INTERVAL '1 day') AND ${UNDECIDED}
     AND EXISTS (SELECT 1 FROM campaign_send_rollup o WHERE o.company_id = c.company_id AND o.cells_state = 'open')
  ON CONFLICT (campaign_id) DO UPDATE SET cells_state = 'skipped' WHERE campaign_send_rollup.cells_state = 'pending'`;

export async function skipStale(): Promise<number> {
  return (await query(SKIP_STALE_SQL, [SKIP_AFTER_DAYS, ROLLUP_WINDOW_DAYS])).rowCount || 0;
}

/**
 * 지금 닫을 수 있는 캠페인($1 닫는 일수 · $2 창 일수 · $3 귀속 일수) — 회사마다 open 가운데 발송 순서 (sent_at, campaign_id) 의 **맨 앞 하나**이고
 *   ① 발송 뒤 닫는 일수가 지났다 ② 그보다 앞선 정해지지 않은 캠페인이 없다 ③ 그 뒤 귀속 일수 안에 발송한 정해지지 않은 캠페인이 없다.
 */
export const CLOSE_HEADS_SQL = `
  SELECT h.campaign_id, h.company_id, h.sent_at
    FROM (
      SELECT DISTINCT ON (r.company_id) r.campaign_id, r.company_id, r.sent_at
        FROM campaign_send_rollup r WHERE r.cells_state = 'open'
       ORDER BY r.company_id, r.sent_at, r.campaign_id
    ) h
   WHERE h.sent_at <= NOW() - ($1::int * INTERVAL '1 day')
     AND NOT EXISTS (
       SELECT 1 FROM campaigns c LEFT JOIN campaign_send_rollup x ON x.campaign_id = c.id
        WHERE c.company_id = h.company_id AND ${sentInWindow('$2')} AND ${UNDECIDED}
          AND ((c.sent_at, c.id) < (h.sent_at, h.campaign_id)
               OR ((c.sent_at, c.id) > (h.sent_at, h.campaign_id) AND c.sent_at <= h.sent_at + ($3::int * INTERVAL '1 day'))))
   ORDER BY h.sent_at, h.campaign_id`;

/**
 * 캠페인 하나의 귀속을 닫는 한 문장($1 회사 · $2 캠페인 · $3 발송 시각 · $4 귀속 일수).
 *   후보 구매 = 받은 고객의 구매 사실 가운데 몰 = 발송 시각 < 결제 시각 ≤ +귀속 일수 · 원장 = 발송 날짜 < 구매 날짜 ≤ +귀속 일수이고,
 *   그 구매 앞에 그 고객이 받은 더 늦은 발송(발송 순서가 이 캠페인보다 뒤 · sent_at 이 구매보다 앞 · 원장 구매는 그 날짜 0시로 견준다)이 없는 것.
 *   주인 = (회사, 고객, 구매한 KST 날짜)를 주인 장부에 넣어 **이번에 새로 들어간 날짜의 후보 구매만** 센다(이미 다른 캠페인이 가진 날짜 = 세지 않는다).
 *   쓰는 줄 = 칸마다 받은 고객 수 · 성공 건수 합 · 산 고객 수 · 매출 · 비용(성공 건수 합 × 단가).
 */
export const CLOSE_ONE_SQL = `
  WITH rc AS (SELECT customer_id, cell, sends FROM campaign_recipient_cells WHERE campaign_id = $2::uuid),
  sd AS (SELECT ($3::timestamptz AT TIME ZONE 'Asia/Seoul')::date AS day),
  facts AS (${purchaseFactsSql({ companyRef: '$1::uuid', customerIdsRef: '(SELECT array_agg(customer_id) FROM rc)::uuid[]', sinceAt: '$3::timestamptz' })}),
  cand AS (
    SELECT f.customer_id, f.kst_day, f.amount
      FROM facts f, sd
     WHERE ((f.door = 'mall' AND f.at > $3::timestamptz AND f.at <= $3::timestamptz + ($4::int * INTERVAL '1 day'))
         OR (f.door = 'ledger' AND f.kst_day > sd.day AND f.kst_day <= sd.day + $4::int))
       AND NOT EXISTS (
         SELECT 1 FROM campaign_recipient_cells l
          WHERE l.company_id = $1::uuid AND l.customer_id = f.customer_id
            AND (l.sent_at, l.campaign_id) > ($3::timestamptz, $2::uuid)
            AND l.sent_at < (CASE WHEN f.door = 'ledger' THEN (f.kst_day::timestamp AT TIME ZONE 'Asia/Seoul') ELSE f.at END))
  ),
  claimed AS (
    INSERT INTO campaign_purchase_claims (company_id, customer_id, kst_day, campaign_id)
    SELECT DISTINCT $1::uuid, c.customer_id, c.kst_day, $2::uuid FROM cand c
    ON CONFLICT (company_id, customer_id, kst_day) DO NOTHING
    RETURNING customer_id, kst_day
  ),
  won AS (
    SELECT c.customer_id, SUM(COALESCE(c.amount, 0)) AS revenue
      FROM cand c JOIN claimed k ON k.customer_id = c.customer_id AND k.kst_day = c.kst_day
     GROUP BY c.customer_id
  )
  INSERT INTO campaign_cell_results (campaign_id, company_id, cell, sent_day, recipients, sends, buyers, revenue, cost)
  SELECT $2::uuid, $1::uuid, rc.cell, sd.day, COUNT(*)::int, SUM(rc.sends)::int, COUNT(w.customer_id)::int, COALESCE(SUM(w.revenue), 0),
         SUM(rc.sends) * COALESCE((SELECT unit_cost FROM campaign_send_rollup WHERE campaign_id = $2::uuid), 0)
    FROM rc CROSS JOIN sd LEFT JOIN won w ON w.customer_id = rc.customer_id
   GROUP BY rc.cell, sd.day
  ON CONFLICT (campaign_id, cell) DO NOTHING`;

export type CloseOutcome = 'closed' | 'held' | 'skipped' | 'gone';

/**
 * 캠페인 하나를 닫는다 — 칸 줄을 쓰고 낱행을 지우고 closed. 이미 open 이 아니면 gone.
 *   ★ 구현 Codex 1R — **굴린 합이 지금 PG 합계와 같을 때만 닫는다**(어긋남 0 · 맞게 굴렸을 때의 합계 = 지금 합계).
 *   다르면(굴린 뒤 늦은 결과가 들어왔는데 다시 굴리지 못했다) 낱행이 옛것이다 → held(닫지 않고 다시 굴려지기를 기다린다).
 *   굳히는 일수(14일)가 지나도록 그대로면 그 캠페인을 귀속에서 뺀다 = skipped + 낱행 삭제(옛 낱행으로 만든 숫자를 내지 않는다 · 뒤 캠페인의 차례를 막지 않는다).
 */
export async function closeCampaign(h: { campaignId: string; companyId: string; sentAt: Date }): Promise<CloseOutcome> {
  return withTransaction(async (run) => {
    await run(`SET LOCAL statement_timeout = 120000`);
    const cur = (await run(
      `SELECT r.cells_state, r.drift, r.seen_success, r.seen_fail,
              (SELECT COALESCE(c.success_count, 0)::int FROM campaigns c WHERE c.id = r.campaign_id) AS pg_success,
              (SELECT COALESCE(c.fail_count, 0)::int FROM campaigns c WHERE c.id = r.campaign_id) AS pg_fail,
              (r.sent_at <= NOW() - ($2::int * INTERVAL '1 day')) AS stale
         FROM campaign_send_rollup r WHERE r.campaign_id = $1::uuid FOR UPDATE`, [h.campaignId, SKIP_AFTER_DAYS])).rows[0];
    if (cur?.cells_state !== 'open') return 'gone';
    const settled = Number(cur.drift) === 0 && cur.pg_success !== null && cur.pg_fail !== null
      && Number(cur.pg_success) === Number(cur.seen_success) && Number(cur.pg_fail) === Number(cur.seen_fail);
    if (!settled) {
      if (cur.stale !== true) return 'held';
      await run(`DELETE FROM campaign_recipient_cells WHERE campaign_id = $1::uuid`, [h.campaignId]);
      await run(`UPDATE campaign_send_rollup SET cells_state = 'skipped' WHERE campaign_id = $1::uuid`, [h.campaignId]);
      return 'skipped';
    }
    await run(CLOSE_ONE_SQL, [h.companyId, h.campaignId, h.sentAt, ATTRIBUTION_DAYS]);
    await run(`DELETE FROM campaign_recipient_cells WHERE campaign_id = $1::uuid`, [h.campaignId]);
    await run(`UPDATE campaign_send_rollup SET cells_state = 'closed' WHERE campaign_id = $1::uuid`, [h.campaignId]);
    return 'closed';
  });
}

/**
 * 닫을 수 있는 맨 앞 캠페인들을 한 바퀴 돈다(회사마다 하나) — 돌려주는 값 = 끝낸 수(닫음 + 귀속에서 뺌 = 그 회사의 다음 캠페인이 맨 앞이 된다).
 *   skip = 이번 회차에 다시 보지 않을 캠페인(기다리는 것 · 실패한 것).
 */
export async function closePass(skip: Set<string> = new Set(), until: number = Number.POSITIVE_INFINITY): Promise<number> {
  const heads = (await query(CLOSE_HEADS_SQL, [CLOSE_AFTER_DAYS, ROLLUP_WINDOW_DAYS, ATTRIBUTION_DAYS])).rows
    .filter((x: any) => !skip.has(String(x.campaign_id)));
  let n = 0;
  for (const x of heads) {
    if (Date.now() > until) break;
    const id = String(x.campaign_id);
    try {
      const out = await closeCampaign({ campaignId: id, companyId: String(x.company_id), sentAt: new Date(x.sent_at) });
      if (out === 'closed' || out === 'skipped') n++;
      else skip.add(id);
    } catch (e: any) {
      skip.add(id);
      console.error(`[send-ledger-rollup] 귀속 닫기 실패 campaign=${id}:`, e?.message);
    }
  }
  return n;
}

/** 예산 안에서 닫을 수 있는 만큼 닫는다(앞이 닫히면 그 회사의 다음 것이 맨 앞이 된다) */
export async function closeDue(budgetMs: number = CLOSE_BUDGET_MS): Promise<number> {
  const until = Date.now() + budgetMs;
  const skip = new Set<string>();
  let total = 0;
  for (;;) {
    const n = await closePass(skip, until);
    total += n;
    if (n === 0 || Date.now() > until) return total;
  }
}

/**
 * 보관 정리 — 굴린 줄 · 통신사 줄 · 칸 줄 = 발송 날짜가 보관 일수를 넘은 것 / 닫히지 않은 채 오래된 낱행(그 캠페인은 skipped 로 끝낸다) /
 *   구매 날짜가 오래된 주인 장부 줄.
 */
export async function pruneRollup(): Promise<void> {
  await withTransaction(async (run) => {
    await run(`SET LOCAL statement_timeout = 60000`);
    const old = `< (NOW() AT TIME ZONE 'Asia/Seoul')::date - $1::int`;
    await run(`DELETE FROM campaign_carrier_results WHERE sent_day ${old}`, [ROLLUP_KEEP_DAYS]);
    await run(`DELETE FROM campaign_cell_results WHERE sent_day ${old}`, [ROLLUP_KEEP_DAYS]);
    await run(`DELETE FROM campaign_send_rollup WHERE sent_day ${old}`, [ROLLUP_KEEP_DAYS]);
    await run(
      `WITH gone AS (
         UPDATE campaign_send_rollup SET cells_state = 'skipped'
          WHERE cells_state = 'open' AND sent_at < NOW() - ($1::int * INTERVAL '1 day') RETURNING campaign_id
       )
       DELETE FROM campaign_recipient_cells l
        WHERE l.campaign_id IN (SELECT campaign_id FROM gone) OR l.sent_at < NOW() - ($1::int * INTERVAL '1 day')`, [RECIPIENT_KEEP_DAYS]);
    await run(`DELETE FROM campaign_purchase_claims WHERE kst_day ${old}`, [CLAIM_KEEP_DAYS]);
  });
}

// ── 낱행 읽기(MySQL · CT-04 함수로만) ──

/** 읽지 못한 굴림(시간 초과 · 줄 수 상한)의 어긋남 표식 — 0 이 아니면 읽는 쪽이 뺀다 */
export const DRIFT_UNREAD = -1;

/** 읽는 도중 예산(until)을 넘겼다 — 센 값은 버린다(부분 집계를 쓰지 않는다) */
export class RollBudgetExceeded extends Error {
  constructor() { super('낱행 읽기 예산을 넘었다'); this.name = 'RollBudgetExceeded'; }
}
/** 캠페인의 낱행이 상한(ROLL_ROWS_MAX)을 넘었다 — 일꾼 안에서만 던지고 잡는다(실패 시도로 센다 · 사용자 응답에 닿지 않는다) */
export class RollRowsExceeded extends Error {
  constructor() { super(`낱행이 ${ROLL_ROWS_MAX}줄을 넘는다`); this.name = 'RollRowsExceeded'; }
}

/**
 * 읽기 예산 안에서만 기다린다(★ 구현 Codex 2R) — 표 목록 조회는 공용 풀의 한 문장이라 연결이 모자라면 끝없이 기다린다
 *   (그대로 두면 회차가 끝나지 않아 다음 굴리기 · 닫기 · 정리까지 멈춘다). 넘기면 RollBudgetExceeded.
 *   늦게 온 답은 버린다 — 그 문장은 끝나면 연결을 스스로 돌려준다(mysqlQuery 의 finally) · 늦은 거절은 삼킨다.
 */
function withinBudget<T>(work: Promise<T>, until: number): Promise<T> {
  if (until === Number.POSITIVE_INFINITY) return work;   // setTimeout 은 무한대를 1ms 로 읽는다
  work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RollBudgetExceeded()), Math.max(0, until - Date.now())); });
  return Promise.race([work, limit]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * 캠페인 하나의 낱행을 읽어 센다 — 결과 표 = 전 행 · 대기 전용 라이브 = 만료 실패만(캠페인 합계 CT 와 같은 가시성).
 *   줄 수 상한을 넘으면 던진다(부르는 쪽이 실패 시도로 센다). readRows = 시험이 가짜 낱행을 넣는 자리.
 *   until = 이 시각을 넘기면 **쪽을 읽기 전에** RollBudgetExceeded 로 멈춘다(회차 예산이 쪽 읽기까지 내려온다 · 구현 Codex 1R).
 *           표 목록 조회도 같은 시각까지만 기다린다(구현 Codex 2R).
 */
export async function readCampaignTally(
  c: RollupCampaign,
  readRows: typeof smsCampaignRowsAfter = smsCampaignRowsAfter,
  tablesOf: (c: RollupCampaign) => Promise<string[]> = (x) => getCampaignSmsTablesFor(x.companyId, {
    created_by: x.createdBy, send_config: x.sendConfig, sent_at: x.sentAt, scheduled_at: x.scheduledAt, created_at: x.createdAt,
  }),
  until: number = Number.POSITIVE_INFINITY,
): Promise<RowTally> {
  const t = newTally();
  if (Date.now() > until) throw new RollBudgetExceeded();
  const { resultTables, pendingLiveTables } = classifyResultTables(await withinBudget(tablesOf(c), until));
  const plan: Array<[string, boolean]> = [...resultTables.map((x): [string, boolean] => [x, false]), ...pendingLiveTables.map((x): [string, boolean] => [x, true])];
  for (const [table, expiredOnly] of plan) {
    let after = 0;
    for (;;) {
      if (Date.now() > until) throw new RollBudgetExceeded();
      const rows = await readRows(table, c.id, after, ROLL_PAGE, expiredOnly);
      tallyRows(t, rows);
      if (t.rows > ROLL_ROWS_MAX) throw new RollRowsExceeded();
      if (rows.length < ROLL_PAGE) break;
      after = Number(rows[rows.length - 1].seqno);
    }
  }
  return t;
}

/** 읽지 못한 굴림을 실패 시도로 적는다(통신사 줄 · 받은 고객은 손대지 않는다 · 횟수 · 대기 시간 규칙은 어긋남과 같다) */
export async function failRoll(c: RollupCampaign): Promise<void> {
  const cur = (await query(`SELECT COALESCE(success_count, 0)::int AS s, COALESCE(fail_count, 0)::int AS f FROM campaigns WHERE id = $1::uuid`, [c.id])).rows[0];
  if (!cur) return;
  await query(ROLL_DRIFT_SQL, [c.id, c.companyId, c.sentAt, c.messageType, Number(cur.s), Number(cur.f), DRIFT_UNREAD, ROLLUP_RETRY_MINUTES, ROLLUP_RETRY_MAX]);
}

// ── 읽기(설계서 S3 · S6) ──

export interface CarrierSendRates {
  /** 통신사(알뜰폰을 그 망에 더한 세 줄)마다 성공률 — 건수가 모자란 통신사는 싣지 않는다 */
  rates: Array<{ carrier: CarrierNet; rate: number }>;
  /** 통신사를 알 수 없는 실패 수(성공률에 넣지 않는다) */
  unknownFail: number;
}

/** (순수) 통신사 키별 합 → 띠의 세 줄. 성공률 = 통신사가 남은 행만 성공 ÷ (성공 + 실패) · 미상 · 그 밖은 분모에 넣지 않는다 */
export function carrierSendRates(rows: ReadonlyArray<{ carrier: string; success: number; fail: number }>): CarrierSendRates {
  const sum = new Map<CarrierNet, { ok: number; all: number }>();
  let unknownFail = 0;
  for (const x of rows) {
    const success = Number(x.success) || 0;
    const fail = Number(x.fail) || 0;
    if (x.carrier === 'unknown') unknownFail += fail;
    const net = carrierNet(x.carrier as CarrierKey);
    if (!net) continue;
    const cur = sum.get(net) || { ok: 0, all: 0 };
    sum.set(net, { ok: cur.ok + success, all: cur.all + success + fail });
  }
  return {
    rates: CARRIER_NETS.filter((n) => (sum.get(n)?.all || 0) >= CARRIER_MIN_SENT).map((n) => ({ carrier: n, rate: sum.get(n)!.ok / sum.get(n)!.all })),
    unknownFail,
  };
}

/** 맞게 굴린 캠페인의 통신사 줄(별칭 k = 통신사 줄 · r = 상태 줄 · $1 창 일수) — 어긋난 캠페인(drift ≠ 0)은 뺀다 */
const CARRIER_ROWS_FROM = `
    FROM campaign_carrier_results k JOIN campaign_send_rollup r ON r.campaign_id = k.campaign_id
   WHERE k.sent_day > (NOW() AT TIME ZONE 'Asia/Seoul')::date - $1::int AND r.drift = 0`;

export async function readCarrierSendRates(companyId: string): Promise<CarrierSendRates> {
  const r = await query(
    `SELECT k.carrier, SUM(k.success)::int AS success, SUM(k.fail)::int AS fail ${CARRIER_ROWS_FROM} AND k.company_id = $2::uuid GROUP BY k.carrier`,
    [CARRIER_WINDOW_DAYS, companyId]);
  return carrierSendRates(r.rows.map((x: any) => ({ carrier: String(x.carrier), success: Number(x.success), fail: Number(x.fail) })));
}

/**
 * (SQL) 회사 · 통신사(세 줄)별 발송 성공률 — 업종 평균 스냅숏이 쓴다($1 창 일수 · $2 회사들 · $3 최소 건수).
 *   칸 = company_id · net · rate. 읽기(readCarrierSendRates)와 같은 줄 · 같은 접기(carrierNetSql = carrierNet 과 같은 표) · 같은 최소 건수.
 */
export const CARRIER_NET_RATES_SQL = `
  SELECT t.company_id, t.net, t.ok::float8 / t.total AS rate
    FROM (
      SELECT k.company_id, ${carrierNetSql('k.carrier')} AS net, SUM(k.success)::bigint AS ok, SUM(k.success + k.fail)::bigint AS total
        ${CARRIER_ROWS_FROM} AND k.company_id = ANY($2::uuid[])
       GROUP BY k.company_id, ${carrierNetSql('k.carrier')}
    ) t
   WHERE t.net IS NOT NULL AND t.total >= $3::int`;

export interface GroupPerformanceRow {
  group: AskGroupKey;
  name: string;
  desc: string;
  /** 받은 고객 수(캠페인마다 센 합) */
  recipients: number;
  /** 아래 넷 = 받은 고객이 최소 수에 못 미치면 null(숫자를 보이지 않는다) */
  buyers: number | null;
  revenue: number | null;
  cost: number | null;
  /** 문자 1원당 매출(비용 0 = null) */
  perWon: number | null;
}
export interface GroupPerformance { groups: GroupPerformanceRow[]; unknown: number }

/** (순수) 칸 합계 → 묶음 일곱 줄(화면 순서) + 묶음을 정하지 못한 받은 고객 수 */
export function foldGroupPerformance(rows: ReadonlyArray<{ cell: string; recipients: number; buyers: number; revenue: number; cost: number }>): GroupPerformance {
  const sum = new Map<AskGroupKey, { recipients: number; buyers: number; revenue: number; cost: number }>();
  let unknown = 0;
  for (const x of rows) {
    const g = askGroupOfCell(x.cell);
    if (!g) { unknown += Number(x.recipients) || 0; continue; }
    const cur = sum.get(g) || { recipients: 0, buyers: 0, revenue: 0, cost: 0 };
    sum.set(g, {
      recipients: cur.recipients + (Number(x.recipients) || 0), buyers: cur.buyers + (Number(x.buyers) || 0),
      revenue: cur.revenue + (Number(x.revenue) || 0), cost: cur.cost + (Number(x.cost) || 0),
    });
  }
  return {
    groups: ASK_GROUPS.map((g) => {
      const v = sum.get(g.key) || { recipients: 0, buyers: 0, revenue: 0, cost: 0 };
      const head = { group: g.key, name: g.name, desc: g.desc, recipients: v.recipients };
      if (v.recipients < GROUP_PERF_MIN_N) return { ...head, buyers: null, revenue: null, cost: null, perWon: null };
      return { ...head, buyers: v.buyers, revenue: v.revenue, cost: v.cost, perWon: v.cost > 0 ? v.revenue / v.cost : null };
    }),
    unknown,
  };
}

/** 최근 발송(귀속이 닫힌 캠페인 · 어긋남 0)의 칸 합계를 묶음으로 접는다 */
export async function readGroupPerformance(companyId: string): Promise<GroupPerformance> {
  const r = await query(
    `SELECT x.cell, SUM(x.recipients)::int AS recipients, SUM(x.buyers)::int AS buyers, SUM(x.revenue)::float8 AS revenue, SUM(x.cost)::float8 AS cost
       FROM campaign_cell_results x JOIN campaign_send_rollup r ON r.campaign_id = x.campaign_id
      WHERE x.company_id = $1::uuid AND x.sent_day > (NOW() AT TIME ZONE 'Asia/Seoul')::date - $2::int
        AND r.drift = 0 AND r.cells_state = 'closed'
      GROUP BY x.cell`,
    [companyId, GROUP_PERF_WINDOW_DAYS]);
  return foldGroupPerformance(r.rows.map((x: any) => ({
    cell: String(x.cell), recipients: Number(x.recipients), buyers: Number(x.buyers), revenue: Number(x.revenue), cost: Number(x.cost),
  })));
}

// ── 일꾼(설계서 S7) ──

const LIVE_TTL_MS = 30 * 60 * 1000;
const liveMemo = new Map<string, { at: number; live: boolean }>();

/** 굴리기 단계가 지금 열린 회사들(ENV 명단은 후보 · 회사마다 v3Live 로 다시 판정 = 요금제가 먼저 · 판정은 30분 기억) */
export async function rollupLiveCompanyIds(
  env: Record<string, string | undefined> = process.env,
  live: (companyId: string) => Promise<boolean> = (id) => v3Live('rollup', id),
): Promise<string[]> {
  const scope = v3StageScope('rollup', env);
  if (!scope.all && scope.ids.length === 0) return [];
  const r = await query(
    `SELECT DISTINCT c.company_id FROM campaigns c
      WHERE c.status = 'completed' AND ${rollupScopeSql('c')} AND c.sent_at > NOW() - ($3::int * INTERVAL '1 day')
        AND ($1::boolean OR c.company_id = ANY($2::uuid[]))`,
    [scope.all, scope.ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)), ROLLUP_WINDOW_DAYS]);
  const out: string[] = [];
  for (const x of r.rows) {
    const id = String(x.company_id);
    const memo = liveMemo.get(id);
    let ok = memo && Date.now() - memo.at < LIVE_TTL_MS ? memo.live : undefined;
    if (ok === undefined) {
      ok = await live(id);
      liveMemo.set(id, { at: Date.now(), live: ok });
    }
    if (ok) out.push(id);
  }
  return out;
}
/** (시험용) 단계 판정 기억 비우기 */
export function clearRollupLiveMemo(): void { liveMemo.clear(); }

export interface RollupTickResult { skipped: number; closed: number; rolled: number; drifted: number; failed: number }

/**
 * 한 회차 — ① 언제나(PG 만): 굳히기 → 귀속 닫기 → 보관 정리 ② 굴리기 단계가 열린 회사가 있을 때만(MySQL 읽기): 대상 굴리기.
 *   ⛔ ①은 단계 판정 앞에 둔다(단계를 닫아도 열려 있던 귀속은 닫히고 낱행은 지워진다).
 */
export async function runRollupTick(deps: {
  liveIds?: () => Promise<string[]>;
  read?: (c: RollupCampaign, until: number) => Promise<RowTally>;
} = {}): Promise<RollupTickResult> {
  const out: RollupTickResult = { skipped: 0, closed: 0, rolled: 0, drifted: 0, failed: 0 };
  out.skipped = await skipStale();
  out.closed = await closeDue();
  await pruneRollup();
  const ids = await (deps.liveIds || rollupLiveCompanyIds)();
  if (ids.length === 0) return out;
  const read = deps.read || ((c: RollupCampaign, until: number) => readCampaignTally(c, undefined, undefined, until));
  const tickUntil = Date.now() + ROLL_BUDGET_MS;
  let first = true;
  for (const c of await pickRollCandidates({ all: false, ids })) {
    if (Date.now() > tickUntil) break;
    // 읽기 예산 = 회차 예산 그대로 · 회차의 첫 캠페인만 캠페인 한 건 상한까지(그보다 큰 것은 실패 시도 · 세 번 뒤 그만둔다)
    const wasFirst = first;
    first = false;
    try {
      if ((await rollCampaign(c, await read(c, wasFirst ? Date.now() + ROLL_CAMPAIGN_MAX_MS : tickUntil))) === 'ok') out.rolled++;
      else out.drifted++;
    } catch (e: any) {
      // 첫 캠페인이 아닌데 시간이 모자랐다 = 실패가 아니다(다음 회차에 앞 차례로 온다 · 시도 횟수를 쓰지 않는다)
      if (e instanceof RollBudgetExceeded && !wasFirst) break;
      out.failed++;
      console.error(`[send-ledger-rollup] 굴리기 실패 campaign=${c.id}:`, e?.message);
      await failRoll(c).catch((err: any) => console.error(`[send-ledger-rollup] 실패 기록도 실패 campaign=${c.id}:`, err?.message));
    }
  }
  return out;
}

const WORKER_INTERVAL_MS = 10 * 60 * 1000;
const BOOT_DELAY_MS = 90_000;
let workerTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await runRollupTick();
    if (r.skipped + r.closed + r.rolled + r.drifted + r.failed > 0) {
      console.log(`[send-ledger-rollup] 굳힘 ${r.skipped} · 닫음 ${r.closed} · 굴림 ${r.rolled} · 어긋남 ${r.drifted} · 실패 ${r.failed}`);
    }
  } catch (err: any) {
    console.error('[send-ledger-rollup] 회차 실패(표가 없으면 DDL C154-DDL-1 확인):', err?.message);
  } finally {
    running = false;
  }
}

/** 10분마다 한 회차(프로세스 하나 전제 · 겹쳐 돌지 않는다) */
export function startSendLedgerRollupWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => { void tick(); }, WORKER_INTERVAL_MS);
  setTimeout(() => { void tick(); }, BOOT_DELAY_MS).unref?.();
  console.log('[send-ledger-rollup] 워커 시작 — 10분마다 · 닫기 · 정리는 언제나 · 낱행 읽기는 굴리기 단계가 열린 회사만');
}

export function stopSendLedgerRollupWorker(): void {
  if (workerTimer) { clearInterval(workerTimer); workerTimer = null; }
}
