/**
 * @hanjullo/sdk v0.3.10 — Auto-Capture IIFE 진입점 (2026-07-14 인앱 디자인 3.0)
 *
 * 설치: <script src="https://app.hanjul.ai/sdk/v0.3.10/hanjul.min.js" data-hjl-key="hjl_..." async></script>
 * 자사몰 앱 연동(카페24 scripttags 등) 자동삽입 시: src="...?k=hjl_..."로도 키 전달 가능(v0.3.8+).
 * 유료 요금제 이용 가능 (백엔드 검증 — 무료 플랜만 차단).
 *
 * 매뉴얼: https://hanjul.ai/docs/sdk/v0.3.10
 */

import { isValidEventName, INAPP_BRIDGE_EVENT_NAMES } from './events';
import { autoInitFromScriptTag } from './auto-init';
import { detectIdentify, watchIdentifyChanges } from './identify';
import { detectConsent } from './consent';
import { setupPageviewTracking } from './pageview';
import { setupClickTracking } from './click';
import { Heartbeat } from './heartbeat';
import { Transport } from './transport';
import { getAnonymousId } from './storage';
import { readCartEstimate, updateCartEstimate } from './cart-estimate';
import { setupEcommerceTracking, type EcommerceHelpers } from './ecommerce';
import { HanjulloInAppModule } from '../inapp';

export interface AutoCaptureConfig {
  apiKey: string;
  secret?: string;
  endpoint?: string;
  debug?: boolean;
  /** inline_card 템플릿 삽입 위치 선택자 — 스니펫 data-hjl-inapp-container 속성으로 전달 */
  inappContainer?: string;
  /** ★ 2026-06-17 2단계 — 'app'이면 웹뷰 앱 인앱 모드(채널=app). 스니펫 data-hjl-platform 속성으로 전달. 미지정=web */
  platform?: 'web' | 'app';
}

interface HjlGlobal {
  init: (config: AutoCaptureConfig) => void;
  track: (eventName: string, properties?: Record<string, unknown>) => void;
  identify: (externalId: string, traits?: Record<string, unknown>) => void;
  /** 인앱 메시지 모듈 — init() 시 자동 기동. 고급 사용(수동 trigger 등)용 공개 API */
  inapp: HanjulloInAppModule | null;
  /** ★ 2026-06-18 — 이커머스 명시 헬퍼(window.hjl.ecommerce.addToCart 등). init() 시 GA4 dataLayer 자동수집 동반 */
  ecommerce: EcommerceHelpers | null;
  _config: AutoCaptureConfig | null;
  _version: string;
  _heartbeat: Heartbeat | null;
  _transport: Transport | null;
}

const INAPP_BRIDGE_SET = new Set<string>(INAPP_BRIDGE_EVENT_NAMES);

const VERSION = '0.3.10';

function createHjlGlobal(): HjlGlobal {
  let firstEventSent = false;

  const hjl: HjlGlobal = {
    init(config: AutoCaptureConfig) {
      if (!config || !config.apiKey) {
        throw new Error('[Hanjullo] apiKey가 없습니다. 한줄로 관리자 → 자사몰 연동(CDP)에서 발급받으세요.');
      }
      if (!config.apiKey.startsWith('hjl_')) {
        throw new Error('[Hanjullo] apiKey는 hjl_ 접두사로 시작해야 합니다.');
      }
      hjl._config = {
        apiKey: config.apiKey,
        secret: config.secret,
        endpoint: config.endpoint || 'https://app.hanjul.ai/api/cdp',
        debug: !!config.debug,
        inappContainer: config.inappContainer,
        platform: config.platform,
      };

      const heartbeat = new Heartbeat((stage) => {
        if (hjl._config!.debug) console.log('[Hanjullo] heartbeat:', stage);
      });
      const transport = new Transport({
        apiKey: hjl._config.apiKey,
        endpoint: hjl._config.endpoint!,
      });
      hjl._heartbeat = heartbeat;
      hjl._transport = transport;

      heartbeat.mark('sdk_loaded');
      heartbeat.mark('config_loaded');

      try {
        const endpointHost = new URL(hjl._config.endpoint!).hostname;
        if (endpointHost) heartbeat.mark('domain_matched');
      } catch {
        // 단순 무시
      }

      // T1 (2026-06-11) — 인앱 모듈 배선: 설치 스니펫 한 줄로 자동 기동 (추가 코드 0)
      // secret 인자는 2026-06-10부터 브라우저 미사용 (빈 문자열 자리만 유지)
      const inapp = new HanjulloInAppModule(hjl._config.apiKey, '', hjl._config.endpoint!);
      hjl.inapp = inapp;
      let inappAnonId: string | undefined;
      try { inappAnonId = getAnonymousId(); } catch { inappAnonId = undefined; }
      const inappBaseInput = () => ({
        anonymousId: inappAnonId,
        debug: hjl._config!.debug,
        ...(hjl._config!.inappContainer ? { containerSelector: hjl._config!.inappContainer } : {}),
        ...(hjl._config!.platform === 'app' ? { platform: 'app' as const } : {}),
      });

      const id = detectIdentify();
      if (id) {
        transport.queue({
          type: 'identify',
          external_id: id.externalId,
          email: id.email,
          phone: id.phone,
          name: id.name,
          trust_level: 'declared',
        });
      }
      // identify 확정 직후 인앱 기동 — 비로그인이면 anonymousId만으로 조회 (세그먼트 조건 메시지는 서버가 제외)
      inapp.init({ ...inappBaseInput(), externalId: id ? id.externalId : undefined }).catch(() => {});

      watchIdentifyChanges((result) => {
        if (result) {
          transport.queue({
            type: 'identify',
            external_id: result.externalId,
            email: result.email,
            phone: result.phone,
            name: result.name,
            trust_level: 'declared',
          });
          // 늦은 로그인(SPA) — 새 externalId로 인앱 재조회 (과다 호출은 5분 캐시가 흡수)
          inapp.init({ ...inappBaseInput(), externalId: result.externalId }).catch(() => {});
        }
      });

      const consent = detectConsent();
      transport.queue({ type: 'consent', ...consent, trust_level: 'declared' });

      setupPageviewTracking((event) => {
        transport.queue({
          type: 'pageview',
          ...event,
          trust_level: 'observed',
        });
        if (!firstEventSent) {
          firstEventSent = true;
          heartbeat.mark('first_pageview_sent');
        }
      });

      setupClickTracking((event) => {
        transport.queue({
          type: 'click',
          ...event,
          trust_level: 'observed',
        });
      });

      // ★ 2026-06-18 — 이커머스 자동수집(GA4 dataLayer) + 명시 헬퍼. hjl.track 위임 → 적재 + 인앱 트리거(T2 브리지) 자동
      const eco = setupEcommerceTracking((eventName, properties) => hjl.track(eventName, properties));
      hjl.ecommerce = eco.ecommerce;
    },

    track(eventName: string, properties?: Record<string, unknown>) {
      if (!hjl._transport) {
        throw new Error('[Hanjullo] init()을 먼저 호출해주세요.');
      }
      if (!isValidEventName(eventName)) {
        throw new Error(
          `[Hanjullo] 허용되지 않는 eventName: "${eventName}". 표준 이벤트명(cart_add 등) 또는 custom_ 접두사만 사용하세요.`,
        );
      }
      hjl._transport.queue({
        type: 'track',
        event: eventName,
        properties: properties || {},
        trust_level: 'declared',
      });

      // T2 (2026-06-11) — 인앱 트리거 브리지: 커머스 이벤트 적재 직후 동일 이벤트 인앱 평가
      if (hjl.inapp) {
        if (eventName === 'cart_add' || eventName === 'cart_remove') {
          updateCartEstimate(eventName, properties);
        }
        if (INAPP_BRIDGE_SET.has(eventName)) {
          hjl.inapp.trigger(eventName).catch(() => {});
          if (eventName === 'cart_add') {
            const est = readCartEstimate();
            if (est > 0) hjl.inapp.trigger('cart_value', { cartValue: est }).catch(() => {});
          }
        }
      }
    },

    identify(externalId: string, traits?: Record<string, unknown>) {
      if (!hjl._transport) {
        throw new Error('[Hanjullo] init()을 먼저 호출해주세요.');
      }
      hjl._transport.queue({
        type: 'identify',
        external_id: externalId,
        ...(traits || {}),
        trust_level: 'declared',
      });
    },

    inapp: null,
    ecommerce: null,
    _config: null,
    _version: VERSION,
    _heartbeat: null,
    _transport: null,
  };

  return hjl;
}

if (typeof window !== 'undefined') {
  (window as any).hjl = createHjlGlobal();
  // 스니펫 data-hjl-key 자동 init — 설치 담당자 추가 코드 0
  autoInitFromScriptTag();
}

export { createHjlGlobal, VERSION };
