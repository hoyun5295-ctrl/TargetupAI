/**
 * ★ CT: BASIC 1개월 무료체험 부여 (2026-06-08)
 *
 * plan=BASIC + subscription_status='trial' + trial_expires_at(+N일) + base 크레딧 = BASIC(ai_credits_per_month).
 * 슈퍼관리자 승인(admin.ts approve) + 고객사 상세 부여 버튼(companies.ts grant-basic-trial) 공유 단일 진입점
 * (no_inline_duplication). 만료 자동 강등 = trial-downgrade-worker (subscription_status='trial' 기준).
 *
 * ⛔ 크레딧 불변식 (Harold 강조 — 매우 중요)
 *   - base(기본 부여) 크레딧만 갱신: ai_credits_base_remaining + ai_credits_reset_at.
 *   - purchased(구매분) 컬럼은 SQL에 포함하지 않음 = 보존(월 넘어가도 이월).
 */

import pool, { query } from '../config/database';
import { recordPlanChange, alertPlanChangeFailure } from './plan-change-log';

/**
 * ★ 무료체험 신청 마감 (Harold 확정 2026-06-11): 2026-06-30 23:59:59 KST까지만 신청 접수.
 *   UTC 표기 = 2026-06-30T14:59:59.999Z (KST = UTC+9 — 서버 TZ와 무관하게 동일 epoch).
 *   frontend 대응 상수 = packages/frontend/src/components/OpenTrialPopup.tsx TRIAL_APPLY_DEADLINE_MS
 *   (마감 변경 시 양쪽 동시 수정 의무).
 */
export const TRIAL_APPLY_DEADLINE = new Date('2026-06-30T14:59:59.999Z');

/** 무료체험 신청 가능 기간 여부 (마감 시각 포함) */
export function isTrialApplyOpen(now: Date = new Date()): boolean {
  return now.getTime() <= TRIAL_APPLY_DEADLINE.getTime();
}

/** BASIC 무료체험 부여. 부여된 companies 행 반환. BASIC 요금제 미존재 시 throw. */
export async function grantBasicTrial(companyId: string, days = 30): Promise<any> {
  const basic = await query(
    `SELECT id, COALESCE(ai_credits_per_month, 0) AS credits
       FROM plans WHERE plan_code = 'BASIC' AND is_active = true LIMIT 1`,
  );
  if (basic.rows.length === 0) throw new Error('BASIC 요금제가 존재하지 않습니다.');
  const basicPlanId = basic.rows[0].id;
  const basicCredits = Number(basic.rows[0].credits) || 0;

  // ★ 2026-07-25 플랜 변경과 이력 기록을 한 트랜잭션으로 묶는다(Codex 지적 C).
  //   이력을 놓치면 그 뒤 모든 구간의 직전 플랜이 어긋나 청구 금액이 연쇄로 틀어진다.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE companies
          SET plan_id                   = $1,
              subscription_status       = 'trial',
              trial_expires_at          = NOW() + ($2::int || ' days')::interval,
              ai_credits_base_remaining = $3,
              ai_credits_reset_at       = NOW(),
              updated_at                = NOW()
        WHERE id = $4
      RETURNING id, plan_id, subscription_status, trial_expires_at,
                (SELECT plan_code FROM plans WHERE id = $1) AS plan_code`,
      [basicPlanId, days, basicCredits, companyId],
    );

    if (updated.rows.length > 0) {
      await recordPlanChange({
        client,
        companyId,
        toPlanId: basicPlanId,
        changeType: 'trial_start',
        reason: `BASIC 무료체험 ${days}일 부여`,
      });
    }

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 롤백 실패는 아래 알림에 포함 */ }
    await alertPlanChangeFailure(companyId, err);
    throw err;
  } finally {
    client.release();
  }
}
