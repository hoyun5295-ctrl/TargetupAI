/**
 * sns/facebook-page.ts — 페이스북 페이지 어댑터 (Facebook Login · 2026-09-23 1차-B)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-3 · docs/2026-09-23-sns-1b-design.md §2 · §3-7 · §3-8.
 *
 * ⚠ **전 경로가 공식 문서 기준이다(2026-09-23 열람 · raw 전).** 실측(설계 1b §8-4)에서 다르면 해당 블록만 고친다.
 *   - 로그인 창 `https://www.facebook.com/v{N}/dialog/oauth` · code 교환 `GET /oauth/access_token`
 *   - 장기 교환 `grant_type=fb_exchange_token`(약 60일) → `/me/accounts` 의 **페이지 토큰은 만료일이 없다**
 *   - 글 `POST /{page}/feed message` · 사진 `POST /{page}/photos url caption` → `{id, post_id}`
 *   - 여러 장 = 사진마다 `published=false` → `/feed` + `attached_media=[{media_fbid}]`
 *   - 영상 `POST /{page}/videos file_url description` · **사진과 영상은 한 글에 섞을 수 없다**
 *   - 글 주소 `permalink_url`
 *
 * ★ **로그인 1회 = 계정 N개**(페이지마다 한 행). 그래서 `fetchAccounts` 를 선언한다.
 *   권한 회수 콜백은 로그인한 **사람의 id** 를 주므로 `deauthKey: 'owner'`(계정 행 `meta.profile.owner_user_id`).
 * ★ **실제 게시는 `publish` 안에서만 한다.** 페이스북에는 인스타식 컨테이너가 없다 — `createPost` 에서 무언가를
 *   올리면 게시 직전 소유권 재확인(이중 게시 3겹의 마지막 겹)보다 먼저 외부에 흔적이 생긴다.
 */

import {
  registerSnsAdapter, readSnsJson, SnsAdapterError,
  type ISnsPublishAdapter, type SnsOAuthCreds, type SnsTokenResult, type SnsAccountProfile,
  type SnsPublishRequest, type SnsContainerResult, type SnsContainerStatus, type SnsFetchedPost,
  type SnsConnectableAccount,
} from './adapter';

/** Graph 버전 — 레퍼런스 표기(v26.0). ⚠ 로그인 예시는 v25.0 으로 적혀 있다(설계 1b §9 ③). */
const VERSION = 'v26.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;
/** 영상 게시 도메인(영상 가이드 원문 = graph-video.facebook.com) */
const GRAPH_VIDEO = `https://graph-video.facebook.com/${VERSION}`;
const DIALOG = `https://www.facebook.com/${VERSION}/dialog/oauth`;

/** 영상 가이드가 적은 3개. `publish_video` 는 게시 가이드에만 있다 — 영상이 거부되면 그때 추가(설계 1b §9 ②). */
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'] as const;

/** 이 페이지에 글을 쓸 수 있는 역할인가 — `/me/accounts` 의 `tasks` 로 판정한다. */
const WRITE_TASKS = new Set(['CREATE_CONTENT', 'MANAGE']);

/** 컨테이너가 없는 채널의 자리표시. `container_id` 가 있어야 워커의 재시도 증거 규칙이 그대로 돈다. */
const DIRECT = 'direct';

function expiresAtFrom(expiresIn: unknown): Date | null {
  const sec = Number(expiresIn);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return new Date(Date.now() + sec * 1000);
}

async function postForm(url: string, params: Record<string, string>, step: string): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return readSnsJson('facebook_page', res, step);
}

function absolutePermalink(v: unknown): string | null {
  const s = typeof v === 'string' ? v : '';
  if (!s) return null;
  return s.startsWith('http') ? s : `https://www.facebook.com${s.startsWith('/') ? '' : '/'}${s}`;
}

export const facebookPageAdapter: ISnsPublishAdapter = {
  platform: 'facebook_page',
  label: '페이스북 페이지',
  available: true,
  scopes: SCOPES,
  deauthKey: 'owner',
  capabilities: {
    publishImage: true,
    publishVideo: true,
    publishCarousel: true,       // 여러 장 = attached_media
    publishStory: false,
    asyncContainer: false,
    maxCaptionChars: 5000,       // ⚠ 미검증(1차 스켈레톤 값 유지)
    maxTags: 30,
    dailyLimit: 50,              // ⚠ 미검증 — 우리 원장 상한으로만 쓴다
    requiresExplicitConsent: false,
    metered: false,
    verify: 'immediate',
    ephemeral: false,
    mediaTransfer: 'pull_url',
    // ⚠ 미검증 — 페이스북은 비율 제약을 문서에 적지 않는다. 넓게 둔다(원본 무접촉 우선).
    imageAspectMin: 0.4,
    imageAspectMax: 2.5,
    imageMaxWidth: 2048,
    imageMaxBytes: 10 * 1024 * 1024,
    publishText: true,
    maxMediaCount: 10,           // ⚠ 미검증
    // ⚠ 영상 상한은 문서에 없다(설계 1b §9 ④). 모르는 값으로 막지 않는다(불변 22) — 넓게 두고 채널 판단에 맡긴다.
    video: {
      maxBytes: 1024 * 1024 * 1024,
      minSec: 1,
      maxSec: 4 * 60 * 60,
      aspectMin: 0.01,
      aspectMax: 100,
      maxWidth: null,
      codecs: null,
    },
    pollIntervalSec: 60,
    tokenRefresh: 'none',        // 장기 사용자 토큰에서 받은 페이지 토큰은 만료일이 없다(원문)
    captionCounting: 'chars',
  },

  buildAuthorizeUrl(creds: SnsOAuthCreds, state: string): string {
    const q = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      state,
      response_type: 'code',
      scope: SCOPES.join(','),
    });
    return `${DIALOG}?${q.toString()}`;
  },

  async exchangeToken(creds: SnsOAuthCreds, code: string): Promise<SnsTokenResult> {
    // ① code → 단기 사용자 토큰
    const q1 = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      client_secret: creds.clientSecret,
      code,
    });
    const shortBody = await readSnsJson('facebook_page', await fetch(`${GRAPH}/oauth/access_token?${q1.toString()}`), 'token');
    const shortToken = String(shortBody?.access_token || '');
    if (!shortToken) throw new SnsAdapterError('facebook_page', 'token:empty', '토큰 응답에 access_token 이 없습니다.', null, shortBody);

    // ② 단기 → 장기 사용자 토큰. 페이지 토큰을 장기로 받으려면 이 단계가 먼저다(원문).
    const q2 = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      fb_exchange_token: shortToken,
    });
    const longBody = await readSnsJson('facebook_page', await fetch(`${GRAPH}/oauth/access_token?${q2.toString()}`), 'exchange');
    const longToken = String(longBody?.access_token || '');
    return {
      accessToken: longToken || shortToken,
      refreshToken: null,
      expiresAt: expiresAtFrom(longBody?.expires_in),
      scope: SCOPES.join(','),
    };
  },

  /** 로그인 1회 → 페이지 N개. 페이지마다 자기 토큰(만료 없음)을 가진 계정 한 행이 된다. */
  async fetchAccounts(userToken: string): Promise<SnsConnectableAccount[]> {
    const me = await readSnsJson('facebook_page',
      await fetch(`${GRAPH}/me?${new URLSearchParams({ fields: 'id', access_token: userToken }).toString()}`), 'me');
    const ownerUserId = String(me?.id || '');

    const q = new URLSearchParams({
      fields: 'id,name,access_token,tasks,picture{url}',
      limit: '100',
      access_token: userToken,
    });
    const body = await readSnsJson('facebook_page', await fetch(`${GRAPH}/me/accounts?${q.toString()}`), 'accounts');
    const pages: any[] = Array.isArray(body?.data) ? body.data : [];

    return pages
      .filter((p) => p?.id && p?.access_token)
      .map((p) => {
        const tasks: string[] = Array.isArray(p.tasks) ? p.tasks.map(String) : [];
        const eligible = tasks.length === 0 || tasks.some((t) => WRITE_TASKS.has(t));
        const profile: SnsAccountProfile = {
          externalAccountId: String(p.id),
          username: null,
          displayName: p.name ? String(p.name) : null,
          avatarUrl: p?.picture?.data?.url ? String(p.picture.data.url) : null,
          eligible,
          ineligibleReason: eligible ? null : '이 페이지에 글을 쓸 권한이 없어요. 페이지 관리자 계정으로 다시 연결해 주세요.',
          raw: { tasks, owner_user_id: ownerUserId },
        };
        return {
          profile,
          token: { accessToken: String(p.access_token), refreshToken: null, expiresAt: null, scope: SCOPES.join(',') },
        };
      });
  },

  /** 페이지 토큰으로 자기 자신을 다시 묻는다(연결 확인용). */
  async fetchAccount(pageToken: string): Promise<SnsAccountProfile> {
    const q = new URLSearchParams({ fields: 'id,name,picture{url}', access_token: pageToken });
    const body = await readSnsJson('facebook_page', await fetch(`${GRAPH}/me?${q.toString()}`), 'me');
    const id = String(body?.id || '');
    if (!id) throw new SnsAdapterError('facebook_page', 'me:empty', '페이지 조회 응답에 id 가 없습니다.', null, body);
    return {
      externalAccountId: id,
      username: null,
      displayName: body?.name ? String(body.name) : null,
      avatarUrl: body?.picture?.data?.url ? String(body.picture.data.url) : null,
      eligible: true,
      ineligibleReason: null,
      raw: {},
    };
  },

  async refreshToken(): Promise<SnsTokenResult | null> {
    return null;   // 페이지 토큰은 만료일이 없다 — 토큰 워커가 건너뛴다
  },

  // ───────────────────────── 게시 (⚠ 전부 문서 기준 · raw 전) ─────────────────────────

  async createPost(): Promise<SnsContainerResult> {
    // 페이스북에는 컨테이너가 없다. 실제 게시는 publish 에서만(파일 머리 주석).
    return { containerId: DIRECT, ready: true };
  },

  async pollContainer(): Promise<SnsContainerStatus> {
    return { raw: 'DIRECT', ready: true, failed: false };
  },

  async publish(req: SnsPublishRequest): Promise<{ platformPostId: string }> {
    const page = req.externalAccountId;
    const token = req.accessToken;
    const videos = req.media.filter((m) => m.kind === 'video');

    if (videos.length > 0) {
      if (req.media.length !== 1) {
        throw new SnsAdapterError('facebook_page', 'media:mixed', '영상은 한 개만, 사진과 섞지 않고 올릴 수 있어요.');
      }
      const body = await postForm(`${GRAPH_VIDEO}/${page}/videos`,
        { file_url: videos[0].url, description: req.caption, access_token: token }, 'video');
      const id = String(body?.id || body?.video_id || '');
      if (!id) throw new SnsAdapterError('facebook_page', 'video:empty', '영상 게시 응답에 id 가 없습니다.', null, body);
      return { platformPostId: id };
    }

    if (req.media.length === 0) {
      const body = await postForm(`${GRAPH}/${page}/feed`, { message: req.caption, access_token: token }, 'feed');
      const id = String(body?.id || '');
      if (!id) throw new SnsAdapterError('facebook_page', 'feed:empty', '게시 응답에 id 가 없습니다.', null, body);
      return { platformPostId: id };
    }

    if (req.media.length === 1) {
      const body = await postForm(`${GRAPH}/${page}/photos`,
        { url: req.media[0].url, caption: req.caption, access_token: token }, 'photo');
      const id = String(body?.post_id || body?.id || '');
      if (!id) throw new SnsAdapterError('facebook_page', 'photo:empty', '사진 게시 응답에 id 가 없습니다.', null, body);
      return { platformPostId: id };
    }

    // 여러 장 — 사진마다 게시하지 않은 채 올리고(published=false) 한 글에 묶는다.
    const params: Record<string, string> = { message: req.caption, access_token: token };
    let i = 0;
    for (const m of req.media) {
      const up = await postForm(`${GRAPH}/${page}/photos`, { url: m.url, published: 'false', access_token: token }, 'photo-unpublished');
      const fbid = String(up?.id || '');
      if (!fbid) throw new SnsAdapterError('facebook_page', 'photo-unpublished:empty', '사진 업로드 응답에 id 가 없습니다.', null, up);
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: fbid });
      i += 1;
    }
    const body = await postForm(`${GRAPH}/${page}/feed`, params, 'feed-multi');
    const id = String(body?.id || '');
    if (!id) throw new SnsAdapterError('facebook_page', 'feed-multi:empty', '게시 응답에 id 가 없습니다.', null, body);
    return { platformPostId: id };
  },

  /**
   * 재조회. 영상은 처리 중에는 없는 것으로 본다(`status.video_status` 가 ready 여야 게시됨).
   * 대조 워커가 다음 tick 에 다시 본다.
   */
  async fetchPost(req: SnsPublishRequest, platformPostId: string): Promise<SnsFetchedPost> {
    const isVideo = req.format === 'video';
    const q = new URLSearchParams({
      fields: isVideo ? 'id,permalink_url,status' : 'id,permalink_url',
      access_token: req.accessToken,
    });
    const res = await fetch(`${GRAPH}/${platformPostId}?${q.toString()}`);
    if (res.status === 404 || res.status === 400) return { exists: false, permalink: null };
    const body = await readSnsJson('facebook_page', res, 'fetch');
    if (!body?.id) return { exists: false, permalink: null };
    if (isVideo) {
      const vs = String(body?.status?.video_status || '');
      if (vs && vs !== 'ready') return { exists: false, permalink: null, raw: { video_status: vs } };
    }
    return { exists: true, permalink: absolutePermalink(body?.permalink_url) };
  },
};

registerSnsAdapter(facebookPageAdapter);
