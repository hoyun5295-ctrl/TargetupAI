/**
 * ★ CT-F10 — 전단AI RFM 세분화 컨트롤타워
 *
 * Phase B 기능 9번: POS 판매 데이터 기반 RFM 자동 세분화.
 * flyer_pos_sales → flyer_customers.rfm_segment 업데이트.
 *
 * ⚠️ 스켈레톤 — Phase B 구현 시 채운다. 지금은 인터페이스만 정의.
 */

import { query } from '../../config/database';

export type RfmSegment = 'champion' | 'loyal' | 'new' | 'at_risk' | 'lost' | 'whale' | 'unknown';

export interface RfmResult {
  customerId: string;
  recencyDays: number;
  frequency: number;
  monetary: number;
  segment: RfmSegment;
}

/**
 * 단일 고객의 RFM 점수 계산.
 * flyer_pos_sales 최근 90일 기준.
 */
export async function calculateCustomerRfm(
  companyId: string,
  customerId: string
): Promise<RfmResult | null> {
  // Phase B 구현 시 작성
  // flyer_pos_sales에서 customer_id 기준 집계 → segment 판정
  return null;
}

/**
 * 회사 전체 고객 RFM 일괄 재계산 (배치).
 * POS Agent가 데이터 싱크할 때 호출.
 */
export async function recalculateAllRfm(companyId: string): Promise<number> {
  // Phase B 구현 시 작성
  return 0;
}

/**
 * RFM 세그먼트별 고객 수 집계 (대시보드 위젯).
 */
export async function getRfmSegmentCounts(companyId: string): Promise<Record<RfmSegment, number>> {
  const result = await query(
    `SELECT rfm_segment, COUNT(*)::int AS cnt
     FROM flyer_customers
     WHERE company_id = $1 AND deleted_at IS NULL AND rfm_segment IS NOT NULL
     GROUP BY rfm_segment`,
    [companyId]
  );
  const counts: Record<string, number> = {
    champion: 0, loyal: 0, new: 0, at_risk: 0, lost: 0, whale: 0, unknown: 0,
  };
  result.rows.forEach((r: any) => { counts[r.rfm_segment] = r.cnt; });
  return counts as Record<RfmSegment, number>;
}
