/**
 * 혜택 기간 화면 CT(★ 2026-11-05 C105 H1 · 설계서 docs/2026-11-05-c105-out-of-scope-five-design.md §4 H1).
 *
 * 옛: AI한줄로 「문안에 넣을 내용」 창(LineIntakeModal)과 한줄 단계 창(LineStepsModal)이 칩 · 기간 글 함수를 두 벌 가졌고,
 *     마감일 하나만 받아 「11/1 ~ 30」 같은 기간을 못 적었다(1105 접수 서수란).
 * 지금: 두 창이 이 파일의 칩 · 글 · 검사와 공용 입력 LinePeriodPick 하나를 쓴다.
 *   - 시작일(선택) · 마감일 · 시작일은 오늘 −365일부터(이미 시작한 행사) · 마감일은 max(오늘, 시작일)부터 오늘 +399일까지
 *     (서버 readLinePeriod = 마감 오늘 −1일 ~ +400일 · 시작 오늘 −365일 ~ 마감 · 화면이 더 좁다 = 서버가 거절할 날을 고르지 못한다 · Codex 설계 1R).
 *   - 화면 글 = 짧은 꼴(올해면 연도 없음) · 서버 문안 글(linePeriodLabel · 연도 포함)과 일부러 다르다.
 */
const DAY = 86_400_000;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD'(지역 날짜) */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 마감 칩(이번 주 일요일 · 일주일 · 이달 말) — 시작일 없음 */
export function periodChips(): Array<{ label: string; value: string }> {
  const now = new Date();
  const sunday = new Date(now); sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const week = new Date(now); week.setDate(now.getDate() + 6);
  const out = [{ label: '이번 주 일요일까지', value: ymd(sunday) }, { label: '일주일 동안', value: ymd(week) }, { label: '이달 말까지', value: ymd(monthEnd) }];
  return out.filter((c, i) => out.findIndex((x) => x.value === c.value) === i);
}

function dayLabel(v: string, withYear: boolean): string {
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return v;
  return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일(${WEEK[new Date(y, m - 1, d).getDay()]})`;
}

/** 기간 글(화면) — 시작일 없음 = 「11월 30일(월)까지」 · 있음 = 「11월 1일(일) ~ 11월 30일(월)」 · 올해가 아니면 연도 */
export function periodLabel(end: string, start?: string | null): string {
  const thisYear = new Date().getFullYear();
  const yearOf = (v: string) => Number(v.slice(0, 4));
  if (!start) return `${dayLabel(end, yearOf(end) !== thisYear)}까지`;
  return `${dayLabel(start, yearOf(start) !== thisYear)} ~ ${dayLabel(end, yearOf(end) !== thisYear || yearOf(end) !== yearOf(start))}`;
}

/** 입력 범위(화면) */
export function periodBounds(start: string | null | undefined): { startMin: string; startMax: string; endMin: string; endMax: string } {
  const now = Date.now();
  const today = ymd(new Date(now));
  const endMax = ymd(new Date(now + 399 * DAY));
  return { startMin: ymd(new Date(now - 365 * DAY)), startMax: endMax, endMin: start && start > today ? start : today, endMax };
}

/** 고른 기간이 화면 범위 안인가(「다음」 판정 · 서버보다 좁다) */
export function isLinePeriodPickValid(end: string | null | undefined, start: string | null | undefined): boolean {
  if (!end) return !start;
  const b = periodBounds(start);
  if (end < b.endMin || end > b.endMax) return false;
  if (start && (start < b.startMin || start > end)) return false;
  return true;
}
