/**
 * c360-ui.ts — 고객 360 창 **전용** 클래스 리터럴 (★ 2026-08-22 v2 신설)
 *
 * 경계(v2 §2-1 · §3-3):
 *   - 껍데기(스크림·박스·헤더 띠·닫기)는 **부모(고객 DB 조회) 리터럴 그대로**다. 두 창이 겹쳐 보이는 면적이 이것뿐이라
 *     여기만 같으면 같은 집으로 보인다. 부모 파일은 손대지 않는다(0822 롤백 경위).
 *   - 작업면(레일·툴바·행·카드)은 `CUI_*`(console-ui.ts)를 import해 쓰고, **CUI에 없는 이 창 고유 치수만** 여기 둔다.
 *     CUI 값을 여기로 복제하지 않는다 — 값이 갈라지는 것을 막으려고 만든 파일에 두 벌을 만드는 일이다.
 *   - 전부 완성 리터럴. 템플릿으로 조립하지 않는다(Tailwind 스캐너).
 *
 * ⛔ 껍데기·스크림·상세 래퍼에 `transform`·`filter`·`backdrop-filter`·`animate-in`을 넣지 않는다.
 *    이 창 안에서 `position: fixed` 오버레이(발송 결과)가 열릴 날을 전제로 둔다(console-ui.ts CUI_MODAL P0 경위).
 *
 * 행 격자 산식(바꾸면 축선·상세 인덴트도 같이 바꾼다):
 *   px-5(20) + 시각 52 + gap 12 + 타일 28 + gap 12 = 제목 시작 124 / 타일 중심 = 20 + 52 + 12 + 14 = 98
 */

// ────────────── 껍데기 (부모 언어) ──────────────

/** z-[70]: 부모 전체삭제 확인창이 z-[60]이라 같은 숫자를 두 층이 쓰고 있었다(v2 §1-3). 확인 다이얼로그(z-[2100])는 그 위 */
export const C360_SCRIM = 'fixed inset-0 z-[70] bg-black bg-opacity-50 flex items-center justify-center p-0 sm:p-4';
/** `h-` 고정 금지 — 기록이 적은 고객에서 아래가 빈다. 모바일은 전체화면 */
export const C360_BOX =
  'bg-white rounded-none sm:rounded-xl shadow-2xl w-full sm:w-[1100px] max-w-full ' +
  'max-h-[100dvh] sm:max-h-[88vh] sm:min-h-[560px] overflow-hidden flex flex-col';

/** 헤더 80px = 부모 헤더 실측(py-4 32 + 제목 28 + 부제 20). 겹쳐 보일 때 띠 두께가 같다 */
export const C360_HEADER = 'shrink-0 h-auto py-3 md:py-0 md:h-20 px-4 md:px-6 flex items-center justify-between gap-3 md:gap-4 border-b border-gray-200 bg-gray-50';
export const C360_AVATAR = 'h-11 w-11 shrink-0 rounded-xl bg-white ring-1 ring-neutral-200 grid place-items-center text-[16px] font-bold text-indigo-600';
export const C360_NAME = 'text-[17px] md:text-[19px] font-bold tracking-[-0.03em] leading-none text-neutral-900 truncate';
export const C360_NAME_SKELETON = 'h-[17px] w-28 rounded bg-neutral-200/70 animate-pulse motion-reduce:animate-none';
export const C360_SUB = 'mt-2 flex items-center gap-2 leading-none text-[13px] text-neutral-500 min-w-0';
export const C360_SUB_PHONE = 'font-mono tabular-nums text-neutral-600 shrink-0';
export const C360_HAIRLINE = 'w-px h-3 bg-neutral-200 shrink-0';
export const C360_HEADER_RIGHT = 'flex items-center gap-2 shrink-0';
export const C360_HEADER_SPLIT = 'w-px h-5 bg-neutral-200';
export const C360_PILL_SKELETON = 'h-[23px] w-14 rounded-full bg-neutral-200/70 animate-pulse motion-reduce:animate-none';
/** 부모 닫기와 같은 크기·모양·자리. 안쪽만 `&times;` 글리프 대신 아이콘(baseline 때문에 위로 떴다) */
export const C360_CLOSE = 'w-8 h-8 shrink-0 grid place-items-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors';

// ────────────── 본문 2열 ──────────────

export const C360_BODY = 'flex-1 min-h-0 flex flex-col md:flex-row';
/** 레일 320 = 부모 필드 표(dt w-24) 기준 값 영역 180px 확보 */
export const C360_RAIL =
  'w-full md:w-[320px] md:shrink-0 border-b md:border-b-0 md:border-r border-neutral-200 bg-neutral-50 ' +
  'md:overflow-y-auto flex flex-col shrink-0 md:shrink';
export const C360_COL = 'flex-1 min-w-0 bg-white flex flex-col min-h-0';

// ────────────── 레일: 지표 타일 ──────────────

/** 레일 최상단에만 깊이 한 겹(단일 요소 그라데이션 — CUI_EMPTY와 같은 문법) */
export const C360_TILES = 'p-4 grid grid-cols-2 gap-2 bg-gradient-to-b from-white to-neutral-50 to-[120px]';
export const C360_TILE = 'rounded-xl bg-white border border-neutral-200 p-3.5 min-w-0';
export const C360_TILE_LABEL = 'text-[12px] font-medium text-neutral-500 leading-none';
export const C360_TILE_VALUE = 'mt-2.5 text-[24px] leading-none font-bold tracking-[-0.03em] tabular-nums text-neutral-900';
/** 0은 지우지 않고 무게만 내린다(0821 판정 — 빼기로 퀄리티를 올리지 않는다) */
export const C360_TILE_VALUE_ZERO = 'mt-2.5 text-[24px] leading-none font-bold tracking-[-0.03em] tabular-nums text-neutral-400';
export const C360_TILE_VALUE_TEXT = 'mt-2.5 text-[15px] leading-none font-semibold text-neutral-500';
export const C360_TILE_UNIT = 'ml-1 text-[12px] font-medium text-neutral-400 tracking-normal';
export const C360_TILE_CTX = 'mt-2 min-h-[16px] text-[11.5px] text-neutral-500 tabular-nums truncate';
export const C360_TILE_SKELETON_LABEL = 'h-3 w-12 rounded bg-neutral-200/70 animate-pulse motion-reduce:animate-none';
export const C360_TILE_SKELETON_VALUE = 'mt-2.5 h-6 w-16 rounded bg-neutral-200/70 animate-pulse motion-reduce:animate-none';
/** 12개월 막대 — 맥락 줄 자리에 들어간다 */
export const C360_BARS = 'mt-2.5 h-7 flex items-end gap-[3px]';
export const C360_BAR_ON = 'flex-1 rounded-sm bg-indigo-500 min-h-[3px]';
export const C360_BAR_OFF = 'flex-1 rounded-sm bg-neutral-200 min-h-[3px]';

// ────────────── 레일: 기본 정보 · 캡션 ──────────────

export const C360_RAIL_SPLIT = 'h-px bg-neutral-200 mx-4';
export const C360_BASIC_HEAD = 'w-full h-10 px-4 flex items-center gap-1.5 text-[13px] font-medium text-neutral-600 hover:bg-neutral-100 transition-colors';
export const C360_BASIC_BODY = 'px-4 pb-4';
export const C360_SOURCE = 'mt-auto px-4 py-3 text-[10px] text-neutral-400 italic';

// ────────────── 툴바 ──────────────

export const C360_TOOLBAR1 = 'shrink-0 min-h-[48px] px-4 md:px-5 py-1.5 flex items-center gap-2 flex-wrap border-b border-neutral-200 bg-white';
export const C360_SEARCH_WRAP = 'flex-1 min-w-[180px] max-w-[320px]';
export const C360_SEARCH_CLEAR = 'h-5 w-5 grid place-items-center rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 shrink-0';
export const C360_SEG = 'h-8 rounded-lg bg-neutral-100 p-0.5 flex shrink-0';
export const C360_SEG_ON = 'h-7 px-2.5 rounded-md text-[12.5px] font-semibold bg-white text-neutral-900 transition-colors';
export const C360_SEG_OFF = 'h-7 px-2.5 rounded-md text-[12.5px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors';
export const C360_CLEAR_BTN = 'ml-auto h-8 px-2.5 rounded-lg text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors whitespace-nowrap';
/** 칩 줄 — `CUI_CHIPS`(overflow-x-auto)를 쓰지 않는다. 칩이 가로 스크롤에 갇혔던 사고의 재발 방지 */
export const C360_TOOLBAR2 = 'shrink-0 min-h-[40px] px-4 md:px-5 py-1 flex items-center gap-0.5 flex-wrap border-b border-neutral-200 bg-white';

/** 원천 안내 — CUI_INFO·CUI_NOTICE는 mt-3을 갖고 있어 툴바 아래에 붙여 쓰면 여백이 생긴다(마진 없는 리터럴) */
export const C360_BANNER_INFO = 'shrink-0 px-5 py-2 flex gap-2 items-start border-b border-indigo-100 bg-indigo-50 text-[12px] text-indigo-900';
export const C360_BANNER_NOTICE = 'shrink-0 px-5 py-2 flex gap-2 items-start border-b border-amber-200 bg-amber-50 text-[12px] text-amber-900';
export const C360_BANNER_ICON_INFO = 'w-3.5 h-3.5 shrink-0 mt-px text-indigo-600';
export const C360_BANNER_ICON_NOTICE = 'w-3.5 h-3.5 shrink-0 mt-px text-amber-700';

// ────────────── 타임라인 ──────────────

export const C360_LIST = 'flex-1 min-h-0 overflow-y-auto';
export const C360_LIST_DIM = 'flex-1 min-h-0 overflow-y-auto opacity-40 transition-opacity';
/** 날짜 머리 — 표 헤더와 같은 언어(불투명 필수: sticky 아래 행이 비치면 안 된다) */
export const C360_DAY = 'sticky top-0 z-10 h-8 px-4 md:px-5 flex items-center justify-between bg-gray-50 border-b border-neutral-200';
export const C360_DAY_LABEL = 'text-[12px] font-semibold text-neutral-600';
export const C360_DAY_COUNTS = 'text-[11.5px] text-neutral-400 tabular-nums';

/** 행 격자: 시각 52 · 타일 28 · 제목 1fr · chevron 20 */
export const C360_ROW =
  'relative w-full text-left grid grid-cols-[44px_28px_1fr_20px] md:grid-cols-[52px_28px_1fr_20px] gap-x-3 px-4 md:px-5 py-2.5 min-h-[56px] items-start ' +
  'border-b border-neutral-100 transition-colors';
export const C360_ROW_HOVER = 'hover:bg-indigo-50/40 cursor-pointer';
export const C360_ROW_STATIC = 'cursor-default';
export const C360_ROW_OPEN = 'bg-neutral-50';
export const C360_TIME = 'text-[12px] tabular-nums text-neutral-400 text-right pt-[3px] leading-[1.3]';
export const C360_TIME_RANGE = 'block text-[10.5px] text-neutral-300';
/** 타일은 축선 위에 얹힌다 — ring-2 ring-white로 선을 끊는다 */
export const C360_TILE_ICON = 'relative z-[1] h-7 w-7 rounded-lg grid place-items-center ring-2 ring-white';
/** 축선 — 2열 안 절대 배치. 그룹 첫 행은 위를, 마지막 행은 아래를 끊는다(리터럴 3종) */
export const C360_AXIS = 'absolute left-1/2 -ml-px top-0 bottom-0 w-px bg-neutral-200';
export const C360_AXIS_FIRST = 'absolute left-1/2 -ml-px top-[14px] bottom-0 w-px bg-neutral-200';
export const C360_AXIS_LAST = 'absolute left-1/2 -ml-px top-0 h-[14px] w-px bg-neutral-200';
export const C360_AXIS_ONLY = 'hidden';
export const C360_AXIS_COL = 'relative h-full min-h-[28px]';
export const C360_DOT = 'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white';
export const C360_TITLE = 'text-[13.5px] font-medium text-neutral-900 truncate';
export const C360_TITLE_ROW = 'flex items-center gap-1.5 min-w-0';
export const C360_SUBTITLE = 'mt-0.5 text-[12px] text-neutral-500 truncate';
export const C360_COUNT = 'h-[19px] px-1.5 rounded-md bg-neutral-100 text-[11px] font-semibold text-neutral-600 tabular-nums inline-flex items-center shrink-0';
export const C360_CHEVRON = 'w-4 h-4 text-neutral-300 transition-transform mt-0.5';
export const C360_MARK = 'bg-indigo-100 text-indigo-900 rounded-[3px] px-0.5';

/** 묶음 하위 줄 — 행 버튼 **밖**(버튼 중첩 금지). 타일 대신 점 */
export const C360_SUBROWS = 'relative bg-neutral-50 border-b border-neutral-100';
export const C360_SUBROW = 'grid grid-cols-[44px_28px_1fr] md:grid-cols-[52px_28px_1fr] gap-x-3 px-4 md:px-5 py-1.5 items-center';
export const C360_SUBROW_TIME = 'text-[12px] tabular-nums text-neutral-400 text-right';
export const C360_SUBROW_DOT_COL = 'relative self-stretch min-h-[16px] grid place-items-center';
/** 하위 줄을 관통하는 축선 — 마지막 줄은 위 절반만 */
export const C360_SUBAXIS = 'absolute left-1/2 -ml-px top-0 bottom-0 w-px bg-neutral-200';
export const C360_SUBAXIS_LAST = 'absolute left-1/2 -ml-px top-0 h-1/2 w-px bg-neutral-200';
export const C360_SUBROW_DOT = 'relative z-[1] w-1.5 h-1.5 rounded-full bg-neutral-300 ring-2 ring-neutral-50';
export const C360_SUBROW_TEXT = 'text-[12px] text-neutral-500 truncate';

// ────────────── 펼침 상세 ──────────────

/** 펼침 전환 — grid-template-rows + opacity만(transform 0) */
export const C360_DETAIL_GRID = 'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none';
export const C360_DETAIL_CLIP = 'min-h-0 overflow-hidden';
/** 인덴트 124 = 제목 시작점(산식은 파일 머리) */
export const C360_DETAIL_WRAP = 'px-4 md:pl-[124px] md:pr-5 pb-3.5 bg-neutral-50 border-b border-neutral-100';
export const C360_CARD = 'rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 space-y-3';
/** 본문은 카드 안 흰 면 — 라이트 톤의 깊이는 그림자가 아니라 면 위의 면 */
export const C360_MSG = 'rounded-lg bg-white border border-neutral-200 px-3 py-2.5 text-[12.5px] leading-[1.7] text-neutral-800 whitespace-pre-wrap break-words';
export const C360_MSG_CLAMP = 'rounded-lg bg-white border border-neutral-200 px-3 py-2.5 text-[12.5px] leading-[1.7] text-neutral-800 whitespace-pre-wrap break-words line-clamp-[10]';
export const C360_MSG_MORE = 'mt-1 text-[12px] font-medium text-indigo-600 hover:text-indigo-700';
export const C360_META = 'grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5';
export const C360_META_ROW = 'flex items-baseline gap-1.5 min-w-0';
export const C360_META_DT = 'text-[11.5px] text-neutral-400 shrink-0';
export const C360_META_DD = 'text-[12.5px] text-neutral-800 tabular-nums break-words min-w-0';
export const C360_CARD_ACTIONS = 'pt-2.5 border-t border-neutral-200 flex justify-end';

// ────────────── 더 보기 · 상태 ──────────────

export const C360_MORE_WRAP = 'px-4 md:px-5 py-3';
export const C360_MORE_ERROR = 'text-[12px] text-rose-700 inline-flex items-center gap-2';
export const C360_EMPTY_LIGHT = 'py-12 px-6 flex flex-col items-center text-center';
export const C360_EMPTY_TITLE = 'text-[14px] font-semibold text-neutral-800';
export const C360_EMPTY_DESC = 'mt-1 text-[12.5px] text-neutral-500';
export const C360_EMPTY_ACTIONS = 'mt-4 flex items-center gap-2 flex-wrap justify-center';
export const C360_ERROR_WRAP = 'p-5';

/** 스켈레톤 행 — 제목 폭은 이 4종을 배열 인덱스로 번갈아 쓴다(템플릿 조립 0) */
export const C360_SK_TITLE_WIDTHS = ['w-[52%]', 'w-[38%]', 'w-[61%]', 'w-[44%]'] as const;
export const C360_SK_BAR = 'h-3.5 rounded bg-neutral-200/70 animate-pulse motion-reduce:animate-none';
export const C360_SK_SUB = 'mt-1.5 h-3 w-[28%] rounded bg-neutral-200/70 animate-pulse motion-reduce:animate-none';
export const C360_SK_TIME = 'h-3 w-9 ml-auto rounded bg-neutral-200/70 animate-pulse motion-reduce:animate-none';
export const C360_SK_TILE = 'h-7 w-7 rounded-lg bg-neutral-200/70 animate-pulse motion-reduce:animate-none';
