/**
 * ask-answer.ts — 수치 질문에 근거와 함께 답하기 (★ 2026-11-21 C152 B · 설계서 docs/2026-11-21-c152-snap-gap-upgrade-design.md §2-B)
 *
 * 두 주소가 이 한 벌을 쓴다: 옛 `/api/ai/operator/explain`(실험실 화면) · 새 `/api/ai-line/ask/answer`(한 줄로 묻기의 답 화면).
 *   - runCompanyExplain = 옛 주소의 몸통(근거 문서 → 잔액 확인 → AI → 호출 기록 → 차감 확정). 회사 전체 값으로 답하는 길의 관문이 여기 한 곳이다.
 *   - answerAsk = 답에 붙는 표 넷(고객 묶음 · 채널 · 상품 · 퍼널 = 데이터 있는 것만)을 근거 문서로도 넣고, 답 전체를 한 번만 걷는다
 *     (키 = 회사 · 시도 표 · 질문 지문 · services/ai-line paidOnce = AI 한줄로 문안과 같은 재생 조각).
 * ⛔ 숫자는 지금 센 값만(지어내지 않는다) · 표 하나가 실패하면 그 표만 뺀다(답을 막지 않는다).
 */
import { UserFacingError } from '../utils/http-error';
import { buildCompanyDocuments, callAIWithCitations, type CompanyDocument, type CitationSpan, type CitedTurn } from '../utils/citations';
import { checkCredit, settleCreditAfterSuccess } from '../utils/ai-credit';
import { getCreditCost } from '../utils/ai-credit-calc';
import { recordAiCall } from '../utils/ai-rate-limit';
import { companyWideViewer, productInsightOpenFor, listProductSignals, type SignalViewer } from '../utils/product-signal';
import type { AskCell, AskCellNumbers } from '../utils/ask-segments';
import { ASK_GROUPS, askSpendAvg, countAskCells, type AskGroupKey } from '../utils/ask-segments';
import { channelStats30d } from '../utils/next-action-advisor';
import { buildCdpFunnel } from '../utils/cdp-diagnostics';
import { aiLineInputFp } from '../utils/ai-line';
import { paidOnce } from './ai-line';

export const EXPLAIN_CREDIT_SOURCE = 'ai-operator-explain';
export const ASK_ANSWER_SCOPED_TEXT = '담당 고객이 나뉜 계정에서는 회사 전체 숫자로 답하지 않아요.';
export const EXPLAIN_NO_DATA_TEXT = '회사 데이터가 부족하여 근거를 제시할 수 없습니다. 일부 캠페인을 진행한 후 다시 시도해주세요.';
export const ASK_QUESTION_MIN = 5;
export const ASK_QUESTION_MAX = 500;
/** 표마다 싣는 줄 수 */
export const ASK_TABLE_ROWS = 8;

// ── ★ 2026-11-22 C155 대화 이어 가기(설계서 docs/2026-11-22-c155-ask-answer-conversation-design.md §2) ──

/** 한 대화의 문답 수 상한(앞 문답이 이만큼이면 「새 대화로」) · 서버가 맥락으로 싣는 앞 문답 수 · 앞 답을 싣는 글자 수 */
export const ASK_THREAD_MAX = 10;
export const ASK_HISTORY_USED = 6;
export const ASK_HISTORY_ANSWER_MAX = 1200;
export const ASK_THREAD_FULL_TEXT = '대화가 길어졌어요. 새 대화로 시작해 주세요.';
export const ASK_HISTORY_INVALID_TEXT = '앞 문답을 읽지 못했어요. 새 대화로 시작해 주세요.';

/**
 * (순수) 요청의 앞 문답 읽기 — 없음 = 빈 목록 · 꼴이 틀리면 'invalid' · 상한에 닿았으면 'full'.
 *   꼴 = 배열 · 항목마다 q(1 ~ 질문 상한 글자) · a(1자 이상) · 그 밖의 칸은 버린다.
 */
export function readAskHistory(raw: unknown): CitedTurn[] | 'invalid' | 'full' {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > ASK_THREAD_MAX) return 'invalid';
  const out: CitedTurn[] = [];
  for (const x of raw) {
    const q = typeof x?.q === 'string' ? x.q.trim() : '';
    const a = typeof x?.a === 'string' ? x.a.trim() : '';
    if (q.length < 1 || q.length > ASK_QUESTION_MAX || a.length < 1) return 'invalid';
    out.push({ q, a });
  }
  return out.length >= ASK_THREAD_MAX ? 'full' : out;
}

/** (순수) 서버가 실제로 맥락에 싣는 앞 문답 — 뒤에서 여섯 · 답은 상한에서 자른다(키의 지문도 이 값으로 만든다) */
export function askHistoryUsed(history: readonly CitedTurn[]): CitedTurn[] {
  return history.slice(-ASK_HISTORY_USED).map((t) => ({ q: t.q, a: t.a.slice(0, ASK_HISTORY_ANSWER_MAX) }));
}

const EXPLAIN_SYSTEM = `당신은 한줄로AI Operator의 분석 에이전트입니다.
제공된 document에 명시된 사실만 응답 + 출처 근거 명시 (citations 활용).
추측/창작 X. document에 없는 내용은 "정보가 없습니다"로 응답.
한국어 존댓말 (~입니다 / ~합니다).`;

/** 회사 전체 값으로 답할 수 있는 요청자가 아니면 403(분류코드로 나뉜 담당자 · 미배정 담당자 · 「사용자는 자기 것」) */
async function assertCompanyWide(user: SignalViewer | null | undefined): Promise<void> {
  if (!(await companyWideViewer(user))) throw new UserFacingError(403, 'ASK_ANSWER_SCOPED', ASK_ANSWER_SCOPED_TEXT);
}

export interface CompanyExplainResult { text: string; citations: CitationSpan[]; document_titles: string[] }

/**
 * 회사 문서를 근거로 한 답 한 번 — 옛 `/operator/explain` 의 차례 그대로(잔액 확인 → AI → 호출 기록 → 차감 확정).
 *   alreadyPaid = 같은 키로 이미 낸 답을 다시 쓰는 길(잔액 확인 · 차감을 건너뛴다 · paidOnce 가 정한다).
 */
export async function runCompanyExplain(i: {
  user: SignalViewer | null | undefined;
  question: string;
  extraDocs?: CompanyDocument[];
  idempotencyKey: string;
  alreadyPaid?: boolean;
  /** ★ C155 앞 문답(맥락) — 넘기지 않으면 지금과 같은 요청(옛 실험실 주소는 넘기지 않는다) */
  history?: readonly CitedTurn[];
}): Promise<CompanyExplainResult> {
  await assertCompanyWide(i.user);
  const companyId = String(i.user!.companyId);
  const documents = [...(await buildCompanyDocuments(companyId)), ...(i.extraDocs || [])];
  if (documents.length === 0) throw new UserFacingError(400, 'EXPLAIN_NO_DATA', EXPLAIN_NO_DATA_TEXT);

  // ★ 2026-09-27 한줄로 V2 R082 — 잔액을 먼저 보고 호출 · 성공 뒤 1회 차감(단가표 5)
  const cost = getCreditCost(EXPLAIN_CREDIT_SOURCE);
  if (!i.alreadyPaid) await checkCredit(companyId, cost);
  const answer = await callAIWithCitations({
    model: 'opus', system: EXPLAIN_SYSTEM, userMessage: i.question.trim(), documents, maxTokens: 1500,
    ...(i.history && i.history.length > 0 ? { history: i.history } : {}),
  });
  // 월 호출 기록(사용량 화면 통계 · ai_call_log)
  await recordAiCall({ companyId, source: EXPLAIN_CREDIT_SOURCE, modelType: 'opus', success: true });
  // 차감 확정 — 동시 요청에 잔액이 먼저 쓰였으면 결과를 내주지 않는다(402)
  if (!i.alreadyPaid) await settleCreditAfterSuccess({ companyId, cost, source: EXPLAIN_CREDIT_SOURCE, idempotencyKey: i.idempotencyKey });
  return { text: answer.text, citations: answer.citations, document_titles: documents.map((d) => d.title) };
}

// ── 답에 붙는 표 ──

/**
 * 표의 숫자 열(그래프용 · ★ C155 S4) — labels · 각 계열의 values 는 rows 와 **같은 줄 수 · 같은 차례**다.
 *   null = 재지 않은 값(표의 「—」) · 0 = 잰 0건. 둘을 섞지 않는다. 근거 문서로 넣는 글은 rows(글자 표) 그대로다.
 */
export interface AskChart { unit: string; labels: string[]; series: Array<{ name: string; values: Array<number | null> }> }

export interface AskTable {
  key: 'groups' | 'channels' | 'products' | 'funnel';
  title: string;
  columns: string[];
  rows: string[][];
  /** 고객 묶음 표만 — 줄마다 묶음 키(화면의 「이 묶음에게 보내기」) */
  groupKeys?: AskGroupKey[];
  chart?: AskChart;
}

const num = (n: number) => Math.round(n).toLocaleString('ko-KR');

/** (순수) 고객 묶음 표 — 받을 수 있는 분이 있는 묶음만 */
export function groupsTableOf(cells: ReadonlyArray<AskCell>, nobuy: AskCellNumbers): AskTable | null {
  const rows: string[][] = [];
  const groupKeys: AskGroupKey[] = [];
  const values: number[] = [];
  for (const g of ASK_GROUPS) {
    const mine = g.key === 'nobuy' ? [nobuy] : cells.filter((c) => c.group === g.key);
    const sendable = mine.reduce((a, c) => a + c.sendable, 0);
    if (sendable <= 0) continue;
    const avg = g.key === 'nobuy' ? null : askSpendAvg(mine);
    rows.push([g.name, `${num(sendable)}명`, avg === null ? '—' : `${num(avg)}원`]);
    groupKeys.push(g.key);
    values.push(sendable);
  }
  if (rows.length === 0) return null;
  return {
    key: 'groups', title: '고객 묶음', columns: ['묶음', '받을 수 있는 분', '1인 평균 구매'], rows, groupKeys,
    chart: { unit: '명', labels: rows.map((r) => r[0]), series: [{ name: '받을 수 있는 분', values }] },
  };
}

/** (순수) 채널별 발송 표 — 발송이 있는 채널만 · 줄 수 상한 */
export function channelsTableOf(stats: ReadonlyArray<{ channel: string; sent: number; successRate: number }>): AskTable | null {
  const list = stats.filter((c) => c.sent > 0).slice(0, ASK_TABLE_ROWS);
  if (list.length === 0) return null;
  return {
    key: 'channels', title: '최근 30일 채널별 발송', columns: ['채널', '발송', '성공률'],
    rows: list.map((c) => [c.channel, `${num(c.sent)}건`, `${(c.successRate * 100).toFixed(1)}%`]),
    chart: { unit: '건', labels: list.map((c) => c.channel), series: [{ name: '발송', values: list.map((c) => c.sent) }] },
  };
}

/** (순수) 상품 표 — 매장 상품은 조회 · 장바구니를 재지 않는다(표 「—」 = 숫자 열 null) · 구매는 두 문 모두 숫자 */
export function productsTableOf(list: ReadonlyArray<{ name: string; door: string; views: number; carts: number; orders: number }>): AskTable | null {
  if (list.length === 0) return null;
  const mall = (p: { door: string }) => p.door === 'mall';
  return {
    key: 'products', title: '최근 30일 많이 본 상품', columns: ['상품', '조회', '장바구니', '구매'],
    rows: list.map((p) => [p.name, mall(p) ? num(p.views) : '—', mall(p) ? num(p.carts) : '—', num(p.orders)]),
    chart: {
      unit: '건', labels: list.map((p) => p.name),
      series: [
        { name: '조회', values: list.map((p) => (mall(p) ? p.views : null)) },
        { name: '장바구니', values: list.map((p) => (mall(p) ? p.carts : null)) },
        { name: '구매', values: list.map((p) => p.orders) },
      ],
    },
  };
}

/** (순수) 자사몰 흐름 표 — 방문이 없으면 없음 */
export function funnelTableOf(f: { pageViewCount: number; cartAddCount: number; checkoutStartCount: number; purchaseCount: number }): AskTable | null {
  if (f.pageViewCount <= 0) return null;
  const steps: Array<[string, number]> = [['방문', f.pageViewCount], ['장바구니', f.cartAddCount], ['결제 시작', f.checkoutStartCount], ['구매', f.purchaseCount]];
  return {
    key: 'funnel', title: '최근 30일 자사몰 흐름', columns: ['단계', '건수'],
    rows: steps.map(([name, n]) => [name, num(n)]),
    chart: { unit: '건', labels: steps.map(([name]) => name), series: [{ name: '건수', values: steps.map(([, n]) => n) }] },
  };
}

async function groupsTable(companyId: string, userId: string | null | undefined): Promise<AskTable | null> {
  const { cells, nobuy } = await countAskCells(companyId, userId);
  return groupsTableOf(cells, nobuy);
}

async function channelsTable(companyId: string): Promise<AskTable | null> {
  return channelsTableOf(await channelStats30d(companyId));
}

async function productsTable(companyId: string, user: SignalViewer): Promise<AskTable | null> {
  if (!(await productInsightOpenFor(user))) return null;
  return productsTableOf(await listProductSignals(companyId, ASK_TABLE_ROWS));
}

async function funnelTable(companyId: string): Promise<AskTable | null> {
  // 구매 단계 = 매출 반영된 결제 주문만(상품 표 · 유입 경로와 같은 구매 정의)
  return funnelTableOf(await buildCdpFunnel(companyId, 30, { netPurchase: true }));
}

/** 답에 붙는 표 — 데이터 있는 것만 · 표 하나의 실패는 그 표만 뺀다 */
export async function buildAskTables(companyId: string, user: SignalViewer): Promise<AskTable[]> {
  const makers: Array<[AskTable['key'], () => Promise<AskTable | null>]> = [
    ['groups', () => groupsTable(companyId, user.userId)],
    ['channels', () => channelsTable(companyId)],
    ['products', () => productsTable(companyId, user)],
    ['funnel', () => funnelTable(companyId)],
  ];
  const out: AskTable[] = [];
  for (const [key, make] of makers) {
    try {
      const t = await make();
      if (t) out.push(t);
    } catch (err: any) {
      console.warn(`[ask-answer] 표 ${key} 를 만들지 못해 뺀다:`, err?.message || err);
    }
  }
  return out;
}

/** (순수) 표 → 근거 문서(제목 = 표 제목 · 본문 = 머리줄 + 줄) */
export function askTablesAsDocs(tables: readonly AskTable[]): CompanyDocument[] {
  return tables.map((t) => ({
    title: t.title,
    data: [t.columns.join(' | '), ...t.rows.map((r) => r.join(' | '))].join('\n'),
    context: '한줄로AI 가 지금 센 본 회사 숫자',
  }));
}

/** 답 키(최대 8+36+1+64+1+16 = 126자 · 원장 키 150자 안) — 질문이 키에 묶인다(같은 시도 표로 질문을 바꾸면 새 키 = 새로 걷는다) */
export function askAnswerKey(companyId: string, attemptToken: string, question: string, history: readonly CitedTurn[] = []): string {
  // ★ C155 — 앞 문답이 있으면 지문에 넣는다(같은 질문이라도 앞 문답이 다르면 다른 답) · 없으면 옛 키 그대로(이미 걷은 답의 재생이 깨지지 않게)
  const used = askHistoryUsed(history);
  //   ★ 구현 Codex 1R — 앞 문답이 있으면 **배열**로 지문을 낸다(글자를 이어 붙이면 그 글자를 질문에 적어 같은 지문을 만들 수 있다 ·
  //   지문 함수는 JSON 으로 적은 뒤 해시한다 = 글자 하나짜리 입력은 따옴표로 · 배열은 대괄호로 시작해 서로 같은 글이 될 수 없다)
  const input: unknown = used.length > 0 ? [question.trim(), used.map((t) => [t.q, t.a])] : question.trim();
  return `ask-ans:${companyId}:${attemptToken}:${aiLineInputFp(input)}`;
}

export interface AskAnswer { text: string; citations: CitationSpan[]; documentTitles: string[]; tables: AskTable[] }

/**
 * 한 줄로 묻기의 답 — 답 전체를 한 번만 걷는다.
 *   같은 시도 표 + 같은 질문으로 다시 오면: 기억이 있으면 낸 답 그대로(AI 를 부르지 않는다) · 기억이 사라졌으면 잔액 확인 없이 다시 쓰고 걷지 않는다.
 */
export async function answerAsk(i: { user: SignalViewer; question: string; attemptToken: string; history?: readonly CitedTurn[] }): Promise<AskAnswer> {
  await assertCompanyWide(i.user);   // 원장 · 기억을 읽기 전에
  const companyId = String(i.user.companyId);
  const history = askHistoryUsed(i.history || []);   // ★ C155 — 싣는 것 · 키의 지문이 같은 값
  const key = askAnswerKey(companyId, i.attemptToken, i.question, history);
  return paidOnce<AskAnswer>(companyId, key, async (alreadyPaid) => {
    const tables = await buildAskTables(companyId, i.user);
    const out = await runCompanyExplain({ user: i.user, question: i.question, extraDocs: askTablesAsDocs(tables), idempotencyKey: key, alreadyPaid, history });
    return { text: out.text, citations: out.citations, documentTitles: out.document_titles, tables };
  });
}
