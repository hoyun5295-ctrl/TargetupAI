/**
 * planner-recheck.ts — 플래너 쌍 재확인 CT (★ 2026-10-18 · 설계서 docs/2026-10-18-planner-v2-design.md §3-2 · 담당자 원클릭 링크 회의 수렴)
 *
 * 한 달치를 짜 둔 행사가 발송 당일(또는 승인 직후 실주소 검사에서) 스팸에 막혀도 **그 쌍(문자 + 같은 날 DM)만** 다시 정한다.
 * 진입은 `planner-review.enterPairRecheck`(되돌림 CT 옆) · 여기는 그 뒤 = 새 문안 준비 · 고친 글 검사 · 통지 링크 · 마감 ·
 * 담당자 행동(보내기 · 직접 고치기 · 미루기 · 건너뛰기) · 화면 본문(링크 · PC 할 일이 같은 함수).
 *
 * ⛔ 불변
 *   - 행사 승인 · 다른 접점의 승인 각인은 건드리지 않는다. 쌍 행동은 전부 「행사 live + 쌍 planned + 같은 round + 마감 전」(회의론자 B2 · B4).
 *   - 승인 CT 와 같은 잠금 순서(월 원장 → 행사 → 접점) · 쓰기는 읽어 둔 recheck · copy 와 같을 때만(CAS · 그 사이 바뀌면 409 + 최신 화면).
 *   - 사람 고친 글 보존 — 새 문안은 `recheck.proposal` 로 따로 두고, 고른 쪽만 copy 가 된다(B3 · 행사 리비전 · 상태 그대로).
 *   - 새 문안 = AI 1회(회사 부담 · 크레딧 묶음 · 원가 0) + 실주소 DM 링크 검사(재생성 2회) · 하루 1회 · 혜택이 빠지거나 원문에 없던 숫자가 생기면 버린다.
 *   - 통지 = 받는 사람 하나를 `pickOperatorFallbackContact` 가 정한다 → 그 번호로 보내고 그 계정을 기록한다(B8 · 링크 권한의 주인).
 *   - 링크 인증 = 기기에 묶인 세션(sender-auth `checkStrictSenderAuth` · B5) · 통과로 접는 앞단 없음 · 회사 스위치(PLANNER_LINK_APPROVE_COMPANY_IDS) 빈 값 = 링크 보내기 닫힘.
 *   - 승인 직후 즉시 실행은 이 파일이 하지 않는다(실행부 순환 import 금지) — 라우트가 `kickPlannerTouchpointNow`(실행부 · 발송 시간대 안에서만 · B1)를 부른다.
 *   - 고객 문장은 사유 사전(planner-reasons) · 원문 오류는 로그에만 · 줄표 0.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { pool, query } from '../config/database';
import { SEND_HOURS } from '../config/defaults';
import { isSendableHourKst, hasUneditedBenefitPlaceholder } from './autosend-policy';
import { buildAdMessage, getOpt080Number } from './messageUtils';
import { getCreditCost } from './ai-credit-calc';
import { getDmDetail } from './dm/dm-builder';
import { renderDmViewerHtml } from './dm/dm-viewer';
import { maskPhone } from './mfa';
import { isStrictSenderAuthAlive } from './sender-auth';
import { normalizePhone } from './normalize-phone';
import { pickOperatorFallbackContact, notifyOperatorAdmins } from './continuous-operator';
import {
  PlannerTouchpointRow, loadEventTouchpoints, loadTouchpointById, loadAllLiveTouchpoints, notifyPlanner,
  guardPlannerMetaOrSkip, setTouchpointMetaIfCopyIs,
} from './planner-touchpoint';
import { PLANNER_NOTICE_HEADER, PLANNER_SEND_SOURCE, addDays, appendDmLink, kstDateString, resolveAudienceMode } from './planner-execution';
import { PlannerEventRow, loadPlannerEvent, firstSendDate } from './planner-event';
import { PLANNER_APPROVAL_DEADLINE_HOUR, computeTouchpointFingerprints } from './planner-confirm';
import {
  PlannerCopy, PLANNER_COPY_MAX, EDITED_COPY_SPAM_FAILED, carrierGroups, copyInputHash, generatePlannerCopyText,
  loadPlannerCompanyContext, loadPlannerDefaultCallback, spamCheckPlannerVerdict, stripDmLink,
} from './planner-copy';
import { isPastApprovalDeadline } from './planner-approve';
import { countPlannerAudience, PlannerAudienceCount } from './planner-audience';
import { firstBlockedChannel } from './planner-channel-gate';
import { formatPlannerDay, recheckPastDeadlineNotice, settleEventIfFinished } from './planner-review';
import { PLANNER_REASON } from './planner-reasons';
import { tryAcquireInflight, releaseInflight } from './inflight-lock';

// ── 모양 ─────────────────────────────────────────────────────────────
export interface PlannerRecheckMeta {
  round: number;
  /** 이 쌍의 발송 날짜(KST) — 마감 = 그 날 20시 */
  date: string;
  origin: 'send_day' | 'post_approval' | 'deferred';
  at: string;
  deferredFrom?: string | null;
  /** 실주소 링크로 검사를 통과한 새 문안(링크 없이 저장 · 발송 때 붙는다) */
  proposal?: { text: string; subject: string; checkedAt: string } | null;
  /** 새 문안을 마지막으로 만들어 본 날(KST · 하루 1회) */
  proposalTried?: string | null;
  proposalError?: 'failed' | 'unsafe' | 'blocked' | null;
  notifiedAt?: string | null;
  notifiedUserId?: string | null;
  tokenHash?: string | null;
  tokenExpiresAt?: string | null;
  remindedAt?: string | null;
}

export interface RecheckPair {
  ev: PlannerEventRow;
  carrier: PlannerTouchpointRow;
  dm: PlannerTouchpointRow | null;
  /** 그 행사의 접점 전부(지문 계산 · 남은 발송) */
  all: PlannerTouchpointRow[];
  recheck: PlannerRecheckMeta;
}

export class PlannerRecheckError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
    this.name = 'PlannerRecheckError';
  }
}

const LIVE_EVENT = ['approved', 'producing', 'scheduled'];
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const pairIds = (p: RecheckPair) => [p.carrier.id, ...(p.dm ? [p.dm.id] : [])];
const withDmLinkOf = (p: RecheckPair) => !!p.dm || p.carrier.channel === 'dm';
const dmUrlOf = (p: RecheckPair) => String(p.carrier.execMeta?.dm_url || p.dm?.execMeta?.dm_url || '');
const kstHour = (now: Date) => new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();

/** 쌍 1건(캐리어 id 기준) — 캐리어에 recheck 가 없으면 null. */
export async function loadRecheckPair(companyId: string, carrierId: string): Promise<RecheckPair | null> {
  const tp = await loadTouchpointById(companyId, carrierId);
  if (!tp) return null;
  const all = await loadEventTouchpoints(companyId, tp.eventId);
  const g = carrierGroups(all).find((x) => x.carrier.id === carrierId);
  if (!g) return null;
  const recheck = g.carrier.execMeta?.recheck;
  if (!recheck || typeof recheck !== 'object' || !Number(recheck.round)) return null;
  const ev = await loadPlannerEvent(companyId, tp.eventId);
  if (!ev) return null;
  return { ev, carrier: g.carrier, dm: g.dm, all, recheck: recheck as PlannerRecheckMeta };
}

/** 쌍이 지금 정할 수 있는 상태인가 — 승인 · 건너뛰기 · 고치기 · 미루기가 같은 조건(B2). */
function assertPairOpen(p: RecheckPair, round: number, now: Date): void {
  if (!LIVE_EVENT.includes(p.ev.status)) throw new PlannerRecheckError(409, 'NOT_OPEN', '행사 상태가 바뀌어 지금은 정할 수 없습니다. 화면을 새로고침해 주세요.');
  if (p.carrier.status !== 'planned' || (p.dm && p.dm.status !== 'planned')) {
    throw new PlannerRecheckError(409, 'CHANGED', '그 사이 처리 상태가 바뀌었습니다. 화면을 새로 불러왔어요.');
  }
  if (Number(p.recheck.round) !== Number(round) || (p.dm && Number(p.dm.execMeta?.recheck?.round) !== Number(round))) {
    throw new PlannerRecheckError(409, 'CHANGED', '그 사이 내용이 바뀌었습니다. 화면을 새로 불러왔어요.');
  }
  if (p.recheck.date !== p.carrier.scheduledOn) throw new PlannerRecheckError(409, 'CHANGED', '그 사이 날짜가 바뀌었습니다. 화면을 새로 불러왔어요.');
  if (isPastApprovalDeadline(p.recheck.date, now)) {
    throw new PlannerRecheckError(409, 'DEADLINE_PASSED', `마감(${PLANNER_APPROVAL_DEADLINE_HOUR}시)이 지나 이 날 발송은 정할 수 없습니다.`);
  }
}

// ── 문안 · 지문 ──────────────────────────────────────────────────────
function currentInputHash(p: RecheckPair): string {
  return copyInputHash(p.ev, { timing: p.carrier.timing, scheduledOn: p.carrier.scheduledOn, withDmLink: withDmLinkOf(p) });
}

/** 고른 쪽 문안 — proposal(새 문안) 또는 current(이 회차에 실주소로 검사 통과한 지금 글). 고를 수 없으면 null. */
function chosenCopy(p: RecheckPair, choice: 'proposal' | 'current'): PlannerCopy | null {
  const inputHash = currentInputHash(p);
  if (choice === 'proposal') {
    const pr = p.recheck.proposal;
    if (!pr?.text) return null;
    return { text: pr.text, subject: pr.subject || '', inputHash, spam: 'pass', checkedAt: pr.checkedAt, withDmLink: withDmLinkOf(p), recheckRound: Number(p.recheck.round) };
  }
  const c = p.carrier.execMeta?.copy as PlannerCopy | undefined;
  if (!c?.text || c.spam !== 'pass' || c.inputHash !== inputHash || Number(c.recheckRound) !== Number(p.recheck.round)) return null;
  return c;
}

/** 고른 문안으로 다시 낸 쌍 지문 — 승인 각인 · 화면이 본 값(seen)이 같은 함수(planner-confirm 지문 한 벌). */
async function pairHashFor(p: RecheckPair, copy: PlannerCopy): Promise<{ carrier: string; dm: string | null; seen: string }> {
  const rows = p.all.map((t) => (t.id === p.carrier.id ? { ...t, execMeta: { ...t.execMeta, copy } } : t));
  const fps = await computeTouchpointFingerprints(p.ev.companyId, rows);
  const c = fps.get(p.carrier.id) || '';
  const d = p.dm ? fps.get(p.dm.id) || '' : null;
  return { carrier: c, dm: d, seen: `${c}:${d || ''}:${p.recheck.round}` };
}

/**
 * (순수) 새 문안이 안전한가 — 원문이 혜택을 담았는데 새 문안이 빼먹었거나, 원문 · 혜택 · 행사명 · 날짜에 없던 숫자가 생기면 버린다
 * (AI 가 값이 든 문장을 지어낼 수 있다 · LESSONS 1018 「값은 코드가 놓는다」). 반환 = 문제 코드 또는 null.
 */
export function recheckProposalIssue(input: {
  text: string; subject: string; original: string; originalSubject: string; benefit: string | null; title: string; dates: string[];
}): 'benefit_missing' | 'new_number' | 'placeholder' | null {
  const norm = (s: string) => String(s || '').replace(/\s+/g, '');
  if (hasUneditedBenefitPlaceholder(input.text) || hasUneditedBenefitPlaceholder(input.subject)) return 'placeholder';
  const benefit = String(input.benefit || '').trim();
  if (benefit && norm(input.original + input.originalSubject).includes(norm(benefit)) && !norm(input.text + input.subject).includes(norm(benefit))) {
    return 'benefit_missing';
  }
  const nums = (s: string) => (String(s || '').replace(/(\d),(?=\d{3})/g, '$1').match(/\d+/g) || []).map((n) => String(Number(n)));
  const allowed = new Set<string>([
    ...nums(input.original), ...nums(input.originalSubject), ...nums(benefit), ...nums(input.title),
    ...input.dates.flatMap((d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? [String(Number(d.slice(0, 4))), String(Number(d.slice(5, 7))), String(Number(d.slice(8, 10)))] : [])),
  ]);
  for (const n of nums(`${input.text} ${input.subject}`)) if (!allowed.has(n)) return 'new_number';
  return null;
}

/** 이 쌍의 받는 사람 수 — 실행부와 같은 문(countPlannerAudience · 대상 축 = 캐리어 시점 규칙). */
async function countPairAudience(p: RecheckPair): Promise<PlannerAudienceCount> {
  try {
    const r = await countPlannerAudience({
      companyId: p.ev.companyId, createdBy: p.ev.createdBy, mode: resolveAudienceMode(p.carrier.channel, p.carrier.timing), plannerEventId: p.ev.id,
    });
    return r.blocked ? { state: 'blocked', count: null } : { state: 'known', count: r.count };
  } catch (e: any) {
    console.warn('[planner-recheck] 받는 사람 수 산출 실패:', e?.message || e);
    return { state: 'error', count: null };
  }
}

/** 그 쌍을 빼고 남은 다음 발송 날짜(통지 문장 「다음 발송 M/D 그대로」) */
function nextSendOf(p: RecheckPair): string | null {
  const ids = new Set(pairIds(p));
  return firstSendDate(p.ev, p.all.filter((t) => !ids.has(t.id) && t.scheduledOn > p.recheck.date));
}

// ── 잠금 · CAS 쓰기 ──────────────────────────────────────────────────
type Tx = { query: (text: string, params?: any[]) => Promise<any> };

/** 월 원장 → 행사 → 쌍 행 잠금 + 읽어 둔 상태와 같은지(status planned · recheck · copy JSON 일치). 다르면 409. */
async function lockPairUnchanged(client: Tx, p: RecheckPair): Promise<void> {
  await client.query(
    `SELECT status FROM planner_monthly_approvals WHERE company_id = $1::uuid AND plan_month = $2 FOR UPDATE`,
    [p.ev.companyId, p.ev.planMonth],
  );
  const ev = await client.query(`SELECT status FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`, [p.ev.id, p.ev.companyId]);
  if (!LIVE_EVENT.includes(String(ev.rows[0]?.status || ''))) throw new PlannerRecheckError(409, 'NOT_OPEN', '행사 상태가 바뀌어 지금은 정할 수 없습니다. 화면을 새로고침해 주세요.');
  const rows = await client.query(
    `SELECT id, status, exec_meta->'recheck' AS recheck, COALESCE(exec_meta->'copy', 'null'::jsonb) AS copy
       FROM planner_touchpoints WHERE company_id = $1::uuid AND event_id = $2::uuid AND id = ANY($3::uuid[]) FOR UPDATE`,
    [p.ev.companyId, p.ev.id, pairIds(p)],
  );
  const same = (rows.rows as any[]).length === pairIds(p).length && (rows.rows as any[]).every((r) => {
    const mine = r.id === p.carrier.id ? p.carrier : p.dm;
    return String(r.status) === 'planned'
      && JSON.stringify(r.recheck ?? null) === JSON.stringify(mine?.execMeta?.recheck ?? null)
      && JSON.stringify(r.copy ?? null) === JSON.stringify(mine?.execMeta?.copy ?? null);
  });
  if (!same) throw new PlannerRecheckError(409, 'CHANGED', '그 사이 내용이 바뀌었습니다. 화면을 새로 불러왔어요.');
}

async function inTx<T>(fn: (client: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
}

/** recheck 일부 칸만 고친다 — 그 회차 · planned 일 때만(쌍 두 행 한 문장). 반환 = 바뀐 행 수가 쌍 수와 같은가. */
async function patchRecheck(p: RecheckPair, fields: Partial<PlannerRecheckMeta>): Promise<boolean> {
  const r = await query(
    `UPDATE planner_touchpoints
        SET exec_meta = exec_meta || jsonb_build_object('recheck', (exec_meta->'recheck') || $4::jsonb)
      WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status = 'planned'
        AND (exec_meta->'recheck'->>'round')::int = $3
      RETURNING id`,
    [p.ev.companyId, pairIds(p), Number(p.recheck.round), JSON.stringify(fields)],
  );
  return r.rows.length === pairIds(p).length;
}

// ── 담당자 행동 ─────────────────────────────────────────────────────
export interface PairActor {
  userId: string | null;
  via: 'link' | 'pc';
  ownerScope: string | null;
  /** ★ Codex A 1R — 링크 = 검증한 토큰의 해시(지금 행의 recheck.tokenHash 와 같아야 한다 · 잠금 안 비교도 이 행 기준) */
  tokenHash?: string | null;
}

function assertScope(p: RecheckPair, actor: PairActor): void {
  if (actor.ownerScope && p.ev.createdBy !== actor.ownerScope) throw new PlannerRecheckError(404, 'NOT_FOUND', '해당 발송을 찾을 수 없습니다.');
}

async function loadOpenPair(companyId: string, carrierId: string, actor: PairActor, round: number, now: Date): Promise<RecheckPair> {
  const p = await loadRecheckPair(companyId, carrierId);
  if (!p) throw new PlannerRecheckError(404, 'NOT_FOUND', '다시 정할 발송을 찾을 수 없습니다. 이미 처리됐을 수 있어요.');
  assertScope(p, actor);
  // ★ Codex A 1R — 링크 행동은 검증한 토큰이 **지금 회차의 토큰**일 때만(미루기 · 다른 요청이 회차를 넘겼으면 옛 토큰 = 같은 410).
  //   잠금 안 비교(lockPairUnchanged)는 이 행의 recheck JSON 전체(토큰 해시 포함)와 지금 행을 대조하므로 그 사이 바뀌어도 막힌다.
  if (actor.via === 'link' && (!actor.tokenHash || String(p.recheck.tokenHash || '') !== actor.tokenHash)) {
    throw new PlannerRecheckError(410, 'GONE', '이 주소는 더 이상 쓸 수 없습니다. 가장 최근에 받으신 문자의 주소로 열어 주세요.');
  }
  assertPairOpen(p, round, now);
  return p;
}

/** ★ Codex A 1R — 잠금을 얻은 **뒤의** 시각으로 마감을 다시 본다(19:59 에 들어와 20시 넘어 잠금을 얻은 요청이 마감 뒤 승인되지 않게) */
function assertBeforeDeadline(p: RecheckPair, now: Date): void {
  if (isPastApprovalDeadline(p.recheck.date, now)) {
    throw new PlannerRecheckError(409, 'DEADLINE_PASSED', `마감(${PLANNER_APPROVAL_DEADLINE_HOUR}시)이 지나 이 날 발송은 정할 수 없습니다.`);
  }
}

const viaLabel = (via: 'link' | 'pc') => (via === 'link' ? '휴대폰 링크' : 'PC 한줄로');

/**
 * [새 문안으로 보내기] · [고친 문안으로 보내기] — 고른 문안을 copy 로 두고 쌍을 다시 승인한다(ready + 쌍 지문 각인).
 * 확인 창(화면) → (링크면) 인증번호 → 이 함수. 화면이 본 지문(seenHash)과 지금 지문이 다르면 409.
 * 돈: 지금 0 · 문안비 10 은 보낸 뒤 실행부가 멱등키로 1회. 반환 sendsAt = 'now'(발송 시간대 안 · 오늘) · 'morning'(오늘 · 시간대 밖 → 08시) · 'date'(다른 날).
 */
export async function approvePlannerPairTx(input: {
  companyId: string; carrierId: string; round: number; choice: 'proposal' | 'current'; seenHash: string; actor: PairActor; now?: Date;
}): Promise<{ date: string; sendsAt: 'now' | 'morning' | 'date'; recipients: number; carrierId: string }> {
  const now = input.now || new Date();
  const p = await loadOpenPair(input.companyId, input.carrierId, input.actor, input.round, now);
  const copy = chosenCopy(p, input.choice);
  if (!copy) throw new PlannerRecheckError(409, 'COPY_NOT_READY', input.choice === 'proposal' ? '새 문안이 아직 준비되지 않았습니다.' : '고친 문안의 스팸 검사가 끝나지 않았거나 통과하지 못했습니다.');
  const h = await pairHashFor(p, copy);
  if (h.seen !== String(input.seenHash || '')) throw new PlannerRecheckError(409, 'CHANGED', '보신 뒤 내용이 바뀌었습니다. 바뀐 내용을 확인한 뒤 다시 눌러 주세요.');
  const blocked = await firstBlockedChannel(p.dm ? ['sms', 'dm'] : [p.carrier.channel], { companyId: p.ev.companyId, userId: p.ev.createdBy, phase: 'send' });
  if (blocked) throw new PlannerRecheckError(400, 'CHANNEL_LOCKED', blocked.readiness.reason || '지금은 보낼 수 없는 채널이 있습니다.', { settingsPath: blocked.readiness.settingsPath });
  const a = await countPairAudience(p);
  if (a.state === 'blocked') throw new PlannerRecheckError(409, 'SCOPE_BLOCKED', PLANNER_REASON.scopeBlocked);
  if (a.state === 'error') throw new PlannerRecheckError(503, 'AUDIENCE_UNAVAILABLE', '받는 사람 수를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  if (!a.count) throw new PlannerRecheckError(409, 'AUDIENCE_ZERO', '문자를 받을 고객이 0명이라 보낼 수 없습니다.');
  const at = now.toISOString();
  const closed = { outcome: 'approved', at, round: Number(p.recheck.round), tokenHash: p.recheck.tokenHash || null, by: input.actor.userId, via: input.actor.via };
  const approved = (hash: string | null) => ({ hash, at, by: input.actor.userId, revision: Number(p.ev.meta.revision) || 0, pair: true, via: input.actor.via });
  await inTx(async (client) => {
    await lockPairUnchanged(client, p);
    assertBeforeDeadline(p, input.now || new Date());
    const rows = [
      { id: p.carrier.id, patch: { copy, copy_error: null, approved: approved(h.carrier), recheck_closed: closed } },
      ...(p.dm ? [{ id: p.dm.id, patch: { approved: approved(h.dm), recheck_closed: closed } }] : []),
    ];
    for (const r of rows) {
      const up = await client.query(
        `UPDATE planner_touchpoints
            SET status = 'ready', lock_reason = NULL,
                exec_meta = (COALESCE(exec_meta, '{}'::jsonb) - 'recheck' - 'post_approval_spam' - 'spam_error') || $3::jsonb
          WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'planned'
          RETURNING id`,
        [r.id, p.ev.companyId, JSON.stringify(r.patch)],
      );
      if (up.rows.length === 0) throw new PlannerRecheckError(409, 'CHANGED', '그 사이 처리 상태가 바뀌었습니다. 화면을 새로 불러왔어요.');
    }
  });
  // 결과 시각 = 커밋 뒤 지금(잠금 대기만큼 늦어졌을 수 있다)
  const doneAt = input.now || new Date();
  const today = kstDateString(doneAt);
  const sendsAt = p.recheck.date !== today ? 'date' : isSendableHourKst(doneAt, SEND_HOURS.start, SEND_HOURS.end) ? 'now' : 'morning';
  const when = sendsAt === 'now' ? '곧 보냅니다' : sendsAt === 'morning' ? `${SEND_HOURS.start}시에 보냅니다` : `${formatPlannerDay(p.recheck.date)} ${SEND_HOURS.start}시부터 보냅니다`;
  await notifyPlanner(p.ev.companyId, p.ev.createdBy, '[마케팅 플래너] 다시 정한 발송',
    `'${p.ev.title}' ${formatPlannerDay(p.recheck.date)} 문자를 ${input.choice === 'proposal' ? '새 문안' : '고친 문안'}으로 보내기로 정했습니다(${viaLabel(input.actor.via)}). ${(a.count || 0).toLocaleString()}명에게 ${when}.`);
  console.log(`[planner-recheck] 쌍 승인 company=${p.ev.companyId} carrier=${p.carrier.id} round=${p.recheck.round} choice=${input.choice} via=${input.actor.via}`);
  return { date: p.recheck.date, sendsAt, recipients: a.count || 0, carrierId: p.carrier.id };
}

/** [오늘만 건너뛰기] — 멈춘 쌍만(승인 CT 와 같은 조건 · B2) · 인증번호 없음 · 확인 창 + 담당자 통보 + 기록. */
export async function skipPlannerPairTx(input: { companyId: string; carrierId: string; round: number; actor: PairActor; now?: Date }): Promise<{ date: string; nextSend: string | null }> {
  const now = input.now || new Date();
  const p = await loadOpenPair(input.companyId, input.carrierId, input.actor, input.round, now);
  const closed = { outcome: 'skipped', at: now.toISOString(), round: Number(p.recheck.round), tokenHash: p.recheck.tokenHash || null, by: input.actor.userId, via: input.actor.via };
  await inTx(async (client) => {
    await lockPairUnchanged(client, p);
    assertBeforeDeadline(p, input.now || new Date());
    const up = await client.query(
      `UPDATE planner_touchpoints
          SET status = 'skipped', lock_reason = $3, exec_meta = (COALESCE(exec_meta, '{}'::jsonb) - 'recheck') || jsonb_build_object('recheck_closed', $4::jsonb)
        WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status = 'planned'
        RETURNING id`,
      [p.ev.companyId, pairIds(p), PLANNER_REASON.recheckSkipped, JSON.stringify(closed)],
    );
    if (up.rows.length !== pairIds(p).length) throw new PlannerRecheckError(409, 'CHANGED', '그 사이 처리 상태가 바뀌었습니다. 화면을 새로 불러왔어요.');
  });
  await settleEventIfFinished(p.ev.companyId, p.ev.id, 'skipped').catch(() => null);
  const nextSend = nextSendOf(p);
  await notifyPlanner(p.ev.companyId, p.ev.createdBy, '[마케팅 플래너] 발송 건너뜀',
    `'${p.ev.title}' ${formatPlannerDay(p.recheck.date)} 문자 발송을 건너뛰었습니다(${viaLabel(input.actor.via)}).`
      + (nextSend ? ` 다음 발송 ${formatPlannerDay(nextSend)}은 그대로 갑니다.` : ' 남은 발송은 없습니다.'));
  return { date: p.recheck.date, nextSend };
}

/**
 * [직접 고치기] — 고친 글을 검사 대기로 둔다(행사 리비전 · 상태 그대로 · B3 · 옛 editPlannerCopy 는 행사 전체를 재료 단계로 내린다).
 * 실주소 검사는 재확인 패스가 한다(수 분 · 요청 안에서 하지 않는다). 통과하면 [고친 문안으로 보내기].
 */
export async function editPlannerPairCopyTx(input: {
  companyId: string; carrierId: string; round: number; text: string; subject?: string | null; actor: PairActor; now?: Date;
}): Promise<{ status: 'checking' }> {
  const now = input.now || new Date();
  const text = String(input.text || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new PlannerRecheckError(400, 'EMPTY', '문안을 입력해 주세요.');
  if (text.length > PLANNER_COPY_MAX) throw new PlannerRecheckError(400, 'TOO_LONG', `문안은 ${PLANNER_COPY_MAX}자까지 쓸 수 있습니다.`);
  if (hasUneditedBenefitPlaceholder(text)) throw new PlannerRecheckError(400, 'PLACEHOLDER', '채워지지 않은 자리가 남아 있습니다. 혜택 문구를 직접 써 주세요.');
  const p = await loadOpenPair(input.companyId, input.carrierId, input.actor, input.round, now);
  const prev = p.carrier.execMeta?.copy as PlannerCopy | undefined;
  const subject = input.subject === undefined || input.subject === null ? String(prev?.subject || '') : String(input.subject).trim().slice(0, 60);
  const copy: PlannerCopy = {
    text, subject, inputHash: currentInputHash(p), spam: 'pending', checkedAt: null, withDmLink: withDmLinkOf(p),
    edited: true, editedAt: now.toISOString(), recheckRound: Number(p.recheck.round),
  };
  await inTx(async (client) => {
    await lockPairUnchanged(client, p);
    assertBeforeDeadline(p, input.now || new Date());
    const up = await client.query(
      `UPDATE planner_touchpoints SET exec_meta = COALESCE(exec_meta, '{}'::jsonb) || $3::jsonb
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'planned' RETURNING id`,
      [p.carrier.id, p.ev.companyId, JSON.stringify({ copy, copy_error: null })],
    );
    if (up.rows.length === 0) throw new PlannerRecheckError(409, 'CHANGED', '그 사이 처리 상태가 바뀌었습니다. 화면을 새로 불러왔어요.');
  });
  console.log(`[planner-recheck] 쌍 문안 직접 수정 carrier=${p.carrier.id} round=${p.recheck.round} via=${input.actor.via}`);
  return { status: 'checking' };
}

/**
 * [미루기] 고를 수 있는 날 — 이 쌍 날짜 뒤 ~ 행사 종료일 · 내일부터 · 그 회사의 다른 살아 있는 문자 · DM 접점이 없는 날(Harold 1018 ③).
 * 상한 14일(화면 목록).
 */
export async function listDeferDates(p: RecheckPair, now: Date = new Date(), db?: Tx): Promise<string[]> {
  const today = kstDateString(now);
  const from = addDays(p.recheck.date > today ? p.recheck.date : today, 1);
  if (from > p.ev.endsOn) return [];
  const busy = await loadAllLiveTouchpoints({
    statuses: ['planned', 'ready', 'producing', 'hold_credit', 'locked', 'scheduled'],
    channels: ['sms', 'dm'],
    scheduledFrom: from, scheduledTo: p.ev.endsOn, companyId: p.ev.companyId,
    eventStatuses: ['approved', 'producing', 'scheduled', 'briefed', 'draft'],
    db,
  }, { label: 'planner-recheck defer' });
  const mine = new Set(pairIds(p));
  const taken = new Set(busy.filter((t) => !mine.has(t.id)).map((t) => t.scheduledOn));
  const out: string[] = [];
  for (let d = from; d <= p.ev.endsOn && out.length < 14; d = addDays(d, 1)) if (!taken.has(d)) out.push(d);
  return out;
}

/**
 * [미루기] — 쌍의 시점 규칙에 날짜(`TimingRule.on`)를 두고 새 회차를 연다(새 날짜 문안을 재확인 패스가 만들고 검사해 링크로 다시 묻는다).
 * 인증번호 없음(새 날짜도 다시 보내기 승인을 지난다) · 확인 창 + 담당자 통보 + 기록.
 */
export async function deferPlannerPairTx(input: { companyId: string; carrierId: string; round: number; toDate: string; actor: PairActor; now?: Date }): Promise<{ from: string; to: string }> {
  const now = input.now || new Date();
  const p = await loadOpenPair(input.companyId, input.carrierId, input.actor, input.round, now);
  const toDate = String(input.toDate || '');
  if (!(await listDeferDates(p, now)).includes(toDate)) {
    throw new PlannerRecheckError(400, 'DATE_NOT_ALLOWED', '그 날로는 미룰 수 없습니다. 행사 기간 안에서 다른 문자가 없는 날을 골라 주세요.');
  }
  const next: PlannerRecheckMeta = {
    round: Number(p.recheck.round) + 1, date: toDate, origin: 'deferred', at: now.toISOString(), deferredFrom: p.recheck.date,
  };
  await inTx(async (client) => {
    // ★ Codex A 1R — 같은 회사 · 같은 날로 미루는 요청을 줄 세운다(월이 다른 두 행사도 같은 날을 노릴 수 있어 월 원장 잠금만으로는 모자란다).
    // ★ Codex A 2R — 날짜 잠금을 **맨 앞**에 잡는다(다른 잠금 경로는 이 잠금을 쥐지 않아 순환 0) → 쌍 잠금 → 마감은 마지막 대기 뒤(네 동작 같은 꼴) →
    //   날짜 재확인은 같은 연결로(잠금을 쥔 채 풀에서 또 꺼내지 않는다 · 읽기는 커밋된 값 · READ COMMITTED).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`planner-defer:${p.ev.companyId}:${toDate}`]);
    await lockPairUnchanged(client, p);
    assertBeforeDeadline(p, input.now || new Date());
    if (!(await listDeferDates(p, input.now || new Date(), client)).includes(toDate)) {
      throw new PlannerRecheckError(409, 'DATE_TAKEN', '그 사이 다른 발송이 그 날을 잡았습니다. 다른 날을 골라 주세요.');
    }
    const up = await client.query(
      `UPDATE planner_touchpoints
          SET timing_rule = COALESCE(timing_rule, '{}'::jsonb) || jsonb_build_object('on', $3::text),
              lock_reason = $4,
              exec_meta = COALESCE(exec_meta, '{}'::jsonb) || jsonb_build_object('recheck', $5::jsonb)
        WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status = 'planned'
        RETURNING id`,
      [p.ev.companyId, pairIds(p), toDate, PLANNER_REASON.recheckDeferred, JSON.stringify(next)],
    );
    if (up.rows.length !== pairIds(p).length) throw new PlannerRecheckError(409, 'CHANGED', '그 사이 처리 상태가 바뀌었습니다. 화면을 새로 불러왔어요.');
  });
  await notifyPlanner(p.ev.companyId, p.ev.createdBy, '[마케팅 플래너] 발송 미룸',
    `'${p.ev.title}' ${formatPlannerDay(p.recheck.date)} 문자를 ${formatPlannerDay(toDate)}로 미뤘습니다(${viaLabel(input.actor.via)}). 새 날짜 문안을 만들어 검사한 뒤 다시 확인 링크를 보내 드립니다.`);
  console.log(`[planner-recheck] 쌍 미룸 carrier=${p.carrier.id} ${p.recheck.date} → ${toDate} via=${input.actor.via}`);
  return { from: p.recheck.date, to: toDate };
}

// ── 링크 · 링크 권한 ─────────────────────────────────────────────────
export const PLANNER_RECHECK_TOKEN_HEADER = 'x-planner-recheck-token';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 회사 스위치 — 휴대폰 링크에서 보내기 · 고치기 · 취소를 여는 회사(쉼표 구분 id · 빈 값 = 전부 닫힘 · 배포 기본값). */
export function plannerLinkApproveCompanyIds(env: string | undefined = process.env.PLANNER_LINK_APPROVE_COMPANY_IDS): string[] {
  return String(env || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => UUID_RE.test(s));
}

/** 링크 주소 — 토큰은 # 뒤(접근 로그 · Referer 로 새지 않는다 · 플래너 확인 · 대행 승인과 같은 축) */
export function buildPlannerRecheckLink(token: string): string {
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  return `${base}/planner-recheck#t=${token}`;
}

/** (순수) 마감 시각(그 날 20시 KST) */
export function recheckDeadlineAt(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, PLANNER_APPROVAL_DEADLINE_HOUR - 9, 0, 0));
}

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

export type RecheckTokenResolution =
  | { kind: 'open'; pair: RecheckPair }
  | { kind: 'closed'; outcome: string; at: string; title: string; date: string | null }
  | null;

/** 토큰 → 쌍(열려 있으면) · 처리 끝(같은 토큰으로 정한 뒤 다시 열면 결과) · 무효 null. 토큰 = `캐리어id.무작위` · 원문은 저장하지 않는다(sha256). */
export async function resolveRecheckToken(token: string, now: Date = new Date()): Promise<RecheckTokenResolution> {
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{48})$/i.exec(String(token || '').trim());
  if (!m || !UUID_RE.test(m[1])) return null;
  const own = await query(`SELECT company_id FROM planner_touchpoints WHERE id = $1::uuid`, [m[1]]);
  if (!own.rows[0]) return null;
  const tp = await loadTouchpointById(String(own.rows[0].company_id), m[1]);
  if (!tp) return null;
  const h = sha(String(token).trim());
  const rc = tp.execMeta?.recheck;
  if (rc && safeEq(String(rc.tokenHash || ''), h)) {
    if (tp.status !== 'planned' || !rc.tokenExpiresAt || new Date(String(rc.tokenExpiresAt)).getTime() <= now.getTime()) return null;
    const pair = await loadRecheckPair(tp.companyId, tp.id);
    // ★ Codex A 2R — 다시 읽은 쌍도 **이 요청 토큰**의 회차여야 연다(그 사이 미루기 · 새 링크 발급이 끝났으면 옛 토큰 = 무효).
    //   그래서 라우트가 쓰는 pair.recheck.tokenHash = 요청 토큰 해시이고, 변경 CT 는 잠금 안에서 그 값을 지금 행과 또 대조한다.
    return pair && safeEq(String(pair.recheck.tokenHash || ''), h) ? { kind: 'open', pair } : null;
  }
  const closed = tp.execMeta?.recheck_closed;
  if (closed && safeEq(String(closed.tokenHash || ''), h)) {
    return { kind: 'closed', outcome: String(closed.outcome || ''), at: String(closed.at || ''), title: tp.title, date: tp.scheduledOn || null };
  }
  return null;
}

export interface RecheckLinkActor { userId: string | null; canAct: boolean; reason: string | null; ownerScope: string | null; maskedPhone: string | null }

/**
 * 링크로 보내기 · 고치기 · 취소를 해도 되는가 — 열 때 · 실행할 때마다 다시 본다(강등 · 비활성 · 번호 변경 뒤 링크가 살아 있지 않게).
 * 조건 = 회사 스위치 · 통지를 받은 그 계정 · 활성 · 같은 회사 · 휴대폰 번호 = 인증 번호(그 폰으로 링크도 인증번호도 간다) · 범위(관리자 또는 행사를 만든 계정).
 */
export async function resolveRecheckLinkActor(p: RecheckPair): Promise<RecheckLinkActor> {
  const userId = p.recheck.notifiedUserId ? String(p.recheck.notifiedUserId) : null;
  const no = (reason: string, masked: string | null = null): RecheckLinkActor => ({ userId, canAct: false, reason, ownerScope: null, maskedPhone: masked });
  if (!userId) return no('보내기 · 고치기 · 취소는 PC 한줄로 캘린더의 할 일에서 하실 수 있어요.');
  if (!plannerLinkApproveCompanyIds().includes(String(p.ev.companyId).toLowerCase())) {
    return no('휴대폰에서 보내기 · 고치기 · 취소는 아직 열리지 않았어요. PC 한줄로 캘린더의 할 일에서 정해 주세요.');
  }
  const r = await query(
    `SELECT id, company_id, user_type, is_active, phone, mfa_phone FROM users WHERE id = $1::uuid`,
    [userId],
  );
  const u = r.rows[0];
  if (!u || u.is_active !== true || String(u.company_id) !== String(p.ev.companyId)) return no('보내기 · 고치기 · 취소는 PC 한줄로 캘린더의 할 일에서 하실 수 있어요.');
  const phone = normalizePhone(String(u.phone || ''));
  const mfa = normalizePhone(String(u.mfa_phone || ''));
  if (!mfa || mfa.length < 10 || phone !== mfa) {
    return no('이 휴대폰 번호가 계정의 인증 번호와 달라 보내기 · 고치기 · 취소는 PC 한줄로에서 하실 수 있어요.');
  }
  const admin = String(u.user_type || '') === 'admin';
  if (!admin && String(u.id) !== String(p.ev.createdBy || '')) return no('이 행사를 만든 담당자나 관리자만 휴대폰에서 정할 수 있어요.');
  return { userId, canAct: true, reason: null, ownerScope: admin ? null : String(u.id), maskedPhone: maskPhone(mfa) };
}

// ── 통지 ─────────────────────────────────────────────────────────────
/** (순수) 재확인 링크 문자 본문 */
export function buildRecheckNotice(input: {
  title: string; date: string; today: string; origin: PlannerRecheckMeta['origin']; proposalReady: boolean; link: string; nextSend: string | null;
}): string {
  const day = input.date === input.today ? '오늘' : formatPlannerDay(input.date);
  const lines: string[] = [];
  if (input.origin === 'deferred') {
    lines.push(`'${input.title}' 미루신 ${formatPlannerDay(input.date)} 문자 ${input.proposalReady ? '새 문안이 준비됐습니다. 스팸 검사를 통과했습니다.' : '새 문안을 만들지 못했어요. 직접 고쳐 보내실 수 있어요.'}`);
  } else if (input.origin === 'post_approval') {
    lines.push(`'${input.title}' ${formatPlannerDay(input.date)} 보낼 문자가 실제 모바일 DM 주소를 붙인 검사에서 스팸으로 판정돼 아직 나가지 않습니다.`);
    lines.push(input.proposalReady ? '새로 쓴 문안은 검사를 통과했습니다.' : '새 문안을 만들지 못했어요. 직접 고쳐 보내실 수 있어요.');
  } else {
    lines.push(`'${input.title}' 오늘 문자가 스팸 검사에 막혀 아직 나가지 않았습니다.`);
    lines.push(input.proposalReady ? '새로 쓴 문안은 검사를 통과했습니다.' : '새 문안을 만들지 못했어요. 직접 고쳐 보내실 수 있어요.');
  }
  lines.push(`${day} ${PLANNER_APPROVAL_DEADLINE_HOUR}시까지 정하시면 ${day === '오늘' ? '오늘' : '그날'} 보냅니다. 정하지 않으시면 이 날 발송만 건너뛰고${input.nextSend ? ' 다른 날은 그대로 갑니다.' : ' 끝납니다.'}`);
  lines.push(`처리하기: ${input.link}`);
  return lines.join('\n');
}

/** 통지 1통(링크) — 받는 사람 하나를 정하고(B8) · 토큰을 먼저 기록한 뒤 보낸다 · 못 보냈으면 기록을 되돌려 다음 주기가 다시 보낸다. */
async function notifyRecheck(p: RecheckPair, now: Date): Promise<boolean> {
  const contact = await pickOperatorFallbackContact(p.ev.companyId, p.ev.createdBy).catch(() => null);
  if (!contact) {
    console.warn(`[planner-recheck] 통지 받을 담당자 번호 없음 carrier=${p.carrier.id}`);
    return false;
  }
  const token = `${p.carrier.id}.${randomBytes(24).toString('hex')}`;
  const tokenHash = sha(token);
  const ok = await patchRecheck(p, {
    notifiedAt: now.toISOString(), notifiedUserId: contact.userId, tokenHash, tokenExpiresAt: recheckDeadlineAt(p.recheck.date).toISOString(),
  });
  if (!ok) return false;
  const body = buildRecheckNotice({
    title: p.ev.title, date: p.recheck.date, today: kstDateString(now), origin: p.recheck.origin,
    proposalReady: !!p.recheck.proposal?.text, link: buildPlannerRecheckLink(token), nextSend: nextSendOf(p),
  });
  const sent = await notifyOperatorAdmins(
    { adminPhoneNumbers: [contact.phone], backupAdminPhone: null, companyId: p.ev.companyId, createdBy: p.ev.createdBy },
    '[마케팅 플래너] 오늘 발송 다시 확인', body, { noticeHeader: PLANNER_NOTICE_HEADER },
  ).catch(() => false);
  if (!sent) {
    await query(
      `UPDATE planner_touchpoints
          SET exec_meta = exec_meta || jsonb_build_object('recheck', (exec_meta->'recheck') || '{"notifiedAt": null, "tokenHash": null}'::jsonb)
        WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND exec_meta->'recheck'->>'tokenHash' = $3`,
      [p.ev.companyId, pairIds(p), tokenHash],
    ).catch(() => null);
    console.warn(`[planner-recheck] 링크 통지 실패 carrier=${p.carrier.id} — 다음 주기 재시도`);
    return false;
  }
  console.log(`[planner-recheck] 링크 통지 carrier=${p.carrier.id} round=${p.recheck.round} user=${contact.userId}`);
  return true;
}

/** 17시 리마인드 1회 — 새 링크를 만들지 않는다(앞서 보낸 링크로 · 열려 있는 화면을 죽이지 않게). 받는 사람 = 같은 함수. */
async function remindRecheck(p: RecheckPair, now: Date): Promise<boolean> {
  const contact = await pickOperatorFallbackContact(p.ev.companyId, p.ev.createdBy).catch(() => null);
  if (!contact) return false;
  if (!(await patchRecheck(p, { remindedAt: now.toISOString() }))) return false;
  return notifyOperatorAdmins(
    { adminPhoneNumbers: [contact.phone], backupAdminPhone: null, companyId: p.ev.companyId, createdBy: p.ev.createdBy },
    '[마케팅 플래너] 오늘 발송 마감 전',
    `'${p.ev.title}' 오늘 문자를 아직 정하지 않으셨어요. ${PLANNER_APPROVAL_DEADLINE_HOUR}시까지 앞서 보내 드린 링크에서 정해 주세요. 정하지 않으시면 이 날 발송만 건너뜁니다.`,
    { noticeHeader: PLANNER_NOTICE_HEADER },
  ).catch(() => false);
}

// ── 재확인 패스 ─────────────────────────────────────────────────────
/** 새 문안 준비(하루 1회) — AI 1회(원가 0 · 크레딧 묶음) + 실주소 링크 검사(재생성 2회) + 안전 검사. */
async function prepareProposal(p: RecheckPair, today: string): Promise<void> {
  const url = dmUrlOf(p);
  const withDmLink = withDmLinkOf(p);
  let proposal: PlannerRecheckMeta['proposal'] = null;
  let proposalError: PlannerRecheckMeta['proposalError'] = 'failed';
  try {
    const ctx = await loadPlannerCompanyContext(p.ev.companyId);
    const callback = await loadPlannerDefaultCallback(p.ev.companyId);
    const opt080 = await getOpt080Number(p.ev.createdBy || null, p.ev.companyId);
    if (ctx && callback && opt080 && (!withDmLink || url)) {
      const draft = await generatePlannerCopyText(p.carrier, ctx, withDmLink).catch(() => null);
      if (draft && draft.body.trim() && !hasUneditedBenefitPlaceholder(draft.body)) {
        const check = await spamCheckPlannerVerdict({
          tp: p.carrier, body: appendDmLink(draft.body, url), subject: draft.subject, callback, rejectNumber: opt080, link: url, withDmLink, regenerate: true,
        });
        if (check.verdict === 'pass') {
          const text = stripDmLink(check.body, url);
          const orig = p.carrier.execMeta?.copy as PlannerCopy | undefined;
          const issue = recheckProposalIssue({
            text, subject: check.subject || '', original: String(orig?.text || ''), originalSubject: String(orig?.subject || ''),
            benefit: p.ev.benefitText, title: p.ev.title, dates: [p.ev.startsOn, p.ev.endsOn, p.recheck.date],
          });
          if (!issue) { proposal = { text, subject: check.subject || '', checkedAt: new Date().toISOString() }; proposalError = null; }
          else { proposalError = 'unsafe'; console.warn(`[planner-recheck] 새 문안 버림(${issue}) carrier=${p.carrier.id}`); }
        } else {
          proposalError = check.verdict === 'blocked' ? 'blocked' : 'failed';
        }
      }
    }
  } catch (e: any) {
    console.warn(`[planner-recheck] 새 문안 준비 실패 carrier=${p.carrier.id}:`, e?.message || e);
  }
  await patchRecheck(p, { proposal, proposalTried: today, proposalError });
}

/** 고친 글 검사(이 회차 · 실주소 링크 · 재생성 0) — 검사한 글이 그대로일 때만 결과를 쓴다(CAS). 검사 장애는 다음 주기에 다시. */
async function checkEditedCopy(p: RecheckPair): Promise<void> {
  const c = p.carrier.execMeta?.copy as PlannerCopy | undefined;
  if (!c || c.spam !== 'pending' || Number(c.recheckRound) !== Number(p.recheck.round)) return;
  const url = dmUrlOf(p);
  const callback = await loadPlannerDefaultCallback(p.ev.companyId);
  const opt080 = await getOpt080Number(p.ev.createdBy || null, p.ev.companyId);
  if (!callback || !opt080) return;
  const check = await spamCheckPlannerVerdict({
    tp: p.carrier, body: appendDmLink(c.text, url), subject: c.subject, callback, rejectNumber: opt080, link: url, withDmLink: withDmLinkOf(p), regenerate: false,
  });
  if (check.verdict === 'error') return;
  const checkedAt = new Date().toISOString();
  await setTouchpointMetaIfCopyIs(p.ev.companyId, p.carrier.id, c, check.verdict === 'pass'
    ? { copy: { ...c, spam: 'pass', checkedAt }, copy_error: null }
    : { copy: { ...c, spam: 'fail', checkedAt }, copy_error: { reason: EDITED_COPY_SPAM_FAILED, at: checkedAt } });
}

/** 마감(그 날 20시) 지난 쌍 = 생략 + 링크 없는 통지(M2). */
async function closePastDeadline(p: RecheckPair, now: Date): Promise<boolean> {
  const closed = { outcome: 'past_deadline', at: now.toISOString(), round: Number(p.recheck.round), tokenHash: p.recheck.tokenHash || null };
  const r = await query(
    `UPDATE planner_touchpoints
        SET status = 'skipped', lock_reason = $4, exec_meta = (COALESCE(exec_meta, '{}'::jsonb) - 'recheck') || jsonb_build_object('recheck_closed', $5::jsonb)
      WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status = 'planned' AND (exec_meta->'recheck'->>'round')::int = $3
      RETURNING id`,
    [p.ev.companyId, pairIds(p), Number(p.recheck.round), PLANNER_REASON.recheckMissed, JSON.stringify(closed)],
  );
  if (r.rows.length === 0) return false;
  await settleEventIfFinished(p.ev.companyId, p.ev.id, 'recheck_missed').catch(() => null);
  await notifyPlanner(p.ev.companyId, p.ev.createdBy, '[마케팅 플래너] 발송 생략',
    `'${p.ev.title}' ${formatPlannerDay(p.recheck.date)} 문자는 마감(${PLANNER_APPROVAL_DEADLINE_HOUR}시)까지 다시 정해지지 않아 보내지 않습니다.`
      + (nextSendOf(p) ? ` 다음 발송 ${formatPlannerDay(nextSendOf(p)!)}은 그대로 갑니다.` : ' 남은 발송은 없습니다.')
      + ' 이 발송에는 문안비가 빠지지 않았습니다.');
  return true;
}

let recheckRunning = false;
/** ★ Codex A 1R — 패스가 도는 동안 들어온 당김(진입 · 고치기 · 미루기 직후) = 끝난 뒤 전체 한 번 더 */
let recheckAgain = false;

/**
 * 재확인 패스 — 실행 워커 10분 주기 맨 앞에서 시간대와 무관하게 돈다(B7 · 18시 실패도 20분 안에 담당자가 안다).
 * 순서 = 마감 → 새 문안(하루 1회) → 고친 글 검사 → 통지(첫 1통) → 17시 리마인드. 한 번에 하나만(검사가 분 단위).
 */
export async function runPlannerRecheckPass(opts?: { companyId?: string; carrierId?: string; now?: Date }): Promise<{ notified: number; proposals: number; checked: number; closed: number }> {
  const out = { notified: 0, proposals: 0, checked: 0, closed: 0 };
  if (recheckRunning) { recheckAgain = true; return out; }
  recheckRunning = true;
  try {
    if (!(await guardPlannerMetaOrSkip('planner-recheck'))) return out;
    const now = opts?.now || new Date();
    const today = kstDateString(now);
    const rows = await loadAllLiveTouchpoints({ statuses: ['planned'], scheduledFrom: today, execMetaHas: 'recheck', companyId: opts?.companyId }, { label: 'planner-recheck' });
    const seen = new Set<string>();
    for (const row of rows) {
      if (opts?.carrierId && row.id !== opts.carrierId) continue;
      const lockKey = `planner-recheck:${row.id}`;
      if (seen.has(row.id) || !tryAcquireInflight(lockKey)) continue;
      seen.add(row.id);
      try {
        let p = await loadRecheckPair(row.companyId, row.id);
        if (!p || p.carrier.id !== row.id) continue; // DM 행은 캐리어로 처리된다
        if (p.recheck.date < today || p.carrier.scheduledOn !== p.recheck.date) continue; // 지난 날 = 대조 워커(M3)
        if (isPastApprovalDeadline(p.recheck.date, now)) {
          if (await closePastDeadline(p, now)) out.closed++;
          continue;
        }
        if (!p.recheck.proposal && p.recheck.proposalTried !== today) {
          await prepareProposal(p, today);
          out.proposals++;
          p = await loadRecheckPair(row.companyId, row.id);
          if (!p) continue;
        }
        const c = p.carrier.execMeta?.copy as PlannerCopy | undefined;
        if (c?.spam === 'pending' && Number(c.recheckRound) === Number(p.recheck.round)) {
          await checkEditedCopy(p);
          out.checked++;
          p = await loadRecheckPair(row.companyId, row.id);
          if (!p) continue;
        }
        if (!p.recheck.notifiedAt) {
          if (await notifyRecheck(p, now)) out.notified++;
        } else if (!p.recheck.remindedAt && p.recheck.date === today && kstHour(now) >= 17) {
          await remindRecheck(p, now);
        }
      } catch (e: any) {
        console.warn(`[planner-recheck] 패스 오류 tp=${row.id}(다음 주기 재시도):`, e?.message || e);
      } finally {
        releaseInflight(lockKey);
      }
    }
    if (out.notified + out.proposals + out.checked + out.closed > 0) {
      console.log(`[planner-recheck] 통지 ${out.notified} · 새 문안 ${out.proposals} · 고친 글 검사 ${out.checked} · 마감 생략 ${out.closed}`);
    }
    return out;
  } finally {
    recheckRunning = false;
    if (recheckAgain) {
      recheckAgain = false;
      void runPlannerRecheckPass().catch((e: any) => console.warn('[planner-recheck] 이어 돌기 실패(10분 주기가 집는다):', e?.message || e));
    }
  }
}

/** 진입 · 고치기 · 미루기 직후 그 쌍만 당긴다(best-effort · 놓치면 10분 주기가 집는다). */
export function kickPlannerRecheck(companyId: string, carrierId: string): void {
  void runPlannerRecheckPass({ companyId, carrierId }).catch(() => null);
}

// ── 화면 본문(링크 · PC 할 일 같은 함수) ──────────────────────────────
type ActionState = { ok: boolean; reason: string | null };

export interface RecheckView {
  event: { id: string; title: string; startsOn: string; endsOn: string; status: string; companyName: string };
  pair: { carrierId: string; dmId: string | null; round: number; date: string; origin: PlannerRecheckMeta['origin']; deferredFrom: string | null };
  today: string;
  deadline: { date: string; hour: number };
  /** 지금 승인하면 언제 나가는가(B1 · 승인 결과와 같은 판정) */
  sendsAt: 'now' | 'morning' | 'date';
  current: { text: string; subject: string; edited: boolean; state: 'blocked' | 'pending' | 'pass' | 'fail' | 'stale' | 'missing'; hash: string | null; rawText: string };
  proposal: { state: 'ready' | 'preparing' | 'failed' | 'unsafe'; text: string; subject: string; hash: string | null };
  dm: { html: string | null } | null;
  recipients: PlannerAudienceCount;
  copyCost: number;
  deferDates: string[];
  nextSend: string | null;
  remaining: Array<{ date: string; label: string }>;
  actions: { approve: ActionState; edit: ActionState; skip: ActionState; defer: ActionState; cancel: ActionState };
  /** 링크 화면만 — 인증 상태(보내기 · 고치기 · 취소 앞) */
  auth: { required: boolean; alive: boolean; maskedPhone: string | null } | null;
  dataSource: string;
}

async function loadCompanyName(companyId: string): Promise<string> {
  const r = await query(`SELECT COALESCE(NULLIF(brand_name, ''), company_name) AS name FROM companies WHERE id = $1::uuid`, [companyId]).catch(() => null);
  return String(r?.rows[0]?.name || '').trim();
}

export async function buildRecheckView(p: RecheckPair, opts: { mode: 'public' | 'member'; req?: { ip?: string; headers?: any }; now?: Date }): Promise<RecheckView> {
  const now = opts.now || new Date();
  const today = kstDateString(now);
  const url = dmUrlOf(p);
  const opt080 = await getOpt080Number(p.ev.createdBy || null, p.ev.companyId).catch(() => '');
  const render = (text: string) => buildAdMessage(appendDmLink(String(text || ''), url), 'LMS', true, opt080 || '');
  const round = Number(p.recheck.round);
  const cur = p.carrier.execMeta?.copy as PlannerCopy | undefined;
  const inputHash = currentInputHash(p);
  const curChoice = chosenCopy(p, 'current');
  const prChoice = chosenCopy(p, 'proposal');
  const [curHash, prHash, recipients, deferDates, companyName] = await Promise.all([
    curChoice ? pairHashFor(p, curChoice).then((h) => h.seen) : Promise.resolve(null),
    prChoice ? pairHashFor(p, prChoice).then((h) => h.seen) : Promise.resolve(null),
    countPairAudience(p),
    listDeferDates(p, now).catch(() => [] as string[]),
    loadCompanyName(p.ev.companyId),
  ]);
  let dmHtml: string | null = null;
  const dmTp = p.carrier.channel === 'dm' ? p.carrier : p.dm;
  if (dmTp?.assetRef) {
    const row = await getDmDetail(dmTp.assetRef, p.ev.companyId).catch(() => null);
    dmHtml = row ? (() => { try { return renderDmViewerHtml(row, '/api/dm/v'); } catch { return null; } })() : null;
  }
  const curState: RecheckView['current']['state'] = !cur?.text ? 'missing'
    : cur.inputHash !== inputHash ? 'stale'
      : Number(cur.recheckRound) === round ? (cur.spam === 'pending' ? 'pending' : cur.spam === 'fail' ? 'fail' : 'pass')
        : 'blocked';
  const prState: RecheckView['proposal']['state'] = p.recheck.proposal?.text ? 'ready'
    : p.recheck.proposalTried === today ? (p.recheck.proposalError === 'unsafe' ? 'unsafe' : 'failed')
      : 'preparing';
  const open = LIVE_EVENT.includes(p.ev.status) && p.carrier.status === 'planned' && !isPastApprovalDeadline(p.recheck.date, now);
  const audienceOk = recipients.state === 'known' && (recipients.count || 0) > 0;
  const linkActor = opts.mode === 'public' ? await resolveRecheckLinkActor(p) : null;
  const gate = (ok: boolean, why: string | null, needsActor: boolean): ActionState => {
    if (!open) return { ok: false, reason: `마감(${PLANNER_APPROVAL_DEADLINE_HOUR}시)이 지났거나 이미 정해졌습니다.` };
    if (!ok) return { ok: false, reason: why };
    if (needsActor && linkActor && !linkActor.canAct) return { ok: false, reason: linkActor.reason };
    return { ok: true, reason: null };
  };
  const busy = p.all.some((t) => t.status === 'producing');
  const remaining = p.all.filter((t) => t.status !== 'sent' && t.status !== 'skipped')
    .map((t) => ({ date: t.scheduledOn, label: t.channelLabel })).sort((a, b) => a.date.localeCompare(b.date));
  const callback = opts.mode === 'public' && linkActor?.userId ? await loadPlannerDefaultCallback(p.ev.companyId).catch(() => null) : null;
  return {
    event: { id: p.ev.id, title: p.ev.title, startsOn: p.ev.startsOn, endsOn: p.ev.endsOn, status: p.ev.status, companyName },
    pair: { carrierId: p.carrier.id, dmId: p.dm?.id || null, round, date: p.recheck.date, origin: p.recheck.origin, deferredFrom: p.recheck.deferredFrom || null },
    today,
    deadline: { date: p.recheck.date, hour: PLANNER_APPROVAL_DEADLINE_HOUR },
    sendsAt: p.recheck.date !== today ? 'date' : isSendableHourKst(now, SEND_HOURS.start, SEND_HOURS.end) ? 'now' : 'morning',
    current: { text: cur?.text ? render(cur.text) : '', subject: String(cur?.subject || ''), edited: !!cur?.edited, state: curState, hash: curHash, rawText: String(cur?.text || '') },
    proposal: { state: prState, text: p.recheck.proposal?.text ? render(p.recheck.proposal.text) : '', subject: String(p.recheck.proposal?.subject || ''), hash: prHash },
    dm: dmTp ? { html: dmHtml } : null,
    recipients,
    copyCost: getCreditCost(PLANNER_SEND_SOURCE),
    deferDates,
    nextSend: nextSendOf(p),
    remaining,
    actions: {
      approve: gate(!!(curHash || prHash) && audienceOk, !audienceOk ? '받는 사람 수를 확인하지 못했거나 0명입니다.' : '보낼 수 있는 문안이 아직 없습니다.', true),
      edit: gate(true, null, true),
      skip: gate(true, null, false),
      defer: gate(deferDates.length > 0, '행사 기간 안에 미룰 수 있는 날이 없습니다.', false),
      cancel: busy ? { ok: false, reason: '지금 보내는 중인 발송이 있어 끝난 뒤 취소할 수 있어요.' }
        : (linkActor && !linkActor.canAct) ? { ok: false, reason: linkActor.reason } : { ok: LIVE_EVENT.includes(p.ev.status), reason: null },
    },
    auth: opts.mode === 'public'
      ? {
        required: true,
        alive: !!(linkActor?.canAct && linkActor.userId && opts.req)
          && await isStrictSenderAuthAlive({ req: opts.req!, userId: linkActor!.userId!, callback }),
        maskedPhone: linkActor?.maskedPhone || null,
      }
      : null,
    dataSource: '받는 사람 수는 수신거부 · 발송 조건을 적용한 지금 기준 실조회, 문안은 실제 모바일 DM 주소를 붙여 나갈 모양 그대로입니다.',
  };
}
