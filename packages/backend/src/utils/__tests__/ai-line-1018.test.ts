/**
 * ai-line-1018.test.ts — AI 한줄로(설계서 docs/2026-10-18-ai-line-design.md) 판정 · 키 · 금액 · 돈 순서
 *
 * ① 순수 CT(utils/ai-line.ts) ② 서비스 돈 순서(services/ai-line.ts — DB · AI · 원장을 흉내 낸다)
 * ③ 소스 계약(라우트 게이트 · 단가표 백 · 프론트 일치 · 생성기 옵션 · 수동 검사 409 자동 제외)
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
vi.mock('../hub-company-context', () => ({
  loadHubCompanyContext: async () => ({ companyInfo: { company_name: '테스트', reject_number: '0800000000', customer_schema: null }, customerStats: { total: 10 } }),
}));
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: async () => '' }));
vi.mock('../store-scope', () => ({ resolveHubStoreScope: async () => ({ storeFilter: '', baseParams: ['C1'], blocked: false }) }));
vi.mock('../mall-consent', () => ({ viewerConsentSql: async () => ({ isTrue: 'c.sms_opt_in = true' }), viewerBrandConsent: async () => ({}) }));

import {
  readAiLine, styleToType, sanitizeLineTypes, quoteInLine, filterChipText, aiLineBaseKeys, aiLineBaseKey, aiLineComposeCost,
  aiLineCopyKey, maskName, AI_LINE_TYPE_BY_VARIANT,
} from '../ai-line';
import { InsufficientCreditError } from '../ai-credit-tx';
import { runLineCompose, runLineIntake, runLineDecorate, AiLineError, describeLineFilters } from '../../services/ai-line';

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

describe('② 꾸미기', () => {
  it('글이 바뀐 때만 1', async () => {
    m.decorate.mockResolvedValue(['%고객명%님 감성 문안 본문입니다']);
    const out = await runLineDecorate(V, { body: '감성 문안 본문입니다', vars: ['고객명'], channel: 'LMS', isAd: true, attemptToken: 'attempt-12345678' });
    expect(out.changed).toBe(true);
    expect(m.settle.mock.calls[0][0]).toMatchObject({ cost: 1, source: 'ai-line-decorate' });
  });
  it('★ Codex 1R — 이미 낸 꾸미기 = 잔액 확인 0 · 차감 0', async () => {
    m.chargedAmountByKey.mockResolvedValue(1);
    m.hasCreditForStrict.mockResolvedValue(false);
    m.decorate.mockResolvedValue(['%고객명%님 다시 꾸민 본문입니다']);
    const out = await runLineDecorate(V, { body: '꾸밀 본문입니다 다섯자', vars: ['고객명'], channel: 'LMS', isAd: true, attemptToken: 'attempt-deco-0001' });
    expect(m.hasCreditForStrict).not.toHaveBeenCalled();
    expect(m.settle).not.toHaveBeenCalled();
    expect(out.charged).toBe(0);
  });
  it('원문 그대로면 0', async () => {
    m.decorate.mockResolvedValue(['감성 문안 본문입니다']);
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
  it('라우터 = 로그인 · 요금제 · 스위치 · /api/ai-line 등록', () => {
    const r = read('routes/ai-line.ts');
    expect(r).toContain('router.use(authenticate);');
    expect(r).toContain('isAiOperatorAllowed(plan, req.user)');
    expect(r).toContain('aiLineEnabled(v.companyId)');
    expect(read('app.ts')).toContain("app.use('/api/ai-line', aiLineRoutes);");
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
    expect((read('routes/ai.ts').match(/viewerBrandConsent\(companyId, req\.user\)/g) || []).length).toBe(6);
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
