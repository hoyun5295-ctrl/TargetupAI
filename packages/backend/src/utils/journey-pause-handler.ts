// packages/backend/src/utils/journey-pause-handler.ts
// CT-94: 즉시 정지 token 발급 + 정지 실행 + 기록 보존 (D218+ 신설)
//   - HMAC-SHA256 token 발급 (24h TTL)
//   - 정지 페이지 진입 시 token 검증
//   - 확인 버튼 1 클릭 → DB 트랜잭션 (status + cancel + 기록)
//   - journey_step_pause_logs 영구 보존 — Harold + admin 직접 분석 영역

import crypto from 'crypto';
import { query, pool } from '../config/database';

export interface PauseTokenInput {
  stepId: string;
  executionId: string | null;
  companyId: string;
  journeyId: string;
}

export interface PauseTokenPayload {
  step_id: string;
  execution_id: string | null;
  company_id: string;
  journey_id: string;
  expires_at: number; // unix ms
}

const TOKEN_SECRET = process.env.JOURNEY_PAUSE_TOKEN_SECRET || 'd218_pause_default_secret';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 정지 token 발급 (24h TTL).
 * 옛 short-url 패턴 정합 (HMAC-SHA256 서명).
 */
export async function generatePauseToken(input: PauseTokenInput): Promise<string> {
  const payload: PauseTokenPayload = {
    step_id: input.stepId,
    execution_id: input.executionId,
    company_id: input.companyId,
    journey_id: input.journeyId,
    expires_at: Date.now() + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Token 검증 + payload 반환. 만료/위조 시 null.
 */
export async function verifyPauseToken(token: string): Promise<PauseTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PauseTokenPayload;
    if (payload.expires_at < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * 정지 실행 — DB 트랜잭션 (status + 기록 + snapshot 연결).
 * 옛 D218+ Fix E race condition 안전망 정합.
 */
export async function executePause(
  token: string,
  pausedPhone: string,
  pauseTriggerSource: string = 'manager_link',
): Promise<{ ok: boolean; error?: string }> {
  const payload = await verifyPauseToken(token);
  if (!payload) return { ok: false, error: 'token_invalid_or_expired' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. journey_executions status = 'paused' (row lock)
    let executionStatusAtPause: string | null = null;
    if (payload.execution_id) {
      const execRes = await client.query(
        `SELECT status FROM journey_executions WHERE id = $1 FOR UPDATE`,
        [payload.execution_id],
      );
      executionStatusAtPause = execRes.rows[0]?.status || null;
      await client.query(
        `UPDATE journey_executions SET status = 'paused' WHERE id = $1`,
        [payload.execution_id],
      );
    }

    // 2. snapshot 조회 (활성화 시점 본문)
    const snapRes = await client.query(
      `SELECT id, message_body FROM journey_step_snapshots
        WHERE step_id = $1 AND journey_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [payload.step_id, payload.journey_id],
    );
    const snapshot = snapRes.rows[0];

    // 3. 타겟 수 단순 추정 (실시간 재조회는 후속 영역 — 본 trigger 직후 정지 의무 영역만 cover)
    const targetCount = 0;

    // 4. journey_step_pause_logs INSERT (영구 기록)
    await client.query(
      `INSERT INTO journey_step_pause_logs
         (company_id, journey_id, step_id, execution_id, snapshot_id,
          pause_reason, pause_trigger_source, paused_phone,
          message_body_snapshot, target_count_snapshot, execution_status_at_pause)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        payload.company_id,
        payload.journey_id,
        payload.step_id,
        payload.execution_id,
        snapshot?.id || null,
        'manager_manual',
        pauseTriggerSource,
        pausedPhone,
        snapshot?.message_body || null,
        targetCount,
        executionStatusAtPause,
      ],
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: (err as Error).message };
  } finally {
    client.release();
  }
}

/**
 * 여정 전체 정지 (status='active' → 'paused'). 스팸 끝까지 걸린 step·잔액 부족 등 그 step 본문 자체가 문제일 때
 *   모든 execution 발송을 한 번에 차단. 스캐너 등 외부 호출 공용 CT.
 *   (journey-executor.ts 안 file-local pauseJourney와 동일 UPDATE — 컬럼은 journeys 실재 확인.)
 */
export async function pauseJourney(journeyId: string, reason: string): Promise<void> {
  await query(
    `UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2, updated_at = NOW()
      WHERE id = $1::uuid AND status = 'active'`,
    [journeyId, reason.slice(0, 500)],
  );
}

/**
 * 자동 정지 (잔액 부족 / 통신사 fail 등 시스템 발화).
 * journey-executor.ts 안 실패 catch 영역에서 호출.
 */
export async function autoPauseExecution(params: {
  companyId: string;
  journeyId: string;
  stepId: string;
  executionId: string;
  pauseReason: 'balance_insufficient' | 'carrier_temp_fail' | 'phone_invalid' | 'auto_retry_exhausted';
  pauseTriggerSource: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // status UPDATE
    const execRes = await client.query(
      `SELECT status FROM journey_executions WHERE id = $1 FOR UPDATE`,
      [params.executionId],
    );
    const executionStatusAtPause = execRes.rows[0]?.status || null;
    await client.query(
      `UPDATE journey_executions SET status = 'paused' WHERE id = $1`,
      [params.executionId],
    );

    // snapshot 조회
    const snapRes = await client.query(
      `SELECT id, message_body FROM journey_step_snapshots
        WHERE step_id = $1 AND journey_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [params.stepId, params.journeyId],
    );
    const snapshot = snapRes.rows[0];

    // INSERT log
    await client.query(
      `INSERT INTO journey_step_pause_logs
         (company_id, journey_id, step_id, execution_id, snapshot_id,
          pause_reason, pause_trigger_source,
          message_body_snapshot, target_count_snapshot, execution_status_at_pause)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.companyId,
        params.journeyId,
        params.stepId,
        params.executionId,
        snapshot?.id || null,
        params.pauseReason,
        params.pauseTriggerSource,
        snapshot?.message_body || null,
        0,
        executionStatusAtPause,
      ],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 정지 이력 조회 (admin UI 활용).
 */
export async function getPauseLogs(
  companyId: string,
  journeyId?: string,
  limit: number = 50,
): Promise<any[]> {
  let sql = `
    SELECT l.*, j.name AS journey_name, s.step_order, s.channel
      FROM journey_step_pause_logs l
      LEFT JOIN journeys j ON j.id = l.journey_id
      LEFT JOIN journey_steps s ON s.id = l.step_id
     WHERE l.company_id = $1
  `;
  const params: any[] = [companyId];
  if (journeyId) {
    sql += ` AND l.journey_id = $2`;
    params.push(journeyId);
  }
  sql += ` ORDER BY l.paused_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const res = await query(sql, params);
  return res.rows;
}
