/**
 * kr-holidays.ts — 한국 공휴일 CT (★ 2026-08-13(2) 마케팅 플래너 캘린더)
 *
 * **표를 갖는다. 계산하지 않는다.** 설·추석·부처님오신날은 음력이고 임시공휴일은 정부 지정이라
 * 어느 쪽도 코드가 만들어낼 수 없다. 음력 변환기를 들이면 그 변환기가 또 하나의 진실이 되고,
 * 그래도 임시공휴일은 여전히 못 만든다 — 관보로 확정된 값을 표로 두는 것이 유일하게 정확한 축이다.
 *
 * ⛔ 불변
 *   - **표에 없는 해를 추측해서 그리지 않는다.** `isYearReady(year) === false`면 화면이
 *     "공휴일 정보 준비 중"이라고 말한다. 빈 달력을 정상인 것처럼 보여주지 않는다(fail-closed).
 *   - 대체공휴일만 **규칙으로 계산한다**(규칙이 관보가 아니라 법령이라 해마다 바뀌지 않는다).
 *   - 날짜 축은 KST 'YYYY-MM-DD' 문자열 하나다. Date의 로컬 해석을 쓰지 않는다(해외 접속에서 하루가 밀린다).
 *   - 진실은 이 파일 하나다. 화면은 API로 받아 쓴다 — 프론트에 같은 표를 복사하지 않는다.
 *
 * 갱신 = 매년 1회, `LUNAR_HOLIDAYS`에 그 해 음력 3종을 넣고 임시공휴일이 지정되면 `EXTRA_HOLIDAYS`에 한 줄.
 */

/** 공휴일 1건 — 날짜(KST)와 이름. `substitute`는 대체공휴일 계산으로 생긴 날이다. */
export interface KrHoliday {
  date: string;
  name: string;
  substitute?: boolean;
}

/** 양력 고정 공휴일 — 해마다 같다(법정 공휴일). */
const FIXED_HOLIDAYS: Array<{ md: string; name: string }> = [
  { md: '01-01', name: '신정' },
  { md: '03-01', name: '삼일절' },
  { md: '05-05', name: '어린이날' },
  { md: '06-06', name: '현충일' },
  // ★ 제헌절 — 2026년 공휴일 재지정(「공휴일에 관한 법률」·「관공서의 공휴일에 관한 규정」 개정, 2026-05-11 시행).
  //   대체공휴일 조항(제3조)이 국경일을 그대로 참조해 제헌절도 대체 대상이다(2027-07-17 토 → 대체 07-19).
  { md: '07-17', name: '제헌절' },
  { md: '08-15', name: '광복절' },
  { md: '10-03', name: '개천절' },
  { md: '10-09', name: '한글날' },
  { md: '12-25', name: '성탄절' },
];

/**
 * 음력 연동 공휴일 — **그 해 관보 확정값만 넣는다.** 설날·추석은 당일만 적고 연휴(전날·다음날)는 계산한다.
 * ⛔ 값을 모르면 그 해를 넣지 않는다. 넣지 않으면 화면이 "준비 중"이라 말한다 — 틀린 날짜보다 낫다.
 */
const LUNAR_HOLIDAYS: Record<number, { seolnal: string; buddha: string; chuseok: string }> = {
  2026: { seolnal: '2026-02-17', buddha: '2026-05-24', chuseok: '2026-09-25' },
  2027: { seolnal: '2027-02-07', buddha: '2027-05-13', chuseok: '2027-09-15' },
};

/** 임시공휴일·선거일 등 그 해에만 있는 날 — 지정되면 한 줄 추가한다(계산 불가). */
const EXTRA_HOLIDAYS: Record<number, Array<{ date: string; name: string }>> = {};

/**
 * 대체공휴일 규칙 (관공서의 공휴일에 관한 규정) — **신정·현충일은 대상이 아니다.**
 *  - 설날·추석 연휴 3일: **일요일과 겹칠 때만** 대체한다(토요일은 대체하지 않는다).
 *  - 삼일절·어린이날·부처님오신날·광복절·개천절·한글날·성탄절: **토요일·일요일 모두** 대체한다.
 * ⛔ "이미 공휴일 목록에 있으니 겹쳤다"로 판정하지 않는다 — 모든 공휴일이 그 목록에 있어 전부 대체 대상이 된다
 *   (설 연휴 하나에 대체가 세 개 생긴다). 겹침 판정은 **요일**과 **다른 날 이름의 공휴일**로만 한다.
 */
const LUNAR_BLOCK = new Set(['설날', '설날 연휴', '추석', '추석 연휴']);
const WEEKEND_SUBSTITUTE = new Set(['삼일절', '어린이날', '부처님오신날', '제헌절', '광복절', '개천절', '한글날', '성탄절']);

// ── 날짜 도우미 (전부 문자열 축) ──────────────────────────────────────
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0=일 … 6=토. UTC 자정 기준이라 타임존 영향이 없다. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

const isWeekend = (date: string) => dayOfWeek(date) === 0 || dayOfWeek(date) === 6;

// ── 표 조회 ──────────────────────────────────────────────────────────
/** 그 해 표가 준비됐는가 — 음력 3종이 등재된 해만 true. */
export function isYearReady(year: number): boolean {
  return !!LUNAR_HOLIDAYS[year];
}

/**
 * 그 해 공휴일 전체(대체공휴일 포함). 표가 없으면 **빈 배열이 아니라 준비 안 됨**이다 —
 * 호출부는 `isYearReady`로 구분해 화면에 사유를 말한다.
 */
export function getKrHolidays(year: number): KrHoliday[] {
  const lunar = LUNAR_HOLIDAYS[year];
  if (!lunar) return [];

  const base: KrHoliday[] = FIXED_HOLIDAYS.map((h) => ({ date: `${year}-${h.md}`, name: h.name }));
  base.push({ date: lunar.buddha, name: '부처님오신날' });
  // 설·추석은 당일 앞뒤 하루가 함께 공휴일이다(법정 3일).
  base.push({ date: shiftDate(lunar.seolnal, -1), name: '설날 연휴' });
  base.push({ date: lunar.seolnal, name: '설날' });
  base.push({ date: shiftDate(lunar.seolnal, 1), name: '설날 연휴' });
  base.push({ date: shiftDate(lunar.chuseok, -1), name: '추석 연휴' });
  base.push({ date: lunar.chuseok, name: '추석' });
  base.push({ date: shiftDate(lunar.chuseok, 1), name: '추석 연휴' });
  for (const e of EXTRA_HOLIDAYS[year] || []) base.push({ date: e.date, name: e.name });

  // 대체공휴일 — 겹친 날 수만큼, 그 날 뒤의 첫 번째 '주말도 공휴일도 아닌 날'로 하나씩 민다.
  const taken = new Set(base.map((h) => h.date));
  // 같은 날에 이름이 다른 공휴일이 둘 이상이면 그것도 겹침이다(어린이날과 부처님오신날이 겹치는 해).
  const namesByDate = new Map<string, Set<string>>();
  for (const h of base) {
    const s = namesByDate.get(h.date) || new Set<string>();
    s.add(h.name);
    namesByDate.set(h.date, s);
  }
  const counted = new Set<string>();
  const subs: KrHoliday[] = [];
  for (const h of base) {
    const dow = dayOfWeek(h.date);
    const overlapsOther = (namesByDate.get(h.date)?.size || 1) > 1;
    const clashes = LUNAR_BLOCK.has(h.name)
      ? dow === 0 || overlapsOther                     // 설·추석 연휴 = 일요일만(토요일 제외)
      : WEEKEND_SUBSTITUTE.has(h.name)
        ? dow === 0 || dow === 6 || overlapsOther      // 그 밖 대상 = 토·일 모두
        : false;                                       // 신정·현충일 = 대상 아님
    if (!clashes) continue;
    // 같은 날짜를 두 번 세지 않는다(한 날에 두 이름이 겹치면 대체는 하나다).
    if (counted.has(h.date)) continue;
    counted.add(h.date);
    let cand = shiftDate(h.date, 1);
    while (isWeekend(cand) || taken.has(cand)) cand = shiftDate(cand, 1);
    taken.add(cand);
    subs.push({ date: cand, name: '대체공휴일', substitute: true });
  }
  return [...base, ...subs].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 그 달('YYYY-MM')의 공휴일. 화면 격자에 그대로 얹는다.
 * `ready=false`면 목록은 비어 있고 화면은 그 사실을 말한다(빈 달력으로 속이지 않는다).
 */
export function getMonthHolidays(month: string): { ready: boolean; holidays: KrHoliday[] } {
  const year = Number(String(month).slice(0, 4));
  if (!Number.isFinite(year) || !isYearReady(year)) return { ready: false, holidays: [] };
  return { ready: true, holidays: getKrHolidays(year).filter((h) => h.date.startsWith(month)) };
}

/** 등재된 연도 목록 — 갱신 시점 판단·점검용. */
export function readyYears(): number[] {
  return Object.keys(LUNAR_HOLIDAYS).map(Number).sort((a, b) => a - b);
}
