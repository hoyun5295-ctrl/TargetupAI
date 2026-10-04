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
import { carrierGroups, loadPlannerDefaultCallback, runPlannerCopyPass, spamCheckPlannerCopy } from './planner-copy';
import { PLANNER_REASON } from './planner-reasons';
import { tryAcquireInflight, releaseInflight } from './inflight-lock';

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
  const ok = await spamCheckPlannerCopy({
    tp: carrier, body, subject: String(copy.subject || ''), callback, rejectNumber: opt080, link: url, withDmLink: true, regenerate: false,
  });
  if (ok) {
    await clearExecMetaKeys(carrier.companyId, carrier.id, ['post_approval_spam'], { post_approval_spam_at: new Date().toISOString() });
    return 'pass';
  }
  const siblings = (await loadEventTouchpoints(carrier.companyId, carrier.eventId));
  const pair = carrierGroups(siblings).find((g) => g.carrier.id === carrier.id);
  const failedIds = [carrier.id, ...(pair?.dm ? [pair.dm.id] : [])];
  const out = await revertEventToReview({
    companyId: carrier.companyId, eventId: carrier.eventId, claimedIds: [], failedIds, reason: PLANNER_REASON.spamFailed, dropCopy: true,
  });
  if (out === 'reverted') {
    await notifyPlanner(carrier.companyId, carrier.createdBy, '[마케팅 플래너] 다시 확인이 필요합니다',
      `'${carrier.title}' 승인한 문자 문안이 실제 모바일 DM 주소를 붙인 검사에서 스팸으로 판정됐습니다. 새 문안을 만들어 확인 링크를 다시 보내 드립니다. 다시 승인해도 크레딧은 두 번 빠지지 않습니다.`);
    kickPlannerReview(carrier.companyId, carrier.eventId);
  }
  return 'fail';
}
