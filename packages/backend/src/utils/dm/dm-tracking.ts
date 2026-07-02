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
  /** ★ 2026-07-02(5) 요소 단위 클릭 — { "쿠폰 사용하기": 2 } 형태 (버튼/링크 라벨별 카운트) */
  elements?: Record<string, number>;
}
export type DmSectionInteractions = Record<string, DmSectionCounter>;

const MAX_SECTION_KEYS = 200;
const MAX_COUNTER = 100000;
/** 섹션당 요소 라벨 상한 (공개 입력 clamp) */
const MAX_ELEMENT_KEYS = 20;
const MAX_ELEMENT_LABEL = 60;
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

/** 요소 클릭 맵 정제 — 라벨 길이·키 수·카운터 상한 (공개 입력) */
function sanitizeElements(raw: any): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  let count = 0;
  for (const key of Object.keys(raw)) {
    if (count >= MAX_ELEMENT_KEYS) break;
    const k = String(key).trim().slice(0, MAX_ELEMENT_LABEL);
    const n = toInt((raw as any)[key], 0, MAX_COUNTER, 0);
    if (!k || n === 0) continue;
    out[k] = n;
    count++;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 비콘 section_interactions 정제 — {views, clicks, elements?}만 통과, 키 수·카운터 상한 */
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
    const elements = sanitizeElements(v.elements);
    if (views === 0 && clicks === 0 && !elements) continue;
    out[k] = elements ? { views, clicks, elements } : { views, clicks };
    count++;
  }
  return out;
}

/** 저장분 + 증가분 합산 병합 (클라는 직전 비콘 이후 증가분만 전송) */
export function mergeSectionInteractions(existing: any, delta: DmSectionInteractions): DmSectionInteractions {
  const base = sanitizeSectionInteractions(existing);
  for (const [k, d] of Object.entries(delta)) {
    const cur = base[k] || { views: 0, clicks: 0 };
    const merged: DmSectionCounter = {
      views: Math.min(MAX_COUNTER, cur.views + d.views),
      clicks: Math.min(MAX_COUNTER, cur.clicks + d.clicks),
    };
    // 요소 클릭 합산 — 기존 라벨 우선 유지, 신규 라벨은 상한(MAX_ELEMENT_KEYS)까지만 추가
    const curEls = cur.elements || {};
    const deltaEls = d.elements || {};
    const els: Record<string, number> = { ...curEls };
    for (const [label, n] of Object.entries(deltaEls)) {
      if (els[label] === undefined && Object.keys(els).length >= MAX_ELEMENT_KEYS) continue;
      els[label] = Math.min(MAX_COUNTER, (els[label] || 0) + n);
    }
    if (Object.keys(els).length > 0) merged.elements = els;
    base[k] = merged;
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

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-02(5) 수신자별 상세 추적 표시 — 순수 헬퍼 (섹션 라벨 + 응답 요약)
// ════════════════════════════════════════════════════════════════════

const SECTION_TYPE_LABELS: Record<string, string> = {
  header: '헤더', hero: '히어로', coupon: '쿠폰', countdown: '카운트다운', text_card: '텍스트',
  cta: 'CTA 버튼', video: '영상', store_info: '매장 정보', sns: 'SNS', promo_code: '프로모 코드',
  footer: '하단 정보', product_carousel: '상품', gallery: '갤러리', slideshow: '슬라이드쇼',
  tab_cards: '탭', poll: '투표', survey: '설문', email_capture: '이메일 수집',
  click_rewards: '클릭 리워드', lucky_draw: '추첨 응모', roulette: '룰렛',
  instant_coupon: '즉시쿠폰', limited_quantity: '선착순', youtube_embed: '유튜브',
  instagram_embed: '인스타그램', map_store_locator: '매장 찾기', reviews: '리뷰',
};

/** 섹션 타입 한글 라벨 */
export function dmSectionTypeLabel(type: string): string {
  return SECTION_TYPE_LABELS[type] || type || '섹션';
}

/** 섹션 표시 라벨 — 타입 라벨 + 대표 텍스트(있으면). 추적 화면 여정 표시용. */
export function buildDmSectionLabel(type: string, props: any): string {
  const base = dmSectionTypeLabel(type);
  const p = props || {};
  const detail =
    p.headline || p.title || p.discount_label || p.coupon_label || p.question ||
    (Array.isArray(p.buttons) ? p.buttons[0]?.label : '') || p.event_title || '';
  const text = String(detail || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  return text ? `${base} · ${text}` : base;
}

/** 응답(dm_event_responses.response_data) 사람이 읽는 요약 — 타입별 best effort + 일반 폴백 */
export function summarizeDmResponse(sectionType: string, data: any): string {
  const d = data && typeof data === 'object' ? data : {};
  try {
    switch (sectionType) {
      case 'poll': {
        const v = d.option_label || d.optionLabel || d.option_id || d.optionId || d.choice;
        return v ? `투표 선택: ${String(v).slice(0, 60)}` : '투표 참여';
      }
      case 'survey': {
        const answers = d.answers && typeof d.answers === 'object' ? d.answers : d;
        const parts = Object.entries(answers)
          .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
          .slice(0, 4)
          .map(([, v]) => String(v).replace(/\s+/g, ' ').slice(0, 30));
        return parts.length > 0 ? `설문 답변: ${parts.join(' / ')}` : '설문 제출';
      }
      case 'roulette': {
        const prize = d.prize_name || d.prizeName || d.segment_label || d.result;
        return prize ? `룰렛 결과: ${String(prize).slice(0, 40)}` : '룰렛 참여';
      }
      case 'lucky_draw':
        return '추첨 응모 완료';
      case 'instant_coupon':
        return '쿠폰 수령';
      case 'click_rewards':
        return '리워드 참여';
      case 'email_capture': {
        const em = d.email ? String(d.email) : '';
        return em ? `이메일 등록: ${em.slice(0, 40)}` : '이메일 등록';
      }
      default: {
        const parts = Object.entries(d)
          .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object' && String(v).trim() !== '')
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${String(v).slice(0, 24)}`);
        return parts.length > 0 ? parts.join(' / ') : '참여';
      }
    }
  } catch {
    return '참여';
  }
}
