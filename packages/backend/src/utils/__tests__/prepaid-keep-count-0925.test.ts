/**
 * prepaidRefund keepCount(캠페인 전체 기준 목표) 계약 (★2026-09-25 한줄로 전수점검 C-05·C-10·C-11 · Codex 1R 구조 정정)
 *
 * 왜 있나
 *   취소·개별 삭제 환불이 원인별 항아리(NOT_LOADED·CANCEL)에 나뉘어 지급되면서, 중단·재시도·순서가 바뀌면
 *   서로의 지급을 못 봐 이중 지급(복구 취소 정산)·영구 누락(삭제 뒤 취소)이 났다.
 *   keepCount는 "남아서 과금이 유지될 건수"만 받아 목표 = 차감 − 그 건수로 잡고 **모든 원인의 누적 환불**과 비교한다.
 *
 * 못 박는 것
 *   1. 목표 = min(차감 건수, 차감 + 무료 − 남는 건) × 차감 당시 단가 − 이미 돌려준 전체(원인 무관).
 *   2. 같은 목표로 다시 불러도 0원(멱등) · 이미 목표 이상이면 0원(회수하지 않는다).
 *   3. 기록 행의 refund_key는 넘긴 원인 키 그대로(원인별 항아리 계산을 쓰는 다른 경로가 이 지급을 본다).
 *   4. keepCount = 0이어도(count 인자 0) 조기 반환하지 않는다.
 *
 * ⚠ mock은 실제 SELECT보다 관대하면 안 된다 — SQL 문자열을 보고 그 문이 실제로 고르는 컬럼만 돌려준다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  billingType: 'prepaid',
  deductRows: [] as Array<{ amount: number; description: string }>,
  refunds: [] as Array<{ amount: number; refund_key: string | null; message_type: string }>,
  balance: 1000,
};

function exec(sql: string, params: any[] = []) {
  if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return { rows: [] };
  if (sql.includes('SELECT billing_type FROM companies')) return { rows: [{ billing_type: state.billingType }] };
  if (sql.includes('FROM companies WHERE id = $1 FOR UPDATE')) {
    return { rows: [{ billing_type: state.billingType, balance: state.balance, unit_price_basis: 'vat_included', cost_per_sms: 10, cost_per_lms: 30, cost_per_mms: 60, cost_per_kakao: 8, cost_per_brand: 20, cost_per_brand_nonfriend: 20 }] };
  }
  if (sql.includes("type = 'deduct'") && sql.includes('SELECT amount, description FROM balance_transactions')) {
    return { rows: state.deductRows };
  }
  if (sql.includes("type = 'refund'") && sql.includes('SUM(amount)')) {
    const key = params[4] ?? null;
    const rel = state.refunds.filter((r) => r.message_type === params[2] || r.message_type == null);
    const total = rel.reduce((s, r) => s + r.amount, 0);
    const unkeyed = rel.filter((r) => r.refund_key == null).reduce((s, r) => s + r.amount, 0);
    const forKey = rel.filter((r) => r.refund_key === key).reduce((s, r) => s + r.amount, 0);
    // ★ 2026-09-26 실제 SELECT가 함께 고르는 값: counted = refund_key IS DISTINCT FROM 'kakao_diff'
    const counted = rel.filter((r) => r.refund_key !== 'kakao_diff').reduce((s, r) => s + r.amount, 0);
    return { rows: [{ total, unkeyed, for_key: forKey, counted }] };
  }
  if (sql.startsWith('UPDATE companies SET balance = balance + $1')) {
    state.balance += Number(params[0]);
    return { rows: [{ balance: state.balance }] };
  }
  if (sql.includes('INSERT INTO balance_transactions')) {
    state.refunds.push({ amount: Number(params[1]), refund_key: params[7] ?? null, message_type: params[5] });
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

import { prepaidRefund, REFUND_KEYS } from '../prepaid';
import { buildDeductDescription } from '../deduct-reference';

const CAMP = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  state.billingType = 'prepaid';
  state.refunds = [];
  state.balance = 1000;
  // 100건 × 10원 = 1,000원 차감(SMS)
  state.deductRows = [{ amount: 1000, description: buildDeductDescription('campaign', 'SMS', 100, 10) }];
});

const refundKeep = (keep: number, key: string = REFUND_KEYS.CANCEL) =>
  prepaidRefund('c1', 0, 'SMS', CAMP, 'test', 'campaign', { refundKey: key, keepCount: keep });

describe('prepaidRefund keepCount', () => {
  it('목표 = 차감 − 남는 건(모든 원인 누적과 비교)', async () => {
    // 취소 경로가 먼저 대기 50건을 CANCEL로, 앞선 시도가 미적재 20건을 NOT_LOADED로 돌려줬다
    state.refunds.push({ amount: 500, refund_key: REFUND_KEYS.CANCEL, message_type: 'SMS' });
    state.refunds.push({ amount: 200, refund_key: REFUND_KEYS.NOT_LOADED, message_type: 'SMS' });
    // 남아서 나갈 행 30건 → 목표 70건(700원) → 이미 700원 → 추가 0원 (Codex 1R 시나리오: 이중 지급 20건 차단)
    const r = await refundKeep(30);
    expect(r).toEqual({ refunded: 0, ok: true });
  });

  it('부족분만 채우고 원인 키를 그대로 기록한다', async () => {
    state.refunds.push({ amount: 500, refund_key: REFUND_KEYS.CANCEL, message_type: 'SMS' });
    const r = await refundKeep(30);
    expect(r.refunded).toBe(200);
    expect(state.refunds.at(-1)).toMatchObject({ amount: 200, refund_key: REFUND_KEYS.CANCEL });
    // 같은 목표로 다시 불러도 0원
    expect((await refundKeep(30)).refunded).toBe(0);
  });

  it('남는 건 0 = 전액(count 인자 0이어도 조기 반환하지 않는다)', async () => {
    const r = await refundKeep(0, REFUND_KEYS.NOT_LOADED);
    expect(r.refunded).toBe(1000);
  });

  it('이미 목표를 넘겨 돌려줬으면 회수하지 않고 0원', async () => {
    state.refunds.push({ amount: 900, refund_key: REFUND_KEYS.NOT_LOADED, message_type: 'SMS' });
    expect(await refundKeep(30)).toEqual({ refunded: 0, ok: true });
  });

  it('무료 제공분은 돌려주지 않는다(refund-calc와 같은 규칙: min(차감, 차감+무료−남는 건))', async () => {
    // 100건 중 20건 무료 → 80건 × 10원 = 800원 차감
    state.deductRows = [{ amount: 800, description: buildDeductDescription('campaign', 'SMS', 80, 10, 20) }];
    // 10건 삭제(남는 90건) → 환불 건수 = min(80, 80+20−90) = 10 → 100원
    expect((await refundKeep(90)).refunded).toBe(100);
  });

  it('후불은 아무것도 하지 않는다', async () => {
    state.billingType = 'postpaid';
    expect(await refundKeep(0)).toEqual({ refunded: 0, ok: true });
  });
});
