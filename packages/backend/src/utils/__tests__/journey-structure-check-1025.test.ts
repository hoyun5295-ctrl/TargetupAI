/**
 * 여정 구조체크 2차(2026-10-25 · 설계서 docs/2026-10-25-journey-structure-check-2-design.md) — 결함마다 동작 짝 시험.
 *   소스 모양 계약(대상을 기계로 뽑는 시험)은 root-ledger.test.ts · 여기는 고친 판정이 실제로 그렇게 도는지(함수를 불러 본다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import { query } from '../../config/database';
import { SEND_HOURS } from '../../config/defaults';
import { anchorSendHourIssue, computeAnchorStepRunAt, computeNextAnchor, isAnchorCycleComplete } from '../send-time-util';
import { evaluateCustomerFieldCondition } from '../journey-condition';
import { stepSendVersions, applyVariantToStep } from '../journey-step-versions';
import { entryCapExceeded, backfillPerDayOf } from '../journey-step-limits';
import { journeyCoverSql } from '../journey-access';
import { recoRequestId, buildFlowPlan } from '../journey-opportunities';
import { batchVerdictOf } from '../journey-pretest-validator';
import { PURCHASED_SINCE_ENTRY_ONE_SQL, purchasedSinceEntrySql, isSignupTrigger } from '../journey-goal-purchase';
import { pauseReasonView } from '../journey-pause-reason';

const q = query as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => q.mockReset());

describe('#7 날짜축 = 기준일 그날(하루 앞당김 0) · #8 시각 = 발송 창 안', () => {
  it('기준일 글자 그대로 D-N · 반복 · 사이클 끝', () => {
    expect(computeAnchorStepRunAt('2026-10-30', 0, 10).toISOString()).toBe('2026-10-30T01:00:00.000Z');
    expect(computeAnchorStepRunAt('2026-03-02', 3, 9).toISOString()).toBe('2026-02-27T00:00:00.000Z');   // 달 경계
    expect(computeNextAnchor('yearly', null, '2026-10-30')).toBe('2027-10-30');
    expect(computeNextAnchor('none', null, '2026-10-30')).toBeNull();
    // D-0 그날(KST 10/30 23시) = 아직 · 다음 날(KST 10/31 00:30) = 끝
    expect(isAnchorCycleComplete(0, '2026-10-30', new Date('2026-10-30T14:00:00Z'))).toBe(false);
    expect(isAnchorCycleComplete(0, '2026-10-30', new Date('2026-10-30T15:30:00Z'))).toBe(true);
  });
  it('보낼 시각 = 발송 창(시작 ~ 끝 직전 시) 안만 · 밖 = 사람 말 이유', () => {
    expect(anchorSendHourIssue(SEND_HOURS.start)).toBeNull();
    expect(anchorSendHourIssue(SEND_HOURS.end - 1)).toBeNull();
    expect(anchorSendHourIssue(SEND_HOURS.end)).toMatch(/시/);
    expect(anchorSendHourIssue(SEND_HOURS.start - 1)).toMatch(/시/);
    expect(anchorSendHourIssue(undefined)).toBeNull();
  });
});

describe('#15 조건 칸 「고객 정보」 = 대상 조건 CT 의 칸 규칙', () => {
  const now = new Date('2026-10-25T03:00:00Z');   // KST 10/25 12시
  it('성별 = 표준 코드끼리(「여성」 = F · 모르는 값 = 미충족)', () => {
    expect(evaluateCustomerFieldCondition({ field: 'gender', operator: '==', value: '여성' }, { gender: 'F' })).toBe(true);
    expect(evaluateCustomerFieldCondition({ field: 'gender', operator: '!=', value: '여성' }, { gender: 'F' })).toBe(false);
    expect(evaluateCustomerFieldCondition({ field: 'gender', operator: '==', value: 'M' }, { gender: '남' })).toBe(true);
    expect(evaluateCustomerFieldCondition({ field: 'gender', operator: '==', value: '여성' }, { gender: '?' })).toBe(false);
  });
  it('생일 달 · 마지막 구매 뒤 지난 날 = 가상 칸(판정 불가면 비어 있음만 참)', () => {
    expect(evaluateCustomerFieldCondition({ field: 'birth_month', operator: '==', value: 3 }, { birth_month_day: '03-15' }, now)).toBe(true);
    expect(evaluateCustomerFieldCondition({ field: 'birth_month', operator: '==', value: 3 }, { birth_date: new Date(1990, 2, 15) }, now)).toBe(true);
    expect(evaluateCustomerFieldCondition({ field: 'days_since_purchase', operator: '>=', value: 30 }, { recent_purchase_date: new Date(2026, 8, 20) }, now)).toBe(true);
    expect(evaluateCustomerFieldCondition({ field: 'days_since_purchase', operator: '>=', value: 36 }, { recent_purchase_date: '2026-09-20' }, now)).toBe(false);
    expect(evaluateCustomerFieldCondition({ field: 'days_since_purchase', operator: '>=', value: 1 }, {}, now)).toBe(false);
    expect(evaluateCustomerFieldCondition({ field: 'days_since_purchase', operator: 'is_null' }, {}, now)).toBe(true);
  });
});

describe('#1 A/B 칸 = 켜기 검사 · 재검사 · 실행기가 같은 판 목록', () => {
  it('변이 없음 = 스냅샷(켠 뒤 고친 글) · 변이 있음 = 변이마다(제목 비면 칸 제목) · 채널은 덮지 않는다', () => {
    const step = { message_template: '칸 본문', subject: '칸 제목', channel: 'lms' };
    expect(stepSendVersions(step, { message_body: '고친 본문' }, [])).toEqual([{ variantId: null, body: '고친 본문', subject: '칸 제목' }]);
    expect(stepSendVersions(step, null, [{ id: 'v1', message_template: 'A안', subject: null }, { id: 'v2', message_template: 'B안', subject: 'B 제목' }]))
      .toEqual([{ variantId: 'v1', body: 'A안', subject: '칸 제목' }, { variantId: 'v2', body: 'B안', subject: 'B 제목' }]);
    expect(applyVariantToStep(step, { messageTemplate: 'A안', subject: null })).toEqual({ ...step, message_template: 'A안' });
  });
});

describe('#14 검사 장애 ≠ 차단', () => {
  it('하나라도 차단 = 차단 · 차단 없이 장애 = 장애 · 전부 통과 = 통과 · 결과 없음 = 장애', () => {
    const pass = { overallResult: 'pass', carrierResults: [{ result: 'pass' }] };
    const blocked = { overallResult: 'blocked', carrierResults: [{ result: 'blocked' }] };
    const timeout = { overallResult: 'timeout', carrierResults: [] };
    expect(batchVerdictOf([pass, pass])).toBe('pass');
    expect(batchVerdictOf([pass, blocked, timeout])).toBe('blocked');
    expect(batchVerdictOf([pass, timeout])).toBe('error');
    expect(batchVerdictOf([])).toBe('error');
  });
  it('검사 장애로 멈춘 여정 = 「문안 문제 아님 · 다시 켜기」 안내', () => {
    const v = pauseReasonView('발송 2시간 전 스팸필터 검사를 마치지 못해(검사 장애) 고친 문안을 보내지 않고 여정을 멈췄습니다.');
    expect(v.text).toContain('문안 문제는 아니');
    expect(v.fix?.action).toBe('resume');
  });
});

describe('#6 · #12 진입 상한 = 한 판정(감시 · 재진입 · 날짜축 · 시뮬레이션)', () => {
  it('하루 몫이 있으면 멈추지 않는다 · 없으면 상한 초과 = 멈춤 · 상한 없음 = 멈추지 않음', () => {
    expect(entryCapExceeded(100, null, 101)).toBe(true);
    expect(entryCapExceeded(100, null, 100)).toBe(false);
    expect(entryCapExceeded(100, 50, 10000)).toBe(false);
    expect(entryCapExceeded(null, null, 10 ** 6)).toBe(false);
    expect(entryCapExceeded('100', null, 101)).toBe(true);   // DB numeric 글자
  });
  it('하루 몫 = 상시 · 휴면 시작만', () => {
    expect(backfillPerDayOf({ trigger_event: 'customer.dormant', trigger_filters: { backfill_per_day: 300 } })).toBe(300);
    expect(backfillPerDayOf({ trigger_event: 'cdp.purchase', trigger_filters: { backfill_per_day: 300 } })).toBeNull();
  });
});

describe('#9 추천 판정 = 보는 사람 여정 + 관리자가 켠 여정(D1 = A)', () => {
  it('관리자 · 사용자 없음 = 회사 전체(빈 조각) · 담당자 = 자기 것 + 담당자 아닌 사람이 켠 것', async () => {
    q.mockResolvedValueOnce({ rows: [{ user_type: 'admin' }] });
    const p1: any[] = ['c'];
    expect(await journeyCoverSql('admin-1', p1)).toEqual({ where: '', mine: 'TRUE' });
    expect(p1).toEqual(['c']);
    expect(await journeyCoverSql(null, ['c'])).toEqual({ where: '', mine: 'TRUE' });
    q.mockResolvedValueOnce({ rows: [{ user_type: 'user' }] });
    const p2: any[] = ['c'];
    const cover = await journeyCoverSql('u-b', p2);
    expect(p2).toEqual(['c', 'u-b']);
    expect(cover.mine).toBe('(j.created_by::text = $2::text)');
    expect(cover.where).toContain("j.status = 'active' AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id::text = j.created_by::text AND cu.user_type = 'user')");
  });
  it('관리자가 켠 여정이 맡은 구간 = 이유를 따로(담당자 목록에 없는 여정) · 요청 키 = 사람마다', () => {
    const plan = buildFlowPlan(null, new Set(), {}, new Set(), new Set(['customer.created']));
    expect(plan.find((p) => p.triggerEvent === 'customer.created')).toMatchObject({ status: 'exists', reason: '관리자가 켠 여정이 이 구간을 맡고 있어요.' });
    const k = { triggerEvent: 'customer.created', daysFromStart: [0, 2, 5], dormantDays: null };
    expect(recoRequestId('c', 'u-a', k)).not.toBe(recoRequestId('c', 'u-b', k));
  });
});

describe('#13 「진입 뒤 구매」 = 한 판정(가입 여정만 가입 묶음 신호)', () => {
  it('한 건 판정 문장 = 가입 여정 표시를 네 번째 자리로 받는다 · 가입 판정 = customer.created', () => {
    expect(PURCHASED_SINCE_ENTRY_ONE_SQL).toContain('(($4::boolean) AND EXISTS (SELECT 1 FROM purchases pb');
    expect(purchasedSinceEntrySql('e', '$1::uuid', 'FALSE')).toContain('((FALSE) AND EXISTS');
    expect(isSignupTrigger('customer.created')).toBe(true);
    expect(isSignupTrigger('purchase.first')).toBe(false);
  });
});

describe('Codex 1R — 검사 우회 0', () => {
  it('2시간 전 재검사: 원 문안 차단 확인 = 고치기 전에 그 판을 보류(0) · 고친 문안 통과 때만 100', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const pn = readFileSync(join(__dirname, '..', 'journey-pretest-notifier.ts'), 'utf8');
    // ★ 1031 보류(0) 쓰기 = 판 확인 쓰기(recordIfCurrent · markUnchecked) · 그 함수 안이 그 판만 0 으로
    const hold = pn.indexOf('await recordIfCurrent(b, snapId, { markUnchecked: true });');
    expect(hold).toBeGreaterThan(-1);
    expect(pn.slice(pn.indexOf('export async function recordIfCurrent('))).toContain('UPDATE journey_step_snapshots SET confidence_score = 0 WHERE id = $1::uuid');
    expect(hold).toBeLessThan(pn.indexOf('regenBody = await regenerateStepAvoidingSpam('));
    expect(hold).toBeGreaterThan(pn.indexOf('if (variantRows.length > 0) {', pn.indexOf("if (verdict === 'pass') {")));
  });
  it('실행기: 변이 조회 실패를 삼키고 칸 본문으로 보내지 않는다(처리 예외 = 상한 있는 재시도)', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const ex = readFileSync(join(__dirname, '..', 'journey-executor.ts'), 'utf8').replace(/\r\n/g, '\n');
    const at = ex.indexOf('const variants = await listJourneyStepVariants(step.id);');
    expect(at).toBeGreaterThan(-1);
    const before = ex.slice(ex.lastIndexOf('let activeVariantId', at), at);
    expect(before).not.toMatch(/\btry \{/);
    expect(ex).not.toContain('variants 조회 실패 fallback');
  });
});

describe('Codex 1R — 재진입 상한은 회차 자르기 앞', () => {
  it('상한 판정용 뽑기 = cap + 1(회차 1,000 명으로 먼저 자르지 않는다) · 1,000 명 자르기는 상한 통과 뒤', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const r = readFileSync(join(__dirname, '..', 'journey-reentry-worker.ts'), 'utf8');
    expect(r).toContain('let pickLimit = cap != null ? cap + 1 : PER_JOURNEY_BATCH_LIMIT;');
    const check = r.indexOf('if (cap != null && entryCapExceeded(cap, backfill, picked.length)) {');
    const cut = r.indexOf('const ids = picked.slice(0, PER_JOURNEY_BATCH_LIMIT);');
    expect(check).toBeGreaterThan(-1);
    expect(cut).toBeGreaterThan(check);
  });
});
