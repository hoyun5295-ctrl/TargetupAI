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
    // ★ 2026-10-03 화면(자동마케팅 카드 경고)에 그대로 나가는 문장이라 판정값을 한국어로 싣는다(옛: 'blocked' 영문 노출 · 임은지 접수)
    reason: `스팸필터 미통과 (AI 재생성 ${regenerateCount}회 후에도 ${SPAM_VERDICT_LABEL[finalResult] || '검사 실패'}). 담당자 검토 필요`,
  };
}

/** ★ 2026-10-03 스팸 검사 판정값의 고객 표기(정책 사유 · 화면 안별 결과가 같은 말을 쓴다) */
export const SPAM_VERDICT_LABEL: Record<string, string> = {
  pass: '통과',
  blocked: '차단',
  timeout: '결과를 받지 못함',
  failed: '검사 실패',
};

/**
 * ★ 2026-10-03 Codex 2R — 자동 발송(예약 제안 선점)이 요구하는 「검증됨」 SQL 조건(operator_proposals 행 기준).
 *   - spam_test_status = 'pass' : 생성 때 스팸 검사 통과가 저장됐다(검사 결과 저장 → 상태 저장 순서라 통과 안 번호도 저장됨)
 *   - reviewed_at IS NOT NULL   : 사람이 승인했다(야간 승인은 승인 뒤 scheduled 로 돌아온다 · 사람이 판단한 발송)
 *   - 리마인드                  : 자기 검증(스팸 검증 중 → 통과 시 scheduled 승격) 뒤에만 scheduled 가 된다
 * 이 조건 밖의 scheduled = 검사 결과 저장·담당자 검토 전환이 모두 실패해 남은 행 → 보내지 않고 담당자 검토로 내린다.
 */
// ⛔ spam_test_status 는 COALESCE 로 감싼다(Codex 3R) — NULL(검사 결과 저장 실패 = 이 관문이 막으려는 바로 그 행)이면
//    식 전체가 NULL 이 되어 NOT 식도 NULL → 담당자 검토 전환도 선점도 안 일어나고 scheduled 로 영원히 남는다.
export const AUTO_SEND_SPAM_VERIFIED_SQL = "(COALESCE(spam_test_status, '') = 'pass' OR reviewed_at IS NOT NULL OR COALESCE(proposal_json->'meta'->>'is_reminder', 'false') = 'true')";

/**
 * ★ 2026-10-03 제안의 스팸 검사 통과 안 번호(proposal_json.spamCheck.passedIndex) — 없거나 문안이 없으면 null.
 * 발송은 사용자가 고르지 않았으면 이 안을 보낸다(검사한 문안 = 나가는 문안 · 무작위 추천보다 먼저).
 */
export function spamCheckPassedIndex(pj: any): number | null {
  const idx = pj?.spamCheck?.passedIndex;
  if (!Number.isInteger(idx) || idx < 0) return null;
  return Array.isArray(pj?.messages) && pj.messages[idx] ? idx : null;
}

/**
 * 스팸 차단 시 AI 재생성 프롬프트 — generateMessages에 전달.
 * 구체 혜택(%/할인/쿠폰) 생성 금지 명시 (feedback_ai_no_arbitrary_benefit).
 * ★ 2026-07-02 2단계: styleHint(문안 스타일 지시 블록) 전달 시 재생성 문안도 같은 스타일 유지.
 */
export function buildSpamRegeneratePrompt(objective: string, styleHint?: string): string {
  return `${objective}${styleHint ? `\n${styleHint}` : ''}
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
    const summary = `자동 마케팅 담당자 정지 = "${reasonLabel}"${stopReason.detail ? `: ${stopReason.detail}` : ''}. 정지된 문안: "${messageBody.slice(0, 100)}${messageBody.length > 100 ? '...' : ''}"`;

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
