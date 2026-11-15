/**
 * studio-trial.ts — 이미지 스튜디오 무료체험 3회의 판정 · 선점 한 곳 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §5)
 *
 * 한 곳에서 정하는 것
 *   ① 자격 = 지금 판정이 AI 기능을 막는 **미가입** 회사뿐(판정 함수 = utils/plan-guard.ts studioTrialEligible · 요금제 판정의 주인 파일).
 *      30일 AI 체험 중 · 허용 명단 · 슈퍼관리자 · 유료는 지금 길이 이미 열려 있으므로 자격이 없다. 만료 · 정지도 자격이 없다(미가입이 아니다).
 *   ② 신청 = 고객이 「무료체험 3회 이용하고 싶습니다」를 눌렀을 때만 행이 생긴다(누르지 않은 회사 = 종전 그대로).
 *   ③ 횟수 = 크레딧이 아니라 이 표의 used_keys 로 센다. 미가입 회사는 크레딧제가 적용되지 않을 수 있어(creditApplies 거짓 = 확인이 그냥 통과)
 *      크레딧으로는 3회를 지킬 수 없다.
 *   ④ 불변식 = 「잡은 칸 수 ≥ 만든 포스터 수」. 생성 **전에** 한 칸을 잡고(한 문장 선점) 실패하면 되돌린다.
 *      이미 쓴 키로는 새로 만들지 않는다(다시 만들면 칸은 그대로인데 그림만 늘어난다).
 *
 * 표 = image_studio_trials(배포 원장 C135-DDL-1). 표가 없으면 쓰기 · 읽기 문장이 42P01 을 던진다 →
 *   판정(resolveStudioTrial) · 목록(loadStudioTrials)은 「없음」으로 접고, 신청 · 상태 주소는 라우트가 503 DB_MIGRATION_PENDING.
 */
import { query } from '../config/database';
import { loadPlanContext, studioTrialEligible, type PlanContext } from './plan-guard';

export const STUDIO_TRIAL_GRANTED = 3;

export interface TrialUser { loginId?: string; userId?: string; userType?: string }
export interface StudioTrialRow { granted: number; usedKeys: string[]; requestedAt: string }
export interface StudioTrialStatus { requested: boolean; granted: number; used: number; remaining: number }
export type TrialReserve = { state: 'ok' | 'spent' | 'used_up'; used: number; granted: number };

/** (순수) 화면에 주는 꼴 */
export function trialStatusOf(row: StudioTrialRow | null): StudioTrialStatus {
  if (!row) return { requested: false, granted: 0, used: 0, remaining: 0 };
  const used = row.usedKeys.length;
  return { requested: true, granted: row.granted, used, remaining: Math.max(0, row.granted - used) };
}

export const isTrialTableMissing = (err: any): boolean => err?.code === '42P01';

/** 신청($1 회사 · $2 누른 사용자 · $3 횟수) — 이미 있으면 아무것도 바꾸지 않는다(3회가 다시 차지 않는다) */
export const TRIAL_REQUEST_SQL = `
  INSERT INTO image_studio_trials (company_id, requested_by, granted)
  VALUES ($1::uuid, $2::uuid, $3::int)
  ON CONFLICT (company_id) DO NOTHING`;

export const TRIAL_READ_SQL = `
  SELECT granted, used_keys, requested_at
    FROM image_studio_trials
   WHERE company_id = $1::uuid`;

/** 선점 한 문장($1 회사 · $2 키) — 행이 돌아온 요청만 만든다. 조건 = 이 키를 아직 안 씀 ∧ 쓴 칸 < 받은 칸 */
export const TRIAL_RESERVE_SQL = `
  UPDATE image_studio_trials
     SET used_keys = array_append(used_keys, $2)
   WHERE company_id = $1::uuid
     AND NOT ($2 = ANY(used_keys))
     AND cardinality(used_keys) < granted
  RETURNING cardinality(used_keys) AS used, granted`;

/** 되돌림($1 회사 · $2 키) — 만들다 실패한 칸을 돌려준다 */
export const TRIAL_RELEASE_SQL = `
  UPDATE image_studio_trials
     SET used_keys = array_remove(used_keys, $2)
   WHERE company_id = $1::uuid
     AND $2 = ANY(used_keys)`;

export async function readStudioTrial(companyId: string): Promise<StudioTrialRow | null> {
  const r = await query(TRIAL_READ_SQL, [companyId]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    granted: Number(row.granted) || 0,
    usedKeys: Array.isArray(row.used_keys) ? row.used_keys.map(String) : [],
    requestedAt: new Date(row.requested_at).toISOString(),
  };
}

/** 신청 — 자격은 부르는 쪽이 본다(studioTrialEligible) · 두 번 눌러도 같은 답 */
export async function requestStudioTrial(companyId: string, userId: string | null | undefined): Promise<StudioTrialStatus> {
  await query(TRIAL_REQUEST_SQL, [companyId, userId || null, STUDIO_TRIAL_GRANTED]);
  return trialStatusOf(await readStudioTrial(companyId));
}

/**
 * 생성 문의 판정(참 = 체험 길) — 지금 길이 열려 있으면 거짓(체험 행이 있어도 보지 않는다) · 자격 있고 신청했으면 참.
 *   표가 없으면 거짓(= 종전 요금제 문). 그 밖의 읽기 실패는 던진다(부르는 쪽이 거짓으로 접는다 = 모르면 체험이 아니다).
 *   남은 칸 · 이미 쓴 키는 여기서 보지 않는다 — 그 판정은 선점 문장 한 곳(reserveStudioTrial)이 한다.
 */
export async function resolveStudioTrial(companyId: string, user: TrialUser | null | undefined, plan: PlanContext | null | undefined): Promise<boolean> {
  if (!studioTrialEligible(plan, user)) return false;
  try {
    return (await readStudioTrial(companyId)) !== null;
  } catch (err) {
    if (isTrialTableMissing(err)) return false;
    throw err;
  }
}

/**
 * 생성 문 한 줄 — 요금제 문맥을 한 번 읽어 체험 판정과 함께 준다(종전 요금제 문이 그 문맥을 그대로 받는다 = 조회 한 번).
 *   요금제를 못 읽으면 plan = undefined(종전 문이 다시 읽어 종전 오류로 답한다) · 체험 판정이 실패하면 trial = false(종전 문).
 */
export async function studioTrialGate(companyId: string, user: TrialUser | null | undefined): Promise<{ plan: PlanContext | null | undefined; trial: boolean }> {
  let plan: PlanContext | null;
  try {
    plan = await loadPlanContext(companyId);
  } catch {
    return { plan: undefined, trial: false };
  }
  try {
    return { plan, trial: await resolveStudioTrial(companyId, user, plan) };
  } catch (err: any) {
    console.error('[studio-trial] 체험 판정 실패(종전 요금제 문으로):', err?.message || err);
    return { plan, trial: false };
  }
}

/** 화면에 주는 상태 = 자격 + 신청 · 사용(표가 없으면 42P01 을 던진다 → 라우트가 503) */
export async function studioTrialView(companyId: string, user: TrialUser | null | undefined): Promise<StudioTrialStatus & { eligible: boolean }> {
  const plan = await loadPlanContext(companyId);
  return { eligible: studioTrialEligible(plan, user), ...trialStatusOf(await readStudioTrial(companyId)) };
}

/** 신청 한 걸음 — 자격이 없으면 null(라우트가 409) · 있으면 행을 만들고 상태를 준다 */
export async function requestStudioTrialFor(companyId: string, user: TrialUser | null | undefined): Promise<StudioTrialStatus | null> {
  const plan = await loadPlanContext(companyId);
  if (!studioTrialEligible(plan, user)) return null;
  return requestStudioTrial(companyId, user?.userId);
}

/** 선점이 거절한 요청의 응답(spent = 409 · used_up = 403) */
export function trialRefusal(r: TrialReserve): { status: number; body: Record<string, unknown> } {
  return r.state === 'spent'
    ? { status: 409, body: { success: false, error: '이 요청은 이미 처리됐어요. 다시 만들려면 만들기를 한 번 더 눌러 주세요.', code: 'TRIAL_ATTEMPT_SPENT' } }
    : { status: 403, body: { success: false, error: `무료체험 ${r.granted || STUDIO_TRIAL_GRANTED}회를 모두 쓰셨어요.`, code: 'TRIAL_USED_UP' } };
}

/** 신청 · 상태 주소의 오류 응답(표 없음 = 503 DB_MIGRATION_PENDING · 그 밖 = 503) */
export function trialErrorResponse(err: any): { status: number; body: Record<string, unknown> } {
  if (isTrialTableMissing(err)) {
    return { status: 503, body: { success: false, error: 'DB 마이그레이션 필요: image_studio_trials 표 생성(C135-DDL-1) 실행 요청', code: 'DB_MIGRATION_PENDING' } };
  }
  console.error('[studio-trial] 처리 오류:', err?.message || err);
  return { status: 503, body: { success: false, error: '무료체험 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.' } };
}

/**
 * 생성 전 선점. ok = 한 칸을 잡았다 · spent = 이 키로는 만들지 않는다(다시 누르면 새 키) · used_up = 남은 칸이 없다(신청 안 한 회사 포함).
 *   0행의 두 뜻은 뒤이은 읽기 한 번으로 가른다: **남은 칸이 없을 때만 used_up**. 칸이 남았는데 0행 = 이 키가 이미 쓰였다
 *   (같은 키의 겹친 요청 · 기억이 사라진 다시 요청 · 그 키가 방금 되돌려진 틈) → 어느 쪽이든 「다시 눌러 주세요」가 맞는 답이다.
 *   키가 있는지로 가르지 않는 이유 = 선점과 읽기 사이에 그 키가 되돌려지면 「칸이 남았는데 다 썼다」로 답하게 된다.
 */
export async function reserveStudioTrial(companyId: string, key: string): Promise<TrialReserve> {
  const r = await query(TRIAL_RESERVE_SQL, [companyId, key]);
  if (r.rows.length > 0) return { state: 'ok', used: Number(r.rows[0].used), granted: Number(r.rows[0].granted) };
  const s = trialStatusOf(await readStudioTrial(companyId));
  return { state: s.remaining > 0 ? 'spent' : 'used_up', used: s.used, granted: s.granted };
}

export async function releaseStudioTrial(companyId: string, key: string): Promise<void> {
  await query(TRIAL_RELEASE_SQL, [companyId, key]);
}

export interface StudioTrialListRow { companyId: string; companyName: string; requestedBy: string; requestedAt: string; used: number; granted: number }

/**
 * 슈퍼관리자 「무료체험 신청 업체」 — 관심 기록(audit_logs)과 무관하게 표 전부(기한 없는 체험 = 기간 거르기 없음) · 최근 신청이 위.
 *   표가 없으면 null(화면은 표를 그리지 않는다 · 탭의 나머지는 그대로).
 */
export async function loadStudioTrials(): Promise<StudioTrialListRow[] | null> {
  try {
    const r = await query(
      `SELECT t.company_id::text AS company_id, t.requested_at, t.granted, cardinality(t.used_keys) AS used,
              COALESCE(c.company_name, '') AS company_name,
              COALESCE(NULLIF(u.name, ''), u.login_id, '') AS requested_by
         FROM image_studio_trials t
         LEFT JOIN companies c ON c.id = t.company_id
         LEFT JOIN users u ON u.id = t.requested_by
        ORDER BY t.requested_at DESC, t.company_id`,
      [],
    );
    return r.rows.map((x: any) => ({
      companyId: String(x.company_id),
      companyName: String(x.company_name || '(회사 정보 없음)'),
      requestedBy: String(x.requested_by || ''),
      requestedAt: new Date(x.requested_at).toISOString(),
      used: Number(x.used) || 0,
      granted: Number(x.granted) || 0,
    }));
  } catch (err) {
    if (isTrialTableMissing(err)) return null;
    throw err;
  }
}
