/**
 * sns/x.ts — X 어댑터 **스켈레톤** (2026-09-20 S1)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-3 · §5(1차-B).
 *
 * ⛔ **`available: false` 다.** 화면 칩은 `준비 중`으로 그려진다. 이유가 둘이다.
 *   ① 개발자 계정·결제가 아직 없다 ② **호출마다 실비가 든다**(`metered: true`).
 *   §1-1 = 2026-02-06 부터 무료 구간 0 · 게시 1건 약 $0.015 · URL 포함 약 $0.20(2차 출처 · 미검증).
 *   0920 재확인 = 레거시 Basic 은 2026-06-01 종량제 자동 이관, Pro 는 2026-08-14 폐지 → 신규는 종량제뿐.
 *
 * 1차-B 에서 채운다. 그때 반드시 함께 들어가는 것 = **월 상한 fail-closed**(상한을 넘으면 보내지 않는다) ·
 * 링크 포함 시 실비 고지 · `verify: 'deferred'`(건별 조회가 곧 돈이라 타임라인 대조로 미룬다).
 * 미디어는 우리가 올린다(`mediaTransfer: 'upload'`) — Meta 계열과 다른 유일한 채널이다.
 */

import { registerSnsAdapter, SnsAdapterError, type ISnsAdapter } from './adapter';

function notReady(): never {
  throw new SnsAdapterError('x', 'not_ready', '아직 준비 중인 채널이에요.');
}

export const xAdapter: ISnsAdapter = {
  platform: 'x',
  label: 'X',
  available: false,
  scopes: ['tweet.write', 'tweet.read', 'users.read', 'media.write'],
  capabilities: {
    publishImage: true,
    publishVideo: false,
    publishCarousel: false,
    publishStory: false,
    asyncContainer: false,
    maxCaptionChars: 280,
    maxTags: 10,
    dailyLimit: 50,
    requiresExplicitConsent: false,
    metered: true,
    verify: 'deferred',
    ephemeral: false,
    mediaTransfer: 'upload',
    // ⚠ 미검증 — X 는 비율 제약이 느슨하다고 알려져 있어 넓게 둔다(원본 무접촉 우선).
    imageAspectMin: 0.4,
    imageAspectMax: 2.5,
    imageMaxWidth: 2048,
    imageMaxBytes: 5 * 1024 * 1024,
  },
  buildAuthorizeUrl: notReady,
  exchangeToken: notReady,
  fetchAccount: notReady,
  refreshToken: notReady,
};

registerSnsAdapter(xAdapter);
