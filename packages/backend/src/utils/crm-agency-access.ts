// ============================================================
// crm-agency-access.ts — 캠페인 대행: 상태 전이 + 고객 제안서 접근 판정 (순수 CT, DB import 0)
// ============================================================
// ★ 2026-08-20 신설 (Harold 지시 "캠페인 대행 완벽 채우기" ③·②).
// 0709 배포분은 분석 성공 후에도 status가 안 움직였고(designed_at만), 제안서는 슈퍼관리자 전용이라
// 고객 전달이 시스템 밖이었다. 판정을 라우트에 인라인으로 두지 않고 여기 하나로 모은다 —
// 게이트는 효과가 만들어지는 곳에, 경로가 늘어도 같은 문을 지나게(feedback_gate_belongs_where_the_effect_is_created).

/** 전달 사실이 확정된 상태 — 분석 재실행으로 후퇴하지 않고, 고객 다운로드가 열리는 유일한 구간. */
const DELIVERED_STATUSES = new Set(['delivered', 'done']);

/** 분석 성공 시 상태 전이 — 후퇴 금지.
 *  received·on_hold·designing → designing (실행 자체가 직원의 명시 행위 — 보류도 푼 것으로 본다).
 *  delivered·done → 유지 (재실행은 PDF 덮어쓰기만 — 전달 사실은 되돌아가지 않는다).
 *  모르는 값 → 유지 (fail-safe — 상태 축이 늘어도 여기가 조용히 덮지 않는다). */
export function nextStatusAfterDesign(current: string): string {
  const s = String(current || '').trim();
  if (s === 'received' || s === 'on_hold' || s === 'designing') return 'designing';
  return s;
}

/** 고객 제안서 다운로드 허용 판정 — 전달된 상태(delivered/done) AND PDF 실존일 때만.
 *  설계 중 내부 산출물이 검토 전에 고객에게 새지 않는다. 모르는 상태값은 거부(fail-closed). */
export function canCustomerDownloadProposal(status: string, hasPdf: boolean): boolean {
  return hasPdf === true && DELIVERED_STATUSES.has(String(status || '').trim());
}
