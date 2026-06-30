/**
 * operator-proposal-dedup.ts — 자동마케팅 제안 중복 누적 차단 순수 결정 코어 (DB-free)
 *
 * 원칙(Harold 2026-06-30): operator당 "오늘의 추천"에 미처리 추천 1건만.
 *   - 이미 발송 예약된 '추천'(scheduled, 리마인드 제외)이 있으면 이중 예약 방지로 신규 생성 skip.
 *   - 그 외(pending/admin_review만)는 생성 진행 — 호출부가 INSERT 후 직전 미처리(pending/admin_review)를 만료시킨다.
 *   - 다단계 시퀀스 리마인드(meta.is_reminder=true의 scheduled)는 의도된 별개 발송 → 가드에서 제외.
 *
 * config/database를 import하지 않는다(순수 테스트 가능 — LESSONS DB-free 분리).
 */

export interface OpenProposalState {
  status: string;
  isReminder: boolean;
}

/**
 * 신규 제안 생성을 건너뛸지 결정.
 * 리마인드가 아닌 'scheduled'(발송 예약된 추천)이 이미 있으면 true(이중 예약 방지).
 * pending/admin_review만 있으면 false — 생성 진행 후 호출부가 직전 미처리를 만료시킨다.
 */
export function shouldSkipProposalGeneration(open: OpenProposalState[]): boolean {
  return open.some((p) => p.status === 'scheduled' && !p.isReminder);
}
