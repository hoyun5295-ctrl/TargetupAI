/**
 * agency-send-change.ts — 대행발송 접수 조작 CT(문안 수정 · 맞춤법 적용 · 시각 변경) (★2026-10-18 · 설계서 docs/2026-10-16-agency-send-mobile-control-design.md §2 축 1 · 3 · 4)
 *
 * 로그인 화면(`routes/agency-send.ts` 옛 본문 710~885 · 원본 복사로 이동)과 담당자 링크(`routes/agency-approve.ts`)가 **같은 함수**를 지난다.
 * 응답 계약 · 판정 순서는 옛 라우트 그대로: 상태 → 이미 시작된 시도 → 수정 번호 → (문안 검사) → 회신번호 등록 → 맞춤법 컬럼 탐지 → 시도 키 잠금 판정 → CAS UPDATE.
 *   ⛔ 시도 키 잠금 판정과 UPDATE 사이에 다른 대기를 두지 않는다(대행 ⓔ 두 벌 발송 차단 · 옛 주석 그대로).
 * ★ 축 3 맞춤법 적용 = 저장된 제안을 **id 로** 적용(SPELL_STALE · blocked · 겹침 · slice == before · 역순 치환 · 남은 시간 MIN_LEAD 미달 거절).
 * ★ 축 4 `approval_requested_at` = 상태를 바꾸는 바로 그 UPDATE 가 찍는다(문안 수정 = NULL · 시각 변경으로 승인 대기 = NOW()) · 컬럼 탐지로 없으면 쉰다.
 * ⛔ 어긋나면 409 STATE_CHANGED + **지금 행**(화면이 그 값으로 바뀐다 · 최종 검증 2).
 */
import { createHash } from 'crypto';
import pool, { query } from '../config/database';
import { isEditable, isSameKstDay, validateRequestedAt, MIN_LEAD_MINUTES, resumeTwinBlockingSql, type AgencySendStatus } from './agency-send-state';
import { buildSlotPlan, extractAgencyVars } from './agency-send-vars';
import { hasAgencySpellColumn, readAgencySpell } from './agency-send-spell';
import { ATTEMPT_LOCK_PREFIX, attemptBlocksChange, attemptIdleSql } from './agency-send-worker';
import {
  findUnregisteredRequestCallbacks, hasApprovalRequestedColumn, loadSendWindow, logEvent, unregisteredCallbackError, MAX_CONTENT,
} from './agency-send-intake';
import type { SpellIssue } from './spell-check';

export type AgencyChangeResult =
  | { ok: true; row: any; backTo?: AgencySendStatus; timeShifted?: boolean }
  | { ok: false; status: number; error: string; code?: string; current?: any };

const fail = (status: number, error: string, code?: string, current?: any): AgencyChangeResult => ({ ok: false, status, error, ...(code ? { code } : {}), ...(current ? { current } : {}) });

/** 옛 `rejectAlreadyDispatched` 판정 그대로(캠페인 = 새 접수 안내 · 진행 중 시도 = 처리 중 안내) */
function alreadyDispatched(campaignId: any): AgencyChangeResult | null {
  if (!campaignId) return null;
  if (campaignId === 'in_flight') return fail(409, '예약을 처리하는 중입니다. 잠시 후 화면을 새로 고치고 다시 시도해 주세요.', 'ATTEMPT_IN_PROGRESS');
  return fail(400, '이미 발송 준비가 시작된 접수입니다. 발송 결과를 확인하신 뒤 새로 접수해 주세요.', 'ALREADY_DISPATCHED');
}

async function currentRow(requestId: string, companyId: string): Promise<any> {
  const r = await query(`SELECT * FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid`, [requestId, companyId]);
  return r.rows[0] || null;
}

/**
 * (순수) 저장된 맞춤법 제안을 id 로 적용 — 다른 버전 · 없는 id · 잠긴 제안 · 겹침 · 원문 불일치 = 거절(사람이 다시 본다).
 * 역순(뒤에서 앞으로) 치환이라 앞 위치가 밀리지 않는다.
 */
export function applyAgencySpellFixes(content: string, issues: SpellIssue[] | null, ids: string[]):
  { ok: true; content: string } | { ok: false; code: 'SPELL_STALE' | 'SPELL_BLOCKED' | 'SPELL_OVERLAP' | 'SPELL_EMPTY'; error: string } {
  const want = Array.from(new Set((ids || []).map(String))).filter(Boolean);
  if (want.length === 0) return { ok: false, code: 'SPELL_EMPTY', error: '고칠 곳을 골라 주세요.' };
  if (!issues) return { ok: false, code: 'SPELL_STALE', error: '문안이 바뀌어 맞춤법 결과가 달라졌어요. 화면을 새로 고쳐 주세요.' };
  const picked: SpellIssue[] = [];
  for (const id of want) {
    const it = issues.find((x) => x.id === id);
    if (!it) return { ok: false, code: 'SPELL_STALE', error: '문안이 바뀌어 맞춤법 결과가 달라졌어요. 화면을 새로 고쳐 주세요.' };
    if (it.blocked) return { ok: false, code: 'SPELL_BLOCKED', error: '고치면 단문 글자 수를 넘는 곳이 있어 그곳은 고칠 수 없어요.' };
    if (content.slice(it.start, it.end) !== it.before) return { ok: false, code: 'SPELL_STALE', error: '문안이 바뀌어 맞춤법 결과가 달라졌어요. 화면을 새로 고쳐 주세요.' };
    picked.push(it);
  }
  picked.sort((a, b) => a.start - b.start);
  for (let i = 1; i < picked.length; i += 1) {
    if (picked[i].start < picked[i - 1].end) return { ok: false, code: 'SPELL_OVERLAP', error: '겹치는 곳이 있어 한 번에 고칠 수 없어요. 하나씩 골라 주세요.' };
  }
  let out = content;
  for (const it of [...picked].reverse()) out = out.slice(0, it.start) + it.after + out.slice(it.end);
  return { ok: true, content: out };
}

/**
 * 문안 수정 · 맞춤법 적용(축 1 · 3) — 성공하면 status = received(처음부터 다시 검사 · 승인 흔적 지움 · 문안 버전 + 1 → 옛 링크 닫힘).
 * `ownerUserId` = 일반 사용자 = 본인 접수만 · 관리자 · 링크 = null(링크는 토큰이 접수를 정한다).
 */
export async function editAgencyContentTx(input: {
  requestId: string;
  companyId: string;
  ownerUserId: string | null;
  revision: unknown;
  change: { kind: 'text'; content: string; subject?: string | null } | { kind: 'spell'; issueIds: string[] };
  via: 'screen' | 'link';
  actor?: Record<string, unknown>;
  now?: Date;
}): Promise<AgencyChangeResult> {
  let body = '';
  let subject: string | null = null;
  if (input.change.kind === 'text') {
    body = String(input.change.content || '').trim();
    if (!body) return fail(400, '문안을 입력해 주세요.');
    if (body.length > MAX_CONTENT) return fail(400, `문안은 ${MAX_CONTENT}자까지 넣을 수 있습니다.`);
    if (input.change.subject != null) {
      const vars = extractAgencyVars(String(input.change.subject || ''));
      if (vars.length > 0) return fail(400, `제목에는 항목을 넣을 수 없습니다: ${vars.map((v) => `%${v}%`).join(' ')}. 제목은 모든 수신자에게 같은 문장으로 나갑니다.`, 'SUBJECT_VARS');
      subject = String(input.change.subject);
    }
  }
  const r = await query(
    `SELECT * FROM agency_send_requests
      WHERE id = $1::uuid AND company_id = $2::uuid AND ($3::uuid IS NULL OR created_by = $3::uuid)`,
    [input.requestId, input.companyId, input.ownerUserId],
  );
  if (r.rows.length === 0) return fail(404, '접수를 찾을 수 없습니다.');
  const row = r.rows[0];
  if (!isEditable(row.status)) return fail(400, '지금은 문안을 고칠 수 있는 상태가 아닙니다.', undefined, row);
  const dispatched = alreadyDispatched(row.campaign_id);
  if (dispatched) return dispatched;
  const observedRevision = Number(input.revision);
  if (input.revision === undefined || input.revision === null || !Number.isFinite(observedRevision)) return fail(400, '화면을 새로 고친 뒤 다시 시도해 주세요.', 'REVISION_REQUIRED');
  if (input.change.kind === 'spell') {
    if (observedRevision !== Number(row.revision)) return fail(409, '그 사이 상태가 바뀌었습니다. 화면을 새로 고치고 다시 시도해 주세요.', 'STATE_CHANGED', row);
    // 고치면 처음부터 다시 검사 · 승인을 지난다 — 그 시간이 남지 않으면 고치지 않는다(축 3 · 접수 최소 리드타임과 같은 값)
    const now = input.now ?? new Date();
    if ((new Date(row.requested_at).getTime() - now.getTime()) / 60000 < MIN_LEAD_MINUTES) {
      return fail(400, `보낼 시각까지 ${MIN_LEAD_MINUTES}분이 남지 않아 고치면 다시 검사 · 승인할 시간이 없어요. 시각을 먼저 바꿔 주세요.`, 'TOO_LATE');
    }
    const applied = applyAgencySpellFixes(String(row.current_content || ''), readAgencySpell(row), input.change.issueIds);
    if (!applied.ok) return fail(409, applied.error, applied.code, row);
    body = applied.content;
    if (body.length > MAX_CONTENT) return fail(400, `문안은 ${MAX_CONTENT}자까지 넣을 수 있습니다.`);
  }

  const plan = buildSlotPlan(body);
  if (!plan.ok) return fail(400, plan.error || '문안의 항목이 너무 많습니다.', 'TOO_MANY_VARS');
  // 명단은 접수 때 확정됐다. 그때 연결하지 않은 항목을 새로 넣으면 그 자리가 빈칸으로 나간다.
  const known = Object.keys(row.var_mapping || {});
  const unknown = plan.order.filter((v) => !known.includes(v));
  if (unknown.length > 0) {
    return fail(400, `명단에 연결하지 않은 항목이 있습니다: ${unknown.map((v) => `%${v}%`).join(' ')}. 그 부분을 빼거나 새로 접수해 주세요.`, 'UNKNOWN_VARS');
  }
  // ★2026-09-13(3) 회신번호 등록을 고칠 때 다시 본다(판정은 발송 직전과 같은 CT 한 벌)
  const { missing } = await findUnregisteredRequestCallbacks({ id: input.requestId, company_id: row.company_id, created_by: row.created_by, callback_number: row.callback_number });
  if (missing.length > 0) return fail(400, unregisteredCallbackError(missing), 'CALLBACK_UNREGISTERED');

  // ⛔ 컬럼 탐지는 차단 판정 **앞**에서 한다 — 판정과 UPDATE 사이에 다른 대기를 끼우지 않는다(옛 라우트 ⛔ 대행 ⓔ)
  const clearSpell = (await hasAgencySpellColumn()) ? 'spell_check = NULL, ' : '';
  const clearAsk = (await hasApprovalRequestedColumn()) ? 'approval_requested_at = NULL, ' : '';
  const blocked = alreadyDispatched(await attemptBlocksChange(input.companyId, input.requestId, row.dispatch_key));
  if (blocked) return blocked;
  const updated = await query(
    `UPDATE agency_send_requests
        SET ${clearSpell}${clearAsk}original_content = $1, current_content = $1, content_version = content_version + 1,
            status = 'received', test_round = 0, last_test_result = NULL, last_test_at = NULL,
            approved_at = NULL, approved_by = NULL, approval_version = NULL, final_test_at = NULL,
            dispatch_key = NULL, campaign_id = NULL,
            subject = COALESCE($2, subject), expired_at = NULL,
            lock_at = NULL, lock_token = NULL, revision = revision + 1, updated_at = NOW()
      WHERE id = $3::uuid AND company_id = $4::uuid AND revision = $5
        AND campaign_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.staging_id = agency_send_requests.dispatch_key AND c.company_id = agency_send_requests.company_id)${attemptIdleSql(6)}
      RETURNING *`,
    [body, subject, input.requestId, input.companyId, observedRevision, ATTEMPT_LOCK_PREFIX],
  );
  if (updated.rows.length === 0) {
    return fail(409, '그 사이 상태가 바뀌었습니다. 화면을 새로 고치고 다시 시도해 주세요.', 'STATE_CHANGED', await currentRow(input.requestId, input.companyId));
  }
  await logEvent(input.requestId, 'content_edited', {
    version: updated.rows[0]?.content_version, via: input.via,
    ...(input.change.kind === 'spell' ? { spellFixed: input.change.issueIds.length } : {}),
    ...(input.actor || {}),
  });
  return { ok: true, row: updated.rows[0] };
}

/**
 * 같은 문안 · 같은 명단으로 아직 진행 중인 **다른** 접수(최종 검증 6 · 메일 워커 3층 대조와 같은 차단 집합 · 자기 자신 제외).
 * 만료 건을 새 시각으로 다시 진행할 때 이미 다시 접수된 같은 발송이 있으면 두 벌로 나가지 않게 막는다.
 */
export async function findBlockingTwinRequest(
  companyId: string, requestId: string, originalContent: string,
  q: (text: string, params?: any[]) => Promise<any> = query,
): Promise<{ id: string; requestedAt: string | null } | null> {
  // ★ Codex D 1R — 명단 비교까지 SQL 안에서 한 뒤 LIMIT(옛: 같은 문안 다섯 건을 먼저 자르고 비교해 여섯 번째 쌍둥이를 놓쳤다)
  const r = await q(
    `SELECT r.id, r.requested_at FROM agency_send_requests r
      WHERE r.company_id = $1::uuid AND r.id <> $2::uuid AND r.original_content = $3 AND ${resumeTwinBlockingSql('r')}
        AND COALESCE((SELECT array_agg(x.phone ORDER BY x.phone) FROM agency_send_recipients x WHERE x.request_id = r.id), '{}')
          = COALESCE((SELECT array_agg(y.phone ORDER BY y.phone) FROM agency_send_recipients y WHERE y.request_id = $2::uuid), '{}')
      ORDER BY r.requested_at
      LIMIT 1`,
    [companyId, requestId, originalContent],
  );
  const c = r.rows[0];
  return c ? { id: String(c.id), requestedAt: c.requested_at ? new Date(c.requested_at).toISOString() : null } : null;
}

/**
 * 시각 변경(축 1 · 4) — 검사를 통과한 건 = 승인 대기(승인 요청 시각 = 지금 · 24시간 다시 시작) · 검사에서 막힌 건 = 처음부터.
 * 만료 건을 다시 진행할 때는 같은 문안 · 명단의 진행 중 접수가 없어야 한다(두 벌 발송 차단).
 */
export async function rescheduleAgencyRequestTx(input: {
  requestId: string;
  companyId: string;
  ownerUserId: string | null;
  revision: unknown;
  requestedAt: unknown;
  via: 'screen' | 'link';
  actor?: Record<string, unknown>;
}): Promise<AgencyChangeResult> {
  const r = await query(
    `SELECT * FROM agency_send_requests
      WHERE id = $1::uuid AND company_id = $2::uuid AND ($3::uuid IS NULL OR created_by = $3::uuid)`,
    [input.requestId, input.companyId, input.ownerUserId],
  );
  if (r.rows.length === 0) return fail(404, '접수를 찾을 수 없습니다.');
  const row = r.rows[0];
  if (!isEditable(row.status)) return fail(400, '지금은 시각을 고칠 수 있는 상태가 아닙니다.', undefined, row);
  const dispatched = alreadyDispatched(row.campaign_id);
  if (dispatched) return dispatched;
  const observedRevision = Number(input.revision);
  if (input.revision === undefined || input.revision === null || !Number.isFinite(observedRevision)) return fail(400, '화면을 새로 고친 뒤 다시 시도해 주세요.', 'REVISION_REQUIRED');

  const when = validateRequestedAt(input.requestedAt, new Date(), await loadSendWindow(input.companyId, !!row.is_ad));
  if (!when.valid) return fail(400, when.error || '보낼 시각을 다시 골라 주세요.');

  // 문안은 그대로다. 검사를 이미 통과한 건이면 승인 대기로 돌려보내고, 아니면 검사부터 다시 한다(옛 라우트 그대로).
  const backTo: AgencySendStatus = row.status === 'test_failed' ? 'received' : 'awaiting_approval';
  // `final_test_at` = 새 시각이 그 검사와 같은 날이면 남긴다(★2026-08-23(2) 같은 날 두 번 검사하지 않는다) · received 로 가면 지운다
  const priorFinalTest = row.final_test_at ? new Date(row.final_test_at) : null;
  const keepFinalTest = backTo === 'awaiting_approval' && !!priorFinalTest && !!when.at && isSameKstDay(priorFinalTest, when.at);

  const { missing } = await findUnregisteredRequestCallbacks({ id: input.requestId, company_id: row.company_id, created_by: row.created_by, callback_number: row.callback_number });
  if (missing.length > 0) return fail(400, unregisteredCallbackError(missing), 'CALLBACK_UNREGISTERED');
  // ⛔ 컬럼 탐지는 차단 판정 앞(판정과 UPDATE 사이에 다른 대기 0)
  const askCol = await hasApprovalRequestedColumn();
  const askSet = askCol ? (backTo === 'awaiting_approval' ? 'approval_requested_at = NOW(), ' : 'approval_requested_at = NULL, ') : '';
  // ★ Codex D 1R — 만료 건 다시 진행은 (회사 · 문안) 잠금 아래 한 트랜잭션에서 쌍둥이 확인 → 갱신(동시에 두 쌍둥이를 되살리면 둘 다 통과하던 틈)
  const resuming = row.status === 'expired';
  const client = resuming ? await pool.connect() : null;
  const q = (text: string, params?: any[]) => (client ? client.query(text, params) : query(text, params));
  let saved: any;
  let committed = false;
  let stale = false;
  try {
    if (client) {
      await client.query('BEGIN');
      const key = createHash('sha256').update(`${input.companyId}|${String(row.original_content || '')}`).digest('hex');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`agency-twin:${key}`]);
      const twin = await findBlockingTwinRequest(input.companyId, input.requestId, String(row.original_content || ''), q);
      if (twin) return fail(409, '같은 문안 · 같은 명단으로 진행 중인 다른 접수가 있어 다시 진행하지 않았어요. 그 접수를 확인해 주세요.', 'DUPLICATE_IN_PROGRESS', row);
    }
    const blocked = alreadyDispatched(await attemptBlocksChange(input.companyId, input.requestId, row.dispatch_key, q));
    if (blocked) return blocked;
    const updated = await q(
      `UPDATE agency_send_requests
        SET ${askSet}requested_at = $1, status = $2, expired_at = NULL,
            approved_at = NULL, approved_by = NULL, approval_version = NULL,
            final_test_at = $6,
            dispatch_key = NULL, campaign_id = NULL, lock_at = NULL, lock_token = NULL,
            revision = revision + 1, updated_at = NOW()
      WHERE id = $3::uuid AND company_id = $4::uuid AND revision = $5
        AND campaign_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.staging_id = agency_send_requests.dispatch_key AND c.company_id = agency_send_requests.company_id)${attemptIdleSql(7)}
      RETURNING *`,
      [when.at, backTo, input.requestId, input.companyId, observedRevision, keepFinalTest ? priorFinalTest : null, ATTEMPT_LOCK_PREFIX],
    );
    if (updated.rows.length === 0) {
      stale = true;
    } else {
      if (client) { await client.query('COMMIT'); committed = true; }
      saved = updated.rows[0];
    }
  } finally {
    // 커밋 못 한 갈래(쌍둥이 · 차단 · 0행 · 오류) = 여기서 한 번 되돌린다(열린 트랜잭션을 풀에 돌려주지 않는다)
    if (client && !committed) await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    client?.release();
  }
  // 0행 응답의 지금 행은 연결을 돌려준 **뒤에** 읽는다(★ Codex D 2R · 쥔 채 풀에서 또 꺼내면 동시 재진행이 풀을 말린다)
  if (stale) return fail(409, '그 사이 상태가 바뀌었습니다. 화면을 새로 고치고 다시 시도해 주세요.', 'STATE_CHANGED', await currentRow(input.requestId, input.companyId));
  // 커밋 뒤 = 이력만(실패해도 바뀐 시각은 그대로 · logEvent 는 오류를 삼킨다)
  return afterReschedule(input, saved, backTo, when, keepFinalTest);
}

async function afterReschedule(
  input: { requestId: string; via: 'screen' | 'link'; actor?: Record<string, unknown> }, row: any, backTo: AgencySendStatus,
  when: ReturnType<typeof validateRequestedAt>, keepFinalTest: boolean,
): Promise<AgencyChangeResult> {
  await logEvent(input.requestId, 'rescheduled', {
    requestedAt: when.at?.toISOString(), status: backTo, keepFinalTest, via: input.via,
    ...(when.shifted ? { timeShifted: true, originalAt: when.originalAt?.toISOString() } : {}),
    ...(input.actor || {}),
  });
  return { ok: true, row, backTo, ...(when.shifted ? { timeShifted: true } : {}) };
}
