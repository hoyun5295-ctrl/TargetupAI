import { describe, it, expect } from 'vitest';
import { scoreCopy } from './copy-quality-score';

describe('copy-quality-score', () => {
  it('깨끗+규정통과+CTA면 pass', () => {
    const r = scoreCopy({ text: '지금 매장에서 신메뉴 확인하세요', channel: 'SMS', bannedWords: [] });
    expect(r.pass).toBe(true);
    expect(r.feedback.length).toBe(0);
  });
  it('금지어 포함이면 fail + 피드백', () => {
    const r = scoreCopy({ text: '지금 확인하세요', channel: 'SMS', bannedWords: ['확인'] });
    expect(r.pass).toBe(false);
    expect(r.feedback.join()).toContain('금지어');
  });
  it('스팸 위험 높으면 fail', () => {
    const r = scoreCopy({ text: '무료 대출 당첨 지금 신청', channel: 'SMS', bannedWords: [] });
    expect(r.pass).toBe(false);
    expect(r.feedback.join()).toContain('스팸');
  });
});
