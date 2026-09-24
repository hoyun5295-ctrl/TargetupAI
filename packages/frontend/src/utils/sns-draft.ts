/**
 * sns-draft.ts — SNS 쓰던 글 보존 (2026-09-24 · docs/2026-09-24-sns-channel-design.md §6 '쓰던 글 보존')
 *
 * 저장 위치 = localStorage `sns-compose:v1:{companyId}:{userId}` · 7일 · 게시 성공 때 지운다.
 * ⛔ 로그아웃·401 처리에서 **이 파일의 clearSnsDrafts 하나로** 지운다(같은 PC 다른 사용자에게 남지 않게).
 * ⛔ AI 상태(원래 글·다시 쓰기)는 담지 않는다. 담는 것 = 글·태그·미디어 id·채널·미래 예약 시각·composeId·글 고치기 대상.
 */

export const SNS_DRAFT_PREFIX = 'sns-compose:v1:';
export const SNS_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SnsDraft {
  body: string;
  /** 켜진 칩 */
  onTags: string[];
  /** 이 글에서 직접 더한 칩(자주 쓰는 태그 밖) */
  extraTags: string[];
  mediaIds: string[];
  selected: string[];
  /** ISO · 미래일 때만 */
  scheduledAt: string;
  composeId: string;
  replacesPostId: string | null;
  savedAt: number;
}

export function snsDraftKey(companyId: string | null | undefined, userId: string | null | undefined): string | null {
  if (!companyId || !userId) return null;
  return `${SNS_DRAFT_PREFIX}${companyId}:${userId}`;
}

export function readSnsDraft(key: string | null): SnsDraft | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as SnsDraft;
    if (!d || typeof d !== 'object' || !Number.isFinite(d.savedAt) || Date.now() - d.savedAt > SNS_DRAFT_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function writeSnsDraft(key: string | null, draft: SnsDraft): void {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* 저장 공간이 없으면 보존만 못 한다 */ }
}

export function removeSnsDraft(key: string | null): void {
  if (!key) return;
  try { localStorage.removeItem(key); } catch { /* 무시 */ }
}

/** 로그아웃·401 — 이 브라우저의 SNS 쓰던 글을 전부 지운다. */
export function clearSnsDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SNS_DRAFT_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* 무시 */ }
}

/** 새 composeId('올리기' 한 번의 이름). */
export function newSnsComposeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID 가 없는 오래된 브라우저 — v4 모양으로 만든다
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 서버 sns-compose.ts SNS_COMPOSE_NAMESPACE 와 같은 값(계약 테스트). */
export const SNS_COMPOSE_NAMESPACE = '3b1f6a52-9c0e-5d7a-8e41-6f2c9a0b7d13';

/**
 * composeId 로 만들어질 게시물 id(서버 snsComposePostId 미러 · uuid v5).
 * 복원 전에 "이 글이 이미 저장됐는가"를 보는 데만 쓴다. 계산할 수 없으면 null.
 */
export async function snsComposePostId(companyId: string, userId: string | null, composeId: string): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const ns = SNS_COMPOSE_NAMESPACE.replace(/-/g, '');
    const nsBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) nsBytes[i] = parseInt(ns.slice(i * 2, i * 2 + 2), 16);
    const name = new TextEncoder().encode(`post:${companyId}:${userId ?? '-'}:${composeId}`);
    const buf = new Uint8Array(nsBytes.length + name.length);
    buf.set(nsBytes, 0);
    buf.set(name, nsBytes.length);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
    const b = hash.slice(0, 16);
    b[6] = (b[6] & 0x0f) | 0x50;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch {
    return null;
  }
}
