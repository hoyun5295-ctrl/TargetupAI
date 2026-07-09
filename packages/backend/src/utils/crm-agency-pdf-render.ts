// ============================================================
// crm-agency-pdf-render.ts — "한줄로 마케팅 제안서" PDF 렌더 (pdfkit doc 주입형 · DB 호출 0)
// ============================================================
// performance-pdf-render.ts 미러 — malgun.ttf 한글 폰트 + 수동 y 레이아웃. doc.pipe/end는 호출측.
// 모델명 출력 금지("AI 분석") · 전 지표 실데이터 · 부족 축 dataNotes 정직 표기 · 분석 대상 업체명 명기(단일 스코프 §4).
import type { AgencyProposalResult, AgencyChannel } from './crm-agency-proposal-core';
import type { AgencyRequestParsed } from './crm-agency-request';

export interface AgencyProposalPdfData {
  result: AgencyProposalResult;
  request: AgencyRequestParsed;
}

const CHANNEL_LABEL: Record<AgencyChannel, string> = {
  sms: 'SMS', lms: 'LMS', mms: 'MMS', alimtalk: '알림톡',
  dm: '모바일 DM', email: '이메일', inapp: '인앱 메시지', journey: '여정 자동화',
};

export function renderAgencyProposalPdf(doc: any, data: AgencyProposalPdfData): void {
  const { result, request } = data;
  const path = require('path');
  const fs = require('fs');
  const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
  const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
  const hasFont = fs.existsSync(fontPath);
  const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
  const primary = '#7c3aed';
  const dark = '#1f2937';
  const gray = '#6b7280';
  const line = '#e5e7eb';
  const won = (v: any) => `${Math.round(Number(v) || 0).toLocaleString()}원`;
  const today = new Date().toISOString().slice(0, 10);

  let y = 50;
  const ensure = (need: number) => { if (y + need > 780) { doc.addPage(); y = 50; } };
  const hr = () => { doc.moveTo(50, y).lineTo(545, y).strokeColor(line).stroke(); y += 14; };
  const h2 = (title: string) => { ensure(40); setFont(true); doc.fontSize(13).fillColor(primary).text(title, 50, y); y += 20; };
  const bullet = (text: string, color = dark) => {
    const height = doc.heightOfString(`· ${text}`, { width: 495 });
    ensure(height + 4);
    setFont(false); doc.fontSize(9).fillColor(color).text(`· ${text}`, 50, y, { width: 495 });
    y += height + 4;
  };

  // ── 헤더 (표지)
  setFont(true);
  doc.fontSize(22).fillColor(primary).text('한줄로 마케팅 제안서', 50, y);
  setFont(false);
  doc.fontSize(9).fillColor(gray).text('CRM CAMPAIGN PROPOSAL', 50, y + 28);
  const rx = 350;
  doc.fontSize(9).fillColor(gray).text('분석 대상:', rx, y, { continued: true });
  setFont(true); doc.fillColor(dark).text(`  ${result.companyName || '-'}`);
  setFont(false); doc.fontSize(9).fillColor(gray).text('행사:', rx, y + 15, { continued: true });
  doc.fillColor(dark).text(`  ${request.title || '-'}`);
  doc.fontSize(9).fillColor(gray).text('작성일:', rx, y + 30, { continued: true });
  doc.fillColor(dark).text(`  ${today}`);
  y += 52; hr();

  // ── 1. 기업 현황 분석
  h2('1. 기업 현황 분석');
  if (result.situation.length === 0) bullet('데이터 부족 — 현황 요약을 생성하지 못했습니다.', gray);
  for (const s of result.situation) bullet(s);
  y += 6; hr();

  // ── 2. 행사 분석
  h2('2. 행사 분석');
  if (result.eventSummary) {
    const hgt = doc.heightOfString(result.eventSummary, { width: 495 });
    ensure(hgt + 6);
    setFont(false); doc.fontSize(9).fillColor(dark).text(result.eventSummary, 50, y, { width: 495 });
    y += hgt + 8;
  }
  bullet(`기간: ${request.periodStart} ~ ${request.periodEnd}`);
  bullet(`혜택(고객사 확정): ${request.benefit}`);
  if (request.budget) bullet(`예산: ${won(request.budget)}`);
  for (const p of request.products) {
    bullet(`상품: ${p.name}${p.price ? ` 정가 ${won(p.price)}` : ''}${p.salePrice ? ` → 할인 ${won(p.salePrice)}` : ''}`);
  }
  y += 6; hr();

  // ── 3. 캠페인 플랜
  h2(`3. 캠페인 플랜 (${result.plans.length}건)`);
  result.plans.forEach((plan, i) => {
    ensure(120);
    setFont(true); doc.fontSize(11).fillColor(dark).text(`플랜 ${i + 1}. ${plan.title}`, 50, y);
    setFont(false); doc.fontSize(9).fillColor(primary).text(CHANNEL_LABEL[plan.channel] || plan.channel, 470, y);
    y += 16;
    if (plan.objective) bullet(`목표: ${plan.objective}`);
    bullet(`타겟: ${plan.targetDescription || '-'} — ${plan.targetCount != null ? `실측 ${plan.targetCount.toLocaleString()}명` : '실행 시 산정'}`);
    if (plan.timing) bullet(`발송 시점: ${plan.timing}`);
    bullet(`예상 발송비: ${plan.estimatedCost != null ? won(plan.estimatedCost) : '실행 시 산정'}`);
    if (plan.expectedNote) bullet(`기대 효과: ${plan.expectedNote}`);
    if (plan.draftCopy) {
      const copyH = doc.heightOfString(plan.draftCopy, { width: 465 });
      ensure(copyH + 26);
      doc.rect(50, y, 495, copyH + 16).fillColor('#f9fafb').fill();
      setFont(false); doc.fontSize(8).fillColor(gray).text('문안 초안', 58, y + 4);
      doc.fontSize(9).fillColor(dark).text(plan.draftCopy, 58, y + 15, { width: 465 });
      y += copyH + 24;
    }
    y += 6;
  });
  hr();

  // ── 4. 참고 인사이트 (타겟 선정 미사용 명시 — 예측 분리 룰)
  if (result.insights.length > 0) {
    h2('4. 참고 인사이트');
    setFont(false); doc.fontSize(8).fillColor(gray).text('※ 아래는 참고 관찰이며, 발송 대상 선정에는 사용하지 않습니다.', 50, y); y += 14;
    for (const s of result.insights) bullet(s);
    y += 6; hr();
  }

  // ── 5. 리스크·주의
  if (result.risks.length > 0) {
    h2('5. 리스크 · 주의');
    for (const s of result.risks) bullet(s, '#b45309');
    y += 6; hr();
  }

  // ── 데이터 참고 (정직 표기)
  if (result.dataNotes.length > 0) {
    h2('데이터 참고');
    for (const s of result.dataNotes) bullet(s, gray);
    y += 6;
  }

  ensure(30);
  setFont(false); doc.fontSize(8).fillColor(gray)
    .text(`본 제안서는 ${result.companyName || '해당 업체'}의 데이터만을 분석해 작성되었습니다. — 한줄로 AI 분석`, 50, y, { width: 495 });
}
