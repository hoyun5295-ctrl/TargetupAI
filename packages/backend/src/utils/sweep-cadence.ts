// ===========================================================================
// utils/sweep-cadence.ts — sweep 차등 주기 판정 (순수 함수, DB import 0)
// ---------------------------------------------------------------------------
// ★ 2026-06-13 신설 — 슈퍼관리자 전반 지연의 근본 원인 fix.
//   mysql-refund-sweeper(30초)가 선불사 14일치 캠페인 전체를 매 사이클 MySQL
//   18개 이력 테이블 UNION으로 실집계 → IN 380건·10초 쿼리가 상시 점유
//   (SHOW FULL PROCESSLIST 실측 2026-06-13). 캠페인이 쌓일수록 전 화면이 느려짐.
//
// 원칙 — 환불 안전망(14일 윈도우·산식)은 불변, "얼마나 자주"만 차등:
//   발송 48시간 이내  = 매 사이클(30초) 집계 (실측 최장 결과 지연 +24h의 2배 마진)
//   발송 48시간 경과  = 60분에 1회만 재집계 (누락 아님 — 도착이 최대 60분 지연될 뿐)
//   발송시각 불명     = 항상 집계 (보수적 default)
// ===========================================================================

/** 발송 후 이 시간 안에는 매 사이클 집계 — 실측 최장 결과 지연(+24h, 3006)의 2배 마진 */
export const SWEEP_HOT_AGE_MS = 48 * 60 * 60 * 1000;

/** 발송 48h 경과(휴면) 캠페인의 재집계 간격 — 60분에 1회 */
export const SWEEP_COLD_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 이번 사이클에 이 캠페인을 실집계할지 판정.
 * @param sendBaseMs  발송 기준 시각(ms) — COALESCE(scheduled_at, sent_at, created_at)
 * @param lastSweptMs 마지막 실집계 시각(ms) — 메모리 마커 (재시작 시 비어 전수 1회 후 재차등)
 * @param nowMs       현재 시각(ms)
 */
export function isSweepDue(
  sendBaseMs: number | null | undefined,
  lastSweptMs: number | null | undefined,
  nowMs: number,
): boolean {
  if (!sendBaseMs || !Number.isFinite(sendBaseMs)) return true;
  if (nowMs - sendBaseMs <= SWEEP_HOT_AGE_MS) return true;
  const last = lastSweptMs && Number.isFinite(lastSweptMs) ? lastSweptMs : 0;
  return nowMs - last >= SWEEP_COLD_INTERVAL_MS;
}
