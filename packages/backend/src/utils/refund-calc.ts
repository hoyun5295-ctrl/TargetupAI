/**
 * refund-calc.ts — 환불 누적의 단일 정의 컨트롤타워 (순수 함수, DB import 0)
 *
 * ★ 2026-06-25: "정당 환불 = 실패(실측) + 미적재(차감 − 적재)".
 *
 * 배경 — 초과 환불 구조의 근본 fix:
 * 직전 산식 "차감 − 성공 − 대기"는 성공 카운트에 의존했다. 발송 직후 QTmsg 에이전트가
 * 라이브 큐 → 이력 테이블로 행을 옮기는(복사 후 삭제) 순간, 그 행이 양쪽 어디에도 안 잡혀
 * 성공이 실제보다 작게 보이고 → 환불대상이 일시적으로 부풀었다. prepaidRefund는 누적 목표가
 * 올라갈 때만 차액을 환불하고(되돌림 없음) 다음 사이클에 성공이 회복돼도 깎지 않아, 그 일시
 * 과대가 영구 초과 환불로 굳었다 (2026-06-14 베이컨 외 25건 / 약 129,670원, sweep 경로).
 *
 * 새 산식은 성공 의존을 없앤다:
 *   - 실패(mysqlFail): 실패코드로 실제 돌아온 것만. 이력은 append-only, 이동 중 fail은 mobsend
 *     있어 라이브 lf에서 제외 → 부풀지 않음. 대기는 실패가 아니므로 환불 대상 아님(실패되면 다음
 *     사이클에 mysqlFail 증가로 자동 반영).
 *   - 미적재(deducted − sentCount): 차감했는데 큐에 안 올라간 것. 둘 다 안정값이라 이동 중 영향 0.
 *
 * 미적재를 더하는 이유: prepaidRefund가 캠페인 단위 누적으로 묶여, 실패만 보내면 direct-send-worker의
 * 미적재 환불과 max로 수렴해 두 몫의 합이 아니라 큰 값만 남는다(2026-06-11 과소 환불 사고). 둘의 합을
 * 누적값으로 넘겨야 정확하다. 정산 끝난 상태에선 실패 + 미적재 = 차감 − 성공이라 결과 동일하고,
 * 다른 건 발송 직후 일시 구간뿐(거기서만 부풀지 않음).
 *
 * sentCount가 0/미상이면 미적재는 0으로 본다(전량 미적재는 direct-send-worker가 적재 시점에 환불).
 * sentCount를 차감보다 작게 잘못 기록한 경우의 과대 환불을 막는 보수적 선택.
 * 호출 전제: 적재가 끝난 캠페인(send_phase='sent' 또는 동기 적재 경로)에서만 사용.
 */
export function calcRefundDue(p: { deductedCount: number; sentCount: number; mysqlFail: number }): number {
  const deducted = Math.max(0, Math.floor(p.deductedCount));
  const sent = Math.max(0, Math.floor(p.sentCount));
  const fail = Math.max(0, Math.floor(p.mysqlFail));
  const notLoaded = sent > 0 ? Math.max(0, deducted - sent) : 0;
  // 상한 — 누적 환불이 차감 총액을 넘지 않도록 (prepaidRefund에도 한도 가드 있으나 산식 자체로도 보장)
  return Math.min(deducted, fail + notLoaded);
}
