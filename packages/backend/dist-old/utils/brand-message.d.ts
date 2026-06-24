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
/** 메시지 유형 8종 */
export declare const BUBBLE_TYPES: {
    readonly TEXT: {
        readonly code: "TEXT";
        readonly label: "텍스트";
        readonly maxMessage: 1300;
        readonly maxButtons: 5;
        readonly requireImage: false;
        readonly requireHeader: false;
    };
    readonly IMAGE: {
        readonly code: "IMAGE";
        readonly label: "이미지";
        readonly maxMessage: 1300;
        readonly maxButtons: 5;
        readonly requireImage: true;
        readonly requireHeader: false;
    };
    readonly WIDE: {
        readonly code: "WIDE";
        readonly label: "와이드 이미지";
        readonly maxMessage: 76;
        readonly maxButtons: 2;
        readonly requireImage: true;
        readonly requireHeader: false;
    };
    readonly WIDE_ITEM_LIST: {
        readonly code: "WIDE_ITEM_LIST";
        readonly label: "와이드 리스트";
        readonly maxMessage: 0;
        readonly maxButtons: 2;
        readonly requireImage: false;
        readonly requireHeader: true;
        readonly minItems: 3;
        readonly maxItems: 4;
    };
    readonly CAROUSEL_FEED: {
        readonly code: "CAROUSEL_FEED";
        readonly label: "캐러셀 피드";
        readonly maxMessage: 0;
        readonly maxButtons: 0;
        readonly requireImage: false;
        readonly requireHeader: false;
        readonly minItems: 2;
        readonly maxItems: 6;
    };
    readonly PREMIUM_VIDEO: {
        readonly code: "PREMIUM_VIDEO";
        readonly label: "프리미엄 동영상";
        readonly maxMessage: 76;
        readonly maxButtons: 1;
        readonly requireImage: false;
        readonly requireHeader: true;
        readonly requireVideo: true;
    };
    readonly COMMERCE: {
        readonly code: "COMMERCE";
        readonly label: "커머스";
        readonly maxMessage: 0;
        readonly maxButtons: 2;
        readonly requireImage: true;
        readonly requireHeader: false;
        readonly requireCommerce: true;
    };
    readonly CAROUSEL_COMMERCE: {
        readonly code: "CAROUSEL_COMMERCE";
        readonly label: "캐러셀 커머스";
        readonly maxMessage: 0;
        readonly maxButtons: 0;
        readonly requireImage: false;
        readonly requireHeader: false;
        readonly minItems: 2;
        readonly maxItems: 6;
        readonly requireCommerce: true;
    };
};
export type BubbleTypeCode = keyof typeof BUBBLE_TYPES;
/** 버튼 타입 */
export declare const BUTTON_TYPES: {
    readonly WL: {
        readonly code: "WL";
        readonly label: "웹링크";
        readonly requiredFields: readonly ["url_mobile"];
    };
    readonly AL: {
        readonly code: "AL";
        readonly label: "앱링크";
        readonly requiredFields: readonly ["url_mobile"];
    };
    readonly BK: {
        readonly code: "BK";
        readonly label: "봇키워드";
        readonly requiredFields: readonly ["name"];
    };
    readonly MD: {
        readonly code: "MD";
        readonly label: "메시지전달";
        readonly requiredFields: readonly ["name"];
    };
    readonly BF: {
        readonly code: "BF";
        readonly label: "비즈니스폼";
        readonly requiredFields: readonly ["biz_form_key"];
    };
    readonly BC: {
        readonly code: "BC";
        readonly label: "상담톡전환";
        readonly requiredFields: readonly ["name"];
    };
    readonly BT: {
        readonly code: "BT";
        readonly label: "봇전환";
        readonly requiredFields: readonly ["name"];
    };
    readonly AC: {
        readonly code: "AC";
        readonly label: "채널추가";
        readonly requiredFields: readonly ["name"];
    };
};
/** 타겟팅 옵션 */
export declare const TARGETING_OPTIONS: {
    readonly M: {
        readonly code: "M";
        readonly label: "마수동 전체";
        readonly description: "마케팅 수신동의 전체";
    };
    readonly N: {
        readonly code: "N";
        readonly label: "비친구만";
        readonly description: "마수동 중 채널 친구 제외";
    };
    readonly I: {
        readonly code: "I";
        readonly label: "채널 친구";
        readonly description: "광고주 지정 대상 중 채널 친구만";
    };
};
/** 대체 발송 타입 */
export declare const RESEND_TYPES: {
    readonly NO: "없음";
    readonly SM: "SMS";
    readonly LM: "LMS";
    readonly MM: "MMS";
};
export interface BrandButton {
    name: string;
    type: string;
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
    link?: {
        url_mobile: string;
        url_pc?: string;
    };
}
export interface BrandCommerce {
    title: string;
    regular_price: number;
    discount_price?: number;
    discount_rate?: number;
    currency_unit?: string;
}
export interface BrandVideo {
    video_url: string;
    thumbnail_url?: string;
}
export interface BrandItemListItem {
    title: string;
    description?: string;
    img_url?: string;
    img_link?: string;
    link?: {
        url_mobile: string;
        url_pc?: string;
    };
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
    bubbleType: BubbleTypeCode;
    senderKey: string;
    phones: string[];
    targeting: string;
    isAd: boolean;
    companyId: string;
    userId: string;
    message?: string;
    header?: string;
    additionalContent?: string;
    buttons?: BrandButton[];
    image?: BrandImage;
    coupon?: BrandCoupon;
    commerce?: BrandCommerce;
    video?: BrandVideo;
    itemList?: BrandItemListItem[];
    carouselHead?: {
        header?: string;
        description?: string;
        img_url?: string;
        img_link?: string;
    };
    carouselItems?: CarouselItem[];
    carouselTail?: {
        link?: {
            url_mobile: string;
            url_pc?: string;
        };
    };
    resendType?: string;
    resendFrom?: string;
    resendMessage?: string;
    resendTitle?: string;
    unsubscribePhone?: string;
    unsubscribeAuth?: string;
    reservedDate?: string;
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
export declare function validateBrandMessage(params: BrandMessageParams): {
    valid: boolean;
    error?: string;
};
/** ATTACHMENT_JSON 구성 */
export declare function buildAttachmentJson(params: {
    buttons?: BrandButton[];
    image?: BrandImage;
    coupon?: BrandCoupon;
    itemList?: BrandItemListItem[];
    commerce?: BrandCommerce;
    video?: BrandVideo;
}): string | null;
/** CAROUSEL_JSON 구성 */
export declare function buildCarouselJson(params: {
    head?: {
        header?: string;
        description?: string;
        img_url?: string;
        img_link?: string;
    };
    items: CarouselItem[];
    tail?: {
        link?: {
            url_mobile: string;
            url_pc?: string;
        };
    };
}): string | null;
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
export declare function sendBrandMessage(params: BrandMessageParams): Promise<BrandSendResult>;
/**
 * 기본형(템플릿) 브랜드메시지 발송
 * - 템플릿 코드 + 변수 JSON으로 발송
 */
export declare function sendBrandMessageTemplate(params: BrandTemplateParams): Promise<BrandSendResult>;
//# sourceMappingURL=brand-message.d.ts.map