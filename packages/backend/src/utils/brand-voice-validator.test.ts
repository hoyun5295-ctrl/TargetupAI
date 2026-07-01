/**
 * brand-voice-validator 확장 테스트 — 2026-07-02 형태 명세 검증 (종결어미·길이 범위).
 * 기존 3 필수(빈출 표현·(광고) 위치·이모지) 하위 호환 포함.
 */
import { describe, it, expect } from 'vitest';
import { validateBrandVoiceCompliance } from './brand-voice-validator';
import type { BrandGuideline } from './brand-voice-prompt';

function baseGuideline(over: Partial<BrandGuideline> = {}): BrandGuideline {
  return {
    tone_signature: '정보/실용',
    avg_length_chars: 0,
    avg_length_bytes: 0,
    frequent_expressions: [],
    ad_prefix_position: 'front',
    greeting_pattern: '',
    cta_patterns: [],
    signature: '',
    reject_position: 'back',
    emoji_whitelist: [],
    extracted_at: '2026-07-02T00:00:00.000Z',
    admin_edited: false,
    ...over,
  };
}

describe('기존 검증 하위 호환', () => {
  it('신규 필드 없는 가이드라인은 기존 검증 그대로 통과한다', () => {
    const r = validateBrandVoiceCompliance('(광고) 본문입니다.', baseGuideline());
    expect(r.valid).toBe(true);
  });

  it('빈출 표현 미포함이면 기존대로 미달', () => {
    const g = baseGuideline({ frequent_expressions: ['쿠폰코드'] });
    const r = validateBrandVoiceCompliance('(광고) 본문입니다.', g);
    expect(r.valid).toBe(false);
  });

  it('카카오 채널은 이모지 화이트리스트 검사를 건너뛴다 (이모지 허용 채널)', () => {
    const g = baseGuideline({ emoji_whitelist: [] });
    const r = validateBrandVoiceCompliance('(광고) 본문입니다 ★', g, { channel: '카카오' });
    expect(r.valid).toBe(true);
  });
});

describe('종결어미 스타일 검증', () => {
  it('합쇼체 가이드라인에 해요체 위주 문안이면 미달', () => {
    const g = baseGuideline({ sentence_ending_style: '합쇼체' });
    const r = validateBrandVoiceCompliance(
      '(광고) 이번 신상 너무 예뻐요. 지금 확인해봐요. 놓치면 아쉬워요.',
      g,
      { channel: 'LMS' },
    );
    expect(r.valid).toBe(false);
    expect(r.issues.join(' ')).toContain('종결어미');
  });

  it('합쇼체 가이드라인에 합쇼체 문안이면 통과', () => {
    const g = baseGuideline({ sentence_ending_style: '합쇼체' });
    const r = validateBrandVoiceCompliance(
      '(광고) 신상품이 입고되었습니다. 지금 확인해보시기 바랍니다.',
      g,
      { channel: 'LMS' },
    );
    expect(r.valid).toBe(true);
  });

  it('혼합 스타일은 검사하지 않는다', () => {
    const g = baseGuideline({ sentence_ending_style: '혼합' });
    const r = validateBrandVoiceCompliance('(광고) 예뻐요. 확인해보세요. 감사합니다.', g, { channel: 'LMS' });
    expect(r.valid).toBe(true);
  });

  it('SMS 채널은 종결어미 검사를 건너뛴다', () => {
    const g = baseGuideline({ sentence_ending_style: '합쇼체' });
    const r = validateBrandVoiceCompliance('(광고) 예뻐요. 확인해봐요. 아쉬워요.', g, { channel: 'SMS' });
    expect(r.valid).toBe(true);
  });
});

describe('길이 범위 검증 (LMS/MMS 한정)', () => {
  const g = baseGuideline({ length_range: { min_chars: 200, max_chars: 300 } });

  it('범위(슬랙 ±20%) 안이면 통과', () => {
    const text = '(광고) ' + '가'.repeat(250);
    const r = validateBrandVoiceCompliance(text, g, { channel: 'LMS' });
    expect(r.valid).toBe(true);
  });

  it('심하게 짧으면 미달', () => {
    const r = validateBrandVoiceCompliance('(광고) 짧은 문안', g, { channel: 'LMS' });
    expect(r.valid).toBe(false);
    expect(r.issues.join(' ')).toContain('길이');
  });

  it('SMS는 길이 범위를 적용하지 않는다', () => {
    const r = validateBrandVoiceCompliance('(광고) 짧은 문안', g, { channel: 'SMS' });
    expect(r.valid).toBe(true);
  });

  it('채널 미지정이면 길이 범위를 적용하지 않는다 (과차단 방지)', () => {
    const r = validateBrandVoiceCompliance('(광고) 짧은 문안', g);
    expect(r.valid).toBe(true);
  });
});
