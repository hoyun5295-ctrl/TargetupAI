// ===========================================================================
// utils/campaign-sync-worker.ts — 캠페인 결과 자동 sync 백그라운드 워커
// ---------------------------------------------------------------------------
// ★ D151 (2026-05-11) 신설 — 1년 반복 환불 누락 사고 근본 해결
//
// 사고 패턴:
//   발송 직후 fire-and-forget 1차 sync (Dashboard.tsx:1139 / ResultsModal.tsx:110)
//   → MySQL 결과 일부 박힘 → 일부 환불됨
//   → 그 후 누구도 Dashboard 안 들어가면 sync 0회 → 대기→실패 전환 못 잡음
//   → 추가 환불 트리거 0건 (스킨큐어 5/11: 547건 중 251건만 환불, 293건 누락 영구화)
//
// 해결:
//   매 5분마다 자동 sync — 사용자 화면 진입 무관.
//   syncCampaignResults는 idempotent(target > success+fail 캠페인만 처리)라 중복 호출 안전.
//   prepaidRefund도 D145 P0+ idempotent 패턴 박혀 차액만 환불.
//
// 패턴 기준: utils/auto-campaign-worker.ts / trial-downgrade-worker.ts 의 setInterval 패턴 미러
// ===========================================================================

import { query } from '../config/database';
import { syncCampaignResults } from './campaign-lifecycle';

const INTERVAL_MS = 5 * 60 * 1000; // 5분
const BOOT_DELAY_MS = 60 * 1000;   // 서버 startup 안정화 후 첫 실행

let _timer: NodeJS.Timeout | null = null;
let _boot: NodeJS.Timeout | null = null;
let _running = false;

function log(...args: any[]) {
  console.log('[campaign-sync-worker]', ...args);
}

/**
 * 1회 sync 사이클:
 *   1) 최근 24h 내 pending > 0 (target > success+fail) 캠페인이 있는 회사 ID 추출 (campaigns + campaign_runs)
 *   2) 각 companyId 로 syncCampaignResults 호출 (함수 내부에서 회사별 일괄 처리)
 *   3) syncCount 합계 로깅
 */
async function runOnce(): Promise<void> {
  if (_running) {
    log('이전 실행 진행 중 → skip');
    return;
  }
  _running = true;
  const startedAt = Date.now();
  try {
    const r = await query(`
      SELECT DISTINCT company_id FROM (
        SELECT c.company_id
        FROM campaigns c
        WHERE c.created_at >= NOW() - INTERVAL '24 hours'
          AND c.status IN ('sending', 'scheduled', 'completed')
          AND c.target_count IS NOT NULL
          AND c.target_count > COALESCE(c.success_count, 0) + COALESCE(c.fail_count, 0)
        UNION
        SELECT c.company_id
        FROM campaign_runs cr
        JOIN campaigns c ON c.id = cr.campaign_id
        WHERE cr.created_at >= NOW() - INTERVAL '24 hours'
          AND cr.status IN ('sending', 'scheduled', 'completed')
          AND cr.target_count IS NOT NULL
          AND cr.target_count > COALESCE(cr.success_count, 0) + COALESCE(cr.fail_count, 0)
      ) AS u
    `);

    if (r.rows.length === 0) {
      log('대상 회사 0개 → 종료');
      return;
    }

    log(`대상 회사 ${r.rows.length}개 sync 시작`);
    let okCount = 0;
    let failCount = 0;
    let totalSynced = 0;
    for (const row of r.rows) {
      const companyId = row.company_id;
      try {
        const res = await syncCampaignResults(companyId);
        okCount++;
        totalSynced += res.syncCount || 0;
        if (res.syncCount > 0) {
          log(`✓ companyId=${companyId} synced ${res.syncCount}건`);
        }
      } catch (err: any) {
        failCount++;
        log(`✗ companyId=${companyId} 실패:`, err?.message || err);
      }
    }
    const elapsedMs = Date.now() - startedAt;
    log(`사이클 완료 — 회사 ok ${okCount} / fail ${failCount}, 총 sync ${totalSynced}건, ${elapsedMs}ms`);
  } catch (err: any) {
    log('전체 오류:', err?.message || err);
  } finally {
    _running = false;
  }
}

export function startCampaignSyncWorker(): void {
  if (_timer || _boot) return;
  log(`started — boot ${BOOT_DELAY_MS / 1000}초 후 첫 실행, 이후 ${INTERVAL_MS / 1000}초 주기`);
  _boot = setTimeout(() => {
    _boot = null;
    runOnce();
    _timer = setInterval(runOnce, INTERVAL_MS);
  }, BOOT_DELAY_MS);
}

export function stopCampaignSyncWorker(): void {
  if (_boot) {
    clearTimeout(_boot);
    _boot = null;
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    log('stopped');
  }
}
