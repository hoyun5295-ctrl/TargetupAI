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

import { createHash } from 'crypto';
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
  getTriggerContract,
  type TriggerContract,
} from './journey-trigger-capability';
// ★ 정답표를 갖지 않는다 — 이 회사가 그 트리거를 판정할 수 있는지는 회사 데이터가 정한다.
import { getCompanyJourneyFacts } from './company-data-profile';
// ★ 2026-09-29 여정 V2 1차 — 정보 알림(알림톡 · 광고 아님)은 마케팅 구간을 채운 것으로 세지 않는다(생애 지도와 같은 판정).
import { MARKETING_JOURNEY_SQL } from './journey-lifecycle-map';
import { triggerLabel, isProductPickTrigger } from './journey-trigger-capability';
// ★ 2026-10-09 AI 진단 — 구매 리듬 · 상품 주기 = journey-product CT(같은 문 · 같은 키 규칙) · 휴면 기본값 = 생애 지도와 같은 상수
import { currentPurchaseDoor, loadPurchaseRhythm, loadProductCycles, type PurchaseRhythm, type ProductCycle } from './journey-product';
import { DEFAULT_DORMANT_DAYS } from './journey-lifecycle-map';
import { getCreditCost } from './ai-credit-calc';

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
  // ★ 2026-09-29 여정 V2 1차 — 판정 축을 trigger_event 하나로 옮겼다(설계서 §5 · 회의론자 검증 9).
  //   옛: template_code 로 셌다 — 첫 구매 · 주문 완료 · 휴면 복귀가 같은 'repeat' 을 써서 서로를 "이미 있음"으로 가렸고,
  //   주문 완료 알림톡(정보 알림)이 재구매 구간을 채운 것으로 셌다. 이제 마케팅 여정의 트리거만 센다.
  const activeRes = await query(
    `SELECT DISTINCT j.trigger_event FROM journeys j
      WHERE j.company_id = $1 AND j.status = 'active' AND j.archived_at IS NULL AND ${MARKETING_JOURNEY_SQL}`,
    [companyId],
  );
  const activeTriggers = new Set<string>(activeRes.rows.map((r: any) => String(r.trigger_event)));

  // 2) 회사 구매 분포 — 데이터 기반 임계값 (하드코딩 대신 분포에서 도출)
  const statRes = await query(
    `SELECT
       PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY avg_order_value) FILTER (WHERE avg_order_value > 0) AS median_aov
     FROM customers
     WHERE company_id = $1 AND is_active = true AND COALESCE(is_invalid, false) = false`,
    [companyId],
  );
  const srow = statRes.rows[0] || {};
  const medianAov = Math.max(0, Number(srow.median_aov || 0));
  // ★ 2026-10-09 — 휴면 · 재구매 주기 기준 = 구매 리듬(재구매 간격 분포 · AI 진단과 같은 값).
  //   옛: "마지막 구매 후 지난 일수" 분포를 "평소 재구매 주기"라 불렀고, 비면 45 · 90일 상수로 채웠다(주기가 아니다 · 임의 상수).
  //   표본이 부족하면 두 카드는 내지 않는다(지어낸 기준으로 권하지 않는다).
  const rhythm = await loadCompanyRhythm(companyId).catch(() => null);
  const dormantCut = dormantDaysFromRhythm(rhythm);
  const repurStart = rhythm?.gap.p50 ?? null;
  const rhythmOk = dormantCut != null && repurStart != null && repurStart < dormantCut;
  const p75Days = rhythmOk ? dormantCut! : 100000;
  const medianDays = rhythmOk ? repurStart! : 100000;

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

  if (!activeTriggers.has('cdp.cart_abandon') && num(a.cart_cnt) > 0) {
    out.push({
      type: 'cart_recovery', templateCode: 'cart', title: '장바구니 이탈 미회복', preferTriggerEvent: 'cdp.cart_abandon',
      count: num(a.cart_cnt), valueAtStake: num(a.cart_val), priority: 'medium',
      description: `최근 14일 안에 담고 구매하지 않은 ${num(a.cart_cnt).toLocaleString()}명. 1인 평균 ${perHead(num(a.cart_val), num(a.cart_cnt))} 규모라 회복 여력이 큽니다.`,
      suggestedObjective: '장바구니에 담고 구매하지 않은 고객 회복: 담은 상품 리마인드 + 결제 유도 2단계',
    });
  }
  if (!activeTriggers.has('customer.created') && num(a.onb_cnt) > 0) {
    out.push({
      type: 'onboarding', templateCode: 'onboarding', title: '신규 가입 미환영', preferTriggerEvent: 'customer.created',
      count: num(a.onb_cnt), valueAtStake: Math.round(num(a.onb_cnt) * aov), priority: 'medium',
      description: `최근 7일 안에 가입한 ${num(a.onb_cnt).toLocaleString()}명. 첫 구매 전환의 골든타임입니다.`,
      suggestedObjective: '신규 가입자 환영 시리즈: 첫 인사 + 첫 구매 유도',
    });
  }
  if (rhythmOk && !activeTriggers.has('customer.dormant') && num(a.dorm_cnt) > 0) {
    out.push({
      type: 'dormant', templateCode: 'dormant', title: '장기 무구매 휴면', preferTriggerEvent: 'customer.dormant',
      count: num(a.dorm_cnt), valueAtStake: num(a.dorm_val), priority: 'medium',
      description: `다시 사는 간격(열에 아홉이 ${p75Days}일 안)을 넘겨 ${p75Days}일 이상 무구매인 ${num(a.dorm_cnt).toLocaleString()}명. 누적 ${won(num(a.dorm_val))} 구매한 고객층이라 재활성 가치가 높습니다.`,
      suggestedObjective: '장기 휴면 고객 복귀 유도: 재방문 안내',
    });
  }
  if (!activeTriggers.has('customer.birthday_approaching') && num(a.bday_cnt) > 0) {
    out.push({
      type: 'birthday', templateCode: 'birthday', title: '생일 임박', preferTriggerEvent: 'customer.birthday_approaching',
      count: num(a.bday_cnt), valueAtStake: Math.round(num(a.bday_cnt) * aov), priority: 'medium',
      description: `7일 안에 생일인 ${num(a.bday_cnt).toLocaleString()}명. 축하 메시지로 재방문 유도 적기입니다.`,
      suggestedObjective: '생일 7일 전 사전 축하 + 등급별 인사',
    });
  }
  if (rhythmOk && !activeTriggers.has('customer.cycle_lapsed') && num(a.repur_cnt) > 0) {
    out.push({
      type: 'repurchase_due', templateCode: 'repeat', title: '재구매 주기 도래', preferTriggerEvent: 'customer.cycle_lapsed',
      count: num(a.repur_cnt), valueAtStake: num(a.repur_val), priority: 'medium',
      description: `다시 살 때(보통 ${medianDays}일)를 지나 휴면 기준(${p75Days}일) 전인 ${num(a.repur_cnt).toLocaleString()}명. 휴면 전 리마인드 적기입니다.`,
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

/** 목표 신호(계약 exit)별 여정 목표 한 구절. ⛔ 혜택 · 숫자는 넣지 않는다(프리셋 1클릭 경로는 혜택 근거가 없다 · AI 임의 혜택 금지). */
const EXIT_GOAL_PHRASE: Record<TriggerContract['exit'], string> = {
  purchase: '구매로 이어지게 합니다',
  second_purchase: '두 번째 구매로 이어지게 합니다',
  next_purchase: '다음 구매로 이어지게 합니다',
  steps_done: '필요한 안내를 제때 전합니다',
  points_used: '포인트가 사라지기 전에 쓰도록 안내합니다',
  reservation_closed: '예약한 방문까지 안내합니다',
  product_repurchase: '같은 상품을 다시 사도록 권합니다',
};

/**
 * ★ 2026-09-30 여정 V2 — 시작 사건만 온 1클릭 생성(지도 · 빈 곳 찾기 · 다음 수)의 목표 골격. **켤 수 있는 모든 시작 사건에 문장이 있다.**
 *   이어받는 여정 3종은 추천 카드와 같은 문장(successionObjectiveFor) · 나머지는 계약의 시작 설명 · 이름 · 목표 신호로 만든다.
 *   옛: 이어받는 3종에만 문장이 있어 지도 [만들기]가 가입 · 장바구니 · 생일 같은 나머지 시작 사건에서 개발용 문구 500 으로 멈췄다(0930 Harold 접수).
 *   켤 수 없는(미구현 · 미등록) 시작 사건 = null(생성기가 앞에서 거부한다).
 */
export function presetObjectiveFor(triggerEvent: string): string | null {
  const succession = successionObjectiveFor(triggerEvent);
  if (succession) return succession;
  const c = getTriggerContract(triggerEvent);
  if (!c || !c.implemented) return null;
  // 상시(고른 고객) 여정은 이름이 시작 설명과 같은 말이라 이름을 빼고 적는다.
  const who = c.cls === 'standing' ? '' : ` ${c.label}`;
  return `${c.desc} 보내는${who} 여정: ${EXIT_GOAL_PHRASE[c.exit]}`;
}

/** 겹침 안내 — 계약의 겹침 쌍에서 문장을 만든다(★ 0929 V2: 첫 구매 ↔ 주문 완료 쌍이 더해져 고정 문장이 틀리게 됐다). */
function overlapNotice(nextEvent: string, activeOverlaps: string[]): string {
  const names = activeOverlaps.map((e) => triggerLabel(e)).filter(Boolean).join(' · ');
  return `${triggerLabel(nextEvent)} 여정과 ${names} 여정은 같은 구매 한 번에 둘 다 발송될 수 있어요.`;
}

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
      // ★ 2026-09-30 V2 3차 — 상품을 골라야 만드는 여정(상품 재구매)은 1클릭 다음 수가 될 수 없다(지도 · 상품 고르기 창에서 권한다).
      if (isProductPickTrigger(nextEvent)) continue;
      // ⛔ dedup 축은 trigger_event다 — template_code로 하면 repeat 3종이 서로를 오차단한다.
      if (activeTriggers.has(nextEvent)) continue;
      const key = triggerKeyForEvent(nextEvent);
      if (!key || availability[key]?.available !== true) continue;
      const copy = SUCCESSION_COPY[nextEvent];
      if (!copy) continue;   // 문구 없는 간선은 권하지 않는다(모르는 것을 지어내지 않는다)

      const notices = [copy.futureNotice];
      const activeOverlaps = overlapTriggerEvents(nextEvent).filter((e) => activeTriggers.has(e));
      if (activeOverlaps.length > 0) notices.push(overlapNotice(nextEvent, activeOverlaps));

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

// ════════════════════════════════════════════════════════════════════
// ★ 2026-10-09 고객 관계 지도 — AI 진단(설계서 docs/2026-10-09-journey-crm-map-design.md §5)
//
//   사실 · 간격은 SQL(구매 리듬 · 상품별 주기 = journey-product CT) · AI 는 초안의 문안 · 이름만(여기서는 호출 0 · 차감 0).
//   표본 미달 · 연동 잠금 · 이미 있음을 숨기지 않고 상태 문구로 보여 준다. 캐시는 리듬 사실만(빈 곳 판정은 매번 · 회의론자 D7).
// ════════════════════════════════════════════════════════════════════

export type FlowPlanKey = 'signup' | 'first_purchase' | 'repurchase' | 'dormant' | 'dormant_return';

export interface FlowPlanItem {
  key: FlowPlanKey;
  triggerEvent: string;
  title: string;
  objective: string;
  /** 칸마다 시작부터 누적 일수(D+N). 칸 수 = 길이(1~4). */
  daysFromStart: number[];
  /** 휴면 2종만 — 두 여정이 같은 값(회의론자 D1). */
  dormantDays: number | null;
  /** 실측으로 정한 간격인가(false = 참고 간격 · 이유는 evidence). */
  measured: boolean;
  evidence: string;
  sample: number | null;
  /** ready = 만들 수 있음 · exists = 켜진 여정 있음 · drafted = 초안 · 멈춤만 있음(다시 권하지 않는다) · locked = 데이터 연동 필요. */
  status: 'ready' | 'exists' | 'drafted' | 'locked';
  reason: string;
}

export interface JourneyDiagnosis {
  computedAt: string;
  /** null = 구매 데이터가 없다(연동 전). */
  rhythm: PurchaseRhythm | null;
  facts: Array<{ label: string; value: string }>;
  flowPlan: FlowPlanItem[];
  products: Array<ProductCycle & { status: 'ready' | 'exists' }>;
  quote: { draftEach: number; activateEach: number };
  source: string;
}

/** 이탈 기준일 = 재구매 간격 p90 을 30~365 로 묶은 값(표본 미달 = null · 지어내지 않는다). */
export function dormantDaysFromRhythm(r: PurchaseRhythm | null): number | null {
  if (!r || r.gap.p90 == null) return null;
  return Math.min(365, Math.max(30, r.gap.p90));
}

/** 칸 사이 최대 대기(일) — 생성기 · 저장 상한(MAX_STEP_DELAY_HOURS = 365일)과 같은 값. 계획에서 미리 맞춘다(저장이 몰래 자르지 않게 · Codex 1R). */
export const PLAN_MAX_GAP_DAYS = 365;
const increasing = (xs: number[]): number[] => {
  const out: number[] = [];
  for (const x of xs) {
    const prev = out.length === 0 ? 0 : out[out.length - 1];
    const lo = out.length === 0 ? 0 : prev + 1;
    out.push(Math.min(prev + PLAN_MAX_GAP_DAYS, Math.max(lo, Math.round(x))));
  }
  return out;
};
const wasCapped = (xs: number[], out: number[]) => xs.some((x, i) => Math.round(x) > out[i]);

/** 계획 세트(순수 · DB 0) — 레인마다 하나. 간격 규칙과 근거 문장을 같이 낸다. */
export function buildFlowPlan(
  rhythm: PurchaseRhythm | null,
  activeTriggers: Set<string>,
  availability: Record<string, { available: boolean; reason: string } | undefined>,
  draftedTriggers: Set<string> = new Set(),
): FlowPlanItem[] {
  const f2s = rhythm?.firstToSecond;
  const gap = rhythm?.gap;
  const dormant = dormantDaysFromRhythm(rhythm);
  const dormantDays = dormant ?? DEFAULT_DORMANT_DAYS;
  const short = (n: number) => `표본 ${n.toLocaleString()}건이라 아직 실측으로 정하지 않았어요. 참고 간격으로 시작하고 초안에서 고칠 수 있어요.`;
  const items: Array<Omit<FlowPlanItem, 'status' | 'reason'>> = [
    {
      key: 'signup', triggerEvent: 'customer.created', title: '신규 가입 환영',
      objective: '가입한 고객을 반기고 첫 구매로 이어지게 합니다.',
      daysFromStart: [0, 2, 5], dormantDays: null, measured: false, sample: null,
      evidence: '가입한 날을 따로 받지 않아 가입부터 첫 구매까지 걸린 날은 잴 수 없어요. 참고 간격으로 시작해요.',
    },
    f2s && f2s.p50 != null && f2s.p75 != null
      ? {
        key: 'first_purchase', triggerEvent: 'purchase.first', title: '첫 구매 감사',
        objective: '첫 구매에 감사하고 두 번째 구매로 이어지게 합니다.',
        daysFromStart: [1, f2s.p50, f2s.p75], dormantDays: null, measured: true, sample: f2s.sample,
        evidence: `첫 구매 뒤 두 번째 구매까지 보통 ${f2s.p50}일, 늦어도 ${f2s.p75}일 안에 사요(${f2s.sample.toLocaleString()}명).`,
      }
      : {
        key: 'first_purchase', triggerEvent: 'purchase.first', title: '첫 구매 감사',
        objective: '첫 구매에 감사하고 두 번째 구매로 이어지게 합니다.',
        daysFromStart: [1, 14, 28], dormantDays: null, measured: false, sample: f2s?.sample ?? 0, evidence: short(f2s?.sample ?? 0),
      },
    gap && gap.p50 != null
      ? {
        key: 'repurchase', triggerEvent: 'cdp.purchase', title: '단골 재구매',
        objective: '다시 산 고객에게 감사하고 다음 구매를 권합니다.',
        daysFromStart: [3, gap.p50], dormantDays: null, measured: true, sample: gap.sample,
        evidence: `다시 사는 간격이 보통 ${gap.p50}일이에요(${gap.sample.toLocaleString()}건).`,
      }
      : {
        key: 'repurchase', triggerEvent: 'cdp.purchase', title: '단골 재구매',
        objective: '다시 산 고객에게 감사하고 다음 구매를 권합니다.',
        daysFromStart: [3, 30], dormantDays: null, measured: false, sample: gap?.sample ?? 0, evidence: short(gap?.sample ?? 0),
      },
    {
      key: 'dormant', triggerEvent: 'customer.dormant', title: '휴면 고객 다시 만나기',
      objective: '한동안 구매가 없는 고객에게 다시 인사하고 다시 오게 합니다.',
      daysFromStart: [0, 7], dormantDays, measured: dormant != null, sample: gap?.sample ?? 0,
      evidence: dormant != null
        ? `열에 아홉은 ${gap!.p90}일 안에 다시 사요. 그보다 오래(${dormantDays}일) 안 사면 휴면으로 봅니다.`
        : `재구매 표본이 부족해 기본 기준(${dormantDays}일)으로 시작해요.`,
    },
    {
      key: 'dormant_return', triggerEvent: 'customer.dormant_return', title: '돌아온 고객 환영',
      objective: '오랜만에 다시 산 고객을 반기고 단골로 이어지게 합니다.',
      daysFromStart: [1], dormantDays, measured: dormant != null, sample: gap?.sample ?? 0,
      evidence: `휴면 여정과 같은 기준(${dormantDays}일)으로 복귀를 봅니다.`,
    },
  ];
  return items.map((raw) => {
    const daysFromStart = increasing(raw.daysFromStart);
    const it = wasCapped(raw.daysFromStart, daysFromStart)
      ? { ...raw, daysFromStart, evidence: `${raw.evidence} 칸 사이 간격은 최대 ${PLAN_MAX_GAP_DAYS}일이라 그 안으로 맞췄어요.` }
      : { ...raw, daysFromStart };
    const cap = availability[triggerKeyForEvent(it.triggerEvent) || ''];
    if (activeTriggers.has(it.triggerEvent)) return { ...it, status: 'exists' as const, reason: '이미 켜진 여정이 있어요.' };
    if (draftedTriggers.has(it.triggerEvent)) return { ...it, status: 'drafted' as const, reason: '만들어 둔 초안이 있어요. 켜기 전 점검에서 확인하고 켜 주세요.' };
    if (cap && !cap.available) return { ...it, status: 'locked' as const, reason: cap.reason };
    return { ...it, status: 'ready' as const, reason: '' };
  });
}

const DIAG_TTL_MS = 24 * 60 * 60 * 1000;
const diagCache = new Map<string, { at: number; rhythm: PurchaseRhythm | null; products: ProductCycle[] }>();

async function loadDiagnosisFacts(companyId: string): Promise<{ at: number; rhythm: PurchaseRhythm | null; products: ProductCycle[] }> {
  const hit = diagCache.get(companyId);
  if (hit && Date.now() - hit.at < DIAG_TTL_MS) return hit;
  const door = await currentPurchaseDoor(companyId);
  const rhythm = await loadPurchaseRhythm(companyId, door);
  const products = rhythm.buyers > 0 ? await loadProductCycles(companyId, door) : [];
  const entry = { at: Date.now(), rhythm: rhythm.buyers > 0 ? rhythm : null, products };
  diagCache.set(companyId, entry);
  return entry;
}

/** 리듬 사실 캐시 비우기(시드 스크립트가 데이터를 넣은 직후 · 테스트). */
export function clearDiagnosisCache(companyId?: string): void {
  if (companyId) diagCache.delete(companyId); else diagCache.clear();
}

/** 리듬 사실만(캐시) — 기회 카드의 휴면 · 재구매 주기 기준이 같은 값을 쓴다(두 벌 금지). */
export async function loadCompanyRhythm(companyId: string): Promise<PurchaseRhythm | null> {
  return (await loadDiagnosisFacts(companyId)).rhythm;
}

export async function buildJourneyDiagnosis(companyId: string): Promise<JourneyDiagnosis> {
  const facts0 = await loadDiagnosisFacts(companyId);
  const activeRes = await query(
    `SELECT DISTINCT j.trigger_event, j.status FROM journeys j
      WHERE j.company_id = $1 AND j.status IN ('active', 'paused', 'draft') AND j.archived_at IS NULL AND ${MARKETING_JOURNEY_SQL}`,
    [companyId],
  );
  const activeTriggers = new Set<string>(activeRes.rows.filter((r: any) => r.status === 'active').map((r: any) => String(r.trigger_event)));
  // 초안 · 멈춤만 있는 레인 = 다시 권하지 않는다(만든 초안을 또 만들어 또 과금하지 않게 · Codex 1R medium).
  const draftedTriggers = new Set<string>(activeRes.rows.filter((r: any) => r.status !== 'active').map((r: any) => String(r.trigger_event)));
  const productRes = await query(
    `SELECT trigger_filters FROM journeys
      WHERE company_id = $1 AND trigger_event = 'purchase.product' AND status IN ('active', 'paused', 'draft') AND archived_at IS NULL`,
    [companyId],
  );
  const coveredKeys = new Set<string>();
  for (const r of productRes.rows) for (const k of ((r.trigger_filters || {}).product_keys || [])) coveredKeys.add(String(k));
  const availability = toAvailabilityMap(resolveTriggerAvailability(await getCompanyJourneyFacts(companyId)));
  const rhythm = facts0.rhythm;
  const dormant = dormantDaysFromRhythm(rhythm);
  const facts: JourneyDiagnosis['facts'] = [];
  if (rhythm) {
    facts.push({ label: '구매한 고객', value: `${rhythm.buyers.toLocaleString()}명 · 두 번 이상 산 고객 ${rhythm.repeaters.toLocaleString()}명` });
    const f = rhythm.firstToSecond;
    facts.push({
      label: '첫 구매 뒤 두 번째 구매까지',
      value: f.p50 != null ? `보통 ${f.p50}일 · 가운데 절반이 ${f.p25}~${f.p75}일` : `표본 ${f.sample.toLocaleString()}건이라 아직 말하기 어려워요`,
    });
    const g = rhythm.gap;
    facts.push({
      label: '다시 사는 간격',
      value: g.p50 != null ? `보통 ${g.p50}일 · 열에 아홉은 ${g.p90}일 안에` : `표본 ${g.sample.toLocaleString()}건이라 아직 말하기 어려워요`,
    });
    facts.push({ label: '휴면으로 볼 기준', value: dormant != null ? `${dormant}일 넘게 안 사면` : `표본이 부족해 기본 기준(${DEFAULT_DORMANT_DAYS}일)` });
  }
  return {
    computedAt: new Date(facts0.at).toISOString(),
    rhythm,
    facts,
    flowPlan: buildFlowPlan(rhythm, activeTriggers, availability, draftedTriggers),
    products: facts0.products.map((p) => ({ ...p, status: coveredKeys.has(p.key) ? 'exists' as const : 'ready' as const })),
    quote: { draftEach: getCreditCost('journey-ai-generate'), activateEach: getCreditCost('journey-activate') },
    source: rhythm
      ? `숫자는 구매 원장 실측(${rhythm.door === 'mall' ? '자사몰 주문' : '매장 구매 내역'} · 최근 730일 · 하루 한 번으로 셈)`
      : '구매 데이터가 아직 없어 실측할 수 없어요. 구매 내역을 연동하면 간격을 실측으로 정합니다.',
  };
}

/**
 * 추천 초안 요청 키(결정적) — 회사 · 시작 사건 · 간격 · 휴면 기준일 **내용만**으로 계산한다(Codex 3R high · 4R medium).
 *   화면이 만든 무작위 키는 화면 수명(창 · 페이지)이 끝날 때마다 새로 생겨, 결과를 모르는 요청을 다시 보낼 때 다른 요청으로 보였다.
 *   날짜도 넣지 않는다 — 넣으면 자정을 넘긴 재시도가 다른 요청이 된다. 같은 내용 = 같은 키 → 과금 원장 시도 키(차감이 있으면 DRAFT_ALREADY_MADE).
 *   대가: 같은 내용의 초안을 다시 만들 수 없다(실측 간격이 바뀌면 키가 바뀐다 · 직접 만들기 경로는 그대로).
 */
export function recoRequestId(companyId: string, plan: Pick<FlowPlanItem, 'triggerEvent' | 'daysFromStart' | 'dormantDays'>): string {
  const h = createHash('sha256')
    .update(`${companyId}|reco|${plan.triggerEvent}|${plan.daysFromStart.join(',')}|${plan.dormantDays ?? ''}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** 추천 계획 하나를 서버가 다시 계산해 돌려준다(화면이 보낸 숫자는 믿지 않는다 · 설계서 §5). */
export async function recoPlanFor(companyId: string, triggerEvent: string): Promise<FlowPlanItem | null> {
  const d = await buildJourneyDiagnosis(companyId);
  return d.flowPlan.find((p) => p.triggerEvent === triggerEvent) || null;
}
