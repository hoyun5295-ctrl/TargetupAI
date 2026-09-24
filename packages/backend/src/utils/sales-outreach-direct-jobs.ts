/**
 * ★ 2026-09-23 AI 영업 담당자 직접 발송 — 효과 CT (DB · SMTP)
 * 설계 = docs/2026-09-23-outreach-direct-send-design.md (§5 발송 · §6 단계 · §12 작업대 · 불변 1 개정 · 24 개정 · 44~51)
 *
 * 규율:
 * - 판정은 순수 CT(sales-outreach-direct.ts) 하나 — 발송 함수와 조회 응답(작업대·상세)이 같은 함수(computeDirectSendLock)를 부른다.
 * - 발송 코어(sendDirectCore)는 **승인 기록**을 필수 인자로 받는다: 사람(assertOperator 를 지난 슈퍼관리자) 또는 묶음 사전 승인 기록(단계 3).
 *   이 파일 밖에서 부를 수 있는 발송 진입점은 셋뿐이다 — 단건(사람) · 묶음(사람) · 자동(묶음 승인 기록 · 단계 3). 계약 테스트.
 * - 수신처는 선점한 잡 행의 contact_email 에서만 읽는다(요청 인자 0 · expectedTo 는 확인만).
 * - 한 트랜잭션: 잡 CAS → advisory lock → 수신거부 원장 → 일일 상한(시도 수) → 발송 원장 INSERT(같은 회사 부분 UNIQUE) → COMMIT → SMTP(불변 45).
 * - 원장에는 주소 원문 0(해시만 · 불변 49). 수신거부 GET 은 기록하지 않는다(불변 48 · 라우트).
 * - jsonb 파라미터는 반드시 JSON.stringify. stage_results 키 삭제 0(null 로 덮는다 · 되돌리기 단일 함수 계약).
 */
import type { PoolClient } from 'pg';
import { query, pool } from '../config/database';
import {
  OutreachError, assertOperator, computeSendLock, sendLockEnv, sendLockMaterialOf, SEND_LOCK_MESSAGES, rebuildOutreachEmail,
  normalizeHomepageKey, isFutureDate, detailOf, normalizeEditReason, type SendLockReason, type EventCandidate,
} from './sales-outreach-jobs';
import {
  normalizeContactEmail, normalizeContactName, normalizeContactBasis, outreachHashSecret, outreachAddressHash, directUnsubscribeUrlOf,
  parseUnsubscribeToken, verifyUnsubscribeSig, classifyContactDomain, naverStoreUrlOf, directSubjectOf, computeDirectSendLock, unsubLinkInHtml,
  DIRECT_LOCK_MESSAGES, DIRECT_STAGE_RULES, directStageEnv, directDailyCap, evaluateDirectStage, autoSendBlockers, visionTwoItemsOk,
  isPostReviewPick, kstDayStartIso, type DirectLockReason, type DirectStats, type DirectSendLock, type ContactDomainVerdict,
  parseNaverStoreSlug, storePageTextOf, STORE_GRAB_STAGES,
} from './sales-outreach-direct';
// ★ 2026-09-24 B 네이버 스토어 전용 판독기(허용 칸 · 순수)
import { parseNaverStoreState, pickNaverStoreState, naverStoreStateFromHtml } from './sales-outreach-naver-store';
import { sendOutreachDirectMail, sendOutreachCopyMail, isOutreachMailerReady } from './outreach-mailer';
import { PUBLIC_BASE } from './sales-outreach-produce';
import { getActiveStyleGuide } from './sales-outreach-style';
import { createSlotQueue } from './outreach-slot-queue';

type Row = Record<string, any>;

/** 묶음 발송 한 번의 상한(확인한 건만 · 일일 잔여와 작은 쪽) · 건 사이 간격 */
export const DIRECT_BULK_MAX = 20;
export const DIRECT_SEND_GAP_MS = 30_000;

/** 승인 기록 — 사람(단계 1·2) 또는 묶음 사전 승인(단계 3). 발송 코어의 필수 인자(불변 1 개정). */
type DirectAuth =
  | { kind: 'human'; operatorId: string }
  | { kind: 'approval'; approval: { by: string; at: string; rule: string } };

type DirectMode = 'manual' | 'bulk' | 'auto';

const lockMessage = (r: SendLockReason | DirectLockReason): string =>
  (DIRECT_LOCK_MESSAGES as Record<string, string>)[r] || (SEND_LOCK_MESSAGES as Record<string, string>)[r] || '발송이 잠겨 있습니다.';

// ===== 읽기 =====

interface DirectJobContext {
  job: Row;
  emailAssetId: string | null;
  email: Row | null;
  dm: Row | null;
}

async function loadDirectContext(jobId: string): Promise<DirectJobContext> {
  if (!/^[0-9a-f-]{36}$/i.test(String(jobId || ''))) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  const j = await query(
    `SELECT id, company_name, homepage_url, stage, mail_result, mail_sent_at, purged_at, stage_results, event_quote,
            brand_profile->'contactPages' AS contact_pages,
            contact_email, contact_name, contact_basis, naver_store_slug, reviewed_asset_id
       FROM sales_outreach_jobs WHERE id = $1`,
    [jobId],
  );
  if (!j.rows[0]) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  const a = await query(
    `SELECT DISTINCT ON (kind) id, kind, payload FROM sales_outreach_assets
      WHERE job_id = $1 AND kind IN ('email_html', 'dm') ORDER BY kind, created_at DESC`,
    [jobId],
  );
  const e = a.rows.find((r: Row) => r.kind === 'email_html');
  const d = a.rows.find((r: Row) => r.kind === 'dm');
  return { job: j.rows[0], emailAssetId: e ? String(e.id) : null, email: e?.payload || null, dm: d?.payload || null };
}

async function isAutoStopped(): Promise<boolean> {
  const r = await query(`SELECT value FROM sales_outreach_controls WHERE key = 'auto_send_stop'`, []);
  return r.rows[0]?.value?.stopped === true;
}

/** 원장에서 센 통계(단계 판정의 원천 · §6 측정 출처) */
async function loadDirectStats(): Promise<DirectStats> {
  const s = await query(
    `SELECT COUNT(*) FILTER (WHERE outcome = 'sent')::int AS sent_total,
            COUNT(*) FILTER (WHERE outcome = 'rejected')::int AS bounce_total,
            COUNT(*) FILTER (WHERE review_flag = 'wrong')::int AS review_wrong
       FROM sales_outreach_sends`,
    [],
  );
  const u = await query(
    `SELECT COUNT(*) FILTER (WHERE reason = 'unsub')::int AS unsub, COUNT(*) FILTER (WHERE reason = 'not_contact')::int AS not_contact
       FROM sales_outreach_suppressions`,
    [],
  );
  const recent = await query(
    `SELECT meta FROM sales_outreach_sends WHERE outcome = 'sent' ORDER BY created_at DESC LIMIT $1`,
    [DIRECT_STAGE_RULES.stage3.recentWindow],
  );
  const recentMeta: Row[] = recent.rows.map((r: Row) => r.meta || {});
  const autoMeta = recentMeta.filter((m) => m.autoConfirmed === true).slice(0, DIRECT_STAGE_RULES.stage3.autoWindow);
  return {
    sentTotal: Number(s.rows[0]?.sent_total) || 0,
    hardBounceTotal: Number(s.rows[0]?.bounce_total) || 0,
    wrongTotal: (Number(s.rows[0]?.review_wrong) || 0) + (Number(u.rows[0]?.not_contact) || 0),
    unsubTotal: Number(u.rows[0]?.unsub) || 0,
    recentEdited: recentMeta.filter((m) => m.edited === true).length,
    recentCount: recentMeta.length,
    autoChanged: autoMeta.filter((m) => m.selectionChanged === true).length,
    autoCount: autoMeta.length,
    autoStopped: await isAutoStopped(),
  };
}

async function directStageInfo(): Promise<{ stage: 0 | 1 | 2 | 3; envStage: number; dataStage: number; blockers: string[]; stats: DirectStats }> {
  const envStage = directStageEnv();
  const stats = await loadDirectStats();
  const ev = evaluateDirectStage(envStage, stats);
  return { stage: ev.stage, envStage, dataStage: ev.dataStage, blockers: ev.blockers, stats };
}

async function todayAttempts(): Promise<number> {
  const r = await query(`SELECT COUNT(*)::int AS n FROM sales_outreach_sends WHERE created_at >= $1::timestamptz`, [kstDayStartIso()]);
  return Number(r.rows[0]?.n) || 0;
}

function hostKeyOf(job: Row): string {
  return normalizeHomepageKey(String(job.homepage_url || ''));
}

/** 이 건의 직접 발송 잠금(원장 조회 포함) — 발송 코어·상세 응답이 같이 쓴다 */
async function lockForContext(ctx: DirectJobContext, opts: { stage: number; requireReview: boolean; today?: number }): Promise<{ lock: DirectSendLock; email: string | null; verdict: ContactDomainVerdict; toHash: string | null; hostKey: string; expectedUnsubUrl: string | null }> {
  const secret = outreachHashSecret();
  const email = normalizeContactEmail(ctx.job.contact_email);
  const verdict = classifyContactDomain(email, ctx.job.homepage_url);
  const hostKey = hostKeyOf(ctx.job);
  const toHash = email && secret ? outreachAddressHash(email, secret) : null;
  const sup = await query(
    `SELECT 1 FROM sales_outreach_suppressions WHERE ($1::text IS NOT NULL AND email_hash = $1) OR (scope = 'company' AND host_key = $2) LIMIT 1`,
    [toHash, hostKey],
  );
  const sent = await query(
    `SELECT 1 FROM sales_outreach_sends WHERE host_key = $1 AND outcome IN ('sending', 'sent') AND reopened_at IS NULL LIMIT 1`,
    [hostKey],
  );
  const ack = ctx.job.stage_results?.domain_ack;
  const expectedUnsubUrl = directUnsubscribeUrlOf(PUBLIC_BASE, String(ctx.job.id), email, secret);
  const base = computeSendLock(sendLockEnv(), ctx.email as any, sendLockMaterialOf(ctx.job.stage_results));
  const lock = computeDirectSendLock(base, {
    stage: opts.stage,
    hashReady: !!secret,
    contactEmail: email,
    contactBasis: ctx.job.contact_basis,
    domainVerdict: verdict,
    domainAcked: !!ack && typeof ack === 'object' && String(ack.email || '') === String(email || ''),
    suppressed: sup.rows.length > 0,
    alreadySentCompany: sent.rows.length > 0,
    todayAttempts: typeof opts.today === 'number' ? opts.today : await todayAttempts(),
    dailyCap: directDailyCap(),
    requireReview: opts.requireReview,
    reviewedAssetId: ctx.job.reviewed_asset_id ? String(ctx.job.reviewed_asset_id) : null,
    latestAssetId: ctx.emailAssetId,
    unsubLinkOk: unsubLinkInHtml(ctx.email?.html, expectedUnsubUrl),
  });
  return { lock, email, verdict, toHash, hostKey, expectedUnsubUrl };
}

// ===== 상세 응답(검토 화면 · 발송 확인 창) =====

export async function getOutreachDirectInfo(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<Row> {
  await assertOperator(operatorSuperAdminId);
  const ctx = await loadDirectContext(jobId);
  const st = await directStageInfo();
  const today = await todayAttempts();
  const l = await lockForContext(ctx, { stage: st.stage, requireReview: true, today });
  const last = await query(
    `SELECT id, outcome, mode, review_flag, created_at, finished_at FROM sales_outreach_sends WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [jobId],
  );
  return {
    contact: { email: l.email, name: ctx.job.contact_name || null, basis: ctx.job.contact_basis || null },
    domainVerdict: l.verdict,
    domainAcked: !!ctx.job.stage_results?.domain_ack && String(ctx.job.stage_results.domain_ack.email || '') === String(l.email || ''),
    contactPages: Array.isArray(ctx.job.contact_pages) ? ctx.job.contact_pages.slice(0, 3) : [],
    naverStoreUrl: naverStoreUrlOf(ctx.job.naver_store_slug),
    lock: { locked: l.lock.locked, reasons: l.lock.reasons, messages: l.lock.reasons.map(lockMessage) },
    stage: { effective: st.stage, env: st.envStage, data: st.dataStage, blockers: st.blockers },
    today, cap: directDailyCap(),
    review: { reviewedAssetId: ctx.job.reviewed_asset_id || null, latestAssetId: ctx.emailAssetId, reviewed: !!ctx.emailAssetId && String(ctx.job.reviewed_asset_id || '') === ctx.emailAssetId, hold: ctx.job.stage_results?.hold || null },
    directSubject: ctx.email?.subject ? directSubjectOf(String(ctx.email.subject)) : null,
    dmCaptureUrl: ctx.dm?.captureUrl || null,
    lastSend: last.rows[0] || null,
    directLast: ctx.job.stage_results?.direct_last || null,
    mailerReady: isOutreachMailerReady(),
  };
}

// ===== 담당자 · 확인 · 보류 · 도메인 해제 =====

/** 담당자 저장(사람이 넣은 값만 · 불변 44). ready 건은 이름·주소가 바뀌면 메일 재조립이 바로 돈다(AI 0 · 제목·서두 보존 · 1클릭). */
export async function setOutreachContact(
  jobId: string,
  input: { email?: unknown; name?: unknown; basis?: unknown },
  operatorSuperAdminId: string | null | undefined,
): Promise<{ rebuilding: boolean }> {
  await assertOperator(operatorSuperAdminId);
  const rawEmail = String(input.email ?? '').trim();
  const email = rawEmail ? normalizeContactEmail(rawEmail) : null;
  if (rawEmail && !email) throw new OutreachError('VALIDATION', '담당자 이메일 형식이 올바르지 않습니다.');
  const name = normalizeContactName(input.name);
  const basis = normalizeContactBasis(input.basis);
  const cur = await query(`SELECT stage, mail_result, contact_email, contact_name, purged_at FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (!cur.rows[0] || cur.rows[0].purged_at) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage === 'sent') throw new OutreachError('CONFLICT', '이미 보낸 건은 담당자를 바꿀 수 없습니다.');
  if (cur.rows[0].mail_result === 'sending') throw new OutreachError('CONFLICT', '발송이 진행 중입니다. 잠시 후 다시 시도해주세요.');
  const upd = await query(
    `UPDATE sales_outreach_jobs SET contact_email = $2, contact_name = $3, contact_basis = $4
      WHERE id = $1 AND stage <> 'sent' AND mail_result IS DISTINCT FROM 'sending' AND purged_at IS NULL
      RETURNING stage`,
    [jobId, email, name, basis],
  );
  if (!upd.rows[0]) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  const changed = String(cur.rows[0].contact_email || '') !== String(email || '') || String(cur.rows[0].contact_name || '') !== String(name || '');
  if (upd.rows[0].stage === 'ready' && changed) {
    await rebuildOutreachEmail(jobId, operatorSuperAdminId);
    return { rebuilding: true };
  }
  return { rebuilding: false };
}

/** 확인(O) — 화면에 렌더한 판 id 를 서버에 기록(불변 46). 그 사이 판이 바뀌었으면 거절. */
export async function reviewOutreachJob(jobId: string, assetId: unknown, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const id = String(assetId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new OutreachError('VALIDATION', '확인할 메일 판이 올바르지 않습니다.');
  const at = new Date().toISOString();
  const r = await query(
    `UPDATE sales_outreach_jobs
        SET reviewed_asset_id = $2::uuid,
            stage_results = COALESCE(stage_results, '{}'::jsonb) || $3::jsonb
      WHERE id = $1 AND stage = 'ready' AND purged_at IS NULL
        AND $2::uuid = (SELECT a.id FROM sales_outreach_assets a WHERE a.job_id = $1 AND a.kind = 'email_html' ORDER BY a.created_at DESC LIMIT 1)
      RETURNING id`,
    [jobId, id, JSON.stringify({ review: { by: operatorSuperAdminId || null, at, assetId: id, via: 'card' }, hold: null })],
  );
  if (!r.rows[0]) throw new OutreachError('CONFLICT', '최신 메일 판이 바뀌었거나 검토할 수 있는 상태가 아닙니다. 새로고침 후 다시 확인해주세요.');
}

/** 보류(X) — 사유 5값(학습 원장과 같은 표) · 확인 기록을 비운다 */
export async function holdOutreachJob(jobId: string, reason: unknown, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const r = await query(
    `UPDATE sales_outreach_jobs
        SET reviewed_asset_id = NULL,
            stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb
      WHERE id = $1 AND stage = 'ready' AND purged_at IS NULL
      RETURNING id`,
    [jobId, JSON.stringify({ hold: { reason: normalizeEditReason(reason), by: operatorSuperAdminId || null, at: new Date().toISOString() } })],
  );
  if (!r.rows[0]) throw new OutreachError('CONFLICT', '검토 대기 건만 보류할 수 있습니다.');
}

/** 담당자 도메인이 다른 회사일 때 — 근거가 적혀 있어야 해제(사람 2클릭 · 그 주소에만 · 주소가 바뀌면 다시 잠긴다) */
export async function ackOutreachContactDomain(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const cur = await query(`SELECT stage, homepage_url, contact_email, contact_basis FROM sales_outreach_jobs WHERE id = $1 AND purged_at IS NULL`, [jobId]);
  if (!cur.rows[0]) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  const email = normalizeContactEmail(cur.rows[0].contact_email);
  if (!email) throw new OutreachError('CONFLICT', '담당자 이메일이 없습니다.');
  if (!normalizeContactBasis(cur.rows[0].contact_basis)) throw new OutreachError('CONFLICT', '주소를 알게 된 근거를 먼저 적어주세요.');
  if (classifyContactDomain(email, cur.rows[0].homepage_url) !== 'other') throw new OutreachError('CONFLICT', '도메인 불일치 잠금이 걸린 건이 아닙니다.');
  const r = await query(
    `UPDATE sales_outreach_jobs SET stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb
      WHERE id = $1 AND contact_email = $3 AND purged_at IS NULL RETURNING id`,
    [jobId, JSON.stringify({ domain_ack: { email, by: operatorSuperAdminId || null, at: new Date().toISOString() } }), cur.rows[0].contact_email],
  );
  if (!r.rows[0]) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
}

/** 같은 회사 재접촉 열기 — 마지막 발송(성공)이 90일 넘게 지난 경우만(사람) */
export async function reopenOutreachContact(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<{ reopened: number }> {
  await assertOperator(operatorSuperAdminId);
  const cur = await query(`SELECT homepage_url FROM sales_outreach_jobs WHERE id = $1 AND purged_at IS NULL`, [jobId]);
  if (!cur.rows[0]) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  const hostKey = hostKeyOf(cur.rows[0]);
  const r = await query(
    `UPDATE sales_outreach_sends SET reopened_at = NOW()
      WHERE host_key = $1 AND outcome = 'sent' AND reopened_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM sales_outreach_sends s2
                         WHERE s2.host_key = $1 AND s2.outcome IN ('sending', 'sent') AND s2.reopened_at IS NULL
                           AND COALESCE(s2.finished_at, s2.created_at) > NOW() - ($2 || ' days')::interval)
      RETURNING id`,
    [hostKey, String(DIRECT_STAGE_RULES.reopenDays)],
  );
  if (r.rows.length === 0) throw new OutreachError('CONFLICT', `마지막 발송 뒤 ${DIRECT_STAGE_RULES.reopenDays}일이 지나야 다시 열 수 있습니다.`);
  return { reopened: r.rows.length };
}

// ===== 발송 코어 (불변 1 개정 · 45 · 47) =====

const directInFlight = new Set<string>();

async function mergeDirectLast(jobId: string, entry: Row): Promise<void> {
  await query(
    `UPDATE sales_outreach_jobs SET stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [jobId, JSON.stringify({ direct_last: entry })],
  ).catch((err: any) => console.error('[sales-outreach-direct] direct_last 기록 실패:', jobId, err?.message));
}

async function stopAutoSend(reason: string, by: string | null): Promise<void> {
  await query(
    `INSERT INTO sales_outreach_controls (key, value, updated_by, updated_at) VALUES ('auto_send_stop', $1::jsonb, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify({ stopped: true, reason, at: new Date().toISOString() }), by],
  ).catch((err: any) => console.error('[sales-outreach-direct] 자동 정지 기록 실패:', err?.message));
  console.log('[sales-outreach-direct] 자동 발송 정지:', reason);
}

function validApproval(v: unknown): { by: string; at: string; rule: string } | null {
  const a = v && typeof v === 'object' ? v as Row : null;
  if (!a || !/^[0-9a-f-]{36}$/i.test(String(a.by || '')) || !a.at || !a.rule) return null;
  return { by: String(a.by), at: String(a.at), rule: String(a.rule) };
}

/**
 * 직접 발송 1건(유일한 발송 코어). 승인 기록(auth)이 필수 인자다 — 사람 id 또는 묶음 사전 승인 기록.
 * 수신처 = 선점한 잡 행의 contact_email(요청 인자 0). html·평문 = 확인한 asset 그대로 · 변형은 제목 접두 1개(불변 47).
 */
async function sendDirectCore(jobId: string, auth: DirectAuth, mode: DirectMode, expectedTo: string | null): Promise<{ outcome: string; detail: string; to: string }> {
  const need = mode === 'manual' ? 1 : mode === 'bulk' ? 2 : 3;
  if (auth.kind === 'approval' && mode !== 'auto') throw new OutreachError('FORBIDDEN', '승인 기록이 올바르지 않습니다.');
  if (auth.kind === 'human' && mode === 'auto') throw new OutreachError('FORBIDDEN', '승인 기록이 올바르지 않습니다.');
  const ctx = await loadDirectContext(jobId);
  if (ctx.job.purged_at) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (ctx.job.stage === 'sent') throw new OutreachError('CONFLICT', '이미 발송된 건입니다.');
  if (ctx.job.stage !== 'ready') throw new OutreachError('CONFLICT', '제작이 끝난(검토 대기) 건만 보낼 수 있습니다.');
  const st = await directStageInfo();
  if (st.stage < need) {
    throw new OutreachError('NOT_READY', need === 1 ? DIRECT_LOCK_MESSAGES.DIRECT_DISABLED : `이 발송 방식은 단계 ${need}부터 열립니다(지금 단계 ${st.stage}).`, { stage: st.stage, blockers: st.blockers });
  }
  const l = await lockForContext(ctx, { stage: st.stage, requireReview: auth.kind === 'human' });
  if (l.lock.locked) {
    const first = l.lock.reasons[0];
    throw new OutreachError(first === 'NO_EMAIL' ? 'CONFLICT' : 'NOT_READY', lockMessage(first), { reasons: l.lock.reasons });
  }
  const to = l.email!;
  if (auth.kind === 'human' && String(expectedTo || '').trim().toLowerCase() !== to.toLowerCase()) {
    throw new OutreachError('CONFLICT', '받는 주소가 화면과 다릅니다(그 사이 바뀌었습니다). 새로고침 후 다시 확인해주세요.', { reason: 'CONTACT_CHANGED' });
  }
  if (mode === 'auto' && ctx.job.mail_result) throw new OutreachError('CONFLICT', '이전 발송 결과가 있는 건은 자동으로 다시 보내지 않습니다.');
  if (directInFlight.has(jobId)) throw new OutreachError('CONFLICT', '발송이 진행 중입니다.');
  directInFlight.add(jobId);
  let sendId: string | null = null;
  try {
    const createdBy = auth.kind === 'human' ? auth.operatorId : auth.approval.by;
    const sr: Row = ctx.job.stage_results || {};
    const chain = sr.chain && typeof sr.chain === 'object' ? sr.chain : null;
    const meta = {
      mode,
      edited: Array.isArray(sr.edits) && sr.edits.length > 0,
      autoConfirmed: !!sr.auto_confirmed_at,
      selectionChanged: !!sr.auto_confirmed_at && ctx.job.event_quote?.confirmedBy !== 'auto:v1',
      domainVerdict: l.verdict,
      batch: chain?.batch || null,
      ...(auth.kind === 'approval' ? { approval: auth.approval } : {}),
    };
    const reviewFlag = mode === 'auto' && isPostReviewPick(chain?.batch || null, Number(chain?.index), Number(chain?.total)) ? 'pending' : null;

    // ── 선점 트랜잭션(불변 45) ──
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const claim = await client.query(
        `UPDATE sales_outreach_jobs SET mail_result = 'sending', lock_at = NOW()
          WHERE id = $1 AND stage = 'ready' AND mail_sent_at IS NULL AND purged_at IS NULL AND contact_email = $2
            AND (mail_result IS NULL OR mail_result IN ('rejected', 'unknown'))
          RETURNING id`,
        [jobId, ctx.job.contact_email],
      );
      if (claim.rows.length === 0) throw new OutreachError('CONFLICT', '발송이 이미 진행 중이거나 상태가 바뀌었습니다. 새로고침 후 확인해주세요.');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('sales_outreach_direct'))`);
      const sup = await client.query(
        `SELECT 1 FROM sales_outreach_suppressions WHERE email_hash = $1 OR (scope = 'company' AND host_key = $2) LIMIT 1`,
        [l.toHash, l.hostKey],
      );
      if (sup.rows.length > 0) throw new OutreachError('CONFLICT', DIRECT_LOCK_MESSAGES.SUPPRESSED, { reasons: ['SUPPRESSED'] });
      const cnt = await client.query(`SELECT COUNT(*)::int AS n FROM sales_outreach_sends WHERE created_at >= $1::timestamptz`, [kstDayStartIso()]);
      if ((Number(cnt.rows[0]?.n) || 0) >= directDailyCap()) throw new OutreachError('NOT_READY', DIRECT_LOCK_MESSAGES.DAILY_CAP, { reasons: ['DAILY_CAP'] });
      let ins;
      try {
        ins = await client.query(
          `INSERT INTO sales_outreach_sends (job_id, asset_id, to_hash, host_key, mode, outcome, meta, review_flag, created_by)
           VALUES ($1, $2::uuid, $3, $4, $5, 'sending', $6::jsonb, $7, $8::uuid) RETURNING id`,
          [jobId, ctx.emailAssetId, l.toHash, l.hostKey, mode, JSON.stringify(meta), reviewFlag, createdBy],
        );
      } catch (e: any) {
        if (e?.code === '23505') throw new OutreachError('CONFLICT', DIRECT_LOCK_MESSAGES.ALREADY_SENT_COMPANY, { reasons: ['ALREADY_SENT_COMPANY'] });
        throw e;
      }
      sendId = String(ins.rows[0].id);
      await client.query('COMMIT');
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client?.release();
    }

    // ── SMTP(선점 뒤 · 실패는 unknown 으로 정직하게) ──
    try {
      const subject = directSubjectOf(String(ctx.email!.subject));
      const result = await sendOutreachDirectMail({
        to, subject, html: String(ctx.email!.html),
        ...(ctx.email!.text ? { text: String(ctx.email!.text) } : {}),
        unsubscribeUrl: l.expectedUnsubUrl!,
      });
      const at = new Date().toISOString();
      await query(
        `UPDATE sales_outreach_sends SET outcome = $2, detail = $3, finished_at = NOW() WHERE id = $1 AND outcome = 'sending'`,
        [sendId, result.outcome, String(result.detail || '').slice(0, 300)],
      );
      if (result.outcome === 'sent') {
        const done = await query(
          `UPDATE sales_outreach_jobs
              SET stage = 'sent', mail_sent_at = NOW(), mail_result = 'sent',
                  stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb
            WHERE id = $1 AND stage = 'ready' AND mail_result = 'sending' AND mail_sent_at IS NULL
            RETURNING id`,
          [jobId, JSON.stringify({ direct_last: { outcome: 'sent', detail: '담당자에게 보냈습니다.', at, mode } })],
        );
        if (done.rows.length === 0) {
          console.error('[sales-outreach-direct] 발송 후 상태 기록 0행:', jobId);
          await mergeDirectLast(jobId, { outcome: 'unknown', detail: '메일은 나갔으나 상태 기록이 어긋났습니다.', at, mode });
          return { outcome: 'unknown', detail: '메일은 발송됐으나 상태 기록이 어긋났습니다. 목록 상태를 확인해주세요.', to };
        }
      } else {
        await query(
          `UPDATE sales_outreach_jobs SET mail_result = $2, stage_results = COALESCE(stage_results, '{}'::jsonb) || $3::jsonb
            WHERE id = $1 AND mail_result = 'sending'`,
          [jobId, result.outcome, JSON.stringify({ direct_last: { outcome: result.outcome, detail: String(result.detail || '').slice(0, 300), at, mode } })],
        );
        if (result.outcome === 'rejected' && l.toHash) {
          // 하드 반송 = 그 주소 수신거부(bounce) · 자동 발송 중이면 자동 정지(§6)
          await query(
            `INSERT INTO sales_outreach_suppressions (email_hash, host_key, scope, reason, source_job_id)
             SELECT $1, $2, 'address', 'bounce', $3::uuid
              WHERE NOT EXISTS (SELECT 1 FROM sales_outreach_suppressions WHERE email_hash = $1 AND scope = 'address')`,
            [l.toHash, l.hostKey, jobId],
          ).catch((err: any) => console.error('[sales-outreach-direct] 반송 기록 실패:', jobId, err?.message));
          if (mode === 'auto') await stopAutoSend('자동 발송분 하드 반송', null);
        }
      }
      // 자사 사본은 따로 1통(결과 판정과 무관 · 실패 무시)
      const guide = getActiveStyleGuide();
      sendOutreachCopyMail({ subject: `${guide.emailCopy.copySubjectPrefix}${subject}`, html: String(ctx.email!.html), ...(ctx.email!.text ? { text: String(ctx.email!.text) } : {}) })
        .catch((err: any) => console.error('[sales-outreach-direct] 사본 발송 실패(무시):', jobId, err?.message));
      console.log('[sales-outreach-direct] 발송:', jobId, mode, result.outcome);
      return { outcome: result.outcome, detail: result.detail, to };
    } catch (err: any) {
      // 선점 뒤 예외 — 발송 여부 모름 = unknown(잡·원장 함께 · 버튼 영구 잠김 방지)
      await query(`UPDATE sales_outreach_sends SET outcome = 'unknown', detail = $2, finished_at = NOW() WHERE id = $1 AND outcome = 'sending'`, [sendId, detailOf(err)]).catch(() => {});
      await query(`UPDATE sales_outreach_jobs SET mail_result = 'unknown' WHERE id = $1 AND mail_result = 'sending'`, [jobId]).catch(() => {});
      throw err;
    }
  } finally {
    directInFlight.delete(jobId);
  }
}

// ===== 발송 진입점 3곳 =====

/** 단계 1 — 사람이 확인한 건 1건(발송 확인 창의 1클릭) */
export async function sendOutreachDirectForJob(jobId: string, expectedTo: unknown, operatorSuperAdminId: string | null | undefined): Promise<{ outcome: string; detail: string; to: string }> {
  await assertOperator(operatorSuperAdminId);
  return sendDirectCore(jobId, { kind: 'human', operatorId: String(operatorSuperAdminId) }, 'manual', String(expectedTo || ''));
}

/**
 * 단계 2 — 확인한 건만 묶어 1클릭(백그라운드 순차 · 30초 간격 · 재시작하면 이어 보내지 않는다).
 * 담당자 도메인이 홈페이지와 같은 건만 묶음에 든다(무료메일·다른 회사는 건별 발송 · §6).
 */
export async function sendOutreachDirectBulk(items: unknown, operatorSuperAdminId: string | null | undefined): Promise<{ queued: string[]; skipped: Array<{ id: string; reason: string }> }> {
  await assertOperator(operatorSuperAdminId);
  const list = (Array.isArray(items) ? items : [])
    .map((x: any) => ({ id: String(x?.id || '').trim(), expectedTo: String(x?.expectedTo || '').trim() }))
    .filter((x) => /^[0-9a-f-]{36}$/i.test(x.id));
  if (list.length === 0) throw new OutreachError('VALIDATION', '보낼 건을 선택해주세요.');
  if (list.length > DIRECT_BULK_MAX) throw new OutreachError('VALIDATION', `한 번에 ${DIRECT_BULK_MAX}건까지 보낼 수 있습니다.`);
  const st = await directStageInfo();
  if (st.stage < 2) throw new OutreachError('NOT_READY', `묶음 발송은 단계 2부터 열립니다(지금 단계 ${st.stage}).`, { stage: st.stage, blockers: st.blockers });
  let left = Math.max(0, directDailyCap() - await todayAttempts());
  const queued: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const it of list) {
    try {
      const ctx = await loadDirectContext(it.id);
      const l = await lockForContext(ctx, { stage: st.stage, requireReview: true });
      if (l.lock.locked) { skipped.push({ id: it.id, reason: lockMessage(l.lock.reasons[0]) }); continue; }
      if (l.verdict !== 'same') { skipped.push({ id: it.id, reason: '담당자 도메인이 홈페이지와 같지 않아 건별로 보내야 합니다.' }); continue; }
      if (String(l.email || '').toLowerCase() !== it.expectedTo.toLowerCase()) { skipped.push({ id: it.id, reason: '받는 주소가 화면과 다릅니다.' }); continue; }
      if (left <= 0) { skipped.push({ id: it.id, reason: DIRECT_LOCK_MESSAGES.DAILY_CAP }); continue; }
      left--;
      queued.push(it.id);
    } catch (err: any) {
      skipped.push({ id: it.id, reason: err instanceof OutreachError ? err.message : '확인에 실패했습니다.' });
    }
  }
  if (queued.length) {
    const operatorId = String(operatorSuperAdminId);
    const expected = new Map(list.map((x) => [x.id, x.expectedTo]));
    (async () => {
      for (let i = 0; i < queued.length; i++) {
        const id = queued[i];
        try {
          await sendDirectCore(id, { kind: 'human', operatorId }, 'bulk', expected.get(id) || '');
        } catch (err: any) {
          console.log('[sales-outreach-direct] 묶음 발송 건너뜀:', id, err?.message);
          await mergeDirectLast(id, { outcome: 'skipped', detail: err instanceof OutreachError ? err.message : '발송에 실패했습니다.', at: new Date().toISOString(), mode: 'bulk' });
        }
        if (i < queued.length - 1) await new Promise((r) => setTimeout(r, DIRECT_SEND_GAP_MS));
      }
    })().catch((err: any) => console.error('[sales-outreach-direct] 묶음 발송 예외:', err?.message));
  }
  return { queued, skipped };
}

/** 단계 3 자동 발송은 한 줄로 세운다(건 사이 30초) */
const autoSlot = createSlotQueue();

/**
 * 단계 3 — 묶음 사전 승인 기록이 있는 건이 제작 완료(ready)에 닿았을 때 체인이 부른다(사람 클릭 0 · 승인 기록이 발송 권한).
 * 유효 단계 3 · 자동 정지 아님 · 건 조건(autoSendBlockers) 전부 통과해야 보낸다. 못 보내면 사유를 남기고 사람 흐름(발송 대기)으로 남긴다.
 */
export async function autoSendOutreachJob(jobId: string): Promise<void> {
  const ctx = await loadDirectContext(jobId);
  const approval = validApproval(ctx.job.stage_results?.auto_send);
  if (!approval) return; // 승인 기록 없는 묶음 — 사람 흐름
  const st = await directStageInfo();
  const at = new Date().toISOString();
  if (st.stage < 3) {
    await mergeDirectLast(jobId, { outcome: 'skipped', detail: `자동 발송 조건 미달(단계 ${st.stage}) · 사람이 확인 후 보내주세요.`, at, mode: 'auto' });
    return;
  }
  const l = await lockForContext(ctx, { stage: st.stage, requireReview: false });
  const selected: EventCandidate[] = Array.isArray(ctx.job.event_quote?.selectedList) ? ctx.job.event_quote.selectedList : [];
  const blockers = autoSendBlockers({
    lockReasons: l.lock.reasons,
    domainVerdict: l.verdict,
    datedLicense: selected.some((c) => c && c.benefitLicensed && !!c.endDate && isFutureDate(c.endDate)),
    manualEvent: selected.some((c) => c && c.origin === 'manual'),
    visionOk: visionTwoItemsOk(ctx.dm?.visionScore),
    approved: true,
  });
  if (blockers.length) {
    await mergeDirectLast(jobId, { outcome: 'skipped', detail: `자동 발송 제외: ${blockers.join(' · ')}`.slice(0, 300), at, mode: 'auto' });
    return;
  }
  try {
    const r = await autoSlot.run(async () => {
      try {
        return await sendDirectCore(jobId, { kind: 'approval', approval }, 'auto', null);
      } finally {
        await new Promise((res) => setTimeout(res, DIRECT_SEND_GAP_MS));
      }
    }, 6 * 60 * 60 * 1000);
    if (!r.ok) await mergeDirectLast(jobId, { outcome: 'skipped', detail: '자동 발송 대기 시간 초과', at: new Date().toISOString(), mode: 'auto' });
  } catch (err: any) {
    // 잠금·경합(OutreachError) · DB 예외 — 사유를 남기고 사람 흐름(발송 대기)으로 둔다(자동 재시도 0)
    console.log('[sales-outreach-direct] 자동 발송 안 함:', jobId, err?.message);
    await mergeDirectLast(jobId, { outcome: 'skipped', detail: err instanceof OutreachError ? `자동 발송 안 함: ${err.message}`.slice(0, 300) : '자동 발송 중 오류가 나 보내지 않았습니다.', at: new Date().toISOString(), mode: 'auto' });
  }
}

// ===== 단계 · 자동 정지 · 사후 확인 =====

export async function getOutreachDirectStatus(operatorSuperAdminId: string | null | undefined): Promise<Row> {
  await assertOperator(operatorSuperAdminId);
  const st = await directStageInfo();
  const ctl = await query(`SELECT value, updated_at FROM sales_outreach_controls WHERE key = 'auto_send_stop'`, []);
  return {
    stage: st.stage, envStage: st.envStage, dataStage: st.dataStage, blockers: st.blockers, stats: st.stats,
    today: await todayAttempts(), cap: directDailyCap(),
    hashReady: !!outreachHashSecret(), mailerReady: isOutreachMailerReady(),
    autoStop: ctl.rows[0]?.value || null,
    rules: DIRECT_STAGE_RULES,
  };
}

export async function resumeOutreachAutoSend(operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  await query(
    `INSERT INTO sales_outreach_controls (key, value, updated_by, updated_at) VALUES ('auto_send_stop', $1::jsonb, $2::uuid, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify({ stopped: false, resumedAt: new Date().toISOString() }), operatorSuperAdminId || null],
  );
}

/** 사후 확인(단계 3 표본) — ok · wrong(= 자동 정지) */
export async function setOutreachSendReviewFlag(sendId: string, flag: unknown, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const f = flag === 'ok' || flag === 'wrong' ? flag : null;
  if (!f) throw new OutreachError('VALIDATION', '확인 결과가 올바르지 않습니다.');
  if (!/^[0-9a-f-]{36}$/i.test(String(sendId || ''))) throw new OutreachError('NOT_FOUND', '대상 발송을 찾을 수 없습니다.');
  const r = await query(`UPDATE sales_outreach_sends SET review_flag = $2 WHERE id = $1 AND review_flag = 'pending' RETURNING id`, [sendId, f]);
  if (!r.rows[0]) throw new OutreachError('CONFLICT', '사후 확인 대기 건이 아닙니다.');
  if (f === 'wrong') await stopAutoSend('사후 확인에서 잘못 나간 건 발견', operatorSuperAdminId || null);
}

// ===== 수신거부(공개 · 불변 48) =====

/** 토큰 → 대상(현재 담당자 해시 또는 그 잡이 실제로 보낸 해시 중 서명이 맞는 것) · 없으면 null */
export async function resolveOutreachUnsubscribe(token: string): Promise<{ jobId: string; companyName: string; toHash: string; hostKey: string } | null> {
  const p = parseUnsubscribeToken(token);
  const secret = outreachHashSecret();
  if (!p || !secret) return null;
  const j = await query(`SELECT id, company_name, homepage_url, contact_email FROM sales_outreach_jobs WHERE id = $1`, [p.jobId]);
  if (!j.rows[0]) return null;
  const hashes = new Set<string>();
  const cur = normalizeContactEmail(j.rows[0].contact_email);
  if (cur) hashes.add(outreachAddressHash(cur, secret));
  const sent = await query(`SELECT DISTINCT to_hash FROM sales_outreach_sends WHERE job_id = $1`, [p.jobId]);
  for (const r of sent.rows) if (r.to_hash) hashes.add(String(r.to_hash));
  for (const h of hashes) {
    if (verifyUnsubscribeSig(p.jobId, p.sig, h, secret)) {
      return { jobId: p.jobId, companyName: String(j.rows[0].company_name || ''), toHash: h, hostKey: hostKeyOf(j.rows[0]) };
    }
  }
  return null;
}

/** 수신거부 기록(POST 전용) — 같은 주소·범위는 한 번만 · 하루 수신거부가 상한에 닿으면 자동 발송 정지 */
export async function recordOutreachUnsubscribe(token: string, input: { companyWide: boolean; notContact: boolean }): Promise<boolean> {
  const t = await resolveOutreachUnsubscribe(token);
  if (!t) return false;
  const scope = input.companyWide ? 'company' : 'address';
  const reason = input.notContact ? 'not_contact' : 'unsub';
  await query(
    `INSERT INTO sales_outreach_suppressions (email_hash, host_key, scope, reason, source_job_id)
     SELECT $1, $2, $3, $4, $5::uuid
      WHERE NOT EXISTS (SELECT 1 FROM sales_outreach_suppressions WHERE email_hash = $1 AND scope = $3 AND reason = $4)`,
    [t.toHash, t.hostKey, scope, reason, t.jobId],
  );
  console.log('[sales-outreach-direct] 수신거부 기록:', t.jobId, scope, reason);
  const today = await query(
    `SELECT COUNT(*)::int AS n FROM sales_outreach_suppressions WHERE reason IN ('unsub', 'not_contact') AND created_at >= $1::timestamptz`,
    [kstDayStartIso()],
  );
  if ((Number(today.rows[0]?.n) || 0) >= DIRECT_STAGE_RULES.autoStop.dailyUnsub && !(await isAutoStopped())) {
    await stopAutoSend(`하루 수신거부 ${DIRECT_STAGE_RULES.autoStop.dailyUnsub}건`, null);
  }
  return true;
}

// ===== 네이버 스토어 저장본(사람 업로드 · 네트워크 0 · 불변 50) =====

export type StorePageUploadResult =
  | { mode: 'store'; campaigns: number; products: number }
  | { mode: 'text'; text: string; chars: number };

/**
 * 사람이 브라우저에서 저장한 스토어·기획전 페이지(.html).
 * ★ 2026-09-24 B — 파일 안에 스토어 상태(__PRELOADED_STATE__)가 있고 잡에 스토어 주소가 저장돼 있으면 북마크와 같은 판독기·같은 저장(store_grab 판 2)
 *   → 확인 화면 후보에 스토어 기획이 붙는다. 상태가 없거나 스토어 주소가 없으면 종전(행사 글자 → 붙여넣기 칸 · DB 쓰기 0).
 */
export async function extractOutreachStorePageText(jobId: string, html: string, operatorSuperAdminId: string | null | undefined): Promise<StorePageUploadResult> {
  await assertOperator(operatorSuperAdminId);
  const cur = await query(`SELECT stage, naver_store_slug FROM sales_outreach_jobs WHERE id = $1 AND purged_at IS NULL`, [jobId]);
  if (!cur.rows[0]) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'awaiting_confirm') throw new OutreachError('CONFLICT', '확인 대기 단계에서만 올릴 수 있습니다.');
  const slug = /^(brand|smartstore):([a-z0-9_-]{2,40})$/.exec(String(cur.rows[0].naver_store_slug || ''));
  const state = slug ? naverStoreStateFromHtml(html) : null;
  const material = state && slug ? parseNaverStoreState(state, { kind: slug[1] as 'brand' | 'smartstore', slug: slug[2] }) : null;
  if (material && slug) {
    const at = new Date().toISOString();
    const upd = await query(
      `UPDATE sales_outreach_jobs SET stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb
        WHERE id = $1 AND stage = 'awaiting_confirm' AND purged_at IS NULL RETURNING id`,
      [jobId, JSON.stringify({ store_grab: { v: 2, store: slug[0], material, at, by: operatorSuperAdminId || null } })],
    );
    if (!upd.rows[0]) throw new OutreachError('CONFLICT', '그 사이 제작이 시작되어 붙이지 못했습니다. 화면을 새로고침해주세요.');
    return { mode: 'store', campaigns: material.campaigns.length, products: material.products.length };
  }
  const text = storePageTextOf(html);
  if (text.length < 10) throw new OutreachError('VALIDATION', '파일에서 읽을 수 있는 행사 문구를 찾지 못했습니다. 기획전 페이지를 "웹페이지 전체"로 저장했는지 확인해주세요.');
  return { mode: 'text', text, chars: text.length };
}

export interface StoreGrabResult {
  /** 판정한 스토어 저장값(brand:slug · smartstore:slug) */
  store: string;
  /** 붙인 건(하나로 정해졌을 때만) · 기획 수 · 상품 수 */
  attached: { jobId: string; companyName: string; campaigns: number; products: number } | null;
  /** 같은 스토어로 받을 수 있는 건이 여럿 = 사람이 고른다(붙이지 않음) */
  choices: Array<{ jobId: string; companyName: string; stage: string; createdAt: string }>;
  /** 붙이지 못한 이유 · no_job = 이 스토어로 등록된 건 없음 · past_confirm = 전부 확정 뒤 */
  reason: 'no_job' | 'past_confirm' | null;
}

/**
 * ★0924 네이버 스토어 화면 가져오기(설계서 §9-1) — 직원 브라우저에 이미 떠 있는 화면을 북마크 버튼이 보내 온 것.
 * ★ 2026-09-24 B(판 2 · docs/2026-09-24-outreach-naver-store-reader-design.md) — 버튼이 보낸 것 = 스토어 상태의 허용 칸(글자 긁기 폐기).
 *   서버는 한 번 더 허용 칸으로 거르고(pickNaverStoreState) 판독기가 기획·상품·관심고객수만 뽑는다.
 * 서버는 네이버에 요청하지 않는다(불변 50). 스토어 판정 = 저장값 CT · 붙일 건 = 같은 스토어 저장값 + 확정 전 단계.
 * 저장 = stage_results.store_grab {v:2, store, material, at, by} 뿐(상태 원문·페이지 주소 0). 확인 화면 후보는 eventCandidatesView 가 만든다.
 */
export async function grabOutreachStorePage(
  input: { pageUrl: string; state: unknown; jobId?: string | null },
  operatorSuperAdminId: string | null | undefined,
): Promise<StoreGrabResult> {
  await assertOperator(operatorSuperAdminId);
  const store = parseNaverStoreSlug(input.pageUrl);
  if (!store) throw new OutreachError('VALIDATION', '네이버 스토어 화면에서 눌러 주세요.');
  const r = await query(
    `SELECT id, company_name, stage, created_at FROM sales_outreach_jobs
      WHERE naver_store_slug = $1 AND purged_at IS NULL AND (stage_results->>'deleted_at') IS NULL
      ORDER BY created_at DESC LIMIT 20`,
    [store.value],
  );
  const open = r.rows.filter((x: Row) => (STORE_GRAB_STAGES as readonly string[]).includes(String(x.stage)));
  const choices = open.slice(0, 10).map((x: Row) => ({ jobId: String(x.id), companyName: String(x.company_name), stage: String(x.stage), createdAt: String(x.created_at?.toISOString?.() ?? x.created_at) }));
  if (open.length === 0) return { store: store.value, attached: null, choices: [], reason: r.rows.length ? 'past_confirm' : 'no_job' };
  const want = String(input.jobId || '').trim();
  if (want && !choices.some((c) => c.jobId === want)) throw new OutreachError('CONFLICT', '고른 건이 지금은 받을 수 없는 상태입니다. 스토어 화면에서 다시 눌러 주세요.');
  const targetId = want || (choices.length === 1 ? choices[0].jobId : '');
  if (!targetId) return { store: store.value, attached: null, choices, reason: null };
  const material = parseNaverStoreState(pickNaverStoreState(input.state), { kind: store.kind, slug: store.slug });
  if (!material) throw new OutreachError('VALIDATION', '이 화면에서 스토어 정보를 찾지 못했습니다. 스토어 첫 화면을 연 뒤 다시 눌러 주세요.');
  const at = new Date().toISOString();
  const upd = await query(
    `UPDATE sales_outreach_jobs SET stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb
      WHERE id = $1 AND naver_store_slug = $3 AND purged_at IS NULL AND (stage_results->>'deleted_at') IS NULL
        AND stage = ANY($4::text[])
      RETURNING company_name`,
    [targetId, JSON.stringify({ store_grab: { v: 2, store: store.value, material, at, by: operatorSuperAdminId || null } }), store.value, [...STORE_GRAB_STAGES]],
  );
  if (!upd.rows[0]) throw new OutreachError('CONFLICT', '그 사이 제작이 시작되어 붙이지 못했습니다. 화면을 새로고침해주세요.');
  console.log('[sales-outreach-direct] 스토어 가져오기:', targetId, store.value, `기획 ${material.campaigns.length}`, `상품 ${material.products.length}`);
  return { store: store.value, attached: { jobId: targetId, companyName: String(upd.rows[0].company_name), campaigns: material.campaigns.length, products: material.products.length }, choices: [], reason: null };
}

// ===== 작업대(§12 · 서버 계산 카드) =====

export type WorkbenchLane = 'reading' | 'confirm' | 'producing' | 'review' | 'hold' | 'send' | 'sent' | 'post_review' | 'failed';

export function laneOf(input: { stage: string; reviewed: boolean; hold: boolean; reviewFlag: string | null }): WorkbenchLane {
  const s = input.stage;
  if (s === 'queued' || s === 'crawling' || s === 'analyzing') return 'reading';
  if (s === 'awaiting_confirm') return 'confirm';
  if (s.startsWith('producing_')) return 'producing';
  if (s === 'failed') return 'failed';
  if (s === 'sent') return input.reviewFlag === 'pending' ? 'post_review' : 'sent';
  if (s === 'ready') return input.reviewed ? 'send' : input.hold ? 'hold' : 'review';
  return 'reading';
}

export async function getOutreachWorkbench(filter: { batch?: string | null }, operatorSuperAdminId: string | null | undefined): Promise<Row> {
  await assertOperator(operatorSuperAdminId);
  const batches = await query(
    `SELECT stage_results->'chain'->>'batch' AS batch, MIN(created_at) AS first_at, COUNT(*)::int AS n
       FROM sales_outreach_jobs
      WHERE (stage_results->>'deleted_at') IS NULL AND (stage_results->'chain'->>'batch') IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
    [],
  );
  const want = String(filter.batch || '').trim();
  const batch = want === 'single' ? 'single' : (/^[0-9a-f-]{36}$/i.test(want) ? want : (batches.rows[0]?.batch || 'single'));
  const unsub = (process.env.OUTREACH_UNSUB_NOTICE || '').trim();
  const params: unknown[] = [unsub];
  let where = `(j.stage_results->>'deleted_at') IS NULL AND j.purged_at IS NULL`;
  if (batch === 'single') where += ` AND (j.stage_results->'chain') IS NULL`;
  else { params.push(batch); where += ` AND j.stage_results->'chain'->>'batch' = $${params.length}`; }
  const r = await query(
    `SELECT j.id, j.company_name, j.homepage_url, j.stage, j.fail_reason, j.mail_result, j.mail_sent_at, j.preview_code, j.created_at,
            j.stage_results->'chain' AS chain, j.stage_results->'review' AS review, j.stage_results->'hold' AS hold,
            j.stage_results->'domain_ack' AS domain_ack, j.stage_results->'material' AS material, j.stage_results->'material_override' AS material_override,
            j.stage_results->'direct_last' AS direct_last, j.stage_results->'auto_send' AS auto_send, j.stage_results->>'auto_confirmed_at' AS auto_confirmed_at,
            j.event_quote->>'confirmedBy' AS confirmed_by, j.event_quote->'selectedList' AS selected_list,
            j.stage_results->'store_grab'->'material'->'campaigns' AS store_grab_campaigns, j.stage_results->'store_grab'->>'at' AS store_grab_at,
            j.contact_email, j.contact_name, j.contact_basis, j.naver_store_slug, j.reviewed_asset_id,
            e.id AS email_id, e.payload->>'subject' AS subject, (e.payload->>'placeholderCount')::int AS placeholder_count,
            e.payload->'adFooter'->>'unsubscribeUrl' AS unsub_url,
            CASE WHEN $1 = '' THEN TRUE ELSE position($1 IN COALESCE(e.payload->>'html', '')) > 0 END AS unsub_applied,
            d.payload->>'captureUrl' AS capture_url, d.payload->'visionScore' AS vision, d.payload->>'dmUrl' AS dm_url,
            s.id AS send_id, s.outcome AS send_outcome, s.review_flag, s.mode AS send_mode, s.created_at AS send_at
       FROM sales_outreach_jobs j
       LEFT JOIN LATERAL (SELECT a.id, a.payload FROM sales_outreach_assets a WHERE a.job_id = j.id AND a.kind = 'email_html' ORDER BY a.created_at DESC LIMIT 1) e ON TRUE
       LEFT JOIN LATERAL (SELECT a.payload FROM sales_outreach_assets a WHERE a.job_id = j.id AND a.kind = 'dm' ORDER BY a.created_at DESC LIMIT 1) d ON TRUE
       LEFT JOIN LATERAL (SELECT x.id, x.outcome, x.review_flag, x.mode, x.created_at FROM sales_outreach_sends x WHERE x.job_id = j.id ORDER BY x.created_at DESC LIMIT 1) s ON TRUE
      WHERE ${where}
      ORDER BY COALESCE((j.stage_results->'chain'->>'index')::int, 0), j.created_at DESC
      LIMIT 50`,
    params,
  );
  const st = await directStageInfo();
  const today = await todayAttempts();
  const cap = directDailyCap();
  const secret = outreachHashSecret();
  // 원장 조회는 묶음으로(주소 해시 · 회사 키)
  const rows: Row[] = r.rows;
  const toHashOf = (row: Row) => { const e = normalizeContactEmail(row.contact_email); return e && secret ? outreachAddressHash(e, secret) : null; };
  const hashes = rows.map(toHashOf).filter((h): h is string => !!h);
  const hosts = Array.from(new Set(rows.map(hostKeyOf)));
  const sup = hashes.length || hosts.length
    ? await query(`SELECT email_hash, host_key, scope FROM sales_outreach_suppressions WHERE email_hash = ANY($1::text[]) OR (scope = 'company' AND host_key = ANY($2::text[]))`, [hashes, hosts])
    : { rows: [] as Row[] };
  const active = hosts.length
    ? await query(`SELECT DISTINCT host_key FROM sales_outreach_sends WHERE host_key = ANY($1::text[]) AND outcome IN ('sending', 'sent') AND reopened_at IS NULL`, [hosts])
    : { rows: [] as Row[] };
  const supEmail = new Set(sup.rows.map((x: Row) => String(x.email_hash)));
  const supHost = new Set(sup.rows.filter((x: Row) => x.scope === 'company').map((x: Row) => String(x.host_key)));
  const activeHost = new Set(active.rows.map((x: Row) => String(x.host_key)));

  const cards = rows.map((row) => {
    const email = normalizeContactEmail(row.contact_email);
    const verdict = classifyContactDomain(email, row.homepage_url);
    const toHash = toHashOf(row);
    const hostKey = hostKeyOf(row);
    const expectedUrl = directUnsubscribeUrlOf(PUBLIC_BASE, String(row.id), email, secret);
    const base = computeSendLock(sendLockEnv(), row.email_id ? { subject: row.subject || '', placeholderCount: Number(row.placeholder_count) || 0, unsubApplied: row.unsub_applied === true } : null,
      sendLockMaterialOf({ material: row.material, material_override: row.material_override }));
    const lock = computeDirectSendLock(base, {
      stage: st.stage, hashReady: !!secret, contactEmail: email, contactBasis: row.contact_basis, domainVerdict: verdict,
      domainAcked: !!row.domain_ack && String(row.domain_ack.email || '') === String(email || ''),
      suppressed: (!!toHash && supEmail.has(toHash)) || supHost.has(hostKey),
      alreadySentCompany: activeHost.has(hostKey) && row.stage !== 'sent',
      todayAttempts: today, dailyCap: cap, requireReview: true,
      reviewedAssetId: row.reviewed_asset_id ? String(row.reviewed_asset_id) : null,
      latestAssetId: row.email_id ? String(row.email_id) : null,
      unsubLinkOk: row.email_id ? (!!expectedUrl && row.unsub_url === expectedUrl) : null,
    });
    const reviewed = !!row.email_id && String(row.reviewed_asset_id || '') === String(row.email_id);
    const selected: Row[] = Array.isArray(row.selected_list) ? row.selected_list : [];
    return {
      id: row.id,
      companyName: row.company_name,
      homepageUrl: row.homepage_url,
      stage: row.stage,
      lane: laneOf({ stage: String(row.stage), reviewed, hold: !!row.hold, reviewFlag: row.review_flag || null }),
      failReason: row.fail_reason || null,
      contact: { email, name: row.contact_name || null, basis: row.contact_basis || null },
      domainVerdict: verdict,
      naverStoreUrl: naverStoreUrlOf(row.naver_store_slug),
      // ★0924 B 스토어에서 가져온 기획 수·시각(판 1 글자 저장분 = 기획 0)
      storeGrab: row.store_grab_at ? { campaigns: Array.isArray(row.store_grab_campaigns) ? row.store_grab_campaigns.length : 0, at: String(row.store_grab_at) } : null,
      subject: row.subject || null,
      directSubject: row.subject ? directSubjectOf(String(row.subject)) : null,
      emailAssetId: row.email_id || null,
      captureUrl: row.capture_url || null,
      dmUrl: row.dm_url || null,
      previewUrl: row.preview_code ? `${PUBLIC_BASE}/api/outreach/v/${row.preview_code}` : null,
      visionOk: visionTwoItemsOk(row.vision),
      visionItems: row.vision && typeof row.vision === 'object' && row.vision.items && typeof row.vision.items === 'object'
        ? { passed: Object.values(row.vision.items).filter((v) => v === true).length, total: Object.keys(row.vision.items).length } : null,
      lock: { locked: lock.locked, reasons: lock.reasons, messages: lock.reasons.map(lockMessage) },
      reviewed,
      hold: row.hold || null,
      autoConfirmed: row.confirmed_by === 'auto:v1',
      autoSendApproved: !!validApproval(row.auto_send),
      events: selected.map((c) => String(c?.title || c?.quote || '').slice(0, 40)).filter(Boolean).slice(0, 3),
      chainIndex: Number(row.chain?.index) || null,
      send: row.send_id ? { id: row.send_id, outcome: row.send_outcome, reviewFlag: row.review_flag || null, mode: row.send_mode, at: row.send_at } : null,
      directLast: row.direct_last || null,
      mailResult: row.mail_result || null,
    };
  });
  const laneCounts: Record<string, number> = {};
  for (const c of cards) laneCounts[c.lane] = (laneCounts[c.lane] || 0) + 1;
  return {
    batch,
    batches: batches.rows.map((b: Row) => ({ batch: b.batch, firstAt: b.first_at, n: Number(b.n) || 0 })),
    cards,
    laneCounts,
    stage: { effective: st.stage, env: st.envStage, data: st.dataStage, blockers: st.blockers },
    today, cap,
  };
}
