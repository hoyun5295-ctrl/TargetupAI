/**
 * sns-view.ts — SNS 채널 화면 공용 타입·사전 (2026-09-20 S1)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-5.
 *   "화면 배지 = 상수 사전 1파일 소유(문구·색·설명) · 훅 = 판정 · 컴포넌트 = 픽셀 ·
 *    **사전에 없는 값은 안 그린다**"
 *
 * 카드와 상세 창이 같은 사전을 봐야 한 화면에서 같은 계정이 두 이름으로 불리지 않는다.
 * 백엔드 계약 테스트가 이 파일을 읽어 계정 상태 7개를 다 덮는지 단정한다.
 */

export interface SnsAccount {
  id: string;
  platform: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  statusReason: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  tokenExpiresAt: string | null;
}

export interface SnsCapabilities {
  publishImage: boolean;
  publishVideo: boolean;
  publishCarousel: boolean;
  publishStory: boolean;
  asyncContainer: boolean;
  maxCaptionChars: number;
  maxTags: number;
  dailyLimit: number;
  requiresExplicitConsent: boolean;
  metered: boolean;
  verify: 'immediate' | 'deferred' | 'none';
  ephemeral: boolean;
  mediaTransfer: 'pull_url' | 'upload';
}

export interface SnsSpec {
  platform: string;
  label: string;
  available: boolean;
  capabilities: SnsCapabilities;
}

/**
 * 계정 배지 사전 — 백엔드 `SNS_ACCOUNT_STATUSES` 7개를 빠짐없이 덮는다.
 * 사전에 없는 상태가 오면 화면은 배지를 안 그린다(틀린 이름을 붙이는 것보다 낫다).
 */
export const SNS_ACCOUNT_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: '연결됨', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  pending: { label: '확인 중', cls: 'bg-violet-500/15 text-violet-200 border-violet-400/30' },
  ineligible: { label: '계정 확인 필요', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  token_expired: { label: '다시 연결 필요', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  reauth_required: { label: '다시 연결 필요', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  revoked: { label: '해제됨', cls: 'bg-white/10 text-white/60 border-white/15' },
  error: { label: '확인 필요', cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30' },
};

/** 해제된 계정은 카드에서 접는다(이력 때문에 행은 남아 있지만 "연결된 채널"은 아니다). */
export function liveSnsAccounts(accounts: SnsAccount[], platform: string): SnsAccount[] {
  return accounts.filter((a) => a.platform === platform && a.status !== 'revoked');
}

/**
 * 이 채널에 무엇을 올릴 수 있는가 — **어댑터가 선언한 값만 읽는다**(§3-3 추론 0).
 * 예: "사진 · 여러 장" · "사진 · 영상"
 */
export function snsAccountAbility(cap: SnsCapabilities | undefined): string {
  if (!cap) return '';
  const parts: string[] = [];
  if (cap.publishImage) parts.push('사진');
  if (cap.publishVideo) parts.push('영상');
  if (cap.publishCarousel) parts.push('여러 장');
  if (parts.length === 0) parts.push('글');
  return parts.join(' · ');
}
