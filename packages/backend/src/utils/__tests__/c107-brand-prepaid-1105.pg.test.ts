// replaces: none
/**
 * C107 · 브랜드메시지 선불 결과별 정산 — 실 PostgreSQL(★ 2026-11-05 설계서 docs/2026-11-05-brand-message-design.md §3 B3 · §6 (돈))
 *
 *   차감 단가 = max(브랜드 단가 · 고른 대체 문자 단가) · 차감 행 = 결과별 단가(브랜드메시지 · SMS 대체 · LMS 대체)
 *   고른 대체 단가 미설정 = 막음(잔액 · 원장 0) · 대체 끔 = 종전(브랜드 단가 · 결과별 단가 없음)
 *   단가는 실례 공급가(친구 15 · 비친구 21 · SMS 8.18 · LMS 23.6) · 회사 기준 = 운영 기본 vat_excluded → 차감 = 부가세 포함가(단가 CT).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { prepaidDeduct } from '../prepaid';
import { parseAlimtalkUnits, parseDeductDescription } from '../deduct-reference';
import { toVatIncludedPrice } from '../unit-price';

const CO = randomUUID();
const CO_NO_LMS = randomUUID();
const CO_ONE_BRAND = randomUUID();   // ★ C107F ② 비친구 칸이 비어 친구 단가를 따르는 회사(친구 조각 없음 = 문구 종전)
const START = 100000;
const vat = (supply: number) => toVatIncludedPrice(supply, 'vat_excluded')!;
const won = (n: number) => Math.round(n * 100) / 100;
const P = { friend: vat(15), nonfriend: vat(21), sms: vat(8.18), lms: vat(23.6) };

const balanceOf = async (co: string) => Number((await pool.query('SELECT balance FROM companies WHERE id = $1', [co])).rows[0].balance);
const lastDeduct = async (co: string, ref: string) => (await pool.query(
  `SELECT amount, description FROM balance_transactions WHERE company_id = $1 AND reference_id = $2 AND type = 'deduct' ORDER BY created_at DESC LIMIT 1`,
  [co, ref],
)).rows[0];

beforeAll(async () => {
  const prices = { billing_type: 'prepaid', balance: START, unit_price_basis: 'vat_excluded', cost_per_brand: 15, cost_per_brand_nonfriend: 21, cost_per_sms: 8.18 };
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C107 브랜드 선불 시험', ...prices, cost_per_lms: 23.6 });
  await insertMinimalRow(pool, 'companies', { id: CO_NO_LMS, company_name: 'C107 브랜드 선불 시험(LMS 미설정)', ...prices });
  await insertMinimalRow(pool, 'companies', { id: CO_ONE_BRAND, company_name: 'C107F 브랜드 단가 하나', ...prices, cost_per_brand_nonfriend: null, cost_per_lms: 23.6 });
});

describe('C107 B3 · 선불 브랜드 결과별 정산(실 PG)', () => {
  it('비친구 + LMS 대체 = 건당 LMS 단가 차감 · 결과별 단가 브랜드메시지 = 비친구 · SMS 칸 = 차감 단가 · LMS 대체 = LMS', async () => {
    const ref = randomUUID();
    const before = await balanceOf(CO);
    const r = await prepaidDeduct(CO, 10, 'BRAND', ref, undefined, 'campaign', { targeting: 'M', form: 'FREE' }, { brandFallback: 'B' });
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(won(10 * P.lms));
    expect(await balanceOf(CO)).toBeCloseTo(before - 10 * P.lms, 2);
    const row = await lastDeduct(CO, ref);
    expect(Number(row.amount)).toBe(won(10 * P.lms));
    expect(parseDeductDescription(row.description)).toEqual({ count: 10, unitPrice: P.lms });
    // ★ 1106 C107F ② 비친구 대상 = 친구 단가 조각(카카오가 실제 친구로 보고한 성공은 이 단가로 정산)
    expect(parseAlimtalkUnits(row.description)).toEqual({ KAKAO: P.nonfriend, SMS: P.lms, LMS: P.lms, FRIEND: P.friend });
    expect(row.description).toContain(`결과별 정산: 브랜드메시지 ${P.nonfriend}원 · 친구 ${P.friend}원 · SMS 대체`);
  });

  it('친구 + SMS 대체 = 건당 max(친구 · SMS) = 친구 · 결과별 단가 SMS 대체 = SMS', async () => {
    const ref = randomUUID();
    const r = await prepaidDeduct(CO, 4, 'BRAND', ref, undefined, 'campaign', { targeting: 'I', form: 'FREE' }, { brandFallback: 'A' });
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(won(4 * P.friend));
    const row = await lastDeduct(CO, ref);
    expect(parseAlimtalkUnits(row.description)).toEqual({ KAKAO: P.friend, SMS: P.sms, LMS: P.friend });
  });

  it('대체 끔 · 비친구 대상 = 브랜드 단가 차감 · 결과별 단가 = 친구 조각만(문자 칸 = 차감 단가 = 차액 0) · ★1106 C107F ②', async () => {
    const ref = randomUUID();
    const r = await prepaidDeduct(CO, 3, 'BRAND', ref, undefined, 'campaign', { targeting: 'N', form: 'FREE' }, { brandFallback: null });
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(won(3 * P.nonfriend));
    const row = await lastDeduct(CO, ref);
    expect(parseAlimtalkUnits(row.description)).toEqual({ KAKAO: P.nonfriend, SMS: P.nonfriend, LMS: P.nonfriend, FRIEND: P.friend });
    expect(parseDeductDescription(row.description)).toEqual({ count: 3, unitPrice: P.nonfriend });
  });

  it('대체 끔 · 친구 대상(I) = 종전(결과별 단가 없음 · 이미 친구 단가) · ★1106 C107F ②', async () => {
    const ref = randomUUID();
    const r = await prepaidDeduct(CO, 2, 'BRAND', ref, undefined, 'campaign', { targeting: 'I', form: 'FREE' }, { brandFallback: null });
    expect(r.ok).toBe(true);
    const row = await lastDeduct(CO, ref);
    expect(parseAlimtalkUnits(row.description)).toBeNull();
  });

  it('비친구 칸이 비어 친구 단가를 따르는 회사 = 친구 조각 없음(문구 종전) · ★1106 C107F ②', async () => {
    const ref = randomUUID();
    const r = await prepaidDeduct(CO_ONE_BRAND, 2, 'BRAND', ref, undefined, 'campaign', { targeting: 'M', form: 'FREE' }, { brandFallback: null });
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(won(2 * P.friend));
    const row = await lastDeduct(CO_ONE_BRAND, ref);
    expect(parseAlimtalkUnits(row.description)).toBeNull();
  });

  it('고른 대체(LMS) 단가 미설정 = 막음 · 잔액 그대로 · 원장 0 · 고르지 않은 유형(SMS) 대체는 통과', async () => {
    const ref = randomUUID();
    const before = await balanceOf(CO_NO_LMS);
    const r = await prepaidDeduct(CO_NO_LMS, 5, 'BRAND', ref, undefined, 'campaign', { targeting: 'M', form: 'FREE' }, { brandFallback: 'B' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LMS 단가가 설정되지 않아');
    expect(await balanceOf(CO_NO_LMS)).toBe(before);
    expect(await lastDeduct(CO_NO_LMS, ref)).toBeUndefined();
    const ok = await prepaidDeduct(CO_NO_LMS, 5, 'BRAND', randomUUID(), undefined, 'campaign', { targeting: 'M', form: 'FREE' }, { brandFallback: 'A' });
    expect(ok.ok).toBe(true);
    expect(ok.amount).toBe(won(5 * P.nonfriend));
  });
});
