/**
 * sns/x.ts — X 어댑터 (OAuth 2.0 PKCE · API v2 · 2026-09-23 1차-B)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-3 · docs/2026-09-23-sns-1b-design.md §2 · §3-6 · §3-7.
 *
 * ⚠ **전 경로가 공식 문서 기준이다(docs.x.com · 2026-09-23 열람 · raw 전).** 실측(설계 1b §8-5)에서 다르면 그 블록만 고친다.
 *   - 연결 `https://x.com/i/oauth2/authorize` + **PKCE**(S256) · 토큰 `POST https://api.x.com/2/oauth2/token`(기밀 = Basic)
 *   - **액세스 토큰 2시간** · `offline.access` 로 refresh token → `tokenRefresh: 'at_use'`(게시 직전 갱신 · 불변 25)
 *   - 사진 `POST /2/media/upload`(tweet_image) · 영상 `initialize → append(5MB 이하) → finalize → STATUS`
 *   - 글 `POST /2/tweets {text, media:{media_ids}}` · 사진 4장 · **영상과 사진 혼합 불가**
 *
 * ⛔ **호출마다 실비다(`metered`).** 공식 요금 = 글 1건 $0.015 · 링크 포함 $0.200 · 글 읽기 건당 $0.005 · 사용자 읽기 $0.010.
 *   - 월 상한 ENV 없이는 열리지 않는다(`sns-availability.ts` · 불변 23) · 발행 워커가 게시 전에 이번 달 건수를 센다
 *   - 확인은 **게시 직후 1건**(0917 의 타임라인 대조보다 싸다 · 설계 1b §3-7) · 삭제 감지는 반복 과금이라 하지 않는다
 * ★ 미디어 업로드는 `createPost` 에서 한다 — 첨부되기 전의 미디어는 공개되지 않는다. 실제로 글이 서는 호출은
 *   `publish` 하나이고, 그 직전에 워커가 소유권을 다시 확인한다(이중 게시 3겹).
 */

import { promises as fsp } from 'fs';
import {
  registerSnsAdapter, SnsAdapterError,
  type ISnsPublishAdapter, type SnsOAuthCreds, type SnsOAuthExtra, type SnsTokenResult, type SnsAccountProfile,
  type SnsPublishRequest, type SnsContainerResult, type SnsContainerStatus, type SnsFetchedPost, type SnsPublishMedia,
} from './adapter';

const AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const API = 'https://api.x.com';
const TOKEN = `${API}/2/oauth2/token`;

/** 글쓰기·미디어·내 정보 + refresh token. 필요한 것만(요청한 권한은 그대로 사용자 동의 창에 뜬다). */
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'] as const;

/** 영상 조각 크기 — 원문 "5MB 이하로" */
const APPEND_CHUNK = 4 * 1024 * 1024;
/** 글만 있는 게시의 컨테이너 자리표시 */
const TEXT_ONLY = 'text';

function expiresAtFrom(expiresIn: unknown): Date | null {
  const sec = Number(expiresIn);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return new Date(Date.now() + sec * 1000);
}

/**
 * X 응답 읽기. 오류 형식이 셋이다(OAuth `error_description` · v2 `detail`/`title` · `errors[]`).
 * ⛔ 사유를 버리지 않는다 — 원문을 `raw` 에 싣고 사람이 읽을 문장을 message 로.
 */
async function readX(res: Response, step: string): Promise<any> {
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const msg = String(
      body?.detail || body?.error_description || body?.title || body?.errors?.[0]?.message || body?.error || text.slice(0, 300) || '',
    );
    throw new SnsAdapterError('x', `${step}:${res.status}`, msg || `${step} 실패(HTTP ${res.status})`, res.status, body ?? text.slice(0, 500));
  }
  return body;
}

function basicAuth(creds: SnsOAuthCreds): string {
  return `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`;
}

async function tokenCall(creds: SnsOAuthCreds, params: Record<string, string>, step: string): Promise<SnsTokenResult> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(creds) },
    body: new URLSearchParams(params).toString(),
  });
  const body = await readX(res, step);
  const accessToken = String(body?.access_token || '');
  if (!accessToken) throw new SnsAdapterError('x', `${step}:empty`, '토큰 응답에 access_token 이 없습니다.', null, body);
  return {
    accessToken,
    refreshToken: body?.refresh_token ? String(body.refresh_token) : null,
    expiresAt: expiresAtFrom(body?.expires_in),
    scope: typeof body?.scope === 'string' ? body.scope : null,
  };
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function uploadImage(token: string, m: SnsPublishMedia): Promise<string> {
  const buf = await fsp.readFile(m.absPath);
  const form = new FormData();
  form.append('media', new Blob([buf], { type: m.mime || 'image/jpeg' }), 'image.jpg');
  form.append('media_category', 'tweet_image');
  const body = await readX(await fetch(`${API}/2/media/upload`, { method: 'POST', headers: bearer(token), body: form }), 'media');
  const id = String(body?.data?.id || '');
  if (!id) throw new SnsAdapterError('x', 'media:empty', '사진 업로드 응답에 id 가 없습니다.', null, body);
  return id;
}

/** 영상 조각 업로드. 끝나면 media id 와 처리 상태(있으면)를 돌려준다. */
async function uploadVideo(token: string, m: SnsPublishMedia): Promise<{ id: string; state: string | null }> {
  const init = await readX(await fetch(`${API}/2/media/upload/initialize`, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: m.mime || 'video/mp4', total_bytes: m.bytes, media_category: 'tweet_video' }),
  }), 'media-init');
  const id = String(init?.data?.id || '');
  if (!id) throw new SnsAdapterError('x', 'media-init:empty', '영상 업로드 시작 응답에 id 가 없습니다.', null, init);

  const fh = await fsp.open(m.absPath, 'r');
  try {
    const buf = Buffer.alloc(APPEND_CHUNK);
    let pos = 0;
    let index = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, APPEND_CHUNK, pos);
      if (bytesRead <= 0) break;
      const form = new FormData();
      form.append('media', new Blob([buf.subarray(0, bytesRead)], { type: 'application/octet-stream' }), 'chunk');
      form.append('segment_index', String(index));
      await readX(await fetch(`${API}/2/media/upload/${id}/append`, { method: 'POST', headers: bearer(token), body: form }), 'media-append');
      pos += bytesRead;
      index += 1;
    }
  } finally {
    await fh.close();
  }

  const fin = await readX(await fetch(`${API}/2/media/upload/${id}/finalize`, { method: 'POST', headers: bearer(token) }), 'media-finalize');
  const state = fin?.data?.processing_info?.state ? String(fin.data.processing_info.state) : null;
  return { id, state };
}

export const xAdapter: ISnsPublishAdapter = {
  platform: 'x',
  label: 'X',
  available: true,
  scopes: SCOPES,
  pkce: true,
  capabilities: {
    publishImage: true,
    publishVideo: true,
    publishCarousel: true,       // 사진 여러 장(최대 4)
    publishStory: false,
    asyncContainer: true,        // 영상은 처리 상태를 본다
    maxCaptionChars: 280,        // 가중 280(원문)
    maxTags: 10,
    dailyLimit: 50,
    requiresExplicitConsent: false,
    metered: true,
    verify: 'immediate',         // ★ 1차-B 변경(0917 deferred) — 글 읽기 건당 $0.005 라 1건 확인이 싸다
    ephemeral: false,
    mediaTransfer: 'upload',
    // ⚠ 사진 비율 제약은 문서에 없다. 넓게 둔다(원본 무접촉 우선).
    imageAspectMin: 0.4,
    imageAspectMax: 2.5,
    imageMaxWidth: 2048,
    imageMaxBytes: 5 * 1024 * 1024,   // 원문 5MB
    publishText: true,
    maxMediaCount: 4,            // 원문 "최대 4장"
    // 원문 = 게시 영상 0.5초~20분(기본 계정) · 비율 1:3~3:1 · H264 권장(권장이라 표식으로 막지 않는다 · 불변 22)
    video: {
      maxBytes: 8 * 1024 * 1024 * 1024,
      minSec: 0.5,
      maxSec: 1200,
      aspectMin: 1 / 3,
      aspectMax: 3,
      maxWidth: null,
      codecs: null,
    },
    pollIntervalSec: 15,
    tokenRefresh: 'at_use',
    captionCounting: 'x_weighted',
  },

  buildAuthorizeUrl(creds: SnsOAuthCreds, state: string, extra?: SnsOAuthExtra): string {
    if (!extra?.codeChallenge) {
      throw new SnsAdapterError('x', 'pkce:missing', 'X 연결에는 PKCE 값이 필요합니다.');
    }
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      scope: SCOPES.join(' '),
      state,
      code_challenge: extra.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${AUTHORIZE}?${q.toString()}`;
  },

  async exchangeToken(creds: SnsOAuthCreds, code: string, extra?: SnsOAuthExtra): Promise<SnsTokenResult> {
    if (!extra?.codeVerifier) {
      throw new SnsAdapterError('x', 'pkce:missing', '연결 요청 정보가 없어 토큰을 받지 못했습니다. 다시 연결해 주세요.');
    }
    return tokenCall(creds, {
      code,
      grant_type: 'authorization_code',
      redirect_uri: creds.redirectUri,
      code_verifier: extra.codeVerifier,
    }, 'token');
  },

  async fetchAccount(accessToken: string): Promise<SnsAccountProfile> {
    const q = new URLSearchParams({ 'user.fields': 'profile_image_url,name,username' });
    const body = await readX(await fetch(`${API}/2/users/me?${q.toString()}`, { headers: bearer(accessToken) }), 'me');
    const u = body?.data || {};
    const id = String(u?.id || '');
    if (!id) throw new SnsAdapterError('x', 'me:empty', '계정 조회 응답에 id 가 없습니다.', null, body);
    return {
      externalAccountId: id,
      username: u?.username ? String(u.username) : null,
      displayName: u?.name ? String(u.name) : null,
      avatarUrl: u?.profile_image_url ? String(u.profile_image_url) : null,
      eligible: true,
      ineligibleReason: null,
      raw: {},
    };
  },

  /** refresh token 은 1회용일 수 있다 — 새로 온 값을 반드시 저장한다(호출부가 행 잠금 안에서 부른다 · 불변 25). */
  async refreshToken(creds: SnsOAuthCreds, _accessToken: string, refreshToken?: string | null): Promise<SnsTokenResult | null> {
    if (!refreshToken) {
      throw new SnsAdapterError('x', 'refresh:missing', '채널 연결이 만료되었어요. 다시 연결해 주세요.', 401);
    }
    const t = await tokenCall(creds, { grant_type: 'refresh_token', refresh_token: refreshToken }, 'refresh');
    return { ...t, refreshToken: t.refreshToken ?? refreshToken };
  },

  // ───────────────────────── 게시 (⚠ 전부 문서 기준 · raw 전) ─────────────────────────

  /** 미디어 업로드 = 컨테이너. 컨테이너 id = media id 들(쉼표) · 글만이면 자리표시. */
  async createPost(req: SnsPublishRequest): Promise<SnsContainerResult> {
    if (req.media.length === 0) return { containerId: TEXT_ONLY, ready: true };
    const videos = req.media.filter((m) => m.kind === 'video');
    if (videos.length > 0) {
      if (req.media.length !== 1) {
        throw new SnsAdapterError('x', 'media:mixed', '영상은 한 개만, 사진과 섞지 않고 올릴 수 있어요.');
      }
      const up = await uploadVideo(req.accessToken, videos[0]);
      return { containerId: up.id, ready: up.state === null || up.state === 'succeeded' };
    }
    const ids: string[] = [];
    for (const m of req.media) ids.push(await uploadImage(req.accessToken, m));
    return { containerId: ids.join(','), ready: true };
  },

  async pollContainer(req: SnsPublishRequest, containerId: string): Promise<SnsContainerStatus> {
    const isVideo = req.media.length === 1 && req.media[0].kind === 'video';
    if (containerId === TEXT_ONLY || !isVideo) return { raw: 'READY', ready: true, failed: false };
    const q = new URLSearchParams({ command: 'STATUS', media_id: containerId });
    const body = await readX(await fetch(`${API}/2/media/upload?${q.toString()}`, { headers: bearer(req.accessToken) }), 'media-status');
    const info = body?.data?.processing_info || {};
    const state = String(info?.state || 'succeeded');
    return {
      raw: state,
      ready: state === 'succeeded',
      failed: state === 'failed',
      detail: info?.error?.message ? String(info.error.message) : null,
    };
  },

  async publish(req: SnsPublishRequest, containerId: string): Promise<{ platformPostId: string }> {
    const payload: Record<string, unknown> = {};
    if (req.caption.trim()) payload.text = req.caption;
    if (containerId !== TEXT_ONLY) payload.media = { media_ids: containerId.split(',').filter(Boolean) };
    const body = await readX(await fetch(`${API}/2/tweets`, {
      method: 'POST',
      headers: { ...bearer(req.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }), 'publish');
    const id = String(body?.data?.id || '');
    if (!id) throw new SnsAdapterError('x', 'publish:empty', '게시 응답에 id 가 없습니다.', null, body);
    return { platformPostId: id };
  },

  /** 1건 확인($0.005). 주소는 사용자 이름 없이 열리는 형태를 쓴다. */
  async fetchPost(req: SnsPublishRequest, platformPostId: string): Promise<SnsFetchedPost> {
    const res = await fetch(`${API}/2/tweets/${platformPostId}`, { headers: bearer(req.accessToken) });
    if (res.status === 404) return { exists: false, permalink: null };
    const body = await readX(res, 'fetch');
    const id = String(body?.data?.id || '');
    if (!id) return { exists: false, permalink: null };
    return { exists: true, permalink: `https://x.com/i/web/status/${id}` };
  },
};

registerSnsAdapter(xAdapter);
