/**
 * image-fit-spec.ts — 이미지 비율 맞춤 규격 (단일 진실원 · 2026-09-08)
 *
 * 서빙 CT(`image-serve.ts`)와 이를 요청하는 렌더러가 **같은 값**을 봐야 하는데,
 * 렌더러가 CT를 직접 참조하면 sharp(네이티브 모듈)까지 끌어온다. 이메일 렌더러는 DB·네이티브 의존 없는
 * 순수 모듈로 유지해야 하므로(파일 상단 규약) 규격만 여기로 뗀다.
 * ⛔ 비율 값을 다른 곳에 문자열로 다시 쓰지 마라 — 캐시 디렉터리 이름에 들어가는 값이라 한 글자만 달라도
 *   변환본이 따로 쌓이고 화면은 옛것을 계속 본다.
 */

/**
 * ★ 2026-11-08 C116-B 인앱 무대색 = SDK 여러 장 칸 채움(`POSTER_FRAME_RULES.multiFill`)과 같은 값.
 *   옛 연동 앱에 보내는 그림의 빈자리를 이 색(또는 장 bg_color)으로 채운다 · 흐림 · 가장자리 색 0(계약 시험이 SDK 값과 대조).
 */
export const INAPP_STAGE_FILL = '#111827';
/** 무대색으로 받는 꼴(3 · 6자리 · 알파 없음 — 단색 바탕) */
export const INAPP_STAGE_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** 장 무대색 한 판정 = 장 bg_color(꼴 맞음) · 아니면 INAPP_STAGE_FILL(SDK `frameHexOr(s.bg_color, multiFill)` 과 같은 뜻 · 서버 판정 · 굽기 · 화면 거울이 이 규칙) */
export function inAppStageColor(bg: unknown): string {
  const v = typeof bg === 'string' ? bg.trim() : '';
  return INAPP_STAGE_HEX.test(v) ? v : INAPP_STAGE_FILL;
}

/**
 * ★ 2026-11-08 C118 인앱 안전 칸 = 가로 · 세로 가운데 이 비율(설치된 앱 = 가운데 맞춤 cover 5:4 ~ 4:5 → 정사각 가장자리 10% 가 잘릴 수 있다).
 *   여백 맞춤(inapp.safe) · 스튜디오 인앱용 프롬프트 · 인앱용 로고 자리 · SDK 정지 full 글 여백(POSTER_FRAME_RULES.fullTextPad ≥ 가장자리)이 이 값 하나를 본다(계약 시험 대조).
 */
export const INAPP_CONTENT_SAFE = 0.8;

/** 허용 비율(키 → 가로:세로). 키는 캐시 디렉터리 이름에 들어가므로 영숫자·x만 쓴다. */
export const ASPECT_RATIOS: Record<string, { w: number; h: number; rev?: number; cover?: boolean; safe?: { w: number; h: number; fill: string } }> = {
  '1x1': { w: 1, h: 1 },
  /**
   * ★ 2026-11-08 C116-B 옛 연동 앱(고객사 네이티브 앱 · caps 없음) 인앱 그림 = **모든 고객사 앱 공통 규칙 하나**
   *   (설계서 docs/2026-11-08-c116b-inapp-universal-output-design.md D1 · 한 앱 칸 공식 0).
   *   정사각 캔버스 · 원본은 가운데 80% × 80% 안에 통째로 · 빈자리 = 무대색. 고객사 앱 칸은 모른다 → 손해가 대칭인 정사각 ·
   *   앱이 가운데 맞춤 cover 로 칸 세로/가로 0.8 ~ 1.25(5:4 ~ 4:5)를 채워도 원본 0 잘림 · contain · 원본 비율이면 통째(연동 계약에 적음).
   *   ⛔ 값을 바꾸면 rev 를 올린다 — rev = 변환본 캐시 폴더 이름 + 그림 주소의 `fr`(앱 · 중간 캐시가 옛 그림을 다시 쓰지 않게 · Codex 설계 1R ① · 2R ①).
   */
  inapp: { w: 1, h: 1, rev: 2, safe: { w: INAPP_CONTENT_SAFE, h: INAPP_CONTENT_SAFE, fill: INAPP_STAGE_FILL } },
  /**
   * ★ 2026-11-08 C118 B2 스튜디오 인앱용 그림(파일 이름 `.full.` · 정사각 · 가장자리 10% = 배경만) = 정사각으로만 맞춤 · 여백 0(cover · 이미 정사각이면 크기만).
   *   앱이 가운데 맞춤 cover 로 5:4 ~ 4:5 칸을 채워도 배경만 잘린다(글 · 주제 = 가운데 80%) · 그 밖 그림 = 위 `inapp`(여백 규칙) 그대로.
   */
  inappfull: { w: 1, h: 1, rev: 1, cover: true },
};

/**
 * 맞추는 방법 — 편집기의 "이미지 맞춤" 선택을 그대로 이미지에 굽는다.
 *   `pad`  = 맞추기(contain) · 원본을 통째로 넣고 남는 자리를 채운다(잘림 0)
 *   `crop` = 채우기(cover) · 캔버스를 꽉 채우고 넘치는 가장자리를 잘라낸다(사용자가 고른 동작 그대로)
 *
 * ⛔ 두 갈래를 모두 구워야 한다 — 2026-09-08 서수란 접수(`cmtsb9vg30b8wjnott3tdvqe3`)의 캠페인들이
 *   채우기 설정이었고, 그 뷰어(Outlook 계열)가 `height`·`object-fit`을 둘 다 무시해 카드가 계단처럼 어긋났다.
 *   맞추기만 구우면 채우기 캠페인은 그대로 깨진다.
 */
export const FIT_MODES = ['pad', 'crop'] as const;
export type FitMode = (typeof FIT_MODES)[number];

/**
 * 상품 격자가 쓰는 비율.
 * 1:1로 정한 이유 = 상품 사진은 가로형(신발)과 세로형(의류)이 섞인다. 4:3으로 구우면 세로형만 크게 손해를 본다.
 * 정사각은 손해가 대칭이고 커머스 썸네일 관행이기도 하다.
 */
export const PRODUCT_GRID_ASPECT = '1x1';

/**
 * 상품명 표시 상한(글자). 넘으면 잘라서 말줄임표를 붙인다.
 *
 * 경위 = 2026-09-08 서수란 접수. 이미지 높이를 맞춰도 **상품명 줄 수가 다르면** 카드 높이가 어긋난다
 *   (접수 캡처: 왼쪽 4줄 · 오른쪽 2줄). 카드 폭 약 210px에 14px 한글이면 한 줄에 14자 안팎이라 2줄 = 28자.
 * ⛔ CSS 말줄임(`-webkit-line-clamp`·`text-overflow`)에 기대지 않는다 — 이 접수의 뷰어처럼
 *   height·object-fit조차 무시하는 클라이언트가 있다. 자를 거면 서버가 자른다.
 */
export const PRODUCT_NAME_MAX_CHARS = 30;

/**
 * 여백을 무엇으로 채울지 가르는 기준(가장자리 색의 흩어진 정도).
 *
 * 실측(운영 이미지 7장): 흰 배경 스튜디오 컷 0.0~0.8 · 어두운 단색 배경 10.5 · 야외 모델컷 48.7~65.9.
 * 이 값보다 작으면 **가장자리 색**으로 채운다(단색 배경이라 이음매가 아예 안 보인다).
 * 크면 **블러 확장**으로 채운다(복잡한 배경에 단색을 붙이면 색 덩어리가 생겨 어색하다).
 * ⛔ 한 방식으로 통일하지 마라 — 배너형 로고에 블러를 쓰면 글자가 뒤에 비쳐 지저분하고,
 *   야외컷에 단색을 쓰면 갈색 판이 붙는다(2026-09-08 비교 캡처로 확인한 결과다).
 */
export const EDGE_UNIFORM_THRESHOLD = 25;
