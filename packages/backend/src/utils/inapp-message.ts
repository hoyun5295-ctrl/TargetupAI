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

import { UserFacingError } from './http-error';
import { query, pool, withTransaction } from '../config/database';
// ★ D215+ (2026-05-25) 통합 영역 — CT-78 (segment) + CT-80 (variant) + CT-82 (trigger window)
import { customerMatchesSegment, customerMatchesFilter, isEmptySegment, normalizeSegmentConditions } from './inapp-segment-matcher';
import { selectVariantForCustomer } from './inapp-variant-optimizer';
import { isTimeWindowValid } from './inapp-trigger-engine';
import { findAiFillPlaceholder } from './copy-benefit-detector';   // ★ 2026-10-24 ⑮ 게시 = 공용 채울 자리 판정도 함께
import { textHasPersonalizationVar } from './inapp-personalization';   // ★ 2026-11-05 통짜 장 글 = 바꿔 넣기 글 금지(치환과 같은 근거)
import { inAppDmLinkPolicyDefect } from './inapp-dm-link-policy';
import { toOwnImageRef } from './brand-image-resolver';   // ★ 2026-11-08 C116 D1 우리 그림 판정 한 곳(R1)
import { ASPECT_RATIOS, inAppStageColor } from './image-fit-spec';   // ★ C116-B 인앱 맞춤 규격 · 무대색 한 곳

/**
 * ★ 2026-11-08 C118 B1 앱 채널 모양 = 이미 깔린 어느 앱에서든 그대로 보이는 것만(설계서 docs/2026-11-08-c118-studio-per-use-inapp-app-design.md).
 *   포스터 가족(full_image) = 통짜 시트 · 사진 위 글만(떠 있는 카드 · 이벤트 카드 · 배너 시트 · 기능 띠 = 안 됨) ·
 *   포스터가 아닌 모양 = 연동 계약 v1 기본(시트 · 모달)이라 허용. 화면 거울 = frontend inappSlides appShapeAllowedFor(같은 표본 대조).
 */
const APP_BASIC_TEMPLATES: readonly string[] = ['center_modal', 'bottom_banner'];
export function appShapeAllowed(template: unknown, design: unknown): boolean {
  const t = String(template || '');
  if (APP_BASIC_TEMPLATES.includes(t)) return true;
  if (t !== 'full_image') return false;   // (Codex 구현 1R ③) 깔린 앱은 그 밖 모양을 하단 시트로 그린다 = 고른 모양과 다름
  const d: Record<string, any> = design && typeof design === 'object' ? design as Record<string, any> : {};
  const layout = String(d.poster_layout || '');
  if (layout === 'event_card' || layout === 'banner_sheet') return false;
  if (d.poster_frame === 'card') return false;
  const strip = d.poster_strip && typeof d.poster_strip === 'object' ? String(d.poster_strip.type || '') : '';
  return strip !== 'coupon' && strip !== 'countdown';
}
function appShapeSig(template: unknown, design: unknown): string {
  const d: Record<string, any> = design && typeof design === 'object' ? design as Record<string, any> : {};
  const strip = d.poster_strip && typeof d.poster_strip === 'object' ? String(d.poster_strip.type || '') : '';
  return JSON.stringify([String(template || ''), String(d.poster_layout || ''), String(d.poster_text || ''), String(d.poster_frame || ''), strip]);
}
/**
 * 앱 채널에서 안 되는 모양으로 **바뀌는** 저장만 막는다 · 이미 그 모양인 저장 행을 그대로 다시 저장 = 허용(보존 예외는 저장된 행만 · 새 행 · 새 자식은 prev = null).
 */
export function appShapeTransitionBlocked(
  prev: { template: unknown; design: unknown; channel: unknown } | null,
  next: { template: unknown; design: unknown; channel: unknown },
): boolean {
  if (next.channel !== 'app') return false;
  if (appShapeAllowed(next.template, next.design)) return false;
  if (!prev) return true;
  return prev.channel !== 'app' || appShapeSig(prev.template, prev.design) !== appShapeSig(next.template, next.design);
}
export const APP_SHAPE_ERROR = '앱에서는 이 모양을 쓸 수 없어요. 이미 깔린 앱에서 그대로 보이지 않아요. 통짜 포스터 · 사진 위 글 · 가운데 팝업 · 하단 시트 중에서 골라 주세요.';

/** ★ C118 B2 스튜디오 인앱용 그림 = 우리 그림 + 파일 이름 `.full.`(이름 CT = image-studio studioPermanentName) · 화면 거울 = legacy-app-view isFullBleedInAppImageUrl */
const FULL_BLEED_NAME_RE = /\.full\.[a-z]{3,4}$/i;
export function isFullBleedInAppImage(url: unknown): boolean {
  const ref = toOwnImageRef(String(url || '').split(/[?#]/)[0].trim());
  return !!ref && FULL_BLEED_NAME_RE.test(ref.filename);
}
import { inAppBakeKey, readInAppBake, requestInAppBake, type InAppBakeJob } from './inapp-bake';   // ★ C116 굽기 CT   // ★ 2026-11-05 §3-6 DM 참여 연결 판정(트랜잭션 연결로만 읽음)
import type { TxRun } from '../config/database';

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
  /** ★ 2026-09-29 인앱 만들기 개편(설계서 §1-4) — 편집기 초안 저장 표시. status='paused' 와 함께 올 때만 초안으로 본다
   *  (빈 제목 · 혜택 placeholder · 사진 없는 장을 받아 둔다). 그 밖 저장(플래너 제작 · 옛 경로)은 지금처럼 엄격. */
  draft?: boolean;
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

export const BENEFIT_PLACEHOLDER = '[혜택 안내: 직접 작성해주세요]';

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-14 디자인 3.0 — cdp_inapp_messages.design jsonb (전 키 옵셔널 — 미설정 = 현행 렌더)
// ════════════════════════════════════════════════════════════════════

export const INAPP_DESIGN_TREATMENTS = ['classic', 'framed', 'typographic', 'spotlight'] as const;
export const INAPP_DESIGN_MOTIONS = ['rich', 'none'] as const;
export const INAPP_DESIGN_DIMS = ['soft', 'standard', 'deep'] as const;
// ★ 2026-09-29 인앱 만들기 개편 — 포스터 계열 레이아웃(설계서 §1-1) · 닫기 방식(§1-3). 미지정 = 지금 포스터 · 지금 닫기(회귀 0).
//   SDK inapp.ts POSTER_LAYOUTS · 프론트 InAppMessagePreview · 앱 계약서와 같은 값.
export const INAPP_POSTER_LAYOUTS = ['overlay', 'event_card', 'banner_sheet'] as const;
export const INAPP_DISMISS_MODES = ['snooze_day'] as const;
// ★ 2026-11-05 인앱 포스터 재구성(설계서 docs/2026-11-05-inapp-poster-function-redesign-design.md §3-1) — design 새 키 셋.
//   poster_text 'baked' = 통짜(글이 구워진 그림 · 서빙 때 글 칸을 비운다) · poster_frame 'card' = 떠 있는 카드 · poster_strip = 기능 띠.
//   SDK poster-frame.ts · 프론트 inappSlides · 앱 계약서와 같은 값(계약 시험 CT-IA1).
export const INAPP_POSTER_TEXTS = ['baked'] as const;
export const INAPP_POSTER_FRAMES = ['card'] as const;
export const INAPP_POSTER_STRIPS = ['coupon', 'countdown'] as const;
export const INAPP_STRIP_CODE_MAX = 40;
export const INAPP_STRIP_LABEL_MAX = 30;
/** 쿠폰 코드에 쓸 수 있는 글자(게시 판정 · 저장은 자르기만 — 초안의 자리표 코드가 띠째 사라지지 않게 · §3-1) */
export const INAPP_STRIP_CODE_RE = /^[0-9A-Za-z가-힣_-]+$/;

/**
 * ★ 2026-11-05 §3-2 서빙 관문 — 클라이언트가 /inapp/active?caps= 로 알리는 「그릴 수 있는 것」 낱말 표(한 곳).
 *   SDK · 앱은 같은 낱말을 상수로 든다(계약 시험 CT-IA4). 표 밖 낱말은 버린다.
 */
export const INAPP_CLIENT_CAPS = ['poster_baked', 'frame_card', 'strip_coupon', 'strip_countdown'] as const;
export type InAppClientCap = typeof INAPP_CLIENT_CAPS[number];
/**
 * ★ 2026-11-08 C114 I-1 웹뷰 호스트(계약 v5) 낱말 — 웹뷰 앱은 우리 웹 SDK 가 그린다 = 판 넷을 다 가진 것과 같다.
 *   앱은 이 낱말 하나만 보내면 된다(모양이 늘어도 앱을 다시 고치지 않는다 · 설계서 docs/2026-11-08-c114-roadmap-v2-design.md §3 I-1).
 */
export const INAPP_WEBVIEW_CAP = 'webview';

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
  if ((INAPP_POSTER_LAYOUTS as readonly string[]).includes(String(raw.poster_layout))) out.poster_layout = String(raw.poster_layout);
  if ((INAPP_DISMISS_MODES as readonly string[]).includes(String(raw.dismiss_mode))) out.dismiss_mode = String(raw.dismiss_mode);
  // ★ 2026-11-05 §3-1 정규화 순서 = 통짜 → 틀 → 띠(뒤 둘이 정리된 poster_layout 을 본다).
  //   통짜 = 지금 포스터 갈래만(이벤트 카드 · 배너 시트와 섞지 않는다) · 틀 · 띠 = 이벤트 카드 · 배너 시트에서는 버린다(1차 = 포스터 갈래만).
  if ((INAPP_POSTER_TEXTS as readonly string[]).includes(String(raw.poster_text))) {
    out.poster_text = String(raw.poster_text);
    delete out.poster_layout;
  }
  const sheetLayout = out.poster_layout === 'event_card' || out.poster_layout === 'banner_sheet';
  if (!sheetLayout && (INAPP_POSTER_FRAMES as readonly string[]).includes(String(raw.poster_frame))) out.poster_frame = String(raw.poster_frame);
  const strip = raw.poster_strip;
  if (!sheetLayout && strip && typeof strip === 'object' && !Array.isArray(strip)
    && (INAPP_POSTER_STRIPS as readonly string[]).includes(String(strip.type))) {
    const oneLine = (v: any, max: number) => String(v ?? '').replace(/[\r\n]+/g, '').trim().slice(0, max);
    const st: Record<string, any> = { type: String(strip.type) };
    if (st.type === 'coupon') st.code = oneLine(strip.code, INAPP_STRIP_CODE_MAX);
    const label = oneLine(strip.label, INAPP_STRIP_LABEL_MAX);
    if (label) st.label = label;
    out.poster_strip = st;
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
      throw new Error('cdp_inapp_messages.design column does not exist (ALTER 실행 필요)');
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
      throw new Error('cdp_inapp_messages.image_link_url column does not exist (ALTER 실행 필요)');
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
      throw new Error('cdp_inapp_messages.poster_slides column does not exist (ALTER 실행 필요)');
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
  /** ★ 2026-09-29 인앱 만들기 개편(설계서 §1-2) — 작은 라벨 · 배너 탭 칩 */
  eyebrow?: string;
  /** 배너 윗줄(banner_sheet) */
  subtitle?: string;
  /** 글 칸 바탕(event_card) · 면 색(banner_sheet) · hex만 */
  bg_color?: string;
  /** 사진 맞춤 — 미지정 = 레이아웃 기본(event_card cover · banner_sheet contain) */
  image_fit?: 'cover' | 'contain';
  /** ★ 2026-11-05 §3-3 통짜 서빙 사본 전용 — 그 장의 원래 제목(그림 대체 글). 저장하지 않는다(toServedMessage 가 만든다). */
  alt?: string;
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
 * ★ 2026-09-29 인앱 만들기 개편 — allowEmptyImage = 사진을 아직 안 넣은 장도 자리를 지킨다(빈 image_url 로 보관).
 *   저장 CT(create · update)는 늘 true 로 부른다(Codex 1R: 엄격 저장이 사진 없는 장을 조용히 버리면 게시 판정을 비껴가고
 *   이미 저장한 장의 문안이 사라진다). 게시로 넘어가는 행은 inAppPublishDefect 가 장마다 사진을 요구해 거절한다.
 */
export function sanitizePosterSlides(raw: any, opts?: { allowEmptyImage?: boolean }): PosterSlide[] {
  if (!Array.isArray(raw)) return [];
  const out: PosterSlide[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const imageUrl = String(s.image_url ?? s.imageUrl ?? '').trim();
    if (!imageUrl && !opts?.allowEmptyImage) continue;  // 이미지 없는 슬라이드는 포스터 성립 X
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
    const eyebrow = String(s.eyebrow ?? '').trim(); if (eyebrow) slide.eyebrow = eyebrow;
    const subtitle = String(s.subtitle ?? '').trim(); if (subtitle) slide.subtitle = subtitle;
    const bg = posterHexOrUndef(s.bg_color); if (bg) slide.bg_color = bg;
    if (s.image_fit === 'cover' || s.image_fit === 'contain') slide.image_fit = s.image_fit;
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
    if (textHasPlaceholder(s.eyebrow) || textHasPlaceholder(s.subtitle)) return true;
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
    badgeText: commonPosterEyebrow(slides),
  };
}

/**
 * ★ 2026-09-29 배지 규칙(설계서 §1-2 · 회의론자 3) — 모든 장의 eyebrow 가 같으면 그 값, 하나라도 다르거나 비면 null.
 *   badge_text 는 flat 소비자(옛 앱)가 전 장에 같은 배지로 읽는다 → 장마다 다른 라벨을 한 장의 값으로 퍼뜨리지 않는다.
 *   null = 합성값 없음(입력 badge_text 가 있으면 그것 · update 는 기존값 유지). 편집기는 '' 를 명시해 비운다.
 */
export function commonPosterEyebrow(slides: PosterSlide[]): string | null {
  if (!Array.isArray(slides) || slides.length === 0) return null;
  const first = String(slides[0]?.eyebrow ?? '').trim();
  if (!first) return null;
  return slides.every((sl) => String(sl?.eyebrow ?? '').trim() === first) ? first : null;
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

/** ★ 2026-09-29 게시 조건 미달 접두 — 라우트가 400 + INAPP_NOT_PUBLISHABLE(+ 장 번호)로 매핑 */
export const INAPP_NOT_PUBLISHABLE_ERROR = 'INAPP_NOT_PUBLISHABLE';

/** 게시 중 메시지에 초안 저장이 오면 거절(라우트 409) — 늦게 도착한 자동 저장이 게시(과금 완료)를 멈춤으로 되돌리지 않게. */
export const INAPP_DRAFT_ON_LIVE_ERROR = 'INAPP_DRAFT_ON_LIVE';

/** 편집기 초안 저장인가 — draft 표시 + 멈춤 상태가 함께 와야 한다(설계서 §1-4). */
export function isInAppDraftSave(input: { draft?: any; status?: any }): boolean {
  return input?.draft === true && input?.status === 'paused';
}

export interface InAppPublishDefect {
  /** 사용자 노출 문구 */
  message: string;
  /** 편집기가 데려갈 자리 — ★ 2026-11-05 strip(기능 띠) · end_at(게시 끝 시각) · link(장 버튼 · 사진 링크) 더함 */
  field: 'title' | 'body' | 'placeholder' | 'image' | 'slide_image' | 'strip' | 'end_at' | 'link';
  /** 0부터 · 장이 정해지는 결함일 때 */
  slide?: number;
}

/** ★ 2026-11-05 §3-1 — 새 design 키 셋을 읽는 조건 한 곳(서빙 · 렌더 · 관문 · 판정 모두). snake 행 · camel 서빙 사본 둘 다 받는다. */
export function isPosterFamily(m: any): boolean {
  return !!m && typeof m === 'object' && String(m.template || m.position || '') === 'full_image';
}

/** ★ 2026-11-05 §3-3 — 통짜(글이 구워진 그림) 메시지인가 */
export function isBakedPoster(m: any): boolean {
  return isPosterFamily(m) && !!m.design && typeof m.design === 'object' && m.design.poster_text === 'baked';
}

/** ★ 2026-11-05 §3-9 — 예시 갤러리 그림 주소 머리(공개 주소 · 게시 판정이 막는다) */
export const INAPP_EXAMPLE_IMAGE_PREFIX = '/api/cdp/inapp/example-image/';

/**
 * ★ 2026-11-05 §3-2 필요 판 한 곳 — hard 가 빠진 클라이언트에는 주지 않는다 · soft 만 빠지면 틀을 지워 준다.
 *   hard = 통짜 · 띠 두 종 · 장 2장 이상 떠 있는 카드(옛 클라이언트는 틀을 지우면 여러 장을 4:5 cover 캐러셀로 잘라 그린다)
 *   soft = 장 1장 이하 떠 있는 카드(옛 한 장 포스터 = 원본 비율 · 자름 0)
 */
export function inAppRequiredCaps(m: any): { hard: InAppClientCap[]; soft: InAppClientCap[] } {
  const hard: InAppClientCap[] = [];
  const soft: InAppClientCap[] = [];
  if (!isPosterFamily(m)) return { hard, soft };
  const d = m.design && typeof m.design === 'object' ? m.design : {};
  const slidesRaw = m.poster_slides ?? m.posterSlides;
  const slideCount = Array.isArray(slidesRaw) ? slidesRaw.length : 0;
  if (d.poster_text === 'baked') hard.push('poster_baked');
  const strip = d.poster_strip && typeof d.poster_strip === 'object' ? String(d.poster_strip.type || '') : '';
  if (strip === 'coupon') hard.push('strip_coupon');
  if (strip === 'countdown') hard.push('strip_countdown');
  if (d.poster_frame === 'card') (slideCount >= 2 ? hard : soft).push('frame_card');
  return { hard, soft };
}

/** ★ 2026-11-05 §3-2 요청 낱말 → 판 집합(표 밖 버림 · 200자 · 20낱말에서 자름). 없음 = 빈 집합(옛 SDK · 지금 앱). */
export function parseInAppClientCaps(raw: any): Set<InAppClientCap> {
  const out = new Set<InAppClientCap>();
  const s = typeof raw === 'string' ? raw.slice(0, 200) : '';
  for (const w of s.split(',').slice(0, 20)) {
    const t = w.trim();
    if (t === INAPP_WEBVIEW_CAP) { for (const c of INAPP_CLIENT_CAPS) out.add(c); continue; }
    if ((INAPP_CLIENT_CAPS as readonly string[]).includes(t)) out.add(t as InAppClientCap);
  }
  return out;
}

/**
 * ★ 2026-09-29 게시 조건 CT(설계서 §1-4) — 저장된 행(snake_case) 기준 판정. 순수. null = 게시 가능.
 *   초안은 빈 제목 · placeholder · 사진 없는 장을 받아 두므로, active 로 넘어가는 모든 길목(생성 · 수정 · 플래너 실행)이
 *   이 판정 하나를 거친다. 기준은 옛 편집기 저장 검사(제목·본문 · placeholder · 포스터 사진 · 장마다 사진)와 같다.
 */
export function inAppPublishDefect(row: Record<string, any>): InAppPublishDefect | null {
  if (!row || typeof row !== 'object') return { message: '메시지를 찾을 수 없습니다.', field: 'title' };
  const buttons = Array.isArray(row.buttons) ? row.buttons : [];
  const slides = Array.isArray(row.poster_slides) ? row.poster_slides : [];
  if (!String(row.title ?? '').trim()) return { message: '제목을 입력해 주세요.', field: 'title' };
  // 장이 있는 포스터 계열은 본문이 선택이다(배너 = 큰 글 한 줄 · 이벤트 카드 = 제목만 가능 · SDK·앱은 빈 본문을 그리지 않는다).
  const posterWithSlides = row.template === 'full_image' && slides.length > 0;
  if (!posterWithSlides && !String(row.body ?? '').trim()) return { message: '본문을 입력해 주세요.', field: 'body' };
  // ★ 2026-10-24 세 채널 구조체크 ⑮ — 게시(고객에게 보이는 순간) = 공용 발송 길목 판정도 본다(꼴 + 문구 목록 · 문자 · DM · 이메일과 같은 판정).
  //   옛: 인앱만 세 낱말이라 템플릿 · AI 가 남긴 「[질문을 작성해주세요]」 · 「[환영 메시지와 첫 사용 안내를 작성해주세요]」가 게시를 지났다.
  //   저장(초안)은 옛 판정 그대로 — 템플릿의 안내 자리를 채워 가며 저장할 수 있어야 한다.
  // ★ 2026-10-24 ② 혜택 자리가 아닌 채울 자리(효능을 뺀 「[상품 소개: 직접 작성해주세요]」 등)는 그 글자를 먼저 인용한다
  //   (옛 순서 = 「직접 작성해주세요」를 품은 모든 자리에 「혜택 안내를…」이 떴다 · 화면 사본 inappSlides publishDefectOf 와 같은 순서).
  const aiFill = findAiFillPlaceholder([
    row.title, row.body, row.badge_text,
    JSON.stringify(buttons), JSON.stringify(Array.isArray(row.content_blocks) ? row.content_blocks : []), JSON.stringify(slides),
  ].map((v) => String(v ?? '')).join('\n'));
  const fillMessage = { message: `직접 채울 자리 "${aiFill}"가 남아 있어요. 그 자리를 채운 뒤 게시해 주세요.`, field: 'placeholder' as const };
  if (aiFill && !aiFill.startsWith('[혜택')) return fillMessage;
  if (
    textHasPlaceholder(row.title) || textHasPlaceholder(row.body) || textHasPlaceholder(row.badge_text)
    || buttons.some((b: any) => b && typeof b === 'object' && textHasPlaceholder(b.label))
    || blocksHaveUneditedPlaceholder(Array.isArray(row.content_blocks) ? row.content_blocks : [])
    || posterSlidesHaveUneditedPlaceholder(slides)
  ) {
    return { message: '혜택 안내를 회사 정책에 맞게 직접 작성한 뒤 게시해 주세요.', field: 'placeholder' };
  }
  if (aiFill) return fillMessage;
  if (row.template === 'full_image') {
    const idx = slides.findIndex((sl: any) => !sl || typeof sl !== 'object' || !String(sl.image_url ?? '').trim());
    if (idx >= 0) return { message: `${idx + 1}번째 장에 사진을 넣어 주세요.`, field: 'slide_image', slide: idx };
    if (!String(row.image_url ?? '').trim()) return { message: '포스터 사진을 넣어 주세요.', field: 'image' };
  }
  // ★ 2026-11-05 §3-9 예시 갤러리 그림은 게시하지 않는다(장 그림 먼저 · 다음 메시지 그림)
  const exIdx = slides.findIndex((sl: any) => sl && typeof sl === 'object' && String(sl.image_url ?? '').includes(INAPP_EXAMPLE_IMAGE_PREFIX));
  if (exIdx >= 0) return { message: `${exIdx + 1}번째 장은 예시 그림이에요. 내 그림으로 바꿔 주세요.`, field: 'slide_image', slide: exIdx };
  if (String(row.image_url ?? '').includes(INAPP_EXAMPLE_IMAGE_PREFIX)) return { message: '포스터 그림이 예시 그림이에요. 내 그림으로 바꿔 주세요.', field: 'image' };
  if (isPosterFamily(row)) {
    const d = row.design && typeof row.design === 'object' ? row.design : {};
    const strip = d.poster_strip && typeof d.poster_strip === 'object' ? d.poster_strip : null;
    // ★ §3-5 기능 띠 — 쿠폰 코드는 사람이 넣은 값만(빈 값 · 채울 자리 = 게시 불가 · 글자 종류는 여기서만 본다)
    if (strip) {
      const unfilled = (v: any) => textHasPlaceholder(v) || !!findAiFillPlaceholder(String(v ?? ''));
      if (unfilled(strip.label)) return { message: '띠 문구에 직접 채울 자리가 남아 있어요. 그 자리를 채운 뒤 게시해 주세요.', field: 'strip' };
      if (strip.type === 'coupon') {
        const code = String(strip.code ?? '').trim();
        if (!code || unfilled(code)) return { message: '쿠폰 코드를 넣어 주세요.', field: 'strip' };
        if (!INAPP_STRIP_CODE_RE.test(code)) return { message: '쿠폰 코드는 영문, 숫자, 한글, -, _ 만 쓸 수 있어요.', field: 'strip' };
      }
      // 끝 시각 판정 = 부모 행만(변형 행에는 기간이 없고 부모 기간으로만 서빙된다 · INAPP_CANDIDATE_WHERE)
      if (strip.type === 'countdown' && !row.parent_message_id) {
        if (!row.end_at) return { message: '남은 시간을 보여 주려면 게시 끝 시각을 정해 주세요.', field: 'end_at' };
        const endMs = new Date(row.end_at).getTime();
        if (!Number.isFinite(endMs) || endMs <= Date.now()) return { message: '게시 끝 시각이 지났어요. 끝 시각을 다시 정해 주세요.', field: 'end_at' };
      }
    }
    // ★ §3-3 통짜 = 그림 속 글이 메시지 · 바꿔 넣기 글은 그림에 구울 수 없다(판정 = 치환 함수와 같은 근거)
    if (d.poster_text === 'baked') {
      const varIdx = slides.findIndex((sl: any) => sl && typeof sl === 'object'
        && [sl.title, sl.body, sl.eyebrow, sl.subtitle].some((t) => textHasPersonalizationVar(t)));
      const bakedVar = '그림 속 글에는 고객 이름 같은 바꿔 넣기 글을 쓸 수 없어요.';
      if (varIdx >= 0) return { message: `${varIdx + 1}번째 장: ${bakedVar}`, field: 'title', slide: varIdx };
      if (slides.length === 0 && [row.title, row.body].some((t) => textHasPersonalizationVar(t))) return { message: bakedVar, field: 'title', slide: 0 };
    }
  }
  return null;
}

/** 게시 조건 미달 → throw 문구(접두 + JSON). 라우트가 풀어서 400 으로 답한다. */
export function inAppNotPublishableError(defect: InAppPublishDefect): Error {
  return new Error(`${INAPP_NOT_PUBLISHABLE_ERROR}: ${JSON.stringify(defect)}`);
}

/** throw 문구 → 결함(라우트용). 접두가 아니면 null. */
export function parseInAppNotPublishable(msg: string): InAppPublishDefect | null {
  if (!msg || !msg.startsWith(`${INAPP_NOT_PUBLISHABLE_ERROR}: `)) return null;
  try {
    const d = JSON.parse(msg.slice(INAPP_NOT_PUBLISHABLE_ERROR.length + 2));
    return d && typeof d.message === 'string' ? d : null;
  } catch {
    return null;
  }
}

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
      if (s.bg_color != null) s.bg_color = solidColorForApp(s.bg_color, '#ffffff');
      if (s.cta && typeof s.cta === 'object') {
        if (s.cta.text_color != null) s.cta.text_color = solidColorForApp(s.cta.text_color, '#ffffff');
        if (s.cta.background_color != null) s.cta.background_color = solidColorForApp(s.cta.background_color, '#f59e0b');
      }
    }
  }
}

/**
 * ★ 2026-10-25 인앱 게시비 한 규칙(원장 docs/2026-10-25-oneline-all-structure-check.md #92 · 성공 뒤 차감 D1 A).
 *   새로 게시(POST) · 고쳐서 게시(PUT)가 같은 함수를 부른다(옛: POST 는 차감이 실패해도 게시가 남았고 PUT 만 되돌렸다).
 *   걷음 · 이미 걷음 = 그대로 · 잔액 부족(402) · 원장 쓰기 실패(503) = 게시를 이전 상태로 되돌리고(새 메시지 = paused) 그 오류를 던진다.
 *   되돌리기마저 실패하면 운영 경보(무과금 게시 · 수동 확인).
 */
export async function settleInAppPublish(companyId: string, messageId: string, createdBy: string | null | undefined, prevStatus: InAppStatus): Promise<void> {
  const { settleOrUndo } = await import('./ai-credit');
  const { getCreditCost } = await import('./ai-credit-calc');
  // ★ 1026 Codex 1R — 걷고 · 못 걷으면 이전 상태로 · 되돌리기 실패 = [CREDIT][ORPHAN] 경보(한 함수 · 다른 결과물과 같은 길)
  await settleOrUndo({
    settle: {
      companyId, cost: getCreditCost('inapp-publish'), source: 'inapp-publish', createdBy: createdBy || null,
      idempotencyKey: `inapp-publish:${messageId}`,
    },
    undo: async () => {
      await query(
        `UPDATE cdp_inapp_messages SET status = $3, updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'active'`,
        [messageId, companyId, prevStatus],
      );
    },
    what: '인앱 게시',
  });
  // ★ 2026-11-08 C116 D10 게시 = 미리 굽기 요청(기다리지 않음 · 실패 = 기록만 · 게시는 그대로 · K5)
  void prebakeInAppMessage(companyId, messageId);
}

export async function createInAppMessage(
  companyId: string,
  createdBy: string,
  input: CreateInAppMessageInput
): Promise<InAppMessage> {
  // ★ 2026-09-29 초안(편집기 자동 저장)은 빈 제목·본문을 받아 둔다 — 게시로 넘어갈 때 inAppPublishDefect 가 요구한다.
  const draft = isInAppDraftSave(input);
  if (!draft && (!input.title || !input.body)) throw new UserFacingError(400, 'INAPP_INPUT', '제목과 내용을 모두 적어 주세요.');
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
  if (!draft && blocksHaveUneditedPlaceholder(contentBlocks)) {
    throw new UserFacingError(400, 'BENEFIT_PLACEHOLDER_UNEDITED', '혜택 안내를 회사 정책에 맞게 직접 작성한 뒤 저장해주세요.');
  }
  // ★ 2026-07-21 포스터 캐러셀 — full_image 전용. 슬라이드 정규화 + 혜택 placeholder 차단.
  const posterSlides = template === 'full_image' ? sanitizePosterSlides(input.poster_slides, { allowEmptyImage: true }) : [];
  if (!draft && posterSlidesHaveUneditedPlaceholder(posterSlides)) {
    throw new UserFacingError(400, 'BENEFIT_PLACEHOLDER_UNEDITED', '혜택 안내를 회사 정책에 맞게 직접 작성한 뒤 저장해주세요.');
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
  // ★ C118 B1 앱 채널 = 깔린 앱에서 그대로 보이는 모양만(새 행 = 보존 예외 없음)
  if (appShapeTransitionBlocked(null, { template, design, channel })) throw new UserFacingError(400, 'APP_SHAPE_UNSUPPORTED', APP_SHAPE_ERROR);
  if (design) await ensureInAppDesignColumnOrThrow();
  // ★ 2026-07-21 poster_slides는 INSERT에 항상 포함(컬럼 상시 참조) → 쓰기 전 컬럼 선확인(부재 시 503).
  await ensurePosterSlidesColumnOrThrow();
  // ★ 2026-07-31 image_link_url도 INSERT 상시 포함 → 동일 선확인.
  await ensureImageLinkUrlColumnOrThrow();
  // ★ (Codex 2R) 블록이 진실인 메시지는 flat 전용 이미지 링크를 저장하지 않는다 — 블록 렌더 장애 시
  //   legacy 폴백이 잔존 링크를 되살리는 경로 차단(범용 보장 계약: composed가 flat을 소유).
  const blocksAreTruth = contentBlocks.length > 0 && !hasSlides;
  const imageLinkPatch = blocksAreTruth ? { set: true, value: null } : resolveImageLinkUrlPatch(input);
  const finalStatus = draft ? 'paused' : (input.status || 'active');
  const finalTitle = composed?.title || input.title || '';
  const finalBody = composed?.body || input.body || '';
  const finalButtons = sanitizeButtonsActionUrls(composed ? composed.buttons : (input.buttons || []));
  const finalBadge = input.badge_text ?? composed?.badgeText ?? null;
  const finalImage = composed ? composed.imageUrl : (input.image_url || null);
  // ★ 2026-09-29 게시로 만드는 생성은 게시 조건 CT 를 거친다(초안 경로가 생겨 옛 편집기 검사만으로는 닫히지 않는다).
  // ★ 2026-11-05 §3-13 판정 행 = 저장 결과 행 — 한 트랜잭션에서 INSERT … RETURNING * 한 행으로 판정하고 미달이면 되돌린다
  //   (옛: INSERT 전 칸을 골라 만든 인라인 행 = image_link_url · action_url · end_at · design 이 빠져 새 판정이 그 칸을 못 봤다).
  const row = await withTransaction(async (run) => {
  const result = await run(
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
      companyId, createdBy, finalTitle, finalBody,
      resolveActionUrlPatch(input).value, input.actionLabel || '자세히 보기',
      position, input.backgroundColor || '#4f46e5', input.textColor || '#ffffff',
      // ★ 2026-09-27 한줄로 V2 R247 — 트리거가 따로 안 오면 trigger_conditions.event(화면 저장 경로와 같은 규칙).
      //   옛: page_load로 고정돼 AI가 고른 트리거와 무관하게 모든 페이지 로드에 노출됐다(플래너 제작 경로).
      input.triggerEvent || (typeof (input.trigger_conditions as any)?.event === 'string' ? (input.trigger_conditions as any).event : '') || 'page_load', frequency,
      input.startAt || null, input.endAt || null,
      finalStatus, channel,
      template, finalImage,
      JSON.stringify(finalButtons), JSON.stringify(normalizeSegmentConditions(input.segment_conditions || {})), JSON.stringify(input.trigger_conditions || {}),
      JSON.stringify(input.personalization_vars || []), input.auto_dismiss_seconds ?? null, input.max_displays_per_user ?? null,
      input.send_start_hour ?? null, input.send_end_hour ?? null, input.allowed_weekdays || [0, 1, 2, 3, 4, 5, 6], input.animation || 'fade',
      finalBadge,
      JSON.stringify(contentBlocks), normalizeTheme(input.theme), input.accent_color ?? null,
      normalizeCardStyle(input.card_style),
      hasSlides ? JSON.stringify(posterSlides) : null,
      imageLinkPatch.value,
      ...(design ? [JSON.stringify(design)] : []),
    ]
  );
  const saved = result.rows[0];
  const defect = await judgeSavedInAppRow(run, companyId, saved);
  if (defect) throw inAppNotPublishableError(defect);   // withTransaction 이 되돌린다(행 0 · 게시비 정산 전)
  return saved;
  });
  return mapRowToMessage(row);
}

/**
 * ★ 2026-11-05 §3-13 저장 결과 행 판정 한 곳 — create · update · createVariant · 켜기 · 전파가 쓰기 뒤 같은 트랜잭션 안에서 부른다.
 *   active 행만 · 게시 판정 → (변형이면 잠근 부모로) 변형 판정 → DM 연결 판정(그 트랜잭션 연결로만 읽음 · R41). null = 통과.
 */
export async function judgeSavedInAppRow(
  run: TxRun,
  companyId: string,
  row: Record<string, any> | null | undefined,
  lockedParent?: Record<string, any> | null,
): Promise<InAppPublishDefect | null> {
  if (!row || row.status !== 'active') return null;
  const publish = inAppPublishDefect(row);
  if (publish) return publish;
  if (lockedParent) {
    const variant = inAppVariantDefect(row, lockedParent);
    if (variant) return variant;
  }
  return inAppDmLinkPolicyDefect(run, companyId, row);
}

/**
 * ★ 2026-11-05 §3-13 잠금 한 규칙(Codex 구현 1R) — 변형 행을 쓰기 전에 부모를 먼저 잠근다(순서 = 부모 → 변형).
 *   켜기(activateInAppMessage) · 일반 수정(updateInAppMessage)이 같은 함수를 부른다 · createVariant 는 새 행이라 부모를 직접 잠근다.
 *   knownParentId = 부르는 쪽이 아는 부모 id(변형 켜기) · 없으면 대상 행의 원본 id 를 읽는다
 *   (parent_message_id 는 변형을 만든 뒤 바뀌지 않는다 = 잠금 없이 읽어도 같은 값 · 대상 행 잠금은 그 뒤 쓰기가 잡는다).
 *   부모가 아니면 { parentId: null, parent: null } · 부모 id 는 있는데 행이 없으면 parent = null.
 */
export async function lockParentFirst(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  companyId: string,
  messageId: string,
  knownParentId?: string | null,
): Promise<{ parentId: string | null; parent: Record<string, any> | null }> {
  let parentId = knownParentId ? String(knownParentId) : null;
  if (!parentId) {
    const pre = await client.query(
      `SELECT parent_message_id FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid`,
      [messageId, companyId],
    );
    parentId = pre.rows[0]?.parent_message_id ? String(pre.rows[0].parent_message_id) : null;
  }
  if (!parentId) return { parentId: null, parent: null };
  const pr = await client.query(
    `SELECT * FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
    [parentId, companyId],
  );
  return { parentId, parent: pr.rows[0] || null };
}

/**
 * ★ 2026-11-05 §3-3 변형 판정 CT — 통짜 원본(글이 구워진 그림)의 변형은 통짜 변형(그림을 바꾼 변형)만 켤 수 있다.
 *   글 얹기 시절의 문구 변형을 통짜 원본 아래에서 켜면 부모 모양을 따라 서빙 때 문구가 지워지고 배경만 나간다(Codex 1R C2).
 *   원본을 글 얹기로 되돌리면 통과(그 변형을 다시 켤 수 있다). 순수.
 */
export function inAppVariantDefect(kid: Record<string, any>, parent: Record<string, any>): InAppPublishDefect | null {
  if (!kid || !parent) return null;
  if (isBakedPoster(parent) && !isBakedPoster(kid)) {
    return { message: '그림에 글이 들어간 원본의 A/B 변형은 그림을 바꾼 변형만 켤 수 있어요. 원본을 사진 위 글로 되돌리면 이 변형을 다시 켤 수 있어요.', field: 'title' };
  }
  return null;
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
): Promise<(InAppMessage & { variantsPaused: number }) | null> {
  // 데이터 격리 — 담당자(ownerId 지정)는 본인 생성분만 수정. 아니면 null(라우트 404).
  if (ownerId) {
    const own = await query(
      `SELECT 1 FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid AND created_by = $3::uuid`,
      [messageId, companyId, ownerId],
    );
    if (own.rows.length === 0) return null;
  }
  // ★ 2026-09-29 초안(편집기 자동 저장 · 설계서 §1-4)은 placeholder·사진 없는 장을 받아 둔다. 그 밖은 지금처럼 엄격.
  const draft = isInAppDraftSave(input);
  // ★ D230+ 블록 — 제공된 경우만 정규화 + 혜택 placeholder 차단
  let blocksParam: string | null = null;
  // ★ 2026-07-16 범용 보장 계약 — 블록이 제공되고 비어있지 않으면 blocks가 진실:
  //   flat(제목·본문·이미지·버튼·배지)을 블록에서 재합성해 확정 대입(입력 flat이 stale이어도 블록 편집이 반영).
  let composed: ComposedFlat | null = null;
  // ★ 2026-07-21 composed가 포스터 슬라이드에서 왔는지 표시 — slide0 무CTA 시 buttons 처리 분기(블록은 빈 buttons=비움 유지)
  let composedFromSlides = false;
  if (input.content_blocks !== undefined) {
    const blocks = sanitizeContentBlocks(input.content_blocks);
    if (!draft && blocksHaveUneditedPlaceholder(blocks)) {
      throw new UserFacingError(400, 'BENEFIT_PLACEHOLDER_UNEDITED', '혜택 안내를 회사 정책에 맞게 직접 작성한 뒤 저장해주세요.');
    }
    blocksParam = JSON.stringify(blocks);
    if (blocks.length > 0) composed = composeFlatFromBlocks(blocks);
  }
  // ★ 2026-07-21 포스터 캐러셀 — 슬라이드 제공 시(presence) slide[0]을 flat으로 재합성(블록보다 우선 — full_image는 블록 미저장).
  //   빈 배열 = 단일 포스터로 복귀(poster_slides=null). 혜택 placeholder 차단.
  let posterSlidesParam: string | null = null;
  const posterSlidesProvided = input.poster_slides !== undefined;
  if (posterSlidesProvided) {
    const slides = sanitizePosterSlides(input.poster_slides, { allowEmptyImage: true });
    if (!draft && posterSlidesHaveUneditedPlaceholder(slides)) {
      throw new UserFacingError(400, 'BENEFIT_PLACEHOLDER_UNEDITED', '혜택 안내를 회사 정책에 맞게 직접 작성한 뒤 저장해주세요.');
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
  // ★ 2026-09-29 게시 조건은 **결과 행**으로 판정한다(설계서 §1-4). 부분 PUT 은 빠진 칸을 기존 값으로 채우므로
  //   요청만 봐서는 게시 가능 여부를 알 수 없다 → 한 트랜잭션 안에서 UPDATE … RETURNING 한 행이 active 인데
  //   게시 조건 CT(inAppPublishDefect)를 못 넘으면 되돌리고 throw(라우트 400). 초안 저장은 멈춤이라 판정 대상이 아니다.
  //   게시 중 메시지의 내용 수정(상태 생략)도 같은 판정을 거친다 — 게시 중인 메시지가 조건 미달로 바뀌는 길이 없다.
  const client = await pool.connect();
  let result: any;
  let variantsPaused = 0;
  try {
    await client.query('BEGIN');
    // ★ 2026-11-05 §3-13 잠금 한 규칙(Codex 구현 1R high) — 고치는 행이 변형이면 부모를 먼저 잠그고 그 부모로 변형 판정까지 한다
    //   (옛: 일반 수정은 부모를 모른 채 판정해, 통짜 전환으로 멈춘 문구 변형을 이 길로 다시 켤 수 있었다 · 초안 행 잠금보다 앞 = 부모 → 변형).
    const { parent: lockedParent } = await lockParentFirst(client, companyId, messageId);
    // ★ C118 B1 고치기 전 모양(보존 예외 = 이미 그 모양인 저장 행 그대로) — 같은 트랜잭션에서 잠그고 읽는다
    const shapeBefore = (await client.query(
      `SELECT template, design, channel FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [messageId, companyId],
    )).rows[0] || null;
    // ★ 2026-09-29 초안 저장은 게시 중이 아닌 행에만 — 행을 잠그고 확인한다(게시 PUT 과 순서가 바뀌어 도착해도 게시가 이긴다).
    if (draft) {
      const cur = await client.query(
        `SELECT status FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
        [messageId, companyId],
      );
      if (cur.rows[0]?.status === 'active') throw new Error(INAPP_DRAFT_ON_LIVE_ERROR);
    }
    result = await client.query(
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
      -- ★ 2026-09-29 남은 슬라이드 게이트(설계서 §1-5) — 최종 형태가 포스터가 아니면 비운다(판정식은 content_blocks 와 같은 반복).
      poster_slides = CASE
        WHEN COALESCE($15, template) IS DISTINCT FROM 'full_image' THEN NULL
        WHEN $38::boolean THEN $39::jsonb
        ELSE poster_slides
      END,
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
    const row = result.rows[0];
    if (row && appShapeTransitionBlocked(shapeBefore, { template: row.template, design: row.design, channel: row.channel })) {
      throw new UserFacingError(400, 'APP_SHAPE_UNSUPPORTED', APP_SHAPE_ERROR);
    }
    // ★ 2026-11-05 §3-13 — 결과 행 판정 한 곳(게시 판정 + DM 연결 판정 · 이 트랜잭션 연결로만 읽는다)
    const defect = row && row.status === 'active' ? await judgeSavedInAppRow((t, p) => client.query(t, p), companyId, row, lockedParent) : null;
    if (defect) throw inAppNotPublishableError(defect);
    // ★ 2026-09-29 [반영] = A/B 변형에 모양 전파(설계서 §1-4 · 회의론자 8). 같은 트랜잭션 — 부모만 바뀌고 변형이 옛 모양으로 남는 틈이 없다.
    if (row && !draft && !row.parent_message_id && (posterSlidesProvided || designProvided || input.template !== undefined)) {
      variantsPaused = (await propagatePosterToVariants(client, row)).paused;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  // ★ 2026-11-05 §3-3 — 통짜 [반영]이 멈춘 문구 변형 수(편집기가 그대로 알린다 · 화면이 따로 세지 않는다)
  return result.rows.length > 0 ? { ...mapRowToMessage(result.rows[0]), variantsPaused } : null;
}

/**
 * ★ 2026-09-29 인앱 만들기 개편 — 포스터 부모의 모양을 A/B 변형에 전파(설계서 §1-4 · 회의론자 8).
 *   변형 생성(createVariant)과 같은 규칙: 부모 장 사본 + 첫 장 제목·본문만 변형 값 · flat 은 첫 장에서 합성(버튼 fallback 없음).
 *   변형이 시험하는 것은 문안이다 → 부모에서 레이아웃·장·디자인을 바꿔도 변형만 옛 모양으로 남아 "디자인 세대 차이" 비교가 되지 않게 한다.
 *   포스터가 아닌 부모는 건드리지 않는다(블록 변형은 지금처럼 생성 때 사본 · 범위 밖).
 */
export async function propagatePosterToVariants(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  parent: Record<string, any>,
): Promise<{ applied: number; paused: number }> {
  if (!parent || parent.template !== 'full_image') return { applied: 0, paused: 0 };
  const kids = await client.query(
    // (Codex 2R 범위 밖 지적) 변형 문안을 잠그고 읽는다 — 동시에 변형을 고친 PUT 의 문안을 옛 값으로 덮지 않게
    // ★ 2026-11-05 §3-3 통짜 갈래 — 변형의 지금 그림 · 장 · 모양 · 상태를 함께 읽는다(잠금 순서 = 부모 UPDATE → 변형 FOR UPDATE · §3-13)
    `SELECT id, title, body, image_url, poster_slides, design, status FROM cdp_inapp_messages
      WHERE company_id = $1::uuid AND parent_message_id = $2::uuid AND status <> 'archived'
      FOR UPDATE`,
    [parent.company_id, parent.id],
  );
  const parentSlides: PosterSlide[] = Array.isArray(parent.poster_slides) ? parent.poster_slides : [];
  const parentBaked = isBakedPoster(parent);
  const run: TxRun = (t, p) => client.query(t, p);
  let n = 0;
  let paused = 0;
  for (const k of kids.rows) {
    // ★ 2026-11-05 §3-3 통짜 원본 — 글 얹기 시절의 문구 변형은 모양 · 장을 바꾸지 않고 멈춘다(그대로 두면 부모 모양이 옮겨 가
    //   서빙 때 문구가 지워지고 배경만 남는다 · Codex 1R C2). 다시 켜기 = inAppVariantDefect 가 막는다(원본을 되돌리면 통과).
    const kidBaked = !!k.design && typeof k.design === 'object' && k.design.poster_text === 'baked';
    if (parentBaked && !kidBaked) {
      if (k.status === 'active') {
        await client.query(
          `UPDATE cdp_inapp_messages SET status = 'paused', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
          [k.id, parent.company_id],
        );
        paused++;
      }
      continue;
    }
    // 통짜 변형 = 그림을 바꾼 변형 → 첫 장 그림은 변형의 지금 그림(첫 장 그림 · 없으면 변형 image_url) · 글 = 변형 제목 · 본문
    const kidFirstImage = (Array.isArray(k.poster_slides) && k.poster_slides[0] && String(k.poster_slides[0].image_url || '').trim())
      || String(k.image_url || '').trim();
    const firstSlide = parentBaked && kidFirstImage
      ? { ...parentSlides[0], image_url: kidFirstImage, title: k.title, body: k.body }
      : { ...parentSlides[0], title: k.title, body: k.body };
    const slides = parentSlides.length > 0
      ? [firstSlide, ...parentSlides.slice(1)]
      : null;
    const flat = slides
      ? composeFlatFromPosterSlides(slides, { title: k.title, body: k.body, imageUrl: parent.image_url, buttons: [] })
      : null;
    const upd = await client.query(
      `UPDATE cdp_inapp_messages SET
         template = 'full_image',
         content_blocks = '[]'::jsonb,
         design = $3::jsonb,
         poster_slides = $4::jsonb,
         image_url = CASE WHEN $9::boolean OR COALESCE(image_url, '') = '' THEN $5 ELSE image_url END,
         buttons = CASE WHEN $9::boolean THEN $6::jsonb ELSE buttons END,
         badge_text = $7,
         image_link_url = $8,
         updated_at = NOW()
       WHERE id = $1::uuid AND company_id = $2::uuid
       RETURNING *`,
      [
        k.id, parent.company_id,
        parent.design ? JSON.stringify(parent.design) : null,
        slides ? JSON.stringify(slides) : null,
        flat ? flat.imageUrl : (parent.image_url ?? null),
        JSON.stringify(sanitizeButtonsActionUrls(flat ? flat.buttons : (Array.isArray(parent.buttons) ? parent.buttons : []))),
        parent.badge_text ?? null,
        parent.image_link_url ?? null,
        // 장이 없는 단일 포스터 부모 = 변형의 사진·버튼은 변형 것(수동 변형은 사진을 따로 고를 수 있다) · 사진이 비었으면 부모 사진
        slides !== null,
      ],
    );
    // ★ (Codex 1R) 켜진 변형도 게시 조건 CT — 미달이면 throw(부모 수정까지 같은 트랜잭션에서 되돌린다)
    // ★ 2026-11-05 §3-13 — 결과 행 판정 한 곳(게시 · 변형(부모 = 이미 잠긴 결과 행) · DM 연결)
    const kidRow = upd.rows[0];
    const kidDefect = await judgeSavedInAppRow(run, String(parent.company_id), kidRow, parent);
    if (kidDefect) throw inAppNotPublishableError({ ...kidDefect, message: `A/B 변형에 적용할 수 없어요: ${kidDefect.message}` });
    n++;
  }
  return { applied: n, paused };
}

/**
 * ★ 2026-09-29 (Codex 1R high) 상태만 바꾸는 켜기 단일 길목 — 플래너 실행 · A/B 변형 켜기.
 *   한 트랜잭션에서 행을 잠그고(FOR UPDATE) 그 행으로 게시 조건 CT 를 판정한 뒤 켠다. 옛: 판정(별도 SELECT)과 켜기(UPDATE)가
 *   잠금 밖에 따로 있어 그 사이 초안 저장이 제목·사진을 비우면 미완성 초안이 켜졌다. 초안 저장도 같은 행을 FOR UPDATE 로 잠근다.
 *   parentMessageId = 변형 켜기(부모가 맞아야) · window = 플래너 행사 기간(start_at = 지금 · end_at).
 */
export async function activateInAppMessage(opts: {
  companyId: string;
  messageId: string;
  parentMessageId?: string | null;
  window?: { endAt: string } | null;
}): Promise<{ ok: true } | { ok: false; reason: 'not_found' } | { ok: false; reason: 'defect'; defect: InAppPublishDefect }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run: TxRun = (t, p) => client.query(t, p);
    // ★ 2026-11-05 §3-13 잠금 한 규칙 — 변형 켜기는 부모 행을 먼저 잠그고 그 잠근 부모로 판정한다(순서 = 부모 → 변형 ·
    //   [반영] 전파 = 부모 UPDATE → 변형 FOR UPDATE 와 같은 순서 · 거꾸로면 서로 기다린다).
    //   부모 id 를 모르는 켜기도 대상 행이 변형이면 같은 함수가 부모를 먼저 잠근다.
    const { parentId, parent: lockedParent } = await lockParentFirst(client, opts.companyId, opts.messageId, opts.parentMessageId);
    if (parentId && !lockedParent) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }
    const params: any[] = [opts.messageId, opts.companyId];
    let parentClause = '';
    if (opts.parentMessageId) {
      params.push(opts.parentMessageId);
      parentClause = ` AND parent_message_id = $${params.length}::uuid`;
    }
    // ★ 2026-11-05 §3-13 판정 행 = 결과 행 — 켜기(상태 + 기간)를 먼저 쓰고 RETURNING 한 행으로 판정 · 미달 = 되돌림(Codex 1R C4:
    //   옛 = 기간을 쓰기 전 옛 행으로 판정해 옛 끝 시각 · 새 끝 시각이 반대면 거꾸로 판정했다).
    let windowSet = '';
    if (opts.window) {
      params.push(opts.window.endAt);
      windowSet = `, start_at = NOW(), end_at = $${params.length}::timestamptz`;
    }
    const upd = await client.query(
      `UPDATE cdp_inapp_messages SET status = 'active'${windowSet}, updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid${parentClause}
        RETURNING *`,
      params,
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }
    const defect = await judgeSavedInAppRow(run, opts.companyId, upd.rows[0], lockedParent);
    if (defect) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'defect', defect };
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
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
  /** ★ 2026-11-05 §3-2 서빙 관문 — 클라이언트가 그릴 수 있는 것(parseInAppClientCaps). 없음 = 빈 집합 = 옛 SDK · 지금 앱 */
  clientCaps?: ReadonlySet<string>;
}

/**
 * ★ 2026-11-05 §3-2 서빙 관문 한 곳 · ★ 2026-11-08 C114 I-2 = **내보내지 않음 0**(Harold 「업체 앱에 판을 올리라고 할 수 없다」).
 *   떠 있는 카드 판(frame_card)이 없는 클라이언트 = 장 수와 무관하게 응답 사본에서 틀을 지운다(바닥 시트로 그린다).
 *   통짜 · 띠 판이 없는 클라이언트는 여기서 거르지 않고 toServedMessage → legacyServeTransform 이 그 앱이 그릴 수 있는 꼴로 바꾼다.
 *   저장 행 무변경(사본만). 순수.
 */
export function gateInAppForClient(m: InAppMessageDetail, caps: ReadonlySet<string>): InAppMessageDetail {
  const need = inAppRequiredCaps(m);
  const needsFrame = need.hard.includes('frame_card') || need.soft.includes('frame_card');
  if (needsFrame && !caps.has('frame_card') && m.design && typeof m.design === 'object') {
    const { poster_frame: _drop, ...rest } = m.design;
    return { ...m, design: rest };
  }
  return m;
}

/**
 * ★ C114 I-2 · C116 D9 · ★ 2026-11-08 C116-B D1 옛 연동 앱 그림 맞춤 = **정규화 한 곳**(설계서 docs/2026-11-08-c116b-inapp-universal-output-design.md).
 *   들어온 주소에서 우리 맞춤 표시(`fit=inapp` · `fr`)를 걷고 → 우리 그림(`toOwnImageRef` · 믿는 호스트) · 예시 그림이면 지금 판(`fit=inapp&fr=<rev>`)을 붙인다.
 *   다른 fit 값이 든 주소 · 바깥 주소 = 그대로 · 몇 번 거쳐도 같은 결과(새 주소 · 저장 주소 · 옛 판 주소 모두 지금 판 하나 · Codex 설계 3R ①).
 *   서버 서빙(parseFitOption)은 `fit` 만 읽는다 — `fr` = 주소만 바꿔 앱 · 중간 캐시가 옛 그림을 다시 쓰지 않게.
 */
const INAPP_EXAMPLE_IMAGE_RE = /^\/api\/cdp\/inapp\/example-image\/[^/?#]+\/\d+$/;
export function inAppFitQuery(full = false): string {
  return full ? `fit=inappfull&fr=${ASPECT_RATIOS.inappfull.rev}` : `fit=inapp&fr=${ASPECT_RATIOS.inapp.rev}`;
}
export function withInAppImageFit(url: string, full = false): string {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  const h = raw.indexOf('#');
  const hash = h >= 0 ? raw.slice(h) : '';
  const noHash = h >= 0 ? raw.slice(0, h) : raw;
  const q = noHash.indexOf('?');
  const base = q >= 0 ? noHash.slice(0, q) : noHash;
  const params = q >= 0 ? noHash.slice(q + 1).split('&').filter(Boolean) : [];
  const keyOf = (p: string) => p.split('=')[0];
  // 다른 맞춤(예 fit=1x1)이 든 주소 = 우리 것이 아니다 → 그대로
  if (params.some((p) => keyOf(p) === 'fit' && p !== 'fit=inapp' && p !== 'fit=inappfull')) return raw;
  if (toOwnImageRef(base) === null && !INAPP_EXAMPLE_IMAGE_RE.test(base)) return raw;
  const rest = params.filter((p) => keyOf(p) !== 'fit' && keyOf(p) !== 'fr');
  return `${base}?${[...rest, inAppFitQuery(full)].join('&')}${hash}`;
}

/** ★ C118 B2 그리는 그림이 전부 스튜디오 인앱용인가(하나라도 아니면 거짓 = 여백 규칙 그대로 · 섞인 메시지 = 지금 그대로) */
export function inAppAllFullBleed(m: InAppMessageDetail): boolean {
  const drawn = inAppDrawnSlides(m);
  return drawn.length > 0 && drawn.every((s) => isFullBleedInAppImage(s.image_url));
}

/** 게시 끝 시각 → 「11월 30일 23:59」(한국 시각 · 순수) · 없음 · 잘못된 값 = null */
export function inAppDeadlineText(endAt: Date | string | number | null | undefined): string | null {
  if (endAt === null || endAt === undefined || endAt === '') return null;
  const ms = endAt instanceof Date ? endAt.getTime() : new Date(endAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const k = new Date(ms + 9 * 3600 * 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${p2(k.getUTCHours())}:${p2(k.getUTCMinutes())}`;
}

/**
 * ★ 2026-11-08 C114 I-2 옛 앱 서버 변환 — caps 에 없는 판을 그 앱이 그릴 수 있는 꼴로(서빙 사본만 · 순수 · toServedMessage 뒤 · K1).
 *   ① 띠 판이 없음 = 띠를 지우고 글 한 줄(쿠폰 = 「쿠폰 코드 X」 · 남은 시간 = 「11월 30일 23:59까지」)을 메시지 본문 · 첫 장 본문 끝에.
 *      대체 줄을 넣은 통짜 = poster_text 를 지워 글 얹기로 내린다(Codex 설계 1R ① · 통짜 틀은 본문을 그리지 않는다 · 글은 이미 비었다).
 *   ② v4 판이 하나도 없는 옛 렌더러(v2 · v3) = 장 그림 · flat 그림 주소에 인앱 맞춤(★ C116-B D4 · 정사각 · 가운데 80% · 무대색 · 모든 고객사 앱 공통) ·
 *      이벤트 카드 = 장 image_fit contain(옛 v3 = 4:3 cover · 잘림 0).
 *   ★ C116 = 굽기 대상이면 이 변환은 아직 못 구웠을 때의 대체다(`serveInAppForClient`).
 *   웹 SDK · 웹뷰(판 넷) = 변환 0.
 */
export function legacyServeTransform(m: InAppMessageDetail, caps: ReadonlySet<string>): InAppMessageDetail {
  if (!isPosterFamily(m)) return m;
  let out: InAppMessageDetail = m;
  const d: Record<string, any> | null = out.design && typeof out.design === 'object' ? out.design : null;
  const strip = d && d.poster_strip && typeof d.poster_strip === 'object' ? d.poster_strip : null;
  const stripType = strip ? String(strip.type || '') : '';
  const stripMissing = (stripType === 'coupon' && !caps.has('strip_coupon')) || (stripType === 'countdown' && !caps.has('strip_countdown'));
  if (d && stripMissing) {
    const lines: string[] = [];
    if (stripType === 'coupon') {
      const code = String(strip!.code || '').trim();
      if (code) lines.push(`쿠폰 코드 ${code}`);
    } else {
      const t = inAppDeadlineText(out.endAt as any);
      if (t) lines.push(`${t}까지`);
    }
    const { poster_strip: _s, ...rest } = d;
    let design: Record<string, any> = rest;
    if (lines.length && design.poster_text === 'baked') {
      const { poster_text: _t, ...r2 } = design;
      design = r2;
    }
    const add = lines.join('\n');
    const withLine = (b: any) => { const s = String(b ?? '').trim(); return s ? `${s}\n${add}` : add; };
    const slides = Array.isArray(out.posterSlides) ? out.posterSlides : [];
    out = {
      ...out,
      design,
      ...(add ? { body: withLine(out.body) } : {}),
      ...(add && slides.length ? { posterSlides: slides.map((s, i) => (i === 0 ? { ...s, body: withLine((s as any)?.body) } : s)) } : {}),
    };
  }
  const noV4 = !INAPP_CLIENT_CAPS.some((c) => caps.has(c));
  const slides = Array.isArray(out.posterSlides) ? out.posterSlides : [];
  const full = noV4 && inAppAllFullBleed(out);   // ★ C118 B2 전부 인앱용 그림 = 여백 0(inappfull)
  if (noV4 && slides.length > 0) {
    const layout = out.design && typeof out.design === 'object' ? String(out.design.poster_layout || '') : '';
    if (layout === 'event_card') {
      out = { ...out, posterSlides: slides.map((s) => ({ ...s, image_fit: 'contain' as const })) };
    } else if (layout !== 'banner_sheet') {
      out = { ...out, posterSlides: slides.map((s) => (s && typeof s.image_url === 'string' ? { ...s, image_url: withInAppImageFit(s.image_url, full) } : s)) };
    }
  }
  // ★ C116-B D4 한 장 · 장 없는 flat = 연동 계약 v2 의 단일 포스터 그림(imageUrl) → 같은 맞춤(칸 · cover · contain 무관 공통 규칙)
  if (noV4 && out.imageUrl) {
    const layout = out.design && typeof out.design === 'object' ? String(out.design.poster_layout || '') : '';
    if (layout !== 'event_card' && layout !== 'banner_sheet') out = { ...out, imageUrl: withInAppImageFit(out.imageUrl, full) };
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-11-08 C116 인앱 구워 보내기 — 판정 · 사본 · 서빙 한 곳(설계서 docs/2026-11-08-c116-inapp-bake-design.md D1 · D4 · D5 · D10)
// ════════════════════════════════════════════════════════════════════

/** 굽지 않는 레이아웃(옛 앱이 자기 코드로 그린다 · SDK drawsWithPosterFrame 이 거짓인 둘) */
export const INAPP_BAKE_EXCLUDED_LAYOUTS: readonly string[] = ['event_card', 'banner_sheet'];

/** SDK 가 실제로 그리는 장 = 그림 있는 장(없으면 flat 그림으로 한 장 · SDK frameSlidesWithFlat 과 같은 거르기 · K2) */
export function inAppDrawnSlides(m: InAppMessageDetail): PosterSlide[] {
  const has = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  const list = (Array.isArray(m.posterSlides) ? m.posterSlides : []).filter((s) => s && has(s.image_url));
  if (list.length > 0) return list;
  return has(m.imageUrl) ? [{ image_url: String(m.imageUrl), title: m.title, ...(m.imageLinkUrl ? { link_url: m.imageLinkUrl } : {}) } as PosterSlide] : [];
}

/** 그림에 그리는 글 칸(제목 · 본문 · 배지 · 장 글 · 띠 라벨 · 코드)에 개인화 낱말이 있는가(구운 그림은 손님 모두가 같은 그림 · 판정 = 기존 CT textHasPersonalizationVar) */
export function inAppHasPersonalTokens(m: InAppMessageDetail): boolean {
  const d = m.design && typeof m.design === 'object' ? m.design : {};
  const strip = d.poster_strip && typeof d.poster_strip === 'object' ? d.poster_strip : null;
  const texts: unknown[] = [m.title, m.body, m.badgeText, strip?.label, strip?.code];
  // 장 버튼 글은 그림에 그리지 않는다(정지 그리기 = 버튼 칸 0 · 앱이 자기 버튼으로 그린다 · Codex 구현 1R ④)
  for (const s of Array.isArray(m.posterSlides) ? m.posterSlides : []) {
    if (!s) continue;
    texts.push((s as any).title, (s as any).body, (s as any).eyebrow, (s as any).subtitle);
  }
  return texts.some((t) => textHasPersonalizationVar(t));
}

/** 이 회사의 우리 그림이면 상대 경로(크롬은 굽기 페이지 출처에서 연다 · D7), 아니면 null */
function ownRelativeImage(url: unknown, companyId: string): string | null {
  const ref = toOwnImageRef(String(url || '').trim());
  if (!ref || ref.companyId.toLowerCase() !== String(companyId).toLowerCase()) return null;
  return `/api/cdp/inapp/image/${ref.companyId}/${ref.filename}`;
}

export type InAppBakePlan =
  | { bake: false }
  | { bake: true; full: InAppMessageDetail; key: string; expected: number; payload: Record<string, unknown>; stages: string[]; fullBleed: boolean };

/**
 * D1 굽기 판정 한 곳 — 포스터 가족 · 틀로 그림(이벤트 카드 · 배너 아님) · 그릴 그림 ≥ 1 · 전부 이 회사 우리 그림 · 개인화 0 ·
 *   클라이언트에 v4 판이 하나도 없거나 메시지가 필요한 판 중 없는 것이 있다. 판 넷 클라이언트 = 늘 거짓(웹 SDK · 웹뷰 그대로).
 *   full = 판 넷 사본(SDK 가 웹에 그리는 그대로) · payload = 웹뷰 페이지에 넣을 값(그림 = 상대 경로 · 정지 · 마감 시각 글).
 */
export function inAppBakePlan(m: InAppMessageDetail, caps: ReadonlySet<string>, companyId: string): InAppBakePlan {
  if (!isPosterFamily(m)) return { bake: false };
  const layout = m.design && typeof m.design === 'object' ? String(m.design.poster_layout || '') : '';
  if (INAPP_BAKE_EXCLUDED_LAYOUTS.includes(layout)) return { bake: false };
  const need = inAppRequiredCaps(m);
  const noV4 = !INAPP_CLIENT_CAPS.some((c) => caps.has(c));
  const unmet = [...need.hard, ...need.soft].some((c) => !caps.has(c));
  if (!noV4 && !unmet) return { bake: false };
  const full = toServedMessage(gateInAppForClient(m, new Set<string>(INAPP_CLIENT_CAPS)));
  if (inAppHasPersonalTokens(full)) return { bake: false };
  const drawn = inAppDrawnSlides(full);
  if (drawn.length === 0) return { bake: false };
  // ★ C118 B2 전부 스튜디오 인앱용 그림 — 통짜 시트(띠 · 카드 0) = 그림이 곧 완성본 = 굽지 않고 원본(inappfull) · 그 밖 = 여백 0 굽기(still full)
  const fullBleed = inAppAllFullBleed(full);
  const fd = full.design && typeof full.design === 'object' ? full.design : {};
  const fStrip = fd.poster_strip && typeof fd.poster_strip === 'object' ? String(fd.poster_strip.type || '') : '';
  if (fullBleed && fd.poster_text === 'baked' && fd.poster_frame !== 'card' && fStrip !== 'coupon' && fStrip !== 'countdown') return { bake: false };
  // (Codex 구현 1R ① 뿌리 = 얹는 층마다 안전 칸) 여백 0 합성 = 글이 안전 칸 안에 놓이는 틀(시트 · 띠 0 · SDK still.full 글 여백)만 · 카드 · 띠 = 지금 굽기(여백 규칙)
  const fullCompose = fullBleed && fd.poster_frame !== 'card' && fStrip !== 'coupon' && fStrip !== 'countdown';
  const rel = drawn.map((s) => ownRelativeImage(s.image_url, companyId));
  if (rel.some((r) => r === null)) return { bake: false };
  const hasSlides = Array.isArray(full.posterSlides) && full.posterSlides.some((s) => s && typeof s.image_url === 'string' && s.image_url.trim());
  let i = 0;
  const bakeMessage: InAppMessageDetail = hasSlides
    ? { ...full, imageUrl: rel[0], posterSlides: full.posterSlides.map((s) => (s && typeof s.image_url === 'string' && s.image_url.trim() ? { ...s, image_url: rel[i++] as string } : s)) }
    : { ...full, imageUrl: rel[0] };
  return {
    bake: true,
    full,
    key: inAppBakeKey(full as unknown as Record<string, unknown>),
    expected: drawn.length,
    payload: { message: bakeMessage, still: { deadlineText: inAppDeadlineText(full.endAt as any), ...(fullCompose ? { full: true } : {}) } },
    // ★ C116-B D3 장마다 무대색 = 그 장 bg_color(꼴 맞음) · 아니면 기본(SDK 여러 장 칸 채움과 같은 뜻 · 열쇠 = posterSlides 에 bg_color 포함)
    stages: drawn.map((s) => inAppStageColor((s as any).bg_color)),
    fullBleed: fullCompose,   // 굽기 일감 full = 여백 0 합성(위 조건)
  };
}

/**
 * D5 구운 메시지 — 글 칸 비움 · 장 그림 · imageUrl = 구운 그림 · 장 버튼 · 그림 링크 · 메시지 버튼 그대로 · 그리는 칸(통짜 · 틀 · 띠 · 레이아웃) 지움.
 *   ★ C116-B D3 구운 그림 = 최종 정사각(무대 합성 끝) → 서빙 맞춤 0(주소 그대로 · 열쇠 = 판 2 = 내용이 바뀌면 주소도 바뀐다).
 *   연동 계약 = 두 장 이상이면 posterSlides(캐러셀) · 한 장 · 장 없음이면 imageUrl(단일 포스터)을 그린다 → 둘 다 채움(C116 Codex 설계 1R ①).
 */
export function bakedLegacyMessage(full: InAppMessageDetail, files: string[]): InAppMessageDetail {
  const src = inAppDrawnSlides(full);
  const d = full.design && typeof full.design === 'object' ? full.design : {};
  const { poster_text: _t, poster_frame: _f, poster_strip: _s, poster_layout: _l, ...keep } = d as Record<string, any>;
  const msgTitle = String(full.title || '').trim();
  const slides: PosterSlide[] = files.map((f, i) => {
    const o = src[i] || ({} as PosterSlide);
    const alt = String((o as any).alt || o.title || '').trim() || msgTitle;
    return {
      image_url: f,
      ...(o.cta ? { cta: o.cta } : {}),
      ...(o.link_url ? { link_url: o.link_url } : {}),
      ...(alt ? { alt } : {}),
    } as PosterSlide;
  });
  return { ...full, title: '', body: '', badgeText: null, design: keep, imageUrl: slides[0] ? slides[0].image_url : full.imageUrl, posterSlides: slides };
}

/**
 * D4 서빙 한 곳 — 굽기 대상 + 구운 판 있음 = 구운 메시지 · 없음 = 대체(지금 옛 앱 변환) + 굽기 요청 · 대상 아님 = 지금 그대로.
 *   관문 · 통짜 · 옛 앱 변환을 부르는 곳은 이 함수와 판정뿐(K6 · 시험 V12).
 */
export function serveInAppForClient(
  m: InAppMessageDetail, caps: ReadonlySet<string>, companyId: string,
  deps: { read?: typeof readInAppBake; request?: (job: InAppBakeJob) => unknown } = {},
): InAppMessageDetail {
  const plan = inAppBakePlan(m, caps, companyId);
  if (plan.bake) {
    const files = (deps.read || readInAppBake)(companyId, plan.key, plan.expected);
    if (files) return bakedLegacyMessage(plan.full, files);
    (deps.request || requestInAppBake)({ companyId, messageId: String(m.id), key: plan.key, expected: plan.expected, payload: plan.payload, stages: plan.stages, full: plan.fullBleed });
  }
  return legacyServeTransform(toServedMessage(gateInAppForClient(m, caps)), caps);
}

/** D10 게시 = 미리 굽기 요청(판 없는 옛 앱 기준 · 기다리지 않음 · 실패 = 기록만) */
export async function prebakeInAppMessage(companyId: string, messageId: string): Promise<void> {
  try {
    // ★ C118 B3 굽기 대상 = 서빙과 같은 사본(부모 + 게시 중 변형 · 변형 = 부모 기간) · 판정 = caps 없음
    for (const t of await inAppBakeTargets(companyId, messageId)) {
      const plan = t.plan;
      if (!plan.bake || readInAppBake(companyId, plan.key, plan.expected)) continue;
      requestInAppBake({ companyId, messageId: t.messageId, key: plan.key, expected: plan.expected, payload: plan.payload, stages: plan.stages, full: plan.fullBleed });
    }
  } catch (e: any) {
    console.log(`[inapp-bake] 미리 굽기 요청 실패 ${messageId} · ${String(e?.message || e).slice(0, 160)}`);
  }
}

/** ★ C118 B3 서빙 Step 4 와 같은 변형 사본 — 변형 행에는 기간이 없다(부모 시작 · 끝 시각으로만 서빙 · 끝 시각 = 굽기 열쇠 칸) */
export function servedVariantRow<T extends Record<string, any>>(variantRow: T, parentRow: Record<string, any>): T {
  return { ...variantRow, start_at: parentRow.start_at, end_at: parentRow.end_at };
}

/**
 * ★ C118 B3 굽기 대상 한 곳(미리 굽기 · app-ready) = 게시 중 앱 채널 부모 + 게시 중 변형(서빙 사본) → 굽기 판정(caps 없음 = 옛 연동 앱).
 *   변형 id 로 불러도 부모 묶음 전체(부모 [반영] = 변형에 모양 전파 · 반영 완료 = 묶음 전부 준비).
 */
export async function inAppBakeTargets(companyId: string, messageId: string): Promise<Array<{ messageId: string; plan: InAppBakePlan }>> {
  const r = await query(`SELECT * FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid`, [messageId, companyId]);
  const row = r.rows[0];
  if (!row) return [];
  const parentId = row.parent_message_id ? String(row.parent_message_id) : String(row.id);
  const parent = row.parent_message_id
    ? (await query(`SELECT * FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid`, [parentId, companyId])).rows[0]
    : row;
  if (!parent || parent.status !== 'active' || parent.channel !== 'app') return [];
  const kids = await query(
    `SELECT * FROM cdp_inapp_messages WHERE parent_message_id = $1::uuid AND company_id = $2::uuid AND status = 'active'`,
    [parentId, companyId],
  );
  const rows = [parent, ...kids.rows.map((k: any) => servedVariantRow(k, parent))];
  return rows.map((x: any) => ({ messageId: String(x.id), plan: inAppBakePlan(mapRowToMessageDetail(x), new Set<string>(), companyId) }));
}

/** ★ C118 B3 앱 화면 준비 = 굽기 대상 전부 구운 판 있음 · 하나라도 없음 = pending · 대상 0 = none(편집기 [반영] 뒤 「앱 화면 준비됨」) */
export async function inAppAppReady(companyId: string, messageId: string): Promise<'ready' | 'pending' | 'none'> {
  const targets = (await inAppBakeTargets(companyId, messageId)).filter((t) => t.plan.bake);
  if (targets.length === 0) return 'none';
  return targets.every((t) => t.plan.bake && !!readInAppBake(companyId, t.plan.key, t.plan.expected)) ? 'ready' : 'pending';
}

/**
 * ★ 2026-11-05 §3-3 통짜 서빙 사본 — 글이 그림에 구워졌으므로 글 칸을 비우고 장마다 대체 글(alt = 그 장 원래 제목)만 남긴다.
 *   ① 장이 없으면(flat 만) flat 에서 첫 장을 먼저 만든다(SDK 시트 폴백 inapp.ts renderPoster 와 같은 규칙 · 대체 글 보존 · Codex 1R C5)
 *   ② 메시지 제목 · 본문 = 빈 글 · 배지 = null · 장 제목 · 본문 · 라벨 · 윗줄 = 지움. 장 버튼 · 링크 · 그림은 그대로. 저장 행 무변경. 순수.
 */
export function toServedMessage(m: InAppMessageDetail): InAppMessageDetail {
  if (!isBakedPoster(m)) return m;
  const msgTitle = String(m.title || '').trim();
  let slides: PosterSlide[] = Array.isArray(m.posterSlides) ? m.posterSlides : [];
  if (slides.length === 0 && m.imageUrl) {
    // (Codex 구현 1R) 버튼이 없고 옛 단일 CTA(action_url)만 있으면 같은 합성 CT 로 버튼을 만든다(SDK renderLegacy 와 같은 규칙 · 장이 생기면 SDK 는 flat 버튼을 안 본다)
    const b0 = (Array.isArray(m.buttons) && m.buttons.length > 0 ? m.buttons[0] : null) || synthesizeButtonsFromActionUrl(m.actionUrl, m.actionLabel)[0] || null;
    slides = [{
      image_url: m.imageUrl,
      title: msgTitle,
      ...(b0 && (b0.label || b0.action_url) ? { cta: { label: b0.label, action_url: b0.action_url ?? null, ...(b0.background_color ? { background_color: b0.background_color } : {}), ...(b0.text_color ? { text_color: b0.text_color } : {}) } } : {}),
      ...(m.imageLinkUrl ? { link_url: m.imageLinkUrl } : {}),
    }];
  }
  return {
    ...m,
    title: '',
    body: '',
    badgeText: null,
    posterSlides: slides.map((s) => {
      const { title, body: _b, eyebrow: _e, subtitle: _s, ...rest } = s || ({} as PosterSlide);
      return { ...rest, alt: String(title || '').trim() || msgTitle };
    }),
  };
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
    throw new UserFacingError(400, 'CDP_INPUT', 'companyId, messageId, eventType은 필수입니다.');
  }
  if (!['impression', 'click', 'dismiss', 'opt_out'].includes(input.eventType)) {
    throw new UserFacingError(400, 'CDP_INPUT', `허용되지 않는 event_type: ${input.eventType}`);
  }
  // ★ P0-3 (2026-07-12) — message 소유 검증. 타사/임의 uuid로 자기 회사 impressions에 유령 행 적재 차단.
  //   CT 단일 길목(소비처 = POST /inapp/track 1곳)이라 여기서 전부 커버. uuid 형식 오류도 동일 메시지로 400 매핑.
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(input.messageId)) {
    throw new UserFacingError(400, 'MESSAGE_NOT_FOUND', '메시지를 찾을 수 없습니다.');
  }
  const own = await query(
    `SELECT 1 FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
    [input.messageId, input.companyId]
  );
  if (own.rows.length === 0) {
    throw new UserFacingError(400, 'MESSAGE_NOT_FOUND', '메시지를 찾을 수 없습니다.');
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

/**
 * ★ 2026-09-28 한줄로 V2 R104 — 여러 메시지의 통계를 쿼리 한 번으로(목록용). 값은 getMessageStats 와 같다.
 * 옛 목록은 메시지마다 getMessageStats 를 불렀다(N+1).
 */
export async function getMessageStatsBatch(companyId: string, messageIds: readonly string[]): Promise<Map<string, Awaited<ReturnType<typeof getMessageStats>>>> {
  const out = new Map<string, Awaited<ReturnType<typeof getMessageStats>>>();
  if (messageIds.length === 0) return out;
  const result = await query(
    `SELECT message_id, event_type, COUNT(*)::int AS cnt
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid AND message_id = ANY($2::uuid[])
     GROUP BY message_id, event_type`,
    [companyId, [...messageIds]]
  );
  const maps = new Map<string, Record<string, number>>();
  for (const r of result.rows as any[]) {
    const id = String(r.message_id);
    const m = maps.get(id) || { impression: 0, click: 0, dismiss: 0, opt_out: 0 };
    m[r.event_type] = r.cnt;
    maps.set(id, m);
  }
  for (const id of messageIds) {
    const map = maps.get(String(id)) || { impression: 0, click: 0, dismiss: 0, opt_out: 0 };
    const impressions = map.impression || 0;
    out.set(String(id), {
      impressions,
      clicks: map.click || 0,
      dismisses: map.dismiss || 0,
      optOuts: map.opt_out || 0,
      ctr: impressions > 0 ? (map.click || 0) / impressions : 0,
    });
  }
  return out;
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
    // ★ 2026-09-29 남은 슬라이드 게이트(설계서 §1-5) — 포스터가 아닌 형태에 남은 장은 내보내지 않는다(SDK·앱이 장을 먼저 보는 경로 차단).
    posterSlides: (row.template || row.position) === 'full_image' && Array.isArray(row.poster_slides) ? row.poster_slides : [],
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

  // Step 2 — customer ID 매핑 (외부 ID → customer_id)
  let customerId: string | null = null;
  if (input.externalId) {
    // ★ 2026-09-27 한줄로 V2 R255 — 출처(source)를 함께 본다(아래 opt_out 조회와 같은 축). 옛: 몰 두 곳에서 같은 회원번호면 다른 고객으로 매칭됐다.
    const linkR = input.source
      ? await query(
          `SELECT customer_id FROM cdp_identity_links
           WHERE company_id = $1::uuid AND external_id = $2 AND source = $3 LIMIT 1`,
          [input.companyId, input.externalId, input.source]
        )
      : await query(
          `SELECT customer_id FROM cdp_identity_links
           WHERE company_id = $1::uuid AND external_id = $2 LIMIT 1`,
          [input.companyId, input.externalId]
        );
    if (linkR.rows.length > 0 && linkR.rows[0].customer_id) {
      customerId = String(linkR.rows[0].customer_id);
    }
  }

  // Step 1 — 부모 메시지 후보 조회 (trigger_event 또는 trigger_conditions.event 매칭)
  // ★ 2026-10-24 세 채널 구조체크 ⑯ — 쪽마다 모든 거름(Step 3~8)을 지나게 하고, 보여 줄 메시지가 20개가 되거나 후보가 다할 때까지 다음 쪽을 본다
  //   (옛: 최신 20개를 먼저 자르고 걸러 그 밖의 맞는 메시지가 안 보였다).
  //   ★ Codex 2R — 후보 순서(id 만)를 요청 시작에 한 번 읽어 고정하고 쪽마다 그 id 로 행을 다시 읽는다(켜짐 조건 재확인).
  //   OFFSET 쪽 읽기는 도중에 앞쪽 후보가 꺼지거나 켜지면 하나를 건너뛰거나 같은 부모를 두 번 냈다.
  const candidateIds = (await query(
    `SELECT id FROM cdp_inapp_messages
     WHERE ${INAPP_CANDIDATE_WHERE}
     ORDER BY created_at DESC, id DESC`,
    [input.companyId, trigger, input.channel || 'web']
  )).rows.map((r: any) => String(r.id));
  const shown: InAppMessageDetail[] = [];
  for (let i = 0; i < candidateIds.length && shown.length < INAPP_ACTIVE_MAX; i += INAPP_ACTIVE_PAGE) {
    const pageIds = candidateIds.slice(i, i + INAPP_ACTIVE_PAGE);
    const pageRes = await query(
      `SELECT ${FULL_COLUMNS}
       FROM cdp_inapp_messages
       WHERE ${INAPP_CANDIDATE_WHERE}
         AND id = ANY($4::uuid[])`,
      [input.companyId, trigger, input.channel || 'web', pageIds]
    );
    const byId = new Map<string, any>(pageRes.rows.map((r: any) => [String(r.id), r]));
    const pageRows = pageIds.map((id) => byId.get(id)).filter(Boolean);
    shown.push(...(await evaluateInAppCandidates(input, trigger, customerId, pageRows)));
  }
  return shown.slice(0, INAPP_ACTIVE_MAX);
}

/** ★ 2026-10-24 ⑯ — 표시 후보 조건(켜짐 · 채널 · 부모 · 트리거 · 기간) · $1 회사 · $2 트리거 · $3 채널 · 순서 조회와 쪽 조회가 같은 조건 */
const INAPP_CANDIDATE_WHERE = `company_id = $1::uuid
       AND status = 'active'
       AND channel = $3
       AND parent_message_id IS NULL
       AND (trigger_event = $2 OR (trigger_conditions->>'event' = $2))
       AND (start_at IS NULL OR start_at <= NOW())
       AND (end_at IS NULL OR end_at >= NOW())`;

/** ★ 2026-10-24 ⑯ — 표시 응답 상한 · 후보 한 쪽 크기 */
const INAPP_ACTIVE_MAX = 20;
const INAPP_ACTIVE_PAGE = 50;

/** ★ 2026-10-24 ⑯ — 후보 한 쪽 → 보여 줄 메시지(Step 3~8 · 옛 본문 그대로 옮김 · 쪽마다 같은 판정) */
async function evaluateInAppCandidates(
  input: ActiveMessagesInput,
  trigger: string,
  customerId: string | null,
  candidates: any[],
): Promise<InAppMessageDetail[]> {
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
        // ★ 2026-11-05 §3-5 — 변형 행에는 기간이 없다(부모 기간으로만 서빙) → 서빙 사본에 부모 시작 · 끝 시각(남은 시간 띠의 마감)
        selected.push(servedVariantRow(variantR.rows[0], cand));   // ★ C118 B3 미리 굽기 · app-ready 와 같은 사본
        continue;
      }
    }
    selected.push(cand);
  }

  // ★ 2026-11-05 §3-2 · §3-3 서빙 관문 + 통짜 비우기 = 변형 고르기 뒤 · 매핑 직후 한 곳(쪽 반복이 이 뒤 수를 세 20개 채우기가 맞다)
  const clientCaps = input.clientCaps ?? new Set<string>();
  //   ★ 2026-11-08 C114 I-2 = 내보내지 않음 0 · 관문(틀) → 통짜 비우기 → 옛 앱 변환(K1 순서)
  let messages = selected
    .map(mapRowToMessageDetail)
    // ★ 2026-11-08 C116 D4 서빙 한 곳 = 굽기 대상이면 구운 그림(없으면 대체 + 굽기 요청) · 아니면 관문 → 통짜 → 옛 앱 변환(K1 순서 그대로)
    .map((m) => serveInAppForClient(m, clientCaps, input.companyId));

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
       WHERE i.company_id = $1::uuid
         AND (
           i.event_type = 'opt_out'
           -- ★ 2026-09-29 「오늘 하루 보지 않기」(design.dismiss_mode = snooze_day · 설계서 §1-3) — 24시간 억제 · 같은 부모 축
           OR (i.event_type = 'dismiss' AND i.button_id = 'snooze_day' AND i.occurred_at > NOW() - INTERVAL '24 hours')
         )
         AND (${optConds.join(' OR ')})`,
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
    // ★ 2026-10-24 세 채널 구조체크 ⑨ — 회원 증명 없는 추적은 기기 id 로만 남는다 → 회원이어도 이 기기 id 기록을 함께 센다(opt_out 조회와 같은 OR)
    const seenParams: any[] = [input.companyId, messageIds];
    const seenConds: string[] = [];
    if (input.externalId) {
      seenParams.push(input.externalId);
      seenConds.push(`identity_link_id IN (SELECT id FROM cdp_identity_links WHERE company_id = $1::uuid AND external_id = $${seenParams.length})`);
    }
    if (input.anonymousId) {
      seenParams.push(input.anonymousId);
      seenConds.push(`anonymous_id = $${seenParams.length}`);
    }
    const seenResult = await query(
      `SELECT DISTINCT message_id FROM cdp_inapp_impressions
       WHERE company_id = $1::uuid
         AND message_id = ANY($2::uuid[])
         AND event_type = 'impression'
         AND occurred_at > NOW() - INTERVAL '24 hours'
         AND (${seenConds.join(' OR ')})`,
      seenParams
    );
    const seenIds = new Set<string>(seenResult.rows.map((r: any) => r.message_id));
    messages = messages.filter((m) => m.displayFrequency !== 'once_per_day' || !seenIds.has(m.id));
  }

  // Step 6 — max_displays_per_user 검증 (사용자별 누적 impression 한도)
  const limitedMessages = messages.filter((m) => m.maxDisplaysPerUser !== null && m.maxDisplaysPerUser > 0);
  if (limitedMessages.length > 0 && (customerId || input.anonymousId)) {
    // ★ 2026-10-24 ⑨ — 회원 기록 + 이 기기 기록을 함께 센다(위 once_per_day 와 같은 이유 · 행 단위 OR 라 한 행을 두 번 세지 않는다)
    const limitParams: any[] = [input.companyId, limitedMessages.map((m) => m.id)];
    const limitConds: string[] = [];
    if (customerId) {
      limitParams.push(customerId);
      limitConds.push(`customer_id = $${limitParams.length}::uuid`);
    }
    if (input.anonymousId) {
      limitParams.push(input.anonymousId);
      limitConds.push(`anonymous_id = $${limitParams.length}`);
    }
    const limitR = await query(
      `SELECT message_id, COUNT(*)::int AS cnt
       FROM cdp_inapp_impressions
       WHERE company_id = $1::uuid
         AND message_id = ANY($2::uuid[])
         AND event_type = 'impression'
         AND (${limitConds.join(' OR ')})
       GROUP BY message_id`,
      limitParams
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
