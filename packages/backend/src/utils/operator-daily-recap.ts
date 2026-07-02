/**
 * operator-daily-recap.ts — 성과 회고 문자 (2026-07-02 2차, Harold 확정)
 *
 * 발송 다음날 아침(매일 9시 predictive 사이클), 어제(KST) 자동마케팅으로 발송된 건의
 * 실측 결과(발송·성공 = campaigns 실컬럼 / 클릭 = operator_proposal_variants.click_count 누적)를
 * 담당자에게 문자로 보고한다. 무과금 인증 라인(notifyOperatorAdmins 단일 경로 — 머리말 자동 부착).
 *
 * 멱등: operator_proposals.recap_notified_at (신규 컬럼) — 회고 1회 발송 후 기록.
 * 컬럼 미생성(마이그레이션 전) = 전체 skip(안전) — ALTER 후 다음 사이클부터 자동 활성.
 */

import { query } from '../config/database';
import { kstYesterdayRange, buildDailyRecapBody } from './autosend-policy';
import { notifyOperatorAdmins } from './continuous-operator';

export async function sendOperatorDailyRecaps(
  companyId: string,
  now: Date = new Date(),
): Promise<{ notified: number; skipped: boolean }> {
  const { start, end, dateLabel } = kstYesterdayRange(now);

  let rows: any[] = [];
  try {
    const r = await query(
      `SELECT p.id, o.name, o.admin_phone_numbers, o.backup_admin_phone,
              COALESCE(c.sent_count, p.recipient_count, 0) AS sent_count,
              COALESCE(c.success_count, 0) AS success_count,
              COALESCE((SELECT SUM(v.click_count) FROM operator_proposal_variants v WHERE v.proposal_id = p.id), 0) AS clicked
         FROM operator_proposals p
         JOIN continuous_operators o ON o.id = p.operator_id
         JOIN campaigns c ON c.id = p.campaign_id
        WHERE p.company_id = $1::uuid
          AND p.status = 'sent'
          AND p.campaign_id IS NOT NULL
          AND p.auto_sent_at >= $2
          AND p.auto_sent_at < $3
          AND p.recap_notified_at IS NULL`,
      [companyId, start.toISOString(), end.toISOString()],
    );
    rows = r.rows;
  } catch (err: any) {
    if ((err?.message || '').includes('does not exist')) {
      console.warn('[OperatorRecap] recap_notified_at 미생성 — 회고 skip (ALTER 대기)');
      return { notified: 0, skipped: true };
    }
    throw err;
  }

  let notified = 0;
  for (const row of rows) {
    try {
      await notifyOperatorAdmins(
        {
          adminPhoneNumbers: Array.isArray(row.admin_phone_numbers) ? row.admin_phone_numbers : [],
          backupAdminPhone: row.backup_admin_phone || null,
          companyId,
        },
        '[AI 자동마케팅] 어제 발송 결과',
        buildDailyRecapBody({
          operatorName: row.name || '',
          dateLabel,
          sentCount: Number(row.sent_count) || 0,
          successCount: Number(row.success_count) || 0,
          clickedCount: Number(row.clicked) || 0,
        }),
      );
      // 수신처가 비어 있어도 기록 — 대상 없는 회고를 매일 재시도하지 않는다.
      await query(`UPDATE operator_proposals SET recap_notified_at = NOW() WHERE id = $1::uuid`, [row.id]);
      notified++;
    } catch (e: any) {
      console.warn('[OperatorRecap] 회고 발송 경고:', row.id, e?.message);
    }
  }
  return { notified, skipped: false };
}
