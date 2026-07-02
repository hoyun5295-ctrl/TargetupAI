/**
 * dm-tracking.ts — DM 열람 추적 순수 헬퍼 CT (DB import 0 — vitest 대상)
 *
 * 2026-07-02 수신자별 추적 근본 수정:
 *   발송 링크(?r=토큰)로 열어도 뷰어 비콘이 phone 빈 값이라 전부 익명으로 쌓이던 결함을
 *   "토큰 = 추적 1급 키"로 고치면서, 공개 endpoint(/track) 입력 정제·병합·진행 판정을 담당.
 *   - 비콘은 증가분(duration·섹션 카운트)만 보내고 서버가 합산 병합한다.
 *   - 공개 입력이라 키 수·카운터·시간 상한 clamp 필수.
 */

export interface DmSectionCounter {
  views: number;
  clicks: number;
}
export type DmSectionInteractions = Record<string, DmSectionCounter>;

const MAX_SECTION_KEYS = 200;
const MAX_COUNTER = 100000;
/** 비콘 1회에 인정하는 체류 증가분 상한(초) — 하트비트 15초 주기 대비 여유 */
export const MAX_DURATION_DELTA_SEC = 1800;

function toInt(v: any, min: number, max: number, def: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** page_reached 정제 (1~10000) */
export function clampPageReached(v: any): number {
  return toInt(v, 1, 10000, 1);
}

/** total_pages 정제 (0~10000) */
export function clampTotalPages(v: any): number {
  return toInt(v, 0, 10000, 0);
}

/** 체류 증가분 정제 (0~상한) */
export function clampDurationDelta(v: any): number {
  return toInt(v, 0, MAX_DURATION_DELTA_SEC, 0);
}

/** 스크롤 깊이 정제 — 숫자가 아니면 null(미측정 보존, 0으로 오염 금지) */
export function clampScrollPct(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

/** 비콘 section_interactions 정제 — {views, clicks}만 통과, 키 수·카운터 상한 */
export function sanitizeSectionInteractions(raw: any): DmSectionInteractions {
  const out: DmSectionInteractions = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let count = 0;
  for (const key of Object.keys(raw)) {
    if (count >= MAX_SECTION_KEYS) break;
    const k = String(key).slice(0, 80);
    const v = (raw as any)[key];
    if (!k || !v || typeof v !== 'object') continue;
    const views = toInt(v.views, 0, MAX_COUNTER, 0);
    const clicks = toInt(v.clicks, 0, MAX_COUNTER, 0);
    if (views === 0 && clicks === 0) continue;
    out[k] = { views, clicks };
    count++;
  }
  return out;
}

/** 저장분 + 증가분 합산 병합 (클라는 직전 비콘 이후 증가분만 전송) */
export function mergeSectionInteractions(existing: any, delta: DmSectionInteractions): DmSectionInteractions {
  const base = sanitizeSectionInteractions(existing);
  for (const [k, d] of Object.entries(delta)) {
    const cur = base[k] || { views: 0, clicks: 0 };
    base[k] = {
      views: Math.min(MAX_COUNTER, cur.views + d.views),
      clicks: Math.min(MAX_COUNTER, cur.clicks + d.clicks),
    };
  }
  return base;
}

/** 섹션 상호작용 총 클릭 수 (추적 화면 "클릭" 지표) */
export function sumSectionClicks(raw: any): number {
  const s = sanitizeSectionInteractions(raw);
  return Object.values(s).reduce((acc, c) => acc + c.clicks, 0);
}

/**
 * 열람 진행률(0~100) — 스크롤형은 max_scroll_pct 우선, 없으면(구 데이터) 페이지 도달 비율.
 */
export function computeDmProgressPct(pageReached: any, totalPages: any, maxScrollPct: any): number {
  const pct = clampScrollPct(maxScrollPct);
  if (pct !== null) return pct;
  const total = clampTotalPages(totalPages);
  if (total <= 0) return 0;
  const reached = toInt(pageReached, 0, 10000, 0);
  return Math.min(100, Math.max(0, Math.round((reached / total) * 100)));
}

/**
 * 완독 판정 — 깊이 측정값이 있으면 90% 이상, 없으면(구 데이터) 다페이지 마지막 도달.
 * 단일 페이지 + 깊이 미측정은 판정 불가 = false (구 로직의 "열람=완독" 오판 제거).
 */
export function isDmCompleted(pageReached: any, totalPages: any, maxScrollPct: any): boolean {
  const pct = clampScrollPct(maxScrollPct);
  if (pct !== null) return pct >= 90;
  const total = clampTotalPages(totalPages);
  return total > 1 && toInt(pageReached, 0, 10000, 0) >= total;
}
