/**
 * plan-change-log.ts — 요금제 변경 이력 기록 컨트롤타워 (★ 2026-07-25 신설)
 *
 * 신설 사유(Harold 지시): 청구서에 **요금제 이용요금**이 들어가야 하고, 월 중간에 플랜을 올리거나
 *   내린 회사는 변경일 기준 **일할 계산**으로 분배해야 한다.
 *   그런데 지금까지는 `companies.plan_id`를 덮어쓰기만 해서 **언제 바꿨는지가 어디에도 안 남았다.**
 *   일할계산의 전제가 없었던 것이고, 소급해서 알아낼 방법도 없다.
 *
 * `company_plan_changes`가 진실의 원천이다. 플랜이 바뀌는 모든 경로가 이 함수만 부른다.
 *
 * ★ Codex 적대검증 수용(2026-07-25) — 초판의 결함 4건을 여기서 막는다.
 *
 *   1) **원자성**: plan_id UPDATE와 이력 INSERT를 반드시 **같은 트랜잭션**으로 묶는다.
 *      직전 플랜을 이력 체인(최신 행)에서 뽑는 설계라, 한 건만 유실돼도 **그 뒤 모든 구간이 틀어진다.**
 *      예: 7/10 A→B 기록 실패 → 7/20 B→C 변경 시 최신 이력이 여전히 A라 A→C로 남고
 *          7/10~19의 B 구간이 통째로 A 가격으로 계산된다. 단발 손실이 아니라 연쇄 손상이다.
 *      그래서 호출부는 `client`(PoolClient)를 반드시 넘긴다. 실패하면 플랜 변경째로 롤백되는 게 맞다.
 *
 *   2) **동시성**: 회사별 advisory lock으로 직렬화한다. 같은 회사에 두 변경이 겹치면
 *      "직전 플랜 조회 → 판정 → INSERT" 사이에 끼어들어 최신 이력과 실제 플랜이 어긋난다.
 *
 *   3) **change_type 오판**: 승급/강등 판정을 호출부가 미리 계산하면, 그 사이 다른 변경이 들어왔을 때
 *      INSERT에 쓰는 from 스냅샷과 판정 근거가 달라진다. 판정을 이 함수 안으로 들여
 *      **INSERT에 쓰는 바로 그 prev 값으로만** 계산한다.
 *
 *   4) **알림 실패 은폐**: sendSystemAlert 실패를 빈 catch로 버리지 않고 별도 로그로 남긴다.
 *
 * ★ 스냅샷 원칙: `plan_code`와 `monthly_price`를 그 시점 값으로 박아둔다.
 *   `plans.monthly_price`를 나중에 올리면 과거 청구서를 재발행할 때 금액이 달라지기 때문이다.
 *
 * ★ `changed_at`(기록 시각)과 `effective_date`(요금 적용 기준일)를 분리한다.
 *
 * ★ 2026-10-26 Harold — 이 함수가 두 가지를 더 한다(플랜이 바뀌는 모든 경로가 여기를 지나므로 한 곳에서 닫힌다).
 *   ① 남은 기간 크레딧: 신청 승인 · 직접 변경 · 업그레이드 · 선불 결제가 그 달 남은 일수 몫을 기본 칸에 반영한다.
 *   ② 무료체험(TRIAL) 배정 = 체험 CT(trial_start) + 만료일 필수. 만료일 없는 TRIAL 은 워커가 영원히 못 내린다
 *      (berluti · woorimfmg 가입일부터 5개월 · 뿌리 대장 R6).
 */

import type { PoolClient } from 'pg';
import { sendSystemAlert } from './system-alert';
import { needsMonthlyReset } from './ai-credit-calc';
import { loadCreditRow, applyResetIfNeeded } from './ai-credit-tx';
import { planChangeCreditDelta } from './plan-proration';

export type PlanChangeType =
  | 'initial'       // 회사 생성 시 최초 플랜
  | 'upgrade'       // 상위 요금제로
  | 'downgrade'     // 하위 요금제로
  | 'trial_start'   // 무료체험 부여
  | 'trial_expire'  // 체험 만료·취소로 강등
  | 'admin';        // 슈퍼관리자 수동 변경

export interface RecordPlanChangeParams {
  /** ★ 필수 — plan_id UPDATE와 같은 트랜잭션의 클라이언트. 분리되면 연쇄 손상이 난다. */
  client: PoolClient;
  companyId: string;
  toPlanId: string;
  /**
   * 변경 성격. `auto`면 직전/신규 월 요금을 비교해 upgrade·downgrade·initial을 자동 판정한다.
   * 체험 부여·만료처럼 의미가 정해진 경우만 명시한다.
   */
  changeType: PlanChangeType | 'auto';
  changedBy?: string | null;
  reason?: string | null;
  /** 요금 적용 기준일(YYYY-MM-DD). 미지정 시 오늘(KST) */
  effectiveDate?: string;
}

export interface RecordPlanChangeResult {
  recorded: boolean;
  skipped?: 'same_plan' | 'plan_not_found';
  changeType?: PlanChangeType;
  /** ★ 2026-07-26 크레딧 일할 조정 결과 — 건너뛴 경우 그 이유까지 담는다 */
  creditAdjust?: PlanCreditAdjustResult;
}

/** 오늘 날짜(KST, YYYY-MM-DD) — 요금 적용 기준일은 한국 시간 기준이다. */
export function todayKst(nowMs: number = Date.now()): string {
  const d = new Date(nowMs + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * (순수) 직전/신규 월 요금으로 변경 방향을 판정한다.
 * 반드시 INSERT에 쓰는 것과 **같은 prev 스냅샷**으로 호출해야 한다(Codex 지적 F).
 */
export function classifyPlanChange(fromPrice: number | null | undefined, toPrice: number): PlanChangeType {
  if (fromPrice === null || fromPrice === undefined) return 'initial';
  if (toPrice > fromPrice) return 'upgrade';
  if (toPrice < fromPrice) return 'downgrade';
  return 'admin'; // 금액이 같은 플랜 간 이동(구성 변경)
}

/**
 * 요금제 변경을 이력에 남긴다. **호출부의 plan_id UPDATE와 같은 트랜잭션 안에서 부른다.**
 *
 * 직전 플랜은 `companies`가 아니라 이력 테이블의 최신 행에서 가져온다 —
 * 호출 시점엔 이미 `plan_id`가 새 값으로 덮여 있고, 이력끼리 체인이 이어져야
 * 일할계산이 구간을 끊을 수 있기 때문이다.
 *
 * 같은 플랜으로의 재기록은 건너뛴다(조건부 UPDATE 0행·재시도 노이즈 차단).
 * advisory lock으로 회사별 직렬화하므로, 동시 변경이 서로의 판정을 오염시키지 않는다.
 *
 * 실패는 **throw한다.** 호출부 트랜잭션이 롤백되어 플랜 변경과 이력이 함께 되돌아가는 게 맞다.
 */
export async function recordPlanChange(params: RecordPlanChangeParams): Promise<RecordPlanChangeResult> {
  const { client, companyId, toPlanId, changedBy, reason } = params;
  const effectiveDate = params.effectiveDate || todayKst();

  // 회사별 직렬화 — "직전 조회 → 판정 → INSERT"가 다른 변경과 교차하지 않게 한다.
  // 트랜잭션 종료 시 자동 해제된다.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('plan_change'))`, [String(companyId)]);

  const planRes = await client.query(
    `SELECT plan_code, monthly_price, COALESCE(ai_credits_per_month, 0) AS credits FROM plans WHERE id = $1::uuid`,
    [toPlanId],
  );
  if (planRes.rows.length === 0) {
    console.log(`[plan-change][MISS] 요금제 없음 company=${companyId} plan=${toPlanId}`);
    return { recorded: false, skipped: 'plan_not_found' };
  }
  const to = planRes.rows[0];

  const prevRes = await client.query(
    `SELECT to_plan_id, to_plan_code, to_monthly_price
       FROM company_plan_changes
      WHERE company_id = $1::uuid
      ORDER BY effective_date DESC, changed_at DESC
      LIMIT 1`,
    [companyId],
  );
  const prev = prevRes.rows[0] || null;

  if (prev && String(prev.to_plan_id) === String(toPlanId)) {
    return { recorded: false, skipped: 'same_plan' };
  }

  // ★ 판정은 INSERT에 쓰는 바로 그 prev로만 한다(호출부 사전 계산 금지 — Codex 지적 F).
  const changeType: PlanChangeType = params.changeType === 'auto'
    ? classifyPlanChange(prev ? Number(prev.to_monthly_price) : null, Number(to.monthly_price) || 0)
    : params.changeType;

  // ★ 2026-10-26 무료체험 배정은 체험 CT(grantFreeTrial = trial_start)로만, 만료일이 있어야 한다.
  //   호출부 트랜잭션이 통째로 롤백된다 — 끝나지 않는 체험을 조용히 만드는 것보다 변경이 실패하는 쪽이 맞다.
  if (to.plan_code === 'TRIAL') {
    if (changeType !== 'trial_start') {
      throw new Error('무료체험(TRIAL)은 체험 부여(grantFreeTrial)로만 배정합니다. 만료일과 체험 크레딧이 함께 들어가야 합니다.');
    }
    const exp = await client.query(
      `SELECT trial_expires_at IS NOT NULL AS has_expiry FROM companies WHERE id = $1::uuid`,
      [companyId],
    );
    if (exp.rows[0]?.has_expiry !== true) {
      throw new Error('무료체험(TRIAL) 배정에 만료일이 없습니다. 만료일 없는 체험은 끝나지 않습니다.');
    }
  }

  // ★ 2026-07-28 `changed_by`는 users FK인데 **슈퍼관리자는 `super_admins`에 산다**(auth.ts 로그인 분기).
  //   그 id를 그대로 넣으면 23503(FK 위반)으로 이 트랜잭션이 통째로 죽고, 호출부가 하려던
  //   요금제 변경 자체가 막힌다 — 실제로 슈퍼관리자가 요금제를 바꿀 때마다 "회사 수정 실패"가 났다.
  //   두 테이블을 한 FK 컬럼으로 가리킬 수 없으므로, users에 있는 id만 컬럼에 넣는다.
  //   ⚠ 실행자를 그냥 버리면 안 된다 — 이 이력은 청구 금액의 근거이고, 요금제 변경은
  //     audit_logs에도 안 남는다(그쪽은 라인그룹 변경만 기록). 그래서 `reason`에 보존한다.
  //   존재 확인과 슈퍼관리자 이름 조회를 한 번의 왕복으로 끝낸다(같은 파라미터를 양쪽 다 ::uuid로 —
  //   타입 문맥을 섞으면 42P08이 난다, D162).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let changedByParam: string | null = changedBy || null;
  let actorNote = '';
  if (changedByParam && UUID_RE.test(changedByParam)) {
    const actor = await client.query(
      `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1::uuid) AS in_users,
              (SELECT login_id FROM super_admins WHERE id = $1::uuid) AS super_login`,
      [changedByParam],
    );
    if (!actor.rows[0]?.in_users) {
      const who = actor.rows[0]?.super_login ? `슈퍼관리자 ${actor.rows[0].super_login}` : `id ${changedByParam}`;
      actorNote = ` [실행자: ${who}]`;
      changedByParam = null;
    }
  } else if (changedByParam) {
    // uuid 형식이 아니면 캐스팅에서 죽으므로 컬럼에 넣지 않는다.
    actorNote = ` [실행자: ${changedByParam}]`;
    changedByParam = null;
  }
  const reasonWithActor = `${reason || ''}${actorNote}`.trim() || null;

  const inserted = await client.query(
    `INSERT INTO company_plan_changes (
       company_id, from_plan_id, to_plan_id, from_plan_code, to_plan_code,
       from_monthly_price, to_monthly_price, effective_date, change_type, changed_by, reason
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::date, $9, $10::uuid, $11)
     RETURNING id`,
    [
      companyId,
      prev?.to_plan_id || null,
      toPlanId,
      prev?.to_plan_code || null,
      to.plan_code,
      prev?.to_monthly_price ?? null,
      to.monthly_price,
      effectiveDate,
      changeType,
      changedByParam,
      reasonWithActor,
    ],
  );

  console.log(
    `[plan-change] company=${companyId} ${prev?.to_plan_code || '(없음)'} → ${to.plan_code} ` +
    `type=${changeType} effective=${effectiveDate}`,
  );

  // ★ 2026-10-26 남은 기간 크레딧. 체험 부여 · 만료는 그 경로가 기본 칸을 직접 정하므로 건너뛴다.
  const creditAdjust: PlanCreditAdjustResult =
    changeType === 'trial_start' || changeType === 'trial_expire' || to.plan_code === 'TRIAL'
      ? { applied: false, skipped: 'trial' }
      : await applyPlanCreditDelta(client, {
          companyId,
          changeId: String(inserted.rows[0]?.id || ''),
          prevPlanId: prev?.to_plan_id ? String(prev.to_plan_id) : null,
          prevPlanCode: prev?.to_plan_code ? String(prev.to_plan_code) : null,
          toPlanCode: String(to.plan_code || ''),
          toCredits: Number(to.credits) || 0,
          effectiveDate,
        });

  return { recorded: true, changeType, creditAdjust };
}

export interface PlanCreditAdjustResult {
  applied: boolean;
  /** 건너뛴 이유 — 운영에서 "왜 안 들어왔나"를 로그로 되짚을 수 있어야 한다 */
  skipped?: 'trial' | 'no_company' | 'future_month' | 'no_change' | 'duplicate';
  delta?: number;
  baseAfter?: number;
  remainingDays?: number;
  monthDays?: number;
}

/**
 * 요금제가 바뀐 날 그 달 남은 기간 크레딧을 기본 칸에 반영한다(★ 2026-10-26 · 산식 = `planChangeCreditDelta`).
 * `recordPlanChange` 안에서만 부른다 — 이력 INSERT 와 같은 트랜잭션 · 같은 회사 잠금.
 *
 * ★ 이번 달 리셋 전(`reset_at`이 지난달)이면 **직전 요금제로 리셋부터** 돌린다.
 *   그냥 두면 다음 AI 사용 때 lazy 리셋이 새 요금제 한 달치를 통째로 넣어 일할이 무너진다.
 * ★ 원장 INSERT 가 먼저고, 실제로 들어간 경우에만 기본 칸을 고친다(재시도 이중 반영 차단 · 키 = 이력 행 id).
 */
async function applyPlanCreditDelta(
  client: PoolClient,
  o: {
    companyId: string; changeId: string; prevPlanId: string | null; prevPlanCode: string | null;
    toPlanCode: string; toCredits: number; effectiveDate: string;
  },
): Promise<PlanCreditAdjustResult> {
  const now = new Date();
  let row = await loadCreditRow(client, o.companyId, true);
  if (!row) return { applied: false, skipped: 'no_company' };

  let fromCredits = 0;
  if (o.prevPlanId) {
    const r = await client.query(
      `SELECT COALESCE(ai_credits_per_month, 0) AS credits FROM plans WHERE id = $1::uuid`,
      [o.prevPlanId],
    );
    fromCredits = Number(r.rows[0]?.credits) || 0;
  }

  if (needsMonthlyReset(row.reset_at ? new Date(row.reset_at) : null, now)) {
    row = await applyResetIfNeeded(client, o.companyId, { ...row, plan_credits: fromCredits }, now);
  }

  const d = planChangeCreditDelta({
    effectiveDate: o.effectiveDate,
    today: todayKst(now.getTime()),
    fromCredits,
    toCredits: o.toCredits,
    fromTrial: o.prevPlanCode === 'TRIAL',
    base: Number(row.base) || 0,
    carriesNegative: String(row.billing_type) === 'prepaid',
  });
  if (!d) {
    console.log(`[plan-credit] company=${o.companyId} 변경일 ${o.effectiveDate} 이 다음 달 이후라 크레딧 반영 건너뜀`);
    return { applied: false, skipped: 'future_month' };
  }
  if (d.delta === 0) return { applied: false, skipped: 'no_change', delta: 0, baseAfter: d.newBase };

  const purchased = Number(row.purchased) || 0;
  // amount 의 **부호가 방향**이다(양수 = 지급 · 음수 = 회수). 다른 type 과 달리 type 이 방향을 담지 않는다.
  const ins = await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, reason)
     VALUES ($1::uuid, 'plan_prorate', $2, 'base', 'plan-prorate', $3, $4, $5, $6)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      o.companyId, d.delta, `plan-prorate:${o.changeId}`, d.newBase, purchased,
      `요금제 변경 남은 기간 크레딧: ${o.prevPlanCode || '(없음)'} → ${o.toPlanCode} · ${d.remainingDays}/${d.monthDays}일`,
    ],
  );
  if ((ins.rowCount || 0) === 0) return { applied: false, skipped: 'duplicate' };
  await client.query(
    `UPDATE companies SET ai_credits_base_remaining = $2 WHERE id = $1::uuid`,
    [o.companyId, d.newBase],
  );

  console.log(`[plan-credit] company=${o.companyId} ${o.prevPlanCode || '(없음)'}→${o.toPlanCode} ${d.remainingDays}/${d.monthDays}일 ${d.delta >= 0 ? '+' : ''}${d.delta} base=${Number(row.base) || 0}→${d.newBase}`);
  return { applied: true, delta: d.delta, baseAfter: d.newBase, remainingDays: d.remainingDays, monthDays: d.monthDays };
}

/**
 * 이력 기록 실패를 드러낸다. 호출부 트랜잭션이 롤백된 뒤 부르는 용도다.
 * 플랜 변경 자체도 함께 롤백되므로 데이터는 일관되지만, **사용자 요청이 실패한 것**이라 알려야 한다.
 */
export async function alertPlanChangeFailure(companyId: string, err: unknown): Promise<void> {
  const msg = (err as any)?.message || String(err);
  console.log(`[plan-change][MISS] 트랜잭션 롤백 company=${companyId}: ${msg}`);
  try {
    await sendSystemAlert({
      dedupKey: `plan-change-miss:${companyId}`,
      message: `요금제 변경 실패(이력 기록 포함 롤백) — company=${companyId}. 재시도 필요. (${msg})`,
    });
  } catch (alertErr: any) {
    // 알림까지 실패하면 콘솔이 마지막 흔적이다 — 빈 catch로 버리지 않는다(Codex 지적 E).
    console.log(`[plan-change][ALERT_FAIL] company=${companyId}: ${alertErr?.message || alertErr}`);
  }
}
