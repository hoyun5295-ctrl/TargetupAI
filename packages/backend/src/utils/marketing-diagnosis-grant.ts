/**
 * CT: 마케팅 진단 TRIAL 지급 — 판정·실행 공용부 (2026-08-16 신설 — 설계서 §4-1·§4-6)
 *
 * 소비처 2곳이 같은 원자성을 공유한다(두 벌 금지):
 *   ① 퍼널 A submit(routes/marketing-diagnosis.ts) — 진단 저장과 지급이 한 트랜잭션
 *   ② 관리자 수동 부여(routes/marketing-diagnosis-admin.ts) — 잠긴 진단 행에서 대상 파생
 *
 * 계약
 *   - 호출부가 BEGIN/COMMIT/ROLLBACK/커넥션 수명을 소유한다 — 여기서는 걸지 않는다.
 *   - judgeGrantEligibility = 회사 행을 FOR UPDATE로 잠그고 판정까지(잠금이 곧 직렬화 축).
 *   - executeGrant = grantFreeTrial(client 주입) + diagnosis_trial_grants INSERT.
 *     grants UNIQUE 충돌은 GRANT_CONFLICT 코드로 던진다 — 호출부가 ROLLBACK 후 already_granted 응답.
 *   - 1회 한정의 실효 장치 = DB UNIQUE(§2-3). 여기 조건문들은 보조다.
 */
import type { PoolClient } from 'pg';
import { grantFreeTrial } from './basic-trial';

export const DIAGNOSIS_TRIAL_DAYS = 7;

/**
 * ★2026-08-17 Harold 확정 — 진단 진입·제출은 **고객사 관리자 전용**이다.
 * 이유: 완주가 회사당 1회이고 되돌릴 수 없으며(§3-3 예외 재지급 경로 없음), 7일 체험 지급이
 * 회사 계약 상태를 바꾼다. 담당자가 답한 진단이 회사의 유일한 기록으로 굳고 체험 1회를 소진하는
 * 것을 막는다. 값은 JWT `userType`이고 로그인이 `users.user_type='admin'`을 이 값으로 바꾼다.
 */
export const DIAGNOSIS_RUNNER_USER_TYPE = 'company_admin';

/** 이 계정이 진단을 실행할 수 있는가(역할 축만). */
export function isDiagnosisRunner(userType?: string | null): boolean {
  return userType === DIAGNOSIS_RUNNER_USER_TYPE;
}

/**
 * 진단 대상 여부 = 요금제 × 역할. `/state`의 `eligible`이 이 한 벌을 쓰고 화면은 그것만 소비한다
 * (§3-1 화면은 게이트가 아니다). 라우트 게이트는 isDiagnosisRunner로 같은 축을 재검사한다.
 */
export function judgeDiagnosisEligible(params: { planCode: string; userType?: string | null }): boolean {
  return params.planCode === 'FREE' && isDiagnosisRunner(params.userType);
}

export type GrantJudgement =
  | { outcome: 'granted' }                    // 지급 가능(아직 실행 전 — 이름은 §7-2 result 값과 맞춘다)
  | { outcome: 'not_applicable' }             // plan_code ≠ FREE (유료·STAFF·TRIAL활성·미배정)
  | { outcome: 'already_granted' }            // diagnosis_trial_grants 기지급
  | { outcome: 'not_eligible' }               // 체험 이력 4항 OR (fail-closed)
  | { outcome: 'company_not_found' };

/** 회사 행 잠금 + 지급 자격 판정(§4-1 ⓐ·ⓓ). 반드시 호출부 트랜잭션 안에서. */
export async function judgeGrantEligibility(
  client: PoolClient,
  companyId: string,
): Promise<GrantJudgement> {
  const comp = await client.query(
    `SELECT c.id, c.subscription_status, c.trial_expires_at,
            UPPER(COALESCE(p.plan_code, '')) AS plan_code
       FROM companies c LEFT JOIN plans p ON p.id = c.plan_id
      WHERE c.id = $1 FOR UPDATE OF c`,
    [companyId],
  );
  if (comp.rows.length === 0) return { outcome: 'company_not_found' };
  const crow = comp.rows[0];

  // §4-1 ⓐ 기지급 선판정 — 반드시 plan 검사보다 먼저다(★Codex 적대 수용). 지급이 성공하면
  // 회사가 TRIAL로 바뀌므로, plan을 먼저 보면 "지급 직후 재시도"가 already_granted 대신
  // not_applicable(400)로 떨어져 재호출 안정 응답 계약이 깨진다.
  const g = await client.query(`SELECT 1 FROM diagnosis_trial_grants WHERE company_id = $1`, [companyId]);
  if (g.rows.length > 0) return { outcome: 'already_granted' };

  // 원칙 2 — 화면은 게이트가 아니다. 지급 함수 안에서 FREE 정확 일치 재검사.
  if (crow.plan_code !== 'FREE') return { outcome: 'not_applicable' };

  // §4-1 ⓓ 체험 이력 4항 OR
  if (await hasTrialHistory(client, companyId, crow)) return { outcome: 'not_eligible' };

  return { outcome: 'granted' };
}

/**
 * 체험 이력 4항 OR(§4-1 — fail-closed). GET /state의 not_eligible 표시 판정도 이 한 벌을 쓴다.
 * ③(plan_code='TRIAL')은 호출 전 FREE 재검사가 이미 배제 — 여기 도달하면 FREE뿐이다.
 * ④(FREE인데 만료일 잔존 = 원장 밖 이력 흔적)이 grantFreeTrial의 GREATEST 초과 연장도 함께 차단한다.
 */
export async function hasTrialHistory(
  q: { query: (sql: string, params?: any[]) => Promise<any> },
  companyId: string,
  row: { subscription_status: string | null; trial_expires_at: Date | null },
): Promise<boolean> {
  if (row.subscription_status === 'trial' || row.subscription_status === 'trial_expired') return true;
  if (row.trial_expires_at !== null) return true;
  const r = await q.query(
    `SELECT 1 FROM company_plan_changes WHERE company_id = $1 AND change_type = 'trial_start' LIMIT 1`,
    [companyId],
  );
  return r.rows.length > 0;
}

/** grants UNIQUE 충돌 식별용 — 호출부는 이 코드를 잡아 ROLLBACK 후 already_granted로 응답한다. */
export class GrantConflictError extends Error {
  constructor() { super('GRANT_CONFLICT'); this.name = 'GrantConflictError'; }
}

/**
 * §4-1 ⓔ·ⓕ — 지급 실행. judge가 'granted'일 때만 부른다. 반환 = trial_expires_at.
 * grantedBy = 지급 행위자 스냅샷 — 같은 트랜잭션 안에서 영속화한다(★Codex 적대 2R 수용:
 * COMMIT과 사후 감사 기록 사이 크래시가 나도 "누가 지급했는가"는 원장에 남는다).
 * 자동 지급은 기본값 'diagnosis-auto', 관리자 수동 부여는 admin:{super_admins.id}.
 */
export async function executeGrant(
  client: PoolClient,
  companyId: string,
  diagnosisId: string,
  opts: { days?: number; grantedBy?: string } = {},
): Promise<{ trialExpiresAt: Date | null }> {
  const days = opts.days ?? DIAGNOSIS_TRIAL_DAYS;
  const granted = await grantFreeTrial(companyId, days, { client });
  const trialExpiresAt = granted?.trial_expires_at ?? null;
  try {
    await client.query(
      `INSERT INTO diagnosis_trial_grants (company_id, diagnosis_id, granted_days, trial_expires_at, granted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, diagnosisId, days, trialExpiresAt, (opts.grantedBy ?? 'diagnosis-auto').slice(0, 64)],
    );
  } catch (err: any) {
    if (String(err?.code) === '23505') throw new GrantConflictError();
    throw err;
  }
  return { trialExpiresAt };
}
