/**
 * ★ 2026-06-17 만료 발송요청 안전망 워커 — rsv1='3'(서버전송요청완료)인데 결과 미수신 만료분 자동 실패 처리.
 *
 * QTmsg 매뉴얼 ver4.0(p.6): rsv1 1=발송대기 / 2=Agent처리중 / 3=서버로전송요청완료 / 4=결과수신완료 / 5=월별처리완료.
 *   "전송결과는 SMS·LMS 최장 2일 이내 수신". rsv1=3에서 2일 넘게 mobsend_time·결과 없음 = 서버 미도달 유실.
 *
 * 사고 맥락: 시세이도 6/12 11:00 예약 2건이 rsv1=3 + mobsend NULL + status 104로 5일째 잔존(엔진에도 없음)
 *   = 전송 유실. 이런 만료분이 뒤늦게 나가면 0611 에이치피오 늦은 발송(250만원) 재발 → 자동 실패 처리.
 *
 * 처리: status_code=4000(전송 시간 초과=실패) 마킹 → Agent가 결과코드로 보고 발송 안 함(절대 안 나감) +
 *   화면에 '실패'로 표시(직원 인지). DELETE 아닌 마킹이라 smsCampaignCountsSafe가 fail로 집계(대기 잔존 차단).
 *
 * ★ 절대 원칙: rsv1='1'(발송대기)·'2'(Agent처리중)은 정상 진행분 — 건드리지 않는다(예약 발송 반드시 나가야 함).
 *   시각이 아니라 rsv1=3 + 2일 경과로만 좁힌다.
 *
 * 패턴: cancelled-queue-sweeper.ts 미러(1분 주기 + 효과 검증). 캠페인별 로그로 발송 누락 추적.
 */
import { getAllBulkSmsTables, smsCountAll, smsExecAll, smsGroupByAll } from './sms-queue';

const INTERVAL_MS = 60 * 1000; // 1분 — cancelled-queue-sweeper와 동일 주기
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/** 만료 판정 경과시간 — QTmsg 매뉴얼 SMS·LMS 결과 최장 2일(48h). 2일 넘게 결과 없으면 전송 유실 확정. */
const EXPIRE_HOURS = 48;

/** 만료 발송요청 행 조건 — rsv1='3'(서버전송요청완료) 한정 + 결과 미수신 + 발송 2일 초과 */
const EXPIRE_WHERE = `rsv1 = '3' AND status_code IN (100, 104) AND mobsend_time IS NULL AND sendreq_time < NOW() - INTERVAL ${EXPIRE_HOURS} HOUR`;

/** 1회 스캔 — rsv1='3' 만료(2일+) 미발송 행을 자동 실패 마킹(status 4000). rsv1='1'/'2'는 절대 미포함. */
export async function sweepExpiredPendingOnce(): Promise<{ failed: number; remain: number }> {
  const tables = await getAllBulkSmsTables();
  if (tables.length === 0) return { failed: 0, remain: 0 };

  const before = await smsCountAll(tables, EXPIRE_WHERE, []);
  if (before === 0) return { failed: 0, remain: 0 };

  // 추적: 어느 캠페인의 발송 누락인지 (안 나간 것 추적, 로그로 남김)
  let byCamp: Record<string, number> = {};
  try { byCamp = await smsGroupByAll(tables, 'app_etc1', EXPIRE_WHERE, []); } catch { /* 로그용이라 실패 무시 */ }

  // status 4000(전송 시간 초과=실패) 마킹 — Agent가 결과코드로 보고 발송 안 함(절대 안 나감) + 화면 '실패' 표시.
  //   DELETE 아닌 마킹: 직원이 '실패'로 인지 + smsCampaignCountsSafe가 라이브 만료를 fail로 집계(대기 잔존 차단).
  await smsExecAll(tables, `UPDATE SMSQ_SEND SET status_code = 4000, repmsg_recvtm = NOW() WHERE ${EXPIRE_WHERE}`, []);

  // 효과 검증 — 마킹 후 잔존 재카운트 (status 4000으로 바뀌어 0이어야 함). 남으면 다음 주기 재시도.
  const remain = await smsCountAll(tables, EXPIRE_WHERE, []);
  console.log(
    `[expired-pending-sweeper] rsv1=3 만료(${EXPIRE_HOURS}h+) 미발송 ${before}건 실패 마킹(발송 차단) — ` +
    `캠페인별 ${JSON.stringify(byCamp)} / 잔존 ${remain}`,
  );
  return { failed: before - remain, remain };
}

/** app.ts 등록 — 1분 주기 */
export function startExpiredPendingSweeper(): void {
  if (_timer) return;
  _timer = setInterval(() => {
    if (_running) return;
    _running = true;
    sweepExpiredPendingOnce()
      .catch((e: any) => console.error('[expired-pending-sweeper] 스캔 오류:', e?.message))
      .finally(() => { _running = false; });
  }, INTERVAL_MS);
  console.log('[expired-pending-sweeper] 시작 — 1분 주기 rsv1=3 만료(2일+) 미발송 자동 실패 처리');
}
