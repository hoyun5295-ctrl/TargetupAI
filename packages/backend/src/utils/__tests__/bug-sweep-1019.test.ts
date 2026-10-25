/**
 * bug-sweep-1019.test.ts — 1019 버그 정리 묶음 3 의 새 판정(순수 · DB 모의)
 *   B-1005-5② 등록 번호 집합 = 원문 규격 → 숫자
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn() }));
import { query } from '../../config/database';
import { getRegisteredCallbackSet } from '../callback-filter';

describe('B-1005-5② 등록 번호 집합 = 저장 원문 규격 → 숫자만', () => {
  it('괄호 · 공백 표기 정상 번호는 숫자로 들어가고 · 허용 문자 밖(#) 번호는 빠진다', async () => {
    (query as any).mockResolvedValue({ rows: [{ phone: '(02) 123-4567' }, { phone: '010-1234-5678#' }, { phone: '1588-1234' }] });
    const set = await getRegisteredCallbackSet('c1');
    expect(set.has('021234567')).toBe(true);
    expect(set.has('15881234')).toBe(true);
    expect([...set].some((v) => v.startsWith('0101234'))).toBe(false);
  });
});

describe('B-1018-1 factsOnly 근거 = 한 줄 원문의 혜택 자리도 뺀다', () => {
  it('근거에서 혜택이 빠지면 교차 조합 「5% 할인」 이 지어낸 혜택으로 걸린다', async () => {
    const { withoutBenefitSpans, findInventedBenefits } = await import('../copy-benefit-detector');
    const line = '가을 세일 10% 할인 · 5% 적립 이번 주';
    const g = withoutBenefitSpans(line);
    expect(g).not.toMatch(/\d+%/);
    expect(g).toContain('가을 세일');
    expect(findInventedBenefits('지금 5% 할인', g).length).toBeGreaterThan(0);
    expect(findInventedBenefits('가을 세일 소식을 전해요', g)).toEqual([]);
  });
});

describe('B-1018-1 혜택 자리 빼기 = 검증과 같은 정규화(F2)', () => {
  it('「10퍼센트 할인 · 5프로 적립」 도 근거에서 빠져 「5% 할인」 이 걸린다', async () => {
    const { withoutBenefitSpans, findInventedBenefits } = await import('../copy-benefit-detector');
    const g = withoutBenefitSpans('10퍼센트 할인 · 5프로 적립 가을 세일');
    expect(g).not.toMatch(/퍼센트|프로|%/);
    expect(findInventedBenefits('지금 5% 할인', g).length).toBeGreaterThan(0);
  });
});

describe('B-1009-6 켜진 여정 문안 수정 = 발송 시점 관문 · 판마다 검사 표식(F3)', () => {
  it('수정 스냅샷 = 0 · 실행기는 그 판이 100 이 될 때까지 문자 발송을 미루고 · 스캐너 통과가 그 판을 100 으로 올린다', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const ex = readFileSync(join(__dirname, '..', 'journey-executor.ts'), 'utf8');
    const jb = readFileSync(join(__dirname, '..', 'journey-builder.ts'), 'utf8');
    expect(ex).toContain('SELECT message_body, message_subject, created_at, confidence_score');
    expect(ex.indexOf('pendingSnapshotAt = snap.created_at ?? null;')).toBeLessThan(ex.indexOf('const gate = await query('));
    expect(ex).not.toContain('last_pretest_passed_at');
    expect(jb).toContain('VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, 0)');
    const pn = readFileSync(join(__dirname, '..', 'journey-pretest-notifier.ts'), 'utf8');
    expect(pn.indexOf("if (verdict === 'pass') {")).toBeGreaterThan(-1);
    expect(pn.indexOf('await markSnapshotChecked(snap.id);')).toBeGreaterThan(pn.indexOf("if (verdict === 'pass') {"));
    expect(pn).toContain('SET message_body = $2, confidence_score = 100 WHERE id = $1::uuid');
    // F4 — 재검사 전 판은 날짜별 처리 기록으로 건너뛰지 않는다(★1025 #2 = 후보 SQL 안 · LIMIT 앞) · 조회 실패는 문자 칸을 미룬다
    expect(pn).toMatch(/ORDER BY ss\.created_at DESC LIMIT 1\), 100\) < 100\s+OR NOT EXISTS \(SELECT 1 FROM journey_pretest_schedules/);
    expect(pn.indexOf('FROM journey_pretest_schedules ps')).toBeLessThan(pn.indexOf('LIMIT ${PRETEST_SCAN_BUNDLE_LIMIT}'));
    expect(ex).toContain('snapshotReadFailed = true;');
    expect(ex.indexOf("if (snapshotReadFailed && ['sms', 'lms', 'mms']")).toBeGreaterThan(ex.indexOf('const gate = await query('));
    expect(jb).not.toContain('UPDATE journey_executions je SET next_run_at');
    expect(jb).toContain('if (isActive && upd.rows.length > 0) await createStepSnapshot(companyId, journeyId, stepId, run);');
  });
});
