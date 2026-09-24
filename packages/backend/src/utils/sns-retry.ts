/**
 * sns-retry.ts — SNS 다시 시도 · 최신 행 판정 · 실패 행 처방 컨트롤타워 (2026-09-24)
 * 설계 SoT = docs/2026-09-24-sns-channel-design.md §2 S1 · §6 E3.
 *
 * ⛔ 왜 필요한가(0924 확인 결함 K2 · K12)
 *   다시 시도는 옛 failed 행을 둔 채 새 행을 만든다(불변 7 · failed → scheduled 전이 없음). 그런데
 *   ① 옛 행 버튼이 계속 열려 있고 ② 새 행 멱등키에 새 id 가 들어가 UNIQUE 가 반복을 막지 못해
 *   **두 번 누르면 같은 글이 두 번 게시됐다.** 또 ③ 옛 failed 행이 남아 묶음이 영원히 '일부 실패'였다.
 *
 * 이 파일이 소유하는 것
 *   - 계정별 최신 행 판정(SQL 조각 + 화면 미러 규칙) — S1 가드 · GET /posts 파생 · 확인할 것 띠 · 처방 · 글 고치기가 같이 쓴다
 *   - 다시 시도 트랜잭션(문장 순서가 곧 안전장치다)
 *   - 실패 행 처방(`snsFailureAction`) — 화면 버튼은 이 값만 본다
 */

import { randomUUID } from 'crypto';
import { pool } from '../config/database';
import { buildSnsIdempotencyKey } from './sns-idempotency';
import { SNS_ERROR_CODES } from './sns-constants';

/**
 * "이 행보다 나중에 같은 게시물·같은 계정으로 만든 행이 없다" = 그 계정의 **최신 행**.
 * 정렬 키는 `(created_at, id)` — created_at 이 같은 순간이어도 순서가 하나로 정해진다.
 * @param alias 판정할 target 의 별칭(예: 't')
 */
export function snsLatestTargetSql(alias: string): string {
  return `NOT EXISTS (SELECT 1 FROM sns_post_targets n
                       WHERE n.post_id = ${alias}.post_id AND n.account_id = ${alias}.account_id
                         AND (n.created_at, n.id) > (${alias}.created_at, ${alias}.id))`;
}

/** 실패 행에서 사용자가 할 수 있는 일 — 화면 버튼 이름이 이 값으로 정해진다(sns-view 미러). */
export type SnsFailureAction = 'reconnect' | 'retry_at' | 'publish_now' | 'check' | 'rewrite' | 'none';

/** 글·미디어 자체를 고쳐야 하는 실패 — 같은 글을 다시 보내면 같은 이유로 또 실패한다. */
const REWRITE_CODES = new Set<string>([
  SNS_ERROR_CODES.MEDIA_FORMAT,
  SNS_ERROR_CODES.CONTAINER_FAILED,
  'SOURCE_MISSING',
]);

export interface SnsFailureFacts {
  status: string;
  platformPostId: string | null;
  lastErrorCode: string | null;
  verifyGaveUpAt: string | Date | null;
  scheduledAt: string | Date | null;
  /** 같은 게시물·계정에 나중 행이 있는가 */
  superseded: boolean;
  /** 그 계정이 지금 active 인가 */
  accountActive: boolean;
}

export function snsFailureAction(t: SnsFailureFacts, now: number = Date.now()): SnsFailureAction {
  if (t.superseded) return 'none';
  // 올라갔는데 우리가 확인을 못 한 행 — 다시 올리면 두 번이 된다. 채널에서 보게 한다.
  if (t.status === 'submitted' && t.platformPostId && t.verifyGaveUpAt) return 'check';
  if (t.status !== 'failed') return 'none';
  if (t.platformPostId) return 'none';
  if (t.lastErrorCode === SNS_ERROR_CODES.PUBLISH_OUTCOME_UNKNOWN) return 'check';
  if (t.lastErrorCode === SNS_ERROR_CODES.MONTHLY_CAP) return 'none';
  if (!t.accountActive) return 'reconnect';
  if (t.lastErrorCode && REWRITE_CODES.has(t.lastErrorCode)) return 'rewrite';
  const at = t.scheduledAt ? new Date(t.scheduledAt).getTime() : 0;
  return at > now ? 'retry_at' : 'publish_now';
}

export type SnsRetryResult =
  | { ok: true; targetId: string; scheduledAt: string }
  | { ok: false; status: number; code: string; error: string; action?: SnsFailureAction };

/**
 * 다시 시도 — **새 행**을 만든다(불변 7). 한 트랜잭션 · 문장 순서가 안전장치다(0924 최종 검증 R3-01).
 *   ① 옛 행 FOR UPDATE — **잠금만** 한다(판정 조건을 이 문장에 넣지 않는다)
 *   ② **다음 문장**에서 나중 행을 센다 — 먼저 들어온 요청이 커밋한 새 행이 새 스냅숏에 보인다
 *      (잠금 문장 안에 EXISTS 를 넣으면 잠금을 기다리기 전 스냅숏으로 평가돼 두 요청이 모두 통과한다)
 *   ③ 계정 FOR SHARE — active 가 아니면 다시 연결이 먼저다
 *   ④ INSERT — 예약 시각은 원래 시각을 지킨다(미래 예약이 지금 올라가던 결함)
 */
export async function retrySnsTarget(companyId: string, targetId: string): Promise<SnsRetryResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT * FROM sns_post_targets WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [targetId, companyId],
    );
    const old = locked.rows[0];
    if (!old || old.status !== 'failed' || old.platform_post_id) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, code: 'NOT_RETRYABLE', error: '다시 시도할 수 없는 상태예요. 목록을 새로 고쳐 주세요.' };
    }
    if (old.last_error_code === SNS_ERROR_CODES.PUBLISH_OUTCOME_UNKNOWN) {
      await client.query('ROLLBACK');
      return {
        ok: false, status: 409, code: SNS_ERROR_CODES.PUBLISH_OUTCOME_UNKNOWN, action: 'check',
        error: '이미 올라갔을 수 있어요. 채널에서 먼저 확인해 주세요.',
      };
    }

    const later = await client.query(
      `SELECT COUNT(*)::int AS n FROM sns_post_targets
        WHERE post_id = $1::uuid AND account_id = $2::uuid
          AND (created_at, id) > ($3::timestamptz, $4::uuid)`,
      [old.post_id, old.account_id, old.created_at, old.id],
    );
    if (Number(later.rows[0]?.n || 0) > 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, code: 'ALREADY_RETRIED', error: '이미 다시 올렸어요. 목록을 새로 고쳐 주세요.' };
    }

    const acc = await client.query(
      `SELECT status FROM sns_accounts WHERE id = $1::uuid AND company_id = $2::uuid FOR SHARE`,
      [old.account_id, companyId],
    );
    if (acc.rows[0]?.status !== 'active') {
      await client.query('ROLLBACK');
      return {
        ok: false, status: 409, code: SNS_ERROR_CODES.REAUTH_REQUIRED, action: 'reconnect',
        error: '채널 연결이 끊겨 있어요. 먼저 다시 연결해 주세요.',
      };
    }

    const post = await client.query(`SELECT media_ids FROM sns_posts WHERE id = $1::uuid AND company_id = $2::uuid`, [old.post_id, companyId]);
    const mediaIds: string[] = post.rows[0]?.media_ids ?? [];
    const newId = randomUUID();
    const idem = buildSnsIdempotencyKey(companyId, newId, { caption: old.caption, mediaIds, format: old.format });
    const ins = await client.query(
      `INSERT INTO sns_post_targets
         (id, post_id, company_id, account_id, platform, format, caption, status, scheduled_at, idempotency_key)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, 'scheduled', GREATEST(COALESCE($8::timestamptz, NOW()), NOW()), $9)
       RETURNING scheduled_at`,
      [newId, old.post_id, companyId, old.account_id, old.platform, old.format, old.caption, old.scheduled_at, idem],
    );
    await client.query('COMMIT');
    return { ok: true, targetId: newId, scheduledAt: new Date(ins.rows[0].scheduled_at).toISOString() };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
