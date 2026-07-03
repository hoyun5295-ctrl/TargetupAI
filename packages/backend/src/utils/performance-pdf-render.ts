// 성과 보고서 PDF 본문 렌더 (pdfkit doc에 그리기만 — doc.pipe/end는 호출측).
// ai.ts report-pdf + 풀분석 러너(full-analysis-runner) 공유 — 중복 제거(no_inline_duplication).
// 원본: routes/ai.ts report-pdf 본문 1:1 이식. 데이터는 인자로 주입(순수 — DB 호출 없음).
import type { buildPerformanceSnapshotV2 } from './next-action-advisor';
import type { explainPerformance } from './performance-explainer';
import type { buildCohortRetention } from './performance-cohort';
import type { buildCampaignAttribution } from './campaign-response-attribution';
import type { SegmentAnalysis } from './segment-analysis';
import type { MultiDimComparison, MessageAnalysis, ForecastResult } from './full-analysis-collect';
import type { ActionItem } from './action-plan';
import type { GradePerformanceRow, RecipientAttributionResult } from './performance-customer-axis';

export interface PerformancePdfData {
  snapshot: Awaited<ReturnType<typeof buildPerformanceSnapshotV2>>;
  explanation: Awaited<ReturnType<typeof explainPerformance>> | null;
  cohort: Awaited<ReturnType<typeof buildCohortRetention>> | null;
  attribution: Awaited<ReturnType<typeof buildCampaignAttribution>> | null;
  companyName: string;
  period: string;
  // 풀분석 보강 섹션 (무료 report-pdf는 미전달 → optional). 각 값 없으면 섹션 생략·데이터부족 표기.
  segment?: SegmentAnalysis | null;
  multidim?: MultiDimComparison | null;
  message?: MessageAnalysis | null;
  forecast?: ForecastResult | null;
  actionPlan?: ActionItem[] | null;
  // ★ 2026-07-03 고객 축 — 없으면 섹션 생략 (기존 호출부 무변)
  gradePerformance?: GradePerformanceRow[] | null;
  recipientAttribution?: RecipientAttributionResult | null;
}

export function renderPerformanceReportPdf(doc: any, data: PerformancePdfData): void {
  const { snapshot, explanation, cohort, attribution, companyName, period, segment, multidim, message, forecast, actionPlan, gradePerformance, recipientAttribution } = data;
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
  // 익스큐티브 서머리 (explanation 1p 요약)
  if (explanation && explanation.topInsight) {
    setFont(true); doc.fontSize(13).fillColor(primary).text('익스큐티브 서머리', 50, y); y += 18;
    setFont(true); doc.fontSize(10).fillColor(dark).text(`성과 스코어 ${explanation.overallScore}/100`, 50, y); y += 15;
    setFont(false); doc.fontSize(9).fillColor(dark).text(explanation.topInsight, 50, y, { width: 495 }); y += 22;
    if (explanation.recommendation) {
      setFont(false); doc.fontSize(9).fillColor(primary).text(`1순위 권장: ${explanation.recommendation}`, 50, y, { width: 495 }); y += 18;
    }
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke(); y += 14;
  }
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

  // 수신 고객 기준 기여 (★ 2026-07-03 고객 축 — 여정·DM customer_id 정확 매칭)
  if (recipientAttribution && recipientAttribution.totalRecipients > 0) {
    if (y > 700) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('수신 고객 기준 기여 (여정·DM 정확 매칭)', 50, y); y += 20;
    setFont(false); doc.fontSize(9).fillColor(dark);
    doc.text(`기간 내 수신 고객 ${recipientAttribution.totalRecipients.toLocaleString()}명`, 50, y); y += 15;
    for (const w of recipientAttribution.windows) {
      doc.text(`수신 후 ${w.windowLabel} — 구매 고객 ${w.buyers.toLocaleString()}명 / 구매 ${w.purchases.toLocaleString()}건 / 매출 ${won(w.revenue)}`, 50, y); y += 15;
    }
    y += 8;
  }

  // 고객 등급 성과 (★ 2026-07-03 고객 축)
  if (gradePerformance && gradePerformance.length > 0) {
    if (y > 660) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('고객 등급 성과', 50, y); y += 20;
    setFont(false); doc.fontSize(9).fillColor(dark);
    for (const g of gradePerformance.slice(0, 8)) {
      if (y > 760) { doc.addPage(); y = 50; }
      doc.text(`· ${g.grade} — 여정 ${g.journeySent.toLocaleString()}건 / DM ${g.dmSent.toLocaleString()}명(열람 ${g.dmViewers.toLocaleString()}) / 이메일 클릭 ${g.emailClickers.toLocaleString()} / 구매 ${g.buyers.toLocaleString()}명 / 매출 ${won(g.revenue)}`, 60, y, { width: 485 }); y += 14;
    }
    setFont(false); doc.fontSize(8).fillColor(gray);
    doc.text('여정·DM = 고객 단위 정확 매칭 / 이메일 = 반응자 기준 / SMS 캠페인 발송분은 채널 성과 절 참조', 60, y); y += 16;
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

  // 세그먼트 심층 (RFM + 등급 + LTV)
  if (segment) {
    if (y > 640) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('세그먼트 심층 분석', 50, y); y += 20;
    setFont(false); doc.fontSize(9).fillColor(dark).text(`활성 고객 ${segment.totalActive.toLocaleString()}명`, 50, y); y += 16;
    if (segment.rfm.sufficient) {
      setFont(true); doc.fontSize(10).fillColor(dark).text(`RFM 세그먼트 (구매 데이터 보유 ${segment.rfm.withPurchaseData.toLocaleString()}명)`, 50, y); y += 15;
      setFont(false); doc.fontSize(9);
      for (const s of segment.rfm.segments.slice(0, 8)) {
        if (y > 760) { doc.addPage(); y = 50; }
        doc.fillColor(dark).text(`· ${s.label} — ${s.count.toLocaleString()}명 (${s.pct.toFixed(1)}%) / 평균 구매액 ${won(s.avgMonetary)}`, 60, y, { width: 485 }); y += 14;
      }
      y += 4;
    } else {
      setFont(false); doc.fontSize(9).fillColor(gray).text('RFM — 데이터 부족 (구매 이력 데이터 필요)', 60, y); y += 16;
    }
    if (segment.byGrade.length > 0) {
      if (y > 700) { doc.addPage(); y = 50; }
      setFont(true); doc.fontSize(10).fillColor(dark).text('등급 분포', 50, y); y += 15;
      setFont(false); doc.fontSize(9);
      for (const g of segment.byGrade.slice(0, 6)) {
        doc.fillColor(dark).text(`· ${g.grade} — ${g.count.toLocaleString()}명 (${g.pct.toFixed(1)}%)`, 60, y); y += 14;
      }
      y += 4;
    }
    if (segment.ltvAvailable && segment.avgLtv != null) {
      setFont(false); doc.fontSize(9).fillColor(dark).text(`평균 LTV 스코어 ${Math.round(segment.avgLtv).toLocaleString()}`, 50, y); y += 16;
    } else {
      setFont(false); doc.fontSize(9).fillColor(gray).text('LTV 스코어 — 데이터 부족', 50, y); y += 16;
    }
    y += 6;
  }

  // 다차원 비교 (발송 유형 / 신규·기존)
  if (multidim) {
    if (y > 640) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('다차원 비교', 50, y); y += 20;
    setFont(true); doc.fontSize(10).fillColor(dark).text('발송 유형별 성과', 50, y); y += 15;
    setFont(false); doc.fontSize(9);
    if (multidim.byType.length === 0) {
      doc.fillColor(gray).text('발송 데이터 없음', 60, y); y += 14;
    } else {
      for (const t of multidim.byType) {
        if (y > 760) { doc.addPage(); y = 50; }
        doc.fillColor(dark).text(`· ${t.label} — 발송 ${t.sent.toLocaleString()}건 / 성공률 ${pctStr(t.successRate)} (캠페인 ${t.campaigns}건)`, 60, y, { width: 485 }); y += 14;
      }
    }
    y += 4;
    const nv = multidim.newVsExisting;
    if (y > 720) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(10).fillColor(dark).text('신규 vs 기존 고객', 50, y); y += 15;
    setFont(false); doc.fontSize(9).fillColor(dark).text(`신규(기간 내 가입) ${nv.newCount.toLocaleString()}명 (${nv.newPct.toFixed(1)}%) · 기존 ${nv.existingCount.toLocaleString()}명`, 60, y); y += 14;
    setFont(false); doc.fontSize(8).fillColor(gray).text('발송 반응(구매) 비교는 자사몰 연동 데이터가 필요합니다.', 60, y); y += 16;
    y += 4;
  }

  // 메시지 분석 (유형별 / 길이 분포)
  if (message) {
    if (y > 640) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('메시지 분석', 50, y); y += 20;
    setFont(true); doc.fontSize(10).fillColor(dark).text('메시지 유형별 성과', 50, y); y += 15;
    setFont(false); doc.fontSize(9);
    if (message.byType.length === 0) {
      doc.fillColor(gray).text('발송 데이터 없음', 60, y); y += 14;
    } else {
      for (const t of message.byType) {
        if (y > 760) { doc.addPage(); y = 50; }
        const costStr = t.estimatedCost != null ? ` / 추정 비용 ${won(t.estimatedCost)}` : ' / 비용 데이터 부족';
        doc.fillColor(dark).text(`· ${t.label} — 발송 ${t.sent.toLocaleString()}건 / 성공률 ${pctStr(t.successRate)}${costStr}`, 60, y, { width: 485 }); y += 14;
      }
    }
    y += 4;
    if (y > 720) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(10).fillColor(dark).text('본문 길이 분포', 50, y); y += 15;
    setFont(false); doc.fontSize(9).fillColor(dark);
    const ld = message.lengthDist.map((b) => `${b.bucket} ${b.count.toLocaleString()}건`).join(' · ');
    doc.text(ld || '데이터 없음', 60, y); y += 16;
    y += 4;
  }

  // 예측·기회 (발송 추세 / 놓친 기회. 매출은 데이터부족)
  if (forecast) {
    if (y > 640) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('예측·기회', 50, y); y += 20;
    const tr = forecast.trend;
    setFont(false); doc.fontSize(9);
    if (tr.available) {
      const dirLabel = tr.direction === 'up' ? '증가' : tr.direction === 'down' ? '감소' : '유지';
      doc.fillColor(dark).text(`발송량 추세: ${dirLabel} (최근 평균 ${Math.round(tr.recentAvg).toLocaleString()}건/일)`, 50, y); y += 14;
      if (tr.projectedNextPeriod != null) {
        doc.fillColor(dark).text(`다음 동일 기간 예상 발송 ${Math.round(tr.projectedNextPeriod).toLocaleString()}건 (실측 추세 기준)`, 50, y); y += 14;
      }
    } else {
      doc.fillColor(gray).text('발송 추세 — 데이터 부족 (최소 3일 발송 필요)', 50, y); y += 14;
    }
    setFont(false); doc.fontSize(8).fillColor(gray).text('매출 예측은 자사몰 매출 연동 데이터가 필요합니다.', 50, y); y += 16;
    const mo = forecast.missed;
    if (y > 720) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(10).fillColor(dark).text('놓친 기회', 50, y); y += 15;
    setFont(false); doc.fontSize(9).fillColor(dark).text(`이탈위험 ${mo.atRiskCount.toLocaleString()}명 · 휴면 ${mo.dormantCount.toLocaleString()}명 — 재참여 캠페인 대상`, 60, y); y += 14;
    setFont(false); doc.fontSize(8).fillColor(gray).text('잠재 회복 매출은 구매 데이터 연동 시 산출됩니다.', 60, y); y += 16;
    y += 4;
  }

  // 우선순위 액션 플랜
  if (actionPlan && actionPlan.length > 0) {
    if (y > 620) { doc.addPage(); y = 50; }
    setFont(true); doc.fontSize(13).fillColor(primary).text('우선순위 액션 플랜', 50, y); y += 20;
    for (const a of actionPlan) {
      if (y > 730) { doc.addPage(); y = 50; }
      setFont(true); doc.fontSize(10).fillColor(dark).text(`${a.priority}. ${a.title}`, 50, y, { width: 495 }); y += 14;
      setFont(false); doc.fontSize(8).fillColor(gray).text(`근거: ${a.basis}`, 60, y, { width: 485 }); y += 12;
      if (a.linkHint) { setFont(false); doc.fontSize(8).fillColor(primary).text(`실행: ${a.linkHint}`, 60, y, { width: 485 }); y += 12; }
      y += 4;
    }
    y += 4;
  }

  // 부록 — 데이터 출처 / 부족 항목
  if (y > 680) { doc.addPage(); y = 50; }
  setFont(true); doc.fontSize(11).fillColor(primary).text('부록 — 데이터 출처', 50, y); y += 16;
  setFont(false); doc.fontSize(8).fillColor(gray);
  doc.text(`· 발송 성과: campaigns 발송일 기준 (${snapshot.source})`, 50, y); y += 11;
  doc.text('· 세그먼트/RFM/등급/LTV: customers (구매 이력·등급·LTV 보유분)', 50, y); y += 11;
  doc.text('· 매출/퍼널/기여/반응: 자사몰 연동(CDP) 데이터 — 미연동 시 데이터 부족으로 표기', 50, y); y += 11;
  doc.text('· 모든 추정치는 실측에서만 산출하며 임의 상수를 쓰지 않습니다.', 50, y); y += 14;

  // Source caption
  setFont(false); doc.fontSize(8).fillColor(gray).text(`Data source — ${snapshot.source} · ${today} 생성`, 50, y);
}
