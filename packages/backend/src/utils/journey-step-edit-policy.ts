/**
 * journey-step-edit-policy.ts — 칸 편집 정책 한 곳 (★ 2026-10-09 고객 관계 지도 · 설계서 docs/2026-10-09-journey-crm-map-design.md §4)
 *
 * 지도 응답(칸마다 무엇을 고칠 수 있는지)과 칸 PATCH 게이트(updateJourneyStep)가 **같은 함수**를 부른다.
 * 화면이 따로 판정하면 "눌렀는데 409"가 생긴다(잠금 = 서버 관문과 같은 수).
 *
 * 키 4묶음
 *   문안   = 본문 · 제목                       — 끝남 외 전부(켜짐은 allowActiveMessageEdit 로만)
 *   간격   = 대기 시간 · 대기 방식 · 보낼 시각   — 초안 · 멈춤 · ★V.3 켜짐(이미 잡힌 다음 발송 시각은 그대로 · 실행기가 앞 칸을 보낼 때 다음 칸 시각을 정한다)
 *                                                켜진 날짜 기준 · 한 번 보내기 여정은 새 모양(실행이 칸 하나짜리 단발)
 *   구조   = 채널 · 광고 · 칸 종류 · 조건 · 알림톡 · 이미지 — 초안 · 진행 중 없는 멈춤만(진행 중 고객이 기다리는 칸의 모양을 바꾸지 않는다)
 *                                                켜진 여정은 새 모양(새로 들어오는 고객부터 · journey-reshape)
 *   운영   = 담당자 알림                        — 끝남 외 전부(발송 내용이 아니다)
 * ⛔ 켜진 여정의 이미지는 구조다 — 스냅숏에 이미지가 없어 바꾸면 사전 검사 없이 다음 발송부터 나간다(journey-builder updateJourneyStep).
 * ★ 2026-10-20 여정 V.3 묶음 2(설계서 §4) — 화면 이유 문장에 「새 판」이라는 말을 쓰지 않는다(새 모양은 서버가 한 흐름으로 처리).
 */

export type StepEditGroup = 'copy' | 'timing' | 'structure' | 'ops';

export const STEP_EDIT_KEYS: Record<StepEditGroup, readonly string[]> = {
  copy: ['messageTemplate', 'subject'],
  timing: ['delayHours', 'delayMode', 'targetHourKst'],
  structure: [
    'channel', 'isAd', 'stepType', 'conditionJsonb',
    'alimtalkProfileId', 'alimtalkTemplateCode', 'alimtalkVariableMap',
    'alimtalkNextType', 'alimtalkNextContents', 'alimtalkNextSubject',
    'mmsImagePaths',
  ],
  ops: ['notifyManagerOnPretest'],
};

export interface StepEditPolicy {
  copy: boolean;
  timing: boolean;
  structure: boolean;
  ops: boolean;
  /** 여정 단위 한 줄(지도 · 편집 창이 그대로 보여 준다). */
  reason: string;
}

export function stepEditPolicy(status: string, inProgress: number, startKind?: string | null): StepEditPolicy {
  if (status === 'draft') {
    return { copy: true, timing: true, structure: true, ops: true, reason: '초안이라 자유롭게 고칠 수 있어요.' };
  }
  if (status === 'paused') {
    if (inProgress > 0) {
      return {
        copy: true, timing: true, structure: false, ops: true,
        reason: '진행 중인 고객이 있는 멈춘 여정이에요. 문안과 간격은 바로 고치고, 칸 모양은 다시 켠 뒤 바꿔요(새로 들어오는 고객부터 바뀐 모양으로 받아요).',
      };
    }
    return { copy: true, timing: true, structure: true, ops: true, reason: '멈춘 여정이고 진행 중인 고객이 없어 자유롭게 고칠 수 있어요.' };
  }
  if (status === 'active') {
    // 날짜 기준 · 한 번 보내기 실행은 칸 하나짜리 단발이다(실행기 advanceOrComplete) — 간격을 그 자리에서 바꾸면 회차 표식과 어긋난다.
    const single = startKind === 'date_anchor' || startKind === 'one_shot';
    return {
      copy: true, timing: !single, structure: false, ops: true,
      reason: single
        ? '켜진 여정은 문안을 바로 고쳐요. 날짜나 칸 모양을 바꾸면 다음 회차부터 바뀐 모양으로 보내요.'
        : '켜진 여정은 문안과 간격을 바로 고쳐요. 이미 다음 문자 시각이 잡힌 고객은 그 시각 그대로 받아요. 칸 모양을 바꾸면 새로 들어오는 고객부터 바뀐 모양으로 받아요.',
    };
  }
  return { copy: false, timing: false, structure: false, ops: false, reason: '끝난 여정은 고칠 수 없어요.' };
}

/**
 * ★ V.3 §4-4 — 칸 수정이 사전검사 표식을 지켜도 되는가. **건드린 키가 전부 간격 · 담당자 알림일 때만**(나열 밖 키 = 기본 비움).
 *   사전검사가 보는 것(문안 · 제목 · 채널 · 광고 · 이미지 · 알림톡 · 칸 종류 · 조건 칸)은 유지 목록에 없다.
 */
export function keepsPretestMarkerForStep(patch: Record<string, unknown>): boolean {
  const keep = new Set<string>([...STEP_EDIT_KEYS.timing, ...STEP_EDIT_KEYS.ops]);
  const keys = Object.keys(patch || {}).filter((k) => patch[k] !== undefined && k !== 'allowActiveMessageEdit');
  return keys.length > 0 && keys.every((k) => keep.has(k));
}

/** 여정 옵션 중 켜진 채 그 자리에서 고쳐도 되는 키 = 다음 진입 · 다음 칸 · 즉시(덜 보내는 방향)부터 바뀌는 것. 사전검사 표식도 지킨다. */
const OPTION_KEEP_KEYS = new Set<string>([
  // 시작 조건(다음 진입부터)
  'customer_conditions', 'logic', 'all_customers', 'recent_hours', 'dormant_days', 'days_before', 'abandon_hours', 'points_min',
  'inactive_days', 'expiry_mode', 'expiry_month_day', 'entry_replace', 'exclude_first_purchase', 'exclude_dormant_return',
  'include_existing', 'backfill_per_day', 'entryEndsOn',
  // 한도 · 재진입 · 대조군 · 예산 · 개인 발송 시각
  'thresholdRecipients', 'thresholdCost', 'thresholdRiskLevel', 'budgetMonthly', 'allowReentry', 'reentryCooldownDays',
  'autoReentryEnabled', 'holdoutPct', 'personalSendTime',
  // 목표(켜짐에서는 켜기만 · 아래 판정)
  'goalExitEnabled', 'goalKind',
]);
/** ★ V.3 §7-2 — 시작 조건 키(건드리면 「지금 맞는 N명」을 다시 센다). */
export const JOURNEY_ENTRY_KEYS = new Set<string>([
  'customer_conditions', 'logic', 'all_customers', 'recent_hours', 'dormant_days', 'days_before', 'abandon_hours', 'points_min',
  'inactive_days', 'expiry_mode', 'expiry_month_day', 'include_existing', 'backfill_per_day', 'thresholdRecipients',
  'allowReentry', 'reentryCooldownDays',
]);
/**
 * ★ V.3 §7-2 — 추출 결과가 곧 다음 회차 진입인 시작 사건(고른 고객에게 · 휴면 전환). 켜진 채 넓힌 결과가 상한을 넘으면 저장을 막는다
 *   (진입 감시가 다음 회차에 여정 전체를 자동 멈춘다). 사건형(구매 등)의 인원은 최근 사건 미리보기라 막는 근거로 쓰지 않는다.
 */
export const STANDING_COUNT_TRIGGERS = new Set<string>(['custom', 'customer.dormant']);

/** 판정에 쓰지 않는 요청 꼬리(값이 아니다). */
const OPTION_META_KEYS = new Set<string>(['acknowledgedOverlaps', 'dryRun']);

export type JourneyOptionEditVerdict =
  | { ok: true; keepMarker: boolean; overlapCheck?: true }
  | { ok: false; code: 'JOURNEY_NEEDS_NEW_SHAPE' | 'JOURNEY_ENDED'; message: string };

/**
 * ★ V.3 §4-1 — 여정 옵션 저장 판정 한 곳(옵션 · 자동 재진입 주소가 같이 쓴다).
 *   켜진 여정: 목표 종료 끄기 · 목표 종류 · 회신번호 · 회신 모드 = 새 모양(실행기가 그 자리 값을 칸마다 읽어 진행 중 고객이 바뀐다).
 *   겹침 해소 옵션을 끄면 같은 구매에 두 통이 다시 생길 수 있어 겹침 확인을 요구한다(overlapCheck).
 */
export function journeyOptionEditVerdict(status: string, body: Record<string, any>): JourneyOptionEditVerdict {
  if (status !== 'draft' && status !== 'paused' && status !== 'active') {
    return { ok: false, code: 'JOURNEY_ENDED', message: '끝난 여정은 고칠 수 없어요.' };
  }
  const keys = Object.keys(body || {}).filter((k) => !OPTION_META_KEYS.has(k));
  if (status === 'active') {
    const shape = keys.filter((k) => k === 'goalKind' || k === 'callbackNumber' || k === 'callbackMode'
      || (k === 'goalExitEnabled' && !(body.goalExitEnabled === true || body.goalExitEnabled === 'true')));
    if (shape.length > 0) {
      return {
        ok: false,
        code: 'JOURNEY_NEEDS_NEW_SHAPE',
        message: '목표를 끄거나 바꾸는 것, 회신번호를 바꾸는 것은 진행 중인 고객에게 바로 영향을 줘요. 새로 들어오는 고객부터 바뀐 모양으로 받게 바꿔요.',
      };
    }
  }
  const keepMarker = keys.length > 0 && keys.every((k) => OPTION_KEEP_KEYS.has(k));
  const turnsOffExclusion = status === 'active' && (['exclude_first_purchase', 'exclude_dormant_return'] as const)
    .some((k) => k in (body || {}) && !(body[k] === true || body[k] === 'true'));
  return turnsOffExclusion ? { ok: true, keepMarker, overlapCheck: true } : { ok: true, keepMarker };
}

/** 요청이 건드린 묶음 — undefined 키는 건드리지 않은 것. */
export function touchedStepEditGroups(patch: Record<string, unknown>): StepEditGroup[] {
  return (Object.keys(STEP_EDIT_KEYS) as StepEditGroup[]).filter((g) => STEP_EDIT_KEYS[g].some((k) => patch[k] !== undefined));
}

/** 정책에 막힌 묶음(없으면 빈 배열). 켜진 여정의 문안은 allowActiveMessageEdit 로 명시한 요청만. */
export function blockedStepEditGroups(policy: StepEditPolicy, patch: Record<string, unknown>, status: string): StepEditGroup[] {
  return touchedStepEditGroups(patch).filter((g) => {
    if (!policy[g]) return true;
    return g === 'copy' && status === 'active' && patch.allowActiveMessageEdit !== true;
  });
}

const GROUP_LABEL: Record<StepEditGroup, string> = { copy: '문안', timing: '간격', structure: '칸 모양', ops: '담당자 알림' };

export function stepEditBlockedMessage(policy: StepEditPolicy, blocked: StepEditGroup[]): string {
  return `${blocked.map((g) => GROUP_LABEL[g]).join(' · ')}은(는) 지금 고칠 수 없어요. ${policy.reason}`;
}
