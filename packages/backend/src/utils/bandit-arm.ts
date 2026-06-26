/**
 * bandit-arm.ts — Bandit Beta(α, β) 도출 순수 로직 (DB 미import → 순수 테스트)
 *
 * ★ Phase2 A (2026-06-26): 보상 누적 단일 진실 = 실측 count 컬럼(sent_count/click_count).
 *   기존 구조: arm_alpha/arm_beta(bandit_alpha/bandit_beta)를 증분 갱신했으나, 클릭/전환 호출부가
 *   sent=0으로 호출 → `if (sent<=0) return` 가드에 막혀 α가 실측 클릭으로 안 오르고
 *   발송마다 β만 누적 → 모든 변이가 동등 하락(학습 사실상 정지). (operator·journey 공통 버그)
 *
 *   정정: 변이 성과는 sent_count/click_count로만 적재하고, 선택·통계 때 여기서 α/β를 도출한다.
 *   - α = 1 + clicks (성공 = 실측 클릭, prior 1)
 *   - β = 1 + max(0, sent − clicks) (실패 = 미클릭 발송, prior 1)
 *   클릭 ≤ 발송이면 α+β−2 == sent (Bernoulli trials = 발송). 임의 상수 0(전부 +1 prior + 실측 count).
 *   conversion_count는 별도 지표로 노출(클릭보다 희소 + 임의 가중치 회피 → 핵심 α/β엔 미반영).
 */

export interface BanditArm {
  alpha: number;
  beta: number;
}

export function deriveBanditArm(sentCount: number, clickCount: number): BanditArm {
  const sent = Math.max(0, Math.floor(Number(sentCount)) || 0);
  const clicks = Math.max(0, Math.floor(Number(clickCount)) || 0);
  return {
    alpha: 1 + clicks,
    beta: 1 + Math.max(0, sent - clicks),
  };
}
