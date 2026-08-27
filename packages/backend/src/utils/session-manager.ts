/**
 * session-manager.ts — 사용자 세션 컨트롤타워 (D111 P0)
 *
 * 배경: D100에서 "전단AI + 한줄로 메인 동시 사용"을 위해 5개 동시 세션을 허용했으나,
 *       실제로는 3명이 같은 계정에 동시 로그인해도 전부 접속되는 부작용 발생.
 *       PDF(0408) 지적: "계정 중복 접속이 가능해졌다" → 차단 필요.
 *
 * 해결 (Harold님 지시):
 *   - 동일 `app_source` 내에서는 1세션만 허용 (같은 앱 2명째 로그인 시 이전 세션 무효화)
 *   - `app_source` 가 다르면 공존 허용 (한줄로 + 전단AI 동시 사용 가능)
 *   - 전단AI는 한줄로 고객에게 주소를 알리지 않으므로 별개 서비스로 취급 가능
 *
 * app_source 값:
 *   - 'hanjul' : 한줄로 서비스 (메인 hanjul.ai + 고객사관리자 app.hanjul.ai)
 *   - 'flyer'  : 전단AI 서비스
 *   - 'super'  : 슈퍼관리자 (sys.hanjullo.com)
 *
 * ★ 2026-08-18 접속 인계(takeover) — Harold님 지시:
 *   기존 접속자를 말없이 끊지 않는다. 로그인하려는 쪽에 "이미 접속 중"을 알리고 선택을 받는다.
 *   - 활성 세션이 있는데 인계 동의(티켓)가 없으면 → 세션 테이블을 **한 줄도 건드리지 않고** conflict 반환.
 *     (취소했을 때 기존 접속이 멀쩡해야 하므로, 이 "쓰기 0"이 기능의 핵심이다)
 *   - 동의 티켓이 유효하면 → 기존 세션 무효화 + 새 세션 생성 (기존 동작과 동일).
 *   게이트는 호출부가 아니라 **세션이 실제로 만들어지는 이 함수 안**에 둔다 — 호출부가 늘어도 판정이 갈라지지 않는다.
 *
 * ⚠️ 호출부:
 *   - routes/auth.ts 세션 발급 3경로(일반 사용자 + 슈퍼관리자 OTP + 슈퍼관리자 최초 2FA 등록)에서
 *     이 컨트롤타워를 유일한 진입점으로 사용.
 *   - 인라인으로 user_sessions INSERT/UPDATE 하지 말 것 (재발 방지).
 */

import type { Request } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { evaluateLoginOrigin, GEO_BLOCK_NOTICE } from './geo-access';

/** 한 번에 허용되는 동시 로그인 세션 수 — 항상 1개 (D111 P0: D100의 5개 허용 폐기) */
const MAX_SESSIONS_PER_APP = 1;

/**
 * 같은 사용자 + 같은 app_source 의 기존 활성 세션 전부 무효화.
 * 새 로그인 직전에 호출.
 *
 * ★ 핵심: app_source 기준 격리 — 한줄로 세션 무효화해도 전단AI 세션은 그대로 유지.
 */
export async function invalidateAppSessions(userId: string, appSource: string): Promise<number> {
  const result = await query(
    `UPDATE user_sessions
     SET is_active = false
     WHERE user_id = $1 AND app_source = $2 AND is_active = true`,
    [userId, appSource]
  );
  return (result as any).rowCount ?? 0;
}

/**
 * 한 회사에 속한 전 사용자의 활성 세션 무효화 — 계약 해지·정지 시 호출.
 * ★ 2026-08-18: 상태만 바꾸고 세션을 두면 **이미 접속해 있는 사람은 그대로 남는다**
 *   (로그인 게이트는 새 로그인만 막는다). 해지 시점에 접속 중이던 사용자를 끊는 것이 이 함수의 몫이다.
 * app_source를 가리지 않는다 — 계약이 끝나면 어느 앱이든 끊는다.
 */
export async function invalidateCompanySessions(companyId: string): Promise<number> {
  const result = await query(
    `UPDATE user_sessions
     SET is_active = false
     WHERE is_active = true
       AND user_id IN (SELECT id FROM users WHERE company_id = $1)`,
    [companyId]
  );
  return (result as any).rowCount ?? 0;
}

/**
 * 한 사용자의 활성 세션 전부 무효화 — 계정 정지·잠금 시 호출.
 * `invalidateAppSessions`는 app_source 하나만 끊는다. 제한 조치는 앱을 가리지 않는다.
 */
export async function invalidateUserSessions(userId: string): Promise<number> {
  const result = await query(
    `UPDATE user_sessions SET is_active = false WHERE user_id = $1 AND is_active = true`,
    [userId]
  );
  return (result as any).rowCount ?? 0;
}

export interface CreateSessionParams {
  sessionId: string;
  userId: string;
  token: string;
  appSource: string;
  req: Request;
  expiresInMinutes: number;
  /** 회사 범위 예외 판정용 — 슈퍼관리자는 없다 */
  companyId?: string | null;
}

/**
 * 새 세션 레코드 생성.
 * 호출 순서: 반드시 invalidateAppSessions()를 먼저 호출한 후 사용.
 * sessionId는 호출부에서 미리 만들어 전달 (JWT 토큰에 sessionId가 포함되어야 하므로 토큰 생성 전 확보).
 */
export async function createUserSession(params: CreateSessionParams): Promise<void> {
  const { sessionId, userId, token, appSource, req, expiresInMinutes } = params;
  await query(
    `INSERT INTO user_sessions
       (id, user_id, session_token, is_active, ip_address, user_agent, device_type, app_source,
        created_at, last_activity_at, expires_at)
     VALUES ($1, $2, $3, true, $4, $5, 'web', $6, NOW(), NOW(), NOW() + INTERVAL '1 minute' * $7)`,
    [
      sessionId,
      userId,
      token,
      req.ip || '',
      req.headers['user-agent'] || '',
      appSource,
      expiresInMinutes,
    ]
  );
}

/** 접속 인계 티켓 유효시간(초) — 모달을 읽고 누르는 시간만 허용 */
const TAKEOVER_TICKET_TTL_SECONDS = 120;

/**
 * 인계 티켓 JWT의 식별 클레임.
 * ⚠️ authenticate 미들웨어는 이 클레임이 있는 토큰을 API 인증으로 통과시키지 않는다
 *    (sessionId 없는 토큰을 통과시키는 기존 분기가 있어, 가드가 없으면 인증 우회가 된다).
 */
const TAKEOVER_PURPOSE = 'session_takeover';

/** 로그인하려는 사람에게 보여줄 기존 접속 요약 — 원본 IP·UA는 내보내지 않는다 */
export interface ActiveSessionInfo {
  deviceLabel: string;
  ipMasked: string;
  loginAtText: string;
  lastActivityText: string;
}

export interface SessionConflict {
  code: 'SESSION_IN_USE';
  error: string;
  activeSession: ActiveSessionInfo;
  takeoverTicket: string;
}

/** 세션 회전 결과 — 불리언으로 접지 않는다(회전됨 / 인계 동의 대기 는 다른 상태다) */
export type RotateOutcome =
  | { status: 'rotated'; takeover: boolean }
  | { status: 'conflict'; conflict: SessionConflict }
  /** 국외 접근 차단 — 세션을 만들지 않았다(전송자격인증 2.2) */
  | { status: 'geo_blocked'; message: string }
  /**
   * 초기 비밀번호를 아직 바꾸지 않았다 — 세션을 만들지 않았다(전송자격인증 3.2·3.3).
   * ⛔ JWT를 주고 화면에서 가리는 방식은 통제가 아니다(그 토큰으로 다른 API를 부를 수 있다).
   *    변경 전용 단명 토큰만 준다.
   */
  | { status: 'password_change_required'; changeToken: string; loginId: string };

/**
 * 유휴 임계(분) — 이보다 오래 활동이 없는 세션은 "접속 중"으로 보지 않는다.
 * 값의 근거 = 기본 세션 타임아웃(30분)과 같다(임의 상수가 아니다).
 * ★ 2026-08-18(2) 신설 이유: 브라우저를 그냥 닫으면 로그아웃 호출이 가지 않아 행이 남는다.
 *   그 행을 접속 중으로 세면 **본인이 다시 로그인할 때 자기 유령 세션 때문에 인계 안내를 받는다**(실사고).
 *   미들웨어가 활동 시 5분 간격으로 last_activity_at을 갱신하므로, 창이 열려 있는 동안은 계속 살아 있다.
 */
const IDLE_THRESHOLD_MINUTES = 30;

/**
 * 지금 실제로 살아 있는 세션 1건.
 * ★ `expires_at > NOW()` 필수 — 만료됐는데 is_active=true로 남은 행을 접속 중으로 세면
 *   본인이 자기 죽은 세션에 막힌다.
 * ★ 유휴 임계도 함께 본다 — expires_at은 로그인 시 24시간으로 잡히므로 그것만으로는 유령 세션을 못 거른다.
 */
async function findLiveSession(userId: string, appSource: string): Promise<any | null> {
  const result = await query(
    `SELECT id, ip_address, user_agent, created_at, last_activity_at
       FROM user_sessions
      WHERE user_id = $1 AND app_source = $2 AND is_active = true AND expires_at > NOW()
        AND last_activity_at > NOW() - INTERVAL '1 minute' * $3
      ORDER BY last_activity_at DESC
      LIMIT 1`,
    [userId, appSource, IDLE_THRESHOLD_MINUTES]
  );
  return result.rows[0] || null;
}

/** IP 마스킹 — 같은 계정이라도 접속지 전체를 노출하지 않는다 */
function maskIp(raw: any): string {
  const ip = String(raw || '').replace(/^::ffff:/, '').trim();
  if (!ip) return '알 수 없음';
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.***.**`;
  const groups = ip.split(':').filter(Boolean);
  if (groups.length >= 2) return `${groups[0]}:${groups[1]}:****`;
  return '알 수 없음';
}

/** user_agent → 사용자가 자기 기기인지 알아볼 정도의 요약 */
function describeDevice(raw: any): string {
  const ua = String(raw || '');
  if (!ua) return '알 수 없는 기기';
  // 순서 중요 — Edge/삼성/웨일 UA에도 Chrome 문자열이 들어 있다
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? '삼성 인터넷'
    : /Whale/.test(ua) ? '웨일'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : '브라우저';
  const os =
    /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} · ${os}` : browser;
}

/**
 * 표시용 시각 문자열.
 * user_sessions.created_at/last_activity_at 은 timestamp(무 timezone)라 서버 벽시계 값이다.
 * 같은 서버의 Node가 그대로 렌더해야 클라이언트 타임존과 어긋나지 않는다.
 */
function formatDateTime(raw: any): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '알 수 없음';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatElapsed(raw: any): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '알 수 없음';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return '방금 전';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

function ticketSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET missing');
  return secret;
}

const PASSWORD_CHANGE_PURPOSE = 'super_password_change';
/** 변경 토큰 수명(초) — 로그인 직후 한 화면에서 쓰고 버린다. 길게 두면 그 자체가 우회 창이 된다 */
const PASSWORD_CHANGE_TTL_SECONDS = 600;

/**
 * 초기 비밀번호 변경 전용 단명 토큰. (★2026-08-27 전송자격인증 3.2·3.3)
 * ★ `userId`가 아니라 `puid`로 넣는다 — 미들웨어 가드가 뚫려도 `req.user`가 채워지지 않게 한다
 *   (인계 티켓과 같은 규율). 이 토큰으로는 비밀번호 변경 말고 아무것도 못 한다.
 */
export function signPasswordChangeToken(userId: string): string {
  return jwt.sign(
    { purpose: PASSWORD_CHANGE_PURPOSE, puid: userId },
    ticketSecret(),
    { expiresIn: PASSWORD_CHANGE_TTL_SECONDS }
  );
}

/** 변경 토큰 검증 — 통과하면 그 계정 id를 돌려준다. 그 밖은 전부 null(닫힘) */
export function verifyPasswordChangeToken(token: any): string | null {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = jwt.verify(token, ticketSecret()) as any;
    if (decoded?.purpose !== PASSWORD_CHANGE_PURPOSE) return null;
    return typeof decoded?.puid === 'string' && decoded.puid ? decoded.puid : null;
  } catch {
    return null;
  }
}

/**
 * 이 슈퍼관리자가 초기 비밀번호를 아직 안 바꿨는가.
 *
 * ⛔ **컬럼이 없으면 강제하지 않는다.** `must_change_password`는 0827 ALTER로 생긴 컬럼이라,
 *   코드가 먼저 나간 인스턴스에서 42703이 나면 전 슈퍼관리자가 로그인 불가가 된다.
 *   통제를 위해 서비스를 세우지 않는다 — 없으면 통과시키고 로그만 남긴다.
 * ⚠ 조회 실패도 통과다. 이 게이트가 fail-closed면 DB가 흔들릴 때 아무도 못 들어온다.
 *   막는 힘은 이 컬럼이 아니라 **비밀번호를 아는 사람만 여기까지 온다**는 앞 단계가 갖는다.
 */
async function mustChangeSuperAdminPassword(userId: string): Promise<{ required: boolean; loginId: string }> {
  try {
    const r = await query(
      'SELECT login_id, must_change_password FROM super_admins WHERE id = $1',
      [userId]
    );
    if (r.rows.length === 0) return { required: false, loginId: '' };
    return {
      required: r.rows[0].must_change_password === true,
      loginId: String(r.rows[0].login_id || ''),
    };
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('must_change_password') || (msg.includes('column') && msg.includes('does not exist'))) {
      console.log('[session] must_change_password 컬럼 부재 — 강제 변경을 건너뛴다(ALTER 필요)');
      return { required: false, loginId: '' };
    }
    console.log('[session] 초기 비밀번호 판정 실패 — 통과시킨다:', msg);
    return { required: false, loginId: '' };
  }
}

/**
 * 인계 동의 티켓 발급.
 * ★ userId를 표준 클레임명(`userId`)으로 넣지 않는다 — 미들웨어 가드가 뚫려도 req.user가 채워지지 않게.
 * ★ 그 순간의 활성 세션 id에 묶는다 — 재사용해도 그 사이 바뀐 다른 세션은 밀어내지 못한다.
 */
function issueTakeoverTicket(userId: string, appSource: string, targetSessionId: string): string {
  return jwt.sign(
    { purpose: TAKEOVER_PURPOSE, tuid: userId, app: appSource, tsid: targetSessionId },
    ticketSecret(),
    { expiresIn: TAKEOVER_TICKET_TTL_SECONDS }
  );
}

function isTakeoverConsented(
  ticket: any,
  userId: string,
  appSource: string,
  targetSessionId: string
): boolean {
  if (!ticket || typeof ticket !== 'string') return false;
  try {
    const decoded = jwt.verify(ticket, ticketSecret()) as any;
    return (
      decoded?.purpose === TAKEOVER_PURPOSE &&
      decoded?.tuid === userId &&
      decoded?.app === appSource &&
      decoded?.tsid === targetSessionId
    );
  } catch {
    return false;
  }
}

/**
 * 한 사용자의 로그인 처리 전체 흐름.
 * - 살아 있는 같은 app_source 세션이 있고 인계 동의가 없으면 → conflict (세션 쓰기 0)
 * - 그 외 → 기존 세션 무효화 + 새 세션 생성
 *
 * 호출부(auth.ts)는 이 함수만 부르고 자체 세션 SQL 작성 금지.
 */
export async function rotateUserSession(
  params: CreateSessionParams & { takeoverTicket?: any }
): Promise<RotateOutcome> {
  // ★ 2026-08-19 국외 접근 통제(전송자격인증 2.2) — **세션을 만드는 유일한 함수가 여기다.**
  //   ⛔ 라우트나 상위 헬퍼에 두면 그 함수를 타지 않는 경로가 반드시 생긴다.
  //      실제로 두 번 샜다 — ①`/auth/login`에만 뒀더니 `/auth/mfa/verify`가 지나지 않았고,
  //      ②그걸 고친 뒤에도 슈퍼관리자 **TOTP 최초 등록 확정** 경로가 또 남아 있었다(0819 Codex 1R·2R).
  //   세 번째를 만들지 않으려고 판정을 여기로 내렸다. 호출부는 3곳뿐이고,
  //   반환형의 `geo_blocked`를 안 다루면 tsc가 잡는다.
  const origin = await evaluateLoginOrigin({
    ip: params.req.ip,
    userId: params.userId,
    companyId: params.companyId ?? null,
  });
  if (origin.country === 'foreign') {
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, $2, 'user', $1, $3, $4, $5, NOW())`,
      [
        params.userId,
        origin.decision === 'block' ? 'foreign_access_blocked' : 'foreign_access_detected',
        JSON.stringify({
          appSource: params.appSource,
          exempted: origin.exempted,
          exceptionUnknown: origin.exceptionUnknown,
        }),
        params.req.ip, params.req.headers['user-agent'] || '',
      ]
    ).catch(() => {});
    if (origin.decision === 'block') {
      return {
        status: 'geo_blocked',
        message: GEO_BLOCK_NOTICE,
      };
    }
  }

  // ★ 2026-08-27 초기 비밀번호 강제 변경(전송자격인증 3.2·3.3) — 국외 게이트와 **같은 자리**다.
  //   세션을 만드는 유일한 함수 안에 두어야 새 로그인 경로가 생겨도 새지 않는다(0819에 세 번 샌 축).
  //   ⚠ 슈퍼관리자 축만이다. 고객사 사용자에는 이 정책이 없다(컬럼도 super_admins에만 있다).
  if (params.appSource === 'super') {
    const pwd = await mustChangeSuperAdminPassword(params.userId);
    if (pwd.required) {
      return {
        status: 'password_change_required',
        changeToken: signPasswordChangeToken(params.userId),
        loginId: pwd.loginId,
      };
    }
  }

  const live = await findLiveSession(params.userId, params.appSource);

  if (live && !isTakeoverConsented(params.takeoverTicket, params.userId, params.appSource, live.id)) {
    return {
      status: 'conflict',
      conflict: {
        code: 'SESSION_IN_USE',
        error: '이 아이디로 지금 다른 곳에서 사용 중입니다.',
        activeSession: {
          deviceLabel: describeDevice(live.user_agent),
          ipMasked: maskIp(live.ip_address),
          loginAtText: formatDateTime(live.created_at),
          lastActivityText: formatElapsed(live.last_activity_at),
        },
        takeoverTicket: issueTakeoverTicket(params.userId, params.appSource, live.id),
      },
    };
  }

  // 만료된 채 is_active=true로 남은 행도 여기서 함께 정리된다
  await invalidateAppSessions(params.userId, params.appSource);
  await createUserSession(params);
  return { status: 'rotated', takeover: !!live };
}

/**
 * 새 sessionId 발급 — 호출부에서 토큰 생성 전에 확보.
 */
export function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * appSource 값 정규화 — 유효한 값만 통과, 나머지는 기본값 'hanjul'.
 */
export function normalizeAppSource(raw: any): string {
  const ALLOWED = new Set(['hanjul', 'flyer', 'super']);
  if (typeof raw === 'string' && ALLOWED.has(raw)) return raw;
  return 'hanjul';
}
