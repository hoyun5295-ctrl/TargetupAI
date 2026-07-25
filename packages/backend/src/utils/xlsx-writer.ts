/**
 * xlsx-writer.ts — 고객 대상 엑셀(.xlsx) 생성 컨트롤타워 (★ 2026-07-25 신설)
 *
 * 신설 사유(Harold 지시): 고객사에 나가는 표는 **CSV가 아니라 엑셀 파일**이어야 한다.
 *   CSV는 서식이 없어 헤더가 본문과 구분되지 않고, 숫자가 문자로 읽히고, 열 너비가 뭉개진다.
 *   `LESSONS_BACKEND.md`에 이미 "고객 대상 xlsx = exceljs, SheetJS(xlsx) 무료판은 서식 미지원"이
 *   적혀 있었는데 발송통계가 CSV로 나가고 있었다 — 그 룰을 코드로 되돌린다.
 *
 * 설계 원칙: **행 생성과 출력을 분리한다.**
 *   행을 만드는 쪽(manage-stats-export.ts)은 순수 함수로 두고, 이 파일은 그 행을 받아 서식만 입힌다.
 *   그래야 같은 행이 CSV로도 xlsx로도 나가며 두 파일의 숫자가 갈릴 수 없다.
 *   정산 대조 파일이라 "형식이 달라 숫자가 다르다"가 생기면 안 된다.
 */

import ExcelJS from 'exceljs';

export interface XlsxColumnSpec {
  /** 표시 헤더 */
  header: string;
  /** 열 너비(문자 수 기준). 미지정 시 헤더 길이 기반 자동 */
  width?: number;
  /** 숫자 열이면 천 단위 구분 + 오른쪽 정렬 */
  numeric?: boolean;
}

export interface XlsxSheetSpec {
  sheetName: string;
  /** 표 위에 얹는 제목 줄(기간·회사명 등). 없으면 표만 나간다. */
  title?: string;
  /** 제목 아래 작은 설명 줄(집계 기준 명시 — 정산 대조 시 오해 차단) */
  caption?: string;
  columns: XlsxColumnSpec[];
  rows: Array<Array<string | number>>;
}

const HEADER_FILL = 'FF1F2937';   // 진회색
const HEADER_FONT = 'FFFFFFFF';
const TITLE_FONT = 'FF111827';
const CAPTION_FONT = 'FF6B7280';
const BORDER_COLOR = 'FFE5E7EB';

/**
 * 시트 하나짜리 xlsx 버퍼를 만든다.
 *
 * 숫자 열은 실제 number로 기록한다 — 문자열로 넣으면 엑셀에서 합계·필터가 안 먹어
 * 담당자가 정산 대조를 못 한다(CSV의 고질적 문제가 그것이었다).
 */
export async function buildXlsxBuffer(spec: XlsxSheetSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '한줄로';
  const ws = wb.addWorksheet(spec.sheetName || 'Sheet1', {
    views: [{ state: 'frozen', ySplit: 0 }], // headerRow 확정 후 아래에서 다시 지정
  });

  const colCount = spec.columns.length;
  let cursor = 0;

  if (spec.title) {
    cursor += 1;
    ws.mergeCells(cursor, 1, cursor, colCount);
    const c = ws.getCell(cursor, 1);
    c.value = spec.title;
    c.font = { bold: true, size: 14, color: { argb: TITLE_FONT } };
    c.alignment = { vertical: 'middle' };
    ws.getRow(cursor).height = 24;
  }
  if (spec.caption) {
    cursor += 1;
    ws.mergeCells(cursor, 1, cursor, colCount);
    const c = ws.getCell(cursor, 1);
    c.value = spec.caption;
    c.font = { size: 10, color: { argb: CAPTION_FONT } };
    c.alignment = { vertical: 'middle' };
  }
  if (spec.title || spec.caption) cursor += 1; // 표와 한 줄 띄운다

  const headerRowIdx = cursor + 1;
  const headerRow = ws.getRow(headerRowIdx);
  headerRow.values = spec.columns.map((c) => c.header);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER_COLOR } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
      left: { style: 'thin', color: { argb: BORDER_COLOR } },
      right: { style: 'thin', color: { argb: BORDER_COLOR } },
    };
  });
  headerRow.height = 22;
  headerRow.commit();

  spec.rows.forEach((r, i) => {
    const row = ws.getRow(headerRowIdx + 1 + i);
    row.values = r as any[];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const col = spec.columns[colNumber - 1];
      cell.border = {
        top: { style: 'hair', color: { argb: BORDER_COLOR } },
        bottom: { style: 'hair', color: { argb: BORDER_COLOR } },
        left: { style: 'hair', color: { argb: BORDER_COLOR } },
        right: { style: 'hair', color: { argb: BORDER_COLOR } },
      };
      if (col?.numeric) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      } else {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    });
    row.commit();
  });

  spec.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? Math.max(10, String(c.header).length * 2 + 2);
  });

  // 헤더 아래 고정 + 자동 필터 — 회사·유형이 섞인 정산 대조 파일에서 필수
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  if (spec.rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: headerRowIdx + spec.rows.length, column: colCount },
    };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** 엑셀 다운로드 응답 헤더 — 파일명은 RFC 5987로 한글 보존 */
export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function xlsxContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
