/**
 * refund-calc.ts — 환불 누적의 단일 정의 컨트롤타워 (순수 함수, DB import 0)
 *
 * ★ 2026-06-11: "정당 환불 = 차감 건수 − 통신사 성공 − 통신사 대기".
 * 미적재분(차감됐는데 큐에 안 들어간 것)과 실측 실패분이 자연히 '합'으로 포함된다.
 *
 * 배경 — 과소 환불 구조의 근본 fix:
 * prepaidRefund는 호출측 count를 "캠페인 정당 환불 누적"으로 보고 차액만 환불하는데,
 * direct-send-worker는 미적재분(total−sent), campaign-lifecycle/mysql-refund-sweeper는
 * 실측 실패분을 같은 누적 풀에 보내 큰 값으로만 수렴 → 두 몫의 합이 아니라 max가 됨.
 * (예: 차감 985 / 적재 978(미적재 7) / 실측 실패 30이면 기존 산식은 30건분만 환불 — 미적재 7건분 영구 누락.
 *  D231 톤28형 적재 실패가 실재 시나리오. 시세이도 6/8은 실측 결과 미적재 0 = 표시 오염으로 판명.)
 *
 * pending(통신사 처리 대기)은 보류 — 결과 도착 시 다음 sweep에서 자동 증가 환불.
 * 호출 전제: 적재가 끝난 캠페인(send_phase='sent' 또는 동기 적재 경로)에서만 사용.
 */
export function calcRefundDue(p: { deductedCount: number; mysqlSuccess: number; mysqlPending: number }): number {
  const deducted = Math.max(0, Math.floor(p.deductedCount));
  const success = Math.max(0, Math.floor(p.mysqlSuccess));
  const pending = Math.max(0, Math.floor(p.mysqlPending));
  return Math.max(0, deducted - success - pending);
}
