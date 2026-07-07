/**
 * operator-prep-reminder.ts — 월간 캠페인 D-2 사전 준비 문자 (2026-07-02, Harold 확정)
 *                             + 승인 대기 만료 임박 리마인드 (2026-07-07, 마케팅 캘린더 완비)
 *
 * 마케팅 캘린더/월간 오퍼레이터는 등록 시점과 발송 시점 사이에 혜택·전략상품이 달라진다.
 * 발송 2일 전 담당자에게 "예정 안내 + 혜택 입력/갱신 요청" 문자를 보내 그때그때 값을 챙기게 한다.
 * (혜택 미입력 placeholder 잔존 시 발송 보류(admin_review) 전환은 dispatchProposalSend의
 *  hasUneditedBenefitPlaceholder 출구 가드가 코드로 보장 — 2026-07-07 실구현.)
 *
 * 실행 = 매일 9시 predictive 사이클(무과금 인증 라인). 대상 = monthly + yearly(2026-07-05 캘린더 시즌) 활성
 * 오퍼레이터 중 다음 발송 희망일이 KST 기준 오늘+2일인 것. 멱등 = continuous_operators.prep_reminder_sent_for(date)
 * — 같은 발송일에 1회만(수동 run-now 재실행에도 중복 0). 컬럼 미생성 = 전체 skip(ALTER 후 자동 활성).
 */

import { query } from '../config/database';
import { computeNextOccurrence, buildPrepReminderBody, decideExpiryReminder, buildExpiryReminderBody } from './autosend-policy';
import { kstDateTag } from './ai-credit-calc';
import { notifyOperatorAdmins } from './continuous-operator';

export async function sendMonthlyPrepReminders(
  companyId: string,
  now: Date = new Date(),
): Promise<{ notified: number; skipped: boolean }> {
  let rows: any[] = [];
  try {
    const r = await query(
      `SELECT id, name, schedule, schedule_time, schedule_day_of_month, schedule_month, benefit_content,
              admin_phone_numbers, backup_admin_phone, prep_reminder_sent_for
         FROM continuous_operators
        WHERE company_id = $1::uuid AND status = 'active' AND schedule IN ('monthly', 'yearly')`,
      [companyId],
    );
    rows = r.rows;
  } catch (err: any) {
    if ((err?.message || '').includes('does not exist')) {
      console.warn('[PrepReminder] prep_reminder_sent_for 미생성 — 사전 준비 문자 skip (ALTER 대기)');
      return { notified: 0, skipped: true };
    }
    throw err;
  }

  const targetTag = kstDateTag(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)); // 오늘+2일 (KST)
  let notified = 0;

  for (const row of rows) {
    try {
      const sendAt = computeNextOccurrence(row.schedule === 'yearly' ? 'yearly' : 'monthly', row.schedule_time, null, row.schedule_day_of_month ?? null, row.schedule_month ?? null, now);
      if (kstDateTag(sendAt) !== targetTag) continue;
      const sentFor = row.prep_reminder_sent_for ? kstDateTag(new Date(row.prep_reminder_sent_for)) : null;
      // date 컬럼은 자정(UTC) 해석 시 KST 태그가 어긋날 수 있어 문자열 비교도 함께 — YYYY-MM-DD 원본 대조
      const sentForRaw = row.prep_reminder_sent_for ? String(row.prep_reminder_sent_for).slice(0, 10).replace(/-/g, '') : null;
      if (sentFor === targetTag || sentForRaw === targetTag) continue;

      const when = sendAt.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      });
      await notifyOperatorAdmins(
        {
          adminPhoneNumbers: Array.isArray(row.admin_phone_numbers) ? row.admin_phone_numbers : [],
          backupAdminPhone: row.backup_admin_phone || null,
          companyId,
        },
        '[AI 자동마케팅] 캠페인 준비 안내',
        buildPrepReminderBody({
          operatorName: row.name || '',
          sendAtLabel: when,
          benefitContent: row.benefit_content || null,
        }),
      );
      await query(
        `UPDATE continuous_operators
            SET prep_reminder_sent_for = ($2::timestamptz AT TIME ZONE 'Asia/Seoul')::date, updated_at = NOW()
          WHERE id = $1::uuid`,
        [row.id, sendAt.toISOString()],
      );
      notified++;
    } catch (e: any) {
      console.warn('[PrepReminder] 발송 경고:', row.id, e?.message);
    }
  }
  return { notified, skipped: false };
}

/**
 * 승인 대기(pending) 만료 임박 리마인드 — 2026-07-07 마케팅 캘린더 완비 (Harold 확정).
 *
 * 자율발송 OFF 회사의 제안은 승인 없이 7일 만료(expired)되면 그 회차 캠페인이 소리 없이 무산된다
 * (yearly 시즌 캠페인은 다음 기회가 내년). 생성 시점 승인 대기 통지에 더해, 만료 3일 안으로 들어오면
 * 마지막 그물로 1회 더 안내한다. 멱등 = operator_proposals.expiry_reminder_sent_at.
 * 컬럼 미생성 = 전체 skip(ALTER 후 자동 활성 — prep_reminder_sent_for와 동일 양립 패턴).
 */
export async function sendPendingExpiryReminders(
  companyId: string,
  now: Date = new Date(),
): Promise<{ notified: number; skipped: boolean }> {
  let rows: any[] = [];
  try {
    const r = await query(
      `SELECT p.id, p.status, p.expires_at, p.expiry_reminder_sent_at, p.recipient_count, p.cost_estimate,
              o.name AS operator_name, o.created_by, o.admin_phone_numbers, o.backup_admin_phone
         FROM operator_proposals p
         JOIN continuous_operators o ON p.operator_id = o.id
        WHERE p.company_id = $1::uuid AND p.status = 'pending'
          AND p.expiry_reminder_sent_at IS NULL
          AND p.expires_at > NOW() AND p.expires_at <= NOW() + INTERVAL '3 days'`,
      [companyId],
    );
    rows = r.rows;
  } catch (err: any) {
    if ((err?.message || '').includes('does not exist')) {
      console.warn('[ExpiryReminder] expiry_reminder_sent_at 미생성 — 만료 리마인드 skip (ALTER 대기)');
      return { notified: 0, skipped: true };
    }
    throw err;
  }

  let notified = 0;
  for (const row of rows) {
    try {
      // WHERE와 이중 판정(순수 함수) — 시각 경계·상태를 테스트로 고정한 단일 기준.
      const due = decideExpiryReminder(
        {
          status: row.status,
          expiresAt: row.expires_at ? new Date(row.expires_at) : null,
          reminderSentAt: row.expiry_reminder_sent_at ? new Date(row.expiry_reminder_sent_at) : null,
        },
        now,
      );
      if (!due) continue;
      const expiresLabel = new Date(row.expires_at).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      });
      await notifyOperatorAdmins(
        {
          adminPhoneNumbers: Array.isArray(row.admin_phone_numbers) ? row.admin_phone_numbers : [],
          backupAdminPhone: row.backup_admin_phone || null,
          companyId,
          createdBy: row.created_by || null,
        },
        '[AI 자동마케팅] 승인 대기 만료 임박',
        buildExpiryReminderBody({
          operatorName: row.operator_name || '',
          expiresAtLabel: expiresLabel,
          recipientCount: Number(row.recipient_count) || 0,
          costEstimate: Number(row.cost_estimate) || 0,
        }),
      );
      await query(
        `UPDATE operator_proposals SET expiry_reminder_sent_at = NOW() WHERE id = $1::uuid`,
        [row.id],
      );
      notified++;
    } catch (e: any) {
      console.warn('[ExpiryReminder] 발송 경고:', row.id, e?.message);
    }
  }
  return { notified, skipped: false };
}
