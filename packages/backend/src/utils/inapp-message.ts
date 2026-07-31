/**
 * ★ CT-27: In-app Message 컨트롤타워 — D175-A (2026-05-19)
 *
 * 🎯 목적
 *   자사몰 페이지 안에서 표시되는 banner/modal 메시지 관리.
 *   - 회사 admin이 메시지 정의 (제목/본문/CTA/위치/색상/트리거/빈도/노출 기간)
 *   - SDK가 페이지 로드 시 GET /api/cdp/inapp/active 호출 → 현재 사용자에게 표시할 메시지 반환
 *   - 표시/클릭/dismiss는 POST /api/cdp/inapp/track으로 트래킹
 *   - display_frequency 제어 (once_per_session / once_per_day / always)
 *
 * ⛔ 영구 원칙
 *   - 회사 단위 격리 (company_id 필터 절대)
 *   - 표시 빈도 제어는 클라이언트 localStorage + 서버 impressions 양쪽 검증
 *   - status='active' + start_at/end_at 윈도우 + 트리거 이벤트 매칭만 반환
 */

import { query } from '../config/database';
// ★ D215+ (2026-05-25) 통합 영역 — CT-78 (segment) + CT-80 (variant) + CT-82 (trigger window)
import { customerMatchesSegment, customerMatchesFilter, isEmptySegment, normalizeSegmentConditions } from './inapp-segment-matcher';
import { selectVariantForCustomer } from './inapp-variant-optimizer';
import { isTimeWindowValid } from './inapp-trigger-engine';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type InAppPosition = 'top_banner' | 'bottom_banner' | 'center_modal';
export type InAppFrequency = 'once_per_session' | 'once_per_day' | 'always';
export type InAppStatus = 'active' | 'paused' | 'archived';
// ★ 2026-07-16 opt_out = "다시 보지 않기" 명시 거부 (닫기 dismiss와 구분 — 영구 억제 근거)
export type InAppEventType = 'impression' | 'click' | 'dismiss' | 'opt_out';

export interface InAppMessage {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  actionLabel: string;
  position: InAppPosition;
  backgroundColor: string;
  textColor: string;
  triggerEvent: string;
  displayFrequency: InAppFrequency;
  startAt: Date | null;
  endAt: Date | null;
  status: InAppStatus;
  channel: 'web' | 'app';
}

export interface CreateInAppMessageInput {
  title: string;
  body: string;
  actionUrl?: string;
  /** ★ P0-2 (Codex 2R) — 라우트가 req.body를 그대로 전달하므로 snake_case 키도 수용 (list 응답이 snake라 왕복 저장 대칭) */
  action_url?: string | null;
  actionLabel?: string;
  position?: InAppPosition;
  backgroundColor?: string;
  textColor?: string;
  triggerEvent?: string;
  displayFrequency?: InAppFrequency;
  startAt?: string | null;
  endAt?: string | null;
  status?: InAppStatus;
  channel?: 'web' | 'app';
  // ★ 누락 시 이미지·CTA·표시형태·세그먼트가 저장 안 됨 (handleSave가 보내는 snake 키 매칭)
  template?: string;
  image_url?: string | null;
  badge_text?: string | null;
  buttons?: any[];
  segment_conditions?: any;
  trigger_conditions?: any;
  personalization_vars?: any[];
  auto_dismiss_seconds?: number | null;
  max_displays_per_user?: number | null;
  send_start_hour?: number | null;
  send_end_hour?: number | null;
  allowed_weekdays?: number[];
  animation?: string;
  // ★ D230+ 2026-06-27 — 블록 조립 + 테마. content_blocks 비면 레거시 단색 렌더.
  content_blocks?: any[] | null;
  theme?: string | null;
  accent_color?: string | null;
  // ★ 2026-07-07(2) 형태 축 — classic/bubble/ticket/poster (색상 테마와 독립)
  card_style?: string | null;
  // ★ 2026-07-14 디자인 3.0 — 메시지 단위 디자인(design jsonb). undefined=유지 / null=비우기 / 객체=sanitize 후 교체
  design?: Record<string, any> | null;
  // ★ 2026-07-21 포스터형 캐러셀 — 슬라이드 배열(full_image 전용). undefined=유지 / 배열=교체(빈 배열=단일 포스터로 복귀)
  poster_slides?: any[] | null;
  // ★ 2026-07-31 이미지 클릭 랜딩 — 이미지 자체 클릭 시 이동 링크(전 템플릿 공용). undefined=유지 / null=비우기 / 값=교체.
  //   캐러셀 첫 장(slide0)의 link_url도 이 값에서 합성(프론트 assemblePosterSlides) — 단일·캐러셀 동작 일치.
  imageLinkUrl?: string | null;
  image_link_url?: string | null;
}

// ════════════════════════════════════════════════════════════════════
// ★ D230+ 블록 검증/정규화 (CT-77 AI 생성기 + 저장 라우트 공용 — 인라인 중복 금지)
// ════════════════════════════════════════════════════════════════════

export const INAPP_BLOCK_TYPES = [
  'media', 'eyebrow', 'headline', 'body', 'bullets', 'benefit',
  'countdown', 'rating', 'product', 'divider', 'spacer', 'cta_group', 'footer',
] as const;

// ★ 2026-07-14 디자인 3.0 — 시그니처 테마 7종 추가 (SDK inapp-theme VALID_KEYS·프론트 blockTheme와 1:1 동기 의무)
export const INAPP_THEME_KEYS = [
  'auto', 'light', 'dark', 'brand', 'vibrant', 'minimal',
  'editorial', 'luxury-dark', 'bold-sale', 'soft-pastel', 'paper', 'city-night', 'festive',
] as const;

export const BENEFIT_PLACEHOLDER = '[혜택 안내 — 직접 작성해주세요]';

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-14 디자인 3.0 — cdp_inapp_messages.design jsonb (전 키 옵셔널 — 미설정 = 현행 렌더)
// ════════════════════════════════════════════════════════════════════

export const INAPP_DESIGN_TREATMENTS = ['classic', 'framed', 'typographic', 'spotlight'] as const;
export const INAPP_DESIGN_MOTIONS = ['rich', 'none'] as const;
export const INAPP_DESIGN_DIMS = ['soft', 'standard', 'deep'] as const;

// ★ 2026-07-19 포스터 색 hex = 3/4/6/8자리만 (5·7자리는 RN 색 파서가 거부 — Codex 지적. CSS·RN 공통 유효 길이).
//   design(제목/본문 색) + poster_slides(슬라이드별 색·CTA 색) 공용 단일 기준.
export const POSTER_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * design jsonb 정규화 — 화이트리스트 밖 키·값은 버린다(fail-closed). 유효 키 0개 = null.
 * font_display는 font-family 문자열만 허용(무해화 — SDK safeFontFamily와 동일 문자 집합).
 */
export function sanitizeInAppDesign(raw: any): Record<string, any> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, any> = {};
  if (typeof raw.font_display === 'string') {
    const cleaned = raw.font_display.replace(/[^\w\s,"'\-]/g, '').trim().slice(0, 120);
    if (cleaned) out.font_display = cleaned;
  }
  if ((INAPP_DESIGN_TREATMENTS as readonly string[]).includes(String(raw.treatment))) out.treatment = String(raw.treatment);
  if ((INAPP_DESIGN_MOTIONS as readonly string[]).includes(String(raw.motion))) out.motion = String(raw.motion);
  // ★ 2026-07-17 텍스트 정렬 (좌/중/우). 미지정=기존 렌더(좌) — 회귀 0.
  if (['left', 'center', 'right'].includes(String(raw.text_align))) out.text_align = String(raw.text_align);
  // ★ 2026-07-19 hex = 3/4/6/8자리만: 모듈 상수 POSTER_HEX 재사용 (design + poster_slides 공용 단일 기준)
  // ★ 2026-07-18 포스터형 v2 — 오버레이 글자색 (hex만. 미지정=흰색 — SDK·미리보기 3면 동일 기본)
  if (typeof raw.poster_text_color === 'string' && POSTER_HEX.test(raw.poster_text_color.trim())) {
    out.poster_text_color = raw.poster_text_color.trim();
  }
  // ★ 2026-07-19 포스터형 편집 UX 재구성 (Harold) — 제목/본문 분리 색·크기. poster_text_color는 하위 호환 폴백으로 유지.
  if (typeof raw.poster_title_color === 'string' && POSTER_HEX.test(raw.poster_title_color.trim())) {
    out.poster_title_color = raw.poster_title_color.trim();
  }
  if (typeof raw.poster_body_color === 'string' && POSTER_HEX.test(raw.poster_body_color.trim())) {
    out.poster_body_color = raw.poster_body_color.trim();
  }
  const posterTitleSize = Number(raw.poster_title_size);
  if (Number.isFinite(posterTitleSize) && posterTitleSize >= 14 && posterTitleSize <= 32) {
    out.poster_title_size = Math.round(posterTitleSize);
  }
  const posterBodySize = Number(raw.poster_body_size);
  if (Number.isFinite(posterBodySize) && posterBodySize >= 10 && posterBodySize <= 22) {
    out.poster_body_size = Math.round(posterBodySize);
  }
  if (raw.backdrop && typeof raw.backdrop === 'object' && !Array.isArray(raw.backdrop)) {
    const bd: Record<string, any> = {};
    if ((INAPP_DESIGN_DIMS as readonly string[]).includes(String(raw.backdrop.dim))) bd.dim = String(raw.backdrop.dim);
    if (typeof raw.backdrop.blur === 'boolean') bd.blur = raw.backdrop.blur;
    if (Object.keys(bd).length > 0) out.backdrop = bd;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ★ design 쓰기 전 컬럼 선확인 — email-channel ensureDesignColumnOrThrow 미러 (양성만 캐시 — ALTER 후 자가 치유).
//   컬럼 부재 = throw('column ... does not exist') → 라우트 503 DB_MIGRATION_PENDING 변환 (부분 상태 0).
let inappDesignColumnExists: boolean | null = null;
async function ensureInAppDesignColumnOrThrow(): Promise<void> {
  if (inappDesignColumnExists !== true) {
    const res = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'cdp_inapp_messages' AND column_name = 'design'`,
    );
    if (res.rows.length === 0) {
      throw new Error('cdp_inapp_messages.design column does not exist — ALTER 실행 필요');
    }
    inappDesignColumnExists = true;
  }
}

// ★ 2026-07-21 poster_slides 컬럼 선확인 — ensureInAppDesignColumnOrThrow 미러(양성만 캐시).
//   부재 = throw('column ... does not exist') → 라우트 503 DB_MIGRATION_PENDING 변환(부분 상태 0).
// ★ 2026-07-31 이미지 클릭 랜딩 — image_link_url 쓰기 전 컬럼 선확인 (poster_slides 안전망 미러, 부재 시 503 변환).
let inappImageLinkColumnExists: boolean | null = null;
async function ensureImageLinkUrlColumnOrThrow(): Promise<void> {
  if (inappImageLinkColumnExists !== true) {
    const res = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'cdp_inapp_messages' AND column_name = 'image_link_url'`,
    );
    if (res.rows.length === 0) {
      throw new Error('cdp_inapp_messages.image_link_url column does not exist — ALTER 실행 필요');
    }
    inappImageLinkColumnExists = true;
  }
}

let inappPosterSlidesColumnExists: boolean | null = null;
async function ensurePosterSlidesColumnOrThrow(): Promise<void> {
  if (inappPosterSlidesColumnExists !== true) {
    const res = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'cdp_inapp_messages' AND column_name = 'poster_slides'`,
    );
    if (res.rows.length === 0) {
      throw new Error('cdp_inapp_messages.poster_slides column does not exist — ALTER 실행 필요');
    }
    inappPosterSlidesColumnExists = true;
  }
}

/**
 * ★ P0-2 (2026-07-12) — action_url 스킴 화이트리스트 (SDK resolveSafeNavUrl과 동일 판정 기준).
 * http:/https:(상대경로 포함)만 원문 보존, 위험 스킴(javascript:/data:/vbscript: 등)은 null 무해화
 * (저장 차단이 아니라 무해화 — 발행 우선. SDK도 이동 시 2차 차단).
 * placeholder('['로 시작 — AI 생성 "[URL — 회사 admin 수정]")는 저장 보존(SDK가 이동 차단).
 * 판정은 new URL 파싱 후 protocol 검사 — 인코딩·공백 변형은 파서 정규화를 신뢰(0710 hlj.kr 교훈).
 */
export function sanitizeActionUrl(url: any): string | null {
  if (url === undefined || url === null) return null;
  let s = String(url).trim();
  if (!s) return null;
  if (s.startsWith('[')) return s;
  // ★ 2026-07-17 프로토콜 없는 도메인(www.xxx / xxx.tld) → https:// 자동 보정.
  //   빠지면 SDK가 상대경로로 해석해 "몰도메인/www.poppon.co.kr"(404)로 이동 → CTA가 "안 가던" 근본.
  //   몰 내부 상대경로(/event 등)·스킴 있는 URL은 그대로 둔다.
  if (!/^[a-z][a-z0-9+.\-]*:/i.test(s) && !/^[/#?]/.test(s)) {
    const host = s.split(/[/?#]/)[0];
    const looksDomain =
      /^www\./i.test(host) ||
      /\.(com|net|org|io|co|kr|shop|store|app|me|biz|info|xyz|dev|ai|tv|gg|link|page|site)$/i.test(host) ||
      /\.(co|com|ne|or|go)\.kr$/i.test(host);
    if (looksDomain) s = 'https://' + s;
  }
  try {
    const parsed = new URL(s, 'https://mall.example/');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}

/** ★ P0-2 — buttons 배열의 각 action_url 무해화 (buttons 컬럼 + cta_group 블록 공용) */
export function sanitizeButtonsActionUrls(buttons: any): any[] {
  if (!Array.isArray(buttons)) return [];
  return buttons.map((b) => (b && typeof b === 'object' ? { ...b, action_url: sanitizeActionUrl(b.action_url) } : b));
}

/** 알 수 없는 type 블록 제거 + 최대 30개 + cta_group action_url 무해화(★ P0-2). (jsonb 저장 전 정규화) */
export function sanitizeContentBlocks(blocks: any): any[] {
  if (!Array.isArray(blocks)) return [];
  const allow = new Set<string>(INAPP_BLOCK_TYPES as readonly string[]);
  return blocks
    .filter((b) => b && typeof b === 'object' && typeof b.type === 'string' && allow.has(b.type))
    .slice(0, 30)
    .map((b) => (b.type === 'cta_group' ? { ...b, buttons: sanitizeButtonsActionUrls(b.buttons) } : b));
}

/** theme 키 화이트리스트 (아니면 auto) */
export function normalizeTheme(theme: any): string {
  return (INAPP_THEME_KEYS as readonly string[]).includes(String(theme)) ? String(theme) : 'auto';
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-16 범용 보장 계약 — blocks → flat 합성 (단일 소스)
//   편집기·서버·웹SDK는 블록 기반인데 flat(title·body·image_url·buttons·badge)만 읽는
//   소비자(고객사 앱 등)가 존재한다. 블록이 있으면 blocks가 진실 — flat을 블록에서 합성해
//   "만든 그대로 어디서나" 렌더+동작을 보장한다. 소비 길목 = 저장(create/update) + 응답(V2).
// ════════════════════════════════════════════════════════════════════

export interface ComposedFlat {
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  buttons: any[];
  badgeText: string | null;
}

const FLAT_BUTTON_STYLES = ['primary', 'secondary', 'tertiary', 'ghost'];

/** blocks에서 범용 보장 요소(제목·본문·이미지·버튼 최대 3·배지) 합성 — 순수 함수 (계약 테스트 고정) */
export function composeFlatFromBlocks(blocks: any[]): ComposedFlat {
  const list = Array.isArray(blocks) ? blocks.filter((b) => b && typeof b === 'object') : [];
  const text = (t: any) => String(t ?? '').trim();
  const media = list.find((b) => b.type === 'media' && text(b.url) && (b.variant === 'image' || !b.variant));
  const headline = list.find((b) => b.type === 'headline');
  const bodyBlock = list.find((b) => b.type === 'body');
  const eyebrow = list.find((b) => b.type === 'eyebrow');
  const buttons: any[] = [];
  for (const b of list) {
    if (b.type !== 'cta_group' || !Array.isArray(b.buttons)) continue;
    for (const btn of b.buttons) {
      if (buttons.length >= 3) break;
      if (!btn || typeof btn !== 'object' || !text(btn.label)) continue;
      buttons.push({
        id: String(btn.id || `btn_${buttons.length}`),
        label: String(btn.label),
        action_url: btn.action_url ?? btn.actionUrl ?? null,
        style: FLAT_BUTTON_STYLES.includes(String(btn.style)) ? String(btn.style) : (buttons.length === 0 ? 'primary' : 'secondary'),
        ...(btn.background_color ? { background_color: btn.background_color } : {}),
        ...(btn.text_color ? { text_color: btn.text_color } : {}),
      });
    }
    if (buttons.length >= 3) break;
  }
  const headlineText = headline ? text(headline.text) : '';
  const bodyText = bodyBlock ? text(bodyBlock.text) : '';
  return {
    title: headlineText || null,
    body: bodyText || headlineText || null,
    imageUrl: media ? String(media.url) : null,
    buttons,
    badgeText: eyebrow ? text(eyebrow.text) || null : null,
  };
}

/** 옛 단일 CTA(action_url·action_label) → buttons 승격 — buttons만 읽는 소비자(앱)용. 순수 함수 */
export function synthesizeButtonsFromActionUrl(actionUrl: any, actionLabel?: any): any[] {
  const u = String(actionUrl || '').trim();
  if (!u) return [];
  return [{ id: 'btn_primary', label: String(actionLabel || '자세히 보기'), action_url: u, style: 'primary' }];
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-21 포스터형 캐러셀(좌우 슬라이드) — 슬라이드 정규화 + 혜택 차단 + slide[0]→flat 합성
//   full_image 1건 = N 슬라이드(각 슬라이드 = 이미지 + 오버레이 제목/본문 + CTA 1개). slide[0]은
//   flat(image_url·title·body·buttons)으로 합성 저장 → 구버전 앱·flat 소비자가 "첫 장"을 단일 포스터로
//   안전 표시(비파괴 폴백). 색·크기 기준은 design 오버레이와 동일(POSTER_HEX·14~32/10~22). 순수 함수(계약 테스트 고정).
// ════════════════════════════════════════════════════════════════════

export const POSTER_SLIDE_MAX = 5;

export interface PosterSlide {
  image_url: string;
  title?: string;
  body?: string;
  cta?: { label?: string; action_url?: string | null; background_color?: string; text_color?: string };
  /** ★ 2026-07-31 이미지 클릭 랜딩 — 슬라이드 이미지 자체 클릭 시 이동 링크(CTA와 별개·선택). 미설정 = 무동작(기존과 동일). */
  link_url?: string | null;
  title_color?: string;
  body_color?: string;
  title_size?: number;
  body_size?: number;
}

function posterHexOrUndef(v: any): string | undefined {
  return typeof v === 'string' && POSTER_HEX.test(v.trim()) ? v.trim() : undefined;
}
function posterSizeOrUndef(v: any, min: number, max: number): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
}

/**
 * 포스터 캐러셀 슬라이드 정규화 (순수). image_url 필수(없으면 슬라이드 제거)·최대 5장.
 * CTA action_url은 sanitizeActionUrl 무해화(위험 스킴 null·placeholder 보존), 색은 POSTER_HEX(3/4/6/8자리)만,
 * 크기는 제목 14~32·본문 10~22 clamp. SDK renderPoster·편집 미리보기와 동일 폴백 기준.
 */
export function sanitizePosterSlides(raw: any): PosterSlide[] {
  if (!Array.isArray(raw)) return [];
  const out: PosterSlide[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const imageUrl = String(s.image_url ?? s.imageUrl ?? '').trim();
    if (!imageUrl) continue;  // 이미지 없는 슬라이드는 포스터 성립 X
    const slide: PosterSlide = { image_url: imageUrl };
    const title = String(s.title ?? '').trim();
    if (title) slide.title = title;
    const body = String(s.body ?? '').trim();
    if (body) slide.body = body;
    // 슬라이드별 CTA 1개 — 라벨 또는 링크가 있을 때만
    const rawCta = s.cta && typeof s.cta === 'object' && !Array.isArray(s.cta) ? s.cta : null;
    if (rawCta) {
      const label = String(rawCta.label ?? '').trim();
      const hasUrlKey = rawCta.action_url !== undefined || rawCta.actionUrl !== undefined;
      const actionUrl = hasUrlKey ? sanitizeActionUrl(rawCta.action_url ?? rawCta.actionUrl) : null;
      if (label || actionUrl) {
        const cta: NonNullable<PosterSlide['cta']> = { action_url: actionUrl };
        if (label) cta.label = label;
        const bg = posterHexOrUndef(rawCta.background_color);
        if (bg) cta.background_color = bg;
        const fg = posterHexOrUndef(rawCta.text_color);
        if (fg) cta.text_color = fg;
        slide.cta = cta;
      }
    }
    // ★ 2026-07-31 이미지 클릭 랜딩 — CTA action_url과 동일 무해화(위험 스킴 = 탈락). 값이 있을 때만 저장.
    const hasLinkKey = s.link_url !== undefined || s.linkUrl !== undefined;
    if (hasLinkKey) {
      const linkUrl = sanitizeActionUrl(s.link_url ?? s.linkUrl);
      if (linkUrl) slide.link_url = linkUrl;
    }
    const tc = posterHexOrUndef(s.title_color); if (tc) slide.title_color = tc;
    const bc = posterHexOrUndef(s.body_color); if (bc) slide.body_color = bc;
    const ts = posterSizeOrUndef(s.title_size, 14, 32); if (ts) slide.title_size = ts;
    const bs = posterSizeOrUndef(s.body_size, 10, 22); if (bs) slide.body_size = bs;
    out.push(slide);
    if (out.length >= POSTER_SLIDE_MAX) break;
  }
  return out;
}

/** 슬라이드 제목·본문·CTA 라벨의 미편집 혜택 placeholder 잔존 여부 — 저장 차단(AI 임의 혜택 영구 룰). 순수. */
export function posterSlidesHaveUneditedPlaceholder(slides: any[]): boolean {
  if (!Array.isArray(slides)) return false;
  for (const s of slides) {
    if (!s || typeof s !== 'object') continue;
    if (textHasPlaceholder(s.title) || textHasPlaceholder(s.body)) return true;
    if (s.cta && typeof s.cta === 'object' && textHasPlaceholder(s.cta.label)) return true;
  }
  return false;
}

/**
 * slide[0] → flat(제목·본문·이미지·버튼) 합성 (순수). 구버전 앱·flat 소비자가 첫 장을 단일 포스터로 표시.
 * slide에 제목/본문/CTA가 없으면 fallback(메시지 레벨 값) 유지. badge는 슬라이드 미보유 → 메시지 badge_text 별도 유지.
 */
export function composeFlatFromPosterSlides(
  slides: PosterSlide[],
  fallback: { title?: string | null; body?: string | null; imageUrl?: string | null; buttons?: any[] },
): ComposedFlat {
  const fbButtons = Array.isArray(fallback.buttons) ? fallback.buttons : [];
  const first = Array.isArray(slides) && slides.length > 0 ? slides[0] : null;
  if (!first) {
    return {
      title: fallback.title ?? null,
      body: fallback.body ?? null,
      imageUrl: fallback.imageUrl ?? null,
      buttons: fbButtons,
      badgeText: null,
    };
  }
  const buttons = first.cta
    ? [{
        id: 'btn_primary',
        label: first.cta.label || '자세히 보기',
        action_url: first.cta.action_url ?? null,
        style: 'primary',
        ...(first.cta.background_color ? { background_color: first.cta.background_color } : {}),
        ...(first.cta.text_color ? { text_color: first.cta.text_color } : {}),
      }]
    : fbButtons;
  return {
    title: first.title || (fallback.title ?? null),
    body: first.body || (fallback.body ?? null),
    imageUrl: first.image_url,
    buttons,
    badgeText: null,
  };
}

/** 서빙 시 슬라이드 CTA action_url + 이미지 클릭 link_url 재정규화 (프로토콜 없는 도메인 → https 보정 — sanitizeButtonsActionUrls 미러, DB 무변경). */
export function sanitizePosterSlidesActionUrls(slides: any): any[] {
  if (!Array.isArray(slides)) return [];
  return slides.map((s) => {
    if (!s || typeof s !== 'object') return s;
    const out: any = { ...s };
    if (out.cta && typeof out.cta === 'object') out.cta = { ...out.cta, action_url: sanitizeActionUrl(out.cta.action_url) };
    if (out.link_url) out.link_url = sanitizeActionUrl(out.link_url);
    return out;
  });
}

// ★ 2026-07-17 템플릿별 허용 블록 — SDK inapp-blocks.ts ALLOWED_BLOCKS 1:1 미러 (frontend BlockPreview 미러와 3면 동일).
//   단일 진실 = SDK. 변경 시 SDK·frontend·여기 3면 동시 갱신 의무.
//   SDK 실렌더가 미허용 블록을 조용히 건너뛰므로(renderBlocks isBlockAllowed), AI 생성 산출물은
//   저장 전에 걸러 "미리보기·실물에서 사라지는 블록이 든 생성물"을 애초에 만들지 않는다.
const INAPP_ALL_BLOCK_TYPES = ['media', 'eyebrow', 'headline', 'body', 'bullets', 'benefit', 'countdown', 'rating', 'product', 'divider', 'spacer', 'cta_group', 'footer'];
const INAPP_ALL_BLOCK_SET: ReadonlySet<string> = new Set(INAPP_ALL_BLOCK_TYPES);
export const INAPP_TEMPLATE_ALLOWED_BLOCKS: Record<string, ReadonlySet<string>> = {
  center_modal: INAPP_ALL_BLOCK_SET,
  full_screen: INAPP_ALL_BLOCK_SET,
  inline_card: INAPP_ALL_BLOCK_SET,
  slide_in: new Set(['media', 'eyebrow', 'headline', 'body', 'rating', 'product', 'benefit', 'cta_group', 'divider', 'spacer', 'footer']),
  top_banner: new Set(['media', 'eyebrow', 'headline', 'body', 'cta_group', 'footer']),
  bottom_banner: new Set(['media', 'eyebrow', 'headline', 'body', 'cta_group', 'footer']),
  toast: new Set(['eyebrow', 'headline', 'body', 'footer']),
  floating_button: new Set(['cta_group']),
  // ★ 2026-07-18 포스터형(P1) — flat 전용(전면 이미지+오버레이 텍스트). 블록 미지원 명시(빈 허용표 = 전 블록 제거)
  full_image: new Set<string>(),
};

/** 템플릿 미허용 블록 제거 — SDK isBlockAllowed와 동일 기준(정의 없는 템플릿·미지정 = 전부 유지). 순수 함수 */
export function filterBlocksForTemplate(template: string | null | undefined, blocks: any[]): any[] {
  const list = Array.isArray(blocks) ? blocks : [];
  if (!template) return list;
  const set = INAPP_TEMPLATE_ALLOWED_BLOCKS[template];
  if (!set) return list;
  return list.filter((b) => !b || typeof b !== 'object' || !b.type || set.has(String(b.type)));
}

// ★ 2026-07-07(2) 형태 축 화이트리스트 — SDK inapp-blocks CARD_STYLES와 1:1
export const INAPP_CARD_STYLES = ['classic', 'bubble', 'ticket', 'poster'] as const;

/** card_style 화이트리스트 (아니면 classic — 구버전·임의 값 안전) */
export function normalizeCardStyle(style: any): string {
  return (INAPP_CARD_STYLES as readonly string[]).includes(String(style)) ? String(style) : 'classic';
}

function textHasPlaceholder(t: any): boolean {
  const s = String(t || '');
  return s.includes('[혜택') || s.includes('[직접 작성') || s.includes('직접 작성해주세요');
}

/**
 * 블록 안 미편집 혜택 placeholder 잔존 여부 — 저장 차단용 (AI 임의 혜택 영구 룰).
 * benefit 블록은 빈 텍스트도 차단(렌더 시 기본 placeholder가 노출되므로).
 */
export function blocksHaveUneditedPlaceholder(blocks: any[]): boolean {
  if (!Array.isArray(blocks)) return false;
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'benefit') {
      if (textHasPlaceholder(b.text) || !String(b.text || '').trim()) return true;
    }
    if (['headline', 'body', 'eyebrow', 'footer'].includes(b.type) && textHasPlaceholder(b.text)) return true;
    if (b.type === 'bullets' && Array.isArray(b.items) && b.items.some((it: any) => textHasPlaceholder(it?.text))) return true;
  }
  return false;
}

/** 에러 메시지 접두 — 라우트가 400 + BENEFIT_PLACEHOLDER_UNEDITED 코드로 매핑 */
export const BENEFIT_PLACEHOLDER_ERROR = 'BENEFIT_PLACEHOLDER_UNEDITED';

// ════════════════════════════════════════════════════════════════════
// 회사 admin — CRUD
// ════════════════════════════════════════════════════════════════════

/**
 * ★ 2026-07-17 네이티브 앱 크래시 방어 — Android/iOS 앱은 색상 필드를 Color 파서로 읽어
 *   CSS 그라데이션(linear-gradient(...))이면 Color.parseColor 등에서 예외 → 앱 강제종료(웹은 CSS라 정상).
 *   그라데이션이면 첫 hex를 단색으로 추출, 못 찾으면 fallback. app 채널 응답에서만 적용(웹 그라데이션 보존).
 */
export function solidColorForApp(color: any, fallback: string): string {
  const c = String(color ?? '').trim();
  if (!c) return fallback;
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c; // 이미 단색 hex = 그대로
  const hex = c.match(/#[0-9a-fA-F]{3,8}/);    // 그라데이션 등에서 첫 hex 추출
  return hex ? hex[0] : fallback;
}

/**
 * app 채널 메시지의 색상 필드 전체를 네이티브 안전 단색으로 보정 (그라데이션 크래시 차단).
 */
export function sanitizeAppMessageColors(m: any): void {
  if (!m || typeof m !== 'object') return;
  if (m.backgroundColor != null) m.backgroundColor = solidColorForApp(m.backgroundColor, '#1c1917');
  if (m.textColor != null) m.textColor = solidColorForApp(m.textColor, '#ffffff');
  if (m.accentColor != null) m.accentColor = solidColorForApp(m.accentColor, '#f59e0b');
  if (Array.isArray(m.buttons)) {
    for (const b of m.buttons) {
      if (b && typeof b === 'object') {
        if (b.text_color != null) b.text_color = solidColorForApp(b.text_color, '#ffffff');
        if (b.background_color != null) b.background_color = solidColorForApp(b.background_color, '#f59e0b');
      }
    }
  }
  // ★ 2026-07-21 포스터 캐러셀 슬라이드 색도 단색 보정 (그라데이션 크래시 차단 — 앱 채널만)
  if (Array.isArray(m.posterSlides)) {
    for (const s of m.posterSlides) {
      if (!s || typeof s !== 'object') continue;
      if (s.title_color != null) s.title_color = solidColorForApp(s.title_color, '#ffffff');
      if (s.body_color != null) s.body_color = solidColorForApp(s.body_color, '#ffffff');
      if (s.cta && typeof s.cta === 'object') {
        if (s.cta.text_color != null) s.cta.text_color = solidColorForApp(s.cta.text_color, '#ffffff');
        if (s.cta.background_color != null) s.cta.background_color = solidColorForApp(s.cta.background_color, '#f59e0b');
      }
    }
  }
}

export async function createInAppMessage(
  companyId: string,
  createdBy: string,
  input: CreateInAppMessageInput
): Promise<InAppMessage> {
  if (!input.title || !input.body) throw new Error('title과 body는 필수입니다.');
  const validPositions: InAppPosition[] = ['top_banner', 'bottom_banner', 'center_modal'];
  const validFrequencies: InAppFrequency[] = ['once_per_session', 'once_per_day', 'always'];

  const position = (validPositions.includes(input.position as InAppPosition) ? input.position : 'top_banner') as InAppPosition;
  const frequency = (validFrequencies.includes(input.displayFrequency as InAppFrequency) ? input.displayFrequency : 'once_per_session') as InAppFrequency;
  // ★ 2026-06-17 채널 분리 — web(자사몰 팝업) / app(모바일 인앱). 미지정 시 web.
  const channel: 'web' | 'app' = input.channel === 'app' ? 'app' : 'web';

  // ★ 2026-07-18 정정2 (Harold 지시) — 포스터형은 웹·앱 공용 (앱 = 기본형 2위치 + 포스터형 구도).
  //   flat 전용 계약만 유지 — 블록 미저장 (블록이 남으면 SDK 블록 경로가 전부 걸러져 빈 배너로 무너진다).
  const template = input.template || position;

  // ★ D230+ 블록 — 정규화 + 혜택 placeholder 미편집 차단 (AI 임의 혜택 영구 룰)
  const contentBlocks = template === 'full_image' ? [] : sanitizeContentBlocks(input.content_blocks);
  if (blocksHaveUneditedPlaceholder(contentBlocks)) {
    throw new Error(`${BENEFIT_PLACEHOLDER_ERROR}: 혜택 안내를 회사 정책에 맞게 직접 작성한 뒤 저장해주세요.`);
  }
  // ★ 2026-07-21 포스터 캐러셀 — full_image 전용. 슬라이드 정규화 + 혜택 placeholder 차단.
  const posterSlides = template === 'full_image' ? sanitizePosterSlides(input.poster_slides) : [];
  if (posterSlidesHaveUneditedPlaceholder(posterSlides)) {
    throw new Error(`${BENEFIT_PLACEHOLDER_ERROR}: 혜택 안내를 회사 정책에 맞게 직접 작성한 뒤 저장해주세요.`);
  }
  const hasSlides = posterSlides.length > 0;

  // ★ 2026-07-16 범용 보장 계약 — 블록·슬라이드가 있으면 그게 진실: flat(제목·본문·이미지·버튼·배지)을 합성 저장.
  //   슬라이드(포스터 캐러셀) 우선 → slide[0]을 flat으로(구버전 앱·flat 소비자가 첫 장 표시). 그다음 블록.
  //   입구(편집기·AI·템플릿·향후 API)가 몇 개든 flat만 읽는 소비자(앱)가 같은 내용을 받는다.
  const composed = hasSlides
    ? composeFlatFromPosterSlides(posterSlides, { title: input.title, body: input.body, imageUrl: input.image_url, buttons: input.buttons })
    : (contentBlocks.length > 0 ? composeFlatFromBlocks(contentBlocks) : null);

  // ★ 2026-07-14 디자인 3.0 — design 동봉 생성은 INSERT "전" 컬럼 선확인(부분 상태 0 — 이메일 3.0 규약 미러).
  //   design 미제공 = 컬럼 자체를 INSERT에서 생략(ALTER 전 환경에서도 기존 생성 무영향).
  const design = sanitizeInAppDesign(input.design);
  if (design) await ensureInAppDesignColumnOrThrow();
  // ★ 2026-07-21 poster_slides는 INSERT에 항상 포함(컬럼 상시 참조) → 쓰기 전 컬럼 선확인(부재 시 503).
  await ensurePosterSlidesColumnOrThrow();
  // ★ 2026-07-31 image_link_url도 INSERT 상시 포함 → 동일 선확인.
  await ensureImageLinkUrlColumnOrThrow();
  // ★ (Codex 2R) 블록이 진실인 메시지는 flat 전용 이미지 링크를 저장하지 않는다 — 블록 렌더 장애 시
  //   legacy 폴백이 잔존 링크를 되살리는 경로 차단(범용 보장 계약: composed가 flat을 소유).
  const blocksAreTruth = contentBlocks.length > 0 && !hasSlides;
  const imageLinkPatch = blocksAreTruth ? { set: true, value: null } : resolveImageLinkUrlPatch(input);

  const result = await query(
    `INSERT INTO cdp_inapp_messages (
      id, company_id, created_by, title, body, action_url, action_label,
      position, background_color, text_color,
      trigger_event, display_frequency, start_at, end_at, status, channel,
      template, image_url, buttons, segment_conditions, trigger_conditions,
      personalization_vars, auto_dismiss_seconds, max_displays_per_user,
      send_start_hour, send_end_hour, allowed_weekdays, animation, badge_text,
      content_blocks, theme, accent_color, card_style, poster_slides, image_link_url${design ? ', design' : ''},
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6,
      $7, $8, $9,
      $10, $11, $12, $13, $14, $15,
      $16, $17, $18::jsonb, $19::jsonb, $20::jsonb,
      $21::jsonb, $22, $23,
      $24, $25, $26, $27, $28,
      $29::jsonb, $30, $31, $32, $33::jsonb, $34${design ? ', $35::jsonb' : ''},
      NOW(), NOW()
    ) RETURNING *`,
    [
      companyId, createdBy, composed?.title || input.title, composed?.body || input.body,
      resolveActionUrlPatch(input).value, input.actionLabel || '자세히 보기',
      position, input.backgroundColor || '#4f46e5', input.textColor || '#ffffff',
      input.triggerEvent || 'page_load', frequency,
      input.startAt || null, input.endAt || null,
      input.status || 'active', channel,
      template, composed ? composed.imageUrl : (input.image_url || null),
      JSON.stringify(sanitizeButtonsActionUrls(composed ? composed.buttons : (input.buttons || []))), JSON.stringify(normalizeSegmentConditions(input.segment_conditions || {})), JSON.stringify(input.trigger_conditions || {}),
      JSON.stringify(input.personalization_vars || []), input.auto_dismiss_seconds ?? null, input.max_displays_per_user ?? null,
      input.send_start_hour ?? null, input.send_end_hour ?? null, input.allowed_weekdays || [0, 1, 2, 3, 4, 5, 6], input.animation || 'fade',
      input.badge_text ?? composed?.badgeText ?? null,
      JSON.stringify(contentBlocks), normalizeTheme(input.theme), input.accent_color ?? null,
      normalizeCardStyle(input.card_style),
      hasSlides ? JSON.stringify(posterSlides) : null,
      imageLinkPatch.value,
      ...(design ? [JSON.stringify(design)] : []),
    ]
  );
  return mapRowToMessage(result.rows[0]);
}

export async function listInAppMessages(companyId: string, channel?: 'web' | 'app', ownerId?: string | null): Promise<Record<string, any>[]> {
  const ownerClause = ownerId ? ' AND created_by = $3::uuid' : '';
  const params: any[] = [companyId, channel || null];
  if (ownerId) params.push(ownerId);
  const result = await query(
    `SELECT * FROM cdp_inapp_messages
     WHERE company_id = $1::uuid AND status != 'archived'
       AND ($2::varchar IS NULL OR channel = $2)${ownerClause}
     ORDER BY created_at DESC`,
    params
  );
  // 편집 화면이 전체 필드(buttons·badge_text·image_url·segment_conditions·시간설정)를 그대로 받도록
  // raw row(snake_case = 프론트 MessageRow 일치) 반환. mapRowToMessage는 기본 필드만 줘서
  // 수정 진입 시 신규 필드가 통째로 비던 문제(저장 시 덮어쓰기)를 차단한다.
  return result.rows;
}

/**
 * ★ P1-1 (2026-07-12, Codex 1R 정정) — 부분 PUT 병합 신호 (순수): undefined = 기존값 유지(set:false) /
 * null = 비우기(set:true, null) / 값 = 교체(set:true, 값). SQL `CASE WHEN $flag THEN $value ELSE 기존컬럼 END`와
 * 한 세트 — 선조회 병합(read-before-write)은 동시 PUT에서 상대 커밋을 stale 값으로 되살리는 경합이 있어 폐기.
 */
export function patchPresence<T>(inputValue: T | null | undefined): { set: boolean; value: T | null } {
  return { set: inputValue !== undefined, value: inputValue === undefined ? null : inputValue };
}

/**
 * ★ P0-2 (Codex 2R 정정) — actionUrl 입력 해석 (순수): camelCase(actionUrl) 우선, snake_case(action_url)도 수용.
 * 라우트가 req.body 그대로 전달 + list 응답이 snake_case row라 snake 키 무시 시 위험 스킴 정리·명시 null 삭제가 누락된다.
 * 제공된 값은 sanitizeActionUrl 무해화 후 확정 대입(set:true), 양쪽 다 미제공 = 기존값 유지(set:false).
 */
export function resolveActionUrlPatch(input: Record<string, any>): { set: boolean; value: string | null } {
  const raw = input.actionUrl !== undefined ? input.actionUrl : input.action_url;
  return patchPresence(raw !== undefined ? sanitizeActionUrl(raw) : undefined);
}

/** ★ 2026-07-31 이미지 클릭 랜딩 — image_link_url 입력 해석 (순수): camelCase 우선·snake_case 수용, sanitizeActionUrl 무해화. */
export function resolveImageLinkUrlPatch(input: Record<string, any>): { set: boolean; value: string | null } {
  const raw = input.imageLinkUrl !== undefined ? input.imageLinkUrl : input.image_link_url;
  return patchPresence(raw !== undefined ? sanitizeActionUrl(raw) : undefined);
}

export async function updateInAppMessage(
  companyId: string,
  messageId: string,
  input: Partial<CreateInAppMessageInput>,
  ownerId?: string | null
): Promise<InAppMessage | null> {
  // 데이터 격리 — 담당자(ownerId 지정)는 본인 생성분만 수정. 아니면 null(라우트 404).
  if (ownerId) {
    const own = await query(
      `SELECT 1 FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid AND created_by = $3::uuid`,
      [messageId, companyId, ownerId],
    );
    if (own.rows.length === 0) return null;
  }
  // ★ D230+ 블록 — 제공된 경우만 정규화 + 혜택 placeholder 차단
  let blocksParam: string | null = null;
  // ★ 2026-07-16 범용 보장 계약 — 블록이 제공되고 비어있지 않으면 blocks가 진실:
  //   flat(제목·본문·이미지·버튼·배지)을 블록에서 재합성해 확정 대입(입력 flat이 stale이어도 블록 편집이 반영).
  let composed: ComposedFlat | null = null;
  // ★ 2026-07-21 composed가 포스터 슬라이드에서 왔는지 표시 — slide0 무CTA 시 buttons 처리 분기(블록은 빈 buttons=비움 유지)
  let composedFromSlides = false;
  if (input.content_blocks !== undefined) {
    const blocks = sanitizeContentBlocks(input.content_blocks);
    if (blocksHaveUneditedPlaceholder(blocks)) {
      throw new Error(`${BENEFIT_PLACEHOLDER_ERROR}: 혜택 안내를 회사 정책에 맞게 직접 작성한 뒤 저장해주세요.`);
    }
    blocksParam = JSON.stringify(blocks);
    if (blocks.length > 0) composed = composeFlatFromBlocks(blocks);
  }
  // ★ 2026-07-21 포스터 캐러셀 — 슬라이드 제공 시(presence) slide[0]을 flat으로 재합성(블록보다 우선 — full_image는 블록 미저장).
  //   빈 배열 = 단일 포스터로 복귀(poster_slides=null). 혜택 placeholder 차단.
  let posterSlidesParam: string | null = null;
  const posterSlidesProvided = input.poster_slides !== undefined;
  if (posterSlidesProvided) {
    const slides = sanitizePosterSlides(input.poster_slides);
    if (posterSlidesHaveUneditedPlaceholder(slides)) {
      throw new Error(`${BENEFIT_PLACEHOLDER_ERROR}: 혜택 안내를 회사 정책에 맞게 직접 작성한 뒤 저장해주세요.`);
    }
    posterSlidesParam = slides.length > 0 ? JSON.stringify(slides) : null;
    if (slides.length > 0) {
      composed = composeFlatFromPosterSlides(slides, { title: input.title, body: input.body, imageUrl: input.image_url, buttons: input.buttons });
      composedFromSlides = true;
    }
  }
  // ★ P1-1 — 무조건 대입이던 5필드(image_url·auto_dismiss_seconds·max_displays_per_user·send_start_hour·send_end_hour)는
  //   부분 PUT에서 통째 NULL 리셋되던 함정 → presence flag(CASE WHEN)로 원자 병합(undefined=유지/null=비우기/값=교체).
  // ★ P0-2 — action_url도 presence flag: 제공 시 무해화 값으로 확정 대입(위험 스킴 = null 클리어, 명시 null 비우기 지원).
  //   camelCase·snake_case 양쪽 수용 (Codex 2R — snake 키 무시 시 무해화·삭제 누락).
  const actionUrlPatch = resolveActionUrlPatch(input);
  // ★ 2026-07-16 범용 보장 계약 — 블록 제공 시 이미지·버튼은 블록 합성값으로 확정 대입(블록에 없으면 비움 = 편집기 표시와 일치)
  const imagePatch = composed ? { set: true, value: composed.imageUrl } : patchPresence(input.image_url);
  const dismissPatch = patchPresence(input.auto_dismiss_seconds);
  const maxDispPatch = patchPresence(input.max_displays_per_user);
  const startHourPatch = patchPresence(input.send_start_hour);
  const endHourPatch = patchPresence(input.send_end_hour);
  // ★ 2026-07-14 디자인 3.0 — design: undefined=유지(SET 절 자체 생략 — ALTER 전 환경 무영향) /
  //   null=비우기 / 객체=sanitize 후 교체(무효 키 전부 탈락 시 null). 쓰기 전 컬럼 선확인(부분 상태 0).
  const designProvided = input.design !== undefined;
  if (designProvided) await ensureInAppDesignColumnOrThrow();
  const designValue = designProvided && input.design !== null ? sanitizeInAppDesign(input.design) : null;
  // ★ 2026-07-21 poster_slides는 UPDATE에서 항상 참조(CASE $38/$39) → 쓰기 전 컬럼 선확인(부재 시 503).
  await ensurePosterSlidesColumnOrThrow();
  // ★ 2026-07-31 image_link_url도 항상 참조(CASE $40/$41) → 동일 선확인. design은 $42로 이동.
  await ensureImageLinkUrlColumnOrThrow();
  const imageLinkPatch = resolveImageLinkUrlPatch(input);
  const result = await query(
    `UPDATE cdp_inapp_messages SET
      ${designProvided ? 'design = $42::jsonb,' : ''}
      title = COALESCE($3, title),
      body = COALESCE($4, body),
      action_url = CASE WHEN $32::boolean THEN $5 ELSE action_url END,
      action_label = COALESCE($6, action_label),
      position = COALESCE($7, position),
      background_color = COALESCE($8, background_color),
      text_color = COALESCE($9, text_color),
      trigger_event = COALESCE($10, trigger_event),
      display_frequency = COALESCE($11, display_frequency),
      start_at = COALESCE($12, start_at),
      end_at = COALESCE($13, end_at),
      status = COALESCE($14, status),
      template = COALESCE($15, template),
      image_url = CASE WHEN $33::boolean THEN $16 ELSE image_url END,
      buttons = COALESCE($17::jsonb, buttons),
      segment_conditions = COALESCE($18::jsonb, segment_conditions),
      trigger_conditions = COALESCE($19::jsonb, trigger_conditions),
      personalization_vars = COALESCE($20::jsonb, personalization_vars),
      auto_dismiss_seconds = CASE WHEN $34::boolean THEN $21 ELSE auto_dismiss_seconds END,
      max_displays_per_user = CASE WHEN $35::boolean THEN $22 ELSE max_displays_per_user END,
      send_start_hour = CASE WHEN $36::boolean THEN $23 ELSE send_start_hour END,
      send_end_hour = CASE WHEN $37::boolean THEN $24 ELSE send_end_hour END,
      allowed_weekdays = COALESCE($25, allowed_weekdays),
      animation = COALESCE($26, animation),
      badge_text = COALESCE($27, badge_text),
      -- ★ 2026-07-18 — 최종 형태가 포스터형(웹·앱 공용)이면 블록 비움(flat 전용 계약 — 블록 잔존 시 실렌더가 빈 배너로 무너짐).
      --   SET 표현식은 전부 OLD 값 기준이라 template 최종값 판정식을 반복한다.
      content_blocks = CASE
        WHEN COALESCE($15, template) = 'full_image'
        THEN '[]'::jsonb
        ELSE COALESCE($28::jsonb, content_blocks)
      END,
      theme = COALESCE($29, theme),
      accent_color = COALESCE($30, accent_color),
      card_style = COALESCE($31, card_style),
      -- ★ 2026-07-21 포스터 캐러셀 슬라이드 — presence flag(제공 시 교체/비우기, 미제공 시 유지). full_image 아닌 메시지엔 무해(미판독).
      poster_slides = CASE WHEN $38::boolean THEN $39::jsonb ELSE poster_slides END,
      -- ★ 2026-07-31 이미지 클릭 랜딩 — presence flag(제공 시 교체/비우기, 미제공 시 유지).
      -- ★ (Codex 2R) 최종 블록이 비어있지 않은 메시지(블록이 진실)는 무조건 비움 — 부분 PUT로 블록만 갱신해도
      --   flat 전용 잔존 링크가 legacy 폴백에서 되살아나지 않는다(content_blocks SET 판정식과 동일 반복).
      image_link_url = CASE
        WHEN (CASE
          WHEN COALESCE($15, template) = 'full_image' THEN '[]'::jsonb
          ELSE COALESCE($28::jsonb, content_blocks)
        END) <> '[]'::jsonb THEN NULL
        WHEN $40::boolean THEN $41
        ELSE image_link_url
      END,
      updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING *`,
    [
      messageId, companyId,
      composed?.title ?? input.title ?? null, composed?.body ?? input.body ?? null,
      actionUrlPatch.value, input.actionLabel ?? null,
      input.position ?? null, input.backgroundColor ?? null, input.textColor ?? null,
      input.triggerEvent ?? null, input.displayFrequency ?? null,
      input.startAt ?? null, input.endAt ?? null,
      input.status ?? null,
      input.template ?? null, imagePatch.value,
      (composed
        ? (composed.buttons.length > 0
            ? JSON.stringify(sanitizeButtonsActionUrls(composed.buttons))
            : (composedFromSlides
                // 슬라이드 slide0 무CTA: buttons 제공되면 그 값, 미제공이면 null(기존 CTA 유지 — Codex ①)
                ? (input.buttons !== undefined ? JSON.stringify(sanitizeButtonsActionUrls(input.buttons || [])) : null)
                // 블록 경로: 빈 buttons = 비움(편집기 표시와 일치 계약 유지)
                : JSON.stringify(sanitizeButtonsActionUrls(composed.buttons))))
        : (input.buttons ? JSON.stringify(sanitizeButtonsActionUrls(input.buttons)) : null)), input.segment_conditions ? JSON.stringify(normalizeSegmentConditions(input.segment_conditions)) : null,
      input.trigger_conditions ? JSON.stringify(input.trigger_conditions) : null, input.personalization_vars ? JSON.stringify(input.personalization_vars) : null,
      dismissPatch.value, maxDispPatch.value,
      startHourPatch.value, endHourPatch.value,
      input.allowed_weekdays ?? null, input.animation ?? null,
      input.badge_text ?? composed?.badgeText ?? null,
      blocksParam, input.theme ? normalizeTheme(input.theme) : null, input.accent_color ?? null,
      input.card_style !== undefined && input.card_style !== null ? normalizeCardStyle(input.card_style) : null,
      actionUrlPatch.set, imagePatch.set, dismissPatch.set, maxDispPatch.set, startHourPatch.set, endHourPatch.set,
      posterSlidesProvided, posterSlidesParam,
      imageLinkPatch.set, imageLinkPatch.value,
      ...(designProvided ? [designValue ? JSON.stringify(designValue) : null] : []),
    ]
  );
  return result.rows.length > 0 ? mapRowToMessage(result.rows[0]) : null;
}

export async function deleteInAppMessage(companyId: string, messageId: string, ownerId?: string | null): Promise<boolean> {
  const ownerClause = ownerId ? ' AND created_by = $3::uuid' : '';
  const params: any[] = [messageId, companyId];
  if (ownerId) params.push(ownerId);
  const result = await query(
    `UPDATE cdp_inapp_messages SET status = 'archived', updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid${ownerClause} RETURNING id`,
    params
  );
  return result.rows.length > 0;
}

/** 소유 확인 — ownerId null(관리자)=회사 범위만, 지정 시(담당자)=본인 생성분만. 회사 밖·타인 것 = false.
 *  보조 엔드포인트(조회 통계·AI 분석·variant)가 message_id로 타 담당자 데이터에 접근하는 IDOR 차단용. */
export async function isInAppMessageOwned(companyId: string, messageId: string, ownerId?: string | null): Promise<boolean> {
  const ownerClause = ownerId ? ' AND created_by = $3::uuid' : '';
  const params: any[] = [messageId, companyId];
  if (ownerId) params.push(ownerId);
  const r = await query(
    `SELECT 1 FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid${ownerClause} LIMIT 1`,
    params,
  );
  return r.rows.length > 0;
}

// ════════════════════════════════════════════════════════════════════
// SDK — 현재 사용자에게 표시할 active 메시지 조회
// ════════════════════════════════════════════════════════════════════

export interface ActiveMessagesInput {
  companyId: string;
  triggerEvent?: string;            // 기본 'page_load'
  externalId?: string;              // 회원 식별
  anonymousId?: string;             // 비회원 식별
  /** ★ 2026-07-16 (Codex 지적) — identity_link는 (company,source,external_id) 축이라 opt_out 조회를
   *  source로 한정해 같은 external_id의 타 source 고객 오억제를 차단. 미전달 = 기존(전 source) 동작 */
  source?: string;
  /** 클라이언트가 전달한 표시 이력 (localStorage) — 서버 검증 보조 */
  seenMessageIds?: string[];
  /** ★ 2026-06-17 2단계 — 'web'(자사몰 팝업, 기본) / 'app'(웹뷰 앱 인앱). 미지정 시 web 하위호환 */
  channel?: 'web' | 'app';
}

export async function getActiveMessagesForCustomer(input: ActiveMessagesInput): Promise<InAppMessage[]> {
  const trigger = input.triggerEvent || 'page_load';

  const result = await query(
    `SELECT * FROM cdp_inapp_messages
     WHERE company_id = $1::uuid
       AND status = 'active'
       AND trigger_event = $2
       AND (start_at IS NULL OR start_at <= NOW())
       AND (end_at IS NULL OR end_at >= NOW())
     ORDER BY created_at DESC
     LIMIT 5`,
    [input.companyId, trigger]
  );

  let messages = result.rows.map(mapRowToMessage);

  // display_frequency 서버측 보조 검증 (클라이언트 localStorage가 진짜 진실의 원천)
  // once_per_day 메시지는 같은 사용자가 24h 안에 본 적 있는지 cdp_inapp_impressions 검증
  const onceMessages = messages.filter((m) => m.displayFrequency === 'once_per_day');
  if (onceMessages.length > 0 && (input.externalId || input.anonymousId)) {
    const messageIds = onceMessages.map((m) => m.id);
    const linkFilter = input.externalId
      ? `AND identity_link_id IN (SELECT id FROM cdp_identity_links WHERE company_id = $1::uuid AND external_id = $3)`
      : `AND anonymous_id = $3`;
    const seenResult = await query(
      `SELECT DISTINCT message_id FROM cdp_inapp_impressions
       WHERE company_id = $1::uuid
         AND message_id = ANY($2::uuid[])
         AND event_type = 'impression'
         AND occurred_at > NOW() - INTERVAL '24 hours'
         ${linkFilter}`,
      [input.companyId, messageIds, input.externalId || input.anonymousId]
    );
    const seenIds = new Set<string>(seenResult.rows.map((r: any) => r.message_id));
    messages = messages.filter((m) => m.displayFrequency !== 'once_per_day' || !seenIds.has(m.id));
  }

  // 클라이언트가 전달한 seenMessageIds 제외 (once_per_session 메시지)
  if (input.seenMessageIds && input.seenMessageIds.length > 0) {
    const seenSet = new Set(input.seenMessageIds);
    messages = messages.filter((m) => m.displayFrequency !== 'once_per_session' || !seenSet.has(m.id));
  }

  return messages;
}

// ════════════════════════════════════════════════════════════════════
// SDK — 표시/클릭/dismiss 트래킹
// ════════════════════════════════════════════════════════════════════

export interface TrackImpressionInput {
  companyId: string;
  messageId: string;
  eventType: InAppEventType;
  customerId?: string | null;
  identityLinkId?: string | null;
  anonymousId?: string | null;
  // ★ D215+ (2026-05-25) 신규 컬럼
  buttonId?: string | null;              // 다중 CTA click 분리용
  dwellSeconds?: number | null;          // 체류 시간 (UI 자세히 분석)
  attributedPurchaseId?: string | null;  // 24h purchase attribution 직접 매핑
}

export async function trackImpression(input: TrackImpressionInput): Promise<void> {
  if (!input.companyId || !input.messageId || !input.eventType) {
    throw new Error('companyId, messageId, eventType은 필수입니다.');
  }
  if (!['impression', 'click', 'dismiss', 'opt_out'].includes(input.eventType)) {
    throw new Error(`허용되지 않는 event_type: ${input.eventType}`);
  }
  // ★ P0-3 (2026-07-12) — message 소유 검증. 타사/임의 uuid로 자기 회사 impressions에 유령 행 적재 차단.
  //   CT 단일 길목(소비처 = POST /inapp/track 1곳)이라 여기서 전부 커버. uuid 형식 오류도 동일 메시지로 400 매핑.
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(input.messageId)) {
    throw new Error('메시지를 찾을 수 없습니다.');
  }
  const own = await query(
    `SELECT 1 FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
    [input.messageId, input.companyId]
  );
  if (own.rows.length === 0) {
    throw new Error('메시지를 찾을 수 없습니다.');
  }
  await query(
    `INSERT INTO cdp_inapp_impressions (
      company_id, message_id, customer_id, identity_link_id, anonymous_id,
      event_type, button_id, dwell_seconds, attributed_purchase_id, occurred_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
      $6, $7, $8, $9::uuid, NOW()
    )`,
    [
      input.companyId, input.messageId,
      input.customerId || null, input.identityLinkId || null, input.anonymousId || null,
      input.eventType,
      input.buttonId || null,
      input.dwellSeconds ?? null,
      input.attributedPurchaseId || null,
    ]
  );
}

// ════════════════════════════════════════════════════════════════════
// 메시지별 성과 집계 (InAppMessagesPage)
// ════════════════════════════════════════════════════════════════════

export async function getMessageStats(companyId: string, messageId: string): Promise<{
  impressions: number;
  clicks: number;
  dismisses: number;
  optOuts: number;
  ctr: number;
}> {
  const result = await query(
    `SELECT event_type, COUNT(*)::int AS cnt
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid AND message_id = $2::uuid
     GROUP BY event_type`,
    [companyId, messageId]
  );
  const map: Record<string, number> = { impression: 0, click: 0, dismiss: 0, opt_out: 0 };
  result.rows.forEach((r: any) => { map[r.event_type] = r.cnt; });
  const impressions = map.impression || 0;
  return {
    impressions,
    clicks: map.click || 0,
    dismisses: map.dismiss || 0,
    optOuts: map.opt_out || 0,
    ctr: impressions > 0 ? (map.click || 0) / impressions : 0,
  };
}

// ★ D210+ Phase 3 B-4 (2026-05-23 Harold 명시): 회사 전체 메시지 통계 (CTR funnel 시각화)
//   회사 admin Dashboard 메시지별 funnel 시각화 + 비교 표 일치
export async function getCompanyInAppStats(companyId: string, channel?: 'web' | 'app'): Promise<Array<{
  messageId: string;
  title: string;
  status: string;
  impressions: number;
  clicks: number;
  dismisses: number;
  ctr: number;             // click / impression
  dismissRate: number;     // dismiss / impression
  uniqueImpressions: number;  // distinct customer_id
}>> {
  const r = await query(
    `SELECT
       m.id AS message_id,
       m.title,
       m.status,
       COUNT(*) FILTER (WHERE i.event_type = 'impression')::int AS impressions,
       COUNT(*) FILTER (WHERE i.event_type = 'click')::int AS clicks,
       COUNT(*) FILTER (WHERE i.event_type = 'dismiss')::int AS dismisses,
       COUNT(DISTINCT i.customer_id) FILTER (WHERE i.event_type = 'impression' AND i.customer_id IS NOT NULL)::int AS unique_impressions
     FROM cdp_inapp_messages m
     LEFT JOIN cdp_inapp_impressions i ON i.message_id = m.id AND i.company_id = m.company_id
     WHERE m.company_id = $1::uuid
       AND ($2::varchar IS NULL OR m.channel = $2)
     GROUP BY m.id, m.title, m.status, m.created_at
     ORDER BY m.created_at DESC`,
    // ★ P1-3 (2026-07-12) — SQL에 $2::varchar(channel)가 있는데 params가 1개라 호출 시 항상 PG bind 오류 500이던 버그 수리
    [companyId, channel || null]
  );
  return r.rows.map((row: any) => {
    const impressions = Number(row.impressions) || 0;
    const clicks = Number(row.clicks) || 0;
    const dismisses = Number(row.dismisses) || 0;
    return {
      messageId: row.message_id,
      title: row.title,
      status: row.status,
      impressions,
      clicks,
      dismisses,
      ctr: impressions > 0 ? clicks / impressions : 0,
      dismissRate: impressions > 0 ? dismisses / impressions : 0,
      uniqueImpressions: Number(row.unique_impressions) || 0,
    };
  });
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

function mapRowToMessage(row: any): InAppMessage {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url,
    actionLabel: row.action_label,
    position: row.position,
    backgroundColor: row.background_color,
    textColor: row.text_color,
    triggerEvent: row.trigger_event,
    displayFrequency: row.display_frequency,
    startAt: row.start_at ? new Date(row.start_at) : null,
    endAt: row.end_at ? new Date(row.end_at) : null,
    status: row.status,
    channel: row.channel === 'app' ? 'app' : 'web',
  };
}

// ════════════════════════════════════════════════════════════════════
// ★ D215+ (2026-05-25) 통합 — InAppMessageDetail 타입 + V2 함수 + 헬퍼
//   옛 InAppMessage + getActiveMessagesForCustomer 보존 (backward compat)
// ════════════════════════════════════════════════════════════════════

export interface InAppMessageDetail extends InAppMessage {
  template: string;
  imageUrl: string | null;
  badgeText: string | null;
  buttons: any[];
  segmentConditions: any;
  triggerConditions: any;
  personalizationVars: string[];
  parentMessageId: string | null;
  variantWeight: number;
  autoDismissSeconds: number | null;
  maxDisplaysPerUser: number | null;
  sendStartHour: number | null;
  sendEndHour: number | null;
  allowedWeekdays: number[];
  localeVariants: any;
  animation: string;
  // ★ D230+ 2026-06-27 — 블록 + 테마
  contentBlocks: any[];
  theme: string;
  accentColor: string | null;
  /** ★ 2026-07-07(2) 형태 축 — classic/bubble/ticket/poster */
  cardStyle: string;
  /** ★ 2026-07-14 디자인 3.0 — design jsonb (미설정 = null = 현행 렌더. 구 SDK는 미지 필드라 무시) */
  design: Record<string, any> | null;
  /** ★ 2026-07-21 포스터 캐러셀 — 슬라이드 배열(빈 배열 = 단일 포스터). SDK가 2장 이상이면 좌우 스와이프 렌더 */
  posterSlides: PosterSlide[];
  /** ★ 2026-07-31 이미지 클릭 랜딩 — 이미지 자체 클릭 시 이동 링크(null = 무동작·기존과 동일). 구 SDK는 미지 필드라 무시 */
  imageLinkUrl: string | null;
  audienceFilter?: Record<string, any> | null;
}

function mapRowToMessageDetail(row: any): InAppMessageDetail {
  return {
    ...mapRowToMessage(row),
    template: row.template || row.position || 'top_banner',
    imageUrl: row.image_url || null,
    badgeText: row.badge_text || null,
    buttons: Array.isArray(row.buttons) ? row.buttons : [],
    segmentConditions: row.segment_conditions || {},
    triggerConditions: row.trigger_conditions || { event: row.trigger_event || 'page_load' },
    personalizationVars: Array.isArray(row.personalization_vars) ? row.personalization_vars : [],
    parentMessageId: row.parent_message_id || null,
    variantWeight: Number(row.variant_weight ?? 100),
    autoDismissSeconds: row.auto_dismiss_seconds ?? null,
    maxDisplaysPerUser: row.max_displays_per_user ?? null,
    sendStartHour: row.send_start_hour ?? null,
    sendEndHour: row.send_end_hour ?? null,
    allowedWeekdays: Array.isArray(row.allowed_weekdays) ? row.allowed_weekdays.map((d: any) => Number(d)) : [0, 1, 2, 3, 4, 5, 6],
    localeVariants: row.locale_variants || {},
    animation: row.animation || 'fade',
    contentBlocks: Array.isArray(row.content_blocks) ? row.content_blocks : [],
    theme: row.theme || 'auto',
    accentColor: row.accent_color || null,
    cardStyle: normalizeCardStyle(row.card_style),
    design: row.design && typeof row.design === 'object' ? row.design : null,
    posterSlides: Array.isArray(row.poster_slides) ? row.poster_slides : [],
    imageLinkUrl: row.image_link_url || null,
    audienceFilter: row.audience_filter || null,
  };
}

/**
 * 타겟 추출(/api/targets/extract) filter를 인앱 메시지 표시 대상으로 저장.
 * 복잡한 create/update 파라미터와 분리 — 전용 UPDATE (안전). filter=null이면 해제.
 */
export async function setInAppAudienceFilter(
  companyId: string,
  messageId: string,
  filter: Record<string, { operator: string; value: any }> | null,
  ownerId?: string | null,
): Promise<boolean> {
  const ownerClause = ownerId ? ' AND created_by = $4::uuid' : '';
  const params: any[] = [messageId, companyId, filter ? JSON.stringify(filter) : null];
  if (ownerId) params.push(ownerId);
  const r = await query(
    `UPDATE cdp_inapp_messages
        SET audience_filter = $3::jsonb, updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid${ownerClause}`,
    params,
  );
  return (r.rowCount || 0) > 0;
}

const FULL_COLUMNS = `id, title, body, action_url, action_label, position, background_color, text_color,
                      trigger_event, display_frequency, start_at, end_at, status,
                      template, image_url, badge_text, buttons, segment_conditions, trigger_conditions,
                      personalization_vars, parent_message_id, variant_weight,
                      auto_dismiss_seconds, max_displays_per_user,
                      send_start_hour, send_end_hour, allowed_weekdays, locale_variants, animation, channel,
                      content_blocks, theme, accent_color, card_style, design, audience_filter, poster_slides, image_link_url`;

/**
 * ★ D215+ V2 — SDK GET /inapp/active 호출 진입.
 *
 * 옛 V1 (getActiveMessagesForCustomer) 대비 강화:
 * - 신규 trigger_conditions 우선 매칭 (옛 trigger_event 컬럼 fallback)
 * - parent_message_id IS NULL = 부모만 후보 (variant는 CT-80 selectVariantForCustomer로 매핑)
 * - 시간대 + 요일 윈도우 검증 (CT-82 isTimeWindowValid)
 * - 세그먼트 조건 검증 (CT-78 customerMatchesSegment)
 * - max_displays_per_user 검증 (사용자별 누적 impression 한도)
 * - once_per_day 옛 영역 유지 (DB cdp_inapp_impressions 24h 매칭)
 */
export async function getActiveMessagesForCustomerV2(input: ActiveMessagesInput): Promise<InAppMessageDetail[]> {
  const trigger = input.triggerEvent || 'page_load';

  // Step 1 — 부모 메시지 후보 조회 (trigger_event 또는 trigger_conditions.event 매칭)
  const candidateResult = await query(
    `SELECT ${FULL_COLUMNS}
     FROM cdp_inapp_messages
     WHERE company_id = $1::uuid
       AND status = 'active'
       AND channel = $3
       AND parent_message_id IS NULL
       AND (trigger_event = $2 OR (trigger_conditions->>'event' = $2))
       AND (start_at IS NULL OR start_at <= NOW())
       AND (end_at IS NULL OR end_at >= NOW())
     ORDER BY created_at DESC
     LIMIT 20`,
    [input.companyId, trigger, input.channel || 'web']
  );
  let candidates: any[] = candidateResult.rows;

  // Step 2 — customer ID 매핑 (외부 ID → customer_id)
  let customerId: string | null = null;
  if (input.externalId) {
    const linkR = await query(
      `SELECT customer_id FROM cdp_identity_links
       WHERE company_id = $1::uuid AND external_id = $2 LIMIT 1`,
      [input.companyId, input.externalId]
    );
    if (linkR.rows.length > 0 && linkR.rows[0].customer_id) {
      customerId = String(linkR.rows[0].customer_id);
    }
  }

  // Step 3 — 시간대 + 요일 윈도우 + 세그먼트 검증 (개별 후보 순회)
  const passed: any[] = [];
  for (const cand of candidates) {
    const timeWindow = isTimeWindowValid({
      id: String(cand.id),
      triggerConditions: cand.trigger_conditions || { event: trigger },
      sendStartHour: cand.send_start_hour,
      sendEndHour: cand.send_end_hour,
      allowedWeekdays: Array.isArray(cand.allowed_weekdays) ? cand.allowed_weekdays.map((d: any) => Number(d)) : [0, 1, 2, 3, 4, 5, 6],
      status: cand.status,
    });
    if (!timeWindow.valid) continue;

    // ★ 2026-07-17 "전 등급 선택 = 제한 없음" 정규화 — AI가 자동 심은 grade=[전 등급]이 익명 방문자를
    //   전원 제외하던 근본 복구. 기존 메시지도 서빙 시점 정규화로 즉시 익명 노출됨(재저장 불필요).
    const segmentConds = normalizeSegmentConditions(cand.segment_conditions || {});
    if (!isEmptySegment(segmentConds)) {
      if (!customerId) continue;  // 세그먼트 조건 있는데 customer 미식별 = 매칭 불가
      const segMatch = await customerMatchesSegment(input.companyId, customerId, segmentConds).catch(() => false);
      if (!segMatch) continue;
    }

    // 타겟 추출 filter(CT-01)로 지정한 표시 대상 — 있으면 함께 평가 (없으면=기존 메시지=미영향)
    const audienceFilter = cand.audience_filter;
    if (audienceFilter && typeof audienceFilter === 'object' && Object.keys(audienceFilter).length > 0) {
      if (!customerId) continue;
      const filterMatch = await customerMatchesFilter(input.companyId, customerId, audienceFilter).catch(() => false);
      if (!filterMatch) continue;
    }

    passed.push(cand);
  }

  // Step 4 — 각 후보별 variant 매핑 (CT-80 selectVariantForCustomer)
  const selected: any[] = [];
  for (const cand of passed) {
    const selection = await selectVariantForCustomer(
      input.companyId,
      String(cand.id),
      customerId,
      input.anonymousId || null,
    ).catch(() => null);

    if (selection && !selection.isParent && selection.messageId !== String(cand.id)) {
      const variantR = await query(
        `SELECT ${FULL_COLUMNS}
         FROM cdp_inapp_messages
         WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [selection.messageId, input.companyId]
      );
      if (variantR.rows.length > 0) {
        selected.push(variantR.rows[0]);
        continue;
      }
    }
    selected.push(cand);
  }

  let messages = selected.map(mapRowToMessageDetail);

  // ★ 2026-07-16 Step 4.5 — "다시 보지 않기"(opt_out) 영구 억제. 명시 거부가 빈도 규칙보다 최우선(시간 무제한).
  //   variant에서 눌러도 부모 축(family)으로 억제해 형제 variant 재노출까지 차단.
  //   ★ Codex 1R 정정 2건: ① externalId·anonymousId 둘 다 오면 OR 매칭 — 익명으로 거부한 뒤 로그인해도 억제 유지
  //   ② identity_link 조회를 source로 한정(제공 시) — 같은 external_id의 타 source 고객 오억제 차단.
  //   (사용 컬럼 전부 기존 코드가 사용 중 — cdp_identity_links.source는 /inapp/track 라우트와 동일 축. 신규 컬럼 0)
  if (messages.length > 0 && (input.externalId || input.anonymousId)) {
    const optConds: string[] = [];
    const optParams: any[] = [input.companyId];
    if (input.externalId) {
      optParams.push(input.externalId);
      const extIdx = optParams.length;
      if (input.source) {
        optParams.push(input.source);
        optConds.push(`i.identity_link_id IN (SELECT id FROM cdp_identity_links WHERE company_id = $1::uuid AND external_id = $${extIdx} AND source = $${optParams.length})`);
      } else {
        optConds.push(`i.identity_link_id IN (SELECT id FROM cdp_identity_links WHERE company_id = $1::uuid AND external_id = $${extIdx})`);
      }
    }
    if (input.anonymousId) {
      optParams.push(input.anonymousId);
      optConds.push(`i.anonymous_id = $${optParams.length}`);
    }
    const optR = await query(
      `SELECT DISTINCT COALESCE(m2.parent_message_id, m2.id) AS root_id
       FROM cdp_inapp_impressions i
       JOIN cdp_inapp_messages m2 ON m2.id = i.message_id AND m2.company_id = i.company_id
       WHERE i.company_id = $1::uuid AND i.event_type = 'opt_out' AND (${optConds.join(' OR ')})`,
      optParams
    );
    if (optR.rows.length > 0) {
      const optedRoots = new Set<string>(optR.rows.map((r: any) => String(r.root_id)));
      messages = messages.filter((m) => !optedRoots.has(String(m.parentMessageId || m.id)));
    }
  }

  // Step 5 — once_per_day 누적 impression 검증 (24h 윈도우)
  const onceMessages = messages.filter((m) => m.displayFrequency === 'once_per_day');
  if (onceMessages.length > 0 && (input.externalId || input.anonymousId)) {
    const messageIds = onceMessages.map((m) => m.id);
    const linkFilter = input.externalId
      ? `AND identity_link_id IN (SELECT id FROM cdp_identity_links WHERE company_id = $1::uuid AND external_id = $3)`
      : `AND anonymous_id = $3`;
    const seenResult = await query(
      `SELECT DISTINCT message_id FROM cdp_inapp_impressions
       WHERE company_id = $1::uuid
         AND message_id = ANY($2::uuid[])
         AND event_type = 'impression'
         AND occurred_at > NOW() - INTERVAL '24 hours'
         ${linkFilter}`,
      [input.companyId, messageIds, input.externalId || input.anonymousId]
    );
    const seenIds = new Set<string>(seenResult.rows.map((r: any) => r.message_id));
    messages = messages.filter((m) => m.displayFrequency !== 'once_per_day' || !seenIds.has(m.id));
  }

  // Step 6 — max_displays_per_user 검증 (사용자별 누적 impression 한도)
  const limitedMessages = messages.filter((m) => m.maxDisplaysPerUser !== null && m.maxDisplaysPerUser > 0);
  if (limitedMessages.length > 0 && (customerId || input.anonymousId)) {
    const checkUserKey = customerId || input.anonymousId;
    const userFilterSql = customerId ? `customer_id = $3::uuid` : `anonymous_id = $3`;
    const limitR = await query(
      `SELECT message_id, COUNT(*)::int AS cnt
       FROM cdp_inapp_impressions
       WHERE company_id = $1::uuid
         AND message_id = ANY($2::uuid[])
         AND event_type = 'impression'
         AND ${userFilterSql}
       GROUP BY message_id`,
      [input.companyId, limitedMessages.map((m) => m.id), checkUserKey]
    );
    const userCountMap = new Map<string, number>();
    limitR.rows.forEach((r: any) => userCountMap.set(String(r.message_id), Number(r.cnt || 0)));
    messages = messages.filter((m) => {
      if (m.maxDisplaysPerUser === null || m.maxDisplaysPerUser <= 0) return true;
      const userCount = userCountMap.get(m.id) || 0;
      return userCount < m.maxDisplaysPerUser;
    });
  }

  // Step 7 — once_per_session 클라이언트 hint (옛 영역 유지)
  if (input.seenMessageIds && input.seenMessageIds.length > 0) {
    const seenSet = new Set(input.seenMessageIds);
    messages = messages.filter((m) => m.displayFrequency !== 'once_per_session' || !seenSet.has(m.id));
  }

  // ★ 2026-07-16 Step 8 — 범용 보장 계약 응답 안전망: 과거 저장분(블록만 있고 flat이 빈 메시지)도
  //   flat을 채워 전달한다(빈 곳만 채움 — DB 무변경). flat만 읽는 소비자(앱)의 이미지·버튼 소실 차단.
  for (const m of messages) {
    if (Array.isArray(m.contentBlocks) && m.contentBlocks.length > 0) {
      const flat = composeFlatFromBlocks(m.contentBlocks);
      if (!m.imageUrl && flat.imageUrl) m.imageUrl = flat.imageUrl;
      if ((!Array.isArray(m.buttons) || m.buttons.length === 0) && flat.buttons.length > 0) m.buttons = flat.buttons;
      if (!m.badgeText && flat.badgeText) m.badgeText = flat.badgeText;
      if (!String(m.title || '').trim() && flat.title) m.title = flat.title;
      if (!String(m.body || '').trim() && flat.body) m.body = flat.body;
    }
    // 옛 단일 CTA(actionUrl)만 있는 메시지 — 앱은 buttons만 읽으므로 앱 채널 응답에서만 buttons로 승격.
    // 웹은 SDK 자체 폴백(반투명 버튼 스타일)이 있어 불변 — 서버 합성 시 기존 웹 렌더 색이 바뀌는 회귀 차단.
    if (input.channel === 'app' && (!Array.isArray(m.buttons) || m.buttons.length === 0) && m.actionUrl) {
      m.buttons = synthesizeButtonsFromActionUrl(m.actionUrl, m.actionLabel);
    }
  }

  return messages;
}
