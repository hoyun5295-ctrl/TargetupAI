/**
 * ★ CDP Unified Profile 자동 재계산 워커 — 2026-06-10
 *
 * 목적
 *   화면 안내("5분 주기 자동 재계산")와 달리 실제 cron이 없어, 브라우저 SDK(/ingest)로 들어온
 *   이벤트가 customers 통합 컬럼(active_sources / preferred_channel / last_activity_at 등)에
 *   반영되지 않던 결함 정정.
 *   - 5분 주기: 최근 6분 이벤트가 발생한 customer만 recomputeProfile (이벤트 기반 증분)
 *   - 매일 04시(KST): 최근 30일 이벤트가 있는 회사의 30일 카운터(recomputeEventCounters) 재계산
 */

import { query } from '../config/database';
import { recomputeProfile, recomputeEventCounters } from './unified-customer-profile';

const INTERVAL_MS = 5 * 60 * 1000;       // 5분
const INCREMENTAL_LIMIT = 2000;           // 주기당 상한 (밀리면 다음 주기에 이어서)

let running = false;
let lastDailyRunDate = '';                // 'YYYY-MM-DD' (KST) — 일일 카운터 1회 실행 가드

export async function runProfileRecomputePass(): Promise<{ processed: number; failed: number }> {
  // 최근 6분 안 이벤트가 발생한 (회사, 고객) 증분 — received_at은 실측 default now() 컬럼
  const targets = await query(
    `SELECT DISTINCT company_id, customer_id
     FROM cdp_events
     WHERE received_at >= NOW() - INTERVAL '6 minutes'
       AND customer_id IS NOT NULL
     LIMIT $1`,
    [INCREMENTAL_LIMIT]
  );

  let processed = 0;
  let failed = 0;
  for (const row of targets.rows) {
    try {
      await recomputeProfile(row.company_id, row.customer_id);
      processed++;
    } catch (err) {
      failed++;
      console.error('[CDP Profile Worker] recompute 실패:', row.customer_id, err);
    }
  }
  return { processed, failed };
}

async function runDailyCountersIfDue(): Promise<void> {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const kstDate = kstNow.toISOString().slice(0, 10);
  const kstHour = kstNow.getUTCHours();
  if (kstHour !== 4 || lastDailyRunDate === kstDate) return;
  lastDailyRunDate = kstDate;

  const companies = await query(
    `SELECT DISTINCT company_id FROM cdp_events
     WHERE occurred_at > NOW() - INTERVAL '30 days'`
  );
  for (const row of companies.rows) {
    try {
      const r = await recomputeEventCounters(row.company_id);
      console.log(`[CDP Profile Worker] 30일 카운터 재계산 company=${row.company_id} ${r.processed}건`);
    } catch (err) {
      console.error('[CDP Profile Worker] 30일 카운터 재계산 실패:', row.company_id, err);
    }
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runProfileRecomputePass();
    if (result.processed > 0) {
      console.log(`[CDP Profile Worker] 증분 재계산 ${result.processed}건 (실패 ${result.failed})`);
    }
    await runDailyCountersIfDue();
  } catch (err) {
    console.error('[CDP Profile Worker] 주기 실행 오류:', err);
  } finally {
    running = false;
  }
}

export function startCdpProfileRecomputeWorker(): void {
  setInterval(tick, INTERVAL_MS);
  setTimeout(tick, 90 * 1000);
  console.log('[CDP Profile Worker] 워커 시작 (5분 주기 증분 + 매일 04시 30일 카운터)');
}
