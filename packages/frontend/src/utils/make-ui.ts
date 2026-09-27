/**
 * make-ui.ts — 만들기·결과·수정·첫 화면 공용 표면 값(★ 2026-09-27 만들기 개편 · 목업 (가)~(마) 값 그대로)
 *
 * 작업면 = slate-950 단색 + 바이올렛 액센트(오퍼레이터 표면 체계와 같은 색 축). DM 빌더 페이지는 OUI_ 보호 목록이라
 * 이 값은 MK_ 이름으로 따로 둔다(operator-surface-invariants 계약). 화면은 이름만 부른다.
 */
export const MK_PAGE = 'relative min-h-screen bg-slate-950 text-white';
export const MK_HEADER = 'sticky top-0 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur-md';
export const MK_HEADER_ROW = 'h-[64px] md:h-[68px] flex items-center gap-3 px-4 md:px-6';
export const MK_BACK = 'p-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors shrink-0';
export const MK_TILE = 'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-[0_8px_18px_-8px_rgba(139,92,246,.6)]';
export const MK_TITLE = 'text-[17px] md:text-[19px] font-bold tracking-tight text-white leading-tight flex items-center gap-2 min-w-0';
export const MK_SUB = 'text-[12px] text-white/55 mt-0.5 hidden md:block truncate';

/** 만들기 버튼(노랑→분홍 · 목업 btn-ai) */
export const MK_BTN_AI = 'inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl text-[15px] font-extrabold text-indigo-950 bg-gradient-to-r from-amber-400 to-fuchsia-400 shadow-[0_10px_24px_-10px_rgba(217,70,239,.7)] hover:brightness-110 transition disabled:opacity-40 disabled:hover:brightness-100';
export const MK_BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-[14px] font-bold text-white bg-violet-600 hover:bg-violet-500 shadow-[0_8px_20px_-8px_rgba(139,92,246,.8)] transition-colors disabled:opacity-40';
export const MK_BTN_OUTLINE = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold text-white/85 border border-white/15 bg-white/[0.04] hover:bg-white/10 transition-colors disabled:opacity-40';
export const MK_BTN_GHOST = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold text-white/75 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40';
export const MK_BTN_SOFT_AI = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold text-fuchsia-100 border border-fuchsia-400/40 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 transition-colors disabled:opacity-40';

export const MK_CARD = 'rounded-[18px] bg-white/[0.05] border border-white/10';
export const MK_INPUT = 'w-full h-[46px] px-3.5 rounded-xl bg-slate-950/60 border border-white/15 text-[14px] text-white placeholder-white/35 outline-none focus:border-violet-400/70 transition-colors';
export const MK_TEXTAREA = 'w-full px-3.5 py-2.5 rounded-xl bg-slate-950/60 border border-white/15 text-[13.5px] leading-[1.7] text-white/90 placeholder-white/35 outline-none focus:border-violet-400/70 resize-none transition-colors';
export const MK_LABEL = 'text-[13px] font-bold text-white flex items-center gap-2';
export const MK_HINT = 'text-[12px] text-white/50 font-normal';
export const MK_SRC = 'text-[10px] text-white/30 italic';

export const MK_MODAL_BACKDROP = 'fixed inset-0 z-[1200] bg-black/65 backdrop-blur-sm flex items-center justify-center p-3 md:p-6';
export const MK_MODAL = 'bg-slate-900 border border-white/10 rounded-2xl shadow-2xl';

/** 칩 상태 색(초안·예약·보냄·중지·보내지 못함) */
export const MK_STATUS_CHIP: Record<string, string> = {
  draft: 'bg-slate-700/85 text-white/90',
  scheduled: 'bg-amber-400 text-amber-950',
  sent: 'bg-emerald-500 text-emerald-950',
  stopped: 'bg-slate-600 text-white/85',
  failed: 'bg-rose-500 text-white',
};
