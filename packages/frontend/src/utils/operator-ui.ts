/**
 * operator-ui.ts: AI Operator 계열 작업 화면(다크 톤) 클래스 토큰
 *
 * 왜 이 파일이 있는가 (2026-08-21 Harold 지시 "메뉴마다 배경색부터 아예 달라. 전체 통일")
 *   허브 타일 12종이 여는 화면 16개의 바닥이 5벌(보라 그라데이션 · slate 그라데이션 · slate 단색 ·
 *   slate+violet · 인라인 hex)이고 헤더 바 색이 3벌이었다. 만든 시기마다 손으로 적은 값이 갈라진 것이라
 *   **값을 이 파일 하나가 소유**하고 화면은 이름만 부른다(콘솔 톤 `console-ui.ts`와 같은 방식).
 *
 * 체계 (2026-08-21 전원 합의: 기획·프론트·디자이너·백엔드·회의론자)
 *   색은 2벌: 허브(`AiOperatorPage`) = 보라 그라데이션 + 글로우 3(무접촉, 이 파일의 대상이 아니다) /
 *   메뉴 안 = `bg-slate-950` 단색 + 바이올렛은 액센트만(버튼·활성 탭·진행바·아이콘 타일).
 *   단계는 아우라와 폭이 만든다: 흐름 작업면(아우라 1 · 3xl) · 데이터 작업면(아우라 1 · 7xl) · 캔버스 뷰(아우라 0 · 전면).
 *   통일성은 바닥보다 헤더가 만든다(상단 72px에 가장 먼저·가장 오래 보이는 색면): 뒤로가기 · 아이콘 타일 10x10(허브
 *   타일과 같은 그라데이션을 prop으로) · 제목 · 한 줄 부제 · 우측 액션 최대 2, sticky + 경계선.
 *
 * 어느 CT를 쓰나 (한 줄 규칙)
 *   뒤로가기를 따라 올라간 뿌리가 `/ai-operator`면 `OUI_` / 관리·조회(`/manage`·설정·결과)면 `CUI_` / DM 편집기 안이면 `DM_`.
 *   콘솔과 가르는 1차 축은 액센트 색이 아니라 **지면이 다크냐 라이트냐**다.
 *
 * ⛔ 지키는 계약
 *   - 클래스명을 템플릿 문자열로 **조립하지 않는다**. 전부 완성된 리터럴이어야 Tailwind가 읽는다.
 *   - 흰색 명도는 5단위 사다리만, `disabled:opacity-*`는 {30,40,50,60}만(`ui-token-invariants.test.ts`).
 *   - Data source 캡션 값은 `ui-token-invariants.test.ts`가 소유한다. 여기서 다시 정의하지 않는다(`OUI_SRC`는 같은 값의 참조).
 *   - 허브 값은 여기로 옮기지 않는다(0821 판정: 허브 지면·글로우 무접촉). 허브는 `operator-surface-invariants.test.ts` 보호 목록.
 *   - 이 파일은 JSX 없는 `.ts`로 둔다. 백엔드 계약 테스트가 값을 import해 단정한다(아우라 컴포넌트는 `components/operator/`).
 */

/** 페이지 바닥: slate-950 단색. `relative`는 아우라(absolute)의 기준이다. */
export const OUI_PAGE = 'relative min-h-screen bg-slate-950 text-white';

/** 로딩·에러 같은 조기 반환 화면의 바닥(본문과 같은 색이어야 진입 때 번쩍이지 않는다) */
export const OUI_PAGE_CENTER = 'min-h-screen bg-slate-950 text-white flex items-center justify-center';

/** 상단 아우라 1개: 헤더 근처 한 화면분만 살고 스크롤하면 사라진다(`absolute`, `fixed` 아님). 캔버스 뷰에는 두지 않는다. */
export const OUI_AURA_WRAP = 'pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden';
export const OUI_AURA = 'absolute -top-32 left-1/2 -translate-x-1/2 h-[420px] w-[720px] rounded-full bg-violet-600/10 blur-3xl';

/** 본문 폭 3단. 폭은 상한이지 강제가 아니다(표가 넓으면 7xl). */
export const OUI_WRAP_NARROW = 'max-w-3xl mx-auto px-4 md:px-6';
export const OUI_WRAP_WIDE = 'max-w-7xl mx-auto px-4 md:px-6';
export const OUI_WRAP_FULL = 'w-full px-4 md:px-6';

/** 헤더 바(sticky + 경계선). `border-b`를 빼면 950/80 헤더와 950 지면이 붙어 경계가 사라진다. */
export const OUI_HEADER = 'sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-white/10';
/** 헤더 한 줄(폭 토큰과 함께 쓴다): `${OUI_WRAP_WIDE} ${OUI_HEADER_ROW}` */
export const OUI_HEADER_ROW = 'py-3 md:py-4 flex items-center gap-3';
export const OUI_BACK = 'p-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors';
/** 아이콘 타일: 그라데이션은 호출부가 `bg-gradient-to-br from-… to-…`로 붙인다(허브 타일과 같은 값). */
export const OUI_ICON_TILE = 'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20';
export const OUI_TITLE = 'text-lg md:text-xl font-semibold text-white leading-tight';
export const OUI_SUBTITLE = 'text-xs text-white/50 mt-0.5 hidden md:block';
export const OUI_BADGE_NEW = 'text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/25 text-violet-200 border border-violet-400/30';

/** 헤더 우측 액션(최대 2): primary 1 + ghost 1 */
export const OUI_BTN_PRIMARY = 'h-9 px-3 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white inline-flex items-center gap-1.5 transition-colors disabled:opacity-50';
export const OUI_BTN_OUTLINE = 'h-9 px-3 rounded-lg text-xs font-medium text-violet-200 border border-violet-400/30 hover:bg-violet-500/15 inline-flex items-center gap-1.5 transition-colors';
export const OUI_BTN_GHOST = 'h-9 px-3 rounded-lg text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white inline-flex items-center gap-1.5 transition-colors';

/** 카드 한 벌 + 강조 카드(화면당 1개) */
export const OUI_CARD = 'bg-white/5 border border-white/10 rounded-2xl';
export const OUI_CARD_HOVER = 'hover:bg-white/[0.08] hover:border-white/20 transition-colors';
export const OUI_CARD_ACCENT = 'rounded-2xl border border-violet-400/40 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-transparent';

/** 빈 상태: 아이콘 타일 + 제목 + 한 줄 */
export const OUI_EMPTY = 'p-10 md:p-12 text-center';
export const OUI_EMPTY_ICON = 'w-12 h-12 rounded-2xl bg-white/5 border border-white/10 mx-auto flex items-center justify-center mb-3';
export const OUI_EMPTY_TITLE = 'text-sm font-semibold text-white/80';
export const OUI_EMPTY_DESC = 'text-xs text-white/50 mt-1.5';

/** 탭(활성 = 바이올렛 밑줄) */
export const OUI_TAB_ON = 'px-3 py-2 text-sm font-semibold text-white border-b-2 border-violet-500';
export const OUI_TAB_OFF = 'px-3 py-2 text-sm font-medium text-white/50 hover:text-white/80 border-b-2 border-transparent transition-colors';

/** Data source 캡션(값 소유 = ui-token-invariants. 참조만) */
export const OUI_SRC = 'text-[10px] text-white/30 italic';

/** Recharts 툴팁: 바닥이 950이라 툴팁은 한 단 밝은 900(#0f172a)이어야 떠 보인다 */
export const OUI_CHART_TOOLTIP = { backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 } as const;
