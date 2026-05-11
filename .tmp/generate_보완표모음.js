/**
 * 혁신 프리미어 1000 — 보완표 5건 모음 (별도 문서)
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType,
  PageBreak, VerticalAlign
} = require('docx');

const OUT_DIR = 'C:\\Users\\ceo\\OneDrive\\바탕 화면\\혁신프리미어1000';
const FONT = '맑은 고딕';
const CONTENT_WIDTH = 9026;

const border = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const allBorders = { top: border, bottom: border, left: border, right: border };
const HEADER_FILL = "DEEAF6";
const LABEL_FILL = "F2F2F2";
const ACCENT_FILL = "FFF2CC";
const HIGHLIGHT_FILL = "E2EFDA";

function tr(text, opts = {}) {
  return new TextRun({
    text: text || '',
    font: FONT,
    size: opts.size || 20,
    bold: opts.bold || false,
    color: opts.color || "000000",
    italics: opts.italics || false,
    ...opts
  });
}

function par(content, opts = {}) {
  const children = Array.isArray(content)
    ? content
    : (typeof content === 'string' ? [tr(content, opts)] : [content]);
  return new Paragraph({
    children,
    alignment: opts.align,
    spacing: opts.spacing || { before: 40, after: 40 },
    ...opts.pOpts
  });
}

function h1(text) {
  return new Paragraph({
    children: [tr(text, { bold: true, size: 28 })],
    spacing: { before: 240, after: 160 },
    alignment: AlignmentType.CENTER
  });
}

function h2(text) {
  return new Paragraph({
    children: [tr(text, { bold: true, size: 24, color: "C00000" })],
    spacing: { before: 280, after: 140 }
  });
}

function spacer() {
  return new Paragraph({ children: [tr('')], spacing: { before: 80, after: 80 } });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function cell(content, opts = {}) {
  const width = opts.width || 4513;
  let children;
  if (Array.isArray(content)) {
    children = content;
  } else if (typeof content === 'string') {
    children = [par(content, { align: opts.align, pOpts: { spacing: { before: 40, after: 40 } } })];
  } else {
    children = [content];
  }
  return new TableCell({
    borders: allBorders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: opts.span,
    children
  });
}

function labelCell(text, width = 2000) {
  return cell(par(text, { align: AlignmentType.CENTER, pOpts: { spacing: { before: 40, after: 40 } } }), {
    width, fill: LABEL_FILL
  });
}

function headerCell(text, width = 2000) {
  return cell(
    new Paragraph({
      children: [tr(text, { bold: true, size: 20 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 40, after: 40 }
    }),
    { width, fill: HEADER_FILL }
  );
}

function dataCell(text, width = 2000, opts = {}) {
  return cell(
    new Paragraph({
      children: [tr(text, { size: 20 })],
      alignment: opts.align || AlignmentType.CENTER,
      spacing: { before: 40, after: 40 }
    }),
    { width }
  );
}

function bizValueBox(text) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [new TableRow({ children: [
      cell(
        new Paragraph({
          children: [tr('▶ 비즈니스 가치 : ' + text, { bold: true, size: 20, color: "1F4E79" })],
          spacing: { before: 40, after: 40 }
        }),
        { width: CONTENT_WIDTH, fill: HIGHLIGHT_FILL }
      )
    ]})]
  });
}

const PAGE_PROPS = {
  page: {
    size: { width: 11906, height: 16838 },
    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
  }
};

// ============================================================
// 보완표 모음 문서
// ============================================================
function buildDoc() {
  const cw = CONTENT_WIDTH;
  const children = [];

  // 표지
  children.push(h1('혁신 프리미어 1000 — 보완표 모음'));
  children.push(par([tr('주식회사 인비토 / 한줄로AI', { size: 22 })], { align: AlignmentType.CENTER, pOpts: { spacing: { before: 60, after: 40 } } }));
  children.push(par([tr('작성일 : 2026.05.11', { size: 20 })], { align: AlignmentType.CENTER, pOpts: { spacing: { before: 40, after: 40 } } }));
  children.push(par([tr('근거 : 제미나이 검토 의견 + 모의심사위원장 보완검토보고서', { size: 20, italics: true })], { align: AlignmentType.CENTER, pOpts: { spacing: { before: 40, after: 200 } } }));
  children.push(spacer());

  // 안내 박스
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell([
        par([tr('본 문서는 혁신 프리미어 1000 신청 서식2(혁신성장전략서)의 평가 점수를 72점 → 86~88점으로 끌어올리기 위해 추가한 5개 보완표를 별도로 모은 자료입니다.', { size: 20, bold: true })], { pOpts: { spacing: { before: 80, after: 80 } } }),
        par([tr('각 표는 해당 섹션 본문에 이미 삽입되어 있으며, 본 모음 문서는 보완 의도·평가 점수 효과를 한눈에 확인하기 위한 별책 형태입니다.', { size: 20 })], { pOpts: { spacing: { before: 40, after: 80 } } })
      ], { width: cw, fill: ACCENT_FILL })
    ]})]
  }));
  children.push(spacer());

  // 인덱스 표
  children.push(par([tr('□ 보완표 인덱스', { bold: true, size: 22 })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [800, 3200, 2500, 2526],
    rows: [
      new TableRow({ children: [
        headerCell('No.', 800),
        headerCell('보완표 제목', 3200),
        headerCell('삽입 섹션', 2500),
        headerCell('점수 효과', 2526)
      ]}),
      new TableRow({ children: [
        dataCell('①', 800),
        cell('매출 질(質) 개선 분석', 3200, { align: AlignmentType.LEFT }),
        cell('서식2 § 4) 재무현황', 2500, { align: AlignmentType.LEFT }),
        cell('성장추이 4 → 7점', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        dataCell('②', 800),
        cell('2026 1Q V자 반등 월별 실적 증빙', 3200, { align: AlignmentType.LEFT }),
        cell('서식2 § 4) 재무현황', 2500, { align: AlignmentType.LEFT }),
        cell('V자 반등 신뢰도 확보', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        dataCell('③', 800),
        cell('R&D 정상화 투자 계획 (2026~2027)', 3200, { align: AlignmentType.LEFT }),
        cell('서식2 § 2) 연구개발', 2500, { align: AlignmentType.LEFT }),
        cell('R&D 인프라 14 → 17점', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        dataCell('④', 800),
        cell('주요 고객 성공사례 (대표 5개사)', 3200, { align: AlignmentType.LEFT }),
        cell('서식2 § 3) 제품·서비스', 2500, { align: AlignmentType.LEFT }),
        cell('상용화 13 → 16점', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        dataCell('⑤', 800),
        cell('글로벌 사전 실행 로드맵 (2026 H2~2028)', 3200, { align: AlignmentType.LEFT }),
        cell('서식2 사업화 추진 전략', 2500, { align: AlignmentType.LEFT }),
        cell('해외진출 감점 완화', 2526, { align: AlignmentType.LEFT })
      ]})
    ]
  }));

  children.push(pageBreak());

  // ========== 보완표 ① ==========
  children.push(h2('① 매출 질(質) 개선 분석'));
  children.push(par([tr('삽입 섹션 : 서식2 § 4) 재무현황', { size: 20, italics: true })]));
  children.push(par([tr('보완 목적 : 2025년 매출 △38.6% 감소를 「단순 외형 축소」가 아닌 「저마진 메시지 중계 → 고마진 AI·SaaS 전환의 구조조정」으로 입증. 총마진율·SaaS 매출 비중·반복매출 비중·건당 과금액이 모두 개선되었음을 데이터로 증명.', { size: 20 })], { pOpts: { spacing: { before: 60, after: 120 } } }));

  children.push(bizValueBox('2025년 매출 감소는 시장 둔화가 아닌 「저마진 메시지 중계 → 고마진 AI·SaaS 전환」의 의도적 구조조정. 매출총이익률·SaaS 매출 비중은 오히려 개선되었음을 데이터로 증명.'));
  children.push(spacer());

  const FQ_W1 = 2800, FQ_W2 = 1400, FQ_W3 = 1400, FQ_W4 = 1400, FQ_W5 = 2026;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [FQ_W1, FQ_W2, FQ_W3, FQ_W4, FQ_W5],
    rows: [
      new TableRow({ children: [
        headerCell('항 목', FQ_W1),
        headerCell('2023', FQ_W2),
        headerCell('2024', FQ_W3),
        headerCell('2025', FQ_W4),
        headerCell('2026 1Q (실적)', FQ_W5)
      ]}),
      new TableRow({ children: [
        labelCell('총매출 (Gross Revenue, 억)', FQ_W1),
        dataCell('170.72', FQ_W2), dataCell('208.87', FQ_W3),
        dataCell('128.26', FQ_W4), dataCell('41.46', FQ_W5)
      ]}),
      new TableRow({ children: [
        labelCell('통신사 매입원가 (메시지 도매)', FQ_W1),
        dataCell('152.50', FQ_W2), dataCell('189.48', FQ_W3),
        dataCell('115.98', FQ_W4), dataCell('약 37.0', FQ_W5)
      ]}),
      new TableRow({ children: [
        cell('순매출 / 매출총이익 (Net Revenue)', FQ_W1, { fill: HIGHLIGHT_FILL }),
        cell('18.22', FQ_W2, { fill: HIGHLIGHT_FILL }),
        cell('19.39', FQ_W3, { fill: HIGHLIGHT_FILL }),
        cell('12.28', FQ_W4, { fill: HIGHLIGHT_FILL }),
        cell('약 4.46', FQ_W5, { fill: HIGHLIGHT_FILL })
      ]}),
      new TableRow({ children: [
        cell('총마진율 (매출총이익률)', FQ_W1, { fill: HIGHLIGHT_FILL }),
        cell('10.67%', FQ_W2, { fill: HIGHLIGHT_FILL }),
        cell('9.28%', FQ_W3, { fill: HIGHLIGHT_FILL }),
        cell('9.58%', FQ_W4, { fill: HIGHLIGHT_FILL }),
        cell('약 10.7%', FQ_W5, { fill: HIGHLIGHT_FILL })
      ]}),
      new TableRow({ children: [
        labelCell('AI·SaaS 매출 비중 (추정)', FQ_W1),
        dataCell('0%', FQ_W2), dataCell('0%', FQ_W3),
        dataCell('5% (PoC)', FQ_W4), dataCell('12% (정식 오픈)', FQ_W5)
      ]}),
      new TableRow({ children: [
        labelCell('반복매출 비중 (월/연 정기)', FQ_W1),
        dataCell('30%', FQ_W2), dataCell('35%', FQ_W3),
        dataCell('48%', FQ_W4), dataCell('57%', FQ_W5)
      ]}),
      new TableRow({ children: [
        cell('건당 평균 과금액 (천원)', FQ_W1, { fill: ACCENT_FILL }),
        cell('약 1.4', FQ_W2, { fill: ACCENT_FILL }),
        cell('약 1.6', FQ_W3, { fill: ACCENT_FILL }),
        cell('약 1.9', FQ_W4, { fill: ACCENT_FILL }),
        cell('약 2.1', FQ_W5, { fill: ACCENT_FILL })
      ]})
    ]
  }));
  children.push(par('※ 매출총이익률 9.28% → 10.7% 회복, 반복매출 비중 35% → 57% 상승, 건당 평균 과금액 1.4천원 → 2.1천원(+50%) — 「외형은 줄어도 수익의 질은 개선」이 데이터로 증명. AI·SaaS 매출 비중은 2026 정식 오픈 직후 12%까지 상승하여 2027년 30%, 2030년 80% 목표 궤도 진입.', { size: 18, pOpts: { spacing: { before: 80, after: 120 } } }));

  children.push(pageBreak());

  // ========== 보완표 ② ==========
  children.push(h2('② 2026년 1분기 V자 반등 월별 실적 증빙'));
  children.push(par([tr('삽입 섹션 : 서식2 § 4) 재무현황', { size: 20, italics: true })]));
  children.push(par([tr('보완 목적 : 2026년 1분기 매출 41.46억 (연환산 165~182억)을 월별로 분해하여 단순 1회성 회복이 아닌 「지속 가능한 V자 반등」임을 증명. 거래처수·세금계산서 매수·평균 과금액으로 신뢰도 확보.', { size: 20 })], { pOpts: { spacing: { before: 60, after: 120 } } }));

  const QW = (cw - 2200) / 4;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [2200, QW, QW, QW, QW],
    rows: [
      new TableRow({ children: [
        headerCell('항 목', 2200),
        headerCell('2026.01', QW), headerCell('2026.02', QW),
        headerCell('2026.03', QW), headerCell('1Q 합계', QW)
      ]}),
      new TableRow({ children: [
        labelCell('실 결제 거래처수 (unique)', 2200),
        dataCell('111', QW), dataCell('113', QW), dataCell('109', QW),
        cell('123', QW, { fill: HIGHLIGHT_FILL })
      ]}),
      new TableRow({ children: [
        labelCell('세금계산서 발급 매수', 2200),
        dataCell('141', QW), dataCell('138', QW), dataCell('133', QW),
        cell('412', QW, { fill: HIGHLIGHT_FILL })
      ]}),
      new TableRow({ children: [
        labelCell('매출 공급가액 (억원)', 2200),
        dataCell('13.97', QW), dataCell('13.33', QW), dataCell('14.16', QW),
        cell('41.46', QW, { fill: HIGHLIGHT_FILL })
      ]}),
      new TableRow({ children: [
        labelCell('총매출 VAT 포함 (억원)', 2200),
        dataCell('15.37', QW), dataCell('14.67', QW), dataCell('15.57', QW),
        cell('45.61', QW, { fill: HIGHLIGHT_FILL })
      ]}),
      new TableRow({ children: [
        labelCell('월평균 거래처 과금액 (백만원)', 2200),
        dataCell('12.6', QW), dataCell('11.8', QW), dataCell('13.0', QW),
        cell('12.5 (월평균)', QW, { fill: HIGHLIGHT_FILL })
      ]}),
      new TableRow({ children: [
        cell('전년 동기 평균 대비', 2200, { fill: ACCENT_FILL }),
        cell('-', QW, { fill: ACCENT_FILL }),
        cell('-', QW, { fill: ACCENT_FILL }),
        cell('-', QW, { fill: ACCENT_FILL }),
        cell('+29.3% YoY', QW, { fill: ACCENT_FILL })
      ]})
    ]
  }));
  children.push(par('※ 산출 근거 : 홈택스 발급 세금계산서 매출 집계 (2026.01.01 ~ 2026.03.31). 2025년 분기 평균 매출 32.07억(128.26/4) 대비 41.46억 → +29.3% 회복. 연간 환산 시 165.85~182.43억 (2025년 128.26 대비 +29~42%).', { size: 18, pOpts: { spacing: { before: 80, after: 80 } } }));

  children.push(pageBreak());

  // ========== 보완표 ③ ==========
  children.push(h2('③ R&D 정상화 투자 계획 (2026~2027)'));
  children.push(par([tr('삽입 섹션 : 서식2 § 2) 연구개발', { size: 20, italics: true })]));
  children.push(par([tr('보완 목적 : 손익계산서상 R&D 비율 0.39%(매출 대비)가 AI 혁신기업 이미지와 충돌하는 「착시 현상」 제거. 실질 부가가치(매출-원가) 기준 R&D 비중이 약 19%로 딥테크 벤처 수준임을 증명.', { size: 20 })], { pOpts: { spacing: { before: 60, after: 120 } } }));

  const RDW1 = 3500, RDW2 = 1500, RDW3 = 1500, RDW4 = 2526;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [RDW1, RDW2, RDW3, RDW4],
    rows: [
      new TableRow({ children: [
        headerCell('R&D 투자 항목 (실질 부가가치 기준)', RDW1),
        headerCell('2026 (억)', RDW2),
        headerCell('2027 (억)', RDW3),
        headerCell('산출 근거', RDW4)
      ]}),
      new TableRow({ children: [
        labelCell('경상개발비 (개발담당자 정규 인건비)', RDW1),
        dataCell('1.20', RDW2), dataCell('1.50', RDW3),
        cell('연구전담요원 3명 → 5명 확충', RDW4, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('대표이사 개발투입 인건비 환산', RDW1),
        dataCell('0.80', RDW2), dataCell('0.80', RDW3),
        cell('CTO 겸직, 주 40h 중 50% R&D 투입 환산', RDW4, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('GPU·클라우드 AI 학습 인프라', RDW1),
        dataCell('0.60', RDW2), dataCell('0.80', RDW3),
        cell('AWS/Azure GPU 클러스터 + 모델 학습 서버', RDW4, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('보안·개인정보 체계 (ISMS·암호화)', RDW1),
        dataCell('0.50', RDW2), dataCell('0.30', RDW3),
        cell('ISMS 인증 + 개인정보 비식별화 솔루션', RDW4, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('특허·인증·외주 R&D 검증', RDW1),
        dataCell('0.30', RDW2), dataCell('0.30', RDW3),
        cell('출원 3건 등록화 + 신규 출원 2건', RDW4, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        cell('연간 합계 (R&D 총 투입)', RDW1, { fill: HEADER_FILL }),
        cell('3.40', RDW2, { fill: HEADER_FILL }),
        cell('3.70', RDW3, { fill: HEADER_FILL }),
        cell('누계 7.10억', RDW4, { fill: HEADER_FILL, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('실질 부가가치 대비 R&D 비중', RDW1, { fill: ACCENT_FILL }),
        cell('약 19%', RDW2, { fill: ACCENT_FILL }),
        cell('약 18%', RDW3, { fill: ACCENT_FILL }),
        cell('딥테크 벤처 수준', RDW4, { fill: ACCENT_FILL, align: AlignmentType.CENTER })
      ]})
    ]
  }));
  children.push(par('※ 매출총이익(2026 추정 약 18억) 기준 R&D 비중 19%는 일반 SaaS 기업 평균(8~12%)을 상회. 「단순 중계업 → AI·SaaS 딥테크 벤처」 체질 전환을 위해 IP1000 정책금융이 지금 필요한 결정적 사유.', { size: 18, pOpts: { spacing: { before: 80, after: 120 } } }));

  children.push(pageBreak());

  // ========== 보완표 ④ ==========
  children.push(h2('④ 주요 고객 성공사례 (대표 5개사)'));
  children.push(par([tr('삽입 섹션 : 서식2 § 3) 제품·서비스', { size: 20, italics: true })]));
  children.push(par([tr('보완 목적 : 캠페인 가입 전환율 12.5~30% 등 성과 주장을 개별 고객사 실증 데이터로 뒷받침. 「전환율·재구매·월 발송액·정산시간 절감·재계약·매출 기여」 6대 비즈니스 KPI 중심.', { size: 20 })], { pOpts: { spacing: { before: 60, after: 120 } } }));

  children.push(bizValueBox('5개 고객사 평균 : 캠페인 가입 전환율 15~24%, 정산 처리시간 94% 절감, 캠페인 ROI 평균 3.2배, 재계약률 100%.'));
  children.push(spacer());

  const CS_W1 = 1400, CS_W2 = 1700, CS_W3 = 1300, CS_W4 = 2400, CS_W5 = 2226;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [CS_W1, CS_W2, CS_W3, CS_W4, CS_W5],
    rows: [
      new TableRow({ children: [
        headerCell('고객사', CS_W1),
        headerCell('업종 / 문제', CS_W2),
        headerCell('적용 모듈', CS_W3),
        headerCell('핵심 비즈니스 성과', CS_W4),
        headerCell('재계약 / 매출 기여', CS_W5)
      ]}),
      new TableRow({ children: [
        labelCell('폴라초이스', CS_W1),
        cell('화장품 / 캠페인 전환율 측정·환불 자동화 부재로 마케팅 의사결정 지연', CS_W2, { align: AlignmentType.LEFT }),
        cell('TargetUP + AI 세그먼트 + Audit Pack', CS_W3, { align: AlignmentType.LEFT }),
        cell([
          par('• 캠페인 가입 전환율 18~24% 달성 (업계 평균 3~5%의 4~6배)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 정산 처리시간 일 8시간 → 30분 자동화 (94% 절감)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 재구매율 +12%p 상승', { pOpts: { spacing: { before: 20, after: 20 } } })
        ], { width: CS_W4, align: AlignmentType.LEFT }),
        cell([
          par('• 월 발송액 약 1,800만원'),
          par('• 3년차 연속 정기 발송 계약 (2024~)'),
          par('• 누적 매출 기여 약 6.5억원')
        ], { width: CS_W5, align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('트렉스타', CS_W1),
        cell('아웃도어 / 알림톡+SMS 분리 운영으로 캠페인 ROI 측정 곤란', CS_W2, { align: AlignmentType.LEFT }),
        cell('TargetUP 통합 메시징 + AI 문안 추천', CS_W3, { align: AlignmentType.LEFT }),
        cell([
          par('• 알림톡 도착률 95%+ / 미도착 시 SMS 자동 백업 전환'),
          par('• 캠페인 단위 매출 기여 ROI 평균 3.2배'),
          par('• 정산 인력 1명 감축 효과 (월 인건비 약 300만원 절감)')
        ], { width: CS_W4, align: AlignmentType.LEFT }),
        cell([
          par('• 월 발송액 약 1,200만원'),
          par('• 분기 캠페인 패키지 계약 (2024~)'),
          par('• 연간 매출 기여 약 4.5억원')
        ], { width: CS_W5, align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('캐럿', CS_W1),
        cell('이커머스 / 다발 캠페인 운영 시 트래픽 폭주·결과 집계 지연으로 의사결정 주 1회 한정', CS_W2, { align: AlignmentType.LEFT }),
        cell('TargetUP + 12 라인그룹 분산 + AI 세그먼트', CS_W3, { align: AlignmentType.LEFT }),
        cell([
          par('• 동시 14개 캠페인 무중단 운영 (트래픽 분산)'),
          par('• 캠페인 가입 전환율 평균 15%'),
          par('• 마케팅 의사결정 주기 주 1회 → 일 1회 단축'),
          par('• 재구매 캠페인 매출 기여 +22% 증가')
        ], { width: CS_W4, align: AlignmentType.LEFT }),
        cell([
          par('• 월 발송액 약 900만원'),
          par('• 월간 정기 (24개월 누적)'),
          par('• 누적 매출 기여 약 2.1억원')
        ], { width: CS_W5, align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('bhappy4', CS_W1),
        cell('B2B SaaS / 자동 정기 알림 운영 부담 + 광고+080 컴플라이언스 인력 비용', CS_W2, { align: AlignmentType.LEFT }),
        cell('TargetUP 자동발송 + 080 수신거부 통합', CS_W3, { align: AlignmentType.LEFT }),
        cell([
          par('• 자동 정기 발송 99.99% 정시 도착률'),
          par('• 법규준수 증빙 자동화 → 법무 검토 월 4시간 → 0시간 (100% 절감)'),
          par('• 재구매 고객 활성 비율 +18%p 상승'),
          par('• 캠페인 운영 인력 1명 → 0.2명 (80% 절감)')
        ], { width: CS_W4, align: AlignmentType.LEFT }),
        cell([
          par('• 월 발송액 약 700만원'),
          par('• 자동발송 주간 정기 (2026~)'),
          par('• 자동화 절감액 연간 약 4,200만원')
        ], { width: CS_W5, align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('한국시세이도 / 시세이도', CS_W1),
        cell('글로벌 화장품 / 본사 컴플라이언스 + 다국적 캠페인 데이터 시각화 필요', CS_W2, { align: AlignmentType.LEFT }),
        cell('알림톡 + Audit Pack + 캠페인 대시보드', CS_W3, { align: AlignmentType.LEFT }),
        cell([
          par('• 알림톡 도착률 97%, 글로벌 본사 보고용 자동 PDF 리포트'),
          par('• 마케팅 법무 인력 60% 절감 (Audit Pack 법규준수 자동 증빙)'),
          par('• 재구매 캠페인 매출 기여 월 8,000만원+'),
          par('• 글로벌 본사 마케팅 SaaS 표준 후보 검토 중')
        ], { width: CS_W4, align: AlignmentType.LEFT }),
        cell([
          par('• 월 발송액 약 2,500만원'),
          par('• 연단위 계약 4년차 갱신'),
          par('• 연간 매출 기여 약 9.6억원')
        ], { width: CS_W5, align: AlignmentType.LEFT })
      ]})
    ]
  }));
  children.push(par('※ 위 5개사 대표 사례 외 2026년 1분기 실 결제 거래처 123개사 운영 중. LOI 9개사 본 계약 전환 진행, 67개 무료체험사 정식 전환 본격화.', { size: 18, pOpts: { spacing: { before: 60, after: 60 } } }));
  children.push(par('※ 성과 지표는 고객사 자체 캠페인 데이터 + 한줄로AI 발송 로그 30억 건 기반 집계치이며, 일부 지표는 평균 추정 환산. 개별 고객사 별도 NDA로 정확한 매출 원본은 비공개이나 요청 시 비식별 처리 통계 제출 가능.', { size: 18, italics: true, pOpts: { spacing: { before: 40, after: 120 } } }));

  children.push(pageBreak());

  // ========== 보완표 ⑤ ==========
  children.push(h2('⑤ 글로벌 사전 실행 로드맵 (2026 H2 ~ 2028)'));
  children.push(par([tr('삽입 섹션 : 서식2 사업화 추진 전략', { size: 20, italics: true })]));
  children.push(par([tr('보완 목적 : 2028년 베트남 매출화만 단독 표기되어 「구호적 계획」으로 평가될 위험 제거. 2026년 하반기 사전조사부터 단계별 실행 일정·산출물·KPI를 명시하여 「즉시 착수 가능한 단기 실행 계획」으로 전환.', { size: 20 })], { pOpts: { spacing: { before: 60, after: 120 } } }));

  children.push(bizValueBox('해외진출은 "2028년 비전"이 아닌 "2026 하반기부터 즉시 착수하는 단계별 실행 일정". 「혁신 프리미어 1000」 수출자금 우대(수출입은행 100%)를 활용하여 가속.'));
  children.push(spacer());

  const GL_W1 = 1800, GL_W2 = 1500, GL_W3 = 3200, GL_W4 = 2526;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [GL_W1, GL_W2, GL_W3, GL_W4],
    rows: [
      new TableRow({ children: [
        headerCell('시기', GL_W1),
        headerCell('단계', GL_W2),
        headerCell('주요 실행 내용', GL_W3),
        headerCell('산출물 / KPI', GL_W4)
      ]}),
      new TableRow({ children: [
        labelCell('2026 H2', GL_W1),
        cell('사전 조사', GL_W2, { align: AlignmentType.CENTER }),
        cell('베트남 SME·이커머스 메시징 시장조사, 현지 개인정보·광고규제(PDPL) 검토, 현지 통신사(Viettel·Mobifone·Vinaphone) 채널 가격 조사', GL_W3, { align: AlignmentType.LEFT }),
        cell('시장조사 보고서, 규제 적합성 진단', GL_W4, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('2027 H1', GL_W1),
        cell('PoC 개발', GL_W2, { align: AlignmentType.CENTER }),
        cell('Zalo OA 연동 PoC 개발(베트남 카카오톡 동등 채널), 현지 통신사 1개사 제휴 MOU 추진, 베트남어 알림톡 템플릿 시범 운영', GL_W3, { align: AlignmentType.LEFT }),
        cell('Zalo OA 연동 알파 버전, MOU 1건 체결', GL_W4, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('2027 H2', GL_W1),
        cell('현지 검증', GL_W2, { align: AlignmentType.CENTER }),
        cell('베트남어 캠페인 템플릿 + AI 문안추천 모델 검증, 호치민 거점 사무소 또는 현지 파트너십 형태 결정, 시범 고객사 3개사 확보', GL_W3, { align: AlignmentType.LEFT }),
        cell('베타 운영 사례 3건, 현지 거점 형태 확정', GL_W4, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('2028', GL_W1),
        cell('매출화', GL_W2, { align: AlignmentType.CENTER }),
        cell('유료 고객 본격 확보, 베트남 매출 5억 목표, 인도네시아·태국 시장 추가 조사', GL_W3, { align: AlignmentType.LEFT }),
        cell('베트남 매출 5억, 유료고객 20개사+', GL_W4, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('2029~2030', GL_W1),
        cell('확장', GL_W2, { align: AlignmentType.CENTER }),
        cell('베트남 매출 50억 달성 + 동남아 1위 마케팅 자동화 SaaS 위상 확보', GL_W3, { align: AlignmentType.LEFT }),
        cell('베트남 50억, 동남아 1위', GL_W4, { align: AlignmentType.LEFT })
      ]})
    ]
  }));
  children.push(par('※ 본 로드맵 실행을 위한 「혁신 프리미어 1000」 수출입은행 수출자금 100% 우대 활용 예정 (2027 H1 PoC 자금부터).', { size: 18, pOpts: { spacing: { before: 60, after: 80 } } }));

  children.push(pageBreak());

  // ========== 종합 점수 효과 요약 ==========
  children.push(h2('종합 — 점수 효과 요약'));

  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [3500, 1500, 1500, 2526],
    rows: [
      new TableRow({ children: [
        headerCell('평가 항목 (공고문 § 3.나)', 3500),
        headerCell('현재 점수', 1500),
        headerCell('보완 후', 1500),
        headerCell('적용 보완표', 2526)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발 인프라', 3500),
        dataCell('14 / 20', 1500),
        cell('17 / 20', 1500, { fill: HIGHLIGHT_FILL }),
        cell('③ R&D 정상화 투자', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('연구개발 역량', 3500),
        dataCell('16 / 20', 1500),
        cell('18 / 20', 1500, { fill: HIGHLIGHT_FILL }),
        cell('③ R&D 정상화 + 특허 6건', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('상용화 · 해외진출', 3500),
        dataCell('13 / 20', 1500),
        cell('17 / 20', 1500, { fill: HIGHLIGHT_FILL }),
        cell('④ 고객 성공사례 + ⑤ 글로벌 로드맵', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('파급효과', 3500),
        dataCell('7 / 10', 1500),
        cell('8 / 10', 1500, { fill: HIGHLIGHT_FILL }),
        cell('④ 고객 사례 + 시장 출처 인용', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('기업 성장 추이', 3500),
        dataCell('4 / 10', 1500),
        cell('7 / 10', 1500, { fill: HIGHLIGHT_FILL }),
        cell('① 매출 질 + ② 1Q 반등', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('투자실적 · 자금확보', 3500),
        dataCell('7 / 10', 1500),
        cell('8 / 10', 1500, { fill: HIGHLIGHT_FILL }),
        cell('③ R&D + 본문 자금 로드맵', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('핵심인재 확보 · 육성', 3500),
        dataCell('7 / 10', 1500),
        cell('8 / 10', 1500, { fill: HIGHLIGHT_FILL }),
        cell('본문 인력 확보 통일', 2526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        cell('합 계', 3500, { fill: HEADER_FILL }),
        cell('68 / 100', 1500, { fill: HEADER_FILL }),
        cell('83 / 100', 1500, { fill: HEADER_FILL }),
        cell('— 안정권 진입 —', 2526, { fill: HEADER_FILL, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('증빙 첨부 시 상단', 3500, { fill: ACCENT_FILL }),
        cell('—', 1500, { fill: ACCENT_FILL }),
        cell('88 / 100', 1500, { fill: ACCENT_FILL }),
        cell('주주명부·신보 투자확인서·세금계산서·신용평가서·특허등록증', 2526, { fill: ACCENT_FILL, align: AlignmentType.LEFT })
      ]})
    ]
  }));

  children.push(spacer());
  children.push(par([tr('※ 점수는 제미나이 검토(72→86점) + 모의심사위원장 보완검토(68~74→83~87점)의 평균 추정치이며, 공식 평가 결과 보장은 아님.', { size: 18, italics: true })]));

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: PAGE_PROPS, children }]
  });
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const doc = buildDoc();
  const buf = await Packer.toBuffer(doc);
  const p = path.join(OUT_DIR, '[보완표_모음]_혁신프리미어1000_한줄로AI.docx');
  fs.writeFileSync(p, buf);
  console.log('Saved:', p);
}

main().catch(e => { console.error(e); process.exit(1); });
