/**
 * sns-reconcile-worker.ts — SNS 대조 워커 (2026-09-21 S3)
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-4 · 불변 §2-3(이중 진실 = 안전망 워커 동반).
 *
 * 30분 주기. 하는 일 셋이다.
 *   ① **좌초 회수** — `claimed` 인데 10분째 움직이지 않는 행(프로세스가 죽었다). 되돌려 다시 잡게 한다.
 *      ⛔ 단 `stage='publish_called'` 는 `scheduled` 로 되돌리지 않는다 — 게시가 이미 나갔을 수 있어
 *         되돌리면 **두 번 올라간다.** 그 행은 `submitted` 로 올려 증거 조회로 결말을 짓는다.
 *   ② **접수분 확인** — `submitted` 를 재조회해 `verified_at` 을 찍는다. 24시간이 지나도 확인이 안 되면
 *      `verify_gave_up_at` 을 찍고 **조회·UPDATE 양쪽에서 뺀다**(BUGS 818행 = 새 상태값이 되맞춤 조건에
 *      걸려 매 tick 되돌아가던 회귀. 그 부류를 처음부터 막는다).
 *   ③ **삭제 감지** — `published` 인데 플랫폼에서 사라진 것에 `deleted_on_platform_at` 을 찍는다.
 *      인스타에는 삭제 API 가 없어(§1-4) 사람이 앱에서 지운 경우가 여기로 들어온다.
 *
 * ⛔ 종결(`failed`·`cancelled`)과 확정(`published` + 확인 끝)은 조회에서 뺀다. 끝난 것을 계속 들추면
 *   그것이 곧 되돌림 사고다.
 */

import { query } from '../config/database';
import { getSnsAdapter } from './sns';
import { isSnsPublishAdapter, SnsAdapterError, type ISnsAdapter, type SnsPublishRequest } from './sns/adapter';
import { isSnsPlatform, SNS_ERROR_CODES } from './sns-constants';
import { ensureFreshSnsToken, isMissingSnsTable } from './sns-accounts';

const TICK_MS = 30 * 60 * 1000;
const FIRST_DELAY_MS = 90 * 1000;
/** 선점하고 이만큼 움직이지 않으면 죽은 것으로 본다. */
const STALL_MINUTES = 10;
/** 접수는 됐는데 확인이 안 되는 채로 이만큼 지나면 포기하고 사람에게 넘긴다. */
const VERIFY_GIVE_UP_HOURS = 24;
/** 한 tick 에 재조회할 최대 건수(플랫폼 호출을 몰아치지 않는다). */
const BATCH = 30;

async function buildRequest(row: any, adapter: ISnsAdapter): Promise<SnsPublishRequest | null> {
  const acc = await query(
    `SELECT id, company_id, platform, access_token, token_expires_at, external_account_id, status FROM sns_accounts
      WHERE id = $1::uuid AND company_id = $2::uuid`,
    [row.account_id, row.company_id],
  );
  const account = acc.rows[0];
  if (!account?.access_token) return null;
  return {
    externalAccountId: account.external_account_id,
    // ★ 1차-B — X 는 액세스 토큰이 2시간이라 확인 직전에 갱신한다(행 잠금 안에서 · 불변 25).
    accessToken: await ensureFreshSnsToken(account, adapter),
    caption: row.caption,
    format: row.format,
    media: [],   // 재조회에는 미디어가 필요 없다
  };
}

/** ① 좌초 회수 */
async function recoverStalled(): Promise<void> {
  // 게시 호출까지 간 행 — 되돌리면 이중 게시다. 증거 조회로 결말을 짓게 `submitted` 로 올린다.
  //   ★ 2026-09-24 S2 — 게시 id 가 있어야 확인 조회가 된다. 없으면 `submitted` 로 올려도 어느 경로도 줍지 않아
  //   영구히 '올리는 중'이었다(0924 최종 검증 R3-04). 그 행은 발행 워커와 같은 모양(결과 모름 · 다시 시도 잠금)으로 닫는다.
  const called = await query(
    `UPDATE sns_post_targets
        SET status = 'submitted', lock_token = NULL, updated_at = NOW()
      WHERE status = 'claimed' AND stage = 'publish_called' AND platform_post_id IS NOT NULL
        AND claimed_at < NOW() - ($1 || ' minutes')::interval
      RETURNING id`,
    [String(STALL_MINUTES)],
  );
  if (called.rowCount) console.warn(`[SNS reconcile] 게시 호출 후 좌초 ${called.rowCount}건 → 확인 대기로 올림`);
  const unknown = await query(
    `UPDATE sns_post_targets
        SET status = 'failed', lock_token = NULL, next_attempt_at = NULL,
            last_error_code = $2, last_error = '올라갔는지 확인하지 못했어요. 채널에서 먼저 확인해 주세요.', updated_at = NOW()
      WHERE status = 'claimed' AND stage = 'publish_called' AND platform_post_id IS NULL
        AND claimed_at < NOW() - ($1 || ' minutes')::interval
      RETURNING id, post_id`,
    [String(STALL_MINUTES), SNS_ERROR_CODES.PUBLISH_OUTCOME_UNKNOWN],
  );
  if (unknown.rowCount) console.warn(`[SNS reconcile] 게시 호출 후 결과 모름 ${unknown.rowCount}건 → 다시 시도 잠금 · 채널에서 확인`);
  for (const r of unknown.rows) await refreshPostStatus(r.post_id);

  const back = await query(
    `UPDATE sns_post_targets
        SET status = 'scheduled', lock_token = NULL, claimed_at = NULL,
            attempt_count = attempt_count + 1, updated_at = NOW()
      WHERE status = 'claimed' AND (stage IS NULL OR stage <> 'publish_called')
        AND claimed_at < NOW() - ($1 || ' minutes')::interval
      RETURNING id`,
    [String(STALL_MINUTES)],
  );
  if (back.rowCount) console.warn(`[SNS reconcile] 좌초 ${back.rowCount}건 회수 → 재시도 대기`);
}

/** ② 접수분 확인 */
async function verifySubmitted(): Promise<void> {
  const rows = await query(
    `SELECT * FROM sns_post_targets
      WHERE status = 'submitted'
        AND platform_post_id IS NOT NULL
        AND verified_at IS NULL
        AND verify_gave_up_at IS NULL
      ORDER BY updated_at
      LIMIT ${BATCH}`,
  );

  for (const row of rows.rows) {
    if (!isSnsPlatform(row.platform)) continue;
    const adapter = getSnsAdapter(row.platform);
    if (!isSnsPublishAdapter(adapter)) continue;
    if (adapter.capabilities.verify === 'none') continue;   // 확인 수단이 없는 채널은 건드리지 않는다

    try {
      const req = await buildRequest(row, adapter);
      if (!req) continue;
      const fetched = await adapter.fetchPost(req, row.platform_post_id);
      if (fetched.exists) {
        await query(
          `UPDATE sns_post_targets
              SET status = 'published', permalink = COALESCE($2, permalink), verified_at = NOW(), updated_at = NOW()
            WHERE id = $1::uuid AND verified_at IS NULL`,
          [row.id, fetched.permalink],
        );
        await refreshPostStatus(row.post_id);
        continue;
      }
      // 아직 안 보인다 — 횟수만 올리고 다음 tick 에 다시 본다.
      await query(
        `UPDATE sns_post_targets
            SET verify_attempt_count = verify_attempt_count + 1, last_verify_error = $2, updated_at = NOW()
          WHERE id = $1::uuid`,
        [row.id, '채널에서 아직 확인되지 않았습니다.'],
      );
    } catch (err: any) {
      await query(
        `UPDATE sns_post_targets
            SET verify_attempt_count = verify_attempt_count + 1, last_verify_error = $2, updated_at = NOW()
          WHERE id = $1::uuid`,
        [row.id, String(err instanceof SnsAdapterError ? err.message : err).slice(0, 500)],
      );
    }
  }

  // 24시간이 지나도 확인이 안 된 것 — 포기하고 사람이 보게 한다. **이후 조회에서 빠진다.**
  const gaveUp = await query(
    `UPDATE sns_post_targets
        SET verify_gave_up_at = NOW(), updated_at = NOW()
      WHERE status = 'submitted' AND platform_post_id IS NOT NULL
        AND verified_at IS NULL AND verify_gave_up_at IS NULL
        AND updated_at < NOW() - ($1 || ' hours')::interval
      RETURNING id`,
    [String(VERIFY_GIVE_UP_HOURS)],
  );
  if (gaveUp.rowCount) console.warn(`[SNS reconcile] 확인 포기 ${gaveUp.rowCount}건 — 화면에 permalink 로 안내`);
}

/** ③ 삭제 감지 — 확인이 끝난 것 중 표본만 본다(전수를 매 tick 도는 것은 낭비다). */
async function detectDeleted(): Promise<void> {
  const rows = await query(
    `SELECT * FROM sns_post_targets
      WHERE status = 'published' AND verified_at IS NOT NULL
        AND deleted_on_platform_at IS NULL
        AND verified_at > NOW() - INTERVAL '30 days'
      ORDER BY verified_at DESC
      LIMIT ${BATCH}`,
  );

  for (const row of rows.rows) {
    if (!isSnsPlatform(row.platform)) continue;
    const adapter = getSnsAdapter(row.platform);
    if (!isSnsPublishAdapter(adapter)) continue;
    if (adapter.capabilities.ephemeral) continue;   // 스토리처럼 원래 사라지는 것은 대조 대상이 아니다
    // ★ 1차-B — 실비 채널은 삭제 감지를 하지 않는다. 30분마다 같은 글을 다시 읽으면 읽을 때마다 과금된다(설계 1b §3-7).
    if (adapter.capabilities.metered) continue;

    try {
      const req = await buildRequest(row, adapter);
      if (!req) continue;
      const fetched = await adapter.fetchPost(req, row.platform_post_id);
      if (!fetched.exists) {
        await query(
          `UPDATE sns_post_targets SET deleted_on_platform_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
          [row.id],
        );
      }
    } catch { /* 일시 오류로 삭제 판정하지 않는다 */ }
  }
}

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

export function startSnsReconcileWorker(): void {
  if (!String(process.env.SNS_COMPANY_IDS || '').trim()) return;

  console.log('[SNS reconcile] 대조 워커 시작 (30분 주기)');
  const run = async () => {
    try {
      await recoverStalled();
      await verifySubmitted();
      await detectDeleted();
    } catch (err: any) {
      if (isMissingSnsTable(err)) return;
      console.error('[SNS reconcile] tick 오류:', err);
    }
  };
  setTimeout(() => { void run(); }, FIRST_DELAY_MS);
  setInterval(() => { void run(); }, TICK_MS);
}
