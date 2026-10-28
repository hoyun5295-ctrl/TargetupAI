/**
 * ★ CT-22: 한줄로 CDP 주문 sync 컨트롤타워 — D172 (2026-05-19)
 *
 * 🎯 목적
 *   자사몰 → 한줄로AI 주문 이력 동기화 + customer RFM(recent/total/count) 자동 갱신.
 *   - identifyCustomer 경유 (customer + link 보장)
 *   - customers.recent_purchase_date / total_purchase_amount / purchase_count 갱신
 *   - customers.last_purchase_date도 자사몰 정합
 *   - 'purchase' 이벤트 자동 박음 (cdp_events 박혀서 trigger campaign 활용 가능)
 *
 * 💵 status (자사몰 표준) — 2026-06-10 CT-86 마커 기반으로 정정
 *   - 'completed' / 'paid': 매출 미반영 주문만 1회 반영 (revenue_applied 마커)
 *   - 'cancelled' / 'refunded': 반영된 주문만 1회 차감 (revenue_reversed 마커, 차감액 = 반영 시점 기록 금액)
 *   - 'pending' / 'shipping' 등: 트래킹만 — 이후 paid가 오면 그때 매출 반영 (전환 누락 결함 정정)
 *
 * ⛔ 영구 원칙
 *   - 매출 멱등 = revenue_applied/revenue_reversed 마커 (이벤트 존재 여부 아님 — 상태 전환 통과)
 *   - phone 정규화는 identifyCustomer 경유 (customers 직접 수정 금지)
 *   - 타겟 자동완화 X (D171 영구 원칙)
 */

import { UserFacingError } from './http-error';
import { query, withTransaction } from '../config/database';
import { identifyCustomer, IdentifyInput } from './cdp-identity';
import { trackOrderEvent, validateProperties } from './cdp-events';
import { decideOrderRevenueAction, isCancelStatus, isRevenueStatus, netPurchaseSql } from './cdp-order-revenue';
import { kstDateKey } from './agency-send-state';
import type { MemberIdFormat } from './mall-consent';
// ★ 2026-09-26 한줄로 V2 R1-34 — 같은 주문 웹훅 직렬화(공용 잠금 CT)
import { withKeyedLock } from './keyed-lock';

// ═══════════════════════════════════════════════════════════
// 타입
// ═══════════════════════════════════════════════════════════

export interface OrderInput {
  source: string;
  orderId: string;                          // 자사몰 주문 번호 (idempotency)
  // 회원 식별 (identifyCustomer로 위임)
  externalId: string;
  email?: string;
  phone?: string;
  name?: string;
  // 주문 데이터
  status: 'completed' | 'paid' | 'cancelled' | 'refunded' | 'pending' | 'shipping' | string;
  totalAmount: number;
  itemCount?: number;
  items?: Array<{ productId?: string; productName?: string; price?: number; quantity?: number; categoryName?: string }>;
  orderedAt: string;                        // ISO datetime
  /**
   * ★ 2026-10-27 자사몰 대비 K1-3 — 결제 시각(ISO). 우커머스 = date_paid_gmt · 그 밖 provider = 원문 확인 전이라 비움(= 주문 시각).
   * 구매 사건 시각 · RFM 날짜는 orderPaidAt(paidAt ?? orderedAt) 한 함수로 읽는다.
   */
  paidAt?: string;
  /**
   * ★ 1027 K1-6 — 이 스냅숏의 원천 시각(ISO). source 종류 provider(우커머스) = 원문 수정 시각(date_modified_gmt) ·
   * received 종류 = 받은 시각(웹훅 ctx.observedAt · 주기 수집 = 그 쪽을 읽은 시각). 비우면 지금(동기 API 의 받은 시각).
   */
  srcAt?: string;
  /** ★ 1027 K10 SC2 — 상태 변환 표에 없는 원문 상태였으면 false(판정은 결제 아님 그대로 · properties.status_known = false 로 남긴다) */
  statusKnown?: boolean;
  /** ★ 1027 K10 SC2 — 모르는 상태였을 때 그 원문 글자(변환이 pending 으로 접어도 감시 표가 원문을 본다) */
  statusRaw?: string;
  /**
   * ★ 1027 K2-1 — 주문 본문의 수신동의(해석된 값만). 식별 CT 가 판정한다: 그 몰의 회원 연결이 있는 고객 = 무시(회원 정보만 진실) ·
   * 없는 고객 = 원천 시각 min(주문 시각, 받은 시각) · 고객 행은 만들 때와 NO 로 내릴 때만. 회원 쪽 동의 쓰기를 따로 부르지 않는다.
   */
  smsOptIn?: boolean;
  /** ★ 1027 K2-1 — 그 몰의 회원 연결 식별자 모양(우커머스 wooMemberIdFormat). 없으면 비회원 꼴(guest: · order:)이 아닌 연결 = 회원 */
  memberIdFormat?: MemberIdFormat;
  currency?: string;                        // 기본 KRW
  /**
   * 분류코드 (2026-09-18 · 설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-3)
   * 이 주문이 들어온 몰의 분류코드. 식별 단계(identifyCustomer)로 그대로 넘겨 고객을 그 분류에 기록한다.
   * 생략 = 식별 입력이 지금과 같다. ⛔ 호출부가 연동 행에서 읽은 값만 넣는다(요청 본문 값 금지).
   */
  storeCode?: string;
  /** ★ 1028 Codex R1 #5 — 몰 서버가 비밀키로 보낸 주문(/order · /bulk-import) · 식별 연결에 서버 확인 표시 */
  serverVerified?: boolean;
}

export interface OrderResult {
  customerId: string;
  linkId: string;
  wasCustomerCreated: boolean;
  rfmUpdated: boolean;
  /** ★ 1027 K1-6 — 옛 스냅숏이라 아무것도 쓰지 않음(웹훅 전달 = superseded) */
  stale: boolean;
}

// ═══════════════════════════════════════════════════════════
// ★ 2026-10-27 자사몰 대비 K1 — 결제 시각 · 스냅숏 시계 판정(한 함수씩 · 설계서 docs/2026-10-27-mall-integration-hardening-design.md)
// ═══════════════════════════════════════════════════════════

/** 결제 시각 = paidAt ?? orderedAt — 신규 기록 · 승격 · RFM 날짜가 이 함수만 쓴다(두 유입 순서의 occurred_at 이 같다 · R1) */
export function orderPaidAt(input: Pick<OrderInput, 'paidAt' | 'orderedAt'>): string {
  return input.paidAt ?? input.orderedAt;
}

/** 원천 시각 종류 — source = 원문이 수정 시각을 준다(우커머스) · received = 받은 시각뿐 */
export type OrderSrcKind = 'source' | 'received';
export function orderSrcKind(source: string): OrderSrcKind {
  return source === 'woocommerce' ? 'source' : 'received';
}

const srcMs = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * 이 스냅숏을 쓸 것인가(I3 · K1-6). 3-A · 3-B · 3-C · 4단계 모든 갈래가 쓰기 전에 지난다.
 *   - 들어온 src_at < 마지막 src_at = stale · 같으면 취소 · 환불만 apply(동률에서 취소가 이김) · 더 늦으면 apply
 *   - 종결 규칙(먼저): 취소 · 환불을 본 주문(cancel_seen_at)의 결제 본문 = source 종류는 src_at > cancel_seen_at 일 때만 · received 종류는 0
 */
export function orderSnapshotVerdict(
  last: { srcAt: string | null; cancelSeenAt: string | null } | null,
  incoming: { srcAt: string; status: string; kind: OrderSrcKind },
): 'apply' | 'stale' {
  if (!last) return 'apply';
  const inc = srcMs(incoming.srcAt);
  const prev = srcMs(last.srcAt);
  if (inc < prev) return 'stale';
  if (inc === prev && !isCancelStatus(incoming.status)) return 'stale';
  if (last.cancelSeenAt && isRevenueStatus(incoming.status)) {
    if (incoming.kind === 'received') return 'stale';
    if (!(inc > srcMs(last.cancelSeenAt))) return 'stale';
  }
  return 'apply';
}

// ═══════════════════════════════════════════════════════════
// 메인 — syncOrder
// ═══════════════════════════════════════════════════════════

/**
 * ★ 2026-09-26 한줄로 V2 R1-34 — purchase 이벤트 속성. 이벤트 속성 한도(10KB)를 넘으면 상품 목록만 뺀다(item_count는 유지).
 * 표식(revenue_applied)을 실은 이벤트 기록이 매출 반영의 전제라, 큰 주문이 매번 한도로 실패하면 그 주문 매출이 영영 안 들어간다.
 */
function purchaseEventProperties(input: OrderInput, extra: Record<string, unknown>): Record<string, unknown> {
  const full: Record<string, unknown> = {
    order_id: input.orderId,
    status: input.status,
    total_amount: input.totalAmount,
    item_count: input.itemCount,
    items: input.items,
    currency: input.currency || 'KRW',
    ...extra,
  };
  if (validateProperties(full).ok) return full;
  const { items: _omitted, ...rest } = full;
  return { ...rest, items_omitted: true };
}

/**
 * 자사몰 주문 1건 → customer upsert + RFM 갱신 + cdp_events 'purchase' 이벤트 박음.
 * - status가 completed/paid일 때만 RFM 갱신
 * - 같은 order_id 두 번 호출되어도 customers RFM은 한 번만 박힘 (cdp_events properties.order_id 검증)
 */
export async function syncOrder(
  companyId: string,
  input: OrderInput
): Promise<OrderResult> {
  if (!input.source || !input.orderId || !input.externalId) {
    throw new UserFacingError(400, 'CDP_INPUT', 'source, orderId, externalId는 필수입니다.');
  }
  if (!input.orderedAt || isNaN(new Date(input.orderedAt).getTime())) {
    throw new UserFacingError(400, 'CDP_INPUT', 'orderedAt 형식이 올바르지 않습니다 (ISO datetime).');
  }
  // ★ 2026-10-04 상태 글자는 앞뒤 공백·대소문자를 걷어 한 모양으로(매출 판정 CT-86 은 'paid'·'completed'·'cancelled'·'refunded' 정확 일치).
  //   옛: 자체호스팅·/order API 가 'PAID'·'Completed' 로 보내면 결제 주문의 매출이 0이었다. 저장되는 이벤트 status 도 이 값이다.
  input = { ...input, status: String(input.status ?? '').trim().toLowerCase() };
  if (input.paidAt !== undefined && isNaN(new Date(input.paidAt).getTime())) {
    throw new UserFacingError(400, 'CDP_INPUT', 'paidAt 형식이 올바르지 않습니다 (ISO datetime).');
  }
  // 스냅숏 원천 시각 — 비우면 지금(동기 API 호출의 받은 시각). 형식이 틀리면 받은 시각으로(판정만 쓰는 값 · 사건 시각 아님)
  const srcAt = input.srcAt && !isNaN(new Date(input.srcAt).getTime()) ? new Date(input.srcAt).toISOString() : new Date().toISOString();

  // 1. customer + link 보장
  const identifyInput: IdentifyInput = {
    tier: 'order',   // ★ 1028 K4 — 주문자 정보 = 빈 칸만 · 전화 교체 0(R23)
    ...(input.serverVerified ? { serverVerified: true } : {}),   // ★ 1028 Codex R1 #5 몰 서버 비밀키 호출
    source: input.source,
    externalId: input.externalId,
    email: input.email,
    phone: input.phone,
    name: input.name,
    // ★ 2026-09-18: 분류코드가 있을 때만 키를 싣는다(생략 시 식별 입력 불변 = 계약 테스트 cdp-orders-store-code)
    ...(input.storeCode ? { storeCode: input.storeCode } : {}),
    ...(input.memberIdFormat ? { memberIdFormat: input.memberIdFormat } : {}),
    // ★ 1027 K2-1 — 주문 본문의 동의는 이 한 호출로(판정 = 식별 CT) · 원천 시각 = min(주문 시각, 받은 시각)
    ...(input.smsOptIn !== undefined
      ? { smsOptIn: input.smsOptIn, consentFromOrder: true, consentAt: new Date(Math.min(new Date(input.orderedAt).getTime(), new Date(srcAt).getTime())).toISOString() }
      : {}),
  };
  const idResult = await identifyCustomer(companyId, identifyInput);

  if (!idResult.customerId) {
    // identify 정정(2026-06-10) 후에는 도달 불가 경로지만, null로 0행 UPDATE를 침묵 진행하지 않도록 명시 차단
    throw new UserFacingError(400, 'CDP_INPUT', '주문 처리 중 고객 식별에 실패했습니다. phone 또는 email을 포함해 다시 호출해주세요.');
  }

  // ★ 2026-09-26 한줄로 V2 R1-34 — 같은 주문의 웹훅은 한 줄로 선다(조회 → 판정 → 반영 사이 끼어들기 금지).
  //   옛: 둘이 동시에 오면 둘 다 기존 이벤트를 못 보고 둘 다 매출을 더할 수 있었다. PM2 fork 단일 프로세스 전제(공용 잠금 CT).
  //   프로세스를 넘는 경합은 아래 조건부 UPDATE(표식 · src_at · cancel_seen_at 이 판정 때와 같을 때만)가 막는다.
  // ★ 2026-10-27 자사몰 대비 K1-2 — 주문 사건 · 표식 · 고객 요약 = 한 트랜잭션(중간 종료 = 전부 롤백 · 재처리가 한 번 더함 · 옛 표식 되돌림 함수 삭제).
  const outcome = await withKeyedLock('cdp-order', `${companyId}:${input.source}:${input.orderId}`, () => withTransaction(async (run): Promise<{ rfmUpdated: boolean; stale: boolean }> => {
  // 2. 같은 order_id의 기존 주문 사건 조회 — 결제 전(order_placed)이든 결제(purchase)든 한 주문 한 행
  const existingRes = await run(
    `SELECT id, event_name, properties, occurred_at FROM cdp_events
     WHERE company_id = $1::uuid
       AND event_name IN ('purchase', 'order_placed')
       AND source = $2
       AND properties->>'order_id' = $3
     ORDER BY occurred_at ASC, id ASC
     LIMIT 1`,
    [companyId, input.source, input.orderId]
  );
  const existing = existingRes.rows.length > 0 ? existingRes.rows[0] : null;
  const props: Record<string, any> = existing?.properties || {};
  const lastSrcRaw = String(props.src_at ?? '');
  const lastCancelRaw = String(props.cancel_seen_at ?? '');

  // ★ 1027 K1-6 — 늦게 온 옛 스냅숏은 쓰지 않는다(상태 갱신 · 승격 · 매출 0 · 수신 = superseded)
  const verdict = orderSnapshotVerdict(
    existing ? { srcAt: lastSrcRaw || null, cancelSeenAt: lastCancelRaw || null } : null,
    { srcAt, status: input.status, kind: orderSrcKind(input.source) },
  );
  if (verdict === 'stale') return { rfmUpdated: false, stale: true };

  // ★ 1028 M22 — 차감까지 끝난 주문의 되살림 근거 = source 종류 provider + 취소를 본 시각 기록(판정이 그보다 늦은 본문만 여기까지 보냄)
  const decision = decideOrderRevenueAction(existing ? { properties: props } : null, input.status, {
    revivable: orderSrcKind(input.source) === 'source' && !!lastCancelRaw,
  });
  const cancel = isCancelStatus(input.status);
  // 모르는 상태 표식 = 받아들인 쓰기마다 다시 쓴다(알려진 상태로 바뀌면 지운다 · 원문 글자 · 본 시각 · Codex 1R)
  const extra = input.statusKnown === false
    ? { status_known: false, status_raw: String(input.statusRaw ?? input.status).slice(0, 60), status_unknown_at: srcAt }
    : {};
  const UNKNOWN_KEYS = `- 'status_known' - 'status_raw' - 'status_unknown_at'`;
  const paidAt = orderPaidAt(input);
  // 판정에 쓴 값이 저장 때까지 같은가(다른 프로세스가 그 사이 바꿨으면 0행 = stale · R12)
  const guard = (s: number, c: number) => `COALESCE(properties->>'src_at', '') = $${s} AND COALESCE(properties->>'cancel_seen_at', '') = $${c}`;

  // 3-A. 결제 확정 — 매출 더하기 (마커 없는 주문만 1회) · 결제 전 행이면 그 순간 purchase 로 승격(K1-2)
  if (decision.action === 'apply') {
    if (existing && decision.revive) {
      // ★ 1028 M22 — 취소 뒤 몰에서 다시 결제된 주문: 차감 표식을 걷고 다시 반영(사건 시각 = 새 결제 시각 · 도착 축은 그대로 = 여정 다시 진입 0)
      const claim = await run(
        `UPDATE cdp_events SET
           occurred_at = $5::timestamptz,
           properties = (COALESCE(properties, '{}'::jsonb) - 'revenue_reversed' ${UNKNOWN_KEYS})
             || jsonb_build_object('revenue_applied', true, 'status', $2::text, 'total_amount', $3::numeric, 'src_at', $4::text, 'revived_at', $4::text)
             || $8::jsonb
         WHERE id = $1::uuid
           AND event_name = 'purchase'
           AND COALESCE(properties->>'revenue_reversed', '') = 'true'
           AND ${guard(6, 7)}
         RETURNING id`,
        [existing.id, input.status, input.totalAmount, srcAt, paidAt, lastSrcRaw, lastCancelRaw, JSON.stringify(extra)]
      );
      if (claim.rows.length === 0) return { rfmUpdated: false, stale: true };
    } else if (existing) {
      const claim = await run(
        `UPDATE cdp_events SET
           event_name = 'purchase',
           occurred_at = CASE WHEN event_name = 'order_placed' THEN $5::timestamptz ELSE occurred_at END,
           created_at = CASE WHEN event_name = 'order_placed' THEN NOW() ELSE created_at END,
           properties = (COALESCE(properties, '{}'::jsonb) ${UNKNOWN_KEYS})
             || jsonb_build_object('revenue_applied', true, 'status', $2::text, 'total_amount', $3::numeric, 'src_at', $4::text)
             || CASE WHEN event_name = 'order_placed' THEN jsonb_build_object('first_arrived_at', created_at) ELSE '{}'::jsonb END
             || $8::jsonb
         WHERE id = $1::uuid
           AND COALESCE(properties->>'revenue_applied', '') <> 'true'
           AND COALESCE(properties->>'revenue_reversed', '') <> 'true'
           AND ${guard(6, 7)}
         RETURNING id`,
        [existing.id, input.status, input.totalAmount, srcAt, paidAt, lastSrcRaw, lastCancelRaw, JSON.stringify(extra)]
      );
      if (claim.rows.length === 0) return { rfmUpdated: false, stale: true };
    } else {
      await trackOrderEvent(run, companyId, {
        name: 'purchase',
        source: input.source,
        identityLinkId: idResult.linkId,
        customerId: idResult.customerId,
        properties: purchaseEventProperties(input, { revenue_applied: true, src_at: srcAt, ...extra }),
        occurredAt: paidAt,
      });
    }
    // ★ 2026-10-04 최근 구매 금액·마지막 구매일은 이 주문이 기존 최근 구매보다 늦거나 같을 때만 바꾼다(최근 구매일은 원래 GREATEST).
    //   옛: 무조건 이번 주문 값이라, 옛 주문이 나중에 처리되면(백필 · 지연 웹훅) 날짜는 새 값인데 금액·마지막 구매일은 옛 값이 됐다.
    //   SET 의 오른쪽은 모두 갱신 전 값을 본다(recent_purchase_date 비교가 이 문장의 GREATEST 결과에 영향받지 않는다).
    // ★ 1027 K1-4 — 날짜 = 결제 시각의 KST 날짜(글자 · R16)
    const paidDay = kstDateKey(new Date(paidAt));
    await run(
      `UPDATE customers SET
        total_purchase_amount = COALESCE(total_purchase_amount, 0) + $2,
        total_purchase = COALESCE(total_purchase, 0) + $2,
        purchase_count = COALESCE(purchase_count, 0) + 1,
        recent_purchase_date = GREATEST(COALESCE(recent_purchase_date, $3::date), $3::date),
        recent_purchase_amount = CASE WHEN recent_purchase_date IS NULL OR $3::date >= recent_purchase_date THEN $2 ELSE recent_purchase_amount END,
        last_purchase_date = CASE WHEN COALESCE(last_purchase_date, '') = '' OR TO_CHAR($3::date, 'YYYY-MM-DD') >= last_purchase_date
                                  THEN TO_CHAR($3::date, 'YYYY-MM-DD') ELSE last_purchase_date END,
        avg_order_value = (COALESCE(total_purchase_amount, 0) + $2) / GREATEST(COALESCE(purchase_count, 0) + 1, 1),
        updated_at = NOW()
      WHERE id = $1::uuid`,
      [idResult.customerId, input.totalAmount, paidDay]
    );
    return { rfmUpdated: true, stale: false };
  }

  // 3-B. 취소/환불 — 반영된 주문만 1회 차감 (차감액 = 반영 시점 기록 금액) · 취소를 본 시각을 남긴다(지우지 않음 · K1-6 종결 규칙)
  if (decision.action === 'reverse') {
    if (!existing) return { rfmUpdated: false, stale: false };
    const claim = await run(
      `UPDATE cdp_events
       SET properties = (COALESCE(properties, '{}'::jsonb) ${UNKNOWN_KEYS})
         || jsonb_build_object('revenue_reversed', true, 'status', $2::text, 'src_at', $3::text)
         || CASE WHEN properties ? 'cancel_seen_at' THEN '{}'::jsonb ELSE jsonb_build_object('cancel_seen_at', $3::text) END
         || $6::jsonb
       WHERE id = $1::uuid
         AND COALESCE(properties->>'revenue_reversed', '') <> 'true'
         AND ${guard(4, 5)}
       RETURNING id`,
      [existing.id, input.status, srcAt, lastSrcRaw, lastCancelRaw, JSON.stringify(extra)]
    );
    if (claim.rows.length === 0) return { rfmUpdated: false, stale: true };
    const reverseAmount = decision.reverseAmount ?? input.totalAmount;
    // ★ 1028 M21(K1-5) — 최근 구매일 · 금액 · 마지막 구매일이 이 주문의 날(사건 시각의 KST 날짜)이면, 남은 결제 구매(자사몰 순매출 + 싱크 원장)의
    //   가장 늦은 날로 되돌린다(두 문 합산 = 여정의 이전 구매 판정과 같은 규칙 · 남은 것이 없으면 비움). 그 날이 아니면 그대로.
    //   SET 의 오른쪽은 갱신 전 값을 본다 · 차감 표식은 같은 트랜잭션의 위 문장이 이미 걸어 이 주문은 남은 목록에서 빠진다.
    const reversedDay = existing.occurred_at ? kstDateKey(new Date(existing.occurred_at)) : null;
    // ★ 1028 Codex R1 #4 — 고객 행을 먼저 잠그고(앞 문장) 다음 문장의 새 스냅숏으로 남은 구매를 센다. 같은 고객의 다른 주문 취소가 겹치면
    //   잠금을 기다린 뒤 그 취소가 커밋한 차감 표식을 본다(옛: 한 문장 안에서 잠금을 기다려도 계산은 시작 때 스냅숏이라 취소된 주문의 날로 되돌렸다).
    await run(`SELECT 1 FROM customers WHERE id = $1::uuid FOR UPDATE`, [idResult.customerId]);
    await run(
      `UPDATE customers c SET
        total_purchase_amount = GREATEST(COALESCE(c.total_purchase_amount, 0) - $2, 0),
        total_purchase = GREATEST(COALESCE(c.total_purchase, 0) - $2, 0),
        purchase_count = GREATEST(COALESCE(c.purchase_count, 0) - 1, 0),
        avg_order_value = CASE
          WHEN COALESCE(c.purchase_count, 0) - 1 > 0
            THEN GREATEST(COALESCE(c.total_purchase_amount, 0) - $2, 0) / (COALESCE(c.purchase_count, 0) - 1)
          ELSE 0
        END,
        recent_purchase_date = CASE WHEN c.recent_purchase_date = $3::date THEN nr.day ELSE c.recent_purchase_date END,
        recent_purchase_amount = CASE WHEN c.recent_purchase_date = $3::date THEN nr.amount ELSE c.recent_purchase_amount END,
        last_purchase_date = CASE WHEN c.last_purchase_date = TO_CHAR($3::date, 'YYYY-MM-DD') THEN TO_CHAR(nr.day, 'YYYY-MM-DD') ELSE c.last_purchase_date END,
        updated_at = NOW()
      FROM (SELECT 1) one
      LEFT JOIN LATERAL (
        SELECT u.day, u.amount FROM (
          SELECT (e.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS day, NULLIF(e.properties->>'total_amount', '')::numeric AS amount
            FROM cdp_events e
           WHERE e.company_id = $4::uuid AND e.customer_id = $1::uuid AND ${netPurchaseSql('e')}
          UNION ALL
          SELECT p.purchase_date::date AS day, SUM(p.total_amount) AS amount
            FROM purchases p
           WHERE p.company_id = $4::uuid AND p.customer_id = $1::uuid AND p.purchase_date IS NOT NULL
           GROUP BY p.purchase_date::date
        ) u
        ORDER BY u.day DESC, u.amount DESC NULLS LAST
        LIMIT 1
      ) nr ON true
      WHERE c.id = $1::uuid`,
      [idResult.customerId, reverseAmount, reversedDay, companyId]
    );
    return { rfmUpdated: true, stale: false };
  }

  // 3-C. 매출 변화 없는 상태 갱신 (pending→shipping 등) — 이벤트 status만 추적 · 취소 · 환불을 처음 본 시각 기록
  if (existing) {
    const upd = await run(
      `UPDATE cdp_events
       SET properties = (COALESCE(properties, '{}'::jsonb) ${UNKNOWN_KEYS}) || jsonb_build_object('status', $2::text, 'src_at', $3::text)
         || CASE WHEN $4::boolean AND NOT (properties ? 'cancel_seen_at') THEN jsonb_build_object('cancel_seen_at', $3::text) ELSE '{}'::jsonb END
         || $7::jsonb
       WHERE id = $1::uuid
         AND ${guard(5, 6)}
       RETURNING id`,
      [existing.id, input.status, srcAt, cancel, lastSrcRaw, lastCancelRaw, JSON.stringify(extra)]
    );
    return { rfmUpdated: false, stale: upd.rows.length === 0 };
  }

  // 4. 처음 본 주문인데 매출 변화가 없다(결제 전 · 결제 실패 · 취소 먼저) = order_placed(★ 1027 K1-1 · 구매 사건 아님 · 결제되는 순간 3-A 가 승격)
  await trackOrderEvent(run, companyId, {
    name: 'order_placed',
    source: input.source,
    identityLinkId: idResult.linkId,
    customerId: idResult.customerId,
    properties: purchaseEventProperties(input, { src_at: srcAt, ...(cancel ? { cancel_seen_at: srcAt } : {}), ...extra }),
    occurredAt: input.orderedAt,
  });
  return { rfmUpdated: false, stale: false };
  }));

  return {
    customerId: idResult.customerId,
    linkId: idResult.linkId,
    wasCustomerCreated: idResult.wasCreated,
    rfmUpdated: outcome.rfmUpdated,
    stale: outcome.stale,
  };
}

// ═══════════════════════════════════════════════════════════
// bulk-import — 초기 마이그레이션
// ═══════════════════════════════════════════════════════════

export interface BulkImportInput {
  source: string;
  customers?: IdentifyInput[];              // 회원 마스터 일괄 박음
  orders?: OrderInput[];                    // 주문 이력 일괄 박음
}

export interface BulkImportResult {
  customersImported: number;
  customersFailed: number;
  ordersImported: number;
  ordersFailed: number;
  // ★ 2026-06-25 (gap 8): silent drop 폐기 — 1,000건 초과분을 경고로 노출
  customersTruncated: boolean;
  ordersTruncated: boolean;
  droppedCustomers: number;
  droppedOrders: number;
  warning?: string;
  failures: Array<{ type: 'customer' | 'order'; externalId?: string; orderId?: string; error: string }>;
}

const BULK_IMPORT_MAX_ROWS = 1000;

/**
 * 자사몰 admin이 한줄로 대시보드에서 1회성 일괄 import.
 * - customers + orders 최대 각각 1,000건/요청
 * - 실패한 row는 failures 배열에 박음, 성공한 row는 진행
 * - 더 큰 import는 페이지네이션 호출 권장
 */
export async function bulkImport(
  companyId: string,
  input: BulkImportInput
): Promise<BulkImportResult> {
  if (!input.source) throw new UserFacingError(400, 'CDP_INPUT', 'source는 필수입니다.');
  const customersInput = input.customers || [];
  const ordersInput = input.orders || [];
  const customerList = customersInput.slice(0, BULK_IMPORT_MAX_ROWS);
  const orderList = ordersInput.slice(0, BULK_IMPORT_MAX_ROWS);
  const droppedCustomers = Math.max(0, customersInput.length - customerList.length);
  const droppedOrders = Math.max(0, ordersInput.length - orderList.length);

  const result: BulkImportResult = {
    customersImported: 0,
    customersFailed: 0,
    ordersImported: 0,
    ordersFailed: 0,
    customersTruncated: droppedCustomers > 0,
    ordersTruncated: droppedOrders > 0,
    droppedCustomers,
    droppedOrders,
    failures: [],
  };

  for (const c of customerList) {
    try {
      await identifyCustomer(companyId, { ...c, source: c.source || input.source });
      result.customersImported++;
    } catch (err: any) {
      result.customersFailed++;
      result.failures.push({ type: 'customer', externalId: c.externalId, error: err?.message || 'unknown' });
    }
  }

  for (const o of orderList) {
    try {
      await syncOrder(companyId, { ...o, source: o.source || input.source });
      result.ordersImported++;
    } catch (err: any) {
      result.ordersFailed++;
      result.failures.push({ type: 'order', orderId: o.orderId, externalId: o.externalId, error: err?.message || 'unknown' });
    }
  }

  if (droppedCustomers > 0 || droppedOrders > 0) {
    result.warning = `요청 1건당 최대 ${BULK_IMPORT_MAX_ROWS}건까지만 처리됩니다. 초과분(고객 ${droppedCustomers}건 / 주문 ${droppedOrders}건)은 처리되지 않았습니다. 페이지네이션으로 나눠 호출해주세요.`;
    console.log(`[CDP bulkImport] truncation — droppedCustomers=${droppedCustomers} droppedOrders=${droppedOrders} (company=${companyId})`);
  }

  return result;
}
