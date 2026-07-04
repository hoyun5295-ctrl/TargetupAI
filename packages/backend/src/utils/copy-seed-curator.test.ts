import { describe, it, expect } from 'vitest';
import { selectSeedCandidates } from './copy-seed-curator';

describe('copy-seed-curator selectSeedCandidates', () => {
  it('베스트 순으로 탈색·중복제거 후 상위 N 반환', () => {
    const rows = [
      { final_message: '[A몰] 지금 확인 문의 1600-0000', final_source: 'selected_as_is', spam_blocked: 0 },
      { final_message: '바로 신청하세요', final_source: 'edited', spam_blocked: 0 },
    ];
    const out = selectSeedCandidates(rows, 5);
    expect(out).toContain('지금 확인 문의'); // 탈색([A몰]·1600-0000 제거)
    expect(out.some((t) => t.includes('1600'))).toBe(false);
    expect(out).toContain('바로 신청하세요');
  });
  it('스팸 이력·스팸 위험 후보는 시드에서 제외', () => {
    const rows = [
      { final_message: '지금 확인하세요', final_source: 'edited', spam_blocked: 0 },
      { final_message: '무료 대출 당첨 지금', final_source: 'manual', spam_blocked: 3 },
    ];
    const out = selectSeedCandidates(rows, 5);
    expect(out).toContain('지금 확인하세요');
    expect(out.some((t) => t.includes('대출'))).toBe(false);
  });
  it('탈색 후 식별자(이메일) 잔존 없음', () => {
    const rows = [{ final_message: '연락 abc@x.com 지금 확인', final_source: 'manual', spam_blocked: 0 }];
    const out = selectSeedCandidates(rows, 5);
    expect(out.every((t) => !t.includes('@'))).toBe(true);
  });
});
