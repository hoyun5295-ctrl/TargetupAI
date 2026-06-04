/**
 * 여정 묶음 발송 — (journey, step, KST 발송날짜)당 campaign 1건 공유.
 *
 * 목적: 고객 1명당 campaign 1건(500명=500줄 폭주) 폐기 → step+날짜 단위 1건.
 *   발송결과 목록은 step당 1줄, 상세는 기존 app_etc1=campaignId + 전화번호 검색 경로로 N명 표시.
 *   개인화(Liquid·예측·variant·단축URL)는 executor가 고객별 렌더 그대로 — 여기선 "그릇"만 공유.
 *
 * 정산 안전: 여정은 campaign_runs를 만들지 않아 campaign_runs 월정산 경로 밖이고,
 *   발송 시 prepaidDeduct로 즉시 차감된다. 따라서 campaign 공유·app_etc1 변경이 billing에 영향 0.
 */

import { query } from '../config/database';

export interface StepCampaignSpec {
  companyId: string;
  journeyId: string;
  stepId: string;
  stepOrder: number;
  msgType: string;                 // SMS | LMS | MMS | KAKAO
  representativeMessage: string;   // 대표 본문(목록 표시용 — 실제 본문은 고객별 큐에 렌더됨)
  subject: string | null;
  isAd: boolean;
  createdBy: string | null;
  sendChannel: string;             // 'sms' | 'alimtalk'
  callbackNumber: string;
  kakaoTemplateId: string | null;
  mmsImagePaths: string | null;    // JSON 문자열 또는 null
}

/** KST 기준 오늘 날짜(YYYY-MM-DD). */
function kstDateString(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * (journey, step, 오늘 KST)당 campaign find-or-create. 매핑 테이블 ON CONFLICT로 동시 진입에도 1건만.
 */
export async function getOrCreateStepCampaign(spec: StepCampaignSpec): Promise<string> {
  const sendDate = kstDateString();

  // 1. 이미 있으면 그대로
  const ex = await query(
    `SELECT campaign_id FROM journey_step_campaigns
      WHERE journey_id = $1::uuid AND step_id = $2::uuid AND send_date = $3`,
    [spec.journeyId, spec.stepId, sendDate],
  );
  if (ex.rows.length > 0) return ex.rows[0].campaign_id as string;

  // 2. 신규 campaign (target/sent 0 — 발송마다 +1 누적). 원본 INSERT 컬럼 매핑 1:1.
  const camp = await query(
    `INSERT INTO campaigns (
       company_id, campaign_name, message_type, message_content, subject, message_subject, message_template,
       is_ad, target_count, sent_count, created_by, send_channel, callback_number, status, scheduled_at, sent_at, kakao_template_id, mms_image_paths
     ) VALUES (
       $1::uuid, $2, $3, $4, $5, $5, $4,
       $6, 0, 0, $7::uuid, $9, $8, 'sending', NOW(), NOW(), $10::uuid, $11
     ) RETURNING id`,
    [
      spec.companyId,
      `[여정] step ${spec.stepOrder}`,
      spec.msgType,
      spec.representativeMessage,
      spec.subject,
      spec.isAd,
      spec.createdBy,
      spec.callbackNumber,
      spec.sendChannel,
      spec.kakaoTemplateId,
      spec.mmsImagePaths,
    ],
  );
  const newId = camp.rows[0].id as string;

  // 3. 매핑 claim — 동시 진입 시 한 쪽만 성공
  const claim = await query(
    `INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
     ON CONFLICT (journey_id, step_id, send_date) DO NOTHING
     RETURNING campaign_id`,
    [spec.journeyId, spec.stepId, sendDate, newId],
  );
  if (claim.rows.length > 0) return newId;

  // 경쟁 패배 — 방금 만든 orphan campaign 삭제 후 승자 사용
  await query(`DELETE FROM campaigns WHERE id = $1::uuid`, [newId]);
  const re = await query(
    `SELECT campaign_id FROM journey_step_campaigns
      WHERE journey_id = $1::uuid AND step_id = $2::uuid AND send_date = $3`,
    [spec.journeyId, spec.stepId, sendDate],
  );
  return re.rows[0].campaign_id as string;
}

/** 발송 1건 성공마다 공유 campaign 카운트 +1. */
export async function bumpStepCampaignCount(campaignId: string): Promise<void> {
  await query(
    `UPDATE campaigns SET target_count = target_count + 1, sent_count = sent_count + 1, updated_at = NOW()
      WHERE id = $1::uuid`,
    [campaignId],
  );
}
