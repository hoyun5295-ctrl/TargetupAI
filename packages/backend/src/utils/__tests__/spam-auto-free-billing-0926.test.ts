/**
 * 무료 자동 스팸 검사는 후불 청구에서도 빠진다 (★2026-09-26 한줄로 V2 F49)
 *
 * AI 자동발송의 스팸 검사는 선불 차감을 건너뛰는데(skipPrepaid · "프로 이상 무료"), 표시값이 유료인 여정 사전 검사와 같은
 * 'auto_ai'라 후불 정산·비용 표시(spamBillableTestSql = 체험만 제외)가 둘을 가르지 못해 무료 검사를 청구했다.
 *
 * 못 박는 것
 *   1. 무료 여부는 차감 건너뜀 한 곳에서 정해진다 — enqueueSpamTest가 'auto_ai' + skipPrepaid면 'auto_ai_free'로 적재(20자 이내).
 *   2. 청구 제외 판정 CT(spam-trial.ts)가 체험과 무료 자동 검사를 함께 뺀다(SQL 조각 · 함수 한 벌) — 정산 2곳·비용 표시 3곳이 이것만 쓴다.
 *   3. 큐 워커의 자동 검사 판정은 두 값 모두(동작 불변).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  spamBillableTestSql, isSpamTestBillable, isAutoSpamSource, SPAM_AUTO_FREE_SOURCE, SPAM_TRIAL_SOURCE,
} from '../spam-trial';

const queue = readFileSync(join(__dirname, '..', 'spam-test-queue.ts'), 'utf8');
const campaigns = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');

describe('청구 제외 판정 CT', () => {
  it('무료 자동 검사 표시값은 칸 길이(varchar 20) 안', () => {
    expect(SPAM_AUTO_FREE_SOURCE).toBe('auto_ai_free');
    expect(SPAM_AUTO_FREE_SOURCE.length).toBeLessThanOrEqual(20);
  });

  it('SQL 조각은 체험과 무료 자동 검사를 함께 뺀다(표시값 없는 옛 행 = manual = 청구)', () => {
    expect(spamBillableTestSql('t')).toBe("COALESCE(t.source, 'manual') NOT IN ('trial', 'auto_ai_free')");
  });

  it('함수 판정이 SQL 조각과 같은 집합', () => {
    expect(isSpamTestBillable(SPAM_TRIAL_SOURCE)).toBe(false);
    expect(isSpamTestBillable(SPAM_AUTO_FREE_SOURCE)).toBe(false);
    expect(isSpamTestBillable('auto_ai')).toBe(true);
    expect(isSpamTestBillable('manual')).toBe(true);
    expect(isSpamTestBillable(null)).toBe(true);
  });

  it('자동 검사 판정은 유료·무료 둘 다', () => {
    expect(isAutoSpamSource('auto_ai')).toBe(true);
    expect(isAutoSpamSource(SPAM_AUTO_FREE_SOURCE)).toBe(true);
    expect(isAutoSpamSource('manual')).toBe(false);
    expect(isAutoSpamSource('trial')).toBe(false);
  });
});

describe('적재·워커·비용 표시 배선', () => {
  it('차감을 건너뛴 자동 검사만 무료 표시값으로 적재한다', () => {
    expect(queue).toContain("const storedSource = source === 'auto_ai' && skipPrepaid ? SPAM_AUTO_FREE_SOURCE : source;");
    const ins = queue.slice(queue.indexOf('INSERT INTO spam_filter_tests'), queue.indexOf('// 4) 선불 차감'));
    expect(ins).toContain('storedSource, variantId || null');
  });

  it('큐 워커는 CT로 자동 검사를 판정한다', () => {
    expect(queue).toContain('await executeSpamTest(test.id, isAutoSpamSource(test.source), test.company_id);');
  });

  it('테스트 결과 목록의 비용은 청구 제외 판정 CT를 따른다(체험 표시는 그대로)', () => {
    expect(campaigns).toContain('const isTrial = r.source === SPAM_TRIAL_SOURCE;');
    expect(campaigns).toMatch(/if \(isCompleted && isSpamTestBillable\(r\.source\)\) \{/);
  });
});
