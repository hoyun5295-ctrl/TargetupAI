/**
 * CT utils/journey-opportunities.ts (2026-06-29 신설 · 2026-06-29 분석 엔진으로 재작성)
 *
 * "오늘의 여정 기회" — 회사 실데이터를 분석해 여정이 비어 있는 지점을 우선순위와 함께 추천.
 *   고정 N개를 무조건 넣지 않는다. 의미 있는 신호만(count > 0 + 아직 같은 유형 활성 여정 없음) 가변 개수로,
 *   "관련 매출 규모(실데이터)"로 우선순위를 매겨 정렬한다.
 *
 * 영구 원칙 정합:
 *  - 회사 격리 (company_id 필터) · Read-only 집계 (운영 영향 0)
 *  - 임의 상수 금지 (feedback_no_arbitrary_constants):
 *      · 휴면/재구매 임계 일수 = 회사 구매 분포(PERCENTILE_CONT)에서 도출 (하드코딩 90일 X)
 *      · 우선순위 = 세그먼트의 실측 매출 규모(누적 구매액·평균 구매단가)로 산정. 전환율 추정 상수 X.
 *  - 컬럼 출처 = SCHEMA.md 2026-06-29 information_schema 실측:
 *      customers: avg_order_value, total_purchase_amount, recent_purchase_amount, recent_purchase_date,
 *                 purchase_count, created_at, last_cart_add_at, last_wishlist_add_at, birth_date, is_active, is_invalid
 *      journeys: template_code, status, archived_at
 */

import { query } from '../config/database';
// ★ 2026-08-08 이어달리기 — 후속 간선·겹침·카드 모양은 계약이 소유한다(여기서 다시 적지 않는다).
import {
  TRIGGER_CONTRACTS,
  nextTriggerEvents,
  overlapTriggerEvents,
  triggerTemplateCode,
  triggerKeyForEvent,
  resolveTriggerAvailability,
  toAvailabilityMap,
} from './journey-trigger-capability';
// ★ 정답표를 갖지 않는다 — 이 회사가 그 트리거를 판정할 수 있는지는 회사 데이터가 정한다.
import { getCompanyJourneyFacts } from './company-data-profile';

export type JourneyOpportunityType =
  | 'cart_recovery' | 'onboarding' | 'dormant' | 'birthday' | 'repurchase_due' | 'wishlist'
  // ★ 2026-08-08 이어달리기 — 앞 여정에서 실제로 전환한 고객을 받아줄 여정이 없다.
  | 'succession';

export interface JourneyOpportunity {
  type: JourneyOpportunityType;
  /** 1클릭 생성 시 시각(아이콘)용 템플릿 코드 */
  templateCode: 'cart' | 'onboarding' | 'dormant' | 'birthday' | 'repeat' | 'custom';
  title: string;
  description: string;
  /** 조건에 해당하는 실제 고객 수 (추정 아님) */
  count: number;
  /** 세그먼트 관련 매출 규모(실데이터) — 우선순위 산정 근거. 추정 전환율 미포함. */
  valueAtStake: number;
  priority: 'high' | 'medium';
  /** 1클릭 생성 시 자연어 입력에 프리필할 목표 (구체 혜택 미포함 — 골격만) */
  suggestedObjective: string;
  /**
   * ★ 2026-08-08 이어달리기 — 이 카드가 약속한 트리거. 생성 요청에 그대로 실어 보내면
   * 서버가 계약값으로 고정한다(AI가 다른 트리거를 골라 어긋나는 일이 없다).
   */
  preferTriggerEvent?: string;
  /** ★ 2026-08-08 — 카드에 반드시 함께 나가는 고지(소급 금지·겹침). 화면이 지우지 않는다. */
  notices?: string[];
}

function won(v: number): string {
  return '₩' + Math.round(Math.max(0, v)).toLocaleString();
}
function perHead(total: number, cnt: number): string {
  return cnt > 0 ? won(total / cnt) : won(0);
}

/**
 * 회사의 여정 기회를 실데이터 분석으로 산출. 의미 있는 신호만, 매출 규모 우선순위로 정렬.
 * 같은 유형 활성 여정이 이미 있거나 count=0인 신호는 제외한다(노출할 것만 반환).
 */
export async function buildJourneyOpportunities(companyId: string): Promise<JourneyOpportunity[]> {
  // 1) 활성(미보관) 여정 유형 — 이미 커버 중인 기회는 제안하지 않는다.
  //    ★ 2026-08-08 이어달리기 — trigger_event도 함께 읽는다. 후속 트리거 3종이 전부 template_code='repeat'을
  //      공유해, 이어달리기 dedup을 template_code로 하면 서로를 오차단한다(설계서 사실 10).
  const activeRes = await query(
    `SELECT DISTINCT template_code, trigger_event FROM journeys
      WHERE company_id = $1 AND status = 'active' AND archived_at IS NULL`,
    [companyId],
  );
  const active = new Set<string>(activeRes.rows.map((r: any) => String(r.template_code)));
  const activeTriggers = new Set<string>(activeRes.rows.map((r: any) => String(r.trigger_event)));

  // 2) 회사 구매 분포 — 데이터 기반 임계값 (하드코딩 대신 분포에서 도출)
  const statRes = await query(
    `SELECT
       PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY avg_order_value) FILTER (WHERE avg_order_value > 0) AS median_aov,
       PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY (CURRENT_DATE - recent_purchase_date)) FILTER (WHERE recent_purchase_date IS NOT NULL) AS median_days,
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (CURRENT_DATE - recent_purchase_date)) FILTER (WHERE recent_purchase_date IS NOT NULL) AS p75_days
     FROM customers
     WHERE company_id = $1 AND is_active = true AND COALESCE(is_invalid, false) = false`,
    [companyId],
  );
  const srow = statRes.rows[0] || {};
  const medianAov = Math.max(0, Number(srow.median_aov || 0));
  // 데이터가 부족하면(분포 NULL) 보수적 기본 — 그래도 회사 분포가 있으면 그 값을 우선.
  const medianDays = Math.max(14, Math.round(Number(srow.median_days || 45)));
  const p75Days = Math.max(medianDays + 7, Math.round(Number(srow.p75_days || 90)));

  // 3) 단일 스캔으로 모든 신호 집계 (FILTER 절)
  const aggRes = await query(
    `SELECT
       COUNT(*) FILTER (WHERE last_cart_add_at >= NOW() - INTERVAL '14 days'
                          AND (recent_purchase_date IS NULL OR recent_purchase_date < last_cart_add_at::date)) AS cart_cnt,
       COALESCE(SUM(COALESCE(avg_order_value, recent_purchase_amount, 0))
                FILTER (WHERE last_cart_add_at >= NOW() - INTERVAL '14 days'
                          AND (recent_purchase_date IS NULL OR recent_purchase_date < last_cart_add_at::date)), 0) AS cart_val,

       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS onb_cnt,

       COUNT(*) FILTER (WHERE recent_purchase_date IS NOT NULL
                          AND (CURRENT_DATE - recent_purchase_date) > $2) AS dorm_cnt,
       COALESCE(SUM(total_purchase_amount)
                FILTER (WHERE recent_purchase_date IS NOT NULL
                          AND (CURRENT_DATE - recent_purchase_date) > $2), 0) AS dorm_val,

       COUNT(*) FILTER (WHERE birth_date IS NOT NULL
                          AND ((CAST(to_char(birth_date, 'DDD') AS int) - CAST(to_char(CURRENT_DATE, 'DDD') AS int) + 366) % 366) <= 7) AS bday_cnt,

       COUNT(*) FILTER (WHERE purchase_count >= 2 AND recent_purchase_date IS NOT NULL
                          AND (CURRENT_DATE - recent_purchase_date) BETWEEN $3 AND $2) AS repur_cnt,
       COALESCE(SUM(COALESCE(avg_order_value, 0))
                FILTER (WHERE purchase_count >= 2 AND recent_purchase_date IS NOT NULL
                          AND (CURRENT_DATE - recent_purchase_date) BETWEEN $3 AND $2), 0) AS repur_val,

       COUNT(*) FILTER (WHERE last_wishlist_add_at >= NOW() - INTERVAL '14 days'
                          AND (recent_purchase_date IS NULL OR recent_purchase_date < last_wishlist_add_at::date)) AS wish_cnt
     FROM customers
     WHERE company_id = $1 AND is_active = true AND COALESCE(is_invalid, false) = false`,
    [companyId, p75Days, medianDays],
  );
  const a = aggRes.rows[0] || {};
  const num = (v: any) => Number(v || 0);
  const aov = medianAov; // 구매 이력 없는 세그먼트(신규/생일/찜)의 1인 가치 앵커 = 회사 실측 중앙 구매단가

  const out: JourneyOpportunity[] = [];

  if (!active.has('cart') && num(a.cart_cnt) > 0) {
    out.push({
      type: 'cart_recovery', templateCode: 'cart', title: '장바구니 이탈 미회복',
      count: num(a.cart_cnt), valueAtStake: num(a.cart_val), priority: 'medium',
      description: `최근 14일 안에 담고 구매하지 않은 ${num(a.cart_cnt).toLocaleString()}명. 1인 평균 ${perHead(num(a.cart_val), num(a.cart_cnt))} 규모라 회복 여력이 큽니다.`,
      suggestedObjective: '장바구니에 담고 구매하지 않은 고객 회복: 담은 상품 리마인드 + 결제 유도 2단계',
    });
  }
  if (!active.has('onboarding') && num(a.onb_cnt) > 0) {
    out.push({
      type: 'onboarding', templateCode: 'onboarding', title: '신규 가입 미환영',
      count: num(a.onb_cnt), valueAtStake: Math.round(num(a.onb_cnt) * aov), priority: 'medium',
      description: `최근 7일 안에 가입한 ${num(a.onb_cnt).toLocaleString()}명. 첫 구매 전환의 골든타임입니다.`,
      suggestedObjective: '신규 가입자 환영 시리즈: 첫 인사 + 첫 구매 유도',
    });
  }
  if (!active.has('dormant') && num(a.dorm_cnt) > 0) {
    out.push({
      type: 'dormant', templateCode: 'dormant', title: '장기 무구매 휴면',
      count: num(a.dorm_cnt), valueAtStake: num(a.dorm_val), priority: 'medium',
      description: `평소 구매 주기를 넘겨 ${p75Days}일 이상 무구매인 ${num(a.dorm_cnt).toLocaleString()}명. 누적 ${won(num(a.dorm_val))} 구매한 고객층이라 재활성 가치가 높습니다.`,
      suggestedObjective: '장기 휴면 고객 복귀 유도: 재방문 안내',
    });
  }
  if (!active.has('birthday') && num(a.bday_cnt) > 0) {
    out.push({
      type: 'birthday', templateCode: 'birthday', title: '생일 임박',
      count: num(a.bday_cnt), valueAtStake: Math.round(num(a.bday_cnt) * aov), priority: 'medium',
      description: `7일 안에 생일인 ${num(a.bday_cnt).toLocaleString()}명. 축하 메시지로 재방문 유도 적기입니다.`,
      suggestedObjective: '생일 7일 전 사전 축하 + 등급별 인사',
    });
  }
  if (!active.has('repeat') && num(a.repur_cnt) > 0) {
    out.push({
      type: 'repurchase_due', templateCode: 'repeat', title: '재구매 주기 도래',
      count: num(a.repur_cnt), valueAtStake: num(a.repur_val), priority: 'medium',
      description: `평소 재구매 주기(${medianDays}~${p75Days}일)에 접어든 ${num(a.repur_cnt).toLocaleString()}명. 휴면 전 리마인드 적기입니다.`,
      suggestedObjective: '재구매 주기 도래 고객 리마인드: 재구매 유도',
    });
  }
  if (num(a.wish_cnt) > 0) {
    out.push({
      type: 'wishlist', templateCode: 'cart', title: '찜만 하고 미구매',
      count: num(a.wish_cnt), valueAtStake: Math.round(num(a.wish_cnt) * aov), priority: 'medium',
      description: `최근 14일 찜만 하고 구매하지 않은 ${num(a.wish_cnt).toLocaleString()}명. 관심 상품 알림으로 결제 유도가 가능합니다.`,
      suggestedObjective: '찜한 상품 미구매 고객: 관심 상품 리마인드',
    });
  }

  // ★ 2026-08-08 이어달리기 — 앞 여정에서 실제로 전환한 고객을 받아줄 여정이 없을 때만.
  //   실패해도 나머지 카드는 그대로 나간다(추천 하나가 화면 전체를 비우지 않는다).
  try {
    out.push(...(await buildSuccessionOpportunities(companyId, activeTriggers)));
  } catch (e: any) {
    console.log('[journey-opportunities] 이어달리기 신호 생략:', e?.message || e);
  }

  // 4) 관련 매출 규모(실데이터)로 우선순위 — 큰 것부터, 동률은 인원수.
  out.sort((x, y) => (y.valueAtStake - x.valueAtStake) || (y.count - x.count));
  const maxVal = out.length ? Math.max(...out.map((c) => c.valueAtStake)) : 0;
  for (const c of out) c.priority = (maxVal > 0 && c.valueAtStake >= maxVal * 0.5) ? 'high' : 'medium';

  return out;
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-08-08 이어달리기(다음 수 추천) — 설계서 2026-08-08-journey-succession-design.md §5
//
//   여정 하나를 점이 아니라 고객 생애의 한 구간으로 본다. 앞 구간에서 **실제로 전환한** 고객이
//   있는데 그들을 받아줄 여정이 없으면, 그 사실을 근거로 다음 구간을 권한다.
//
//   근거는 지어내지 않는다 — `journey_executions.status='goal_met'`(2026-07-10 자동 종료가 남긴 원장)이
//   유일한 관측이다. 자동 종료가 꺼진 여정은 goal_met이 안 쌓여 이 추천이 뜨지 않는다. 그게 맞다.
// ════════════════════════════════════════════════════════════════════

/** 카드 문구 — 후속 트리거별. 내부 용어(trigger_event·goal_met) 노출 금지, 구체 혜택 미포함. */
const SUCCESSION_COPY: Record<string, {
  title: string;
  describe: (n: number) => string;
  objective: string;
  /** ⛔ 완화 금지 — 이 문장이 빠지면 "켜 뒀는데 0건" 오해가 추천 경로로 재발한다(설계서 §7-1). */
  futureNotice: string;
}> = {
  'purchase.first': {
    title: '첫 구매 고객 미대응',
    describe: (n) => `신규 가입 여정에서 ${n.toLocaleString()}명이 첫 구매를 했어요. 받아줄 여정이 없습니다.`,
    objective: '첫 구매 고객 정착: 감사 + 두 번째 구매 유도',
    futureNotice: '지금 만들면 앞으로 첫 구매하는 고객부터 받습니다.',
  },
  'cdp.purchase': {
    title: '재구매 고객 미대응',
    describe: (n) => `첫 구매 여정에서 ${n.toLocaleString()}명이 다시 구매했어요. 받아줄 여정이 없습니다.`,
    objective: '재구매 고객 관리: 구매 감사 + 다음 구매 제안',
    futureNotice: '지금 만들면 앞으로 구매하는 고객부터 받습니다.',
  },
  'customer.dormant_return': {
    title: '휴면 복귀 고객 미대응',
    describe: (n) => `휴면 회수 여정에서 ${n.toLocaleString()}명이 복귀했어요. 받아줄 여정이 없습니다.`,
    objective: '휴면에서 복귀한 고객 정착: 복귀 감사 + 재구매 유도',
    futureNotice: '지금 만들면 앞으로 복귀하는 고객부터 받습니다.',
  },
};

/**
 * 후속 여정의 목표 골격 — 추천 카드와 "이어서 만들기" 버튼이 **같은 문장**을 쓴다.
 * (화면이 자기 문장을 따로 지어내면 같은 추천이 경로에 따라 다른 여정을 만든다)
 */
export function successionObjectiveFor(nextTriggerEvent: string): string | null {
  return SUCCESSION_COPY[nextTriggerEvent]?.objective ?? null;
}

/** 겹침 안내 — 어느 쪽에서 추천하든 같은 문장 하나(여정 문서 §4의 의무를 추천 카드가 승계). */
const OVERLAP_NOTICE = '재구매 여정과 휴면 복귀 여정은 같은 구매 한 번에 둘 다 발송될 수 있어요.';

/** 카드 시각 코드로 쓸 수 있는 값인가 — 계약의 카탈로그 코드 중 카드가 모르는 값은 custom으로 둔다. */
function toCardTemplateCode(code: string | null): JourneyOpportunity['templateCode'] {
  return code === 'repeat' || code === 'cart' || code === 'custom' ? code : 'custom';
}

async function buildSuccessionOpportunities(
  companyId: string,
  activeTriggers: Set<string>,
): Promise<JourneyOpportunity[]> {
  const sourceEvents = TRIGGER_CONTRACTS.filter((c) => (c.nextEvents || []).length > 0).map((c) => c.event);
  if (sourceEvents.length === 0) return [];

  // 전환 관측 — 이 회사의 여정 중 간선이 달린 트리거에서 목표를 이룬 고객 수와 그 고객들의 실측 구매단가 합.
  //   ⛔ 임의 상수 금지: valueAtStake는 avg_order_value 실값 합이다(추정 전환율·앵커 없음).
  //   ⛔ 세는 단위는 **사람**이다. 실행 행으로 세면 재진입한 고객과 같은 신호의 여정 여러 개가 한 사람을
  //     여러 명으로 부풀리고 구매단가도 반복 합산된다("3명이 복귀했어요"가 사실이 아니게 된다).
  //   ⛔ 회사 격리는 여정을 지난다 — journey_executions에는 company_id 컬럼이 없다(SCHEMA 실측).
  //     실행 행은 자기 여정의 소유이고, 그 여정에 회사 조건이 걸려 있다.
  const conv = await query(
    `WITH converted AS (
       SELECT DISTINCT j.trigger_event AS trigger_event, e.customer_id AS customer_id
         FROM journey_executions e
         JOIN journeys j ON j.id = e.journey_id AND j.company_id = $1::uuid
        WHERE e.status = 'goal_met'
          AND j.trigger_event = ANY($2::text[])
     )
     SELECT cv.trigger_event AS trigger_event,
            COUNT(*)::int AS goal_met_count,
            COALESCE(SUM(COALESCE(c.avg_order_value, 0)), 0) AS value_at_stake
       FROM converted cv
       LEFT JOIN customers c ON c.id = cv.customer_id AND c.company_id = $1::uuid
      GROUP BY cv.trigger_event`,
    [companyId, sourceEvents],
  );
  const rows = conv.rows.filter((r: any) => Number(r.goal_met_count || 0) > 0);
  if (rows.length === 0) return [];

  // capability — 구매 데이터가 없는 회사에 구매 여정을 권하지 않는다(fail-closed).
  const availability = toAvailabilityMap(resolveTriggerAvailability(await getCompanyJourneyFacts(companyId)));

  // 같은 후속 트리거를 두 출발점이 가리키면 근거가 큰 쪽 하나만 남긴다.
  rows.sort((a: any, b: any) => Number(b.goal_met_count) - Number(a.goal_met_count));

  const out: JourneyOpportunity[] = [];
  const taken = new Set<string>();
  for (const row of rows) {
    const count = Number(row.goal_met_count || 0);
    for (const nextEvent of nextTriggerEvents(String(row.trigger_event))) {
      if (taken.has(nextEvent)) continue;
      // ⛔ dedup 축은 trigger_event다 — template_code로 하면 repeat 3종이 서로를 오차단한다.
      if (activeTriggers.has(nextEvent)) continue;
      const key = triggerKeyForEvent(nextEvent);
      if (!key || availability[key]?.available !== true) continue;
      const copy = SUCCESSION_COPY[nextEvent];
      if (!copy) continue;   // 문구 없는 간선은 권하지 않는다(모르는 것을 지어내지 않는다)

      const notices = [copy.futureNotice];
      if (overlapTriggerEvents(nextEvent).some((e) => activeTriggers.has(e))) notices.push(OVERLAP_NOTICE);

      taken.add(nextEvent);
      out.push({
        type: 'succession',
        templateCode: toCardTemplateCode(triggerTemplateCode(nextEvent)),
        title: copy.title,
        description: copy.describe(count),
        count,
        valueAtStake: Math.round(Number(row.value_at_stake || 0)),
        priority: 'medium',
        suggestedObjective: copy.objective,
        preferTriggerEvent: nextEvent,
        notices,
      });
    }
  }
  return out;
}
