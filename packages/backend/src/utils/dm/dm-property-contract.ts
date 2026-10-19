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

/** ★ 2026-09-16 카탈로그 쪽 상품 칩 — 가격·링크는 쪽 이미지에 새기지 않고 이 마커로 이미지 밖에 나온다.
 *  값 = gallery props.chips[{label, price?, url?}] · 렌더 = dm-section-renderer renderGalleryChips.
 *  이미지에 숫자를 새기지 않는 이유 = 값이 바뀌면 재합성 없이는 고칠 수 없다(설계서 2026-09-16 §5-3). */
export const DM_GALLERY_CHIP_MARKER = 'data-dm-chip';

/** ★ 2026-07-21 고아 토글 전수 배선 — 편집기 토글이 발행물/뷰어에 실제 소비돼야 한다(종전 전부 미소비 = 토글해도 단말 무변화).
 *  각 값 = 발행물에 나와야 하는 마커(뷰어 dm-viewer.ts가 같은 마커로 배선). enable_zoom=갤러리 링크 없는 이미지 라이트박스,
 *  allow_multiple=투표 복수 선택+제출, show_progress=설문 진행률 실시간.
 *  [제거된 죽은 컨트롤] show_result_after_vote(실시간 득표 집계 API 미구축)·enable_user_location(매장 좌표 스키마+Geolocation 미구축)
 *  = 켜도 발송물 무변화라 편집기 토글 제거(no_dead_controls). 집계 API / 좌표 스키마 신설 후 별도 기능으로 재도입 예정. */
export const DM_WIRED_ORPHAN_MARKERS = {
  gallery_enable_zoom: 'data-dm-zoom',
  poll_allow_multiple: 'data-dm-poll-multi',
  survey_show_progress: 'data-dm-survey-progress',
  // ★ 2026-07-22 (임은지) 이메일 수집 "완료 문구"(success_text) — 종전엔 렌더/뷰어 어디서도 소비 안 됨(고아).
  //   ★ 2026-10-14 (임은지 접수 ②) 자리를 **renderSection 래퍼**로 옮겨 참여 8종(PARTICIPATION_TYPES) 공통 마커가 됐다 —
  //   렌더러 doneTextOf → 래퍼 data-success-text → 뷰어 wrapInfo().done → 완료 분기. 블록 안쪽 속성(옛 자리)은 없다.
  email_success_text: 'data-success-text',
} as const;

/** ★ 2026-09-04 (임은지 접수 `cmtl45k4207zljnotyot1x338`) 제거한 죽은 컨트롤 — **다시 넣지 않기 위한 원장**.
 *  쿠폰 "할인 타입"(`percent|amount|free_shipping`)은 편집기(CouponEditor)만 쓰고 읽는 쪽이 한 곳도 없었다 —
 *  편집 캔버스(`CouponSection.tsx`)·DM 발행 SSR(`renderCoupon*`)·이메일(`renderCoupon`) 전수 grep 0건.
 *  접수 원문 그대로 "타입을 다르게 적용해도 화면에 달라지는 게 없다"였다. 혜택 표현은 `discount_label`
 *  자유 입력이 전부 담고, 쿠폰의 시각 변형 축은 **구도**(classic·ticket·spotlight)가 이미 소유한다.
 *  ⛔ 되살리려면 세 렌더 면과 두 계약표(이 표 + `email-property-contract`)에 함께 등재한다 —
 *  한쪽만 넣으면 "편집기에는 있는데 발행물엔 없음"이 그대로 재생산된다.
 *  같은 판단 선례 = 위 주석의 `show_result_after_vote`·`enable_user_location`(no_dead_controls).
 *  게이트 = `dm-editor-parity.test.ts` "제거된 죽은 컨트롤" 절(기본값·편집기 소스 양쪽 잔존 0). */
export type DmPropExempt = {
  section: string;
  prop: string;
  /** 어느 면에서 탐침이 출력을 못 바꾸는가: ssr(발행 렌더) · canvas(편집 캔버스 이름 대조) · email(이메일 렌더) */
  surface: 'ssr' | 'canvas' | 'email';
  /** 왜 그런가: server(서버가 읽는다 → reader 본문에 `.prop` 실재) · viewer(뷰어가 data-*로 읽는다) ·
   *  n/a(그 면에서 뜻이 없다 · 다른 면이 소비) · removed(편집기·기본값 양쪽에서 지웠고 되살리면 실패) */
  kind: 'server' | 'viewer' | 'n/a' | 'removed';
  /** 20자 이상 · "아직"·"예정"·"미구현" 금지(미검토는 DM_PROP_UNREVIEWED 래칫으로) */
  why: string;
  /** kind=server일 때 그 값을 읽는 함수 이름(dm-interaction*.ts) — 본문에 `.prop`이 있어야 통과(파일 전체 스캔 X) */
  reader?: string;
  /** 이 구도에서만 면제(CTA 배치처럼 구도가 소비 여부를 가르는 경우) */
  treatment?: string;
};

/**
 * ★ 2026-10-19 B-1014-3⑦ 구도가 안 읽는 값 — 그 구도에서 **편집기가 컨트롤을 감춘다**(눌러도 안 바뀌는 칸 0) · 면제 행(n/a)도 여기서 펼친다.
 *   surface 'ssr' = 모바일 DM 편집기(공용 패널 기본) · 'email' = 이메일 편집기(surface="email"). 근거 = 탐침 실측(2026-10-14 첫 실측 · 아래 시험이 실패 실재를 밟는다).
 *   화면 미러 = frontend `constants/dm-treatment-hidden-fields.ts`(손으로 고치지 않는다 · 파리티 = dm-editor-coverage.test.ts).
 *   CTA 배치 · 버튼 모양은 CtaEditor 가 구도로 직접 감춘다(아래 개별 행 · ctaLayoutApplies 소유).
 */
export const DM_TREATMENT_HIDDEN: ReadonlyArray<{ surface: 'ssr' | 'email'; section: string; treatment: string; props: readonly string[]; why: string }> = [
  { surface: 'ssr', section: 'hero', treatment: 'classic', props: ['overlay'], why: '기본 구도는 하단 그라데이션 켬/끔(overlay_gradient)만 읽는다 · 오버레이 프리셋은 전체 화면 구도에서만 그린다' },
  { surface: 'ssr', section: 'hero', treatment: 'full_bleed', props: ['overlay_gradient'], why: '전체 화면 구도는 오버레이 프리셋(미지정 = 살짝 어둡게)이 그라데이션을 대신한다 · 켬/끔 값을 읽지 않는다' },
  { surface: 'ssr', section: 'hero', treatment: 'split', props: ['overlay', 'overlay_gradient', 'focus', 'image_fit', 'height', 'headline_emphasis'], why: '분할 구도 렌더는 오버레이 · 그라데이션 · 초점 · 맞춤 · 높이 · 제목 강조를 읽지 않는다(2026-10-14 탐침 실측)' },
  { surface: 'ssr', section: 'hero', treatment: 'editorial_overlap', props: ['overlay', 'overlay_gradient', 'focus', 'image_fit', 'height', 'headline_emphasis'], why: '겹침 구도 렌더는 오버레이 · 그라데이션 · 초점 · 맞춤 · 높이 · 제목 강조를 읽지 않는다(2026-10-14 탐침 실측)' },
  { surface: 'ssr', section: 'hero', treatment: 'typographic', props: ['image_url', 'focus', 'image_fit', 'overlay', 'overlay_gradient', 'height', 'headline_emphasis'], why: '타이포그래픽 구도는 이미지 없는 글자 구도 · 이미지 · 초점 · 맞춤 · 오버레이 · 그라데이션 · 높이 · 제목 강조를 그리지 않는다' },
  { surface: 'ssr', section: 'text_card', treatment: 'lead', props: ['image_url', 'image_position'], why: '리드 구도는 이미지 없는 글자 구도(첫 문단 강조) · 이미지와 그 위치가 뜻이 없다' },
  { surface: 'ssr', section: 'text_card', treatment: 'quote', props: ['image_url', 'image_position'], why: '인용 구도는 이미지 없는 글자 구도(따옴표 인용) · 이미지와 그 위치가 뜻이 없다' },
  { surface: 'ssr', section: 'text_card', treatment: 'framed', props: ['image_position'], why: '액자 구도 렌더는 이미지 자리를 고정한다 · 이미지 위치 값을 읽지 않는다(2026-10-14 탐침 실측)' },
  { surface: 'ssr', section: 'reviews', treatment: 'quote', props: ['reviews[].date', 'show_average_rating'], why: '인용 구도 렌더는 후기 날짜와 평균 별점을 그리지 않는다(2026-10-14 탐침 실측)' },
  { surface: 'ssr', section: 'coupon', treatment: 'ticket', props: ['button_color'], why: '티켓 코드는 알약 없는 평문이라 알약 배경색이 없다(0723 색 분리 결정 · 알약은 classic만)' },
  { surface: 'ssr', section: 'coupon', treatment: 'spotlight', props: ['button_color'], why: '스포트라이트 코드는 알약 없는 평문이라 알약 배경색이 없다(0723 색 분리 결정 · 알약은 classic만)' },
  { surface: 'ssr', section: 'gallery', treatment: 'mosaic', props: ['layout'], why: '모자이크 구도가 격자(2열)를 소유한다 · layout 값은 classic 구도에서만 읽는다' },
  { surface: 'ssr', section: 'product_carousel', treatment: 'focus', props: ['show_indicator'], why: '점 인디케이터는 가로 스와이프(classic · 3개+)에만 있다 · focus 구도는 세로로 전량 펼친다' },
  { surface: 'ssr', section: 'product_carousel', treatment: 'list', props: ['show_indicator'], why: '점 인디케이터는 가로 스와이프(classic · 3개+)에만 있다 · list 구도는 세로 행으로 전량 펼친다' },
  { surface: 'email', section: 'hero', treatment: 'typographic', props: ['image_url', 'focus', 'image_fit', 'overlay', 'overlay_gradient', 'height'], why: '타이포그래픽 구도는 이미지 없는 글자 구도 · 이미지 · 초점 · 맞춤 · 오버레이 · 그라데이션 · 높이를 그리지 않는다' },
  { surface: 'email', section: 'hero', treatment: 'split', props: ['overlay', 'overlay_gradient'], why: '이메일 분할 구도는 이미지 칸 · 글자 칸을 나눠 그려 오버레이 프리셋 · 그라데이션 켬/끔을 읽지 않는다(renderHero split 분기)' },
];

/** ★ 2026-10-14 DM 속성 예외 원장 — `dm-editor-coverage.test.ts`가 "편집기 속성 전수 × 발행 면"을 기계로 밟는다(이메일 0916 이식).
 *  값을 바꿔 렌더해도 출력이 안 달라지는 속성은 여기 **사유와 함께** 있어야 통과한다. 편집기에서 사라진 행은 실패(원장 부패 차단).
 *  등재된 것만 지키던 옛 표(위 DM_*_TABLE·MARKERS)는 그대로 두고, 이 원장은 "등재 안 된 전부"를 잡는다. */
export const DM_PROP_EXEMPT: DmPropExempt[] = [
  // ── 제거된 죽은 컨트롤 — 되살리려면 세 렌더 면(캔버스·DM SSR·이메일)과 두 계약표에 함께 등재한다 ──
  { section: 'coupon', prop: 'discount_type', surface: 'ssr', kind: 'removed', why: '캔버스·DM SSR·이메일 어디도 안 읽던 고아 속성(2026-09-04 제거)' },
  { section: 'poll', prop: 'show_result_after_vote', surface: 'ssr', kind: 'removed', why: '실시간 득표 집계 API가 없어 켜도 발송물 무변화(2026-07-21 편집기 제거 · 2026-10-14 기본값·타입도 제거)' },
  { section: 'map_store_locator', prop: 'enable_user_location', surface: 'ssr', kind: 'removed', why: '매장 좌표 스키마·Geolocation 미구축이라 켜도 무변화(2026-07-21 편집기 제거 · 2026-10-14 기본값·타입도 제거)' },
  { section: 'product_carousel', prop: 'auto_slide', surface: 'ssr', kind: 'removed', why: '자동 전환 미도입(수신자 수동 스와이프) · 렌더·뷰어 어디도 안 읽음(2026-10-14 기본값·타입 제거)' },
  { section: 'product_carousel', prop: 'slide_interval_ms', surface: 'ssr', kind: 'removed', why: '자동 전환 미도입이라 간격도 뜻 없음 · 렌더·뷰어 어디도 안 읽음(2026-10-14 기본값·타입 제거)' },
  // ── 서버가 읽는 규칙(이름 걸림 통과 근거 = reader 본문) ──
  { section: 'email_capture', prop: 'consent_required', surface: 'ssr', kind: 'server', reader: 'submitEventResponse', why: '제출 때 동의 체크를 서버가 강제한다(명시 false 가 아니면 · 추첨은 늘 · 1019 미지정 = 강제)' },
  // ★ 2026-10-19 B-1014-3⑥ 서버 규칙 대기 7건 해소 — 5건 = 서버가 읽는다 · 2건 = 장식 토글 제거(서버는 늘 1인 1회)
  { section: 'survey', prop: 'questions[].required', surface: 'ssr', kind: 'server', reader: 'submitEventResponse', why: '필수 문항의 빈 답은 서버가 400 으로 거른다(뷰어 data-required 검사와 같은 기준)' },
  { section: 'lucky_draw', prop: 'form_fields[].required', surface: 'ssr', kind: 'server', reader: 'submitEventResponse', why: '필수 응모 칸의 빈 값은 서버가 400 으로 거른다(발행 폼 data-required · 뷰어 검사와 같은 칸)' },
  { section: 'click_rewards', prop: 'target_count', surface: 'ssr', kind: 'server', reader: 'submitEventResponse', why: '참여 수를 서버가 세어 목표 대비 진행률로 돌려준다(진행률 표시가 켜진 화면이 그린다)' },
  { section: 'instant_coupon', prop: 'expires_at', surface: 'ssr', kind: 'server', reader: 'submitEventResponse', why: '만료 시각이 지나면 서버가 발급을 409 로 막는다(화면 표시와 같은 값)' },
  { section: 'limited_quantity', prop: 'total_quantity', surface: 'ssr', kind: 'server', reader: 'submitEventResponse', why: '같은 블록 잠금 안에서 참여 수를 센 뒤 총 수량을 넘으면 서버가 409 로 막는다' },
  { section: 'poll', prop: 'one_vote_per_user', surface: 'ssr', kind: 'removed', why: '서버는 토글과 무관하게 늘 1인 1회(UNIQUE)라 끄는 칸이 장식이었다(2026-10-19 편집기 · 기본값 · 타입 제거 · 안내는 늘)' },
  { section: 'roulette', prop: 'one_spin_per_user', surface: 'ssr', kind: 'removed', why: '서버는 토글과 무관하게 늘 1인 1회(UNIQUE)라 끄는 칸이 장식이었다(2026-10-19 편집기 · 기본값 · 타입 제거 · 안내는 늘)' },
  { section: 'roulette', prop: 'segments[].probability', surface: 'ssr', kind: 'server', reader: 'runRouletteDraw', why: '당첨 칸은 서버가 확률로 뽑는다(클라이언트는 결과만 받아 돌린다)' },
  { section: 'roulette', prop: 'segments[].prize_count', surface: 'ssr', kind: 'server', reader: 'syncPrizesFromSections', why: '발행 때 dm_prizes 재고로 동기화되고 당첨은 재고에서 차감된다' },
  // ── 구도가 소유하는 값(그 구도에서는 뜻이 없다 · 2026-10-14 첫 실측) ──
  { section: 'cta', prop: 'layout', surface: 'ssr', treatment: 'bar', kind: 'n/a', why: '구도가 배치를 소유(ctaLayoutApplies) · bar=첫 버튼 강조+목록이라 늘어놓을 것이 없다(편집기도 감춘다)' },
  { section: 'cta', prop: 'layout', surface: 'ssr', treatment: 'sticky', kind: 'n/a', why: '구도가 배치를 소유(ctaLayoutApplies) · sticky=첫 버튼만 고정이라 배치 개념이 없다(편집기도 감춘다)' },
  { section: 'cta', prop: 'layout', surface: 'email', treatment: 'bar', kind: 'n/a', why: '구도가 배치를 소유(ctaLayoutApplies) · bar=첫 버튼 강조+목록이라 늘어놓을 것이 없다(편집기도 감춘다)' },
  { section: 'cta', prop: 'buttons[].style', surface: 'ssr', treatment: 'bar', kind: 'n/a', why: '구도가 버튼 모양을 소유 · bar=첫 버튼 강조 바 + 나머지 목록이라 개별 style을 안 읽는다' },
  { section: 'cta', prop: 'buttons[].style', surface: 'ssr', treatment: 'ghost', kind: 'n/a', why: '구도가 버튼 모양을 소유 · ghost=버튼 전부를 고스트로 그린다' },
  { section: 'cta', prop: 'buttons[].style', surface: 'ssr', treatment: 'sticky', kind: 'n/a', why: '구도가 버튼 모양을 소유 · sticky=첫 버튼 하나를 고정 바로 그린다' },
  { section: 'cta', prop: 'buttons[].style', surface: 'email', treatment: 'bar', kind: 'n/a', why: '구도가 버튼 모양을 소유 · bar=첫 버튼 강조 바 + 나머지 목록이라 개별 style을 안 읽는다' },
  { section: 'cta', prop: 'buttons[].style', surface: 'email', treatment: 'ghost', kind: 'n/a', why: '구도가 버튼 모양을 소유 · ghost=버튼 전부를 고스트로 그린다' },
  // ── 화면 글자가 아닌 값 ──
  { section: 'roulette', prop: 'segments[].probability', surface: 'ssr', kind: 'n/a', why: '확률은 서버 추첨값(runRouletteDraw) · 발행물·data-segments 에 싣지 않는 것이 정답(수신자에게 확률 노출 X)' },
  { section: 'survey', prop: 'questions[].id', surface: 'ssr', kind: 'n/a', why: '문항 식별자(응답 키 q_<id>) · 화면 글자가 아니다 · 뷰어가 data-dm-q로 읽는다' },
  { section: 'map_store_locator', prop: 'stores[].id', surface: 'ssr', kind: 'n/a', why: '매장 식별자(항목 정렬·삭제 키) · 화면 글자가 아니다' },
  // ── 캔버스(편집 미리보기)에 없는 것이 정답인 동작 ──
  { section: 'email_capture', prop: 'success_text', surface: 'canvas', kind: 'n/a', why: '완료 문구는 참여를 마친 뒤 뷰어가 띄우는 글자 · 캔버스는 참여 전 모습만 그린다' },
  { section: 'poll', prop: 'success_text', surface: 'canvas', kind: 'n/a', why: '완료 문구는 참여를 마친 뒤 뷰어가 띄우는 글자 · 캔버스는 참여 전 모습만 그린다' },
  { section: 'survey', prop: 'success_text', surface: 'canvas', kind: 'n/a', why: '완료 문구는 참여를 마친 뒤 뷰어가 띄우는 글자 · 캔버스는 참여 전 모습만 그린다' },
  { section: 'click_rewards', prop: 'success_text', surface: 'canvas', kind: 'n/a', why: '완료 문구는 참여를 마친 뒤 뷰어가 띄우는 글자 · 캔버스는 참여 전 모습만 그린다' },
  { section: 'lucky_draw', prop: 'success_text', surface: 'canvas', kind: 'n/a', why: '완료 문구는 참여를 마친 뒤 뷰어가 띄우는 글자 · 캔버스는 참여 전 모습만 그린다' },
  { section: 'roulette', prop: 'success_text', surface: 'canvas', kind: 'n/a', why: '당첨 시 안내 문구는 추첨 뒤 뷰어가 띄우는 글자 · 캔버스는 참여 전 모습만 그린다' },
  { section: 'instant_coupon', prop: 'success_text', surface: 'canvas', kind: 'n/a', why: '완료 문구는 쿠폰을 받은 뒤 뷰어가 띄우는 글자 · 캔버스는 참여 전 모습만 그린다' },
  { section: 'limited_quantity', prop: 'success_text', surface: 'canvas', kind: 'n/a', why: '완료 문구는 참여를 마친 뒤 뷰어가 띄우는 글자 · 캔버스는 참여 전 모습만 그린다' },
  { section: 'email_capture', prop: 'consent_required', surface: 'canvas', kind: 'n/a', why: '캔버스에는 제출이 없어 동의 강제(체크 검증)를 흉내내지 않는다 · 발행 SSR·서버가 소비' },
  { section: 'gallery', prop: 'enable_zoom', surface: 'canvas', kind: 'n/a', why: '확대 보기는 뷰어 스크립트 동작(라이트박스) · 캔버스 클릭은 블록 선택이다' },
  { section: 'gallery', prop: 'images[].link_url', surface: 'canvas', kind: 'n/a', why: '캔버스 이미지 클릭은 블록 선택이라 링크로 열지 않는다 · 발행 SSR이 소비' },
  { section: 'slideshow', prop: 'slides[].link_url', surface: 'canvas', kind: 'n/a', why: '캔버스 슬라이드 클릭은 블록 선택이라 링크로 열지 않는다 · 발행 SSR이 소비' },
  { section: 'slideshow', prop: 'interval_ms', surface: 'canvas', kind: 'n/a', why: '캔버스는 자동 전환을 돌리지 않는다(정지 미리보기) · 뷰어가 소비' },
  { section: 'product_carousel', prop: 'title_color', surface: 'canvas', kind: 'n/a', why: '제목 스타일은 공용 도우미(productTitleStyle)가 만든다 · 함수 본문 이름 대조(근사)의 사각' },
  { section: 'product_carousel', prop: 'title_size', surface: 'canvas', kind: 'n/a', why: '제목 스타일은 공용 도우미(productTitleStyle)가 만든다 · 함수 본문 이름 대조(근사)의 사각' },
  { section: 'roulette', prop: 'segments[].probability', surface: 'canvas', kind: 'n/a', why: '확률은 서버 추첨값(runRouletteDraw) · 화면에 표시되지 않는다' },
  // ★ 2026-10-19 B-1014-3⑦ 미검토 정리
  { section: 'gallery', prop: 'images[].caption', surface: 'email', kind: 'n/a', why: '이메일 갤러리는 설명을 그림 대체 글(alt)로만 싣는다 · 한 줄 템플릿 메일이 그림 아래 글 카드를 따로 싣는 계약(line-template-compose eventParts)이라 보이게 그리면 같은 글이 두 번 나온다' },
  { section: 'map_store_locator', prop: 'stores[].lat', surface: 'ssr', kind: 'removed', why: '지도는 주소 글자만 그리고 거리 정렬이 없어 좌표를 어디도 안 읽었다(2026-10-19 입력칸 · 타입 제거 · 0721 enable_user_location 과 같은 뿌리)' },
  { section: 'map_store_locator', prop: 'stores[].lng', surface: 'ssr', kind: 'removed', why: '지도는 주소 글자만 그리고 거리 정렬이 없어 좌표를 어디도 안 읽었다(2026-10-19 입력칸 · 타입 제거 · 0721 enable_user_location 과 같은 뿌리)' },
  // 구도가 안 읽는 값(위 DM_TREATMENT_HIDDEN 펼침 · 편집기도 감춘다)
  ...DM_TREATMENT_HIDDEN.flatMap((g) => g.props.map((prop) => ({ section: g.section, prop, surface: g.surface, treatment: g.treatment, kind: 'n/a' as const, why: g.why }))),
];

/** 제거된 죽은 컨트롤 = 위 원장의 kind=removed 행(파리티 테스트 "제거된 죽은 컨트롤" 절이 편집기·기본값 잔존 0을 밟는다). */
export const DM_REMOVED_DEAD_CONTROLS: Array<{ section: string; prop: string; reason: string }> =
  DM_PROP_EXEMPT.filter((e) => e.kind === 'removed').map((e) => ({ section: e.section, prop: e.prop, reason: e.why }));

/** ★ 2026-10-14 "서버 규칙"처럼 읽히는 이름 — 발행물에 안 나와도 그냥 통과시키면 안 된다. 서버가 실제로 읽어야 규칙이다.
 *  원장 kind=server + reader 실재로만 통과. 못 대면 아래 PENDING에 이름을 둔다(줄기만 하는 래칫 · 늘면 실패). */
export const DM_SERVER_RULE_NAME = /^one_|^consent_required$|^(required|quantity|probability)$|^expires|_count$|_quantity$/;
/** 2026-10-14 첫 실측 7건 — 이름은 규칙인데 서버가 안 읽는다(= R3 서버 뜻 축 · 설계서 §6 B2). 서버에 넣으면 kind=server로 올리고 여기서 뺀다. */
// ★ 2026-10-19 B-1014-3⑥ 7건 전부 해소(위 원장 server · removed 행) → 0
export const DM_SERVER_RULES_PENDING: readonly string[] = [];
export const DM_SERVER_RULES_PENDING_MAX = 0;

/** ★ 2026-10-14 미검토 래칫 — 첫 실측에서 빨갛던 속성 이름 목록. 항목이 통과하게 되면 실패시켜 목록에서 빼게 한다(이름 바꿔치기 차단).
 *  길이는 MAX를 넘을 수 없고 MAX는 줄이기만 한다. kind 4종 밖의 새 분류를 만들지 않는다. */
// ★ 2026-10-19 B-1014-3⑦ 첫 실측 31건 전부 처리(구도 감춤 · 제거 · 렌더 맞춤 · 서버 규칙 · n/a) → 0. 새 미검토는 늘 수 없다.
export const DM_PROP_UNREVIEWED: readonly string[] = [];
export const DM_PROP_UNREVIEWED_MAX = 0;

/** ★ 2026-10-14 탐침 문맥 — 탐침 값은 기본값의 타입에서 파생한다(boolean 반전 · number +7 · *_color · *url · 문자열 '탐침_'+prop).
 *  파생이 안 되는 것만 여기 적는다(빠지면 테스트가 그 이름으로 실패한다 · 손 등재 최소):
 *   base  = 섹션별 바탕 보정(기본값이 빈 배열인 항목 1개 · 값이 뜻을 갖는 전제 조건). 키 = 섹션 타입.
 *   enums = 열거형 탐침 값(기본값과 달라야 한다). 키 = 'type.prop' 또는 'type.arr[].field'. */
export const DM_PROBE_CONTEXT: {
  base: Record<string, Record<string, unknown>>;
  /** 그 속성을 탐침할 때만 얹는 전제(예: 헤더 행사명은 variant=countdown에서만 뜻이 있다). 키 = 'type.prop' */
  with: Record<string, Record<string, unknown>>;
  enums: Record<string, unknown>;
  /** ★ 2026-10-19 같은 속성의 추가 탐침 값 — 열거 값 하나가 어떤 구도의 기본값과 겹치면 「안 읽힘」으로 잘못 잡혀(G1 · 이메일 분할 제목 28 · 리드 본문 18 · 기본 오버레이) 하나라도 출력이 바뀌면 읽힘으로 본다. */
  alts: Record<string, readonly unknown[]>;
} = {
  base: {
    header: { brand_name: '한줄로' },
    hero: { headline: '제목', sub_copy: '부제', image_url: 'https://img.example/hero.jpg' },
    text_card: { tag: '태그', headline: '제목', body: '본문', image_url: 'https://img.example/card.jpg' },
    coupon: { discount_label: '10% 할인', coupon_code: 'CODE10' },
    cta: { buttons: [{ label: '첫째', url: 'https://a.example', style: 'primary' }, { label: '둘째', url: 'https://b.example', style: 'secondary' }] },
    video: { video_url: 'https://www.youtube.com/watch?v=abcdefghijk' },
    store_info: { address: '서울시 어딘가 1' },
    sns: { channels: [{ type: 'instagram', url: 'https://instagram.com/x', handle: '@x' }] },
    promo_code: { code: 'PROMO1', description: '설명' },
    product_carousel: { products: [{ image_url: 'https://img.example/p.jpg', name: '상품', price: 10000, link_url: 'https://shop.example/p' }] },
    gallery: { images: [{ url: 'https://img.example/g.jpg', caption: '설명' }] },
    slideshow: { slides: [{ image_url: 'https://img.example/s.jpg', caption: '설명' }] },
    survey: { questions: [{ id: 'q1', type: 'single', question: '질문', options: ['A', 'B'], required: false }] },
    lucky_draw: { prizes: [{ rank: 1, name: '경품', count: 1 }] },
    youtube_embed: { video_url: 'https://www.youtube.com/watch?v=abcdefghijk' },
    instagram_embed: { post_url: 'https://www.instagram.com/p/abc/' },
    map_store_locator: { stores: [{ id: 's1', name: '매장', address: '주소' }] },
    reviews: { reviews: [{ rating: 5, author: '작성자', body: '후기' }] },
  },
  with: {
    'header.banner_image_url': { variant: 'banner' },
    'header.event_title': { variant: 'countdown' },
    'header.event_date': { variant: 'countdown' },
    'header.coupon_code': { variant: 'coupon' },
    'header.discount_label': { variant: 'coupon' },
    'header.logo_size': { logo_url: 'https://img.example/logo.png' },
    'video.autoplay': { video_type: 'direct', video_url: 'https://cdn.example/v.mp4' },
    'video.thumbnail_url': { video_type: 'direct', video_url: 'https://cdn.example/v.mp4' },
    'product_carousel.show_indicator': { products: [1, 2, 3].map((i) => ({ image_url: `https://img.example/p${i}.jpg`, name: `상품${i}`, price: 10000 })) },
    'product_carousel.title_color': { title: '추천 상품' },
    'product_carousel.title_size': { title: '추천 상품' },
    'promo_code.cta_label': { cta_url: 'https://x.example' },
    'roulette.segments[].reward_description': { segments: [{ id: '1', label: '경품', probability: 0.5, prize_count: 1 }, { id: '2', label: '꽝', probability: 0.5 }] },
    'slideshow.show_indicator': { slides: [{ image_url: 'https://img.example/s1.jpg' }, { image_url: 'https://img.example/s2.jpg' }] },
    'slideshow.show_pause': { slides: [{ image_url: 'https://img.example/s1.jpg' }, { image_url: 'https://img.example/s2.jpg' }] },
    'sns.channels[].handle': { layout: 'buttons' },
    'tab_cards.tab_active_bg': { tabs: [{ label: '탭 1', content_type: 'text', content: 'a' }, { label: '탭 2', content_type: 'text', content: 'b' }] },
    'tab_cards.tabs[].link_url': { tabs: [{ label: '탭', content_type: 'image', content: 'https://img.example/t.jpg' }] },
  },
  enums: {
    'header.variant': 'countdown',
    'header.brand_size': 'lg',
    'header.logo_size': 'lg',
    'hero.height': 'lg',
    'hero.focus': 'top',
    'hero.image_fit': 'contain',
    'hero.overlay': 'strong',
    'hero.headline_emphasis': 'marker',
    'hero.headline_size': 28,
    'hero.sub_copy_size': 18,
    'hero.overlay_gradient': false,
    'text_card.image_position': 'bottom',
    'text_card.headline_emphasis': 'marker',
    'text_card.headline_size': 24,
    'text_card.body_size': 18,
    'coupon.min_purchase': 30000,
    'countdown.end_datetime': '2027-01-01T00:00:00.000Z',
    'header.event_date': '2027-01-01T00:00:00.000Z',
    'lucky_draw.draw_at': '2027-01-01T00:00:00.000Z',
    'instant_coupon.expires_at': '2027-01-01T00:00:00.000Z',
    'click_rewards.reward_type': 'share',
    'video.video_type': 'direct',
    'cta.layout': 'row',
    'cta.buttons[].style': 'outline',
    'sns.layout': 'buttons',
    'sns.channels[].type': 'youtube',
    'product_carousel.image_fit': 'contain',
    'product_carousel.image_focus': 'bottom',
    'product_carousel.image_height': 'lg',
    'product_carousel.title_size': 'lg',
    'gallery.layout': 'grid_3x3', // 편집기의 'masonry' 값은 렌더러가 안 읽는다(모자이크는 구도) — [범위 밖] BUGS 등재
    'gallery.full_bleed': true,
    'product_carousel.products[].discount_price': 8000,
    'reviews.reviews[].rating': 3,
    'roulette.segments[].prize_count': 2, // 재고 > 0 이면 당첨 경품 칩이 발행물에 뜬다(0722) · 기본 항목은 재고 없음
    'survey.questions[].options': ['X1', 'X2'],
    'slideshow.slide_ratio': '3:4',
    'tab_cards.tabs[].content_type': 'image',
    'survey.questions[].type': 'rating',
  },
  alts: {
    'hero.headline_size': [40],
    'text_card.body_size': [24],
    'hero.overlay': ['top', 'brand'],
  },
};

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
  { section: 'cta', prop: 'button.text_color', desc: 'CTA 버튼 글씨 색 (★1008 · 구도 4종 · 바 둘째 버튼 포함)' },
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

/** ★ 2026-08-31 탭 카드 이미지 링크(임은지 접수 cmtgmu3ws0536jnotc8z54i1c) —
 *  섹션 prop이 아니라 **`tabs[]` 항목의 필드**라 위 표들과 형태가 다르다(그래서 표를 나눴다).
 *  content_type='image'일 때만 읽는다. 미지정 = 링크 없는 이미지(현행 · 회귀 0).
 *  같은 접수의 나머지 절반은 편집기 쪽이다 — 유형을 바꿔도 입력칸이 같아 무엇을 넣어야 이 렌더가
 *  나오는지 알 수 없었다(TabCardsEditor 유형별 분기). 소비 검증 = dm-editor-parity.test.ts.
 *  이메일은 대상이 아니다: `tab_cards`는 EMAIL_INCOMPATIBLE 'static'이고 전용 렌더 분기가 없어 읽는 쪽이 없다. */
export const DM_TAB_ITEM_PROPS: Array<{ section: string; prop: string; desc: string }> = [
  { section: 'tab_cards', prop: 'tabs[].link_url', desc: '이미지 탭을 눌렀을 때 이동할 주소 (content_type=image 전용 · 미지정 = 링크 없음)' },
];

/** ★ 2026-09-15 리뷰 별점 색(임은지 접수 cmu2ao5qn02tjjnlu1spouqzy) · 별이 강조색(회사 킷 accent_color)에서만 와서
 *  흰 강조색에서는 흰 카드 위 별이 안 보였고 고를 입구가 없었다. 편집 패널(ReviewsEditor)은 DM·이메일 공용이라
 *  **두 렌더러·편집 캔버스가 함께 소비한다**(이메일 원장 = EMAIL_REVIEWS_PROPS). 미지정 = 강조색 그대로(회귀 0).
 *  소비 검증 = dm-editor-parity.test.ts · email/__tests__/email-editor-parity.test.ts */
export const DM_REVIEWS_PROPS: Array<{ section: string; prop: string; desc: string }> = [
  { section: 'reviews', prop: 'star_color', desc: '별점 색: 리뷰별 별 · 평균 별 (미지정 = 강조색)' },
];
