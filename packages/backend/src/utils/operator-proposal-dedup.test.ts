import { describe, it, expect } from 'vitest';
import { shouldSkipProposalGeneration } from './operator-proposal-dedup';

describe('shouldSkipProposalGeneration — operator당 미처리 추천 1건 / 이중예약 방지', () => {
  it('리마인드 아닌 scheduled(발송 예약된 추천)이 있으면 skip', () => {
    expect(shouldSkipProposalGeneration([{ status: 'scheduled', isReminder: false }])).toBe(true);
    expect(
      shouldSkipProposalGeneration([
        { status: 'pending', isReminder: false },
        { status: 'scheduled', isReminder: false },
      ]),
    ).toBe(true);
  });

  it('scheduled가 시퀀스 리마인드뿐이면 skip 안 함(리마인드는 별개 발송)', () => {
    expect(shouldSkipProposalGeneration([{ status: 'scheduled', isReminder: true }])).toBe(false);
  });

  it('pending/admin_review만이면 skip 안 함(생성 후 직전분 만료로 처리)', () => {
    expect(
      shouldSkipProposalGeneration([
        { status: 'pending', isReminder: false },
        { status: 'admin_review', isReminder: false },
      ]),
    ).toBe(false);
  });

  it('미처리 제안 없으면 skip 안 함', () => {
    expect(shouldSkipProposalGeneration([])).toBe(false);
  });
});
