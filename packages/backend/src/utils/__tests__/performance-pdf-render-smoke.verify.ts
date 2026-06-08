// PDF 렌더 스모크 — mock doc 주입(pdfkit 미사용). 데이터부족/데이터있음 양쪽 분기가 런타임 에러 0인지 검증.
// render는 DB import 없음(분석 타입은 import type → 런타임 제거)이라 ts-node 실행 가능.
import assert from 'node:assert';
import { renderPerformanceReportPdf } from '../performance-pdf-render';

// 모든 메서드를 체이닝 no-op으로 — render가 호출하는 doc API 전부.
function mockDoc(): any {
  const d: any = {};
  for (const m of ['fontSize', 'fillColor', 'text', 'moveTo', 'lineTo', 'strokeColor', 'stroke', 'font', 'addPage']) {
    d[m] = () => d;
  }
  return d;
}

const baseSnapshot: any = {
  totalCampaigns: { current: 0, diffPct: 0 },
  totalSent: { current: 0, diffPct: 0 },
  successRate: { current: 0, diffPct: 0 },
  newCustomers: { current: 0, diffPct: 0 },
  activeCustomers: { current: 0, diffPct: 0 },
  estimatedRevenue: { current: 0, diffPct: 0 },
  byChannelROI: [],
  topCampaigns: [],
  byHourWeekday: [],
  funnelStats: null,
  source: 'mock',
};

// 1) 전부 데이터부족(null/빈/sufficient=false/unavailable) → 에러 없이 완주
renderPerformanceReportPdf(mockDoc(), {
  snapshot: baseSnapshot,
  explanation: null,
  cohort: null,
  attribution: null,
  companyName: '목업회사',
  period: '30d',
  segment: { totalActive: 0, rfm: { sufficient: false, totalCustomers: 0, withPurchaseData: 0, segments: [] }, byGrade: [], ltvAvailable: false, avgLtv: null },
  multidim: { byType: [], newVsExisting: { newCount: 0, existingCount: 0, total: 0, newPct: 0, reactionAvailable: false } },
  message: { byType: [], lengthDist: [{ bucket: '단문', count: 0 }, { bucket: '중문', count: 0 }, { bucket: '장문', count: 0 }] },
  forecast: { trend: { available: false, slopePerDay: 0, recentAvg: 0, direction: 'flat', projectedNextPeriod: null, revenueAvailable: false }, missed: { atRiskCount: 0, dormantCount: 0, potentialRevenue: null } },
  actionPlan: [],
} as any);

// 2) 풀분석 신규 필드 미전달(무료 report-pdf 경로) → optional 생략, 에러 없이 완주
renderPerformanceReportPdf(mockDoc(), {
  snapshot: baseSnapshot,
  explanation: null,
  cohort: null,
  attribution: null,
  companyName: '무료',
  period: '7d',
} as any);

// 3) 데이터 있는 케이스(전 섹션 값) → 에러 없이 완주
renderPerformanceReportPdf(mockDoc(), {
  snapshot: {
    ...baseSnapshot,
    byChannelROI: [{ channel: 'SMS', sent: 100, successRate: 0.9, estimatedRevenue: 50000, roas: 2.5 }],
    topCampaigns: [{ name: 'A캠', messageType: 'SMS', sent: 100, successRate: 0.9, roas: 2 }],
    byHourWeekday: [{ hour: 10, sent: 50, successRate: 0.9 }],
  },
  explanation: { overallScore: 80, topInsight: '좋음', factors: [{ label: 'f', direction: 'positive', impactScore: 0.5, detail: 'd' }], recommendation: '권장' },
  cohort: { cohorts: [{ cohortMonth: '2026-01', totalCustomers: 100, m1Rate: 0.5, m3Rate: 0.3 }], avgM1Rate: 0.5, avgM3Rate: 0.3 },
  attribution: { totalCampaigns: 1, windows: [{ windowLabel: '24h', cdpPurchaseCount: 0, cdpRevenue: 0, customerPurchaseCount: 5 }], hasCdpData: false },
  companyName: '데이터회사',
  period: '90d',
  segment: { totalActive: 100, rfm: { sufficient: true, totalCustomers: 100, withPurchaseData: 80, segments: [{ label: '충성 우수', count: 20, pct: 25, avgMonetary: 50000 }] }, byGrade: [{ grade: 'VIP', count: 10, pct: 10 }], ltvAvailable: true, avgLtv: 500 },
  multidim: { byType: [{ rawType: 'manual', label: '직접 발송', campaigns: 2, sent: 200, success: 180, successRate: 0.9 }], newVsExisting: { newCount: 10, existingCount: 90, total: 100, newPct: 10, reactionAvailable: false } },
  message: { byType: [{ rawType: 'SMS', label: 'SMS', sent: 100, success: 90, successRate: 0.9, unitCost: 20, estimatedCost: 2000 }], lengthDist: [{ bucket: '단문', count: 5 }, { bucket: '중문', count: 3 }, { bucket: '장문', count: 1 }] },
  forecast: { trend: { available: true, slopePerDay: 1, recentAvg: 50, direction: 'up', projectedNextPeriod: 300, revenueAvailable: false }, missed: { atRiskCount: 5, dormantCount: 3, potentialRevenue: null } },
  actionPlan: [{ priority: 1, title: '액션', basis: '근거', linkHint: '연결', expectedEffect: null }],
} as any);

assert.ok(true);
console.log('performance-pdf-render smoke: PASS');
