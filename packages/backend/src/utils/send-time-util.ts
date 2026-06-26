/**
 * ★ 분할발송 시각 계산 — campaigns.ts에서 이동 (2026-05-30 대량 발송 worker 공용)
 *
 * 분당 batchIndex 분 증가 + 발송 가능 시간대(SEND_HOURS) 초과 시 다음날 시작 시각으로 이월.
 * direct-send-worker.ts(청크별 globalIndex)와 campaigns.ts가 공유.
 */
import { SEND_HOURS } from '../config/defaults';

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
