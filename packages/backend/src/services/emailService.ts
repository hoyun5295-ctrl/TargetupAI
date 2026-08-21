/**
 * 정산서 이메일 발송 서비스 (stub)
 * 
 * 현재는 실제 발송 없이 성공 응답만 리턴합니다.
 * TODO: 하이웍스 SMTP 연결 시 nodemailer로 교체
 * 
 * 파일 경로: packages/backend/src/services/emailService.ts
 */

interface SendBillingEmailParams {
  to: string;
  subject: string;
  bodyHtml: string;
  pdfBuffer: Buffer | null;
  pdfFilename: string;
}

interface EmailResult {
  success: boolean;
  message: string;
}

export async function sendBillingEmail(params: SendBillingEmailParams): Promise<EmailResult> {
  const { to, subject, pdfFilename } = params;

  console.log('========== 정산서 이메일 발송 (stub) ==========');
  console.log(`수신: ${to}`);
  console.log(`제목: ${subject}`);
  console.log(`첨부: ${pdfFilename}`);
  console.log(`PDF: ${params.pdfBuffer ? '있음' : '없음 (TODO)'}`);
  console.log('================================================');

  // ★ 2026-07-12 거짓 성공 제거(6원칙 ② — 효과 검증 없는 성공 표시 금지):
  //   SMTP 미연결 상태에서 success:true를 돌려주면 admin.ts가 billings.emailed_at을 기록해
  //   "발송된 정산서"라는 거짓 상태가 남는다. 연결 전까지는 정직하게 실패로 응답.
  return {
    success: false,
    message: '정산서 이메일 발송 기능이 아직 연결되지 않았습니다. 발송되지 않았습니다. PDF 다운로드 후 직접 전달해주세요.',
  };

  // TODO: 하이웍스 SMTP 연결 시 아래 코드로 교체
  // -----------------------------------------------
  // import nodemailer from 'nodemailer';
  //
  // const transporter = nodemailer.createTransport({
  //   host: 'smtps.hiworks.com',
  //   port: 587,
  //   secure: false,
  //   auth: {
  //     user: process.env.HIWORKS_EMAIL,       // mobile@invitocorp.com
  //     pass: process.env.HIWORKS_PASSWORD,
  //   },
  // });
  //
  // await transporter.sendMail({
  //   from: '"인비토" <mobile@invitocorp.com>',
  //   to,
  //   subject,
  //   html: params.bodyHtml,
  //   attachments: params.pdfBuffer
  //     ? [{ filename: pdfFilename, content: params.pdfBuffer }]
  //     : [],
  // });
  // -----------------------------------------------
}
