/**
 * CT: 대시보드 한 줄 배너의 7일 무료체험 — 배너 판정 · 체험 시작 (★ 2026-11-17 C140 · 설계서 docs/2026-11-17-line-trial-banner-design.md §4-2)
 *
 * 미가입 고객사 관리자의 대시보드 배너(한 줄 입력칸)가 설문 없이 7일 체험을 켠다.
 *   - 지급 = 진단 체험과 같은 판정 · 같은 지급 함수(marketing-diagnosis-grant.ts judgeGrantEligibility · executeGrant) · 같은 원장(diagnosis_trial_grants).
 *     회사당 1번 = 그 원장의 UNIQUE(company_id) 그대로. 진단 없는 지급이라 diagnosis_id 는 NULL(배포 원장 C140-DDL-1).
 *   - 배너를 그릴지 = 서버가 정한다(judgeLineBanner · 화면은 /state 의 banner 칸만 읽는다).
 *   - ⛔ subscription_status 로 「체험 중」을 판정하지 않는다 — 유료 요금제에 'trial' 상태가 같이 남는 조합이 있고(trial-downgrade-worker.ts 유료 강등 금지 가드),
 *     1026 전에 만들어진 미가입 회사는 그 칸의 옛 DB 기본값 'trial' 로 태어났다(1026 에 기본값을 없앰 · status/SCHEMA.md companies 절 · LESSONS_DB 1021).
 *     요금제(TRIAL) + 만료일 + 지급 원장 행으로 본다.
 *   - 이 파일은 발송 · 정산 길을 건드리지 않는다.
 */
import type { PoolClient } from 'pg';
import pool from '../config/database';
import { judgeGrantEligibility, executeGrant, GrantConflictError, isDiagnosisRunner } from './marketing-diagnosis-grant';

export type LineBanner = 'offer' | 'trial' | null;

/**
 * 만료일이 아직 지나지 않았는가 — 강등 워커의 「지남」 술어(trial_expires_at < NOW() · trial-downgrade-worker.ts)의 여집합.
 * 시각 비교는 DB 가 한다(만료 칸 = 시간대 없는 칸 · JS 로 옮겨 비교하면 프로세스 시간대에 기댄다).
 */
export const trialFutureSql = (alias: string): string =>
  `(${alias}.trial_expires_at IS NOT NULL AND ${alias}.trial_expires_at >= NOW())`;

/**
 * 남은 날 수(서울 달력 · 0 = 오늘이 마지막 날) — 배너의 「무료체험 N일 남음」. 화면이 만료 시각을 받아 스스로 세지 않는다
 * (만료 칸 = 시간대 없는 칸 · 쓴 쪽 NOW() + n일과 같은 기준인 세션 시간대로 읽어 서울 날짜로 옮긴다).
 */
export const trialDaysLeftSql = (alias: string): string =>
  `((${alias}.trial_expires_at::timestamptz AT TIME ZONE 'Asia/Seoul')::date - (NOW() AT TIME ZONE 'Asia/Seoul')::date)`;

/**
 * 배너 판정의 입력(만료 · 남은 날 · 지급 여부)을 회사 행과 **한 문장**으로 읽는 칸들 — 한 문장 = 한 스냅샷.
 * 지급 여부를 따로 읽으면 지급 COMMIT 과 겹칠 때 「요금제는 지급 전 · 원장은 지급 뒤」가 섞여 배너가 없음으로 갈린다
 * (끊긴 시작 요청 뒤의 상태 재조회가 바로 그 순간이다 · Codex 구현 1R 2). 쓰는 곳 = GET /state 의 회사 조회.
 */
export const lineBannerColumnsSql = (alias: string): string =>
  `${trialFutureSql(alias)} AS trial_future,
                ${trialDaysLeftSql(alias)} AS trial_days_left,
                EXISTS (SELECT 1 FROM diagnosis_trial_grants dtg WHERE dtg.company_id = ${alias}.id) AS has_grant`;

/** 배너(진단) 체험이 살아 있는가 = 체험 요금제 + 지급 원장 행 + 만료일이 아직 안 지남 */
export function lineTrialAlive(p: { planCode: string; hasGrant: boolean; trialFuture: boolean }): boolean {
  return p.planCode === 'TRIAL' && p.hasGrant === true && p.trialFuture === true;
}

/**
 * 배너 판정 — 위에서부터 차례로(설계서 §4-2 (가)).
 *   1 관리자 아님 = 없음 · 2 체험이 살아 있음 = 체험 중 모양 · 3 미가입 + 선불 잠김 아님 + 지급 행 없음 = 제안 · 4 그 밖 = 없음
 */
export function judgeLineBanner(p: {
  userType?: string | null;
  planCode: string;
  planTermManaged?: boolean;
  hasGrant: boolean;
  trialFuture: boolean;
}): LineBanner {
  if (!isDiagnosisRunner(p.userType)) return null;
  if (lineTrialAlive(p)) return 'trial';
  if (p.planCode === 'FREE' && p.planTermManaged !== true && !p.hasGrant) return 'offer';
  return null;
}

export type LineTrialStart =
  | { outcome: 'granted' | 'already_granted'; trialExpiresAt: Date | string | null }
  | { outcome: 'trial_used' | 'not_applicable' | 'company_not_found' };

/** 호출부 트랜잭션 안에서 — 판정(회사 행 잠금) → 지급 또는 「이미 지급」의 갈림 */
async function startInTx(client: PoolClient, companyId: string, userId: string | null): Promise<LineTrialStart> {
  const judged = await judgeGrantEligibility(client, companyId);
  if (judged.outcome === 'company_not_found') return { outcome: 'company_not_found' };
  if (judged.outcome === 'granted') {
    const { trialExpiresAt } = await executeGrant(client, companyId, null, { grantedBy: `line-banner:${userId ?? 'unknown'}` });
    return { outcome: 'granted', trialExpiresAt };
  }
  if (judged.outcome === 'already_granted') {
    // 두 번 누름 · 다른 탭 · 체험 중 모양에서 누름 = 같은 답(멱등). 체험이 끝났으면 「회사당 한 번」.
    const r = await client.query(
      `SELECT c.trial_expires_at, UPPER(COALESCE(p.plan_code, '')) AS plan_code, ${trialFutureSql('c')} AS trial_future
         FROM companies c LEFT JOIN plans p ON p.id = c.plan_id
        WHERE c.id = $1`,
      [companyId],
    );
    const row = r.rows[0];
    return lineTrialAlive({ planCode: String(row?.plan_code ?? ''), hasGrant: true, trialFuture: row?.trial_future === true })
      ? { outcome: 'already_granted', trialExpiresAt: row.trial_expires_at ?? null }
      : { outcome: 'trial_used' };
  }
  return { outcome: 'not_applicable' };
}

/**
 * 체험 시작 — 트랜잭션 하나(판정 + 지급 + 원장). 실패 = 전체 ROLLBACK(다시 누르면 된다).
 * 지급 원장 UNIQUE 충돌(회사 행 잠금 밖의 다른 지급 길과 겹침)은 한 번 더 판정한다 — 그때는 「이미 지급」으로 갈린다.
 */
export async function runLineTrialStart(companyId: string, userId?: string | null): Promise<LineTrialStart> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await startInTx(client, companyId, userId ?? null);
      await client.query(out.outcome === 'granted' ? 'COMMIT' : 'ROLLBACK');
      return out;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* 이중 롤백 무해 */ }
      if (!(err instanceof GrantConflictError) || attempt > 0) throw err;
    } finally {
      client.release();
    }
  }
}

/** 배포 원장 C140-DDL-1 전 = 지급 원장의 진단 id 칸 NOT NULL 위반(라우트가 503 DB_MIGRATION_PENDING 으로 돌린다) */
export function isGrantDdlPending(err: any): boolean {
  return String(err?.code) === '23502' && err?.table === 'diagnosis_trial_grants' && err?.column === 'diagnosis_id';
}
