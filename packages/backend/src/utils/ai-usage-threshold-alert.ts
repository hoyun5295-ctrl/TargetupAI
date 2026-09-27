/**
 * ai-usage-threshold-alert.ts — AI 사용량 한도 알림 발송 (★ 2026-09-27 한줄로 V2 R075)
 *
 * 옛: 한도 알림 설정(companies.ai_usage_threshold_config)은 저장·표시만 되고 그 값을 읽어 알림을 보내는 코드가 없었다.
 * 이제: 10분마다 설정이 켜진 회사의 이번 달 사용률(getMonthlyUsage · 한도 판정과 같은 셈)을 보고, 기준을 처음 넘은 달에 한 번 알린다.
 *   - 달마다 한 번 = 같은 jsonb의 last_alerted_month(새 칸 0)를 조건부 UPDATE로 먼저 선점한 경우에만 보낸다(재시작·중복 실행에도 1회).
 *   - 채널: sms = 담당자 무과금 안내 문자(notifyOperatorAdmins · 담당자 번호가 비면 회사 관리자로 폴백) ·
 *           email = 회사 연락 메일(회사 SMTP가 설정된 경우만 · 미설정이면 건너뛴다) ·
 *           inapp = AI 사용량 화면 표시(화면이 사용률로 판정 · 여기서는 보낼 것이 없다).
 */
import { query } from '../config/database';
import { getMonthlyUsage } from './ai-rate-limit';
import { kstMonthString } from './planner-execution';
import { notifyOperatorAdmins } from './continuous-operator';
import { sendEmail, isSmtpConfigured } from './company-smtp-client';

const INTERVAL_MS = 10 * 60 * 1000;
const ALLOWED_THRESHOLDS = [50, 80, 95];
let running = false;
let timer: NodeJS.Timeout | null = null;

export async function runAiUsageThresholdAlerts(): Promise<{ alerted: number }> {
  let rows: any[] = [];
  try {
    const r = await query(
      `SELECT id, company_name, contact_email, ai_usage_threshold_config AS config
         FROM companies
        WHERE COALESCE((ai_usage_threshold_config->>'enabled')::boolean, false) = true`,
    );
    rows = r.rows;
  } catch (e: any) {
    if (String(e?.message || '').includes('does not exist')) return { alerted: 0 }; // ALTER 전 — 조용히 대기
    throw e;
  }

  const month = kstMonthString();
  let alerted = 0;
  for (const row of rows) {
    try {
      const cfg = row.config || {};
      const threshold = Number(cfg.threshold_percent);
      if (!ALLOWED_THRESHOLDS.includes(threshold)) continue;
      if (String(cfg.last_alerted_month || '') === month) continue;
      const usage = await getMonthlyUsage(String(row.id));
      if (usage.limit === null || usage.limit <= 0) continue;
      const percent = Math.round((usage.used / usage.limit) * 100);
      if (percent < threshold) continue;

      // 선점 — 이번 달 알림 표시를 먼저 남긴 경우에만 보낸다
      const claim = await query(
        `UPDATE companies
            SET ai_usage_threshold_config = COALESCE(ai_usage_threshold_config, '{}'::jsonb) || jsonb_build_object('last_alerted_month', $2::text)
          WHERE id = $1::uuid
            AND COALESCE(ai_usage_threshold_config->>'last_alerted_month', '') <> $2
          RETURNING id`,
        [row.id, month],
      );
      if (claim.rows.length === 0) continue;

      const channels: string[] = Array.isArray(cfg.channels) ? cfg.channels : [];
      const title = '[한줄로 AI 사용량 안내]';
      const body = `이번 달 AI 호출이 ${percent}%(${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()}회)로 알림 기준 ${threshold}%에 도달했습니다. AI 사용량 화면에서 확인해 주세요.`;
      if (channels.includes('sms')) {
        await notifyOperatorAdmins(
          { adminPhoneNumbers: [], backupAdminPhone: null, companyId: String(row.id), createdBy: null },
          title,
          body,
          { noticeHeader: title },
        ).catch((e: any) => console.warn('[AI Usage Alert] 문자 적재 실패:', row.id, e?.message));
      }
      if (channels.includes('email') && row.contact_email) {
        try {
          if (await isSmtpConfigured(String(row.id))) {
            await sendEmail({
              companyId: String(row.id),
              to: String(row.contact_email),
              subject: `${title} 이번 달 AI 호출 ${percent}%`,
              htmlBody: `<p style="font-size:14px;line-height:1.7;">${body}</p>`,
            });
          }
        } catch (e: any) {
          console.warn('[AI Usage Alert] 메일 발송 실패:', row.id, e?.message);
        }
      }
      alerted += 1;
      console.log(`[AI Usage Alert] company=${row.id} ${percent}% ≥ ${threshold}% → 알림(${channels.join(',') || '채널 없음'})`);
    } catch (e: any) {
      console.warn('[AI Usage Alert] 회사 처리 경고:', row.id, e?.message);
    }
  }
  return { alerted };
}

/** app.ts 등록 — 10분 주기 */
export function startAiUsageThresholdAlertWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    runAiUsageThresholdAlerts()
      .catch((e: any) => console.error('[AI Usage Alert] 스캔 오류:', e?.message))
      .finally(() => { running = false; });
  }, INTERVAL_MS);
  console.log('[AI Usage Alert] 시작 — 10분 주기 한도 알림');
}
