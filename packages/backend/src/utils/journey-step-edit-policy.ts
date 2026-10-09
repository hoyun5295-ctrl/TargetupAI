/**
 * journey-step-edit-policy.ts — 칸 편집 정책 한 곳 (★ 2026-10-09 고객 관계 지도 · 설계서 docs/2026-10-09-journey-crm-map-design.md §4)
 *
 * 지도 응답(칸마다 무엇을 고칠 수 있는지)과 칸 PATCH 게이트(updateJourneyStep)가 **같은 함수**를 부른다.
 * 화면이 따로 판정하면 "눌렀는데 409"가 생긴다(잠금 = 서버 관문과 같은 수).
 *
 * 키 4묶음
 *   문안   = 본문 · 제목                       — 끝남 외 전부(켜짐은 allowActiveMessageEdit 로만)
 *   간격   = 대기 시간 · 대기 방식 · 보낼 시각   — 초안 · 멈춤(진행 중 있어도 · 이미 잡힌 다음 발송 시각은 그대로)
 *   구조   = 채널 · 광고 · 칸 종류 · 조건 · 알림톡 · 이미지 — 초안 · 진행 중 없는 멈춤만(진행 중 고객이 기다리는 칸의 모양을 바꾸지 않는다)
 *   운영   = 담당자 알림                        — 끝남 외 전부(발송 내용이 아니다)
 * ⛔ 켜진 여정의 이미지는 구조다 — 스냅숏에 이미지가 없어 바꾸면 사전 검사 없이 다음 발송부터 나간다(journey-builder updateJourneyStep).
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

export function stepEditPolicy(status: string, inProgress: number): StepEditPolicy {
  if (status === 'draft') {
    return { copy: true, timing: true, structure: true, ops: true, reason: '초안이라 자유롭게 고칠 수 있어요.' };
  }
  if (status === 'paused') {
    if (inProgress > 0) {
      return {
        copy: true, timing: true, structure: false, ops: true,
        reason: '진행 중인 고객이 있는 멈춘 여정이에요. 문안과 간격만 고칠 수 있고, 칸 모양을 바꾸려면 새 판으로 고쳐요.',
      };
    }
    return { copy: true, timing: true, structure: true, ops: true, reason: '멈춘 여정이고 진행 중인 고객이 없어 자유롭게 고칠 수 있어요.' };
  }
  if (status === 'active') {
    return { copy: true, timing: false, structure: false, ops: true, reason: '켜진 여정은 문안만 고칠 수 있어요. 간격이나 칸 모양을 바꾸려면 새 판으로 고쳐요.' };
  }
  return { copy: false, timing: false, structure: false, ops: false, reason: '끝난 여정은 고칠 수 없어요.' };
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
