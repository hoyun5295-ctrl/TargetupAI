/**
 * sns/adapter.ts — SNS 채널 어댑터 계약 + 레지스트리 (2026-09-20 S1)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-3.
 *   `IProviderAdapter` 사상 미러(`utils/provider-registry.ts`) — **어댑터가 직접 선언하고 UI 는 추론 0.**
 *   채널 1개 = 파일 1개.
 *
 * S1 범위 = OAuth 4개(authorize·exchange·fetchAccount·refresh) + capabilities 선언.
 * 게시 메서드(createPost·pollContainer·publish·fetchPost)는 S3 에서 `ISnsPublishAdapter` 로 확장한다 —
 * 지금 optional 로 끼워 넣으면 S3 에서 필수로 바꾸는 순간 호출부가 조용히 깨진다.
 */

import type { SnsPlatform } from '../sns-constants';

/**
 * 채널이 무엇을 할 수 있는지 — 화면과 규칙 CT 가 이 값만 본다(추론 0).
 * `GET /api/sns/specs` 가 이 객체를 그대로 직렬화한다.
 */
export interface SnsCapabilities {
  publishImage: boolean;
  publishVideo: boolean;
  publishCarousel: boolean;
  publishStory: boolean;
  /** 컨테이너 생성 → 처리 폴링 → 게시 3단계인가(인스타 릴스). 피드는 false. */
  asyncContainer: boolean;
  maxCaptionChars: number;
  maxTags: number;
  /** 24시간 게시 상한 — 우리 원장 카운트의 기준값. */
  dailyLimit: number;
  /** 게시 전 사용자 명시 동의가 필요한가(2차 틱톡). */
  requiresExplicitConsent: boolean;
  /** 호출마다 실비가 드는가(X) — 조회 재시도 기본 제외. */
  metered: boolean;
  /**
   * 게시 성공을 어떻게 확정하는가.
   *   immediate 게시 직후 건별 재조회
   *   deferred  일 1회 계정 타임라인 대조
   *   none      확인 수단 없음 → `submitted` 가 종착지(화면이 처음부터 그렇게 말한다)
   */
  verify: 'immediate' | 'deferred' | 'none';
  /** 일정 시간 뒤 사라지는가(2차 스토리) — 대조 제외. */
  ephemeral: boolean;
  /** 미디어를 플랫폼이 URL 로 가져가는가(Meta), 우리가 올리는가(X). */
  mediaTransfer: 'pull_url' | 'upload';

  /**
   * ★ 2026-09-21 이미지 규격 — "채널마다 다른 규격을 한 번에 맞춘다"의 근거 값.
   *
   * ⛔ **허용 비율 안이면 원본을 손대지 않는다.** 이 범위는 "변환해도 되는 조건"이 아니라
   *   "변환하면 안 되는 조건"을 정하는 값이다(Harold 확정 2026-09-21 — 원본을 멋대로 자르지 않는다).
   * ⛔ 범위 밖이어도 **자르지 않는다.** 가장 가까운 경계 비율로 캔버스를 만들고 원본을 통째로 넣는다(pad).
   *   가장 가까운 경계라서 여백이 최소가 된다(예: 3:4=0.75 인 포스터는 1:1 이 아니라 4:5=0.8 로 간다).
   */
  imageAspectMin: number;
  imageAspectMax: number;
  /** 게시본 가로 폭 상한(px). 넘으면 비율을 지키며 줄인다. */
  imageMaxWidth: number;
  /** 게시본 용량 상한(byte). 넘으면 JPEG 품질을 낮춰 다시 굽는다. */
  imageMaxBytes: number;
}

export interface SnsOAuthCreds {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** 토큰 교환 결과 — 어댑터가 장기 토큰까지 끝낸 뒤 돌려준다. */
export interface SnsTokenResult {
  accessToken: string;
  /** 플랫폼이 refresh token 을 따로 주는 경우만(Meta 계열은 없음 — 같은 토큰을 갱신한다). */
  refreshToken?: string | null;
  /** 만료 시각. 플랫폼이 `expires_in` 초를 주면 어댑터가 절대 시각으로 바꿔 돌려준다. */
  expiresAt?: Date | null;
  /** 실제로 부여된 권한 문자열(플랫폼이 알려주는 경우만). */
  scope?: string | null;
}

/** 계정 재조회 결과 — `pending → active/ineligible` 판정의 근거(§2-3). */
export interface SnsAccountProfile {
  externalAccountId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /**
   * 게시 자격이 있는가(인스타 = 프로페셔널 계정인가).
   * false 면 `ineligible` + `ineligibleReason` 이 화면 사유가 된다.
   */
  eligible: boolean;
  ineligibleReason?: string | null;
  /** 판정 근거 원문(플랫폼 필드 그대로) — 진단용. meta 에 남긴다. */
  raw?: Record<string, unknown>;
}

export interface ISnsAdapter {
  platform: SnsPlatform;
  /** 화면에 그대로 나가는 이름. 모델명·내부 코드명 금지(§2-18). */
  label: string;
  /** 1차-A 에서 실제로 쓸 수 있는가. false = 화면 칩 `준비 중`. */
  available: boolean;
  capabilities: SnsCapabilities;
  /** 승인 창에서 요청할 권한 — 필요한 것만. 넓게 잡으면 2차 심사가 까다로워진다. */
  scopes: readonly string[];

  buildAuthorizeUrl(creds: SnsOAuthCreds, state: string): string;
  exchangeToken(creds: SnsOAuthCreds, code: string): Promise<SnsTokenResult>;
  fetchAccount(accessToken: string): Promise<SnsAccountProfile>;
  /** 갱신 불가 플랫폼은 null 을 돌려준다(워커가 건너뛴다). */
  refreshToken(creds: SnsOAuthCreds, accessToken: string): Promise<SnsTokenResult | null>;
}

/** 게시 한 건이 플랫폼에 나갈 때 들고 가는 값. 워커가 target 행에서 만들어 넘긴다. */
export interface SnsPublishRequest {
  /** `/me` 가 준 계정 id. ⛔ 대시보드 표시값이 아니다(§1-4) */
  externalAccountId: string;
  accessToken: string;
  /** 규칙 CT 를 통과한 확정본. 워커는 이 값을 만들지 않고 target 행에서 읽어 온다 */
  caption: string;
  format: string;
  /** 플랫폼이 가져갈 공개 URL. **순서가 캐러셀 순서다** */
  mediaUrls: string[];
}

export interface SnsContainerResult {
  containerId: string;
  /** 폴링 없이 바로 게시할 수 있는가(인스타 피드는 즉시 FINISHED · 릴스는 아니다) */
  ready: boolean;
}

export interface SnsContainerStatus {
  /** 플랫폼 원문 상태값(로그·진단용) */
  raw: string;
  ready: boolean;
  /** 되살릴 수 없는 실패(폐기 후 재생성 대상) */
  failed: boolean;
}

export interface SnsFetchedPost {
  exists: boolean;
  permalink: string | null;
  /** 플랫폼 원문(진단용). 저장하지 않는다 */
  raw?: Record<string, unknown>;
}

/**
 * 게시 능력. S1 의 `ISnsAdapter`(연결)와 나눠 둔 이유 = 연결만 되고 게시가 아직인 채널이 실재하기 때문이다.
 * ⛔ `media_url` 류 CDN 주소를 돌려주지 않는다 — 만료 파라미터가 붙어 있어 저장하면 나중에 깨진다(§1-4).
 */
export interface ISnsPublishAdapter extends ISnsAdapter {
  /** 컨테이너(초안)를 만든다. 캐러셀이면 자식부터 만들고 부모를 만든다 */
  createPost(req: SnsPublishRequest): Promise<SnsContainerResult>;
  /** 처리 중인 컨테이너 상태. `ready=false && failed=false` 면 다음 tick 에 다시 본다 */
  pollContainer(req: SnsPublishRequest, containerId: string): Promise<SnsContainerStatus>;
  /** 실제 게시. 여기서 받은 id 가 `platform_post_id` 다 */
  publish(req: SnsPublishRequest, containerId: string): Promise<{ platformPostId: string }>;
  /** 재조회 — **성공은 이것으로만 확정한다**(§2-6). 사라졌으면 `exists:false` */
  fetchPost(req: SnsPublishRequest, platformPostId: string): Promise<SnsFetchedPost>;
}

export function isSnsPublishAdapter(a: ISnsAdapter | null): a is ISnsPublishAdapter {
  return !!a && typeof (a as ISnsPublishAdapter).createPost === 'function';
}

/** 어댑터 호출이 실패했을 때 사유를 들고 올라간다 — catch 에서 사유를 버리지 않기 위한 형(型). */
export class SnsAdapterError extends Error {
  readonly platform: SnsPlatform;
  readonly code: string;
  readonly httpStatus: number | null;
  readonly raw: unknown;

  constructor(platform: SnsPlatform, code: string, message: string, httpStatus: number | null = null, raw: unknown = null) {
    super(message);
    this.name = 'SnsAdapterError';
    this.platform = platform;
    this.code = code;
    this.httpStatus = httpStatus;
    this.raw = raw;
  }
}

/**
 * 플랫폼 응답을 JSON 으로 읽고, 오류면 **사유를 담아** 던진다.
 * ⛔ catch 에서 사유를 버리면 화면에 "실패했습니다"만 남는다(memory feedback_rejection_reasons_must_reach_model_and_log).
 */
export async function readSnsJson(platform: SnsPlatform, res: Response, step: string): Promise<any> {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = body?.error || {};
    const code = String(err.code ?? err.type ?? res.status);
    const msg = String(err.message ?? err.error_message ?? text.slice(0, 300) ?? '');
    throw new SnsAdapterError(platform, `${step}:${code}`, msg || `${step} 실패(HTTP ${res.status})`, res.status, body ?? text.slice(0, 500));
  }
  return body;
}

const REGISTRY = new Map<SnsPlatform, ISnsAdapter>();

export function registerSnsAdapter(adapter: ISnsAdapter): void {
  REGISTRY.set(adapter.platform, adapter);
}

export function getSnsAdapter(platform: SnsPlatform): ISnsAdapter | null {
  return REGISTRY.get(platform) ?? null;
}

/** 등록된 전 어댑터 — `GET /api/sns/specs` · 화면 칩 목록. 선언 순서 = 화면 순서. */
export function listSnsAdapters(): ISnsAdapter[] {
  return Array.from(REGISTRY.values());
}
