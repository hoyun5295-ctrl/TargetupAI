// ===========================================================================
// utils/totp.ts — 슈퍼관리자 2FA(TOTP) 컨트롤타워
// ---------------------------------------------------------------------------
// - RFC 6238 TOTP (30초 step, ±1 window grace). Google Authenticator 호환.
// - 백업 코드 10개 (8자 hex, 사람 친화 4-4 분할). bcrypt 해시 저장, 1회용.
// - enrollToken: 짧은 만료(5분) JWT. 비번 통과 후 enrollment 단계로 인계.
// 인라인 헬퍼 작성 금지 — 본 CT의 export만 사용.
// ===========================================================================

import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'targetup-jwt-secret-fallback';
const ISSUER = '한줄로 시스템';

authenticator.options = { step: 30, window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpAuthUrl(loginId: string, secret: string): string {
  return authenticator.keyuri(loginId, ISSUER, secret);
}

export async function generateQrDataUrl(otpauthUrl: string): Promise<string> {
  return qrcode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', width: 240, margin: 1 });
}

export function verifyTotpCode(secret: string, code: string): boolean {
  if (!secret || !code) return false;
  const normalized = String(code).replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  try {
    return authenticator.verify({ token: normalized, secret });
  } catch {
    return false;
  }
}

export type BackupCodeRecord = { hash: string; used: boolean };

export function generateBackupCodesPlain(): string[] {
  return Array.from({ length: 10 }, () => {
    const b = crypto.randomBytes(4).toString('hex');
    return b.slice(0, 4) + '-' + b.slice(4);
  });
}

export async function hashBackupCodes(plain: string[]): Promise<BackupCodeRecord[]> {
  const out: BackupCodeRecord[] = [];
  for (const c of plain) {
    const normalized = c.replace(/-/g, '').toLowerCase();
    const hash = await bcrypt.hash(normalized, 10);
    out.push({ hash, used: false });
  }
  return out;
}

export async function verifyBackupCode(
  stored: BackupCodeRecord[] | null | undefined,
  plain: string
): Promise<{ matched: boolean; updatedCodes: BackupCodeRecord[] }> {
  if (!Array.isArray(stored) || stored.length === 0) {
    return { matched: false, updatedCodes: stored || [] };
  }
  const normalized = String(plain).replace(/[-\s]/g, '').toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(normalized)) {
    return { matched: false, updatedCodes: stored };
  }
  const updated = stored.map((r) => ({ ...r }));
  for (let i = 0; i < updated.length; i++) {
    if (updated[i].used) continue;
    const ok = await bcrypt.compare(normalized, updated[i].hash);
    if (ok) {
      updated[i].used = true;
      return { matched: true, updatedCodes: updated };
    }
  }
  return { matched: false, updatedCodes: stored };
}

export function signEnrollToken(adminId: string): string {
  return jwt.sign({ adminId, scope: 'totp_enroll' }, JWT_SECRET, { expiresIn: '5m' });
}

export function verifyEnrollToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded || decoded.scope !== 'totp_enroll') return null;
    return decoded.adminId || null;
  } catch {
    return null;
  }
}
