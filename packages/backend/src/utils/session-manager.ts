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
 * ⚠️ 호출부:
 *   - routes/auth.ts 로그인 2경로(일반 사용자 + 슈퍼관리자)에서 이 컨트롤타워를 유일한 진입점으로 사용.
 *   - 인라인으로 user_sessions INSERT/UPDATE 하지 말 것 (재발 방지).
 */

import type { Request } from 'express';
import crypto from 'crypto';
import { query } from '../config/database';

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

export interface CreateSessionParams {
  sessionId: string;
  userId: string;
  token: string;
  appSource: string;
  req: Request;
  expiresInMinutes: number;
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

/**
 * 한 사용자의 로그인 처리 전체 흐름.
 * - 기존 같은 app_source 세션 무효화
 * - 새 세션 생성 (호출부에서 발급한 sessionId/token 사용)
 *
 * 호출부(auth.ts)는 이 함수만 부르고 자체 세션 SQL 작성 금지.
 */
export async function rotateUserSession(params: CreateSessionParams): Promise<void> {
  await invalidateAppSessions(params.userId, params.appSource);
  await createUserSession(params);
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
