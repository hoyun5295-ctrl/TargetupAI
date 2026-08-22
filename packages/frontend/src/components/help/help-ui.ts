/**
 * help-ui.ts — 도움말 봇·안내 화면 전용 클래스 리터럴 (★ 2026-08-22 신설)
 *
 * 톤 = 라이트 인디고(`CUI_*`와 같은 언어). 47개 화면 전역에 뜨는 읽기 표면이라 어느 화면 위에서도
 * "시스템 요소"로 읽혀야 한다(토스트가 다크 화면 위에서도 같은 모양인 것과 같은 이유).
 *
 * ⛔ 런처·패널에 transform·filter·backdrop-filter·animate-in 계열 0. 패널 안에서 fixed 오버레이가 열릴 수 있다.
 *   (transform이 걸린 조상은 그 안 fixed의 기준이 되어 화면 기준 좌표가 어긋난다.)
 * 층: 런처 z-[1400] · 패널 z-[1500]. 인터럽트(z-[2000]) 아래, 일반 모달(z-50~70) 위. 토스트(z-[10000])는 항상 위.
 * 자리: 우측 하단(Harold 2026-08-22). 비켜서지 않는다 — 공용 알림은 우측 상단이고, 우하단을 쓰는 화면은
 *   그 화면을 공용 알림으로 되돌려 자리를 비웠다(`surface-flags.ts` 2026-08-22(2) 주석).
 *
 * 티저(★2026-08-22(2) Harold "저게 도움말인지 어떻게 알겠냐"): 첫 진입 1회만 문구가 펼쳐졌다 스스로 접힌다.
 *   ⛔ 폭 전환은 `transform: scale`이 아니라 **max-width**로 한다. 위 규약을 지키면서 같은 그림이 나온다.
 */

// ────────────── 런처 ──────────────
export const HELP_LAUNCHER_WRAP = 'fixed z-[1400] right-4 bottom-4 md:right-5 md:bottom-5';
export const HELP_LAUNCHER_BTN =
  'h-12 min-w-[48px] rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 flex items-center overflow-hidden ' +
  'hover:bg-indigo-700 active:bg-indigo-800 transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/30';
/** 아이콘 자리. 접힌 상태의 지름(48px)을 이 칸이 혼자 만든다 */
export const HELP_LAUNCHER_ICON = 'w-12 h-12 shrink-0 grid place-items-center';
/** 문구 자리. 평소 폭 0 → 펼칠 때만 자란다 */
export const HELP_LAUNCHER_TEXT =
  'overflow-hidden whitespace-nowrap text-[13px] font-semibold flex items-center ' +
  'transition-[max-width,opacity,padding] duration-500 ease-out motion-reduce:transition-none';
export const HELP_LAUNCHER_TEXT_OPEN = 'max-w-[240px] opacity-100 pr-4';
export const HELP_LAUNCHER_TEXT_CLOSED = 'max-w-0 opacity-0 pr-0';
export const HELP_LAUNCHER_COUNT = 'text-[11.5px] font-medium text-white/80 tabular-nums ml-1.5';
/** 첫 진입 안내 문구. 고객 언어 그대로 */
export const HELP_TEASE_TEXT = '궁금한 건 물어보세요';

// ────────────── 헤더 진입점(대시보드) ──────────────
export const HELP_HEADER_BTN =
  'h-7 md:h-8 px-2.5 md:px-3 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 ' +
  'text-[11.5px] md:text-[12.5px] font-semibold inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap ' +
  'hover:bg-indigo-100 transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/20';

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
