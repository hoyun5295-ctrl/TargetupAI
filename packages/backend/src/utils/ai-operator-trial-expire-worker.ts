/**
 * ★ D219+ Part 2 (2026-05-27 신설) — AI 오퍼레이션 30일 무료체험 자동 만료 Cron Worker
 *
 * 🎯 목적
 *   슈퍼관리자가 grant-ai-operator-trial로 부여한 30일 AI 오퍼레이션 무료체험이
 *   만료 시 = 별도 SET 의무 X (게이팅 함수 plan-guard.isAiOperatorAllowed가 NOW() 비교로 자동 차단).
 *   본 worker는 매일 04:00 KST = 만료 회사 카운트 + 로그만 출력 (운영 가시성 + 종결 회사 통계).
 *
 *   ※ 기존 trial-downgrade-worker.ts (PRO 무료체험 자동 강등)와 완전히 분리.
 *     · PRO 무료체험 = plan_id 전체 변경 의무 (TRIAL → FREE) → 별도 worker 의무.
 *     · AI 오퍼레이션 무료체험 = plan_code 변경 X + ai_operator_trial_until 비교만 → SET 의무 X.
 *
 * 🕓 실행 주기
 *   매일 04:00 KST (trial-downgrade-worker.ts 동일 시점 — PG 작업 무관 동시 진입).
 *
 * 🔒 대상 회사 조건
 *   - ai_operator_trial_started_at IS NOT NULL
 *   - ai_operator_trial_until < NOW()
 *   - 단순 로그만 출력 (운영 가시성 — PM2 로그 grep 가능)
 */

import { query } from '../config/database';

function log(tag: string, ...args: any[]) {
  console.log(`[ai-operator-trial-expire][${tag}]`, ...args);
}

function logErr(tag: string, err: any) {
  console.error(`[ai-operator-trial-expire][${tag}] 실패`, err?.message || err);
}

// ════════════════════════════════════════════════════════════
// 만료 회사 카운트 + 로그 (별도 SET 없음 — 게이팅 함수 자동 차단 정합)
// ════════════════════════════════════════════════════════════

export async function runAiOperatorTrialExpireJob(): Promise<{ expired: number }> {
  try {
    const res = await query(
      `SELECT id, company_name, ai_operator_trial_started_at, ai_operator_trial_until
         FROM companies
        WHERE ai_operator_trial_started_at IS NOT NULL
          AND ai_operator_trial_until IS NOT NULL
          AND ai_operator_trial_until < NOW()
          AND ai_operator_trial_until > NOW() - INTERVAL '24 hours'`,
    );

    const rows = res.rows as Array<{
      id: string;
      company_name: string;
      ai_operator_trial_started_at: string;
      ai_operator_trial_until: string;
    }>;

    if (rows.length > 0) {
      log(
        'job',
        `최근 24시간 AI 오퍼레이션 무료체험 만료 ${rows.length}개 회사:`,
        rows.map((r) => `${r.company_name}(${r.id.slice(0, 8)})`).join(', '),
      );
    } else {
      log('job', '최근 24시간 만료 대상 없음');
    }

    return { expired: rows.length };
  } catch (err: any) {
    const msg = err?.message || '';
    // DB ALTER 미실행 시 자동 안전 (job skip)
    if (msg.includes('column') && msg.includes('does not exist')) {
      log('job', 'DB 마이그레이션 미실행 — companies ALTER 의무 (ai_operator_trial_started_at + ai_operator_trial_until)');
      return { expired: 0 };
    }
    logErr('job', err);
    return { expired: 0 };
  }
}

// ════════════════════════════════════════════════════════════
// 스케줄러 부트스트랩 (app.ts listen 콜백에서 1회 호출)
// ════════════════════════════════════════════════════════════

let _scheduled = false;
let _timer: NodeJS.Timeout | null = null;

function msUntilNextKst04(): number {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const target = new Date(kstNow);
  target.setUTCHours(4, 0, 0, 0);
  if (target.getTime() <= kstNow.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - kstNow.getTime();
}

export function startAiOperatorTrialExpireWorker(): void {
  if (_scheduled) return;
  _scheduled = true;

  const wait = msUntilNextKst04();
  log('scheduler', `started (next run in ${Math.round(wait / 60000)}분 / 매일 04:00 KST)`);

  _timer = setTimeout(async () => {
    try {
      await runAiOperatorTrialExpireJob();
    } catch (err) {
      logErr('first-tick', err);
    }
    _timer = setInterval(() => {
      runAiOperatorTrialExpireJob().catch((e) => logErr('interval', e));
    }, 24 * 60 * 60 * 1000);
  }, wait);
}

export function stopAiOperatorTrialExpireWorker(): void {
  if (_timer) {
    clearTimeout(_timer);
    clearInterval(_timer as any);
    _timer = null;
  }
  _scheduled = false;
}
