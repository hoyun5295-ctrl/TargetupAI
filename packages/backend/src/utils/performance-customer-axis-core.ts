/**
 * ★ CT: 성과리포트 고객 축 — 순수 병합 로직 (DB-free, 2026-07-03)
 *
 * 설계: docs/superpowers/specs/2026-07-03-performance-customer-axis-design.md
 * DB 조회는 performance-customer-axis.ts가 담당 — 이 파일은 등급별 컴포넌트 병합·정렬만.
 * (config/database import 금지 — .verify.ts 순수 테스트가 이 파일만 import)
 */

export interface GradePerformanceRow {
  grade: string;
  journeySent: number;      // 여정 발송 건수 (customer_id 정확 매칭)
  dmSent: number;           // DM 수신 고객 수 (customer_id 정확 매칭)
  dmViewers: number;        // DM 열람 고객 수 (토큰 정확 매칭)
  emailClickers: number;    // 이메일 클릭 고객 수 (email 매칭 — 반응자 기준)
  smsTargetedSent: number;  // SMS/카카오 캠페인 발송 합 (target_filter 등급 근사)
  buyers: number;           // 기간 내 구매 고객 수 (cdp_events)
  revenue: number;          // 기간 내 구매 매출 (cdp_events)
}

/** 등급별 단일 수치 컴포넌트 — 쿼리 1개의 결과 (grade → count) */
export type GradeCountMap = Map<string, number>;

export interface GradeComponents {
  journeySent: GradeCountMap;
  dmSent: GradeCountMap;
  dmViewers: GradeCountMap;
  emailClickers: GradeCountMap;
  smsTargetedSent: GradeCountMap;
  buyers: GradeCountMap;
  revenue: GradeCountMap;
}

/**
 * 등급별 컴포넌트 7종을 GradePerformanceRow[]로 병합.
 * - 어느 컴포넌트에든 등장한 등급은 전부 행 생성 (없는 값 = 0)
 * - 전 컬럼 0인 행 제거
 * - 정렬: 매출 desc → 구매 고객 desc → 발송(여정+DM+SMS) desc → 등급명
 */
export function mergeGradePerformance(c: GradeComponents): GradePerformanceRow[] {
  const grades = new Set<string>();
  for (const m of [c.journeySent, c.dmSent, c.dmViewers, c.emailClickers, c.smsTargetedSent, c.buyers, c.revenue]) {
    for (const g of m.keys()) grades.add(g);
  }

  const rows: GradePerformanceRow[] = [];
  for (const grade of grades) {
    const row: GradePerformanceRow = {
      grade,
      journeySent: c.journeySent.get(grade) || 0,
      dmSent: c.dmSent.get(grade) || 0,
      dmViewers: c.dmViewers.get(grade) || 0,
      emailClickers: c.emailClickers.get(grade) || 0,
      smsTargetedSent: c.smsTargetedSent.get(grade) || 0,
      buyers: c.buyers.get(grade) || 0,
      revenue: c.revenue.get(grade) || 0,
    };
    const total = row.journeySent + row.dmSent + row.dmViewers + row.emailClickers + row.smsTargetedSent + row.buyers + row.revenue;
    if (total > 0) rows.push(row);
  }

  rows.sort((a, b) =>
    (b.revenue - a.revenue) ||
    (b.buyers - a.buyers) ||
    ((b.journeySent + b.dmSent + b.smsTargetedSent) - (a.journeySent + a.dmSent + a.smsTargetedSent)) ||
    a.grade.localeCompare(b.grade, 'ko'),
  );
  return rows;
}

/** 쿼리 rows([{grade, cnt}]) → GradeCountMap. cnt가 float(매출)이어도 그대로 보존. */
export function toGradeCountMap(rows: Array<{ grade: any; cnt: any }>): GradeCountMap {
  const m: GradeCountMap = new Map();
  for (const r of rows || []) {
    const g = String(r.grade || '(미분류)');
    const v = Number(r.cnt);
    if (!isFinite(v) || v <= 0) continue;
    m.set(g, (m.get(g) || 0) + v);
  }
  return m;
}
