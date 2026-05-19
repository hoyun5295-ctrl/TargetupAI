/**
 * ★ CT-26: Web Push 채널 컨트롤타워 — D175-A (2026-05-19)
 *
 * 🎯 목적
 *   사용자 브라우저 Web Push (VAPID 표준) 발송 + 구독 관리.
 *   - 자사몰 SDK가 사용자 브라우저에서 Service Worker 등록 + 구독 박음
 *   - 한줄로 백엔드가 발송 (web-push 라이브러리 활용)
 *   - cdp_push_subscriptions 테이블에 endpoint+키 박힘
 *
 * 📋 흐름
 *   1. SDK가 브라우저에서 PushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })
 *   2. SDK가 결과(endpoint + p256dh + auth)를 POST /api/cdp/push/subscribe에 박음
 *   3. 한줄로 백엔드가 cdp_push_subscriptions에 INSERT (UNIQUE (company_id, endpoint))
 *   4. 회사 admin이 PushCampaignsPage에서 발송 박음 → web-push 라이브러리 호출
 *   5. 실패한 endpoint는 status='expired' 박음 (TTL 410 Gone 처리)
 *
 * ⛔ 영구 원칙
 *   - 발송 대상은 회사 단위 격리 (company_id 필터 절대)
 *   - Web Push도 광고성이면 "(광고)" 표기 + 무료거부 안내 박는 영역 (Phase 2 보강)
 *   - 0건 매칭 시 발송 차단 (Harold Zero-Count 영구 원칙 정합)
 */

import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// web-push 라이브러리 lazy import (Harold npm install 박힌 후 동작)
// ════════════════════════════════════════════════════════════════════

let webPushLib: any = null;
let webPushInitialized = false;

function getWebPush(): any {
  if (webPushLib) return webPushLib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    webPushLib = require('web-push');
    if (!webPushInitialized) {
      const publicKey = process.env.VAPID_PUBLIC_KEY;
      const privateKey = process.env.VAPID_PRIVATE_KEY;
      const subject = process.env.VAPID_SUBJECT || 'mailto:admin@hanjul.ai';
      if (publicKey && privateKey) {
        webPushLib.setVapidDetails(subject, publicKey, privateKey);
        webPushInitialized = true;
      } else {
        console.warn('[WebPush] VAPID 환경변수 미설정 — push 발송 차단됨');
      }
    }
    return webPushLib;
  } catch (err) {
    console.warn('[WebPush] web-push 패키지 미설치 — Harold가 npm install web-push 박은 후 동작:', err);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  /** 자사몰 식별 메타 (회사별 격리 검증용) */
  meta?: Record<string, unknown>;
}

export interface PushSendResult {
  recipientCount: number;
  successCount: number;
  failCount: number;
  expiredEndpoints: string[];
}

// ════════════════════════════════════════════════════════════════════
// VAPID public key 조회 (SDK가 호출)
// ════════════════════════════════════════════════════════════════════

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// ════════════════════════════════════════════════════════════════════
// 구독 박음 (SDK가 POST /api/cdp/push/subscribe 호출)
// ════════════════════════════════════════════════════════════════════

export interface SaveSubscriptionInput {
  companyId: string;
  customerId?: string | null;
  identityLinkId?: string | null;
  subscription: PushSubscription;
  userAgent?: string;
}

export async function saveSubscription(input: SaveSubscriptionInput): Promise<{ id: string; isNew: boolean }> {
  const { companyId, customerId, identityLinkId, subscription, userAgent } = input;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error('Web Push subscription 형식이 올바르지 않습니다.');
  }

  const result = await query(
    `INSERT INTO cdp_push_subscriptions (
      id, company_id, customer_id, identity_link_id,
      endpoint, p256dh_key, auth_key, user_agent,
      status, subscribed_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid,
      $4, $5, $6, $7,
      'active', NOW(), NOW(), NOW()
    )
    ON CONFLICT (company_id, endpoint) DO UPDATE SET
      customer_id = COALESCE(EXCLUDED.customer_id, cdp_push_subscriptions.customer_id),
      identity_link_id = COALESCE(EXCLUDED.identity_link_id, cdp_push_subscriptions.identity_link_id),
      p256dh_key = EXCLUDED.p256dh_key,
      auth_key = EXCLUDED.auth_key,
      user_agent = COALESCE(EXCLUDED.user_agent, cdp_push_subscriptions.user_agent),
      status = 'active',
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS is_new`,
    [
      companyId,
      customerId || null,
      identityLinkId || null,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      userAgent || null,
    ]
  );

  return { id: result.rows[0].id, isNew: !!result.rows[0].is_new };
}

export async function revokeSubscription(companyId: string, endpoint: string): Promise<void> {
  await query(
    `UPDATE cdp_push_subscriptions SET status = 'revoked', updated_at = NOW()
     WHERE company_id = $1::uuid AND endpoint = $2`,
    [companyId, endpoint]
  );
}

// ════════════════════════════════════════════════════════════════════
// 발송
// ════════════════════════════════════════════════════════════════════

export async function sendPushCampaign(
  companyId: string,
  payload: PushNotificationPayload,
  createdBy: string | null = null
): Promise<{ campaignId: string; result: PushSendResult }> {
  const wp = getWebPush();
  if (!wp || !webPushInitialized) {
    throw new Error('Web Push 발송 환경이 준비되지 않았습니다. VAPID 환경변수 + web-push 라이브러리 설치를 확인해주세요.');
  }
  if (!payload.title || !payload.body) {
    throw new Error('title과 body는 필수입니다.');
  }

  // 1. 캠페인 row 박음
  const campaignRow = await query(
    `INSERT INTO cdp_push_campaigns (
      id, company_id, created_by, title, body, url, icon, badge,
      recipient_count, success_count, fail_count, status, created_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6, $7,
      0, 0, 0, 'sending', NOW()
    ) RETURNING id`,
    [companyId, createdBy, payload.title, payload.body, payload.url || null, payload.icon || null, payload.badge || null]
  );
  const campaignId = campaignRow.rows[0].id;

  // 2. 활성 구독 조회 (회사 단위 격리)
  const subsResult = await query(
    `SELECT id, endpoint, p256dh_key, auth_key
     FROM cdp_push_subscriptions
     WHERE company_id = $1::uuid AND status = 'active'`,
    [companyId]
  );
  const subscriptions = subsResult.rows;

  // 3. Zero-Count 영구 원칙 — 0건이면 발송 차단
  if (subscriptions.length === 0) {
    await query(
      `UPDATE cdp_push_campaigns SET recipient_count = 0, status = 'failed', sent_at = NOW()
       WHERE id = $1::uuid`,
      [campaignId]
    );
    throw new Error('활성 Web Push 구독자가 0건입니다. 발송이 차단되었습니다 — 자사몰에 push 구독 SDK 박은 후 사용자 동의 확보 부탁드립니다.');
  }

  // 4. 발송
  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    icon: payload.icon,
    badge: payload.badge,
  });

  let success = 0;
  let fail = 0;
  const expiredEndpoints: string[] = [];

  // 병렬 발송 (50개씩 batch)
  const batchSize = 50;
  for (let i = 0; i < subscriptions.length; i += batchSize) {
    const batch = subscriptions.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((sub: any) =>
        wp.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
          notificationPayload
        )
      )
    );
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        success++;
      } else {
        fail++;
        const statusCode = (r.reason as any)?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          expiredEndpoints.push(batch[idx].endpoint);
        }
      }
    });
  }

  // 5. 만료된 구독 status 갱신
  if (expiredEndpoints.length > 0) {
    await query(
      `UPDATE cdp_push_subscriptions SET status = 'expired', updated_at = NOW()
       WHERE company_id = $1::uuid AND endpoint = ANY($2::text[])`,
      [companyId, expiredEndpoints]
    );
  }

  // 6. 캠페인 row 갱신
  await query(
    `UPDATE cdp_push_campaigns SET
      recipient_count = $2, success_count = $3, fail_count = $4,
      status = 'completed', sent_at = NOW()
     WHERE id = $1::uuid`,
    [campaignId, subscriptions.length, success, fail]
  );

  // 7. 활성 구독의 last_sent_at 갱신
  void query(
    `UPDATE cdp_push_subscriptions SET last_sent_at = NOW()
     WHERE company_id = $1::uuid AND status = 'active'`,
    [companyId]
  );

  return {
    campaignId,
    result: {
      recipientCount: subscriptions.length,
      successCount: success,
      failCount: fail,
      expiredEndpoints,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// 구독자 수 조회 (PushCampaignsPage)
// ════════════════════════════════════════════════════════════════════

export async function countActiveSubscriptions(companyId: string): Promise<{ active: number; revoked: number; expired: number }> {
  const result = await query(
    `SELECT status, COUNT(*)::int AS cnt
     FROM cdp_push_subscriptions
     WHERE company_id = $1::uuid
     GROUP BY status`,
    [companyId]
  );
  const map: Record<string, number> = { active: 0, revoked: 0, expired: 0 };
  result.rows.forEach((r: any) => { map[r.status] = r.cnt; });
  return { active: map.active || 0, revoked: map.revoked || 0, expired: map.expired || 0 };
}

export async function listPushCampaigns(companyId: string, limit: number = 20): Promise<any[]> {
  const result = await query(
    `SELECT id, title, body, url, recipient_count, success_count, fail_count, status, sent_at, created_at
     FROM cdp_push_campaigns
     WHERE company_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT $2`,
    [companyId, Math.min(limit, 100)]
  );
  return result.rows;
}
