import { describe, it, expect } from 'vitest';
import { LEARNING_MEMORY_TYPES } from './company-memory';

/**
 * ★ 2026-07-12 AI 학습메모리 강화 — 학습 5종 화이트리스트 계약 고정.
 * 주입(buildMemoryPromptContext)·화면 집계(overview/top-impact/자세히 분석)·learning-summary가
 * 전부 이 목록을 공유한다. 비학습 타입(brand_guideline·representative_message·brand_link)이
 * 다시 섞이면 문안 생성 6슬롯 주입이 0이 되는 결함이 재발한다 (SoT: 0712 AI 학습메모리 전수점검).
 */
describe('LEARNING_MEMORY_TYPES (학습 5종 화이트리스트 계약)', () => {
  it('학습 5종 정확히 포함', () => {
    expect([...LEARNING_MEMORY_TYPES].sort()).toEqual([
      'brand_tone_evolution',
      'channel_performance',
      'compliance_learning',
      'customer_insight',
      'success_pattern',
    ]);
  });

  it('비학습 타입(브랜드 자산)은 절대 미포함', () => {
    const list = LEARNING_MEMORY_TYPES as string[];
    expect(list).not.toContain('representative_message');
    expect(list).not.toContain('brand_guideline');
    expect(list).not.toContain('brand_link');
  });
});
