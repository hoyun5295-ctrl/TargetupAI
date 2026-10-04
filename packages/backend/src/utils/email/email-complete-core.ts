/**
 * email-complete-core.ts — 메일 캠페인 "완성"(50크레딧) 코어 CT (★ 2026-10-04 플래너 보강 B4 · 설계서 §3-9 · §6-5 6)
 *
 * `POST /api/email/campaigns/:id/complete` 라우트 본문을 **그대로** 옮겼다. 완성의 문이 둘이 됐기 때문이다:
 *   ① 편집기 [완성](라우트)  ② 마케팅 플래너 행사 승인(planner-approve)
 * 이미 완성 판정 · 회사 메일 연결 잠금 · 본문 잠금(채울 자리·링크 결함) · 차감(멱등키 `email-campaign-complete:{id}`)을 이 함수 하나가 소유한다.
 * 잔액 부족(checkCredit)은 던진다(호출부 402). 캠페인 조회(소유 범위)는 호출부가 한다.
 */
import { getCreditCost } from '../ai-credit-calc';
import { checkCredit, deductCreditSafe } from '../ai-credit';
import { isEmailCampaignCompleted } from './email-completion';
import { emailSmtpBlocker, emailContentBlocker } from './email-send-gate';

export type EmailCompleteCoreResult =
  | { ok: true; alreadyCompleted: boolean; cost: number }
  | { ok: false; status: number; code: string; error: string };

/**
 * 완성 잠금 판정(★ 2026-10-04 Codex 1R) — 이미 완성이면 null(낼 것 없음) · 아니면 회사 메일 연결 · 본문 잠금.
 * 돈이 움직이기 전에 같은 판정으로 멈추려고 함수로 뺐다(플래너 승인 사전 확인 · 코어가 같은 함수를 부른다).
 */
export async function emailCompleteBlockOf(
  companyId: string,
  campaign: { id: string; subject?: string | null; htmlBody?: string | null; textBody?: string | null },
): Promise<{ status: number; code: string; error: string } | null> {
  if (await isEmailCampaignCompleted(companyId, campaign.id)) return null;
  const b = (await emailSmtpBlocker(companyId)) || emailContentBlocker(campaign);
  return b ? { status: b.status, code: b.code, error: b.error } : null;
}

export async function completeEmailCampaignCore(input: {
  companyId: string;
  userId: string | null;
  campaign: { id: string; subject?: string | null; htmlBody?: string | null; textBody?: string | null };
}): Promise<EmailCompleteCoreResult> {
  const { companyId, campaign } = input;
  if (await isEmailCampaignCompleted(companyId, campaign.id)) {
    return { ok: true, alreadyCompleted: true, cost: 0 };
  }
  // ★ 2026-09-27 만들기 개편 S4 — 50 을 내기 **전에** 막는다(옛: 완성은 통과하고 발송에서야 막혀 돈만 나갔다).
  const completeBlock = (await emailSmtpBlocker(companyId)) || emailContentBlocker(campaign);
  if (completeBlock) return { ok: false, status: completeBlock.status, code: completeBlock.code, error: completeBlock.error };

  const cost = getCreditCost('email-campaign-complete'); // 50
  await checkCredit(companyId, cost);
  await deductCreditSafe({
    companyId, cost, source: 'email-campaign-complete',
    createdBy: input.userId, idempotencyKey: `email-campaign-complete:${campaign.id}`,
  });
  return { ok: true, alreadyCompleted: false, cost };
}
