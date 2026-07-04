import { describe, it, expect } from 'vitest';
import { scoreCandidate, rankBestCandidates } from './copy-best-ranker';

describe('copy-best-ranker', () => {
  it('사람 선택 + 저스팸 + CTA가 상위', () => {
    const rows = [
      { final_message: '그냥 문안', final_source: 'manual', spam_blocked: 1 },
      { final_message: '지금 확인하세요', final_source: 'selected_as_is', spam_blocked: 0 },
    ];
    const r = rankBestCandidates(rows, 2);
    expect(r[0].text).toBe('지금 확인하세요');
  });
  it('스팸 이력 행은 강등된다', () => {
    const clean = scoreCandidate({ final_message: '지금 확인', final_source: 'manual', spam_blocked: 0 });
    const spammy = scoreCandidate({ final_message: '지금 확인', final_source: 'manual', spam_blocked: 3 });
    expect(clean).toBeGreaterThan(spammy);
  });
  it('성과(successRate)가 높으면 가산', () => {
    const hi = scoreCandidate({ final_message: '지금 확인', sent_count: 100, success_count: 80 });
    const lo = scoreCandidate({ final_message: '지금 확인', sent_count: 100, success_count: 5 });
    expect(hi).toBeGreaterThan(lo);
  });
  it('limit·dedup·빈 본문 제외', () => {
    const rows = [
      { final_message: '지금 확인' },
      { final_message: '지금 확인' }, // dup
      { final_message: '   ' },       // empty
      { final_message: '바로 신청' },
    ];
    const r = rankBestCandidates(rows, 5);
    expect(r.length).toBe(2);
  });
});
