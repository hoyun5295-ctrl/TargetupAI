/**
 * cdp-webhook-delivery.ts — 몰 웹훅 1건을 연동된 회사마다 기록·처리 (★ 2026-09-27 한줄로 V2 R098·R244·R188)
 *
 * 옛: 카페24·아임웹·네이버 웹훅 라우트가 몰 ID로 회사를 `LIMIT 1`(정렬 없음)로 골라, 같은 몰이 여러 회사에
 *   연동돼 있으면 이벤트가 임의 한 회사로만 갔다. 세 라우트가 같은 적재·중복·처리·실패 기록을 각자 들고 있었다.
 * 이제: 연동된(그리고 인증된) 회사 전부에 대해 이 CT 하나가 회사별 전달 행을 남기고 처리한다.
 *   - 중복 = (company_id, source, idempotency_key) — 회사마다 따로다(한 회사의 중복이 다른 회사를 막지 않는다).
 *   - 처리 실패 행은 재처리 워커(cdp-webhook-retry-worker)가 같은 규칙(extractWebhookResource)으로 다시 돈다.
 */
import { query } from '../config/database';

export type WebhookSource = 'cafe24' | 'imweb' | 'naver_smart_store';

/**
 * 웹훅 본문 → 처리 대상(resource). 원래 수신 라우트와 재처리 워커가 **같은 규칙**을 쓴다(R188 —
 * 재처리가 `payload.resource || payload`만 봐서 아임웹 실패 웹훅은 재처리해도 같은 모양으로 또 실패했다).
 */
export function extractWebhookResource(source: string, payload: any): any {
  const p = payload || {};
  if (source === 'imweb') return p.data || p.resource || p;
  if (source === 'cafe24') return p.resource || {};
  return p.resource || p;
}

export interface WebhookDeliveryOutcome {
  processed: number;
  duplicate: number;
  failed: number;
}

export async function deliverWebhookToCompanies(opts: {
  source: WebhookSource;
  companyIds: string[];
  event: string;
  idempotencyKey: string;
  payload: any;
  process: (companyId: string) => Promise<void>;
  logTag: string;
}): Promise<WebhookDeliveryOutcome> {
  const outcome: WebhookDeliveryOutcome = { processed: 0, duplicate: 0, failed: 0 };
  const companyIds = Array.from(new Set(opts.companyIds.map((c) => String(c))));
  for (const companyId of companyIds) {
    const insertRes = await query(
      `INSERT INTO cdp_webhook_deliveries (
        id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2, $3, $4, $5::jsonb, 'received', 0, NOW()
      )
      ON CONFLICT (company_id, source, idempotency_key) DO NOTHING
      RETURNING id`,
      [companyId, opts.source, opts.event, opts.idempotencyKey, JSON.stringify(opts.payload || {})],
    );
    if (insertRes.rows.length === 0) {
      // 중복 — 처리 완료 행만 중복 표시(실패 행을 덮으면 재처리 워커 대상에서 빠져 이벤트가 유실된다 · R1-02)
      await query(
        `UPDATE cdp_webhook_deliveries
         SET status = 'duplicate', processed_at = NOW()
         WHERE company_id = $1::uuid AND source = $2 AND idempotency_key = $3
           AND status = 'processed'`,
        [companyId, opts.source, opts.idempotencyKey],
      );
      outcome.duplicate += 1;
      continue;
    }
    const deliveryId = insertRes.rows[0].id;
    try {
      await opts.process(companyId);
      await query(
        `UPDATE cdp_webhook_deliveries SET status = 'processed', processed_at = NOW() WHERE id = $1::uuid`,
        [deliveryId],
      );
      outcome.processed += 1;
    } catch (processErr: any) {
      console.error(`[${opts.logTag} Webhook] 이벤트 처리 실패 (company ${companyId}):`, processErr);
      await query(
        `UPDATE cdp_webhook_deliveries
         SET status = 'failed', error_message = $2, processed_at = NOW()
         WHERE id = $1::uuid`,
        [deliveryId, String(processErr?.message || 'unknown').slice(0, 1000)],
      );
      outcome.failed += 1;
    }
  }
  return outcome;
}
