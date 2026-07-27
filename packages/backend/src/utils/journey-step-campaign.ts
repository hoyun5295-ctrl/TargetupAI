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
 * `campaigns.message_type` CHECK 제약이 허용하는 값 — 2026-07-27 `pg_constraint` 실측.
 * 이 목록 밖 값을 넣으면 INSERT가 통째로 깨진다(값이 조용히 무시되는 게 아니다).
 */
const CAMPAIGN_MESSAGE_TYPES = new Set(['SMS', 'LMS', 'MMS', 'KMS', 'FMS', 'GMS']);

/**
 * (순수) 발송 유형 → `campaigns.message_type` 저장값.
 *
 * ★ 2026-07-27 여정 알림톡 전건 실패 정정.
 * 여정 실행기가 알림톡 step에서 `'KAKAO'`를 넣어 `campaigns_message_type_check` 위반으로
 * INSERT가 깨졌고, 6건이 5분마다 재시도하며 발송이 하나도 안 나갔다(step_logs 0건).
 *
 * 이 시스템은 **카카오를 `message_type`이 아니라 `send_channel`로 구분**한다 —
 * 운영 실측: 알림톡 102건이 전부 `message_type='LMS'` + `send_channel='alimtalk'`,
 * 브랜드메시지도 `'LMS'` + `'kakao_brand'`. 여정만 다른 축을 쓰고 있었다.
 *
 * 과금·큐·학습 축의 `'KAKAO'`는 그대로 둔다 — 바뀌는 건 campaigns에 저장하는 값 하나뿐이다.
 * 허용값 밖은 `'LMS'`로 안전 변환한다(이미지 불필요한 유형 — `toQtmsgType`의 안전 기본값과 같은 정신).
 */
export function toCampaignMessageType(msgType: string): string {
  const t = String(msgType ?? '').trim().toUpperCase();
  return CAMPAIGN_MESSAGE_TYPES.has(t) ? t : 'LMS';
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
      // 알림톡(KAKAO)은 CHECK 허용값이 아니다 — 카카오 구분은 아래 send_channel이 담당한다.
      toCampaignMessageType(spec.msgType),
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
