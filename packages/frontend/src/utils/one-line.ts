/**
 * one-line.ts — 한줄로 시그니처 화면 CT (★ 2026-10-05 · 설계서 docs/2026-10-05-hanjul-signature-design.md §3 · §4)
 *
 * "한 줄이면 보낼 수 있는 완성본이 나옵니다. 저희가 지어낼 수 없는 사실만 한 번 여쭙니다."
 *
 * ⛔ 무엇을 물을지(판정)는 서버(`POST /api/ai/one-line/gaps`)가 소유한다 — 화면에 규칙 사본을 두지 않는다.
 * 여기는 ① 판정 조회 ② 시도 토큰 ③ 채울 자리 종류표 · 종류별 좁은 치환 ④ 이메일 발송 관문 판정 미러.
 * 백엔드 짝 테스트(`backend/src/utils/__tests__/hanjul-signature-ui-1005.test.ts`)가 실제 import 로 서버 값과 대조한다.
 */

export interface OneLineGapsResult {
  /** 이 회사에 한줄로 시그니처가 열려 있는가(서버 스위치) */
  enabled: boolean;
  gaps: { benefit: boolean };
}

/** 한 줄 판정(AI 0 · 무과금). 조회 실패 = null → 호출부는 지금 화면 그대로 간다(모르면 묻지 않는다). */
export async function fetchOneLineGaps(line: string): Promise<OneLineGapsResult | null> {
  try {
    const res = await fetch('/api/ai/one-line/gaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      body: JSON.stringify({ line: String(line || '').slice(0, 2000) }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.success) return null;
    return { enabled: d.enabled === true, gaps: { benefit: d.gaps?.benefit === true } };
  } catch {
    return null;
  }
}

/** 스위치만 알고 싶을 때(로그인 단위 캐시 · 켜짐만 기억) */
let enabledForToken: string | null = null;
export async function fetchOneLineEnabled(): Promise<boolean> {
  const token = localStorage.getItem('token') || '';
  if (token && enabledForToken === token) return true;
  const r = await fetchOneLineGaps('');
  if (r?.enabled) enabledForToken = token;
  return !!r?.enabled;
}

/**
 * 이미지에서 읽은 글을 한 줄 칸에 붙인다(설계서 §8). 한 줄 칸(`<input>`)은 줄바꿈을 지워
 * 「1+1」과 「3일간」이 「1+13일간」으로 붙는다(혜택 판정 · 문안 근거가 틀어진다) → 줄바꿈을 「 · 」로 바꿔 넣는다.
 */
export function appendToOneLine(prev: string, text: string): string {
  const t = String(text || '').split(/\s*\n+\s*/).map((s) => s.trim()).filter(Boolean).join(' · ');
  const p = String(prev || '').trim();
  if (!t) return p;
  return p ? `${p} · ${t}` : t;
}

/** 시도 토큰 — [만들기]를 누를 때마다 새로 만든다(서버 멱등키의 한 조각 · 영숫자 · 하이픈). */
export function newAttemptToken(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return String(c.randomUUID());
  return `t-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// ─────────────── 채울 자리 ───────────────

/**
 * 생성기가 **실제로 심는** 자리 표기(정확한 글자만). 넓히면 정상 문구를 지운다(`[기간 …]`이 혜택으로 덮이는 등).
 * 혜택 = 이메일 생성기 · 문자 출구 가드 · 인앱 출구 가드 · 자동 마케팅/비상 문안. 기간 = 이메일 생성기.
 */
export const SLOT_TEXTS = {
  benefit: ['[혜택을 직접 입력해주세요]', '[혜택 안내: 직접 수정해주세요]', '[혜택 안내: 직접 작성해주세요]', '[혜택 내용을 입력해주세요]'],
  period: ['[기간을 직접 입력해주세요]'],
} as const;
export type SlotKind = keyof typeof SLOT_TEXTS;

/** 객체 트리의 문자열 전부(깊이 12) */
export function stringsDeep(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const v of node) stringsDeep(v, out, depth + 1); return out; }
  if (typeof node === 'object') { for (const v of Object.values(node as Record<string, unknown>)) stringsDeep(v, out, depth + 1); }
  return out;
}

/** 이 종류의 자리가 몇 곳 남았는가 */
export function countSlots(texts: readonly string[], kind: SlotKind): number {
  let n = 0;
  for (const t of texts) for (const s of SLOT_TEXTS[kind]) n += t.split(s).length - 1;
  return n;
}

/** 이 종류의 자리만 값으로 바꾼다(정확한 표기만 · 값이 비면 그대로) */
export function fillSlots(text: string, kind: SlotKind, value: string): string {
  const v = String(value || '').trim();
  if (!v) return text;
  let out = text;
  for (const s of SLOT_TEXTS[kind]) out = out.split(s).join(v);
  return out;
}

/** 트리 전체에서 이 종류의 자리만 바꾼다(링크 · 이미지 값은 자리 표기가 아니라 건드리지 않는다) */
export function fillSlotsDeep<T>(node: T, kind: SlotKind, value: string, depth = 0): T {
  if (depth > 12 || node == null) return node;
  if (typeof node === 'string') return fillSlots(node, kind, value) as unknown as T;
  if (Array.isArray(node)) return node.map((v) => fillSlotsDeep(v, kind, value, depth + 1)) as unknown as T;
  if (typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = fillSlotsDeep(v, kind, value, depth + 1);
    return out as T;
  }
  return node;
}

/**
 * 이메일 발송 관문 판정 미러(`email-ai.ts PLACEHOLDER_PATTERN`) — 화면의 "보내기 전에 N곳"이 관문이 막는 것과 같은 기준이 되게.
 * 짝 테스트가 서버 정규식 원문과 글자 단위로 대조한다.
 */
export const EMAIL_GATE_PLACEHOLDER_SOURCE = '\\[[^\\[\\]\\n]{0,60}(직접|입력해|작성해)[^\\[\\]\\n]{0,60}\\]';

/** 관문이 막는 자리 수(같은 정규식 · 전부 센다) */
export function countEmailGatePlaceholders(texts: readonly string[]): number {
  const re = new RegExp(EMAIL_GATE_PLACEHOLDER_SOURCE, 'g');
  let n = 0;
  for (const t of texts) n += (String(t || '').match(re) || []).length;
  return n;
}
