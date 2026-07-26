/**
 * plan-proration.ts — 요금제 일할계산 컨트롤타워 (★ 2026-07-26 신설)
 *
 * Harold 정의 청구서 항목 ① = **요금제(구독) 이용요금, 플랜 × 적용기간, 변경 시 일할 계산**.
 * 지금 청구서에는 이 항목 자체가 없다 — 5항목 중 1번이 통째로 빠져 있었다.
 *
 * 입력은 `company_plan_changes`(2026-07-25 신설, 기준선 141행)다.
 * 그 전에는 `companies.plan_id`를 덮어쓰기만 해서 **언제 바꿨는지가 어디에도 안 남았고**,
 * 일할계산의 전제 자체가 없었다.
 *
 * ★ 확정 규칙 (Harold 2026-07-26)
 *   - **변경일 당일은 새 요금제**다. 7/10에 올렸으면 7/10 하루도 새 요금제로 센다.
 *   - 같은 날 두 번 바뀌면 그 날은 **마지막 요금제**가 갖는다(위 규칙의 자연스러운 귀결).
 *   - 일할 분모는 **그 달의 실제 일수**(28~31). 30일 고정으로 하면 2월에 과청구가 된다.
 *   - 청구 기간에 걸친 달의 구독료를 그 청구서에 담는다.
 *
 * 구현은 날짜를 하루씩 훑어 같은 (플랜, 달)끼리 묶는다. 기간이 1년이어도 366번이라 값이 싸고,
 * 월 경계·변경일·같은 날 두 번 변경이 전부 같은 한 줄로 처리돼 특수 케이스가 생기지 않는다.
 * 돈 산식에서 특수 케이스는 곧 사고다.
 */

import pool from '../config/database';

/** `company_plan_changes` 한 행 중 일할계산에 쓰는 부분 */
export interface PlanChangeRow {
  effective_date: string | Date;
  to_plan_code: string;
  to_monthly_price: any;
}

/** 청구서에 한 줄로 나가는 요금제 구간 */
export interface PlanSegment {
  planCode: string;
  monthlyPrice: number;
  /** YYYY-MM-DD (포함) */
  from: string;
  /** YYYY-MM-DD (포함) */
  to: string;
  days: number;
  /** 그 달의 실제 일수 — 일할 분모 */
  monthDays: number;
  amount: number;
}

/** (순수) YYYY-MM-DD → UTC 자정 Date. TZ 영향을 받지 않게 UTC로만 다룬다. */
function toUtcDay(v: string | Date): Date | null {
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  const s = String(v || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** (순수) 어떤 날짜 표현이든 `YYYY-MM-DD`로. 못 읽으면 null — 추측해서 날짜를 만들지 않는다. */
function normDay(v: any): string | null {
  const d = toUtcDay(v);
  return d ? dayKey(d) : null;
}

/** (순수) `YYYY-MM-DD`를 하루 단위로 옮긴다. 월·연 경계는 Date가 처리한다. */
export function shiftDayKey(day: string, delta: number): string {
  const d = toUtcDay(day);
  if (!d) return String(day || '');
  d.setUTCDate(d.getUTCDate() + delta);
  return dayKey(d);
}

/** (순수) 두 날짜(양끝 포함) 사이 일수 */
export function daySpan(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

/** (순수) 그 달의 일수 */
export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * (순수) 월정액을 일할로 나눈다. `월정액 × 구간일수 ÷ 그 달 일수`, 원 단위 반올림.
 * 반올림을 구간마다 하므로 구간이 여럿이면 합이 월정액과 몇 원 다를 수 있다 —
 * 그건 일할계산의 성질이지 결함이 아니다. 숨기지 않고 그대로 청구한다.
 */
export function prorateMonthlyAmount(monthlyPrice: number, days: number, monthDays: number): number {
  const p = Number(monthlyPrice) || 0;
  if (!Number.isFinite(p) || p === 0) return 0;
  if (!monthDays || monthDays <= 0) return 0;
  return Math.round((p * days) / monthDays);
}

/**
 * (순수) 그 날짜에 적용되는 요금제. **변경일 당일은 새 요금제**이므로 `effective_date <= day` 중 마지막이다.
 * 같은 날 두 번 바뀌면 배열 뒤쪽(나중 기록)이 이긴다.
 */
function planAt(sorted: Array<{ day: string; code: string; price: number }>, day: string): { code: string; price: number } | null {
  let found: { code: string; price: number } | null = null;
  for (const c of sorted) {
    if (c.day <= day) found = { code: c.code, price: c.price };
    else break;
  }
  return found;
}

/**
 * 청구 기간을 요금제 구간으로 끊는다.
 *
 * 기간 시작 이전의 마지막 변경이 시작 시점 플랜을 정하므로, **호출부는 기간 이전 이력까지 넘겨야 한다.**
 * 기간 안 이력만 넘기면 그 달 초의 플랜을 모른 채 시작해 구간이 통째로 빈다.
 *
 * 이력이 하나도 없으면 빈 배열이다 — 요금제 항목을 청구하지 않는다(추측해서 금액을 만들지 않는다).
 */
export function buildPlanSegments(changes: PlanChangeRow[], periodStart: string, periodEnd: string): PlanSegment[] {
  const start = toUtcDay(periodStart);
  const end = toUtcDay(periodEnd);
  if (!start || !end || start > end) return [];

  const sorted = (changes || [])
    .map((c) => ({
      day: dayKey(toUtcDay(c.effective_date) || new Date(0)),
      code: String(c.to_plan_code || ''),
      price: Number(c.to_monthly_price) || 0,
    }))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.day))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length === 0) return [];

  const segments: PlanSegment[] = [];
  let cur: { code: string; price: number; month: string; from: string; to: string } | null = null;

  const flush = () => {
    if (!cur) return;
    const [y, m] = cur.month.split('-').map(Number);
    const md = daysInMonth(y, m);
    const days = daySpan(cur.from, cur.to);
    segments.push({
      planCode: cur.code, monthlyPrice: cur.price,
      from: cur.from, to: cur.to, days, monthDays: md,
      amount: prorateMonthlyAmount(cur.price, days, md),
    });
    cur = null;
  };

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = dayKey(d);
    const plan = planAt(sorted, key);
    if (!plan) { flush(); continue; }          // 이력 시작 전 날짜는 청구하지 않는다
    const month = key.slice(0, 7);
    // 플랜이 바뀌거나 달이 바뀌면 구간을 끊는다 — 일할 분모가 달마다 다르기 때문이다
    if (cur && cur.code === plan.code && cur.price === plan.price && cur.month === month) {
      cur.to = key;
    } else {
      flush();
      cur = { code: plan.code, price: plan.price, month, from: key, to: key };
    }
  }
  flush();
  return segments;
}

/**
 * 요금제 이력을 읽는다. **기간 종료일까지의 전 이력**을 가져온다 —
 * 기간 이전의 마지막 변경이 시작 시점 플랜을 정하므로, 기간 안 이력만 읽으면 그 달이 통째로 빈다.
 *
 * 정렬은 `effective_date` → `changed_at`이다. 같은 날 두 번 바뀐 경우 나중 기록이 뒤에 와야
 * "그 날은 마지막 요금제" 규칙이 성립한다.
 */
export async function loadPlanChanges(companyId: string, periodEnd: string, db: any = pool): Promise<PlanChangeRow[]> {
  const res = await db.query(
    `SELECT effective_date, to_plan_code, to_monthly_price
       FROM company_plan_changes
      WHERE company_id = $1::uuid AND effective_date <= $2::date
      ORDER BY effective_date ASC, changed_at ASC`,
    [companyId, periodEnd],
  );
  return res.rows as PlanChangeRow[];
}

/**
 * 회사의 **전 기간** 요금제 이력 건수. 기간 조건이 없다는 것이 요점이다.
 *
 * ★ 2026-07-26 Codex 7차 — "이력 0건"이 정상인지 손상인지는 기간 안 이력만 봐선 알 수 없다.
 *   8/1에 처음 플랜을 배정한 회사의 7월 청구서는 기간 안 이력이 0건이지만 **전 기간 이력은 1건**이라
 *   "7월엔 요금제가 없었다"가 사실로 확인된다. 반대로 전 기간 이력이 0건인데 `plan_id`가 있으면
 *   그건 설명되지 않는 상태(손상)이고, 그대로 발행하면 구독료가 조용히 빠진다.
 */
export async function countPlanChanges(companyId: string, db: any = pool): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM company_plan_changes WHERE company_id = $1::uuid`,
    [companyId],
  );
  return Number(res.rows[0]?.n) || 0;
}

/**
 * (순수) 이 청구 기간의 요금제 이력 지문.
 *
 * ★ 2026-07-26 Codex 7차 — 요금제 구간은 무거운 집계와 함께 **트랜잭션 밖**에서 계산된다.
 *   그 사이 `recordPlanChange`가 이 기간에 걸리는 변경을 넣으면(호출부가 `effectiveDate`를 과거로 줄 수 있다)
 *   우리가 든 구간은 낡은 값이 된다. 원장 지문은 그걸 못 잡는다 —
 *   `plan_id`를 지문에 넣었더니 **무관한 다음 달 변경까지** 막아서 되돌렸기 때문이다(6차 ②).
 *   그래서 기간에 실제로 걸리는 이력만으로 지문을 만든다: 이 기간 금액을 바꾸는 변경만 잡고,
 *   기간 밖(예: 8/1 적용) 변경은 애초에 목록에 없어 걸리지 않는다.
 */
export function planChangesFingerprint(changes: PlanChangeRow[]): string {
  return JSON.stringify((changes || []).map((c) => [
    String(c.effective_date || '').slice(0, 10),
    String(c.to_plan_code || ''),
    String(Number(c.to_monthly_price) || 0),
  ]));
}

/** (순수) 구간 합계 — 청구서 요금제 항목의 금액 */
export function sumPlanSegments(segments: PlanSegment[]): number {
  return (segments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

// ============================================================
//  이력 공백 검사 (★ 2026-07-26 Codex 3차 HIGH 수용)
// ============================================================

/** 청구 기간 중 요금제 이력이 덮지 못한 구간 */
export interface PlanCoverageGap {
  /** YYYY-MM-DD (포함) */
  from: string;
  /** YYYY-MM-DD (포함) */
  to: string;
  days: number;
  /**
   * 공백의 종류 — **차단 여부를 가르는 축이다.**
   * - `head`: 첫 이력 **이전** 구간. "그 기간엔 요금제가 없었다"는 정상 상태다(기간 중 최초 배정·플랜 미지정 회사).
   * - `internal`·`trailing`: 이력이 시작됐다가 끊긴 것. 구조상 생길 수 없으므로 생기면 이력 손상이다 → 차단.
   */
  kind: 'head' | 'internal' | 'trailing';
}

/**
 * (순수) 청구 기간에서 요금제 이력이 **덮지 못한 첫 구간**. 없으면 null.
 *
 * ★ 신설 사유 — `segments.length === 0`만 보는 게이트는 반쪽이다.
 *   `buildPlanSegments`는 첫 이력 이전 날짜를 그냥 건너뛴다(그 날의 플랜을 모르니 추측하지 않는다).
 *   그래서 회사의 최초 이력이 기간 중간(예: 7/15)이면 구간이 7/15~7/31만 생기고 **7/1~14 구독료가
 *   조용히 빠진다.** 배열이 비지 않았으므로 옛 게이트는 통과하고, 금액 검사 3중은 빠진 값을 기준으로
 *   전부 성립한다 — 이번에 고치려는 `both` 17사 누락과 같은 모양이다.
 *
 * @param coverFrom 이력이 덮어야 하는 첫 날. **회사 생성일**을 넘긴다 —
 *   기준선 141행이 `effective_date = companies.created_at::date`로 들어갔으므로(SCHEMA.md),
 *   회사가 생기기 전 날짜까지 이력을 요구하면 월 중간에 계약한 회사가 전부 막힌다.
 *
 * 앞·중간·뒤 공백을 모두 찾고 `kind`로 구분한다. 지금 구조에선 앞 공백만 생기지만,
 * 구간 생성 규칙이 바뀌었을 때 조용히 새 공백이 생기는 쪽이 더 위험하다.
 */
export function findPlanCoverageGap(
  segments: PlanSegment[],
  periodStart: string,
  periodEnd: string,
  coverFrom?: string | null,
): PlanCoverageGap | null {
  const ps = normDay(periodStart);
  const pe = normDay(periodEnd);
  if (!ps || !pe || ps > pe) return null;

  const cf = coverFrom ? normDay(coverFrom) : null;
  // 기간 시작보다 늦게 생긴 회사는 그 날부터만 요구한다. 기간이 끝난 뒤 생긴 회사는 검사 대상이 아니다.
  let cursor = cf && cf > ps ? cf : ps;
  if (cursor > pe) return null;

  const sorted = (segments || [])
    .map((s) => ({ from: normDay(s.from), to: normDay(s.to) }))
    .filter((s): s is { from: string; to: string } => !!s.from && !!s.to)
    .sort((a, b) => a.from.localeCompare(b.from));

  let covered = false;   // 이력이 한 번이라도 이 기간을 덮기 시작했는가 — 앞 공백과 중간 공백을 가르는 축
  for (const s of sorted) {
    if (s.to < cursor) { covered = true; continue; }   // 이미 지난 구간(기간 이전 이력)
    if (s.from > cursor) {
      const to = shiftDayKey(s.from, -1);
      return { from: cursor, to, days: daySpan(cursor, to), kind: covered ? 'internal' : 'head' };
    }
    covered = true;
    cursor = shiftDayKey(s.to, 1);
    if (cursor > pe) return null;
  }
  return { from: cursor, to: pe, days: daySpan(cursor, pe), kind: covered ? 'trailing' : 'head' };
}

export interface PlanHistoryGate {
  /** 발행해도 되는가 — **이력 손상(중간·뒤 공백)일 때만** false */
  ok: boolean;
  gap: PlanCoverageGap | null;
  /** 이력이 덮어야 했던 첫 날 */
  coverFrom: string;
  /** 판정 근거가 된 월정액(현재 플랜과 구간 중 최댓값) */
  monthlyPrice: number;
  /**
   * 요금제 없이 지나간 구간이 있는가(앞 공백). 차단하지 않지만 **응답·로그로 드러낸다** —
   * 기간 중 최초 배정·플랜 미지정이면 정상이고, 그 외라면 사람이 봐야 할 신호다.
   */
  uncoveredHead: PlanCoverageGap | null;
  /** 차단 사유 — `history_damaged`(끊긴 이력) / `history_absent`(플랜은 있는데 이력 0건) */
  blockReason: 'history_damaged' | 'history_absent' | null;
}

/**
 * (순수) 요금제 이력 공백을 **발행 차단 판정**으로 바꾼다. `/generate`와 `/preview`가 같이 쓴다.
 *
 * ★ 2026-07-26 Codex 4차 수용 — **공백은 월정액과 무관하게 막는다.**
 *   처음에는 "현재·알려진 구간이 전부 무료면 통과"로 짰는데, 공백은 "무료였음"의 증거가 아니라
 *   **그 구간 플랜을 모른다**는 뜻이다. 7/1~14 BASIC 이력이 유실되고 7/15~ FREE만 남은 회사면
 *   옛 판정은 통과시키고 BASIC 14일치가 조용히 0원이 된다 — 이 게이트가 막으려던 바로 그 모양이다.
 *
 * ★ 2026-07-26 Codex 6차 수용 — 판정 축을 **공백의 종류**로 바꿨다(현재 `plan_id`로 판정하는 방식 폐기).
 *   5차 수정은 `planAssigned`(지금 플랜이 있는가)를 "그 기간에 요금제를 썼는가"로 썼는데, 그 둘은 다르다.
 *   그래서 **7/15에 처음 플랜을 배정받은 회사**(7/1~14은 요금제 없음이 정상)와
 *   **8/1에 처음 배정하고 7월분을 뽑는 회사**(7월 이력 0)가 전부 차단됐다 — 정상 발행을 막았다.
 *
 *   올바른 축: 첫 이력 **이전** 공백(`head`)은 "그때는 요금제가 없었다"는 사실이고, 이력 유실이 아니다.
 *   `recordPlanChange`가 `plan_id` UPDATE와 **같은 트랜잭션·회사별 advisory lock**으로만 기록되고
 *   기준선 141행이 `created_at`부터 덮으므로(SCHEMA.md), 이력이 중간에 끊기는 일은 구조적으로 없다.
 *   그러니 끊긴 흔적(`internal`·`trailing`)만 손상으로 보고 막는다.
 *   앞 공백은 막지 않되 `uncoveredHead`로 응답·로그에 드러낸다 — 금액에 영향 없는 것으로 발행을 막지 않는다.
 */
export function evaluatePlanHistoryGate(opts: {
  segments: PlanSegment[];
  billingStart: string;
  billingEnd: string;
  /** `companies.created_at`을 `toDayKey`로 자른 값 */
  companyCreatedDay?: string | null;
  /** 현재 플랜 월정액(`plans.monthly_price`) — 판정에는 쓰지 않는다(응답 참고값) */
  monthlyPrice: number;
  /** `companies.plan_id`가 있는가 */
  planAssigned?: boolean;
  /** 그 회사의 **전 기간** 이력 건수(`countPlanChanges`). 기간 안 건수가 아니다 */
  historyTotal?: number;
}): PlanHistoryGate {
  const { segments, billingStart, billingEnd, companyCreatedDay } = opts;
  const coverFrom = normDay(companyCreatedDay) && normDay(companyCreatedDay)! > (normDay(billingStart) || '')
    ? normDay(companyCreatedDay)!
    : (normDay(billingStart) || String(billingStart || ''));
  const gap = findPlanCoverageGap(segments, billingStart, billingEnd, companyCreatedDay);
  const monthlyPrice = Math.max(
    Number(opts.monthlyPrice) || 0,
    ...(segments || []).map((s) => Number(s.monthlyPrice) || 0),
    0,
  );
  // 손상(중간·뒤 공백)은 막는다. 앞 공백은 사실이므로 통과시키고 따로 실어 보낸다.
  const damaged = !!gap && gap.kind !== 'head';
  // ★ 2026-07-26 Codex 7차 — 앞 공백을 그냥 통과시키면 "플랜은 있는데 이력이 통째로 없는" 회사의
  //   구독료가 조용히 빠진다. 전 기간 이력이 0건인데 플랜이 배정돼 있으면 설명되지 않는 상태다.
  //   (8/1 최초 배정 회사의 7월분은 기간 안 이력만 0건이고 전 기간 이력은 1건이라 여기 걸리지 않는다.)
  const historyAbsent = Boolean(opts.planAssigned) && (opts.historyTotal ?? 0) === 0;
  const blockReason: PlanHistoryGate['blockReason'] = damaged
    ? 'history_damaged'
    : historyAbsent ? 'history_absent' : null;
  return {
    ok: !blockReason,
    gap: damaged ? gap : null,
    coverFrom,
    monthlyPrice,
    uncoveredHead: gap && gap.kind === 'head' ? gap : null,
    blockReason,
  };
}

// ============================================================
//  크레딧 일할 (★ Harold 지시 2026-07-26)
// ============================================================

/**
 * (순수) 그 달의 **크레딧 권리**를 구간별 일할로 재계산한다.
 *
 * Harold 지시 두 갈래를 하나의 산식으로 합친 것이다.
 *   - 올릴 때: "일할계산해서 추가 크레딧을 자동으로 지급해야 하잖아?"
 *   - 내릴 때: "다운그레이드하려는 요금제 미만의 크레딧이 남아 있다면 이미 다 써버리고 내린 것 아니냐"
 *
 * 방향별로 다른 규칙을 두면 내릴 때 이득이 되는 구조가 남는다 —
 * PRO 크레딧을 열흘에 다 쓰고 BASIC으로 내리면 열흘치 요금만 내고 한 달치 크레딧을 가져간다.
 * 그래서 **권리를 일할로 다시 계산하고 이미 부여된 양과의 차이를 반영**한다. 올림/내림이 같은 식이 된다.
 *
 * 결과가 음수여도 자르지 않는다. `base`가 음수로 남는 구조는 이미 있고
 * (다음 달 리셋이 `min(0, 지난 base)`로 상계, 후불이면 초과분으로 청구),
 * 0에서 자르면 다 쓰고 내리는 게 이득이 되는 구조가 그대로 남는다.
 */
export function prorateMonthlyCredits(
  segments: Array<{ planCredits: number; days: number; monthDays: number }>,
): number {
  return (segments || []).reduce((s, x) => {
    const c = Number(x.planCredits) || 0;
    if (!x.monthDays || x.monthDays <= 0) return s;
    return s + (c * (Number(x.days) || 0)) / x.monthDays;
  }, 0);
}

export interface CreditEntitlementAdjust {
  /** 일할로 재계산한 그 달의 권리 */
  entitlement: number;
  /** 이 달에 이미 부여된 양(리셋 grant + 앞선 일할 조정) */
  granted: number;
  /** base에 더할 값. 음수면 회수 방향 */
  adjustment: number;
}

/**
 * (순수) 부여할(또는 회수할) 크레딧 조정량.
 * 반올림은 마지막 한 번만 한다 — 구간마다 반올림하면 조정이 몇 크레딧씩 흔들린다.
 */
export function buildCreditAdjustment(entitlementRaw: number, grantedThisMonth: number): CreditEntitlementAdjust {
  const entitlement = Math.round(Number(entitlementRaw) || 0);
  const granted = Math.round(Number(grantedThisMonth) || 0);
  return { entitlement, granted, adjustment: entitlement - granted };
}
