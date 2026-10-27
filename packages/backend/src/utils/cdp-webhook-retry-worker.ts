/**
 * ★ CDP Webhook 실패 재처리 워커 — 2026-06-10 (★ 2026-10-27 자사몰 대비 K2-6 = 선점 문장 하나 · 나이 제한 삭제 · 적체 경보)
 *
 * 목적
 *   cdp_webhook_deliveries.status='failed' 건(과 멈춘 received)을 5분 주기로 재처리.
 *   - 이전에는 retry_count 컬럼만 있고 워커가 없어 일시 오류(DB 순단 등)로 failed가 된
 *     자사몰 데이터가 그대로 유실됐다. (카페24 실패 응답 문구의 "재처리 예약" 약속도 미이행 상태였음)
 *   - 최대 3회 재시도. 3회 실패 건은 failed로 남겨 운영 확인 대상.
 *
 * 부수 정리 (같은 주기)
 *   - 카페24 OAuth state 행(webhook_event='oauth_state')의 1시간 경과 잔존분 삭제
 *   - 30일 경과 payload NULL 처리 (SCHEMA.md의 "payload 30일 후 NULL" 규약 이행)
 */

import { query } from '../config/database';
import { LOG_RETENTION_DAYS } from '../config/defaults';
import { claimDeliveries, processClaimedDelivery, WEBHOOK_MAX_RETRY } from './cdp-webhook-delivery';
// ★ 2026-10-04 재처리 소진 알림(전수점검 W1)
import { sendSystemAlert } from './system-alert';

const RETRY_INTERVAL_MS = 5 * 60 * 1000;   // 5분
const BATCH_LIMIT = 50;
/** 한 회차 배출 시간 상한 — 다음 회차(5분)와 겹치지 않게 */
const PASS_BUDGET_MS = 4 * 60 * 1000;

let running = false;

/**
 * ★ 2026-10-27 자사몰 대비 K2-6 — 선점 문장(claimDeliveries)이 0 을 돌려줄 때까지 묶음으로 배출한다(회차 상한 4분).
 *   옛: SELECT 로 고른 뒤 처리(수신 줄과 같은 행을 동시에 처리할 수 있었고, 7일 지난 received 를 버렸고, 한 회차 50건에서 멈췄다).
 *   선점이 processed_at 을 지금으로 쓰므로 이 회차에서 실패한 행은 같은 회차 다음 묶음에 다시 걸리지 않는다.
 */
export async function runCdpWebhookRetryPass(nowMs: () => number = Date.now): Promise<{ retried: number; succeeded: number }> {
  let retried = 0;
  let succeeded = 0;
  const until = nowMs() + PASS_BUDGET_MS;
  while (nowMs() < until) {
    const rows = await claimDeliveries({ limit: BATCH_LIMIT });
    if (rows.length === 0) break;
    for (const row of rows) {
      retried++;
      const status = await processClaimedDelivery(row, true);
      if (status !== 'failed') succeeded++;
    }
  }

  // ★ 2026-10-04 재처리를 다 쓰고도 실패한 몰 웹훅이 있으면 알린다.
  //   ★ 1027 K2-6 — 생성 시각이 아니라 **소진으로 바뀐 시각**(마지막 시도 processed_at)으로 센다(나이 제한을 지운 뒤 다시 집힌 옛 행의 소진도 잡힘).
  try {
    const exhausted = await query(
      `SELECT COUNT(*)::int AS n FROM cdp_webhook_deliveries
        WHERE status = 'failed' AND retry_count >= $1 AND webhook_event != 'oauth_state'
          AND processed_at > NOW() - INTERVAL '1 day'`,
      [WEBHOOK_MAX_RETRY]
    );
    const n = Number(exhausted.rows[0]?.n || 0);
    if (n > 0) {
      await sendSystemAlert({
        dedupKey: 'cdp-webhook-exhausted',
        cooldownMs: 12 * 60 * 60 * 1000,
        title: '자사몰 웹훅이 재처리를 다 쓰고도 실패했습니다.',
        details: [`최근 하루: ${n}건`],
        action: '자사몰 연동 웹훅 기록의 실패 사유를 확인해 주세요.',
      });
    }
  } catch (err: any) {
    console.error('[CDP Webhook Retry] 소진 알림 확인 실패:', err?.message || err);
  }

  // ★ 1027 K2-6 적체 경보 — 30분 넘게 처리되지 않은 received 행(줄 · 워커가 따라가지 못함)
  try {
    const backlog = await query(
      `SELECT COUNT(*)::int AS n, MIN(created_at) AS oldest FROM cdp_webhook_deliveries
        WHERE status = 'received' AND webhook_event != 'oauth_state'
          AND created_at < NOW() - INTERVAL '30 minutes'`
    );
    const n = Number(backlog.rows[0]?.n || 0);
    if (n > 0) {
      await sendSystemAlert({
        dedupKey: 'cdp-webhook-backlog',
        cooldownMs: 6 * 60 * 60 * 1000,
        title: '자사몰 웹훅이 30분 넘게 처리되지 않고 쌓여 있습니다.',
        details: [`대기: ${n}건`, `가장 오래된 수신: ${new Date(backlog.rows[0].oldest).toISOString()}`],
        action: '백엔드 로그에서 자사몰 웹훅 처리 오류를 확인해 주세요.',
      });
    }
  } catch (err: any) {
    console.error('[CDP Webhook Retry] 적체 알림 확인 실패:', err?.message || err);
  }

  return { retried, succeeded };
}

export async function runCdpWebhookHousekeeping(): Promise<void> {
  // 카페24 OAuth state 잔존행 정리 (callback 미도달로 남은 것 — TTL 10분이라 1시간이면 확실히 만료)
  await query(
    `DELETE FROM cdp_webhook_deliveries
     WHERE webhook_event = 'oauth_state' AND created_at < NOW() - INTERVAL '1 hour'`
  );
  // ★ 2026-09-27 한줄로 V2 R187 — 처리 끝난(processed·duplicate) 기록은 보관 기한 뒤 지운다(한 번에 1000건).
  //   옛: 지우지 않아 5분마다 훑는 이 표가 계속 커졌다. 실패 기록(재처리 대상·감사)은 남긴다.
  // ★ 2026-09-28 한줄로 V2(Harold 지적) — 180일 → LOG_RETENTION_DAYS(13개월). 외부 몰 수신 기록은 API 로그라
  //   전송자격인증 4.2 "1년 이상 보관" 대상이다(180일이면 요건 위반). payload 30일 비움(아래)은 개인정보 최소화라 그대로.
  // ★ 2026-10-27 K2-6 — superseded(옛 스냅숏이라 쓰지 않음)도 끝난 행이다(넣지 않으면 영구히 남는다).
  await query(
    `DELETE FROM cdp_webhook_deliveries
     WHERE id IN (
       SELECT id FROM cdp_webhook_deliveries
       WHERE status IN ('processed', 'duplicate', 'superseded') AND created_at < NOW() - make_interval(days => $1)
       LIMIT 1000
     )`,
    [LOG_RETENTION_DAYS],
  );
  // 30일 경과 payload NULL (한 번에 500건씩 — 큰 일괄 UPDATE 차단)
  // ★ 2026-10-27 K2-6 — 끝난 행만 · 기준 = 끝난(마지막 시도) 뒤 30일. 아직 처리 못 한 행의 원문은 유일한 사본이라 비우지 않는다.
  await query(
    `UPDATE cdp_webhook_deliveries SET payload = NULL
     WHERE id IN (
       SELECT id FROM cdp_webhook_deliveries
       WHERE payload IS NOT NULL
         AND (status IN ('processed', 'duplicate', 'superseded') OR (status = 'failed' AND retry_count >= $1))
         AND COALESCE(processed_at, created_at) < NOW() - INTERVAL '30 days'
       LIMIT 500
     )`,
    [WEBHOOK_MAX_RETRY],
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
    await runCdpWebhookHousekeeping();
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
