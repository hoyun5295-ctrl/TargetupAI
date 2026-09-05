/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 대량 업로드(엑셀 양식 생성 + 파싱) CT
 * Harold 지시(0824): CSV가 아니라 엑셀(.xlsx/.xls). 양식 파일 안에 입력 열 **옆에 작성 예시**를 함께 넣는다.
 *
 * - 양식 생성 = ExcelJS(서식 지원 · xlsx-writer CT와 같은 선택 근거). 입력 = A~C열, 예시·업종 목록 = E열부터(파서는 A~C만 읽는다).
 * - 파싱 = SheetJS(xlsx) — 기존 upload/customers 라우트와 같은 라이브러리(.xls 옛 포맷까지 읽는다).
 * - 업종은 화면 셀렉트와 같은 한글 라벨을 그대로 적는다(라벨 → 코드 역매핑 · 빈 값 허용).
 * - 1회 상한 20행(폭주 방지 · 초과분은 사유와 함께 거절 목록으로).
 */
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { INDUSTRY_CODES, INDUSTRY_LABELS, type IndustryCode } from './industry-codes';

export const OUTREACH_BULK_MAX_ROWS = 20;

export interface OutreachBulkRow {
  companyName: string;
  homepageUrl: string;
  industryCategory: string | null;
}

export interface OutreachBulkParseResult {
  rows: OutreachBulkRow[];
  rejected: Array<{ line: number; reason: string }>;
  /** ★ C-6 거절 목록 상한(50) 초과분 수 — 응답 크기 폭주 방지 */
  rejectedOverflow: number;
}

export const OUTREACH_BULK_REJECT_CAP = 50;

const LABEL_TO_CODE: Record<string, IndustryCode> = Object.fromEntries(
  INDUSTRY_CODES.map((c) => [INDUSTRY_LABELS[c], c]),
) as Record<string, IndustryCode>;

// xlsx-writer CT의 스타일 값 미러(그 CT는 단일 표 스펙 전용이라 이 양식 구조에는 못 쓰고, 색만 맞춘다)
const HEADER_FILL = 'FF1F2937';
const HEADER_FONT = 'FFFFFFFF';
const CAPTION_FONT = 'FF6B7280';
const EXAMPLE_FONT = 'FF9CA3AF';
const BORDER_COLOR = 'FFE5E7EB';

/** 업로드 양식 xlsx — 입력 3열(A~C) + 옆(E~G) 작성 예시 + 업종 라벨 목록 + 업종 셀 드롭다운 */
export async function buildOutreachTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '한줄로';
  const ws = wb.addWorksheet('업체 목록');

  const thin = { style: 'thin' as const, color: { argb: BORDER_COLOR } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  // 입력 헤더(A1:C1)
  const headers = ['업체명', '홈페이지', '업종 (선택)'];
  headers.forEach((h, i) => {
    const c = ws.getCell(1, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: HEADER_FONT } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = border;
  });
  ws.getRow(1).height = 22;

  // 입력 영역(A2:C21) — 빈 칸 + 테두리 + 업종 드롭다운
  const industryList = INDUSTRY_CODES.map((c) => INDUSTRY_LABELS[c]).join(',');
  for (let r = 2; r <= 1 + OUTREACH_BULK_MAX_ROWS; r++) {
    for (let col = 1; col <= 3; col++) ws.getCell(r, col).border = border;
    ws.getCell(r, 3).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${industryList}"`],
      showErrorMessage: true,
      errorTitle: '업종',
      error: '목록에 있는 업종을 선택하거나 비워 두세요.',
    };
  }

  // 옆(E열~) 작성 예시 — Harold 지시: 양식 안에 예시를 함께
  const exTitle = ws.getCell(1, 5);
  exTitle.value = '작성 예시 (이 영역은 지우지 않아도 됩니다 · 읽지 않습니다)';
  exTitle.font = { bold: true, size: 11, color: { argb: CAPTION_FONT } };
  ws.mergeCells(1, 5, 1, 7);
  const examples = [
    ['힐링뷰티', 'www.healingbeauty.co.kr', '뷰티/화장품'],
    ['어반핏', 'urbanfit.kr', '패션/의류/잡화'],
    ['모던리빙', 'www.modernliving.co.kr', '(비워도 됩니다)'],
  ];
  examples.forEach((row, i) => {
    row.forEach((v, j) => {
      const c = ws.getCell(2 + i, 5 + j);
      c.value = v;
      c.font = { color: { argb: EXAMPLE_FONT } };
      c.border = border;
    });
  });

  const guide = ws.getCell(6, 5);
  guide.value = '업종은 아래 목록의 표기를 그대로 쓰거나 비워 두세요(비우면 홈페이지에서 읽은 값을 씁니다). 한 번에 최대 20곳.';
  guide.font = { size: 10, color: { argb: CAPTION_FONT } };
  ws.mergeCells(6, 5, 6, 8);
  INDUSTRY_CODES.forEach((code, i) => {
    const c = ws.getCell(7 + i, 5);
    c.value = INDUSTRY_LABELS[code];
    c.font = { size: 10, color: { argb: CAPTION_FONT } };
  });

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 20;
  ws.getColumn(5).width = 24;
  ws.getColumn(6).width = 34;
  ws.getColumn(7).width = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** 업로드 파일 파싱 — A~C열만 읽는다(예시 영역 무시). 행별 거절 사유를 정직하게 돌려준다. */
export function parseOutreachBulkXlsx(fileBuffer: Buffer): OutreachBulkParseResult {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], rejected: [{ line: 0, reason: '시트를 찾을 수 없습니다.' }], rejectedOverflow: 0 };
  const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });

  const rows: OutreachBulkRow[] = [];
  const rejected: Array<{ line: number; reason: string }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const line = i + 1;
    const cells = raw[i] || [];
    const name = String(cells[0] ?? '').trim();
    const url = String(cells[1] ?? '').trim();
    const industryLabel = String(cells[2] ?? '').trim();

    if (!name && !url) continue;                       // 빈 줄
    if (i === 0 && name === '업체명') continue;        // 헤더 줄
    if (!name) { rejected.push({ line, reason: '업체명이 비어 있습니다.' }); continue; }
    if (!url) { rejected.push({ line, reason: '홈페이지 주소가 비어 있습니다.' }); continue; }
    if (name.length > 100) { rejected.push({ line, reason: '업체명이 100자를 넘습니다.' }); continue; }

    let industryCategory: string | null = null;
    if (industryLabel) {
      const code = LABEL_TO_CODE[industryLabel];
      if (!code) { rejected.push({ line, reason: `업종 표기를 알 수 없습니다: ${industryLabel.slice(0, 20)}` }); continue; }
      industryCategory = code;
    }

    const dupKey = `${name}|${url}`.toLowerCase();
    if (seen.has(dupKey)) { rejected.push({ line, reason: '같은 업체가 위에 이미 있습니다.' }); continue; }
    seen.add(dupKey);

    if (rows.length >= OUTREACH_BULK_MAX_ROWS) {
      rejected.push({ line, reason: `1회 상한(${OUTREACH_BULK_MAX_ROWS}곳)을 넘어 제외했습니다. 다음 파일로 나눠 올려주세요.` });
      continue;
    }
    rows.push({ companyName: name, homepageUrl: url, industryCategory });
  }

  const rejectedOverflow = Math.max(0, rejected.length - OUTREACH_BULK_REJECT_CAP);
  return { rows, rejected: rejected.slice(0, OUTREACH_BULK_REJECT_CAP), rejectedOverflow };
}
