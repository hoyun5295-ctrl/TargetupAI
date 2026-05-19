/**
 * ★ CT-35: SendGrid Web API v3 클라이언트 — D180 (2026-05-19)
 *
 * 🎯 목적
 *   비전 v0.3 § 5-1 D180 — 한줄로 Email 채널 통합. SendGrid Web API v3로 transactional + marketing 발송.
 *   native fetch 박음 (npm @sendgrid/mail 의존성 X — 단순 HTTP API 박음 정합).
 *
 * 📋 SendGrid 표준
 *   - API base: https://api.sendgrid.com/v3
 *   - Mail send: POST /mail/send
 *   - Event Webhook: 별 endpoint (open/click/bounce/unsubscribe 트래킹)
 *
 * 🔐 환경변수 (Harold .env)
 *   - SENDGRID_API_KEY (Bearer token 박음)
 *   - SENDGRID_FROM_DOMAIN (인증된 도메인 — SPF/DKIM/DMARC 박힘)
 *   - SENDGRID_WEBHOOK_PUBLIC_KEY (Event Webhook 서명 검증, ECDSA P-256 박힘)
 *
 * ⛔ 영구 원칙 정합
 *   - 발송 시점 안전장치 박음 — 즉시/예약 confirm
 *   - Zero-Count #2 — target 0건 시 발송 차단
 *   - 정보통신망법 — (광고) prefix + 무료거부 링크 박음 (광고성 이메일)
 */

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDGRID_FROM_DOMAIN = process.env.SENDGRID_FROM_DOMAIN || '';
const SENDGRID_API_BASE = 'https://api.sendgrid.com/v3';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface EmailRecipient {
  email: string;
  name?: string;
  substitutions?: Record<string, string>;  // {{변수}} 박은 영역 치환
}

export interface SendEmailInput {
  from: { email: string; name?: string };
  to: EmailRecipient[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  replyTo?: { email: string; name?: string };
  categories?: string[];
  customArgs?: Record<string, string>;
  sendAt?: Date;
}

export interface SendEmailResult {
  messageId: string;
  acceptedCount: number;
}

// ════════════════════════════════════════════════════════════════════
// 발송
// ════════════════════════════════════════════════════════════════════

export async function sendEmailViaSendGrid(input: SendEmailInput): Promise<SendEmailResult> {
  if (!SENDGRID_API_KEY) {
    throw new Error('SENDGRID_API_KEY 환경변수가 설정되지 않았습니다.');
  }
  if (input.to.length === 0) {
    throw new Error('to 배열은 1건 이상 박혀야 합니다.');
  }
  if (input.to.length > 1000) {
    throw new Error('SendGrid 1회 발송 한도(1,000명) 초과 — 분할 박아주세요.');
  }

  // SendGrid Personalizations 박음 (사용자별 substitution + bcc)
  const personalizations = input.to.map((r) => ({
    to: [{ email: r.email, ...(r.name ? { name: r.name } : {}) }],
    ...(r.substitutions ? { substitutions: r.substitutions } : {}),
  }));

  const body: any = {
    personalizations,
    from: input.from,
    subject: input.subject,
    content: [
      ...(input.textBody ? [{ type: 'text/plain', value: input.textBody }] : []),
      { type: 'text/html', value: input.htmlBody },
    ],
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    ...(input.categories ? { categories: input.categories } : {}),
    ...(input.customArgs ? { custom_args: input.customArgs } : {}),
    ...(input.sendAt ? { send_at: Math.floor(input.sendAt.getTime() / 1000) } : {}),
    tracking_settings: {
      click_tracking: { enable: true, enable_text: false },
      open_tracking: { enable: true },
      subscription_tracking: { enable: false },  // 자체 무료거부 박음 (정보통신망법 정합)
    },
  };

  const res = await fetch(`${SENDGRID_API_BASE}/mail/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await safeText(res);
    throw new Error(`SendGrid 발송 실패 (${res.status}): ${err}`);
  }

  // SendGrid는 X-Message-Id 헤더로 message_id 박음
  const messageId = res.headers.get('x-message-id') || '';
  return {
    messageId,
    acceptedCount: input.to.length,
  };
}

export function isSendGridConfigured(): boolean {
  return !!SENDGRID_API_KEY && !!SENDGRID_FROM_DOMAIN;
}

export function getSendGridFromDomain(): string {
  return SENDGRID_FROM_DOMAIN;
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return '<응답 본문 파싱 실패>'; }
}
