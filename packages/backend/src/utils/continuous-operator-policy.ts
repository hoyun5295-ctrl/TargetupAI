/**
 * CT-64: Continuous Operator Policy — 자동마케팅 발송 정책 순수 함수
 *
 * 스팸 결과 → 제안 상태 결정 + AI 재생성 프롬프트 + 담당자 정지 사유 학습.
 * (검증 7일 게이팅·가짜 스팸 점수기는 D227+ autoSpamTestWithRegenerate 격상 + 자율 발송 정리로 제거됨.)
 */

import { addMemory } from './company-memory';
import { spamVerdictOf, mergeAlternativeVerdicts, isSpamHold, type SpamVerdict } from './spam-test-queue';

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
  /** ★ 2026-11-01 B1-4 — 확인 중 · 검사 중(자동 발송만 보류 · 운영자 정지 · 정지 알림 없음) */
  hold?: boolean;
}

/**
 * 스팸 최종 결과(autoSpamTestWithRegenerate spamResult) → 제안 상태 결정.
 * - 'pass' → spam_passed (발송 진행)
 * - 그 외(blocked/failed/timeout) → admin_review (담당자 검토 대기, 자동 발송 차단)
 *   ★ Harold 2026-05-31: 끝내 통과 못한 문안은 자동 폐기 X, 담당자가 직접 판단.
 */
/**
 * ★ 2026-11-06 C109 E5 — 보낼 수 없는 글자 사유 한 문장(위치 = smsTextPlaces · spamRejectionPlaces · 그 글자는 넣지 않는다 · P4).
 *   제안 사유 · 발송 관문(finalCopyCleared) · 승인 400 · 목록 응답이 같은 말을 쓴다.
 */
export function operatorCharsReason(places: string | null | undefined): string {
  return places
    ? `문자로 보낼 수 없는 글자가 있어 검사하지 못했어요: ${places}. 문안에서 그 글자를 빼 주세요`
    : '문자로 보낼 수 없는 글자가 있어 검사하지 못했어요. 문안에서 그 글자를 빼 주세요';
}

export function decideSpamOutcome(
  finalResult: 'pass' | 'blocked' | 'failed' | 'timeout' | 'unconfirmed' | 'pending' | 'rejected',
  regenerateCount: number,
  /** ★ 2026-11-06 C109 — rejected 일 때 위치 문장 */
  rejectionPlaces?: string | null,
): SpamOutcome {
  // ★ 2026-11-06 C109 E5 — 보낼 수 없는 글자 = 장애도 차단도 아니다(다시 검사로 안 풀린다) · 자동 발송 막고 담당자 검토 · 사유 = 위치
  if (finalResult === 'rejected') {
    return { status: 'admin_review', autoExecuteBlocked: true, reason: operatorCharsReason(rejectionPlaces) };
  }
  if (finalResult === 'unconfirmed' || finalResult === 'pending') {
    return {
      status: 'admin_review',
      autoExecuteBlocked: true,
      hold: true,
      reason: `스팸 검사 결과를 ${SPAM_VERDICT_LABEL[finalResult]}이라 자동 발송을 보류했어요. 제안 상세에서 다시 검사하거나 승인해 주세요`,
    };
  }
  // ★ 2026-11-20 C148 T1(남지현 접수) — 시간 초과 = 검사가 닫힐 때 통신사 결과가 아직 없던 줄 · 늦은 보고가 닫힌 뒤 10분 안에 통과로 고친다
  //   (1120 실측 = 1 ~ 2분 뒤 전부 통과) → 미통과로 굳히지 않고 보류 · 회복 일꾼(recoverHeldProposals)이 다시 읽는다
  if (finalResult === 'timeout') {
    return {
      status: 'admin_review',
      autoExecuteBlocked: true,
      hold: true,
      reason: '스팸 검사 결과가 늦어지고 있어 자동 발송을 보류했어요. 결과가 오면 다시 판단해요. 제안 상세에서 다시 검사하거나 승인할 수도 있어요',
    };
  }
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

export type OperatorSpamFinal = 'pass' | 'blocked' | 'failed' | 'timeout' | 'unconfirmed' | 'pending' | 'rejected';

/**
 * ★ 2026-11-20 C148 T1(설계 Codex 1R #2) — 자동마케팅 회차의 최종 판정(순수 · 옛 continuous-operator.ts 인라인 식을 옮김).
 *   순서 = 통과 > 확인 중 · 검사 중 > 검사한 안 중 하나라도 시간 초과 > 차단 > 반려 > 그 밖(1안 원값 · 통과로 접지 않음).
 *   시간 초과 안은 늦은 보고로 통과할 수 있다 → 막힌 안이 섞여도 보류(옛: 1안 timeout + 2안 blocked = 차단으로 굳어 회복 후보에서 빠졌다).
 */
export function operatorFinalSpamResult(
  tested: ReadonlyArray<{ spamResult?: string | null; carrierResults?: Array<{ result?: string | null }> | null }>,
  passedIndex: number | null,
  totalTestCount: number,
): OperatorSpamFinal {
  if (passedIndex != null) return 'pass';
  const alt = mergeAlternativeVerdicts(tested.map((v) => spamVerdictOf(v as any, totalTestCount)));
  if (isSpamHold(alt)) return alt;
  if (tested.some((v) => v.spamResult === 'timeout')) return 'timeout';
  if (alt === 'blocked' || alt === 'rejected') return alt;
  const first = tested[0]?.spamResult;
  return (first && first !== 'pass' ? first : 'failed') as OperatorSpamFinal;
}

/**
 * ★ 2026-11-20 C148 §7 A — 보류 회차 회복이 다시 읽은 결과로 안별 결과(spamCheck.results[].result)를 새로 쓴다(순수).
 *   옛: 회복이 통과 안 번호 · 지문만 써서, 늦은 보고로 통과해 예약된 안의 카드 칩이 「검사 결과 없음」으로 남았다(T1 접수 화면 절반).
 *   통과 · 차단 · 확인 중 · 검사 중 = 그 값 · 장애(error) = 옛 값 그대로(장애를 통과 · 차단으로 덮지 않는다) · 검사 id 없는 안(반려 · 옛 회차) = 그대로.
 *   결과 배열이 아니면 null(= 쓰지 않는다).
 */
export function refreshHeldResults(results: unknown, read: ReadonlyArray<{ testId: string; outcome: SpamVerdict }>): any[] | null {
  if (!Array.isArray(results)) return null;
  const byTest = new Map(read.map((x) => [String(x.testId), x.outcome]));
  return results.map((r: any) => {
    const o = r && r.testId ? byTest.get(String(r.testId)) : undefined;
    if (o === 'pass' || o === 'blocked' || o === 'unconfirmed' || o === 'pending') return { ...r, result: o };
    return r;
  });
}

/** ★ 2026-10-03 스팸 검사 판정값의 고객 표기(정책 사유 · 화면 안별 결과가 같은 말을 쓴다) */
export const SPAM_VERDICT_LABEL: Record<string, string> = {
  pass: '통과',
  blocked: '차단',
  timeout: '결과를 받지 못함',
  failed: '검사 실패',
  // ★ 2026-11-01 B1-4 — 통신사 전달 성공 + 앱 보고 없음(확인 문자가 가른다) · 같은 글 검사가 아직 진행 중
  unconfirmed: '확인 중',
  pending: '검사 중',
  // ★ 2026-11-06 C109 — 검사 입구 글자 반려
  rejected: '보낼 수 없는 글',   // ★ C143 반려 = 글자 · 길이(사유 문장이 말한다)
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

// ★ 2026-10-25 원장 #29 — resolveRetestCopy(화면 스팸 검사 글을 따로 만들던 함수)를 지웠다 · 검사 글 = 발송 CT(operator-final-copy operatorFinalCopyAt)

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
