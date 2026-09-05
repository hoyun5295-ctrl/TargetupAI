/**
 * sales-outreach-exemplars.test.ts — 샘플 예시 선택 CT + seed 위생 계약 (2026-09-05)
 * 고정하는 것: 같은 업종군 우선 · 예산·개수 상한 · seed에 브랜드명·링크·연락처·혜택 수치·모델명 0 · 마스킹 표식 실재.
 */
import { describe, it, expect } from 'vitest';
import {
  pickOutreachExemplars, countOutreachExemplars, exemplarGroupOf, EXEMPLAR_FORBIDDEN_PATTERNS,
  OUTREACH_DM_SECTION_CONTRACT, OUTREACH_EMAIL_SECTION_CONTRACT, OUTREACH_GENERATION_RULES,
} from '../sales-outreach-exemplars';
import { OUTREACH_EXEMPLAR_SEED } from '../sales-outreach-exemplar-seed';

const SRC = {
  'DM:fashion': ['F1'.padEnd(100, 'a'), 'F2'.padEnd(100, 'b')],
  'DM:beauty': ['B1'.padEnd(100, 'c')],
  'EMAIL:fashion': ['E1'.padEnd(100, 'd')],
};

describe('pickOutreachExemplars', () => {
  it('같은 업종군을 먼저, 부족하면 다른 업종군으로 채운다(채널은 섞지 않는다)', () => {
    const out = pickOutreachExemplars('DM', 'beauty', { source: SRC });
    expect(out.startsWith('B1')).toBe(true);
    expect(out).toContain('F1');
    expect(out).not.toContain('E1');
  });
  it('예산·개수 상한을 지킨다', () => {
    expect(pickOutreachExemplars('DM', 'fashion', { source: SRC, max: 1 })).toBe(SRC['DM:fashion'][0]);
    expect(pickOutreachExemplars('DM', 'fashion', { source: SRC, budget: 150 }).split('\n\n')).toHaveLength(1);
    expect(pickOutreachExemplars('EMAIL', 'beauty', { source: SRC, budget: 10 })).toBe('');
  });
  it('업종 코드 → 예시군(표 밖은 commerce)', () => {
    expect(exemplarGroupOf('sports')).toBe('fashion');
    expect(exemplarGroupOf('health')).toBe('beauty');
    expect(exemplarGroupOf('food')).toBe('commerce');
    expect(exemplarGroupOf(null)).toBe('commerce');
  });
});

describe('seed 위생(마스킹본 계약)', () => {
  const all = Object.values(OUTREACH_EXEMPLAR_SEED).flat();
  it('DM·EMAIL 각각 예시가 있고 마스킹 표식이 실재한다', () => {
    expect(countOutreachExemplars('DM')).toBeGreaterThanOrEqual(5);
    expect(countOutreachExemplars('EMAIL')).toBeGreaterThanOrEqual(5);
    expect(all.join('\n')).toContain('〔브랜드〕');
    expect(all.join('\n')).toContain('〔상품〕');
  });
  it('링크·연락처·할인율·금액·모델명이 없다', () => {
    for (const e of all) {
      for (const re of EXEMPLAR_FORBIDDEN_PATTERNS) expect(e, `금지 패턴 ${re}`).not.toMatch(re);
    }
  });
  it('실물 브랜드명이 남아 있지 않다', () => {
    const joined = all.join('\n');
    for (const b of ['올리브영', '무신사', '조선미녀', '유니클로', '에이블리', '쿠팡', '스파오', '지그재그', '3CE', '이폴리움', 'MUSINSA', 'UNIQLO', 'ABLY']) {
      expect(joined, b).not.toContain(b);
    }
  });
});

describe('프롬프트 계약 문자열', () => {
  it('이메일 계약은 DM 계약에서 countdown만 뺀 것', () => {
    expect(OUTREACH_DM_SECTION_CONTRACT).toContain('countdown');
    expect(OUTREACH_EMAIL_SECTION_CONTRACT).not.toContain('countdown');
    expect(OUTREACH_EMAIL_SECTION_CONTRACT).toContain('product_carousel');
  });
  it('규칙에 구체 혜택 수치(퍼센트·원)·모델명·줄표가 없다', () => {
    expect(OUTREACH_GENERATION_RULES).not.toMatch(/\d+\s*%|\d[\d,]{2,}\s*원/);
    expect(OUTREACH_GENERATION_RULES).not.toMatch(/sonnet|opus|haiku|claude|gpt-/i);
    expect(OUTREACH_GENERATION_RULES).not.toContain('—');
  });
});
