/**
 * make-ui.ts — 만들기·결과·수정·첫 화면 공용 표면 값(★ 2026-09-27 만들기 개편)
 *
 * ★ 2026-09-30 AI 존 대개편: 짙은 slate-950 → 밝은 작업대(operator-ui.ts 와 같은 축). 머리 줄은 `components/zone/` 부품이
 * 소유하고(편집기 머리는 EditShell), 여기 MK_HEADER* 는 부품 밖에서 남색 머리를 그리는 편집기 변형용으로만 남는다.
 */
export const MK_PAGE = 'relative min-h-screen bg-slate-100 text-slate-900';
export const MK_HEADER = 'sticky top-0 z-30 border-b border-white/10 bg-slate-900 text-white';
export const MK_HEADER_ROW = 'h-14 md:h-16 flex items-center gap-3 px-4 md:px-6';
/** ★1008 머리 아래 화면에 붙어 따라오는 옆 칸(넓은 화면만 · 길면 칸 안 스크롤) — 블록으로 만들기 양옆 칸 · 붙은 편집 창과 같은 자리 */
export const MK_SIDE_STICKY = 'lg:sticky lg:top-[72px] lg:max-h-[calc(100vh-88px)] lg:overflow-y-auto';
export const MK_BACK = 'w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white transition-colors shrink-0';
export const MK_TILE = 'w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0 shadow-md text-white';
export const MK_TITLE = 'text-[16px] md:text-[18px] font-semibold tracking-[-0.02em] text-white leading-tight flex items-center gap-2 min-w-0';
export const MK_SUB = 'text-[13px] text-slate-400 mt-0.5 hidden md:block truncate';

/** 명령 카드 한 줄 입력 옆 보조 버튼([이미지로 불러오기] 등 · 1차 버튼과 같은 높이 40) */
export const MK_LINE_EXTRA_BTN = 'h-10 px-3 inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white text-slate-700 text-[13px] font-semibold hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 shrink-0 transition-colors whitespace-nowrap';

/** 남색 머리 안 보조 버튼·전환(★ 2026-09-30 편집기 머리 규칙): 채움은 오른쪽 끝 1차 하나 — 나머지는 반투명 외곽선 */
export const MK_HEAD_BTN = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-white/15 bg-white/[0.06] text-[12.5px] font-semibold text-slate-200 hover:bg-white/[0.12] hover:text-white transition-colors disabled:opacity-30';
export const MK_HEAD_BTN_ON = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-white bg-white text-[12.5px] font-semibold text-slate-900 transition-colors';
export const MK_HEAD_SEG = 'inline-flex rounded-xl border border-white/15 bg-white/[0.06] p-1 shrink-0';
export const MK_HEAD_SEG_ON = 'bg-white text-slate-900';
export const MK_HEAD_SEG_OFF = 'text-slate-300 hover:text-white';
export const MK_HEAD_SEG_DISABLED = 'text-slate-500 cursor-not-allowed';
/** 남색 머리 안 저장 상태 글자색 */
export const MK_HEAD_SAVE_TONE: Record<'saved' | 'saving' | 'dirty' | 'error' | 'manual', string> = {
  saved: 'text-emerald-300', saving: 'text-slate-400', dirty: 'text-slate-400', error: 'text-rose-300', manual: 'text-amber-300',
};

/** 만들기 버튼(AI 생성 = 앰버 · 허브 [생성]과 같은 색) */
export const MK_BTN_AI = 'inline-flex items-center justify-center gap-2 h-10 px-5 rounded-[10px] text-[14px] font-bold text-slate-900 bg-amber-500 hover:bg-amber-400 transition-colors disabled:opacity-40';
export const MK_BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-[10px] text-[14px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-40';
export const MK_BTN_OUTLINE = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-[10px] text-[13px] font-semibold text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-40';
export const MK_BTN_GHOST = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-[10px] text-[13px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-40';
export const MK_BTN_SOFT_AI = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 transition-colors disabled:opacity-40';

export const MK_CARD = 'rounded-2xl bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_-16px_rgba(15,23,42,0.25)]';
export const MK_INPUT = 'w-full h-[46px] px-3.5 rounded-xl bg-white border border-slate-200 text-[14px] text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-400 transition-colors';
export const MK_TEXTAREA = 'w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-[13.5px] leading-[1.7] text-slate-800 placeholder-slate-400 outline-none focus:border-indigo-400 resize-none transition-colors';
export const MK_LABEL = 'text-[13px] font-bold text-slate-900 flex items-center gap-2';
export const MK_HINT = 'text-[12px] text-slate-500 font-normal';
export const MK_SRC = 'text-[10px] text-slate-400 italic';

export const MK_MODAL_BACKDROP = 'fixed inset-0 z-[1200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 md:p-6';
export const MK_MODAL = 'bg-white border border-slate-200 rounded-2xl shadow-2xl';

/** 칩 상태 색(초안·예약·보냄·중지·보내지 못함) · 밝은 작업대: 옅은 면 + 진한 글자(채움 앰버는 명령 카드 한 자리만) */
export const MK_STATUS_CHIP: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 border border-slate-200',
  scheduled: 'bg-amber-50 text-amber-800 border border-amber-200',
  sent: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  stopped: 'bg-slate-100 text-slate-500 border border-slate-200',
  failed: 'bg-rose-50 text-rose-700 border border-rose-200',
};
