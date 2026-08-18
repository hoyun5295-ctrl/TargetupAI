/**
 * mfa.ts — 다중 인증(MFA) 컨트롤타워 (★2026-08-18 전송자격인증 3.4)
 *
 * 무엇을 하나
 *   계정에 등록된 **주 인증번호 1개**로 6자리 코드를 보내고, 통과하면 그 기기를 24시간 신뢰한다.
 *
 * ⛔ 주 번호는 계정당 하나다 (Harold 확정 0818)
 *   인증기준 3.4·3.5가 "다수의 이용자가 공동으로 사용할 수 있는 인증수단은 부적합"을 두 번 못 박고,
 *   2.1이 "실제 발송자 1인당 1계정"을 요구한다. 계정 하나에 번호를 여럿 두고 로그인 때 고르게 하면
 *   그 계정을 여러 사람이 각자 폰으로 쓰는 구조가 되어 두 기준을 동시에 어긴다.
 *   담당자가 여럿이면 번호가 아니라 **계정을 나눈다**.
 *
 * ⛔ 24시간 신뢰는 기기·IP 대역에 묶는다
 *   3.5가 "접속환경 변경 시 재인증"을 명시한다. 무조건 24시간을 믿으면 탈취된 계정이 하루를 그냥 쓴다.
 *
 * ⛔ 전환기 — 번호가 등록된 계정만 태운다
 *   지금 전 계정에 번호가 없다. 전면 적용하면 배포 즉시 전 고객이 못 들어온다.
 *   슈퍼관리자가 순차 등록하고, 전량 등록 후에 "번호 없으면 로그인 불가"로 전환한다.
 *
 * 발송 = 인증 전용 라인(`getAuthSmsTable()` = SMSQ_SEND_11) + `SYSTEM_SMS_CALLBACK`(1800-8125).
 * 인증번호 발송분은 고객사 청구에 잡히지 않는다(운영 라인을 점유하지 않는 별도 라인이라 집계 축이 다르다).
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { query, mysqlQuery } from '../config/database';
import { getAuthSmsTable } from './sms-queue';

/** 코드 유효시간(분) */
export const MFA_CODE_TTL_MINUTES = 5;
/** 코드 최대 시도 횟수 — 초과하면 챌린지를 폐기하고 계정을 잠근다 */
export const MFA_MAX_ATTEMPTS = 5;
/** 재발송 쿨다운(초) */
export const MFA_RESEND_COOLDOWN_SECONDS = 60;
/** 기기 신뢰 유지시간(시간) — Harold 확정 */
export const MFA_TRUST_HOURS = 24;
/** 인증 대기 티켓 유효시간(분) — 코드 입력에 쓰는 시간 */
const MFA_TICKET_TTL_MINUTES = 10;
/** 티켓 JWT 식별 클레임 — authenticate 미들웨어는 userId/userType이 없는 토큰을 거부하므로 이 티켓은 API 인증으로 통과하지 못한다 */
const MFA_PURPOSE = 'mfa_pending';

/**
 * 시행일 게이트 (★Harold 확정 0818 — 9월 1일 시행, 그 전은 사전 고지 기간)
 *
 * 왜 날짜 스위치인가
 *   고객사에 예고 없이 인증을 요구하면 장애로 인식된다. 고지 기간에는 **번호를 미리 등록만** 해두고
 *   인증은 묻지 않는다. 시행일이 되면 등록된 계정부터 자동으로 인증이 걸린다.
 *
 * ⚠ 미설정 = 미시행이 기본값이다. 배포만으로는 아무것도 바뀌지 않는다 —
 *   `MFA_ENFORCE_FROM=2026-09-01` 를 넣는 순간 시행된다. 되돌리려면 그 값을 지우면 된다.
 */
export function isMfaEnforced(now: Date = new Date()): boolean {
  const raw = String(process.env.MFA_ENFORCE_FROM || '').trim();
  if (!raw) return false;
  const from = new Date(raw);
  if (Number.isNaN(from.getTime())) return false;
  return now.getTime() >= from.getTime();
}

/** DDL 미적용 감지 — 호출부가 503 DB_MIGRATION_PENDING으로 돌려주기 위한 판정 */
export function isMfaSchemaMissing(err: any): boolean {
  const msg = String(err?.message || '');
  return (
    (msg.includes('column') && msg.includes('does not exist')) ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

/** 화면·로그에 쓰는 마스킹 — 원본 번호를 응답으로 내보내지 않는다 */
export function maskPhone(raw: any): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

/** 접속 IP의 대역(앞 2옥텟) — 같은 사무실·같은 통신사 대역이면 유지, 대역이 바뀌면 재인증 */
export function ipPrefix(raw: any): string {
  const ip = String(raw || '').replace(/^::ffff:/, '').trim();
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\./);
  if (v4) return `${v4[1]}.${v4[2]}`;
  const groups = ip.split(':').filter(Boolean);
  if (groups.length >= 2) return `${groups[0]}:${groups[1]}`;
  return ip || 'unknown';
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** 6자리 숫자 코드 — 예측 불가 난수(Math.random 금지) */
export function generateMfaCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function ticketSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET missing');
  return secret;
}

/** 인증 대기 티켓 — 로그인 토큰이 아니다. userId를 표준 클레임명으로 담지 않는다 */
export function issueMfaTicket(userId: string, challengeId: string): string {
  return jwt.sign({ purpose: MFA_PURPOSE, tuid: userId, chid: challengeId }, ticketSecret(), {
    expiresIn: MFA_TICKET_TTL_MINUTES * 60,
  });
}

export function verifyMfaTicket(ticket: any): { userId: string; challengeId: string } | null {
  if (!ticket || typeof ticket !== 'string') return null;
  try {
    const decoded = jwt.verify(ticket, ticketSecret()) as any;
    if (decoded?.purpose !== MFA_PURPOSE || !decoded?.tuid || !decoded?.chid) return null;
    return { userId: String(decoded.tuid), challengeId: String(decoded.chid) };
  } catch {
    return null;
  }
}

/**
 * 이 기기가 24시간 신뢰 안에 있는가.
 * 기기 토큰 + IP 대역 + UA가 모두 맞아야 한다(3.5 접속환경 변경 시 재인증).
 */
export async function isTrustedDevice(userId: string, deviceToken: any, req: Request): Promise<boolean> {
  const token = String(deviceToken || '');
  if (!token) return false;
  const result = await query(
    `SELECT id FROM mfa_trusted_devices
      WHERE user_id = $1 AND device_token_hash = $2 AND ip_prefix = $3 AND user_agent_hash = $4
        AND expires_at > NOW()
      LIMIT 1`,
    [userId, sha256(token), ipPrefix(req.ip), sha256(String(req.headers['user-agent'] || ''))]
  );
  if (result.rows.length === 0) return false;
  query('UPDATE mfa_trusted_devices SET last_used_at = NOW() WHERE id = $1', [result.rows[0].id]).catch(() => {});
  return true;
}

/** 인증 통과 후 이 기기를 신뢰 목록에 올린다. 반환값(평문 토큰)은 클라이언트가 보관한다 */
export async function registerTrustedDevice(userId: string, req: Request): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO mfa_trusted_devices
       (id, user_id, device_token_hash, ip_prefix, user_agent_hash, expires_at, created_at, last_used_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW() + INTERVAL '1 hour' * $5, NOW(), NOW())`,
    [userId, sha256(token), ipPrefix(req.ip), sha256(String(req.headers['user-agent'] || '')), MFA_TRUST_HOURS]
  );
  return token;
}

/** 계정의 신뢰 기기 전부 해제 — 인증번호 변경·계정 잠금 시 호출 */
export async function revokeTrustedDevices(userId: string): Promise<number> {
  const result = await query('DELETE FROM mfa_trusted_devices WHERE user_id = $1', [userId]);
  return (result as any).rowCount ?? 0;
}

export type ChallengeIssue =
  /** 새 코드를 보냈다 */
  | { status: 'sent'; challengeId: string; maskedPhone: string }
  /** 쿨다운 안이라 새로 보내지 않고 **살아있는 코드를 그대로 쓴다** — 사용자는 이미 받은 번호를 입력하면 된다 */
  | { status: 'reused'; challengeId: string; maskedPhone: string; retryAfterSeconds: number };

/**
 * 6자리 코드를 만들어 인증 라인으로 보내고 챌린지를 남긴다.
 * 쿨다운 안이면 새로 보내지 않고 기존 챌린지를 재사용한다(문자 폭탄 방지 + 사용자는 막히지 않는다).
 * ⚠ 코드 평문은 저장하지 않는다 — 해시만 남긴다.
 */
export async function issueMfaChallenge(userId: string, phone: string, req: Request): Promise<ChallengeIssue> {
  const recent = await query(
    `SELECT id, created_at FROM mfa_challenges
      WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > NOW() AND attempts < $2
      ORDER BY created_at DESC LIMIT 1`,
    [userId, MFA_MAX_ATTEMPTS]
  );
  if (recent.rows.length > 0) {
    const elapsed = (Date.now() - new Date(recent.rows[0].created_at).getTime()) / 1000;
    if (elapsed < MFA_RESEND_COOLDOWN_SECONDS) {
      return {
        status: 'reused',
        challengeId: recent.rows[0].id,
        maskedPhone: maskPhone(phone),
        retryAfterSeconds: Math.ceil(MFA_RESEND_COOLDOWN_SECONDS - elapsed),
      };
    }
  }

  // 미소비 챌린지는 폐기 — 살아있는 코드가 둘 이상이면 안 된다
  await query(
    `UPDATE mfa_challenges SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId]
  );

  const code = generateMfaCode();
  const codeHash = await bcrypt.hash(code, 8);
  const inserted = await query(
    `INSERT INTO mfa_challenges
       (id, user_id, code_hash, phone, attempts, expires_at, ip_address, user_agent, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 0, NOW() + INTERVAL '1 minute' * $4, $5, $6, NOW())
     RETURNING id`,
    [userId, codeHash, phone, MFA_CODE_TTL_MINUTES, req.ip || '', String(req.headers['user-agent'] || '')]
  );

  await sendMfaCode(phone, code);

  return { status: 'sent', challengeId: inserted.rows[0].id, maskedPhone: maskPhone(phone) };
}

/**
 * 인증번호 발송 — 인증 전용 라인(SMSQ_SEND_11).
 * ⚠ 발송이 실패하면 로그인이 불가능해지므로 오류를 삼키지 않고 그대로 올린다(호출부가 사용자에게 알린다).
 */
async function sendMfaCode(phone: string, code: string): Promise<void> {
  const table = await getAuthSmsTable();
  const callback = process.env.SYSTEM_SMS_CALLBACK;
  if (!callback) throw new Error('SYSTEM_SMS_CALLBACK 환경변수가 설정되지 않았습니다');
  const message = `[한줄로] 인증번호 ${code}\n${MFA_CODE_TTL_MINUTES}분 안에 입력해주세요.`;
  await mysqlQuery(
    `INSERT INTO ${table} (dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1) VALUES (?, ?, ?, 'S', NOW(), 100, '1')`,
    [String(phone).replace(/\D/g, ''), String(callback).replace(/\D/g, ''), message]
  );
}

export type ChallengeVerdict =
  | { status: 'ok' }
  | { status: 'wrong'; remainingAttempts: number }
  | { status: 'locked' }
  | { status: 'expired' };

/**
 * 코드 검증.
 * - 만료·소비된 챌린지는 expired
 * - 틀리면 시도 횟수 증가, 한도 초과면 locked(호출부가 계정을 잠근다)
 */
export async function verifyMfaChallenge(
  challengeId: string,
  userId: string,
  code: any
): Promise<ChallengeVerdict> {
  const result = await query(
    `SELECT id, code_hash, attempts, expires_at, consumed_at
       FROM mfa_challenges WHERE id = $1 AND user_id = $2`,
    [challengeId, userId]
  );
  if (result.rows.length === 0) return { status: 'expired' };

  const row = result.rows[0];
  if (row.consumed_at || new Date(row.expires_at) <= new Date()) return { status: 'expired' };
  if (row.attempts >= MFA_MAX_ATTEMPTS) return { status: 'locked' };

  const matched = await bcrypt.compare(String(code || ''), row.code_hash);
  if (matched) {
    await query('UPDATE mfa_challenges SET consumed_at = NOW() WHERE id = $1', [challengeId]);
    return { status: 'ok' };
  }

  const bumped = await query(
    'UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
    [challengeId]
  );
  const attempts = Number(bumped.rows[0]?.attempts ?? MFA_MAX_ATTEMPTS);
  if (attempts >= MFA_MAX_ATTEMPTS) {
    await query('UPDATE mfa_challenges SET consumed_at = NOW() WHERE id = $1', [challengeId]);
    return { status: 'locked' };
  }
  return { status: 'wrong', remainingAttempts: MFA_MAX_ATTEMPTS - attempts };
}

/**
 * 인증 실패 한도 초과 — 계정 잠금 + 신뢰 기기 전부 해제.
 * 인증기준 3.4 ④(로그인 실패 횟수 초과 시 계정 잠금 및 경고 안내).
 */
export async function lockAccountForMfaFailure(userId: string): Promise<void> {
  await query("UPDATE users SET status = 'locked', updated_at = NOW() WHERE id = $1", [userId]);
  await revokeTrustedDevices(userId);
}
