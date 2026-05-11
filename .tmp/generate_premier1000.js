/**
 * 혁신 프리미어 1000 신청용 Word 문서 2종 생성
 * - 서식1: 신청서 (1페이지)
 * - 서식2: 혁신성장전략서 (9페이지 내외)
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel,
  PageBreak, VerticalAlign, PageOrientation, LevelFormat
} = require('docx');

const OUT_DIR = 'C:\\Users\\ceo\\OneDrive\\바탕 화면\\혁신프리미어1000';

// ========== 공통 설정 ==========
const FONT = '맑은 고딕';
const FONT_BOLD = '맑은 고딕';

// A4 (DXA): 11906 x 16838, 1인치 여백 → 콘텐츠 폭 9026
const CONTENT_WIDTH = 9026;

// 보더
const border = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const allBorders = { top: border, bottom: border, left: border, right: border };

// 배경색
const HEADER_FILL = "DEEAF6";    // 연한 파랑
const LABEL_FILL = "F2F2F2";     // 연한 회색
const ACCENT_FILL = "FFF2CC";    // 강조 노랑

// ========== Helper 함수 ==========
function tr(text, opts = {}) {
  return new TextRun({
    text: text || '',
    font: FONT,
    size: opts.size || 20,
    bold: opts.bold || false,
    color: opts.color || "000000",
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

// ========== 페이지 설정 ==========
const PAGE_PROPS = {
  page: {
    size: { width: 11906, height: 16838 },  // A4
    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
  }
};

// ============================================================
// 서식 1: 혁신 프리미어 1000 신청서
// ============================================================
function buildForm1() {
  const cw = CONTENT_WIDTH;
  const W1 = 1800, W2 = 2700, W3 = 1800, W4 = 2726;

  const children = [
    // 제목
    new Paragraph({
      children: [tr('[서식 1]', { size: 20 })],
      spacing: { before: 0, after: 100 }
    }),
    h1('혁신 프리미어 1000 신청서'),
    spacer(),

    // 메인 정보 표
    new Table({
      width: { size: cw, type: WidthType.DXA },
      columnWidths: [W1, W2, W3, W4],
      rows: [
        // 1행: 업체명, 사업자번호
        new TableRow({ children: [
          labelCell('업체명', W1),
          dataCell('주식회사 인비토', W2, { align: AlignmentType.LEFT }),
          labelCell('사업자번호\n(법인등록번호)', W3),
          dataCell('667-86-00578\n(110111-6638542)', W4, { align: AlignmentType.LEFT })
        ]}),
        // 2행: 법인설립일, 기업구분
        new TableRow({ children: [
          labelCell('법인설립일', W1),
          dataCell('2017.01.03', W2, { align: AlignmentType.LEFT }),
          labelCell('기업구분', W3),
          dataCell('☑ 중소기업    □ 중견기업', W4, { align: AlignmentType.LEFT })
        ]}),
        // 3행: 대표자, 한국표준산업분류
        new TableRow({ children: [
          labelCell('대표자', W1),
          dataCell('유호윤', W2, { align: AlignmentType.LEFT }),
          labelCell('한국표준산업분류 코드', W3),
          dataCell('J62010\n(컴퓨터 프로그래밍 서비스업)', W4, { align: AlignmentType.LEFT })
        ]}),
        // 4행: 주요 제품 또는 서비스 (전체 행)
        new TableRow({ children: [
          labelCell('주요 제품 또는 서비스\n(매출비중)', W1),
          cell([
            par('1. 한줄로AI - SMS/LMS/MMS 마케팅 자동화 SaaS (80%)', { pOpts: { spacing: { before: 20, after: 20 } } }),
            par('2. 한줄로AI - 알림톡/카카오 브랜드메시지 (20%)', { pOpts: { spacing: { before: 20, after: 20 } } }),
            par('3. POPPON - 동의 기반 CRM-Outside 타겟 데이터 (2026 H2 상용화 예정)', { pOpts: { spacing: { before: 20, after: 20 } } })
          ], { width: W2 + W3 + W4, span: 3 })
        ]}),
        // 5행: 혁신성장 공동기준
        new TableRow({ children: [
          labelCell('혁신성장 공동기준\n영위 여부', W1),
          cell([
            par([tr('• 코드번호: ', { size: 20 }), tr('I30003', { bold: true, size: 20 })]),
            par([tr('• 테마: 융합지식서비스 (I)   ', { size: 20 }), tr('• 분야: 지식서비스 (I30)', { size: 20 })]),
            par([tr('• 품목: ', { size: 20 }), tr('애드테크 (I30003)', { bold: true, size: 20 })]),
            par('  → AI·빅데이터·프로그래매틱 광고 기술 활용 디지털·모바일·크로스 채널 광고기획·실시·분석', { pOpts: { spacing: { before: 20, after: 20 } } })
          ], { width: W2 + W3 + W4, span: 3 })
        ]}),
        // 6행: 5대 중점전략분야
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
        // 7행: 금융수요
        new TableRow({ children: [
          labelCell('금융 수요\n(중복체크가능)', W1),
          cell('☑ 대출    □ 투자    ☑ 보증', W2, { align: AlignmentType.LEFT }),
          labelCell('자금 수요 시기', W3),
          cell([
            par('• 2026년 하반기 (POPPON 데이터 랩·AI 모델 고도화)'),
            par('• 2027년 상반기 (인력 확충·해외 시범 진출)')
          ], { width: W4 })
        ]}),
        // 8행: 정부지원사업 참여이력
        new TableRow({ children: [
          labelCell('정부지원사업\n참여이력', W1),
          cell([
            par('• (산업통상부) 기업활력법 사업재편계획 신청 (2026.01, 신산업 진출 분야)'),
            par('• 신용보증기금 투자유치 (2018.08, 2억원, 적격투자기관 출자 — 우선주 4.62% 지분)')
          ], { width: W2 + W3 + W4, span: 3 })
        ]}),
        // 9행: 담당자
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

    // 확인 문구
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
    par('* 법인인감 날인 후 스캔하여 송부', { pOpts: { spacing: { before: 200 } } })
  ];

  return new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 20 } } }
    },
    sections: [{ properties: PAGE_PROPS, children }]
  });
}

// ============================================================
// 서식 2: 혁신성장전략서
// ============================================================
function buildForm2() {
  const cw = CONTENT_WIDTH;

  const children = [];

  // ===== 표지 =====
  children.push(new Paragraph({
    children: [tr('[서식 2]', { size: 20 })],
    spacing: { before: 0, after: 100 }
  }));
  children.push(h1('[공모트랙 제출] 혁신성장전략서'));
  children.push(spacer());

  // ===== 현황 섹션 헤더 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('현    황', { bold: true, size: 24 })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: HEADER_FILL })
    ]})]
  }));
  children.push(spacer());

  // ===== 1) 기업개요 =====
  children.push(h2('1) 기업개요'));

  // 기업명·규모
  children.push(par([tr('□ 기업명 : ', { bold: true }), tr('주식회사 인비토 (한줄로AI / TargetUP / POPPON 운영)')]));
  children.push(spacer());

  children.push(par([tr('□ 기업규모', { bold: true }), tr('                                                          (단위 : 억원, 명)', { size: 18 })]));

  // 기업규모 표
  const W_LABEL = 2226, W_YR = 1500, W_CAGR = 1500;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, W_YR, W_YR, W_YR, W_CAGR],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL),
        headerCell('2023년', W_YR),
        headerCell('2024년', W_YR),
        headerCell('2025년', W_YR),
        headerCell('증가율(CAGR)', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('매출액', W_LABEL),
        dataCell('170.72', W_YR),
        dataCell('208.87', W_YR),
        dataCell('128.26', W_YR),
        dataCell('△13.4%', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('수출액', W_LABEL),
        dataCell('-', W_YR),
        dataCell('-', W_YR),
        dataCell('-', W_YR),
        dataCell('-', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('총자산', W_LABEL),
        dataCell('37.85', W_YR),
        dataCell('39.48', W_YR),
        dataCell('48.35', W_YR),
        dataCell('+13.0%', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('자본금', W_LABEL),
        dataCell('1.08', W_YR),
        dataCell('1.08', W_YR),
        dataCell('3.68', W_YR),
        dataCell('+84.6%', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('상시 종업원 수', W_LABEL),
        dataCell('7', W_YR),
        dataCell('8', W_YR),
        dataCell('8', W_YR),
        dataCell('+6.9%', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('매출 대비 수출비율(%)', W_LABEL),
        dataCell('0%', W_YR),
        dataCell('0%', W_YR),
        dataCell('0%', W_YR),
        dataCell('-', W_CAGR)
      ]})
    ]
  }));
  children.push(spacer());

  // 주요 보유 기술·제품 서비스 개요
  children.push(par([tr('□ 주요 보유 기술, 제품 서비스 개요', { bold: true })]));
  children.push(par('주식회사 인비토는 2017년 설립된 AI·디지털 마케팅 자동화 SaaS 전문기업으로, 2026년 5월 5일 정식 오픈한 「한줄로AI」 서비스를 운영 중이다. 한줄로AI는 SMS/LMS/MMS/알림톡/카카오 브랜드메시지/RCS 등 6대 채널 발송 자동화에 30억 건 발송로그 학습 기반 TargetUP-AI 예측·추천 엔진과 동의 기반 CRM-Outside DB(POPPON) 12,500명·204개 제휴 브랜드 자산을 결합한 통합 마케팅 인텔리전스 플랫폼이다. 등록 특허 3건과 출원 중 3건, 자체 컨트롤타워 18종(CT-01~CT-18) 기반의 24/7 무중단 운영 인프라(atomic safe-build·monitor-dist·12개 라인그룹 분산)를 통해 캠페인 가입 전환율 12.5~30%를 검증하였다.'));
  children.push(spacer());

  // 혁신성장 공동기준
  children.push(par([tr('□ 「혁신성장 공동기준」 영위 여부', { bold: true })]));
  children.push(par([
    tr('• 테마 : ', { size: 20 }), tr('융합지식서비스(I)', { bold: true }),
    tr('     • 분야 : ', { size: 20 }), tr('지식서비스(I30)', { bold: true }),
    tr('     • 품목 : ', { size: 20 }), tr('애드테크(I30003)', { bold: true })
  ]));
  children.push(par('  → AI·빅데이터·프로그래매틱 광고 기술을 활용한 디지털·모바일·크로스 채널 광고기획·실시·분석 산업 정의에 정확히 부합'));
  children.push(spacer());

  // 주요 연혁
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

  // 연구개발 투자
  children.push(par([tr('□ 연구개발 투자 현황', { bold: true }), tr('                                                          (단위 : 억원, %)', { size: 18 })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, W_YR, W_YR, W_YR, W_CAGR],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL),
        headerCell('2023년', W_YR),
        headerCell('2024년', W_YR),
        headerCell('2025년', W_YR),
        headerCell('평균', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('매출액(A)', W_LABEL),
        dataCell('170.72', W_YR),
        dataCell('208.87', W_YR),
        dataCell('128.26', W_YR),
        dataCell('169.28', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발투자액(B)', W_LABEL),
        dataCell('0.59', W_YR),
        dataCell('0.71', W_YR),
        dataCell('0.64', W_YR),
        dataCell('0.65', W_CAGR)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발투자비율(B/A)', W_LABEL),
        dataCell('0.34%', W_YR),
        dataCell('0.34%', W_YR),
        dataCell('0.50%', W_YR),
        dataCell('0.39%', W_CAGR)
      ]})
    ]
  }));
  children.push(par('※ 연구개발투자액은 손익계산서상 경상개발비(개발담당자 인건비 포함) 기준. 매출원가의 90%가 통신사 메시지 도매 매입비용(2025년 116억)임을 감안하면 실질 마진(매출-원가) 대비 R&D 투자 비중은 약 5% 수준.', { size: 18, pOpts: { spacing: { before: 80, after: 120 } } }));

  // 연구인력
  children.push(par([tr('□ 연구인력 현황', { bold: true })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, W_YR + 500, W_YR + 500, W_YR + 500],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL),
        headerCell('2023년', W_YR + 500),
        headerCell('2024년', W_YR + 500),
        headerCell('2025년', W_YR + 500)
      ]}),
      new TableRow({ children: [
        labelCell('상시 근로자수(A)', W_LABEL),
        dataCell('4', W_YR + 500),
        dataCell('5', W_YR + 500),
        dataCell('5', W_YR + 500)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발인력(B)', W_LABEL),
        dataCell('3', W_YR + 500),
        dataCell('3', W_YR + 500),
        dataCell('3', W_YR + 500)
      ]}),
      new TableRow({ children: [
        labelCell('상시 종업원수(A+B)', W_LABEL),
        dataCell('7', W_YR + 500),
        dataCell('8', W_YR + 500),
        dataCell('8', W_YR + 500)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발인력비중(B/(A+B))', W_LABEL),
        dataCell('42.9%', W_YR + 500),
        dataCell('37.5%', W_YR + 500),
        dataCell('37.5%', W_YR + 500)
      ]})
    ]
  }));
  children.push(par('※ 연구개발인력은 모두 연구개발전담부서 소속 정규직 연구전담요원. 전체 인력의 37.5%가 R&D 인력으로, 동종 SaaS 업계 평균(20~25%) 대비 1.5배 수준.', { size: 18, pOpts: { spacing: { before: 80, after: 120 } } }));
  children.push(spacer());

  // 특허
  children.push(par([tr('□ 특허보유건수(등록기준) : 총 3건 (출원 중 3건 별도)', { bold: true })]));
  children.push(par([tr('1) 등록 특허', { bold: true })]));
  children.push(dash('특허 10-1821985 「타겟 고객 추출 및 메시지 발송」 — TargetUP 세그먼트 추출 엔진 핵심'));
  children.push(dash('특허 10-1990872 「통합 메시징 시스템」 — SMS/LMS/MMS/알림톡 멀티채널 발송 자동화'));
  children.push(dash('특허 10-2325851 「POPPON 필터링 시스템」 — 동의 기반 데이터 수집·정제 자동화'));
  children.push(par([tr('2) 상표 및 출원 중 특허', { bold: true })]));
  children.push(dash('상표 등록 : POPPON (B2C 쿠폰 플랫폼 브랜드)'));
  children.push(dash('출원 중 특허 3건 : 한줄로AI 관련 TargetUP-AI 예측·추천 알고리즘, Audit Pack 준법 증빙 자동생성, 자동발송 광고+080 정합화 기술'));
  children.push(spacer());

  // 연구개발전담부서
  children.push(par([tr('□ 연구개발전담부서 보유현황', { bold: true })]));
  children.push(par('2017년 1월 ㈜인비토 설립 시점 등록 후 현재까지 유효 운영 중. 한국산업기술진흥협회(KOITA) 등록 「인비토 연구개발전담부서」로서 AI·빅데이터·마케팅 자동화 분야 전담 연구를 수행하고 있으며, 본 부서 소속 연구전담요원 3명이 한줄로AI의 핵심 엔진(TargetUP-AI, POPPON 필터링, 18종 컨트롤타워)을 자체 개발·운영하고 있다.'));
  children.push(spacer());

  // 보유 기술의 우수성
  children.push(par([tr('□ 보유 기술의 우수성', { bold: true })]));
  children.push(par('한줄로AI는 「동의 기반 CRM-Outside DB + AI 예측·추천 + 준법 자동화」 3중 결합으로 기존 메시징 중계업 대비 독창적 차별성을 확보한다.'));
  children.push(bullet('독창성 : 자사 플랫폼(POPPON)에서 실명·수신동의 기반 외부고객 데이터를 직접 축적(현재 12,500명, 204개 제휴 브랜드)하여 「기업 보유 DB로만 발송 가능」한 기존 메시징 SaaS의 구조적 한계를 돌파.'));
  children.push(bullet('우수성 : 30억 건 실 발송 로그를 학습 데이터로 활용한 TargetUP-AI 예측·추천 엔진은 캠페인 반응률·전환율을 자가 개선하는 폐회로(발송→결과→재학습)를 구축. 캠페인 가입 전환율 12.5~30% 검증.'));
  children.push(bullet('개발 인력 이력 : 대표이사 유호윤(2017년 창업 이래 9년 연속 SMS/LMS/MMS 발송 SaaS 운영, 30억 건 발송 데이터 축적 경험) + 연구전담요원 3명(AI/데이터 분석·플랫폼 개발 전문)이 직접 설계·구현.'));
  children.push(bullet('참여 경력 : 2018년 신용보증기금 적격투자기관 출자(기업가치 40억 평가), 2018년 창업경진대회 최우수상, 2026년 1월 산업통상부 기업활력법 사업재편계획 신청(신산업 진출 분야).'));

  children.push(pageBreak());

  // ===== 3) 제품·서비스 =====
  children.push(h2('3) 제품, 서비스'));

  children.push(par([tr('□ 제품·서비스 개요', { bold: true })]));
  children.push(par('「한줄로AI」는 2026년 5월 5일 정식 오픈한 통합 마케팅 자동화 SaaS로, 다음 3대 모듈로 구성된다.'));
  children.push(spacer());

  // 3대 모듈 표
  const M_LABEL = 1800;
  const M_DESC = cw - M_LABEL;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [M_LABEL, M_DESC],
    rows: [
      new TableRow({ children: [
        headerCell('모듈', M_LABEL),
        headerCell('기능 및 시장성', M_DESC)
      ]}),
      new TableRow({ children: [
        labelCell('TargetUP', M_LABEL),
        cell([
          par('SMS/LMS/MMS/알림톡/카카오 브랜드메시지/RCS 6대 채널 발송 자동화 SaaS. 18종 컨트롤타워(CT-01~CT-18) 기반 24/7 무중단 운영.', { pOpts: { spacing: { before: 30, after: 30 } } }),
          par('• 캠페인 단위 발송·예약·집계·환불 자동화 (성공-과금/실패-환불 idempotent 패턴)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 12개 라인그룹 분산 인프라로 트래픽 분산 및 장애 격리', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 실시간 거래처 123개사 결제, 월평균 발송 4,560만원 (2026 1Q 기준)', { pOpts: { spacing: { before: 20, after: 20 } } })
        ], { width: M_DESC, align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('POPPON', M_LABEL),
        cell([
          par('B2C 쿠폰 플랫폼. 실명·수신동의 기반 고객행동 데이터 수집·정제·저장.', { pOpts: { spacing: { before: 30, after: 30 } } }),
          par('• 제휴 브랜드 204개, 가입자 12,500명 (동의 기반)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 개인정보 비식별화 처리 + Audit Pack 100% 추적 가능', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 2026 H2 「CRM-Outside 타겟 데이터」 상품화 (B2B 데이터 이용료 모델)', { pOpts: { spacing: { before: 20, after: 20 } } })
        ], { width: M_DESC, align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('TargetUP-AI', M_LABEL),
        cell([
          par('AI 기반 마케팅 예측·추천 엔진. 30억 건 발송 로그 학습.', { pOpts: { spacing: { before: 30, after: 30 } } }),
          par('• 고객 세그먼트별 반응률·전환율 예측', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 최적 발송시점·문안 추천 (LLM 기반 메시지 생성)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 캠페인 결과 데이터로 모델 재학습 (폐회로 자동개선)', { pOpts: { spacing: { before: 20, after: 20 } } }),
          par('• 검증된 캠페인 가입 전환율 12.5~30%', { pOpts: { spacing: { before: 20, after: 20 } } })
        ], { width: M_DESC, align: AlignmentType.LEFT })
      ]})
    ]
  }));
  children.push(spacer());

  // 도식
  children.push(par([tr('□ 구현 방식 (데이터 폐회로 구조)', { bold: true })]));
  children.push(par('[POPPON 동의 데이터 수집] → [TargetUP-AI 세그먼트·문안 예측] → [TargetUP 6채널 발송] → [발송 결과 30억 건 로그] → [AI 모델 재학습] → 다시 [예측 정교화]'));
  children.push(par('이 폐회로 구조는 한줄로AI를 단순 「메시지 중계 SaaS」가 아닌 「자가 진화하는 마케팅 인텔리전스 플랫폼」으로 차별화한다. 경쟁사가 모방하려면 동의 기반 외부 DB(POPPON), 30억 건 발송 로그, 18종 운영 컨트롤타워를 처음부터 다시 축적해야 하므로 진입장벽이 높다.'));
  children.push(spacer());

  // 주요 판매처
  children.push(par([tr('□ 주요 판매처, 매출·수출 실적', { bold: true })]));
  children.push(bullet('주요 판매처 : 폴라초이스, 트렉스타, 캐럿, bhappy4, 시세이도, 한국시세이도 등 중견 브랜드 + B2B 마케팅 자동화 수요 중소기업 다수'));
  children.push(bullet('2026년 1분기 실 결제 거래처 123개사 (월평균 111개사, 발송 매수 412건 합계)'));
  children.push(bullet('2026년 1분기 매출 공급가액 41.46억원 (총매출 45.61억원, VAT 포함)'));
  children.push(bullet('연간 환산 시 165~182억원 — 2025년 128.26억 대비 +29~42% V자 반등'));
  children.push(bullet('수출 실적 : 현재 0원 (2030년 베트남 시범 진출 로드맵 보유)'));
  children.push(spacer());

  // 관련 시장의 성장성
  children.push(par([tr('□ 관련 시장의 성장성, 파급 효과', { bold: true })]));
  children.push(par('1) 국내 기업 메시징 시장 : 카카오톡 알림톡·브랜드메시지 시장 포함 연 1.5조원 규모, 카카오 RCS·BMS 전환 확산에 따라 연 8~12% 성장.'));
  children.push(par('2) 애드테크(I30003) 시장 : 글로벌 1,000조원 규모, 국내 약 14조원. AI·프로그래매틱 광고 기술 성장률 연 15%↑.'));
  children.push(par('3) CRM-Outside 데이터 신시장 : 한줄로AI가 정의·창출하는 신규 카테고리. 「브랜드 미보유 신규고객 동의 기반 타겟 세그먼트 제공」 모델은 국내 경쟁 부재. 2030년까지 약 3,000억원 규모 형성 전망.'));
  children.push(par('4) 일자리 창출 효과 : 한줄로AI 정식 오픈 후 2030년까지 자체 고용 22명 신규 창출 + 67개 무료체험 기업 마케팅 자동화 전환 효과로 간접 일자리 보전 효과 추정 200명+.'));

  children.push(pageBreak());

  // ===== 4) 재무현황 =====
  children.push(h2('4) 재무현황'));

  // 매출구성
  children.push(par([tr('□ 매출구성', { bold: true }), tr('                                                          (단위 : 억원)', { size: 18 })]));
  const W_FIN1 = 1700, W_FIN2 = 1100;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_FIN1, W_FIN1, 1226, W_FIN2, W_FIN2, W_FIN2],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_FIN1, ),
        headerCell('항 목', W_FIN1, ),
        headerCell('', 1226, ),
        headerCell('2023년', W_FIN2),
        headerCell('2024년', W_FIN2),
        headerCell('2025년', W_FIN2)
      ]}),
      new TableRow({ children: [
        cell('매출액(A)', W_FIN1, { fill: LABEL_FILL, span: 3 }),
        cell('', W_FIN1, { fill: LABEL_FILL }),
        cell('', 1226, { fill: LABEL_FILL }),
        dataCell('170.72', W_FIN2),
        dataCell('208.87', W_FIN2),
        dataCell('128.26', W_FIN2)
      ]}),
      new TableRow({ children: [
        labelCell('내 수', W_FIN1),
        cell('', W_FIN1 + 1226, { fill: LABEL_FILL, span: 2 }),
        dataCell('170.72', W_FIN2),
        dataCell('208.87', W_FIN2),
        dataCell('128.26', W_FIN2)
      ]}),
      new TableRow({ children: [
        labelCell('수출', W_FIN1),
        labelCell('직수출(B)', W_FIN1),
        labelCell('', 1226),
        dataCell('0.00', W_FIN2),
        dataCell('0.00', W_FIN2),
        dataCell('0.00', W_FIN2)
      ]}),
      new TableRow({ children: [
        labelCell('', W_FIN1),
        labelCell('기 타', W_FIN1),
        labelCell('', 1226),
        dataCell('0.00', W_FIN2),
        dataCell('0.00', W_FIN2),
        dataCell('0.00', W_FIN2)
      ]}),
      new TableRow({ children: [
        cell('직수출 비중(B/A)', W_FIN1, { fill: LABEL_FILL, span: 3 }),
        cell('', W_FIN1, { fill: LABEL_FILL }),
        cell('', 1226, { fill: LABEL_FILL }),
        dataCell('0%', W_FIN2),
        dataCell('0%', W_FIN2),
        dataCell('0%', W_FIN2)
      ]})
    ]
  }));
  children.push(par('※ 최근 3년간(2023~2025) 직수출 증가율 : 0% (2030년 베트남 시범 진출 예정)', { size: 18, pOpts: { spacing: { before: 60, after: 120 } } }));

  // 신용평가
  children.push(par([tr('□ 신용평가등급', { bold: true })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, (cw - W_LABEL) / 3, (cw - W_LABEL) / 3, (cw - W_LABEL) / 3],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL),
        headerCell('2023년', (cw - W_LABEL) / 3),
        headerCell('2024년', (cw - W_LABEL) / 3),
        headerCell('2025년', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('신용등급', W_LABEL),
        dataCell('미평가', (cw - W_LABEL) / 3),
        dataCell('미평가', (cw - W_LABEL) / 3),
        dataCell('B+', (cw - W_LABEL) / 3)
      ]})
    ]
  }));
  children.push(par('* 신용평가기관 : NICE평가정보 (유효기간 2025.12.31, B+)', { size: 18, pOpts: { spacing: { before: 60, after: 120 } } }));

  // 영업이익률
  children.push(par([tr('□ 영업이익률', { bold: true }), tr('                                                          (단위 : 억원)', { size: 18 })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, (cw - W_LABEL) / 3, (cw - W_LABEL) / 3, (cw - W_LABEL) / 3],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL),
        headerCell('2023년', (cw - W_LABEL) / 3),
        headerCell('2024년', (cw - W_LABEL) / 3),
        headerCell('2025년', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('매출액(A)', W_LABEL),
        dataCell('170.72', (cw - W_LABEL) / 3),
        dataCell('208.87', (cw - W_LABEL) / 3),
        dataCell('128.26', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('영업이익(B)', W_LABEL),
        dataCell('4.17', (cw - W_LABEL) / 3),
        dataCell('3.63', (cw - W_LABEL) / 3),
        dataCell('1.45', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('영업이익률(B/A)', W_LABEL),
        dataCell('2.44%', (cw - W_LABEL) / 3),
        dataCell('1.74%', (cw - W_LABEL) / 3),
        dataCell('1.13%', (cw - W_LABEL) / 3)
      ]})
    ]
  }));
  children.push(spacer());

  // 이자보상배율
  children.push(par([tr('□ 이자보상배율', { bold: true }), tr('                                                          (단위 : 억원)', { size: 18 })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, (cw - W_LABEL) / 3, (cw - W_LABEL) / 3, (cw - W_LABEL) / 3],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL),
        headerCell('2023년', (cw - W_LABEL) / 3),
        headerCell('2024년', (cw - W_LABEL) / 3),
        headerCell('2025년', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('영업이익(A)', W_LABEL),
        dataCell('4.17', (cw - W_LABEL) / 3),
        dataCell('3.63', (cw - W_LABEL) / 3),
        dataCell('1.45', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('금융비용(B)', W_LABEL),
        dataCell('0.77', (cw - W_LABEL) / 3),
        dataCell('0.95', (cw - W_LABEL) / 3),
        dataCell('1.30', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('이자보상배율(A/B)', W_LABEL),
        dataCell('5.44배', (cw - W_LABEL) / 3),
        dataCell('3.82배', (cw - W_LABEL) / 3),
        dataCell('1.12배', (cw - W_LABEL) / 3)
      ]})
    ]
  }));
  children.push(par('※ 3년 연속 이자보상배율 100%(1.0배) 이상 유지 — 결격사유 ⑥ 통과', { size: 18, pOpts: { spacing: { before: 60, after: 120 } } }));

  // 부채비율
  children.push(par([tr('□ 부채비율', { bold: true }), tr('                                                          (단위 : 억원, %)', { size: 18 })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, (cw - W_LABEL) / 3, (cw - W_LABEL) / 3, (cw - W_LABEL) / 3],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL),
        headerCell('2023년', (cw - W_LABEL) / 3),
        headerCell('2024년', (cw - W_LABEL) / 3),
        headerCell('2025년', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('부채(A)', W_LABEL),
        dataCell('25.06', (cw - W_LABEL) / 3),
        dataCell('25.18', (cw - W_LABEL) / 3),
        dataCell('34.04', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('자기자본(B)', W_LABEL),
        dataCell('12.79', (cw - W_LABEL) / 3),
        dataCell('14.30', (cw - W_LABEL) / 3),
        dataCell('14.31', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('부채비율(A/B)', W_LABEL),
        dataCell('196.0%', (cw - W_LABEL) / 3),
        dataCell('176.1%', (cw - W_LABEL) / 3),
        dataCell('238.0%', (cw - W_LABEL) / 3)
      ]})
    ]
  }));
  children.push(spacer());

  // 유동비율
  children.push(par([tr('□ 유동비율', { bold: true }), tr('                                                          (단위 : 억원, %)', { size: 18 })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, (cw - W_LABEL) / 3, (cw - W_LABEL) / 3, (cw - W_LABEL) / 3],
    rows: [
      new TableRow({ children: [
        headerCell('연 도', W_LABEL),
        headerCell('2023년', (cw - W_LABEL) / 3),
        headerCell('2024년', (cw - W_LABEL) / 3),
        headerCell('2025년', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('유동부채(A)', W_LABEL),
        dataCell('25.06', (cw - W_LABEL) / 3),
        dataCell('25.18', (cw - W_LABEL) / 3),
        dataCell('11.27', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('유동자산(B)', W_LABEL),
        dataCell('34.69', (cw - W_LABEL) / 3),
        dataCell('36.88', (cw - W_LABEL) / 3),
        dataCell('46.39', (cw - W_LABEL) / 3)
      ]}),
      new TableRow({ children: [
        labelCell('유동비율(B/A)', W_LABEL),
        dataCell('138.4%', (cw - W_LABEL) / 3),
        dataCell('146.5%', (cw - W_LABEL) / 3),
        dataCell('411.5%', (cw - W_LABEL) / 3)
      ]})
    ]
  }));
  children.push(par('※ 2025년 유동비율 411.5% — 단기 지급능력 매우 우수.', { size: 18, pOpts: { spacing: { before: 60, after: 120 } } }));

  // 2026 1Q 보충 박스
  children.push(par([tr('□ 2026년 1분기 V자 반등 실적 (참고)', { bold: true, color: "C00000" })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [W_LABEL, (cw - W_LABEL) / 4, (cw - W_LABEL) / 4, (cw - W_LABEL) / 4, (cw - W_LABEL) / 4],
    rows: [
      new TableRow({ children: [
        headerCell('항 목', W_LABEL),
        headerCell('2026.01', (cw - W_LABEL) / 4),
        headerCell('2026.02', (cw - W_LABEL) / 4),
        headerCell('2026.03', (cw - W_LABEL) / 4),
        headerCell('1Q 합계', (cw - W_LABEL) / 4)
      ]}),
      new TableRow({ children: [
        labelCell('거래처수(unique)', W_LABEL),
        dataCell('111', (cw - W_LABEL) / 4),
        dataCell('113', (cw - W_LABEL) / 4),
        dataCell('109', (cw - W_LABEL) / 4),
        dataCell('123', (cw - W_LABEL) / 4)
      ]}),
      new TableRow({ children: [
        labelCell('매출 공급가액(억)', W_LABEL),
        dataCell('13.97', (cw - W_LABEL) / 4),
        dataCell('13.33', (cw - W_LABEL) / 4),
        dataCell('14.16', (cw - W_LABEL) / 4),
        dataCell('41.46', (cw - W_LABEL) / 4)
      ]}),
      new TableRow({ children: [
        labelCell('총매출(VAT 포함, 억)', W_LABEL),
        dataCell('15.37', (cw - W_LABEL) / 4),
        dataCell('14.67', (cw - W_LABEL) / 4),
        dataCell('15.57', (cw - W_LABEL) / 4),
        dataCell('45.61', (cw - W_LABEL) / 4)
      ]})
    ]
  }));
  children.push(par('※ 2025년 매출 일시 조정(△38.6%)은 사업재편 진행에 따른 저마진 메시지 중계 사업의 의도적 축소 결과이며, 2026년 5월 5일 「한줄로AI」 정식 오픈 본격화에 따라 1분기 매출 41.46억(연간 환산 165~182억) 으로 +29~42% V자 반등.', { size: 18, pOpts: { spacing: { before: 80, after: 80 } } }));
  children.push(par('※ 결격사유 ⑤ 매출감소 △10% 적용 시에도 신용보증기금(적격투자기관) 출자 보유로 단서조항에 따른 예외 적용 — 첨부 : 주주명부, 신용보증기금 투자확인서.', { size: 18, pOpts: { spacing: { before: 60, after: 80 } } }));

  children.push(pageBreak());

  // ===== 향후 계획 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('향후 계획', { bold: true, size: 24 })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: HEADER_FILL })
    ]})]
  }));
  children.push(spacer());

  // 비전 / 최종 목표
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [1800, cw - 1800],
    rows: [
      new TableRow({ children: [
        cell('비 전', 1800, { fill: ACCENT_FILL, align: AlignmentType.CENTER }),
        cell('「메시지 중계」 에서 「동의 기반 CRM-Outside 타겟 데이터 + AI 마케팅 인텔리전스」 로의 사업 구조 전환을 완성하고, 2030년까지 국내 마케팅 자동화 SaaS 시장 점유율 5% 달성 + 동남아 1위 진출 (베트남 거점)', cw - 1800, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        cell('최종 목표', 1800, { fill: ACCENT_FILL, align: AlignmentType.CENTER }),
        cell('2030년 매출 700억원, 영업이익률 22%, 신규매출(CRM-Outside + AI 구독) 비중 80%, 직접고용 30명 + 간접 일자리 200명+', cw - 1800, { align: AlignmentType.LEFT })
      ]})
    ]
  }));
  children.push(spacer());

  // 연도별 목표치 표
  children.push(par([tr('□ 연도별 목표치', { bold: true })]));
  const yrW = (cw - 1800 - 1000) / 5;
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [1000, 1800, yrW, yrW, yrW, yrW, yrW],
    rows: [
      new TableRow({ children: [
        cell('연도별 목표치', 1000 + 1800, { fill: HEADER_FILL, span: 2, align: AlignmentType.CENTER }),
        cell('', 1800, { fill: HEADER_FILL }),
        headerCell('2026', yrW),
        headerCell('2027', yrW),
        headerCell('2028', yrW),
        headerCell('2029', yrW),
        headerCell('2030', yrW)
      ]}),
      new TableRow({ children: [
        cell('총 매출액 (억원)', 1000 + 1800, { fill: LABEL_FILL, span: 2 }),
        cell('', 1800, { fill: LABEL_FILL }),
        dataCell('165~180', yrW),
        dataCell('320', yrW),
        dataCell('445', yrW),
        dataCell('580', yrW),
        dataCell('700', yrW)
      ]}),
      new TableRow({ children: [
        labelCell('제품 mix', 1000),
        labelCell('TargetUP (메시징)', 1800),
        dataCell('145', yrW),
        dataCell('190', yrW),
        dataCell('180', yrW),
        dataCell('160', yrW),
        dataCell('140', yrW)
      ]}),
      new TableRow({ children: [
        labelCell('', 1000),
        labelCell('TargetUP-AI 구독', 1800),
        dataCell('20', yrW),
        dataCell('100', yrW),
        dataCell('200', yrW),
        dataCell('330', yrW),
        dataCell('420', yrW)
      ]}),
      new TableRow({ children: [
        labelCell('', 1000),
        labelCell('POPPON CRM-Outside', 1800),
        dataCell('10', yrW),
        dataCell('30', yrW),
        dataCell('65', yrW),
        dataCell('90', yrW),
        dataCell('140', yrW)
      ]}),
      new TableRow({ children: [
        labelCell('수출', 1000),
        labelCell('직수출액', 1800),
        dataCell('0', yrW),
        dataCell('0', yrW),
        dataCell('5', yrW),
        dataCell('20', yrW),
        dataCell('50', yrW)
      ]}),
      new TableRow({ children: [
        labelCell('', 1000),
        labelCell('기타', 1800),
        dataCell('0', yrW),
        dataCell('0', yrW),
        dataCell('0', yrW),
        dataCell('0', yrW),
        dataCell('0', yrW)
      ]}),
      new TableRow({ children: [
        cell('인력 확보 (누계 명)', 1000 + 1800, { fill: LABEL_FILL, span: 2 }),
        cell('', 1800, { fill: LABEL_FILL }),
        dataCell('11', yrW),
        dataCell('15', yrW),
        dataCell('22', yrW),
        dataCell('30', yrW),
        dataCell('38', yrW)
      ]})
    ]
  }));

  children.push(pageBreak());

  // ===== 연구개발 추진 전략 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('혁신성장전략서', { bold: true, size: 22 })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: HEADER_FILL })
    ]})]
  }));
  children.push(spacer());

  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('기술확보 현황 및 향후 주요전략 — 1) 연구 개발 추진 전략', { bold: true, size: 22 })],
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: LABEL_FILL })
    ]})]
  }));
  children.push(spacer());

  children.push(h3('가. 기술 개발 인프라 확충'));
  children.push(par('한줄로AI는 이미 정식 오픈된 상용 SaaS이며, 다음 3중 인프라를 통해 24/7 무중단 운영 중이다. 향후 본 인프라를 데이터 랩(2028년 지식산업센터 매입) + AI 모델 학습 GPU 클러스터(2026 H2)로 확장한다.'));
  children.push(bullet('atomic safe-build 인프라 : 3패키지(backend·frontend·sync-agent) safe-build.sh + build:safe 스크립트로 dist-new → 검증 → atomic swap 4단계 배포. 빌드 실패 시 옛 dist 유지(차단 0초 보장).'));
  children.push(bullet('monitor-dist.sh 자동 복구 인프라 : 1분 cron으로 dist 부재 자동 감지 + 재빌드 + SMS 사고알림(localhost API → SMSQ_SEND_10 사전테스트 라인 → 010-5295-8517 LMS).'));
  children.push(bullet('12개 라인그룹 분산 발송 인프라 : MySQL LIVE 12 + LOG 55 인덱스 67개, 매월 자동 인덱스(auto_create_sms_log_tables LIKE 복제) 정합. type=ALL→ref 1행 covering 최적화.'));
  children.push(bullet('18종 컨트롤타워(CT-01~CT-18) : utils/ 디렉토리에 정합·재사용 가능한 핵심 헬퍼 함수 18종을 표준화. 라우트·프론트엔드 전수 import로 인라인 땜질 0건 보장.'));
  children.push(spacer());

  children.push(h3('나. 미래 기술 확보'));
  children.push(par('2026~2030년 R&D 로드맵은 다음 3축으로 추진한다.'));
  children.push(bullet('TargetUP-AI 고도화 (2026~2027) : 30억 발송 로그 + POPPON 12,500명 동의 데이터를 학습 데이터로 활용한 LLM 기반 문안 추천 + 세그먼트 예측 정확도 90% 이상 확보.'));
  children.push(bullet('POPPON 데이터 랩 구축 (2028) : 지식산업센터 매입 17억원 투자, 개인정보 포함 대량 데이터 보관·학습용 물리보안 구역(출입통제·권한분리·접근통제·처리이력 관리) 운영 개시.'));
  children.push(bullet('Audit Pack 자동화 v2 (2027) : 캠페인 단위 법규준수·성과 리포트 자동 생성 + 정보통신망법·개인정보보호법·표시광고법 준수 증빙 PDF 자동 생성.'));
  children.push(spacer());

  children.push(h3('다. 기술 확보 리스크 대응방안'));
  children.push(bullet('데이터 윤리·법규 리스크 : 동의 기반 수집 100% + 가명처리·권한통제·처리이력 100% 추적 + 정기 법무 검토(개인정보보호법 / 정보통신망법 / GDPR-Lite).'));
  children.push(bullet('핵심 인력 이탈 리스크 : 연구개발인력 3명 스톡옵션 부여, 사업재편 자금 확보 후 2030년까지 16명 신규 채용으로 핵심기술 분산.'));
  children.push(bullet('AI 모델 성능 정체 리스크 : 외부 LLM(OpenAI Anthropic) API 다중화 + 자체 파인튜닝 모델 백업 + 캠페인 결과 폐회로 자동 재학습으로 모델 노후화 방지.'));
  children.push(spacer());

  children.push(h3('라. 기대효과'));
  children.push(par('2030년까지 R&D 투자 누계 약 10억원 투입으로 다음 기대효과를 창출한다.'));
  children.push(bullet('보유 특허 3건 → 9건 (출원 중 3건 + 신규 출원 3건)'));
  children.push(bullet('AI 예측 정확도 75% → 90% (캠페인 가입 전환율 12.5~30% → 20~40% 상향)'));
  children.push(bullet('POPPON DB 가입자 12,500 → 50,000명, 제휴 브랜드 204 → 500개'));
  children.push(bullet('Audit Pack 자동화로 고객사 마케팅 법무 인력 60% 절감 효과'));

  children.push(pageBreak());

  // ===== 사업화 추진 전략 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('기술확보 현황 및 향후 주요전략 — 2) 사업화 추진 전략', { bold: true, size: 22 })],
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: LABEL_FILL })
    ]})]
  }));
  children.push(spacer());

  children.push(h3('가. 제품·서비스 개발 (혁신성장 공동기준 240개 품목 「애드테크 (I30003)」 연관)'));
  children.push(par('「한줄로AI」는 혁신성장 공동기준 I30003 애드테크 품목 정의(AI·빅데이터·프로그래매틱 광고 기술 활용 디지털·모바일·크로스 채널 광고기획·실시·분석)에 정확히 부합하는 정식 오픈 상용 SaaS이다. 추가로 H29004 「AI 분석 및 예측 솔루션」(향후 핵심기술 획득), H29007 「AI 고객경험(CX)」(맞춤형 추천 영역) 품목과도 다중 매핑된다.'));
  children.push(spacer());

  children.push(h3('나. 사업 영역·시장 확대 전략'));
  children.push(par('1단계 (2026) — 한줄로AI 정식 오픈 후 국내 중견·중소기업 마케팅 자동화 시장 침투. 67개사 무료체험 정식 계약 전환 + LOI 9사 확대.'));
  children.push(par('2단계 (2027~2028) — TargetUP-AI 구독 모델 본격화 + POPPON CRM-Outside 타겟 데이터 B2B 상품화. 데이터 이용료/성과형/월정액 구독 3대 수익 모델.'));
  children.push(par('3단계 (2029~2030) — 베트남 시범 진출(현지 통신사 제휴 + 베트남어 알림톡 동등 채널 Zalo OA 연동). 동남아 마케팅 자동화 시장 1위.'));
  children.push(spacer());

  children.push(h3('다. 경쟁 분석'));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [2000, 2500, 4526],
    rows: [
      new TableRow({ children: [
        headerCell('구분', 2000),
        headerCell('주요 경쟁사', 2500),
        headerCell('한줄로AI 차별성', 4526)
      ]}),
      new TableRow({ children: [
        labelCell('메시징 중계 SaaS', 2000),
        cell('알리고, 뿌리오, 인포뱅크 등', 2500, { align: AlignmentType.LEFT }),
        cell('기존 가격 경쟁 → 한줄로AI는 AI 타겟팅·전환율 성과 기반 차별화. 캠페인 전환율 12.5~30% 검증.', 4526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('마케팅 자동화', 2000),
        cell('Braze, Iterable, 채널톡 등', 2500, { align: AlignmentType.LEFT }),
        cell('외산 솔루션은 한국 카카오 알림톡/RCS 미지원. 한줄로AI는 6채널 통합 + 18종 CT 운영 인프라.', 4526, { align: AlignmentType.LEFT })
      ]}),
      new TableRow({ children: [
        labelCell('CRM-Outside', 2000),
        cell('국내 부재 (신규 카테고리)', 2500, { align: AlignmentType.LEFT }),
        cell('동의 기반 외부 DB(POPPON 12,500명·204개 브랜드)로 신시장 선점. 진입장벽 매우 높음.', 4526, { align: AlignmentType.LEFT })
      ]})
    ]
  }));
  children.push(spacer());

  children.push(h3('라. 해외 시장 진출 계획'));
  children.push(bullet('2028년 베트남 호치민 거점 시범 진출 (현지 통신사 1개사 제휴 MOU + Zalo OA 동등 채널 연동)'));
  children.push(bullet('2029년 베트남 매출 20억 목표 + 인도네시아·태국 시장 조사'));
  children.push(bullet('2030년 베트남 매출 50억 + 동남아 1위 마케팅 자동화 SaaS 위상 확보'));
  children.push(bullet('해외 진출 자금 : 사업재편 자금 + 본 「혁신 프리미어 1000」 수출자금 우대(수출입은행 100% 한도) 활용 예정'));

  children.push(pageBreak());

  // ===== 투자 현황 및 자금 확보 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('투자 현황 및 자금 확보 주요전략', { bold: true, size: 22 })],
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: LABEL_FILL })
    ]})]
  }));
  children.push(spacer());

  // 투자 현황 표
  children.push(par([tr('□ 최근 3년 투자 현황', { bold: true })]));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [3000, 1500, 1500, 1500, 1526],
    rows: [
      new TableRow({ children: [
        headerCell('주요 투자 내역', 3000),
        headerCell('2023년', 1500),
        headerCell('2024년', 1500),
        headerCell('2025년', 1500),
        headerCell('증가율(CAGR)', 1526)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발투자 (경상개발비)', 3000),
        dataCell('0.59', 1500),
        dataCell('0.71', 1500),
        dataCell('0.64', 1500),
        dataCell('+4.1%', 1526)
      ]}),
      new TableRow({ children: [
        labelCell('자본금 증자', 3000),
        dataCell('-', 1500),
        dataCell('2.60', 1500),
        dataCell('-', 1500),
        dataCell('-', 1526)
      ]}),
      new TableRow({ children: [
        labelCell('운영자금 차입 (단기·장기)', 3000),
        dataCell('14.14', 1500),
        dataCell('23.94', 1500),
        dataCell('33.47', 1500),
        dataCell('+53.9%', 1526)
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
  children.push(bullet('자본조달 여건 양호 : 2025년 말 유동비율 411.5%, 자기자본 14.31억(자본잠식 X), 신용보증기금 적격투자기관 지분 4.62% 보유.'));
  children.push(bullet('현금흐름 안정 : 2025년 매출 128억은 사업재편 진행에 따른 의도적 축소이며, 2026 1Q 41.46억 (연간 환산 165~182억) 으로 V자 반등하여 자체 현금창출력 회복.'));
  children.push(bullet('정책금융 활용 가능성 : 사업재편 승인 시 중진공 정책자금 20억 + 기보 보증연계대출 18억 (총 38억) 신청 예정. 「혁신 프리미어 1000」 인증 시 추가 우대(금리 △1.0~1.5%p, 보증한도 100→200억).'));
  children.push(spacer());

  children.push(h3('나. 투자 로드맵 (2026~2030, 누계 약 43억원)'));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [3500, 1500, 1500, 1500, 1026],
    rows: [
      new TableRow({ children: [
        headerCell('투자 항목', 3500),
        headerCell('2026', 1500),
        headerCell('2027', 1500),
        headerCell('2028', 1500),
        headerCell('2029~30', 1026)
      ]}),
      new TableRow({ children: [
        labelCell('서버·보안·모니터링 인프라', 3500),
        dataCell('3억', 1500),
        dataCell('-', 1500),
        dataCell('-', 1500),
        dataCell('-', 1026)
      ]}),
      new TableRow({ children: [
        labelCell('전용 사업장 (지식산업센터 매입)', 3500),
        dataCell('-', 1500),
        dataCell('-', 1500),
        dataCell('17억', 1500),
        dataCell('-', 1026)
      ]}),
      new TableRow({ children: [
        labelCell('기술개발 (플랫폼·AI 모델)', 3500),
        dataCell('3억', 1500),
        dataCell('3억', 1500),
        dataCell('3억', 1500),
        dataCell('1억', 1026)
      ]}),
      new TableRow({ children: [
        labelCell('인력·운영·시장확산', 3500),
        dataCell('6억', 1500),
        dataCell('3억', 1500),
        dataCell('3억', 1500),
        dataCell('1억', 1026)
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
  children.push(bullet('자기자금 5억 : 미처분이익잉여금(2025년 말 9.73억) 중 현금성 자산 5억 즉시 집행 가능.'));
  children.push(bullet('금융기관 차입 38억 : 중진공 정책자금 20억(2026 H2) + 기보 보증연계대출 18억(2026~2027 단계 집행).'));
  children.push(bullet('「혁신 프리미어 1000」 우대 활용 : 산업은행·기업은행 금리 △1.0~1.5%p 감면 + 신·기보 보증한도 150~200억 + 보증료 △0.4%p 감면 적용 시 연간 금융비용 약 30% 절감 효과.'));
  children.push(spacer());

  children.push(h3('라. 자금 수요 시기'));
  children.push(par([tr('「혁신 프리미어 1000」 금융 지원 수요 시기 (반드시 포함 명시) :', { bold: true })]));
  children.push(bullet('2026년 하반기 (서버·보안·모니터링 인프라 3억 + AI 모델 고도화 자금 3억)'));
  children.push(bullet('2027년 상반기 (인력 확충 운영자금 3억 + 시장확산 3억)'));
  children.push(bullet('2028년 상반기 (전용 사업장 매입 17억 — 시설자금)'));

  children.push(pageBreak());

  // ===== 경영혁신·미래 핵심 인재 확보 =====
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell(new Paragraph({
        children: [tr('경영혁신·미래 핵심 인재 확보 등의 향후 주요 전략', { bold: true, size: 22 })],
        spacing: { before: 60, after: 60 }
      }), { width: cw, fill: LABEL_FILL })
    ]})]
  }));
  children.push(spacer());

  children.push(h3('가. 경영 철학'));
  children.push(par('㈜인비토는 「측정 가능한 효과(Measurable Impact)」를 경영 철학의 최우선 가치로 둔다. 한줄로AI는 광고비가 곧 결과로 환산되어야 한다는 신념 하에, 캠페인 단위 전환율·매출 기여도를 100% 추적 가능한 폐회로(발송→결과→재학습)를 구축하였다. 이는 마케팅 자동화 SaaS 업계 통상 관행인 「발송 건수 과금」에서 「성과 과금」으로의 전환을 가능케 한다.'));
  children.push(spacer());

  children.push(h3('나. 조직문화'));
  children.push(bullet('컨트롤타워 우선 문화 : 인라인 땜질 절대 금지, 18종 CT(utils/) 표준 함수 import 의무화 → 코드 재사용성·유지보수성 극대화.'));
  children.push(bullet('데이터 기반 의사결정 : 가설·추측 금지, SQL·grep 전수 검증 후 1개 정답만 도출하는 작업 문화(CLAUDE.md 룰).'));
  children.push(bullet('전수 검증 문화 : 작업 완료 전 동일 패턴 grep 전수 리스트업 → 잠재 위험 통합 수정 → 1회 배포로 사고 0건.'));
  children.push(bullet('투명 보고 문화 : 매 작업 종료 시 변경 사항·미배포 항목·잠재 위험을 명시적으로 보고하는 표준 종료 멘트 운영.'));
  children.push(spacer());

  children.push(h3('다. 인력 확보 방안 (2026~2030 누계 30명, +22명 신규)'));
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [2500, 1300, 1300, 1300, 1300, 1326],
    rows: [
      new TableRow({ children: [
        headerCell('직군', 2500),
        headerCell('2026', 1300),
        headerCell('2027', 1300),
        headerCell('2028', 1300),
        headerCell('2029', 1300),
        headerCell('2030', 1326)
      ]}),
      new TableRow({ children: [
        labelCell('연구개발직 (AI/데이터/플랫폼)', 2500),
        dataCell('+2', 1300),
        dataCell('+2', 1300),
        dataCell('+4', 1300),
        dataCell('+4', 1300),
        dataCell('+4', 1326)
      ]}),
      new TableRow({ children: [
        labelCell('마케팅/고객지원 (CSM)', 2500),
        dataCell('+1', 1300),
        dataCell('+1', 1300),
        dataCell('+2', 1300),
        dataCell('+2', 1300),
        dataCell('+2', 1326)
      ]}),
      new TableRow({ children: [
        labelCell('임원/사무/영업/행정', 2500),
        dataCell('-', 1300),
        dataCell('+1', 1300),
        dataCell('+1', 1300),
        dataCell('+2', 1300),
        dataCell('+2', 1326)
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
        cell('누계 인원', 2500, { fill: ACCENT_FILL }),
        cell('11명', 1300, { fill: ACCENT_FILL }),
        cell('15명', 1300, { fill: ACCENT_FILL }),
        cell('22명', 1300, { fill: ACCENT_FILL }),
        cell('30명', 1300, { fill: ACCENT_FILL }),
        cell('38명', 1326, { fill: ACCENT_FILL })
      ]})
    ]
  }));
  children.push(spacer());

  children.push(h3('라. 교육훈련'));
  children.push(bullet('내부 코드리뷰 + 컨트롤타워 표준 함수 학습 정례화 (주 1회)'));
  children.push(bullet('AI 모델 학습·평가 워크숍 (분기 1회)'));
  children.push(bullet('개인정보보호법·정보통신망법·표시광고법 정기 법무 교육 (반기 1회)'));
  children.push(bullet('NIPA·KOITA 등 외부 R&D 교육 프로그램 적극 참여 (연 2회 이상)'));
  children.push(spacer());

  children.push(h3('마. 투명경영'));
  children.push(bullet('국세·지방세 100% 완납 (체납 없음)'));
  children.push(bullet('연간 외부 회계감사 대비 표준재무제표 정기 신고 (홈택스 즉시 발급 가능)'));
  children.push(bullet('주주명부 정기 갱신·공시 (대표이사 95.38% + 신용보증기금 4.62%)'));
  children.push(bullet('Audit Pack 자동 생성으로 마케팅 활동의 법규준수 증빙 100% 추적'));
  children.push(spacer());

  children.push(h3('바. 조직성과관리'));
  children.push(bullet('KPI : 캠페인 가입 전환율, 활성 거래처수, 무중단 가동률 99.99%, AI 예측 정확도'));
  children.push(bullet('OKR 분기 단위 운영 + 핵심 인재 스톡옵션 부여'));
  children.push(bullet('직무전환 교육 : 기존 영업인력 → CSM(Customer Success Manager) 전환 프로그램'));
  children.push(spacer());

  children.push(h3('사. 기대효과'));
  children.push(par('2030년까지 누계 30명 직접고용 + 67개 무료체험 고객사 마케팅 자동화 전환 효과로 간접 일자리 200명+ 보전. 핵심인재 유지율 90%+ 목표. 한줄로AI를 「국내 No.1 마케팅 자동화 SaaS」 및 「동남아 1위 CRM-Outside 데이터 플랫폼」 위상으로 성장시킨다.'));
  children.push(spacer());

  // ===== 결격사유 ⑤ 예외 적용 첨부 안내 =====
  children.push(spacer());
  children.push(new Table({
    width: { size: cw, type: WidthType.DXA },
    columnWidths: [cw],
    rows: [new TableRow({ children: [
      cell([
        new Paragraph({
          children: [tr('[참고] 결격사유 ⑤ 예외 적용 첨부서류', { bold: true, size: 22, color: "C00000" })],
          spacing: { before: 60, after: 60 }
        }),
        par('공고문 § 3.가 단서조항: 결격사유 ⑤·⑥에 해당하나 「적격투자기관」(벤처기업육성특별법 § 2조의2 ① 2호 가목 (1)~(7), 신용보증기금 포함) 으로부터 투자유치 실적이 있는 경우 예외 적용 가능.', { pOpts: { spacing: { before: 40, after: 40 } } }),
        par('당사는 2018년 8월 신용보증기금으로부터 2억원(기업가치 40억 평가, 전환상환우선주 34,000주, 지분율 4.62%) 투자유치 실적을 보유하고 있으며, 다음 자료를 본 신청서와 함께 제출하여 ⑤ 매출감소 결격 단서조항에 따른 예외 적용을 신청한다.', { pOpts: { spacing: { before: 40, after: 40 } } }),
        par('• 첨부 1 : 주주명부 (2026.5.7 발급, 신용보증기금 4.62% 지분 명시)', { pOpts: { spacing: { before: 20, after: 20 } } }),
        par('• 첨부 2 : 신용보증기금 투자확인서 / 주식인수계약서 (2018.08)', { pOpts: { spacing: { before: 20, after: 20 } } })
      ], { width: cw, fill: ACCENT_FILL })
    ]})]
  }));

  return new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 20 } } }
    },
    sections: [{ properties: PAGE_PROPS, children }]
  });
}

// ============================================================
// 생성 및 저장
// ============================================================
async function main() {
  // 출력 디렉토리 확인
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // 서식 1
  const doc1 = buildForm1();
  const buf1 = await Packer.toBuffer(doc1);
  const path1 = path.join(OUT_DIR, '[서식1]_혁신프리미어1000_신청서_한줄로AI.docx');
  fs.writeFileSync(path1, buf1);
  console.log('Saved:', path1);

  // 서식 2
  const doc2 = buildForm2();
  const buf2 = await Packer.toBuffer(doc2);
  const path2 = path.join(OUT_DIR, '[서식2]_혁신성장전략서_한줄로AI.docx');
  fs.writeFileSync(path2, buf2);
  console.log('Saved:', path2);
}

main().catch(e => { console.error(e); process.exit(1); });
