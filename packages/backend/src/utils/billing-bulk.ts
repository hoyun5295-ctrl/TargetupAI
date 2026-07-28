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
}

/** 후불이면서 해당 기간과 겹치는 발행이 없는 회사 목록 (일괄발급 화면 상단 리스트). */
export async function listUnbilledPostpaid(periodStart: string, periodEnd: string): Promise<UnbilledCompanyRow[]> {
  const r = await pool.query(
    // ★ Codex 1R 수용 — 계정별(by_user) 회사는 계정 담당자 이메일 누락 수를 함께 내려
    //   담는 시점에 "계정 메일 N건 미등록"을 보여준다(회사 레벨 이메일만 보면 사각).
    `SELECT c.id, c.company_name,
            COALESCE(s.issue_scope, 'combined')        AS issue_scope,
            COALESCE(s.taxbill_day_policy, 'last_day') AS taxbill_day_policy,
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
        AND NOT EXISTS (
          SELECT 1 FROM billings b
           WHERE b.company_id = c.id
             AND b.billing_start <= $2::date AND b.billing_end >= $1::date
        )
      ORDER BY c.company_name ASC`,
    [periodStart, periodEnd],
  );
  return r.rows as UnbilledCompanyRow[];
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
