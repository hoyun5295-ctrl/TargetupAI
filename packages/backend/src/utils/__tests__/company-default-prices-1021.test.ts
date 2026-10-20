/**
 * 새 회사 기본 단가 (★ 2026-10-21 Harold 「계정 생성할 때 비우고 생성하면 기본 단가 · SMS 9 · LMS 30 · MMS 80 · 알림톡 6 · 브랜드 20」)
 *
 * 경위: 회사 생성 CT 가 단가 칸을 쓰지 않아 새 회사는 단가가 빈 채로 만들어졌다(운영 실측 1021 = 해지 아닌 122곳이 알림톡 · 브랜드 빈 칸).
 *   빈 칸이면 선불 = 그 유형 발송 차단(알림톡은 결과별 정산 생략 → 문자 단가로 깎임) · 후불 = 청구서 발행 차단(WEB_UNIT_PRICE_UNSET).
 *
 * 못 박는 것:
 *   1. 생성 INSERT 가 다섯 단가 칸과 기준(unit_price_basis)을 한 문장에서 쓴다(생성 경로 3곳이 모두 이 CT 를 지난다).
 *   2. 그 값으로 만든 회사는 선불 차감 · 후불 청구 판정에서 「미설정」이 아니다(브랜드 비친구는 친구 단가를 따른다).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ calls: [] as { sql: string; params?: any[] }[] }));

vi.mock('../../config/database', () => {
  const client = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      h.calls.push({ sql, params });
      return { rows: /INSERT INTO companies/.test(sql) ? [{ id: 'c-1021' }] : [] };
    }),
    release: vi.fn(),
  };
  return { default: { connect: vi.fn(async () => client) }, query: vi.fn(async () => ({ rows: [] })) };
});
vi.mock('../system-sync-user', () => ({ ensureSystemSyncUser: vi.fn(async () => undefined) }));
vi.mock('../plan-change-log', () => ({ recordPlanChange: vi.fn(async () => undefined) }));
vi.mock('../account-issue', () => ({ recordAccountIssued: vi.fn(async () => undefined), recordCompanyRegistered: vi.fn(async () => undefined) }));

import { createCompanyCore } from '../company-create';
import { NEW_COMPANY_DEFAULT_PRICES, resolveChargeUnitPriceDetailed } from '../unit-price';
import { resolveBillingUnitPricesDetailed } from '../send-usage-aggregation';

/** INSERT 칼럼 목록과 값 배열을 짝지어 돌려준다 */
function insertedRow(): Record<string, any> {
  const ins = h.calls.find((c) => /INSERT INTO companies/.test(c.sql));
  expect(ins, '회사 INSERT 가 없다').toBeTruthy();
  const cols = ins!.sql.match(/INSERT INTO companies \(([\s\S]*?)\)\s*VALUES/)![1].split(',').map((s) => s.trim());
  const placeholders = ins!.sql.match(/VALUES \(([\s\S]*?)\)/)![1].split(',').map((s) => s.trim());
  expect(placeholders.length).toBe(cols.length);
  expect(ins!.params!.length).toBe(cols.length);
  return Object.fromEntries(cols.map((c, i) => [c, ins!.params![Number(placeholders[i].slice(1)) - 1]]));
}

describe('새 회사 기본 단가(1021)', () => {
  it('값 = Harold 확정(공급가 · VAT 별도)', () => {
    expect(NEW_COMPANY_DEFAULT_PRICES).toEqual({ basis: 'vat_excluded', sms: 9, lms: 30, mms: 80, kakao: 6, brand: 20 });
  });

  it('생성 INSERT 가 다섯 단가와 기준을 한 문장에서 쓴다 · 브랜드 비친구 칸은 쓰지 않는다', async () => {
    h.calls.length = 0;
    await createCompanyCore({ companyCode: 'T1021', companyName: '기본단가 시험' });
    const row = insertedRow();
    expect(row.cost_per_sms).toBe(9);
    expect(row.cost_per_lms).toBe(30);
    expect(row.cost_per_mms).toBe(80);
    expect(row.cost_per_kakao).toBe(6);
    expect(row.cost_per_brand).toBe(20);
    expect(row.unit_price_basis).toBe('vat_excluded');
    expect(row).not.toHaveProperty('cost_per_brand_nonfriend');
    // 기존 칸은 그대로(순서가 밀려 다른 칸에 값이 들어가지 않았다)
    expect(row.company_code).toBe('T1021');
    expect(row.usage_type).toBe('web');
  });

  it('그 값으로 만든 회사는 선불 차감 · 후불 청구에서 미설정이 아니다', () => {
    const co = {
      unit_price_basis: NEW_COMPANY_DEFAULT_PRICES.basis,
      cost_per_sms: NEW_COMPANY_DEFAULT_PRICES.sms, cost_per_lms: NEW_COMPANY_DEFAULT_PRICES.lms, cost_per_mms: NEW_COMPANY_DEFAULT_PRICES.mms,
      cost_per_kakao: NEW_COMPANY_DEFAULT_PRICES.kakao, cost_per_brand: NEW_COMPANY_DEFAULT_PRICES.brand, cost_per_brand_nonfriend: null,
    };
    for (const t of ['SMS', 'LMS', 'MMS', 'KAKAO', 'BRAND']) expect(resolveChargeUnitPriceDetailed(co, t).unset, t).toBe(false);
    // 선불 차감 = 부가세 포함가
    expect(resolveChargeUnitPriceDetailed(co, 'KAKAO').price).toBeCloseTo(6.6, 6);
    expect(resolveChargeUnitPriceDetailed(co, 'BRAND', { targeting: 'N' }).price).toBeCloseTo(22, 6);
    // 후불 청구 = 공급가 · 막히는 유형 0
    const { prices, unsetKeys } = resolveBillingUnitPricesDetailed(co);
    expect(unsetKeys).toEqual([]);
    expect(prices.KAKAO).toBe(6);
    expect(prices.BRAND).toBe(20);
    expect(prices.BRAND_NF).toBe(20);
  });

  it('생성 경로 3곳은 모두 이 CT 를 지난다(직접 INSERT 0)', () => {
    const routes = join(__dirname, '../../routes');
    for (const f of ['companies.ts', 'gateway-templates.ts', 'pay-mappings.ts']) {
      const src = readFileSync(join(routes, f), 'utf8');
      expect(src, f).toContain('createCompanyCore(');
      expect(src, f).not.toMatch(/INSERT INTO companies\b(?!_)/);
    }
  });
});
