/**
 * planner-copy.ts — 플래너 문자 문안 사전 준비 CT (★ 2026-10-04 보강 B3 · 설계서 §6-3 · Q3)
 *
 * 옛 흐름은 문자 문안을 **발송 당일** 만들고, 스팸에 걸리면 사람이 본 적 없는 재생성본을 그대로 보냈다(`planner-executor` 옛 재생성 콜백).
 * 이제 문안은 **확인 대기 전에 미리** 만들고 사전 스팸 검사를 통과한 것만 확인 화면에 싣는다 — 담당자가 본 그 문안이 나간다.
 *
 * ⛔ 불변
 *   - 사람이 보기 전(이 단계)에만 재생성을 허용한다. 승인 뒤 재생성본은 다시 확인을 받는다(실행부 · §3-4).
 *   - 혜택은 고객사 기입 verbatim — 생성 지시문은 `buildPlannerCopyObjective`(planner-execution 순수 CT) 하나.
 *   - 문안 원가는 회사가 흡수한다(크레딧 묶음 · 차감 0) — 문안비 10은 발송 커밋 뒤 실행부가 한 번(§7).
 *   - 사전 스팸은 **DM 링크 자리에 같은 단축 도메인의 가짜 코드**를 붙여 검사한다(검사한 문안과 나갈 문안의 형태가 같다).
 *     실주소 검사는 승인 직후(§6-6)·발송 직전(§6-7)에 다시 한다.
 *   - 입력 지문(`copyInputHash` = 행사명·기간·혜택·상품·DM 동반·시점·대상)이 바뀌면 문안과 스팸 결과를 무효로 하고 다시 만든다(회의론자 H6).
 *   - 이 파일은 **완성본 엔진을 부르지 않는다**(워커 = 엔진 호출 0 · §3-3).
 */
import { createHash, randomBytes } from 'crypto';
import { pool, query } from '../config/database';
import { resolveConsentScope, consentJoinSql } from './mall-consent';
import { getCompanyCosts } from '../config/defaults';
import { orchestrate } from '../services/ai-orchestrator';
import { generateMessages } from '../services/ai';
import { buildSpamRegeneratePrompt } from './continuous-operator-policy';
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { applyBenefitToBody, hasUneditedBenefitPlaceholder } from './autosend-policy';
import { getOpt080Number } from './messageUtils';
import { runInCreditBundle } from './ai-credit-context';
import { tryAcquireInflight, releaseInflight } from './inflight-lock';
import { dmShortUrlOf } from './dm/dm-publish-core';
import {
  PLANNER_SEND_SOURCE, appendDmLink, buildPlannerCopyObjective, carrierKey, describeTiming, kstDateString,
} from './planner-execution';
import { PlannerTouchpointRow, loadEventTouchpoints, setTouchpointMetaIfCopyIs, guardPlannerMetaOrSkip } from './planner-touchpoint';
import { loadPlannerEvent, staleBuildChannels, PlannerEventRow } from './planner-event';
import { PLANNER_REASON } from './planner-reasons';

// ── 회사 축(실행부와 공용 — 같은 값으로 검사하고 같은 값으로 보낸다) ─────────
export interface PlannerCompanyContext { companyInfo: any; customerStats: any; rejectNumber: string }

export async function loadPlannerCompanyContext(companyId: string): Promise<PlannerCompanyContext | null> {
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
  const statsConsent = consentJoinSql(await resolveConsentScope(companyId, null), '', 'customers.id');
  const statsRes = await query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE ${statsConsent.isTrue}) AS sms_opt_in_count
       FROM customers${statsConsent.join} WHERE company_id = $1::uuid AND is_active = true`,
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

/** 기본 발신번호(준비 판정 CT와 같은 조건 = is_default). */
export async function loadPlannerDefaultCallback(companyId: string): Promise<string | null> {
  const r = await query(
    `SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers
      WHERE company_id = $1 AND is_default = true LIMIT 1`,
    [companyId],
  );
  return r.rows[0]?.phone || null;
}

/** 사전 스팸용 가짜 링크 — 같은 단축 도메인 · 실재하지 않는 7자 코드(검사 형태 = 나갈 형태). */
export function plannerFakeDmLink(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = randomBytes(7);
  let code = '';
  for (let i = 0; i < 7; i++) code += chars[b[i] % chars.length];
  return dmShortUrlOf(code);
}

// ── 문안 지문 · 캐리어 ───────────────────────────────────────────────
/** (순수) 문안 입력 지문 — 이것이 바뀌면 이미 만든 문안은 낡았다(회의론자 H6). */
export function copyInputHash(
  ev: Pick<PlannerEventRow, 'title' | 'startsOn' | 'endsOn' | 'benefitText' | 'products'>,
  carrier: { timing: any; scheduledOn: string; withDmLink: boolean },
): string {
  const canon = {
    t: ev.title, s: ev.startsOn, e: ev.endsOn, b: ev.benefitText || '',
    p: (ev.products || []).map((x) => x?.name).filter(Boolean),
    d: carrier.scheduledOn, tm: describeTiming(carrier.timing), l: carrier.withDmLink,
    a: (carrier.timing as any)?.audience === 'participants' ? 'participants' : 'all',
  };
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex').slice(0, 32);
}

export interface PlannerCopy {
  text: string;
  subject: string;
  inputHash: string;
  /** pass = 검사 통과 · pending = 사람이 고쳐 검사 대기 · fail = 사람이 고친 문안이 검사에서 걸림(다시 고칠 때까지 그대로) */
  spam: 'pass' | 'pending' | 'fail';
  checkedAt: string | null;
  withDmLink: boolean;
  /** 담당자가 직접 고친 문안 — 문안 패스는 이 글을 다시 만들지 않는다(고객 문안을 조용히 바꾸지 않는다) */
  edited?: boolean;
  editedAt?: string;
}

/** 고친 문안이 검사에서 걸렸을 때의 사유(고객 문장) */
export const EDITED_COPY_SPAM_FAILED = '고치신 문안이 스팸 검사를 통과하지 못했습니다. 문구를 바꿔 다시 고쳐 주세요.';
/** 문자 문안 최대 길이(LMS 본문 · 광고 표기·무료거부 줄은 발송 때 붙는다) */
export const PLANNER_COPY_MAX = 1000;

/** (순수) 접점의 저장된 문안이 지금도 유효한가 — 입력 지문 일치 + 사전 스팸 통과. */
export function isCopyValid(execMeta: Record<string, any> | null | undefined, inputHash: string): boolean {
  const c = execMeta?.copy;
  return !!c && c.spam === 'pass' && c.inputHash === inputHash && typeof c.text === 'string' && c.text.trim().length > 0;
}

/**
 * (순수) 같은 날 같은 대상 묶음(carrierKey)의 캐리어 — 문자가 있으면 문자, 없으면 모바일 DM 자신(문자 1통에 링크로 나간다).
 * 메일은 캐리어가 아니다. 반환 = [캐리어 접점, 같은 묶음의 DM 접점 또는 null].
 */
export function carrierGroups<T extends { id: string; channel: string; timing: any; scheduledOn: string; status: string }>(tps: T[]): Array<{ carrier: T; dm: T | null }> {
  const groups = new Map<string, T[]>();
  for (const t of tps) {
    if (t.channel !== 'sms' && t.channel !== 'dm') continue;
    if (t.status === 'skipped') continue;
    const k = carrierKey(t.scheduledOn, t.timing);
    groups.set(k, [...(groups.get(k) || []), t]);
  }
  const out: Array<{ carrier: T; dm: T | null }> = [];
  for (const g of groups.values()) {
    const sms = g.find((t) => t.channel === 'sms');
    const dm = g.find((t) => t.channel === 'dm') || null;
    if (sms) out.push({ carrier: sms, dm });
    else if (dm) out.push({ carrier: dm, dm: null });
  }
  return out.sort((a, b) => a.carrier.scheduledOn.localeCompare(b.carrier.scheduledOn));
}

// ── 생성 · 검사 ─────────────────────────────────────────────────────
/**
 * 문안 1건 생성 — 원가는 회사 흡수(크레딧 묶음 · cost 0). 혜택 verbatim 치환은 생성 직후 같은 함수.
 * orchestrate에 cost 0을 주는 이유 = 그 함수 내부 차감은 멱등키가 없어 재시도가 두 번 과금한다.
 */
export async function generatePlannerCopyText(
  tp: Pick<PlannerTouchpointRow, 'companyId' | 'createdBy' | 'channelLabel' | 'timing' | 'title' | 'startsOn' | 'endsOn' | 'benefitText' | 'products'>,
  ctx: PlannerCompanyContext,
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
 * 스팸 검사(CT-09) — `regenerate` = 사람이 보기 전에만 true(이 파일의 사전 준비). 실행부는 false로 부른다(maxRetries 0).
 * 입력 `body`는 **링크까지 붙은 최종 형태**여야 한다. 재생성본도 같은 링크를 다시 붙인다(검사한 문안 = 나갈 문안).
 * 반환 = 통과본(링크 포함) 또는 null.
 */
export async function spamCheckPlannerCopy(input: {
  tp: Pick<PlannerTouchpointRow, 'companyId' | 'createdBy' | 'channelLabel' | 'timing' | 'title' | 'startsOn' | 'endsOn' | 'benefitText' | 'products'>;
  body: string;
  subject: string;
  callback: string;
  rejectNumber: string;
  link: string;
  withDmLink: boolean;
  regenerate: boolean;
}): Promise<{ body: string; subject: string } | null> {
  const { tp } = input;
  const objective = buildPlannerCopyObjective(tp, tp.channelLabel, describeTiming(tp.timing), { withDmLink: input.withDmLink });
  const res = await autoSpamTestWithRegenerate({
    companyId: tp.companyId,
    userId: tp.createdBy || tp.companyId,
    callbackNumber: input.callback,
    messageType: 'LMS',
    subject: input.subject || undefined,
    variants: [{ variantId: 'A', messageText: input.body, subject: input.subject || undefined }],
    isAd: true,
    rejectNumber: input.rejectNumber || undefined,
    maxRetries: input.regenerate ? 2 : 0,
    regenerateCallback: input.regenerate ? async () => {
      try {
        const regen = await runInCreditBundle(() =>
          generateMessages(
            buildSpamRegeneratePrompt(objective, ''),
            { total_count: 0 },
            { channel: 'LMS', isAd: true, rejectNumber: input.rejectNumber || undefined, model: 'opus', companyId: tp.companyId },
          ),
        );
        const nv: any = (regen as any)?.variants?.[0];
        if (!nv) return null;
        const regenBody = applyBenefitToBody(String(nv.message_text || nv.lms_text || nv.sms_text || nv.body || ''), tp.benefitText);
        return {
          messageText: appendDmLink(regenBody, input.link),
          subject: nv.subject ? applyBenefitToBody(String(nv.subject), tp.benefitText) : undefined,
        };
      } catch {
        return null;
      }
    } : undefined,
  });
  const v = res.variants[0];
  if (!v || v.spamResult !== 'pass') return null;
  return { body: v.messageText || input.body, subject: v.subject || input.subject };
}

/** (순수) 링크를 뗀 본문 — 저장은 링크 없이(실주소는 승인 때 정해진다), 발송·검사 때 붙인다. */
export function stripDmLink(body: string, link: string): string {
  const b = String(body || '');
  if (!link) return b.replace(/\s+$/, '');
  return b.split(link).join('').replace(/\s+$/, '');
}

// ── 사전 준비 패스 ───────────────────────────────────────────────────
type PrepareOutcome = 'ready' | 'waiting' | 'failed' | 'skipped';

/**
 * 행사 1건의 문안을 준비한다 — 소재(모바일 DM·메일)가 다 있고 낡지 않았을 때만.
 * 다 준비되면 행사를 확인 대기(briefed)로 올린다(리비전이 그대로일 때만 = 그 사이 고친 행사는 올리지 않는다).
 */
export async function preparePlannerEventCopy(companyId: string, eventId: string): Promise<PrepareOutcome> {
  const lockKey = `planner-copy:${eventId}`;
  if (!tryAcquireInflight(lockKey)) return 'skipped';
  try {
    const ev = await loadPlannerEvent(companyId, eventId);
    if (!ev || ev.status !== 'draft') return 'skipped';
    const revision = Number(ev.meta.revision) || 0;
    const tps = (await loadEventTouchpoints(companyId, eventId)).filter((t) => t.status === 'planned');
    if (tps.length === 0) return 'skipped';
    if (staleBuildChannels(ev, tps.map((t) => ({ ...t }))).length > 0) return 'waiting';

    const groups = carrierGroups(tps);
    let allReady = true;
    let ctx: PlannerCompanyContext | null = null;
    for (const { carrier, dm } of groups) {
      const withDmLink = !!dm || carrier.channel === 'dm';
      const inputHash = copyInputHash(ev, { timing: carrier.timing, scheduledOn: carrier.scheduledOn, withDmLink });
      if (isCopyValid(carrier.execMeta, inputHash)) continue;
      allReady = false;
      const cur = carrier.execMeta?.copy as PlannerCopy | undefined;
      if (cur?.edited && cur.inputHash === inputHash) {
        // 담당자가 고친 문안 — 다시 만들지 않고 검사만 한다(재생성 0). 걸린 문안은 사람이 다시 고칠 때까지 그대로.
        if (cur.spam !== 'pending') continue;
        const cb = await loadPlannerDefaultCallback(companyId);
        const o80 = await getOpt080Number(ev.createdBy || null, companyId);
        if (!cb || !o80) continue;
        const fake = withDmLink ? plannerFakeDmLink() : '';
        const verdict = await spamCheckPlannerCopy({
          tp: carrier, body: appendDmLink(cur.text, fake), subject: cur.subject, callback: cb, rejectNumber: o80, link: fake, withDmLink, regenerate: false,
        }).then((r) => !!r).catch((e: any) => {
          console.warn(`[planner-copy] 고친 문안 검사 오류 tp=${carrier.id}(다음 주기 재시도):`, e?.message || e);
          return null;
        });
        if (verdict === null) continue;
        const checkedAt = new Date().toISOString();
        // ⛔ 검사한 문안이 그대로일 때만 결과를 쓴다(★ Codex 1R M10) — 검사 수 분 동안 담당자가 다시 고쳤으면 옛 결과가 새 문안을 덮지 않는다
        await setTouchpointMetaIfCopyIs(companyId, carrier.id, cur, verdict
          ? { copy: { ...cur, spam: 'pass', checkedAt }, copy_error: null }
          : { copy: { ...cur, spam: 'fail', checkedAt }, copy_error: { reason: EDITED_COPY_SPAM_FAILED, at: checkedAt } });
        continue;
      }
      // 생성 시작 때의 문안(없으면 null) — 아래 쓰기는 전부 이 값이 그대로일 때만(★ Codex 1R M10)
      const before = carrier.execMeta?.copy ?? null;
      ctx = ctx || await loadPlannerCompanyContext(companyId);
      const callback = await loadPlannerDefaultCallback(companyId);
      const opt080 = await getOpt080Number(ev.createdBy || null, companyId);
      if (!ctx || !callback || !opt080) {
        await setTouchpointMetaIfCopyIs(companyId, carrier.id, before,
          { copy_error: { reason: !ctx ? PLANNER_REASON.companyInfo : PLANNER_REASON.copyFailed, at: new Date().toISOString() } }).catch(() => false);
        continue;
      }
      const draft = await generatePlannerCopyText(carrier, ctx, withDmLink).catch((e: any) => {
        console.warn(`[planner-copy] 문안 생성 실패 tp=${carrier.id}:`, e?.message || e);
        return null;
      });
      if (!draft || !draft.body.trim() || hasUneditedBenefitPlaceholder(draft.body) || hasUneditedBenefitPlaceholder(draft.subject)) {
        await setTouchpointMetaIfCopyIs(companyId, carrier.id, before,
          { copy_error: { reason: PLANNER_REASON.copyFailed, at: new Date().toISOString() } }).catch(() => false);
        continue;
      }
      const link = withDmLink ? plannerFakeDmLink() : '';
      const passed = await spamCheckPlannerCopy({
        tp: carrier, body: appendDmLink(draft.body, link), subject: draft.subject,
        callback, rejectNumber: opt080, link, withDmLink, regenerate: true,
      }).catch((e: any) => {
        console.warn(`[planner-copy] 사전 스팸 검사 실패 tp=${carrier.id}:`, e?.message || e);
        return null;
      });
      if (!passed) {
        await setTouchpointMetaIfCopyIs(companyId, carrier.id, before,
          { copy_error: { reason: PLANNER_REASON.spamFailed, at: new Date().toISOString() } }).catch(() => false);
        continue;
      }
      const copy: PlannerCopy = {
        text: stripDmLink(passed.body, link),
        subject: passed.subject || '',
        inputHash,
        spam: 'pass',
        checkedAt: new Date().toISOString(),
        withDmLink,
      };
      await setTouchpointMetaIfCopyIs(companyId, carrier.id, before, { copy, copy_error: null });
    }
    if (!allReady) {
      // 이번에 새로 만든 문안이 다 통과했는지 다시 본다(한 번 더 읽어 판정 · 상태는 원장이 진실).
      const fresh = (await loadEventTouchpoints(companyId, eventId)).filter((t) => t.status === 'planned');
      const ok = carrierGroups(fresh).every(({ carrier, dm }) => isCopyValid(carrier.execMeta, copyInputHash(ev, {
        timing: carrier.timing, scheduledOn: carrier.scheduledOn, withDmLink: !!dm || carrier.channel === 'dm',
      })));
      if (!ok) return 'failed';
    }
    const up = await query(
      `UPDATE planner_events SET status = 'briefed', updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'
          AND COALESCE((meta->>'revision')::int, 0) = $3
        RETURNING id`,
      [eventId, companyId, revision],
    );
    if (up.rows.length > 0) console.log(`[planner-copy] 확인 대기 진입 event=${eventId} (리비전 ${revision})`);
    return up.rows.length > 0 ? 'ready' : 'skipped';
  } finally {
    releaseInflight(lockKey);
  }
}

export class PlannerCopyEditError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'PlannerCopyEditError';
  }
}

/**
 * 담당자가 문자 문안을 고친다(확인 화면 [고치기] · 승인 전만 · §5-3).
 * 고친 글은 검사 대기(pending)로 두고 행사를 재료 단계로 되돌린다(리비전 + 1 · 옛 확인 링크 폐기) — 문안 패스가 검사만 하고(재생성 0)
 * 통과하면 확인 대기로 다시 올린다. 스팸 실검사는 수 분이 걸려 요청 안에서 하지 않는다(504 재클릭 차단).
 * 호출부(라우트)가 저장 뒤 kickPlannerReview로 다음 단계를 당긴다.
 */
export async function editPlannerCopy(input: {
  companyId: string;
  ownerId: string | null;
  eventId: string;
  touchpointId: string;
  text: string;
  subject?: string | null;
}): Promise<void> {
  const ev = await loadPlannerEvent(input.companyId, input.eventId, input.ownerId);
  if (!ev) throw new PlannerCopyEditError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  if (ev.status !== 'briefed' && ev.status !== 'draft') {
    throw new PlannerCopyEditError(409, 'NOT_EDITABLE', '승인한 행사의 문안은 고칠 수 없습니다. 바꾸려면 먼저 승인을 풀어 주세요.');
  }
  const text = String(input.text || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new PlannerCopyEditError(400, 'EMPTY', '문안을 입력해 주세요.');
  if (text.length > PLANNER_COPY_MAX) throw new PlannerCopyEditError(400, 'TOO_LONG', `문안은 ${PLANNER_COPY_MAX}자까지 쓸 수 있습니다.`);
  if (hasUneditedBenefitPlaceholder(text)) throw new PlannerCopyEditError(400, 'PLACEHOLDER', '채워지지 않은 자리가 남아 있습니다. 혜택 문구를 직접 써 주세요.');
  const planned = (await loadEventTouchpoints(input.companyId, ev.id)).filter((t) => t.status === 'planned');
  const g = carrierGroups(planned).find((x) => x.carrier.id === input.touchpointId);
  if (!g) throw new PlannerCopyEditError(404, 'NOT_FOUND', '고칠 문자를 찾을 수 없습니다.');
  const withDmLink = !!g.dm || g.carrier.channel === 'dm';
  const prev = g.carrier.execMeta?.copy as PlannerCopy | undefined;
  const subject = input.subject === undefined || input.subject === null ? String(prev?.subject || '') : String(input.subject).trim().slice(0, 60);
  const copy: PlannerCopy = {
    text, subject,
    inputHash: copyInputHash(ev, { timing: g.carrier.timing, scheduledOn: g.carrier.scheduledOn, withDmLink }),
    spam: 'pending', checkedAt: null, withDmLink, edited: true, editedAt: new Date().toISOString(),
  };
  // 한 트랜잭션(★ Codex 1R M10) — 행사 잠금 → 상태 재확인 → 문안 → 리비전 + 1 · 옛 확인 링크 폐기. 둘 중 하나만 남는 창이 없다.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockEv = await client.query(
      `SELECT status, COALESCE((meta->>'revision')::int, 0) AS revision FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [ev.id, input.companyId],
    );
    const st = String(lockEv.rows[0]?.status || '');
    if (st !== 'briefed' && st !== 'draft') throw new PlannerCopyEditError(409, 'NOT_EDITABLE', '승인한 행사의 문안은 고칠 수 없습니다. 바꾸려면 먼저 승인을 풀어 주세요.');
    // ★ Codex 2R M10 — 입력 지문을 계산한 그 행사(같은 리비전)일 때만 쓴다(그 사이 혜택·날짜가 바뀌었으면 고친 문안이 옛 지문으로 남아 덮인다)
    if (Number(lockEv.rows[0]?.revision) !== (Number(ev.meta.revision) || 0)) {
      throw new PlannerCopyEditError(409, 'CHANGED', '그 사이 행사 내용이 바뀌었습니다. 화면을 새로고침한 뒤 다시 고쳐 주세요.');
    }
    const up = await client.query(
      `UPDATE planner_touchpoints SET exec_meta = COALESCE(exec_meta, '{}'::jsonb) || $3::jsonb
        WHERE id = $1::uuid AND company_id = $2::uuid AND event_id = $4::uuid AND status = 'planned'
        RETURNING id`,
      [g.carrier.id, input.companyId, JSON.stringify({ copy, copy_error: null }), ev.id],
    );
    if (up.rows.length === 0) throw new PlannerCopyEditError(409, 'CHANGED', '그 사이 상태가 바뀌었습니다. 화면을 새로고침해 주세요.');
    await client.query(
      `UPDATE planner_events
          SET status = 'draft',
              meta = (COALESCE(meta, '{}'::jsonb) - 'preview') || jsonb_build_object('revision', COALESCE((meta->>'revision')::int, 0) + 1),
              updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [ev.id, input.companyId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
  console.log(`[planner-copy] 문안 직접 수정 event=${ev.id} tp=${g.carrier.id} (검사 대기)`);
}

/**
 * 준비 패스(대조 워커 · 저장·생성 직후 best-effort) — 재료 단계(draft) 행사 중 첫 발송이 오늘 이후인 것.
 * 한 주기 상한(AI 호출) — 남은 건은 다음 주기가 집는다.
 */
export async function runPlannerCopyPass(opts?: { companyId?: string; eventId?: string; limit?: number }): Promise<{ ready: number; failed: number }> {
  if (!(await guardPlannerMetaOrSkip('planner-copy'))) return { ready: 0, failed: 0 };
  const params: any[] = [kstDateString()];
  let where = `status = 'draft' AND ends_on >= $1::date`;
  if (opts?.companyId) { params.push(opts.companyId); where += ` AND company_id = $${params.length}::uuid`; }
  if (opts?.eventId) { params.push(opts.eventId); where += ` AND id = $${params.length}::uuid`; }
  params.push(Math.min(Math.max(1, opts?.limit || 20), 100));
  const r = await query(
    `SELECT id, company_id FROM planner_events WHERE ${where} ORDER BY starts_on ASC LIMIT $${params.length}`,
    params,
  );
  let ready = 0, failed = 0;
  for (const row of r.rows as any[]) {
    try {
      const out = await preparePlannerEventCopy(String(row.company_id), String(row.id));
      if (out === 'ready') ready++;
      else if (out === 'failed') failed++;
    } catch (e: any) {
      failed++;
      console.error(`[planner-copy] 행사 ${row.id} 문안 준비 오류:`, e?.message || e);
    }
  }
  if (ready + failed > 0) console.log(`[planner-copy] 문안 준비 — 확인 대기 ${ready} · 실패 ${failed}`);
  return { ready, failed };
}
