/**
 * ★ CT-12: brand-message.ts — 브랜드메시지 발송/검증 컨트롤타워
 *
 * 역할: 카카오 브랜드메시지 발송의 유일한 진입점
 * 적용 파일: campaigns.ts (POST /brand-send·테스트·AI·직접발송) · direct-send-processor.ts
 *
 * ★ 2026-07-30 발송 경로 재구축 — 운영 실체는 QTmsg Agent 방식이다.
 *   알림톡과 같은 라인그룹 `SMSQ_SEND` 테이블에 `msg_type='F'`로 적재한다. 옛 IMC REST 스펙 기반의
 *   `IMC_BM_FREE_BIZ_MSG`/`IMC_BM_BASIC_BIZ_MSG` 적재는 테이블 자체가 실재하지 않아 폐기.
 *   (SoT: docs/2026-07-29-brand-message-qtmsg-agent-design.md)
 *
 * ★ 2026-08-15 경계 규약 정정 — 알림톡과 동일 경계로 통일 (docs/bito-gateway/FEATURE-GW-BRAND-MESSAGE.md §4).
 *   `msg_contents` = 내용물(자유형: 순수 본문 / 기본형: TYPE_DEF+변수 JSON — TYPE_DEF는 게이트웨이
 *   하위호환 경계(absorb)의 전문 식별 마커라 유지) / `k_etc_json` = 제어·부가 필드(senderkey·
 *   CHAT_BUBBLE_TYPE·TARGETING·AD_FLAG·PUSH_ALARM·HEADER·ADDITIONAL_CONTENT·UNSUBSCRIBE_*·ATTACHMENT).
 *   게이트웨이는 이 필드들을 전부 payload(k_etc_json)에서 case-insensitive로 읽는다(payload.go
 *   brandBaseItem·copyPayloadFields 실측). 본문 컬럼에 제어 필드를 섞던 옛 규약은 AD_FLAG 등
 *   누락 결함 4건의 뿌리였다. 기존 적재분(JSON 전문)은 게이트웨이 absorb가 당분간 하위호환 처리.
 *
 * ⛔ 지원 유형 = TEXT·IMAGE·WIDE + ATTACHMENT(버튼·이미지·쿠폰·아이템리스트)뿐.
 *   캐러셀 2종·커머스·비디오·와이드리스트는 msg_contents 상위 조립 예시가 미확보라 입구 차단 —
 *   형식이 어긋나면 큐에는 들어가고 발송만 오류 로그 없이 버려진다(차감은 되고 메시지는 안 감).
 *
 * 참조: 카카오-브랜드메시지-발송매뉴얼.pptx(강문희 2026-01) + attachment_method.pdf
 */

import { insertBrandQueue, BrandQueueInsertError, getCompanySmsTables, type BrandQueueRow } from './sms-queue';
import { prepaidDeduct, prepaidRefund, REFUND_KEYS } from './prepaid';
import { markRefundPending } from './refund-pending';
import { buildUnsubscribeExistsFilter } from './unsubscribe-helper';
import { normalizePhone } from './normalize-phone';
// 발송 가능 시간 판정은 시각 CT가 소유한다(브랜드 창 08:00~20:50 — config/defaults BRAND_SEND_WINDOW).
import { isWithinBrandSendWindow } from './send-time-util';
import { BRAND_SEND_WINDOW } from '../config/defaults';
import { query } from '../config/database';
// ★ 2026-07-03 KAKAO(브랜드메시지) 문안 학습 코퍼스 적재 (전 채널 학습 통합 Phase 2) — fire-and-forget, 발송 무영향
import { logCampaignTraining } from './training-logger';
// ★ 2026-09-01 AI 생성 이미지 표시 — cdp_assets.kind 판정 (설계서 docs/2026-09-01-ai-image-notice-design.md)
import { getAssetByUrl, isAssetsTableMissing, type AssetRow } from './assets';

// ============================================================
// 상수 정의
// ============================================================

/**
 * 메시지 유형 8종 — 값의 출처는 **IMC-Agent 매뉴얼 v2.3.1** 하나다.
 *   본문·헤더·부가정보 = §4.4.1 (자유형 주요 컬럼 세부 가이드)
 *   버튼 개수         = §6.10.3.3 (attachment.button 개수 제약)
 *   쿠폰 설명 길이    = §6.10.7.2
 *   와이드리스트 개수 = §6.10.6 (최소 3, 최대 5)
 *
 * ⛔ 이 표를 추측으로 채우지 마라 — 규격을 벗어난 값은 큐에는 들어가고 발송만 무로그 폐기된다
 *    (차감은 되고 메시지는 안 간다). 값을 바꿀 때는 매뉴얼 절 번호를 함께 남긴다.
 *
 * 필드가 유형마다 다르면 소비처가 `as any` 캐스팅을 하게 되므로 **8종 전부 같은 형태**로 채운다.
 * (해당 없음 = 0 / false)
 */
export interface BrandBubbleSpec {
  code: string;
  label: string;
  /** 본문 최대 글자 수 (0 = 본문 미사용 유형) */
  maxMessage: number;
  /** 본문 최대 줄바꿈 개수 (0 = 본문 미사용) — §4.4.1 */
  maxNewline: number;
  /** 버튼 최대 개수 — §6.10.3.3 */
  maxButtons: number;
  /** 버튼 최소 개수 (COMMERCE만 1) */
  minButtons: number;
  /** 쿠폰을 함께 붙였을 때의 버튼 최대 개수 — TEXT·IMAGE는 5가 아니라 4 */
  couponMaxButtons: number;
  /** 쿠폰 설명 최대 글자 수 — §6.10.7.2 (WIDE 계열 18 / 그 외 12) */
  couponDescMax: number;
  /** 헤더 최대 글자 수 (0 = 헤더 미사용 유형) */
  maxHeader: number;
  requireImage: boolean;
  requireHeader: boolean;
  requireVideo: boolean;
  requireCommerce: boolean;
  /**
   * 와이드 리스트 아이템 개수 (0 = 해당 없음) — §6.10.6.
   * ⛔ 캐러셀은 이 축을 쓰지 않는다 — 카드 수는 인트로 사용 여부로 갈리므로 `carousel`이 소유한다.
   */
  minItems: number;
  maxItems: number;
  /**
   * 버튼명 최대 글자 수 — attachment_method.pdf §3.4 "TEXT, IMAGE - 최대 14자 - 그외 최대 8자".
   * ★2026-08-28 신설. 그전에는 이 축이 없어 화면이 전 유형 14자를 허용했다.
   */
  maxButtonName: number;
  /**
   * 부가 정보(ADDITIONAL_CONTENT) 최대 글자 수 (0 = 사용 불가 유형) — §4.4.1.
   * ★2026-08-28 신설. 그전에는 검사기가 'COMMERCE'와 34/1을 인라인으로 갖고 있었다.
   */
  maxAdditional: number;
  maxAdditionalNewline: number;
  /**
   * 상품명 최대 글자 수 (0 = 커머스 아닌 유형) — attachment_method.pdf §3.4 "상품제목 (최대 30자)".
   * ★2026-08-28 신설. 그전에는 이 축이 없어 검사기가 길이를 아예 안 봤고, 화면만 30을 들고 있었다.
   */
  maxCommerceTitle: number;
  /** 캐러셀 규격 (캐러셀 2종만) — attachment_method.pdf §5.3 */
  carousel?: BrandCarouselSpec;
}

/**
 * 캐러셀 규격 — 출처: attachment_method.pdf **§5.3 CAROUSEL - 브랜드 메시지 자유형**.
 *
 * 구조는 3단이다: `head`(인트로) · `list`(카드) · `tail`(더보기).
 * 카드 하나는 다시 `attachment`(이미지·버튼·쿠폰·커머스)를 품는다.
 *
 * ⛔ 이 표를 추측으로 채우지 마라 — 규격을 벗어난 값은 큐에는 들어가고 발송만 무로그 폐기된다.
 */
export interface BrandCarouselSpec {
  /** 인트로(head) 사용 가능 여부 — 규격상 CAROUSEL_COMMERCE만 */
  allowIntro: boolean;
  /** 인트로 헤더 최대 20자·줄바꿈 불가 */
  introHeaderMax: number;
  /** 인트로 내용 최대 50자·줄바꿈 최대 2개 */
  introContentMax: number;
  introContentNewline: number;
  /** 카드 수 — "캐러셀 인트로 사용시 1~5개, 그 외 2~6개" */
  listMinWithIntro: number;
  listMaxWithIntro: number;
  listMin: number;
  listMax: number;
  /** 카드 헤더 — FEED는 필수, COMMERCE는 사용 불가 */
  itemHeader: 'required' | 'forbidden';
  itemHeaderMax: number;
  /** 카드 메시지 — FEED는 필수, COMMERCE는 사용 불가 */
  itemMessage: 'required' | 'forbidden';
  itemMessageMax: number;
  itemMessageNewline: number;
  /** 카드 부가 정보 — FEED는 사용 불가 */
  itemAdditional: 'allowed' | 'forbidden';
  itemAdditionalMax: number;
  itemAdditionalNewline: number;
  /** 카드당 버튼 최대 개수 */
  itemButtonMax: number;
}

/** 캐러셀 공통값 — 두 유형이 같은 자리는 여기서 한 번만 적는다(§5.3 표) */
const CAROUSEL_COMMON = {
  introHeaderMax: 20,
  introContentMax: 50,
  introContentNewline: 2,
  listMinWithIntro: 1,
  listMaxWithIntro: 5,
  listMin: 2,
  listMax: 6,
  itemHeaderMax: 20,
  itemMessageMax: 180,
  itemMessageNewline: 10,
  itemAdditionalMax: 34,
  itemAdditionalNewline: 1,
  itemButtonMax: 2,
} as const;

export const BUBBLE_TYPES: Record<string, BrandBubbleSpec> = {
  TEXT: { code: 'TEXT', label: '텍스트', maxMessage: 1300, maxNewline: 99, maxButtons: 5, minButtons: 0, couponMaxButtons: 4, couponDescMax: 12, maxHeader: 0, requireImage: false, requireHeader: false, requireVideo: false, requireCommerce: false, minItems: 0, maxItems: 0, maxButtonName: 14, maxAdditional: 0, maxAdditionalNewline: 0, maxCommerceTitle: 0 },
  // IMAGE 줄바꿈 29 = 자유형(§4.4.1) 기준. 기본형(§4.3.1)은 같은 자리를 99로 적어 매뉴얼끼리 갈리는데,
  // 우리가 리치 첨부를 싣는 경로는 자유형뿐이라 좁은 쪽을 택한다(fail-closed).
  IMAGE: { code: 'IMAGE', label: '이미지', maxMessage: 1300, maxNewline: 29, maxButtons: 5, minButtons: 0, couponMaxButtons: 4, couponDescMax: 12, maxHeader: 0, requireImage: true, requireHeader: false, requireVideo: false, requireCommerce: false, minItems: 0, maxItems: 0, maxButtonName: 14, maxAdditional: 0, maxAdditionalNewline: 0, maxCommerceTitle: 0 },
  WIDE: { code: 'WIDE', label: '와이드 이미지', maxMessage: 76, maxNewline: 5, maxButtons: 2, minButtons: 0, couponMaxButtons: 2, couponDescMax: 18, maxHeader: 0, requireImage: true, requireHeader: false, requireVideo: false, requireCommerce: false, minItems: 0, maxItems: 0, maxButtonName: 8, maxAdditional: 0, maxAdditionalNewline: 0, maxCommerceTitle: 0 },
  // ★2026-08-28 아이템 상한 5 → 4 (Harold 확정). 규격 문서 둘이 갈린다:
  //   attachment_method.pdf §3.4 `item.list` = "아이템리스트(최소:3, 최대:4)"
  //   IMC-Agent 매뉴얼 §6.10.6                = 최소 3, 최대 5
  //   5로 보낸 실측이 한 번도 없고, 규격 밖은 무로그 폐기라 **좁은 쪽**을 택한다.
  //   ⛔ 5로 되돌리려면 근거가 문서가 아니라 **실측 1건**이어야 한다.
  WIDE_ITEM_LIST: { code: 'WIDE_ITEM_LIST', label: '와이드 리스트', maxMessage: 0, maxNewline: 0, maxButtons: 2, minButtons: 0, couponMaxButtons: 2, couponDescMax: 18, maxHeader: 20, requireImage: false, requireHeader: true, requireVideo: false, requireCommerce: false, minItems: 3, maxItems: 4, maxButtonName: 8, maxAdditional: 0, maxAdditionalNewline: 0, maxCommerceTitle: 0 },
  // 캐러셀 2종은 카드 수를 `carousel`이 소유한다(인트로 사용 여부로 갈리므로 minItems/maxItems로는 못 적는다).
  CAROUSEL_FEED: {
    code: 'CAROUSEL_FEED', label: '캐러셀 피드', maxMessage: 0, maxNewline: 0,
    maxButtons: 0, minButtons: 0, couponMaxButtons: 0, couponDescMax: 12, maxHeader: 0,
    requireImage: false, requireHeader: false, requireVideo: false, requireCommerce: false,
    minItems: 0, maxItems: 0, maxButtonName: 8, maxAdditional: 0, maxAdditionalNewline: 0, maxCommerceTitle: 0,
    carousel: {
      ...CAROUSEL_COMMON,
      allowIntro: false,          // §5.3 head = "CAROUSEL_COMMERCE 인 경우 사용"
      itemHeader: 'required',     // §5.3 "Header 필드 필수 - CAROUSEL_FEED"
      itemMessage: 'required',    // §5.3 "Message 필드 필수 - CAROUSEL_FEED"
      itemAdditional: 'forbidden' // §5.3 "additional_content 필드 사용불가: CAROUSEL_FEED"
    },
  },
  // PREMIUM_VIDEO의 HEADER·MESSAGE는 §4.4.1에서 둘 다 "선택"이다(옛 표는 헤더를 필수로 잘못 적고 있었다).
  PREMIUM_VIDEO: { code: 'PREMIUM_VIDEO', label: '프리미엄 동영상', maxMessage: 76, maxNewline: 5, maxButtons: 1, minButtons: 0, couponMaxButtons: 1, couponDescMax: 18, maxHeader: 20, requireImage: false, requireHeader: false, requireVideo: true, requireCommerce: false, minItems: 0, maxItems: 0, maxButtonName: 8, maxAdditional: 0, maxAdditionalNewline: 0, maxCommerceTitle: 0 },
  COMMERCE: { code: 'COMMERCE', label: '커머스', maxMessage: 0, maxNewline: 0, maxButtons: 2, minButtons: 1, couponMaxButtons: 2, couponDescMax: 12, maxHeader: 0, requireImage: true, requireHeader: false, requireVideo: false, requireCommerce: true, minItems: 0, maxItems: 0, maxButtonName: 8, maxAdditional: 34, maxAdditionalNewline: 1, maxCommerceTitle: 30 },
  CAROUSEL_COMMERCE: {
    code: 'CAROUSEL_COMMERCE', label: '캐러셀 커머스', maxMessage: 0, maxNewline: 0,
    maxButtons: 0, minButtons: 0, couponMaxButtons: 0, couponDescMax: 12, maxHeader: 0,
    requireImage: false, requireHeader: false, requireVideo: false, requireCommerce: true,
    minItems: 0, maxItems: 0, maxButtonName: 8, maxAdditional: 0, maxAdditionalNewline: 0, maxCommerceTitle: 30,
    carousel: {
      ...CAROUSEL_COMMON,
      allowIntro: true,
      itemHeader: 'forbidden',    // §5.3 "Header 필드 사용불가 - CAROUSEL_COMMERCE"
      itemMessage: 'forbidden',   // §5.3 "Message 필드 사용불가 - CAROUSEL_COMMERCE"
      itemAdditional: 'allowed'
    },
  },
};

export type BubbleTypeCode = keyof typeof BUBBLE_TYPES;

/**
 * 버튼 타입 — 필수 파라미터 출처 = 매뉴얼 §6.10.3.2.
 * `type`은 표의 키 자체라 requiredFields에 다시 적지 않는다.
 */
export interface BrandButtonSpec {
  code: string;
  label: string;
  requiredFields: readonly string[];
  /** "다음 중 N개 이상" 규칙 (AL 전용) */
  anyOf?: { count: number; fields: readonly string[] };
  /** 이 버튼을 쓸 수 있는 타겟팅 (AC 전용 — M·N만 가능) */
  targetingOnly?: readonly string[];
  /** 버튼명이 고정·선택지로 정해진 유형 */
  allowedNames?: readonly string[];
}

export const BUTTON_TYPES: Record<string, BrandButtonSpec> = {
  WL: { code: 'WL', label: '웹링크', requiredFields: ['name', 'url_mobile'] },
  AL: { code: 'AL', label: '앱링크', requiredFields: ['name'], anyOf: { count: 2, fields: ['scheme_android', 'scheme_ios', 'url_mobile'] } },
  BK: { code: 'BK', label: '봇키워드', requiredFields: ['name'] },
  MD: { code: 'MD', label: '메시지전달', requiredFields: ['name'] },
  BF: { code: 'BF', label: '비즈니스폼', requiredFields: ['name', 'biz_form_key'], allowedNames: ['톡에서 예약하기', '톡에서 설문하기', '톡에서 응모하기'] },
  BC: { code: 'BC', label: '상담톡전환', requiredFields: ['name'] },
  BT: { code: 'BT', label: '봇전환', requiredFields: ['name'] },
  AC: { code: 'AC', label: '채널추가', requiredFields: ['name'], targetingOnly: ['M', 'N'], allowedNames: ['채널 추가'] },
};

/**
 * 타겟팅 옵션.
 * ⚠ `N`의 뜻은 매뉴얼 v2.3.1 안에서 서로 반대로 적혀 있다 —
 *   §4.4.1 "마수동 회원 중 채널 친구 **제외**" ↔ §5.4.6 표 "마수동 유저 중 **채널 친구**".
 *   아래 라벨은 §4.4.1을 따르고 있으며, 휴머스온 회신으로 확정되면 라벨·설명을 함께 고친다.
 *   (문의 원장 = docs/bito-gateway/FEATURE-GW-BRAND-MESSAGE.md §6)
 */
export const TARGETING_OPTIONS = {
  M: { code: 'M', label: '마수동 전체', description: '마케팅 수신동의 전체' },
  N: { code: 'N', label: '비친구만', description: '마수동 중 채널 친구 제외' },
  I: { code: 'I', label: '채널 친구', description: '광고주 지정 대상 중 채널 친구만' },
} as const;

/** 대체 발송 타입 (사용자 화면 축 — 큐 코드로는 resolveBrandFallback이 변환한다) */
export const RESEND_TYPES = {
  NO: '없음',
  SM: 'SMS',
  LM: 'LMS',
  MM: 'MMS',
} as const;

/**
 * ★ 2026-07-30 지원 유형 게이트 — msg_contents SQL 조립 예시가 확보된 유형만 개방.
 * 나머지는 "조용한 실패"(큐 적재 후 무로그 폐기) 구조라 추측 조립 금지. 확장은 실예시 확보 후.
 */
/**
 * 발송이 열린 유형 원장 — ★2026-08-28 배열 상수에서 원장으로 승격.
 *
 * **실측 1건(REPORT `0000`)을 통과한 유형만 넣는다.** 규격을 구현했다는 것은 여기 넣을 근거가 아니다.
 * 형식이 어긋나면 큐에는 들어가고 발송만 무로그 폐기되므로(파일 머리 ⛔), 열어 둔 유형이 틀리면
 * **차감만 남고 메시지는 사라진다.** 그래서 유형을 열 때 `since`와 `note`를 함께 적게 만들었다.
 *
 * ⛔ 5종을 한 번에 넣지 마라 — 유형 하나 실측 → 그 유형만 추가가 이 원장의 사용법이다.
 */
export const BUBBLE_TYPE_OPENED: Record<string, { since: string; note: string }> = {
  TEXT:  { since: '2026-08-18', note: 'REPORT 0000 단말 실수신 (MSG_UID 9자리 확정 직후)' },
  IMAGE: { since: '2026-07-30', note: '발송 스펙 확보분' },
  WIDE:  { since: '2026-07-30', note: '발송 스펙 확보분' },
};

export const SUPPORTED_BUBBLE_TYPES: readonly string[] = Object.keys(BUBBLE_TYPE_OPENED);

export function isSupportedBubbleType(t: any): boolean {
  return (SUPPORTED_BUBBLE_TYPES as readonly string[]).includes(String(t || '').trim().toUpperCase());
}

const UNSUPPORTED_BUBBLE_MSG = (t: string) =>
  `브랜드메시지 '${t}' 유형은 아직 지원하지 않습니다 (TEXT·IMAGE·WIDE만 발송 가능)`;

// ============================================================
// SMSQ 적재 규약 조립 + 대체발송 매핑 (2026-08-15 경계 규약 정정)
// msg_contents = 내용물 / k_etc_json = 제어·부가 필드 — 파일 머리 주석이 규약을 소유
// ============================================================

export interface BrandQueuePayloadParams {
  typeDef: 'FREE' | 'BASIC_TCD' | 'BASIC_VAR';
  /** 발신프로필 키 — k_etc_json senderkey(알림톡과 동일 키). 브랜드는 템플릿 도출이 없어 항상 필수 */
  senderKey: string;
  targeting: string;                    // M | N | I
  bubbleType: string;                   // TEXT | IMAGE | WIDE
  /** 광고 여부 — 사용자 선택값 그대로 AD_FLAG로 싣는다(게이트웨이 기본값에 맡기지 않는다) */
  isAd: boolean;
  /** 발송 시 푸시 알림 — 입력 축이 아직 없어 전 경로 기본 true(Y 명시 전송) */
  pushAlarm?: boolean;
  header?: string | null;
  additionalContent?: string | null;
  message?: string | null;              // FREE 필수 (BASIC_xxx에는 넣지 않는다 — 매뉴얼)
  attachmentJson?: string | null;       // 조립된 ATTACHMENT JSON 문자열 (buildAttachmentJson 산출물)
  carouselJson?: string | null;         // ⛔ 값이 있으면 즉시 거부 (캐러셀 미지원)
  messageVariableJson?: string | null;  // BASIC_VAR 전용
  couponVariableJson?: string | null;   // BASIC_VAR 전용
  /** 무료수신거부 — 매뉴얼 §2.2.2: M/N 타겟팅은 필수 */
  unsubscribePhone?: string | null;
  unsubscribeAuth?: string | null;
  /**
   * 이 건이 실제로 나갈 시각 — 발송 가능 시간(08:00~20:50 KST) 판정용.
   * 미지정 = 즉시 발송(현재 시각). 예약·분할 경로는 계산된 시각을 그대로 넘긴다.
   */
  sendAt?: Date | string | null;
  /**
   * 이 건이 **지금 나가는가**(예약이 아닌가). 마감 여유 적용 여부를 가른다.
   * 미지정이면 sendAt이 비었는지로 판단한다 — 다만 즉시발송도 시각을 고정해 넘기는 경로가 있어
   * (검증 시각 = 적재 시각을 맞추려고) 그 경로는 이 값을 명시해야 한다.
   */
  immediate?: boolean;
}

export interface BrandQueuePayload {
  /** SMSQ msg_contents — 자유형은 순수 본문, 기본형은 TYPE_DEF+변수 JSON */
  msgContents: string;
  /** SMSQ k_etc_json — 제어·부가 필드 JSON */
  etcJson: string;
}

/** k_etc_json 컬럼 실측 한도 — SMSQ_SEND_1x varchar(1024). 초과분은 적재가 깨지므로 적재 전에 막는다. */
const K_ETC_JSON_MAX = 1024;

export class BrandMessageBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrandMessageBuildError';
  }
}

function parseJsonOrThrow(raw: string, label: string): any {
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') throw new Error('object 아님');
    return v;
  } catch {
    // 깨진 JSON을 그대로 실으면 게이트웨이가 무로그 폐기한다 — 적재 전에 막는다(fail-closed).
    throw new BrandMessageBuildError(`브랜드메시지 ${label} 형식이 올바르지 않습니다 (JSON 파싱 실패)`);
  }
}

/**
 * SMSQ 적재 규약 단일 조립기 — msg_contents(내용물)와 k_etc_json(제어·부가)을 반드시 한 쌍으로 만든다.
 * 두 컬럼을 따로 조립하면 경계마다 규약이 갈라지는 결함(§4-4)이 재발하므로 출구를 하나로 고정한다.
 * 형식 위반은 발송 단계에서 오류 로그도 없이 버려지므로, 여기서 전부 throw로 막는다.
 */
export function buildBrandQueuePayload(p: BrandQueuePayloadParams): BrandQueuePayload {
  const senderKey = String(p.senderKey || '').trim();
  if (!senderKey) {
    throw new BrandMessageBuildError('브랜드메시지 발신프로필 키(senderKey)가 없습니다');
  }
  const bubble = String(p.bubbleType || '').trim().toUpperCase();
  if (!isSupportedBubbleType(bubble)) {
    throw new BrandMessageBuildError(UNSUPPORTED_BUBBLE_MSG(bubble || '(없음)'));
  }
  // ★2026-08-28 캐러셀 입구 개방 — 상위 조립 규격을 확보했다(attachment_method.pdf §5.3).
  //   그전에는 값이 있으면 무조건 거부했다("조립 예시 미확보"). 지금은 유형이 캐러셀일 때만 받는다.
  //   ⛔ 캐러셀이 아닌 유형에 캐러셀이 실려 오면 여전히 거부다 — 규격 밖 필드는 무로그 폐기를 부른다.
  const carouselSpec = BUBBLE_TYPES[bubble]?.carousel;
  const hasCarouselInput = !!(p.carouselJson && String(p.carouselJson).trim() !== '');
  if (hasCarouselInput && !carouselSpec) {
    throw new BrandMessageBuildError(`${BUBBLE_TYPES[bubble]?.label || bubble}은 캐러셀을 사용하지 않습니다`);
  }
  if (carouselSpec && !hasCarouselInput) {
    throw new BrandMessageBuildError(`${BUBBLE_TYPES[bubble]?.label || bubble}: 캐러셀 카드가 필요합니다`);
  }
  const targeting = String(p.targeting || '').trim().toUpperCase();
  if (!['M', 'N', 'I'].includes(targeting)) {
    throw new BrandMessageBuildError(`브랜드메시지 대상 범위(TARGETING)가 올바르지 않습니다: ${p.targeting}`);
  }

  // 매뉴얼 §2.2.2 — M/N 타겟팅은 무료수신거부 번호 필수. 없으면 발송 단계에서 무로그 거절되므로 적재 전에 막는다.
  const unsubPhone = String(p.unsubscribePhone || '').trim();
  const unsubAuth = String(p.unsubscribeAuth || '').trim();
  if ((targeting === 'M' || targeting === 'N') && !unsubPhone) {
    throw new BrandMessageBuildError('마수동(M/N) 대상 발송은 무료수신거부 번호가 필요합니다. 수신거부 번호를 입력하거나 대상 범위를 채널 친구로 바꿔주세요');
  }

  // ── msg_contents = 내용물 ──
  let msgContents: string;
  if (p.typeDef === 'FREE') {
    const message = String(p.message || '').trim();
    // ★2026-08-28 본문 필수를 **유형 기준**으로 바꿨다(그전에는 자유형이면 무조건 필수).
    //   와이드리스트·커머스·캐러셀 2종은 규격상 본문이 없는 유형이라(§4.4.1 · §5.3 `maxMessage: 0`)
    //   여기서 막히면 조립 자체가 불가능했다. 5종 개통을 막고 있던 자리 중 하나다.
    //   ⛔ 본문 미사용 유형은 msg_contents를 **비운 채로** 적재한다 — 게이트웨이 인계 계약(§6-1):
    //      게이트웨이 brandBaseItem이 `firstNonEmpty(payload.MESSAGE, req.Message)`로 채우므로,
    //      여기서 비워야 규격상 message 사용불가인 CAROUSEL_COMMERCE에 값이 실리지 않는다.
    if (BUBBLE_TYPES[bubble].maxMessage > 0 && !message) {
      throw new BrandMessageBuildError('브랜드메시지 본문이 비어 있습니다');
    }
    msgContents = BUBBLE_TYPES[bubble].maxMessage > 0 ? message : '';
  } else {
    // 기본형: 내용은 템플릿(k_template_code)이 담당 — MESSAGE 키를 넣지 않는다(매뉴얼).
    // TYPE_DEF는 게이트웨이 하위호환 경계(absorb)의 전문 식별 마커라 유지한다.
    const contents: Record<string, any> = { TYPE_DEF: p.typeDef };
    if (p.typeDef === 'BASIC_VAR') {
      if (p.messageVariableJson) contents.MESSAGE_VARIABLE = parseJsonOrThrow(p.messageVariableJson, '변수(MESSAGE_VARIABLE)');
      if (p.couponVariableJson) contents.COUPON_VARIABLE = parseJsonOrThrow(p.couponVariableJson, '쿠폰 변수(COUPON_VARIABLE)');
      if (!contents.MESSAGE_VARIABLE && !contents.COUPON_VARIABLE) {
        throw new BrandMessageBuildError('기본형 변수세팅(BASIC_VAR)인데 변수 값이 없습니다');
      }
    }
    msgContents = JSON.stringify(contents);
  }

  // ── k_etc_json = 제어·부가 필드 (필수 키는 게이트웨이 기본값에 맡기지 않고 전부 명시) ──
  const etc: Record<string, any> = {
    senderkey: senderKey,
    CHAT_BUBBLE_TYPE: bubble,
    TARGETING: targeting,
    AD_FLAG: p.isAd ? 'Y' : 'N',
    PUSH_ALARM: p.pushAlarm === false ? 'N' : 'Y',
  };
  const header = String(p.header || '').trim();
  if (header) etc.HEADER = header;
  const additional = String(p.additionalContent || '').trim();
  if (additional) etc.ADDITIONAL_CONTENT = additional;
  if (unsubPhone) etc.UNSUBSCRIBE_PHONE_NUMBER = unsubPhone;
  if (unsubAuth) etc.UNSUBSCRIBE_AUTH_NUMBER = unsubAuth;
  if (p.attachmentJson && String(p.attachmentJson).trim() !== '') {
    etc.ATTACHMENT = parseJsonOrThrow(p.attachmentJson, '첨부(ATTACHMENT)');
  }
  // 캐러셀은 ATTACHMENT와 형제 키다(게이트웨이 payload.go가 `CAROUSEL`을 따로 읽는다).
  if (hasCarouselInput) {
    etc.CAROUSEL = parseJsonOrThrow(String(p.carouselJson), '캐러셀(CAROUSEL)');
  }

  // ── 규격 검사 — 조립될 실제 값으로 판정한다(호출부 6곳이 같은 판정을 받는 자리) ──
  assertBrandContentSpec({
    bubble,
    spec: BUBBLE_TYPES[bubble],
    targeting,
    isFreeForm: p.typeDef === 'FREE',
    message: p.typeDef === 'FREE' ? String(p.message || '').trim() : '',
    header,
    additionalContent: additional,
    attachment: etc.ATTACHMENT ?? null,
    carousel: etc.CAROUSEL ?? null,
  });

  // ── 발송 가능 시간 (KST 08:00~20:50) — 매뉴얼 v2.3.1 §3.9.1 ──
  //   창 밖은 카카오가 3022로 폐기하는데 그때는 이미 차감된 뒤다. 적재 전에 막는다.
  //   sendAt 미지정 = 즉시 발송이므로 지금 시각으로 판정한다.
  //   즉시 발송(sendAt 미지정)은 **마감 여유**를 둔다 — 조립 시점엔 창 안이어도 차감·적재를 지나는
  //   동안 20:50을 넘기면 문자만 나가고 브랜드는 금지 시각에 적재된다. 예약 시각은 사용자가 고른
  //   계약이라 여유를 깎지 않는다.
  const sendAt = toSendAtDate(p.sendAt);
  //   **지난 시각은 곧 즉시 발송이다** — 큐는 도래한 행을 바로 집는다. 과거 예약값을 그대로 믿고
  //   'immediate=false'로 두면 새벽 3시에 전날 10시를 넣어 가드를 통과시킬 수 있다(0818 5R).
  //   **마감 코앞의 예약도 같다** — 20:49:58에 20:49:59를 예약하면 검사는 통과하지만 수신거부 조회·
  //   차감·적재를 지나는 동안 20:50을 넘긴다. 여유 안에 든 예약은 즉시 건과 똑같이 취급한다(0818 6R).
  //   여유 값은 설정에서 이미 정규화됐다(유한한 0 이상 정수) — 여기서 다시 손대면 두 판정이 갈린다.
  const marginMinutes = BRAND_SEND_WINDOW.immediateMarginMinutes;
  const marginMs = marginMinutes * 60_000;
  const isPast = sendAt.getTime() <= Date.now();
  const isNearNow = sendAt.getTime() - Date.now() <= marginMs;
  const isImmediate = isNearNow
    || (p.immediate ?? (p.sendAt === undefined || p.sendAt === null || String(p.sendAt).trim() === ''));
  //   과거 시각이면 판정 기준도 '지금'이어야 한다 — 지난 시각으로 창을 재면 늘 통과한다.
  const judgeAt = isPast ? new Date() : sendAt;
  if (!isWithinBrandSendWindow(judgeAt, isImmediate ? marginMinutes : 0)) {
    throw new BrandMessageBuildError(
      '브랜드메시지는 오전 8시부터 저녁 8시 50분 사이에만 발송할 수 있습니다. 발송 시각을 조정해주세요'
    );
  }

  const etcJson = JSON.stringify(etc);
  if (etcJson.length > K_ETC_JSON_MAX) {
    throw new BrandMessageBuildError(`브랜드메시지 부가 정보가 너무 깁니다 (${etcJson.length}자, 최대 ${K_ETC_JSON_MAX}자). 버튼·링크 길이를 줄여주세요`);
  }

  return { msgContents, etcJson };
}

/**
 * sendAt 파라미터 정규화 — 호출부마다 타입이 다르다(Date · KST 문자열 · undefined).
 * 빈 값 = 즉시 발송이므로 현재 시각. 못 읽는 값은 throw해서 조용히 "지금"으로 흐르지 않게 한다.
 */
function toSendAtDate(v: Date | string | null | undefined): Date {
  // ★ 런타임 타입을 먼저 좁힌다 — 예전에는 `!v`가 false·0을, `String([])`가 빈 배열을 삼켜
  //   **잘못된 값이 조용히 "지금"으로 강등**됐다. 즉시 발송으로 허용하는 것은 미지정뿐이다.
  if (v === undefined || v === null) return new Date();
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new BrandMessageBuildError('발송 예약 시각을 읽을 수 없습니다');
    return v;
  }
  if (typeof v !== 'string') throw new BrandMessageBuildError('발송 예약 시각을 읽을 수 없습니다');
  const raw = v.trim();
  if (!raw) return new Date();

  // ① 'YYYY-MM-DD HH:mm(:ss)' = KST 벽시계 문자열(toKoreaTimeStr 산출물). +09:00을 붙여 읽는다.
  //    구분자는 **공백만** 받는다 — 'T'까지 받으면 오프셋 없는 ISO(2026-08-18T10:00)가
  //    아래 오프셋 검사를 우회해 KST로 통과한다(같은 값이 서버 표준시에 따라 다르게 해석됨).
  //    달력 유효성도 본다 — 2026-02-31이 3월로 정규화돼 조용히 통과하면 안 된다.
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (m) {
    const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) {
      throw new BrandMessageBuildError('발송 예약 시각을 읽을 수 없습니다');
    }
    const utc = new Date(Date.UTC(y, mo - 1, d, h - 9, mi, s));
    // KST로 되돌려 입력과 같은 달력값이 나오는지 본다 — 2026-02-31처럼 없는 날짜가
    // 3월로 정규화돼 조용히 통과하는 것을 막는다.
    const back = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
    const sameDate = back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d
      && back.getUTCHours() === h && back.getUTCMinutes() === mi && back.getUTCSeconds() === s;
    if (!sameDate) throw new BrandMessageBuildError('발송 예약 시각을 읽을 수 없습니다');
    return utc;
  }

  // ② 그 외 문자열은 **오프셋이 명시된 ISO만** 받는다. 오프셋 없는 ISO를 new Date에 넘기면
  //    서버 표준시에 따라 다른 시각으로 해석돼 같은 값이 KST 서버에서는 통과하고 UTC 서버에서는 거절된다.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    throw new BrandMessageBuildError('발송 예약 시각을 읽을 수 없습니다');
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new BrandMessageBuildError('발송 예약 시각을 읽을 수 없습니다');
  return parsed;
}

/** 브랜드 큐 전환재발송 코드 — 'S'/'L'(원문 그대로)은 본문이 JSON이라 불가. N/A/B만. */
export type BrandNextType = 'N' | 'A' | 'B';

export interface ResolvedBrandFallback {
  nextType: BrandNextType;
  nextContents?: string;
  titleStr?: string;
}

/**
 * 화면 축(NO/SM/LM/MM) → 큐 축(N/A/B) 변환.
 * 브랜드는 원문 그대로 전환(S/L)이 불가하므로 A/B는 대체 문구가 필수다 —
 * 사용자가 대체문안을 안 썼으면 순수 본문(originalMessage)을 그대로 쓴다(알림톡 0727 계약과 동일 방향).
 */
export function resolveBrandFallback(input: {
  resendType?: string | null;
  resendMessage?: string | null;
  resendTitle?: string | null;
  originalMessage?: string | null;
}): ResolvedBrandFallback {
  const raw = String(input.resendType || 'NO').trim().toUpperCase();
  const mapped: BrandNextType | 'MM' | null =
    raw === 'NO' || raw === 'N' || raw === '' ? 'N'
    : raw === 'SM' || raw === 'A' ? 'A'
    : raw === 'LM' || raw === 'B' ? 'B'
    : raw === 'MM' ? 'MM'
    : null;
  if (mapped === 'MM') {
    throw new BrandMessageBuildError('브랜드메시지는 MMS 대체발송을 지원하지 않습니다 (SMS·LMS만 가능)');
  }
  if (!mapped) {
    throw new BrandMessageBuildError(`브랜드메시지 대체발송 유형이 올바르지 않습니다: ${input.resendType}`);
  }
  if (mapped === 'N') return { nextType: 'N' };

  const contents = String(input.resendMessage || '').trim() || String(input.originalMessage || '').trim();
  if (!contents) {
    throw new BrandMessageBuildError('대체발송 문구가 없습니다. 대체문안을 입력하거나 대체발송을 끄세요');
  }
  if (mapped === 'B') {
    const title = String(input.resendTitle || '').trim();
    if (!title) throw new BrandMessageBuildError('LMS 대체발송은 제목이 필요합니다');
    return { nextType: 'B', nextContents: contents, titleStr: title };
  }
  return { nextType: 'A', nextContents: contents };
}

// ============================================================
// 인터페이스
// ============================================================

export interface BrandButton {
  name: string;
  type: string; // WL, AL, BK, MD, BF, BC, BT, AC
  url_mobile?: string;
  url_pc?: string;
  scheme_android?: string;
  scheme_ios?: string;
  biz_form_key?: string;
}

export interface BrandImage {
  img_url: string;
  img_link?: string;
  /**
   * ★ 2026-09-01 AI 생성 이미지 판정용(전략 A) — 라이브러리에서 고른 cdp_assets.id.
   * 카카오 전문에는 실리지 않는다(buildAttachmentBody가 img_url·img_link만 투영).
   */
  asset_id?: string;
}

/**
 * 쿠폰 — 매뉴얼 §6.10.7. 클릭 URL은 쿠폰 객체 **바로 아래 평면 키**다.
 * ⛔ `link: { url_mobile }` 래핑은 규격에 없다(0818 정정 — 규격 밖 키라 클릭이 전달되지 않았다).
 * `description`은 매뉴얼상 필수(O)이며 길이는 유형별로 다르다(BUBBLE_TYPES.couponDescMax).
 */
export interface BrandCoupon {
  title: string;
  description: string;
  url_mobile?: string;
  url_pc?: string;
  scheme_android?: string;
  scheme_ios?: string;
}

/** 커머스 — 매뉴얼 §6.10.8. `currency_unit`은 규격에 없어 제거했고 `discount_fixed`가 규격 키다. */
export interface BrandCommerce {
  title: string;
  regular_price: number;
  discount_price?: number;
  discount_rate?: number;
  discount_fixed?: number;
}

export interface BrandVideo {
  video_url: string; // https://tv.kakao.com/v/{id}
  thumbnail_url?: string;
}

/**
 * 와이드 리스트 아이템 — 매뉴얼 §6.10.6.
 * 1번째만 title 선택이고 2~5번째는 필수. `description`·`link`는 규격에 없는 키라 제거했다.
 */
export interface BrandItemListItem {
  title?: string;
  img_url: string;
  url_mobile: string;
  url_pc?: string;
  scheme_android?: string;
  scheme_ios?: string;
}

export interface CarouselItem {
  header?: string;
  message?: string;
  additional_content?: string;
  attachment?: {
    button?: BrandButton[];
    image?: BrandImage;
    coupon?: BrandCoupon;
    commerce?: BrandCommerce;
  };
}

export interface BrandMessageParams {
  // 필수
  bubbleType: BubbleTypeCode;
  senderKey: string;
  phones: string[];
  targeting: string;
  isAd: boolean;
  companyId: string;
  userId: string;

  // 메시지 내용
  message?: string;
  header?: string;
  additionalContent?: string;

  // 리치 요소
  buttons?: BrandButton[];
  image?: BrandImage;
  coupon?: BrandCoupon;
  commerce?: BrandCommerce;
  video?: BrandVideo;
  itemList?: BrandItemListItem[];

  // 캐러셀
  carouselHead?: { header?: string; description?: string; img_url?: string; img_link?: string };
  carouselItems?: CarouselItem[];
  carouselTail?: { link?: { url_mobile: string; url_pc?: string } };

  // 대체 발송
  resendType?: string;
  resendFrom?: string;
  resendMessage?: string;
  resendTitle?: string;

  // 수신거부
  unsubscribePhone?: string;
  unsubscribeAuth?: string;

  // 예약
  reservedDate?: string;

  // 추적
  campaignId?: string;
}

export interface BrandTemplateParams extends BrandMessageParams {
  templateCode: string;
  messageVariableJson?: string;
  buttonVariableJson?: string;
  couponVariableJson?: string;
  imageVariableJson?: string;
  videoVariableJson?: string;
  commerceVariableJson?: string;
  carouselVariableJson?: string;
}

// ============================================================
// 규격 검사 — 매뉴얼 v2.3.1 정합 (조립기 전용 · 외부 노출 없음)
// ============================================================
//
// ★ 2026-08-18 구조 정정. 예전에는 `validateBrandMessage`가 조립기 **밖**에 따로 있었고
//   6개 호출부 중 `/brand-send` 자유형 1곳만 그것을 불렀다 — 나머지 5곳(테스트발송·AI캠페인·
//   직접발송·예약청크·기본형)은 길이도 버튼도 검사 없이 큐로 갔다. 경로마다 판정이 갈리는 것이
//   결함의 뿌리였으므로 **검사를 조립기 안으로 넣어** 조립을 부르는 순간 반드시 통과하게 만든다.
//   덧댄 게이트는 함께 사라졌다(호출부에 검사를 하나씩 붙이는 방식은 다시 쓰지 않는다).

/** 코드포인트 기준 글자 수 — 이모지(서로게이트 쌍)를 2자로 세지 않는다. */
function charLen(s: string): number {
  return [...s].length;
}

function newlineCount(s: string): number {
  return (s.match(/\n/g) || []).length;
}

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

/**
 * ★ 2026-08-18 타입 fail-open 차단.
 * 예전에는 첨부를 `typeof === 'object'`로만 보고 필드를 `String(x)`로 강제했다. 그래서
 *   · `ATTACHMENT: []`  → 배열도 object라 "첨부 없음"으로 면제받고 배열 그대로 전송
 *   · `img_url: {}`     → `'[object Object]'`가 되어 필수값 검사를 통과
 *   · `coupon: 'x'`     → 쿠폰 없음으로 간주돼 검증을 피하고 원본에는 남음
 * 셋 다 "검사는 통과하고 카카오에서 버려지는" 모양이라 여기서 타입부터 못 박는다.
 */
function plainObjectOrThrow(v: any, label: string): Record<string, any> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new BrandMessageBuildError(`${label} 형식이 올바르지 않습니다`);
  }
  return v as Record<string, any>;
}

/** 문자열 필드 — 문자열이 아닌 값이 오면 강제 변환하지 않고 거절한다. */
function strFieldOrThrow(v: any, label: string): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  throw new BrandMessageBuildError(`${label} 형식이 올바르지 않습니다`);
}

/**
 * 조립 직전 규격 검사 — 위반은 전부 throw(fail-closed).
 * 검사 대상은 **조립될 실제 값**이다(파싱된 ATTACHMENT 포함) — 타입 파라미터로 들어오든
 * 이미 만들어진 JSON 문자열로 들어오든 같은 판정을 받게 하려는 것이다.
 */
function assertBrandContentSpec(input: {
  bubble: string;
  spec: BrandBubbleSpec;
  targeting: string;
  isFreeForm: boolean;
  message: string;
  header: string;
  additionalContent: string;
  attachment: any;
  carousel?: any;
}): void {
  const { spec, targeting, isFreeForm, message, header, additionalContent, attachment } = input;
  const label = spec.label;

  // ── 본문 (자유형만 — 기본형 본문은 템플릿이 담당한다) ─────────────────
  //   ★2026-08-28 `maxMessage === 0`(본문 미사용 유형)에 본문이 실려 오는 경우를 막는다.
  //   그전에는 `> 0`일 때만 검사해서, 본문을 쓰지 않는 유형에 값이 들어와도 그대로 통과했다.
  //   특히 CAROUSEL_COMMERCE는 §5.3이 message를 **사용불가**로 못 박은 유형이다.
  if (isFreeForm) {
    if (spec.maxMessage === 0) {
      if (message) {
        throw new BrandMessageBuildError(`${label}은 본문을 사용하지 않습니다`);
      }
    } else {
      if (charLen(message) > spec.maxMessage) {
        throw new BrandMessageBuildError(`${label}: 본문은 최대 ${spec.maxMessage}자입니다 (현재 ${charLen(message)}자)`);
      }
      if (newlineCount(message) > spec.maxNewline) {
        throw new BrandMessageBuildError(`${label}: 줄바꿈은 최대 ${spec.maxNewline}개입니다 (현재 ${newlineCount(message)}개)`);
      }
    }
  }

  // ── 헤더 ─────────────────────────────────────────────────────────────
  if (spec.requireHeader && !header) {
    throw new BrandMessageBuildError(`${label}: 상단 제목이 필요합니다 (최대 ${spec.maxHeader}자)`);
  }
  if (header) {
    if (spec.maxHeader === 0) {
      throw new BrandMessageBuildError(`${label}은 상단 제목을 사용하지 않습니다`);
    }
    if (charLen(header) > spec.maxHeader) {
      throw new BrandMessageBuildError(`${label}: 상단 제목은 최대 ${spec.maxHeader}자입니다 (현재 ${charLen(header)}자)`);
    }
    if (newlineCount(header) > 0) {
      throw new BrandMessageBuildError(`${label}: 상단 제목에는 줄바꿈을 넣을 수 없습니다`);
    }
  }

  // ── 부가 정보 (매뉴얼 §4.4.1) ────────────────────────────────────────
  //   ★2026-08-28 유형 이름과 34/1을 인라인으로 갖고 있던 것을 spec으로 옮겼다.
  //   값이 여기 있으면 유형이 늘 때마다 이 함수를 고쳐야 한다(규격은 BUBBLE_TYPES가 소유).
  if (additionalContent) {
    if (spec.maxAdditional === 0) {
      throw new BrandMessageBuildError(`${label}은 부가 정보를 사용하지 않습니다`);
    }
    if (charLen(additionalContent) > spec.maxAdditional) {
      throw new BrandMessageBuildError(`부가 정보는 최대 ${spec.maxAdditional}자입니다 (현재 ${charLen(additionalContent)}자)`);
    }
    if (newlineCount(additionalContent) > spec.maxAdditionalNewline) {
      throw new BrandMessageBuildError(`부가 정보의 줄바꿈은 ${spec.maxAdditionalNewline}개까지입니다`);
    }
  }

  const att = plainObjectOrThrow(attachment, '첨부(ATTACHMENT)') ?? {};
  if (att.button !== undefined && !Array.isArray(att.button)) {
    throw new BrandMessageBuildError('버튼 형식이 올바르지 않습니다');
  }
  const buttons = asArray(att.button);
  const coupon = plainObjectOrThrow(att.coupon, '쿠폰') ?? null;
  const attImage = plainObjectOrThrow(att.image, '이미지');
  const attVideo = plainObjectOrThrow(att.video, '동영상');
  const attCommerce = plainObjectOrThrow(att.commerce, '상품 정보');
  const attItem = plainObjectOrThrow(att.item, '아이템 목록');

  // ── 이미지·동영상·커머스 ─────────────────────────────────────────────
  //   기본형이 면제받는 것은 **"안 보낸 경우"뿐이다** — 매뉴얼 §5.3.2 "파라미터 미사용 시 템플릿에
  //   등록된 이미지가 발송됩니다". 그래서 자유형은 값이 있어야 하고, 기본형은 없어도 된다.
  //   ⛔ 단 기본형이 **객체를 보냈는데 알맹이가 비어 있으면** 그것은 템플릿 생략이 아니라 잘못된 덮어쓰기다.
  //      통째로 면제하면 그 값이 차감을 거쳐 게이트웨이까지 간다(0818 적대 리뷰 지적 수용).
  const required = (present: boolean, ok: boolean) => (isFreeForm ? ok : (!present || ok));

  if (spec.requireImage && !required(attImage !== undefined, !!strFieldOrThrow(attImage?.img_url, '이미지 주소'))) {
    throw new BrandMessageBuildError(`${label}: 이미지가 필요합니다`);
  }
  if (spec.requireVideo && !required(attVideo !== undefined, !!strFieldOrThrow(attVideo?.video_url, '동영상 주소'))) {
    throw new BrandMessageBuildError(`${label}: 동영상 주소가 필요합니다`);
  }
  if (spec.requireCommerce) {
    const present = attCommerce !== undefined;
    if (!required(present, !!strFieldOrThrow(attCommerce?.title, '상품 제목'))) {
      throw new BrandMessageBuildError(`${label}: 상품 정보가 필요합니다`);
    }
    const priceOk = typeof attCommerce?.regular_price === 'number'
      || (typeof attCommerce?.regular_price === 'string' && attCommerce.regular_price.trim() !== '');
    if (!required(present, priceOk)) {
      throw new BrandMessageBuildError(`${label}: 상품 정상가가 필요합니다`);
    }
    // ★2026-08-28 상품명 길이 — §3.4 "상품제목 (최대 30자)". 그전에는 이 검사가 없었다.
    const cTitle = strFieldOrThrow(attCommerce?.title, '상품 제목');
    if (cTitle && spec.maxCommerceTitle > 0 && charLen(cTitle) > spec.maxCommerceTitle) {
      throw new BrandMessageBuildError(
        `${label}: 상품명은 최대 ${spec.maxCommerceTitle}자입니다 (현재 ${charLen(cTitle)}자)`
      );
    }
  }
  // 버튼 최소 개수는 자유형만 — 기본형은 템플릿이 버튼을 갖는다.
  if (isFreeForm && buttons.length < spec.minButtons) {
    throw new BrandMessageBuildError(`${label}: 버튼이 최소 ${spec.minButtons}개 필요합니다`);
  }
  // §6.10.8 — 할인가를 넣었으면 할인율·정액할인 중 하나는 있어야 한다.
  if (attCommerce && attCommerce.discount_price !== undefined
      && attCommerce.discount_rate === undefined && attCommerce.discount_fixed === undefined) {
    throw new BrandMessageBuildError('할인가를 넣으면 할인율 또는 할인금액 중 하나를 함께 입력해야 합니다');
  }

  // ── 버튼 개수 (§6.10.3.3 — 쿠폰을 함께 쓰면 상한이 줄어든다) ──────────
  const buttonMax = coupon ? spec.couponMaxButtons : spec.maxButtons;
  if (buttons.length > buttonMax) {
    throw new BrandMessageBuildError(
      coupon
        ? `${label}: 쿠폰을 함께 쓰면 버튼은 최대 ${buttonMax}개입니다 (현재 ${buttons.length}개)`
        : `${label}: 버튼은 최대 ${buttonMax}개입니다 (현재 ${buttons.length}개)`
    );
  }
  // ── 버튼 타입별 필수값 (§6.10.3.2) — 실린 버튼은 자유형·기본형 모두 형태가 맞아야 한다 ──
  buttons.forEach((btn: any, i: number) => {
    const at = `${i + 1}번째 버튼`;
    plainObjectOrThrow(btn, at);
    const type = strFieldOrThrow(btn?.type, `${at} 종류`).toUpperCase();
    const btnSpec = BUTTON_TYPES[type];
    if (!btnSpec) throw new BrandMessageBuildError(`${at}: 지원하지 않는 버튼 종류입니다 (${type || '미지정'})`);

    for (const field of btnSpec.requiredFields) {
      if (!strFieldOrThrow(btn?.[field], `${at} ${BUTTON_FIELD_LABEL[field] || field}`)) {
        throw new BrandMessageBuildError(`${at}(${btnSpec.label}): ${BUTTON_FIELD_LABEL[field] || field}이(가) 필요합니다`);
      }
    }
    if (btnSpec.anyOf) {
      const filled = btnSpec.anyOf.fields.filter(f => strFieldOrThrow(btn?.[f], `${at} 값`)).length;
      if (filled < btnSpec.anyOf.count) {
        const names = btnSpec.anyOf.fields.map(f => BUTTON_FIELD_LABEL[f] || f).join(' · ');
        throw new BrandMessageBuildError(`${at}(${btnSpec.label}): ${names} 중 ${btnSpec.anyOf.count}개 이상을 입력해야 합니다`);
      }
    }
    // ★2026-08-28 버튼명 길이 — §3.4 "TEXT, IMAGE - 최대 14자 - 그외 최대 8자".
    //   그전에는 이 축이 없어 8자 유형에도 14자가 통과했다(화면 maxLength가 전 유형 14 고정이었다).
    const btnName = strFieldOrThrow(btn?.name, `${at} 버튼명`);
    if (charLen(btnName) > spec.maxButtonName) {
      throw new BrandMessageBuildError(
        `${at}: 버튼명은 최대 ${spec.maxButtonName}자입니다 (현재 ${charLen(btnName)}자)`
      );
    }
    if (btnSpec.allowedNames && !btnSpec.allowedNames.includes(strFieldOrThrow(btn?.name, `${at} 버튼명`))) {
      throw new BrandMessageBuildError(`${at}(${btnSpec.label}): 버튼명은 ${btnSpec.allowedNames.join(' / ')} 중에서만 쓸 수 있습니다`);
    }
    if (btnSpec.targetingOnly && !btnSpec.targetingOnly.includes(targeting)) {
      throw new BrandMessageBuildError(
        `${btnSpec.label} 버튼은 대상 범위가 ${btnSpec.targetingOnly.map(t => TARGETING_OPTIONS[t as 'M' | 'N' | 'I']?.label || t).join(' 또는 ')}일 때만 사용할 수 있습니다`
      );
    }
  });

  // ── 쿠폰 (§6.10.7) ───────────────────────────────────────────────────
  if (coupon) {
    // 옛 `link` 래핑이 먼저다 — 제목·URL 검사보다 앞에 둬야 "형식이 틀렸다"가 아니라
    // 실제 원인(옛 규약으로 들어왔다)을 알려줄 수 있다.
    if (coupon.link !== undefined) {
      throw new BrandMessageBuildError('쿠폰 링크 형식이 올바르지 않습니다. 쿠폰 URL을 다시 입력해주세요');
    }
    const cTitle = strFieldOrThrow(coupon.title, '쿠폰 제목');
    if (!cTitle) throw new BrandMessageBuildError('쿠폰 제목이 필요합니다');
    if (!isAllowedCouponTitle(cTitle)) {
      throw new BrandMessageBuildError(`쿠폰 제목은 정해진 형식만 쓸 수 있습니다: ${COUPON_TITLE_GUIDE}`);
    }
    // 클릭 대상이 없는 쿠폰은 카카오가 받지 않는다(기본 케이스 url_mobile · 채널쿠폰이면 스킴).
    const hasCouponLink = ['url_mobile', 'scheme_android', 'scheme_ios']
      .some((k) => strFieldOrThrow(coupon[k], '쿠폰 링크'));
    if (!hasCouponLink) throw new BrandMessageBuildError('쿠폰을 넣으려면 쿠폰 URL이 필요합니다');
    const desc = strFieldOrThrow(coupon.description, '쿠폰 설명');
    if (!desc) throw new BrandMessageBuildError('쿠폰 설명이 필요합니다');
    if (charLen(desc) > spec.couponDescMax) {
      throw new BrandMessageBuildError(`${label}: 쿠폰 설명은 최대 ${spec.couponDescMax}자입니다 (현재 ${charLen(desc)}자)`);
    }
    if (newlineCount(desc) > 0) throw new BrandMessageBuildError('쿠폰 설명에는 줄바꿈을 넣을 수 없습니다');
  }

  // ── 와이드 리스트 (§6.10.6) ──────────────────────────────────────────
  if (spec.maxItems > 0 && input.bubble === 'WIDE_ITEM_LIST') {
    const list = asArray(attItem?.list);
    if (list.length < spec.minItems || list.length > spec.maxItems) {
      throw new BrandMessageBuildError(`${label}: 아이템은 ${spec.minItems}~${spec.maxItems}개여야 합니다 (현재 ${list.length}개)`);
    }
    list.forEach((item: any, i: number) => {
      const at = `${i + 1}번째 아이템`;
      plainObjectOrThrow(item, at);
      if (!strFieldOrThrow(item?.img_url, `${at} 이미지`)) throw new BrandMessageBuildError(`${at}: 이미지가 필요합니다`);
      if (!strFieldOrThrow(item?.url_mobile, `${at} 모바일 링크`)) throw new BrandMessageBuildError(`${at}: 모바일 링크가 필요합니다`);
      // 1번째만 제목이 선택이다.
      if (i > 0 && !strFieldOrThrow(item?.title, `${at} 제목`)) throw new BrandMessageBuildError(`${at}: 제목이 필요합니다`);
    });
  }

  // ── 캐러셀 (§5.3 — head 인트로 / list 카드 / tail 더보기) ─────────────
  //   ★2026-08-28 신설. 그전에는 캐러셀 값이 오면 조립 앞단에서 통째로 거부했다.
  if (spec.carousel) {
    assertCarouselSpec(spec, input.carousel, label);
  }
}

/**
 * 캐러셀 검사 — 출처: attachment_method.pdf **§5.3**.
 *
 * 세 자리가 서로 다른 규칙을 갖는다.
 *   `head`(인트로) = CAROUSEL_COMMERCE만 · 헤더 20자 줄바꿈 불가 · 내용 50자 줄바꿈 2
 *   `list`(카드)   = 인트로 쓰면 1~5장, 안 쓰면 2~6장 · 유형별로 header·message가 필수이거나 사용불가
 *   `tail`(더보기) = url_mobile 필수 · **변수 사용 불가**
 */
export function assertCarouselSpec(spec: BrandBubbleSpec, carousel: any, label: string): void {
  const cs = spec.carousel!;
  const car = plainObjectOrThrow(carousel, '캐러셀');
  if (!car) throw new BrandMessageBuildError(`${label}: 캐러셀 카드가 필요합니다`);

  // ── head (인트로) ──
  const head = plainObjectOrThrow(car.head, '캐러셀 인트로');
  const useIntro = head !== undefined;
  if (useIntro && !cs.allowIntro) {
    throw new BrandMessageBuildError(`${label}은 캐러셀 인트로를 사용하지 않습니다`);
  }
  if (useIntro) {
    const iHeader = strFieldOrThrow(head?.header, '인트로 제목');
    if (!iHeader) throw new BrandMessageBuildError('캐러셀 인트로: 제목이 필요합니다');
    if (charLen(iHeader) > cs.introHeaderMax) {
      throw new BrandMessageBuildError(`캐러셀 인트로: 제목은 최대 ${cs.introHeaderMax}자입니다 (현재 ${charLen(iHeader)}자)`);
    }
    if (newlineCount(iHeader) > 0) throw new BrandMessageBuildError('캐러셀 인트로: 제목에는 줄바꿈을 넣을 수 없습니다');

    const iContent = strFieldOrThrow(head?.content, '인트로 내용');
    if (!iContent) throw new BrandMessageBuildError('캐러셀 인트로: 내용이 필요합니다');
    if (charLen(iContent) > cs.introContentMax) {
      throw new BrandMessageBuildError(`캐러셀 인트로: 내용은 최대 ${cs.introContentMax}자입니다 (현재 ${charLen(iContent)}자)`);
    }
    if (newlineCount(iContent) > cs.introContentNewline) {
      throw new BrandMessageBuildError(`캐러셀 인트로: 줄바꿈은 최대 ${cs.introContentNewline}개입니다`);
    }
    if (!strFieldOrThrow(head?.image_url, '인트로 이미지')) {
      throw new BrandMessageBuildError('캐러셀 인트로: 이미지가 필요합니다');
    }
    // §5.3 "url_mobile이 필수 — url_mobile, url_pc, scheme_android, scheme_ios 중 하나라도 입력하는 경우"
    const introLinkKeys = ['url_pc', 'scheme_android', 'scheme_ios'];
    const hasOtherLink = introLinkKeys.some((k) => strFieldOrThrow(head?.[k], '인트로 링크'));
    if (hasOtherLink && !strFieldOrThrow(head?.url_mobile, '인트로 모바일 링크')) {
      throw new BrandMessageBuildError('캐러셀 인트로: 다른 링크를 넣으면 모바일 링크가 필요합니다');
    }
  }

  // ── list (카드) ──
  const list = asArray(car.list);
  const min = useIntro ? cs.listMinWithIntro : cs.listMin;
  const max = useIntro ? cs.listMaxWithIntro : cs.listMax;
  if (list.length < min || list.length > max) {
    throw new BrandMessageBuildError(
      useIntro
        ? `${label}: 인트로를 쓰면 카드는 ${min}~${max}장입니다 (현재 ${list.length}장)`
        : `${label}: 카드는 ${min}~${max}장입니다 (현재 ${list.length}장)`
    );
  }
  list.forEach((card: any, i: number) => {
    const at = `${i + 1}번째 카드`;
    plainObjectOrThrow(card, at);

    const cHeader = strFieldOrThrow(card?.header, `${at} 제목`);
    if (cs.itemHeader === 'forbidden') {
      if (cHeader) throw new BrandMessageBuildError(`${label}: ${at}는 제목을 사용하지 않습니다`);
    } else {
      if (!cHeader) throw new BrandMessageBuildError(`${at}: 제목이 필요합니다`);
      if (charLen(cHeader) > cs.itemHeaderMax) {
        throw new BrandMessageBuildError(`${at}: 제목은 최대 ${cs.itemHeaderMax}자입니다 (현재 ${charLen(cHeader)}자)`);
      }
      if (newlineCount(cHeader) > 0) throw new BrandMessageBuildError(`${at}: 제목에는 줄바꿈을 넣을 수 없습니다`);
    }

    const cMessage = strFieldOrThrow(card?.message, `${at} 내용`);
    if (cs.itemMessage === 'forbidden') {
      if (cMessage) throw new BrandMessageBuildError(`${label}: ${at}는 내용을 사용하지 않습니다`);
    } else {
      if (!cMessage) throw new BrandMessageBuildError(`${at}: 내용이 필요합니다`);
      if (charLen(cMessage) > cs.itemMessageMax) {
        throw new BrandMessageBuildError(`${at}: 내용은 최대 ${cs.itemMessageMax}자입니다 (현재 ${charLen(cMessage)}자)`);
      }
      if (newlineCount(cMessage) > cs.itemMessageNewline) {
        throw new BrandMessageBuildError(`${at}: 줄바꿈은 최대 ${cs.itemMessageNewline}개입니다`);
      }
    }

    const cAdd = strFieldOrThrow(card?.additional_content, `${at} 부가 정보`);
    if (cAdd) {
      if (cs.itemAdditional === 'forbidden') {
        throw new BrandMessageBuildError(`${label}: ${at}는 부가 정보를 사용하지 않습니다`);
      }
      if (charLen(cAdd) > cs.itemAdditionalMax) {
        throw new BrandMessageBuildError(`${at}: 부가 정보는 최대 ${cs.itemAdditionalMax}자입니다 (현재 ${charLen(cAdd)}자)`);
      }
      if (newlineCount(cAdd) > cs.itemAdditionalNewline) {
        throw new BrandMessageBuildError(`${at}: 부가 정보의 줄바꿈은 ${cs.itemAdditionalNewline}개까지입니다`);
      }
    }

    // 카드 안의 attachment는 다시 이미지·버튼·쿠폰·커머스를 품는다(§5.2 "캐러셀 아이템 이미지, 버튼 정보").
    const cAtt = plainObjectOrThrow(card?.attachment, `${at} 첨부`) ?? {};
    const cCommerce = plainObjectOrThrow(cAtt.commerce, `${at} 상품 정보`);
    const cProdTitle = strFieldOrThrow(cCommerce?.title, `${at} 상품명`);
    if (cProdTitle && spec.maxCommerceTitle > 0 && charLen(cProdTitle) > spec.maxCommerceTitle) {
      throw new BrandMessageBuildError(
        `${at}: 상품명은 최대 ${spec.maxCommerceTitle}자입니다 (현재 ${charLen(cProdTitle)}자)`
      );
    }
    // §6.10.8 — 할인가를 넣었으면 할인율·정액할인 중 하나는 있어야 한다(카드에도 같은 규칙).
    if (cCommerce && cCommerce.discount_price !== undefined
        && cCommerce.discount_rate === undefined && cCommerce.discount_fixed === undefined) {
      throw new BrandMessageBuildError(`${at}: 할인가를 넣으면 할인율 또는 할인금액 중 하나를 함께 입력해야 합니다`);
    }
    const cButtons = asArray(cAtt.button);
    if (cButtons.length > cs.itemButtonMax) {
      throw new BrandMessageBuildError(`${at}: 버튼은 최대 ${cs.itemButtonMax}개입니다 (현재 ${cButtons.length}개)`);
    }
    cButtons.forEach((btn: any, bi: number) => {
      const bat = `${at} ${bi + 1}번째 버튼`;
      plainObjectOrThrow(btn, bat);
      const bName = strFieldOrThrow(btn?.name, `${bat} 버튼명`);
      if (!bName) throw new BrandMessageBuildError(`${bat}: 버튼명이 필요합니다`);
      if (charLen(bName) > spec.maxButtonName) {
        throw new BrandMessageBuildError(`${bat}: 버튼명은 최대 ${spec.maxButtonName}자입니다 (현재 ${charLen(bName)}자)`);
      }
      const bType = strFieldOrThrow(btn?.type, `${bat} 종류`).toUpperCase();
      if (!BUTTON_TYPES[bType]) throw new BrandMessageBuildError(`${bat}: 지원하지 않는 버튼 종류입니다 (${bType || '미지정'})`);
    });
  });

  // ── tail (더보기) ──
  const tail = plainObjectOrThrow(car.tail, '캐러셀 더보기');
  if (tail !== undefined) {
    const tUrl = strFieldOrThrow(tail?.url_mobile, '더보기 모바일 링크');
    if (!tUrl) throw new BrandMessageBuildError('캐러셀 더보기: 모바일 링크가 필요합니다');
    // 더보기에는 변수를 쓸 수 없다(카카오 브랜드메시지 가이드 · 접수 문서 「캐러셀 더보기」 항).
    // 치환이 일어나지 않아 `#{...}`가 링크에 그대로 남는다.
    for (const k of ['url_mobile', 'url_pc', 'scheme_android', 'scheme_ios']) {
      const v = strFieldOrThrow(tail?.[k], '더보기 링크');
      if (v && v.includes('#{')) {
        throw new BrandMessageBuildError('캐러셀 더보기 링크에는 변수를 사용할 수 없습니다');
      }
    }
  }
}

/**
 * 쿠폰 제목은 자유 문구가 아니라 **정해진 5형식만** 허용된다 — IMC Developer Portal
 * `/kakao-message/api/v1/brand/send/free` coupon.title "사용 가능한 쿠폰 제목".
 * 형식을 벗어나면 카카오가 거절하므로 적재 전에 막는다.
 */
const COUPON_TITLE_FORMS: { re: RegExp; check?: (m: RegExpExecArray) => boolean }[] = [
  // ${숫자}원 할인 쿠폰 (1 ~ 99,999,999 — 천단위 쉼표 허용)
  { re: /^([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)원 할인 쿠폰$/, check: (m) => {
    const n = Number(m[1].replace(/,/g, ''));
    return n >= 1 && n <= 99_999_999;
  } },
  // ${숫자}% 할인 쿠폰 (1 ~ 100)
  { re: /^([0-9]+)% 할인 쿠폰$/, check: (m) => {
    const n = Number(m[1]);
    return n >= 1 && n <= 100;
  } },
  { re: /^배송비 할인 쿠폰$/ },
  // ${7자 이내} 무료 쿠폰 / UP 쿠폰
  { re: /^(.{1,7}) 무료 쿠폰$/ },
  { re: /^(.{1,7}) UP 쿠폰$/ },
];

export const COUPON_TITLE_GUIDE = '1000원 할인 쿠폰 / 10% 할인 쿠폰 / 배송비 할인 쿠폰 / OOO 무료 쿠폰 / OOO UP 쿠폰';

function isAllowedCouponTitle(title: string): boolean {
  return COUPON_TITLE_FORMS.some(({ re, check }) => {
    const m = re.exec(title);
    return !!m && (!check || check(m));
  });
}

/** 오류 문구용 — 사용자에게 규격 키 이름 대신 우리말로 보여준다. */
const BUTTON_FIELD_LABEL: Record<string, string> = {
  name: '버튼명',
  url_mobile: '모바일 링크',
  url_pc: 'PC 링크',
  scheme_android: '안드로이드 앱 실행 주소',
  scheme_ios: 'iOS 앱 실행 주소',
  biz_form_key: '비즈니스폼 키',
};

// ============================================================
// JSON 빌더
// ============================================================

/** ATTACHMENT_JSON 구성 */
/**
 * ATTACHMENT 본체 조립 — 객체를 돌려준다.
 *
 * ★2026-08-28 `buildAttachmentJson`에서 본문을 그대로 떼어냈다(내용 변경 0).
 *   캐러셀 카드도 같은 모양의 첨부를 품기 때문이다(§5.2 "캐러셀 아이템 이미지, 버튼 정보").
 *   여기서 나누지 않으면 카드 조립이 같은 코드를 한 벌 더 갖게 된다.
 */
function buildAttachmentBody(params: {
  buttons?: BrandButton[];
  image?: BrandImage;
  coupon?: BrandCoupon;
  itemList?: BrandItemListItem[];
  commerce?: BrandCommerce;
  video?: BrandVideo;
}): Record<string, any> {
  const attachment: any = {};

  if (params.buttons && params.buttons.length > 0) {
    attachment.button = params.buttons.map(b => ({
      name: b.name,
      type: b.type,
      ...(b.url_mobile && { url_mobile: b.url_mobile }),
      ...(b.url_pc && { url_pc: b.url_pc }),
      ...(b.scheme_android && { scheme_android: b.scheme_android }),
      ...(b.scheme_ios && { scheme_ios: b.scheme_ios }),
      ...(b.biz_form_key && { biz_form_key: b.biz_form_key }),
    }));
  }

  if (params.image) {
    attachment.image = {
      img_url: params.image.img_url,
      ...(params.image.img_link && { img_link: params.image.img_link }),
    };
  }

  // 쿠폰 — §6.10.7. 클릭 URL은 평면 키(url_mobile/url_pc/scheme_*)다. `link` 래핑 금지.
  //
  // ★ 2026-08-18 검사를 **투영 전**에 둔다. 아래에서 평면 키만 골라 담으면 옛 `link`는 그 자리에서
  //   사라지고, 뒤늦게 조립기가 보는 객체에는 흔적이 없다 — 그래서 "링크 없는 쿠폰"이 조용히 나갔다.
  //   타입(BrandCoupon)은 `link`를 이미 뺐지만 라우트가 req.body.coupon을 그대로 넘기므로
  //   런타임에는 여전히 들어올 수 있다(옛 화면 번들 캐시).
  if (params.coupon && (params.coupon as any).link !== undefined) {
    throw new BrandMessageBuildError('쿠폰 링크 형식이 올바르지 않습니다. 쿠폰 URL을 다시 입력해주세요');
  }
  if (params.coupon) {
    attachment.coupon = {
      title: params.coupon.title,
      description: params.coupon.description,
      ...(params.coupon.url_mobile && { url_mobile: params.coupon.url_mobile }),
      ...(params.coupon.url_pc && { url_pc: params.coupon.url_pc }),
      ...(params.coupon.scheme_android && { scheme_android: params.coupon.scheme_android }),
      ...(params.coupon.scheme_ios && { scheme_ios: params.coupon.scheme_ios }),
    };
  }

  // 와이드 리스트 — §6.10.6. title은 1번째만 선택이라 값이 있을 때만 싣는다.
  if (params.itemList && params.itemList.length > 0) {
    attachment.item = {
      list: params.itemList.map(item => ({
        ...(item.title && { title: item.title }),
        img_url: item.img_url,
        url_mobile: item.url_mobile,
        ...(item.url_pc && { url_pc: item.url_pc }),
        ...(item.scheme_android && { scheme_android: item.scheme_android }),
        ...(item.scheme_ios && { scheme_ios: item.scheme_ios }),
      })),
    };
  }

  // 커머스 — §6.10.8. 0원 할인도 유효한 값이라 falsy 체크 대신 undefined 체크를 쓴다.
  if (params.commerce) {
    attachment.commerce = {
      title: params.commerce.title,
      regular_price: params.commerce.regular_price,
      ...(params.commerce.discount_price !== undefined && { discount_price: params.commerce.discount_price }),
      ...(params.commerce.discount_rate !== undefined && { discount_rate: params.commerce.discount_rate }),
      ...(params.commerce.discount_fixed !== undefined && { discount_fixed: params.commerce.discount_fixed }),
    };
  }

  if (params.video) {
    attachment.video = {
      video_url: params.video.video_url,
      ...(params.video.thumbnail_url && { thumbnail_url: params.video.thumbnail_url }),
    };
  }

  return attachment;
}

export function buildAttachmentJson(params: Parameters<typeof buildAttachmentBody>[0]): string | null {
  const attachment = buildAttachmentBody(params);
  return Object.keys(attachment).length > 0 ? JSON.stringify(attachment) : null;
}

// ============================================================
// 캐러셀 조립 (§5.3)
// ============================================================

/** 캐러셀 인트로 — CAROUSEL_COMMERCE만 사용(§5.3 head) */
export interface BrandCarouselIntro {
  header: string;
  content: string;
  image_url: string;
  url_mobile?: string;
  url_pc?: string;
  scheme_android?: string;
  scheme_ios?: string;
}

/** 캐러셀 카드 — 본문 필드 + 자기 첨부(이미지·버튼·쿠폰·커머스)를 품는다(§5.3 list) */
export interface BrandCarouselCard {
  header?: string;
  message?: string;
  additional_content?: string;
  image?: BrandImage;
  buttons?: BrandButton[];
  coupon?: BrandCoupon;
  commerce?: BrandCommerce;
}

/** 캐러셀 더보기 — 맨 끝 고정 카드(§5.3 tail). 변수 사용 불가 */
export interface BrandCarouselTail {
  url_mobile: string;
  url_pc?: string;
  scheme_android?: string;
  scheme_ios?: string;
}

/**
 * 캐러셀 JSON 조립 — ★2026-08-28 되살렸다.
 *
 * 2026-07-30에 "상위 조립 예시 미확보"로 지웠던 함수다. 그 예시를 `attachment_method.pdf` §5.3에서
 * 확보해 규격대로 다시 만들었다. 구조는 `head`(인트로) · `list`(카드) · `tail`(더보기) 3단이고,
 * 카드 첨부는 `buildAttachmentBody`를 그대로 쓴다(같은 규격이라 코드를 두 벌 두지 않는다).
 *
 * ⛔ 값 검사는 여기서 하지 않는다 — `assertBrandContentSpec` → `assertCarouselSpec`이 소유한다.
 *    조립기가 검사까지 하면 호출부마다 검사가 갈린다(0818 결함 2의 뿌리).
 */
export function buildCarouselJson(params: {
  intro?: BrandCarouselIntro;
  cards: BrandCarouselCard[];
  tail?: BrandCarouselTail;
}): string | null {
  if (!params.cards || params.cards.length === 0) return null;

  const carousel: Record<string, any> = {};

  if (params.intro) {
    const i = params.intro;
    carousel.head = {
      header: i.header,
      content: i.content,
      image_url: i.image_url,
      ...(i.url_mobile && { url_mobile: i.url_mobile }),
      ...(i.url_pc && { url_pc: i.url_pc }),
      ...(i.scheme_android && { scheme_android: i.scheme_android }),
      ...(i.scheme_ios && { scheme_ios: i.scheme_ios }),
    };
  }

  carousel.list = params.cards.map((card) => {
    const attachment = buildAttachmentBody({
      buttons: card.buttons,
      image: card.image,
      coupon: card.coupon,
      commerce: card.commerce,
    });
    return {
      ...(card.header && { header: card.header }),
      ...(card.message && { message: card.message }),
      ...(card.additional_content && { additional_content: card.additional_content }),
      ...(Object.keys(attachment).length > 0 && { attachment }),
    };
  });

  if (params.tail) {
    const t = params.tail;
    carousel.tail = {
      url_mobile: t.url_mobile,
      ...(t.url_pc && { url_pc: t.url_pc }),
      ...(t.scheme_android && { scheme_android: t.scheme_android }),
      ...(t.scheme_ios && { scheme_ios: t.scheme_ios }),
    };
  }

  return JSON.stringify(carousel);
}

// ============================================================
// 발송 함수
// ============================================================

export interface BrandSendResult {
  success: boolean;
  sentCount: number;
  failCount: number;
  campaignId?: string;
  error?: string;
}

// ★ 2026-07-03 KAKAO 브랜드메시지 문안 학습 코퍼스 적재 (Phase 2 공통 헬퍼).
//   ⚠️ 기간계 무영향: MySQL INSERT 루프 종료 후 · 미await fire-and-forget · try-catch 이중 격리.
//   자유 본문(message) + campaignId 있을 때만 1회. source_ref=campaignId:brand 멱등(친구톡/알림톡과 키 분리).
function logBrandKakaoTraining(
  params: { companyId: string; campaignId?: string; message?: string; isAd?: boolean },
  sentCount: number,
): void {
  try {
    const msg = (params.message || '').trim();
    if (sentCount > 0 && params.companyId && params.campaignId && msg) {
      logCampaignTraining({
        campaignId: `${params.campaignId}:brand`,
        companyId: params.companyId,
        messageType: 'KAKAO',
        isAd: params.isAd === true,
        targetCount: sentCount,
        finalMessage: msg,
        finalSource: 'manual',
      }).catch(() => { /* 학습 적재 실패는 발송에 영향 없음 */ });
    }
  } catch { /* 학습 준비 실패도 발송 무영향 */ }
}

/**
 * 수신거부 필터 — 두 발송 함수 공용.
 */
async function filterUnsubscribed(userId: string, phones: string[]): Promise<string[]> {
  const unsubResult = await query(
    `SELECT phone FROM unsubscribes WHERE user_id = $1`,
    [userId]
  );
  const unsubPhones = new Set(unsubResult.rows.map((r: any) => normalizePhone(r.phone)));
  return phones.map(p => normalizePhone(p)).filter(p => p && !unsubPhones.has(p));
}

/**
 * 대체발송 회신번호 — resendFrom 미지정이면 회사 기본 회신번호로 폴백.
 * SMSQ `call_back`은 전환재발송(SMS/LMS)의 발신번호가 된다.
 *
 * ★ 2026-07-31 export — `/brand-send`가 campaigns.callback_number를 기록해야 하는데,
 *   큐에 실린 번호와 다른 값을 저장하면 화면과 실제 발신번호가 갈라진다.
 *   라우트가 먼저 확정해 그 값을 `resendFrom`으로 되넘기므로 판정은 여기 한 곳뿐이다.
 */
export async function resolveBrandCallback(companyId: string, resendFrom?: string): Promise<string> {
  const given = normalizePhone(resendFrom || '');
  if (given) return given;
  const r = await query(
    `SELECT phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1`,
    [companyId]
  );
  return normalizePhone(r.rows[0]?.phone || '');
}

/**
 * 적재 테이블 기록 — 조회·취소가 send_config.sentTables를 1순위로 보므로(0611 취소 사고 계약)
 * 실제 INSERT 테이블을 남긴다. 실패해도 발송에는 영향 없음(전 라인 합집합 폴백이 커버).
 */
function recordSentTables(campaignId: string | undefined, table: string): void {
  if (!campaignId) return;
  query(
    `UPDATE campaigns
        SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{sentTables}', $2::jsonb),
            updated_at = NOW()
      WHERE id = $1`,
    [campaignId, JSON.stringify([table])]
  ).catch((e: any) => console.warn(`[brand-message] sentTables 기록 실패(무영향):`, e?.message || e));
}

// ============================================================
// ★ 2026-09-01 AI 생성 이미지 표시 (설계서 docs/2026-09-01-ai-image-notice-design.md)
//   카카오 브랜드 메시지 가이드 4-2: 생성형 AI 소재는 안내 문구/워터마크 의무 — 위반 = 발송 제한.
//   대상 = cdp_assets.kind='generated'뿐(§4-3 — uploaded에 붙이면 그것이 거짓 표시다.
//   nukki·variant는 1단계 제외). 배선 = sendBrandMessage 한 곳(§4-4 — 템플릿 경로는
//   본문을 카카오 등록 템플릿이 소유해 붙일 자리가 없다 §4-4-1).
// ============================================================

export const BRAND_AI_IMAGE_NOTICE = '*AI로 생성된 이미지입니다';

const OWN_IMAGE_PREFIX = '/api/cdp/inapp/image/';

/** DNS 표기 정규화 — 소문자 + root dot 제거 (★Codex 2R H1: `hanjul.ai.`은 `hanjul.ai`과 같은 호스트다) */
const normalizeHost = (h: string): string => h.toLowerCase().replace(/\.$/, '');

/** 절대 URL을 자사 서빙 경로로 인정할 호스트 — 기존 base env 규약(HANJUL_BASE_URL·PUBLIC_BASE_URL)에서 파생 */
function trustedImageHosts(): Set<string> {
  const hosts = new Set<string>(['hanjul.ai', 'app.hanjul.ai', 'localhost', '127.0.0.1']);
  for (const v of [process.env.HANJUL_BASE_URL, process.env.PUBLIC_BASE_URL]) {
    if (!v) continue;
    try { hosts.add(normalizeHost(new URL(v).hostname)); } catch { /* 잘못된 env 값은 무시 */ }
  }
  return hosts;
}

/**
 * 우리 공개 서빙 URL을 cdp_assets.url 저장형(상대 경로)으로 정규화. 우리 경로가 아니면 null.
 * ★Codex 1R H1 — 문자열 중간 매칭(indexOf)은 남의 호스트 URL이나 쿼리 안에 든 경로도
 * 자사로 오인한다. 상대 경로는 정확한 접두, 절대 URL은 신뢰 호스트 + pathname 접두만 인정한다.
 * ★Codex 2R H1 — scheme은 http/https만, 호스트는 정규화(normalizeHost) 후 대조한다.
 */
function toOwnAssetPath(imgUrl: string): string | null {
  if (imgUrl.startsWith(OWN_IMAGE_PREFIX)) return imgUrl.split(/[?#]/)[0];
  try {
    const u = new URL(imgUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!trustedImageHosts().has(normalizeHost(u.hostname))) return null;
    if (!u.pathname.startsWith(OWN_IMAGE_PREFIX)) return null;
    return u.pathname;
  } catch {
    return null;
  }
}

/**
 * AI 생성 이미지 판정 — **판정 대상은 발송 실물(img_url) 하나다.**
 * ★Codex 1R H1 수용으로 구조 정정: 처음에는 asset_id의 kind를 우선 믿었는데, 그러면 id와 URL을
 * 엇갈리게 보내는 것만으로 표시를 우회하거나(업로드 id + AI 이미지 URL) 거짓 표시를 만들 수 있었다
 * (AI id + 업로드 URL). 카카오가 내려받는 것은 img_url이므로 판정 근거도 그 URL의 라이브러리 행이어야
 * 한다. image.asset_id는 판정에 쓰지 않는다(참고 정보로만 남는다).
 * ★Codex 2R H1 수용: 자사 서빙 경로인데 행이 없으면 **무조건 거절**한다 — asset_id 유무로 가르던
 * 초안은 id를 빼는 것만으로 fail-open이 됐다. 행 없음 = 삭제된 에셋(파일은 비파괴 정책으로 계속
 * 서빙될 수 있다)이거나 다른 회사의 에셋 URL이라, kind를 모른 채 보내면 표시 누락이 될 수 있다.
 * 외부 URL은 false다(판정 불가 수용 — 모르는 이미지에 AI 표시를 하면 그것이 거짓 표시다).
 * 조회 오류는 "미표시 발송"으로 접지 않는다 — 이 자리는 차감·적재보다 앞이라 거절해도 돈이 안 움직인다.
 */
export async function isBrandImageAiGenerated(
  companyId: string,
  image?: { img_url?: string; asset_id?: string } | null,
): Promise<boolean> {
  const imgUrl = String(image?.img_url || '').trim();
  if (!imgUrl) return false;
  const ownPath = toOwnAssetPath(imgUrl);
  if (!ownPath) return false;

  let row: AssetRow | null;
  try {
    row = await getAssetByUrl(companyId, ownPath);
  } catch (err: any) {
    // 테이블 미생성 환경만 false — 그 환경은 등재 자체가 없어 자사 URL + 행 없음이 정상이고
    // generated 에셋도 존재할 수 없다. 그 외 조회 오류는 fail-closed.
    if (isAssetsTableMissing(err)) return false;
    throw new BrandMessageBuildError('이미지 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요');
  }
  if (!row) {
    throw new BrandMessageBuildError('첨부한 이미지 정보를 확인할 수 없습니다. 이미지를 다시 선택해주세요');
  }
  return row.kind === 'generated';
}

/**
 * 안내 문구 부착 — 순수 함수(조립기와 같은 이유로 DB를 보지 않는다).
 * 초과는 조립기가 아니라 여기서 먼저 사유를 만들어 거절한다(§4-5) — 조립기 오류
 * ("본문은 최대 76자")는 사용자가 쓰지 않은 글자를 세므로 이유가 안 보인다.
 * ⛔ 문구를 빼고 발송하는 폴백은 만들지 않는다 — 표시 없이 나가면 이 축의 목적이 사라진다.
 */
// 멱등 인정 = 문구가 **말미의 독립 줄**일 때만 (★Codex 1R M2 — includes 판정은 본문 중간의
// 언급('...입니다 아님' 등)에도 부착을 생략해, 설계가 보장한 말미 안내가 사라진다)
const NOTICE_TAIL_RE = new RegExp(
  `(?:^|\\n)${BRAND_AI_IMAGE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
);

export function appendAiImageNotice(message: string, spec: BrandBubbleSpec): string {
  if (!message.trim()) return message;                              // 본문 필수 검사를 우회시키지 않는다
  if (NOTICE_TAIL_RE.test(message.trimEnd())) return message;       // 재발송·저장 본문 중복 방지(§4-3-3)
  const candidate = `${message}\n${BRAND_AI_IMAGE_NOTICE}`;
  const overChars = charLen(candidate) - spec.maxMessage;
  if (overChars > 0) {
    throw new BrandMessageBuildError(
      `AI 생성 이미지 안내 문구를 포함하면 본문 글자 수를 넘습니다. 본문을 ${overChars}자 줄여 주세요`
    );
  }
  const overNl = newlineCount(candidate) - spec.maxNewline;
  if (overNl > 0) {
    throw new BrandMessageBuildError(
      `AI 생성 이미지 안내 문구를 포함하면 줄바꿈 수를 넘습니다. 본문 줄바꿈을 ${overNl}개 줄여 주세요`
    );
  }
  return candidate;
}

/**
 * 자유형 브랜드메시지 발송
 * - validation → 수신거부 필터 → 선불 차감 → SMSQ 배치 INSERT(msg_type='F') → 미적재분 환불
 */
export async function sendBrandMessage(params: BrandMessageParams): Promise<BrandSendResult> {
  // 1. 수신자 — 조립기가 볼 수 없는 유일한 값이라 여기서만 본다.
  //    (유형·발신키·타겟팅·본문·첨부·발송시각 검사는 전부 buildBrandQueuePayload가 소유한다)
  if (!params.phones || params.phones.length === 0) {
    return { success: false, sentCount: 0, failCount: 0, error: '수신자가 없습니다' };
  }

  // 2. 적재 규약(msg_contents+k_etc_json)·대체발송 확정 — 차감 전에 조립해 형식 결함을 선차단(fail-closed)
  let queuePayload: BrandQueuePayload;
  let fallback: ResolvedBrandFallback;
  try {
    // ★ 2026-09-01 AI 생성 이미지 안내 문구(§4-4) — 판정·부착은 조립·차감보다 앞.
    //   대체발송은 아래에서 **원본 본문**으로 확정한다 — 문자 대체본은 카카오 심사 대상이
    //   아니라 문구를 넣지 않는다(§4-7-①). 보강본은 카카오로 가는 큐 본문에만 쓴다.
    let message = params.message;
    if (await isBrandImageAiGenerated(params.companyId, params.image)) {
      const spec = BUBBLE_TYPES[String(params.bubbleType || '').trim().toUpperCase()];
      // spec이 없는 유형은 바로 아래 조립기가 미지원으로 거절한다 — 판정을 두 벌 두지 않는다.
      if (spec) message = appendAiImageNotice(String(params.message || ''), spec);
    }
    queuePayload = buildBrandQueuePayload({
      typeDef: 'FREE',
      senderKey: params.senderKey,
      targeting: params.targeting,
      bubbleType: params.bubbleType,
      isAd: params.isAd === true,
      header: params.header,
      additionalContent: params.additionalContent,
      message,
      unsubscribePhone: params.unsubscribePhone,
      unsubscribeAuth: params.unsubscribeAuth,
      sendAt: params.reservedDate,
      immediate: !params.reservedDate,
      attachmentJson: buildAttachmentJson({
        buttons: params.buttons,
        image: params.image,
        coupon: params.coupon,
        itemList: params.itemList,
        commerce: params.commerce,
        video: params.video,
      }),
      carouselJson: (params.carouselItems && params.carouselItems.length > 0) ? '[]' : null,
    });
    fallback = resolveBrandFallback({
      resendType: params.resendType,
      resendMessage: params.resendMessage,
      resendTitle: params.resendTitle,
      originalMessage: params.message,
    });
  } catch (buildErr: any) {
    return { success: false, sentCount: 0, failCount: 0, error: buildErr?.message || '브랜드메시지 구성 오류' };
  }

  // 3. 수신거부 필터
  const filteredPhones = await filterUnsubscribed(params.userId, params.phones);
  if (filteredPhones.length === 0) {
    return { success: false, sentCount: 0, failCount: 0, error: '모든 수신자가 수신거부 상태입니다' };
  }

  // 4. 발송 테이블·회신번호 확정 — 차감 전에 확정해 적재 불능 상태를 선차단
  const tables = await getCompanySmsTables(params.companyId, params.userId);
  if (tables.length === 0) {
    return { success: false, sentCount: 0, failCount: 0, error: '발송 라인이 설정되지 않았습니다. 관리자에게 문의하세요.' };
  }
  const callback = await resolveBrandCallback(params.companyId, params.resendFrom);
  if (!callback && fallback.nextType !== 'N') {
    return { success: false, sentCount: 0, failCount: 0, error: '대체발송 회신번호가 없습니다. 기본 회신번호를 등록해주세요.' };
  }

  // 5. 선불 차감 — 원장 키는 정규형 'BRAND' 하나만 쓴다(취소·sweeper·환불 축과 동일 문자열이어야
  //    같은 원장으로 수렴한다. 소문자 'brand'로 쓰면 후속 환불이 원장을 못 찾는다 — 0730 적대검증 수용).
  const deduct = await prepaidDeduct(params.companyId, filteredPhones.length, 'BRAND', params.campaignId || '', params.userId);
  if (!deduct.ok) {
    return { success: false, sentCount: 0, failCount: 0, error: deduct.error || '잔액 부족' };
  }

  // 6. SMSQ 배치 INSERT (msg_type='F')
  const rows: BrandQueueRow[] = filteredPhones.map((phone) => ({
    phone,
    callback,
    msgContents: queuePayload.msgContents,
    etcJson: queuePayload.etcJson,
    nextType: fallback.nextType,
    nextContents: fallback.nextContents,
    titleStr: fallback.titleStr,
    reservedDate: params.reservedDate,
    companyId: params.companyId,
  }));

  let sentCount = 0;
  try {
    sentCount = await insertBrandQueue(tables, rows, params.campaignId);
  } catch (err) {
    if (err instanceof BrandQueueInsertError) {
      sentCount = err.inserted; // 앞선 배치는 커밋됨 — 그만큼은 발송분(B-0727-1 계약)
      console.error(`[brand-message] 큐 INSERT 부분 실패 (적재 ${sentCount}건):`, err.message);
    } else {
      console.error(`[brand-message] 큐 INSERT 실패:`, err);
    }
  }
  const failCount = filteredPhones.length - sentCount;

  if (sentCount > 0) recordSentTables(params.campaignId, tables[0]);

  // 7. 미적재분 환불 — 실패(ok=false)를 확인하고 durable 의무로 남긴다(0730 적대검증 수용).
  //    전량 미적재는 sweeper 산식이 구조적으로 손대지 않는 자리라(처리수 0 = 미적재 0) 여기서 놓치면 영구 미환불.
  if (failCount > 0) {
    try {
      const refundRes = await prepaidRefund(params.companyId, failCount, 'BRAND', params.campaignId || '', '브랜드메시지 미적재분 환불', 'campaign', { refundKey: REFUND_KEYS.NOT_LOADED });
      if (!refundRes.ok) await markRefundPending(params.campaignId || '', failCount, 'BRAND');
    } catch (refundErr) {
      console.error(`[brand-message] 미적재 환불 오류:`, refundErr);
      await markRefundPending(params.campaignId || '', failCount, 'BRAND');
    }
  }

  // ★ 2026-07-03 KAKAO 문안 학습 코퍼스 적재 (Phase 2, fire-and-forget)
  logBrandKakaoTraining(params, sentCount);

  // 0건 적재는 성공이 아니다 — 성공으로 종결하면 라우트가 completed 캠페인을 만든다(0730 적대검증 수용).
  if (sentCount === 0) {
    return { success: false, sentCount: 0, failCount, error: '브랜드메시지 큐 적재에 실패했습니다. 잠시 후 다시 시도해주세요.', campaignId: params.campaignId };
  }
  return { success: true, sentCount, failCount, campaignId: params.campaignId };
}

/**
 * 기본형(템플릿) 브랜드메시지 발송 — 템플릿 코드(k_template_code) + 변수 JSON.
 * TYPE_DEF = 변수가 있으면 BASIC_VAR, 없으면 BASIC_TCD.
 * ⛔ 버튼·이미지·비디오·커머스·캐러셀 변수 JSON은 msg_contents 조립 예시 미확보라 거부.
 */
export async function sendBrandMessageTemplate(params: BrandTemplateParams): Promise<BrandSendResult> {
  if (!params.templateCode) {
    return { success: false, sentCount: 0, failCount: 0, error: '템플릿 코드가 필요합니다' };
  }
  if (!params.senderKey) return { success: false, sentCount: 0, failCount: 0, error: '발신 프로필 키가 없습니다' };
  if (!params.phones || params.phones.length === 0) return { success: false, sentCount: 0, failCount: 0, error: '수신자가 없습니다' };

  if (params.buttonVariableJson || params.imageVariableJson || params.videoVariableJson
      || params.commerceVariableJson || params.carouselVariableJson) {
    return {
      success: false, sentCount: 0, failCount: 0,
      error: '기본형 브랜드메시지는 현재 본문 변수·쿠폰 변수만 지원합니다',
    };
  }

  // 적재 규약(msg_contents+k_etc_json)·대체발송 확정 — 차감 전 선차단
  const hasVars = !!(params.messageVariableJson || params.couponVariableJson);
  let queuePayload: BrandQueuePayload;
  let fallback: ResolvedBrandFallback;
  try {
    queuePayload = buildBrandQueuePayload({
      typeDef: hasVars ? 'BASIC_VAR' : 'BASIC_TCD',
      senderKey: params.senderKey,
      targeting: params.targeting,
      bubbleType: params.bubbleType,
      isAd: params.isAd === true,
      header: params.header,
      additionalContent: params.additionalContent,
      unsubscribePhone: params.unsubscribePhone,
      unsubscribeAuth: params.unsubscribeAuth,
      sendAt: params.reservedDate,
      immediate: !params.reservedDate,
      attachmentJson: buildAttachmentJson({
        buttons: params.buttons,
        image: params.image,
        coupon: params.coupon,
        itemList: params.itemList,
        commerce: params.commerce,
        video: params.video,
      }),
      carouselJson: (params.carouselItems && params.carouselItems.length > 0) ? '[]' : null,
      messageVariableJson: params.messageVariableJson,
      couponVariableJson: params.couponVariableJson,
    });
    fallback = resolveBrandFallback({
      resendType: params.resendType,
      resendMessage: params.resendMessage,
      resendTitle: params.resendTitle,
      originalMessage: params.message,
    });
  } catch (buildErr: any) {
    return { success: false, sentCount: 0, failCount: 0, error: buildErr?.message || '브랜드메시지 구성 오류' };
  }

  // 수신거부 필터
  const filteredPhones = await filterUnsubscribed(params.userId, params.phones);
  if (filteredPhones.length === 0) {
    return { success: false, sentCount: 0, failCount: 0, error: '모든 수신자가 수신거부 상태입니다' };
  }

  // 발송 테이블·회신번호 확정
  const tables = await getCompanySmsTables(params.companyId, params.userId);
  if (tables.length === 0) {
    return { success: false, sentCount: 0, failCount: 0, error: '발송 라인이 설정되지 않았습니다. 관리자에게 문의하세요.' };
  }
  const callback = await resolveBrandCallback(params.companyId, params.resendFrom);
  if (!callback && fallback.nextType !== 'N') {
    return { success: false, sentCount: 0, failCount: 0, error: '대체발송 회신번호가 없습니다. 기본 회신번호를 등록해주세요.' };
  }

  // 선불 차감 — 원장 키는 정규형 'BRAND' (자유형과 동일 근거)
  const deduct = await prepaidDeduct(params.companyId, filteredPhones.length, 'BRAND', params.campaignId || '', params.userId);
  if (!deduct.ok) {
    return { success: false, sentCount: 0, failCount: 0, error: deduct.error || '잔액 부족' };
  }

  // SMSQ 배치 INSERT (msg_type='F' + k_template_code)
  const rows: BrandQueueRow[] = filteredPhones.map((phone) => ({
    phone,
    callback,
    msgContents: queuePayload.msgContents,
    etcJson: queuePayload.etcJson,
    templateCode: params.templateCode,
    nextType: fallback.nextType,
    nextContents: fallback.nextContents,
    titleStr: fallback.titleStr,
    reservedDate: params.reservedDate,
    companyId: params.companyId,
  }));

  let sentCount = 0;
  try {
    sentCount = await insertBrandQueue(tables, rows, params.campaignId);
  } catch (err) {
    if (err instanceof BrandQueueInsertError) {
      sentCount = err.inserted;
      console.error(`[brand-message-template] 큐 INSERT 부분 실패 (적재 ${sentCount}건):`, err.message);
    } else {
      console.error(`[brand-message-template] 큐 INSERT 실패:`, err);
    }
  }
  const failCount = filteredPhones.length - sentCount;

  if (sentCount > 0) recordSentTables(params.campaignId, tables[0]);

  // 미적재분 환불 — ok 확인 + 실패 시 durable 의무 (자유형과 동일 근거)
  if (failCount > 0) {
    try {
      const refundRes = await prepaidRefund(params.companyId, failCount, 'BRAND', params.campaignId || '', '브랜드메시지 미적재분 환불', 'campaign', { refundKey: REFUND_KEYS.NOT_LOADED });
      if (!refundRes.ok) await markRefundPending(params.campaignId || '', failCount, 'BRAND');
    } catch (refundErr) {
      console.error(`[brand-message-template] 미적재 환불 오류:`, refundErr);
      await markRefundPending(params.campaignId || '', failCount, 'BRAND');
    }
  }

  // ★ 2026-07-03 KAKAO 문안 학습 코퍼스 적재 (Phase 2, fire-and-forget)
  logBrandKakaoTraining(params, sentCount);

  if (sentCount === 0) {
    return { success: false, sentCount: 0, failCount, error: '브랜드메시지 큐 적재에 실패했습니다. 잠시 후 다시 시도해주세요.', campaignId: params.campaignId };
  }
  return { success: true, sentCount, failCount, campaignId: params.campaignId };
}
