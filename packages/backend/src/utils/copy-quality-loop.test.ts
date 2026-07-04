import { describe, it, expect } from 'vitest';
import { generateWithQualityLoop } from './copy-quality-loop';

describe('copy-quality-loop', () => {
  it('첫 초안이 통과면 1회로 끝난다', async () => {
    let calls = 0;
    const r = await generateWithQualityLoop({
      channel: 'SMS', bannedWords: [],
      generate: async () => { calls++; return '지금 매장에서 신메뉴 확인하세요'; },
    });
    expect(calls).toBe(1);
    expect(r.text).toContain('신메뉴');
  });
  it('미달이면 피드백 담아 재생성(상한 2 초과 안 함)', async () => {
    let calls = 0;
    const drafts = ['무료 대출 당첨', '무료 대출 당첨', '지금 신메뉴 확인하세요'];
    const r = await generateWithQualityLoop({
      channel: 'SMS', bannedWords: [], maxRounds: 2,
      generate: async () => drafts[calls++] ?? drafts[drafts.length - 1],
    });
    expect(calls).toBe(3); // 초안 1 + 재생성 2
    expect(r.text).toContain('신메뉴');
  });
  it('generate가 throw해도 절대 터지지 않고 문자열 반환', async () => {
    const r = await generateWithQualityLoop({
      channel: 'SMS', bannedWords: [],
      generate: async () => { throw new Error('AI 실패'); },
    });
    expect(typeof r.text).toBe('string');
  });
});
