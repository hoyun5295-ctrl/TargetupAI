/**
 * planner-review.ts — 확인 대기로 되돌리기 · 확인 링크 발급 · 리마인드 · 준비 실패 통지 · 승인 직후 실주소 스팸 (★ 2026-10-04 보강 B5·B6 · 설계서 §6-4 · §6-6 · §6-7)
 *
 * 실행부(발송 당일) · 승인 직후 스팸 검사 · 대조 워커가 **같은 되돌림 함수**를 쓴다 — 셋이 각자 상태를 옮기면 한쪽만 고쳐진다.
 *
 * ⛔ 불변
 *   - **승인 = 행사 단위.** 행사가 승인 상태에서 벗어나면 그 행사의 남은 접점(ready · 보류 · 잠금)은 전부 승인 각인을 잃고 planned로 돌아간다.
 *     승인 각인이 남은 채 확인 대기에 있는 접점은 없다(다시 승인할 때 남은 접점 전부를 같은 지문으로 다시 각인한다).
 *   - 실행이 선점한 쌍(producing)은 producing에서만 옮긴다 · 발송 여부를 모르는 행(시도 표식 · 참조 없음)은 건드리지 않는다(사람 판정).
 *   - 잠금 순서 = 월 원장 → 행사 → 접점(승인 · 취소 · 실행 선점과 같은 순서).
 *   - 문안을 버리는 되돌림(스팸 실패)은 행사를 재료 단계(draft)로 — 문안 패스가 새 문안을 만들어 확인 대기로 올린다(사람이 보기 전 재생성 허용).
 *   - 링크는 리비전당 1개(새 링크 = 옛 링크 무효) · 통지가 실패하면 발급을 되돌려 다음 주기가 다시 보낸다.
 */
import { pool, query } from '../config/database';
import { SEND_HOURS } from '../config/defaults';
import { getOpt080Number } from './messageUtils';
import { appendDmLink, kstDateString } from './planner-execution';
import {
  PlannerTouchpointRow, clearExecMetaKeys, guardPlannerMetaOrSkip, loadEventTouchpoints, loadLiveTouchpoints, notifyPlanner,
} from './planner-touchpoint';
import { PlannerEventRow, firstSendDate, mapEventRow, patchEventMeta, staleBuildChannels } from './planner-event';
import { PLANNER_APPROVAL_DEADLINE_HOUR, buildPlannerConfirmLink, hashPreviewToken, issuePlannerPreviewToken, isPreviewValid } from './planner-confirm';
import { carrierGroups, loadPlannerDefaultCallback, runPlannerCopyPass, spamCheckPlannerVerdict } from './planner-copy';
import { PLANNER_REASON } from './planner-reasons';
import { tryAcquireInflight, releaseInflight } from './inflight-lock';
import { computeTouchpointDate, TimingRule } from './marketing-planner';
import { isPastApprovalDeadline } from './planner-approve';

/** 확인 링크를 보내는 시점 — 남은 첫 발송이 이 날수 안으로 들어오면(설계서 Q5 · "이하" 판정이라 서버가 멈춘 날도 다음 주기가 집는다). */
export const PLANNER_LINK_LEAD_DAYS = 3;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** (순수) 'YYYY-MM-DD' → 'M/D(요일)' */
export function formatPlannerDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${wd})`;
}

/** (순수) 두 날짜 사이 날수(KST 문자열 축) */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

// ── 되돌림 ───────────────────────────────────────────────────────────
export type RevertOutcome = 'reverted' | 'cancelled' | 'noop' | 'lost';

/**
 * 행사를 확인 대기(또는 재료 단계)로 되돌린다 — 한 트랜잭션(월 원장 → 행사 → 접점).
 *   claimedIds = 실행이 선점한 쌍(producing에서만 옮긴다) · failedIds = 사유를 남길 행(쌍) · dropCopy = 문안을 버린다(스팸 실패 → draft).
 * 행사가 그 사이 취소됐으면 선점한 행만 생략으로 닫는다('cancelled').
 */
export async function revertEventToReview(input: {
  companyId: string;
  eventId: string;
  claimedIds: string[];
  failedIds: string[];
  reason: string;
  dropCopy: boolean;
  /** ★ 2026-10-04 Codex 2R — 실행이 부를 때 그 선점 토큰. 선점한 행이 지금도 그 토큰의 producing이 아니면 아무것도 바꾸지 않는다('lost') */
  claimToken?: string | null;
}): Promise<RevertOutcome> {
  const client = await pool.connect();
  let outcome: RevertOutcome = 'noop';
  try {
    await client.query('BEGIN');
    const ev = await client.query(
      `SELECT plan_month, status FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid`,
      [input.eventId, input.companyId],
    );
    if (!ev.rows[0]) { await client.query('ROLLBACK'); return 'noop'; }
    await client.query(
      `SELECT status FROM planner_monthly_approvals WHERE company_id = $1::uuid AND plan_month = $2 FOR UPDATE`,
      [input.companyId, String(ev.rows[0].plan_month)],
    );
    const lockedEv = await client.query(
      `SELECT status FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [input.eventId, input.companyId],
    );
    const status = String(lockedEv.rows[0]?.status || '');
    // 소유권 확인(잠금 안 · 그 행을 잠근다) — 회수·재개 뒤 새 실행이 집은 행을 옛 실행이 되돌리지 않는다
    //   회수(recoverStale)는 월 원장을 잡지 않으므로 행 잠금으로 확인과 쓰기 사이를 막는다(잠금 순서 = 월 → 행사 → 접점 그대로).
    if (input.claimToken && input.claimedIds.length > 0) {
      const own = await client.query(
        `SELECT id FROM planner_touchpoints
          WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status = 'producing' AND exec_meta->>'claim_token' = $3
          FOR UPDATE`,
        [input.companyId, input.claimedIds, input.claimToken],
      );
      if (own.rows.length !== input.claimedIds.length) {
        await client.query('ROLLBACK');
        return 'lost';
      }
    }
    if (status === 'cancelled' || status === 'done' || status === 'reported') {
      if (input.claimedIds.length > 0) {
        await client.query(
          `UPDATE planner_touchpoints SET status = 'skipped', lock_reason = $3
            WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status = 'producing'`,
          [input.companyId, input.claimedIds, PLANNER_REASON.cancelledEvent],
        );
      }
      await client.query('COMMIT');
      return 'cancelled';
    }
    const target = input.dropCopy ? 'draft' : status === 'draft' ? 'draft' : 'briefed';
    await client.query(
      `UPDATE planner_touchpoints
          SET status = 'planned',
              lock_reason = CASE WHEN id = ANY($3::uuid[]) THEN $4 ELSE NULL END,
              exec_meta = (COALESCE(exec_meta, '{}'::jsonb) - 'approved' - 'post_approval_spam'
                            - (CASE WHEN $5 AND id = ANY($3::uuid[]) THEN ARRAY['copy']::text[] ELSE ARRAY[]::text[] END))
                          || (CASE WHEN $5 AND id = ANY($3::uuid[])
                                   THEN jsonb_build_object('copy_error', jsonb_build_object('reason', $4::text, 'at', to_jsonb(NOW())))
                                   ELSE '{}'::jsonb END)
        WHERE event_id = $1::uuid AND company_id = $2::uuid
          AND ((id = ANY($6::uuid[]) AND status = 'producing')
               OR (status IN ('ready', 'hold_credit', 'locked')
                   AND NOT ((exec_meta ? 'send_started_at') AND exec_ref IS NULL)))`,
      [input.eventId, input.companyId, input.failedIds, input.reason, input.dropCopy, input.claimedIds],
    );
    // ★ 2026-10-18 B4 — 행사 단위로 되돌리면 쌍 재확인 표식은 의미가 없다(같은 트랜잭션에서 지운다 · 그물이 그 쌍에 링크를 보내지 않게)
    await client.query(
      `UPDATE planner_touchpoints SET exec_meta = exec_meta - 'recheck'
        WHERE event_id = $1::uuid AND company_id = $2::uuid AND (exec_meta ? 'recheck')`,
      [input.eventId, input.companyId],
    );
    await client.query(
      `UPDATE planner_events
          SET status = $3,
              meta = (COALESCE(meta, '{}'::jsonb) - 'approved' - 'preview')
                     || jsonb_build_object('revision', COALESCE((meta->>'revision')::int, 0) + 1),
              updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [input.eventId, input.companyId, target],
    );
    await client.query('COMMIT');
    outcome = 'reverted';
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
  console.log(`[planner-review] 확인 대기로 되돌림 company=${input.companyId} event=${input.eventId} 문안 버림=${input.dropCopy}`);
  return outcome;
}

// ── 쌍 재확인 진입 (★ 2026-10-18 · 설계서 docs/2026-10-18-planner-v2-design.md §3-2) ──────────
export type PairRecheckOutcome = 'entered' | 'past_deadline' | 'lost' | 'cancelled';

/**
 * 스팸 차단(판정 blocked) 한 번이 행사 전체 승인을 풀지 않게 — **그 쌍(캐리어 문자 + 같은 날 DM)만** 재확인 대기로 둔다.
 *   쌍 → planned + exec_meta.recheck(round + 1) · 승인 각인 · 승인 직후 검사 표식을 뗀다 · 문안(copy)은 지우지 않는다(사람 고친 글 보존).
 *   행사 상태 · 다른 접점의 승인 각인은 그대로다(다른 날 발송은 계획대로 간다).
 * 한 트랜잭션 · 잠금 순서 = 월 원장 → 행사 → 접점(승인 · 취소 · 실행 선점과 같다).
 *   fromStatus = 실행부(당일) 'producing' + 선점 토큰 / 승인 직후 검사 'ready'(승인 각인 있음).
 *   마감(그 날 20시) 뒤면 재확인을 열지 않고 그 쌍만 생략한다('past_deadline' · 통지는 호출부 · M2).
 *   행사가 그 사이 취소·종료됐으면 선점한 쌍을 생략으로 닫는다('cancelled').
 */
export async function enterPairRecheck(input: {
  companyId: string;
  eventId: string;
  carrierId: string;
  dmId: string | null;
  fromStatus: 'producing' | 'ready';
  claimToken: string | null;
  origin: 'send_day' | 'post_approval';
  now?: Date;
}): Promise<{ outcome: PairRecheckOutcome; round: number; date: string }> {
  const now = input.now || new Date();
  const ids = [input.carrierId, ...(input.dmId ? [input.dmId] : [])];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ev = await client.query(
      `SELECT plan_month FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid`,
      [input.eventId, input.companyId],
    );
    if (!ev.rows[0]) { await client.query('ROLLBACK'); return { outcome: 'lost', round: 0, date: '' }; }
    await client.query(
      `SELECT status FROM planner_monthly_approvals WHERE company_id = $1::uuid AND plan_month = $2 FOR UPDATE`,
      [input.companyId, String(ev.rows[0].plan_month)],
    );
    const lockedEv = await client.query(
      `SELECT status, starts_on::text AS starts_on, ends_on::text AS ends_on FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [input.eventId, input.companyId],
    );
    const evStatus = String(lockedEv.rows[0]?.status || '');
    const rows = await client.query(
      `SELECT id, status, timing_rule, exec_meta FROM planner_touchpoints
        WHERE company_id = $1::uuid AND event_id = $2::uuid AND id = ANY($3::uuid[]) FOR UPDATE`,
      [input.companyId, input.eventId, ids],
    );
    const owned = (rows.rows as any[]).filter((r) => String(r.status) === input.fromStatus
      && (!input.claimToken || String(r.exec_meta?.claim_token || '') === input.claimToken)
      && (input.fromStatus !== 'ready' || !!r.exec_meta?.approved));
    if (owned.length !== ids.length) { await client.query('ROLLBACK'); return { outcome: 'lost', round: 0, date: '' }; }
    const tokenGuard = input.claimToken ? ` AND exec_meta->>'claim_token' = $5` : '';
    const guardParams = input.claimToken ? [input.claimToken] : [];
    if (evStatus === 'cancelled' || evStatus === 'done' || evStatus === 'reported') {
      await client.query(
        `UPDATE planner_touchpoints SET status = 'skipped', lock_reason = $3
          WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status = $4${tokenGuard}`,
        [input.companyId, ids, PLANNER_REASON.cancelledEvent, input.fromStatus, ...guardParams],
      );
      await client.query('COMMIT');
      return { outcome: 'cancelled', round: 0, date: '' };
    }
    if (!['approved', 'producing', 'scheduled'].includes(evStatus)) { await client.query('ROLLBACK'); return { outcome: 'lost', round: 0, date: '' }; }
    const carrier = (rows.rows as any[]).find((r) => String(r.id) === input.carrierId);
    const date = computeTouchpointDate((carrier?.timing_rule || {}) as TimingRule, String(lockedEv.rows[0].starts_on), String(lockedEv.rows[0].ends_on));
    if (isPastApprovalDeadline(date, now)) {
      const up = await client.query(
        `UPDATE planner_touchpoints
            SET status = 'skipped', lock_reason = $3,
                exec_meta = (COALESCE(exec_meta, '{}'::jsonb) - 'recheck') || jsonb_build_object('recheck_past_deadline_at', to_jsonb(NOW()))
          WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status = $4${tokenGuard}
          RETURNING id`,
        [input.companyId, ids, PLANNER_REASON.recheckPastDeadline, input.fromStatus, ...guardParams],
      );
      if (up.rows.length !== ids.length) throw new Error('쌍 생략이 일부만 적용됐습니다');
      await client.query('COMMIT');
      return { outcome: 'past_deadline', round: 0, date };
    }
    const round = (Number(carrier?.exec_meta?.recheck?.round) || 0) + 1;
    const recheck = { round, date, origin: input.origin, at: now.toISOString() };
    const up = await client.query(
      `UPDATE planner_touchpoints
          SET status = 'planned', lock_reason = $3,
              exec_meta = (COALESCE(exec_meta, '{}'::jsonb) - 'approved' - 'post_approval_spam' - 'spam_error')
                          || jsonb_build_object('recheck', $6::jsonb)
        WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status = $4${input.claimToken ? ` AND exec_meta->>'claim_token' = $5` : ' AND $5::text IS NULL'}
        RETURNING id`,
      [input.companyId, ids, PLANNER_REASON.recheckSpam, input.fromStatus, input.claimToken, JSON.stringify(recheck)],
    );
    if (up.rows.length !== ids.length) throw new Error('쌍 재확인 진입이 일부만 적용됐습니다');
    await client.query('COMMIT');
    console.log(`[planner-review] 쌍 재확인 진입 company=${input.companyId} event=${input.eventId} carrier=${input.carrierId} round=${round} date=${date} (${input.origin})`);
    return { outcome: 'entered', round, date };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
}

/** (순수) 마감 뒤 생략 통지(M2 · 링크 없음) — 다음 발송 날짜가 있으면 「그대로 갑니다」. */
export function recheckPastDeadlineNotice(title: string, date: string, nextDate: string | null): string {
  return `'${title}' ${formatPlannerDay(date)} 문자가 마감(${PLANNER_APPROVAL_DEADLINE_HOUR}시) 뒤 스팸 검사에 막혀 이 날 발송은 보내지 않습니다.`
    + (nextDate ? ` 다음 발송 ${formatPlannerDay(nextDate)}은 그대로 갑니다.` : ' 남은 발송은 없습니다.')
    + ' 이 발송에는 문안비가 빠지지 않았습니다.';
}

/** 되돌린 뒤 바로 다음 단계를 당긴다(best-effort) — 문안 준비 → 링크 발급. 실패해도 대조 워커가 다음 주기에 집는다. */
export function kickPlannerReview(companyId: string, eventId: string): void {
  void (async () => {
    await runPlannerCopyPass({ companyId, eventId }).catch(() => null);
    await runPlannerReviewLinkPass({ companyId, eventId }).catch(() => null);
  })().catch(() => null);
}

/**
 * 남은 접점이 없으면 행사를 닫는다 — 하나라도 나갔으면 발송 완료(done), 하나도 안 나갔으면 취소(cancelled · 사유 표식).
 * 발송 여부를 모르는 행(잠금)이 남아 있으면 닫지 않는다(사람 판정). 조건은 한 문장 안에서 본다.
 */
export async function settleEventIfFinished(companyId: string, eventId: string, closedReason: string): Promise<'done' | 'cancelled' | null> {
  const r = await query(
    `UPDATE planner_events e
        SET status = CASE WHEN EXISTS (SELECT 1 FROM planner_touchpoints s WHERE s.event_id = e.id AND s.company_id = e.company_id AND s.status = 'sent')
                          THEN 'done' ELSE 'cancelled' END,
            meta = (COALESCE(e.meta, '{}'::jsonb) - 'preview')
                   || CASE WHEN EXISTS (SELECT 1 FROM planner_touchpoints s WHERE s.event_id = e.id AND s.company_id = e.company_id AND s.status = 'sent')
                           THEN '{}'::jsonb ELSE jsonb_build_object('closedReason', $3::text) END,
            updated_at = NOW()
      WHERE e.id = $1::uuid AND e.company_id = $2::uuid
        AND e.status NOT IN ('done', 'reported', 'cancelled')
        AND NOT EXISTS (SELECT 1 FROM planner_touchpoints p WHERE p.event_id = e.id AND p.company_id = e.company_id AND p.status NOT IN ('sent', 'skipped'))
      RETURNING e.status`,
    [eventId, companyId, closedReason],
  );
  return r.rows[0] ? (String(r.rows[0].status) as 'done' | 'cancelled') : null;
}

// ── 확인 링크 · 리마인드 · 준비 실패 통지 ─────────────────────────────
function linkBody(ev: PlannerEventRow, first: string, link: string, reminder: boolean): string {
  const head = reminder
    ? `'${ev.title}' 행사가 ${formatPlannerDay(first)} ${SEND_HOURS.start}시에 첫 발송됩니다. 아직 승인 전입니다.`
    : `'${ev.title}' 행사의 실제 발송 내용이 준비됐습니다. 첫 발송 ${formatPlannerDay(first)} ${SEND_HOURS.start}시.`;
  return [
    head,
    `내용 확인: ${link}`,
    `승인은 PC 한줄로 캘린더의 '할 일'에서 하실 수 있습니다. 승인 마감 ${formatPlannerDay(first)} ${PLANNER_APPROVAL_DEADLINE_HOUR}시.`,
  ].join('\n');
}

async function sendLink(ev: PlannerEventRow, first: string, reminder: boolean): Promise<boolean> {
  const issued = await issuePlannerPreviewToken(ev, first, { reminder });
  if (!issued) return false;
  const ok = await notifyPlanner(ev.companyId, ev.createdBy, reminder ? '[마케팅 플래너] 내일 첫 발송 · 승인 전' : '[마케팅 플래너] 발송 내용 확인', linkBody(ev, first, buildPlannerConfirmLink(issued.token), reminder));
  if (!ok) {
    // 통지가 안 갔으면 발급을 되돌린다 — 담당자가 못 받은 링크로 "보냈다"고 기록하지 않는다(다음 주기 재시도).
    await query(
      `UPDATE planner_events SET meta = COALESCE(meta, '{}'::jsonb) - 'preview'
        WHERE id = $1::uuid AND company_id = $2::uuid AND meta->'preview'->>'tokenHash' = $3`,
      [ev.id, ev.companyId, hashPreviewToken(issued.token)],
    ).catch(() => null);
    console.warn(`[planner-review] 확인 링크 통지 실패 event=${ev.id} — 다음 주기 재시도`);
    return false;
  }
  console.log(`[planner-review] 확인 링크 ${reminder ? '리마인드' : '발급'} event=${ev.id} 첫 발송 ${first}`);
  return true;
}

/**
 * 링크 패스 — 확인 대기(briefed) 행사 중 남은 첫 발송이 D+3 안이면 링크 1통(리비전당) · D-1이면 리마인드 1회.
 * 재료 단계(draft)인데 D+3 안이면 준비 실패 사유를 리비전당 1회 알린다(회의론자 M10).
 */
export async function runPlannerReviewLinkPass(opts?: { companyId?: string; eventId?: string }): Promise<{ issued: number; reminded: number; warned: number }> {
  if (!(await guardPlannerMetaOrSkip('planner-review-link'))) return { issued: 0, reminded: 0, warned: 0 };
  const today = kstDateString();
  const params: any[] = [today];
  let where = `status IN ('briefed', 'draft') AND ends_on >= $1::date AND starts_on <= ($1::date + ${PLANNER_LINK_LEAD_DAYS} + 30)`;
  if (opts?.companyId) { params.push(opts.companyId); where += ` AND company_id = $${params.length}::uuid`; }
  if (opts?.eventId) { params.push(opts.eventId); where += ` AND id = $${params.length}::uuid`; }
  const r = await query(
    `SELECT id, company_id, plan_month, title, starts_on::text AS starts_on, ends_on::text AS ends_on,
            benefit_text, products, status, created_by, meta
       FROM planner_events WHERE ${where} ORDER BY starts_on ASC LIMIT 300`,
    params,
  );
  let issued = 0, reminded = 0, warned = 0;
  for (const row of r.rows as any[]) {
    const ev = mapEventRow(row);
    try {
      const tps = (await loadEventTouchpoints(ev.companyId, ev.id)).filter((t) => t.status === 'planned');
      const first = firstSendDate(ev, tps);
      if (!first || first < today) continue;
      const left = daysBetween(today, first);
      if (left > PLANNER_LINK_LEAD_DAYS) continue;
      const revision = Number(ev.meta.revision) || 0;
      if (ev.status === 'briefed') {
        const preview = ev.meta.preview;
        if (!preview || !isPreviewValid(ev, String(preview.tokenHash || ''))) {
          if (await sendLink(ev, first, false)) issued++;
        } else if (left <= 1 && !preview.remindedAt) {
          if (await sendLink(ev, first, true)) reminded++;
        }
        continue;
      }
      // 재료 단계 — 사유는 리비전당 1회
      if ((ev.meta as any).readyNotice?.revision === revision) continue;
      const missing = staleBuildChannels(ev, tps.map((t) => ({ ...t })));
      const copyError = tps.map((t) => t.execMeta?.copy_error?.reason).find(Boolean);
      const why = missing.length > 0
        ? `${missing.map((c) => (c === 'dm' ? '모바일 DM' : '메일')).join('·')} 재료가 없어 완성본을 만들지 못했습니다. 캘린더에서 재료를 넣어 주세요.`
        : copyError
          ? `${copyError}`
          : '발송 내용을 아직 준비하고 있습니다. 준비되면 확인 링크를 보내 드립니다.';
      const ok = await notifyPlanner(ev.companyId, ev.createdBy, '[마케팅 플래너] 발송 준비 확인',
        `'${ev.title}' 첫 발송이 ${formatPlannerDay(first)}입니다. ${why}`);
      if (ok) {
        await patchEventMeta({ companyId: ev.companyId, eventId: ev.id, patch: { readyNotice: { revision, at: new Date().toISOString() } } }).catch(() => null);
        warned++;
      }
    } catch (e: any) {
      console.warn(`[planner-review] 링크 패스 실패 event=${ev.id}:`, e?.message || e);
    }
  }
  if (issued + reminded + warned > 0) console.log(`[planner-review] 링크 ${issued} · 리마인드 ${reminded} · 준비 통지 ${warned}`);
  return { issued, reminded, warned };
}

// ── 승인 직후 실주소 스팸 (§6-6) ───────────────────────────────────────
/**
 * 승인 커밋 뒤 표식(`post_approval_spam = 'pending'`)이 붙은 캐리어를 DM 실주소가 붙은 최종 문안으로 검사한다.
 * 통과 = 표식 해제 · 실패 = 그 행사를 재료 단계로 되돌리고(문안 버림) 문안 패스가 새 문안을 만든다 · 검사 자체 오류 = 다음 주기 재시도
 * (발송 당일 실행부가 다시 검사하므로 여기서 못 본 건이 그대로 나가지 않는다).
 */
export async function runPostApprovalSpamPass(opts?: { companyId?: string; eventId?: string; limit?: number }): Promise<{ passed: number; failed: number }> {
  if (!(await guardPlannerMetaOrSkip('planner-post-approval-spam'))) return { passed: 0, failed: 0 };
  const rows = await loadLiveTouchpoints({
    statuses: ['ready'], scheduledFrom: kstDateString(), requireApproved: true,
    execMetaFlag: { key: 'post_approval_spam', value: 'pending' },
    companyId: opts?.companyId, eventId: opts?.eventId, limit: Math.min(Math.max(1, opts?.limit || 20), 50),
  });
  let passed = 0, failed = 0;
  for (const carrier of rows) {
    const lockKey = `planner-spam:${carrier.id}`;
    if (!tryAcquireInflight(lockKey)) continue;
    try {
      const r = await checkCarrierAfterApproval(carrier);
      if (r === 'pass') passed++;
      else if (r === 'fail') failed++;
    } catch (e: any) {
      console.warn(`[planner-review] 승인 직후 스팸 검사 오류 tp=${carrier.id}(다음 주기 재시도):`, e?.message || e);
    } finally {
      releaseInflight(lockKey);
    }
  }
  return { passed, failed };
}

async function checkCarrierAfterApproval(carrier: PlannerTouchpointRow): Promise<'pass' | 'fail' | 'skip'> {
  const copy = carrier.execMeta?.copy;
  const url = String(carrier.execMeta?.dm_url || '');
  if (!copy?.text || !url) {
    await clearExecMetaKeys(carrier.companyId, carrier.id, ['post_approval_spam']);
    return 'skip';
  }
  const callback = await loadPlannerDefaultCallback(carrier.companyId);
  const opt080 = await getOpt080Number(carrier.createdBy || null, carrier.companyId);
  if (!callback || !opt080) return 'skip'; // 준비 판정 실패는 발송 당일 실행부가 사유와 함께 잠근다
  const body = appendDmLink(String(copy.text), url);
  // ★ 2026-10-18 판정 3분할(B6) — 검사 장애(error)는 차단이 아니다: 표식을 남겨 다음 주기에 다시 본다(당일 실행부도 다시 검사한다)
  const check = await spamCheckPlannerVerdict({
    tp: carrier, body, subject: String(copy.subject || ''), callback, rejectNumber: opt080, link: url, withDmLink: true, regenerate: false,
  });
  if (check.verdict === 'pass') {
    await clearExecMetaKeys(carrier.companyId, carrier.id, ['post_approval_spam'], { post_approval_spam_at: new Date().toISOString() });
    return 'pass';
  }
  if (check.verdict === 'error') return 'skip';
  // ★ 2026-10-18 차단 = 그 쌍만 재확인(행사 승인 · 다른 날 발송은 그대로 · 옛: 행사 전체를 재료 단계로 되돌렸다)
  //   통지 · 새 문안 · 링크는 재확인 패스(planner-recheck · 실행 워커 10분 주기)가 한다.
  const siblings = (await loadEventTouchpoints(carrier.companyId, carrier.eventId));
  const pair = carrierGroups(siblings).find((g) => g.carrier.id === carrier.id);
  const out = await enterPairRecheck({
    companyId: carrier.companyId, eventId: carrier.eventId, carrierId: carrier.id, dmId: pair?.dm?.id || null,
    fromStatus: 'ready', claimToken: null, origin: 'post_approval',
  });
  if (out.outcome === 'past_deadline') {
    const rest = siblings.filter((t) => t.id !== carrier.id && t.id !== pair?.dm?.id && !['sent', 'skipped'].includes(t.status));
    await notifyPlanner(carrier.companyId, carrier.createdBy, '[마케팅 플래너] 발송 생략',
      recheckPastDeadlineNotice(carrier.title, out.date, firstSendDate(carrier, rest)));
  }
  return 'fail';
}
