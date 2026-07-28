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

/**
 * 무료체험 부여·연장. 부여된 companies 행(+`extended`) 반환. TRIAL 요금제 미존재 시 throw.
 *
 * ★ 2026-07-28 배정 플랜을 BASIC → **TRIAL**로 바꿨다(Harold 지시).
 *   - 전에는 체험에 BASIC(월 350,000원)을 배정해서 **요금제 이력에 35만원이 스냅샷으로 남았다.**
 *     그 값이 그대로 청구 근거가 되므로 체험 기간이 유상으로 잡히는 구조였다.
 *     TRIAL은 월 0원이라 애초에 청구될 금액이 없다.
 *   - 기능 권한은 TRIAL 요금제 플래그를 따르므로, **TRIAL의 플래그를 BASIC과 동일하게** 맞춰 둬야
 *     체험자가 쓰던 기능을 잃지 않는다(2026-07-28 실측: cdp_enabled·cdp_events_per_month·
 *     ai_credits_per_month 세 칸이 BASIC보다 좁았다 → 동일화 적용).
 *
 * ★ 2026-07-28 **추가 부여(연장)** 지원.
 *   - 만료일: 남은 기간이 있으면 그 위에 더하고, 없거나 지났으면 오늘부터 센다.
 *     전에는 `NOW() + N일`로 덮어써서 **남은 일수가 날아갔다.**
 *   - 크레딧: **연장에서는 건드리지 않는다.** 연장할 때마다 월 기본분을 다시 채우면 과다 지급이 된다
 *     (같은 계열 사고 경고 = plan-change-log.ts 크레딧 일할 주석).
 */
export async function grantFreeTrial(
  companyId: string,
  days = 30,
): Promise<any> {
  const trial = await query(
    `SELECT id, COALESCE(ai_credits_per_month, 0) AS credits
       FROM plans WHERE plan_code = 'TRIAL' AND is_active = true LIMIT 1`,
  );
  if (trial.rows.length === 0) throw new Error('무료체험 요금제가 존재하지 않습니다.');
  const trialPlanId = trial.rows[0].id;
  const trialCredits = Number(trial.rows[0].credits) || 0;

  // ★ 2026-07-25 플랜 변경과 이력 기록을 한 트랜잭션으로 묶는다(Codex 지적 C).
  //   이력을 놓치면 그 뒤 모든 구간의 직전 플랜이 어긋나 청구 금액이 연쇄로 틀어진다.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 연장인지 신규인지는 **잠근 행의 갱신 전 값**으로 판정한다(동시 클릭이 서로의 판정을 오염시키지 않게).
    const cur = await client.query(
      `SELECT subscription_status, trial_expires_at FROM companies WHERE id = $1::uuid FOR UPDATE`,
      [companyId],
    );
    if (cur.rows.length === 0) throw new Error('고객사를 찾을 수 없습니다.');
    const curExpiry = cur.rows[0].trial_expires_at ? new Date(cur.rows[0].trial_expires_at) : null;
    const extended =
      cur.rows[0].subscription_status === 'trial' &&
      curExpiry !== null &&
      curExpiry.getTime() > Date.now();

    const updated = await client.query(
      `UPDATE companies
          SET plan_id                   = $1,
              subscription_status       = 'trial',
              -- 남은 기간이 미래면 그 위에 더한다(연장). 없거나 지났으면 오늘부터.
              trial_expires_at          = GREATEST(COALESCE(trial_expires_at, NOW()), NOW())
                                          + ($2::int || ' days')::interval,
              -- ⛔ 크레딧 불변식: 연장에서는 base를 그대로 둔다(재충전 금지). purchased는 어느 경우든 미포함 = 보존.
              ai_credits_base_remaining = CASE WHEN $5::boolean THEN ai_credits_base_remaining ELSE $3 END,
              ai_credits_reset_at       = CASE WHEN $5::boolean THEN ai_credits_reset_at ELSE NOW() END,
              updated_at                = NOW()
        WHERE id = $4
      RETURNING id, plan_id, subscription_status, trial_expires_at,
                (SELECT plan_code FROM plans WHERE id = $1) AS plan_code`,
      [trialPlanId, days, trialCredits, companyId, extended],
    );

    if (updated.rows.length > 0) {
      await recordPlanChange({
        client,
        companyId,
        toPlanId: trialPlanId,
        changeType: 'trial_start',
        reason: extended ? `무료체험 ${days}일 추가 부여` : `무료체험 ${days}일 부여`,
      });
    }

    await client.query('COMMIT');
    return { ...updated.rows[0], extended };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 롤백 실패는 아래 알림에 포함 */ }
    await alertPlanChangeFailure(companyId, err);
    throw err;
  } finally {
    client.release();
  }
}
