/**
 * ★ CT-85: Company SMTP Client — D215+ (2026-05-25)
 *
 * 🎯 목적
 *   회사 admin 본인 SMTP 정보 활용 → nodemailer transporter 생성 + 발송.
 *   Harold 명시 영구 룰: 한줄로 자체 메일 서버 X = SMTP relay only.
 *   - 발신 도메인 = 회사 본인 도메인 (SPF/DKIM/DMARC 회사 admin 본인 책임)
 *   - 한줄로 운영 비용 0 + 한줄로 책임 0 + Blocklist 위험 0
 *
 * 📋 표준 SMTP 서버 매핑
 *   - Google Workspace: smtp.gmail.com:587 (STARTTLS) + 앱 비밀번호 (2단계 인증 의무)
 *   - Naver Works: smtp.worksmobile.com:587 (STARTTLS)
 *   - Office 365: smtp.office365.com:587 (STARTTLS)
 *   - 자체 메일 서버: 회사 admin 직접 입력
 *
 * 🔐 비밀번호 암호화 (AES-256-GCM)
 *   - 환경 변수 SMTP_ENCRYPTION_KEY (32 bytes hex = 64자) 의무
 *   - 저장 형식 = `iv:ciphertext:authTag` (base64 인코딩)
 *   - 발송 시점 복호화 → transporter 안 즉시 사용 → 캐시 5분 TTL 후 폐기
 *
 * ⛔ 영구 원칙
 *   - 평문 비밀번호 로그/응답 절대 X (마스킹 의무)
 *   - 회사 격리 (company_id 의무)
 *   - transporter 캐싱 5분 TTL (메모리 효율 + credential 노출 최소화)
 *   - 테스트 발송 = 회사 admin 본인 from_email 활용
 *   - SMTP_ENCRYPTION_KEY 미설정 시 = 명시 에러 throw (catch 안 503 분기 의무)
 */

import nodemailer, { Transporter } from 'nodemailer';
import crypto from 'crypto';
import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;  // 평문 (저장 직전 또는 복호화 직후만 — 즉시 폐기)
  secure: boolean;
  fromEmail: string;
  fromName: string | null;
}

export interface SmtpConfigPublic {
  host: string;
  port: number;
  user: string;
  secure: boolean;
  fromEmail: string;
  fromName: string | null;
  isConfigured: boolean;
}

export interface SendEmailInput {
  companyId: string;
  to: string | { email: string; name?: string };
  subject: string;
  htmlBody: string;
  textBody?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

// ════════════════════════════════════════════════════════════════════
// AES-256-GCM 암호화 / 복호화
// ════════════════════════════════════════════════════════════════════

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const keyHex = process.env.SMTP_ENCRYPTION_KEY || '';
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('SMTP_ENCRYPTION_KEY 미설정 — 운영자에게 .env 등록 요청 의무 (64자 hex)');
  }
  return Buffer.from(keyHex, 'hex');
}

export function encryptPassword(plainPassword: string): string {
  if (!plainPassword) throw new Error('암호화할 비밀번호 필수');
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainPassword, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${ciphertext.toString('base64')}:${authTag.toString('base64')}`;
}

export function decryptPassword(encrypted: string): string {
  if (!encrypted) throw new Error('복호화할 비밀번호 필수');
  const key = getEncryptionKey();
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('SMTP 비밀번호 형식 오류 — 회사 admin 재설정 의무');
  const iv = Buffer.from(parts[0], 'base64');
  const ciphertext = Buffer.from(parts[1], 'base64');
  const authTag = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

// ════════════════════════════════════════════════════════════════════
// transporter 캐싱 (5분 TTL — 메모리 효율 + credential 노출 최소화)
// ════════════════════════════════════════════════════════════════════

interface CachedTransporter {
  transporter: Transporter;
  createdAt: number;
}

const TRANSPORTER_CACHE = new Map<string, CachedTransporter>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedTransporter(companyId: string): Transporter | null {
  const cached = TRANSPORTER_CACHE.get(companyId);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
    TRANSPORTER_CACHE.delete(companyId);
    return null;
  }
  return cached.transporter;
}

function setCachedTransporter(companyId: string, transporter: Transporter): void {
  TRANSPORTER_CACHE.set(companyId, {
    transporter,
    createdAt: Date.now(),
  });
}

export function clearTransporterCache(companyId: string): void {
  TRANSPORTER_CACHE.delete(companyId);
}

// ════════════════════════════════════════════════════════════════════
// SMTP 설정 저장 / 조회 (회사 admin 직접 등록)
// ════════════════════════════════════════════════════════════════════

export async function saveSmtpConfig(companyId: string, config: SmtpConfig): Promise<void> {
  if (!companyId) throw new Error('companyId 필수');
  if (!config.host || !config.port || !config.user || !config.password || !config.fromEmail) {
    throw new Error('SMTP 설정 필드 (host/port/user/password/fromEmail) 필수');
  }
  // 포트 범위 검증 (1~65535)
  const port = Number(config.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP 포트 범위 오류 (1~65535)');
  }
  // 이메일 형식 단순 검증
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(config.fromEmail)) {
    throw new Error('SMTP fromEmail 형식 오류');
  }

  const encrypted = encryptPassword(config.password);

  await query(
    `UPDATE companies SET
       smtp_host = $1,
       smtp_port = $2,
       smtp_user = $3,
       smtp_password_encrypted = $4,
       smtp_secure = $5,
       smtp_from_email = $6,
       smtp_from_name = $7,
       updated_at = NOW()
     WHERE id = $8::uuid`,
    [
      config.host,
      port,
      config.user,
      encrypted,
      Boolean(config.secure),
      config.fromEmail,
      config.fromName || null,
      companyId,
    ]
  );

  // 캐시 무효화 — 옛 transporter 즉시 폐기
  clearTransporterCache(companyId);
}

/**
 * SMTP 설정 조회 — 비밀번호 마스킹 (평문 노출 절대 X).
 */
export async function getSmtpConfigPublic(companyId: string): Promise<SmtpConfigPublic | null> {
  if (!companyId) return null;
  const r = await query(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_password_encrypted, smtp_secure, smtp_from_email, smtp_from_name
     FROM companies WHERE id = $1::uuid LIMIT 1`,
    [companyId]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    host: row.smtp_host || '',
    port: Number(row.smtp_port || 587),
    user: row.smtp_user || '',
    secure: Boolean(row.smtp_secure),
    fromEmail: row.smtp_from_email || '',
    fromName: row.smtp_from_name,
    isConfigured: Boolean(row.smtp_host && row.smtp_user && row.smtp_password_encrypted && row.smtp_from_email),
  };
}

/**
 * SMTP 설정 삭제 (회사 admin 본인 SMTP 정보 영구 제거).
 */
export async function clearSmtpConfig(companyId: string): Promise<void> {
  if (!companyId) throw new Error('companyId 필수');
  await query(
    `UPDATE companies SET
       smtp_host = NULL,
       smtp_user = NULL,
       smtp_password_encrypted = NULL,
       smtp_secure = false,
       smtp_from_email = NULL,
       smtp_from_name = NULL,
       updated_at = NOW()
     WHERE id = $1::uuid`,
    [companyId]
  );
  clearTransporterCache(companyId);
}

// ════════════════════════════════════════════════════════════════════
// 회사별 transporter 생성 (캐싱 활용)
// ════════════════════════════════════════════════════════════════════

async function getTransporter(companyId: string): Promise<Transporter> {
  const cached = getCachedTransporter(companyId);
  if (cached) return cached;

  const r = await query(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_password_encrypted, smtp_secure
     FROM companies WHERE id = $1::uuid LIMIT 1`,
    [companyId]
  );
  if (r.rows.length === 0) throw new Error(`회사 ${companyId} 미발견`);
  const row = r.rows[0];

  if (!row.smtp_host || !row.smtp_user || !row.smtp_password_encrypted) {
    throw new Error('SMTP 설정 미완료 — 회사 admin이 SMTP 정보 등록 후 진입 의무');
  }

  // 복호화 → transporter 생성 → 즉시 평문 폐기
  const password = decryptPassword(row.smtp_password_encrypted);
  const transporter = nodemailer.createTransport({
    host: row.smtp_host,
    port: Number(row.smtp_port || 587),
    secure: Boolean(row.smtp_secure),  // true = SSL (465) / false = STARTTLS (587)
    auth: {
      user: row.smtp_user,
      pass: password,
    },
    // 연결 timeout — 회사 SMTP 서버 응답 늦으면 30초 후 차단
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
  });

  setCachedTransporter(companyId, transporter);
  return transporter;
}

// ════════════════════════════════════════════════════════════════════
// 테스트 발송 (SMTP 설정 검증 + 회사 admin 본인 이메일 발송)
// ════════════════════════════════════════════════════════════════════

export async function sendTestEmail(companyId: string, toEmail: string): Promise<SendEmailResult> {
  if (!companyId || !toEmail) throw new Error('companyId + toEmail 필수');
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(toEmail)) throw new Error('수신 이메일 형식 오류');

  const transporter = await getTransporter(companyId);
  const config = await getSmtpConfigPublic(companyId);
  if (!config) throw new Error('회사 SMTP 설정 조회 실패');

  const fromText = config.fromName
    ? `"${config.fromName}" <${config.fromEmail}>`
    : config.fromEmail;

  const info = await transporter.sendMail({
    from: fromText,
    to: toEmail,
    subject: '[한줄로] SMTP 테스트 발송 확인',
    text: `한줄로 SMTP relay 테스트 발송 정상 동작 확인 메일입니다.

시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
발송 서버: ${config.host}:${config.port}
발신 주소: ${config.fromEmail}

본 메일이 정상 수신 = SMTP 설정 완료. Email 마케팅 캠페인 활용 가능.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #4f46e5; margin-top: 0;">한줄로 SMTP 테스트 발송</h2>
        <p style="color: #374151;">한줄로 SMTP relay 테스트 발송 정상 동작 확인 메일입니다.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280;">시간</td><td style="padding: 8px 0; color: #111827;">${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">발송 서버</td><td style="padding: 8px 0; color: #111827;">${config.host}:${config.port}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">발신 주소</td><td style="padding: 8px 0; color: #111827;">${config.fromEmail}</td></tr>
        </table>
        <p style="color: #10b981; font-weight: 600;">✓ 본 메일 정상 수신 = SMTP 설정 완료</p>
        <p style="color: #6b7280; font-size: 14px;">Email 마케팅 캠페인 활용 가능합니다.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af; text-align: center;">한줄로 (TargetUp) — 마케팅 자동화 SaaS</p>
      </div>
    `,
  });

  return {
    messageId: info.messageId || '',
    accepted: (info.accepted as any[])?.map((a) => String(a)) || [],
    rejected: (info.rejected as any[])?.map((a) => String(a)) || [],
  };
}

// ════════════════════════════════════════════════════════════════════
// 일반 발송 (email-channel에서 호출)
// ════════════════════════════════════════════════════════════════════

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!input.companyId || !input.to || !input.subject) {
    throw new Error('companyId + to + subject 필수');
  }
  const transporter = await getTransporter(input.companyId);
  const config = await getSmtpConfigPublic(input.companyId);
  if (!config) throw new Error('회사 SMTP 설정 조회 실패');

  const fromText = config.fromName
    ? `"${config.fromName}" <${config.fromEmail}>`
    : config.fromEmail;
  const toText = typeof input.to === 'string'
    ? input.to
    : (input.to.name ? `"${input.to.name}" <${input.to.email}>` : input.to.email);

  const info = await transporter.sendMail({
    from: fromText,
    to: toText,
    subject: input.subject,
    text: input.textBody,
    html: input.htmlBody,
    replyTo: input.replyTo,
  });

  return {
    messageId: info.messageId || '',
    accepted: (info.accepted as any[])?.map((a) => String(a)) || [],
    rejected: (info.rejected as any[])?.map((a) => String(a)) || [],
  };
}

/**
 * SMTP 설정 완료 여부 — 발송 가능 검증용 (email-channel 호출 직전 활용).
 */
export async function isSmtpConfigured(companyId: string): Promise<boolean> {
  const config = await getSmtpConfigPublic(companyId);
  return Boolean(config?.isConfigured);
}
