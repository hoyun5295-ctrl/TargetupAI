/**
 * ai-line-1018.test.ts — AI 한줄로(설계서 docs/2026-10-18-ai-line-design.md) 판정 · 키 · 금액 · 돈 순서
 *
 * ① 순수 CT(utils/ai-line.ts) ② 서비스 돈 순서(services/ai-line.ts — DB · AI · 원장을 흉내 낸다)
 * ③ 소스 계약(라우트 게이트 · 단가표 백 · 프론트 일치 · 생성기 옵션 · 수동 검사 409 자동 제외)
 * ★ 2026-10-19 스위치 삭제 · 「누구에게」(needAudience = 차감 전 묻기) · 직접 타겟 선택(조건 변환 · 서버 재확인) · 직접 타겟 발송 입구 삭제
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── 서비스가 끌어오는 바깥(돈 · DB · AI)을 흉내 낸다 ──
const m = vi.hoisted(() => ({
  query: vi.fn(),
  isChargedByKey: vi.fn(),
  chargedAmountByKey: vi.fn(),
  hasCreditForStrict: vi.fn(),
  settle: vi.fn(),
  recommendTarget: vi.fn(),
  generateMessages: vi.fn(),
  decorate: vi.fn(),
}));
vi.mock('../../config/database', () => ({ query: m.query, pool: { query: m.query } }));
vi.mock('../ai-credit', async () => {
  const tx = await vi.importActual<any>('../ai-credit-tx');
  return {
    isChargedByKey: m.isChargedByKey,
    // ★ 2026-10-23 문자 입구 판단 몫 = lineJudgeCovered 한 벌(설계서 docs/2026-10-23-oneline-ct-complete-design.md A5) — 키마다 같은 원장 조회로 흉내 낸다 · 콘텐츠 완성 없음
    chargedKeysAmong: async (companyId: string, keys: string[]) => { const s = new Set<string>(); for (const k of keys) if (await m.isChargedByKey(companyId, k)) s.add(k); return s; },
    hasChargeWithKeyPrefix: async () => false,
    chargedAmountByKey: m.chargedAmountByKey,
    hasCreditForStrict: m.hasCreditForStrict,
    settleCreditAfterSuccess: m.settle,
    InsufficientCreditError: tx.InsufficientCreditError,
  };
});
vi.mock('../../services/ai', () => ({
  recommendTarget: m.recommendTarget,
  generateMessages: m.generateMessages,
  extractVarCatalog: () => ({ fieldMappings: {}, availableVars: [] }),
  filterVarCatalogByData: async () => undefined,
}));
vi.mock('../operator-message-decorator', () => ({ decorateOperatorMessages: m.decorate }));
// ★ 1022 문자 입구 기본 납부 판정이 콘텐츠 완성(lineCompletionPaid)도 본다 · 이 시험은 콘텐츠 원장 없음 = 안 냄
vi.mock('../line-steps-context', async () => {
  const real = await vi.importActual<any>('../line-steps-context');
  return { lineCompletionPaid: async () => false, lineJudgeCovered: real.lineJudgeCovered };
});
vi.mock('../hub-company-context', () => ({
  loadHubCompanyContext: async () => ({ companyInfo: { company_name: '테스트', reject_number: '0800000000', customer_schema: null }, customerStats: { total: 10 } }),
}));
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: async () => '' }));
vi.mock('../store-scope', () => ({ resolveHubStoreScope: async () => ({ storeFilter: '', baseParams: ['C1'], blocked: false }) }));
vi.mock('../mall-consent', () => ({ viewerConsentSql: async () => ({ isTrue: 'c.sms_opt_in = true' }), viewerBrandConsent: async () => ({}) }));

import {
  readAiLine, styleToType, sanitizeLineTypes, quoteInLine, filterChipText, aiLineBaseKeys, aiLineBaseKey, aiLineComposeCost,
  aiLineCopyKey, maskName, AI_LINE_TYPE_BY_VARIANT, lineMentionsAllCustomers,
} from '../ai-line';
import { toLineAudienceFilters } from '../../../../frontend/src/utils/customerFilterBuild';
import {
  allCustomersFlag as feAllCustomersFlag, activeFilters as feActiveFilters, newAiLineRun, saveAiLineRun, loadAiLineRun, clearAiLineRuns,
} from '../../../../frontend/src/utils/ai-line';
import { InsufficientCreditError } from '../ai-credit-tx';
import { runLineCompose, runLineIntake, runLineDecorate, runLineRetarget, runLineProceed, runLineAlimtalkMatch, AiLineError, describeLineFilters } from '../../services/ai-line';

const SRC = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const V = { companyId: 'C1', userId: 'U1', userType: 'company_admin' };

describe('① 순수 CT', () => {
  it('read — 갈래 · 빠진 것 · 광고 충돌', () => {
    expect(readAiLine('기초제품 30% 할인할거야 서울사는 30대 여성에게만')).toEqual({ branch: 'sms', gaps: { benefit: false, period: true }, adConflict: false });
    expect(readAiLine('주말 세일 진행해 VIP 에게').gaps.benefit).toBe(true);
    expect(readAiLine('주문 확인 알림톡으로 보낼거야')).toMatchObject({ branch: 'alimtalk', gaps: { benefit: false, period: false }, adConflict: false });
    expect(readAiLine('할인 이벤트 알림톡으로 보내줘').adConflict).toBe(true);
    expect(readAiLine('카톡으로 신상 소식 보내줘').branch).toBe('ask_kakao');
    expect(readAiLine('신상 입고 소식 보내줘').gaps).toEqual({ benefit: false, period: false });
  });
  it('종류 — 추천 글 · 요청 목록', () => {
    expect(styleToType('혜택강조형')).toBe('benefit');
    expect(styleToType('MZ 감성형')).toBe('mz');
    expect(styleToType('감성형')).toBe('emo');
    expect(styleToType('???')).toBeNull();
    expect(sanitizeLineTypes(['emo', 'benefit', 'emo'])).toEqual(['emo', 'benefit']);
    expect(sanitizeLineTypes([])).toBe('invalid');
    expect(sanitizeLineTypes(['direct'])).toBe('invalid');
    expect(AI_LINE_TYPE_BY_VARIANT).toEqual({ A: 'emo', B: 'benefit', C: 'mz' });
  });
  it('출처 — 조각이 한 줄에 있어야 「한 줄」(2글자 이상 · 공백 무시)', () => {
    const line = '기초제품 30% 할인할거야 서울사는 30대 여성에게만';
    expect(quoteInLine(line, '서울')).toBe(true);
    expect(quoteInLine(line, '30 대')).toBe(true);
    expect(quoteInLine(line, '구매 이력')).toBe(false);
    expect(quoteInLine(line, '여')).toBe(false);
    expect(quoteInLine(line, undefined)).toBe(false);
  });
  it('칩 글', () => {
    expect(filterChipText('gender', { operator: 'eq', value: 'F' }, '성별')).toBe('여성');
    expect(filterChipText('age', { operator: 'between', value: [30, 39] }, '나이')).toBe('30대');
    expect(filterChipText('region', { operator: 'contains', value: '서울' }, '지역')).toBe('서울');
    expect(filterChipText('grade', { operator: 'eq', value: 'VIP' }, '고객등급')).toBe('고객등급 VIP');
    expect(filterChipText('total_purchase_amount', { operator: 'gte', value: 100000 }, '누적구매금액')).toBe('누적구매금액 100,000 이상');
  });
  it('키 — 오늘 · 어제 · 길이 상한', () => {
    const now = new Date('2026-10-18T15:30:00Z');   // KST 10-19 00:30
    const keys = aiLineBaseKeys('11111111-1111-4111-8111-111111111111', '한 줄', now);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toContain(':20261019:');
    expect(keys[1]).toContain(':20261018:');
    expect(aiLineBaseKey('11111111-1111-4111-8111-111111111111', '한  줄', now)).toBe(aiLineBaseKey('11111111-1111-4111-8111-111111111111', '한 줄', now));
    const longKey = aiLineCopyKey('11111111-1111-4111-8111-111111111111', 'a'.repeat(64), { x: 1 });
    expect(longKey.length).toBeLessThanOrEqual(150);
  });
  it('금액 — 3안 전부 8 · 기본 냈으면 6', () => {
    expect(aiLineComposeCost(3, false)).toEqual({ base: 2, copies: 6, total: 8 });
    expect(aiLineComposeCost(3, true)).toEqual({ base: 0, copies: 6, total: 6 });
    expect(aiLineComposeCost(1, true).total).toBe(2);
  });
  it('이름 가리기', () => {
    expect(maskName('김민지')).toBe('김*지');
    expect(maskName('남궁민수')).toBe('남**수');
    expect(maskName('김민')).toBe('김*');
    expect(maskName('')).toBe('');
  });
  it('「전체 고객」을 말했는가(말했으면 누구에게를 다시 묻지 않는다)', () => {
    expect(lineMentionsAllCustomers('전체 고객에게 30% 할인 안내')).toBe(true);
    expect(lineMentionsAllCustomers('모든 회원 대상 쿠폰')).toBe(true);
    expect(lineMentionsAllCustomers('고객 전체에게')).toBe(true);
    expect(lineMentionsAllCustomers('알림톡을 활용해서 30% 할인쿠폰 만료안내를 보낼거야')).toBe(false);
    expect(lineMentionsAllCustomers('전체 상품 20% 할인')).toBe(false);
  });
  it('직접 타겟 조건 → 한줄로 대상 조건(나이 이상/이하 · 커스텀 칸 · 성별 여러 개는 막음)', () => {
    const fields = [{ field_key: 'age' }, { field_key: 'custom_3', is_custom: true }, { field_key: 'grade' }];
    expect(toLineAudienceFilters({ age: { operator: 'gte', value: 60 } }, fields).filters).toEqual({ minAge: 60 });
    expect(toLineAudienceFilters({ age: { operator: 'lte', value: 29 } }, fields).filters).toEqual({ maxAge: 29 });
    expect(toLineAudienceFilters({ age: { operator: 'between', value: [30, 39] } }, fields).filters).toEqual({ age: { operator: 'between', value: [30, 39] } });
    expect(toLineAudienceFilters({ custom_3: { operator: 'eq', value: 'A' } }, fields).filters).toEqual({ 'custom_fields.custom_3': { operator: 'eq', value: 'A' } });
    expect(toLineAudienceFilters({ grade: { operator: 'in', value: ['VIP', 'VVIP'] } }, fields).filters).toEqual({ grade: { operator: 'in', value: ['VIP', 'VVIP'] } });
    expect(toLineAudienceFilters({ gender: { operator: 'in', value: ['M', 'F'] } }, fields).unsupported).toEqual(['gender']);
    // 옮긴 조건은 같은 해석기에서 SQL 이 실제로 나온다(버려져 대상이 넓어지지 않는다)
    const conv = toLineAudienceFilters({ age: { operator: 'gte', value: 60 }, custom_3: { operator: 'eq', value: 'A' }, grade: { operator: 'eq', value: 'VIP' } }, fields).filters;
    expect(describeLineFilters('', conv as any, undefined).untranslated).toEqual([]);
  });
  it('옮기지 못한 조건은 따로', () => {
    const d = describeLineFilters('VIP 에게', { grade: { operator: 'eq', value: 'VIP' }, foo: { operator: 'eq', value: '' } }, { grade: 'VIP' });
    expect(d.conditions).toEqual([{ key: 'grade', label: '고객등급', text: '고객등급 VIP', origin: 'line' }]);
    expect(d.untranslated.map((u) => u.key)).toEqual(['foo']);
  });
});

// ── ② 돈 순서 ──
function countIs(n: number) {
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: n }] };
    if (sql.includes('FROM customers c WHERE') && sql.includes('ORDER BY')) return { rows: n > 0 ? [{ id: 'cust-1', name: '김민지', grade: 'VIP' }] : [] };
    if (sql.includes('COUNT(*) AS total')) return { rows: [{ total: n, cnt_name: n, cnt_grade: Math.floor(n / 2) }] };
    return { rows: [] };
  });
}
const composeInput = (over: Partial<Parameters<typeof runLineCompose>[1]> = {}) => ({
  line: '기초제품 30% 할인할거야 서울사는 30대 여성에게만',
  facts: { benefit: null, periodEnd: null },
  filters: { gender: { operator: 'eq', value: 'F' } },
  allCustomers: false,
  types: ['emo', 'benefit'] as any,
  vars: [],
  channel: 'LMS' as const,
  isAd: true,
  attemptToken: 'attempt-12345678',
  ...over,
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.hasCreditForStrict.mockResolvedValue(true);
  m.isChargedByKey.mockResolvedValue(false);
  m.chargedAmountByKey.mockResolvedValue(null);
  m.settle.mockResolvedValue(undefined);
  m.generateMessages.mockResolvedValue({
    variants: [
      { variant_id: 'A', message_text: '감성 문안 본문입니다', subject: '제목A' },
      { variant_id: 'B', message_text: '혜택 문안 본문입니다', subject: '제목B' },
      { variant_id: 'C', message_text: 'MZ 문안 본문입니다', subject: '제목C' },
    ],
  });
});

describe('② 만들기 돈 순서', () => {
  it('0명 = 차감 전 거절(AI 0 · 원장 0)', async () => {
    countIs(0);
    await expect(runLineCompose(V, composeInput())).rejects.toMatchObject({ code: 'TARGET_ZERO' });
    expect(m.generateMessages).not.toHaveBeenCalled();
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('1만 명 초과 = 차감 전 거절', async () => {
    countIs(10001);
    await expect(runLineCompose(V, composeInput())).rejects.toMatchObject({ code: 'TARGET_TOO_MANY' });
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('조건이 비고 전체 선언이 없으면 거절', async () => {
    countIs(5);
    await expect(runLineCompose(V, composeInput({ filters: {} }))).rejects.toMatchObject({ code: 'TARGET_FILTER_EMPTY' });
  });
  it('잔액 부족 = AI 전에 402', async () => {
    countIs(5);
    m.hasCreditForStrict.mockResolvedValue(false);
    await expect(runLineCompose(V, composeInput())).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(m.generateMessages).not.toHaveBeenCalled();
  });
  it('기본 미납 = 기본 2 → 문안 2 × 나온 종류(한 행) · 고른 종류만 카드', async () => {
    countIs(5);
    const out = await runLineCompose(V, composeInput());
    expect(out.cards.map((c) => c.type)).toEqual(['emo', 'benefit']);
    expect(m.settle).toHaveBeenCalledTimes(2);
    expect(m.settle.mock.calls[0][0]).toMatchObject({ cost: 2, source: 'ai-line-intake' });
    expect(m.settle.mock.calls[0][0].idempotencyKey).toMatch(/^aio-base:C1:\d{8}:[0-9a-f]{12}$/);
    expect(m.settle.mock.calls[1][0]).toMatchObject({ cost: 4, source: 'ai-line-compose' });
    expect(m.settle.mock.calls[1][0].idempotencyKey).toMatch(/^aio-copy:C1:attempt-12345678:[0-9a-f]{16}$/);
    expect(out.charged).toEqual({ base: 2, copies: 4 });
  });
  it('기본을 이미 냈으면(어제 키 포함) 문안만', async () => {
    countIs(5);
    m.isChargedByKey.mockResolvedValueOnce(false).mockResolvedValueOnce(true);   // 오늘 없음 · 어제 있음
    const out = await runLineCompose(V, composeInput({ types: ['mz'] as any }));
    expect(m.settle).toHaveBeenCalledTimes(1);
    expect(m.settle.mock.calls[0][0]).toMatchObject({ cost: 2, source: 'ai-line-compose' });
    expect(out.charged.base).toBe(0);
  });
  it('문안이 하나도 안 나오면 0 · 502', async () => {
    countIs(5);
    m.generateMessages.mockResolvedValue({ variants: [{ variant_id: 'A', message_text: '' }] });
    await expect(runLineCompose(V, composeInput({ types: ['emo'] as any }))).rejects.toMatchObject({ code: 'COMPOSE_EMPTY', status: 502 });
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('★ Codex 1R — AI 실패 기본 골격 = 차감 0 · 502', async () => {
    countIs(5);
    m.generateMessages.mockResolvedValue({ fallback: true, variants: [{ variant_id: 'A', message_text: '[혜택 내용을 입력해주세요]' }, { variant_id: 'B', message_text: '골격' }] });
    await expect(runLineCompose(V, composeInput())).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', status: 502 });
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('★ Codex 1R — 이미 낸 시도 = 잔액 확인 0 · 차감 0 · 낸 종류 수까지만', async () => {
    countIs(5);
    m.chargedAmountByKey.mockResolvedValue(2);   // 1종(2)만 냈다
    m.hasCreditForStrict.mockResolvedValue(false);   // 잔액 0 이어도 막히지 않는다
    const out = await runLineCompose(V, composeInput({ attemptToken: 'attempt-paid-0001' }));
    expect(m.hasCreditForStrict).not.toHaveBeenCalled();
    expect(m.settle).not.toHaveBeenCalled();
    expect(out.cards).toHaveLength(1);
    expect(out.charged).toEqual({ base: 0, copies: 0 });
    // 기억한 결과 = 다시 만들지 않는다
    m.generateMessages.mockClear();
    const again = await runLineCompose(V, composeInput({ attemptToken: 'attempt-paid-0001' }));
    expect(m.generateMessages).not.toHaveBeenCalled();
    expect(again.cards.map((c) => c.body)).toEqual(out.cards.map((c) => c.body));
  });
  it('★ Codex 2R — 같은 키 동시 요청 = 한 줄로 · 한 번만 걷고 같은 결과', async () => {
    countIs(5);
    const ledger = new Map<string, number>();
    m.chargedAmountByKey.mockImplementation(async (_c: string, key: string) => (ledger.has(key) ? ledger.get(key)! : null));
    m.settle.mockImplementation(async (o: any) => { if (!ledger.has(o.idempotencyKey)) ledger.set(o.idempotencyKey, o.cost); });
    const [a, b] = await Promise.all([
      runLineCompose(V, composeInput({ attemptToken: 'attempt-race-0001' })),
      runLineCompose(V, composeInput({ attemptToken: 'attempt-race-0001' })),
    ]);
    expect(m.generateMessages).toHaveBeenCalledTimes(1);
    expect(m.settle.mock.calls.filter((c: any[]) => c[0].source === 'ai-line-compose')).toHaveLength(1);
    expect(b.cards.map((c) => c.body)).toEqual(a.cards.map((c) => c.body));
    expect(b.charged).toEqual({ base: 0, copies: 0 });
  });
  it('★ Codex 2R — 정산 뒤 원장이 더 적으면(중복 정산) 낸 종류 수까지만 · 0 으로 알린다', async () => {
    countIs(5);
    m.chargedAmountByKey.mockResolvedValueOnce(null).mockResolvedValueOnce(2);   // 처음 = 미납 · 정산 뒤 = 다른 요청이 1종(2)으로 먼저 냄
    m.isChargedByKey.mockResolvedValue(true);   // 기본은 냄
    const out = await runLineCompose(V, composeInput({ attemptToken: 'attempt-dup-00001' }));
    expect(out.cards).toHaveLength(1);
    expect(out.charged.copies).toBe(0);
  });
  it('칼럼을 고르면 SMS → LMS · 생성기에 exactVars 그대로', async () => {
    countIs(5);
    const out = await runLineCompose(V, composeInput({ channel: 'SMS', vars: ['고객명'] }));
    expect(out.channel).toBe('LMS');
    expect(m.generateMessages.mock.calls[0][2]).toMatchObject({ exactVars: ['고객명'], channel: 'LMS' });
  });
});

describe('② 대상 찾기 돈 순서', () => {
  const target = (filters: any, extra: any = {}) => m.recommendTarget.mockResolvedValue({
    filters, all_customers: false, reasoning: '이유', recommended_channel: 'LMS', is_ad: true, recommended_time: '',
    suggested_campaign_name: '캠페인', personalization_vars: [], filter_quotes: { gender: '여성' }, recommended_style: '혜택강조형', style_reason: '혜택이 분명', ...extra,
  });
  it('1명 이상 · 미납 = 기본 2 한 번 · 추천 종류 · 출처', async () => {
    countIs(3);
    target({ gender: { operator: 'eq', value: 'F' } });
    const out = await runLineIntake(V, '서울 30대 여성에게 기초 30% 할인', new Date('2026-10-18T03:00:00Z'));
    expect(out.count).toBe(3);
    expect(out.conditions[0]).toMatchObject({ key: 'gender', text: '여성', origin: 'line' });
    expect(out.recommend).toEqual({ type: 'benefit', reason: '혜택이 분명' });
    expect(out.top?.name).toBe('김*지');
    expect(m.settle).toHaveBeenCalledTimes(1);
    expect(m.settle.mock.calls[0][0]).toMatchObject({ cost: 2, source: 'ai-line-intake' });
    expect(out.base).toEqual({ paid: true, charged: true, cost: 2 });
    expect(out.needAudience).toBe(false);
  });
  it('받는 사람을 한 줄에서 못 읽음(AI 가 보탠 조건만) = 누구에게 · 차감 0', async () => {
    countIs(4);
    target({ grade: { operator: 'eq', value: 'VIP' } }, { filter_quotes: {} });
    const out = await runLineIntake(V, '알림톡을 활용해서 30% 할인쿠폰 만료안내를 보낼거야');
    expect(out.needAudience).toBe(true);
    expect(out.count).toBe(4);
    expect(m.settle).not.toHaveBeenCalled();
    expect(out.base).toEqual({ paid: false, charged: false, cost: 2 });
  });
  it('「전체 고객」이라고 말함 = 묻지 않는다 · 기본 2', async () => {
    countIs(5);
    target({}, { all_customers: true, filter_quotes: {} });
    const out = await runLineIntake(V, '전체 고객에게 30% 할인 안내 보내줘');
    expect(out.needAudience).toBe(false);
    expect(m.settle).toHaveBeenCalledTimes(1);
  });
  it('0명 = 차감 0 · 사유', async () => {
    countIs(0);
    target({ gender: { operator: 'eq', value: 'F' } });
    const out = await runLineIntake(V, '서울 30대 여성에게 기초 30% 할인');
    expect(out.zeroReason).toBe('zero');
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('조건을 못 옮김 = 0명 · unresolved · 차감 0', async () => {
    countIs(9);
    target({});
    const out = await runLineIntake(V, '유호윤 고객에게만 보내줘');
    expect(out.zeroReason).toBe('unresolved');
    expect(out.count).toBe(0);
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('이미 냈으면 다시 걷지 않는다 · 잔액 확인도 하지 않는다', async () => {
    countIs(3);
    m.isChargedByKey.mockResolvedValue(true);
    target({ gender: { operator: 'eq', value: 'F' } });
    const out = await runLineIntake(V, '서울 30대 여성에게 기초 30% 할인');
    expect(m.hasCreditForStrict).not.toHaveBeenCalled();
    expect(m.settle).not.toHaveBeenCalled();
    expect(out.base).toEqual({ paid: true, charged: false, cost: 2 });
  });
  it('원장 조회 실패 = 503(모르는 납부를 0으로 접지 않는다)', async () => {
    m.isChargedByKey.mockRejectedValue(new Error('db down'));
    await expect(runLineIntake(V, '서울 30대 여성에게 기초 30% 할인')).rejects.toMatchObject({ code: 'CREDIT_LEDGER_UNAVAILABLE', status: 503 });
    expect(m.recommendTarget).not.toHaveBeenCalled();
  });
});

describe('② 대상 바꾸기(직접 타겟 선택 · 0크레딧)', () => {
  it('해석기가 버리는 조건 = untranslated · 1위 고객 · 칼럼을 만들지 않는다', async () => {
    countIs(7);
    const out = await runLineRetarget(V, { age: { operator: 'gte', value: 30 } }, false);
    expect(out.untranslated.map((u) => u.key)).toEqual(['age']);
    expect(out.top).toBeNull();
    expect(m.settle).not.toHaveBeenCalled();
    expect(m.recommendTarget).not.toHaveBeenCalled();
  });
  it('옮긴 조건 = 칩 · 수 · 1위 고객', async () => {
    countIs(7);
    const out = await runLineRetarget(V, { minAge: 30, grade: { operator: 'eq', value: 'VIP' } }, false);
    expect(out.untranslated).toEqual([]);
    expect(out.conditions.map((c) => c.text)).toEqual(['30세 이상', '고객등급 VIP']);
    expect(out.count).toBe(7);
    expect(out.top?.name).toBe('김*지');
    expect(m.settle).not.toHaveBeenCalled();
  });
});

describe('② Codex B1 — 보내는 조건 칸 확인 · 알림톡 기본 · 전체 판정', () => {
  it('만들기 · 진행 = 해석기가 버리는 칸이 있으면 차감 · AI 전에 거절', async () => {
    countIs(5);
    await expect(runLineCompose(V, composeInput({ filters: { age: { operator: 'gte', value: 30 }, grade: { operator: 'eq', value: 'VIP' } } as any })))
      .rejects.toMatchObject({ code: 'TARGET_FILTER_UNTRANSLATED' });
    await expect(runLineProceed(V, '알림톡 쿠폰 만료 안내', { phone: { operator: 'contains', value: '010' } }, false))
      .rejects.toMatchObject({ code: 'TARGET_FILTER_UNTRANSLATED' });
    expect(m.generateMessages).not.toHaveBeenCalled();
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('알림톡 매칭 = 기본 미납이면 확정 대상(1명 이상) 확인 → 매칭 → 기본 한 번 · 냈으면 매칭만', async () => {
    countIs(4);
    const match = vi.fn(async () => 'ok');
    const out = await runLineAlimtalkMatch(V, '알림톡 쿠폰 만료 안내', { grade: { operator: 'eq', value: 'VIP' } }, false, match, () => true);
    expect(out).toEqual({ result: 'ok', charged: true, paid: true });
    expect(m.settle).toHaveBeenCalledTimes(1);
    expect(m.settle.mock.calls[0][0]).toMatchObject({ cost: 2, source: 'ai-line-intake' });
    m.settle.mockClear();
    m.isChargedByKey.mockResolvedValue(true);
    expect(await runLineAlimtalkMatch(V, '알림톡 쿠폰 만료 안내', {}, false, match, () => true)).toEqual({ result: 'ok', charged: false, paid: true });
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('알림톡 매칭 = 미납 + 0명 · 빈 조건 = 매칭 전에 거절(차감 0)', async () => {
    const match = vi.fn(async () => 'ok');
    countIs(0);
    await expect(runLineAlimtalkMatch(V, '알림톡 쿠폰 만료 안내', { grade: { operator: 'eq', value: 'VIP' } }, false, match, () => true)).rejects.toMatchObject({ code: 'TARGET_ZERO' });
    await expect(runLineAlimtalkMatch(V, '알림톡 쿠폰 만료 안내', {}, false, match, () => true)).rejects.toMatchObject({ code: 'TARGET_FILTER_EMPTY' });
    expect(match).not.toHaveBeenCalled();
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('알림톡 매칭 = 고를 템플릿이 없거나 실패 결과면 기본을 걷지 않는다(Codex B2)', async () => {
    countIs(4);
    const out = await runLineAlimtalkMatch(V, '알림톡 쿠폰 만료 안내', { grade: { operator: 'eq', value: 'VIP' } }, false, async () => ({ matched: false }), () => false);
    expect(out).toMatchObject({ charged: false, paid: false });
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('기본 정산 = 정산하는 순간 오늘 · 어제 키를 다시 본다(겹친 입구 · 자정 경계 = 한 번만 · Codex B2)', async () => {
    countIs(3);
    // 진행 앞 확인(오늘 · 어제) = 미납 → 정산 직전 재확인 = 다른 입구가 이미 냄
    m.isChargedByKey.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const out = await runLineProceed(V, '알림톡 쿠폰 만료 안내', { grade: { operator: 'eq', value: 'VIP' } }, false);
    expect(out.charged).toBe(false);
    expect(m.settle).not.toHaveBeenCalled();
  });
  it('화면 전체 판정 = 「누구에게」를 물은 대상 찾기는 사람이 「전체 고객」을 골라야만 · AI 가 못 옮긴 칸은 보내지 않는다', () => {
    const base = newAiLineRun('알림톡 쿠폰 만료 안내');
    const intake: any = { filters: {}, allCustomers: true, needAudience: true, untranslated: [], conditions: [] };
    expect(feAllCustomersFlag({ ...base, intake })).toBe(false);
    expect(feAllCustomersFlag({ ...base, intake, allChecked: true })).toBe(true);
    expect(feAllCustomersFlag({ ...base, intake: { ...intake, needAudience: false } })).toBe(true);
    const withUntr: any = { filters: { grade: { operator: 'eq', value: 'VIP' }, weird: 1, linebad: 2 }, untranslated: [{ key: 'weird', text: 'x', origin: 'ai' }, { key: 'linebad', text: 'y', origin: 'line' }] };
    expect(Object.keys(feActiveFilters({ ...base, intake: withUntr }))).toEqual(['grade', 'linebad']);
  });
});

describe('④ 진행 저장 = 계정별 · 결과 카드 본문 없음(★1019 Harold 실화면)', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); },
      removeItem: (k: string) => { m.delete(k); }, key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; },
    };
  };
  it('계정을 바꾸면 앞 계정 진행이 안 보인다 · 다른 계정 진행은 저장하지 않는다 · 로그아웃 때 지운다', () => {
    vi.stubGlobal('localStorage', mem());
    vi.stubGlobal('sessionStorage', mem());
    try {
      localStorage.setItem('user', JSON.stringify({ id: 'U-hoyun', company: { id: 'C-A' } }));
      const run = newAiLineRun('30% 할인행사를 진행할거야');
      saveAiLineRun(run);
      expect(loadAiLineRun()?.runId).toBe(run.runId);
      localStorage.setItem('user', JSON.stringify({ id: 'U-demo', company: { id: 'C-DEMO' } }));
      expect(loadAiLineRun()).toBeNull();
      saveAiLineRun(run);
      expect(loadAiLineRun()).toBeNull();
      sessionStorage.setItem('ai_line_run_v1', JSON.stringify(run));   // 1019 앞 주인 없는 키
      sessionStorage.setItem('ai_line_alimtalk_handoff', '{}');
      clearAiLineRuns();
      expect(sessionStorage.length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('로그아웃 · 401 이 진행을 지운다 · 알림톡 넘기기는 같은 계정만 · 카드는 본문을 그리지 않는다', () => {
    expect(readFileSync(join(FE, 'stores', 'authStore.ts'), 'utf8')).toContain('clearAiLineRuns();');
    expect(readFileSync(join(FE, 'api', 'client.ts'), 'utf8')).toContain('clearAiLineRuns();');
    expect(readFileSync(join(FE, 'pages', 'Dashboard.tsx'), 'utf8')).toContain('h.owner !== aiLineOwner()');
    const cards = readFileSync(join(FE, 'components', 'ai-line', 'LineResultCards.tsx'), 'utf8');
    expect(cards).not.toContain('<pre');
    expect(cards).not.toContain('highlightVars');
  });
});

describe('② 꾸미기', () => {
  it('글이 바뀐 때만 1', async () => {
    m.decorate.mockResolvedValue({ messages: ['%고객명%님 감성 문안 본문입니다'], kept: [], charged: false });
    const out = await runLineDecorate(V, { body: '감성 문안 본문입니다', vars: ['고객명'], channel: 'LMS', isAd: true, attemptToken: 'attempt-12345678' });
    expect(out.changed).toBe(true);
    expect(m.settle.mock.calls[0][0]).toMatchObject({ cost: 1, source: 'ai-line-decorate' });
  });
  it('★ Codex 1R — 이미 낸 꾸미기 = 잔액 확인 0 · 차감 0', async () => {
    m.chargedAmountByKey.mockResolvedValue(1);
    m.hasCreditForStrict.mockResolvedValue(false);
    m.decorate.mockResolvedValue({ messages: ['%고객명%님 다시 꾸민 본문입니다'], kept: [], charged: false });
    const out = await runLineDecorate(V, { body: '꾸밀 본문입니다 다섯자', vars: ['고객명'], channel: 'LMS', isAd: true, attemptToken: 'attempt-deco-0001' });
    expect(m.hasCreditForStrict).not.toHaveBeenCalled();
    expect(m.settle).not.toHaveBeenCalled();
    expect(out.charged).toBe(0);
  });
  it('원문 그대로면 0', async () => {
    m.decorate.mockResolvedValue({ messages: ['감성 문안 본문입니다'], kept: [], charged: false });
    const out = await runLineDecorate(V, { body: '감성 문안 본문입니다', vars: ['고객명'], channel: 'LMS', isAd: true, attemptToken: 'attempt-12345678' });
    expect(out).toEqual({ body: '감성 문안 본문입니다', changed: false, charged: 0 });
    expect(m.settle).not.toHaveBeenCalled();
  });
});

describe('③ 소스 계약', () => {
  it('단가표 백 · 프론트 일치', () => {
    const be = read('utils/ai-credit-calc.ts');
    const fe = readFileSync(join(FE, 'constants', 'credit.ts'), 'utf8');
    for (const [k, v] of [['ai-line-intake', 2], ['ai-line-compose', 2], ['ai-line-decorate', 1]] as const) {
      expect(be).toContain(`'${k}': ${v},`);
      expect(fe).toContain(`'${k}': ${v},`);
      expect(fe).toMatch(new RegExp(`'${k}': 'AI 한줄로`));
    }
    expect(be).toContain("'ai-operator-propose': 5,");
    expect(be).toContain("'ai-operator-decorate': 3,");
  });
  it('라우터 = 로그인 · 요금제 · /api/ai-line 등록 · 스위치 없음(1019 전 회사)', () => {
    const r = read('routes/ai-line.ts');
    expect(r).toContain('router.use(authenticate);');
    // ★ 1024 R2 — 요금제 = AI 존 서버 문 한 곳(화면 PlanGate 와 같은 판정)
    expect(r).toContain('if (await aiZonePlanBlocked(req, res)) return null;');
    expect(r).not.toContain('aiLineEnabled');
    expect(r).toContain("router.post('/retarget'");
    expect(read('app.ts')).toContain("app.use('/api/ai-line', aiLineRoutes);");
    for (const f of ['utils/ai-line.ts', 'routes/ai.ts']) expect(read(f)).not.toMatch(/AI_LINE_V2_COMPANY_IDS|aiLineEnabled/);
    const page = readFileSync(join(FE, 'pages', 'AiLinePage.tsx'), 'utf8');
    expect(page).not.toContain('aiLineOn');
    expect(page).toContain('if (!facts) { void startLine(); return; }');
  });
  it('직접 타겟 발송 입구 삭제(대시보드 버튼 · 옛 링크 · 카드 상세) · 조건 고르기 = 확인 창의 직접 타겟 선택', () => {
    const dash = readFileSync(join(FE, 'pages', 'Dashboard.tsx'), 'utf8');
    expect(dash).not.toContain("key: 'target', label: '직접 타겟 발송'");
    expect(dash).toContain("else if (openParam === 'target-send') { if (!hideAi) { navigate('/ai-line', { replace: true }); return; } }");
    const card = readFileSync(join(FE, 'components', 'dashboard', 'CardDetailModal.tsx'), 'utf8');
    expect(card).not.toContain('goDirectSend');
    const modal = readFileSync(join(FE, 'components', 'ai-line', 'LineIntakeModal.tsx'), 'utf8');
    expect(modal).toContain('<DirectTargetFilterModal');
    expect(modal).toContain('toLineAudienceFilters(dynamicFilters, enabledFields)');
    expect(modal).toContain("asking ? '누구에게 보낼까요?'");
  });
  it('기본 차감 = 받는 사람을 읽었을 때만(누구에게를 묻는 중엔 0)', () => {
    const svc = read('services/ai-line.ts');
    expect(svc).toContain("const needAudience = !conditions.some((c) => c.origin === 'line') && !lineMentionsAllCustomers(line);");
    expect(svc).toContain('if (count > 0 && !basePaid && !needAudience) {');
  });
  it('생성기 옵션 = 줄 때만(exactVars · lineIntake)', () => {
    const ai = read('services/ai.ts');
    expect(ai).toContain('exactVars?: string[];');
    expect(ai).toContain('lineIntake?: boolean;');
    expect(ai).toContain('extraContext?.companyDataProfile && !exactVars');
    expect(ai).toContain('...lineIntakeOut,');
  });
  it('수동 검사 진행 중 판정 · 창 복원 = 자동 검사 제외(4곳)', () => {
    const s = read('routes/spam-filter.ts');
    expect((s.match(/notAutoSpamSourceSql\(/g) || []).length).toBe(4);
  });
  it('★ Codex 1R — 브랜드 조건 동의 = 그 브랜드 소속 행(해석기 옵션 · 실행 소비처 9곳)', () => {
    const cf = read('utils/customer-filter.ts');
    expect(cf).toContain('storeConsent: brand.storeConsent === true,');
    // ★ 2026-10-19 B-1005-1④ — 부르는 화면이 없던 /generate-custom 삭제로 6 → 5 · ★ 1025 #13 부르는 곳 없던 /recount-target 삭제로 5 → 4
    expect((read('routes/ai.ts').match(/viewerBrandConsent\(companyId, req\.user\)/g) || []).length).toBe(4);
    expect(read('services/ai.ts')).toContain('await ownerBrandConsent(companyId, userId || null)');
    expect(read('utils/operator-audience.ts')).toContain('await ownerBrandConsent(input.companyId, input.ownerUserId ?? null)');
    expect(read('services/ai-line.ts')).toContain('await viewerBrandConsent(v.companyId');
    expect(read('utils/continuous-operator.ts')).toContain('ownerUserId: op.created_by || null,');
  });
  it('★ Codex 1R — 자동 검사 시작 = 회사 잠금 안에서 재사용 · 진행 중 · 등록 · 재사용은 유형 · 제목까지', () => {
    const s = read('services/ai-line-spam.ts');
    expect(s).toContain("pg_try_advisory_lock(hashtext($1)) AS ok");   // ★ Codex 2R — 기다리지 않는다(못 잡으면 busy)
    expect(s).toContain("if (!locked) return { state: 'busy' };");
    expect(s).toContain('|| await loadDefaultSpamFirstRecipient(v.companyId, userId, fieldMappings)');   // ★ 2R — 등록과 같은 기본 고객
    expect(s).toContain('`ai-line-spam:${v.companyId}`');
    expect(s).toContain('t.subject IS NOT DISTINCT FROM $5');
    expect(s).toContain('AND EXISTS (SELECT 1 FROM spam_filter_test_results r WHERE r.test_id = t.id AND r.message_type = $4)');
    expect(s).toContain('return verdictOf(String(t.id), String(t.status), t.created_at, msgType);');
  });
  it('자동 검사 = 수동과 같은 선불 경로(skipPrepaid 없음 · 출처 auto_ai)', () => {
    const s = read('services/ai-line-spam.ts');
    expect(s).toContain("source: 'auto_ai',");
    expect(s).not.toContain('skipPrepaid');
    expect(s).toContain('isDemoCompany(v.companyId)');
    expect(s).toContain('getRegisteredCallbackSet(');
    expect(s).toContain('buildAdMessage(input.body');
  });
});

void AiLineError;
