/**
 * utils/ai-credit-calc.ts — AI 크레딧 차감 순수 계산 (DB/IO 의존 0)
 *
 * 종량제 토대 (D227+ 2026-05-31). CT인 ai-credit.ts가 import해서 사용한다.
 * 여기에는 DB·시간 부수효과를 두지 않는다 — 모든 함수는 입력만으로 결과가 정해진다.
 * 그래서 node:assert + ts-node 로 단위 검증할 수 있다 (테스트 러너 미설치 프로젝트 대응).
 */

/** KST(UTC+9) 기준 연*12+월 절대값. 월 비교 전용 (0-indexed month). */
export function kstYearMonth(d: Date): number {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCFullYear() * 12 + kst.getUTCMonth();
}

/** KST 기준 'YYYYMM' 태그. 월 리셋 idempotency key 용도. */
export function kstMonthTag(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/**
 * 월 리셋 필요 판단.
 *  - resetAt 없음(최초 가입/미설정) → true
 *  - resetAt의 KST 월 < now의 KST 월 → true
 */
export function needsMonthlyReset(resetAt: Date | null, now: Date): boolean {
  if (!resetAt) return true;
  return kstYearMonth(resetAt) < kstYearMonth(now);
}

/**
 * 2버킷 분배 — base(월 기본분) 먼저, 부족분을 purchased(구매분)에서.
 * 그래도 모자라면 shortfall(부족분)으로 반환 (호출측이 차단/충전 처리).
 * 음수·소수 입력은 0 이상 정수로 방어 보정한다.
 */
export function splitDeduction(
  base: number,
  purchased: number,
  cost: number
): { fromBase: number; fromPurchased: number; shortfall: number } {
  const b = Math.max(0, Math.floor(base || 0));
  const p = Math.max(0, Math.floor(purchased || 0));
  const c = Math.max(0, Math.floor(cost || 0));
  const fromBase = Math.min(b, c);
  const afterBase = c - fromBase;
  const fromPurchased = Math.min(p, afterBase);
  const shortfall = afterBase - fromPurchased;
  return { fromBase, fromPurchased, shortfall };
}

/**
 * idempotency key — 같은 AI 호출의 재시도가 중복 차감되지 않도록 한다.
 *  - aiCallLogId 있으면 `${source}:${aiCallLogId}` (최대 150자)
 *  - 없으면 null (중복 차단 미적용 — 호출측이 별도 key를 부여할 수 있음)
 */
export function buildIdempotencyKey(source: string, aiCallLogId?: string | null): string | null {
  if (!aiCallLogId) return null;
  return `${source}:${aiCallLogId}`.slice(0, 150);
}

/**
 * 작업 source → 크레딧 비용 (handoff §4 지도 + 실측 source 문자열 기준).
 *  - 풀분석 10 / 생성 3 / 다듬기·분석 2 / 질문·매핑 1.
 *  - orchestrate sub-agent 내부 호출은 호출측이 creditCost:0을 명시(묶음 회피) → 여기 단가는 진입점 1회용.
 *  - 미등록 source는 getCreditCost가 0 반환(차감 안 함) — 신규 작업 추가 시 여기 등록 의무.
 */
export const CREDIT_COST_MAP: Record<string, number> = {
  // 풀분석 (20) — 타겟+문안+검수+성과 종합 (orchestrate 진입점 1회, sub는 묶음 0)
  'orchestrate': 20,
  'orchestrateWithAI': 20,
  // 여정 (10) — 다단계 캠페인 자동화 설계
  'journey-ai-generate': 10,
  'journey-builder-custom': 10,
  // 모바일 DM 묶음 (5) — parse+copy+tone+improve 여러 호출 1작업
  'dm-builder': 5,
  // 생성 (3) — inapp·CDP 단일 콘텐츠
  'inapp-ai-generator': 3,
  'inapp-quick-action': 3,
  // 문안 생성·분석·추천 (2)
  'generate-messages': 2,
  'generate-custom-messages': 2,
  'recommend-target': 2,
  'recommend-next-campaign': 2,
  'variant-generator': 2,
  'performance-explainer': 2,
  'performance-quick-action': 2,
  'next-action-advisor': 2,
  'multi-goal-decisioning': 2,
  'cdp-fusion-explainer': 2,
  'voice-inbound': 2,
  'dm-event-recommender': 2,
  // 다듬기·진단·질문·매핑 (1) — 스팸필터는 크레딧 비대상(현금/후불 청구)
  'journey-ai-refine': 1,
  'journey-step-diagnosis': 1,
  'dm-quick-action-refine': 1,
  'dm-self-diagnosis': 1,
  'inapp-explainer': 1,
  'alimtalk-matcher': 1,
  'ai-memory-search': 1,
  'ai-usage-search': 1,
  'ai-segment-generator': 1,
  'ai-column-mapper': 1,
  'brand-voice-extract': 1,
  'parse-briefing': 1,
};

/** source → 크레딧 비용. 미등록·미전달 source는 0 (차감 안 함). */
export function getCreditCost(source: string | undefined | null): number {
  if (!source) return 0;
  return CREDIT_COST_MAP[source] ?? 0;
}

/** 이번달 사용량 = type 'deduct' 행의 amount 합 (순수). reset/grant/admin_deduct는 제외. */
export function sumDeductRows(rows: Array<{ type: string; amount: number | string }>): number {
  return rows.reduce((sum, r) => sum + (r.type === 'deduct' ? (Number(r.amount) || 0) : 0), 0);
}
