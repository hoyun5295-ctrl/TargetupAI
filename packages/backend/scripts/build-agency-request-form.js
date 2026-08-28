/**
 * build-agency-request-form.js — 대행발송 요청서 양식 생성기 (★ 2026-08-25(3b) 신설 · ★ 2026-08-26(2)·(3) 통일 개정)
 *
 * 산출물 = packages/frontend/public/agency-request-form.xlsx (고객이 화면에서 내려받는 그 파일).
 * 실행 = packages/backend 에서 `node scripts/build-agency-request-form.js` (exceljs는 backend 의존성).
 *
 * ★2026-08-26(3) Harold 정정: 배포 양식은 우리 디자인이 아니라 **업체들이 실제로 주고받는 실물 양식의
 *   복제**다(카카오톡 수신 실물 실측 · 행 구성·문구·병합·고객리스트 헤더까지 동일). 시트1 "내용"의
 *   B열 = 라벨, C열~G열 병합 = 값. 뒤에 우리 "작성 안내" 시트 하나만 붙인다.
 *   실물에만 있는 알림톡 전용 칸(전환 발송·템플릿코드)도 그대로 둔다 — 모양 통일이 목적이고,
 *   문자타입에 알림톡을 적으면 파서가 명확한 사유로 반려한다.
 *
 * ⛔ **시트 이름 "내용"·"고객리스트" · 항목 라벨 문구** 는 파서(`utils/agency-send-form.ts`)와의 계약이다.
 *   라벨 문구를 바꾸면 파서 FIELD_ALIASES도 같이 바꾸고, 바꾼 뒤 양식을 파서에 통과시켜 확인한다.
 * ⛔ **값 칸(C열)의 안내문은 파서 PLACEHOLDER_VALUES와 짝이다** — 실물 원문("월 일 시 분" ·
 *   발신번호 안내 · ①②③) 그대로만 쓴다. 새 안내문을 값 칸에 만들지 마라(목록이 늘어난다).
 * ⛔ 새로 쓰는 문구(작성 안내 시트)에 줄표 0(이 축의 전 문구 규약). 실물 복제 문구는 원문 보존.
 */
const ExcelJS = require('exceljs');
const path = require('path');

const INK = 'FF171717';
const MUT = 'FF6B6B6B';
const LINE = 'FFBFBFBF';      // 실물 느낌의 무채색 테두리
const HEAD_BG = 'FFD9D9D9';   // 표머리 회색
const LABEL_BG = 'FFF2F2F2';  // 라벨 칸 연회색
const IND = 'FF4F46E5';       // 작성 안내 시트 전용(우리 시트)
const IND_DK = 'FF3730A3';
const IND_BG = 'FFEEF2FF';
const IND_LN = 'FFC7D2FE';

const thin = (color) => ({ style: 'thin', color: { argb: color } });
const boxAll = (color) => ({ top: thin(color), left: thin(color), bottom: thin(color), right: thin(color) });

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = '한줄로';

  // ══════════ 시트 1: 내용 — 실물 레이아웃 복제 (B열 라벨 · C:G 병합 값) ══════════
  const ws = wb.addWorksheet('내용', { properties: { defaultRowHeight: 18 } });
  ws.columns = [
    { width: 2 },   // A 비움(실물과 동일)
    { width: 22 },  // B 라벨
    { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, // C~G 값
  ];

  /** 라벨 칸 하나 그리기 */
  const label = (addr, text, opts = {}) => {
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: INK } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.head ? HEAD_BG : LABEL_BG } };
    c.border = boxAll(LINE);
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  };
  /** 값 칸(C:G 병합) 하나 그리기 */
  const value = (rowFrom, rowTo, text, opts = {}) => {
    ws.mergeCells(`C${rowFrom}:G${rowTo}`);
    const c = ws.getCell(`C${rowFrom}`);
    c.value = text;
    c.font = { name: '맑은 고딕', size: 10, color: { argb: opts.muted ? MUT : INK } };
    c.border = boxAll(LINE);
    c.alignment = { vertical: opts.top ? 'top' : 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    c.numFmt = '@'; // 문자 그대로(시각을 엑셀이 날짜 셀로 바꾸지 않게)
    for (let r = rowFrom; r <= rowTo; r += 1) {
      for (const col of ['C', 'D', 'E', 'F', 'G']) ws.getCell(`${col}${r}`).border = boxAll(LINE);
    }
  };

  // 1행: 표머리 "구 분 / 내 용" (실물 원문)
  label('B1', '구 분', { head: true });
  value(1, 1, '내 용');
  ws.getCell('C1').font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: INK } };
  ws.getCell('C1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
  ws.getCell('C1').alignment = { vertical: 'middle', horizontal: 'center' };

  // 2행: 문자타입
  label('B2', '문자타입');
  value(2, 2, null);
  ws.getCell('C2').dataValidation = {
    type: 'list', allowBlank: true, formulae: ['"SMS,LMS,MMS"'],
    showErrorMessage: true, error: 'SMS 또는 LMS 또는 MMS만 고를 수 있습니다.',
  };

  // 3~4행: 알림톡 전환 발송 (실물 원문 보존 · 알림톡 접수는 파서가 반려한다)
  ws.mergeCells('B3:E3');
  label('B3', '알림톡 실패 시 전환 발송 사용 여부');
  ws.getCell('F3').border = boxAll(LINE);
  ws.getCell('G3').border = boxAll(LINE);
  ws.mergeCells('B4:G4');
  const b4 = ws.getCell('B4');
  b4.value = '※ 전환 발송 사용시 알림톡과 동일한 문안 발송을 기본으로 합니다. 변경 문안 발송은 사전 공유 부탁 드립니다. ';
  b4.font = { name: '맑은 고딕', size: 9, color: { argb: MUT } };
  b4.border = boxAll(LINE);
  b4.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };

  // 5행: 발송날짜 및 시간 (값 칸 안내문 = 실물 원문 · 파서 PLACEHOLDER와 짝)
  label('B5', '발송날짜 및 시간');
  value(5, 5, '월 일 시 분', { muted: true });

  // 6행: 메시지 제목
  label('B6', '메시지 제목\n(LMS,MMS만 해당)');
  value(6, 6, null);

  // 7행: 템플릿코드 (실물 원문 보존)
  label('B7', '템플릿코드\n(알림톡만 해당)');
  value(7, 7, null);

  // 8행: 테스트 문자 받을 번호
  label('B8', '테스트 문자\n받을 번호\n(여러 개 가능)');
  ws.getRow(8).height = 44;
  value(8, 8, null);

  // 9~22행: 메시지 내용 (라벨·값 모두 세로 병합 = 실물과 동일)
  ws.mergeCells('B9:B22');
  label('B9', '메시지 내용');
  value(9, 22, null, { top: true });

  // 23행: 발신번호(=회신번호) (값 칸 안내문 = 실물 원문 · 파서 PLACEHOLDER와 짝)
  label('B23', '발신번호\n(=회신번호)');
  ws.getRow(23).height = 30;
  value(23, 23, "(고객 별로 발신번호가 상이할 경우, '고객리스트'시트에 고객 별로 발신번호 기재 부탁드립니다.)", { muted: true });

  // 24~26행: 이미지 파일명 ①②③ (실물 원문 보존)
  ws.mergeCells('B24:B26');
  label('B24', '이미지 파일명\n(MMS/\n친구톡 이미지 발송)');
  value(24, 24, '① ', { muted: true });
  value(25, 25, '②', { muted: true });
  value(26, 26, '③', { muted: true });

  // ══════════ 시트 2: 고객리스트 — 실물 헤더 복제 (1행 = 열 이름) ══════════
  // ⛔ **1행이 곧 열 이름이다**(파서 계약). 안내 배너를 이 시트 위에 얹지 마라 —
  //   배너 줄이 헤더로 읽혀 실제 헤더 행이 첫 고객 데이터가 된다. 안내는 작성 안내 시트가 가진다.
  const m = wb.addWorksheet('고객리스트');
  m.columns = [{ width: 12 }, { width: 20 }, { width: 14 }, { width: 22 }, { width: 15 }, { width: 15 }];
  const mh = m.getRow(1);
  mh.values = ['고객명', '고객연락처 (수신번호)', '매장이름', '매장전화번호 (회신번호)', '기타\n(ex:포인트 등)', '기타2\n(ex:포인트 등)'];
  mh.height = 30;
  ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'].forEach((addr) => {
    const c = m.getCell(addr);
    c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: INK } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } };
    c.border = boxAll(LINE);
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  // 데이터 칸은 텍스트 서식으로 미리 깔아 둔다(엑셀이 010 앞자리 0을 지우는 것을 줄인다)
  for (let dr = 2; dr <= 500; dr += 1) {
    for (let dc = 1; dc <= 6; dc += 1) m.getCell(dr, dc).numFmt = '@';
  }

  // ══════════ 시트 3: 작성 안내 (우리 시트 · 실물에는 없다) ══════════
  const g = wb.addWorksheet('작성 안내', { views: [{ showGridLines: false }] });
  g.columns = [{ width: 3 }, { width: 20 }, { width: 92 }];

  g.mergeCells('B1:C1');
  const gt = g.getCell('B1');
  gt.value = '작성 안내';
  gt.font = { name: '맑은 고딕', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  gt.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IND } };
  gt.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  g.getRow(1).height = 30;

  const guide = [
    ['진행 순서', '① 내용 시트를 채웁니다  ② 고객리스트 시트에 명단을 채웁니다(첫 줄이 열 이름)  ③ 한줄로의 대행발송 화면에서 "요청서로 접수"에 이 파일 하나를 올리거나, 접수 메일 주소로 이 파일을 첨부해 보냅니다  ④ 확인 화면(화면 접수)에서 내용과 인원수를 보고 접수합니다  ⑤ 테스트 문자 받을 번호로 온 문자를 확인하고, 문자 속 주소나 화면에서 승인하면 발송이 예약됩니다'],
    ['받는 발송', '이 접수는 문자(SMS·LMS·MMS)만 받습니다. 문자타입에 알림톡·친구톡을 적으면 접수되지 않습니다'],
    ['발송날짜 및 시간', '예: 8월 30일 10시 30분 또는 2026-08-30 10:30. 연도를 안 적으면 올해 날짜로 접수됩니다\n지금부터 3시간 뒤부터 정할 수 있습니다. 광고 문자는 심야 시간대에 보낼 수 없습니다'],
    ['발신번호', '두 가지 중 하나로 적습니다.\n1) 번호 직접: 등록된 발신번호를 적습니다. 예: 0507-0000-0000\n2) 고객리스트의 열 이름: 열 이름을 그대로 적으면 각 매장 번호로 나갑니다. 이때 회신번호 종류만큼 접수가 나뉘고, 건마다 검사와 승인이 따로 진행됩니다. 모든 번호는 발신번호로 미리 등록돼 있어야 합니다'],
    ['문안 항목', '%열이름%을 메시지 내용에 넣으면 고객마다 고객리스트의 그 열 값으로 바뀝니다. 예: %고객명%님 → 김하나님\n열 이름과 달라도 됩니다. 접수 확인 화면에서 AI가 맞는 열을 골라 두고, 직접 바꿀 수도 있습니다\n항목은 4개까지, 메시지 내용에만 넣을 수 있습니다(제목에는 넣지 않습니다)'],
    ['광고 표시', '대행발송 문자는 기본으로 광고로 처리되어 (광고) 표시와 무료 수신거부 번호가 자동으로 붙습니다. 광고가 아닌 안내 문자면 내용 시트 아무 빈 줄의 B칸에 "광고 여부", C칸에 "아니오"를 적어 주세요'],
    ['이미지 문자', '이미지는 이 파일에 넣지 않습니다.\n화면 접수: 확인 단계에서 "이미지 넣기"로 첨부합니다. 큰 사진도 규격에 맞게 자동 변환됩니다\n메일 접수: 요청서와 함께 이미지 파일을 별도로 첨부합니다. JPG 형식, 한 장에 300KB 이하, 최대 3장까지 받습니다. 규격에 맞지 않으면 접수되지 않고 안내 메일이 갑니다'],
    ['청구 계정', '한 이메일 주소로 여러 계정의 발송을 요청하는 경우에만 적습니다. 내용 시트 아무 빈 줄의 B칸에 "청구 계정", C칸에 안내받은 계정 이름을 적으면 그 계정 명의로 접수되고 청구됩니다. 계정이 하나면 적지 않아도 됩니다'],
    ['고객리스트', '첫 줄이 열 이름이고, 그 아래로 한 줄에 고객 한 명씩 적습니다. 열 이름은 자유롭게 바꾸거나 늘려도 됩니다\n휴대폰 번호 열은 자동으로 찾아 드리고, 화면 접수라면 확인 화면에서 바꿀 수도 있습니다\n번호 열을 확정하고 싶으면 내용 시트 아무 빈 줄의 B칸에 "수신자 열 이름", C칸에 그 열 이름을 적어 주세요'],
  ];
  let gr = 3;
  for (const [k, v] of guide) {
    const lines = v.split('\n').length;
    const kc = g.getCell(`B${gr}`);
    kc.value = k;
    kc.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: IND_DK } };
    kc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IND_BG } };
    kc.border = boxAll(IND_LN);
    kc.alignment = { vertical: 'top', horizontal: 'left', indent: 1 };
    const vcell = g.getCell(`C${gr}`);
    vcell.value = v;
    vcell.font = { name: '맑은 고딕', size: 10, color: { argb: INK } };
    vcell.border = boxAll(LINE);
    vcell.alignment = { vertical: 'top', horizontal: 'left', indent: 1, wrapText: true };
    g.getRow(gr).height = Math.max(22, lines * 15 + 14);
    gr += 1;
  }

  const out = path.resolve(__dirname, '../../frontend/public/agency-request-form.xlsx');
  await wb.xlsx.writeFile(out);
  console.log('written:', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
