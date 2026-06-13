/**
 * direct-send-core.ts — 직접발송 campaign 생성 핵심 (commit 엔드포인트 + 자동마케팅 자율 발송 공유)
 *
 * /direct-send/commit 본문 중 검증 이후의 "발송 커밋"(staging COUNT · campaign INSERT · 잔액 차감 · worker 트리거)을
 * 함수로 추출. 동작은 원본과 동일(2026-06-04 톤28 504 정정 = 즉시 응답 + COUNT-only 보존).
 * 검증(라인그룹·회신번호 등록·알림톡 게이트)은 호출부(commit/autosend)가 선행한다.
 */
import { query } from '../config/database';
import { prepaidDeduct } from './prepaid';
import { triggerDirectSendWorker } from './direct-send-worker';
import { CAMPAIGN_INSERT_SQL, buildDirectSendCampaignParams, DirectSendError, type DirectSendSpec } from './direct-send-spec';
import { logCampaignTraining } from './training-logger';

// ★ 대량 발송 (2026-06-04 톤28 504 정정): 모달 카운트 + commit 차감 공용 헬퍼 — 실제 삭제 없이 COUNT만.
//   중복 = phone당 1건 유지(total - distinct), 수신거부 = distinct phone 중 user_id+phone 매칭.
//   count endpoint / commit / worker가 모두 이 기준이라 모달 숫자 = 실제 발송 정확히 일치.
export async function countStagingFiltered(
  stagingId: string, companyId: string, userId: string,
  dedupEnabled: boolean, unsubFilterEnabled: boolean,
): Promise<{ total: number; duplicateCount: number; unsubscribeCount: number; sendCount: number }> {
  const totalR = await query(
    `SELECT COUNT(*)::int AS c FROM campaign_send_staging WHERE staging_id = $1 AND company_id = $2`,
    [stagingId, companyId]
  );
  const total = totalR.rows[0]?.c || 0;
  let duplicateCount = 0;
  if (dedupEnabled !== false) {
    const r = await query(
      `SELECT (COUNT(*) - COUNT(DISTINCT phone))::int AS c FROM campaign_send_staging WHERE staging_id = $1`,
      [stagingId]
    );
    duplicateCount = r.rows[0]?.c || 0;
  }
  let unsubscribeCount = 0;
  if (unsubFilterEnabled !== false) {
    // (user_id, phone) 인덱스 사용 — staging × unsubscribes 균등 조인이라 self-join과 달리 대량에서도 빠르다.
    const r = await query(
      `SELECT COUNT(DISTINCT s.phone)::int AS c
       FROM campaign_send_staging s
       JOIN unsubscribes u ON u.user_id = $2 AND u.phone = s.phone
       WHERE s.staging_id = $1`,
      [stagingId, userId]
    );
    unsubscribeCount = r.rows[0]?.c || 0;
  }
  const sendCount = Math.max(total - duplicateCount - unsubscribeCount, 0);
  return { total, duplicateCount, unsubscribeCount, sendCount };
}

/**
 * campaign 1건 생성(send_phase='queued') + 잔액 차감 + worker 트리거.
 * 검증·정제 건수(total)는 호출부가 선행. 잔액 부족이면 campaign 롤백 후 DirectSendError(402) throw.
 */
export async function createDirectSendCampaign(
  spec: DirectSendSpec,
  ctx: { companyId: string; userId: string },
  training?: { finalSource?: 'manual' | 'selected_as_is' | 'edited'; userPrompt?: string; aiMessages?: string[] },
): Promise<{ campaignId: string; accepted: number }> {
  const campaignResult = await query(CAMPAIGN_INSERT_SQL, buildDirectSendCampaignParams(spec, ctx));
  const campaignId = campaignResult.rows[0].id;

  // 잔액 차감 (정제 후 total) — 실패 시 campaign 롤백 (원본 commit과 동일).
  const directChannel = spec.sendChannel || 'sms';
  const directDeductType = directChannel === 'kakao' ? 'KAKAO' : spec.msgType;
  const deduct = await prepaidDeduct(ctx.companyId, spec.total, directDeductType, campaignId, ctx.userId);
  if (!deduct.ok) {
    await query('DELETE FROM campaigns WHERE id = $1', [campaignId]);
    throw new DirectSendError('INSUFFICIENT_BALANCE', deduct.error || '잔액이 부족합니다.', 402, {
      insufficientBalance: true, balance: deduct.balance, requiredAmount: deduct.amount,
    });
  }

  // AI 학습 데이터 적재 — 직접발송·자율발송 공통 길목(fire-and-forget, 발송·돈 영향 0, source_ref 멱등).
  const trainingMsgType: 'SMS' | 'LMS' | 'MMS' | 'KAKAO' =
    (directChannel === 'kakao' || directChannel === 'alimtalk')
      ? 'KAKAO'
      : (String(spec.msgType || 'LMS').toUpperCase() as 'SMS' | 'LMS' | 'MMS');
  void logCampaignTraining({
    campaignId,
    companyId: ctx.companyId,
    messageType: trainingMsgType,
    isAd: spec.adEnabled === true,
    targetCount: spec.total,
    finalMessage: spec.message || '',
    finalSource: training?.finalSource || 'manual',
    userPrompt: training?.userPrompt,
    aiMessages: training?.aiMessages,
    sendAt: spec.scheduled && spec.scheduledAt ? new Date(spec.scheduledAt) : undefined,
  });

  // worker 즉시 트리거 (5초 대기 없이)
  triggerDirectSendWorker(campaignId);
  return { campaignId, accepted: spec.total };
}
