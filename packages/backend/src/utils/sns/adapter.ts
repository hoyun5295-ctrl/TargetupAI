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
