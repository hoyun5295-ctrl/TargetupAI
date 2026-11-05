/**
 * 「한 번에 보낼 최대 인원」 뜻 = 화면 문구 한 곳(★ 2026-11-05 C103 F5 · 설계서 docs/2026-11-05-intake-1104-fix-design.md §3 F5)
 *
 * [시작] 카드 · 켜기 창 · 켜기 전 점검 창이 이 함수만 부른다(옛: 켜기 창에만 「넘으면 멈춤」 · [시작] 카드엔 설명 0 →
 * 직원이 「50명 골라 보내고 나머지 이월」로 이해 · 1104 접수 3).
 * 사실 근거(서버) = journey-step-limits.ts entryCapExceeded · journey-anchor-scheduler.ts(넘으면 그 회차 0통 · 여정 멈춤)
 *   · journey-trigger-watcher.ts(하루 몫 = 「고른 고객에게」 · 휴면 여정만 · 있으면 나눠 받는다).
 */
export const JOURNEY_CAP_SET_TEXT = '한 회차에 이 수를 넘으면 그 회차는 보내지 않고 여정이 멈춰요(골라서 보내지 않아요). 멈추면 담당자에게 알려요.';
export const JOURNEY_CAP_SPLIT_TEXT = '나눠 보내려면 「하루에 N명씩 나눠 받기」를 써요.';
export const JOURNEY_CAP_EMPTY_TEXT = '비우면 제한 없이 보내요. 고객 정보를 한꺼번에 옮겨 오면 들어온 분 모두에게 한꺼번에 나가요.';

/**
 * ★ 2026-11-05 C104 G6 — 이관 유예로 지금 빠진 수(서버 journey-intake-grace.ts intakeGraceHeldText 와 같은 글 · 짝 시험).
 *   약속하지 않는다(유예가 지난 뒤에도 조건에 맞아야 들어온다 · 1105 접수 「929명 · 1,084명」).
 */
export function journeyGraceHeldText(graceDays: number, graceHeld: number): string {
  return `등록한 지 ${graceDays}일이 안 된 ${graceHeld.toLocaleString('ko-KR')}명은 지금 빠져 있어요. ${graceDays}일이 지난 뒤에도 조건에 맞으면 들어와요.`;
}

/** cap = 지금 칸 값(비면 null) · standing = 하루 몫을 쓸 수 있는 여정(「고른 고객에게」 · 휴면) */
export function journeyCapHelp(cap: number | null, standing: boolean): string {
  if (cap == null) return JOURNEY_CAP_EMPTY_TEXT;
  return standing ? `${JOURNEY_CAP_SET_TEXT} ${JOURNEY_CAP_SPLIT_TEXT}` : JOURNEY_CAP_SET_TEXT;
}
