/**
 * 광고 갈래 이름 · 기본 순서 — 화면 사본(★ 2026-11-06 C110).
 * 원본 = backend/src/utils/ad-send-gate-core.ts AD_BRANCHES · AD_BRANCH_LABEL(대조 시험 c110-contract-1106 이 같은지 본다).
 */
export const AD_BRANCHES = ['journey', 'planner', 'agency', 'automarketing', 'ai', 'dm', 'direct'] as const;
export type AdBranch = (typeof AD_BRANCHES)[number];

export const AD_BRANCH_LABEL: Record<AdBranch, string> = {
  journey: '여정',
  planner: '마케팅 플래너',
  agency: '대행 발송',
  automarketing: '자동 마케팅',
  ai: 'AI 캠페인',
  dm: 'DM 발송',
  direct: '직접 발송',
};
