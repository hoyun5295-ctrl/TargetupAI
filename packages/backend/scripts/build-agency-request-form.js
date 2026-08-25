/**
 * build-agency-request-form.js — 대행발송 요청서 양식 생성기 (★ 2026-08-25(3b))
 *
 * 산출물 = packages/frontend/public/agency-request-form.xlsx (고객이 화면에서 내려받는 그 파일).
 * 실행 = packages/backend 에서 `node scripts/build-agency-request-form.js` (exceljs는 backend 의존성).
 *
 * 왜 스크립트로 두나: 양식은 앞으로도 문구·항목이 바뀐다. 손으로 만든 xlsx만 남기면 다음 수정 때
 * 처음부터 다시 그려야 하고, 그때 파서 계약을 깨기 쉽다. 이 파일이 양식의 원본이다.
 *
 * ⛔ **시트 이름 "요청서" · A열 라벨 · B열 값** 규격은 파서(`utils/agency-send-form.ts`)와의 계약이다.
 *   라벨 문구를 바꾸면 파서의 FIELD_ALIASES도 같이 바꾸고, 바꾼 뒤 양식을 파서에 통과시켜 확인한다.
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

  // ══════════ 시트 1: 요청서 (파서가 읽는 시트) ══════════
  const ws = wb.addWorksheet('요청서', {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = [
    { key: 'label', width: 15 },
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
  st.value = '아래 파란 칸 여섯 개만 채워 주세요. 고객 명단은 별도 파일로 함께 올립니다.';
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

  const fields = [
    {
      label: '제목', value: '가을 신상 행사 안내', h: 24,
      help: '긴 문자(LMS)와 이미지 문자에 필요합니다. 짧은 문자만이면 비워도 됩니다.',
    },
    {
      label: '문안',
      value: '[한줄상회] %이름%님, 9월 1일(월) 오후 2시부터 가을 신상 행사를 엽니다.\n준비한 수량이 소진되면 조기 종료될 수 있습니다.',
      h: 64,
      help: '%열이름% 형태로 명단의 열 값을 넣을 수 있습니다(4개까지). 예: %이름%\n명단의 열 이름과 달라도 접수 확인 화면에서 맞출 수 있습니다.\n항목은 문안에만 넣고 제목에는 넣지 마세요.',
    },
    {
      label: '보낼 시각', value: '2026-09-01 14:00', h: 24,
      help: '연-월-일 시:분. 지금부터 3시간 뒤부터 정할 수 있습니다.',
    },
    {
      label: '회신번호', value: '0507-0000-0000', h: 24,
      help: '등록된 발신번호를 적습니다. 매장별로 다르게 보내려면 명단의 열 이름(예: 매장전화)을 적으세요.',
    },
    {
      label: '광고 여부', value: '예', h: 24, list: ['예', '아니오'],
      help: '기본은 예입니다. 광고면 (광고) 표시와 무료 수신거부 번호가 자동으로 붙습니다.',
    },
    {
      label: '담당자 번호', value: '010-0000-0000', h: 24,
      help: '검사를 통과한 문안을 이 번호로 먼저 보내 드립니다. 여러 명이면 쉼표로 나눠 적으세요.',
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
    lc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    const vc = ws.getCell(`B${r}`);
    vc.value = f.value;
    vc.font = { name: '맑은 고딕', size: 11, color: { argb: INK } };
    vc.border = boxAll(IND_LN);
    vc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    vc.numFmt = '@'; // 문자 그대로(시각을 엑셀이 날짜 셀로 바꾸지 않게)
    if (f.list) {
      vc.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${f.list.join(',')}"`], showErrorMessage: true, error: '예 또는 아니오만 고를 수 있습니다.' };
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
  foot.value = '작성 방법과 예시는 두 번째 시트(작성 안내)에 있습니다. 이 시트의 항목 이름과 자리는 바꾸지 마세요.';
  foot.font = { name: '맑은 고딕', size: 9, color: { argb: MUT } };
  foot.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 18;

  // ══════════ 시트 2: 작성 안내 ══════════
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
    ['진행 순서', '① 이 파일의 요청서 시트를 채웁니다  ② 고객 명단 파일을 준비합니다(첫 줄이 열 이름)  ③ 한줄로의 대행발송 화면에서 "요청서로 접수"에 두 파일을 올립니다  ④ 확인 화면에서 내용과 인원수를 보고 접수합니다  ⑤ 담당자 번호로 온 테스트 문자를 확인하고, 문자 속 주소나 화면에서 승인하면 발송이 예약됩니다'],
    ['회신번호', '두 가지 중 하나로 적습니다.\n1) 번호 직접: 등록된 발신번호를 적습니다. 예: 0507-0000-0000\n2) 명단의 열 이름: 예를 들어 "매장전화"라고 적으면 각 매장 번호로 나갑니다. 이때 회신번호 종류만큼 접수가 나뉘고, 건마다 검사와 승인이 따로 진행됩니다. 모든 번호는 발신번호로 미리 등록돼 있어야 합니다'],
    ['문안 항목', '%열이름%을 문안에 넣으면 고객마다 명단의 그 열 값으로 바뀝니다. 예: %이름%님 → 김하나님\n명단의 열 이름과 달라도 됩니다. 접수 확인 화면에서 AI가 맞는 열을 골라 두고, 직접 바꿀 수도 있습니다\n항목은 4개까지, 문안에만 넣을 수 있습니다(제목에는 넣지 않습니다)'],
    ['보낼 시각', '지금부터 3시간 뒤부터 정할 수 있습니다. 광고 문자는 심야 시간대에 보낼 수 없습니다'],
    ['광고 여부', '기본은 "예"입니다. 광고면 문자 앞에 (광고) 표시와 무료 수신거부 번호가 자동으로 붙습니다. 광고가 아닐 때만 "아니오"를 고르세요'],
    ['이미지 문자', '이미지는 파일에 넣지 않고, 접수 확인 화면의 "이미지 넣기"로 첨부합니다. 첨부하면 이미지 문자로 나갑니다'],
    ['고객 명단', '세 번째 시트(고객 명단 예시)의 모양처럼 첫 줄이 열 이름인 엑셀이나 CSV를 별도 파일로 올립니다. 휴대폰 번호 열은 자동으로 찾아 드리고, 확인 화면에서 바꿀 수도 있습니다'],
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

  // ══════════ 시트 3: 고객 명단 예시 ══════════
  const m = wb.addWorksheet('고객 명단 예시', { views: [{ showGridLines: false }] });
  m.columns = [{ width: 16 }, { width: 10 }, { width: 10 }, { width: 15 }];
  m.mergeCells('A1:D1');
  const mt = m.getCell('A1');
  mt.value = '고객 명단 예시 (이 모양의 별도 파일로 올립니다 · 열 이름은 자유)';
  mt.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: IND_DK } };
  mt.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IND_BG } };
  mt.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  m.getRow(1).height = 22;

  const mh = m.getRow(3);
  mh.values = ['휴대폰번호', '이름', '등급', '매장전화'];
  ['A3', 'B3', 'C3', 'D3'].forEach((addr) => {
    const c = m.getCell(addr);
    c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IND } };
    c.border = boxAll(IND_LN);
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  const sample = [
    ['010-0000-1111', '김하나', 'VIP', '02-000-0000'],
    ['010-0000-2222', '이두리', '일반', '031-000-0000'],
    ['010-0000-3333', '박세미', 'VIP', '02-000-0000'],
  ];
  sample.forEach((rowVals, i) => {
    const row = m.getRow(4 + i);
    row.values = rowVals;
    rowVals.forEach((_, k) => {
      const c = m.getCell(4 + i, k + 1);
      c.font = { name: '맑은 고딕', size: 10, color: { argb: INK } };
      c.border = boxAll(LINE);
      c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      c.numFmt = '@';
    });
  });

  const out = path.resolve(__dirname, '../../frontend/public/agency-request-form.xlsx');
  await wb.xlsx.writeFile(out);
  console.log('written:', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
