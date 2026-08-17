/**
 * kakao-ui.ts — 카카오 & RCS 화면(템플릿 관리) 라이트 톤 클래스 토큰
 *
 * 왜 이 파일이 있는가 (2026-08-17 Harold 지시 "이모지 빼고 흰 배경 모던하게, 인디고로"):
 *   화면 6개(페이지 1 + 섹션 2 + 폼 모달 3)를 같은 톤으로 다시 그리면서, 각 파일이 색·높이·라운드를
 *   손으로 적으면 다음 수정 때부터 값이 갈라진다. 실제로 이 화면은 그렇게 갈라져 있었다 —
 *   탭 3개가 amber/blue/purple로 제각각이었고, 그 색이 `border-${tab.color}-500`처럼
 *   **동적으로 조립**돼 Tailwind 스캐너가 읽지 못하는 상태였다(다른 파일에 같은 클래스가 있어 우연히 살아 있었다).
 *   그래서 **값을 이 파일 하나가 소유**하고, 화면은 이름만 부른다.
 *
 * 액센트 = 인디고. `dm-tokens.ts`의 `DM_COLOR_TOKENS.brand.primary`(#4f46e5)와 같은 값이라
 *   Tailwind `indigo-600`/`indigo-700`(#4338ca)/`indigo-50`(#eef2ff)이 그대로 대응한다.
 *   바이올렛은 이 앱에서 AI 기능 화면이 쓰는 색이라(LESSONS_FRONTEND 톤앤매너) 관리 화면에는 쓰지 않는다.
 *
 * ⛔ 지키는 계약
 *   - `disabled:opacity-*`는 앱 표준 집합 {30,40,50,60}만 (`ui-token-invariants.test.ts` 1번 규칙)
 *   - 클래스명을 템플릿 문자열로 **조립하지 않는다** — 전부 완성된 리터럴이어야 Tailwind가 읽는다
 *   - 이 파일은 카카오 & RCS 표면 전용이다. 다른 화면이 쓰고 싶으면 그때 공용으로 승격한다
 *     (지금 공용으로 만들면 40개 파일이 쓰는 다크 톤 규약과 충돌한다)
 */

// ────────────── 레이아웃 ──────────────

export const KUI_PAGE = 'min-h-screen bg-white';
export const KUI_WRAP = 'max-w-[1240px] mx-auto px-5 sm:px-6';

/** 상단 헤더 — 불투명 흰색(반투명 + blur는 글씨를 뭉갠다) */
export const KUI_HEADER = 'sticky top-0 z-40 bg-white border-b border-neutral-200';
export const KUI_TITLE = 'text-[18px] font-bold tracking-[-0.03em] text-neutral-900 leading-none';
export const KUI_SUBTITLE = 'mt-1.5 text-[13px] text-neutral-500 leading-none';

/** 섹션 제목 */
export const KUI_SEC_TITLE = 'text-[15px] font-semibold tracking-[-0.02em] text-neutral-900';
export const KUI_SEC_DESC = 'mt-1 text-[13px] text-neutral-500';
/** 섹션 사이 구분 */
export const KUI_SEC_SPLIT = 'mt-9 pt-7 border-t border-neutral-200';

// ────────────── 탭 ──────────────
// 탭 색은 하나다. 활성만 인디고, 나머지는 무채색 — 채널마다 색을 다르게 주면 위계가 아니라 소음이 된다.

export const KUI_TABS = 'relative flex items-center gap-0.5 -mb-px';
export const KUI_TAB_BASE =
  'relative h-11 px-3 inline-flex items-center gap-1.5 text-[14px] whitespace-nowrap rounded-t-md ' +
  'transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/15';
export const KUI_TAB_ON = 'font-semibold text-indigo-600';
export const KUI_TAB_OFF = 'font-medium text-neutral-500 hover:text-neutral-900';
/** 탭 옆 건수 */
export const KUI_TAB_COUNT_ON = 'text-[12px] font-normal text-indigo-600/60 tabular-nums';
export const KUI_TAB_COUNT_OFF = 'text-[12px] font-normal text-neutral-400 tabular-nums';
/** 활성 탭 밑줄 — transform으로 미끄러진다 */
export const KUI_TAB_INK =
  'absolute bottom-[-1px] left-0 h-0.5 rounded-full bg-indigo-600 ' +
  'transition-[transform,width] duration-300 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none';

// ────────────── 버튼 ──────────────

const BTN_BASE =
  'h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg text-[13.5px] font-semibold whitespace-nowrap ' +
  'transition active:scale-[.98] motion-reduce:active:scale-100 disabled:opacity-40 disabled:pointer-events-none ' +
  'focus:outline-none focus-visible:ring-4';

/** 화면당 하나. 주요 행동 */
export const KUI_BTN_PRIMARY = `${BTN_BASE} bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-600/20`;
/** 보조 — 테두리만 */
export const KUI_BTN_OUTLINE = `${BTN_BASE} bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300 focus-visible:ring-indigo-600/15`;
/** 배경 없음 — 되돌아가기·닫기 */
export const KUI_BTN_GHOST = `${BTN_BASE} font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-indigo-600/15`;
/** 파괴적 행동 */
export const KUI_BTN_DANGER = `${BTN_BASE} bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600/20`;
/** 정사각 아이콘 버튼 */
export const KUI_ICON_BTN =
  'h-9 w-9 grid place-items-center rounded-lg text-neutral-500 transition active:scale-95 motion-reduce:active:scale-100 ' +
  'hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40 disabled:pointer-events-none ' +
  'focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/15';

// ────────────── 입력 ──────────────

/** 검색 필드 껍데기 — 안에 아이콘·input·구분선을 넣는다 */
export const KUI_FIELD =
  'h-9 flex items-center gap-2 px-2.5 rounded-lg bg-neutral-50 border border-transparent transition ' +
  'focus-within:bg-white focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-600/15';
export const KUI_FIELD_INPUT =
  'w-full min-w-0 bg-transparent border-0 p-0 text-[13px] text-neutral-800 outline-none placeholder:text-neutral-400 focus:ring-0';

/** 폼 안의 일반 입력 — 라벨 아래 한 줄 */
export const KUI_INPUT =
  'w-full h-9 px-3 rounded-lg bg-white border border-neutral-200 text-[13.5px] text-neutral-900 transition ' +
  'placeholder:text-neutral-400 hover:border-neutral-300 ' +
  'focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 ' +
  'disabled:opacity-50 disabled:bg-neutral-50';
export const KUI_TEXTAREA =
  'w-full px-3 py-2.5 rounded-lg bg-white border border-neutral-200 text-[13.5px] text-neutral-900 leading-relaxed transition resize-none ' +
  'placeholder:text-neutral-400 hover:border-neutral-300 ' +
  'focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 ' +
  'disabled:opacity-50 disabled:bg-neutral-50';
export const KUI_SELECT =
  'w-full h-9 pl-3 pr-8 rounded-lg bg-white border border-neutral-200 text-[13.5px] text-neutral-900 appearance-none cursor-pointer transition ' +
  'hover:border-neutral-300 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 ' +
  'disabled:opacity-50 disabled:bg-neutral-50';
export const KUI_LABEL = 'block text-[12.5px] font-medium text-neutral-600 mb-1.5';
/** 필수 표시 */
export const KUI_REQUIRED = 'text-rose-500';
/** 입력 아래 도움말 */
export const KUI_HINT = 'mt-1.5 text-[12px] text-neutral-500 leading-relaxed';

// ────────────── 필터 칩 ──────────────

export const KUI_CHIPS = 'flex items-center gap-0.5 overflow-x-auto -mx-1 px-1 pb-0.5';
const CHIP_BASE =
  'h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] whitespace-nowrap transition ' +
  'focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/15';
export const KUI_CHIP_ON = `${CHIP_BASE} bg-indigo-600 text-white font-semibold`;
export const KUI_CHIP_OFF = `${CHIP_BASE} font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900`;
export const KUI_CHIP_COUNT_ON = 'text-[11.5px] text-white/60 tabular-nums';
export const KUI_CHIP_COUNT_OFF = 'text-[11.5px] text-neutral-400 tabular-nums';

// ────────────── 표 ──────────────
// 그림자를 쓰지 않는다. 헤어라인 + 옅은 헤더 배경만으로 구분한다.

export const KUI_PANEL = 'rounded-xl border border-neutral-200 bg-white overflow-hidden';
export const KUI_SCROLL_X = 'overflow-x-auto';
export const KUI_THEAD = 'bg-neutral-50 border-b border-neutral-200';
export const KUI_TH = 'h-[42px] px-4 text-left text-[12px] font-semibold text-neutral-500 tracking-[0.01em] whitespace-nowrap';
export const KUI_TH_RIGHT = `${KUI_TH} text-right`;
/** 우측 고정 관리 열 — 표가 뷰포트보다 넓어도 액션이 항상 보인다 */
export const KUI_TH_STICKY = `${KUI_TH} sticky right-0 z-20 bg-neutral-50 border-l border-neutral-200 text-right`;
export const KUI_TR = 'group border-b border-neutral-100 last:border-b-0 transition-colors hover:bg-indigo-50/50';
export const KUI_TD = 'px-4 py-3 align-middle whitespace-nowrap';
export const KUI_TD_STICKY = 'sticky right-0 z-10 px-3 py-3 bg-white group-hover:bg-indigo-50/50 border-l border-neutral-200 text-right';

/** 셀 안 텍스트 — 데이터는 진하게, 라벨만 흐리게 */
export const KUI_CELL_NAME = 'text-[13.5px] font-semibold text-neutral-900';
export const KUI_CELL_DATA = 'text-[13.5px] text-neutral-800';
export const KUI_CELL_META = 'text-[13px] text-neutral-500 tabular-nums';
export const KUI_CELL_CODE = 'font-mono text-[11.5px] text-neutral-500';
export const KUI_CELL_CODE_CHIP = 'font-mono text-[11.5px] text-neutral-600 bg-neutral-100 px-1.5 py-px rounded';
export const KUI_CELL_OFF = 'text-[13px] text-neutral-300';

/** 행 hover에만 나타나는 복사 버튼 */
export const KUI_COPY_BTN =
  'h-5 w-5 grid place-items-center rounded shrink-0 text-neutral-400 opacity-0 transition ' +
  'group-hover:opacity-100 focus:opacity-100 hover:text-indigo-600 hover:bg-white ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600/25';

/** 행 액션 — 대표 1개는 글자, 나머지는 ⋯ 뒤로 */
export const KUI_ACTS = 'inline-flex items-center gap-0.5 justify-end';
export const KUI_ACT =
  'h-7 px-2.5 rounded-md text-[12.5px] font-semibold text-indigo-600 transition whitespace-nowrap ' +
  'hover:bg-indigo-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600/25';
export const KUI_ACT_MORE =
  'h-7 w-7 grid place-items-center rounded-md text-neutral-400 transition ' +
  'hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600/25';
/** ⋯ 안에서 열리는 목록 */
export const KUI_MENU =
  'absolute right-0 top-full mt-1 z-30 min-w-[132px] py-1 rounded-lg border border-neutral-200 bg-white shadow-lg ' +
  'shadow-neutral-900/[.08] animate-in fade-in zoom-in-95 duration-150';
export const KUI_MENU_ITEM =
  'w-full h-8 px-3 flex items-center text-[12.5px] text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900';
export const KUI_MENU_ITEM_DANGER =
  'w-full h-8 px-3 flex items-center text-[12.5px] text-rose-600 transition hover:bg-rose-50';

// ────────────── 상태 칩 ──────────────
// 앞에 점을 달아 색이 옅어도 상태가 읽힌다(색맹 대비).

export const KUI_PILL_BASE =
  'inline-flex items-center gap-1.5 h-[23px] px-2.5 rounded-full text-[12px] font-semibold tracking-[-0.01em] whitespace-nowrap';
export const KUI_PILL_DOT = 'w-[5px] h-[5px] rounded-full bg-current opacity-80 shrink-0';

/** 상태 색 — 의미만 색을 갖는다(중립/진행중/외부진행/완료/반려) */
export const KUI_PILL_TONE = {
  neutral: 'bg-neutral-100 text-neutral-600',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-800',
  green: 'bg-emerald-100 text-emerald-800',
  rose: 'bg-rose-100 text-rose-800',
} as const;
export type KuiPillTone = keyof typeof KUI_PILL_TONE;

// ────────────── 빈 상태 ──────────────

export const KUI_EMPTY =
  'rounded-xl border border-neutral-200 py-20 px-6 grid place-items-center text-center ' +
  'bg-gradient-to-b from-indigo-50 to-white to-[130px]';
export const KUI_EMPTY_BADGE =
  'h-12 w-12 rounded-2xl bg-white grid place-items-center text-indigo-600 mb-4 ring-1 ring-indigo-600/15 shadow-sm';
export const KUI_EMPTY_TITLE = 'text-[15px] font-semibold tracking-[-0.02em] text-neutral-900';
export const KUI_EMPTY_DESC = 'mt-1.5 text-[13px] text-neutral-500 max-w-[360px] leading-relaxed';

/** 시작 안내 패널 — 빈 상태보다 가볍게, 옆으로 눕힌 형태 */
export const KUI_SETUP =
  'rounded-xl border border-indigo-600/15 bg-indigo-50 p-5 flex flex-col sm:flex-row sm:items-center gap-4';
export const KUI_SETUP_BADGE = 'h-10 w-10 shrink-0 rounded-xl bg-white grid place-items-center text-indigo-600';
export const KUI_SETUP_TITLE = 'text-[14px] font-semibold text-neutral-900';
export const KUI_SETUP_DESC = 'mt-1 text-[13px] text-neutral-500 leading-relaxed';

// ────────────── 안내 · 선택 바 ──────────────

export const KUI_NOTICE = 'mt-3 flex gap-2.5 p-3.5 rounded-lg border border-amber-200 bg-amber-50';
export const KUI_NOTICE_ICON = 'text-amber-700 shrink-0 mt-px';
export const KUI_NOTICE_TEXT = 'text-[13px] text-amber-900 leading-relaxed';

export const KUI_INFO = 'flex gap-2.5 p-3.5 rounded-lg border border-indigo-600/15 bg-indigo-50';
export const KUI_INFO_ICON = 'text-indigo-600 shrink-0 mt-px';
export const KUI_INFO_TEXT = 'text-[13px] text-indigo-900 leading-relaxed';

export const KUI_DANGER_BOX = 'flex gap-2.5 p-3.5 rounded-lg border border-rose-200 bg-rose-50';
export const KUI_DANGER_ICON = 'text-rose-600 shrink-0 mt-px';
export const KUI_DANGER_TEXT = 'text-[13px] text-rose-900 leading-relaxed whitespace-pre-wrap break-words';

/** 여러 건 선택했을 때 뜨는 액션 바 */
export const KUI_BULK = 'mt-4 min-h-[46px] py-2 px-3.5 flex items-center justify-between gap-3 flex-wrap rounded-lg border border-indigo-600/15 bg-indigo-50';
export const KUI_BULK_TEXT = 'text-[13px] font-semibold text-indigo-700';

// ────────────── 모바일 카드 ──────────────
// 768px 아래에서 표 대신 쓴다. 가로 스크롤만 두면 손가락으로 읽을 수 없다.

export const KUI_CARDS = 'md:hidden rounded-xl border border-neutral-200 divide-y divide-neutral-100 overflow-hidden';
export const KUI_CARD = 'p-4';
export const KUI_CARD_TITLE = 'text-[14px] font-semibold text-neutral-900 truncate';
export const KUI_CARD_META = 'mt-2.5 flex items-center gap-2 flex-wrap text-[12.5px] text-neutral-500';
export const KUI_ONLY_DESKTOP = 'hidden md:block';

// ────────────── 모달(폼) ──────────────
// 확인 모달은 공용 ConfirmModal(다크 톤 · 40개 파일 공용)을 그대로 쓴다. 여기는 **폼 모달**만 담당한다.

export const KUI_MODAL_SCRIM =
  'fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 ' +
  'animate-in fade-in duration-150';
export const KUI_MODAL =
  'w-full bg-white rounded-2xl border border-neutral-200 shadow-2xl shadow-neutral-900/10 ' +
  'max-h-[92vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none';
export const KUI_MODAL_HEAD = 'shrink-0 px-6 py-4 border-b border-neutral-200 flex items-start justify-between gap-4';
export const KUI_MODAL_TITLE = 'text-[16px] font-bold tracking-[-0.02em] text-neutral-900';
export const KUI_MODAL_DESC = 'mt-1 text-[12.5px] text-neutral-500';
export const KUI_MODAL_BODY = 'flex-1 overflow-y-auto px-6 py-5 space-y-5';
export const KUI_MODAL_FOOT = 'shrink-0 px-6 py-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-end gap-2';
export const KUI_MODAL_CLOSE =
  'h-8 w-8 grid place-items-center rounded-lg text-neutral-400 shrink-0 transition ' +
  'hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/15';

/** 폼 안의 묶음 — 제목 + 내용 */
export const KUI_FIELDSET = 'space-y-3';
export const KUI_FIELDSET_TITLE = 'text-[13.5px] font-semibold text-neutral-900';

/** 카드형 라디오(메시지 유형 고르기 등) */
export const KUI_PICK_ON = 'p-3 rounded-lg border-2 border-indigo-600 bg-indigo-50 text-left transition';
export const KUI_PICK_OFF = 'p-3 rounded-lg border-2 border-neutral-200 bg-white text-left transition hover:border-neutral-300 hover:bg-neutral-50';
export const KUI_PICK_TITLE = 'text-[13.5px] font-semibold text-neutral-900';
export const KUI_PICK_DESC = 'mt-0.5 text-[12px] text-neutral-500';

// ────────────── 토스트 ──────────────

export const KUI_TOAST_BASE =
  'fixed bottom-6 right-6 z-[10000] h-11 px-4 inline-flex items-center gap-2 rounded-xl text-[13.5px] font-medium text-white ' +
  'shadow-lg shadow-neutral-900/20 animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none';
export const KUI_TOAST_SUCCESS = `${KUI_TOAST_BASE} bg-neutral-900`;
export const KUI_TOAST_ERROR = `${KUI_TOAST_BASE} bg-rose-600`;

// ────────────── 로딩 ──────────────

export const KUI_LOADING = 'py-16 grid place-items-center gap-3 text-[13px] text-neutral-500';
export const KUI_SPINNER = 'h-5 w-5 rounded-full border-2 border-neutral-200 border-t-indigo-600 animate-spin';

// ────────────── 페이지네이션 주변 ──────────────

export const KUI_TOTAL = 'text-[13px] text-neutral-500 tabular-nums';
export const KUI_TOTAL_NUM = 'font-semibold text-neutral-900';

// ────────────── 도우미 ──────────────

/** 조건부 클래스 — 삼항 연산자가 JSX 안에서 길어지는 것만 막는다 */
export function kcx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
