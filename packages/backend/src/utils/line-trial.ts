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
import pool, { query } from '../config/database';
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

/** 배너로 켠 지급의 기록자 머리(지급 원장 granted_by = 머리 + 누른 사용자 id) */
export const LINE_BANNER_GRANTOR = 'line-banner:';

/**
 * 7일 체험 지급의 길 — 기록자 머리로 가른다.
 *   배너 = 'line-banner:{users.id}'(이 파일 runLineTrialStart) · 슈퍼관리자 = 'admin:{super_admins.id}'(routes/marketing-diagnosis-admin.ts 수동 부여) ·
 *   그 밖 = 진단 설문(executeGrant 기본값 'diagnosis-auto').
 */
export type LineTrialSource = 'banner' | 'diagnosis' | 'admin';
export function lineTrialSourceOf(grantedBy: string | null | undefined): LineTrialSource {
  const g = String(grantedBy ?? '');
  if (g.startsWith(LINE_BANNER_GRANTOR)) return 'banner';
  if (g.startsWith('admin:')) return 'admin';
  return 'diagnosis';
}

/**
 * 7일 무료체험 목록(★ 2026-11-17 C141 슈퍼관리자 「기능 관심 업체」) — 지급 원장 한 줄 = 회사 하나(UNIQUE(company_id)).
 *   살아 있는가 · 남은 날 = 위 판정 그대로(요금제 · 만료 술어 · 서울 달력) · 켠 사람 = 배너 지급이면 그 계정 이름.
 *   시각 칸은 ::timestamptz 로 읽는다(시간대 없는 칸이어도 쓴 쪽과 같은 세션 시간대 기준 · trialDaysLeftSql 과 같은 규약).
 */
export const LINE_TRIAL_LIST_SQL = `
  SELECT g.company_id::text AS company_id, g.granted_by,
         g.created_at::timestamptz AS granted_at,
         g.trial_expires_at::timestamptz AS grant_ends_at,
         c.trial_expires_at::timestamptz AS company_ends_at,
         COALESCE(NULLIF(u.name, ''), u.login_id, '') AS granted_by_name,
         UPPER(COALESCE(p.plan_code, '')) AS plan_code,
         ${trialFutureSql('c')} AS trial_future,
         ${trialDaysLeftSql('c')} AS days_left
    FROM diagnosis_trial_grants g
    JOIN companies c ON c.id = g.company_id
    LEFT JOIN plans p ON p.id = c.plan_id
    LEFT JOIN users u ON g.granted_by LIKE '${LINE_BANNER_GRANTOR}%' AND u.id::text = substring(g.granted_by from ${LINE_BANNER_GRANTOR.length + 1})
   ORDER BY g.created_at DESC, g.company_id`;

export interface LineTrialListRow {
  companyId: string;
  source: LineTrialSource;
  grantedAt: string;
  /** 배너로 켰으면 그 계정 이름(없으면 아이디) · 그 밖은 빈 값 */
  grantedBy: string;
  alive: boolean;
  /** 살아 있을 때만(0 = 오늘이 마지막 날) */
  daysLeft: number | null;
  /** 살아 있으면 회사의 만료 시각 · 끝났으면 지급 때 정한 만료 시각 */
  endsAt: string | null;
}

const isoOrNull = (v: unknown): string | null => {
  if (v == null) return null;
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** 7일 무료체험 목록 — 표가 없으면(42P01) null(화면은 그 단계를 「읽지 못했습니다」로) */
export async function loadLineTrials(): Promise<LineTrialListRow[] | null> {
  try {
    const r = await query(LINE_TRIAL_LIST_SQL, []);
    return r.rows.map((x: any) => {
      const alive = lineTrialAlive({ planCode: String(x.plan_code ?? ''), hasGrant: true, trialFuture: x.trial_future === true });
      const days = Number(x.days_left);
      return {
        companyId: String(x.company_id),
        source: lineTrialSourceOf(x.granted_by),
        grantedAt: isoOrNull(x.granted_at) ?? new Date(0).toISOString(),
        grantedBy: String(x.granted_by_name || ''),
        alive,
        daysLeft: alive && x.days_left != null && Number.isFinite(days) && days >= 0 ? days : null,
        endsAt: alive ? isoOrNull(x.company_ends_at) : isoOrNull(x.grant_ends_at),
      };
    });
  } catch (err: any) {
    if (err?.code === '42P01') return null;
    throw err;
  }
}

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
    const { trialExpiresAt } = await executeGrant(client, companyId, null, { grantedBy: `${LINE_BANNER_GRANTOR}${userId ?? 'unknown'}` });
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
