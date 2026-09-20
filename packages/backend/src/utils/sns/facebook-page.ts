/**
 * sns/facebook-page.ts — 페이스북 페이지 어댑터 **스켈레톤** (2026-09-20 S1)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-3 · §5(1차-B).
 *
 * ⛔ **`available: false` 다.** 화면 칩은 `준비 중`으로 그려지고, 연결 시도는 라우트가 막는다.
 *   이 파일이 지금 존재하는 이유는 하나다 — 화면이 채널 목록을 **추론하지 않게** 하기 위해서다(§3-3).
 *   채널이 무엇이고 무엇을 할 수 있는지는 언제나 어댑터가 선언하고, 화면은 그것을 그리기만 한다.
 *
 * 1차-B 에서 Facebook Login 기반으로 채운다(권한 `pages_manage_posts` 계열 + 영상 `publish_video` · 페이지 토큰).
 * capabilities 값은 §1-1 문서 기준이며 **미검증**이다. raw 1건을 받은 뒤 확정한다.
 */

import { registerSnsAdapter, SnsAdapterError, type ISnsAdapter } from './adapter';

function notReady(): never {
  throw new SnsAdapterError('facebook_page', 'not_ready', '아직 준비 중인 채널이에요.');
}

export const facebookPageAdapter: ISnsAdapter = {
  platform: 'facebook_page',
  label: '페이스북 페이지',
  available: false,
  scopes: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'],
  capabilities: {
    publishImage: true,
    publishVideo: true,
    publishCarousel: false,
    publishStory: false,
    asyncContainer: false,
    maxCaptionChars: 5000,
    maxTags: 30,
    dailyLimit: 50,
    requiresExplicitConsent: false,
    metered: false,
    verify: 'immediate',
    ephemeral: false,
    mediaTransfer: 'pull_url',
  },
  buildAuthorizeUrl: notReady,
  exchangeToken: notReady,
  fetchAccount: notReady,
  refreshToken: notReady,
};

registerSnsAdapter(facebookPageAdapter);
