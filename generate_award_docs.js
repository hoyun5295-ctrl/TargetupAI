// 2026 중소기업 혁신유공자 포상 (경영혁신 분야 / 기업인 부문) 신청서류 7종 생성
// 별지서식 제1호 — 2026년 4월 최신 업무지침 정확 미러

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
  PageBreak
} = require('docx');

const OUT_DIR = 'C:\\Users\\ceo\\Downloads\\혁신유공포상_경영혁신_인비토';
const FONT = '맑은 고딕';

const A4 = {
  page: {
    size: { width: 11906, height: 16838 },
    margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 }
  }
};
const CONTENT_W = 9746;

const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const borders = { top: border, bottom: border, left: border, right: border };

function P(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [{ text }];
  return new Paragraph({
    children: runs.map(r => new TextRun({
      text: r.text || '',
      bold: r.bold || opts.bold || false,
      size: r.size || opts.size || 20,
      font: FONT
    })),
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { before: opts.before || 0, after: opts.after || 60, line: opts.line || 300 }
  });
}

function H(text, size = 28) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size, font: FONT })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 240, line: 360 }
  });
}

function cellP(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({
      text: text || '',
      bold: opts.bold || false,
      size: opts.size || 18,
      font: FONT
    })],
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { before: 40, after: 40, line: 280 }
  });
}

function cell(text, opts = {}) {
  const children = Array.isArray(text)
    ? text.map(t => cellP(t, opts))
    : [cellP(text, opts)];
  return new TableCell({
    borders,
    width: { size: opts.width || 0, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: opts.colspan || undefined,
    rowSpan: opts.rowspan || undefined,
    children
  });
}

function makeDoc(title, children) {
  return new Document({
    creator: '주식회사 인비토',
    title,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: A4, children }]
  });
}

function save(filename, doc) {
  const filepath = path.join(OUT_DIR, filename);
  return Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(filepath, buf);
    console.log('Saved:', filepath);
  });
}

// ============================================================
// 1. 유공자 포상신청서 (2026 신규 양식)
// ============================================================
function doc1_application() {
  const head = [
    P('[별지서식 제1호] 1. 유공자 포상신청서', { size: 18 }),
    H('유공자 포상신청서', 32)
  ];

  const tField = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2400, 7346],
    rows: [
      new TableRow({ children: [
        cell('신청부문', { width: 2400, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('경영혁신 (기업인 부문)', { width: 7346, align: AlignmentType.CENTER, bold: true })
      ]}),
      new TableRow({ children: [
        cell(['경영혁신 분야', '(중복 선택 가능)', '※ 해당 분야 ☑'], { width: 2400, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell([
          '☑ 제품·서비스혁신       □ 비즈니스프로세스혁신',
          '☑ 비즈니스모델혁신     ☑ 디지털혁신',
          '□ ESG혁신             □ 기타 창의적 혁신',
          '※ [참고] 경영혁신 개념 및 정의(업무지침 11p) 참고'
        ], { width: 7346 })
      ]}),
    ]
  });

  const subA = P('◆ 신청자 정보', { bold: true, size: 22, before: 240, after: 120 });

  const tInfo = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [1800, 3073, 1800, 3073],
    rows: [
      new TableRow({ children: [
        cell('소속기업명', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('주식회사 인비토', { width: 7946, colspan: 3, bold: true })
      ]}),
      new TableRow({ children: [
        cell('사업자등록번호', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('(※ 사업자등록증 상의 번호 기재)', { width: 3073, align: AlignmentType.CENTER }),
        cell('법인등록번호', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('(※ 법인등기부 상의 번호 기재)', { width: 3073, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('성명', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('유 호 윤 (한자: 柳鎬潤)', { width: 3073 }),
        cell('직위', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('대표이사', { width: 3073, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('주민등록번호', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('(※ 주민등록상 기재)', { width: 3073, align: AlignmentType.CENTER }),
        cell('성별', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('男', { width: 3073, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell(['연락처', '주소'], { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER, rowspan: 2 }),
        cell('(직장)', { width: 3073, shading: 'F5F5F5', align: AlignmentType.CENTER }),
        cell('(※ 사업장 주소 기재)', { width: 4873, colspan: 2 })
      ]}),
      new TableRow({ children: [
        cell('(자택)', { width: 3073, shading: 'F5F5F5', align: AlignmentType.CENTER }),
        cell('(※ 주민등록상 자택 주소 기재)', { width: 4873, colspan: 2 })
      ]}),
      new TableRow({ children: [
        cell('연락처 전화', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('(직장)', { width: 3073, shading: 'F5F5F5', align: AlignmentType.CENTER }),
        cell('(휴대전화)', { width: 1800, shading: 'F5F5F5', align: AlignmentType.CENTER }),
        cell('(※ 연락 가능한 번호 기재)', { width: 3073, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('이메일', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('(※ 이메일 주소 기재)', { width: 7946, colspan: 3 })
      ]}),
    ]
  });

  const closing = [
    P('', { before: 360 }),
    P('위와 같이 「2026년 중소기업 혁신유공자 포상」을 신청합니다.', { align: AlignmentType.CENTER, before: 240 }),
    P('', { before: 240 }),
    P('2026년       월       일', { align: AlignmentType.CENTER, before: 120 }),
    P('', { before: 240 }),
    P('소속기업 :  주식회사 인비토         (법인인감 또는 사용인감)', { align: AlignmentType.CENTER }),
    P('', { before: 120 }),
    P('신청유공자 :  유 호 윤              (본인 서명 또는 인감)', { align: AlignmentType.CENTER }),
    P('', { before: 360 }),
    P('중소벤처기업부장관 귀하', { align: AlignmentType.CENTER, bold: true, size: 22 })
  ];

  return makeDoc('유공자 포상신청서', [...head, tField, subA, tInfo, ...closing]);
}

// ============================================================
// 2. 신청자 정보 (별지서식 제1호-2) — 2026 신규
// ============================================================
function doc2_applicant_info() {
  const head = [
    P('[별지서식 제1호] 2. 신청자 정보', { size: 18 }),
    H('신청자 정보', 32)
  ];

  const sub1 = P('□ 주요 경영혁신 추진실적', { bold: true, size: 22, before: 120, after: 120 });
  const note1 = P('※ \'주요 혁신성과\'에는 신청자의 역할 및 기여도를 반드시 포함하여 작성', { size: 16, after: 60 });
  const note2 = P('※ 필요 시 행을 추가하여 작성 가능', { size: 16, after: 120 });

  const tActivity = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [3800, 1800, 4146],
    rows: [
      new TableRow({ children: [
        cell(['추진내용', '(사업명 또는 활동 내용)'], { width: 3800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell(['기간', '(최신순)'], { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell(['주요 혁신성과', '(신청자 역할 포함)'], { width: 4146, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('「한줄로AI」 통합 마케팅 자동화 SaaS 자체 개발 및 정식 출시 (SMS/LMS/MMS/알림톡/카카오 브랜드메시지/RCS 6채널 통합)',
          { width: 3800 }),
        cell('2017.01 ~ 2026.05 (정식 출시 D-Day 2026.05.05)', { width: 1800, align: AlignmentType.CENTER }),
        cell([
          '· 30억 건 발송로그 학습 기반 TargetUP-AI 예측·추천 엔진 자체 개발',
          '· 18종 컨트롤타워(CT-01~CT-18) 자체 설계 및 atomic safe-build 무중단 배포 체계 구축',
          '· 캠페인 가입 전환율 12.5~30% 검증, 2026 1Q 거래처 123개사·매출 41.46억',
          '· 신청자 역할: 전체 기획·총괄·개발 의사결정 + 18종 컨트롤타워 설계 총괄'
        ], { width: 4146, size: 16 })
      ]}),
      new TableRow({ children: [
        cell('POPPON 동의 기반 CRM-Outside DB 플랫폼 구축·운영 (실명·수신동의 외부고객 데이터 직접 축적)',
          { width: 3800 }),
        cell('2023.04 ~ 운영 중', { width: 1800, align: AlignmentType.CENTER }),
        cell([
          '· 제휴 브랜드 204개 / 가입자 12,500명 (전원 명시적 동의 기반)',
          '· 개인정보 비식별화 + Audit Pack 처리이력 100% 추적 체계 구축',
          '· 국내 경쟁사 부재 신시장 카테고리 선점 (2030년 약 3,000억원 규모 전망)',
          '· 신청자 역할: 비즈니스모델 설계 + 동의 기반 데이터 수집 정책 정립'
        ], { width: 4146, size: 16 })
      ]}),
      new TableRow({ children: [
        cell('등록 특허 3건 자체 출원·등록 + 출원 중 3건 (메시징·필터링·통합 시스템)',
          { width: 3800 }),
        cell('2018.01 / 2019.07 / 2021.11', { width: 1800, align: AlignmentType.CENTER }),
        cell([
          '· 특허 제10-1821985호 「기업형 대량 문자 메시지 발송 서비스 방법」',
          '· 특허 제10-1990872호 「기업용 온라인 통합 메시징 시스템」',
          '· 특허 제10-2325851호 「POPPON 필터링 시스템」',
          '· 신청자 역할: 발명자 또는 공동발명자 (특허 등록증 기준)'
        ], { width: 4146, size: 16 })
      ]}),
      new TableRow({ children: [
        cell('연구개발전담부서 운영 (한국산업기술진흥협회 KOITA 등록)',
          { width: 3800 }),
        cell('2017.01 ~ 운영 중 (9년 연속)', { width: 1800, align: AlignmentType.CENTER }),
        cell([
          '· 창업 시점 KOITA 등록 후 9년 연속 유효 운영',
          '· 연구개발 인력 5명 / 총원 대비 비중 37.5%',
          '· 2024년 말 4명 → 2025년 말 7명 (대표 제외) 1년간 +75% 인력 확장',
          '· 신청자 역할: 연구개발전담부서 운영 책임자'
        ], { width: 4146, size: 16 })
      ]}),
    ]
  });

  const sub2 = P('□ 주요 이력', { bold: true, size: 22, before: 360, after: 120 });

  const sub2a = P('▣ 수상 경력  ※ 중앙부처로부터 수상받은 이력 작성', { bold: true, size: 20, before: 120, after: 80 });

  const tAward = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [1500, 2200, 3000, 1546, 1500],
    rows: [
      new TableRow({ children: [
        cell('구분', { width: 1500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('훈격', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('시상식명', { width: 3000, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('포상일자', { width: 1546, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('사본 제출여부', { width: 1500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER, size: 16 })
      ]}),
      new TableRow({ children: [
        cell('해당 없음 (중앙부처 수상 이력 없음)', { width: 9746, colspan: 5, align: AlignmentType.CENTER })
      ]}),
    ]
  });

  const sub2b = P('▣ 징계형벌 이력  ※ 범죄사실 및 벌금이 발견될 경우, 심사과정 중 어느 시점에서나 탈락될 수 있음', { bold: true, size: 20, before: 240, after: 80 });

  const tDis = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [3000, 4746, 2000],
    rows: [
      new TableRow({ children: [
        cell('징계기관', { width: 3000, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('징계내용', { width: 4746, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('징계일자', { width: 2000, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('해당 없음', { width: 3000, align: AlignmentType.CENTER }),
        cell('해당 없음', { width: 4746, align: AlignmentType.CENTER }),
        cell('-', { width: 2000, align: AlignmentType.CENTER })
      ]}),
    ]
  });

  const sub2c = P('▣ 학력  ※ 대학교 학사, 석사, 박사 학위만 작성', { bold: true, size: 20, before: 240, after: 80 });

  const tEdu = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [1500, 1500, 2746, 2500, 1500],
    rows: [
      new TableRow({ children: [
        cell('시작일', { width: 1500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('종료일', { width: 1500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('학교명 (학위)', { width: 2746, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('전공', { width: 2500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('졸업여부', { width: 1500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('(※ 학사 시작)', { width: 1500, align: AlignmentType.CENTER, size: 16 }),
        cell('(※ 학사 종료)', { width: 1500, align: AlignmentType.CENTER, size: 16 }),
        cell('(※ 학교명 + 학사)', { width: 2746, align: AlignmentType.CENTER, size: 16 }),
        cell('(※ 전공)', { width: 2500, align: AlignmentType.CENTER, size: 16 }),
        cell('(※ 졸업 여부)', { width: 1500, align: AlignmentType.CENTER, size: 16 })
      ]}),
    ]
  });

  const sub2d = P('▣ 경력  ※ 건강보험자격득실확인서 기재된 사항만 작성', { bold: true, size: 20, before: 240, after: 80 });

  const tCareer = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [1500, 1500, 3246, 3500],
    rows: [
      new TableRow({ children: [
        cell('시작일', { width: 1500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('종료일', { width: 1500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('근무처 (최종직위)', { width: 3246, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('주요업무', { width: 3500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('2017.01.16', { width: 1500, align: AlignmentType.CENTER }),
        cell('현재 (재직 중)', { width: 1500, align: AlignmentType.CENTER }),
        cell('주식회사 인비토 (대표이사)', { width: 3246, align: AlignmentType.CENTER }),
        cell('한줄로AI 통합 마케팅 자동화 SaaS 사업 총괄 / TargetUP·POPPON·한줄로AI 플랫폼 기획·개발 의사결정 / 연구개발전담부서 운영 책임 / 30억 건 발송 데이터 자산화 총괄', { width: 3500, size: 16 })
      ]}),
      new TableRow({ children: [
        cell('(※ 인비토 이전 경력 시작일 기재)', { width: 1500, align: AlignmentType.CENTER, size: 16 }),
        cell('(※ 인비토 이전 경력 종료일 기재)', { width: 1500, align: AlignmentType.CENTER, size: 16 }),
        cell('(※ 이전 근무처가 동종 업종인 경우 기재)', { width: 3246, align: AlignmentType.CENTER, size: 16 }),
        cell('(※ 동종 업종 주요업무 기재)', { width: 3500, align: AlignmentType.CENTER, size: 16 })
      ]}),
    ]
  });

  const finalNote = P('※ 작성사항에 대한 증빙서류 필수 제출. 미제출 시 해당 내용은 인정되지 않음', { size: 16, before: 240 });

  return makeDoc('신청자 정보', [
    ...head, sub1, note1, note2, tActivity, sub2, sub2a, tAward, sub2b, tDis, sub2c, tEdu, sub2d, tCareer, finalNote
  ]);
}

// ============================================================
// 3. 회사 일반현황 (2026 양식 — 가점 보유현황 통합)
// ============================================================
function doc3_company() {
  const head = [
    P('[별지서식 제1호] 3. 회사 일반현황', { size: 18 }),
    H('회사 일반현황', 32)
  ];

  const sub1 = P('□ 기본정보', { bold: true, size: 22, before: 120, after: 120 });
  const tBasic = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2200, 2873, 2200, 2473],
    rows: [
      new TableRow({ children: [
        cell('업종', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('정보통신업 / 소프트웨어 개발 및 공급업 (SaaS)', { width: 2873, align: AlignmentType.CENTER }),
        cell('토건관리번호', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('해당 없음 (정보통신업)', { width: 2473, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('설립 연월일', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('2017년 01월 16일', { width: 2873, align: AlignmentType.CENTER }),
        cell('홈페이지 주소', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('hanjul.ai', { width: 2473, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('사업장관리번호', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('(※ 4대 보험 사업장관리번호 기재)', { width: 7546, colspan: 3, align: AlignmentType.CENTER })
      ]}),
    ]
  });

  const sub2 = P('□ 주요 사업 및 수익 구조', { bold: true, size: 22, before: 240, after: 120 });
  const note2 = P('※ (작성 분량) 항목별 1페이지 이내로 제한', { size: 16, after: 120 });
  const tBiz = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2200, 7546],
    rows: [
      new TableRow({ children: [
        cell('주요 사업 현황', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell([
          '주식회사 인비토는 2017년 설립된 AI·디지털 마케팅 자동화 SaaS 전문기업이다. 2017년부터 TargetUP 메시징 자동화 플랫폼을 운영하며 SMS, LMS, MMS, 알림톡, 카카오 브랜드메시지, RCS 등 주요 발송 채널의 운영 데이터를 축적했고, 이를 기반으로 30억 건 발송로그 학습 기반 TargetUP-AI 예측·추천 엔진과 동의 기반 CRM-Outside DB 플랫폼 POPPON을 결합한 통합 마케팅 인텔리전스 체계를 구축하였다.',
          '2026.04.15 기준으로 한줄로AI 상용화 기반 구축, 6채널 발송 자동화, 동의 데이터 관리, 법규 준수 처리이력 추적, AI 문안 및 발송시점 추천 기능을 자체 개발·운영하고 있으며, 2026년 5월 5일 정식 오픈을 통해 그간의 경영혁신 활동을 시장에 구현하였다.',
          '수익모델은 TargetUP 메시지 발송 종량 과금, TargetUP-AI 예측·추천 엔진 구독, POPPON CRM-Outside 데이터 이용료의 3대 축으로 구성된다. 2026년 1분기 실 결제 거래처 123개사와 공급가액 41.46억원을 기록하여 2025년 구조전환 이후 매출 회복 기반을 확인하였다.'
        ], { width: 7546, size: 18 })
      ]}),
      new TableRow({ children: [
        cell('주요 제품·서비스', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell([
          '① TargetUP — SMS/LMS/MMS/알림톡/카카오 브랜드메시지/RCS 6채널 발송 자동화 SaaS (캠페인 단위 발송·예약·집계·환불 idempotent 자동화 / 12개 라인그룹 분산으로 대량 발송 트래픽 격리)',
          '② POPPON — B2C 동의 기반 쿠폰 플랫폼 (실명·수신동의 외부고객 데이터 수집·정제·저장 / 제휴 브랜드 204개 / 가입자 12,500명 / 개인정보 비식별화 + Audit Pack 처리이력 100% 추적)',
          '③ 한줄로AI (TargetUP-AI 엔진) — AI 기반 마케팅 예측·추천 (30억 건 발송로그 학습 / 세그먼트별 반응률·전환율 예측 / 최적 발송시점·LLM 기반 문안 추천 / 폐회로 자가 재학습)'
        ], { width: 7546, size: 18 })
      ]}),
      new TableRow({ children: [
        cell(['타사 대비', '차별화 전략'], { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell([
          '① 동의 기반 CRM-Outside DB 직접 축적 — 기존 메시징 SaaS는 「기업 보유 DB로만 발송 가능」한 구조적 한계가 있으나, 자사 POPPON 플랫폼으로 실명·수신동의 외부고객 데이터를 직접 확보하여 신시장 카테고리 선점. 국내 경쟁사 부재.',
          '② 30억 건 발송로그 학습 AI 폐회로 — 캠페인 결과를 자동 재학습하여 반응률·전환율을 자가 개선하는 폐회로 구축. 검증된 캠페인 가입 전환율 12.5~30%.',
          '③ 18종 컨트롤타워(CT-01~CT-18) 운영 인프라 — 발송·정산·환불·동의·법규 준수 기능을 표준화하여 운영 오류와 개발 리스크를 구조적으로 차단.',
          '④ atomic safe-build 무중단 배포 체계 — 빌드 실패 시에도 옛 dist 유지로 고객 발송 중단 0초 보장. 외산 솔루션(Braze, Iterable 등)이 한국 카카오 알림톡·RCS를 미지원하는 점을 활용한 외산 대체 효과.'
        ], { width: 7546, size: 18 })
      ]}),
      new TableRow({ children: [
        cell('매출 구성 비율', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell([
          '· TargetUP 메시지 종량 과금: 2026년 1분기 기준 주 수익원',
          '· TargetUP-AI 예측·추천 엔진 구독: 2026년 하반기 본격 도입 예정',
          '· POPPON CRM-Outside 데이터 이용료: 2026년 하반기 본격 상품화 예정',
          '· 중장기 목표: TargetUP 종량 과금 의존도를 낮추고 AI 구독과 데이터 이용료 중심의 반복수익 구조로 전환'
        ], { width: 7546, size: 18 })
      ]}),
    ]
  });

  const sub3 = P('□ 경영성과 및 조직 운영현황', { bold: true, size: 22, before: 240, after: 120 });
  const tPerf = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2200, 2600, 2473, 2473],
    rows: [
      new TableRow({ children: [
        cell('구분', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('항목', { width: 2600, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('2024년', { width: 2473, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('2025년', { width: 2473, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('경영성과', { width: 2200, shading: 'F5F5F5', bold: true, align: AlignmentType.CENTER, rowspan: 4 }),
        cell('매출액 (백만원)', { width: 2600, shading: 'F5F5F5', align: AlignmentType.CENTER }),
        cell('20,887', { width: 2473, align: AlignmentType.RIGHT, bold: true }),
        cell('12,826', { width: 2473, align: AlignmentType.RIGHT, bold: true })
      ]}),
      new TableRow({ children: [
        cell('영업이익 (백만원)', { width: 2600, shading: 'F5F5F5', align: AlignmentType.CENTER }),
        cell('363', { width: 2473, align: AlignmentType.RIGHT }),
        cell('145', { width: 2473, align: AlignmentType.RIGHT })
      ]}),
      new TableRow({ children: [
        cell('당기순이익 (백만원)', { width: 2600, shading: 'F5F5F5', align: AlignmentType.CENTER }),
        cell('(※ 결산 확정값 기재)', { width: 2473, align: AlignmentType.CENTER, size: 16 }),
        cell('(※ 결산 확정값 기재)', { width: 2473, align: AlignmentType.CENTER, size: 16 })
      ]}),
      new TableRow({ children: [
        cell('수출액 ($, 달러)', { width: 2600, shading: 'F5F5F5', align: AlignmentType.CENTER }),
        cell('0', { width: 2473, align: AlignmentType.CENTER }),
        cell('0', { width: 2473, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('고용현황', { width: 2200, shading: 'F5F5F5', bold: true, align: AlignmentType.CENTER, rowspan: 2 }),
        cell(['고용보험가입자 수 (명)', '— 대표 제외, 12.31 기준'], { width: 2600, shading: 'F5F5F5', align: AlignmentType.CENTER, size: 16 }),
        cell('4명', { width: 2473, align: AlignmentType.CENTER, bold: true }),
        cell('7명', { width: 2473, align: AlignmentType.CENTER, bold: true })
      ]}),
      new TableRow({ children: [
        cell('신규고용 인원 (명)', { width: 2600, shading: 'F5F5F5', align: AlignmentType.CENTER }),
        cell('-', { width: 2473, align: AlignmentType.CENTER }),
        cell('+3명 (+75%)', { width: 2473, align: AlignmentType.CENTER, bold: true })
      ]}),
      new TableRow({ children: [
        cell('조직 구성', { width: 2200, shading: 'F5F5F5', bold: true, align: AlignmentType.CENTER }),
        cell([
          '총원 8명 (2026.02 기준 / 대표이사 1 + 임직원 7)',
          '- 연구개발 5명 (연구개발팀장 1 + 전담요원 3 + 개발팀원 1)',
          '- 경영·운영 2명',
          '- 2024 말 4명 → 2025 말 7명 (+75% 인력 확장)',
          '※ 조직도 별첨'
        ], { width: 7546, colspan: 3, size: 18 })
      ]}),
    ]
  });
  const note3 = P('※ 경영성과는 표준재무제표 기준으로 작성 (단, 25년에 공시된 자료 없을 시 가결산 자료 기준)', { size: 16, before: 80 });
  const note3b = P('※ 증빙 제출 필수 (표준재무제표(가결산자료), 수출입증명서, 고용보험 사업장 자격취득자 명부 등)', { size: 16, after: 60 });
  const note3c = P('※ 매출 감소 설명: 2025년은 메시징 중계 중심 사업 구조를 정리하고 한줄로AI 및 AI SaaS 전환을 위한 R&D에 집중한 의도적 사업구조 재편 시기이며, 2026년 1분기 실 결제 거래처 123개사·공급가액 41.46억원(연환산 165억 상회)으로 회복 기반 확인. 수치는 세금계산서·정산자료·거래처 리스트 등으로 별첨 증빙.', { size: 16, bold: true, after: 240 });

  // 가점 보유현황 (2026 신규 — 회사 일반현황에 통합)
  const sub4 = P('□ 가점 보유현황 (최대 5점 부여)  ※ 해당 사항 체크(필수) ☑', { bold: true, size: 22, before: 240, after: 120 });

  const tBonus = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2400, 4346, 1600, 1400],
    rows: [
      new TableRow({ children: [
        cell('내용', { width: 2400, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('가점 항목 (2026년 기준)', { width: 4346, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('보유 여부', { width: 1600, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('비고', { width: 1400, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER, size: 16 })
      ]}),
      new TableRow({ children: [
        cell('경영혁신형 중소기업 (MAIN-BIZ) 확인', { width: 2400, bold: true }),
        cell('경영혁신형 중소기업 확인서', { width: 4346 }),
        cell('☑ 보유', { width: 1600, align: AlignmentType.CENTER, bold: true }),
        cell('가점 3점', { width: 1400, align: AlignmentType.CENTER, size: 16, bold: true })
      ]}),
      new TableRow({ children: [
        cell(['기타 경영혁신', '분야 인증 보유'], { width: 2400, bold: true, rowspan: 4 }),
        cell('글로벌 강소기업 지정 기업 (강소단계 이상)', { width: 4346 }),
        cell('□', { width: 1600, align: AlignmentType.CENTER }),
        cell(['1가지 이상', '보유 시', '가점 1점'], { width: 1400, align: AlignmentType.CENTER, size: 16, rowspan: 4 })
      ]}),
      new TableRow({ children: [
        cell('인재육성형 중소기업', { width: 4346 }),
        cell('□', { width: 1600, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('기타 인증 (녹색기업 등)', { width: 4346 }),
        cell('□', { width: 1600, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('(※ 보유 인증 있을 시 기재)', { width: 4346, align: AlignmentType.CENTER, size: 16 }),
        cell('-', { width: 1600, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('혁신 기업 여부', { width: 2400, bold: true, rowspan: 3 }),
        cell('초격차 스타트업 1000+', { width: 4346 }),
        cell('□', { width: 1600, align: AlignmentType.CENTER }),
        cell(['1가지 이상', '보유 시', '가점 1점'], { width: 1400, align: AlignmentType.CENTER, size: 16, rowspan: 3 })
      ]}),
      new TableRow({ children: [
        cell('아기 / 예비 유니콘', { width: 4346 }),
        cell('□', { width: 1600, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('중소벤처 R&D 우수성과 50선 기업', { width: 4346 }),
        cell('□', { width: 1600, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell(['연구개발에 대한 의지', '(연구개발 전담조직', '활용 여부)'], { width: 2400, bold: true, rowspan: 2 }),
        cell('공인 기업부설연구소', { width: 4346 }),
        cell('□', { width: 1600, align: AlignmentType.CENTER }),
        cell(['1가지 이상', '보유 시', '가점 1점'], { width: 1400, align: AlignmentType.CENTER, size: 16, rowspan: 2 })
      ]}),
      new TableRow({ children: [
        cell('공인 연구개발전담부서 (한국산업기술진흥협회 KOITA 등록 / 2017.01~ 9년 연속)', { width: 4346, bold: true }),
        cell('☑ 보유', { width: 1600, align: AlignmentType.CENTER, bold: true })
      ]}),
    ]
  });

  const note4 = P('※ 모든 인증서는 모집 마감일(2026. 4. 15)까지 유효해야 함', { size: 16, before: 80 });
  const note4b = P('※ 증빙 자료 제출 필수. 미제출 시 가점 부여 불가', { size: 16, after: 80 });

  const summary = P('▣ 인비토 가점 예상: 메인비즈 3점 + R&D 전담부서 1점 = 합계 4점 (기타 혁신 인증 1건 추가 보유 시 만점 5점 달성)',
    { bold: true, size: 20, before: 180, after: 60 });

  return makeDoc('회사 일반현황', [
    ...head, sub1, tBasic, sub2, note2, tBiz, sub3, tPerf, note3, note3b, note3c, sub4, tBonus, note4, note4b, summary
  ]);
}

// ============================================================
// 4. 공적조서 (2026 — 경영혁신 분야 5개로 변경)
// ============================================================
function doc4_merit_record() {
  const head = [
    P('[별지서식 제1호] 4. 공적조서', { size: 18 }),
    H('공적조서', 32)
  ];

  const tInfo = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [1800, 3173, 1800, 2973],
    rows: [
      new TableRow({ children: [
        cell('성명', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('유 호 윤', { width: 3173, align: AlignmentType.CENTER, bold: true }),
        cell('한자', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('柳鎬潤', { width: 2973, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('주민번호 (생년월일)', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('(※ 주민등록상 기재)', { width: 3173, align: AlignmentType.CENTER }),
        cell('국적', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('대한민국', { width: 2973, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('주소', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('(※ 주민등록상 자택 주소 기재)', { width: 7946, colspan: 3 })
      ]}),
      new TableRow({ children: [
        cell('직업', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('기업 대표이사', { width: 3173, align: AlignmentType.CENTER }),
        cell('소속', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('주식회사 인비토', { width: 2973, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('직위', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('대표이사', { width: 3173, align: AlignmentType.CENTER }),
        cell('직급 / 계급', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('대표이사', { width: 2973, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('추천훈격', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('중소벤처기업부 장관표창', { width: 3173, align: AlignmentType.CENTER, bold: true }),
        cell('추천순위', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('(※ 추천기관 기재)', { width: 2973, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('공적분야', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('산업경제 (경영혁신)', { width: 3173, align: AlignmentType.CENTER }),
        cell('공적기간', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('9년 3개월 (2017.01.16 ~ 2026.04.15)', { width: 2973, align: AlignmentType.CENTER, size: 16 })
      ]}),
      new TableRow({ children: [
        cell('공적요지 (70자 이내)', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('동의 기반 DB와 AI 예측엔진을 결합한 마케팅 자동화 SaaS 상용화 기반 구축',
          { width: 7946, colspan: 3 })
      ]}),
    ]
  });

  const tInvest = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [1800, 7946],
    rows: [
      new TableRow({ children: [
        cell('조사자', { width: 1800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell([
          '소속 :',
          '직위(직급·계급) :                            성명 :                              (서명 또는 인)'
        ], { width: 7946 })
      ]}),
    ]
  });

  const tApproval = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [9746],
    rows: [
      new TableRow({ children: [
        cell([
          '위의 기록이 사실과 다름없음을 확인합니다.',
          '',
          '                                                                              2026년       월       일',
          '',
          '추천관      직위 :                                              성명 :                              관인'
        ], { width: 9746 })
      ]}),
    ]
  });

  const noteA = P('※ 주의: 음영 부분은 기재하지 마시오 (조사자/추천관 영역은 추천기관 작성)', { size: 16, before: 60 });
  const noteB = P('※ 공적기간 산정기준일은 2026. 04. 15, 온라인 접수 시 작성된 기간과 동일하게 기재요망', { size: 16, after: 240 });

  const subCareer = P('▣ 주요 경력 (이력사항)', { bold: true, size: 22, before: 120, after: 120 });
  const tCareerRec = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [3000, 6746],
    rows: [
      new TableRow({ children: [
        cell('연월일', { width: 3000, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('주요 경력', { width: 6746, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('2017.01.16 ~ 현재', { width: 3000, align: AlignmentType.CENTER }),
        cell('주식회사 인비토 대표이사 (창업 9년 연속 운영)', { width: 6746 })
      ]}),
      new TableRow({ children: [
        cell('2017.01 ~ 현재', { width: 3000, align: AlignmentType.CENTER }),
        cell('연구개발전담부서 운영 책임자 (한국산업기술진흥협회 KOITA 등록)', { width: 6746 })
      ]}),
      new TableRow({ children: [
        cell('2017 ~ 현재', { width: 3000, align: AlignmentType.CENTER }),
        cell('TargetUP / POPPON / 한줄로AI 플랫폼 기획·총괄 (30억 건 발송 데이터 축적)', { width: 6746 })
      ]}),
    ]
  });

  const subAward = P('▣ 과거 포상기록 (훈장 · 포장 · 표창별 기록)', { bold: true, size: 22, before: 240, after: 120 });
  const tPastAward = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2500, 7246],
    rows: [
      new TableRow({ children: [
        cell('수여일 (연 월 일)', { width: 2500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('포상명 / 수여기관', { width: 7246, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('해당 없음', { width: 2500, align: AlignmentType.CENTER }),
        cell('(정부 훈·포장·표창 수상 이력 없음 — 재포상 금지기간 해당 없음)', { width: 7246 })
      ]}),
    ]
  });

  const noteBody = P('▣ 공적 내용  ※ 총 2,000자 이상, 4페이지 이내 작성  ※ 표·그림·특수문자 사용 금지  ※ 문단 표기: O / - / *', { bold: true, size: 22, before: 360, after: 120 });

  // 공적 내용 — 2026 분류(5개) + 기준일 2026.04.15 보완 톤
  const meritBody = [
    P('O 공적 기준일 보완 명시 (필수 선행 진술)', { bold: true, size: 22, before: 60, after: 120 }),
    P('- 본 신청자는 2017년 인비토 창업 이후 2026.04.15까지 9년 3개월간 메시징 SaaS 운영, 발송 데이터 축적, 동의 기반 외부고객 데이터 구축, AI 예측·추천 엔진 개발, 연구개발전담부서 운영을 지속하였다. 한줄로AI의 2026년 5월 5일 정식 오픈은 기준일 이전까지 구축된 TargetUP, POPPON, TargetUP-AI의 기술과 운영체계를 시장에 구현한 결과이며, 본 공적은 기준일 이전의 개발·운영·구축 성과를 중심으로 한다.', { size: 20, after: 180 }),

    P('O 경영혁신 분야 (중복 기재) :  ① 제품·서비스혁신,  ③ 비즈니스모델혁신,  ④ 디지털혁신', { bold: true, size: 22, before: 60, after: 120 }),

    P('O 사업 분야 (해당 분야가 속한 산업 동향·변화·이슈 등)', { bold: true, size: 22, before: 240, after: 120 }),
    P('- (마케팅 자동화 SaaS 시장 동향) 국내 기업 메시징 시장은 카카오톡 알림톡·브랜드메시지·RCS를 포함하여 연 1조 5천억원 규모이며, 카카오 BMS 전환 확산으로 연 8~12% 성장 중이다. 다만 기존 시장은 가격 경쟁 일변도이며 「발송 건수 과금」 구조에 머물러 있어, 진정한 의미의 마케팅 인텔리전스 영역은 신생 시장으로 남아 있었다.', { size: 20, after: 120 }),
    P('  * 외산 마케팅 자동화 솔루션(Braze, Iterable 등)이 한국 카카오 알림톡·RCS를 미지원하는 구조적 공백 존재', { size: 18, after: 120 }),
    P('- (애드테크 시장 동향) 국내 약 14조원, 글로벌 1,000조원 규모의 애드테크 시장은 AI·프로그래매틱 광고 기술 발전으로 연 15% 이상 성장 중이며, 한줄로AI는 혁신성장 공동기준 「애드테크(I30003)」 품목 정의에 정확히 부합하는 정식 오픈 상용 SaaS이다.', { size: 20, after: 120 }),
    P('- (CRM-Outside 신시장 정의) 기존 CRM은 기업이 이미 보유한 고객DB를 대상으로 하는 경우가 많다. 본 신청자는 POPPON을 통해 명시적 동의 기반 외부고객 접점을 확보하고 이를 마케팅 자동화와 연결함으로써 중소기업의 신규 고객 접점 확대를 지원하는 CRM-Outside 모델을 추진하고 있으며, 이는 14조원 규모 국내 애드테크 시장 내에서 동의 기반 외부 데이터 결합이라는 차별화 영역(블루오션)을 선도하는 위치를 차지한다.', { size: 20, after: 120 }),

    P('O 경영혁신 추진배경 및 동기 (위 상황을 토대로 경영혁신 추진 배경 및 필요성, 추진목적 등)', { bold: true, size: 22, before: 240, after: 120 }),
    P('- (구조적 한계 인식) 본 신청자는 2017년 인비토 창업 이래 9년간 메시징 SaaS를 운영하며 30억 건의 발송 데이터를 축적하였다. 그 과정에서 기존 메시징 중계업의 두 가지 구조적 한계를 명확히 인식하였다. 첫째, 「기업 보유 DB로만 발송 가능」한 구조 — 신규 고객 확보가 불가능하여 마케팅 자동화의 핵심 가치인 「Outside Customer 접점 확대」가 원천 차단된다. 둘째, 「발송 건수 과금」 구조 — 광고비가 곧 결과로 환산되지 않아 광고주는 비용만 부담하고 성과 측정은 별도 시스템에 의존하게 된다.', { size: 20, after: 120 }),
    P('- (혁신 의지 정립) 이러한 인식 아래 본 신청자는 「측정 가능한 효과(Measurable Impact)」를 경영 철학의 최우선 가치로 두고, 광고비가 곧 결과로 환산되어야 한다는 신념 하에 캠페인 단위 전환율·매출 기여도를 100% 추적 가능한 폐회로를 구축하기로 결정하였다.', { size: 20, after: 120 }),
    P('- (혁신 추진 결정 및 목적) 이를 위해 본 신청자는 2026.04.15까지 ① 동의 기반 CRM-Outside DB 직접 축적 체계(POPPON), ② 30억 건 발송로그 학습 AI 예측·추천 엔진(TargetUP-AI), ③ 6대 채널 통합 발송 자동화 체계(TargetUP)를 결합한 한줄로AI 상용화 기반을 구축하였다. 2026년 5월 5일 정식 오픈은 기준일 이전까지 축적한 기술과 운영체계를 시장에 구현한 결과이며, 공적의 중심은 기준일 이전의 개발·운영·구축 성과이다. 추진 목적은 광고주에게 측정 가능한 ROI를 제공하고, 국내 마케팅 자동화 SaaS 산업의 경쟁력을 높이며, 동의 기반 데이터 활용 신시장을 창출하는 것이다.', { size: 20, after: 120 }),

    P('O 경영혁신활동 추진내용', { bold: true, size: 22, before: 240, after: 120 }),

    P('- (제품·서비스혁신 / 한줄로AI 상용화 기반 구축) 본 신청자는 2026.04.15까지 한줄로AI 통합 마케팅 자동화 SaaS의 상용화 기반을 구축하였다. SMS, LMS, MMS, 알림톡, 카카오 브랜드메시지, RCS 등 6대 채널 발송을 단일 플랫폼에서 통합 자동화하고, 캠페인 단위 발송·예약·집계·환불 처리를 자체 개발한 18종 컨트롤타워(CT-01~CT-18)로 표준화하였다. 12개 라인그룹 분산 발송으로 특정 고객사 캠페인 장애가 전체로 번지지 않도록 격리 구조를 확보하였으며, atomic safe-build 무중단 배포 체계로 빌드 실패 시에도 옛 dist 유지를 통해 고객사 발송 중단 리스크를 낮췄다. 2026년 5월 5일 정식 오픈은 위 기반을 시장에 구현한 후속 성과로 관리한다.', { size: 20, after: 120 }),

    P('- (비즈니스모델혁신 / POPPON CRM-Outside DB 플랫폼) 2023년 4월 MVP를 구축하고 운영 중인 POPPON 플랫폼은 실명·수신동의 기반 외부고객 데이터를 직접 축적하는 B2C 쿠폰 플랫폼이다. 제휴 브랜드 204개, 가입자 12,500명을 확보하였으며, 개인정보 비식별화 처리와 Audit Pack 처리이력 추적 체계를 갖추었다. 2026년 하반기에는 이를 B2B 데이터 이용료 상품으로 정식 상품화하여 메시지 발송 종량 과금에 치우친 수익구조를 데이터와 AI 기반 반복수익 구조로 전환할 계획이다. 본 모델은 POPPON에서 합법적으로 축적된 B2C 동의 데이터를 TargetUP-AI의 B2B 마케팅 자동화 추천 엔진에 익명·집계 형태로 결합하는 「데이터 선순환 구조」를 핵심으로 하며, 기존 메시징 SaaS 대비 진입장벽을 확보한다.', { size: 20, after: 120 }),

    P('- (디지털혁신 / TargetUP-AI 예측·추천 엔진) 30억 건 발송 로그를 학습 데이터로 활용하여 캠페인 반응률과 전환율을 개선하는 폐회로 AI 엔진을 자체 개발하였다. 세그먼트별 반응률·전환율 예측, 최적 발송시점 추천, LLM 기반 문안 추천(Claude·OpenAI 다중화), 캠페인 결과 데이터 재학습 구조를 통해 중소기업 광고주가 발송 결과를 측정하고 다음 캠페인에 반영할 수 있도록 지원한다. 또한 컨트롤타워 우선 문화, 데이터 기반 의사결정, 전수 검증 문화, 투명 보고 문화, 수평 조직 문화 등 5대 조직 원칙을 정립하여 디지털혁신을 조직 운영에 반영하고 있다.', { size: 20, after: 120 }),

    P('- (특허 자산화) 자체 출원·등록 특허 3건과 출원 중 3건을 보유하고 있다. 특허 제10-1821985호 「기업형 대량 문자 메시지 발송 서비스 방법」(2018.01), 제10-1990872호 「기업용 온라인 통합 메시징 시스템」(2019.07), 제10-2325851호 「POPPON 필터링 시스템」(2021.11)이 그것이다.', { size: 20, after: 120 }),

    P('- (연구개발 인프라 강화) 2017년 1월 창업 시점에 한국산업기술진흥협회(KOITA)에 연구개발전담부서를 등록하여 9년 연속 유효 운영 중이다. 2024년 말 임직원 4명에서 2025년 한 해 동안 3명을 신규 채용하여 2025년 말 7명(대표 제외) 체제로 1년 만에 +75% 인력 확장을 단행하였으며, 이를 통해 AI·빅데이터·마케팅 자동화 핵심 엔진의 자체 개발·운영 역량을 강화하였다. 연평균 R&D 투자 6,400만원을 집행하고 있다.', { size: 20, after: 120 }),

    P('O 경영혁신 추진에 따른 경영성과', { bold: true, size: 22, before: 240, after: 120 }),
    P('- (구조조정 후 회복 매출) 2025년 매출 128.26억원은 메시징 중계 중심 사업 구조를 정리하고 한줄로AI 및 AI SaaS 전환을 위한 R&D에 집중한 결과로 설명할 수 있다. 2026년 1분기에는 실 결제 거래처 123개사와 공급가액 41.46억원을 기록하여 구조전환 이후 매출 회복 기반을 확인하였다. 본 수치는 세금계산서·거래처 리스트·정산자료 등으로 별도 증빙하여 매출 감소에 대한 심사상 우려를 보완한다.', { size: 20, after: 120 }),
    P('- (재무 건전성 회복) 2025년 말 기준 유동비율 411.5%, 자기자본 14.31억(자본잠식 없음)으로 자체 현금창출력을 회복하였으며, 신용보증기금 적격투자기관 출자(지분 4.62%) 이력을 보유하고 있다. 2025년 신용등급 B+(NICE디앤비)를 받았다.', { size: 20, after: 120 }),
    P('- (정책금융 활용 기반) 기술보증기금 보증연계대출 18억(누계 38억) 확보로 시설 투자와 인력 확충 재원을 사전 확보하였다.', { size: 20, after: 120 }),
    P('- (시장 확장 기반) 2026.04.15 기준으로 TargetUP 운영 거래처와 한줄로AI 상용화 기반을 확보하였고, 접수 시점 이후에는 무료체험 기업과 LOI 확보를 통해 시장 검증을 진행 중이다. 기준일 이후의 무료체험 및 LOI 수치는 본 공적의 핵심 실적이 아니라 향후 확장 가능성을 보여주는 참고자료로 제시한다.', { size: 20, after: 120 }),
    P('- (성장 가능성) 중장기적으로는 TargetUP 메시지 종량 과금 중심 구조에서 TargetUP-AI 구독과 POPPON CRM-Outside 데이터 이용료 중심의 반복수익 구조로 전환한다. 2030년까지 매출 700억원, 영업이익률 22%, 신규매출 비중 80%, 직접고용 30명 신규 채용을 목표로 하되, 단계별 실행계획과 리스크 관리 방안을 별도 발표자료에서 제시한다.', { size: 20, after: 120 }),

    P('O 경영혁신 추진에 따른 파급효과', { bold: true, size: 22, before: 240, after: 120 }),
    P('- (고용 창출 — 질적 확장) 2024년 말 임직원 4명에서 2025년 말 7명(대표 제외)으로 1년 만에 3명의 딥테크 인재(AI·데이터·플랫폼 개발자)를 신규 채용하여 전년 대비 +75% 인력 확장을 실현하였다. 절대수가 아닌 질적 측면에서, 마케팅 자동화 SaaS 핵심 엔진을 자체 개발·운영할 수 있는 고숙련 인력을 한정된 자원 내에서 우선 확보한 결과이다. 2030년까지 직접고용 30명 신규 채용으로 총원 38명을 목표로 한다.', { size: 20, after: 120 }),
    P('- (간접 일자리 기여) 한줄로AI는 중소기업의 마케팅 운영, 법규 준수, 발송 정산 업무를 자동화하여 부족한 인력으로도 캠페인을 운영할 수 있도록 지원한다. 향후 도입기업 확대 시 마케팅 운영 효율 개선과 간접 일자리 유지에 기여할 수 있으며, 실제 효과는 도입기업 사례와 운영지표를 통해 지속 검증할 계획이다.', { size: 20, after: 120 }),
    P('- (산업구조 고도화) 인비토의 사업 전환은 메시지 중계 중심 구조에서 동의 기반 CRM-Outside 데이터와 AI 마케팅 인텔리전스를 결합한 SaaS 구조로 이동하는 사례이다. 국내 카카오 알림톡·브랜드메시지·RCS 등 국내 채널을 통합 운영한다는 점에서 국내 중소기업 환경에 맞는 마케팅 자동화 산업 고도화에 기여한다.', { size: 20, after: 120 }),
    P('- (고객가치 향상) 캠페인 단위 전환율·매출 기여도를 100% 추적 가능한 폐회로 구조는 마케팅 자동화 SaaS 업계 통상의 「발송 건수 과금」을 「성과 과금」으로 전환시킨다. 중소기업 광고주에게 측정 가능한 ROI를 제공함으로써 광고비의 효율성을 구조적으로 개선한다.', { size: 20, after: 120 }),
    P('- (해외 진출 기반) 2026년 하반기부터 베트남 SME와 이커머스 메시징 시장 조사를 추진하고, 2027년 Zalo OA 연동 PoC 개발, 2028년 매출화, 2030년 베트남 매출 50억원을 목표로 한다. 해외 진출은 국내 사업 안정화 이후 단계적으로 검증하며, 기술 연동·개인정보·현지 파트너 리스크를 관리한다.', { size: 20, after: 120 }),
    P('- (ESG 성과 및 투명경영) 국세·지방세 100% 완납(체납 0건), 표준재무제표 정기 신고, 주주명부 정기 갱신·공시, Audit Pack 자동 생성을 통한 마케팅 활동 법규 준수 증빙 100% 추적 체계를 운영하고 있다. R&D 인력 스톡옵션 부여와 분기 OKR 운영으로 핵심 인재 유지율 90% 이상을 목표로 한다.', { size: 20, after: 120 }),
    P('- (성과 공유 확산 / 산업 인식 개선) 본 신청자는 9년 연속 메시징 SaaS를 운영하며 「업계 통상 가격 경쟁」에서 「측정 가능한 성과 과금」으로의 패러다임 전환을 선도하고 있으며, 한줄로AI의 정식 출시를 통해 국내 마케팅 자동화 SaaS 시장에서 「Measurable Impact」라는 새로운 산업 기준을 제시하고 있다.', { size: 20, after: 240 }),

    P('* 기재 내용이 허위 또는 과장되어 사실과 다른 것으로 밝혀지는 경우 평가 대상에서 제외됨', { size: 16, before: 240 }),
  ];

  return makeDoc('공적조서', [
    ...head, tInfo, P(''), tInvest, tApproval, noteA, noteB, subCareer, tCareerRec, subAward, tPastAward, noteBody, ...meritBody
  ]);
}

// ============================================================
// 5. 공적요약서 (2026)
// ============================================================
function doc5_summary() {
  const head = [
    P('[별지서식 제1호] 5. 공적요약서', { size: 18 }),
    H('공적요약서', 32)
  ];

  const subA = P('□ 포상부문 : 경영혁신 유공', { bold: true, size: 22, before: 120, after: 120 });

  const t1 = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [800, 1700, 1500, 1200, 1300, 1300, 1946],
    rows: [
      new TableRow({ children: [
        cell('순위', { width: 800, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('소속', { width: 1700, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('직위', { width: 1500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('성명', { width: 1200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('성별', { width: 1300, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('생년월일', { width: 1300, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('재직기간 (2026.04.15 기준)', { width: 1946, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER, size: 16 })
      ]}),
      new TableRow({ children: [
        cell('1', { width: 800, align: AlignmentType.CENTER }),
        cell('주식회사 인비토', { width: 1700, align: AlignmentType.CENTER, size: 16 }),
        cell('대표이사', { width: 1500, align: AlignmentType.CENTER }),
        cell(['유 호 윤', '(柳鎬潤)'], { width: 1200, align: AlignmentType.CENTER }),
        cell('男', { width: 1300, align: AlignmentType.CENTER }),
        cell('(※ 기재)', { width: 1300, align: AlignmentType.CENTER, size: 16 }),
        cell('9년 3개월 (2017.01.16 ~ 2026.04.15)', { width: 1946, align: AlignmentType.CENTER, size: 16 })
      ]}),
    ]
  });

  const subB = P('□ 공적개요', { bold: true, size: 22, before: 360, after: 120 });

  const body = [
    P('O (주요사항) 동의 기반 CRM-Outside DB와 AI 예측·추천 엔진을 결합한 통합 마케팅 자동화 SaaS 「한줄로AI」 상용화 기반 구축 (2026.04.15까지) 및 9년 연속 메시징 SaaS 운영 (30억 건 발송로그 축적)', { bold: true, size: 22, before: 120, after: 120 }),
    P('  - (세부 내용) 2017년 1월 주식회사 인비토 창업 이래 2026.04.15까지 9년 3개월간 메시징 SaaS 운영, 발송 데이터 30억 건 축적, 동의 기반 외부고객 데이터 플랫폼 POPPON 구축(가입자 12,500명·제휴 브랜드 204개), TargetUP-AI 예측·추천 엔진 자체 개발, 연구개발전담부서 운영을 지속함. SMS·LMS·MMS·알림톡·카카오 브랜드메시지·RCS 등 6대 채널을 단일 플랫폼에서 자동화하며, 18종 컨트롤타워(CT-01~CT-18)와 atomic safe-build 무중단 배포 체계로 운영 안정성을 확보한 통합 마케팅 자동화 SaaS 상용화 기반을 완성함. 2026년 5월 5일 정식 오픈은 기준일 이전까지 축적된 기술과 운영체계를 시장에 구현한 결과로 후순위 처리함.', { size: 20, after: 120 }),
    P('    * (참고사항) 등록 특허 3건 및 출원 중 3건 보유 / 연구개발전담부서 KOITA 9년 연속 등록 / 메인비즈 인증 보유 / 신용보증기금 적격투자기관 출자 이력(2018) 보유', { size: 18, after: 240 }),

    P('O (주요사항) 「메시지 중계 → CRM-Outside + AI 마케팅 인텔리전스」 사업 구조 전환을 통한 디지털혁신 선도 및 신산업 생태계 창출', { bold: true, size: 22, before: 240, after: 120 }),
    P('  - (세부 내용) 기존 메시징 SaaS의 「기업 보유 DB로만 발송 가능」 구조적 한계와 「발송 건수 과금」 한계를 인식하고, 동의 기반 CRM-Outside DB 직접 축적과 성과 과금 모델로의 전환을 자체적으로 추진하였음. POPPON 플랫폼을 통해 실명·수신동의 외부고객 데이터를 직접 확보(204개 제휴 브랜드·12,500명)하고, 30억 건 발송로그 학습 AI 폐회로로 캠페인 가입 전환율 12.5~30%를 검증함. 이는 국내 경쟁사가 부재한 신규 카테고리로, 2030년 약 3,000억원 규모 신시장 형성이 전망됨.', { size: 20, after: 120 }),
    P('    * (참고사항) 「측정 가능한 효과(Measurable Impact)」 경영철학 정립 / 컨트롤타워 우선 문화·데이터 기반 의사결정·전수 검증·투명 보고·수평 조직의 5대 조직 원칙 운영', { size: 18, after: 240 }),

    P('O (주요사항) 구조조정 후 매출 회복 및 딥테크 인재 +75% 질적 확장을 통한 지속 가능한 고용창출 기반 구축', { bold: true, size: 22, before: 240, after: 120 }),
    P('  - (세부 내용) 2025년 매출 128.26억원은 메시징 중계 중심 사업 구조를 정리하고 한줄로AI 및 AI SaaS 전환을 위한 R&D에 집중한 결과이며, 2026년 1분기 실 결제 거래처 123개사·공급가액 41.46억원을 기록하여 구조전환 이후 매출 회복 기반을 확인함. 고용 측면에서도 2024년 말 임직원 4명에서 2025년 말 7명(대표 제외)으로 1년간 3명의 딥테크 인재(AI·데이터·플랫폼 개발자)를 신규 채용하여 +75% 질적 인력 확장을 실현하였으며, 2030년까지 직접고용 30명 신규 채용으로 총원 38명을 목표로 함. 한줄로AI는 중소기업의 마케팅 운영·법규 준수·발송 정산 업무 자동화로 인력 부족 환경에서도 캠페인 운영을 가능하게 하여 도입기업의 간접 일자리 유지에 기여할 수 있다.', { size: 20, after: 120 }),
    P('    * (참고사항) 유동비율 411.5% / 자기자본 14.31억(자본잠식 없음) / 기보 보증연계대출 18억(누계 38억) / 신용등급 B+(NICE디앤비, 2025)', { size: 18, after: 240 }),

    P('O (주요사항) 베트남·동남아 진출을 통한 국가 수출 확대 기여 계획', { bold: true, size: 22, before: 240, after: 120 }),
    P('  - (세부 내용) 외산 마케팅 자동화 솔루션(Braze, Iterable 등)이 한국 카카오 알림톡·RCS를 미지원하는 상황에서, 6채널 통합과 18종 컨트롤타워 운영 인프라를 보유한 한줄로AI는 외산 대체 효과와 동시에 동남아 수출 잠재력을 보유함. 2026년 하반기 베트남 SME·이커머스 메시징 시장 사전 조사, 2027년 Zalo OA 연동 PoC 개발, 2028년 매출화, 2030년 베트남 매출 50억원과 동남아 1위 마케팅 자동화 SaaS 위상 확보를 단계별 목표로 수립함.', { size: 20, after: 120 }),
    P('    * (참고사항) 「혁신 프리미어 1000」 수출자금 우대(수출입은행 100%) 활용 계획', { size: 18, after: 240 }),
  ];

  return makeDoc('공적요약서', [...head, subA, t1, subB, ...body]);
}

// ============================================================
// 6. 서약서
// ============================================================
function doc6_pledge() {
  return makeDoc('서약서', [
    P('[별지서식 제1호] 6. 서약서', { size: 18 }),
    H('서  약  서', 36),
    P('', { before: 360 }),
    P('본인은 2026년도 중소기업 혁신유공자에 대한 정부포상을 신청함에 있어서 정부포상업무지침상의 추천제한 사유에 해당하거나, 여타의 정부포상에 중복 신청하였을 경우에 포상대상자에서 제외되는 것에 대하여 이의를 제기하지 않을 것을 서약합니다.',
      { size: 22, after: 360, line: 400, before: 240 }),
    P('', { before: 720 }),
    P('2026.       .       .', { align: AlignmentType.RIGHT, before: 360, after: 360 }),
    P('', { before: 240 }),
    P('소속 :  주식회사 인비토', { align: AlignmentType.RIGHT, size: 22, after: 120 }),
    P('직위 :  대표이사', { align: AlignmentType.RIGHT, size: 22, after: 120 }),
    P('성명 :  유  호  윤              (서명 또는 인)', { align: AlignmentType.RIGHT, size: 22, after: 360 }),
    P('', { before: 720 }),
    P('중소벤처기업부장관 귀하', { align: AlignmentType.CENTER, bold: true, size: 24, before: 480 })
  ]);
}

// ============================================================
// 7. 정부포상 동의서 + 개인정보 동의서
// ============================================================
function doc7_consent() {
  const head = [
    P('[별지서식 제1호] 7. 정부포상에 대한 동의서 및 개인정보 수집·이용 동의서', { size: 18 }),
    H('정부포상에 대한 동의서', 30),
    P('(정부포상 후보자용)', { align: AlignmentType.CENTER, size: 20, after: 240 })
  ];

  const t1 = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2200, 2800, 2200, 2546],
    rows: [
      new TableRow({ children: [
        cell('성명', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('유 호 윤', { width: 2800, align: AlignmentType.CENTER }),
        cell('직위(급)', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('대표이사', { width: 2546, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('소속(주소)', { width: 2200, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('주식회사 인비토', { width: 7546, colspan: 3, align: AlignmentType.CENTER })
      ]}),
    ]
  });

  const body1 = [
    P('', { before: 240 }),
    P('위 본인은 정부포상 후보자로 추천되는 것에 대하여 동의하며, 다음 사항을 엄숙히 서약합니다.', { size: 22, before: 120, after: 240, line: 360 }),
    P('1. 본인은 정부포상업무지침의 추천제한 사유에 해당되지 않음을 충분히 확인하였으며, 향후 이에 해당되는 사실이 밝혀지는 경우 포상의 취소 등 정부포상과 관련한 어떠한 불이익도 감수하겠습니다.',
      { size: 22, after: 240, line: 360 }),
    P('※ 특히, 아래의 「신고의무 사항」을 알면서도 미신고하여 정부포상이 수여된 경우 「상훈법」 제8조 제1호의 「서훈 공적이 거짓으로 밝혀진 경우」에 해당하는 것으로 하여 취소될 수 있음',
      { size: 18, after: 240 }),
    P('▪ 신고의무 사항', { bold: true, size: 22, after: 120 }),
    P('O 경찰·검찰의 조사(수사)를 받게 된 경우', { size: 20, after: 60 }),
    P('O 형사사건으로 기소된 경우', { size: 20, after: 60 }),
    P('O 감사원 또는 감사부서의 조사를 받게 된 경우', { size: 20, after: 60 }),
    P('O 징계 또는 불문경고 처분을 받은 경우 (공무원만 해당)', { size: 20, after: 240 }),
    P('O 당해 연도 타 포상 중복 지원 여부', { size: 20, after: 240 }),
    P('2. 정부포상 추천기관의 공적심사 등 법령절차에 따라 정부포상 대상자 및 훈격이 결정될 경우 이에 대하여 어떠한 이의도 제기하지 않고 따르겠습니다.',
      { size: 22, after: 240, line: 360 }),
    P('', { before: 360 }),
    P('2026.       .       .', { align: AlignmentType.CENTER, before: 240, after: 240 }),
    P('성명 :  유 호 윤      (서명)', { align: AlignmentType.CENTER, size: 22, after: 360 }),
    P('중소벤처기업부 귀중', { align: AlignmentType.CENTER, bold: true, size: 22, before: 240 }),
  ];

  const head2 = [
    new Paragraph({ children: [new PageBreak()] }),
    H('정부포상을 위한 개인정보 수집·이용 및 제3자 제공 동의서', 24),
    P('중소벤처기업부(상훈법 제5조 제1항에 따른 추천기관)에서는 정부포상 업무 수행을 위해 아래와 같이 개인정보를 수집·이용하고, 제3자에게 제공하고자 합니다. 내용을 자세히 확인하신 후 동의 여부를 결정하여 주시기 바랍니다 (관련 법령 : 「개인정보보호법」 제15조 제2항, 제17조 제2항).',
      { size: 20, after: 240, line: 360 })
  ];

  const sub1 = P('□ 개인정보의 수집·이용 내역', { bold: true, size: 22, before: 120, after: 120 });
  const t2 = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [3500, 3000, 3246],
    rows: [
      new TableRow({ children: [
        cell('항목', { width: 3500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('수집·이용 목적', { width: 3000, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('보유·이용기간', { width: 3246, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('성명, 군번(군인), 국적(외국인), 주소, 소속, 직업, 직위, 직급·계급, 공적요지, 공적내용, 공적기간, 주요경력, 과거 포상기록',
          { width: 3500, size: 18 }),
        cell('정부포상 추천 및 공적심사에 관한 사무', { width: 3000, size: 18 }),
        cell(['· 공적조서 및 의결서 : 준영구', '· 추천서 및 동의서 : 5년', '· 그 밖의 증명서류 : 1년'], { width: 3246, size: 18 })
      ]}),
    ]
  });
  const choice1 = P('☞ 위와 같이 개인정보를 수집·이용하는데 동의하십니까?         ☑ 동의      □ 미동의', { size: 22, after: 240, bold: true });

  const sub2 = P('□ 고유식별정보의 수집·이용 내역', { bold: true, size: 22, before: 240, after: 120 });
  const t3 = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [3500, 3000, 3246],
    rows: [
      new TableRow({ children: [
        cell('항목', { width: 3500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('수집·이용 목적', { width: 3000, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('보유·이용기간', { width: 3246, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('주민등록번호, 외국인등록번호', { width: 3500, size: 18 }),
        cell(['정부포상 추천 및 공적심사에 관한 사무', '※ 근거 : 「상훈법 시행령」 제33조'], { width: 3000, size: 18 }),
        cell(['· 공적조서 및 의결서 : 준영구', '· 추천서 및 동의서 : 5년', '· 그 밖의 증명서류 : 1년'], { width: 3246, size: 18 })
      ]}),
    ]
  });
  const choice2 = P('☞ 위와 같이 고유식별정보를 처리하는데 동의하십니까?         ☑ 동의      □ 미동의', { size: 22, after: 240, bold: true });

  const sub3 = P('□ 개인정보 제3자 제공 내역', { bold: true, size: 22, before: 240, after: 120 });
  const t4 = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2700, 2700, 2400, 1946],
    rows: [
      new TableRow({ children: [
        cell('항목', { width: 2700, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('제공받는 자', { width: 2700, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('제공 목적', { width: 2400, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('보유·이용기간', { width: 1946, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('성명, 주민등록번호, 외국인등록번호, 군번, 국적, 주소, 소속, 직업, 직위, 직급·계급, 공적요지, 공적내용, 공적기간, 주요경력, 과거 포상기록',
          { width: 2700, size: 16 }),
        cell('행정안전부', { width: 2700, size: 18, align: AlignmentType.CENTER }),
        cell('정부포상 결정, 기록부 작성·관리, 취소 및 환수, 재교부 및 수여증명서 발급', { width: 2400, size: 18 }),
        cell('기록부 : 영구', { width: 1946, size: 18, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('성명, 주민등록번호, 외국인등록번호, 주소, 소속, 직업, 직위', { width: 2700, size: 16 }),
        cell('경찰청, 고용노동부, 공정거래위원회, 행정안전부 (행정정보 공동이용)', { width: 2700, size: 16, align: AlignmentType.CENTER }),
        cell('추천제한 사유 확인', { width: 2400, size: 18, align: AlignmentType.CENTER }),
        cell('제공받는 자가 지정한 보존기간', { width: 1946, size: 18, align: AlignmentType.CENTER })
      ]}),
    ]
  });
  const choice3 = P('☞ 위와 같이 개인정보를 제3자에게 제공하는데 동의하십니까?         ☑ 동의      □ 미동의', { size: 22, after: 360, bold: true });

  const closing2 = [
    P('', { before: 240 }),
    P('2026.       .       .', { align: AlignmentType.CENTER, before: 120, after: 240 }),
    P('성명 :  유 호 윤      (서명 또는 인)', { align: AlignmentType.CENTER, size: 22, after: 360 }),
    P('중소벤처기업부 귀중', { align: AlignmentType.CENTER, bold: true, size: 22, before: 240 }),
  ];

  return makeDoc('정부포상 동의서 및 개인정보 동의서', [
    ...head, t1, ...body1, ...head2, sub1, t2, choice1, sub2, t3, choice2, sub3, t4, choice3, ...closing2
  ]);
}

// ============================================================
// 8. 발표심사 코칭 자료 (별지서식 외 — Harold님 대면 발표 준비용)
// ============================================================
function doc8_presentation_coaching() {
  const head = [
    P('[발표심사 코칭 자료] — Harold님 대면 발표 준비용', { size: 18, bold: true }),
    H('2026 중소기업 혁신유공자 포상 (경영혁신) — 발표심사 코칭', 28),
    P('※ 별지서식 외 자료. 1차 서류심사 통과 후 3차 발표심사(40% 비중) 대면 5분 피치 + Q&A 준비용', { size: 16, italics: true, after: 360 })
  ];

  const sub1 = P('1. 발표심사 기본 구조 (별지서식 제5호)', { bold: true, size: 24, before: 120, after: 120 });
  const note1 = P('총점 80점 / 4개 평가 항목 / 5단계 척도 (매우낮음~매우높음) / 종합순위 = 서류 40% + 현장 20% + 발표 40%', { size: 20, after: 240 });

  const tStruct = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [3500, 4746, 1500],
    rows: [
      new TableRow({ children: [
        cell('평가 항목', { width: 3500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('평가 기준', { width: 4746, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER }),
        cell('배점', { width: 1500, shading: 'E8E8E8', bold: true, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('국가·사회적 기여 및 파급효과', { width: 3500, bold: true }),
        cell('국민·사회 문제 해결 기여도 / 경제·사회적 성과 창출의 파급력 / 산업 생태계 활성화 기여 가능성', { width: 4746, size: 18 }),
        cell('20점', { width: 1500, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('혁신 모델의 전략성 및 경쟁우위', { width: 3500, bold: true }),
        cell('현재 사업모델의 차별성·완성도 / 산업(기술/시장) 선도 여부 / 경쟁 우위의 지속 가능성', { width: 4746, size: 18 }),
        cell('25점', { width: 1500, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('미래 성장전략 및 확장성', { width: 3500, bold: true }),
        cell('중장기 성장전략·계획의 구체성 / 혁신 단계별 실행계획 및 로드맵 / 사업 확장 및 신시장 진출 전략 / 변화 대응 및 리스크 관리 전략', { width: 4746, size: 18 }),
        cell('15점', { width: 1500, align: AlignmentType.CENTER })
      ]}),
      new TableRow({ children: [
        cell('전략적 리더십 및 실행역량', { width: 3500, bold: true }),
        cell('혁신 추진 방향 및 목표의 명확성 / 혁신 실행 의지 및 추진력 / 조직·인력·자원 확보 및 관리 역량 / 조직 내 혁신문화 조성 수준', { width: 4746, size: 18 }),
        cell('20점', { width: 1500, align: AlignmentType.CENTER })
      ]})
    ]
  });

  const sub2 = P('2. 5분 피치 핵심 메시지 (우선순위 순)', { bold: true, size: 24, before: 360, after: 120 });
  const note2 = P('※ 발표 시 슬라이드 메시지 또는 발표 스크립트 도입부로 사용. 각 메시지는 단호하고 짧게.', { size: 16, italics: true, after: 180 });

  const pitch = [
    P('① 단순 문자발송 대행사가 아니다 — 우리는 동의 기반 외부고객 데이터와 AI 예측·추천을 결합한 마케팅 자동화 SaaS 기업이다.', { size: 22, bold: true, after: 60 }),
    P('   → 「메시지 중계」가 아닌 「AI 마케팅 인텔리전스 인프라」로 카테고리 격상', { size: 18, after: 180 }),

    P('② 9년간 축적한 30억 건 발송 로그와 자체 운영 인프라가 한줄로AI의 진입장벽이다.', { size: 22, bold: true, after: 60 }),
    P('   → 타사가 범용 AI API를 가져다 쓸 때 우리는 자체 도메인 데이터로 모방 불가한 해자 구축', { size: 18, after: 180 }),

    P('③ 기존 중소기업은 보유 DB에만 의존해 신규 고객 확장이 어려웠으나, POPPON의 명시적 동의 기반 외부고객 데이터로 「CRM-Outside」 시장을 열었다.', { size: 22, bold: true, after: 60 }),
    P('   → 국내 경쟁사 부재의 신규 카테고리 선점자', { size: 18, after: 180 }),

    P('④ 2025년 매출 감소는 중계 중심 구조를 AI SaaS로 전환하기 위한 의도적 체질개선이며, 2026년 1분기 공급가액 41.46억원으로 회복을 확인했다.', { size: 22, bold: true, after: 60 }),
    P('   → 「실패한 매출」이 아닌 「전략적 피봇팅의 결과」 → V자 반등으로 입증', { size: 18, after: 180 }),

    P('⑤ 향후 TargetUP 종량매출 의존도를 낮추고 AI 구독·데이터 이용료 중심의 반복수익 구조로 전환하여 2030년 매출 700억원을 목표로 한다.', { size: 22, bold: true, after: 60 }),
    P('   → 단기 위기 극복 + 장기 비전 명확화', { size: 18, after: 360 })
  ];

  const sub3 = P('3. 예상 질의응답 (Q&A 5개)', { bold: true, size: 24, before: 240, after: 120 });
  const qaNote = P('※ 심사위원이 가장 많이 묻는 5개 영역 — 답변은 30초 이내, 단호·간결·수치 우선.', { size: 16, italics: true, after: 180 });

  const qa = [
    P('Q1. 2025년에 매출이 감소했는데 혁신 성과라고 볼 수 있습니까?', { bold: true, size: 22, before: 60, after: 60 }),
    P('A. 2025년 감소는 메시징 중계 중심 수익을 정리하고 한줄로AI·TargetUP-AI·POPPON 기반의 고부가 SaaS 구조로 전환하기 위한 의도적 체질개선입니다. 동시에 2024년 말 4명에서 2025년 말 7명으로 핵심 딥테크 인력을 늘렸고, 2026년 1분기 123개 거래처와 공급가액 41.46억원으로 회복세를 확인했습니다. 단순 매출 감소가 아닌 사업구조 피봇팅의 자연스러운 과정입니다.', { size: 20, after: 240 }),

    P('Q2. 2026년 5월 5일 출시라면 공적기간(~2026.04.15) 이후 성과 아닌가요?', { bold: true, size: 22, before: 60, after: 60 }),
    P('A. 공적의 중심은 2026.04.15 이전까지 구축한 30억 건 로그, 6채널 발송 인프라, POPPON 동의 데이터, AI 예측·추천 엔진, 연구개발전담부서 운영입니다. 5월 5일 정식 오픈은 그 기반을 시장에 구현한 결과로 설명드리는 것이며, 실제 신청서의 모든 공적사항은 기준일 이전 성과를 중심으로 작성되어 있습니다.', { size: 20, after: 240 }),

    P('Q3. POPPON 데이터 활용은 개인정보 이슈가 없습니까?', { bold: true, size: 22, before: 60, after: 60 }),
    P('A. POPPON은 실명·수신동의 기반으로 가입자를 확보하고, 비식별화 처리와 Audit Pack 처리이력 추적 체계를 운영합니다. 고객사 캠페인도 동의·발송·환불·정산·법규 준수 이력을 18종 컨트롤타워로 관리하여 준법 리스크를 구조적으로 낮추고 있습니다. POPPON에서 축적된 B2C 동의 데이터를 TargetUP-AI의 B2B 추천 엔진에 익명·집계 형태로 결합하는 데이터 선순환 구조가 핵심입니다.', { size: 20, after: 240 }),

    P('Q4. 경쟁사 대비 무엇이 다릅니까?', { bold: true, size: 22, before: 60, after: 60 }),
    P('A. 기존 메시징 SaaS는 고객사가 보유한 DB로만 발송하는 구조가 일반적입니다. 인비토는 POPPON으로 명시적 동의 기반 외부고객 접점을 확보하고, 30억 건 로그 기반 AI로 발송시점·문안·반응률을 예측하며, 국내 카카오 알림톡·브랜드메시지·RCS까지 통합 운영합니다. 외산 솔루션(Braze, Iterable 등)이 한국 카카오 채널을 미지원하는 구조적 공백을 정확히 공략하는 국산 대체 모델입니다.', { size: 20, after: 240 }),

    P('Q5. 장기 성장전략은 현실적입니까?', { bold: true, size: 22, before: 60, after: 60 }),
    P('A. 단기적으로는 2026년 한줄로AI 정식 운영과 거래처 전환율을 높이고, 중기적으로는 TargetUP-AI 구독과 POPPON 데이터 이용료를 상품화해 반복수익 비중을 높이겠습니다. 해외는 베트남 Zalo OA 연동 PoC부터 단계적으로 검증해 리스크를 통제하겠습니다. 자체 보유 현금 5억 + 기보 보증연계대출 18억(누계 38억)으로 향후 3년 투자 재원을 사전 확보한 상태입니다.', { size: 20, after: 360 })
  ];

  const sub4 = P('4. 발표 직전 체크리스트 (당일 아침 확인)', { bold: true, size: 24, before: 240, after: 120 });
  const checklist = [
    P('☐ 발표 자료(슬라이드) 인쇄본 2부 + USB 백업 (현장 PC 호환 안 될 가능성 대비)', { size: 20, after: 60 }),
    P('☐ 공적조서·공적요약서 사본 1부 (질문 시 페이지 즉시 참조용)', { size: 20, after: 60 }),
    P('☐ 2026년 1분기 매출 증빙 자료(세금계산서·정산자료) 즉시 보여줄 수 있도록 태블릿 또는 노트북에 미리 띄움', { size: 20, after: 60 }),
    P('☐ 특허 등록증 3건 + 출원통지서 3건 사본 1부', { size: 20, after: 60 }),
    P('☐ 메인비즈 확인서 + KOITA 연구개발전담부서 인정서 사본', { size: 20, after: 60 }),
    P('☐ 5분 피치 메시지 5개 외워서 (자료 안 보고 말할 수 있을 정도)', { size: 20, after: 60 }),
    P('☐ Q&A 5개 답변 외워서 (수치는 정확히 — 41.46억 / 123개사 / 30억 건 / 12,500명 / 204개 브랜드 / +75% 고용)', { size: 20, after: 60 }),
    P('☐ 발표 복장: 정장 (마트 사장 톤 X, 「측정 가능한 효과」 경영자 톤 ○)', { size: 20, after: 60 }),
    P('☐ 도착 시각: 발표 30분 전 도착, 화장실·물 미리 준비', { size: 20, after: 240 })
  ];

  const sub5 = P('5. 발표 시 절대 하지 말아야 할 표현 5가지', { bold: true, size: 24, before: 240, after: 120 });
  const avoid = [
    P('× "2026년 5월 5일 정식 출시했습니다" (단독 강조 금지 — 기준일 이후 표현)', { size: 20, after: 60 }),
    P('× "외산 솔루션을 100% 대체합니다" (과장 표현 — 「한국 카카오 채널 환경에서 외산이 못 다루는 영역을 보완합니다」로)', { size: 20, after: 60 }),
    P('× "국내 1위입니다" (출처 없는 1위 표현 — 「국내 경쟁사가 부재한 신규 카테고리 선도자」로)', { size: 20, after: 60 }),
    P('× "매출이 떨어졌지만…" (변명 톤 금지 — 「전략적 사업구조 재편의 결과이며 2026 1Q V자 회복」으로 정면 돌파)', { size: 20, after: 60 }),
    P('× "AI가 다 알아서 해줍니다" (과대 광고 톤 — 「30억 건 학습 데이터 기반 검증된 AI 폐회로」로 정량 우선)', { size: 20, after: 240 })
  ];

  return makeDoc('발표심사 코칭', [
    ...head, sub1, note1, tStruct, sub2, note2, ...pitch, sub3, qaNote, ...qa, sub4, ...checklist, sub5, ...avoid
  ]);
}

// ============================================================
// Generate all (2026 양식 — 7종)
// ============================================================
(async () => {
  // 기존 6종 파일 제거 (구식)
  const oldFiles = [
    '1_유공자_포상신청서.docx', '2_회사_일반현황.docx', '3_공적조서.docx',
    '4_공적요약서.docx', '5_서약서.docx', '6_정부포상_및_개인정보_동의서.docx'
  ];
  oldFiles.forEach(f => {
    const p = path.join(OUT_DIR, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  await save('1_유공자_포상신청서.docx', doc1_application());
  await save('2_신청자_정보.docx', doc2_applicant_info());
  await save('3_회사_일반현황.docx', doc3_company());
  await save('4_공적조서.docx', doc4_merit_record());
  await save('5_공적요약서.docx', doc5_summary());
  await save('6_서약서.docx', doc6_pledge());
  await save('7_정부포상_및_개인정보_동의서.docx', doc7_consent());
  await save('8_발표심사_코칭자료.docx', doc8_presentation_coaching());
  console.log('\n✓ 2026 양식 7종 + 발표심사 코칭자료 1종 = 총 8종 생성 완료');
})().catch(e => { console.error(e); process.exit(1); });
