/**
 * planner-executor.ts — 플래너 전용 실행 워커 (★ 2026-08-13 Phase 3 · 인계 §4-①)
 *
 * **왜 전용 워커인가** — `operator_proposals.operator_id`가 NOT NULL이라(0813 실측) 플래너 발송을
 * 자동마케팅 원장에 실으려면 가짜 오퍼레이터 행이 필요하다. 그러면 매일 도는 제안 생성 워커가 그 행을 집고
 * 자동마케팅 화면·통계·만료 워커에 플래너 행이 섞인다 — 기각했다.
 * 대신 `dispatchProposalSend` 안에 쌓인 **안전장치를 전부 독립 CT로 그대로 부른다**(인계 §3 재사용 표):
 *   문안 = orchestrate · 스팸 = CT-09 autoSpamTestWithRegenerate · 대상·적재 = planner-audience(단일 문) ·
 *   커밋 = createDirectSendCampaign(차감·환불 배관·워커 트리거 포함) · 통지 = notifyOperatorAdmins.
 * 인라인 재구현 금지 — 이 파일에는 "순서"만 있다.
 *
 * ⛔ 불변
 *   - 승인된 행사의 터치포인트만, **예정일 당일에만** 실행한다(지난 날짜는 대조 워커가 사유와 함께 닫는다).
 *   - 문안은 당일 생성. 혜택은 고객사 기입 verbatim이고, 미기입 placeholder가 남으면 보내지 않는다.
 *   - 대상 0건 = 발송 생략 + 통지. 자동완화 없다.
 *   - 광고 문자는 무료거부(080)가 없으면 보내지 않는다.
 *   - 스팸 게이트를 통과하지 못한 문안은 보내지 않는다.
 *   - 크레딧 부족 = 그 터치포인트만 보류(hold_credit) + 즉시 통지 + [재개]. 마이너스·자동충전 금지.
 *   - 실행 선점은 터치포인트 행 CAS(planned/ready → producing) — 동시 주기가 두 번 보내지 않는다.
 *   - ★ 2026-09-02 **같은 날 같은 사람에게 가는 문자와 모바일 DM은 1통이다**(접수 cmtibk3d50694jnottwllnrbg — 같은 대상에 LMS 2통 사고).
 *     축 = 발송 예정일 + 대상(`carrierKey`). 문자 접점이 캐리어다: DM 형제가 발행·완성(ready)이면 **같은 잠금에서 함께 선점**해
 *     링크를 싣고, 초안 대기면 **기다린다**(링크 없는 문자를 먼저 보내면 그 DM은 영영 못 나간다 — fail-closed).
 *     DM 접점은 문자 형제가 살아 있는 한 스스로 보내지 않는다. 쌍의 상태 전이(보류·생략·잠금·발송 완료)는 **한 문장**으로 쓴다.
 *   - ★ 2026-09-02 **스팸 게이트는 링크가 붙은 최종 문안을 검사한다.** 검사한 문안과 나가는 문안이 달라선 안 된다.
 */
import { randomUUID } from 'crypto';
import { query } from '../config/database';
import { SEND_HOURS, getCompanyCosts } from '../config/defaults';
import { orchestrate } from '../services/ai-orchestrator';
import { generateMessages } from '../services/ai';
import { buildSpamRegeneratePrompt } from './continuous-operator-policy';
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { isSendableHourKst, applyBenefitToBody, hasUneditedBenefitPlaceholder } from './autosend-policy';
import { getOpt080Number } from './messageUtils';
import { checkCredit, deductCreditSafe, InsufficientCreditError } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { runInCreditBundle } from './ai-credit-context';
import { createDirectSendCampaign } from './direct-send-core';
import { DirectSendError } from './direct-send-spec';
import { sendEmailCampaign, resolveCustomerRecipients } from './email-channel';
import {
  PlannerTouchpointRow,
  claimTouchpointUnderPlanLock,
  clearExecMetaKeys,
  guardExecMetaOrSkip,
  isPlannerPlanLive,
  loadEventTouchpoints,
  loadLiveTouchpoints,
  loadTouchpointById,
  notifyPlanner,
  setEventStatus,
  setTouchpointState,
  setTouchpointStates,
  stampExecMeta,
  stampExecMetaMany,
  summarizeEventTouchpoints,
  touchClaim,
} from './planner-touchpoint';
import {
  CarrierSibling,
  PLANNER_SEND_SOURCE,
  appendDmLink,
  buildDmEditPath,
  buildPlannerCopyObjective,
  carrierKey,
  classifyExecutionWindow,
  decideMessagingDispatch,
  describeDmResidue,
  describeTiming,
  dmStageOf,
  isMaterialChannel,
  kstDateString,
  kstMonthString,
  plannerSendKey,
  resolveAudienceMode,
} from './planner-execution';
import { cleanupPlannerStaging, loadPlannerStaging, resolvePlannerAudience } from './planner-audience';
import { inspectDmForCarry, isDmCarryable, produceTouchpoint, syncDmPublishState } from './planner-production';

type ExecOutcome = 'sent' | 'skipped' | 'held' | 'locked' | 'not_due';

/** 문자에 실을 DM — 형제 접점(같은 잠금에서 함께 선점됨)이거나, DM 접점 자신(캐리어 문자를 스스로 보낼 때)이다. */
interface CarryLink {
  /** 함께 선점한 DM 형제 접점(문자 접점이 캐리어일 때). DM 접점이 스스로 보낼 때는 null. */
  dm: PlannerTouchpointRow | null;
  /** 문자 끝에 붙일 발행 주소. 없으면 ''. */
  url: string;
}

/**
 * 커밋이 **확정적으로 안 된** 실패 코드 — 발송 CT가 캠페인을 지우거나 중화한 뒤 던진다(잔액 부족) 또는 INSERT 전에 던진다.
 * 이 실패에서는 발송 시도 표식을 남길 이유가 없다 — 남기면 한 통도 안 나간 달의 대행료 환불이 "발송 시작됨"으로 막힌다.
 * 그 밖의 실패는 커밋 여부가 미확정이므로 표식을 유지한다(§3-9-1).
 */
const DEFINITE_NO_COMMIT = new Set(['INSUFFICIENT_BALANCE', 'LINK_PLACEHOLDER_UNEDITED', 'NIGHT_AD_RESTRICTED']);

const CANCELLED_REASON = '월간 대행이 취소돼 발송하지 않았습니다.';

// ── 공통 도우미 ──────────────────────────────────────────────────────
async function loadCompanyContext(companyId: string): Promise<{ companyInfo: any; customerStats: any; rejectNumber: string } | null> {
  const ctxRes = await query(
    `SELECT c.company_name, c.business_type, c.brand_name, c.brand_slogan,
            c.brand_description, c.brand_tone, c.customer_schema,
            COALESCE(c.reject_number, c.opt_out_080_number) AS reject_number,
            c.cost_per_sms, c.cost_per_lms, c.cost_per_mms, c.cost_per_kakao, c.unit_price_basis
       FROM companies c WHERE c.id = $1::uuid`,
    [companyId],
  );
  const ctx = ctxRes.rows[0];
  if (!ctx) return null;
  const statsRes = await query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE sms_opt_in = true) AS sms_opt_in_count
       FROM customers WHERE company_id = $1::uuid AND is_active = true`,
    [companyId],
  );
  return {
    companyInfo: {
      company_name: ctx.company_name,
      business_type: ctx.business_type,
      brand_name: ctx.brand_name,
      brand_slogan: ctx.brand_slogan,
      brand_description: ctx.brand_description,
      brand_tone: ctx.brand_tone,
      customer_schema: ctx.customer_schema,
      reject_number: ctx.reject_number,
      cost_per_sms: ctx.cost_per_sms,
      cost_per_lms: ctx.cost_per_lms,
      cost_per_mms: ctx.cost_per_mms,
      cost_per_kakao: ctx.cost_per_kakao,
      ...getCompanyCosts(ctx as any),
    },
    customerStats: statsRes.rows[0] || {},
    rejectNumber: String(ctx.reject_number || ''),
  };
}

async function loadDefaultCallback(companyId: string): Promise<string | null> {
  const r = await query(
    `SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers
      WHERE company_id = $1 AND is_default = true LIMIT 1`,
    [companyId],
  );
  return r.rows[0]?.phone || null;
}

/**
 * 보류·생략·잠금 헬퍼(단일 접점) — ★ 2026-09-02 `fromStatuses`를 받는다. 실행 중(선점 뒤)에는 `['producing']`으로 좁혀
 * 그 사이 취소·회수가 옮긴 상태를 조용히 덮지 않는다. 통지는 **전이가 실제로 일어났을 때만** 보낸다.
 */
async function hold(tp: PlannerTouchpointRow, reason: string, notice: string, fromStatuses?: string[]): Promise<ExecOutcome> {
  const ok = await setTouchpointState({
    companyId: tp.companyId, touchpointId: tp.id, status: 'hold_credit', lockReason: reason, fromStatuses,
    execMetaPatch: { hold_reason: 'insufficient_credit', held_at: new Date().toISOString() },
  });
  if (ok) await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 보류', notice);
  return 'held';
}

async function skip(tp: PlannerTouchpointRow, reason: string, notice: string, fromStatuses?: string[]): Promise<ExecOutcome> {
  const ok = await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'skipped', lockReason: reason, fromStatuses });
  if (ok) await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 생략', notice);
  return 'skipped';
}

async function lock(tp: PlannerTouchpointRow, reason: string, notice: string, fromStatuses?: string[]): Promise<ExecOutcome> {
  const ok = await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'locked', lockReason: reason, fromStatuses });
  if (ok) await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 보류', notice);
  return 'locked';
}

/**
 * 발송 시도 표식 — **커밋 전에** 남긴다.
 * 이 표식이 있고 실행 참조(exec_ref)가 없으면 "보냈는지 모르는 상태"다 → 대조 워커가 재발송하지 않고 사람을 부른다.
 * 표식 없이 보내면 상태 기록이 실패한 순간 그 터치포인트가 다시 발송 후보가 된다(같은 문자 두 번).
 * 동반 DM 접점에도 **같은 문장으로** 남긴다 — 두 문장이면 두 번째가 끊겼을 때 캠페인도 없이 캐리어에만 표식이 남는다.
 */
async function stampSendAttempt(tp: PlannerTouchpointRow, stagingId: string, companion?: PlannerTouchpointRow | null): Promise<void> {
  const patch = { send_started_at: new Date().toISOString(), staging_id: stagingId };
  if (companion) {
    await stampExecMetaMany(tp.companyId, [tp.id, companion.id], { ...patch, carried_by: tp.id });
    // 캐리어 행의 carried_by는 의미가 없다 — 자기 id를 지운다(동반 행에만 남는다).
    await clearExecMetaKeys(tp.companyId, tp.id, ['carried_by']).catch(() => { /* 표식뿐 */ });
    return;
  }
  await stampExecMeta(tp.companyId, tp.id, patch);
}

/**
 * 확정 실패(커밋 안 됨)의 표식 정리 — 감사 흔적은 `send_aborted_at`으로 남기고 실행 집계에서는 뺀다.
 * ⛔ 실패를 삼키지 않는다(적대 검토) — 남은 표식 하나가 재개를 막고 그 달 환불까지 막는다. 재시도하고, 그래도 안 되면 사람을 부른다.
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
 * ★ 2026-09-02 동반 DM 형제가 있으면 **두 행을 한 문장으로** sent 마감한다(재기동 시 한 행만 남는 창 제거).
 * ⛔ 발송은 이미 커밋됐다 — 이 기록이 실패하면 되돌릴 수 없으므로 **재시도하고, 그래도 실패하면 알린다**
 *   (조용히 넘기면 대조 워커가 "보냈는지 모르는" 행으로 잡아 사람을 부르게 된다).
 */
async function markSent(
  tp: PlannerTouchpointRow,
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
      // ⛔ **내가 선점한 행(producing)에만 마감을 건다.** 가드 없이 쓰면 취소·다른 경로가 옮긴 상태를 조용히 덮는다.
      const updated = await setTouchpointStates(tp.companyId, rows.filter((r) => !done.includes(r.id)), ['producing']);
      done = [...done, ...updated];
      if (updated.length === 0) break;
    } catch (e: any) {
      console.warn(`[planner-executor] 발송 마감 기록 ${attempt + 1}차 실패 tp=${tp.id}:`, e?.message || e);
    }
  }
  for (const r of rows) {
    if (done.includes(r.id)) continue;
    // 참조는 남긴다 — 그것이 "이 발송은 나갔다"는 유일한 증거다(상태는 사람이 판정한다).
    await stampExecMeta(tp.companyId, r.id, { ...r.execMetaPatch, mark_sent_conflict: true }).catch(() => { /* 통지로 대체 */ });
    await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 확인 필요',
      `'${tp.title}' ${r.id === tp.id ? tp.channelLabel : '모바일 DM'} 발송은 접수됐지만 기록이 실패했습니다. 발송 결과를 확인해 주세요.`);
  }
  if (!done.includes(tp.id)) return;
  const dist = await summarizeEventTouchpoints(tp.companyId, tp.eventId);
  const pending = Object.entries(dist)
    .filter(([s]) => !['sent', 'skipped', 'locked'].includes(s))
    .reduce((n, [, c]) => n + c, 0);
  if (pending === 0) await setEventStatus(tp.companyId, tp.eventId, 'done', ['approved', 'producing', 'scheduled']);
  else await setEventStatus(tp.companyId, tp.eventId, 'scheduled', ['approved', 'producing']);
}

// ── 당일 문안 ────────────────────────────────────────────────────────
/**
 * 문자·DM 안내 문안을 **당일** 만든다. 과금은 발송 성공 뒤 1회(멱등키 = 캐리어 터치포인트).
 * orchestrate에 cost 0을 주는 이유 = 그 함수 내부 차감은 멱등키가 없어 재시도가 두 번 과금한다.
 */
async function generateCopy(
  tp: PlannerTouchpointRow,
  ctx: { companyInfo: any; customerStats: any; rejectNumber: string },
  withDmLink: boolean,
): Promise<{ body: string; subject: string } | null> {
  const objective = buildPlannerCopyObjective(tp, tp.channelLabel, describeTiming(tp.timing), { withDmLink });
  const result = await runInCreditBundle(() =>
    orchestrate(
      {
        companyId: tp.companyId,
        userId: tp.createdBy,
        objective,
        companyInfo: ctx.companyInfo,
        customerStats: ctx.customerStats,
        forcedChannel: 'lms',
        benefitContent: tp.benefitText,
        forcedIsAd: true,
      },
      { source: PLANNER_SEND_SOURCE, cost: 0 },
    ),
  );
  const first = (result.messages || [])[0];
  if (!first) return null;
  return {
    body: applyBenefitToBody(String(first.body || ''), tp.benefitText),
    subject: applyBenefitToBody(String(first.subject || ''), tp.benefitText),
  };
}

/**
 * 스팸 게이트(CT-09) — 통과 문안만 돌려준다. 통과 못 하면 null(발송 금지).
 * ★ 2026-09-02 입력 `copy.body`는 **DM 링크까지 붙은 최종 형태**여야 한다. 재생성 콜백도 링크를 다시 붙인다 —
 *   검사한 문안과 나가는 문안이 같아야 게이트가 의미를 갖는다(URL은 통신사 필터의 주요 판정 축이다).
 *   무료거부 번호도 발송이 쓰는 값(opt080)을 그대로 준다 — 회사 축 두 컬럼이 다르면 검사본과 발송본 말미가 갈린다.
 */
async function passSpamGate(
  tp: PlannerTouchpointRow,
  copy: { body: string; subject: string },
  callback: string,
  rejectNumber: string,
  dmUrl: string,
  withDmLink: boolean,
): Promise<{ body: string; subject: string } | null> {
  const objective = buildPlannerCopyObjective(tp, tp.channelLabel, describeTiming(tp.timing), { withDmLink });
  const res = await autoSpamTestWithRegenerate({
    companyId: tp.companyId,
    userId: tp.createdBy || tp.companyId,
    callbackNumber: callback,
    messageType: 'LMS',
    subject: copy.subject || undefined,
    variants: [{ variantId: 'A', messageText: copy.body, subject: copy.subject || undefined }],
    isAd: true,
    rejectNumber: rejectNumber || undefined,
    maxRetries: 2,
    regenerateCallback: async () => {
      try {
        const regen = await runInCreditBundle(() =>
          generateMessages(
            buildSpamRegeneratePrompt(objective, ''),
            { count: 0, segmentName: tp.title, criteria: '' } as any,
            { channel: 'LMS', isAd: true, rejectNumber: rejectNumber || undefined, model: 'opus', companyId: tp.companyId },
          ),
        );
        const nv: any = (regen as any)?.variants?.[0];
        if (!nv) return null;
        const regenBody = applyBenefitToBody(String(nv.message_text || nv.lms_text || nv.sms_text || nv.body || ''), tp.benefitText);
        return {
          messageText: appendDmLink(regenBody, dmUrl),
          subject: nv.subject ? applyBenefitToBody(String(nv.subject), tp.benefitText) : undefined,
        };
      } catch {
        return null;
      }
    },
  });
  const v = res.variants[0];
  if (!v || v.spamResult !== 'pass') return null;
  return { body: v.messageText || copy.body, subject: v.subject || copy.subject };
}

// ── 문자·DM 쌍 마감 (★ 2026-09-02) ──────────────────────────────────
type PairEnd = { kind: 'held' | 'skipped' | 'locked'; reason: string; notice: string };

/**
 * 캐리어 문자가 보내지 못했을 때의 마감 — 캐리어와 동반 DM을 **한 문장**으로 옮긴다(부분 마감 창 제거 · Codex 1R).
 *   - 계획이 그 사이 취소됐으면 둘 다 취소 사유의 생략(취소는 producing을 건드리지 않으므로 여기서 닫는다).
 *   - 생략(대상 0건)이면 DM도 함께 생략(같은 대상이다).
 *   - 보류·잠금이면 DM은 ready로 되돌려 캐리어가 재개될 때 다시 실린다.
 * 통지는 캐리어 전이가 실제로 일어났을 때만(전이 0행 = 회수·취소가 먼저 옮겼다 → 손대지 않고 그쪽 통지에 맡긴다).
 */
async function endPair(tp: PlannerTouchpointRow, link: CarryLink, end: PairEnd): Promise<ExecOutcome> {
  const live = await isPlannerPlanLive(tp.companyId, tp.eventId).catch(() => true);
  const carrierStatus = !live ? 'skipped' : end.kind === 'held' ? 'hold_credit' : end.kind;
  const carrierReason = !live ? CANCELLED_REASON : end.reason;
  const carrierPatch = end.kind === 'held' ? { hold_reason: 'insufficient_credit', held_at: new Date().toISOString() } : {};
  const rows = [
    { id: tp.id, status: carrierStatus, lockReason: carrierReason, execMetaPatch: carrierPatch },
    ...(link.dm
      ? [{
        id: link.dm.id,
        status: !live ? 'skipped' : end.kind === 'skipped' ? 'skipped' : 'ready',
        lockReason: !live ? CANCELLED_REASON : end.kind === 'skipped' ? '같은 날의 문자가 생략되어 모바일 DM도 함께 생략했습니다.' : null,
        execMetaPatch: {},
      }]
      : []),
  ];
  const updated = await setTouchpointStates(tp.companyId, rows, ['producing']);
  if (updated.includes(tp.id) && live) {
    const title = end.kind === 'skipped' ? '[마케팅 플래너] 발송 생략' : '[마케팅 플래너] 발송 보류';
    await notifyPlanner(tp.companyId, tp.createdBy, title, end.notice);
  }
  return !live ? 'skipped' : end.kind;
}

/**
 * 예외(throw) 뒤 동반 DM 정리 — 표식이 남아 있으면(커밋 미확정) 잠그고, 아니면 ready로 되돌린다(취소된 달이면 생략).
 * 정상 종료 경로는 endPair가 한 문장으로 마감하므로 여기는 던져진 예외에만 쓴다.
 */
async function settleCompanionAfterError(dm: PlannerTouchpointRow, stampRemains: boolean): Promise<void> {
  try {
    if (stampRemains) {
      await setTouchpointState({
        companyId: dm.companyId, touchpointId: dm.id, status: 'locked', fromStatuses: ['producing'],
        lockReason: '발송 여부를 확인하지 못했습니다. 발송 내역 확인이 필요합니다.',
      });
      return;
    }
    const live = await isPlannerPlanLive(dm.companyId, dm.eventId);
    await setTouchpointState({
      companyId: dm.companyId, touchpointId: dm.id,
      status: live ? 'ready' : 'skipped', fromStatuses: ['producing'],
      lockReason: live ? null : CANCELLED_REASON,
    });
  } catch (e: any) {
    console.error(`[planner-executor] 동반 DM 정리 실패 tp=${dm.id}:`, e?.message || e);
  }
}

/** 당일 대기 통지 — 하루 1회(표식 `dm_wait_notified_on`). 상태를 바꾸지 않는다(stampExecMeta). */
async function notifyDmWaitOnce(dmTp: PlannerTouchpointRow, today: string, residueText?: string, force = false): Promise<void> {
  if (!force && String(dmTp.execMeta?.dm_wait_notified_on || '') === today) return;
  const dmId = String(dmTp.assetRef || dmTp.execMeta?.dm_id || '');
  const residue = residueText ?? String(dmTp.execMeta?.dm_residue || '');
  const editUrl = dmId
    ? `${String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '')}${buildDmEditPath(dmId)}`
    : '';
  const body = [
    `오늘(${today}) 나갈 '${dmTp.title}' 문자가 모바일 DM 발행을 기다리고 있습니다${residue ? ` (남은 자리: ${residue})` : ''}.`,
    `완성·발행하면 곧바로 문자 1통에 링크로 함께 나갑니다. ${SEND_HOURS.end}시까지 발행되지 않으면 오늘 발송은 건너뜁니다.`,
    editUrl,
  ].filter(Boolean).join('\n');
  const sent = await notifyPlanner(dmTp.companyId, dmTp.createdBy, '[마케팅 플래너] 오늘 발송 대기', body);
  if (sent) await stampExecMeta(dmTp.companyId, dmTp.id, { dm_wait_notified_on: today }).catch(() => { /* 다음 주기 재알림 */ });
}

/**
 * 발송 직전 DM 실물 확인 — 발행이 중지됐거나 빈 자리가 다시 생겼으면 보내지 않고 초안 대기로 되돌린다(fail-closed).
 * 두 번 부른다: 문안 생성·스팸 검사(수 분) **앞**과 캠페인 커밋 **직전**(Codex 1R — 그 사이 담당자가 고칠 수 있다).
 * 반환 = 실을 주소(확인 통과) 또는 null(되돌렸다 → 이번 주기 종료).
 */
async function verifyCarryOrRevert(tp: PlannerTouchpointRow, link: CarryLink, today: string): Promise<string | null> {
  // ⛔ 판정 축은 캐시된 주소가 아니라 **DM의 존재**다(Codex 2R) — 주소 표식이 비어 있다고 실물 확인을 건너뛰면 링크 없는 문자가 나가고 DM은 sent로 마감된다.
  const dmTp = link.dm || (tp.channel === 'dm' ? tp : null);
  if (!dmTp) return '';
  const dmId = String(dmTp.assetRef || dmTp.execMeta?.dm_id || '');
  const state = dmId ? await inspectDmForCarry(tp.companyId, dmId) : null;
  if (isDmCarryable(state) && state!.url) return state!.url;
  const residueText = state && !state.checkError ? describeDmResidue(state.residue) : '';
  const reason = !state || !state.published ? '모바일 DM 발행이 확인되지 않습니다.'
    : state.checkError ? '모바일 DM 발행 상태를 확인하지 못했습니다.'
      : `모바일 DM에 채워지지 않은 자리가 있습니다: ${residueText}`;
  const rows = [
    { id: dmTp.id, status: 'planned', lockReason: null, execMetaPatch: { dm_stage: 'drafted', dm_residue: residueText, dm_checked_at: new Date().toISOString() } },
    ...(link.dm ? [{ id: tp.id, status: 'planned', lockReason: null, execMetaPatch: { waiting_for_dm: dmTp.id, waiting_reason: reason } }] : []),
  ];
  await setTouchpointStates(tp.companyId, rows, ['producing']);
  await notifyDmWaitOnce(dmTp, today, residueText, true);
  console.log(`[planner-executor] DM 실물 확인 실패 tp=${tp.id} dm=${dmId} — ${reason}`);
  return null;
}

// ── 채널 실행 ────────────────────────────────────────────────────────
/**
 * 문자 · 모바일 DM(발행 주소를 문자에 삽입) — 같은 커밋 경로를 쓴다.
 * ★ 2026-09-02 `link` = 문자에 실을 DM(형제 접점 또는 자기 자신의 발행 주소). 형제는 이미 같은 잠금에서 선점됐다.
 */
async function executeMessaging(tp: PlannerTouchpointRow, link: CarryLink, today: string): Promise<ExecOutcome> {
  let stampRemains = false;
  try {
    return await executeMessagingCore(tp, link, today, {
      onStamp: () => { stampRemains = true; },
      onAbort: () => { stampRemains = false; },
    });
  } catch (e) {
    if (link.dm) await settleCompanionAfterError(link.dm, stampRemains);
    throw e;
  }
}

async function executeMessagingCore(
  tp: PlannerTouchpointRow,
  link: CarryLink,
  today: string,
  hooks: { onStamp: () => void; onAbort: () => void },
): Promise<ExecOutcome> {
  const end = (kind: PairEnd['kind'], reason: string, notice: string) => endPair(tp, link, { kind, reason, notice });

  const ctx = await loadCompanyContext(tp.companyId);
  if (!ctx) return end('locked', '회사 정보를 확인하지 못했습니다.', `'${tp.title}' 발송 준비 중 회사 정보를 확인하지 못해 보류했습니다.`);

  const callback = await loadDefaultCallback(tp.companyId);
  if (!callback) {
    return end('locked', '등록된 발신번호가 없습니다.', `'${tp.title}' ${tp.channelLabel} 발송에 쓸 발신번호가 없어 보류했습니다.`);
  }
  // 광고 문자는 무료거부(080)가 필수다(정보통신망법) — 없으면 보내지 않는다(자동완화 금지).
  const opt080 = await getOpt080Number(tp.createdBy || null, tp.companyId);
  if (!opt080) {
    return end('locked', '광고 무료거부 번호(080)가 없습니다.', `'${tp.title}' 발송에 필요한 무료거부 번호(080)가 없어 보류했습니다. 등록 후 [재개]를 눌러주세요.`);
  }

  // ★ 2026-09-02 DM 실물 확인 ① — 긴 단계(문안·스팸 검사) 앞에서(헛수고 방지).
  const verifiedUrl = await verifyCarryOrRevert(tp, link, today);
  if (verifiedUrl === null) return 'not_due';
  link.url = verifiedUrl;

  const cost = getCreditCost(PLANNER_SEND_SOURCE);
  try {
    if (cost > 0) await checkCredit(tp.companyId, cost);
  } catch (err) {
    if (err instanceof InsufficientCreditError) {
      return end('held', '크레딧이 부족해 발송을 보류했습니다.', `'${tp.title}' ${tp.channelLabel} 발송이 크레딧 부족으로 보류됐습니다. 충전 후 [재개]를 눌러주세요.`);
    }
    throw err;
  }

  const withDmLink = !!link.url;
  const copy = await generateCopy(tp, ctx, withDmLink);
  if (!copy || !copy.body.trim()) {
    return end('locked', '발송 문안을 만들지 못했습니다.', `'${tp.title}' ${tp.channelLabel} 문안 생성에 실패해 보류했습니다. 담당자 확인이 필요합니다.`);
  }
  // 혜택 미기입 출구 가드 — 안내 문구가 그대로 고객에게 나가는 것을 막는다(전 채널 공통 계약).
  if (hasUneditedBenefitPlaceholder(copy.body) || hasUneditedBenefitPlaceholder(copy.subject)) {
    return end('locked', '혜택이 입력되지 않았습니다.', `'${tp.title}' 행사 혜택 칸이 비어 있어 발송을 보류했습니다. 혜택을 입력한 뒤 [재개]를 눌러주세요.`);
  }

  // ★ 2026-09-02 링크는 스팸 게이트 **앞**에서 붙인다 — 검사한 문안 = 나가는 문안.
  const composed = { body: appendDmLink(copy.body, link.url), subject: copy.subject };

  // 긴 단계(문안 생성) 뒤 소유권 갱신 — 회수가 살아 있는 작업을 고아로 오인하지 않게. 동반 행도 함께.
  const claimIds = link.dm ? [tp.id, link.dm.id] : [tp.id];
  await touchClaim(tp.companyId, claimIds);
  const passed = await passSpamGate(tp, composed, callback, opt080, link.url, withDmLink);
  await touchClaim(tp.companyId, claimIds);
  if (!passed) {
    return end('locked', '문안이 스팸 검증을 통과하지 못했습니다.', `'${tp.title}' ${tp.channelLabel} 문안이 스팸 검증을 통과하지 못해 발송을 보류했습니다. 담당자 검토가 필요합니다.`);
  }
  // 재생성본이 링크를 잃었더라도 최종 형태를 보장한다(appendDmLink는 이미 있으면 두 번 붙이지 않는다).
  const finalBody = appendDmLink(passed.body, link.url);

  const mode = resolveAudienceMode(tp.channel, tp.timing);
  const audience = await resolvePlannerAudience({
    companyId: tp.companyId, createdBy: tp.createdBy, mode, plannerEventId: tp.eventId,
  });
  if (audience.blocked) {
    return end('locked', '발송 범위를 확인하지 못했습니다.', `'${tp.title}' 담당 매장 범위를 확인할 수 없어 발송을 보류했습니다. 권한 확인 후 [재개]를 눌러주세요.`);
  }

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
    return end('skipped', '발송 대상이 0명입니다.',
      `'${tp.title}' ${tp.channelLabel} 발송 대상이 0명이라 이번 발송을 생략했습니다.${mode === 'participants' ? ' (행사 참여 신청자가 아직 없습니다)' : ''}`);
  }

  // ★ 2026-09-02 DM 실물 확인 ② — 커밋 **직전**(문안·스팸 검사 동안 담당자가 중지·수정했을 수 있다). 축은 DM 존재(주소 캐시가 아니라).
  if (link.dm || tp.channel === 'dm') {
    const recheck = await verifyCarryOrRevert(tp, link, today);
    if (recheck === null || recheck !== link.url) {
      await cleanupPlannerStaging(stagingId);
      if (recheck !== null) console.warn(`[planner-executor] DM 주소가 검사 후 바뀌었다 tp=${tp.id} — 이번 주기 보내지 않는다`);
      if (recheck !== null) await setTouchpointStates(tp.companyId, [{ id: tp.id, status: 'planned', lockReason: null, execMetaPatch: {} }, ...(link.dm ? [{ id: link.dm.id, status: 'ready', lockReason: null, execMetaPatch: {} }] : [])], ['producing']);
      return 'not_due';
    }
  }

  const channelLabel = link.dm ? `${tp.channelLabel}(모바일 DM 링크 포함)` : tp.channelLabel;
  let campaignId: string;
  try {
    // 표식을 먼저 남긴다 — 아래 커밋 뒤 어떤 기록이 실패하더라도 재발송 후보가 되지 않는다.
    await stampSendAttempt(tp, stagingId, link.dm);
    hooks.onStamp();
    const res = await createDirectSendCampaign(
      {
        stagingId,
        campaignName: `마케팅 플래너 ${tp.title} ${tp.scheduledOn}`.slice(0, 200),
        msgType: 'LMS',
        message: finalBody,
        subject: passed.subject || null,
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
      if (e.code === 'INSUFFICIENT_BALANCE') {
        return end('held', '발송 잔액이 부족합니다.', `'${tp.title}' ${channelLabel} 발송 잔액이 부족해 보류했습니다. 충전 후 [재개]를 눌러주세요.`);
      }
      return end('locked', `발송 접수가 거부됐습니다: ${String(e.message || e.code).slice(0, 150)}`,
        `'${tp.title}' ${channelLabel} 발송 접수가 거부돼 보류했습니다. 사유를 확인한 뒤 [다시 시작]을 눌러주세요.`);
    }
    // ⛔ 표식을 남긴 뒤의 실패는 **다시 시도하지 않는다.** 커밋이 됐는지 확정할 수 없는 경우가 섞여 있어
    //   자동 재시도가 곧 이중 발송이 된다(발송 CT는 미확정 시 자체 경보를 남긴다). 사람이 판정한다 — 동반 행도 같은 사유로 잠근다.
    console.error(`[planner-executor] 발송 커밋 실패 tp=${tp.id}:`, e?.message || e);
    const reason = `발송 접수에 실패했습니다: ${String(e?.message || e).slice(0, 150)}`;
    const updated = await setTouchpointStates(tp.companyId, [
      { id: tp.id, status: 'locked', lockReason: reason, execMetaPatch: {} },
      ...(link.dm ? [{ id: link.dm.id, status: 'locked', lockReason: '발송 여부를 확인하지 못했습니다. 발송 내역 확인이 필요합니다.', execMetaPatch: {} }] : []),
    ], ['producing']);
    if (updated.includes(tp.id)) {
      await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 보류',
        `'${tp.title}' ${channelLabel} 발송 접수가 실패해 보류했습니다. 발송 내역을 확인한 뒤 [다시 시작]을 눌러주세요.`);
    }
    return 'locked';
  }

  // 발송이 커밋됐다 — 문안 크레딧을 멱등키로 1회 정산한다(미확정이면 보류하지 않고 로그로 남긴다:
  // 발송은 이미 나갔으므로 상태를 되돌릴 수 없고, [CREDIT][MISS]가 재차감 근거가 된다).
  // 동반 DM 접점에는 따로 걷지 않는다 — 문안은 한 번 만들어졌다(원가 축 §3-7).
  if (cost > 0) {
    const settled = await deductCreditSafe({
      companyId: tp.companyId, cost, source: PLANNER_SEND_SOURCE, createdBy: tp.createdBy, idempotencyKey: plannerSendKey(tp.id),
    });
    if (!settled) console.warn(`[planner-executor] 문안 크레딧 미확정 tp=${tp.id} — [CREDIT][MISS] 로그 확인`);
  }
  await markSent(
    tp, campaignId, total,
    { campaign_id: campaignId, ...(link.url ? { dm_url: link.url } : {}), ...(link.dm ? { dm_touchpoint_id: link.dm.id } : {}) },
    link.dm ? { row: link.dm, extra: { campaign_id: campaignId, carried_by: tp.id, dm_url: link.url, copy_charged_by: tp.id } } : null,
  );
  await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 완료',
    `'${tp.title}' ${channelLabel} ${total.toLocaleString()}명 발송을 접수했습니다.`);
  console.log(`[planner-executor] ${tp.channel} 발송 tp=${tp.id}${link.dm ? ` +dm=${link.dm.id}` : ''} campaign=${campaignId} ${total}명`);
  return 'sent';
}

/** 이메일 — 승인 후 만들어 둔 캠페인을 예정일에 보낸다. */
async function executeEmail(tp: PlannerTouchpointRow): Promise<ExecOutcome> {
  const campaignId = String(tp.assetRef || tp.execMeta?.email_campaign_id || '');
  if (!campaignId) {
    return lock(tp, '이메일 소재가 준비되지 않았습니다.', `'${tp.title}' 이메일 소재가 없어 발송을 보류했습니다.`);
  }
  // ⛔ 이메일은 참여 접수의 **입구**라 대상 축이 언제나 전체다(기입 검증이 그것을 강제한다).
  //   그래도 옛 데이터·수동 수정으로 참여자 축이 들어오면 보내지 않는다 — 결재 서류의 수와 실제 수신자가
  //   갈리는 것보다 생략이 낫다(fail-closed).
  if (resolveAudienceMode(tp.channel, tp.timing) === 'participants') {
    return skip(tp, '이메일은 행사 참여자 대상 발송을 지원하지 않습니다.',
      `'${tp.title}' 이메일은 참여자 대상으로 설정돼 발송하지 않았습니다. 참여자 안내는 문자·알림톡으로 보내주세요.`);
  }
  await touchClaim(tp.companyId, tp.id);
  const recipients = await resolveCustomerRecipients(tp.companyId);
  if (recipients.length === 0) {
    return skip(tp, '이메일 수신 가능 고객이 0명입니다.', `'${tp.title}' 이메일 수신 가능 고객이 0명이라 발송을 생략했습니다.`);
  }
  try {
    const res = await sendEmailCampaign({ campaignId, recipients, immediate: true });
    await markSent(tp, campaignId, res.sentCount, { email_campaign_id: campaignId });
    await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 발송 완료',
      `'${tp.title}' 이메일 ${res.sentCount.toLocaleString()}명 발송을 완료했습니다.`);
    // ⛔ 참여 투영은 **대조 워커 하나만** 한다(1시간 주기). 여기서도 부르면 두 경로가 겹쳐
    //   같은 회사·고객·행사 이벤트를 중복 적재할 수 있다(NOT EXISTS는 동시 실행을 막지 못한다).
    //   후속 터치포인트는 며칠 뒤라 최대 1시간 지연은 무해하다.
    return 'sent';
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/SMTP/i.test(msg)) {
      return lock(tp, '이메일 발송 설정이 완료되지 않았습니다.', `'${tp.title}' 이메일 발송 설정(회사 메일)이 완료되지 않아 보류했습니다.`);
    }
    // 발송 엔진의 미입력 자리 가드에 걸리면 재시도로는 절대 풀리지 않는다 — 잠그고 사람을 부른다.
    if (/직접 입력/.test(msg)) {
      return lock(tp, '직접 입력이 필요한 자리가 남아 있습니다.', `'${tp.title}' 이메일 소재에 직접 입력이 필요한 자리가 남아 발송을 보류했습니다. 혜택 칸을 채운 뒤 [다시 시작]을 눌러주세요.`);
    }
    throw e;
  }
}

/** 인앱 — 제작해 둔 메시지를 행사 기간 동안 켠다(게시 = 실행). */
async function executeInapp(tp: PlannerTouchpointRow): Promise<ExecOutcome> {
  const messageId = String(tp.assetRef || tp.execMeta?.inapp_message_id || '');
  if (!messageId) {
    return lock(tp, '인앱 소재가 준비되지 않았습니다.', `'${tp.title}' 인앱 메시지가 없어 게시를 보류했습니다.`);
  }
  const r = await query(
    `UPDATE cdp_inapp_messages
        SET status = 'active', start_at = NOW(), end_at = $3::timestamptz, updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid
      RETURNING id`,
    [messageId, tp.companyId, `${tp.endsOn}T23:59:59+09:00`],
  );
  if (r.rows.length === 0) {
    return lock(tp, '인앱 메시지를 게시하지 못했습니다.', `'${tp.title}' 인앱 메시지를 게시하지 못해 보류했습니다.`);
  }
  await markSent(tp, messageId, 0, { inapp_message_id: messageId, inapp_activated_at: new Date().toISOString() });
  await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 인앱 게시',
    `'${tp.title}' 인앱 메시지를 게시했습니다. 행사 종료일(${tp.endsOn})에 자동으로 내려갑니다.`);
  return 'sent';
}

/** 알림톡 — 승인(APR) 템플릿으로 참여 신청자에게 정보성 안내를 보낸다. */
async function executeAlimtalk(tp: PlannerTouchpointRow): Promise<ExecOutcome> {
  const rowId = String(tp.execMeta?.alimtalk_template_row || '');
  if (!rowId) {
    return skip(tp, '승인된 알림톡 템플릿이 없습니다.', `'${tp.title}' 알림톡 템플릿이 준비되지 않아 이번 발송을 생략했습니다.`);
  }
  const t = await query(
    `SELECT t.status, t.content, t.template_code, t.template_key, p.profile_key
       FROM kakao_templates t JOIN kakao_sender_profiles p ON p.id = t.profile_id
      WHERE t.id = $1::uuid AND t.company_id = $2::uuid`,
    [rowId, tp.companyId],
  );
  const row = t.rows[0];
  if (!row || String(row.status).toUpperCase() !== 'APPROVED') {
    return skip(tp, '알림톡 템플릿이 아직 승인되지 않았습니다.', `'${tp.title}' 알림톡 템플릿 검수가 끝나지 않아 이번 발송을 생략했습니다.`);
  }
  const callback = await loadDefaultCallback(tp.companyId);
  if (!callback) {
    return lock(tp, '등록된 발신번호가 없습니다.', `'${tp.title}' 알림톡 발송에 쓸 발신번호가 없어 보류했습니다.`);
  }
  // 알림톡 대상은 언제나 참여 신청자다(정보성 안내의 관계 근거).
  const audience = await resolvePlannerAudience({
    companyId: tp.companyId, createdBy: tp.createdBy, mode: 'participants', plannerEventId: tp.eventId,
  });
  if (audience.blocked) {
    return lock(tp, '발송 범위를 확인하지 못했습니다.', `'${tp.title}' 담당 매장 범위를 확인할 수 없어 알림톡 발송을 보류했습니다.`);
  }
  const stagingId = randomUUID();
  const total = await loadPlannerStaging({ stagingId, audience });
  if (total === 0) {
    await cleanupPlannerStaging(stagingId);
    return skip(tp, '행사 참여 신청자가 없습니다.', `'${tp.title}' 알림톡 안내 대상(참여 신청자)이 없어 발송을 생략했습니다.`);
  }
  try {
    await stampSendAttempt(tp, stagingId);
    const res = await createDirectSendCampaign(
      {
        stagingId,
        campaignName: `마케팅 플래너 알림톡 ${tp.title} ${tp.scheduledOn}`.slice(0, 200),
        // ⛔ campaigns.message_type에 KAKAO를 쓰지 않는다 — 채널 축은 send_channel이다(LESSONS 0727).
        msgType: 'LMS',
        message: String(row.content || ''),
        callback,
        sendChannel: 'alimtalk',
        adEnabled: false,
        total,
        dedupEnabled: true,
        unsubFilterEnabled: true,
        kakaoSenderKey: String(row.profile_key),
        alimtalkTemplateCode: String(row.template_code || row.template_key),
        alimtalkTemplateUuid: rowId,
      },
      { companyId: tp.companyId, userId: tp.createdBy || tp.companyId },
    );
    await markSent(tp, res.campaignId, total, { campaign_id: res.campaignId, alimtalk_sent: true });
    await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 알림톡 발송',
      `'${tp.title}' 알림톡 안내를 참여 신청자 ${total.toLocaleString()}명에게 접수했습니다.`);
    return 'sent';
  } catch (e: any) {
    await cleanupPlannerStaging(stagingId);
    if (e instanceof DirectSendError && DEFINITE_NO_COMMIT.has(String(e.code))) {
      await clearSendAttempt(tp, null, String(e.code));
      if (e.code === 'INSUFFICIENT_BALANCE') {
        return hold(tp, '발송 잔액이 부족합니다.', `'${tp.title}' 알림톡 발송 잔액이 부족해 보류했습니다. 충전 후 [재개]를 눌러주세요.`);
      }
    }
    // 표식 뒤 실패 = 자동 재시도 금지(문자 경로와 같은 계약).
    console.error(`[planner-executor] 알림톡 발송 커밋 실패 tp=${tp.id}:`, e?.message || e);
    return lock(tp, `알림톡 발송 접수에 실패했습니다: ${String(e?.message || e).slice(0, 150)}`,
      `'${tp.title}' 알림톡 발송 접수가 실패해 보류했습니다. 발송 내역을 확인한 뒤 [다시 시작]을 눌러주세요.`);
  }
}

// ── 실행 1건 ─────────────────────────────────────────────────────────
const toSibling = (s: PlannerTouchpointRow): CarrierSibling => ({
  id: s.id, channel: s.channel, status: s.status, stage: dmStageOf(s.execMeta),
});

/**
 * 터치포인트 1건 실행. 선점(CAS) → 채널 실행 → 상태 마감.
 * ⛔ 선점 실패(0행) = 다른 주기가 이미 집었다 → 손대지 않는다(이중 발송 차단).
 */
export async function executeTouchpoint(tp: PlannerTouchpointRow, today = kstDateString()): Promise<ExecOutcome> {
  if (classifyExecutionWindow(tp.scheduledOn, today) !== 'due') return 'not_due';

  // ★ 2026-09-02 문자·DM은 형제 판정이 있으므로 **최신 행**으로 다시 읽는다 — 패스가 최대 200행을 한 번에 읽어
  //   뒤쪽 행은 앞 행의 발송 시간만큼 낡은 스냅샷이다(앞 행이 함께 보낸 DM 형제를 낡은 상태로 다시 집지 않게).
  if (tp.channel === 'sms' || tp.channel === 'dm') {
    const fresh = await loadTouchpointById(tp.companyId, tp.id);
    if (!fresh || !['planned', 'ready'].includes(fresh.status)) return 'not_due';
    tp = fresh;
  }

  // ★ 2026-09-02 초안 대기 DM — 제작 경로가 아니라 **발행·완성 감지**만(잠금 없음). 발행 전이면 오늘 1회 대기 통지.
  if (tp.channel === 'dm' && tp.status === 'planned' && dmStageOf(tp.execMeta) === 'drafted') {
    const synced = await syncDmPublishState(tp);
    if (!synced.ready) {
      await notifyDmWaitOnce(tp, today);
      return 'not_due';
    }
    const refreshed = await loadTouchpointById(tp.companyId, tp.id);
    if (!refreshed) return 'not_due';
    tp = refreshed;
  }

  // 소재 채널인데 아직 제작 전이면 먼저 만든다(당일 승인 등) — 만들지 못하면 실행하지 않는다.
  if (isMaterialChannel(tp.channel) && tp.status === 'planned') {
    const produced = await produceTouchpoint(tp);
    if (produced === 'awaiting') {
      // DM 초안이 방금 생겼다 — 담당자 완성·발행을 기다린다.
      const drafted = await loadTouchpointById(tp.companyId, tp.id);
      if (drafted) await notifyDmWaitOnce(drafted, today);
      return 'not_due';
    }
    if (produced !== 'ready') return produced === 'hold_credit' ? 'held' : produced === 'locked' ? 'locked' : 'not_due';
    const refreshed = await loadTouchpointById(tp.companyId, tp.id);
    if (!refreshed) return 'not_due';
    tp = refreshed;
  }

  // ★ 2026-09-02 문자·DM 형제 판정 — 같은 행사에서 같은 날 같은 사람(carrierKey = 예정일 + 대상)에게 가는 문자와 DM은 1통이다.
  const link: CarryLink = { dm: null, url: '' };
  if (tp.channel === 'sms' || tp.channel === 'dm') {
    const key = carrierKey(tp.scheduledOn, tp.timing);
    const siblings = (await loadEventTouchpoints(tp.companyId, tp.eventId))
      .filter((s) => s.id !== tp.id && (s.channel === 'sms' || s.channel === 'dm') && carrierKey(s.scheduledOn, s.timing) === key);
    // DM 형제가 초안 대기면 발행·완성을 먼저 확인한다(마지막 감지 뒤 발행됐을 수 있다).
    for (const s of siblings) {
      if (s.channel === 'dm' && s.status === 'planned' && dmStageOf(s.execMeta) === 'drafted') {
        const r = await syncDmPublishState(s);
        if (r.ready) {
          s.status = 'ready';
          s.execMeta = { ...s.execMeta, dm_stage: 'published', dm_url: r.url };
        }
      }
    }
    const decision = decideMessagingDispatch({ channel: tp.channel, status: tp.status, stage: dmStageOf(tp.execMeta) }, siblings.map(toSibling));
    if (decision.action === 'wait') {
      const dmTp = (decision.dm.id && siblings.find((s) => s.id === decision.dm.id)) || tp;
      if (dmTp.id !== tp.id && String(tp.execMeta?.waiting_for_dm || '') !== dmTp.id) {
        // 대조 워커의 생략 사유가 "DM 미발행"을 말하게 표식을 남긴다(상태 무변경).
        await stampExecMeta(tp.companyId, tp.id, { waiting_for_dm: dmTp.id, waiting_reason: decision.reason }).catch(() => { /* 표식뿐 */ });
      }
      await notifyDmWaitOnce(dmTp, today);
      return 'not_due';
    }
    if (decision.action === 'carried') return 'not_due';
    if (decision.action === 'skip') {
      return skip(tp, decision.reason, `'${tp.title}' 모바일 DM: ${decision.reason}`, ['planned', 'ready']);
    }
    if (decision.attach) {
      const dm = siblings.find((s) => s.id === decision.attach!.id) || null;
      link.dm = dm;
      link.url = String(dm?.execMeta?.dm_url || '');
    } else if (tp.channel === 'dm') {
      link.url = String(tp.execMeta?.dm_url || '');
    }
  }

  const from = isMaterialChannel(tp.channel) || tp.channel === 'alimtalk' ? ['ready'] : ['planned', 'ready'];
  // ⛔ 선점은 그 달 승인 원장 행 잠금 안에서 한다 — 취소와 직렬화되는 유일한 축이다(조회 게이트는 장벽이 아니다).
  //   동반 DM 형제도 같은 잠금·같은 트랜잭션에서 함께(전부 아니면 전무).
  const companions = link.dm ? [{ id: link.dm.id, fromStatuses: ['ready'] }] : [];
  if (!(await claimTouchpointUnderPlanLock(tp, from, 'claimed_at', companions))) return 'not_due';

  try {
    switch (tp.channel) {
      case 'sms':
      case 'dm':
        return await executeMessaging(tp, link, today);
      case 'email':
        return await executeEmail(tp);
      case 'inapp':
        return await executeInapp(tp);
      case 'alimtalk':
        return await executeAlimtalk(tp);
      default:
        return await skip(tp, '지원하지 않는 채널입니다.', `'${tp.title}' 알 수 없는 채널이라 발송을 생략했습니다.`, ['producing']);
    }
  } catch (err: any) {
    console.error(`[planner-executor] 실행 오류 tp=${tp.id}:`, err?.message || err);
    // ⛔ 발송 시도 표식이 있으면 원위치로 돌리지 않는다 — 보냈는지 모르는 상태를 다시 발송 후보로 만들면
    //   같은 문자가 두 번 나간다. 잠그고 사람을 부른다(대조 워커도 같은 계약).
    const fresh = await loadTouchpointById(tp.companyId, tp.id).catch(() => null);
    if (fresh?.execMeta?.send_started_at && !fresh?.execRef) {
      await setTouchpointState({
        companyId: tp.companyId, touchpointId: tp.id, status: 'locked',
        lockReason: '발송 여부를 확인하지 못했습니다. 발송 내역 확인이 필요합니다.',
        execMetaPatch: { last_error: String(err?.message || err).slice(0, 200), last_error_at: new Date().toISOString() },
      }).catch(() => { /* 다음 주기 */ });
      await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 확인 필요',
        `'${tp.title}' ${tp.channelLabel} 발송 여부를 확인하지 못했습니다. 발송 내역을 확인해 주세요.`);
      return 'locked';
    }
    // 발송 전 오류 — 상태를 원위치로 돌려 다음 주기가 다시 본다(같은 날 안에서는 재시도가 정상).
    //   ★ 2026-09-02 발행 확인 전 DM은 ready가 아니라 초안 대기(planned)로 — 예외 한 번으로 발행 게이트를 지나지 않게.
    const back = tp.channel === 'dm' && dmStageOf(tp.execMeta) !== 'published'
      ? 'planned'
      : isMaterialChannel(tp.channel) || tp.channel === 'alimtalk' ? 'ready' : 'planned';
    await setTouchpointState({
      companyId: tp.companyId, touchpointId: tp.id,
      status: back,
      fromStatuses: ['producing'],
      execMetaPatch: { last_error: String(err?.message || err).slice(0, 200), last_error_at: new Date().toISOString() },
    }).catch(() => { /* 다음 주기 */ });
    return 'not_due';
  }
}

// ── 워커 ─────────────────────────────────────────────────────────────
/**
 * 실행 패스 — 오늘(KST) 예정 터치포인트를 집어 순차 실행한다.
 * ⛔ 발송 가능 시간대 밖에서는 아무것도 하지 않는다 — 광고 야간 제한(정보통신망법)에 걸리고,
 *   커밋 CT가 접수를 거부하면 그 터치포인트가 오류로 남는다. 창이 열리면 같은 날 안에 나간다.
 */
let passRunning = false;

export async function runPlannerExecutionPass(): Promise<{ sent: number; skipped: number; held: number }> {
  // ⛔ 주기가 겹치지 않게 한 번에 하나만 돈다. 스팸 실테스트·이메일 발송이 분 단위라 주기(10분)를 넘길 수 있고,
  //   겹치면 같은 회사에 AI·발송 호출이 몰린다(이중 발송 자체는 상태 CAS가 막는다).
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
  const rows = await loadLiveTouchpoints({ statuses: ['planned', 'ready'], monthFrom: kstMonthString(now), limit: 200 });
  const due = rows.filter((t) => classifyExecutionWindow(t.scheduledOn, today) === 'due');
  let sent = 0, skipped = 0, held = 0;
  for (const tp of due) {
    const r = await executeTouchpoint(tp, today);
    if (r === 'sent') sent++;
    else if (r === 'skipped') skipped++;
    else if (r === 'held') held++;
  }
  if (due.length > 0) console.log(`[planner-executor] 오늘 대상 ${due.length} — 발송 ${sent} · 생략 ${skipped} · 보류 ${held}`);
  return { sent, skipped, held };
}

let executorTimer: NodeJS.Timeout | null = null;
let executorBoot: NodeJS.Timeout | null = null;

/**
 * 실행 스케줄러 — 부팅 후 1분에 첫 실행, 이후 10분 주기. 선언이 아니라 **이 함수가 app 부팅에서 불리는 것**이
 * 가동의 근거다(계약 테스트가 app.ts 등재를 고정한다).
 * ⛔ 첫 실행이 없으면 재기동 직후 10분은 오늘 예정분이 아무것도 나가지 않는다 — 배포가 겹친 날 그 공백이 곧 미발송이다.
 *   지연 1분은 startup 안정화용이고, 창 밖(08~21시 KST 밖)이면 그 실행은 아무것도 하지 않고 돌아온다.
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
