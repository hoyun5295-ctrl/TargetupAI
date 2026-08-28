/**
 * 브랜드메시지 규격 — **백엔드 CT의 사본이다.**
 *
 * 원본 = `packages/backend/src/utils/brand-message.ts` `BUBBLE_TYPES` + `BUBBLE_TYPE_OPENED`.
 * 값의 출처는 휴머스온 규격이고(attachment_method.pdf §3.4·§5.3 · IMC 매뉴얼 §4.4.1·§6.10.x),
 * 최종 판정자는 언제나 백엔드다. 화면은 **미리 막아 주기 위해** 같은 값을 들고 있을 뿐이다.
 *
 * ⛔ 이 파일의 숫자를 손으로 고치지 마라.
 *    백엔드를 고치고 다시 뽑아 넣는다. 어긋나면 파리티 테스트가 먼저 깨진다
 *    (`packages/backend/src/utils/__tests__/brand-spec-parity.test.ts`).
 *
 * ⛔ 화면에 규격 숫자를 직접 적지 마라 — 그렇게 갈라진 값이 아이템 4/5, 캐러셀 6/10 어긋남을 만들었다.
 *    필요한 값은 전부 여기 있고, 없으면 백엔드에 먼저 추가한다.
 *
 * `opened` = 그 유형으로 **실제 발송이 열렸는가**. 실측 1건을 통과해야 열린다.
 *    false인 유형은 등록만 되고 발송 화면에는 나타나지 않는다(화면은 이 값으로 안내를 띄운다).
 */

/** 캐러셀 규격 — head(인트로) · list(카드) · tail(더보기) 3단 */
export interface BrandSpecCarousel {
  allowIntro: boolean;
  introHeaderMax: number;
  introContentMax: number;
  introContentNewline: number;
  listMinWithIntro: number;
  listMaxWithIntro: number;
  listMin: number;
  listMax: number;
  itemHeader: 'required' | 'forbidden';
  itemHeaderMax: number;
  itemMessage: 'required' | 'forbidden';
  itemMessageMax: number;
  itemMessageNewline: number;
  itemAdditional: 'allowed' | 'forbidden';
  itemAdditionalMax: number;
  itemAdditionalNewline: number;
  itemButtonMax: number;
}

export interface BrandSpec {
  /** 유형 코드 (키와 같다) */
  code: string;
  label: string;
  /** 본문 최대 글자 수 (0 = 본문 미사용 유형) */
  maxMessage: number;
  maxNewline: number;
  maxButtons: number;
  minButtons: number;
  /** 쿠폰을 함께 쓰면 버튼 상한이 줄어든다 */
  couponMaxButtons: number;
  couponDescMax: number;
  /** 헤더 최대 글자 수 (0 = 헤더 미사용) */
  maxHeader: number;
  requireImage: boolean;
  requireHeader: boolean;
  requireVideo: boolean;
  requireCommerce: boolean;
  /** 와이드 리스트 아이템 개수 (캐러셀은 이 축을 쓰지 않는다) */
  minItems: number;
  maxItems: number;
  /** 버튼명 최대 글자 수 — TEXT·IMAGE 14 / 그 외 8 */
  maxButtonName: number;
  /** 부가 정보 (0 = 사용 불가 유형) */
  maxAdditional: number;
  maxAdditionalNewline: number;
  /** 상품명 최대 글자 수 (0 = 커머스 아닌 유형) */
  maxCommerceTitle: number;
  carousel?: BrandSpecCarousel;
  /** 실측을 통과해 발송이 열린 유형인가 */
  opened: boolean;
}

export type BrandBubbleType = keyof typeof BRAND_SPEC;

export const BRAND_SPEC: Record<string, BrandSpec> = {
    "TEXT": {
      "code": "TEXT",
      "label": "텍스트",
      "maxMessage": 1300,
      "maxNewline": 99,
      "maxButtons": 5,
      "minButtons": 0,
      "couponMaxButtons": 4,
      "couponDescMax": 12,
      "maxHeader": 0,
      "requireImage": false,
      "requireHeader": false,
      "requireVideo": false,
      "requireCommerce": false,
      "minItems": 0,
      "maxItems": 0,
      "maxButtonName": 14,
      "maxAdditional": 0,
      "maxAdditionalNewline": 0,
      "maxCommerceTitle": 0,
      "opened": true
    },
    "IMAGE": {
      "code": "IMAGE",
      "label": "이미지",
      "maxMessage": 1300,
      "maxNewline": 29,
      "maxButtons": 5,
      "minButtons": 0,
      "couponMaxButtons": 4,
      "couponDescMax": 12,
      "maxHeader": 0,
      "requireImage": true,
      "requireHeader": false,
      "requireVideo": false,
      "requireCommerce": false,
      "minItems": 0,
      "maxItems": 0,
      "maxButtonName": 14,
      "maxAdditional": 0,
      "maxAdditionalNewline": 0,
      "maxCommerceTitle": 0,
      "opened": true
    },
    "WIDE": {
      "code": "WIDE",
      "label": "와이드 이미지",
      "maxMessage": 76,
      "maxNewline": 5,
      "maxButtons": 2,
      "minButtons": 0,
      "couponMaxButtons": 2,
      "couponDescMax": 18,
      "maxHeader": 0,
      "requireImage": true,
      "requireHeader": false,
      "requireVideo": false,
      "requireCommerce": false,
      "minItems": 0,
      "maxItems": 0,
      "maxButtonName": 8,
      "maxAdditional": 0,
      "maxAdditionalNewline": 0,
      "maxCommerceTitle": 0,
      "opened": true
    },
    "WIDE_ITEM_LIST": {
      "code": "WIDE_ITEM_LIST",
      "label": "와이드 리스트",
      "maxMessage": 0,
      "maxNewline": 0,
      "maxButtons": 2,
      "minButtons": 0,
      "couponMaxButtons": 2,
      "couponDescMax": 18,
      "maxHeader": 20,
      "requireImage": false,
      "requireHeader": true,
      "requireVideo": false,
      "requireCommerce": false,
      "minItems": 3,
      "maxItems": 4,
      "maxButtonName": 8,
      "maxAdditional": 0,
      "maxAdditionalNewline": 0,
      "maxCommerceTitle": 0,
      "opened": false
    },
    "CAROUSEL_FEED": {
      "code": "CAROUSEL_FEED",
      "label": "캐러셀 피드",
      "maxMessage": 0,
      "maxNewline": 0,
      "maxButtons": 0,
      "minButtons": 0,
      "couponMaxButtons": 0,
      "couponDescMax": 12,
      "maxHeader": 0,
      "requireImage": false,
      "requireHeader": false,
      "requireVideo": false,
      "requireCommerce": false,
      "minItems": 0,
      "maxItems": 0,
      "maxButtonName": 8,
      "maxAdditional": 0,
      "maxAdditionalNewline": 0,
      "maxCommerceTitle": 0,
      "carousel": {
        "introHeaderMax": 20,
        "introContentMax": 50,
        "introContentNewline": 2,
        "listMinWithIntro": 1,
        "listMaxWithIntro": 5,
        "listMin": 2,
        "listMax": 6,
        "itemHeaderMax": 20,
        "itemMessageMax": 180,
        "itemMessageNewline": 10,
        "itemAdditionalMax": 34,
        "itemAdditionalNewline": 1,
        "itemButtonMax": 2,
        "allowIntro": false,
        "itemHeader": "required",
        "itemMessage": "required",
        "itemAdditional": "forbidden"
      },
      "opened": false
    },
    "PREMIUM_VIDEO": {
      "code": "PREMIUM_VIDEO",
      "label": "프리미엄 동영상",
      "maxMessage": 76,
      "maxNewline": 5,
      "maxButtons": 1,
      "minButtons": 0,
      "couponMaxButtons": 1,
      "couponDescMax": 18,
      "maxHeader": 20,
      "requireImage": false,
      "requireHeader": false,
      "requireVideo": true,
      "requireCommerce": false,
      "minItems": 0,
      "maxItems": 0,
      "maxButtonName": 8,
      "maxAdditional": 0,
      "maxAdditionalNewline": 0,
      "maxCommerceTitle": 0,
      "opened": false
    },
    "COMMERCE": {
      "code": "COMMERCE",
      "label": "커머스",
      "maxMessage": 0,
      "maxNewline": 0,
      "maxButtons": 2,
      "minButtons": 1,
      "couponMaxButtons": 2,
      "couponDescMax": 12,
      "maxHeader": 0,
      "requireImage": true,
      "requireHeader": false,
      "requireVideo": false,
      "requireCommerce": true,
      "minItems": 0,
      "maxItems": 0,
      "maxButtonName": 8,
      "maxAdditional": 34,
      "maxAdditionalNewline": 1,
      "maxCommerceTitle": 30,
      "opened": false
    },
    "CAROUSEL_COMMERCE": {
      "code": "CAROUSEL_COMMERCE",
      "label": "캐러셀 커머스",
      "maxMessage": 0,
      "maxNewline": 0,
      "maxButtons": 0,
      "minButtons": 0,
      "couponMaxButtons": 0,
      "couponDescMax": 12,
      "maxHeader": 0,
      "requireImage": false,
      "requireHeader": false,
      "requireVideo": false,
      "requireCommerce": true,
      "minItems": 0,
      "maxItems": 0,
      "maxButtonName": 8,
      "maxAdditional": 0,
      "maxAdditionalNewline": 0,
      "maxCommerceTitle": 30,
      "carousel": {
        "introHeaderMax": 20,
        "introContentMax": 50,
        "introContentNewline": 2,
        "listMinWithIntro": 1,
        "listMaxWithIntro": 5,
        "listMin": 2,
        "listMax": 6,
        "itemHeaderMax": 20,
        "itemMessageMax": 180,
        "itemMessageNewline": 10,
        "itemAdditionalMax": 34,
        "itemAdditionalNewline": 1,
        "itemButtonMax": 2,
        "allowIntro": true,
        "itemHeader": "forbidden",
        "itemMessage": "forbidden",
        "itemAdditional": "allowed"
      },
      "opened": false
    }
  };

/** 유형 표시 순서 — 화면 카드 나열은 이 순서를 따른다 */
export const BRAND_TYPE_ORDER = Object.keys(BRAND_SPEC);

/** 쿠폰 제목 형식 안내 — 백엔드 `COUPON_TITLE_GUIDE`와 같은 문구를 쓴다 */
export const BRAND_COUPON_TITLE_FORMS = [
  '1,000원 할인 쿠폰',
  '10% 할인 쿠폰',
  '배송비 할인 쿠폰',
  'OOO 무료 쿠폰',
  'OOO UP 쿠폰',
];
