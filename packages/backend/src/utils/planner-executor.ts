/**
 * planner-executor.ts — 플래너 전용 실행 워커 (★ 2026-08-13 Phase 3 · ★ 2026-10-04 보강 B5 · 설계서 §6-7)
 *
 * **왜 전용 워커인가** — `operator_proposals.operator_id`가 NOT NULL이라(0813 실측) 플래너 발송을
 * 자동마케팅 원장에 실으려면 가짜 오퍼레이터 행이 필요하다. 그러면 매일 도는 제안 생성 워커가 그 행을 집고
 * 자동마케팅 화면·통계·만료 워커에 플래너 행이 섞인다 — 기각했다.
 * 대신 안전장치를 독립 CT로 부른다: 스팸 = CT-09(planner-copy) · 대상·적재 = planner-audience(단일 문) ·
 * 커밋 = createDirectSendCampaign(차감·환불 배관·워커 트리거 포함) · 통지 = notifyPlanner. 이 파일에는 "순서"만 있다.
 *
 * ⛔ 불변(★ 2026-10-04 보강)
 *   - **승인한 것 = 나가는 것**(§3-2). 실행 대상은 승인 각인(exec_meta.approved)이 있는 접점뿐이고, 예정일 당일에만 실행한다.
 *     문안은 당일 만들지 않는다 — 승인 때 각인된 문안을 보낸다(옛 당일 생성 · 재생성 콜백 · 소재 제작 분기 삭제).
 *   - 지문 대조 2회 = 선점 직후 · 커밋 직전. 어긋나면 보내지 않고 행사를 확인 대기로 되돌린다(planner-review · 새 링크 · 통지).
 *   - **쌍 규칙(H5)** — 같은 날 같은 사람에게 가는 문자와 모바일 DM은 1통이다. 문자 접점이 캐리어고, DM 형제는 같은 잠금에서 함께 선점한다.
 *     둘 중 하나라도 어긋나면 둘 다 보내지 않는다(되돌림 · 보류 · 생략을 한 문장으로).
 *   - 발송 당일 스팸 재검사 = 실주소가 붙은 최종 문안 · 재생성 0(maxRetries 0). 실패 = 보내지 않고 새 문안 확인으로(승인 마감 20시).
 *   - 준비 판정(발신번호 · 080 · 회사 메일)은 재료 창 · 승인과 같은 함수(planner-channel-gate · F2).
 *   - 대상 0건 = 생략 + 통지 · 크레딧 부족 = 그 쌍만 보류 + 통지 + [다시 시작] · 마이너스·자동충전 금지.
 *   - 실행 선점은 그 달 원장 행 잠금 안의 CAS(ready → producing) — 취소와 직렬화되고 동시 주기가 두 번 보내지 않는다.
 *   - **선점 뒤의 모든 쓰기는 선점 토큰을 조건으로 건다**(Codex 2R) — 회수·재개 뒤 새 실행이 집은 행을 옛 실행이 덮거나 되돌리지 않는다.
 *     토큰이 안 맞으면 그 실행은 아무것도 바꾸지 않고 물러난다(not_due · 판정은 새 주인).
 *   - 예정일은 선점 직전·직후에 다시 본다 — 그 사이 승인 풀기 · 날짜 변경 · 다시 승인이 끼면 다른 날의 접점을 오늘 보낸다(2R H5).
 *   - 고객에게 보이는 사유는 사전 문장만(planner-reasons · F4) · 원문 오류는 로그에만.
 *   - 문안비(10)는 발송 커밋 뒤 멱등키 `planner-send:{캐리어}`로 1회.
 */
import { randomUUID } from 'crypto';
import { SEND_HOURS } from '../config/defaults';
import { isSendableHourKst, hasUneditedBenefitPlaceholder } from './autosend-policy';
import { getOpt080Number } from './messageUtils';
import { checkCredit, deductCreditSafe, InsufficientCreditError } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { createDirectSendCampaign } from './direct-send-core';
import { DirectSendError } from './direct-send-spec';
import { SPAM_BLOCKED_CODE } from './spam-block';
import { sendEmailCampaign, resolveCustomerRecipients, getEmailCampaign } from './email-channel';
import { isEmailCampaignCompleted } from './email/email-completion';
import { emailContentBlocker } from './email/email-send-gate';
import {
  PlannerTouchpointRow,
  claimTouchpointUnderPlanLock,
  clearExecMetaKeys,
  guardExecMetaOrSkip,
  isPlannerPlanLive,
  loadAllLiveTouchpoints,
  loadEventTouchpoints,
  loadTouchpointById,
  notifyPlanner,
  setEventStatus,
  setTouchpointState,
  setTouchpointStates,
  stampExecMeta,
  stampSendAttemptOwned,
  touchClaim,
} from './planner-touchpoint';
import {
  CarrierSibling,
  PLANNER_SEND_SOURCE,
  appendDmLink,
  carrierKey,
  classifyExecutionWindow,
  decideMessagingDispatch,
  kstDateString,
  plannerSendKey,
  resolveAudienceMode,
} from './planner-execution';
import { cleanupPlannerStaging, loadPlannerStaging, resolvePlannerAudience } from './planner-audience';
import { inspectDmForCarry, isDmCarryable } from './planner-dm-check';
import { checkChannelReadiness } from './planner-channel-gate';
import { PLANNER_APPROVAL_DEADLINE_HOUR, computeTouchpointFingerprints } from './planner-confirm';
import { loadPlannerDefaultCallback, spamCheckPlannerCopy } from './planner-copy';
import { kickPlannerReview, revertEventToReview, settleEventIfFinished } from './planner-review';
import { PLANNER_REASON, sendRejectReason } from './planner-reasons';

export type ExecOutcome = 'sent' | 'skipped' | 'held' | 'locked' | 'review' | 'not_due';

/**
 * 선점 문맥(★ 2026-10-04 Codex 1R H5·H6) — 이 실행의 소유 증표(token)와 **선점 순간의 승인 지문**(접점 id → hash).
 * 보낼 본문은 선점 뒤 다시 읽은 행에서만 가져오고, 두 번의 지문 대조는 "지금 지문 = 각인 = 선점 때 각인"을 함께 본다.
 */
interface ClaimCtx { token: string; hashes: Map<string, string> }

/** 문자에 실을 DM — 형제 접점(같은 잠금에서 함께 선점됨)이거나, DM 접점 자신(캐리어 문자를 스스로 보낼 때)이다. */
interface CarryLink {
  /** 함께 선점한 DM 형제 접점(문자 접점이 캐리어일 때). DM 접점이 스스로 보낼 때는 null. */
  dm: PlannerTouchpointRow | null;
  /** 문자 끝에 붙일 발행 주소(승인 때 정해진 실주소). 없으면 ''. */
  url: string;
}

/**
 * 커밋이 **확정적으로 안 된** 실패 코드 — 발송 CT가 캠페인을 지우거나 중화한 뒤 던진다(잔액 부족) 또는 INSERT 전에 던진다.
 * 이 실패에서는 발송 시도 표식을 남길 이유가 없다 — 남기면 한 통도 안 나간 달의 대행료 환불이 "발송 시작됨"으로 막힌다.
 * 그 밖의 실패는 커밋 여부가 미확정이므로 표식을 유지한다(§3-9-1).
 */
const DEFINITE_NO_COMMIT = new Set(['INSUFFICIENT_BALANCE', 'LINK_PLACEHOLDER_UNEDITED', 'BENEFIT_PLACEHOLDER_UNEDITED', 'NIGHT_AD_RESTRICTED', SPAM_BLOCKED_CODE]);

// ── 공통 도우미 ──────────────────────────────────────────────────────
async function skip(tp: PlannerTouchpointRow, reason: string, notice: string, fromStatuses?: string[], claimToken?: string): Promise<ExecOutcome> {
  const ok = await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'skipped', lockReason: reason, fromStatuses, claimToken });
  if (!ok) return 'not_due';
  await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 생략', notice);
  return 'skipped';
}

async function lock(tp: PlannerTouchpointRow, reason: string, notice: string, fromStatuses?: string[], claimToken?: string): Promise<ExecOutcome> {
  const ok = await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'locked', lockReason: reason, fromStatuses, claimToken });
  if (!ok) return 'not_due';
  await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 보류', notice);
  return 'locked';
}

/**
 * 발송 시도 표식 — **커밋 전에** 남긴다.
 * 이 표식이 있고 실행 참조(exec_ref)가 없으면 "보냈는지 모르는 상태"다 → 대조 워커가 재발송하지 않고 사람을 부른다.
 * 동반 DM 접점에도 **같은 문장으로** 남긴다 — 두 문장이면 두 번째가 끊겼을 때 캠페인도 없이 캐리어에만 표식이 남는다.
 * ★ 2026-10-04 이 실행이 아직 주인일 때만(producing + 같은 선점 토큰) 남긴다 — false = 주인이 아니다 → 보내지 않는다(Codex 1R H6).
 */
async function stampSendAttempt(tp: PlannerTouchpointRow, claim: ClaimCtx, patch: Record<string, unknown>, companion?: PlannerTouchpointRow | null): Promise<boolean> {
  const at = { send_started_at: new Date().toISOString(), ...patch };
  if (companion) {
    const ok = await stampSendAttemptOwned(tp.companyId, [tp.id, companion.id], claim.token, { ...at, carried_by: tp.id });
    // 캐리어 행의 carried_by는 의미가 없다 — 자기 id를 지운다(동반 행에만 남는다).
    if (ok) await clearExecMetaKeys(tp.companyId, tp.id, ['carried_by']).catch(() => { /* 표식뿐 */ });
    return ok;
  }
  return stampSendAttemptOwned(tp.companyId, [tp.id], claim.token, at);
}

/**
 * 확정 실패(커밋 안 됨)의 표식 정리 — 감사 흔적은 `send_aborted_at`으로 남기고 실행 집계에서는 뺀다.
 * ⛔ 실패를 삼키지 않는다 — 남은 표식 하나가 재개를 막고 그 달 환불까지 막는다. 재시도하고, 그래도 안 되면 사람을 부른다.
 */
async function clearSendAttempt(tp: PlannerTouchpointRow, companion: PlannerTouchpointRow | null, code: string): Promise<void> {
  const patch = { send_aborted_at: new Date().toISOString(), send_abort_code: code };
  const targets = companion ? [tp, companion] : [tp];
  for (const row of targets) {
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        await clearExecMetaKeys(row.companyId, row.id, ['send_started_at'], patch);
        ok = true;
      } catch (e: any) {
        console.error(`[planner-executor] 발송 시도 표식 정리 ${attempt + 1}차 실패 tp=${row.id}:`, e?.message || e);
      }
    }
    if (!ok) {
      await notifyPlanner(row.companyId, row.createdBy, '[마케팅 플래너] 확인 필요',
        `'${row.title}' ${row.channelLabel} 발송이 접수되지 않았는데 시도 기록을 정리하지 못했습니다. 운영팀 확인이 필요합니다.`);
    }
  }
}

/**
 * 발송 성공 마감 — 실행 참조를 남기고, 그 행사의 남은 터치포인트가 없으면 행사를 마감한다.
 * 동반 DM 형제가 있으면 **두 행을 한 문장으로** sent 마감한다(재기동 시 한 행만 남는 창 제거).
 * ⛔ 발송은 이미 커밋됐다 — 이 기록이 실패하면 되돌릴 수 없으므로 **재시도하고, 그래도 실패하면 알린다**.
 */
async function markSent(
  tp: PlannerTouchpointRow,
  claimToken: string,
  execRef: string | null,
  sentCount: number,
  extra?: Record<string, any>,
  companion?: { row: PlannerTouchpointRow; extra: Record<string, any> } | null,
): Promise<void> {
  const sentAt = new Date().toISOString();
  const rows = [
    { id: tp.id, status: 'sent', lockReason: null, execRef: execRef ?? null, execMetaPatch: { sent_at: sentAt, sent_count: sentCount, ...(extra || {}) } },
    ...(companion
      ? [{ id: companion.row.id, status: 'sent', lockReason: null, execRef: execRef ?? null, execMetaPatch: { sent_at: sentAt, sent_count: sentCount, ...companion.extra } }]
      : []),
  ];
  let done: string[] = [];
  for (let attempt = 0; attempt < 2 && done.length < rows.length; attempt++) {
    try {
      // ⛔ **내가 선점한 행(producing + 내 토큰)에만 마감을 건다.** 가드 없이 쓰면 취소·다른 경로가 옮긴 상태를 조용히 덮는다.
      const updated = await setTouchpointStates(tp.companyId, rows.filter((r) => !done.includes(r.id)), ['producing'], claimToken);
      done = [...done, ...updated];
      if (updated.length === 0) break;
    } catch (e: any) {
      console.warn(`[planner-executor] 발송 마감 기록 ${attempt + 1}차 실패 tp=${tp.id}:`, e?.message || e);
    }
  }
  for (const r of rows) {
    if (done.includes(r.id)) continue;
    // 참조는 남긴다(상태는 사람이 판정한다) — 단 이 실행이 아직 주인일 때만(Codex 3R). 주인을 잃었으면 그 행은 새 실행 것이라
    // 손대지 않는다. 그때 증거 = 발송 원장(캠페인 · 메일 발송 기록) + 이 로그.
    const kept = await stampExecMeta(tp.companyId, r.id, { ...r.execMetaPatch, mark_sent_conflict: true }, claimToken).catch(() => false);
    if (!kept) console.error(`[planner-executor] 발송 마감 기록 못 함(소유 상실 또는 DB) tp=${r.id} ref=${r.execRef || ''}`);
    await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 확인 필요',
      `'${tp.title}' ${r.id === tp.id ? tp.channelLabel : '모바일 DM'} 발송은 접수됐지만 기록이 실패했습니다. 발송 결과를 확인해 주세요.`);
  }
  if (!done.includes(tp.id)) return;
  // ★ 2026-10-04 완료 판정 한 벌(Codex 1R M11) — 발송 완료·생략만 끝으로 본다. 잠금·보류가 남아 있으면 행사를 닫지 않는다
  //   (닫으면 [다시 시작]이 막혀 남은 발송을 영영 못 보낸다). 규칙 소유 = planner-review.settleEventIfFinished.
  const closed = await settleEventIfFinished(tp.companyId, tp.eventId, 'missed').catch(() => null);
  if (!closed) await setEventStatus(tp.companyId, tp.eventId, 'scheduled', ['approved', 'producing']);
}

// ── 문자·DM 쌍 마감 ──────────────────────────────────────────────────
type PairEnd = { kind: 'held' | 'skipped' | 'locked'; reason: string; notice: string };

/**
 * 캐리어 문자가 보내지 못했을 때의 마감 — 캐리어와 동반 DM을 **한 문장**으로 옮긴다(부분 마감 창 제거).
 *   - 행사가 그 사이 취소됐으면 둘 다 취소 사유의 생략(취소는 producing을 건드리지 않으므로 여기서 닫는다).
 *   - 생략(대상 0건)이면 DM도 함께 생략(같은 대상이다).
 *   - 보류·잠금이면 둘 다 같은 상태(쌍 규칙 · [다시 시작]이 둘을 함께 되살린다).
 * 통지는 캐리어 전이가 실제로 일어났을 때만.
 */
async function endPair(tp: PlannerTouchpointRow, link: CarryLink, claimToken: string, end: PairEnd): Promise<ExecOutcome> {
  const live = await isPlannerPlanLive(tp.companyId, tp.eventId).catch(() => true);
  const status = !live ? 'skipped' : end.kind === 'held' ? 'hold_credit' : end.kind;
  const reason = !live ? PLANNER_REASON.cancelledEvent : end.reason;
  const patch = end.kind === 'held' && live ? { hold_reason: 'insufficient_credit', held_at: new Date().toISOString() } : {};
  const rows = [
    { id: tp.id, status, lockReason: reason, execMetaPatch: patch },
    ...(link.dm ? [{ id: link.dm.id, status, lockReason: !live ? reason : end.kind === 'skipped' ? '같은 날의 문자가 생략되어 모바일 DM도 함께 생략했습니다.' : reason, execMetaPatch: patch }] : []),
  ];
  const updated = await setTouchpointStates(tp.companyId, rows, ['producing'], claimToken);
  if (!updated.includes(tp.id)) return 'not_due'; // 주인이 아니다 — 아무것도 바꾸지 않았다
  if (live) {
    const title = end.kind === 'skipped' ? '[마케팅 플래너] 발송 생략' : '[마케팅 플래너] 발송 보류';
    await notifyPlanner(tp.companyId, tp.createdBy, title, end.notice);
  }
  return !live ? 'skipped' : end.kind;
}

/**
 * 확인 대기로 되돌린다(지문 어긋남 · 스팸 실패 · DM 열리지 않음) — 쌍 전체 · 통지 · 다음 단계 당김.
 * 선점 토큰이 안 맞으면(회수·재개 뒤 새 실행이 집었다) 아무것도 바꾸지 않는다('lost' → not_due).
 */
async function backToReview(tp: PlannerTouchpointRow, link: CarryLink, claim: ClaimCtx, reason: string, dropCopy: boolean, notice: string): Promise<ExecOutcome> {
  const ids = [tp.id, ...(link.dm ? [link.dm.id] : [])];
  const out = await revertEventToReview({ companyId: tp.companyId, eventId: tp.eventId, claimedIds: ids, failedIds: ids, reason, dropCopy, claimToken: claim.token });
  if (out === 'reverted') {
    await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 다시 확인이 필요합니다', notice);
    kickPlannerReview(tp.companyId, tp.eventId);
    return 'review';
  }
  return out === 'cancelled' ? 'skipped' : 'not_due';
}

/** 예외(throw) 뒤 동반 DM 정리 — 표식이 남아 있으면(커밋 미확정) 잠그고, 아니면 ready로 되돌린다(취소된 행사면 생략). */
async function settleCompanionAfterError(dm: PlannerTouchpointRow, stampRemains: boolean, claimToken: string): Promise<void> {
  try {
    if (stampRemains) {
      await setTouchpointState({ companyId: dm.companyId, touchpointId: dm.id, status: 'locked', fromStatuses: ['producing'], lockReason: PLANNER_REASON.sendUnknown, claimToken });
      return;
    }
    const live = await isPlannerPlanLive(dm.companyId, dm.eventId);
    await setTouchpointState({
      companyId: dm.companyId, touchpointId: dm.id,
      status: live ? 'ready' : 'skipped', fromStatuses: ['producing'],
      lockReason: live ? null : PLANNER_REASON.cancelledEvent, claimToken,
    });
  } catch (e: any) {
    console.error(`[planner-executor] 동반 DM 정리 실패 tp=${dm.id}:`, e?.message || e);
  }
}

/**
 * 지문 대조 — 승인 때 각인한 지문과 지금 다시 계산한 지문이 같은가(쌍이면 둘 다). 같은 함수(planner-confirm)로 계산한다.
 * 실패(조회 오류)는 "다르다"로 본다(fail-closed · 보내지 않는다).
 */
async function fingerprintsMatch(tp: PlannerTouchpointRow, link: CarryLink, claim: ClaimCtx): Promise<boolean> {
  try {
    const all = await loadEventTouchpoints(tp.companyId, tp.eventId);
    const fps = await computeTouchpointFingerprints(tp.companyId, all);
    const mine = [tp, ...(link.dm ? [link.dm] : [])];
    return mine.every((row) => {
      const fresh = all.find((x) => x.id === row.id);
      const stamped = String(fresh?.execMeta?.approved?.hash || '');
      return !!stamped && stamped === fps.get(row.id) && stamped === claim.hashes.get(row.id)
        && fresh?.status === 'producing' && fresh?.execMeta?.claim_token === claim.token;
    });
  } catch (e: any) {
    console.warn(`[planner-executor] 지문 대조 실패 tp=${tp.id}(보내지 않음):`, e?.message || e);
    return false;
  }
}

/** DM 실물 확인 — 승인 때 정해진 주소가 지금도 열리는가(발행 · 중지 아님 · 빈 자리 0). 반환 = 열리면 true. */
async function dmStillOpen(tp: PlannerTouchpointRow, link: CarryLink): Promise<boolean> {
  const dmTp = link.dm || (tp.channel === 'dm' ? tp : null);
  if (!dmTp) return true;
  if (!dmTp.assetRef || !link.url) return false;
  const state = await inspectDmForCarry(tp.companyId, dmTp.assetRef).catch(() => null);
  return isDmCarryable(state) && state!.url === link.url;
}

// ── 채널 실행 ────────────────────────────────────────────────────────
async function executeMessaging(tp: PlannerTouchpointRow, link: CarryLink, today: string, claim: ClaimCtx): Promise<ExecOutcome> {
  let stampRemains = false;
  try {
    return await executeMessagingCore(tp, link, today, claim, {
      onStamp: () => { stampRemains = true; },
      onAbort: () => { stampRemains = false; },
    });
  } catch (e) {
    if (link.dm) await settleCompanionAfterError(link.dm, stampRemains, claim.token);
    throw e;
  }
}

async function executeMessagingCore(
  tp: PlannerTouchpointRow,
  link: CarryLink,
  today: string,
  claim: ClaimCtx,
  hooks: { onStamp: () => void; onAbort: () => void },
): Promise<ExecOutcome> {
  const end = (kind: PairEnd['kind'], reason: string, notice: string) => endPair(tp, link, claim.token, { kind, reason, notice });
  const review = (reason: string, dropCopy: boolean, notice: string) => backToReview(tp, link, claim, reason, dropCopy, notice);
  const label = link.dm || tp.channel === 'dm' ? '문자(모바일 DM 링크 포함)' : tp.channelLabel;

  // ① 준비 판정(F2 · 재료 창 · 승인과 같은 함수)
  const ready = await checkChannelReadiness(tp.channel === 'dm' ? 'dm' : 'sms', { companyId: tp.companyId, userId: tp.createdBy, phase: 'send' });
  if (!ready.ok) return end('locked', ready.reason || PLANNER_REASON.sendFailed, `'${tp.title}' ${label} 발송을 보류했습니다. ${ready.reason || ''}`.trim());
  const callback = await loadPlannerDefaultCallback(tp.companyId);
  const opt080 = await getOpt080Number(tp.createdBy || null, tp.companyId);
  if (!callback || !opt080) return end('locked', PLANNER_REASON.sendFailed, `'${tp.title}' ${label} 발송에 쓸 발신번호 또는 무료거부 번호를 확인하지 못해 보류했습니다.`);

  // ② 지문 대조 ① — 선점 직후(승인한 것 = 나가는 것)
  if (!(await fingerprintsMatch(tp, link, claim))) {
    return review(PLANNER_REASON.changedAfterApproval, false,
      `'${tp.title}' 승인한 뒤 문자·모바일 DM 내용이 바뀌어 오늘 발송을 멈췄습니다. 바뀐 내용을 확인한 뒤 다시 승인해 주세요. 다시 승인해도 크레딧은 두 번 빠지지 않습니다.`);
  }
  if (!(await dmStillOpen(tp, link))) {
    return review(PLANNER_REASON.dmUnavailable, false,
      `'${tp.title}' 모바일 DM 주소가 열리지 않는 상태(중지 · 삭제)라 오늘 발송을 멈췄습니다. 모바일 DM을 확인한 뒤 다시 승인해 주세요.`);
  }

  const copy = tp.execMeta?.copy;
  if (!copy?.text || !String(copy.text).trim()) {
    return review(PLANNER_REASON.copyFailed, true, `'${tp.title}' 승인한 문자 문안을 찾지 못해 오늘 발송을 멈췄습니다. 새 문안을 확인해 주세요.`);
  }
  const finalBody = appendDmLink(String(copy.text), link.url);
  const subject = String(copy.subject || '');
  if (hasUneditedBenefitPlaceholder(finalBody) || hasUneditedBenefitPlaceholder(subject)) {
    return review(PLANNER_REASON.copyFailed, true, `'${tp.title}' 문안에 채워지지 않은 혜택 자리가 있어 오늘 발송을 멈췄습니다. 새 문안을 확인해 주세요.`);
  }

  // ③ 문안비 잔액(보내기 전 확인 · 차감은 커밋 뒤)
  const cost = getCreditCost(PLANNER_SEND_SOURCE);
  try {
    if (cost > 0) await checkCredit(tp.companyId, cost);
  } catch (err) {
    if (err instanceof InsufficientCreditError) {
      return end('held', PLANNER_REASON.creditShort, `'${tp.title}' ${label} 발송이 크레딧 부족으로 보류됐습니다. 충전 후 [다시 시작]을 눌러 주세요.`);
    }
    throw err;
  }

  // ④ 발송 당일 스팸 재검사 — 실주소가 붙은 최종 문안 · 재생성 0
  const claimIds = link.dm ? [tp.id, link.dm.id] : [tp.id];
  await touchClaim(tp.companyId, claimIds);
  const passed = await spamCheckPlannerCopy({
    tp, body: finalBody, subject, callback, rejectNumber: opt080, link: link.url, withDmLink: !!link.url, regenerate: false,
  });
  await touchClaim(tp.companyId, claimIds);
  if (!passed) {
    return review(PLANNER_REASON.spamFailed, true,
      `'${tp.title}' 오늘 보낼 문자가 스팸 검사를 통과하지 못해 멈췄습니다. 새 문안을 만들어 확인 링크를 보내 드립니다. 오늘 ${PLANNER_APPROVAL_DEADLINE_HOUR}시 전에 승인하시면 오늘 나갑니다.`);
  }

  // ⑤ 대상
  const mode = resolveAudienceMode(tp.channel, tp.timing);
  const audience = await resolvePlannerAudience({ companyId: tp.companyId, createdBy: tp.createdBy, mode, plannerEventId: tp.eventId });
  if (audience.blocked) return end('locked', PLANNER_REASON.scopeBlocked, `'${tp.title}' ${label} 발송을 보류했습니다. ${PLANNER_REASON.scopeBlocked}`);
  const stagingId = randomUUID();
  let total = 0;
  try {
    total = await loadPlannerStaging({ stagingId, audience });
  } catch (e: any) {
    await cleanupPlannerStaging(stagingId);
    throw e;
  }
  if (total === 0) {
    await cleanupPlannerStaging(stagingId);
    return end('skipped', PLANNER_REASON.audienceZero, `'${tp.title}' ${label} 발송 대상이 0명이라 이번 발송을 생략했습니다.`);
  }

  // ⑥ 지문 대조 ② — 커밋 직전(스팸 검사 수 분 동안 고쳤을 수 있다)
  if (!(await fingerprintsMatch(tp, link, claim)) || !(await dmStillOpen(tp, link))) {
    await cleanupPlannerStaging(stagingId);
    return review(PLANNER_REASON.changedAfterApproval, false,
      `'${tp.title}' 발송 직전에 문자·모바일 DM 내용이 바뀌어 오늘 발송을 멈췄습니다. 바뀐 내용을 확인한 뒤 다시 승인해 주세요.`);
  }

  // ⑦ 커밋
  let campaignId: string;
  try {
    if (!(await stampSendAttempt(tp, claim, { staging_id: stagingId }, link.dm))) {
      // 이 실행이 더는 주인이 아니다(회수·다시 시작) — 보내지 않고 손대지 않는다(새 주인이 판정한다)
      await cleanupPlannerStaging(stagingId);
      console.warn(`[planner-executor] 선점을 잃어 발송하지 않음 tp=${tp.id}`);
      return 'not_due';
    }
    hooks.onStamp();
    const res = await createDirectSendCampaign(
      {
        stagingId,
        campaignName: `마케팅 플래너 ${tp.title} ${tp.scheduledOn}`.slice(0, 200),
        msgType: 'LMS',
        message: finalBody,
        subject: subject || null,
        callback,
        sendChannel: 'sms',
        adEnabled: true,
        total,
        dedupEnabled: true,
        unsubFilterEnabled: true,
      },
      { companyId: tp.companyId, userId: tp.createdBy || tp.companyId },
      { finalSource: 'selected_as_is', aiMessages: [finalBody] },
    );
    campaignId = res.campaignId;
  } catch (e: any) {
    await cleanupPlannerStaging(stagingId);
    if (e instanceof DirectSendError && DEFINITE_NO_COMMIT.has(String(e.code))) {
      // 커밋이 확정적으로 안 됐다 — 표식을 걷어 무발송 달의 환불이 막히지 않게 한다.
      await clearSendAttempt(tp, link.dm, String(e.code));
      hooks.onAbort();
      console.warn(`[planner-executor] 발송 접수 거부 tp=${tp.id} code=${e.code}: ${String(e.message || '').slice(0, 200)}`);
      if (e.code === 'INSUFFICIENT_BALANCE') {
        return end('held', PLANNER_REASON.creditShort, `'${tp.title}' ${label} 발송 잔액이 부족해 보류했습니다. 충전 후 [다시 시작]을 눌러 주세요.`);
      }
      const why = sendRejectReason(String(e.code));
      return end('locked', why, `'${tp.title}' ${label} 발송을 보류했습니다. ${why}`);
    }
    // ⛔ 표식을 남긴 뒤의 실패는 **다시 시도하지 않는다** — 커밋 여부를 확정할 수 없어 자동 재시도가 곧 이중 발송이 된다. 사람이 판정한다.
    console.error(`[planner-executor] 발송 커밋 실패 tp=${tp.id}:`, e?.message || e);
    const updated = await setTouchpointStates(tp.companyId, [
      { id: tp.id, status: 'locked', lockReason: PLANNER_REASON.sendUnknown, execMetaPatch: {} },
      ...(link.dm ? [{ id: link.dm.id, status: 'locked', lockReason: PLANNER_REASON.sendUnknown, execMetaPatch: {} }] : []),
    ], ['producing'], claim.token);
    if (updated.includes(tp.id)) {
      await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 확인 필요',
        `'${tp.title}' ${label} 발송 접수 결과를 확인하지 못했습니다. 발송 결과 화면에서 나갔는지 확인해 주세요.`);
    }
    return 'locked';
  }

  // 발송이 커밋됐다 — 문안 크레딧을 멱등키로 1회 정산한다(미확정이면 [CREDIT][MISS] 로그 · 발송은 되돌리지 않는다).
  if (cost > 0) {
    const settled = await deductCreditSafe({
      companyId: tp.companyId, cost, source: PLANNER_SEND_SOURCE, createdBy: tp.createdBy, idempotencyKey: plannerSendKey(tp.id),
    });
    if (!settled) console.warn(`[planner-executor] 문안 크레딧 미확정 tp=${tp.id} — [CREDIT][MISS] 로그 확인`);
  }
  await markSent(
    tp, claim.token, campaignId, total,
    { campaign_id: campaignId, ...(link.url ? { dm_url: link.url } : {}), ...(link.dm ? { dm_touchpoint_id: link.dm.id } : {}) },
    link.dm ? { row: link.dm, extra: { campaign_id: campaignId, carried_by: tp.id, dm_url: link.url, copy_charged_by: tp.id } } : null,
  );
  await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 완료', `'${tp.title}' ${label} ${total.toLocaleString()}명 발송을 접수했습니다.`);
  console.log(`[planner-executor] ${tp.channel} 발송 tp=${tp.id}${link.dm ? ` +dm=${link.dm.id}` : ''} campaign=${campaignId} ${total}명 (${today})`);
  return 'sent';
}

/** 메일 — 승인 때 완성(50)한 캠페인을 예정일에 보낸다. 지문 · 준비 판정 · 내용 잠금 · 완성 여부를 다 본 뒤에만. */
async function executeEmail(tp: PlannerTouchpointRow, claim: ClaimCtx): Promise<ExecOutcome> {
  const noLink: CarryLink = { dm: null, url: '' };
  const ready = await checkChannelReadiness('email', { companyId: tp.companyId, userId: tp.createdBy, phase: 'send' });
  if (!ready.ok) return lock(tp, ready.reason || PLANNER_REASON.sendFailed, `'${tp.title}' 메일 발송을 보류했습니다. ${ready.reason || ''}`.trim(), ['producing'], claim.token);
  const campaignId = String(tp.assetRef || '');
  if (!campaignId) return backToReview(tp, noLink, claim, PLANNER_REASON.materialsMissing, false, `'${tp.title}' 메일 완성본을 찾지 못해 오늘 발송을 멈췄습니다. 메일을 확인해 주세요.`);
  if (!(await fingerprintsMatch(tp, noLink, claim))) {
    return backToReview(tp, noLink, claim, PLANNER_REASON.changedAfterApproval, false,
      `'${tp.title}' 승인한 뒤 메일 내용이 바뀌어 오늘 발송을 멈췄습니다. 바뀐 내용을 확인한 뒤 다시 승인해 주세요.`);
  }
  const campaign = await getEmailCampaign(tp.companyId, campaignId);
  const contentBlock = campaign ? emailContentBlocker(campaign) : null;
  if (!campaign || contentBlock || !(await isEmailCampaignCompleted(tp.companyId, campaignId))) {
    if (contentBlock) console.warn(`[planner-executor] 메일 내용 잠금 tp=${tp.id}: ${contentBlock.error}`);
    return backToReview(tp, noLink, claim, PLANNER_REASON.materialsMissing, false, `'${tp.title}' 메일이 보낼 수 있는 상태가 아니라 오늘 발송을 멈췄습니다. 메일을 확인한 뒤 다시 승인해 주세요.`);
  }
  await touchClaim(tp.companyId, tp.id);
  const recipients = await resolveCustomerRecipients(tp.companyId);
  if (recipients.length === 0) return skip(tp, PLANNER_REASON.emailZero, `'${tp.title}' 메일을 받을 수 있는 고객이 0명이라 발송을 생략했습니다.`, ['producing'], claim.token);
  // ★ 2026-10-04 메일도 발송 전에 시도 표식(Codex 1R H4) — 중간에 끊긴 달의 대행료가 "발송 0건"으로 환불되지 않게.
  //   메일 발송 CT는 이미 받은 사람(delivered)을 건너뛰므로 [다시 시작]은 남은 사람에게만 간다(planner-touchpoint 선점 조건).
  if (!(await stampSendAttempt(tp, claim, { email_campaign_id: campaignId }))) {
    console.warn(`[planner-executor] 선점을 잃어 메일을 보내지 않음 tp=${tp.id}`);
    return 'not_due';
  }
  try {
    const res = await sendEmailCampaign({ campaignId, recipients, immediate: true });
    await markSent(tp, claim.token, campaignId, res.sentCount, { email_campaign_id: campaignId });
    await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 완료', `'${tp.title}' 메일 ${res.sentCount.toLocaleString()}명 발송을 완료했습니다.`);
    return 'sent';
  } catch (e: any) {
    // ⛔ 원문은 로그에만(F4). 메일 발송 CT는 이미 받은 사람을 건너뛰므로 같은 날 다시 시작해도 두 번 가지 않는다.
    console.error(`[planner-executor] 메일 발송 실패 tp=${tp.id}:`, e?.message || e);
    return lock(tp, PLANNER_REASON.emailPartial, `'${tp.title}' ${PLANNER_REASON.emailPartial}`, ['producing'], claim.token);
  }
}

// ── 실행 1건 ─────────────────────────────────────────────────────────
const toSibling = (s: PlannerTouchpointRow): CarrierSibling => ({ id: s.id, channel: s.channel, status: s.status, stage: '' });

/**
 * 쌍 판정 — 같은 날 같은 사람(carrierKey)에게 가는 문자·DM 형제를 **최신 행으로** 읽어 판정한다.
 * 선점 뒤 다시 부를 때는 내 토큰으로 선점한 행을 선점 전 상태(ready)로 본다 → 선점 전 판정과 같은 규칙으로 비교된다(Codex 3R).
 */
async function decidePair(tp: PlannerTouchpointRow, ownToken: string | null) {
  const key = carrierKey(tp.scheduledOn, tp.timing);
  const siblings = (await loadEventTouchpoints(tp.companyId, tp.eventId))
    .filter((s) => s.id !== tp.id && (s.channel === 'sms' || s.channel === 'dm') && carrierKey(s.scheduledOn, s.timing) === key);
  const seen = (s: PlannerTouchpointRow): CarrierSibling => ({
    ...toSibling(s),
    status: ownToken && s.status === 'producing' && s.execMeta?.claim_token === ownToken ? 'ready' : s.status,
  });
  return { decision: decideMessagingDispatch({ channel: tp.channel as 'sms' | 'dm', status: 'ready', stage: '' }, siblings.map(seen)), siblings };
}

/**
 * 터치포인트 1건 실행. 승인 각인 확인 → 쌍 판정 → 선점(월 원장 잠금 CAS) → 채널 실행 → 상태 마감.
 * ⛔ 선점 실패(0행) = 다른 주기가 이미 집었다 · 취소됐다 → 손대지 않는다(이중 발송 차단).
 */
export async function executeTouchpoint(tp: PlannerTouchpointRow, today = kstDateString()): Promise<ExecOutcome> {
  if (classifyExecutionWindow(tp.scheduledOn, today) !== 'due') return 'not_due';
  // 패스가 한 번에 여러 행을 읽어 뒤쪽 행은 낡은 스냅샷이다 — 최신 행으로 다시 본다.
  const fresh = await loadTouchpointById(tp.companyId, tp.id);
  if (!fresh || fresh.status !== 'ready' || !fresh.execMeta?.approved) return 'not_due';
  if (classifyExecutionWindow(fresh.scheduledOn, today) !== 'due') return 'not_due'; // 그 사이 날짜가 바뀌었다(2R H5)
  tp = fresh;
  if (tp.channel !== 'sms' && tp.channel !== 'dm' && tp.channel !== 'email') {
    // 1차 플래너 채널 밖(옛 인앱·알림톡) — 전환 패스가 닫지만 여기서도 보내지 않는다.
    return skip(tp, PLANNER_REASON.notInPhase1, `'${tp.title}' ${PLANNER_REASON.notInPhase1}`, ['ready']);
  }

  // 쌍 판정 — 같은 날 같은 사람(carrierKey)에게 가는 문자와 DM은 1통이다.
  const link: CarryLink = { dm: null, url: '' };
  if (tp.channel === 'sms' || tp.channel === 'dm') {
    const { decision, siblings } = await decidePair(tp, null);
    if (decision.action === 'wait' || decision.action === 'carried') return 'not_due';
    if (decision.action === 'skip') return skip(tp, decision.reason, `'${tp.title}' 모바일 DM: ${decision.reason}`, ['ready']);
    if (decision.attach) {
      link.dm = siblings.find((s) => s.id === decision.attach!.id) || null;
      link.url = String(link.dm?.execMeta?.dm_url || tp.execMeta?.dm_url || '');
    } else if (tp.channel === 'dm') {
      link.url = String(tp.execMeta?.dm_url || '');
    }
  }

  // ⛔ 선점은 그 달 원장 행 잠금 안에서 — 취소·되돌림과 직렬화된다. 동반 DM 형제도 같은 잠금·같은 트랜잭션에서 함께.
  const companions = link.dm ? [{ id: link.dm.id, fromStatuses: ['ready'] }] : [];
  const token = randomUUID();
  if (!(await claimTouchpointUnderPlanLock(tp, ['ready'], 'claimed_at', companions, token))) return 'not_due';

  // ★ 2026-10-04 선점 뒤 최신 행으로 다시 읽는다(Codex 1R H5) — 보낼 문안 · DM 주소 · 각인 지문은 전부 이 행에서만 가져온다.
  //   선점 전 스냅샷의 문안을 보내면 그 사이 승인 풀기 · 고치기 · 다시 승인으로 바뀐 내용과 나가는 내용이 갈린다.
  const owned = await loadTouchpointById(tp.companyId, tp.id);
  const ownedDm = link.dm ? await loadTouchpointById(tp.companyId, link.dm.id) : null;
  const ours = (row: PlannerTouchpointRow | null) => !!row && row.status === 'producing' && row.execMeta?.claim_token === token && !!row.execMeta?.approved?.hash;
  if (!ours(owned) || (link.dm && !ours(ownedDm))) return 'not_due';
  // ★ 2026-10-04 예정일 · 쌍 재확인(Codex 2R H5 · 3R) — 선점 전 읽기와 선점 사이에 승인 풀기 · 날짜 변경 · 다시 승인이 끼면
  //   이 행은 다른 날 것이 됐거나 새 DM 형제가 묶였을 수 있다. 지문은 새 내용으로 다시 각인돼 대조를 통과하므로 날짜와 쌍을 따로 본다.
  //   선점한 묶음(캐리어 + 동반 DM)이 최신 판정과 정확히 같지 않으면 선점을 놓고(내 토큰일 때만) 물러난다(다음 주기가 새로 판정).
  //   선점 뒤에는 다시 승인이 못 끼어든다(승인은 남은 접점이 전부 planned일 때만 · producing이 있으면 거절).
  let sameSlot = owned!.scheduledOn === tp.scheduledOn && classifyExecutionWindow(owned!.scheduledOn, today) === 'due';
  if (sameSlot && (owned!.channel === 'sms' || owned!.channel === 'dm')) {
    const post = (await decidePair(owned!, token)).decision;
    sameSlot = post.action === 'send' && (post.attach?.id ?? null) === (link.dm?.id ?? null);
  }
  if (!sameSlot) {
    await setTouchpointStates(
      tp.companyId,
      [owned!, ...(ownedDm ? [ownedDm] : [])].map((r) => ({ id: r.id, status: 'ready', lockReason: null, execMetaPatch: {} })),
      ['producing'], token,
    ).catch((e: any) => console.warn(`[planner-executor] 선점 놓기 실패 tp=${tp.id}(회수 워커가 정리):`, e?.message || e));
    return 'not_due';
  }
  tp = owned!;
  if (link.dm) {
    link.dm = ownedDm;
    link.url = String(ownedDm?.execMeta?.dm_url || tp.execMeta?.dm_url || '');
  } else if (tp.channel === 'dm') {
    link.url = String(tp.execMeta?.dm_url || '');
  }
  const claim: ClaimCtx = {
    token,
    hashes: new Map([tp, ...(link.dm ? [link.dm] : [])].map((r) => [r.id, String(r.execMeta?.approved?.hash || '')])),
  };

  try {
    if (tp.channel === 'email') return await executeEmail(tp, claim);
    return await executeMessaging(tp, link, today, claim);
  } catch (err: any) {
    console.error(`[planner-executor] 실행 오류 tp=${tp.id}:`, err?.message || err);
    // ⛔ 발송 시도 표식이 있으면 원위치로 돌리지 않는다 — 보냈는지 모르는 상태를 다시 발송 후보로 만들면 같은 문자가 두 번 나간다.
    const after = await loadTouchpointById(tp.companyId, tp.id).catch(() => null);
    const errPatch = { last_error: String(err?.message || err).slice(0, 200), last_error_at: new Date().toISOString() };
    if (after?.execMeta?.send_started_at && !after?.execRef) {
      const ok = await setTouchpointState({
        companyId: tp.companyId, touchpointId: tp.id, status: 'locked', lockReason: PLANNER_REASON.sendUnknown,
        fromStatuses: ['producing'], claimToken: token, execMetaPatch: errPatch,
      }).catch(() => false);
      if (!ok) return 'not_due'; // 주인이 아니다(회수 워커가 이미 잠갔거나 새 실행) — 통지는 그쪽이 한다
      await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 확인 필요',
        `'${tp.title}' ${tp.channelLabel} 발송 여부를 확인하지 못했습니다. 발송 결과 화면에서 확인해 주세요.`);
      return 'locked';
    }
    // 발송 전 오류 — ready로 돌려 다음 주기가 다시 본다(같은 날 안에서는 재시도가 정상 · 각인은 그대로).
    await setTouchpointState({
      companyId: tp.companyId, touchpointId: tp.id, status: 'ready', fromStatuses: ['producing'], claimToken: token, execMetaPatch: errPatch,
    }).catch(() => { /* 다음 주기 */ });
    return 'not_due';
  }
}

/**
 * [다시 시작] — 보류(크레딧) · 잠금 접점을 발송 대기(ready)로 되돌린다(쌍이면 둘 다 · 같은 날이면 실행 워커가 곧 집는다).
 * 승인 각인이 없거나 발송 여부를 모르는 행(시도 표식 · 참조 없음)은 되살리지 않는다(사람 판정 · 이중 발송 차단).
 */
export type ResumeOutcome = 'ready' | 'hold_credit' | 'unresumable';
export async function resumePlannerTouchpoint(tp: PlannerTouchpointRow): Promise<ResumeOutcome> {
  if (tp.status !== 'hold_credit' && tp.status !== 'locked') return 'unresumable';
  if (!tp.execMeta?.approved) return 'unresumable';
  // 문자·DM = 발송 여부를 모르면 되살리지 않는다(같은 문자 두 번) · 메일 = 발송 CT가 받은 사람을 건너뛰어 이어 보내기만 된다
  if (tp.execMeta?.send_started_at && !tp.execRef && tp.channel !== 'email') return 'unresumable';
  if (!LIVE_RESUME_EVENT.includes(tp.eventStatus)) return 'unresumable';
  if (classifyExecutionWindow(tp.scheduledOn, kstDateString()) === 'missed') return 'unresumable';
  if (tp.status === 'hold_credit') {
    const cost = getCreditCost(PLANNER_SEND_SOURCE);
    try {
      if (cost > 0) await checkCredit(tp.companyId, cost);
    } catch (err) {
      if (err instanceof InsufficientCreditError) return 'hold_credit';
      throw err;
    }
  }
  const siblings = (await loadEventTouchpoints(tp.companyId, tp.eventId))
    .filter((s) => s.id !== tp.id && (s.channel === 'sms' || s.channel === 'dm') && (tp.channel === 'sms' || tp.channel === 'dm')
      && carrierKey(s.scheduledOn, s.timing) === carrierKey(tp.scheduledOn, tp.timing)
      && (s.status === 'hold_credit' || s.status === 'locked') && !!s.execMeta?.approved && !(s.execMeta?.send_started_at && !s.execRef));
  const updated = await setTouchpointStates(
    tp.companyId,
    [tp, ...siblings].map((r) => ({ id: r.id, status: 'ready', lockReason: null, execMetaPatch: { resumed_at: new Date().toISOString() } })),
    ['hold_credit', 'locked'],
  );
  return updated.includes(tp.id) ? 'ready' : 'unresumable';
}
const LIVE_RESUME_EVENT = ['approved', 'scheduled', 'producing'];

// ── 워커 ─────────────────────────────────────────────────────────────
/**
 * 실행 패스 — 오늘(KST) 예정이고 승인 각인이 있는 접점을 집어 순차 실행한다.
 * ⛔ 발송 가능 시간대 밖에서는 아무것도 하지 않는다(광고 야간 제한 · 정보통신망법).
 */
let passRunning = false;

export async function runPlannerExecutionPass(): Promise<{ sent: number; skipped: number; held: number }> {
  // ⛔ 주기가 겹치지 않게 한 번에 하나만 돈다(스팸 실검사·메일 발송이 분 단위).
  if (passRunning) return { sent: 0, skipped: 0, held: 0 };
  passRunning = true;
  try {
    return await executePass();
  } finally {
    passRunning = false;
  }
}

async function executePass(): Promise<{ sent: number; skipped: number; held: number }> {
  if (!(await guardExecMetaOrSkip('planner-executor'))) return { sent: 0, skipped: 0, held: 0 };
  const now = new Date();
  if (!isSendableHourKst(now, SEND_HOURS.start, SEND_HOURS.end)) return { sent: 0, skipped: 0, held: 0 };

  const today = kstDateString(now);
  // ★ 2026-10-04 후보 전수(Codex 1R H7) — 한 페이지만 보면 미래 예정 행이 오늘 행을 가린다
  const rows = await loadAllLiveTouchpoints({ statuses: ['ready'], scheduledFrom: today, scheduledTo: today, requireApproved: true }, { label: 'planner-executor' });
  const due = rows.filter((t) => classifyExecutionWindow(t.scheduledOn, today) === 'due');
  let sent = 0, skipped = 0, held = 0;
  for (const tp of due) {
    const r = await executeTouchpoint(tp, today);
    if (r === 'sent') sent++;
    else if (r === 'skipped') skipped++;
    else if (r === 'held' || r === 'locked' || r === 'review') held++;
  }
  if (due.length > 0) console.log(`[planner-executor] 오늘 대상 ${due.length} — 발송 ${sent} · 생략 ${skipped} · 보류·재확인 ${held}`);
  return { sent, skipped, held };
}

let executorTimer: NodeJS.Timeout | null = null;
let executorBoot: NodeJS.Timeout | null = null;

/**
 * 실행 스케줄러 — 부팅 후 1분에 첫 실행, 이후 10분 주기. 선언이 아니라 **이 함수가 app 부팅에서 불리는 것**이
 * 가동의 근거다(계약 테스트가 app.ts 등재를 고정한다).
 */
export function startPlannerExecutor(): void {
  if (executorTimer || executorBoot) return;
  const INTERVAL_MS = 10 * 60 * 1000;
  const BOOT_DELAY_MS = 60 * 1000;
  const tick = () => {
    void runPlannerExecutionPass().catch((e: any) => console.error('[planner-executor] 주기 실행 실패:', e?.message || e));
  };
  executorBoot = setTimeout(() => {
    executorBoot = null;
    tick();
    executorTimer = setInterval(tick, INTERVAL_MS);
  }, BOOT_DELAY_MS);
  console.log('[planner-executor] 마케팅 플래너 실행 워커 시작 (부팅 1분 뒤 첫 실행 · 이후 10분 주기)');
}
