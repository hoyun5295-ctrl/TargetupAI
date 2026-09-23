/**
 * sns/instagram.ts — 인스타그램 어댑터 (Instagram API with Instagram Login) · 2026-09-20 S1
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-3.
 * **상수 근거 = §1-4 S0 raw 실측(2026-09-20 · 자사 hanjul_official 게시 1건 관통).**
 *   - 베이스 `https://graph.instagram.com` (버전 세그먼트 생략 가능 — 전 호출 성공)
 *   - `/me?fields=id,username,account_type` → `account_type: "BUSINESS"`
 *   - `/refresh_access_token?grant_type=ig_refresh_token` → `expires_in` 5,182,603(≈60일) + `permissions`
 *   - 24시간 게시 한도 100(`content_publishing_limit` → `data[0].config.quota_total`)
 *
 * ⛔ 계정 ID 는 `/me` 가 주는 값이다. 앱 대시보드에 보이는 ID 와 **다르다**(§1-4). 화면값을 저장하면 게시에서 터진다.
 *
 * ★ **OAuth 왕복 3개 확정(2026-09-20 S1 게이트 · 자사 계정 연결 1건 성공).**
 *   authorize 창 주소 · code→단기 토큰 · 단기→장기 교환이 아래 상수 그대로 동작했고,
 *   `/me` 가 `profile_picture_url` 까지 함께 돌려주는 것도 화면에 붙은 프로필 사진으로 확인됐다.
 *   ⛔ 이 값들을 바꾸려면 새 실측이 있어야 한다. 문서만 보고 고치지 않는다.
 */

import {
  registerSnsAdapter, readSnsJson, SnsAdapterError,
  type ISnsPublishAdapter, type SnsOAuthCreds, type SnsTokenResult, type SnsAccountProfile,
  type SnsPublishRequest, type SnsContainerResult, type SnsContainerStatus, type SnsFetchedPost,
} from './adapter';

const GRAPH = 'https://graph.instagram.com';
const AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const TOKEN = 'https://api.instagram.com/oauth/access_token';

/** 게시에 필요한 최소 권한만. 넓게 잡으면 2차 앱 심사가 그만큼 까다로워진다. */
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'] as const;

/** 프로페셔널로 인정되는 `account_type` 값 — BUSINESS 는 §1-4 실측, MEDIA_CREATOR 는 미검증(문서 기준). */
const ELIGIBLE_ACCOUNT_TYPES = new Set(['BUSINESS', 'MEDIA_CREATOR']);

function expiresAtFrom(expiresIn: unknown): Date | null {
  const sec = Number(expiresIn);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return new Date(Date.now() + sec * 1000);
}

export const instagramAdapter: ISnsPublishAdapter = {
  platform: 'instagram',
  label: '인스타그램',
  available: true,
  scopes: SCOPES,
  capabilities: {
    publishImage: true,
    // ★ 2026-09-23 1차-B 릴스. 영상 1개는 REELS 컨테이너로 간다(아래 createPost).
    publishVideo: true,
    publishCarousel: true,
    publishStory: false,
    // 피드·캐러셀은 컨테이너가 바로 FINISHED 로 오지만(§1-4) 릴스는 처리 시간이 있다.
    asyncContainer: true,
    maxCaptionChars: 2200,
    maxTags: 30,
    dailyLimit: 100,
    requiresExplicitConsent: false,
    metered: false,
    verify: 'immediate',
    ephemeral: false,
    mediaTransfer: 'pull_url',
    // ★ §1-1 실측 = 비율 4:5 ~ 1.91:1 · 폭 320~1440 · 8MB · JPEG.
    imageAspectMin: 0.8,      // 4:5
    imageAspectMax: 1.91,     // 1.91:1
    imageMaxWidth: 1440,
    imageMaxBytes: 8 * 1024 * 1024,
    // ★ 1차-B — 공식 문서 기준(2026-09-23 열람 · raw 전 · 설계 1b §2).
    publishText: false,          // 인스타는 사진·영상 없는 글이 없다
    maxMediaCount: 10,           // 캐러셀 10장(§1-1)
    // 릴스 규격 원문 = MOV·MP4 · moov 앞 · HEVC·H264 · 가로 최대 1920 · 0.01:1~10:1 · 3초~15분 · 300MB
    video: {
      maxBytes: 300 * 1024 * 1024,
      minSec: 3,
      maxSec: 900,
      aspectMin: 0.01,
      aspectMax: 10,
      maxWidth: 1920,
      codecs: ['avc1', 'avc3', 'hvc1', 'hev1'],
    },
    pollIntervalSec: 60,         // 원문 "분당 1회 조회 권장"
    tokenRefresh: 'scheduled',
    captionCounting: 'chars',
  },

  buildAuthorizeUrl(creds: SnsOAuthCreds, state: string): string {
    const q = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      scope: SCOPES.join(','),
      response_type: 'code',
      state,
    });
    return `${AUTHORIZE}?${q.toString()}`;
  },

  async exchangeToken(creds: SnsOAuthCreds, code: string): Promise<SnsTokenResult> {
    // ① code → 단기 토큰(1시간). form-urlencoded 로만 받는다.
    const form = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: creds.redirectUri,
      code,
    });
    const shortRes = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const shortBody = await readSnsJson('instagram', shortRes, 'token');
    const shortToken = String(shortBody?.access_token || '');
    if (!shortToken) {
      throw new SnsAdapterError('instagram', 'token:empty', '토큰 응답에 access_token 이 없습니다.', null, shortBody);
    }

    // ② 단기 → 장기(60일). 여기까지 끝내야 저장할 값이 된다 — 단기 토큰을 저장하면 1시간 뒤 전부 끊긴다.
    const q = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: creds.clientSecret,
      access_token: shortToken,
    });
    const longRes = await fetch(`${GRAPH}/access_token?${q.toString()}`);
    const longBody = await readSnsJson('instagram', longRes, 'exchange');
    const longToken = String(longBody?.access_token || '');

    return {
      accessToken: longToken || shortToken,
      refreshToken: null,
      expiresAt: expiresAtFrom(longBody?.expires_in),
      scope: typeof longBody?.permissions === 'string' ? longBody.permissions : SCOPES.join(','),
    };
  },

  async fetchAccount(accessToken: string): Promise<SnsAccountProfile> {
    // ★ §1-4 실측 필드. profile_picture_url·name 은 같은 호출에 실리지만 미검증이라 없으면 null 로 떨어진다.
    const q = new URLSearchParams({
      fields: 'id,username,account_type,name,profile_picture_url',
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH}/me?${q.toString()}`);
    const body = await readSnsJson('instagram', res, 'me');

    const externalAccountId = String(body?.id || '');
    if (!externalAccountId) {
      throw new SnsAdapterError('instagram', 'me:empty', '계정 조회 응답에 id 가 없습니다.', null, body);
    }
    const accountType = String(body?.account_type || '');
    const eligible = ELIGIBLE_ACCOUNT_TYPES.has(accountType);

    return {
      externalAccountId,
      username: body?.username ? String(body.username) : null,
      displayName: body?.name ? String(body.name) : (body?.username ? String(body.username) : null),
      avatarUrl: body?.profile_picture_url ? String(body.profile_picture_url) : null,
      eligible,
      ineligibleReason: eligible
        ? null
        : '이 계정은 프로페셔널(비즈니스·크리에이터) 계정이 아니에요. 인스타그램 앱에서 계정 종류를 바꾼 뒤 다시 연결해 주세요.',
      raw: { account_type: accountType },
    };
  },

  async refreshToken(_creds: SnsOAuthCreds, accessToken: string): Promise<SnsTokenResult | null> {
    // ★ §1-4 실측 — 발급 직후 호출에도 거부가 없었고 `expires_in`·`permissions` 를 함께 돌려준다.
    //   그래서 이 경로가 갱신이면서 동시에 "남은 시간 조회"를 겸한다.
    const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: accessToken });
    const res = await fetch(`${GRAPH}/refresh_access_token?${q.toString()}`);
    const body = await readSnsJson('instagram', res, 'refresh');
    const token = String(body?.access_token || '');
    if (!token) {
      throw new SnsAdapterError('instagram', 'refresh:empty', '갱신 응답에 access_token 이 없습니다.', null, body);
    }
    return {
      accessToken: token,
      refreshToken: null,
      expiresAt: expiresAtFrom(body?.expires_in),
      scope: typeof body?.permissions === 'string' ? body.permissions : null,
    };
  },

  // ───────────────────────── 게시 (§1-4 실측 경로 그대로) ─────────────────────────

  /**
   * 컨테이너 생성. 사진이 2장 이상이면 **캐러셀** 2단계다(§1-4 실측).
   *   ①자식마다 `is_carousel_item=true` ②부모 `media_type=CAROUSEL` + `children=id1,id2`(쉼표)
   * ★ 1차-B — 영상 1개 = 릴스(`media_type=REELS` + `video_url` · 문서 기준 · raw 전).
   */
  async createPost(req: SnsPublishRequest): Promise<SnsContainerResult> {
    if (req.media.length === 0) {
      throw new SnsAdapterError('instagram', 'media:empty', '올릴 사진이나 영상이 없습니다.');
    }
    const base = `${GRAPH}/${req.externalAccountId}/media`;
    const videos = req.media.filter((m) => m.kind === 'video');

    // 릴스 — 영상 1개만(1차-B · 사진과 섞지 않는다)
    if (videos.length > 0) {
      if (req.media.length !== 1) {
        throw new SnsAdapterError('instagram', 'media:mixed', '영상은 한 개만, 사진과 섞지 않고 올릴 수 있어요.');
      }
      const form = new URLSearchParams({
        media_type: 'REELS',
        video_url: videos[0].url,
        caption: req.caption,
        share_to_feed: 'true',
        access_token: req.accessToken,
      });
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const body = await readSnsJson('instagram', res, 'reels');
      const id = String(body?.id || '');
      if (!id) throw new SnsAdapterError('instagram', 'reels:empty', '릴스 컨테이너 응답에 id 가 없습니다.', null, body);
      return { containerId: id, ready: false };
    }

    // 단일
    if (req.media.length === 1) {
      const form = new URLSearchParams({
        image_url: req.media[0].url,
        caption: req.caption,
        access_token: req.accessToken,
      });
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const body = await readSnsJson('instagram', res, 'container');
      const id = String(body?.id || '');
      if (!id) throw new SnsAdapterError('instagram', 'container:empty', '컨테이너 응답에 id 가 없습니다.', null, body);
      // 피드는 실측상 바로 FINISHED 였지만, 상태는 워커가 한 번 확인하고 넘어간다(즉시 게시로 건너뛰지 않는다).
      return { containerId: id, ready: false };
    }

    // 캐러셀 — 자식 먼저
    const children: string[] = [];
    for (const m of req.media) {
      const form = new URLSearchParams({
        image_url: m.url,
        is_carousel_item: 'true',
        access_token: req.accessToken,
      });
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const body = await readSnsJson('instagram', res, 'carousel-item');
      const id = String(body?.id || '');
      if (!id) throw new SnsAdapterError('instagram', 'carousel-item:empty', '캐러셀 항목 응답에 id 가 없습니다.', null, body);
      children.push(id);
    }

    const parentForm = new URLSearchParams({
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption: req.caption,
      access_token: req.accessToken,
    });
    const parentRes = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: parentForm.toString(),
    });
    const parentBody = await readSnsJson('instagram', parentRes, 'carousel');
    const parentId = String(parentBody?.id || '');
    if (!parentId) throw new SnsAdapterError('instagram', 'carousel:empty', '캐러셀 응답에 id 가 없습니다.', null, parentBody);
    return { containerId: parentId, ready: false };
  },

  /** `status_code` 를 축으로 본다(§1-4 = `status` 도 같은 값이 오지만 정식 축은 `status_code`). */
  async pollContainer(req: SnsPublishRequest, containerId: string): Promise<SnsContainerStatus> {
    const q = new URLSearchParams({ fields: 'status_code,status', access_token: req.accessToken });
    const res = await fetch(`${GRAPH}/${containerId}?${q.toString()}`);
    const body = await readSnsJson('instagram', res, 'container-status');
    const raw = String(body?.status_code || '');
    return {
      raw,
      ready: raw === 'FINISHED',
      // ERROR·EXPIRED 는 되살릴 수 없다 — 워커가 폐기하고 다시 만든다(키는 불변 · 3회째면 실패로 닫는다).
      failed: raw === 'ERROR' || raw === 'EXPIRED',
      // `status` 에 사람이 읽는 사유가 온다(예: 영상 형식 거부). 원문 그대로 남긴다.
      detail: body?.status ? String(body.status) : null,
    };
  },

  async publish(req: SnsPublishRequest, containerId: string): Promise<{ platformPostId: string }> {
    const form = new URLSearchParams({ creation_id: containerId, access_token: req.accessToken });
    const res = await fetch(`${GRAPH}/${req.externalAccountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const body = await readSnsJson('instagram', res, 'publish');
    const id = String(body?.id || '');
    if (!id) throw new SnsAdapterError('instagram', 'publish:empty', '게시 응답에 id 가 없습니다.', null, body);
    return { platformPostId: id };
  },

  /**
   * 재조회 — 성공을 확정하는 유일한 근거(§2-6).
   * ⛔ `media_url` 은 만료 파라미터가 붙은 CDN 주소라 **돌려주지 않는다**(§1-4). 저장 대상은 `permalink` 뿐이다.
   */
  async fetchPost(req: SnsPublishRequest, platformPostId: string): Promise<SnsFetchedPost> {
    const q = new URLSearchParams({ fields: 'id,permalink,media_type,timestamp', access_token: req.accessToken });
    const res = await fetch(`${GRAPH}/${platformPostId}?${q.toString()}`);
    if (res.status === 404 || res.status === 400) {
      // 지워졌거나 접근할 수 없다 — 대조 워커가 "게시물 없음"으로 읽는다.
      return { exists: false, permalink: null };
    }
    const body = await readSnsJson('instagram', res, 'fetch');
    const id = String(body?.id || '');
    if (!id) return { exists: false, permalink: null };
    return {
      exists: true,
      permalink: body?.permalink ? String(body.permalink) : null,
      raw: { media_type: body?.media_type, timestamp: body?.timestamp },
    };
  },
};

registerSnsAdapter(instagramAdapter);
