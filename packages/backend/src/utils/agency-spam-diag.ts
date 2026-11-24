/**
 * agency-spam-diag.ts — 대행발송 스팸 검사 루프의 「막힌 부분 짚어 보기」(★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §7)
 *
 * 문안 버전에서 처음 막힌 글(T)에 확인 판을 걸고, 루프 안에서 기다리지 않고 접수를 받기 전 상태로 돌려 둔다(진단 대기 · last_test_result.diagHold).
 * 다음 주기에 그 판의 확정 결과로 갈래를 정한다: 대기 / 4a(막힌 통신사 전부 주소만 뺀 글 도착 = 사람 판단) / 4b(표시한 줄 뺀 글 도착 = 그 표현을 피해 다듬기) /
 *   4c(그 밖 · 30분 넘음 = 지금처럼 다듬기) / 통과(대기 사이 늦은 보고로 T 통과).
 * 4a 는 한 트랜잭션으로 확정한다(접수 행 → T 결과 행 → 진단 잠금 → 판 결과 행 · 잠근 값으로 다시 판정해 4a 일 때만 test_failed + 진단 닫기).
 * 그 밖 갈래는 진단 대기를 지우고 진단을 닫은 뒤(한 트랜잭션) 루프가 T 를 같은 검사 이어 보기로 다시 읽어 간다 — T 가 그 사이 통과로 바뀌었으면
 *   루프가 통과 갈래로 간다(잠금 아래 다시 판정할 일이 없다 · 판정은 루프의 한 곳).
 * ⛔ 진단은 부가 동작이다(fail-open) — 힌트 · 판 읽기 · 판 등록이 던지면 4c 와 같다. 일반 검사의 판정 · 장애 셈 · 보류는 건드리지 않는다.
 */
import pool, { query } from '../config/database';
import { readSpamTestOutcome } from './spam-test-queue';
import { classifyDiag, tokenizeSpamText, type CarrierChecks } from './spam-block-hint';
import {
  buildSpamBlockHints, registerDiag, closeDiagnosis, lockDiagResultRows, readDiagParent, readDiagChecks, diagSentText, diagStateSentence, spamHintLine, markedTemplateLines,
} from './spam-diag';
import { getCarrierLabel } from './sms-result-map';

type SqlRun = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
const LOG = '[agency-send][spam-diag]';

/** 진단 대기 상한(분) — 넘으면 4c(설계서 §7 표) */
export const DIAG_HOLD_MAX_MINUTES = 30;
/** 발송 시각까지 이만큼 남아야 판을 건다(당일 재검사 창 밖 · 설계서 §7 조건) */
export const DIAG_MIN_LEAD_MINUTES = 120;
/** 진단 사건(문안 버전당 한 번 · 판 등록 · 확정 결과 문장) */
export const SPAM_HINT_EVENT = 'spam_hint';

export interface DiagHold { parentTestId: string; version: number; content: string; rounds: number; startedAt: string }
export type DiagStep =
  | { kind: 'wait' }
  | { kind: 'pass' }
  | { kind: '4a'; carriers: string[]; arrived: string[]; sentence: string }
  | { kind: '4b'; avoid: string[]; sentence: string }
  | { kind: '4c'; sentence: string };

/** (순수) 지금 문안 버전의 진단 대기 표시 · 다른 버전이면 없음 */
export function diagHoldOf(row: { last_test_result?: any; content_version?: any }): DiagHold | null {
  const h = row.last_test_result && typeof row.last_test_result === 'object' ? row.last_test_result.diagHold : null;
  if (!h || Number(h.version) !== Number(row.content_version || 0) || typeof h.parentTestId !== 'string' || typeof h.content !== 'string') return null;
  return { parentTestId: h.parentTestId, version: Number(h.version), content: h.content, rounds: Number(h.rounds) || 1, startedAt: String(h.startedAt || '') };
}

/** (순수) 결과 칸에 진단 대기를 얹거나(hold) 지운 값(null) · 남는 것이 없으면 null — heldResultJson 과 같은 꼴(대기를 얹으면 검사 중 후보는 지운다) */
export function diagHoldJson(row: { last_test_result?: any }, hold: DiagHold | null): string | null {
  const prev: Record<string, any> = row.last_test_result && typeof row.last_test_result === 'object' && !Array.isArray(row.last_test_result) ? { ...row.last_test_result } : {};
  delete prev.diagHold;
  if (hold) delete prev.heldCandidate;
  const next = hold ? { ...prev, diagHold: hold } : prev;
  return Object.keys(next).length > 0 ? JSON.stringify(next) : null;
}

/** 이 문안 버전에 진단을 이미 시작했는가(spam_hint 사건 · 문안 버전당 한 번) */
export async function diagStartedFor(requestId: string, version: number): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM agency_send_events WHERE request_id = $1::uuid AND kind = '${SPAM_HINT_EVENT}' AND COALESCE(payload->>'version', '') = $2 LIMIT 1`,
    [requestId, String(version)],
  );
  return r.rows.length > 0;
}

async function hintEvent(requestId: string, payload: Record<string, any>, run: SqlRun = query): Promise<void> {
  await agencyEvent(requestId, SPAM_HINT_EVENT, payload, run);
}
async function agencyEvent(requestId: string, kind: string, payload: Record<string, any>, run: SqlRun): Promise<void> {
  await run(`INSERT INTO agency_send_events (request_id, kind, payload) VALUES ($1::uuid, $2, $3::jsonb)`, [requestId, kind, JSON.stringify(payload)]);
}

/**
 * ★ 배포 2 Codex 1R — 판 등록의 부르는 쪽 조건(부모 진단 잠금 아래 · enqueueSpamTest diag.guard): 이 워커가 아직 그 접수를 쥐고(선점 토큰) 같은 문안 버전이다.
 *   withHold = 진단 대기 중 판 ② 등록 = 결과 칸의 진단 대기가 아직 그 T 다. 문안 수정 · 진단 닫기가 먼저 커밋됐으면 거짓 = 등록 0 ·
 *   등록이 먼저면 뒤에 오는 수정의 진단 닫기가 진단 잠금을 기다렸다가 이 판까지 닫는다.
 */
function regGuard(row: any, version: number, parentTestId: string, withHold: boolean) {
  return async (run: SqlRun): Promise<boolean> => {
    const r = await run(
      `SELECT 1 FROM agency_send_requests WHERE id = $1::uuid AND lock_token = $2::uuid AND content_version = $3
         ${withHold ? `AND last_test_result -> 'diagHold' ->> 'parentTestId' = $4` : ''}`,
      withHold ? [row.id, row.lock_token, version, parentTestId] : [row.id, row.lock_token, version],
    );
    return r.rows.length > 0;
  };
}

/** 확정 결과 문장(진행 기록 · 담당자 문자 · 회신 메일 = 합니다체) — 통신사마다 그 판의 상태 */
function sentenceOf(checks: Readonly<Record<string, CarrierChecks>>, carriers: ReadonlyArray<string>, variant: 1 | 2): string {
  return carriers.map((c) => {
    const st = checks[c]?.[variant === 1 ? 'v1' : 'v2'];
    return st ? diagStateSentence(c, variant, st, true) : '';
  }).filter(Boolean).join(' ');
}

/**
 * T 가 막혔다 — 이 버전 첫 막힘이고 발송까지 2시간 이상이면 막힌 통신사마다 첫 판을 등록한다.
 *   등록한 판이 하나라도 있으면 진단 대기(hold)를 돌려준다(부르는 쪽 = 다듬지 않고 접수를 받기 전 상태로) · 없으면 null(지금처럼 다듬기).
 *   사건 spam_hint 는 판이 없어도 남긴다(그 뒤 막힘엔 진단 0 · 문안 버전당 한 번).
 */
export async function startAgencyDiag(row: any, parentTestId: string, content: string, rounds: number, now = new Date()): Promise<DiagHold | null> {
  const version = Number(row.content_version || 0);
  try {
    if (await diagStartedFor(String(row.id), version)) return null;
    const leadMin = (new Date(row.requested_at).getTime() - now.getTime()) / 60_000;
    if (!(leadMin >= DIAG_MIN_LEAD_MINUTES)) {
      await hintEvent(String(row.id), { version, parentTestId, sentTo: [], skipped: 'lead' });
      return null;
    }
    const hint = await buildSpamBlockHints(parentTestId, { templateText: content });
    const sentTo: string[] = [];
    for (const c of hint?.carriers || []) {
      if (!c.next) continue;
      const r = await registerDiag({ parentTestId, carrier: c.carrier, variant: c.next, actorUserId: String(row.created_by || ''), hint: hint!, guard: regGuard(row, version, parentTestId, false) })
        .catch((e: any) => { console.warn(`${LOG} 판 등록 실패 request=${row.id} carrier=${c.carrier}:`, e?.message || e); return null; });
      if (r?.ok) sentTo.push(c.carrier);
    }
    await hintEvent(String(row.id), { version, parentTestId, sentTo });
    return sentTo.length > 0 ? { parentTestId, version, content, rounds, startedAt: now.toISOString() } : null;
  } catch (err: any) {
    console.warn(`${LOG} 진단 시작 실패(지금처럼 다듬기) request=${row.id}:`, err?.message || err);
    await hintEvent(String(row.id), { version, parentTestId, sentTo: [], skipped: 'error' }).catch(() => undefined);
    return null;
  }
}

/**
 * 판정 — T 의 지금 결과 · 판의 확정 결과로 갈래. 잠금 안에서도 부르므로 run 한 연결만 쓴다(풀 · 규칙 캐시 0).
 *   판 ② 등록이 필요하면(register_v2) 여기서 갈래만 알리고, 등록은 잠금 밖 stepAgencyDiag 가 한다.
 */
async function decide(hold: DiagHold, run: SqlRun): Promise<DiagStep | { kind: 'register_v2'; carriers: string[]; checks: Record<string, CarrierChecks> }> {
  const outcome = await readSpamTestOutcome(hold.parentTestId, run);
  if (outcome.outcome === 'pass') return { kind: 'pass' };
  const blocked = [...new Set(outcome.carrierResults.filter((r) => r.result === 'blocked').map((r) => r.carrier))].sort();
  if (outcome.outcome !== 'blocked' || blocked.length === 0) return { kind: '4c', sentence: '' };
  const parent = await readDiagParent(hold.parentTestId, run);
  if (!parent) return { kind: '4c', sentence: '' };
  const { byCarrier } = await readDiagChecks(hold.parentTestId, diagSentText(parent).sentText, run);
  const cls = classifyDiag({ blockedCarriers: blocked, checks: byCarrier });
  if (cls.branch === 'wait') return { kind: 'wait' };
  if (cls.branch === 'register_v2') return { kind: 'register_v2', carriers: cls.registerV2Carriers || [], checks: byCarrier };
  if (cls.branch === '4a') {
    // ★ 배포 2 Codex 3R — 도착 = T 에서 실제로 통과한 통신사만(시간 초과 · 확인 못 함은 도착이 아니다 · 회신 메일 상태 줄)
    const arrived = [...new Set(outcome.carrierResults.filter((r) => r.result === 'pass').map((r) => r.carrier))].filter((c) => !blocked.includes(c)).sort();
    return { kind: '4a', carriers: blocked, arrived, sentence: sentenceOf(byCarrier, blocked, 1) };
  }
  if (cls.branch === '4b') {
    // ★ 배포 2 Codex 1R — 피할 표현 = 원문(이 문안 버전의 글)에도 있는 조각만(보낸 글은 표본 고객 값이 치환된 글 · 이름 같은 값이 다듬기 AI 로 가지 않게)
    const tpl = new Set(tokenizeSpamText(hold.content).tokens.map((t) => t.token));
    return { kind: '4b', avoid: (cls.avoid || []).filter((t) => tpl.has(t)), sentence: sentenceOf(byCarrier, blocked.filter((c) => byCarrier[c]?.v2 === 'arrived'), 2) };
  }
  return { kind: '4c', sentence: sentenceOf(byCarrier, blocked, blocked.some((c) => byCarrier[c]?.v2 !== undefined) ? 2 : 1) };
}

/** 진단 대기 이어 보기(다음 주기 · 잠금 없이) — 판 ② 가 필요하면 등록하고 대기 · 30분 넘으면 4c · 던지면 4c(fail-open) */
export async function stepAgencyDiag(row: any, hold: DiagHold, now = new Date()): Promise<DiagStep> {
  try {
    const d = await decide(hold, query);
    const started = Date.parse(hold.startedAt);
    const overdue = Number.isFinite(started) && now.getTime() - started > DIAG_HOLD_MAX_MINUTES * 60_000;
    if (d.kind === 'register_v2') {
      if (overdue) return { kind: '4c', sentence: sentenceOf(d.checks, d.carriers, 1) };
      let sent = 0;
      for (const c of d.carriers) {
        const r = await registerDiag({ parentTestId: hold.parentTestId, carrier: c, variant: 2, actorUserId: String(row.created_by || ''), templateText: hold.content, guard: regGuard(row, hold.version, hold.parentTestId, true) }).catch(() => null);
        if (r?.ok) sent += 1;
      }
      return sent > 0 ? { kind: 'wait' } : { kind: '4c', sentence: sentenceOf(d.checks, d.carriers, 1) };
    }
    if (d.kind === 'wait' && overdue) return { kind: '4c', sentence: '' };
    return d;
  } catch (err: any) {
    console.warn(`${LOG} 진단 대기 읽기 실패(4c) request=${row.id}:`, err?.message || err);
    return { kind: '4c', sentence: '' };
  }
}

/**
 * 4a 확정 = 한 트랜잭션(설계서 §7 절차 3) — 접수 행 FOR UPDATE(선점 토큰 · 버전) → T 결과 행 FOR UPDATE → 진단 잠금 · 판 결과 행 FOR UPDATE →
 *   잠근 값으로 다시 판정해 4a 일 때만 test_failed(진단 대기 지움) + 진단 닫기 + 확정 사건 둘(spam_hint 4a · test_failed spam_address) → 커밋.
 *   돌려줌 = 'ok' | 'changed'(다시 판정이 4a 가 아님 · 되돌림) | 'lost'(소유권 · 버전이 바뀜).
 */
export async function settleAgencyDiag4a(row: any, token: string, hold: DiagHold, lastTestResult: string | null): Promise<{ status: 'ok'; carriers: string[]; sentence: string } | { status: 'changed' | 'lost' }> {
  const client = await pool.connect();
  const run: SqlRun = (sql, params) => client.query(sql, params);
  try {
    await client.query('BEGIN');
    const own = await run(`SELECT content_version FROM agency_send_requests WHERE id = $1::uuid AND lock_token = $2::uuid FOR UPDATE`, [row.id, token]);
    if (own.rows.length === 0 || Number(own.rows[0].content_version) !== hold.version) { await client.query('ROLLBACK'); return { status: 'lost' }; }
    await run(`SELECT id FROM spam_filter_test_results WHERE test_id = $1::uuid ORDER BY id FOR UPDATE`, [hold.parentTestId]);
    await lockDiagResultRows(hold.parentTestId, run);
    // ★ 배포 2 Codex 1R — 사건 · 담당자 문자 = 잠근 값으로 다시 판정한 통신사 · 문장(잠금 앞 판정의 통신사가 아니라)
    const locked = await decide(hold, run);
    if (locked.kind !== '4a') { await client.query('ROLLBACK'); return { status: 'changed' }; }
    await run(
      `UPDATE agency_send_requests SET status = 'test_failed', last_test_result = $3::jsonb, lock_at = NULL, lock_token = NULL,
              revision = revision + 1, updated_at = NOW()
        WHERE id = $1::uuid AND lock_token = $2::uuid`,
      [row.id, token, lastTestResult],
    );
    await closeDiagnosis(hold.parentTestId, run);
    // ★ 배포 2 Codex 3R — 확정 사건 둘 = 상태와 같은 트랜잭션(사건이 못 남으면 상태째 되돌림 · 회신 메일 대상 SQL 이 이 사건으로 고른다)
    await hintEvent(row.id, { version: hold.version, parentTestId: hold.parentTestId, branch: '4a', sentence: locked.sentence, carriers: locked.carriers, arrived: locked.arrived }, run);
    await agencyEvent(row.id, 'test_failed', { rounds: hold.rounds, reason: 'spam_address' }, run);
    await client.query('COMMIT');
    return { status: 'ok', carriers: locked.carriers, sentence: locked.sentence };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 그 밖 갈래(통과 · 4b · 4c) — 진단 대기를 지우고 진단을 닫는다(한 트랜잭션 · 접수 행 → 진단 잠금 순) · 소유권을 잃었으면 false */
export async function releaseAgencyDiag(row: any, token: string, hold: DiagHold, lastTestResult: string | null): Promise<boolean> {
  const client = await pool.connect();
  const run: SqlRun = (sql, params) => client.query(sql, params);
  try {
    await client.query('BEGIN');
    const upd = await run(
      `UPDATE agency_send_requests SET last_test_result = $3::jsonb, revision = revision + 1, updated_at = NOW()
        WHERE id = $1::uuid AND lock_token = $2::uuid AND content_version = $4`,
      [row.id, token, lastTestResult, hold.version],
    );
    if ((upd.rowCount ?? 0) === 0) { await client.query('ROLLBACK'); return false; }
    await closeDiagnosis(hold.parentTestId, run);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 담당자 문자 · 회신 메일의 한 줄 — 막힌 통신사 표시명 · 이 버전 진단(T)의 확정 판 결과(없으면 의심 부분) · 던지면 빈 줄 */
export async function agencyBlockSummary(row: any, lastTestId: string | null, lastBlockedCarriers: ReadonlyArray<string>): Promise<{ carriers: string[]; resultLine: string }> {
  const carriers = [...new Set(lastBlockedCarriers)].map(getCarrierLabel);
  try {
    const ev = await query(
      `SELECT payload->>'parentTestId' AS t FROM agency_send_events WHERE request_id = $1::uuid AND kind = '${SPAM_HINT_EVENT}'
         AND COALESCE(payload->>'version', '') = $2 AND payload ? 'parentTestId' ORDER BY id DESC LIMIT 1`,
      [row.id, String(Number(row.content_version || 0))],
    );
    const testId = ev.rows[0]?.t || lastTestId;
    if (!testId) return { carriers, resultLine: '' };
    const hint = await buildSpamBlockHints(String(testId), { templateText: String(row.current_content || '') });
    return { carriers, resultLine: hint ? spamHintLine(hint, true) : '' };
  } catch {
    return { carriers, resultLine: '' };
  }
}

/**
 * 검사 결과 회신 메일 본문(설계서 §8-2 M3 · 평문 · 합니다체) — 막힌 통신사 · 도착한 통신사 · 확인한 내용 · 원문(확인한 줄 앞 ▶) · 고치는 길.
 *   통신사 결과 = 이 버전 마지막 막힘 사건(spam_blocked.carriers) · 확인한 내용 = 이 버전 진단(T)의 확정 판 결과(없으면 의심 부분).
 *   ⛔ 「다시 접수하면 새 접수로 받는다」는 넣지 않는다(중복 판정이 막힌 접수를 어떻게 세는지 확인 전 · 설계서 §8-2 미검증).
 */
export async function buildSpamResultMail(row: any): Promise<{ subject: string; text: string } | null> {
  const version = String(Number(row.content_version || 0));
  const blockedEv = await query(
    `SELECT payload FROM agency_send_events WHERE request_id = $1::uuid AND kind = 'spam_blocked' ORDER BY id DESC LIMIT 1`,
    [row.id],
  );
  const cr: Array<{ carrier: string; result: string | null }> = Array.isArray(blockedEv.rows[0]?.payload?.carriers) ? blockedEv.rows[0].payload.carriers : [];
  const ev = await query(
    `SELECT payload FROM agency_send_events WHERE request_id = $1::uuid AND kind = '${SPAM_HINT_EVENT}'
       AND COALESCE(payload->>'version', '') = $2 AND payload ? 'parentTestId' ORDER BY id DESC LIMIT 1`,
    [row.id, version],
  );
  const hintEv = ev.rows[0]?.payload || null;
  // ★ 배포 2 Codex 2R — 4a 로 멈춘 건 = 그 확정 사건의 통신사(잠근 판정) · 그 밖 = 마지막 막힘 사건
  const fixed4a = hintEv?.branch === '4a' && Array.isArray(hintEv.carriers) ? (hintEv.carriers as unknown[]).map(String) : null;
  const blocked = fixed4a ?? [...new Set(cr.filter((c) => c.result === 'blocked').map((c) => String(c.carrier)))];
  if (blocked.length === 0) return null;
  // ★ 배포 2 Codex 3R — 도착 = 실제로 통과한 통신사만(4a = 확정 사건의 arrived · 그 밖 = 마지막 막힘 사건의 pass)
  const arrived = fixed4a
    ? (Array.isArray(hintEv.arrived) ? (hintEv.arrived as unknown[]).map(String).filter((c) => !fixed4a.includes(c)) : [])
    : [...new Set(cr.filter((c) => c.result === 'pass').map((c) => String(c.carrier)))].filter((c) => !blocked.includes(c));
  const templateText = String(row.current_content || '');
  const hint = hintEv?.parentTestId ? await buildSpamBlockHints(String(hintEv.parentTestId), { templateText }).catch(() => null) : null;
  const names = blocked.map(getCarrierLabel).join(', ');
  const status = [...blocked.map((c) => `${getCarrierLabel(c)} 막힘`), ...arrived.map((c) => `${getCarrierLabel(c)} 도착`)].join('   ');
  const line = fixed4a && typeof hintEv?.sentence === 'string' && hintEv.sentence ? hintEv.sentence : hint ? spamHintLine(hint, true) : '';
  const label = String(row.file_name || row.original_content || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '접수 건';
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const text = [
    '안녕하세요, 한줄로입니다.',
    `보내 주신 대행발송 건이 ${names} 스팸 검사에 걸려 예약하지 않았습니다.`,
    '',
    `건: ${label}`,
    status,
    '',
    '확인한 내용',
    line || '통신사는 막은 이유를 알려 주지 않아 고칠 곳을 좁히지 못했습니다.',
    '',
    `보내 주신 글${hint ? ' (▶ 표시가 확인한 부분입니다)' : ''}`,
    ...markedTemplateLines(templateText, hint),
    '',
    '통신사는 막은 이유를 알려 주지 않습니다. 위 내용은 한줄로가 기록과 다시 보낸 결과로 좁힌 것입니다.',
    `로그인하여 고치기: ${base}/agency-send`,
  ].join('\n');
  return { subject: `[한줄로] 문안이 ${names} 스팸 검사에 걸렸습니다`, text };
}
