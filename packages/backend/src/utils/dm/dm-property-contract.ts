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
  { section: 'coupon', prop: 'button_color', desc: '쿠폰 버튼 색' },
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
