/**
 * spam-diag.ts — 스팸 검사 「막힌 부분 짚어 보기」의 읽기 · 자격 · 등록 · 닫기 CT
 *   (★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §5 · §6 · §6-2-2 · §7)
 *
 * 순수 판단 = spam-block-hint.ts(조각 · 의심 순서 · 확인 판 글 · 대행 갈래) · 발송 관문 = spam-diag-gate.ts.
 * 이 파일 = DB 를 읽어 그 순수 함수에 넣고, 확인 판을 등록(enqueueSpamTest)하고, 진단을 닫는다.
 *   확인 판 = 출처 spam_diag · diag_of = 부모 검사 · variant_id = 통신사 머리 글자 + 판 번호(K1 · L2 …) · 결과 행 = 그 통신사 하나.
 *
 * ⛔ spam-test-queue 는 이 파일을 import 하지 않는다(이 파일이 spam-test-queue 를 import 한다 · 순환 0).
 * ⛔ diag_of 칸이 없으면(DDL 전) 확인 판 읽기 · 닫기는 「판 없음」으로 접는다(A 는 그대로 · 화면 깨짐 0).
 *   칸 유무는 문장을 던지기 전에 information_schema 로 본다(트랜잭션 안에서 42703 으로 트랜잭션을 깨지 않게 · hasAgencyColumn CT).
 */
import pool, { query } from '../config/database';
import { SPAM_DIAG_SOURCE, spamCustomerTestSql, isAutoSpamSource } from './spam-trial';
import { enqueueSpamTest, isRenderedSample } from './spam-test-queue';
import { loadActiveRules, evaluateContent } from './spam-block';
import { KST_TODAY_START_SQL } from './stats-aggregation';
import { hasAgencyColumn } from './agency-send-intake';
import { sendSystemAlert } from './system-alert';
import { getCarrierLabel } from './sms-result-map';
import { tokenizeSpamText, rankSuspects, makeDiagVariant, type Suspect, type CarrierChecks, type DiagCheckState, type DiagVariantBasis } from './spam-block-hint';
import { diagEnabledFor, diagCallbackAllowed, DIAG_LOCK_SQL, diagLockKey } from './spam-diag-gate';

type SqlRun = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

/** 하루 상한 — 발신번호(숫자만)마다 · 전체(설계서 §6-2 6) */
export const DIAG_DAILY_CAP_PER_CALLBACK = 10;
export const DIAG_DAILY_CAP_TOTAL = 100;
const CARRIER_CODE: Record<string, string> = { SKT: 'S', KT: 'K', LGU: 'L' };
const VAR_SLOT_RE = /%[^%\s]+%/;

export function diagVariantCode(carrier: string, variant: 1 | 2): string | null {
  const c = CARRIER_CODE[carrier];
  return c ? `${c}${variant}` : null;
}

/** 칸이 없을 때(DDL 전)의 오류인가 — db_alter_safety_net 과 같은 판정 */
export function isDiagColumnMissing(err: any): boolean {
  const m = String(err?.message || '');
  return err?.code === '42703' || (m.includes('column') && m.includes('does not exist'));
}

/** diag_of 칸이 있는가(있음 = 캐시 · 없음 = 5분 뒤 다시 · 조회 실패 = 던짐) — 문장을 던지기 전에 본다 */
export function hasDiagColumn(run: SqlRun = query): Promise<boolean> {
  return hasAgencyColumn({ query: run }, 'diag_of', 'spam_filter_tests');
}

export interface DiagParent {
  id: string; companyId: string; userId: string; callback: string; source: string | null; diagOf: string | null;
  subject: string | null; status: string; firstRecipient: unknown; messageType: 'SMS' | 'LMS';
  storedText: string; createdAt: string;
  carriers: Array<{ carrier: string; result: string | null }>;
}

/** 부모 검사 한 건 + 결과 행 — diag_of 는 to_jsonb 로만 읽는다(DDL 전에도 문장 무결) */
export async function readDiagParent(testId: string, run: SqlRun = query): Promise<DiagParent | null> {
  const t = await run(
    `SELECT t.id, t.company_id, t.user_id, t.callback_number, t.source, t.subject, t.status, t.first_recipient,
            t.message_content_sms, t.message_content_lms, t.created_at, (to_jsonb(t) ->> 'diag_of') AS diag_of
       FROM spam_filter_tests t WHERE t.id = $1::uuid`,
    [testId],
  );
  const row = t.rows[0];
  if (!row) return null;
  const r = await run(`SELECT carrier, message_type, result FROM spam_filter_test_results WHERE test_id = $1::uuid ORDER BY carrier`, [testId]);
  const messageType: 'SMS' | 'LMS' = r.rows.some((x: any) => x.message_type === 'LMS' || x.message_type === 'MMS') ? 'LMS' : 'SMS';
  return {
    id: String(row.id), companyId: String(row.company_id), userId: String(row.user_id), callback: String(row.callback_number || ''),
    source: row.source ?? null, diagOf: row.diag_of ? String(row.diag_of) : null, subject: row.subject ?? null, status: String(row.status),
    firstRecipient: row.first_recipient, messageType,
    storedText: String((messageType === 'LMS' ? row.message_content_lms : row.message_content_sms) || ''),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    carriers: r.rows.map((x: any) => ({ carrier: String(x.carrier), result: x.result ?? null })),
  };
}

/**
 * 보낸 글(§5-1) — 렌더 끝난 검사는 저장 글 · 렌더 안 된 검사는 변수 칸이 없을 때만 저장 원문(치환해도 같은 글).
 *   변수 칸이 있으면 보낸 글을 복원할 수 없다 → sendable = false(A 는 원문으로만 · B 없음).
 */
export function diagSentText(p: Pick<DiagParent, 'storedText' | 'firstRecipient'>): { sentText: string; sendable: boolean } {
  if (isRenderedSample(p.firstRecipient)) return { sentText: p.storedText, sendable: true };
  return { sentText: p.storedText, sendable: !VAR_SLOT_RE.test(p.storedText) };
}

function stateOf(status: string, result: string | null): DiagCheckState {
  if (result === 'pass') return 'arrived';
  if (result === 'blocked') return 'blocked';
  if (result === 'unconfirmed') return 'checking';
  if (result === null) return status === 'queued' ? 'queued' : status === 'active' ? 'checking' : 'unknown';
  return 'unknown';
}

function removedTokens(parentText: string, variantText: string): string[] {
  const keep = new Set(tokenizeSpamText(variantText).tokens.map((t) => t.token));
  return [...new Set(tokenizeSpamText(parentText).tokens.filter((t) => !t.legal && !keep.has(t.token)).map((t) => t.token))];
}

export interface DiagCheckRow { testId: string; variant: 1 | 2; carrier: string; state: DiagCheckState; removed: string[] }

/** 이 부모의 확인 판(통신사마다 판 ① · ②) — 칸이 없으면 빈 목록 */
export async function readDiagChecks(parentTestId: string, parentText: string, run: SqlRun = query): Promise<{ rows: DiagCheckRow[]; byCarrier: Record<string, CarrierChecks> }> {
  if (!(await hasDiagColumn(run))) return { rows: [], byCarrier: {} };
  const res = await run(
    `SELECT t.id, t.variant_id, t.status, t.message_content_sms, t.message_content_lms, r.carrier, r.message_type, r.result
       FROM spam_filter_tests t JOIN spam_filter_test_results r ON r.test_id = t.id
      WHERE t.diag_of = $1::uuid AND t.source = '${SPAM_DIAG_SOURCE}'`,
    [parentTestId],
  );
  const rows: DiagCheckRow[] = [];
  const byCarrier: Record<string, CarrierChecks> = {};
  for (const x of res.rows as any[]) {
    const variant = String(x.variant_id || '').endsWith('2') ? 2 : 1;
    const text = String((x.message_type === 'SMS' ? x.message_content_sms : x.message_content_lms) || '');
    const row: DiagCheckRow = { testId: String(x.id), variant, carrier: String(x.carrier), state: stateOf(String(x.status), x.result ?? null), removed: removedTokens(parentText, text) };
    rows.push(row);
    const c = (byCarrier[row.carrier] ||= {});
    if (variant === 1) c.v1 = row.state; else { c.v2 = row.state; c.v2Removed = row.removed; }
  }
  return { rows, byCarrier };
}

/** 그 통신사의 다음 판 번호(설계서 §6-1 · §6-2 4) — 판 ① 은 주소가 있을 때 · 판 ② 는 판 ① 빼도 막힘 확정이거나 판 ① 이 없을 때 */
export function diagNextVariant(sentText: string, suspects: ReadonlyArray<Suspect>, ch: CarrierChecks): 1 | 2 | null {
  const v1Possible = makeDiagVariant(sentText, 1, suspects) !== null;
  if (v1Possible && ch.v1 === undefined) return 1;
  if (ch.v2 !== undefined) return null;
  if ((v1Possible && ch.v1 === 'blocked') || (!v1Possible)) return makeDiagVariant(sentText, 2, suspects) ? 2 : null;
  return null;
}

export type DiagIneligible = 'off' | 'diag_parent' | 'not_blocked' | 'not_sendable' | 'no_variant' | 'permission' | 'cap';

/** 자격 사유의 화면 문장(설계서 §8-4 정본 문구 · 화면 · 단추 응답이 같은 문장) */
export function diagReasonText(reason: DiagIneligible | 'error' | null | undefined): string {
  if (reason === 'permission') return '이 발신번호로는 다시 확인할 수 없어요.';
  if (reason === 'cap') return '오늘은 더 확인할 수 없어요. 내일 다시 해 주세요.';
  return '지금은 다시 확인할 수 없어요.';
}

/** 그 통신사의 의심 조각 · 확인 판 · 다음 판(무엇을 빼는 판인지 · 뺄 줄 미리 보기) */
export interface DiagCarrierHint {
  carrier: string; suspects: Suspect[]; baseline: { at: string } | null; checks: CarrierChecks;
  next: 1 | 2 | null; nextBasis: DiagVariantBasis | null; nextLines: string[];
}
export type SpamBlockHints = { parent: DiagParent; sentText: string; sendable: boolean; carriers: DiagCarrierHint[] };

/**
 * A 를 그 부모 검사에 대해 조립(설계서 §5) — 막힌 통신사마다. 막힌 통신사가 없거나 부모가 확인 판이면 null.
 *   templateText = 원문(대행 = 그 문안 버전의 글 · 없으면 저장 글 = 직접발송).
 */
export async function buildSpamBlockHints(testId: string, opts: { templateText?: string } = {}, run: SqlRun = query): Promise<SpamBlockHints | null> {
  const parent = await readDiagParent(testId, run);
  if (!parent || parent.source === SPAM_DIAG_SOURCE || parent.diagOf) return null;
  const blocked = parent.carriers.filter((c) => c.result === 'blocked').map((c) => c.carrier);
  if (blocked.length === 0) return null;
  const { sentText, sendable } = diagSentText(parent);
  const templateText = opts.templateText ?? parent.storedText;
  const cb = parent.callback.replace(/\D/g, '');
  const textCol = parent.messageType === 'LMS' ? 't.message_content_lms' : 't.message_content_sms';
  const near = await run(
    `SELECT r.carrier, r.result, ${textCol} AS body, t.created_at, (t.created_at >= ${KST_TODAY_START_SQL}) AS today
       FROM spam_filter_tests t JOIN spam_filter_test_results r ON r.test_id = t.id
      WHERE t.company_id = $1::uuid AND REPLACE(t.callback_number, '-', '') = $2 AND r.carrier = ANY($3::text[])
        AND r.message_type = $4 AND t.subject IS NOT DISTINCT FROM $5 AND t.id <> $6::uuid
        AND r.result IN ('pass', 'blocked') AND t.created_at > NOW() - INTERVAL '90 days'
        AND COALESCE(${textCol}, '') <> '' AND ${spamCustomerTestSql('t')}
      ORDER BY t.created_at DESC LIMIT 200`,
    [parent.companyId, cb, blocked, parent.messageType, parent.subject, parent.id],
  );
  let ruleTokens: string[] = [];
  try {
    const rules = await loadActiveRules();
    const hitIds = new Set(evaluateContent(sentText, rules, parent.companyId).hits.map((h) => h.ruleId));
    ruleTokens = rules.filter((r) => hitIds.has(r.id)).flatMap((r) => r.elements.filter((e) => e.type !== 'phone').map((e) => e.value));
  } catch { ruleTokens = []; }
  const { byCarrier } = await readDiagChecks(parent.id, sentText, run);
  const carriers: DiagCarrierHint[] = blocked.map((carrier) => {
    const rows = (near.rows as any[]).filter((x) => String(x.carrier) === carrier);
    const ch = byCarrier[carrier] || {};
    // 「빼도 막힘」으로 확정된 조각(확인됨 · §5-2 첫 줄)
    const notSole = [
      ...(ch.v1 === 'blocked' ? (makeDiagVariant(sentText, 1, [])?.removedTokens || []) : []),
      ...(ch.v2 === 'blocked' ? ch.v2Removed || [] : []),
    ];
    const ranked = rankSuspects({
      sentText, templateText,
      passedTexts: rows.filter((x) => x.result === 'pass').map((x) => ({ text: String(x.body), at: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at) })),
      blockedSiblings: rows.filter((x) => x.result === 'blocked' && x.today).map((x) => String(x.body)),
      ruleTokens, confirmedNotSole: notSole,
    });
    const next = sendable ? diagNextVariant(sentText, ranked.suspects, ch) : null;
    const v = next ? makeDiagVariant(sentText, next, ranked.suspects) : null;
    return { carrier, suspects: ranked.suspects, baseline: ranked.baseline, checks: ch, next, nextBasis: v?.basis ?? null, nextLines: v?.removedLines ?? [] };
  });
  return { parent, sentText, sendable, carriers };
}

/**
 * 확인 판 등록 자격(설계서 §6-2) — 상한은 등록 트랜잭션이 잠금 아래에서 센다.
 *   actorUserId = 판 행의 user_id 로 고정될 등록 계정(직접발송 = 누른 사용자 · 대행 = 접수 계정).
 */
export async function diagEligibility(i: { hint: SpamBlockHints; carrier: string; variant: 1 | 2 | null; actorUserId: string }): Promise<{ ok: true } | { ok: false; reason: DiagIneligible }> {
  const { parent, sendable, carriers } = i.hint;
  // ★ 2026-11-24 회사 스위치(슈퍼관리자 · companies.spam_diag_enabled · 조회 실패 = 꺼짐)
  if (!(await diagEnabledFor(parent.companyId))) return { ok: false, reason: 'off' };
  if (parent.source === SPAM_DIAG_SOURCE || parent.diagOf) return { ok: false, reason: 'diag_parent' };
  const c = carriers.find((x) => x.carrier === i.carrier);
  if (!c || parent.status !== 'completed') return { ok: false, reason: 'not_blocked' };
  if (!sendable) return { ok: false, reason: 'not_sendable' };
  if (i.variant === null || c.next !== i.variant) return { ok: false, reason: 'no_variant' };
  if (!(await diagCallbackAllowed(parent.companyId, i.actorUserId, parent.callback))) return { ok: false, reason: 'permission' };
  return { ok: true };
}

/**
 * 확인 판 등록 — 자격 → 판 글(makeDiagVariant) → enqueueSpamTest(새 인자 · 고정 키 잠금 아래 상한 셈 · 유일 부분 인덱스 충돌 = 있는 판).
 *   hint 를 넘기면 다시 읽지 않는다(대행 = 막 조립한 A). 돌려줌 = 판 id(새로 · 이미 있음) 또는 못 한 사유.
 */
export async function registerDiag(i: {
  parentTestId: string; carrier: string; variant: 1 | 2; actorUserId: string; templateText?: string; hint?: SpamBlockHints;
  /** 부모 진단 잠금 아래 부르는 쪽 조건(대행 = 접수 토큰 · 문안 버전 · 진단 대기) — enqueueSpamTest diag.guard 로 넘긴다 */
  guard?: (run: SqlRun) => Promise<boolean>;
}): Promise<{ ok: true; testId: string; reused: boolean } | { ok: false; reason: DiagIneligible | 'error' }> {
  const hint = i.hint ?? await buildSpamBlockHints(i.parentTestId, { templateText: i.templateText });
  if (!hint) return { ok: false, reason: 'not_blocked' };
  // 이미 있는 판 = 그 판(두 번 누름 · 다시 부름 · 상한 소모 0) — 판 순서 판정보다 먼저(있는 판은 「다음 판」이 아니다)
  const code0 = diagVariantCode(i.carrier, i.variant);
  const had = hint.carriers.find((x) => x.carrier === i.carrier)?.checks[i.variant === 1 ? 'v1' : 'v2'];
  if (had !== undefined && code0) {
    const ex = await query(`SELECT id FROM spam_filter_tests WHERE diag_of = $1::uuid AND variant_id = $2 AND source = '${SPAM_DIAG_SOURCE}'`, [i.parentTestId, code0]);
    if (ex.rows[0]) return { ok: true, testId: String(ex.rows[0].id), reused: true };
  }
  const el = await diagEligibility({ hint, carrier: i.carrier, variant: i.variant, actorUserId: i.actorUserId });
  if (!el.ok) return el;
  const c = hint.carriers.find((x) => x.carrier === i.carrier)!;
  const v = makeDiagVariant(hint.sentText, i.variant, c.suspects);
  const code = diagVariantCode(i.carrier, i.variant);
  if (!v || !code) return { ok: false, reason: 'no_variant' };
  const p = hint.parent;
  const out = await enqueueSpamTest({
    companyId: p.companyId, userId: i.actorUserId, callbackNumber: p.callback,
    ...(p.messageType === 'LMS' ? { messageContentLms: v.text } : { messageContentSms: v.text }),
    messageType: p.messageType, subject: p.subject || undefined,
    source: SPAM_DIAG_SOURCE, skipPrepaid: true, rendered: true, variantId: code,
    diag: { parentTestId: p.id, carrier: i.carrier, capPerCallback: DIAG_DAILY_CAP_PER_CALLBACK, capTotal: DIAG_DAILY_CAP_TOTAL, guard: i.guard },
  });
  if (out.errorCode === 'DIAG_NOT_BLOCKED') return { ok: false, reason: 'not_blocked' };
  if (out.errorCode === 'DIAG_CLOSED') return { ok: false, reason: 'error' };
  if (out.ok && out.testId) return { ok: true, testId: out.testId, reused: !!out.reused };
  if (out.errorCode === 'DIAG_CAP') {
    if (out.error === 'total') {
      // 전체 하루 상한 = 그날 판 0 + 운영 경보 1회(설계서 §6-2 6 · 경보 CT 의 중복 키 = 한국 날짜)
      const kstDay = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
      void sendSystemAlert({
        dedupKey: `spam-diag-cap:${kstDay}`, companyId: null,
        message: `스팸 검사 확인 판이 오늘 전체 상한(${DIAG_DAILY_CAP_TOTAL}판)에 닿아 오늘은 더 만들지 않습니다.`,
      }).catch(() => undefined);
    }
    return { ok: false, reason: 'cap' };
  }
  if (out.errorCode === 'DB_MIGRATION_PENDING') throw Object.assign(new Error('column diag_of does not exist'), { code: '42703' });
  return { ok: false, reason: 'error' };
}

/**
 * 판 행 잠그기 = 진단 잠금 → 판의 확인 문자 → 판 결과 행(설계서 §7 절차 3 · 4a 확정 · 진단 닫기가 이 함수 하나로 잡는다) · 칸이 없으면 할 것 0.
 *   ★ 배포 2 Codex 3R · 4R 구조 — 행 잠금 순서를 이 함수가 소유한다. 확인 문자 → 결과 행 = 기한 처리 · 보고 매칭(spam-probe closeProbes)과 같은 순이라
 *   진단 잠금을 안 잡는 그쪽과 겹쳐도 서로 기다리지 않는다. 진단 잠금을 쥔 쪽은 판 행을 이 함수로만 잠근다(판 행 쓰기는 그 뒤).
 */
export async function lockDiagResultRows(parentTestId: string, run: SqlRun): Promise<boolean> {
  if (!(await hasDiagColumn(run))) return false;
  await run(DIAG_LOCK_SQL, [diagLockKey(parentTestId)]);
  await run(
    `SELECT p.id FROM spam_test_probes p
      WHERE p.result_id IN (SELECT r.id FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id
                             WHERE t.diag_of = $1::uuid AND t.source = '${SPAM_DIAG_SOURCE}')
      ORDER BY p.id FOR UPDATE`,
    [parentTestId],
  );
  await run(
    `SELECT r.id FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id
      WHERE t.diag_of = $1::uuid AND t.source = '${SPAM_DIAG_SOURCE}' ORDER BY r.id FOR UPDATE OF r`,
    [parentTestId],
  );
  return true;
}

/**
 * 진단 닫기(설계서 §6-2-2) — 부모 진단 잠금을 잡고 그 부모의 열린 판을 행 상태로 닫는다(부르는 쪽 트랜잭션 run 으로).
 *   NULL · unconfirmed 결과 = error / queued 판 = completed / 그 판들의 claimed · sent 확인 문자 = expired.
 *   잠금 순서 = (부르는 쪽이 이미 잡은 접수 행 · T 결과 행) → 진단 잠금 → 판 행. 칸이 없으면 할 것 0.
 *   ponytail: 잠금 대기 상한 없음 — 두 적재 함수는 잠금 아래에서 PG 판정 · 표시만 하고 MySQL 적재는 커밋 뒤라 대기는 짧다.
 */
export async function closeDiagnosis(parentTestId: string, run?: SqlRun): Promise<void> {
  // ★ 배포 2 Codex 2R — 부르는 쪽 트랜잭션이 없으면 자기 트랜잭션 하나로(진단 잠금 · 세 닫기 쓰기가 한 덩어리 · 잠금이 문장 끝에 풀리지 않게)
  if (!run) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await closeDiagnosis(parentTestId, (sql, params) => client.query(sql, params));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return;
  }
  // ★ 배포 2 Codex 4R 구조 — 판 행은 lockDiagResultRows 가 정한 순서(진단 잠금 → 확인 문자 → 결과 행)로 먼저 다 잡고 쓴다(아래 쓰기 순서와 무관)
  if (!(await lockDiagResultRows(parentTestId, run))) return;
  await run(
    `UPDATE spam_test_probes SET status = 'expired', decided_at = NOW()
      WHERE status IN ('claimed', 'sent')
        AND result_id IN (SELECT r.id FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id WHERE t.diag_of = $1::uuid AND t.source = '${SPAM_DIAG_SOURCE}')`,
    [parentTestId],
  );
  await run(
    `UPDATE spam_filter_test_results SET result = 'error'
      WHERE (result IS NULL OR result = 'unconfirmed')
        AND test_id IN (SELECT id FROM spam_filter_tests WHERE diag_of = $1::uuid AND source = '${SPAM_DIAG_SOURCE}')`,
    [parentTestId],
  );
  await run(
    `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
      WHERE diag_of = $1::uuid AND source = '${SPAM_DIAG_SOURCE}' AND status = 'queued'`,
    [parentTestId],
  );
}

// ─────────────── 보이는 문장(설계서 §8-4 정본 문구 · 화면 = 해요체 · 문자 · 메일 = 합니다체) ───────────────

/** 확인 판 한 판의 상태 문장 — 대기 · 확인 중이면 「확인하고 있어요」 · 정본 문구 그대로 */
export function diagStateSentence(carrier: string, variant: 1 | 2, state: DiagCheckState, formal = false): string {
  const c = getCarrierLabel(carrier);
  if (state === 'queued' || state === 'checking') return formal ? `${c}로 보내 확인하고 있습니다.` : `${c}로 보내 확인하고 있어요.`;
  if (state === 'unknown') return formal ? '확인을 마치지 못했습니다.' : '확인을 마치지 못했어요.';
  if (variant === 1) {
    if (state === 'arrived') return formal ? `글 속 주소를 빼니 ${c}에 도착했습니다. 주소를 바꿔 주세요.` : `글 속 주소를 빼니 ${c}에 도착했어요. 주소를 바꿔 보세요.`;
    return formal ? `글 속 주소를 빼도 ${c}에서 막혔습니다. 주소만의 문제는 아닙니다.` : `글 속 주소를 빼도 ${c}에서 막혔어요. 주소만의 문제는 아니에요.`;
  }
  if (state === 'arrived') return formal ? `표시한 줄을 빼니 ${c}에 도착했습니다. 그 줄의 표현을 바꿔 주세요.` : `표시한 줄을 빼니 ${c}에 도착했어요. 그 줄의 표현을 바꿔 보세요.`;
  return formal ? `표시한 줄을 빼도 ${c}에서 막혔습니다.` : `표시한 줄을 빼도 ${c}에서 막혔어요.`;
}

/** 그 통신사의 가장 최근 확정 판(② 가 있으면 ②) — 대기 · 확인 중은 확정이 아니다 */
function lastSettled(ch: CarrierChecks): { variant: 1 | 2; state: DiagCheckState } | null {
  const settled = (s?: DiagCheckState) => s === 'arrived' || s === 'blocked' || s === 'unknown';
  if (settled(ch.v2)) return { variant: 2, state: ch.v2! };
  if (settled(ch.v1)) return { variant: 1, state: ch.v1! };
  return null;
}

/**
 * 한 줄 요약(D3 경고 창 · 담당자 문자 · 회신 메일) — 확정된 판 결과가 있으면 그 문장(통신사마다) · 없으면 의심 부분(주소가 앞이면 「글 속 주소」).
 *   확인 중 · 대기는 쓰지 않는다(확정 상태만 근거 · 설계서 §6-4).
 */
export function spamHintLine(h: SpamBlockHints, formal = false): string {
  const settled = h.carriers.map((c) => ({ c, s: lastSettled(c.checks) })).filter((x) => x.s);
  if (settled.length > 0) return settled.map((x) => diagStateSentence(x.c.carrier, x.s!.variant, x.s!.state, formal)).join(' ');
  const top = h.carriers[0]?.suspects.find((s) => !s.demoted);
  if (top?.kind === 'url') return '막혔을 수 있는 부분: 글 속 주소';
  return '';
}

/** 4a = 막힌 통신사 전부에서 판 ①(주소만 뺀 글)이 도착(설계서 §7) */
export function isAddressCause(h: SpamBlockHints, blockedCarriers: ReadonlyArray<string>): boolean {
  const cs = blockedCarriers.map((c) => h.carriers.find((x) => x.carrier === c));
  return cs.length > 0 && cs.every((c) => c?.checks.v1 === 'arrived');
}

/**
 * ★ 배포 2 Codex 2R — 이 검사의 진단을 대행이 가졌는가(대행 진단 사건 spam_hint 의 T). 대행은 같은 날 같은 글이면 사람이 건 검사도 이어 보므로,
 *   그 검사의 진단은 대행 진단 대기(접수 · 문안 버전 · 닫기)가 소유한다 → 화면 단추 · 화면 등록은 열지 않는다(닫힌 진단에 화면이 판을 더하지 않게).
 */
export async function agencyOwnsDiag(parentTestId: string, run: SqlRun = query): Promise<boolean> {
  const r = await run(`SELECT 1 FROM agency_send_events WHERE kind = 'spam_hint' AND payload ->> 'parentTestId' = $1 LIMIT 1`, [parentTestId]);
  return r.rows.length > 0;
}

/** 화면 응답(GET /tests/:id 의 hints · D1 · D2) — 다음 판 자격을 그 사용자 기준으로 함께 싣는다 */
export async function spamHintsResponse(h: SpamBlockHints, actorUserId: string): Promise<{ sendable: boolean; carriers: Array<DiagCarrierHint & { eligible: boolean; reason: DiagIneligible | null; reasonText: string }> }> {
  const carriers = [];
  // ★ 배포 2 Codex 1R — 화면 단추 = 사람이 건 검사만(자동 검사의 진단은 그 길이 맡는다 · 라우트 POST /diagnose 와 같은 경계)
  const auto = isAutoSpamSource(h.parent.source) || await agencyOwnsDiag(h.parent.id);
  for (const c of h.carriers) {
    const el = auto ? { ok: false as const, reason: 'off' as DiagIneligible }
      : await diagEligibility({ hint: h, carrier: c.carrier, variant: c.next, actorUserId }).catch(() => ({ ok: false as const, reason: 'off' as DiagIneligible }));
    carriers.push({ ...c, eligible: el.ok, reason: el.ok ? null : el.reason, reasonText: el.ok ? '' : diagReasonText(el.reason) });
  }
  return { sendable: h.sendable, carriers };
}

/** 글에 주소가 있는가(D4 지난 검사 줄 · 순수) */
export function textHasUrl(text: string): boolean {
  return tokenizeSpamText(text).tokens.some((t) => t.url && !t.legal);
}

/** 회신 메일의 원문 줄(의심 조각이 든 줄 앞 「▶」 · 원문 = 고객이 쓴 글 · 변수 값 0 · 설계서 §8-2 M3) */
export function markedTemplateLines(templateText: string, h: SpamBlockHints | null): string[] {
  const marks = new Set((h?.carriers || []).flatMap((c) => c.suspects.filter((s) => !s.demoted && s.kind !== 'other').map((s) => s.token)));
  const { tokens } = tokenizeSpamText(templateText);
  const marked = new Set(tokens.filter((t) => marks.has(t.token)).map((t) => t.line));
  return String(templateText || '').split('\n').map((l, i) => (marked.has(i) ? `▶ ${l}` : l));
}
