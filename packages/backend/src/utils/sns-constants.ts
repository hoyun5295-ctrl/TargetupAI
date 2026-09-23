/**
 * sns-constants.ts — SNS 게시 상수 컨트롤타워 (2026-09-20 S1)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md
 *   §2-7  target 상태값 7개 고정. 늘리지 않는다. `stage`는 기록 전용이며 어떤 분기도 읽지 않는다.
 *   §2-16 게이트 순서 = 요금제 먼저(requirePlanFeature) → ENV 나중.
 *   §3-5  상태 머신 · post 상태는 자식 집계 파생.
 *
 * ⛔ 이 파일이 값의 유일한 소유자다. 라우트·워커·어댑터·화면 규격(`GET /api/sns/specs`)이
 *   전부 여기를 import 한다. 같은 값을 다른 파일에 다시 적으면 계약 테스트가 깨진다.
 */

/** 플랫폼 코드 — DB `varchar(32)`에 그대로 들어간다. 1차-A = instagram·threads. */
export const SNS_PLATFORMS = ['instagram', 'threads', 'facebook_page', 'x'] as const;
export type SnsPlatform = (typeof SNS_PLATFORMS)[number];

/** 1차-A 개방 채널 — 어댑터가 실재하고 화면 칩이 살아 있는 것. 나머지는 `준비 중`. */
export const SNS_PLATFORMS_PHASE_1A: readonly SnsPlatform[] = ['instagram', 'threads'];

export function isSnsPlatform(v: unknown): v is SnsPlatform {
  return typeof v === 'string' && (SNS_PLATFORMS as readonly string[]).includes(v);
}

/**
 * 계정 상태 7 — §3-10.
 *   pending          토큰은 받았으나 계정 재조회 전(초록 0)
 *   active           재조회 성공 · 프로페셔널 확인
 *   ineligible       프로페셔널이 아니거나 게시 자격 없음(사유 = status_reason)
 *   token_expired    토큰 만료 감지
 *   reauth_required  권한 회수·OAuth 오류 → 사람이 다시 연결해야 함
 *   revoked          사용자가 해제(행은 남기고 토큰만 NULL · 게시 이력이 참조)
 *   error            갱신·조회가 반복 실패(사유 = meta.refresh_error)
 */
export const SNS_ACCOUNT_STATUSES = [
  'pending', 'active', 'ineligible', 'token_expired', 'reauth_required', 'revoked', 'error',
] as const;
export type SnsAccountStatus = (typeof SNS_ACCOUNT_STATUSES)[number];

/** target 상태 7 — §2-7 · §3-5. DB CHECK 와 1:1. */
export const SNS_TARGET_STATUSES = [
  'draft', 'scheduled', 'claimed', 'submitted', 'published', 'failed', 'cancelled',
] as const;
export type SnsTargetStatus = (typeof SNS_TARGET_STATUSES)[number];

/** post 상태 7 — 자식 집계 파생(§3-5). 직접 쓰지 않고 derivePostStatus 만 쓴다. */
export const SNS_POST_STATUSES = [
  'draft', 'scheduled', 'publishing', 'published', 'partial_failed', 'failed', 'cancelled',
] as const;
export type SnsPostStatus = (typeof SNS_POST_STATUSES)[number];

/** stage — 기록 전용(§2-7). 어떤 분기도 이 값을 읽지 않는다. 사람이 로그를 볼 때만 쓴다. */
export const SNS_TARGET_STAGES = ['container_created', 'container_processing', 'publish_called'] as const;
export type SnsTargetStage = (typeof SNS_TARGET_STAGES)[number];

/** 종결 상태 — 대조 워커가 조회·UPDATE 양쪽에서 제외한다(§3-4 · BUGS 818행 회귀 선례). */
export const SNS_TARGET_TERMINAL: readonly SnsTargetStatus[] = ['published', 'failed', 'cancelled'];

/** 오류 코드 — 화면 사전이 문장으로 바꾼다. 여기 없는 코드는 화면이 일반 문장으로 떨어뜨린다. */
export const SNS_ERROR_CODES = {
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  ACCOUNT_STATE_CHANGED: 'ACCOUNT_STATE_CHANGED',
  MEDIA_FORMAT: 'MEDIA_FORMAT',
  SCHEDULE_EXPIRED: 'SCHEDULE_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  PLATFORM_REJECTED: 'PLATFORM_REJECTED',
  // ★ 2026-09-23 1차-B
  CHANNEL_CLOSED: 'CHANNEL_CLOSED',          // 개방 판정이 닫힘(ENV·실비 상한 해제)
  MONTHLY_CAP: 'MONTHLY_CAP',                // 실비 채널 이번 달 상한(불변 23)
  CONTAINER_FAILED: 'CONTAINER_FAILED',      // 컨테이너 실패 상한 3회(D3)
  PROCESSING_TIMEOUT: 'PROCESSING_TIMEOUT',  // 처리 30분 초과
} as const;

/**
 * post 상태 = 자식 집계 파생 (§3-5). **이 함수가 유일한 계산자다.**
 * 라우트·워커가 각자 계산하면 같은 묶음이 화면마다 다르게 보인다.
 */
export function derivePostStatus(targetStatuses: readonly SnsTargetStatus[]): SnsPostStatus {
  if (targetStatuses.length === 0) return 'draft';
  const has = (s: SnsTargetStatus) => targetStatuses.includes(s);
  const all = (s: SnsTargetStatus) => targetStatuses.every((t) => t === s);

  if (all('draft')) return 'draft';
  if (all('cancelled')) return 'cancelled';
  if (all('published')) return 'published';
  if (has('claimed') || has('submitted')) return 'publishing';
  if (has('published') && has('failed')) return 'partial_failed';
  if (has('scheduled')) return 'scheduled';
  if (has('failed')) return 'failed';
  // 남은 조합(예: published + cancelled) — 진행 중이 없고 성공이 있으면 게시됨으로 본다.
  if (has('published')) return 'published';
  return 'draft';
}

/**
 * ENV 게이팅 — `aiAutoBuildEnabled`(ai-auto-build-materials.ts:53) 미러.
 * 비면 **미노출**(false). `*` = 전 회사. 되돌리기 = ENV 를 비우고 `pm2 restart --update-env`.
 * ⛔ 요금제 판정이 먼저다(§2-16). 이 함수만으로 막으면 FREE 회사가 ENV 에 들면 뚫린다.
 */
export function snsPublishEnabled(
  companyId: string | null | undefined,
  env: string | undefined = process.env.SNS_COMPANY_IDS,
): boolean {
  const list = String(env || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0 || !companyId) return false;
  return list.includes('*') || list.includes(String(companyId));
}

/** OAuth state TTL — 사용자가 플랫폼에 로그인하고 승인까지 걸리는 시간(우커머스 30분 선례). */
export const SNS_OAUTH_STATE_TTL_MS = 30 * 60 * 1000;
