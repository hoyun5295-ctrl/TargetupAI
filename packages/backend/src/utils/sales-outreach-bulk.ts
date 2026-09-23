/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 대량 업로드(엑셀 양식 생성 + 파싱) CT
 * Harold 지시(0824): CSV가 아니라 엑셀(.xlsx/.xls). 양식 파일 안에 입력 열 **옆에 작성 예시**를 함께 넣는다.
 *
 * - 양식 생성 = ExcelJS(서식 지원 · xlsx-writer CT와 같은 선택 근거). 입력 = A~G열, 예시·목록 = I열부터(파서는 머리줄이 가리키는 열만 읽는다).
 * - 파싱 = SheetJS(xlsx) — 기존 upload/customers 라우트와 같은 라이브러리(.xls 옛 포맷까지 읽는다).
 * - 업종은 화면 셀렉트와 같은 한글 라벨을 그대로 적는다(라벨 → 코드 역매핑 · 빈 값 허용).
 * - 1회 상한 20행(폭주 방지 · 초과분은 사유와 함께 거절 목록으로).
 * - ★ 2026-09-23 설계서 docs/2026-09-23-outreach-direct-send-design.md §10 — 네이버 스토어 · 담당자 이메일 · 담당자명 · 수신 근거 열 추가.
 *   파서는 **머리줄 이름으로 열을 찾는다**(옛 3열 양식도 그대로 읽힌다). 이메일·스토어 형식 오류는 행 거절이 아니라 그 칸만 비우고
 *   warnings(거절 목록과 별도)에 남긴다 — 행은 등록되는데 거절 목록에 뜨면 거짓 표시다(§16-7 계약). 근거 공란은 제작은 되고 발송만 잠긴다.
 */
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { INDUSTRY_CODES, INDUSTRY_LABELS, type IndustryCode } from './industry-codes';
import { normalizeContactEmail, normalizeContactName, normalizeContactBasis, parseNaverStoreSlug, CONTACT_BASIS_PRESETS } from './sales-outreach-direct';

export const OUTREACH_BULK_MAX_ROWS = 20;

export interface OutreachBulkRow {
  companyName: string;
  homepageUrl: string;
  industryCategory: string | null;
  /** ★ 2026-09-23 저장값(brand:slug · smartstore:slug) · 없으면 null */
  naverStore: string | null;
  contactEmail: string | null;
  contactName: string | null;
  contactBasis: string | null;
}

export interface OutreachBulkParseResult {
  rows: OutreachBulkRow[];
  rejected: Array<{ line: number; reason: string }>;
  /** ★ C-6 거절 목록 상한(50) 초과분 수 — 응답 크기 폭주 방지 */
  rejectedOverflow: number;
  /** ★ 2026-09-23 등록은 됐지만 칸 하나를 비운 줄(거절과 별도) */
  warnings: Array<{ line: number; reason: string }>;
  /** 양식 판정 — 머리줄로 열을 찾았는가(v2) · 옛 3열 위치 파싱(legacy) */
  format: 'v2' | 'legacy';
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

/** 양식 머리줄(입력 7열) — 파서의 열 찾기 표와 짝이다 */
export const OUTREACH_BULK_HEADERS = ['업체명', '홈페이지', '업종 (선택)', '네이버 스토어 (선택)', '담당자 이메일', '담당자명 (선택)', '수신 근거'] as const;
const INPUT_COLS = OUTREACH_BULK_HEADERS.length;
const EXAMPLE_COL = INPUT_COLS + 2; // 한 열 띄우고 예시(I열)

type Field = 'name' | 'url' | 'industry' | 'store' | 'email' | 'contactName' | 'basis';

/** 머리줄 칸 → 필드(공백·괄호·"선택" 제거 후 정확 일치 · 흔한 별칭 포함) */
const HEADER_ALIASES: Record<string, Field> = {
  업체명: 'name', 회사명: 'name', 브랜드명: 'name',
  홈페이지: 'url', 홈페이지주소: 'url', 공식몰: 'url',
  업종: 'industry',
  네이버스토어: 'store', 스마트스토어: 'store', 브랜드스토어: 'store', 네이버스마트스토어: 'store', 네이버브랜드스토어: 'store',
  담당자이메일: 'email', 이메일: 'email', 담당자메일: 'email', 메일: 'email',
  담당자명: 'contactName', 담당자: 'contactName', 담당자이름: 'contactName',
  수신근거: 'basis', 근거: 'basis', 주소근거: 'basis',
};

function headerKey(v: unknown): string {
  return String(v ?? '').replace(/\(선택\)/g, '').replace(/[\s()]/g, '').trim();
}

/** 첫 줄이 머리줄이면 필드 → 열 번호. 업체명·홈페이지 둘 다 있어야 머리줄로 인정(아니면 null = 옛 위치 파싱). */
export function mapBulkHeader(firstRow: readonly unknown[]): Partial<Record<Field, number>> | null {
  const map: Partial<Record<Field, number>> = {};
  firstRow.forEach((cell, i) => {
    const f = HEADER_ALIASES[headerKey(cell)];
    if (f && map[f] === undefined) map[f] = i;
  });
  return map.name !== undefined && map.url !== undefined ? map : null;
}

/** 업로드 양식 xlsx — 입력 7열(A~G) + 옆(I~) 작성 예시 + 업종·근거 목록 + 드롭다운 */
export async function buildOutreachTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '한줄로';
  const ws = wb.addWorksheet('업체 목록');

  const thin = { style: 'thin' as const, color: { argb: BORDER_COLOR } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  OUTREACH_BULK_HEADERS.forEach((h, i) => {
    const c = ws.getCell(1, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: HEADER_FONT } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = border;
  });
  ws.getRow(1).height = 22;

  // 입력 영역(A2:G21) — 빈 칸 + 테두리 + 업종·근거 드롭다운(근거는 목록 밖 문장도 받는다)
  const industryList = INDUSTRY_CODES.map((c) => INDUSTRY_LABELS[c]).join(',');
  const basisList = CONTACT_BASIS_PRESETS.join(',');
  for (let r = 2; r <= 1 + OUTREACH_BULK_MAX_ROWS; r++) {
    for (let col = 1; col <= INPUT_COLS; col++) ws.getCell(r, col).border = border;
    ws.getCell(r, 3).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${industryList}"`],
      showErrorMessage: true, errorTitle: '업종', error: '목록에 있는 업종을 선택하거나 비워 두세요.',
    };
    ws.getCell(r, 7).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${basisList}"`],
      showErrorMessage: false,
    };
  }

  // 옆(I열~) 작성 예시 — Harold 지시: 양식 안에 예시를 함께
  const exTitle = ws.getCell(1, EXAMPLE_COL);
  exTitle.value = '작성 예시 (이 영역은 지우지 않아도 됩니다 · 읽지 않습니다)';
  exTitle.font = { bold: true, size: 11, color: { argb: CAPTION_FONT } };
  ws.mergeCells(1, EXAMPLE_COL, 1, EXAMPLE_COL + INPUT_COLS - 1);
  const examples = [
    ['힐링뷰티', 'www.healingbeauty.co.kr', '뷰티/화장품', 'brand.naver.com/healingbeauty', 'marketing@healingbeauty.co.kr', '김지은', '명함'],
    ['어반핏', 'urbanfit.kr', '패션/의류/잡화', '(비워도 됩니다)', 'partner@urbanfit.kr', '(비워도 됩니다)', '제휴 문의 페이지'],
    ['모던리빙', 'www.modernliving.co.kr', '(비워도 됩니다)', '(비워도 됩니다)', '(비우면 발송만 잠깁니다)', '', '기존 대화'],
  ];
  examples.forEach((row, i) => {
    row.forEach((v, j) => {
      const c = ws.getCell(2 + i, EXAMPLE_COL + j);
      c.value = v;
      c.font = { color: { argb: EXAMPLE_FONT } };
      c.border = border;
    });
  });

  const guides = [
    '담당자 이메일은 명함 · 기존 대화 · 제휴 문의 페이지처럼 알게 된 근거와 함께 적어 주세요. 근거가 비어 있으면 제작은 되고 발송만 잠깁니다.',
    '네이버 스토어 주소는 저장만 하고 지금은 읽지 않습니다(홈페이지를 읽어 만듭니다).',
    '업종은 아래 목록의 표기를 그대로 쓰거나 비워 두세요(비우면 홈페이지에서 읽은 값을 씁니다). 한 번에 최대 20곳.',
  ];
  guides.forEach((g, i) => {
    const c = ws.getCell(6 + i, EXAMPLE_COL);
    c.value = g;
    c.font = { size: 10, color: { argb: CAPTION_FONT } };
    ws.mergeCells(6 + i, EXAMPLE_COL, 6 + i, EXAMPLE_COL + INPUT_COLS - 1);
  });
  INDUSTRY_CODES.forEach((code, i) => {
    const c = ws.getCell(10 + i, EXAMPLE_COL);
    c.value = INDUSTRY_LABELS[code];
    c.font = { size: 10, color: { argb: CAPTION_FONT } };
  });

  const widths = [22, 30, 18, 30, 30, 16, 20];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; ws.getColumn(EXAMPLE_COL + i).width = w; });
  ws.getColumn(INPUT_COLS + 1).width = 3;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** 업로드 파일 파싱 — 머리줄이 가리키는 열만 읽는다(예시 영역 무시 · 머리줄이 없으면 옛 A~C 위치). 행별 거절·경고를 정직하게 돌려준다. */
export function parseOutreachBulkXlsx(fileBuffer: Buffer): OutreachBulkParseResult {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], rejected: [{ line: 0, reason: '시트를 찾을 수 없습니다.' }], rejectedOverflow: 0, warnings: [], format: 'legacy' };
  const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
  return parseOutreachBulkRows(raw);
}

/** 표(행 × 칸) → 결과(순수 · 행동 테스트 대상) */
export function parseOutreachBulkRows(raw: unknown[][]): OutreachBulkParseResult {
  const header = raw.length ? mapBulkHeader(raw[0] || []) : null;
  const col: Partial<Record<Field, number>> = header || { name: 0, url: 1, industry: 2 };
  const cell = (cells: unknown[], f: Field): string => (col[f] === undefined ? '' : String(cells[col[f]!] ?? '').trim());

  const rows: OutreachBulkRow[] = [];
  const rejected: Array<{ line: number; reason: string }> = [];
  const warnings: Array<{ line: number; reason: string }> = [];
  const seen = new Set<string>();

  for (let i = header ? 1 : 0; i < raw.length; i++) {
    const line = i + 1;
    const cells = raw[i] || [];
    const name = cell(cells, 'name');
    const url = cell(cells, 'url');
    const industryLabel = cell(cells, 'industry');
    const storeRaw = cell(cells, 'store');

    if (!name && !url) continue;                       // 빈 줄
    if (!header && i === 0 && name === '업체명') continue; // 옛 양식 머리줄
    if (!name) { rejected.push({ line, reason: '업체명이 비어 있습니다.' }); continue; }
    // 홈페이지 칸에 네이버 스토어 주소를 적은 경우 — 스토어는 읽지 않으므로(불변 50) 브랜드 홈페이지가 따로 필요하다
    if (url && parseNaverStoreSlug(url)) {
      rejected.push({ line, reason: '홈페이지 칸에 네이버 스토어 주소가 있습니다. 브랜드 홈페이지 주소를 홈페이지 칸에 적어주세요(스토어 주소는 스토어 칸에).' });
      continue;
    }
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

    // 선택 칸 — 형식이 틀리면 그 칸만 비우고 경고(행은 등록)
    let naverStore: string | null = null;
    if (storeRaw && !/^\(.*\)$/.test(storeRaw)) {
      const s = parseNaverStoreSlug(storeRaw);
      if (s) naverStore = s.value;
      else warnings.push({ line, reason: '네이버 스토어 주소 형식이 아니어서 비워 두었습니다.' });
    }
    const emailRaw = cell(cells, 'email');
    let contactEmail: string | null = null;
    if (emailRaw && !/^\(.*\)$/.test(emailRaw)) {
      contactEmail = normalizeContactEmail(emailRaw);
      if (!contactEmail) warnings.push({ line, reason: '담당자 이메일 형식이 올바르지 않아 비워 두었습니다(발송만 잠깁니다).' });
    }
    const contactName = normalizeContactName(/^\(.*\)$/.test(cell(cells, 'contactName')) ? '' : cell(cells, 'contactName'));
    const contactBasis = normalizeContactBasis(cell(cells, 'basis'));
    if (contactEmail && !contactBasis) warnings.push({ line, reason: '수신 근거가 비어 있어 발송만 잠깁니다(나중에 화면에서 적을 수 있습니다).' });

    rows.push({ companyName: name, homepageUrl: url, industryCategory, naverStore, contactEmail, contactName, contactBasis });
  }

  const rejectedOverflow = Math.max(0, rejected.length - OUTREACH_BULK_REJECT_CAP);
  return { rows, rejected: rejected.slice(0, OUTREACH_BULK_REJECT_CAP), rejectedOverflow, warnings: warnings.slice(0, OUTREACH_BULK_REJECT_CAP), format: header ? 'v2' : 'legacy' };
}
