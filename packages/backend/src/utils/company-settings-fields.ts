/**
 * CT: company-settings-fields.ts — 회사 설정 중 회사 관리자만 바꾸는 칸(★ 2026-11-07 C113 D3 · 뿌리 R2)
 *
 * 설정 화면(Settings.tsx)은 이 칸들을 `{isAdmin && (` 두 블록 안에서만 그린다. 서버도 같은 목록으로 역할을 본다:
 *   일반 사용자(담당자)의 저장 = 이 칸을 걸러낸다(값을 보내도 바뀌지 않음 · 나머지 칸은 그대로 저장).
 *   계약 시험(c113-settings-admin-1107)이 화면 블록의 칸 ⊆ 이 목록을 기계로 대조한다.
 */
export const ADMIN_ONLY_SETTINGS_FIELDS = [
  'monthly_budget',
  'send_start_hour',
  'send_end_hour',
  'holiday_send_allowed',
  'fatigue_cap_days',
  'fatigue_cap_max',
  'automarketing_exclude_journey',
  'global_holdout_pct',
  'campaign_holdout_pct',
  'send_priority_order',
] as const;

/** 일반 사용자의 저장 몸에서 관리자 전용 칸을 뺀 사본 */
export function omitAdminOnlySettings<T extends Record<string, unknown>>(body: T): Partial<T> {
  const out: Record<string, unknown> = { ...body };
  for (const k of ADMIN_ONLY_SETTINGS_FIELDS) delete out[k];
  return out as Partial<T>;
}
