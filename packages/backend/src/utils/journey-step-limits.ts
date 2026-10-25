/**
 * journey-step-limits.ts — 여정 칸(스텝)의 종류 · 개수 · 대기 상한 단일 출처 (★ 2026-09-29 여정 V2 0차 ⑧ · ⑩)
 *
 * 설계서 = docs/2026-09-29-journey-v2-master-design.md §9 0차.
 *
 * 왜 따로 있나
 *   같은 상한이 다섯 곳에 흩어져 있었다(빌더 7 · 수정기 7 · 생성기 5 · 화면 7 · 대기 720 vs 8760).
 *   그리고 넘치는 입력을 **조용히 잘랐다** — 갈림 뒤쪽 칸이나 "끝"이 잘리면 충족 갈래가 흘러내려 더 보낸다.
 *   모르는 칸 종류는 **문자로 바꿔 저장**했다 — 실행기는 wait · condition 이 아니면 전부 문자로 보내므로
 *   아무도 의도하지 않은 칸이 발송된다.
 *
 * 규약
 *   - 칸 종류: 아는 값만 받는다. 값이 없으면 문자(옛 기본값 그대로) · 모르는 값이면 거부(fail-closed).
 *   - 개수: 넘치면 자르지 않고 거부한다.
 *   - 대기: 상한은 하나(365일). 수정기 · 생성기도 같은 값을 쓴다.
 *   DB · AI 호출 0(순수).
 */

/** 저장이 늘 받는 칸 종류. ⛔ 새 종류는 실행기 · 흐름 그림 · 통계 · 사전검사가 먼저 알아야 연다(설계서 §7 배포 순서). */
export const KNOWN_STEP_TYPES = ['message', 'wait', 'condition'] as const;
/**
 * ★ 2026-09-30 여정 V2 4차 — 끝 칸(발송 0 · 도착하면 그 자리에서 여정 끝). 실행기 · 그림 · 통계 · 사전검사는 이번 배포부터 안다.
 *   **쓰는 경로(저장 · 칸 추가 · AI)는 `JOURNEY_END_CHIP_ENABLED=true` 일 때만 연다** — 운영 한 주기 뒤 켠다(설계서 §7).
 */
export const END_STEP_TYPE = 'end' as const;
/** 실행기 · 그림 · 통계 · 사전검사가 아는 칸 종류(읽는 쪽). */
export const EXECUTABLE_STEP_TYPES = ['message', 'wait', 'condition', 'end'] as const;
export type KnownStepType = (typeof EXECUTABLE_STEP_TYPES)[number];

export function isEndChipEnabled(): boolean {
  return String(process.env.JOURNEY_END_CHIP_ENABLED || '').trim() === 'true';
}

/**
 * 칸 수 상한 — ★ 2026-09-30 V2 4차: 문자 칸 7(0차 현행 의미 유지) + 전체 칸 12(갈림 두 갈래 · 대기 · 조건 · 끝 칸 여유).
 * 화면(JourneysPage 칸 추가)도 같은 두 값이어야 한다.
 */
/** ★ 2026-10-20 여정 V.3 §9-4 — LMS · MMS 제목 글자 상한(직접발송 · DM · 자동 마케팅 입력칸과 같은 40 · 프론트 LMS_SUBJECT_MAX_CHARS · 큐 title_str 은 200). 옛 여정만 50. */
export const JOURNEY_SUBJECT_MAX_CHARS = 40;

export const MAX_MESSAGE_STEPS = 7;
export const MAX_JOURNEY_STEPS = 12;

/** 칸 사이 대기 상한(시간) = 365일. 생성 · AI 생성 · AI 수정 · 편집 전 경로 공통. */
export const MAX_STEP_DELAY_HOURS = 8760;

/** "사건이 오면 바로" 대기의 최대 기다림(시간) = 30일. */
export const MAX_WAIT_TIMEOUT_HOURS = 720;

/**
 * ★ 2026-10-25 여정 구조체크 2차 #6 · #12(뿌리 대장 R1) — 진입 상한 판정 한 곳(진입 감시 두 길 · 재진입 · 시뮬레이션).
 *   하루 몫(backfill_per_day · 상시 · 휴면 시작만 · 1 이상)이 있으면 넘는 분은 다음 회차 · 다음 날로 넘긴다(멈추지 않는다).
 *   없으면 한 회차 후보가 「한 번에 보낼 최대 인원」을 넘을 때 여정을 멈춘다(대량 진입 차단).
 */
export function backfillPerDayOf(j: { trigger_event: string; trigger_filters: any }): number | null {
  if (j.trigger_event !== 'custom' && j.trigger_event !== 'customer.dormant') return null;
  const n = Number((j.trigger_filters || {}).backfill_per_day);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}
export function entryCapExceeded(cap: number | string | null | undefined, backfill: number | null, candidates: number): boolean {
  return backfill == null && cap != null && candidates > Number(cap);
}
/**
 * 넣기 직전 남은 하루 몫(계보 잠금을 잡은 그 트랜잭션 run 으로 센다 · 하루 몫이 없으면 null · 0 이하 = 오늘 몫을 다 썼다).
 *   ★ 2026-10-25 Codex 1R — 잠금 밖에서 센 몫으로 넣으면 진입 감시와 재진입이 같은 몫을 함께 써 하루 몫을 넘는다.
 */
export async function dailyRoomInLock(
  run: { query: (text: string, params?: any[]) => Promise<any> },
  j: { id: string; trigger_event: string; trigger_filters: any },
): Promise<number | null> {
  const backfill = backfillPerDayOf(j);
  if (backfill == null) return null;
  const r = await run.query(ENTERED_TODAY_KST_SQL, [j.id]);
  return backfill - Number(r.rows[0]?.n || 0);
}
/** 오늘(KST) 이 여정에 들어온 실행 수 SQL($1 여정 · 대조군 포함 · 진입이 곧 하루 몫을 쓴다). */
export const ENTERED_TODAY_KST_SQL =
  `SELECT COUNT(*)::int AS n FROM journey_executions
    WHERE journey_id = $1::uuid
      AND entered_at >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date::timestamp AT TIME ZONE 'Asia/Seoul')`;

/** 사용자 입력 · AI 출력이 규약 밖일 때. 라우트는 400으로 돌려준다(500 아님). */
export class JourneyInputError extends Error {
  readonly code = 'JOURNEY_INVALID_INPUT';
  /** ★ 2026-10-19 B-1010-12 — 이 요청으로 이미 만든 초안(있으면 화면이 그 초안을 연다) */
  readonly journeyId?: string;
  constructor(message: string, journeyId?: string) {
    super(message);
    this.name = 'JourneyInputError';
    if (journeyId) this.journeyId = journeyId;
  }
}

/** 저장해도 되는 칸 종류인가(끝 칸 = 스위치가 켜졌을 때만). */
export function isKnownStepType(v: unknown): v is KnownStepType {
  if (typeof v !== 'string') return false;
  if ((KNOWN_STEP_TYPES as readonly string[]).includes(v)) return true;
  return v === END_STEP_TYPE && isEndChipEnabled();
}

/**
 * 칸 종류 확정 — 값이 없으면 문자(옛 기본값) · 아는 값이면 그대로 · 모르는 값이면 거부.
 * ⛔ "모르면 문자" 로 바꾸지 않는다. 그 한 줄이 엉뚱한 칸을 발송하게 만든 자리다.
 */
export function resolveStepType(raw: unknown, where: string): KnownStepType {
  if (raw === undefined || raw === null || raw === '') return 'message';
  if (isKnownStepType(raw)) return raw;
  throw new JourneyInputError(`${where}: 알 수 없는 칸 종류라 저장하지 않았어요. 문자 · 대기 · 조건${isEndChipEnabled() ? ' · 끝' : ''} 중에서 다시 만들어 주세요.`);
}

/** 칸 수 확인(전체) — 넘치면 자르지 않고 거부한다. 칸 종류를 모르는 자리(AI 원본 개수)에서 쓴다. */
export function assertStepCountWithinLimit(count: number, where: string): void {
  if (count > MAX_JOURNEY_STEPS) {
    throw new JourneyInputError(`${where}: 칸이 ${count}개예요. 한 여정은 최대 ${MAX_JOURNEY_STEPS}칸까지 만들 수 있어요. 칸을 줄여 다시 만들어 주세요.`);
  }
}

/** ★ 2026-09-30 V2 4차 — 문자 칸 7 + 전체 12. 종류를 모르면(빈 값) 문자로 센다(옛 기본값과 같다). */
export function assertStepsWithinLimit(steps: ReadonlyArray<{ stepType?: unknown }>, where: string): void {
  assertStepCountWithinLimit(steps.length, where);
  const messages = steps.filter((s) => s.stepType === undefined || s.stepType === null || s.stepType === '' || s.stepType === 'message').length;
  if (messages > MAX_MESSAGE_STEPS) {
    throw new JourneyInputError(`${where}: 문자 칸이 ${messages}개예요. 한 여정은 문자 칸을 최대 ${MAX_MESSAGE_STEPS}개까지 보낼 수 있어요. 칸을 줄여 다시 만들어 주세요.`);
  }
}

/** 대기 시간 정규화 — 0 ~ 365일. 숫자가 아니면 0. */
export function clampStepDelayHours(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_STEP_DELAY_HOURS, Math.floor(n)));
}
