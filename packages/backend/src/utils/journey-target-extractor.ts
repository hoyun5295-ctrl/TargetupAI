/**
 * Journey Target Extractor — 여정 trigger 조건으로 후보 customer_id 추출 (공유 컨트롤타워)
 *
 * 목적
 *   발송(journey-trigger-watcher)과 미리보기(ai.ts sample-customer / preview-samples)가
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
import { buildJourneySafetyFilter, buildReentryAntiJoin } from './journey-safety-filter';
import { resolvePointsExpiringConfig, clampInt } from './journey-points-trigger';
import { buildLedgerAntiJoin, hasBaseline } from './journey-entry-ledger';
// ★ 2026-08-01 여정 재설계 §3-0-2 — "우리가 처음 본 사람" ≠ "신규 고객".
//   추출은 회사 능력을 조회하지 않는다(Codex 3R). 술어는 데이터로만 평가되고,
//   "판정 가능한가" 게이트는 발송 진입 경로(journey-trigger-watcher)가 소유한다.
import { buildExistingCustomerPredicate } from './journey-identity-signals';
// ★ 2026-08-01 §3-0-3 — 이관 유예. "우리가 오늘 처음 봤다"는 "오늘 무언가 했다"가 아니다.
//   기존 고객 DB를 처음 연동하면 수만 명의 created_at이 전부 오늘이라 상태형 트리거가 통째로 발화한다.
import { isBulkStateTrigger, resolveIntakeGraceDays, buildIntakeGraceClause } from './journey-intake-grace';
import { buildSegmentBreakdown, SegmentBreakdown } from './journey-simulator-core';
import type { CdpEventRow } from './journey-cdp-cursor';

export async function selectJourneyTargetCustomerIds(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  limit: number,
  journeyId?: string,
  reentry?: { allowReentry: boolean; cooldownDays: number },
): Promise<string[]> {
  const filters = triggerFilters || {};
  // 이관 유예 일수 — 대상 트리거 목록은 CT가 소유한다(isBulkStateTrigger). 대상이 아니면 0 = 조건 없음.
  const graceDays = isBulkStateTrigger(triggerEvent) ? resolveIntakeGraceDays(filters) : 0;

  switch (triggerEvent) {
    // 1. 신규 가입 (customers.created_at 직전 N시간 안)
    case 'customer.created': {
      // ★ Phase 2: created_at 의존 제거 — 활성(baseline 적재됨) 여정은 진입 원장에 없는 식별자만 신규.
      //   초안/미리보기(baseline 없음)는 created_at 최근 창으로 "추정"만(실발송 아님).
      const params: any[] = [companyId];
      const useLedger = !!journeyId && (await hasBaseline(journeyId));
      let entryClause: string;
      if (useLedger) {
        params.push(journeyId);                                     // $2 = journeyId
        entryClause = buildLedgerAntiJoin('c', params.length);
      } else {
        params.push(String(Number(filters.recent_hours || 24)));    // $2 = hours (추정)
        entryClause = `c.created_at > NOW() - ($${params.length} || ' hours')::interval`;
      }
      // ★ 2026-08-01 §3-0-2: 원장에 없다고 신규가 아니다.
      //   자사몰로 먼저 등록된 고객(매장코드 없음)을 싱크가 매장코드와 함께 올리면 customers upsert 키
      //   (company_id, COALESCE(store_code,'__NONE__'), phone)가 충돌하지 않아 **새 행이 생긴다**.
      //   그 행은 원장에 없으니 옛 판정으로는 신규였고, 10년 단골에게 환영 문자가 나갔다.
      //   회사가 준 근거로 "전에도 고객이었다"를 걸러낸다 — 근거는 회사마다 다르다(설계서 §2-3).
      //   ⚠ 근거가 없는 회사를 생성·활성화 시점에 막는 것은 다음 조각이다. 여기서 빈 배열을 돌려주면
      //     기존 여정이 사유 없이 죽는다("조용한 0건"은 우리가 고치려는 병 자체다) → 추출 동작은 보존하고 관측만.
      const existingPred = buildExistingCustomerPredicate('c', params);
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      // ★ 2026-08-01 Codex 2R 수용 — 같은 회차 안 중복 진입 차단.
      //   판정을 사람 단위로 좁혀도 "이전 회차 기록"만 막힌다. 같은 전화번호의 무매장·매장 행이
      //   한 회차에 함께 후보가 되면 둘 다 원장 이전 상태를 보고 통과해 **같은 번호로 두 번 나간다**.
      //   DISTINCT ON (phone)으로 사람당 한 행만 남긴다(가장 최근 생성 행). LIMIT은 중복 제거 뒤에 건다 —
      //   먼저 걸면 중복이 정원을 먹어 실제 신규가 밀린다.
      //   전화번호 없는 행은 후보에서 뺀다 — 발송도 못 하고 진입 원장 기록(phone <> '')도 안 되어
      //   매회 후보로 되살아나며 대량 차단 판정만 부풀린다.
      const r = await query(
        `SELECT s.customer_id FROM (
           SELECT DISTINCT ON (c.phone) c.id AS customer_id, c.created_at
             FROM customers c
            WHERE c.company_id = $1::uuid
              AND COALESCE(c.phone, '') <> ''
              AND ${buildJourneySafetyFilter('c')}
              AND ${entryClause}
              AND NOT ${existingPred}
              ${cond ? ` AND ${cond}` : ''}
            ORDER BY c.phone, c.created_at DESC
         ) s
         ORDER BY s.created_at DESC
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // 2. 재구매 / 6. 예약 (cdp_events 직전 N분)
    // 라이브 발송은 trigger-watcher가 selectCdpEvent를 커서 모드로 직접 호출. 여기(미리보기)는 추정 모드.
    case 'cdp.purchase':
      return selectCdpEvent(companyId, 'purchase', filters, limit);
    // ★ §11-5 #2·#5 — 같은 구매 스트림의 분기(자격 필터는 라이브 경로가 적용). 미리보기는 구매 근사치.
    case 'purchase.first':
    case 'customer.dormant_return':
      return selectCdpEvent(companyId, 'purchase', filters, limit);
    case 'cdp.reservation_created':
      return selectCdpEvent(companyId, 'reservation_created', filters, limit);
    // ★ 2026-06-22: 배송 시작 = 자사몰 custom 이벤트(cdp_events.event_name='custom_order_shipped'). 라이브는 watcher가 커서 경로 호출, 여기는 미리보기·카운트 추정.
    case 'custom_order_shipped':
      return selectCdpEvent(companyId, 'custom_order_shipped', filters, limit);

    // 3. 휴면 (customers.recent_purchase_date < NOW - N일)
    case 'customer.dormant': {
      const d = Number(filters.dormant_days || 30);
      const params: any[] = [companyId, String(d), String(d + 7)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      // 이관 유예 — 3년 전 최근구매일이 오늘 적재되면 그 사람은 즉시 휴면 대상이 된다.
      const grace = buildIntakeGraceClause('c', params, graceDays);
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c')}
           AND c.recent_purchase_date IS NOT NULL
           AND c.recent_purchase_date < (CURRENT_DATE - ($2 || ' days')::interval)
           AND c.recent_purchase_date > (CURRENT_DATE - ($3 || ' days')::interval)
           ${antiJoin}
           ${grace ? ` AND ${grace}` : ''}
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.recent_purchase_date DESC
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // 4. 장바구니 포기 (cdp_events cart_add 직전 abandon_hours, 이후 checkout_start/purchase 없음)
    case 'cdp.cart_abandon': {
      const h = Number(filters.abandon_hours || 24);
      const params: any[] = [companyId, String(h)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `WITH abandoned AS (
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
             AND e2.event_name IN ('checkout_start', 'purchase')
             AND e2.occurred_at > a.cart_add_at
         )
           -- ★ 2026-08-01 §11-4: 매장(싱크)에서 산 사람에게 장바구니 리마인드를 보내지 않는다.
           --   그 구매는 원장에만 있고 cdp_events에는 없다. KST naive 규약이라 변환 명시.
           AND NOT EXISTS (
             SELECT 1 FROM purchases p2
             WHERE p2.company_id = $1::uuid
               AND p2.customer_id = a.customer_id
               AND p2.purchase_date IS NOT NULL
               AND p2.purchase_date > (a.cart_add_at AT TIME ZONE 'Asia/Seoul')
           )
           AND ${buildJourneySafetyFilter('c')}
         ${antiJoin}
         ${cond ? ` AND ${cond}` : ''}
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // ★ §11-5 #12 — 상품 조회 후 N일 미구매 (장바구니와 같은 창 구조, 구매 부재는 양 문 합산)
    case 'cdp.browse_no_purchase': {
      const d = clampInt(filters.browse_days, 3, 1, 30);
      const h = d * 24;
      const params: any[] = [companyId, String(h)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `WITH viewed AS (
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
             AND e2.event_name = 'purchase' AND e2.occurred_at > v.viewed_at
         )
           AND NOT EXISTS (
             SELECT 1 FROM purchases p2
             WHERE p2.company_id = $1::uuid AND p2.customer_id = v.customer_id
               AND p2.purchase_date IS NOT NULL
               AND p2.purchase_date > (v.viewed_at AT TIME ZONE 'Asia/Seoul')
           )
           AND ${buildJourneySafetyFilter('c')}
         ${antiJoin}
         ${cond ? ` AND ${cond}` : ''}
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // ★ §11-5 #6 — 구매 주기 이탈: 그 고객 평균 구매 간격 × 계수를 넘겼다 (구매 3건 이상만 성립 — §3-1).
    //   이력은 양 문 합산. 간격 산술은 epoch 초(버전 무관). 반복 제어 = 재진입 안티조인 + 이관 유예 + 상한.
    case 'customer.cycle_lapsed': {
      const factor = Math.max(1.1, Math.min(5, Number(filters.cycle_factor) || 1.5));
      const params: any[] = [companyId, String(factor)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      const grace = buildIntakeGraceClause('c', params, graceDays);
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `WITH hist AS (
           SELECT u.customer_id,
                  EXTRACT(EPOCH FROM MIN(u.d)) AS first_e,
                  EXTRACT(EPOCH FROM MAX(u.d)) AS last_e,
                  COUNT(*)::int AS cnt
             FROM (
               -- 같은 구매가 양 문에 다 있으면(혼합 회사) cnt가 부풀어 간격이 준다(Codex 지적) —
               -- 발생 시각 분 단위로 합쳐 한 건으로 센다. 같은 분의 실제 별건 구매는 마케팅상 한 건이다.
               SELECT DISTINCT e.customer_id, date_trunc('minute', e.occurred_at) AS d FROM cdp_events e
                WHERE e.company_id = $1::uuid AND e.event_name = 'purchase' AND e.customer_id IS NOT NULL
               UNION
               SELECT DISTINCT p.customer_id, date_trunc('minute', p.purchase_date AT TIME ZONE 'Asia/Seoul') FROM purchases p
                WHERE p.company_id = $1::uuid AND p.customer_id IS NOT NULL AND p.purchase_date IS NOT NULL
             ) u
            GROUP BY u.customer_id
           HAVING COUNT(*) >= 3
         )
         SELECT c.id AS customer_id
         FROM hist h
         INNER JOIN customers c ON c.id = h.customer_id AND c.company_id = $1::uuid
         WHERE (EXTRACT(EPOCH FROM NOW()) - h.last_e) > ((h.last_e - h.first_e) / GREATEST(h.cnt - 1, 1)) * $2::float
           AND ${buildJourneySafetyFilter('c')}
         ${antiJoin}
         ${grace ? ` AND ${grace}` : ''}
         ${cond ? ` AND ${cond}` : ''}
         ORDER BY h.last_e DESC
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // ★ §11-5 #7 — 등급 변동: 원장 state(이전 등급)와 현재 등급이 다르면 진입 (§3-0 원장 일반화).
    //   state 행이 없는 사람(기준선 이후 신규 관측)은 대상이 아니다 — 변동이 아니라 최초 관측이다.
    //   기준선(seedGradeStateForJourney)이 없는 미리보기는 판정 불가 — 추정하지 않는다.
    case 'customer.grade_changed': {
      if (!journeyId) return [];
      const params: any[] = [companyId, journeyId];
      const antiJoin = reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      try {
        const r = await query(
          `SELECT s.customer_id FROM (
             SELECT DISTINCT ON (c.phone) c.id AS customer_id
               FROM customers c
               INNER JOIN journey_entry_ledger l
                       ON l.journey_id = $2::uuid AND l.company_id = c.company_id
                      AND l.phone = c.phone AND l.kind = 'state'
              WHERE c.company_id = $1::uuid
                AND COALESCE(c.phone, '') <> ''
                AND COALESCE(c.grade, '') <> ''
                AND l.state_value IS DISTINCT FROM c.grade
                AND ${buildJourneySafetyFilter('c')}
                ${antiJoin}
                ${cond ? ` AND ${cond}` : ''}
              ORDER BY c.phone, c.created_at DESC
           ) s
           LIMIT $${params.length}::int`,
          params,
        );
        return r.rows.map((x: any) => x.customer_id);
      } catch (err: any) {
        if (err?.code !== '42703') throw err;
        console.warn('[JourneyExtractor] 등급 변동 — state_value 컬럼 미마이그레이션(§11-D-3 DDL 필요) → 0건');
        return [];
      }
    }

    // 5. 생일 (D-N): NOW + N days의 MM-DD가 customers.birth_month_day 또는 birth_date와 일치
    case 'customer.birthday_approaching': {
      const days = Number(filters.days_before || 7);
      const params: any[] = [companyId, String(days)];
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c')}
           AND (
             (c.birth_month_day IS NOT NULL AND c.birth_month_day = TO_CHAR((CURRENT_DATE + ($2 || ' days')::interval), 'MM-DD'))
             OR
             (c.birth_date IS NOT NULL AND TO_CHAR(c.birth_date, 'MM-DD') = TO_CHAR((CURRENT_DATE + ($2 || ' days')::interval), 'MM-DD'))
           )
           ${antiJoin}
           ${cond ? ` AND ${cond}` : ''}
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // 8. 포인트 소멸 임박 (Phase 8): points 임계 + (미사용 또는 연 단위 소멸일 D-N). 둘 다 공통 안전필터.
    case 'customer.points_expiring': {
      const cfg = resolvePointsExpiringConfig(filters);
      const params: any[] = [companyId, String(cfg.pointsMin)];
      let edgeClause: string;
      if (cfg.mode === 'annual_date') {
        if (!cfg.expiryMonthDay) return [];  // 소멸일 미설정 = 발송 0 (안전)
        params.push(String(cfg.daysBefore));   // $3
        params.push(cfg.expiryMonthDay);       // $4
        edgeClause = `TO_CHAR((CURRENT_DATE + ($3 || ' days')::interval), 'MM-DD') = $4`;
      } else {
        params.push(String(cfg.inactiveDays));  // $3
        edgeClause = `(c.recent_purchase_date IS NULL OR c.recent_purchase_date < (CURRENT_DATE - ($3 || ' days')::interval))`;
      }
      const antiJoin = journeyId && reentry ? buildReentryAntiJoin('c', params, journeyId, reentry.allowReentry, reentry.cooldownDays) : '';
      // 이관 유예 — inactivity 모드는 최근구매일 기반이라 이관 배치가 통째로 걸린다.
      const grace = buildIntakeGraceClause('c', params, graceDays);
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c')}
           AND c.points IS NOT NULL AND c.points >= $2::int
           AND ${edgeClause}
           ${antiJoin}
           ${grace ? ` AND ${grace}` : ''}
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.points DESC
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    // 7. 자유여정(custom) — audience(customer_conditions) + 안전필터 + 미진입(execution 안티조인) 고객만.
    //   조건 없으면 전체 활성 고객(브로드캐스트). 진입한 고객 제외 → 폴마다 미진입분만, 각 1회.
    case 'custom': {
      const params: any[] = [companyId];
      let dedupClause = '';
      if (journeyId) {
        params.push(journeyId);
        dedupClause = `AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $${params.length}::uuid AND je.customer_id = c.id)`;
      }
      // 이관 유예 — 상시 세그먼트는 조건 맞는 전원이 들어오므로 이관 배치가 그대로 폭발한다.
      const grace = buildIntakeGraceClause('c', params, graceDays);
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      params.push(String(limit));
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid
           AND ${buildJourneySafetyFilter('c')}
           ${dedupClause}
           ${grace ? ` AND ${grace}` : ''}
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.id
         LIMIT $${params.length}::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }

    default:
      return [];
  }
}

/**
 * ★ 2026-06-30 여정 일반화 — date_anchor/one_shot 대상(audience) 추출.
 *   안전필터 항상 + (옵션) points_min + (옵션) customer_conditions. execution 안티조인 없음
 *   (날짜축은 step·날짜 단위 발송이라 journey_anchor_dispatch가 멱등을 담당 — execution dedup이 D-3 대상을 빼면 안 됨).
 *   no_target_auto_relax: 0건이면 빈 배열(자동완화 없음). 회사 격리 company_id 필수.
 */
export async function selectAnchorAudienceIds(
  companyId: string,
  triggerFilters: Record<string, any>,
  limit: number,
): Promise<string[]> {
  const f = triggerFilters || {};
  const params: any[] = [companyId];
  let pointsClause = '';
  const pmin = Number(f.points_min);
  if (Number.isFinite(pmin) && pmin > 0) {
    params.push(String(Math.floor(pmin)));
    pointsClause = `AND c.points IS NOT NULL AND c.points >= $${params.length}::int`;
  }
  const cond = applyCustomerConditions(f.customer_conditions || [], f.logic || 'AND', params);
  params.push(String(limit));
  const r = await query(
    `SELECT id AS customer_id FROM customers c
     WHERE c.company_id = $1::uuid
       AND ${buildJourneySafetyFilter('c')}
       ${pointsClause}
       ${cond ? ` AND ${cond}` : ''}
     ORDER BY c.id
     LIMIT $${params.length}::int`,
    params,
  );
  return r.rows.map((x: any) => x.customer_id);
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
): Promise<string[]> {
  const params: any[] = [companyId, eventName];
  let timeClause: string;
  if (cursorStart && windowEnd) {
    params.push(cursorStart);
    params.push(windowEnd);
    timeClause = `e.occurred_at > $${params.length - 1} AND e.occurred_at <= $${params.length}`;
  } else {
    timeClause = `e.occurred_at >= NOW() - INTERVAL '7 days'`;
  }
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
  params.push(String(limit));
  const r = await query(
    `SELECT DISTINCT e.customer_id FROM cdp_events e
     INNER JOIN customers c ON c.id = e.customer_id AND c.company_id = $1::uuid
     WHERE e.company_id = $1::uuid
       AND e.event_name = $2
       AND e.customer_id IS NOT NULL
       AND ${timeClause}
       AND ${buildJourneySafetyFilter('c')}
       ${cond ? ` AND ${cond}` : ''}
     LIMIT $${params.length}::int`,
    params,
  );
  return r.rows.map((x: any) => x.customer_id);
}

// ★ Fix #11 (2026-06-05): cdp 커서용 — 커서 이후 창의 이벤트를 chunk만큼(안전필터+조건).
//   distinct가 아니라 행을 그대로 반환 → 호출부가 실제로 본 마지막 행까지만 커서를 전진(LIMIT 누락 정정).
// ★ 2026-08-01 §11-3: 커서 축을 occurred_at(발생) → created_at(도착)으로 전환.
//   배치로 늦게 도착한 데이터, 익명→회원 소급으로 나중에 연결된 데이터가 커서 뒤에 떨어져 영영 안 잡히던 구멍을 닫는다.
//   cursorEventId가 오면 (created_at, id) 행 비교로 동시각 타이까지 가른다 — 없으면 시각만(컬럼 미마이그레이션 환경).
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

export async function selectCdpEventRowsForCursor(
  companyId: string,
  eventName: string,
  filters: Record<string, any>,
  cursor: CdpCursorQuery,
  windowEnd: Date | string,
  chunkLimit: number,
): Promise<CdpEventRow[]> {
  // 축은 화이트리스트 두 값뿐 — 문자열이 그대로 SQL에 들어가므로 여기서 닫는다(주입 표면 0).
  const axis = cursor.axis === 'created_at' ? 'created_at' : 'occurred_at';
  const params: any[] = [companyId, eventName, cursor.at, windowEnd];
  let cursorClause: string;
  if (axis === 'created_at' && cursor.eventId) {
    params.push(cursor.eventId);
    cursorClause = `(e.created_at, e.id) > ($3::timestamptz, $${params.length}::uuid)`;
  } else {
    cursorClause = `e.${axis} > $3::timestamptz`;
  }
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
  params.push(String(chunkLimit));
  const r = await query(
    `SELECT e.id, e.customer_id, e.created_at, e.occurred_at,
            e.created_at::text AS created_at_raw, e.occurred_at::text AS occurred_at_raw,
            e.properties FROM cdp_events e
     INNER JOIN customers c ON c.id = e.customer_id AND c.company_id = $1::uuid
     WHERE e.company_id = $1::uuid
       AND e.event_name = $2
       AND e.customer_id IS NOT NULL
       AND ${cursorClause}
       AND e.${axis} <= $4::timestamptz
       AND ${buildJourneySafetyFilter('c')}
       ${cond ? ` AND ${cond}` : ''}
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
): Promise<CdpEventRow[]> {
  const params: any[] = [companyId, cursor.at, windowEnd, String(maxAgeHours)];
  let cursorClause: string;
  if (cursor.rowId) {
    params.push(cursor.rowId);
    cursorClause = `(p.created_at, p.id) > (($2::timestamptz AT TIME ZONE current_setting('TimeZone')), $${params.length}::uuid)`;
  } else {
    cursorClause = `p.created_at > ($2::timestamptz AT TIME ZONE current_setting('TimeZone'))`;
  }
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
  params.push(String(chunkLimit));
  const r = await query(
    `SELECT p.id,
            p.customer_id,
            (p.created_at AT TIME ZONE current_setting('TimeZone')) AS arrived_at,
            (p.created_at AT TIME ZONE current_setting('TimeZone'))::text AS arrived_at_raw,
            (p.purchase_date AT TIME ZONE 'Asia/Seoul') AS occurred_at,
            jsonb_strip_nulls(jsonb_build_object(
              'total_amount', ROUND(COALESCE(p.total_amount, 0))::bigint,
              'product_name', p.product_name,
              'product_code', p.product_code,
              'store_name', COALESCE(NULLIF(p.store_name, ''), p.store_code)
            )) AS properties
       FROM purchases p
       INNER JOIN customers c ON c.id = p.customer_id AND c.company_id = $1::uuid
      WHERE p.company_id = $1::uuid
        AND p.customer_id IS NOT NULL
        AND ${cursorClause}
        AND p.created_at <= ($3::timestamptz AT TIME ZONE current_setting('TimeZone'))
        AND p.purchase_date IS NOT NULL
        AND p.purchase_date >= ((NOW() - ($4 || ' hours')::interval) AT TIME ZONE 'Asia/Seoul')
        AND p.purchase_date <= (NOW() AT TIME ZONE 'Asia/Seoul')
        AND ${buildJourneySafetyFilter('c')}
        ${cond ? ` AND ${cond}` : ''}
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
  const r = await query(
    `WITH cand AS (
       SELECT unnest($2::uuid[]) AS customer_id, unnest($3::timestamptz[]) AS entered_at
     )
     SELECT c.customer_id,
            GREATEST(
              (SELECT MAX(e.occurred_at) FROM cdp_events e
                WHERE e.company_id = $1::uuid AND e.customer_id = c.customer_id
                  AND e.event_name = 'purchase' AND e.occurred_at < c.entered_at),
              (SELECT MAX(p.purchase_date AT TIME ZONE 'Asia/Seoul') FROM purchases p
                WHERE p.company_id = $1::uuid AND p.customer_id = c.customer_id
                  AND p.purchase_date IS NOT NULL
                  AND p.purchase_date < (c.entered_at AT TIME ZONE 'Asia/Seoul'))
            ) AS last_prior
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

// ════════════════════════════════════════════════════════════════════
// 미리보기 샘플 빌더 — 여정 trigger 기준 N명 (label + 한국어키 + 영문키)
//   preview-samples(저장 후 journeyId) + preview-target-samples(review 단계 trigger) 공통 사용.
// ════════════════════════════════════════════════════════════════════

export interface JourneyPreviewSample {
  label: string;
  customerId: string;
  sampleCustomer: Record<string, any>;
  sampleCustomerFields: Record<string, any>;
  modelVersion: string | null;
}

export async function buildJourneyPreviewSamples(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  limit: number,
  journeyId?: string,
): Promise<JourneyPreviewSample[]> {
  const ids = await selectJourneyTargetCustomerIds(companyId, triggerEvent, triggerFilters, limit, journeyId);
  if (ids.length === 0) return [];

  // 추출 순서(trigger ORDER BY — 신규가입=created_at DESC 등) 유지 + 예측 점수 LEFT JOIN
  const r = await query(
    `SELECT c.*, p.click_score, p.churn_risk, p.purchase_likelihood, p.model_version
     FROM customers c
     LEFT JOIN cdp_customer_predictions p ON p.customer_id = c.id
     WHERE c.company_id = $1::uuid AND c.id = ANY($2::uuid[])
     ORDER BY array_position($2::uuid[], c.id)`,
    [companyId, ids],
  );

  return r.rows.map((row: any, i: number): JourneyPreviewSample => ({
    label: row.name || `대상 ${i + 1}`,
    customerId: row.id,
    sampleCustomer: {
      고객명: row.name || '',
      이름: row.name || '',
      등급: row.grade || '',
      지역: row.region || '',
      전화번호: row.phone || '',
      포인트: row.points != null ? Number(row.points).toLocaleString() : '',
      최근구매일: row.recent_purchase_date ? new Date(row.recent_purchase_date).toLocaleDateString('ko-KR') : '',
      총구매액: row.total_purchase_amount != null ? Number(row.total_purchase_amount).toLocaleString() : '',
      누적구매횟수: row.purchase_count != null ? String(row.purchase_count) : '',
    },
    sampleCustomerFields: {
      name: row.name || null,
      phone: row.phone || null,
      grade: row.grade || null,
      region: row.region || null,
      age: row.age != null ? Number(row.age) : null,
      gender: row.gender || null,
      purchase_count: row.purchase_count != null ? Number(row.purchase_count) : 0,
      total_purchase_amount: row.total_purchase_amount != null ? Number(row.total_purchase_amount) : 0,
      recent_purchase_amount: row.recent_purchase_amount != null ? Number(row.recent_purchase_amount) : 0,
      recent_purchase_date: row.recent_purchase_date || null,
      birth_date: row.birth_date || null,
      points: row.points != null ? Number(row.points) : 0,
      email: row.email || null,
      click_score: row.click_score != null ? Number(row.click_score) : 0.5,
      churn_risk: row.churn_risk != null ? Number(row.churn_risk) : 0.5,
      purchase_likelihood: row.purchase_likelihood != null ? Number(row.purchase_likelihood) : 0.5,
    },
    modelVersion: row.model_version || null,
  }));
}

// ════════════════════════════════════════════════════════════════════
// 전체 매칭 수 + 등급 분포 — 미리보기·시뮬레이션 공용 (Phase 9)
//   발송과 동일한 selectJourneyTargetCustomerIds로 ID를 받아(상한 JOURNEY_COUNT_CAP) 등급만 집계.
//   → 미리보기·시뮬레이션 = 실발송 대상 100% 일치(같은 함수). 상한 초과 시 capped=true(정직 표기).
//   grade/company_id/id = information_schema 확인 컬럼(2026-06-04).
// ════════════════════════════════════════════════════════════════════

export const JOURNEY_COUNT_CAP = 100000;

export interface JourneyTargetCount {
  total: number;
  segments: SegmentBreakdown[];
  capped: boolean;
}

/** 주어진 customer id 집합의 등급 분포(grade GROUP BY → 셰이핑). */
export async function gradeBreakdownForIds(
  companyId: string,
  ids: string[],
): Promise<{ total: number; segments: SegmentBreakdown[] }> {
  if (ids.length === 0) return { total: 0, segments: [] };
  const r = await query(
    `SELECT COALESCE(grade, '일반') AS segment, COUNT(*)::int AS cnt
     FROM customers
     WHERE company_id = $1::uuid AND id = ANY($2::uuid[])
     GROUP BY COALESCE(grade, '일반')`,
    [companyId, ids],
  );
  return buildSegmentBreakdown(r.rows);
}

/** 주어진 customer id 집합의 실데이터 평균 — 객단가·전환·클릭. 행/값 없으면 null(추정 생략용). */
export async function averageScoresForIds(
  companyId: string,
  ids: string[],
): Promise<{ avgOrderValue: number | null; avgConversion: number | null; avgClick: number | null }> {
  if (ids.length === 0) return { avgOrderValue: null, avgConversion: null, avgClick: null };
  const r = await query(
    `SELECT AVG(c.avg_order_value) AS aov,
            AVG(p.purchase_likelihood) AS conv,
            AVG(p.click_score) AS clk
     FROM customers c
     LEFT JOIN cdp_customer_predictions p ON p.customer_id = c.id
     WHERE c.company_id = $1::uuid AND c.id = ANY($2::uuid[])`,
    [companyId, ids],
  );
  const row = r.rows[0] || {};
  const num = (v: any) => (v != null ? Number(v) : null);
  return { avgOrderValue: num(row.aov), avgConversion: num(row.conv), avgClick: num(row.clk) };
}

/** 전체 매칭 수 + 등급 분포 (미리보기·시뮬레이션 공용). 발송과 동일 함수로 ID 추출. */
export async function countJourneyTargetCustomers(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  journeyId?: string,
): Promise<JourneyTargetCount> {
  const ids = await selectJourneyTargetCustomerIds(companyId, triggerEvent, triggerFilters, JOURNEY_COUNT_CAP, journeyId);
  const { total, segments } = await gradeBreakdownForIds(companyId, ids);
  return { total, segments, capped: ids.length >= JOURNEY_COUNT_CAP };
}

// ════════════════════════════════════════════════════════════════════
// customer_conditions 복합 조건 → SQL 조각 (5번 트리거 복합 조합)
//   순수(파라미터 배열에 push). journey-simulator에서 이동(Phase 9 순환 참조 제거).
// ════════════════════════════════════════════════════════════════════

export function applyCustomerConditions(
  conditions: Array<{ field: string; op: string; value: any }>,
  logic: 'AND' | 'OR',
  params: any[],
): string | null {
  if (!conditions || conditions.length === 0) return null;
  // ★ 2026-06-26: store_name(매장명)/store_code(매장코드) 추가 — 여정 자연어 타겟에서
  //   "매장명이 송파가락점인 회원" 같은 매장 세그먼트가 무시되고 전체 발송되던 #1 fix.
  //   customers.store_name varchar(100) / store_code varchar(50) (SCHEMA.md 검증).
  // ★ 2026-06-30 여정 일반화 — points 추가(날짜축/대상 조건에서 포인트를 일반 조건으로). customers.points numeric(SCHEMA 검증). 추가만 = 기존 경로 회귀 0.
  const allowedFields = ['grade', 'region', 'age', 'purchase_count', 'total_purchase_amount', 'sms_opt_in', 'store_name', 'store_code', 'points'];
  const allowedOps = ['==', '!=', '>=', '<=', '>', '<', 'in', 'not_in', 'is_null', 'not_null'];
  const clauses: string[] = [];

  for (const cond of conditions) {
    if (!allowedFields.includes(cond.field)) continue;
    if (!allowedOps.includes(cond.op)) continue;

    const col = `c.${cond.field}`;
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
      if (values.length === 0) continue;
      const placeholders = values.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      clauses.push(`${col} ${cond.op === 'in' ? 'IN' : 'NOT IN'} (${placeholders.join(', ')})`);
      continue;
    }
    // 일반 비교 operator
    const sqlOp = cond.op === '==' ? '=' : cond.op;
    params.push(cond.value);
    clauses.push(`${col} ${sqlOp} $${params.length}`);
  }

  if (clauses.length === 0) return null;
  const joiner = logic === 'OR' ? ' OR ' : ' AND ';
  return `(${clauses.join(joiner)})`;
}
