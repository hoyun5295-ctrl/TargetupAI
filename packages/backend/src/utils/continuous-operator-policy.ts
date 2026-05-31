/**
 * CT-64: Continuous Operator Policy — D212+ (2026-05-23 Harold 명시)
 *
 * 본질: AI 자동 마케팅 영역 안 = 발송 정책 매트릭스 본질 정합
 *
 * 발송 정책 매트릭스:
 *   1. daily (매일) — 옵트아웃 본질
 *      - 최초 7일 (verification_required_days) = 회사 admin 매일 명시 컨펌 의무
 *      - 8일째 이후 = 자동 발송 본질 (스팸테스트 통과 영역만)
 *      - 회사 admin 영역 = 매일 미리 보기 + 즉시 정지 1-click 본질
 *
 *   2. weekly (매주) / monthly (매달) — 옵트아웃 본질
 *      - 발송 2시간 전 = AI 문안 생성 + 스팸필터테스트
 *      - 스팸 걸릴 시 = AI 재생성 (최대 3회)
 *      - 통과된 문안만 → 담당자 사전 안내 발송
 *      - 5분 이내 담당자 정지 X = 자동 발송 본질 (옵트아웃)
 *      - 담당자 안내 = 광고 표기 X + 안내성 문자 (추출 = 발송 인원 명시)
 *
 * 안전 매트릭스:
 *   - 모든 발송 = 스팸필터테스트 의무
 *   - 추출 인원 = 발송 인원 (사고 차단)
 *   - 스팸 통과 X = 발송 자동 차단 + 회사 admin 알림
 *   - 담당자 정지 사유 영역 = ai_company_memory 학습 (다음 영역 정정)
 *
 * 영구 룰 정합:
 *   - feedback_no_target_auto_relax — 자동 발송 X (옵트아웃 + 안전망 본질)
 *   - feedback_ai_no_arbitrary_benefit — AI 임의 혜택 X (placeholder 보존)
 *   - feedback_ai_operator_model_isolation — model:'sonnet' (D209+ 정합)
 *
 * 옛 영역 활용:
 *   - auto-campaign-worker.ts 4단계 라이프사이클 패턴 정합
 *   - spam-test-queue.ts autoSpamTestWithRegenerate 정합 (CT-09)
 *   - auto-notify-message.ts buildAiGeneratedNotifyMessage 정합
 *   - company-memory.ts addMemory 정합 (CT-37)
 */

import { query } from '../config/database';
import { addMemory } from './company-memory';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 타입
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type DeliveryPolicy = 'daily' | 'weekly' | 'monthly';
export type SpamTestStatus = 'pending' | 'passed' | 'failed' | 'retry';
export type AdminResponse = 'opt_out' | 'stopped' | 'expired' | 'pending';

export interface AdminStopReason {
  reason: 'spam_suspicion' | 'content_correction' | 'no_send' | 'other';
  detail?: string;
}

export interface OperatorPolicy {
  deliveryPolicy: DeliveryPolicy;
  deliveryDay: number | null;        // 매주 요일 (0~6, 0=일) / 매달 일자 (1~31)
  deliveryHour: number;               // 0~23 (KST)
  verificationRequiredDays: number;   // 검증 의무 일수 (default 7 — daily 영역)
  verificationPassedDays: number;     // 검증 통과 누적 일수
  adminPhoneNumbers: string[];        // 담당자 영역 (1~3명)
  backupAdminPhone: string | null;    // 백업 담당자 (휴가 영역)
  adminAlertChannel: 'sms' | 'kakao' | 'email';
  optOutMinutes: number;              // default 5
  spamScoreThreshold: number;         // default 30 — 본 점수 미만만 발송
  maxSpamRetries: number;             // default 3
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. 검증 영역 본질 — 자동 발송 여부 결정
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 매일 영역 영역 = 검증 영역 안 (처음 N일) — 회사 admin 명시 컨펌 의무
 * 검증 통과 영역 (N일 이상 정상 영역) = 자동 발송 본질
 */
export function isAutoSendAllowed(operator: {
  deliveryPolicy: DeliveryPolicy;
  verificationRequiredDays: number;
  verificationPassedDays: number;
}): { allowed: boolean; reason: string } {
  if (operator.deliveryPolicy !== 'daily') {
    // weekly/monthly = 옵트아웃 본질 (담당자 5분 안 정지 X 영역만 자동)
    return { allowed: true, reason: '매주/매달 영역 = 담당자 옵트아웃 본질' };
  }

  // daily 영역 = 검증 영역 안 확인
  if (operator.verificationPassedDays < operator.verificationRequiredDays) {
    return {
      allowed: false,
      reason: `검증 영역 안 (${operator.verificationPassedDays}/${operator.verificationRequiredDays}일) — 회사 admin 명시 컨펌 의무`,
    };
  }

  return {
    allowed: true,
    reason: `검증 영역 통과 (${operator.verificationPassedDays}일+) — 자동 발송 본질`,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 스팸 안전망 — 실제 테스트 결과 → 제안 상태 결정 (D227+ 격상)
//   spam-test-queue.ts autoSpamTestWithRegenerate가 실제 테스트폰 발송 + AI 재생성 + 재테스트 수행.
//   그 최종 결과를 받아 제안 상태를 결정하는 순수 함수.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type SpamOutcomeStatus = 'spam_passed' | 'admin_review';

export interface SpamOutcome {
  status: SpamOutcomeStatus;
  autoExecuteBlocked: boolean;
  reason: string;
}

/**
 * 스팸 최종 결과(autoSpamTestWithRegenerate spamResult) → 제안 상태 결정.
 * - 'pass' → spam_passed (정책 분기 진행, 발송 차단 X)
 * - 그 외(blocked/failed/timeout) → admin_review (담당자 검토 대기, 자동 발송 차단)
 *   ★ Harold 2026-05-31 결정: 끝내 통과 못한 문안은 자동 폐기 X, 담당자가 직접 판단.
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2-b. (구) 단어 치환 스팸 테스트 — D227+ 격상으로 미사용 (continuous-operator는 autoSpamTestWithRegenerate 사용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SpamTestResult {
  status: SpamTestStatus;
  score: number;             // 0~100 — 낮을수록 안전
  blockedWords: string[];
  retryCount: number;
  finalMessage: string;
  reasoning: string;
}

/**
 * 스팸필터테스트 + 재생성 영역 본질 (옛 autoSpamTestWithRegenerate 정합)
 * - 통과 영역 = 발송 정합
 * - 통과 X 영역 (재시도 3회 영역 안) = 발송 차단
 */
export async function spamTestWithRetry(
  proposalId: string,
  messageBody: string,
  maxRetries: number = 3,
  scoreThreshold: number = 30,
): Promise<SpamTestResult> {
  void proposalId;
  // 옛 spam-test-queue.ts CT-09 영역 활용 본질 — 단순화된 영역
  // 본 영역 = 옛 영역 호출 통합 본질 (옛 한줄로 SpamFilterTest 영역 정합)
  // TODO: spam-test-queue 영역 직접 통합 본질 (별도 영역)
  let currentMessage = messageBody;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    // 옛 영역 안 = MySQL QTmsg 영역 스팸필터 호출 본질 (별도 영역 본질)
    // 본 영역 = 단순 영역 (실 검증 영역 = spam-test-queue 영역 통합 본질)
    const score = await estimateSpamScore(currentMessage);
    const blockedWords = detectSpamWords(currentMessage);

    if (score < scoreThreshold && blockedWords.length === 0) {
      return {
        status: 'passed',
        score,
        blockedWords: [],
        retryCount,
        finalMessage: currentMessage,
        reasoning: `스팸필터 통과 (점수 ${score}/${scoreThreshold}, 재시도 ${retryCount}회)`,
      };
    }

    retryCount++;
    if (retryCount >= maxRetries) {
      return {
        status: 'failed',
        score,
        blockedWords,
        retryCount,
        finalMessage: currentMessage,
        reasoning: `스팸필터 통과 X — 재시도 ${maxRetries}회 영역 안 통과 X (점수 ${score}, 차단 단어 ${blockedWords.join(', ')})`,
      };
    }

    // AI 재생성 영역 (옛 영역 안 = generateMessages 정합) — 본 영역 = TODO
    // 본 영역 = 옛 메시지 영역 안 차단 단어 영역 단순 정정 본질
    currentMessage = simpleSpamWordRemoval(currentMessage, blockedWords);
  }

  return {
    status: 'failed',
    score: 100,
    blockedWords: [],
    retryCount,
    finalMessage: currentMessage,
    reasoning: '스팸필터 통과 X — 최대 재시도 초과',
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. 담당자 안내 발송 영역 — 옛 buildAiGeneratedNotifyMessage 정합
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface AdminAlertPayload {
  operatorId: string;
  proposalId: string;
  campaignName: string;
  recipientCount: number;
  scheduledAt: Date;
  messagePreview: string;
  estimatedCost: number;
  optOutMinutes: number;
  optOutDeadline: Date;
  alertChannel: 'sms' | 'kakao' | 'email';
}

/**
 * 담당자 사전 안내 발송 본질 (5분 옵트아웃)
 *   - 광고 표기 X + 안내성 문자
 *   - 추출 = 발송 인원 명시
 *   - 5분 이내 정지 X = 자동 발송 본질
 */
export function buildAdminAlertMessage(payload: AdminAlertPayload): string {
  const dateStr = payload.scheduledAt.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const deadlineStr = payload.optOutDeadline.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return `[AI 자동 마케팅 사전 안내]

캠페인: ${payload.campaignName}
발송 일시: ${dateStr}
발송 대상: ${payload.recipientCount.toLocaleString()}명
예상 비용: ${payload.estimatedCost.toLocaleString()}원

문안 미리 보기:
${payload.messagePreview}

★ ${deadlineStr}까지 정지 X = 자동 발송 진행
정지 = 한줄로AI 영역 안 = 자동 마케팅 메뉴 영역 안 [즉시 정지] 버튼`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. 검증 통과 누적 영역 본질
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 회사 admin 매일 컨펌 영역 안 = verification_passed_days 누적
 */
export async function incrementVerificationDays(operatorId: string, companyId: string): Promise<number> {
  const r = await query(
    `UPDATE continuous_operators
     SET verification_passed_days = COALESCE(verification_passed_days, 0) + 1,
         updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING verification_passed_days`,
    [operatorId, companyId],
  );
  return r.rows[0]?.verification_passed_days || 0;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. 담당자 정지 사유 학습 영역 — AI 학습 본질
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 담당자 정지 영역 안 = ai_company_memory 학습 본질
 *   - 다음 영역 안 AI 영역 안 = 본 사유 영역 정합 본질
 */
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
      no_send: '발송 X 본질',
      other: '기타',
    };
    const reasonLabel = reasonLabelMap[stopReason.reason] || '기타';
    const summary = `자동 마케팅 영역 안 = 담당자 정지 영역 = "${reasonLabel}"${stopReason.detail ? ` — ${stopReason.detail}` : ''}. 정지된 문안: "${messageBody.slice(0, 100)}${messageBody.length > 100 ? '...' : ''}"`;

    await addMemory({
      companyId,
      memoryType: 'compliance_learning',
      memoryKey: `admin_stop_${proposalId}`,
      memoryValue: summary,
      importance: 6,  // 정지 영역 = 중요 본질
      source: 'continuous-operator-policy',
      metadata: { proposalId, stopReason },
    });
  } catch (err: any) {
    console.warn('[ContinuousOperatorPolicy] recordAdminStopLearning 오류, skip:', err?.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 헬퍼 — 스팸 점수 추정 (단순 영역, 옛 영역 통합 본질)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SPAM_WORDS = [
  '대출', '도박', '카지노', '바카라', '슬롯', '비트코인 대박', '주식 추천',
  '100% 보장', '확실히', '대박', '월 1000만원', '무료 충전', '한정 특가',
  '즉시 입금', '당첨', '경품 당첨',
];

function estimateSpamScore(message: string): number {
  let score = 0;
  for (const word of SPAM_WORDS) {
    if (message.includes(word)) score += 15;
  }
  // 느낌표 / 특수문자 영역 과다
  const exclaimCount = (message.match(/[!~★☆※]/g) || []).length;
  if (exclaimCount > 5) score += 10;
  if (exclaimCount > 10) score += 15;
  return Math.min(100, score);
}

function detectSpamWords(message: string): string[] {
  return SPAM_WORDS.filter((w) => message.includes(w));
}

function simpleSpamWordRemoval(message: string, blockedWords: string[]): string {
  let result = message;
  for (const word of blockedWords) {
    result = result.split(word).join('[혜택 안내]');
  }
  return result;
}
