/**
 * utils/ai-line.ts — AI 한줄로 화면 CT(서버 호출 · 진행 상태 · 문안 읽기/쓰기 한 곳 · ★ 2026-10-18)
 *
 * 설계서 = docs/2026-10-18-ai-line-design.md §5 · §6 · §7
 * - 서버가 판정한다: 갈래 · 빠진 것 · 대상 수 · 금액 · 차감. 화면은 받은 값을 그리고 고른 것을 보낸다.
 * - 진행 상태(run) = 객체 하나 · sessionStorage 보관(창을 닫아도 · 페이지를 떠나도 이어서 · 낸 결과 보존).
 * - 다듬은 문안은 `bodyOf` · `setBody` 로만 읽고 쓴다(반만 바꾸면 고친 글 대신 원본이 나간다 · 회의론자 화면 렌즈).
 * ⛔ 모델명 0 · 줄표 0.
 */

export type AiLineBranch = 'sms' | 'alimtalk' | 'ask_kakao';
export type AiLineCopyType = 'emo' | 'benefit' | 'mz';
export type AiLineType = 'direct' | AiLineCopyType;
export type AiLineChannel = 'SMS' | 'LMS' | 'MMS';

export const AI_LINE_TYPE_META: Record<AiLineType, { label: string; desc: string }> = {
  direct: { label: '직접입력', desc: '내가 씀 · 생성 0' },
  emo: { label: '감성형', desc: '계절감 · 다정한 말투' },
  benefit: { label: '혜택강조형', desc: '혜택을 맨 앞에' },
  mz: { label: 'MZ 감성형', desc: '짧고 가벼운 말투' },
};
export const AI_LINE_TYPE_ORDER: AiLineType[] = ['direct', 'emo', 'benefit', 'mz'];

export interface AiLineReadResult {
  enabled: boolean;
  branch?: AiLineBranch;
  gaps?: { benefit: boolean; period: boolean };
  adConflict?: boolean;
}

export interface AiLineCondition { key: string; label: string; text: string; origin: 'line' | 'ai' }
export interface AiLineColumn { token: string; label: string; value: string | number | null; fill: number; locked: boolean; recommended: boolean }

export interface AiLineIntake {
  filters: Record<string, unknown>;
  allCustomers: boolean;
  conditions: AiLineCondition[];
  untranslated: Array<{ key: string; text: string; origin: 'line' | 'ai' }>;
  count: number;
  zeroReason: 'none' | 'zero' | 'unresolved' | 'scope';
  reasoning: string;
  top: { id: string; name: string } | null;
  sampleCustomer: Record<string, string | number | null> | null;
  columns: AiLineColumn[];
  recommend: { type: AiLineCopyType; reason: string } | null;
  channel: AiLineChannel;
  isAd: boolean;
  recommendedTime: string;
  suggestedName: string;
  rejectNumber: string | null;
  base: { paid: boolean; charged: boolean; cost: number };
}

export interface AiLineCard { type: AiLineType; label: string; body: string; subject: string; byteCount: number }

export type AiLineSpamState =
  | 'queued' | 'running' | 'pass' | 'blocked' | 'warn'
  | 'demo' | 'unavailable' | 'unregistered' | 'no_balance' | 'busy' | 'charset';

export interface AiLineSpamChip {
  state: AiLineSpamState | 'idle' | 'stale';
  testId?: string;
  /** 칩이 묶인 글 지문(본문 · 제목 · 채널 · 광고 · 발신번호) — 달라지면 「다시 검사」 */
  fp?: string;
  carriers?: Array<{ carrier: string; result: 'pass' | 'blocked' | 'none' }>;
  aheadCount?: number;
  elapsedSec?: number;
  autoRuns?: number;
  message?: string;
}

/** 진행 상태 하나(화면 전체가 이 객체만 본다) */
export interface AiLineRun {
  runId: string;
  line: string;
  read: AiLineReadResult | null;
  /** 1장(빠진 것) 답 — benefit: null = 혜택 없이 · period_end: null = 기간 없이 */
  facts: { benefit: string | null; period_end: string | null } | null;
  branch: AiLineBranch;
  intake: AiLineIntake | null;
  /** 꺼 둔 조건 키(기본 = 전부 켬) */
  offKeys: string[];
  /** 조건을 다 끄고 「전체 고객에게」를 직접 켰는가 */
  allChecked: boolean;
  /** 확인 판에서 다시 센 수(조건을 바꿨을 때) */
  liveCount: number | null;
  types: AiLineType[];
  vars: string[];
  cards: AiLineCard[];
  /** 다듬은 본문 · 제목(종류 → 글) — bodyOf/setBody 로만 */
  edits: Partial<Record<AiLineType, { body?: string; subject?: string }>>;
  channel: AiLineChannel;
  attemptToken: string;
  spam: Partial<Record<AiLineType, AiLineSpamChip>>;
  /** 고른 카드 */
  picked: AiLineType | null;
}

const STORE_KEY = 'ai_line_run_v1';

function newToken(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c && typeof c.randomUUID === 'function' ? c.randomUUID() : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function newAiLineRun(line: string): AiLineRun {
  return {
    runId: newToken(), line, read: null, facts: null, branch: 'sms', intake: null,
    offKeys: [], allChecked: false, liveCount: null, types: [], vars: [], cards: [], edits: {},
    channel: 'LMS', attemptToken: newToken(), spam: {}, picked: null,
  };
}

export function saveAiLineRun(run: AiLineRun | null): void {
  try {
    if (run) sessionStorage.setItem(STORE_KEY, JSON.stringify(run));
    else sessionStorage.removeItem(STORE_KEY);
  } catch { /* 저장 실패 = 이 탭에서만 이어진다 */ }
}

export function loadAiLineRun(): AiLineRun | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as AiLineRun;
    return r && typeof r.runId === 'string' && typeof r.line === 'string' ? r : null;
  } catch {
    return null;
  }
}

/** 보낼 본문 = 다듬은 글이 있으면 그것 · 없으면 만든 글(읽기는 이 함수 하나) */
export function bodyOf(run: AiLineRun, type: AiLineType): string {
  const e = run.edits[type]?.body;
  if (typeof e === 'string') return e;
  return run.cards.find((c) => c.type === type)?.body || '';
}
/** 제목도 같은 규칙 */
export function subjectOf(run: AiLineRun, type: AiLineType): string {
  const e = run.edits[type]?.subject;
  if (typeof e === 'string') return e;
  return run.cards.find((c) => c.type === type)?.subject || '';
}
/** 다듬은 글 쓰기(쓰기는 이 함수 하나) — 칩은 지문이 달라지면 화면이 「다시 검사」로 본다 */
export function setBody(run: AiLineRun, type: AiLineType, body: string): AiLineRun {
  return { ...run, edits: { ...run.edits, [type]: { ...run.edits[type], body } } };
}
export function setSubject(run: AiLineRun, type: AiLineType, subject: string): AiLineRun {
  return { ...run, edits: { ...run.edits, [type]: { ...run.edits[type], subject } } };
}

/** 확인 판의 최종 조건(꺼 둔 키 제외) */
export function activeFilters(run: AiLineRun): Record<string, unknown> {
  const f = run.intake?.filters || {};
  return Object.fromEntries(Object.entries(f).filter(([k]) => !run.offKeys.includes(k)));
}
/** 최종 조건이 비었는가 */
export function filtersEmpty(run: AiLineRun): boolean {
  return Object.keys(activeFilters(run)).length === 0;
}
/** 서버에 보낼 「전체 고객」 신호 — 조건이 비었고 (AI 가 전체로 읽었거나 사람이 직접 켰을 때)만 */
export function allCustomersFlag(run: AiLineRun): boolean {
  if (!filtersEmpty(run)) return false;
  return run.allChecked || (run.intake?.allCustomers === true && run.offKeys.length === 0);
}

/** 칩 지문 — 실제로 나갈 글 · 제목 · 채널 · 광고 · 발신번호(바뀌면 「다시 검사」) */
export function spamFp(body: string, subject: string, channel: AiLineChannel, isAd: boolean, callback: string): string {
  let h = 0;
  const s = `${body}\u0001${subject}\u0001${channel}\u0001${isAd ? 1 : 0}\u0001${callback}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

// ─────────────── 서버 호출 ───────────────

export class AiLineApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown, method: 'POST' | 'GET' = 'POST'): Promise<T> {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api/ai-line${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const d = await res.json().catch(() => null);
  if (!res.ok || !d || d.success === false) {
    throw new AiLineApiError(String(d?.code || 'FAILED'), String(d?.error || '처리 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.'), res.status);
  }
  return d as T;
}

export const aiLineApi = {
  read: (line: string) => call<AiLineReadResult>('/read', { line }),
  intake: (line: string) => call<AiLineIntake & { success: true }>('/intake', { line }),
  recount: (filters: Record<string, unknown>, allCustomers: boolean) =>
    call<{ count: number; empty: boolean; blocked: boolean; unresolved: boolean }>('/recount', { filters, allCustomers }),
  proceed: (line: string, filters: Record<string, unknown>, allCustomers: boolean) =>
    call<{ count: number; charged: boolean }>('/proceed', { line, filters, allCustomers }),
  compose: (body: {
    line: string; facts: { benefit: string | null; period_end: string | null } | null; filters: Record<string, unknown>; allCustomers: boolean;
    types: AiLineCopyType[]; vars: string[]; channel: AiLineChannel; isAd: boolean; attemptToken: string;
  }) => call<{ cards: AiLineCard[]; channel: AiLineChannel; count: number; charged: { base: number; copies: number } }>('/compose', body),
  decorate: (body: { body: string; vars: string[]; channel: AiLineChannel; isAd: boolean; attemptToken: string }) =>
    call<{ body: string; changed: boolean; charged: number }>('/decorate', body),
  spamStart: (body: { body: string; subject: string; channel: AiLineChannel; isAd: boolean; callback: string; sampleCustomerId: string | null }) =>
    call<{ state: AiLineSpamState; testId?: string; reused?: boolean; message?: string }>('/spam-test', body),
  spamRead: (testId: string, channel: AiLineChannel) =>
    call<{ state: AiLineSpamState; carriers: AiLineSpamChip['carriers']; aheadCount: number; elapsedSec: number }>(`/spam-test/${encodeURIComponent(testId)}?type=${channel === 'SMS' ? 'SMS' : 'LMS'}`, undefined, 'GET'),
  alimtalkMatch: (line: string) =>
    call<{ matched: boolean; templates: Array<{ id: string; templateCode: string; name: string; profileId: string; profileName: string | null; content: string; score: number; reason: string }>; mappings: Array<{ templateVariable: string; customerFieldKey: string | null; customerFieldLabel: string | null; isExactMatch: boolean }>; suggestion: string | null }>('/alimtalk-match', { line }),
};

/** 알림톡 갈래 넘기기(대시보드 알림톡 발송 창이 받는다) */
export const AI_LINE_ALIMTALK_HANDOFF = 'ai_line_alimtalk_handoff';
export interface AiLineAlimtalkHandoff { filters: Record<string, unknown>; allCustomers: boolean; templateId: string | null; at: number }
