/**
 * email-completion.ts — 이메일 캠페인 "완성" 판정 CT (★ 2026-09-27 만들기 개편 S2)
 *
 * 완성 = 완성 크레딧(50) 멱등 원장 행(`email-campaign-complete:{id}` · 옛 `email-ai-publish:{id}`)이 있는가.
 * 여기에 **크레딧제 미적용 회사는 완성으로 본다**를 더했다.
 *
 * 왜: 미적용 회사(요금제 크레딧 미설정 + 구매분 0)는 차감이 원장 행 없이 끝난다(`ai-credit-tx` not_applicable).
 *     옛 판정은 원장 행만 봐서, 그 회사는 [완성 저장]을 몇 번 눌러도 발송이 영구히 400(CAMPAIGN_NOT_COMPLETED)이었다.
 *     DM 발송(`send-to-target`)은 같은 경우를 `creditEnabled`로 이미 거르고 있었다 — 이메일만 빠져 있었다.
 *
 * ⛔ 조회 실패는 삼키지 않는다(throw = 라우트 500). 실패를 "완성"으로 접으면 돈을 안 낸 캠페인이 나간다(fail-closed).
 * ⛔ 미적용 판정은 `ai-credit-tx`의 not_applicable 과 **같은 식**이어야 한다: plan_credits == null && purchased == 0.
 *    둘이 갈리면 "차감은 건너뛰었는데 완성은 아님" 교착이 다시 생긴다.
 *
 * 소비처 = routes/email.ts `/complete` · `/send` · `/test-send` · `/export-html` · 목록 `completed` 플래그.
 */
import { query, pool } from '../../config/database';
import { loadCreditRow } from '../ai-credit-tx';

/** 완성 원장 멱등키(신·구 둘 다 인정 = 이중과금 0) */
export function emailCompletionKeysOf(campaignId: string): string[] {
  return [`email-campaign-complete:${campaignId}`, `email-ai-publish:${campaignId}`];
}

/** 크레딧제 미적용 회사인가 — `ai-credit-tx` not_applicable · no_credit_row 와 같은 판정(순수). */
export function isCreditNotApplicableRow(row: { plan_credits?: unknown; purchased?: unknown } | null | undefined): boolean {
  if (!row) return true;
  return row.plan_credits == null && (Number(row.purchased) || 0) === 0;
}

export type EmailCompletionDeps = {
  hasCompletionRow: (companyId: string, campaignId: string) => Promise<boolean>;
  loadCreditRow: (companyId: string) => Promise<any | null>;
};

export const defaultEmailCompletionDeps: EmailCompletionDeps = {
  hasCompletionRow: async (companyId, campaignId) => {
    const r = await query(
      `SELECT 1 FROM ai_credit_transactions
        WHERE company_id = $1::uuid AND idempotency_key = ANY($2)
        LIMIT 1`,
      [companyId, emailCompletionKeysOf(campaignId)],
    );
    return r.rows.length > 0;
  },
  loadCreditRow: (companyId) => loadCreditRow(pool, companyId, false),
};

/** 한 캠페인의 완성 여부 — 원장 행 또는 크레딧제 미적용. 조회 실패 = throw. */
export async function isEmailCampaignCompleted(
  companyId: string,
  campaignId: string,
  deps: EmailCompletionDeps = defaultEmailCompletionDeps,
): Promise<boolean> {
  if (await deps.hasCompletionRow(companyId, campaignId)) return true;
  return isCreditNotApplicableRow(await deps.loadCreditRow(companyId));
}

/**
 * 목록용 — 회사 한 번 조회로 캠페인 여러 개의 완성 여부를 판정할 재료.
 * `notApplicable` 이 참이면 전부 완성, 아니면 `paidIds`에 있는 것만 완성.
 */
export async function emailCompletionContextOf(companyId: string): Promise<{ notApplicable: boolean; paidIds: Set<string> }> {
  const keysRes = await query(
    `SELECT idempotency_key FROM ai_credit_transactions
      WHERE company_id = $1::uuid
        AND (idempotency_key LIKE 'email-campaign-complete:%' OR idempotency_key LIKE 'email-ai-publish:%')`,
    [companyId],
  );
  const paidIds = new Set<string>(
    keysRes.rows.map((r: any) => String(r.idempotency_key || '').split(':')[1]).filter(Boolean),
  );
  const notApplicable = isCreditNotApplicableRow(await loadCreditRow(pool, companyId, false));
  return { notApplicable, paidIds };
}
