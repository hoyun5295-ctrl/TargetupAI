/**
 * operator-lag.ts — 자동마케팅 밀림 경보(★ 2026-11-02 설계서 docs/2026-11-01-journey-automarketing-engine-design.md §16 G3)
 *
 * 옛: 자동마케팅 발송 패스 · 제안 생성이 밀려도 울리는 경보가 0개였다(E9 는 여정 실행기 · 진입 감시 · 스팸 큐 · 한 번 보내기만).
 * 원인 하나 = 공용 키 한 통(회사마다 0 · 쿨다운 = 경보 공용) · 숫자 = 상수.
 *   - operator-send-lag: 발송 시간 안 · 예약 시각이 30분 넘게 지난 회차가 있다(발송 패스가 못 따라감)
 *   - operator-generate-lag: 다음 생성 시각이 30분 넘게 지난 운영자가 있다(제안 생성 고르기와 같은 조건 조각)
 */
import { query } from '../config/database';
import { SEND_HOURS } from '../config/defaults';
import { isSendableHourKst } from './autosend-policy';
import { sendSystemAlert } from './system-alert';

/** 밀림 경보 문턱(분) */
export const OPERATOR_LAG_MINUTES = 30;
/** 제안 생성 대상 운영자 조건(생성 고르기 · 밀림 판정이 같이 쓴다 · 한 곳) */
export const OPERATOR_GENERATE_STATUS_SQL = `status IN ('active', 'paused_no_credit')`;

/** 발송 패스 · 1분마다 · 실패는 로그만(경보가 발송을 막지 않는다) */
export async function checkOperatorLag(now: Date = new Date()): Promise<{ sendLag: number; generateLag: number }> {
  const out = { sendLag: 0, generateLag: 0 };
  if (isSendableHourKst(now, SEND_HOURS.start, SEND_HOURS.end)) {
    const r = await query(
      `SELECT COUNT(*)::int AS cnt FROM operator_proposals
        WHERE status = 'scheduled' AND scheduled_send_at IS NOT NULL
          AND scheduled_send_at <= NOW() - INTERVAL '${OPERATOR_LAG_MINUTES} minutes'`,
    );
    out.sendLag = Number(r.rows[0]?.cnt || 0);
    if (out.sendLag > 0) {
      void sendSystemAlert({
        companyId: null,
        dedupKey: 'operator-send-lag',
        message: `자동마케팅 발송 밀림 — 예약 시각이 ${OPERATOR_LAG_MINUTES}분 넘게 지난 회차 ${out.sendLag}건. 목록: SELECT id, company_id, operator_id, scheduled_send_at FROM operator_proposals WHERE status = 'scheduled' AND scheduled_send_at <= NOW() - INTERVAL '${OPERATOR_LAG_MINUTES} minutes' ORDER BY scheduled_send_at`,
      }).catch(() => undefined);
    }
  }
  const g = await query(
    `SELECT COUNT(*)::int AS cnt FROM continuous_operators
      WHERE ${OPERATOR_GENERATE_STATUS_SQL} AND next_run_at IS NOT NULL
        AND next_run_at <= NOW() - INTERVAL '${OPERATOR_LAG_MINUTES} minutes'`,
  );
  out.generateLag = Number(g.rows[0]?.cnt || 0);
  if (out.generateLag > 0) {
    void sendSystemAlert({
      companyId: null,
      dedupKey: 'operator-generate-lag',
      message: `자동마케팅 제안 생성 밀림 — 다음 생성 시각이 ${OPERATOR_LAG_MINUTES}분 넘게 지난 운영자 ${out.generateLag}곳. 목록: SELECT id, company_id, next_run_at FROM continuous_operators WHERE ${OPERATOR_GENERATE_STATUS_SQL} AND next_run_at <= NOW() - INTERVAL '${OPERATOR_LAG_MINUTES} minutes' ORDER BY next_run_at`,
    }).catch(() => undefined);
  }
  return out;
}
