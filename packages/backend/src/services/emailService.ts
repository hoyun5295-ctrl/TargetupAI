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

  return {
    success: true,
    message: `정산서가 ${to}로 발송되었습니다 (stub: 실제 메일 미발송)`,
  };
}
