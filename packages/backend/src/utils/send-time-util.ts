/**
 * ★ 분할발송 시각 계산 — campaigns.ts에서 이동 (2026-05-30 대량 발송 worker 공용)
 *
 * 분당 batchIndex 분 증가 + 발송 가능 시간대(SEND_HOURS) 초과 시 다음날 시작 시각으로 이월.
 * direct-send-worker.ts(청크별 globalIndex)와 campaigns.ts가 공유.
 */
import { SEND_HOURS, BRAND_SEND_WINDOW } from '../config/defaults';

/**
 * 브랜드메시지 발송 가능 시간(KST 08:00~20:50) 안인지 판정 — 매뉴얼 v2.3.1 §3.9.1.
 *
 * 문자 축(shiftToSendableHour)과 달리 **이월하지 않고 가부만 답한다.**
 * 브랜드는 사용자가 고른 발송 시각이 곧 계약이라, 조용히 옮기면 "언제 나갔는지 모르는 광고"가 된다.
 * 호출부가 거절 사유를 사용자 언어로 안내하고 시각을 다시 받는다.
 */
export function isWithinBrandSendWindow(at: Date, marginMinutes = 0): boolean {
  if (Number.isNaN(at.getTime())) return false;
  // ⛔ 여유를 **시각에 더하면 안 된다** — 07:58이 08:00으로 앞당겨져 오전 금지 창이 그만큼 열린다
  //   (0818 5R 실측). 여유는 마감을 앞당기는 것이지 시각을 미루는 것이 아니다.
  const margin = Number.isFinite(marginMinutes) && marginMinutes > 0 ? Math.floor(marginMinutes) : 0;
  const kst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  const minuteOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  // 종료는 **exclusive**다 — 매뉴얼 §3.9.1이 "20:50 ~ 08:00 심야 발송 불가"라고 20:50을 금지 구간의
  // 시작으로 적는다. `<=`로 두면 20:50:00~20:50:59가 통과해 공급자 3022 폐기 + 차감 잔존이 된다.
  return minuteOfDay >= BRAND_SEND_WINDOW.startMinuteOfDay
    && minuteOfDay < BRAND_SEND_WINDOW.endMinuteOfDay - margin;
}

/**
 * 분할발송 회차 시각 = 기준 시각에서 **발송 가능 시간(KST sendStartHour~sendEndHour) 안에서만** batchIndex분을 흘린다.
 * 창 끝에 닿으면 다음 날 시작 시각부터 이어서 센다(여러 날에 걸쳐도 단조 증가 · 겹침 없음).
 *
 * ★ 2026-09-26 한줄로 전수점검 부분 ① F43·F44: 옛 식은 `기준 + batchIndex분`의 KST 시가 종료 시각 이상일 때만
 *   다음 날로 넘겼다. 자정을 넘긴 회차 중 01~07시에 떨어진 것은 그대로 큐에 들어가 **광고 문자가 새벽에 나갔다**
 *   (00시대는 toLocaleString이 자정을 "24"로 주는 우연 덕에 넘어갔다). 서버 로컬 시간대(setHours)에도 기대고 있었다.
 *   - 창 안에서 끝나는 회차와 21시 전 기준에서 넘어가는 회차는 옛 결과와 같다(20:00+60 → 익일 08:00, +90 → 08:30).
 *   - 기준 시각이 창 밖이면 첫 회차가 다음 창 시작으로 간다(옛: 22시 기준 → 익일 09시 · 새벽 기준 → 그대로).
 *   초 단위는 보존한다(20:59:30 + 1 → 익일 08:00:30).
 */
export function calcSplitSendTime(
  baseTime: Date,
  batchIndex: number,
  sendStartHour: number = SEND_HOURS.start,
  sendEndHour: number = SEND_HOURS.end
): Date {
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const KST = 9 * 60 * MIN;
  const startMs = sendStartHour * 60 * MIN;
  const endMs = sendEndHour * 60 * MIN;
  // KST 하루 안의 경과(ms)
  const msOfDay = (t: number) => (((t + KST) % DAY) + DAY) % DAY;

  let cur = baseTime.getTime();
  let remaining = Math.max(0, Number(batchIndex) || 0) * MIN;
  // 창 길이가 0 이하이면(설정 오류) 옛 동작처럼 단순 가산만 한다 — 무한 루프 방지.
  if (!(endMs > startMs)) return new Date(cur + remaining);

  for (;;) {
    const d = msOfDay(cur);
    if (d < startMs) cur += startMs - d;            // 새벽 → 당일 시작
    else if (d >= endMs) cur += DAY - d + startMs;  // 종료 이후 → 익일 시작
    const avail = endMs - msOfDay(cur);             // 오늘 창에 남은 시간
    if (remaining < avail) return new Date(cur + remaining);
    remaining -= avail;
    cur += avail;                                   // 창 끝(종료 시각) → 다음 반복에서 익일 시작으로
  }
}

// ─────────────── ★ 2026-09-28 분할 전송 CT (Harold 지시 · 건수 + 간격) ───────────────
// 입구(동기 /direct-send · 대량 commit·자율 공용 createDirectSendCampaign · 워커 · 화면 미리보기)가 전부 이 한 벌을 쓴다.
// 전에는 `Math.floor(i / splitCount)`분 계산이 6곳에 인라인이었고, 서버는 건수를 검사하지 않았으며, 끝나는 날 한도가 없었다.

export const SPLIT_LIMITS = {
  countMin: 1,
  countMax: 9999,
  intervalMin: 1,
  intervalMax: 60,
  /**
   * 마지막 회차 ≤ 시작 + 11일. 근거 = 선불 실패 자동 환불(`mysql-refund-sweeper`)이 발송 기준 **14일** 안의 캠페인만 보고,
   * 문자 결과는 최장 **48시간** 뒤에 확정된다(`expired-pending-sweeper` EXPIRE_HOURS · 1분 주기). 거기에 **1일 여유** —
   * 48시간 지난 캠페인은 환불 집계가 **60분에 1회**이고(환불 워커 차등 주기), 대량 적재는 워커가 청크를 도는 동안 기준 시각이 늦어진다.
   * 14 − 2 − 1 = 11. 넘기면 마지막 회차의 실패분이 환불 창 밖으로 나간다(★Codex 0928 1R high — 첫 설계 12일은 여유가 0이었다).
   */
  maxSpanDays: 11,
} as const;

export interface SplitSetting {
  /** 한 묶음(회차)에 보내는 건수 */
  count: number;
  /** 묶음 사이 간격(분) */
  intervalMinutes: number;
}

export type SplitParse =
  | { ok: true; split: SplitSetting | null }
  | { ok: false; code: 'SPLIT_INVALID'; error: string };

const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

/**
 * 요청의 분할 값 검사. 꺼져 있으면 분할 없음(null).
 * 켜져 있으면 건수 1~9,999 정수 · 간격 1~60분 정수. **간격을 안 보낸 옛 화면·옛 요청 = 1분**(지금까지와 같다).
 * 범위 밖은 거절한다 — 옛 코드는 건수가 0이면 조용히 한 번에 보냈다(사용자는 나눠 보낸다고 알았다).
 */
export function parseSplitSetting(enabled: unknown, count: unknown, intervalMinutes: unknown): SplitParse {
  if (!enabled) return { ok: true, split: null };
  const c = toInt(count);
  if (c === null || Number.isNaN(c) || c < SPLIT_LIMITS.countMin || c > SPLIT_LIMITS.countMax) {
    return { ok: false, code: 'SPLIT_INVALID', error: '분할 건수는 1~9,999건 사이로 정해 주세요.' };
  }
  const g = toInt(intervalMinutes);
  if (g === null) return { ok: true, split: { count: c, intervalMinutes: 1 } };
  if (Number.isNaN(g) || g < SPLIT_LIMITS.intervalMin || g > SPLIT_LIMITS.intervalMax) {
    return { ok: false, code: 'SPLIT_INVALID', error: '분할 간격은 1~60분 사이로 정해 주세요.' };
  }
  return { ok: true, split: { count: c, intervalMinutes: g } };
}

/**
 * 저장된 캠페인 설정(send_config)의 분할 — 워커용. **너그럽게** 읽는다: 이 CT 전에 저장된 예약 캠페인이 그대로 나가야 한다.
 * 옛 판정(`splitEnabled && splitCount > 0`)과 같고, 간격이 없거나 이상하면 1분.
 */
export function readStoredSplit(cfg: any): SplitSetting | null {
  if (!cfg || !cfg.splitEnabled) return null;
  const count = Number(cfg.splitCount);
  if (!(count > 0)) return null;
  const g = Number(cfg.splitIntervalMinutes);
  const intervalMinutes = Number.isInteger(g) && g >= SPLIT_LIMITS.intervalMin && g <= SPLIT_LIMITS.intervalMax ? g : 1;
  return { count, intervalMinutes };
}

/** i번째 수신자(0부터)의 발송 시각 = (묶음 번호 × 간격)분을 발송 가능 시간 안에서 흘린다(calcSplitSendTime) */
export function splitSendTime(base: Date, index: number, split: SplitSetting): Date {
  return calcSplitSendTime(base, Math.floor(index / split.count) * split.intervalMinutes);
}

export interface SplitPlan {
  rounds: number;
  lastCount: number;
  lastAt: Date;
  /** 화면 시각표 — 회차가 5번 이하면 전부, 넘으면 앞 3번 + 마지막 */
  slots: { index: number; at: Date; count: number }[];
  /** 마지막 회차가 시작부터 SPLIT_LIMITS.maxSpanDays 안인가 */
  withinLimit: boolean;
}

/** 분할 계획 — 화면 미리보기와 서버 한도 검사가 같은 값을 본다 */
export function planSplitSchedule(base: Date, total: number, split: SplitSetting): SplitPlan {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const rounds = n > 0 ? Math.ceil(n / split.count) : 0;
  const at = (r: number) => calcSplitSendTime(base, r * split.intervalMinutes);
  const countOf = (r: number) => (r === rounds - 1 ? n - split.count * (rounds - 1) : split.count);
  const picks = rounds <= 5 ? Array.from({ length: rounds }, (_, i) => i) : [0, 1, 2, rounds - 1];
  const lastAt = rounds > 0 ? at(rounds - 1) : new Date(base.getTime());
  return {
    rounds,
    lastCount: rounds > 0 ? countOf(rounds - 1) : 0,
    lastAt,
    slots: picks.map((r) => ({ index: r, at: at(r), count: countOf(r) })),
    withinLimit: lastAt.getTime() - base.getTime() <= SPLIT_LIMITS.maxSpanDays * 24 * 60 * 60 * 1000,
  };
}

/** 끝나는 날 한도 밖이면 사용자에게 줄 문장, 안이면 null */
export function splitSpanError(base: Date, total: number, split: SplitSetting): string | null {
  if (planSplitSchedule(base, total, split).withinLimit) return null;
  return `분할이 시작부터 ${SPLIT_LIMITS.maxSpanDays}일을 넘겨 끝나요. 한 번에 보낼 건수를 늘리거나 간격을 줄여 주세요.`;
}

/**
 * 발송 가능 시간(SEND_HOURS) 밖이면 다음 발송 가능 시각(startHour)으로 이동.
 * - 새벽(0 ~ startHour 미만) → 당일 startHour
 * - endHour 이후(21시~) → 익일 startHour
 * - startHour ~ endHour-1 = 그대로 (발송 가능)
 *
 * 여정 트리거(가입 등)가 야간에 발생해도 광고 SMS가 새벽/심야에 나가지 않게 막는다.
 * calcSplitSendTime은 endHour 초과만 처리(새벽 미처리)하므로 여정 진입/다음 step용으로 분리.
 * KST(UTC+9) 기준 — journey-executor calculateNextRunAt와 동일 패턴.
 */
export function shiftToSendableHour(
  date: Date,
  startHour: number = SEND_HOURS.start,
  endHour: number = SEND_HOURS.end,
): Date {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const kstHour = kst.getUTCHours();
  if (kstHour >= startHour && kstHour < endHour) return date; // 발송 가능 시간 — 그대로
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const ARRIVE_HOUR = 9; // ★ 야간(발송 불가 시간) 트리거는 일괄 아침 9시로 발송 (Harold 명시) — 시각 미지정 시 default
  const addDay = kstHour >= endHour ? 1 : 0; // endHour 이후 = 익일 / 새벽 = 당일
  return new Date(Date.UTC(y, m, d + addDay, ARRIVE_HOUR - 9, 0, 0)); // KST 09시 = UTC 00시
}

/**
 * 여정 step 발송 시각 계산 — delay_mode 4종 + 야간가드.
 *   - 'relative'          = now + delay_hours (default)
 *   - 'relative_at_hour'  = (now + delay_hours)가 속한 날의 target_hour_kst 시 KST ("N일 후 그 날 HH시")
 *   - 'specific_hour'     = 오늘/내일 target_hour_kst 시 KST (오늘 시각이 지났으면 내일)
 *   - 'next_business_day' = 다음 평일(월~금) 09시 KST (공휴일 미반영)
 * 전부 shiftToSendableHour로 야간(발송 불가 시간)을 09시 KST로 밀어 광고 새벽 발송을 막는다.
 * now는 테스트 주입용 — 미지정 시 현재 시각. KST(UTC+9) 기준.
 */
export function calculateNextRunAt(
  delayMode: string,
  delayHours: number,
  targetHourKst: number | null,
  now: Date = new Date(),
): Date {
  // 'relative' (default)
  if (delayMode === 'relative' || !delayMode) {
    return shiftToSendableHour(new Date(now.getTime() + delayHours * 60 * 60 * 1000));
  }

  // 'specific_hour' = 오늘/내일 target_hour_kst 시 KST
  if (delayMode === 'specific_hour' && targetHourKst !== null) {
    const targetHour = Math.max(0, Math.min(23, targetHourKst));
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const kstYear = kstNow.getUTCFullYear();
    const kstMonth = kstNow.getUTCMonth();
    const kstDate = kstNow.getUTCDate();
    const kstHour = kstNow.getUTCHours();
    const daysToAdd = kstHour >= targetHour ? 1 : 0; // 오늘 시각이 지났으면 내일
    const utcTargetMs = Date.UTC(kstYear, kstMonth, kstDate + daysToAdd, targetHour - 9, 0, 0);
    return shiftToSendableHour(new Date(utcTargetMs));
  }

  // 'next_business_day' = 다음 평일(월~금) 09시 KST
  if (delayMode === 'next_business_day') {
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const kstYear = kstNow.getUTCFullYear();
    const kstMonth = kstNow.getUTCMonth();
    const kstDate = kstNow.getUTCDate();
    const kstHour = kstNow.getUTCHours();
    const kstDayOfWeek = kstNow.getUTCDay(); // 0=일 ~ 6=토
    let daysToAdd: number;
    if (kstDayOfWeek === 0) daysToAdd = 1; // 일 → 월
    else if (kstDayOfWeek === 6) daysToAdd = 2; // 토 → 월
    else if (kstDayOfWeek === 5 && kstHour >= 9) daysToAdd = 3; // 금 09시 이후 → 월
    else if (kstHour >= 9) daysToAdd = 1; // 평일 09시 이후 → 내일
    else daysToAdd = 0; // 평일 09시 이전 → 오늘
    const utcTargetMs = Date.UTC(kstYear, kstMonth, kstDate + daysToAdd, 0, 0, 0); // KST 09시 = UTC 00시
    return shiftToSendableHour(new Date(utcTargetMs));
  }

  // 'relative_at_hour' = (now + delayHours)가 속한 KST 날짜의 targetHourKst시. 그 시각이 과거면 +1일.
  //   "N일 후 그 날 HH시" 표현용(N = delayHours/24). targetHourKst null이면 relative로 폴백.
  if (delayMode === 'relative_at_hour' && targetHourKst !== null) {
    const targetHour = Math.max(0, Math.min(23, targetHourKst));
    const landed = new Date(now.getTime() + delayHours * 60 * 60 * 1000);
    const kstLanded = new Date(landed.getTime() + 9 * 60 * 60 * 1000);
    const y = kstLanded.getUTCFullYear();
    const m = kstLanded.getUTCMonth();
    const d = kstLanded.getUTCDate();
    let utcTargetMs = Date.UTC(y, m, d, targetHour - 9, 0, 0); // KST targetHour = UTC(targetHour-9)
    if (utcTargetMs < now.getTime()) utcTargetMs = Date.UTC(y, m, d + 1, targetHour - 9, 0, 0);
    return shiftToSendableHour(new Date(utcTargetMs));
  }

  // fallback = relative (미지원 mode)
  return shiftToSendableHour(new Date(now.getTime() + delayHours * 60 * 60 * 1000));
}

/**
 * ★ Phase3 B (2026-06-26): 자동마케팅 자율 발송 시각 개인화 — 회사 고객의 실제 클릭 반응 시간대.
 *   데이터 출처 = cdp_events 'message_click' occurred_at의 KST 시(hour) 히스토그램(실데이터, 임의 상수 0).
 *   발송 가능 시간대 [start,end) 안에서 클릭이 가장 많은 시각을 고른다.
 *   표본이 minSample 미만이거나 시간대 내 클릭이 없으면 hour=null(insufficient_data) → 호출부가 현행 일정 유지.
 *   minSample = 통계 신뢰 최소 표본(데이터 충분성 가드) — 사업 지표 아님. 호출부가 명시 주입.
 */
export interface HourCount { hour: number; count: number; }
export interface BestSendHour { hour: number | null; sample: number; reason: string; }

export function pickBestSendHour(
  hourCounts: HourCount[],
  minSample: number,
  sendStartHour: number = SEND_HOURS.start,
  sendEndHour: number = SEND_HOURS.end,
): BestSendHour {
  let sample = 0;
  let bestHour: number | null = null;
  let bestCount = -1;
  for (const hc of hourCounts || []) {
    const c = Math.max(0, Math.floor(Number(hc?.count)) || 0);
    sample += c;
    const h = Math.floor(Number(hc?.hour));
    if (!(h >= sendStartHour && h < sendEndHour)) continue; // 발송 가능 시간대 밖 클릭은 발송 시각 후보에서 제외
    if (c > bestCount) { bestCount = c; bestHour = h; }
  }
  if (sample < minSample) {
    return { hour: null, sample, reason: `insufficient_data: 클릭 표본 ${sample}건 < 최소 ${minSample}건, 발송 시각 개인화 보류(현행 일정 유지)` };
  }
  if (bestHour === null || bestCount <= 0) {
    return { hour: null, sample, reason: `insufficient_data: 발송 가능 시간대(${sendStartHour}~${sendEndHour}시) 내 클릭 없음, 현행 일정 유지` };
  }
  return { hour: bestHour, sample, reason: `클릭 피크 ${bestHour}시 KST (표본 ${sample}건): 발송 시각 개인화` };
}

/**
 * ★ Phase3 B: 발송 예정 시각 = max(준비 창 보존, 클릭 피크 시각 정렬).
 *   - earliest = now + leadMinutes (담당자 정지 창 보존 — 이보다 이르게는 안 보냄).
 *   - bestHourKst null(데이터 부족) → earliest 그대로(현행 동작 보존).
 *   - bestHourKst 있으면 earliest 이후 가장 가까운 그 시각(오늘 지났으면 내일) + 발송 가능 시간대 가드. KST(UTC+9).
 */
export function computeOptimalSendAt(
  now: Date,
  leadMinutes: number,
  bestHourKst: number | null,
  sendStartHour: number = SEND_HOURS.start,
  sendEndHour: number = SEND_HOURS.end,
): Date {
  const earliest = new Date(now.getTime() + leadMinutes * 60 * 1000);
  if (bestHourKst === null) return earliest; // 데이터 부족 → 현행 폴백(준비 창만 적용)
  const targetHour = Math.max(0, Math.min(23, Math.floor(bestHourKst)));
  const kstEarliest = new Date(earliest.getTime() + 9 * 60 * 60 * 1000);
  const y = kstEarliest.getUTCFullYear();
  const m = kstEarliest.getUTCMonth();
  const d = kstEarliest.getUTCDate();
  let utcTarget = Date.UTC(y, m, d, targetHour - 9, 0, 0); // KST targetHour = UTC(targetHour-9)
  if (utcTarget < earliest.getTime()) utcTarget = Date.UTC(y, m, d + 1, targetHour - 9, 0, 0);
  return shiftToSendableHour(new Date(utcTarget), sendStartHour, sendEndHour);
}

// ════════════════════════════════════════════════════════════════════
// ★ 날짜축 여정(date_anchor) — 절대 날짜 기준 타이밍·반복 (2026-06-30 여정 일반화).
//   순수(now 주입). anchorDate는 KST 달력 날짜(PG date = 자정)로 해석 — UTC 컴포넌트로 산출.
// ════════════════════════════════════════════════════════════════════

/**
 * 앵커 스텝 발송 시각 = (anchorDate − offsetDays일)의 hourKst시 KST + 야간가드(shiftToSendableHour).
 *   "지정일 D-N HH시" 절대 모드. now는 비교용이 아니라 야간가드 폴백용(스케줄러가 날짜 일치로 발송일을 거른다).
 *   예: anchor=2026-06-30, offset=7, hour=10 → 2026-06-23 10:00 KST.
 */
export function computeAnchorStepRunAt(
  anchorDate: Date,
  offsetDays: number,
  hourKst: number,
): Date {
  const hour = Math.max(0, Math.min(23, Math.floor(Number(hourKst))));
  const safeHour = Number.isFinite(hour) ? hour : 9;
  const off = Math.max(0, Math.floor(Number(offsetDays) || 0));
  const y = anchorDate.getUTCFullYear();
  const m = anchorDate.getUTCMonth();
  const d = anchorDate.getUTCDate();
  // KST safeHour시 = UTC (safeHour-9)시. Date.UTC가 달 경계(day 음수/초과)를 자동 정규화.
  const utcMs = Date.UTC(y, m, d - off, safeHour - 9, 0, 0);
  return shiftToSendableHour(new Date(utcMs));
}

/**
 * 반복 규칙으로 다음 앵커 날짜 산출(현재 앵커 기준).
 *   - 'none'         → null (반복 없음, D-0 후 정지).
 *   - 'monthly_day'  → 다음 달 N일(recurrenceDay; 그 달 말일로 클램프).
 *   - 'monthly_last' → 다음 달 말일.
 *   - 'yearly'       → 내년 같은 월·일.
 *   반환 = UTC 자정 Date(= KST 달력 날짜). 미지원 규칙 → null.
 */
export function computeNextAnchor(
  recurrence: string,
  recurrenceDay: number | null,
  current: Date,
): Date | null {
  const y = current.getUTCFullYear();
  const m = current.getUTCMonth();
  const d = current.getUTCDate();
  if (recurrence === 'monthly_day') {
    const lastDayNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate(); // 다음 달 말일
    const reqDay = Math.floor(Number(recurrenceDay));
    const day = Math.max(1, Math.min(lastDayNext, Number.isFinite(reqDay) ? reqDay : d));
    return new Date(Date.UTC(y, m + 1, day));
  }
  if (recurrence === 'monthly_last') {
    return new Date(Date.UTC(y, m + 2, 0)); // 다음 달 말일 = 다다음 달 0일
  }
  if (recurrence === 'yearly') {
    return new Date(Date.UTC(y + 1, m, d));
  }
  return null;
}

/**
 * 사이클 완료 판정 — 마지막 step(최소 offset = D-0) 발송일이 오늘(KST) 지났는가.
 *   true면 라이프사이클 처리(none=정지 / recurrence=다음 앵커 갱신).
 *   minOffsetDays = 그 여정 step들의 최소 anchor_offset_days(보통 0). anchorDate는 KST 달력 날짜.
 */
export function isAnchorCycleComplete(
  minOffsetDays: number,
  anchorDate: Date,
  now: Date = new Date(),
): boolean {
  const off = Math.max(0, Math.floor(Number(minOffsetDays) || 0));
  const lastSendMidnightUtc = Date.UTC(
    anchorDate.getUTCFullYear(),
    anchorDate.getUTCMonth(),
    anchorDate.getUTCDate() - off,
  );
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayKstMidnightUtc = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());
  return todayKstMidnightUtc > lastSendMidnightUtc;
}

/** ★ 2026-07-11 send-time 개인화 — 고객 선호 시각을 발송 안전 창(09~20시 KST)으로 클램프. 비정상 입력=10시. */
export function clampPersonalSendHour(hour: number): number {
  if (!Number.isFinite(hour)) return 10;
  return Math.min(20, Math.max(9, Math.floor(hour)));
}
