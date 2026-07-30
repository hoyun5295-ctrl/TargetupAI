/**
 * ★ 2026-06-11 취소 잔존 큐 안전망 워커 — 에이치피오 예약취소 미삭제 발송 사고 재발 차단 최종 안전망.
 *
 * status='cancelled'인데 MySQL 발송 큐에 대기(status_code=100) 행이 남은 캠페인을 1분 주기로 스캔해 삭제한다.
 * 취소 경로가 어떤 이유로든(라인 불일치/적재 경합/향후 신규 코드 누락) 큐를 못 지워도 여기서 막는다.
 * 브랜드메시지(msg_type='F')도 같은 SMSQ 테이블이라 동일 DELETE가 커버한다(2026-07-30 합류).
 *
 * 패턴 기준: utils/campaign-sync-worker.ts setInterval + 중복 진입 방지 플래그 미러.
 */
import { query } from '../config/database';
import {
  getCampaignQueueTables, smsCountAll, smsExecAll,
} from './sms-queue';
import { SUCCESS_CODES } from './sms-result-map';

const INTERVAL_MS = 60 * 1000; // 1분 — 예약 발송은 분 단위라 발송 시각 전 선제 삭제에 충분
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/** 1회 스캔 — 취소됐는데 발송 큐에 대기 행이 남은 캠페인 정리 */
export async function sweepCancelledQueuesOnce(): Promise<{ scanned: number; deleted: number }> {
  let scanned = 0;
  let deleted = 0;

  // 최근 7일 내 취소 + 발송 시각이 아직 안 지났거나 하루 이내인 것만 (스캔 비용 최소화)
  const targets = await query(
    `SELECT id, company_id, created_by, send_config FROM campaigns
     WHERE status = 'cancelled'
       AND cancelled_at >= NOW() - INTERVAL '7 days'
       AND (scheduled_at IS NULL OR scheduled_at >= NOW() - INTERVAL '1 day')`
  );

  for (const c of targets.rows) {
    try {
      scanned++;
      const tables = await getCampaignQueueTables(c.company_id, c.created_by || undefined, c.send_config);
      const pending = await smsCountAll(tables, 'app_etc1 = ? AND status_code = 100', [c.id]);
      if (pending > 0) {
        await smsExecAll(tables, `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`, [c.id]);
        deleted += pending;
        console.log(`[cancelled-queue-sweeper] 취소 캠페인 ${c.id} 잔존 대기 ${pending}건 삭제 (취소 경로 누락 안전망 작동)`);
      }

      // ★ 2026-06-11: 픽업됐다 멈춘 행(비성공·비100) — 취소 마킹 9999 (취소 경로 campaign-lifecycle와 동일 정책).
      //   에이치피오 사고 캠페인 잔존 2,129건이 status 100 한정 삭제에 안 걸려 에이전트가 계속 내보내던 누수 차단.
      //   성공 행은 보존(이력 진실). 처리 후 대기(100) 잔존 재카운트 = 효과 검증(6원칙 ②), 남으면 다음 주기 재시도.
      const stuck = await smsCountAll(
        tables,
        `app_etc1 = ? AND status_code NOT IN (${SUCCESS_CODES.join(',')}) AND status_code != 100 AND status_code != 9999`,
        [c.id]
      );
      if (stuck > 0) {
        await smsExecAll(
          tables,
          `UPDATE SMSQ_SEND SET status_code = 9999 WHERE app_etc1 = ? AND status_code NOT IN (${SUCCESS_CODES.join(',')}) AND status_code != 100 AND status_code != 9999`,
          [c.id]
        );
        deleted += stuck;
      }
      if (pending > 0 || stuck > 0) {
        const remain = await smsCountAll(tables, 'app_etc1 = ? AND status_code = 100', [c.id]);
        console.log(`[cancelled-queue-sweeper] 취소 캠페인 ${c.id} 정리 — 대기 ${pending} 삭제 / 픽업잔존 ${stuck} 취소마킹 / 재카운트 대기 잔존 ${remain}`);
      }

      // (2026-07-30) 옛 카카오 IMC 큐 정리 폐기 — 브랜드 행(msg_type='F')도 같은 SMSQ 테이블이라
      // 위 DELETE·9999 마킹이 함께 처리한다.
    } catch (err: any) {
      console.error(`[cancelled-queue-sweeper] 캠페인 ${c.id} 처리 오류:`, err?.message);
    }
  }

  return { scanned, deleted };
}

/** app.ts 등록 — 1분 주기 */
export function startCancelledQueueSweeper(): void {
  if (_timer) return;
  _timer = setInterval(() => {
    if (_running) return;
    _running = true;
    sweepCancelledQueuesOnce()
      .catch((e: any) => console.error('[cancelled-queue-sweeper] 스캔 오류:', e?.message))
      .finally(() => { _running = false; });
  }, INTERVAL_MS);
  console.log('[cancelled-queue-sweeper] 시작 — 1분 주기 취소 잔존 큐 정리');
}
