/**
 * 다중 목표 충돌 분석 — AI 호출에 회사 id가 실린다 (★2026-09-26 한줄로 V2 R1-20)
 *
 * 라우트의 회사 조회가 id를 읽지 않아 analyzeGoalConflicts의 `companyInfo?.id`가 비었고, AI 관문(callAIWithFallback)이
 * 회사별 월 AI 호출 한도·캐시·통계를 전부 건너뛰었다(고급 모델 호출이 한도 밖에서 무제한).
 * 크레딧 과금 신설은 요금 결정이라 이번 범위가 아니다(원장 기록).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const route = readFileSync(join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf8');
const h = route.slice(route.indexOf("router.post('/operator/multi-goal/analyze'"), route.indexOf('// ★ D181 (2026-05-19) 회사별 메모리'));

describe('다중 목표 분석 회사 id', () => {
  it('회사 조회가 id를 함께 읽는다(AI 관문의 회사별 한도·통계 적용)', () => {
    expect(h).toContain('SELECT id, company_name, business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid');
  });
});
