// ============================================================
// crm-agency-template.ts — 캠페인대행요청서 xlsx 디자인 빌더 (exceljs)
// ============================================================
// 고객사(비즈니스+ 300만원 요금제)에 나가는 문서 — 처음부터 완성 퀄리티 원칙.
// 라벨 원문 = crm-agency-request AGENCY_REQUEST_LABELS 단일 진실(파서 호환 절대 유지):
//   · 라벨은 A열 원문 그대로 / 값은 B열(B:E 병합 시 B에 저장 — sheet_to_json r[1])
//   · productsHeader 행 +1 = 표 헤더, +2부터 상품 데이터 (parseRequestSheet 고정 구조)
import ExcelJS from 'exceljs';
import { AGENCY_REQUEST_LABELS } from './crm-agency-request';

const VIOLET = 'FF7C3AED';
const VIOLET_DARK = 'FF5B21B6';
const VIOLET_BG = 'FFEDE9FE';
const VIOLET_BG_LIGHT = 'FFF5F3FF';
const LABEL_BG = 'FFFAFAFB';
const BORDER = 'FFD1D5DB';
const TEXT = 'FF374151';
const TEXT_MUTED = 'FF6B7280';

const thin = { style: 'thin' as const, color: { argb: BORDER } };
const boxBorder = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

export async function buildRequestTemplateXlsx(): Promise<Buffer> {
  const L = AGENCY_REQUEST_LABELS;
  const wb = new ExcelJS.Workbook();
  wb.creator = '한줄로';
  const ws = wb.addWorksheet('캠페인대행요청서', {
    properties: { tabColor: { argb: VIOLET }, defaultRowHeight: 20 },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 40 }, { width: 19 }, { width: 19 }, { width: 19 }, { width: 19 }];

  // 타이틀 배너
  ws.mergeCells('A1:E1');
  const title = ws.getCell('A1');
  title.value = '한줄로 캠페인 대행 요청서';
  title.fill = fill(VIOLET);
  title.font = { name: '맑은 고딕', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 40;

  // 안내
  ws.mergeCells('A2:E2');
  const guide = ws.getCell('A2');
  guide.value = '※ (필수) 항목을 채우신 후, 이 파일을 그대로 업로드해 주세요. 접수 후 한줄로 운영팀이 분석해 마케팅 제안서를 전달해 드립니다.';
  guide.fill = fill(VIOLET_BG_LIGHT);
  guide.font = { name: '맑은 고딕', size: 9, color: { argb: TEXT_MUTED } };
  guide.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 24;

  ws.getRow(3).height = 8; // 여백

  // 섹션 1 — 행사 정보
  ws.mergeCells('A4:E4');
  const sec1 = ws.getCell('A4');
  sec1.value = '1. 행사 정보';
  sec1.fill = fill(VIOLET_BG);
  sec1.font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: VIOLET_DARK } };
  sec1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(4).height = 24;

  const fieldRows: Array<{ label: string; required: boolean; height: number }> = [
    { label: L.title, required: true, height: 26 },
    { label: L.periodStart, required: true, height: 26 },
    { label: L.periodEnd, required: true, height: 26 },
    { label: L.description, required: true, height: 52 },
    { label: L.benefit, required: true, height: 32 },
    { label: L.channels, required: false, height: 26 },
    { label: L.budget, required: false, height: 26 },
    { label: L.note, required: false, height: 40 },
  ];
  let r = 5;
  for (const f of fieldRows) {
    const row = ws.getRow(r);
    row.height = f.height;
    const labelCell = row.getCell(1);
    labelCell.value = f.label;                       // ★ 라벨 원문 그대로 (파서 호환)
    labelCell.fill = fill(LABEL_BG);
    labelCell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: f.required ? VIOLET_DARK : TEXT } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    labelCell.border = boxBorder;
    ws.mergeCells(r, 2, r, 5);                       // 입력 칸 B:E 병합 (값은 B에 저장 — 파서 r[1])
    const input = row.getCell(2);
    input.fill = fill('FFFFFFFF');
    input.font = { name: '맑은 고딕', size: 10 };
    input.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    input.border = boxBorder;
    r += 1;
  }

  ws.getRow(r).height = 8; r += 1;                    // 여백

  // 섹션 2 — 상품 표 (productsHeader 행 +1 = 표 헤더, +2부터 데이터 — 파서 고정 구조)
  ws.mergeCells(r, 1, r, 5);
  const sec2 = ws.getCell(r, 1);
  sec2.value = L.productsHeader;                      // ★ 라벨 원문 그대로
  sec2.fill = fill(VIOLET_BG);
  sec2.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: VIOLET_DARK } };
  sec2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 24;
  r += 1;

  const th = ws.getRow(r);
  th.height = 22;
  (['상품명', '정가(원)', '할인가(원)'] as const).forEach((t, i) => {
    const c = th.getCell(i + 1);
    c.value = t;
    c.fill = fill(VIOLET_BG_LIGHT);
    c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: TEXT } };
    c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', indent: i === 0 ? 1 : 0 };
    c.border = boxBorder;
  });
  r += 1;

  for (let i = 0; i < 5; i++) {
    const row = ws.getRow(r + i);
    row.height = 24;
    for (let col = 1; col <= 3; col++) {
      const c = row.getCell(col);
      c.fill = fill('FFFFFFFF');
      c.font = { name: '맑은 고딕', size: 10 };
      c.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'right', wrapText: true, indent: 1 };
      c.border = boxBorder;
    }
  }
  r += 5;

  // 푸터
  ws.getRow(r).height = 8; r += 1;
  ws.mergeCells(r, 1, r, 5);
  const footer = ws.getCell(r, 1);
  footer.value = '문의: 한줄로 고객센터 1800-8125 · 본 요청서는 캠페인 설계 대행(비즈니스 요금제 전용 서비스)에만 사용됩니다.';
  footer.font = { name: '맑은 고딕', size: 8, color: { argb: TEXT_MUTED } };
  footer.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
