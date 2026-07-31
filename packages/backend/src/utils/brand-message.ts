/**
 * ★ CT-12: brand-message.ts — 브랜드메시지 발송/검증 컨트롤타워
 *
 * 역할: 카카오 브랜드메시지 발송의 유일한 진입점
 * 적용 파일: campaigns.ts (POST /brand-send·테스트·AI·직접발송) · direct-send-processor.ts
 *
 * ★ 2026-07-30 발송 경로 재구축 — 운영 실체는 QTmsg Agent 방식이다.
 *   알림톡과 같은 라인그룹 `SMSQ_SEND` 테이블에 `msg_type='F'`로 적재하고,
 *   내용은 `msg_contents`에 JSON 문자열(필수 3키 대문자)로 싣는다. 옛 IMC REST 스펙 기반의
 *   `IMC_BM_FREE_BIZ_MSG`/`IMC_BM_BASIC_BIZ_MSG` 적재는 테이블 자체가 실재하지 않아 폐기.
 *   (SoT: docs/2026-07-29-brand-message-qtmsg-agent-design.md)
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
import { query } from '../config/database';
// ★ 2026-07-03 KAKAO(브랜드메시지) 문안 학습 코퍼스 적재 (전 채널 학습 통합 Phase 2) — fire-and-forget, 발송 무영향
import { logCampaignTraining } from './training-logger';

// ============================================================
// 상수 정의
// ============================================================

/** 메시지 유형 8종 */
export const BUBBLE_TYPES = {
  TEXT: { code: 'TEXT', label: '텍스트', maxMessage: 1300, maxButtons: 5, requireImage: false, requireHeader: false },
  IMAGE: { code: 'IMAGE', label: '이미지', maxMessage: 1300, maxButtons: 5, requireImage: true, requireHeader: false },
  WIDE: { code: 'WIDE', label: '와이드 이미지', maxMessage: 76, maxButtons: 2, requireImage: true, requireHeader: false },
  WIDE_ITEM_LIST: { code: 'WIDE_ITEM_LIST', label: '와이드 리스트', maxMessage: 0, maxButtons: 2, requireImage: false, requireHeader: true, minItems: 3, maxItems: 4 },
  CAROUSEL_FEED: { code: 'CAROUSEL_FEED', label: '캐러셀 피드', maxMessage: 0, maxButtons: 0, requireImage: false, requireHeader: false, minItems: 2, maxItems: 6 },
  PREMIUM_VIDEO: { code: 'PREMIUM_VIDEO', label: '프리미엄 동영상', maxMessage: 76, maxButtons: 1, requireImage: false, requireHeader: true, requireVideo: true },
  COMMERCE: { code: 'COMMERCE', label: '커머스', maxMessage: 0, maxButtons: 2, requireImage: true, requireHeader: false, requireCommerce: true },
  CAROUSEL_COMMERCE: { code: 'CAROUSEL_COMMERCE', label: '캐러셀 커머스', maxMessage: 0, maxButtons: 0, requireImage: false, requireHeader: false, minItems: 2, maxItems: 6, requireCommerce: true },
} as const;

export type BubbleTypeCode = keyof typeof BUBBLE_TYPES;

/** 버튼 타입 */
export const BUTTON_TYPES = {
  WL: { code: 'WL', label: '웹링크', requiredFields: ['url_mobile'] },
  AL: { code: 'AL', label: '앱링크', requiredFields: ['url_mobile'] },
  BK: { code: 'BK', label: '봇키워드', requiredFields: ['name'] },
  MD: { code: 'MD', label: '메시지전달', requiredFields: ['name'] },
  BF: { code: 'BF', label: '비즈니스폼', requiredFields: ['biz_form_key'] },
  BC: { code: 'BC', label: '상담톡전환', requiredFields: ['name'] },
  BT: { code: 'BT', label: '봇전환', requiredFields: ['name'] },
  AC: { code: 'AC', label: '채널추가', requiredFields: ['name'] },
} as const;

/** 타겟팅 옵션 */
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
export const SUPPORTED_BUBBLE_TYPES = ['TEXT', 'IMAGE', 'WIDE'] as const;

export function isSupportedBubbleType(t: any): boolean {
  return (SUPPORTED_BUBBLE_TYPES as readonly string[]).includes(String(t || '').trim().toUpperCase());
}

const UNSUPPORTED_BUBBLE_MSG = (t: string) =>
  `브랜드메시지 '${t}' 유형은 아직 지원하지 않습니다 (TEXT·IMAGE·WIDE만 발송 가능)`;

// ============================================================
// SMSQ msg_contents 조립 + 대체발송 매핑 (2026-07-30 재구축)
// ============================================================

export interface BrandMsgContentsParams {
  typeDef: 'FREE' | 'BASIC_TCD' | 'BASIC_VAR';
  targeting: string;                    // M | N | I
  bubbleType: string;                   // TEXT | IMAGE | WIDE
  header?: string | null;
  message?: string | null;              // FREE 필수 (BASIC_xxx에는 넣지 않는다 — 매뉴얼)
  attachmentJson?: string | null;       // 조립된 ATTACHMENT JSON 문자열 (buildAttachmentJson 산출물)
  carouselJson?: string | null;         // ⛔ 값이 있으면 즉시 거부 (캐러셀 미지원)
  messageVariableJson?: string | null;  // BASIC_VAR 전용
  couponVariableJson?: string | null;   // BASIC_VAR 전용
}

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
 * SMSQ `msg_contents` JSON 문자열 조립 — 필수 3키(TYPE_DEF/TARGETING/CHAT_BUBBLE_TYPE)는 전부 대문자.
 * 형식 위반은 발송 단계에서 오류 로그도 없이 버려지므로, 여기서 전부 throw로 막는다.
 */
export function buildBrandMsgContents(p: BrandMsgContentsParams): string {
  const bubble = String(p.bubbleType || '').trim().toUpperCase();
  if (!isSupportedBubbleType(bubble)) {
    throw new BrandMessageBuildError(UNSUPPORTED_BUBBLE_MSG(bubble || '(없음)'));
  }
  if (p.carouselJson && String(p.carouselJson).trim() !== '') {
    throw new BrandMessageBuildError('브랜드메시지 캐러셀 유형은 아직 지원하지 않습니다');
  }
  const targeting = String(p.targeting || '').trim().toUpperCase();
  if (!['M', 'N', 'I'].includes(targeting)) {
    throw new BrandMessageBuildError(`브랜드메시지 대상 범위(TARGETING)가 올바르지 않습니다: ${p.targeting}`);
  }

  const contents: Record<string, any> = {
    TYPE_DEF: p.typeDef,
    TARGETING: targeting,
    CHAT_BUBBLE_TYPE: bubble,
  };

  const header = String(p.header || '').trim();
  if (header) contents.HEADER = header;

  if (p.typeDef === 'FREE') {
    const message = String(p.message || '').trim();
    if (!message) throw new BrandMessageBuildError('브랜드메시지 본문이 비어 있습니다');
    contents.MESSAGE = message;
  } else {
    // 기본형: 내용은 템플릿(k_template_code)이 담당 — MESSAGE 키를 넣지 않는다(매뉴얼).
    if (p.typeDef === 'BASIC_VAR') {
      if (p.messageVariableJson) contents.MESSAGE_VARIABLE = parseJsonOrThrow(p.messageVariableJson, '변수(MESSAGE_VARIABLE)');
      if (p.couponVariableJson) contents.COUPON_VARIABLE = parseJsonOrThrow(p.couponVariableJson, '쿠폰 변수(COUPON_VARIABLE)');
      if (!contents.MESSAGE_VARIABLE && !contents.COUPON_VARIABLE) {
        throw new BrandMessageBuildError('기본형 변수세팅(BASIC_VAR)인데 변수 값이 없습니다');
      }
    }
  }

  if (p.attachmentJson && String(p.attachmentJson).trim() !== '') {
    contents.ATTACHMENT = parseJsonOrThrow(p.attachmentJson, '첨부(ATTACHMENT)');
  }

  return JSON.stringify(contents);
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
    throw new BrandMessageBuildError('대체발송 문구가 없습니다 — 대체문안을 입력하거나 대체발송을 끄세요');
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
}

export interface BrandCoupon {
  title: string;
  description?: string;
  link?: { url_mobile: string; url_pc?: string };
}

export interface BrandCommerce {
  title: string;
  regular_price: number;
  discount_price?: number;
  discount_rate?: number;
  currency_unit?: string;
}

export interface BrandVideo {
  video_url: string; // https://tv.kakao.com/v/{id}
  thumbnail_url?: string;
}

export interface BrandItemListItem {
  title: string;
  description?: string;
  img_url?: string;
  img_link?: string;
  link?: { url_mobile: string; url_pc?: string };
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
// Validation
// ============================================================

export function validateBrandMessage(params: BrandMessageParams): { valid: boolean; error?: string } {
  const typeInfo = BUBBLE_TYPES[params.bubbleType];
  if (!typeInfo) {
    return { valid: false, error: `유효하지 않은 메시지 유형: ${params.bubbleType}` };
  }

  // ★ 2026-07-30 지원 유형 게이트 — 미지원 유형은 차감 전에 입구에서 막는다(조용한 실패 차단).
  if (!isSupportedBubbleType(params.bubbleType)) {
    return { valid: false, error: UNSUPPORTED_BUBBLE_MSG(typeInfo.label) };
  }

  if (!params.senderKey) return { valid: false, error: '발신 프로필 키가 없습니다' };
  if (!params.phones || params.phones.length === 0) return { valid: false, error: '수신자가 없습니다' };
  if (!['M', 'N', 'I'].includes(params.targeting)) return { valid: false, error: '유효하지 않은 타겟팅' };

  // 본문 길이 체크
  if (typeInfo.maxMessage > 0) {
    if (!params.message || params.message.trim().length === 0) {
      return { valid: false, error: `${typeInfo.label}: 본문이 필요합니다` };
    }
    if (params.message.length > typeInfo.maxMessage) {
      return { valid: false, error: `${typeInfo.label}: 본문 ${typeInfo.maxMessage}자 초과 (현재 ${params.message.length}자)` };
    }
  }

  // 이미지 필수 체크
  if (typeInfo.requireImage && !params.image?.img_url) {
    return { valid: false, error: `${typeInfo.label}: 이미지가 필요합니다` };
  }

  // 헤더 필수 체크
  if (typeInfo.requireHeader && (!params.header || params.header.length === 0)) {
    return { valid: false, error: `${typeInfo.label}: 헤더가 필요합니다 (최대 20자)` };
  }
  if (params.header && params.header.length > 20) {
    return { valid: false, error: '헤더는 최대 20자입니다' };
  }

  // 버튼 개수 체크
  if (params.buttons && params.buttons.length > typeInfo.maxButtons) {
    return { valid: false, error: `${typeInfo.label}: 버튼 최대 ${typeInfo.maxButtons}개 (현재 ${params.buttons.length}개)` };
  }

  // 동영상 필수 체크
  if ((typeInfo as any).requireVideo && !params.video?.video_url) {
    return { valid: false, error: '프리미엄 동영상: 카카오TV URL이 필요합니다' };
  }

  // 커머스 필수 체크
  if ((typeInfo as any).requireCommerce && !params.commerce?.title) {
    return { valid: false, error: `${typeInfo.label}: 상품 정보가 필요합니다` };
  }

  // 아이템 리스트/캐러셀 개수 체크
  const minItems = (typeInfo as any).minItems;
  const maxItems = (typeInfo as any).maxItems;
  if (minItems) {
    if (params.bubbleType === 'WIDE_ITEM_LIST') {
      const items = params.itemList || [];
      if (items.length < minItems || items.length > maxItems) {
        return { valid: false, error: `${typeInfo.label}: 아이템 ${minItems}~${maxItems}개 필요 (현재 ${items.length}개)` };
      }
    } else {
      // CAROUSEL_FEED, CAROUSEL_COMMERCE
      const items = params.carouselItems || [];
      if (items.length < minItems || items.length > maxItems) {
        return { valid: false, error: `${typeInfo.label}: 캐러셀 아이템 ${minItems}~${maxItems}개 필요 (현재 ${items.length}개)` };
      }
    }
  }

  // ADDITIONAL_CONTENT 길이 체크 (COMMERCE)
  if (params.additionalContent && params.additionalContent.length > 34) {
    return { valid: false, error: '부가정보는 최대 34자입니다' };
  }

  return { valid: true };
}

// ============================================================
// JSON 빌더
// ============================================================

/** ATTACHMENT_JSON 구성 */
export function buildAttachmentJson(params: {
  buttons?: BrandButton[];
  image?: BrandImage;
  coupon?: BrandCoupon;
  itemList?: BrandItemListItem[];
  commerce?: BrandCommerce;
  video?: BrandVideo;
}): string | null {
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

  if (params.coupon) {
    attachment.coupon = {
      title: params.coupon.title,
      ...(params.coupon.description && { description: params.coupon.description }),
      ...(params.coupon.link && { link: params.coupon.link }),
    };
  }

  if (params.itemList && params.itemList.length > 0) {
    attachment.item = {
      list: params.itemList.map(item => ({
        title: item.title,
        ...(item.description && { description: item.description }),
        ...(item.img_url && { img_url: item.img_url }),
        ...(item.img_link && { img_link: item.img_link }),
        ...(item.link && { link: item.link }),
      })),
    };
  }

  if (params.commerce) {
    attachment.commerce = {
      title: params.commerce.title,
      regular_price: params.commerce.regular_price,
      ...(params.commerce.discount_price && { discount_price: params.commerce.discount_price }),
      ...(params.commerce.discount_rate && { discount_rate: params.commerce.discount_rate }),
      currency_unit: params.commerce.currency_unit || '원',
    };
  }

  if (params.video) {
    attachment.video = {
      video_url: params.video.video_url,
      ...(params.video.thumbnail_url && { thumbnail_url: params.video.thumbnail_url }),
    };
  }

  return Object.keys(attachment).length > 0 ? JSON.stringify(attachment) : null;
}

// (2026-07-30) 옛 buildCarouselJson 삭제 — 캐러셀은 msg_contents 조립 예시 미확보로 입구 차단 유형.
// 확장 시 buildBrandMsgContents에 상위 키 실예시 확보 후 되살린다(추측 조립 금지).

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

/**
 * 자유형 브랜드메시지 발송
 * - validation → 수신거부 필터 → 선불 차감 → SMSQ 배치 INSERT(msg_type='F') → 미적재분 환불
 */
export async function sendBrandMessage(params: BrandMessageParams): Promise<BrandSendResult> {
  // 1. Validation (지원 유형 게이트 포함 — 차감 전에 막는다)
  const validation = validateBrandMessage(params);
  if (!validation.valid) {
    return { success: false, sentCount: 0, failCount: 0, error: validation.error };
  }

  // 2. msg_contents·대체발송 확정 — 차감 전에 조립해 형식 결함을 선차단(fail-closed)
  let msgContents: string;
  let fallback: ResolvedBrandFallback;
  try {
    msgContents = buildBrandMsgContents({
      typeDef: 'FREE',
      targeting: params.targeting,
      bubbleType: params.bubbleType,
      header: params.header,
      message: params.message,
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
    msgContents,
    senderKey: params.senderKey,
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

  // msg_contents·대체발송 확정 — 차감 전 선차단
  const hasVars = !!(params.messageVariableJson || params.couponVariableJson);
  let msgContents: string;
  let fallback: ResolvedBrandFallback;
  try {
    msgContents = buildBrandMsgContents({
      typeDef: hasVars ? 'BASIC_VAR' : 'BASIC_TCD',
      targeting: params.targeting,
      bubbleType: params.bubbleType,
      header: params.header,
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
    msgContents,
    senderKey: params.senderKey,
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
