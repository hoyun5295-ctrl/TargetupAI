/**
 * utils/ai-ask.ts — 「한 줄로 묻기」 화면 CT(타입 · 순수 판정 · 표 글) (★ 2026-11-21 C151 · 설계서 docs/2026-11-21-c151-ask-entry-design.md §3)
 *
 * 서버 호출 = utils/ai-line.ts aiLineApi.ask*(같은 라우터) · 보내기 = 이 화면 4단계(직접발송 · AI 한줄로와 같은 확정 길 · ★ 2026-11-22 C153).
 * 숫자는 서버가 준 값만 그린다(지어내지 않는다) · 묶음 이름 · 설명 = 서버 한 곳(askGroupMeta).
 * ⛔ 모델명 0 · 검사 방식 낱말 0 · 줄표 0.
 */

export type AskGroupKey = 'leave' | 'rest' | 'fade' | 'next' | 'loyal' | 'new' | 'nobuy';
export type AskOrder = 'recent' | 'count';
export type AskBenefitMode = 'line' | 'custom' | 'none';
/** ★ C153 오실 곳(서버 readAskPlace 와 같은 값) · 문안 종류(서버 AI_LINE_COPY_TYPES) */
export type AskPlace = 'none' | 'store' | 'online';
export type AskCopyType = 'emo' | 'benefit' | 'mz';
export const ASK_COPY_TYPES: readonly AskCopyType[] = ['emo', 'benefit', 'mz'];

/** intent = 한 줄이 질문(ask)인가 보내기(send)인가(★ C152 B · 서버 askIntentOf) */
export interface AskReadResult { groups: AskGroupKey[]; budget: number | null; hasBenefit: boolean; intent?: 'ask' | 'send' }
export interface AskGroupMeta { key: AskGroupKey; name: string; desc: string; cells: string[] }
/** spendSum · spendN = 그 칸의 보낼 수 있는 고객 중 누적 구매액이 있는 고객의 합 · 수(★ C152 C · 옛 서버 응답에는 없다) */
export interface AskCell { key: string; row: number; col: number; group: AskGroupKey; total: number; sendable: number; spendSum?: number; spendN?: number }
export interface AskPrice { lms: number; unset: boolean }
export interface AskSegments {
  groups: AskGroupMeta[]; cells: AskCell[]; nobuy: { total: number; sendable: number; spendSum?: number; spendN?: number }; unitPrice: AskPrice;
  /** ★ C153 목소리를 배운 회사의 종류 이름(서버) · 아니면 null = 화면 기본 이름 */
  typeNames?: Partial<Record<AskCopyType, string>> | null;
}
export interface AskPlan { groups: AskGroupKey[]; mode: 'all' | 'budget'; budget: number | null; order: AskOrder }
export interface AskCount {
  inScope: number; sendable: number; planned: number; amount: number; capped: boolean;
  cells: Array<{ key: string; n: number; taken: number }>; unitPrice: AskPrice;
}
/** hole = 혜택 자리가 남음(발송 길목이 막는 글) · ungrounded = 입력에 없는데 문안에 든 말(알림) */
export interface AskCard { type: AskCopyType; label: string; body: string; subject: string; byteCount: number; hole: boolean; ungrounded: string[] }
export interface AskComposeResult { cards: AskCard[]; channel: 'SMS' | 'LMS' | 'MMS'; count: number; charged: { base: number; copies: number } }

/** 격자 머리(세로 = 마지막 구매 · 가로 = 구매 횟수) */
export const ASK_ROW_LABELS = ['한 달 안', '1~3달 전', '3~6달 전', '6달~1년 전', '1년 넘음'] as const;
export const ASK_COL_LABELS = ['한 번', '2~3번', '4번 이상'] as const;
const ROW_PART = ['한 달 안에 산 분', '1~3달 전에 산 분', '3~6달 전에 산 분', '6달~1년 전에 산 분', '1년 넘게 안 산 분'];
const COL_PART = ['한 번 산 분', '2~3번 산 분', '4번 이상 산 분'];

export const ASK_BUDGET_CHIPS = [30_000, 50_000, 100_000] as const;
/** 서버 readAskPlan 과 같은 범위(벗어나면 단추 잠김) */
export const ASK_BUDGET_MIN = 1_000;
export const ASK_BUDGET_MAX = 100_000_000;
export const ASK_LINE_MIN = 5;

/** (순수) 혜택 갈래 — 「혜택 없이」 = none · 혜택 칸에 적음 = custom · 비움 = line(한 줄 속 혜택) */
export function askBenefitMode(none: boolean, benefit: string): AskBenefitMode {
  if (none) return 'none';
  return benefit.trim() ? 'custom' : 'line';
}

/** (순수) 문안 입력 지문 = 한 줄 · 묶음 키(정렬) · 혜택 갈래 · 혜택 글 · 오실 곳 · 링크 · 종류(정렬)(문안이 기대는 사람 입력 전부 · 예산 · 순서는 문안을 바꾸지 않는다) */
export function askInputFp(i: { line: string | null; groups: readonly AskGroupKey[]; mode: AskBenefitMode; benefit: string; place?: AskPlace; link?: string; types?: readonly AskCopyType[] }): string {
  return JSON.stringify([
    (i.line || '').trim(), [...i.groups].sort(), i.mode, i.mode === 'custom' ? i.benefit.trim() : '',
    i.place || 'none', i.place === 'online' ? (i.link || '').trim() : '', [...(i.types || [])].sort(),
  ]);
}

/** (순수) 종류 고르기의 기본값 — 사람이 아직 고르지 않았을 때(혜택이 없으면 감성 쪽 · 있으면 혜택 쪽) */
export const askDefaultTypes = (mode: AskBenefitMode): AskCopyType[] => (mode === 'none' ? ['emo'] : ['benefit']);

/** (순수) 문안 만들기 잠금 사유(없으면 null) — 한 줄 5자 · 종류 1개 이상 · 받는 분 1명 이상 */
export function askComposeBlock(s: { line: string; types: readonly AskCopyType[]; planned: number }): 'line' | 'types' | 'zero' | null {
  if (s.line.trim().length < ASK_LINE_MIN) return 'line';
  if (s.types.length === 0) return 'types';
  if (s.planned <= 0) return 'zero';
  return null;
}

export type AskTakeBlock = 'making' | 'no-card' | 'stale' | 'hole' | 'zero';

/**
 * (순수) 보내기 단계로 넘어가기 · 보내기 잠금 사유(없으면 null = 눌림).
 *   문안이 지금 입력과 맞을 때만(지문 결속) · 채우지 않은 자리가 남은 문안(benefitHole = 발송 길목이 막는 글) = 잠김 · 보낼 인원 0 = 잠김.
 */
export function askTakeBlock(s: { making: boolean; cardFp: string | null; nowFp: string; benefitHole: boolean; planned: number }): AskTakeBlock | null {
  if (s.making) return 'making';
  if (!s.cardFp) return 'no-card';
  if (s.cardFp !== s.nowFp) return 'stale';
  if (s.benefitHole) return 'hole';
  if (s.planned <= 0) return 'zero';
  return null;
}

/**
 * (순수) 고른 문안의 도착 확인 한 줄(확인 창 · 4단계) — 통과면 빈 글. fpNow = 지금 나갈 글의 지문(칩이 묶인 글과 다르면 = 그 글로는 확인하지 않았다).
 *   발송은 막지 않는다(AI 한줄로 확인 창과 같은 규칙).
 */
export function askSpamNote(
  chip: { state: string; fp?: string; carriers?: Array<{ carrier: string; result: string }> } | undefined, fpNow: string,
): string {
  if (!chip || chip.fp !== fpNow) return '이 글로는 도착 확인을 하지 않았어요.';
  if (chip.state === 'blocked') {
    const names = (chip.carriers || []).filter((c) => c.result === 'blocked').map((c) => c.carrier).join(' · ') || '통신사';
    return `도착 확인에서 막혔어요(${names}). 그대로 보내면 일부 고객에게 안 갈 수 있어요.`;
  }
  if (chip.state === 'queued' || chip.state === 'running' || chip.state === 'busy') return '도착 확인이 아직 끝나지 않았어요.';
  if (chip.state === 'warn' || chip.state === 'checking') return '도착 확인 결과를 아직 받지 못한 통신사가 있어요.';
  if (chip.state === 'pass') return '';
  return '이 글은 도착 확인을 하지 못했어요.';
}

/** (순수) 예산 입력 글 → 원(숫자만 · 빈 글 = 0) */
export function askBudgetOf(text: string): number {
  const n = Number(String(text).replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? Math.min(n, ASK_BUDGET_MAX) : 0;
}

/** (순수) 예산이 서버 범위 안인가 */
export const askBudgetValid = (b: number | null): boolean => typeof b === 'number' && Number.isInteger(b) && b >= ASK_BUDGET_MIN && b <= ASK_BUDGET_MAX;

/**
 * (순수) 「이렇게 보내요」 내역 — 서버가 칸마다 준 대상 수 · 들어가는 수를 순서 축으로 묶는다(최근 구매 = 줄 · 구매 횟수 = 칸 · 구매 기록 없음은 따로).
 *   지어낸 수 0(서버 칸 값의 합) · 0명인 줄은 그리지 않는다.
 */
export function askParts(count: Pick<AskCount, 'cells'>, order: AskOrder): Array<{ label: string; n: number; taken: number }> {
  const sum = new Map<string, { n: number; taken: number }>();
  const add = (label: string, n: number, taken: number) => {
    const cur = sum.get(label) || { n: 0, taken: 0 };
    sum.set(label, { n: cur.n + n, taken: cur.taken + taken });
  };
  for (const c of count.cells) {
    const m = /^r(\d)c(\d)$/.exec(c.key);
    if (!m) { add('구매 기록 없는 분', c.n, c.taken); continue; }
    add(order === 'count' ? COL_PART[Number(m[2])] : ROW_PART[Number(m[1])], c.n, c.taken);
  }
  const labels = order === 'count' ? [...COL_PART].reverse() : ROW_PART;
  return [...labels, '구매 기록 없는 분'].filter((l) => (sum.get(l)?.n || 0) > 0).map((l) => ({ label: l, ...sum.get(l)! }));
}

/** (순수) 1단계 묶음 숫자 = 그 묶음 칸들의 보낼 수 있는 번호 수 합(안내용 · 칸끼리 같은 번호는 2단계에서 한 번) */
export function askGroupSendable(seg: Pick<AskSegments, 'cells' | 'nobuy'>, g: AskGroupKey): number {
  if (g === 'nobuy') return seg.nobuy.sendable;
  return seg.cells.filter((c) => c.group === g).reduce((s, c) => s + c.sendable, 0);
}

export const fmtNum = (n: number): string => Math.max(0, Math.round(n)).toLocaleString('ko-KR');

// ── ★ 2026-11-21 C152 C 묶음별 1인 평균 구매액(설계서 docs/2026-11-21-c152-snap-gap-upgrade-design.md §2-C · §3-C) ──

/** 서버 ASK_SPEND_MIN_N 과 같은 값(구매액이 있는 고객이 이보다 적으면 평균을 보이지 않는다) */
export const ASK_SPEND_MIN_N = 5;

/** (순수) 그 묶음의 1인 평균 구매액(원) — 구매 기록 없음 줄 · 고객이 모자람 · 옛 응답 = null(줄 없음) */
export function askGroupSpend(seg: Pick<AskSegments, 'cells'>, g: AskGroupKey): number | null {
  if (g === 'nobuy') return null;
  const mine = seg.cells.filter((c) => c.group === g);
  const n = mine.reduce((a, c) => a + (c.spendN || 0), 0);
  return n >= ASK_SPEND_MIN_N ? Math.round(mine.reduce((a, c) => a + (c.spendSum || 0), 0) / n) : null;
}

/** (순수) 「12만 3천 원」 꼴 — 만 원 이상 = 만 · 천 단위 · 그 아래 = 천 원 단위 · 천 원 아래 = 원 */
export function askSpendText(won: number): string {
  const v = Math.max(0, Math.round(won));
  if (v < 1000) return `${v.toLocaleString('ko-KR')}원`;
  const man = Math.floor(v / 10_000);
  const chun = Math.floor((v % 10_000) / 1000);
  if (man === 0) return `${chun}천 원`;
  return `${man.toLocaleString('ko-KR')}만${chun > 0 ? ` ${chun}천` : ''} 원`;
}

// ── ★ 2026-11-21 C152 B 질문에 답하기(§2-B · §3-B) ──

export interface AskTable {
  key: 'groups' | 'channels' | 'products' | 'funnel';
  title: string;
  columns: string[];
  rows: string[][];
  /** 고객 묶음 표만 — 줄마다 묶음 키 */
  groupKeys?: AskGroupKey[];
}
export interface AskAnswer { text: string; citations: Array<{ citedText: string; documentTitle: string }>; documentTitles: string[]; tables: AskTable[] }
/** 서버 ASK_QUESTION_MAX 와 같은 값 */
export const ASK_QUESTION_MAX = 500;

/** (순수) 답 요청의 시도 열쇠 — 질문이 같으면 같은 열쇠(응답을 못 받은 같은 질문 = 같은 시도 표로 다시 · 질문이 바뀌면 새 표) */
export const askAnswerAttemptKey = (question: string): string => question.trim();
