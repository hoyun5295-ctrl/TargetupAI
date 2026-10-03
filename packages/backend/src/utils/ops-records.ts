/**
 * ops-records.ts — 운영 기록 대장 컨트롤타워 (★2026-10-03 전송자격인증 3.1 ④ · 3.3 · 4.3)
 *
 * 무엇을 남기나
 *   로그 점검(4.3 월 1회 점검 · 결과 기록 · 이상징후 후속조치) · 방화벽 정책 변경(3.1 ④) · 접근권한 점검(3.3)을
 *   **시스템 기록으로** 남긴다. 문서(docx)로만 두면 언제 썼는지를 증명할 수 없다.
 *   한줄로와 비토 게이트웨이(발송 엔진) 양쪽의 기록을 여기 한 곳에 남긴다(영업 요청: 공통 사항은 공통으로).
 *
 * ⛔ 날짜를 지어내지 못하게 한다 (Harold 1003 「날짜는 실제대로」)
 *   - **작성 시각은 서버가 정한다**(감사 기록 행의 시각). 화면이 보낸 시각을 작성 시각으로 쓰지 않는다.
 *   - 점검 대상 월은 고를 수 있지만 **이번 달보다 뒤는 안 된다**. 지난 달을 오늘 점검하면 「대상 9월 · 작성 10월 3일」로 남는다.
 *   - 방화벽 변경 일시는 실제로 바뀐 때를 적되 **미래는 안 되고 근거가 필수**다. 작성 시각은 따로 남는다.
 *   - **작성한 기록은 고치지 않는다.** 정정은 새 기록이 옛 기록을 가리키게(`supersedes`) 한다.
 *
 * ⛔ 상호 확인
 *   작성자와 다른 관리자가 확인해야 「확인 완료」가 된다. 같은 사람의 확인은 거절한다. 확인은 기록마다 한 번이다.
 *
 * 저장 = 기존 `audit_logs`(DDL 0). 작성 `ops_record_created` · 확인 `ops_record_confirmed` · 대상 = `ops_record` + 기록 id.
 *   ⛔ 실패를 삼키지 않는다 — `recordAuditLog`(실패 흡수)를 쓰지 않고 직접 넣는다. 대장 작성이 조용히 사라지면 기록이 아니다.
 */
import crypto from 'crypto';
import pool, { query } from '../config/database';

export type OpsRecordKind = 'log_review' | 'firewall_change' | 'access_review';
export type OpsSystem = 'hanjul' | 'gateway' | 'common';

export const OPS_RECORD_KINDS: OpsRecordKind[] = ['log_review', 'firewall_change', 'access_review'];
export const OPS_SYSTEMS: OpsSystem[] = ['hanjul', 'gateway', 'common'];
export const OPS_ACTION_CREATED = 'ops_record_created';
export const OPS_ACTION_CONFIRMED = 'ops_record_confirmed';
const TARGET_TYPE = 'ops_record';
/** 이 기능이 생긴 날 — 목록 조회를 이 날 이후로 좁혀 큰 감사 기록 표 전체를 훑지 않게 한다 */
export const OPS_RECORDS_SINCE = '2026-10-01T00:00:00+09:00';

const LIMITS = { title: 120, content: 4000, reason: 1000, followUp: 2000, evidence: 2000, comment: 500 };

/** 화면에 다시 보이는 월간 점검 자료의 기록 종류 — 4.3 점검 항목 */
export const LOG_REVIEW_ACTIONS = [
  'login_success', 'login_fail', 'login_blocked', 'login_session_conflict', 'login_takeover',
  'mfa_challenge', 'mfa_success', 'mfa_fail', 'mfa_locked',
  'sender_auth_challenge', 'sender_auth_success',
  'foreign_access_detected', 'foreign_access_blocked', 'machine_origin_detected', 'machine_origin_blocked',
  'account_restricted', 'company_terminated',
  'privacy_export', 'privacy_purge', 'customer_delete_all',
  'admin_role_changed', 'admin_account_created', 'admin_account_disabled',
  'user_account_created', 'mfa_phone_changed',
] as const;

export interface OpsActor { id: string; loginId: string; name: string }

export interface OpsRecordInput {
  kind: OpsRecordKind;
  system: OpsSystem;
  period?: string | null;
  occurredAt?: string | null;
  title: string;
  content: string;
  reason?: string | null;
  anomaly?: boolean | null;
  followUp?: string | null;
  evidence?: string | null;
  supersedes?: string | null;
}

export class OpsRecordError extends Error {
  constructor(public http: number, message: string) {
    super(message);
  }
}

const clean = (raw: unknown, max: number): string => String(raw ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

/** 한국 시각 기준 이번 달(YYYY-MM) */
export function currentKstMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 7);
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 기록 번호는 소문자 하나로 접는다(★Codex 1R). DB 는 대소문자를 같은 uuid 로 읽는데 잠금 키는 글자 그대로라,
 * 대문자 · 소문자로 나눠 보내면 같은 기록에 잠금이 둘 생겨 확인이 두 번 들어갔다. 잠금 · 조회 · 저장은 이 값 하나만 쓴다.
 */
function canonicalRecordId(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

/**
 * 입력 검사 — 통과하면 저장할 모양으로 돌려준다. 실패하면 OpsRecordError(400).
 * 시각 판단의 기준 `now` 는 서버 시각이다.
 */
export function validateOpsRecord(raw: any, now: Date = new Date()): OpsRecordInput {
  const kind = String(raw?.kind || '') as OpsRecordKind;
  if (!OPS_RECORD_KINDS.includes(kind)) throw new OpsRecordError(400, '기록 종류를 고르세요.');
  const system = String(raw?.system || '') as OpsSystem;
  if (!OPS_SYSTEMS.includes(system)) throw new OpsRecordError(400, '대상 시스템을 고르세요.');

  const title = clean(raw?.title, LIMITS.title);
  if (!title) throw new OpsRecordError(400, '요지를 적어 주세요.');
  const content = clean(raw?.content, LIMITS.content);
  if (!content) throw new OpsRecordError(400, kind === 'firewall_change' ? '변경 내용을 적어 주세요.' : '점검 내용을 적어 주세요.');
  const evidence = clean(raw?.evidence, LIMITS.evidence) || null;
  const supersedesRaw = clean(raw?.supersedes, 64);
  const supersedes = supersedesRaw ? canonicalRecordId(supersedesRaw) : null;
  if (supersedesRaw && !supersedes) throw new OpsRecordError(400, '정정할 기록을 찾지 못했습니다.');

  const out: OpsRecordInput = { kind, system, title, content, evidence, supersedes };

  if (kind === 'firewall_change') {
    const at = new Date(String(raw?.occurredAt || ''));
    if (Number.isNaN(at.getTime())) throw new OpsRecordError(400, '변경 일시를 넣어 주세요.');
    // ★Codex 1R — 허용치를 두지 않는다. 5분을 봐 주면 자정 직전에 「내일」 변경이 기록된다
    if (at.getTime() > now.getTime()) throw new OpsRecordError(400, '변경 일시는 지금보다 뒤일 수 없습니다.');
    if (at.getTime() < new Date('2026-01-01T00:00:00+09:00').getTime()) throw new OpsRecordError(400, '변경 일시를 확인해 주세요.');
    const reason = clean(raw?.reason, LIMITS.reason);
    if (!reason) throw new OpsRecordError(400, '변경 사유를 적어 주세요.');
    if (!evidence) throw new OpsRecordError(400, '근거(서버 명령 기록 · 원장 등)를 적어 주세요.');
    out.occurredAt = at.toISOString();
    out.reason = reason;
    return out;
  }

  const period = String(raw?.period || '').trim();
  if (!MONTH_RE.test(period)) throw new OpsRecordError(400, '점검 대상 월을 고르세요.');
  if (period > currentKstMonth(now)) throw new OpsRecordError(400, '점검 대상 월은 이번 달보다 뒤일 수 없습니다.');
  if (period < '2026-01') throw new OpsRecordError(400, '점검 대상 월을 확인해 주세요.');
  out.period = period;
  out.anomaly = raw?.anomaly === true;
  const followUp = clean(raw?.followUp, LIMITS.followUp);
  if (out.anomaly && !followUp) throw new OpsRecordError(400, '이상이 있으면 후속 조치를 적어 주세요.');
  out.followUp = followUp || null;
  // 엔진 수치는 이 화면이 직접 세지 못한다 — 어디서 본 수치인지 근거를 함께 남긴다
  if (system === 'gateway' && !evidence) throw new OpsRecordError(400, '게이트웨이 점검은 근거(조회 결과 요약)를 적어 주세요.');
  return out;
}

/** 작성자 · 확인자 — 슈퍼관리자 계정에서 읽는다(화면이 보낸 이름을 쓰지 않는다) */
export async function loadOpsActor(superAdminId: string | null | undefined): Promise<OpsActor | null> {
  if (!superAdminId) return null;
  const r = await query('SELECT id, login_id, name FROM super_admins WHERE id = $1 AND is_active = true', [superAdminId]);
  const row = r.rows[0];
  if (!row) return null;
  return { id: String(row.id), loginId: String(row.login_id), name: String(row.name || row.login_id) };
}

/**
 * 한줄로 월간 점검 자료 — 그 달(한국 시각)의 기록 종류별 건수와 로그인 실패가 몰린 계정.
 * 저장할 때 이 결과를 기록 안에 그대로 얼려 둔다(뒤에 다시 세어도 그때의 점검 근거가 바뀌지 않게).
 */
export async function buildHanjulLogReviewSummary(month: string): Promise<{
  month: string;
  counts: Record<string, number>;
  failConcentration: Array<{ loginId: string; fails: number; ips: number }>;
  generatedAt: string;
}> {
  if (!MONTH_RE.test(month)) throw new OpsRecordError(400, '점검 대상 월을 고르세요.');
  const range = `created_at >= ($1 || '-01')::date::timestamp AT TIME ZONE 'Asia/Seoul'
                 AND created_at < (($1 || '-01')::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'Asia/Seoul'`;
  const countsRes = await query(
    `SELECT action, COUNT(*)::int AS n FROM audit_logs WHERE ${range} AND action = ANY($2::text[]) GROUP BY action`,
    [month, [...LOG_REVIEW_ACTIONS]]
  );
  const counts: Record<string, number> = {};
  for (const a of LOG_REVIEW_ACTIONS) counts[a] = 0;
  for (const row of countsRes.rows) counts[String(row.action)] = Number(row.n) || 0;

  const failRes = await query(
    `SELECT details->>'loginId' AS login_id, COUNT(*)::int AS fails, COUNT(DISTINCT ip_address)::int AS ips
       FROM audit_logs
      WHERE ${range} AND action = 'login_fail'
      GROUP BY details->>'loginId'
     HAVING COUNT(*) >= 5
      ORDER BY COUNT(*) DESC
      LIMIT 10`,
    [month]
  );
  return {
    month,
    counts,
    failConcentration: failRes.rows.map((r: any) => ({ loginId: String(r.login_id ?? ''), fails: Number(r.fails), ips: Number(r.ips) })),
    generatedAt: new Date().toISOString(),
  };
}

/** 기록 작성 — 작성 시각은 서버 시각 · 실패는 그대로 던진다 */
export async function createOpsRecord(params: {
  input: OpsRecordInput;
  actor: OpsActor;
  req?: any;
}): Promise<{ id: string; createdAt: string }> {
  const { input, actor, req } = params;
  if (input.supersedes) {
    const prev = await query(
      `SELECT 1 FROM audit_logs WHERE action = $1 AND target_type = $2 AND target_id = $3::uuid AND created_at >= $4 LIMIT 1`,
      [OPS_ACTION_CREATED, TARGET_TYPE, input.supersedes, OPS_RECORDS_SINCE]
    );
    if (prev.rows.length === 0) throw new OpsRecordError(400, '정정할 기록을 찾지 못했습니다.');
  }
  // 한줄로 로그 점검은 그 달의 자료를 서버가 세어 기록 안에 얼려 둔다(화면이 보낸 수치를 쓰지 않는다)
  const summary = input.kind === 'log_review' && input.system === 'hanjul' && input.period
    ? await buildHanjulLogReviewSummary(input.period)
    : null;

  const id = crypto.randomUUID();
  const details = {
    v: 1,
    ...input,
    summary,
    recorder: { id: actor.id, loginId: actor.loginId, name: actor.name },
  };
  const r = await query(
    `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4::uuid, $5, $6, $7)
     RETURNING created_at`,
    [actor.id, OPS_ACTION_CREATED, TARGET_TYPE, id, JSON.stringify(details), req?.ip || null, req?.headers?.['user-agent'] || '']
  );
  return { id, createdAt: new Date(r.rows[0].created_at).toISOString() };
}

/**
 * 기록 확인 — 작성자가 아닌 관리자가 한 번만. 같은 기록을 두 사람이 동시에 확인해도 한 건만 남게
 * 기록 id 로 트랜잭션 잠금을 건 뒤 「이미 확인됐는가」를 보고 넣는다.
 */
export async function confirmOpsRecord(params: {
  recordId: string;
  actor: OpsActor;
  comment?: string | null;
  req?: any;
}): Promise<{ confirmedAt: string }> {
  const { actor, req } = params;
  const recordId = canonicalRecordId(params.recordId);
  if (!recordId) throw new OpsRecordError(404, '기록을 찾지 못했습니다.');
  const comment = clean(params.comment, LIMITS.comment) || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ops_record:${recordId}`]);
    const rec = await client.query(
      `SELECT user_id, details FROM audit_logs
        WHERE action = $1 AND target_type = $2 AND target_id = $3::uuid AND created_at >= $4 LIMIT 1`,
      [OPS_ACTION_CREATED, TARGET_TYPE, recordId, OPS_RECORDS_SINCE]
    );
    if (rec.rows.length === 0) throw new OpsRecordError(404, '기록을 찾지 못했습니다.');
    const recorderId = String(rec.rows[0].details?.recorder?.id || rec.rows[0].user_id || '');
    if (recorderId && recorderId === actor.id) throw new OpsRecordError(409, '작성한 사람은 확인할 수 없습니다. 다른 관리자가 확인해야 합니다.');
    const done = await client.query(
      `SELECT 1 FROM audit_logs WHERE action = $1 AND target_type = $2 AND target_id = $3::uuid AND created_at >= $4 LIMIT 1`,
      [OPS_ACTION_CONFIRMED, TARGET_TYPE, recordId, OPS_RECORDS_SINCE]
    );
    if (done.rows.length > 0) throw new OpsRecordError(409, '이미 확인된 기록입니다.');
    const ins = await client.query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4::uuid, $5, $6, $7)
       RETURNING created_at`,
      [actor.id, OPS_ACTION_CONFIRMED, TARGET_TYPE, recordId,
        JSON.stringify({ v: 1, recordId, confirmer: { id: actor.id, loginId: actor.loginId, name: actor.name }, comment }),
        req?.ip || null, req?.headers?.['user-agent'] || '']
    );
    await client.query('COMMIT');
    return { confirmedAt: new Date(ins.rows[0].created_at).toISOString() };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 아래에서 원래 오류를 던진다 */ }
    throw err;
  } finally {
    client.release();
  }
}

export interface OpsRecordRow {
  id: string;
  createdAt: string;
  kind: OpsRecordKind;
  system: OpsSystem;
  period: string | null;
  occurredAt: string | null;
  title: string;
  content: string;
  reason: string | null;
  anomaly: boolean | null;
  followUp: string | null;
  evidence: string | null;
  supersedes: string | null;
  summary: any;
  recorder: { loginId: string; name: string } | null;
  confirmedAt: string | null;
  confirmer: { loginId: string; name: string } | null;
  confirmComment: string | null;
}

/** 대장 목록 — 최근 작성순 */
export async function listOpsRecords(filter: { kind?: string | null; system?: string | null; limit?: number }): Promise<OpsRecordRow[]> {
  const kind = filter.kind && OPS_RECORD_KINDS.includes(filter.kind as OpsRecordKind) ? filter.kind : null;
  const system = filter.system && OPS_SYSTEMS.includes(filter.system as OpsSystem) ? filter.system : null;
  const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 300);
  const r = await query(
    `SELECT c.target_id AS id, c.created_at, c.details,
            f.created_at AS confirmed_at, f.details AS confirm_details
       FROM audit_logs c
       LEFT JOIN LATERAL (
         SELECT x.created_at, x.details FROM audit_logs x
          WHERE x.action = $2 AND x.target_type = $3 AND x.target_id = c.target_id AND x.created_at >= c.created_at
          ORDER BY x.created_at ASC LIMIT 1
       ) f ON true
      WHERE c.action = $1 AND c.target_type = $3 AND c.created_at >= $4
        AND ($5::text IS NULL OR c.details->>'kind' = $5)
        AND ($6::text IS NULL OR c.details->>'system' = $6)
      ORDER BY c.created_at DESC
      LIMIT $7`,
    [OPS_ACTION_CREATED, OPS_ACTION_CONFIRMED, TARGET_TYPE, OPS_RECORDS_SINCE, kind, system, limit]
  );
  return r.rows.map((row: any) => {
    const d = row.details || {};
    const cd = row.confirm_details || null;
    return {
      id: String(row.id),
      createdAt: new Date(row.created_at).toISOString(),
      kind: d.kind,
      system: d.system,
      period: d.period ?? null,
      occurredAt: d.occurredAt ?? null,
      title: String(d.title || ''),
      content: String(d.content || ''),
      reason: d.reason ?? null,
      anomaly: typeof d.anomaly === 'boolean' ? d.anomaly : null,
      followUp: d.followUp ?? null,
      evidence: d.evidence ?? null,
      supersedes: d.supersedes ?? null,
      summary: d.summary ?? null,
      recorder: d.recorder ? { loginId: String(d.recorder.loginId || ''), name: String(d.recorder.name || '') } : null,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
      confirmer: cd?.confirmer ? { loginId: String(cd.confirmer.loginId || ''), name: String(cd.confirmer.name || '') } : null,
      confirmComment: cd?.comment ?? null,
    };
  });
}
