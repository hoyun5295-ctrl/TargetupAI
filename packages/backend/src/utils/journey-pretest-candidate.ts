/**
 * 여정 보내기 전 재작성 후보(★ 2026-11-01 여정 재발 방지 B1-4 · 설계서 docs/2026-11-01-journey-recurrence-prevention-design.md §2 B1-4 · §4 DDL-D)
 *
 * 확정 차단(blocked)을 본 판(snapshot)마다 재작성은 **한 번**이다(PK = snapshot_id · regen 상한 1).
 *   claim = 사람 편집과 같은 journeys 행 잠금 아래에서 그 칸의 최신 판이 검사한 판과 같을 때만(다르면 AI 호출 전에 끝 · 차감 0).
 *   행을 얻은 손만 AI 1회 · 차감 키 고정(journey-pretest-regen:회사:판) · 정산 직전에 「아직 내 후보인가」를 다시 읽는다.
 *   저장 = generating + 내 claim_token 일 때만 testing(늦게 돌아온 옛 손의 저장은 0행).
 * 다음 회차는 원문을 다시 보지 않고 후보 검사를 이어 본다(pending = 보류 · pass = 안내 뒤 반영 · blocked = 정지).
 * generating 이 10분을 넘으면 failed(새 유료 재작성 없음) → 그 판 = 여정 정지 + 안내 · 실제 차감이 있으면 크레딧 환불(7일 동안 매 회차 대조).
 * 표가 없으면(DDL 전) 후보 0 → 확정 차단에서 재작성 없이 여정 정지(차감 0 · 지금보다 보수적).
 */
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../config/database';
import { chargedAmountByKey, refundCredit } from './ai-credit';
import { alertPassFailures, type PassFailure } from './system-alert';

export const CANDIDATE_GENERATING_TTL_MINUTES = 10;
export const CANDIDATE_REFUND_WINDOW_DAYS = 7;
const LOG = '[journey-pretest-candidate]';

export type CandidateStatus = 'generating' | 'testing' | 'passed' | 'blocked' | 'failed';
export interface PretestCandidate {
  snapshotId: string;
  body: string | null;
  subject: string | null;
  status: CandidateStatus;
  claimToken: string | null;
  stale: boolean;
}

let _ready = false;
let _absentUntil = 0;
export async function candidatesReady(): Promise<boolean> {
  if (_ready) return true;
  if (Date.now() < _absentUntil) return false;
  const r = await query(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'journey_pretest_candidates'`);
  _ready = Number(r.rows[0]?.n || 0) === 1;
  if (!_ready) _absentUntil = Date.now() + 5 * 60_000;
  return _ready;
}
/** 시험 전용 */
export function resetCandidatesReady(value?: boolean): void {
  _ready = value === true;
  _absentUntil = value === false ? Date.now() + 5 * 60_000 : 0;
}

/** 재작성 차감 멱등 키(고정 · 판마다 하나) — 만료 환불이 이 키로 실제 차감액을 읽는다 */
export function regenChargeKey(companyId: string, snapshotId: string): string {
  return `journey-pretest-regen:${companyId}:${snapshotId}`;
}

export async function readCandidate(snapshotId: string): Promise<PretestCandidate | null> {
  const r = await query(
    `SELECT snapshot_id, body, subject, status, claim_token,
            (status = 'generating' AND claimed_at < NOW() - INTERVAL '${CANDIDATE_GENERATING_TTL_MINUTES} minutes') AS stale
       FROM journey_pretest_candidates WHERE snapshot_id = $1::uuid`,
    [snapshotId],
  );
  const x = r.rows[0];
  return x ? {
    snapshotId: String(x.snapshot_id), body: x.body ?? null, subject: x.subject ?? null,
    status: x.status as CandidateStatus, claimToken: x.claim_token ? String(x.claim_token) : null, stale: x.stale === true,
  } : null;
}

/**
 * claim — journeys 행 잠금 아래에서 최신 판 = 검사한 판일 때만 후보 행을 만든다.
 *   'stale' = 그사이 사람이 새 판을 커밋(아무것도 안 함 · 차감 0) · 'taken' = 이 판의 후보가 이미 있다(재작성 상한 1) · 토큰 = 내 claim
 */
export async function claimCandidate(journeyId: string, stepId: string, snapshotId: string): Promise<{ token: string } | 'stale' | 'taken'> {
  return withTransaction(async (run) => {
    const lock = await run(`SELECT id FROM journeys WHERE id = $1::uuid FOR UPDATE`, [journeyId]);
    if (lock.rows.length === 0) return 'stale' as const;
    const latest = await run(
      `SELECT id FROM journey_step_snapshots WHERE step_id = $1::uuid AND journey_id = $2::uuid ORDER BY created_at DESC LIMIT 1`,
      [stepId, journeyId],
    );
    if (String(latest.rows[0]?.id || '') !== snapshotId) return 'stale' as const;
    const token = randomUUID();
    const ins = await run(
      `INSERT INTO journey_pretest_candidates (snapshot_id, step_id, status, claim_token, claimed_at, regen_count)
       VALUES ($1::uuid, $2::uuid, 'generating', $3::uuid, NOW(), 1)
       ON CONFLICT (snapshot_id) DO NOTHING
       RETURNING snapshot_id`,
      [snapshotId, stepId, token],
    );
    return ins.rows.length > 0 ? { token } : ('taken' as const);
  });
}

/** 정산 직전 확인 — 아직 generating 이고 claim 이 내 것인가(아니면 쓸 결과가 아니다 = 차감 0) */
export async function candidateStillMine(snapshotId: string, token: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM journey_pretest_candidates WHERE snapshot_id = $1::uuid AND status = 'generating' AND claim_token = $2::uuid`,
    [snapshotId, token],
  );
  return r.rows.length > 0;
}

/** 재작성 글 저장 → testing(generating + 내 토큰일 때만 · 늦은 옛 손 = 0행) */
export async function saveCandidate(snapshotId: string, token: string, body: string, subject: string | null): Promise<boolean> {
  const r = await query(
    `UPDATE journey_pretest_candidates SET body = $3, subject = $4, status = 'testing', updated_at = NOW()
      WHERE snapshot_id = $1::uuid AND status = 'generating' AND claim_token = $2::uuid`,
    [snapshotId, token, body, subject],
  );
  return (r.rowCount ?? 0) > 0;
}

/** 후보 통과 반영 — 판 확인 쓰기(recordIfCurrent) 트랜잭션 안에서 부른다 · testing 일 때만 passed(아니면 거짓 = 그 트랜잭션은 아무것도 안 쓴다) */
export async function markCandidatePassedInTx(run: (sql: string, params?: any[]) => Promise<{ rows: any[] }>, snapshotId: string): Promise<boolean> {
  const r = await run(
    `UPDATE journey_pretest_candidates SET status = 'passed', updated_at = NOW()
      WHERE snapshot_id = $1::uuid AND status = 'testing' RETURNING snapshot_id`,
    [snapshotId],
  );
  return r.rows.length > 0;
}

/** 상태 전이(조건부 · 쓴 행이 있으면 참) */
export async function moveCandidate(snapshotId: string, from: readonly CandidateStatus[], to: CandidateStatus): Promise<boolean> {
  const r = await query(
    `UPDATE journey_pretest_candidates SET status = $3, updated_at = NOW()
      WHERE snapshot_id = $1::uuid AND status = ANY($2::text[])`,
    [snapshotId, [...from], to],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * 회차마다(스캔 시작) — ① 만드는 중 10분 넘은 후보 = failed(새 유료 재작성 없음 · 정지는 그 묶음 처리가 한다) ·
 *   검사 중 7일 넘은 후보(사람이 새 판을 만들어 버려진 옛 판 · 오래 멈춘 여정) = failed(쓰지 못한 재작성 = 아래 환불 · R6 닫히는 상태)
 *   ② failed 후보의 실제 차감 = 크레딧 환불(고정 키 · 멱등 · 만료 뒤 7일 동안 매 회차 대조 · 늦은 차감도 잡는다).
 */
export async function sweepPretestCandidates(): Promise<{ expired: number; refunded: number }> {
  const out = { expired: 0, refunded: 0 };
  if (!(await candidatesReady())) return out;
  const exp = await query(
    `UPDATE journey_pretest_candidates SET status = 'failed', updated_at = NOW()
      WHERE (status = 'generating' AND claimed_at < NOW() - INTERVAL '${CANDIDATE_GENERATING_TTL_MINUTES} minutes')
         OR (status = 'testing' AND updated_at < NOW() - INTERVAL '${CANDIDATE_REFUND_WINDOW_DAYS} days')
      RETURNING snapshot_id`,
  );
  out.expired = exp.rows.length;
  const failed = await query(
    `SELECT c.snapshot_id, s.company_id
       FROM journey_pretest_candidates c JOIN journey_step_snapshots s ON s.id = c.snapshot_id
      WHERE c.status = 'failed' AND c.updated_at > NOW() - INTERVAL '${CANDIDATE_REFUND_WINDOW_DAYS} days'`,
  );
  const failures: PassFailure[] = [];
  for (const row of failed.rows as any[]) {
    const companyId = String(row.company_id);
    const snapshotId = String(row.snapshot_id);
    const key = regenChargeKey(companyId, snapshotId);
    try {
      const amount = await chargedAmountByKey(companyId, key);
      if (!amount || amount <= 0) continue;
      const rr = await refundCredit({
        companyId, amount, source: 'journey-ai-refine',
        reason: '여정 발송 전 자동 재작성이 끝나지 않아 쓰지 못함',
        idempotencyKey: `refund:${key}`, originalIdempotencyKey: key,
      });
      if (rr.refunded) out.refunded++;
    } catch (e: any) {
      console.warn(`${LOG} 재작성 환불 대조 실패 snapshot=${snapshotId}:`, e?.message || e);
      failures.push({ companyId, key: snapshotId, error: String(e?.message || e).slice(0, 160) });
    }
  }
  // ★ 2026-11-02 설계 §17-4 C1 — 한 주기 1통(옛: 반복문 catch 에서 판마다 1통 = 원인 하나에 N통 · 계약 ⑥ 이 타이머 없는 파일이라 못 봤다)
  if (failures.length > 0) {
    await alertPassFailures({
      pass: 'journey-pretest-regen-refund',
      title: `여정 발송 전 자동 재작성 차감을 되돌리지 못한 판이 있습니다(다음 회차 다시 · ${CANDIDATE_REFUND_WINDOW_DAYS}일 동안).`,
      action: `서버 로그 ${LOG} 재작성 환불 대조 실패 줄의 판(snapshot)으로 확인해 주세요.`,
      failures, total: failed.rows.length,
    }).catch(() => undefined);
  }
  if (out.expired || out.refunded) console.log(`${LOG} 만료 ${out.expired} · 환불 ${out.refunded}`);
  return out;
}
