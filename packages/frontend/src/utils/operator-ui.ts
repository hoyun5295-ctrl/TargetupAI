/**
 * operator-ui.ts: AI 존(AI Operator 허브가 여는 화면) 클래스 토큰
 *
 * ★ 2026-09-30 AI 존 대개편(docs/2026-09-30-ai-zone-redesign-design.md): 짙은 slate-950 작업면 → **밝은 작업대**.
 *   Harold "허브는 저 색감인데 아래는 기존처럼 껌껌하다 너무 끔찍하지 않냐" · 직원 "짙은 화면이 어두워 안 보인다".
 *   체계 = 남색 머리 띠(#0F172A · 허브 명령 띠와 같은 값) + 밝은 작업대(slate-100) + 흰 카드(2겹 그림자) + 인디고 강조.
 *   머리 줄·명령 카드·강조 카드·행 동작 같은 **틀은 `components/zone/` 부품이 소유**하고, 이 파일은 값만 둔다.
 *   (0821 체계 = 허브 보라 무접촉 + 메뉴 안 slate-950 은 이번 개편으로 대체됐다 · 옛 값은 설계서 §1 D1·D4)
 *
 * 어느 CT를 쓰나 (한 줄 규칙)
 *   뒤로가기를 따라 올라간 뿌리가 `/ai-operator`면 `OUI_`(+ zone 부품) / 관리·조회(`/manage`·설정·결과)면 `CUI_` / DM 편집기 안이면 `DM_`.
 *   콘솔과 값이 같은 것(입력·선택·표)은 CUI 를 그대로 쓴다. 여기는 AI 존에만 있는 것(남색 띠·작업대·카드 그림자)과 옛 이름의 밝은 값.
 *
 * ⛔ 지키는 계약
 *   - 클래스명을 템플릿 문자열로 **조립하지 않는다**. 전부 완성된 리터럴이어야 Tailwind가 읽는다.
 *   - `disabled:opacity-*`는 {30,40,50,60}만(`ui-token-invariants.test.ts`).
 *   - 이 파일은 JSX 없는 `.ts`로 둔다. 백엔드 계약 테스트가 값을 import해 단정한다(`zone-surface-invariants.test.ts`).
 */

/** 남색 띠 = 허브 명령 띠·머리 띠 공통 값(slate-900 = #0F172A) */
export const OUI_BAND = 'bg-slate-900';
/** 띠의 비블러 방사 빛 1개(허브 띠 첫 빛과 같은 값) */
export const OUI_BAND_GLOW = 'bg-[radial-gradient(360px_120px_at_8%_0%,rgba(99,102,241,0.20),transparent_70%)]';

/** 페이지 바닥: 밝은 작업대. `relative`는 떠 있는 요소의 기준이다. */
export const OUI_PAGE = 'relative min-h-screen bg-slate-100 text-slate-900';

/** 로딩·에러 같은 조기 반환 화면의 바닥(본문과 같은 색이어야 진입 때 번쩍이지 않는다) */
export const OUI_PAGE_CENTER = 'min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center';

/** (옛) 상단 아우라: 밝은 작업대에서는 그리지 않는다. 남색 띠가 빛을 가진다. 소비처 호환용 빈 값. */
export const OUI_AURA_WRAP = 'hidden';
export const OUI_AURA = 'hidden';

/** 본문 폭: 모든 메뉴 1240(콘솔 CUI_WRAP 와 같은 값 · 메뉴를 옮겨도 왼쪽선이 같다). 흐름 화면은 안쪽 768. */
export const OUI_WRAP_NARROW = 'max-w-[1240px] mx-auto px-4 md:px-6';
export const OUI_WRAP_WIDE = 'max-w-[1240px] mx-auto px-4 md:px-6';
export const OUI_WRAP_FULL = 'w-full px-4 md:px-6';
/** 흐름 화면의 본문 칸(1240 안에서 왼쪽 정렬 768) */
export const OUI_FLOW_COL = 'w-full max-w-3xl';

/** (옛 머리 토큰) 머리 줄은 `ZoneHeader`가 소유한다. 편집기 머리처럼 부품 밖에서 남색 머리를 그릴 때만 쓴다. */
export const OUI_HEADER = 'sticky top-0 z-30 bg-slate-900 text-white border-b border-white/10';
export const OUI_HEADER_ROW = 'h-14 md:h-16 flex items-center gap-2 md:gap-3';
export const OUI_BACK = 'w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white transition-colors shrink-0';
/** 아이콘 타일: 그라데이션은 호출부가 `bg-gradient-to-br from-… to-…`로 붙인다(허브 타일과 같은 값). */
export const OUI_ICON_TILE = 'w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0 shadow-md text-white';
export const OUI_TITLE = 'text-[16px] md:text-[18px] font-semibold tracking-[-0.02em] text-white leading-tight';
export const OUI_SUBTITLE = 'text-[13px] text-slate-400 mt-0.5 hidden md:block';
export const OUI_BADGE_NEW = 'text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200';

/** 버튼: 채움은 명령 카드 오른쪽 끝 1개(부품 소유). 작업면 안 확정 = 인디고, 나머지 = 외곽선·고스트 */
export const OUI_BTN_PRIMARY = 'h-9 px-3.5 rounded-[10px] text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
export const OUI_BTN_OUTLINE = 'h-9 px-3.5 rounded-[10px] text-[13px] font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
/** AI 동작 버튼(AI로 캡션 쓰기 등): 작업면 안에서는 외곽선 인디고(채움 앰버는 명령 카드 한 자리만) */
export const OUI_BTN_AI = 'h-9 px-3.5 rounded-[10px] text-[13px] font-semibold text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
export const OUI_BTN_GHOST = 'h-9 px-3 rounded-[10px] text-[13px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 inline-flex items-center gap-1.5 transition-colors';

/** 카드: 흰 판 + 기능 카드 2겹 그림자(허브 목업 값) */
export const OUI_CARD = 'bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_-16px_rgba(15,23,42,0.25)]';
export const OUI_CARD_HOVER = 'hover:border-indigo-200 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_18px_40px_-16px_rgba(15,23,42,0.32)] transition-all';
/** 강조 카드(화면당 1): 흰 판 + 인디고 선 */
export const OUI_CARD_ACCENT = 'rounded-2xl border border-indigo-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_-16px_rgba(15,23,42,0.25)]';
/** 명령 카드 그림자(허브 명령 카드 값) */
export const OUI_CMD_SHADOW = 'shadow-[0_2px_4px_rgba(15,23,42,0.06),0_18px_36px_-16px_rgba(15,23,42,0.30)]';

/** 빈 상태: 아이콘 타일 + 제목 + 한 줄 */
export const OUI_EMPTY = 'p-10 md:p-12 text-center';
export const OUI_EMPTY_ICON = 'w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center mb-3';
export const OUI_EMPTY_TITLE = 'text-[15px] font-semibold text-slate-900';
export const OUI_EMPTY_DESC = 'text-[13px] text-slate-500 mt-1';

/** 탭(작업면 안 · 활성 = 인디고 밑줄). 메뉴 탭은 머리 띠 둘째 줄(ZoneHeader) */
export const OUI_TAB_ON = 'px-3 py-2 text-[14px] font-semibold text-indigo-700 border-b-2 border-indigo-600';
export const OUI_TAB_OFF = 'px-3 py-2 text-[14px] font-medium text-slate-500 hover:text-slate-800 border-b-2 border-transparent transition-colors';

/** 출처 캡션(카드·차트별 · 밝은 작업대 값) */
export const OUI_SRC = 'text-[10px] text-slate-400 italic';

/** Recharts 툴팁: 흰 판 + 옅은 테두리 */
export const OUI_CHART_TOOLTIP = { backgroundColor: '#ffffff', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#0F172A' } as const;
/** Recharts 축·격자 색(밝은 작업대) */
export const OUI_CHART_AXIS = '#64748B';
export const OUI_CHART_GRID = '#E2E8F0';
