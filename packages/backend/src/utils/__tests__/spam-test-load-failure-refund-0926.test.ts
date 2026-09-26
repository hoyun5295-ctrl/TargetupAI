/**
 * 유료 스팸 검사 — 테스트 문자 적재 실패 시 나간 만큼만 남기고 환불 (★2026-09-26 한줄로 V2 F30 · B-0925-4)
 *
 * 수동 검사(routes/spam-filter.ts)와 큐 검사(utils/spam-test-queue.ts executeSpamTest)는 차감 뒤 테스트폰마다
 * 적재하다가 예외가 나면 차감을 되돌리지 않았다(수동 = 500만 · 큐 = completed만). 한 통도 안 나가도 선불이 깎이고
 * 다시 누를 때마다 또 깎였다. 수동 경로는 실패한 회차의 결과 행이 남아 stale 정리로 timeout이 되면 후불에 1건 청구됐다.
 *
 * 못 박는 것
 *   1. 두 경로 모두 적재에 성공한 건수를 세고, 예외면 keepCount(= 나간 건수)로 NOT_LOADED 환불 — 차감 − 나간 건이 목표라
 *      어디서 실패했든 같은 답이고 다시 불러도 멱등이다(무료분·상한은 prepaidRefund keepCount가 소유).
 *   2. 수동 경로: 체험(차감 없음)은 종전 되돌림 그대로 · 실패한 회차에 먼저 만든 결과 행은 지운다 · 한 통도 못 나갔으면 검사를 종료한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const manual = readFileSync(join(__dirname, '..', '..', 'routes', 'spam-filter.ts'), 'utf8');
const queue = readFileSync(join(__dirname, '..', 'spam-test-queue.ts'), 'utf8');

describe('수동 스팸 검사 적재 실패', () => {
  const catchBlock = () => {
    const i = manual.indexOf('} catch (sendErr) {');
    expect(i).toBeGreaterThan(0);
    return manual.slice(i, manual.indexOf('throw sendErr;', i));
  };

  it('결과 행 id를 받아 두고, 적재가 끝나면 비운다', () => {
    expect(manual).toMatch(/INSERT INTO spam_filter_test_results \(test_id, carrier, message_type, phone\)\s+VALUES \(\$1, \$2, \$3, \$4\) RETURNING id/);
    expect(manual).toContain('pendingResultId = inserted.rows[0]?.id ?? null;');
    expect(manual).toMatch(/sentCount \+= 1;\s+pendingResultId = null;/);
  });

  it('유료 검사는 나간 건수만 남기고 NOT_LOADED 환불 · 실패 회차 결과 행 삭제 · 0건이면 검사 종료', () => {
    const c = catchBlock();
    expect(c).toContain('if (!trialMode) {');
    expect(c).toContain("prepaidRefund(companyId, 0, spamDeductType, testId, '스팸 검사 발송 실패 환불', 'spam', { refundKey: REFUND_KEYS.NOT_LOADED, keepCount: sentCount })");
    expect(c).toContain('DELETE FROM spam_filter_test_results WHERE id = $1');
    expect(c).toMatch(/if \(sentCount === 0\) \{[\s\S]*?status = 'completed'/);
  });
});

describe('큐 스팸 검사 적재 실패', () => {
  const fn = () => queue.slice(queue.indexOf('async function executeSpamTest('), queue.indexOf('// [4] 배치 결과 조회'));

  it('적재 성공 건수를 try 밖에서 센다', () => {
    const f = fn();
    const iSent = f.indexOf('let sentCount = 0;');
    const iTry = f.indexOf('try {');
    expect(iSent).toBeGreaterThan(-1);
    expect(iSent).toBeLessThan(iTry);
    expect(f).toMatch(/await insertTestSmsQueue\([^;]*\);\s+sentCount \+= 1;/);
  });

  it('환불 대상 회사는 호출부가 넘긴다 — 첫 조회가 실패해도 환불을 건너뛰지 않는다(Codex 1R high)', () => {
    expect(queue).toContain('async function executeSpamTest(testId: string, isAuto: boolean, companyId: string): Promise<void> {');
    expect(queue).toContain('let refundCompanyId: string | null = companyId;');
    expect(queue).toContain('await executeSpamTest(test.id, isAutoSpamSource(test.source), test.company_id);');
  });

  it('예외면 나간 건수만 남기고 NOT_LOADED 환불(결과 행 유형 = 차감 유형)', () => {
    const f = fn();
    const c = f.slice(f.lastIndexOf('} catch (err) {'));
    expect(c).toContain('SELECT DISTINCT message_type FROM spam_filter_test_results WHERE test_id = $1');
    expect(c).toContain("prepaidRefund(refundCompanyId, 0, String(r.message_type), testId, '스팸 검사 발송 실패 환불', 'spam', { refundKey: REFUND_KEYS.NOT_LOADED, keepCount: sentCount })");
    // 환불이 실패 종료 기록보다 먼저다(Codex 3차 2R — 상태 UPDATE 실패가 환불·경보를 건너뛰지 않게)
    expect(c.indexOf('prepaidRefund(refundCompanyId')).toBeLessThan(c.indexOf("UPDATE spam_filter_tests SET status = 'completed'"));
  });
});
