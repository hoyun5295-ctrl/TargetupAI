/**
 * @hanjullo/sdk v0.3.5-a — Auto-Capture IIFE 진입점
 *
 * CDN 활용: <script src="https://cdn.hanjul.ai/sdk/v0.3.5/hanjul.min.js"></script>
 * §12 결정 매트릭스 — 무료 진입 X = 100만원/월+ 요금제 진입 자격 의무 (백엔드 검증).
 *
 * 매뉴얼: https://hanjul.ai/docs/sdk/v0.3.5
 */

import { getAnonymousId, getSessionId } from './storage';
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
  let stopPageview: (() => void) | null = null;
  let stopClick: (() => void) | null = null;
  let stopIdentify: (() => void) | null = null;
  let firstEventSent = false;

  const hjl: HjlGlobal = {
    init(config: AutoCaptureConfig) {
      if (!config || !config.apiKey) {
        throw new Error('[Hanjullo] apiKey 누락 — CdpSettingsPage 안 발급 의무');
      }
      if (!config.apiKey.startsWith('hjl_')) {
        throw new Error('[Hanjullo] apiKey = hjl_ 접두사 의무');
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
      stopIdentify = watchIdentifyChanges((result) => {
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

      stopPageview = setupPageviewTracking((event) => {
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

      stopClick = setupClickTracking((event) => {
        transport.queue({
          type: 'click',
          ...event,
          trust_level: 'observed',
        });
      });
    },

    track(eventName: string, properties?: Record<string, unknown>) {
      if (!hjl._transport) {
        throw new Error('[Hanjullo] init() 호출 의무');
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
        throw new Error('[Hanjullo] init() 호출 의무');
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
}

export { createHjlGlobal, VERSION };
