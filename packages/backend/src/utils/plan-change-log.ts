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
 */

import type { PoolClient } from 'pg';
import { sendSystemAlert } from './system-alert';
import { needsMonthlyReset } from './ai-credit-calc';
import { loadCreditRow } from './ai-credit-tx';
import { buildPlanSegments, prorateMonthlyCredits, buildCreditAdjustment, daysInMonth } from './plan-proration';

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
    `SELECT plan_code, monthly_price FROM plans WHERE id = $1::uuid`,
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

  await client.query(
    `INSERT INTO company_plan_changes (
       company_id, from_plan_id, to_plan_id, from_plan_code, to_plan_code,
       from_monthly_price, to_monthly_price, effective_date, change_type, changed_by, reason
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::date, $9, $10::uuid, $11)`,
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
      changedBy || null,
      reason || null,
    ],
  );

  console.log(
    `[plan-change] company=${companyId} ${prev?.to_plan_code || '(없음)'} → ${to.plan_code} ` +
    `type=${changeType} effective=${effectiveDate}`,
  );

  // ★ 2026-07-26 크레딧 일할 조정은 **아직 여기서 부르지 않는다.** (Codex 2차 CRITICAL 수용)
  //
  //   호출부가 `plan_id`를 바꾸는 **같은 UPDATE에서 이미** `ai_credits_base_remaining`을
  //   새 플랜 월 크레딧으로 덮어쓰고 `ai_credits_reset_at`도 NOW()로 찍는다
  //   (`basic-trial.ts` 무료체험 부여 · `companies.ts` 체험 취소 · `trial-downgrade-worker.ts` 만료 강등).
  //   그런데 그 UPDATE는 `ai_credit_transactions`에 `reset` 행을 남기지 않는다.
  //
  //   여기서 조정을 걸면: base는 이미 한 달치(750)로 세팅됐는데 `granted` 집계는 0으로 보이고,
  //   `reset_at`이 방금이라 "리셋 대기" 건너뛰기에도 안 걸린다 →
  //   **일할 권리 532가 그 위에 더해져 1,282이 된다.** 7/10 체험 전환에서 과다 부여가 확정적으로 난다.
  //
  //   근본은 "크레딧 잔액을 누가 쓰는가"가 두 곳으로 갈려 있다는 것이다.
  //   조정을 붙이기 전에 **호출부의 선행 크레딧 UPDATE를 걷어내고 이 함수를 단일 작성자로** 만들어야 한다.
  //   9개 호출 경로를 전부 옮기는 일이라 별도 작업으로 분리한다 —
  //   돈 잔액을 두 곳에서 쓰는 상태로 조정을 얹는 것이 이 결함의 본체다.
  //
  //   순수 산식(`prorateMonthlyCredits`·`buildCreditAdjustment`)과 `adjustPlanCreditsWithClient`는
  //   테스트까지 끝나 있으므로, 단일 작성자 정리가 끝나면 이 자리에서 한 줄로 켜면 된다.

  return { recorded: true, changeType };
}

export interface PlanCreditAdjustResult {
  applied: boolean;
  /** 건너뛴 이유 — 운영에서 "왜 안 들어왔나"를 로그로 되짚을 수 있어야 한다 */
  skipped?: 'credit_disabled' | 'reset_pending' | 'no_history' | 'no_change';
  entitlement?: number;
  granted?: number;
  adjustment?: number;
}

/**
 * 요금제 변경에 따라 **그 달 크레딧 권리를 다시 계산해 `base`에 반영**한다. (★ 2026-07-26 신설)
 *
 * Harold 지시 두 갈래를 하나의 산식으로 합친 것이다.
 *   - 올릴 때: "일할계산해서 추가 크레딧을 자동으로 지급해야 하잖아?"
 *   - 내릴 때: "다운그레이드하려는 요금제 미만의 크레딧이 남아 있다면 이미 다 써버리고 내린 것 아니냐"
 *
 * 방향별로 다른 규칙을 두면 **다 쓰고 내리는 게 이득이 되는 구조**가 남는다 —
 * PRO 크레딧 2,400을 열흘에 다 쓰고 BASIC으로 내리면 열흘치 요금만 내고 한 달치 크레딧을 가져간다.
 * 그래서 권리를 일할로 재계산하고 이미 부여된 양과의 차이만 반영한다. 올림·내림이 같은 식이 된다.
 *
 * ★ 리셋이 아직 안 된 달이면 **건너뛴다.** 그 상태에서 조정을 넣어도 곧 리셋이
 *   `base = 새 플랜 한 달치`로 덮어써 조정이 사라지고, 리셋이 먼저 일어나면 이중 지급이 된다.
 *   (`applyResetIfNeeded`는 차감 직전에 lazy로 도는데, 이 함수는 그보다 앞설 수 있다.)
 *
 * ★ 결과가 음수여도 자르지 않는다. `base` 음수는 이미 있는 구조다 —
 *   다음 달 리셋이 `min(0, 지난 base)`로 상계하고, 후불이면 초과분으로 청구된다.
 *   0에서 자르면 위의 "다 쓰고 내리는 이득"이 그대로 남는다.
 */
export async function adjustPlanCreditsWithClient(
  client: PoolClient,
  companyId: string,
  now: Date = new Date(),
): Promise<PlanCreditAdjustResult> {
  const row = await loadCreditRow(client, companyId, true);
  if (!row) return { applied: false, skipped: 'credit_disabled' };

  // 크레딧제 미적용(요금제 크레딧 미설정 + 구매분 0)이면 손대지 않는다 — 차감도 안 도는 회사다.
  if (row.plan_credits == null && (Number(row.purchased) || 0) === 0) {
    return { applied: false, skipped: 'credit_disabled' };
  }

  const resetAt = row.reset_at ? new Date(row.reset_at) : null;
  if (needsMonthlyReset(resetAt, now)) {
    console.log(`[plan-credit] company=${companyId} 월 리셋 대기 상태라 일할 조정 건너뜀 — 리셋이 새 플랜 한 달치를 부여한다.`);
    return { applied: false, skipped: 'reset_pending' };
  }

  const today = todayKst(now.getTime());
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  const monthEnd = `${today.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;

  // 이 달 권리를 정하려면 **달 시작 이전 이력까지** 필요하다 — 없으면 달 초 플랜을 모른다.
  const changesRes = await client.query(
    `SELECT cpc.effective_date, cpc.to_plan_code, cpc.to_monthly_price, p.ai_credits_per_month
       FROM company_plan_changes cpc
       LEFT JOIN plans p ON p.id = cpc.to_plan_id
      WHERE cpc.company_id = $1::uuid AND cpc.effective_date <= $2::date
      ORDER BY cpc.effective_date ASC, cpc.changed_at ASC`,
    [companyId, monthEnd],
  );
  if (changesRes.rows.length === 0) return { applied: false, skipped: 'no_history' };

  const creditsByCode = new Map<string, number>();
  for (const r of changesRes.rows as any[]) {
    creditsByCode.set(String(r.to_plan_code || ''), Number(r.ai_credits_per_month) || 0);
  }

  const segments = buildPlanSegments(changesRes.rows as any[], monthStart, monthEnd);
  const entitlementRaw = prorateMonthlyCredits(
    segments.map((s) => ({ planCredits: creditsByCode.get(s.planCode) || 0, days: s.days, monthDays: s.monthDays })),
  );

  // 이 달에 이미 부여된 양 = 월 리셋 grant + 앞선 일할 조정들.
  // `reset`의 amount는 상계 전 gross라 "이 달 권리로 준 양"과 의미가 맞는다.
  const grantedRes = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS granted
       FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND type IN ('reset', 'plan_prorate')
        AND created_at >= ($2 || ' 00:00:00+09')::timestamptz
        AND created_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz`,
    [companyId, monthStart, monthEnd],
  );

  const { entitlement, granted, adjustment } = buildCreditAdjustment(
    entitlementRaw, Number(grantedRes.rows[0]?.granted) || 0,
  );
  if (adjustment === 0) return { applied: false, skipped: 'no_change', entitlement, granted, adjustment };

  const base = Number(row.base) || 0;
  const purchased = Number(row.purchased) || 0;
  const baseAfter = base + adjustment;

  await client.query(
    `UPDATE companies SET ai_credits_base_remaining = $2 WHERE id = $1::uuid`,
    [companyId, baseAfter],
  );
  // amount의 **부호가 방향**이다(양수=지급, 음수=회수). 다른 type과 달리 type이 방향을 담지 않는다.
  await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, reason)
     VALUES ($1::uuid, 'plan_prorate', $2, 'base', 'plan-prorate', $3, $4, $5, $6)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      companyId, adjustment, `plan-prorate:${companyId}:${today}:${entitlement}:${granted}`,
      baseAfter, purchased,
      `요금제 변경 일할 조정 — 이 달 권리 ${entitlement} / 기부여 ${granted}`,
    ],
  );

  console.log(`[plan-credit] company=${companyId} 권리=${entitlement} 기부여=${granted} 조정=${adjustment >= 0 ? '+' : ''}${adjustment} base=${base}→${baseAfter}`);
  return { applied: true, entitlement, granted, adjustment };
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
