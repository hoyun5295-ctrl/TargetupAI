// 성과 보고서 PDF 본문 렌더 (pdfkit doc에 그리기만 — doc.pipe/end는 호출측).
// ai.ts report-pdf + 풀분석 러너(full-analysis-runner) 공유 — 중복 제거(no_inline_duplication).
// 원본: routes/ai.ts report-pdf 본문 1:1 이식. 데이터는 인자로 주입(순수 — DB 호출 없음).
import type { buildPerformanceSnapshotV2 } from './next-action-advisor';
import type { explainPerformance } from './performance-explainer';
import type { buildCohortRetention } from './performance-cohort';
import type { buildBenchmark } from './performance-benchmark';
import type { buildCampaignAttribution } from './campaign-response-attribution';

export interface PerformancePdfData {
  snapshot: Awaited<ReturnType<typeof buildPerformanceSnapshotV2>>;
  explanation: Awaited<ReturnType<typeof explainPerformance>> | null;
  cohort: Awaited<ReturnType<typeof buildCohortRetention>> | null;
  benchmark: Awaited<ReturnType<typeof buildBenchmark>> | null;
  attribution: Awaited<ReturnType<typeof buildCampaignAttribution>> | null;
  companyName: string;
  period: string;
}

export function renderPerformanceReportPdf(doc: any, data: PerformancePdfData): void {
  const { snapshot, explanation, cohort, benchmark, attribution, companyName, period } = data;
  const path = require('path');
  const fs = require('fs');
  const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
  const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
  const hasFont = fs.existsSync(fontPath);
  const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
  const primary = '#7c3aed';
  const dark = '#1f2937';
  const gray = '#6b7280';
  const won = (v: any) => `${Math.round(Number(v) || 0).toLocaleString()}원`;
  const pctStr = (v: any) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
  const dpct = (m: any) => { const d = Number(m?.diffPct) || 0; return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`; };
  const periodLabel: Record<string, string> = { '7d': '최근 7일', '14d': '최근 14일', '30d': '최근 30일', '90d': '최근 90일' };
  const today = new Date().toISOString().slice(0, 10);

  // 헤더
  setFont(true);
  doc.fontSize(22).fillColor(primary).text('성과 리포트', 50, 50);
  setFont(false);
  doc.fontSize(9).fillColor(gray).text('PERFORMANCE REPORT', 50, 78);
  const rx = 350;
  doc.fontSize(9).fillColor(gray).text('회사:', rx, 50, { continued: true });
  setFont(true); doc.fillColor(dark).text(`  ${companyName || '-'}`);
  setFont(false); doc.fontSize(9).fillColor(gray).text('기간:', rx, 65, { continued: true });
  doc.fillColor(dark).text(`  ${periodLabel[period] || period}`);
  doc.fontSize(9).fillColor(gray).text('발행일:', rx, 80, { continued: true });
  doc.fillColor(dark).text(`  ${today}`);
  doc.moveTo(50, 102).lineTo(545, 102).strokeColor('#e5e7eb').stroke();

  // 요약 6 metric (2열 × 3행)
  let y = 116;
  setFont(true); doc.fontSize(13).fillColor(primary).text('요약', 50, y); y += 20;
  const metrics: Array<[string, string, any]> = [
    ['발송 캠페인', (snapshot.totalCampaigns.current || 0).toLocaleString(), snapshot.totalCampaigns],
    ['총 발송', (snapshot.totalSent.current || 0).toLocaleString(), snapshot.totalSent],
    ['성공률', pctStr(snapshot.successRate.current), snapshot.successRate],
    ['신규 고객', (snapshot.newCustomers.current || 0).toLocaleString(), snapshot.newCustomers],
    ['활성 고객', (snapshot.activeCustomers.current || 0).toLocaleString(), snapshot.activeCustomers],
    ['추정 매출', won(snapshot.estimatedRevenue.current), snapshot.estimatedRevenue],
  ];
  for (let i = 0; i < metrics.length; i++) {
    const col = i % 2;
    const x = 50 + col * 260;
    if (col === 0 && i > 0) y += 46;
    const [label, val, m] = metrics[i];
    const d = Number(m?.diffPct) || 0;
    setFont(false); doc.fillColor(gray).fontSize(9).text(label, x, y);
    setFont(true); doc.fillColor(dark).fontSize(15).text(val, x, y + 11);
    setFont(false); doc.fillColor(d >= 0 ? '#059669' : '#dc2626').fontSize(8).text(`직전 대비 ${dpct(m)}`, x + 120, y + 16);
  }
  y += 60;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke(); y += 16;

  // 채널별 ROI
  setFont(true); doc.fontSize(13).fillColor(primary).text('채널별 ROI', 50, y); y += 20;
  setFont(true); doc.fontSize(9).fillColor(gray);
  doc.text('채널', 50, y); doc.text('발송', 170, y); doc.text('성공률', 250, y); doc.text('추정 매출', 340, y); doc.text('ROAS', 470, y);
  y += 13; doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke(); y += 6;
  setFont(false); doc.fontSize(9);
  if (snapshot.byChannelROI.length === 0) {
    doc.fillColor(gray).text('데이터 없음', 50, y); y += 16;
  } else {
    for (const c of snapshot.byChannelROI.slice(0, 8)) {
      doc.fillColor(dark).text(c.channel, 50, y);
      doc.text((c.sent || 0).toLocaleString(), 170, y);
      doc.text(pctStr(c.successRate), 250, y);
      doc.text(won(c.estimatedRevenue), 340, y);
      doc.text(`${(Number(c.roas) || 0).toFixed(2)}x`, 470, y);
      y += 16;
    }
  }
  y += 12;

  // 상위 캠페인
  if (snapshot.topCampaigns.length > 0) {
    if (y > 660) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('상위 캠페인', 50, y); y += 20;
    setFont(true); doc.fontSize(9).fillColor(gray);
    doc.text('캠페인', 50, y); doc.text('채널', 300, y); doc.text('발송', 360, y); doc.text('성공률', 430, y); doc.text('ROAS', 500, y);
    y += 13; doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke(); y += 6;
    setFont(false); doc.fontSize(9);
    for (const t of snapshot.topCampaigns.slice(0, 5)) {
      doc.fillColor(dark).text((t.name || '-').slice(0, 28), 50, y, { width: 240 });
      doc.text(t.messageType || '-', 300, y);
      doc.text((t.sent || 0).toLocaleString(), 360, y);
      doc.text(pctStr(t.successRate), 430, y);
      doc.text(`${(Number(t.roas) || 0).toFixed(2)}x`, 500, y);
      y += 16;
    }
    y += 12;
  }

  // AI 자율 진단 서사
  if (y > 660) { doc.addPage(); y = 50; }
  setFont(true); doc.fontSize(13).fillColor(primary).text('AI 자율 진단', 50, y); y += 20;
  if (explanation && explanation.topInsight) {
    setFont(true); doc.fontSize(10).fillColor(dark).text(`전체 성과 스코어 ${explanation.overallScore}/100`, 50, y); y += 16;
    setFont(false); doc.fontSize(9).fillColor(dark).text(explanation.topInsight, 50, y, { width: 495 }); y += 24;
    if (explanation.factors.length > 0) {
      setFont(true); doc.fontSize(9).fillColor(gray).text('영향 요인', 50, y); y += 14;
      setFont(false); doc.fontSize(9);
      for (const f of explanation.factors.slice(0, 6)) {
        if (y > 740) { doc.addPage(); y = 50; }
        const dir = f.direction === 'positive' ? '▲' : f.direction === 'negative' ? '▼' : '-';
        doc.fillColor(dark).text(`${dir} ${f.label} (${Math.round(f.impactScore * 100)}%) — ${f.detail}`, 60, y, { width: 485 }); y += 14;
      }
      y += 4;
    }
    if (explanation.recommendation) {
      setFont(true); doc.fontSize(9).fillColor(primary).text('1순위 권장', 50, y); y += 13;
      setFont(false); doc.fontSize(9).fillColor(dark).text(explanation.recommendation, 60, y, { width: 485 }); y += 18;
    }
    setFont(false); doc.fontSize(7).fillColor(gray).text('AI 자율 진단은 최근 30일 데이터 기준입니다.', 50, y); y += 14;
  } else {
    const best = [...snapshot.byChannelROI].sort((a, b) => (b.roas || 0) - (a.roas || 0))[0];
    setFont(false); doc.fontSize(9).fillColor(dark);
    const lines = [
      `· 기간 추정 매출 ${won(snapshot.estimatedRevenue.current)} (직전 대비 ${dpct(snapshot.estimatedRevenue)})`,
      best ? `· 최고 효율 채널: ${best.channel} (ROAS ${(best.roas || 0).toFixed(2)}x)` : '',
      `· 평균 성공률 ${pctStr(snapshot.successRate.current)} · 활성 고객 ${(snapshot.activeCustomers.current || 0).toLocaleString()}명`,
    ].filter(Boolean);
    for (const ln of lines) { doc.text(ln, 50, y); y += 15; }
  }
  y += 10;

  // 시간대 분석 (발송량 상위 5)
  if (y > 690) { doc.addPage(); y = 50; }
  setFont(true); doc.fontSize(13).fillColor(primary).text('시간대 분석', 50, y); y += 20;
  const hourAgg = new Map<number, { sent: number; success: number }>();
  for (const cell of snapshot.byHourWeekday) {
    const a = hourAgg.get(cell.hour) || { sent: 0, success: 0 };
    a.sent += cell.sent; a.success += Math.round(cell.sent * cell.successRate);
    hourAgg.set(cell.hour, a);
  }
  const hourRows = Array.from(hourAgg.entries()).filter(([, a]) => a.sent > 0).sort((a, b) => b[1].sent - a[1].sent).slice(0, 5);
  setFont(false); doc.fontSize(9);
  if (hourRows.length === 0) { doc.fillColor(gray).text('발송 데이터 없음', 50, y); y += 16; }
  else {
    for (const [hour, a] of hourRows) {
      const sr = a.sent > 0 ? a.success / a.sent : 0;
      doc.fillColor(dark).text(`${hour}시 — 발송 ${a.sent.toLocaleString()}건 / 성공률 ${pctStr(sr)}`, 50, y); y += 15;
    }
  }
  y += 12;

  // 자사몰 퍼널
  if (snapshot.funnelStats && snapshot.funnelStats.viewCount > 0) {
    if (y > 700) { doc.addPage(); y = 50; }
    const f = snapshot.funnelStats;
    setFont(true); doc.fontSize(13).fillColor(primary).text('자사몰 퍼널', 50, y); y += 20;
    setFont(false); doc.fontSize(9).fillColor(dark);
    doc.text(`조회 ${f.viewCount.toLocaleString()} → 장바구니 ${f.cartAddCount.toLocaleString()} → 위시 ${f.wishlistAddCount.toLocaleString()} → 구매 ${f.purchaseCount.toLocaleString()}`, 50, y); y += 15;
    doc.text(`장바구니 전환율 ${pctStr(f.cartConversionRate)} · 구매 전환율 ${pctStr(f.purchaseConversionRate)} · 장바구니→구매 ${pctStr(f.cartToPurchaseRate)}`, 50, y); y += 18;
  }

  // 캠페인 발송 후 기여
  if (attribution && attribution.totalCampaigns > 0 && attribution.windows.length > 0) {
    if (y > 700) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('캠페인 발송 후 기여', 50, y); y += 20;
    setFont(false); doc.fontSize(9).fillColor(dark);
    for (const w of attribution.windows) {
      const line = attribution.hasCdpData
        ? `발송 후 ${w.windowLabel} — CDP 구매 ${w.cdpPurchaseCount.toLocaleString()}건 / 매출 ${won(w.cdpRevenue)}`
        : `발송 후 ${w.windowLabel} — 구매 고객 ${w.customerPurchaseCount.toLocaleString()}명 (CDP 미연동 추정)`;
      doc.text(line, 50, y); y += 15;
    }
    y += 8;
  }

  // 가입월별 잔존 (코호트)
  if (cohort && cohort.cohorts.length > 0) {
    if (y > 700) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('가입월별 잔존', 50, y); y += 20;
    setFont(false); doc.fontSize(9).fillColor(dark);
    doc.text(`평균 30일 잔존율 ${pctStr(cohort.avgM1Rate)} · 90일 잔존율 ${pctStr(cohort.avgM3Rate)}`, 50, y); y += 15;
    for (const c of cohort.cohorts.slice(0, 6)) {
      doc.text(`${c.cohortMonth} — 가입 ${c.totalCustomers.toLocaleString()}명 / 30일 ${pctStr(c.m1Rate)} / 90일 ${pctStr(c.m3Rate)}`, 50, y); y += 14;
    }
    y += 8;
  }

  // 업계 벤치마크 (Plan 3에서 제거 예정)
  if (benchmark && benchmark.peerCompanyCount > 0 && benchmark.metrics.length > 0) {
    if (y > 700) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text(`업계 벤치마크 (${benchmark.planName})`, 50, y); y += 20;
    setFont(false); doc.fontSize(9).fillColor(dark);
    for (const m of benchmark.metrics) {
      const cv = m.companyValue < 1 && m.companyValue > 0 ? pctStr(m.companyValue) : Math.round(m.companyValue).toLocaleString();
      const iv = m.industryAvg < 1 && m.industryAvg > 0 ? pctStr(m.industryAvg) : Math.round(m.industryAvg).toLocaleString();
      doc.text(`${m.label} — 우리 ${cv} vs 업계 ${iv} (${m.diffPct >= 0 ? '+' : ''}${m.diffPct.toFixed(1)}%)`, 50, y); y += 14;
    }
    y += 8;
  }

  // Source caption
  setFont(false); doc.fontSize(8).fillColor(gray).text(`Data source — ${snapshot.source} · ${today} 생성`, 50, y);
}
