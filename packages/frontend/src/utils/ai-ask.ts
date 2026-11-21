/**
 * utils/ai-ask.ts — 「한 줄로 묻기」 화면 CT(타입 · 순수 판정 · 표 글) (★ 2026-11-21 C151 · 설계서 docs/2026-11-21-c151-ask-entry-design.md §3)
 *
 * 서버 호출 = utils/ai-line.ts aiLineApi.ask*(같은 라우터) · 직접발송 넘기기 = utils/product-insight.ts(kind 'ask').
 * 숫자는 서버가 준 값만 그린다(지어내지 않는다) · 묶음 이름 · 설명 = 서버 한 곳(askGroupMeta).
 * ⛔ 모델명 0 · 검사 방식 낱말 0 · 줄표 0.
 */

export type AskGroupKey = 'leave' | 'rest' | 'fade' | 'next' | 'loyal' | 'new' | 'nobuy';
export type AskOrder = 'recent' | 'count';
export type AskBenefitMode = 'line' | 'custom' | 'none';

export interface AskReadResult { groups: AskGroupKey[]; budget: number | null; hasBenefit: boolean }
export interface AskGroupMeta { key: AskGroupKey; name: string; desc: string; cells: string[] }
export interface AskCell { key: string; row: number; col: number; group: AskGroupKey; total: number; sendable: number }
export interface AskPrice { lms: number; unset: boolean }
export interface AskSegments { groups: AskGroupMeta[]; cells: AskCell[]; nobuy: { total: number; sendable: number }; unitPrice: AskPrice }
export interface AskPlan { groups: AskGroupKey[]; mode: 'all' | 'budget'; budget: number | null; order: AskOrder }
export interface AskCount {
  inScope: number; sendable: number; planned: number; amount: number; capped: boolean;
  cells: Array<{ key: string; n: number; taken: number }>; unitPrice: AskPrice;
}
export interface AskCard { body: string; subject: string; byteCount: number }
export interface AskComposeResult { card: AskCard; channel: 'SMS' | 'LMS' | 'MMS'; count: number; charged: { base: number; copies: number }; benefitHole: boolean }

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

/** (순수) 문안 입력 지문 = 한 줄 · 묶음 키(정렬) · 혜택 갈래 · 혜택 글(문안이 기대는 사람 입력 전부 · 예산 · 순서는 문안을 바꾸지 않는다) */
export function askInputFp(i: { line: string | null; groups: readonly AskGroupKey[]; mode: AskBenefitMode; benefit: string }): string {
  return JSON.stringify([(i.line || '').trim(), [...i.groups].sort(), i.mode, i.mode === 'custom' ? i.benefit.trim() : '']);
}

export type AskTakeBlock = 'making' | 'no-card' | 'stale' | 'hole' | 'zero';

/**
 * (순수) 「직접발송 창으로 가져가기」 잠금 사유(없으면 null = 눌림).
 *   문안이 지금 입력과 맞을 때만(지문 결속) · 채우지 않은 자리가 남은 문안(benefitHole = 직접발송 길목이 막는 글) = 잠김 · 보낼 인원 0 = 잠김.
 */
export function askTakeBlock(s: { making: boolean; cardFp: string | null; nowFp: string; benefitHole: boolean; planned: number }): AskTakeBlock | null {
  if (s.making) return 'making';
  if (!s.cardFp) return 'no-card';
  if (s.cardFp !== s.nowFp) return 'stale';
  if (s.benefitHole) return 'hole';
  if (s.planned <= 0) return 'zero';
  return null;
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
