// utils/campaign-lifecycle.ts
// ★ 메시징 컨트롤타워 — 캠페인 생명주기 관리 (취소 + 결과 동기화)
// 모든 라우트(campaigns.ts, manage-scheduled.ts, admin.ts 등)는
// 이 모듈의 함수를 통해 캠페인 상태를 변경한다.
// sms-queue.ts + prepaid.ts를 import하여 사용.

import { query } from '../config/database';
import {
  getCompanySmsTablesWithLogs, getCampaignQueueTables,
  smsCountAll, smsExecAll, smsCampaignCountsSafe,
  type CampaignAggCounts,
} from './sms-queue';
// ★ 2026-07-30 브랜드 SMSQ 합류 — 환불 유형 축(BRAND vs message_type)은 CT 판정 하나만 쓴다
import { resolveRefundAxes } from './billing-types';
import { prepaidRefund, REFUND_KEYS } from './prepaid';
import { SUCCESS_CODES, PENDING_CODES } from './sms-result-map';
import { getSourceRef, updateTrainingMetrics } from './training-logger';
// ★ 2026-08-11 자기 개선 루프 Phase 0 — 문자 클릭을 문안 학습 원장에 환류(CT가 합계를 소유).
import { getCampaignClickTotal } from './short-url';
// ★ 2026-08-04: sweep 대상 캠페인 상태 CT — mysql-refund-sweeper와 같은 집합을 본다
import { SWEEPABLE_CAMPAIGN_STATUS_SQL } from './campaign-sweep-scope';
import { DIRECT_PIPELINE_SEND_TYPES_SQL } from './send-type-axis';

// ===== 예약 캠페인 자동 정리 (D145 P0) =====

/**
 * scheduled_at 지난 status='scheduled' 캠페인을 MySQL count 기반 'completed'/'failed'로 정리.
 * 사용자/공용/슈퍼관리자 모든 발송 관련 라우트에서 동일 호출 → 정합성 보장.
 *
 * D145 P0+ (2026-05-07): idempotent 환불 패턴.
 *  - 호출측은 누적 failCount 그대로 prepaidRefund에 전달 (delta 계산 폐기)
 *  - 함수가 alreadyRefunded와 비교해 차이만 환불 (idempotency 함수 측 보장)
 *  - 같은 count 반복 = 자동 차단 / fail 증가 = 자동 보정 / 차감 한도 안전망 = 무한환불 0%
 */
export interface CleanupScheduledFilter {
  companyId?: string;      // null이면 전체 회사 (슈퍼관리자)
  userId?: string;          // company_user 본인 캠페인만
  filterUserId?: string;    // company_admin이 보는 특정 사용자
}

export async function cleanupScheduledCampaigns(filter: CleanupScheduledFilter = {}): Promise<{ cleaned: number }> {
  let cleaned = 0;

  let sql = `SELECT id, company_id, scheduled_at, send_channel, message_type FROM campaigns
             WHERE status = 'scheduled' AND scheduled_at < NOW()`;
  const params: any[] = [];

  if (filter.companyId) {
    params.push(filter.companyId);
    sql += ` AND company_id = $${params.length}`;
  }
  if (filter.userId) {
    params.push(filter.userId);
    sql += ` AND created_by = $${params.length}`;
  }
  if (filter.filterUserId) {
    params.push(filter.filterUserId);
    sql += ` AND created_by = $${params.length}`;
  }

  const targets = await query(sql, params);

  for (const camp of targets.rows) {
    try {
      const tablesWithLogs = await getCompanySmsTablesWithLogs(camp.company_id);
      // ★ 2026-06-11 정합성 100% 산식 — 이력=결과/라이브=대기 분리 (이동 중 이중 카운트 차단)
      const counts = (await smsCampaignCountsSafe(tablesWithLogs, [camp.id])).get(camp.id);
      const sentCount = counts?.total || 0;
      const successCount = counts?.success || 0;
      const failCount = counts?.fail || 0;
      const newStatus = sentCount === 0 ? 'failed' : 'completed';

      // ★ 2026-06-10: 0건 failed 확정 유예 — 발송시각 +10분까지는 보류하고 다음 사이클 재판정.
      //   큐 적재/송출 직후 경합이나 라인 캐시 시점 차로 0건이 잡혀 정상 발송이 failed로 굳던 오판 차단.
      //   (시세이도·에이치피오 6/4~6/6 — 발송은 사용자 라인, 판정은 회사 라인 0건 조회가 결합된 사례)
      if (sentCount === 0 && new Date(camp.scheduled_at).getTime() > Date.now() - 10 * 60 * 1000) {
        continue;
      }

      // ★ D145 P0+ (2026-05-07): idempotent 환불 패턴 — 호출측은 누적 failCount 그대로 보냄
      //   prepaidRefund 함수가 alreadyRefunded와 비교해 차이만 환불 (idempotency 함수 측 보장)
      //   delta 계산 폐기 — 호출/함수 의미 일치 + 누락 사고 자동 보정
      await query(
        `UPDATE campaigns SET status = $1, sent_count = $2, success_count = $3, fail_count = $4,
         sent_at = COALESCE(sent_at, scheduled_at, NOW()), updated_at = NOW() WHERE id = $5`,
        [newStatus, sentCount, successCount, failCount, camp.id]
      );

      // ★ 2026-07-30 적대검증 수용 — 브랜드 F행이 집계에 합류해 환불 축(BRAND vs message_type)을 가른다.
      //   both는 F/비F 실패를 각자 원장으로(섞으면 성공한 문자 원장이 환불되고 BRAND 원장이 남는다).
      if (failCount > 0 && camp.message_type) {
        for (const axis of resolveRefundAxes(camp.send_channel, camp.message_type)) {
          const axisFail = axis.scope === 'all'
            ? failCount
            : Number((await smsCampaignCountsSafe(tablesWithLogs, [camp.id], 'app_etc1', axis.scope)).get(camp.id)?.fail || 0);
          if (axisFail > 0) {
            await prepaidRefund(camp.company_id, axisFail, axis.type, camp.id, '발송 실패 환불', 'campaign', { refundKey: REFUND_KEYS.FAIL });
          }
        }
      }

      cleaned++;
    } catch (err: any) {
      console.error(`[cleanup-scheduled] campaign ${camp.id} 처리 에러:`, err.message);
    }
  }

  return { cleaned };
}

// ===== 실행 행 종결 =====

/**
 * ★ CT: 시작만 하고 못 나간 실행 행을 **실패로 종결**한다 (2026-08-17 신설)
 *
 * 발송 라우트는 `campaign_runs` 행(= 실행 선점 표시)을 먼저 만들고 그 뒤에 실패할 수 있는 일을 한다.
 * 그 실패 경로가 행을 그대로 두면 `status='sending'`이 남고, 발송 라우트 앞머리의 중복 발송 방지 검사
 * (`status IN ('sending','scheduled')`)가 그 행을 보고 **그 캠페인의 이후 발송을 영구히 막는다.**
 * 자동 청소도 없다 — `syncCampaignResults`는 실적(성공·실패·대기)이 하나라도 있어야 상태를 옮기는데
 * 적재가 0건이라 조건에 안 걸리고, 7일이 지나면 조회 창에서도 빠진다.
 * 실측 사고 형태: **잔액이 부족해 한 번 막힌 캠페인은 충전한 뒤에도 발송할 수 없다.**
 *
 * 왜 DELETE가 아니라 상태 전이인가 — 시도한 이력은 남아야 한다(같은 이유로 취소도 `cancelled`로 남긴다).
 * `'failed'`는 신설 값이 아니라 이 테이블이 이미 쓰는 값이고, 중복 검사·결과 동기화 대상 어디에도
 * 걸리지 않으며 청구는 `'completed'`만 센다.
 *
 * ⛔ 호출부에서 UPDATE를 직접 쓰지 마라 — 실패 경로가 하나 늘 때마다 같은 SQL이 복제되고,
 *   그중 하나를 빠뜨리는 순간 그 경로가 다시 캠페인을 잠근다.
 */
export async function failCampaignRun(runId: string, reason: string): Promise<void> {
  if (!runId) return;
  try {
    await query(
      `UPDATE campaign_runs
          SET status = 'failed',
              completed_at = COALESCE(completed_at, NOW())
        WHERE id = $1
          AND status IN ('sending', 'scheduled')`,
      [runId]
    );
  } catch (err: any) {
    // 종결 실패가 원래의 거절 응답을 덮으면 사용자는 다른 이유를 보게 된다 — 삼키되 흔적은 남긴다.
    console.error(`[campaign-run] 실행 행 종결 실패 run=${runId} (${reason}):`, err?.message || err);
  }
}

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
  // ★ 2026-06-11: 적재는 사용자 라인(direct-send-worker가 userId 전달)인데 취소는 회사 라인만 보던
  //   불일치로 DELETE 0건 → 예약 시각 실발송 사고(에이치피오 87,014건).
  //   발송 당시 기록(send_config.sentTables) 1순위 + 회사+사용자 전 라인 합집합에서 삭제.
  const cancelTables = await getCampaignQueueTables(companyId, camp.created_by || undefined, camp.send_config);
  // ★ 2026-07-30 브랜드 SMSQ 합류 — 같은 큐 안에서 행 단위로 환불 축을 가른다.
  //   브랜드 행(msg_type='F')은 BRAND 단가로 차감됐으므로 환불도 BRAND 축이어야 회계가 맞는다.
  //   문자 축(비F)은 기존대로 camp.message_type. DELETE 자체는 아래에서 전 행 공통.
  const brandCancelCount = await smsCountAll(cancelTables, `app_etc1 = ? AND status_code = 100 AND msg_type = 'F'`, [campaignId]);
  const cancelCount = await smsCountAll(cancelTables, `app_etc1 = ? AND status_code = 100 AND (msg_type IS NULL OR msg_type <> 'F')`, [campaignId]);
  const totalCancelCount = cancelCount + brandCancelCount;

  // 4. MySQL 메시지 취소 처리
  // - status_code = 100 (대기): 삭제 (Agent 미픽업 → 환불 대상)
  // - status_code != 100 (Agent 픽업됨): status_code를 9999(취소)로 변경
  const alreadyPickedUp = await smsCountAll(cancelTables, 'app_etc1 = ? AND status_code != 100', [campaignId]);

  // ★ 2026-07-27 (B-0727-2): 환불 의무를 **삭제 전에 prepared로** 남긴다.
  //   삭제한 뒤에 기록하면, 기록이 실패한 순간 대기 건수가 0이 되어 얼마를 돌려줘야 했는지가 사라진다
  //   (사용자가 재시도해도 0건으로 잡혀 그대로 cancelled가 되고 삭제분이 영구 미환불).
  //   반대로 prepared를 그냥 활성 의무로 두면 아직 안 지워진 큐를 두고 워커가 먼저 환불할 수 있으므로,
  //   삭제·검증이 끝난 뒤에만 ready로 올린다. 워커는 ready만 집는다.
  if (totalCancelCount > 0) {
    try {
      // ★ 기존 의무가 있으면 **절대 덮어쓰지 않는다.** 앞선 시도에서 DELETE가 부분 실패했다면
      //   지금 세는 대기 건수는 "남은 것"이지 "돌려줘야 할 것"이 아니다. 원본 의무 건수로 덮으면
      //   먼저 지워진 몫이 환불 목표에서 사라진다(100건 중 60건 삭제 후 실패 → 재시도가 40으로 덮음).
      //   큐 삭제용 "현재 잔여"와 환불 목표인 "최초 의무"를 분리한다.
      await query(
        `UPDATE campaigns
            SET send_config = jsonb_set(
                  COALESCE(send_config, '{}'::jsonb), '{refundPendingCancel}',
                  CASE WHEN send_config ? 'refundPendingCancel'
                       THEN send_config->'refundPendingCancel'
                       ELSE $2::jsonb END),
                updated_at = NOW()
          WHERE id = $1`,
        [campaignId, JSON.stringify({
          state: 'prepared',
          sms: { count: cancelCount, messageType: camp.message_type },
          // ★ 2026-07-30: 브랜드 행(msg_type='F')은 BRAND 축으로 — 차감(BRAND)과 같은 원장.
          //   (옛 kakao 슬롯은 IMC 미실재로 항상 0이었다. 워커는 brand·kakao 둘 다 읽는다 — 하위호환.)
          brand: { count: brandCancelCount, messageType: 'BRAND' },
          at: new Date().toISOString(),
        })],
      );
    } catch (obligationErr: any) {
      // 큐를 아직 건드리지 않았으므로 여기서 멈추면 아무것도 바뀌지 않는다(재시도 가능).
      console.error(`[취소] campaign ${campaignId} 환불 의무 기록 실패 — 취소 중단:`, obligationErr?.message || obligationErr);
      return {
        success: false,
        error: '취소 처리를 시작하지 못했습니다. 잠시 후 다시 시도해주세요.',
        cancelledCount: 0,
        refundedAmount: 0,
      };
    }
  }

  await smsExecAll(cancelTables,
    `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
    [campaignId]
  );

  // ★ 2026-07-30 적대검증 부분 수용 — 사전 카운트(alreadyPickedUp) 게이트를 없애고 항상 마킹한다.
  //   COUNT와 DELETE 사이에 Agent가 픽업한 행(100→다른 상태)은 사전 카운트가 0이면 마킹이 통째로
  //   건너뛰어져 취소 후 실발송될 수 있었다. 무조건 실행하면 그 창의 행도 9999로 막힌다(0건이면 no-op).
  await smsExecAll(cancelTables,
    `UPDATE SMSQ_SEND SET status_code = 9999 WHERE app_etc1 = ? AND status_code NOT IN (${SUCCESS_CODES.join(',')}) AND status_code != 100`,
    [campaignId]
  );
  if (alreadyPickedUp > 0) {
    console.warn(`[취소] campaign ${campaignId}: Agent 픽업된 ${alreadyPickedUp}건 status_code→9999 처리`);
  }

  // (2026-07-30) 옛 5. 카카오 대기건 삭제 폐기 — 브랜드 행도 같은 SMSQ 테이블이라 위 DELETE가 함께 지운다.

  // 5-1. ★ 2026-06-11 취소 검증 — 삭제 후 대기(100) 행이 남으면 'cancelled' 표시를 거부한다.
  //   잘못된 테이블 DELETE 0건인데 화면만 취소로 표시되어 예약 시각에 실발송되던 사고 차단.
  //   환불·PG 상태 변경 전에 검증하므로 실패 시 아무것도 바뀌지 않는다 (재시도 가능).
  const remainingPending = await smsCountAll(cancelTables, 'app_etc1 = ? AND status_code = 100', [campaignId]);
  if (remainingPending > 0) {
    console.log(`[취소] campaign ${campaignId}: 삭제 후에도 대기 ${remainingPending}건 잔존 — 취소 미완료 처리 (status 유지)`);
    return {
      success: false,
      error: `취소가 완료되지 않았습니다 (발송 대기 ${remainingPending}건 잔존). 다시 시도해주세요.`,
      cancelledCount: 0,
      refundedAmount: 0,
    };
  }

  // 삭제·검증이 끝났으므로 의무를 ready로 올린다 — 이제 워커가 집어도 안전하다.
  //   이 UPDATE가 실패해도 의무는 prepared로 남아 있고, 워커가 실제 대기 0을 확인해 승격시킨다.
  if (totalCancelCount > 0) {
    await query(
      `UPDATE campaigns
          SET send_config = jsonb_set(send_config, '{refundPendingCancel,state}', '"ready"'::jsonb),
              updated_at = NOW()
        WHERE id = $1 AND send_config ? 'refundPendingCancel'`,
      [campaignId],
    ).catch((e) => console.error(`[취소] campaign ${campaignId} 환불 의무 ready 전환 실패(워커가 승격):`, e?.message || e));
  }

  // 6. 선불 환불
  // ★ 2026-07-27 (B-0727-1): 'additional' 모드 — 취소분은 **추가 환불**이지 누적 목표가 아니다.
  //   옛 코드는 취소 대기건수를 누적 목표로 넘겼다. 워커가 앞서 미적재분을 환불해 둔 캠페인에서는
  //   (예: 1만 중 4천 적재 후 중단 → 미적재 6천 환불) 취소 4천을 누적 목표로 넘기면 6천 > 4천이라
  //   추가 환불이 0원이 되고, 실제 미발송 1만 건 중 6천만 환불된 채 굳는다.
  //   취소는 status='cancelled'로 끝나 sweeper(sending/completed) 보정 대상도 아니라 영구 누락이었다.
  let totalRefunded = 0;
  let smsOk = true;
  let brandOk = true;
  if (totalCancelCount > 0) {
    if (cancelCount > 0) {
      const smsRefund = await prepaidRefund(
        companyId, cancelCount, camp.message_type, campaignId, '예약 취소 환불', 'campaign',
        // 취소 환불은 캠페인당 한 번뿐이라 그 항아리가 비어 있음이 보장된다 → 항아리 기준 누적 = 멱등.
        // (레거시 폴백으로 떨어지면 재시도가 이중 환불되거나 기존 환불에 삼켜진다 — B-0727-2)
        { refundKey: REFUND_KEYS.CANCEL, forceKeyedPot: true },
      );
      totalRefunded += smsRefund.refunded;
      smsOk = smsRefund.ok;
      if (!smsOk) console.error(`[취소] campaign ${campaignId} 문자 취소 환불 실패 — 워커 재시도 대기(${cancelCount}건)`);
    }
    if (brandCancelCount > 0) {
      // ★ 2026-07-30: 브랜드 행(msg_type='F')은 차감과 같은 BRAND 축으로 환불한다.
      const brandRefund = await prepaidRefund(
        companyId, brandCancelCount, 'BRAND', campaignId, '브랜드메시지 예약 취소 환불', 'campaign',
        { refundKey: REFUND_KEYS.CANCEL, forceKeyedPot: true },
      );
      totalRefunded += brandRefund.refunded;
      brandOk = brandRefund.ok;
      if (!brandOk) console.error(`[취소] campaign ${campaignId} 브랜드 취소 환불 실패 — 워커 재시도 대기(${brandCancelCount}건)`);
    }
    // ★ 2026-07-27 (B-0727-2): 의무 해제는 **여기서 하지 않는다.**
    //   앞선 시도가 부분 삭제로 끝났다면 의무에 남은 건수(원본)와 이번 회차의 cancelCount(잔여)가 다르다.
    //   이번 환불이 성공했다고 의무를 지우면 먼저 지워진 몫이 목표에서 사라진다.
    //   워커가 의무에 적힌 원본 건수로 다시 부르고(CANCEL 항아리 누적 = 멱등) 충족됐을 때 해제한다.
    //   건수가 같은 일반적인 경우엔 워커 첫 사이클에서 추가 0원 + 해제로 바로 끝난다.
    if (!smsOk || !brandOk) {
      console.warn(`[취소] campaign ${campaignId} 취소 환불 미완료 — 워커 재시도가 이어받는다`);
    }
  }

  // 7. PostgreSQL 캠페인 상태 변경
  // ★ 2026-06-11: fail_count=target/success=0 덮어쓰기 제거 — 취소는 status로 표현하고 counts는 실측 보존.
  //   미발송 취소는 0/0이 진실이고, 취소 전 발송분이 있으면(0611 에이치피오) 그 실측이 청구·정정 근거다.
  //   화면 취소 표시는 status 기반(line-through·라벨) 확인 — counts 의존 없음.
  await query(
    `UPDATE campaigns SET
      status = 'cancelled',
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
      status = 'cancelled'
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
  // ★ 2026-07-30: send_channel·message_type 동반 조회 — 환불 축(BRAND vs message_type) 판정에 필요.
  const runsResult = await query(
    `SELECT cr.id, cr.campaign_id, c.company_id, c.created_by, c.send_channel, c.message_type
     FROM campaign_runs cr
     JOIN campaigns c ON c.id = cr.campaign_id
     WHERE c.company_id = $1
       AND cr.status IN ('sending', 'scheduled', 'completed')
       AND (c.scheduled_at IS NULL OR c.scheduled_at <= NOW())
       AND COALESCE(c.scheduled_at, c.sent_at, cr.created_at) >= NOW() - INTERVAL '7 days'
       AND (cr.target_count IS NULL
            OR cr.success_count IS NULL
            OR cr.target_count > COALESCE(cr.success_count, 0) + COALESCE(cr.fail_count, 0))`,
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

  // ★ 2026-06-11 정합성 100% 산식 — 이력=결과/라이브=대기 분리 (이동 중 이중 카운트 차단)
  const smsAggMap = new Map<string, CampaignAggCounts>();
  // ★ 2026-07-30: 'both' 캠페인만 브랜드/문자 분리 집계 추가 — 환불 축이 두 원장으로 갈리기 때문.
  //   전체 카운트(smsAggMap)는 표시·상태용으로 기존 그대로(브랜드 행 자동 포함).
  const brandAggMap = new Map<string, CampaignAggCounts>();
  const nonBrandAggMap = new Map<string, CampaignAggCounts>();
  for (const [key, runs] of runsByUser) {
    const [cid, uid] = key.split('::');
    const runTables = await getCompanySmsTablesWithLogs(cid, uid || undefined);
    const ids = runs.map(r => r.campaign_id);
    const partial = await smsCampaignCountsSafe(runTables, ids);
    for (const [g, v] of partial) smsAggMap.set(g, v);
    const bothIds = runs.filter((r: any) => String(r.send_channel || '') === 'both').map((r: any) => r.campaign_id);
    if (bothIds.length > 0) {
      for (const [g, v] of await smsCampaignCountsSafe(runTables, bothIds, 'app_etc1', 'brand')) brandAggMap.set(g, v);
      for (const [g, v] of await smsCampaignCountsSafe(runTables, bothIds, 'app_etc1', 'nonBrand')) nonBrandAggMap.set(g, v);
    }
  }

  for (const run of runsResult.rows) {
    try {
      const smsAgg = smsAggMap.get(run.campaign_id);

      const successCount = (smsAgg?.success || 0);
      const failCount = (smsAgg?.fail || 0);
      const pendingCount = (smsAgg?.pending || 0);
      console.log(`[sync-results] AI run ${run.id} — success:${successCount}, fail:${failCount}, pending:${pendingCount}`);

      // ★ 2026-07-06 120분 타임아웃(pending→fail 변환) 제거 — 통신사 리포트는 최대 48h 지연이 정상(단말 꺼짐 재시도).
      //   대기를 실패로 기록하면 그 즉시 sync 후보(target > success+fail)에서 빠져 늦은 성공을 못 읽고,
      //   6h markFinalized가 굳힌 뒤 재대조 필터(성공+실패<적재)에도 안 잡혀 영구 오표시(베네통·아이디룩 7/2·7/3 실측).
      //   마감은 기존 3겹이 담당: 48h expired-pending-sweeper(유실=MySQL 4000 실패 확정) +
      //   6h 확정 게이트(성공+실패≥target만 굳힘) + 72h 탈출구(영구 미달 실측 굳힘).
      //   환불도 실패 확정분만 — sweeper 정당 환불 산식(refund-calc.ts, 실패+미적재)과 동일 기준.
      if (successCount > 0 || failCount > 0 || pendingCount > 0) {
        // ★ D144 후속: pending 무관 — 발송 활동(MySQL 큐 INSERT) 있으면 'completed'.
        //   pending은 통신사 처리 대기일 뿐 발송 자체는 끝남. 화면 카운트는 MySQL 직접 갱신.
        const newStatus = (successCount + failCount + pendingCount) > 0 ? 'completed' : 'failed';

        // ★ D145 P0+ (2026-05-07): idempotent 환불 패턴 — 호출측은 누적 failCount 그대로 보냄
        //   prepaidRefund가 alreadyRefunded와 비교해 차이만 환불 (idempotency 함수 측 보장)
        //   delta 계산 폐기 — 호출/함수 의미 일치 + 누락 사고 자동 보정 (트렉스타 5/7 16,024원 사고)

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
          [successCount, failCount, newStatus, run.id]
        );

        // campaigns 테이블도 업데이트
        const runInfo = await query(`SELECT campaign_id FROM campaign_runs WHERE id = $1`, [run.id]);
        if (runInfo.rows.length > 0) {
          // ★ 2026-06-11: sent_count = 적재 실측(worker/적재 경로 기록)이 진실 — success+fail 덮어쓰기 제거.
          //   결과 도착 전 "전송"이 작아 보이고 대기가 0으로 굳던 출처 혼선(건5) fix. NULL/0(과거 세대)만 보완.
          await query(
            `UPDATE campaigns SET
              sent_count = COALESCE(NULLIF(sent_count, 0), $1::int + $2::int),
              success_count = $1,
              fail_count = $2,
              status = $3::text,
              sent_at = CASE WHEN $3::text = 'completed' AND sent_at IS NULL
                THEN COALESCE(scheduled_at, NOW())
                ELSE sent_at END
             WHERE id = $4`,
            [successCount, failCount, newStatus, runInfo.rows[0].campaign_id]
          );

          // ★ D145 P0+: idempotent 패턴 — 누적 fail 그대로 (함수가 차이만 환불)
          // ★ 2026-07-30: 환불 유형은 축 판정 CT(resolveRefundAxes)로 — 브랜드 전용은 BRAND 원장,
          //   'both'는 문자/브랜드 분리 집계의 fail을 각자 원장으로 되돌린다(차감과 같은 축).
          if (failCount > 0) {
            const axes = resolveRefundAxes(run.send_channel, run.message_type);
            for (const axis of axes) {
              const axisFail = axis.scope === 'all' ? failCount
                : axis.scope === 'brand' ? Number(brandAggMap.get(run.campaign_id)?.fail || 0)
                : Number(nonBrandAggMap.get(run.campaign_id)?.fail || 0);
              if (axisFail > 0) {
                await prepaidRefund(run.company_id, axisFail, axis.type, run.campaign_id, '발송 실패 환불', 'campaign', { refundKey: REFUND_KEYS.FAIL });
              }
            }
          }

          // ★ D114 P8-3: auto_campaign_runs 연동 — 실제 전송 결과 반영
          try {
            await query(
              `UPDATE auto_campaign_runs SET
                success_count = $1, fail_count = $2
               WHERE campaign_id = $3`,
              [successCount, failCount, runInfo.rows[0].campaign_id]
            );
          } catch (acrErr) {
            // auto_campaign_runs에 해당 campaign_id가 없을 수 있음 (일반 캠페인)
          }
        }

        // AI 학습 성과 데이터 업데이트
        // ★ 2026-08-11 Phase 0 — 클릭 동반. source_ref 축은 적재와 같은 run.id다(campaigns.ts:1088).
        //   클릭 합계는 그 run이 속한 campaign_id 기준이라 runInfo에서 얻는다. 링크가 없으면 null(0 아님).
        const aiCampaignId = runInfo.rows[0]?.campaign_id as string | undefined;
        const aiClicks = aiCampaignId
          ? await getCampaignClickTotal(String(aiCampaignId)).catch(() => null)
          : null;
        updateTrainingMetrics({
          sourceRef: getSourceRef(run.id),
          sentCount: successCount + failCount,
          successCount,
          failCount,
          clickCount: aiClicks,
        });

        syncCount++;
      }
    } catch (runErr: any) {
      console.error(`[sync-results] AI run ${run.id} 처리 에러:`, runErr.message);
    }
  }

  // === 2. 직접발송 배관 캠페인 ===
  // ★ 2026-07-30: send_channel·message_type 동반 조회 — 환불 축 판정에 필요.
  // ★ 2026-08-18: `= 'direct'` → CT 집합(`DIRECT_PIPELINE_SEND_TYPES`). AI 오퍼레이터 승인 발송이
  //   같은 `POST /direct-send` 배관을 타면서 `send_type='operator'`로 적재되기 시작했다.
  //   그 값을 여기 안 넣으면 오퍼레이터 발송은 위 1번(campaign_runs 순회)에도 안 걸리고 여기도 안 걸려
  //   **결과 동기화와 실패 환불이 통째로 멎는다**. 반대로 'ai'를 넣으면 1번과 겹쳐 이중 환불이 된다 —
  //   집합의 근거는 CT 주석이 소유한다.
  const directCampaigns = await query(
    `SELECT id, company_id, scheduled_at, created_at, sent_at, created_by, send_channel, message_type FROM campaigns
     WHERE company_id = $1 AND send_type IN (${DIRECT_PIPELINE_SEND_TYPES_SQL})
       -- ★ 2026-08-04 대상 상태는 CT(campaign-sweep-scope)가 소유 — 환불 sweeper와 같은 집합.
       --   'failed' 합류로 예외 종결 캠페인의 결과 카운트·환불도 여기서 수렴한다.
       AND (status IN (${SWEEPABLE_CAMPAIGN_STATUS_SQL}) OR (status = 'scheduled' AND scheduled_at <= NOW()))
       AND (target_count IS NULL
            OR success_count IS NULL
            OR target_count > COALESCE(success_count, 0) + COALESCE(fail_count, 0))
       AND COALESCE(scheduled_at, sent_at, created_at) >= NOW() - INTERVAL '7 days'`,
    [companyId]
  );

  // ★ 최적화 — 직접발송도 배치 집계 (회사/유저 조합별 테이블 → UNION ALL GROUP BY)
  const directByUser = new Map<string, any[]>();
  for (const c of directCampaigns.rows) {
    const key = `${c.company_id}::${c.created_by || ''}`;
    if (!directByUser.has(key)) directByUser.set(key, []);
    directByUser.get(key)!.push(c);
  }
  // ★ 2026-06-11 정합성 100% 산식 — 이력=결과/라이브=대기 분리 (이동 중 이중 카운트 차단)
  // ★ 2026-07-30: 'both' 캠페인만 브랜드/문자 분리 집계 추가(환불 축 분리) — AI 블록과 동일 구조.
  const directSmsAggMap = new Map<string, CampaignAggCounts>();
  const directBrandAggMap = new Map<string, CampaignAggCounts>();
  const directNonBrandAggMap = new Map<string, CampaignAggCounts>();
  for (const [key, camps] of directByUser) {
    const [cid, uid] = key.split('::');
    const directTables = await getCompanySmsTablesWithLogs(cid, uid || undefined);
    const ids = camps.map(c => c.id);
    const partial = await smsCampaignCountsSafe(directTables, ids);
    for (const [g, v] of partial) directSmsAggMap.set(g, v);
    const bothIds = camps.filter((c: any) => String(c.send_channel || '') === 'both').map((c: any) => c.id);
    if (bothIds.length > 0) {
      for (const [g, v] of await smsCampaignCountsSafe(directTables, bothIds, 'app_etc1', 'brand')) directBrandAggMap.set(g, v);
      for (const [g, v] of await smsCampaignCountsSafe(directTables, bothIds, 'app_etc1', 'nonBrand')) directNonBrandAggMap.set(g, v);
    }
  }

  for (const campaign of directCampaigns.rows) {
    try {
      const smsDirectAgg = directSmsAggMap.get(campaign.id);

      const successCount = (smsDirectAgg?.success || 0);
      const failCount = (smsDirectAgg?.fail || 0);
      const pendingCount = (smsDirectAgg?.pending || 0);
      console.log(`[sync-results] direct campaign ${campaign.id} — success:${successCount}, fail:${failCount}, pending:${pendingCount}`);

      // ★ 2026-07-06 120분 타임아웃(pending→fail 변환) 제거 — AI 캠페인 블록과 동일 근거.
      //   대기를 실패로 기록하면 sync 후보 이탈 → 6h 굳힘 → 재대조 필터(성공+실패<적재) 사각 = 영구 오표시.
      //   마감 3겹(48h expired-pending-sweeper / 6h 확정 게이트 / 72h 탈출구)이 담당. 환불은 실패 확정분만.
      if (successCount > 0 || failCount > 0 || pendingCount > 0) {
        // ★ D144 후속: pending 무관 — 발송 활동(MySQL 큐 INSERT) 있으면 'completed'.
        //   pending은 통신사 처리 대기일 뿐 발송 자체는 끝남. 화면 카운트는 MySQL 직접 갱신.
        const newStatus = (successCount + failCount + pendingCount) > 0 ? 'completed' : 'failed';

        // ★ D145 P0+ (2026-05-07): idempotent 환불 패턴 — 호출측은 누적 failCount 그대로 보냄
        //   prepaidRefund가 alreadyRefunded와 비교해 차이만 환불 (idempotency 함수 측 보장)
        //   delta 계산 폐기 — 호출/함수 의미 일치 + 누락 사고 자동 보정 (트렉스타 5/7 16,024원 사고)
        // ★ 2026-06-11: sent_count = 적재 실측(direct-send-worker 기록)이 진실 — success+fail 덮어쓰기 제거.
        //   폴라초이스 "전송 15,470 / 대기 0" 표시의 직접 원인(결과 도착분 합으로 덮음) fix. NULL/0만 보완.
        await query(
          `UPDATE campaigns SET
            sent_count = COALESCE(NULLIF(sent_count, 0), $1::int + $2::int),
            success_count = $1,
            fail_count = $2,
            status = $3::text,
            sent_at = CASE WHEN $3::text = 'completed' AND sent_at IS NULL
              THEN COALESCE(scheduled_at, NOW())
              ELSE sent_at END
           WHERE id = $4`,
          [successCount, failCount, newStatus, campaign.id]
        );

        // ★ D145 P0+: idempotent 패턴 — 누적 fail 그대로 (함수가 차이만 환불)
        // ★ 2026-07-30: 환불 유형은 축 판정 CT — 브랜드 전용=BRAND / both=문자·브랜드 분리 원장.
        if (failCount > 0) {
          const axes = resolveRefundAxes(campaign.send_channel, campaign.message_type);
          for (const axis of axes) {
            const axisFail = axis.scope === 'all' ? failCount
              : axis.scope === 'brand' ? Number(directBrandAggMap.get(campaign.id)?.fail || 0)
              : Number(directNonBrandAggMap.get(campaign.id)?.fail || 0);
            if (axisFail > 0) {
              await prepaidRefund(campaign.company_id, axisFail, axis.type, campaign.id, '발송 실패 환불', 'campaign', { refundKey: REFUND_KEYS.FAIL });
            }
          }
        }

        // AI 학습 성과 데이터 업데이트 (직접발송)
        // ★ 2026-08-11 Phase 0 — 클릭 동반. 직접발송은 run이 없어 적재 때 campaign.id를 그 자리에 넣었으므로
        //   source_ref 축도 campaign.id다(campaigns.ts:2460). 클릭 합계도 같은 id 기준이라 축이 하나다.
        const directClicks = await getCampaignClickTotal(String(campaign.id)).catch(() => null);
        updateTrainingMetrics({
          sourceRef: getSourceRef(campaign.id),
          sentCount: successCount + failCount,
          successCount,
          failCount,
          clickCount: directClicks,
        });

        syncCount++;
      }
    } catch (campErr: any) {
      console.error(`[sync-results] direct campaign ${campaign.id} 처리 에러:`, campErr.message);
    }
  }

  return { syncCount };
}
