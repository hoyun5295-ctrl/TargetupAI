/* SyncAgent 사전 질의서 v1.0 빌드 스크립트 — SoT = PREINSTALL-QUESTIONNAIRE.md §1 (여기와 1:1 유지)
 * 사용: node build-questionnaire.js [출력경로.docx]
 *
 * 양식 규격 (★2026-08-13 Harold — "고객사에서 입력하기 편하게"):
 *   질문마다 [질문+예시] 줄 아래 **전폭 답변 기입란**(넉넉한 높이). 선택형은 ☐ 체크박스를 미리 깔아
 *   체크만 하면 되게 한다. 서술형은 빈 칸. §2 내부 처리표는 고객 전달본에 넣지 않는다. */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber, HeightRule,
} = require('C:/Users/ceo/AppData/Local/Temp/docx-build/node_modules/docx');
const fs = require('fs');

const FONT = 'Malgun Gothic';
const border = { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' };
const allBorders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
const FULL = 9360; // 표 전폭(DXA)

const p = (text, opts = {}) => new Paragraph({
  spacing: opts.spacing || { after: 100 },
  alignment: opts.align,
  keepLines: opts.keepLines,   // 경고문 등 한 덩어리 문단이 페이지 경계에서 갈라지지 않게
  children: [new TextRun({ text, font: FONT, size: opts.size || 22, bold: opts.bold, color: opts.color, italics: opts.italics })],
});
const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 },
  children: [new TextRun({ text, bold: true, font: FONT, size: 28, color: '047857' })],
});

/**
 * 질문 1건 = 2행 — ①질문(굵게)+예시(회색) ②전폭 답변 기입란.
 * answer: { options: ['한국어판','영문판'] } → "☐ 한국어판   ☐ 영문판" 체크형
 *         { blank: true } → 빈 기입란 / { prefix: '...' } → 안내 접두 + 기입란
 */
function questionRows(no, question, example, answer = { blank: true }) {
  const qCell = new TableCell({
    width: { size: 6200, type: WidthType.DXA },
    shading: { fill: 'F9FAFB', type: ShadingType.CLEAR },
    margins: { top: 90, bottom: 90, left: 140, right: 140 },
    children: [new Paragraph({
      children: [
        new TextRun({ text: `${no}. `, bold: true, font: FONT, size: 21, color: '047857' }),
        new TextRun({ text: question, bold: true, font: FONT, size: 21 }),
      ],
    })],
  });
  const exCell = new TableCell({
    width: { size: FULL - 6200, type: WidthType.DXA },
    shading: { fill: 'F9FAFB', type: ShadingType.CLEAR },
    margins: { top: 90, bottom: 90, left: 140, right: 140 },
    children: [new Paragraph({
      children: [new TextRun({ text: example ? `예: ${example}` : '', font: FONT, size: 19, color: '9CA3AF' })],
    })],
  });

  const answerChildren = [];
  if (answer.options) {
    answerChildren.push(new Paragraph({
      spacing: { after: 0 },
      children: answer.options.map((opt, i) => new TextRun({
        text: `${i > 0 ? '      ' : ''}☐  ${opt}`, font: FONT, size: 22,
      })),
    }));
    if (answer.extra) {
      answerChildren.push(new Paragraph({
        spacing: { before: 80, after: 0 },
        children: [new TextRun({ text: answer.extra, font: FONT, size: 20, color: '6B7280' })],
      }));
    }
  } else {
    answerChildren.push(new Paragraph({
      spacing: { after: 0 },
      children: [new TextRun({ text: answer.prefix || '답변: ', font: FONT, size: 20, color: '6B7280' })],
    }));
  }
  const aRow = new TableRow({
    height: { value: answer.options ? 460 : 640, rule: HeightRule.ATLEAST },
    children: [new TableCell({
      columnSpan: 2,
      width: { size: FULL, type: WidthType.DXA },
      margins: { top: 110, bottom: 110, left: 140, right: 140 },
      children: answerChildren,
    })],
  });
  return [new TableRow({ children: [qCell, exCell] }), aRow];
}

function qTable(items) {
  return new Table({
    width: { size: FULL, type: WidthType.DXA },
    columnWidths: [6200, FULL - 6200],
    borders: allBorders,
    rows: items.flatMap((it) => questionRows(it.no, it.q, it.ex, it.a)),
  });
}

const children = [];

children.push(p('Sync Agent 설치 사전 질의서', { size: 40, bold: true, color: '047857', spacing: { after: 60 } }));
children.push(p('한줄로 데이터 동기화 에이전트 · v1.0', { size: 22, color: '6B7280', spacing: { after: 160 } }));
children.push(p('설치 전에 아래 내용을 회신해 주시면, 고객사 환경과 동일한 구성으로 저희가 먼저 설치 전 과정을 검증한 뒤 설치 파일을 전달드립니다. 해당하는 항목에 체크(☑)하시고, 기입란은 아는 범위까지만 적어 주셔도 됩니다.', { spacing: { after: 200 } }));

children.push(h1('1. 에이전트를 설치할 서버'));
children.push(qTable([
  { no: '1-1', q: '운영체제와 정확한 버전', ex: 'Windows Server 2016 Datacenter x64' },
  { no: '1-2', q: '운영체제 언어', a: { options: ['한국어판', '영문판', '기타'] } },
  { no: '1-3', q: '이 서버에서 인터넷(HTTPS, 443 포트) 접속이 가능합니까', a: { options: ['가능', '방화벽 신청 필요'] } },
  { no: '1-4', q: '관리자 권한으로 설치를 진행할 수 있습니까', a: { options: ['가능', '불가(별도 협의 필요)'] } },
]));

children.push(h1('2. 연동할 데이터베이스'));
children.push(qTable([
  { no: '2-1', q: 'DB 종류와 정확한 버전', ex: 'MySQL 8.0 / Aurora MySQL 3.x / MSSQL 2016 / Oracle 11g' },
  { no: '2-2', q: '클라우드 DB입니까 (AWS RDS·Aurora, Azure 등)', a: { options: ['예', '아니오 — 사내 서버'], extra: '예인 경우 서비스명: ' } },
  { no: '2-3', q: '암호화(TLS) 연결이 강제되어 있습니까', a: { options: ['예', '아니오', '모름'] } },
  { no: '2-4', q: '에이전트 설치 서버에서 DB 호스트·포트로 접속이 열려 있습니까', a: { options: ['예', '방화벽 신청 필요'] } },
]));

children.push(h1('3. 고객·구매 데이터 구성 (가장 중요합니다)'));
children.push(qTable([
  { no: '3-1', q: '고객(회원) 데이터의 위치 — DB(스키마)명과 이름, 테이블/뷰 구분', ex: 'antsnd.member_view — 뷰', a: { prefix: '위치·이름:                                                          ☐ 테이블   ☐ 뷰' } },
  { no: '3-2', q: '구매(주문) 데이터의 위치 — DB(스키마)명과 이름, 테이블/뷰 구분', ex: 'antsnd.order_view — 뷰', a: { prefix: '위치·이름:                                                          ☐ 테이블   ☐ 뷰' } },
  { no: '3-3', q: '원본이 접속 DB와 다른 DB에 있어 뷰로 모아 노출하는 구성입니까', a: { options: ['예', '아니오'] } },
  { no: '3-4', q: '대략 몇 행입니까', ex: '고객 약 30만 · 주문 약 500만', a: { prefix: '고객 약           만 건  /  구매 약           만 건' } },
  { no: '3-5', q: '한 행을 고유하게 식별하는 컬럼', ex: '고객 = 회원번호 / 주문 = 주문번호+항목순번', a: { prefix: '고객:                              /  구매:' } },
  { no: '3-6', q: '등록·수정 일시 컬럼의 이름과, 값에 시각(시:분)까지 있는지', ex: 'upd_dt — 시각 포함 / 판매일 — 날짜만', a: { prefix: '고객:                 ☐ 시각 포함 ☐ 날짜만   /  구매:                 ☐ 시각 포함 ☐ 날짜만' } },
]));
children.push(p('※ 뷰로 연동하시는 경우, 3-5의 고유 식별 컬럼이 뷰에 반드시 포함되어야 변경분 자동 반영이 동작합니다.', { size: 20, color: 'B45309', spacing: { before: 100, after: 160 }, keepLines: true }));

children.push(h1('4. 접속 계정'));
children.push(qTable([
  { no: '4-1', q: '에이전트용 읽기 전용 계정명 (신규 생성 권장)', ex: 'sync_reader' },
  { no: '4-2', q: 'SELECT 권한 부여 대상', a: { options: ['3-1·3-2의 테이블(뷰) 2개', '기타(아래 기입)'] } },
  { no: '4-3', q: '계정의 접속 허용 호스트', a: { options: ['에이전트 서버 IP 지정', '내부망 전체'] } },
]));

children.push(h1('5. 담당자·일정'));
children.push(qTable([
  { no: '5-1', q: '설치 진행 담당자 성함 · 연락처 · 이메일', a: { prefix: '성함:                    연락처:                        이메일:' } },
  { no: '5-2', q: '희망 설치 일정' },
]));

children.push(p('회신 주신 구성 그대로 저희 쪽에서 설치 전 과정을 재현·검증한 뒤 설치 파일을 전달드립니다. 감사합니다.', { spacing: { before: 220 }, italics: true, color: '6B7280' }));

const doc = new Document({
  title: 'Sync Agent 설치 사전 질의서 v1.0',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  sections: [{
    headers: { default: new Header({ children: [p('INVITO — 한줄로 Sync Agent', { size: 16, color: '9CA3AF', spacing: { after: 0 } })] }) },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '9CA3AF' })],
        })],
      }),
    },
    children,
  }],
});

const outPath = process.argv[2] || 'SyncAgent_사전질의서_v1_0.docx';
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('OK', outPath, buf.length, 'bytes');
});
