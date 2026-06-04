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
