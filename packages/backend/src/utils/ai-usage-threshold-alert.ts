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
import { getCreditState, type CreditState } from './ai-credit';
import { isDemoCompany } from './demo-company';
import { releaseUnusedOperationCredits } from './journey-operation-release';

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

/**
 * ★ 2026-10-20 여정 V.3 D1(설계서 §5-6) — 켜진 여정이 있는 회사의 이번 달 크레딧이 월 기본의 20% 밑으로 내려가면 달마다 한 번 담당자에게 알린다.
 *   크레딧을 다 쓰면 선불 · 후불 모두 여정이 멈춘다(실행기 reserveJourneyOperationCredit) → 멈추기 전에 고객사가 요금제 상향 · 충전을 정하게.
 *   새 알림 길을 만들지 않는다: 위 AI 사용량 알림과 같은 담당자 무과금 안내 문자(notifyOperatorAdmins) · 같은 선점 방식(같은 jsonb 의 다른 키).
 */
export function shouldAlertJourneyCredit(st: Pick<CreditState, 'creditEnabled' | 'planCredits' | 'total'>): boolean {
  if (!st.creditEnabled) return false;
  const plan = Number(st.planCredits) || 0;
  if (plan <= 0) return false;
  return Number(st.total) < plan * 0.2;
}

export async function runJourneyCreditAlerts(): Promise<{ alerted: number }> {
  const r = await query(
    `SELECT DISTINCT j.company_id AS id
       FROM journeys j
      WHERE j.status = 'active' AND j.archived_at IS NULL`,
  );
  const month = kstMonthString();
  let alerted = 0;
  for (const row of r.rows as Array<{ id: string }>) {
    try {
      const companyId = String(row.id);
      if (await isDemoCompany(companyId)) continue;
      const st = await getCreditState(companyId);
      if (!shouldAlertJourneyCredit(st)) continue;
      const claim = await query(
        `UPDATE companies
            SET ai_usage_threshold_config = COALESCE(ai_usage_threshold_config, '{}'::jsonb) || jsonb_build_object('journey_credit_alert_month', $2::text)
          WHERE id = $1::uuid
            AND COALESCE(ai_usage_threshold_config->>'journey_credit_alert_month', '') <> $2
          RETURNING id`,
        [companyId, month],
      );
      if (claim.rows.length === 0) continue;
      const title = '[한줄로 크레딧 안내]';
      const body = `이번 달 남은 크레딧이 ${Number(st.total).toLocaleString()}이에요(한 달 기본 ${Number(st.planCredits).toLocaleString()}). 크레딧을 다 쓰면 켜 둔 여정이 멈춰요. 여정을 많이 돌리시면 요금제 상향을 신청해 주세요.`;
      await notifyOperatorAdmins(
        { adminPhoneNumbers: [], backupAdminPhone: null, companyId, createdBy: null },
        title,
        body,
        { noticeHeader: title },
      ).catch((e: any) => console.warn('[Journey Credit Alert] 문자 적재 실패:', companyId, e?.message));
      alerted += 1;
      console.log(`[Journey Credit Alert] company=${companyId} 남은 ${st.total} < 월 기본 ${st.planCredits}의 20% → 알림`);
    } catch (e: any) {
      console.warn('[Journey Credit Alert] 회사 처리 경고:', row.id, e?.message);
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
      .then(async () => { await runJourneyCreditAlerts(); })
      .catch((e: any) => console.error('[Journey Credit Alert] 스캔 오류:', e?.message))
      // ★ V.3 Codex 적대 A 2R — 보내기 전 잡아 둔 운영 크레딧 중 그날 한 통도 안 나간 날은 하루가 끝난 뒤 되돌린다(보낸 날만 과금).
      .then(async () => { await releaseUnusedOperationCredits(); })
      .catch((e: any) => console.error('[Journey Operation Release] 스캔 오류:', e?.message))
      .finally(() => { running = false; });
  }, INTERVAL_MS);
  console.log('[AI Usage Alert] 시작 — 10분 주기 한도 알림');
}
