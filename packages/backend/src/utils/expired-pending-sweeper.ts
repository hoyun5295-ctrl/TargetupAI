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
import { getQueueTableSets, smsCountAll, smsExecAll, smsGroupByAll } from './sms-queue';
import { ABNORMAL_STATUS_MIN } from './sms-result-map';
import { sendSystemAlert } from './system-alert';

const INTERVAL_MS = 60 * 1000; // 1분 — cancelled-queue-sweeper와 동일 주기
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/** 만료 판정 경과시간 — QTmsg 매뉴얼 SMS·LMS 결과 최장 2일(48h). 2일 넘게 결과 없으면 전송 유실 확정. */
const EXPIRE_HOURS = 48;

/** 만료 발송요청 행 조건 — rsv1='3'(서버전송요청완료) 한정 + 결과 미수신 + 발송 2일 초과 */
const EXPIRE_WHERE = `rsv1 = '3' AND status_code IN (100, 104) AND mobsend_time IS NULL AND sendreq_time < NOW() - INTERVAL ${EXPIRE_HOURS} HOUR`;

/**
 * ★ 2026-10-08 이상 상태값 행 — 결과 코드로 있을 수 없는 값(ABNORMAL_STATUS_MIN 이상) + 한 번도 안 나감 + 2일 초과.
 *   전 라인(bulk + bito + 꺼진 라인) 대상. 에이전트는 100 만 가져가므로 이런 행은 영영 대기로 남는다(게스 10/5 사례).
 *   대기(100 · 104)는 하한보다 작아 걸리지 않는다 — 비토 100(결과 대기)은 절대 안 건드린다.
 */
const ABNORMAL_WHERE = `status_code >= ${ABNORMAL_STATUS_MIN} AND mobsend_time IS NULL AND sendreq_time < NOW() - INTERVAL ${EXPIRE_HOURS} HOUR`;

/**
 * 한 묶음(표 · 조건)을 실패(4000) 마킹하고 효과를 다시 센다 — 두 규칙이 같은 칸 · 같은 검증을 쓴다.
 *   4000 = 전송 시간 초과(실패) · Agent 가 결과코드로 보고 발송 안 함 + 화면 「실패」 · DELETE 아닌 마킹(직원 인지 · 실패 집계).
 *   효과 검증 = 마킹 뒤 잔존 재카운트(0 이어야 함 · 남으면 다음 주기 재시도). 캠페인별 건수는 로그로 남긴다.
 */
async function markFailed(tables: string[], where: string, label: string): Promise<{ failed: number; remain: number }> {
  if (tables.length === 0) return { failed: 0, remain: 0 };
  const before = await smsCountAll(tables, where, []);
  if (before === 0) return { failed: 0, remain: 0 };
  let byCamp: Record<string, number> = {};
  try { byCamp = await smsGroupByAll(tables, 'app_etc1', where, []); } catch { /* 로그용이라 실패 무시 */ }
  await smsExecAll(tables, `UPDATE SMSQ_SEND SET status_code = 4000, repmsg_recvtm = NOW() WHERE ${where}`, []);
  const remain = await smsCountAll(tables, where, []);
  console.log(`[expired-pending-sweeper] ${label} ${before}건 실패 마킹(발송 차단) — 캠페인별 ${JSON.stringify(byCamp)} / 잔존 ${remain}`);
  return { failed: before - remain, remain };
}

/** 1회 스캔 — ① rsv1='3' 만료(2일+) 미발송(QTmsg 표만 · 옛 규칙 그대로) ② 이상 상태값(전 표). rsv1='1'/'2' · 대기 100/104 의 비토 행은 절대 미포함. */
export async function sweepExpiredPendingOnce(): Promise<{ failed: number; remain: number }> {
  const { bulk, all } = await getQueueTableSets();
  // ① QTmsg 규칙 — 표 = 활성 bulk 만(옛 동작 그대로 · 비토 100 결과 대기는 대상 아님)
  const qtmsg = await markFailed(bulk, EXPIRE_WHERE, `rsv1=3 만료(${EXPIRE_HOURS}h+) 미발송`);
  // ② 이상 상태값 — 닫기 전에 이 워커가 직접 알린다(Codex 1R medium · 감시 5분보다 이 워커 1분이 먼저 닫으면 경보가 영영 안 나갔다)
  const abnormalCount = await smsCountAll(all, ABNORMAL_WHERE, []);
  if (abnormalCount > 0) {
    let codes: Record<string, number> = {};
    try { codes = await smsGroupByAll(all, 'status_code', ABNORMAL_WHERE, []); } catch { /* 경보 본문용이라 실패 무시 */ }
    await sendSystemAlert({
      dedupKey: 'queue-abnormal-status-closed',
      cooldownMs: 12 * 60 * 60 * 1000,
      title: '발송 대기열의 결과 코드가 아닌 상태값 행을 실패로 닫습니다.',
      details: [`${abnormalCount.toLocaleString()}행 (한 번도 안 나감 · ${EXPIRE_HOURS}시간 지남)`, `상태값 ${JSON.stringify(codes)}`],
      action: '서버 상태(메모리 · 커널 기록)를 점검해 주세요.',
    }).catch((e: any) => console.error('[expired-pending-sweeper] 이상 상태값 경보 실패:', e?.message));
  }
  const abnormal = await markFailed(all, ABNORMAL_WHERE, `이상 상태값(${ABNORMAL_STATUS_MIN}+ · ${EXPIRE_HOURS}h+ · 미전송)`);
  return { failed: qtmsg.failed + abnormal.failed, remain: qtmsg.remain + abnormal.remain };
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
