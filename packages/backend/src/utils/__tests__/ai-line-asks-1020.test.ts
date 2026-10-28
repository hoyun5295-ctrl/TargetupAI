/**
 * ai-line-asks-1020.test.ts — AI 한줄로 1020 개편(설계서 docs/2026-10-18-ai-line-design.md §17)
 *
 * ① 묻는 목록 = AI 가 한 줄을 읽고 판단한 질문 + 규칙 안전망(예시 문장 시험 · 칩의 혜택 값 · 줄표)
 * ② 칼럼 = 표준 + 회사 칼럼 · 만든 뒤 고른 칼럼 검사(묶음 안 꾸미기 · 그래도 빠지면 표시) · 답 = 근거 글 · 성격 = 광고 여부
 * ③ 브랜드 보이스 = 성격을 안 주면 옛 글자 그대로 · 안부 = notice 가이드라인 + 안부 예시 · 추출 응답 성격별 분리
 * ④ 소스 계약(가이드라인 읽기 키 지정 · 금지 예시 · 대상 AI 출력 · 화면 단계)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

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
  extractVarCatalog: () => ({ fieldMappings: { 고객명: { column: 'name', type: 'string', description: '고객명', sample: '' } }, availableVars: ['고객명'] }),
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
  sanitizeAiAsks, mergeLineAsks, readLineAnswers, lineAnswersLicense, lineAnswersContext, missingLineVars, lineVoiceKind, lineRuleGaps, readAiLine, aiLineCopyKey,
} from '../ai-line';
import { runLineIntake, runLineCompose, aiLineVarTokensFor } from '../../services/ai-line';
import { composeVoicePrompt, splitBrandVoiceExtraction, planBrandVoiceRows, getBrandVoiceFit, invalidateBrandVoiceCache } from '../brand-voice-prompt';

const SRC = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const readFe = (rel: string) => readFileSync(join(FE, rel), 'utf8');
const V = { companyId: 'C1', userId: 'U1', userType: 'company_admin' };

// ─────────────── ① 묻는 목록 ───────────────

/** 대상 AI 응답 고정본(화면 예시 4개 + 오늘 분석 1순위 + 1018 예시) — 「한 줄을 읽고 모자란 사실」 판단의 모양 */
const AI_FIXTURE: Record<string, unknown[]> = {
  '최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘': [
    { kind: 'benefit', question: '쿠폰 내용은 무엇인가요?', why: '쿠폰 값이 없어요', options: ['5천원 할인', '10%'] },
    { kind: 'period', question: '쿠폰은 언제까지 쓸 수 있나요?', why: '기한이 없어요' },
    { kind: 'text', question: '쿠폰은 어디서 쓰나요?', why: '쓰는 곳', options: ['온라인몰', '매장', '둘 다', '무료배송'] },
  ],
  '장바구니 이탈 24시간 고객에게 10% 할인 알림': [
    { kind: 'period', question: '할인은 언제까지인가요?', why: '기한이 없어요' },
    { kind: 'text', question: '장바구니 상품 전체에 할인되나요?', why: '할인 대상', options: ['전체 상품', '일부 상품'] },
  ],
  '휴면 전환 위험 고객에게 복귀 메시지': [
    { kind: 'text', question: '복귀하면 드리는 혜택이 있나요?', why: '혜택 여부', options: ['있음', '없음'] },
  ],
  '신규 가입 후 7일 미구매 고객에게 첫 구매 혜택': [
    { kind: 'benefit', question: '첫 구매 혜택은 무엇인가요?', why: '혜택 값이 없어요' },
  ],
  '재구매 주기 도래 고객 리마인드': [
    { kind: 'text', question: '다시 사도록 권할 상품이 있나요?', why: '권할 상품' },
  ],
  '기초제품 30% 할인할거야 서울사는 30대 여성에게만': [
    { kind: 'period', question: '할인은 언제까지인가요?', why: '기간이 없어요' },
  ],
};

describe('① 묻는 목록(AI 판단 + 규칙 안전망)', () => {
  it('화면 예시 4개 · 오늘 분석 1순위 · 1018 예시 = 모두 1개 이상 묻는다(이번 누락 · 1020 접수)', () => {
    for (const [line, raw] of Object.entries(AI_FIXTURE)) {
      const asks = mergeLineAsks(line, sanitizeAiAsks(raw, line));
      expect(asks.length, line).toBeGreaterThan(0);
    }
  });
  it('규칙만으로는 화면 예시 3개가 0개였다(접수 증상 고정 · AI 질문이 메운다)', () => {
    const zero = ['장바구니 이탈 24시간 고객에게 10% 할인 알림', '휴면 전환 위험 고객에게 복귀 메시지', '신규 가입 후 7일 미구매 고객에게 첫 구매 혜택']
      .filter((l) => mergeLineAsks(l, []).length === 0);
    expect(zero).toHaveLength(3);
  });
  it('다 갖춘 한 줄 · AI 가 빈 목록 = 0개(묻지 않고 다음)', () => {
    expect(mergeLineAsks('기초제품 30% 할인 10월 31일까지 서울 30대 여성에게', [])).toEqual([]);
  });
  it('규칙 안전망 = AI 가 혜택 · 기간을 놓쳤을 때만 보탠다 · 순서 = 혜택 → 기간 → 그 밖', () => {
    expect(lineRuleGaps('세일 진행할거야 VIP 에게')).toEqual({ benefit: true, period: true });
    const asks = mergeLineAsks('세일 진행할거야 VIP 에게', sanitizeAiAsks([{ kind: 'text', question: '어떤 상품이 세일인가요?' }], '세일 진행할거야 VIP 에게'));
    expect(asks.map((a) => [a.kind, a.source])).toEqual([['benefit', 'rule'], ['period', 'rule'], ['text', 'ai']]);
    const ai = mergeLineAsks('세일 진행할거야 VIP 에게', sanitizeAiAsks([{ kind: 'benefit', question: '세일 혜택은 무엇인가요?' }], '세일 진행할거야 VIP 에게'));
    expect(ai.filter((a) => a.kind === 'benefit')).toHaveLength(1);
    expect(ai[0].source).toBe('ai');
  });
  it('칩 = 그 밖 질문만 · 혜택 값 · 숫자 · 혜택 낱말 칩은 버린다 · 줄표는 나열 점으로', () => {
    const asks = sanitizeAiAsks(AI_FIXTURE['최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘'], '최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘');
    expect(asks.find((a) => a.kind === 'benefit')?.options).toEqual([]);
    expect(asks.find((a) => a.kind === 'text')?.options).toEqual(['온라인몰', '매장', '둘 다']);
    const dash = sanitizeAiAsks([{ kind: 'text', question: '쿠폰은 — 어디서 쓰나요?', options: ['두 배 적립', '하나 더 증정', '반값', '앱'] }], '재구매 쿠폰');
    expect(dash[0].text).not.toContain('—');
    expect(dash[0].options).toEqual(['앱']);
  });
  it('모양이 틀린 질문 · 같은 종류 둘 · 같은 글 = 버린다 · 형식 상한', () => {
    expect(sanitizeAiAsks('x', '')).toEqual([]);
    const asks = sanitizeAiAsks([
      null, 3, [], { question: '짧' }, { kind: 'period', question: '언제까지인가요?' }, { kind: 'period', question: '기한은 언제인가요?' },
      { kind: 'text', question: '어디서 쓰나요?' }, { kind: 'text', question: '어디서 쓰나요?' },
    ], '');
    expect(asks.map((a) => a.id)).toEqual(['period', 'q1']);
    expect(sanitizeAiAsks(Array.from({ length: 20 }, (_, i) => ({ kind: 'text', question: `질문 하나 더 ${'가'.repeat(i + 1)}?` })), '')).toHaveLength(8);
  });
  it('★ Codex R1 high — 한 줄에 없는 혜택 값이 든 질문은 버린다(사람에게 지어낸 혜택을 사실처럼 보이지 않게)', () => {
    const line = '최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘';
    expect(sanitizeAiAsks([{ kind: 'text', question: '10% 할인은 어디서 쓰나요?' }], line)).toEqual([]);
    expect(sanitizeAiAsks([{ kind: 'text', question: '사은품 증정은 언제 하나요?' }], line)).toEqual([]);
    expect(sanitizeAiAsks([{ kind: 'text', question: '최근 30일 기준이 맞나요?' }], line)).toHaveLength(1);
    expect(sanitizeAiAsks([{ kind: 'text', question: '30% 할인은 어디서 쓰나요?' }], '기초 30% 할인 VIP')).toHaveLength(1);
  });
  it('읽기 판정 = 규칙 판정 하나(카톡 · 알림톡 갈래는 묻지 않음 · 문자 갈래는 같은 값)', () => {
    const l = '주말 세일 진행해 VIP 에게';
    expect(readAiLine(l).gaps).toEqual(lineRuleGaps(l));
    expect(readAiLine('카톡으로 주말 세일 보내줘').gaps).toEqual({ benefit: false, period: false });
  });
  it('답 = 모양 검사 · 빈 답은 버림 · 근거 글 「확인한 사실」', () => {
    expect(readLineAnswers(undefined)).toEqual([]);
    expect(readLineAnswers('x')).toBe('invalid');
    expect(readLineAnswers([{ q: '', a: 'x' }])).toBe('invalid');
    expect(readLineAnswers(Array.from({ length: 9 }, () => ({ q: 'q', a: 'a' })))).toBe('invalid');
    expect(readLineAnswers([{ q: '쓰는 곳', a: '온라인몰' }, { q: '권할 상품', a: '  ' }])).toEqual([{ q: '쓰는 곳', a: '온라인몰' }]);
    expect(lineAnswersLicense([])).toBe('');
    expect(lineAnswersContext([])).toBe('');
    expect(lineAnswersLicense([{ q: '10% 쿠폰은 어디서 쓰나요?', a: '온라인몰' }])).toBe('\n[확인한 사실]\n- 온라인몰');
    expect(lineAnswersContext([{ q: '쓰는 곳', a: '온라인몰' }])).toContain('- 쓰는 곳 → 온라인몰');
  });
  it('빠진 칼럼 · 성격', () => {
    expect(missingLineVars('%고객명%님 안녕하세요', ['고객명', '피부 타입'])).toEqual(['피부 타입']);
    expect(lineVoiceKind(true)).toBe('marketing');
    expect(lineVoiceKind(false)).toBe('notice');
  });
});

// ─────────────── ② 서비스 ───────────────

/** customer_field_definitions 1개(피부 타입) · 대상 3명 중 2명 채움 · 1위 고객 = 건성 */
function db(n: number, custom = true) {
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM customer_field_definitions')) return { rows: custom ? [{ field_key: 'skin_type', field_label: '피부 타입', field_type: 'VARCHAR' }] : [] };
    if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: n }] };
    if (sql.includes('COUNT(*)::int AS total_n')) return { rows: [{ total_n: n, cnt_0: Math.ceil(n * 2 / 3) }] };
    if (sql.includes('FROM customers c WHERE') && sql.includes('ORDER BY')) return { rows: n > 0 ? [{ id: 'cust-1', name: '김민지', grade: 'VIP', custom_fields: { skin_type: '건성' } }] : [] };
    if (sql.includes('COUNT(*) AS total')) return { rows: [{ total: n, cnt_name: n, cnt_grade: n }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.hasCreditForStrict.mockResolvedValue(true);
  m.isChargedByKey.mockResolvedValue(true);   // 기본은 냄(이 시험은 질문 · 칼럼만 본다)
  m.chargedAmountByKey.mockResolvedValue(null);
  m.settle.mockResolvedValue(undefined);
  m.generateMessages.mockResolvedValue({
    variants: [
      { variant_id: 'A', message_text: '%고객명%님 가을 인사 드려요 감성 본문', subject: '제목A' },
      { variant_id: 'B', message_text: '혜택 본문입니다 지금 확인해 보세요', subject: '제목B' },
    ],
  });
});

describe('② 대상 찾기 = 묻는 목록 · 회사 칼럼 · 추천 칼럼 · 말투 학습', () => {
  it('AI 질문 + 규칙 안전망이 asks 한 자리로 · 칩의 혜택 값 제거 · 추천 = copy_vars · 회사 칼럼 후보 · 1위 고객 값', async () => {
    db(3);
    m.recommendTarget.mockResolvedValue({
      filters: { grade: { operator: 'eq', value: 'VIP' } }, all_customers: false, reasoning: '', recommended_channel: 'LMS', is_ad: true,
      recommended_time: '', suggested_campaign_name: '', personalization_vars: [], filter_quotes: { grade: 'VIP' },
      recommended_style: '감성형', style_reason: '', copy_questions: AI_FIXTURE['최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘'], copy_vars: ['피부 타입'],
    });
    const out = await runLineIntake(V, '최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘');
    expect(out.asks.map((a) => a.kind)).toEqual(['benefit', 'period', 'text']);
    expect(out.asks.flatMap((a) => a.options)).toEqual(['온라인몰', '매장', '둘 다']);
    const skin = out.columns.find((c) => c.token === '피부 타입');
    expect(skin).toMatchObject({ custom: true, value: '건성', fill: 67, locked: false, recommended: true });
    expect(out.columns.find((c) => c.token === '고객명')).toMatchObject({ custom: false, recommended: false });
    expect(out.sampleCustomer?.['피부 타입']).toBe('건성');
    // 회사 칼럼 채움 SQL = 키는 매개변수(이름을 SQL 에 붙이지 않는다)
    const fillCall = m.query.mock.calls.find((c: any[]) => String(c[0]).includes('total_n'));
    const params = fillCall![1] as unknown[];
    expect(params[params.length - 1]).toBe('skin_type');
    expect(String(fillCall![0])).toContain(`c.custom_fields->>$${params.length}`);
    expect(String(fillCall![0])).not.toContain('skin_type');
    // ★ 2026-10-28 K13-7 · K7-5 — 칩 상태(AI 메모리와 같은 판정) · 대표 문안 0 = none
    expect(out.voice).toEqual({ learned: false, marketing: false, notice: false, status: 'none' });
  });
  it('★ 1021 실측 — 처음 대상이 0명이어도 추천 칼럼은 응답 한 칸으로 남는다(대상 상세와 분리)', async () => {
    db(0);
    m.recommendTarget.mockResolvedValue({
      filters: { grade: { operator: 'eq', value: 'VIP' }, recent_purchase_date: { operator: 'date_lte', value: '2026-09-21' } },
      all_customers: false, reasoning: '', recommended_channel: 'LMS', is_ad: true, recommended_time: '', suggested_campaign_name: '',
      personalization_vars: ['고객명'], filter_quotes: { grade: 'VIP' }, recommended_style: '감성형', style_reason: '',
      copy_questions: [], copy_vars: ['피부 타입', '%고객명%'],
    });
    const out = await runLineIntake(V, '최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘');
    expect(out.count).toBe(0);
    expect(out.columns).toEqual([]);
    expect(out.recommendedVars).toEqual(['피부 타입', '고객명']);
  });
  it('서버 칼럼 허용 목록 = 표준 + 이 회사 회사 칼럼(다른 이름은 없음)', async () => {
    db(1);
    const allowed = await aiLineVarTokensFor('C1');
    expect(allowed.has('피부 타입')).toBe(true);
    expect(allowed.has('고객명')).toBe(true);
    expect(allowed.has('고객전화번호')).toBe(false);
    expect(allowed.has('남의 칼럼')).toBe(false);
  });
});

const composeInput = (over: Partial<Parameters<typeof runLineCompose>[1]> = {}) => ({
  line: '최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘',
  facts: { benefit: '5천원 쿠폰', periodEnd: null },
  filters: { grade: { operator: 'eq', value: 'VIP' } },
  allCustomers: false,
  types: ['emo', 'benefit'] as any,
  vars: ['고객명'],
  channel: 'LMS' as const,
  isAd: true,
  attemptToken: 'attempt-20201020',
  ...over,
});

describe('② 만들기 = 고른 칼럼 활용 · 답 · 성격', () => {
  it('고른 칼럼이 빠진 문안만 묶음 안에서 넣는다(추가 차감 0) · 들어가면 표시 없음', async () => {
    db(5);
    m.decorate.mockResolvedValue({ messages: ['%고객명%님 혜택 본문입니다 지금 확인해 보세요'], kept: [], charged: false });
    const out = await runLineCompose(V, composeInput());
    expect(m.decorate).toHaveBeenCalledTimes(1);
    expect(m.decorate.mock.calls[0][0]).toMatchObject({ messages: ['혜택 본문입니다 지금 확인해 보세요'], selectedVars: ['고객명'], channel: 'lms' });
    expect(out.cards.map((c) => c.body)).toEqual(['%고객명%님 가을 인사 드려요 감성 본문', '%고객명%님 혜택 본문입니다 지금 확인해 보세요']);
    expect(out.cards.every((c) => missingLineVars(c.body, ['고객명']).length === 0)).toBe(true);
    expect(m.settle.mock.calls.map((c: any[]) => c[0].source)).toEqual(['ai-line-compose']);   // 꾸미기 원장 0
  });
  it('꾸미기 실패 · 칼럼을 더 못 넣은 글 = 원문 그대로(빠진 칼럼은 카드가 본문으로 알린다)', async () => {
    db(5);
    m.decorate.mockRejectedValue(new Error('down'));
    const out = await runLineCompose(V, composeInput({ attemptToken: 'attempt-20201021' }));
    expect(out.cards.find((c) => c.type === 'benefit')?.body).toBe('혜택 본문입니다 지금 확인해 보세요');
    m.decorate.mockReset();
    m.decorate.mockResolvedValue({ messages: ['혜택 본문을 바꿨지만 칼럼은 없음'], kept: [], charged: false });
    const again = await runLineCompose(V, composeInput({ attemptToken: 'attempt-20201024' }));
    expect(again.cards.find((c) => c.type === 'benefit')?.body).toBe('혜택 본문입니다 지금 확인해 보세요');
  });
  it('칼럼 0개 = 꾸미기 0', async () => {
    db(5);
    await runLineCompose(V, composeInput({ vars: [], attemptToken: 'attempt-20201022' }));
    expect(m.decorate).not.toHaveBeenCalled();
  });
  it('답 = 근거 글 「확인한 사실」 · 회사 칼럼 = 변수 표에 실림 · 성격 = 광고 여부', async () => {
    db(5);
    m.decorate.mockResolvedValue({ messages: ['%고객명%님 %피부 타입% 혜택 본문입니다', '%고객명%님 %피부 타입% 혜택 본문입니다'], kept: [], charged: false });
    await runLineCompose(V, composeInput({
      facts: { benefit: '5천원 쿠폰', periodEnd: null, answers: [{ q: '쿠폰은 어디서 쓰나요?', a: '온라인몰' }] },
      vars: ['고객명', '피부 타입'], isAd: false, attemptToken: 'attempt-20201023',
    }));
    const ctx = m.generateMessages.mock.calls[0][2];
    // ★ Codex R1 high — 근거 글 = 사람이 적은 답만 · 질문(AI 가 씀)은 참고 글(목표 문장)에만
    expect(ctx.licenseText).toContain('[확인한 사실]\n- 온라인몰');
    expect(ctx.licenseText).not.toContain('쿠폰은 어디서 쓰나요?');
    expect(String(m.generateMessages.mock.calls[0][0])).toContain('- 쿠폰은 어디서 쓰나요? → 온라인몰');
    expect(ctx.exactVars).toEqual(['고객명', '피부 타입']);
    expect(ctx.availableVarsCatalog['피부 타입']).toMatchObject({ column: 'skin_type', storageType: 'custom_fields' });
    expect(ctx.availableVars).toContain('피부 타입');
    expect(ctx.voiceKind).toBe('notice');
  });
  it('★ Codex R1 닫힘 — 질문에만 있던 혜택이 문안에 실리면 생성기 혜택 검사(근거 = licenseText)가 잡는다', async () => {
    const { findInventedBenefits } = await vi.importActual<any>('../copy-benefit-detector');
    const license = '최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘\n[확인한 사실]\n- 온라인몰';
    expect(findInventedBenefits('%고객명%님, 온라인몰에서 10% 할인 쿠폰을 써 보세요', license).length).toBeGreaterThan(0);
    expect(findInventedBenefits('%고객명%님, 온라인몰에서 쿠폰을 써 보세요', license)).toEqual([]);
    expect(read('services/ai.ts')).toContain('const benefitGround = typeof extraContext?.licenseText === \'string\'');
  });
  it('답이 없으면 원장 키 지문 = 옛 모양 그대로(같은 시도 재요청 키 무변) · 답이 있으면 새 키', () => {
    const base = { line: 'l', facts: { benefit: null, periodEnd: null }, filters: {}, allCustomers: false, types: ['emo'], vars: [], channel: 'LMS', isAd: true };
    const withAns = { ...base, facts: { benefit: null, periodEnd: null, answers: [{ q: 'q', a: 'a' }] } };
    expect(aiLineCopyKey('C1', 't', base)).not.toBe(aiLineCopyKey('C1', 't', withAns));
    const route = read('routes/ai-line.ts');
    expect(route).toContain('...(answers.length > 0 ? { answers } : {}),');
  });
});

// ─────────────── ③ 브랜드 보이스 ───────────────

const G = (tone: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  tone_signature: tone, avg_length_chars: 200, avg_length_bytes: 300, frequent_expressions: ['딱 오늘'], ad_prefix_position: 'front',
  greeting_pattern: '[브랜드] 고객님', cta_patterns: ['지금 바로'], signature: '', reject_position: 'back', emoji_whitelist: ['★'], extracted_at: '', admin_edited: false, ...extra,
});
const MSG = (text: string, kind?: string) => JSON.stringify({ channel: 'LMS', message_text: text, manual_priority: 1, ...(kind ? { kind } : {}) });

function voiceDb(rows: { main?: string; notice?: string; messages: string[]; admin?: Partial<Record<'marketing' | 'notice', string>> }) {
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("memory_type = 'brand_voice_admin'")) return { rows: Object.entries(rows.admin || {}).map(([k, v]) => ({ memory_key: k, memory_value: v })) };
    if (sql.includes("memory_type = 'brand_guideline'")) {
      const out: any[] = [];
      if (rows.main) out.push({ memory_key: 'main', memory_value: rows.main });
      if (rows.notice) out.push({ memory_key: 'notice', memory_value: rows.notice });
      return { rows: out };
    }
    if (sql.includes("memory_type = 'representative_message'")) return { rows: rows.messages.map((v) => ({ memory_value: v })) };
    return { rows: [] };
  });
}

describe('③ 브랜드 보이스 = 성격별', () => {
  // ★ 2026-10-28 AI 메모리 설계 K6 — 목소리 CT = composeVoicePrompt 하나(옛 껍데기 삭제 · 묶음 B 끝) · K1-5 법 줄 없음 · I16 확인 전 AI 문구 · 원문 0
  const compose = (company: string, kind: 'marketing' | 'notice', extra: Record<string, unknown> = {}) =>
    composeVoicePrompt({ companyId: company, producer: 'test', mode: 'write', kind, basePrompt: 'BASE', ...extra } as any);
  it('마케팅 = main 가이드라인 · 법 줄 없음 · 확인 전 = AI 문구 칸 · 대표 문안 원문 0', async () => {
    invalidateBrandVoiceCache('B1');
    voiceDb({ main: G('활기/감성'), notice: G('정중/격조'), messages: [MSG('마케팅 문안 하나', 'marketing'), MSG('안부 문안 하나', 'notice'), MSG('옛 문안')] });
    const r = await compose('B1', 'marketing', { channel: 'SMS', isAd: true });
    expect(r.system).toContain('- 톤 시그니처: 활기/감성');
    expect(r.system).toContain('이 회사 마케팅 문자 기준');
    expect(r.system).not.toContain('광고 표기 "(광고)" 위치');
    expect(r.system).not.toContain('무료수신거부 080 위치');
    expect(r.system).toContain('SMS 90바이트 - (광고) 6바이트');
    expect(r.system).not.toContain('딱 오늘');   // 확인 전 AI 문구 칸 = 싣지 않는다(I16)
    expect(r.system).not.toContain('마케팅 문안 하나');   // 원문 0
    expect(r.voiceLearned).toBe(false);
  });
  it('안부 = notice 가이드라인 · 광고 아니면 광고 바이트 줄 없음', async () => {
    invalidateBrandVoiceCache('B2');
    voiceDb({ main: G('활기/감성'), notice: G('정중/격조'), messages: [MSG('마케팅 문안 하나', 'marketing'), MSG('안부 문안 하나', 'notice')] });
    const r = await compose('B2', 'notice', { channel: 'SMS', isAd: false });
    expect(r.system).toContain('- 톤 시그니처: 정중/격조');
    expect(r.system).toContain('이 회사 안부 · 알림 문자 기준');
    expect(r.system).not.toContain('(광고) 6바이트');
    expect(r.system).not.toContain('안부 문안 하나');
  });
  it('안부 학습본이 없으면 main 가이드라인 · 목소리 없는 회사 = 지시문 그대로(+ 링크 규칙만)', async () => {
    invalidateBrandVoiceCache('B3');
    voiceDb({ main: G('활기/감성'), messages: [MSG('마케팅 문안 하나', 'marketing')] });
    expect((await compose('B3', 'notice')).system).toContain('- 톤 시그니처: 활기/감성');
    invalidateBrandVoiceCache('B4');
    voiceDb({ messages: [] });
    expect((await compose('B4', 'marketing')).system).toBe('BASE');
  });
  it('말투만(HTML · SNS · K11-2) = 기호 · 모양 줄 없음 · 성격별 블록 둘(여정 · K11-4)', async () => {
    invalidateBrandVoiceCache('B8');
    voiceDb({ main: G('활기/감성'), notice: G('정중/격조'), messages: [] });
    const tone = await compose('B8', 'marketing', { scope: 'tone' });
    expect(tone.system).not.toContain('쓰는 기호');
    expect(tone.system).toContain('말투 · 호칭 · 맺음만 따른다');
    const both = await compose('B8', 'by_step' as any);
    expect(both.system).toContain('- 톤 시그니처: 활기/감성');
    expect(both.system).toContain('- 톤 시그니처: 정중/격조');
    expect(both.system).toContain('단계마다 성격');
    const rw = await compose('B8', 'marketing', { mode: 'rewrite' });
    expect(rw.system).toContain('## 고치기 규칙');
  });
  // ★ 2026-10-28 AI 메모리 설계 I3 · K6-4 — 학습 여부 = 주입할 목소리(확인된 뼈대 · 사람 행 칸) · 확인 전 가이드라인만 있으면 목소리 없음
  it('말투 학습 여부 = 성격별 · 확인 전 가이드라인만 = 목소리 없음 · 사람 행 칸 = 그 성격 목소리', async () => {
    invalidateBrandVoiceCache('B5');
    voiceDb({ main: G('정중/격조', { voice_kind: 'notice' }), notice: G('정중/격조'), messages: [] });
    expect(await getBrandVoiceFit('B5', 'marketing')).toEqual({ learned: false, kindLearned: false });
    expect(await getBrandVoiceFit('B5', 'notice')).toEqual({ learned: false, kindLearned: false });
    invalidateBrandVoiceCache('B6');
    voiceDb({ messages: [], admin: { notice: JSON.stringify({ tone_signature: { value: '정중/격조', at: '', by: null } }) } });
    expect(await getBrandVoiceFit('B6', 'notice')).toEqual({ learned: true, kindLearned: true });
    expect(await getBrandVoiceFit('B6', 'marketing')).toEqual({ learned: true, kindLearned: false });
  });
  it('★ Codex R1 — 저장 계획 = 진실 하나(안부만 = main 하나 · 복제 행 없음) · 문안이 있는 성격의 묶음이 빠지면 저장 안 함', () => {
    const mk = { t: 'm' }; const no = { t: 'n' };
    expect(planBrandVoiceRows(['marketing', 'notice'], { marketing: mk, notice: no })).toEqual({ ok: true, main: mk, notice: no });
    expect(planBrandVoiceRows(['marketing'], { marketing: mk })).toEqual({ ok: true, main: mk, notice: null });
    expect(planBrandVoiceRows(['notice'], { notice: no })).toEqual({ ok: true, main: no, notice: null });
    expect(planBrandVoiceRows(['marketing', 'notice'], { marketing: mk })).toEqual({ ok: false, missing: ['notice'], unclassified: 0 });
    expect(planBrandVoiceRows(['marketing', 'notice'], { notice: no })).toEqual({ ok: false, missing: ['marketing'], unclassified: 0 });
    expect(planBrandVoiceRows([], {})).toMatchObject({ ok: false });
    // ★ 2026-10-28 K4-3 — 종류 미정 문안은 거절 사유가 아니다(분류된 문안이 1건 이상이면 저장) · 기존 안부 학습 보존은 라우트가 한다(미정 문안이 남으면 notice 행을 지우지 않는다)
    expect(planBrandVoiceRows(['marketing', null], { marketing: mk })).toEqual({ ok: true, main: mk, notice: null });
    expect(planBrandVoiceRows([null, null], {})).toMatchObject({ ok: false, unclassified: 2 });
  });
  it('★ Codex R1 — 안부만 있는 회사 = main 이 안부 말투 · 안부 생성은 그 한 행(직접 정정이 곧바로 반영)', async () => {
    invalidateBrandVoiceCache('B7');
    voiceDb({ main: G('정중/격조', { voice_kind: 'notice' }), messages: [MSG('안부 문안 하나', 'notice')] });
    const p = (await compose('B7', 'notice')).system;
    expect(p).toContain('- 톤 시그니처: 정중/격조');
    expect(p).toContain('이 회사 안부 · 알림 문자 기준');
    // 학습 여부(I3)는 확인 전이라 없음(가이드라인 칸 = 싣는다 · 확인 전 문구 · 예시 = 싣지 않는다)
    expect(await getBrandVoiceFit('B7', 'notice')).toEqual({ learned: false, kindLearned: false });
    // ★ 2026-10-28 K7-4 — 저장 계획은 추출 결과 CT(buildExtractionResult) 안 · 계획 거절이면 쓰기 전에 502(저장 0 · 걷기 0)
    const mem = read('routes/ai-memory.ts');
    expect(read('utils/brand-voice-extract.ts')).toContain('const plan = planBrandVoiceRows(kinds, byKind);\n  if (!plan.ok) return { ok: false };');
    expect(mem.indexOf('if (!built.ok) {')).toBeLessThan(mem.indexOf("await upsertGuidelineRow(client, companyId, 'main', built.main);"));
  });
  it('추출 응답 나누기 = 사람이 정한 성격은 그대로 · 묶음 = 성격 키 객체만(옛 모양 = 저장 0) · 문안 0건 성격은 묶음 없음', () => {
    const g = { tone_signature: 'x' };
    expect(splitBrandVoiceExtraction({ kinds: ['notice', 'marketing', 'notice'], marketing: g, notice: g }, [null, 'notice', null]))
      .toEqual({ kinds: ['notice', 'notice', 'notice'], byKind: { notice: g } });
    // ★ Codex R2 — 판정이 없거나 허용값이 아니면 null(기본값 「마케팅」으로 메우지 않는다)
    // ★ Codex R3 — 옛 모양(성격 키 없는 한 묶음) = 사람이 정했든 AI 가 판정했든 묶음 0(호환 분기 삭제)
    expect(splitBrandVoiceExtraction({ tone_signature: 'flat' }, [null, null])).toEqual({ kinds: [null, null], byKind: {} });
    expect(splitBrandVoiceExtraction({ tone_signature: 'flat' }, ['notice'])).toEqual({ kinds: ['notice'], byKind: {} });
    const r3 = splitBrandVoiceExtraction({ tone_signature: 'flat', kinds: ['marketing'] }, [null]);
    expect(r3).toEqual({ kinds: ['marketing'], byKind: {} });
    expect(planBrandVoiceRows(r3.kinds, r3.byKind)).toMatchObject({ ok: false, missing: ['marketing'] });
    const mixed = splitBrandVoiceExtraction({ kinds: ['marketing'], marketing: g, notice: g }, ['notice', null]);
    expect(planBrandVoiceRows(mixed.kinds, mixed.byKind)).toMatchObject({ ok: true, main: g, notice: null });
    expect(splitBrandVoiceExtraction({ tone_signature: 'flat' }, ['notice', 'marketing'])).toEqual({ kinds: ['notice', 'marketing'], byKind: {} });
    expect(splitBrandVoiceExtraction('x', [null])).toEqual({ kinds: [null], byKind: {} });
    expect(splitBrandVoiceExtraction({ kinds: ['ad'], marketing: g }, [null]).kinds).toEqual([null]);
    // R2 재현: 마케팅 · 안부 문안 각 1개인데 판정 하나 · 마케팅 묶음만 = 저장은 하되 기존 안부 학습은 지우지 않는다(라우트 · 미정 문안이 남음)
    const r2 = splitBrandVoiceExtraction({ kinds: ['marketing'], marketing: g, notice: null }, [null, null]);
    expect(r2.kinds).toEqual(['marketing', null]);
    expect(planBrandVoiceRows(r2.kinds, r2.byKind)).toMatchObject({ ok: true, notice: null });
    expect(read('routes/ai-memory.ts')).toContain('} else if (unclassifiedCount === 0) {');
    // ★ 2026-10-28 K4-3 — 문안마다 종류 → 성격(사람이 정한 종류 · 성격 먼저 · 모르면 null · 기본값으로 메우지 않는다)
    expect(read('utils/brand-voice-extract.ts')).toContain('const kinds: Array<BrandVoiceKind | null> = rows.map((_, i) => (types[i] ? kindOfContentType(types[i]!) : adminKinds[i]));');
  });
});

// ─────────────── ④ 소스 계약 ───────────────

describe('④ 소스 계약', () => {
  it('가이드라인 읽기 3곳 = 키 지정(notice 행이 옛 소비처에 섞이지 않게)', () => {
    expect(read('utils/brand-voice-prompt.ts')).toContain("memory_type = 'brand_guideline' AND memory_key IN ('main', 'notice')");
    expect(read('utils/brand-tone-evolution.ts')).toContain("memory_type = 'brand_guideline' AND memory_key = 'main'");
    const mem = read('routes/ai-memory.ts');
    expect(mem).toContain("memory_type = 'brand_guideline' AND memory_key IN ('main', 'notice')");
    expect(mem.match(/memory_type = 'brand_guideline'\s*\n\s*LIMIT 1/g)).toBeNull();
    // 추출 = 호출 한 번(차감 1 그대로) · main · notice · 문안 성격 한 묶음 · 사람이 정한 성격은 덮지 않음
    // ★ 1025 Z4 — AI 호출 1(묶음 안 · 차감 0) + 성공 뒤 정산 1 · ★ 2026-10-28 K7-4 멱등 키 = 세대(같은 세대 다시 = 0)
    expect(mem).toContain("const BV_EXTRACT = 'brand-voice-extract';");
    expect((mem.match(/source: BV_EXTRACT,/g) || []).length).toBe(2);
    expect((mem.match(/settleCreditInTx\(client, \{ companyId, cost: prices\.extract, source: BV_EXTRACT, createdBy: userId, idempotencyKey: `brand-voice-extract:\$\{companyId\}:\$\{g\}` \}\)/g) || []).length).toBe(1);   // ★ 1026 저장과 같은 트랜잭션
    expect(mem).toContain("await upsertGuidelineRow(client, companyId, 'notice', built.notice);");
    expect(read('utils/brand-voice-extract.ts')).toContain("kind_source: adminKinds[i] || adminTypes[i] ? 'admin' : 'ai'");
  });
  it('생성기 = 실제 변수를 「금지 예시」로 부르지 않는다 · 성격 옵션은 줄 때만', () => {
    const ai = read('services/ai.ts');
    expect(ai).not.toContain('금지 예시: %매장번호%, %매장명%, %고객명%');
    expect(ai).toContain(".filter((v) => !realVarNames.has(v));");
    // ★ 2026-10-28 K4-4 — 성격 = 주면 그 값 · 안 주면 종류 판정 순서(입력 종류 > 목적 코드 > AI 판정 > 광고 여부)
    expect(ai).toContain('const voiceKind: BrandVoiceKind = extraContext?.voiceKind ?? intent.kind;');
    expect(read('services/ai-line.ts')).toContain('voiceKind: input.contentType ? kindOfContentType(input.contentType) : lineVoiceKind(input.isAd),');
  });
  it('대상 AI 한 줄 접수 = 질문 · 추천 변수 출력(옵션일 때만) · 혜택 값 칩 금지 문장', () => {
    const ai = read('services/ai.ts');
    const at = ai.indexOf('## 추가 출력 (이 요청만');
    expect(at).toBeGreaterThan(0);
    const block = ai.slice(at, ai.indexOf("` : ''}`;", at));
    expect(block).toContain('"copy_questions"');
    expect(block).toContain('"copy_vars"');
    expect(block).toContain('혜택 값(% · 원 · 무료 · 증정 · 적립)이나 숫자는 절대 넣지 않는다');
    expect(block).not.toContain('—');
    expect(ai).toContain('maxTokens: options?.lineIntake ? 1800 : 1024,');
  });
  it('화면 = 묻는 목록 한 자리 · 칼럼 단계(만들기 버튼 한 곳) · 확인 판 칼럼 목록 없음 · 성격 칩 · 학습본 안내 · 금지어', () => {
    const modal = readFe('components/ai-line/LineIntakeModal.tsx');
    expect(modal).toContain("type Step = 'kakao' | 'asks' | 'board' | 'vars';");
    expect(modal).toContain('const asks = asksOf(run);');
    expect(modal).not.toContain('read?.gaps');
    expect((modal.match(/aiLineApi\.compose\(/g) || []).length).toBe(1);
    expect(modal).toContain("step === 'vars'");
    expect(modal).toContain("setBenefitDraft(''); setBenefitNone(false); setPeriodPick(null); setPeriodNone(false); setTextAns({});");
    // ★ 1021 실측 — 「지금 대상」 주인 하나: 칩 끄기/켜기 · 전체 고객 체크도 수 · 칩 · 1위 고객 · 칼럼을 한 응답으로 받는 길(retarget)
    expect(modal).toContain('void retarget({ ...run, offKeys: off, allChecked: false });');
    expect(modal).toContain('void retarget({ ...run, allChecked: !run.allChecked });');
    expect(modal).not.toContain('const recount = async');
    expect(modal).not.toContain('recounting');
    expect((modal.match(/aiLineApi\.recount\(/g) || []).length).toBe(1);   // 「AI 가 보탬 · 빼면 n명」 숫자 미리보기만
    expect((modal.match(/onClick=\{\(\) => toggleCond\(c\.key\)\} aria-pressed=\{on\} disabled=\{retargeting\}/g) || []).length).toBe(2);
    expect(modal).toContain('onChange={toggleAll} disabled={retargeting}');
    expect(modal).toContain('new Set(intake?.recommendedVars ??');
    // ★ Codex 1021 R1 — 1021 앞에 저장된 진행(칩을 끈 채 상세 없음)은 열 때 한 번 다시 받는다
    const stale = 'const detailStale = !!run.intake && !run.manual && !run.audience && (run.offKeys.length > 0 || run.allChecked);';
    expect(modal).toContain(stale);
    expect(modal).toContain('if (!open || !detailStale || retargeting) return;');
    expect(modal).toContain('}, [open, run.runId, detailStale]);');
    // ★ Codex 1021 R2 — 다시 받기가 실패해도 잠금 유지(불변식 = 잠금 사유) · 「다시 세기」로만 재시도
    expect(modal).toContain(": detailStale ? '받는 사람을 다시 세지 못했어요. 「다시 세기」를 눌러 주세요'");
    expect(modal).toContain('{detailStale && !retargeting && (');
    expect(modal.indexOf(stale)).toBeLessThan(modal.indexOf('const lock: string | null ='));
    expect(modal).toContain('문안에 어떤 고객 정보를 넣을까요?');
    expect(modal).toContain('브랜드 말투 학습본이 없어');
    expect(modal).toContain('문자 성격');
    const utils = readFe('utils/ai-line.ts');
    expect(utils).toContain('answers?: Array<{ q: string; a: string }>');
    expect(readFe('components/ai-line/LineResultCards.tsx')).toContain('missingVars');
    const card = readFe('components/AiMemory/BrandVoiceCard.tsx');
    expect(card).toContain('kindSource');
    for (const src of [modal, utils, readFe('components/ai-line/LineResultCards.tsx'), card]) {
      expect(src).not.toMatch(/\b(alert|confirm|prompt)\(/);
      expect(src).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic/);
    }
  });
});
