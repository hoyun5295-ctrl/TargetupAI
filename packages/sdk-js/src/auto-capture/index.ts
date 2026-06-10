/**
 * @hanjullo/sdk v0.3.5-a — Auto-Capture IIFE 진입점
 *
 * 설치: <script src="https://app.hanjul.ai/sdk/v0.3.5/hanjul.min.js" data-hjl-key="hjl_..." async></script>
 * 유료 요금제 이용 가능 (백엔드 검증 — 무료 플랜만 차단).
 *
 * 매뉴얼: https://hanjul.ai/docs/sdk/v0.3.5
 */

import { isValidEventName } from './events';
import { autoInitFromScriptTag } from './auto-init';
import { detectIdentify, watchIdentifyChanges } from './identify';
import { detectConsent } from './consent';
import { setupPageviewTracking } from './pageview';
import { setupClickTracking } from './click';
import { Heartbeat } from './heartbeat';
import { Transport } from './transport';

export interface AutoCaptureConfig {
  apiKey: string;
  secret?: string;
  endpoint?: string;
  debug?: boolean;
}

interface HjlGlobal {
  init: (config: AutoCaptureConfig) => void;
  track: (eventName: string, properties?: Record<string, unknown>) => void;
  identify: (externalId: string, traits?: Record<string, unknown>) => void;
  _config: AutoCaptureConfig | null;
  _version: string;
  _heartbeat: Heartbeat | null;
  _transport: Transport | null;
}

const VERSION = '0.3.5-a';

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
