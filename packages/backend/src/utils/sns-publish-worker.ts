/**
 * sns-publish-worker.ts — SNS 발행 워커 (2026-09-21 S3 · 2026-09-23 1차-B)
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-4 · 불변 §2-6·§2-8·§2-15
 *          + docs/2026-09-23-sns-1b-design.md §3-6 · 불변 23·24·25.
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
 *
 * ★ 1차-B 가 바꾼 것
 *   D1 **처리 대기는 워커를 붙들지 않는다**(불변 24) — tick 당 1회 확인 · 안 됐으면 `next_attempt_at` 으로 미룬다.
 *      전에는 5분을 넘긴 컨테이너가 어느 워커에도 다시 잡히지 않아 영구히 「올리는 중」이었다.
 *      재개 대상 = `submitted` + 게시 id 없음 + 컨테이너 있음 + `next_attempt_at` 도래.
 *      게시 호출 직전 기록에서 `next_attempt_at` 을 비워 **게시까지 간 행은 재개 대상에서 빠진다**(stage 는 읽지 않는다).
 *   D2 게시본은 target·미디어마다 따로 굽는다(`sns-media.ts snsRenderFileName`).
 *   D3 **컨테이너 실패 상한 3회** — 코덱 거부 영상이 컨테이너를 무한히 다시 만들던 경로를 닫는다.
 *   B4 사용 직전 토큰 갱신(X) · 실비 채널 월 상한(fail-closed · 불변 23).
 */

import { randomUUID } from 'crypto';
import { promises as fsp } from 'fs';
import { query } from '../config/database';
import { getSnsAdapter } from './sns';
import { isSnsPublishAdapter, SnsAdapterError, type ISnsAdapter, type SnsPublishMedia, type SnsPublishRequest } from './sns/adapter';
import { isSnsPlatform, SNS_ERROR_CODES } from './sns-constants';
import { renderSnsPublishFile, snsMediaAbsPath, snsVideoMime, SnsMediaError } from './sns-media';
import { signSnsMediaToken } from './sns-signed-media';
import { ensureFreshSnsToken, isMissingSnsTable, isSnsReauthError, setSnsAccountStatus } from './sns-accounts';
import { snsChannelAvailable, snsMeteredMonthlyCap } from './sns-availability';

const TICK_MS = 30 * 1000;
const FIRST_DELAY_MS = 60 * 1000;
const BATCH = 5;
/** 예약 시각이 이만큼 지나면 게시하지 않는다(인스타 컨테이너 만료값과 같은 24시간). */
const STALE_MS = 24 * 60 * 60 * 1000;
/** 컨테이너를 만들고 이만큼 지나도 처리가 안 끝나면 실패로 닫는다(영상 · 설계 1b §3-6). */
const PROCESSING_LIMIT_MS = 30 * 60 * 1000;
/** 컨테이너 ERROR·EXPIRED 가 이 횟수째면 다시 만들지 않고 닫는다(D3). */
const CONTAINER_FAIL_LIMIT = 3;

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

/** 사람이 읽는 실패 사유 한 줄. 원문은 로그와 `last_error` 괄호 안에 남긴다(사유를 버리지 않는다). */
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

/**
 * 컨테이너 실패 사유 → 사람이 읽는 문장. Threads `error_message` 원문 목록(troubleshooting 문서) 기준.
 * 모르는 값은 일반 문장 + 원문 괄호.
 */
const CONTAINER_REASON: Record<string, string> = {
  FAILED_DOWNLOADING_VIDEO: '채널이 영상을 내려받지 못했어요.',
  FAILED_PROCESSING_VIDEO: '채널이 영상을 처리하지 못했어요. 다른 형식으로 내보낸 영상을 올려 주세요.',
  FAILED_PROCESSING_AUDIO: '채널이 영상의 소리를 처리하지 못했어요. 다른 형식으로 내보낸 영상을 올려 주세요.',
  INVALID_DURATION: '채널이 받지 않는 영상 길이예요.',
  INVALID_ASPEC_RATIO: '채널이 받지 않는 화면 비율이에요.',
  INVALID_FRAME_RATE: '초당 프레임이 채널 기준(23~60)을 벗어났어요.',
  INVALID_BIT_RATE: '영상 비트레이트가 채널 기준을 넘었어요.',
  INVALID_AUDIO_CHANNELS: '소리는 모노·스테레오만 받아요.',
  INVALID_AUDIO_CHANNEL_LAYOUT: '소리는 모노·스테레오만 받아요.',
};
function containerFailureText(detail: string | null | undefined): string {
  const d = String(detail || '').trim();
  const known = CONTAINER_REASON[d];
  if (known) return `${known} (${d})`;
  return d ? `채널이 게시물을 처리하지 못했어요. (${d.slice(0, 160)})` : '채널이 게시물을 처리하지 못했어요.';
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
  await ownedUpdate(targetId, lockToken,
    `status = 'failed', last_error_code = $3, last_error = $4, lock_token = NULL, next_attempt_at = NULL`,
    [code, message]);
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

/**
 * 실비 채널의 이번 달(KST) 게시 건수 — **전 회사 합산**(청구서가 우리 한 장이다).
 * ⚠ 같은 순간 다른 워커가 잡은 행은 세지 못한다 → 최대 한 배치(5건)까지 넘칠 수 있다. 콘솔 지출 상한이 두 번째 겹이다.
 */
async function meteredMonthCount(platform: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM sns_post_targets
      WHERE platform = $1 AND platform_post_id IS NOT NULL
        AND created_at >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`,
    [platform],
  );
  return Number(r.rows[0]?.n || 0);
}

/**
 * 이 target 이 싣고 갈 미디어. 사진은 그 채널 규격으로 굽고(§3-7 · 잘림 0), 영상은 보관본 그대로(불변 21).
 * **여기가 "채널마다 다른 규격"이 실제로 맞춰지는 자리다.**
 */
async function buildMedia(row: any, adapter: ISnsAdapter): Promise<SnsPublishMedia[]> {
  const mediaRows = await query(
    `SELECT m.id, m.path, m.kind, m.format, m.bytes FROM sns_posts p
       JOIN LATERAL unnest(p.media_ids) WITH ORDINALITY AS mi(media_id, ord) ON TRUE
       JOIN sns_media m ON m.id = mi.media_id
      WHERE p.id = $1::uuid AND m.company_id = $2::uuid
      ORDER BY mi.ord`,
    [row.post_id, row.company_id],
  );
  const out: SnsPublishMedia[] = [];
  for (const m of mediaRows.rows) {
    // salt = targetId. target 당 고정이라 URL 안정(플랫폼 캐시 생존) 조건을 만족하고, 추측 불가능한 UUID 다(§3-7).
    const url = mediaUrlFor(row.id, m.id, row.company_id, row.id);
    if (m.kind === 'video') {
      const absPath = snsMediaAbsPath(m.path);
      const st = await fsp.stat(absPath).catch(() => null);
      if (!st) throw new SnsMediaError('SOURCE_MISSING', '원본 영상을 찾지 못했어요. 다시 올려 주세요.');
      out.push({ kind: 'video', url, absPath, mime: snsVideoMime(m.format), bytes: st.size });
      continue;
    }
    const rendered = await renderSnsPublishFile({
      companyId: row.company_id,
      targetId: row.id,
      mediaId: m.id,
      sourceRelPath: m.path,
      spec: adapter.capabilities,
      mode: 'pad',   // ⛔ 기본은 언제나 잘림 0. crop 은 사용자가 그 채널에 대해 고른 경우에만.
    });
    out.push({ kind: 'image', url, absPath: rendered.absPath, mime: 'image/jpeg', bytes: rendered.bytes });
  }
  return out;
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
  // 개방 판정(불변 23) — ENV 가 그 사이 비었으면(실비 상한 해제 포함) 보내지 않는다.
  const open = snsChannelAvailable(adapter, row.company_id);
  if (!open.ok) {
    await failTarget(targetId, lockToken, SNS_ERROR_CODES.CHANNEL_CLOSED, '지금은 이 채널에 올릴 수 없어요.');
    return;
  }

  // 계정이 그 사이 끊겼을 수 있다 — 게시 직전에 다시 읽는다.
  const acc = await query(
    `SELECT id, company_id, platform, status, access_token, token_expires_at, external_account_id FROM sns_accounts
      WHERE id = $1::uuid AND company_id = $2::uuid`,
    [row.account_id, row.company_id],
  );
  const account = acc.rows[0];
  if (!account || account.status !== 'active' || !account.access_token) {
    await failTarget(targetId, lockToken, SNS_ERROR_CODES.REAUTH_REQUIRED, '채널 연결이 끊어져 게시하지 못했습니다. 다시 연결해 주세요.');
    return;
  }

  // 레이트리밋 — 상한에 닿았으면 실패가 아니라 **연기**다. 재개 행(컨테이너 있음)은 이미 센 건이라 다시 막지 않는다.
  if (!row.container_id && await recentPublishCount(account.id) >= adapter.capabilities.dailyLimit) {
    await ownedUpdate(targetId, lockToken,
      `status = 'scheduled', lock_token = NULL, next_attempt_at = NOW() + INTERVAL '1 hour',
       last_error_code = $3, last_error = '채널의 하루 게시 한도에 걸려 잠시 뒤 다시 시도합니다.'`,
      [SNS_ERROR_CODES.RATE_LIMITED]);
    return;
  }

  // 실비 채널 월 상한(fail-closed · 불변 23) — 컨테이너(업로드)를 만들기 전에 센다.
  if (adapter.capabilities.metered && !row.container_id) {
    if (await meteredMonthCount(row.platform) >= snsMeteredMonthlyCap()) {
      await failTarget(targetId, lockToken, SNS_ERROR_CODES.MONTHLY_CAP,
        `이번 달 ${adapter.label} 게시 한도에 닿아 올리지 않았어요. 다음 달에 다시 시도해 주세요.`);
      return;
    }
  }

  let req: SnsPublishRequest;
  try {
    // 사용 직전 토큰(X · 행 잠금 안에서 갱신 · 불변 25). 다른 채널은 저장된 값 그대로.
    const accessToken = await ensureFreshSnsToken(account, adapter);
    req = {
      externalAccountId: account.external_account_id,
      accessToken,
      caption: row.caption,
      format: row.format,
      media: await buildMedia(row, adapter),
    };
  } catch (err) {
    if (isSnsReauthError(err)) {
      await setSnsAccountStatus(row.company_id, account.id, 'reauth_required', '채널 연결이 만료되었어요. 다시 연결해 주세요.');
      await failTarget(targetId, lockToken, SNS_ERROR_CODES.REAUTH_REQUIRED, '채널 연결이 만료되어 게시하지 못했습니다. 다시 연결해 주세요.');
    } else {
      console.error(`[SNS publish] ${row.platform} target ${targetId} 준비 실패:`,
        err instanceof SnsAdapterError ? { code: err.code, raw: err.raw } : err);
      await failTarget(targetId, lockToken, failureCode(err), failureMessage(err));
    }
    await refreshPostStatus(row.post_id);
    return;
  }

  // ★ 2026-09-24 S2 — 게시 호출이 어디까지 갔는지. catch 가 "올라갔을 수 있는가"를 이 두 값으로 가른다.
  let publishCalled = false;
  let postIdSaved = false;
  try {
    // ③ 컨테이너 — 이미 만들어 둔 것이 있으면 재사용한다(재시도 전 증거 우선 · §2-8 · D1 재개).
    let containerId: string | null = row.container_id || null;
    let containerCreatedAt: number | null = row.container_created_at ? new Date(row.container_created_at).getTime() : null;
    if (!containerId) {
      const created = await adapter.createPost(req);
      containerId = created.containerId;
      containerCreatedAt = Date.now();
      if (!await ownedUpdate(targetId, lockToken,
        `status = 'submitted', stage = 'container_created', container_id = $3, container_created_at = NOW()`,
        [containerId])) return;
    }

    // ④ 처리 확인 — **tick 당 1회**(불변 24). 안 됐으면 미루고 이 행을 놓아준다.
    const st = await adapter.pollContainer(req, containerId);
    if (st.failed) {
      const attempts = Number(row.attempt_count || 0) + 1;
      const text = containerFailureText(st.detail);
      console.warn(`[SNS publish] ${row.platform} target ${targetId} 컨테이너 ${st.raw} (${attempts}/${CONTAINER_FAIL_LIMIT}) ${st.detail || ''}`);
      if (attempts >= CONTAINER_FAIL_LIMIT) {
        // D3 — 같은 영상이 같은 이유로 계속 거부된다. 새 컨테이너를 더 만들지 않는다.
        await ownedUpdate(targetId, lockToken,
          `status = 'failed', container_status = $3, attempt_count = attempt_count + 1,
           last_error_code = $4, last_error = $5, lock_token = NULL, next_attempt_at = NULL`,
          [String(st.raw).slice(0, 20), SNS_ERROR_CODES.CONTAINER_FAILED, text]);
        return;
      }
      // 되살릴 수 없다 — 컨테이너를 버리고 다음 tick 에 다시 만든다. **키는 그대로다.**
      await ownedUpdate(targetId, lockToken,
        `status = 'scheduled', lock_token = NULL, container_id = NULL, container_status = $3, last_error = $4,
         next_attempt_at = NOW() + INTERVAL '2 minutes', attempt_count = attempt_count + 1`,
        [String(st.raw).slice(0, 20), text]);
      return;
    }
    if (!st.ready) {
      if (containerCreatedAt !== null && Date.now() - containerCreatedAt > PROCESSING_LIMIT_MS) {
        await failTarget(targetId, lockToken, SNS_ERROR_CODES.PROCESSING_TIMEOUT, '채널이 영상 처리를 끝내지 못했어요. 다시 시도해 주세요.');
        return;
      }
      // D1 — `submitted` 그대로 두고 다음 확인 시각만 적는다. 재개 선점이 이 시각에 다시 잡는다.
      await ownedUpdate(targetId, lockToken,
        `status = 'submitted', stage = 'container_processing', container_status = $3, lock_token = NULL,
         next_attempt_at = NOW() + ($4 || ' seconds')::interval`,
        [String(st.raw).slice(0, 20), String(adapter.capabilities.pollIntervalSec)]);
      return;
    }

    // ⑤ 게시 — 호출 **직전에** 소유권을 다시 확인한다. 여기가 이중 게시를 막는 마지막 겹이다.
    //    `next_attempt_at` 을 비워 이 행이 재개 선점에 다시 잡히지 않게 한다(게시가 나갔을 수 있는 행 · D1).
    if (!await ownedUpdate(targetId, lockToken, `stage = 'publish_called', next_attempt_at = NULL`, [])) return;
    publishCalled = true;
    const published = await adapter.publish(req, containerId);
    if (!await ownedUpdate(targetId, lockToken, `platform_post_id = $3`, [published.platformPostId])) return;
    postIdSaved = true;

    // ⑥ 재조회 — **여기를 지나야 성공이다**(§2-6). 실패해도 `submitted` 로 두고 대조 워커에 넘긴다.
    if (adapter.capabilities.verify === 'immediate') {
      const fetched = await adapter.fetchPost(req, published.platformPostId);
      if (fetched.exists) {
        await ownedUpdate(targetId, lockToken,
          `status = 'published', permalink = $3, verified_at = NOW(), lock_token = NULL, last_error = NULL, last_error_code = NULL`,
          [fetched.permalink]);
      } else {
        await ownedUpdate(targetId, lockToken,
          `status = 'submitted', verify_attempt_count = verify_attempt_count + 1, lock_token = NULL`, []);
      }
    } else {
      // 확인 수단이 없거나 뒤로 미루는 채널 — `submitted` 가 종착지이고 화면이 처음부터 그렇게 말한다.
      await ownedUpdate(targetId, lockToken, `status = 'submitted', lock_token = NULL`, []);
    }
  } catch (err) {
    console.error(`[SNS publish] ${row.platform} target ${targetId} 실패:`,
      err instanceof SnsAdapterError ? { code: err.code, raw: err.raw } : err);
    // ★ 2026-09-24 S2 — 게시가 나갔을 수 있는 오류는 '실패'로 적지 않는다(K3). 적으면 다시 시도가 열려 두 번 올라간다.
    //   ① 게시 id 를 적은 뒤 = 올라갔다. 확인만 못 했다 → submitted 로 두고 대조 워커가 확인한다.
    //   ② 게시를 부른 뒤 결과를 못 받음(네트워크·5xx) = 모른다 → 결과 모름 코드 · 다시 시도 잠금 · 채널에서 확인.
    //   ③ 4xx 는 채널이 확정 거절한 것이라 지금처럼 실패다. ⛔ 이 판정이 아래 401 분기보다 앞에 있어야 한다.
    const definitiveReject = err instanceof SnsAdapterError
      && typeof err.httpStatus === 'number' && err.httpStatus >= 400 && err.httpStatus < 500;
    if (postIdSaved) {
      await ownedUpdate(targetId, lockToken, `status = 'submitted', lock_token = NULL`, []);
    } else if (publishCalled && !definitiveReject) {
      await failTarget(targetId, lockToken, SNS_ERROR_CODES.PUBLISH_OUTCOME_UNKNOWN,
        '올라갔는지 확인하지 못했어요. 채널에서 먼저 확인해 주세요.');
    } else if (isSnsReauthError(err) && err instanceof SnsAdapterError && err.httpStatus === 401) {
      await setSnsAccountStatus(row.company_id, account.id, 'reauth_required', '채널 연결이 만료되었어요. 다시 연결해 주세요.');
      await failTarget(targetId, lockToken, SNS_ERROR_CODES.REAUTH_REQUIRED, '채널 연결이 만료되어 게시하지 못했습니다. 다시 연결해 주세요.');
    } else {
      await failTarget(targetId, lockToken, failureCode(err), failureMessage(err));
    }
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

  // 선점 = 예약 도래분 + **처리 대기 재개분(D1)**. 재개분은 게시 id 가 없고 컨테이너가 있으며 다음 확인 시각이 온 것.
  //   게시 호출까지 간 행은 `next_attempt_at` 이 비어 있어 여기 걸리지 않는다(이중 게시 차단).
  const lockToken = randomUUID();
  const picked = await query(
    `UPDATE sns_post_targets
        SET status = 'claimed', lock_token = $1::uuid, claimed_at = NOW(), updated_at = NOW()
      WHERE id IN (
        SELECT id FROM sns_post_targets
         WHERE (status = 'scheduled'
                AND scheduled_at <= NOW()
                AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
            OR (status = 'submitted'
                AND platform_post_id IS NULL
                AND container_id IS NOT NULL
                AND next_attempt_at IS NOT NULL
                AND next_attempt_at <= NOW())
         ORDER BY COALESCE(next_attempt_at, scheduled_at)
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
