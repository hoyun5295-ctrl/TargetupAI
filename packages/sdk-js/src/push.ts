/**
 * @hanjullo/sdk — Web Push 모듈 (D175-A, 2026-05-19)
 *
 * 브라우저 환경에서만 동작 (Service Worker + PushManager API).
 * 사용:
 *   await hanjullo.push.subscribe({
 *     externalId: 'user_123',
 *     serviceWorkerPath: '/hanjullo-sw.js'  // 자사몰 루트에 박은 SW 파일
 *   });
 */

import type { HanjulloSDKConfig } from './types';

export interface PushSubscribeInput {
  /** 회원 식별 (선택) */
  externalId?: string;
  /** 비회원 추적 ID (선택) */
  anonymousId?: string;
  /** 자사몰에 박힌 service worker 경로 (기본 /hanjullo-sw.js) */
  serviceWorkerPath?: string;
}

export interface PushSubscribeResult {
  success: boolean;
  subscriptionId?: string;
  isNew?: boolean;
  permission?: NotificationPermission;
  error?: string;
}

export class HanjulloPushModule {
  constructor(
    private readonly apiKey: string,
    private readonly secret: string,
    private readonly endpoint: string,
  ) {}

  /**
   * 사용자에게 Web Push 권한 요청 + 구독 박음.
   * - permission='denied' 시 즉시 실패 반환
   * - Service Worker 미박힘 시 자사몰의 SW 파일 경로 필요
   */
  async subscribe(input: PushSubscribeInput = {}): Promise<PushSubscribeResult> {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return { success: false, error: 'Web Push는 브라우저 환경에서만 동작합니다.' };
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { success: false, error: '이 브라우저는 Web Push를 지원하지 않습니다.' };
    }

    // 1. 권한 요청
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      return { success: false, permission, error: '사용자가 알림 권한을 거부했습니다.' };
    }

    try {
      // 2. VAPID public key 조회
      const vapidRes = await fetch(`${this.endpoint}/push/vapid-public-key`);
      const vapidData = await vapidRes.json();
      if (!vapidData?.success || !vapidData.vapid_public_key) {
        return { success: false, error: 'VAPID public key를 조회하지 못했습니다.' };
      }

      // 3. Service Worker 등록
      const swPath = input.serviceWorkerPath || '/hanjullo-sw.js';
      const registration = await navigator.serviceWorker.register(swPath);
      await navigator.serviceWorker.ready;

      // 4. PushManager 구독
      const applicationServerKey = urlBase64ToUint8Array(vapidData.vapid_public_key);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });

      // 5. 한줄로 백엔드에 구독 박음
      const subJson = subscription.toJSON();
      const res = await fetch(`${this.endpoint}/push/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hanjullo-Key': this.apiKey,
          'X-Hanjullo-Secret': this.secret,
        },
        body: JSON.stringify({
          subscription: {
            endpoint: subJson.endpoint,
            keys: subJson.keys,
          },
          external_id: input.externalId,
          anonymous_id: input.anonymousId,
          user_agent: navigator.userAgent,
        }),
      });
      const data = await res.json();
      if (!data?.success) {
        return { success: false, permission, error: data?.error || '구독 등록 실패' };
      }
      return {
        success: true,
        subscriptionId: data.subscription_id,
        isNew: data.is_new,
        permission,
      };
    } catch (err: any) {
      return { success: false, permission, error: err?.message || 'Push 구독 처리 실패' };
    }
  }

  /** 현재 구독 해제 */
  async unsubscribe(): Promise<{ success: boolean; error?: string }> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return { success: false, error: '브라우저 환경이 아닙니다.' };
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch(`${this.endpoint}/push/unsubscribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hanjullo-Key': this.apiKey,
            'X-Hanjullo-Secret': this.secret,
          },
          body: JSON.stringify({ endpoint }),
        });
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'unsubscribe 처리 실패' };
    }
  }

  /** 현재 권한 상태 */
  permission(): NotificationPermission | 'unsupported' {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  }
}

// ════════════════════════════════════════════════════════════════════
// VAPID URL-safe base64 → Uint8Array
// ════════════════════════════════════════════════════════════════════

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = (typeof window !== 'undefined' ? window.atob(base64) : Buffer.from(base64, 'base64').toString('binary'));
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// HanjulloSDKConfig 타입 참조 보존
void undefined as unknown as HanjulloSDKConfig;
