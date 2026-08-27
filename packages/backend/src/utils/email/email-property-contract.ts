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

/** 히어로 높이 px — 렌더러 HERO_HEIGHT_PX와 같은 값(원장이 기대치를 소유한다). */
export const EMAIL_HERO_HEIGHT = { sm: 200, md: 320, lg: 480, full: 600 } as const;

/** 캠페인 단위 디자인(`design`) 축 — 테마 모달·서체 모달이 패치하는 값.
 *  ★ 2026-08-27 서체 지정 접수(`cmtb6kn6j0369jnotmslux7i2`) — 렌더러는 이미 읽고 있었고 **고를 입구만 없었다.**
 *  입구를 붙이는 축이라도 "읽히고 있다"를 계약으로 고정해 둔다. 안 그러면 다음에 렌더러를 손볼 때 조용히 끊긴다. */
export const EMAIL_DESIGN_PROPS: Array<{ prop: string; desc: string; probe: string }> = [
  { prop: 'font_family', desc: '본문 서체 (미지정 = 브랜드킷 → 기본)', probe: '"Noto Serif KR", serif' },
  { prop: 'font_display', desc: '제목 서체 (미지정 = 본문 서체)', probe: '"Black Han Sans", sans-serif' },
];
