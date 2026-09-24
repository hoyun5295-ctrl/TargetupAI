/**
 * sns-compose.ts — 글 저장·게시 한 번에 (2026-09-24 S5 · B-4 · E6)
 * 설계 SoT = docs/2026-09-24-sns-channel-design.md §4 B-4 · §6 E6 · §8.
 * 원래 자리 = routes/sns.ts POST /posts(검증·미디어 판정·확정본 INSERT). 판정 순서와 문구는 그대로 옮겼다.
 *
 * 순서 = 입력 판정(TAG_INVALID · 빈 글 · 채널 0 · 링크 결함 · 예약 시각 S3) → 미디어 판정(저장 전 · 1b §3-4)
 *   → [트랜잭션] composeId 대조 → 계정 FOR SHARE(전부 active) → 채널 개방·미디어 수용 → 확정본(CAPTION_NOT_OK)
 *   → expected 대조(409 CAPTION_CHANGED · ACCOUNT_STATE_CHANGED) → 글 고치기 대체(REPLACED) → INSERT(게시면 바로 scheduled) → COMMIT.
 *
 * ⛔ composeId = 한 번 누른 '올리기'의 이름. post id = uuid v5(회사·사용자·composeId) · target id = uuid v5(post·계정).
 *   같은 composeId 가 두 번 오면 **새 글을 만들지 않는다** — 내용이 같으면 200 existing · 다르면 409 COMPOSE_ALREADY_SAVED.
 *   동시 두 요청은 `ON CONFLICT (id) DO NOTHING` 으로 하나만 들어간다(sns_posts 기본 키 = id 전제 · 배포 전 확인 1).
 * ⛔ 게시를 요청했으면 넘침·채울 자리가 있는 채널이 하나라도 있으면 **전체를 막는다**(일부만 나가면 사용자가 믿는 것과 갈린다).
 */

import { createHash, randomUUID } from 'crypto';
import { pool, query } from '../config/database';
import { findLinkDefectInText, isUuid } from './normalize';
import { getSnsAdapter } from './sns';
import { snsChannelAvailable } from './sns-availability';
import { buildSnsCaption, invalidSnsTags, normalizeSnsTags, type SnsCaptionResult } from './sns-caption-rules';
import { snsMediaAbsPath } from './sns-media';
import { planSnsVideoFit, snsMediaBlockReason, type SnsVideoFacts } from './sns-media-fit';
import { probeSnsVideoFile } from './sns-video-probe';
import { snsMediaNeedsAiNotice } from './sns-ai-notice';
import { parseSnsScheduleAt } from './sns-schedule';
import { buildSnsIdempotencyKey } from './sns-idempotency';
import { SNS_ERROR_CODES } from './sns-constants';

/** composeId 이름 공간(고정 · 바꾸면 같은 composeId 가 다른 글이 된다 · 화면 미러 sns-draft.ts 와 같은 값) */
export const SNS_COMPOSE_NAMESPACE = '3b1f6a52-9c0e-5d7a-8e41-6f2c9a0b7d13';

/** RFC 4122 uuid v5(SHA-1). */
export function snsUuidV5(name: string, namespace = SNS_COMPOSE_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function snsComposePostId(companyId: string, userId: string | null, composeId: string): string {
  return snsUuidV5(`post:${companyId}:${userId ?? '-'}:${composeId}`);
}

export function snsComposeTargetId(postId: string, accountId: string): string {
  return snsUuidV5(`target:${postId}:${accountId}`);
}

export interface SnsComposeInput {
  companyId: string;
  userId: string | null;
  body: unknown;
  tags: unknown;
  mediaIds: unknown;
  accountIds: unknown;
  composeId?: unknown;
  /** 화면이 보여 준 확정본 {accountId: 글}. 있으면 서버 확정본과 대조한다. */
  expected?: unknown;
  /** 있으면 같은 트랜잭션에서 게시·예약까지 한다. scheduledAt 없으면 지금. */
  publish?: { scheduledAt?: unknown } | null;
  /** 글 고치기 — 이 글의 예약을 새 글로 바꾼다(글·태그·시각만). */
  replacesPostId?: unknown;
}

export interface SnsComposeTarget {
  targetId: string;
  accountId: string;
  platform: string;
  ok: boolean;
  overBy: number;
  droppedTags: string[];
  caption: string;
}

export type SnsComposeResult =
  | { ok: true; existing: boolean; postId: string; published: boolean; scheduledAt: string | null; targets: SnsComposeTarget[] }
  | { ok: false; status: number; code: string; error: string; extra?: Record<string, unknown> };

function fail(status: number, code: string, error: string, extra?: Record<string, unknown>): SnsComposeResult {
  return { ok: false, status, code, error, extra };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a);
  return x.size === new Set(b).size && b.every((v) => x.has(v));
}

type Client = { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }> };

/** 이미 저장된 같은 composeId 글과 대조한다. */
async function compareExisting(db: Client, companyId: string, postId: string, want: {
  body: string; tags: string[]; mediaIds: string[]; accountIds: string[];
}): Promise<SnsComposeResult | null> {
  const p = await db.query(
    `SELECT id, body, tags, media_ids, scheduled_at FROM sns_posts WHERE id = $1::uuid AND company_id = $2::uuid`,
    [postId, companyId],
  );
  const post = p.rows[0];
  if (!post) return null;
  const t = await db.query(
    `SELECT id, account_id, platform, caption, status FROM sns_post_targets WHERE post_id = $1::uuid AND company_id = $2::uuid ORDER BY created_at, id`,
    [postId, companyId],
  );
  const same = String(post.body ?? '') === want.body
    && sameList((post.tags ?? []).map(String), want.tags)
    && sameList((post.media_ids ?? []).map(String), want.mediaIds)
    && sameSet(t.rows.map((r) => String(r.account_id)), want.accountIds);
  if (!same) {
    return fail(409, 'COMPOSE_ALREADY_SAVED', '이 글은 이미 저장됐어요. 고친 내용은 반영되지 않았어요.', { postId });
  }
  return {
    ok: true,
    existing: true,
    postId,
    published: t.rows.some((r) => r.status !== 'draft'),
    scheduledAt: post.scheduled_at ? new Date(post.scheduled_at).toISOString() : null,
    targets: t.rows.map((r) => ({
      targetId: String(r.id), accountId: String(r.account_id), platform: String(r.platform),
      ok: true, overBy: 0, droppedTags: [], caption: String(r.caption ?? ''),
    })),
  };
}

export async function composeSnsPost(input: SnsComposeInput): Promise<SnsComposeResult> {
  const { companyId, userId } = input;
  const body = String(input.body ?? '');
  const rawTags = Array.isArray(input.tags) ? input.tags : [];
  const invalid = invalidSnsTags(rawTags);
  if (invalid.length) return fail(400, 'TAG_INVALID', `태그 '${invalid[0].raw}': ${invalid[0].reason}`, { invalid });
  const tags = normalizeSnsTags(rawTags);
  const mediaIds: string[] = Array.isArray(input.mediaIds) ? input.mediaIds.map(String) : [];
  const accountIds: string[] = Array.from(new Set(Array.isArray(input.accountIds) ? input.accountIds.map(String) : []));
  const composeId = typeof input.composeId === 'string' && isUuid(input.composeId) ? input.composeId : null;
  const replacesPostId = typeof input.replacesPostId === 'string' && isUuid(input.replacesPostId) ? input.replacesPostId : null;
  const publish = !!input.publish;

  if (!body.trim() && mediaIds.length === 0) {
    return fail(400, 'EMPTY_POST', '글이나 사진·영상 중 하나는 있어야 해요.');
  }
  if (accountIds.length === 0) {
    return fail(400, 'NO_CHANNEL', '올릴 채널을 하나 이상 골라 주세요.');
  }
  if (!mediaIds.every(isUuid) || !accountIds.every(isUuid)) {
    return fail(400, 'BAD_REQUEST', '요청을 읽지 못했어요. 화면을 새로 고쳐 주세요.');
  }
  // 글 고치기는 옛 예약을 취소하고 새 예약을 거는 한 동작이다 — 초안만 만들면 옛 예약만 사라진다.
  if (replacesPostId && !publish) {
    return fail(400, 'BAD_REQUEST', '글 고치기는 예약과 함께만 저장할 수 있어요. 화면을 새로 고쳐 주세요.');
  }
  // ★2026-09-22 글 속 링크에 실존하지 않는 도메인이 있으면 올리지 않는다 — 게시는 되고 보는 사람이
  //   눌렀을 때 안 열린다. 판정은 CT(findLinkDefectInText)가 소유하고 전 채널이 같은 문구를 쓴다.
  const snsLinkDefect = findLinkDefectInText(body, '글 속 링크는');
  if (snsLinkDefect) return fail(400, 'LINK_DEFECT', snsLinkDefect);

  let scheduledAt: Date | null = null;
  if (publish) {
    // ★ 2026-09-24 예약 시각은 CT 하나로 읽는다(S3 · /publish·시각 바꾸기와 같은 판정).
    const sched = parseSnsScheduleAt(input.publish?.scheduledAt);
    if (!sched.ok) return fail(400, sched.code, sched.error);
    scheduledAt = sched.at;
  }

  // ★ 1차-B — 채널마다 이 미디어를 받는지 **저장 전에** 판정한다(워커에서 터지지 않게 · 설계 1b §3-4).
  //   화면 칩 잠금과 같은 규칙·같은 문구다(sns-view.ts 미러 · 계약 테스트).
  const uniqueMediaIds = Array.from(new Set(mediaIds));
  const mediaRes = uniqueMediaIds.length
    ? await query(`SELECT id, kind, path, bytes FROM sns_media WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`, [companyId, uniqueMediaIds])
    : { rows: [] as any[] };
  if (mediaRes.rows.length !== uniqueMediaIds.length || uniqueMediaIds.length !== mediaIds.length) {
    return fail(400, 'MEDIA_NOT_FOUND', '올린 사진이나 영상을 찾지 못했어요. 다시 올려 주세요.');
  }
  const summary = {
    images: mediaRes.rows.filter((m: any) => m.kind !== 'video').length,
    videos: mediaRes.rows.filter((m: any) => m.kind === 'video').length,
  };
  let videoFacts: SnsVideoFacts | null = null;
  if (summary.videos === 1) {
    const v = mediaRes.rows.find((m: any) => m.kind === 'video');
    const probe = await probeSnsVideoFile(snsMediaAbsPath(v.path));
    videoFacts = { bytes: Number(v.bytes) || 0, durationSec: probe.durationSec, width: probe.width, height: probe.height, videoCodec: probe.videoCodec };
  }
  // 우리가 만든 사진이 실렸는가 → AI 표시 부착 대상(§3-9 · ★ 0924 판정 CT = sns-ai-notice)
  const aiNotice = await snsMediaNeedsAiNotice(companyId, mediaIds);

  const postId = composeId ? snsComposePostId(companyId, userId, composeId) : randomUUID();
  const want = { body, tags, mediaIds, accountIds };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (composeId) {
      const prior = await compareExisting(client, companyId, postId, want);
      if (prior) {
        await client.query('ROLLBACK');
        return prior;
      }
    }

    // 계정은 **내 회사 것만** 쓴다(불변 5). ★ 0924 — 고른 계정이 **전부** active 여야 한다(일부만 나가는 것 0) · 게시 동안 해제 못 하게 FOR SHARE.
    const accRes = await client.query(
      `SELECT id, platform, status FROM sns_accounts
        WHERE company_id = $1::uuid AND id = ANY($2::uuid[])
        FOR SHARE`,
      [companyId, accountIds],
    );
    const notActive = accountIds.filter((id) => !accRes.rows.some((a) => String(a.id) === id && a.status === 'active'));
    if (notActive.length) {
      await client.query('ROLLBACK');
      return fail(409, SNS_ERROR_CODES.ACCOUNT_STATE_CHANGED, '고른 채널 중 연결이 바뀐 곳이 있어요. 채널을 다시 확인해 주세요.', { accountIds: notActive });
    }
    const accounts = accountIds.map((id) => accRes.rows.find((a) => String(a.id) === id)!);

    const blocked: Array<{ platform: string; reason: string }> = [];
    for (const acc of accounts) {
      const adapter = getSnsAdapter(acc.platform);
      if (!adapter) { blocked.push({ platform: acc.platform, reason: '알 수 없는 채널입니다.' }); continue; }
      const open = snsChannelAvailable(adapter, companyId);
      if (!open.ok) { blocked.push({ platform: adapter.label, reason: '지금은 이 채널에 올릴 수 없어요.' }); continue; }
      const reason = snsMediaBlockReason(summary, adapter.capabilities);
      if (reason) { blocked.push({ platform: adapter.label, reason }); continue; }
      if (videoFacts) {
        const fit = planSnsVideoFit(videoFacts, adapter.capabilities.video);
        if (!fit.accepted) blocked.push({ platform: adapter.label, reason: fit.notice });
      }
    }
    if (blocked.length > 0) {
      await client.query('ROLLBACK');
      return fail(400, 'MEDIA_NOT_ACCEPTED', blocked.map((b) => `${b.platform}: ${b.reason}`).join(' '), { blocked });
    }

    // 채널마다 확정본(§2-9 "워커는 그 컬럼만 읽는다")
    const built: Array<{ acc: any; caption: SnsCaptionResult }> = accounts.map((acc) => ({
      acc,
      caption: buildSnsCaption({ body, tags, aiNotice }, getSnsAdapter(acc.platform)!.capabilities),
    }));
    if (publish) {
      const bad = built.filter((b) => !b.caption.ok);
      if (bad.length) {
        await client.query('ROLLBACK');
        const placeholder = bad.some((b) => b.caption.placeholderLeft);
        return fail(400, 'CAPTION_NOT_OK', placeholder
          ? '글에 채워야 할 자리가 남아 있어요. [ ] 안을 직접 고쳐 주세요.'
          : '글이 채널 상한을 넘는 곳이 있어요. 채널별 글을 보고 줄여 주세요.', {
          captions: bad.map((b) => ({ accountId: String(b.acc.id), platform: b.acc.platform, overBy: b.caption.overBy, placeholderLeft: b.caption.placeholderLeft })),
        });
      }
    }

    // 화면이 보여 준 확정본과 서버 확정본 대조(§8) — 다르면 서버 확정본을 돌려주고 멈춘다.
    if (input.expected && typeof input.expected === 'object') {
      const expected = input.expected as Record<string, unknown>;
      const serverCaptions = Object.fromEntries(built.map((b) => [String(b.acc.id), b.caption.text]));
      if (!sameSet(Object.keys(expected), accountIds)) {
        await client.query('ROLLBACK');
        return fail(409, SNS_ERROR_CODES.ACCOUNT_STATE_CHANGED, '올릴 채널이 바뀌었어요. 채널을 다시 확인해 주세요.', { captions: serverCaptions });
      }
      if (built.some((b) => String(expected[String(b.acc.id)] ?? '') !== b.caption.text)) {
        await client.query('ROLLBACK');
        return fail(409, 'CAPTION_CHANGED', '올라갈 글이 화면과 달라요. 바뀐 글을 확인하고 다시 눌러 주세요.', { captions: serverCaptions });
      }
    }

    // 글 고치기(E6) — 옛 글의 계정별 최신 행이 전부 예약 중일 때만 바꾼다. 사진·채널은 그대로여야 한다.
    if (replacesPostId) {
      const old = await client.query(`SELECT media_ids FROM sns_posts WHERE id = $1::uuid AND company_id = $2::uuid`, [replacesPostId, companyId]);
      const locked = await client.query(
        `SELECT id, account_id, status, created_at FROM sns_post_targets
          WHERE post_id = $1::uuid AND company_id = $2::uuid
          ORDER BY created_at, id
          FOR UPDATE`,
        [replacesPostId, companyId],
      );
      const latest = new Map<string, any>();
      for (const row of locked.rows) latest.set(String(row.account_id), row); // 정렬 순서 = 나중 행이 덮는다
      const rows = [...latest.values()];
      if (!old.rows[0] || rows.length === 0 || rows.some((r) => r.status !== 'scheduled')) {
        await client.query('ROLLBACK');
        return fail(409, 'REPLACE_TARGET_GONE', '고치던 예약이 이미 올라가기 시작했거나 취소됐어요. 이 글은 새 글로 올릴 수 있어요.');
      }
      if (!sameList((old.rows[0].media_ids ?? []).map(String), mediaIds) || !sameSet(rows.map((r) => String(r.account_id)), accountIds)) {
        await client.query('ROLLBACK');
        return fail(400, 'REPLACE_MISMATCH', '글 고치기에서는 사진과 채널을 바꿀 수 없어요. 새 글로 올려 주세요.');
      }
      const upd = await client.query(
        `UPDATE sns_post_targets
            SET status = 'cancelled', last_error_code = $3, last_error = '고친 글로 바뀌었어요.', updated_at = NOW()
          WHERE company_id = $2::uuid AND id = ANY($1::uuid[]) AND status = 'scheduled'`,
        [rows.map((r) => r.id), companyId, SNS_ERROR_CODES.REPLACED],
      );
      if (Number(upd.rowCount || 0) !== rows.length) {
        await client.query('ROLLBACK');
        return fail(409, 'REPLACE_TARGET_GONE', '고치던 예약이 이미 올라가기 시작했거나 취소됐어요. 이 글은 새 글로 올릴 수 있어요.');
      }
      await client.query(`UPDATE sns_posts SET status = 'cancelled', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`, [replacesPostId, companyId]);
    }

    // ★ 2026-09-24 게시물의 예약 시각은 **사용자가 고른 시각만** 적는다 — 지금 올리기는 NULL(S7).
    const ins = await client.query(
      `INSERT INTO sns_posts (id, company_id, body, tags, media_ids, status, created_by, scheduled_at)
       VALUES ($1::uuid, $2::uuid, $3, $4::text[], $5::uuid[], $6, $7::uuid, $8)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [postId, companyId, body, tags, mediaIds, publish ? 'scheduled' : 'draft', userId, publish ? scheduledAt : null],
    );
    if (!ins.rows[0]) {
      // 같은 composeId 가 동시에 들어와 먼저 들어간 쪽이 있다 — 그 글과 대조한다.
      await client.query('ROLLBACK');
      return (await compareExisting({ query: (s, p) => query(s, p) as any }, companyId, postId, want))
        ?? fail(409, 'COMPOSE_ALREADY_SAVED', '이 글은 이미 저장됐어요. 목록을 새로 고쳐 주세요.', { postId });
    }

    // ★ 1차-B — 영상은 채널 중립 값 'video'. 인스타는 어댑터가 릴스로 보낸다.
    const format = summary.videos > 0 ? 'video' : mediaIds.length > 1 ? 'carousel' : mediaIds.length === 1 ? 'feed' : 'text';
    const when = publish ? (scheduledAt ?? new Date()) : null;
    const targets: SnsComposeTarget[] = [];
    for (const { acc, caption } of built) {
      const targetId = composeId ? snsComposeTargetId(postId, String(acc.id)) : randomUUID();
      const idem = buildSnsIdempotencyKey(companyId, targetId, { caption: caption.text, mediaIds, format });
      await client.query(
        `INSERT INTO sns_post_targets
           (id, post_id, company_id, account_id, platform, format, caption, status, scheduled_at, idempotency_key)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10)`,
        [targetId, postId, companyId, acc.id, acc.platform, format, caption.text, publish ? 'scheduled' : 'draft', when, idem],
      );
      targets.push({
        targetId, accountId: String(acc.id), platform: acc.platform,
        ok: caption.ok, overBy: caption.overBy, droppedTags: caption.droppedTags, caption: caption.text,
      });
    }

    await client.query('COMMIT');
    return {
      ok: true,
      existing: false,
      postId,
      published: publish,
      scheduledAt: when ? when.toISOString() : null,
      targets,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type SnsRescheduleResult =
  | { ok: true; scheduledAt: string; moved: number }
  | { ok: false; status: number; code: string; error: string };

/**
 * ★ 2026-09-24 E4 예약 시각 바꾸기. 계정별 최신 행이 **전부 예약 중**일 때만 바꾼다.
 *   잠금은 NOWAIT — 워커가 잡고 있으면(=올리는 중) 기다리지 않고 409(55P03).
 *   컨테이너·다음 시도 시각을 비운다(옛 시각에 만든 컨테이너를 새 시각에 쓰지 않게).
 */
export async function rescheduleSnsPost(companyId: string, postId: string, rawAt: unknown): Promise<SnsRescheduleResult> {
  const sched = parseSnsScheduleAt(rawAt);
  if (!sched.ok) return { ok: false, status: 400, code: sched.code, error: sched.error };
  if (!sched.at) return { ok: false, status: 400, code: 'SCHEDULE_REQUIRED', error: '바꿀 시각을 골라 주세요.' };
  const at = sched.at;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let locked;
    try {
      locked = await client.query(
        `SELECT id, account_id, status FROM sns_post_targets
          WHERE post_id = $1::uuid AND company_id = $2::uuid
          ORDER BY created_at, id
          FOR UPDATE NOWAIT`,
        [postId, companyId],
      );
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err?.code === '55P03') return { ok: false, status: 409, code: 'BUSY', error: '지금 올라가는 중이라 시각을 바꿀 수 없어요. 잠시 뒤 목록을 확인해 주세요.' };
      throw err;
    }
    const latest = new Map<string, any>();
    for (const row of locked.rows) latest.set(String(row.account_id), row);
    const rows = [...latest.values()];
    if (rows.length === 0 || rows.some((r) => r.status !== 'scheduled')) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, code: 'NOT_RESCHEDULABLE', error: '이미 올라갔거나 취소된 채널이 있어 시각을 바꿀 수 없어요. 목록을 새로 고쳐 주세요.' };
    }
    const upd = await client.query(
      `UPDATE sns_post_targets
          SET scheduled_at = $3, next_attempt_at = NULL, container_id = NULL, updated_at = NOW()
        WHERE company_id = $2::uuid AND id = ANY($1::uuid[]) AND status = 'scheduled'`,
      [rows.map((r) => r.id), companyId, at],
    );
    if (Number(upd.rowCount || 0) !== rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, code: 'NOT_RESCHEDULABLE', error: '이미 올라갔거나 취소된 채널이 있어 시각을 바꿀 수 없어요. 목록을 새로 고쳐 주세요.' };
    }
    await client.query(`UPDATE sns_posts SET scheduled_at = $3, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`, [postId, companyId, at]);
    await client.query('COMMIT');
    return { ok: true, scheduledAt: at.toISOString(), moved: rows.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
