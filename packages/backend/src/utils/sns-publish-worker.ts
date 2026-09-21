/**
 * sns-publish-worker.ts — SNS 발행 워커 (2026-09-21 S3)
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-4 · 불변 §2-6·§2-8·§2-15.
 *
 * 30초 주기 한 워커가 예약 대기부터 게시 확인까지 전부 한다(**예약 워커와 발행 워커를 나누지 않는다**).
 *
 * ⛔ 이중 게시 0 = 3겹(§2-8)
 *   ① `UNIQUE(company_id, idempotency_key)` — 같은 내용은 두 행이 될 수 없다
 *   ② `FOR UPDATE SKIP LOCKED` 선점 + `lock_token` — 두 프로세스가 같은 행을 잡지 못한다
 *   ③ **게시 호출 직전 `lock_token` 재확인** — 잡은 뒤 남이 가져갔으면 호출하지 않는다
 *   메모리 잠금 금지(프로세스가 하나라는 전제가 깨지는 날이 사고다).
 *
 * ⛔ 성공은 **플랫폼 재조회로만** 확정한다(§2-6). API 200 은 `submitted` 까지다.
 * ⛔ 소급 게시 0(§2-15) — 예약 시각이 24시간 넘게 지난 행은 게시하지 않고 사유와 함께 닫는다.
 *   **그리고 첫 tick 은 아무것도 게시하지 않는다**(배포 직후 밀린 예약이 한꺼번에 나가는 것을 막는 가드).
 */

import { randomUUID } from 'crypto';
import { query } from '../config/database';
import { getSnsAdapter } from './sns';
import { isSnsPublishAdapter, SnsAdapterError, type SnsPublishRequest } from './sns/adapter';
import { isSnsPlatform, SNS_ERROR_CODES } from './sns-constants';
import { renderSnsPublishFile, SnsMediaError } from './sns-media';
import { signSnsMediaToken } from './sns-signed-media';
import { isMissingSnsTable } from './sns-accounts';

const TICK_MS = 30 * 1000;
const FIRST_DELAY_MS = 60 * 1000;
const BATCH = 5;
/** 예약 시각이 이만큼 지나면 게시하지 않는다(인스타 컨테이너 만료값과 같은 24시간). */
const STALE_MS = 24 * 60 * 60 * 1000;
/** 컨테이너 폴링 상한. 넘으면 다음 tick 으로 미룬다(플랫폼 권고 = 분당 1회·5분). */
const POLL_LIMIT_MS = 5 * 60 * 1000;

/** 첫 tick 가드 — 이 값이 false 인 동안은 세지만 하고 게시하지 않는다(§2-15). */
let armed = false;

function publicOrigin(): string {
  const first = String(process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  return process.env.SNS_PUBLIC_ORIGIN || first || 'https://hanjul.ai';
}

/** 플랫폼이 가져갈 공개 주소. target·미디어당 **고정**이다(URL 이 흔들리면 플랫폼 캐시가 깨진다 · §3-7). */
function mediaUrlFor(targetId: string, mediaId: string, companyId: string, salt: string): string {
  const token = signSnsMediaToken({ targetId, mediaId, companyId, salt });
  return `${publicOrigin()}/api/sns/m/${token}`;
}

/** 사람이 읽는 실패 사유 한 줄. 원문은 `last_error` 에 그대로 남긴다(사유를 버리지 않는다). */
function failureMessage(err: unknown): string {
  if (err instanceof SnsMediaError) return err.message;
  if (err instanceof SnsAdapterError) return err.message || '채널이 게시를 받아들이지 않았어요.';
  return '게시 중 문제가 생겼어요.';
}
function failureCode(err: unknown): string {
  if (err instanceof SnsMediaError) return err.code;
  if (err instanceof SnsAdapterError) return SNS_ERROR_CODES.PLATFORM_REJECTED;
  return 'UNKNOWN';
}

/** 소유권 확인하며 쓴다. 0행이면 남이 이 건을 가져간 것이므로 **그 뒤 아무것도 하지 않는다.** */
async function ownedUpdate(targetId: string, lockToken: string, setSql: string, params: any[]): Promise<boolean> {
  const r = await query(
    `UPDATE sns_post_targets SET ${setSql}, updated_at = NOW()
      WHERE id = $1::uuid AND lock_token = $2::uuid`,
    [targetId, lockToken, ...params],
  );
  return (r.rowCount ?? 0) > 0;
}

async function failTarget(targetId: string, lockToken: string, code: string, message: string): Promise<void> {
  await ownedUpdate(targetId, lockToken, `status = 'failed', last_error_code = $3, last_error = $4, lock_token = NULL`, [code, message]);
}

/** post 상태는 자식 집계 파생(§3-5) — 자식이 바뀔 때마다 같은 함수로 다시 계산한다. */
async function refreshPostStatus(postId: string): Promise<void> {
  await query(
    `UPDATE sns_posts p
        SET status = CASE
              WHEN NOT EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id) THEN 'draft'
              WHEN NOT EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.status <> 'cancelled') THEN 'cancelled'
              WHEN NOT EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.status <> 'published') THEN 'published'
              WHEN EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.status IN ('claimed','submitted')) THEN 'publishing'
              WHEN EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.status = 'published')
               AND EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.status = 'failed') THEN 'partial_failed'
              WHEN EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.status = 'scheduled') THEN 'scheduled'
              WHEN EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.status = 'failed') THEN 'failed'
              WHEN EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.status = 'published') THEN 'published'
              ELSE 'draft'
            END,
            updated_at = NOW()
      WHERE p.id = $1::uuid`,
    [postId],
  );
}

/** 이 계정의 최근 24시간 게시 성공 건수 — 레이트리밋 판정은 **우리 원장**으로 한다(플랫폼에 묻지 않는다). */
async function recentPublishCount(accountId: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM sns_post_targets
      WHERE account_id = $1::uuid AND platform_post_id IS NOT NULL AND updated_at > NOW() - INTERVAL '24 hours'`,
    [accountId],
  );
  return Number(r.rows[0]?.n || 0);
}

async function handleTarget(row: any): Promise<void> {
  const lockToken: string = row.lock_token;
  const targetId: string = row.id;

  if (!isSnsPlatform(row.platform)) {
    await failTarget(targetId, lockToken, 'UNKNOWN', '알 수 없는 채널입니다.');
    return;
  }
  const adapter = getSnsAdapter(row.platform);
  if (!isSnsPublishAdapter(adapter)) {
    await failTarget(targetId, lockToken, 'UNKNOWN', '이 채널은 아직 게시를 지원하지 않습니다.');
    return;
  }

  // 계정이 그 사이 끊겼을 수 있다 — 게시 직전에 다시 읽는다.
  const acc = await query(
    `SELECT id, status, access_token, external_account_id FROM sns_accounts
      WHERE id = $1::uuid AND company_id = $2::uuid`,
    [row.account_id, row.company_id],
  );
  const account = acc.rows[0];
  if (!account || account.status !== 'active' || !account.access_token) {
    await failTarget(targetId, lockToken, SNS_ERROR_CODES.REAUTH_REQUIRED, '채널 연결이 끊어져 게시하지 못했습니다. 다시 연결해 주세요.');
    return;
  }

  // 레이트리밋 — 상한에 닿았으면 실패가 아니라 **연기**다.
  const limit = adapter.capabilities.dailyLimit;
  if (await recentPublishCount(account.id) >= limit) {
    await ownedUpdate(targetId, lockToken,
      `status = 'scheduled', lock_token = NULL, next_attempt_at = NOW() + INTERVAL '1 hour',
       last_error_code = $3, last_error = '채널의 하루 게시 한도에 걸려 잠시 뒤 다시 시도합니다.'`,
      [SNS_ERROR_CODES.RATE_LIMITED]);
    return;
  }

  // 미디어 — target 마다 그 채널 규격으로 굽는다(§3-7). **여기가 "채널마다 다른 규격"이 실제로 맞춰지는 자리다.**
  const mediaRows = await query(
    `SELECT m.id, m.path FROM sns_posts p
       JOIN LATERAL unnest(p.media_ids) WITH ORDINALITY AS mi(media_id, ord) ON TRUE
       JOIN sns_media m ON m.id = mi.media_id
      WHERE p.id = $1::uuid AND m.company_id = $2::uuid
      ORDER BY mi.ord`,
    [row.post_id, row.company_id],
  );

  const mediaUrls: string[] = [];
  try {
    for (const m of mediaRows.rows) {
      await renderSnsPublishFile({
        companyId: row.company_id,
        targetId,
        sourceRelPath: m.path,
        spec: adapter.capabilities,
        mode: 'pad',   // ⛔ 기본은 언제나 잘림 0. crop 은 사용자가 그 채널에 대해 고른 경우에만(S2 화면).
      });
      // salt = targetId. 별도 컬럼을 두지 않는 이유 = targetId 가 이미 추측 불가능한 UUID 이고,
      // target 당 고정이라 URL 안정(플랫폼 캐시 생존) 조건도 그대로 만족한다(§3-7).
      mediaUrls.push(mediaUrlFor(targetId, m.id, row.company_id, targetId));
    }
  } catch (err) {
    await failTarget(targetId, lockToken, failureCode(err), failureMessage(err));
    return;
  }

  const req: SnsPublishRequest = {
    externalAccountId: account.external_account_id,
    accessToken: account.access_token,
    caption: row.caption,
    format: row.format,
    mediaUrls,
  };

  try {
    // ③ 컨테이너 — 이미 만들어 둔 것이 있으면 재사용한다(재시도 전 증거 우선 · §2-8).
    let containerId: string | null = row.container_id || null;
    if (!containerId) {
      const created = await adapter.createPost(req);
      containerId = created.containerId;
      if (!await ownedUpdate(targetId, lockToken,
        `status = 'submitted', stage = 'container_created', container_id = $3, container_created_at = NOW()`,
        [containerId])) return;
    }

    // ④ 처리 대기 — 상한을 넘으면 다음 tick 으로 미룬다(여기서 오래 붙들지 않는다).
    const startedAt = Date.now();
    for (;;) {
      const st = await adapter.pollContainer(req, containerId);
      if (st.ready) break;
      if (st.failed) {
        // 되살릴 수 없다 — 컨테이너를 버리고 다음 tick 에 다시 만든다. **키는 그대로다.**
        await ownedUpdate(targetId, lockToken,
          `status = 'scheduled', lock_token = NULL, container_id = NULL, container_status = $3,
           next_attempt_at = NOW() + INTERVAL '2 minutes', attempt_count = attempt_count + 1`,
          [st.raw]);
        return;
      }
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        await ownedUpdate(targetId, lockToken,
          `stage = 'container_processing', container_status = $3, lock_token = NULL,
           next_attempt_at = NOW() + INTERVAL '2 minutes'`,
          [st.raw]);
        return;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }

    // ⑤ 게시 — 호출 **직전에** 소유권을 다시 확인한다. 여기가 이중 게시를 막는 마지막 겹이다.
    if (!await ownedUpdate(targetId, lockToken, `stage = 'publish_called'`, [])) return;
    const published = await adapter.publish(req, containerId);
    if (!await ownedUpdate(targetId, lockToken, `platform_post_id = $3`, [published.platformPostId])) return;

    // ⑥ 재조회 — **여기를 지나야 성공이다**(§2-6). 실패해도 `submitted` 로 두고 대조 워커에 넘긴다.
    if (adapter.capabilities.verify === 'immediate') {
      const fetched = await adapter.fetchPost(req, published.platformPostId);
      if (fetched.exists) {
        await ownedUpdate(targetId, lockToken,
          `status = 'published', permalink = $3, verified_at = NOW(), lock_token = NULL, last_error = NULL, last_error_code = NULL`,
          [fetched.permalink]);
      } else {
        await ownedUpdate(targetId, lockToken,
          `verify_attempt_count = verify_attempt_count + 1, lock_token = NULL`, []);
      }
    } else {
      // 확인 수단이 없거나 뒤로 미루는 채널 — `submitted` 가 종착지이고 화면이 처음부터 그렇게 말한다.
      await ownedUpdate(targetId, lockToken, `lock_token = NULL`, []);
    }
  } catch (err) {
    console.error(`[SNS publish] ${row.platform} target ${targetId} 실패:`,
      err instanceof SnsAdapterError ? { code: err.code, raw: err.raw } : err);
    await failTarget(targetId, lockToken, failureCode(err), failureMessage(err));
  } finally {
    await refreshPostStatus(row.post_id);
  }
}

async function tick(): Promise<void> {
  // ⛔ 소급 게시 0 — 게시 선점보다 **먼저** 닫는다(§2-15 "이 가드가 워커보다 먼저 들어간다").
  const stale = await query(
    `UPDATE sns_post_targets
        SET status = 'failed', last_error_code = $2,
            last_error = '예약 시각이 지나 올리지 않았습니다. 지금 올리기를 눌러 주세요.', updated_at = NOW()
      WHERE status = 'scheduled' AND scheduled_at < NOW() - ($1 || ' milliseconds')::interval
      RETURNING post_id`,
    [String(STALE_MS), SNS_ERROR_CODES.SCHEDULE_EXPIRED],
  );
  for (const r of stale.rows) await refreshPostStatus(r.post_id);

  if (!armed) {
    const pending = await query(`SELECT COUNT(*)::int AS n FROM sns_post_targets WHERE status = 'scheduled' AND scheduled_at <= NOW()`);
    console.log(`[SNS publish] 첫 tick — 대기 ${pending.rows[0]?.n ?? 0}건. 이번에는 게시하지 않는다(소급 가드).`);
    armed = true;
    return;
  }

  const lockToken = randomUUID();
  const picked = await query(
    `UPDATE sns_post_targets
        SET status = 'claimed', lock_token = $1::uuid, claimed_at = NOW(), updated_at = NOW()
      WHERE id IN (
        SELECT id FROM sns_post_targets
         WHERE status = 'scheduled'
           AND scheduled_at <= NOW()
           AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
         ORDER BY scheduled_at
         LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [lockToken],
  );

  for (const row of picked.rows) {
    try {
      await handleTarget(row);
    } catch (err) {
      console.error('[SNS publish] 처리 오류:', err);
    }
  }
}

export function startSnsPublishWorker(): void {
  if (!String(process.env.SNS_COMPANY_IDS || '').trim()) return;

  console.log('[SNS publish] 발행 워커 시작 (30초 주기)');
  const run = async () => {
    try {
      await tick();
    } catch (err: any) {
      if (isMissingSnsTable(err)) return;
      console.error('[SNS publish] tick 오류:', err);
    }
  };
  setTimeout(() => { void run(); }, FIRST_DELAY_MS);
  setInterval(() => { void run(); }, TICK_MS);
}
