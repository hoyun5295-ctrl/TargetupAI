/**
 * ★ CT-36: Email 채널 컨트롤타워 — D215+ 전면 재작성 (2026-05-25)
 *
 * 🎯 목적
 *   회사 admin 본인 SMTP relay 활용 Email 캠페인 — campaign 신설 + send + event 트래킹.
 *   D215+ 정정: 옛 SendGrid 한줄로 마스터 흐름 영구 폐기 → CT-85 company-smtp-client 회사별 SMTP relay 활용.
 *
 * 📋 DB 테이블
 *   - email_campaigns: 캠페인 메타 (회사/제목/HTML/발송일자/상태/통계)
 *   - email_events: open/click/bounce/unsubscribe 이벤트 누적
 *
 * ⛔ 영구 원칙
 *   - 발송 시점 안전장치 — 회사 SMTP 미설정 시 차단 + 미래 1분+ / 08:00~21:00 KST / 즉시 confirm
 *   - Zero-Count #2 — recipients 0건 시 발송 차단
 *   - 정보통신망법 — (광고) prefix + 무료거부 링크 (광고성 이메일)
 *   - 사용자 신뢰 #4 — 모델명 노출 X / 발송 결과 투명 표시
 *   - 발신 도메인 = 회사 admin 본인 도메인 (한줄로 도메인 사용 X — SaaS 핵심)
 */

import { query } from '../config/database';
import { sendEmail, isSmtpConfigured, getSmtpConfigPublic } from './company-smtp-client';
import { applyTracking, UNSUB_URL_MARKER } from './email-tracking';
import { logCampaignTraining, updateTrainingMetrics, getSourceRef } from './training-logger';
import { buildEmailTrainingMessage } from './email-training-message';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type EmailCampaignStatus = 'draft' | 'scheduled' | 'sending' | 'completed' | 'failed';

/** 예약 발송 대상 명세 — scheduled 캠페인의 발송 시점 수신자 해석 기준 (email-send-sweeper 소비) */
export type EmailTargetSpec =
  | { type: 'customers'; grades?: string[] }
  | { type: 'list'; recipients: Array<{ email: string; name?: string }> };

export interface EmailCampaign {
  id: string;
  companyId: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  fromName: string;
  fromEmail: string;
  isAd: boolean;
  aiGenerated: boolean;
  targetSpec: EmailTargetSpec | null;
  scheduledAt: Date | null;
  sentAt: Date | null;
  status: EmailCampaignStatus;
  sentCount: number;
  openCount: number;
  clickCount: number;
  bounceCount: number;
  unsubscribeCount: number;
  createdBy: string | null;
  createdAt: Date;
}

export interface CreateCampaignInput {
  companyId: string;
  createdBy: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  fromName?: string;
  fromEmail?: string;
  isAd?: boolean;
  aiGenerated?: boolean;
  scheduledAt?: Date;
}

export interface EmailRecipient { email: string; name?: string; substitutions?: Record<string, string> }

export interface SendCampaignInput {
  campaignId: string;
  recipients: EmailRecipient[];
  immediate?: boolean;
}

// ════════════════════════════════════════════════════════════════════
// Campaign CRUD
// ════════════════════════════════════════════════════════════════════

/**
 * 신규 캠페인 생성 — fromEmail/fromName 기본값 = 회사 SMTP 설정 안 from_email/from_name 활용.
 */
export async function createEmailCampaign(input: CreateCampaignInput): Promise<EmailCampaign> {
  // 회사 SMTP 설정 안 from_email/from_name 기본값 사용
  const smtpConfig = await getSmtpConfigPublic(input.companyId);
  const defaultFromEmail = input.fromEmail || smtpConfig?.fromEmail || '';
  const defaultFromName = input.fromName || smtpConfig?.fromName || '한줄로AI';

  if (!defaultFromEmail) {
    throw new Error('fromEmail 필수 — 회사 admin SMTP 설정 안 from_email 등록 후 진입 의무');
  }

  const result = await query(
    `INSERT INTO email_campaigns (
      id, company_id, created_by, name, subject, html_body, text_body,
      from_name, from_email, is_ad, scheduled_at, status,
      sent_count, open_count, click_count, bounce_count, unsubscribe_count,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      0, 0, 0, 0, 0,
      NOW(), NOW()
    ) RETURNING *`,
    [
      input.companyId,
      input.createdBy,
      input.name.slice(0, 200),
      input.subject.slice(0, 200),
      input.htmlBody,
      input.textBody || null,
      defaultFromName.slice(0, 100),
      defaultFromEmail,
      !!input.isAd,
      input.scheduledAt || null,
      input.scheduledAt ? 'scheduled' : 'draft',
    ]
  );
  const campaign = mapRow(result.rows[0]);

  // ai_generated 마킹은 신규 컬럼(별도 ALTER) 참조 — 기존 INSERT 경로 무손상 위해 분리.
  // 컬럼 미존재(ALTER 전) 시 throw → 호출 route의 503 분기가 처리 (db_alter_safety_net).
  if (input.aiGenerated) {
    await query(`UPDATE email_campaigns SET ai_generated = true WHERE id = $1::uuid`, [campaign.id]);
    campaign.aiGenerated = true;
  }
  return campaign;
}

export async function listEmailCampaigns(companyId: string, limit: number = 50): Promise<EmailCampaign[]> {
  const result = await query(
    `SELECT * FROM email_campaigns WHERE company_id = $1::uuid
     ORDER BY created_at DESC LIMIT $2`,
    [companyId, Math.min(limit, 200)]
  );
  return result.rows.map(mapRow);
}

export async function getEmailCampaign(companyId: string, campaignId: string): Promise<EmailCampaign | null> {
  const result = await query(
    `SELECT * FROM email_campaigns WHERE id = $1::uuid AND company_id = $2::uuid`,
    [campaignId, companyId]
  );
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

export async function updateEmailCampaign(
  companyId: string,
  campaignId: string,
  patch: Partial<CreateCampaignInput>,
): Promise<EmailCampaign | null> {
  const result = await query(
    `UPDATE email_campaigns SET
       name = COALESCE($3, name),
       subject = COALESCE($4, subject),
       html_body = COALESCE($5, html_body),
       text_body = COALESCE($6, text_body),
       from_name = COALESCE($7, from_name),
       from_email = COALESCE($8, from_email),
       is_ad = COALESCE($9, is_ad),
       scheduled_at = COALESCE($10, scheduled_at),
       updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING *`,
    [
      campaignId,
      companyId,
      patch.name ?? null,
      patch.subject ?? null,
      patch.htmlBody ?? null,
      patch.textBody ?? null,
      patch.fromName ?? null,
      patch.fromEmail ?? null,
      patch.isAd === undefined ? null : patch.isAd,
      patch.scheduledAt ?? null,
    ]
  );
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

export async function deleteEmailCampaign(companyId: string, campaignId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM email_campaigns WHERE id = $1::uuid AND company_id = $2::uuid RETURNING id`,
    [campaignId, companyId]
  );
  return result.rows.length > 0;
}

// ════════════════════════════════════════════════════════════════════
// 발송 — 회사 SMTP relay 활용 (CT-85 sendEmail 호출)
// ════════════════════════════════════════════════════════════════════

/**
 * 캠페인 발송 — 회사 admin SMTP relay 활용. 옛 SendGrid 흐름 영구 폐기.
 * 흐름:
 *   1. 회사 SMTP 설정 완료 검증 (미완료 시 차단)
 *   2. recipients 0건 검증 (Zero-Count 영구 룰)
 *   3. status = 'sending' 갱신
 *   4. 광고성 prefix + 무료거부 자동 합성 (is_ad = true 시)
 *   5. recipients batch 100건 단위 — 회사 SMTP 한도 보호 (Google Workspace 2,000건/일 등 회사별 한도 다양)
 *   6. 발송 완료 후 status = 'completed' 갱신
 *   7. 발송 실패 시 status = 'failed' 갱신 + 에러 throw
 */
export async function sendEmailCampaign(input: SendCampaignInput): Promise<{ messageId: string; sentCount: number }> {
  // 캠페인 조회
  const campaignRes = await query(
    `SELECT * FROM email_campaigns WHERE id = $1::uuid`,
    [input.campaignId]
  );
  if (campaignRes.rows.length === 0) {
    throw new Error('캠페인을 찾을 수 없습니다.');
  }
  const campaign = mapRow(campaignRes.rows[0]);

  // 회사 SMTP 설정 검증
  const smtpReady = await isSmtpConfigured(campaign.companyId);
  if (!smtpReady) {
    throw new Error('회사 SMTP 설정 미완료 — 회사 admin이 SMTP 정보 등록 후 발송 진입 의무');
  }

  // Zero-Count 영구 원칙
  if (input.recipients.length === 0) {
    throw new Error('수신자 0건 — Zero-Count 영구 원칙 발송 차단.');
  }

  // 발송 직전 status 갱신
  await query(
    `UPDATE email_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1::uuid`,
    [campaign.id]
  );

  // 광고성 prefix + 무료거부 자동 합성 — 수신거부는 마커로 두고 발송 시 수신자별 개인 토큰 URL로 치환(applyTracking)
  let finalSubject = campaign.subject;
  let finalHtml = campaign.htmlBody;
  if (campaign.isAd) {
    if (!finalSubject.startsWith('(광고)')) finalSubject = `(광고) ${finalSubject}`;
    if (!finalHtml.includes('수신거부') && !finalHtml.includes('unsubscribe')) {
      finalHtml += `\n\n<hr><p style="font-size:11px;color:#999;text-align:center">본 메일은 ${campaign.fromName}의 광고 정보입니다. 수신을 원하지 않으시면 <a href="${UNSUB_URL_MARKER}">수신거부</a>를 눌러주세요.</p>`;
    }
  }

  let lastMessageId = '';
  let totalAccepted = 0;
  let totalRejected = 0;

  try {
    // SMTP relay batch 100건 단위 — 회사 SMTP 한도 보호
    const BATCH_SIZE = 100;
    for (let i = 0; i < input.recipients.length; i += BATCH_SIZE) {
      const batch = input.recipients.slice(i, i + BATCH_SIZE);
      for (const recipient of batch) {
        try {
          // 개인화 변수 치환 (substitutions {{변수}} 패턴)
          let personalizedHtml = finalHtml;
          let personalizedSubject = finalSubject;
          if (recipient.substitutions) {
            for (const [key, value] of Object.entries(recipient.substitutions)) {
              const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
              personalizedHtml = personalizedHtml.replace(pattern, value);
              personalizedSubject = personalizedSubject.replace(pattern, value);
            }
          }
          if (recipient.name) {
            // {{이름}} 기본 개인화 — substitutions에 이름이 따로 없을 때
            personalizedHtml = personalizedHtml.replace(/\{\{\s*이름\s*\}\}/g, recipient.name);
            personalizedSubject = personalizedSubject.replace(/\{\{\s*이름\s*\}\}/g, recipient.name);
          }

          // 오픈 픽셀 + 클릭 래핑 + 개인 토큰 수신거부 URL 치환 (수신자별)
          personalizedHtml = applyTracking(personalizedHtml, campaign.id, recipient.email);

          const result = await sendEmail({
            companyId: campaign.companyId,
            to: recipient.name ? { email: recipient.email, name: recipient.name } : recipient.email,
            subject: personalizedSubject,
            htmlBody: personalizedHtml,
            textBody: campaign.textBody || undefined,
          });
          lastMessageId = result.messageId || lastMessageId;
          const acceptedN = result.accepted.length;
          totalAccepted += acceptedN;
          totalRejected += result.rejected.length;
          // 발송 성공 수신자 = delivered 이벤트 적재 (수신자별 이력/미오픈자 추출 토대). 실패해도 발송 흐름 유지.
          if (acceptedN > 0) {
            try {
              await recordEmailEvent({
                campaignId: campaign.id,
                email: recipient.email,
                eventType: 'delivered',
                occurredAt: new Date(),
              });
            } catch (evErr: any) {
              console.warn(`[Email] delivered 기록 실패 (${recipient.email}): ${evErr?.message}`);
            }
          }
        } catch (sendErr: any) {
          totalRejected += 1;
          console.warn(`[Email] 개별 발송 실패 (${recipient.email}): ${sendErr?.message}`);
        }
      }
      // batch 완료마다 sent_count + updated_at 갱신 — 진행 폴링 + sweeper 정체 감지(살아있음 신호)
      await query(
        `UPDATE email_campaigns SET sent_count = $2, updated_at = NOW() WHERE id = $1::uuid`,
        [campaign.id, totalAccepted]
      );
      // batch 간 1초 sleep — 회사 SMTP rate-limit 차단
      if (i + BATCH_SIZE < input.recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    await query(
      `UPDATE email_campaigns SET
         status = 'completed',
         sent_at = NOW(),
         sent_count = $2,
         updated_at = NOW()
       WHERE id = $1::uuid`,
      [campaign.id, totalAccepted]
    );

    // 인비토AI 학습 적재 — 이메일 발송 단일 길목(즉시·예약 공통). fire-and-forget, source_ref(campaignId) 멱등, 발송·돈 영향 0.
    //   finalMessage = 원본 제목+본문(광고 footer 합성 전). 마스킹은 logTrainingData가 별도. metrics = 발송 실측(시도/성공/실패).
    void logCampaignTraining({
      campaignId: campaign.id,
      companyId: campaign.companyId,
      messageType: 'EMAIL',
      isAd: campaign.isAd,
      targetCount: input.recipients.length,
      finalMessage: buildEmailTrainingMessage(campaign.subject, campaign.textBody, campaign.htmlBody),
      finalSource: campaign.aiGenerated ? 'selected_as_is' : 'manual',
      sendAt: new Date(),
    })
      .then(() => updateTrainingMetrics({
        sourceRef: getSourceRef(campaign.id),
        sentCount: totalAccepted + totalRejected,
        successCount: totalAccepted,
        failCount: totalRejected,
      }))
      .catch(() => {});

    return { messageId: lastMessageId, sentCount: totalAccepted };
  } catch (err: any) {
    await query(
      `UPDATE email_campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1::uuid`,
      [campaign.id]
    );
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
// Event 트래킹 (외부 호출 — SMTP relay 안 자체 webhook 활용 X)
//   D215+ 정정: 옛 SendGrid Event Webhook 호출 흐름 영구 폐기.
//   회사 admin 본인 SMTP relay 활용 = open/click 트래킹 영역 = 자체 픽셀/링크 추적 imported 흐름.
// ════════════════════════════════════════════════════════════════════

export interface EmailEventInput {
  campaignId: string;
  email: string;
  eventType: 'open' | 'click' | 'bounce' | 'unsubscribe' | 'spam_report' | 'dropped' | 'delivered';
  url?: string;
  reason?: string;
  occurredAt: Date;
}

export async function recordEmailEvent(input: EmailEventInput): Promise<void> {
  const { campaignId, email, eventType, url, reason, occurredAt } = input;
  await query(
    `INSERT INTO email_events (
      id, campaign_id, email, event_type, url, reason, occurred_at, auto_processed, created_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, false, NOW()
    )`,
    [campaignId, email, eventType, url || null, reason || null, occurredAt]
  );

  // 캠페인 통계 갱신 — 고유 수신자 1회만 카운트 (같은 사람 반복 오픈/클릭에 카운터 부풀림 차단 → 오픈율 100% 초과 방지).
  //   delivered = 카운터 없음. open/click/unsubscribe/bounce = 해당 email 첫 이벤트일 때만 +1.
  const column = {
    open: 'open_count',
    click: 'click_count',
    bounce: 'bounce_count',
    unsubscribe: 'unsubscribe_count',
    spam_report: 'bounce_count',
    dropped: 'bounce_count',
    delivered: null,
  }[eventType];

  if (column) {
    // INSERT 직후 이 (campaign, email, event_type) 누적 건수 = 1 이면 첫 발생 → 카운터 증가.
    const dupCheckTypes = eventType === 'spam_report' ? ['spam_report'] : eventType === 'dropped' ? ['dropped'] : [eventType];
    const cntRes = await query(
      `SELECT COUNT(*)::int AS n FROM email_events WHERE campaign_id = $1::uuid AND email = $2 AND event_type = ANY($3)`,
      [campaignId, email, dupCheckTypes]
    );
    if ((cntRes.rows[0]?.n || 0) <= 1) {
      await query(
        `UPDATE email_campaigns SET ${column} = ${column} + 1, updated_at = NOW() WHERE id = $1::uuid`,
        [campaignId]
      );
    }
  }

  // ★ D210+ Phase 3 B-5 (Harold 명시 2026-05-23): bounce / spam / unsubscribe 자동 처리
  //   bounce / spam_report / unsubscribe 이벤트 수신 시 customers 자동 unsubscribe.
  //   email_opt_in = false 갱신 + email_events.auto_processed = true
  if (eventType === 'bounce' || eventType === 'spam_report' || eventType === 'unsubscribe') {
    try {
      // 회사 ID = email_campaigns → company_id 매핑
      const cmp = await query(
        `SELECT company_id FROM email_campaigns WHERE id = $1::uuid LIMIT 1`,
        [campaignId]
      );
      const companyId = cmp.rows[0]?.company_id;
      if (companyId) {
        // customers 자동 처리 — email 매칭 + email_opt_in false
        await query(
          `UPDATE customers SET
             email_opt_in = false,
             updated_at = NOW()
           WHERE company_id = $1::uuid
             AND email = $2
             AND email_opt_in = true`,
          [companyId, email]
        );
        // email_events.auto_processed = true 갱신
        await query(
          `UPDATE email_events SET auto_processed = true
           WHERE campaign_id = $1::uuid AND email = $2 AND event_type = $3
             AND occurred_at = $4`,
          [campaignId, email, eventType, occurredAt]
        );
      }
    } catch (err: any) {
      console.warn('[Email] 자동 unsubscribe 처리 오류 (silent skip):', err?.message);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// 수신자 해석 — 고객DB(customers) 연동
//   안전 필터(보수적): email 유효 + 수신거부/무효 신호 전부 제외.
//   email_opt_in = false(이메일 바운스·수신거부) / is_opt_out = true(전체 마케팅 거부) / is_invalid = true(무효 연락처)
// ════════════════════════════════════════════════════════════════════

const RECIPIENT_SAFETY_WHERE = `
  email IS NOT NULL AND email LIKE '%@%'
  AND email_opt_in IS DISTINCT FROM false
  AND is_opt_out IS DISTINCT FROM true
  AND is_invalid IS DISTINCT FROM true`;

/** 발송 대상 고객 해석 — 회사 격리 + 안전 필터 + 선택 등급. 발송 엔진/스위퍼가 소비. */
export async function resolveCustomerRecipients(
  companyId: string,
  grades?: string[],
): Promise<EmailRecipient[]> {
  const params: any[] = [companyId];
  let gradeClause = '';
  if (grades && grades.length > 0) {
    params.push(grades);
    gradeClause = ` AND grade = ANY($${params.length})`;
  }
  const result = await query(
    `SELECT DISTINCT ON (lower(email)) email, name
     FROM customers
     WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}${gradeClause}
     ORDER BY lower(email)`,
    params,
  );
  return result.rows.map((r: any) => ({
    email: String(r.email).trim(),
    name: r.name ? String(r.name) : undefined,
  }));
}

/** 발송 전 미리보기 — 대상 인원 + 등급 분포 + 표본 (RecipientsModal 고객DB 탭). */
export async function previewCustomerRecipients(
  companyId: string,
  grades?: string[],
): Promise<{ total: number; gradeBreakdown: Array<{ grade: string; count: number }>; sample: string[] }> {
  const params: any[] = [companyId];
  let gradeClause = '';
  if (grades && grades.length > 0) {
    params.push(grades);
    gradeClause = ` AND grade = ANY($${params.length})`;
  }
  const totalRes = await query(
    `SELECT COUNT(DISTINCT lower(email))::int AS total
     FROM customers WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}${gradeClause}`,
    params,
  );
  const breakdownRes = await query(
    `SELECT COALESCE(NULLIF(grade, ''), '미지정') AS grade, COUNT(DISTINCT lower(email))::int AS count
     FROM customers WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}${gradeClause}
     GROUP BY COALESCE(NULLIF(grade, ''), '미지정') ORDER BY count DESC`,
    params,
  );
  const sampleRes = await query(
    `SELECT DISTINCT ON (lower(email)) email
     FROM customers WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}${gradeClause}
     ORDER BY lower(email) LIMIT 5`,
    params,
  );
  return {
    total: totalRes.rows[0]?.total || 0,
    gradeBreakdown: breakdownRes.rows.map((r: any) => ({ grade: r.grade, count: Number(r.count) || 0 })),
    sample: sampleRes.rows.map((r: any) => String(r.email)),
  };
}

/** 회사 전체 등급 목록 (고객DB 탭 등급 선택지) */
export async function listCustomerGrades(companyId: string): Promise<Array<{ grade: string; count: number }>> {
  const result = await query(
    `SELECT COALESCE(NULLIF(grade, ''), '미지정') AS grade, COUNT(*)::int AS count
     FROM customers WHERE company_id = $1::uuid AND ${RECIPIENT_SAFETY_WHERE}
     GROUP BY COALESCE(NULLIF(grade, ''), '미지정') ORDER BY count DESC`,
    [companyId],
  );
  return result.rows.map((r: any) => ({ grade: r.grade, count: Number(r.count) || 0 }));
}

// ════════════════════════════════════════════════════════════════════
// 예약 발송 — target_spec 저장 (신규 ALTER 컬럼 — 503 분기 보호 대상)
// ════════════════════════════════════════════════════════════════════

/** 예약 발송 설정 — target_spec + scheduled_at 저장 + status='scheduled'. sweeper가 도래 시 발송. */
export async function scheduleCampaign(
  companyId: string,
  campaignId: string,
  targetSpec: EmailTargetSpec,
  scheduledAt: Date,
): Promise<EmailCampaign | null> {
  const result = await query(
    `UPDATE email_campaigns
       SET target_spec = $3::jsonb, scheduled_at = $4, status = 'scheduled', updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING *`,
    [campaignId, companyId, JSON.stringify(targetSpec), scheduledAt],
  );
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

// ════════════════════════════════════════════════════════════════════
// 성과 집계 — 실측만 (추정치 0). email-ai insight / send-time / non-openers 소비.
// ════════════════════════════════════════════════════════════════════

/** 캠페인 실측 성과 — 고유 오픈/클릭 + 오픈 시간대(KST) 분포. */
export async function getCampaignPerformanceStats(campaignId: string): Promise<{
  sentCount: number;
  uniqueOpeners: number;
  uniqueClickers: number;
  bounceCount: number;
  unsubscribeCount: number;
  openRatePct: number | null;
  clickRatePct: number | null;
  topOpenHours: Array<{ hour: number; cnt: number }>;
}> {
  const campRes = await query(
    `SELECT sent_count, bounce_count, unsubscribe_count FROM email_campaigns WHERE id = $1::uuid`,
    [campaignId],
  );
  const sentCount = Number(campRes.rows[0]?.sent_count) || 0;
  const bounceCount = Number(campRes.rows[0]?.bounce_count) || 0;
  const unsubscribeCount = Number(campRes.rows[0]?.unsubscribe_count) || 0;

  const uniqRes = await query(
    `SELECT
       COUNT(DISTINCT email) FILTER (WHERE event_type = 'open')::int AS openers,
       COUNT(DISTINCT email) FILTER (WHERE event_type = 'click')::int AS clickers
     FROM email_events WHERE campaign_id = $1::uuid`,
    [campaignId],
  );
  const uniqueOpeners = Number(uniqRes.rows[0]?.openers) || 0;
  const uniqueClickers = Number(uniqRes.rows[0]?.clickers) || 0;

  const hourRes = await query(
    `SELECT EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Asia/Seoul')::int AS hour, COUNT(*)::int AS cnt
     FROM email_events WHERE campaign_id = $1::uuid AND event_type = 'open'
     GROUP BY 1 ORDER BY 2 DESC`,
    [campaignId],
  );

  return {
    sentCount,
    uniqueOpeners,
    uniqueClickers,
    bounceCount,
    unsubscribeCount,
    openRatePct: sentCount > 0 ? Math.round((uniqueOpeners / sentCount) * 1000) / 10 : null,
    clickRatePct: sentCount > 0 ? Math.round((uniqueClickers / sentCount) * 1000) / 10 : null,
    topOpenHours: hourRes.rows.map((r: any) => ({ hour: Number(r.hour), cnt: Number(r.cnt) })),
  };
}

/** 회사 전체 오픈 시간대 분포(최근 90일, KST) — 발송 시간 추천. */
export async function getCompanyOpenHourDistribution(companyId: string): Promise<Array<{ hour: number; cnt: number }>> {
  const result = await query(
    `SELECT EXTRACT(HOUR FROM ev.occurred_at AT TIME ZONE 'Asia/Seoul')::int AS hour, COUNT(*)::int AS cnt
     FROM email_events ev
     JOIN email_campaigns c ON c.id = ev.campaign_id
     WHERE c.company_id = $1::uuid AND ev.event_type = 'open'
       AND ev.occurred_at >= NOW() - INTERVAL '90 days'
     GROUP BY 1 ORDER BY 1`,
    [companyId],
  );
  return result.rows.map((r: any) => ({ hour: Number(r.hour), cnt: Number(r.cnt) }));
}

/** 미오픈자 — delivered 있고 open 없는 수신 이메일 → customers phone 매칭 (SMS 크로스 채널). */
export async function getCampaignNonOpeners(companyId: string, campaignId: string): Promise<{
  matched: Array<{ phone: string; name: string | null }>;
  unmatchedCount: number;
  totalNonOpeners: number;
}> {
  const nonOpenRes = await query(
    `SELECT DISTINCT d.email
     FROM email_events d
     WHERE d.campaign_id = $1::uuid AND d.event_type = 'delivered'
       AND NOT EXISTS (
         SELECT 1 FROM email_events o
         WHERE o.campaign_id = $1::uuid AND o.event_type = 'open' AND lower(o.email) = lower(d.email)
       )`,
    [campaignId],
  );
  const emails = nonOpenRes.rows.map((r: any) => String(r.email));
  const totalNonOpeners = emails.length;
  if (emails.length === 0) return { matched: [], unmatchedCount: 0, totalNonOpeners: 0 };

  const matchRes = await query(
    `SELECT DISTINCT ON (lower(email)) phone, name
     FROM customers
     WHERE company_id = $1::uuid AND lower(email) = ANY($2)
       AND phone IS NOT NULL AND phone <> ''
       AND is_opt_out IS DISTINCT FROM true AND is_invalid IS DISTINCT FROM true
     ORDER BY lower(email)`,
    [companyId, emails.map((e) => e.toLowerCase())],
  );
  const matched = matchRes.rows.map((r: any) => ({ phone: String(r.phone), name: r.name ? String(r.name) : null }));
  return { matched, unmatchedCount: Math.max(0, totalNonOpeners - matched.length), totalNonOpeners };
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

function mapRow(row: any): EmailCampaign {
  // ai_generated / target_spec = 신규 ALTER 컬럼. SELECT * 결과에 없으면(ALTER 전) undefined → 기본값.
  let targetSpec: EmailTargetSpec | null = null;
  if (row.target_spec) {
    try {
      targetSpec = typeof row.target_spec === 'string' ? JSON.parse(row.target_spec) : row.target_spec;
    } catch { targetSpec = null; }
  }
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    subject: row.subject,
    htmlBody: row.html_body,
    textBody: row.text_body,
    fromName: row.from_name,
    fromEmail: row.from_email,
    isAd: !!row.is_ad,
    aiGenerated: !!row.ai_generated,
    targetSpec,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    status: row.status,
    sentCount: row.sent_count || 0,
    openCount: row.open_count || 0,
    clickCount: row.click_count || 0,
    bounceCount: row.bounce_count || 0,
    unsubscribeCount: row.unsubscribe_count || 0,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
}
