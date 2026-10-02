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
  applyMissingConsentRule,
  missingConsentSource,
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
  it('자사몰 연동 행의 meta.store_code · 중복 제거 · 빈 코드 제외 · **해제된 연동도 포함**(해제해도 그 몰의 거부는 남는다 — Codex R1)', async () => {
    mallRows(['이로이로도쿄', '일본이모', '이로이로도쿄']);
    expect(await getMallConsentStoreCodes(COMPANY)).toEqual(['이로이로도쿄', '일본이모']);
    const sql = String(q.mock.calls[0][0]);
    expect(sql).not.toMatch(/revoked/);
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
    // 몰 동의 컬럼은 소속 표 별칭으로 한정 — 한정하지 않으면 컬럼 없는 환경에서 바깥 customers.sms_opt_in 으로 새어 통과한다(Codex R1)
    expect(r.storeFilter).toBe(' AND c.id IN (SELECT customer_id FROM customer_stores mcs WHERE company_id = c.company_id AND store_code = ANY($3::text[]) AND mcs.sms_opt_in = true)');
  });
  it('모르는 모양의 서브쿼리에 강제가 걸리면 옛 판정으로 열지 않고 닫는다(FALSE)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = buildSendConsent({ enforce: true, alias: 'c', storeFilter: ' AND c.store_code = $3' });
    expect(r).toMatchObject({ mode: 'mall', customerConsent: 'FALSE' });
    err.mockRestore();
  });
  it('강제인데 범위 서브쿼리가 없으면(관리자·no_filter) 옛 문자열 그대로 — 몰을 모르는 발송에 몰 동의를 걸 수 없다', () => {
    expect(buildSendConsent({ enforce: true, alias: 'c', storeFilter: '' }).mode).toBe('legacy');
  });
  it('별칭 없는 서브쿼리 모양(직접 타겟)도 같은 규칙', () => {
    const s = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
    const r = buildSendConsent({ enforce: true, alias: 'c', storeFilter: s });
    expect(r.storeFilter).toBe(' AND id IN (SELECT customer_id FROM customer_stores mcs WHERE company_id = $1 AND store_code = ANY($2::text[]) AND mcs.sms_opt_in = true)');
  });
});

describe('resolveSendConsent — 회사·사용자 코드로 강제 여부를 정한다', () => {
  it('ENV 켜짐 + 사용자 코드가 몰 동의 분류코드 → 강제', async () => {
    process.env[ENV] = COMPANY;
    mallRows(['이로이로도쿄', '일본이모']);
    expect(await resolveSendConsent(COMPANY, ['일본이모'])).toBe(true);
  });
  it('몰 동의가 아닌 코드가 섞여도 옛 판정으로 되돌리지 않는다(덜 보내는 방향 · 경고) · 몰 코드가 하나도 없으면 강제 아님 · 코드 없음(관리자)도 아님', async () => {
    process.env[ENV] = COMPANY;
    mallRows(['이로이로도쿄']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await resolveSendConsent(COMPANY, ['이로이로도쿄', 'CPB'])).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    expect(await resolveSendConsent(COMPANY, ['CPB'])).toBe(false);
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
  it('그 고객의 그 몰 소속 행 하나에만 쓴다 · 소속 행이 없으면 만들어서 남긴다(명시 값이 0행으로 빠지지 않는다)', async () => {
    q.mockResolvedValue({ rows: [], rowCount: 1 });
    expect(await upsertStoreConsent(COMPANY, 'cust-1', '일본이모', false, 'woocommerce')).toBe(true);
    const [sql, params] = q.mock.calls[0];
    const s = String(sql).replace(/\s+/g, ' ').trim();
    // ★1002 Codex R1: 종전 UPDATE 는 소속 행이 없으면 0행 = 거부가 조용히 사라졌다
    expect(s.startsWith('INSERT INTO customer_stores (company_id, customer_id, store_code, sms_opt_in, consent_source, consent_at)')).toBe(true);
    expect(s).toContain('ON CONFLICT (customer_id, store_code) DO UPDATE SET sms_opt_in = EXCLUDED.sms_opt_in, consent_source = EXCLUDED.consent_source, consent_at = EXCLUDED.consent_at');
    expect(s).toContain('WHERE customer_stores.company_id = EXCLUDED.company_id');
    expect(params).toEqual([COMPANY, 'cust-1', '일본이모', false, 'woocommerce']);
  });
  it('쓴 행이 없으면(다른 회사의 같은 행과 부딪힘) false 를 돌려준다', async () => {
    q.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await upsertStoreConsent(COMPANY, 'cust-1', '일본이모', false, 'woocommerce')).toBe(false);
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

/**
 * ★2026-10-02 「회원 정보에 동의 값이 없으면 동의」 규칙 (이에스페이먼트 대표 확인 = no 만 수신거부 · 아무것도 없거나 YES 는 발송 가능)
 *   채우는 조건은 **저장하는 SQL 한 문장**이 전부 본다(앱 메모리·호출 종류로 판정하지 않는다 — Codex 1002 R1·R2·R3 같은 뿌리):
 *   ⓪ 그 순간 그 몰(회사 · 분류코드)에 **이 회원 정보를 읽은 키**의 규칙이 켜져 있다 ① 모름(NULL)일 때만 = 명시 값(YES·NO)을 덮지 않는다
 *   ② 그 고객에게 그 몰의 다른 회원 연결이 없다(한 계정의 값 없음이 다른 계정의 못 읽은 NO 를 덮지 않게)
 *   실제 판정(켜짐·꺼짐·키 불일치·다른 회원 연결)은 일회용 PostgreSQL 16 실행으로 본다(설계서 §12-6). 여기서는 문장과 인자를 고정한다.
 */
describe('회원 정보 동의 값 없음 규칙 — 몰 단위', () => {
  const KEY = 'mssms_agreement_label';
  const PROFILE = { source: 'woocommerce', externalId: 'lensgogo.info:25', consentKey: KEY, memberIdPrefix: 'lensgogo.info:', memberIdRestPattern: '^[0-9]+$' };
  const filled = (n: number) => q.mockResolvedValue({ rows: [], rowCount: n });

  it('한 문장이 전부 본다 — 규칙이 켜져 있다 · 모름이다 · 그 몰의 다른 회원 연결이 없다 · 출처에 규칙 표시', async () => {
    filled(1);
    expect(await applyMissingConsentRule(COMPANY, 'cust-1', '렌즈고고', PROFILE)).toBe(true);
    expect(q).toHaveBeenCalledTimes(1);
    const [sql, params] = q.mock.calls[0];
    const s = String(sql).replace(/\s+/g, ' ').trim();
    expect(s.startsWith('UPDATE customer_stores SET sms_opt_in = true, consent_source = $4, consent_at = NOW()')).toBe(true);
    expect(s).toContain('WHERE company_id = $1::uuid AND customer_id = $2::uuid AND store_code = $3 AND sms_opt_in IS NULL');
    expect(s).toContain(`AND EXISTS ( SELECT 1 FROM company_integrations ci WHERE ci.company_id = $1::uuid AND ci.meta->>'store_code' = $3 AND ci.meta->>'consent_missing_agree_key' = $9)`);
    expect(s).toContain('AND NOT EXISTS ( SELECT 1 FROM cdp_identity_links l WHERE l.company_id = $1::uuid AND l.customer_id = $2::uuid AND l.source = $5 AND l.external_id <> $6 AND left(l.external_id, char_length($7)) = $7 AND substr(l.external_id, char_length($7) + 1) ~ $8)');
    expect(params).toEqual([COMPANY, 'cust-1', '렌즈고고', 'woocommerce:missing=agree', 'woocommerce', 'lensgogo.info:25', 'lensgogo.info:', '^[0-9]+$', KEY]);
  });
  it('규칙을 앱 메모리에 담아 두지 않는다 — 부를 때마다 그 한 문장만 실행한다(규칙을 끈 뒤 담아 둔 값으로 동의를 다시 만들지 않게)', async () => {
    filled(1);
    await applyMissingConsentRule(COMPANY, 'cust-1', '렌즈고고', PROFILE);
    await applyMissingConsentRule(COMPANY, 'cust-2', '렌즈고고', { ...PROFILE, externalId: 'lensgogo.info:26' });
    expect(q).toHaveBeenCalledTimes(2);
    for (const [sql] of q.mock.calls) expect(String(sql)).toMatch(/^\s*UPDATE customer_stores/);
  });
  it('읽은 키는 앞뒤 공백을 떼고 글자 그대로 규칙의 키와 견준다(다른 키 · 대소문자가 다른 키는 SQL 이 거른다)', async () => {
    filled(0);
    await applyMissingConsentRule(COMPANY, 'cust-1', '렌즈고고', { ...PROFILE, consentKey: ` ${KEY} ` });
    await applyMissingConsentRule(COMPANY, 'cust-1', '렌즈고고', { ...PROFILE, consentKey: 'mssms_agreement' });
    expect(q.mock.calls[0][1][8]).toBe(KEY);
    expect(q.mock.calls[1][1][8]).toBe('mssms_agreement');
  });
  it('조건에 안 걸리면(규칙 꺼짐 · 키 불일치 · 이미 값이 있음 · 다른 회원 연결이 있음) false — 쓴 행이 없다', async () => {
    filled(0);
    expect(await applyMissingConsentRule(COMPANY, 'cust-1', '렌즈고고', PROFILE)).toBe(false);
  });
  it('분류코드·고객이 비거나 읽은 키 · 회원 연결의 모양을 모르면 아무 문장도 실행하지 않는다(판정할 수 없으면 채우지 않는다)', async () => {
    filled(1);
    expect(await applyMissingConsentRule(COMPANY, 'c', '', PROFILE)).toBe(false);
    expect(await applyMissingConsentRule(COMPANY, '', '렌즈고고', PROFILE)).toBe(false);
    expect(await applyMissingConsentRule('', 'c', '렌즈고고', PROFILE)).toBe(false);
    for (const k of ['source', 'externalId', 'consentKey', 'memberIdPrefix', 'memberIdRestPattern'] as const) {
      expect(await applyMissingConsentRule(COMPANY, 'c', '렌즈고고', { ...PROFILE, [k]: '' })).toBe(false);
    }
    expect(await applyMissingConsentRule(COMPANY, 'c', '렌즈고고', undefined as any)).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
  it('컬럼 미존재(42703)는 삼키고 그 밖의 오류는 던진다', async () => {
    q.mockRejectedValueOnce(Object.assign(new Error('column "sms_opt_in" does not exist'), { code: '42703' }));
    expect(await applyMissingConsentRule(COMPANY, 'c', '렌즈고고', PROFILE)).toBe(false);
    q.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(applyMissingConsentRule(COMPANY, 'c', '렌즈고고', PROFILE)).rejects.toThrow('connection terminated');
  });
  it('출처 표기는 칸 폭(60자)을 넘지 않는다', () => {
    expect(missingConsentSource('woocommerce')).toBe('woocommerce:missing=agree');
    expect(missingConsentSource('x'.repeat(80)).length).toBe(60);
  });
  it('읽는 쪽은 그대로 — 발송 자격 조각은 여전히 sms_opt_in = true 하나만 본다(모름도 동의 분기를 읽는 자리에 두지 않는다)', () => {
    const f = buildSendConsent({ enforce: true, alias: 'c', storeFilter: ` AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))` });
    expect(f.storeFilter).toContain('mcs.sms_opt_in = true');
    expect(f.storeFilter).not.toMatch(/IS NULL/);
  });
});

// ── 소스 계약: 발송이 나가는 자리는 CT 조각을 쓴다(인라인 sms_opt_in 조건으로 되돌아가지 않게) ──
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('소스 계약 — routes/campaigns.ts 발송·세기·미리보기가 같은 동의 조각을 쓴다', () => {
  const src = readFileSync(resolve(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf-8');
  it('POST /:id/send: 고객 행 동의 조건이 CT 조각이고 범위 서브쿼리도 CT 를 지난 값이다', () => {
    // ★ 2026-10-01 몰 동의 판정(sendEnforce)을 타겟 필터보다 먼저 구해 타겟 필터와 동의 조각이 같은 값을 쓴다(B-1001-3 · Codex R1 high)
    const head = src.slice(src.indexOf('const sendEnforce = '), src.indexOf('const customers = customersResult.rows;'));
    expect(head).toContain('const sendEnforce = storeParams.length > 0 && (await resolveSendConsent(companyId, storeParams[0]));');
    // ★ 2026-10-02 범위 없는 발송(관리자) 갈래 = CT resolveAdminSendConsent(몰 동의 회사가 아니면 null → 옛 조각)
    expect(head).toContain('const sendAdminConsent = storeParams.length === 0 ? await resolveAdminSendConsent(companyId) : null;');
    expect(head).toContain('buildFilterQueryCompat(targetFilter, companyId, sendAdminConsent ? { storeConsentMallCodes: sendAdminConsent.mallCodes } : { storeConsent: sendEnforce })');
    const block = src.slice(src.indexOf('const sendConsent = buildSendConsent('), src.indexOf('const customers = customersResult.rows;'));
    expect(block).toContain('enforce: sendEnforce,');
    expect(block).toContain("sendConsent.storeFilter.replace('$STORE_IDX'");
    expect(block).toContain('AND ${sendAdminConsent?.isTrue ?? sendConsent.customerConsent} ${filterQuery.where}${storeFilterFinal}');
    expect(block).not.toMatch(/c\.sms_opt_in = true/);
  });
  it('캠페인 생성 시 타겟 인원: 분류 범위(getStoreScope)와 같은 조각으로 센다 — 세는 곳 = 보내는 곳', () => {
    // ★ 2026-10-01 범위·몰 동의 판정을 타겟 필터보다 먼저 구한다(구간 시작 = 범위 배열 선언) — 타겟 필터와 동의 조각이 같은 countEnforce
    const block = src.slice(src.indexOf('const countStoreParams: any[] = [];'), src.indexOf('targetCount = parseInt(countResult.rows[0].count);'));
    expect(block).toContain('getStoreScope(companyId, userId)');
    expect(block).toContain('const countAdminConsent = countStoreParams.length === 0 ? await resolveAdminSendConsent(companyId) : null;');
    expect(block).toContain('buildFilterQueryCompat(targetFilter, companyId, countAdminConsent ? { storeConsentMallCodes: countAdminConsent.mallCodes } : { storeConsent: countEnforce })');
    expect(block).toContain('enforce: countEnforce,');
    expect(block).toContain('${countAdminConsent?.isTrue ?? countConsent.customerConsent} ${filterQuery.where}${countConsent.storeFilter}');
    expect(block).toContain('[companyId, ...filterQuery.params, ...countStoreParams, userId]');
  });
  it('수신자 미리보기(예약·초안): 건수와 명단이 같은 조각', () => {
    const block = src.slice(src.indexOf('const previewConsent = buildSendConsent('), src.indexOf('// 발송 완료/진행중이면 MySQL'));
    expect((block.match(/\$\{previewAdminConsent\?\.isTrue \?\? previewConsent\.customerConsent\}/g) || []).length).toBe(2);
    expect(src).toContain('const previewAdminConsent = storeParams.length === 0 ? await resolveAdminSendConsent(companyId) : null;');
    expect(block).not.toMatch(/c\.sms_opt_in = true/);
  });
});

// ── db_alter_safety_net(Codex 0922 R2): 몰 동의 컬럼 미존재 = 500 이 아니라 503 DB_MIGRATION_PENDING ──
import { isMallConsentMigrationPending, MALL_CONSENT_MIGRATION_PENDING } from '../mall-consent';

describe('몰 동의 컬럼 미존재 → 503 DB_MIGRATION_PENDING', () => {
  it('판정: column + does not exist + sms_opt_in 이 함께 있을 때만', () => {
    expect(isMallConsentMigrationPending(new Error('column mcs.sms_opt_in does not exist'))).toBe(true);
    expect(isMallConsentMigrationPending(new Error('column "foo" does not exist'))).toBe(false);
    expect(isMallConsentMigrationPending(new Error('connection terminated'))).toBe(false);
    expect(MALL_CONSENT_MIGRATION_PENDING).toMatchObject({ code: 'DB_MIGRATION_PENDING' });
    expect(MALL_CONSENT_MIGRATION_PENDING.error).toContain('customer_stores');
  });
  it('조각을 쓰는 세 endpoint(생성·발송·수신자 미리보기)의 catch 가 500 앞에서 503 으로 갈린다 · 옛 판정으로 되돌리는 재시도는 없다', () => {
    const src = readFileSync(resolve(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf-8');
    expect((src.match(/isMallConsentMigrationPending\(error\)/g) || []).length).toBe(3);
    expect((src.match(/json\(MALL_CONSENT_MIGRATION_PENDING\)/g) || []).length).toBe(3);
    for (const marker of ["console.error('캠페인 생성 에러:', error);", "await failCampaignRun(campaignRunId, '발송 처리 중 예기치 못한 오류');", "console.error('수신자 조회 실패:', error);"]) {
      const at = src.indexOf(marker);
      const tail = src.slice(at, at + 400);
      const pendingAt = tail.indexOf('MALL_CONSENT_MIGRATION_PENDING');
      expect(pendingAt).toBeGreaterThan(-1);
      expect(pendingAt).toBeLessThan(tail.indexOf('status(500)'));
    }
  });
});
