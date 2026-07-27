/**
 * agentLabel.ts — 에이전트 발송ID 표시 라벨 단일 규칙 (프론트 CT, ★ 2026-07-27)
 *
 * Harold 지시: "PAY에 저장된 고객사명(발급명)을 그대로 모든 곳에서 통일되게 보이게 하라."
 *
 * 이름의 단일 소스 = 게이트웨이 원장 `RSRM_SalesMst.CustNm`(발급명). 백엔드가 `cust_name`/`custName`으로 내려준다.
 * 우리 DB에 별도 표시명 컬럼을 두지 않는다 — 두는 순간 이름이 둘로 갈려 지금 증상이 그대로 재현된다.
 *
 * 회사명으로 대체하지 않는 이유: 한 회사가 발송ID를 여럿 갖는 게 기본이라
 * (런소프트 = C0130 런소프트3 · D0078 런소프트 · D0079 런소프트2)
 * 회사명 폴백은 세 줄이 전부 "런소프트"로 보이는 바로 그 문제를 만든다.
 *
 * ⚠ 백엔드 `utils/pay-stats.ts formatAgentIdLabel`과 **같은 규칙의 미러**다. 한쪽만 바꾸지 말 것.
 */

/**
 * `C0130 / 런소프트3` — 발급명이 없으면 발송ID만.
 * 발송통계 표(AdminDashboard·StatsTab)는 같은 `/` 규칙을 쓰되 발급명을 흐린 span으로 병기하고
 * 부달 재전송 뱃지를 함께 그리는 JSX 변형이다(문자열 조합이 아니라 그쪽은 이 함수를 쓰지 않는다).
 */
export function formatAgentIdLabel(sendId: string | null | undefined, custName?: string | null): string {
  const id = String(sendId ?? '').trim();
  const nm = String(custName ?? '').trim();
  if (!id) return nm;
  return nm ? `${id} / ${nm}` : id;
}

/**
 * 게이트웨이 잔액 표시 — 소수까지 그대로, 원 미만 둘째 자리에서 **버림**.
 *
 * ★ 2026-07-27 (Codex 1R-P2 정정) 원장 잔액은 소수를 갖는다(실측 640,281.625 · 4,881,227.5).
 * `Math.floor`로 정수화하면 `0.625원`이 **0원**으로 보여 "잔액 없음"으로 오독되고,
 * 음수는 `-0.125` → `-1`처럼 실제보다 커진다. 잔액은 충전 판단의 근거라 그 오독이 곧 불필요한 충전이다.
 *
 * 반올림이 아니라 버림인 이유: 표시가 실제 잔액을 넘지 않게 한다(과대 표시 편향 차단).
 * 부동소수 오차(`0.1+0.2`류)는 정수화 단계에서 걷어낸다.
 */
export function formatAgentBalance(v: number): string {
  const floored = Math.floor(Math.round(v * 1e4) / 100) / 100;
  return floored.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}
