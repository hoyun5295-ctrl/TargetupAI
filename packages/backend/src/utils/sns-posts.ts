/**
 * sns-posts.ts — SNS 게시물 목록 · 작성 기본값 컨트롤타워 (2026-09-24)
 * 설계 SoT = docs/2026-09-24-sns-channel-design.md §2 S6 · §6 D1 · E1~E3.
 *
 * 이 파일이 소유하는 것
 *   - 기록 화면 목록(`listSnsPostsView`) — 예약 묶음과 기록 묶음을 서버가 가른다
 *   - 묶음 상태 = **계정별 최신 행으로 읽을 때 파생**(S6). `sns_posts.status` 를 읽는 곳은 여기 한 곳이다.
 *     다시 시도가 성공해도 옛 failed 행 때문에 '일부 실패'로 남던 결함(K12)을 여기서 닫는다.
 *   - 작성 기본값(`snsComposeDefaults`) — 지난번에 올린 채널(D1)
 *
 * ⛔ 전 조회에 `company_id` 조건을 직접 준다(불변 5).
 */

import { query } from '../config/database';
import { derivePostStatus, type SnsTargetStatus } from './sns-constants';
import { snsLatestTargetSql, snsFailureAction, type SnsFailureAction } from './sns-retry';
import { getSnsAdapter } from './sns';
import { snsChannelAvailable } from './sns-availability';
import { snsChannelUrl } from './sns-accounts';

/** 예약 묶음 상한 — 예약이 기록 50건에 묻히지 않게 따로 싣는다. */
export const SNS_UPCOMING_LIMIT = 200;
/** 기록 한 페이지 글 수 — ★ 2026-09-25 카드 5 × 2(Harold 0925 목업 승인) · 전에는 최근 50개에서 끊겨 오래된 글을 못 봤다 */
export const SNS_HISTORY_PAGE_SIZE = 10;
/** 페이지 번호 상한(주소 조작으로 큰 OFFSET 을 만들지 않게) */
export const SNS_HISTORY_MAX_PAGE = 1000;

export interface SnsTargetViewRow {
  targetId: string;
  platform: string;
  accountId: string;
  accountUsername: string | null;
  accountDisplayName: string | null;
  accountStatus: string | null;
  status: string;
  permalink: string | null;
  verifiedAt: string | null;
  deletedOnPlatformAt: string | null;
  verifyGaveUpAt: string | null;
  platformPostId: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  scheduledAt: string | null;
  /** 이 채널에 실제로 올라간(올라갈) 확정본 — 본문 + 태그 + AI 표시 */
  caption: string;
  /** 같은 게시물·계정에 나중 행이 있다(다시 시도로 대체됨) — 버튼 0 · 흐리게 */
  superseded: boolean;
  /** 사용자가 할 수 있는 일 — 화면 버튼 이름이 이 값으로 정해진다 */
  action: SnsFailureAction;
  /** [채널에서 확인] 주소 — permalink 우선 · 없으면 계정 프로필 · 둘 다 없으면 null */
  checkUrl: string | null;
}

export interface SnsPostViewRow {
  id: string;
  body: string;
  tags: string[];
  /** 파생 상태(계정별 최신 행) */
  status: string;
  /** 사용자가 고른 예약 시각 — 지금 올리기는 null(S7) */
  scheduled_at: string | null;
  created_at: string;
  media_ids: string[];
  /** ★ 0925 미디어 종류(카드 표지 · 사진이면 썸네일 · 영상이면 재생 표시) — media_ids 순서 */
  media: Array<{ id: string; kind: string }>;
  /** 다음에 올라갈 시각(최신 행 중 예약된 것의 가장 이른 시각) — 예약 목록 정렬·표시 */
  nextAt: string | null;
  targets: SnsTargetViewRow[];
}

const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);

async function loadPosts(companyId: string, ids: string[], now: number): Promise<SnsPostViewRow[]> {
  if (ids.length === 0) return [];
  const posts = await query(
    `SELECT id, body, tags, scheduled_at, created_at, media_ids FROM sns_posts
      WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
    [companyId, ids],
  );
  const targets = await query(
    `SELECT t.id, t.post_id, t.platform, t.account_id, t.status, t.permalink, t.verified_at,
            t.deleted_on_platform_at, t.verify_gave_up_at, t.platform_post_id, t.last_error, t.last_error_code,
            t.scheduled_at, t.caption, t.created_at,
            NOT ${snsLatestTargetSql('t')} AS superseded,
            a.username AS account_username, a.display_name AS account_display_name, a.status AS account_status,
            a.external_account_id AS account_external_id
       FROM sns_post_targets t
       LEFT JOIN sns_accounts a ON a.id = t.account_id AND a.company_id = t.company_id
      WHERE t.company_id = $1::uuid AND t.post_id = ANY($2::uuid[])
      ORDER BY t.platform, t.created_at, t.id`,
    [companyId, ids],
  );
  const allMediaIds = Array.from(new Set(posts.rows.flatMap((p) => (Array.isArray(p.media_ids) ? p.media_ids.map(String) : []))));
  const kinds = allMediaIds.length
    ? await query(`SELECT id, kind FROM sns_media WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`, [companyId, allMediaIds])
    : { rows: [] as any[] };
  const kindOf = new Map(kinds.rows.map((m: any) => [String(m.id), String(m.kind)]));
  const byPost = new Map<string, any[]>();
  for (const t of targets.rows) {
    const list = byPost.get(t.post_id) ?? [];
    list.push(t);
    byPost.set(t.post_id, list);
  }
  const out = new Map<string, SnsPostViewRow>();
  for (const p of posts.rows) {
    const rows = byPost.get(p.id) ?? [];
    const immediate = !p.scheduled_at;
    const latest = rows.filter((t) => !t.superseded);
    // 지금 올리기는 워커가 잡기 전 몇십 초 동안 scheduled 다 — '예약됨'이 아니라 '올리는 중'으로 본다(M1).
    const statuses = latest.map((t) => (immediate && t.status === 'scheduled' ? 'claimed' : t.status) as SnsTargetStatus);
    const scheduledLatest = latest.filter((t) => t.status === 'scheduled' && t.scheduled_at);
    const nextAt = scheduledLatest.length
      ? new Date(Math.min(...scheduledLatest.map((t) => new Date(t.scheduled_at).getTime()))).toISOString()
      : null;
    out.set(p.id, {
      id: p.id,
      body: p.body ?? '',
      tags: Array.isArray(p.tags) ? p.tags : [],
      status: derivePostStatus(statuses),
      scheduled_at: iso(p.scheduled_at),
      created_at: iso(p.created_at) as string,
      media_ids: Array.isArray(p.media_ids) ? p.media_ids : [],
      media: (Array.isArray(p.media_ids) ? p.media_ids.map(String) : []).map((id: string) => ({ id, kind: kindOf.get(id) ?? 'image' })),
      nextAt,
      targets: rows.map((t) => {
        const superseded = !!t.superseded;
        return {
          targetId: t.id,
          platform: t.platform,
          accountId: t.account_id,
          accountUsername: t.account_username ?? null,
          accountDisplayName: t.account_display_name ?? null,
          accountStatus: t.account_status ?? null,
          status: t.status,
          permalink: t.permalink ?? null,
          verifiedAt: iso(t.verified_at),
          deletedOnPlatformAt: iso(t.deleted_on_platform_at),
          verifyGaveUpAt: iso(t.verify_gave_up_at),
          platformPostId: t.platform_post_id ?? null,
          lastError: t.last_error ?? null,
          lastErrorCode: t.last_error_code ?? null,
          scheduledAt: iso(t.scheduled_at),
          caption: String(t.caption ?? ''),
          superseded,
          action: snsFailureAction({
            status: t.status,
            platformPostId: t.platform_post_id ?? null,
            lastErrorCode: t.last_error_code ?? null,
            verifyGaveUpAt: t.verify_gave_up_at ?? null,
            scheduledAt: t.scheduled_at ?? null,
            superseded,
            accountActive: t.account_status === 'active',
          }, now),
          checkUrl: t.permalink || snsChannelUrl(t.platform, t.account_username ?? null, t.account_external_id ?? null),
        };
      }),
    });
  }
  return ids.map((id) => out.get(id)).filter((p): p is SnsPostViewRow => !!p);
}

/**
 * 기록 화면 목록 — `{ upcoming, posts, page, pageSize, total }`.
 *   upcoming = 최신 행 중 예약(scheduled)이 있고 사용자가 시각을 고른 글 · 다음 시각 오름차순 · 페이지 밖(예약은 늘 전부)
 *   posts    = 그 밖의 글(여집합) · ★0925 한 페이지 10개 · 채널 줄이 전부 초안인 글과 글 고치기로 통째 대체된 글은 뺀다
 * ⛔ 같은 글이 두 배열에 동시에 나오지 않는다(계약 테스트).
 */
export async function listSnsPostsView(companyId: string, now: number = Date.now(), page = 1): Promise<{
  upcoming: SnsPostViewRow[];
  posts: SnsPostViewRow[];
  page: number;
  pageSize: number;
  total: number;
}> {
  const up = await query(
    `SELECT p.id,
            (SELECT MIN(t.scheduled_at) FROM sns_post_targets t
              WHERE t.post_id = p.id AND t.status = 'scheduled' AND ${snsLatestTargetSql('t')}) AS next_at
       FROM sns_posts p
      WHERE p.company_id = $1::uuid
        AND p.scheduled_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM sns_post_targets t
                     WHERE t.post_id = p.id AND t.company_id = p.company_id
                       AND t.status = 'scheduled' AND ${snsLatestTargetSql('t')})
      ORDER BY next_at ASC NULLS LAST, p.created_at ASC
      LIMIT ${SNS_UPCOMING_LIMIT}`,
    [companyId],
  );
  const upcomingIds: string[] = up.rows.map((r) => r.id);

  // 기록 조건 하나를 목록·개수가 같이 쓴다(둘이 갈리면 마지막 페이지가 비거나 넘친다)
  const historyWhere = `p.company_id = $1::uuid
        AND NOT (p.id = ANY($2::uuid[]))
        AND EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.company_id = p.company_id AND t.status <> 'draft')
        AND EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.company_id = p.company_id
                     -- ⛔ COALESCE — 코드가 NULL 인 취소 행에서 비교가 NULL 이 되면 사용자가 취소한 글이 목록에서 사라진다
                     AND NOT (t.status = 'cancelled' AND COALESCE(t.last_error_code, '') = 'REPLACED'))`;
  const safePage = Math.min(SNS_HISTORY_MAX_PAGE, Math.max(1, Math.floor(Number(page) || 1)));
  const count = await query(`SELECT COUNT(*)::int AS n FROM sns_posts p WHERE ${historyWhere}`, [companyId, upcomingIds]);
  const total = Number(count.rows[0]?.n || 0);
  const hist = await query(
    `SELECT p.id FROM sns_posts p
      WHERE ${historyWhere}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${SNS_HISTORY_PAGE_SIZE} OFFSET $3`,
    [companyId, upcomingIds, (safePage - 1) * SNS_HISTORY_PAGE_SIZE],
  );
  const historyIds: string[] = hist.rows.map((r) => r.id);

  return {
    upcoming: await loadPosts(companyId, upcomingIds, now),
    posts: await loadPosts(companyId, historyIds, now),
    page: safePage,
    pageSize: SNS_HISTORY_PAGE_SIZE,
    total,
  };
}

/** 특정 글들을 목록 모양으로(띠 [보기]가 가리키는 글이 목록 밖일 때 덧붙이기용). */
export async function loadSnsPostsByIds(companyId: string, ids: string[], now: number = Date.now()): Promise<SnsPostViewRow[]> {
  return loadPosts(companyId, ids, now);
}

/**
 * 작성 기본값 — **지난번에 올린 채널**(D1). 저장하지 않고 원장에서 파생한다.
 *   원천 = 이 사용자의 가장 최근 글(채널 줄이 전부 초안이거나 전부 취소인 글은 제외 · 상태는 채널 줄로 판정)
 *   거르기 = 지금 active ∩ 이 회사에 열린 채널 ∩ 실비 채널(X) 제외(건당 비용이라 자동으로 켜지 않는다)
 *   기록이 없고 고를 수 있는 계정이 정확히 1개면 그 계정(L2)
 */
export async function snsComposeDefaults(companyId: string, userId: string | null): Promise<{
  accountIds: string[];
  /** 지난 글에서 골랐지만 지금은 뺀 계정과 이유(화면 사유 줄) */
  dropped: Array<{ accountId: string; reason: 'disconnected' | 'metered' | 'closed' }>;
  source: 'last_post' | 'only_account' | 'none';
}> {
  const accounts = await query(
    `SELECT id, platform, status FROM sns_accounts WHERE company_id = $1::uuid AND status <> 'revoked'`,
    [companyId],
  );
  const usable = new Map<string, { platform: string; ok: boolean; metered: boolean }>();
  for (const a of accounts.rows) {
    const adapter = getSnsAdapter(a.platform);
    const open = adapter ? snsChannelAvailable(adapter, companyId).ok : false;
    usable.set(a.id, { platform: a.platform, ok: a.status === 'active' && open, metered: !!adapter?.capabilities.metered });
  }

  let lastIds: string[] = [];
  if (userId) {
    const last = await query(
      `SELECT ARRAY(SELECT DISTINCT t.account_id FROM sns_post_targets t WHERE t.post_id = p.id AND t.company_id = p.company_id) AS account_ids
         FROM sns_posts p
        WHERE p.company_id = $1::uuid AND p.created_by = $2::uuid
          AND EXISTS (SELECT 1 FROM sns_post_targets t WHERE t.post_id = p.id AND t.company_id = p.company_id
                       AND t.status NOT IN ('draft', 'cancelled'))
        ORDER BY p.created_at DESC
        LIMIT 1`,
      [companyId, userId],
    );
    lastIds = (last.rows[0]?.account_ids ?? []).map(String);
  }

  if (lastIds.length > 0) {
    const accountIds: string[] = [];
    const dropped: Array<{ accountId: string; reason: 'disconnected' | 'metered' | 'closed' }> = [];
    for (const id of lastIds) {
      const u = usable.get(id);
      if (!u) { dropped.push({ accountId: id, reason: 'disconnected' }); continue; }
      if (u.metered) { dropped.push({ accountId: id, reason: 'metered' }); continue; }
      if (!u.ok) {
        const acc = accounts.rows.find((a) => a.id === id);
        dropped.push({ accountId: id, reason: acc?.status === 'active' ? 'closed' : 'disconnected' });
        continue;
      }
      accountIds.push(id);
    }
    return { accountIds, dropped, source: 'last_post' };
  }

  const candidates = [...usable.entries()].filter(([, u]) => u.ok && !u.metered).map(([id]) => id);
  if (candidates.length === 1) return { accountIds: candidates, dropped: [], source: 'only_account' };
  return { accountIds: [], dropped: [], source: 'none' };
}
