/**
 * 선불 알림톡 결과별 정산 — 선불 CT 계약 (★2026-09-26 한줄로 V2 F01·F04)
 *
 * 왜 있나
 *   선불 알림톡은 대체 문자까지 덮는 문자 단가(보통 LMS)로 차감하고, 실패·미적재만 환불했다.
 *   그래서 알림톡이 성공한 건도 문자 값이 그대로 굳었다(후불 청구는 알림톡 단가로 매긴다).
 *   정산(mysql-refund-sweeper)이 결과별 차액을 돌려주려면 세 가지가 CT에 있어야 한다.
 *
 * 못 박는 것
 *   1. prepaidDeduct(alimtalk) = 차감 행에 **차감 순간의** 결과별 단가(부가세 기준 반영)를 싣는다.
 *      하나라도 미설정이면 싣지 않는다(종전 정산 — 공짜 발송을 만들지 않는다). 발송은 막지 않는다.
 *   2. prepaidRefund(targetAmount) = 원인 항아리 하나의 **금액 목표**. 그 항아리에 이미 돌려준 만큼 빼고,
 *      차감 총액 − 전체 환불 한도를 넘지 않는다. 같은 목표로 다시 불러도 0원.
 *   3. prepaidReverseOverRefund(extraLegitAmount) = 정당 한도에 차액을 더한다. 안 넘기면 종전과 같다.
 *
 * ⚠ mock은 실제 SELECT보다 관대하면 안 된다 — SQL 문자열을 보고 그 문이 실제로 고르는 값만 돌려준다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  billingType: 'prepaid',
  company: {} as Record<string, any>,
  deductRows: [] as Array<{ amount: number; description: string }>,
  refunds: [] as Array<{ amount: number; refund_key: string | null; message_type: string; description?: string }>,
  reversed: 0,
  timeoutRefunds: 0,
  balance: 10000,
  inserts: [] as Array<{ sql: string; params: any[] }>,
};

function exec(sql: string, params: any[] = []) {
  if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return { rows: [] };
  if (sql.includes('SELECT billing_type FROM companies')) return { rows: [{ billing_type: state.billingType }] };
  if (sql.includes('FROM companies WHERE id = $1 FOR UPDATE')) {
    return { rows: [{ billing_type: state.billingType, balance: state.balance, ...state.company }] };
  }
  if (sql.includes("type = 'deduct'") && sql.includes('SELECT amount, description FROM balance_transactions')) {
    return { rows: state.deductRows };
  }
  if (sql.includes("type = 'refund'") && sql.includes('AS for_key')) {
    const key = params[4] ?? null;
    const rel = state.refunds.filter((r) => r.message_type === params[2] || r.message_type == null);
    const total = rel.reduce((s, r) => s + r.amount, 0);
    const unkeyed = rel.filter((r) => r.refund_key == null).reduce((s, r) => s + r.amount, 0);
    const forKey = rel.filter((r) => r.refund_key === key).reduce((s, r) => s + r.amount, 0);
    // 실제 SELECT: counted = refund_key IS DISTINCT FROM 'kakao_diff' (NULL 키 포함)
    const counted = rel.filter((r) => r.refund_key !== 'kakao_diff').reduce((s, r) => s + r.amount, 0);
    return { rows: [{ total, unkeyed, for_key: forKey, counted }] };
  }
  // ★ 순환불 비교 모드(netTargetCount)의 집계 — 실제 SELECT가 고르는 세 값만
  if (sql.includes('AS refunded_counted') && sql.includes('AS refunded_all') && sql.includes('AS reversed')) {
    const rel = state.refunds.filter((r) => r.message_type === params[2] || r.message_type == null);
    const refundedAll = rel.reduce((a, r) => a + r.amount, 0);
    const refundedCounted = rel.filter((r) => r.refund_key !== 'kakao_diff').reduce((a, r) => a + r.amount, 0);
    return { rows: [{ refunded_counted: refundedCounted, refunded_all: refundedAll, reversed: state.reversed }] };
  }
  if (sql.includes('AS refunded') && sql.includes('AS reversed') && sql.includes('AS timeout_refunds')) {
    const refunded = state.refunds.filter((r) => r.message_type === params[2] || r.message_type == null).reduce((s, r) => s + r.amount, 0);
    return { rows: [{ refunded, reversed: state.reversed, timeout_refunds: state.timeoutRefunds }] };
  }
  if (sql.startsWith('UPDATE companies SET balance = balance + $1')) {
    state.balance += Number(params[0]);
    return { rows: [{ balance: state.balance }] };
  }
  if (sql.startsWith('UPDATE companies SET balance = balance - $1')) {
    state.balance -= Number(params[0]);
    return { rows: [{ balance: state.balance }] };
  }
  if (sql.includes('INSERT INTO balance_transactions')) {
    state.inserts.push({ sql, params });
    if (sql.includes("'refund'")) {
      state.refunds.push({ amount: Number(params[1]), refund_key: params[7] ?? null, message_type: params[5], description: params[3] });
    }
    return { rows: [] };
  }
  return { rows: [] };
}

vi.mock('../../config/database', () => {
  const client = { query: vi.fn(async (sql: string, params?: any[]) => exec(String(sql).trim(), params)), release: vi.fn() };
  const pool = { connect: vi.fn(async () => client), query: vi.fn(async (sql: string, params?: any[]) => exec(String(sql).trim(), params)) };
  return { default: pool, pool, query: vi.fn(async (sql: string, params?: any[]) => exec(String(sql).trim(), params)) };
});
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => undefined) }));
vi.mock('../free-messaging', () => ({
  isFreeMessagingEligible: () => false,
  consumeFreeQuota: async () => 0,
  recordFreeAttempt: async () => undefined,
}));

import { prepaidDeduct, prepaidRefund, prepaidReverseOverRefund, REFUND_KEYS } from '../prepaid';
import { buildDeductDescription } from '../deduct-reference';

const CAMP = '44444444-4444-4444-8444-444444444444';
const UNITS = { KAKAO: 5.5, SMS: 11, LMS: 27.5 };

beforeEach(() => {
  state.billingType = 'prepaid';
  // 이에스페이먼트형 단가: 공급가 입력(부가세 별도) SMS 10 · LMS 25 · 알림톡 5
  state.company = { unit_price_basis: 'vat_excluded', cost_per_sms: 10, cost_per_lms: 25, cost_per_mms: 60, cost_per_kakao: 5, cost_per_brand: 20, cost_per_brand_nonfriend: 20 };
  state.refunds = [];
  state.reversed = 0;
  state.timeoutRefunds = 0;
  state.balance = 10000;
  state.inserts = [];
  // LMS 10건 × 27.5원 = 275원 차감(결과별 단가 실림)
  state.deductRows = [{ amount: 275, description: buildDeductDescription('campaign', 'LMS', 10, 27.5, 0, UNITS) }];
});

const deductDesc = () => state.inserts.find((i) => i.sql.includes("'deduct'"))?.params[3];

describe('prepaidDeduct — 알림톡 결과별 정산 단가 (2026-09-26)', () => {
  it('알림톡이면 차감 순간의 결과별 단가(부가세 기준 반영)를 차감 행에 싣는다', async () => {
    const r = await prepaidDeduct('c1', 10, 'LMS', CAMP, 'u1', 'campaign', null, { alimtalk: true });
    expect(r).toMatchObject({ ok: true, amount: 275 });
    expect(deductDesc()).toBe(buildDeductDescription('campaign', 'LMS', 10, 27.5, 0, UNITS));
  });

  it('알림톡 표시가 없으면 종전 문구 그대로', async () => {
    await prepaidDeduct('c1', 10, 'LMS', CAMP, 'u1', 'campaign', null);
    expect(deductDesc()).toBe('LMS 10건 발송 차감 (건당 27.5원)');
  });

  it('결과별 단가 하나라도 미설정이면 싣지 않는다(차액 없이 종전 정산) — 발송은 막지 않는다', async () => {
    state.company.cost_per_kakao = null;
    const r = await prepaidDeduct('c1', 10, 'LMS', CAMP, 'u1', 'campaign', null, { alimtalk: true });
    expect(r.ok).toBe(true);
    expect(deductDesc()).toBe('LMS 10건 발송 차감 (건당 27.5원)');
  });
});

const refundDiff = (target: number) =>
  prepaidRefund('c1', 0, 'LMS', CAMP, '알림톡 결과별 단가 차액 환불', 'campaign', { refundKey: REFUND_KEYS.KAKAO_DIFF, targetAmount: target });

describe('prepaidRefund — 금액 목표(targetAmount) (2026-09-26)', () => {
  it('목표 − 그 항아리에 이미 돌려준 금액만 돌려주고 원인 키를 남긴다 · 다시 불러도 0원', async () => {
    state.refunds.push({ amount: 55, refund_key: REFUND_KEYS.FAIL, message_type: 'LMS' });
    expect((await refundDiff(88)).refunded).toBe(88);
    expect(state.refunds.at(-1)).toMatchObject({ amount: 88, refund_key: REFUND_KEYS.KAKAO_DIFF });
    expect(await refundDiff(88)).toEqual({ refunded: 0, ok: true });
    // 결과가 더 도착해 목표가 커지면 늘어난 만큼만
    expect((await refundDiff(110)).refunded).toBe(22);
  });

  it('키 없는 옛 환불이 있어도 자기 항아리만 본다(옛 단일 항아리로 떨어지면 차액이 삼켜진다)', async () => {
    state.refunds.push({ amount: 30, refund_key: null, message_type: 'LMS' });
    expect((await refundDiff(88)).refunded).toBe(88);
  });

  it('차감 총액 − 전체 환불 한도를 넘지 않는다', async () => {
    state.refunds.push({ amount: 220, refund_key: REFUND_KEYS.FAIL, message_type: 'LMS' });
    expect((await refundDiff(88)).refunded).toBe(55);
  });

  it('목표 0 이하는 아무것도 하지 않는다', async () => {
    expect(await refundDiff(0)).toEqual({ refunded: 0, ok: true });
    expect(state.inserts).toHaveLength(0);
  });

  it('원인 키 없이 금액 목표만 주면 거절한다(어느 항아리와 비교할지 모른다)', async () => {
    const r = await prepaidRefund('c1', 0, 'LMS', CAMP, 'x', 'campaign', { targetAmount: 88 });
    expect(r).toEqual({ refunded: 0, ok: false });
    expect(state.inserts).toHaveLength(0);
  });

  it('기록 문구에 금액이 남는다(건수 × 단가 형식이 아니다)', async () => {
    await refundDiff(88);
    expect(state.refunds.at(-1)!.description).toBe('알림톡 결과별 단가 차액 환불 (LMS 88원)');
    await refundDiff(110);
    expect(state.refunds.at(-1)!.description).toBe('알림톡 결과별 단가 차액 환불 (LMS 추가 22원, 누적 110원)');
  });
});

describe('prepaidReverseOverRefund — 추가 정당액(extraLegitAmount) (2026-09-26)', () => {
  it('정당 한도 = 건수 × 단가 + 차액 — 차액 환불은 회수하지 않는다', async () => {
    state.refunds.push({ amount: 55, refund_key: REFUND_KEYS.FAIL, message_type: 'LMS' });
    state.refunds.push({ amount: 88, refund_key: REFUND_KEYS.KAKAO_DIFF, message_type: 'LMS' });
    const r = await prepaidReverseOverRefund('c1', 0, 'LMS', CAMP, 88);
    expect(r).toEqual({ reversed: 55, netRefundedAmt: 88, skipped: false });
  });

  it('추가 정당액을 안 넘기면 종전과 같다', async () => {
    state.refunds.push({ amount: 55, refund_key: REFUND_KEYS.FAIL, message_type: 'LMS' });
    const r = await prepaidReverseOverRefund('c1', 0, 'LMS', CAMP);
    expect(r).toEqual({ reversed: 55, netRefundedAmt: 0, skipped: false });
  });
});

/**
 * ★ Codex 1R high(0926) — 건수 × 단가 항아리와 금액 항아리(차액)를 한 합계로 비교하면 차액이 실패 환불을 삼킨다.
 * 옛 단일 항아리(키 없는 환불이 있는 캠페인)·캠페인 전체 기준(keepCount) 비교에서 차액을 뺀다. 차감 총액 상한은 전부 포함한 그대로.
 */
describe('prepaidRefund — 차액 환불은 건수 기준 누적 비교에 들어가지 않는다 (Codex 1R)', () => {
  it('키 없는 옛 환불 + 차액 뒤 실패 누적 환불이 삼켜지지 않는다(정당 242원으로 수렴)', async () => {
    state.refunds.push({ amount: 27.5, refund_key: null, message_type: 'LMS' });
    expect((await refundDiff(132)).refunded).toBe(132);
    const r = await prepaidRefund('c1', 4, 'LMS', CAMP, '발송 실패 환불 (sweep)', 'campaign', { refundKey: REFUND_KEYS.FAIL });
    expect(r.refunded).toBe(82.5);
    expect(state.refunds.reduce((a, x) => a + x.amount, 0)).toBe(242);
    // 다시 돌아도 그대로
    expect((await prepaidRefund('c1', 4, 'LMS', CAMP, '발송 실패 환불 (sweep)', 'campaign', { refundKey: REFUND_KEYS.FAIL })).refunded).toBe(0);
  });

  it('캠페인 전체 기준(keepCount)도 차액을 빼고 비교한다', async () => {
    state.refunds.push({ amount: 132, refund_key: REFUND_KEYS.KAKAO_DIFF, message_type: 'LMS' });
    const r = await prepaidRefund('c1', 0, 'LMS', CAMP, '예약 취소 환불', 'campaign', { refundKey: REFUND_KEYS.CANCEL, keepCount: 6 });
    expect(r.refunded).toBe(110);
  });

  it('차감 총액 상한은 차액까지 포함해 지킨다', async () => {
    state.refunds.push({ amount: 250, refund_key: REFUND_KEYS.KAKAO_DIFF, message_type: 'LMS' });
    const r = await prepaidRefund('c1', 0, 'LMS', CAMP, '예약 취소 환불', 'campaign', { refundKey: REFUND_KEYS.CANCEL, keepCount: 6 });
    expect(r.refunded).toBe(25);
  });
});

describe('prepaidReverseOverRefund — 참조 유형(★2026-09-26 F05·F06·F11 여정 단계 캠페인)', () => {
  it('원장 조회·환불 집계·회수 기록 모두 넘긴 참조 유형(journey)을 쓴다', async () => {
    const db: any = (await import('../../config/database')).default;
    const client = await db.connect();
    client.query.mockClear();
    state.deductRows = [{ amount: 27.5, description: '[여정 발송] LMS 1건 발송 차감 (건당 27.5원)' }];
    state.refunds.push({ amount: 27.5, refund_key: REFUND_KEYS.FAIL, message_type: 'LMS' });
    const r = await prepaidReverseOverRefund('c1', 0, 'LMS', CAMP, 0, 'journey');
    expect(r.reversed).toBe(27.5);
    const calls = client.query.mock.calls.map((c: any[]) => ({ sql: String(c[0]), params: c[1] || [] }));
    const ledgerCall = calls.find((c: any) => c.sql.includes("type = 'deduct'"));
    const aggCall = calls.find((c: any) => c.sql.includes('AS timeout_refunds'));
    const insertCall = calls.find((c: any) => c.sql.includes('INSERT INTO balance_transactions'));
    expect(ledgerCall.params[3]).toBe('journey');
    expect(aggCall.sql).toContain('reference_type = $4');
    expect(aggCall.params[3]).toBe('journey');
    expect(insertCall.params[6]).toBe('journey');
  });
});

/**
 * ★ 2026-09-26 Codex 3R high(F05·F06·F11) — 여정은 하루 종일 쌓이는 캠페인이라 "실패 환불 → (대체 성공으로) 회수 → 새 정당 환불"이 생긴다.
 * 항아리 지급 누계(gross)와 비교하면 회수된 몫 때문에 새 정당 환불이 막힌다. 순환불(환불 − 회수)과 비교하는 모드:
 *   목표 = min(차감, 건수 × 단가) · 지급 = 목표 − 순환불(차액 제외) · 상한 = 차감 − 순환불(전체)
 */
describe('prepaidRefund — 순환불 비교(netTargetCount · 여정 단일 목표)', () => {
  const journeyRefund = (count: number) =>
    prepaidRefund('c1', 0, 'LMS', CAMP, '여정 발송 실패 환불', 'journey', { refundKey: REFUND_KEYS.FAIL, netTargetCount: count });

  beforeEach(() => {
    state.deductRows = [{ amount: 55, description: '[여정 발송] LMS 2건 발송 차감 (건당 27.5원)' }];
  });

  it('회수된 몫이 있어도 순환불이 목표보다 작으면 모자란 만큼 지급한다(지급 누계 비교면 0원)', async () => {
    state.refunds.push({ amount: 27.5, refund_key: REFUND_KEYS.FAIL, message_type: 'LMS' });
    state.reversed = 27.5;   // 대체 성공으로 회수됨 → 순환불 0
    expect((await journeyRefund(1)).refunded).toBe(27.5);
    expect(state.refunds.at(-1)).toMatchObject({ amount: 27.5, refund_key: REFUND_KEYS.FAIL });
    // 다시 불러도 0원(순환불 27.5 = 목표)
    expect(await journeyRefund(1)).toEqual({ refunded: 0, ok: true });
  });

  it('상한은 차감 − 순환불(회수 반영) — 지급 누계로 막히지 않는다', async () => {
    state.deductRows = [{ amount: 27.5, description: '[여정 발송] LMS 1건 발송 차감 (건당 27.5원)' }];
    state.refunds.push({ amount: 27.5, refund_key: REFUND_KEYS.FAIL, message_type: 'LMS' });
    state.reversed = 27.5;
    expect((await journeyRefund(1)).refunded).toBe(27.5);
  });

  it('목표가 순환불 이하면 0원 · 목표는 차감을 넘지 않는다', async () => {
    state.refunds.push({ amount: 27.5, refund_key: REFUND_KEYS.FAIL, message_type: 'LMS' });
    expect(await journeyRefund(1)).toEqual({ refunded: 0, ok: true });
    expect((await journeyRefund(5)).refunded).toBe(27.5);   // 목표 5건 → 차감 2건(55원)까지
  });

  it('원인 키 없이 부르면 거절', async () => {
    expect(await prepaidRefund('c1', 0, 'LMS', CAMP, 'x', 'journey', { netTargetCount: 1 })).toEqual({ refunded: 0, ok: false });
  });
});
