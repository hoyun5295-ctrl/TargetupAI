/**
 * ★ CDP 회원 전화번호 자동 갱신 판정 — 순수(DB import 0). 2026-06-25 (gap 2 보강)
 *
 * 문제: identifyCustomer가 phone 변경을 skip해(UNIQUE 충돌 우려) 번호 바뀐 회원이 이전 번호로 남아 발송 실패.
 * 설계: 충돌(같은 회사 다른 활성 고객이 그 번호 점유)만 자동변경 금지(skip_conflict→검수 플래그), 그 외 자동 갱신.
 *   - incomingPhone은 호출부에서 normalizePhone() 경유한 정규화 값을 넘긴다(D162 정합).
 */
export type PhoneUpdateDecision = 'update' | 'skip_conflict' | 'noop';

export function decidePhoneUpdate(p: {
  currentPhone: string | null;
  incomingPhone: string | null;
  conflictHolderId: string | null;  // 그 번호를 보유한 같은 회사 활성 고객 id(없으면 null)
  selfId: string;                    // 갱신 대상 고객 본인 id
}): PhoneUpdateDecision {
  const incoming = p.incomingPhone;
  if (!incoming) return 'noop';
  if (incoming === p.currentPhone) return 'noop';
  if (p.conflictHolderId && p.conflictHolderId !== p.selfId) return 'skip_conflict';
  return 'update';
}
