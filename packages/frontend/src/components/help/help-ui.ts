/**
 * help-ui.ts — 도움말 봇·안내 화면 전용 클래스 리터럴 (★ 2026-08-22 신설)
 *
 * 톤 = 라이트 인디고(`CUI_*`와 같은 언어). 47개 화면 전역에 뜨는 읽기 표면이라 어느 화면 위에서도
 * "시스템 요소"로 읽혀야 한다(토스트가 다크 화면 위에서도 같은 모양인 것과 같은 이유).
 *
 * ⛔ 런처·패널에 transform·filter·backdrop-filter·animate-in 계열 0. 패널 안에서 fixed 오버레이가 열릴 수 있다.
 * 층: 런처 z-[1400] · 패널 z-[1500]. 인터럽트(z-[2000]) 아래, 일반 모달(z-50~70) 위. 토스트(z-[10000])는 항상 위.
 * 자리: 우측 하단(Harold 2026-08-22). 토스트가 같은 자리를 쓰므로 `data-toast-open`이면 런처가 위로 비켜선다.
 */

// ────────────── 런처 ──────────────
export const HELP_LAUNCHER_WRAP = 'fixed z-[1400] right-4 bottom-4 md:right-5 md:bottom-5 transition-[bottom] duration-200 motion-reduce:transition-none';
export const HELP_LAUNCHER_WRAP_SHIFTED = 'fixed z-[1400] right-4 bottom-20 md:right-5 md:bottom-24 transition-[bottom] duration-200 motion-reduce:transition-none';
export const HELP_LAUNCHER_BTN =
  'h-12 min-w-[48px] px-3 rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 flex items-center gap-2 ' +
  'hover:bg-indigo-700 active:bg-indigo-800 transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/30';
export const HELP_LAUNCHER_LABEL = 'text-[13px] font-semibold whitespace-nowrap pr-1';
export const HELP_LAUNCHER_COUNT = 'text-[11.5px] font-medium text-white/80 tabular-nums';

// ────────────── 패널 ──────────────
export const HELP_PANEL =
  'fixed z-[1500] right-3 left-3 bottom-[76px] md:left-auto md:right-5 md:bottom-[84px] md:w-[380px] ' +
  'max-h-[min(640px,calc(100dvh-100px))] bg-white rounded-2xl border border-neutral-200 shadow-2xl shadow-neutral-900/15 ' +
  'flex flex-col overflow-hidden';
export const HELP_HEAD = 'shrink-0 h-12 px-4 flex items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50';
export const HELP_HEAD_TITLE = 'text-[14px] font-bold tracking-[-0.02em] text-neutral-900 flex items-center gap-2';
export const HELP_HEAD_BADGE = 'h-[20px] px-2 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold inline-flex items-center';
export const HELP_HEAD_CLOSE = 'h-8 w-8 grid place-items-center rounded-lg text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 transition-colors';
export const HELP_BODY = 'flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3';
export const HELP_SECTION_TITLE = 'text-[11.5px] font-semibold text-neutral-500 tracking-[0.01em] px-0.5';
export const HELP_FOOT = 'shrink-0 border-t border-neutral-200 bg-white p-3';

// ────────────── 작업 카드 ──────────────
export const HELP_CARD = 'rounded-xl border border-neutral-200 bg-white overflow-hidden';
export const HELP_CARD_HEAD = 'w-full text-left px-3.5 py-3 flex items-start gap-3 hover:bg-neutral-50 transition-colors';
export const HELP_CARD_NUM = 'h-6 w-6 shrink-0 rounded-lg bg-indigo-50 text-indigo-600 grid place-items-center text-[12px] font-bold tabular-nums';
export const HELP_CARD_TITLE = 'text-[13.5px] font-semibold text-neutral-900 leading-snug';
export const HELP_CARD_GOAL = 'mt-0.5 text-[12px] text-neutral-500 leading-relaxed';
export const HELP_CARD_BODY = 'px-3.5 pb-3.5 pt-1 space-y-3 border-t border-neutral-100 bg-neutral-50';
export const HELP_STEP = 'flex gap-2 text-[12.5px] text-neutral-800 leading-relaxed';
export const HELP_STEP_NUM = 'shrink-0 w-4 text-[11.5px] text-neutral-400 tabular-nums pt-px';
export const HELP_BLOCKER = 'rounded-lg bg-white border border-neutral-200 px-3 py-2';
export const HELP_BLOCKER_SYMPTOM = 'text-[12px] font-semibold text-neutral-800';
export const HELP_BLOCKER_FIX = 'mt-0.5 text-[12px] text-neutral-600 leading-relaxed';
export const HELP_LOCK = 'inline-flex items-center gap-1 h-[20px] px-2 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold';
export const HELP_STUB = 'inline-flex items-center h-[20px] px-2 rounded-full bg-neutral-100 text-neutral-500 text-[11px] font-medium';
export const HELP_CARD_ACTIONS = 'flex items-center gap-2 flex-wrap';
export const HELP_BTN_PRIMARY = 'h-8 px-3 rounded-lg bg-indigo-600 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-indigo-700 transition-colors';
export const HELP_BTN_GHOST = 'h-8 px-2.5 rounded-lg text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 inline-flex items-center gap-1 transition-colors';

// ────────────── 답변 ──────────────
export const HELP_ANSWER = 'rounded-xl bg-indigo-50 border border-indigo-100 px-3.5 py-3 text-[13px] text-indigo-950 leading-relaxed whitespace-pre-wrap';
export const HELP_INTRO = 'rounded-xl bg-indigo-50 border border-indigo-100 px-3.5 py-3';
export const HELP_INTRO_TITLE = 'text-[13px] font-semibold text-indigo-950 flex items-center gap-1.5';
export const HELP_INTRO_DESC = 'mt-1 text-[12px] text-indigo-900/80 leading-relaxed';
export const HELP_ANSWER_Q = 'text-[12px] text-neutral-500 px-0.5';
export const HELP_MISS = 'rounded-xl bg-neutral-50 border border-neutral-200 px-3.5 py-3 text-[12.5px] text-neutral-700 leading-relaxed';

// ────────────── 입력 ──────────────
export const HELP_INPUT_WRAP = 'h-10 flex items-center gap-2 px-3 rounded-xl bg-neutral-50 border border-transparent transition focus-within:bg-white focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-600/15';
export const HELP_INPUT = 'w-full min-w-0 bg-transparent border-0 p-0 text-[13px] text-neutral-800 outline-none placeholder:text-neutral-400 focus:ring-0';
export const HELP_SEND = 'h-8 w-8 shrink-0 grid place-items-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:pointer-events-none transition-colors';

// ────────────── 상태 ──────────────
export const HELP_SKELETON = 'h-14 rounded-xl bg-neutral-100 animate-pulse motion-reduce:animate-none';
export const HELP_SOURCE = 'px-0.5 pt-1 text-[10px] text-neutral-400 italic';

// ────────────── 안내 화면(/guide) ──────────────
export const GUIDE_HERO = 'rounded-2xl border border-indigo-600/15 bg-gradient-to-b from-indigo-50 to-white p-6 md:p-8';
export const GUIDE_GROUP = 'mt-8';
export const GUIDE_GROUP_TITLE = 'text-[15px] font-semibold tracking-[-0.02em] text-neutral-900 mb-3';
export const GUIDE_GRID = 'grid grid-cols-1 md:grid-cols-2 gap-3';
export const GUIDE_CARD = 'text-left rounded-xl border border-neutral-200 bg-white p-4 hover:border-indigo-600/40 hover:bg-indigo-50/30 transition-colors';
export const GUIDE_CARD_TITLE = 'text-[14px] font-semibold text-neutral-900';
export const GUIDE_CARD_GOAL = 'mt-1 text-[12.5px] text-neutral-500 leading-relaxed';
export const GUIDE_DETAIL = 'rounded-2xl border border-neutral-200 bg-white p-6 md:p-8 space-y-6';
export const GUIDE_BACK = 'inline-flex items-center gap-1 text-[13px] font-medium text-neutral-500 hover:text-neutral-900 transition-colors';
