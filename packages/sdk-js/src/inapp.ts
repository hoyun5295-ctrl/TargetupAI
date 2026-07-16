/**
 * @hanjullo/sdk — In-app Message 모듈 v0.3.0 (D215+ 2026-05-25)
 *
 * 자사몰 페이지 로드 시 자동으로 active 메시지 조회 + 렌더링.
 *
 * 사용:
 *   hanjullo.inapp.init({ externalId: 'user_123', customer: { name: '...', grade: 'VIP', points: 12000 } });
 *
 * D215+ 강화:
 * - 8 templates (top_banner / bottom_banner / center_modal / full_screen / slide_in / inline_card / toast / floating_button)
 * - Liquid 클라이언트 치환 ({{ customer.name }} / %고객명% 양쪽 지원)
 * - 다중 CTA (최대 3 — button_id 트래킹 분리)
 * - 애니메이션 (fade / slide / bounce / pulse)
 * - 자동 dismiss (auto_dismiss_seconds)
 * - max_displays_per_user (localStorage 누적)
 * - A/B sticky bucketing (sessionStorage 해시)
 * - 5분 TTL 캐시 (localStorage)
 * - 트리거 다양화 (scroll / time_on_page / exit_intent / cart_value 자동 감지)
 * - 지수 backoff retry (3회) + offline fallback
 */

import { resolveTheme, withAlpha, inappGoogleFontsUrl, safeFontFamily, type InAppTheme } from './inapp-theme';
import {
  renderBlocks, planCardLayout, renderPosterHero, renderTicketPerforation, renderBubbleSender, normalizeCardStyle,
  resolveInAppTreatment,
  type ContentBlock, type BlockRenderContext, type CardStyle, type InAppTreatment,
} from './inapp-blocks';

// 2026-07-07 디자인 2.0 — Pretendard 우선(호스트 몰에 있으면 사용, 없으면 시스템 한글 폴백. 외부 로드 0)
const INAPP_FONT_STACK = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

// ★ 2026-07-07(5) 형태 골격 — ticket(본권/스터브 2톤)·poster(풀블리드 히어로) 존 분할 시
//   컨테이너 패딩을 0으로 두고 구간별 존이 패딩을 소유한다. 관리자 미리보기와 값 미러.
const ZONE_PADS: Record<string, { main: string; stub: string; body: string }> = {
  center_modal: { main: '26px 26px 18px', stub: '16px 26px 22px', body: '20px 26px 26px' },
  slide_in: { main: '20px 20px 14px', stub: '13px 20px 18px', body: '16px 20px 20px' },
  inline_card: { main: '22px 22px 16px', stub: '14px 22px 20px', body: '18px 22px 22px' },
};

function makeZone(pad: string): HTMLDivElement {
  const z = document.createElement('div');
  Object.assign(z.style, { display: 'flex', flexDirection: 'column', gap: '13px', padding: pad, minWidth: '0', boxSizing: 'border-box' });
  return z;
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-14 디자인 3.0 — 모션 keyframes 1회 주입 + 서체 실로딩 + 백드롭 딤 3단
// ════════════════════════════════════════════════════════════════════

// keyframes 이름은 hjl- 접두(몰 CSS 충돌 회피). reduced-motion = JS 게이트(ctx.motion) + 미디어쿼리 이중 차단.
const MOTION_STYLE_ID = 'hjl-inapp-motion';
function ensureMotionStyle(): void {
  try {
    if (document.getElementById(MOTION_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = MOTION_STYLE_ID;
    s.textContent = [
      '@keyframes hjl-cta-pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.09)}}',
      '@keyframes hjl-shine{0%{transform:translateX(-160%) skewX(-12deg)}55%{transform:translateX(420%) skewX(-12deg)}100%{transform:translateX(420%) skewX(-12deg)}}',
      '@keyframes hjl-tick{0%{transform:translateY(-3px);opacity:.55}100%{transform:none;opacity:1}}',
      '@media (prefers-reduced-motion: reduce){[data-hanjullo-msg] *{animation:none !important}}',
    ].join('\n');
    document.head.appendChild(s);
  } catch { /* 조용히 실패 */ }
}

// 서체 실로딩 — Google Fonts <link> (카탈로그 매칭 시에만 URL 생성 = 화이트리스트, 중복 주입 가드 + display=swap)
function ensureFontLink(fontFamily: string | null | undefined): void {
  try {
    const url = inappGoogleFontsUrl(fontFamily || undefined);
    if (!url) return;
    if (document.querySelector(`link[data-hjl-fonts="${url}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.setAttribute('data-hjl-fonts', url);
    document.head.appendChild(link);
  } catch { /* 조용히 실패 */ }
}

// 백드롭 딤 3단 — 미설정 = standard(현행 0.55와 동일 값)
const BACKDROP_DIM: Record<string, string> = {
  soft: 'rgba(8,10,18,0.38)',
  standard: 'rgba(8,10,18,0.55)',
  deep: 'rgba(8,10,18,0.72)',
};

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type InAppTemplate =
  | 'top_banner'
  | 'bottom_banner'
  | 'center_modal'
  | 'full_screen'
  | 'slide_in'
  | 'inline_card'
  | 'toast'
  | 'floating_button';

export interface InAppButton {
  id: string;
  label: string;
  action_url: string | null;
  style: 'primary' | 'secondary' | 'tertiary' | 'ghost';
  background_color: string;
  text_color: string;
}

export interface InAppTriggerConditions {
  event: 'page_load' | 'cart_add' | 'cart_view' | 'checkout_start' | 'scroll' | 'time_on_page' | 'exit_intent' | 'cart_value';
  scroll_percent?: number;
  time_on_page_seconds?: number;
  cart_value_min?: number;
}

export interface InAppMessageSdk {
  id: string;
  title: string;
  body: string;
  template: InAppTemplate;
  position?: string;  // 옛 backward compat
  imageUrl?: string | null;
  image_url?: string | null;
  badgeText?: string | null;
  badge_text?: string | null;
  buttons?: InAppButton[];
  actionUrl?: string | null;  // 옛 backward compat
  actionLabel?: string;
  backgroundColor: string;
  textColor: string;
  triggerEvent: string;
  triggerConditions?: InAppTriggerConditions;
  trigger_conditions?: InAppTriggerConditions;
  displayFrequency: 'once_per_session' | 'once_per_day' | 'always';
  autoDismissSeconds?: number | null;
  auto_dismiss_seconds?: number | null;
  maxDisplaysPerUser?: number | null;
  max_displays_per_user?: number | null;
  animation?: 'fade' | 'slide' | 'bounce' | 'pulse' | 'spring' | 'celebrate';
  parentMessageId?: string | null;
  parent_message_id?: string | null;
  // ★ D230+ 2026-06-27 — 블록 조립 + 테마. content_blocks 있으면 블록 렌더, 없으면 레거시 단색 렌더.
  contentBlocks?: ContentBlock[] | null;
  content_blocks?: ContentBlock[] | string | null;
  theme?: string | null;
  accentColor?: string | null;
  accent_color?: string | null;
  isAd?: boolean;
  is_ad?: boolean;
  /** ★ 2026-07-07(2) 형태 축 — classic/bubble/ticket/poster. 미지정·미지원 값 = classic (구버전 안전) */
  cardStyle?: string | null;
  card_style?: string | null;
  /** ★ 2026-07-14 디자인 3.0 — 메시지 단위 디자인(cdp_inapp_messages.design jsonb). 미설정 = 현행 렌더 그대로 */
  design?: InAppDesignSdk | null;
}

/** ★ 2026-07-14 디자인 3.0 — design jsonb 스키마 (전 키 옵셔널. 서버 sanitize 통과값이지만 SDK도 fail-closed 소비) */
export interface InAppDesignSdk {
  /** 헤드라인 서체 font-family — 카탈로그 매칭 시에만 실로딩 */
  font_display?: string | null;
  /** 구도 — resolveInAppTreatment fail-closed (미허용 = classic) */
  treatment?: string | null;
  /** 모션 2.0 — 'rich'만 활성, 그 외 = 현행(진입 전환만) */
  motion?: string | null;
  /** 배경 딤/블러 — center_modal/full_screen 백드롭 */
  backdrop?: { dim?: string | null; blur?: boolean | null } | null;
  /** ★ 2026-07-17 텍스트 정렬 — 'center'/'right'만 소비(루트 상속 + flex 행 블록 justify 미러), 그 외 = 기존 좌측 */
  text_align?: string | null;
}

export interface InAppInitInput {
  externalId?: string;
  anonymousId?: string;
  /** 옛 trigger 단일 — backward compat */
  trigger?: string;
  /** 신규 D215+ — customer 객체 (Liquid 변수 치환용) */
  customer?: Record<string, any>;
  /** 컨테이너 선택자 (inline_card template 전용) */
  containerSelector?: string;
  /** 장바구니 누적 금액 추정치 — cart_value 트리거 조건(cart_value_min) 비교용. 미전달 시 cart_value 조건 메시지는 매칭되지 않는다. */
  cartValue?: number;
  /** ★ P0-1 (2026-07-12) scroll 자동 트리거 발화 시점의 실측 스크롤 도달 % — 발화별 값(lastInput에 누적 보존하지 않음) */
  scrollPercent?: number;
  /** ★ P0-1 (2026-07-12) time_on_page 자동 트리거 발화 시점의 실측 체류 초 — 발화별 값(lastInput에 누적 보존하지 않음) */
  timeOnPageSeconds?: number;
  /** 자동 트리거 감지 활성 (default true) */
  enableAutoTriggers?: boolean;
  /** 디버그 로깅 활성 (default false) */
  debug?: boolean;
  /** ★ 2026-06-17 2단계 — 'web'(자사몰 팝업, 기본) / 'app'(웹뷰 앱 인앱). app이면 앱 채널 메시지를 받아 앱 형태로 렌더 */
  platform?: 'web' | 'app';
}

// ════════════════════════════════════════════════════════════════════
// localStorage / sessionStorage 키
// ════════════════════════════════════════════════════════════════════

const STORAGE_KEY_SEEN = 'hanjullo_inapp_seen';
const SESSION_KEY_SEEN = 'hanjullo_inapp_session';
// ★ 2026-07-17 닫기(X)·버튼 누르면 이번 세션엔 재표시 안 함 — always여도 닫기가 유효하도록.
//   (opt_out=영구와 구분: dismiss는 세션 한정 — 새 세션/새 방문엔 빈도 규칙대로 다시 뜸)
const SESSION_KEY_DISMISSED = 'hanjullo_inapp_dismissed';
const STORAGE_KEY_DISPLAY_COUNT = 'hanjullo_inapp_display_count';
const STORAGE_KEY_CACHE = 'hanjullo_inapp_cache';
const SESSION_KEY_STICKY = 'hanjullo_inapp_sticky';
// ★ 2026-07-16 "다시 보지 않기" — 명시 거부 메시지 영구 억제 (닫기 X는 이번만 — 빈도 규칙대로 재표시).
//   서버(cdp_inapp_impressions event_type='opt_out')가 진실, localStorage는 즉시 차단 보조.
const STORAGE_KEY_OPTOUT = 'hanjullo_inapp_optout';
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5분
const MAX_RETRIES = 3;

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-12 인앱 강화 — 순수 판정 함수 (vitest 고정)
// ════════════════════════════════════════════════════════════════════

/**
 * ★ P0-2 — 버튼 action_url 스킴 화이트리스트 판정 (순수).
 * http:/https:(상대경로 포함 — base 기준 해석)만 허용, 그 외(javascript:/data:/vbscript: 등)는 null.
 * 판정은 new URL 파싱 후 protocol 검사 — 인코딩·공백 변형은 파서 정규화를 신뢰한다(0710 hlj.kr 교훈).
 * placeholder('['로 시작)는 기존 동작 그대로 이동 대상 아님.
 */
export function resolveSafeNavUrl(url: string | null | undefined, baseHref: string): string | null {
  const raw = String(url || '').trim();
  if (!raw || raw.startsWith('[')) return null;
  try {
    const parsed = new URL(raw, baseHref);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * ★ P0-1 — 트리거 임계값 검증 (순수). 실측값(스크롤%·체류초·장바구니액)은 브라우저만 알므로 SDK가 판정.
 * scroll/time_on_page 값 미전달(자사몰 직접 trigger 호출) = 통과 — 기존 동작 보존(오차단 0).
 * cart_value는 기존 동작 유지(값 미전달 = 미매칭). 임계 미설정 시 기본값 scroll 50% / time_on_page 10초.
 */
export function passesTriggerThresholds(
  conds: InAppTriggerConditions | undefined,
  trigger: string,
  input: Pick<InAppInitInput, 'scrollPercent' | 'timeOnPageSeconds' | 'cartValue'>,
): boolean {
  if (trigger === 'cart_value') {
    const min = conds?.cart_value_min;
    if (typeof min !== 'number' || min <= 0) return true;
    return typeof input.cartValue === 'number' && input.cartValue >= min;
  }
  if (trigger === 'scroll') {
    if (typeof input.scrollPercent !== 'number') return true;
    const need = typeof conds?.scroll_percent === 'number' && conds.scroll_percent > 0 ? conds.scroll_percent : 50;
    return input.scrollPercent >= need;
  }
  if (trigger === 'time_on_page') {
    if (typeof input.timeOnPageSeconds !== 'number') return true;
    const need = typeof conds?.time_on_page_seconds === 'number' && conds.time_on_page_seconds > 0 ? conds.time_on_page_seconds : 10;
    return input.timeOnPageSeconds >= need;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════
// 메인 클래스
// ════════════════════════════════════════════════════════════════════

export class HanjulloInAppModule {
  private autoTriggerSetup = false;
  /** ★ P0-1 (Codex 1R) — 모듈 부팅(≈페이지 로드) 시각. time_on_page 직접 trigger 호출 시 실측 체류 초 보강용 */
  private readonly pageStartMs = Date.now();
  /** 마지막 init/trigger input 누적 — identify가 늦게 갱신(SPA)돼도 이후 트리거가 최신 identity를 쓰도록 보존 */
  private lastInput: InAppInitInput = {};
  /** 메시지별 렌더 시각 (ms) — click/dismiss 시 dwell_seconds 계산 */
  private renderTimes = new Map<string, number>();

  constructor(
    private readonly apiKey: string,
    _secret: string, // 2026-06-10: 브라우저 모듈은 secret 미사용 (인자 자리만 유지 — 호출부 호환)
    private readonly endpoint: string,
  ) {}

  /**
   * 페이지 로드 시 호출 — 사용자에게 표시할 메시지 자동 fetch + 렌더링.
   * 재호출(identify 갱신) 시 input은 기존 값과 병합되고, 과다 호출은 5분 캐시가 흡수한다.
   */
  async init(input: InAppInitInput = {}): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    // ★ P0-1 — scrollPercent/timeOnPageSeconds는 발화별 실측값이라 lastInput에 보존하지 않는다(잔류 시 이후 트리거 오판정)
    const { scrollPercent: _sp, timeOnPageSeconds: _ts, ...persist } = input;
    this.lastInput = { ...this.lastInput, ...persist };
    try {
      // Step 1: page_load 트리거 우선 처리
      await this.fetchAndRender('page_load', this.lastInput);

      // Step 2: 자동 트리거 감지 활성 (scroll / time / exit_intent 자동 이벤트 리스너)
      if (this.lastInput.enableAutoTriggers !== false && !this.autoTriggerSetup) {
        this.setupAutoTriggers();
        this.autoTriggerSetup = true;
      }
    } catch (err) {
      // SDK는 자사몰 페이지 안 동작 — 에러로 자사몰 깨지면 X (조용히 실패)
      this.debugLog(this.lastInput, 'init 실패', err);
    }
  }

  /**
   * 특정 이벤트 트리거 시점 호출 (자사몰에서 직접 호출 가능).
   * 예: hanjullo.inapp.trigger('cart_add', { externalId: '...' });
   * input 미전달 시 마지막 init/trigger의 identity(lastInput)를 그대로 사용한다.
   */
  async trigger(event: string, input: InAppInitInput = {}): Promise<void> {
    if (typeof window === 'undefined') return;
    const effective = { ...this.lastInput, ...input };
    // ★ P0-1 (Codex 1R 정정) — scroll/time_on_page 직접 호출(실측값 미동봉) 시 SDK가 현재 실측값을 보강.
    //   콘솔/자사몰 코드의 trigger('scroll') 임계 우회 차단 + 값이 실측이라 정당 표시는 그대로(오차단 0).
    if (event === 'scroll' && typeof effective.scrollPercent !== 'number') {
      const measured = this.measureScrollPercent();
      if (measured !== null) effective.scrollPercent = measured;
    }
    if (event === 'time_on_page' && typeof effective.timeOnPageSeconds !== 'number') {
      effective.timeOnPageSeconds = Math.max(0, Math.floor((Date.now() - this.pageStartMs) / 1000));
    }
    try {
      await this.fetchAndRender(event, effective);
    } catch (err) {
      this.debugLog(effective, `trigger(${event}) 실패`, err);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Fetch + render
  // ════════════════════════════════════════════════════════════════

  private async fetchAndRender(trigger: string, input: InAppInitInput): Promise<void> {
    const seenSession = this.getSeenSession();
    const seenIds = seenSession.join(',');

    const params = new URLSearchParams({ trigger });
    if (input.externalId) params.set('external_id', input.externalId);
    if (input.anonymousId) params.set('anonymous_id', input.anonymousId);
    if (seenIds) params.set('seen', seenIds);
    // ★ 2026-06-17 2단계 — 앱(웹뷰)이면 채널=app 요청 (미전송 시 서버 기본 web)
    if (input.platform === 'app') params.set('channel', 'app');

    // 캐시 확인 (5분 TTL) — 채널별 분리 (web/app 다른 메시지)
    const cacheKey = `${input.platform || 'web'}|${trigger}|${input.externalId || ''}|${input.anonymousId || ''}`;
    const cached = this.getCachedMessages(cacheKey);
    if (cached) {
      this.debugLog(input, `캐시 hit (${cacheKey})`);
      const cachedInput = this.withServerCustomer(input, cached.customer);
      const seenSession = this.getSeenSession();
      cached.messages.forEach((msg) => {
        if (!this.canDisplayMessage(msg)) return;
        // 캐시 hit에서도 빈도 캡 적용 — once_per_session(세션)·once_per_day(24h) 본 메시지는 재노출 안 함(페이지 이동마다 재노출 차단)
        if (msg.displayFrequency === 'once_per_session' && seenSession.includes(msg.id)) return;
        if (msg.displayFrequency === 'once_per_day' && this.seenToday(msg.id)) return;
        if (!this.passesTriggerConditions(msg, trigger, input)) return;
        this.renderMessage(msg, cachedInput);
      });
      return;
    }

    // Retry with 지수 backoff
    const url = `${this.endpoint}/inapp/active?${params.toString()}`;
    const data = await this.fetchWithRetry(url, {
      headers: {
        // 2026-06-10: 브라우저 모듈은 secret 미전송 — public key + 등록 도메인(Origin) 검증으로 인증
        'X-Hanjullo-Key': this.apiKey,
      },
    });

    if (!data?.success || !Array.isArray(data.messages)) return;

    // 서버 동봉 customer (T3 — 자동 기동 개인화: input.customer가 없을 때만 사용)
    const serverCustomer = data.customer && typeof data.customer === 'object' ? data.customer : null;

    // 캐시 저장
    this.setCachedMessages(cacheKey, data.messages, serverCustomer);

    // 각 메시지 렌더링 (max_displays_per_user + 트리거 조건 클라이언트 추가 검증)
    const renderInput = this.withServerCustomer(input, serverCustomer);
    for (const msg of data.messages as InAppMessageSdk[]) {
      if (!this.canDisplayMessage(msg)) {
        this.debugLog(input, `메시지 ${msg.id} 표시 한도 초과 (max_displays_per_user)`);
        continue;
      }
      if (!this.passesTriggerConditions(msg, trigger, input)) {
        this.debugLog(input, `메시지 ${msg.id} 트리거 조건 미충족 (${trigger})`);
        continue;
      }
      this.renderMessage(msg, renderInput);
    }
  }

  /** input.customer가 없으면 서버 동봉 customer를 사용 (수동 전달이 항상 우선 — 하위 호환) */
  private withServerCustomer(input: InAppInitInput, serverCustomer: Record<string, any> | null | undefined): InAppInitInput {
    if (input.customer || !serverCustomer) return input;
    return { ...input, customer: serverCustomer };
  }

  /** 트리거별 조건 클라이언트 검증 — 실측값(스크롤%·체류초·장바구니액)은 브라우저만 알아서 SDK가 판정 (★ P0-1 임계 확장) */
  private passesTriggerConditions(msg: InAppMessageSdk, trigger: string, input: InAppInitInput): boolean {
    const conds = msg.triggerConditions || msg.trigger_conditions;
    return passesTriggerThresholds(conds, trigger, input);
  }

  private async fetchWithRetry(url: string, options: RequestInit, attempt: number = 1): Promise<any> {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        // 503 = DB 마이그레이션 / 401·403 = 미인증·플랜 차단 — retry 무의미 (운영자 설정 사항)
        if (res.status === 503 || res.status === 401 || res.status === 403) return null;
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt >= MAX_RETRIES) {
        // 최종 실패 — offline fallback (캐시 영역 없으면 빈 응답)
        return null;
      }
      // 지수 backoff (200ms / 400ms / 800ms)
      const delayMs = 200 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return this.fetchWithRetry(url, options, attempt + 1);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 캐시 (5분 TTL)
  // ════════════════════════════════════════════════════════════════

  private getCachedMessages(cacheKey: string): { messages: InAppMessageSdk[]; customer: Record<string, any> | null } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CACHE);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      const entry = cache[cacheKey];
      if (!entry || typeof entry.timestamp !== 'number') return null;
      if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
      if (!Array.isArray(entry.messages)) return null;
      return { messages: entry.messages, customer: entry.customer && typeof entry.customer === 'object' ? entry.customer : null };
    } catch {
      return null;
    }
  }

  private setCachedMessages(cacheKey: string, messages: InAppMessageSdk[], customer?: Record<string, any> | null): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CACHE);
      const cache = raw ? JSON.parse(raw) : {};
      cache[cacheKey] = { timestamp: Date.now(), messages, ...(customer ? { customer } : {}) };
      // 캐시 크기 제한 (10건 초과 시 오래된 것 제거)
      const keys = Object.keys(cache);
      if (keys.length > 10) {
        const sorted = keys.sort((a, b) => (cache[a].timestamp || 0) - (cache[b].timestamp || 0));
        delete cache[sorted[0]];
      }
      localStorage.setItem(STORAGE_KEY_CACHE, JSON.stringify(cache));
    } catch {
      // 조용히 실패
    }
  }

  // ════════════════════════════════════════════════════════════════
  // max_displays_per_user 클라이언트 검증
  // ════════════════════════════════════════════════════════════════

  private canDisplayMessage(msg: InAppMessageSdk): boolean {
    // ★ 2026-07-16 "다시 보지 않기" 최우선 — 명시 거부 메시지는 캐시/신규 응답 무관 영구 차단
    if (this.isOptedOut(msg.id) || (msg.parentMessageId && this.isOptedOut(msg.parentMessageId)) || ((msg as any).parent_message_id && this.isOptedOut(String((msg as any).parent_message_id)))) {
      return false;
    }
    // ★ 2026-07-17 닫기·버튼 누른 메시지는 이번 세션 억제 — always여도 닫으면 자동 트리거(스크롤·체류) 재표시 차단
    if (this.isDismissed(msg.id) || (msg.parentMessageId && this.isDismissed(msg.parentMessageId)) || ((msg as any).parent_message_id && this.isDismissed(String((msg as any).parent_message_id)))) {
      return false;
    }
    const maxDisplays = msg.maxDisplaysPerUser ?? msg.max_displays_per_user;
    if (!maxDisplays || maxDisplays <= 0) return true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DISPLAY_COUNT);
      const counts = raw ? JSON.parse(raw) : {};
      const current = Number(counts[msg.id] || 0);
      return current < maxDisplays;
    } catch {
      return true;
    }
  }

  /** ★ 2026-07-16 opt-out 판정 — localStorage 즉시 차단 (서버 억제의 보조. 저장 실패 시 서버가 최종 방어) */
  private isOptedOut(messageId: string): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_OPTOUT);
      const map = raw ? JSON.parse(raw) : {};
      return typeof map[messageId] === 'number';
    } catch {
      return false;
    }
  }

  private markOptOut(messageId: string): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_OPTOUT);
      const map = raw ? JSON.parse(raw) : {};
      map[messageId] = Date.now();
      localStorage.setItem(STORAGE_KEY_OPTOUT, JSON.stringify(map));
    } catch {
      // 조용히 실패 — 서버 opt_out 기록이 최종 방어
    }
  }

  /** ★ 2026-07-17 닫기·버튼 클릭 = 이번 세션 재표시 억제 (sessionStorage). always여도 닫으면 세션 내 안 뜸.
   *  variant는 부모 축으로 억제. opt_out(영구)과 구분 — 새 세션엔 빈도 규칙대로 다시 뜬다. */
  private markDismissed(messageId: string): void {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_DISMISSED);
      const map = raw ? JSON.parse(raw) : {};
      map[messageId] = 1;
      sessionStorage.setItem(SESSION_KEY_DISMISSED, JSON.stringify(map));
    } catch {
      // 조용히 실패
    }
  }

  private isDismissed(messageId: string): boolean {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_DISMISSED);
      const map = raw ? JSON.parse(raw) : {};
      return map[messageId] === 1;
    } catch {
      return false;
    }
  }

  /** 닫기·버튼 누른 메시지를 세션 억제 (부모 축 포함). 재표시 방지 공통 진입점. */
  private dismissForSession(msg: InAppMessageSdk): void {
    this.markDismissed(msg.id);
    const parentId = msg.parentMessageId ?? msg.parent_message_id;
    if (parentId) this.markDismissed(String(parentId));
  }

  /**
   * ★ 2026-07-17 세션 초기화 (공개 API). 앱(웹뷰)이 앱 실행 시 호출해 once_per_session·닫기 억제를
   * 새 세션으로 리셋한다. 브라우저는 탭 닫으면 sessionStorage가 자동 초기화되지만, 앱 웹뷰는
   * 프로세스 종료 후에도 sessionStorage가 남을 수 있어 앱이 실행 시 명시적으로 호출해야 한다.
   * (opt_out은 영구 규칙이라 리셋 대상 아님)
   */
  public resetSession(): void {
    try { sessionStorage.removeItem(SESSION_KEY_SEEN); } catch { /* noop */ }
    try { sessionStorage.removeItem(SESSION_KEY_DISMISSED); } catch { /* noop */ }
    try { sessionStorage.removeItem(SESSION_KEY_STICKY); } catch { /* noop */ }
  }

  private incrementDisplayCount(messageId: string): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DISPLAY_COUNT);
      const counts = raw ? JSON.parse(raw) : {};
      counts[messageId] = Number(counts[messageId] || 0) + 1;
      localStorage.setItem(STORAGE_KEY_DISPLAY_COUNT, JSON.stringify(counts));
    } catch {
      // 조용히 실패
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 자동 트리거 감지 (scroll / time_on_page / exit_intent / cart_value)
  // ════════════════════════════════════════════════════════════════

  private setupAutoTriggers(): void {
    // 리스너는 input을 캡처하지 않는다 — trigger()가 lastInput을 참조해 늦은 identify에도 최신 identity 사용
    // Scroll 트리거
    let lastScrollPercent = 0;
    const scrollListener = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrollPercent = docHeight > 0 ? Math.floor((window.scrollY / docHeight) * 100) : 0;
      // 10% 증가할 때마다 1회 평가 — ★ P0-1 발화 시점 실측 %를 동봉해 임계값(scroll_percent) 비교 가능
      if (scrollPercent >= lastScrollPercent + 10) {
        lastScrollPercent = scrollPercent;
        this.trigger('scroll', { scrollPercent }).catch(() => {});
      }
    };
    window.addEventListener('scroll', this.throttle(scrollListener, 500));

    // Time on page 트리거 (10초 / 30초 / 60초 시점) — ★ P0-1 실측 체류 초 동봉(time_on_page_seconds 비교)
    [10, 30, 60].forEach((seconds) => {
      setTimeout(() => {
        this.trigger('time_on_page', { timeOnPageSeconds: seconds }).catch(() => {});
      }, seconds * 1000);
    });

    // Exit intent 트리거 (마우스 상단 이탈 — desktop only)
    let exitTriggered = false;
    document.addEventListener('mouseout', (e: MouseEvent) => {
      if (exitTriggered) return;
      if (e.clientY <= 0) {
        exitTriggered = true;
        this.trigger('exit_intent').catch(() => {});
      }
    });
  }

  /** ★ P0-1 (Codex 1R) — 현재 스크롤 도달 % 실측 (setupAutoTriggers 리스너와 동일 산식). 측정 불가 시 null(임계 판정은 기존 통과 동작) */
  private measureScrollPercent(): number | null {
    try {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      return docHeight > 0 ? Math.floor((window.scrollY / docHeight) * 100) : 0;
    } catch {
      return null;
    }
  }

  private throttle<T extends (...args: any[]) => void>(fn: T, delay: number): T {
    let lastCall = 0;
    return ((...args: any[]) => {
      const now = Date.now();
      if (now - lastCall < delay) return;
      lastCall = now;
      fn(...args);
    }) as T;
  }

  // ════════════════════════════════════════════════════════════════
  // A/B Sticky Bucketing
  // ════════════════════════════════════════════════════════════════

  // ★ D215+ — sticky bucketing 처리 = backend selectVariantForCustomer (CT-80) 단일 진실.
  //   SDK 안 setStickyVariantId 호출 = 옛 variant 기록 보존 (향후 캐시 hit 안 sticky 활용 강화 시점 진입).
  private setStickyVariantId(parentMessageId: string, variantId: string): void {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_STICKY);
      const sticky = raw ? JSON.parse(raw) : {};
      sticky[parentMessageId] = variantId;
      sessionStorage.setItem(SESSION_KEY_STICKY, JSON.stringify(sticky));
    } catch {
      // 조용히 실패
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Liquid 클라이언트 변수 치환 (단순 {{ customer.X }} + 옛 %% 양쪽)
  // ════════════════════════════════════════════════════════════════

  private replaceVariables(text: string, customer: Record<string, any>): string {
    if (!text) return '';
    let out = text;

    // 옛 %변수% 패턴
    const legacyMap: Record<string, string> = {
      '%고객명%': String(customer.name || '고객'),
      '%이름%': String(customer.name || '고객'),
      '%등급%': String(customer.grade || ''),
      '%포인트%': String(customer.points ?? ''),
      '%지역%': String(customer.region || ''),
      '%최근구매매장%': String(customer.recent_purchase_store || customer.recent_product || ''),
    };
    for (const [pattern, value] of Object.entries(legacyMap)) {
      if (out.includes(pattern)) {
        out = out.split(pattern).join(value);
      }
    }

    // Liquid 단순 {{ customer.X }} 패턴 (조건 분기 X — 단순 변수만)
    out = out.replace(/\{\{\s*customer\.([a-zA-Z_]+)\s*(?:\|\s*default:\s*['"]([^'"]+)['"])?\s*\}\}/g,
      (_match, varName, defaultValue) => {
        const value = customer[varName];
        if (value === undefined || value === null || value === '') {
          return defaultValue !== undefined ? String(defaultValue) : '';
        }
        return String(value);
      });

    return out;
  }

  // ════════════════════════════════════════════════════════════════
  // 메시지 렌더링 (8 templates 분기)
  // ════════════════════════════════════════════════════════════════

  private renderMessage(msg: InAppMessageSdk, input: InAppInitInput): void {
    // ★ P0-4 — 같은 메시지 DOM 잔존 시 중복 렌더 가드. always 메시지가 scroll(10%마다)·time_on_page(3회) 자동
    //   트리거로 같은 페이지에 중복 스택되는 것 차단. 닫으면 DOM이 사라지므로 재표시 가능(always 의미 보존).
    if (document.querySelector(`[data-hanjullo-msg="${msg.id}"]`)) return;
    this.renderTimes.set(msg.id, Date.now());

    // 이전 호환 — position 컬럼 fallback
    const template: InAppTemplate = (msg.template || (msg.position as InAppTemplate) || 'top_banner');

    // ★ D230+ — content_blocks 있으면 블록 렌더(테마+모션), 없으면 레거시 단색 렌더(외형 변화 0)
    const blocks = this.parseBlocks(msg);
    if (blocks.length > 0) {
      try {
        this.renderBlockMessage(msg, template, blocks, input);
      } catch (err) {
        // 블록 렌더 실패 = 레거시로 안전 폴백 (자사몰 안 깨짐)
        this.debugLog(input, '블록 렌더 실패 — 레거시 폴백', err);
        this.renderLegacy(msg, template, input);
      }
    } else {
      this.renderLegacy(msg, template, input);
    }

    // ★ 2026-07-17 텍스트 정렬 (design.text_align) — 루트에 적용해 제목·본문 텍스트를 좌/중/우 정렬 (미지정=왼쪽·현행 유지)
    const textAlign = (msg.design as any)?.text_align;
    if (textAlign === 'center' || textAlign === 'right') {
      const rootEl = document.querySelector(`[data-hanjullo-msg="${msg.id}"]`) as HTMLElement | null;
      if (rootEl) rootEl.style.textAlign = textAlign;
    }

    // impression 트래킹 + 표시 이력 + 카운트 증가
    this.track(msg.id, 'impression', input);
    this.markSeen(msg);
    this.incrementDisplayCount(msg.id);

    // Sticky bucketing 저장
    const parentId = msg.parentMessageId ?? msg.parent_message_id;
    if (parentId) this.setStickyVariantId(parentId, msg.id);
  }

  /** content_blocks 파싱 — 배열 + {type:string} 인 블록만. 실패 시 [] (레거시 폴백) */
  private parseBlocks(msg: InAppMessageSdk): ContentBlock[] {
    let raw: any = msg.contentBlocks ?? msg.content_blocks;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { return []; }
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter((b: any) => b && typeof b === 'object' && typeof b.type === 'string');
  }

  /** 레거시 단색 렌더 — content_blocks 없는 메시지 (외형 변화 0, 기존 8 template 분기 그대로) */
  private renderLegacy(msg: InAppMessageSdk, template: InAppTemplate, input: InAppInitInput): void {
    const customer = input.customer || {};
    const renderedTitle = this.replaceVariables(msg.title || '', customer);
    const renderedBody = this.replaceVariables(msg.body || '', customer);
    const animation = msg.animation || 'fade';
    const autoDismissSec = msg.autoDismissSeconds ?? msg.auto_dismiss_seconds;
    const imageUrl = msg.imageUrl ?? msg.image_url;
    const badge = (msg.badgeText ?? msg.badge_text) || '';
    const buttons = Array.isArray(msg.buttons) && msg.buttons.length > 0
      ? msg.buttons
      : msg.actionUrl
        ? [{
            id: 'btn_primary',
            label: msg.actionLabel || '자세히 보기',
            action_url: msg.actionUrl,
            style: 'primary' as const,
            background_color: 'rgba(255,255,255,0.2)',
            text_color: msg.textColor,
          }]
        : [];

    switch (template) {
      case 'top_banner':
      case 'bottom_banner':
        this.renderBanner(msg, template, renderedTitle, renderedBody, imageUrl, buttons, animation, autoDismissSec, input);
        break;
      case 'center_modal':
        this.renderCenterModal(msg, renderedTitle, renderedBody, imageUrl, badge, buttons, animation, autoDismissSec, input);
        break;
      case 'full_screen':
        this.renderFullScreen(msg, renderedTitle, renderedBody, imageUrl, badge, buttons, animation, autoDismissSec, input);
        break;
      case 'slide_in':
        this.renderSlideIn(msg, renderedTitle, renderedBody, imageUrl, badge, buttons, animation, autoDismissSec, input);
        break;
      case 'inline_card':
        this.renderInlineCard(msg, renderedTitle, renderedBody, imageUrl, badge, buttons, input);
        break;
      case 'toast':
        this.renderToast(msg, renderedTitle, renderedBody, animation, autoDismissSec || 3, input);
        break;
      case 'floating_button':
        this.renderFloatingButton(msg, renderedTitle, buttons, input);
        break;
      default:
        this.renderBanner(msg, 'top_banner', renderedTitle, renderedBody, imageUrl, buttons, animation, autoDismissSec, input);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Template 1 + 2: top_banner / bottom_banner
  // ────────────────────────────────────────────────────────────────

  private renderBanner(
    msg: InAppMessageSdk,
    template: 'top_banner' | 'bottom_banner',
    title: string, body: string, imageUrl: string | null | undefined,
    buttons: InAppButton[], animation: string, autoDismissSec: number | null | undefined,
    input: InAppInitInput,
  ): void {
    const root = document.createElement('div');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, {
      position: 'fixed',
      [template === 'top_banner' ? 'top' : 'bottom']: '0',
      left: '0',
      right: '0',
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      background: msg.backgroundColor,
      color: msg.textColor,
      boxShadow: template === 'top_banner' ? '0 6px 24px rgba(0,0,0,0.16)' : '0 -6px 24px rgba(0,0,0,0.16)',
      zIndex: '2147483647',
      fontFamily: INAPP_FONT_STACK,
      boxSizing: 'border-box',
    });
    this.applyAnimation(root, animation, template);

    if (imageUrl) this.appendImage(root, imageUrl, 48);
    this.appendTextBlock(root, title, body, 'banner', !!(msg.is_ad ?? msg.isAd));
    this.appendButtons(root, msg, buttons, input);
    this.appendOptOutLink(root, msg, input, () => { try { document.body.removeChild(root); } catch {} }, 'inline');
    this.appendCloseButton(root, msg, input, () => document.body.removeChild(root));

    document.body.appendChild(root);
    if (autoDismissSec && autoDismissSec > 0) this.setupAutoDismiss(root, autoDismissSec);
  }

  // ────────────────────────────────────────────────────────────────
  // Template 3: center_modal
  // ────────────────────────────────────────────────────────────────

  private renderCenterModal(
    msg: InAppMessageSdk, title: string, body: string, imageUrl: string | null | undefined,
    badge: string,
    buttons: InAppButton[], animation: string, autoDismissSec: number | null | undefined,
    input: InAppInitInput,
  ): void {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(8,10,18,0.55)',
      backdropFilter: 'blur(14px) saturate(1.35)',
      zIndex: '2147483646',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
    });
    (backdrop.style as any).webkitBackdropFilter = 'blur(14px) saturate(1.35)';

    const root = document.createElement('div');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, {
      maxWidth: '420px',
      width: '100%',
      background: msg.backgroundColor,
      color: msg.textColor,
      borderRadius: '24px',
      overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25), 0 18px 46px rgba(0,0,0,0.35), 0 44px 110px rgba(0,0,0,0.45)',
      position: 'relative',
      zIndex: '2147483647',
      fontFamily: INAPP_FONT_STACK,
      boxSizing: 'border-box',
    });
    this.applyAnimation(root, animation, 'modal');

    // 이미지 = 모달 상단 full-bleed (좌우 여백 없이 꽉 채움)
    if (imageUrl) {
      const hero = document.createElement('img');
      hero.src = this.toAbsoluteImageUrl(imageUrl);
      hero.alt = '';
      hero.loading = 'lazy';
      hero.referrerPolicy = 'no-referrer';
      Object.assign(hero.style, { width: '100%', maxHeight: '300px', objectFit: 'cover', display: 'block' });
      hero.onerror = () => { hero.style.display = 'none'; };
      root.appendChild(hero);
    }
    // 콘텐츠 영역 (뱃지·제목·본문·CTA) — 이미지 유무에 따라 상단 여백 조정
    const content = document.createElement('div');
    content.style.padding = imageUrl ? '22px 24px 24px' : '30px 24px 26px';
    if (badge) this.appendBadge(content, badge, msg.textColor);
    this.appendTextBlock(content, title, body, 'modal', !!(msg.is_ad ?? msg.isAd));
    this.appendButtons(content, msg, buttons, input, 'stack');
    this.appendOptOutLink(content, msg, input, () => { try { document.body.removeChild(backdrop); } catch {} });
    root.appendChild(content);
    // 닫기 = 우상단 (이미지 위에도 보이게)
    this.appendCloseButton(root, msg, input, () => document.body.removeChild(backdrop), 'absolute-top-right');

    backdrop.appendChild(root);
    document.body.appendChild(backdrop);
    if (autoDismissSec && autoDismissSec > 0) this.setupAutoDismiss(backdrop, autoDismissSec);
  }

  // ────────────────────────────────────────────────────────────────
  // Template 4: full_screen
  // ────────────────────────────────────────────────────────────────

  private renderFullScreen(
    msg: InAppMessageSdk, title: string, body: string, imageUrl: string | null | undefined,
    badge: string,
    buttons: InAppButton[], animation: string, autoDismissSec: number | null | undefined,
    input: InAppInitInput,
  ): void {
    const root = document.createElement('div');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      background: msg.backgroundColor,
      color: msg.textColor,
      zIndex: '2147483647',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: INAPP_FONT_STACK,
    });
    this.applyAnimation(root, animation, 'full');

    if (imageUrl) this.appendImage(root, imageUrl, 0, '100%', '240px');
    if (badge) this.appendBadge(root, badge, msg.textColor);
    this.appendTextBlock(root, title, body, 'full', !!(msg.is_ad ?? msg.isAd));
    this.appendButtons(root, msg, buttons, input);
    this.appendOptOutLink(root, msg, input, () => { try { document.body.removeChild(root); } catch {} });
    this.appendCloseButton(root, msg, input, () => document.body.removeChild(root), 'absolute-top-right');

    document.body.appendChild(root);
    if (autoDismissSec && autoDismissSec > 0) this.setupAutoDismiss(root, autoDismissSec);
  }

  // ────────────────────────────────────────────────────────────────
  // Template 5: slide_in (우측 슬라이드)
  // ────────────────────────────────────────────────────────────────

  private renderSlideIn(
    msg: InAppMessageSdk, title: string, body: string, imageUrl: string | null | undefined,
    badge: string,
    buttons: InAppButton[], animation: string, autoDismissSec: number | null | undefined,
    input: InAppInitInput,
  ): void {
    const root = document.createElement('div');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      maxWidth: '340px',
      background: msg.backgroundColor,
      color: msg.textColor,
      borderRadius: '18px',
      padding: '20px',
      boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
      zIndex: '2147483647',
      fontFamily: INAPP_FONT_STACK,
      boxSizing: 'border-box',
    });
    this.applyAnimation(root, animation, 'slide-right');

    if (imageUrl) this.appendImage(root, imageUrl, 0, '100%', '120px');
    if (badge) this.appendBadge(root, badge, msg.textColor);
    this.appendTextBlock(root, title, body, 'slide', !!(msg.is_ad ?? msg.isAd));
    this.appendButtons(root, msg, buttons, input);
    this.appendOptOutLink(root, msg, input, () => { try { document.body.removeChild(root); } catch {} });
    this.appendCloseButton(root, msg, input, () => document.body.removeChild(root), 'absolute-top-right');

    document.body.appendChild(root);
    if (autoDismissSec && autoDismissSec > 0) this.setupAutoDismiss(root, autoDismissSec);
  }

  // ────────────────────────────────────────────────────────────────
  // Template 6: inline_card (DOM 안 inline 삽입)
  // ────────────────────────────────────────────────────────────────

  private renderInlineCard(
    msg: InAppMessageSdk, title: string, body: string, imageUrl: string | null | undefined,
    badge: string,
    buttons: InAppButton[], input: InAppInitInput,
  ): void {
    const containerSelector = input.containerSelector || 'body';
    const container = document.querySelector(containerSelector);
    if (!container) {
      this.debugLog(input, `inline_card containerSelector 미발견 (${containerSelector})`);
      return;
    }

    const root = document.createElement('div');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, {
      background: msg.backgroundColor,
      color: msg.textColor,
      borderRadius: '16px',
      padding: '22px',
      margin: '16px 0',
      boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
      fontFamily: INAPP_FONT_STACK,
      boxSizing: 'border-box',
    });

    if (imageUrl) this.appendImage(root, imageUrl, 0, '100%', '160px');
    if (badge) this.appendBadge(root, badge, msg.textColor);
    this.appendTextBlock(root, title, body, 'inline', !!(msg.is_ad ?? msg.isAd));
    this.appendButtons(root, msg, buttons, input);
    this.appendOptOutLink(root, msg, input, () => { try { root.parentNode?.removeChild(root); } catch {} });

    container.appendChild(root);
  }

  // ────────────────────────────────────────────────────────────────
  // Template 7: toast (우상단 3초 자동 닫힘)
  // ────────────────────────────────────────────────────────────────

  private renderToast(
    msg: InAppMessageSdk, title: string, body: string, animation: string, autoDismissSec: number,
    input: InAppInitInput,
  ): void {
    const root = document.createElement('div');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      maxWidth: '320px',
      background: msg.backgroundColor,
      color: msg.textColor,
      borderRadius: '10px',
      padding: '12px 14px',
      boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
      zIndex: '2147483647',
      fontSize: '13px',
      fontFamily: INAPP_FONT_STACK,
    });
    this.applyAnimation(root, animation, 'toast');

    const titleEl = document.createElement('div');
    titleEl.style.fontWeight = '600';
    titleEl.style.marginBottom = '2px';
    titleEl.textContent = title;
    root.appendChild(titleEl);

    if (body) {
      const bodyEl = document.createElement('div');
      bodyEl.style.opacity = '0.9';
      bodyEl.style.fontSize = '12px';
      bodyEl.textContent = body;
      root.appendChild(bodyEl);
    }

    // ★ P1-5 — 토스트도 is_ad면 (광고) 잔글씨 (레거시 경로 표기 통일)
    if ((msg.is_ad ?? msg.isAd) && !/\(광고\)/.test(`${title} ${body}`)) {
      const ad = document.createElement('div');
      ad.textContent = '(광고)';
      Object.assign(ad.style, { fontSize: '10px', fontWeight: '500', opacity: '0.65', marginTop: '4px' });
      root.appendChild(ad);
    }

    document.body.appendChild(root);
    setTimeout(() => {
      try { document.body.removeChild(root); } catch {}
    }, autoDismissSec * 1000);
  }

  // ────────────────────────────────────────────────────────────────
  // Template 8: floating_button (우하단 플로팅)
  // ────────────────────────────────────────────────────────────────

  private renderFloatingButton(
    msg: InAppMessageSdk, title: string, buttons: InAppButton[], input: InAppInitInput,
  ): void {
    const action = buttons[0];
    if (!action) return;

    const root = document.createElement('button');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      background: msg.backgroundColor,
      color: msg.textColor,
      border: 'none',
      borderRadius: '999px',
      padding: '14px 22px',
      boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
      zIndex: '2147483647',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      fontFamily: INAPP_FONT_STACK,
    });
    root.textContent = title || action.label;
    root.addEventListener('click', () => {
      this.track(msg.id, 'click', input, action.id);
      this.safeNavigate(action.action_url);
    });

    document.body.appendChild(root);
  }

  // ════════════════════════════════════════════════════════════════
  // ★ D230+ 블록 렌더 (content_blocks → 테마 컨테이너 + 블록 + 모션)
  // ════════════════════════════════════════════════════════════════

  private renderBlockMessage(msg: InAppMessageSdk, template: InAppTemplate, blocks: ContentBlock[], input: InAppInitInput): void {
    const customer = input.customer || {};
    const reduced = this.prefersReducedMotion();
    const theme = resolveTheme(msg.theme, msg.accentColor ?? msg.accent_color, { prefersDark: this.prefersDark() });
    const animation = msg.animation || 'fade';
    let autoDismissSec = msg.autoDismissSeconds ?? msg.auto_dismiss_seconds;
    const isAd = !!(msg.is_ad ?? msg.isAd);
    // ★ 2026-07-07(2) 형태 축 — 카드형 템플릿만 적용 (토스트·배너·플로팅 = 자체 형태)
    const cardish = template === 'center_modal' || template === 'slide_in' || template === 'inline_card' || template === 'full_screen';
    const cardStyle: CardStyle = cardish ? normalizeCardStyle(msg.cardStyle ?? msg.card_style) : 'classic';

    // ★ 2026-07-14 디자인 3.0 — 메시지 단위 디자인 (design 미설정 = 아래 전부 비활성 = 현행 렌더 그대로)
    const design = msg.design && typeof msg.design === 'object' ? msg.design : null;
    const motion = !reduced && design?.motion === 'rich';
    const treatment: InAppTreatment = cardish ? resolveInAppTreatment(template, cardStyle, design?.treatment) : 'classic';
    const displayFont = safeFontFamily(design?.font_display || theme.displayFont || undefined, '');
    if (motion) ensureMotionStyle();
    if (displayFont) ensureFontLink(displayFont);

    // floating_button = 알약 1개 (블록 중 첫 CTA 라벨)
    if (template === 'floating_button') {
      this.renderBlockFloating(msg, blocks, theme, input);
      return;
    }

    // ★ 2026-07-07(5) 형태 골격 — 배치 계획을 컨테이너 생성 전에 확정 (존 분할 여부 = 컨테이너 패딩 0)
    const plan = planCardLayout(blocks, cardStyle);
    const zonePads = ZONE_PADS[template];
    const zoned = !!zonePads && (
      (cardStyle === 'poster' && (!!plan.hero || plan.overlay.length > 0)) ||
      (cardStyle === 'ticket' && plan.stub.length > 0)
    );

    const c = this.makeContainer(msg, template, theme, input, cardStyle, zoned, design);
    if (!c.mounted) return;

    // ★ 3.0 — 밀도(테마 아트디렉션): 비분할 컨테이너 블록 간격만 조정 (존 분할 구도는 자기 간격 소유 = 유지)
    if (!zoned && theme.density) c.contentRoot.style.gap = theme.density === 'airy' ? '16px' : '10px';

    const ctx: BlockRenderContext = {
      theme,
      template,
      cardStyle,
      replaceVars: (t) => this.replaceVariables(t, customer),
      absoluteImageUrl: (u) => this.toAbsoluteImageUrl(u),
      onButtonClick: (buttonId, actionUrl) => {
        this.track(msg.id, 'click', input, buttonId);
        this.dismissForSession(msg); // ★ 2026-07-17 버튼 누르면 이번 세션 재표시 억제
        c.remove();
        this.safeNavigate(actionUrl);
      },
      reducedMotion: reduced,
      isAd,
      motion,
      treatment,
      displayFont: design?.font_display ? displayFont : undefined,
      // ★ 2026-07-17 text_align — flex 행 블록(쿠폰·CTA 행) justify-content 미러용 (루트 text-align은 renderMessage가 적용)
      textAlign: design?.text_align === 'center' ? 'center' : design?.text_align === 'right' ? 'right' : undefined,
    };

    // 형태별 골격 — poster: 풀블리드 히어로+본문 존 / ticket: 2톤(본권/스터브) / bubble: 발신자 행+답장 칩 / classic: 순차 렌더
    if (cardStyle === 'poster' && (plan.hero || plan.overlay.length > 0)) {
      const hero = renderPosterHero(plan, ctx, zoned);
      if (hero) c.contentRoot.appendChild(hero);
      if (zoned) {
        const bodyZone = makeZone(zonePads.body);
        renderBlocks(bodyZone, plan.main, ctx);
        c.contentRoot.appendChild(bodyZone);
      } else {
        renderBlocks(c.contentRoot, plan.main, ctx);
      }
    } else if (cardStyle === 'ticket' && plan.stub.length > 0) {
      // (광고) 자동 표기는 마지막 구간에서만 (이중 주입 방지)
      if (zoned) {
        const mainZone = makeZone(zonePads.main);
        renderBlocks(mainZone, plan.main, { ...ctx, isAd: false });
        c.contentRoot.appendChild(mainZone);
        // 스터브 = accent 워시 2톤 (절취선부터 카드 하단까지)
        const stubWrap = document.createElement('div');
        stubWrap.style.background = withAlpha(theme.accent, 0.06);
        stubWrap.appendChild(renderTicketPerforation(theme, true));
        const stubZone = makeZone(zonePads.stub);
        renderBlocks(stubZone, plan.stub, ctx);
        stubWrap.appendChild(stubZone);
        c.contentRoot.appendChild(stubWrap);
      } else {
        renderBlocks(c.contentRoot, plan.main, { ...ctx, isAd: false });
        c.contentRoot.appendChild(renderTicketPerforation(theme));
        renderBlocks(c.contentRoot, plan.stub, ctx);
      }
    } else if (cardStyle === 'bubble' && plan.sender) {
      const senderRow = renderBubbleSender(plan.sender, ctx);
      if (senderRow) c.contentRoot.appendChild(senderRow);
      renderBlocks(c.contentRoot, plan.main, ctx);
    } else if (treatment === 'framed') {
      // ★ 3.0 framed 구도 — 콘텐츠를 헤어라인 내부 프레임으로 감싼 에디토리얼 액자 (classic 카드 전용 허용표)
      const frame = document.createElement('div');
      Object.assign(frame.style, {
        display: 'flex', flexDirection: 'column', gap: c.contentRoot.style.gap || '13px',
        border: `1px solid ${theme.border}`, borderRadius: `${theme.innerRadius + 6}px`,
        padding: '18px 16px', minWidth: '0', boxSizing: 'border-box',
      });
      renderBlocks(frame, blocks, ctx);
      c.contentRoot.appendChild(frame);
    } else {
      renderBlocks(c.contentRoot, blocks, ctx);
    }

    if (c.showClose) {
      this.appendCloseButton(c.closeTarget, msg, input, c.remove, c.closeLayout);
    }

    // ★ 2026-07-16 "다시 보지 않기" — 토스트(자동 닫힘) 제외 전 표면 (플로팅 버튼은 위에서 조기 반환)
    if (template !== 'toast') this.appendOptOutLink(c.contentRoot, msg, input, c.remove);

    this.applyAnimation(c.animationTarget, animation, c.motionContext);
    if (animation === 'celebrate' && !reduced) this.celebrate(c.animationTarget);

    // toast는 기본 자동 닫힘(4초). 그 외는 명시된 경우만.
    if (template === 'toast' && (autoDismissSec === null || autoDismissSec === undefined)) autoDismissSec = 4;
    if (autoDismissSec && autoDismissSec > 0) this.setupAutoDismiss(c.dismissTarget, autoDismissSec);
  }

  /** 템플릿별 컨테이너(위치·면·모서리·그림자)를 테마 토큰으로 생성 + DOM 마운트. blocks는 contentRoot에.
   *  ★ 2026-07-07(5) zoned=true(ticket 2톤/poster 풀블리드) — 패딩을 존이 소유하도록 컨테이너 패딩 0 + 모서리 클립. */
  private makeContainer(msg: InAppMessageSdk, template: InAppTemplate, theme: InAppTheme, input: InAppInitInput, cardStyle: CardStyle = 'classic', zoned = false, design: InAppDesignSdk | null = null) {
    const card = document.createElement('div');
    card.setAttribute('data-hanjullo-msg', msg.id);
    const baseCard: Record<string, string> = {
      background: theme.surfaceBg || theme.surface,
      color: theme.textPrimary,
      fontFamily: INAPP_FONT_STACK,
      boxSizing: 'border-box',
      letterSpacing: '-0.005em',
    };
    (card.style as any).webkitFontSmoothing = 'antialiased';
    const content = document.createElement('div');
    Object.assign(content.style, { display: 'flex', flexDirection: 'column', gap: '13px', minWidth: '0' });
    // 링(상단 하이라이트) + 3중 그림자 합성 — 유리 모서리 광
    const cardShadow = theme.ring ? `${theme.ring}, ${theme.shadow}` : theme.shadow;

    // ★ 2026-07-07(2) 둥근 말풍선 — 한 모서리만 좁힌 챗 버블 + 꼬리 (형태 축)
    const bubble = cardStyle === 'bubble';
    const bubbleRadius = (small: 'bl' | 'br') => {
      const r = theme.radius + 4;
      return small === 'bl' ? `${r}px ${r}px ${r}px 14px` : `${r}px ${r}px 14px ${r}px`;
    };
    const attachBubbleTail = (host: HTMLElement, side: 'left' | 'right') => {
      const tail = document.createElement('div');
      Object.assign(tail.style, {
        position: 'absolute', bottom: '-9px', width: '20px', height: '20px',
        background: theme.surface, transform: 'rotate(45deg)',
        borderRight: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`,
        borderRadius: '0 0 5px 0',
      });
      (tail.style as any)[side] = '30px';
      host.appendChild(tail);
    };

    const escClose = (removeFn: () => void) => {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') removeFn(); };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    };

    // ── center_modal
    if (template === 'center_modal') {
      const backdrop = document.createElement('div');
      // ★ 3.0 — 딤 3단 + 블러 on/off (design.backdrop 미설정 = 현행 standard 0.55 + blur 그대로)
      const dim = BACKDROP_DIM[String(design?.backdrop?.dim || '')] || BACKDROP_DIM.standard;
      const blurOn = design?.backdrop?.blur !== false;
      Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', background: dim,
        ...(blurOn ? { backdropFilter: 'blur(14px) saturate(1.35)' } : {}),
        zIndex: '2147483646', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
        opacity: '0', transition: 'opacity 0.35s ease',
      });
      if (blurOn) (backdrop.style as any).webkitBackdropFilter = 'blur(14px) saturate(1.35)';
      Object.assign(card.style, baseCard, {
        maxWidth: '420px', width: '100%', borderRadius: `${theme.radius}px`, overflow: 'hidden',
        boxShadow: cardShadow, position: 'relative', border: `1px solid ${theme.border}`,
      });
      if (bubble) {
        // 꼬리가 카드 밖으로 나가야 해서 overflow 개방 (블록 콘텐츠는 패딩 안이라 안전)
        Object.assign(card.style, { borderRadius: bubbleRadius('bl'), overflow: 'visible' });
        attachBubbleTail(card, 'left');
      }
      Object.assign(content.style, zoned ? { padding: '0', gap: '0' } : { padding: '28px 26px 26px' });
      card.appendChild(content);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);
      // 백드롭 자체 페이드 인 (reduced motion이면 즉시)
      if (this.prefersReducedMotion()) backdrop.style.opacity = '1';
      else requestAnimationFrame(() => requestAnimationFrame(() => { backdrop.style.opacity = '1'; }));
      let off = () => {};
      const remove = () => { off(); try { document.body.removeChild(backdrop); } catch {} };
      off = escClose(remove);
      return { contentRoot: content, animationTarget: card, dismissTarget: backdrop, closeTarget: card, remove, showClose: true, closeLayout: 'absolute-top-right' as const, motionContext: 'modal', mounted: true };
    }

    // ── full_screen
    if (template === 'full_screen') {
      Object.assign(card.style, baseCard, {
        position: 'fixed', inset: '0', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 'calc(24px + env(safe-area-inset-top, 0px)) 24px calc(24px + env(safe-area-inset-bottom, 0px))',
      });
      Object.assign(content.style, { maxWidth: '460px', width: '100%' });
      card.appendChild(content);
      document.body.appendChild(card);
      let off = () => {};
      const remove = () => { off(); try { document.body.removeChild(card); } catch {} };
      off = escClose(remove);
      return { contentRoot: content, animationTarget: card, dismissTarget: card, closeTarget: card, remove, showClose: true, closeLayout: 'absolute-top-right' as const, motionContext: 'full', mounted: true };
    }

    // ── slide_in
    if (template === 'slide_in') {
      Object.assign(card.style, baseCard, {
        position: 'fixed', right: '20px', bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        maxWidth: '360px', width: 'calc(100vw - 40px)',
        borderRadius: `${theme.radius}px`, padding: zoned ? '0' : '22px', boxShadow: cardShadow,
        border: `1px solid ${theme.border}`,
        ...(zoned ? { overflow: 'hidden' } : {}),
      });
      if (zoned) content.style.gap = '0';
      if (bubble) {
        Object.assign(card.style, { borderRadius: bubbleRadius('br') });
        attachBubbleTail(card, 'right');
      }
      card.appendChild(content);
      document.body.appendChild(card);
      const remove = () => { try { document.body.removeChild(card); } catch {} };
      return { contentRoot: content, animationTarget: card, dismissTarget: card, closeTarget: card, remove, showClose: true, closeLayout: 'absolute-top-right' as const, motionContext: 'slide-right', mounted: true };
    }

    // ── toast — 글래스(반투명 + blur). surface가 hex일 때만 반투명(아니면 원색)
    if (template === 'toast') {
      Object.assign(card.style, baseCard, {
        position: 'fixed', top: 'calc(20px + env(safe-area-inset-top, 0px))', right: '20px',
        maxWidth: '340px', width: 'calc(100vw - 40px)',
        background: withAlpha(theme.surface, 0.92),
        backdropFilter: 'blur(16px) saturate(1.3)',
        borderRadius: '16px', padding: '14px 16px', boxShadow: cardShadow, border: `1px solid ${theme.border}`,
      });
      (card.style as any).webkitBackdropFilter = 'blur(16px) saturate(1.3)';
      Object.assign(content.style, { gap: '6px' });
      card.appendChild(content);
      document.body.appendChild(card);
      const remove = () => { try { document.body.removeChild(card); } catch {} };
      return { contentRoot: content, animationTarget: card, dismissTarget: card, closeTarget: card, remove, showClose: false, closeLayout: 'inline' as const, motionContext: 'toast', mounted: true };
    }

    // ── inline_card
    if (template === 'inline_card') {
      const selector = input.containerSelector || 'body';
      const container = document.querySelector(selector);
      if (!container) {
        this.debugLog(input, `inline_card containerSelector 미발견 (${selector})`);
        return { contentRoot: content, animationTarget: card, dismissTarget: card, closeTarget: card, remove: () => {}, showClose: false, closeLayout: 'inline' as const, motionContext: 'fade', mounted: false };
      }
      Object.assign(card.style, baseCard, {
        borderRadius: `${theme.radius}px`, padding: zoned ? '0' : '24px', margin: '16px 0',
        boxShadow: cardShadow, border: `1px solid ${theme.border}`,
        ...(zoned ? { overflow: 'hidden' } : {}),
        ...(bubble ? { borderRadius: bubbleRadius('bl'), position: 'relative' } : {}),
      });
      if (zoned) content.style.gap = '0';
      if (bubble) attachBubbleTail(card, 'left');
      card.appendChild(content);
      container.appendChild(card);
      const remove = () => { try { card.parentNode?.removeChild(card); } catch {} };
      return { contentRoot: content, animationTarget: card, dismissTarget: card, closeTarget: card, remove, showClose: false, closeLayout: 'inline' as const, motionContext: 'fade', mounted: true };
    }

    // ── top_banner / bottom_banner (+ 알 수 없는 템플릿 fallback) — 반투명 + blur (콘텐츠 위에 떠도 자연스럽게)
    const isBottom = template === 'bottom_banner';
    Object.assign(card.style, baseCard, {
      position: 'fixed', left: '0', right: '0', [isBottom ? 'bottom' : 'top']: '0',
      padding: isBottom
        ? '14px 20px calc(14px + env(safe-area-inset-bottom, 0px))'
        : 'calc(14px + env(safe-area-inset-top, 0px)) 20px 14px',
      display: 'flex', alignItems: 'center', gap: '14px',
      background: withAlpha(theme.surface, 0.94),
      backdropFilter: 'blur(12px) saturate(1.3)',
      boxShadow: isBottom ? '0 -8px 32px rgba(0,0,0,0.18)' : '0 8px 32px rgba(0,0,0,0.18)',
      [isBottom ? 'borderTop' : 'borderBottom']: `1px solid ${theme.border}`,
    });
    (card.style as any).webkitBackdropFilter = 'blur(12px) saturate(1.3)';
    Object.assign(content.style, { flex: '1' });
    card.appendChild(content);
    document.body.appendChild(card);
    const removeBanner = () => { try { document.body.removeChild(card); } catch {} };
    return { contentRoot: content, animationTarget: card, dismissTarget: card, closeTarget: card, remove: removeBanner, showClose: true, closeLayout: 'inline' as const, motionContext: isBottom ? 'bottom_banner' : 'top_banner', mounted: true };
  }

  /** floating_button + 블록 — 블록 중 첫 CTA(또는 헤드라인) 라벨로 알약 버튼 */
  private renderBlockFloating(msg: InAppMessageSdk, blocks: ContentBlock[], theme: InAppTheme, input: InAppInitInput): void {
    let label = '';
    let actionUrl: string | null = null;
    let btnId = 'btn_primary';
    for (const b of blocks) {
      if (b.type === 'cta_group' && Array.isArray(b.buttons) && b.buttons.length > 0) {
        const f = b.buttons[0];
        label = String(f.label || '');
        actionUrl = f.action_url ?? null;
        btnId = String(f.id || 'btn_primary');
        break;
      }
    }
    if (!label) {
      const h = blocks.find((b) => b.type === 'headline');
      label = h ? String(h.text || '') : '';
    }
    if (!label) return;

    const root = document.createElement('button');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, {
      position: 'fixed', right: '20px', bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
      background: `linear-gradient(180deg, ${theme.accent} 0%, ${withAlpha(theme.accent, 0.85)} 100%)`,
      color: theme.accentText, border: 'none', borderRadius: '999px',
      padding: '15px 24px',
      boxShadow: `0 2px 6px ${withAlpha(theme.accent, 0.3)}, 0 10px 28px ${withAlpha(theme.accent, 0.45)}, inset 0 1px 0 rgba(255,255,255,0.2)`,
      zIndex: '2147483647', fontSize: '14px', fontWeight: '800', letterSpacing: '-0.01em',
      cursor: 'pointer', fontFamily: INAPP_FONT_STACK,
      transition: 'transform 0.2s cubic-bezier(0.22,1,0.36,1), box-shadow 0.2s ease',
    });
    root.textContent = this.replaceVariables(label, input.customer || {});
    root.addEventListener('mouseenter', () => { root.style.transform = 'translateY(-2px) scale(1.02)'; });
    root.addEventListener('mouseleave', () => { root.style.transform = 'none'; });
    root.addEventListener('mousedown', () => { root.style.transform = 'scale(0.96)'; });
    root.addEventListener('click', () => {
      this.track(msg.id, 'click', input, btnId);
      this.safeNavigate(actionUrl);
    });
    this.applyAnimation(root, msg.animation || 'pulse', 'toast');
    document.body.appendChild(root);
  }

  /** celebrate 애니메이션 — 가벼운 DOM 입자 컨페티 (~12개, 1회, 캔버스 없이) */
  private celebrate(originEl: HTMLElement): void {
    try {
      if (typeof document === 'undefined') return;
      const colors = ['#f97316', '#a855f7', '#22c55e', '#0ea5e9', '#f43f5e', '#fbbf24'];
      const rect = originEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + Math.min(rect.height * 0.3, 120);
      for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        const size = 6 + Math.random() * 5;
        Object.assign(p.style, {
          position: 'fixed', left: `${cx}px`, top: `${cy}px`, width: `${size}px`, height: `${size}px`,
          background: colors[i % colors.length], borderRadius: Math.random() > 0.5 ? '50%' : '2px',
          zIndex: '2147483647', pointerEvents: 'none', opacity: '1',
          transition: 'transform 0.7s cubic-bezier(0.2,0.6,0.3,1), opacity 0.7s ease',
        });
        document.body.appendChild(p);
        const angle = Math.PI * (0.25 + Math.random() * 0.5) * (i % 2 ? 1 : -1) - Math.PI / 2;
        const dist = 60 + Math.random() * 90;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist + 50;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          p.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.floor(Math.random() * 360)}deg)`;
          p.style.opacity = '0';
        }));
        setTimeout(() => { try { p.remove(); } catch {} }, 820);
      }
    } catch {
      // 조용히 실패
    }
  }

  private prefersDark(): boolean {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch { return false; }
  }

  private prefersReducedMotion(): boolean {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch { return false; }
  }

  // ════════════════════════════════════════════════════════════════
  // 공통 헬퍼 — 이미지 / 텍스트 / 버튼 / 닫기 / 애니메이션 / 자동 닫힘
  // ════════════════════════════════════════════════════════════════

  /** ★ P0-2 — 버튼 이동 단일 길목: 스킴 화이트리스트 통과 시에만 이동 (javascript:/data: 등 실행 차단) */
  private safeNavigate(url: string | null | undefined): void {
    const target = resolveSafeNavUrl(url, window.location.href);
    if (target) window.location.href = target;
  }

  /** 상대경로 이미지(/uploads/...)를 SDK endpoint 도메인 기준 절대 URL로 — 자사몰 도메인 404 방지 */
  private toAbsoluteImageUrl(url: string): string {
    if (!url || /^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url;
    try {
      const origin = new URL(this.endpoint).origin;
      return url.startsWith('/') ? origin + url : origin + '/' + url;
    } catch {
      return url;
    }
  }

  private appendBadge(parent: HTMLElement, text: string, textColor: string): void {
    const badge = document.createElement('div');
    badge.textContent = text;
    Object.assign(badge.style, {
      display: 'inline-block',
      background: 'rgba(255,255,255,0.2)',
      color: textColor,
      fontSize: '11px',
      fontWeight: '700',
      letterSpacing: '0.03em',
      padding: '4px 11px',
      borderRadius: '999px',
      marginBottom: '12px',
    });
    parent.appendChild(badge);
  }

  private appendImage(parent: HTMLElement, imageUrl: string, sizePx: number, width?: string, height?: string): void {
    const img = document.createElement('img');
    img.src = this.toAbsoluteImageUrl(imageUrl);
    img.loading = 'lazy';
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    if (sizePx > 0) {
      img.style.width = `${sizePx}px`;
      img.style.height = `${sizePx}px`;
      img.style.objectFit = 'cover';
      img.style.borderRadius = '12px';
      img.style.flexShrink = '0';
    } else {
      img.style.width = width || '100%';
      img.style.height = height || '160px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '14px';
      img.style.marginBottom = '14px';
      img.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
    }
    // 깨진/누락 이미지 = 영역 자체 숨김 (깨진 아이콘·빈 박스 방지)
    img.onerror = () => { img.style.display = 'none'; };
    parent.appendChild(img);
  }

  private appendTextBlock(parent: HTMLElement, title: string, body: string, variant: 'banner' | 'modal' | 'full' | 'slide' | 'inline', isAd = false): void {
    // variant별 본문 최대 줄 수 — 장문이 들어와도 레이아웃이 무너지지 않게 말줄임 (full만 무제한)
    const clampMap: Record<string, number> = { banner: 2, slide: 4, inline: 5, modal: 3, full: 0 };
    const clamp = clampMap[variant] ?? 3;

    const text = document.createElement('div');
    text.style.flex = variant === 'banner' ? '1' : 'initial';
    text.style.minWidth = '0';
    text.style.marginBottom = variant === 'banner' ? '0' : '18px';

    const titleEl = document.createElement('div');
    titleEl.style.fontWeight = '700';
    titleEl.style.fontSize = variant === 'full' ? '22px' : variant === 'banner' ? '15px' : '17px';
    titleEl.style.letterSpacing = '-0.01em';
    titleEl.style.marginBottom = '6px';
    titleEl.style.lineHeight = '1.35';
    titleEl.textContent = title;

    const bodyEl = document.createElement('div');
    bodyEl.style.fontSize = variant === 'full' ? '15px' : '13.5px';
    bodyEl.style.opacity = '0.82';
    bodyEl.style.whiteSpace = 'pre-wrap';
    bodyEl.style.lineHeight = '1.55';
    if (clamp > 0) {
      bodyEl.style.display = '-webkit-box';
      (bodyEl.style as any).webkitLineClamp = String(clamp);
      (bodyEl.style as any).webkitBoxOrient = 'vertical';
      bodyEl.style.overflow = 'hidden';
    }
    bodyEl.textContent = body;

    text.appendChild(titleEl);
    text.appendChild(bodyEl);
    // ★ P1-5 — 레거시 렌더도 is_ad면 본문 하단 잔글씨 (광고) 자동 표기 (블록 경로 renderFooter와 동일 문구.
    //   문안에 이미 (광고)가 있으면 이중 표기 안 함. 수신거부 번호는 회사 admin 직접 작성 — 임의 생성 금지)
    if (isAd && !/\(광고\)/.test(`${title} ${body}`)) {
      const ad = document.createElement('div');
      ad.textContent = '(광고)';
      Object.assign(ad.style, { fontSize: '11px', fontWeight: '500', lineHeight: '1.5', opacity: '0.7', marginTop: '6px' });
      text.appendChild(ad);
    }
    parent.appendChild(text);
  }

  private appendButtons(parent: HTMLElement, msg: InAppMessageSdk, buttons: InAppButton[], input: InAppInitInput, layout: 'inline' | 'stack' = 'inline'): void {
    if (!buttons || buttons.length === 0) return;

    const isInlineButton = parent.style.display === 'flex' && parent.style.flexDirection !== 'column';
    const stack = layout === 'stack';
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      display: 'flex',
      flexDirection: stack ? 'column' : 'row',
      gap: '8px',
      marginTop: isInlineButton ? '0' : '12px',
      flexWrap: 'wrap',
    });

    buttons.slice(0, 3).forEach((btn) => {
      const btnEl = document.createElement('button');
      btnEl.textContent = this.replaceVariables(btn.label, input.customer || {});
      const isPrimary = btn.style === 'primary';
      const isTertiary = btn.style === 'tertiary';
      Object.assign(btnEl.style, {
        background: btn.background_color || (isPrimary ? '#4f46e5' : 'rgba(255,255,255,0.16)'),
        color: btn.text_color || msg.textColor,
        border: isTertiary ? '1px solid rgba(255,255,255,0.35)' : 'none',
        padding: '10px 20px',
        borderRadius: '10px',
        fontSize: '13.5px',
        fontWeight: isPrimary ? '700' : '600',
        letterSpacing: '-0.01em',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        opacity: isTertiary ? '0.9' : '1',
        width: stack ? '100%' : 'auto',
        textAlign: 'center',
        boxShadow: isPrimary ? '0 4px 14px rgba(0,0,0,0.18)' : 'none',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
      });
      btnEl.addEventListener('mouseenter', () => {
        btnEl.style.transform = 'translateY(-1px)';
        if (isPrimary) btnEl.style.boxShadow = '0 6px 20px rgba(0,0,0,0.26)';
        else btnEl.style.opacity = '1';
      });
      btnEl.addEventListener('mouseleave', () => {
        btnEl.style.transform = 'none';
        if (isPrimary) btnEl.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)';
        else btnEl.style.opacity = isTertiary ? '0.9' : '1';
      });
      btnEl.addEventListener('click', () => {
        this.track(msg.id, 'click', input, btn.id);
        this.dismissForSession(msg); // ★ 2026-07-17 버튼 누르면(다음에 볼게요 등) 이번 세션 재표시 억제
        // 이동 전 모달 닫기 — SPA 라우팅·placeholder URL에서도 모달이 남지 않게
        const el = document.querySelector(`[data-hanjullo-msg="${msg.id}"]`) as HTMLElement | null;
        const wrap = el?.parentElement;
        if (wrap && wrap !== document.body) wrap.remove();
        else el?.remove();
        this.safeNavigate(btn.action_url);
      });
      wrapper.appendChild(btnEl);
    });

    parent.appendChild(wrapper);
  }

  private appendCloseButton(
    parent: HTMLElement,
    msg: InAppMessageSdk,
    input: InAppInitInput,
    onClose: () => void,
    layout: 'inline' | 'absolute-top-right' = 'inline',
  ): void {
    const close = document.createElement('button');
    close.setAttribute('aria-label', '닫기');
    // SVG X — 텍스트 ✕보다 선명하고 어느 폰트 환경에서도 동일
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.4');
    svg.setAttribute('stroke-linecap', 'round');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    svg.appendChild(p);
    close.appendChild(svg);

    const baseStyle: Record<string, string> = {
      background: 'rgba(127,127,127,0.13)',
      backdropFilter: 'blur(8px)',
      border: 'none',
      color: 'inherit',
      lineHeight: '1',
      cursor: 'pointer',
      width: '30px',
      height: '30px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0',
      opacity: '0.65',
      transition: 'opacity 0.2s ease, background 0.2s ease, transform 0.3s cubic-bezier(0.22,1,0.36,1)',
    };

    if (layout === 'absolute-top-right') {
      Object.assign(baseStyle, {
        position: 'absolute',
        top: '12px',
        right: '12px',
        zIndex: '2',
      });
      parent.style.position = parent.style.position || 'relative';
    }

    Object.assign(close.style, baseStyle);
    (close.style as any).webkitBackdropFilter = 'blur(8px)';
    close.addEventListener('mouseenter', () => {
      close.style.opacity = '1';
      close.style.background = 'rgba(127,127,127,0.26)';
      close.style.transform = 'rotate(90deg)';
    });
    close.addEventListener('mouseleave', () => {
      close.style.opacity = '0.65';
      close.style.background = 'rgba(127,127,127,0.13)';
      close.style.transform = 'none';
    });
    close.addEventListener('click', () => {
      this.track(msg.id, 'dismiss', input);
      this.dismissForSession(msg); // ★ 2026-07-17 닫으면 이번 세션 재표시 억제 (always여도 유효)
      this.gracefulClose(close, onClose);
    });
    parent.appendChild(close);
  }

  /** ★ 2026-07-16 "다시 보지 않기" 링크 — 명시 거부 = opt_out 기록 + 영구 억제.
   *  닫기(X)와 구분: X는 이번만 닫히고 빈도 규칙(세션/24h)대로 다시 표시된다.
   *  토스트(자동 닫힘)·플로팅 버튼(단일 액션)은 제외. */
  private appendOptOutLink(
    parent: HTMLElement,
    msg: InAppMessageSdk,
    input: InAppInitInput,
    removeFn: () => void,
    layout: 'block' | 'inline' = 'block',
  ): void {
    const btn = document.createElement('button');
    btn.textContent = '다시 보지 않기';
    Object.assign(btn.style, {
      background: 'none',
      border: 'none',
      color: 'inherit',
      opacity: '0.5',
      fontSize: '11px',
      fontWeight: '500',
      lineHeight: '1',
      cursor: 'pointer',
      padding: '4px 6px',
      textDecoration: 'underline dotted',
      textUnderlineOffset: '3px',
      fontFamily: 'inherit',
      flexShrink: '0',
      whiteSpace: 'nowrap',
      transition: 'opacity 0.2s ease',
      ...(layout === 'block' ? { display: 'block', margin: '2px auto 8px' } : {}),
    });
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.5'; });
    btn.addEventListener('click', () => {
      this.markOptOut(msg.id);
      const parentId = msg.parentMessageId ?? msg.parent_message_id;
      if (parentId) this.markOptOut(String(parentId)); // variant에서 눌러도 부모 축 억제 (서버와 동일 기준)
      this.track(msg.id, 'opt_out', input);
      this.gracefulClose(btn, removeFn);
    });
    parent.appendChild(btn);
  }

  /** 닫기 — 카드가 살짝 줄며 사라진 뒤 제거 (reduced motion이면 즉시). onClose 실패해도 조용히. */
  private gracefulClose(fromEl: HTMLElement, onClose: () => void): void {
    try {
      if (this.prefersReducedMotion()) { onClose(); return; }
      const rootEl = fromEl.closest('[data-hanjullo-msg]') as HTMLElement | null;
      // 모달 = 카드의 부모(백드롭)까지 함께 페이드
      const wrap = rootEl && rootEl.parentElement && rootEl.parentElement !== document.body ? rootEl.parentElement : rootEl;
      if (!wrap) { onClose(); return; }
      wrap.style.transition = 'opacity 0.22s ease';
      wrap.style.opacity = '0';
      if (rootEl && rootEl !== wrap) {
        rootEl.style.transition = 'transform 0.22s ease';
        rootEl.style.transform = 'scale(0.97)';
      }
      setTimeout(() => { try { onClose(); } catch {} }, 200);
    } catch {
      try { onClose(); } catch {}
    }
  }

  private applyAnimation(el: HTMLElement, animation: string, context: string): void {
    // prefers-reduced-motion: reduce — 모션 끄고 즉시 표시 (접근성 §13)
    if (this.prefersReducedMotion()) {
      el.style.opacity = '1';
      el.style.transform = 'none';
      return;
    }

    // CSS transition + 초기 transform 적용 후 다음 frame에 정상 상태로 (2026-07-07 스프링 커브 2.0)
    const startStates: Record<string, string> = {
      'fade': 'opacity: 0;',
      'fade-up': 'opacity: 0; transform: translateY(14px);',
      'rise': 'opacity: 0; transform: scale(0.96) translateY(12px);',
      'slide-top': 'transform: translateY(-100%);',
      'slide-bottom': 'transform: translateY(100%);',
      'slide-right': 'transform: translateX(calc(100% + 24px));',
      'bounce': 'transform: scale(0.8); opacity: 0;',
      'pulse': 'transform: scale(0.94); opacity: 0;',
      'spring': 'transform: scale(0.92) translateY(10px); opacity: 0;',
    };

    let startKey = 'fade';
    if (animation === 'slide') {
      if (context === 'top_banner') startKey = 'slide-top';
      else if (context === 'bottom_banner' || context === 'slide-right' || context === 'slide') startKey = 'slide-right';
      else startKey = 'slide-top';
    } else if (animation === 'bounce') {
      startKey = 'bounce';
    } else if (animation === 'pulse') {
      startKey = 'pulse';
    } else if (animation === 'spring') {
      startKey = 'spring';
    } else if (animation === 'celebrate') {
      startKey = 'fade-up';
    } else if (animation === 'fade' && (context === 'modal' || context === 'slide-right')) {
      // 모달·슬라이드인의 기본 fade = 살짝 떠오르는 rise (밋밋함 제거 — 사용자 선택 의미는 유지)
      startKey = 'rise';
    }

    const startCss = startStates[startKey] || startStates.fade;
    const springy = startKey === 'spring' || startKey === 'bounce' || startKey === 'rise' || startKey === 'pulse';
    const transition = springy
      ? 'transform 0.55s cubic-bezier(0.34,1.4,0.64,1), opacity 0.32s ease'
      : 'opacity 0.4s cubic-bezier(0.22,1,0.36,1), transform 0.5s cubic-bezier(0.22,1,0.36,1)';
    el.style.cssText += `; ${startCss} transition: ${transition};`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
    });
  }

  private setupAutoDismiss(el: HTMLElement, seconds: number): void {
    setTimeout(() => {
      try {
        el.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
        el.style.opacity = '0';
        // fixed 요소만 살짝 내려가며 퇴장 (inline_card 등 문서 흐름 요소는 페이드만)
        if (el.style.position === 'fixed') el.style.transform = 'translateY(8px)';
        setTimeout(() => {
          try { el.parentNode?.removeChild(el); } catch {}
        }, 340);
      } catch {
        // 조용히 실패
      }
    }, seconds * 1000);
  }

  // ════════════════════════════════════════════════════════════════
  // 트래킹 (button_id + dwell_seconds 신규 컬럼 지원)
  // ════════════════════════════════════════════════════════════════

  private async track(
    messageId: string,
    eventType: 'impression' | 'click' | 'dismiss' | 'opt_out',
    input: InAppInitInput,
    buttonId?: string,
  ): Promise<void> {
    try {
      // 표시→반응 경과 초 (click/dismiss만 — impression은 표시 순간이라 무의미)
      let dwellSeconds: number | undefined;
      if (eventType === 'click' || eventType === 'dismiss') {
        const renderedAt = this.renderTimes.get(messageId);
        if (typeof renderedAt === 'number') {
          dwellSeconds = Math.max(0, Math.floor((Date.now() - renderedAt) / 1000));
        }
      }
      await fetch(`${this.endpoint}/inapp/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hanjullo-Key': this.apiKey,
        },
        body: JSON.stringify({
          message_id: messageId,
          event_type: eventType,
          external_id: input.externalId,
          anonymous_id: input.anonymousId,
          button_id: buttonId || undefined,
          dwell_seconds: dwellSeconds,
        }),
      });
    } catch {
      // 조용히 실패 (자사몰 동작 영향 X)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 빈도 제어 (sessionStorage + localStorage)
  // ════════════════════════════════════════════════════════════════

  private getSeenSession(): string[] {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_SEEN);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private markSeen(msg: InAppMessageSdk): void {
    try {
      if (msg.displayFrequency === 'once_per_session') {
        const seen = this.getSeenSession();
        if (!seen.includes(msg.id)) {
          seen.push(msg.id);
          sessionStorage.setItem(SESSION_KEY_SEEN, JSON.stringify(seen));
        }
      } else if (msg.displayFrequency === 'once_per_day') {
        const raw = localStorage.getItem(STORAGE_KEY_SEEN);
        const map = raw ? JSON.parse(raw) : {};
        map[msg.id] = Date.now();
        localStorage.setItem(STORAGE_KEY_SEEN, JSON.stringify(map));
      }
    } catch {
      // 조용히 실패
    }
  }

  /** once_per_day — 최근 24h 안에 본 메시지인지 (캐시 hit 재노출 차단용) */
  private seenToday(messageId: string): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SEEN);
      const map = raw ? JSON.parse(raw) : {};
      const last = map[messageId];
      return typeof last === 'number' && Date.now() - last < 24 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 디버그 로깅
  // ════════════════════════════════════════════════════════════════

  private debugLog(input: InAppInitInput, ...args: any[]): void {
    if (input.debug) {
      console.log('[Hanjullo InApp]', ...args);
    }
  }
}
