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
  branch?: AiLineBranch;
  gaps?: { benefit: boolean; period: boolean };
  adConflict?: boolean;
}

export interface AiLineCondition { key: string; label: string; text: string; origin: 'line' | 'ai' }
/** ★ 2026-10-20 custom = 회사가 올린 칼럼 */
export interface AiLineColumn { token: string; label: string; value: string | number | null; fill: number; locked: boolean; recommended: boolean; custom?: boolean }

/** ★ 2026-10-20 묻는 목록 한 줄(서버가 정한다 · AI 가 한 줄을 읽고 판단 + 규칙 안전망 · 설계서 §17) */
export interface AiLineAsk {
  id: string;
  kind: 'benefit' | 'period' | 'text';
  text: string;
  why: string;
  options: string[];
  source: 'ai' | 'rule';
}

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
  /** ★ 2026-10-19 한 줄에서 받는 사람 조건을 못 읽었다 = 「누구에게 보낼까요?」를 먼저 묻는다(그동안 기본 0) */
  needAudience: boolean;
  /** ★ 2026-10-20 묻는 목록(비면 묻지 않고 다음 · 1020 앞에 저장된 진행 = 없음) */
  asks?: AiLineAsk[];
  /** ★ 2026-10-20 브랜드 말투 학습(성격별) · 모르면 null */
  voice?: { learned: boolean; marketing: boolean; notice: boolean } | null;
  /** ★ 2026-10-21 이 한 줄에 맞는 추천 칼럼(대상 상세와 분리 · 처음 대상이 0명이어도 남는다) */
  recommendedVars?: string[];
}

/** ★ 2026-10-19 대상을 바꾼 뒤(직접 타겟 선택 · 「전체 고객」 답) 서버가 다시 센 값 */
export interface AiLineAudience {
  count: number;
  conditions: Array<{ key: string; label: string; text: string }>;
  untranslated: Array<{ key: string; text: string }>;
  top: AiLineIntake['top'];
  sampleCustomer: AiLineIntake['sampleCustomer'];
  columns: AiLineColumn[];
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
  /** ★ 2026-10-19 만든 계정(aiLineOwner) — 지금 계정과 다르면 읽지도 저장하지도 않는다 */
  owner: string | null;
  line: string;
  read: AiLineReadResult | null;
  /**
   * 1장(빠진 것) 답 — benefit: null = 혜택 없이 · period_end: null = 기간 없이
   * ★ 2026-10-20 answers = AI 가 물은 그 밖 질문의 답(답한 것만)
   */
  facts: { benefit: string | null; period_end: string | null; answers?: Array<{ q: string; a: string }> } | null;
  /** ★ 2026-10-20 문자 성격을 사람이 바꿨으면(true = 마케팅 · 광고 / false = 안부 · 알림) · null = 대상 찾기 판정 */
  isAd: boolean | null;
  branch: AiLineBranch;
  intake: AiLineIntake | null;
  /** 꺼 둔 조건 키(기본 = 전부 켬) */
  offKeys: string[];
  /** 조건을 다 끄고 「전체 고객에게」를 직접 켰는가 */
  allChecked: boolean;
  /** 확인 판에서 다시 센 수(조건을 바꿨을 때) */
  liveCount: number | null;
  /** ★ 2026-10-19 직접 타겟 선택으로 고른 조건(있으면 AI 대상 대신 이것) */
  manual: { filters: Record<string, unknown> } | null;
  /** ★ 2026-10-19 대상을 바꾼 뒤 다시 센 값(1위 고객 · 칼럼까지) — 없으면 intake 값 */
  audience: AiLineAudience | null;
  /** ★ 2026-10-19 「누구에게」에 답했는가 */
  audienceSet: boolean;
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

const STORE_PREFIX = 'ai_line_run_v1';

/**
 * ★ 2026-10-19 진행 저장의 주인 = 로그인한 회사 · 사용자(Harold 1019 「hoyun 으로 만들고 hanjulai 로 바꿔 로그인했는데 남아 있다」).
 * 키를 주인별로 나누고(SNS 쓰던 글 sns-draft 와 같은 방식) 로그아웃 · 401 때 clearAiLineRuns 로 지운다.
 * 주인을 모르면(로그인 정보 없음) 저장 · 읽기를 하지 않는다.
 */
export function aiLineOwner(): string | null {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return u?.id ? `${u?.company?.id || '-'}:${u.id}` : null;
  } catch {
    return null;
  }
}
function storeKey(): string | null {
  const o = aiLineOwner();
  return o ? `${STORE_PREFIX}:${o}` : null;
}

function newToken(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c && typeof c.randomUUID === 'function' ? c.randomUUID() : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function newAiLineRun(line: string): AiLineRun {
  return {
    runId: newToken(), owner: aiLineOwner(), line, read: null, facts: null, isAd: null, branch: 'sms', intake: null,
    offKeys: [], allChecked: false, liveCount: null, manual: null, audience: null, audienceSet: false, types: [], vars: [], cards: [], edits: {},
    channel: 'LMS', attemptToken: newToken(), spam: {}, picked: null,
  };
}

export function saveAiLineRun(run: AiLineRun | null): void {
  try {
    sessionStorage.removeItem(STORE_PREFIX);   // 1019 앞의 주인 없는 키(남아 있으면 다른 계정에 보였다)
    const key = storeKey();
    if (!key) return;
    if (run && run.owner !== aiLineOwner()) return;   // 다른 계정의 진행(다른 탭 로그인 등)은 이 계정 키에 쓰지 않는다
    if (run) sessionStorage.setItem(key, JSON.stringify(run));
    else sessionStorage.removeItem(key);
  } catch { /* 저장 실패 = 이 탭에서만 이어진다 */ }
}

/** 로그아웃 · 401 — 이 탭의 AI 한줄로 진행 · 알림톡 넘기기를 전부 지운다(다음 계정에 남지 않게) */
export function clearAiLineRuns(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith(STORE_PREFIX) || k === AI_LINE_ALIMTALK_HANDOFF)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch { /* 무시 */ }
}

export function loadAiLineRun(): AiLineRun | null {
  try {
    const key = storeKey();
    if (!key) return null;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const r = JSON.parse(raw) as AiLineRun;
    // 1019 앞에 저장된 진행 = 새 칸을 기본값으로 채운다
    if (!r || typeof r.runId !== 'string' || typeof r.line !== 'string' || r.owner !== aiLineOwner()) return null;
    return { ...r, manual: r.manual ?? null, audience: r.audience ?? null, audienceSet: r.audienceSet === true, isAd: typeof r.isAd === 'boolean' ? r.isAd : null };
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

/** 확인 판의 최종 조건 = 직접 고른 조건이 있으면 그것 · 없으면 AI 대상(꺼 둔 키 제외) */
export function activeFilters(run: AiLineRun): Record<string, unknown> {
  if (run.manual) return run.manual.filters;
  const f = run.intake?.filters || {};
  // AI 가 보탰는데 옮기지 못한 칸 = 「받는 사람 계산에 들어가지 않아요」라고 알린 칸 · 보내지 않는다(서버가 만들기 · 진행에서 거절한다).
  //   한 줄에서 온 못 옮긴 칸은 남긴다(화면이 잠그고 · 잠금이 새도 서버가 거절 = 조용히 넓어지지 않는다).
  const aiUntranslated = new Set((run.intake?.untranslated || []).filter((u) => u.origin === 'ai').map((u) => u.key));
  return Object.fromEntries(Object.entries(f).filter(([k]) => !run.offKeys.includes(k) && !aiUntranslated.has(k)));
}
/** 최종 조건이 비었는가 */
export function filtersEmpty(run: AiLineRun): boolean {
  return Object.keys(activeFilters(run)).length === 0;
}
/** 서버에 보낼 「전체 고객」 신호 — 조건이 비었고 (AI 가 전체로 읽었거나 사람이 직접 켰을 때)만 */
export function allCustomersFlag(run: AiLineRun): boolean {
  if (!filtersEmpty(run)) return false;
  // ★ Codex B1 high — 「누구에게」를 물은 대상 찾기(needAudience)의 전체 판정만으로는 전체 발송을 열지 않는다(사람이 「전체 고객」을 고를 때만)
  return run.allChecked || (!run.manual && run.intake?.allCustomers === true && run.intake?.needAudience !== true && run.offKeys.length === 0);
}

/** 지금 대상의 수 · 1위 고객 · 칼럼(대상을 바꿨으면 다시 센 값 · 아니면 대상 찾기 값) — 읽기는 이 함수 하나 */
export function audienceOf(run: AiLineRun): { count: number; top: AiLineIntake['top']; sampleCustomer: AiLineIntake['sampleCustomer']; columns: AiLineColumn[] } {
  const a = run.audience;
  if (a) return { count: a.count, top: a.top, sampleCustomer: a.sampleCustomer, columns: a.columns };
  const it = run.intake;
  return { count: it?.count ?? 0, top: it?.top ?? null, sampleCustomer: it?.sampleCustomer ?? null, columns: it?.columns ?? [] };
}

/** ★ 2026-10-20 문자 성격 = 광고 여부 하나(사람이 바꿨으면 그 값 · 아니면 대상 찾기 판정) — 읽기는 이 함수 하나 */
export function isAdOf(run: AiLineRun): boolean {
  return run.isAd ?? run.intake?.isAd ?? true;
}

/** ★ 2026-10-20 묻는 목록(서버 값 그대로) */
export function asksOf(run: AiLineRun): AiLineAsk[] {
  return run.intake?.asks ?? [];
}

/** ★ 2026-10-20 고른 칼럼 중 본문에 %칼럼% 으로 들어가지 않은 것(카드 알림 · 서버 missingLineVars 와 같은 규칙) */
export function missingVarsIn(body: string, vars: readonly string[]): string[] {
  return vars.filter((v) => !String(body || '').includes(`%${v}%`));
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

async function call<T>(path: string, body?: unknown, method: 'POST' | 'GET' = 'POST', timeoutMs?: number): Promise<T> {
  const token = localStorage.getItem('token');
  // ★ 2026-10-19 Codex C2 — 제한 시간을 준 호출은 그 시간이 지나면 끊는다(본문 수신까지 · 끝나지 않는 조회가 잠금을 붙들지 않게)
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`/api/ai-line${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d || d.success === false) {
      throw new AiLineApiError(String(d?.code || 'FAILED'), String(d?.error || '처리 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.'), res.status);
    }
    return d as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 스팸 칩 조회 제한 시간(3초마다 읽음 · 이보다 오래 걸리면 끊고 다음 읽기에서 다시) */
const SPAM_READ_TIMEOUT_MS = 10000;

export const aiLineApi = {
  read: (line: string) => call<AiLineReadResult>('/read', { line }),
  intake: (line: string) => call<AiLineIntake & { success: true }>('/intake', { line }),
  recount: (filters: Record<string, unknown>, allCustomers: boolean) =>
    call<{ count: number; empty: boolean; blocked: boolean; unresolved: boolean }>('/recount', { filters, allCustomers }),
  retarget: (filters: Record<string, unknown>, allCustomers: boolean) =>
    call<AiLineAudience & { empty: boolean; blocked: boolean; unresolved: boolean }>('/retarget', { filters, allCustomers }),
  proceed: (line: string, filters: Record<string, unknown>, allCustomers: boolean) =>
    call<{ count: number; charged: boolean }>('/proceed', { line, filters, allCustomers }),
  compose: (body: {
    line: string; facts: AiLineRun['facts']; filters: Record<string, unknown>; allCustomers: boolean;
    types: AiLineCopyType[]; vars: string[]; channel: AiLineChannel; isAd: boolean; attemptToken: string;
  }) => call<{ cards: AiLineCard[]; channel: AiLineChannel; count: number; charged: { base: number; copies: number } }>('/compose', body),
  decorate: (body: { body: string; vars: string[]; channel: AiLineChannel; isAd: boolean; attemptToken: string }) =>
    call<{ body: string; changed: boolean; charged: number }>('/decorate', body),
  spamStart: (body: { body: string; subject: string; channel: AiLineChannel; isAd: boolean; callback: string; sampleCustomerId: string | null }) =>
    call<{ state: AiLineSpamState; testId?: string; reused?: boolean; message?: string }>('/spam-test', body),
  spamRead: (testId: string, channel: AiLineChannel) =>
    call<{ state: AiLineSpamState; carriers: AiLineSpamChip['carriers']; aheadCount: number; elapsedSec: number }>(`/spam-test/${encodeURIComponent(testId)}?type=${channel === 'SMS' ? 'SMS' : 'LMS'}`, undefined, 'GET', SPAM_READ_TIMEOUT_MS),
  alimtalkMatch: (line: string, filters: Record<string, unknown>, allCustomers: boolean) =>
    call<{ charged: boolean; paid: boolean; matched: boolean; templates: Array<{ id: string; templateCode: string; name: string; profileId: string; profileName: string | null; content: string; score: number; reason: string }>; mappings: Array<{ templateVariable: string; customerFieldKey: string | null; customerFieldLabel: string | null; isExactMatch: boolean }>; suggestion: string | null }>('/alimtalk-match', { line, filters, allCustomers }),
};

/** 알림톡 갈래 넘기기(대시보드 알림톡 발송 창이 받는다) */
export const AI_LINE_ALIMTALK_HANDOFF = 'ai_line_alimtalk_handoff';
/** owner = 넘긴 계정(aiLineOwner) — 받는 쪽이 지금 계정과 같을 때만 연다 */
export interface AiLineAlimtalkHandoff { filters: Record<string, unknown>; allCustomers: boolean; templateId: string | null; at: number; owner: string | null }
