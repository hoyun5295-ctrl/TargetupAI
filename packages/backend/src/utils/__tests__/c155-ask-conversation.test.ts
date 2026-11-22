/**
 * C155 한 줄로 묻기 — 답 화면에서 대화 이어 가기 + 그래프(★ 2026-11-22 · 설계서 docs/2026-11-22-c155-ask-answer-conversation-design.md §5)
 *   기대값 = 설계서의 규칙 · 손으로 적은 예(코드가 만드는 방식으로 다시 만들지 않는다).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  readAskHistory, askHistoryUsed, askAnswerKey, askTablesAsDocs,
  groupsTableOf, channelsTableOf, productsTableOf, funnelTableOf,
  ASK_THREAD_MAX, ASK_HISTORY_USED, ASK_HISTORY_ANSWER_MAX, ASK_QUESTION_MAX, type AskTable,
} from '../../services/ask-answer';
import { citationMessages, HISTORY_SYSTEM_LINE } from '../citations';
import { aiLineInputFp } from '../ai-line';
import {
  askAnswerAttemptKey, askHistoryOf, askFollowChips, askBarRows, ASK_THREAD_MAX as FE_THREAD_MAX, type AskTurn,
} from '../../../../frontend/src/utils/ai-ask';

const turn = (n: number) => ({ q: `질문 ${n}`, a: `답 ${n}` });
const turns = (n: number) => Array.from({ length: n }, (_, i) => turn(i + 1));

describe('H1 앞 문답 읽기(설계서 S1 · D3)', () => {
  it('없음 = 빈 목록 · 글자 둘만 남긴다(앞뒤 공백 정리 · 그 밖의 칸은 버린다)', () => {
    expect(readAskHistory(undefined)).toEqual([]);
    expect(readAskHistory(null)).toEqual([]);
    expect(readAskHistory([])).toEqual([]);
    expect(readAskHistory([{ q: '  어느 묶음이 큰가요? ', a: ' 떠나는 단골입니다. ', tables: [1], extra: 'x' }])).toEqual([{ q: '어느 묶음이 큰가요?', a: '떠나는 단골입니다.' }]);
  });
  it('꼴이 틀리면 invalid — 배열 아님 · 빈 질문 · 빈 답 · 질문 500자 초과 · 11개 이상', () => {
    expect(ASK_QUESTION_MAX).toBe(500);
    for (const bad of ['x', { q: 'a', a: 'b' }, [{ q: '', a: '답' }], [{ q: '질문', a: '   ' }], [{ q: '질문' }], [null], [{ q: 'ㄱ'.repeat(501), a: '답' }], turns(11)]) {
      expect(readAskHistory(bad)).toBe('invalid');
    }
    expect(readAskHistory([{ q: 'ㄱ'.repeat(500), a: '답' }])).not.toBe('invalid');
  });
  it('앞 문답이 열이면 full(이번 질문까지 열하나가 된다) · 아홉까지는 받는다', () => {
    expect(ASK_THREAD_MAX).toBe(10);
    expect(readAskHistory(turns(10))).toBe('full');
    expect((readAskHistory(turns(9)) as unknown[]).length).toBe(9);
  });
  it('맥락에 싣는 것 = 뒤에서 여섯 · 답은 1,200자에서 자른다', () => {
    expect([ASK_HISTORY_USED, ASK_HISTORY_ANSWER_MAX]).toEqual([6, 1200]);
    const used = askHistoryUsed([...turns(8), { q: '마지막', a: 'ㄴ'.repeat(1500) }]);
    expect(used.map((t) => t.q)).toEqual(['질문 4', '질문 5', '질문 6', '질문 7', '질문 8', '마지막']);
    expect(used[5].a.length).toBe(1200);
    expect(used[0].a).toBe('답 4');
  });
});

describe('H2 한 번만 걷는 키(설계서 S3 · D4)', () => {
  const CO = '11111111-1111-1111-1111-111111111111';
  const TOKEN = 'a'.repeat(64);
  it('앞 문답이 없으면 옛 키와 글자 그대로 같다(이미 걷은 답의 재생이 깨지지 않는다)', () => {
    const old = `ask-ans:${CO}:${TOKEN}:${aiLineInputFp('어느 묶음이 큰가요?')}`;
    expect(askAnswerKey(CO, TOKEN, ' 어느 묶음이 큰가요? ')).toBe(old);
    expect(askAnswerKey(CO, TOKEN, '어느 묶음이 큰가요?', [])).toBe(old);
  });
  it('같은 질문이라도 앞 문답이 다르면 다른 키 · 같으면 같은 키 · 싣지 않는 옛 문답(여섯 앞)은 키를 바꾸지 않는다', () => {
    const base = askAnswerKey(CO, TOKEN, '그중 몇 명인가요?');
    const withA = askAnswerKey(CO, TOKEN, '그중 몇 명인가요?', [{ q: '어느 묶음이 큰가요?', a: '떠나는 단골' }]);
    const withB = askAnswerKey(CO, TOKEN, '그중 몇 명인가요?', [{ q: '어느 묶음이 큰가요?', a: '요즘 단골' }]);
    expect(new Set([base, withA, withB]).size).toBe(3);
    expect(askAnswerKey(CO, TOKEN, '그중 몇 명인가요?', [{ q: '어느 묶음이 큰가요?', a: '떠나는 단골' }])).toBe(withA);
    // ★ 구현 Codex 1R — 앞 문답을 질문 글자에 이어 붙여 적어도 같은 키가 되지 않는다(옛 이음 글자 · 지금의 배열 꼴 둘 다)
    const prior = [['어느 묶음이 큰가요?', '떠나는 단골']];
    for (const forged of [
      `그중 몇 명인가요?\u0001${JSON.stringify(prior)}`,
      JSON.stringify(['그중 몇 명인가요?', prior]),
      `["그중 몇 명인가요?",${JSON.stringify(prior)}]`,
    ]) expect(askAnswerKey(CO, TOKEN, forged), forged).not.toBe(withA);
    const six = turns(6);
    expect(askAnswerKey(CO, TOKEN, '다음', [{ q: '옛', a: '옛 답' }, ...six])).toBe(askAnswerKey(CO, TOKEN, '다음', six));
    expect(withA.length).toBeLessThanOrEqual(150);   // 원장 키 칸
  });
});

describe('H3 메시지 줄 — 근거 문서는 이번 질문에만(설계서 S2 · D2)', () => {
  const docs = [{ type: 'document', title: '고객 통계' }, { type: 'document', title: '고객 묶음' }];
  it('앞 문답이 없으면 메시지 하나 = 문서 + 이번 질문(인자가 생기기 전과 같은 꼴)', () => {
    expect(citationMessages(docs, '어느 묶음이 큰가요?')).toEqual([
      { role: 'user', content: [docs[0], docs[1], { type: 'text', text: '어느 묶음이 큰가요?' }] },
    ]);
  });
  it('앞 문답은 글만 차례로(질문 = user · 답 = assistant) · 문서는 마지막 메시지에만', () => {
    const m = citationMessages(docs, '그중 몇 명인가요?', [{ q: '첫 질문', a: '첫 답' }, { q: '둘째 질문', a: '둘째 답' }]);
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(m.slice(0, 4).map((x) => x.content)).toEqual(['첫 질문', '첫 답', '둘째 질문', '둘째 답']);
    expect(m[4].content).toEqual([docs[0], docs[1], { type: 'text', text: '그중 몇 명인가요?' }]);
    expect(JSON.stringify(m.slice(0, 4))).not.toContain('document');
  });
  it('대화일 때만 시스템 글에 한 줄(숫자는 이번 문서에서만) · 호출 자리는 메시지 줄 함수 하나', () => {
    expect(HISTORY_SYSTEM_LINE).toContain('이번에 받은 document 에서만');
    const src = fs.readFileSync(path.join(__dirname, '..', 'citations.ts'), 'utf8');
    expect(src).toContain('system: history.length > 0 ? `${input.system}\\n${HISTORY_SYSTEM_LINE}` : input.system,');
    expect(src).toContain('messages: citationMessages(documentBlocks, input.userMessage, history),');
    expect(src.match(/role: 'user'/g)?.length).toBe(2);   // 메시지를 만드는 자리 = citationMessages 안의 둘뿐
  });
});

/** 표의 숫자 열이 표의 줄과 같은 줄 수 · 같은 차례인가 */
function aligned(t: AskTable): void {
  expect(t.chart).toBeDefined();
  expect(t.chart!.labels).toEqual(t.rows.map((r) => r[0]));
  for (const s of t.chart!.series) expect(s.values.length).toBe(t.rows.length);
}

describe('H4 표의 숫자 열 — 재지 않은 값은 null · 줄 차례는 표와 같다(설계서 S4)', () => {
  it('상품: 매장 상품의 조회 · 장바구니 = null(표 「—」) · 몰 상품의 0건 = 0 · 구매는 두 문 모두 숫자', () => {
    const t = productsTableOf([
      { name: '린넨 셔츠', door: 'mall', views: 120, carts: 0, orders: 7 },
      { name: '매장 한정 가방', door: 'ledger', views: 0, carts: 0, orders: 3 },
      { name: '코튼 팬츠', door: 'mall', views: 0, carts: 0, orders: 0 },
    ])!;
    expect(t.rows).toEqual([['린넨 셔츠', '120', '0', '7'], ['매장 한정 가방', '—', '—', '3'], ['코튼 팬츠', '0', '0', '0']]);
    expect(t.chart).toEqual({
      unit: '건', labels: ['린넨 셔츠', '매장 한정 가방', '코튼 팬츠'],
      series: [{ name: '조회', values: [120, null, 0] }, { name: '장바구니', values: [0, null, 0] }, { name: '구매', values: [7, 3, 0] }],
    });
    aligned(t);
    expect(productsTableOf([])).toBeNull();
  });
  it('고객 묶음: 받을 수 있는 분이 있는 묶음만 · 줄마다 묶음 키 · 숫자 열 = 받을 수 있는 분(명)', () => {
    const cell = (key: string, group: any, sendable: number, spendSum = 0, spendN = 0) => ({ key, row: 0, col: 0, group, total: sendable, sendable, spendSum, spendN });
    const t = groupsTableOf(
      [cell('r3c2', 'leave', 40, 4_000_000, 40), cell('r4c2', 'leave', 10, 0, 0), cell('r0c0', 'new', 0), cell('r1c0', 'next', 5)],
      { total: 9, sendable: 9, spendSum: 0, spendN: 0 },
    )!;
    expect(t.rows.map((r) => [r[0], r[1]])).toEqual([['떠나는 단골', '50명'], ['다음 구매 차례', '5명'], ['구매 기록 없음', '9명']]);
    expect(t.groupKeys).toEqual(['leave', 'next', 'nobuy']);
    expect(t.chart).toEqual({ unit: '명', labels: ['떠나는 단골', '다음 구매 차례', '구매 기록 없음'], series: [{ name: '받을 수 있는 분', values: [50, 5, 9] }] });
    aligned(t);
    expect(groupsTableOf([], { total: 0, sendable: 0, spendSum: 0, spendN: 0 })).toBeNull();
  });
  it('채널 · 자사몰 흐름: 줄 차례 그대로 · 발송 0 인 채널 · 방문 0 인 흐름은 표가 없다', () => {
    const c = channelsTableOf([{ channel: 'LMS', sent: 1200, successRate: 0.981 }, { channel: '알림톡', sent: 0, successRate: 0 }, { channel: 'SMS', sent: 30, successRate: 1 }])!;
    expect(c.rows).toEqual([['LMS', '1,200건', '98.1%'], ['SMS', '30건', '100.0%']]);
    expect(c.chart).toEqual({ unit: '건', labels: ['LMS', 'SMS'], series: [{ name: '발송', values: [1200, 30] }] });
    aligned(c);
    expect(channelsTableOf([{ channel: 'LMS', sent: 0, successRate: 0 }])).toBeNull();
    const f = funnelTableOf({ pageViewCount: 900, cartAddCount: 80, checkoutStartCount: 0, purchaseCount: 12 })!;
    expect(f.chart).toEqual({ unit: '건', labels: ['방문', '장바구니', '결제 시작', '구매'], series: [{ name: '건수', values: [900, 80, 0, 12] }] });
    aligned(f);
    expect(funnelTableOf({ pageViewCount: 0, cartAddCount: 3, checkoutStartCount: 0, purchaseCount: 0 })).toBeNull();
  });
  it('근거 문서로 넣는 글은 글자 표 그대로(숫자 열은 근거에 들어가지 않는다)', () => {
    const t = productsTableOf([{ name: '린넨 셔츠', door: 'mall', views: 120, carts: 4, orders: 7 }])!;
    expect(askTablesAsDocs([t])).toEqual([{ title: '최근 30일 많이 본 상품', data: '상품 | 조회 | 장바구니 | 구매\n린넨 셔츠 | 120 | 4 | 7', context: '한줄로AI 가 지금 센 본 회사 숫자' }]);
  });
});

// ── 화면(순수 함수 · 소스 계약) ──

const front = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', rel), 'utf8');
const back = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const feTurn = (question: string, text: string, tables: any[] = []): AskTurn => ({ question, data: { text, citations: [], documentTitles: [], tables } });

describe('H5 화면 — 문답 줄 · 시도 표 · 다음 질문 칩(설계서 §3-A · D4 · D5)', () => {
  it('문답마다 새 시도 표: 같은 질문이라도 몇째 문답인지가 다르면 다른 열쇠 · 첫 질문은 옛 열쇠 그대로', () => {
    expect(askAnswerAttemptKey(' 몇 명인가요? ')).toBe('몇 명인가요?');
    expect(askAnswerAttemptKey('몇 명인가요?', 0)).toBe('몇 명인가요?');
    expect(askAnswerAttemptKey('몇 명인가요?', 1)).not.toBe(askAnswerAttemptKey('몇 명인가요?', 2));
    expect(askAnswerAttemptKey('몇 명인가요?', 1)).toBe(askAnswerAttemptKey(' 몇 명인가요? ', 1));
  });
  it('요청에 싣는 앞 문답 = 질문 · 답 글만(표 · 근거는 싣지 않는다) · 화면 상한 = 서버 상한', () => {
    expect(FE_THREAD_MAX).toBe(ASK_THREAD_MAX);
    const h = askHistoryOf([feTurn(' 첫 질문 ', ' 첫 답 ', [{ key: 'groups' }]), feTurn('둘째', '')]);
    expect(h).toEqual([{ q: '첫 질문', a: '첫 답' }, { q: '둘째', a: '(답 글 없음)' }]);
    expect(readAskHistory(h)).toEqual(h);   // 서버 읽기가 그대로 받는 꼴
  });
  it('칩 = 받은 표의 종류로 정하는 고정 글 · 최대 셋 · 표가 없으면 없음', () => {
    expect(askFollowChips([{ key: 'groups' }, { key: 'channels' }, { key: 'products' }, { key: 'funnel' }])).toEqual([
      '어느 묶음에 먼저 보내면 좋을까요?', '채널마다 성공률은 어떻게 다른가요?', '많이 보고 덜 팔린 상품은 무엇인가요?',
    ]);
    expect(askFollowChips([{ key: 'funnel' }])).toEqual(['장바구니에서 구매로 얼마나 넘어가나요?']);
    expect(askFollowChips([])).toEqual([]);
  });
});

describe('H6 화면 — 막대 줄(설계서 §3-B)', () => {
  it('가장 큰 값 = 100 · 재지 않은 값(null) = 막대 없음 + 「—」 · 0 = 길이 0 + 「0건」', () => {
    const out = askBarRows({ unit: '건', labels: ['린넨 셔츠', '매장 가방'], series: [{ name: '조회', values: [200, null] }, { name: '구매', values: [50, 0] }] });
    expect(out.legend).toEqual(['조회', '구매']);
    expect(out.rows).toEqual([
      { label: '린넨 셔츠', cells: [{ pct: 100, text: '200건' }, { pct: 25, text: '50건' }] },
      { label: '매장 가방', cells: [{ pct: null, text: '—' }, { pct: 0, text: '0건' }] },
    ]);
  });
  it('전부 0 이면 길이 0 · 줄 수가 어긋난 숫자 열은 그리지 않는다', () => {
    expect(askBarRows({ unit: '명', labels: ['가'], series: [{ name: '받을 수 있는 분', values: [0] }] }).rows[0].cells).toEqual([{ pct: 0, text: '0명' }]);
    expect(askBarRows({ unit: '명', labels: ['가', '나'], series: [{ name: 'x', values: [1] }] }).rows).toEqual([]);
    expect(askBarRows({ unit: '명', labels: [], series: [] }).rows).toEqual([]);
  });
  it('서버가 만든 표의 숫자 열을 그대로 그린다(상품 표 = 계열 셋 · 매장 상품의 조회 자리는 「—」)', () => {
    const t = productsTableOf([{ name: '린넨 셔츠', door: 'mall', views: 10, carts: 2, orders: 1 }, { name: '매장 가방', door: 'ledger', views: 0, carts: 0, orders: 5 }])!;
    const rows = askBarRows(t.chart!).rows;
    expect(rows[1].cells.map((c) => c.text)).toEqual(['—', '—', '5건']);
    expect(rows[0].cells.map((c) => c.pct)).toEqual([100, 20, 10]);
  });
});

describe('H7 계약 — 주소 · 화면 배선(설계서 §5 계약)', () => {
  it('주소: 앞 문답을 읽어 꼴이 틀리면 400 · 열 문답이면 400 · 그 뒤에 답', () => {
    const r = back('routes/ai-line.ts');
    const a = r.slice(r.indexOf("router.post('/ask/answer'"), r.indexOf("router.post('/spam-test'"));
    const at = (needle: string) => { const i = a.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    expect(at('await lineGate(req, res)')).toBeLessThan(at('readAskHistory(req.body?.history)'));
    expect(at("code: 'HISTORY_INVALID'")).toBeLessThan(at('await answerAsk({'));
    expect(at("code: 'THREAD_FULL'")).toBeLessThan(at('await answerAsk({'));
    expect(a).toContain('question, attemptToken: req.body.attemptToken, history,');
  });
  it('옛 실험실 주소는 앞 문답을 넘기지 않는다 · 서비스는 싣는 값과 키의 지문이 같은 값', () => {
    expect(back('routes/ai.ts')).toMatch(/runCompanyExplain\(\{ user: req\.user as any, question, idempotencyKey: `ai-explain:\$\{randomUUID\(\)\}` \}\)/);
    const s = back('services/ask-answer.ts');
    const fn = s.slice(s.indexOf('export async function answerAsk('));
    expect(fn).toContain('const history = askHistoryUsed(i.history || []);');
    expect(fn).toContain('askAnswerKey(companyId, i.attemptToken, i.question, history)');
    expect(fn).toContain('idempotencyKey: key, alreadyPaid, history }');
  });
  it('화면: 이어 묻기는 앞 문답을 싣고 문답 수로 시도 표를 가른다 · 칩은 입력 칸에 넣기만 한다 · 보내기 단추는 가장 늦은 답의 표에만', () => {
    const p = front('pages/AiAskPage.tsx');
    expect(p).toContain('const before = follow ? thread : [];');
    expect(p).toContain('const key = askAnswerAttemptKey(t, before.length);');
    expect(p).toContain('await aiLineApi.askAnswer(t, answerAttempt.current.token, askHistoryOf(before));');
    expect(p).toContain('setThread([...before, { question: t, data }]);');
    const chips = p.slice(p.indexOf('{askFollowChips(answer.data.tables).map((c) => ('), p.indexOf('{followHint && '));
    expect(chips).toContain('onClick={() => { setFollowDraft(c); setFollowHint(null); }}');
    expect(chips).not.toContain('askNow(');
    expect(p).toContain('<AskAnswerTables tables={t.data.tables} sendable={last} ready={ready && !answering} onSend={(g) => begin(\'pick\', [g])} />');
    // ★ 구현 Codex 1R — 답을 쓰는 동안에는 어떤 시작도 받지 않는다(문 = 시작의 한 곳 · 흐름 번호를 올리기 전)
    const beginFn = p.slice(p.indexOf('const begin = (from: Start'), p.indexOf('const groupParamDone = useRef(false);'));
    expect(beginFn.indexOf('if (answering) return;')).toBeGreaterThan(-1);
    expect(beginFn.indexOf('if (answering) return;')).toBeLessThan(beginFn.indexOf('flow.current++;'));
    expect(p).toContain('{thread.length >= ASK_THREAD_MAX ? (');
    const tables = front('components/ai-ask/AskAnswerTables.tsx').replace(/\/\*[\s\S]*?\*\//g, '');   // 주석을 뺀 코드
    expect(tables).toContain('const keys = sendable ? t.groupKeys : undefined;');
    expect(tables.match(/이 묶음에게 보내기/g)?.length).toBe(2);
    expect(tables.match(/\{keys && \(/g)?.length).toBe(2);   // 두 단추(좁은 화면 카드 · 표) 모두 keys 가 있을 때만
    const api = front('utils/ai-line.ts');
    expect(api).toContain("...(history.length > 0 ? { history } : {})");
  });
  it('대화 닫기: 문답이 둘 이상이면 확인 창 · 화면 글에 모델명 · native dialog 가 없다', () => {
    const p = front('pages/AiAskPage.tsx');
    const close = p.slice(p.indexOf('const closeThread = () => {'), p.indexOf('const go = (s: Step)'));
    expect(close).toContain('if (thread.length < 2) { closeThreadNow(); return; }');
    expect(close).toContain("title: '대화를 닫을까요?'");
    for (const f of ['components/ai-ask/AskAnswerTables.tsx', 'components/ai-ask/AskBarChart.tsx']) {
      const s = front(f);
      expect(s).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/);
      expect(s).not.toMatch(/\balert\(|\bconfirm\(|\bprompt\(/);
    }
  });
});
