/**
 * journey-start-form.ts — 작업 화면 「시작」 카드 · 확정 바의 순수 계산(★ 2026-10-20 여정 V.3 §7 · §4-1)
 *
 * JSX 없는 .ts — 백엔드 vitest 가 불러 서버 판정과 짝을 단언한다(journey-v3-workspace-1020):
 *   ENTRY_FORM_KEYS = 서버 JOURNEY_ENTRY_KEYS(인원을 다시 세는 키) · shapeOptionKeys = 서버 journeyOptionEditVerdict 의 새 모양 판정.
 * ⛔ 화면이 새로 판정하지 않는다 — 서버 판정과 같은 집합을 옮겨 두고 시험이 어긋남을 잡는다.
 */

export type OptionForm = Record<string, any>;

// 시작 사건별 진입 기준(trigger_filters 키) — 서버 normalizeJourneyOptions 가 받는 키만.
export const TIMING: Record<string, { key: string; before: string; after: string; def: number; min: number; max: number }> = {
  'customer.created': { key: 'recent_hours', before: '가입하고', after: '시간 안에 들어와요', def: 24, min: 1, max: 720 },
  'customer.dormant': { key: 'dormant_days', before: '마지막 구매 뒤', after: '일이 지나면 휴면으로 봐요', def: 30, min: 1, max: 3650 },
  'customer.birthday_approaching': { key: 'days_before', before: '생일', after: '일 전에 들어와요', def: 7, min: 0, max: 90 },
  'cdp.cart_abandon': { key: 'abandon_hours', before: '장바구니에 담고', after: '시간 동안 사지 않으면 들어와요', def: 24, min: 1, max: 168 },
};
const PURCHASE_FLOW = ['cdp.purchase', 'purchase.first', 'customer.dormant_return'];
export const STANDING_TRIGGERS = ['custom', 'customer.dormant'];

/** 시작 조건(인원을 다시 센다) — 서버 JOURNEY_ENTRY_KEYS 와 같은 집합. */
export const ENTRY_FORM_KEYS = new Set<string>([
  'customer_conditions', 'logic', 'all_customers', 'recent_hours', 'dormant_days', 'days_before', 'abandon_hours', 'points_min',
  'inactive_days', 'expiry_mode', 'expiry_month_day', 'include_existing', 'backfill_per_day', 'thresholdRecipients',
  'allowReentry', 'reentryCooldownDays',
]);

/** 켜진 여정에서 새 모양으로만 바뀌는 옵션 키(서버 journeyOptionEditVerdict · reshape options 와 같은 판정). */
export function shapeOptionKeys(status: string, diff: Record<string, any>): string[] {
  if (status !== 'active') return [];
  return Object.keys(diff).filter((k) => k === 'goalKind' || k === 'callbackNumber' || k === 'callbackMode'
    || (k === 'goalExitEnabled' && !(diff[k] === true || diff[k] === 'true')));
}

export const numOrNull = (v: any): number | null => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.floor(Number(v)));

export function formFromJourney(j: any): OptionForm {
  const tf = j?.trigger_filters || {};
  const t = TIMING[j?.trigger_event];
  const f: OptionForm = {
    customer_conditions: Array.isArray(tf.customer_conditions) ? tf.customer_conditions : [],
    logic: tf.logic === 'OR' ? 'OR' : 'AND',
    thresholdRecipients: numOrNull(j?.threshold_recipients_per_step),
    thresholdCost: numOrNull(j?.threshold_cost_per_step),
    thresholdRiskLevel: j?.threshold_risk_level || 'low',
    budgetMonthly: numOrNull(j?.budget_monthly),
    allowReentry: j?.allow_reentry === true,
    reentryCooldownDays: numOrNull(j?.reentry_cooldown_days) ?? 0,
    autoReentryEnabled: j?.auto_reentry_enabled === true,
    holdoutPct: numOrNull(j?.holdout_pct) ?? 0,
    personalSendTime: j?.personal_send_time === true,
    goalExitEnabled: j?.goal_exit_enabled === true,
    goalKind: j?.goal_kind || 'purchase',
  };
  if (t) f[t.key] = numOrNull(tf[t.key]) ?? t.def;
  // 옛 상시 여정(조건 0개 · 신호 키 없음)은 추출기가 전원으로 본다 → 화면도 「전체 고객」으로(사실과 다른 「조건 없음」을 보이지 않는다 · Codex 적대 A4 짝).
  if (j?.trigger_event === 'custom') {
    const noConds = !Array.isArray(tf.customer_conditions) || tf.customer_conditions.length === 0;
    f.all_customers = tf.all_customers === true || (noConds && !('all_customers' in tf));
  }
  if (STANDING_TRIGGERS.includes(j?.trigger_event)) f.backfill_per_day = numOrNull(tf.backfill_per_day);
  if (j?.trigger_event === 'customer.dormant') f.include_existing = tf.include_existing === true;
  if (j?.trigger_event === 'cdp.purchase') {
    f.exclude_first_purchase = tf.exclude_first_purchase === true;
    f.exclude_dormant_return = tf.exclude_dormant_return === true;
  }
  // 상품 재구매 여정은 진입 교체가 늘 켜져 있다(서버 규약 · 화면에서 끄지 않는다).
  if (PURCHASE_FLOW.includes(j?.trigger_event)) f.entry_replace = tf.entry_replace === true;
  if (j?.trigger_event === 'customer.points_expiring') {
    f.points_min = numOrNull(tf.points_min) ?? 0;
    f.expiry_mode = tf.expiry_mode === 'annual_date' ? 'annual_date' : 'inactivity';
    f.inactive_days = numOrNull(tf.inactive_days) ?? 180;
    f.expiry_month_day = tf.expiry_month_day || '';
    f.days_before = numOrNull(tf.days_before) ?? 14;
  }
  if (j?.entry_ends_ready === true) f.entryEndsOn = j.entry_ends_on || '';
  return f;
}

/** 바뀐 키만(서버로 보낼 몸통). 마지막 날 빈 값 = 비우기(null · 계속 받음). */
export function optionsDiff(initial: OptionForm, form: OptionForm): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(form)) {
    if (JSON.stringify(initial[k] ?? null) === JSON.stringify(form[k] ?? null)) continue;
    out[k] = k === 'entryEndsOn' && !form[k] ? null : form[k];
  }
  return out;
}

/**
 * 다시 읽은 서버 값 위에 「내가 고친 키」만 얹는다(★ Codex 적대 B 2R — 고친 폼을 통째로 두면 다른 사람이 바꾼 값까지 되돌릴 변경이 된다).
 *   이전 기준 대비 내가 바꾼 키 중 · 새 서버 값과 이미 같은 것(내가 저장한 값)은 버리고 · 서버도 그 키를 바꿨으면 충돌로 센다(내 값을 남긴다).
 */
export function rebaseForm(oldInitial: OptionForm, current: OptionForm, server: OptionForm): { form: OptionForm; conflicts: number } {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const form: OptionForm = { ...server };
  let conflicts = 0;
  for (const k of Object.keys(optionsDiff(oldInitial, current))) {
    if (same(current[k], server[k])) continue;
    if (!same(oldInitial[k], server[k])) conflicts += 1;
    form[k] = current[k];
  }
  return { form, conflicts };
}

/** 시작 조건만(인원 미리 세기 · 지금 고친 값 전체를 보낸다 · 서버가 지금 값 위에 얹어 센다). */
export function entryCountBody(form: OptionForm): Record<string, any> {
  const out: Record<string, any> = { dryRun: true };
  for (const k of Object.keys(form)) if (ENTRY_FORM_KEYS.has(k)) out[k] = form[k];
  return out;
}

/** 값을 다 채우지 않은 조건 줄이 있는가(그동안은 세지 않는다 · 빈 값은 서버가 거절한다). */
export function hasIncompleteCondition(form: OptionForm): boolean {
  return (form.customer_conditions || []).some((c: any) => !Array.isArray(c?.value) && String(c?.value ?? '').trim() === '' && c?.op !== 'is_null' && c?.op !== 'not_null');
}
