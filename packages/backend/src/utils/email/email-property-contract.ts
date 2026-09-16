/**
 * 이메일 속성 계약 (SoT) — 편집기가 노출하는 속성이 **이메일 발송 HTML**에 실제로 반영되는지
 * 기계로 검증하는 근거표. `dm-property-contract.ts`의 이메일 판이다.
 *
 * ★ 2026-08-26 신설 — 경위: 상품 슬라이드의 배경색·글씨공간 색·이미지 높이·정렬·맞춤 5개가
 *   편집기에는 있는데 이메일 렌더러가 한 번도 읽지 않았다(임은지 접수 `cmt9gn8of01vujnotzl63acsl`).
 *   편집 패널은 `components/dm/panels/editors/*`를 DM과 **공유**하는데, 반영 검증은 DM에만 있었다.
 *   그래서 2026-07-15 서수란 신고로 만든 필드가 DM만 받고 이메일은 못 받은 채 살아남았다.
 *
 * 규칙: 공용 편집기에 새 속성을 추가하면 **이 표와 DM 표 양쪽**에 등재한다.
 *   → `email-editor-parity.test.ts`가 "값을 바꾸면 출력이 실제로 달라지는가"를 밟아 미소비를 배포 전에 막는다.
 */

/** 상품 슬라이드 — 편집기(ProductCarouselEditor)가 노출하는 속성 전량 */
export const EMAIL_PRODUCT_CAROUSEL_PROPS: Array<{ prop: string; desc: string }> = [
  { prop: 'background_color', desc: '섹션 배경 · 맞추기 여백 (미지정 = 없음)' },
  { prop: 'caption_bg_color', desc: '상품명·가격 카드 배경 (미지정 = 테마 카드색)' },
  { prop: 'image_fit', desc: '이미지 맞춤 cover|contain (미지정 = cover)' },
  { prop: 'image_focus', desc: '채우기일 때 보일 위치 top|center|bottom (미지정 = center)' },
  { prop: 'image_height', desc: '이미지 높이 sm|md|lg (미지정 = md = 현행)' },
  { prop: 'title_size', desc: '제목 크기 sm|md|lg (미지정 = md = 현행)' },
  { prop: 'title_color', desc: '제목 색 (미지정 = 테마 본문색)' },
];

/** 이미지 높이 px — **md = 현행 값**이라 미지정 캠페인은 출력이 한 글자도 안 바뀐다. */
export const EMAIL_PRODUCT_IMG_HEIGHT = { sm: 140, md: 200, lg: 260 } as const;

/** 리스트 구도 썸네일 px — 같은 규칙(md = 현행 96). */
export const EMAIL_PRODUCT_LIST_THUMB = { sm: 72, md: 96, lg: 128 } as const;

/** 구도 = 이 속성들이 **전 구도에서** 소비돼야 한다. 한 구도라도 빠지면 "구도를 바꾸면 색이 사라진다"가 된다
 *  (DM에서 2026-07-16 서수란 신고로 이미 한 번 겪은 형태 — classic에만 먹던 것). */
export const EMAIL_PRODUCT_TREATMENTS = ['classic', 'list', 'focus'] as const;

/** 제목 크기 → 타이포 토큰 키. **md = h3 = 현행**이라 미지정 캠페인은 제목 출력이 안 바뀐다. */
export const EMAIL_PRODUCT_TITLE_SIZE_KEY = { sm: 'body', md: 'h3', lg: 'h2' } as const;

/** 히어로 — 편집기(HeroEditor)가 노출하는 속성 중 **이미지가 있을 때** 렌더에 반영돼야 하는 것.
 *  ★ 2026-08-27 추가 — 상품 슬라이드만 등재하고 히어로를 빼 둔 탓에 같은 부류(편집기에는 있는데
 *  렌더러가 안 읽음)가 하루 만에 다시 접수됐다(`cmtb65jft02y5jnot96pjwvjo`). 섹션을 빼놓으면 원장이 아니다. */
export const EMAIL_HERO_PROPS: Array<{ prop: string; desc: string }> = [
  { prop: 'height', desc: '히어로 높이 sm|md|lg|full (미지정 = md 320px)' },
  { prop: 'image_fit', desc: '이미지 맞춤 cover|contain (미지정 = cover)' },
  { prop: 'focus', desc: '이미지 초점 center|top|bottom (미지정 = center)' },
  { prop: 'align', desc: '텍스트 정렬 left|center|right' },
  { prop: 'headline_color', desc: '헤드라인 색' },
  { prop: 'headline_size', desc: '헤드라인 크기(px)' },
  { prop: 'sub_copy_color', desc: '서브카피 색' },
  { prop: 'sub_copy_size', desc: '서브카피 크기(px)' },
];

/** 히어로 구도 = EMAIL_TREATMENTS.hero와 같아야 한다. 이미지를 쓰는 구도는 classic·split 둘. */
export const EMAIL_HERO_IMAGE_TREATMENTS = ['classic', 'split'] as const;

/** ★ 2026-09-04 남지현 접수(`cmtl5wq5v0800jnotk46ozykf`) "구도 기본으로 넣은 히어로 이미지가 수신함에서 사라진다" —
 *  기본 구도만 사진을 CSS `background-image`로 내보내고 있었다. CSS 배경을 지우는 클라이언트에서는
 *  폴백색만 남아 검정 면이 된다. 같은 메일의 분할 구도(`<img>`)는 정상이었으니 태그가 갈랐다.
 *  ⛔ **이메일에서 사진은 반드시 `<img>`로 나간다.** MSO VML 폴백은 아웃룩 데스크탑만 덮으므로
 *  웹메일이 CSS 배경을 지우는 경우를 못 막는다 — 배경 CSS는 사진 전달 수단이 아니다.
 *  (그라데이션·단색 `background-image:linear-gradient(...)`는 장식이라 대상이 아니다. 금지 대상은 `url(...)`뿐.) */
export const EMAIL_PHOTO_AS_IMG_TAG = true;

/** ★ 2026-09-04 남지현 접수(`cmtl3y8c207z2jnotlgv7nz4c`) "텍스트 카드에 자동으로 숫자(순번)가 붙는다(제거 불가)" —
 *  번호는 텍스트 카드 기능이 아니라 아트디렉션 모티프(`design.art_direction.accentMotif='index'`)다.
 *  테마 2종(볼드 세일·시티 나이트)과 AI 골든 템플릿 팔레트가 이 값을 함께 싣는데 **고를 입구가 없어**
 *  끄려면 색·서체까지 바뀌는 다른 테마로 갈아타는 수밖에 없었다(2026-08-27 서체와 같은 부류 = 입구 부재).
 *  처방 두 축 = ①전역 = 테마 모달의 "포인트 장식" 선택(FE `EMAIL_MOTIF_OPTIONS` · 렌더러는 이미 소비 중)
 *  ②블록별 = `section.motif='none'`(이 표). 미설정 = 테마를 따른다(현행 출력 무변화).
 *  ⛔ 장식 축 하나를 끄는 것이라 번호만이 아니라 막대·점·괄호도 함께 꺼진다. */
export const EMAIL_SECTION_MOTIF_OFF = 'none' as const;

/** 모티프를 그리는 섹션 = 편집기 "포인트 장식" 컨트롤 노출 대상과 같아야 한다(죽은 컨트롤 금지).
 *  히어로는 이미지가 있는 구도에서 모티프를 그리지 않으므로 텍스트만 있는 상태로 밟는다. */
export const EMAIL_MOTIF_SECTIONS = ['hero', 'text_card'] as const;

/** 히어로 높이 px — 렌더러 HERO_HEIGHT_PX와 같은 값(원장이 기대치를 소유한다). */
export const EMAIL_HERO_HEIGHT = { sm: 200, md: 320, lg: 480, full: 600 } as const;

/** 캠페인 단위 디자인(`design`) 축 — 테마 모달·서체 모달이 패치하는 값.
 *  ★ 2026-08-27 서체 지정 접수(`cmtb6kn6j0369jnotmslux7i2`) — 렌더러는 이미 읽고 있었고 **고를 입구만 없었다.**
 *  입구를 붙이는 축이라도 "읽히고 있다"를 계약으로 고정해 둔다. 안 그러면 다음에 렌더러를 손볼 때 조용히 끊긴다. */
export const EMAIL_DESIGN_PROPS: Array<{ prop: string; desc: string; probe: string }> = [
  { prop: 'font_family', desc: '본문 서체 (미지정 = 브랜드킷 → 기본)', probe: '"Noto Serif KR", serif' },
  { prop: 'font_display', desc: '제목 서체 (미지정 = 본문 서체)', probe: '"Black Han Sans", sans-serif' },
];

/** 헤더 — 로고 구도에서 브랜드명에 걸리는 지정값.
 *  ★ 2026-08-31 임은지 접수(`cmtgt4pgm0543jnot7j7j02xu`) "브랜드명 색을 바꿔도 검은색 고정" —
 *  렌더러가 테마 본문색을 리터럴로 박아 두고 `title_color`를 읽지 않았다. DM은 같은 값을 읽고 있었다. */
export const EMAIL_HEADER_PROPS: Array<{ prop: string; desc: string; probe: unknown }> = [
  { prop: 'title_color', desc: '브랜드명 색 (미지정 = 테마 본문색)', probe: '#c2185b' },
];

/** CTA 버튼 — **버튼 배열 안의** 지정값이라 섹션 prop과 형태가 다르다(그래서 표를 나눴다).
 *  ★ 2026-08-31 임은지 접수(`cmtgtxqdj054jjnot99virpq9`) "스타일 3가지 어디서도 버튼색이 안 먹는다" —
 *  `renderButton`이 `color`를 한 번도 참조하지 않았다. 규칙은 DM `ctaBtnColorStyle`과 같은 한 벌이다.
 *  ⛔ 스타일 3종 전부에서 반영돼야 한다 — 하나라도 빠지면 "스타일을 바꾸면 색이 사라진다"가 된다. */
export const EMAIL_CTA_BUTTON_PROPS: Array<{ prop: string; desc: string; probe: unknown }> = [
  { prop: 'color', desc: '버튼 색 (미지정 = 스타일 기본색 · outline은 테두리·글씨, 그 외는 배경)', probe: '#0f766e' },
];

/** CTA 버튼 스타일 = 이 셋 전부에서 지정색이 반영돼야 한다(편집기 Select의 값과 같아야 한다). */
export const EMAIL_CTA_BUTTON_STYLES = ['primary', 'secondary', 'outline'] as const;

/** 쿠폰 — 편집기(CouponEditor)가 노출하는 속성 중 이메일 렌더러가 소비해야 하는 것.
 *  ★ 2026-09-02 남지현 접수(`cmtjhsd8a06y9jnotvcc8pqo6`) "쿠폰 탭에서 URL을 넣어도 클릭되는 부분이 없다" —
 *  `renderCoupon`이 `cta_url`을 한 줄도 읽지 않아 `<a>`가 아예 생성되지 않았다(제목·본문·버튼 전부 죽은 텍스트).
 *  접수는 URL 하나였지만 대조해 보니 **색 4개도 같은 상태**였다. DM SSR(`dm-section-renderer` 303·322·339행)과
 *  편집 캔버스(`CouponSection.tsx`)는 5개 전부 소비 중이었으니 **이메일만** 죽어 있었다.
 *  쿠폰을 원장에 안 넣어 둔 탓에 파리티가 이 결함을 잡을 수단이 없었다 — 섹션을 빼놓으면 원장이 아니다
 *  (2026-08-27 히어로와 같은 형태가 세 번째다). 공용 편집기에 속성을 더하면 DM 표와 이 표 양쪽에 등재한다.
 *  ⛔ 구도 2종 전부에서 반영돼야 한다 — 한쪽만 소비하면 "구도를 바꾸면 색이 사라진다"가 된다. */
export const EMAIL_COUPON_PROPS: Array<{ prop: string; desc: string; probe: unknown }> = [
  { prop: 'cta_url', desc: '연결 URL: "쿠폰 사용하기" 버튼 (미지정 = 버튼 없음 = 현행)', probe: 'https://shop.example.com/coupon' },
  { prop: 'label_color', desc: '할인 라벨 글씨색 (미지정 = 구도별 현행)', probe: '#c2185b' },
  { prop: 'card_bg_color', desc: '쿠폰 카드 배경색 (미지정 = 구도별 현행)', probe: '#fff7ed' },
  { prop: 'button_color', desc: '쿠폰코드 알약 배경 (미지정 = 구도별 현행)', probe: '#0f766e' },
  { prop: 'code_text_color', desc: '쿠폰코드 글씨색 (미지정 = 구도별 현행)', probe: '#7c3aed' },
];

/** ★ 2026-09-15 리뷰(임은지 접수 `cmu2ao5qn02tjjnlu1spouqzy`) "별점이 흰색이라 안 보인다 · 평균 별점 표시를 꺼도 그대로다".
 *  별 색은 강조색 한 줄에서만 와서 고를 입구가 없었고, show_average_rating 은 이메일 렌더러가 한 번도 읽지 않았다(평균 줄 자체가 없었다).
 *  편집 패널은 DM과 공용이라 DM 표(`DM_REVIEWS_PROPS`)와 함께 등재한다. 평균 줄 기본 = 표시(편집기 기본값 `?? true`와 같다). */
export const EMAIL_REVIEWS_PROPS: Array<{ prop: string; desc: string; probe: unknown }> = [
  { prop: 'star_color', desc: '별점 색: 리뷰별 별 · 평균 별 (미지정 = 강조색)', probe: '#b45309' },
  { prop: 'show_average_rating', desc: '평균 별점 줄 (미지정 = 표시)', probe: false },
];

/** 쿠폰 구도 = 이메일 렌더러가 가르는 두 갈래(`renderCoupon`의 spotlight 분기와 그 밖). */
export const EMAIL_COUPON_TREATMENTS = ['classic', 'spotlight'] as const;

// ════════════════════════════════════════════════════════════
// ★ 2026-09-16 전수 대조 (남지현·임은지 접수 8건)
//
//   경위: 위 표들은 **접수가 온 섹션만** 사람이 손으로 등재하는 방식이었다. 그래서 등재 안 한 섹션은
//   파리티가 밟을 수단 자체가 없었고, 같은 부류(편집기에는 있는데 이메일 렌더러가 안 읽음)가
//   히어로(08-27)·쿠폰(09-02)·리뷰(09-15)에 이어 **네 번째**로 왔다 — 이번엔 한 번에 6건이다
//   (헤더 형태 D-Day·쿠폰 · 헤더 브랜드명 표시 · 히어로 오버레이 프리셋 · 매장 지도 링크 ·
//    SNS 표시 방식·핸들 · 푸터 수신거부 토글). LESSONS_FRONTEND 2026-08-27 절이 남긴
//   "이메일 렌더 섹션 전수 대조 = 별도 과제"가 이것이다.
//
//   그래서 등재를 사람 손에서 뺀다. `email-editor-coverage.test.ts`가 **공용 편집기 소스에서
//   속성을 직접 수집**해 이메일 렌더러 소비를 전수 대조하고, 안 읽는 속성은 아래 면제표에
//   사유와 함께 적혀 있어야만 통과한다. 새 속성을 공용 편집기에 붙이면 둘 중 하나를 하기 전에는
//   테스트가 깨진다 = 조용히 죽은 컨트롤이 다시 생길 자리가 없다.
// ════════════════════════════════════════════════════════════

/** 이메일이 그리는 블록 → 그 블록의 공용 편집기 파일(= 속성 수집 대상).
 *  키는 `EMAIL_BLOCK_WHITELIST`와 같아야 한다(빠지면 그 섹션은 또 원장 밖이 된다 — 커버리지 테스트가 대조). */
export const EMAIL_EDITOR_FILES: Record<string, string> = {
  header: 'HeaderEditor.tsx',
  hero: 'HeroEditor.tsx',
  text_card: 'TextCardEditor.tsx',
  cta: 'CtaEditor.tsx',
  coupon: 'CouponEditor.tsx',
  promo_code: 'PromoCodeEditor.tsx',
  product_carousel: 'ProductCarouselEditor.tsx',
  gallery: 'GalleryEditor.tsx',
  store_info: 'StoreInfoEditor.tsx',
  sns: 'SnsEditor.tsx',
  reviews: 'ReviewsEditor.tsx',
  footer: 'FooterEditor.tsx',
};

/** 렌더 함수 이름 — 소비 판정은 **그 섹션의 함수 본문 안**에서만 센다.
 *  (파일 전체 grep은 다른 섹션이 같은 이름을 쓰면 통과해 버린다 — 실제로 `map_url`·`email`이
 *   그 착시로 살아남을 뻔했다: 파일 어딘가에 단어는 있고 `renderStoreInfo` 안에는 없었다.) */
export const EMAIL_RENDER_FUNCTIONS: Record<string, string> = {
  header: 'renderHeader',
  hero: 'renderHero',
  text_card: 'renderTextCard',
  cta: 'renderCta',
  coupon: 'renderCoupon',
  promo_code: 'renderPromoCode',
  product_carousel: 'renderProductCarousel',
  gallery: 'renderGallery',
  store_info: 'renderStoreInfo',
  sns: 'renderSns',
  reviews: 'renderReviews',
  footer: 'renderFooter',
};

/** 이메일 렌더러가 **안 읽는 것이 정답인** 속성 — 사유 없이는 등재 불가.
 *  ⛔ "아직 안 했다"를 여기 적지 마라. 여기는 "이메일에서는 성립하지 않는다"만 적는 자리다.
 *  ⛔ 면제한 속성은 **이메일 편집기에서 컨트롤도 감춘다**(죽은 컨트롤 금지 — 감추지 않으면
 *     사용자에게는 "눌러도 안 바뀐다"로 똑같이 보인다). 대조 = `EMAIL_HIDDEN_EDITOR_FIELDS`. */
export const EMAIL_PROP_EXEMPT: Array<{ section: string; prop: string; why: string }> = [
  {
    section: 'product_carousel', prop: 'show_indicator',
    why: '이메일은 스와이프가 없다(정적 그리드·리스트로 전량 펼쳐 그린다). 넘길 것이 없으니 점 인디케이터가 가리킬 대상이 없다.',
  },
  {
    section: 'gallery', prop: 'enable_zoom',
    why: '이메일 본문은 클릭 확대(라이트박스)를 못 연다(JS 0). 이미지는 원본 링크로만 열린다.',
  },
  {
    section: 'footer', prop: 'show_unsubscribe_link',
    why: '이메일 수신거부는 편집기가 아니라 발송 엔진이 소유한다. 광고성(is_ad)이면 정보통신망법 §50④ footer(전송자 명칭·연락처·수신거부 링크)가 `email-channel.ts`에서 **항상** 자동 부착되고, 비광고성이면 붙지 않는다. 토글로 끄면 법 위반이라 켜고 끌 수 있는 값이 아니다. 대신 미리보기가 실제로 붙을 문구를 보여준다(EMAIL_FOOTER_SLOT 미리보기 치환).',
  },
];

/** 이메일 편집기가 공용 패널에서 **감추는** 필드 — 면제 속성(죽은 컨트롤) + 이메일 전용 컨트롤과 겹치는 중복.
 *  프론트 `EmailVisualEditor`가 이 목록을 그대로 `hiddenFields`로 넘긴다(교차 일치 = 커버리지 테스트).
 *  ★ 2026-09-16 headline_emphasis = 이메일 편집기 "블록 스타일"의 3버튼과 공용 패널 select가
 *    같은 값을 각각 노출해 한 화면에 위·아래 두 번 나왔다(남지현 접수 2건). 위쪽 하나만 남긴다. */
export const EMAIL_HIDDEN_EDITOR_FIELDS: Record<string, readonly string[]> = {
  hero: ['headline_emphasis'],
  text_card: ['headline_emphasis'],
  product_carousel: ['show_indicator'],
  gallery: ['enable_zoom'],
  footer: ['show_unsubscribe_link'],
};

/** 배열 속성 **안쪽**의 항목 필드 — 최상위 수집에 안 잡히므로 따로 적어 같은 대조를 받는다.
 *  (SNS 핸들이 이 사각에서 죽어 있었다: `channels`는 렌더러가 읽으니 통과, 안쪽 `handle`은 아무도 안 읽었다.)
 *  `via` = 섹션 함수가 그 항목을 넘겨 그리는 **위임 함수**. 적으면 소비 판정을 그 함수 본문에서 한다
 *  (버튼은 `renderCta`가 항목마다 `renderButton`을 부른다 — 섹션 함수만 보면 없는 것처럼 보인다). */
export const EMAIL_ITEM_PROPS: Array<{ section: string; prop: string; desc: string; via?: string }> = [
  { section: 'sns', prop: 'handle', desc: 'SNS 계정 핸들: 버튼(라벨 포함) 표시 방식에서 @핸들로 붙는다' },
  { section: 'cta', prop: 'color', desc: 'CTA 버튼별 지정색(EMAIL_CTA_BUTTON_PROPS가 행동으로 밟는다)', via: 'renderButton' },
];

/** ★ 2026-09-16 헤더 형태(남지현 접수 `cmu3m03ze03najnlu1fjw857n`) — 편집기 Select의 4값 전부가
 *  서로 다른 출력을 내야 한다. 옛 렌더러는 `banner`만 분기해 `countdown`·`coupon`이 로고형으로
 *  떨어졌고, 화면에는 브랜드명만 남아 "아무 변화가 없음"으로 접수됐다(접수 원문 그대로).
 *  ⛔ D-Day 숫자는 **렌더 시점** 기준 정적 계산이다(이메일은 JS가 없다 — 수신함에서 줄지 않는다).
 *    예약 발송이면 예약 시각이 아니라 렌더 시각 기준이라는 뜻이라, 카운트다운 전용 블록과 같은 한계다. */
export const EMAIL_HEADER_VARIANTS = ['logo', 'banner', 'countdown', 'coupon'] as const;

/** 헤더 — 형태별로 반드시 실려야 하는 입력값. 값이 출력에 없으면 "입력칸은 있는데 안 나간다"가 된다. */
export const EMAIL_HEADER_VARIANT_PROPS: Array<{ variant: string; props: readonly string[] }> = [
  { variant: 'countdown', props: ['event_title', 'event_date'] },
  { variant: 'coupon', props: ['discount_label', 'coupon_code'] },
  { variant: 'logo', props: ['brand_name', 'phone'] },
];

/** ★ 2026-09-16 브랜드명 표시(남지현 접수 `cmu3mkzba03wmjnlufa4o1n68`) — `false`면 브랜드명을 빼고
 *  **로고를 중앙**에 둔다(편집기 안내문 "끄면 로고만 (로고 중앙 정렬)"이 약속한 그대로).
 *  미지정/true = 현행 출력 무변화. */
export const EMAIL_HEADER_BRAND_OFF_ALIGN = 'center' as const;

/** ★ 2026-09-16 히어로 오버레이 프리셋(남지현 접수 `cmu3n4c4b03xfjnlumbg75qcz`) — 6값이 서로 다른 출력.
 *
 *  이메일 히어로는 2026-09-04 계약(EMAIL_PHOTO_AS_IMG_TAG)상 **사진이 `<img>`**라 DM처럼 사진 위에
 *  그라디언트를 겹칠 수 없다(CSS 배경을 지우는 수신 클라이언트에서 통째로 사라진다). 그래서 프리셋의
 *  뜻을 **사진에 붙는 텍스트 밴드**로 옮긴다 — 강도는 밴드 농도로, 방향(top)은 밴드 위치로.
 *  ⛔ 미지정(빈 값)은 손대지 않는다 = 옛 `overlay_gradient` 토글 그대로(기존 캠페인 출력 무변화). */
export const EMAIL_HERO_OVERLAY_BANDS: Record<string, { bg: string; onDark: boolean }> = {
  none:   { bg: '',        onDark: false }, // 밴드 없음 = 카드색 면(테마 본문색 글씨)
  soft:   { bg: '#3f3f3f', onDark: true },  // 옅은 다크 밴드
  strong: { bg: '#171717', onDark: true },  // 현행 다크 밴드와 같은 값
  brand:  { bg: '',        onDark: true },  // 브랜드 primary(런타임 주입 — 리터럴로 굳히지 않는다)
  top:    { bg: '#171717', onDark: true },  // 다크 밴드를 사진 **위**로
};

/** 오버레이 `top` = 밴드가 사진보다 먼저 나온다(위). 그 밖 = 사진 아래. */
export const EMAIL_HERO_OVERLAY_TOP = 'top' as const;

/** ★ 2026-09-16 매장/고객센터(임은지 접수 `cmu3lnjg403mgjnlu1fnxdmuc`) — 지도 링크·이메일 주소 미소비.
 *  DM SSR(`dm-section-renderer` 622·642행)·편집 캔버스는 둘 다 "매장 위치 보기"를 그리고 있었다. */
export const EMAIL_STORE_INFO_PROPS: Array<{ prop: string; desc: string; probe: string }> = [
  { prop: 'map_url', desc: '지도 링크(카카오·네이버) → "매장 위치 보기" 버튼', probe: 'https://map.kakao.com/link/map/test,37.5,127.0' },
  { prop: 'email', desc: '이메일 주소 줄(mailto 링크)', probe: 'shop@example.com' },
];

/** ★ 2026-09-16 SNS(임은지 접수 `cmu3lxucs03mqjnluyeihh7p4`) — 표시 방식 2값이 서로 다른 출력을 내야 한다.
 *  ⛔ 칩 배경은 `<a>` 인라인 `background` 단독으로 내보내지 않는다 — 같은 파일의 CTA 버튼은
 *    `<td>` 배경 + MSO VML 이중인데 SNS만 `<a>` 하나였고, 접수가 "하이웍스는 보이는데 아웃룩은
 *    글씨만"이었다. 표 셀의 `bgcolor` 속성은 아웃룩 Word 엔진도 읽는다(인라인 style과 병기). */
export const EMAIL_SNS_LAYOUTS = ['icons', 'buttons'] as const;

/** SNS 칩 = 배경을 `<td bgcolor>`로 싣는다(인라인 style 병기). 계약 이름으로 고정해 회귀를 막는다. */
export const EMAIL_SNS_CHIP_BGCOLOR_ATTR = true;

/** 아이콘 배치에서 **한 줄에 놓는 칩 수**. 표의 한 행은 줄바꿈되지 않으므로 여기서 끊는다.
 *  3 = 칩 폭(라벨 + 여백 약 110px) 셋이 모바일 본문 폭(약 360px)에 들어가는 최대치.
 *  ⛔ 늘리면 채널을 많이 등록한 회사의 메일에 가로 스크롤이 생긴다(DM은 flex-wrap이라 이 제약이 없다). */
export const EMAIL_SNS_CHIPS_PER_ROW = 3;
