/**
 * campaign-validation.ts — 캠페인 예약 시각 검증 컨트롤타워 (CT-D111-P4)
 *
 * 배경: 캠페인 생성/수정 경로 여러 곳에서 scheduled_at 과거 차단 검증이 누락되어 있음.
 *   - POST / (AI 캠페인 생성)            — 검증 없음
 *   - POST /direct-send (직접발송)        — 검증 없음
 *   - PUT /:id/reschedule (예약 재설정)   — 인라인 15분 체크만 있음
 *   결과: 프론트 실수/시계 오차/의도적 우회로 과거 시각이 들어가면 그대로 INSERT →
 *        orphan draft 누적, 예약대기 목록 오염 (PDF 0408 E3 실사례).
 *
 * 원칙 (Harold님 지시):
 *   - 검증 로직은 이 컨트롤타워 하나에서만 관리
 *   - 인라인 `new Date() vs scheduledAt` 체크 금지
 *   - 호출부는 이 함수 결과의 valid/error만 보고 분기
 *
 * ⚠️ 호출부 추가 시 반드시 이 함수 import. 인라인 검증 작성 금지.
 */

export interface ValidateScheduledAtOptions {
  /** 현재 시각 기준 최소 몇 분 이후여야 하는지. 0이면 "현재 이후"만 체크 (즉시발송 호출부는 0 유지). */
  minMinutesFromNow?: number;
  /** null/undefined/빈 문자열 허용 여부. 즉시발송은 true, 예약 재설정은 false. */
  allowNull?: boolean;
  /** 너무 먼 미래 차단 (기본 365일). 오타 방지. */
  maxDaysFromNow?: number;
}

export interface ValidateScheduledAtResult {
  valid: boolean;
  error?: string;
  /** 검증 통과 시 정규화된 Date 객체. allowNull + 입력 null이면 null. */
  normalizedDate?: Date | null;
}

/**
 * 캠페인 예약 시각을 검증한다.
 *
 * - 파싱 실패: invalid
 * - 과거 시각 (minMinutesFromNow 기준): invalid
 * - 너무 먼 미래 (maxDaysFromNow 초과): invalid
 * - null/undefined/빈값: allowNull에 따라
 */
export function validateScheduledAt(
  input: any,
  options: ValidateScheduledAtOptions = {}
): ValidateScheduledAtResult {
  const {
    minMinutesFromNow = 0,
    allowNull = true,
    maxDaysFromNow = 365,
  } = options;

  // null/undefined/빈 문자열 처리
  if (input === null || input === undefined || input === '') {
    if (allowNull) {
      return { valid: true, normalizedDate: null };
    }
    return { valid: false, error: '예약 시각이 필요합니다.' };
  }

  // 파싱
  const parsed = new Date(input);
  if (isNaN(parsed.getTime())) {
    return { valid: false, error: '예약 시각 형식이 올바르지 않습니다.' };
  }

  const now = Date.now();
  const diffMinutes = (parsed.getTime() - now) / 60000;

  // 과거 (minMinutesFromNow 유예)
  if (diffMinutes < minMinutesFromNow) {
    if (minMinutesFromNow <= 0) {
      return {
        valid: false,
        error: '과거 시각으로 예약할 수 없습니다. 현재 이후 시각을 선택해주세요.',
      };
    }
    return {
      valid: false,
      error: `현재 시각 + ${minMinutesFromNow}분 이후로만 예약할 수 있습니다.`,
    };
  }

  // 너무 먼 미래 (오타 방지)
  const diffDays = diffMinutes / (60 * 24);
  if (diffDays > maxDaysFromNow) {
    return {
      valid: false,
      error: `예약 시각은 최대 ${maxDaysFromNow}일 이내여야 합니다.`,
    };
  }

  return { valid: true, normalizedDate: parsed };
}
