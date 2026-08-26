/**
 * build-agency-request-form.js — 대행발송 요청서 양식 생성기 (★ 2026-08-25(3b) 신설 · ★ 2026-08-26(2) 통일 개정)
 *
 * 산출물 = packages/frontend/public/agency-request-form.xlsx (고객이 화면에서 내려받는 그 파일).
 * 실행 = packages/backend 에서 `node scripts/build-agency-request-form.js` (exceljs는 backend 의존성).
 *
 * ★2026-08-26(2) 업계 관행 양식으로 통일(Harold 승인): **한 파일**에 시트1 "내용"(항목) +
 *   시트2 "고객리스트"(명단) + 시트3 "작성 안내". 라벨도 업계 문구(메시지 내용 · 발송날짜 및 시간 ·
 *   발신번호(=회신번호) · 테스트 문자 받을 번호)를 쓴다 — 업체가 이미 쓰는 파일과 우리가 나눠 주는
 *   파일이 같은 모양이 되게. 알림톡 전용 칸(템플릿코드·전환 발송)은 넣지 않는다(이 접수는 문자만).
 *
 * ⛔ **시트 이름 "내용"·"고객리스트" · 항목 라벨** 규격은 파서(`utils/agency-send-form.ts`)와의 계약이다.
 *   라벨 문구를 바꾸면 파서의 FIELD_ALIASES도 같이 바꾸고, 바꾼 뒤 양식을 파서에 통과시켜 확인한다.
 * ⛔ **값 칸(B열)에 안내문·예시를 넣지 마라** — 안내문이 값 칸에 남은 채 접수되면 파서가 값으로 읽는다.
 *   (파서의 PLACEHOLDER_VALUES 목록이 늘어나는 원천이다.) 안내는 C열과 작성 안내 시트에만 둔다.
 * ⛔ 문구에 줄표 0(이 축의 전 문구 규약).
 */
const ExcelJS = require('exceljs');
const path = require('path');

const IND = 'FF4F46E5';      // indigo-600
const IND_DK = 'FF3730A3';   // indigo-800
const IND_BG = 'FFEEF2FF';   // indigo-50
const IND_LN = 'FFC7D2FE';   // indigo-200
const INK = 'FF171717';
const MUT = 'FF6B6B6B';
const LINE = 'FFE5E5E5';
const SOFT = 'FFF7F7F8';

const thin = (color) => ({ style: 'thin', color: { argb: color } });
const boxAll = (color) => ({ top: thin(color), left: thin(color), bottom: thin(color), right: thin(color) });

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = '한줄로';

  // ══════════ 시트 1: 내용 (파서가 읽는 항목 시트) ══════════
  const ws = wb.addWorksheet('내용', {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = [
    { key: 'label', width: 17 },
    { key: 'value', width: 56 },
    { key: 'help', width: 54 },
  ];

  // 표지
  ws.mergeCells('A1:C1');
  const t = ws.getCell('A1');
  t.value = '대행발송 요청서';
  t.font = { name: '맑은 고딕', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IND } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 36;

  ws.mergeCells('A2:C2');
  const st = ws.getCell('A2');
  st.value = '이 시트의 파란 칸을 채우고, 고객리스트 시트에 명단을 넣으면 파일 하나로 접수가 끝납니다.';
  st.font = { name: '맑은 고딕', size: 10, color: { argb: IND_DK } };
  st.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IND_BG } };
  st.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 22;

  ws.getRow(3).height = 8;

  // 표머리
  const head = ws.getRow(4);
  head.values = ['항목', '내용', '작성 안내'];
  head.height = 20;
  ['A4', 'B4', 'C4'].forEach((addr) => {
    const c = ws.getCell(addr);
    c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: MUT } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
    c.border = boxAll(LINE);
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });

  // ⛔ 값(B열)은 전부 빈칸이다 — 예시는 C열과 작성 안내 시트가 가진다(위 머리 주석의 계약).
  const fields = [
    {
      label: '문자타입', value: '', h: 24, list: ['SMS', 'LMS', 'MMS'],
      help: '비워 두시면 문안 길이와 이미지에 따라 자동으로 정해집니다. 알림톡·친구톡은 이 접수로 받지 않습니다.',
    },
    {
      label: '메시지 제목', value: '', h: 24,
      help: '긴 문자(LMS)와 이미지 문자에 필요합니다. 짧은 문자만이면 비워도 됩니다. 예: 가을 신상 행사 안내',
    },
    {
      label: '메시지 내용', value: '', h: 64,
      help: '%열이름% 형태로 고객리스트의 열 값을 넣을 수 있습니다(4개까지). 예: %고객명%\n항목은 문안에만 넣고 제목에는 넣지 마세요.',
    },
    {
      label: '발송날짜 및 시간', value: '', h: 24,
      help: '예: 2026-09-01 14:00 (연도까지 적어 주세요). 지금부터 3시간 뒤부터 정할 수 있습니다.',
    },
    {
      label: '발신번호(=회신번호)', value: '', h: 24,
      help: '등록된 발신번호를 적습니다. 예: 0507-0000-0000\n매장별로 다르게 보내려면 고객리스트의 열 이름(예: 매장전화번호)을 적으세요.',
    },
    {
      label: '광고 여부', value: '', h: 24, list: ['예', '아니오'],
      help: '비워 두시면 예로 처리됩니다. 광고면 (광고) 표시와 무료 수신거부 번호가 자동으로 붙습니다.',
    },
    {
      label: '테스트 문자 받을 번호', value: '', h: 24,
      help: '검사를 통과한 문안을 이 번호로 먼저 보내 드립니다. 예: 010-0000-0000\n여러 명이면 쉼표로 나눠 적으세요.',
    },
    // ★2026-08-26 §18-4 신설(선택) — 파서 FIELD_ALIASES '수신자 열 이름'과 계약
    {
      label: '수신자 열 이름', value: '', h: 24,
      help: '고객리스트에서 받는 분 휴대폰 번호가 든 열의 이름(선택). 예: 고객연락처\n비워 두시면 번호 모양을 보고 자동으로 찾습니다.',
    },
  ];

  let r = 5;
  for (const f of fields) {
    const row = ws.getRow(r);
    row.height = f.h;

    const lc = ws.getCell(`A${r}`);
    lc.value = f.label;
    lc.font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: IND_DK } };
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IND_BG } };
    lc.border = boxAll(IND_LN);
    lc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };

    const vc = ws.getCell(`B${r}`);
    vc.value = f.value;
    vc.font = { name: '맑은 고딕', size: 11, color: { argb: INK } };
    vc.border = boxAll(IND_LN);
    vc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    vc.numFmt = '@'; // 문자 그대로(시각을 엑셀이 날짜 셀로 바꾸지 않게)
    if (f.list) {
      vc.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${f.list.join(',')}"`], showErrorMessage: true, error: `${f.list.join(' 또는 ')}만 고를 수 있습니다.` };
    }

    const hc = ws.getCell(`C${r}`);
    hc.value = f.help;
    hc.font = { name: '맑은 고딕', size: 9, color: { argb: MUT } };
    hc.border = boxAll(LINE);
    hc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    r += 1;
  }

  ws.getRow(r).height = 8;
  r += 1;
  ws.mergeCells(`A${r}:C${r}`);
  const foot = ws.getCell(`A${r}`);
  foot.value = '명단은 두 번째 시트(고객리스트)에, 작성 방법과 예시는 세 번째 시트(작성 안내)에 있습니다. 시트 이름과 항목 이름은 바꾸지 마세요.';
  foot.font = { name: '맑은 고딕', size: 9, color: { argb: MUT } };
  foot.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 18;

  // ══════════ 시트 2: 고객리스트 (파서가 읽는 명단 시트) ══════════
  // ⛔ **1행이 곧 열 이름이다**(업계 실물과 동일 · 파서 계약). 안내 배너를 이 시트 위에 얹지 마라 —
  //   배너 줄이 헤더로 읽혀 실제 헤더 행이 첫 고객 데이터가 된다. 안내는 작성 안내 시트가 가진다.
  const m = wb.addWorksheet('고객리스트', { views: [{ showGridLines: false }] });
  m.columns = [{ width: 14 }, { width: 20 }, { width: 14 }, { width: 22 }, { width: 16 }, { width: 16 }];
  const mh = m.getRow(1);
  mh.values = ['고객명', '고객연락처 (수신번호)', '매장이름', '매장전화번호 (회신번호)', '기타', '기타2'];
  ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'].forEach((addr) => {
    const c = m.getCell(addr);
    c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IND } };
    c.border = boxAll(IND_LN);
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  // 데이터 칸은 텍스트 서식으로 미리 깔아 둔다(엑셀이 010 앞자리 0을 지우는 것을 줄인다)
  for (let dr = 2; dr <= 500; dr += 1) {
    for (let dc = 1; dc <= 6; dc += 1) m.getCell(dr, dc).numFmt = '@';
  }

  // ══════════ 시트 3: 작성 안내 ══════════
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
    ['작성 예시', '메시지 내용: [한줄상회] %고객명%님, 9월 1일(월) 오후 2시부터 가을 신상 행사를 엽니다.\n발송날짜 및 시간: 2026-09-01 14:00\n발신번호: 0507-0000-0000 / 광고 여부: 예 / 테스트 문자 받을 번호: 010-0000-0000\n고객리스트: 고객명 김하나 · 고객연락처 010-0000-1111 처럼 한 줄에 고객 한 명씩 적습니다'],
    ['발신번호', '두 가지 중 하나로 적습니다.\n1) 번호 직접: 등록된 발신번호를 적습니다. 예: 0507-0000-0000\n2) 고객리스트의 열 이름: 예를 들어 "매장전화번호"라고 적으면 각 매장 번호로 나갑니다. 이때 회신번호 종류만큼 접수가 나뉘고, 건마다 검사와 승인이 따로 진행됩니다. 모든 번호는 발신번호로 미리 등록돼 있어야 합니다'],
    ['문안 항목', '%열이름%을 문안에 넣으면 고객마다 고객리스트의 그 열 값으로 바뀝니다. 예: %고객명%님 → 김하나님\n열 이름과 달라도 됩니다. 접수 확인 화면에서 AI가 맞는 열을 골라 두고, 직접 바꿀 수도 있습니다\n항목은 4개까지, 문안에만 넣을 수 있습니다(제목에는 넣지 않습니다)'],
    ['발송날짜 및 시간', '연도부터 분까지 적습니다. 예: 2026-09-01 14:00 또는 2026년 9월 1일 14시 30분\n지금부터 3시간 뒤부터 정할 수 있습니다. 광고 문자는 심야 시간대에 보낼 수 없습니다'],
    ['광고 여부', '기본은 "예"입니다. 광고면 문자 앞에 (광고) 표시와 무료 수신거부 번호가 자동으로 붙습니다. 광고가 아닐 때만 "아니오"를 고르세요'],
    ['이미지 문자', '이미지는 파일에 넣지 않고, 화면 접수의 확인 단계에서 "이미지 넣기"로 첨부합니다. 메일 접수는 이미지 문자를 받지 않습니다'],
    ['고객리스트', '첫 줄이 열 이름이고, 그 아래로 한 줄에 고객 한 명씩 적습니다. 열 이름은 자유롭게 바꾸거나 늘려도 됩니다\n휴대폰 번호 열은 자동으로 찾아 드리고, 화면 접수라면 확인 화면에서 바꿀 수도 있습니다'],
    ['수신자 열 이름', '고객리스트에서 받는 분 휴대폰 번호가 든 열의 이름을 적으면 그 열로 확정됩니다(선택). 비워 두시면 번호 모양을 보고 자동으로 찾습니다.\n적은 이름이 명단에 없으면 접수되지 않으니 열 이름과 똑같이 적어 주세요'],
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
