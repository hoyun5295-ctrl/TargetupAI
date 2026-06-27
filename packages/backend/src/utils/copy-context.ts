/**
 * copy-context.ts — 문안 두뇌 ② 시의성 컨텍스트 (순수 함수, 외부 의존 0)
 *
 * 생성 시점의 "언제·어떤 맥락에서 나가는지"를 한국어로 정리해 프롬프트에 주입한다.
 * 전부 달력 사실(코드 테이블)만 — 추정·임의 상수 0.
 * 음력 공휴일/명절은 연도별 양력 날짜가 달라지므로 확정된 연도(2026)만 표기.
 *   미확정 연도는 양력 공휴일만 인식한다(추측 날짜 금지).
 * 날씨(weather)는 발송 직전 주입용 슬롯 — 본 모듈은 타입만 정의(데이터 어댑터는 후속 Phase).
 */

export type SeasonKey = 'spring' | 'summer' | 'autumn' | 'winter';
export type DayPart = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

export interface TemporalContext {
  date: string;            // YYYY-MM-DD (KST)
  weekday: string;         // '월'..'일'
  isWeekend: boolean;
  dayPart: DayPart;
  season: SeasonKey;
  holiday: string | null;     // 공휴일 (양력 고정 + 확정 연도 음력)
  anniversary: string | null; // 공휴일 아닌 기념일 (발렌타인·화이트데이 등)
  solarTerm: string | null;   // 24절기 근사 (당일 매칭)
}

export interface IndustryEvent {
  key: string;
  label: string;
  window: string; // 'MM-DD~MM-DD'
}

export interface CopyContext {
  temporal: TemporalContext;
  industryEvents: IndustryEvent[];
  customer?: { avgCycleDays?: number; topGrade?: string; recentToneHint?: string };
  weather?: { region?: string; summary?: string; tempC?: number };
}

// ════════════════════════════════════════════════════════════════════
// 코드 테이블 (달력 사실)
// ════════════════════════════════════════════════════════════════════

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const SEASON_KR: Record<SeasonKey, string> = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
const DAYPART_KR: Record<DayPart, string> = { morning: '오전', noon: '정오', afternoon: '오후', evening: '저녁', night: '밤' };

// 양력 고정 공휴일 (MM-DD)
const SOLAR_HOLIDAYS: Record<string, string> = {
  '01-01': '신정', '03-01': '삼일절', '05-05': '어린이날', '06-06': '현충일',
  '08-15': '광복절', '10-03': '개천절', '10-09': '한글날', '12-25': '성탄절',
};

// 음력 공휴일 — 연도별 양력 날짜 (확정 연도만, 추측 금지). YYYY-MM-DD.
// 2027+ 설/추석/부처님오신날은 확정 후 여기 추가한다.
const LUNAR_HOLIDAYS: Record<string, string> = {
  '2026-02-16': '설날', '2026-02-17': '설날', '2026-02-18': '설날',
  '2026-05-24': '부처님오신날',
  '2026-09-24': '추석', '2026-09-25': '추석', '2026-09-26': '추석',
};

// 기념일 (공휴일 아님, MM-DD)
const ANNIVERSARIES: Record<string, string> = {
  '02-14': '발렌타인데이', '03-14': '화이트데이', '05-08': '어버이날',
  '05-15': '스승의날', '10-31': '핼러윈', '11-11': '빼빼로데이',
  '12-24': '크리스마스 이브', '12-31': '연말',
};

// 24절기 근사 (MM-DD, 매년 ±1일 변동 — 당일 근사 매칭)
const SOLAR_TERMS: Record<string, string> = {
  '01-06': '소한', '01-20': '대한', '02-04': '입춘', '02-19': '우수',
  '03-06': '경칩', '03-21': '춘분', '04-05': '청명', '04-20': '곡우',
  '05-06': '입하', '05-21': '소만', '06-06': '망종', '06-21': '하지',
  '07-07': '소서', '07-23': '대서', '08-08': '입추', '08-23': '처서',
  '09-08': '백로', '09-23': '추분', '10-08': '한로', '10-23': '상강',
  '11-07': '입동', '11-22': '소설', '12-07': '대설', '12-22': '동지',
};

interface EventDef { key: string; label: string; industries: string[] | 'all'; start: string; end: string; }

// 업종 시즌 이벤트 — window는 'MM-DD' (같은 달/연 내 범위만; 연을 넘는 범위는 분리해 정의)
// 음력 명절 window는 2026 기준 근사. 'all'은 전 업종 공통.
const EVENTS: EventDef[] = [
  { key: 'new_year', label: '새해', industries: 'all', start: '01-01', end: '01-10' },
  { key: 'lunar_new_year', label: '설 명절', industries: 'all', start: '02-10', end: '02-18' },
  { key: 'valentine', label: '발렌타인 시즌', industries: ['fashion', 'beauty', 'food'], start: '02-07', end: '02-14' },
  { key: 'new_semester', label: '새 학기', industries: ['edu', 'stationery', 'fashion'], start: '02-25', end: '03-10' },
  { key: 'white_day', label: '화이트데이 시즌', industries: ['fashion', 'beauty', 'food'], start: '03-07', end: '03-14' },
  { key: 'family_month', label: '가정의 달', industries: 'all', start: '05-01', end: '05-15' },
  { key: 'summer_vacation', label: '여름 휴가철', industries: 'all', start: '07-15', end: '08-15' },
  { key: 'chuseok', label: '추석 명절', industries: 'all', start: '09-18', end: '09-26' },
  { key: 'halloween', label: '핼러윈', industries: ['fashion', 'beauty', 'food'], start: '10-25', end: '10-31' },
  { key: 'black_friday', label: '블랙프라이데이', industries: 'all', start: '11-20', end: '11-30' },
  { key: 'year_end', label: '연말 시즌', industries: 'all', start: '12-15', end: '12-31' },
];

// ════════════════════════════════════════════════════════════════════
// 내부 헬퍼
// ════════════════════════════════════════════════════════════════════

function pad(n: number): string { return String(n).padStart(2, '0'); }

function kstParts(now: Date): { y: number; m: number; d: number; hour: number; wd: number } {
  const k = new Date(now.getTime() + 9 * 3600 * 1000); // UTC+9 (KST, DST 없음)
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate(), hour: k.getUTCHours(), wd: k.getUTCDay() };
}

function seasonOf(month: number): SeasonKey {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function dayPartOf(hour: number): DayPart {
  if (hour >= 5 && hour <= 10) return 'morning';
  if (hour >= 11 && hour <= 13) return 'noon';
  if (hour >= 14 && hour <= 17) return 'afternoon';
  if (hour >= 18 && hour <= 21) return 'evening';
  return 'night';
}

// ════════════════════════════════════════════════════════════════════
// 공개 API
// ════════════════════════════════════════════════════════════════════

export function buildTemporalContext(now: Date): TemporalContext {
  const { y, m, d, hour, wd } = kstParts(now);
  const mmdd = `${pad(m)}-${pad(d)}`;
  const ymd = `${y}-${pad(m)}-${pad(d)}`;
  return {
    date: ymd,
    weekday: WEEKDAYS[wd],
    isWeekend: wd === 0 || wd === 6,
    dayPart: dayPartOf(hour),
    season: seasonOf(m),
    holiday: LUNAR_HOLIDAYS[ymd] || SOLAR_HOLIDAYS[mmdd] || null,
    anniversary: ANNIVERSARIES[mmdd] || null,
    solarTerm: SOLAR_TERMS[mmdd] || null,
  };
}

export function buildIndustryEvents(industryCode: string | null, now: Date): IndustryEvent[] {
  const { m, d } = kstParts(now);
  const mmdd = `${pad(m)}-${pad(d)}`;
  return EVENTS
    .filter((e) => e.industries === 'all' || (!!industryCode && e.industries.includes(industryCode)))
    .filter((e) => mmdd >= e.start && mmdd <= e.end)
    .map((e) => ({ key: e.key, label: e.label, window: `${e.start}~${e.end}` }));
}

export function renderContextForPrompt(ctx: CopyContext): string {
  const t = ctx.temporal;
  const parts: string[] = [];
  parts.push(`현재 ${t.date} ${t.weekday}요일 ${DAYPART_KR[t.dayPart]}, ${SEASON_KR[t.season]}철입니다.`);
  if (t.holiday) parts.push(`오늘은 ${t.holiday}입니다.`);
  else if (t.anniversary) parts.push(`오늘은 ${t.anniversary}입니다.`);
  if (t.solarTerm) parts.push(`절기상 ${t.solarTerm} 무렵입니다.`);
  if (ctx.industryEvents.length > 0) {
    parts.push(`진행 중 시즌: ${ctx.industryEvents.map((e) => e.label).join(', ')}.`);
  }
  if (ctx.customer) {
    const c = ctx.customer;
    const bits: string[] = [];
    if (c.topGrade) bits.push(`주요 등급 ${c.topGrade}`);
    if (typeof c.avgCycleDays === 'number') bits.push(`평균 재구매 주기 약 ${c.avgCycleDays}일`);
    if (c.recentToneHint) bits.push(`최근 반응 톤 ${c.recentToneHint}`);
    if (bits.length > 0) parts.push(`고객 맥락 — ${bits.join(' / ')}.`);
  }
  if (ctx.weather && ctx.weather.summary) {
    const w = ctx.weather;
    parts.push(`현재 날씨${w.region ? `(${w.region})` : ''} — ${w.summary}${typeof w.tempC === 'number' ? ` ${w.tempC}도` : ''}.`);
  }
  return parts.join(' ');
}
