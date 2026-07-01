/**
 * ★ email-send-sweeper — 예약 Email 캠페인 발송 + 정체 캠페인 복구 (2026-06-13 신설)
 *
 * 패턴 기준: utils/cancelled-queue-sweeper.ts setInterval + 중복 진입 방지 플래그.
 *
 * 1회 스캔:
 *   ① scheduled_at 도래한 status='scheduled' → target_spec 해석 → 발송 시작
 *   ② status='sending' 인데 updated_at 30분+ 정체 → 'failed' (엔진은 batch마다 updated_at 갱신 = 살아있음 신호)
 *
 * ⛔ target_spec / ai_generated = 신규 ALTER 컬럼. ALTER 전이면 컬럼 부재로 쿼리 throw →
 *    워커가 죽지 않게 column-does-not-exist 감지 시 silent skip (배포 직후 ALTER 대기 구간 보호).
 */
import { query } from '../config/database';
import {
  sendEmailCampaign,
  resolveCustomerRecipients,
  resolveCustomerRecipientsByFilter,
  type EmailTargetSpec,
  type EmailRecipient,
} from './email-channel';

const INTERVAL_MS = 60 * 1000;       // 1분 주기
const STUCK_MINUTES = 30;            // sending 정체 판정
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

function isColumnMissing(err: any): boolean {
  const msg = err?.message || '';
  return msg.includes('column') && msg.includes('does not exist');
}

/** target_spec → 발송 수신자 해석 */
async function resolveRecipients(companyId: string, spec: EmailTargetSpec | null): Promise<EmailRecipient[]> {
  if (!spec) return [];
  if (spec.type === 'list') {
    return (spec.recipients || [])
      .map((r) => ({ email: String(r.email || '').trim(), name: r.name ? String(r.name) : undefined }))
      .filter((r) => r.email.includes('@'));
  }
  if (spec.type === 'customers') {
    return resolveCustomerRecipients(companyId, spec.grades);
  }
  if (spec.type === 'filter') {
    return resolveCustomerRecipientsByFilter(companyId, spec.filter);
  }
  return [];
}

export async function sweepScheduledEmailsOnce(): Promise<{ dispatched: number; failedStuck: number }> {
  let dispatched = 0;
  let failedStuck = 0;

  // ① 도래한 예약 발송 — 한 사이클 최대 5건(동시 SMTP 부하 보호). 발송은 비동기 시작.
  let dueRows: any[] = [];
  try {
    const res = await query(
      `SELECT id, company_id, target_spec
       FROM email_campaigns
       WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC LIMIT 5`,
    );
    dueRows = res.rows;
  } catch (err: any) {
    if (isColumnMissing(err)) return { dispatched: 0, failedStuck: 0 }; // ALTER 전 — 조용히 대기
    throw err;
  }

  for (const row of dueRows) {
    const campaignId = row.id;
    const companyId = row.company_id;
    let spec: EmailTargetSpec | null = null;
    if (row.target_spec) {
      try { spec = typeof row.target_spec === 'string' ? JSON.parse(row.target_spec) : row.target_spec; }
      catch { spec = null; }
    }

    // 이중 발송 가드 — 즉시 'sending' 선점(같은 행 재선택 차단)
    const claim = await query(
      `UPDATE email_campaigns SET status = 'sending', updated_at = NOW()
       WHERE id = $1::uuid AND status = 'scheduled' RETURNING id`,
      [campaignId],
    );
    if (claim.rows.length === 0) continue; // 다른 사이클이 선점

    const recipients = await resolveRecipients(companyId, spec);
    if (recipients.length === 0) {
      // Zero-Count — 발송 대상 0건이면 발송하지 않고 failed (자동 완화 금지 원칙)
      await query(
        `UPDATE email_campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1::uuid`,
        [campaignId],
      );
      console.warn(`[email-send-sweeper] 예약 발송 대상 0건 — failed 처리 (campaign ${campaignId})`);
      continue;
    }

    // 비동기 발송 — sweeper 사이클을 막지 않음. 엔진이 status/sent_count 자체 갱신.
    sendEmailCampaign({ campaignId, recipients, immediate: true })
      .catch((e: any) => console.error(`[email-send-sweeper] 예약 발송 실패 (campaign ${campaignId}):`, e?.message));
    dispatched += 1;
  }

  // ② 정체 sending 복구
  try {
    const stuckRes = await query(
      `UPDATE email_campaigns SET status = 'failed', updated_at = NOW()
       WHERE status = 'sending' AND updated_at < NOW() - INTERVAL '${STUCK_MINUTES} minutes'
       RETURNING id`,
    );
    failedStuck = stuckRes.rows.length;
    if (failedStuck > 0) {
      console.warn(`[email-send-sweeper] 정체 발송 ${failedStuck}건 failed 복구`);
    }
  } catch (err: any) {
    if (!isColumnMissing(err)) throw err;
  }

  return { dispatched, failedStuck };
}

/** app.ts 등록 — 1분 주기 */
export function startEmailSendSweeper(): void {
  if (_timer) return;
  _timer = setInterval(() => {
    if (_running) return;
    _running = true;
    sweepScheduledEmailsOnce()
      .catch((e: any) => console.error('[email-send-sweeper] 스캔 오류:', e?.message))
      .finally(() => { _running = false; });
  }, INTERVAL_MS);
  console.log('[email-send-sweeper] 시작 — 1분 주기 예약 Email 발송 + 정체 복구');
}
