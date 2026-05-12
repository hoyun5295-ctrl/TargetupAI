// ===========================================================================
// utils/mysql-refund-sweeper.ts — MySQL 진실 원천 환불 sweep 워커
// ---------------------------------------------------------------------------
// ★ D153 (2026-05-13) 신설 — 환불 누락 뿌리뽑기
//
// 사고 패턴 (D151-2 cron 박혔는데도 재발):
//   campaign-sync-worker → syncCampaignResults 흐름이 매 5분 호출되지만
//   directCampaigns SELECT 결과에 일부 캠페인이 누락되어 PG fail_count 갱신 0회
//   → prepaidRefund 호출 0회 → 환불 영구 누락
//   (스킨큐어 5/11 f6a0/2f77: MySQL fail=1,199 vs PG fail=566 / 633건 영구 누락 사고)
//
// 해결 (이 워커):
//   PG fail_count 의존 0% — status + 14d 윈도우 + billing_type='prepaid'만 후보
//   balance_transactions 환불 누적이 진실 원천 회계 (prepaidRefund idempotent 가드가 비교)
//   MySQL status_code별 GROUP BY → 실제 fail count → prepaidRefund(누적 fail) idempotent 호출
//   차액 자동 환불 + PG fail_count/success_count 동시 갱신 (화면 정합 보조)
//
// 차별점 (기존 campaign-sync-worker D151-2):
//   기존: cron 24h 윈도우 + syncCampaignResults `target_count > success_count + fail_count` (PG fail 의존)
//   신규: 14d 윈도우 + status만 (PG fail 무관) + balance_transactions 회계 진실
//
// 패턴 기준: utils/campaign-sync-worker.ts (D151-2 setInterval) + utils/auto-campaign-worker.ts 미러
// ===========================================================================

import { query } from '../config/database';
import { getCompanySmsTablesWithLogs, smsBatchAggByGroup, kakaoBatchAggByGroup } from './sms-queue';
import { SUCCESS_CODES, PENDING_CODES } from './sms-result-map';
import { prepaidRefund } from './prepaid';

const INTERVAL_MS = 60 * 1000;     // 1분 — Harold님 명시 (D153 5/13): 5분은 짜치고 부하 미미(336 candidates / 17 user_groups / 1.5초/사이클 / 2.5% 점유)
const BOOT_DELAY_MS = 90 * 1000;   // campaign-sync-worker(60초)와 시작 시점 차이 둠

let _timer: NodeJS.Timeout | null = null;
let _boot: NodeJS.Timeout | null = null;
let _running = false;

function log(...args: any[]) {
  console.log('[mysql-refund-sweeper]', ...args);
}

interface CampaignRow {
  id: string;
  company_id: string;
  created_by: string | null;
  message_type: string;
  success_count: number | null;
  fail_count: number | null;
}

/**
 * 1회 sweep 사이클:
 *  1) prepaid 회사 + 14일 내 발송 캠페인 후보 SELECT (PG fail 무관)
 *  2) 회사/유저 그룹별 MySQL 배치 집계 (UNION ALL GROUP BY 효율)
 *  3) 캠페인별 처리:
 *     - PG success/fail_count != MySQL 이면 UPDATE (화면 정합 보조)
 *     - MySQL fail > 0 이면 prepaidRefund(누적 fail) idempotent 호출 → 차액 환불
 *
 * idempotency 보장:
 *   prepaidRefund 내부 가드가 balance_transactions refund 누적과 비교해 차액만 환불.
 *   이미 충분히 환불됐으면 refunded=0 반환. 같은 캠페인 반복 호출해도 추가 차감/환불 0%.
 */
async function runOnce(): Promise<void> {
  if (_running) {
    log('이전 실행 진행 중 → skip');
    return;
  }
  _running = true;
  const startedAt = Date.now();

  try {
    // === 1. 후보 캠페인 SELECT (PG fail_count 무관) ===
    const candidates = await query(`
      SELECT c.id, c.company_id, c.created_by, c.message_type,
             c.success_count, c.fail_count
      FROM campaigns c
      JOIN companies co ON co.id = c.company_id
      WHERE co.billing_type = 'prepaid'
        AND c.status IN ('sending', 'completed')
        AND c.message_type IS NOT NULL
        AND c.created_at >= NOW() - INTERVAL '14 days'
      ORDER BY c.created_at DESC
    `);

    if (candidates.rows.length === 0) {
      log('후보 캠페인 0건 → 종료');
      return;
    }

    // === 2. 회사/유저 조합별 그룹화 ===
    const byUserKey = new Map<string, CampaignRow[]>();
    for (const c of candidates.rows as CampaignRow[]) {
      const key = `${c.company_id}::${c.created_by || ''}`;
      if (!byUserKey.has(key)) byUserKey.set(key, []);
      byUserKey.get(key)!.push(c);
    }

    // === 3. 회사/유저별 MySQL 배치 집계 ===
    const aggFields = `COUNT(CASE WHEN status_code IN (${SUCCESS_CODES.join(',')}) THEN 1 END) as success_count,
       COUNT(CASE WHEN status_code NOT IN (${[...SUCCESS_CODES, ...PENDING_CODES].join(',')}) THEN 1 END) as fail_count,
       COUNT(CASE WHEN status_code IN (${PENDING_CODES.join(',')}) THEN 1 END) as pending_count`;

    const smsAggMap = new Map<string, Record<string, number>>();
    for (const [key, camps] of byUserKey) {
      const [cid, uid] = key.split('::');
      const tables = await getCompanySmsTablesWithLogs(cid, uid || undefined);
      const ids = camps.map(c => c.id);
      const partial = await smsBatchAggByGroup(tables, 'app_etc1', aggFields, ids);
      for (const [g, v] of partial) smsAggMap.set(g, v);
    }

    // 카카오 배치 집계 (단일 테이블)
    const allIds = (candidates.rows as CampaignRow[]).map(c => c.id);
    const kakaoAggMap = await kakaoBatchAggByGroup(allIds);

    // === 4. 캠페인별 sweep ===
    let pgUpdateCount = 0;
    let refundCount = 0;
    let totalRefundAmount = 0;

    for (const camp of candidates.rows as CampaignRow[]) {
      try {
        const smsAgg = smsAggMap.get(camp.id) || {};
        const kakaoAgg = kakaoAggMap.get(camp.id) || { total: 0, success: 0, fail: 0, pending: 0 };

        const mysqlSuccess = Number(smsAgg.success_count || 0) + kakaoAgg.success;
        const mysqlFail = Number(smsAgg.fail_count || 0) + kakaoAgg.fail;
        // pending은 환불 대상 아님 — 통신사 처리 대기 중

        // MySQL 결과가 0/0이면 (아직 발송 안 시작 or 모두 pending) skip
        if (mysqlSuccess === 0 && mysqlFail === 0) continue;

        // === 4-1. PG count 동시 갱신 (화면 정합 보조) ===
        // target_count는 절대 건드리지 않음 (protect_completed_target_count trigger 호환)
        const pgSuccess = Number(camp.success_count || 0);
        const pgFail = Number(camp.fail_count || 0);
        if (pgSuccess !== mysqlSuccess || pgFail !== mysqlFail) {
          await query(
            `UPDATE campaigns
               SET success_count = $1,
                   fail_count = $2,
                   sent_count = $1::int + $2::int,
                   updated_at = NOW()
             WHERE id = $3 AND status IN ('sending', 'completed')`,
            [mysqlSuccess, mysqlFail, camp.id]
          );
          pgUpdateCount++;
        }

        // === 4-2. 환불 호출 (idempotent — 차액만 환불) ===
        if (mysqlFail > 0) {
          const r = await prepaidRefund(camp.company_id, mysqlFail, camp.message_type, camp.id, '발송 실패 환불 (sweep)');
          if (r.refunded > 0) {
            refundCount++;
            totalRefundAmount += r.refunded;
            log(`✓ campaign=${camp.id} ${camp.message_type} mysqlFail=${mysqlFail} 차액환불 ${r.refunded}원`);
          }
        }
      } catch (campErr: any) {
        log(`✗ campaign=${camp.id} 처리 에러:`, campErr?.message || campErr);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    if (pgUpdateCount > 0 || refundCount > 0) {
      log(`사이클 완료 — 후보 ${candidates.rows.length} / PG 갱신 ${pgUpdateCount} / 환불 ${refundCount}건 ${totalRefundAmount}원 / ${elapsedMs}ms`);
    }
  } catch (err: any) {
    log('전체 오류:', err?.message || err);
  } finally {
    _running = false;
  }
}

export function startMysqlRefundSweeper(): void {
  if (_timer || _boot) return;
  log(`started — boot ${BOOT_DELAY_MS / 1000}초 후 첫 실행, 이후 ${INTERVAL_MS / 1000}초 주기`);
  _boot = setTimeout(() => {
    _boot = null;
    runOnce();
    _timer = setInterval(runOnce, INTERVAL_MS);
  }, BOOT_DELAY_MS);
}

export function stopMysqlRefundSweeper(): void {
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
