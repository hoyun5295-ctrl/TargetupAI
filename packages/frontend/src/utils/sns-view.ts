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

import { hasBenefitPlaceholder, hasUrlPlaceholder } from './message-placeholders';

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
  // ★ 2026-09-24 C4 — 서버 카드 파생값(sns-accounts.ts toAccountCard)
  /** 연결 연장이 실패하고 있고 만료가 7일 안 */
  renewFailing?: boolean;
  /** 이 계정으로 기다리는 예약 수 */
  waitingScheduled?: number;
  /** 연결 확인이 10분 넘게 끝나지 않음 */
  stuck?: boolean;
}

export interface SnsVideoSpec {
  maxBytes: number;
  minSec: number;
  maxSec: number;
  aspectMin: number;
  aspectMax: number;
  maxWidth: number | null;
  codecs: readonly string[] | null;
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
  // ★ 2026-09-23 1차-B (docs/2026-09-23-sns-1b-design.md §3-4)
  publishText: boolean;
  maxMediaCount: number;
  video: SnsVideoSpec | null;
  pollIntervalSec: number;
  tokenRefresh: 'scheduled' | 'at_use' | 'none';
  captionCounting: 'chars' | 'x_weighted';
  /** ★ 2026-09-24 첫 태그만 태그로 인정하는 채널(Threads) */
  tagFirstOnly?: boolean;
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
  // ★ 2026-09-24 E1~E3 — 서버 목록 CT(sns-posts.ts)가 싣는 값. 옛 응답에는 없을 수 있다.
  accountId?: string;
  accountUsername?: string | null;
  accountDisplayName?: string | null;
  accountStatus?: string | null;
  scheduledAt?: string | null;
  /** 이 채널에 실제로 올라간(올라갈) 확정본 */
  caption?: string;
  /** 다시 시도로 대체된 옛 줄 — 버튼 0 · 흐리게 */
  superseded?: boolean;
  action?: SnsFailureAction;
  checkUrl?: string | null;
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

/** 폴링을 켜 두는 예약 창 — 이 시간 안에 올라갈 예약이 있으면 미리 두드린다(E8). */
export const SNS_POLL_LEAD_MS = 10 * 60 * 1000;

/**
 * 진행 중인 것이 있으면 화면이 폴링한다(끝난 목록을 계속 두드리지 않는다).
 * ★ 2026-09-24 E8 — 진행 중 = 올리는 중(claimed) · 확인 대기(submitted) · **10분 안에 올라갈 예약**.
 *   먼 예약은 폴링하지 않는다(다음 예약 10분 전에 타이머가 깨운다 · SnsHistory).
 */
export function hasSnsInFlight(posts: { targets: SnsTargetView[] }[], now: number = Date.now()): boolean {
  return posts.some((p) => p.targets.some((t) => {
    if (t.superseded) return false;
    if ((t.status === 'claimed' || t.status === 'submitted') && !t.verifiedAt) return true;
    if (t.status !== 'scheduled') return false;
    const at = t.scheduledAt ? new Date(t.scheduledAt).getTime() : NaN;
    // 시각을 모르는 예약(옛 응답)은 진행 중으로 본다 — 안 두드려서 놓치는 쪽보다 낫다.
    return !Number.isFinite(at) || at - now <= SNS_POLL_LEAD_MS;
  }));
}

/** 다음 예약 시각(폴링 타이머). 없으면 null. */
export function nextSnsScheduledAt(posts: { targets: SnsTargetView[] }[]): number | null {
  let min: number | null = null;
  for (const p of posts) for (const t of p.targets) {
    if (t.superseded || t.status !== 'scheduled' || !t.scheduledAt) continue;
    const at = new Date(t.scheduledAt).getTime();
    if (Number.isFinite(at) && (min === null || at < min)) min = at;
  }
  return min;
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

// ───────────────────────── ★ 2026-09-23 1차-B — 서버 CT 미러 ─────────────────────────
// ⛔ 원본 = backend/src/utils/sns-media-fit.ts(snsMediaBlockReason·planSnsVideoFit) ·
//    backend/src/utils/sns-caption-rules.ts(countSnsCaption). **문구·값까지 같아야 한다** —
//    칩 아래 사유와 저장 거절 사유가 다르면 사용자가 두 번 헷갈린다. 계약 테스트(sns-1b-rules)가 같은 표로 맞춘다.

export interface SnsMediaSummary {
  images: number;
  videos: number;
}

/** 이 채널이 이 미디어 조합을 받지 못하는 사유 한 문장. 받으면 null. */
export function snsMediaBlockReason(summary: SnsMediaSummary, cap: SnsCapabilities): string | null {
  const images = Math.max(0, summary.images | 0);
  const videos = Math.max(0, summary.videos | 0);
  if (images + videos === 0) return cap.publishText ? null : '사진이나 영상이 있어야 올릴 수 있어요.';
  if (videos > 1) return '영상은 한 개만 올릴 수 있어요.';
  if (videos > 0 && images > 0) return '영상과 사진은 함께 올릴 수 없어요.';
  if (videos > 0) return cap.publishVideo ? null : '영상은 올릴 수 없어요.';
  if (!cap.publishImage) return '사진은 올릴 수 없어요.';
  if (images > 1 && !cap.publishCarousel) return '사진은 한 장만 올릴 수 있어요.';
  if (images > cap.maxMediaCount) return `사진은 ${cap.maxMediaCount}장까지 올릴 수 있어요.`;
  return null;
}

export interface SnsVideoFacts {
  bytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
}

function secText(sec: number): string {
  return sec >= 60 && sec % 60 === 0 ? `${sec / 60}분` : `${sec}초`;
}
function bytesText(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024}GB` : `${Math.floor(mb)}MB`;
}
function ratioText(r: number): string {
  return r >= 1 ? `${Math.round(r * 100) / 100}:1` : `1:${Math.round((1 / r) * 100) / 100}`;
}
function codecNames(codecs: readonly string[]): string {
  const names: string[] = [];
  if (codecs.some((c) => c === 'avc1' || c === 'avc3')) names.push('H.264');
  if (codecs.some((c) => c === 'hvc1' || c === 'hev1')) names.push('HEVC');
  return names.join(' 또는 ');
}
function aspectOf(width: number | null, height: number | null): number | null {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

/** 이 영상을 이 채널이 받는가. **확인된 위반만 막는다** — 모르는 값(null)은 통과. */
export function planSnsVideoFit(v: SnsVideoFacts, spec: SnsVideoSpec | null): { accepted: boolean; notice: string } {
  if (!spec) return { accepted: false, notice: '영상은 올릴 수 없어요.' };
  if (v.bytes > spec.maxBytes) return { accepted: false, notice: `영상이 너무 커요. ${bytesText(spec.maxBytes)} 이하로 올려 주세요.` };
  if (v.durationSec !== null && v.durationSec < spec.minSec) {
    return { accepted: false, notice: `영상이 너무 짧아요. ${secText(spec.minSec)} 이상이어야 해요.` };
  }
  if (v.durationSec !== null && v.durationSec > spec.maxSec) {
    return { accepted: false, notice: `영상이 너무 길어요. ${secText(spec.maxSec)}까지 올릴 수 있어요.` };
  }
  if (spec.codecs && v.videoCodec !== null && !spec.codecs.includes(v.videoCodec)) {
    return { accepted: false, notice: `받지 않는 영상 형식이에요. ${codecNames(spec.codecs)}로 내보낸 영상을 올려 주세요.` };
  }
  if (spec.maxWidth !== null && v.width !== null && v.width > spec.maxWidth) {
    return { accepted: false, notice: `가로 ${spec.maxWidth}px 이하로 내보낸 영상만 올릴 수 있어요.` };
  }
  const aspect = aspectOf(v.width, v.height);
  if (aspect !== null && (aspect < spec.aspectMin || aspect > spec.aspectMax)) {
    return { accepted: false, notice: `화면 비율이 받는 범위(${ratioText(spec.aspectMin)}~${ratioText(spec.aspectMax)})를 벗어났어요.` };
  }
  return { accepted: true, notice: '' };
}

const X_SCHEME_URL_RE = /https?:\/\/[^\s]+/gi;
const X_BARE_URL_RE = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|ai|io|co|kr|me|app|dev|shop|store|info|biz|xyz|jp|us|tv|ly|gg)\b(?:\/[^\s]*)?/gi;
const X_EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;

function xWeight(cp: number): number {
  if (cp <= 4351) return 1;
  if (cp >= 8192 && cp <= 8205) return 1;
  if (cp >= 8208 && cp <= 8223) return 1;
  if (cp >= 8242 && cp <= 8247) return 1;
  return 2;
}

/** 채널 방식으로 센 글자 수. chars = 코드포인트 수 · x_weighted = X 가중(한글·이모지 2 · 링크 23). */
export function countSnsCaption(text: string, mode: 'chars' | 'x_weighted'): number {
  const raw = String(text ?? '');
  if (mode !== 'x_weighted') return [...raw].length;
  let total = 0;
  let marks = 0;
  const take = (w: number) => () => { total += w; marks += 1; return '\n'; };
  const rest = raw.normalize('NFC')
    .replace(X_SCHEME_URL_RE, take(23))
    .replace(X_BARE_URL_RE, take(23))
    .replace(X_EMOJI_RE, take(2));
  for (const ch of rest) total += xWeight(ch.codePointAt(0) ?? 0);
  return total - marks;
}

/** 영상 한 개 상한 — 서버 `sns-media.ts SNS_VIDEO_MAX_BYTES` 와 같은 값(계약 테스트). 넘으면 전송을 시작하지 않는다. */
export const SNS_VIDEO_MAX_BYTES = 300 * 1024 * 1024;

/** 영상 길이 표기(1:05 · 12:30). */
export function formatSnsDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ───────────────────────── ★ 2026-09-24 올릴 글 · 연결 관리 — 서버 CT 미러 ─────────────────────────
// 설계 SoT = docs/2026-09-24-sns-channel-design.md §4 B-2·B-3 · §5 C5 · §6.
// ⛔ 원본 = backend/src/utils/sns-caption-rules.ts(checkSnsTag·extractBodyHashtags·buildSnsCaption) ·
//    sns-caption-ai.ts(splitTrailingTagLines·snsCaptionMode). **같은 입력에 같은 답**이어야 한다.
//    화면이 보여 준 글과 올라가는 글이 다르면 서버가 409 CAPTION_CHANGED 로 멈춘다. 계약 테스트가 같은 표로 맞춘다.

export type SnsFailureAction = 'reconnect' | 'retry_at' | 'publish_now' | 'check' | 'rewrite' | 'none';

export interface SnsPostView {
  id: string;
  body: string;
  tags: string[];
  status: string;
  scheduled_at: string | null;
  created_at: string;
  media_ids: string[];
  /** ★ 0925 미디어 종류(카드 표지) — 옛 응답에는 없을 수 있다 */
  media?: Array<{ id: string; kind: string }>;
  nextAt?: string | null;
  targets: SnsTargetView[];
}

// ───────────────────────── ★ 2026-09-25 올린 기록 카드 · 상세 창 상태 ─────────────────────────
// 카드 점 색 · 카드 표시 · 상세 창 탭 배지가 **같은 판정**을 쓴다(한 글이 카드와 창에서 다른 상태로 보이지 않게).

export type SnsTargetDisplay = 'ok' | 'gone' | 'fail' | 'check' | 'run' | 'cancelled' | 'draft';

/** 채널 줄 하나의 표시 상태. 서버가 정한 할 일(action)을 증거로 먼저 본다. */
export function snsTargetDisplayState(t: SnsTargetView): SnsTargetDisplay {
  if (t.deletedOnPlatformAt) return 'gone';
  if (t.action === 'check') return 'check';
  if (t.status === 'published') return 'ok';
  if (t.status === 'failed') return 'fail';
  if (t.status === 'claimed' || t.status === 'submitted' || t.status === 'scheduled') return 'run';
  if (t.status === 'cancelled') return 'cancelled';
  return 'draft';
}

export const SNS_TARGET_DISPLAY: Record<SnsTargetDisplay, { label: string; dot: string; badge: string }> = {
  ok: { label: '게시됨', dot: 'bg-emerald-400', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  gone: { label: '게시물 없음', dot: 'bg-white/35', badge: 'bg-white/10 text-white/60 border-white/15' },
  fail: { label: '실패', dot: 'bg-rose-400', badge: 'bg-rose-500/15 text-rose-300 border-rose-400/30' },
  check: { label: '확인 필요', dot: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  run: { label: '올리는 중', dot: 'bg-violet-400', badge: 'bg-violet-500/15 text-violet-200 border-violet-400/30' },
  cancelled: { label: '취소됨', dot: 'bg-white/35', badge: 'bg-white/10 text-white/60 border-white/15' },
  draft: { label: '초안', dot: 'bg-white/35', badge: 'bg-white/10 text-white/60 border-white/15' },
};

/**
 * 카드 표시 — **문제가 있을 때만** 붙인다(다 올라간 글은 조용하게 · Harold 0925 목업).
 * 실패가 전부면 '실패' · 일부면 '일부 실패' · 결과 모름 '확인 필요' · 진행 중 '올리는 중' · 전부 취소 '취소됨'.
 */
export function snsPostCardState(targets: SnsTargetView[]): { label: string; tone: 'rose' | 'amber' | 'violet' | 'gray' } | null {
  const latest = targets.filter((t) => !t.superseded);
  const states = latest.map(snsTargetDisplayState);
  if (!states.length) return null;
  if (states.includes('fail')) return states.every((s) => s === 'fail') ? { label: '실패', tone: 'rose' } : { label: '일부 실패', tone: 'amber' };
  if (states.includes('check')) return { label: '확인 필요', tone: 'amber' };
  if (states.includes('run')) return { label: '올리는 중', tone: 'violet' };
  if (states.every((s) => s === 'cancelled')) return { label: '취소됨', tone: 'gray' };
  return null;
}

export type SnsAttentionKind = 'reconnect' | 'stuck' | 'ineligible' | 'renew_failing' | 'failed' | 'unknown';

export interface SnsAttentionItem {
  kind: SnsAttentionKind;
  platform: string;
  accountId: string;
  accountUsername: string | null;
  accountDisplayName: string | null;
  reason: string | null;
  waitingScheduled?: number;
  expiresAt?: string | null;
  postId?: string;
  targetId?: string;
  at?: string | null;
  checkUrl?: string | null;
}

export interface SnsAttention {
  items: SnsAttentionItem[];
  total: number;
}

export interface SnsComposeDefaults {
  accountIds: string[];
  dropped: Array<{ accountId: string; reason: 'disconnected' | 'metered' | 'closed' }>;
  source: 'last_post' | 'only_account' | 'none';
}

/** 우리가 만든 이미지가 실린 글 끝에 붙는 표시(서버 brand-message.ts BRAND_AI_IMAGE_NOTICE 와 같은 값 · 계약 테스트). */
export const SNS_AI_IMAGE_NOTICE = '*AI로 생성된 이미지입니다';

const TAG_BODY_RE = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]+$/;
const JAMO_ONLY_RE = /^[ㄱ-ㅎㅏ-ㅣ]+$/;
const DIGITS_ONLY_RE = /^[0-9]+$/;
export const SNS_TAG_MAX_CHARS = 50;

export type SnsTagCheck = { ok: true; tag: string } | { ok: false; raw: string; reason: string };

/** 태그 한 개 판정. 앞 `#` 와 공백을 지운다. 거절이면 사유 한 문장. 빈 값이면 null. */
export function checkSnsTag(raw: unknown): SnsTagCheck | null {
  const src = String(raw ?? '');
  const s = src.trim().replace(/^#+/, '').replace(/\s+/g, '').normalize('NFC');
  if (!s) return null;
  if (!TAG_BODY_RE.test(s)) return { ok: false, raw: src.trim(), reason: '태그에는 한글·영문·숫자·밑줄만 쓸 수 있어요.' };
  if (DIGITS_ONLY_RE.test(s)) return { ok: false, raw: src.trim(), reason: '숫자만으로는 태그가 되지 않아요.' };
  if (JAMO_ONLY_RE.test(s)) return { ok: false, raw: src.trim(), reason: '자음·모음만으로는 태그를 만들 수 없어요.' };
  if ([...s].length > SNS_TAG_MAX_CHARS) return { ok: false, raw: src.trim(), reason: `태그는 ${SNS_TAG_MAX_CHARS}자까지 쓸 수 있어요.` };
  return { ok: true, tag: s };
}

export function normalizeSnsTag(raw: unknown): string | null {
  const r = checkSnsTag(raw);
  return r && r.ok ? r.tag : null;
}

/** 중복·형식 위반을 걸러 낸 태그 목록(순서 유지 · 대소문자 무시 중복 제거). */
export function normalizeSnsTags(raw: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const tag = normalizeSnsTag(item);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

interface SnsTextSpan { start: number; end: number; text: string }

function findSnsLinkSpans(text: string): SnsTextSpan[] {
  const src = String(text ?? '');
  const spans: SnsTextSpan[] = [];
  for (const re of [X_SCHEME_URL_RE, X_BARE_URL_RE]) {
    for (const m of src.matchAll(re)) {
      if (m.index == null) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (spans.some((sp) => start < sp.end && end > sp.start)) continue;
      spans.push({ start, end, text: m[0] });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

const BODY_TAG_RE = /(^|[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_&/])#([0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]+)/g;

function findBodyHashtagSpans(text: string): Array<SnsTextSpan & { tag: string }> {
  const src = String(text ?? '');
  const links = findSnsLinkSpans(src);
  const out: Array<SnsTextSpan & { tag: string }> = [];
  for (const m of src.matchAll(BODY_TAG_RE)) {
    if (m.index == null) continue;
    const start = m.index + m[1].length;
    const end = start + 1 + m[2].length;
    if (links.some((l) => start < l.end && end > l.start)) continue;
    const r = checkSnsTag(m[2]);
    if (!r || !r.ok) continue;
    out.push({ start, end, text: src.slice(start, end), tag: r.tag });
  }
  return out;
}

/** 본문에 사용자가 직접 쓴 해시태그(고유 · 대소문자 무시 · 처음 표기). */
export function extractBodyHashtags(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const span of findBodyHashtagSpans(String(body ?? '').normalize('NFC'))) {
    const key = span.tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(span.tag);
  }
  return out;
}

/** 사용자가 채워야 할 자리 표기가 남았는가(message-placeholders 규약 그대로). */
export function hasSnsPlaceholder(text: string): boolean {
  return hasBenefitPlaceholder(text) || hasUrlPlaceholder(text);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOTICE_TAIL_RE = new RegExp(`(?:^|\\n)${escapeRe(SNS_AI_IMAGE_NOTICE)}$`);

export interface SnsCaptionSpecView {
  maxCaptionChars: number;
  maxTags: number;
  captionCounting?: 'chars' | 'x_weighted';
  tagFirstOnly?: boolean;
}

export interface SnsCaptionView {
  text: string;
  length: number;
  limit: number;
  overBy: number;
  ok: boolean;
  droppedTags: string[];
  aiNoticeApplied: boolean;
  keptTags: string[];
  bodyTags: string[];
  alreadyInBody: string[];
  bodyTagsOver: boolean;
  placeholderLeft: boolean;
}

/** 채널 하나의 확정본(서버 buildSnsCaption 미러). 본문은 한 글자도 바꾸지 않는다. */
export function buildSnsCaption(input: { body: string; tags: string[]; aiNotice: boolean }, spec: SnsCaptionSpecView): SnsCaptionView {
  const body = String(input.body ?? '');
  const chips = normalizeSnsTags(input.tags ?? []);
  const bodyTags = extractBodyHashtags(body);
  const bodyKeys = new Set(bodyTags.map((t) => t.toLowerCase()));
  const alreadyInBody = chips.filter((t) => bodyKeys.has(t.toLowerCase()));
  const remaining = chips.filter((t) => !bodyKeys.has(t.toLowerCase()));
  const budget = Math.max(0, spec.maxTags - bodyTags.length);
  const keptTags = remaining.slice(0, budget);
  const droppedTags = remaining.slice(keptTags.length);
  const bodyTagsOver = !spec.tagFirstOnly && bodyTags.length > spec.maxTags;

  const noticeInBody = NOTICE_TAIL_RE.test(body.trimEnd());
  const parts: string[] = [];
  if (body.trim()) parts.push(body);
  if (keptTags.length) parts.push(keptTags.map((t) => `#${t}`).join(' '));
  if (input.aiNotice && !noticeInBody) parts.push(SNS_AI_IMAGE_NOTICE);

  const text = parts.join('\n\n');
  const length = countSnsCaption(text, spec.captionCounting ?? 'chars');
  const limit = spec.maxCaptionChars;
  const overBy = Math.max(0, length - limit);
  const placeholderLeft = hasSnsPlaceholder(body);
  return {
    text, length, limit, overBy,
    ok: overBy === 0 && !placeholderLeft,
    droppedTags,
    aiNoticeApplied: !!input.aiNotice || noticeInBody,
    keptTags, bodyTags, alreadyInBody, bodyTagsOver, placeholderLeft,
  };
}

/** 글 끝의 태그만 있는 줄을 떼어 낸다(서버 sns-caption-ai.ts 미러). */
export function splitTrailingTagLines(body: string): { head: string; tail: string } {
  const src = String(body ?? '');
  const lines = src.split('\n');
  let cut = lines.length;
  while (cut > 0) {
    const line = lines[cut - 1];
    if (!line.trim()) { cut -= 1; continue; }
    const rest = line.replace(/(^|\s)#[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]+/g, ' ').trim();
    if (rest === '' && /#/.test(line)) { cut -= 1; continue; }
    break;
  }
  const tailLines = lines.slice(cut);
  if (!tailLines.some((l) => /#/.test(l))) return { head: src, tail: '' };
  const head = lines.slice(0, cut).join('\n');
  return { head, tail: src.slice(head.length) };
}

export type SnsCaptionMode = 'refine' | 'photo_draft' | 'locked';

/** AI 캡션 모드(서버 snsCaptionMode 미러). 버튼 문구·잠금 사유가 이것으로 정해진다. */
export function snsCaptionMode(input: { body: string; imageCount: number; videoCount: number }): { mode: SnsCaptionMode; reason: string | null } {
  const { head } = splitTrailingTagLines(input.body);
  if (head.trim()) return { mode: 'refine', reason: null };
  if (input.imageCount > 0) return { mode: 'photo_draft', reason: null };
  if (input.videoCount > 0) return { mode: 'locked', reason: '영상만 있으면 AI가 첫 글을 쓸 수 없어요. 한 줄만 써 주시면 다듬어 드릴게요.' };
  return { mode: 'locked', reason: '글을 한 줄 쓰거나 사진을 올리면 AI가 도와드려요.' };
}

// ── 계정 이름 · 채널 요약(A-0-3 · C5) ──

function dayText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function baseAccountName(a: { username: string | null; displayName: string | null }): string {
  const u = String(a.username || '').replace(/^@/, '').trim();
  if (u) return `@${u}`;
  const d = String(a.displayName || '').trim();
  return d || '이름 없음';
}

/**
 * 계정 이름: @username → 표시 이름 → '이름 없음'.
 * 같은 채널에 같은 이름의 계정이 둘 이상이면 연결한 날을 붙여 가른다(칩·카드·기록이 같은 이름을 쓴다).
 */
export function snsAccountName(
  a: { id: string; platform: string; username: string | null; displayName: string | null; connectedAt?: string | null },
  all: ReadonlyArray<{ id: string; platform: string; username: string | null; displayName: string | null; status?: string }> = [],
): string {
  const name = baseAccountName(a);
  const twins = all.filter((x) => x.id !== a.id && x.platform === a.platform && x.status !== 'revoked' && baseAccountName(x) === name);
  if (twins.length === 0) return name;
  const day = dayText(a.connectedAt);
  return day ? `${name} · ${day} 연결` : name;
}

/** 목록 줄(SnsTargetView)의 계정 이름. */
export function snsTargetAccountName(t: SnsTargetView, accounts: SnsAccount[]): string {
  const acc = accounts.find((a) => a.id === t.accountId);
  if (acc) return snsAccountName(acc, accounts);
  return baseAccountName({ username: t.accountUsername ?? null, displayName: t.accountDisplayName ?? null });
}

/** 다시 연결이 필요한 계정인가(끊김 · 연결 확인 멈춤). */
export function snsNeedsReconnect(a: SnsAccount): boolean {
  return a.status === 'token_expired' || a.status === 'reauth_required' || a.status === 'error' || (a.status === 'pending' && !!a.stuck);
}

const WORST_ORDER: Record<string, number> = {
  reauth_required: 0, token_expired: 0, error: 0, ineligible: 1, pending: 2, active: 3,
};

/**
 * 채널 카드 배지 = **가장 나쁜 계정**(C5). 둘째 계정이 끊겨도 카드가 '연결됨'이던 결함(K7).
 * 연장 실패 중인 active 는 다른 active 보다 앞에 둔다.
 */
export function snsChannelSummary(accounts: SnsAccount[]): {
  worst: SnsAccount | null;
  badge: { label: string; cls: string } | null;
  count: number;
  connected: boolean;
} {
  const live = accounts.filter((a) => a.status !== 'revoked');
  if (live.length === 0) return { worst: null, badge: null, count: 0, connected: false };
  const rank = (a: SnsAccount) => (a.status === 'pending' && a.stuck ? 0.5 : a.status === 'active' && a.renewFailing ? 2.5 : WORST_ORDER[a.status] ?? 1.5);
  const worst = [...live].sort((x, y) => rank(x) - rank(y))[0];
  let badge = SNS_ACCOUNT_BADGE[worst.status] ?? null;
  if (worst.status === 'pending' && worst.stuck) badge = SNS_ACCOUNT_BADGE.reauth_required;
  if (worst.status === 'active' && worst.renewFailing) badge = { label: '연장 확인 필요', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/30' };
  return { worst, badge, count: live.length, connected: live.some((a) => a.status === 'active') };
}

/** 실패 줄 버튼 이름(서버 snsFailureAction 이 정한 값). */
export const SNS_ACTION_LABEL: Record<SnsFailureAction, string> = {
  reconnect: '다시 연결',
  retry_at: '다시 예약',
  publish_now: '지금 다시 올리기',
  check: '채널에서 확인',
  rewrite: '불러와서 쓰기',
  none: '',
};
