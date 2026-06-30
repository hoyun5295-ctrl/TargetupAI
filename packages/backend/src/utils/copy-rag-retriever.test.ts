import { describe, test, expect } from 'vitest';
import { rankExamples, summarizeIndustryFeatures, type TrainingRow } from './copy-rag-retriever';

function row(msg: string, sent: number | null, succ: number | null, date: string): TrainingRow {
  return { final_message: msg, message_features: null, sent_count: sent, success_count: succ, created_at: date };
}

describe('rankExamples — 회사 우선 + 성과 정렬 + 업종 폴백 (임의 상수 0)', () => {
  test('회사 표본 충분 → 회사만, 성과(클릭률) 높은 순', () => {
    const company = [
      row('A', 100, 5, '2026-01-01'),   // 0.05
      row('B', 100, 20, '2026-01-02'),  // 0.20
      row('C', 100, 10, '2026-01-03'),  // 0.10
    ];
    const r = rankExamples(company, [], 2, 2);
    expect(r.map((e) => e.text)).toEqual(['B', 'C']);
    expect(r.every((e) => e.source === 'company')).toBe(true);
  });

  test('회사 표본 부족(minCompany 미만) → 업종으로 보강', () => {
    const company = [row('A', 100, 5, '2026-01-01')];
    const industry = [row('X', 100, 30, '2026-01-01')];
    const r = rankExamples(company, industry, 5, 2);
    expect(r.some((e) => e.source === 'industry')).toBe(true);
    expect(r[0].source).toBe('company'); // 회사 우선
  });

  test('성과 표본 없음(sent 0/null) → 최신순으로 적응', () => {
    const company = [
      row('A', 0, 0, '2026-01-01'),
      row('B', null, null, '2026-01-03'),
      row('C', 0, 0, '2026-01-02'),
    ];
    const r = rankExamples(company, [], 3, 1);
    expect(r.map((e) => e.text)).toEqual(['B', 'C', 'A']);
    expect(r.every((e) => e.successRate === null)).toBe(true);
  });

  test('같은 문장 중복 제거(dedup)', () => {
    const company = [
      row('같은 문장입니다', 100, 10, '2026-01-02'),
      row('같은 문장입니다', 100, 5, '2026-01-01'),
    ];
    const r = rankExamples(company, [], 5, 1);
    expect(r.length).toBe(1);
  });

  test('limit 적용', () => {
    const company = [
      row('A', 100, 5, '2026-01-01'),
      row('B', 100, 6, '2026-01-02'),
      row('C', 100, 7, '2026-01-03'),
    ];
    expect(rankExamples(company, [], 2, 1).length).toBe(2);
  });

  test('회사 충분하면 업종은 무시(시그니처 보호 — 자사만)', () => {
    const company = [row('A', 100, 5, '1'), row('B', 100, 6, '2')];
    const industry = [row('X', 100, 99, '3')];
    const r = rankExamples(company, industry, 5, 2);
    expect(r.some((e) => e.source === 'industry')).toBe(false);
  });
});

describe('rankExamples — A6 격리 게이트 (brandVoiceRegistered)', () => {
  test('등록 회사(true) → 회사 부족이어도 업종 폴백 OFF, 타사 0', () => {
    const company = [row('우리 1', 100, 5, '2026-01-01')];
    const industry = [row('타사 A', 100, 30, '2026-01-01'), row('타사 B', 100, 20, '2026-01-02')];
    const r = rankExamples(company, industry, 8, 5, true);
    expect(r.every((e) => e.source === 'company')).toBe(true);
  });
  test('미등록(false) + 회사 부족 → 업종 보강(기존 동작 유지)', () => {
    const company = [row('우리 1', 100, 5, '2026-01-01')];
    const industry = [row('타사 A', 100, 30, '2026-01-01')];
    const r = rankExamples(company, industry, 8, 5, false);
    expect(r.some((e) => e.source === 'industry')).toBe(true);
  });
});

describe('summarizeIndustryFeatures — 구조·통계만 (원문 누출 0)', () => {
  test('표본 통계 산출 + 원문 단어 미포함', () => {
    const rows = [
      row('안녕하세요 신상 입고. 지금 확인하세요', 100, 10, '2026-01-01'),
      row('봄 신상 만나보세요. 매장 방문 환영', 100, 5, '2026-01-02'),
    ];
    const f = summarizeIndustryFeatures(rows);
    expect(f.sampleCount).toBe(2);
    expect(f.avgLengthChars).toBeGreaterThan(0);
    expect(JSON.stringify(f).includes('신상')).toBe(false);
  });
  test('빈 입력 = 0', () => {
    const f = summarizeIndustryFeatures([]);
    expect(f.sampleCount).toBe(0);
    expect(f.avgLengthChars).toBe(0);
  });
});
