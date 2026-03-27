/**
 * ★ CT-12: brand-message.ts — 브랜드메시지 발송/검증 컨트롤타워
 *
 * 역할: 카카오 브랜드메시지 발송의 유일한 진입점
 * 적용 파일: campaigns.ts (POST /brand-send)
 *
 * 자유형(IMC_BM_FREE_BIZ_MSG) — 직접 작성 8종
 * 기본형(IMC_BM_BASIC_BIZ_MSG) — 템플릿 기반 변수 치환
 *
 * 참조: [휴머스온]브랜드메시지 Agent 사용 메뉴얼_20260209.pdf
 */

import { insertKakaoQueue, insertKakaoBasicQueue } from './sms-queue';
import { prepaidDeduct, prepaidRefund } from './prepaid';
import { buildUnsubscribeExistsFilter } from './unsubscribe-helper';
import { normalizePhone } from './normalize-phone';
import { query } from '../config/database';

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

/** 대체 발송 타입 */
export const RESEND_TYPES = {
  NO: '없음',
  SM: 'SMS',
  LM: 'LMS',
  MM: 'MMS',
} as const;

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

/** CAROUSEL_JSON 구성 */
export function buildCarouselJson(params: {
  head?: { header?: string; description?: string; img_url?: string; img_link?: string };
  items: CarouselItem[];
  tail?: { link?: { url_mobile: string; url_pc?: string } };
}): string | null {
  if (!params.items || params.items.length === 0) return null;

  const carousel: any = {};

  if (params.head) {
    carousel.head = {};
    if (params.head.header) carousel.head.header = params.head.header;
    if (params.head.description) carousel.head.description = params.head.description;
    if (params.head.img_url) carousel.head.img_url = params.head.img_url;
    if (params.head.img_link) carousel.head.img_link = params.head.img_link;
  }

  carousel.list = params.items.map(item => {
    const entry: any = {};
    if (item.header) entry.header = item.header;
    if (item.message) entry.message = item.message;
    if (item.additional_content) entry.additional_content = item.additional_content;
    if (item.attachment) entry.attachment = item.attachment;
    if ((item as any).commerce) entry.commerce = (item as any).commerce;
    return entry;
  });

  if (params.tail?.link) {
    carousel.tail = { link: params.tail.link };
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

/**
 * 자유형 브랜드메시지 발송
 * - validation → 수신거부 필터 → 선불 차감 → MySQL INSERT → 결과 반환
 */
export async function sendBrandMessage(params: BrandMessageParams): Promise<BrandSendResult> {
  // 1. Validation
  const validation = validateBrandMessage(params);
  if (!validation.valid) {
    return { success: false, sentCount: 0, failCount: 0, error: validation.error };
  }

  // 2. 수신거부 필터
  const unsubResult = await query(
    `SELECT phone FROM unsubscribes WHERE user_id = $1`,
    [params.userId]
  );
  const unsubPhones = new Set(unsubResult.rows.map((r: any) => normalizePhone(r.phone)));
  const filteredPhones = params.phones
    .map(p => normalizePhone(p))
    .filter(p => p && !unsubPhones.has(p));

  if (filteredPhones.length === 0) {
    return { success: false, sentCount: 0, failCount: 0, error: '모든 수신자가 수신거부 상태입니다' };
  }

  // 3. 선불 차감 (카카오 단가 기준)
  const deduct = await prepaidDeduct(params.companyId, filteredPhones.length, 'kakao', params.campaignId || '', params.userId);
  if (!deduct.ok) {
    return { success: false, sentCount: 0, failCount: 0, error: deduct.error || '잔액 부족' };
  }

  // 4. ATTACHMENT_JSON / CAROUSEL_JSON 구성
  const attachmentJson = buildAttachmentJson({
    buttons: params.buttons,
    image: params.image,
    coupon: params.coupon,
    itemList: params.itemList,
    commerce: params.commerce,
    video: params.video,
  });

  const carouselJson = (params.carouselItems && params.carouselItems.length > 0)
    ? buildCarouselJson({
        head: params.carouselHead,
        items: params.carouselItems,
        tail: params.carouselTail,
      })
    : null;

  // 5. MySQL INSERT (건건이 — 브랜드메시지는 수신자별 개인화 가능)
  let sentCount = 0;
  let failCount = 0;

  for (const phone of filteredPhones) {
    try {
      await insertKakaoQueue({
        bubbleType: params.bubbleType,
        senderKey: params.senderKey,
        phone,
        targeting: params.targeting,
        message: params.message || '',
        isAd: params.isAd,
        reservedDate: params.reservedDate,
        attachmentJson: attachmentJson || undefined,
        carouselJson: carouselJson || undefined,
        header: params.header,
        resendType: params.resendType || 'NO',
        resendFrom: params.resendFrom,
        resendMessage: params.resendMessage,
        resendTitle: params.resendTitle,
        unsubscribePhone: params.unsubscribePhone,
        unsubscribeAuth: params.unsubscribeAuth,
        requestUid: params.campaignId,
      });
      sentCount++;
    } catch (err) {
      console.error(`[brand-message] 발송 실패 (${phone}):`, err);
      failCount++;
    }
  }

  // 6. 실패분 환불
  if (failCount > 0) {
    await prepaidRefund(params.companyId, failCount, 'kakao', params.campaignId || '', '브랜드메시지 발송 실패분 환불');
  }

  return { success: true, sentCount, failCount, campaignId: params.campaignId };
}

/**
 * 기본형(템플릿) 브랜드메시지 발송
 * - 템플릿 코드 + 변수 JSON으로 발송
 */
export async function sendBrandMessageTemplate(params: BrandTemplateParams): Promise<BrandSendResult> {
  if (!params.templateCode) {
    return { success: false, sentCount: 0, failCount: 0, error: '템플릿 코드가 필요합니다' };
  }

  if (!params.senderKey) return { success: false, sentCount: 0, failCount: 0, error: '발신 프로필 키가 없습니다' };
  if (!params.phones || params.phones.length === 0) return { success: false, sentCount: 0, failCount: 0, error: '수신자가 없습니다' };

  // 수신거부 필터
  const unsubResult = await query(
    `SELECT phone FROM unsubscribes WHERE user_id = $1`,
    [params.userId]
  );
  const unsubPhones = new Set(unsubResult.rows.map((r: any) => normalizePhone(r.phone)));
  const filteredPhones = params.phones
    .map(p => normalizePhone(p))
    .filter(p => p && !unsubPhones.has(p));

  if (filteredPhones.length === 0) {
    return { success: false, sentCount: 0, failCount: 0, error: '모든 수신자가 수신거부 상태입니다' };
  }

  // 선불 차감
  const deduct = await prepaidDeduct(params.companyId, filteredPhones.length, 'kakao', params.campaignId || '', params.userId);
  if (!deduct.ok) {
    return { success: false, sentCount: 0, failCount: 0, error: deduct.error || '잔액 부족' };
  }

  // MySQL INSERT
  let sentCount = 0;
  let failCount = 0;

  for (const phone of filteredPhones) {
    try {
      await insertKakaoBasicQueue({
        bubbleType: params.bubbleType,
        senderKey: params.senderKey,
        phone,
        targeting: params.targeting,
        templateCode: params.templateCode,
        isAd: params.isAd,
        reservedDate: params.reservedDate,
        header: params.header,
        message: params.message,
        additionalContent: params.additionalContent,
        attachmentJson: buildAttachmentJson({
          buttons: params.buttons,
          image: params.image,
          coupon: params.coupon,
          itemList: params.itemList,
          commerce: params.commerce,
          video: params.video,
        }) || undefined,
        carouselJson: (params.carouselItems && params.carouselItems.length > 0)
          ? buildCarouselJson({
              head: params.carouselHead,
              items: params.carouselItems,
              tail: params.carouselTail,
            }) || undefined
          : undefined,
        messageVariableJson: params.messageVariableJson,
        buttonVariableJson: params.buttonVariableJson,
        couponVariableJson: params.couponVariableJson,
        imageVariableJson: params.imageVariableJson,
        videoVariableJson: params.videoVariableJson,
        commerceVariableJson: params.commerceVariableJson,
        carouselVariableJson: params.carouselVariableJson,
        resendType: params.resendType || 'NO',
        resendFrom: params.resendFrom,
        resendMessage: params.resendMessage,
        resendTitle: params.resendTitle,
        unsubscribePhone: params.unsubscribePhone,
        unsubscribeAuth: params.unsubscribeAuth,
        requestUid: params.campaignId,
      });
      sentCount++;
    } catch (err) {
      console.error(`[brand-message-template] 발송 실패 (${phone}):`, err);
      failCount++;
    }
  }

  if (failCount > 0) {
    await prepaidRefund(params.companyId, failCount, 'kakao', params.campaignId || '', '브랜드메시지 발송 실패분 환불');
  }

  return { success: true, sentCount, failCount, campaignId: params.campaignId };
}
