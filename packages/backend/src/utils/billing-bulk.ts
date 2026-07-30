/**
 * ★ CT: 거래내역서 일괄발급 배치 (2026-07-28)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §3·§1-4.
 * 흐름: 대상 산출(후불·미발급) → job 생성 → **순차** 실행(회사마다 issueBilling 코어) →
 *       성공 시 메일·컨펌 추적 생성 → item별 성패 기록(부분 실패 허용) → 진행률 폴링.
 *
 * 원칙:
 *  - 발행 코어는 utils/billing-issue.ts **하나만** 쓴다 — 단건 발행과 같은 검증·같은 차단이 그대로 적용된다.
 *  - 한 회사 실패는 그 item만 failed. 141사를 한 트랜잭션으로 묶지 않는다(§2-7 과잉 차단 함정).
 *  - 순차 실행 이유: 발행 하나가 이미 MySQL 정산 풀(8)을 테이블 병렬로 다 쓴다.
 *    회사까지 병렬로 겹치면 서로를 굶기고, per-statement 60초 상한 쪽으로 밀린다.
 */

import pool from '../config/database';
import { issueBilling, BillingIssueError } from './billing-issue';
import { createAndSendConfirmations } from './invoice-confirm';

export interface UnbilledCompanyRow {
  id: string;
  company_name: string;
  issue_scope: string;
  taxbill_day_policy: string;
  company_contact_email: string | null;
  missing_account_emails: number;
  /** true = 우리 정산으로 발행할 수 없는 회사 — 목록에는 뜨지만 담기에서 빠진다. */
  manual_billing: boolean;
  /** ★ 2026-07-30 최소과금 공급가(서수란 접수) — 값 있으면 정액 발행 대상 = 일괄발급 담기에서 빠진다(목록엔 뜸). */
  min_charge_supply: number | null;
}

/**
 * 후불이면서 해당 기간과 겹치는 발행이 없는 회사 목록 (일괄발급 화면 상단 리스트).
 *
 * ★ 2026-07-29 **이 함수가 "발급 대상 적격" 판정의 단일 진실이다.** 화면 목록·job 생성 재검증·
 *   item 실행 직전 재검증이 전부 여기를 통과한다(`opts.companyIds`로 좁혀 호출). 판정을 호출부마다
 *   따로 적으면 프론트만 막고 서버는 뚫리는 구조가 된다(Codex 적대검증 1R high 2건의 뿌리).
 *
 * ★ 수동 정산완료는 **조회 기간을 완전히 덮을 때만** 제외한다(겹침 아님).
 *   `billings`는 실제 청구서라 겹치면 재발행 차단이 맞지만, 금액이 없는 수동완료에 같은 식을 쓰면
 *   6월 하루치 기록이 6월 전체를 숨기고 중간정산(6/25~7/25) 조회에서 7월분까지 사라진다 = 매출 누락.
 */
export async function listUnbilledPostpaid(
  periodStart: string,
  periodEnd: string,
  opts: { companyIds?: string[] | null; db?: any } = {},
): Promise<UnbilledCompanyRow[]> {
  const db = opts.db || pool;
  const ids = opts.companyIds && opts.companyIds.length > 0 ? opts.companyIds : null;
  const r = await db.query(
    // ★ Codex 1R 수용 — 계정별(by_user) 회사는 계정 담당자 이메일 누락 수를 함께 내려
    //   담는 시점에 "계정 메일 N건 미등록"을 보여준다(회사 레벨 이메일만 보면 사각).
    `SELECT c.id, c.company_name,
            COALESCE(s.issue_scope, 'combined')        AS issue_scope,
            COALESCE(s.taxbill_day_policy, 'last_day') AS taxbill_day_policy,
            COALESCE(s.manual_billing, false)          AS manual_billing,
            s.min_charge_supply                        AS min_charge_supply,
            bc.contact_email                           AS company_contact_email,
            (SELECT count(*)::int FROM users u
              WHERE u.company_id = c.id AND u.is_active = true AND COALESCE(u.is_system, false) = false
                AND NOT EXISTS (
                  SELECT 1 FROM billing_contacts bc2
                   WHERE bc2.user_id = u.id AND COALESCE(bc2.contact_email, '') <> ''
                )) AS missing_account_emails
       FROM companies c
       LEFT JOIN company_billing_settings s ON s.company_id = c.id
       LEFT JOIN billing_contacts bc ON bc.company_id = c.id AND bc.user_id IS NULL
      WHERE c.billing_type = 'postpaid'
        AND ($3::uuid[] IS NULL OR c.id = ANY($3::uuid[]))
        AND NOT EXISTS (
          SELECT 1 FROM billings b
           WHERE b.company_id = c.id
             AND b.billing_start <= $2::date AND b.billing_end >= $1::date
        )
        AND NOT EXISTS (
          SELECT 1 FROM billing_manual_completions mc
           WHERE mc.company_id = c.id
             AND mc.period_start <= $1::date AND mc.period_end >= $2::date
        )
      ORDER BY c.company_name ASC`,
    [periodStart, periodEnd, ids],
  );
  return r.rows as UnbilledCompanyRow[];
}

/**
 * 발급 적격 회사 집합 — 위 목록 판정 + `manual_billing = false`.
 *
 * 목록에는 수동 정산 회사도 뜨지만(그 달 처리 여부를 봐야 하므로) **발급 대상은 아니다.**
 * job 생성과 item 실행 직전이 이 함수를 호출한다 — 프론트 필터는 편의고, 불변식은 여기다.
 */
export async function filterBillableCompanies(
  companyIds: string[],
  periodStart: string,
  periodEnd: string,
  db: any = pool,
): Promise<Set<string>> {
  if (companyIds.length === 0) return new Set();
  const rows = await listUnbilledPostpaid(periodStart, periodEnd, { companyIds, db });
  // ★ 2026-07-30 최소과금 회사도 일괄발급 부적격 — 정액 발행(최소과금 모달)이 그 회사의 청구 경로다.
  //   사용량 발행과 정액 발행이 겹치면 이중청구라 발급 대상에서 구조로 뺀다(수동 정산과 같은 계약).
  return new Set(rows.filter((r) => r.manual_billing !== true && r.min_charge_supply == null).map((r) => String(r.id)));
}

// ═══════════════════════════════════════════════════════════
// 수동 정산완료 (★2026-07-29) — 우리 정산으로 발행할 수 없어 사람이 따로 처리한 회사의 그 달 기록
//
// 청구서(billings)를 만들지 않는다. 만들면 PDF·세금계산서·매출 집계가 전부 그 가짜 장을 세게 된다.
// 별도 축으로 두고 위 목록 쿼리에서만 뺀다 — 되돌리면(해제) 그 회사는 곧바로 다시 대상이 된다.
// ═══════════════════════════════════════════════════════════

/**
 * (순수) 수동완료는 **달 단위로만** 기록한다 — 대상월 1일 ~ 말일.
 * 임의 기간을 허용하면 하루짜리 기록이 조회 판정에 걸려 그 달 전체를 가리거나,
 * 반대로 월 경계를 걸친 기록이 두 달을 함께 가린다. 입구에서 막으면 그 논쟁 자체가 사라진다.
 * 문자열 연산만 쓴다(로컬 TZ 보정으로 하루 밀리는 계열 차단 — billing-settings.ts와 같은 원칙).
 */
export function isWholeMonthPeriod(periodStart: string, periodEnd: string): boolean {
  if (!/^\d{4}-\d{2}-01$/.test(periodStart)) return false;
  const y = Number(periodStart.slice(0, 4));
  const m = Number(periodStart.slice(5, 7)); // 1-based → Date.UTC(y, m, 0) = 그 달 말일
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return periodEnd === `${periodStart.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

export interface ManualCompletionRow {
  id: string;
  company_id: string;
  company_name: string;
  period_start: string;
  period_end: string;
  reason: string | null;
  created_at: string;
}

/** 해당 기간과 겹치는 수동완료 기록 (목록 헤더의 "수동완료 N개사" 토글). */
export async function listManualCompletions(periodStart: string, periodEnd: string): Promise<ManualCompletionRow[]> {
  const r = await pool.query(
    `SELECT mc.id, mc.company_id, c.company_name, mc.period_start, mc.period_end, mc.reason, mc.created_at
       FROM billing_manual_completions mc
       JOIN companies c ON c.id = mc.company_id
      WHERE mc.period_start <= $2::date AND mc.period_end >= $1::date
      ORDER BY c.company_name ASC`,
    [periodStart, periodEnd],
  );
  return r.rows as ManualCompletionRow[];
}

/**
 * 수동완료 기록 (다건). 같은 회사·같은 기간을 두 번 쳐도 한 행이다(ON CONFLICT DO NOTHING).
 *
 * ★ 2026-07-29 판정은 **목록과 같은 함수**다 — 목록에 남아 있는 회사만 표시할 수 있다.
 *   빠져 있다 = 이미 발행됐거나 이미 수동완료다. 별도 `billings` 조회를 두면 판정이 둘이 되고,
 *   둘은 반드시 어긋난다. 잠금도 job 생성·발행 직전 재판정과 **같은 전역 lock**이라,
 *   "발급이 커밋되는 사이 수동완료가 통과하는" 경로가 열리지 않는다.
 * @returns 새로 기록된 회사 수 + 제외된 회사명(이미 발행 또는 이미 수동완료)
 */
export async function addManualCompletions(
  companyIds: string[],
  periodStart: string,
  periodEnd: string,
  reason: string | null,
  createdBy: string | null,
): Promise<{ added: number; skipped: string[] }> {
  if (companyIds.length === 0) return { added: 0, skipped: [] };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ★ 2026-07-29 발급 코어(billing-issue.ts)와 **같은 회사 단위 잠금 축**을 쓴다.
    //   축이 다르면 두 쓰기가 서로를 못 막아 청구서와 수동완료가 함께 남는다(1·2R 같은 부류 반복의 원인).
    //   다건은 company_id 정렬 순서로 잡아 교착을 막는다.
    for (const id of [...companyIds].sort()) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('billing'))`, [id]);
    }
    const open = await listUnbilledPostpaid(periodStart, periodEnd, { companyIds, db: client });
    const openIds = new Set(open.map((r) => String(r.id)));
    const targets = companyIds.filter((id) => openIds.has(id));
    const blockedIds = companyIds.filter((id) => !openIds.has(id));
    let added = 0;
    if (targets.length > 0) {
      const ins = await client.query(
        `INSERT INTO billing_manual_completions (company_id, period_start, period_end, reason, created_by)
         SELECT x.id, $2::date, $3::date, $4::text, $5::uuid
           FROM unnest($1::uuid[]) AS x(id)
         ON CONFLICT (company_id, period_start, period_end) DO NOTHING
         RETURNING id`,
        [targets, periodStart, periodEnd, reason, createdBy],
      );
      added = ins.rows.length;
    }
    let skipped: string[] = [];
    if (blockedIds.length > 0) {
      const names = await client.query(
        `SELECT company_name FROM companies WHERE id = ANY($1::uuid[]) ORDER BY company_name ASC`,
        [blockedIds],
      );
      skipped = names.rows.map((x: any) => String(x.company_name));
    }
    await client.query('COMMIT');
    return { added, skipped };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* 호출부가 오류를 그대로 전달한다 */ }
    throw e;
  } finally {
    client.release();
  }
}

/** 수동완료 해제 — 그 회사는 곧바로 미발급 목록으로 돌아온다. */
export async function removeManualCompletion(id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM billing_manual_completions WHERE id = $1::uuid RETURNING id`, [id]);
  return r.rows.length > 0;
}

export interface BulkJobItemInput { companyId: string; scope: 'combined' | 'by_user' }

/** running으로 2시간 넘게 남은 job = 프로세스 재시작 고아 — 정리한다(Codex 1R HIGH 수용).
 *  발행은 6.7초/건이라 141사도 20분 안이다. 2시간은 어떤 정상 실행보다 넉넉하다.
 *  정리하지 않으면 running 가드가 이후 모든 일괄발급을 영구 409로 막는다. */
async function sweepOrphanBulkJobs(db: any): Promise<void> {
  const swept = await db.query(
    `UPDATE billing_bulk_jobs SET status = 'cancelled', finished_at = NOW()
      WHERE status = 'running' AND created_at < NOW() - INTERVAL '2 hours'
    RETURNING id`,
  );
  if (swept.rows.length > 0) {
    const ids = swept.rows.map((r: any) => String(r.id));
    await db.query(
      `UPDATE billing_bulk_job_items
          SET status = 'failed', error = '서버 재시작 등으로 실행이 끊겨 자동 정리됨(2시간 초과). 미발급 회사는 다시 담아 발급하면 된다.', finished_at = NOW()
        WHERE job_id = ANY($1::uuid[]) AND status IN ('pending', 'running')`,
      [ids],
    );
    console.log(`[일괄발급] 고아 job ${ids.length}건 자동 정리(2시간 초과 running)`);
  }
}

/** 실행 중 job이 있으면 새 job을 막는다 — 같은 회사 이중 발행은 코어 잠금이 막지만, 화면 혼선을 애초에 차단. */
export async function findRunningBulkJob(): Promise<string | null> {
  await sweepOrphanBulkJobs(pool);
  const r = await pool.query(`SELECT id FROM billing_bulk_jobs WHERE status = 'running' LIMIT 1`);
  return r.rows.length > 0 ? String(r.rows[0].id) : null;
}

/** job + items 생성 후 비동기 실행을 건다. 반환 즉시 화면은 진행률 폴링으로 넘어간다. */
export async function createBulkJob(
  periodStart: string,
  periodEnd: string,
  items: BulkJobItemInput[],
  createdBy: string | null,
): Promise<{ jobId: string }> {
  const client = await pool.connect();
  let jobId = '';
  try {
    await client.query('BEGIN');
    // ★ Codex 1R MEDIUM 수용 — running 검사와 INSERT를 같은 트랜잭션 + 전역 advisory lock으로 묶는다.
    //   라우트의 사전 검사만으로는 동시 요청 둘 다 통과해 job이 두 개 생긴다(TOCTOU).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('billing_bulk_job'), hashtext('global'))`);
    await sweepOrphanBulkJobs(client);
    const dup = await client.query(`SELECT id FROM billing_bulk_jobs WHERE status = 'running' LIMIT 1`);
    if (dup.rows.length > 0) {
      const err: any = new Error('이미 실행 중인 일괄발급이 있습니다. 완료 후 다시 시도해 주세요.');
      err.code = 'BULK_JOB_RUNNING';
      err.jobId = String(dup.rows[0].id);
      throw err;
    }
    // ★ 2026-07-29 대상 적격성을 **여기서 다시 판정한다.** 화면이 담은 뒤 다른 관리자가 수동 정산으로
    //   바꾸거나 수동완료를 기록했을 수 있고, 낡은 화면·직접 호출은 그 필터를 아예 거치지 않는다.
    //   판정은 목록과 같은 함수(단일 진실)이고, 이 트랜잭션이 잡은 전역 lock이 수동완료 기록과 직렬화한다.
    const billable = await filterBillableCompanies(items.map((i) => i.companyId), periodStart, periodEnd, client);
    const rejected = items.filter((i) => !billable.has(i.companyId)).map((i) => i.companyId);
    if (rejected.length > 0) {
      const err: any = new Error(
        `발급할 수 없는 회사가 ${rejected.length}개사 포함돼 시작하지 않았습니다 — 수동 정산 회사이거나, 이미 발행됐거나, 수동 정산완료로 표시된 회사입니다. 목록을 다시 불러와 주세요.`,
      );
      err.code = 'BULK_TARGET_NOT_BILLABLE';
      err.companyIds = rejected;
      throw err;
    }
    const jobRes = await client.query(
      `INSERT INTO billing_bulk_jobs (period_start, period_end, total_count, created_by)
       VALUES ($1::date, $2::date, $3, $4::uuid) RETURNING id`,
      [periodStart, periodEnd, items.length, createdBy],
    );
    jobId = String(jobRes.rows[0].id);
    for (const it of items) {
      await client.query(
        `INSERT INTO billing_bulk_job_items (job_id, company_id, scope) VALUES ($1::uuid, $2::uuid, $3)`,
        [jobId, it.companyId, it.scope],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* 응답이 사실을 전달한다 */ }
    throw e;
  } finally {
    client.release();
  }

  // 비동기 실행 — HTTP 응답을 붙잡지 않는다. 실패는 item·job 행에 남는다.
  setImmediate(() => {
    runBulkJob(jobId, periodStart, periodEnd, createdBy).catch((e) => {
      console.error(`[일괄발급][job실패] job=${jobId}:`, e?.message || e);
    });
  });

  return { jobId };
}

/** 순차 실행 본체. item마다 성패를 그 자리에서 기록한다 — 프로세스가 죽어도 진행분은 남는다. */
async function runBulkJob(jobId: string, periodStart: string, periodEnd: string, createdBy: string | null): Promise<void> {
  const itemsRes = await pool.query(
    `SELECT i.id, i.company_id, i.scope, c.company_name
       FROM billing_bulk_job_items i JOIN companies c ON c.id = i.company_id
      WHERE i.job_id = $1::uuid AND i.status = 'pending'
      ORDER BY c.company_name ASC`,
    [jobId],
  );

  for (const item of itemsRes.rows as any[]) {
    // ★ Codex 2R 수용 — sweep(2h 초과 자동 정리)이 이 job을 취소했으면 즉시 멈춘다.
    //   확인 없이 계속 돌면 취소된 job이 발행을 이어가고 마지막에 done을 덮어쓴다.
    const alive = await pool.query(`SELECT status FROM billing_bulk_jobs WHERE id = $1::uuid`, [jobId]);
    if (String(alive.rows[0]?.status) !== 'running') {
      console.log(`[일괄발급] job=${jobId} 상태=${alive.rows[0]?.status || '없음'} — 러너 중단(외부 취소·정리 감지)`);
      return;
    }
    await pool.query(
      `UPDATE billing_bulk_job_items SET status = 'running', started_at = NOW() WHERE id = $1::uuid`,
      [item.id],
    );
    try {
      // ★ 2026-07-29 발행 직전 재판정. job은 순차라 마지막 회사는 수십 분 뒤에 발행된다 —
      //   그 사이 수동 정산 회사로 바뀌었을 수 있다(`manual_billing`은 발급 코어가 보지 않는 축이다).
      //   **잠금은 걸지 않는다.** 수동완료·중복 발행의 상호배제는 issueBilling이 회사 잠금 안에서 하고,
      //   여기서 또 잠그면 축만 늘고 창은 안 닫힌다. 실패 기록은 아래 catch가 그대로 한다.
      const stillBillable = await filterBillableCompanies([String(item.company_id)], periodStart, periodEnd);
      if (!stillBillable.has(String(item.company_id))) {
        throw new Error('발급 대상에서 제외됨 — 대기 중 수동 정산 회사로 바뀌었거나, 수동 정산완료로 표시됐거나, 이미 발행된 회사입니다.');
      }
      const result = await issueBilling({
        company_id: String(item.company_id),
        billing_start: periodStart,
        billing_end: periodEnd,
        scope: String(item.scope),
        adminId: createdBy,
      });

      // ★ Codex 1R HIGH 수용 — 발행은 이미 COMMIT됐다. 이 아래(메일·컨펌)가 어떤 이유로 죽어도
      //   item은 success다. failed로 적으면 "발행 실패"로 보이는데 재시도는 기간 중복으로 막혀
      //   운영자가 길을 잃는다. 메일 단계 실패는 note로 드러낸다.
      let note = `발행 ${result?.sheet_count || 0}장`;
      try {
        const conf = await createAndSendConfirmations({
          companyId: String(item.company_id),
          companyName: String(item.company_name || ''),
          billingStart: periodStart,
          billingEnd: periodEnd,
          sheets: (result?.sheets || []).map((s: any) => ({
            id: String(s.id), scope: String(s.scope), user_id: s.user_id ? String(s.user_id) : null,
            total_amount: s.total_amount,
          })),
        });
        note +=
          ` · 메일 ${conf.sent}건` +
          (conf.skippedNoEmail > 0 ? ` · 이메일 미등록 ${conf.skippedNoEmail}장` : '') +
          (conf.mailFailed > 0 ? ` · 메일실패 ${conf.mailFailed}건` : '') +
          // ★ 2026-07-28 두 축을 나눠 적는다. 뭉치면 일시적 디스크 장애에도 멀쩡한 묶음을 지우고 재발행하게 된다.
          // ★ 2026-07-28 복구 경로가 생겼다 — 발행은 두고 컨펌 단계만 다시 태우는 [메일 재시도](정산 목록).
          //   일괄발급 재실행은 여전히 기간 중복에 막히므로 그쪽을 안내하지 않는다.
          (conf.mismatchBlocked > 0 ? ` · ⛔ 금액 불일치 ${conf.mismatchBlocked}장 — 금액을 정정한 뒤 정산 목록에서 [메일 재시도]를 눌러 주세요` : '') +
          (conf.renderFailed > 0 ? ` · ⛔ PDF 생성 장애 ${conf.renderFailed}장 — 금액은 정상입니다. 장애 해소 후 정산 목록에서 [메일 재시도]를 눌러 주세요` : '') +
          (conf.manualWait > 0 ? ` · 계산서 날짜 직접선택 대기 ${conf.manualWait}건` : '');
      } catch (mailPhaseErr: any) {
        note += ` · 메일 단계 실패(발행은 완료): ${String(mailPhaseErr?.message || mailPhaseErr).slice(0, 300)}`;
        console.error(`[일괄발급][메일단계실패] company=${item.company_id}:`, mailPhaseErr?.message || mailPhaseErr);
      }

      await pool.query(
        `UPDATE billing_bulk_job_items
            SET status = 'success', billing_batch_id = $2::uuid, error = $3, finished_at = NOW()
          WHERE id = $1::uuid`,
        [item.id, result?.batch_id || null, note],
      );
      await pool.query(`UPDATE billing_bulk_jobs SET done_count = done_count + 1 WHERE id = $1::uuid`, [jobId]);
    } catch (e: any) {
      const msg = e instanceof BillingIssueError
        ? String(e.body?.error || e.message)
        : String(e?.message || e);
      await pool.query(
        `UPDATE billing_bulk_job_items SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1::uuid`,
        [item.id, msg.slice(0, 2000)],
      );
      await pool.query(`UPDATE billing_bulk_jobs SET failed_count = failed_count + 1 WHERE id = $1::uuid`, [jobId]);
    }
  }

  // 종료 기록은 **아직 running인 경우에만** — sweep이 먼저 cancelled를 찍었으면 덮지 않는다.
  await pool.query(
    `UPDATE billing_bulk_jobs SET status = 'done', finished_at = NOW() WHERE id = $1::uuid AND status = 'running'`,
    [jobId],
  );
}

/** 진행률 폴링 응답 — job 헤더 + item 목록(회사명 포함). */
export async function getBulkJob(jobId: string): Promise<any> {
  const jobRes = await pool.query(`SELECT * FROM billing_bulk_jobs WHERE id = $1::uuid`, [jobId]);
  if (jobRes.rows.length === 0) return null;
  const itemsRes = await pool.query(
    `SELECT i.id, i.company_id, c.company_name, i.scope, i.status, i.error, i.billing_batch_id,
            i.started_at, i.finished_at
       FROM billing_bulk_job_items i JOIN companies c ON c.id = i.company_id
      WHERE i.job_id = $1::uuid
      ORDER BY c.company_name ASC`,
    [jobId],
  );
  return { job: jobRes.rows[0], items: itemsRes.rows };
}
