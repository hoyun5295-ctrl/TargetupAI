/**
 * journey-credit-copy.ts — 여정 크레딧 고객 문장 한 벌(★ 2026-10-20 여정 V.3 §5-3)
 *
 * 켜기 창 · 작업 화면 · 다시 켜기 · 지도 요약이 이 문장만 쓴다(같은 사실을 화면마다 다르게 말하지 않게).
 * ⛔ 숫자는 서버 응답(지도 costs · 상세 activation_cost)에서 받는다. 여기서 단가를 적지 않는다.
 * ⛔ 줄표 · 모델명 · 내부어 0.
 */

export const creditFirstActivation = (activate: number) => `여정 하나를 처음 켤 때 ${activate.toLocaleString('ko-KR')}크레딧, 한 번뿐이에요.`;

export const CREDIT_EDIT_FREE = '고치기 · 멈췄다 다시 켜기는 0크레딧이에요.';

export const creditOperation = (operation: number) =>
  `켜진 동안 문자를 보낸 날만 여정 하나당 ${operation.toLocaleString('ko-KR')}크레딧이에요. 30일이면 최대 ${(operation * 30).toLocaleString('ko-KR')}크레딧이에요.`;

export const CREDIT_RUN_OUT = '이번 달 크레딧이 모자라면 켜 둔 여정이 멈춰요. 여정을 많이 돌리시면 요금제를 올려 주세요.';

/** 다시 켜기 한 단계 한 줄(§6-7) — 멈춘 동안 생긴 사건은 받지 않는다(서버 다시 켜기 보정과 같은 사실). */
export const resumeLine = (operation: number) =>
  `다시 켜면 문자를 보낸 날마다 ${operation.toLocaleString('ko-KR')}크레딧이에요. 멈춘 동안 생긴 가입 · 구매는 받지 않아요.`;

export const RESUME_CREDIT_SHORT = '크레딧을 채우기 전에 켜면 다시 멈춰요.';
