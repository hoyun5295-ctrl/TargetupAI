/**
 * campaign-split.ts — 나눠 보내기(일회성 캠페인 2단계 배분) CT (★ 2026-11-14 C133 F4)
 *   설계서 docs/2026-11-13-hanjul-v3-design.md §6 · §18 「배포 C-3 — 나눠 보내기(F4) 구현 전 흐름 표와 정한 것」
 *
 * 문안 2 ~ 3개를 대상의 일부에게 먼저 균등하게 보내고, 기다린 뒤 누른 기기 수가 뚜렷이 많은 문안을 나머지 전원에게 보낸다.
 *   발송 배관(routes/campaigns.ts · direct-send-core · direct-send-worker)은 고치지 않는다 — 직접발송 코어를 부르기만 한다.
 *
 * 길 하나 · 잠금 하나(정한 것 12): advanceSplit(id) 전체가 그 나눠 보내기의 실행 잠금 안에서 돈다.
 *   잠금을 얻은 뒤에 ① 행을 쥔다 ② sending 묶음을 대조한다 ③ 다음 할 일 ④ 상태를 적고 놓는다. 시작 요청 · 워커 · 이어 보내기가 같은 함수다.
 * 판정(문안 자격 · 인원 · 시각 · 승자) = campaign-split-rules.ts.
 */
import { randomUUID } from 'crypto';
import { pool, query } from '../config/database';
import { SEND_HOURS } from '../config/defaults';
import { UserFacingError } from './http-error';
import { withKeyedLock, uuidLockKey } from './keyed-lock';
import { LOCK_STALE_MINUTES } from './agency-send-state';
import { v3Live, v3LiveState } from './v3-stage';
import { getStoreScope } from './store-scope';
import { resolveSendConsent, resolveAdminSendConsent, buildSendConsent } from './mall-consent';
import { buildFilterQueryCompat } from './customer-filter';
import { hasCompanyLineGroup, toKoreaTimeStr } from './sms-queue';
import { checkCallbackSpec } from './callback-spec';
import { isCallbackRegistered } from './callback-filter';
import { normalizePhone, findLinkDefectInText } from './normalize';
import { validateScheduledAt } from './campaign-validation';
import { nightAdRestrictionMessage } from './autosend-policy';
import { sendWindowStateFor } from './send-time-util';
import { getOpt080Number, buildAdMessage } from './messageUtils';
import { getFatigueCap, getFatigueBlockedSet } from './fatigue-guard';
import { resolveAdGateMode, gateStaging, sendSpanOf, AdHold } from './ad-send-gate';
import { adGateNotice } from './ad-send-gate-core';
import { createDirectSendCampaign } from './direct-send-core';
import { DirectSendError } from './direct-send-spec';
import { DEFINITE_NO_COMMIT } from './planner-executor';
import { shortenUrlsStrict, shortenedLengthPreview } from './short-url';
import { resolveChargeUnitPriceDetailed } from './unit-price';
import { isFreeMessagingEligible, readFreeMessagingStatus } from './free-messaging';
import { syncCampaignResults } from './campaign-lifecycle';
import { notifyOperatorAdmins } from './continuous-operator';
import {
  type SplitMsgType, type SplitPct, type SplitWait, type SplitSizes, type SplitVerdict, type SplitIssue,
  isSplitMsgType, isSplitPct, isSplitWait, splitVariantsIssue, splitBytesIssue, splitSizes, splitDecideAt, judgeSplit, splitVariantLabel,
  rememberClosedStart,
} from './campaign-split-rules';

export const SPLIT_NOTICE_HEADER = '[한줄로 나눠 보내기 안내문자]';
/** 캠페인 이름 길이(직접발송 코어에 넘기는 이름 = 이 이름 + 묶음 꼬리) */
const SPLIT_NAME_MAX = 150;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type SplitStatus = 'testing' | 'deciding' | 'done' | 'blocked' | 'cancelled';
export type SplitGroupState = 'pending' | 'sending' | 'sent' | 'failed' | 'empty';
/**
 * grp 0 = 나머지 · 1 ~ k = 문안 시험 묶음
 *   goesAt = 이 묶음이 나가는 시각(지금 · 시험 묶음은 예약 시각이 아직 앞이면 그 시각) — 접수 전에 sending 표식과 한 문장으로 적힌다.
 *     판정 시각은 이 값에서 센다(runSplit) = 어느 실행이든 저장된 값으로 같은 답을 낸다.
 */
export interface SplitGroup { grp: number; state: SplitGroupState; stagingId: string | null; campaignId: string | null; total: number | null; goesAt: string | null }
export interface SplitVariant { text: string; subject: string | null; tracked: string; hashes: string[] }
export interface SplitSpec {
  name: string; msgType: SplitMsgType; callback: string; isAd: boolean; scheduledAt: string | null; userType: string;
  total: number; perVariant: number; rest: number;
}
export interface SplitCtx { companyId: string; userId: string; userType: string }
export interface SplitStartInput {
  id: string; name: string; msgType: string; callback: string; isAd: boolean; scheduledAt?: string | null;
  targetFilter: unknown; variants: Array<{ text: string; subject?: string | null }>; pct: number; wait: string;
}

const reject = (code: string, message: string, status = 400): UserFacingError => new UserFacingError(status, code, message);
const issueError = (i: SplitIssue, extra?: Record<string, unknown>): UserFacingError => new UserFacingError(400, `SPLIT_${i.code}`, i.message, extra || null);

// ─────────────────────────────────────────────────────────────────────────────
// 대상 — AI 한줄로 발송 길(routes/campaigns.ts POST /:id/send)과 같은 함수 · 같은 순서(계약 시험 c133-split 이 두 곳을 묶는다)
// ─────────────────────────────────────────────────────────────────────────────

interface SplitScope { storeFilter: string; storeParams: any[] }

/**
 * 보내는 사용자의 범위 + 「이 발송의 동의가 몰 소속 행으로 판정되는가」.
 *   몰별 수신동의로 판정되는 발송은 나눠 보내기를 쓰지 않는다(정한 것 11) — 그 회사는 대상 조건의 브랜드 줄에 동의가 묶여,
 *   대상 조건을 다시 보지 않는 재확인으로는 그 몰의 동의 철회를 잡지 못한다.
 */
export async function resolveSplitScope(ctx: SplitCtx): Promise<SplitScope> {
  let storeFilter = '';
  const storeParams: any[] = [];
  if (ctx.userType === 'company_user' && ctx.userId) {
    const scope = await getStoreScope(ctx.companyId, ctx.userId);
    if (scope.type === 'filtered') {
      storeFilter = ' AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = c.company_id AND store_code = ANY($STORE_IDX::text[]))';
      storeParams.push(scope.storeCodes);
    } else if (scope.type === 'blocked') {
      throw reject('SPLIT_SCOPE_BLOCKED', '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.', 403);
    }
  }
  const sendEnforce = storeParams.length > 0 && (await resolveSendConsent(ctx.companyId, storeParams[0]));
  const sendAdminConsent = storeParams.length === 0 ? await resolveAdminSendConsent(ctx.companyId) : null;
  if (sendEnforce || sendAdminConsent !== null) {
    throw reject('SPLIT_MALL_CONSENT', '몰별 수신동의를 쓰는 회사에서는 나눠 보내기를 쓸 수 없어요.');
  }
  return { storeFilter, storeParams };
}

/**
 * 받을 자격의 WHERE(별칭 c · $1 = 회사) — 활성 + 고객 행의 동의 + (대상 조건) + 범위 + 수신거부(보내는 사용자 기준).
 *   filter = 대상 조건 조각(받는 사람을 고정할 때) · 없으면 자격만(묶음을 보내는 순간의 재확인 = 빠지기만 한다).
 */
export function splitAudienceWhere(ctx: SplitCtx, scope: SplitScope, filter: { where: string; params: any[] } = { where: '', params: [] }): { where: string; params: any[] } {
  const storeParamIdx = 1 + filter.params.length + 1;
  const sendConsent = buildSendConsent({ enforce: false, alias: 'c', storeFilter: scope.storeFilter });
  const storeFilterFinal = sendConsent.storeFilter.replace('$STORE_IDX', `$${storeParamIdx}`);
  const unsubParamIdx = 1 + filter.params.length + scope.storeParams.length + 1;
  return {
    where: `c.company_id = $1 AND c.is_active = true AND ${sendConsent.customerConsent} ${filter.where}${storeFilterFinal}
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubParamIdx} AND u.phone = c.phone)`,
    params: [ctx.companyId, ...filter.params, ...scope.storeParams, ctx.userId],
  };
}

const PHONE_DIGITS_SQL = `regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g')`;
/** 번호(숫자만) 하나에 고객 하나(가장 작은 id) — 빈 번호 · 칸보다 긴 번호는 뺀다 */
const audiencePhonesSql = (where: string): string =>
  `SELECT d.phone, d.id FROM (
     SELECT DISTINCT ON (${PHONE_DIGITS_SQL}) ${PHONE_DIGITS_SQL} AS phone, c.id
       FROM customers c
      WHERE ${where}
      ORDER BY ${PHONE_DIGITS_SQL}, c.id
   ) d WHERE d.phone <> '' AND length(d.phone) <= 20`;

/**
 * 받는 사람 고정(한 문장) — 무작위 순번으로 문안 1 ~ k 시험 · 나머지(0).
 *   문안별 인원 = (전체 × 몫) ÷ (100 × 문안 수) 의 정수 나눗셈 = campaign-split-rules splitSizes 와 같은 값(실 PG 시험이 견준다).
 *   넘기는 값 = 자격 WHERE 의 값들 뒤에 [나눠 보내기 id, 몫, 문안 수].
 */
export function splitMembersSql(aud: { where: string; params: any[] }): { sql: string; idIdx: number } {
  const idIdx = aud.params.length + 1;
  const pct = `$${idIdx + 1}::int`;
  const k = `$${idIdx + 2}::int`;
  return {
    idIdx,
    sql: `INSERT INTO campaign_split_members (split_id, phone, customer_id, grp)
          SELECT $${idIdx}::uuid, t.phone, t.id,
                 CASE WHEN t.per < 1 THEN 0 WHEN t.rn > t.per * ${k} THEN 0 ELSE ((t.rn - 1) / t.per)::int + 1 END
            FROM (
              SELECT a.phone, a.id, row_number() OVER (ORDER BY random()) AS rn,
                     ((count(*) OVER ()) * ${pct}) / (100 * ${k}) AS per
                FROM (${audiencePhonesSql(aud.where)}) a
            ) t`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 시작 관문(정한 것 14) — 미리 보기와 시작이 같은 함수 · 발신 인증만 시작 요청이 따로(인증 문자가 나가므로)
// ─────────────────────────────────────────────────────────────────────────────

export interface SplitPlan {
  name: string; msgType: SplitMsgType; callback: string; isAd: boolean; scheduledAt: string | null;
  pct: SplitPct; wait: SplitWait; variants: Array<{ text: string; subject: string | null }>;
  /** 광고면 무료거부 번호(광고가 아니면 '') — 받는 글의 바이트를 재는 데 쓴다 */
  opt080: string;
  scope: SplitScope; audience: { where: string; params: any[] };
  total: number; sizes: SplitSizes; startAt: Date; decideAt: Date;
  unitPrice: number; estimate: number; prepaid: boolean; balance: number | null;
}

/** 회사가 지금 낼 예상 비용 — 선불이면 잔액과 견준다(무료 제공량은 뺀다 · 읽지 못하면 0 으로 = 막는 쪽) */
async function estimateSplitCost(companyId: string, msgType: SplitMsgType, total: number): Promise<{ unitPrice: number; estimate: number; prepaid: boolean; balance: number | null }> {
  const co = await query(
    `SELECT billing_type, balance, unit_price_basis, cost_per_sms, cost_per_lms FROM companies WHERE id = $1::uuid`, [companyId]);
  const row = co.rows[0] || {};
  const price = resolveChargeUnitPriceDetailed(row, msgType);
  if (price.unset) throw reject('SPLIT_PRICE_UNSET', `${msgType} 단가가 설정되지 않아 발송할 수 없습니다. 슈퍼관리자 단가설정에서 단가를 입력해 주세요.`);
  const prepaid = row.billing_type === 'prepaid';
  let free = 0;
  if (prepaid && isFreeMessagingEligible(msgType, 'campaign')) {
    free = await readFreeMessagingStatus(companyId)
      .then((s) => Number(s.lines.find((l) => String(l.type) === msgType)?.remaining) || 0)
      .catch(() => 0);
  }
  const estimate = Math.round(price.price * Math.max(0, total - free));
  return { unitPrice: price.price, estimate, prepaid, balance: prepaid ? Number(row.balance) || 0 : null };
}

/**
 * 시작해도 되는가 — 안 되면 던진다(UserFacingError · 화면의 잠금 이유 = 그 글자). 되면 계획(대상 수 · 인원 · 시각 · 비용).
 *   판정 순서 = 값 → 문안 → 링크 결함 → 회신번호 → 광고 080 → 시각 → 라인그룹 → 범위 · 몰 동의 → 대상 수 · 인원 → 잔액.
 */
export async function planSplit(ctx: SplitCtx, input: SplitStartInput, now: Date = new Date()): Promise<SplitPlan> {
  if (!(await v3Live('split', ctx.companyId))) throw reject('SPLIT_CLOSED', '나눠 보내기를 쓸 수 없는 회사예요.', 403);
  if (!isSplitMsgType(input.msgType)) throw reject('SPLIT_MSG_TYPE', '나눠 보내기는 문자(SMS · LMS)만 돼요.');
  if (!isSplitPct(input.pct)) throw reject('SPLIT_PCT', '먼저 보낼 몫을 골라 주세요.');
  if (!isSplitWait(input.wait)) throw reject('SPLIT_WAIT', '기다릴 시간을 골라 주세요.');
  const name = String(input.name || '').trim().slice(0, SPLIT_NAME_MAX);
  if (!name) throw reject('SPLIT_NAME', '캠페인 이름을 적어 주세요.');
  const msgType = input.msgType;
  const variants = (Array.isArray(input.variants) ? input.variants : []).map((v) => ({
    text: String(v?.text ?? ''), subject: msgType === 'LMS' ? String(v?.subject ?? '').trim() || null : null,
  }));
  const bad = splitVariantsIssue(variants, msgType);
  if (bad) throw issueError(bad.issue, { variantIndex: bad.index });
  for (let i = 0; i < variants.length; i += 1) {
    for (const t of [variants[i].text, variants[i].subject]) {
      const defect = findLinkDefectInText(t, '본문의 링크는');
      if (defect) throw new UserFacingError(400, 'LINK_DEFECT', `${splitVariantLabel(i)}: ${defect}`, { variantIndex: i });
    }
  }
  const callback = String(input.callback || '').trim();
  if (!callback) throw reject('SPLIT_CALLBACK', '회신번호를 선택해주세요');
  const spec = checkCallbackSpec(callback);
  if (!spec.ok) throw reject('INVALID_CALLBACK_FORMAT', `유효하지 않은 회신번호입니다. ${spec.message}`);
  if (!(await isCallbackRegistered(ctx.companyId, normalizePhone(callback) || ''))) {
    throw reject('INVALID_SENDER_NUMBER', '등록되지 않은 회신번호입니다. 발신번호 관리에서 번호를 등록해주세요.');
  }
  const isAd = input.isAd === true;
  const opt080 = isAd ? String((await getOpt080Number(ctx.userId, ctx.companyId)) || '') : '';
  if (isAd && !opt080) {
    throw reject('SPLIT_OPT080', '광고 발송을 위해 수신거부번호(080) 설정이 필요합니다. 설정 > 발신번호 관리에서 등록해주세요.');
  }
  // 받는 글의 바이트 — 줄인 주소와 같은 길이의 대역으로 잰다(시작 때 실제로 줄인 글로 한 번 더 잰다)
  for (let i = 0; i < variants.length; i += 1) {
    const over = splitBytesIssue(buildAdMessage(shortenedLengthPreview(variants[i].text), msgType, isAd, opt080), msgType, splitVariantLabel(i));
    if (over) throw issueError(over, { variantIndex: i });
  }
  let scheduledAt: string | null = null;
  if (input.scheduledAt) {
    const sched = validateScheduledAt(input.scheduledAt, { allowNull: false });
    if (!sched.valid) throw reject('SPLIT_SCHEDULED_AT', String(sched.error || '예약 시각을 확인해 주세요.'));
    scheduledAt = new Date(input.scheduledAt).toISOString();
  }
  const night = nightAdRestrictionMessage(isAd, !!scheduledAt, scheduledAt, SEND_HOURS.start, SEND_HOURS.end, now);
  if (night) throw reject('NIGHT_AD_RESTRICTED', night);
  if (!(await hasCompanyLineGroup(ctx.companyId))) {
    throw reject('LINE_GROUP_NOT_SET', '발송 라인그룹이 설정되지 않았습니다. 관리자에게 문의해주세요.');
  }
  const scope = await resolveSplitScope(ctx);
  const filterQuery = buildFilterQueryCompat(input.targetFilter, ctx.companyId, { storeConsent: false });
  const audience = splitAudienceWhere(ctx, scope, { where: filterQuery.where, params: filterQuery.params });
  const counted = await query(`SELECT COUNT(*)::int AS n FROM (${audiencePhonesSql(audience.where)}) a`, audience.params);
  const total = Number(counted.rows[0]?.n) || 0;
  if (total === 0) throw reject('SPLIT_NO_TARGET', '발송 대상이 없습니다.');
  const sizes = splitSizes(total, input.pct, variants.length);
  if (!sizes) throw reject('SPLIT_TOO_FEW', `대상 ${total.toLocaleString()}명으로는 문안 ${variants.length}개에 나눠 먼저 보낼 수 없어요. 먼저 보낼 몫을 키우거나 문안 수를 줄여 주세요.`);
  const cost = await estimateSplitCost(ctx.companyId, msgType, total);
  if (cost.prepaid && cost.balance !== null && cost.estimate > cost.balance) {
    throw new UserFacingError(402, 'INSUFFICIENT_BALANCE',
      `잔액이 부족해요. 전체 예상 비용 ${cost.estimate.toLocaleString()}원 · 지금 잔액 ${Math.floor(cost.balance).toLocaleString()}원`, { estimate: cost.estimate, balance: cost.balance });
  }
  const startAt = scheduledAt ? new Date(scheduledAt) : now;
  return {
    name, msgType, callback, isAd, scheduledAt, pct: input.pct, wait: input.wait, variants, opt080, scope, audience,
    total, sizes, startAt, decideAt: splitDecideAt(startAt, input.wait, isAd), ...cost,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 시작 — 요청 하나가 값 전부를 싣는다(정한 것 5 = 화면이 만든 id 가 나눠 보내기 id · 같은 id 의 두 번째 요청 = 있는 것을 돌려준다)
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeSplitId(raw: unknown): string {
  const id = String(raw ?? '').trim().toLowerCase();
  if (!UUID_RE.test(id)) throw reject('SPLIT_ID', '요청 값이 올바르지 않아요. 창을 닫았다가 다시 열어 주세요.');
  return id;
}

/**
 * 나눠 보내기를 만든다(아직 아무것도 보내지 않는다) → 만든 뒤 호출부가 advanceSplit 을 부른다.
 *   ① 문안의 모든 주소를 새로 줄인다(하나라도 못 줄이면 던진다 = 행 0 · 발송 0 · 차감 0 · 정한 것 13)
 *   ② 한 트랜잭션: 행 + 받는 사람 고정 + 인원 대조(판정 함수의 값과 다르면 되돌린다).
 *   돌려주는 값 = created(새로 만들었나). 같은 id 가 이미 있으면 만들지 않는다.
 *   같은 id 의 만들기 · 버리기는 한 줄로 선다(withSplitStartTurn) — 화면이 버린 id(discardSplitStart)는 그 뒤에 닿아도 만들지 않는다.
 */
export const createSplit = (ctx: SplitCtx, id: string, plan: SplitPlan): Promise<{ created: boolean }> =>
  withSplitStartTurn(id, () => createSplitInTurn(ctx, id, plan));

/**
 * 같은 id 의 시작(만들기) · 버리기를 서버에 닿은 순서대로 하나씩.
 *   ponytail: 프로세스 안 잠금 · 기억(발송 배관의 다른 잠금과 같은 전제 = 백엔드 프로세스 하나 · 재시작은 살아 있던 요청도 끊는다) — 프로세스를 여럿으로 늘리면 표로 옮긴다.
 */
const withSplitStartTurn = <T>(id: string, fn: () => Promise<T>): Promise<T> => withKeyedLock('campaign-split-start', uuidLockKey(id), fn);
/** 화면이 버린 시작 id → 버린 시각(한 시간 · 최대 건수 = rememberClosedStart) */
const closedStarts = new Map<string, number>();

/**
 * 화면이 보낸 시작 요청을 버린다 — 「안 만들어졌겠지」를 화면이 짐작하지 않고 서버가 정한다.
 *   이미 만들어졌으면 그 나눠 보내기를 돌려준다(= 시작된 것). 없으면 그 id 를 닫는다 = 응답이 끊겼던 요청이 뒤늦게 닿아도 만들지 않는다.
 */
export async function discardSplitStart(ctx: SplitCtx, rawId: string, at: number = Date.now()): Promise<SplitView | null> {
  const id = normalizeSplitId(rawId);
  return withSplitStartTurn(id, async () => {
    const split = await readSplit(ctx, id);
    if (split) return split;
    rememberClosedStart(closedStarts, uuidLockKey(id), at);
    return null;
  });
}

async function createSplitInTurn(ctx: SplitCtx, id: string, plan: SplitPlan): Promise<{ created: boolean }> {
  const exists = await query(`SELECT company_id FROM campaign_split_tests WHERE id = $1::uuid`, [id]);
  if (exists.rows.length > 0) {
    if (String(exists.rows[0].company_id) !== ctx.companyId) throw reject('SPLIT_ID', '요청 값이 올바르지 않아요. 창을 닫았다가 다시 열어 주세요.');
    return { created: false };
  }
  if (closedStarts.has(uuidLockKey(id))) throw reject('SPLIT_START_CLOSED', '이 시작 요청은 이미 닫혔어요. 창을 닫았다가 다시 열어 주세요.', 409);
  const variants: SplitVariant[] = [];
  for (const v of plan.variants) {
    const made = await shortenUrlsStrict(v.text, ctx.companyId).catch((e: any) => {
      console.error(`[campaign-split] 링크 줄이기 실패 split=${id}:`, e?.message || e);
      throw new UserFacingError(503, 'SPLIT_SHORTEN_FAILED', '링크를 준비하지 못해 시작하지 않았어요. 잠시 뒤 다시 눌러 주세요.');
    });
    if (made.hashes.length === 0) throw reject('SPLIT_NO_LINK', '문안에 링크가 있어야 해요. 누른 기기 수로 반응을 재요.');
    const over = splitBytesIssue(buildAdMessage(made.text, plan.msgType, plan.isAd, plan.opt080), plan.msgType, splitVariantLabel(variants.length));
    if (over) throw issueError(over, { variantIndex: variants.length });
    variants.push({ text: v.text, subject: v.subject, tracked: made.text, hashes: made.hashes });
  }
  const k = variants.length;
  const spec: SplitSpec = {
    name: plan.name, msgType: plan.msgType, callback: plan.callback, isAd: plan.isAd, scheduledAt: plan.scheduledAt, userType: ctx.userType,
    total: 0, perVariant: 0, rest: 0,
  };
  const groups: SplitGroup[] = [...Array.from({ length: k }, (_, i) => i + 1), 0].map((grp) => ({ grp, state: 'pending', stagingId: null, campaignId: null, total: null, goesAt: null }));
  const members = splitMembersSql(plan.audience);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO campaign_split_tests (id, company_id, user_id, status, test_pct, wait_code, start_at, decide_at, spec, variants, groups)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'testing', $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, ctx.companyId, ctx.userId, plan.pct, plan.wait, plan.startAt, plan.decideAt, JSON.stringify(spec), JSON.stringify(variants), JSON.stringify(groups)]);
    if ((ins.rowCount || 0) !== 1) { await client.query('ROLLBACK'); return { created: false }; }
    await client.query(members.sql, [...plan.audience.params, id, plan.pct, k]);
    const counts = await client.query(`SELECT grp, COUNT(*)::int AS n FROM campaign_split_members WHERE split_id = $1::uuid GROUP BY grp`, [id]);
    const by = new Map<number, number>(counts.rows.map((r: any) => [Number(r.grp), Number(r.n)]));
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    const sizes = splitSizes(total, plan.pct, k);
    const even = sizes !== null && (by.get(0) || 0) === sizes.rest && Array.from({ length: k }, (_, i) => by.get(i + 1) || 0).every((n) => n === sizes.perVariant);
    if (!sizes || !even) {
      await client.query('ROLLBACK');
      throw reject('SPLIT_TOO_FEW', `대상 ${total.toLocaleString()}명으로는 문안 ${k}개에 나눠 먼저 보낼 수 없어요. 먼저 보낼 몫을 키우거나 문안 수를 줄여 주세요.`);
    }
    await client.query(`UPDATE campaign_split_tests SET spec = $2::jsonb WHERE id = $1::uuid`,
      [id, JSON.stringify({ ...spec, total, perVariant: sizes.perVariant, rest: sizes.rest })]);
    await client.query('COMMIT');
    return { created: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 실행 — 길 하나 · 잠금 하나(정한 것 12)
// ─────────────────────────────────────────────────────────────────────────────

interface SplitRow {
  id: string; company_id: string; user_id: string; status: SplitStatus; test_pct: number; wait_code: SplitWait;
  start_at: Date; decide_at: Date; spec: SplitSpec; variants: SplitVariant[]; groups: SplitGroup[];
  winner_index: number | null; verdict: SplitVerdict | null; result: any; block_reason: string | null;
  claim_token: string | null; created_at: Date;
}

/** 쥔 것을 잃었다(다른 실행이 다시 쥐었다 · 그만두기) — 이 실행은 아무것도 더 쓰지 않는다 */
class SplitClaimLost extends Error {}

const groupsJson = (g: SplitGroup[]) => JSON.stringify(g);

/** 내 표식일 때만 쓴다(0행 = 쥔 것을 잃음) */
async function writeSplit(row: SplitRow, token: string, set: string, params: any[] = []): Promise<void> {
  const r = await query(
    `UPDATE campaign_split_tests SET ${set}, claimed_at = NOW(), updated_at = NOW() WHERE id = $1::uuid AND claim_token = $2::uuid`,
    [row.id, token, ...params]);
  if ((r.rowCount || 0) !== 1) throw new SplitClaimLost(`나눠 보내기 ${row.id} 를 더는 쥐고 있지 않음`);
}

const saveGroups = (row: SplitRow, token: string) => writeSplit(row, token, 'groups = $3::jsonb', [groupsJson(row.groups)]);

async function notifySplit(row: SplitRow, title: string, body: string): Promise<void> {
  await notifyOperatorAdmins(
    { adminPhoneNumbers: [], backupAdminPhone: null, companyId: row.company_id, createdBy: row.user_id }, title, body, { noticeHeader: SPLIT_NOTICE_HEADER },
  ).catch((e: any) => { console.warn('[campaign-split] 통지 실패:', e?.message || e); return false; });
}

/** 막힘 — 남은 묶음을 보내지 않는다 · 담당자에게 알린다 · 받는 사람 고정 표는 남긴다(이어 보내기가 쓴다) */
async function blockSplit(row: SplitRow, token: string, reason: string): Promise<'blocked'> {
  const r = await query(
    `UPDATE campaign_split_tests SET status = 'blocked', block_reason = $3, groups = $4::jsonb, claim_token = NULL, claimed_at = NULL, updated_at = NOW()
      WHERE id = $1::uuid AND claim_token = $2::uuid`,
    [row.id, token, reason, groupsJson(row.groups)]);
  if ((r.rowCount || 0) !== 1) throw new SplitClaimLost(`나눠 보내기 ${row.id} 를 더는 쥐고 있지 않음`);
  const sent = row.groups.filter((g) => g.grp > 0 && g.state === 'sent').length;
  const k = row.variants.length;
  await notifySplit(row, '[나눠 보내기] 확인 필요',
    `'${row.spec.name}' 나눠 보내기가 멈췄어요. ${reason} (문안 ${k}개 중 ${sent}개가 먼저 나갔어요.) 한줄로에서 [이어 보내기] 또는 [여기서 그만]을 골라 주세요.`);
  return 'blocked';
}

/** 묶음이 못 나갔다 — 막힘(사람이 이어 보내거나 그만) 또는 그만(닫힌 회사 · 알리고 끝낸다) */
async function haltSplit(row: SplitRow, token: string, out: { block: string } | { cancel: string }): Promise<'blocked' | 'cancelled'> {
  if ('block' in out) return blockSplit(row, token, out.block);
  await finishSplit(row, token, 'cancelled', out.cancel);
  await notifySplit(row, '[나눠 보내기] 중단', `'${row.spec.name}' ${out.cancel} 이미 나간 묶음은 발송결과에 그대로 있어요.`);
  return 'cancelled';
}

/** 끝난 상태(done · cancelled) — 같은 문장에서 받는 사람 고정 표를 지운다(정한 것 9) */
async function finishSplit(row: SplitRow, token: string, status: 'done' | 'cancelled', reason: string | null): Promise<void> {
  const r = await query(
    `WITH fin AS (
       UPDATE campaign_split_tests SET status = $3, block_reason = $4, groups = $5::jsonb, claim_token = NULL, claimed_at = NULL, updated_at = NOW()
        WHERE id = $1::uuid AND claim_token = $2::uuid RETURNING id
     ), gone AS (
       DELETE FROM campaign_split_members m USING fin WHERE m.split_id = fin.id
     )
     SELECT COUNT(*)::int AS n FROM fin`,
    [row.id, token, status, reason, groupsJson(row.groups)]);
  if (Number(r.rows[0]?.n) !== 1) throw new SplitClaimLost(`나눠 보내기 ${row.id} 를 더는 쥐고 있지 않음`);
}

const stagingCount = async (stagingId: string, companyId: string): Promise<number> =>
  Number((await query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE staging_id = $1::uuid AND company_id = $2::uuid`, [stagingId, companyId])).rows[0]?.n) || 0;
const dropStaging = (stagingId: string) =>
  query(`DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid`, [stagingId]).catch((e: any) => console.error(`[campaign-split] 적재 묶음 정리 실패 staging=${stagingId}:`, e?.message || e));

/**
 * sending 묶음 대조(설계서 §6-2 대조표) — 그 적재 묶음 id 의 캠페인을 발송 단계까지 본다. 다시 보내지 않는다.
 *   없음 = 발송 0 · 차감 0 → pending(적재 행은 지운다) · queued · processing · sent = 나갔거나 나가는 중 → sent ·
 *   failed = 코어가 중화(환불은 코어의 기존 길) → failed · preparing · 그 밖 = 결과 모름 → 'unknown'(막힘 · 사람이 확인).
 */
async function reconcileGroup(row: SplitRow, g: SplitGroup): Promise<'ok' | 'failed' | 'unknown'> {
  if (g.state !== 'sending') return 'ok';
  if (!g.stagingId) { g.state = 'pending'; g.goesAt = null; return 'ok'; }
  const c = await query(`SELECT id, send_phase FROM campaigns WHERE staging_id = $1::uuid AND company_id = $2::uuid ORDER BY created_at DESC`, [g.stagingId, row.company_id]);
  if (c.rows.length === 0) {
    await dropStaging(g.stagingId);
    g.state = 'pending'; g.stagingId = null; g.goesAt = null;
    return 'ok';
  }
  const live = c.rows.find((r: any) => ['queued', 'processing', 'sent'].includes(String(r.send_phase)));
  if (live) { g.state = 'sent'; g.campaignId = String(live.id); return 'ok'; }
  if (c.rows.every((r: any) => String(r.send_phase) === 'failed')) { g.state = 'failed'; return 'failed'; }
  return 'unknown';
}

/**
 * 묶음 하나 보내기 — 적재(보내는 순간의 자격 재확인) → 피로도 → 광고 관문 → 코어.
 *   돌려주는 값: sent · empty(받을 사람 0 = 발송 0 · 차감 0) · 막힘 사유 · 그만 사유(닫힌 회사) · later(요금제를 읽지 못함 = 다음에 다시).
 *   광고 관문이 쥔 예약은 코어에 넘기기 전의 모든 출구에서 놓는다(finally · 소유 CT AdHold).
 */
async function sendGroup(row: SplitRow, token: string, g: SplitGroup, message: string, subject: string | null, tail: string, at: Date): Promise<'sent' | 'empty' | { block: string } | { cancel: string } | { later: true }> {
  const ctx: SplitCtx = { companyId: row.company_id, userId: row.user_id, userType: row.spec.userType };
  const { spec } = row;
  // 묶음마다 다시 보는 관문(정한 것 14)
  // 닫힌 회사(단계 개방 · 요금제) = 남은 묶음을 보내지 않고 끝낸다 — 화면이 닫혀 [이어 보내기] · [여기서 그만]을 누를 자리가 없다.
  //   요금제를 읽지 못했으면(일시 장애일 수 있다) 닫힘으로 보지 않는다 = 아무것도 바꾸지 않고 다음 실행이 다시 본다(받는 사람 고정 표를 지우지 않는다).
  const live = await v3LiveState('split', ctx.companyId);
  if (live === 'unknown') return { later: true };
  if (live === 'closed') return { cancel: '나눠 보내기를 쓸 수 없는 상태가 되어 남은 묶음을 보내지 않았어요.' };
  if (!(await hasCompanyLineGroup(ctx.companyId))) return { block: '발송 라인그룹이 설정되지 않았습니다.' };
  if (!checkCallbackSpec(spec.callback).ok || !(await isCallbackRegistered(ctx.companyId, normalizePhone(spec.callback) || ''))) {
    return { block: '회신번호가 등록되지 않았거나 규격에 맞지 않아요.' };
  }
  if (spec.isAd && !(await getOpt080Number(ctx.userId, ctx.companyId))) return { block: '수신거부번호(080)가 없어요.' };
  let scope: SplitScope;
  try { scope = await resolveSplitScope(ctx); } catch (e: any) {
    if (e instanceof UserFacingError) return { block: e.message };
    throw e;
  }

  // 이 묶음이 나가는 시각 = 지금(at) · 시험 묶음은 예약 시각이 아직 앞이면 그 시각(코어에 넘기는 예약과 같은 값)
  const future = g.grp > 0 && spec.scheduledAt && new Date(spec.scheduledAt).getTime() > at.getTime() ? spec.scheduledAt : null;
  // 표식: 이 시도의 적재 묶음 id 와 나가는 시각을 먼저 적는다(그 뒤에 죽어도 대조가 이 id 로 캠페인을 찾고 · 판정 시각을 이 값에서 다시 센다)
  const stagingId = randomUUID();
  g.state = 'sending'; g.stagingId = stagingId; g.campaignId = null; g.total = null; g.goesAt = (future ? new Date(future) : at).toISOString();
  await saveGroups(row, token);

  const adHold = new AdHold(ctx.companyId);
  const back = async (state: SplitGroupState) => { g.state = state; g.stagingId = null; g.goesAt = null; await saveGroups(row, token); };
  try {
    // ① 적재 — 고정한 그 고객(customer_id)의 지금 자격 · 이름은 그 고객의 이름(정한 것 3)
    const aud = splitAudienceWhere(ctx, scope);
    const n = aud.params.length;
    const staged = await query(
      `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name)
       SELECT $${n + 1}::uuid, $1::uuid, m.phone, c.name
         FROM campaign_split_members m JOIN customers c ON c.id = m.customer_id
        WHERE m.split_id = $${n + 2}::uuid AND m.grp = $${n + 3}::int AND ${aud.where}`,
      [...aud.params, stagingId, row.id, g.grp]);
    let total = staged.rowCount || 0;
    // ② 피로도(광고면 늘 · 나가는 날 기준) → ③ 관문 길이면 관문을 더한다(흐름 표 5)
    let adGateMarked = false;
    let gateLine = '';
    if (spec.isAd && total > 0) {
      const day = toKoreaTimeStr(future ? new Date(future) : new Date()).slice(0, 10);
      const cap = await getFatigueCap(ctx.companyId);
      if (cap) {
        const phones = (await query(`SELECT phone FROM campaign_send_staging WHERE staging_id = $1::uuid`, [stagingId])).rows.map((r: any) => String(r.phone));
        const blocked = await getFatigueBlockedSet(ctx.companyId, cap, phones, { from: day, to: day });
        if (blocked.size > 0) {
          await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid AND phone = ANY($2::text[])`, [stagingId, [...blocked]]);
        }
      }
      const mode = await resolveAdGateMode(ctx.companyId);
      if (mode.mode === 'gate') {
        const gate = await gateStaging(mode.policy, { branch: 'ai', stagingId, unsubUserId: ctx.userId, mode: 'commit', span: sendSpanOf(future) });
        adGateMarked = gate.marked;
        adHold.take(gate.marked, stagingId);
        gateLine = adGateNotice(gate.counts);
      }
      total = await stagingCount(stagingId, ctx.companyId);
    }
    if (total === 0) {
      await dropStaging(stagingId);
      if (gateLine) console.log(`[campaign-split] 묶음 전원 제외 split=${row.id} grp=${g.grp} ${gateLine}`);
      await back('empty');
      return 'empty';
    }
    // ④ 코어 — 쥔 시각을 갱신하고(긴 단계 앞) 내 표식을 활성화 조건으로 건다
    await writeSplit(row, token, 'groups = $3::jsonb', [groupsJson(row.groups)]);
    adHold.pass();
    const res = await createDirectSendCampaign(
      {
        stagingId,
        campaignName: `${spec.name} · ${tail}`.slice(0, 200),
        msgType: spec.msgType, message, subject: subject || null, callback: spec.callback, sendChannel: 'sms',
        adEnabled: spec.isAd, total, dedupEnabled: true, unsubFilterEnabled: true,
        adGateBatchId: adGateMarked ? stagingId : null,
        sendType: 'operator',
        ...(future ? { scheduled: true, scheduledAt: future } : {}),
      },
      {
        companyId: ctx.companyId, userId: ctx.userId,
        activationGuard: { sql: 'EXISTS (SELECT 1 FROM campaign_split_tests s WHERE s.id = $2::uuid AND s.claim_token = $3::uuid FOR SHARE)', params: [row.id, token] },
      },
      { finalSource: 'selected_as_is', aiMessages: [message], authorship: 'path_ai' },
    );
    g.state = 'sent'; g.campaignId = res.campaignId; g.total = total;
    await saveGroups(row, token);
    return 'sent';
  } catch (e: any) {
    if (e instanceof SplitClaimLost) throw e;
    if (e instanceof DirectSendError && DEFINITE_NO_COMMIT.has(String(e.code))) {
      // 확실히 안 나갔다(코어가 캠페인을 만들기 전에 던졌거나 지우고 던졌다) — 묶음을 되돌리고 사유로 막는다
      await dropStaging(stagingId);
      await back('pending');
      return { block: e.code === 'INSUFFICIENT_BALANCE' ? '잔액이 부족해요. 충전한 뒤 이어 보낼 수 있어요.' : String(e.message || '발송이 접수되지 않았어요.') };
    }
    // 그 밖 = 접수됐는지 모른다 → 대조로 맞춘다(다시 보내지 않는다)
    console.error(`[campaign-split] 묶음 접수 결과 불명 split=${row.id} grp=${g.grp} staging=${stagingId}:`, e?.message || e);
    const seen = await reconcileGroup(row, g).catch(() => 'unknown' as const);
    await saveGroups(row, token);
    if (seen === 'ok' && (g.state as SplitGroupState) === 'sent') return 'sent';
    if (seen === 'unknown') return { block: '발송 접수 결과를 확인하지 못했어요. 발송결과에서 나갔는지 확인해 주세요.' };
    if ((g.state as SplitGroupState) === 'pending') { g.state = 'failed'; await saveGroups(row, token); }
    return { block: '발송이 접수되지 않았어요.' };
  } finally {
    if (adHold.holding) await adHold.settle();
  }
}

/** 판정에 쓰는 문안별 값 — 발송 성공 수(결과 동기화 뒤의 값) · 누른 기기 수(그 문안의 해시들 · ip + user_agent 한 번) */
export const SPLIT_DEVICES_SQL = `
  SELECT COUNT(DISTINCT (COALESCE(e.properties->>'ip', ''), COALESCE(e.properties->>'user_agent', '')))::int AS devices
    FROM cdp_events e
   WHERE e.company_id = $1::uuid AND e.event_name = 'message_click' AND e.occurred_at >= $2
     AND e.properties->>'short_url_hash' = ANY($3::text[])`;

async function measureSplit(row: SplitRow): Promise<{ arms: Array<{ sent: number | null; devices: number }>; cancelled: boolean }> {
  await syncCampaignResults(row.company_id).catch((e: any) => console.warn(`[campaign-split] 결과 동기화 실패(저장된 값으로 판정) split=${row.id}:`, e?.message || e));
  const tests = row.groups.filter((g) => g.grp > 0).sort((a, b) => a.grp - b.grp);
  const ids = tests.map((g) => g.campaignId).filter((x): x is string => !!x);
  const camps = ids.length > 0
    ? (await query(`SELECT id, status, success_count FROM campaigns WHERE id = ANY($1::uuid[]) AND company_id = $2::uuid`, [ids, row.company_id])).rows
    : [];
  const byId = new Map<string, any>(camps.map((c: any) => [String(c.id), c]));
  const cancelled = camps.some((c: any) => String(c.status) === 'cancelled');
  const arms: Array<{ sent: number | null; devices: number }> = [];
  for (const g of tests) {
    const c = g.campaignId ? byId.get(g.campaignId) : null;
    const sent = c && c.success_count !== null && c.success_count !== undefined ? Number(c.success_count) : null;
    const hashes = row.variants[g.grp - 1]?.hashes || [];
    const d = hashes.length > 0 ? await query(SPLIT_DEVICES_SQL, [row.company_id, row.start_at, hashes]) : { rows: [{ devices: 0 }] };
    arms.push({ sent, devices: Number(d.rows[0]?.devices) || 0 });
  }
  return { arms, cancelled };
}

export type SplitAdvance = 'held' | 'waiting' | 'blocked' | 'cancelled' | 'done' | 'postponed' | 'none';   // postponed = 지금은 못 한다(광고 발송 창 밖 · 요금제를 읽지 못함) → 다음 실행이 다시

/**
 * 다음 할 일(정한 것 12) — 실행 잠금 안에서: 쥔다 → sending 묶음 대조 → 못 나간 시험 묶음 → (판정 시각) 판정 → 나머지 → 끝.
 *   held = 다른 실행이 쥐고 있다(임대 안) · waiting = 시험 묶음이 다 나갔고 판정 시각 전 · postponed = 광고 발송 창 밖이라 판정을 다음 창으로.
 */
export async function advanceSplit(rawId: string, now: () => Date = () => new Date()): Promise<SplitAdvance> {
  const id = normalizeSplitId(rawId);
  return withKeyedLock('campaign-split', uuidLockKey(id), async () => {
    const token = randomUUID();
    const claimed = await query(
      `UPDATE campaign_split_tests SET claim_token = $2::uuid, claimed_at = NOW(), updated_at = NOW()
        WHERE id = $1::uuid AND status IN ('testing', 'deciding')
          AND (claim_token IS NULL OR claimed_at < NOW() - make_interval(mins => $3::int))
        RETURNING *`,
      [id, token, LOCK_STALE_MINUTES]);
    const row = claimed.rows[0] as SplitRow | undefined;
    if (!row) {
      const cur = await query(`SELECT status FROM campaign_split_tests WHERE id = $1::uuid`, [id]);
      const st = String(cur.rows[0]?.status || '');
      return st === 'testing' || st === 'deciding' ? 'held' : 'none';
    }
    try {
      return await runSplit(row, token, now);
    } catch (e: any) {
      if (e instanceof SplitClaimLost) { console.warn(`[campaign-split] ${e.message}`); return 'held'; }
      console.error(`[campaign-split] 실행 오류 split=${id}:`, e?.message || e);
      throw e;
    } finally {
      // 실행이 끝나면 표식을 놓는다(끝난 상태 · 막힘은 그 문장이 이미 놓았다 = 0행). 다음 실행은 sending 묶음을 대조부터 한다 = 서둘러 다시 보내지 않는다.
      //   임대는 프로세스가 죽어 이 줄에 오지 못한 표식을 회수하는 데만 쓰인다.
      await query(`UPDATE campaign_split_tests SET claim_token = NULL, claimed_at = NULL, updated_at = NOW() WHERE id = $1::uuid AND claim_token = $2::uuid`, [id, token])
        .catch((e: any) => console.error(`[campaign-split] 표식 놓기 실패 split=${id}:`, e?.message || e));
    }
  });
}

async function runSplit(row: SplitRow, token: string, now: () => Date): Promise<SplitAdvance> {
  // ② 대조 — sending 인 묶음은 다시 보내기 전에 캠페인부터 찾는다
  for (const g of row.groups) {
    const seen = await reconcileGroup(row, g);
    if (seen === 'unknown') {
      console.error(`[campaign-split][OPS] 접수 결과 불명 split=${row.id} grp=${g.grp} staging=${g.stagingId} — 캠페인 발송 단계 확인 필요`);
      return blockSplit(row, token, '발송 접수 결과를 확인하지 못했어요. 발송결과에서 나갔는지 확인해 주세요.');
    }
    if (seen === 'failed') return blockSplit(row, token, '먼저 보낼 묶음이 접수되지 않았어요.');
  }
  await saveGroups(row, token);
  const tests = row.groups.filter((g) => g.grp > 0).sort((a, b) => a.grp - b.grp);
  const rest = row.groups.find((g) => g.grp === 0)!;

  if (row.status === 'testing') {
    // ③-가 못 나간 시험 묶음을 문안 순서대로
    for (const g of tests) {
      if (g.state !== 'pending') continue;
      const v = row.variants[g.grp - 1];
      const out = await sendGroup(row, token, g, v.tracked, v.subject, `${splitVariantLabel(g.grp - 1)} 먼저`, now());
      if (typeof out === 'object') return 'later' in out ? 'postponed' : haltSplit(row, token, out);
    }
    if (tests.some((g) => g.state === 'empty')) {
      return blockSplit(row, token, '먼저 보낼 받는 사람이 모두 빠진 문안이 있어 비교할 수 없어요.');
    }
    // 판정 시각의 주인 = 이 자리 · 재료 = 저장된 값뿐: 나간 시험 묶음마다 「그 묶음이 나가는 시각(goesAt) + 기다림」 중 가장 늦은 시각보다 이르지 않게 한다.
    //   이번 실행이 접수했는지를 보지 않는다 = 판정 시각 쓰기가 실패한 뒤의 실행도 · 대조로 sent 가 된 묶음도 같은 값을 낸다(기다림 없이 판정되지 않는다).
    //   늦게 나간 문안도 기다린 뒤에 판정되고, 예약 전에 이어 보내도 나머지가 시험 묶음보다 먼저 나가지 않는다.
    const floor = Math.max(...tests.map((g) => (g.goesAt ? splitDecideAt(new Date(g.goesAt), row.wait_code, row.spec.isAd).getTime() : 0)));
    if (floor > new Date(row.decide_at).getTime()) {
      await writeSplit(row, token, 'decide_at = $3', [new Date(floor)]);
      row.decide_at = new Date(floor);
    }
    if (now().getTime() < new Date(row.decide_at).getTime()) return 'waiting';
    // ③-나 판정 — 광고는 발송 창 안에서만(창 밖이면 다음 창으로 미룬다)
    const win = sendWindowStateFor(now(), !row.spec.isAd);
    if (!win.open) {
      await writeSplit(row, token, 'decide_at = $3', [win.next]);
      return 'postponed';
    }
    const m = await measureSplit(row);
    if (m.cancelled) {
      await finishSplit(row, token, 'cancelled', '먼저 보낸 묶음이 취소돼 나머지를 보내지 않았어요.');
      return 'cancelled';
    }
    const j = judgeSplit(m.arms);
    row.winner_index = j.winnerIndex; row.verdict = j.verdict; row.result = { at: now().toISOString(), arms: m.arms, rates: j.rates };
    row.status = 'deciding';
    await writeSplit(row, token, `status = 'deciding', winner_index = $3, verdict = $4, result = $5::jsonb`, [j.winnerIndex, j.verdict, JSON.stringify(row.result)]);
  }

  // ④ 나머지 — 고른 문안(줄인 글 그대로)
  if (rest.state === 'pending') {
    const win = sendWindowStateFor(now(), !row.spec.isAd);
    if (!win.open) return 'postponed';
    const v = row.variants[row.winner_index ?? 0] || row.variants[0];
    const out = await sendGroup(row, token, rest, v.tracked, v.subject, '나머지', now());
    if (typeof out === 'object') return 'later' in out ? 'postponed' : haltSplit(row, token, out);
  }
  await finishSplit(row, token, 'done', null);
  return 'done';
}

// ─────────────────────────────────────────────────────────────────────────────
// 담당자 조작 — 여기서 그만 · 이어 보내기(같은 실행 잠금 안)
// ─────────────────────────────────────────────────────────────────────────────

const ownedWhere = (ctx: SplitCtx, at: number) => (ctx.userType === 'company_user' ? ` AND user_id = $${at}::uuid` : '');
const ownedParams = (ctx: SplitCtx) => (ctx.userType === 'company_user' ? [ctx.userId] : []);

/** 그만 — 남은 묶음을 보내지 않는다(이미 나간 묶음은 일반 캠페인 그대로). 판정이 시작된 뒤(deciding)에는 못 멈춘다 */
export async function stopSplit(ctx: SplitCtx, rawId: string): Promise<boolean> {
  const id = normalizeSplitId(rawId);
  return withKeyedLock('campaign-split', uuidLockKey(id), async () => {
    const r = await query(
      `WITH fin AS (
         UPDATE campaign_split_tests SET status = 'cancelled', block_reason = '담당자가 나머지를 보내지 않기로 했어요.', claim_token = NULL, claimed_at = NULL, updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('testing', 'blocked')
            AND (claim_token IS NULL OR claimed_at < NOW() - make_interval(mins => $3::int))${ownedWhere(ctx, 4)}
          RETURNING id
       ), gone AS (DELETE FROM campaign_split_members m USING fin WHERE m.split_id = fin.id)
       SELECT COUNT(*)::int AS n FROM fin`,
      [id, ctx.companyId, LOCK_STALE_MINUTES, ...ownedParams(ctx)]);
    return Number(r.rows[0]?.n) === 1;
  });
}

/**
 * 이어 보내기 — 막힌 것을 다시 실행할 수 있는 상태로 돌린다(접수 안 된 묶음 = 다시 보낼 것 · 결과 모름 = 대조부터).
 *   판정 시각은 여기서 정하지 않는다 — 시험 묶음을 접수하는 자리(runSplit)가 그 묶음이 나가는 시각에서 다시 센다.
 */
export async function resumeSplit(ctx: SplitCtx, rawId: string): Promise<boolean> {
  const id = normalizeSplitId(rawId);
  const turned = await withKeyedLock('campaign-split', uuidLockKey(id), async () => {
    const cur = await query(
      `SELECT * FROM campaign_split_tests WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'blocked'${ownedWhere(ctx, 3)} FOR UPDATE`,
      [id, ctx.companyId, ...ownedParams(ctx)]);
    const row = cur.rows[0] as SplitRow | undefined;
    if (!row) return false;
    const groups = row.groups.map((g) => (g.state === 'failed' || g.state === 'empty' ? { ...g, state: 'pending' as SplitGroupState, stagingId: null, goesAt: null } : g));
    const decided = row.winner_index !== null && row.winner_index !== undefined;
    await query(
      `UPDATE campaign_split_tests SET status = $2, block_reason = NULL, groups = $3::jsonb, claim_token = NULL, claimed_at = NULL, updated_at = NOW() WHERE id = $1::uuid`,
      [id, decided ? 'deciding' : 'testing', groupsJson(groups)]);
    return true;
  });
  return turned;
}

// ─────────────────────────────────────────────────────────────────────────────
// 조회 — 요약 창 · 목록(담당자 = 자기 것 · 관리자 = 회사 전체)
// ─────────────────────────────────────────────────────────────────────────────

export interface SplitView {
  id: string; status: SplitStatus; name: string; msgType: SplitMsgType; isAd: boolean; pct: number; wait: SplitWait;
  startAt: string; decideAt: string; createdAt: string; total: number; perVariant: number; rest: number;
  variants: Array<{ label: string; text: string; subject: string | null; state: SplitGroupState; campaignId: string | null; total: number | null; sent: number | null; devices: number | null; rate: number | null }>;
  restGroup: { state: SplitGroupState; campaignId: string | null; total: number | null };
  winnerIndex: number | null; verdict: SplitVerdict | null; blockReason: string | null;
}

function viewOf(row: SplitRow): SplitView {
  const byGrp = new Map<number, SplitGroup>(row.groups.map((g) => [g.grp, g]));
  const rest = byGrp.get(0);
  const arms: Array<{ sent: number | null; devices: number }> = row.result?.arms || [];
  const rates: Array<number | null> = row.result?.rates || [];
  return {
    id: row.id, status: row.status, name: row.spec.name, msgType: row.spec.msgType, isAd: row.spec.isAd, pct: row.test_pct, wait: row.wait_code,
    startAt: new Date(row.start_at).toISOString(), decideAt: new Date(row.decide_at).toISOString(), createdAt: new Date(row.created_at).toISOString(),
    total: row.spec.total, perVariant: row.spec.perVariant, rest: row.spec.rest,
    variants: row.variants.map((v, i) => {
      const g = byGrp.get(i + 1);
      return {
        label: splitVariantLabel(i), text: v.text, subject: v.subject, state: g?.state || 'pending', campaignId: g?.campaignId || null, total: g?.total ?? null,
        sent: arms[i]?.sent ?? null, devices: arms[i] ? arms[i].devices : null, rate: rates[i] ?? null,
      };
    }),
    restGroup: { state: rest?.state || 'pending', campaignId: rest?.campaignId || null, total: rest?.total ?? null },
    winnerIndex: row.winner_index, verdict: row.verdict, blockReason: row.block_reason,
  };
}

export async function readSplit(ctx: SplitCtx, rawId: string): Promise<SplitView | null> {
  const id = normalizeSplitId(rawId);
  const r = await query(`SELECT * FROM campaign_split_tests WHERE id = $1::uuid AND company_id = $2::uuid${ownedWhere(ctx, 3)}`, [id, ctx.companyId, ...ownedParams(ctx)]);
  return r.rows[0] ? viewOf(r.rows[0] as SplitRow) : null;
}

export const SPLIT_LIST_LIMIT = 20;
export async function listSplits(ctx: SplitCtx): Promise<SplitView[]> {
  const r = await query(
    `SELECT * FROM campaign_split_tests WHERE company_id = $1::uuid${ownedWhere(ctx, 2)} ORDER BY created_at DESC LIMIT ${SPLIT_LIST_LIMIT}`,
    [ctx.companyId, ...ownedParams(ctx)]);
  return r.rows.map((row: any) => viewOf(row as SplitRow));
}

/** 워커가 부를 행 — deciding · 판정 시각이 된 testing · 시험 묶음이 남은 testing(쥔 것이 살아 있으면 advanceSplit 이 건너뛴다) */
export const SPLIT_DUE_SQL = `
  SELECT id FROM campaign_split_tests
   WHERE status = 'deciding'
      OR (status = 'testing' AND (decide_at <= NOW()
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(groups) g WHERE (g->>'grp')::int > 0 AND g->>'state' IN ('pending', 'sending'))))
   ORDER BY decide_at
   LIMIT 20`;
