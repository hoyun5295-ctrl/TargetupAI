// ===========================================================================
// utils/billing-send-phase.ts — 청구 축의 `campaigns.send_phase` 분할 (CT · 순수)
// ---------------------------------------------------------------------------
// ★ 2026-08-18 신설 (Codex 적대 검토 high #2).
//
// 무엇이 문제였나:
//   청구 대상 선택기가 완료된 직접배관 행을 두 축으로 나눠 뽑는데, 두 조건이
//   `send_phase = 'sent'` 와 `send_phase IS NULL` 이었다. **여집합이 아니다.**
//   신규 배관 행은 'preparing'으로 시작해 'queued'를 거쳐 'sent'가 되므로,
//   큐 적재는 끝났는데 마지막 phase 갱신 전에 워커가 멈추면 그 행은
//   `status='completed'`(결과 동기화가 MySQL 실측을 보고 올린다) + `send_phase='queued'`가 된다.
//   그 상태는 **두 선택기 어디에도 안 걸려 실발송이 청구에서 통째로 사라진다.**
//
// 그래서 여기가 진리표를 소유한다:
//   축 A = 'sent'  ·  축 B = 그 밖의 전부(NULL 포함)
//   두 축은 서로소이고 합집합이 전체다. 이 성질은 `billing-send-phase.test.ts`가 고정한다.
//   phase 값이 늘어도 새 값은 자동으로 축 B에 떨어져 **돈이 사라지지 않는다**(fail-open이 맞는 자리다 —
//   빠뜨리면 청구 누락이고, 더 걸려도 수량은 큐의 성공 행 수라 미발송 청구가 구조적으로 불가하다).
//
// ⚠ SQL에서 `<> 'sent'`를 쓰면 NULL이 빠진다(NULL 비교는 UNKNOWN). 반드시 `IS DISTINCT FROM`이다.
//   이 한 줄이 이 파일이 존재하는 이유의 절반이다.
//
// ⛔ **이걸 환불 sweeper에 가져다 쓰지 마라.** `mysql-refund-sweeper.ts`도 겉보기엔 같은
//   `send_phase == null || === 'sent'` 조건을 갖고 있지만 **의도가 반대다** — 거기서 'preparing'·'queued'를
//   빼는 것은 적재가 진행 중인 캠페인을 건드리지 않기 위한 안전장치다(아직 나갈 건을 환불하면 돈이
//   거꾸로 샌다). 청구는 빠뜨리면 손해라 넓히는 게 맞고, 환불은 넓히면 손해라 좁히는 게 맞다.
//   조건이 닮았다고 같은 축이 아니다.
// ===========================================================================

/** 운영에서 관측되는 `campaigns.send_phase` 값 — 진리표 테스트의 정의역. */
export const SEND_PHASE_DOMAIN = ['sent', 'queued', 'preparing', null] as const;
export type SendPhase = (typeof SEND_PHASE_DOMAIN)[number];

/** 축 A — 배관이 끝까지 간 행 */
export function isSentPhase(phase: string | null | undefined): boolean {
  return phase === 'sent';
}

/** 축 B — 그 밖의 전부(NULL·preparing·queued·미래에 늘어날 값) */
export function isNonSentPhase(phase: string | null | undefined): boolean {
  return !isSentPhase(phase);
}

/** 축 A의 SQL 조각. `alias`는 쿼리의 테이블 별칭(예: 'c2'). */
export function sentPhaseSql(alias: string): string {
  return `${alias}.send_phase = 'sent'`;
}

/** 축 B의 SQL 조각 — `IS DISTINCT FROM`이라야 NULL이 함께 걸린다. */
export function nonSentPhaseSql(alias: string): string {
  return `${alias}.send_phase IS DISTINCT FROM 'sent'`;
}
