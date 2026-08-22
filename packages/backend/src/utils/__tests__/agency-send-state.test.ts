/**
 * 대행발송 상태 머신·시각 규칙 계약 (★ 2026-08-22) — docs/2026-08-22-agency-send-design.md §3·§4-3·§4-4
 *
 * 이 파일이 잠그는 것(운영에서 재현하기 어려운 분기들):
 *   ① 승인만으로 큐에 못 간다 — 반드시 당일 재검사를 지난다(불변 2)
 *   ② 승인은 문안 버전에 묶인다 — 다듬어진 뒤의 옛 승인은 거절(불변 7)
 *   ③ 요청 시각까지 승인이 없으면 발송하지 않고 만료(불변 1)
 *   ④ 발송 허용 시간 밖은 접수에서 거절하고 **조용히 옮기지 않는다**(불변 9)
 *   ⑤ 워커가 잡은 채 죽어도 건이 영영 멈추지 않는다(lock 복구)
 */
import { describe, it, expect } from 'vitest';
import {
  AGENCY_SEND_STATUSES, canTransition, canCancel, isEditable, needsQueueCancel,
  validateRequestedAt, checkApproval, isFinalTestDue, isQueueDue, isApprovalExpired, isApprovalCurrent,
  isLockStale, lockRecoveryStatus, hasTestRoundsLeft, kstHour, requiredLeadMinutes,
  FINAL_TEST_LEAD_MINUTES, MAX_TEST_ROUNDS, MIN_LEAD_MINUTES, QUEUE_MARGIN_MINUTES,
  type AgencySendStatus,
} from '../agency-send-state';

/** 2026-08-24(월) KST 10:00 = UTC 01:00 */
const NOW = new Date('2026-08-24T01:00:00Z');
const minutesLater = (m: number) => new Date(NOW.getTime() + m * 60000);

describe('대행발송 상태 전이', () => {
  it('당일 검사를 통과하지 않은 건은 승인만으로 예약되지 않는다', () => {
    // ★ 2026-08-23 전이표에서 approved → queued를 열었다(재승인 건은 검사를 이미 통과했다).
    //   불변 2를 지키는 자리는 전이표가 아니라 `final_test_at` 유무를 보는 판정이다.
    expect(isQueueDue('approved', minutesLater(60), NOW, null)).toBe(false);
    expect(isFinalTestDue('approved', minutesLater(60), NOW, null)).toBe(true);
    expect(isQueueDue('approved', minutesLater(60), NOW, minutesLater(-5))).toBe(true);
    expect(isFinalTestDue('approved', minutesLater(60), NOW, minutesLater(-5))).toBe(false);
    expect(canTransition('reapproval', 'queued')).toBe(false);
    expect(canTransition('approved', 'final_testing')).toBe(true);
    expect(canTransition('final_testing', 'queued')).toBe(true);
  });

  it('당일 차단은 재승인으로 가고, 재승인은 다시 승인으로만 간다', () => {
    expect(canTransition('final_testing', 'reapproval')).toBe(true);
    expect(canTransition('reapproval', 'approved')).toBe(true);
    expect(canTransition('reapproval', 'final_testing')).toBe(false);
  });

  it('취소는 끝이다. 되살아나는 길이 없다', () => {
    for (const s of AGENCY_SEND_STATUSES) {
      expect(canTransition('cancelled', s)).toBe(false);
    }
  });

  it('워커가 잡은 상태(testing·final_testing)는 담당자가 손대지 못한다', () => {
    expect(isEditable('testing')).toBe(false);
    expect(isEditable('final_testing')).toBe(false);
    expect(canCancel('testing')).toBe(false);
    expect(canCancel('final_testing')).toBe(false);
    expect(isEditable('awaiting_approval')).toBe(true);
    expect(canCancel('approved')).toBe(true);
  });

  it('큐 삭제가 필요한 취소는 queued뿐이다(그 전에는 큐에 아무것도 없다)', () => {
    expect(needsQueueCancel('queued')).toBe(true);
    for (const s of AGENCY_SEND_STATUSES.filter((x) => x !== 'queued')) {
      expect(needsQueueCancel(s as AgencySendStatus)).toBe(false);
    }
  });
});

describe('요청 시각 검증', () => {
  it('최소 리드타임보다 이르면 거절한다', () => {
    const tooSoon = validateRequestedAt(minutesLater(MIN_LEAD_MINUTES - 1).toISOString(), NOW);
    expect(tooSoon.valid).toBe(false);
    expect(tooSoon.error).toContain('시간 뒤부터');
    // 리드타임을 넘기고 허용 시간 안이면 통과 (10:00 + 3h = 13:00 KST)
    expect(validateRequestedAt(minutesLater(MIN_LEAD_MINUTES + 1).toISOString(), NOW).valid).toBe(true);
  });

  it('발송 허용 시간 밖은 거절한다 — 조용히 옮기지 않는다', () => {
    const at22 = new Date('2026-08-24T13:00:00Z'); // KST 22:00
    const r = validateRequestedAt(at22.toISOString(), NOW);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('사이로 정해 주세요');
    expect(r.at).toBeUndefined(); // 대체 시각을 만들어 주지 않는다
  });

  it('회사 설정이 있으면 그 창을 쓴다', () => {
    const at9 = new Date('2026-08-25T00:00:00Z'); // KST 09:00
    expect(validateRequestedAt(at9.toISOString(), NOW, { startHour: 8, endHour: 21 }).valid).toBe(true);
    expect(validateRequestedAt(at9.toISOString(), NOW, { startHour: 10, endHour: 18 }).valid).toBe(false);
  });

  it('빈 값·형식 오류·1년 초과를 막는다', () => {
    expect(validateRequestedAt('', NOW).valid).toBe(false);
    expect(validateRequestedAt('내일 아침', NOW).valid).toBe(false);
    expect(validateRequestedAt(new Date('2028-01-05T02:00:00Z').toISOString(), NOW).valid).toBe(false);
  });

  it('KST 시각 계산이 UTC로 새지 않는다', () => {
    expect(kstHour(new Date('2026-08-24T01:00:00Z'))).toBe(10);
    expect(kstHour(new Date('2026-08-24T15:30:00Z'))).toBe(0); // 다음날 00:30 KST
  });
});

describe('승인 판정', () => {
  const base = { status: 'awaiting_approval' as AgencySendStatus, contentVersion: 2, requestedAt: minutesLater(300) };

  it('버전이 같고 시간이 남았으면 승인된다', () => {
    expect(checkApproval(base, 2, NOW).ok).toBe(true);
  });

  it('문안이 다듬어진 뒤의 옛 승인은 거절한다', () => {
    const r = checkApproval(base, 1, NOW);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('VERSION_MISMATCH');
  });

  it('재검사 시간이 남지 않았으면 거절한다', () => {
    const late = { ...base, requestedAt: minutesLater(FINAL_TEST_LEAD_MINUTES - 1) };
    const r = checkApproval(late, 2, NOW);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TOO_LATE');
    // 경계는 만료 판정과 같은 쪽으로 닫는다 — 딱 그 값이면 승인되지 않는다(승인 직후 만료되는 건을 없앤다)
    expect(checkApproval({ ...base, requestedAt: minutesLater(FINAL_TEST_LEAD_MINUTES) }, 2, NOW).ok).toBe(false);
    expect(checkApproval({ ...base, requestedAt: minutesLater(FINAL_TEST_LEAD_MINUTES + 1) }, 2, NOW).ok).toBe(true);
  });

  it('승인 대기가 아닌 상태에서는 승인되지 않는다', () => {
    for (const s of ['received', 'testing', 'approved', 'queued', 'expired', 'cancelled'] as AgencySendStatus[]) {
      expect(checkApproval({ ...base, status: s }, 2, NOW).ok).toBe(false);
    }
    expect(checkApproval({ ...base, status: 'reapproval' }, 2, NOW).ok).toBe(true);
  });

  /**
   * ★ 2026-08-23 §12-2 정정 계약.
   * 당일 차단으로 `reapproval`이 되는 순간은 **정의상 2시간 미만**이 남은 때다.
   * 승인에 2시간을 요구하면 그 상태의 승인은 100% 거절되고, 안내 문자만 "다시 승인해 주세요"라고 말한다.
   * 재승인 건은 검사를 이미 통과했으므로 필요한 것은 예약을 넣을 여유뿐이다.
   */
  it('재승인은 2시간이 남지 않아도 승인된다 — 검사를 이미 통과한 문안이다', () => {
    const reapproval = { ...base, status: 'reapproval' as AgencySendStatus, requestedAt: minutesLater(100) };
    expect(checkApproval(reapproval, 2, NOW).ok).toBe(true);
    expect(checkApproval({ ...reapproval, requestedAt: minutesLater(QUEUE_MARGIN_MINUTES + 1) }, 2, NOW).ok).toBe(true);
    // 예약을 넣을 여유조차 없으면 거절하고 시각을 다시 받는다
    const tooLate = checkApproval({ ...reapproval, requestedAt: minutesLater(QUEUE_MARGIN_MINUTES - 1) }, 2, NOW);
    expect(tooLate.ok).toBe(false);
    expect(tooLate.code).toBe('TOO_LATE');
  });

  /**
   * 승인 게이트가 라우트에만 있으면, 워커가 문안을 다듬은 직후 상태 전이가 실패한 경로로
   * **담당자가 못 본 문장**이 적재까지 간다. 적재 직전에 같은 것을 다시 본다(불변 7).
   */
  it('승인은 문안 버전에 묶인다 — 적재 직전에도 같은 판정을 쓴다', () => {
    expect(isApprovalCurrent(3, 3)).toBe(true);
    expect(isApprovalCurrent(2, 3)).toBe(false);
    expect(isApprovalCurrent(null, 3)).toBe(false);   // 승인 흔적이 지워진 건
    expect(isApprovalCurrent(undefined, 3)).toBe(false);
    expect(isApprovalCurrent(3, null)).toBe(false);
  });

  it('필요한 리드타임은 상태가 정한다 — 승인·만료 판정이 같은 값을 쓴다', () => {
    expect(requiredLeadMinutes('awaiting_approval')).toBe(FINAL_TEST_LEAD_MINUTES);
    expect(requiredLeadMinutes('reapproval')).toBe(QUEUE_MARGIN_MINUTES);
    expect(requiredLeadMinutes('approved')).toBe(QUEUE_MARGIN_MINUTES);
  });
});

describe('워커 픽업 판정', () => {
  /**
   * ★ 2026-08-23 §12-3 정정 계약.
   * 전에는 "110분 초과 120분 이하"라는 10분 창이었다. 워커 한 tick이 밀리거나 앞 건 검사가 길어져
   * 창을 넘기면 그 건은 영영 안 잡혔고, 만료 판정도 `approved`를 보지 않아 **발송도 만료도 안내도
   * 없는 건**이 남았다. 창을 없애고 단조 조건으로 바꾼다(중복은 선점 UPDATE가 막는다).
   */
  it('당일 재검사는 2시간 전부터 예약 여유가 남는 동안 계속 잡는다 — 창을 놓쳐도 사라지지 않는다', () => {
    expect(isFinalTestDue('approved', minutesLater(121), NOW, null)).toBe(false); // 아직 이르다
    expect(isFinalTestDue('approved', minutesLater(119), NOW, null)).toBe(true);
    expect(isFinalTestDue('approved', minutesLater(111), NOW, null)).toBe(true);
    expect(isFinalTestDue('approved', minutesLater(109), NOW, null)).toBe(true);  // 옛 창이 버리던 자리
    expect(isFinalTestDue('approved', minutesLater(30), NOW, null)).toBe(true);
    expect(isFinalTestDue('approved', minutesLater(QUEUE_MARGIN_MINUTES), NOW, null)).toBe(false); // 여기부터는 만료
    expect(isFinalTestDue('awaiting_approval', minutesLater(119), NOW, null)).toBe(false); // 승인 안 된 건은 대상이 아니다
  });

  it('승인·재승인·승인 완료 어느 쪽도 시간이 지나면 만료다 — 발송하지 않는다', () => {
    expect(isApprovalExpired('awaiting_approval', minutesLater(119), NOW)).toBe(true);
    expect(isApprovalExpired('reapproval', minutesLater(QUEUE_MARGIN_MINUTES), NOW)).toBe(true);
    expect(isApprovalExpired('awaiting_approval', minutesLater(121), NOW)).toBe(false);
    // ★ 승인된 건도 만료로 간다. 전에는 여기가 비어 있어 아무 일도 일어나지 않았다
    expect(isApprovalExpired('approved', minutesLater(QUEUE_MARGIN_MINUTES), NOW)).toBe(true);
    expect(isApprovalExpired('approved', minutesLater(QUEUE_MARGIN_MINUTES + 1), NOW)).toBe(false);
    expect(isApprovalExpired('queued', minutesLater(1), NOW)).toBe(false); // 이미 예약된 건은 만료 대상이 아니다
  });

  it('재검사 대상과 만료 대상이 겹치지도 비지도 않는다 — 사이에 빠지는 구간이 없다', () => {
    for (let m = 1; m <= 130; m += 1) {
      const at = minutesLater(m);
      const test = isFinalTestDue('approved', at, NOW, null);
      const expire = isApprovalExpired('approved', at, NOW);
      if (m <= FINAL_TEST_LEAD_MINUTES) expect(test || expire).toBe(true); // 반드시 누군가 맡는다
      expect(test && expire).toBe(false);                                  // 둘이 동시에 맡지 않는다
    }
  });

  it('워커가 잡은 채 죽어도 30분 뒤 되돌아간다', () => {
    expect(isLockStale('testing', minutesLater(-31), NOW)).toBe(true);
    expect(isLockStale('testing', minutesLater(-29), NOW)).toBe(false);
    expect(isLockStale('testing', null, NOW)).toBe(true);
    expect(isLockStale('approved', minutesLater(-100), NOW)).toBe(false);
    expect(lockRecoveryStatus('testing')).toBe('received');
    expect(lockRecoveryStatus('final_testing')).toBe('approved');
    expect(lockRecoveryStatus('queued')).toBeNull();
    // 복구 경로가 전이표에도 열려 있어야 한다
    expect(canTransition('testing', 'received')).toBe(true);
    expect(canTransition('final_testing', 'approved')).toBe(true);
  });

  it('검사 회차는 세 번까지다', () => {
    expect(hasTestRoundsLeft(0)).toBe(true);
    expect(hasTestRoundsLeft(MAX_TEST_ROUNDS - 1)).toBe(true);
    expect(hasTestRoundsLeft(MAX_TEST_ROUNDS)).toBe(false);
  });
});
