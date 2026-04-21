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
 * 🔒 대상 회사 조건
 *   - plan_code = 'TRIAL' (무료체험 plan)
 *   - trial_expires_at IS NOT NULL AND trial_expires_at < NOW()
 *   ※ subscription_status 조건은 의도적으로 제거 — admin.ts 요금제 승인 등 다른 경로가 'paid'로 덮어쓰는 케이스가 있어
 *     'trial'만 검사하면 체험이 영원히 강등 안 되는 치명 버그 발생. plan_code='TRIAL'은 grant/revoke/Cron 3곳에서만 바뀌므로 견고함.
 *   ※ 정식 구독은 plan_code가 STARTER/BASIC/PRO/BUSINESS/ENTERPRISE로 바뀌므로 자동 제외됨.
 */

import { query } from '../config/database';

function log(tag: string, ...args: any[]) {
  console.log(`[trial-downgrade][${tag}]`, ...args);
}

function logErr(tag: string, err: any) {
  console.error(`[trial-downgrade][${tag}] 실패`, err?.message || err);
}

// ════════════════════════════════════════════════════════════
// 강등 작업
// ════════════════════════════════════════════════════════════

export async function runTrialDowngradeJob(): Promise<{ downgraded: number }> {
  // FREE plan id 조회 (plans 캐시 대신 매번 조회 — plan_id 바뀔 위험 낮고 안전성 우선)
  const freeRes = await query(
    `SELECT id FROM plans WHERE plan_code = 'FREE' LIMIT 1`,
  );
  if (freeRes.rows.length === 0) {
    logErr('job', new Error('FREE plan 미존재'));
    return { downgraded: 0 };
  }
  const freePlanId = freeRes.rows[0].id;

  // 만료 대상 일괄 강등 (plan_code='TRIAL' + 만료됨)
  // ※ subscription_status 조건 없음 — 'trial'/'paid' 어느 쪽으로 바뀌어 있어도 강등. plan_code가 진실의 원천.
  const res = await query(
    `UPDATE companies c
        SET plan_id             = $1,
            subscription_status = 'trial_expired',
            updated_at          = NOW()
       FROM plans p
      WHERE c.plan_id = p.id
        AND p.plan_code = 'TRIAL'
        AND c.trial_expires_at IS NOT NULL
        AND c.trial_expires_at < NOW()
    RETURNING c.id, c.company_name`,
    [freePlanId],
  );

  const rows = res.rows as Array<{ id: string; company_name: string }>;
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
