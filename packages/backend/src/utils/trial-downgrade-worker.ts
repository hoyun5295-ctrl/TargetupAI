/**
 * CT-17 보조: 30일 PRO 무료체험 자동 강등 Cron Worker (2026-04-22)
 *
 * 🎯 목적
 *   슈퍼관리자가 grant-trial로 부여한 30일 PRO 체험이 만료되면
 *   자동으로 plan_id=FREE(미가입) + subscription_status='trial_expired' 로 전환.
 *   → plan-guard.canUseFeature가 FREE plan 플래그를 기준으로 판정하므로
 *      별도 코드 수정 없이 AI/자동발송/모바일DM 등 자동 잠금.
 *   → customers/campaigns/templates 등 데이터는 유지. 직접발송·기본 기능은 계속 사용 가능.
 *
 * 🕓 실행 주기
 *   매일 04:00 KST (기존 Tomcat 주간 재시작 04시와 겹치지만 PG 작업이라 무관)
 *   ↳ 기준 설계: auto-campaign-worker.ts / alimtalk-jobs.ts 의 setInterval 패턴 준수.
 *
 * 🔒 대상 회사 조건 (★2026-08-16 술어 상수 TRIAL_DOWNGRADE_TARGET_WHERE — SELECT·UPDATE 공유)
 *   - (subscription_status = 'trial' OR plan_id = TRIAL plan) — 두 축 모두 본다.
 *     status만 보면: admin 경로가 status를 'paid' 등으로 덮은 TRIAL 회사가 영구 무료(옛 구멍 — 헤더는
 *     plan_code 기준이라 적혀 있는데 실제 WHERE는 status 단독이던 불일치가 그 구멍을 가렸다).
 *     plan만 보면: status='trial'인데 plan이 다른 조합(BASIC 체험 시절 등)이 안 잡힌다(2026-06-08 교훈).
 *   - trial_expires_at IS NOT NULL AND < NOW() — 만료일 없는 행은 판정 근거가 없어 강등하지 않는다.
 *   ★ 유료 플랜 강등 절대 금지 가드 — 현재 plan이 monthly_price > 0 AND plan_code <> 'TRIAL'이면
 *     강등하지 않고 경고 로그만 남긴다. admin.ts가 상태 단독 변경을 허용해 "유료 plan + status='trial'"
 *     조합이 만들어질 수 있고(2026-08-16 실측 0건 — 예방 장치), 그 회사를 FREE로 덮으면 청구 원장에
 *     0원이 남아 소급 복구가 안 된다. 레거시 유료코드 체험이 이 가드에 걸리면 경고 로그로 드러난다.
 */

import pool, { query } from '../config/database';
import { recordPlanChange, alertPlanChangeFailure } from './plan-change-log';

function log(tag: string, ...args: any[]) {
  console.log(`[trial-downgrade][${tag}]`, ...args);
}

function logErr(tag: string, err: any) {
  console.error(`[trial-downgrade][${tag}] 실패`, err?.message || err);
}

function logWarn(tag: string, ...args: any[]) {
  console.warn(`[trial-downgrade][${tag}]`, ...args);
}

// ════════════════════════════════════════════════════════════
// 강등 대상 술어 — targets SELECT와 회사별 UPDATE가 같은 조건을 공유한다(두 벌 금지).
// 컬럼은 전부 `companies.` 실테이블명으로 한정한다 — 별칭·비한정 참조가 없어 어떤 문맥에서도
// 해석이 유일하다(그래서 SELECT도 companies를 별칭 없이 쓴다).
// ════════════════════════════════════════════════════════════

export const TRIAL_DOWNGRADE_TARGET_WHERE = `
  ( (companies.subscription_status = 'trial'
      OR companies.plan_id IN (SELECT tp.id FROM plans tp WHERE tp.plan_code = 'TRIAL'))
    AND companies.trial_expires_at IS NOT NULL
    AND companies.trial_expires_at < NOW() )`;
// ↑ plan 축은 비상관 IN-서브쿼리다(★2026-08-16 Codex 적대 1R medium 수용). 스칼라 서브쿼리+LIMIT 1은
//   TRIAL 행이 복수면 임의 1행만 비교해 나머지를 조용히 놓치고, 0행이면 NULL 비교로 축이 죽는다.
//   IN은 cardinality 가정이 없다(복수 행 전부 매치·0행이면 축만 침묵·plan_id NULL이면 불참).
//   TRIAL 행 수 이상은 runTrialDowngradeJob이 경고로 노출한다.

/**
 * 유료 플랜 강등 절대 금지 가드 — 조회 시점 검사(경고 로그)와 별개로 UPDATE WHERE에도 동반한다.
 * SELECT와 UPDATE 사이에 요금제 승인이 끼어드는 경쟁까지 DB가 차단한다(가드로 걸러진 행은
 * rowCount 0 = 정상 스킵으로 남고, 다음 실행의 조회 시점 검사가 경고를 다시 남긴다).
 * plan_id NULL(미배정 = 유료 아님 — 2026-08-16 실측 0건)은 IS NULL 분기로 명시 통과시킨다 —
 * `NOT IN`은 좌변 NULL이면 결과가 NULL(차단)이 되는 함정이 있어 분기 없이는 미배정이 잘못 막힌다.
 */
export const PAID_PLAN_DOWNGRADE_GUARD_WHERE = `
  ( companies.plan_id IS NULL
    OR companies.plan_id NOT IN (SELECT gp.id FROM plans gp
                                  WHERE gp.monthly_price > 0 AND gp.plan_code <> 'TRIAL') )`;

// ════════════════════════════════════════════════════════════
// 강등 작업
// ════════════════════════════════════════════════════════════

export async function runTrialDowngradeJob(): Promise<{ downgraded: number }> {
  // FREE plan id 조회 (plans 캐시 대신 매번 조회 — plan_id 바뀔 위험 낮고 안전성 우선)
  const freeRes = await query(
    `SELECT id, COALESCE(ai_credits_per_month, 0) AS base_credits FROM plans WHERE plan_code = 'FREE' LIMIT 1`,
  );
  if (freeRes.rows.length === 0) {
    logErr('job', new Error('FREE plan 미존재'));
    return { downgraded: 0 };
  }
  const freePlanId = freeRes.rows[0].id;
  // ★ 체험 잔여 AI 크레딧 제거 — 강등 시 base를 FREE 월 기본분(=0)으로 리셋. purchased(구매분)는 미변경.
  const freeBaseCredits = Number(freeRes.rows[0].base_credits) || 0;

  // ★ TRIAL 카탈로그 이상 관측(2026-08-16 Codex 적대 1R medium 수용) — 술어의 plan 축은 EXISTS라
  //   행 수와 무관하게 안전하지만, 0행(축 무력화)·복수 행(카탈로그 오염)은 운영 결함이므로 경고로 드러낸다.
  const trialCount = await query(`SELECT count(*)::int AS n FROM plans WHERE plan_code = 'TRIAL'`);
  const trialN = Number(trialCount.rows[0]?.n ?? 0);
  if (trialN !== 1) {
    logWarn('trial-plan', `plans의 TRIAL 행이 ${trialN}개 — 1개가 정상. 카탈로그 확인 필요.`);
  }

  // 만료 대상 일괄 강등 — 술어 상수(status 축 + TRIAL plan 축 + 만료) 공유. 경위는 파일 상단 🔒 절.
  // ⛔ 크레딧 불변식: base만 FREE(0)로 리셋, purchased(구매분) 컬럼 미포함 = 보존.
  // ★ 2026-07-25 일괄 UPDATE → 회사별 트랜잭션(Codex 지적 C).
  //   강등과 이력 기록이 원자적이어야 한다 — 이력을 놓치면 그 뒤 모든 구간의 직전 플랜이 어긋나
  //   청구 금액이 연쇄로 틀어진다. 한 건 실패가 나머지 회사를 막지는 않는다.
  // plan_code·monthly_price는 유료 강등 금지 가드, plan_id는 동일 플랜(FREE→FREE) 이력 생략 판정용
  // (LEFT JOIN — plan 미배정도 행 유지).
  const targets = await query(
    `SELECT companies.id, companies.company_name, companies.plan_id, p.plan_code, p.monthly_price
       FROM companies
       LEFT JOIN plans p ON p.id = companies.plan_id
      WHERE ${TRIAL_DOWNGRADE_TARGET_WHERE}`,
  );

  type TargetRow = { id: string; company_name: string; plan_id: string | null; plan_code: string | null; monthly_price: string | null };
  const rows: Array<{ id: string; company_name: string }> = [];
  for (const t of targets.rows as TargetRow[]) {
    // ★ 유료 플랜 강등 절대 금지 가드(경위 = 파일 상단 🔒 절) — 건너뛰고 경고만 남긴다.
    if (Number(t.monthly_price) > 0 && t.plan_code !== 'TRIAL') {
      logWarn('guard', `유료 플랜(${t.plan_code}) + 체험 상태 조합 — 강등하지 않음. 상태 정합 수동 확인 필요:`,
        `${t.company_name}(${t.id.slice(0, 8)})`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        `UPDATE companies
            SET plan_id                   = $1,
                subscription_status       = 'trial_expired',
                -- ★ 2026-07-28 만료일을 비운다. 남겨 두면 그 회사에 체험을 다시 줄 때
                --   옛 만료일이 살아나 부여 즉시 만료 상태가 된다(WHERE는 갱신 전 값으로 판정되므로 안전).
                trial_expires_at          = NULL,
                ai_credits_base_remaining = $2,
                ai_credits_reset_at       = NOW(),
                updated_at                = NOW()
          WHERE id = $3
            AND ${TRIAL_DOWNGRADE_TARGET_WHERE}
            AND ${PAID_PLAN_DOWNGRADE_GUARD_WHERE}
            -- ★ 2026-08-16 Codex 적대 2R high 수용: 이력 생략 판정(아래 t.plan_id)은 조회 시점 값이다.
            --   조회~갱신 사이 FREE↔TRIAL 전환이 끼면 이력이 누락되거나(실TRIAL→FREE인데 생략)
            --   허위로 남는다(실FREE→FREE인데 기록). 관찰한 plan_id와 다르면 0행으로 스킵해
            --   판정과 갱신을 원자 결합한다 — 스킵된 행은 만료일·상태가 보존되므로 다음 실행이 재관측한다.
            --   (IS NOT DISTINCT FROM 전개형 — NULL(미배정)끼리도 일치로 본다)
            AND (companies.plan_id = $4::uuid OR (companies.plan_id IS NULL AND $4::uuid IS NULL))
        RETURNING id`,
        [freePlanId, freeBaseCredits, t.id, t.plan_id],
      );
      if (upd.rows.length > 0) {
        // ★ 동일 플랜(이미 FREE)이면 플랜 변경 이력을 남기지 않는다(2026-08-16 Codex 적대 1R medium 수용).
        //   plan이 안 바뀌는 상태 청소(FREE+trial 잔존 29건 부류)에 trial_expire 경계를 쓰면 청구 구간
        //   소비처가 FREE→FREE 전이를 해석해야 하는 부담이 생긴다 — 사건이 없으면 기록도 없다.
        //   이 판정이 정확한 근거 = UPDATE WHERE의 plan_id 일치 조건(2R high 수용) — 갱신이 성공했다는
        //   것이 곧 "갱신 직전 plan_id = 여기서 본 t.plan_id"라는 뜻이라 stale 판정이 구조적으로 불가능하다.
        if (t.plan_id === freePlanId) {
          log('cleanup', `상태 청소(FREE 유지·이력 생략): ${t.company_name}(${t.id.slice(0, 8)})`);
        } else {
          await recordPlanChange({
            client,
            companyId: t.id,
            toPlanId: freePlanId,
            changeType: 'trial_expire',
            reason: '무료체험 만료 자동 강등(trial-downgrade-worker)',
          });
        }
        await client.query('COMMIT');
        rows.push(t);
      } else {
        // 조회~갱신 사이에 상태가 바뀐 경우(다른 경로가 먼저 처리) — 정상 스킵
        await client.query('ROLLBACK');
      }
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* 아래 알림에 포함 */ }
      await alertPlanChangeFailure(t.id, err);
    } finally {
      client.release();
    }
  }

  if (rows.length > 0) {
    log('job', `${rows.length}개 회사 FREE(미가입) 강등 완료:`,
      rows.map(r => `${r.company_name}(${r.id.slice(0, 8)})`).join(', '));
  } else {
    log('job', '만료 대상 없음');
  }
  return { downgraded: rows.length };
}

// ════════════════════════════════════════════════════════════
// 스케줄러 부트스트랩 (app.ts listen 콜백에서 1회 호출)
// ════════════════════════════════════════════════════════════

let _scheduled = false;
let _timer: NodeJS.Timeout | null = null;

function msUntilNextKst04(): number {
  // 현재 UTC → KST → 다음 04:00 KST까지 ms
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const target = new Date(kstNow);
  target.setUTCHours(4, 0, 0, 0);
  if (target.getTime() <= kstNow.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - kstNow.getTime();
}

export function startTrialDowngradeWorker(): void {
  if (_scheduled) return;
  _scheduled = true;

  const wait = msUntilNextKst04();
  log('scheduler', `started (next run in ${Math.round(wait / 60000)}분 / 매일 04:00 KST)`);

  _timer = setTimeout(async () => {
    try {
      await runTrialDowngradeJob();
    } catch (err) {
      logErr('first-tick', err);
    }
    // 이후 24시간 주기
    _timer = setInterval(() => {
      runTrialDowngradeJob().catch((e) => logErr('interval', e));
    }, 24 * 60 * 60 * 1000);
  }, wait);
}

export function stopTrialDowngradeWorker(): void {
  if (_timer) {
    clearTimeout(_timer);
    clearInterval(_timer as any);
    _timer = null;
  }
  _scheduled = false;
}
