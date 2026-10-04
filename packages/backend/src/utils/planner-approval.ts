/**
 * planner-approval.ts — 마케팅 플래너 월 대행 원장 CT (★ 2026-08-13 Phase 2 · ★ 2026-10-04 행사별 승인 전환)
 *
 * 설계서 = docs/2026-10-04-planner-material-approval-design.md (§6-5 승인 · §6-9 취소·환불 · §7 돈)
 * 기능 상설 = docs/FEATURE-MARKETING-PLANNER.md
 *
 * ★ 2026-10-04 월간 결재(브리핑 · 결재 올리기 · 월 승인 · 결재 문자)는 폐지됐다 — 승인은 행사마다(planner-approve).
 * 이 파일에 남은 것 = **월 대행 계약 원장**: 대행 단가 · 차감 멱등키(회사·월·회차) · 회차 · 결제 상태 · 월 대행 취소·환불 · 옛 결재 링크 착지.
 *
 * ⛔ 불변
 *   - 대행 단가의 진실 = getCreditCost('planner-monthly-agency') 하나. 이 파일에 숫자를 쓰지 않는다.
 *   - 차감 멱등키는 회사·월·**결제 회차** — 더블클릭·재시도·재승인이 한 키로 수렴한다(이중 차감 0). 회차 = 그 달 환불 수.
 *   - 취소·실적·환불은 한 트랜잭션(월 원장 행 잠금) — 실행 선점 · 행사 승인과 같은 잠금 순서(월 원장 → companies).
 *   - 마이너스·자동충전 금지 — source를 OPERATION_SOURCES에 넣지 않는 것이 그 장치다(ai-credit-calc).
 */
import { pool, query } from '../config/database';
import { getCreditCost, kstMonthTag } from './ai-credit-calc';
import { notifyOperatorAdmins } from './continuous-operator';
import { evaluateCancelRefund, plannerRefundKey, plannerAgencyDeductKey, PLANNER_NOTICE_HEADER } from './planner-execution';
import { refundCreditWithClient } from './ai-credit-tx';
import { countMonthWork } from './planner-touchpoint';

// ── 요금 축 ──────────────────────────────────────────────────────────
/** 대행 크레딧 source. 단가는 CREDIT_COST_MAP이 소유한다. */
export const PLANNER_AGENCY_SOURCE = 'planner-monthly-agency';

/** 그 달 대행 크레딧(= 승인 시 1회 차감분). */
export function getAgencyCredits(): number {
  return getCreditCost(PLANNER_AGENCY_SOURCE);
}

/**
 * 차감 멱등키 — 회사·월·**결제 회차**(설계서 §3-4 + ★2026-08-13 회차 축).
 * 회차 0 = 종전 키. 회차는 그 달의 환불 수다 — 환불 뒤 재승인은 새 회차라 다시 결제된다.
 */
export function buildApprovalIdempotencyKey(companyId: string, planMonth: string, cycle = 0): string {
  return plannerAgencyDeductKey(companyId, planMonth, cycle);
}

/**
 * 그 달의 결제 회차 = 지금까지 난 대행 환불 수.
 * 조회 실패는 전파한다 — 회차를 모른 채 차감·환불 키를 만들면 이중 결제·이중 환불의 문이 열린다.
 */
async function loadChargeCycle(companyId: string, planMonth: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(*)::int AS cnt FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND type = 'refund' AND source = $2
        AND idempotency_key LIKE $3`,
    [companyId, PLANNER_AGENCY_SOURCE, `${plannerRefundKey(companyId, planMonth)}%`],
  );
  return Number(r.rows[0]?.cnt) || 0;
}

// ── 월 축 ────────────────────────────────────────────────────────────
/** KST 기준 이번 달 'YYYY-MM'. 시간 계산의 주인은 kstMonthTag 하나다. */
export function currentPlanMonth(now: Date = new Date()): string {
  const tag = kstMonthTag(now); // 'YYYYMM'
  return `${tag.slice(0, 4)}-${tag.slice(4)}`;
}

async function loadApprovalRow(companyId: string, planMonth: string): Promise<any | null> {
  const r = await query(
    `SELECT id, status, agency_credits, est_snapshot, deduct_idempotency_key, deducted_at,
            token, token_expires_at, submitted_at, approved_at, approve_attempt, event_ids, plan_hash
       FROM planner_monthly_approvals
      WHERE company_id = $1::uuid AND plan_month = $2`,
    [companyId, planMonth],
  );
  return r.rows[0] || null;
}

/**
 * 그 달 대행분이 실제로 차감됐는가 — 진실은 크레딧 원장이다(승인 원장의 표기가 아니라).
 * ⛔ 멱등키 문자열에 회사 uuid가 들어 있어도 그것은 **SQL의 테넌트 경계가 아니다.**
 *    회사·유형·source까지 조건으로 걸어야 다른 회사 행 하나가 이 회사의 복구 경로를 여는 일이 없다.
 */
async function hasAgencyDeduction(companyId: string, idempotencyKey: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM ai_credit_transactions
      WHERE idempotency_key = $1 AND company_id = $2::uuid AND type = 'deduct' AND source = $3
      LIMIT 1`,
    [idempotencyKey, companyId, PLANNER_AGENCY_SOURCE],
  );
  return r.rows.length > 0;
}

/**
 * 그 달 대행분이 **지금도 결제 상태인가** — 이번 회차의 차감이 있는가.
 *
 * ⛔ 차감 행만 월 단위로 보면 **환불된 달이 영원히 "이미 냈다"로 남는다.** 그러면
 *   승인 → 무작업 취소·환불 → 같은 달 새 계획 제출 → 승인이 **무료**로 성립한다(복구 경로로 들어가
 *   게이트를 건너뛰고, 차감은 같은 멱등키라 duplicate로 끝나 돈이 다시 나가지 않는다).
 *   회차 키를 쓰면 환불로 회차가 올라가 그 회차의 차감이 없으니 **미결제**가 되고, 승인은 정상 결제한다.
 */
export async function loadAgencyPaymentState(companyId: string, planMonth: string): Promise<{ cycle: number; key: string; paid: boolean }> {
  const cycle = await loadChargeCycle(companyId, planMonth);
  const key = buildApprovalIdempotencyKey(companyId, planMonth, cycle);
  return { cycle, key, paid: await hasAgencyDeduction(companyId, key) };
}

export class PlannerApprovalError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
    this.name = 'PlannerApprovalError';
  }
}

// ── 취소·환불 (★ 2026-08-13 Phase 3 · 인계 §4-⑤) ────────────────────
/**
 * 그 달 대행 취소. **환불은 그 달 발송 시도가 0건일 때만 전액**이다(★ 2026-10-04 §6-9 · 일할 계산 없음).
 * 승인 때 낸 모바일 DM 발행비 · 메일 완성비는 돌려드리지 않는다(승인 창 고지 · D1).
 *
 * 순서 = 실적 확인 → 원장 전이(취소) → 환불. 환불을 먼저 하면 전이가 실패했을 때 돈만 돌아간 달이 남는다.
 * ⛔ 되돌리는 것은 **대행료 하나**다. 이미 만든 소재·나간 발송은 되돌릴 수 없고, 그래서 실적이 있으면 환불이 없다.
 * ⛔ 환불 멱등키(`planner-refund:{회사}:{월}`)로 두 번 돌려주지 않는다. 원 차감 키가 없으면 환불하지 않는다.
 */
export async function cancelMonthlyApproval(
  companyId: string,
  planMonth: string,
  userId: string | null,
): Promise<{ status: string; refunded: boolean; refundAmount: number; reason: string }> {
  // ⛔ 이미 취소된 달도 **환불 완료 여부를 다시 대조한다**(취소는 커밋됐는데 환불만 실패한 창).
  //   상태 판정·전이·환불은 아래 단일 트랜잭션이 잠금 아래에서 한다.
  const row = await loadApprovalRow(companyId, planMonth);
  if (!row) throw new PlannerApprovalError('이번 달은 승인한 행사가 없어 취소할 대행이 없습니다.', 'NOT_SUBMITTED');
  const alreadyCancelled = row.status === 'cancelled';


  // ★ 2026-08-13 Codex 2R 구조 정정 — **취소·실적·환불을 한 트랜잭션에서 한다.**
  //   ①그 달 승인 원장 행을 FOR UPDATE로 잠근다 → 실행·제작 선점(claimTouchpointUnderPlanLock)과 직렬화된다.
  //   ②아직 선점되지 않은 터치포인트만 닫는다 — **producing은 건드리지 않는다**(진행 중 발송을 상태로 덮으면
  //     그 행이 나갔는지 아무도 모른다). 그 행은 아래 실적 집계가 실행으로 세어 환불을 막는다.
  //   ③실적 집계와 환불도 같은 트랜잭션 — 취소만 커밋되고 환불이 유실되는 창을 없앤다.
  //   잠금 순서는 승인 원장 → companies로 통일한다(선점 경로와 같은 순서라 교착이 없다).
  let verdict = { refundable: false, amount: 0, reason: '환불할 대행료 차감 내역이 없습니다.' };
  let refunded = false;
  let work = { executed: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      `SELECT status, agency_credits FROM planner_monthly_approvals
        WHERE company_id = $1::uuid AND plan_month = $2 FOR UPDATE`,
      [companyId, planMonth],
    );
    if (lock.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new PlannerApprovalError('취소할 결재 내역이 없습니다.', 'NOT_SUBMITTED');
    }
    // ⛔ 회차 키도 **잠금 안에서** 계산한다(잠금 밖에서 잡으면 그 사이 승인·환불이 끼어들어 옛 회차만 환불한다).
    const cycleRes = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM ai_credit_transactions
        WHERE company_id = $1::uuid AND type = 'refund' AND source = $2 AND idempotency_key LIKE $3`,
      [companyId, PLANNER_AGENCY_SOURCE, `${plannerRefundKey(companyId, planMonth)}%`],
    );
    const cycle = Number(cycleRes.rows[0]?.cnt) || 0;
    const idempotencyKey = buildApprovalIdempotencyKey(companyId, planMonth, cycle);
    const refundKey = plannerRefundKey(companyId, planMonth, cycle);
    const lockedStatus = String(lock.rows[0].status);
    if (lockedStatus === 'approving') {
      await client.query('ROLLBACK');
      throw new PlannerApprovalError('승인 처리 중입니다. 잠시 후 다시 시도해 주세요.', 'IN_PROGRESS', 409);
    }
    if (lockedStatus !== 'cancelled') {
      await client.query(
        `UPDATE planner_monthly_approvals
            SET status = 'cancelled', approve_attempt = NULL, token = NULL, token_expires_at = NULL, updated_at = NOW()
          WHERE company_id = $1::uuid AND plan_month = $2`,
        [companyId, planMonth],
      );
      await client.query(
        `UPDATE planner_touchpoints t
            SET status = 'skipped', lock_reason = '월간 대행이 취소돼 발송하지 않았습니다.'
          WHERE t.company_id = $1::uuid
            AND t.status IN ('planned', 'ready', 'hold_credit', 'locked')
            AND t.event_id IN (SELECT id FROM planner_events WHERE company_id = $1::uuid AND plan_month = $2)`,
        [companyId, planMonth],
      );
      await client.query(
        `UPDATE planner_events SET status = 'cancelled', updated_at = NOW()
          WHERE company_id = $1::uuid AND plan_month = $2 AND status <> 'cancelled'`,
        [companyId, planMonth],
      );
    }

    // 실적 집계 — 같은 트랜잭션·잠금 안이라 그 사이 새 선점이 끼어들 수 없다. 판정 한 벌 = countMonthWork(★ 2026-10-04 §6-9).
    work = await countMonthWork(companyId, planMonth, client);

    const paidRes = await client.query(
      `SELECT 1 FROM ai_credit_transactions
        WHERE idempotency_key = $1 AND company_id = $2::uuid AND type = 'deduct' AND source = $3 LIMIT 1`,
      [idempotencyKey, companyId, PLANNER_AGENCY_SOURCE],
    );
    verdict = evaluateCancelRefund({
      agencyPaid: paidRes.rows.length > 0,
      agencyCredits: Number(lock.rows[0].agency_credits) || 0,
      executedCount: work.executed,
    });

    if (verdict.refundable) {
      const res = await refundCreditWithClient(client, {
        companyId,
        amount: verdict.amount,
        source: PLANNER_AGENCY_SOURCE,
        reason: `${planMonth} 마케팅 플래너 월간 대행 취소 환불(제작·발송 0건)`,
        createdBy: userId,
        idempotencyKey: refundKey,
        originalIdempotencyKey: idempotencyKey,
        manageTx: false,
      }, new Date());
      refunded = res.refunded;
      if (!refunded && res.skipReason !== 'duplicate') {
        console.error(`[planner-approval][REFUND-MISS] company=${companyId} month=${planMonth} reason=${res.skipReason || 'unknown'}`);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }

  try {
    if (!alreadyCancelled || refunded) await notifyOperatorAdmins(
      { adminPhoneNumbers: [], backupAdminPhone: null, companyId, createdBy: userId },
      '[마케팅 플래너] 월간 대행 취소',
      [
        `${Number(planMonth.slice(5, 7))}월 마케팅 대행이 취소됐습니다.`,
        refunded ? `대행료 ${verdict.amount.toLocaleString()} 크레딧을 환불했습니다.` : verdict.reason,
        '남은 발송 계획은 모두 중지됐습니다.',
      ].join('\n'),
      { noticeHeader: PLANNER_NOTICE_HEADER },
    );
  } catch (e: any) {
    console.warn('[planner-approval] 취소 통지 실패:', e?.message || e);
  }

  console.log(`[planner-approval] 월간 취소 ${companyId} ${planMonth} — 환불 ${refunded ? verdict.amount : 0} · 발송 시도 ${work.executed}`);
  return { status: 'cancelled', refunded, refundAmount: refunded ? verdict.amount : 0, reason: verdict.reason };
}

// ── 결재 링크 착지 ───────────────────────────────────────────────────
/** 토큰 → 그 달(만료·미존재는 null). 승인 권한이 아니라 어느 달의 결재 화면인지만 정한다. */
export async function resolveApprovalToken(token: string): Promise<{ planMonth: string; status: string } | null> {
  const t = String(token || '').trim();
  if (!/^[a-f0-9]{32,64}$/.test(t)) return null;
  const r = await query(
    `SELECT plan_month, status FROM planner_monthly_approvals
      WHERE token = $1 AND token_expires_at > NOW()`,
    [t],
  );
  if (r.rows.length === 0) return null;
  return { planMonth: String(r.rows[0].plan_month), status: String(r.rows[0].status) };
}
