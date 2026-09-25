/**
 * send-checks.ts — 직접발송 "보내기 전 점검" 화면 도구 (2026-09-25 Harold 지시)
 * 설계 SoT = docs/2026-09-25-direct-send-precheck-design.md
 *
 * - 스팸 검사 판정: 서버가 정한다(`/api/spam-filter/recent-check`의 verdict). 화면은 판정 본체를 갖지 않는다.
 * - 맞춤법 고치기: 서버 `spell-check.ts applySpellIssue`의 거울. 고친 뒤 뒤쪽 항목 위치를 민다.
 * - 경고 창 "24시간 다시 보지 않기": 사용자별 브라우저 저장(`OpenPromoPopup` 공지 창과 같은 방식).
 * ⛔ 검사 결과로 글을 바꾸지 않는다. 바뀌는 것은 사용자가 [고치기]를 누를 때뿐이다.
 */

export type SpamVerdict = 'running' | 'pass' | 'blocked' | 'warn';

export const CARRIER_LABEL: Record<string, string> = { SKT: 'SKT', KT: 'KT', LGU: 'LG U+' };
export function carrierLabel(c: string): string {
  return CARRIER_LABEL[c] || c;
}

// ─────────────── 맞춤법 ───────────────

export interface SpellIssue {
  id: string;
  start: number;
  end: number;
  before: string;
  after: string;
  kind: 'typo' | 'spacing';
  reason: string;
  blocked?: 'sms_bytes';
}

/** 고친 글(순수) — 한 항목을 원문 자리에 넣는다. 자리가 이미 바뀌었으면 원문 그대로. */
export function applySpellIssue(text: string, issue: Pick<SpellIssue, 'start' | 'end' | 'before' | 'after'>): string {
  const src = String(text ?? '');
  if (src.slice(issue.start, issue.end) !== issue.before) return src;
  return src.slice(0, issue.start) + issue.after + src.slice(issue.end);
}

/** 결과 창의 한 줄 — 고쳤는지·그대로 두기로 했는지를 함께 든다. */
export interface SpellRow {
  issue: SpellIssue;
  status: 'open' | 'fixed' | 'kept';
}

/** 한 항목을 고친 것으로 표시하고, 아직 열린 뒤쪽 항목들의 위치를 민다(순수). */
export function markSpellRowFixed(rows: readonly SpellRow[], fixed: SpellIssue): SpellRow[] {
  const delta = fixed.after.length - fixed.before.length;
  return rows.map((r) => {
    if (r.issue.id === fixed.id) return { ...r, status: 'fixed' as const };
    if (r.status === 'open' && r.issue.start >= fixed.end) {
      return { ...r, issue: { ...r.issue, start: r.issue.start + delta, end: r.issue.end + delta } };
    }
    return r;
  });
}

/**
 * 단문 바이트 잠금(순수) — 고친 뒤 발송 바이트가 한도를 넘고, 지금보다 늘어나는 고치기만 잠근다.
 * `measure` = 화면 바이트 표시와 같은 계산(명단 최장 값 · (광고) · 수신거부 줄 포함)을 호출부가 넘긴다.
 */
export function markSpellRowsByteBlocked(
  text: string,
  rows: readonly SpellRow[],
  measure: ((t: string) => number) | null,
  limit = 90,
): SpellRow[] {
  const now = measure ? measure(text) : 0;
  return rows.map((r) => {
    const { blocked: _drop, ...issue } = r.issue;
    if (!measure || r.status !== 'open') return { ...r, issue };
    const after = measure(applySpellIssue(text, r.issue));
    return after > limit && after > now ? { ...r, issue: { ...issue, blocked: 'sms_bytes' as const } } : { ...r, issue };
  });
}

// ─────────────── 경고 창 다시 보지 않기 ───────────────

export const SEND_WARN_DISMISS_MS = 24 * 60 * 60 * 1000;
const dismissKey = (userId: string) => `hanjul.sendSpamWarn.until.${userId || 'anon'}`;

export function isSendWarnDismissed(userId: string, now = Date.now()): boolean {
  try {
    return Number(localStorage.getItem(dismissKey(userId)) || 0) > now;
  } catch {
    return false;
  }
}

export function dismissSendWarn(userId: string, now = Date.now()): void {
  try {
    localStorage.setItem(dismissKey(userId), String(now + SEND_WARN_DISMISS_MS));
  } catch {
    /* 저장이 막힌 브라우저 = 다음에 다시 보인다 */
  }
}

// ─────────────── 서버 ───────────────

export interface SpamTrialStatus {
  eligible: boolean;
  limit: number;
  used: number;
  remaining: number;
  blockedFound: number;
}

export interface SpellQuota {
  unlimited: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  issuesFound: number;
  ready: boolean;
}

export interface SendCheckStatus {
  paid: boolean;
  spamTrial: SpamTrialStatus;
  spell: SpellQuota;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token') || '';
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export async function fetchSendCheckStatus(): Promise<SendCheckStatus | null> {
  try {
    const res = await fetch('/api/send-checks/status', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) return null;
    return { paid: !!data.paid, spamTrial: data.spamTrial, spell: data.spell };
  } catch {
    return null;
  }
}

export type DirectSpellResult =
  | { ok: true; issues: SpellIssue[]; failed: boolean; spell: SpellQuota | null }
  | { ok: false; code: string; error: string };

export async function runDirectSpellCheck(text: string): Promise<DirectSpellResult> {
  try {
    const res = await fetch('/api/send-checks/spell', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return { ok: false, code: String(data.code || res.status), error: String(data.error || '맞춤법 검사를 하지 못했어요. 잠시 뒤 다시 눌러 주세요.') };
    }
    return { ok: true, issues: Array.isArray(data.issues) ? data.issues : [], failed: !!data.failed, spell: data.spell || null };
  } catch {
    return { ok: false, code: 'NETWORK', error: '맞춤법 검사를 하지 못했어요. 잠시 뒤 다시 눌러 주세요.' };
  }
}

export interface RecentSpamCheck {
  checked: boolean;
  unknown?: boolean;
  testId?: string;
  verdict?: SpamVerdict;
  checkedAt?: string;
  trial?: boolean;
  blockedCarriers?: string[];
  missingCarriers?: string[];
}

/** 이 문안을 최근 24시간 안에 검사했는가(서버 원장). 실패 = 모름. */
export async function fetchRecentSpamCheck(body: {
  callbackNumber: string;
  messageType: string;
  messageContentSms: string;
  messageContentLms: string;
}): Promise<RecentSpamCheck> {
  try {
    const res = await fetch('/api/spam-filter/recent-check', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return { checked: false, unknown: true };
    return data as RecentSpamCheck;
  } catch {
    return { checked: false, unknown: true };
  }
}

/**
 * ★ 2026-09-25 카카오 창(알림톡·브랜드메시지) → 문자 발송 전환 때 명단 넘기기(Codex 8R · 직접발송 → 카카오와 대칭).
 * 결과 = 카카오 명단 그대로(수·순서). 문자 명단 줄의 이름·기타 칸은 아래 규칙으로만 이어 쓴다.
 * incoming = 알림톡은 줄 자체 · 브랜드는 번호 목록.
 *   ① 줄 정체가 있으면(알림톡이 문자 명단의 줄 객체를 그대로 받아 지우기만 한 경우) 같은 줄은 그 줄 그대로 ·
 *      나머지는 번호만. 같은 번호 여러 줄(주문A/주문B)도 어느 줄을 지웠는지 정확하다(Codex 9R).
 *   ② 줄 정체가 없으면 번호 목록으로 본다. 중복 없는 목록의 번호 집합이 문자 명단과 같으면 **그대로 둔다**(null) —
 *      중복 없는 목록은 같은 번호 여러 줄을 담지 못하므로 집합이 같다 = 고친 것이 없다(들렀다 오기만 해도 줄이 줄어드는 일 차단).
 *      다르면 남은 문자 명단 줄과 번호로 **순서대로 하나씩** 짝짓고(첫 줄 반복 금지), 짝이 없으면 번호만.
 * ⛔ 새 줄은 언제나 번호만 — 카카오 쪽 줄의 다른 칸(파일 머리글 등)을 문자 명단으로 들이지 않는다.
 * ⛔ 넘어온 명단이 비었거나 결과가 지금 명단과 똑같으면 null — 문자 명단을 덮지 않는다(지우는 방향 금지 · 쓸데없는 안내 금지).
 */
export function carryPhonesToDirectRecipients<T extends { phone?: unknown }>(
  incoming: ReadonlyArray<string | T>,
  current: readonly T[],
): Array<T | { phone: string }> | null {
  const phoneOf = (x: string | T): string => String(typeof x === 'string' ? x : x?.phone ?? '').trim();
  const items = incoming.filter((x) => phoneOf(x) !== '');
  if (items.length === 0) return null;
  const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
  const currentSet = new Set<T>(current);
  const isSame = (x: string | T): x is T => typeof x !== 'string' && currentSet.has(x);
  let out: Array<T | { phone: string }>;
  if (items.some(isSame)) {
    out = items.map((x) => (isSame(x) ? x : { phone: phoneOf(x) }));
  } else {
    const keys = items.map((x) => digits(phoneOf(x)));
    const a = new Set(keys);
    const b = new Set(current.map((r) => digits(r?.phone)).filter(Boolean));
    if (a.size === keys.length && a.size === b.size && [...a].every((k) => b.has(k))) return null;
    const queue = new Map<string, T[]>();
    for (const r of current) {
      const k = digits(r?.phone);
      if (!k) continue;
      const q = queue.get(k);
      if (q) q.push(r); else queue.set(k, [r]);
    }
    out = items.map((x, idx) => queue.get(keys[idx])?.shift() || { phone: phoneOf(x) });
  }
  if (out.length === current.length && out.every((r, idx) => r === current[idx])) return null;
  return out;
}
