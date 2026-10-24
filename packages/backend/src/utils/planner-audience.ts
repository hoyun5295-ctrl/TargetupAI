/**
 * planner-audience.ts — 플래너 발송 대상 단일 문 (★ 2026-08-13 Phase 3)
 *
 * **브리핑에 보여준 수 = 실제로 나가는 수.** 그것을 구조로 보장하려고 이 파일 하나만 대상을 정한다.
 * 세는 곳(결재 서류)·뽑는 곳(당일 staging 적재)이 같은 함수를 부르므로 게이트를 빠뜨릴 자리가 없다.
 *
 * 재사용 (새로 만들지 않는다 — 인계 §3):
 *   게이트 조합 = `resolveOperatorAudienceGates`(피로도·여정 겹침) · 조건 컴파일 = `compileOperatorAudience`
 *   WHERE 조립 = `buildAudienceWhere`(operator-recipients 순수 CT) · 매장 범위 = `resolveOperatorStoreScope`
 *
 * ⛔ **매장 범위는 행사를 만든 계정 권한으로 좁힌다**(읽기는 넓게, 보내기는 좁게 — 0803 5R 교훈).
 *    그래서 결재 서류의 대상 수도 행사별로 낸다. 회사 전체 수를 보여주고 좁게 보내면 그 수는 거짓말이 된다.
 * ⛔ 판정 실패(권한 미지정·조회 오류)는 열어주지 않는다 — blocked로 돌려 실행부가 보류·사유 통지한다.
 */
import { query } from '../config/database';
import { AudienceGates, buildSendableStagingInsertSql } from './operator-recipients';
import {
  compileOperatorAudience,
  countCompiledAudience,
  resolveOperatorAudienceGates,
  resolveOperatorStoreScope,
  CompiledAudience,
} from './operator-audience';
import { buildParticipantPredicate } from './planner-participation';
import { PlannerAudienceMode } from './planner-execution';
import { readStoredAudience, type PlannerAudience } from './planner-event';
import { currentPurchaseDoor, ledgerProductKeySql, listObservedProducts, mallItemKeySql, mallItemsSql } from './journey-product';
import { REVENUE_STATUSES } from './cdp-order-revenue';
import { companyListAllows } from './sns-constants';
import { countCustomerRecipientsWhere, resolveCustomerRecipientsWhere, type EmailRecipient } from './email-channel';
import { PLANNER_REASON } from './planner-reasons';
import type { PlannerLineAskContext } from './planner-line-read';
import { getPlannerChannelAvailability } from './planner-channel-gate';
import { PLANNER_CHANNEL_LABEL } from './marketing-planner';

export interface PlannerAudienceResolution {
  /** 대상을 정할 수 없다(매장 권한 미지정 등) — 발송하지 않는다. */
  blocked: boolean;
  /** ★ 2026-10-18 막힌 까닭(사람이 읽는 문장 · PLANNER_REASON) — blocked 일 때만 */
  blockedReason?: string;
  baseParams: any[];
  storeFilter: string;
  filterWhere: string;
  filterParams: any[];
  gates: AudienceGates;
}

/**
 * 그 터치포인트의 대상 조건 확정. 참여자 축이면 cdp_events를 읽는 **동적 술어**를 얹는다
 * (참여자 명단을 어디에도 굳히지 않는다 — 진실 복사 금지).
 */
export async function resolvePlannerAudience(input: {
  companyId: string;
  /** 행사를 만든 계정 — 매장 범위의 주인. 없으면 보류(blocked). */
  createdBy: string | null;
  mode: PlannerAudienceMode;
  plannerEventId: string;
  /** ★ 2026-10-18 저장 전 미리보기(담기 창 인원) — 없으면 행사 meta 에서 읽는다(실행 · 승인 · 확인 화면 = 저장값 하나) */
  audience?: PlannerAudience;
}): Promise<PlannerAudienceResolution> {
  const scope = await resolveOperatorStoreScope(input.companyId, input.createdBy);
  const gates = await resolveOperatorAudienceGates(input.companyId, null, input.createdBy);
  if (scope.blocked) {
    return { blocked: true, blockedReason: PLANNER_REASON.scopeBlocked, baseParams: scope.baseParams, storeFilter: '', filterWhere: '', filterParams: [], gates };
  }
  const target = await plannerTargetOf(input.companyId, input.plannerEventId, input.audience);
  if (!target.ok) {
    return { blocked: true, blockedReason: target.reason, baseParams: scope.baseParams, storeFilter: '', filterWhere: '', filterParams: [], gates };
  }
  // ★ 2026-10-18 F0 — 플래너 기본 대상 = 「전체 고객」 축을 **명시**한다. 축 없이 부르면 빈 조건이라
  //   1005 「빈 조건 = 전체 금지」(AudienceEmptyError)에 걸려 확인 화면 수 · 승인 · 당일 발송이 함께 막혔다.
  const compiled: CompiledAudience = await compileOperatorAudience({
    companyId: input.companyId,
    baseParams: scope.baseParams,
    segmentKey: 'all',
  });
  let filterWhere = compiled.filterWhere;
  const filterParams = [...compiled.filterParams];
  if (input.mode === 'participants') {
    // 파라미터 번호는 baseParams + filterParams 다음 자리다 — 게이트 파라미터는 그 뒤에 push되므로
    // 술어를 filterWhere 안에 넣어야 번호가 어긋나지 않는다(buildAudienceWhere 계약).
    const scratch = [...scope.baseParams, ...filterParams];
    filterWhere = `${filterWhere} ${buildParticipantPredicate(scratch, input.plannerEventId)}`;
    filterParams.push(...scratch.slice(scope.baseParams.length + filterParams.length));
  }
  if (target.audience.kind === 'product_buyers') {
    // ★ 2026-10-18 상품 구매자 — 참여자 술어와 같은 자리 · 같은 번호 규칙(filterWhere 안 · baseParams + filterParams 다음)
    const scratch = [...scope.baseParams, ...filterParams];
    filterWhere = `${filterWhere} ${buildBuyerPredicate(scratch, target.audience)}`;
    filterParams.push(...scratch.slice(scope.baseParams.length + filterParams.length));
  }
  return {
    blocked: false,
    baseParams: scope.baseParams,
    storeFilter: scope.storeFilter,
    filterWhere,
    filterParams,
    gates,
  };
}

/** 대상 수 — 결재 서류(브리핑)와 실행이 같은 이 문으로 센다. 실패는 throw(조용한 0 금지). */
export async function countPlannerAudience(input: {
  companyId: string;
  createdBy: string | null;
  mode: PlannerAudienceMode;
  plannerEventId: string;
  audience?: PlannerAudience;
}): Promise<{ count: number; blocked: boolean; reason?: string }> {
  const a = await resolvePlannerAudience(input);
  if (a.blocked) return { count: 0, blocked: true, reason: a.blockedReason };
  const count = await countCompiledAudience({
    compiled: { filterWhere: a.filterWhere, filterParams: a.filterParams, segmentKey: null, basis: 'legacy_filters' },
    gates: a.gates,
    storeFilter: a.storeFilter,
    baseParams: a.baseParams,
  });
  return { count, blocked: false };
}

/**
 * 발송용 staging 적재 — 위 count와 **같은 WHERE·같은 게이트**를 쓴다(상한 없음).
 * 반환 = 실제 적재 건수(= 발송 대상). 0이면 호출부가 발송을 생략하고 통지한다(자동완화 금지).
 */
export async function loadPlannerStaging(input: {
  stagingId: string;
  audience: PlannerAudienceResolution;
}): Promise<number> {
  const { sql, params } = buildSendableStagingInsertSql(
    input.stagingId,
    input.audience.baseParams,
    input.audience.filterWhere,
    input.audience.filterParams,
    input.audience.storeFilter,
    input.audience.gates,
  );
  const res = await query(sql, params);
  return res.rowCount || 0;
}

/**
 * 받는 사람 수의 상태 — null 하나에 세 뜻을 담지 않는다(★ 2026-10-04 F7).
 *  known   = 실쿼리로 셌다.
 *  blocked = **영구 차단**(행사를 만든 계정의 매장 범위가 정해지지 않음) — 기다려도 풀리지 않는다. 관리자 조치가 답이다.
 *  error   = 세려 했는데 실패했다(일시) — 다시 열면 풀릴 수 있다.
 * 옛 코드는 blocked를 error로 접어 "잠시 후 다시"라고 안내했다(영구 차단을 일시 오류로 오도).
 */
export type PlannerAudienceState = 'known' | 'blocked' | 'error';

export interface PlannerAudienceCount {
  state: PlannerAudienceState;
  count: number | null;
  /** ★ 2026-10-18 blocked 까닭(사람이 읽는 문장) */
  reason?: string;
}

/** 문자 대상(전체 축) — 결재·확인 화면과 발송이 같은 문(countPlannerAudience)으로 센다. */
export async function countEventSmsAudience(input: { companyId: string; createdBy: string | null; eventId: string }): Promise<PlannerAudienceCount> {
  try {
    const r = await countPlannerAudience({ companyId: input.companyId, createdBy: input.createdBy, mode: 'all', plannerEventId: input.eventId });
    if (r.blocked) return { state: 'blocked', count: null, reason: r.reason };
    return { state: 'known', count: r.count };
  } catch (e: any) {
    console.warn('[planner-audience] 문자 대상 수 산출 실패:', e?.message || e);
    return { state: 'error', count: null };
  }
}

/** 주인 없는 staging 정리 — 캠페인이 소유권을 갖기 전에 빠져나가면 전화번호가 남는다. */
export async function cleanupPlannerStaging(stagingId: string): Promise<void> {
  if (!stagingId) return;
  await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1`, [stagingId]).catch((e: any) =>
    console.warn('[planner-audience] staging 정리 실패:', e?.message || e),
  );
}

// ── ★ 2026-10-18 v2 입력 축 · 받는 사람(전체 · 상품 구매자 · 설계서 docs/2026-10-18-planner-v2-design.md §3-6) ──────────

/** 회사 스위치 — 플래너 한 줄 입력 · 상품 구매자 대상(쉼표 구분 id · 빈 값 = 닫힘 · 배포 기본값) */
export function plannerLineEnabled(companyId: string | null | undefined, env: string | undefined = process.env.PLANNER_LINE_COMPANY_IDS): boolean {
  return companyListAllows(companyId, String(env || ''));
}

/** 결제된 주문만(매출 판정 CT-86 과 같은 상태 목록 · 글자는 앞뒤 공백 · 대소문자를 걷어 비교) */
const PAID_STATUSES: string[] = [...REVENUE_STATUSES];

/**
 * (순수) 상품 구매자 술어 — customers 알리아스 c 기준 · `$1` = 회사 id(baseParams 계약) · params 에 값을 push 하고 조각을 돌려준다.
 * 자사몰 = 결제된 purchase 이벤트의 상품 키(journey-product 키 규칙 한 벌) · 원장 = purchases 상품 키 · since = 그 KST 날짜 0시 이후.
 */
export function buildBuyerPredicate(params: any[], a: Extract<PlannerAudience, { kind: 'product_buyers' }>): string {
  params.push(a.keys);
  const keysIdx = params.length;
  let sinceIdx = 0;
  if (a.since) { params.push(a.since); sinceIdx = params.length; }
  if (a.door === 'mall') {
    params.push(PAID_STATUSES);
    const paidIdx = params.length;
    return `AND EXISTS (
            SELECT 1 FROM cdp_events pb, ${mallItemsSql('pb')} it
             WHERE pb.company_id = $1
               AND pb.customer_id = c.id
               AND pb.event_name = 'purchase'
               AND LOWER(TRIM(COALESCE(pb.properties->>'status', ''))) = ANY($${paidIdx}::text[])
               ${sinceIdx ? `AND pb.occurred_at >= ($${sinceIdx}::date::timestamp AT TIME ZONE 'Asia/Seoul')` : ''}
               AND ${mallItemKeySql('it')} = ANY($${keysIdx}::text[])
          )`;
  }
  return `AND EXISTS (
            SELECT 1 FROM purchases pb
             WHERE pb.company_id = $1
               AND pb.customer_id = c.id
               ${sinceIdx ? `AND pb.purchase_date >= $${sinceIdx}::date` : ''}
               AND ${ledgerProductKeySql('pb')} = ANY($${keysIdx}::text[])
          )`;
}

/** 대상 확정 — 미리보기 값 또는 저장값 · 깨진 저장값 · 스위치 밖 · 문 바뀜 = 막음(전체로 넓히지 않는다) */
async function plannerTargetOf(companyId: string, plannerEventId: string, preview?: PlannerAudience): Promise<{ ok: true; audience: PlannerAudience } | { ok: false; reason: string }> {
  let audience: PlannerAudience | null = preview ?? null;
  if (!audience) {
    if (!plannerEventId) return { ok: true, audience: { kind: 'all' } };
    const r = await query(`SELECT meta FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid`, [plannerEventId, companyId]);
    if (!r.rows[0]) return { ok: false, reason: PLANNER_REASON.audienceInvalid };
    audience = readStoredAudience(r.rows[0].meta || {});
  }
  if (!audience) return { ok: false, reason: PLANNER_REASON.audienceInvalid };
  if (audience.kind === 'all') return { ok: true, audience };
  if (!plannerLineEnabled(companyId)) return { ok: false, reason: PLANNER_REASON.audienceInvalid };
  if ((await currentPurchaseDoor(companyId)) !== audience.door) return { ok: false, reason: PLANNER_REASON.purchaseDoorChanged };
  return { ok: true, audience };
}

/**
 * 저장 전 서버 재검증(라우트) — 스위치 · 지금 문 · 고른 키가 관측 목록 안인가(화면이 연 목록과 같은 기간 · 같은 함수).
 * 통과하면 이름을 서버 목록 이름으로 바꿔 돌려준다(화면이 보낸 이름을 믿지 않는다).
 */
export async function verifyPlannerAudience(companyId: string, a: PlannerAudience): Promise<{ ok: true; value: PlannerAudience } | { ok: false; status: number; code: string; error: string }> {
  if (a.kind === 'all') return { ok: true, value: a };
  if (!plannerLineEnabled(companyId)) return { ok: false, status: 400, code: 'AUDIENCE_DISABLED', error: '상품을 산 고객 대상은 아직 이 회사에 열리지 않았어요. 전체 고객으로 담아 주세요.' };
  const door = await currentPurchaseDoor(companyId);
  if (door !== a.door) return { ok: false, status: 409, code: 'PURCHASE_DOOR_CHANGED', error: '구매 기록이 들어오는 곳이 바뀌었어요. 대상 상품을 다시 골라 주세요.' };
  const list = await listObservedProducts(companyId, door);
  const byKey = new Map(list.products.map((p) => [p.key, p.name]));
  const missing = a.keys.filter((k) => !byKey.has(k));
  if (missing.length > 0) return { ok: false, status: 400, code: 'AUDIENCE_KEYS_INVALID', error: '목록에 없는 상품이 있어요. 대상 상품을 다시 골라 주세요.' };
  return { ok: true, value: { ...a, names: a.keys.map((k) => byKey.get(k) || k) } };
}

/** 메일 대상 조각 — 문자와 같은 매장 범위(행사를 만든 계정) · 같은 대상 술어 · 막힘은 0명과 다르다 */
async function resolvePlannerEmailWhere(input: { companyId: string; createdBy: string | null; plannerEventId: string; audience?: PlannerAudience }): Promise<
  { blocked: true; reason: string } | { blocked: false; params: any[]; scopeWhere: string; extraWhere: string }
> {
  const scope = await resolveOperatorStoreScope(input.companyId, input.createdBy);
  if (scope.blocked) return { blocked: true, reason: PLANNER_REASON.scopeBlocked };
  const target = await plannerTargetOf(input.companyId, input.plannerEventId, input.audience);
  if (!target.ok) return { blocked: true, reason: target.reason };
  const params = [...scope.baseParams];
  const extraWhere = target.audience.kind === 'product_buyers' ? buildBuyerPredicate(params, target.audience) : '';
  return { blocked: false, params, scopeWhere: scope.storeFilter, extraWhere };
}

/** 메일 받는 사람 수(확인 화면 · 승인 · 담기 창) — 실패 = error(조용한 0 금지) */
export async function countPlannerEmailRecipients(input: { companyId: string; createdBy: string | null; plannerEventId: string; audience?: PlannerAudience }): Promise<PlannerAudienceCount> {
  try {
    const w = await resolvePlannerEmailWhere(input);
    if (w.blocked) return { state: 'blocked', count: null, reason: w.reason };
    return { state: 'known', count: await countCustomerRecipientsWhere(w.params, w.scopeWhere, w.extraWhere) };
  } catch (e: any) {
    console.warn('[planner-audience] 메일 대상 수 산출 실패:', e?.message || e);
    return { state: 'error', count: null };
  }
}

/** 메일 받는 사람(실행부) — 위 수와 같은 WHERE · 막힘 = blocked(실행부가 잠그고 사유 통지) */
export async function resolvePlannerEmailRecipients(input: { companyId: string; createdBy: string | null; plannerEventId: string }): Promise<{ blocked: true; reason: string } | { blocked: false; recipients: EmailRecipient[] }> {
  const w = await resolvePlannerEmailWhere(input);
  if (w.blocked) return w;
  return { blocked: false, recipients: await resolveCustomerRecipientsWhere(w.params, w.scopeWhere, w.extraWhere) };
}

/** ★ 2026-10-18 한 줄 읽기 상품 목록의 시간 상한(넘으면 사람이 고른다 · 행사명 · 기간 · 채널 제안은 그대로 돌려준다 · Codex B 4R) */
export const LINE_AUDIENCE_CONFIRM_MS = 2500;

/**
 * ★ 2026-10-24 한 줄 질문표의 회사 사정(뿌리 대장 R9) — 채널 준비(담기 창 · 저장과 같은 함수) · 관측 상품(대상 상품 고르기와 같은 문 · 같은 함수).
 * 상품 조회 실패 · 시간 초과 = null = 구매자 제안은 사람이 고르고 상품 보기 없이 묻는다(넓히지 않는다).
 * ponytail: 시간 초과 뒤에도 조회 자체는 끝까지 돈다(취소 없음) — 담기 창이 곧바로 같은 목록을 부르는 것과 같은 부하.
 */
export async function loadPlannerLineAskContext(companyId: string, userId: string | null): Promise<PlannerLineAskContext> {
  let timer: NodeJS.Timeout | undefined;
  const [channels, products] = await Promise.all([
    getPlannerChannelAvailability(companyId, userId),
    Promise.race([
      currentPurchaseDoor(companyId).then(async (door) => ({
        door,
        list: (await listObservedProducts(companyId, door)).products.map((p) => ({ key: p.key, name: p.name, buyers: p.buyers })),
      })),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), LINE_AUDIENCE_CONFIRM_MS); }),
    ]).catch((e: any) => { console.warn('[planner-audience] 한 줄 읽기 상품 목록 실패(사람이 고름):', e?.message || e); return null; })
      .finally(() => { if (timer) clearTimeout(timer); }),
  ]);
  const ch: PlannerLineAskContext['channels'] = [];
  for (const c of channels) {
    if (c.channel === 'sms' || c.channel === 'dm' || c.channel === 'email') {
      ch.push({ channel: c.channel, label: PLANNER_CHANNEL_LABEL[c.channel], available: c.available, reason: c.reason });
    }
  }
  return { channels: ch, products };
}
