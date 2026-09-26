/**
 * refund-calc.ts — 환불 누적의 단일 정의 컨트롤타워 (순수 함수, DB import 0)
 *
 * ★ 2026-06-29: "정당 환불 = 실패(실측) + 미적재(차감 − 실제 처리수)".
 *   미적재 기준을 sent_count → max(sent_count, 성공+실패+대기)로 교체.
 *
 * 배경 — sent_count 과소 기록 초과 환불 근본 fix:
 * 직전(2026-06-25) 산식은 미적재 = 차감 − sent_count였다. 그런데 워커가 기록한 sent_count가 실제
 * 처리수(성공+실패)보다 작게 남는 캠페인이 있었다 (폴라초이스 6/28: 성공14790+실패610=15400=차감인데
 * sent_count는 15271). 그 차이 129건을 "안 보낸 것"으로 오인해 환불 → prepaidRefund ratchet(되돌림 없음)이
 * 영구 초과로 굳혔다 (라무르·폴라초이스 외, 2026-06-29 실측 51,722원). 초과량 = (성공+실패) − sent_count.
 *
 * 새 산식 — 실제 큐에 올라간 수를 MySQL 실측으로 본다:
 *   처리수 = max(sent_count, 성공 + 실패 + 대기)   // 둘 중 큰 값 = 확실히 큐에 올라간 수
 *   미적재 = max(0, 차감 − 처리수)
 * 성공/실패는 이력(append-only)이라 과대 집계가 구조적으로 불가능하고(sms-table-split), 대기는 라이브
 * 큐에서만 센다. sent_count를 하한으로 둬 라이브→이력 이동 중 MySQL 일시 과소집계에도 미적재가 부풀지
 * 않는다(2026-06-25 race 방어 유지). 둘 다 작게 잡혀도 reverse 안전망(mysql-refund-sweeper)이 정산 후 보정.
 *
 * 처리수가 0/미상이면 미적재 0(전량 미적재는 direct-send-worker가 적재 시점에 환불).
 * 호출 전제: 적재가 끝난 캠페인(send_phase='sent' 또는 동기 적재 경로)에서만 사용.
 */
export function calcRefundDue(p: {
  deductedCount: number;
  sentCount: number;
  mysqlSuccess: number;
  mysqlFail: number;
  mysqlPending: number;
}): number {
  const parts = calcRefundParts(p);
  return parts.fail + parts.notLoaded;
}

/**
 * 같은 산식을 **원인별로 나눠** 돌려준다 — ★ 2026-07-27 (B-0727-2).
 * 환불 항아리를 원인별로 분리하면서, sweeper가 실패분(fail)과 미적재분(notloaded)을
 * 각자의 키로 정산할 수 있어야 워커가 넣어둔 미적재 환불과 같은 키에서 수렴한다.
 * 합계는 기존 calcRefundDue와 항상 같다(상한 포함).
 */
export function calcRefundParts(p: {
  deductedCount: number;
  /**
   * ★ 2026-08-05 요금제 무료 제공으로 덮인 건수(설계 §5-1-B). 기본 0 = 종전 계산과 완전히 같다.
   *
   * 미적재 판정은 **부담 건수(차감 + 무료)** 기준이어야 한다 — 무료로 덮인 건도 큐에 올라갔어야 할
   * 발송이기 때문이다. 반대로 **환불 상한은 차감 건수 그대로**다: 무료분은 돈이 나간 적이 없어
   * 돌려줄 것이 없고, 소진은 복원하지 않는다(§5-1-A). 아래 두 cap이 그 경계를 지킨다.
   */
  freeCount?: number;
  sentCount: number;
  mysqlSuccess: number;
  mysqlFail: number;
  mysqlPending: number;
}): { fail: number; notLoaded: number } {
  const deducted = Math.max(0, Math.floor(p.deductedCount));
  const free = Math.max(0, Math.floor(Number(p.freeCount) || 0));
  const covered = deducted + free;
  const sent = Math.max(0, Math.floor(p.sentCount));
  const success = Math.max(0, Math.floor(p.mysqlSuccess));
  const fail = Math.max(0, Math.floor(p.mysqlFail));
  const pending = Math.max(0, Math.floor(p.mysqlPending));
  // 실제 큐에 올라간(처리된) 수 = max(워커 기록 적재, MySQL 실측 성공+실패+대기)
  const processed = Math.max(sent, success + fail + pending);
  const notLoaded = processed > 0 ? Math.max(0, covered - processed) : 0;
  // 상한 — 누적 환불이 차감 총액을 넘지 않도록 (prepaidRefund에도 한도 가드 있으나 산식 자체로도 보장).
  //   상한에 걸리면 실패분을 먼저 채우고 남은 만큼만 미적재분에 배분한다(실패는 실측, 미적재는 파생값).
  const cappedFail = Math.min(deducted, fail);
  const cappedNotLoaded = Math.max(0, Math.min(deducted - cappedFail, notLoaded));
  return { fail: cappedFail, notLoaded: cappedNotLoaded };
}

/**
 * 환불 머니 불변식 — 정산 끝난 캠페인의 근본 식: 차감 == 성공 + 순환불(환불 − 회수).
 * ★ 2026-06-29: 차감한 모든 건은 성공으로 전달됐거나 환불됐어야 한다(발송사 근간).
 *   반환 gap = 차감 − (성공 + 순환불).
 *   - gap > 0 = 차감했는데 성공도 환불도 아닌 건 = 미환불(고객이 안 받은 문자값 떼임) → 경보.
 *   - gap < 0 = 초과 환불 잔존(reverse가 못 따라잡음) → 경보.
 *   - |gap| 작으면(반올림 여유) 정상. 호출측이 임계값으로 노이즈 차단.
 * 순수 함수(DB import 0). 호출 전제: 정산 끝난 캠페인(대기 0) + MySQL 집계 유효(성공+실패>0).
 */
export function refundInvariantGap(p: {
  deductedCount: number;
  successCount: number;
  netRefundedCount: number;
  /** ★ 2026-08-05 요금제 무료 제공으로 덮인 건수. 기본 0 = 종전 식과 완전히 같다. */
  freeCount?: number;
  /**
   * ★ 2026-09-26 알림톡 결과별 단가 차액을 차감 단가로 나눈 값(소수 그대로). 기본 0 = 종전 식.
   * 차액은 성공한 건의 값을 깎아 준 **정당 환불**이라 순환불에서 빼고 본다 — 빼지 않으면 차액만큼 초과 환불로 보인다.
   * 반대로 차액을 못 돌려줬으면 순환불이 모자라 gap > 0(미환불)으로 드러난다.
   */
  unitDiffCount?: number;
}): number {
  const deducted = Math.max(0, Math.floor(p.deductedCount));
  const free = Math.max(0, Math.floor(Number(p.freeCount) || 0));
  const success = Math.max(0, Math.floor(p.successCount));
  const netRefunded = Math.max(0, Math.floor(p.netRefundedCount));
  // ★ 2026-08-05 무료 제공이 끼면 식이 한 항 늘어난다 — `부담 = 성공 + 순환불 + 무료실패소멸`.
  //   무료로 덮였는데 전달되지 못한 몫은 돈이 나간 적이 없어 환불 대상이 아니고,
  //   소진도 복원하지 않으므로(설계 §5-1-A) 어느 항에도 안 잡힌다. 그 자리를 이 항이 메운다.
  //   무료를 성공 건에 우선 배정하므로 소멸분은 `max(0, 무료 − 성공)`이다.
  //   무료 0이면 이 항도 0이라 옛 캠페인의 판정은 한 건도 달라지지 않는다.
  const freeLost = Math.max(0, free - success);
  const unitDiff = Math.max(0, Number(p.unitDiffCount) || 0);
  return (deducted + free) - (success + netRefunded - unitDiff + freeLost);
}

/**
 * ★ 2026-09-26 한줄로 V2 F01·F04 — 선불 알림톡 결과별 정산 (순수).
 *
 * 알림톡 캠페인의 결과 행은 두 가지 모양으로 대체 발송을 남긴다.
 *   ① 대체 행: 카카오 실패한 K행 뒤에 문자 행(S/L)이 `k_oriseq`(원본 K행 번호)를 달고 따로 적재된다 — 운영 실측(c617: K 1800×4 · 7300×2 + 대체 L 1000×2).
 *   ② K행 코드: K행 자체에 `7830`(SMS 대체 성공)·`7831`(LMS 대체 성공)이 찍힌다(결과 코드 규격).
 * 한 캠페인에 두 모양이 함께 있으면 한 수신자를 두 번 셀 수 있어 **판정을 보류**한다(ambiguous) — 호출부는
 * 결과별 정산 없이 종전 방식(차감 단가)으로 정산하고 경보를 낸다. 추측으로 돈을 움직이지 않는다.
 * 기타(other) = 위 분류에 들지 않는 성공 — 차액 0(차감 단가 그대로).
 */
export interface AlimtalkResultAgg {
  /** K행 알림톡 성공(1800) */ kakao: number;
  /** K행 7830 */ inRowSms: number;
  /** K행 7831 */ inRowLms: number;
  /** 대체 S행 성공 */ subSms: number;
  /** 대체 L행 성공 */ subLms: number;
  /** 대체 행 전체(상태 무관) — 모양 판정용 */ sub: number;
}
export interface AlimtalkSuccessMix { kakao: number; sms: number; lms: number; other: number }

export function resolveAlimtalkMix(agg: AlimtalkResultAgg | undefined, totalSuccess: number): { mix: AlimtalkSuccessMix; ambiguous: boolean } {
  const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  const kakao = n(agg?.kakao);
  const inRow = n(agg?.inRowSms) + n(agg?.inRowLms);
  const sms = n(agg?.inRowSms) + n(agg?.subSms);
  const lms = n(agg?.inRowLms) + n(agg?.subLms);
  const other = Math.max(0, n(totalSuccess) - kakao - sms - lms);
  return { mix: { kakao, sms, lms, other }, ambiguous: inRow > 0 && n(agg?.sub) > 0 };
}

/**
 * 결과별 단가 차액(원) = Σ 과금된 성공 × max(0, 차감 단가 − 결과 단가).
 * - 차감 단가보다 비싼 결과는 0 — 선불은 차감보다 더 받지 않는다(SMS로 차감한 자동발송의 LMS 대체).
 * - 무료 제공분은 돈이 나가지 않아 차액이 없다. 무료는 **차액이 작은 성공부터** 덮는다(LMS 대체 → SMS 대체 → 알림톡):
 *   무료 제공은 차감 유형(문자)의 몫이라 같은 문자 결과에 먼저 쓰인 것으로 본다. 성공 우선 배정은 refundInvariantGap과 같다.
 * 성공은 이력(append-only)에서만 세므로 이 값은 결과가 도착할수록 커지기만 한다(환불 항아리의 누적 목표로 쓸 수 있다).
 */
export function calcAlimtalkUnitDiff(p: {
  deductUnit: number;
  units: { KAKAO: number; SMS: number; LMS: number };
  mix: AlimtalkSuccessMix;
  freeCount?: number;
}): number {
  const U = Number(p.deductUnit) || 0;
  const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  const classes = [
    { count: n(p.mix.other), diff: 0 },
    { count: n(p.mix.lms), diff: Math.max(0, U - p.units.LMS) },
    { count: n(p.mix.sms), diff: Math.max(0, U - p.units.SMS) },
    { count: n(p.mix.kakao), diff: Math.max(0, U - p.units.KAKAO) },
  ].sort((a, b) => a.diff - b.diff);
  let free = n(p.freeCount);
  let total = 0;
  for (const c of classes) {
    const covered = Math.min(free, c.count);
    free -= covered;
    total += (c.count - covered) * c.diff;
  }
  return Math.round(total * 100) / 100;
}
