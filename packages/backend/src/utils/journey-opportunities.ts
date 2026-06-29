/**
 * CT utils/journey-opportunities.ts (2026-06-29 신설)
 *
 * "오늘의 여정 기회" — 회사 실데이터를 훑어 여정이 비어 있는 지점을 수치와 함께 제시.
 *   마케터가 무엇을 만들지 고민하지 않도록 AI Operator 랜딩 최상단에서 1클릭 생성으로 연결.
 *
 * 영구 원칙 정합:
 *  - 회사 격리 의무 (company_id 필터)
 *  - Read-only 집계 (한줄로 운영 영향 0)
 *  - 실데이터 count만 — 전환율/매출 추정 같은 임의 상수 0 (feedback_no_arbitrary_constants)
 *  - 이미 같은 유형 활성 여정이 있으면 기회에서 제외 (중복 제안 방지)
 *
 * 컬럼 출처 = SCHEMA.md 2026-06-29 information_schema 실측 대조:
 *  - customers.last_cart_add_at / recent_purchase_date / created_at / is_active / is_invalid
 *  - journeys.template_code / status / archived_at
 */

import { query } from '../config/database';

export type JourneyOpportunityType = 'cart_recovery' | 'onboarding' | 'dormant';

export interface JourneyOpportunity {
  type: JourneyOpportunityType;
  /** 1클릭 생성이 쓸 빠른 시작 템플릿 코드 */
  templateCode: 'cart' | 'onboarding' | 'dormant';
  title: string;
  description: string;
  /** 조건에 해당하는 실제 고객 수 (추정 아님) */
  count: number;
  /** 1클릭 생성 시 자연어 입력에 프리필할 목표 (구체 혜택 미포함 — 골격만) */
  suggestedObjective: string;
}

/**
 * 회사의 여정 기회를 실데이터로 산출. 활성 여정이 이미 커버하는 유형은 제외.
 * count = 0 이거나 이미 활성 여정이 있는 유형은 결과에서 빠진다(노출할 기회만 반환).
 */
export async function buildJourneyOpportunities(companyId: string): Promise<JourneyOpportunity[]> {
  // 활성(미보관) 여정의 template_code 집합 — 이미 커버 중인 기회는 제안하지 않는다.
  const activeRes = await query(
    `SELECT DISTINCT template_code
       FROM journeys
      WHERE company_id = $1 AND status = 'active' AND archived_at IS NULL`,
    [companyId],
  );
  const activeTemplates = new Set<string>(activeRes.rows.map((r: any) => String(r.template_code)));

  const opportunities: JourneyOpportunity[] = [];

  // 1) 장바구니 이탈 미회복 — 최근 14일 안 담기 + 그 이후 구매 없음
  if (!activeTemplates.has('cart')) {
    const r = await query(
      `SELECT COUNT(*)::int AS cnt
         FROM customers
        WHERE company_id = $1
          AND is_active = true
          AND COALESCE(is_invalid, false) = false
          AND last_cart_add_at IS NOT NULL
          AND last_cart_add_at >= NOW() - INTERVAL '14 days'
          AND (recent_purchase_date IS NULL OR recent_purchase_date < last_cart_add_at::date)`,
      [companyId],
    );
    const cnt = Number(r.rows[0]?.cnt || 0);
    if (cnt > 0) {
      opportunities.push({
        type: 'cart_recovery',
        templateCode: 'cart',
        title: '장바구니 이탈 미회복',
        description: `최근 14일 안에 장바구니에 담고 구매하지 않은 고객 ${cnt.toLocaleString()}명이 회복 여정 없이 남아 있어요.`,
        count: cnt,
        suggestedObjective: '장바구니에 담고 구매하지 않은 고객 회복 — 담은 상품 리마인드 + 결제 유도 2단계',
      });
    }
  }

  // 2) 신규 가입 미환영 — 최근 7일 가입
  if (!activeTemplates.has('onboarding')) {
    const r = await query(
      `SELECT COUNT(*)::int AS cnt
         FROM customers
        WHERE company_id = $1
          AND is_active = true
          AND COALESCE(is_invalid, false) = false
          AND created_at >= NOW() - INTERVAL '7 days'`,
      [companyId],
    );
    const cnt = Number(r.rows[0]?.cnt || 0);
    if (cnt > 0) {
      opportunities.push({
        type: 'onboarding',
        templateCode: 'onboarding',
        title: '신규 가입 미환영',
        description: `최근 7일 안에 가입한 고객 ${cnt.toLocaleString()}명에게 환영 여정이 없어요.`,
        count: cnt,
        suggestedObjective: '신규 가입자 환영 시리즈 — 첫 인사 + 첫 구매 유도',
      });
    }
  }

  // 3) 장기 무구매 휴면 — 기존 구매 고객 중 90일 이상 무구매
  if (!activeTemplates.has('dormant')) {
    const r = await query(
      `SELECT COUNT(*)::int AS cnt
         FROM customers
        WHERE company_id = $1
          AND is_active = true
          AND COALESCE(is_invalid, false) = false
          AND recent_purchase_date IS NOT NULL
          AND recent_purchase_date < (NOW() - INTERVAL '90 days')::date`,
      [companyId],
    );
    const cnt = Number(r.rows[0]?.cnt || 0);
    if (cnt > 0) {
      opportunities.push({
        type: 'dormant',
        templateCode: 'dormant',
        title: '장기 무구매 휴면',
        description: `90일 이상 구매가 없는 기존 고객 ${cnt.toLocaleString()}명이 이탈 위험에 있어요.`,
        count: cnt,
        suggestedObjective: '90일 이상 휴면 고객 복귀 유도 — 재방문 안내',
      });
    }
  }

  return opportunities;
}
