/**
 * agency-spam-diag.ts — 대행발송 스팸 검사 루프의 「닿는 글 찾기」(★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §7
 *   ★2026-11-26 C164 재작성 · 설계서 docs/2026-11-25-spam-diag-rewrite-design.md §8 · §9-2)
 *
 * 문안 버전에서 처음 막힌 글(T)에 「표현을 바꾼 글」 판을 걸고, 루프 안에서 기다리지 않고 접수를 받기 전 상태로 돌려 둔다(진단 대기 · last_test_result.diagHold).
 * 다음 주기에 그 판의 확정 결과로 갈래를 정한다: 대기 / 다음 판(주소도 바꾼 글 · 새로 쓴 글 = 화면 앞에 고객이 없어 자동 · 동의 = 승인 문자 1클릭) /
 *   찾음(막힌 통신사 전부 도착 = 그 바꿈을 이 버전 글에 넣은 글로 3사 일반 검사 · last_test_result.diagFix) /
 *   4c(못 찾음 · 확인 못 함 · 30분 넘음 = 지금처럼 다듬기) / 통과(대기 사이 늦은 보고로 T 통과).
 * 어느 갈래든 진단 대기를 지우고 진단을 닫은 뒤(한 트랜잭션 · 찾음이면 같은 트랜잭션에 diagFix) 루프가 이어 간다.
 *   「주소를 바꿔 주세요」로 멈추던 갈래(4a)는 없다 — 주소는 우리가 같은 곳으로 가는 짧은 주소로 바꿔 본다.
 * ⛔ 진단은 부가 동작이다(fail-open) — 힌트 · 판 읽기 · 판 등록이 던지면 4c 와 같다. 일반 검사의 판정 · 장애 셈 · 보류는 건드리지 않는다.
 * ⛔ 찾은 판의 도착은 T 의 통과가 아니다 — 찾은 글은 반드시 3사 일반 검사를 거친 뒤에만 승인 문자로 간다.
 */
import pool, { query } from '../config/database';
import { readSpamTestOutcome } from './spam-test-queue';
import { classifyRewrite, applySpamFixes, type PlateKind } from './spam-block-hint';
import {
  buildSpamBlockHints, advanceRewrite, rewriteStepOf, closeDiagnosis, readDiagParent, readPlates, plateStatesOf, triedPlatesLine, diagSentText, spamHintLine, markedTemplateLines,
  hasDiagColumn, hasPlanColumn,
} from './spam-diag';
import { swappableUrls } from './spam-link-swap';
import { customShortLinkUrl } from './dm/dm-custom-short-link';
import { sampleRendererOf } from './agency-send-preview';
import { SPAM_DIAG_SOURCE } from './spam-trial';
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
/** 찾은 글(이 문안 버전의 글에 바꿈을 넣은 글) — 그 버전 첫 3사 일반 검사의 시작 글 · 장애로 돌아가도 이어받는다(§9-2) */
export interface DiagFix { version: number; content: string; plateTestId: string; rounds: number }
export type DiagStep =
  | { kind: 'wait' }
  | { kind: 'pass' }
  | { kind: 'found'; content: string; plateTestId: string }
  | { kind: '4c'; sentence: string };

/** (순수) 지금 문안 버전의 진단 대기 표시 · 다른 버전이면 없음 */
export function diagHoldOf(row: { last_test_result?: any; content_version?: any }): DiagHold | null {
  const h = row.last_test_result && typeof row.last_test_result === 'object' ? row.last_test_result.diagHold : null;
  if (!h || Number(h.version) !== Number(row.content_version || 0) || typeof h.parentTestId !== 'string' || typeof h.content !== 'string') return null;
  return { parentTestId: h.parentTestId, version: Number(h.version), content: h.content, rounds: Number(h.rounds) || 1, startedAt: String(h.startedAt || '') };
}

/** (순수) 지금 문안 버전의 찾은 글 · 다른 버전이면 없음(취소 · 만료 · 문안 수정 뒤 남은 값은 아무 길에서도 쓰이지 않는다) */
export function diagFixOf(row: { last_test_result?: any; content_version?: any }): DiagFix | null {
  const f = row.last_test_result && typeof row.last_test_result === 'object' ? row.last_test_result.diagFix : null;
  if (!f || Number(f.version) !== Number(row.content_version || 0) || typeof f.content !== 'string' || !f.content.trim()) return null;
  return { version: Number(f.version), content: f.content, plateTestId: String(f.plateTestId || ''), rounds: Number(f.rounds) || 1 };
}

/**
 * (순수) 결과 칸에 진단 대기를 얹거나(hold) 지운 값(null) · 남는 것이 없으면 null — heldResultJson 과 같은 꼴(대기를 얹으면 검사 중 후보는 지운다).
 *   fix = 찾은 글을 함께 얹는다(진단을 닫는 같은 저장). 그 밖의 키(이미 있는 diagFix 포함)는 그대로 둔다.
 */
export function diagHoldJson(row: { last_test_result?: any }, hold: DiagHold | null, fix?: DiagFix | null): string | null {
  const prev: Record<string, any> = row.last_test_result && typeof row.last_test_result === 'object' && !Array.isArray(row.last_test_result) ? { ...row.last_test_result } : {};
  delete prev.diagHold;
  if (hold) delete prev.heldCandidate;
  const next = { ...prev, ...(hold ? { diagHold: hold } : {}), ...(fix ? { diagFix: fix } : {}) };
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
  await run(`INSERT INTO agency_send_events (request_id, kind, payload) VALUES ($1::uuid, $2, $3::jsonb)`, [requestId, SPAM_HINT_EVENT, JSON.stringify(payload)]);
}

/**
 * ★ 배포 2 Codex 1R — 판 등록의 부르는 쪽 조건(부모 진단 잠금 아래 · enqueueSpamTest diag.guard): 이 워커가 아직 그 접수를 쥐고(선점 토큰) 같은 문안 버전이다.
 *   결과 칸에 진단 대기가 있으면 그 T 의 대기여야 한다(다른 검사의 진단이 진행 중이면 등록 0). 대기가 없는 것은 막지 않는다 —
 *   첫 판 등록 때와, 첫 판 등록 뒤 대기를 저장하기 전에 죽어 판에서 되찾은 대기(★ Codex 구현 1R · 결과 칸에는 아직 없다)가 그 꼴이다.
 *   문안 수정은 토큰을 지우고 버전을 올려 거짓이 되고, 닫힌 진단은 판 행의 닫힘 표시를 등록이 같은 잠금 아래에서 본다(spam-diag registerPlate).
 */
function regGuard(row: any, version: number, parentTestId: string) {
  return async (run: SqlRun): Promise<boolean> => {
    const r = await run(
      `SELECT 1 FROM agency_send_requests WHERE id = $1::uuid AND lock_token = $2::uuid AND content_version = $3
          AND COALESCE(last_test_result -> 'diagHold' ->> 'parentTestId', $4) = $4`,
      [row.id, row.lock_token, version, parentTestId],
    );
    return r.rows.length > 0;
  };
}

/** 그 접수의 실물 조립기(검사 글 T 를 만든 것과 같은 조립 · 못 만들면 null) — 판 글이 「바꿈을 넣은 글의 조립」과 글자 그대로 같은지 보는 데 쓴다 */
async function agencyRender(row: any): Promise<(content: string) => string | null> {
  const render = await sampleRendererOf(row);
  return (content) => { try { return render(content); } catch { return null; } };
}

/**
 * T 가 막혔다 — 이 버전 첫 막힘이고 발송까지 2시간 이상이면 첫 판(표현을 바꾼 글)을 막힌 통신사 전부로 한 판 등록한다.
 *   등록했으면 진단 대기(hold)를 돌려준다(부르는 쪽 = 다듬지 않고 접수를 받기 전 상태로) · 없으면 null(지금처럼 다듬기).
 *   판 행에 소유(agency) · 접수 · 버전 · 회차를 싣는다(소유가 사건보다 먼저 행에 선다 · 대기 저장 전에 죽어도 되찾는다 = recoverAgencyHold).
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
    let sentTo: string[] = [];
    // 이미 판이 있는 검사(사람이 화면에서 찾기를 누른 같은 날 같은 글)는 그쪽 소유 = 대행은 판을 더하지 않는다
    if (hint && hint.plates.length === 0) {
      const template = { body: content, subject: hint.parent.subject };
      const s = rewriteStepOf(hint, 'agency', template);
      if (s.editable.length > 0) {
        const render = await agencyRender(row);
        const r = await advanceRewrite({
          hint, owner: 'agency', actorUserId: String(row.created_by || ''), candidates: ['w1'], template, editable: s.editable, render,
          agency: { requestId: String(row.id), version, rounds }, guard: regGuard(row, version, parentTestId),
        }).catch((e: any) => { console.warn(`${LOG} 판 등록 실패 request=${row.id}:`, e?.message || e); return null; });
        if (r?.ok) sentTo = hint.carriers.map((c) => c.carrier);
      }
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
 * ★ 1126 C164 §8 — 진단 대기 되찾기. 첫 판을 등록한 뒤 대기를 저장하기 전에 죽었으면 접수의 결과 칸에는 대기가 없고 판만 있다.
 *   그 접수 · 지금 문안 버전의 대행 소유 판이 있고 닫히지 않았으면 그 판으로 대기를 되살린다(대기 글 = 판에 저장한 원문 · 시작 시각 = 첫 판을 만든 시각 → 30분 상한이 그대로 걸린다).
 *   읽기만 한다(행 잠금 0) · 저장은 부르는 쪽의 토큰 기반 대기 저장 길.
 */
export async function recoverAgencyHold(row: any): Promise<DiagHold | null> {
  if (!(await hasDiagColumn()) || !(await hasPlanColumn())) return null;
  const version = Number(row.content_version || 0);
  const r = await query(
    `SELECT t.diag_of, t.created_at, t.diag_plan FROM spam_filter_tests t
      WHERE t.diag_of IS NOT NULL AND t.source = '${SPAM_DIAG_SOURCE}' AND t.variant_id = 'R1'
        AND t.diag_plan -> 'agency' ->> 'requestId' = $1 AND t.diag_plan -> 'agency' ->> 'version' = $2
      ORDER BY t.created_at DESC LIMIT 1`,
    [String(row.id), String(version)],
  );
  const x = r.rows[0];
  if (!x || x.diag_plan?.closed || x.diag_plan?.owner !== 'agency' || typeof x.diag_plan?.template?.body !== 'string') return null;
  return {
    parentTestId: String(x.diag_of), version, content: x.diag_plan.template.body, rounds: Number(x.diag_plan.agency?.rounds) || 1,
    startedAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at),
  };
}

/**
 * 판정 — T 의 지금 결과 · 판의 확정 결과로 갈래. run 한 연결만 쓴다(풀 · 규칙 캐시 0).
 *   다음 판이 필요하면(next) 여기서 갈래만 알리고, 판 글 만들기(AI) · 등록은 stepAgencyDiag 가 한다.
 */
async function decide(hold: DiagHold, run: SqlRun): Promise<DiagStep | { kind: 'next'; candidates: PlateKind[] }> {
  const outcome = await readSpamTestOutcome(hold.parentTestId, run);
  if (outcome.outcome === 'pass') return { kind: 'pass' };
  const blocked = [...new Set(outcome.carrierResults.filter((r) => r.result === 'blocked').map((r) => r.carrier))].sort();
  if (outcome.outcome !== 'blocked' || blocked.length === 0) return { kind: '4c', sentence: '' };
  const parent = await readDiagParent(hold.parentTestId, run);
  const plates = parent ? await readPlates(hold.parentTestId, run) : [];
  if (!parent || plates.length === 0 || plates.some((p) => p.plan.owner !== 'agency')) return { kind: '4c', sentence: '' };
  const hasUrl = swappableUrls(diagSentText(parent).sentText, plates[0].plan.editable).length > 0;
  const step = classifyRewrite({ plates: plateStatesOf(plates), owner: 'agency', hasUrl });
  if (step.kind === 'wait') return { kind: 'wait' };
  if (step.kind === 'next') return { kind: 'next', candidates: step.candidates };
  if (step.kind === 'found') {
    // 찾은 판의 바꿈(본문만 · 대행은 제목을 바꾸지 않는다)을 이 문안 버전의 글에 넣는다 — 못 넣으면 4c
    const plan = plates[step.plate].plan;
    const applied = applySpamFixes({ body: hold.content, subject: null }, { body: plan.template.body, subject: null }, plan.fixes.filter((f) => f.field === 'body'));
    if (applied.ok && applied.body !== hold.content) return { kind: 'found', content: applied.body, plateTestId: plates[step.plate].testId };
  }
  return { kind: '4c', sentence: triedPlatesLine(plates, true) };
}

const clipLine = (l: string) => { const t = l.trim(); return t.length > 40 ? `${t.slice(0, 40)}…` : t; };
/** 승인 문자에 줄마다 싣는 바꿈 수 상한(그 밖은 한 줄로 수만) */
const FIX_LINES_MAX = 5;

/**
 * (순수) 승인 문자의 「바꾼 곳」 줄(설계서 §9-2 · §10-2 정본 문구 · 합니다체) — 고객이 낸 글과 통과해 저장한 글의 줄 대조.
 *   바꿈 목록이 아니라 실제 승인 대상 글로 만든다(찾은 글이 다시 막혀 다듬은 글이 통과해도 줄 = 나갈 글). 줄 수가 같을 때만 줄마다 「원래 → 바꾼」.
 *   글이 같으면 빈 목록(줄 없음).
 */
export function agencyFixLines(original: string, final: string): string[] {
  if (original === final) return [];
  const a = String(original || '').split('\n');
  const b = String(final || '').split('\n');
  const out = ['스팸 검사에 걸려 아래처럼 바꿨습니다. 승인하시면 바꾼 글로 보냅니다.'];
  if (a.length === b.length) {
    const pairs = a.map((l, i) => [l, b[i]] as const).filter(([x, y]) => x !== y);
    for (const [x, y] of pairs.slice(0, FIX_LINES_MAX)) out.push(`${clipLine(x)} → ${clipLine(y)}`);
    if (pairs.length > FIX_LINES_MAX) out.push(`그 밖에 ${pairs.length - FIX_LINES_MAX}곳을 더 바꿨습니다.`);
  }
  const shortBase = customShortLinkUrl('');
  if (shortBase && final.includes(shortBase) && !original.includes(shortBase)) out.push('글 속 주소는 같은 곳으로 가는 한줄로 짧은 주소로 바꿨습니다.');
  return out;
}

/** 진단 대기 이어 보기(다음 주기 · 잠금 없이) — 다음 판이 필요하면 만들어 등록하고 대기 · 30분 넘으면 4c · 던지면 4c(fail-open) */
export async function stepAgencyDiag(row: any, hold: DiagHold, now = new Date()): Promise<DiagStep> {
  try {
    const d = await decide(hold, query);
    const started = Date.parse(hold.startedAt);
    const overdue = Number.isFinite(started) && now.getTime() - started > DIAG_HOLD_MAX_MINUTES * 60_000;
    if (d.kind === 'next') {
      const h = overdue ? null : await buildSpamBlockHints(hold.parentTestId, { templateText: hold.content });
      const s = h ? rewriteStepOf(h, 'agency') : null;
      if (!h || !s || s.step.kind !== 'next' || !s.template) return { kind: '4c', sentence: h ? spamHintLine(h, true) : '' };
      const render = await agencyRender(row);
      const r = await advanceRewrite({
        hint: h, owner: 'agency', actorUserId: String(row.created_by || ''), candidates: s.step.candidates, template: s.template, editable: s.editable, render,
        agency: { requestId: String(row.id), version: hold.version, rounds: hold.rounds }, guard: regGuard(row, hold.version, hold.parentTestId), markEnded: true,
      });
      return r.ok ? { kind: 'wait' } : { kind: '4c', sentence: spamHintLine(h, true) };
    }
    if (d.kind === 'wait' && overdue) return { kind: '4c', sentence: '' };
    return d;
  } catch (err: any) {
    console.warn(`${LOG} 진단 대기 읽기 실패(4c) request=${row.id}:`, err?.message || err);
    return { kind: '4c', sentence: '' };
  }
}

/**
 * ★ 2026-11-24 「그대로 보낼 수 있음」 표식 — 당일 근거 = 보낼 글을 본 검사 행의 시각(spam_filter_tests.created_at · 큐가 같은 날 같은 키를 이어 봤으면 그 검사의 시각).
 *   보낼 글이 첫 회차 글이 아니거나(다듬은 글만 막힘) 검사 행 시각이 없으면 submittedTested = false(당일 검사 끝으로 세지 않는다).
 *   (순수 · 읽기 0) 시각은 부르는 쪽이 이미 읽은 행에서 넘긴다 = 따로 읽기가 막힘 처리를 멈추는 길 0(Codex 구현 5R ~ 8R).
 */
export function spamOverrideMarker(version: number, submitted: string, firstTest: { content: string; createdAt?: string | Date | null } | null | undefined) {
  const raw = firstTest && firstTest.content === submitted ? firstTest.createdAt : null;
  const at = raw ? new Date(raw) : null;
  const ok = !!at && Number.isFinite(at.getTime());
  return { version, submitted, checkedAt: (ok ? at! : new Date()).toISOString(), submittedTested: ok };
}

/** 갈래를 정한 뒤(통과 · 찾음 · 4c) — 진단 대기를 지우고 진단을 닫는다(한 트랜잭션 · 접수 행 → 진단 잠금 순 · 찾음이면 lastTestResult 에 찾은 글이 함께 실린다) · 소유권을 잃었으면 false */
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
