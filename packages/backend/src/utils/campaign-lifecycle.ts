// utils/campaign-lifecycle.ts
// ★ 메시징 컨트롤타워 — 캠페인 생명주기 관리 (취소 + 결과 동기화)
// 모든 라우트(campaigns.ts, manage-scheduled.ts, admin.ts 등)는
// 이 모듈의 함수를 통해 캠페인 상태를 변경한다.
// sms-queue.ts + prepaid.ts를 import하여 사용.

import { query } from '../config/database';
import {
  getCompanySmsTables, getCompanySmsTablesWithLogs,
  smsCountAll, smsExecAll, smsBatchAggByGroup,
  kakaoCountPending, kakaoCancelPending, kakaoBatchAggByGroup
} from './sms-queue';
import { prepaidRefund } from './prepaid';
import { SUCCESS_CODES, PENDING_CODES } from './sms-result-map';
import { getSourceRef, updateTrainingMetrics } from './training-logger';

// ===== 캠페인 취소 =====

export interface CancelCampaignResult {
  success: boolean;
  error?: string;
  tooLate?: boolean;
  cancelledCount: number;
  refundedAmount: number;
}

/**
 * 캠페인 예약 취소 — MySQL 큐 삭제 + PG 상태 변경 + 선불 환불
 * campaigns.ts와 manage-scheduled.ts 모두 이 함수를 호출한다.
 *
 * @param campaignId - 캠페인 ID
 * @param companyId - 회사 ID
 * @param options.reason - 취소 사유 (optional)
 * @param options.cancelledBy - 취소자 ID (optional)
 * @param options.cancelledByType - 취소자 유형 (optional: 'super_admin' | 'company_admin' | 'company_user')
 * @param options.skipTimeCheck - 15분 이내 체크 스킵 여부 (관리자용)
 */
export async function cancelCampaign(
  campaignId: string,
  companyId: string,
  options: {
    reason?: string;
    cancelledBy?: string;
    cancelledByType?: string;
    skipTimeCheck?: boolean;
  } = {}
): Promise<CancelCampaignResult> {
  const { reason, cancelledBy, cancelledByType, skipTimeCheck = false } = options;

  // 1. 캠페인 확인
  const campaign = await query(
    `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2`,
    [campaignId, companyId]
  );

  if (campaign.rows.length === 0) {
    return { success: false, error: '캠페인을 찾을 수 없습니다', cancelledCount: 0, refundedAmount: 0 };
  }

  const camp = campaign.rows[0];

  // ★ D95: draft 상태도 취소 허용 (회신번호 확인 모달 취소 시 orphan draft 정리)
  if (camp.status !== 'scheduled' && camp.status !== 'draft') {
    return { success: false, error: '취소 가능한 상태가 아닙니다', cancelledCount: 0, refundedAmount: 0 };
  }

  // 2. 15분 이내 체크 (skipTimeCheck가 false이고, 미래 예약인 경우만)
  if (!skipTimeCheck) {
    const scheduledAt = new Date(camp.scheduled_at);
    const now = new Date();
    const diffMinutes = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);
    const isGhostSchedule = scheduledAt < now;
    if (diffMinutes < 15 && diffMinutes > 0) {
      return { success: false, error: '발송 15분 전에는 취소할 수 없습니다', tooLate: true, cancelledCount: 0, refundedAmount: 0 };
    }
  }

  // 3. MySQL 대기 중인 메시지 건수 확인
  const cancelTables = await getCompanySmsTables(companyId);
  const cancelCount = await smsCountAll(cancelTables, 'app_etc1 = ? AND status_code = 100', [campaignId]);
  let kakaoCancelCount = 0;
  try {
    kakaoCancelCount = await kakaoCountPending(campaignId);
  } catch (kakaoErr) {
    console.warn(`[취소] 카카오 대기건 조회 실패 (무시):`, (kakaoErr as Error).message);
  }
  const totalCancelCount = cancelCount + kakaoCancelCount;

  // 4. MySQL 메시지 취소 처리
  // - status_code = 100 (대기): 삭제 (Agent 미픽업 → 환불 대상)
  // - status_code != 100 (Agent 픽업됨): status_code를 9999(취소)로 변경
  const alreadyPickedUp = await smsCountAll(cancelTables, 'app_etc1 = ? AND status_code != 100', [campaignId]);

  await smsExecAll(cancelTables,
    `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
    [campaignId]
  );

  if (alreadyPickedUp > 0) {
    await smsExecAll(cancelTables,
      `UPDATE SMSQ_SEND SET status_code = 9999 WHERE app_etc1 = ? AND status_code NOT IN (${SUCCESS_CODES.join(',')}) AND status_code != 100`,
      [campaignId]
    );
    console.warn(`[취소] campaign ${campaignId}: Agent 픽업된 ${alreadyPickedUp}건 status_code→9999 처리`);
  }

  // 5. 카카오 대기건 삭제
  if (kakaoCancelCount > 0) {
    try { await kakaoCancelPending(campaignId); } catch (kakaoErr) { console.warn(`[취소] 카카오 대기건 삭제 실패 (무시):`, (kakaoErr as Error).message); }
  }

  // 6. 선불 환불
  let totalRefunded = 0;
  if (totalCancelCount > 0) {
    if (cancelCount > 0) {
      const smsRefund = await prepaidRefund(companyId, cancelCount, camp.message_type, campaignId, '예약 취소 환불');
      totalRefunded += smsRefund.refunded;
    }
    if (kakaoCancelCount > 0) {
      const kakaoRefund = await prepaidRefund(companyId, kakaoCancelCount, 'KAKAO', campaignId, '카카오 예약 취소 환불');
      totalRefunded += kakaoRefund.refunded;
    }
  }

  // 7. PostgreSQL 캠페인 상태 변경
  await query(
    `UPDATE campaigns SET
      status = 'cancelled',
      fail_count = COALESCE(target_count, sent_count, 0),
      success_count = 0,
      cancelled_by = $1,
      cancelled_by_type = $2,
      cancel_reason = $3,
      cancelled_at = NOW(),
      updated_at = NOW()
     WHERE id = $4`,
    [cancelledBy || null, cancelledByType || null, reason || null, campaignId]
  );

  // 8. campaign_runs도 cancelled로 변경 (sync-results에서 재처리 방지)
  await query(
    `UPDATE campaign_runs SET
      status = 'cancelled',
      fail_count = COALESCE(target_count, sent_count, 0),
      success_count = 0
     WHERE campaign_id = $1 AND status IN ('scheduled', 'sending')`,
    [campaignId]
  );

  return { success: true, cancelledCount: totalCancelCount, refundedAmount: totalRefunded };
}


// ===== 결과 동기화 =====

export interface SyncResultsOutput {
  syncCount: number;
}

/**
 * MySQL 발송 결과를 PostgreSQL로 동기화
 * campaign_runs(AI 발송) + direct campaigns(직접 발송) 모두 처리
 *
 * @param companyId - 회사 ID (해당 회사의 최근 7일 캠페인만 동기화)
 */
export async function syncCampaignResults(companyId: string): Promise<SyncResultsOutput> {
  let syncCount = 0;
  console.log(`[sync-results] 시작 — companyId: ${companyId}`);

  // === 1. AI 캠페인 (campaign_runs) ===
  const runsResult = await query(
    `SELECT cr.id, cr.campaign_id, c.company_id, c.created_by
     FROM campaign_runs cr
     JOIN campaigns c ON c.id = cr.campaign_id
     WHERE c.company_id = $1
       AND cr.status IN ('sending', 'scheduled')
       AND cr.created_at >= NOW() - INTERVAL '7 days'`,
    [companyId]
  );
  console.log(`[sync-results] AI캠페인 ${runsResult.rows.length}건 대상`);

  // ★ 최적화 — 전체 runs를 1개 UNION ALL GROUP BY로 일괄 집계 (N쿼리 → 1쿼리)
  // 회사/유저 조합별로 테이블 해석 후 배치 집계
  const runsByUser = new Map<string, any[]>();
  for (const run of runsResult.rows) {
    const key = `${run.company_id}::${run.created_by || ''}`;
    if (!runsByUser.has(key)) runsByUser.set(key, []);
    runsByUser.get(key)!.push(run);
  }

  const aggFields = `COUNT(CASE WHEN status_code IN (${SUCCESS_CODES.join(',')}) THEN 1 END) as success_count,
     COUNT(CASE WHEN status_code NOT IN (${[...SUCCESS_CODES, ...PENDING_CODES].join(',')}) THEN 1 END) as fail_count,
     COUNT(CASE WHEN status_code IN (${PENDING_CODES.join(',')}) THEN 1 END) as pending_count`;

  const smsAggMap = new Map<string, Record<string, number>>();
  for (const [key, runs] of runsByUser) {
    const [cid, uid] = key.split('::');
    const runTables = await getCompanySmsTablesWithLogs(cid, uid || undefined);
    const ids = runs.map(r => r.campaign_id);
    const partial = await smsBatchAggByGroup(runTables, 'app_etc1', aggFields, ids);
    for (const [g, v] of partial) smsAggMap.set(g, v);
  }

  // 카카오는 단일 테이블이므로 한 번에 배치 집계
  const allRunIds: string[] = runsResult.rows.map((r: any) => r.campaign_id);
  const kakaoAggMap = await kakaoBatchAggByGroup(allRunIds);

  for (const run of runsResult.rows) {
    try {
      const smsAgg = smsAggMap.get(run.campaign_id) || {};
      const kakaoResult = kakaoAggMap.get(run.campaign_id) || { total: 0, success: 0, fail: 0, pending: 0 };

      const successCount = (smsAgg.success_count || 0) + kakaoResult.success;
      const failCount = (smsAgg.fail_count || 0) + kakaoResult.fail;
      const pendingCount = (smsAgg.pending_count || 0) + kakaoResult.pending;
      console.log(`[sync-results] AI run ${run.id} — success:${successCount}, fail:${failCount}, pending:${pendingCount}`);

      // 타임아웃 체크: 발송 후 30분 경과 + pending만 남아있으면 강제 완료
      const campTimeInfo = await query('SELECT sent_at, scheduled_at, created_at FROM campaigns WHERE id = $1', [run.campaign_id]);
      const campSentAt = campTimeInfo.rows[0]?.sent_at || campTimeInfo.rows[0]?.scheduled_at || campTimeInfo.rows[0]?.created_at;
      const minutesSinceSend = campSentAt ? (Date.now() - new Date(campSentAt).getTime()) / (1000 * 60) : 0;
      const isTimedOut = minutesSinceSend > 30 && pendingCount > 0 && successCount === 0 && failCount === 0;

      if (successCount > 0 || failCount > 0 || isTimedOut) {
        const effectiveFailCount = isTimedOut ? failCount + pendingCount : failCount;
        const effectivePendingCount = isTimedOut ? 0 : pendingCount;
        const newStatus = effectivePendingCount > 0 ? 'sending' : ((successCount + effectiveFailCount) > 0 ? 'completed' : 'failed');
        if (isTimedOut) {
          console.warn(`[sync-results] campaign_run ${run.id}: 30분 타임아웃 — pending ${pendingCount}건 → fail 처리`);
        }

        // campaign_runs 업데이트
        await query(
          `UPDATE campaign_runs SET
            success_count = $1,
            fail_count = $2,
            status = $3::text,
            sent_at = CASE WHEN $3::text = 'completed' AND sent_at IS NULL
              THEN COALESCE(scheduled_at, NOW())
              ELSE sent_at END
           WHERE id = $4`,
          [successCount, effectiveFailCount, newStatus, run.id]
        );

        // campaigns 테이블도 업데이트
        const runInfo = await query(`SELECT campaign_id FROM campaign_runs WHERE id = $1`, [run.id]);
        if (runInfo.rows.length > 0) {
          await query(
            `UPDATE campaigns SET
              success_count = $1,
              fail_count = $2,
              status = $3::text,
              sent_at = CASE WHEN $3::text = 'completed' AND sent_at IS NULL
                THEN COALESCE(scheduled_at, NOW())
                ELSE sent_at END
             WHERE id = $4`,
            [successCount, effectiveFailCount, newStatus, runInfo.rows[0].campaign_id]
          );

          // 선불 실패건 환불
          if (effectiveFailCount > 0) {
            const campInfo = await query('SELECT company_id, message_type FROM campaigns WHERE id = $1', [runInfo.rows[0].campaign_id]);
            if (campInfo.rows.length > 0) {
              await prepaidRefund(campInfo.rows[0].company_id, effectiveFailCount, campInfo.rows[0].message_type, runInfo.rows[0].campaign_id, isTimedOut ? '타임아웃 실패 환불' : '발송 실패 환불');
            }
          }

          // ★ D114 P8-3: auto_campaign_runs 연동 — 실제 전송 결과 반영
          try {
            await query(
              `UPDATE auto_campaign_runs SET
                success_count = $1, fail_count = $2
               WHERE campaign_id = $3`,
              [successCount, effectiveFailCount, runInfo.rows[0].campaign_id]
            );
          } catch (acrErr) {
            // auto_campaign_runs에 해당 campaign_id가 없을 수 있음 (일반 캠페인)
          }
        }

        // AI 학습 성과 데이터 업데이트
        updateTrainingMetrics({
          sourceRef: getSourceRef(run.id),
          sentCount: successCount + effectiveFailCount,
          successCount,
          failCount,
        });

        syncCount++;
      }
    } catch (runErr: any) {
      console.error(`[sync-results] AI run ${run.id} 처리 에러:`, runErr.message);
    }
  }

  // === 2. 직접발송 캠페인 ===
  const directCampaigns = await query(
    `SELECT id, company_id, scheduled_at, created_at, sent_at, created_by FROM campaigns
     WHERE company_id = $1 AND send_type = 'direct'
       AND (status IN ('sending', 'completed') OR (status = 'scheduled' AND scheduled_at <= NOW()))
       AND (success_count IS NULL OR success_count = 0)
       AND created_at >= NOW() - INTERVAL '7 days'`,
    [companyId]
  );

  // ★ 최적화 — 직접발송도 배치 집계 (회사/유저 조합별 테이블 → UNION ALL GROUP BY)
  const directByUser = new Map<string, any[]>();
  for (const c of directCampaigns.rows) {
    const key = `${c.company_id}::${c.created_by || ''}`;
    if (!directByUser.has(key)) directByUser.set(key, []);
    directByUser.get(key)!.push(c);
  }
  const directAggFields = `COUNT(*) as total_count,
     COUNT(CASE WHEN status_code IN (${SUCCESS_CODES.join(',')}) THEN 1 END) as success_count,
     COUNT(CASE WHEN status_code NOT IN (${[...SUCCESS_CODES, ...PENDING_CODES].join(',')}) THEN 1 END) as fail_count,
     COUNT(CASE WHEN status_code IN (${PENDING_CODES.join(',')}) THEN 1 END) as pending_count`;

  const directSmsAggMap = new Map<string, Record<string, number>>();
  for (const [key, camps] of directByUser) {
    const [cid, uid] = key.split('::');
    const directTables = await getCompanySmsTablesWithLogs(cid, uid || undefined);
    const ids = camps.map(c => c.id);
    const partial = await smsBatchAggByGroup(directTables, 'app_etc1', directAggFields, ids);
    for (const [g, v] of partial) directSmsAggMap.set(g, v);
  }
  const allDirectIds: string[] = directCampaigns.rows.map((c: any) => c.id);
  const directKakaoAggMap = await kakaoBatchAggByGroup(allDirectIds);

  for (const campaign of directCampaigns.rows) {
    try {
      const smsDirectAgg = directSmsAggMap.get(campaign.id) || {};
      const kakaoDirectResult = directKakaoAggMap.get(campaign.id) || { total: 0, success: 0, fail: 0, pending: 0 };

      const successCount = (smsDirectAgg.success_count || 0) + kakaoDirectResult.success;
      const failCount = (smsDirectAgg.fail_count || 0) + kakaoDirectResult.fail;
      const pendingCount = (smsDirectAgg.pending_count || 0) + kakaoDirectResult.pending;
      console.log(`[sync-results] direct campaign ${campaign.id} — success:${successCount}, fail:${failCount}, pending:${pendingCount}`);

      // 직접발송 타임아웃: 30분 경과 + pending만 남아있으면 강제 완료
      // ★ sent_at → scheduled_at → created_at 우선순위 (AI캠페인과 동일 패턴)
      const directSentAt = campaign.sent_at || campaign.scheduled_at || campaign.created_at;
      const directMinutesSince = directSentAt ? (Date.now() - new Date(directSentAt).getTime()) / (1000 * 60) : 0;
      const directTimedOut = directMinutesSince > 30 && pendingCount > 0 && successCount === 0 && failCount === 0;

      if (successCount > 0 || failCount > 0 || directTimedOut) {
        const dEffectiveFailCount = directTimedOut ? failCount + pendingCount : failCount;
        const dEffectivePendingCount = directTimedOut ? 0 : pendingCount;
        const newStatus = dEffectivePendingCount === 0
          ? ((successCount + dEffectiveFailCount) > 0 ? 'completed' : 'failed')
          : (directTimedOut ? 'completed' : 'sending');
        if (directTimedOut) {
          console.warn(`[sync-results] direct campaign ${campaign.id}: 30분 타임아웃 — pending ${pendingCount}건 → fail 처리`);
        }

        await query(
          `UPDATE campaigns SET
            success_count = $1,
            fail_count = $2,
            status = $3::text,
            sent_at = CASE WHEN $3::text = 'completed' AND sent_at IS NULL
              THEN COALESCE(scheduled_at, NOW())
              ELSE sent_at END
           WHERE id = $4`,
          [successCount, dEffectiveFailCount, newStatus, campaign.id]
        );

        // 선불 실패건 환불
        if (dEffectiveFailCount > 0) {
          const campInfo = await query('SELECT company_id, message_type FROM campaigns WHERE id = $1', [campaign.id]);
          if (campInfo.rows.length > 0) {
            await prepaidRefund(campInfo.rows[0].company_id, dEffectiveFailCount, campInfo.rows[0].message_type, campaign.id, directTimedOut ? '타임아웃 실패 환불' : '발송 실패 환불');
          }
        }

        // AI 학습 성과 데이터 업데이트 (직접발송)
        updateTrainingMetrics({
          sourceRef: getSourceRef(campaign.id),
          sentCount: successCount + dEffectiveFailCount,
          successCount,
          failCount,
        });

        syncCount++;
      }
    } catch (campErr: any) {
      console.error(`[sync-results] direct campaign ${campaign.id} 처리 에러:`, campErr.message);
    }
  }

  return { syncCount };
}
