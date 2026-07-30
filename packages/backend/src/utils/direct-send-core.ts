/**
 * direct-send-core.ts — 직접발송 campaign 생성 핵심 (commit 엔드포인트 + 자동마케팅 자율 발송 공유)
 *
 * /direct-send/commit 본문 중 검증 이후의 "발송 커밋"(staging COUNT · campaign INSERT · 잔액 차감 · worker 트리거)을
 * 함수로 추출. 동작은 원본과 동일(2026-06-04 톤28 504 정정 = 즉시 응답 + COUNT-only 보존).
 * 검증(라인그룹·회신번호 등록·알림톡 게이트)은 호출부(commit/autosend)가 선행한다.
 */
import { query } from '../config/database';
import { prepaidDeduct, prepaidRefund, REFUND_KEYS } from './prepaid';
// ★ 2026-07-30 차감 축 판정 — 환불 축과 같은 CT를 쓴다(갈리면 회계가 어긋난다)
import { resolveRefundAxes } from './billing-types';
import { buildRefundPending } from './refund-pending';
import { sendSystemAlert } from './system-alert';
import { triggerDirectSendWorker } from './direct-send-worker';
import { CAMPAIGN_INSERT_SQL, buildDirectSendCampaignParams, DirectSendError, type DirectSendSpec } from './direct-send-spec';
import { logCampaignTraining } from './training-logger';
import { hasUneditedLinkPlaceholder, LINK_PLACEHOLDER } from './brand-link-core';
// ★ 2026-07-12 D-2: 야간 광고 발송 제한 — SEND_HOURS 창 밖 광고 접수 거부(순수 판정 CT 재사용)
import { isSendableHourKst } from './autosend-policy';
import { SEND_HOURS } from '../config/defaults';

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
  // ★ 2026-07-02 링크 placeholder 발송 가드 — [링크를 입력해주세요]/{{LINK: 잔존 시 실발송 차단.
  //   직접발송 commit + 자율발송 + DM 공통 길목 (혜택 placeholder 차단과 동일 철학 — 미완성 문안 고객 발송 0).
  if (hasUneditedLinkPlaceholder(spec.message || '')) {
    throw new DirectSendError(
      'LINK_PLACEHOLDER_UNEDITED',
      `문안에 링크 자리(${LINK_PLACEHOLDER})가 비어 있습니다. 링크 삽입으로 URL을 넣거나 해당 줄을 지운 뒤 발송해주세요.`,
      400,
    );
  }

  // ★ 2026-07-12 D-2: 야간 광고 발송 제한(정보통신망법) — 광고(adEnabled)는 발송 시각(즉시=지금,
  //   예약=예약 시각 KST)이 발송 가능 창 밖이면 접수 거부. 직접발송·DM 발송·자율발송 공통 길목(1곳 = 전 경로).
  //   정보성(adEnabled=false)은 무영향. 자동마케팅은 상류 클램프로 주간에만 도달(이중 안전).
  if (spec.adEnabled === true) {
    const effectiveAt = spec.scheduled && spec.scheduledAt ? new Date(spec.scheduledAt) : new Date();
    if (!Number.isNaN(effectiveAt.getTime()) && !isSendableHourKst(effectiveAt, SEND_HOURS.start, SEND_HOURS.end)) {
      throw new DirectSendError(
        'NIGHT_AD_RESTRICTED',
        `야간(${SEND_HOURS.end}시~다음날 ${String(SEND_HOURS.start).padStart(2, '0')}시)에는 광고 발송이 제한됩니다. 발송 시각을 ${String(SEND_HOURS.start).padStart(2, '0')}:00~${SEND_HOURS.end - 1}:59 사이로 조정해주세요.`,
        400,
      );
    }
  }

  const campaignResult = await query(CAMPAIGN_INSERT_SQL, buildDirectSendCampaignParams(spec, ctx));
  const campaignId = campaignResult.rows[0].id;

  // 잔액 차감 (정제 후 total) — 실패 시 campaign 롤백 (원본 commit과 동일).
  // ★ 2026-07-30 적대검증 critical 수용 — 채널 리터럴('kakao'→KAKAO)이 브랜드 발송을 알림톡 단가로
  //   깎고 both의 브랜드분을 무료로 내보내던 축 오류. 차감 축은 환불 축과 같은 CT(resolveRefundAxes)로:
  //   kakao/kakao_brand=BRAND 단일, both=message_type+BRAND 이중(campaigns.ts 라우트와 동일 계약),
  //   alimtalk/sms=message_type. 뒤 축 실패 시 앞 축을 회수하고 롤백한다(한쪽만 깎인 채 남기지 않는다).
  const directChannel = spec.sendChannel || 'sms';
  const deductAxes = resolveRefundAxes(directChannel, spec.msgType);
  const deductedTypes: string[] = [];
  for (const axis of deductAxes) {
    const deduct = await prepaidDeduct(ctx.companyId, spec.total, axis.type, campaignId, ctx.userId);
    if (!deduct.ok) {
      // ★ 2026-07-30 (2R): 보상은 ok까지 확인한다 — prepaidRefund는 실패해도 throw 없이 ok=false로 돌아온다.
      //   회수가 하나라도 미완이면 캠페인을 지우지 않는다(지우면 durable 의무를 붙일 곳이 사라져 영구 미환불).
      //   대신 발송만 못 하게 중화(send_phase='failed' — 워커는 'queued'만 집는다)하고 refundPending을 남겨
      //   워커 재시도가 소진하게 한다. 회수 키는 재시도 워커와 같은 NOT_LOADED — 항아리가 갈리면
      //   초기 부분 회수 위에 재시도가 겹쳐 이중 환불이 된다(같은 항아리 = 누적 목표 멱등).
      const revertFailedTypes: string[] = [];
      for (const doneType of deductedTypes) {
        try {
          const rev = await prepaidRefund(
            ctx.companyId, spec.total, doneType, campaignId,
            `${axis.type} 차감 실패로 ${doneType} 차감분 회수`, 'campaign', { refundKey: REFUND_KEYS.NOT_LOADED },
          );
          if (!rev.ok) revertFailedTypes.push(doneType);
        } catch (revertErr) {
          revertFailedTypes.push(doneType);
          console.error(`[direct-send-core][보상실패] campaign=${campaignId} ${doneType} ${spec.total}건 회수 실패:`, revertErr);
        }
      }
      if (revertFailedTypes.length > 0) {
        // ★ 2026-07-30 (3R): 중화 + 의무 기록을 **단일 원자 UPDATE**로 — 두 쓰기 사이가 곧 유실 창이다.
        // ★ 2026-07-31 (4R): WHERE에 send_phase='preparing' 가드 — 이 시점의 캠페인은 preparing뿐이지만,
        //   가드 없는 상태 덮어쓰기는 이 부류 사고의 씨앗이라 전 지점 동일 계약으로 좁힌다.
        //   실패·0행이면 캠페인은 preparing 그대로 = 워커가 절대 안 집는다(발송 fail-closed) — 경보로 사람 호출.
        //   deductedTypes는 최대 1개(뒤 축이 실패하면 루프가 끝난다) — 단일 슬롯으로 충분.
        try {
          const neutralized = await query(
            `UPDATE campaigns
                SET send_phase = 'failed', status = 'failed',
                    send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{refundPending}', $2::jsonb),
                    updated_at = NOW()
              WHERE id = $1 AND send_phase = 'preparing'`,
            [campaignId, JSON.stringify(buildRefundPending(spec.total, revertFailedTypes[0]))],
          );
          if (neutralized.rowCount !== 1) throw new Error(`중화 UPDATE rowCount=${neutralized.rowCount}`);
        } catch (neutralizeErr: any) {
          console.error(`[direct-send-core][CRITICAL] campaign=${campaignId} 중화·의무 기록 실패 — ${revertFailedTypes[0]} ${spec.total}건 수동 환불 필요:`, neutralizeErr?.message || neutralizeErr);
          void sendSystemAlert({
            dedupKey: `direct-deduct-orphan:${campaignId}`,
            message: `직접발송 차감 보상 미완 — campaign=${campaignId} ${revertFailedTypes[0]} ${spec.total}건 수동 환불 확인 필요(캠페인은 preparing으로 발송 차단됨)`,
          });
        }
      } else {
        await query('DELETE FROM campaigns WHERE id = $1', [campaignId]);
      }
      throw new DirectSendError('INSUFFICIENT_BALANCE', deduct.error || '잔액이 부족합니다.', 402, {
        insufficientBalance: true, balance: deduct.balance, requiredAmount: deduct.amount,
      });
    }
    deductedTypes.push(axis.type);
  }

  // ★ 2026-07-30 (3R): 차감이 전부 성공한 뒤에야 발송 가능 상태로 전환 — INSERT 시점은 'preparing'이라
  //   워커 due 쿼리('queued')에 걸리지 않는다.
  // ★ 2026-07-31 (4R): 전환 UPDATE는 커밋됐는데 클라이언트만 오류를 받을 수 있다(연결 단절 등).
  //   그때 무조건 중화하면 이미 워커가 집어 발송 중인 캠페인을 failed로 덮고 전액 환불 의무까지 남긴다
  //   (발송+환불 이중 이득). 그래서 실패 시 **실제 phase를 재확인**하고:
  //   - queued/processing/sent = 전환이 실제로 됐다 → 정상 흐름 계속(환불·throw 없음)
  //   - preparing = 진짜 실패 → preparing 가드 원자 중화+의무 기록 후 COMMIT_FAILED
  //   - 재확인 불능/그 외 = 미확정 → 경보로 사람 호출 후 COMMIT_FAILED(자동 환불 기록 금지)
  try {
    const activated = await query(
      `UPDATE campaigns SET send_phase = 'queued', updated_at = NOW() WHERE id = $1 AND send_phase = 'preparing'`,
      [campaignId],
    );
    if (activated.rowCount !== 1) throw new Error(`queued 전환 rowCount=${activated.rowCount}`);
  } catch (activateErr: any) {
    let phaseAfter: string | null = null;
    try {
      const reread = await query(`SELECT send_phase FROM campaigns WHERE id = $1`, [campaignId]);
      phaseAfter = reread.rows[0]?.send_phase ?? null;
    } catch { /* 재확인 자체가 실패 — 아래 미확정 분기 */ }

    if (phaseAfter === 'queued' || phaseAfter === 'processing' || phaseAfter === 'sent') {
      // 전환은 커밋돼 있었다 — 발송은 정상 진행 중이므로 아무것도 되돌리지 않는다.
      console.warn(`[direct-send-core] campaign=${campaignId} queued 전환 오류 후 재확인 — phase=${phaseAfter}, 정상 흐름 계속:`, activateErr?.message || activateErr);
    } else if (phaseAfter === 'preparing') {
      console.error(`[direct-send-core][CRITICAL] campaign=${campaignId} queued 전환 실패 — 차감 ${deductedTypes.join('/')} ${spec.total}건 환불 의무 기록:`, activateErr?.message || activateErr);
      const pendingRecord: any = buildRefundPending(spec.total, deductedTypes[0] || spec.msgType);
      if (deductedTypes.length > 1) pendingRecord.brand = { count: spec.total, messageType: deductedTypes[1] };
      try {
        const neutralized = await query(
          `UPDATE campaigns
              SET send_phase = 'failed', status = 'failed',
                  send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{refundPending}', $2::jsonb),
                  updated_at = NOW()
            WHERE id = $1 AND send_phase = 'preparing'`,
          [campaignId, JSON.stringify(pendingRecord)],
        );
        if (neutralized.rowCount !== 1) throw new Error(`중화 UPDATE rowCount=${neutralized.rowCount}`);
      } catch (neutralizeErr: any) {
        console.error(`[direct-send-core][CRITICAL] campaign=${campaignId} 활성화 실패 중화 미완:`, neutralizeErr?.message || neutralizeErr);
        void sendSystemAlert({
          dedupKey: `direct-deduct-orphan:${campaignId}`,
          message: `직접발송 활성화 실패 + 중화 미완 — campaign=${campaignId} ${deductedTypes.join('/')} ${spec.total}건 수동 확인 필요(preparing 발송 차단 상태)`,
        });
      }
      throw new DirectSendError('COMMIT_FAILED', '발송 접수에 실패했습니다. 차감분은 자동 환불됩니다 — 잠시 후 다시 시도해주세요.', 500);
    } else {
      // 미확정(재확인 실패·행 없음 등) — 자동 환불을 기록하면 실제 발송과 겹칠 수 있다. 사람이 판정한다.
      void sendSystemAlert({
        dedupKey: `direct-deduct-orphan:${campaignId}`,
        message: `직접발송 활성화 결과 미확정 — campaign=${campaignId} ${deductedTypes.join('/')} ${spec.total}건, 발송·차감 상태 수동 확인 필요`,
      });
      throw new DirectSendError('COMMIT_FAILED', '발송 접수 상태를 확인하지 못했습니다. 발송 내역을 확인한 뒤 다시 시도해주세요.', 500);
    }
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
