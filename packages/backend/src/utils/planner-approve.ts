/**
 * planner-approve.ts — 플래너 행사 승인 · 승인 풀기 · 행사 취소 CT (★ 2026-10-04 보강 B4 · 설계서 §6-5 · §6-9 · §12 D1)
 *
 * 월간 결재(계획만 보고 한 달을 승인)를 폐지하고 **행사별 승인**으로 바꿨다(Q2). 담당자는 실물(문자 문안 · 모바일 DM · 메일 ·
 * 받는 사람 수 · 비용)을 보고 행사 하나를 승인한다. 승인 때 대행료(그 달 첫 승인 · 회차 키) · DM 발행비 · 메일 완성비가 빠진다(D1).
 *
 * ⛔ 불변(설계서 §3 · 회의론자 C1·C2·C3)
 *   - **월 행 잠금 트랜잭션 하나**(C1) — 그 달 원장 행을 만들고(없으면) FOR UPDATE로 잠근다. 월 상태로 선점하지 않는다
 *     (옛 claimApproval은 pending만 선점해 첫 승인 뒤 둘째 행사가 영원히 409였다). 같은 달 두 행사 동시 승인은 잠금으로 줄을 선다.
 *     잠금 순서 = 월 원장 → 행사 → 접점 → (차감) companies — 취소·환불·실행 선점과 같은 순서라 교착이 없다.
 *   - **지문 · 준비 판정은 언제나 다시 한다**(C2) — "이미 낸 달 = 복구" 생략 분기를 두지 않는다. 화면이 본 지문(seenHash)과
 *     지금 지문이 다르면 409(화면이 다시 읽는다). 견적이 화면 금액(shownTotal)보다 크면 409.
 *   - **DM 발행 · 메일 완성은 편집기와 같은 코어 CT**(C3 · dm-publish-core · email-complete-core) — 차단 판정 · 단가 분기 · 경품 동기화 · 멱등키가 한 벌이다.
 *   - 접점마다 승인 지문(exec_meta.approved)을 각인한다 — 실행부는 같은 함수로 다시 계산해 대조한다(§3-2 승인한 것 = 나가는 것).
 *   - 대행료(`planner:{회사}:{월}#회차`)는 **승인 트랜잭션 안에서** 차감한다(★ Codex 1R H1 · 승인이 롤백되면 대행료도 없다).
 *     DM 발행(`dm-publish:{id}`) · 메일 완성(`email-campaign-complete:{id}`)은 편집기와 같은 코어가 각자 멱등키로 확정한다 —
 *     막을 사유는 같은 판정 함수로 돈이 움직이기 전에 먼저 보고, 그 뒤 롤백되면 발행·완성은 남되 다시 승인하면 이어받는다(재차감 0 · §6-5).
 *   - 견적(회차 · 결제 상태)은 월 원장 잠금 안에서 다시 낸다(★ Codex 1R H2) · 생성 중(building)이면 승인하지 않는다(H8).
 *   - 사용자 범위(§3-10) — 관리자 = 회사 전체 · 담당자 = 자기 행사(호출부가 ownerId로 준다).
 */
import { pool } from '../config/database';
import { checkCredit } from './ai-credit';
import { _deductWithClient } from './ai-credit-tx';
import { getEmailCampaign } from './email-channel';
import { completeEmailCampaignCore, emailCompleteBlockOf } from './email/email-complete-core';
import { publishDmCore, dmPublishBlockOf } from './dm/dm-publish-core';
import { stopDm } from './dm/dm-builder';
import { PLANNER_AGENCY_SOURCE, getAgencyCredits } from './planner-approval';
import { kstDateString } from './planner-execution';
import { loadEventTouchpoints, notifyPlanner } from './planner-touchpoint';
import { loadPlannerEvent, firstSendDate, isBuilding } from './planner-event';
import { computeTouchpointFingerprints, eventFingerprint, quoteEventApproval, PLANNER_APPROVAL_DEADLINE_HOUR } from './planner-confirm';
import { carrierGroups, copyInputHash, isCopyValid } from './planner-copy';
import { firstBlockedChannel } from './planner-channel-gate';
import { countEventSmsAudience } from './planner-audience';
import { countCustomerEmailRecipients } from './email-channel';
import { PLANNER_REASON } from './planner-reasons';

export class PlannerApproveError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
    this.name = 'PlannerApproveError';
  }
}

/** (순수) 승인 마감이 지났는가 — 첫 발송일 20시(KST) 이후면 승인하지 않는다(그날 발송 창이 곧 닫힌다). */
export function isPastApprovalDeadline(firstSend: string | null, now: Date = new Date()): boolean {
  if (!firstSend) return false;
  const today = kstDateString(now);
  if (firstSend < today) return true;
  if (firstSend > today) return false;
  const kstHour = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
  return kstHour >= PLANNER_APPROVAL_DEADLINE_HOUR;
}

export interface ApproveResult {
  status: 'approved';
  already: boolean;
  charged: { agency: number; dm: number; email: number };
  dmUrl: string | null;
}

/**
 * 행사 승인. 순서 = 화면 지문·마감·준비·대상·견적·잔액 확인 → [월 행 잠금 → 행사 행 잠금 → 회차 → 대행 차감 → 메일 완성 → DM 발행 → 각인] 커밋.
 */
export async function approvePlannerEvent(input: {
  companyId: string;
  userId: string | null;
  ownerId: string | null;
  eventId: string;
  seenHash: string;
  shownTotal: number;
}): Promise<ApproveResult> {
  const ev = await loadPlannerEvent(input.companyId, input.eventId, input.ownerId);
  if (!ev) throw new PlannerApproveError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  if (ev.status === 'approved' || ev.status === 'scheduled') {
    return { status: 'approved', already: true, charged: { agency: 0, dm: 0, email: 0 }, dmUrl: null };
  }
  if (ev.status !== 'briefed') {
    throw new PlannerApproveError(409, 'NOT_READY', '아직 확인할 준비가 끝나지 않았습니다. 완성본과 문안이 준비되면 승인할 수 있습니다.');
  }
  const tps = await loadEventTouchpoints(ev.companyId, ev.id);
  const live = tps.filter((t) => t.status !== 'skipped');
  // 승인 = 행사 단위 · 남은 접점(아직 안 나간 것)은 전부 planned여야 한다(되돌림 CT가 그렇게 맞춘다 · planner-review).
  const pending = live.filter((t) => t.status !== 'sent');
  if (pending.length === 0) throw new PlannerApproveError(409, 'NOTHING_TO_SEND', '남은 발송이 없습니다.');
  if (pending.some((t) => t.status !== 'planned')) {
    throw new PlannerApproveError(409, 'IN_PROGRESS', '지금 처리 중인 발송이 있습니다. 잠시 후 화면을 새로고침해 주세요.');
  }
  const first = firstSendDate(ev, pending);
  if (isPastApprovalDeadline(first)) {
    throw new PlannerApproveError(409, 'DEADLINE_PASSED', '승인 마감이 지났습니다. 날짜를 고쳐 다시 담아 주세요.');
  }
  // C2 — 지문은 언제나 다시 맞춘다
  const fps = await computeTouchpointFingerprints(ev.companyId, live);
  if (eventFingerprint(ev, fps) !== String(input.seenHash || '')) {
    throw new PlannerApproveError(409, 'CHANGED', '보신 뒤 내용이 바뀌었습니다. 바뀐 내용을 다시 확인한 뒤 승인해 주세요.');
  }
  // 문안이 다 준비됐는가(확인 대기 진입 뒤 고친 행사는 draft로 돌아가므로 여기까지 오면 준비돼 있어야 한다 · 그래도 다시 본다)
  if (carrierGroups(pending).some(({ carrier, dm }) => !isCopyValid(carrier.execMeta, copyInputHash(ev, {
    timing: carrier.timing, scheduledOn: carrier.scheduledOn, withDmLink: !!dm || carrier.channel === 'dm',
  })))) {
    throw new PlannerApproveError(409, 'NOT_READY', '문자 문안이 아직 준비되지 않았습니다. 잠시 후 다시 열어 주세요.');
  }
  // 준비 판정(F2 · 재료 창·승인·발송 당일 같은 함수)
  const blocked = await firstBlockedChannel(pending.map((t) => t.channel), { companyId: ev.companyId, userId: ev.createdBy, phase: 'send' });
  if (blocked) {
    throw new PlannerApproveError(400, 'CHANNEL_LOCKED', blocked.readiness.reason || '지금은 보낼 수 없는 채널이 있습니다.', { settingsPath: blocked.readiness.settingsPath, channel: blocked.channel });
  }
  // 대상(F7) — 영구 차단과 일시 실패를 가른다
  if (pending.some((t) => t.channel === 'sms' || t.channel === 'dm')) {
    const a = await countEventSmsAudience({ companyId: ev.companyId, createdBy: ev.createdBy, eventId: ev.id });
    if (a.state === 'blocked') throw new PlannerApproveError(409, 'SCOPE_BLOCKED', PLANNER_REASON.scopeBlocked);
    if (a.state === 'error') throw new PlannerApproveError(503, 'AUDIENCE_UNAVAILABLE', '받는 사람 수를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    if (a.count === 0) throw new PlannerApproveError(409, 'AUDIENCE_ZERO', '문자를 받을 고객이 0명이라 승인할 수 없습니다. 고객 수신 동의를 확인해 주세요.');
  }
  if (pending.some((t) => t.channel === 'email')) {
    const n = await countCustomerEmailRecipients(ev.companyId).catch(() => null);
    if (n === null) throw new PlannerApproveError(503, 'AUDIENCE_UNAVAILABLE', '받는 사람 수를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    if (n === 0) throw new PlannerApproveError(409, 'AUDIENCE_ZERO', '메일을 받을 고객이 0명이라 승인할 수 없습니다. 고객 메일 수신 동의를 확인해 주세요.');
  }
  // 견적 결박 — 화면이 본 금액보다 크면 다시 확인받는다
  const quote = await quoteEventApproval(ev, live);
  if (quote.total > (Number(input.shownTotal) || 0)) {
    throw new PlannerApproveError(409, 'QUOTE_CHANGED', '승인 비용이 바뀌었습니다. 금액을 다시 확인한 뒤 승인해 주세요.', { quote });
  }
  if (quote.total > 0) await checkCredit(ev.companyId, quote.total); // 부족 = InsufficientCreditError(라우트 402)

  const charged = { agency: 0, dm: 0, email: 0 };
  let dmUrl: string | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ① 월 원장 행 — 없으면 만들고 잠근다(C1 · 상태로 선점하지 않는다). 이 달의 승인 · 취소 · 환불 · 실행 선점이 모두 이 행에서 줄을 선다.
    await client.query(
      `INSERT INTO planner_monthly_approvals (company_id, plan_month, status, agency_credits)
       VALUES ($1::uuid, $2, 'pending', $3)
       ON CONFLICT (company_id, plan_month) DO NOTHING`,
      [ev.companyId, ev.planMonth, getAgencyCredits()],
    );
    const month = await client.query(
      `SELECT status FROM planner_monthly_approvals WHERE company_id = $1::uuid AND plan_month = $2 FOR UPDATE`,
      [ev.companyId, ev.planMonth],
    );
    if (!month.rows[0]) throw new PlannerApproveError(503, 'MONTH_LOCK_FAILED', '잠시 후 다시 시도해 주세요.');
    // ② 행사 행 — 같은 상태·같은 리비전일 때만(그 사이 고쳤으면 다시 확인) · 완성본을 만드는 중이면 멈춘다(Codex 1R H8)
    const evLock = await client.query(
      `SELECT status, COALESCE((meta->>'revision')::int, 0) AS revision, meta->'building' AS building FROM planner_events
        WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [ev.id, ev.companyId],
    );
    if (!evLock.rows[0] || String(evLock.rows[0].status) !== 'briefed' || Number(evLock.rows[0].revision) !== (Number(ev.meta.revision) || 0)) {
      throw new PlannerApproveError(409, 'CHANGED', '보신 뒤 내용이 바뀌었습니다. 바뀐 내용을 다시 확인한 뒤 승인해 주세요.');
    }
    if (isBuilding({ building: evLock.rows[0].building || null })) {
      throw new PlannerApproveError(409, 'BUILDING', '완성본을 만드는 중이에요. 다 만든 뒤 확인하고 승인해 주세요.');
    }
    // ③ 접점 행 잠금 — 각인할 행이 그대로 planned인지 잠근 채 확인(이 뒤 각인 UPDATE가 실패할 수 없게 · 돈이 움직이기 전)
    const tpLock = await client.query(
      `SELECT id, status FROM planner_touchpoints WHERE event_id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [ev.id, ev.companyId],
    );
    const lockedStatus = new Map((tpLock.rows as any[]).map((r) => [String(r.id), String(r.status)]));
    if (pending.some((t) => lockedStatus.get(t.id) !== 'planned')) {
      throw new PlannerApproveError(409, 'CHANGED', '그 사이 발송 상태가 바뀌었습니다. 화면을 새로고침해 주세요.');
    }
    // ④ 견적을 잠금 안에서 다시 낸다(Codex 1R H2) — 회차 · 대행료 결제 상태는 이 달 잠금 아래에서만 바뀐다(환불 · 다른 행사 승인이 같은 행을 잠근다).
    //   화면이 본 금액보다 크면 돈이 움직이기 전에 멈춘다. 대행료 키도 여기서 정한 회차 키 하나를 쓴다.
    const lockedQuote = await quoteEventApproval(ev, pending);
    if (lockedQuote.total > (Number(input.shownTotal) || 0)) {
      throw new PlannerApproveError(409, 'QUOTE_CHANGED', '승인 비용이 바뀌었습니다. 금액을 다시 확인한 뒤 승인해 주세요.', { quote: lockedQuote });
    }
    // ⑤ 사전 확인 — 메일 완성 · DM 발행을 막을 사유를 같은 판정 함수로 먼저 본다(돈이 움직인 뒤 멈추지 않게)
    const emailTp = pending.find((t) => t.channel === 'email' && t.assetRef);
    const campaign = emailTp ? await getEmailCampaign(ev.companyId, String(emailTp.assetRef)) : null;
    if (emailTp && !campaign) throw new PlannerApproveError(409, 'EMAIL_MISSING', '메일 완성본을 찾을 수 없습니다. 메일을 다시 만들어 주세요.');
    if (campaign) {
      const blockMail = await emailCompleteBlockOf(ev.companyId, campaign);
      if (blockMail) throw new PlannerApproveError(blockMail.status, blockMail.code, blockMail.error);
    }
    const dmTp = pending.find((t) => t.channel === 'dm' && t.assetRef);
    if (dmTp) {
      const blockDm = await dmPublishBlockOf(ev.companyId, String(dmTp.assetRef));
      if (blockDm) throw new PlannerApproveError(blockDm.status, blockDm.code || 'DM_PUBLISH_FAILED', blockDm.error, { items: blockDm.items || [] });
    }
    // ⑥ DM 발행 · 메일 완성(코어 CT · 편집기와 같은 문 · 각자 멱등키 · 다른 연결에서 확정된다).
    //   이 뒤 롤백되면 발행·완성은 남고(비환불 고지 · 다시 승인하면 같은 키라 두 번 빠지지 않는다) 대행료는 빠지지 않는다(⑨가 이 트랜잭션 안).
    if (dmTp) {
      const r = await publishDmCore({ companyId: ev.companyId, dmId: String(dmTp.assetRef), userId: input.userId, expectedFee: lockedQuote.dm?.cost ?? 0 });
      if (!r.ok) throw new PlannerApproveError(r.status, r.code || 'DM_PUBLISH_FAILED', r.error, { items: r.items || [] });
      charged.dm = r.cost;
      dmUrl = r.shortUrl;
    }
    if (campaign) {
      const r = await completeEmailCampaignCore({ companyId: ev.companyId, userId: input.userId, campaign });
      if (!r.ok) throw new PlannerApproveError(r.status, r.code, r.error);
      charged.email = r.cost;
    }
    // ⑦ 각인 — 접점마다 승인 지문 · DM 실주소 · 승인 직후 실주소 스팸 표식(§6-6) · 행은 ③에서 잠갔다
    const at = new Date().toISOString();
    const revision = Number(ev.meta.revision) || 0;
    const groups = carrierGroups(pending);
    const carriesDm = new Set(groups.filter((g) => g.dm || g.carrier.channel === 'dm').map((g) => g.carrier.id));
    for (const t of pending) {
      const patch: Record<string, unknown> = { approved: { hash: fps.get(t.id) || null, at, by: input.userId, revision } };
      if (dmUrl && (t.channel === 'dm' || carriesDm.has(t.id))) patch.dm_url = dmUrl;
      if (dmUrl && carriesDm.has(t.id)) patch.post_approval_spam = 'pending';
      const up = await client.query(
        `UPDATE planner_touchpoints
            SET status = 'ready', lock_reason = NULL, exec_meta = COALESCE(exec_meta, '{}'::jsonb) || $3::jsonb
          WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'planned'
          RETURNING id`,
        [t.id, ev.companyId, JSON.stringify(patch)],
      );
      if (up.rows.length === 0) throw new PlannerApproveError(409, 'CHANGED', '그 사이 발송 상태가 바뀌었습니다. 화면을 새로고침해 주세요.');
    }
    await client.query(
      `UPDATE planner_events
          SET status = 'approved',
              meta = (COALESCE(meta, '{}'::jsonb) - 'preview') || jsonb_build_object('approved', $3::jsonb),
              updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'briefed'`,
      [ev.id, ev.companyId, JSON.stringify({ hash: eventFingerprint(ev, fps), at, by: input.userId, revision })],
    );
    // ⑧ 대행료 — **이 트랜잭션 안에서** 차감한다(Codex 1R H1 · 승인이 롤백되면 대행료도 없다 · 차감만 남은 달이 생기지 않는다).
    //   그 달 그 회차 첫 승인만(이미 냈으면 견적 0 · 같은 키 = duplicate). 잔액 부족 = 던진다 → 전체 롤백(라우트 402).
    let agencyPaid = lockedQuote.agency.paid;
    if (lockedQuote.agency.cost > 0) {
      const r = await _deductWithClient(client, {
        companyId: ev.companyId, cost: lockedQuote.agency.cost, source: PLANNER_AGENCY_SOURCE,
        createdBy: input.userId, idempotencyKey: lockedQuote.agency.key,
      }, new Date(), { manageTx: false });
      if (r.deducted) { agencyPaid = true; charged.agency = lockedQuote.agency.cost; }
      else if (r.skipReason === 'duplicate') agencyPaid = true;
      else if (r.skipReason !== 'not_applicable') {
        throw new PlannerApproveError(503, 'DEDUCT_FAILED', '크레딧 차감을 확정하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    }
    // ⑨ 월 원장 — 그 달 대행 계약(승인 상태 · 회차 키 · 승인한 행사 목록)
    await client.query(
      `UPDATE planner_monthly_approvals
          SET status = 'approved',
              approved_by = COALESCE(approved_by, $3),
              approved_at = COALESCE(approved_at, NOW()),
              agency_credits = $4,
              deduct_idempotency_key = $5,
              deducted_at = CASE WHEN $6 AND deducted_at IS NULL THEN NOW() ELSE deducted_at END,
              event_ids = CASE WHEN $7::uuid = ANY(event_ids) THEN event_ids ELSE array_append(event_ids, $7::uuid) END,
              approve_attempt = NULL,
              updated_at = NOW()
        WHERE company_id = $1::uuid AND plan_month = $2`,
      [ev.companyId, ev.planMonth, input.userId, getAgencyCredits(), lockedQuote.agency.key, agencyPaid, ev.id],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    if (charged.dm + charged.email > 0) {
      // 발행·완성은 남는다(비환불 · 같은 키) — 다시 승인하면 이어받는다. 대행료는 이 트랜잭션과 함께 롤백됐다. 운영 추적용 표식.
      console.error(`[planner-approve][CONFIRM-MISS] company=${ev.companyId} event=${ev.id} charged=${JSON.stringify(charged)}: 승인 롤백 · 발행·완성만 남음 · 재승인으로 이어받음`);
    }
    throw err;
  } finally {
    client.release();
  }
  console.log(`[planner-approve] 행사 승인 company=${ev.companyId} event=${ev.id} 대행 ${charged.agency} · DM ${charged.dm} · 메일 ${charged.email}`);
  return { status: 'approved', already: false, charged, dmUrl };
}

/**
 * 승인 풀기 — 첫 발송 전 · 발송 시도 0일 때만. 환불·재차감 0(같은 키라 다시 승인해도 두 번 빠지지 않는다 · §6-5).
 * 월 원장 잠금 안에서 한다 — 실행 선점과 직렬화된다(선점이 먼저면 producing을 보고 거절한다).
 */
export async function unapprovePlannerEvent(input: { companyId: string; ownerId: string | null; eventId: string }): Promise<{ status: 'briefed' }> {
  const ev = await loadPlannerEvent(input.companyId, input.eventId, input.ownerId);
  if (!ev) throw new PlannerApproveError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  if (ev.status !== 'approved') throw new PlannerApproveError(409, 'NOT_APPROVED', '승인한 행사만 풀 수 있습니다.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT status FROM planner_monthly_approvals WHERE company_id = $1::uuid AND plan_month = $2 FOR UPDATE`,
      [ev.companyId, ev.planMonth],
    );
    const evLock = await client.query(
      `SELECT status FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [ev.id, ev.companyId],
    );
    if (String(evLock.rows[0]?.status || '') !== 'approved') throw new PlannerApproveError(409, 'NOT_APPROVED', '승인한 행사만 풀 수 있습니다.');
    const started = await client.query(
      `SELECT 1 FROM planner_touchpoints
        WHERE event_id = $1::uuid AND company_id = $2::uuid
          AND (status IN ('producing', 'sent') OR exec_ref IS NOT NULL OR (exec_meta ? 'send_started_at'))
        LIMIT 1`,
      [ev.id, ev.companyId],
    );
    if (started.rows.length > 0) {
      throw new PlannerApproveError(409, 'ALREADY_STARTED', '이미 발송이 시작돼 승인을 풀 수 없습니다. 남은 발송을 멈추려면 행사를 취소해 주세요.');
    }
    await client.query(
      `UPDATE planner_touchpoints
          SET status = 'planned', exec_meta = COALESCE(exec_meta, '{}'::jsonb) - 'approved' - 'post_approval_spam'
        WHERE event_id = $1::uuid AND company_id = $2::uuid AND status IN ('ready', 'hold_credit', 'locked')`,
      [ev.id, ev.companyId],
    );
    await client.query(
      `UPDATE planner_events
          SET status = 'briefed',
              meta = (COALESCE(meta, '{}'::jsonb) - 'approved' - 'preview')
                     || jsonb_build_object('revision', COALESCE((meta->>'revision')::int, 0) + 1),
              updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'approved'`,
      [ev.id, ev.companyId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
  console.log(`[planner-approve] 승인 풀기 company=${ev.companyId} event=${ev.id}`);
  return { status: 'briefed' };
}

/**
 * 행사 취소(발송 전 또는 남은 발송) — 남은 접점을 생략으로 닫고 모바일 DM 발행을 멈춘다(§6-9).
 * 이미 낸 DM 발행비 · 메일 완성비는 돌려드리지 않는다(승인 창 고지 · D1). 진행 중(producing)이 있으면 그 발송이 끝난 뒤 다시.
 */
export async function cancelPlannerEvent(input: { companyId: string; userId: string | null; ownerId: string | null; eventId: string }): Promise<{ status: 'cancelled'; skipped: number }> {
  const ev = await loadPlannerEvent(input.companyId, input.eventId, input.ownerId);
  if (!ev) throw new PlannerApproveError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  if (ev.status === 'cancelled') return { status: 'cancelled', skipped: 0 };
  if (ev.status === 'done' || ev.status === 'reported') throw new PlannerApproveError(409, 'ALREADY_DONE', '모든 발송이 끝난 행사는 취소할 수 없습니다.');
  let skipped = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT status FROM planner_monthly_approvals WHERE company_id = $1::uuid AND plan_month = $2 FOR UPDATE`,
      [ev.companyId, ev.planMonth],
    );
    await client.query(`SELECT status FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`, [ev.id, ev.companyId]);
    const busy = await client.query(
      `SELECT 1 FROM planner_touchpoints WHERE event_id = $1::uuid AND company_id = $2::uuid AND status = 'producing' LIMIT 1`,
      [ev.id, ev.companyId],
    );
    if (busy.rows.length > 0) throw new PlannerApproveError(409, 'IN_PROGRESS', '지금 보내는 중인 발송이 있습니다. 끝난 뒤 다시 취소해 주세요.');
    const r = await client.query(
      `UPDATE planner_touchpoints SET status = 'skipped', lock_reason = $3
        WHERE event_id = $1::uuid AND company_id = $2::uuid AND status IN ('planned', 'ready', 'hold_credit', 'locked')
        RETURNING id`,
      [ev.id, ev.companyId, PLANNER_REASON.cancelledEvent],
    );
    skipped = r.rows.length;
    await client.query(
      `UPDATE planner_events SET status = 'cancelled', meta = COALESCE(meta, '{}'::jsonb) - 'preview', updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND status <> 'cancelled'`,
      [ev.id, ev.companyId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
  // DM 발행 멈춤(있으면 · 실패해도 취소는 유지 — 담당자가 DM 목록에서 직접 멈출 수 있다)
  const dmIds = Array.from(new Set((await loadEventTouchpoints(ev.companyId, ev.id)).filter((t) => t.channel === 'dm' && t.assetRef).map((t) => String(t.assetRef))));
  for (const id of dmIds) await stopDm(id, ev.companyId).catch(() => null);
  await notifyPlanner(ev.companyId, input.userId, '[마케팅 플래너] 행사 취소', `'${ev.title}' 행사를 취소했습니다. 남은 발송 ${skipped}건은 보내지 않습니다.`);
  console.log(`[planner-approve] 행사 취소 company=${ev.companyId} event=${ev.id} 남은 접점 ${skipped}`);
  return { status: 'cancelled', skipped };
}
