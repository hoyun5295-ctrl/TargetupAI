import { describe, it, expect } from 'vitest';
import {
  sanitizeContentBlocks,
  normalizeTheme,
  blocksHaveUneditedPlaceholder,
  INAPP_BLOCK_TYPES,
  BENEFIT_PLACEHOLDER,
} from './inapp-message';

/**
 * D230+ — 인앱 블록 저장 검증 헬퍼 (CT-27). 순수 함수 단위 테스트.
 * AI 임의 혜택 영구 룰: benefit placeholder 미편집 = 저장 차단.
 */

describe('sanitizeContentBlocks', () => {
  it('알 수 없는 type 제거 + 알려진 type 유지', () => {
    const out = sanitizeContentBlocks([
      { type: 'headline', text: 'A' },
      { type: 'unknown_x', text: 'B' },
      { type: 'cta_group', buttons: [] },
    ]);
    expect(out.map((b) => b.type)).toEqual(['headline', 'cta_group']);
  });

  it('배열 아님/잡값 안전 처리', () => {
    expect(sanitizeContentBlocks(null)).toEqual([]);
    expect(sanitizeContentBlocks('x' as any)).toEqual([]);
    expect(sanitizeContentBlocks([null, 'str', 5, { type: 'body', text: 'ok' }])).toEqual([{ type: 'body', text: 'ok' }]);
  });

  it('최대 30개로 제한', () => {
    const many = Array.from({ length: 50 }, () => ({ type: 'divider' }));
    expect(sanitizeContentBlocks(many).length).toBe(30);
  });

  it('모든 카탈로그 type 통과', () => {
    const all = INAPP_BLOCK_TYPES.map((t) => ({ type: t }));
    expect(sanitizeContentBlocks(all).length).toBe(INAPP_BLOCK_TYPES.length);
  });
});

describe('normalizeTheme', () => {
  it('유효 키 통과', () => {
    ['auto', 'light', 'dark', 'brand', 'vibrant', 'minimal'].forEach((k) => expect(normalizeTheme(k)).toBe(k));
  });
  it('무효 키 → auto', () => {
    expect(normalizeTheme('nope')).toBe('auto');
    expect(normalizeTheme(null)).toBe('auto');
    expect(normalizeTheme(undefined)).toBe('auto');
  });
});

describe('blocksHaveUneditedPlaceholder', () => {
  it('benefit 빈 텍스트 = 차단', () => {
    expect(blocksHaveUneditedPlaceholder([{ type: 'benefit', text: '' }])).toBe(true);
    expect(blocksHaveUneditedPlaceholder([{ type: 'benefit' }])).toBe(true);
  });

  it('benefit placeholder 잔존 = 차단', () => {
    expect(blocksHaveUneditedPlaceholder([{ type: 'benefit', text: BENEFIT_PLACEHOLDER }])).toBe(true);
    expect(blocksHaveUneditedPlaceholder([{ type: 'benefit', text: '[직접 작성해주세요]' }])).toBe(true);
  });

  it('benefit 실제 작성 = 통과', () => {
    expect(blocksHaveUneditedPlaceholder([{ type: 'benefit', text: '전 품목 20% 할인' }])).toBe(false);
  });

  it('headline/body 등에 [혜택 토큰 잔존 = 차단', () => {
    expect(blocksHaveUneditedPlaceholder([{ type: 'headline', text: '[혜택 안내]' }])).toBe(true);
    expect(blocksHaveUneditedPlaceholder([{ type: 'body', text: '직접 작성해주세요' }])).toBe(true);
  });

  it('placeholder 없는 일반 메시지 = 통과', () => {
    expect(blocksHaveUneditedPlaceholder([
      { type: 'headline', text: '환영합니다' },
      { type: 'body', text: '둘러보세요' },
      { type: 'cta_group', buttons: [{ label: '시작', action_url: null }] },
    ])).toBe(false);
  });

  it('benefit 없는 빈 헤드라인은 차단 아님(별도 필수값 검증 영역)', () => {
    expect(blocksHaveUneditedPlaceholder([{ type: 'headline', text: '' }])).toBe(false);
  });
});
