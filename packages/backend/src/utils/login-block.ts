// utils/login-block.ts
// ★ 메시징 컨트롤타워 — 로그인 차단 (B안: IP + loginId 쌍 단위)
// ★ D145 P0 (2026-05-07): brute force 방지 — 5회 실패 / 10분 윈도우 → 30분 차단
// ★ 정합성 보장:
//   1) 로그인 라우트는 반드시 isBlocked() → recordFailureAndMaybeBlock() → clearBlocksOnSuccess() 호출
//   2) audit_logs(login_fail) 5회 카운트 기준 → login_blocks INSERT
//   3) 차단 중 같은 (ip, loginId) 시도는 즉시 403, audit_logs는 별도 INSERT 안 함 (loop 방지)
//   4) 다른 IP의 같은 loginId, 다른 loginId의 같은 IP는 영향 없음 (정상 사용자 보호)

import { query } from '../config/database';

const FAIL_THRESHOLD = 5;            // 차단 trigger 카운트
const FAIL_WINDOW_MIN = 10;          // 카운트 윈도우 (분)
const BLOCK_DURATION_MIN = 30;       // 자동 차단 시간 (분)
const AUTO_REASON = 'auto_5fail_10min';
const MANUAL_REASON = 'manual';

export interface ActiveBlock {
  id: string;
  ip_address: string;
  login_id: string;
  blocked_at: Date;
  expires_at: Date;
  reason: string;
  fail_count: number;
  blocked_by: string | null;
}

/**
 * 활성 차단 여부 확인
 * @returns 차단 정보(차단 중) 또는 null(차단 아님)
 */
export async function isBlocked(ipAddress: string, loginId: string): Promise<ActiveBlock | null> {
  if (!ipAddress || !loginId) return null;
  const result = await query(
    `SELECT id, ip_address::text, login_id, blocked_at, expires_at, reason, fail_count, blocked_by
     FROM login_blocks
     WHERE ip_address = $1::inet
       AND login_id = $2
       AND unblocked_at IS NULL
       AND expires_at > NOW()
     ORDER BY blocked_at DESC
     LIMIT 1`,
    [ipAddress, loginId]
  );
  return result.rows[0] || null;
}

/**
 * 로그인 실패 기록 후 5회 도달 시 자동 차단 INSERT.
 * audit_logs(login_fail)는 호출 측(auth.ts)이 이미 INSERT한 직후에 호출하는 전제.
 * 이 함수는 카운트만 수행 + 차단 INSERT.
 */
/**
 * 로그인 실패 결과. (★2026-08-27 전송자격인증 3.4 「로그인 횟수 제한 경고 및 차단」)
 * ⛔ 경고 문구를 호출부에서 만들지 않는다. 임계값(5회)과 차단 시간(30분)은 이 파일이 소유하고,
 *   호출부가 그 숫자를 다시 쓰면 임계값이 두 곳이 되어 한쪽만 바뀌는 날이 온다.
 */
export interface FailureOutcome {
  blocked: boolean;
  /** 윈도우 내 누적 실패 횟수 */
  failCount: number;
  /** 차단까지 남은 실패 횟수. 차단됐으면 0 */
  remainingAttempts: number;
  /** 차단이 임박했을 때만 값이 있다. 호출부가 자기 실패 문구 뒤에 붙인다 */
  warning: string | null;
  /** 이번 실패로 차단됐을 때의 안내. 그 밖에는 null */
  blockedMessage: string | null;
}

/** 차단이 몇 회 남았을 때부터 경고를 보여줄지. 매번 알리면 공격자에게 진행 상황을 알려주는 셈이 된다 */
const WARN_WHEN_REMAINING_AT_MOST = 2;

function buildOutcome(failCount: number, blocked: boolean): FailureOutcome {
  const remaining = Math.max(0, FAIL_THRESHOLD - failCount);
  if (blocked) {
    return {
      blocked: true,
      failCount,
      remainingAttempts: 0,
      warning: null,
      blockedMessage: `로그인 시도 ${FAIL_THRESHOLD}회 초과로 ${BLOCK_DURATION_MIN}분간 접속이 제한되었습니다. ${BLOCK_DURATION_MIN}분 후 자동 해제되며, 그 전에 이용하시려면 관리자에게 문의해주세요.`,
    };
  }
  return {
    blocked: false,
    failCount,
    remainingAttempts: remaining,
    warning: remaining > 0 && remaining <= WARN_WHEN_REMAINING_AT_MOST
      ? `${remaining}회 더 실패하면 ${BLOCK_DURATION_MIN}분간 접속이 제한됩니다.`
      : null,
    blockedMessage: null,
  };
}

export async function recordFailureAndMaybeBlock(ipAddress: string, loginId: string): Promise<FailureOutcome> {
  if (!ipAddress || !loginId) return buildOutcome(0, false);

  // 이미 차단 중이면 추가 INSERT 안 함 (멱등성)
  const existing = await isBlocked(ipAddress, loginId);
  if (existing) return buildOutcome(existing.fail_count || FAIL_THRESHOLD, true);

  // 최근 윈도우 내 동일 (ip, loginId) login_fail 카운트
  const countResult = await query(
    `SELECT COUNT(*)::int AS cnt
     FROM audit_logs
     WHERE ip_address = $1::inet
       AND action = 'login_fail'
       AND details->>'loginId' = $2
       AND created_at >= NOW() - ($3 || ' minutes')::interval`,
    [ipAddress, loginId, String(FAIL_WINDOW_MIN)]
  );
  const failCount = Number(countResult.rows[0]?.cnt || 0);

  if (failCount < FAIL_THRESHOLD) return buildOutcome(failCount, false);

  // 차단 INSERT
  await query(
    `INSERT INTO login_blocks (ip_address, login_id, expires_at, reason, fail_count)
     VALUES ($1::inet, $2, NOW() + ($3 || ' minutes')::interval, $4, $5)`,
    [ipAddress, loginId, String(BLOCK_DURATION_MIN), AUTO_REASON, failCount]
  );
  console.log(`[login-block] AUTO BLOCK ip=${ipAddress} loginId=${loginId} failCount=${failCount}`);
  return buildOutcome(failCount, true);
}

/**
 * 로그인 성공 시 해당 (ip, loginId)의 미만료 차단 모두 해제.
 * brute force 중 정상 사용자가 비번 기억해낸 케이스 보호.
 */
export async function clearBlocksOnSuccess(ipAddress: string, loginId: string, unblockedBy?: string): Promise<void> {
  if (!ipAddress || !loginId) return;
  await query(
    `UPDATE login_blocks
     SET unblocked_at = NOW(),
         unblocked_by = $3,
         unblock_reason = 'login_success'
     WHERE ip_address = $1::inet
       AND login_id = $2
       AND unblocked_at IS NULL
       AND expires_at > NOW()`,
    [ipAddress, loginId, unblockedBy || null]
  );
}

/**
 * 슈퍼관리자 수동 차단 추가
 */
export async function manualBlock(params: {
  ipAddress: string;
  loginId: string;
  blockedBy: string;
  durationMinutes: number;
  reason?: string;
}): Promise<{ id: string }> {
  const { ipAddress, loginId, blockedBy, durationMinutes, reason } = params;
  const result = await query(
    `INSERT INTO login_blocks (ip_address, login_id, expires_at, reason, fail_count, blocked_by)
     VALUES ($1::inet, $2, NOW() + ($3 || ' minutes')::interval, $4, 0, $5)
     RETURNING id`,
    [ipAddress, loginId, String(durationMinutes), reason ? `${MANUAL_REASON}:${reason}` : MANUAL_REASON, blockedBy]
  );
  return { id: result.rows[0].id };
}

/**
 * 슈퍼관리자 즉시 해제
 */
export async function unblock(params: {
  blockId: string;
  unblockedBy: string;
  reason?: string;
}): Promise<{ ok: boolean }> {
  const { blockId, unblockedBy, reason } = params;
  const result = await query(
    `UPDATE login_blocks
     SET unblocked_at = NOW(),
         unblocked_by = $2,
         unblock_reason = $3
     WHERE id = $1
       AND unblocked_at IS NULL
     RETURNING id`,
    [blockId, unblockedBy, reason || 'admin_unblock']
  );
  return { ok: result.rows.length > 0 };
}

/**
 * 활성 차단 목록 (슈퍼관리자 화면용)
 */
export async function getActiveBlocks(filter?: { ipLike?: string; loginIdLike?: string }): Promise<any[]> {
  const where: string[] = ['unblocked_at IS NULL', 'expires_at > NOW()'];
  const params: any[] = [];
  if (filter?.ipLike) {
    params.push(`%${filter.ipLike}%`);
    where.push(`host(ip_address) ILIKE $${params.length}`);
  }
  if (filter?.loginIdLike) {
    params.push(`%${filter.loginIdLike}%`);
    where.push(`login_id ILIKE $${params.length}`);
  }
  const result = await query(
    `SELECT id, ip_address::text, login_id, blocked_at, expires_at, reason, fail_count,
            blocked_by, created_at,
            EXTRACT(EPOCH FROM (expires_at - NOW()))::int AS remaining_seconds
     FROM login_blocks
     WHERE ${where.join(' AND ')}
     ORDER BY blocked_at DESC`,
    params
  );
  return result.rows;
}

/**
 * 차단 이력 (해제된 것 + 만료된 것 포함, 페이지네이션)
 */
export async function getBlockHistory(params: {
  page?: number;
  limit?: number;
  ipLike?: string;
  loginIdLike?: string;
  reason?: string;
}): Promise<{ rows: any[]; total: number }> {
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(200, Math.max(1, Number(params.limit || 50)));
  const offset = (page - 1) * limit;
  const where: string[] = ['1=1'];
  const sqlParams: any[] = [];
  if (params.ipLike) {
    sqlParams.push(`%${params.ipLike}%`);
    where.push(`host(ip_address) ILIKE $${sqlParams.length}`);
  }
  if (params.loginIdLike) {
    sqlParams.push(`%${params.loginIdLike}%`);
    where.push(`login_id ILIKE $${sqlParams.length}`);
  }
  if (params.reason) {
    sqlParams.push(params.reason);
    where.push(`reason = $${sqlParams.length}`);
  }

  const totalResult = await query(
    `SELECT COUNT(*)::int AS cnt FROM login_blocks WHERE ${where.join(' AND ')}`,
    sqlParams
  );
  const total = Number(totalResult.rows[0]?.cnt || 0);

  sqlParams.push(limit, offset);
  const rowsResult = await query(
    `SELECT id, ip_address::text, login_id, blocked_at, expires_at, reason, fail_count,
            blocked_by, unblocked_at, unblocked_by, unblock_reason, created_at,
            CASE
              WHEN unblocked_at IS NOT NULL THEN 'unblocked'
              WHEN expires_at <= NOW() THEN 'expired'
              ELSE 'active'
            END AS state
     FROM login_blocks
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${sqlParams.length - 1} OFFSET $${sqlParams.length}`,
    sqlParams
  );
  return { rows: rowsResult.rows, total };
}
