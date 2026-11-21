/**
 * C152 스냅 대조 버전업 2차 — 소스 계약 · 순수 함수(★ 2026-11-21 · 설계서 docs/2026-11-21-c152-snap-gap-upgrade-design.md §5)
 *   K9  답의 몸통 한 곳(runCompanyExplain) · 회사 전체 값 판정이 첫 줄 · 차감 차례 · 답 키에 질문 지문 · 새 주소의 관문
 *   K10 한 줄의 질문 판정(intent) · 화면의 상시 단추는 읽기 결과를 보지 않는다
 *   K11 같이 산 상품 주소 셋 = 단계 관문 안 · 넘기기 갈래
 *   K12 유입 경로 주소 관문 · 경로 판정 차례 · 줄 수 상한이 합을 지킨다
 *   K13 화면 순수 함수(통신사 띠 · 평균 구매액) · 성과 화면 순서 · 답 화면의 한 번만 요청 · 대시보드 4칸
 * (대시보드 카드 · 안내 창 원장 = c151-ask-entry-1121.test.ts K8)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readAskLine, askIntentOf, askSpendAvg, ASK_SPEND_MIN_N } from '../ask-segments';
import { askAnswerKey, askTablesAsDocs, ASK_QUESTION_MIN, ASK_QUESTION_MAX } from '../../services/ask-answer';
import { inflowChannelSql, capInflowRows, INFLOW_REST, INFLOW_ROWS_MAX } from '../inflow-channel';
import { benchCell } from '../performance-benchmark';
import { PAIR_TOP, PAIR_PER_TOP, PAIR_MIN_BOTH, PAIR_COUNT_MAX } from '../product-pairs';
import { spamBenchCells, spamBenchFootnote, type BenchmarkView } from '../../../../frontend/src/utils/benchmark';
import { askGroupSpend, askSpendText, askAnswerAttemptKey, ASK_SPEND_MIN_N as FE_SPEND_MIN_N, ASK_QUESTION_MAX as FE_QUESTION_MAX } from '../../../../frontend/src/utils/ai-ask';
import { audienceLoadedText, stashAudience, takeAudience } from '../../../../frontend/src/utils/product-insight';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const BE = join(__dirname, '..', '..');
const FE = join(ROOT, 'packages', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
/** 라우터 주소 한 곳의 글(그 줄부터 다음 router. 앞까지) */
function routeBody(src: string, head: string): string {
  const i = src.indexOf(head);
  if (i < 0) throw new Error(`주소 없음: ${head}`);
  const j = src.indexOf('\nrouter.', i + head.length);
  return src.slice(i, j < 0 ? undefined : j);
}
const order = (src: string, ...marks: string[]) => marks.map((m) => { const i = src.indexOf(m); if (i < 0) throw new Error(`없음: ${m}`); return i; });
const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1] < x);

describe('K9 답의 몸통 한 곳 · 한 번만 걷는다', () => {
  const svc = read(join(BE, 'services', 'ask-answer.ts'));
  const aiRoutes = read(join(BE, 'routes', 'ai.ts'));
  const lineRoutes = read(join(BE, 'routes', 'ai-line.ts'));

  it('회사 전체 값 판정이 몸통의 첫 줄 · 잔액 확인 → AI → 호출 기록 → 차감 확정 차례 · 이미 낸 답은 잔액 확인 · 차감을 건너뛴다', () => {
    const body = svc.slice(svc.indexOf('export async function runCompanyExplain'), svc.indexOf('// ── 답에 붙는 표 ──'));
    expect(ascending(order(body, 'await assertCompanyWide(i.user);', 'buildCompanyDocuments(companyId)', 'await checkCredit(companyId, cost)', 'callAIWithCitations(', 'await recordAiCall(', 'await settleCreditAfterSuccess('))).toBe(true);
    expect(body).toContain('if (!i.alreadyPaid) await checkCredit(companyId, cost);');
    expect(body).toContain('if (!i.alreadyPaid) await settleCreditAfterSuccess(');
    expect(svc).toMatch(/async function assertCompanyWide[\s\S]{0,200}companyWideViewer\(user\)[\s\S]{0,80}new UserFacingError\(403, 'ASK_ANSWER_SCOPED'/);
  });
  it('옛 수치 질문 주소는 그 몸통을 부른다 · 라우트 안에 AI 호출 · 차감이 남지 않는다', () => {
    const r = routeBody(aiRoutes, "router.post('/operator/explain'");
    expect(r).toContain('await runCompanyExplain({ user: req.user as any, question, idempotencyKey: `ai-explain:${randomUUID()}` })');
    for (const gone of ['callAIWithCitations', 'checkCredit(', 'settleCreditAfterSuccess(', 'buildCompanyDocuments(', 'recordAiCall(']) expect(r).not.toContain(gone);
    expect(ascending(order(r, 'aiZonePlanBlocked(req, res, planCtx)', 'runCompanyExplain('))).toBe(true);
  });
  it('답 = 판정(원장 · 기억을 읽기 전) → 한 번만 걷는 길 · 키에 질문 지문이 묶인다', () => {
    const body = svc.slice(svc.indexOf('export async function answerAsk'));
    expect(ascending(order(body, 'await assertCompanyWide(i.user);', 'paidOnce<AskAnswer>(companyId, key', 'buildAskTables(companyId, i.user)', 'runCompanyExplain({'))).toBe(true);
    expect(body).toContain('idempotencyKey: key, alreadyPaid');
    const co = '00000000-0000-0000-0000-000000000001';
    expect(askAnswerKey(co, 'tok-12345678', '질문 하나')).toBe(askAnswerKey(co, 'tok-12345678', ' 질문 하나 '));
    expect(askAnswerKey(co, 'tok-12345678', '질문 하나')).not.toBe(askAnswerKey(co, 'tok-12345678', '질문 둘'));
    expect(askAnswerKey(co, 't'.repeat(64), '질').length).toBeLessThanOrEqual(150);
  });
  it('한 번만 걷는 길 = AI 한줄로 문안의 재생 조각을 묶은 한 함수(같은 키 한 줄 → 원장 → 기억 → 일 → 기억)', () => {
    const line = read(join(BE, 'services', 'ai-line.ts'));
    const body = line.slice(line.indexOf('export async function paidOnce'), line.indexOf('export function forgetPaidResultsForTest'));
    expect(ascending(order(body, 'withKeyLock(key', 'await paidAmountOf(companyId, key)', 'recallPaid<T>(key)', 'await work(alreadyPaid)', 'rememberPaid(key, out)'))).toBe(true);
  });
  it('새 주소 = 같은 요금제 관문 · 질문 길이 · 시도 표 판정 뒤에 답', () => {
    const r = routeBody(lineRoutes, "router.post('/ask/answer'");
    expect(ascending(order(r, 'await lineGate(req, res)', 'question.length < ASK_QUESTION_MIN || question.length > ASK_QUESTION_MAX', 'isValidAttemptToken(req.body?.attemptToken)', 'await answerAsk({'))).toBe(true);
    expect(r).toContain("userType: v.userType || undefined");
    expect([ASK_QUESTION_MIN, ASK_QUESTION_MAX, FE_QUESTION_MAX]).toEqual([5, 500, 500]);
  });
  it('채널별 발송 = 성과 스냅숏과 답 표가 같은 함수', () => {
    const adv = read(join(BE, 'utils', 'next-action-advisor.ts'));
    expect(adv).toContain('const byChannel = await channelStats30d(companyId);');
    expect((adv.match(/GROUP BY send_channel, message_type/g) || []).length).toBe(1);
    expect(svc).toContain('await channelStats30d(companyId)');
  });
  it('(순수) 표 → 근거 문서 = 머리줄 + 줄', () => {
    expect(askTablesAsDocs([{ key: 'groups', title: '고객 묶음', columns: ['묶음', '수'], rows: [['떠나는 단골', '7명']] }]))
      .toEqual([{ title: '고객 묶음', data: '묶음 | 수\n떠나는 단골 | 7명', context: '한줄로AI 가 지금 센 본 회사 숫자' }]);
  });
});

describe('K10 질문 판정 · 틀리게 읽어도 길이 열려 있다', () => {
  const ASK = ['요즘 어떤 고객이 제일 많아?', '지난달 성공률이 왜 떨어졌지', '단골이 몇 명이야', '오래 안 온 고객이 얼마나 돼', '채널별 성과 비교해줘', '이번 달 현황', '매출 추이 알려줘', '어느 묶음이 제일 커？', '고객 분석', '떠나는 단골이 궁금해', '요즘 매장 반응 어때', '구매 몇 건이야'];
  const SEND = ['오래 안 온 단골에게 재구매 10% 쿠폰', '떠나는 단골에게 안부 문자', '신규 고객에게 환영 메시지 보내줘', '단골에게 3만원으로 보내기', '첫 구매 고객 감사 인사', '휴면 고객 홍보', '다음 구매 차례 고객에게 알림', '예산 5만원 안에서 발송', '단골 챙기기', '뜸해지는 고객 안내해줘', '구매 기록 없는 분들께 첫 구매 권하기', '재방문 유도'];
  it('물음 꼴이고 보내기 낱말이 없으면 ask · 그 밖 = send(지금 흐름)', () => {
    expect(ASK.map(askIntentOf)).toEqual(ASK.map(() => 'ask'));
    expect(SEND.map(askIntentOf)).toEqual(SEND.map(() => 'send'));
    // 섞인 줄(물음 꼴 + 보내기 낱말) = send — 화면의 상시 단추가 답 길을 연다
    expect(['문자 발송 성공률이 왜 낮아?', '쿠폰 얼마 줄까?'].map(askIntentOf)).toEqual(['send', 'send']);
    expect(readAskLine('떠나는 단골이 몇 명이야?')).toMatchObject({ intent: 'ask', groups: ['leave'] });
    expect(readAskLine(null).intent).toBe('send');
  });
  it('화면: 상시 단추 · 확인 줄의 답 받기는 읽기 결과를 다시 보지 않고 답 길을 부른다 · 읽는 중 · 쓰는 중에는 잠긴다', () => {
    const page = read(join(FE, 'pages', 'AiAskPage.tsx'));
    const askNow = page.slice(page.indexOf('const askNow = async'), page.indexOf('const go = (s: Step)'));
    expect(askNow).not.toContain('askRead(');
    expect(askNow).toContain('if (answering || reading) return;');
    expect(page).toContain('disabled={reading || answering || lineDraft.trim().length < ASK_LINE_MIN} onClick={() => void askNow(lineDraft)}');
    expect(page).toContain("if (r.intent === 'ask') { setAsking({ line: t, groups: r.groups }); return; }");
    expect(page).toContain('onClick={() => void askNow(asking.line, asking.groups)}');
    expect(page).toContain("onClick={() => begin('line', asking.groups, { line: asking.line })}");
  });
});

describe('K11 같이 산 상품 주소', () => {
  const r = read(join(BE, 'routes', 'product-insight.ts'));
  it('줄 · 세기 · 명단이 단계 관문 안 · 명단 갈래 pair 는 두 이름이 다 있어야 한다', () => {
    expect(r).toContain("router.get('/pairs', guarded('pairs',");
    expect(routeBody(r, "router.post('/audience-counts'")).toContain('countBoughtNotBought(companyId, userId, pairList(req.body?.pairs, PAIR_COUNT_MAX))');
    const aud = routeBody(r, "router.post('/audience', guarded(");
    expect(aud).toContain("(kind === 'pair' && !other.trim())");
    expect(aud).toContain('await listBoughtNotBought(companyId, userId, value, other)');
    expect([PAIR_TOP, PAIR_PER_TOP, PAIR_MIN_BOTH, PAIR_COUNT_MAX]).toEqual([10, 3, 3, 30]);
  });
  it('세는 쪽은 keymap 의 이름 하나 · 빼는 쪽은 구매 당시 이름 또는 같은 키 · 전 기간은 a 구매자의 고객 id 로만 읽는다', () => {
    const src = read(join(BE, 'utils', 'product-pairs.ts'));
    expect(src).toMatch(/one AS \(\s*SELECT DISTINCT \$\{PERSON\} AS person, m\.norm AS prod\s*FROM wlines l\s*JOIN keymap m ON m\.door = l\.door AND m\.key = l\.key/);
    expect(src).toContain('JOIN pairs p ON e.own = p.b OR EXISTS (SELECT 1 FROM keymap m WHERE m.door = e.door AND m.key = e.key AND m.norm = p.b)');
    expect(src).toContain("ever AS (${buyLinesSql(' AND b.customer_id IN (SELECT id FROM acust)', ' AND bl.customer_id IN (SELECT id FROM acust)')})");
    expect(src).toContain('LEFT JOIN named n ON n.door = k.door AND n.product_key = k.key AND n.norm IS NOT NULL');
  });
  it('화면 넘기기: 값이 주소에 실리지 않고 · 불러온 뒤 글 · 옛 kind 무변경', () => {
    stashAudience({ kind: 'pair', value: '크림', other: '세럼', label: '크림', seen: 7 });
    const got = takeAudience({ userId: 'u', companyId: 'c' })!;
    expect(got).toEqual({ kind: 'pair', value: '크림', other: '세럼', label: '크림', seen: 7 });
    expect(takeAudience({ userId: 'u', companyId: 'c' })).toBeNull();
    expect(audienceLoadedText(got, { recipients: [{ phone: '1', name: 'a' }], total: 1, truncated: false })).toBe('「크림」을 사고 「세럼」은 안 산 고객 1명을 불러왔어요 (분석 화면 7명 → 지금 1명)');
    const sec = read(join(FE, 'components', 'performance', 'ProductSignalSection.tsx'));
    expect(sec).toContain("stashAudience({ kind: 'pair', value: x.a, other: x.b, label: x.a, seen: n }); navigate('/dashboard?open=direct-send');");
    expect(read(join(FE, 'pages', 'Dashboard.tsx'))).toContain("await fetchAudience(asked.kind, asked.value, asked.kind === 'pair' ? asked.other : undefined)");
  });
});

describe('K12 유입 경로', () => {
  it('주소 = 요금제 관문 뒤 · 회사 전체 값이 아니면 빈 줄', () => {
    const r = routeBody(read(join(BE, 'routes', 'ai.ts')), "router.get('/operator/performance/inflow-channels'");
    expect(ascending(order(r, 'aiZonePlanBlocked(req, res, planCtx)', '(await companyWideViewer(req.user as any)) ? await listInflowChannels(companyId) : []'))).toBe(true);
  });
  it('경로 판정 차례 = 꼬리표 → 빈 referrer → 같은 사이트 → 검색 → SNS → 다른 사이트', () => {
    const sql = inflowChannelSql('u', 'r');
    expect(ascending(order(sql, "'링크 꼬리표 · '", "THEN '직접 방문'", "= lower(COALESCE(substring(u from", "THEN '검색'", "THEN 'SNS'", "ELSE '다른 사이트'"))).toBe(true);
    expect(sql).toContain("'[^a-z0-9_.-]'");
  });
  it('(순수) 줄 수 상한을 넘으면 「그 밖」 한 줄 · 방문 · 구매 · 매출의 합은 그대로', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ channel: `c${i}`, visits: i + 1, purchases: 1, revenue: 100 - i }));
    const out = capInflowRows(rows);
    expect(out).toHaveLength(INFLOW_ROWS_MAX);
    expect(out[INFLOW_ROWS_MAX - 1]).toMatchObject({ channel: INFLOW_REST, purchases: 4 });
    const sum = (xs: typeof rows, k: 'visits' | 'purchases' | 'revenue') => xs.reduce((a, r) => a + r[k], 0);
    for (const k of ['visits', 'purchases', 'revenue'] as const) expect(sum(out, k)).toBe(sum(rows, k));
    expect(capInflowRows(rows.slice(0, 12))).toEqual(rows.slice(0, 12));
  });
});

describe('K13 화면', () => {
  const base: BenchmarkView = { hasIndustry: true, ready: true, minPeers: 5, windowDays: 30, successRate: { available: false, reason: 'no_own' }, spamBlock: [] };
  it('통신사 띠 = 평균 있음(내 값 · 평균 · 색) · 평균 없음(내 값만 · 색 없음) · 내 값 없음(칸 없음)', () => {
    const b: BenchmarkView = { ...base, spamBlock: [
      { carrier: 'SKT', available: true, mine: 0.25, avg: 0.5, diff: -0.25 },
      { carrier: 'KT', ...(benchCell(0.032, 2, 0.9) as any) },
      { carrier: 'LGU', available: false, reason: 'no_own' },
    ] };
    expect(spamBenchCells(b)).toEqual([
      { label: 'SKT 차단율', value: '25.0% · 업종 평균 50.0%', tone: 'emerald' },
      { label: 'KT 차단율', value: '3.2%' },
    ]);
    expect(spamBenchFootnote(b)).toBe('우리 스팸 검사로 직접 잰 값 · 같은 업종 5곳 이상 평균과 견줍니다 · 낮을수록 좋아요');
    const own: BenchmarkView = { ...base, spamBlock: [{ carrier: 'KT', ...(benchCell(0, 0, null) as any) }] };
    expect(spamBenchCells(own)).toEqual([{ label: 'KT 차단율', value: '0.0%' }]);
    expect(spamBenchFootnote(own)).toBe('우리 스팸 검사로 직접 잰 값 · 낮을수록 좋아요');
    // 다른 회사 값(평균)은 회사 수가 모자라면 서버가 싣지 않는다
    expect(benchCell(0.032, 4, 0.9)).toEqual({ available: false, reason: 'few_peers', mine: 0.032 });
  });
  it('평균 구매액 = 묶음의 합 ÷ 수 · 5명 미만 · 구매 기록 없음 = 없음 · 글자 꼴', () => {
    const cells = [
      { key: 'r3c2', row: 3, col: 2, group: 'leave' as const, total: 9, sendable: 9, spendSum: 90000, spendN: 3 },
      { key: 'r4c2', row: 4, col: 2, group: 'leave' as const, total: 9, sendable: 9, spendSum: 156000, spendN: 3 },
      { key: 'r0c0', row: 0, col: 0, group: 'new' as const, total: 4, sendable: 4, spendSum: 80000, spendN: 4 },
    ];
    expect(askGroupSpend({ cells }, 'leave')).toBe(41000);
    expect(askGroupSpend({ cells }, 'new')).toBeNull();
    expect(askGroupSpend({ cells }, 'nobuy')).toBeNull();
    expect(askGroupSpend({ cells: cells.map(({ spendSum, spendN, ...c }) => c) }, 'leave')).toBeNull();   // 옛 서버 응답(칸 없음)
    expect(askSpendAvg(cells.filter((c) => c.group === 'leave'))).toBe(41000);
    expect([ASK_SPEND_MIN_N, FE_SPEND_MIN_N]).toEqual([5, 5]);
    expect([123_456, 120_000, 41_000, 9_800, 5_000, 999, 0, 12_340_000].map(askSpendText))
      .toEqual(['12만 3천 원', '12만 원', '4만 1천 원', '9천 원', '5천 원', '999원', '0원', '1,234만 원']);
  });
  it('성과 화면: 효과 증명 카드가 숫자 카드 바로 아래(통신사 띠 · 자동마케팅 ROI 앞) · 유입 경로 카드는 상품 구역 뒤', () => {
    const page = read(join(FE, 'pages', 'PerformancePage.tsx'));
    expect(ascending(order(page, 'label="활성 고객"', '<EffectProofCard days={periodToDays(period)} />', 'spamBenchCells(bench).length > 0', '자동마케팅 ROI: 최근', '<ProductSignalSection />', '<InflowChannelCard />'))).toBe(true);
    expect((page.match(/<EffectProofCard /g) || []).length).toBe(1);
    expect(page).toContain('footnote={spamBenchFootnote(bench)}');
    const card = read(join(FE, 'components', 'performance', 'InflowChannelCard.tsx'));
    expect(card).toContain('if (!data) return null;');
    expect(card).toContain("r.body.rows.length === 0) return;");
  });
  it('답 화면: 크레딧 값 = 화면 단가표 · 요청 하나 = 시도 표 하나(실패하면 같은 표 · 성공하면 비움) · 답 요청이 흐름 번호를 올리고 읽기 응답이 그 번호를 본다', () => {
    const page = read(join(FE, 'pages', 'AiAskPage.tsx'));
    expect(page).toContain("const ANSWER_COST = creditCost('ai-operator-explain');");
    const askNow = page.slice(page.indexOf('const askNow = async'), page.indexOf('const go = (s: Step)'));
    expect(ascending(order(askNow, 'flow.current++;', 'if (!answerAttempt.current || answerAttempt.current.key !== key) answerAttempt.current = { key, token: newAttemptToken() };', 'await aiLineApi.askAnswer(t, answerAttempt.current.token)', 'answerAttempt.current = null;', 'setAnswer({ question: t, data, groups })'))).toBe(true);
    // ★ Codex 구현 2R — 낸 답은 버리지 않는다: 답 요청의 성공 · 실패 갈래에 흐름 번호 대조가 없고(받은 답은 언제나 보여 준다),
    //   답을 쓰는 동안 흐름을 바꿀 수 있는 자리(입력 칸 · 뒤로 · 시작 줄 · 확인 줄 단추 · 아래 단추)가 전부 잠긴다
    expect(askNow).not.toMatch(/flow\.current\s*[!=]==/);
    expect(page).toContain('disabled={answering} maxLength={2000}');
    // ★ 1122 Harold 「뒤로가면 … 메인으로 나가야」 — 첫 화면의 뒤로 = 대시보드(입구 = 대시보드 카드 · 머리 띠 탭 · 형제 화면의 뒤로와 같은 곳 = AiHubBand)
    // ★ C153 — 문안을 만드는 동안 · 보내는 동안도 잠긴다 · 보낸 뒤의 뒤로 = 처음으로
    expect(page).toContain("<button type=\"button\" disabled={answering || making || sending || !!unknown} onClick={() => (sent ? restart() : inAnswer ? setAnswer(null) : step === 0 ? navigate('/dashboard') : go((step - 1) as Step))}");
    expect(page).not.toContain("navigate('/ai-line')");
    expect(read(join(FE, 'components', 'ai-line', 'AiHubBand.tsx'))).toContain("onClick={() => navigate('/dashboard')}");
    expect(page).toContain('disabled={!ready || reading || answering} onClick={() => begin(k, g)}');
    expect(page).toContain("disabled={answering || !ready} onClick={() => begin('line', asking.groups, { line: asking.line })}");
    expect(page).toContain('const nextDisabled = step === 0 ? reading || answering || !ready');
    const read1 = page.slice(page.indexOf('const beginFromLine = async'), page.indexOf('const askNow = async'));
    expect(ascending(order(read1, 'const my = flow.current;', 'await aiLineApi.askRead(t)', 'if (flow.current !== my) return;', "if (r.intent === 'ask')"))).toBe(true);
    expect(page).toMatch(/const begin = \(from: Start[^\n]*\n\s*flow\.current\+\+;/);
    // ★ Codex 구현 1R — 읽는 중에 글을 고치면 옛 글의 읽기 응답은 버린다(화면의 글과 다른 질문으로 답 받기 · 1단계가 열리지 않는다)
    expect(page).toContain('onChange={(e) => { flow.current++; setLineDraft(e.target.value); setLineHint(null); setAsking(null); setAnswerError(null); }}');
    expect(read1).toContain("if (flow.current === my) setLineHint(errText(e, '한 줄을 읽지 못했어요. 다시 눌러 주세요.'));");
    expect(askAnswerAttemptKey(' 질문 ')).toBe(askAnswerAttemptKey('질문'));
    expect(page).toContain("onClick={() => begin('pick', [t.groupKeys![ri]])}");
    expect(page).not.toMatch(/\{5\}크레딧|5크레딧/);   // 숫자를 손으로 적지 않는다
  });
  it('대시보드 카드 4칸 = 1280px 부터 4열 · 그 아래 2열 · 설명은 두 줄까지(잘림 없음)', () => {
    const row = read(join(FE, 'components', 'dashboard', 'DashboardActionRow.tsx'));
    expect(row).toContain("4: 'grid-cols-2 xl:grid-cols-4',");
    expect(row).toContain('line-clamp-2 break-keep text-balance');
  });
});
