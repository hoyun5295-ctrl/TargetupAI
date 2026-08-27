/**
 * DM 속성 계약 (SoT) — 편집기가 노출하는 속성이 발행물(SSR·CSS)에 실제로 반영되는지 기계로 검증하는 근거표.
 *
 * ★ 2026-07-14 신설 — 재발 방지책 1 ("편집기 ≠ 발행" 이음새 차단).
 *   배경: 0713~0714 디자인 3.0/4.0 대개편에서 연결부 색(#2)·줄바꿈(#3)·폰트(#5)·그라데이션 2색(#6) 등
 *   "편집기에서 고를 수 있는데 발행물엔 반영 안 되는" 이음새가 반복. 스냅샷 테스트는 "렌더됨"만 보고
 *   "속성이 실제로 소비되는가"는 못 잡는다. 이 표를 근거로 dm-editor-parity.test.ts가 각 속성의 소비를 강제한다.
 *
 * 규칙: 편집기에 새 속성/옵션(배경면·연결부·구도·텍스트 필드 등)을 추가하면 반드시 이 표에 등재한다.
 *   → 등재하면 파리티 테스트가 "그 값이 SSR/CSS 출력에서 실제로 달라지는지"를 밟아 미소비를 배포 전 차단한다.
 *   (DmRightPanel BACKGROUND_OPTIONS/DIVIDER_OPTIONS/TREATMENT_OPTIONS 와 값이 일치해야 한다.)
 */

/** 배경면 옵션 — 각 값은 CSS에서 자체 배경 + 연결부(divider) 착색 규칙을 가져야 한다(연결부가 보이려면 섹션 실제 색으로 착색). */
export const DM_BACKGROUNDS = ['soft', 'tint', 'dark', 'gradient', 'glass'] as const;

/** 하단 연결부 모양 — 각 값은 SSR/캔버스에서 SVG(dm-divider-svg)로 방출돼야 한다. */
export const DM_DIVIDERS = ['wave', 'slant', 'curve'] as const;

/** 개행 반영 대상 — (섹션타입 × 구도 × 텍스트 필드): 이 조합에서 입력 개행이 발행물에 보존돼야 한다.
 *  헤드라인/서브카피 = `\n→<br>`, 본문 = `white-space:pre-wrap`. 한 구도라도 빠지면 "편집기는 2줄, 발행물은 1줄" 불일치. */
export const DM_NEWLINE_FIELDS: Array<{ type: string; treatment?: string; field: 'headline' | 'sub_copy' | 'body' }> = [
  { type: 'hero', treatment: 'classic', field: 'headline' },
  { type: 'hero', treatment: 'typographic', field: 'headline' },
  { type: 'hero', treatment: 'full_bleed', field: 'headline' },
  { type: 'hero', treatment: 'split', field: 'headline' },
  { type: 'hero', treatment: 'editorial_overlap', field: 'headline' },
  { type: 'hero', treatment: 'classic', field: 'sub_copy' },
  { type: 'hero', treatment: 'typographic', field: 'sub_copy' },
  { type: 'hero', treatment: 'full_bleed', field: 'sub_copy' },
  { type: 'hero', treatment: 'split', field: 'sub_copy' },
  { type: 'hero', treatment: 'editorial_overlap', field: 'sub_copy' },
  { type: 'text_card', treatment: 'classic', field: 'headline' },
  { type: 'text_card', treatment: 'lead', field: 'headline' },
  { type: 'text_card', treatment: 'framed', field: 'headline' },
  { type: 'text_card', treatment: 'quote', field: 'headline' },
  { type: 'text_card', treatment: 'classic', field: 'body' },
  { type: 'text_card', treatment: 'lead', field: 'body' },
  { type: 'text_card', treatment: 'framed', field: 'body' },
  { type: 'text_card', treatment: 'quote', field: 'body' },
];

/** 상품 이미지 맞춤 — cover/contain이 발행물 출력에서 실제로 달라져야 한다(#1 회귀 차단). */
export const DM_IMAGE_FITS = ['cover', 'contain'] as const;

/** ★ 2026-07-21 갤러리 이미지별 캡션 — 편집기(GalleryEditor) 입력 caption이 발행물에 "보이는 텍스트"(dm-gal-caption)로 표시돼야 한다.
 *  (임은지 신고 — 종전엔 alt 속성으로만 쓰여 화면 미표시. 슬라이드쇼는 이미 보이는 캡션이라 갤러리만 누락이었다.)
 *  미입력 시 캡션 div 미출력(회귀 0). 캔버스 GallerySection ↔ SSR renderGallery 미러. */
export const DM_GALLERY_CAPTION_VISIBLE = true;

/** ★ 2026-07-21 자동 슬라이드 일시정지 버튼 — 편집기(SlideshowEditor) show_pause가 발행물에 재생/정지 컨트롤(data-dm-slide-pause)로
 *  렌더되고 뷰어(dm-viewer.ts)가 그 클릭으로 자동 전환을 멈춰야 한다(임은지 신고 — 종전엔 렌더/뷰어 어디서도 소비 안 되는 고아 속성).
 *  기본 노출(default true). 슬라이드 2장 이상에서만(1장은 전환 없음). 캔버스 SlideshowSection 미러(미리보기라 비상호작용). */
export const DM_SLIDESHOW_PAUSE = true;

/** ★ 2026-07-30 (남지현 접수) 자동 슬라이드 크기 — 편집기(SlideshowEditor) slide_ratio가 발행 SSR·캔버스 슬라이드 이미지에 실제 소비돼야 한다.
 *  종전엔 16:9 cover 하드코딩이라 크기 조절 자체가 없었다. 16:9(기본·미지정=현행 출력 그대로=무회귀)/1:1/3:4 = 고정 비율 cover(슬라이드 간 높이 통일),
 *  original = 원본 비율 그대로(aspect-ratio 없음·height:auto·크롭 0 — 슬라이드마다 높이가 이미지를 따라감).
 *  SSR renderSlideshow ↔ 캔버스 SlideshowSection 미러. */
export const DM_SLIDESHOW_RATIOS = ['16:9', '1:1', '3:4', 'original'] as const;

/** ★ 2026-07-21 (#4a 임은지) 상품 슬라이드 = 상품 3개 초과 시 가로 스와이프 캐러셀(data-dm-pcarousel, scroll-snap) + 인디케이터 점(data-dm-pc-dots).
 *  2개 이하는 기존 그리드(회귀 0). 자동 전환은 미도입(auto_slide 토글 제거·수신자 수동 스와이프). 뷰어(dm-viewer.ts)가 스크롤↔점 동기화. 캔버스 NewSections 미러.
 *  (종전엔 show_indicator·auto_slide가 렌더/뷰어 어디서도 소비 안 되는 고아 속성이라 토글해도 단말 무변화였다.) */
export const DM_PRODUCT_CAROUSEL_SWIPE_MIN = 3;

/** ★ 2026-07-22 (임은지 재신고) 상품 슬라이드 인디케이터 = 페이지 단위. 카드가 페이지당 2개(50% 폭) 보이므로
 *  점 개수는 상품 수가 아니라 페이지 수(=ceil(상품수/2))여야 한다. 종전엔 상품 1개당 1점(아이템 단위)이라
 *  상품 4개면 점 4개·끝까지 스와이프해도 3번째 점에서 멈춤 → "한 페이지 더 있는 것처럼" 보였다.
 *  SSR renderProductCarousel·캔버스 ProductCarouselSection이 상품을 이 크기로 묶어 페이지 래퍼로 렌더하고
 *  점을 페이지 수만큼 방출한다. 뷰어(dm-viewer.ts)는 스크롤 컨테이너의 자식(=페이지)↔점을 1:1로 동기화한다. */
export const DM_PRODUCT_CAROUSEL_PER_PAGE = 2;

/** ★ 2026-07-21 (#3 남지현) 매장/고객센터 개행 보존 — business_hours·address 입력 개행이 발행물에 white-space:pre-line 으로 보존.
 *  (종전엔 escapeHtml만이라 \n이 공백으로 붕괴 → 편집창 3줄, 단말 1줄). card·classic 양 구도 SSR + 캔버스 StoreInfoSection 미러. */
export const DM_STORE_INFO_NEWLINE_FIELDS = ['business_hours', 'address'] as const;

/** ★ 2026-07-21 고아 토글 전수 배선 — 편집기 토글이 발행물/뷰어에 실제 소비돼야 한다(종전 전부 미소비 = 토글해도 단말 무변화).
 *  각 값 = 발행물에 나와야 하는 마커(뷰어 dm-viewer.ts가 같은 마커로 배선). enable_zoom=갤러리 링크 없는 이미지 라이트박스,
 *  allow_multiple=투표 복수 선택+제출, show_progress=설문 진행률 실시간.
 *  [제거된 죽은 컨트롤] show_result_after_vote(실시간 득표 집계 API 미구축)·enable_user_location(매장 좌표 스키마+Geolocation 미구축)
 *  = 켜도 발송물 무변화라 편집기 토글 제거(no_dead_controls). 집계 API / 좌표 스키마 신설 후 별도 기능으로 재도입 예정. */
export const DM_WIRED_ORPHAN_MARKERS = {
  gallery_enable_zoom: 'data-dm-zoom',
  poll_allow_multiple: 'data-dm-poll-multi',
  survey_show_progress: 'data-dm-survey-progress',
  // ★ 2026-07-22 (임은지) 이메일 수집 "완료 문구"(success_text) — 편집기 입력이 발행 폼에 data-success-text로 실리고
  //   뷰어(dm-viewer.ts) 폼 제출 성공 메시지가 이 값을 쓴다(미지정=기존 기본 문구). 종전엔 렌더/뷰어 어디서도 소비 안 됨(고아).
  email_success_text: 'data-success-text',
} as const;

/** ★ 2026-07-21 (#3 남지현) 매장/고객센터 라벨 = 구도별 발송 SSR 라벨을 캔버스가 미러해야 편집=발송.
 *  card 구도 = 웹/메일/영업(renderStoreInfoCard), classic = 홈페이지/이메일/영업시간(renderStoreInfoClassic).
 *  종전엔 캔버스(StoreInfoSection)가 구도 무관 classic 라벨 하드코딩 → card 구도서 편집창(홈페이지)≠단말(웹). 라벨 최종 통일은 브랜드보이스 합산 예정. */
export const DM_STORE_INFO_LABELS = {
  card:    { website: '웹', email: '메일', business_hours: '영업' },
  classic: { website: '홈페이지', email: '이메일', business_hours: '영업시간' },
} as const;

/** 갤러리 풀화면(full_bleed) — true면 발행물에서 섹션 패딩·이미지 라운드가 0이 돼 화면 꽉 참(완성 이미지 시안).
 *  미설정=현행 카드 프레임 유지. 편집기 GalleryEditor 토글과 값이 일치해야 한다(2026-07-15 서수란 신고). */
export const DM_GALLERY_FULL_BLEED = [false, true] as const;

/** ★ 2026-07-15 색·표시 옵션(남지현·임은지·서수란 신고 묶음) — 편집기 지정값이 발행 SSR에 실제 소비돼야 한다.
 *  미소비 = "편집기에서 고를 수 있는데 발행물엔 반영 안 됨"(A2·A3·B1·B2 신고 원인). dm-editor-parity가 각 소비를 밟는다.
 *  헤더 제목색/브랜드표시(HeaderEditor), CTA 버튼색(CtaEditor), 쿠폰 버튼색(CouponEditor),
 *  상품 배경/글씨공간색·이미지높이(ProductCarouselEditor)와 값이 일치해야 한다. */
export const DM_COLOR_TABLE_2026_07_15: Array<{ section: string; prop: string; desc: string }> = [
  { section: 'header', prop: 'title_color', desc: '헤더 제목(브랜드명) 색' },
  { section: 'header', prop: 'show_brand_name', desc: '브랜드명 표시/로고만' },
  { section: 'cta', prop: 'button.color', desc: 'CTA 버튼 색' },
  { section: 'coupon', prop: 'button_color', desc: '쿠폰코드 알약 배경색 (2026-07-23 재정의, 옛 CTA 색 · 상세=DM_COLOR_TABLE_2026_07_23)' },
  { section: 'product_carousel', prop: 'background_color', desc: '상품슬라이드 배경색' },
  { section: 'product_carousel', prop: 'caption_bg_color', desc: '상품슬라이드 글씨공간 색' },
  { section: 'product_carousel', prop: 'image_height', desc: '상품 이미지 높이' },
];

/** 그라데이션 하단 연결부 = 그라데이션 끝색(--dm-grad-to)으로 착색돼야 이어짐(2026-07-15 임은지 — 시작색만 반영 결함). */
export const DM_GRADIENT_DIVIDER_ENDCOLOR = true;

/** ★ 2026-07-20 아트디렉션 모티프(브랜드킷 art_direction.accentMotif) — 값 축이 아니라 "장식이 걸리는 마크업 클래스" 축.
 *  rule=제목 위 30x3 강조색 막대 / bracket=제목 양옆 괄호 / index=제목 위 일련번호 / dot=제목 끝 점.
 *  전부 `.dm-text-h2`의 ::before·::after로 걸리므로, 발행 SSR과 편집 캔버스가 같은 섹션 제목에
 *  같은 클래스를 붙여야 편집=발행이다(2026-07-20 남지현 재오픈 — 캔버스만 클래스 없는 div였다).
 *  소비 검증 = dm-title-parity.test.ts(섹션별 제목 수까지 대조). 섹션 제목 마크업을 손대면 이 표를 함께 본다. */
export const DM_MOTIF_TITLE_HOOK = {
  cssClass: 'dm-text-h2',
  motifs: ['rule', 'bracket', 'index', 'dot'] as const,
  /** 발행·편집 양쪽이 제목에 위 클래스를 붙여야 하는 섹션 루트 클래스 */
  sections: ['dm-product-carousel', 'dm-gallery', 'dm-poll', 'dm-reviews', 'dm-text-card'] as const,
} as const;

/** ★ 2026-07-21 섹션 셸 정합 — 발행 SSR이 dmEventCard(아이콘+오버라인 헤더의 큰 이벤트 카드)로 감싸는 섹션은
 *  편집 캔버스도 DmEventCard로 감싸야 편집=발행(옛 단순 CARD_STYLE이면 셸 구조가 달라 편집≠발행). 소비 검증 = dm-title-parity.test.ts.
 *  [제외] instant_coupon = 배경이 primary-light라 dmEventCard 함수 대신 양쪽 인라인 미러(별도 유지). */
export const DM_EVENT_CARD_SECTIONS = [
  'dm-poll', 'dm-survey', 'dm-email-capture', 'dm-click-rewards',
  'dm-lucky-draw', 'dm-roulette', 'dm-limited-quantity',
] as const;

/** ★ 2026-07-23 (임은지) 쿠폰/탭/즉시쿠폰 색·크기 분리 — 편집기 신규 색 컨트롤이 발행 SSR에 실제 소비돼야 한다.
 *  쿠폰: button_color=쿠폰코드 알약 배경(옛 '쿠폰 사용하기' CTA 색에서 재정의·CTA는 공통 버튼색)·code_text_color=쿠폰코드 글씨·label_color=할인 라벨 글씨·card_bg_color=쿠폰 카드 배경.
 *  탭카드: tab_active_bg/tab_active_text_color=활성 탭 버튼 배경/글씨 + 탭 버튼 글씨 크기=섹션 title_size(--dm-fs-tab)·탭 내용=text_size(옛: 둘 다 fs-small이라 본문 크기가 버튼까지 바꿈).
 *  즉시쿠폰: button_bg_color/button_text_color='쿠폰 받기' 버튼 배경/글씨. 미지정=기존 기본값(회귀 0). dm-editor-parity가 각 소비를 밟는다. */
export const DM_COLOR_TABLE_2026_07_23: Array<{ section: string; prop: string; desc: string }> = [
  { section: 'coupon', prop: 'button_color', desc: '쿠폰코드 알약 배경색' },
  { section: 'coupon', prop: 'code_text_color', desc: '쿠폰코드 글씨색' },
  { section: 'coupon', prop: 'label_color', desc: '할인 라벨 글씨색' },
  { section: 'coupon', prop: 'card_bg_color', desc: '쿠폰 카드 배경색' },
  { section: 'tab_cards', prop: 'tab_active_bg', desc: '활성 탭 버튼 배경색' },
  { section: 'tab_cards', prop: 'tab_active_text_color', desc: '활성 탭 버튼 글씨색' },
  { section: 'instant_coupon', prop: 'button_bg_color', desc: '쿠폰 받기 버튼 배경색' },
  { section: 'instant_coupon', prop: 'button_text_color', desc: '쿠폰 받기 버튼 글씨색' },
];

/** ★ 2026-08-26 상품 슬라이드 제목 크기·색(임은지 접수 cmt9gn8of01vujnotzl63acsl) —
 *  **DM·이메일 양쪽 렌더러가 함께 소비해야 한다.** 한쪽만 넣으면 같은 접수의 나머지 절반
 *  (편집기에는 있는데 이메일 발송 HTML엔 반영 안 됨)을 그대로 재생산한다.
 *  DM 소비 검증 = dm-editor-parity.test.ts / 이메일 = email/__tests__/email-editor-parity.test.ts
 *  이메일 원장 = utils/email/email-property-contract.ts (공용 편집기 속성은 두 표에 함께 등재한다). */
export const DM_PRODUCT_TITLE_PROPS: Array<{ section: string; prop: string; desc: string }> = [
  { section: 'product_carousel', prop: 'title_size', desc: '상품슬라이드 제목 크기 sm|md|lg (미지정 = md = 현행)' },
  { section: 'product_carousel', prop: 'title_color', desc: '상품슬라이드 제목 색 (미지정 = 본문색)' },
];
