/**
 * mall-consent.test.ts — 몰별 수신동의 CT (설계서 docs/2026-09-22-mall-consent-isolation-design.md §4-1·§4-2·§4-4)
 *
 * H1 수신동의의 법적 단위 = 몰 · H2 한 몰의 동의·거부가 다른 몰에 영향을 주지 않는다.
 * ① 몰 동의 분류코드 = 해제 아닌 자사몰 연동 행의 meta.store_code (customer_stores 행 유무로 판정하지 않는다 — 업로드·싱크 브랜드 회사는 불변)
 * ② 읽기 강제는 ENV 로 회사 단위 · 꺼짐 = 지금과 같은 SQL 문자열
 * ③ 강제 = 고객 행 sms_opt_in 퇴역 + 범위 서브쿼리 안에서 몰 동의(true)만 통과 → NULL·행 없음 = 모름 = 제외
 * ④ 쓰기 upsertStoreConsent 는 컬럼 미존재(DDL 전)에도 적재를 죽이지 않는다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import {
  getMallConsentStoreCodes,
  isMallConsentEnforced,
  buildSendConsent,
  resolveSendConsent,
  upsertStoreConsent,
  _resetMallConsentWarnForTest,
} from '../mall-consent';

const COMPANY = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49';
const OTHER = '22222222-2222-4222-8222-222222222222';
const q = query as unknown as ReturnType<typeof vi.fn>;
const ENV = 'MALL_CONSENT_ENFORCE_COMPANY_IDS';
const saved = process.env[ENV];

beforeEach(() => { q.mockReset(); delete process.env[ENV]; _resetMallConsentWarnForTest(); });
afterEach(() => { if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved; });

const mallRows = (codes: (string | null)[]) => q.mockImplementation(async (sql: string) =>
  (sql.includes('FROM company_integrations') ? { rows: codes.filter((c) => c).map((c) => ({ store_code: c })) } : { rows: [] }));

describe('몰 동의 분류코드 · ENV 강제', () => {
  it('해제 아닌 자사몰 연동 행의 meta.store_code 만 · 중복 제거 · 조회 조건에 revoked 제외와 빈 코드 제외가 있다', async () => {
    mallRows(['이로이로도쿄', '일본이모', '이로이로도쿄']);
    expect(await getMallConsentStoreCodes(COMPANY)).toEqual(['이로이로도쿄', '일본이모']);
    const sql = String(q.mock.calls[0][0]);
    expect(sql).toMatch(/status <> 'revoked'/);
    expect(sql).toMatch(/meta->>'store_code'/);
  });
  it('ENV 빈 값 = 아무도 아님 · 목록 = 그 회사만 · * = 몰 동의 분류코드가 있는 회사만', async () => {
    mallRows(['이로이로도쿄']);
    expect(await isMallConsentEnforced(COMPANY)).toBe(false);
    process.env[ENV] = `${OTHER}, ${COMPANY}`;
    expect(await isMallConsentEnforced(COMPANY)).toBe(true);
    process.env[ENV] = OTHER;
    expect(await isMallConsentEnforced(COMPANY)).toBe(false);
    process.env[ENV] = '*';
    expect(await isMallConsentEnforced(COMPANY)).toBe(true);
    mallRows([]);
    expect(await isMallConsentEnforced(COMPANY)).toBe(false);
  });
});

describe('buildSendConsent — 발송 자격 조각(순수)', () => {
  const LEGACY_STORE = ' AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = c.company_id AND store_code = ANY($3::text[]))';
  it('강제 아님 = 지금과 같은 문자열(고객 행 동의 + 기존 범위 서브쿼리)', () => {
    expect(buildSendConsent({ enforce: false, alias: 'c', storeFilter: LEGACY_STORE })).toEqual({ customerConsent: 'c.sms_opt_in = true', storeFilter: LEGACY_STORE, mode: 'legacy' });
    expect(buildSendConsent({ enforce: false, alias: 'c', storeFilter: '' })).toEqual({ customerConsent: 'c.sms_opt_in = true', storeFilter: '', mode: 'legacy' });
  });
  it('강제 = 고객 행 동의 퇴역(TRUE) + 범위 서브쿼리 안에 몰 동의 true — NULL·행 없음은 통과하지 못한다', () => {
    const r = buildSendConsent({ enforce: true, alias: 'c', storeFilter: LEGACY_STORE });
    expect(r.mode).toBe('mall');
    expect(r.customerConsent).toBe('TRUE');
    expect(r.storeFilter).toBe(' AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = c.company_id AND store_code = ANY($3::text[]) AND sms_opt_in = true)');
  });
  it('강제인데 범위 서브쿼리가 없으면(관리자·no_filter) 옛 문자열 그대로 — 몰을 모르는 발송에 몰 동의를 걸 수 없다', () => {
    expect(buildSendConsent({ enforce: true, alias: 'c', storeFilter: '' }).mode).toBe('legacy');
  });
  it('별칭 없는 서브쿼리 모양(직접 타겟)도 같은 규칙', () => {
    const s = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
    const r = buildSendConsent({ enforce: true, alias: 'c', storeFilter: s });
    expect(r.storeFilter).toBe(' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]) AND sms_opt_in = true)');
  });
});

describe('resolveSendConsent — 회사·사용자 코드로 강제 여부를 정한다', () => {
  it('ENV 켜짐 + 사용자 코드가 전부 몰 동의 분류코드 → 강제', async () => {
    process.env[ENV] = COMPANY;
    mallRows(['이로이로도쿄', '일본이모']);
    expect(await resolveSendConsent(COMPANY, ['일본이모'])).toBe(true);
  });
  it('사용자 코드에 몰 동의가 아닌 코드가 섞이면 강제하지 않는다(옛 SQL) · 코드 없음(관리자)도 강제하지 않는다', async () => {
    process.env[ENV] = COMPANY;
    mallRows(['이로이로도쿄']);
    expect(await resolveSendConsent(COMPANY, ['이로이로도쿄', 'CPB'])).toBe(false);
    expect(await resolveSendConsent(COMPANY, [])).toBe(false);
    expect(await resolveSendConsent(COMPANY, undefined)).toBe(false);
  });
  it('ENV 꺼짐 = 조회조차 하지 않는다', async () => {
    mallRows(['이로이로도쿄']);
    expect(await resolveSendConsent(COMPANY, ['이로이로도쿄'])).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
});

describe('upsertStoreConsent — 몰 동의 쓰기', () => {
  it('소속 행 하나만 갱신한다(회사 + 고객 + 분류코드) · 다른 분류코드 행은 조건상 닿지 않는다', async () => {
    q.mockResolvedValue({ rows: [], rowCount: 1 });
    expect(await upsertStoreConsent(COMPANY, 'cust-1', '일본이모', false, 'woocommerce')).toBe(true);
    const [sql, params] = q.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE customer_stores/);
    expect(String(sql)).toMatch(/company_id = \$1::uuid AND customer_id = \$2::uuid AND store_code = \$3/);
    expect(params).toEqual([COMPANY, 'cust-1', '일본이모', false, 'woocommerce']);
  });
  it('컬럼 미존재(DDL 전 · 42703)면 false 를 돌려주고 던지지 않는다 · 경고는 한 번만', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    q.mockRejectedValue(Object.assign(new Error('column "sms_opt_in" of relation "customer_stores" does not exist'), { code: '42703' }));
    expect(await upsertStoreConsent(COMPANY, 'c', '일본이모', true, 'woocommerce')).toBe(false);
    expect(await upsertStoreConsent(COMPANY, 'c', '일본이모', true, 'woocommerce')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('그 밖의 DB 오류는 그대로 던진다(조용히 삼키지 않는다)', async () => {
    q.mockRejectedValue(new Error('connection terminated'));
    await expect(upsertStoreConsent(COMPANY, 'c', '일본이모', true, 'woocommerce')).rejects.toThrow('connection terminated');
  });
  it('분류코드·고객이 비면 아무것도 하지 않는다', async () => {
    expect(await upsertStoreConsent(COMPANY, 'c', '', true, 'woocommerce')).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
});

// ── 소스 계약: 발송이 나가는 자리는 CT 조각을 쓴다(인라인 sms_opt_in 조건으로 되돌아가지 않게) ──
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('소스 계약 — routes/campaigns.ts 발송·세기·미리보기가 같은 동의 조각을 쓴다', () => {
  const src = readFileSync(resolve(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf-8');
  it('POST /:id/send: 고객 행 동의 조건이 CT 조각이고 범위 서브쿼리도 CT 를 지난 값이다', () => {
    const block = src.slice(src.indexOf('const sendConsent = buildSendConsent('), src.indexOf('const customers = customersResult.rows;'));
    expect(block).toContain('resolveSendConsent(companyId, storeParams[0])');
    expect(block).toContain("sendConsent.storeFilter.replace('$STORE_IDX'");
    expect(block).toContain('AND ${sendConsent.customerConsent} ${filterQuery.where}${storeFilterFinal}');
    expect(block).not.toMatch(/c\.sms_opt_in = true/);
  });
  it('캠페인 생성 시 타겟 인원: 분류 범위(getStoreScope)와 같은 조각으로 센다 — 세는 곳 = 보내는 곳', () => {
    const block = src.slice(src.indexOf('let countStoreFilter'), src.indexOf('targetCount = parseInt(countResult.rows[0].count);'));
    expect(block).toContain('getStoreScope(companyId, userId)');
    expect(block).toContain('${countConsent.customerConsent} ${filterQuery.where}${countConsent.storeFilter}');
    expect(block).toContain('[companyId, ...filterQuery.params, ...countStoreParams, userId]');
  });
  it('수신자 미리보기(예약·초안): 건수와 명단이 같은 조각', () => {
    const block = src.slice(src.indexOf('const previewConsent = buildSendConsent('), src.indexOf('// 발송 완료/진행중이면 MySQL'));
    expect((block.match(/\$\{previewConsent\.customerConsent\}/g) || []).length).toBe(2);
    expect(block).not.toMatch(/c\.sms_opt_in = true/);
  });
});
