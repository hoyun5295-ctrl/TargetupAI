/**
 * sns/threads.ts — Threads 어댑터 · 2026-09-20 S1
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-3 · 플랫폼 사실 §1-1.
 *
 * ⚠ **이 파일의 endpoint·필드명은 전부 미검증이다.** 인스타(§1-4)와 달리 raw 1건을 아직 못 받았다.
 *   설계서 §7 ① 의 남은 항목이며, 확정 순서는 인스타 어댑터가 S1 게이트를 통과한 뒤다.
 *   ⛔ 실측 전에는 이 어댑터로 고객사를 열지 않는다 — 1차-A 실측 대상은 인스타가 먼저다.
 *
 * 확인된 것(§1-1 · 공식 문서 열람):
 *   - **별도 권한** `threads_basic` · `threads_content_publish`(인스타 권한과 겹치지 않는다)
 *   - 24시간 250건 · 텍스트 500자 · 이미지·영상·캐러셀 2~20장
 *   - 토큰 1시간 → 장기 60일(갱신 endpoint 있음)
 *   - 이용 사례는 **인스타와 같은 Meta 앱에 공존**한다(§1-4 실측). 다만 앱 ID·시크릿이 따로 발급된다는
 *     문서 기술이 있어 ENV 를 `THREADS_CLIENT_ID` 계열로 분리해 둔다.
 */

import {
  registerSnsAdapter, readSnsJson, SnsAdapterError,
  type ISnsAdapter, type SnsOAuthCreds, type SnsTokenResult, type SnsAccountProfile,
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

export const threadsAdapter: ISnsAdapter = {
  platform: 'threads',
  label: 'Threads',
  available: true,
  scopes: SCOPES,
  capabilities: {
    publishImage: true,
    publishVideo: false,       // 1차-A 는 이미지만
    publishCarousel: true,     // 2~20장(§1-1)
    publishStory: false,
    asyncContainer: false,
    maxCaptionChars: 500,      // §1-1
    maxTags: 30,               // ⚠ 미검증 — Threads 는 태그 수 상한을 명시하지 않는다. 캡션 500자가 사실상 상한이다.
    dailyLimit: 250,           // §1-1
    requiresExplicitConsent: false,
    metered: false,
    verify: 'immediate',
    ephemeral: false,
    mediaTransfer: 'pull_url',
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
};

registerSnsAdapter(threadsAdapter);
