/**
 * agency-send-state.ts — 대행발송 상태 머신·접수 검증 (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-3(상태) · §4-4(워커) · §3(불변).
 *
 * **이 파일은 순수 함수만 담는다.** DB·시각·랜덤을 안 쓴다(현재 시각은 인자로 받는다).
 *   상태 전이와 시각 규칙은 라우트·워커 양쪽이 같은 판정을 써야 하는데, DB에 붙어 있으면
 *   테스트가 실측을 못 한다. "당일 차단 → 재승인" 같은 분기는 운영에서 재현하기 어려워
 *   여기서 고정하지 않으면 영영 검증되지 않는다.
 *
 * ⛔ 승인 없는 발송 0(불변 1) · 당일 검사 없는 발송 0(불변 2) · 승인은 문안 버전에 묶인다(불변 7).
 */

// ────────────── 상태 ──────────────

export type AgencySendStatus =
  | 'received'           // 접수됨, 1차 검사 대기
  | 'testing'            // 워커가 1차 검사 중(lock)
  | 'awaiting_approval'  // 통과 문안을 담당자에게 보냈다. 승인 대기
  | 'test_failed'        // 세 차례 모두 차단
  | 'approved'           // 승인됨. **큐 미적재.** 요청 시각 대기
  | 'final_testing'      // 발송 2시간 전 재검사 중(lock)
  | 'queued'             // 재검사 통과 → 캠페인 생성 + 큐 적재 완료
  | 'reapproval'         // 당일 차단 → 다듬은 문안으로 재승인 대기
  | 'expired'            // 요청 시각까지 승인이 없어 나가지 않음
  | 'cancelled';         // 담당자 취소

export const AGENCY_SEND_STATUSES: readonly AgencySendStatus[] = [
  'received', 'testing', 'awaiting_approval', 'test_failed', 'approved',
  'final_testing', 'queued', 'reapproval', 'expired', 'cancelled',
];

/**
 * 허용 전이표. 여기 없는 이동은 코드가 막는다.
 * ⛔ `approved`·`reapproval`에서 `queued`로 바로 갈 수 없다 — 반드시 `final_testing`(당일 재검사)를 지난다.
 *   승인만으로 큐에 넣으면 "검사 없이 나가는 발송"이 생긴다(불변 2).
 */
const TRANSITIONS: Record<AgencySendStatus, readonly AgencySendStatus[]> = {
  received: ['testing', 'cancelled'],
  testing: ['awaiting_approval', 'test_failed', 'received'],           // received = lock 복구
  awaiting_approval: ['approved', 'received', 'expired', 'cancelled'], // received = 담당자가 문안 수정
  test_failed: ['received', 'cancelled'],
  approved: ['final_testing', 'cancelled'],
  final_testing: ['queued', 'reapproval', 'test_failed', 'approved'],  // approved = lock 복구
  queued: ['cancelled'],                                               // 취소는 기존 캠페인 취소 CT를 함께 탄다
  reapproval: ['approved', 'received', 'expired', 'cancelled'],
  expired: ['received', 'cancelled'],                                  // received = 새 시각으로 다시 올린다
  cancelled: [],
};

export function canTransition(from: AgencySendStatus, to: AgencySendStatus): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

/** 담당자가 손댈 수 있는 상태인가(문안 수정·시각 변경). 워커가 잡고 있는 동안은 막는다 */
export function isEditable(status: AgencySendStatus): boolean {
  return status === 'awaiting_approval' || status === 'reapproval' || status === 'test_failed' || status === 'expired';
}

/** 취소 가능한가. `queued`도 가능하지만 그때는 큐 삭제(기존 취소 CT)가 함께 돌아야 한다 */
export function canCancel(status: AgencySendStatus): boolean {
  return status !== 'cancelled' && status !== 'testing' && status !== 'final_testing';
}

/** 취소에 큐 삭제가 필요한가. `queued`부터가 큐에 실려 있다 */
export function needsQueueCancel(status: AgencySendStatus): boolean {
  return status === 'queued';
}

// ────────────── 시각 규칙 ──────────────

/** 접수 시각으로부터 최소 이만큼 뒤여야 한다: 1차 검사 + 승인 + 2시간 전 재검사가 들어갈 시간(불변 9) */
export const MIN_LEAD_MINUTES = 180;
/** 당일 재검사를 시작하는 지점(발송 2시간 전) */
export const FINAL_TEST_LEAD_MINUTES = 120;
/** 재검사 창의 폭. 워커 주기(5분)보다 넉넉히 잡아 한 건도 건너뛰지 않게 한다 */
export const FINAL_TEST_WINDOW_MINUTES = 10;
/** 발송 허용 시간 기본값(회사 설정이 없을 때). config SEND_HOURS와 같은 값이지만 이 파일은 순수해야 해서 인자로 받는다 */
export const DEFAULT_SEND_START_HOUR = 8;
export const DEFAULT_SEND_END_HOUR = 21;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 그 시각의 "몇 시"인가 (0~23) */
export function kstHour(at: Date): number {
  return new Date(at.getTime() + KST_OFFSET_MS).getUTCHours();
}

export interface RequestedAtCheck {
  valid: boolean;
  error?: string;
  /** 통과했을 때의 Date */
  at?: Date;
}

export interface SendWindow {
  startHour?: number | null;
  endHour?: number | null;
}

/**
 * 요청 시각 검증(접수·시각 변경 공용).
 *   ① 형식 ② 최소 리드타임 ③ 365일 이내 ④ 회사 발송 허용 시간 안.
 * ⛔ 허용 시간 밖이면 **조용히 옮기지 않는다.** 대행발송은 고객이 정한 시각이 계약이라
 *   옮기면 "언제 나갔는지 모르는 발송"이 된다. 거절하고 사용자가 다시 고르게 한다(브랜드 창 판정과 같은 원칙).
 */
export function validateRequestedAt(
  input: any,
  now: Date,
  window: SendWindow = {},
  minLeadMinutes: number = MIN_LEAD_MINUTES,
): RequestedAtCheck {
  if (input === null || input === undefined || input === '') {
    return { valid: false, error: '보낼 시각을 정해 주세요.' };
  }
  const at = new Date(input);
  if (Number.isNaN(at.getTime())) {
    return { valid: false, error: '시각 형식이 올바르지 않습니다.' };
  }

  const diffMinutes = (at.getTime() - now.getTime()) / 60000;
  if (diffMinutes < minLeadMinutes) {
    const hours = Math.ceil(minLeadMinutes / 60);
    return {
      valid: false,
      error: `지금부터 ${hours}시간 뒤부터 정할 수 있습니다. 문안 검사와 승인, 발송 직전 재검사에 필요한 시간입니다.`,
    };
  }
  if (diffMinutes / (60 * 24) > 365) {
    return { valid: false, error: '보낼 시각은 1년 이내로 정해 주세요.' };
  }

  const startHour = Number.isFinite(window.startHour as number) ? Number(window.startHour) : DEFAULT_SEND_START_HOUR;
  const endHour = Number.isFinite(window.endHour as number) ? Number(window.endHour) : DEFAULT_SEND_END_HOUR;
  const h = kstHour(at);
  if (h < startHour || h >= endHour) {
    return {
      valid: false,
      error: `${startHour}시부터 ${endHour}시 사이로 정해 주세요. 그 밖의 시간에는 발송할 수 없습니다.`,
    };
  }

  return { valid: true, at };
}

// ────────────── 승인·워커 판정 ──────────────

export interface ApprovalTarget {
  status: AgencySendStatus;
  contentVersion: number;
  requestedAt: Date;
}

export interface ApprovalCheck {
  ok: boolean;
  error?: string;
  code?: string;
}

/**
 * 승인 가능한가.
 * ⛔ 승인은 **본 문안**에 하는 것이다(불변 7). 화면이 들고 있던 버전과 지금 문안 버전이 다르면
 *   그 사이에 문안이 다듬어진 것이라, 담당자가 못 본 문장이 나갈 수 있다 → 거절하고 다시 보게 한다.
 * ⛔ 재검사까지 남은 시간이 없으면 승인해도 검사를 못 넣는다 → 거절하고 시각을 다시 받는다.
 */
export function checkApproval(target: ApprovalTarget, approvingVersion: number, now: Date): ApprovalCheck {
  if (target.status !== 'awaiting_approval' && target.status !== 'reapproval') {
    return { ok: false, error: '지금은 승인할 수 있는 상태가 아닙니다.', code: 'NOT_APPROVABLE' };
  }
  if (Number(approvingVersion) !== Number(target.contentVersion)) {
    return { ok: false, error: '문안이 바뀌었습니다. 새 문안을 확인하고 다시 승인해 주세요.', code: 'VERSION_MISMATCH' };
  }
  const minutesLeft = (target.requestedAt.getTime() - now.getTime()) / 60000;
  if (minutesLeft < FINAL_TEST_LEAD_MINUTES) {
    return {
      ok: false,
      error: '보낼 시각까지 2시간이 남지 않았습니다. 발송 직전 재검사에 필요한 시간이라 시각을 다시 정해 주세요.',
      code: 'TOO_LATE',
    };
  }
  return { ok: true };
}

/** 워커 B(당일 재검사) 대상인가. 발송 2시간 전 창에 들어왔고 아직 승인 상태인 건 */
export function isFinalTestDue(status: AgencySendStatus, requestedAt: Date, now: Date): boolean {
  if (status !== 'approved') return false;
  const minutesLeft = (requestedAt.getTime() - now.getTime()) / 60000;
  return minutesLeft <= FINAL_TEST_LEAD_MINUTES && minutesLeft > FINAL_TEST_LEAD_MINUTES - FINAL_TEST_WINDOW_MINUTES;
}

/**
 * 워커 C(만료) 대상인가. 승인·재승인을 기다리는 동안 재검사 시점을 넘긴 건.
 * ⛔ 이때 발송하지 않는다. 승인 없는 발송은 이 축에 없다(불변 1).
 */
export function isApprovalExpired(status: AgencySendStatus, requestedAt: Date, now: Date): boolean {
  if (status !== 'awaiting_approval' && status !== 'reapproval') return false;
  return (requestedAt.getTime() - now.getTime()) / 60000 < FINAL_TEST_LEAD_MINUTES;
}

/**
 * 워커 E(lock 복구) 대상인가. 워커가 잡은 채 프로세스가 죽으면 그 건이 영원히 멈춘다.
 * 되돌아갈 상태는 잡기 전 상태다(testing → received · final_testing → approved).
 */
export const LOCK_STALE_MINUTES = 30;

export function isLockStale(status: AgencySendStatus, lockAt: Date | null, now: Date): boolean {
  if (status !== 'testing' && status !== 'final_testing') return false;
  if (!lockAt) return true; // lock 시각 없이 잡혀 있으면 비정상이다
  return (now.getTime() - lockAt.getTime()) / 60000 > LOCK_STALE_MINUTES;
}

export function lockRecoveryStatus(status: AgencySendStatus): AgencySendStatus | null {
  if (status === 'testing') return 'received';
  if (status === 'final_testing') return 'approved';
  return null;
}

// ────────────── 검사 회차 ──────────────

/** 원문 1회 + 다듬기 1회 + 표현만 최소 수정 1회 = 3회까지 본다(설계서 §4-4 A) */
export const MAX_TEST_ROUNDS = 3;

export function hasTestRoundsLeft(testRound: number): boolean {
  return Number(testRound || 0) < MAX_TEST_ROUNDS;
}
