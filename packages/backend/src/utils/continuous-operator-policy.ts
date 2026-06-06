/**
 * CT-64: Continuous Operator Policy — 자동마케팅 발송 정책 순수 함수
 *
 * 스팸 결과 → 제안 상태 결정 + AI 재생성 프롬프트 + 담당자 정지 사유 학습.
 * (검증 7일 게이팅·가짜 스팸 점수기는 D227+ autoSpamTestWithRegenerate 격상 + 자율 발송 정리로 제거됨.)
 */

import { addMemory } from './company-memory';

// ━━━ 외부 노출 타입 ━━━
export type DeliveryPolicy = 'daily' | 'weekly' | 'monthly';
export type SpamTestStatus = 'pending' | 'passed' | 'failed' | 'retry';
export type AdminResponse = 'opt_out' | 'stopped' | 'expired' | 'pending';

export interface AdminStopReason {
  reason: 'spam_suspicion' | 'content_correction' | 'no_send' | 'other';
  detail?: string;
}

export interface OperatorPolicy {
  deliveryPolicy: DeliveryPolicy;
  deliveryDay: number | null;         // 매주 요일 (0~6, 0=일) / 매달 일자 (1~31)
  deliveryHour: number;                // 0~23 (KST)
  verificationRequiredDays: number;
  verificationPassedDays: number;
  adminPhoneNumbers: string[];
  backupAdminPhone: string | null;
  adminAlertChannel: 'sms' | 'kakao' | 'email';
  optOutMinutes: number;
  spamScoreThreshold: number;
  maxSpamRetries: number;
}

// ━━━ 스팸 결과 → 제안 상태 결정 (D227+) ━━━
//   spam-test-queue.ts autoSpamTestWithRegenerate가 실제 테스트폰 발송 + AI 재생성 + 재테스트 수행.
//   그 최종 결과를 받아 제안 상태를 결정하는 순수 함수.

export type SpamOutcomeStatus = 'spam_passed' | 'admin_review';

export interface SpamOutcome {
  status: SpamOutcomeStatus;
  autoExecuteBlocked: boolean;
  reason: string;
}

/**
 * 스팸 최종 결과(autoSpamTestWithRegenerate spamResult) → 제안 상태 결정.
 * - 'pass' → spam_passed (발송 진행)
 * - 그 외(blocked/failed/timeout) → admin_review (담당자 검토 대기, 자동 발송 차단)
 *   ★ Harold 2026-05-31: 끝내 통과 못한 문안은 자동 폐기 X, 담당자가 직접 판단.
 */
export function decideSpamOutcome(
  finalResult: 'pass' | 'blocked' | 'failed' | 'timeout',
  regenerateCount: number,
): SpamOutcome {
  if (finalResult === 'pass') {
    return {
      status: 'spam_passed',
      autoExecuteBlocked: false,
      reason: regenerateCount > 0
        ? `스팸필터 통과 (AI 재생성 ${regenerateCount}회 후 통과)`
        : '스팸필터 통과',
    };
  }
  return {
    status: 'admin_review',
    autoExecuteBlocked: true,
    reason: `스팸필터 미통과 (AI 재생성 ${regenerateCount}회 후에도 ${finalResult}) — 담당자 검토 필요`,
  };
}

/**
 * 스팸 차단 시 AI 재생성 프롬프트 — generateMessages에 전달.
 * 구체 혜택(%/할인/쿠폰) 생성 금지 명시 (feedback_ai_no_arbitrary_benefit).
 */
export function buildSpamRegeneratePrompt(objective: string): string {
  return `${objective}
(이전 문안이 스팸필터에 차단되었습니다. 같은 목표를 유지하되 다른 표현으로 다시 작성해주세요. 할인율·쿠폰·금액 같은 구체 혜택은 임의로 만들지 마세요.)`;
}

// ━━━ 담당자 정지 사유 학습 → ai_company_memory (다음 생성에 반영) ━━━

export async function recordAdminStopLearning(
  companyId: string,
  proposalId: string,
  stopReason: AdminStopReason,
  messageBody: string,
): Promise<void> {
  try {
    const reasonLabelMap: Record<string, string> = {
      spam_suspicion: '스팸 의심',
      content_correction: '문안 정정 필요',
      no_send: '발송 안 함',
      other: '기타',
    };
    const reasonLabel = reasonLabelMap[stopReason.reason] || '기타';
    const summary = `자동 마케팅 담당자 정지 = "${reasonLabel}"${stopReason.detail ? ` — ${stopReason.detail}` : ''}. 정지된 문안: "${messageBody.slice(0, 100)}${messageBody.length > 100 ? '...' : ''}"`;

    await addMemory({
      companyId,
      memoryType: 'compliance_learning',
      memoryKey: `admin_stop_${proposalId}`,
      memoryValue: summary,
      importance: 6,
      source: 'continuous-operator-policy',
      metadata: { proposalId, stopReason },
    });
  } catch (err: any) {
    console.warn('[ContinuousOperatorPolicy] recordAdminStopLearning 오류, skip:', err?.message);
  }
}
