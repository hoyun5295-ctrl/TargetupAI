import { describe, it, expect } from 'vitest';
import { scoreSpamRisk } from './copy-spam-risk';

describe('copy-spam-risk', () => {
  it('스팸 사전 단어가 있으면 위험 점수와 hits를 낸다', () => {
    const r = scoreSpamRisk('지금 대출 무료 당첨 확인');
    expect(r.score).toBeGreaterThan(0);
    expect(r.hits.length).toBeGreaterThan(0);
  });
  it('깨끗한 문안은 위험 0에 가깝다', () => {
    const r = scoreSpamRisk('오늘 신메뉴가 나왔어요. 매장에서 만나요.');
    expect(r.score).toBeLessThan(0.2);
  });
  it('과도한 특수문자에 가산한다', () => {
    expect(scoreSpamRisk('대박!!!!! ★★★★★ 지금!!!').score)
      .toBeGreaterThan(scoreSpamRisk('대박 지금').score);
  });
});
