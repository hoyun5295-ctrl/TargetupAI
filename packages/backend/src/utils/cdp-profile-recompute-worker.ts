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
import { decayInactiveCounters } from './customer-cdp-fusion';

const INTERVAL_MS = 5 * 60 * 1000;       // 5분
const INCREMENTAL_LIMIT = 2000;           // 주기당 상한 (밀리면 다음 주기에 이어서)

let running = false;
let lastDailyRunDate = '';                // 'YYYY-MM-DD' (KST) — 일일 카운터 1회 실행 가드
// ★ 2026-09-27 한줄로 V2 R382 — 다음 증분의 시작점(프로세스 기억 · 첫 주기 = 6분 전).
//   옛: 매 주기 '최근 6분' LIMIT 2000이라 2천 명을 넘으면 남은 고객이 다음 주기 창에서 빠졌다(주석의 '다음 주기에 이어서'가 안 됐다).
let incrementalSince: Date | null = null;

export async function runProfileRecomputePass(): Promise<{ processed: number; failed: number }> {
  const passStartedAt = new Date();
  const since = incrementalSince || new Date(passStartedAt.getTime() - 6 * 60 * 1000);
  // 시작점 이후 이벤트가 난 (회사, 고객) — 마지막 이벤트 시각이 이른 순. received_at은 실측 default now() 컬럼
  const targets = await query(
    `SELECT company_id, customer_id, MAX(received_at) AS last_at
     FROM cdp_events
     WHERE received_at >= $1
       AND customer_id IS NOT NULL
     GROUP BY company_id, customer_id
     ORDER BY MAX(received_at) ASC
     LIMIT $2`,
    [since, INCREMENTAL_LIMIT]
  );
  // 잘렸으면 처리한 마지막 시각부터 이어서(같은 시각은 다시 봐도 재계산은 멱등) · 다 봤으면 이번 시작 1분 전부터(늦게 커밋된 행 보정)
  incrementalSince = targets.rows.length >= INCREMENTAL_LIMIT
    ? new Date(targets.rows[targets.rows.length - 1].last_at)
    : new Date(passStartedAt.getTime() - 60 * 1000);

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

  // ★ 2026-09-27 한줄로 V2 R186 — 60일 창(30일 넘게 이벤트가 끊긴 회사도 한 번은 감쇠가 돈다) + 감쇠 함수를 실제로 부른다.
  //   옛: 감쇠(decayInactiveCounters)를 부르는 곳이 없어 오래전에 담은 고객이 인앱 세그먼트에 계속 들었다.
  const companies = await query(
    `SELECT DISTINCT company_id FROM cdp_events
     WHERE occurred_at > NOW() - INTERVAL '60 days'`
  );
  for (const row of companies.rows) {
    try {
      const r = await recomputeEventCounters(row.company_id);
      console.log(`[CDP Profile Worker] 30일 카운터 재계산 company=${row.company_id} ${r.processed}건`);
    } catch (err) {
      console.error('[CDP Profile Worker] 30일 카운터 재계산 실패:', row.company_id, err);
    }
    try {
      const d = await decayInactiveCounters(row.company_id);
      if (d.processed > 0) console.log(`[CDP Profile Worker] 30일 카운터 감쇠 company=${row.company_id} ${d.processed}건`);
    } catch (err) {
      console.error('[CDP Profile Worker] 30일 카운터 감쇠 실패:', row.company_id, err);
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
