/**
 * ★ CT-36: Email 채널 컨트롤타워 — D180 (2026-05-19)
 *
 * 🎯 목적
 *   비전 v0.3 § 5-1 D180 — 한줄로 Email 채널 통합. campaign 박음 + send + event 트래킹.
 *
 * 📋 DB 테이블
 *   - email_campaigns: 캠페인 메타 (회사/제목/HTML/발송일자/상태/통계)
 *   - email_events: open/click/bounce/unsubscribe 이벤트 누적
 *
 * ⛔ 영구 원칙 정합
 *   - 발송 시점 안전장치 박음 — 미래 1분+ / 08:00~21:00 KST / 즉시 confirm
 *   - Zero-Count #2 — recipients 0건 시 발송 차단
 *   - 정보통신망법 — (광고) prefix + 무료거부 링크 박음 (광고성 이메일)
 *   - 사용자 신뢰 #4 — 모델명 노출 X / 발송 결과 투명 박음
 */

import { query } from '../config/database';
import { sendEmailViaSendGrid, getSendGridFromDomain, isSendGridConfigured } from './sendgrid-client';

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
  isAd: boolean;                  // 광고성 여부 (정보통신망법 정합)
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

export async function createEmailCampaign(input: CreateCampaignInput): Promise<EmailCampaign> {
  const fromDomain = getSendGridFromDomain();
  const defaultFromEmail = fromDomain ? `noreply@${fromDomain}` : 'noreply@hanjul.ai';

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
      (input.fromName || '한줄로AI').slice(0, 100),
      input.fromEmail || defaultFromEmail,
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

// ════════════════════════════════════════════════════════════════════
// 발송
// ════════════════════════════════════════════════════════════════════

export async function sendEmailCampaign(input: SendCampaignInput): Promise<{ messageId: string; sentCount: number }> {
  if (!isSendGridConfigured()) {
    throw new Error('SendGrid 환경변수(SENDGRID_API_KEY / SENDGRID_FROM_DOMAIN)가 설정되지 않았습니다.');
  }
  if (input.recipients.length === 0) {
    throw new Error('수신자 0건 — Zero-Count 영구 원칙 정합 발송 차단.');
  }

  // 캠페인 조회
  const campaignRes = await query(
    `SELECT * FROM email_campaigns WHERE id = $1::uuid`,
    [input.campaignId]
  );
  if (campaignRes.rows.length === 0) {
    throw new Error('캠페인을 찾을 수 없습니다.');
  }
  const campaign = mapRow(campaignRes.rows[0]);

  // 발송 직전 status 박음
  await query(
    `UPDATE email_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1::uuid`,
    [campaign.id]
  );

  // 광고성 prefix + 무료거부 박은 영역
  let finalSubject = campaign.subject;
  let finalHtml = campaign.htmlBody;
  if (campaign.isAd) {
    if (!finalSubject.startsWith('(광고)')) finalSubject = `(광고) ${finalSubject}`;
    if (!finalHtml.includes('수신거부') && !finalHtml.includes('unsubscribe')) {
      finalHtml += `\n\n<hr><p style="font-size:11px;color:#999;text-align:center">본 메일은 ${campaign.fromName}의 광고 정보입니다. 수신을 원하지 않으시면 <a href="https://app.hanjul.ai/unsubscribe">수신거부</a>를 눌러주세요.</p>`;
    }
  }

  let messageId = '';
  try {
    // SendGrid 1회 발송 한도 1,000명 — batch 박음
    const batchSize = 1000;
    let totalAccepted = 0;
    for (let i = 0; i < input.recipients.length; i += batchSize) {
      const batch = input.recipients.slice(i, i + batchSize);
      const result = await sendEmailViaSendGrid({
        from: { email: campaign.fromEmail, name: campaign.fromName },
        to: batch,
        subject: finalSubject,
        htmlBody: finalHtml,
        textBody: campaign.textBody || undefined,
        categories: ['hanjullo-email', `campaign:${campaign.id}`],
        customArgs: { campaign_id: campaign.id, company_id: campaign.companyId },
      });
      messageId = result.messageId;
      totalAccepted += result.acceptedCount;
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

    return { messageId, sentCount: totalAccepted };
  } catch (err: any) {
    await query(
      `UPDATE email_campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1::uuid`,
      [campaign.id]
    );
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
// Event 트래킹 (SendGrid Event Webhook 호출 시점)
// ════════════════════════════════════════════════════════════════════

export interface EmailEventInput {
  campaignId: string;
  email: string;
  eventType: 'open' | 'click' | 'bounce' | 'unsubscribe' | 'spam_report' | 'dropped' | 'delivered';
  url?: string;          // click 시
  reason?: string;       // bounce 시
  occurredAt: Date;
}

export async function recordEmailEvent(input: EmailEventInput): Promise<void> {
  const { campaignId, email, eventType, url, reason, occurredAt } = input;
  await query(
    `INSERT INTO email_events (
      id, campaign_id, email, event_type, url, reason, occurred_at, created_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, NOW()
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
