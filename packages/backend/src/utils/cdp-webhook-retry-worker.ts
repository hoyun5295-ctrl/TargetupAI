/**
 * ★ CDP Webhook 실패 재처리 워커 — 2026-06-10
 *
 * 목적
 *   cdp_webhook_deliveries.status='failed' 건을 5분 주기로 재처리.
 *   - 이전에는 retry_count 컬럼만 있고 워커가 없어 일시 오류(DB 순단 등)로 failed가 된
 *     자사몰 데이터가 그대로 유실됐다. (카페24 실패 응답 문구의 "재처리 예약" 약속도 미이행 상태였음)
 *   - 최대 3회 재시도. 3회 실패 건은 failed로 남겨 운영 확인 대상.
 *
 * 부수 정리 (같은 주기)
 *   - 카페24 OAuth state 행(webhook_event='oauth_state')의 1시간 경과 잔존분 삭제
 *   - 30일 경과 payload NULL 처리 (SCHEMA.md의 "payload 30일 후 NULL" 규약 이행)
 */

import { query } from '../config/database';
import { getProvider } from './provider-registry';

const RETRY_INTERVAL_MS = 5 * 60 * 1000;   // 5분
const MAX_RETRY = 3;
const BATCH_LIMIT = 50;

let running = false;

export async function runCdpWebhookRetryPass(): Promise<{ retried: number; succeeded: number }> {
  let retried = 0;
  let succeeded = 0;

  const failedRows = await query(
    `SELECT id, company_id, source, webhook_event, payload, retry_count
     FROM cdp_webhook_deliveries
     WHERE status = 'failed'
       AND retry_count < $1
       AND webhook_event != 'oauth_state'
       AND created_at > NOW() - INTERVAL '7 days'
     ORDER BY created_at ASC
     LIMIT $2`,
    [MAX_RETRY, BATCH_LIMIT]
  );

  for (const row of failedRows.rows) {
    const adapter = getProvider(row.source);
    if (!adapter) {
      // 어댑터 미등록 source — 재시도 무의미, 카운트만 올려 종결 수렴
      await query(
        `UPDATE cdp_webhook_deliveries
         SET retry_count = retry_count + 1, error_message = $2, processed_at = NOW()
         WHERE id = $1::uuid`,
        [row.id, `재처리 불가 — 미등록 source: ${row.source}`]
      );
      continue;
    }

    retried++;
    const payload = row.payload || {};
    const resource = payload.resource || payload;
    try {
      await adapter.processWebhookEvent(row.company_id, row.webhook_event, resource);
      await query(
        `UPDATE cdp_webhook_deliveries
         SET status = 'processed', processed_at = NOW()
         WHERE id = $1::uuid`,
        [row.id]
      );
      succeeded++;
    } catch (err: any) {
      await query(
        `UPDATE cdp_webhook_deliveries
         SET retry_count = retry_count + 1,
             error_message = $2,
             processed_at = NOW()
         WHERE id = $1::uuid`,
        [row.id, String(err?.message || 'unknown').slice(0, 1000)]
      );
    }
  }

  return { retried, succeeded };
}

async function runHousekeeping(): Promise<void> {
  // 카페24 OAuth state 잔존행 정리 (callback 미도달로 남은 것 — TTL 10분이라 1시간이면 확실히 만료)
  await query(
    `DELETE FROM cdp_webhook_deliveries
     WHERE webhook_event = 'oauth_state' AND created_at < NOW() - INTERVAL '1 hour'`
  );
  // 30일 경과 payload NULL (한 번에 500건씩 — 큰 일괄 UPDATE 차단)
  await query(
    `UPDATE cdp_webhook_deliveries SET payload = NULL
     WHERE id IN (
       SELECT id FROM cdp_webhook_deliveries
       WHERE payload IS NOT NULL AND created_at < NOW() - INTERVAL '30 days'
       LIMIT 500
     )`
  );
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runCdpWebhookRetryPass();
    if (result.retried > 0) {
      console.log(`[CDP Webhook Retry] 재처리 ${result.retried}건 중 ${result.succeeded}건 복구`);
    }
    await runHousekeeping();
  } catch (err) {
    console.error('[CDP Webhook Retry] 주기 실행 오류:', err);
  } finally {
    running = false;
  }
}

export function startCdpWebhookRetryWorker(): void {
  setInterval(tick, RETRY_INTERVAL_MS);
  // 기동 1분 후 첫 실행 (부팅 직후 DB 워밍업과 겹침 방지)
  setTimeout(tick, 60 * 1000);
  console.log('[CDP Webhook Retry] 워커 시작 (5분 주기, 최대 3회 재시도)');
}
