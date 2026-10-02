/**
 * 수신동의 읽기 전환 (★2026-10-02 · B-1001-8 재접수 · 설계서 docs/2026-09-22-mall-consent-isolation-design.md §13)
 *
 * 접수: 「회원 정보에 동의 값이 없으면 동의」 규칙으로 소속 행을 채웠는데 고객사 화면의 수신동의 수와 발송 대상이 그대로였다.
 * 원인: 수신동의를 읽는 자리가 전부 고객 행(`customers.sms_opt_in`)을 읽었다 — 진실(소속 행)은 옮겼는데 읽는 자리를 옮기지 않았다.
 * 수정: 읽는 자리는 `X.sms_opt_in = true` 를 손으로 적지 않고 CT 조각(mall-consent consentSql)을 넣는다.
 *
 * ① 몰 동의 회사가 아니면 조각이 옛 글자 그대로다(다른 고객사 SQL 은 1바이트도 달라지지 않는다 · DB 도 읽지 않는다)
 * ② 분류코드 사용자 = 내 코드의 소속 행 중 하나라도 동의 / 관리자 = 한 몰 이상 동의 + 어느 몰에서도 거부 없음 · 모름 = 어느 쪽도 아님
 * ③ 읽는 자리 전수가 CT 를 쓴다(직접 읽기 잔존 = 허용 목록뿐)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import {
  consentSql, consentJoinSql, viewerConsentJoin, consentCountTrue, consentWithUnsub, LEGACY_CONSENT, resolveConsentScope, resolveViewerConsentScope, resolveOwnerConsentScope,
  resolveAdminSendConsent, brandConsentOption, ownerConsentTrue, ownerConsentSql, journeyOwnerConsent, ownerJourneyConsent, readOwnerConsentForCustomer, viewerConsentSql,
  type ConsentScope,
} from '../mall-consent';
import { buildJourneySafetyFilter } from '../journey-safety-filter';
import { applyCustomerConditions } from '../journey-target-extractor';
import { buildChannelEligibilityWhere } from '../channel-eligibility';
import { buildCustomerFilter, buildDynamicFilterCompat, buildFilterQueryCompat } from '../customer-filter';
import { buildAudienceWhere } from '../operator-recipients';
import { buildDynamicSelectExpr } from '../enabled-fields';
import { fetchTargetSampleCustomer } from '../target-sample';
import { countTargetByFilter } from '../target-count';
import { previewMatching } from '../ai-segment-generator';
import { resolveOperatorAudienceGates } from '../operator-audience';

const ES = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49';
const OTHER = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const q = query as unknown as ReturnType<typeof vi.fn>;
const ENV = 'MALL_CONSENT_ENFORCE_COMPANY_IDS';
const saved = process.env[ENV];

beforeEach(() => { q.mockReset(); delete process.env[ENV]; });
afterEach(() => { if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved; });

const MALLS = ['렌즈고고', '일본이모'];
/** DB 모의: 자사몰 연동 코드 · 사용자 분류코드 · 사용자 유형 · 여정 작성자 */
const db = (o: { malls?: string[]; userCodes?: string[] | null; userType?: string; journeyOwner?: string | null; consentOk?: boolean } = {}) =>
  q.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM company_integrations')) return { rows: (o.malls ?? MALLS).map((c) => ({ store_code: c })) };
    if (sql.includes('SELECT store_codes FROM users')) return { rows: [{ store_codes: o.userCodes ?? null }] };
    if (sql.includes('SELECT user_type FROM users')) return { rows: [{ user_type: o.userType ?? 'admin' }] };
    if (sql.includes('FROM journeys')) return { rows: [{ created_by: o.journeyOwner ?? null }] };
    if (sql.includes('has_match')) return { rows: [{ has_match: true }] };
    if (sql.includes('has_stores')) return { rows: [{ has_stores: true }] };
    if (sql.includes(' AS ok FROM customers c')) return { rows: [{ ok: o.consentOk ?? false }] };
    return { rows: [] };
  });

const userScope: ConsentScope = { mode: 'mall', companyId: ES, codes: ['렌즈고고'], admin: false };
const adminScope: ConsentScope = { mode: 'mall', companyId: ES, codes: MALLS, admin: true };
const row = (id: string, codes: string, v: 'true' | 'false') =>
  `EXISTS (SELECT 1 FROM customer_stores mcs WHERE mcs.company_id = '${ES}' AND mcs.customer_id = ${id} AND mcs.store_code = ANY(ARRAY[${codes}]::text[]) AND mcs.sms_opt_in = ${v})`;

describe('consentSql — 조각(순수)', () => {
  it('몰 동의 회사가 아니면 옛 글자 그대로(별칭 · 별칭 없음 둘 다)', () => {
    expect(consentSql(LEGACY_CONSENT, 'c')).toEqual({ mode: 'legacy', isTrue: 'c.sms_opt_in = true', isFalse: 'c.sms_opt_in = false', value: 'c.sms_opt_in' });
    expect(consentSql(LEGACY_CONSENT, '', 'customers.id')).toEqual({ mode: 'legacy', isTrue: 'sms_opt_in = true', isFalse: 'sms_opt_in = false', value: 'sms_opt_in' });
    expect(consentSql(LEGACY_CONSENT, 'cu').isTrue).toBe('cu.sms_opt_in = true');
  });
  it('분류코드 사용자 = 내 코드의 소속 행 중 하나라도 동의 · 거부 = 동의 행이 없고 거부 행이 있음 · 모름(NULL · 행 없음)은 어느 쪽도 아니다', () => {
    const c = consentSql(userScope, 'c');
    const T = row('c.id', "'렌즈고고'", 'true');
    const F = row('c.id', "'렌즈고고'", 'false');
    expect(c.mode).toBe('mall');
    expect(c.isTrue).toBe(T);
    expect(c.isFalse).toBe(`(NOT ${T} AND ${F})`);
    expect(c.value).toBe(`(CASE WHEN ${T} THEN true WHEN (NOT ${T} AND ${F}) THEN false ELSE NULL END)`);
    // 고객 행 열을 읽지 않는다(퇴역) — 소속 표 별칭으로만 읽는다
    expect(c.isTrue).not.toMatch(/\bc\.sms_opt_in\b/);
  });
  it('관리자(범위 없음) = 어느 몰에서도 거부 없음 + 한 몰 이상 동의 · 몰 소속 행이 없는 고객(업로드)은 고객 행 값', () => {
    const c = consentSql(adminScope, 'c');
    const codes = "'렌즈고고','일본이모'";
    const any = `EXISTS (SELECT 1 FROM customer_stores mcs WHERE mcs.company_id = '${ES}' AND mcs.customer_id = c.id AND mcs.store_code = ANY(ARRAY[${codes}]::text[]))`;
    // 고객 행 값으로 읽는 고객 = 몰 코드의 소속 행이 없고 자사몰 연동으로 들어온 적(회원 연결)도 없다
    const linked = `EXISTS (SELECT 1 FROM cdp_identity_links mil WHERE mil.company_id = '${ES}' AND mil.customer_id = c.id)`;
    const uploadOnly = `(NOT ${any} AND NOT ${linked})`;
    expect(c.isTrue).toBe(`(NOT ${row('c.id', codes, 'false')} AND (${row('c.id', codes, 'true')} OR (c.sms_opt_in = true AND ${uploadOnly})))`);
    expect(c.isFalse).toBe(`(${row('c.id', codes, 'false')} OR (c.sms_opt_in = false AND ${uploadOnly}))`);
    // 「거부 없음」이 맨 앞(WHERE 에서 안티 조인으로 풀리는 자리)
    expect(c.isTrue.startsWith('(NOT EXISTS (SELECT 1 FROM customer_stores mcs')).toBe(true);
    // 별칭 없는 쿼리: 고객 행 열도 표 이름으로 한정한다
    expect(consentSql(adminScope, '', 'customers_unified.id').isTrue).toContain('(customers_unified.sms_opt_in = true AND (NOT EXISTS');
    expect(consentSql(adminScope, '', 'customers_unified.id').isTrue).toContain('mil.customer_id = customers_unified.id');
  });
  it('strict(여정): 분류코드 범위 안 어느 몰에서든 거부면 동의가 아니다 · 관리자 조각은 strict 여부와 무관하게 같다', () => {
    const two: ConsentScope = { mode: 'mall', companyId: ES, codes: MALLS, admin: false };
    const codes = "'렌즈고고','일본이모'";
    const T = row('c.id', codes, 'true');
    const F = row('c.id', codes, 'false');
    expect(consentSql(two, 'c').isTrue).toBe(T);
    const s = consentSql(two, 'c', undefined, { strict: true });
    expect([s.isTrue, s.isFalse]).toEqual([`(NOT ${F} AND ${T})`, F]);
    expect(consentSql(adminScope, 'c', undefined, { strict: true })).toEqual(consentSql(adminScope, 'c'));
    expect(consentSql(LEGACY_CONSENT, 'c', undefined, { strict: true }).isTrue).toBe('c.sms_opt_in = true');
  });
  it('별칭 없는 쿼리는 고객 id 열을 표 이름으로 받는다 · 한정하지 않은 id 는 거절한다(소속 표 안에서 다른 열로 읽힌다)', () => {
    expect(consentSql(userScope, '', 'customers_unified.id').isTrue).toBe(row('customers_unified.id', "'렌즈고고'", 'true'));
    expect(() => consentSql(userScope, '', 'id')).toThrow(/한정/);
    expect(() => consentSql(userScope, '')).toThrow(/한정/);
    expect(() => consentSql(userScope, 'c', 'c.id; DROP TABLE x')).toThrow(/한정/);
  });
  it('값은 리터럴로 감싼다(작은따옴표가 든 분류코드 · 파라미터 번호를 건드리지 않는다)', () => {
    const c = consentSql({ mode: 'mall', companyId: ES, codes: ["a'b"], admin: false }, 'c');
    expect(c.isTrue).toContain("ARRAY['a''b']::text[]");
    expect(c.isTrue).not.toMatch(/\$\d/);
  });
  it('코드가 하나도 없는 몰 동의 범위 = 아무도 동의가 아니다(빈 배열과 비교 → 통과 0)', () => {
    const c = consentSql({ mode: 'mall', companyId: ES, codes: [], admin: true }, 'c');
    expect(c.isTrue).toContain('ANY(ARRAY[]::text[])');
  });
});

describe('consentJoinSql — 집계용(조인 형태) 조각', () => {
  it('몰 동의 회사가 아니면 조인이 없고 조각이 옛 글자 그대로다', () => {
    expect(consentJoinSql(LEGACY_CONSENT, '', 'customers.id')).toEqual({ mode: 'legacy', join: '', isTrue: 'sms_opt_in = true', isFalse: 'sms_opt_in = false', value: 'sms_opt_in' });
    expect(consentJoinSql(LEGACY_CONSENT, 'c')).toEqual({ mode: 'legacy', join: '', isTrue: 'c.sms_opt_in = true', isFalse: 'c.sms_opt_in = false', value: 'c.sms_opt_in' });
  });
  it('몰 동의 = 소속 표를 한 번 훑어 고객별 (동의 있음 · 거부 있음)을 만들어 조인한다 · 판정은 행 단위 조각과 같다', () => {
    const u = consentJoinSql(userScope, 'c');
    expect(u.join).toBe(
      " LEFT JOIN (SELECT mcs.customer_id, bool_or(mcs.sms_opt_in) AS t, bool_or(NOT mcs.sms_opt_in) AS f FROM customer_stores mcs"
      + ` WHERE mcs.company_id = '${ES}' AND mcs.store_code = ANY(ARRAY['렌즈고고']::text[]) GROUP BY mcs.customer_id) mcj ON mcj.customer_id = c.id`,
    );
    expect([u.isTrue, u.isFalse]).toEqual(['mcj.t IS TRUE', '(mcj.t IS NOT TRUE AND mcj.f IS TRUE)']);
    const a = consentJoinSql(adminScope, '', 'customers.id');
    expect(a.join).toContain('mcj ON mcj.customer_id = customers.id');
    // 관리자: 거부 없음 + (한 몰 이상 동의 또는 몰 소속 행이 없고 고객 행 동의) — 행 단위 조각과 같은 판정
    const up = `(mcj.customer_id IS NULL AND NOT EXISTS (SELECT 1 FROM cdp_identity_links mil WHERE mil.company_id = '${ES}' AND mil.customer_id = customers.id))`;
    expect([a.isTrue, a.isFalse]).toEqual([
      `(mcj.f IS NOT TRUE AND (mcj.t IS TRUE OR (customers.sms_opt_in = true AND ${up})))`,
      `(mcj.f IS TRUE OR (customers.sms_opt_in = false AND ${up}))`,
    ]);
    expect(a.value).toBe(`(CASE WHEN ${a.isTrue} THEN true WHEN ${a.isFalse} THEN false ELSE NULL END)`);
    // 조인이 내놓는 열은 customer_id · t · f 뿐(별칭 없는 쿼리의 열과 겹치지 않는다) · 파라미터를 쓰지 않는다
    expect(a.join).not.toMatch(/\$\d/);
    expect(() => consentJoinSql(userScope, '', 'id')).toThrow(/한정/);
  });
  it('수신거부 차감(consentCountTrue)은 조인 형태 조각에도 같은 식으로 붙는다', () => {
    const a = consentJoinSql(adminScope, '', 'customers.id');
    expect(consentCountTrue(a, USER, 'customers.phone'))
      .toBe(`(${a.isTrue} AND NOT EXISTS (SELECT 1 FROM unsubscribes mu WHERE mu.user_id = '${USER}' AND mu.phone = customers.phone))`);
  });
  it('집계 자리는 조인을 FROM 에 붙인다(소스 계약) — 대시보드 · 고객 통계 · AI 문맥 통계 8곳', () => {
    const read = (f: string) => readFileSync(join(__dirname, '../..', f), 'utf8');
    expect(read('routes/companies.ts')).toContain('FROM customers${consent.join}');
    expect(read('routes/customers.ts')).toContain('uo ON uo.phone = c.phone${consent.join}');
    expect((read('routes/ai.ts').match(/FROM customers\$\{consentU\.join\}/g) || [])).toHaveLength(4);
    for (const f of ['utils/citations.ts', 'utils/crm-agency-proposal.ts', 'utils/planner-executor.ts', 'utils/continuous-operator.ts']) {
      expect(read(f), f).toContain('FROM customers${statsConsent.join}');
    }
    // FILTER 안에 행 단위 조각(소속 표를 행마다 찾는 식)을 넣은 집계가 없다: FILTER 를 쓰는 파일의 조각은 전부 조인 형태로 만든 것이다
    const ai = read('routes/ai.ts');
    const filterLines = ai.split(/\r?\n/).map((l, i) => ({ l, i })).filter(({ l }) => l.includes('FILTER (WHERE ${consentU.isTrue})'));
    expect(filterLines).toHaveLength(4);
    for (const { i } of filterLines) {
      const above = ai.split(/\r?\n/).slice(Math.max(0, i - 8), i).join('\n');
      expect(above).toContain("const consentU = await viewerConsentJoin(companyId, req.user, '', 'customers.id');");
    }
  });
  it('요청 사용자 한 줄 헬퍼: 켜지 않았으면 조인 없음', async () => {
    db();
    expect((await viewerConsentJoin(ES, { userId: USER, userType: 'company_admin' }, '', 'customers.id')).join).toBe('');
    process.env[ENV] = ES;
    expect((await viewerConsentJoin(ES, { userId: USER, userType: 'company_admin' }, '', 'customers.id')).join).toContain('mcj ON mcj.customer_id = customers.id');
  });
});

describe('consentCountTrue — 화면의 「수신동의 수」', () => {
  it('몰 동의 회사가 아니면 옛 글자 · 몰 동의 회사는 보는 사람의 수신거부를 뺀다', () => {
    expect(consentCountTrue(consentSql(LEGACY_CONSENT, '', 'customers.id'), USER, 'customers.phone')).toBe('sms_opt_in = true');
    const c = consentSql(userScope, '', 'customers.id');
    expect(consentCountTrue(c, USER, 'customers.phone'))
      .toBe(`(${c.isTrue} AND NOT EXISTS (SELECT 1 FROM unsubscribes mu WHERE mu.user_id = '${USER}' AND mu.phone = customers.phone))`);
  });
  it('consentWithUnsub: 옛 판정이면 받은 조각 그대로(같은 객체) · 몰 동의면 isTrue 에만 수신거부 제외가 붙는다', () => {
    const leg = consentSql(LEGACY_CONSENT, 'c');
    expect(consentWithUnsub(leg, USER, 'c.phone')).toBe(leg);
    const c = consentSql(userScope, 'c');
    const w = consentWithUnsub(c, USER, 'c.phone');
    expect(w.isTrue).toBe(`(${c.isTrue} AND NOT EXISTS (SELECT 1 FROM unsubscribes mu WHERE mu.user_id = '${USER}' AND mu.phone = c.phone))`);
    expect([w.isFalse, w.value, w.mode]).toEqual([c.isFalse, c.value, 'mall']);
  });
  it('타겟 인원 · DM 대상 조회는 수신거부 제외를 합친 조각을 쓴다(소스 계약)', () => {
    const read = (f: string) => readFileSync(join(__dirname, '../..', f), 'utf8');
    const line = "consentWithUnsub(await ownerConsentSql(companyId, req.user?.userId, 'c'), req.user?.userId, 'c.phone');";
    expect(read('routes/targets.ts').split(line)).toHaveLength(4);
    expect(read('routes/dm.ts').split(line)).toHaveLength(2);
  });
  it('보는 사람을 모르거나 id 모양이 아니면 빼지 않는다 · 전화 열은 표로 한정해야 한다', () => {
    const c = consentSql(userScope, '', 'customers.id');
    expect(consentCountTrue(c, null, 'customers.phone')).toBe(c.isTrue);
    expect(consentCountTrue(c, "x' OR 1=1 --", 'customers.phone')).toBe(c.isTrue);
    expect(() => consentCountTrue(c, USER, 'phone')).toThrow(/한정/);
  });
});

describe('범위 판정 — 누구 기준으로 읽는가', () => {
  it('ENV 가 비어 있으면 옛 판정이고 DB 를 읽지 않는다(전 함수)', async () => {
    db();
    expect(await resolveConsentScope(ES, ['렌즈고고'])).toEqual(LEGACY_CONSENT);
    expect(await resolveViewerConsentScope(ES, { userId: USER, userType: 'company_user' })).toEqual(LEGACY_CONSENT);
    expect(await resolveOwnerConsentScope(ES, USER)).toEqual(LEGACY_CONSENT);
    expect(await resolveAdminSendConsent(ES)).toBeNull();
    expect(await ownerConsentTrue(ES, USER)).toBe('c.sms_opt_in = true');
    expect(await journeyOwnerConsent(ES, 'j1')).toBeUndefined();
    expect(await ownerJourneyConsent(ES, USER)).toBeUndefined();
    expect(await readOwnerConsentForCustomer(ES, USER, 'c1')).toBeNull();
    expect((await viewerConsentSql(ES, { userId: USER, userType: 'company_user' }, '', 'customers.id')).isTrue).toBe('sms_opt_in = true');
    expect(q).not.toHaveBeenCalled();
  });
  it('ENV 에 없는 회사 = 옛 판정(DB 를 읽지 않는다) · 몰 연동이 없는 회사 = 옛 판정', async () => {
    process.env[ENV] = ES;
    db();
    expect(await resolveConsentScope(OTHER, null)).toEqual(LEGACY_CONSENT);
    expect(q).not.toHaveBeenCalled();
    db({ malls: [] });
    expect(await resolveConsentScope(ES, null)).toEqual(LEGACY_CONSENT);
  });
  it('켠 회사 · 범위 없음 = 관리자 기준(회사의 몰 코드 전부) · 코드 범위 = 그 코드(중복 제거)', async () => {
    process.env[ENV] = ES;
    db();
    expect(await resolveConsentScope(ES, null)).toEqual({ mode: 'mall', companyId: ES, codes: MALLS, admin: true });
    expect(await resolveConsentScope(ES, [])).toEqual({ mode: 'mall', companyId: ES, codes: MALLS, admin: true });
    expect(await resolveConsentScope(ES, ['렌즈고고', '렌즈고고'])).toEqual({ mode: 'mall', companyId: ES, codes: ['렌즈고고'], admin: false });
  });
  it('범위 코드에 몰 동의 코드가 하나도 없으면 옛 판정(발송 판정 resolveSendConsent 와 같은 단위) · 섞이면 몰 동의', async () => {
    process.env[ENV] = ES;
    db();
    expect(await resolveConsentScope(ES, ['업로드브랜드'])).toEqual(LEGACY_CONSENT);
    expect(await resolveConsentScope(ES, ['업로드브랜드', '일본이모'])).toEqual({ mode: 'mall', companyId: ES, codes: ['업로드브랜드', '일본이모'], admin: false });
  });
  it('요청 사용자: 담당자 = 배정 코드 · 관리자 = 범위 없음 · 관리자가 브랜드를 고르면 그 브랜드', async () => {
    process.env[ENV] = ES;
    db({ userCodes: ['일본이모'] });
    expect(await resolveViewerConsentScope(ES, { userId: USER, userType: 'company_user' })).toEqual({ mode: 'mall', companyId: ES, codes: ['일본이모'], admin: false });
    expect(await resolveViewerConsentScope(ES, { userId: USER, userType: 'company_admin' })).toEqual({ mode: 'mall', companyId: ES, codes: MALLS, admin: true });
    expect(await resolveViewerConsentScope(ES, { userId: USER, userType: 'company_admin', pickedCodes: ['렌즈고고'] })).toEqual({ mode: 'mall', companyId: ES, codes: ['렌즈고고'], admin: false });
    // 고른 브랜드가 몰 동의 코드가 아니면 관리자 기준으로 읽는다(옛 판정으로 열지 않는다)
    expect(await resolveViewerConsentScope(ES, { userId: USER, userType: 'company_admin', pickedCodes: ['업로드브랜드'] })).toEqual({ mode: 'mall', companyId: ES, codes: MALLS, admin: true });
    // 담당자가 고른 브랜드는 쓰지 않는다 — 담당자의 범위는 배정 코드다
    expect(await resolveViewerConsentScope(ES, { userId: USER, userType: 'company_user', pickedCodes: ['렌즈고고'] })).toEqual({ mode: 'mall', companyId: ES, codes: ['일본이모'], admin: false });
  });
  it('주인: DB 유형이 담당자(user)면 그 분류코드 · 그 밖(관리자·시스템·없음)은 범위 없음', async () => {
    process.env[ENV] = ES;
    db({ userCodes: ['렌즈고고'], userType: 'user' });
    expect(await resolveOwnerConsentScope(ES, USER)).toEqual({ mode: 'mall', companyId: ES, codes: ['렌즈고고'], admin: false });
    expect((await ownerConsentSql(ES, USER, 'c')).mode).toBe('mall');
    db({ userCodes: ['렌즈고고'], userType: 'admin' });
    expect(await resolveOwnerConsentScope(ES, USER)).toEqual({ mode: 'mall', companyId: ES, codes: MALLS, admin: true });
    expect(await resolveOwnerConsentScope(ES, null)).toEqual({ mode: 'mall', companyId: ES, codes: MALLS, admin: true });
  });
  it('여정 = 작성자 기준 · 범위 없는 발송(관리자) 조각 · 발송 직전 재판정', async () => {
    process.env[ENV] = ES;
    db({ userCodes: ['렌즈고고'], userType: 'user', journeyOwner: USER, consentOk: true });
    const strict = consentSql(userScope, 'c', undefined, { strict: true });
    expect(await journeyOwnerConsent(ES, 'j1')).toEqual({ isTrue: strict.isTrue, isFalse: strict.isFalse, value: strict.value });
    expect(await ownerJourneyConsent(ES, USER)).toEqual({ isTrue: strict.isTrue, isFalse: strict.isFalse, value: strict.value });
    expect(await resolveAdminSendConsent(ES)).toEqual({ isTrue: consentSql(adminScope, 'c').isTrue, mallCodes: MALLS });
    expect(await readOwnerConsentForCustomer(ES, USER, 'c1')).toBe(true);
    db({ userCodes: ['렌즈고고'], userType: 'user', journeyOwner: USER, consentOk: false });
    expect(await readOwnerConsentForCustomer(ES, USER, 'c1')).toBe(false);
    const sql = String(q.mock.calls.find((c) => String(c[0]).includes(' AS ok FROM customers c'))![0]);
    expect(sql).toContain(`SELECT ${consentSql(userScope, 'c', undefined, { strict: true }).isTrue} AS ok`);   // 추출과 같은 strict 조각
    expect(sql).toContain('c.id = $1::uuid AND c.company_id = $2::uuid');
  });
});

describe('CT 들이 조각을 받는다 — 안 주면 옛 글자 그대로', () => {
  const OLD_SAFETY = "c.is_active = true AND c.sms_opt_in = true AND c.is_opt_out IS NOT TRUE AND c.is_invalid IS NOT TRUE "
    + "AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone)";
  it('여정 안전필터', () => {
    expect(buildJourneySafetyFilter('c')).toBe(OLD_SAFETY);
    expect(buildJourneySafetyFilter('c', undefined)).toBe(OLD_SAFETY);
    expect(buildJourneySafetyFilter('c', 'c.sms_opt_in = true')).toBe(OLD_SAFETY);
    const T = consentSql(userScope, 'c').isTrue;
    expect(buildJourneySafetyFilter('c', T)).toBe(OLD_SAFETY.replace('c.sms_opt_in = true', T));
  });
  it('여정 고객 조건의 「수신동의」 필드: 조각이 없으면 고객 행 열(종전 글자) · 있으면 안전필터와 같은 기준의 값으로 비교', () => {
    const conds = [{ field: 'sms_opt_in', op: '==', value: true }, { field: 'grade', op: '==', value: 'VIP' }];
    const p0: any[] = [ES];
    expect(applyCustomerConditions(conds, 'AND', p0)).toBe('(c.sms_opt_in = $2 AND c.grade = $3)');
    expect(p0).toEqual([ES, true, 'VIP']);
    const j = consentSql(userScope, 'c', undefined, { strict: true });
    const p1: any[] = [ES];
    expect(applyCustomerConditions(conds, 'AND', p1, j)).toBe(`(${j.value} = $2 AND c.grade = $3)`);
    expect(p1).toEqual([ES, true, 'VIP']);   // 파라미터는 그대로 — 글자만 바뀐다
    expect(applyCustomerConditions([{ field: 'sms_opt_in', op: 'is_null', value: null }], 'AND', [ES], j)).toBe(`(${j.value} IS NULL)`);
    // 다른 필드는 조각과 무관
    expect(applyCustomerConditions([{ field: 'grade', op: '==', value: 'VIP' }], 'AND', [ES], j)).toBe('(c.grade = $2)');
  });
  it('채널 자격(문자 · 카카오) · 이메일·인앱은 수신동의 조각을 쓰지 않는다', () => {
    const OLD = "c.is_active = true AND c.sms_opt_in = true AND (c.is_opt_out = false OR c.is_opt_out IS NULL) AND (c.is_invalid = false OR c.is_invalid IS NULL)";
    expect(buildChannelEligibilityWhere('dm', 'c')).toBe(OLD);
    expect(buildChannelEligibilityWhere('kakao', 'c')).toBe(OLD);
    const T = consentSql(userScope, 'c').isTrue;
    expect(buildChannelEligibilityWhere('dm', 'c', T)).toBe(OLD.replace('c.sms_opt_in = true', T));
    expect(buildChannelEligibilityWhere('email', 'c', T)).toBe(buildChannelEligibilityWhere('email', 'c'));
    expect(buildChannelEligibilityWhere('inapp', 'c', T)).toBe('c.is_active = true');
  });
  it('자동마케팅 대상 WHERE: 게이트에 조각이 없으면 옛 글자 · 있으면 그 조각', () => {
    const p0: any[] = [ES];
    const base = buildAudienceWhere(p0, '', '', {});
    expect(base).toContain('AND c.sms_opt_in = true ');
    const T = consentSql(adminScope, 'c').isTrue;
    const p1: any[] = [ES];
    const mall = buildAudienceWhere(p1, '', '', { consentTrue: T });
    expect(mall).toBe(base.replace('c.sms_opt_in = true', T));
    expect(p1).toEqual(p0);   // 파라미터 번호가 달라지지 않는다
  });
  it('조건의 「수신동의」 필드: 조각이 없거나 옛 판정이면 종전 글자·종전 파라미터 · 몰 동의면 소속 행 기준(파라미터 없음)', () => {
    const f = { sms_opt_in: { operator: 'eq', value: 'true' }, grade: { operator: 'eq', value: 'VIP' } };
    const opt = { tableAlias: 'c', startParamIndex: 2, storeCodeMode: 'skip' as const, inputFormat: 'structured' as const };
    const old = buildCustomerFilter(f, opt);
    expect(old.sql).toBe(' AND c.sms_opt_in = $2 AND c.grade = $3');
    expect(old.params).toEqual([true, 'VIP']);
    expect(buildCustomerFilter(f, { ...opt, consent: consentSql(LEGACY_CONSENT, 'c') })).toEqual(old);
    const c = consentSql(userScope, 'c');
    const mall = buildCustomerFilter(f, { ...opt, consent: c });
    expect(mall.sql).toBe(` AND ${c.isTrue} AND c.grade = $2`);
    expect(mall.params).toEqual(['VIP']);
    const refuse = buildCustomerFilter({ sms_opt_in: { operator: 'eq', value: 'false' } }, { ...opt, consent: c });
    expect(refuse.sql).toBe(` AND ${c.isFalse}`);
    // 고객 화면 래퍼(별칭 없음)
    expect(buildDynamicFilterCompat({ sms_opt_in: { operator: 'eq', value: 'true' } }, 3)).toEqual({ where: ' AND sms_opt_in = $3', params: [true], nextIndex: 4 });
    const cu = consentSql(userScope, '', 'customers_unified.id');
    expect(buildDynamicFilterCompat({ sms_opt_in: { operator: 'eq', value: 'true' } }, 3, { consent: cu })).toEqual({ where: ` AND ${cu.isTrue}`, params: [], nextIndex: 3 });
  });
  it('타겟의 브랜드 조건: 옛 판정 = 종전 글자 · 분류코드 범위 = 그 소속 행 동의 · 관리자 = 고른 브랜드가 몰 동의 코드일 때만 요구', () => {
    expect(brandConsentOption(LEGACY_CONSENT)).toEqual({});
    expect(brandConsentOption(userScope)).toEqual({ storeConsent: true });
    expect(brandConsentOption(adminScope)).toEqual({ storeConsentMallCodes: MALLS });
    const f = { store_code: '렌즈고고' };
    const old = buildFilterQueryCompat(f, ES);
    expect(buildFilterQueryCompat(f, ES, brandConsentOption(LEGACY_CONSENT))).toEqual(old);
    expect(old.where).toBe(' AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = $2)');
    const strict = buildFilterQueryCompat(f, ES, brandConsentOption(userScope));
    expect(strict.where).toBe(' AND c.id IN (SELECT mcs.customer_id FROM customer_stores mcs WHERE mcs.company_id = $1 AND mcs.store_code = $2 AND mcs.sms_opt_in = true)');
    const admin = buildFilterQueryCompat(f, ES, brandConsentOption(adminScope));
    expect(admin.where).toBe(
      " AND c.id IN (SELECT mcs.customer_id FROM customer_stores mcs WHERE mcs.company_id = $1 AND mcs.store_code = $2"
      + " AND (mcs.sms_opt_in = true OR NOT (mcs.store_code = ANY(ARRAY['렌즈고고','일본이모']::text[]))))",
    );
    // 파라미터·자리표 번호는 세 경우 모두 같다
    expect([strict.params, admin.params, strict.nextIndex, admin.nextIndex]).toEqual([old.params, old.params, old.nextIndex, old.nextIndex]);
    // 여러 브랜드를 고른 경우(IN)도 같은 규칙
    const many = buildFilterQueryCompat({ store_code: { operator: 'in', value: ['렌즈고고', '업로드브랜드'] } }, ES, brandConsentOption(adminScope));
    expect(many.where).toContain('mcs.store_code = ANY($2::text[]) AND (mcs.sms_opt_in = true OR NOT (mcs.store_code = ANY(ARRAY[');
  });
  it('엑셀 값(화면 ≡ 엑셀): 값 식을 안 주면 고객 행 열 · 주면 그 식', () => {
    const fields: any[] = [{ field_key: 'sms_opt_in', column_name: 'sms_opt_in', data_type: 'boolean', is_custom: false }];
    const old = buildDynamicSelectExpr(fields, { unsubParamIndex: 4, tableAlias: 'customers_unified' }).selectExpr;
    expect(old).toContain('THEN false ELSE sms_opt_in END AS sms_opt_in');
    const v = consentSql(userScope, '', 'customers_unified.id').value;
    expect(buildDynamicSelectExpr(fields, { unsubParamIndex: 4, tableAlias: 'customers_unified', consentValueExpr: v }).selectExpr)
      .toBe(old.replace('ELSE sms_opt_in END', `ELSE ${v} END`));
  });
});

describe('실제 함수가 내보내는 SQL — 옛 판정은 옛 글자 · 몰 동의는 소속 행', () => {
  const sqls = () => q.mock.calls.map((c) => String(c[0])).filter((x) => /FROM customers c/.test(x));
  const OLD = 'c.sms_opt_in = true';

  it('자동발송 샘플 고객(fetchTargetSampleCustomer): 브랜드가 정해졌으면 그 소속 행 · 브랜드 조건도 같은 행에서 동의를 본다', async () => {
    db();
    await fetchTargetSampleCustomer({ companyId: ES, targetFilter: { store_code: '렌즈고고' }, userId: USER, storeCode: '렌즈고고' } as any);
    const legacy = sqls();
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toContain(`AND ${OLD}`);
    expect(legacy[0]).not.toContain('mcs.sms_opt_in');

    q.mockReset(); process.env[ENV] = ES; db();
    await fetchTargetSampleCustomer({ companyId: ES, targetFilter: { store_code: '렌즈고고' }, userId: USER, storeCode: '렌즈고고' } as any);
    const mall = sqls();
    expect(mall).toHaveLength(1);
    expect(mall[0]).toContain(consentSql(userScope, 'c').isTrue);
    expect(mall[0]).not.toContain(OLD);
    // 타겟의 브랜드 조건 = 그 브랜드 소속 행의 동의(같은 행)
    expect(mall[0]).toMatch(/c\.id IN \(SELECT mcs\.customer_id FROM customer_stores mcs WHERE mcs\.company_id = \$1 AND mcs\.store_code = \$2 AND mcs\.sms_opt_in = true\)/);
    // 글자만 바뀐다 — 파라미터 배열은 옛 판정과 같다
    const pOld = q.mock.calls.find((c) => /FROM customers c/.test(String(c[0])))![1];
    expect(pOld).toEqual([ES, '렌즈고고', '렌즈고고', USER]);
  });

  it('자동마케팅 게이트 단일 문: 켜지 않은 회사는 키를 싣지 않는다(게이트 객체 종전 그대로) · 켠 회사는 주인 기준 조각을 싣는다', async () => {
    db({ userCodes: ['렌즈고고'], userType: 'user' });
    const off = await resolveOperatorAudienceGates(ES, null, USER);
    expect('consentTrue' in off).toBe(false);
    process.env[ENV] = ES;
    const on = await resolveOperatorAudienceGates(ES, null, USER);
    expect(on.consentTrue).toBe(consentSql(userScope, 'c').isTrue);
    // 주인을 안 넘기면 범위 없음(관리자 기준) — 옛 판정으로 열리지 않는다
    const noOwner = await resolveOperatorAudienceGates(ES, null);
    expect(noOwner.consentTrue).toBe(consentSql(adminScope, 'c').isTrue);
    // 그 조각이 대상 WHERE 에 들어간다
    expect(buildAudienceWhere([ES], '', '', on)).toContain(`AND ${on.consentTrue} `);
  });

  it('타겟 인원(countTargetByFilter): 조각을 안 주면 옛 글자 · 주면 채널 자격과 조건의 수신동의 필드가 같은 기준', async () => {
    db();
    q.mockResolvedValue({ rows: [{ cnt: 0 }] });
    await countTargetByFilter(ES, 'dm' as any, { sms_opt_in: { operator: 'eq', value: 'true' } }, '');
    const legacy = sqls();
    expect(legacy).toHaveLength(3);
    expect(legacy[1]).toContain(`c.is_active = true AND ${OLD} `);
    expect(legacy[1]).toContain(' AND c.sms_opt_in = $2');

    q.mockReset(); q.mockResolvedValue({ rows: [{ cnt: 0 }] });
    const c = consentSql(userScope, 'c');
    await countTargetByFilter(ES, 'dm' as any, { sms_opt_in: { operator: 'eq', value: 'false' } }, '', c);
    const mall = sqls();
    expect(mall[1]).toContain(`c.is_active = true AND ${c.isTrue} `);
    expect(mall[1]).toContain(` AND ${c.isFalse}`);
    expect(mall[1]).not.toContain(OLD);
    expect(q.mock.calls[1][1]).toEqual([ES]);   // 수신동의 필드가 파라미터를 쓰지 않는다
  });

  it('세그먼트 미리보기(previewMatching): 요청자를 안 넘기면 관리자 기준 · 담당자를 넘기면 그 사람의 분류코드 기준', async () => {
    db();
    await previewMatching(ES, {} as any).catch(() => undefined);
    expect(sqls().every((x) => x.includes(OLD))).toBe(true);
    expect(sqls().length).toBeGreaterThan(0);

    q.mockReset(); process.env[ENV] = ES; db();
    await previewMatching(ES, {} as any).catch(() => undefined);
    const mall = sqls();
    expect(mall.length).toBeGreaterThan(0);
    for (const x of mall) {
      expect(x).toContain(`AND ${consentSql(adminScope, 'c').isTrue}`);
      // 홀로 선 옛 조건(`AND c.sms_opt_in = true` 뒤에 줄바꿈)은 없다 — 고객 행 값은 「몰 소속 행이 없는 고객」 갈래 안에서만 읽는다
      expect(x).not.toMatch(/AND c\.sms_opt_in = true\s*\n/);
      expect(x).toContain('(c.sms_opt_in = true AND (NOT EXISTS (SELECT 1 FROM customer_stores mcs');
    }
    // 담당자(DB 유형 user · 배정 코드 렌즈고고)가 요청자면 그 사람의 발송과 같은 기준(관리자 기준이면 다른 몰의 거부로 0명이 된다)
    q.mockReset(); db({ userCodes: ['렌즈고고'], userType: 'user' });
    await previewMatching(ES, {} as any, 5, USER).catch(() => undefined);
    for (const x of sqls()) expect(x).toContain(`AND ${consentSql(userScope, 'c').isTrue}`);
    expect(sqls().length).toBeGreaterThan(0);
  });
});

describe('읽는 자리 전수 — 직접 읽기 잔존은 허용 목록뿐(소스 계약)', () => {
  const SRC = join(__dirname, '../..');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' || n === 'node_modules' ? [] : walk(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
  const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, '/');
  // 주석 줄은 뺀다(설명에 옛 글자가 남아 있다)
  const codeLines = (p: string) => readFileSync(p, 'utf8').split(/\r?\n/)
    .map((l, i) => ({ l, no: i + 1 }))
    .filter(({ l }) => !/^\s*(\/\/|\*|\/\*|--)/.test(l))
    .filter(({ l }) => !/rows\[0\]\.sms_opt_in/.test(l));   // 조회 결과 객체에 값을 넣는 JS 줄(SQL 아님)

  /**
   * 고객 행을 직접 읽어도 되는 자리(사유):
   *  - CT 자신 · 안전필터/채널 자격의 기본값(조각을 안 줄 때의 옛 글자)
   *  - 쓰기·동기화(고객 행 값을 쓰는 쪽 — 읽기 전환의 대상이 아니다)
   *  - 샘플 고객 1명(개인화 미리보기용 한 행 — 인원·발송 대상이 아니다)
   *  - 동종 업체 평균과 견주는 통계(다른 회사 행과 같은 식으로 세야 한다)
   */
  const ALLOW: Record<string, string> = {
    'utils/mall-consent.ts': 'CT',
    'utils/store-scope.ts': '소속 행 조건(브랜드 + 동의 같은 행)',
    'utils/journey-safety-filter.ts': '기본값',
    'utils/channel-eligibility.ts': '기본값',
    'utils/unsubscribe-helper.ts': '쓰기·동기화',
    'routes/unsubscribes.ts': '쓰기·동기화',
    'routes/sync.ts': '쓰기·동기화',
    'routes/upload.ts': '쓰기·동기화',
    'utils/cdp-identity.ts': '쓰기·동기화',
    'utils/customer-upsert.ts': '쓰기·동기화',
    'routes/cdp.ts': '쓰기·동기화',
    'routes/campaigns.ts': '샘플 고객 1명(테스트 발송)',
    'routes/spam-filter.ts': '샘플 고객 1명(스팸 검사)',
    'utils/spam-test-queue.ts': '샘플 고객 1명(스팸 검사)',
    'utils/performance-benchmark.ts': '동종 평균 통계',
  };
  const RAW = /sms_opt_in\s*=\s*(true|false)\b/;

  it('발송 대상·인원·화면 값을 만드는 파일에는 `sms_opt_in = true/false` 가 남아 있지 않다', () => {
    const left = walk(SRC)
      .filter((p) => !(rel(p) in ALLOW))
      .flatMap((p) => codeLines(p).filter(({ l }) => RAW.test(l)).map(({ no, l }) => `${rel(p)}:${no} ${l.trim().slice(0, 80)}`));
    expect(left).toEqual([]);
  });
  it('허용 목록의 샘플·통계 파일은 그 자리 수만큼만 남아 있다(새로 늘면 여기서 걸린다)', () => {
    const count = (f: string) => codeLines(join(SRC, f)).filter(({ l }) => RAW.test(l)).length;
    expect(count('routes/campaigns.ts')).toBe(1);
    expect(count('routes/spam-filter.ts')).toBe(1);
    expect(count('utils/spam-test-queue.ts')).toBe(2);
    expect(count('utils/performance-benchmark.ts')).toBe(3);   // 쿼리 2 + 출처 표기 문자열 1
    expect(count('utils/journey-safety-filter.ts')).toBe(1);
    expect(count('utils/channel-eligibility.ts')).toBe(1);
  });
  it('여정 추출기: 안전필터는 전부 조각을 받는다(14곳) · 조각 없는 호출이 없다', () => {
    const s = readFileSync(join(SRC, 'utils/journey-target-extractor.ts'), 'utf8');
    expect(s.match(/buildJourneySafetyFilter\('c', consent\?\.isTrue\)\}\$\{scopeSql\}/g)).toHaveLength(14);
    // 고객 조건도 같은 조각을 받는다(조건의 수신동의 필드) — 14곳
    expect(s.match(/applyCustomerConditions\((filters|f)\.customer_conditions \|\| \[\], (filters|f)\.logic \|\| 'AND', params, consent\);/g)).toHaveLength(14);
    expect(s).not.toMatch(/buildJourneySafetyFilter\('c'\)/);
  });
  it('안전필터를 조각 없이 부르는 자리가 없다(전 파일)', () => {
    const left = walk(SRC).filter((p) => rel(p) !== 'utils/journey-safety-filter.ts')
      .flatMap((p) => codeLines(p).filter(({ l }) => /buildJourneySafetyFilter\('c'\)/.test(l)).map(({ no }) => `${rel(p)}:${no}`));
    expect(left).toEqual([]);
  });
  it('범위 조각을 인자로 바로 넘기는 자리는 동의 조각을 함께 넘긴다(여정 호출부)', () => {
    for (const f of ['utils/journey-activation.ts', 'utils/journey-anchor-scheduler.ts', 'utils/journey-simulator.ts', 'utils/journey-trigger-watcher.ts', 'routes/ai.ts']) {
      const s = readFileSync(join(SRC, f), 'utf8');
      const inline = s.match(/(?<!= )await getJourneyOwnerScopeSql\([^()]+\)(, await journeyOwnerConsent\([^()]+\))?/g) || [];
      expect(inline.length, f).toBeGreaterThan(0);
      for (const m of inline) expect(m, f).toMatch(/, await journeyOwnerConsent\(/);
    }
  });
  it('자동마케팅 게이트 단일 문은 호출부마다 주인을 받는다(3번째 인자)', () => {
    const calls = walk(SRC).flatMap((p) => codeLines(p)
      .filter(({ l }) => /resolveOperatorAudienceGates\(/.test(l) && !/export async function/.test(l))
      .map(({ l, no }) => ({ at: `${rel(p)}:${no}`, l })));
    expect(calls.length).toBe(5);
    for (const c of calls) expect(c.l, c.at).toMatch(/resolveOperatorAudienceGates\([^,]+,[^,]+,[^)]+\)/);
  });
  it('채널 자격을 조각 없이 부르는 자리가 없다(CT 정의 제외)', () => {
    const left = walk(SRC).filter((p) => rel(p) !== 'utils/channel-eligibility.ts')
      .flatMap((p) => codeLines(p).filter(({ l }) => /buildChannelEligibilityWhere\([^,()]+, 'c'\)/.test(l)).map(({ no }) => `${rel(p)}:${no}`));
    expect(left).toEqual([]);
  });
});
