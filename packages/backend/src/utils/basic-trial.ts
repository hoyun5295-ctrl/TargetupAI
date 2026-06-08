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

import { query } from '../config/database';

/** BASIC 무료체험 부여. 부여된 companies 행 반환. BASIC 요금제 미존재 시 throw. */
export async function grantBasicTrial(companyId: string, days = 30): Promise<any> {
  const basic = await query(
    `SELECT id, COALESCE(ai_credits_per_month, 0) AS credits
       FROM plans WHERE plan_code = 'BASIC' AND is_active = true LIMIT 1`,
  );
  if (basic.rows.length === 0) throw new Error('BASIC 요금제가 존재하지 않습니다.');
  const basicPlanId = basic.rows[0].id;
  const basicCredits = Number(basic.rows[0].credits) || 0;

  const updated = await query(
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
  return updated.rows[0];
}
