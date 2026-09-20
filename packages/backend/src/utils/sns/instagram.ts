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
 * ⚠ **미검증 = OAuth 왕복 3개**(authorize 창 주소 · code→토큰 교환 · 단기→장기 교환).
 *   사용자 승인 창이 필요해 curl 로 확인할 수 없는 구간이며, S1 게이트("자사 계정 `active` 1건 화면")가 그 실측이다.
 *   게이트에서 응답이 다르면 이 파일의 상수를 고치고 §1-4 에 기록한다.
 */

import {
  registerSnsAdapter, readSnsJson, SnsAdapterError,
  type ISnsAdapter, type SnsOAuthCreds, type SnsTokenResult, type SnsAccountProfile,
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

export const instagramAdapter: ISnsAdapter = {
  platform: 'instagram',
  label: '인스타그램',
  available: true,
  scopes: SCOPES,
  capabilities: {
    publishImage: true,
    // 릴스(MP4)는 1차-B. 지금 true 로 두면 화면이 영상 칸을 열고 게시에서 실패한다.
    publishVideo: false,
    publishCarousel: true,
    publishStory: false,
    // 피드·캐러셀은 컨테이너가 바로 FINISHED 로 온다(§1-4). 릴스가 들어오는 1차-B 에서 true 가 된다.
    asyncContainer: false,
    maxCaptionChars: 2200,
    maxTags: 30,
    dailyLimit: 100,
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
};

registerSnsAdapter(instagramAdapter);
