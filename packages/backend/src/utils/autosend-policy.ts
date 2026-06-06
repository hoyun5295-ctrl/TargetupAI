/**
 * autosend-policy.ts — 자동마케팅 자율 발송 순수 정책 (DB 미import → 순수 테스트)
 *
 * - resolveAutoSendLeadMinutes: 준비·정지 창(분). null/0/음수 → 120 기본, 상한 1440.
 * - computeScheduledSendAt: 발송 예정 시각 = 준비 시각(now) + lead분. 그 사이가 담당자 정지 창.
 * - decideSendOutcome: 발송 시점 0건·잔액부족 → skip+알림 / 정상 → send.
 */

export function resolveAutoSendLeadMinutes(raw: number | null | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 120;
  return Math.min(n, 1440);
}

export function computeScheduledSendAt(now: Date, leadMinutes: number): Date {
  return new Date(now.getTime() + leadMinutes * 60 * 1000);
}

export interface SendOutcome {
  action: 'send' | 'skip';
  notify: boolean;
  reason: string;
}

export function decideSendOutcome(input: { recipientCount: number; balanceOk: boolean }): SendOutcome {
  if (input.recipientCount <= 0) {
    return { action: 'skip', notify: true, reason: '발송 대상 0명 — 이번 사이클 건너뜀' };
  }
  if (!input.balanceOk) {
    return { action: 'skip', notify: true, reason: '잔액 부족 — 이번 사이클 건너뜀' };
  }
  return { action: 'send', notify: false, reason: '발송 진행' };
}

/**
 * 'sending'에 정지된 제안 복구 판정(순수). campaign 'sending' 자동정리 패턴 미러(admin.ts).
 *  - campaignId 있음 = 발송 커밋 완료(마커) → 최종 상태만 'sent'로 마감. 노후 시각 무관 안전.
 *  - campaignId 없음 + claim 후 staleMinutes 경과 = 커밋 전 중단(예외/프로세스 종료) → 'admin_review'로 내려 사람 판단(절대 자동 재발송 X).
 *  - 그 외(최근 / claim 시각 모름) = keep(진행 중일 수 있어 손대지 않음).
 */
export type StuckSendingAction = 'mark_sent' | 'demote_admin_review' | 'keep';
export function decideStuckSendingRecovery(
  row: { campaignId: string | null; reviewedAt: Date | null },
  now: Date,
  staleMinutes: number = 30,
): StuckSendingAction {
  if (row.campaignId) return 'mark_sent';
  if (row.reviewedAt && now.getTime() - row.reviewedAt.getTime() >= staleMinutes * 60 * 1000) {
    return 'demote_admin_review';
  }
  return 'keep';
}
