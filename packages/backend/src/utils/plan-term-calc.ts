/**
 * plan-term-calc.ts — 선불 요금제 이용 기간 순수 계산 (★2026-10-04 신설)
 *
 * 설계 = docs/2026-10-04-prepaid-plan-term-design.md §3. DB를 모른다 — 날짜는 전부 'YYYY-MM-DD' 문자열이다
 * (DATE 칸을 JS Date로 읽으면 서버 시간대에 따라 하루 밀린다 · 회의론자 최종 #11).
 *
 * 날짜별로 "어떤 요금제를 얼마에 샀는가"는 원장(company_plan_term_events의 covers)이 정한다.
 * 내림 예약에 적용일 칸을 두지 않는 이유가 이것이다 — 적용일 하나로는 "미리 연장 뒤 두 번째 내림"이 첫 예약을 덮는다.
 */

import { floorWon, vatOfSupply } from './money';
import { daysInMonth, daySpan, shiftDayKey } from './plan-proration';

/** 원장 한 행 중 계산에 쓰는 부분 */
export interface TermEvent {
  term_version: number;
  event_type: string;
  plan_id: string | null;
  monthly_price: number | string | null;
  covers_from: string | null;
  covers_to: string | null;
  /** upgrade 행은 { sets_plan: boolean } — 오늘 plan_id를 실제로 바꿨는지(정렬 가드 기준 · Codex 2R high) */
  detail?: any;
}

/** 날짜 구간을 덮는 이벤트 — 그날의 요금제·가격을 정한다 */
export const COVERING_EVENT_TYPES = ['start', 'first_charge', 'renew', 'extend', 'restore', 'upgrade', 'admin_adjust'] as const;
/** 돈을 내고 1개월을 산 이벤트 — 그 구간 일수가 일할 분모다 */
export const PURCHASE_EVENT_TYPES = ['first_charge', 'renew', 'extend', 'restore'] as const;
/** companies.plan_id를 정한 이벤트 — 정렬 가드의 기준(회의론자 최종 #6) */
export const PLAN_SETTER_EVENT_TYPES = ['start', 'first_charge', 'restore', 'upgrade', 'align'] as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** (순수) 엄격한 날짜 문자열인가 — 2026-13-01 같은 값은 거른다 */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !YMD.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * (순수) 1개월의 마지막 날(D1). 다음 달에 시작일과 같은 날이 있으면 그날 −1일, 없으면 다음 달 말일.
 * 10/4 → 11/3 · 1/31 → 2/28 · 12/31 → 1/30. 다음 구간 시작 = 만료 + 1일.
 * ⚠ PG의 `+ interval '1 month' − 1 day`는 1/31을 2/27로 만든다 — 그래서 여기서 계산한다.
 */
export function periodEnd(start: string): string | null {
  if (!isYmd(start)) return null;
  const [y, m, d] = start.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const nextMonthDays = daysInMonth(ny, nm);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d <= nextMonthDays) return shiftDayKey(`${ny}-${pad(nm)}-${pad(d)}`, -1);
  return `${ny}-${pad(nm)}-${pad(nextMonthDays)}`;
}

/** (순수) 1개월 금액. 월정액은 부가세 별도(unit-price.ts ⑤)이고 선불 잔액은 부가세 포함가로 깎는다(D6). */
export function monthlyCharge(monthlyPrice: number | string | null | undefined): { supply: number; vat: number; total: number } {
  const supply = floorWon(monthlyPrice);
  const vat = vatOfSupply(supply);
  return { supply, vat, total: supply + vat };
}

function covers(e: TermEvent, day: string): boolean {
  return !!e.covers_from && !!e.covers_to && e.covers_from <= day && day <= e.covers_to;
}

function latest(events: TermEvent[], day: string, types: readonly string[]): TermEvent | null {
  let found: TermEvent | null = null;
  for (const e of events) {
    if (!types.includes(e.event_type) || !covers(e, day)) continue;
    if (!found || e.term_version > found.term_version) found = e;
  }
  return found;
}

/** (순수) 그날의 요금제·가격 = 그날을 덮는 이벤트 중 회차 최대 행. 덮는 행이 없으면 null */
export function planOfDay(events: TermEvent[], day: string): { planId: string | null; price: number } | null {
  const e = latest(events, day, COVERING_EVENT_TYPES);
  return e ? { planId: e.plan_id, price: Number(e.monthly_price) || 0 } : null;
}

/** (순수) 그날의 일할 분모 = 그날을 산 구매 구간 일수. 구매가 아닌 구간(start·admin_adjust)은 그 달 실제 일수 */
export function denomOfDay(events: TermEvent[], day: string): number {
  const p = latest(events, day, PURCHASE_EVENT_TYPES);
  if (p && p.covers_from && p.covers_to) return daySpan(p.covers_from, p.covers_to);
  const [y, m] = day.split('-').map(Number);
  return daysInMonth(y, m);
}

/**
 * (순수) 올림 차액(D3). 오늘~만료일 중 **그날 요금제가 목표와 다른 날만** 센다.
 * 하루치 = max(0, 목표가 − 그날 가격) ÷ 그날 분모. 절사는 합계에서 1회(LESSONS_DB 28), 부가세는 그 위에.
 * 같은 요금제인 날을 빼는 이유: 구매 뒤 정가가 올라도 이미 그 요금제를 쓰는 날은 다시 받지 않는다(회의론자 최종 #14).
 * 덮이지 않은 날은 가격 근거가 없어 받지 않는다.
 */
export function upgradeCharge(
  events: TermEvent[], from: string, to: string, target: { planId: string; price: number | string },
): { supply: number; vat: number; total: number } {
  if (!isYmd(from) || !isYmd(to) || from > to) return { supply: 0, vat: 0, total: 0 };
  const targetPrice = Number(target.price) || 0;
  let raw = 0;
  for (let d = from; d <= to; d = shiftDayKey(d, 1)) {
    const p = planOfDay(events, d);
    if (!p || p.planId === target.planId) continue;
    const diff = targetPrice - p.price;
    if (diff > 0) raw += diff / denomOfDay(events, d);
  }
  const supply = floorWon(raw);
  const vat = vatOfSupply(supply);
  return { supply, vat, total: supply + vat };
}

/**
 * (순수) 올림이 실제로 바꾸는 날짜 구간들. **차액을 세는 날과 같은 날만** 바꾼다(Codex 1R high):
 * 그날 요금제가 목표와 다르고 그날 가격 ≤ 목표가인 날. 더 비싼 요금제로 이미 산 날은 건드리지 않는다
 * (오늘~만료일 전체를 덮으면 미리 산 비싼 구간이 싼 요금제로 바뀌고, 다시 올리면 차액을 또 받는다).
 * 연속한 날끼리 묶어 [from, to] 목록으로 돌려준다.
 */
export function upgradeRuns(
  events: TermEvent[], from: string, to: string, target: { planId: string; price: number | string },
): Array<{ from: string; to: string }> {
  if (!isYmd(from) || !isYmd(to) || from > to) return [];
  const targetPrice = Number(target.price) || 0;
  const runs: Array<{ from: string; to: string }> = [];
  for (let d = from; d <= to; d = shiftDayKey(d, 1)) {
    const p = planOfDay(events, d);
    const changes = !!p && p.planId !== target.planId && p.price <= targetPrice;
    if (!changes) continue;
    const last = runs[runs.length - 1];
    if (last && shiftDayKey(last.to, 1) === d) last.to = d;
    else runs.push({ from: d, to: d });
  }
  return runs;
}

/** 관리 기간을 끝내는 이벤트 — 그 이전 원장은 지난 관리 기간이다 */
export const TERM_ENDING_EVENT_TYPES = ['end', 'expire_free'] as const;

/**
 * (순수) 현재 관리 기간의 원장만 남긴다(Codex 1R high). 마지막 종료 이벤트 이후만.
 * 지난 기간 원장이 섞이면 관리를 끝냈다 다시 시작한 회사가 옛 요금제로 결제·정렬된다.
 * 회차 오름차순으로 넘긴다.
 */
export function currentTermEvents<T extends TermEvent>(events: T[]): T[] {
  let cut = -1;
  events.forEach((e, i) => { if ((TERM_ENDING_EVENT_TYPES as readonly string[]).includes(e.event_type)) cut = i; });
  return events.slice(cut + 1);
}

/**
 * (순수) plan_id를 **실제로** 마지막에 정한 이벤트의 요금제 — 정렬 가드 기준.
 * upgrade 는 오늘 plan_id를 바꾼 행(detail.sets_plan === true)만 센다. 미래 구간만 올린 행을 세면 가드가
 * 실제 plan_id와 어긋나 그 구간이 시작돼도 정렬이 영영 거부된다(Codex 2R high · 결제한 구간 미적용).
 */
export function lastPlanSetterPlanId(events: TermEvent[]): string | null {
  let found: TermEvent | null = null;
  for (const e of events) {
    if (!(PLAN_SETTER_EVENT_TYPES as readonly string[]).includes(e.event_type)) continue;
    if (e.event_type === 'upgrade' && e.detail?.sets_plan !== true) continue;
    if (!found || e.term_version > found.term_version) found = e;
  }
  return found ? found.plan_id : null;
}

/** (순수) 남은 날(오늘 포함). 지났으면 0 */
export function daysLeft(today: string, expiresOn: string): number {
  if (!isYmd(today) || !isYmd(expiresOn) || expiresOn < today) return 0;
  return daySpan(today, expiresOn);
}

export type SettleAction = 'none' | 'expire_free' | 'alert' | 'renew' | 'block';

/**
 * (순수) 만료 정산 판정. 순서가 계약이다(회의론자 최종 #1):
 * ① 다음 구매가 0원이면 돈을 받지 않는다 — FREE면 FREE로 끝내고, 그 밖의 0원(STAFF 등)은 손대지 않고 알린다.
 *    (자동 결제를 먼저 보면 0원 "결제"가 매달 반복되어 관리가 끝나지 않는다)
 * ② 자동 켬 + 잔액 충분 → 자동 결제 ③ 그 밖 → 잠금.
 */
export function decideSettle(s: {
  blocked: boolean; expiresOn: string; today: string; autoRenew: boolean; balance: number;
  nextPlan: { code: string | null; price: number | string };
}): SettleAction {
  if (s.blocked || !(s.expiresOn < s.today)) return 'none';
  const price = Number(s.nextPlan.price) || 0;
  if (price <= 0) return String(s.nextPlan.code || '').toUpperCase() === 'FREE' ? 'expire_free' : 'alert';
  if (s.autoRenew && Number(s.balance) >= monthlyCharge(price).total) return 'renew';
  return 'block';
}

export type PlanRequestDecision =
  | { kind: 'unhandled' }
  | { kind: 'reject'; status: number; code: string; error: string }
  | { kind: 'restore' } | { kind: 'end' } | { kind: 'upgrade' } | { kind: 'reserve' }
  | { kind: 'reserve_cancel' } | { kind: 'noop' } | { kind: 'first_charge' };

/**
 * (순수) 요금제 신청 승인 판정(설계 §5-2). 차액(upgradeTotal)은 호출부가 원장으로 계산해 넘긴다.
 */
export function decidePlanRequest(s: {
  ready: boolean; prepaid: boolean; managed: boolean; blocked: boolean; trialRequest: boolean;
  target: { id: string; code: string | null; price: number | string };
  todayPlan: { id: string | null; price: number | string };
  nextPlanId: string | null;
  upgradeTotal: number;
}): PlanRequestDecision {
  if (!s.ready || !s.prepaid) return { kind: 'unhandled' };
  const code = String(s.target.code || '').toUpperCase();
  const price = Number(s.target.price) || 0;
  const isTrial = s.trialRequest || code === 'TRIAL';
  if (!s.managed) {
    if (isTrial || price <= 0) return { kind: 'unhandled' };
    return { kind: 'first_charge' };
  }
  if (isTrial) {
    return { kind: 'reject', status: 409, code: 'PLAN_TERM_MANAGED', error: '선불 이용 기간 중인 회사에는 무료체험을 줄 수 없습니다.' };
  }
  const zeroNonFree = price <= 0 && code !== 'FREE';
  if (zeroNonFree) {
    return { kind: 'reject', status: 409, code: 'PLAN_TERM_ZERO_PLAN', error: '선불 이용 기간 중에는 이 요금제로 바꿀 수 없습니다.' };
  }
  if (s.blocked) return price > 0 ? { kind: 'restore' } : { kind: 'end' };
  const todayPrice = Number(s.todayPlan.price) || 0;
  if (s.target.id === s.todayPlan.id) {
    if (s.upgradeTotal > 0) return { kind: 'upgrade' };
    return s.nextPlanId ? { kind: 'reserve_cancel' } : { kind: 'noop' };
  }
  return price >= todayPrice ? { kind: 'upgrade' } : { kind: 'reserve' };
}
