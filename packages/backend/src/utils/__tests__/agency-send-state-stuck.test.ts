/**
 * 멈춘 예약 시도 판정 (★2026-09-13(3) · 불변 26 수용 위험 제거)
 *   시도 안의 대기가 끝나지 않으면 진행 중 표시가 남아 lock 복구가 그 건을 영영 건너뛰었다.
 *   예약 시각이 지나고도 이만큼 더 지난 진행 중 시도는 제시간 발송이 이미 불가능하므로 멈춘 것으로 인수한다.
 */
import { describe, it, expect } from 'vitest';
import { isAttemptStuck, ATTEMPT_STUCK_AFTER_DUE_MINUTES } from '../agency-send-state';

describe('isAttemptStuck', () => {
  it('예약 시각 전·경과 30분 이하는 멈춤이 아니고, 30분 초과면 멈춤이다', () => {
    const due = new Date('2026-09-13T01:00:00Z');
    expect(isAttemptStuck(due, new Date('2026-09-13T00:59:00Z'))).toBe(false);
    expect(isAttemptStuck(due, new Date('2026-09-13T01:30:00Z'))).toBe(false);
    expect(isAttemptStuck(due, new Date('2026-09-13T01:31:00Z'))).toBe(true);
    expect(ATTEMPT_STUCK_AFTER_DUE_MINUTES).toBe(30);
  });
});
