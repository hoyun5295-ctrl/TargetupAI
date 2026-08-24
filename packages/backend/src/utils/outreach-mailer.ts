/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 자사 발신 CT (영업 전용 계정)
 * 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-6.
 *
 * - 발신 계정 = 영업 전용(hanjul@invitocorp.com · Harold 0824 확정). 정산·세금계산서 계정(SMTP_USER)과
 *   분리된 별도 ENV 축(OUTREACH_SMTP_USER/PASS) — 영업 메일 평판이 거래 메일에 얹히지 않게(회의 R6).
 * - 결과는 3값 sent|rejected|unknown. "모른다"를 성공으로 세지 않는다(H16 · 두 값으로 세 상태 금지).
 *   기존 인라인 transporter 3곳(billing·companies·invoice-confirm)은 sendMail 반환값을 버린다 —
 *   이 CT는 반환 계약으로 그 결함을 복제하지 않는다. 기존 3곳 흡수 = 별도 과제(축 규율).
 * - 수신처는 인자로 받지 않는다 — 코드·ENV 고정(오발송 구조적 0 · 외부 발송 배관은 v3에서 승인 큐와 함께).
 */
import nodemailer from 'nodemailer';
import { isRecipientRejected } from './billing-recipients';
import { INVITO_INFO } from '../config/defaults';

export type OutreachMailOutcome = 'sent' | 'rejected' | 'unknown';

/** 발신 준비 여부 — 영업 전용 계정 ENV가 없으면 발송 축 전체를 정직하게 잠근다(폴백·차용 금지). */
export function isOutreachMailerReady(): boolean {
  return !!((process.env.OUTREACH_SMTP_USER || '').trim() && (process.env.OUTREACH_SMTP_PASS || '').trim());
}

/** 자사 수신함 주소(전달용 완성본 1통의 수신처) — 기본 = INVITO_INFO.email(mobile@invitocorp.com). */
export function outreachMailTo(): string {
  return (process.env.OUTREACH_MAIL_TO || INVITO_INFO.email).trim();
}

export async function sendOutreachProposalMail(input: {
  subject: string;
  html: string;
}): Promise<{ outcome: OutreachMailOutcome; detail: string }> {
  if (!isOutreachMailerReady()) {
    return { outcome: 'unknown', detail: '영업 발신 계정(OUTREACH_SMTP_USER/PASS)이 설정되지 않았습니다.' };
  }
  const to = outreachMailTo();
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hiworks.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: {
      user: (process.env.OUTREACH_SMTP_USER || '').trim(),
      pass: (process.env.OUTREACH_SMTP_PASS || '').trim(),
    },
  });

  try {
    const info: any = await transporter.sendMail({
      from: `"한줄로 제안" <${(process.env.OUTREACH_SMTP_USER || '').trim()}>`,
      to,
      subject: input.subject,
      html: input.html,
    });
    // nodemailer는 일부 수신자 거부여도 resolve한다 — rejected 배열을 반드시 본다(회의 R7).
    if (isRecipientRejected(info, to)) {
      return { outcome: 'rejected', detail: `수신 주소가 거부되었습니다: ${to}` };
    }
    const accepted: string[] = Array.isArray(info?.accepted) ? info.accepted.map((x: any) => String(x)) : [];
    if (accepted.some((a) => a.toLowerCase().includes(to.toLowerCase()))) {
      return { outcome: 'sent', detail: String(info?.messageId || '') };
    }
    // accepted에도 rejected에도 없음 = 서버는 받았는데 수신자 확인 불가 — 성공으로 접지 않는다.
    return { outcome: 'unknown', detail: '발송 결과를 확인하지 못했습니다(수신함 도착을 직접 확인해주세요).' };
  } catch (err: any) {
    console.error('[sales-outreach] 메일 발송 실패:', err?.message);
    return { outcome: 'unknown', detail: '발송 요청이 실패했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
