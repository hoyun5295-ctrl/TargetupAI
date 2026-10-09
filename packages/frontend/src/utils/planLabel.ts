/**
 * ★ CT: 요금제 표시 라벨 (2026-07-28)
 *
 * 슈퍼관리자 요금제 선택 드롭다운이 오래도록 `요금제명 (고객 수)`를 보여 줬다.
 * 관리 가능 DB 수량은 이미 폐기된 축이라 요금제를 고르는 자리에 맞지 않는다 —
 * 요금제를 고르는 기준은 **월정액**이다.
 *
 * 0원 요금제(미가입·무료체험·임직원)는 **이름만** 적는다.
 * `(월 0원)`은 "요금이 아직 안 정해졌다"로 읽히고, `(무료)`는 `무료체험 (무료)`처럼 겹쳐 읽힌다.
 * 값이 없다는 것 자체가 정보이므로 붙이지 않는 쪽이 목록을 훑을 때 더 빨리 갈린다.
 *
 * 표시 경로가 둘 이상(고객사 추가·고객사 수정)이라 여기 한 곳에서만 만든다 —
 * 화면마다 따로 조립하면 같은 요금제가 화면마다 다르게 보인다.
 */
/**
 * 고객이 **선택할 수 없는 내부 요금제** 코드.
 *
 * ★ 2026-07-28 신설. `임직원(STAFF)`을 만들자마자 고객용 요금제 안내에 그대로 노출됐다 —
 *   그 화면은 `FREE`·`TRIAL`만 이름으로 걸러내고 있었고, 새 코드는 아무도 안 막았다.
 *   요금제가 늘 때마다 화면마다 코드를 덧붙이는 구조라 같은 사고가 반복된다. 여기 한 곳에 모은다.
 *
 *   · FREE  = 요금제 미가입 상태(선택 대상 아님)
 *   · TRIAL = 슈퍼관리자가 부여하는 체험(신청 대상 아님)
 *   · STAFF = 임직원 전용(대외 판매 상품이 아님)
 */
export const INTERNAL_PLAN_CODES = ['FREE', 'TRIAL', 'STAFF'] as const;

/** 고객용 요금제 목록에 노출해도 되는가(내부 요금제 제외 + 활성). */
export function isCustomerSelectablePlan(
  planCode: string | null | undefined,
  isActive?: boolean,
): boolean {
  if (isActive === false) return false;
  return !INTERNAL_PLAN_CODES.includes(String(planCode || '').toUpperCase() as any);
}

export function formatPlanOptionLabel(
  planName: string | null | undefined,
  monthlyPrice: number | string | null | undefined,
): string {
  const name = String(planName ?? '').trim() || '(이름 없음)';
  const price = Number(monthlyPrice);
  if (!Number.isFinite(price) || price <= 0) return name;
  return `${name} (월 ${price.toLocaleString()}원)`;
}

/**
 * ★ 2026-10-09 무료체험 남은 날(D-n) — 고객사 목록 · 상세 설정 창이 같은 셈을 쓴다(지났으면 0 · 만료일 없으면 null).
 */
export function trialDaysLeft(expiresAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - now) / 86400000));
}

/**
 * ★ 2026-10-09 고객사 목록의 요금 구분(슈퍼관리자 · 목업 v2 「요금제」 거르기 · 숫자 카드).
 *
 * 체험 판정 = 서버 강등 워커와 같은 두 축(utils/trial-downgrade-worker.ts TRIAL_DOWNGRADE_TARGET_WHERE):
 *   plan_code 'TRIAL' 이거나 subscription_status 'trial' + 만료일 있음. 만료일 없는 'trial' 은 판정 근거가 없어 체험으로 세지 않는다.
 * none = 미가입(FREE · 요금제 없음) · internal = 임직원(STAFF) · paid = 그 밖(판매 요금제).
 */
export type CompanyPlanState = 'trial' | 'paid' | 'none' | 'internal';

export function companyPlanState(c: {
  plan_code?: string | null;
  subscription_status?: string | null;
  trial_expires_at?: string | null;
}): CompanyPlanState {
  const code = String(c.plan_code || '').toUpperCase();
  if (code === 'TRIAL' || (c.subscription_status === 'trial' && !!c.trial_expires_at)) return 'trial';
  if (!code || code === 'FREE') return 'none';
  if (code === 'STAFF') return 'internal';
  return 'paid';
}
