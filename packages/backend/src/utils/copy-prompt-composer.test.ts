import { describe, test, expect } from 'vitest';
import { buildCopyBrainPrompt } from './copy-prompt-composer';
import type { CopyExample } from './copy-rag-retriever';

const co = (text: string): CopyExample => ({ text, source: 'company', features: null, successRate: 0.1 });
const ind = (text: string): CopyExample => ({ text, source: 'industry', features: null, successRate: 0.1 });

describe('buildCopyBrainPrompt — RAG 예시·맥락·키트 합성 (시그니처 보호 지시 포함)', () => {
  test('회사 예시는 원문 참고, 업종은 features 통계만 (원문 미주입 — 누출 0)', () => {
    const s = buildCopyBrainPrompt({
      examples: [co('우리 회사 문안'), ind('타사 비식별 문안')],
      industryFeatures: { sampleCount: 10, avgLengthChars: 80, avgSentenceCount: 3, hasCtaRatio: 0.7 },
      contextLine: '',
      kit: {},
      channel: 'EMAIL',
    });
    expect(s).toContain('우리 회사 문안');
    expect(s).not.toContain('타사 비식별 문안'); // 업종 원문 미주입(누출 0)
    expect(s).toContain('80'); // 업종 구조 통계
    expect(s).toMatch(/같은 업종/);
  });

  test('industryFeatures 없으면 업종 섹션 없음', () => {
    const s = buildCopyBrainPrompt({
      examples: [co('우리 회사 문안')],
      contextLine: '', kit: {}, channel: 'EMAIL',
    });
    expect(s).toContain('우리 회사 문안');
    expect(s).not.toMatch(/같은 업종/);
  });

  test('맥락(contextLine) 주입', () => {
    const s = buildCopyBrainPrompt({
      examples: [], contextLine: '현재 2026-12-24 목요일 정오, 겨울철입니다.', kit: {}, channel: 'EMAIL',
    });
    expect(s).toContain('겨울철');
  });

  test('고정 시그니처(append) → 마지막에 포함 지시', () => {
    const s = buildCopyBrainPrompt({
      examples: [], contextLine: '', channel: 'EMAIL',
      kit: { signatureLocked: '오늘도 좋은 하루 되세요 — OO드림', signatureMode: 'append' },
    });
    expect(s).toContain('오늘도 좋은 하루 되세요 — OO드림');
    expect(s).toMatch(/마지막|맺음|끝/);
  });

  test('금지어 → 사용 금지 명시', () => {
    const s = buildCopyBrainPrompt({
      examples: [], contextLine: '', channel: 'EMAIL',
      kit: { bannedWords: ['대박', '초특가'] },
    });
    expect(s).toContain('대박');
    expect(s).toMatch(/금지|쓰지/);
  });

  test('전부 비면 빈 문자열(기존 흐름 영향 0)', () => {
    expect(buildCopyBrainPrompt({ examples: [], contextLine: '', kit: {}, channel: 'EMAIL' })).toBe('');
  });
});
