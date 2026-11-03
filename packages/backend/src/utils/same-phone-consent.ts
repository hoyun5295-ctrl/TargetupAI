/**
 * same-phone-consent.ts — 같은 번호 여러 원본 행의 수신동의 접기 · 판정 컨트롤타워(★ 2026-11-04)
 *
 * 설계서 = docs/2026-11-03-sync-duplicate-phone-consent-design.md(§2 P1 · §3-0) · 뿌리 = 같은 번호의 여러 원본 행을
 * 시각 근거 없이 한 고객으로 접을 때 동의가 순서로 정해진다(싱크 요청 안 첫 행만 · 요청 사이 뒤 값이 덮음 · 업로드 묶음 경계).
 * 규칙(P1 거부 우선): 거부가 하나라도 있으면 거부 · 아니면 수신이 하나라도 있으면 수신 · 아니면 이미 있는 고객 = 바꾸지 않음 ·
 * 신규 = 모름이 하나라도 있으면 미동의 · 전부 없음이면 지금 기본값(동의 = 공용 기본값 백필).
 * ⛔ 같은 번호를 한 행으로 접는 입구(싱크 · 업로드 · 일괄 추가)는 이 파일의 판정만 쓴다(계약 시험 C1).
 */
import { normalizeByFieldKey, isUnrecognizedSmsOptIn, normalizePhone, normalizeSmsOptIn, isUuid } from './normalize';
import { isMissingSchemaError, migrationPendingBody } from './db-errors';
import { withTransaction, type TxRun } from '../config/database';
import { reconcileSyncUnsubscribesFor } from './sync-unsubscribes';
import { ensureSystemSyncUser } from './system-sync-user';
import { recordUnsubscribeDeleted } from './change-audit';
import { sendSystemAlert } from './system-alert';

/** 원본 행 하나의 동의 표 — 수신 · 거부(미수신 · 탈퇴) · 모름(값은 있는데 알아볼 수 없음) · 없음(빈칸 · 매핑 없음) */
export type ConsentVote = 'yes' | 'no' | 'unknown' | 'none';

/** 같은 번호 표 묶음 · rows = 그 번호의 원본 행 수(1 = 지금 동작 그대로 두는 기준 · 설계서 §2 P5) */
export interface ConsentFold { anyFalse: boolean; anyTrue: boolean; anyUnknown: boolean; rows: number }

/** 정규화된 동의 값(boolean · null) + 「알아볼 수 없는 표기였다」 표시 → 표 하나 */
export function consentVote(value: boolean | null | undefined, unknown: boolean): ConsentVote {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return unknown ? 'unknown' : 'none';
}

export function foldVotes(votes: Iterable<ConsentVote>): ConsentFold {
  const f: ConsentFold = { anyFalse: false, anyTrue: false, anyUnknown: false, rows: 0 };
  for (const v of votes) addVote(f, v);
  return f;
}

function addVote(f: ConsentFold, v: ConsentVote): void {
  f.rows += 1;
  if (v === 'no') f.anyFalse = true;
  else if (v === 'yes') f.anyTrue = true;
  else if (v === 'unknown') f.anyUnknown = true;
}

/** 이미 있는 고객 — null = 바꾸지 않음(업서트 COALESCE 가 옛 값을 지킨다) */
export function decideForExisting(f: ConsentFold): boolean | null {
  if (f.anyFalse) return false;
  if (f.anyTrue) return true;
  return null;
}

/** 신규 고객 — null = 지금 기본값(동의 · 공용 기본값 백필이 채운다) */
export function decideForNew(f: ConsentFold): boolean | null {
  if (f.anyFalse) return false;
  if (f.anyTrue) return true;
  if (f.anyUnknown) return false;
  return null;
}

/**
 * 층 1 — 같은 번호를 한 행으로 접는 입구가 남긴 행에 줄 동의(설계서 §3-1).
 * 한 행뿐인 번호 = null(지금 동작 그대로 · 행 값 · 모름 표시를 손대지 않는다 · P5).
 * 여러 행 = { value: 거부 우선 값(이미 있는 고객 기준 · null = 바꾸지 않음), unknown: 값이 안 정해졌는데 모름이 있음(신규 = 미동의) }.
 */
export function keptRowConsent(f: ConsentFold | undefined): { value: boolean | null; unknown: boolean } | null {
  if (!f || f.rows < 2) return null;
  const value = decideForExisting(f);
  return { value, unknown: value === null && f.anyUnknown };
}

/**
 * 업로드 파일 전체를 묶음으로 나누기 전에 미리 묶는다(설계서 §3-1 · 2,000행 묶음 경계와 무관하게 파일 하나 = 한 입력).
 * 행 읽기 = 업로드 행 만들기(`routes/upload.ts` 묶음 안 `headers.forEach`)와 같은 규칙: 매핑된 헤더만 · 빈 값(undefined · null · '') 건너뜀 ·
 * 같은 필드 키가 여러 헤더면 뒤 헤더 · 번호 = `normalizeByFieldKey('phone')` · 동의 = 정규화 전 원문으로 모름 판정(`isUnrecognizedSmsOptIn`) 뒤 `normalizeByFieldKey('sms_opt_in')`.
 */
export function foldMappedRowsByPhone(rows: any[][], headers: string[], mapping: Record<string, string>): Map<string, ConsentFold> {
  const phoneIdx: number[] = [];
  const consentIdx: number[] = [];
  headers.forEach((h, i) => {
    if (mapping[h] === 'phone') phoneIdx.push(i);
    else if (mapping[h] === 'sms_opt_in') consentIdx.push(i);
  });
  const lastFilled = (row: any[], idx: number[]) => {
    let v: any;
    for (const i of idx) if (row[i] !== undefined && row[i] !== null && row[i] !== '') v = row[i];
    return v;
  };
  return foldByPhone(
    rows,
    (row) => {
      const raw = lastFilled(row, phoneIdx);
      return raw === undefined ? null : normalizeByFieldKey('phone', raw);
    },
    (row) => {
      const raw = lastFilled(row, consentIdx);
      if (raw === undefined) return 'none';
      return consentVote(normalizeByFieldKey('sms_opt_in', raw), isUnrecognizedSmsOptIn(raw));
    },
  );
}

/** 세대 공개 2단계 · 번호 하나의 입력(설계서 §3-2 ④) */
export interface PublishInput {
  /** 고객 행 수신동의(NULL = 대기 → 신규 판정) */
  current: boolean | null;
  /** 폐기 중 아닌 에이전트마다 최신 확정 패스 모은 행의 「또는」 · null = 어느 요약에도 없음(원본에서 사라짐) */
  fold: ConsentFold | null;
  refusalSeenAt: Date | null;
  raiseSince: Date | null;
  /** 폐기 중 아닌 에이전트마다 최신 확정 패스 시작 */
  starts: Date[];
  multi: boolean;
}
/** target = 고객 행에 쓸 값(null = 그대로) · raiseSince = 'keep'(손대지 않음) · 'clear'(지움) · Date(처음 미룸 = 이 값으로 · 이미 있으면 그대로) */
export interface PublishDecision { target: boolean | null; raiseSince: 'keep' | 'clear' | Date }

/**
 * 세대 공개 2단계 · 번호 하나의 판정 — 낮추기는 바로 · 올리기(미동의 · 대기 → 동의)는 규칙 R* 를 지난 것만(설계서 §3-2 ④).
 * R* = 모든 에이전트 최신 확정 패스 시작 ≥ T(P) = max(마지막 거부 관측, 처음 미룬 시각) ·
 *      처음 미룸 = 에이전트 둘 이상이고 미룬 시각이 비었는데 확정 집합에 가장 늦은 시작(M)보다 먼저 시작한 패스가 있으면 → raise_since = M(Codex 8R).
 */
export function decidePublish(i: PublishInput): PublishDecision {
  if (!i.fold || i.fold.rows === 0) return { target: null, raiseSince: 'clear' };
  const d = i.current === null ? (decideForNew(i.fold) ?? true) : decideForExisting(i.fold);
  if (d === null) return { target: null, raiseSince: 'clear' };
  if (d === false) return { target: i.current === false ? null : false, raiseSince: 'clear' };
  if (i.current === true) return { target: null, raiseSince: 'clear' };
  if (i.starts.length === 0) return { target: null, raiseSince: 'keep' };
  const ms = i.starts.map((s) => s.getTime());
  const min = Math.min(...ms);
  const max = Math.max(...ms);
  if (i.raiseSince === null && i.multi && min < max) return { target: null, raiseSince: new Date(max) };
  const bounds = [i.refusalSeenAt, i.raiseSince].filter((x): x is Date => x !== null).map((x) => x.getTime());
  if (bounds.length > 0 && min < Math.max(...bounds)) return { target: null, raiseSince: 'keep' };
  return { target: true, raiseSince: 'clear' };
}

/** 한 입력(싱크 요청 · 업로드 파일 전체 · 일괄 추가 요청) 안 같은 번호의 표 지도 · 번호가 비면 넣지 않는다 */
export function foldByPhone<T>(rows: Iterable<T>, phoneOf: (row: T) => string | null | undefined, voteOf: (row: T) => ConsentVote): Map<string, ConsentFold> {
  const m = new Map<string, ConsentFold>();
  for (const row of rows) {
    const phone = phoneOf(row);
    if (!phone) continue;
    let f = m.get(phone);
    if (!f) { f = { anyFalse: false, anyTrue: false, anyUnknown: false, rows: 0 }; m.set(phone, f); }
    addVote(f, voteOf(row));
  }
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════
// 층 2 — 세대(싱크 에이전트 1.7.6 · 설계서 §3-2) · 표 = sync_consent_passes · sync_consent_stage · sync_consent_marks(C101-DDL-1)
// ⛔ 이 세 표는 이 파일만 읽고 쓴다(계약 시험 C2) · 모든 함수는 회사 잠금 아래에서 상태를 보고 바꾼다
// ═══════════════════════════════════════════════════════════════════════════

export type ConsentPassErrorCode = 'NOT_AGENT' | 'NOT_FOUND' | 'BAD_STATE' | 'RETIRING' | 'SUPERSEDED' | 'BATCH_MISMATCH' | 'TOO_LARGE' | 'MIXED_AGENT';
export class ConsentPassError extends Error {
  constructor(public readonly code: ConsentPassErrorCode, public readonly http: number) { super(code); }
}

/** 한 요청 = 공개 · 폐기 번호 묶음 하나 */
export const CONSENT_PUBLISH_CHUNK = 5000;
/** 원장 패스 한 요청 최대 행 */
export const CONSENT_STAGE_MAX = 10000;

/** 회사 하나 = 트랜잭션 잠금 하나(번호마다 잠그지 않는다 · 커밋 · 되돌림에 풀린다) */
export async function lockCompanySyncConsent(run: TxRun, companyId: string): Promise<void> {
  await run(`SELECT pg_advisory_xact_lock(hashtext('sync-consent:' || $1::text))`, [companyId]);
}

async function agentRetiring(run: TxRun, agentId: string): Promise<boolean> {
  const r = await run(`SELECT 1 FROM sync_consent_passes WHERE agent_id = $1::uuid AND state = 'retiring' LIMIT 1`, [agentId]);
  return r.rows.length > 0;
}

interface PassRow { state: string; started_at: Date; load_batches: number[]; prev_pass_id: string | null; publish_cursor: string | null }

async function passOf(run: TxRun, companyId: string, agentId: string, passId: string): Promise<PassRow> {
  const r = await run(
    `SELECT state, started_at, load_batches, prev_pass_id, publish_cursor FROM sync_consent_passes
      WHERE pass_id = $1::uuid AND agent_id = $2::uuid AND company_id = $3::uuid`,
    [passId, agentId, companyId],
  );
  if (r.rows.length === 0) throw new ConsentPassError('NOT_FOUND', 404);
  return r.rows[0];
}

/** 그 에이전트의 최신 확정 패스(applying · done 중 시작이 가장 늦은 것) */
async function latestConfirmedPass(run: TxRun, agentId: string): Promise<string | null> {
  const r = await run(
    `SELECT pass_id FROM sync_consent_passes WHERE agent_id = $1::uuid AND state IN ('applying','done')
      ORDER BY started_at DESC, pass_id DESC LIMIT 1`,
    [agentId],
  );
  return r.rows[0]?.pass_id ?? null;
}

/** 모은 행에 표 묶음을 「또는」으로 더한다 · lowerOnly = 낮추는 근거(거부 · 모름)만(고객 적재 근거) */
async function addStage(run: TxRun, passId: string, folds: Map<string, ConsentFold>, lowerOnly: boolean): Promise<void> {
  const phones: string[] = []; const f: boolean[] = []; const t: boolean[] = []; const u: boolean[] = [];
  for (const [phone, x] of folds) {
    if (lowerOnly && !x.anyFalse && !x.anyUnknown) continue;
    phones.push(phone); f.push(x.anyFalse); t.push(lowerOnly ? false : x.anyTrue); u.push(x.anyUnknown);
  }
  if (phones.length === 0) return;
  await run(
    `INSERT INTO sync_consent_stage (pass_id, phone, any_false, any_true, any_unknown)
     SELECT $1::uuid, v.phone, v.f, v.t, v.u FROM unnest($2::text[], $3::bool[], $4::bool[], $5::bool[]) AS v(phone, f, t, u)
     ON CONFLICT (pass_id, phone) DO UPDATE SET
       any_false   = sync_consent_stage.any_false   OR EXCLUDED.any_false,
       any_true    = sync_consent_stage.any_true    OR EXCLUDED.any_true,
       any_unknown = sync_consent_stage.any_unknown OR EXCLUDED.any_unknown`,
    [passId, phones, f, t, u],
  );
}

/** 거부 관측 시각(서버 시각 · 더 늦은 값만 · 모름은 거부 관측이 아니다) */
async function markRefusals(run: TxRun, companyId: string, folds: Map<string, ConsentFold>): Promise<void> {
  const phones = [...folds].filter(([, x]) => x.anyFalse).map(([p]) => p);
  if (phones.length === 0) return;
  await run(
    `INSERT INTO sync_consent_marks (company_id, phone, refusal_seen_at)
     SELECT $1::uuid, p, now() FROM unnest($2::text[]) AS p
     ON CONFLICT (company_id, phone) DO UPDATE SET refusal_seen_at = GREATEST(sync_consent_marks.refusal_seen_at, EXCLUDED.refusal_seen_at)`,
    [companyId, phones],
  );
}

/** 에이전트가 싣는 행(원장 패스 · 고객 적재) → 번호별 묶음 · 번호 · 동의 읽기 = 싱크 고객 적재(routes/sync.ts consentByPhone)와 같은 함수 */
export function foldConsentRows(rows: Array<{ phone?: unknown; sms_opt_in?: unknown; sms_opt_in_unknown?: unknown }>): Map<string, ConsentFold> {
  return foldByPhone(rows, (r) => (r?.phone ? normalizePhone(r.phone) : null),
    (r) => consentVote(normalizeSmsOptIn(r?.sms_opt_in), !!r?.sms_opt_in_unknown));
}

/** ① start — 그 에이전트의 모으던 패스(collecting · collected)는 버리고 새 패스 · applying 은 확정 요약이라 남긴다 */
export async function startConsentPass(run: TxRun, companyId: string, agentId: string): Promise<{ passId: string; startedAt: Date }> {
  await lockCompanySyncConsent(run, companyId);
  const own = await run(`SELECT 1 FROM sync_agents WHERE id = $1::uuid AND company_id = $2::uuid`, [agentId, companyId]);
  if (own.rows.length === 0) throw new ConsentPassError('NOT_AGENT', 400);
  if (await agentRetiring(run, agentId)) throw new ConsentPassError('RETIRING', 409);
  const old = await run(
    `UPDATE sync_consent_passes SET state = 'abandoned', finished_at = now()
      WHERE agent_id = $1::uuid AND state IN ('collecting','collected') RETURNING pass_id`,
    [agentId],
  );
  if (old.rows.length > 0) await run(`DELETE FROM sync_consent_stage WHERE pass_id = ANY($1::uuid[])`, [old.rows.map((r: any) => r.pass_id)]);
  const r = await run(`INSERT INTO sync_consent_passes (agent_id, company_id) VALUES ($1::uuid, $2::uuid) RETURNING pass_id, started_at`, [agentId, companyId]);
  return { passId: r.rows[0].pass_id, startedAt: r.rows[0].started_at };
}

/** ② stage — 원장 패스 묶음(collecting 일 때만 · 고객 행 · 수신거부 원장은 건드리지 않는다) · 반환 = 받은 번호 수 */
export async function stageConsentVotes(run: TxRun, companyId: string, agentId: string, passId: string,
  rows: Array<{ phone?: unknown; sms_opt_in?: unknown; sms_opt_in_unknown?: unknown }>): Promise<number> {
  if (rows.length > CONSENT_STAGE_MAX) throw new ConsentPassError('TOO_LARGE', 413);
  await lockCompanySyncConsent(run, companyId);
  if (await agentRetiring(run, agentId)) throw new ConsentPassError('RETIRING', 409);
  const p = await passOf(run, companyId, agentId, passId);
  if (p.state !== 'collecting') throw new ConsentPassError('BAD_STATE', 409);
  const folds = foldConsentRows(rows);
  await addStage(run, passId, folds, false);
  await markRefusals(run, companyId, folds);
  return folds.size;
}

/** ③ stage-done — collecting → collected(같은 요청 재전송 = 그대로) */
export async function finishConsentStage(run: TxRun, companyId: string, agentId: string, passId: string): Promise<void> {
  await lockCompanySyncConsent(run, companyId);
  if (await agentRetiring(run, agentId)) throw new ConsentPassError('RETIRING', 409);
  const p = await passOf(run, companyId, agentId, passId);
  if (p.state === 'collected') return;
  if (p.state !== 'collecting') throw new ConsentPassError('BAD_STATE', 409);
  await run(`UPDATE sync_consent_passes SET state = 'collected' WHERE pass_id = $1::uuid`, [passId]);
}

/**
 * ④ 고객 적재 근거 — 고객 행을 쓰기 **전에** 따로 커밋한다 · 그 패스가 collected 일 때만 · 낮추는 근거만 · 거부 관측 시각 ·
 *   묶음 번호를 load_batches 에 더한다(complete 받는 조건). 같은 묶음 재전송 = 같은 결과.
 */
export async function recordLoadEvidence(run: TxRun, companyId: string, agentId: string, passId: string, batchIndex: number,
  folds: Map<string, ConsentFold>): Promise<void> {
  await lockCompanySyncConsent(run, companyId);
  if (await agentRetiring(run, agentId)) throw new ConsentPassError('RETIRING', 409);
  const p = await passOf(run, companyId, agentId, passId);
  if (p.state !== 'collected') throw new ConsentPassError('BAD_STATE', 409);
  await addStage(run, passId, folds, true);
  await markRefusals(run, companyId, folds);
  await run(
    `UPDATE sync_consent_passes SET load_batches = CASE WHEN $2::int = ANY(load_batches) THEN load_batches ELSE array_append(load_batches, $2::int) END
      WHERE pass_id = $1::uuid`,
    [passId, batchIndex],
  );
}

/** 회사 접기 재료 — 폐기 중 아닌 에이전트마다 최신 확정 패스 */
async function confirmedSet(run: TxRun, companyId: string): Promise<Array<{ pass_id: string; started_at: Date }>> {
  const r = await run(
    `SELECT DISTINCT ON (p.agent_id) p.pass_id, p.started_at
       FROM sync_consent_passes p
      WHERE p.company_id = $1::uuid AND p.state IN ('applying','done')
        AND NOT EXISTS (SELECT 1 FROM sync_consent_passes r WHERE r.agent_id = p.agent_id AND r.state = 'retiring')
      ORDER BY p.agent_id, p.started_at DESC, p.pass_id DESC`,
    [companyId],
  );
  return r.rows;
}

/**
 * 올리기 장벽(R*) 참여자 — 세대에 한 번이라도 참여한(패스가 있는) 폐기 중 아닌 에이전트 전부 · 시작 = 그 에이전트 최신 확정 패스 시작 ·
 *   확정 패스가 아직 없으면 가장 이른 시각(첫 확정 또는 폐기 전까지 올리기를 막는다 · Codex 구현 1R #1 · 불변식 I1).
 *   회사 접기 재료(confirmedSet)와 따로 둔다 — 확정 요약이 없는 에이전트도 그 거부 관측은 막아야 한다.
 */
async function barrierStarts(run: TxRun, companyId: string): Promise<Date[]> {
  const r = await run(
    `SELECT a.agent_id, c.started_at
       FROM (SELECT DISTINCT agent_id FROM sync_consent_passes WHERE company_id = $1::uuid) a
       LEFT JOIN LATERAL (
         SELECT p.started_at FROM sync_consent_passes p
          WHERE p.agent_id = a.agent_id AND p.state IN ('applying','done')
          ORDER BY p.started_at DESC, p.pass_id DESC LIMIT 1
       ) c ON true
      WHERE NOT EXISTS (SELECT 1 FROM sync_consent_passes r WHERE r.agent_id = a.agent_id AND r.state = 'retiring')`,
    [companyId],
  );
  return r.rows.map((x: any) => (x.started_at ? new Date(x.started_at) : new Date(0)));
}

/** 2단계 한 묶음 — 번호마다 decidePublish → 고객 행 · 미룬 시각 · 같은 트랜잭션 수신거부 대조 · 반환 = 지운 sync 수신거부 번호(감사 = 커밋 뒤) */
async function applyConsentChunk(run: TxRun, companyId: string, set: Array<{ pass_id: string; started_at: Date }>, phones: string[],
  systemUserId: string | null): Promise<string[]> {
  const starts = await barrierStarts(run, companyId);
  const folds = new Map<string, ConsentFold>();
  if (set.length > 0) {
    const fr = await run(
      `SELECT phone, bool_or(any_false) AS f, bool_or(any_true) AS t, bool_or(any_unknown) AS u, count(*)::int AS n
         FROM sync_consent_stage WHERE pass_id = ANY($1::uuid[]) AND phone = ANY($2::text[]) GROUP BY phone`,
      [set.map((x) => x.pass_id), phones],
    );
    for (const x of fr.rows) folds.set(x.phone, { anyFalse: x.f, anyTrue: x.t, anyUnknown: x.u, rows: x.n });
  }
  const cr = await run(`SELECT phone, sms_opt_in FROM customers WHERE company_id = $1::uuid AND phone = ANY($2::text[])`, [companyId, phones]);
  const mr = await run(`SELECT phone, refusal_seen_at, raise_since FROM sync_consent_marks WHERE company_id = $1::uuid AND phone = ANY($2::text[])`, [companyId, phones]);
  const marks = new Map<string, { refusal_seen_at: Date | null; raise_since: Date | null }>(mr.rows.map((x: any) => [x.phone, x]));
  const setPhones: string[] = []; const setValues: boolean[] = [];
  const deferPhones: string[] = []; const deferAt: Date[] = []; const clearPhones: string[] = [];
  for (const c of cr.rows) {
    const m = marks.get(c.phone);
    const d = decidePublish({
      current: c.sms_opt_in === null ? null : !!c.sms_opt_in,
      fold: folds.get(c.phone) ?? null,
      refusalSeenAt: m?.refusal_seen_at ? new Date(m.refusal_seen_at) : null,
      raiseSince: m?.raise_since ? new Date(m.raise_since) : null,
      starts,
      multi: starts.length > 1,
    });
    if (d.target !== null) { setPhones.push(c.phone); setValues.push(d.target); }
    if (d.raiseSince === 'clear') { if (m?.raise_since) clearPhones.push(c.phone); }
    else if (d.raiseSince !== 'keep') { deferPhones.push(c.phone); deferAt.push(d.raiseSince); }
  }
  if (setPhones.length > 0) {
    await run(
      `UPDATE customers c SET sms_opt_in = v.t, updated_at = NOW()
         FROM unnest($2::text[], $3::bool[]) AS v(phone, t)
        WHERE c.company_id = $1::uuid AND c.phone = v.phone AND c.sms_opt_in IS DISTINCT FROM v.t`,
      [companyId, setPhones, setValues],
    );
  }
  if (deferPhones.length > 0) {
    await run(
      `INSERT INTO sync_consent_marks (company_id, phone, raise_since)
       SELECT $1::uuid, v.phone, v.at FROM unnest($2::text[], $3::timestamptz[]) AS v(phone, at)
       ON CONFLICT (company_id, phone) DO UPDATE SET raise_since = COALESCE(sync_consent_marks.raise_since, EXCLUDED.raise_since)`,
      [companyId, deferPhones, deferAt],
    );
  }
  if (clearPhones.length > 0) {
    await run(`UPDATE sync_consent_marks SET raise_since = NULL WHERE company_id = $1::uuid AND phone = ANY($2::text[])`, [companyId, clearPhones]);
  }
  return reconcileSyncUnsubscribesFor(run, companyId, systemUserId, phones);
}

/**
 * 2단계 대상 다음 묶음(설계서 3-2 ④) = 회사 확정 요약 전체(이 패스 포함 · 고객 행 · sync 수신거부 어긋남 대조가 회사 번호를 한 번 덮는다) ∪
 *   앞 확정 패스에만 있던 번호(원본에서 사라짐) ∪ 회사 미룬 번호 · 번호 순 · 진행 위치 뒤 · 패스마다 색인 범위로 자른다.
 */
async function nextApplyPhones(run: TxRun, companyId: string, passIds: string[], cursor: string): Promise<string[]> {
  const r = await run(
    `SELECT phone FROM (
       SELECT s.phone FROM unnest($1::uuid[]) AS p(id)
         CROSS JOIN LATERAL (SELECT phone FROM sync_consent_stage WHERE pass_id = p.id AND phone > $3 ORDER BY phone LIMIT $4) s
       UNION
       (SELECT phone FROM sync_consent_marks WHERE company_id = $2::uuid AND raise_since IS NOT NULL AND phone > $3 ORDER BY phone LIMIT $4)
     ) x ORDER BY phone LIMIT $4`,
    [passIds, companyId, cursor, CONSENT_PUBLISH_CHUNK],
  );
  return r.rows.map((x: any) => String(x.phone));
}

/**
 * ⑤ complete — 에이전트가 done 을 받을 때까지 되풀이해 부른다.
 *   collected = 받는 조건(근거 묶음 수 = 보낸 묶음 수) 확인 뒤 1단계(상태 한 번 바꿈 = 원자 · 이 패스가 그 에이전트 요약) ·
 *   applying = 그 에이전트 최신 확정 패스일 때만 2단계 한 묶음 · 묶음이 비면 done + 그 에이전트 앞 패스 정리.
 *   어긋난 묶음 수 = 그 패스 abandoned(커밋되게 던지지 않고 돌려준다 · 부르는 쪽 409). 반환 deleted = 이번 묶음이 지운 sync 수신거부 번호.
 */
export async function completeConsentPass(run: TxRun, companyId: string, agentId: string, passId: string, sentBatches: number,
  systemUserId: string | null): Promise<{ state: 'applying' | 'done' | 'abandoned'; deleted: string[] }> {
  await lockCompanySyncConsent(run, companyId);
  if (await agentRetiring(run, agentId)) throw new ConsentPassError('RETIRING', 409);
  const p = await passOf(run, companyId, agentId, passId);
  if (p.state === 'done') return { state: 'done', deleted: [] };
  if (p.state === 'collected') {
    if (p.load_batches.length !== sentBatches) {
      await run(`UPDATE sync_consent_passes SET state = 'abandoned', finished_at = now() WHERE pass_id = $1::uuid`, [passId]);
      await run(`DELETE FROM sync_consent_stage WHERE pass_id = $1::uuid`, [passId]);
      return { state: 'abandoned', deleted: [] };
    }
    const prev = await latestConfirmedPass(run, agentId);
    await run(`UPDATE sync_consent_passes SET state = 'applying', prev_pass_id = $2::uuid, publish_cursor = '' WHERE pass_id = $1::uuid`, [passId, prev]);
    return { state: 'applying', deleted: [] };
  }
  if (p.state !== 'applying') throw new ConsentPassError('BAD_STATE', 409);
  if ((await latestConfirmedPass(run, agentId)) !== passId) throw new ConsentPassError('SUPERSEDED', 409);
  const set = await confirmedSet(run, companyId);
  const passIds = set.map((x) => x.pass_id);
  if (p.prev_pass_id) passIds.push(p.prev_pass_id);
  const phones = await nextApplyPhones(run, companyId, passIds, p.publish_cursor ?? '');
  if (phones.length === 0) {
    await run(`UPDATE sync_consent_passes SET state = 'done', finished_at = now() WHERE pass_id = $1::uuid`, [passId]);
    await run(
      `DELETE FROM sync_consent_passes WHERE agent_id = $1::uuid AND pass_id <> $2::uuid AND state IN ('applying','done','abandoned') AND started_at <= $3`,
      [agentId, passId, p.started_at],
    );
    return { state: 'done', deleted: [] };
  }
  const deleted = await applyConsentChunk(run, companyId, set, phones, systemUserId);
  await run(`UPDATE sync_consent_passes SET publish_cursor = $2 WHERE pass_id = $1::uuid`, [passId, phones[phones.length - 1]]);
  return { state: 'applying', deleted };
}

/** complete 한 요청(라우트 = routes/sync-consent.ts) — 시스템 사용자는 트랜잭션 밖에서 · 지운 sync 수신거부 감사 = 커밋 뒤 */
export async function publishConsentPass(companyId: string, agentId: string, passId: string, sentBatches: number): Promise<{ state: 'applying' | 'done' | 'abandoned' }> {
  let systemUserId: string | null = null;
  try { systemUserId = await ensureSystemSyncUser(companyId); } catch (e) { console.error('[SyncConsent] 시스템 user 조회/생성 실패:', e); }
  const r = await withTransaction((run) => completeConsentPass(run, companyId, agentId, passId, sentBatches, systemUserId));
  await recordUnsubscribeDeleted({ actorUserId: null, companyId, count: r.deleted.length, phones: r.deleted, via: 'sync' });
  return { state: r.state };
}

/** 섞인 회사 판정 — 그 회사에 세대 패스가 있는 에이전트가 있는가(있으면 옛 에이전트 고객 적재 = 409 · 설계서 3-2 ⑧) */
export async function companyHasConsentPass(run: TxRun, companyId: string): Promise<boolean> {
  const r = await run(`SELECT 1 FROM sync_consent_passes WHERE company_id = $1::uuid LIMIT 1`, [companyId]);
  return r.rows.length > 0;
}

/**
 * 옛 에이전트 고객 적재(패스 번호 없음)를 막아야 하는가 — 그 회사에 세대가 있으면 예.
 *   표가 아직 없으면(DDL 전) 섞일 수 없다 → 아니오(옛 적재 영향 0 · 3-2 ⑨) · 표 존재를 먼저 봐 트랜잭션을 깨지 않는다.
 */
export async function oldLoadBlockedByConsentPass(run: TxRun, companyId: string): Promise<boolean> {
  const t = await run(`SELECT to_regclass('sync_consent_passes') IS NOT NULL AS ok`);
  if (!t.rows[0]?.ok) return false;
  return companyHasConsentPass(run, companyId);
}

/**
 * 고객 적재 청크(한 행 길 포함) 트랜잭션의 첫 문장(3-2 ⑦ · ⑧) — 회사 잠금 · 옛 요청인데 그 회사에 세대가 있으면 MIXED_AGENT 409.
 *   판정 자리 = 청크마다(접수 때 한 번이 아니다 · 이미 돌던 옛 요청도 첫 start 뒤 첫 청크에서 멈춘다 · Codex 설계 4R #3).
 */
export async function guardSyncLoadChunk(run: TxRun, companyId: string, generational: boolean): Promise<void> {
  await lockCompanySyncConsent(run, companyId);
  if (!generational && await oldLoadBlockedByConsentPass(run, companyId)) throw new ConsentPassError('MIXED_AGENT', 409);
}

/**
 * 1.7.6 고객 적재 요청인가(설계서 3-2 ⑤) — 세대 표시(consentPassId · consentBatch)가 없으면 옛 요청(null) ·
 *   있는데 agentId · 패스 번호 · 순번 중 하나라도 꼴이 틀리면 'invalid'(400 · 옛 요청으로 받지 않는다).
 */
export function generationalLoadOf(body: any): { agentId: string; passId: string; batch: number } | null | 'invalid' {
  const { agentId, consentPassId, consentBatch } = body || {};
  if (consentPassId === undefined && consentBatch === undefined) return null;
  if (!isUuid(agentId) || !isUuid(consentPassId) || !Number.isInteger(consentBatch) || consentBatch < 0) return 'invalid';
  return { agentId, passId: consentPassId, batch: consentBatch };
}

/**
 * 1.7.6 적재 요청의 근거 접기 = 고객 행 + 에이전트가 따로 실은 낮추는 근거(consentEvidence · 에이전트 검증에서 떨어진 행의 거부 · 모름 포함 ·
 *   Codex 구현 1R #2 · 불변식 I1). 따로 실은 근거는 배열 · 최대 CONSENT_STAGE_MAX 행만 받는다(아니면 'invalid').
 */
export function loadEvidenceFold(customers: any[], consentEvidence: unknown): Map<string, ConsentFold> | 'invalid' {
  if (consentEvidence === undefined) return foldConsentRows(customers);
  if (!Array.isArray(consentEvidence) || consentEvidence.length > CONSENT_STAGE_MAX) return 'invalid';
  return foldConsentRows([...customers, ...consentEvidence]);
}

/** 1.7.6 적재 요청에서 남길 행의 수신동의 — 거부가 있으면 거부(바로 쓴다) · 그 밖 = null(있는 고객 그대로 · 신규 = 대기 · 공개가 정한다) */
export function generationalRowConsent(f: ConsentFold | undefined): false | null {
  return f?.anyFalse ? false : null;
}

/** 세대 주소 · 1.7.6 적재의 실패 응답 한 곳 — 상태 어긋남 = 그 코드 · 표 없음 = 503 DB_MIGRATION_PENDING · 그 밖 = null(부르는 쪽 처리) */
export function consentFailureResponse(e: unknown): { status: number; body: Record<string, unknown> } | null {
  if (e instanceof ConsentPassError) {
    const error = e.code === 'MIXED_AGENT'
      ? '같은 회사의 다른 에이전트가 1.7.6 입니다. 이 에이전트도 1.7.6 으로 올리거나 슈퍼관리자에서 삭제해 주세요.'
      : `수신동의 세대 상태 어긋남(${e.code})`;
    return { status: e.http, body: { success: false, code: e.code, error } };
  }
  if (isMissingSchemaError(e)) return { status: 503, body: migrationPendingBody('C101-DDL-1(sync_consent_passes 등 세대 표 셋)') };
  return null;
}

/** 섞인 회사 운영 경보 — 회사당 하루 한 통(공용 경보 CT · R14) */
export async function alertMixedSyncAgents(companyId: string, companyName: string | undefined): Promise<void> {
  await sendSystemAlert({
    companyId,
    dedupKey: `sync-consent-mixed:${companyId}`,
    cooldownMs: 24 * 60 * 60 * 1000,
    title: '같은 회사에 옛 싱크 에이전트(1.7.5 이하)와 1.7.6 이 함께 있어 옛 에이전트의 고객 적재를 받지 않았습니다.',
    details: [`고객사: ${companyName || companyId}`],
    action: '옛 에이전트를 1.7.6 으로 올리거나 슈퍼관리자 싱크 에이전트 화면에서 삭제해 주세요.',
  }).catch((e) => console.error('[SyncConsent] 섞인 회사 경보 실패:', e));
}

/**
 * ⑥ 에이전트 폐기 — begin(표식 · 모으던 패스 버림) → chunk(그 에이전트를 뺀 재접기 · done 까지 되풀이) → finish(끝 확인 + sync_agents 삭제 · 한 트랜잭션).
 *   부르는 쪽 = 슈퍼관리자 에이전트 삭제 · 단계마다 withTransaction.
 */
export async function beginRetireAgentConsent(run: TxRun, companyId: string, agentId: string): Promise<void> {
  await lockCompanySyncConsent(run, companyId);
  if (await agentRetiring(run, agentId)) return;
  await run(`UPDATE sync_consent_passes SET state = 'abandoned', finished_at = now() WHERE agent_id = $1::uuid AND state IN ('collecting','collected')`, [agentId]);
  await run(`INSERT INTO sync_consent_passes (agent_id, company_id, state, publish_cursor) VALUES ($1::uuid, $2::uuid, 'retiring', '')`, [agentId, companyId]);
}

/** 폐기 묶음 — 그 에이전트 확정 패스에 있던 번호 다음 묶음을 다시 접는다 · 진행 위치 NULL = 끝 */
export async function retireAgentConsentChunk(run: TxRun, companyId: string, agentId: string, systemUserId: string | null): Promise<{ done: boolean; deleted: string[] }> {
  await lockCompanySyncConsent(run, companyId);
  const rp = await run(`SELECT pass_id, publish_cursor FROM sync_consent_passes WHERE agent_id = $1::uuid AND state = 'retiring' LIMIT 1`, [agentId]);
  if (rp.rows.length === 0) throw new ConsentPassError('BAD_STATE', 409);
  const cursor: string | null = rp.rows[0].publish_cursor;
  if (cursor === null) return { done: true, deleted: [] };
  // 재판정 대상 = 공개 2단계와 같은 함수(그 에이전트 확정 패스 번호 ∪ 회사 미룬 번호) — 확정 패스가 없던 에이전트가 막아 미룬 번호도
  //   폐기 뒤 다시 판정한다(Codex 구현 2R · 대상 고르기 한 벌)
  const own = await run(`SELECT pass_id FROM sync_consent_passes WHERE agent_id = $1::uuid AND state IN ('applying','done')`, [agentId]);
  const phones = await nextApplyPhones(run, companyId, own.rows.map((x: any) => String(x.pass_id)), cursor);
  const next = phones.length === 0 ? null : phones[phones.length - 1];
  const deleted = phones.length === 0 ? [] : await applyConsentChunk(run, companyId, await confirmedSet(run, companyId), phones, systemUserId);
  await run(`UPDATE sync_consent_passes SET publish_cursor = $2 WHERE pass_id = $1::uuid`, [rp.rows[0].pass_id, next]);
  return { done: next === null, deleted };
}

/** 폐기 끝 — 재접기가 끝까지 갔는지(진행 위치 NULL) 확인하고 같은 트랜잭션에서 에이전트 행 삭제 · 반환 = 지운 행(없으면 null) */
export async function finishRetireAgent(run: TxRun, companyId: string, agentId: string): Promise<{ id: string; agent_name: string } | null> {
  await lockCompanySyncConsent(run, companyId);
  const rp = await run(`SELECT publish_cursor FROM sync_consent_passes WHERE agent_id = $1::uuid AND state = 'retiring' LIMIT 1`, [agentId]);
  if (rp.rows.length === 0 || rp.rows[0].publish_cursor !== null) throw new ConsentPassError('BAD_STATE', 409);
  const d = await run(`DELETE FROM sync_agents WHERE id = $1::uuid AND company_id = $2::uuid RETURNING id, agent_name`, [agentId, companyId]);
  return d.rows[0] ?? null;
}

/**
 * 싱크 에이전트 삭제의 유일한 길(슈퍼관리자 · routes/admin-sync.ts) — 폐기 표식 → 재접기 묶음(끝까지) → 행 삭제.
 *   도중에 끊겨도 다시 부르면 진행 위치부터 잇는다 · 지운 sync 수신거부는 묶음 커밋 뒤 감사 기록.
 */
export async function retireSyncAgent(companyId: string, agentId: string): Promise<{ id: string; agent_name: string } | null> {
  let systemUserId: string | null = null;
  try { systemUserId = await ensureSystemSyncUser(companyId); } catch (e) { console.error('[SyncConsent] 시스템 user 조회/생성 실패:', e); }
  await withTransaction((run) => beginRetireAgentConsent(run, companyId, agentId));
  for (;;) {
    const r = await withTransaction((run) => retireAgentConsentChunk(run, companyId, agentId, systemUserId));
    await recordUnsubscribeDeleted({ actorUserId: null, companyId, count: r.deleted.length, phones: r.deleted, via: 'sync' });
    if (r.done) break;
  }
  return withTransaction((run) => finishRetireAgent(run, companyId, agentId));
}
