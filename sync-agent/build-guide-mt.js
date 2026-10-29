/* 엠티콜렉션(메트로시티) 전용 Sync Agent v1.7.5 설치 안내서 빌드 스크립트 (2026-10-29 · 1.7.4 · 1.7.3 판 2026-10-28 · 1.7.2 판 2026-10-15 를 갱신)
 * 1.7.4 = 1.7.3 + 실린 Node 24.22.1 · 설치 마법사 이 PC 전용(설계서 docs/2026-10-29-sync-agent-node24-wizard-loopback-design.md) · 고객 문장 변화 0(판 번호 · zip 만)
 * 1.7.5 = 1.7.4 + 오라클 · PG 날짜 타입 컬럼 하루 밀림 수정(엠티 VM 재검증에서 발견 · 같은 설계서 §9) · 고객 문장 변화 0(판 번호 · zip 만)
 * 실행: node build-guide-mt.js <출력.docx> <전달 zip 경로>   (docx 모듈 위치는 DOCX_MODULE 로 바꿀 수 있다)
 * 고객에게는 Word 로 변환한 PDF 만 준다(docx 는 우리 쪽 원본). 모양은 build-manual.js 와 같다.
 * 값의 근거 = 엠티 사전 질의서 1028 회신(고객 뷰 27컬럼 · 판매 뷰 6컬럼 · 일시 컬럼 없음 · YN_WITHDRAW='탈퇴' · YN_SMS 수신/미수신)
 *            + ERP 연동 컬럼 정리표(23컬럼) + 설계서 docs/2026-10-28-sync-value-check-summary-guard-design.md(값 확인 · 1.7.3).
 * zip 해시 · 크기는 손으로 적지 않고 넘긴 zip 에서 계산한다(옛 판은 상수였다 · 재빌드 때 낡은 값이 남을 수 있었다).
 * ⛔ 고객에게 나가는 문장에 가운뎃점(·) · 줄표 금지(memory feedback_no_middle_dot_in_outward_copy · feedback_no_em_dash_in_copy) — 이 파일 맨 아래 검사가 막는다.
 * ⛔ 1.7.5 VM 재검증 전에는 이 안내서를 고객에게 보내지 않는다(배포 원장 카드 · 전달 = Harold).
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
} = require(process.env.DOCX_MODULE || 'C:/Users/ceo/projects/poppon-workspace/node_modules/docx');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '1.7.5';
const outPath = process.argv[2];
const zipPath = process.argv[3];
if (!outPath || !zipPath) { console.error('사용: node build-guide-mt.js <출력.docx> <전달 zip 경로>'); process.exit(1); }
const ZIP_NAME = path.basename(zipPath);
const zipBuf = fs.readFileSync(zipPath);
const ZIP_SHA256 = crypto.createHash('sha256').update(zipBuf).digest('hex');
const ZIP_BYTES = zipBuf.length.toLocaleString('en-US');

const FONT = 'Malgun Gothic';
const MONO = 'Consolas';

const border = { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' };
const allBorders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

// 고객에게 나가는 글자는 모두 이 배열을 지난다(맨 아래 가운뎃점 · 줄표 검사)
const OUTWARD_TEXTS = [];
const t = (s) => { OUTWARD_TEXTS.push(s); return s; };

function p(text, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.LEFT,
    spacing: opts.spacing || { after: 80 },
    children: [new TextRun({ text: t(text), font: FONT, size: opts.size || 22, bold: opts.bold, color: opts.color })],
  });
}
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text: t(text), bold: true, font: FONT, size: 32, color: '047857' })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text: t(text), bold: true, font: FONT, size: 26, color: '1F2937' })],
  });
}
function numbered(text) {
  return new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text: t(text), font: FONT, size: 22 })],
  });
}
function code(text) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    shading: { fill: 'F3F4F6', type: ShadingType.CLEAR },
    children: [new TextRun({ text: t(text), font: MONO, size: 18 })],
  });
}
function box(emoji, label, text, color, borderColor) {
  const b = { style: BorderStyle.SINGLE, size: 4, color: borderColor };
  return new Table({
    width: { size: 9026, type: WidthType.DXA },
    columnWidths: [9026],
    borders: { top: b, bottom: b, left: b, right: b },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 9026, type: WidthType.DXA },
        shading: { fill: color, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 200, right: 200 },
        children: [new Paragraph({
          spacing: { after: 0 },
          children: [
            new TextRun({ text: `${emoji} `, font: FONT, size: 22 }),
            new TextRun({ text: t(label), bold: true, font: FONT, size: 22 }),
            new TextRun({ text: ` ${t(text)}`, font: FONT, size: 22 }),
          ],
        })],
      })],
    })],
  });
}
function warn(text) { return box('⚠️', '주의.', text, 'FFFBEB', 'FCD34D'); }
function info(text) { return box('ℹ️', '안내.', text, 'EFF6FF', '93C5FD'); }
function gap() { return new Paragraph({ spacing: { after: 80 }, children: [] }); }

function table(headers, rows, widths) {
  const cellMargin = { top: 80, bottom: 80, left: 120, right: 120 };
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const cell = (text, i, head) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    shading: head ? { fill: 'F3F4F6', type: ShadingType.CLEAR } : undefined,
    margins: cellMargin,
    children: [new Paragraph({ children: [new TextRun({ text: t(text), bold: head, font: FONT, size: 20 })] })],
  });
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: widths,
    borders: allBorders,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((row) => new TableRow({ children: row.map((c, i) => cell(c, i, false)) })),
    ],
  });
}

const children = [];

// ─── 표지 ───────────────────────────────────────────────
children.push(new Paragraph({ spacing: { before: 1200 }, children: [] }));
children.push(p('Sync Agent', { align: AlignmentType.CENTER, size: 56, bold: true, color: '047857', spacing: { after: 240 } }));
children.push(p('설치 안내서', { align: AlignmentType.CENTER, size: 36, bold: true, spacing: { after: 120 } }));
children.push(p('엠티콜렉션 전용, Windows Server 2016 + Oracle 11g', { align: AlignmentType.CENTER, size: 24, color: '6B7280', spacing: { after: 80 } }));
children.push(p('한줄로 데이터 동기화 에이전트', { align: AlignmentType.CENTER, size: 22, color: '9CA3AF', spacing: { after: 1200 } }));
children.push(p('INVITO (인비토)', { align: AlignmentType.CENTER, size: 24, bold: true }));
children.push(p(`버전 ${VERSION} | 2026년 10월`, { align: AlignmentType.CENTER, size: 22, color: '047857' }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── 1. 이 안내서와 받으신 파일 ─────────────────────────
children.push(h1('1. 이 안내서와 받으신 파일'));
children.push(p('이 안내서는 귀사가 사전 질의서와 연동 컬럼 정리표로 회신해 주신 구성에 맞춘 설치 순서입니다. 같은 구성(Windows Server 2016 한국어판, Oracle 11g, 고객 뷰와 판매 뷰, 두 뷰에 조회 권한만 있는 읽기 계정)의 시험 환경에서 이 순서를 확인한 뒤 전달드립니다.'));
children.push(table(
  ['받으신 파일', '내용'],
  [
    [ZIP_NAME, '설치 파일 (Windows 64비트, Oracle 접속용 클라이언트 포함)'],
    ['이 안내서 (PDF)', '엠티콜렉션 전용 설치 순서와 입력값'],
  ],
  [4200, 4826],
));
children.push(gap());
children.push(p('설치 파일이 전송 중에 바뀌지 않았는지 아래 명령으로 확인할 수 있습니다. 명령 프롬프트에서 파일이 있는 폴더로 이동한 뒤 실행하고, 출력된 값이 아래 값과 같은지 보세요.'));
children.push(code(`certutil -hashfile ${ZIP_NAME} SHA256`));
children.push(table(
  ['항목', '값'],
  [
    ['SHA-256', ZIP_SHA256],
    ['크기', `${ZIP_BYTES} 바이트`],
  ],
  [1800, 7226],
));
children.push(gap());
children.push(info(`${VERSION} 에서는 설치 마법사가 수신동의, 탈퇴 표시, 성별 컬럼에 실제로 들어 있는 값을 세어 보여 주고, 에이전트가 알아보지 못하는 값(예: 수신, 미수신)은 그 자리에서 뜻을 고르게 합니다. 4장 Step 4 끝의 「값 확인」을 참고하세요.`));

// ─── 2. 설치 전 확인 ────────────────────────────────────
children.push(h1('2. 설치 전 확인'));
children.push(table(
  ['항목', '필요한 것', '귀사 회신'],
  [
    ['설치 서버', 'Windows Server 2016 64비트, 관리자 권한으로 실행', '확인됨'],
    ['인터넷', '설치 서버에서 hanjul.ai 로 나가는 HTTPS(443) 접속', '가능'],
    ['DB 접속', '설치 서버에서 Oracle 서버 주소와 포트로 접속', '가능'],
    ['읽기 계정', 'sync_reader 에 고객 뷰와 판매 뷰 두 개의 조회(SELECT) 권한', '회신대로'],
    ['Oracle 접속 정보', '서버 주소, 포트, 서비스명, sync_reader 비밀번호', '귀사 보유'],
    ['한줄로 접속 정보', 'API Key, API Secret', '담당자가 따로 전달'],
  ],
  [1900, 5026, 2100],
));
children.push(gap());
children.push(warn('판매 뷰(UBOB3_MTREAL.V_CUSTOMER_SALE)에 고객 휴대폰 번호 컬럼을 넣어 주세요. 구매 내역은 휴대폰 번호로 한줄로의 고객과 연결되는데, 회신해 주신 판매 뷰 구조(CD_COMPANY, DT_YYMMDD, CD_CUSTOMER, CT_BUY_TERM, QT_BUY_TERM, AM_BUY_TERM)에는 휴대폰 번호가 없어서 지금 구성으로는 구매 내역이 한 건도 올라가지 않습니다. 고객 뷰의 DS_CELLPHONE 을 고객코드(CD_CUSTOMER)로 붙여 판매 뷰에 넣으면 됩니다. 고객 정보는 이 컬럼이 없어도 그대로 올라갑니다.'));
children.push(gap());
children.push(info('탈퇴 회원은 뷰에서 빼지 않으셔도 됩니다. YN_WITHDRAW 가 「탈퇴」인 회원은 에이전트가 수신거부로 넘겨 문자 발송 대상에서 제외합니다.'));
children.push(gap());
children.push(info('두 뷰의 소유자가 UBOB3_MTREAL 이어도 sync_reader 에 조회 권한만 있으면 됩니다. 시노님을 따로 만들 필요는 없습니다.'));

// ─── 3. 설치 ────────────────────────────────────────────
children.push(h1('3. 설치'));
children.push(numbered(`${ZIP_NAME} 의 압축을 풀면 SyncAgent 폴더가 나옵니다. 이 폴더를 C 드라이브 바로 아래(C:\\SyncAgent)에 통째로 복사합니다. 폴더 경로에 공백이 없어야 합니다.`));
children.push(numbered('C:\\SyncAgent 안의 INSTALL-run-as-admin.bat 을 마우스 오른쪽 버튼으로 눌러 [관리자 권한으로 실행]을 고릅니다.'));
children.push(numbered('「게시자를 확인할 수 없습니다」 보안 경고가 뜨면 [실행]을 누르고, 이어서 관리자 확인 창이 뜨면 [예]를 누릅니다.'));
children.push(numbered('Oracle 클라이언트에 필요한 Microsoft Visual C++ 2005 런타임이 자동으로 설치됩니다. 창에 [REBOOT REQUIRED](재부팅 필요)가 나오면 서버를 다시 시작한 뒤 INSTALL-run-as-admin.bat 을 한 번 더 실행하세요.'));
children.push(numbered('작업 스케줄러에 SyncAgent 작업이 등록되면 창에 [DONE] exe runs + scheduled task registered. 가 나오고, 이어서 설치 마법사가 새 명령 프롬프트 창으로 열립니다.'));
children.push(gap());
children.push(info('창에 [FAIL]이 나오거나 마법사가 열리지 않으면, C:\\SyncAgent 에 생긴 diagnose.txt 를 담당자에게 보내 주세요. 원인을 바로 확인할 수 있습니다.'));

// ─── 4. 설치 마법사 입력값 ──────────────────────────────
children.push(h1('4. 설치 마법사 입력값'));
children.push(p('마법사는 질문마다 값을 입력하거나 보기 번호를 골라 진행합니다. 괄호 안에 기본값이 보이는 질문은 Enter 만 눌러도 됩니다. 아래 표는 귀사 구성에 맞춘 입력값입니다.'));

children.push(h2('Step 1. 한줄로 API 연결'));
children.push(table(
  ['질문', '입력할 값'],
  [
    ['서버 URL', 'Enter (기본값 https://hanjul.ai)'],
    ['API Key', '담당자가 전달한 값'],
    ['API Secret', '담당자가 전달한 값 (입력하는 글자가 화면에 보입니다)'],
  ],
  [2600, 6426],
));

children.push(h2('Step 2. DB 접속 설정'));
children.push(table(
  ['질문', '입력할 값'],
  [
    ['DB 종류', 'Oracle 의 번호'],
    ['호스트', 'Oracle 서버 주소'],
    ['포트', 'Enter (기본값 1521, 다르면 그 값)'],
    ['DB 이름', 'Oracle 서비스명'],
    ['사용자', 'sync_reader'],
    ['비밀번호', 'sync_reader 비밀번호 (입력하는 글자가 화면에 보입니다)'],
    ['암호화(TLS) 연결을 사용할까요?', 'Enter (아니오, 사내 DB)'],
    ['Oracle DB 버전', '11g 이하 보기의 번호 (동봉 Oracle Client 로 접속)'],
  ],
  [3400, 5626],
));
children.push(gap());
children.push(info('「DB 연결 성공」이 나오면 다음으로 넘어갑니다. 함께 들어 있는 Oracle 클라이언트를 처음 준비하느라 10초 남짓 걸릴 수 있습니다. 암호화 연결 질문은 Oracle 접속에는 쓰이지 않습니다. Oracle 서버가 암호화 연결만 받도록 설정돼 있다면 접속되지 않으니 담당자에게 알려 주세요.'));

children.push(h2('Step 3. 테이블 선택'));
children.push(p('접속한 계정이 조회할 수 있는 뷰 목록이 「소유자.뷰이름」 형태로 나옵니다.'));
children.push(table(
  ['질문', '고를 것'],
  [
    ['고객 테이블', 'UBOB3_MTREAL.V_CUSTOMER_MST'],
    ['구매 테이블', 'UBOB3_MTREAL.V_CUSTOMER_SALE'],
    ['고객 고유 식별 컬럼', 'CD_CUSTOMER (고객코드), 이어서 「키 컬럼을 더 추가할까요?」에 Enter(아니오)'],
    ['구매 고유 식별 컬럼', 'DT_YYMMDD (구매일자), 이어서 「키 컬럼을 더 추가할까요?」에 y, CD_CUSTOMER 를 고른 뒤 다시 Enter(아니오)'],
    ['고객 증분 동기화 기준 컬럼', '「자동 감지 실패」 뒤 목록 맨 위의 「없음 (전체 동기화만 사용)」 번호'],
    ['구매 증분 동기화 기준 컬럼', '같은 방법으로 「없음 (전체 동기화만 사용)」 번호'],
  ],
  [3000, 6026],
));
children.push(gap());
children.push(info('뷰에는 기본키 정보가 없어서, 마법사가 한 행을 고유하게 가리키는 컬럼을 고르게 하고 그 자리에서 뷰 전체를 세어 중복이 없는지 확인합니다. 「키 확인 완료」가 나오면 통과입니다. 고객코드가 중복된다는 안내가 나오면(같은 고객이 사업부마다 한 줄씩 있는 경우 등) 진행을 멈추고 담당자에게 알려 주세요.'));
children.push(gap());
children.push(warn('두 뷰 모두 등록이나 수정 시각 컬럼이 없어서, 에이전트는 주기마다 고객과 구매 전체를 다시 읽어 보냅니다. 이미 보낸 행은 같은 행으로 덮어쓰므로 중복은 생기지 않습니다. 동기화 주기(Step 5)는 다시 읽기 시작하는 간격이고, 수신동의나 탈퇴 변경은 그 고객이 든 묶음의 전송이 끝나야 반영됩니다. 그래서 주기보다 늦을 수 있고, 전송이 실패하면 다음 회차로 미뤄집니다. 수신거부나 탈퇴 직후에 발송한다면 한줄로 화면에서 그 고객이 수신거부로 바뀌었는지 먼저 확인하세요.'));

children.push(h2('Step 4. 컬럼 매핑'));
children.push(p('「AI 자동 매핑을 사용하시겠습니까?」에 Enter(예)를 누르면 한줄로가 컬럼 이름을 보고 매핑을 채웁니다. 매핑 결과 표에서 아래 줄이 맞는지 확인하세요.'));
children.push(table(
  ['구분', '귀사 컬럼', '한줄로 필드', '뜻'],
  [
    ['고객', 'DS_CELLPHONE', 'phone', '휴대폰 번호 (필수)'],
    ['고객', 'DS_CUSTOMER', 'name', '고객명'],
    ['고객', 'YN_SMS', 'sms_opt_in', '문자 수신동의'],
    ['고객', 'YN_WITHDRAW', 'is_opt_out', '탈퇴 표시 (탈퇴면 수신거부)'],
    ['고객', 'TP_GENDER', 'gender', '성별'],
    ['고객', 'DT_BIRTH', 'birth_date', '생년월일'],
    ['고객', 'DS_CUSTCLASS', 'grade', '고객등급'],
    ['고객', 'AM_POINT', 'points', '가용포인트'],
    ['고객', 'CT_BUY', 'purchase_count', '누적구매횟수'],
    ['고객', 'AM_BUY', 'total_purchase_amount', '누적구매금액'],
    ['고객', 'DT_LASTBUY', 'recent_purchase_date', '최종구매일'],
    ['고객', 'DS_SALESHOP', 'recent_purchase_store', '최종구매매장명'],
    ['고객', 'DS_JOINSHOP', 'registered_store', '가입매장명'],
    ['고객', 'CD_SALESHOP', 'store_code', '담당 매장 기준 발송에 쓰는 매장코드'],
    ['구매', '판매 뷰에 넣을 휴대폰 번호 컬럼', 'customer_phone', '고객 연결 (필수)'],
    ['구매', 'DT_YYMMDD', 'purchase_date', '구매일자 (필수)'],
    ['구매', 'AM_BUY_TERM', 'total_amount', '구매금액 (필수)'],
    ['구매', 'QT_BUY_TERM', 'quantity', '구매수량'],
  ],
  [1000, 2700, 2300, 3026],
));
children.push(gap());
children.push(p('다르게 잡힌 줄이 있으면 「고객 매핑을 수정하시겠습니까?」 또는 「구매 매핑을 수정하시겠습니까?」에 y 를 입력하고, 고칠 컬럼 번호와 한줄로 필드를 고릅니다. 다 고쳤으면 0 을 입력합니다.'));
children.push(gap());
children.push(info('위 표에 없는 컬럼(CD_CUSTOMER 고객코드, DS_CUSTCLASS_OLD 이전등급, DT_CD_CUSTCLASS 고객등급변경일, TP_YINYANG 양음구분, QT_BUY 누적구매수량, AM_SAVEPOINT 적립포인트, AM_USEPOINT 사용포인트 등)은 커스텀 필드로 함께 올라갑니다. 판매 뷰의 CT_BUY_TERM(구매횟수)도 구매 내역의 커스텀 필드로 올라갑니다. 「커스텀 필드 라벨을 수정하시겠습니까?」에 y 를 입력하면 한줄로 화면에 보일 이름을 한글로 바꿀 수 있습니다(예: CD_CUSTOMER 를 고객코드로). Enter 만 누르면 컬럼 이름이 그대로 쓰입니다.'));
children.push(gap());
children.push(info('누적구매횟수, 누적구매금액, 최종구매일, 최종구매매장처럼 고객 뷰의 누계를 매핑하면, 한줄로는 고객 뷰의 값을 그 고객의 누계로 씁니다. 판매 뷰의 일별 구매 내역은 구매 이력으로 따로 쌓입니다.'));
children.push(gap());
children.push(info('한줄로의 생일 발송은 저장된 생년월일 날짜에 나갑니다. 음력 생일을 양력으로 바꾸지는 않으므로, 음력 고객은 커스텀 필드의 TP_YINYANG(양음구분)으로 따로 골라 쓰세요.'));
children.push(gap());
children.push(info('AI 자동 매핑에는 컬럼 이름만 보내고, 이름이나 전화번호 같은 고객 데이터는 보내지 않습니다.'));

children.push(h2('Step 4 끝. 값 확인'));
children.push(p('매핑이 끝나면 마법사가 수신동의(YN_SMS), 탈퇴 표시(YN_WITHDRAW), 성별(TP_GENDER) 컬럼에 들어 있는 값과 건수를 세어 보여 줍니다. 행이 많으면 몇 분 걸릴 수 있으며, 컬럼 하나에 5분을 넘기면 그 컬럼은 건너뜁니다.'));
children.push(p('에이전트가 이미 아는 값(Y, N, 동의, 거부, 탈퇴, 남자, 여자 등)은 뜻만 보여 주고, 모르는 값은 하나씩 뜻을 묻습니다. 귀사 회신 기준으로 아래처럼 고르면 됩니다.'));
children.push(table(
  ['질문에 나온 값', '고를 보기'],
  [
    ['수신동의 값 「수신」', '수신동의'],
    ['수신동의 값 「미수신」', '수신거부'],
    ['탈퇴 표시 값 중 탈퇴가 아닌 회원을 뜻하는 값', '정상 (발송 가능)'],
    ['성별 값 중 에이전트가 모르는 값', '남, 여, 모름 중 그 값의 뜻'],
  ],
  [4500, 4526],
));
children.push(gap());
children.push(p('컬럼마다 마지막 줄에 결과가 나옵니다(예: 수신동의 935,291, 수신거부 156,455). 사전 질의서에 적어 주신 건수와 맞는지 확인하세요.'));
children.push(gap());
children.push(warn('뜻을 고르지 않고 「모름」을 고르면, 수신동의 값은 새 고객을 미동의로 넣고 탈퇴 표시 값은 수신거부로 처리합니다. 문자를 보낼 수 있는 고객이 크게 줄어들 수 있으니, 값의 뜻을 모르면 진행을 멈추고 담당자와 확인하세요.'));
children.push(gap());
children.push(warn('수신동의(YN_SMS)나 탈퇴 표시(YN_WITHDRAW)의 값 확인이 「값 확인 실패」 또는 「값 세기 시간 초과」로 건너뛰어졌다면 첫 동기화를 시작하지 마세요. 그대로 시작하면 「수신」도 알아보지 못한 값으로 처리되어 새 고객이 미동의로 들어갑니다. 마지막 질문 「지금 바로 동기화를 시작하시겠습니까?」에 n 을 고르고, 서버를 다시 켜도 자동으로 시작되지 않도록 관리자 권한 명령 프롬프트에서 schtasks /Change /TN SyncAgent /DISABLE 로 예약 작업을 꺼 둔 뒤 담당자에게 알려 주세요. 원인을 해결하고 6장의 「수신동의, 탈퇴, 성별 값 다시 확인하기」로 분류와 결과 건수를 확인한 다음, schtasks /Change /TN SyncAgent /ENABLE 로 다시 켜고 schtasks /Run /TN SyncAgent 로 시작합니다.'));
children.push(gap());
children.push(info('값의 뜻을 나중에 다시 고르려면 6장의 「수신동의, 탈퇴, 성별 값 다시 확인하기」를 쓰세요. 바꾼 분류는 다음 동기화 때 고객 전체에 다시 적용됩니다.'));

children.push(h2('Step 5. 동기화 설정과 저장'));
children.push(table(
  ['질문', '입력할 값'],
  [
    ['고객 동기화 주기', '「6시간」의 번호'],
    ['구매 동기화 주기', '「6시간」의 번호'],
    ['Agent 이름', '알아보기 쉬운 이름 (예: metrocity-sync)'],
    ['이 설정으로 저장하시겠습니까?', '설정 요약을 확인한 뒤 Enter(예)'],
    ['지금 바로 동기화를 시작하시겠습니까?', 'n (아래 명령으로 시작합니다)'],
  ],
  [3800, 5226],
));
children.push(gap());
children.push(info('두 뷰 모두 주기마다 전체를 다시 읽으므로(Step 3) 6시간을 권합니다. 수신거부와 탈퇴도 이 간격으로 다시 읽으며, 전체 전송이 끝나야 반영됩니다. 더 짧게 하려면 첫 전체 전송에 걸린 시간을 보고 담당자와 정하세요.'));
children.push(gap());
children.push(p('저장이 끝나면 관리자 권한 명령 프롬프트에서 아래 명령으로 에이전트를 시작합니다. 이후에는 서버를 다시 켤 때마다 약 2분 뒤 자동으로 시작됩니다.'));
children.push(code('schtasks /Run /TN SyncAgent'));
children.push(gap());
children.push(info('마지막 질문에 y 를 고르면 그 명령 프롬프트 창 안에서 동기화가 돌고, 창을 닫으면 멈춥니다. 그래서 n 을 고르고 위 명령으로 시작하는 것을 권합니다.'));

// ─── 5. 동작 확인 ───────────────────────────────────────
children.push(h1('5. 동작 확인'));
children.push(p('시작하면 고객과 판매 전체를 보내고, 그 뒤로도 정해진 주기마다 전체를 다시 보냅니다. 진행 상황은 아래 로그 파일에 남습니다(날짜별 파일).'));
children.push(code('C:\\SyncAgent\\logs\\sync-날짜.log    (예: sync-2026-11-02.log)'));
children.push(table(
  ['로그에 보이는 줄', '뜻과 확인할 것'],
  [
    ['커스텀 필드 정의 서버 등록 완료 (N개)', '커스텀 필드 이름이 한줄로에 등록됨'],
    ['동기화 완료: customers (full)', '고객 전체 전송 회차가 끝남. 같은 줄의 success 가 total 과 같고 fail 과 errors 가 0 이면 정상'],
    ['동기화 완료: purchases (full)', '판매 전체 전송 회차가 끝남. 확인 방법은 위와 같음'],
  ],
  [3700, 5326],
));
children.push(gap());
children.push(warn('「동기화 완료」 줄은 실패가 있어도 나옵니다. 줄 앞이 ⚠️ 이거나 fail 또는 errors 가 0 이 아니면, 또는 「전체 동기화 미완료 감지」 경고가 보이면 최근 로그 파일을 담당자에게 보내 주세요.'));
children.push(gap());
children.push(info('두 뷰에 수정 시각 컬럼이 없어서 주기마다 「타임스탬프 컬럼이 없어 전체 동기화로 대체합니다」라는 뜻의 안내가 한 줄씩 나옵니다. Step 3 에서 고른 그대로의 정상 동작입니다.'));
children.push(gap());
children.push(info('판매 뷰를 읽을 때마다 「행 위치(ROWID)를 줄 수 없는 뷰입니다. 전체 동기화를 고유 키 순서로 읽습니다」 경고가 한 줄 나옵니다. 집계한 뷰에서 나오는 정상 안내이며, Step 3 에서 고른 구매일자와 고객코드 순서로 읽습니다.'));
children.push(gap());
children.push(info('판매 뷰에 휴대폰 번호 컬럼을 넣기 전에는 로그에 「구매 정규화: N건 제외」가 나오고 구매 내역은 올라가지 않습니다. 컬럼을 넣은 뒤에는 6장의 「설정 바꾸기」로 구매 매핑에 추가하고 다시 시작해 주세요.'));
children.push(gap());
children.push(info('첫 전체 전송은 행 수가 많아 시간이 걸립니다. 진행 중에는 로그에 처리 결과가 이어서 남고, 끝나면 위 「동기화 완료 ... (full)」 줄이 나옵니다. 한줄로 화면에서의 확인은 담당자와 함께 진행합니다.'));

// ─── 6. 운영 중에 하는 일 ───────────────────────────────
children.push(h1('6. 운영 중에 하는 일'));
children.push(p('아래 명령은 관리자 권한 명령 프롬프트에서 C:\\SyncAgent 폴더로 이동한 뒤 실행합니다.'));
children.push(table(
  ['하고 싶은 일', '방법'],
  [
    ['에이전트 멈추기', 'schtasks /End /TN SyncAgent'],
    ['에이전트 시작하기', 'schtasks /Run /TN SyncAgent'],
    ['설정 보기', 'sync-agent.exe --show-config'],
    ['설정 바꾸기 (DB 주소, 매핑, 커스텀 필드 라벨 등)', '에이전트를 멈춘 뒤 sync-agent.exe --edit-config 로 바꾸고, 다시 시작'],
    ['수신동의, 탈퇴, 성별 값 다시 확인하기', '에이전트를 멈춘 뒤 sync-agent.exe --edit-config 에서 [6] 을 고르고, 끝나면 다시 시작 (고른 분류는 바로 저장됩니다)'],
    ['전체를 처음부터 다시 보내기', '에이전트를 멈춘 뒤 C:\\SyncAgent\\data\\sync_state.json 을 지우고, 다시 시작'],
    ['문제가 생겼을 때', 'C:\\SyncAgent\\logs 의 최근 로그 파일과 diagnose.txt 를 담당자에게 보내기'],
  ],
  [3500, 5526],
));
children.push(gap());
children.push(warn('설정을 바꿀 때는 꼭 에이전트를 먼저 멈추세요. 실행 중인 에이전트는 시작할 때 읽은 설정을 계속 씁니다.'));
children.push(gap());
children.push(warn('C:\\SyncAgent\\data 폴더(설정 파일 config.enc, 암호화 키 agent.key)는 지우거나 옮기지 마세요. 이 두 파일이 없으면 설치 마법사부터 다시 해야 합니다.'));

// ─── 문서 끝 ────────────────────────────────────────────
children.push(new Paragraph({ spacing: { before: 480 }, children: [] }));
children.push(p('설치 중 막히는 곳이 있으면 화면 내용과 diagnose.txt 를 담당자에게 보내 주세요.', { align: AlignmentType.CENTER, size: 20, color: '6B7280' }));
children.push(p('© 2026 INVITO Co., Ltd. All rights reserved.', { align: AlignmentType.CENTER, size: 18, color: '9CA3AF' }));

const HEADER_TEXT = t(`Sync Agent v${VERSION} 설치 안내서, 엠티콜렉션`);
const FOOTER_TEXT = t('© 2026 INVITO   |   ');

// ⛔ 고객에게 나가는 글자에 가운뎃점 · 줄표가 있으면 만들지 않는다(바깥 문장 규칙)
const banned = OUTWARD_TEXTS.filter((s) => /[·—–]/.test(s));
if (banned.length) {
  console.error('가운뎃점 또는 줄표가 든 문장:', banned.map((s) => s.slice(0, 40)));
  process.exit(1);
}

const doc = new Document({
  creator: 'INVITO',
  title: `Sync Agent v${VERSION} 설치 안내서 (엠티콜렉션)`,
  description: `엠티콜렉션 전용 Sync Agent v${VERSION} 설치 안내서`,
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: '047857' },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: FONT, color: '1F2937' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'numbers',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: HEADER_TEXT, font: FONT, size: 16, color: '9CA3AF' })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: FOOTER_TEXT, font: FONT, size: 16, color: '9CA3AF' }),
            new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '9CA3AF' }),
          ],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('OK', outPath, buf.length, 'bytes', '· zip', ZIP_NAME, ZIP_BYTES, 'bytes', ZIP_SHA256);
}).catch((err) => { console.error(err); process.exit(1); });
