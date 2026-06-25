/**
 * ★ CDP identity 충돌 감지 — 순수(DB import 0). 2026-06-25 (gap 4 보강)
 *
 * identifyCustomer가 email 매칭(2단계)으로 고객 A를 골랐는데, 들어온 phone은 다른 고객 B가 보유하면
 * 자동 병합은 위험(데이터 파괴) → 충돌만 감지해 검수 플래그 기록 + warn. A로 진행은 유지(기존 흐름 불변).
 */
export type IdentityConflictKind = 'phone_conflict';

export function detectIdentityConflict(p: {
  chosenCustomerId: string | null;   // email/phone 매칭으로 최종 선택된 고객 id
  phoneHolderId: string | null;      // 들어온 phone을 보유한 활성 고객 id(없으면 null)
}): { conflict: boolean; kind?: IdentityConflictKind } {
  if (!p.chosenCustomerId || !p.phoneHolderId) return { conflict: false };
  if (p.chosenCustomerId !== p.phoneHolderId) return { conflict: true, kind: 'phone_conflict' };
  return { conflict: false };
}
