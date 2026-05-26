/**
 * ★ CT-98: Daily Insight Mailer — D219+ Part 2 (2026-05-27 신설)
 *
 * 🎯 목적
 *   Wizard step 7 종결 후 = 매일 9시 회사 admin 이메일로 자동 인사이트 메일 발송.
 *   한 달 안 30번 자동 가치 증명 흐름 = 사용자 가치 인지 영속화.
 *
 *   Harold 명시 본질 (2026-05-26): "매일 9시 자동 인사이트 메일 기본 ON".
 *
 * 🕓 실행 주기
 *   매 시간 정각 (1시간 cron) — 9시 정각만 실제 발송 진입.
 *
 * 🔒 발송 대상 조건
 *   - onboarding_wizard_state.daily_insight_enabled = true
 *   - companies.ai_operator_trial_until > NOW() (체험 활성 영역)
 *   - 오늘 미발송 (daily_insight_email_log UNIQUE (company_id, sent_date))
 *
 * 🗄️ DB 매트릭스 (Harold 직접 PG)
 *   CREATE TABLE daily_insight_email_log (
 *     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     company_id uuid NOT NULL,
 *     sent_date date NOT NULL,
 *     recipient_email varchar(255) NOT NULL,
 *     send_status varchar(20) NOT NULL,
 *     insight_summary text,
 *     error_message text,
 *     sent_at timestamptz DEFAULT now()
 *   );
 *   CREATE UNIQUE INDEX idx_diel_company_date ON daily_insight_email_log(company_id, sent_date);
 */

import { query } from '../config/database';
import { sendEmail, isSmtpConfigured } from './company-smtp-client';

function log(tag: string, ...args: any[]) {
  console.log(`[daily-insight-mailer][${tag}]`, ...args);
}

function logErr(tag: string, err: any) {
  console.error(`[daily-insight-mailer][${tag}] 실패`, err?.message || err);
}

// ════════════════════════════════════════════════════════════════════
// 인사이트 생성
// ════════════════════════════════════════════════════════════════════

export interface CompanyInsight {
  companyId: string;
  companyName: string;
  recipientEmail: string;
  yesterdaySent: number;
  yesterdaySuccess: number;
  yesterdayFail: number;
  totalCustomers: number;
  trialDaysRemaining: number;
}

/**
 * 회사별 일일 인사이트 수집 — 매일 9시 메일 + Performance 카드 양쪽 활용.
 * D219+ Part 2 후속 (2026-05-27): export 정정 (옛 internal 함수 → 단일 진입점).
 */
export async function collectCompanyInsight(companyId: string): Promise<CompanyInsight | null> {
  try {
    const company = await query(
      `SELECT c.id, c.company_name, c.contact_email, c.ai_operator_trial_until
         FROM companies c
        WHERE c.id = $1`,
      [companyId],
    );
    if (company.rows.length === 0) return null;
    const c = company.rows[0];
    if (!c.contact_email) return null;

    const trialUntil = c.ai_operator_trial_until ? new Date(c.ai_operator_trial_until) : null;
    const daysRemaining = trialUntil
      ? Math.max(0, Math.ceil((trialUntil.getTime() - Date.now()) / 86400000))
      : 0;

    // customers 카운트
    const custCount = await query(
      `SELECT COUNT(*)::int AS cnt FROM customers WHERE company_id = $1 AND is_active = true`,
      [companyId],
    );

    return {
      companyId,
      companyName: String(c.company_name || ''),
      recipientEmail: String(c.contact_email),
      yesterdaySent: 0,        // 향후 sms_send_results 통계 통합 영역 (현 시점 = 0 default)
      yesterdaySuccess: 0,
      yesterdayFail: 0,
      totalCustomers: Number(custCount.rows[0]?.cnt || 0),
      trialDaysRemaining: daysRemaining,
    };
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      log('collect', `DB ALTER 미실행 — 회사 ${companyId.slice(0, 8)} skip`);
      return null;
    }
    throw err;
  }
}

function buildInsightHtml(insight: CompanyInsight): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Pretendard', -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #0f172a; color: #e2e8f0;">
  <div style="background: linear-gradient(135deg, #7c3aed, #d946ef); padding: 24px; border-radius: 16px; margin-bottom: 24px;">
    <h1 style="margin: 0 0 8px; color: white; font-size: 20px;">${insight.companyName} 일일 인사이트</h1>
    <p style="margin: 0; color: rgba(255,255,255,0.85); font-size: 13px;">AI 오퍼레이션 무료체험 D-${insight.trialDaysRemaining}</p>
  </div>

  <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin-bottom: 16px;">
    <p style="margin: 0 0 12px; font-size: 14px; color: #cbd5e1;">📊 어제 발송 결과</p>
    <div style="display: flex; gap: 16px; flex-wrap: wrap;">
      <div><span style="font-size: 24px; font-weight: bold; color: #a78bfa;">${insight.yesterdaySent}</span><br><span style="font-size: 11px; color: #94a3b8;">발송</span></div>
      <div><span style="font-size: 24px; font-weight: bold; color: #34d399;">${insight.yesterdaySuccess}</span><br><span style="font-size: 11px; color: #94a3b8;">성공</span></div>
      <div><span style="font-size: 24px; font-weight: bold; color: #fb7185;">${insight.yesterdayFail}</span><br><span style="font-size: 11px; color: #94a3b8;">실패</span></div>
    </div>
  </div>

  <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin-bottom: 16px;">
    <p style="margin: 0 0 8px; font-size: 14px; color: #cbd5e1;">👥 활성 고객</p>
    <p style="margin: 0; font-size: 28px; font-weight: bold; color: #f0abfc;">${insight.totalCustomers.toLocaleString()}명</p>
  </div>

  <div style="background: rgba(124, 58, 237, 0.15); border: 1px solid rgba(124, 58, 237, 0.3); border-radius: 12px; padding: 20px; margin-bottom: 16px;">
    <p style="margin: 0 0 8px; font-size: 14px; color: #cbd5e1;">💡 오늘의 추천</p>
    <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #e2e8f0;">
      ${insight.totalCustomers === 0
        ? '고객 데이터를 임포트하면 첫 발송이 가능합니다.'
        : insight.yesterdaySent === 0
        ? '어제 발송이 없었습니다. AI 자동 마케팅을 활용해보세요.'
        : '꾸준한 발송이 이어지고 있습니다. 성과를 분석해 다음 캠페인을 정교화하세요.'}
    </p>
  </div>

  <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1);">
    <a href="https://hanjul.ai/dashboard" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">대시보드 열기</a>
  </div>

  <p style="margin-top: 32px; font-size: 11px; color: #64748b; text-align: center; line-height: 1.6;">
    본 메일은 한줄로 AI 오퍼레이션 무료체험 기간 안 매일 자동 발송됩니다.<br>
    수신 거부는 대시보드 → 설정 → 알림 메뉴에서 가능합니다.
  </p>
</body>
</html>`;
}

// ════════════════════════════════════════════════════════════════════
// 발송
// ════════════════════════════════════════════════════════════════════

async function sendInsightEmailForCompany(insight: CompanyInsight): Promise<{ ok: boolean; error?: string }> {
  // SMTP 설정 검증 — 미설정 회사 = skip
  if (!(await isSmtpConfigured(insight.companyId))) {
    return { ok: false, error: 'SMTP 미설정 회사 — skip' };
  }

  const html = buildInsightHtml(insight);
  const subject = `📊 ${insight.companyName} 일일 인사이트 (체험 D-${insight.trialDaysRemaining})`;

  try {
    await sendEmail({
      companyId: insight.companyId,
      to: insight.recipientEmail,
      subject,
      htmlBody: html,
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function logInsightSend(
  companyId: string,
  email: string,
  status: 'success' | 'failed' | 'skipped',
  summary: string,
  error?: string,
): Promise<void> {
  try {
    await query(
      `INSERT INTO daily_insight_email_log (company_id, sent_date, recipient_email, send_status, insight_summary, error_message)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)
       ON CONFLICT (company_id, sent_date) DO UPDATE
         SET send_status = EXCLUDED.send_status,
             error_message = EXCLUDED.error_message,
             sent_at = NOW()`,
      [companyId, email, status, summary, error || null],
    );
  } catch (err: any) {
    const msg = err?.message || '';
    if (!(msg.includes('relation') && msg.includes('does not exist'))) {
      logErr('log-insert', err);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// 메인 tick
// ════════════════════════════════════════════════════════════════════

export async function runDailyInsightTick(): Promise<{ sent: number; failed: number; skipped: number }> {
  // KST 9시 정각만 실제 발송 진입
  const now = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  if (kstHour !== 9) {
    log('tick', `KST ${kstHour}시 — 9시 아님, skip`);
    return { sent: 0, failed: 0, skipped: 0 };
  }

  let candidates: Array<{ company_id: string; user_id: string }>;
  try {
    const res = await query(
      `SELECT DISTINCT ows.company_id, ows.user_id
         FROM onboarding_wizard_state ows
         JOIN companies c ON c.id = ows.company_id
        WHERE ows.daily_insight_enabled = true
          AND c.ai_operator_trial_until IS NOT NULL
          AND c.ai_operator_trial_until > NOW()
          AND NOT EXISTS (
            SELECT 1 FROM daily_insight_email_log diel
             WHERE diel.company_id = ows.company_id
               AND diel.sent_date = CURRENT_DATE
               AND diel.send_status = 'success'
          )`,
    );
    candidates = res.rows;
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('relation') && msg.includes('does not exist')) {
      log('tick', 'DB 마이그레이션 미실행 — onboarding_wizard_state 또는 daily_insight_email_log 테이블 없음');
      return { sent: 0, failed: 0, skipped: 0 };
    }
    if (msg.includes('column') && msg.includes('does not exist')) {
      log('tick', 'DB 마이그레이션 미실행 — ai_operator_trial_until 컬럼 없음');
      return { sent: 0, failed: 0, skipped: 0 };
    }
    throw err;
  }

  log('tick', `발송 대상 ${candidates.length}개 회사`);

  let sent = 0, failed = 0, skipped = 0;
  for (const row of candidates) {
    try {
      const insight = await collectCompanyInsight(row.company_id);
      if (!insight) {
        skipped++;
        await logInsightSend(row.company_id, '', 'skipped', '인사이트 조회 실패');
        continue;
      }
      const result = await sendInsightEmailForCompany(insight);
      if (result.ok) {
        sent++;
        await logInsightSend(row.company_id, insight.recipientEmail, 'success', `발송 ${insight.yesterdaySent} / 활성 고객 ${insight.totalCustomers}`);
      } else {
        failed++;
        await logInsightSend(row.company_id, insight.recipientEmail, 'failed', '', result.error);
      }
    } catch (err: any) {
      failed++;
      logErr('per-company', err);
    }
  }

  log('tick', `발송 완료 — 성공 ${sent} / 실패 ${failed} / skip ${skipped}`);
  return { sent, failed, skipped };
}

// ════════════════════════════════════════════════════════════════════
// 스케줄러 부트스트랩
// ════════════════════════════════════════════════════════════════════

let _scheduled = false;
let _timer: NodeJS.Timeout | null = null;

function msUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(now.getHours() + 1);
  return next.getTime() - now.getTime();
}

export function startDailyInsightMailer(): void {
  if (_scheduled) return;
  _scheduled = true;

  const wait = msUntilNextHour();
  log('scheduler', `started (next tick in ${Math.round(wait / 60000)}분 / 매 시간 정각 — 9시 KST 정각만 발송)`);

  _timer = setTimeout(async () => {
    try {
      await runDailyInsightTick();
    } catch (err) {
      logErr('first-tick', err);
    }
    _timer = setInterval(() => {
      runDailyInsightTick().catch((e) => logErr('interval', e));
    }, 60 * 60 * 1000);
  }, wait);
}

export function stopDailyInsightMailer(): void {
  if (_timer) {
    clearTimeout(_timer);
    clearInterval(_timer as any);
    _timer = null;
  }
  _scheduled = false;
}
