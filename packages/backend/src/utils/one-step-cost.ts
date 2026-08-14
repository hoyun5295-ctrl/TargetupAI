/**
 * one-step-cost.ts — 원스텝 생성 요금 산식 (순수 · ★ 2026-08-13 Phase 3)
 *
 * 설계서 = docs/2026-08-13-one-step-content-interview-design.md §4-4·§6-2
 *
 * **표시 금액과 실제 차감이 같은 함수에서 나온다.** 화면이 정적 상수 맵으로 금액을 그리면
 * "표시 100 ≠ 차감 120"이 재현된다 — 견적 응답도, 차감도 이 파일의 `buildOneStepCharges` 하나만 부른다.
 *
 * ⛔ 불변
 *   - **단가의 진실은 `CREDIT_COST_MAP` 하나다.** 여기 숫자를 쓰지 않는다.
 *   - **제작물 과금 키를 새로 만들지 않는다** — 발행·완성은 그 채널 라우트가 자기 키로 걷는다
 *     (`dm-publish:{dmId}` 등). 여기서 선차감하면 같은 제작물에 두 번 과금된다.
 *   - **대행 델타는 세션당 1회다.** 재생성해도 다시 걷지 않는다 — 다시 나가는 것은 생성비뿐이다.
 *   - **"이미 냈는가"의 진실은 원장이다**(`isChargedByKey`). 세션 표식 같은 사본을 두고 그걸 읽으면,
 *     차감은 됐는데 표식만 실패한 순간 견적이 이미 낸 돈을 다시 청구하고 잔액 게이트가 부당하게 막는다.
 */
import { getCreditCost } from './ai-credit-calc';

/** 오토설계 대행분 — AI 원가가 아니라 **대행 가치**다(플래너 요금 철학의 대행 축). */
export const ONE_STEP_INTERVIEW_SOURCE = 'one-step-interview';
/** 채널 생성분 — 그 채널이 원래 쓰는 source를 그대로 쓴다(새 source를 만들지 않는다). */
export const ONE_STEP_DM_GEN_SOURCE = 'dm-ai-generate';

export interface OneStepCharge {
  source: string;
  /** 화면에 그대로 뜨는 항목명 — 내부 코드명·개발 용어를 쓰지 않는다. */
  label: string;
  cost: number;
  idempotencyKey: string;
}

/** 대행 델타 멱등키 — 세션 고정(재생성해도 같은 키라 중복 차감이 성립하지 않는다). */
export function oneStepInterviewKey(sessionId: string): string {
  return `one-step:${sessionId}`;
}

/** 생성 멱등키 — 회차 포함(재생성은 새 생성이라 다시 걷는다). */
export function oneStepGenKey(sessionId: string, attempt: number): string {
  return `one-step-gen:${sessionId}:dm:${Math.max(0, Math.floor(attempt))}`;
}

/**
 * (순수) 이번 생성에서 걷을 항목들.
 * `interviewPaid` = 이 세션의 대행 델타를 이미 걷었는가(재생성이면 true → 생성비만 남는다).
 */
export function buildOneStepCharges(input: {
  sessionId: string;
  attempt: number;
  interviewPaid: boolean;
  /** 크레딧제 미적용 회사 = 원장이 전혀 움직이지 않는다. 그런 회사에 금액을 표시하면 화면과 실차감이 갈린다. */
  creditEnabled?: boolean;
}): OneStepCharge[] {
  const priced = input.creditEnabled !== false;
  const charges: OneStepCharge[] = [{
    source: ONE_STEP_DM_GEN_SOURCE,
    label: '모바일 DM 생성',
    cost: priced ? getCreditCost(ONE_STEP_DM_GEN_SOURCE) : 0,
    idempotencyKey: oneStepGenKey(input.sessionId, input.attempt),
  }];
  if (!input.interviewPaid) {
    charges.push({
      source: ONE_STEP_INTERVIEW_SOURCE,
      label: '오토설계 대행',
      cost: priced ? getCreditCost(ONE_STEP_INTERVIEW_SOURCE) : 0,
      idempotencyKey: oneStepInterviewKey(input.sessionId),
    });
  }
  return charges;
}

/** (순수) 견적 총액 — 화면 표시와 사전 확인 모달이 쓰는 값. */
export function sumOneStepCharges(charges: OneStepCharge[]): number {
  return charges.reduce((sum, c) => sum + (Number(c.cost) || 0), 0);
}

/**
 * (순수) 견적 1건 — 라우트가 이 함수 하나로 표시와 차감을 모두 만든다.
 * `publishNotice`는 화면이 그대로 띄운다: 발행분은 여기서 걷지 않고 발행 시점에 걷힌다는 사실을
 * 미리 말하지 않으면 "냈는데 또 낸다"는 접수가 뜬다.
 */
export function estimateOneStep(input: {
  sessionId: string; attempt: number; interviewPaid: boolean; creditEnabled?: boolean;
}): {
  charges: OneStepCharge[];
  total: number;
  publishNotice: string;
} {
  const charges = buildOneStepCharges(input);
  const priced = input.creditEnabled !== false;
  return {
    charges,
    total: sumOneStepCharges(charges),
    publishNotice: priced
      ? `발행 크레딧은 이 금액에 포함되지 않고, 만든 DM을 발행할 때 따로 차감됩니다(${getCreditCost('dm-builder').toLocaleString()}크레딧).`
      : '이 계정은 크레딧이 차감되지 않습니다.',
  };
}
