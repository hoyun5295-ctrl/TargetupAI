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
 * ⛔ 미적용 판정 = 크레딧 CT `creditApplies` 하나(차감의 not_applicable 과 같은 함수 · ★ 2026-11-01 §16-1 F18).
 *    둘이 갈리면 "차감은 건너뛰었는데 완성은 아님" 교착이 다시 생긴다.
 * ⛔ 원장은 크레딧 CT 로만 묻는다(★ 2026-11-01 §16-1 F7 · 뿌리 R39).
 *
 * 소비처 = routes/email.ts `/complete` · `/send` · `/test-send` · `/export-html` · 목록 `completed` 플래그.
 */
import { pool } from '../../config/database';
import { loadCreditRow } from '../ai-credit-tx';
import { creditApplies } from '../ai-credit-calc';
import { chargedKeysAmong } from '../ai-credit';
import { ledgerKeysWithPrefixes } from '../ai-credit-ledger';

/** 완성 원장 멱등키(신·구 둘 다 인정 = 이중과금 0) */
export function emailCompletionKeysOf(campaignId: string): string[] {
  return [`email-campaign-complete:${campaignId}`, `email-ai-publish:${campaignId}`];
}

/** 크레딧제 미적용 회사인가 — 크레딧 CT `creditApplies` 의 반대(행 없음 = 미적용 · 순수). */
export function isCreditNotApplicableRow(row: { plan_credits?: unknown; purchased?: unknown } | null | undefined): boolean {
  return !creditApplies(row);
}

export type EmailCompletionDeps = {
  hasCompletionRow: (companyId: string, campaignId: string) => Promise<boolean>;
  loadCreditRow: (companyId: string) => Promise<any | null>;
};

export const defaultEmailCompletionDeps: EmailCompletionDeps = {
  hasCompletionRow: async (companyId, campaignId) => (await chargedKeysAmong(companyId, emailCompletionKeysOf(campaignId))).size > 0,
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
export async function emailCompletionContextOf(
  companyId: string,
  /** ★ 2026-09-28 한줄로 V2 R122 — 목록에 실린 캠페인 id. 주면 그 캠페인의 키만 정확히 찾는다(옛: 회사 크레딧 거래 전체를 LIKE 로 훑음). */
  campaignIds?: readonly string[],
): Promise<{ notApplicable: boolean; paidIds: Set<string> }> {
  const notApplicable = isCreditNotApplicableRow(await loadCreditRow(pool, companyId, false));
  // 크레딧제 미적용이면 전부 완성 — 키를 볼 필요가 없다.
  if (notApplicable) return { notApplicable, paidIds: new Set<string>() };
  const keys: string[] = campaignIds
    ? [...(await chargedKeysAmong(companyId, campaignIds.flatMap((id) => emailCompletionKeysOf(id))))]
    : await ledgerKeysWithPrefixes(pool, companyId, ['email-campaign-complete:', 'email-ai-publish:']);
  const paidIds = new Set<string>(keys.map((k) => String(k || '').split(':')[1]).filter(Boolean));
  return { notApplicable, paidIds };
}
