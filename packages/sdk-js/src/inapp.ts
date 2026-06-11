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
  style: 'primary' | 'secondary' | 'tertiary';
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
  animation?: 'fade' | 'slide' | 'bounce' | 'pulse';
  parentMessageId?: string | null;
  parent_message_id?: string | null;
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
  /** 자동 트리거 감지 활성 (default true) */
  enableAutoTriggers?: boolean;
  /** 디버그 로깅 활성 (default false) */
  debug?: boolean;
}

// ════════════════════════════════════════════════════════════════════
// localStorage / sessionStorage 키
// ════════════════════════════════════════════════════════════════════

const STORAGE_KEY_SEEN = 'hanjullo_inapp_seen';
const SESSION_KEY_SEEN = 'hanjullo_inapp_session';
const STORAGE_KEY_DISPLAY_COUNT = 'hanjullo_inapp_display_count';
const STORAGE_KEY_CACHE = 'hanjullo_inapp_cache';
const SESSION_KEY_STICKY = 'hanjullo_inapp_sticky';
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5분
const MAX_RETRIES = 3;

// ════════════════════════════════════════════════════════════════════
// 메인 클래스
// ════════════════════════════════════════════════════════════════════

export class HanjulloInAppModule {
  private autoTriggerSetup = false;
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
    this.lastInput = { ...this.lastInput, ...input };
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

    // 캐시 확인 (5분 TTL)
    const cacheKey = `${trigger}|${input.externalId || ''}|${input.anonymousId || ''}`;
    const cached = this.getCachedMessages(cacheKey);
    if (cached) {
      this.debugLog(input, `캐시 hit (${cacheKey})`);
      const cachedInput = this.withServerCustomer(input, cached.customer);
      cached.messages.forEach((msg) => {
        if (!this.canDisplayMessage(msg)) return;
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

  /** 트리거별 조건 클라이언트 검증 — cart_value_min은 클라이언트만 아는 값(누적 추정치)이라 여기서 비교 */
  private passesTriggerConditions(msg: InAppMessageSdk, trigger: string, input: InAppInitInput): boolean {
    if (trigger !== 'cart_value') return true;
    const conds = msg.triggerConditions || msg.trigger_conditions;
    const min = conds?.cart_value_min;
    if (typeof min !== 'number' || min <= 0) return true;
    return typeof input.cartValue === 'number' && input.cartValue >= min;
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
      // 10% 증가할 때마다 1회 평가 (50% 등 임계값 매칭)
      if (scrollPercent >= lastScrollPercent + 10) {
        lastScrollPercent = scrollPercent;
        this.trigger('scroll').catch(() => {});
      }
    };
    window.addEventListener('scroll', this.throttle(scrollListener, 500));

    // Time on page 트리거 (10초 / 30초 / 60초 시점)
    [10, 30, 60].forEach((seconds) => {
      setTimeout(() => {
        this.trigger('time_on_page').catch(() => {});
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
    this.renderTimes.set(msg.id, Date.now());
    const customer = input.customer || {};
    const renderedTitle = this.replaceVariables(msg.title || '', customer);
    const renderedBody = this.replaceVariables(msg.body || '', customer);

    // 옛 backward compat — position 컬럼 fallback
    const template: InAppTemplate = (msg.template || (msg.position as InAppTemplate) || 'top_banner');
    const animation = msg.animation || 'fade';
    const autoDismissSec = msg.autoDismissSeconds ?? msg.auto_dismiss_seconds;
    const imageUrl = msg.imageUrl ?? msg.image_url;
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

    // 렌더링 분기 — 8 templates
    switch (template) {
      case 'top_banner':
      case 'bottom_banner':
        this.renderBanner(msg, template, renderedTitle, renderedBody, imageUrl, buttons, animation, autoDismissSec, input);
        break;
      case 'center_modal':
        this.renderCenterModal(msg, renderedTitle, renderedBody, imageUrl, buttons, animation, autoDismissSec, input);
        break;
      case 'full_screen':
        this.renderFullScreen(msg, renderedTitle, renderedBody, imageUrl, buttons, animation, autoDismissSec, input);
        break;
      case 'slide_in':
        this.renderSlideIn(msg, renderedTitle, renderedBody, imageUrl, buttons, animation, autoDismissSec, input);
        break;
      case 'inline_card':
        this.renderInlineCard(msg, renderedTitle, renderedBody, imageUrl, buttons, input);
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

    // impression 트래킹 + 표시 이력 + 카운트 증가
    this.track(msg.id, 'impression', input);
    this.markSeen(msg);
    this.incrementDisplayCount(msg.id);

    // Sticky bucketing 저장
    const parentId = msg.parentMessageId ?? msg.parent_message_id;
    if (parentId) this.setStickyVariantId(parentId, msg.id);
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
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      background: msg.backgroundColor,
      color: msg.textColor,
      boxShadow: template === 'top_banner' ? '0 2px 8px rgba(0,0,0,0.1)' : '0 -2px 8px rgba(0,0,0,0.1)',
      zIndex: '2147483647',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    this.applyAnimation(root, animation, template);

    if (imageUrl) this.appendImage(root, imageUrl, 48);
    this.appendTextBlock(root, title, body, 'banner');
    this.appendButtons(root, msg, buttons, input);
    this.appendCloseButton(root, msg, input, () => document.body.removeChild(root));

    document.body.appendChild(root);
    if (autoDismissSec && autoDismissSec > 0) this.setupAutoDismiss(root, autoDismissSec);
  }

  // ────────────────────────────────────────────────────────────────
  // Template 3: center_modal
  // ────────────────────────────────────────────────────────────────

  private renderCenterModal(
    msg: InAppMessageSdk, title: string, body: string, imageUrl: string | null | undefined,
    buttons: InAppButton[], animation: string, autoDismissSec: number | null | undefined,
    input: InAppInitInput,
  ): void {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.5)',
      zIndex: '2147483646',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
    });

    const root = document.createElement('div');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, {
      maxWidth: '420px',
      width: '100%',
      background: msg.backgroundColor,
      color: msg.textColor,
      borderRadius: '12px',
      padding: '24px',
      boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
      zIndex: '2147483647',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    this.applyAnimation(root, animation, 'modal');

    if (imageUrl) this.appendImage(root, imageUrl, 0, '100%', '180px');
    this.appendTextBlock(root, title, body, 'modal');
    this.appendButtons(root, msg, buttons, input);
    this.appendCloseButton(root, msg, input, () => document.body.removeChild(backdrop));

    backdrop.appendChild(root);
    document.body.appendChild(backdrop);
    if (autoDismissSec && autoDismissSec > 0) this.setupAutoDismiss(backdrop, autoDismissSec);
  }

  // ────────────────────────────────────────────────────────────────
  // Template 4: full_screen
  // ────────────────────────────────────────────────────────────────

  private renderFullScreen(
    msg: InAppMessageSdk, title: string, body: string, imageUrl: string | null | undefined,
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
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    this.applyAnimation(root, animation, 'full');

    if (imageUrl) this.appendImage(root, imageUrl, 0, '100%', '240px');
    this.appendTextBlock(root, title, body, 'full');
    this.appendButtons(root, msg, buttons, input);
    this.appendCloseButton(root, msg, input, () => document.body.removeChild(root), 'absolute-top-right');

    document.body.appendChild(root);
    if (autoDismissSec && autoDismissSec > 0) this.setupAutoDismiss(root, autoDismissSec);
  }

  // ────────────────────────────────────────────────────────────────
  // Template 5: slide_in (우측 슬라이드)
  // ────────────────────────────────────────────────────────────────

  private renderSlideIn(
    msg: InAppMessageSdk, title: string, body: string, imageUrl: string | null | undefined,
    buttons: InAppButton[], animation: string, autoDismissSec: number | null | undefined,
    input: InAppInitInput,
  ): void {
    const root = document.createElement('div');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      maxWidth: '320px',
      background: msg.backgroundColor,
      color: msg.textColor,
      borderRadius: '12px',
      padding: '16px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
      zIndex: '2147483647',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    this.applyAnimation(root, animation, 'slide-right');

    if (imageUrl) this.appendImage(root, imageUrl, 0, '100%', '120px');
    this.appendTextBlock(root, title, body, 'slide');
    this.appendButtons(root, msg, buttons, input);
    this.appendCloseButton(root, msg, input, () => document.body.removeChild(root), 'absolute-top-right');

    document.body.appendChild(root);
    if (autoDismissSec && autoDismissSec > 0) this.setupAutoDismiss(root, autoDismissSec);
  }

  // ────────────────────────────────────────────────────────────────
  // Template 6: inline_card (DOM 안 inline 삽입)
  // ────────────────────────────────────────────────────────────────

  private renderInlineCard(
    msg: InAppMessageSdk, title: string, body: string, imageUrl: string | null | undefined,
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
      borderRadius: '12px',
      padding: '20px',
      margin: '16px 0',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });

    if (imageUrl) this.appendImage(root, imageUrl, 0, '100%', '160px');
    this.appendTextBlock(root, title, body, 'inline');
    this.appendButtons(root, msg, buttons, input);

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
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    root.textContent = title || action.label;
    root.addEventListener('click', () => {
      this.track(msg.id, 'click', input, action.id);
      if (action.action_url) window.location.href = action.action_url;
    });

    document.body.appendChild(root);
  }

  // ════════════════════════════════════════════════════════════════
  // 공통 헬퍼 — 이미지 / 텍스트 / 버튼 / 닫기 / 애니메이션 / 자동 닫힘
  // ════════════════════════════════════════════════════════════════

  private appendImage(parent: HTMLElement, imageUrl: string, sizePx: number, width?: string, height?: string): void {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.loading = 'lazy';
    img.alt = '';
    if (sizePx > 0) {
      img.style.width = `${sizePx}px`;
      img.style.height = `${sizePx}px`;
      img.style.objectFit = 'cover';
      img.style.borderRadius = '8px';
      img.style.flexShrink = '0';
    } else {
      img.style.width = width || '100%';
      img.style.height = height || 'auto';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '8px';
      img.style.marginBottom = '12px';
    }
    parent.appendChild(img);
  }

  private appendTextBlock(parent: HTMLElement, title: string, body: string, variant: 'banner' | 'modal' | 'full' | 'slide' | 'inline'): void {
    const text = document.createElement('div');
    text.style.flex = variant === 'banner' ? '1' : 'initial';
    text.style.minWidth = '0';
    text.style.marginBottom = variant === 'banner' ? '0' : '16px';

    const titleEl = document.createElement('div');
    titleEl.style.fontWeight = '700';
    titleEl.style.fontSize = variant === 'full' ? '20px' : '15px';
    titleEl.style.marginBottom = '4px';
    titleEl.textContent = title;

    const bodyEl = document.createElement('div');
    bodyEl.style.fontSize = variant === 'full' ? '15px' : '13px';
    bodyEl.style.opacity = '0.9';
    bodyEl.style.whiteSpace = 'pre-wrap';
    bodyEl.style.lineHeight = '1.5';
    bodyEl.textContent = body;

    text.appendChild(titleEl);
    text.appendChild(bodyEl);
    parent.appendChild(text);
  }

  private appendButtons(parent: HTMLElement, msg: InAppMessageSdk, buttons: InAppButton[], input: InAppInitInput): void {
    if (!buttons || buttons.length === 0) return;

    const isInlineButton = parent.style.display === 'flex' && parent.style.flexDirection !== 'column';
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      display: 'flex',
      gap: '8px',
      marginTop: isInlineButton ? '0' : '12px',
      flexWrap: 'wrap',
    });

    buttons.slice(0, 3).forEach((btn) => {
      const btnEl = document.createElement('button');
      btnEl.textContent = this.replaceVariables(btn.label, input.customer || {});
      Object.assign(btnEl.style, {
        background: btn.background_color || 'rgba(255,255,255,0.2)',
        color: btn.text_color || msg.textColor,
        border: btn.style === 'tertiary' ? '1px solid rgba(255,255,255,0.3)' : 'none',
        padding: '8px 16px',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: btn.style === 'primary' ? '600' : '500',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        opacity: btn.style === 'tertiary' ? '0.85' : '1',
      });
      btnEl.addEventListener('click', () => {
        this.track(msg.id, 'click', input, btn.id);
        if (btn.action_url) window.location.href = btn.action_url;
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
    close.textContent = '✕';
    close.setAttribute('aria-label', '닫기');

    const baseStyle: Record<string, string> = {
      background: 'transparent',
      border: 'none',
      color: 'inherit',
      fontSize: '16px',
      cursor: 'pointer',
      padding: '4px 8px',
      opacity: '0.7',
    };

    if (layout === 'absolute-top-right') {
      Object.assign(baseStyle, {
        position: 'absolute',
        top: '12px',
        right: '12px',
      });
      parent.style.position = parent.style.position || 'relative';
    }

    Object.assign(close.style, baseStyle);
    close.addEventListener('click', () => {
      this.track(msg.id, 'dismiss', input);
      try { onClose(); } catch {}
    });
    parent.appendChild(close);
  }

  private applyAnimation(el: HTMLElement, animation: string, context: string): void {
    // CSS transition + 초기 transform 적용 후 다음 frame에 정상 상태로
    const startStates: Record<string, string> = {
      'fade': 'opacity: 0;',
      'slide-top': 'transform: translateY(-100%);',
      'slide-bottom': 'transform: translateY(100%);',
      'slide-right': 'transform: translateX(100%);',
      'bounce': 'transform: scale(0.7); opacity: 0;',
      'pulse': 'transform: scale(0.95);',
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
    }

    const startCss = startStates[startKey] || startStates.fade;
    el.style.cssText += `; ${startCss} transition: opacity 0.3s ease, transform 0.3s ease;`;

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
        el.style.opacity = '0';
        setTimeout(() => {
          try { el.parentNode?.removeChild(el); } catch {}
        }, 300);
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
    eventType: 'impression' | 'click' | 'dismiss',
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

  // ════════════════════════════════════════════════════════════════
  // 디버그 로깅
  // ════════════════════════════════════════════════════════════════

  private debugLog(input: InAppInitInput, ...args: any[]): void {
    if (input.debug) {
      console.log('[Hanjullo InApp]', ...args);
    }
  }
}
