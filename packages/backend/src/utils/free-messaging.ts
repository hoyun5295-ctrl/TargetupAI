/**
 * free-messaging.ts — 요금제 무료 메시징 컨트롤타워 (★ 2026-08-05 신설)
 *
 * 요금제에 포함된 월 무료 발송 수량(SMS·LMS·MMS·알림톡)의 **지급·소진·조회 단일 진입점**.
 * 설계·확정 근거 = `docs/2026-08-05-plan-free-messaging-design.md`.
 *
 * 핵심 계약 넷 — 어기면 돈이 틀리거나 혜택이 조용히 사라진다.
 *  ① 총 한도는 요금제 월정액의 10% **하나**이고 그것을 4유형으로 나눈 값이 `plans`에 들어 있다.
 *     수량의 진실은 `plans` 행이다 — 코드에 숫자를 적지 않는다(CT-17 규약 미러).
 *  ② 지급은 회사×월×유형 **하나뿐**(UNIQUE). 재실행·중복 기동·강등 후 재승급이 전부 그 하나로 막힌다.
 *  ③ 소진은 **되돌리지 않는다**(설계 §5-1-A). 되돌림의 주체가 30초 주기 sweeper라
 *     "이미 얼마 복원했나"를 기억할 장치가 또 필요해지기 때문이다. 발송 시점 UPDATE 한 번으로 끝난다.
 *  ④ 이월 없음 — 소진·조회가 **당월 행만** 보므로 월이 바뀌면 구조적으로 소멸한다(삭제 배치 없음).
 *
 * ⚠ 테이블·컬럼 부재(DDL 미실행)는 **무료 0으로 폴백**한다. 그 상태의 동작은 이 기능 도입 전과
 *   한 건도 다르지 않다(전액 과금·정상 발송). 반대로 발송을 막으면 전 고객이 멈추므로,
 *   여기서는 열어 두는 쪽이 안전한 방향이다. 대신 로그로 크게 남긴다.
 */

import pool, { query } from '../config/database';

/** 무료 제공 대상 유형 축. `key`는 `prepaidDeduct(messageType)`·`billing_items.message_type`과 같은 값이다. */
export interface FreeMessagingTypeDef {
  /** 청구·차감 유형키 (BILLING_TYPES와 동일 축) */
  key: 'SMS' | 'LMS' | 'MMS' | 'KAKAO';
  /** 화면 표시명 */
  label: string;
  /** `plans` 수량 컬럼 */
  planColumn: 'free_sms_qty' | 'free_lms_qty' | 'free_mms_qty' | 'free_alimtalk_qty';
  /** 수량 산정에 쓴 일괄 공통 단가(원). 고객사 개별 단가와 무관 — 지급 행에 스냅샷으로 남긴다 */
  unitValue: number;
}

/**
 * ⚠ 순서가 화면 표기 순서다. **BRAND(브랜드메시지)·테스트·스팸·에이전트는 대상이 아니다**(설계 §1-8).
 */
export const FREE_MESSAGING_TYPES: readonly FreeMessagingTypeDef[] = [
  { key: 'SMS', label: 'SMS', planColumn: 'free_sms_qty', unitValue: 10 },
  { key: 'LMS', label: 'LMS', planColumn: 'free_lms_qty', unitValue: 30 },
  { key: 'MMS', label: 'MMS', planColumn: 'free_mms_qty', unitValue: 60 },
  { key: 'KAKAO', label: '알림톡', planColumn: 'free_alimtalk_qty', unitValue: 6 },
];

const FREE_TYPE_KEYS = new Set<string>(FREE_MESSAGING_TYPES.map((t) => t.key));

/**
 * 무료 제공으로 덮을 수 있는 차감인가. (순수)
 *
 * 웹 발송 4종 × 발송 성격의 차감만이다. 테스트·스팸은 유형키부터 다르고(TEST_*·SPAM_*),
 * 브랜드메시지는 `BRAND`라 자연히 빠진다. `referenceType`으로 한 번 더 좁히는 이유는
 * 같은 `SMS` 유형키로 들어오는 테스트 차감(`referenceType='test'`)을 막기 위해서다.
 */
export function isFreeMessagingEligible(messageType: any, referenceType: any): boolean {
  const t = String(messageType || '').trim().toUpperCase();
  if (!FREE_TYPE_KEYS.has(t)) return false;
  const r = String(referenceType || 'campaign').trim();
  return r === 'campaign' || r === 'journey';
}

/** 당월(KST) 1일. **항상 DB에서 계산한다** — 서버 시계·타임존 해석이 갈리면 지급 월이 어긋난다. */
const KST_PERIOD_MONTH_SQL = `date_trunc('month', (NOW() AT TIME ZONE 'Asia/Seoul'))::date`;

/**
 * 그 지급 행(별칭 `g`)에 **남은 무료 수량**. 선불 소진과 후불 공제가 **같은 식 하나**를 쓴다.
 *
 * ★ 2026-08-05 (Codex 2R high) 두 축이 서로를 안 보면 **같은 달에 결제방식을 바꾸는 회사가 한도를 두 번 쓴다.**
 *   선불로 100건을 소진한 뒤(`used_qty`) 후불로 전환하면, 후불 공제는 `used_qty`를 무시해 다시 100건을 준다.
 *   반대 방향도 같다. 결제방식을 월말까지 못 바꾸게 강제하는 장치가 없으므로 식으로 닫는다.
 *
 *  · `used_qty`      = 선불이 발송 시점에 소진한 양(시도 기준·미복원)
 *  · `SUM(free_count)` = 후불 발행이 청구에서 뺀 양(성공 기준). **발행을 지우면 함께 사라져** 되돌림이 자동이다
 */
const REMAINING_EXPR = `GREATEST(0, g.granted_qty - g.used_qty - COALESCE((
  SELECT SUM(bi.free_count) FROM billing_items bi
   WHERE bi.company_id = g.company_id
     AND bi.channel = 'web'
     AND bi.message_type = g.msg_type
     AND date_trunc('month', bi.item_date)::date = g.period_month
), 0))`;

/** 스키마 미비(테이블·컬럼 부재)인가 — DDL 미실행 상태를 다른 오류와 구분한다. */
function isSchemaMissing(err: any): boolean {
  const code = String(err?.code || '');
  if (code === '42P01' || code === '42703') return true;
  const msg = String(err?.message || '');
  return /does not exist/i.test(msg) && /(column|relation|table)/i.test(msg);
}

/**
 * DDL 미실행을 **호출부가 구분할 수 있게** 던지는 오류. (★ 2026-08-05 Codex 2R high)
 *
 * 스키마 부재를 전부 조용히 삼키면 `DB_MIGRATION_PENDING` 503 분기(CLAUDE.md `db_alter_safety_net`)에
 * 영원히 닿지 못하고, 화면은 "무료 없음"으로, 청구는 "무료 공제 없이 전액"으로 **위장**된다.
 * 발송 경로만 0으로 폴백하고(멈추면 전 고객이 못 보낸다), 화면·청구는 이 오류를 전파한다.
 */
export class FreeMessagingSchemaPendingError extends Error {
  readonly code = 'DB_MIGRATION_PENDING';
  constructor() {
    super('요금제 무료 메시징 DB 마이그레이션 필요 — plans.free_*_qty · free_messaging_grants · billing_items.free_count');
    this.name = 'FreeMessagingSchemaPendingError';
  }
}

let _missingWarned = false;
function warnSchemaMissing(where: string, err: any): void {
  if (!_missingWarned) {
    _missingWarned = true;
    console.error(
      `[무료메시징][DB_MIGRATION_PENDING] ${where} — free_messaging_grants / plans.free_*_qty 미생성. ` +
      '무료 제공 0으로 폴백해 종전대로 전액 과금한다. DDL 실행 요청 필요.',
      err?.message || err,
    );
  }
}

// ════════════════════════════════════════════════════════════
// 소진 — 차감 트랜잭션 안에서만 부른다
// ════════════════════════════════════════════════════════════

/**
 * 당월 무료 잔량에서 최대 `count`건까지 소진하고 **실제로 덮은 건수**를 돌려준다.
 *
 * 호출 전제 = `prepaidDeduct`의 트랜잭션 안(그 회사 `companies` 행이 이미 `FOR UPDATE`).
 * 그래서 같은 회사의 차감끼리는 이미 직렬화돼 있지만, UPDATE 자체도 잔량을 넘지 못하게
 * 한 문장으로 닫아 둔다(잠금이 없는 경로가 나중에 생겨도 초과 소진이 구조적으로 불가능하게).
 *
 * ⚠ 되돌리지 않는다(설계 §5-1-A). 실패·미적재로 발송이 안 나가도 이 수량은 복원되지 않는다.
 */
export async function consumeFreeQuota(
  client: { query: (sql: string, params?: any[]) => Promise<any> },
  companyId: string,
  messageType: string,
  count: number,
  /**
   * ★ 2026-08-05 (Codex 1R critical) 호출자가 **열린 트랜잭션 안**인가.
   *
   * PostgreSQL은 트랜잭션 안에서 문장이 실패하면 그 트랜잭션을 aborted로 굳힌다 — catch로 삼켜도
   * 그 뒤 모든 문장과 COMMIT이 함께 실패한다. 즉 DDL 미실행 구간에서 이 함수의 "무료 0 폴백"이
   * **선불 발송 차감 전체를 중단시킨다**(폴백이 지키려던 것과 정반대). SAVEPOINT로 감싸야 한다.
   * 스키마 부재만이 아니라 CHECK 위반 같은 다른 오류도 같은 자리에서 막힌다.
   */
  opts: { inTransaction?: boolean } = {},
): Promise<number> {
  const want = Math.max(0, Math.floor(Number(count) || 0));
  if (want <= 0) return 0;
  const type = String(messageType || '').trim().toUpperCase();
  if (!FREE_TYPE_KEYS.has(type)) return 0;
  const inTx = opts.inTransaction === true;

  if (inTx) {
    try {
      await client.query('SAVEPOINT free_quota_claim');
    } catch (spErr: any) {
      // SAVEPOINT조차 못 잡으면 이 트랜잭션은 이미 성한 상태가 아니다. 건드리지 않고 물러난다.
      console.error(`[무료메시징][소진skip] company=${companyId} ${type} — SAVEPOINT 실패:`, spErr?.message || spErr);
      return 0;
    }
  }

  try {
    // ★ 2026-08-05 (Codex 1R high) 잔량 확정과 증가를 **한 문장 안에서 잠근 행 기준으로** 한다.
    //   그 전에는 스냅샷 별칭에서 잔량을 계산해, 잠금이 없는 경로(후불)에서 동시 두 건이 같은 잔량을
    //   읽고 각자 더해 granted_qty를 넘길 수 있었다. `FOR UPDATE`가 걸리면 뒤 트랜잭션은 잠금을 얻은 뒤
    //   **갱신된 행**을 다시 평가하므로 두 번째가 보는 잔량이 이미 줄어 있다.
    const res = await client.query(
      `WITH claim AS (
         SELECT g.id, LEAST($3::int, ${REMAINING_EXPR}) AS take
           FROM free_messaging_grants g
          WHERE g.company_id = $1 AND g.msg_type = $2
            AND g.period_month = ${KST_PERIOD_MONTH_SQL}
            AND ${REMAINING_EXPR} > 0
          FOR UPDATE
       )
       UPDATE free_messaging_grants t
          SET used_qty = t.used_qty + claim.take
         FROM claim
        WHERE t.id = claim.id
       RETURNING claim.take::int AS free_used`,
      [companyId, type, want],
    );
    const used = Number(res.rows?.[0]?.free_used) || 0;
    if (inTx) await client.query('RELEASE SAVEPOINT free_quota_claim');
    return Math.max(0, Math.min(used, want));
  } catch (err: any) {
    // 트랜잭션을 오류 직전 상태로 되돌린다 — 이걸 안 하면 호출자의 차감·COMMIT이 통째로 죽는다.
    if (inTx) {
      try { await client.query('ROLLBACK TO SAVEPOINT free_quota_claim'); } catch { /* 이미 끝난 트랜잭션 */ }
    }
    // DDL 미실행만 0으로 폴백한다 — 그 상태의 동작은 이 기능 도입 전과 한 건도 다르지 않다.
    if (isSchemaMissing(err)) {
      warnSchemaMissing('consumeFreeQuota', err);
      return 0;
    }
    // ★ 2026-08-05 (Codex 2R high — 1R의 내 판단을 뒤집는다) 그 밖의 오류는 **throw한다.**
    //   1R에서는 "폴백하면 전액 과금이라 돈이 안 샌다"고 봤는데 그게 틀렸다. 권한·타임아웃처럼
    //   지속되는 오류면 무료 한도가 있는 고객에게 **매 발송 전액이 청구되고 보상 기록도 남지 않는다.**
    //   과금 근거가 불확실하면 발송을 막는 것이 이 저장소의 규약이다(0726 "단가 미설정이면 발송 차단"과 같은 부류).
    //   일시 오류면 재시도로 풀리고, 호출부(prepaidDeduct)의 catch가 잔액을 건드리지 않은 채 실패를 돌려준다.
    console.error(`[무료메시징][소진실패] company=${companyId} ${type} ${want}건 — 발송 차단:`, err?.message || err);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════
// 조회 — 화면·후불 공제
// ════════════════════════════════════════════════════════════

export interface FreeMessagingLine {
  type: FreeMessagingTypeDef['key'];
  label: string;
  granted: number;
  used: number;
  remaining: number;
}

export interface FreeMessagingStatus {
  /** 당월 1일(KST) `YYYY-MM-DD` */
  periodMonth: string | null;
  /** 지급 행이 하나도 없으면 false — 무료 미제공 요금제이거나 DDL 미실행 */
  available: boolean;
  lines: FreeMessagingLine[];
}

/**
 * 회사의 **당월** 무료 제공 현황(화면).
 *
 * ★ 2026-08-05 사용량은 **선불·후불 두 축의 합**이다 — 한 회사는 둘 중 하나뿐이라 나머지 항은 0이다.
 *  · 선불 = `used_qty`(발송 시도 시점 소진, 미복원)
 *  · 후불 = 발행이 청구에서 뺀 양 `SUM(billing_items.free_count)` — 후불은 성공 기준이라 발행이 확정한다
 * 두 축을 한 값으로 묶었다가 시도와 성공이 뭉개져 과소청구가 났다(Codex 1R). 표시도 각자의 진실을 쓴다.
 */
export async function readFreeMessagingStatus(companyId: string): Promise<FreeMessagingStatus> {
  const empty: FreeMessagingStatus = { periodMonth: null, available: false, lines: [] };
  try {
    const res = await query(
      `SELECT g.msg_type, g.granted_qty, g.period_month::text AS period_month,
              ${REMAINING_EXPR}::int AS remaining_qty
         FROM free_messaging_grants g
        WHERE g.company_id = $1 AND g.period_month = ${KST_PERIOD_MONTH_SQL}`,
      [companyId],
    );
    if (res.rows.length === 0) return empty;
    const byType = new Map<string, any>(res.rows.map((r: any) => [String(r.msg_type), r]));
    const lines: FreeMessagingLine[] = FREE_MESSAGING_TYPES.map((t) => {
      const r = byType.get(t.key);
      const granted = Math.max(0, Number(r?.granted_qty) || 0);
      const remaining = Math.max(0, Math.min(granted, Number(r?.remaining_qty) || 0));
      // 사용량은 잔량에서 파생한다 — 잔량과 사용량을 따로 세면 둘이 갈린다(선불·후불 축이 다르기 때문).
      return { type: t.key, label: t.label, granted, used: granted - remaining, remaining };
    });
    return {
      periodMonth: String(res.rows[0].period_month || '') || null,
      available: lines.some((l) => l.granted > 0),
      lines,
    };
  } catch (err: any) {
    // ★ 2026-08-05 (Codex 2R high) 화면도 스키마 부재를 삼키지 않는다 — 삼키면 endpoint의
    //   `DB_MIGRATION_PENDING` 503 분기에 영영 닿지 못하고 "무료 없음"으로 위장된다(db_alter_safety_net).
    if (isSchemaMissing(err)) {
      warnSchemaMissing('readFreeMessagingStatus', err);
      throw new FreeMessagingSchemaPendingError();
    }
    throw err;
  }
}

/** 배분·공제의 키 = **그 달 1일 + 유형**. 달을 섞으면 한 달 몫이 다른 달에 붙는다. */
export function freeQuotaKey(periodMonth: string, msgType: string): string {
  return `${String(periodMonth).slice(0, 10)}|${String(msgType).toUpperCase()}`;
}

/** 일자(YYYY-MM-DD) → 그 달 1일. 배분 키를 만들 때만 쓴다(순수). */
export function monthStartOf(dayKey: any): string {
  const s = String(dayKey || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(0, 7)}-01` : '';
}

/**
 * 후불 발행에서 **이번에 청구 수량에서 뺄 무료 건수**를 (달 × 유형)별로 낸다. (★ 설계 §6)
 *
 * ★ 2026-08-05 (Codex 1R critical/high 3건 = 뿌리 하나) — 기준을 `used_qty`에서 **`granted_qty`**로 바꿨다.
 *   `used_qty`는 **발송 시도** 기준(실패해도 소멸·미복원)이라 후불의 **성공** 기준 청구와 축이 다르다.
 *   그 둘을 한 값으로 쓰면 무료 100건이 전량 실패해 소멸한 뒤 유료 100건이 성공했을 때 그 성공분을
 *   0원 청구한다(과소청구). 후불에는 애초에 소진 개념을 두지 않고, 청구가 보는 **성공 행에 한도를 배분**한다.
 *   ⇒ 후불 공제 = 그 달 제공량 − 이미 발행에 반영된 양, 배분 대상은 이번 발행의 성공 행뿐.
 *
 * 뒤 항이 **소비 마커**다. `billing_items.free_count`에 두므로 중간정산으로 같은 달을 두 번
 * (7/1~15 · 7/16~31) 발행해도 두 번 빠지지 않고, **발행을 지우면 함께 사라져** 자동으로 미반영으로
 * 돌아온다(별도 되돌림 로직 불필요 — LESSONS_DB 0730 080 계열).
 *
 * `client`를 주면 그 트랜잭션(회사 잠금 안)에서 읽는다 — 발행이 잠금 후 재검증에 쓴다.
 */
export async function readFreeDeductibleForBilling(
  companyId: string, startDate: string, endDate: string,
  client?: { query: (sql: string, params?: any[]) => Promise<any> },
): Promise<Record<string, number>> {
  const run = client ? client.query.bind(client) : query;
  try {
    const res = await run(
      `WITH months AS (
         SELECT DISTINCT date_trunc('month', d)::date AS m
           FROM generate_series($2::date, $3::date, interval '1 day') d
       )
       SELECT g.period_month::text AS period_month, g.msg_type,
              ${REMAINING_EXPR}::int AS deductible
         FROM free_messaging_grants g
        WHERE g.company_id = $1
          AND g.period_month IN (SELECT m FROM months)`,
      [companyId, startDate, endDate],
    );
    const out: Record<string, number> = {};
    for (const r of res.rows as any[]) {
      out[freeQuotaKey(String(r.period_month), String(r.msg_type))] = Math.max(0, Number(r.deductible) || 0);
    }
    return out;
  } catch (err: any) {
    // ★ 2026-08-05 (Codex 2R high) 청구 경로는 스키마 부재를 **삼키지 않는다.**
    //   빈 map으로 넘기면 잠금 전후 지문이 똑같이 `{}`라 대조를 통과하고, 무료 공제 없이 전액이 청구된다
    //   — 고객에게 틀린 금액이 나가는 것이라 발행을 멈추는 쪽이 맞다(FEATURE-BILLING §2-1).
    if (isSchemaMissing(err)) {
      warnSchemaMissing('readFreeDeductibleForBilling', err);
      throw new FreeMessagingSchemaPendingError();
    }
    throw err;
  }
}

/** 공제량 지문 — 잠금 전후 값이 같은지 대조한다(원장·요금제 이력 지문과 같은 규약). */
export function freeDeductibleFingerprint(map: Record<string, number>): string {
  return Object.keys(map || {}).sort().map((k) => `${k}=${map[k]}`).join(',');
}

/**
 * (순수) 공제량을 **일자 행에 결정적으로 배분**한다.
 *
 * 일자 행의 `success`(실제 성공 건수)는 **건드리지 않는다** — 청구서 2페이지 상세는 발송결과와
 * 대조돼야 하기 때문이다. 대신 행마다 `freeCount`를 붙여 청구 수량만 `success − freeCount`로 줄인다.
 *
 * ★ 2026-08-05 키에 **그 행이 속한 달**을 넣는다(Codex 1R high). 유형만으로 묶으면 8월 몫이 7월 행에
 * 먼저 붙고, 그 `free_count`는 7월 마커로 저장돼 8월 한도에서 차감되지 않는다 — 같은 무료가 다음 달
 * 청구에서 한 번 더 빠지고 이월 금지도 깨진다.
 *
 * 배분 순서 = 이른 일자 → 유형 → 계정(같은 입력이면 항상 같은 결과). 성공 합보다 많은 한도는 남긴다.
 */
export function allocateFreeToRows<T extends { channel: string; typeKey: string; itemDate?: string | null; userId?: string | null; success?: number }>(
  rows: T[],
  deductibleByMonthType: Record<string, number>,
): Map<T, number> {
  const alloc = new Map<T, number>();
  const remaining = new Map<string, number>();
  for (const [k, v] of Object.entries(deductibleByMonthType || {})) {
    remaining.set(k, Math.max(0, Math.floor(Number(v) || 0)));
  }
  if (remaining.size === 0) return alloc;

  const keyOf = (r: T) => freeQuotaKey(monthStartOf(r.itemDate), String(r.typeKey));

  const targets = (rows || [])
    .filter((r) => r.channel === 'web'
      && FREE_TYPE_KEYS.has(String(r.typeKey).toUpperCase())
      && remaining.has(keyOf(r))
      && (Number(r.success) || 0) > 0)
    .sort((a, b) =>
      String(a.itemDate || '').localeCompare(String(b.itemDate || ''))
      || String(a.typeKey).localeCompare(String(b.typeKey))
      || String(a.userId || '').localeCompare(String(b.userId || '')));

  for (const r of targets) {
    const key = keyOf(r);
    const left = remaining.get(key) || 0;
    if (left <= 0) continue;
    const take = Math.min(left, Math.floor(Number(r.success) || 0));
    if (take <= 0) continue;
    alloc.set(r, take);
    remaining.set(key, left - take);
  }
  return alloc;
}

/** 요금제별 제공 수량(요금제 비교 카드) — `plans` 행 파생. 프론트 하드코딩 금지의 근거가 이 함수다. */
export async function readPlanFreeQuotas(): Promise<Record<string, Record<string, number>>> {
  const cols = FREE_MESSAGING_TYPES.map((t) => `COALESCE(p.${t.planColumn}, 0) AS "${t.key}"`).join(', ');
  try {
    const res = await query(`SELECT p.plan_code, ${cols} FROM plans p WHERE p.is_active = true`);
    const out: Record<string, Record<string, number>> = {};
    for (const row of res.rows as any[]) {
      const per: Record<string, number> = {};
      for (const t of FREE_MESSAGING_TYPES) per[t.key] = Math.max(0, Number(row[t.key]) || 0);
      out[String(row.plan_code)] = per;
    }
    return out;
  } catch (err: any) {
    if (isSchemaMissing(err)) {
      warnSchemaMissing('readPlanFreeQuotas', err);
      return {};
    }
    throw err;
  }
}

// ════════════════════════════════════════════════════════════
// 지급
// ════════════════════════════════════════════════════════════

/**
 * 당월분 지급 — **멱등**. 매월 1일 워커와 프로세스 기동 보충이 같은 함수를 부른다.
 *
 * 대상 = `plans`의 그 유형 무료 수량이 0보다 큰 요금제를 쓰는 회사 전부.
 * `plan_code` 분기가 없다 — 유료 5종과 STAFF(임직원, 실측 테스트용 ENTERPRISE 동일 수량)가 자연히 들어오고
 * FREE·TRIAL은 수량이 0이라 자연히 빠진다. **판정의 전부가 `plans` 시드값**이다.
 *
 * 해지·정지 회사가 섞여도 무해하다 — 발송이 막힌 상태면 소진도 없고, 이월이 없어 월말에 사라진다.
 */
export async function grantFreeMessagingForCurrentMonth(): Promise<{ granted: number; skipped: boolean }> {
  let inserted = 0;
  for (const t of FREE_MESSAGING_TYPES) {
    try {
      const res = await query(
        `INSERT INTO free_messaging_grants
           (company_id, period_month, msg_type, granted_qty, used_qty, plan_id, plan_code, unit_value)
         SELECT c.id, ${KST_PERIOD_MONTH_SQL}, $1, COALESCE(p.${t.planColumn}, 0), 0, p.id, p.plan_code, $2
           FROM companies c
           JOIN plans p ON p.id = c.plan_id
          WHERE COALESCE(p.${t.planColumn}, 0) > 0
         ON CONFLICT (company_id, period_month, msg_type) DO NOTHING`,
        [t.key, t.unitValue],
      );
      inserted += res.rowCount || 0;
    } catch (err: any) {
      if (isSchemaMissing(err)) {
        warnSchemaMissing('grantFreeMessagingForCurrentMonth', err);
        return { granted: inserted, skipped: true };
      }
      throw err;
    }
  }
  return { granted: inserted, skipped: false };
}

/**
 * 한 회사에 당월분을 즉시 지급 — 월 중 신규 유료 전환 경로(설계 §4 "전환 즉시 그 달치 전액").
 * 같은 달 재지급은 UNIQUE가 막으므로 강등 후 재승급으로 두 번 받는 경로가 없다.
 *
 * 요금제 변경 트랜잭션을 막지 않도록 **자체 커넥션**으로 돈다(지급 실패가 플랜 변경을 되돌리면 안 된다).
 */
export async function grantFreeMessagingForCompany(companyId: string): Promise<number> {
  let inserted = 0;
  const client = await pool.connect();
  try {
    for (const t of FREE_MESSAGING_TYPES) {
      const res = await client.query(
        `INSERT INTO free_messaging_grants
           (company_id, period_month, msg_type, granted_qty, used_qty, plan_id, plan_code, unit_value)
         SELECT c.id, ${KST_PERIOD_MONTH_SQL}, $2, COALESCE(p.${t.planColumn}, 0), 0, p.id, p.plan_code, $3
           FROM companies c
           JOIN plans p ON p.id = c.plan_id
          WHERE c.id = $1 AND COALESCE(p.${t.planColumn}, 0) > 0
         ON CONFLICT (company_id, period_month, msg_type) DO NOTHING`,
        [companyId, t.key, t.unitValue],
      );
      inserted += res.rowCount || 0;
    }
    return inserted;
  } catch (err: any) {
    if (isSchemaMissing(err)) {
      warnSchemaMissing('grantFreeMessagingForCompany', err);
      return inserted;
    }
    console.error(`[무료메시징][지급실패] company=${companyId}:`, err?.message || err);
    return inserted;
  } finally {
    client.release();
  }
}
