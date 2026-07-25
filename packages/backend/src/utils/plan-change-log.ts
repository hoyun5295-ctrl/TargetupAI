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
  return { recorded: true, changeType };
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
