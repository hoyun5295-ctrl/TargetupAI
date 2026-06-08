// 세그먼트 심층 분석 호출부 — customers에서 RFM/등급/LTV 집계.
// 순수 계산은 rfm-segment.ts(TDD). 여기는 DB SELECT + 매핑만. 값이 없으면 각 지표가 데이터부족으로 빠진다.
import { query } from '../config/database';
import { computeRfmSegments, type RfmCustomer, type RfmResult } from './rfm-segment';

export interface GradeBucket {
  grade: string;
  count: number;
  pct: number;
}

export interface SegmentAnalysis {
  totalActive: number;
  rfm: RfmResult;
  byGrade: GradeBucket[];
  ltvAvailable: boolean;
  avgLtv: number | null;
}

export async function buildSegmentAnalysis(companyId: string, nowMs: number): Promise<SegmentAnalysis> {
  const r = await query(
    `SELECT recent_purchase_date, purchase_count, total_purchase_amount, grade, ltv_score
     FROM customers
     WHERE company_id = $1::uuid AND is_active = true`,
    [companyId],
  );
  const rows: any[] = r.rows;
  const total = rows.length;

  const rfmInput: RfmCustomer[] = rows.map((c) => ({
    recencyDays: c.recent_purchase_date ? Math.floor((nowMs - new Date(c.recent_purchase_date).getTime()) / 86400000) : null,
    frequency: c.purchase_count != null ? Number(c.purchase_count) : null,
    monetary: c.total_purchase_amount != null ? Number(c.total_purchase_amount) : null,
  }));
  const rfm = computeRfmSegments(rfmInput);

  // 등급 분포
  const gradeMap = new Map<string, number>();
  for (const c of rows) {
    const g = (c.grade && String(c.grade).trim()) || '미분류';
    gradeMap.set(g, (gradeMap.get(g) || 0) + 1);
  }
  const byGrade: GradeBucket[] = Array.from(gradeMap.entries())
    .map(([grade, count]) => ({ grade, count, pct: total ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);

  // LTV — ltv_score 보유 고객만
  const ltvVals = rows.map((c) => c.ltv_score).filter((v) => v != null).map(Number);
  const ltvAvailable = ltvVals.length > 0;
  const avgLtv = ltvAvailable ? ltvVals.reduce((s, v) => s + v, 0) / ltvVals.length : null;

  return { totalActive: total, rfm, byGrade, ltvAvailable, avgLtv };
}
