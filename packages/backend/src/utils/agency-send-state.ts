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
  | 'cancelling'         // 담당자가 취소를 눌렀고 **큐 삭제가 아직 안 끝났다**
  | 'cancelled'          // 담당자 취소
  | 'sent';              // 예약 시각이 지나 발송이 끝났다(종결 · ★2026-08-28)

export const AGENCY_SEND_STATUSES: readonly AgencySendStatus[] = [
  'received', 'testing', 'awaiting_approval', 'test_failed', 'approved',
  'final_testing', 'queued', 'reapproval', 'expired', 'cancelling', 'cancelled', 'sent',
];

/**
 * 허용 전이표. 여기 없는 이동은 코드가 막는다.
 * ⛔ `approved`·`reapproval`에서 `queued`로 바로 갈 수 없다 — 반드시 `final_testing`(당일 재검사)를 지난다.
 *   승인만으로 큐에 넣으면 "검사 없이 나가는 발송"이 생긴다(불변 2).
 */
const TRANSITIONS: Record<AgencySendStatus, readonly AgencySendStatus[]> = {
  received: ['testing', 'cancelling'],
  testing: ['awaiting_approval', 'test_failed', 'received'],             // received = lock 복구
  awaiting_approval: ['approved', 'received', 'expired', 'cancelling'],  // received = 담당자가 문안 수정
  test_failed: ['received', 'cancelling'],
  // expired = 승인은 받았는데 워커가 재검사·적재를 넣을 시간이 지났다(발송하지 않는다)
  approved: ['final_testing', 'queued', 'expired', 'cancelling'],
  // queued = 재승인 건(당일 검사를 이미 통과한 문안)은 재검사 없이 적재로 간다
  // expired = 잔액 부족 등으로 예약을 만들지 못했다
  final_testing: ['queued', 'reapproval', 'test_failed', 'expired', 'approved'],  // approved = lock 복구
  // ⛔ 적재 뒤에는 상태를 내리지 않는다 — 일부가 이미 나갔을 수 있어 "미발송"으로 적으면 거짓이 된다.
  //   적재 실패는 이벤트와 안내로 알리고 상태는 그대로 둔다(취소만 상태를 바꾼다).
  // ★2026-08-28 `sent` = 예약 시각이 지나 끝난 상태. 그전에는 적재가 끝이라 **발송된 뒤에도 화면이
  //   「예약 완료」로 남았고, 그래서 취소 버튼이 계속 보였다**(서수란 접수 `cmtcgacmr03o8jnothzxrtrf6`).
  queued: ['cancelling', 'sent'],                                        // 취소는 기존 캠페인 취소 CT를 함께 탄다

  reapproval: ['approved', 'received', 'expired', 'cancelling'],
  expired: ['received', 'cancelling'],                                   // received = 새 시각으로 다시 올린다
  /**
   * ⛔ **취소는 두 저장소를 건드리는 다단계 작업이라 중간 상태가 있어야 한다**(★2026-08-23 Codex 3R critical).
   *   원장을 먼저 `cancelled`로 확정하면, 그 뒤 큐 삭제가 실패하거나 프로세스가 죽는 순간
   *   **화면은 취소인데 큐는 살아 요청 시각에 나간다**(0611과 같은 형태). 그래서 `cancelling`으로 먼저 잡고,
   *   큐 삭제가 끝난 뒤에만 `cancelled`로 간다. 죽어서 남은 `cancelling`은 워커가 마무리한다.
   *   되돌아가는 길들은 큐 삭제가 거절됐을 때(예: 발송 15분 전) 원래 상태로 복구하는 경로다.
   */
  cancelling: ['cancelled', 'received', 'awaiting_approval', 'test_failed', 'approved', 'queued', 'reapproval', 'expired'],
  cancelled: [],
  // ⛔ 종결이다. 이미 나간 발송은 되돌릴 수 없고, 「취소됨」으로 적으면 고객이 받은 사실과 어긋난다.
  sent: [],
};

export function canTransition(from: AgencySendStatus, to: AgencySendStatus): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

/** 담당자가 손댈 수 있는 상태인가(문안 수정·시각 변경). 워커가 잡고 있는 동안은 막는다 */
export function isEditable(status: AgencySendStatus): boolean {
  return status === 'awaiting_approval' || status === 'reapproval' || status === 'test_failed' || status === 'expired';
}

/**
 * 취소 가능한가. `queued`도 가능하지만 그때는 큐 삭제(기존 취소 CT)가 함께 돌아야 한다.
 * ⛔ `cancelling`은 이미 취소가 진행 중이라 다시 누를 수 없다(두 번 누르면 큐 삭제가 겹친다).
 */
export function canCancel(status: AgencySendStatus): boolean {
  return status !== 'cancelled' && status !== 'cancelling'
    && status !== 'testing' && status !== 'final_testing'
    // ★2026-08-28 발송이 끝난 건은 취소 대상이 아니다(접수 `cmtcgacmr03o8jnothzxrtrf6`).
    && status !== 'sent';
}

/** 취소 가능 상태를 SQL `NOT IN (...)`에 넣을 리터럴. 위 판정과 **같은 집합이어야 한다** */
export const NOT_CANCELABLE_SQL = "'cancelled','cancelling','testing','final_testing','sent'";

/**
 * 발송이 끝난 것으로 볼 수 있는가 — **예약 시각이 지난 `queued`**.
 *
 * ⛔ 새 기준을 만들지 않는다. 이메일 중복 판정(`EMAIL_DUP_BLOCKING_SQL`)이 이미 같은 축을 쓰고 있어,
 *   두 곳이 다른 시각 규칙을 가지면 "한쪽은 끝난 건, 다른 쪽은 살아 있는 건"으로 갈린다.
 */
export function isDeliveredByTime(
  status: AgencySendStatus, requestedAt: Date | null | undefined, now: Date,
): boolean {
  if (status !== 'queued') return false;
  if (!requestedAt || Number.isNaN(requestedAt.getTime())) return false;
  return requestedAt.getTime() <= now.getTime();
}

/** 위 판정의 SQL 짝 — 같은 집합이어야 한다 */
export const DELIVERED_BY_TIME_SQL = "status = 'queued' AND requested_at <= NOW()";

/** 취소에 큐 삭제가 필요한가. `queued`부터가 큐에 실려 있다 */
export function needsQueueCancel(status: AgencySendStatus): boolean {
  return status === 'queued';
}

/**
 * ★2026-08-26 §18-6 이메일 접수 중복(내용 4요소) 차단 집합.
 * 차단 = 발송 전 전 상태 + `queued` 중 `requested_at` 미도래. 허용 = `expired`·`cancelled`·시각이 지난 `queued`.
 * ⛔ `queued`를 종결로 읽으면 **아직 나가지 않은 예약과 같은 명단이 한 벌 더 접수된다**(이중 발송 · 회의론자 필수 2).
 * ⛔ 아래 SQL 리터럴과 판정 함수는 같은 집합이어야 한다 — 짝 테스트가 고정한다(NOT_CANCELABLE_SQL 규율).
 */
export const EMAIL_DUP_ALLOWED_TERMINAL: readonly AgencySendStatus[] = ['expired', 'cancelled'] as const;
export const EMAIL_DUP_BLOCKING_SQL =
  `(status NOT IN ('expired','cancelled') AND NOT (status = 'queued' AND requested_at <= NOW()))`;
export function isEmailDupBlocking(status: AgencySendStatus, requestedAt: Date | null | undefined, now: Date): boolean {
  if ((EMAIL_DUP_ALLOWED_TERMINAL as readonly string[]).includes(status)) return false;
  if (status === 'queued' && requestedAt && !Number.isNaN(requestedAt.getTime()) && requestedAt.getTime() <= now.getTime()) return false;
  return true;
}

// ────────────── 시각 규칙 ──────────────

/** 접수 시각으로부터 최소 이만큼 뒤여야 한다: 1차 검사 + 승인 + 2시간 전 재검사가 들어갈 시간(불변 9) */
/**
 * 조정 없이 그대로 접수할 수 있는 최소 리드타임(분).
 *
 * ★2026-08-26(6) Harold 지시로 180 → 40. 옛 180은 "발송 2시간 전 재검사(120) + 승인 창 60"에서 나온 값인데,
 *   0823(2)에 **당일 접수 건은 재검사를 하지 않도록** 바뀌면서 그 전제가 사라졌다. 그 결과
 *   "승인은 발송 10분 전까지 받아주면서 접수는 3시간 전에만" 이라는 비대칭이 남아 있었다.
 *
 * 40의 내역(접수 즉시 1차 검사를 깨우는 것 전제 · triggerAgencySendFirstTest):
 *   스팸 검사 최대 3회 8분 + 담당자 문자 도착 1분 + 적재 여유 10분(QUEUE_MARGIN_MINUTES) = 19분,
 *   나머지 21분이 담당자가 승인할 시간이다. **기준선 바로 위의 건이 가장 빠듯하므로** 그 건 기준으로 잡는다.
 */
export const MIN_LEAD_MINUTES = 40;
/**
 * 이메일 접수 최소 리드타임. ★2026-08-26(6) 240 → 화면과 같은 값으로 통일한다.
 * 옛 240은 메일 지연·폴링·회신 왕복을 리드타임으로 흡수한 값이었는데, 그 시간은 **접수가 성립하기 전**에
 * 지나가므로 접수 시점 기준 계산에는 들어가지 않는다(워커가 메일을 집은 순간이 접수 시각이다).
 * 집행 지점은 여전히 createRequestCore(pre.minLeadMinutes) 하나다.
 */
export const EMAIL_MIN_LEAD_MINUTES = MIN_LEAD_MINUTES;
/**
 * 자동 조정 폭(분) — ★2026-08-26(6) Harold 확정 "여유롭게 발송요청시각 + 30분까지 설정해도 된다".
 *
 * 촉박한 요청을 거절하는 대신 뒤로 밀어 성공시킨다. **안전 면에서 잃는 것이 없다**:
 * 승인 게이트가 그대로라 밀린 시각으로도 담당자가 승인하지 않으면 나가지 않고,
 * 승인이 늦으면 미발송으로 끝난다(= 지금 거절하는 것과 결과가 같다). 성공 가능성만 올라간다.
 */
export const AUTO_SHIFT_MINUTES = 30;
/** 당일 재검사를 시작하는 지점(발송 2시간 전) */
export const FINAL_TEST_LEAD_MINUTES = 120;
/**
 * 큐에 넣기만 하면 되는 건에 남아 있어야 하는 최소 여유(분).
 *
 * ★ 2026-08-23 신설. 전에는 상수가 `FINAL_TEST_LEAD_MINUTES` 하나뿐이라 **뜻이 셋인 값을 하나로 쓰고 있었다**:
 *   승인 마감 · 재검사 시작 · 적재 여유. 그래서 당일 차단으로 `reapproval`이 된 건(정의상 2시간 미만이 남는다)이
 *   승인에서 항상 거절됐고, 안내 문자는 "다시 승인해 주세요"라고 하는데 버튼은 듣지 않았다(§12-2).
 *   재승인 건은 **검사를 이미 통과한 문안**이라 남은 일이 적재뿐이므로 필요한 여유가 다르다.
 */
export const QUEUE_MARGIN_MINUTES = 10;
/** 발송 허용 시간 기본값(회사 설정이 없을 때). config SEND_HOURS와 같은 값이지만 이 파일은 순수해야 해서 인자로 받는다 */
export const DEFAULT_SEND_START_HOUR = 8;
export const DEFAULT_SEND_END_HOUR = 21;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 그 시각의 "몇 시"인가 (0~23) */
export function kstHour(at: Date): number {
  return new Date(at.getTime() + KST_OFFSET_MS).getUTCHours();
}

/** KST 달력 날짜 키(YYYY-MM-DD). "같은 날인가"를 판정하는 유일한 기준 */
export function kstDateKey(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 두 시각이 **KST 기준 같은 날**인가.
 *
 * ★ 2026-08-23 신설(Harold 지시). 접수한 그날 나가는 건은 접수 때 통과한 검사가 곧 당일 검사다.
 *   그런 건에 발송 2시간 전 재검사를 또 돌리면 같은 문안을 같은 날 두 번 검사하는 것이고,
 *   테스트폰 발송 비용이 한 번 더 나가며 통신사 결과가 흔들려 승인받은 문안이 뒤집힐 수 있다.
 *   접수일과 발송일이 다르면 그날의 검사가 없으므로 재검사는 그대로 한다.
 */
export function isSameKstDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return kstDateKey(a) === kstDateKey(b);
}

export interface RequestedAtCheck {
  valid: boolean;
  error?: string;
  /** 통과했을 때의 Date. **조정됐으면 조정된 시각이다**(원본은 originalAt) */
  at?: Date;
  /** ★2026-08-26(6) 자동 조정 여부. true면 사용자가 적은 시각과 다르다 = 반드시 알려야 한다 */
  shifted?: boolean;
  /** 조정 전 원본(사용자가 적은 시각). 조정됐을 때만 있다 */
  originalAt?: Date;
}

export interface SendWindow {
  startHour?: number | null;
  endHour?: number | null;
}

/**
 * 요청 시각 검증(접수·시각 변경 공용).
 *   ① 형식 ② 리드타임(미달이면 **자동 조정**) ③ 365일 이내 ④ 회사 발송 허용 시간 안.
 *
 * ★2026-08-26(6) 리드타임 미달을 거절에서 **자동 조정**으로 바꿨다(Harold 확정).
 *   조정 시각 = `max(요청 시각 + AUTO_SHIFT_MINUTES, 지금 + minLeadMinutes)`.
 *   앞항이 Harold 지시("발송요청시각 + 30분")이고, 뒷항은 요청이 과거이거나 지금과 붙어 있을 때
 *   안전선을 지키는 하한이다(둘 중 큰 쪽이라 두 성질이 함께 산다).
 *
 * ⛔ **조정은 조용히 하지 않는다.** `shifted`를 받은 쪽이 반드시 사람에게 알린다
 *   (화면 확인 단계 · 이메일 접수 회신 · 담당자 승인 문자). 이 축은 담당자 승인 문자에 확정 시각이
 *   찍혀 나가므로 "언제 나갔는지 모르는 발송"이 되지 않는다 — 옛 주석의 금지는 사람 확인이 없는 경로 얘기다.
 * ⛔ **발송 허용 시간 밖은 여전히 옮기지 않는다.** 조정 결과가 창 밖이면 거절한다(하루 뒤로 미루면
 *   사용자 의도와 너무 멀어진다). 창 판정은 조정 **후** 시각으로 한다.
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
  let finalAt = at;
  let shifted = false;
  if (diffMinutes < minLeadMinutes) {
    finalAt = new Date(Math.max(
      at.getTime() + AUTO_SHIFT_MINUTES * 60000,
      now.getTime() + minLeadMinutes * 60000,
    ));
    shifted = true;
  }

  if ((finalAt.getTime() - now.getTime()) / (60000 * 60 * 24) > 365) {
    return { valid: false, error: '보낼 시각은 1년 이내로 정해 주세요.' };
  }

  const startHour = Number.isFinite(window.startHour as number) ? Number(window.startHour) : DEFAULT_SEND_START_HOUR;
  const endHour = Number.isFinite(window.endHour as number) ? Number(window.endHour) : DEFAULT_SEND_END_HOUR;
  const h = kstHour(finalAt);
  if (h < startHour || h >= endHour) {
    return {
      valid: false,
      // 조정 때문에 창을 넘긴 경우와 원래 창 밖인 경우를 다르게 쓴다(사용자가 무엇을 고쳐야 하는지 다르다)
      error: shifted
        ? `보낼 시각이 촉박해 ${AUTO_SHIFT_MINUTES}분 뒤로 미루면 발송 가능 시간(${startHour}시~${endHour}시)을 넘습니다. 시각을 다시 정해 주세요.`
        : `${startHour}시부터 ${endHour}시 사이로 정해 주세요. 그 밖의 시간에는 발송할 수 없습니다.`,
    };
  }

  return shifted
    ? { valid: true, at: finalAt, shifted: true, originalAt: at }
    : { valid: true, at: finalAt };
}

// ────────────── 승인·워커 판정 ──────────────

export interface ApprovalTarget {
  status: AgencySendStatus;
  /**
   * 행 수정 번호. **이 행에 일어난 모든 변경이 이 값을 올린다**(문안·시각·상태·워커 처리 전부).
   *
   * ★ 2026-08-23 `contentVersion` 비교를 여기로 바꿨다(Codex 2R high). 시각만 바뀐 건은
   *   상태도 문안 버전도 그대로라, 담당자가 **못 본 시각**으로 옛 승인이 그대로 통과했다.
   *   "무엇이 바뀌었나"를 축마다 세지 않고 "이 행이 바뀌었나" 하나로 본다.
   */
  revision: number;
  requestedAt: Date;
  /**
   * 이 문안이 **발송일 당일 검사를 통과한** 시각(`final_test_at`). 없으면 아직 안 지났다는 뜻이다.
   * 통과 분기에서만 찍히므로 "있다 = 남은 일이 적재뿐이다"가 성립한다.
   */
  finalTestedAt?: Date | null;
}

/**
 * **이 건이 지금 필요로 하는 리드타임(분).** 승인 판정과 만료 판정이 같은 답을 써야 한다.
 *
 * 갈리면 그 사이가 함정이 된다: 승인은 되는데 워커가 안 잡는 구간, 또는 승인이 거절되는데
 * 만료도 안 되는 구간이 생긴다. §12-2·§12-3이 정확히 그 두 구간이었다.
 *
 *   · 당일 검사 통과함(`final_test_at` 있음) = 상태와 무관하게 남은 일이 적재뿐이다 → 적재 여유만
 *   · `awaiting_approval` = 승인 뒤 **당일 재검사**가 들어가야 한다 → 2시간
 *   · `reapproval`        = 당일 검사를 이미 통과한 문안이다 → 적재 여유만
 *   · `approved`          = 승인이 끝났다. 워커가 검사·적재를 하면 된다 → 적재 여유만
 *
 * ★ 2026-08-23(2) `finalTested` 합류(Harold 지시). 접수한 그날 나가는 건은 접수 검사가 곧 당일 검사라
 *   재검사가 없다. 그런 건에 2시간을 요구하면 **하지도 않을 검사를 이유로** 승인을 거절하고
 *   근거 없이 만료시킨다. 필요한 리드타임은 상태가 아니라 **남은 일**이 정한다.
 */
export function requiredLeadMinutes(status: AgencySendStatus, finalTested = false): number {
  if (finalTested) return QUEUE_MARGIN_MINUTES;
  return status === 'awaiting_approval' ? FINAL_TEST_LEAD_MINUTES : QUEUE_MARGIN_MINUTES;
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
export function checkApproval(target: ApprovalTarget, approvingRevision: number, now: Date): ApprovalCheck {
  if (target.status !== 'awaiting_approval' && target.status !== 'reapproval') {
    return { ok: false, error: '지금은 승인할 수 있는 상태가 아닙니다.', code: 'NOT_APPROVABLE' };
  }
  if (!Number.isFinite(Number(approvingRevision)) || Number(approvingRevision) !== Number(target.revision)) {
    return {
      ok: false,
      error: '그 사이 내용이 바뀌었습니다. 화면을 새로 고쳐 문안과 시각을 확인한 뒤 승인해 주세요.',
      code: 'STALE_VIEW',
    };
  }
  // ⛔ 경계는 만료 판정과 **같은 쪽으로** 닫는다(`<=`). 한쪽이 `<`면 딱 그 값일 때
  //   "승인은 됐는데 같은 tick에 만료되는" 건이 생긴다.
  const finalTested = !!target.finalTestedAt;
  const minutesLeft = (target.requestedAt.getTime() - now.getTime()) / 60000;
  if (minutesLeft <= requiredLeadMinutes(target.status, finalTested)) {
    return {
      ok: false,
      // ⛔ 당일 검사가 끝난 건에 "재검사에 필요한 시간"이라고 쓰면 거짓이다. 남은 일이 다르면 문장도 다르다.
      error: target.status === 'awaiting_approval' && !finalTested
        ? '보낼 시각까지 2시간이 남지 않았습니다. 발송 직전 재검사에 필요한 시간이라 시각을 다시 정해 주세요.'
        : '보낼 시각이 너무 가까워 예약을 넣지 못합니다. 시각을 다시 정해 주세요.',
      code: 'TOO_LATE',
    };
  }
  return { ok: true };
}

/**
 * 워커 B(당일 재검사) 대상인가. 승인된 건이 발송 2시간 전 안에 들어왔고 **아직 오늘 검사를 안 한** 경우.
 *
 * ★ 2026-08-23 창(110분 초과 120분 이하)을 없애고 단조 조건으로 바꿨다. 워커 한 tick이 밀리거나
 *   앞 건 검사가 길어져 10분 창을 넘기면 그 건은 영영 안 잡히고, 만료 판정도 `approved`를 보지 않아
 *   **발송도 만료도 안내도 없는 건**이 남았다(§12-3). 중복 처리는 창이 아니라 선점 UPDATE(`status='approved'`)가 막는다.
 *
 * ★ 2026-08-23(2) 접수한 그날 나가는 건은 워커 A가 1차 검사 통과 시점에 `final_test_at`을 찍는다.
 *   그래서 여기서 걸러지고 곧바로 적재(`isQueueDue`)로 간다. 판정은 그대로 두고 **스위치를 켜는 자리만 늘렸다.**
 */
export function isFinalTestDue(
  status: AgencySendStatus, requestedAt: Date, now: Date, finalTestedAt?: Date | null,
): boolean {
  if (status !== 'approved') return false;
  if (finalTestedAt) return false; // 오늘 검사를 이미 통과한 문안이다 → 재검사가 아니라 적재로 간다
  const minutesLeft = (requestedAt.getTime() - now.getTime()) / 60000;
  return minutesLeft <= FINAL_TEST_LEAD_MINUTES && minutesLeft > QUEUE_MARGIN_MINUTES;
}

/**
 * 지금 문안이 **승인받은 그 문안인가**(불변 7).
 *
 * 승인 라우트가 이미 버전을 맞춰 보지만, 그 뒤에도 워커가 문안을 다듬어 버전을 올린다.
 * 다듬은 직후 상태 전이가 실패해 잡기 전 상태로 되돌아가면 **담당자가 못 본 문장이 적재까지 갈 수 있다.**
 * 그래서 효과가 만들어지는 자리(적재 직전)에서 한 번 더 본다.
 */
export function isApprovalCurrent(approvalVersion: any, contentVersion: any): boolean {
  const a = Number(approvalVersion);
  const c = Number(contentVersion);
  return Number.isFinite(a) && Number.isFinite(c) && a === c;
}

/**
 * 워커 B(적재) 대상인가. **당일 재검사를 이미 통과한 문안**을 담당자가 재승인한 건.
 *
 * 검사를 두 번 하지 않는 이유: 그 문안은 방금 통과했다. 다시 돌리면 통신사 결과가 흔들려
 * 승인받은 문안이 또 차단으로 뒤집힐 수 있고, 그 사이 남은 시간도 사라진다.
 * ⛔ `final_test_at`은 문안이 바뀌면 반드시 지워진다. 시각 변경은 **새 시각이 그 검사와 같은 날일 때만** 남긴다.
 *
 * ★ 2026-08-23(2) 접수한 그날 나가는 건도 여기로 온다(워커 A가 통과 시점에 찍는다).
 *   ⛔ 그래도 **적재 시점은 그대로 발송 2시간 전**이다. 상한은 워커 후보 SQL이 들고 있다.
 */
export function isQueueDue(
  status: AgencySendStatus, requestedAt: Date, now: Date, finalTestedAt?: Date | null,
): boolean {
  if (status !== 'approved' || !finalTestedAt) return false;
  return (requestedAt.getTime() - now.getTime()) / 60000 > QUEUE_MARGIN_MINUTES;
}

/**
 * 워커 C(만료) 대상인가. 남은 시간이 그 상태에 필요한 리드타임보다 짧아진 건.
 * ⛔ 이때 발송하지 않는다. 승인 없는 발송도, 당일 검사 없는 발송도 이 축에 없다(불변 1·2).
 *
 * ★ 2026-08-23 `approved`가 대상에 들어왔다. 전에는 승인된 건이 재검사 창을 놓치면 아무 워커도
 *   맡지 않아 요청 시각이 지나도 그대로 남았다(§12-3).
 * ★ 2026-08-23(2) `finalTestedAt`을 함께 받는다. **승인 판정과 같은 인자를 써야 한다** —
 *   한쪽만 알면 승인은 되는데 다음 tick이 만료시키는 구간이 다시 생긴다.
 */
export function isApprovalExpired(
  status: AgencySendStatus, requestedAt: Date, now: Date, finalTestedAt?: Date | null,
): boolean {
  if (status !== 'awaiting_approval' && status !== 'reapproval' && status !== 'approved') return false;
  return (requestedAt.getTime() - now.getTime()) / 60000 <= requiredLeadMinutes(status, !!finalTestedAt);
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
