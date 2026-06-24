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
export declare function sendBillingEmail(params: SendBillingEmailParams): Promise<EmailResult>;
export {};
//# sourceMappingURL=emailService.d.ts.map