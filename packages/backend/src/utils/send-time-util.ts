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

export function calcSplitSendTime(
  baseTime: Date,
  batchIndex: number,
  sendStartHour: number = SEND_HOURS.start,
  sendEndHour: number = SEND_HOURS.end
): Date {
  const result = new Date(baseTime.getTime());
  result.setMinutes(result.getMinutes() + batchIndex);

  // 한국시간 기준 시각 확인 (KST = UTC+9)
  const kstHour = parseInt(
    result.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false })
  );

  if (kstHour >= sendEndHour) {
    // 종료 시각 초과 → 다음날 시작 시각으로 이월
    const kstMinutes = parseInt(
      result.toLocaleString('en-US', { timeZone: 'Asia/Seoul', minute: '2-digit' })
    );
    const overflowMinutes = (kstHour - sendEndHour) * 60 + kstMinutes;
    result.setDate(result.getDate() + 1);
    result.setHours(result.getHours() - kstHour + sendStartHour);
    result.setMinutes(overflowMinutes);
  }

  return result;
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
    return { hour: null, sample, reason: `insufficient_data — 클릭 표본 ${sample}건 < 최소 ${minSample}건, 발송 시각 개인화 보류(현행 일정 유지)` };
  }
  if (bestHour === null || bestCount <= 0) {
    return { hour: null, sample, reason: `insufficient_data — 발송 가능 시간대(${sendStartHour}~${sendEndHour}시) 내 클릭 없음, 현행 일정 유지` };
  }
  return { hour: bestHour, sample, reason: `클릭 피크 ${bestHour}시 KST (표본 ${sample}건) — 발송 시각 개인화` };
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
