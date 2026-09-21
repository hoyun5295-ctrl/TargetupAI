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

/** 묶음(게시물) 배지 — post 상태 7개를 덮는다(§3-5). */
export const SNS_POST_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: '초안', cls: 'bg-white/10 text-white/60 border-white/15' },
  scheduled: { label: '예약됨', cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30' },
  publishing: { label: '올리는 중', cls: 'bg-violet-500/15 text-violet-200 border-violet-400/30' },
  published: { label: '게시됨', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  partial_failed: { label: '일부 실패', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  failed: { label: '실패', cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30' },
  cancelled: { label: '취소됨', cls: 'bg-white/10 text-white/60 border-white/15' },
};

export interface SnsTargetView {
  targetId: string;
  platform: string;
  status: string;
  permalink: string | null;
  verifiedAt: string | null;
  deletedOnPlatformAt: string | null;
  verifyGaveUpAt: string | null;
  platformPostId: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
}

/**
 * 채널 줄 배지 — **상태 하나로 정해지지 않는다**(§3-5). 증거 컬럼까지 보고 정한다.
 * 그래서 사전이 아니라 함수다. 판정은 여기 한 곳이 소유하고 컴포넌트는 픽셀만 그린다.
 */
export function snsTargetBadge(t: SnsTargetView): { label: string; cls: string; hint?: string } {
  if (t.deletedOnPlatformAt) {
    return { label: '게시물 없음', cls: 'bg-white/10 text-white/60 border-white/15', hint: '채널에서 삭제된 것으로 확인됐어요' };
  }
  if (t.status === 'published') {
    return { label: '게시됨', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' };
  }
  if (t.status === 'failed') {
    return t.lastErrorCode === 'REAUTH_REQUIRED'
      ? { label: '계정 확인 필요', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/30' }
      : { label: '실패', cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30' };
  }
  if (t.status === 'submitted' && t.platformPostId) {
    // 올라가긴 했는데 우리가 아직 확인하지 못한 상태. **다시 올리기를 열어 주면 안 된다**(이중 게시).
    return t.verifyGaveUpAt
      ? { label: '올렸고 확인 못함', cls: 'bg-white/10 text-white/60 border-white/15', hint: '채널에서 직접 확인해 주세요' }
      : { label: '올렸고 확인 중', cls: 'bg-violet-500/10 text-violet-200/80 border-violet-400/20', hint: '채널에서 확인되면 자동으로 바뀝니다' };
  }
  if (t.status === 'claimed' || t.status === 'submitted') {
    return { label: '올리는 중', cls: 'bg-violet-500/15 text-violet-200 border-violet-400/30' };
  }
  if (t.status === 'scheduled') {
    return { label: '예약됨', cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30' };
  }
  if (t.status === 'cancelled') {
    return { label: '취소됨', cls: 'bg-white/10 text-white/60 border-white/15' };
  }
  return { label: '초안', cls: 'bg-white/10 text-white/60 border-white/15' };
}

/** 다시 시도를 열어 줘도 되는가 — **올라갔을 가능성이 있으면 잠근다.** */
export function canRetrySnsTarget(t: SnsTargetView): boolean {
  return t.status === 'failed' && !t.platformPostId;
}

/** 진행 중인 것이 있으면 화면이 폴링한다(끝난 목록을 계속 두드리지 않는다). */
export function hasSnsInFlight(posts: { targets: SnsTargetView[] }[]): boolean {
  return posts.some((p) => p.targets.some((t) => ['scheduled', 'claimed', 'submitted'].includes(t.status) && !t.verifiedAt));
}

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
