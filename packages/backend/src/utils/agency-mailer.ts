/**
 * utils/agency-mailer.ts — 대행발송 이메일 접수 · 자동 회신 발신 CT (★2026-08-26 §18-5)
 *
 * outreach-mailer의 계약(3값 sent|rejected|unknown · ENV 없으면 정직하게 잠금)을 복제하되 `to`를 받는다.
 * ⛔ `to`는 아무 데나 못 간다 — **그 메일의 발신 주소이면서 활성 허용 목록에 있는 주소**일 때만.
 *   그 게이트는 호출부(메일 워커)의 단일 지점이 소유한다(위조 메일에 답해도 진짜 소유자에게 간다 · §18-2).
 *   미등록·판정 실패 메일에는 회신 자체가 없다(백스캐터 반사판 금지).
 * ⛔ 계정 축 = 접수 메일함 계정(AGENCY_MAIL_USER/PASS) 하나다. 정산(SMTP_USER)·영업(OUTREACH_SMTP_USER)과
 *   분리된 세 번째 축(평판 분리 · outreach-mailer 헤더 근거와 동일).
 * ⛔ 이 CT가 없으면(ENV 미설정) 회신만이 아니라 **접수·폴링 전체가 잠긴다**(회의론자 필수 4 · 워커가 판정).
 * ⛔ 회신 본문 줄표 0(불변 10) — 문안은 워커의 빌더가 소유하고 여기는 운반만 한다.
 */
import nodemailer from 'nodemailer';
import { isRecipientRejected } from './billing-recipients';

export type AgencyMailOutcome = 'sent' | 'rejected' | 'unknown';

/** 접수 메일함 계정(POP3 수신·SMTP 발신 공용). 예: hanjullo@invitocorp.com */
export function agencyMailUser(): string {
  return (process.env.AGENCY_MAIL_USER || '').trim();
}

/** 수신·발신 축이 함께 선다/잠긴다 — 회신은 이 경로의 유일한 통지라 반쪽 가동을 허용하지 않는다 */
export function isAgencyMailerReady(): boolean {
  return !!(agencyMailUser() && (process.env.AGENCY_MAIL_PASS || '').trim());
}

const TOTAL_TIMEOUT_MS = 30_000;

export async function sendAgencyReplyMail(input: {
  to: string;
  subject: string;
  text: string;
  /** 수신 메일의 Message-ID — 같은 스레드로 회신(In-Reply-To/References) */
  inReplyTo?: string | null;
}): Promise<{ outcome: AgencyMailOutcome; detail: string }> {
  if (!isAgencyMailerReady()) {
    return { outcome: 'unknown', detail: '접수 메일 계정(AGENCY_MAIL_USER/PASS)이 설정되지 않았습니다.' };
  }
  const user = agencyMailUser();
  const transporter = nodemailer.createTransport({
    host: (process.env.AGENCY_SMTP_HOST || 'smtps.hiworks.com').trim(),
    port: Number(process.env.AGENCY_SMTP_PORT) || 465,
    secure: true,
    auth: { user, pass: (process.env.AGENCY_MAIL_PASS || '').trim() },
    // socketTimeout은 비활동 상한이라 총 소요를 못 막는다 — 아래 Promise.race가 총 상한(billing 선례)
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  try {
    const send = transporter.sendMail({
      from: `"한줄로 대행발송" <${user}>`,
      to: input.to,
      subject: input.subject,
      text: input.text,
      // 자동응답 루프 방지(§18-5): 우리 회신은 자동 발신임을 밝힌다
      headers: { 'Auto-Submitted': 'auto-replied' },
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo, references: input.inReplyTo } : {}),
    });
    const info: any = await Promise.race([
      send,
      new Promise((_, reject) => setTimeout(() => reject(new Error('회신 발송 총 시간 초과')), TOTAL_TIMEOUT_MS)),
    ]);
    if (isRecipientRejected(info, input.to)) {
      return { outcome: 'rejected', detail: `수신 주소가 거부되었습니다: ${input.to}` };
    }
    const accepted: string[] = Array.isArray(info?.accepted) ? info.accepted.map((x: any) => String(x)) : [];
    if (accepted.some((a) => a.toLowerCase().includes(input.to.toLowerCase()))) {
      return { outcome: 'sent', detail: String(info?.messageId || '') };
    }
    return { outcome: 'unknown', detail: '발송 결과를 확인하지 못했습니다.' };
  } catch (err: any) {
    console.error('[agency-mail] 회신 발송 실패:', err?.message);
    return { outcome: 'unknown', detail: String(err?.message || '발송 요청 실패') };
  } finally {
    try { transporter.close(); } catch { /* noop */ }
  }
}
