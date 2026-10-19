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

/**
 * ★ 2026-10-19 예약 발송 직전 사람 조작 잠금(Harold 「예약 걸린 건 15분 이내면 취소 불가 · 대행발송 승인 · 취소 · 수정도 같은 로직」).
 *   남은 시간이 0분 초과 15분 미만이면 잠근다. 이미 지난 시각은 잠그지 않는다(지난 건은 경로마다 따로 판정 · 만료 건을 새 시각으로 살리는 길).
 *   소비 = 직접발송 예약 취소(campaign-lifecycle `cancelCampaign` · routes/campaigns.ts 예약 취소) ·
 *          대행발송(agency-send-state 승인 리드타임 · agency-send-actions · 취소 · 문안 수정 · 시각 변경 CT).
 *   화면 미러 = frontend components/agency/agency-send-api.ts `SEND_CHANGE_LOCK_MINUTES`(값 대조 시험).
 */
export const SEND_CHANGE_LOCK_MINUTES = 15;

/** 보낼 시각까지 0분 초과 15분 미만인가(시각 없음 · 잘못된 값 = 잠그지 않는다) */
export function isInSendChangeLock(sendAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (sendAt === null || sendAt === undefined || sendAt === '') return false;
  const t = new Date(sendAt as any).getTime();
  if (Number.isNaN(t)) return false;
  const minutesLeft = (t - now.getTime()) / 60000;
  return minutesLeft > 0 && minutesLeft < SEND_CHANGE_LOCK_MINUTES;
}

/**
 * 같은 잠금을 SQL 조건으로(UPDATE · 잡는 문장 안 · DB 시계) — 판정한 뒤 저장하기까지 경계를 넘으면 0행(★ 2026-10-19 Codex L1).
 * `column` = 보낼 시각 칸(그 문장이 보는 옛 값) · `minutesParam` = SEND_CHANGE_LOCK_MINUTES 를 담은 자리표시 번호.
 * ⛔ 시각 = `clock_timestamp()`(그 문장이 실제로 도는 순간) · `NOW()` 가 아니다 — NOW() 는 트랜잭션 시작 시각이라
 *   잠금을 기다린 트랜잭션(만료 건 다시 진행 = BEGIN 뒤 advisory 잠금)은 경계 전 시각으로 판정한다(Codex L2 · 같은 부류 두 번째의 뿌리).
 */
export function sendChangeLockFreeSql(column: string, minutesParam: number): string {
  return ` AND NOT (${column} > clock_timestamp() AND ${column} < clock_timestamp() + ($${minutesParam}::int * INTERVAL '1 minute'))`;
}

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
