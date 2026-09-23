/**
 * sns/threads.ts — Threads 어댑터 · 2026-09-20 S1
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-3 · 플랫폼 사실 §1-1.
 *
 * ★ **OAuth 왕복 확정(2026-09-21 · 자사 Threads 연결 1건 성공 · 설계서 §1-5).**
 *   아래 endpoint·scope·필드명이 **문서 기준 그대로 동작했다** — authorize 주소가 `threads.net`(인스타는
 *   `instagram.com`)이고, 토큰 교환은 `graph.threads.net`, 장기 교환 `grant_type=th_exchange_token` 이다.
 *   `/v1.0/me` 가 `username`·`threads_profile_picture_url` 을 돌려주는 것도 화면 카드로 확인했다.
 *   ⛔ 값을 바꾸려면 새 실측이 있어야 한다. **게시 경로(createPost·publish)는 여전히 미검증이다 — S3 에서 raw 로 확정한다.**
 *
 * 확인된 것(§1-1 · 공식 문서 열람):
 *   - **별도 권한** `threads_basic` · `threads_content_publish`(인스타 권한과 겹치지 않는다)
 *   - 24시간 250건 · 텍스트 500자 · 이미지·영상·캐러셀 2~20장
 *   - 토큰 1시간 → 장기 60일(갱신 endpoint 있음)
 *   - 이용 사례는 **인스타와 같은 Meta 앱에 공존**한다(§1-4 실측). **앱 ID·시크릿은 실제로 따로 발급된다**
 *     (0921 실측 = Threads `1078487358416548` ≠ Instagram `2597365514118636`) → ENV 분리가 맞았다.
 */

import {
  registerSnsAdapter, readSnsJson, SnsAdapterError,
  type ISnsPublishAdapter, type SnsOAuthCreds, type SnsTokenResult, type SnsAccountProfile,
  type SnsPublishRequest, type SnsContainerResult, type SnsContainerStatus, type SnsFetchedPost,
} from './adapter';

const GRAPH = 'https://graph.threads.net';
const AUTHORIZE = 'https://threads.net/oauth/authorize';
const TOKEN = 'https://graph.threads.net/oauth/access_token';

const SCOPES = ['threads_basic', 'threads_content_publish'] as const;

function expiresAtFrom(expiresIn: unknown): Date | null {
  const sec = Number(expiresIn);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return new Date(Date.now() + sec * 1000);
}

export const threadsAdapter: ISnsPublishAdapter = {
  platform: 'threads',
  label: 'Threads',
  available: true,
  scopes: SCOPES,
  capabilities: {
    publishImage: true,
    publishVideo: true,        // ★ 2026-09-23 1차-B(`media_type=VIDEO` · 문서 기준 · raw 전)
    publishCarousel: true,     // 2~20장(§1-1)
    publishStory: false,
    asyncContainer: true,      // 원문 "게시 전 평균 30초 대기 권장" · 영상은 처리 시간이 있다
    maxCaptionChars: 500,      // §1-1
    maxTags: 30,               // ⚠ 미검증 — Threads 는 태그 수 상한을 명시하지 않는다. 캡션 500자가 사실상 상한이다.
    dailyLimit: 250,           // §1-1
    requiresExplicitConsent: false,
    metered: false,
    verify: 'immediate',
    ephemeral: false,
    mediaTransfer: 'pull_url',
    // ⚠ Threads 는 이미지 비율 제약을 문서에 명시하지 않는다(미검증). **넓게 두어 원본을 손대지 않는 쪽으로 둔다** —
    //   모르는 채널에 좁은 범위를 씌우면 멀쩡한 사진에 여백이 붙는다. 게시 실측에서 거부 사유가 나오면 그때 좁힌다.
    imageAspectMin: 0.4,
    imageAspectMax: 2.5,
    imageMaxWidth: 1440,
    imageMaxBytes: 8 * 1024 * 1024,
    // ★ 1차-B — 공식 문서 기준(2026-09-23 열람 · 설계 1b §2).
    publishText: true,           // 글만 올릴 수 있다(인스타와 다른 점)
    maxMediaCount: 20,
    // 영상 규격 원문 = MOV·MP4 · moov 앞 · HEVC·H264 · 가로 최대 1920 · 0.01:1~10:1 · 최대 5분 · 1GB
    video: {
      maxBytes: 1024 * 1024 * 1024,
      minSec: 0,
      maxSec: 300,
      aspectMin: 0.01,
      aspectMax: 10,
      maxWidth: 1920,
      codecs: ['avc1', 'avc3', 'hvc1', 'hev1'],
    },
    pollIntervalSec: 30,
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
    const shortBody = await readSnsJson('threads', shortRes, 'token');
    const shortToken = String(shortBody?.access_token || '');
    if (!shortToken) {
      throw new SnsAdapterError('threads', 'token:empty', '토큰 응답에 access_token 이 없습니다.', null, shortBody);
    }

    const q = new URLSearchParams({
      grant_type: 'th_exchange_token',
      client_secret: creds.clientSecret,
      access_token: shortToken,
    });
    const longRes = await fetch(`${GRAPH}/access_token?${q.toString()}`);
    const longBody = await readSnsJson('threads', longRes, 'exchange');
    const longToken = String(longBody?.access_token || '');

    return {
      accessToken: longToken || shortToken,
      refreshToken: null,
      expiresAt: expiresAtFrom(longBody?.expires_in),
      scope: SCOPES.join(','),
    };
  },

  async fetchAccount(accessToken: string): Promise<SnsAccountProfile> {
    const q = new URLSearchParams({
      fields: 'id,username,name,threads_profile_picture_url',
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH}/v1.0/me?${q.toString()}`);
    const body = await readSnsJson('threads', res, 'me');

    const externalAccountId = String(body?.id || '');
    if (!externalAccountId) {
      throw new SnsAdapterError('threads', 'me:empty', '계정 조회 응답에 id 가 없습니다.', null, body);
    }
    // Threads 는 계정 종류 구분이 없다 — 연결되면 게시할 수 있다(인스타의 프로페셔널 판정에 해당하는 축이 없음).
    return {
      externalAccountId,
      username: body?.username ? String(body.username) : null,
      displayName: body?.name ? String(body.name) : (body?.username ? String(body.username) : null),
      avatarUrl: body?.threads_profile_picture_url ? String(body.threads_profile_picture_url) : null,
      eligible: true,
      ineligibleReason: null,
      raw: {},
    };
  },

  async refreshToken(_creds: SnsOAuthCreds, accessToken: string): Promise<SnsTokenResult | null> {
    const q = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: accessToken });
    const res = await fetch(`${GRAPH}/refresh_access_token?${q.toString()}`);
    const body = await readSnsJson('threads', res, 'refresh');
    const token = String(body?.access_token || '');
    if (!token) {
      throw new SnsAdapterError('threads', 'refresh:empty', '갱신 응답에 access_token 이 없습니다.', null, body);
    }
    return {
      accessToken: token,
      refreshToken: null,
      expiresAt: expiresAtFrom(body?.expires_in),
      scope: null,
    };
  },

  // ───────────────────────── 게시 (⚠ 전부 미검증 · S3 raw 로 확정) ─────────────────────────
  // 구조는 인스타와 같은 2단계(컨테이너 → 게시)이나 **경로 이름이 다르다**(`/threads`·`/threads_publish`).
  // 캡션 파라미터도 `caption` 이 아니라 `text` 다. 실측에서 다르면 이 블록만 고친다.

  async createPost(req: SnsPublishRequest): Promise<SnsContainerResult> {
    const base = `${GRAPH}/${req.externalAccountId}/threads`;

    const postForm = async (params: Record<string, string>, step: string): Promise<string> => {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...params, access_token: req.accessToken }).toString(),
      });
      const body = await readSnsJson('threads', res, step);
      const id = String(body?.id || '');
      if (!id) throw new SnsAdapterError('threads', `${step}:empty`, '응답에 id 가 없습니다.', null, body);
      return id;
    };

    if (req.media.length === 0) {
      // 텍스트만 — Threads 는 글만 올릴 수 있다(인스타와 다른 점).
      return { containerId: await postForm({ media_type: 'TEXT', text: req.caption }, 'container'), ready: false };
    }
    const videos = req.media.filter((m) => m.kind === 'video');
    if (videos.length > 0) {
      // ★ 1차-B — 영상 1개(사진과 섞지 않는다). 원문 = `media_type=VIDEO` + `video_url`.
      if (req.media.length !== 1) {
        throw new SnsAdapterError('threads', 'media:mixed', '영상은 한 개만, 사진과 섞지 않고 올릴 수 있어요.');
      }
      return {
        containerId: await postForm({ media_type: 'VIDEO', video_url: videos[0].url, text: req.caption }, 'container'),
        ready: false,
      };
    }
    if (req.media.length === 1) {
      return {
        containerId: await postForm({ media_type: 'IMAGE', image_url: req.media[0].url, text: req.caption }, 'container'),
        ready: false,
      };
    }

    const children: string[] = [];
    for (const m of req.media) {
      children.push(await postForm({ media_type: 'IMAGE', image_url: m.url, is_carousel_item: 'true' }, 'carousel-item'));
    }
    return {
      containerId: await postForm({ media_type: 'CAROUSEL', children: children.join(','), text: req.caption }, 'carousel'),
      ready: false,
    };
  },

  async pollContainer(req: SnsPublishRequest, containerId: string): Promise<SnsContainerStatus> {
    const q = new URLSearchParams({ fields: 'status,error_message', access_token: req.accessToken });
    const res = await fetch(`${GRAPH}/${containerId}?${q.toString()}`);
    const body = await readSnsJson('threads', res, 'container-status');
    const raw = String(body?.status || '');
    return {
      raw,
      ready: raw === 'FINISHED',
      failed: raw === 'ERROR' || raw === 'EXPIRED',
      // 원문 목록 = FAILED_DOWNLOADING_VIDEO · FAILED_PROCESSING_VIDEO · INVALID_DURATION … (troubleshooting 문서)
      detail: body?.error_message ? String(body.error_message) : null,
    };
  },

  async publish(req: SnsPublishRequest, containerId: string): Promise<{ platformPostId: string }> {
    const res = await fetch(`${GRAPH}/${req.externalAccountId}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: containerId, access_token: req.accessToken }).toString(),
    });
    const body = await readSnsJson('threads', res, 'publish');
    const id = String(body?.id || '');
    if (!id) throw new SnsAdapterError('threads', 'publish:empty', '게시 응답에 id 가 없습니다.', null, body);
    return { platformPostId: id };
  },

  async fetchPost(req: SnsPublishRequest, platformPostId: string): Promise<SnsFetchedPost> {
    const q = new URLSearchParams({ fields: 'id,permalink,timestamp', access_token: req.accessToken });
    const res = await fetch(`${GRAPH}/${platformPostId}?${q.toString()}`);
    if (res.status === 404 || res.status === 400) return { exists: false, permalink: null };
    const body = await readSnsJson('threads', res, 'fetch');
    const id = String(body?.id || '');
    if (!id) return { exists: false, permalink: null };
    return { exists: true, permalink: body?.permalink ? String(body.permalink) : null, raw: { timestamp: body?.timestamp } };
  },
};

registerSnsAdapter(threadsAdapter);
