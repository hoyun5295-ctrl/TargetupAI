/**
 * 담당자 브랜드메시지 테스트 발송 = 테스트 청구 "테스트 브랜드메시지"(브랜드 단가) (★2026-09-26 한줄로 V2 S1-H06 · Harold 결정 「브랜드 단가로 청구」)
 *
 * 옛: 테스트 발송의 브랜드 행이 `app_etc1 = userId`(bill_id 없음)로 적재돼 테스트 청구(`app_etc1='test'`)·테스트 결과 화면에서 빠졌다.
 *   선불은 차감 시점에 브랜드 단가로 이미 깎이지만 후불은 한 푼도 청구되지 않았다.
 *   'test'로만 바꾸면 청구 집계가 msg_type 'F'를 테스트 LMS로 셌다(브랜드 테스트 항목이 없었다).
 * 처방: 적재 = 'test' + bill_id(문자 테스트와 같은 자리) · 청구 유형 TEST_BRAND 신설(전용 단가 칸 없음 · 브랜드 친구 단가를 따른다 —
 *   스팸테스트가 일반 단가를 따르는 것과 같은 형태) · 발행 항등식에 합류 · 테스트 결과 화면은 표시 CT로 유형·본문·금액을 낸다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const mysqlCalls: Array<{ sql: string; params: any[] }> = [];
vi.mock('../../config/database', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    mysqlQuery: vi.fn(async (sql: string, params: any[]) => { mysqlCalls.push({ sql, params }); return []; }),
  };
});

import { BILLING_TYPES, testBillingTypeKey } from '../billing-types';
import { resolveBillingUnitPricesDetailed } from '../send-usage-aggregation';
import { insertBrandQueue } from '../sms-queue';

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('청구 유형 TEST_BRAND', () => {
  it('표에 있고 전용 단가 칸이 없다', () => {
    const t = BILLING_TYPES.find((x) => x.key === 'TEST_BRAND');
    expect(t).toBeTruthy();
    expect(t!.label).toBe('테스트 브랜드메시지');
    expect(t!.companyPriceColumn).toBeNull();
    expect(t!.agentPriceColumn).toBeNull();
    expect(t!.smsqCode).toBeNull();
  });

  it('테스트 행 유형 판정: S=테스트 SMS · F/FN=테스트 브랜드 · 그 밖 = 종전대로 테스트 LMS', () => {
    expect(testBillingTypeKey('S')).toBe('TEST_SMS');
    expect(testBillingTypeKey('L')).toBe('TEST_LMS');
    expect(testBillingTypeKey('M')).toBe('TEST_LMS');
    expect(testBillingTypeKey('F')).toBe('TEST_BRAND');
    expect(testBillingTypeKey('FN')).toBe('TEST_BRAND');
  });

  it('단가 = 브랜드(친구) 단가 · 브랜드 단가가 비면 미설정으로 드러난다', () => {
    const set = resolveBillingUnitPricesDetailed({ cost_per_sms: 9, cost_per_lms: 30, cost_per_brand: 15, unit_price_basis: 'supply' });
    expect(set.prices.TEST_BRAND).toBe(set.prices.BRAND);
    expect(set.prices.TEST_BRAND).toBeGreaterThan(0);
    expect(set.unsetKeys).not.toContain('TEST_BRAND');
    const unset = resolveBillingUnitPricesDetailed({ cost_per_sms: 9, cost_per_lms: 30, unit_price_basis: 'supply' });
    expect(unset.prices.TEST_BRAND).toBe(0);
    expect(unset.unsetKeys).toContain('TEST_BRAND');
  });
});

describe('브랜드 적재 bill_id', () => {
  beforeEach(() => { mysqlCalls.length = 0; });
  const row = { phone: '01000000000', callback: '0212345678', msgContents: '{"MESSAGE":"a"}', etcJson: '{"SENDERKEY":"k"}', nextType: 'N' as const, companyId: 'c1' };

  it('계정을 넘기면 bill_id에 싣는다', async () => {
    await insertBrandQueue(['SMSQ_TEST'], [row], 'test', 'user-1');
    expect(mysqlCalls).toHaveLength(1);
    expect(mysqlCalls[0].sql).toContain('bill_id');
    expect(mysqlCalls[0].params).toContain('user-1');
    expect(mysqlCalls[0].params).toContain('test');
  });

  it('넘기지 않으면 종전 구문 그대로(bill_id 칸 없음)', async () => {
    await insertBrandQueue(['SMSQ_X'], [row], 'camp-1');
    expect(mysqlCalls[0].sql).not.toContain('bill_id');
  });
});

describe('배선', () => {
  it('테스트 발송 브랜드 행 = test + 계정', () => {
    const c = src('routes/campaigns.ts');
    expect(c).toMatch(/await insertBrandQueue\(\[testSendTable\], \[\{[\s\S]*?\}\], 'test', testBillId\);/);
  });
  it('청구 집계 두 축이 같은 판정을 쓴다', () => {
    const a = src('utils/send-usage-aggregation.ts');
    expect(a).not.toContain("row.msg_type === 'S' ? 'TEST_SMS' : 'TEST_LMS'");
    expect(a.match(/testBillingTypeKey\(row\.msg_type\)/g)?.length).toBe(2);
  });
  it('발행 항등식에 테스트 브랜드가 들어간다', () => {
    expect(src('utils/billing-issue.ts')).toContain('(totalTestBrand * prices.TEST_BRAND)');
  });
  it('테스트 결과 화면은 표시 CT로 유형·본문을 내고 브랜드는 브랜드 단가로 센다', () => {
    const c = src('routes/campaigns.ts');
    expect(c).toContain('type: getSendTypeLabel(r.msg_type),');
    expect(c).toContain('content: getDisplayContents(r.msg_type, r.msg_contents),');
    expect(c).toContain("r.msg_type === 'F' ? costRow.brand");
    expect(src('routes/admin.ts')).toContain('msgType: getSendTypeLabel(r.msg_type),');
    expect(src('routes/manage-stats.ts')).toContain('msgType: getSendTypeLabel(r.msg_type),');
  });
  it('라벨: PDF·관리자 화면', () => {
    expect(src('utils/billing-pdf.ts')).toContain("TEST_BRAND: '테스트브랜드메시지'");
    expect(readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'pages', 'AdminDashboard.tsx'), 'utf8'))
      .toContain("TEST_BRAND: '테스트브랜드메시지'");
  });
});
