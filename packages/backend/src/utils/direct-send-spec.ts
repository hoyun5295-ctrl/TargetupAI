/**
 * direct-send-spec.ts — 직접발송 campaign INSERT 스펙(순수)
 *
 * /direct-send/commit과 자동마케팅 자율 발송이 공유하는 campaign 생성 파라미터를 합성한다.
 * DB 미import(순수) — 컬럼 순서/기본값 회귀를 테스트로 고정.
 * 실제 INSERT/차감/트리거는 direct-send-core.ts createDirectSendCampaign가 수행.
 */

export class DirectSendError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: number = 400,
    public extra?: any,
  ) {
    super(message);
    this.name = 'DirectSendError';
  }
}

export interface DirectSendSpec {
  stagingId: string;
  campaignName: string;
  msgType: string;
  total: number;                 // countStagingFiltered.sendCount (정제 후 발송 예정)
  message?: string | null;
  subject?: string | null;
  callback?: string | null;
  sendChannel?: string;          // 'sms' | 'kakao' | 'alimtalk' ...
  adEnabled?: boolean;
  scheduled?: boolean;
  scheduledAt?: string | null;
  splitEnabled?: boolean;
  splitCount?: number;
  useIndividualCallback?: boolean;
  individualCallbackColumn?: string | null;
  mmsImagePaths?: string[] | null;
  dedupEnabled?: boolean;
  unsubFilterEnabled?: boolean;
  // kakao
  kakaoBubbleType?: string | null;
  kakaoSenderKey?: string | null;
  kakaoTargeting?: string | null;
  kakaoAttachmentJson?: string | null;
  kakaoCarouselJson?: string | null;
  kakaoResendType?: string | null;
  // alimtalk
  alimtalkTemplateCode?: string | null;
  alimtalkVariableMap?: any;
  alimtalkButtonJson?: string | null;
  alimtalkNextType?: string | null;
  alimtalkNextContents?: string | null;
  alimtalkNextSubject?: string | null;
  alimtalkEtcJson?: string | null;
  alimtalkTemplateUuid?: string | null;   // campaigns.kakao_template_id FK
}

// campaigns INSERT — 컬럼 순서 고정(/direct-send/commit 원본과 동일). send_type='direct', processed_count=0, created_at=NOW().
// ★ 2026-07-30 (3R): 초기 send_phase='preparing' — 워커 due 쿼리는 'queued'만 집는다.
//   차감이 전부 성공한 뒤에만 createDirectSendCampaign이 'queued'로 전환하므로,
//   차감 도중·보상 도중 어떤 실패가 나도 미차감(또는 부분 차감) 캠페인이 발송될 수 없다(fail-closed).
export const CAMPAIGN_INSERT_SQL =
  `INSERT INTO campaigns (company_id, campaign_name, message_type, message_content, subject, callback_number, target_count, send_type, status, scheduled_at, message_template, message_subject, created_by, is_ad, send_channel, staging_id, send_phase, processed_count, send_config, kakao_template_id, mms_image_paths, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, 'direct', $8, $9, $10, $11, $12, $13, $14, $15, 'preparing', 0, $16, $17, $18, NOW()) RETURNING id`;

/** campaigns INSERT 파라미터($1~$18)를 합성. /direct-send/commit 원본 매핑과 동일. */
export function buildDirectSendCampaignParams(
  spec: DirectSendSpec,
  ctx: { companyId: string; userId: string },
): any[] {
  const finalIsAd = spec.adEnabled === true;
  const directChannel = spec.sendChannel || 'sms';
  const sendConfig = {
    msgType: spec.msgType, sendChannel: directChannel, message: spec.message, subject: spec.subject,
    callback: spec.callback, useIndividualCallback: spec.useIndividualCallback, individualCallbackColumn: spec.individualCallbackColumn,
    adEnabled: finalIsAd, scheduled: spec.scheduled, scheduledAt: spec.scheduledAt,
    splitEnabled: spec.splitEnabled, splitCount: spec.splitCount, mmsImagePaths: spec.mmsImagePaths,
    kakaoBubbleType: spec.kakaoBubbleType, kakaoSenderKey: spec.kakaoSenderKey, kakaoTargeting: spec.kakaoTargeting,
    kakaoAttachmentJson: spec.kakaoAttachmentJson, kakaoCarouselJson: spec.kakaoCarouselJson, kakaoResendType: spec.kakaoResendType,
    alimtalkTemplateCode: spec.alimtalkTemplateCode, alimtalkVariableMap: spec.alimtalkVariableMap, alimtalkButtonJson: spec.alimtalkButtonJson,
    alimtalkNextType: spec.alimtalkNextType, alimtalkNextContents: spec.alimtalkNextContents, alimtalkNextSubject: spec.alimtalkNextSubject,
    alimtalkEtcJson: spec.alimtalkEtcJson,
    dedupEnabled: spec.dedupEnabled, unsubFilterEnabled: spec.unsubFilterEnabled,
  };
  return [
    ctx.companyId,
    spec.campaignName,
    spec.msgType,
    spec.message || '',
    spec.subject || null,
    spec.callback || null,
    spec.total,
    spec.scheduled ? 'scheduled' : 'sending',
    spec.scheduled && spec.scheduledAt ? new Date(spec.scheduledAt) : null,
    spec.message || '',
    spec.subject || null,
    ctx.userId,
    finalIsAd,
    directChannel,
    spec.stagingId,
    JSON.stringify(sendConfig),
    spec.alimtalkTemplateUuid ?? null,
    spec.mmsImagePaths && spec.mmsImagePaths.length > 0 ? JSON.stringify(spec.mmsImagePaths) : null,
  ];
}
