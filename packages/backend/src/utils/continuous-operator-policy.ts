/**
 * CT-64: Continuous Operator Policy — 자동마케팅 발송 정책 순수 함수
 *
 * 스팸 결과 → 제안 상태 결정 + AI 재생성 프롬프트 + 담당자 정지 사유 학습.
 * (검증 7일 게이팅·가짜 스팸 점수기는 D227+ autoSpamTestWithRegenerate 격상 + 자율 발송 정리로 제거됨.)
 */

import { addMemory } from './company-memory';
import { hasUneditedBenefitPlaceholder } from './autosend-policy';
import { eucKrByteLength } from './message-byte';

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

/** ★ 2026-10-06 화면 스팸 검사 횟수 — 제안마다 5회 · 무료(Harold 1006 · 자동 검사와 같은 무료 경로) */
export const PROPOSAL_SPAM_RETEST_LIMIT = 5;

/**
 * ★ 2026-10-06 화면 「스팸 검사」(임은지 재오픈) — 고른 안 · 고친 문안에서 검사할 문안을 정한다.
 * 발송(dispatchProposalSend)과 같은 순서다: 고친 본문이 있으면 그것 · 제목은 문자열이 오면 그것 · 단문이 90byte 를 넘으면 장문으로 검사한다.
 * ★ Codex 3R 구조 정정 — 혜택 자리([혜택 …] · 직접 입력 안내)가 남은 문안은 검사하지 않는다(혜택을 문안에 직접 넣은 뒤 검사).
 *   혜택은 서버(운영자 설정)에만 있어 화면이 「지금 나갈 문안」을 알 수 없다 → 1R(혜택 바뀌어도 지난 통과 표시) · 2R(받아 둔 결과 미갱신) ·
 *   3R(재조회 실패 · 응답 역전)이 같은 뿌리로 반복됐다. 혜택 자리가 없으면 발송의 혜택 치환은 아무것도 바꾸지 않으므로
 *   검사한 글자 = 화면 글자 = 나가는 글자가 되고 화면이 글자만으로 결과를 붙일 수 있다.
 * ⛔ 발송 쪽 규칙을 바꾸면 여기도 바꾼다(검사한 문안 = 나가는 문안).
 */
export function resolveRetestCopy(
  pj: any,
  sel: { variantIndex: number; body?: string; subject?: string },
): { ok: true; body: string; subject: string; msgType: 'SMS' | 'LMS' | 'MMS' } | { ok: false; reason: string } {
  const msg = Array.isArray(pj?.messages) ? pj.messages[sel.variantIndex] : null;
  if (!Number.isInteger(sel.variantIndex) || sel.variantIndex < 0 || !msg) return { ok: false, reason: '검사할 문안을 찾을 수 없습니다.' };
  const edited = typeof sel.body === 'string' && sel.body.trim() !== '';
  const body = edited ? String(sel.body) : String(msg.body || msg.message || '');
  const subject = typeof sel.subject === 'string' ? sel.subject : String(msg.subject || '');
  if (!body.trim()) return { ok: false, reason: '문안이 비어 있어 검사할 수 없습니다.' };
  if (hasUneditedBenefitPlaceholder(body) || hasUneditedBenefitPlaceholder(subject)) {
    return { ok: false, reason: '혜택 자리가 남은 문안은 검사하지 않습니다. 문안 편집에서 혜택을 직접 넣은 뒤 검사해 주세요.' };
  }
  const channel = String(pj?.channel?.recommended || 'SMS').toUpperCase();
  let msgType: 'SMS' | 'LMS' | 'MMS' = channel === 'LMS' || channel === 'MMS' ? channel : 'SMS';
  if (msgType === 'SMS' && edited && eucKrByteLength(body) > 90) msgType = 'LMS';
  return { ok: true, body, subject, msgType };
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
