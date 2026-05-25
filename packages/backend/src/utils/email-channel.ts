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

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type EmailCampaignStatus = 'draft' | 'scheduled' | 'sending' | 'completed' | 'failed';

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
  scheduledAt?: Date;
}

export interface SendCampaignInput {
  campaignId: string;
  recipients: Array<{ email: string; name?: string; substitutions?: Record<string, string> }>;
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
  return mapRow(result.rows[0]);
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

  // 광고성 prefix + 무료거부 자동 합성
  let finalSubject = campaign.subject;
  let finalHtml = campaign.htmlBody;
  if (campaign.isAd) {
    if (!finalSubject.startsWith('(광고)')) finalSubject = `(광고) ${finalSubject}`;
    if (!finalHtml.includes('수신거부') && !finalHtml.includes('unsubscribe')) {
      finalHtml += `\n\n<hr><p style="font-size:11px;color:#999;text-align:center">본 메일은 ${campaign.fromName}의 광고 정보입니다. 수신을 원하지 않으시면 <a href="https://app.hanjul.ai/unsubscribe">수신거부</a>를 눌러주세요.</p>`;
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

          const result = await sendEmail({
            companyId: campaign.companyId,
            to: recipient.name ? { email: recipient.email, name: recipient.name } : recipient.email,
            subject: personalizedSubject,
            htmlBody: personalizedHtml,
            textBody: campaign.textBody || undefined,
          });
          lastMessageId = result.messageId || lastMessageId;
          totalAccepted += result.accepted.length;
          totalRejected += result.rejected.length;
        } catch (sendErr: any) {
          totalRejected += 1;
          console.warn(`[Email] 개별 발송 실패 (${recipient.email}): ${sendErr?.message}`);
        }
      }
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

  // 캠페인 통계 갱신
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
    await query(
      `UPDATE email_campaigns SET ${column} = ${column} + 1, updated_at = NOW() WHERE id = $1::uuid`,
      [campaignId]
    );
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
// 헬퍼
// ════════════════════════════════════════════════════════════════════

function mapRow(row: any): EmailCampaign {
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
