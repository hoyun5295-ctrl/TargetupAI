/**
 * Journey Target Extractor — 여정 trigger 조건으로 후보 customer_id 추출 (공유 컨트롤타워)
 *
 * 목적
 *   발송(journey-trigger-watcher)과 미리보기(ai.ts sample-customer)가
 *   동일 기준으로 고객을 추출하도록 단일 진입점으로 둔다.
 *
 * 동작 보존
 *   각 trigger의 SQL은 journey-trigger-watcher.ts의 기존 match 함수에서 1:1로 옮긴 것이다.
 *   cond(customer_conditions) 파라미터 인덱스를 기존과 동일하게 유지하기 위해,
 *   limit는 applyCustomerConditions 적용 이후 마지막에 push 한다.
 *   기존 발송 SQL과의 유일한 차이는 LIMIT 500 → LIMIT $N 파라미터화 (발송은 500을 그대로 전달).
 *
 * 영구 원칙
 *   - no_target_auto_relax: 매칭 0건 시 빈 배열 반환, 자동완화 없음
 *   - 회사 격리: 모든 SQL company_id 필수
 */

import { query } from '../config/database';
import { netPurchaseSql, cdpEventNameMatchSql } from './cdp-order-revenue';   // ★ 2026-11-02 결제된 구매 CT(CT-J3)
import { KST_TODAY_DATE_SQL } from './stats-aggregation';
import { buildJourneySafetyFilter, buildReentryAntiJoin } from './journey-safety-filter';
import type { JourneyConsent } from './mall-consent';
import { resolvePointsExpiringConfig, clampInt } from './journey-points-trigger';
import { buildLedgerAntiJoin, hasBaseline } from './journey-entry-ledger';
import { orderAttemptSql } from './journey-purchase-ledger';
import { purchaseFactsSql, crossDoorEntryOwnedSql, mallEntryDaySql, ledgerEntryDaySql, LEDGER_PURCHASES_SQL } from './two-door-purchase';   // ★ 2026-11-04 C99 CT-D2 · CT-D5
// ★ 2026-08-01 여정 재설계 §3-0-2 — "우리가 처음 본 사람" ≠ "신규 고객".
//   추출은 회사 능력을 조회하지 않는다(Codex 3R). 술어는 데이터로만 평가되고,
//   "판정 가능한가" 게이트는 발송 진입 경로(journey-trigger-watcher)가 소유한다.
import { newSignupSql, journeySignupSinceSql } from './customer-joined-at';   // ★ 2026-11-02 신규 가입 판정 CT(CT-J6)
// ★ 2026-08-01 §3-0-3 — 이관 유예. "우리가 오늘 처음 봤다"는 "오늘 무언가 했다"가 아니다.
//   기존 고객 DB를 처음 연동하면 수만 명의 created_at이 전부 오늘이라 상태형 트리거가 통째로 발화한다.
import { isBulkStateTrigger, resolveIntakeGraceDays, buildIntakeGraceClause } from './journey-intake-grace';
import { buildSegmentBreakdown, SegmentBreakdown } from './journey-simulator-core';
import type { CdpEventRow } from './journey-cdp-cursor';
// ★ 2026-09-30 여정 V2 3차 — 상품 재구매: 상품 키 규칙은 journey-product 한 곳(진입 · 목표 · 목록이 같은 규칙).
import { normalizeProductFilters, mallItemKeySql, mallItemsSql, ledgerProductKeySql } from './journey-product';
// ★ 2026-10-20 여정 V.3 §18 — 기존 여정 뒤에 붙이기(앞 여정을 마치면).
import { readAfterConfig, outcomeStatuses, AFTER_JOURNEY_WINDOW_DAYS } from './journey-after-config';
import { lineageColumnsReady, lineageJourneyIds } from './journey-lineage';
import { getJourneyOwnerScopeSql } from './store-scope';   // ★ C104 G5 진입 입력 CT
import { journeyOwnerConsent } from './mall-consent';
// ★ 2026-10-23 여정 결함 0 — 대상 조건 칸 표 한 곳(추출 · 검증 · 사람 말 · AI 메뉴 공용)
import { CUSTOMER_CONDITION_FIELDS, BIRTH_MONTH_SQL, normalizeGenderCode, conditionFieldLabelList } from './journey-condition-fields';
import { getGenderVariants } from './normalize';
// ★ 2026-11-02 §16 G2 — 매장번호 회신 미등록 판정 = 실행기와 같은 함수
import { isCallbackRegistered } from './callback-filter';
import { normalizePhone } from './normalize-phone';

/**
 * ★ 2026-11-02 설계서 §16 G2 — 대상 SQL 한 벌(트리거 갈래마다 고객 id 를 고르는 문장 + 값 · 글자는 옛 갈래 그대로).
 *   LIMIT = 마지막 값 · null = 전원(PG `LIMIT NULL` = 제한 없음) · 갈래가 바로 0명이면 null.
 *   목록(selectJourneyTargetCustomerIds) · 전원 집계(countJourneyTargets · storeCallbackExposure)가 같은 문장을 돌린다 = 집계 상한 0.
 */
export interface TargetQuery {
  sql: string;
  params: any[];
  /** 판정 근거 표가 없으면(42703 · 42P01) 0명으로 닫는다(등급 상승 · 추정해서 보내지 않는다) — 돌리는 자리 한 곳(runTargetSql)이 판정 */
  zeroOnMissingSchema?: boolean;
}

/** LIMIT 값 · null = 전원 */
function limitParam(limit: number | null): string | null {
  return limit == null ? null : String(limit);
}

/** 대상 SQL 을 돌린다(감싼 문장 포함) · 근거 표 없음 = 0명(옛 등급 상승 갈래 안 catch 와 같은 판정 · 한 곳) */
async function runTargetSql(q: TargetQuery, sql: string, params: any[]): Promise<any[]> {
  try {
    return (await query(sql, params)).rows;
  } catch (err: any) {
    if (!q.zeroOnMissingSchema || (err?.code !== '42703' && err?.code !== '42P01')) throw err;
    console.warn(`[JourneyExtractor] 등급 상승 — 판정 근거 미비(${err?.code}) → 0건. DDL 실행 필요`);
    return [];
  }
}

export async function selectJourneyTargetCustomerIds(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  limit: number,
  journeyId?: string,
  reentry?: { allowReentry: boolean; cooldownDays: number; lineageIds?: string[] },
  scopeSql = '',
  consent?: JourneyConsent,
): Promise<string[]> {
  const q = await buildJourneyTargetQuery(companyId, triggerEvent, triggerFilters, limit, journeyId, reentry, scopeSql, consent);
  if (!q) return [];
  return (await runTargetSql(q, q.sql, q.params)).map((x: any) => x.customer_id);
}

export async function buildJourneyTargetQuery(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  limit: number | null,
  journeyId?: string,
  reentry?: { allowReentry: boolean; cooldownDays: number; lineageIds?: string[] },   // ★ 0930 V2 5차 lineageIds = 같은 계보(새 판 · 옛 판)
  // ★ 2026-09-27 한줄로 V2 S5-04 — 여정 작성자(또는 미리보기 요청자)의 분류코드 범위 조각(store-scope · 관리자 = 빈 조각).
  //   추출 SQL **안**(LIMIT 앞)에 건다 — 뒤에서 거르면 범위 밖 고객이 진입하지 않은 채 매 회차 상한을 차지해 범위 안 고객이 굶는다.
  scopeSql = '',
  consent?: JourneyConsent,   // ★ 2026-10-02 수신동의 조각(mall-consent journeyOwnerConsent · 없으면 고객 행)
): Promise<TargetQuery | null> {
  const filters = triggerFilters || {};
  // 이관 유예 일수 — 대상 트리거 목록은 CT가 소유한다(isBulkStateTrigger). 대상이 아니면 0 = 조건 없음.
  const graceDays = isBulkStateTrigger(triggerEvent) ? resolveIntakeGraceDays(filters) : 0;

  switch (triggerEvent) {
    // 1. 신규 가입 (customers.created_at 직전 N시간 안)
    case 'customer.created': {
      // ★ Phase 2: created_at 의존 제거 — 활성(baseline 적재됨) 여정은 진입 원장에 없는 식별자만 신규.
      //   초안/미리보기(baseline 없음)는 created_at 최근 창으로 "추정"만(실발송 아님).
      // ★ 2026-11-02 설계서 3-6(D19 · CT-J6) — 신규 = 가입 근거(joined_at)가 켠 뒤(기준 시각 = journeySignupSinceSql · 시각이 있으면 기준선 시각 · 날짜뿐이면 그날 KST 시작) · 72시간 안 +
      //   원장에 번호 없음 + 번호 한 행. 옛 「처음 본 때(created_at) · 구매 · 포인트 · 등급 없음」 판정을 지웠다.
      const params: any[] = [companyId];
      const useLedger = !!journeyId && (await hasBaseline(journeyId));
      let entryClause: string;
      if (useLedger) {
        params.push(journeyId);                                     // $2 = journeyId
        const jRef = `$${params.length}::uuid`;
        const since = journeySignupSinceSql('c', `(SELECT entry_baseline_at FROM journeys WHERE id = ${jRef})`);
        entryClause = `${buildLedgerAntiJoin('c', params.length)} AND ${newSignupSql('c', since)}`;
      } else {
        params.push(String(Number(filters.recent_hours || 24)));    // $2 = hours (추정 · 미리보기)
        entryClause = newSignupSql('c', `NOW() - ($${params.length} || ' hours')::interval`);
      }
      // ★ 2026-08-01 §3-0-2: 원장에 없다고 신규가 아니다.
      //   자사몰로 먼저 등록된 고객(매장코드 없음)을 싱크가 매장코드와 함께 올리면 customers upsert 키
      //   (company_id, COALESCE(store_code,'__NONE__'), phone)가 충돌하지 않아 **새 행이 생긴다**.
      //   그 행은 원장에 없으니 옛 판정으로는 신규였고, 10년 단골에게 환영 문자가 나갔다.
      //   회사가 준 근거로 "전에도 고객이었다"를 걸러낸다 — 근거는 회사마다 다르다(설계서 §2-3).
      //   ⚠ 근거가 없는 회사를 생성·활성화 시점에 막는 것은 다음 조각이다. 여기서 빈 배열을 돌려주면
      //     기존 여정이 사유 없이 죽는다("조용한 0건"은 우리가 고치려는 병 자체다) → 추출 동작은 보존하고 관측만.
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
      params.push(limitParam(limit));
      // ★ 2026-08-01 Codex 2R 수용 — 같은 회차 안 중복 진입 차단.
      //   판정을 사람 단위로 좁혀도 "이전 회차 기록"만 막힌다. 같은 전화번호의 무매장·매장 행이
      //   한 회차에 함께 후보가 되면 둘 다 원장 이전 상태를 보고 통과해 **같은 번호로 두 번 나간다**.
      //   DISTINCT ON (phone)으로 사람당 한 행만 남긴다(가장 최근 생성 행). LIMIT은 중복 제거 뒤에 건다 —
      //   먼저 걸면 중복이 정원을 먹어 실제 신규가 밀린다.
      //   전화번호 없는 행은 후보에서 뺀다 — 발송도 못 하고 진입 원장 기록(phone <> '')도 안 되어
      //   매회 후보로 되살아나며 대량 차단 판정만 부풀린다.
      return { sql: `SELECT s.customer_id FROM (
           SELECT DISTINCT ON (c.phone) c.id AS customer_id, c.created_at
             FROM customers c
            WHERE c.company_id = $1::uuid
              AND COALESCE(c.phone, '') <> ''
              AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
              AND ${entryClause}
              ${cond ? ` AND ${cond}` : ''}
            ORDER BY c.phone, c.created_at DESC
         ) s
         ORDER BY s.created_at DESC
         LIMIT $${params.length}::int`, params };
    }

    // 2. 재구매 / 6. 예약 (cdp_events 직전 N분)
    // 라이브 발송은 trigger-watcher가 selectCdpEvent를 커서 모드로 직접 호출. 여기(미리보기)는 추정 모드.
    case 'cdp.purchase':
      return cdpEventTargetQuery(companyId, 'purchase', filters, limit, undefined, undefined, scopeSql, consent);
    // ★ §11-5 #2·#5 — 같은 구매 스트림의 분기(자격 필터는 라이브 경로가 적용). 미리보기는 구매 근사치.
    case 'purchase.first':
    case 'customer.dormant_return':
      return cdpEventTargetQuery(companyId, 'purchase', filters, limit, undefined, undefined, scopeSql, consent);
    // ★ 2026-09-30 V2 3차 — 상품 재구매. 미리보기 · 인원 = 최근 7일 고른 상품 구매자(저장된 문 기준). 라이브는 커서 경로 + 상품 자격 필터.
    case 'purchase.product':
      return productBuyersTargetQuery(companyId, filters, limit, scopeSql, consent);
    case 'cdp.reservation_created':
      return cdpEventTargetQuery(companyId, 'reservation_created', filters, limit, undefined, undefined, scopeSql, consent);
    // ★ 2026-06-22: 배송 시작 = 자사몰 custom 이벤트(cdp_events.event_name='custom_order_shipped'). 라이브는 watcher가 커서 경로 호출, 여기는 미리보기·카운트 추정.
    case 'custom_order_shipped':
      return cdpEventTargetQuery(companyId, 'custom_order_shipped', filters, limit, undefined, undefined, scopeSql, consent);

    // 3. 휴면 (customers.recent_purchase_date < NOW - N일)
    case 'customer.dormant': {
      const d = Number(filters.dormant_days || 30);
      // ★ 2026-10-20 여정 V.3 §8-1 — 「이미 쉬고 있는 고객도 받기」: 기준일 + 7일 창의 위쪽 끝을 없앤다(오래 쉰 기존 고객도 들어온다 · 최근에 쉰 순).
      //   하루 몫(backfill_per_day · 진입 감시)이 나눠 받는다. 기본 꺼짐 = 옛 7일 창 그대로.
      const includeExisting = filters.include_existing === true;
      // ★ Codex 적대 A5 — 위쪽 끝(+7일)을 쓸 때만 그 값을 싣는다(쓰지 않는 $3 이 남으면 PG 가 형을 못 정해 추출 전체가 실패한다).
      const params: any[] = [companyId, String(d)];
      let upperBound = '';
      if (!includeExisting) {
        params.push(String(d + 7));
        upperBound = `AND c.recent_purchase_date > (${KST_TODAY_DATE_SQL} - ($${params.length} || ' days')::interval)`;
      }
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays, reentry.lineageIds) : '';
      // 이관 유예 — 3년 전 최근구매일이 오늘 적재되면 그 사람은 즉시 휴면 대상이 된다.
      const grace = buildIntakeGraceClause('c', params, graceDays);
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
      params.push(limitParam(limit));
      return { sql: `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
           AND c.recent_purchase_date IS NOT NULL
           AND c.recent_purchase_date < (${KST_TODAY_DATE_SQL} - ($2 || ' days')::interval)
           ${upperBound}
           ${antiJoin}
           ${grace ? ` AND ${grace}` : ''}
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.recent_purchase_date DESC
         LIMIT $${params.length}::int`, params };
    }

    // 4. 장바구니 포기 (cdp_events cart_add 직전 abandon_hours, 이후 checkout_start/purchase 없음)
    case 'cdp.cart_abandon': {
      const h = Number(filters.abandon_hours || 24);
      const params: any[] = [companyId, String(h)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays, reentry.lineageIds) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
      params.push(limitParam(limit));
      return { sql: `WITH abandoned AS (
           SELECT DISTINCT ON (customer_id) customer_id, occurred_at AS cart_add_at
           FROM cdp_events
           WHERE company_id = $1::uuid
             AND event_name = 'cart_add'
             AND customer_id IS NOT NULL
             -- ★ Phase 3: 창 [N, N+24h]로 확대 — 워처 다운타임(최대 ~1일) 견딤. cooldown 7일이 중복 진입 차단.
             AND occurred_at >= NOW() - (($2::int + 24) || ' hours')::interval
             AND occurred_at <= NOW() - ($2 || ' hours')::interval
           ORDER BY customer_id, occurred_at DESC
         )
         SELECT a.customer_id
         FROM abandoned a
         INNER JOIN customers c ON c.id = a.customer_id AND c.company_id = $1::uuid
         WHERE NOT EXISTS (
           SELECT 1 FROM cdp_events e2
           WHERE e2.company_id = $1::uuid
             AND e2.customer_id = a.customer_id
             AND (e2.event_name = 'checkout_start' OR ${orderAttemptSql('e2')})   -- ★ 1027 K1-9 결제 전 주문도 주문 시도
             AND e2.occurred_at > a.cart_add_at
         )
           -- ★ 2026-08-01 §11-4: 매장(싱크)에서 산 사람에게 장바구니 리마인드를 보내지 않는다.
           --   그 구매는 원장에만 있고 cdp_events에는 없다. KST naive 규약이라 변환 명시.
           AND NOT EXISTS (
             SELECT 1 FROM ${LEDGER_PURCHASES_SQL} p2   -- ★ 2026-11-04 C102 G1 환불 행 = 구매 아님(CT-D6)
             WHERE p2.company_id = $1::uuid
               AND p2.customer_id = a.customer_id
               AND p2.purchase_date IS NOT NULL
               AND p2.purchase_date > (a.cart_add_at AT TIME ZONE 'Asia/Seoul')
           )
           AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
         ${antiJoin}
         ${cond ? ` AND ${cond}` : ''}
         LIMIT $${params.length}::int`, params };
    }

    // ★ §11-5 #12 — 상품 조회 후 N일 미구매 (장바구니와 같은 창 구조, 구매 부재는 양 문 합산)
    case 'cdp.browse_no_purchase': {
      const d = clampInt(filters.browse_days, 3, 1, 30);
      const h = d * 24;
      const params: any[] = [companyId, String(h)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays, reentry.lineageIds) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
      params.push(limitParam(limit));
      return { sql: `WITH viewed AS (
           SELECT DISTINCT ON (customer_id) customer_id, occurred_at AS viewed_at
           FROM cdp_events
           WHERE company_id = $1::uuid
             AND event_name = 'product_view'
             AND customer_id IS NOT NULL
             AND occurred_at >= NOW() - (($2::int + 24) || ' hours')::interval
             AND occurred_at <= NOW() - ($2 || ' hours')::interval
           ORDER BY customer_id, occurred_at DESC
         )
         SELECT v.customer_id
         FROM viewed v
         INNER JOIN customers c ON c.id = v.customer_id AND c.company_id = $1::uuid
         WHERE NOT EXISTS (
           SELECT 1 FROM cdp_events e2
           WHERE e2.company_id = $1::uuid AND e2.customer_id = v.customer_id
             AND ${orderAttemptSql('e2')} AND e2.occurred_at > v.viewed_at   -- ★ 1027 K1-9 결제 전 주문도 주문 시도
         )
           AND NOT EXISTS (
             SELECT 1 FROM ${LEDGER_PURCHASES_SQL} p2   -- ★ 2026-11-04 C102 G1(CT-D6)
             WHERE p2.company_id = $1::uuid AND p2.customer_id = v.customer_id
               AND p2.purchase_date IS NOT NULL
               AND p2.purchase_date > (v.viewed_at AT TIME ZONE 'Asia/Seoul')
           )
           AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
         ${antiJoin}
         ${cond ? ` AND ${cond}` : ''}
         LIMIT $${params.length}::int`, params };
    }

    // ★ §11-5 #6 — 구매 주기 이탈: 그 고객 평균 구매 간격 × 계수를 넘겼다 (구매 3건 이상만 성립 — §3-1).
    //   이력은 양 문 합산. 간격 산술은 epoch 초(버전 무관). 반복 제어 = 재진입 안티조인 + 이관 유예 + 상한.
    case 'customer.cycle_lapsed': {
      const factor = Math.max(1.1, Math.min(5, Number(filters.cycle_factor) || 1.5));
      const params: any[] = [companyId, String(factor)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays, reentry.lineageIds) : '';
      const grace = buildIntakeGraceClause('c', params, graceDays);
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
      params.push(limitParam(limit));
      return { sql: `WITH hist AS (
           SELECT u.customer_id,
                  EXTRACT(EPOCH FROM MIN(u.d)) AS first_e,
                  EXTRACT(EPOCH FROM MAX(u.d)) AS last_e,
                  COUNT(*)::int AS cnt
             FROM (
               -- ★ 2026-11-04 C99 — 이력 = 두 문 사실(CT-D2 · 같은 구매 한 번 · 몰 = 분 단위 · 원장 = 그날 0시).
               --   옛: 두 문을 분 단위로 합쳐 겹침을 뺐다(원장은 날짜 0시라 몰 주문과 같은 분이 아니어서 같은 구매가 두 번 셈해졌다).
               SELECT DISTINCT f.customer_id, date_trunc('minute', f.at) AS d
                 FROM (${purchaseFactsSql({ companyRef: '$1::uuid' })}) f
             ) u
            GROUP BY u.customer_id
           HAVING COUNT(*) >= 3
         )
         SELECT c.id AS customer_id
         FROM hist h
         INNER JOIN customers c ON c.id = h.customer_id AND c.company_id = $1::uuid
         WHERE (EXTRACT(EPOCH FROM NOW()) - h.last_e) > ((h.last_e - h.first_e) / GREATEST(h.cnt - 1, 1)) * $2::float
           AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
         ${antiJoin}
         ${grace ? ` AND ${grace}` : ''}
         ${cond ? ` AND ${cond}` : ''}
         ORDER BY h.last_e DESC
         LIMIT $${params.length}::int`, params };
    }

    // ★ §11-5 #7 — 등급: 원장 state(이전 등급)와 현재 등급을 **서열로 비교**해 올라간 사람만 진입.
    //   state 행이 없는 사람(기준선 이후 신규 관측)은 대상이 아니다 — 변동이 아니라 최초 관측이다.
    //   기준선(seedGradeStateForJourney)이 없는 미리보기는 판정 불가 — 추정하지 않는다.
    //
    // ⛔ 2026-08-02 Harold 확정 — **상승만 발화한다.** 하락 통지는 마케팅이 아니라 나쁜 소식 통지다.
    //   옛 판정은 `state_value IS DISTINCT FROM grade`라 방향을 못 가려 **떨어진 고객에게도 축하가 나갔다.**
    //   서열은 회사가 한 번 확인한 표(customer_grade_ranks)가 유일한 근거다 — 우리가 등급 사전을 갖지 않는다.
    //   ⛔ 양쪽 중 하나라도 표에 없거나 순서 없음(NULL)이면 **제외**한다. 모르는 값을 추측해 넣으면 그 순간 오발송이다.
    //   ⛔ 같은 순위(같은 급)는 상승이 아니다 — 이름만 바뀐 이동으로 축하가 나가지 않는다.
    case 'customer.grade_changed': {
      if (!journeyId) return null;
      const params: any[] = [companyId, journeyId];
      const antiJoin = reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays, reentry.lineageIds) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
      params.push(limitParam(limit));
      // ⛔ 2026-08-02 Codex — **최신 고객행을 먼저 확정한 뒤** 상승 조건을 건다.
      //   WHERE가 DISTINCT ON보다 먼저 걸리면, 같은 번호의 최신 행이 하락이라 걸러졌을 때
      //   **오래된 중복행(옛 상위 등급)이 대신 뽑혀 하락한 사람에게 축하가 나간다.**
      // 42703 = state_value 컬럼 미마이그레이션 / 42P01 = 등급 서열표 미생성 = 둘 다 0건(판정 근거가 없는데 보내는 것보다 안 보내는 쪽이 안전 · 돌리는 자리 runTargetSql)
      return {
        sql: `WITH latest AS (
             SELECT DISTINCT ON (c.phone) c.*
               FROM customers c
              WHERE c.company_id = $1::uuid AND COALESCE(c.phone, '') <> ''
              ORDER BY c.phone, c.created_at DESC
           )
           SELECT s.customer_id FROM (
             SELECT c.id AS customer_id
               FROM latest c
               INNER JOIN journey_entry_ledger l
                       ON l.journey_id = $2::uuid AND l.company_id = c.company_id
                      AND l.phone = c.phone AND l.kind = 'state'
               INNER JOIN customer_grade_ranks rn
                       ON rn.company_id = c.company_id AND rn.grade_value = c.grade
               INNER JOIN customer_grade_ranks ro
                       ON ro.company_id = c.company_id AND ro.grade_value = l.state_value
              WHERE COALESCE(c.grade, '') <> ''
                AND rn.rank_order IS NOT NULL
                AND ro.rank_order IS NOT NULL
                AND rn.rank_order > ro.rank_order
                AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
                ${antiJoin}
                ${cond ? ` AND ${cond}` : ''}
           ) s
           LIMIT $${params.length}::int`,
        params,
        zeroOnMissingSchema: true,
      };
    }

    // 5. 생일 (D-N): NOW + N days의 MM-DD가 customers.birth_month_day 또는 birth_date와 일치
    // ★ 2026-09-27 한줄로 V2 R425 — 기준일 = KST 오늘(옛: UTC 날짜) · 2/29생은 평년엔 2/28에 진입(옛: 평년엔 영영 못 들어왔다).
    case 'customer.birthday_approaching': {
      const days = Number(filters.days_before || 7);
      const birthdayTarget = `(${KST_TODAY_DATE_SQL} + ($2 || ' days')::interval)`;
      const birthdayTargetMd = `TO_CHAR(${birthdayTarget}, 'MM-DD')`;
      const birthdayLeapMd = `CASE WHEN TO_CHAR(${birthdayTarget}, 'MM-DD') = '02-28' AND TO_CHAR(${birthdayTarget} + INTERVAL '1 day', 'MM-DD') = '03-01' THEN '02-29' END`;
      const params: any[] = [companyId, String(days)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays, reentry.lineageIds) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
      params.push(limitParam(limit));
      return { sql: `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
           AND (
             (c.birth_month_day IS NOT NULL AND c.birth_month_day IN (${birthdayTargetMd}, ${birthdayLeapMd}))
             OR
             (c.birth_date IS NOT NULL AND TO_CHAR(c.birth_date, 'MM-DD') IN (${birthdayTargetMd}, ${birthdayLeapMd}))
           )
           ${antiJoin}
           ${cond ? ` AND ${cond}` : ''}
         LIMIT $${params.length}::int`, params };
    }

    // 8. 포인트 소멸 임박 (Phase 8): points 임계 + (미사용 또는 연 단위 소멸일 D-N). 둘 다 공통 안전필터.
    case 'customer.points_expiring': {
      const cfg = resolvePointsExpiringConfig(filters);
      const params: any[] = [companyId, String(cfg.pointsMin)];
      let edgeClause: string;
      if (cfg.mode === 'annual_date') {
        if (!cfg.expiryMonthDay) return null;  // 소멸일 미설정 = 발송 0 (안전)
        params.push(String(cfg.daysBefore));   // $3
        params.push(cfg.expiryMonthDay);       // $4
        edgeClause = `TO_CHAR((${KST_TODAY_DATE_SQL} + ($3 || ' days')::interval), 'MM-DD') = $4`;
      } else {
        params.push(String(cfg.inactiveDays));  // $3
        edgeClause = `(c.recent_purchase_date IS NULL OR c.recent_purchase_date < (${KST_TODAY_DATE_SQL} - ($3 || ' days')::interval))`;
      }
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays, reentry.lineageIds) : '';
      // 이관 유예 — inactivity 모드는 최근구매일 기반이라 이관 배치가 통째로 걸린다.
      const grace = buildIntakeGraceClause('c', params, graceDays);
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
      params.push(limitParam(limit));
      return { sql: `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
           AND c.points IS NOT NULL AND c.points >= $2::int
           AND ${edgeClause}
           ${antiJoin}
           ${grace ? ` AND ${grace}` : ''}
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.points DESC
         LIMIT $${params.length}::int`, params };
    }

    // ★ 2026-10-20 V.3 §18 — 앞 여정을 마치면(미리보기 · 인원 = 최근 7일 마친 고객 · 라이브 = 감시가 표식과 함께 selectAfterJourneyCandidates 직접).
    //   뒤 여정 id 를 넘기지 않는다 — 넘기면 기준 시각(켠 시각)이 비어 있는 초안은 늘 0명으로 센다(인원 미리 세기 = 「약」 표시).
    case 'journey.after':
      return afterJourneyTargetQuery(companyId, filters, limit, undefined, undefined, scopeSql, consent);

    // 7. 자유여정(custom) — audience(customer_conditions) + 안전필터 + 미진입(execution 안티조인) 고객만.
    //   조건 없으면 전체 활성 고객(브로드캐스트). 진입한 고객 제외 → 폴마다 미진입분만, 각 1회.
    case 'custom': {
      const params: any[] = [companyId];
      let dedupClause = '';
      if (journeyId) {
        // ★ 2026-09-30 V2 5차 — 새 판은 옛 판이 이미 보낸 고객을 다시 받지 않는다(계보 전체 · 계보 없으면 옛 문장 그대로).
        const lineage = reentry?.lineageIds && reentry.lineageIds.length > 1 ? reentry.lineageIds : null;
        params.push(lineage || journeyId);
        dedupClause = lineage
          ? `AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = ANY($${params.length}::uuid[]) AND je.customer_id = c.id)`
          : `AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $${params.length}::uuid AND je.customer_id = c.id)`;
      }
      // 이관 유예 — 상시 세그먼트는 조건 맞는 전원이 들어오므로 이관 배치가 그대로 폭발한다.
      const grace = buildIntakeGraceClause('c', params, graceDays);
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
      params.push(limitParam(limit));
      return { sql: `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
           ${dedupClause}
           ${grace ? ` AND ${grace}` : ''}
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.id
         LIMIT $${params.length}::int`, params };
    }

    default:
      return null;
  }
}

/**
 * ★ 2026-10-20 여정 V.3 §18 — 앞 여정을 마친 고객(뒤에 붙인 여정의 후보).
 *   앞 여정 계보(after_root)에서 결과(after_outcome)로 끝난 실행 · 마친 뒤 7일 안 · 기준 시각 뒤(journeyId 가 있으면 뒤 여정의 last_event_cursor
 *   = 켠 · 붙인 · 다시 켠 시각 · 비어 있으면 0건 = 소급 0 / 없으면 미리보기라 최근 7일).
 *   한 번 마침 = 한 번 진입: 뒤 여정 계보에 그 실행 id 표식(__entry.src = 'after' · key)이 있으면 뺀다.
 *   동의 · 범위 · 조건 · 재진입은 다른 시작 사건과 같은 조각. 고객마다 가장 먼저 마친 실행 하나(다음 회차가 다음 것을 본다).
 */
export async function selectAfterJourneyCandidates(
  companyId: string,
  triggerFilters: Record<string, any>,
  limit: number,
  journeyId?: string,
  reentry?: { allowReentry: boolean; cooldownDays: number; lineageIds?: string[] },
  scopeSql = '',
  consent?: JourneyConsent,
  sinceCursor?: string | null,
): Promise<Array<{ customerId: string; afterExecId: string }>> {
  const q = await afterJourneyTargetQuery(companyId, triggerFilters, limit, journeyId, reentry, scopeSql, consent, sinceCursor);
  if (!q) return [];
  return (await query(q.sql, q.params)).rows.map((x: any) => ({ customerId: String(x.customer_id), afterExecId: String(x.after_exec_id) }));
}

/** ★ 2026-11-02 §16 G2 — 앞 여정 뒤 대상 SQL 한 벌(옛 selectAfterJourneyCandidates 본문 그대로 · 고르는 칸 = customer_id · after_exec_id) */
export async function afterJourneyTargetQuery(
  companyId: string,
  triggerFilters: Record<string, any>,
  limit: number | null,
  journeyId?: string,
  reentry?: { allowReentry: boolean; cooldownDays: number; lineageIds?: string[] },
  scopeSql = '',
  consent?: JourneyConsent,
  /** 감시 = 뒤 여정 기준 시각(last_event_cursor::text · 넣기가 같은 값으로 다시 확인한다). journeyId 가 있는데 없으면 0건(소급 0). */
  sinceCursor?: string | null,
): Promise<TargetQuery | null> {
  const filters = triggerFilters || {};
  const cfg = readAfterConfig(filters);
  if (!cfg) return null;
  if (journeyId && !sinceCursor) return null;
  const lineage = await lineageColumnsReady();
  const params: any[] = [companyId, cfg.root, outcomeStatuses(cfg.outcome), String(AFTER_JOURNEY_WINDOW_DAYS)];
  const rootMatch = lineage ? `(aj.id = $2::uuid OR aj.lineage_id = $2::uuid)` : `aj.id = $2::uuid`;
  let since = '';
  let dedup = '';
  let reentryClause = '';
  if (journeyId) {
    params.push(String(sinceCursor));
    since = `AND ae.completed_at >= $${params.length}::timestamptz`;
    const bLineage = reentry?.lineageIds && reentry.lineageIds.length > 1 ? reentry.lineageIds : [journeyId];
    params.push(bLineage);
    // 표식 안티조인 + 지금 뒤 여정 계보에서 진행 중인 고객 제외(넣기에서 어차피 빠질 후보가 상한 판정을 채워 여정을 멈추지 않게 · Codex 적대 A 1R).
    //   진행 중이라 빠진 고객의 마침은 표식이 안 남아, 그 실행이 끝난 뒤 7일 창 안에서 다시 후보가 된다.
    dedup = `AND NOT EXISTS (SELECT 1 FROM journey_executions be
                        WHERE be.journey_id = ANY($${params.length}::uuid[])
                          AND be.entry_event_properties->'__entry'->>'src' = 'after'
                          AND be.entry_event_properties->'__entry'->>'key' = ae.id::text)
          AND NOT EXISTS (SELECT 1 FROM journey_executions ba
                        WHERE ba.journey_id = ANY($${params.length}::uuid[]) AND ba.customer_id = c.id AND ba.status = 'active')`;
    if (reentry) reentryClause = buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays, reentry.lineageIds);
  }
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
  params.push(limitParam(limit));
  return { sql: `SELECT s.customer_id, s.after_exec_id FROM (
       SELECT DISTINCT ON (c.id) c.id AS customer_id, ae.id AS after_exec_id, ae.completed_at
         FROM journey_executions ae
         JOIN journeys aj ON aj.id = ae.journey_id
         JOIN customers c ON c.id = ae.customer_id
        WHERE aj.company_id = $1::uuid AND ${rootMatch}
          AND ae.status = ANY($3::text[])
          AND ae.completed_at > NOW() - ($4 || ' days')::interval
          ${since}
          AND c.company_id = $1::uuid
          AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
          ${dedup}
          ${reentryClause}
          ${cond ? ` AND ${cond}` : ''}
        ORDER BY c.id, ae.completed_at ASC
     ) s
     ORDER BY s.completed_at ASC
     LIMIT $${params.length}::int`, params };
}

/**
 * ★ 2026-06-30 여정 일반화 — date_anchor/one_shot 대상(audience) 추출.
 *   안전필터 항상 + (옵션) points_min + (옵션) customer_conditions. execution 안티조인 없음
 *   (날짜축은 step·날짜 단위 발송이라 journey_anchor_dispatch가 멱등을 담당 — execution dedup이 D-3 대상을 빼면 안 됨).
 *   no_target_auto_relax: 0건이면 빈 배열(자동완화 없음). 회사 격리 company_id 필수.
 *
 * ★ 2026-11-01 B-1101-7 ①②(뿌리 R40 · Codex C92 2R) — 날짜축 · 한 번 보내기 대상 SQL 한 벌(LIMIT · 순서 없음).
 *   넣기는 이 SQL 을 `INSERT … SELECT` 한 문장에 넣는다 = 한 시점의 대상 전원(10만 자르기 · 묶음 사이 기준 바뀜 0).
 *   params 는 $1(회사) 부터 · 호출부는 뒤에 자기 값을 붙인다.
 */
export function anchorAudienceSql(
  companyId: string,
  triggerFilters: Record<string, any>,
  scopeSql = '',
  consent?: JourneyConsent,
): { sql: string; params: any[] } {
  const f = triggerFilters || {};
  const params: any[] = [companyId];
  let pointsClause = '';
  const pmin = Number(f.points_min);
  if (Number.isFinite(pmin) && pmin > 0) {
    params.push(String(Math.floor(pmin)));
    pointsClause = `AND c.points IS NOT NULL AND c.points >= $${params.length}::int`;
  }
  const cond = applyCustomerConditions(f.customer_conditions || [], f.logic || 'AND', params, consent);
  return {
    sql: `SELECT c.id AS customer_id FROM customers c
     WHERE c.company_id = $1::uuid
       AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
       ${pointsClause}
       ${cond ? ` AND ${cond}` : ''}`,
    params,
  };
}

/** ★ 2026-11-02 §16 G2 — 날짜 기준 · 한 번 보내기 대상 전원 수(같은 SQL 한 벌 · 옛 [타겟 확인] = 1만 + 1 목록으로 셌다) */
export async function countAnchorAudience(
  companyId: string,
  triggerFilters: Record<string, any>,
  scopeSql = '',
  consent?: JourneyConsent,
): Promise<number> {
  const a = anchorAudienceSql(companyId, triggerFilters, scopeSql, consent);
  const r = await query(`SELECT COUNT(*)::int AS n FROM (${a.sql}) t`, a.params);
  return Number(r.rows[0]?.n || 0);
}

export async function selectAnchorAudienceIds(
  companyId: string,
  triggerFilters: Record<string, any>,
  limit: number,
  scopeSql = '',   // ★ 2026-09-27 S5-04 — 여정 작성자 분류코드 범위
  consent?: JourneyConsent,   // ★ 2026-10-02 수신동의 조각(mall-consent journeyOwnerConsent · 없으면 고객 행)
): Promise<string[]> {
  const a = anchorAudienceSql(companyId, triggerFilters, scopeSql, consent);
  const r = await query(`${a.sql}
     ORDER BY c.id
     LIMIT $${a.params.length + 1}::int`, [...a.params, String(limit)]);
  return r.rows.map((x: any) => x.customer_id);
}

/**
 * ★ 2026-09-30 여정 V2 3차 — 최근 7일 고른 상품을 산 고객(미리보기 · 대상 인원 추정). 상품 · 문이 없으면 0명(만들 수 없는 여정).
 * 안전 필터 · 대상 조건 · 작성자 범위는 다른 트리거와 같다.
 */
async function productBuyersTargetQuery(
  companyId: string,
  filters: Record<string, any>,
  limit: number | null,
  scopeSql = '',
  consent?: JourneyConsent,   // ★ 2026-10-02 수신동의 조각(mall-consent journeyOwnerConsent · 없으면 고객 행)
): Promise<TargetQuery | null> {
  let pf;
  try { pf = normalizeProductFilters(filters); } catch { return null; }
  const params: any[] = [companyId, pf.product_keys];
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
  params.push(limitParam(limit));
  const buyers = pf.door === 'mall'
    ? `SELECT DISTINCT e.customer_id FROM cdp_events e, ${mallItemsSql('e')} it
        WHERE e.company_id = $1::uuid AND ${netPurchaseSql('e')} AND e.customer_id IS NOT NULL   -- ★ 2026-11-02 CT-J3
          AND e.occurred_at >= NOW() - INTERVAL '7 days'
          AND ${mallItemKeySql('it')} = ANY($2::text[])`
    : `SELECT DISTINCT p.customer_id FROM ${LEDGER_PURCHASES_SQL} p   -- ★ 2026-11-04 C102 G1(CT-D6)
        WHERE p.company_id = $1::uuid AND p.customer_id IS NOT NULL AND p.purchase_date IS NOT NULL
          AND p.purchase_date >= ((NOW() AT TIME ZONE 'Asia/Seoul') - INTERVAL '7 days')
          AND ${ledgerProductKeySql('p')} = ANY($2::text[])`;
  return { sql: `SELECT b.customer_id FROM (${buyers}) b
       INNER JOIN customers c ON c.id = b.customer_id AND c.company_id = $1::uuid
      WHERE ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
        ${cond ? ` AND ${cond}` : ''}
      LIMIT $${params.length}::int`, params };
}

// ★ Phase 3: 이벤트 커서 — cursorStart+windowEnd 주어지면(라이브) 그 창의 이벤트 전수,
//   없으면(미리보기) 최근 7일 추정. 라이브는 trigger-watcher가 커서/윈도우를 넘기고 처리 후 커서 전진.
export async function selectCdpEvent(
  companyId: string,
  eventName: string,
  filters: Record<string, any>,
  limit: number,
  cursorStart?: Date | string | null,
  windowEnd?: Date | string | null,
  scopeSql = '',
  consent?: JourneyConsent,
): Promise<string[]> {
  const q = await cdpEventTargetQuery(companyId, eventName, filters, limit, cursorStart, windowEnd, scopeSql, consent);
  return (await query(q.sql, q.params)).rows.map((x: any) => x.customer_id);
}

/** ★ 2026-11-02 §16 G2 — 사건 갈래 대상 SQL 한 벌(옛 selectCdpEvent 본문 그대로) */
export async function cdpEventTargetQuery(
  companyId: string,
  eventName: string,
  filters: Record<string, any>,
  limit: number | null,
  cursorStart?: Date | string | null,
  windowEnd?: Date | string | null,
  scopeSql = '',   // ★ 2026-09-27 S5-04
  consent?: JourneyConsent,   // ★ 2026-10-02 수신동의 조각(mall-consent journeyOwnerConsent · 없으면 고객 행)
): Promise<TargetQuery> {
  // ★ 2026-11-04 C99 T4 — 구매 미리보기(커서 없음 = 최근 7일) = 두 문 사실의 최근 7일 고객(CT-D2 · 같은 구매 한 번).
  //   옛: 자사몰 사건만 셌다(매장만 회사 = 미리보기 0명 · 두 문 회사 = 매장 구매 고객 빠짐). 라이브 진입은 커서 경로(T3) 그대로.
  if (eventName === 'purchase' && !(cursorStart && windowEnd)) {
    const params: any[] = [companyId];
    const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
    params.push(limitParam(limit));
    return { sql: `SELECT DISTINCT f.customer_id FROM (${purchaseFactsSql({ companyRef: '$1::uuid', sinceAt: `NOW() - INTERVAL '7 days'` })}) f
       INNER JOIN customers c ON c.id = f.customer_id AND c.company_id = $1::uuid
       WHERE ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
         ${cond ? ` AND ${cond}` : ''}
       LIMIT $${params.length}::int`, params };
  }
  const params: any[] = [companyId, eventName];
  let timeClause: string;
  if (cursorStart && windowEnd) {
    params.push(cursorStart);
    params.push(windowEnd);
    timeClause = `e.occurred_at > $${params.length - 1} AND e.occurred_at <= $${params.length}`;
  } else {
    timeClause = `e.occurred_at >= NOW() - INTERVAL '7 days'`;
  }
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
  params.push(limitParam(limit));
  return { sql: `SELECT DISTINCT e.customer_id FROM cdp_events e
     INNER JOIN customers c ON c.id = e.customer_id AND c.company_id = $1::uuid
     WHERE e.company_id = $1::uuid
       AND ${cdpEventNameMatchSql('e', '$2')}   -- ★ 2026-11-02 구매 이름이면 결제된 구매(3-4 ① · CT-J3)
       AND e.customer_id IS NOT NULL
       AND ${timeClause}
       AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
       ${cond ? ` AND ${cond}` : ''}
     LIMIT $${params.length}::int`, params };
}

// ★ Fix #11 (2026-06-05): cdp 커서용 — 커서 이후 창의 이벤트를 chunk만큼(안전필터+조건).
//   distinct가 아니라 행을 그대로 반환 → 호출부가 실제로 본 마지막 행까지만 커서를 전진(LIMIT 누락 정정).
// ★ 2026-08-01 §11-3: 커서 축을 occurred_at(발생) → created_at(도착)으로 전환.
//   배치로 늦게 도착한 데이터, 익명→회원 소급으로 나중에 연결된 데이터가 커서 뒤에 떨어져 영영 안 잡히던 구멍을 닫는다.
//   cursorEventId가 오면 (created_at, id) 행 비교로 동시각 타이까지 가른다 — 없으면 시각만(컬럼 미마이그레이션 환경).
// ★ 2026-08-10: 발생 시각 창(maxAgeHours)을 원장 문과 **같은 규약**으로 건다.
//   커서는 도착 축이라 소급 적재는 전부 커서 앞에 선다 — 막는 것은 발생 시각뿐이다(원장 문 주석과 같은 이유).
//   그동안 이벤트 문에만 창이 없었던 근거는 "자사몰 주문은 즉시 들어온다"였는데, 그 전제는 이미 깨져 있다:
//     고도몰 `/connect`가 90일 백필을 돌려 과거 주문을 통째로 지금 적재한다(godo-client.backfillGodoOrders).
//     그 회사에 활성 구매 여정이 있으면 90일 치가 "방금 구매"로 진입한다 — 실연동 고객사가 0이라 미발화였을 뿐이다.
//   실시간 웹훅(카페24·자체호스팅)은 발생 시각이 곧 지금이라 이 창에 걸리지 않는다(회귀 0).
//   NULL·미래 값 처리는 여기서 하지 않는다 — `cdp_events.occurred_at`은 NOT NULL이고 적재 시점에
//   미래 클램프를 이미 거친다(cdp-events.clampOccurredAt). 여기서 다시 자르면 판정이 두 벌이 된다.
export interface CdpCursorQuery {
  /** 커서 시각. */
  at: Date | string;
  /** 동시각 타이브레이커. null이면 시각만 비교한다. */
  eventId?: string | null;
  /**
   * 커서 축. `journeys.last_event_cursor_id` 컬럼이 아직 없는 환경은 `occurred_at`(옛 축)을 유지한다.
   * 옛 커서 값은 발생 시각이라, 컬럼이 생기기 전에 도착 축으로 읽으면 이미 처리한 이벤트를 다시 잡는다.
   * DDL(컬럼 추가 + 커서 재기준)이 끝난 뒤에만 `created_at`으로 넘어간다.
   */
  axis: 'created_at' | 'occurred_at';
}

/**
 * ★ 2026-10-27 자사몰 대비 K1-2 — 그 사건 id 로 이 여정 계보에 이미 트리거 진입했는가(EXISTS 조각).
 *   사건 행 단계(selectCdpEventRowsForCursor) · 잠금 안 다시 보기(journey-trigger-watcher 진입 반복문) 두 겹이 같은 조각을 쓴다.
 *   진입 표식 = 트리거 진입 반복문이 남기는 entry_event_properties.__entry = { src: 'trigger', key: 사건 id }(0929 부터).
 */
export function triggerEntryUsedSql(lineageRef: string, customerRef: string, keyRef: string): string {
  return `EXISTS (SELECT 1 FROM journey_executions tu
                   WHERE tu.journey_id = ANY(${lineageRef}::uuid[]) AND tu.customer_id = ${customerRef}
                     AND tu.entry_event_properties->'__entry'->>'src' = 'trigger'
                     AND tu.entry_event_properties->'__entry'->>'key' = ${keyRef})`;
}

export async function selectCdpEventRowsForCursor(
  companyId: string,
  eventName: string,
  filters: Record<string, any>,
  cursor: CdpCursorQuery,
  windowEnd: Date | string,
  maxAgeHours: number,
  chunkLimit: number,
  scopeSql = '',   // ★ 2026-09-27 S5-04 — 커서 창 안에서 거른다(범위 밖 행은 커서가 지나가며 소비된다)
  consent?: JourneyConsent,   // ★ 2026-10-02 수신동의 조각(mall-consent journeyOwnerConsent · 없으면 고객 행)
  /** ★ 1027 K1-2 — 이 여정 계보(있으면 그 계보에서 이미 진입에 쓰인 사건 행을 뺀다 · 승격으로 커서를 다시 지나는 사건) */
  entryLineage?: string[],
  /**
   * ★ 2026-11-04 C99 CT-D5 — 구매 계열(상품 재구매 제외) = 이 계보에 같은 고객 · 같은 날 · 매장 문으로 이미 진입한 행은 후보가 아니다
   *   (후보가 태어나는 자리에서 거른다 = 대량 차단 · 진입 · 커서가 같은 후보를 본다 · 거른 행도 커서는 지나간다 · 설계서 §4 T3).
   */
  crossDoorOwned = false,
): Promise<CdpEventRow[]> {
  // 축은 화이트리스트 두 값뿐 — 문자열이 그대로 SQL에 들어가므로 여기서 닫는다(주입 표면 0).
  const axis = cursor.axis === 'created_at' ? 'created_at' : 'occurred_at';
  const params: any[] = [companyId, eventName, cursor.at, windowEnd, String(maxAgeHours)];
  let cursorClause: string;
  if (axis === 'created_at' && cursor.eventId) {
    params.push(cursor.eventId);
    cursorClause = `(e.created_at, e.id) > ($3::timestamptz, $${params.length}::uuid)`;
  } else {
    cursorClause = `e.${axis} > $3::timestamptz`;
  }
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
  let usedClause = '';
  if (entryLineage && entryLineage.length > 0) {
    params.push(entryLineage);
    usedClause = `AND NOT ${triggerEntryUsedSql(`$${params.length}`, 'e.customer_id', 'e.id::text')}`;
    if (crossDoorOwned) usedClause += ` AND NOT ${crossDoorEntryOwnedSql(`$${params.length}`, 'e.customer_id', `'mall'`, mallEntryDaySql('e'))}`;
  }
  params.push(String(chunkLimit));
  const r = await query(
    `SELECT e.id, e.customer_id, e.created_at, e.occurred_at,
            e.created_at::text AS created_at_raw, e.occurred_at::text AS occurred_at_raw,
            ${mallEntryDaySql('e')} AS entry_day,
            e.properties FROM cdp_events e
     INNER JOIN customers c ON c.id = e.customer_id AND c.company_id = $1::uuid
     WHERE e.company_id = $1::uuid
       AND ${cdpEventNameMatchSql('e', '$2')}   -- ★ 2026-11-02 진입 커서 = 결제된 구매(3-4 ① · CT-J3)
       AND e.customer_id IS NOT NULL
       AND ${cursorClause}
       AND e.${axis} <= $4::timestamptz
       AND e.occurred_at >= e.created_at - ($5 || ' hours')::interval
       AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
       ${cond ? ` AND ${cond}` : ''}
       ${usedClause}
     ORDER BY e.${axis} ASC, e.id ASC
     LIMIT $${params.length}::int`,
    params,
  );
  return r.rows.map((x: any) => ({
    customerId: x.customer_id,
    eventId: x.id,
    createdAt: x.created_at,
    occurredAt: x.occurred_at,
    // 커서 전진용 DB 원문 — JS Date 왕복은 마이크로초를 절사해 마지막 밀리초 묶음이 재진입한다(2026-08-02).
    createdAtRaw: x.created_at_raw ?? null,
    occurredAtRaw: x.occurred_at_raw ?? null,
    properties: x.properties ?? null,
    entryDay: x.entry_day ?? null,
  }));
}

// ★ 2026-08-01 §11-4 — 구매 원장(purchases) 커서. 싱크에이전트로 들어온 구매가 이 문이다.
//   이벤트 커서와 **같은 규약**(도착 축 + 행 id 타이브레이커 + 실제로 본 마지막 행까지만 전진)이라
//   planCdpCursorBatch를 그대로 재사용한다. 반환 형태도 CdpEventRow로 맞춘다.
//
//   시간대: `purchases.purchase_date`·`created_at`은 **timezone 없는 KST 적재값**이다(database/schema.sql).
//     - 커서·창 비교는 우리 timestamptz를 세션 시간대 wall-clock으로 바꿔 컬럼과 같은 기준에 놓는다
//       (컬럼 쪽에 변환을 걸면 인덱스를 못 탄다).
//     - JS로 돌려줄 때만 timestamptz로 되돌린다 — 커서 컬럼이 timestamptz라 축이 섞이면 안 된다.
//
//   과거분 소급 차단 = `purchase_date` 창. 도착 축으로는 못 막는다(이관은 오늘 도착한다).
export async function selectPurchaseLedgerRowsForCursor(
  companyId: string,
  filters: Record<string, any>,
  cursor: { at: Date | string; rowId?: string | null },
  windowEnd: Date | string,
  maxAgeHours: number,
  chunkLimit: number,
  scopeSql = '',   // ★ 2026-09-27 S5-04
  consent?: JourneyConsent,   // ★ 2026-10-02 수신동의 조각(mall-consent journeyOwnerConsent · 없으면 고객 행)
  /** ★ 2026-11-04 C99 CT-D5 — 구매 계열(상품 재구매 제외) = 이 계보에 같은 고객 · 같은 날 · 자사몰 문으로 이미 진입한 행은 후보가 아니다. */
  crossDoorLineage?: string[],
): Promise<CdpEventRow[]> {
  const params: any[] = [companyId, cursor.at, windowEnd, String(maxAgeHours)];
  let cursorClause: string;
  if (cursor.rowId) {
    params.push(cursor.rowId);
    cursorClause = `(p.created_at, p.id) > (($2::timestamptz AT TIME ZONE current_setting('TimeZone')), $${params.length}::uuid)`;
  } else {
    cursorClause = `p.created_at > ($2::timestamptz AT TIME ZONE current_setting('TimeZone'))`;
  }
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params, consent);
  let ownedClause = '';
  if (crossDoorLineage && crossDoorLineage.length > 0) {
    params.push(crossDoorLineage);
    ownedClause = `AND NOT ${crossDoorEntryOwnedSql(`$${params.length}`, 'p.customer_id', `'ledger'`, ledgerEntryDaySql('p'))}`;
  }
  params.push(String(chunkLimit));
  const r = await query(
    `SELECT p.id,
            p.customer_id,
            (p.created_at AT TIME ZONE current_setting('TimeZone')) AS arrived_at,
            (p.created_at AT TIME ZONE current_setting('TimeZone'))::text AS arrived_at_raw,
            (p.purchase_date AT TIME ZONE 'Asia/Seoul') AS occurred_at,
            ${ledgerEntryDaySql('p')} AS entry_day,
            jsonb_strip_nulls(jsonb_build_object(
              'total_amount', ROUND(COALESCE(p.total_amount, 0))::bigint,
              'product_name', p.product_name,
              'product_code', p.product_code,
              'store_name', COALESCE(NULLIF(p.store_name, ''), p.store_code)
            )) AS properties
       FROM ${LEDGER_PURCHASES_SQL} p   -- ★ 2026-11-04 C102 G1 환불 · 반품 행은 구매 진입이 아니다(CT-D6 · 커서는 돌려준 행으로만 나아간다)
       INNER JOIN customers c ON c.id = p.customer_id AND c.company_id = $1::uuid
      WHERE p.company_id = $1::uuid
        AND p.customer_id IS NOT NULL
        AND ${cursorClause}
        AND p.created_at <= ($3::timestamptz AT TIME ZONE current_setting('TimeZone'))
        AND p.purchase_date IS NOT NULL
        AND (p.purchase_date AT TIME ZONE 'Asia/Seoul') >= (p.created_at AT TIME ZONE current_setting('TimeZone')) - ($4 || ' hours')::interval
        AND p.purchase_date <= (NOW() AT TIME ZONE 'Asia/Seoul')
        AND ${buildJourneySafetyFilter('c', consent?.isTrue)}${scopeSql}
        ${cond ? ` AND ${cond}` : ''}
        ${ownedClause}
      ORDER BY p.created_at ASC, p.id ASC
      LIMIT $${params.length}::int`,
    params,
  );
  return r.rows.map((x: any) => ({
    customerId: x.customer_id,
    eventId: x.id,
    createdAt: x.arrived_at,
    occurredAt: x.occurred_at,
    // 커서 전진용 DB 원문 — JS Date 왕복은 마이크로초를 절사해 마지막 밀리초 묶음이 재진입한다(2026-08-02).
    createdAtRaw: x.arrived_at_raw ?? null,
    properties: x.properties ?? null,
    entryDay: x.entry_day ?? null,
  }));
}

// ═══════════════════════════════════════════════════════════
// §11-5 #2·#5 — 구매 전이 자격 필터 (2026-08-02)
//   첫 구매·휴면 복귀는 같은 구매 스트림에서 "이전 구매 이력"으로 갈린다(§3-1).
//   이력은 문과 무관하게 **양쪽**(자사몰 cdp_events + 싱크 purchases 원장)을 합쳐 본다 —
//   한쪽만 보면 문을 옮긴 고객의 3년 단골이 "첫 구매"가 된다(§3-0-2와 같은 부류).
//   비교는 발생 시각 축(occurred_at / purchase_date)이고 **자기 자신(트리거 구매)은 strict < 로 제외**한다.
// ═══════════════════════════════════════════════════════════

/** 후보별 직전 구매 시각(트리거 구매 이전, 양 문 합산). 없으면 그 고객 키 자체가 결과에 없다. */
export async function selectLastPriorPurchase(
  companyId: string,
  candidates: Array<{ customerId: string; enteredAt: Date | string }>,
): Promise<Map<string, Date>> {
  if (candidates.length === 0) return new Map();
  const ids = candidates.map((c) => c.customerId);
  const ats = candidates.map((c) => c.enteredAt);
  // ★ 2026-11-04 C99 — 이전 구매 = 두 문 사실(CT-D2 · 같은 구매 한 번). 옛: 두 문을 따로 MAX 해 몰 주문과 같은 구매인 매장 줄이
  //   「이전 구매」로 잡혔다 → 휴면 복귀 · 첫 구매가 아닌 것으로 판정 → 몰 진입 0 · 매장 줄은 몰이 있어 빠짐 = 진입 0(구조체크 SC-4).
  //   원장 at = 그날 KST 0시(옛 purchase_date < 진입 KST 벽시계 와 같은 비교) · 몰 = 결제 시각.
  const r = await query(
    `WITH cand AS (
       SELECT unnest($2::uuid[]) AS customer_id, unnest($3::timestamptz[]) AS entered_at
     ),
     f AS (${purchaseFactsSql({ companyRef: '$1::uuid', customerIdsRef: '$2::uuid[]' })})
     SELECT c.customer_id,
            (SELECT MAX(f.at) FROM f WHERE f.customer_id = c.customer_id AND f.at < c.entered_at) AS last_prior
       FROM cand c`,
    [companyId, ids, ats],
  );
  const map = new Map<string, Date>();
  for (const x of r.rows as any[]) {
    if (x.last_prior != null) map.set(x.customer_id, x.last_prior);
  }
  return map;
}

// ★ 2026-06-22: 장바구니(cart_abandon)는 커서가 아니라 enqueueCandidates 경로라 진입 시점 properties를 따로 모은다.
//   cart_abandon 추출의 abandoned CTE와 동일 창·동일 최신 cart_add(DISTINCT ON occurred_at DESC)의 properties →
//   알림톡 #{상품명} 등 채움(journey-executor가 entry_event_properties로 customer에 병합).
export async function selectCartAbandonProperties(
  companyId: string,
  customerIds: string[],
  abandonHours: number,
): Promise<Record<string, Record<string, any>>> {
  if (customerIds.length === 0) return {};
  const r = await query(
    `SELECT DISTINCT ON (e.customer_id) e.customer_id, e.properties
       FROM cdp_events e
      WHERE e.company_id = $1::uuid
        AND e.event_name = 'cart_add'
        AND e.customer_id = ANY($2::uuid[])
        AND e.occurred_at >= NOW() - (($3::int + 24) || ' hours')::interval
        AND e.occurred_at <= NOW() - ($3 || ' hours')::interval
      ORDER BY e.customer_id, e.occurred_at DESC`,
    [companyId, customerIds, String(abandonHours)],
  );
  const map: Record<string, Record<string, any>> = {};
  for (const x of r.rows as any[]) {
    if (x.properties && typeof x.properties === 'object') map[x.customer_id] = x.properties;
  }
  return map;
}

/**
 * ★ 2026-11-02 설계서 3-8 · D5 — 진입 정보 = 한 함수(진입 감시 · 재진입이 부른다 · 옛: 재진입은 진입 정보 없이 넣어 포인트 목표 · 장바구니 변수가 비었다).
 *   장바구니 이탈 = 그 고객의 담은 상품 사건 · 포인트 소멸 = 진입 때 포인트(종료 신호 points_used 의 기준) · 그 밖 = 없음(undefined).
 *   진입 표식(__entry)은 넣지 않는다 — 트리거 사건 · 앞 여정 표식은 그 넣기 자리가 싣는다(재진입 행 = 표식 없음 · 생애 지도 규칙).
 */
export async function entryPropsFor(
  j: { company_id: string; trigger_event: string | null; trigger_filters?: Record<string, any> | null },
  customerIds: string[],
): Promise<Record<string, Record<string, any>> | undefined> {
  if (customerIds.length === 0) return undefined;
  if (j.trigger_event === 'cdp.cart_abandon') {
    return selectCartAbandonProperties(j.company_id, customerIds, Number((j.trigger_filters || {}).abandon_hours || 24));
  }
  if (j.trigger_event === 'customer.points_expiring') {
    const pr = await query(`SELECT id, points FROM customers WHERE id = ANY($1::uuid[]) AND company_id = $2::uuid`, [customerIds, j.company_id]);
    const out: Record<string, Record<string, any>> = {};
    for (const row of pr.rows as any[]) out[row.id] = { points_at_entry: Number(row.points) || 0 };
    return out;
  }
  return undefined;
}

// ════════════════════════════════════════════════════════════════════
// 전체 매칭 수 + 등급 분포 — 미리보기·시뮬레이션 공용 (Phase 9)
//   ★ 2026-11-02 §16 G2 — 발송과 같은 대상 SQL(buildJourneyTargetQuery)을 상한 없이 감싸 센다(countJourneyTargets · averageTargetScores).
//   옛: 그 SQL 로 10만 id 를 받아 id 목록으로 셌다(넘으면 capped). JOURNEY_COUNT_CAP 은 진입 감시 회차 몫 · 옵션 저장 판정만 쓴다.
//   grade/company_id/id = information_schema 확인 컬럼(2026-06-04).
// ════════════════════════════════════════════════════════════════════

export const JOURNEY_COUNT_CAP = 100000;

/**
 * ★ 2026-11-05 C104 G5 — 여정 진입 입력 CT(R58 · 같은 함수를 불러도 입력이 다르면 두 벌).
 *   실제 진입(진입 감시) · 옵션 dryRun · 켜진 여정 옵션 저장 상한 판정 · 시뮬레이터 · 대상 목록 · 대상 수 · 미등록 매장번호가 이 값을 그대로 넘긴다.
 *   옛: 진입 감시만 계보(lineageIds) · 재진입을 넘기고 세는 자리들은 빼거나 일부만 넘겨 「지금 맞는 N명」이 실제 진입과 달랐다(1105 접수).
 *   override = 저장 전 재진입 값(옵션 주소) · 둘 다 오면 여정 행을 읽지 않는다.
 */
export interface JourneyEntryInputs {
  reentry: { allowReentry: boolean; cooldownDays: number; lineageIds: string[] };
  scopeSql: string;
  consent: JourneyConsent | undefined;
}

export async function journeyEntryInputs(
  companyId: string,
  journeyId: string,
  override?: { allowReentry: boolean; cooldownDays: number },
): Promise<JourneyEntryInputs> {
  let reentry = override;
  if (!reentry) {
    const r = await query(`SELECT allow_reentry, reentry_cooldown_days FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [journeyId, companyId]);
    const row = r.rows[0] || {};
    reentry = { allowReentry: row.allow_reentry === true, cooldownDays: Number(row.reentry_cooldown_days || 0) };
  }
  return {
    reentry: { allowReentry: reentry.allowReentry, cooldownDays: Number(reentry.cooldownDays || 0), lineageIds: await lineageJourneyIds(journeyId) },
    scopeSql: await getJourneyOwnerScopeSql(companyId, journeyId),
    consent: await journeyOwnerConsent(companyId, journeyId),
  };
}

/**
 * ★ 2026-11-05 C104 G6 — 대상 수 · 등급 분포 + 이관 유예로 지금 빠진 수(한 SQL 한 번 훑기 = 같은 스냅숏 · Codex 설계 1R).
 *   유예를 끈 대상 SQL 위에서 가입 시각(created_at)으로 가른다 = 이관 유예 조각 buildIntakeGraceClause 와 같은 식(정수 일수).
 *   유예 대상 트리거가 아니거나 유예 0 = 그대로 센다(빠짐 0) · total = countJourneyTargets 와 같은 수.
 */
export async function countJourneyTargetsWithGrace(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  journeyId: string,
  inputs: JourneyEntryInputs,
): Promise<{ total: number; segments: SegmentBreakdown[]; graceHeld: number; graceDays: number }> {
  const filters = triggerFilters || {};
  const graceDays = isBulkStateTrigger(triggerEvent) ? resolveIntakeGraceDays(filters) : 0;
  const rows = await aggregateTargets(companyId, triggerEvent, graceDays > 0 ? { ...filters, intake_grace_days: 0 } : filters, journeyId, inputs.scopeSql, inputs.consent,
    (from, params) => {
      // 지금 대상 = 이관 유예 조각 그대로(같은 함수 · 같은 값) · 빠짐 = 그 조각이 거르는 행(가입 시각 있는 행)
      const ready = buildIntakeGraceClause('c', params, graceDays) ?? 'TRUE';
      return `SELECT COALESCE(c.grade, '일반') AS segment, COUNT(*) FILTER (WHERE ${ready})::int AS cnt, COUNT(*) FILTER (WHERE NOT (${ready}))::int AS held
                FROM ${from} GROUP BY COALESCE(c.grade, '일반')`;
    }, inputs.reentry);
  const list = rows || [];
  const readyRows = list.filter((r: any) => Number(r.cnt) > 0);
  const { total, segments } = readyRows.length > 0 ? buildSegmentBreakdown(readyRows) : { total: 0, segments: [] };
  return { total, segments, graceHeld: list.reduce((n: number, r: any) => n + (Number(r.held) || 0), 0), graceDays };
}

export interface JourneyTargetCount {
  total: number;
  segments: SegmentBreakdown[];
  capped: boolean;
}

/** 전체 매칭 수 + 등급 분포 (미리보기·시뮬레이션 공용). 발송과 같은 대상 SQL 을 전원으로 센다. */
export async function countJourneyTargetCustomers(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  journeyId?: string,
  scopeSql = '',   // ★ 2026-09-27 S5-04
  consent?: JourneyConsent,   // ★ 2026-10-02 수신동의 조각(mall-consent journeyOwnerConsent · 없으면 고객 행)
  reentry?: { allowReentry: boolean; cooldownDays: number; lineageIds?: string[] },   // ★ C104 G5 실제 진입과 같은 재진입(journeyEntryInputs)
): Promise<JourneyTargetCount> {
  // ★ 2026-11-02 §16 G2 — 발송과 같은 대상 SQL 을 전원으로 센다(옛: 10만 목록을 받아 세어 넘으면 capped · 응답 칸은 남긴다 = 늘 거짓)
  const { total, segments } = await countJourneyTargets(companyId, triggerEvent, triggerFilters, journeyId, scopeSql, consent, reentry);
  return { total, segments, capped: false };
}

/** 대상 SQL 을 상한 없이 감싸 돌린다(고객 한 사람 한 번 · 회사 범위 · 근거 표 없음 = 0명) */
async function aggregateTargets(
  companyId: string, triggerEvent: string, triggerFilters: Record<string, any>, journeyId: string | undefined, scopeSql: string, consent: JourneyConsent | undefined,
  select: (from: string, params: any[]) => string,   // params = 안쪽 문장 값의 복사본 · 바깥 조각이 값을 더할 수 있다(★ C104 G6)
  reentry?: { allowReentry: boolean; cooldownDays: number; lineageIds?: string[] },
): Promise<any[] | null> {
  const q = await buildJourneyTargetQuery(companyId, triggerEvent, triggerFilters, null, journeyId, reentry, scopeSql, consent);
  if (!q) return null;
  // $1 = 회사(모든 갈래 공통 첫 값) · 안쪽 문장의 LIMIT 값 = null = 전원
  const from = `(SELECT DISTINCT t.customer_id FROM (${q.sql}) t) tc JOIN customers c ON c.id = tc.customer_id AND c.company_id = $1::uuid`;
  const params = [...q.params];
  return runTargetSql(q, select(from, params), params);
}

/** ★ 2026-11-02 §16 G2 — 대상 전원 수 · 등급 분포(옛 id 목록 집계와 같은 식 · 상한 0) */
export async function countJourneyTargets(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  journeyId?: string,
  scopeSql = '',
  consent?: JourneyConsent,
  reentry?: { allowReentry: boolean; cooldownDays: number; lineageIds?: string[] },   // 옵션 저장 판정 = 목록과 같은 재진입 조건
): Promise<{ total: number; segments: SegmentBreakdown[] }> {
  const rows = await aggregateTargets(companyId, triggerEvent, triggerFilters, journeyId, scopeSql, consent,
    (from) => `SELECT COALESCE(c.grade, '일반') AS segment, COUNT(*)::int AS cnt FROM ${from} GROUP BY COALESCE(c.grade, '일반')`, reentry);
  if (!rows || rows.length === 0) return { total: 0, segments: [] };
  return buildSegmentBreakdown(rows);
}

/** ★ 2026-11-02 §16 G2 — 대상 전원 실데이터 평균(옛 id 목록 평균과 같은 식 · 시뮬레이터) */
export async function averageTargetScores(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  journeyId?: string,
  scopeSql = '',
  consent?: JourneyConsent,
  reentry?: { allowReentry: boolean; cooldownDays: number; lineageIds?: string[] },   // ★ C104 G5
): Promise<{ avgOrderValue: number | null; avgConversion: number | null; avgClick: number | null }> {
  const rows = await aggregateTargets(companyId, triggerEvent, triggerFilters, journeyId, scopeSql, consent,
    (from) => `SELECT AVG(c.avg_order_value) AS aov, AVG(p.purchase_likelihood) AS conv, AVG(p.click_score) AS clk
                 FROM ${from} LEFT JOIN cdp_customer_predictions p ON p.customer_id = c.id`, reentry);
  const row = rows?.[0] || {};
  const num = (v: any) => (v != null ? Number(v) : null);
  return { avgOrderValue: num(row.aov), avgConversion: num(row.conv), avgClick: num(row.clk) };
}

/**
 * ★ 2026-11-02 §16 G2 — 매장번호 회신 여정의 미등록 매장번호(대상 전원 · 실행기와 같은 판정).
 *   실행기(journey-executor 5-2) = 고객 매장번호가 있고 그 번호가 isCallbackRegistered(회사, 번호, 여정 만든 계정)가 아니면 그 고객만 실패.
 *   여기서 같은 판정을 매장번호마다 한 번 한다(옛: 켜기 확인이 10만 목록 + 켠 사람 기준 다른 판정).
 */
export async function storeCallbackExposure(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  createdBy: string | null,
  journeyId?: string,
  scopeSql = '',
  consent?: JourneyConsent,
  reentry?: { allowReentry: boolean; cooldownDays: number; lineageIds?: string[] },   // ★ C104 G5
): Promise<{ callbackUnregisteredCount: number; unregisteredDetails: Array<{ phone: string; excludedCount: number }> }> {
  const rows = await aggregateTargets(companyId, triggerEvent, triggerFilters, journeyId, scopeSql, consent,
    (from) => `SELECT btrim(c.store_phone) AS store_phone, COUNT(*)::int AS cnt FROM ${from}
                WHERE COALESCE(btrim(c.store_phone), '') <> '' GROUP BY btrim(c.store_phone)`, reentry);
  const unregisteredDetails: Array<{ phone: string; excludedCount: number }> = [];
  for (const r of rows || []) {
    if (!(await isCallbackRegistered(companyId, String(r.store_phone), createdBy || undefined))) {
      unregisteredDetails.push({ phone: normalizePhone(String(r.store_phone)) || String(r.store_phone), excludedCount: Number(r.cnt) || 0 });
    }
  }
  unregisteredDetails.sort((a, b) => b.excludedCount - a.excludedCount);
  return { callbackUnregisteredCount: unregisteredDetails.reduce((n, d) => n + d.excludedCount, 0), unregisteredDetails };
}

// ════════════════════════════════════════════════════════════════════
// customer_conditions 복합 조건 → SQL 조각 (5번 트리거 복합 조합)
//   순수(파라미터 배열에 push). journey-simulator에서 이동(Phase 9 순환 참조 제거).
// ════════════════════════════════════════════════════════════════════

// ★ 2026-06-26: store_name(매장명)/store_code(매장코드) 추가 — 여정 자연어 타겟에서
//   "매장명이 송파가락점인 회원" 같은 매장 세그먼트가 무시되고 전체 발송되던 #1 fix.
//   customers.store_name varchar(100) / store_code varchar(50) (SCHEMA.md 검증).
// ★ 2026-06-30 여정 일반화 — points 추가(날짜축/대상 조건에서 포인트를 일반 조건으로). customers.points numeric(SCHEMA 검증). 추가만 = 기존 경로 회귀 0.
// ★ 2026-09-29 여정 V2 — 허용 목록을 밖으로 꺼내 저장 · 활성화 검증(findCustomerConditionIssues)과 같은 단일 출처로 쓴다.
// ★ 2026-10-20 여정 V.3 §7-3 — 「마지막 구매 N일」(days_since_purchase) = KST 오늘 − 최근 구매일(customers.recent_purchase_date date · 휴면 추출과 같은 칸).
//   가상 칸이라 숫자 비교(>= <= > <)만 받는다. 구매 이력이 없는 고객(NULL)은 비교에서 빠진다. 「가입 N일」(created_at)은 만들지 않는다(고객 DB 를 다시 올리면 전원이 신규).
export { CUSTOMER_CONDITION_FIELDS };
export const CUSTOMER_CONDITION_OPS = ['==', '!=', '>=', '<=', '>', '<', 'in', 'not_in', 'is_null', 'not_null'] as const;
const DAYS_SINCE_PURCHASE_OPS = ['>=', '<=', '>', '<'];
const DAYS_SINCE_PURCHASE_SQL = `(${KST_TODAY_DATE_SQL} - c.recent_purchase_date)`;

export interface CustomerConditionIssue {
  index: number;
  field: string;
  op: string;
  reason: 'unknown_field' | 'unknown_op' | 'empty_value' | 'bad_shape' | 'bad_logic' | 'bad_number' | 'bad_value';
}

/**
 * ★ 2026-09-29 여정 V2 0차 ② — 대상 조건 검증(순수).
 *   추출기(applyCustomerConditions)는 모르는 필드 · 연산자를 **조용히 건너뛴다** → 조건이 빠진 만큼 대상이 넓어진다
 *   ("VIP만"이 "전 고객"이 된다). 추출기의 동작은 기존 활성 여정 보호를 위해 그대로 두고,
 *   저장 · 활성화 길목이 이 함수로 거부한다(더 보내는 쪽으로 새는 입력을 발송 전에 막는다).
 *   빈 목록 · 미지정 = 이슈 0(조건 없음은 유효한 선택이다 — 상시 여정 등).
 */
export function findCustomerConditionIssues(conditions: unknown, logic?: unknown): CustomerConditionIssue[] {
  const issues: CustomerConditionIssue[] = [];
  if (logic !== undefined && logic !== null && logic !== 'AND' && logic !== 'OR') {
    issues.push({ index: -1, field: '', op: String(logic), reason: 'bad_logic' });
  }
  if (conditions === undefined || conditions === null) return issues;
  if (!Array.isArray(conditions)) {
    issues.push({ index: -1, field: '', op: '', reason: 'bad_shape' });
    return issues;
  }
  conditions.forEach((raw: any, index: number) => {
    if (!raw || typeof raw !== 'object') {
      issues.push({ index, field: '', op: '', reason: 'bad_shape' });
      return;
    }
    const field = String(raw.field ?? '');
    const op = String(raw.op ?? '');
    if (!(CUSTOMER_CONDITION_FIELDS as readonly string[]).includes(field)) {
      issues.push({ index, field, op, reason: 'unknown_field' });
      return;
    }
    if (!(CUSTOMER_CONDITION_OPS as readonly string[]).includes(op)) {
      issues.push({ index, field, op, reason: 'unknown_op' });
      return;
    }
    if (field === 'days_since_purchase') {
      if (!DAYS_SINCE_PURCHASE_OPS.includes(op)) issues.push({ index, field, op, reason: 'unknown_op' });
      else if (raw.value === null || raw.value === '' || !Number.isFinite(Number(raw.value))) issues.push({ index, field, op, reason: 'bad_number' });
      return;
    }
    if (op === 'is_null' || op === 'not_null') return;
    const v = raw.value;
    // ★ 2026-10-23 성별 = 여성(F) · 남성(M) 두 값만(표기가 달라도 같은 코드) · 생일 달 = 1~12
    if (field === 'gender' || field === 'birth_month') {
      if (!['==', '!=', 'in', 'not_in'].includes(op) && !(field === 'birth_month' && ['>=', '<=', '>', '<'].includes(op))) {
        issues.push({ index, field, op, reason: 'unknown_op' });
        return;
      }
      const list = Array.isArray(v) ? v : [v];
      if (list.length === 0 || list.some((x) => x === undefined || x === null || String(x).trim() === '')) { issues.push({ index, field, op, reason: 'empty_value' }); return; }
      const ok = field === 'gender'
        ? list.every((x) => normalizeGenderCode(x) !== null)
        : list.every((x) => Number.isInteger(Number(x)) && Number(x) >= 1 && Number(x) <= 12);
      if (!ok) issues.push({ index, field, op, reason: field === 'gender' ? 'bad_value' : 'bad_number' });
      return;
    }
    const emptyList = (op === 'in' || op === 'not_in') && (Array.isArray(v) ? v.length === 0 : v === undefined || v === null || v === '');
    if (emptyList || v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      issues.push({ index, field, op, reason: 'empty_value' });
    }
  });
  return issues;
}

/**
 * ★ 2026-09-29 여정 V2 — AI 초안용: 쓸 수 있는 조건만 남기고 빠진 것은 **문구로 돌려준다**(조용히 버리지 않는다).
 *   저장 · 활성화는 findCustomerConditionIssues 로 거부하고, AI 생성 · 수정 결과는 이 함수로 걸러 화면에 "반영 안 됨"을 보인다.
 */
export function partitionCustomerConditions(filters: Record<string, any> | null | undefined): {
  filters: Record<string, any>;
  droppedNotices: string[];
} {
  const f: Record<string, any> = { ...(filters || {}) };
  const droppedNotices: string[] = [];
  if (f.logic !== undefined && f.logic !== 'AND' && f.logic !== 'OR') {
    droppedNotices.push('대상 조건을 묶는 방식을 알 수 없어 "모두 만족"으로 두었어요.');
    f.logic = 'AND';
  }
  if (f.customer_conditions === undefined || f.customer_conditions === null) return { filters: f, droppedNotices };
  if (!Array.isArray(f.customer_conditions)) {
    droppedNotices.push('대상 조건의 모양이 올바르지 않아 반영하지 못했어요.');
    f.customer_conditions = [];
    return { filters: f, droppedNotices };
  }
  const kept: any[] = [];
  f.customer_conditions.forEach((c: any, i: number) => {
    const issues = findCustomerConditionIssues([c]);
    // ★ 2026-10-23 성별은 표준 코드(F · M)로 저장(AI 가 「여성」으로 내도 화면 · 추출이 같은 값을 본다)
    if (issues.length === 0) kept.push(c?.field === 'gender' && c.op !== 'is_null' && c.op !== 'not_null'
      ? { ...c, value: Array.isArray(c.value) ? c.value.map(normalizeGenderCode) : normalizeGenderCode(c.value) }
      : c);
    else droppedNotices.push(`반영 안 됨: ${describeCustomerConditionIssue({ ...issues[0], index: i })}`);
  });
  f.customer_conditions = kept;
  return { filters: f, droppedNotices };
}

/** 이슈 → 화면 문구(고객 언어 · 내부 필드명 노출 없음). 첫 이슈 하나로 안내한다. */
export function describeCustomerConditionIssue(issue: CustomerConditionIssue): string {
  const n = issue.index >= 0 ? `대상 조건 ${issue.index + 1}번째` : '대상 조건';
  switch (issue.reason) {
    case 'unknown_field': return `${n}은 여정에서 쓸 수 없는 항목이라 저장하지 않았어요. ${conditionFieldLabelList()}으로 다시 골라 주세요.`;
    case 'bad_number': return `${n}의 값은 숫자로 넣어 주세요(생일 달은 1~12).`;
    case 'bad_value': return `${n}의 성별은 여성 또는 남성으로 골라 주세요.`;
    case 'unknown_op': return `${n}의 비교 방식을 알 수 없어요. 다시 골라 주세요.`;
    case 'empty_value': return `${n}의 값이 비어 있어요. 값을 넣어 주세요.`;
    case 'bad_logic': return '대상 조건을 묶는 방식(모두 만족 / 하나라도 만족)을 알 수 없어요. 다시 골라 주세요.';
    default: return `${n}의 모양이 올바르지 않아요. 다시 만들어 주세요.`;
  }
}

export function applyCustomerConditions(
  conditions: Array<{ field: string; op: string; value: any }>,
  logic: 'AND' | 'OR',
  params: any[],
  // ★ 2026-10-02 몰 동의 회사의 여정 조각 — 조건의 「수신동의」 필드를 안전필터와 같은 기준으로 읽는다(없으면 고객 행 열 · 종전 글자)
  consent?: JourneyConsent,
): string | null {
  if (!conditions || conditions.length === 0) return null;
  const allowedFields: readonly string[] = CUSTOMER_CONDITION_FIELDS;
  const allowedOps: readonly string[] = CUSTOMER_CONDITION_OPS;
  const clauses: string[] = [];
  // ★ Codex 적대 A7 — 값은 지역 배열에 모았다가 전부 옮길 수 있을 때만 호출자 배열에 붙인다(닫힘 FALSE 인데 앞 조건 값이 남으면 쓰지 않는 $n 으로 PG 오류).
  const base = params.length;
  const local: any[] = [];
  const bind = (v: any) => { local.push(v); return `$${base + local.length}`; };
  // ★ 2026-10-20 여정 V.3 §7-4 — 닫는 방향: 조건이 들어왔는데 하나라도 못 옮기면 전체를 0명(FALSE)으로.
  //   옛: 모르는 칸 · 연산자 · 빈 in 목록을 건너뛰어 그만큼 대상이 넓어졌고, 전부 빠지면 null = 조건 없음 = 전 고객이었다("VIP만"이 "전 고객").
  //   저장 · 켜기 관문(findCustomerConditionIssues)이 먼저 막지만 그 전 저장분 · 직접 UPDATE 가 남을 수 있어 추출이 마지막 문이다.
  const FAIL_CLOSED = 'FALSE';

  for (const cond of conditions) {
    if (!allowedFields.includes(cond.field)) return FAIL_CLOSED;
    if (!allowedOps.includes(cond.op)) return FAIL_CLOSED;

    if (cond.field === 'days_since_purchase') {
      const n = Number(cond.value);
      if (!DAYS_SINCE_PURCHASE_OPS.includes(cond.op) || cond.value === null || cond.value === '' || !Number.isFinite(n)) return FAIL_CLOSED;
      clauses.push(`${DAYS_SINCE_PURCHASE_SQL} ${cond.op} ${bind(Math.floor(n))}::int`);
      continue;
    }

    // ★ 2026-10-23 성별 = 표기 변형 전부(normalize getGenderVariants · 고객 필터와 같은 CT) · 다름 = NOT(그중 하나)
    if (cond.field === 'gender' && cond.op !== 'is_null' && cond.op !== 'not_null') {
      const codes = (Array.isArray(cond.value) ? cond.value : [cond.value]).map(normalizeGenderCode);
      if (codes.length === 0 || codes.some((x) => x === null)) return FAIL_CLOSED;
      const variants = [...new Set(codes.flatMap((x) => getGenderVariants(x as string)))];
      const pos = cond.op === '==' || cond.op === 'in';
      if (!pos && cond.op !== '!=' && cond.op !== 'not_in') return FAIL_CLOSED;
      clauses.push(pos ? `c.gender = ANY(${bind(variants)}::text[])` : `NOT (c.gender = ANY(${bind(variants)}::text[]))`);
      continue;
    }
    // ★ 2026-10-23 생일 달(1~12) = 월일 칸 우선 · 없으면 생일 날짜(생일 여정과 같은 두 칸)
    if (cond.field === 'birth_month' && cond.op !== 'is_null' && cond.op !== 'not_null') {
      const months = (Array.isArray(cond.value) ? cond.value : [cond.value]).map((x) => Number(x));
      if (months.length === 0 || months.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) return FAIL_CLOSED;
      if (cond.op === 'in' || cond.op === 'not_in') {
        clauses.push(`${BIRTH_MONTH_SQL} ${cond.op === 'in' ? 'IN' : 'NOT IN'} (${months.map((m) => `${bind(m)}::int`).join(', ')})`);
      } else {
        if (months.length !== 1) return FAIL_CLOSED;
        clauses.push(`${BIRTH_MONTH_SQL} ${cond.op === '==' ? '=' : cond.op} ${bind(months[0])}::int`);
      }
      continue;
    }
    const col = cond.field === 'birth_month' ? BIRTH_MONTH_SQL : cond.field === 'sms_opt_in' && consent ? consent.value : `c.${cond.field}`;
    if (cond.op === 'is_null') {
      clauses.push(`${col} IS NULL`);
      continue;
    }
    if (cond.op === 'not_null') {
      clauses.push(`${col} IS NOT NULL`);
      continue;
    }
    if (cond.op === 'in' || cond.op === 'not_in') {
      const values = Array.isArray(cond.value) ? cond.value : [cond.value];
      if (values.length === 0) return FAIL_CLOSED;
      const placeholders = values.map((v) => bind(v));
      clauses.push(`${col} ${cond.op === 'in' ? 'IN' : 'NOT IN'} (${placeholders.join(', ')})`);
      continue;
    }
    // 일반 비교 operator
    const sqlOp = cond.op === '==' ? '=' : cond.op;
    clauses.push(`${col} ${sqlOp} ${bind(cond.value)}`);
  }

  if (clauses.length === 0) return FAIL_CLOSED;
  params.push(...local);
  const joiner = logic === 'OR' ? ' OR ' : ' AND ';
  return `(${clauses.join(joiner)})`;
}
