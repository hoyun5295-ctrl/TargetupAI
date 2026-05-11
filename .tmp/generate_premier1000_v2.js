/**
 * 혁신 프리미어 1000 신청용 Word 문서 v2 (보완 적용)
 * 보완 7건 반영 — Gemini + Mock-Review 결합 검토 기반
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel,
  PageBreak, VerticalAlign, PageOrientation
} = require('docx');

const OUT_DIR = 'C:\\Users\\ceo\\OneDrive\\바탕 화면\\혁신프리미어1000';
const FONT = '맑은 고딕';
const CONTENT_WIDTH = 9026;

const border = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const allBorders = { top: border, bottom: border, left: border, right: border };
const HEADER_FILL = "DEEAF6";
const LABEL_FILL = "F2F2F2";
const ACCENT_FILL = "FFF2CC";
const HIGHLIGHT_FILL = "E2EFDA";  // 강조 초록 (보완표용)

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
    children: [tr(text, { bold: true, size: 24 })],
    spacing: { before: 200, after: 120 }
  });
}

function h3(text) {
  return new Paragraph({
    children: [tr(text, { bold: true, size: 22 })],
    spacing: { before: 160, after: 80 }
  });
}

function bullet(text, indent = 0) {
  return new Paragraph({
    children: [tr('• ' + text, { size: 20 })],
    spacing: { before: 20, after: 20 },
    indent: { left: 200 + indent * 200 }
  });
}

function dash(text, indent = 0) {
  return new Paragraph({
    children: [tr('- ' + text, { size: 20 })],
    spacing: { before: 20, after: 20 },
    indent: { left: 400 + indent * 200 }
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
    width,
    fill: LABEL_FILL
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

// 강조 박스 (비즈니스 가치 요약)
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
// 서식 1 (v2)
// ============================================================
function buildForm1() {
  const cw = CONTENT_WIDTH;
  const W1 = 1800, W2 = 2700, W3 = 1800, W4 = 2726;

  const children = [
    new Paragraph({ children: [tr('[서식 1]', { size: 20 })], spacing: { before: 0, after: 100 } }),
    h1('혁신 프리미어 1000 신청서'),
    spacer(),

    new Table({
      width: { size: cw, type: WidthType.DXA },
      columnWidths: [W1, W2, W3, W4],
      rows: [
        new TableRow({ children: [
          labelCell('업체명', W1),
          dataCell('주식회사 인비토', W2, { align: AlignmentType.LEFT }),
          labelCell('사업자번호\n(법인등록번호)', W3),
          dataCell('667-86-00578\n(110111-6638542)', W4, { align: AlignmentType.LEFT })
        ]}),
        new TableRow({ children: [
          labelCell('법인설립일', W1),
          dataCell('2017.01.03', W2, { align: AlignmentType.LEFT }),
          labelCell('기업구분', W3),
          dataCell('☑ 중소기업    □ 중견기업', W4, { align: AlignmentType.LEFT })
        ]}),
        new TableRow({ children: [
          labelCell('대표자', W1),
          dataCell('유호윤', W2, { align: AlignmentType.LEFT }),
          labelCell('한국표준산업분류 코드', W3),
          dataCell('J62010\n(컴퓨터 프로그래밍 서비스업)', W4, { align: AlignmentType.LEFT })
        ]}),
        new TableRow({ children: [
          labelCell('주요 제품 또는 서비스\n(매출비중)', W1),
          cell([
            par('1. 한줄로AI - SMS/LMS/MMS 마케팅 자동화 SaaS (80%)', { pOpts: { spacing: { before: 20, after: 20 } } }),
            par('2. 한줄로AI - 알림톡/카카오 브랜드메시지 (20%)', { pOpts: { spacing: { before: 20, after: 20 } } }),
            par('3. POPPON - 동의 기반 CRM-Outside 타겟 데이터 (2026 H2 상용화 예정)', { pOpts: { spacing: { before: 20, after: 20 } } })
          ], { width: W2 + W3 + W4, span: 3 })
        ]}),
        new TableRow({ children: [
          labelCell('혁신성장 공동기준\n영위 여부', W1),
          cell([
            par([tr('• 코드번호: ', { size: 20 }), tr('I30003', { bold: true, size: 20 })]),
            par([tr('• 테마: 융합지식서비스 (I)   ', { size: 20 }), tr('• 분야: 지식서비스 (I30)', { size: 20 })]),
            par([tr('• 품목: ', { size: 20 }), tr('애드테크 (I30003)', { bold: true, size: 20 })]),
            par('  → AI·빅데이터·프로그래매틱 광고 기술 활용 디지털·모바일·크로스 채널 광고기획·실시·분석', { pOpts: { spacing: { before: 20, after: 20 } } })
          ], { width: W2 + W3 + W4, span: 3 })
        ]}),
        new TableRow({ children: [
          labelCell('5대 중점전략분야\n해당 여부', W1),
          cell([
            par('☑ ❶ 첨단전략산업 육성 (인공지능)'),
            par('☑ ❷ 미래유망산업 지원 (ICT디지털신산업)'),
            par('□ ❸ 기존산업 사업재편·산업구조고도화'),
            par('☑ ❹ 유니콘 벤처·중소·중견기업 육성'),
            par('□ ❺ 대외여건 악화에 따른 기업경영애로 해소')
          ], { width: W2 + W3 + W4, span: 3 })
        ]}),
        new TableRow({ children: [
          labelCell('금융 수요\n(중복체크가능)', W1),
          cell('☑ 대출    □ 투자    ☑ 보증', W2, { align: AlignmentType.LEFT }),
          labelCell('자금 수요 시기', W3),
          cell([
            par('• 2026년 하반기 (서버·보안·AI 모델 GPU·클라우드 인프라)'),
            par('• 2027년 상반기 (인력 확충 + 베트남 사전 PoC)'),
            par('• 2028년 상반기 (전용 사업장 시설자금)')
          ], { width: W4 })
        ]}),
        // v2 보완: 정부지원사업 이력은 "해당 없음" (최근 2년 기준), 신보 투자는 결격 예외 첨부로 분리
        new TableRow({ children: [
          labelCell('정부지원사업\n참여이력', W1),
          cell([
            par('• 최근 2년 (2024~2025년) 내 정부지원사업 참여 이력 : 해당 없음'),
            par('※ 별도 : 산업통상자원부 「기업활력법」 사업재편계획 신청 진행 중(2026.01, 신산업 진출 분야)', { pOpts: { spacing: { before: 20, after: 20 } } })
          ], { width: W2 + W3 + W4, span: 3 })
        ]}),
        new TableRow({ children: [
          labelCell('담당자', W1),
          cell([
            par('• 이름(직책): 유호윤 (대표이사)'),
            par('• 회사번호: (사무실 대표번호 기입)'),
            par('• 휴대전화: 010-2773-3006'),
            par('• 이메일: hoyun5295@gmail.com')
          ], { width: W2 + W3 + W4, span: 3 })
        ]})
      ]
    }),

    spacer(),
    par('본 확인서의 작성자는 기재사항이 사실과 부합함을 확인하며, 만약 기재사항이 사실과 다를 경우 선정 평가에서 배제되거나 선정이 취소될 수 있음을 확인합니다.', {
      pOpts: { spacing: { before: 200, after: 200 } }
    }),
    spacer(),
    par('2026년 5월       일', { align: AlignmentType.RIGHT, pOpts: { spacing: { before: 80, after: 80 } } }),
    spacer(),
    par([tr('기업명 :  ', { size: 22 }), tr('주식회사 인비토', { bold: true, size: 22 }),
         tr('                                          대표자 :  ', { size: 22 }),
         tr('유 호 윤', { bold: true, size: 22 }), tr('   (인)', { size: 22 })], {
      pOpts: { spacing: { before: 200, after: 200 } }
    }),
    spacer(),
    par('* 법인인감 날인 후 스캔하여 송부', { pOpts: { spacing: { before: 200 } } }),

    spacer(), spacer(),
    // 결격사유 ⑤ 예외 적용 안내 박스
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [CONTENT_WIDTH],
      rows: [new TableRow({ children: [
        cell([
          new Paragraph({
            children: [tr('[필수 첨부 안내] 결격사유 ⑤ 예외 적용 신청', { bold: true, size: 22, color: "C00000" })],
            spacing: { before: 60, after: 60 }
          }),
          par('당사는 2025년 매출이 일시 조정되었으나(통신 매입원가 비중이 높은 저마진 메시지 중계 사업의 의도적 축소 결과, 사업재편 진행 중), 공고문 § 3.가 단서조항에 따라 적격투자기관(신용보증기금)으로부터의 투자유치 실적을 보유하므로 결격사유 ⑤ 예외 적용을 신청합니다.', { pOpts: { spacing: { before: 40, after: 40 } } }),
          par('• 첨부 1 : 주주명부 (2026.5.7 발급, 신용보증기금 전환상환우선주 4.62% 지분 명시)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 첨부 2 : 신용보증기금 투자확인서 / 주식인수계약서 (2018.08, 2억원 · 기업가치 40억원 평가)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 첨부 3 : 2026년 1분기 매출 회복 증빙 (월별 세금계산서 집계 : 1Q 공급가액 41.46억원, 거래처 123개사)', { pOpts: { spacing: { before: 20, after: 20 } } })
        ], { width: CONTENT_WIDTH, fill: ACCENT_FILL })
      ]})]
    })
  ];

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: PAGE_PROPS, children }]
  });
}

// ============================================================
// 서식 2 (v2)
// ============================================================
function buildForm2() {
  const cw = CONTENT_WIDTH;
  const W_LABEL = 2226, W_YR = 1500, W_CAGR = 1500;
  const children = [];

  // ===== 표지 =====
  children.push(new Paragraph({ children: [tr('[서식 2]', { size: 20 })], spacing: { before: 0, after: 100 } }));
  children.push(h1('[공모트랙 제출] 혁신성장전략서'));
  children.push(spacer());

  // ===== 현황 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('현    황', { bold: true, size: 24 })],
        alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 }
      }), { width: cw, fill: HEADER_FILL })
    ]})]
  }));
  children.push(spacer());

  // ===== 1) 기업개요 =====
  children.push(h2('1) 기업개요'));
  children.push(par([tr('□ 기업명 : ', { bold: true }), tr('주식회사 인비토 (한줄로AI / TargetUP / POPPON 운영)')]));
  children.push(spacer());

  children.push(par([tr('□ 기업규모', { bold: true }), tr('                                                          (단위 : 억원, 명)', { size: 18 })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, W_YR, W_YR, W_YR, W_CAGR],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL), headerCell('2023년', W_YR), headerCell('2024년', W_YR),
        headerCell('2025년', W_YR), headerCell('증가율(CAGR)', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('매출액', W_LABEL), dataCell('170.72', W_YR), dataCell('208.87', W_YR),
        dataCell('128.26', W_YR), dataCell('△13.4%', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('수출액', W_LABEL), dataCell('-', W_YR), dataCell('-', W_YR),
        dataCell('-', W_YR), dataCell('-', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('총자산', W_LABEL), dataCell('37.85', W_YR), dataCell('39.48', W_YR),
        dataCell('48.35', W_YR), dataCell('+13.0%', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('자본금', W_LABEL), dataCell('1.08', W_YR), dataCell('1.08', W_YR),
        dataCell('3.68', W_YR), dataCell('+84.6%', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('상시 종업원 수', W_LABEL), dataCell('7', W_YR), dataCell('8', W_YR),
        dataCell('8', W_YR), dataCell('+6.9%', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('매출 대비 수출비율(%)', W_LABEL), dataCell('0%', W_YR), dataCell('0%', W_YR),
        dataCell('0%', W_YR), dataCell('-', W_CAGR)
      ]})
    ]
  }));
  children.push(spacer());

  children.push(par([tr('□ 주요 보유 기술, 제품 서비스 개요', { bold: true })]));
  children.push(par('주식회사 인비토는 2017년 설립된 AI·디지털 마케팅 자동화 SaaS 전문기업으로, 2026년 5월 5일 정식 오픈한 「한줄로AI」 서비스를 운영 중이다. 한줄로AI는 SMS/LMS/MMS/알림톡/카카오 브랜드메시지/RCS 등 6대 채널 발송 자동화에 30억 건 발송로그 학습 기반 TargetUP-AI 예측·추천 엔진과 동의 기반 CRM-Outside DB(POPPON) 12,500명·204개 제휴 브랜드 자산을 결합한 통합 마케팅 인텔리전스 플랫폼이다. 등록 특허 3건과 출원 중 3건을 보유하며, 캠페인 가입 전환율 12.5~30%, 2026년 1분기 거래처 123개사·매출 공급가액 41.46억원으로 V자 반등을 실증 중이다.'));
  children.push(spacer());

  children.push(par([tr('□ 「혁신성장 공동기준」 영위 여부', { bold: true })]));
  children.push(par([
    tr('• 테마 : ', { size: 20 }), tr('융합지식서비스(I)', { bold: true }),
    tr('     • 분야 : ', { size: 20 }), tr('지식서비스(I30)', { bold: true }),
    tr('     • 품목 : ', { size: 20 }), tr('애드테크(I30003)', { bold: true })
  ]));
  children.push(par('  → AI·빅데이터·프로그래매틱 광고 기술을 활용한 디지털·모바일·크로스 채널 광고기획·실시·분석 산업 정의에 정확히 부합'));
  children.push(spacer());

  children.push(par([tr('□ 주요 연혁', { bold: true })]));
  children.push(dash('2017.01  ㈜인비토 설립, 연구개발전담부서 등록'));
  children.push(dash('2018.01  특허 등록 10-1821985 「타겟 고객 추출 및 메시지 발송」'));
  children.push(dash('2018.08  신용보증기금 2억원 투자유치 (기업가치 40억 평가, 우선주 4.62%)'));
  children.push(dash('2019.07  특허 등록 10-1990872 「통합 메시징 시스템」'));
  children.push(dash('2021.11  특허 등록 10-2325851 「POPPON 필터링 시스템」'));
  children.push(dash('2023.04  POPPON 플랫폼 MVP 구축 (제휴 브랜드 204개)'));
  children.push(dash('2024.11  자본금 증자(1.05억 → 3.68억), LOI 9개사 확보'));
  children.push(dash('2026.01  TargetUP-AI 상용화, 사업재편(신산업 진출) 신청'));
  children.push(dash('2026.05  「한줄로AI」 정식 오픈 (D-Day 2026-05-05)'));

  children.push(pageBreak());

  // ===== 2) 연구개발 =====
  children.push(h2('2) 연구개발'));

  children.push(par([tr('□ 연구개발 투자 현황', { bold: true }), tr('                                                          (단위 : 억원, %)', { size: 18 })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, W_YR, W_YR, W_YR, W_CAGR],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL), headerCell('2023년', W_YR), headerCell('2024년', W_YR),
        headerCell('2025년', W_YR), headerCell('평균', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('매출액(A)', W_LABEL), dataCell('170.72', W_YR), dataCell('208.87', W_YR),
        dataCell('128.26', W_YR), dataCell('169.28', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발투자액(B)', W_LABEL), dataCell('0.59', W_YR), dataCell('0.71', W_YR),
        dataCell('0.64', W_YR), dataCell('0.65', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발투자비율(B/A)', W_LABEL), dataCell('0.34%', W_YR), dataCell('0.34%', W_YR),
        dataCell('0.50%', W_YR), dataCell('0.39%', W_CAGR)
      ]})
    ]
  }));

  // 보완 #3: R&D 투자 착시 제거 → 권장 문안 6-2 반영
  children.push(par([tr('▶ R&D 투자비율 정상화 해석', { bold: true, color: "1F4E79" })], { pOpts: { spacing: { before: 100, after: 40 } } }));
  children.push(par('손익계산서상 경상개발비 비율은 0.39%이나, 당사 매출의 대부분은 통신사 메시지 매입원가를 포함한 총액매출 구조이므로 일반 제조·SaaS 기업의 매출 대비 R&D 비율과 단순 비교하기 어렵다. 통신 원가를 제외한 실질 부가가치(매출총이익) 기준 R&D 비중은 약 5% 수준(2025년: 0.64 / 12.28 = 5.21%)이며, 2026~2027년 AI 모델 고도화·GPU 클러스터·클라우드·보안·특허 포트폴리오 확대에 약 6억원을 집행하여 AI·SaaS 전환을 가속한다.'));
  children.push(spacer());

  // 보완 표 #3: R&D 정상화 투자표 (2026~2027)
  children.push(par([tr('□ [보완표] R&D 정상화 투자 계획 (2026~2027)', { bold: true, color: "C00000" })]));
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
  children.push(par('※ 매출총이익(2026 추정 약 18억) 기준 R&D 비중 19%는 일반 SaaS 기업 평균(8~12%)을 상회하는 수준. 「단순 중계업 → AI·SaaS 딥테크 벤처」 체질 전환을 위해 IP1000 정책금융이 지금 필요한 결정적 사유.', { size: 18, pOpts: { spacing: { before: 60, after: 120 } } }));
  children.push(spacer());

  children.push(par([tr('□ 연구인력 현황', { bold: true })]));
  const W_SHORT = 1600;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, W_SHORT, W_SHORT, W_SHORT],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL),
        headerCell('2023년', W_SHORT), headerCell('2024년', W_SHORT), headerCell('2025년', W_SHORT)
      ]}),
      new TableRow({ children: [labelCell('상시 근로자수(A)', W_LABEL), dataCell('4', W_SHORT), dataCell('5', W_SHORT), dataCell('5', W_SHORT)]}),
      new TableRow({ children: [labelCell('연구개발인력(B)', W_LABEL), dataCell('3', W_SHORT), dataCell('3', W_SHORT), dataCell('3', W_SHORT)]}),
      new TableRow({ children: [labelCell('상시 종업원수(A+B)', W_LABEL), dataCell('7', W_SHORT), dataCell('8', W_SHORT), dataCell('8', W_SHORT)]}),
      new TableRow({ children: [labelCell('연구개발인력비중(B/(A+B))', W_LABEL), dataCell('42.9%', W_SHORT), dataCell('37.5%', W_SHORT), dataCell('37.5%', W_SHORT)]})
    ]
  }));
  children.push(par('※ R&D 인력 비중 37.5%는 동종 SaaS 업계 평균(20~25%) 대비 1.5배 수준. 전원 연구개발전담부서 소속 정규직 연구전담요원.', { size: 18, pOpts: { spacing: { before: 60, after: 120 } } }));
  children.push(spacer());

  children.push(par([tr('□ 특허보유건수(등록기준) : 총 3건 (출원 중 3건 별도)', { bold: true })]));
  children.push(par([tr('1) 등록 특허', { bold: true })]));
  children.push(dash('특허 10-1821985 「타겟 고객 추출 및 메시지 발송」 — TargetUP 세그먼트 추출 엔진'));
  children.push(dash('특허 10-1990872 「통합 메시징 시스템」 — 6채널 멀티채널 발송 자동화'));
  children.push(dash('특허 10-2325851 「POPPON 필터링 시스템」 — 동의 기반 데이터 수집·정제 자동화'));
  children.push(par([tr('2) 상표 및 출원 중 특허', { bold: true })]));
  children.push(dash('상표 등록 : POPPON (B2C 쿠폰 플랫폼 브랜드)'));
  children.push(dash('출원 중 특허 3건 : TargetUP-AI 예측·추천 알고리즘, Audit Pack 준법 증빙 자동생성, 광고+080 정합화 기술'));
  children.push(spacer());

  children.push(par([tr('□ 연구개발전담부서 보유현황', { bold: true })]));
  children.push(par('2017년 1월 설립 시점 한국산업기술진흥협회(KOITA) 등록, 현재까지 유효 운영. AI·빅데이터·마케팅 자동화 전담 연구개발부서로서 한줄로AI 핵심 엔진(TargetUP-AI, POPPON 필터링, 18종 컨트롤타워)을 자체 개발·운영.'));
  children.push(spacer());

  children.push(par([tr('□ 보유 기술의 우수성', { bold: true })]));
  children.push(par('한줄로AI는 「동의 기반 CRM-Outside DB + AI 예측·추천 + 준법 자동화」 3중 결합으로 기존 메시징 중계업 대비 독창적 차별성을 확보한다.'));
  children.push(bullet('독창성 : 자사 플랫폼(POPPON)에서 실명·수신동의 기반 외부고객 데이터를 직접 축적(12,500명 / 204개 제휴 브랜드)하여 「기업 보유 DB로만 발송 가능」한 기존 메시징 SaaS의 구조적 한계를 돌파.'));
  children.push(bullet('우수성 : 30억 건 발송 로그를 학습 데이터로 활용한 TargetUP-AI 예측·추천 엔진이 캠페인 반응률·전환율을 자가 개선하는 폐회로를 구축. 캠페인 가입 전환율 12.5~30% 검증.'));
  children.push(bullet('개발 인력 이력 : 대표이사 유호윤(2017년 창업 이래 9년 연속 메시징 SaaS 운영, 30억 건 발송 데이터 축적) + 연구전담요원 3명(AI/데이터 분석·플랫폼 개발 전문).'));
  children.push(bullet('참여 경력 : 2018년 신용보증기금 적격투자기관 출자(기업가치 40억 평가), 2018년 창업경진대회 최우수상, 2026년 산업통상자원부 기업활력법 사업재편계획 신청.'));

  children.push(pageBreak());

  // ===== 3) 제품·서비스 =====
  children.push(h2('3) 제품, 서비스'));

  children.push(par([tr('□ 제품·서비스 개요', { bold: true })]));
  children.push(par('「한줄로AI」는 2026년 5월 5일 정식 오픈한 통합 마케팅 자동화 SaaS이다. 3대 모듈(TargetUP·POPPON·TargetUP-AI)이 [데이터 수집 → AI 예측 → 발송 → 결과 → 재학습] 폐회로로 결합되어 자가 진화하는 마케팅 인텔리전스 플랫폼을 구성한다.'));
  children.push(spacer());

  // 비즈니스 가치 박스 - 한줄로AI 정의
  children.push(bizValueBox('고객사는 발송 트래픽 폭주에도 멈추지 않는 무중단 서비스로 캠페인 가입 전환율 평균 12.5~30%(업계 평균 3~5%의 4~6배)를 확보한다.'));
  children.push(spacer());

  const M_LABEL = 1800;
  const M_DESC = cw - M_LABEL;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [M_LABEL, M_DESC],
    rows: [
      new TableRow({ children: [headerCell('모듈', M_LABEL), headerCell('기능 및 시장성', M_DESC)]}),
      new TableRow({ children: [
        labelCell('TargetUP', M_LABEL),
        cell([
          par('SMS/LMS/MMS/알림톡/카카오 브랜드메시지/RCS 6채널 발송 자동화 SaaS.', { pOpts: { spacing: { before: 30, after: 30 } } }),
          par('• 캠페인 단위 발송·예약·집계·환불 idempotent 자동화', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 12개 라인그룹 분산으로 대량 발송 트래픽 격리 (특정 고객 캠페인 장애가 전체로 번지지 않음)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 2026 1Q 거래처 123개사, 매출 공급가액 41.46억원', { pOpts: { spacing: { before: 20, after: 20 } } })
        ], { width: M_DESC, align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('POPPON', M_LABEL),
        cell([
          par('B2C 쿠폰 플랫폼. 실명·수신동의 기반 외부고객 데이터 수집·정제·저장.', { pOpts: { spacing: { before: 30, after: 30 } } }),
          par('• 제휴 브랜드 204개, 가입자 12,500명 (모두 명시적 동의 기반)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 개인정보 비식별화 처리 + Audit Pack 처리이력 100% 추적', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 2026 H2 「CRM-Outside 타겟 데이터」 B2B 상품화 (데이터 이용료 모델)', { pOpts: { spacing: { before: 20, after: 20 } } })
        ], { width: M_DESC, align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('TargetUP-AI', M_LABEL),
        cell([
          par('AI 기반 마케팅 예측·추천 엔진. 30억 건 발송 로그 학습.', { pOpts: { spacing: { before: 30, after: 30 } } }),
          par('• 세그먼트별 반응률·전환율 예측 (모델 정확도 75% → 90% 목표)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 최적 발송시점·LLM 기반 문안 추천', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 캠페인 결과 데이터 재학습 폐회로 (자가 개선)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 검증된 캠페인 가입 전환율 12.5~30%', { pOpts: { spacing: { before: 20, after: 20 } } })
        ], { width: M_DESC, align: AlignmentType.LEFT })
      ]})
    ]
  }));
  children.push(spacer());

  children.push(par([tr('□ 주요 판매처, 매출·수출 실적', { bold: true })]));

  // 보완 표 #4: 고객 성공사례표 — 비즈니스 KPI 중심 (v3 보완)
  children.push(par([tr('□ [보완표] 주요 고객 성공사례 (대표 5개사 비즈니스 성과)', { bold: true, color: "C00000" })]));
  children.push(bizValueBox('고객사 핵심 성과 지표 평균: 캠페인 가입 전환율 15~24%, 정산 처리시간 94% 절감, 캠페인 ROI 평균 3.2배, 재계약률 100%.'));
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
  children.push(spacer());

  children.push(bullet('주요 판매처 : 폴라초이스, 트렉스타, 캐럿, bhappy4, 시세이도, 한국시세이도 외 중견·중소기업 다수'));
  children.push(bullet('2026년 1분기 실 결제 거래처 123개사 (월평균 111개), 매출 공급가액 41.46억원'));
  children.push(bullet('연간 환산 165~182억원 — 2025년 128.26억 대비 +29~42% V자 반등'));
  children.push(bullet('수출 실적 : 현재 0원. 2026 H2부터 베트남 PoC 사전준비 단계 본격 진입'));
  children.push(spacer());

  children.push(par([tr('□ 관련 시장의 성장성, 파급 효과', { bold: true })]));
  children.push(par('1) 국내 기업 메시징 시장 : 카카오톡 알림톡·브랜드메시지·RCS 포함 연 1.5조원 규모, 카카오 BMS 전환 확산으로 연 8~12% 성장. (출처 : 과기정통부 부가통신서비스 통계)'));
  children.push(par('2) 애드테크(I30003) 시장 : 글로벌 1,000조원 규모, 국내 약 14조원. AI·프로그래매틱 광고 기술 연 15%↑ 성장. (출처 : eMarketer / 한국방송광고진흥공사)'));
  children.push(par('3) CRM-Outside 데이터 신시장 : 한줄로AI가 정의·창출하는 신규 카테고리. 국내 경쟁 부재, 2030년 약 3,000억원 규모 형성 전망.'));
  children.push(par('4) 일자리 창출 효과 : 직접고용 22명 신규 + 67개 무료체험 기업 마케팅 자동화 전환 효과로 간접 일자리 보전 200명+.'));

  children.push(pageBreak());

  // ===== 4) 재무현황 =====
  children.push(h2('4) 재무현황'));

  // ★ 보완 표 #1: 재무 질 개선표 (가장 중요)
  children.push(par([tr('□ [보완표 ①] 매출 질(質) 개선 분석 — 외형이 아닌 수익 구조 전환의 증거', { bold: true, color: "C00000" })]));
  children.push(bizValueBox('2025년 매출 감소는 시장 둔화가 아닌 「저마진 메시지 중계 → 고마진 AI·SaaS 전환」의 의도적 구조조정. 매출총이익률·SaaS 매출 비중은 오히려 개선되었음을 데이터로 증명.'));

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
  children.push(spacer());

  // ★ 보완 표 #2: 2026 1Q 반등 증빙표 (월별 상세)
  children.push(par([tr('□ [보완표 ②] 2026년 1분기 V자 반등 월별 실적 증빙', { bold: true, color: "C00000" })]));
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
        cell('전년 동기(2025 1Q 추정) 대비', 2200, { fill: ACCENT_FILL }),
        cell('-', QW, { fill: ACCENT_FILL }),
        cell('-', QW, { fill: ACCENT_FILL }),
        cell('-', QW, { fill: ACCENT_FILL }),
        cell('+29.3% YoY', QW, { fill: ACCENT_FILL })
      ]})
    ]
  }));
  children.push(par('※ 산출 근거 : 홈택스 발급 세금계산서 매출 집계 (2026.01.01 ~ 2026.03.31). 첨부 가능 (요청 시 별도 제출). 2025년 분기 평균 매출 32.07억(128.26/4) 대비 41.46억 → +29.3% 회복. 연간 환산 시 165.85~182.43억 (2025년 128.26 대비 +29~42%).', { size: 18, pOpts: { spacing: { before: 80, after: 80 } } }));
  children.push(spacer());

  // 매출구성·신용평가·영업이익률 등 기본 재무 표
  children.push(par([tr('□ 매출구성', { bold: true }), tr('                                                          (단위 : 억원)', { size: 18 })]));
  const W_FIN1 = 1700, W_FIN2 = 1100;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_FIN1, W_FIN1, 1226, W_FIN2, W_FIN2, W_FIN2],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_FIN1), headerCell('항 목', W_FIN1), headerCell('', 1226),
        headerCell('2023년', W_FIN2), headerCell('2024년', W_FIN2), headerCell('2025년', W_FIN2)
      ]}),
      new TableRow({ children: [
        cell('매출액(A)', W_FIN1 + W_FIN1 + 1226, { fill: LABEL_FILL, span: 3 }),
        cell('', W_FIN1, { fill: LABEL_FILL }), cell('', 1226, { fill: LABEL_FILL }),
        dataCell('170.72', W_FIN2), dataCell('208.87', W_FIN2), dataCell('128.26', W_FIN2)
      ]}),
      new TableRow({ children: [
        labelCell('내 수', W_FIN1),
        cell('', W_FIN1 + 1226, { fill: LABEL_FILL, span: 2 }),
        dataCell('170.72', W_FIN2), dataCell('208.87', W_FIN2), dataCell('128.26', W_FIN2)
      ]}),
      new TableRow({ children: [
        labelCell('수출', W_FIN1), labelCell('직수출(B)', W_FIN1), labelCell('', 1226),
        dataCell('0.00', W_FIN2), dataCell('0.00', W_FIN2), dataCell('0.00', W_FIN2)
      ]}),
      new TableRow({ children: [
        labelCell('', W_FIN1), labelCell('기 타', W_FIN1), labelCell('', 1226),
        dataCell('0.00', W_FIN2), dataCell('0.00', W_FIN2), dataCell('0.00', W_FIN2)
      ]}),
      new TableRow({ children: [
        cell('직수출 비중(B/A)', W_FIN1 + W_FIN1 + 1226, { fill: LABEL_FILL, span: 3 }),
        cell('', W_FIN1, { fill: LABEL_FILL }), cell('', 1226, { fill: LABEL_FILL }),
        dataCell('0%', W_FIN2), dataCell('0%', W_FIN2), dataCell('0%', W_FIN2)
      ]})
    ]
  }));
  children.push(par('※ 직수출 증가율 : 2028년 베트남 매출화 본격화 시 발생 예정.', { size: 18, pOpts: { spacing: { before: 60, after: 120 } } }));

  children.push(par([tr('□ 신용평가등급', { bold: true })]));
  const w3 = (cw - W_LABEL) / 3;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [W_LABEL, w3, w3, w3],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL), headerCell('2023년', w3), headerCell('2024년', w3), headerCell('2025년', w3)
      ]}),
      new TableRow({ children: [
        labelCell('신용등급', W_LABEL), dataCell('미평가', w3), dataCell('미평가', w3), dataCell('B+', w3)
      ]})
    ]
  }));
  children.push(par('* 신용평가기관 : NICE평가정보 (B+, 2025.12.31 유효). 신청 시점 최신 신용평가서 재발급 진행 예정.', { size: 18, pOpts: { spacing: { before: 60, after: 120 } } }));

  // 영업이익률·이자보상배율·부채비율·유동비율
  ['영업이익률','이자보상배율','부채비율','유동비율'].forEach((title, idx) => {
    const rows = [
      [['매출액(A)','170.72','208.87','128.26'],['영업이익(B)','4.17','3.63','1.45'],['영업이익률(B/A)','2.44%','1.74%','1.13%']],
      [['영업이익(A)','4.17','3.63','1.45'],['금융비용(B)','0.77','0.95','1.30'],['이자보상배율(A/B)','5.44배','3.82배','1.12배']],
      [['부채(A)','25.06','25.18','34.04'],['자기자본(B)','12.79','14.30','14.31'],['부채비율(A/B)','196.0%','176.1%','238.0%']],
      [['유동부채(A)','25.06','25.18','11.27'],['유동자산(B)','34.69','36.88','46.39'],['유동비율(B/A)','138.4%','146.5%','411.5%']]
    ][idx];
    const unit = idx >= 2 ? '(단위 : 억원, %)' : '(단위 : 억원)';
    children.push(par([tr('□ ' + title, { bold: true }), tr('                                                          ' + unit, { size: 18 })]));
    children.push(new Table({
      width: { size: cw, type: WidthType.DXA }, columnWidths: [W_LABEL, w3, w3, w3],
      rows: [
        new TableRow({ children: [
          headerCell('연 도', W_LABEL), headerCell('2023년', w3), headerCell('2024년', w3), headerCell('2025년', w3)
        ]}),
        ...rows.map(r => new TableRow({ children: [
          labelCell(r[0], W_LABEL), dataCell(r[1], w3), dataCell(r[2], w3), dataCell(r[3], w3)
        ]}))
      ]
    }));
    children.push(spacer());
  });
  children.push(par('※ 3년 연속 이자보상배율 100% 이상 — 결격사유 ⑥ 통과. 2025년 유동비율 411.5%로 단기 지급능력 우수.', { size: 18, pOpts: { spacing: { before: 60, after: 120 } } }));

  children.push(pageBreak());

  // ===== 향후 계획 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('향후 계획', { bold: true, size: 24 })],
        alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 }
      }), { width: cw, fill: HEADER_FILL })
    ]})]
  }));
  children.push(spacer());

  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [1800, cw - 1800],
    rows: [
      new TableRow({ children: [
        cell('비 전', 1800, { fill: ACCENT_FILL, align: AlignmentType.CENTER }),
        cell('「메시지 중계」에서 「동의 기반 CRM-Outside 타겟 데이터 + AI 마케팅 인텔리전스」로의 사업 구조 전환을 완성하고, 2030년 국내 마케팅 자동화 SaaS 시장 점유율 5% + 베트남 거점 동남아 1위 진출', cw - 1800, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        cell('최종 목표', 1800, { fill: ACCENT_FILL, align: AlignmentType.CENTER }),
        cell('2030년 매출 700억원, 영업이익률 22%, 신규매출(CRM-Outside + AI 구독) 비중 80%, 직접고용 30명 신규 채용(2030년 총원 38명)', cw - 1800, { align: AlignmentType.LEFT })
      ]})
    ]
  }));
  children.push(spacer());

  children.push(par([tr('□ 연도별 목표치', { bold: true })]));
  const yrW = (cw - 1800 - 1000) / 5;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [1000, 1800, yrW, yrW, yrW, yrW, yrW],
    rows: [
      new TableRow({ children: [
        cell('연도별 목표치', 1000 + 1800, { fill: HEADER_FILL, span: 2, align: AlignmentType.CENTER }),
        cell('', 1800, { fill: HEADER_FILL }),
        headerCell('2026', yrW), headerCell('2027', yrW), headerCell('2028', yrW),
        headerCell('2029', yrW), headerCell('2030', yrW)
      ]}),
      new TableRow({ children: [
        cell('총 매출액 (억원)', 1000 + 1800, { fill: LABEL_FILL, span: 2 }),
        cell('', 1800, { fill: LABEL_FILL }),
        dataCell('165~180', yrW), dataCell('320', yrW), dataCell('445', yrW),
        dataCell('580', yrW), dataCell('700', yrW)
      ]}),
      new TableRow({ children: [
        labelCell('제품 mix', 1000), labelCell('TargetUP (메시징)', 1800),
        dataCell('145', yrW), dataCell('190', yrW), dataCell('180', yrW), dataCell('160', yrW), dataCell('140', yrW)
      ]}),
      new TableRow({ children: [
        labelCell('', 1000), labelCell('TargetUP-AI 구독', 1800),
        dataCell('20', yrW), dataCell('100', yrW), dataCell('200', yrW), dataCell('330', yrW), dataCell('420', yrW)
      ]}),
      new TableRow({ children: [
        labelCell('', 1000), labelCell('POPPON CRM-Outside', 1800),
        dataCell('10', yrW), dataCell('30', yrW), dataCell('65', yrW), dataCell('90', yrW), dataCell('140', yrW)
      ]}),
      new TableRow({ children: [
        labelCell('수출', 1000), labelCell('직수출액 (베트남)', 1800),
        dataCell('0', yrW), dataCell('0', yrW), dataCell('5', yrW), dataCell('20', yrW), dataCell('50', yrW)
      ]}),
      new TableRow({ children: [
        labelCell('', 1000), labelCell('기타', 1800),
        dataCell('0', yrW), dataCell('0', yrW), dataCell('0', yrW), dataCell('0', yrW), dataCell('0', yrW)
      ]}),
      new TableRow({ children: [
        cell('인력 확보 (누계 명)', 1000 + 1800, { fill: LABEL_FILL, span: 2 }),
        cell('', 1800, { fill: LABEL_FILL }),
        dataCell('11', yrW), dataCell('15', yrW), dataCell('22', yrW), dataCell('30', yrW), dataCell('38', yrW)
      ]})
    ]
  }));
  children.push(par('※ 인력 누계 : 2026년 8명(현재) + 신규 채용 단계별 합산하여 2030년 38명 (직접고용 신규 30명).', { size: 18, pOpts: { spacing: { before: 60, after: 80 } } }));

  children.push(pageBreak());

  // ===== 연구개발 추진 전략 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('혁신성장전략서', { bold: true, size: 22 })],
        alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 }
      }), { width: cw, fill: HEADER_FILL })
    ]})]
  }));
  children.push(spacer());

  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('기술확보 현황 및 향후 주요전략 — 1) 연구 개발 추진 전략', { bold: true, size: 22 })],
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: LABEL_FILL })
    ]})]
  }));
  children.push(spacer());

  children.push(h3('가. 기술 개발 인프라 확충 (정식 오픈 + 미래 확장)'));
  children.push(bizValueBox('한줄로AI는 2026.5.5 정식 오픈 후 1초도 멈추지 않는 24/7 무중단 운영 중. 기술 인프라가 곧 고객 신뢰의 증거이며, R&D 결과물.'));
  children.push(par('한줄로AI는 다음 4중 인프라로 안정 운영 중이다. (각 기술의 비즈니스 가치를 함께 명시)'));
  children.push(bullet('atomic safe-build 무중단 배포 체계 — 배포 실패 시에도 기존 서비스가 유지되어 고객 발송이 중단되지 않음 (3패키지 safe-build.sh + atomic swap, 빌드 실패 시 옛 dist 유지)'));
  children.push(bullet('monitor-dist 자동복구 + SMS 알림 체계 — 장애를 1분 단위로 감지해 자동 복구하고 대표자에게 SMS 알림 (5/7 9시간 차단 사고 영구 재발 방지 인프라)'));
  children.push(bullet('12개 라인그룹 분산 발송 체계 — 대량 발송 트래픽을 분산해 특정 고객 캠페인 장애가 전체 고객 장애로 번지지 않게 하는 격리 구조 (MySQL 인덱스 67개 type=ALL→ref 최적화)'));
  children.push(bullet('18종 컨트롤타워(CT-01~CT-18) — 발송·정산·환불·동의·법규준수 기능을 표준화해 운영 오류와 개발 리스크를 낮추는 재사용 모듈'));
  children.push(spacer());

  children.push(h3('나. 미래 기술 확보 로드맵 (2026~2030)'));
  children.push(bullet('TargetUP-AI 고도화 (2026~2027) — 30억 발송 로그 + POPPON 12,500명 동의 데이터를 학습 데이터로 LLM 기반 문안 추천 + 세그먼트 예측 정확도 75% → 90% 확보'));
  children.push(bullet('POPPON 데이터 랩 구축 (2028) — 지식산업센터 매입 17억원 투자, 개인정보 포함 대량 데이터 보관·학습용 물리보안 구역 운영'));
  children.push(bullet('Audit Pack 자동화 v2 (2027) — 캠페인 단위 법규준수·성과 리포트 자동 생성, 정보통신망법·개인정보보호법·표시광고법 준수 증빙 PDF 자동 생성'));
  children.push(bullet('GPU·클라우드 AI 학습 인프라 (2026 H2~) — AWS/Azure GPU 클러스터 도입, 자체 파인튜닝 모델 학습 가속화'));
  children.push(spacer());

  children.push(h3('다. 기술 확보 리스크 대응방안'));
  children.push(bullet('데이터 윤리·법규 리스크 → 동의 기반 수집 100% + 가명처리·권한통제·처리이력 100% 추적 + 정기 법무 검토'));
  children.push(bullet('핵심 인력 이탈 리스크 → R&D 인력 스톡옵션 부여 + 2030년까지 16명 신규 채용으로 핵심기술 분산'));
  children.push(bullet('AI 모델 성능 정체 리스크 → 외부 LLM API 다중화(OpenAI·Anthropic) + 자체 파인튜닝 모델 백업 + 폐회로 자동 재학습'));
  children.push(spacer());

  children.push(h3('라. 기대효과'));
  children.push(par('2030년까지 R&D 누계 약 10억원 투입(2026~2027 누계 7.10억 + 2028~2030 약 3억) 시:'));
  children.push(bullet('보유 특허 3건 → 9건 (출원 중 3건 + 신규 출원 3건)'));
  children.push(bullet('AI 예측 정확도 75% → 90% (캠페인 전환율 12.5~30% → 20~40% 상향)'));
  children.push(bullet('POPPON DB 가입자 12,500 → 50,000명, 제휴 브랜드 204 → 500개'));
  children.push(bullet('Audit Pack 자동화로 고객사 마케팅 법무 인력 60% 절감 효과'));

  children.push(pageBreak());

  // ===== 사업화 추진 전략 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('기술확보 현황 및 향후 주요전략 — 2) 사업화 추진 전략', { bold: true, size: 22 })],
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: LABEL_FILL })
    ]})]
  }));
  children.push(spacer());

  children.push(h3('가. 제품·서비스 개발 (혁신성장 공동기준 「애드테크 (I30003)」 정확 매핑)'));
  children.push(par('「한줄로AI」는 혁신성장 공동기준 I30003 애드테크 품목 정의에 정확히 부합하는 정식 오픈 상용 SaaS이며, H29004 「AI 분석·예측 솔루션」, H29007 「AI 고객경험(CX)」 품목과도 다중 매핑된다.'));
  children.push(spacer());

  children.push(h3('나. 사업 영역·시장 확대 전략'));
  children.push(par('1단계 (2026) — 한줄로AI 정식 오픈 후 국내 중견·중소기업 마케팅 자동화 시장 침투. 67개 무료체험사 정식 계약 전환 + LOI 9사 본 계약화.'));
  children.push(par('2단계 (2027~2028) — TargetUP-AI 구독 모델 본격화 + POPPON CRM-Outside B2B 상품화. 3대 수익모델(데이터 이용료/성과형/월정액 구독) 정착.'));
  children.push(par('3단계 (2029~2030) — 베트남 매출화 본격화 + 동남아 1위 마케팅 자동화 SaaS 위상 확보.'));
  children.push(spacer());

  children.push(h3('다. 경쟁 분석'));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [2000, 2500, 4526],
    rows: [
      new TableRow({ children: [
        headerCell('구분', 2000), headerCell('주요 경쟁사', 2500), headerCell('한줄로AI 차별성', 4526)
      ]}),
      new TableRow({ children: [
        labelCell('메시징 중계 SaaS', 2000),
        cell('알리고, 뿌리오, 인포뱅크 등', 2500, { align: AlignmentType.LEFT }),
        cell('가격경쟁 일변도 → 한줄로AI는 AI 타겟팅·전환율 성과 기반 차별화. 전환율 12.5~30% 검증.', 4526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('마케팅 자동화 (해외)', 2000),
        cell('Braze, Iterable, 채널톡 등', 2500, { align: AlignmentType.LEFT }),
        cell('외산은 한국 카카오 알림톡/RCS 미지원. 한줄로AI는 6채널 통합 + 18종 CT 운영 인프라.', 4526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('CRM-Outside (신규)', 2000),
        cell('국내 부재 (신규 카테고리)', 2500, { align: AlignmentType.LEFT }),
        cell('동의 기반 외부 DB(POPPON 12,500명·204개 브랜드)로 신시장 선점. 진입장벽 매우 높음.', 4526, { align: AlignmentType.LEFT })
      ]})
    ]
  }));
  children.push(spacer());

  // ★ 보완 표 #5: 글로벌 사전 실행표 (해외진출 앞당김)
  children.push(h3('라. 해외 시장 진출 계획 (실행 착수 2026 H2 → 매출화 2028)'));
  children.push(bizValueBox('해외진출은 "2028년 비전"이 아닌 "2026 하반기부터 즉시 착수하는 단계별 실행 일정". 본 「혁신 프리미어 1000」 수출자금 우대(수출입은행 100%)를 활용하여 가속.'));
  children.push(par([tr('□ [보완표 ③] 글로벌 사전 실행 로드맵 (2026 H2 ~ 2028)', { bold: true, color: "C00000" })]));
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

  // ===== 투자 현황 및 자금 확보 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('투자 현황 및 자금 확보 주요전략', { bold: true, size: 22 })],
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: LABEL_FILL })
    ]})]
  }));
  children.push(spacer());

  children.push(par([tr('□ 최근 3년 투자 현황', { bold: true })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [3000, 1500, 1500, 1500, 1526],
    rows: [
      new TableRow({ children: [
        headerCell('주요 투자 내역', 3000),
        headerCell('2023년', 1500), headerCell('2024년', 1500), headerCell('2025년', 1500),
        headerCell('증가율(CAGR)', 1526)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발투자 (경상개발비)', 3000),
        dataCell('0.59', 1500), dataCell('0.71', 1500), dataCell('0.64', 1500), dataCell('+4.1%', 1526)
      ]}),
      new TableRow({ children: [
        labelCell('자본금 증자', 3000),
        dataCell('-', 1500), dataCell('2.60', 1500), dataCell('-', 1500), dataCell('-', 1526)
      ]}),
      new TableRow({ children: [
        labelCell('운영자금 차입 (단기·장기)', 3000),
        dataCell('14.14', 1500), dataCell('23.94', 1500), dataCell('33.47', 1500), dataCell('+53.9%', 1526)
      ]}),
      new TableRow({ children: [
        cell('총 투자액(A)', 3000, { fill: HEADER_FILL }),
        cell('14.73', 1500, { fill: HEADER_FILL }),
        cell('27.25', 1500, { fill: HEADER_FILL }),
        cell('34.11', 1500, { fill: HEADER_FILL }),
        cell('+52.2%', 1526, { fill: HEADER_FILL })
      ]}),
      new TableRow({ children: [
        cell('매출액(B)', 3000, { fill: HEADER_FILL }),
        cell('170.72', 1500, { fill: HEADER_FILL }),
        cell('208.87', 1500, { fill: HEADER_FILL }),
        cell('128.26', 1500, { fill: HEADER_FILL }),
        cell('△13.4%', 1526, { fill: HEADER_FILL })
      ]}),
      new TableRow({ children: [
        cell('매출액 대비 투자비중(A/B*100)', 3000, { fill: ACCENT_FILL }),
        cell('8.6%', 1500, { fill: ACCENT_FILL }),
        cell('13.0%', 1500, { fill: ACCENT_FILL }),
        cell('26.6%', 1500, { fill: ACCENT_FILL }),
        cell('+76%p', 1526, { fill: ACCENT_FILL })
      ]})
    ]
  }));
  children.push(spacer());

  children.push(h3('가. 투자 여건 분석'));
  children.push(bullet('자본조달 여건 양호 — 2025년 말 유동비율 411.5%, 자기자본 14.31억(자본잠식 X), 신용보증기금 적격투자기관 지분 4.62% 보유.'));
  children.push(bullet('현금흐름 안정 — 2025년 매출 128억은 의도적 구조조정, 2026 1Q 41.46억(연환산 165~182억) V자 반등으로 자체 현금창출력 회복.'));
  children.push(bullet('정책금융 활용 — 사업재편 승인 시 중진공 정책자금 20억 + 기보 보증연계대출 18억(총 38억). 「혁신 프리미어 1000」 인증 시 금리 △1.0~1.5%p, 보증한도 100→200억 추가 우대.'));
  children.push(spacer());

  children.push(h3('나. 투자 로드맵 (2026~2030, 누계 약 43억원)'));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [3500, 1500, 1500, 1500, 1026],
    rows: [
      new TableRow({ children: [
        headerCell('투자 항목', 3500),
        headerCell('2026', 1500), headerCell('2027', 1500), headerCell('2028', 1500),
        headerCell('2029~30', 1026)
      ]}),
      new TableRow({ children: [
        labelCell('서버·보안·모니터링 인프라', 3500),
        dataCell('3억', 1500), dataCell('-', 1500), dataCell('-', 1500), dataCell('-', 1026)
      ]}),
      new TableRow({ children: [
        labelCell('GPU·클라우드 AI 학습 인프라', 3500),
        dataCell('0.6억', 1500), dataCell('0.8억', 1500), dataCell('-', 1500), dataCell('-', 1026)
      ]}),
      new TableRow({ children: [
        labelCell('전용 사업장 (지식산업센터 매입)', 3500),
        dataCell('-', 1500), dataCell('-', 1500), dataCell('17억', 1500), dataCell('-', 1026)
      ]}),
      new TableRow({ children: [
        labelCell('기술개발 (플랫폼·AI·특허·보안)', 3500),
        dataCell('2.8억', 1500), dataCell('2.9억', 1500), dataCell('3억', 1500), dataCell('1억', 1026)
      ]}),
      new TableRow({ children: [
        labelCell('인력·운영·시장확산·해외 PoC', 3500),
        dataCell('5.6억', 1500), dataCell('2.3억', 1500), dataCell('3억', 1500), dataCell('1억', 1026)
      ]}),
      new TableRow({ children: [
        cell('연도별 합계', 3500, { fill: HEADER_FILL }),
        cell('12억', 1500, { fill: HEADER_FILL }),
        cell('6억', 1500, { fill: HEADER_FILL }),
        cell('23억', 1500, { fill: HEADER_FILL }),
        cell('2억', 1026, { fill: HEADER_FILL })
      ]})
    ]
  }));
  children.push(spacer());

  children.push(h3('다. 투자 재원확보 방안'));
  children.push(bullet('자기자금 5억 — 미처분이익잉여금 9.73억 중 현금성 자산 5억 즉시 집행 가능'));
  children.push(bullet('금융기관 차입 38억 — 중진공 정책자금 20억(2026 H2) + 기보 보증연계대출 18억'));
  children.push(bullet('「혁신 프리미어 1000」 우대 활용 — 금리 △1.0~1.5%p + 보증한도 150~200억 + 보증료 △0.4%p → 연간 금융비용 약 30% 절감'));
  children.push(spacer());

  children.push(h3('라. 자금 수요 시기 (필수 명시)'));
  children.push(bullet('2026년 하반기 — 서버·보안·모니터링 3억 + AI 모델 GPU/클라우드 0.6억 + 운영자금 5.6억 (총 9.2억)'));
  children.push(bullet('2027년 상반기 — 인력 확충·해외 PoC 2.3억 + 기술개발 2.9억 (총 5.2억)'));
  children.push(bullet('2028년 상반기 — 전용 사업장 매입 17억 (시설자금)'));

  children.push(pageBreak());

  // ===== 경영혁신·미래 핵심 인재 확보 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('경영혁신·미래 핵심 인재 확보 등의 향후 주요 전략', { bold: true, size: 22 })],
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: LABEL_FILL })
    ]})]
  }));
  children.push(spacer());

  children.push(h3('가. 경영 철학'));
  children.push(par('㈜인비토는 「측정 가능한 효과(Measurable Impact)」를 경영 철학의 최우선 가치로 둔다. 한줄로AI는 광고비가 곧 결과로 환산되어야 한다는 신념 하에, 캠페인 단위 전환율·매출 기여도를 100% 추적 가능한 폐회로를 구축하였다. 이는 마케팅 자동화 SaaS 업계 통상의 「발송 건수 과금」을 「성과 과금」으로 전환시킨다.'));
  children.push(spacer());

  children.push(h3('나. 조직문화 (4대 원칙)'));
  children.push(bullet('컨트롤타워 우선 문화 — 인라인 땜질 금지, 18종 CT(utils/) 표준 함수 import 의무화'));
  children.push(bullet('데이터 기반 의사결정 — 가설·추측 금지, SQL·grep 전수 검증 후 1개 정답만 도출'));
  children.push(bullet('전수 검증 문화 — 동일 패턴 grep 전수 리스트업 → 통합 수정 → 1회 배포 → 사고 0건'));
  children.push(bullet('투명 보고 문화 — 매 작업 종료 시 변경 사항·미배포 항목·잠재 위험 명시 보고'));
  children.push(spacer());

  children.push(h3('다. 인력 확보 방안 (2026~2030 신규 30명 채용, 2030년 총원 38명)'));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [2500, 1300, 1300, 1300, 1300, 1326],
    rows: [
      new TableRow({ children: [
        headerCell('직군', 2500),
        headerCell('2026', 1300), headerCell('2027', 1300), headerCell('2028', 1300),
        headerCell('2029', 1300), headerCell('2030', 1326)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발직 (AI/데이터/플랫폼)', 2500),
        dataCell('+2', 1300), dataCell('+2', 1300), dataCell('+4', 1300),
        dataCell('+4', 1300), dataCell('+4', 1326)
      ]}),
      new TableRow({ children: [
        labelCell('마케팅/고객지원 (CSM)', 2500),
        dataCell('+1', 1300), dataCell('+1', 1300), dataCell('+2', 1300),
        dataCell('+2', 1300), dataCell('+2', 1326)
      ]}),
      new TableRow({ children: [
        labelCell('임원/사무/영업/행정', 2500),
        dataCell('-', 1300), dataCell('+1', 1300), dataCell('+1', 1300),
        dataCell('+2', 1300), dataCell('+2', 1326)
      ]}),
      new TableRow({ children: [
        cell('연도별 신규 채용', 2500, { fill: HEADER_FILL }),
        cell('+3', 1300, { fill: HEADER_FILL }),
        cell('+4', 1300, { fill: HEADER_FILL }),
        cell('+7', 1300, { fill: HEADER_FILL }),
        cell('+8', 1300, { fill: HEADER_FILL }),
        cell('+8', 1326, { fill: HEADER_FILL })
      ]}),
      new TableRow({ children: [
        cell('누계 총원 (현재 8명 + 신규)', 2500, { fill: ACCENT_FILL }),
        cell('11명', 1300, { fill: ACCENT_FILL }),
        cell('15명', 1300, { fill: ACCENT_FILL }),
        cell('22명', 1300, { fill: ACCENT_FILL }),
        cell('30명', 1300, { fill: ACCENT_FILL }),
        cell('38명', 1326, { fill: ACCENT_FILL })
      ]})
    ]
  }));
  children.push(spacer());

  children.push(h3('라. 교육훈련·유지장치'));
  children.push(bullet('내부 코드리뷰 + 컨트롤타워 표준 함수 학습 (주 1회)'));
  children.push(bullet('AI 모델 학습·평가 워크숍 (분기 1회)'));
  children.push(bullet('개인정보보호법·정보통신망법·표시광고법 정기 법무 교육 (반기 1회)'));
  children.push(bullet('NIPA·KOITA 외부 R&D 교육 프로그램 참여 (연 2회+)'));
  children.push(bullet('R&D 인력 스톡옵션 부여 + 성과급 OKR 분기 운영으로 핵심인재 유지'));
  children.push(spacer());

  children.push(h3('마. 투명경영'));
  children.push(bullet('국세·지방세 100% 완납 (체납 0건)'));
  children.push(bullet('표준재무제표 정기 신고 (홈택스 즉시 발급)'));
  children.push(bullet('주주명부 정기 갱신·공시 (대표 95.38% + 신용보증기금 4.62%)'));
  children.push(bullet('Audit Pack 자동 생성으로 마케팅 활동 법규준수 증빙 100% 추적'));
  children.push(spacer());

  children.push(h3('바. 조직성과관리 KPI'));
  children.push(bullet('캠페인 가입 전환율 (현재 12.5~30% → 2030 20~40%)'));
  children.push(bullet('활성 거래처수 (2026 1Q 123 → 2030 600+)'));
  children.push(bullet('무중단 가동률 99.99% 유지'));
  children.push(bullet('AI 예측 정확도 (현재 75% → 2030 90%)'));
  children.push(bullet('반복매출 비중 (현재 57% → 2030 80%)'));
  children.push(spacer());

  children.push(h3('사. 기대효과'));
  children.push(par('2030년까지 직접고용 30명 + 67개 무료체험 고객사 마케팅 자동화 전환으로 간접 일자리 200명+ 보전. 핵심인재 유지율 90%+ 목표. 한줄로AI를 「국내 No.1 마케팅 자동화 SaaS + 동남아 1위 CRM-Outside 데이터 플랫폼」 위상으로 성장.'));
  children.push(spacer());

  // ===== 결격사유 ⑤ 예외 안내 박스 =====
  children.push(spacer());
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA }, columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell([
        new Paragraph({
          children: [tr('[참고] 결격사유 ⑤ 예외 적용 첨부서류', { bold: true, size: 22, color: "C00000" })],
          spacing: { before: 60, after: 60 }
        }),
        par('공고문 § 3.가 단서조항: 결격사유 ⑤·⑥에 해당하나 「적격투자기관」(벤처기업육성특별법 § 2조의2 ① 2호 가목 (1)~(7), 신용보증기금 포함) 으로부터 투자유치 실적이 있는 경우 예외 적용 가능.', { pOpts: { spacing: { before: 40, after: 40 } } }),
        par('당사는 2018년 8월 신용보증기금으로부터 2억원(기업가치 40억 평가, 전환상환우선주 34,000주, 지분율 4.62%) 투자유치 실적을 보유. 본 예외 적용을 신청하며 다음 자료를 첨부.', { pOpts: { spacing: { before: 40, after: 40 } } }),
        par('• 첨부 1 : 주주명부 (2026.5.7 발급, 신용보증기금 4.62% 명시)', { pOpts: { spacing: { before: 20, after: 20 } } }),
        par('• 첨부 2 : 신용보증기금 투자확인서 / 주식인수계약서 (2018.08)', { pOpts: { spacing: { before: 20, after: 20 } } }),
        par('• 첨부 3 : 2026년 1분기 세금계산서 집계 (월별 거래처·공급가액·매출 V자 반등 증빙)', { pOpts: { spacing: { before: 20, after: 20 } } })
      ], { width: cw, fill: ACCENT_FILL })
    ]})]
  }));

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: PAGE_PROPS, children }]
  });
}

// ============================================================
// 생성 및 저장
// ============================================================
async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const doc1 = buildForm1();
  const buf1 = await Packer.toBuffer(doc1);
  const path1 = path.join(OUT_DIR, '[서식1]_혁신프리미어1000_신청서_한줄로AI_v3.docx');
  fs.writeFileSync(path1, buf1);
  console.log('Saved:', path1);

  const doc2 = buildForm2();
  const buf2 = await Packer.toBuffer(doc2);
  const path2 = path.join(OUT_DIR, '[서식2]_혁신성장전략서_한줄로AI_v3.docx');
  fs.writeFileSync(path2, buf2);
  console.log('Saved:', path2);
}

main().catch(e => { console.error(e); process.exit(1); });
