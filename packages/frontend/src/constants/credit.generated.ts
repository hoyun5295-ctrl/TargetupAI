// 자동 생성 — 손으로 고치지 않는다. 원본 = 백엔드 크레딧 CT packages/backend/src/utils/ai-credit-calc.ts
// 다시 만들기 = packages/backend 에서 `npx ts-node scripts/gen-credit-constants.ts` · 시험(credit-constants-generated.test.ts)이 다시 만든 글자와 대조한다.

/** 원천 → 작업당 크레딧(백엔드 CREDIT_COST_MAP) */
export const CREDIT_COSTS: Readonly<Record<string, number>> = {
  'ai-column-mapper': 1,
  'ai-line-compose': 2,
  'ai-line-decorate': 1,
  'ai-line-intake': 2,
  'ai-memory-search': 1,
  'ai-operator-decorate': 3,
  'ai-operator-explain': 5,
  'ai-operator-propose': 5,
  'ai-segment-generator': 1,
  'ai-usage-search': 1,
  'alimtalk-matcher': 1,
  'brand-voice-extract': 1,
  'catalog-dm-build': 10,
  'cdp-fusion-explainer': 5,
  'continuous-operator': 200,
  'continuous-operator-send': 10,
  'dm-ai-generate': 5,
  'dm-builder': 100,
  'dm-copy-generate': 3,
  'dm-custom-short-link': 20,
  'dm-interaction-publish': 120,
  'dm-quick-action-refine': 1,
  'email-ai-generate': 3,
  'email-ai-publish': 50,
  'email-campaign-complete': 50,
  'email-performance-insight': 5,
  'email-precheck': 1,
  'email-refine': 1,
  'event-image-extract': 3,
  'generate-messages': 5,
  'image-studio-4k': 2,
  'image-studio-edit': 1,
  'image-studio-generate': 2,
  'inapp-ai-generator': 3,
  'inapp-explainer': 1,
  'inapp-publish': 100,
  'inapp-quick-action': 1,
  'journey-activate': 200,
  'journey-ai-generate': 3,
  'journey-ai-refine': 1,
  'journey-builder-custom': 3,
  'journey-operation': 10,
  'journey-step-diagnosis': 1,
  'marketing-calendar': 50,
  'marketing-calendar-month': 10,
  'multi-goal-decisioning': 5,
  'oneline-complete': 13,
  'oneline-judge': 2,
  'oneline-recook': 3,
  'orchestrate': 300,
  'orchestrateWithAI': 300,
  'parse-briefing': 1,
  'performance-explainer': 5,
  'performance-quick-action': 5,
  'planner-monthly-agency': 1000,
  'planner-touchpoint-send': 10,
  'predictive-daily': 3,
  'recommend-target': 5,
  'refine-direct': 1,
  'variant-generator': 5,
};

export const CREDIT_UNIT_PRICE = 500;
export const CREDIT_VAT_RATE = 0.1;
export const CREDIT_TX_TYPES: readonly string[] = ['reset', 'expire', 'trial_credit', 'plan_prorate', 'deduct', 'refund', 'grant', 'purchase', 'postpaid_grant', 'admin_deduct'];

export function dailyDbAnalysisCredits(customerCount: number): number {
  const n = Math.max(0, Math.floor(Number(customerCount) || 0));
  if (n === 0) return 0;
  const blocks = Math.ceil(n / 100000);
  return Math.round(3 + (blocks - 1) * 1.5);
}

export function calcRechargeAmount(credits: number): { credits: number; supply: number; vat: number; total: number } {
  const c = Math.max(0, Math.floor(Number(credits) || 0));
  const supply = c * CREDIT_UNIT_PRICE;
  const vat = Math.round(supply * CREDIT_VAT_RATE);
  return { credits: c, supply, vat, total: supply + vat };
}

export function creditTxDelta(
  tx: { type: string; amount: number | string; overage_credits?: number | string | null },
): { bucket: 'base' | 'purchased' | 'split'; delta: number } | null {
  const amount = Number(tx.amount) || 0;
  switch (tx.type) {
    case 'reset': case 'trial_credit': return { bucket: 'base', delta: amount };
    case 'expire': case 'plan_prorate': return { bucket: 'base', delta: amount };   // 부호 있는 amount
    case 'grant': case 'purchase': case 'postpaid_grant': return { bucket: 'purchased', delta: amount };
    case 'admin_deduct': return { bucket: 'purchased', delta: 0 - amount };   // 0 - x: amount 0 이면 -0 이 아니라 0
    case 'deduct': return { bucket: 'split', delta: 0 - amount };
    case 'refund': return { bucket: 'split', delta: amount - (Number(tx.overage_credits) || 0) };
    default: return null;
  }
}
