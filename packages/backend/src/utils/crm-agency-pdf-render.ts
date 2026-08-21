// ============================================================
// crm-agency-pdf-render.ts — "한줄로 마케팅 제안서" PDF 렌더 (pdfkit doc 주입형 · DB 호출 0)
// ============================================================
// performance-pdf-render.ts 미러 — malgun.ttf 한글 폰트 + 수동 y 레이아웃. doc.pipe/end는 호출측.
// 모델명 출력 금지("AI 분석") · 전 지표 실데이터 · 부족 축 dataNotes 정직 표기 · 분석 대상 업체명 명기(단일 스코프).
// ★ 2026-07-09 웹 폼 전환 재디자인: 표지 밴드 + 섹션 헤더 + 플랜 스트립 + 행사 이미지 섹션(jpeg/png 임베드,
//   webp는 pdfkit 미지원이라 제외) + 이미지 판독(전사) 박스 + 페이지 번호(호출측 bufferPages:true 필요).
import type { AgencyProposalResult, AgencyChannel } from './crm-agency-proposal-core';
import type { AgencyRequestParsed } from './crm-agency-request';

export interface AgencyProposalPdfData {
  result: AgencyProposalResult;
  request: AgencyRequestParsed;
  /** 행사 이미지 파일 경로(서버 FS) — jpeg/png만 임베드된다 */
  imagePaths?: string[];
}

const CHANNEL_LABEL: Record<AgencyChannel, string> = {
  sms: 'SMS', lms: 'LMS', mms: 'MMS', alimtalk: '알림톡',
  dm: '모바일 DM', email: '이메일', inapp: '인앱 메시지', journey: '여정 자동화',
};

const PAGE_W = 595.28;
const LEFT = 50;
const RIGHT = 545;
const WIDTH = RIGHT - LEFT;

export function renderAgencyProposalPdf(doc: any, data: AgencyProposalPdfData): void {
  const { result, request } = data;
  const path = require('path');
  const fs = require('fs');
  const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
  const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
  const hasFont = fs.existsSync(fontPath);
  const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
  const primary = '#7c3aed';
  const primaryDark = '#5b21b6';
  const primarySoft = '#f5f3ff';
  const dark = '#1f2937';
  const gray = '#6b7280';
  const line = '#e5e7eb';
  const won = (v: any) => `${Math.round(Number(v) || 0).toLocaleString()}원`;
  const today = new Date().toISOString().slice(0, 10);

  let y = 0;
  const ensure = (need: number) => { if (y + need > 770) { doc.addPage(); y = 50; } };
  const hr = () => { doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(line).lineWidth(0.7).stroke(); y += 14; };
  const h2 = (title: string) => {
    ensure(44);
    doc.rect(LEFT, y + 1, 4, 13).fillColor(primary).fill();
    setFont(true); doc.fontSize(13).fillColor(primaryDark).text(title, LEFT + 10, y);
    y += 20;
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor('#ede9fe').lineWidth(1).stroke();
    y += 10;
  };
  const bullet = (text: string, color = dark) => {
    const height = doc.heightOfString(`· ${text}`, { width: WIDTH });
    ensure(height + 4);
    setFont(false); doc.fontSize(9).fillColor(color).text(`· ${text}`, LEFT, y, { width: WIDTH });
    y += height + 4;
  };
  const labelValue = (label: string, value: string, x: number, yy: number, labelColor = gray, valueColor = dark) => {
    setFont(false); doc.fontSize(8.5).fillColor(labelColor).text(label, x, yy);
    setFont(true); doc.fontSize(9.5).fillColor(valueColor).text(value, x, yy + 12, { width: 225 });
  };
  const grayBox = (caption: string, body: string) => {
    const bodyH = doc.heightOfString(body, { width: WIDTH - 20 });
    ensure(bodyH + 34);
    doc.roundedRect(LEFT, y, WIDTH, bodyH + 26, 6).fillColor('#f9fafb').fill();
    doc.roundedRect(LEFT, y, WIDTH, bodyH + 26, 6).strokeColor(line).lineWidth(0.7).stroke();
    setFont(true); doc.fontSize(7.5).fillColor(gray).text(caption, LEFT + 10, y + 6);
    setFont(false); doc.fontSize(9).fillColor(dark).text(body, LEFT + 10, y + 18, { width: WIDTH - 20 });
    y += bodyH + 34;
  };

  // ── 표지 밴드
  doc.rect(0, 0, PAGE_W, 118).fillColor(primaryDark).fill();
  doc.rect(0, 118, PAGE_W, 4).fillColor('#a78bfa').fill();
  setFont(true);
  doc.fontSize(23).fillColor('#ffffff').text('한줄로 마케팅 제안서', LEFT, 34);
  setFont(false);
  doc.fontSize(9).fillColor('#ddd6fe').text('CRM CAMPAIGN PROPOSAL · 한줄로 운영팀 · AI 분석', LEFT, 66);
  doc.fontSize(8.5).fillColor('#ede9fe').text(`작성일 ${today}`, LEFT, 92);

  // ── 표지 정보 카드
  y = 140;
  doc.roundedRect(LEFT, y, WIDTH, 64, 8).fillColor(primarySoft).fill();
  doc.roundedRect(LEFT, y, WIDTH, 64, 8).strokeColor('#ddd6fe').lineWidth(0.8).stroke();
  labelValue('분석 대상 (이 업체의 데이터만 분석)', result.companyName || '-', LEFT + 14, y + 10);
  labelValue('행사명', request.title || '-', LEFT + 262, y + 10);
  labelValue('행사 기간', `${request.periodStart || '-'} ~ ${request.periodEnd || '-'}`, LEFT + 14, y + 36);
  labelValue('예산', request.budget ? won(request.budget) : '미지정', LEFT + 262, y + 36);
  y += 78;

  // ── 1. 기업 현황 분석
  h2('1. 기업 현황 분석');
  if (result.situation.length === 0) bullet('데이터 부족. 현황 요약을 생성하지 못했습니다.', gray);
  for (const s of result.situation) bullet(s);
  y += 6; hr();

  // ── 2. 행사 분석
  h2('2. 행사 분석');
  if (result.eventSummary) {
    const hgt = doc.heightOfString(result.eventSummary, { width: WIDTH });
    ensure(hgt + 6);
    setFont(false); doc.fontSize(9).fillColor(dark).text(result.eventSummary, LEFT, y, { width: WIDTH });
    y += hgt + 8;
  }
  bullet(`기간: ${request.periodStart} ~ ${request.periodEnd}`);
  bullet(`혜택(고객사 확정): ${request.benefit}`);
  if (request.channels.length) bullet(`희망 채널: ${request.channels.join(', ')}`);
  if (request.budget) bullet(`예산: ${won(request.budget)}`);
  for (const p of request.products) {
    bullet(`상품: ${p.name}${p.price ? ` 정가 ${won(p.price)}` : ''}${p.salePrice ? ` → 할인 ${won(p.salePrice)}` : ''}`);
  }
  if (request.note) bullet(`참고사항: ${request.note}`, gray);
  if (result.imageTranscript) {
    y += 4;
    grayBox('행사 이미지 판독 내용 (업로드 이미지에 보이는 내용 전사)', result.imageTranscript);
  }
  y += 2; hr();

  // ── 행사 이미지 (jpeg/png만 — pdfkit이 webp 미지원)
  const embeddable = (data.imagePaths || []).filter((p) => /\.(jpe?g|png)$/i.test(p) && fs.existsSync(p));
  if (embeddable.length > 0) {
    h2('행사 이미지');
    const cellW = 240; const cellH = 170; const gap = 15;
    let drawn = 0;
    for (const imgPath of embeddable.slice(0, 6)) {
      const col = drawn % 2;
      if (col === 0) ensure(cellH + 12);
      const x = LEFT + col * (cellW + gap);
      try {
        doc.roundedRect(x, y, cellW, cellH, 6).strokeColor(line).lineWidth(0.7).stroke();
        doc.image(imgPath, x + 5, y + 5, { fit: [cellW - 10, cellH - 10], align: 'center', valign: 'center' });
        drawn++;
        if (col === 1) y += cellH + 12;
      } catch { /* 깨진 이미지 — 칸만 그려졌어도 다음으로 (분석·문안에는 영향 0) */ }
    }
    if (drawn % 2 === 1) y += cellH + 12;
    if (embeddable.length < (data.imagePaths || []).length) {
      bullet('일부 이미지(webp 등)는 PDF에 표시되지 않습니다. 원본은 관리자 화면에서 확인.', gray);
    }
    y += 2; hr();
  }

  // ── 3. 캠페인 플랜
  h2(`3. 캠페인 플랜 (${result.plans.length}건)`);
  result.plans.forEach((plan, i) => {
    ensure(120);
    // 플랜 헤더 스트립
    const chipLabel = CHANNEL_LABEL[plan.channel] || plan.channel;
    doc.roundedRect(LEFT, y, WIDTH, 24, 6).fillColor(primarySoft).fill();
    setFont(true); doc.fontSize(11).fillColor(primaryDark).text(`플랜 ${i + 1}. ${plan.title}`, LEFT + 10, y + 6, { width: WIDTH - 110 });
    const chipW = doc.widthOfString(chipLabel) + 16;
    doc.roundedRect(RIGHT - chipW - 8, y + 4.5, chipW, 15, 7.5).fillColor(primary).fill();
    doc.fontSize(8).fillColor('#ffffff').text(chipLabel, RIGHT - chipW, y + 8.5);
    y += 32;
    if (plan.objective) bullet(`목표: ${plan.objective}`);
    bullet(`타겟: ${plan.targetDescription || '-'}: ${plan.targetCount != null ? `실측 ${plan.targetCount.toLocaleString()}명` : '실행 시 산정'}`);
    if (plan.timing) bullet(`발송 시점: ${plan.timing}`);
    bullet(`예상 발송비: ${plan.estimatedCost != null ? won(plan.estimatedCost) : '실행 시 산정'}`);
    if (plan.expectedNote) bullet(`기대 효과: ${plan.expectedNote}`);
    if (plan.draftCopy) grayBox('문안 초안', plan.draftCopy);
    y += 6;
  });
  hr();

  // ── 4. 참고 인사이트 (타겟 선정 미사용 명시 — 예측 분리 룰)
  if (result.insights.length > 0) {
    h2('4. 참고 인사이트');
    setFont(false); doc.fontSize(8).fillColor(gray).text('※ 아래는 참고 관찰이며, 발송 대상 선정에는 사용하지 않습니다.', LEFT, y); y += 14;
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
    .text(`본 제안서는 ${result.companyName || '해당 업체'}의 데이터만을 분석해 작성되었습니다. (한줄로 AI 분석)`, LEFT, y, { width: WIDTH });

  // ── 페이지 번호 푸터 (호출측이 bufferPages:true로 doc 생성해야 동작 — 아니면 조용히 생략)
  try {
    if (typeof doc.bufferedPageRange === 'function') {
      const range = doc.bufferedPageRange();
      for (let p = range.start; p < range.start + range.count; p++) {
        doc.switchToPage(p);
        setFont(false);
        doc.fontSize(7.5).fillColor('#9ca3af')
          .text(`한줄로 마케팅 제안서 · ${result.companyName || ''}  ·  ${p - range.start + 1} / ${range.count}`,
            LEFT, 818, { width: WIDTH, align: 'right', lineBreak: false });
      }
    }
  } catch { /* 페이지 번호 실패는 본문에 영향 0 */ }
}
