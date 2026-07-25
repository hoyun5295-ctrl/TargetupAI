import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildXlsxBuffer, xlsxContentDisposition, XLSX_CONTENT_TYPE } from './xlsx-writer';
import { buildManageStatsXlsx, buildManageStatsCsv, buildManageStatsRows, MANAGE_STATS_COLUMNS } from './manage-stats-export';

/** 생성한 버퍼를 실제로 다시 열어 확인한다 — "파일이 만들어졌다"가 아니라 "엑셀이 읽는다"가 검증 기준이다. */
async function load(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return wb.worksheets[0];
}

describe('buildXlsxBuffer — 고객 대상 엑셀 생성 (2026-07-25)', () => {
  it('생성한 버퍼를 다시 열 수 있다', async () => {
    const buf = await buildXlsxBuffer({
      sheetName: '테스트시트',
      columns: [{ header: '이름' }, { header: '수량', numeric: true }],
      rows: [['가', 10], ['나', 20]],
    });
    expect(buf.length).toBeGreaterThan(0);
    const ws = await load(buf);
    expect(ws.name).toBe('테스트시트');
  });

  it('★ 숫자 열은 문자가 아니라 실제 number로 들어간다 — 엑셀에서 합계가 먹어야 정산 대조가 된다', async () => {
    const ws = await load(await buildXlsxBuffer({
      sheetName: 'S',
      columns: [{ header: '이름' }, { header: '수량', numeric: true }],
      rows: [['가', 308043]],
    }));
    const cell = ws.getCell(2, 2); // 제목 없음 → 1행 헤더, 2행 첫 데이터
    expect(typeof cell.value).toBe('number');
    expect(cell.value).toBe(308043);
    expect(cell.numFmt).toBe('#,##0');
  });

  it('헤더는 굵게·고정되고 자동필터가 걸린다', async () => {
    const ws = await load(await buildXlsxBuffer({
      sheetName: 'S',
      columns: [{ header: 'A' }, { header: 'B' }],
      rows: [['1', '2']],
    }));
    expect(ws.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(ws.views?.[0]?.state).toBe('frozen');
    expect(ws.views?.[0]?.ySplit).toBe(1);
    expect(ws.autoFilter).toBeTruthy();
  });

  it('제목·설명이 있으면 표가 그 아래에서 시작한다', async () => {
    const ws = await load(await buildXlsxBuffer({
      sheetName: 'S',
      title: '발송통계 2026-07-01 ~ 2026-07-31',
      caption: '청구 기준 집계',
      columns: [{ header: '유형' }, { header: '성공', numeric: true }],
      rows: [['SMS', 95]],
    }));
    expect(ws.getCell(1, 1).value).toBe('발송통계 2026-07-01 ~ 2026-07-31');
    expect(ws.getCell(2, 1).value).toBe('청구 기준 집계');
    expect(ws.getCell(4, 1).value).toBe('유형'); // 제목·설명·빈줄 다음이 헤더
    expect(ws.getCell(5, 2).value).toBe(95);
    expect(ws.views?.[0]?.ySplit).toBe(4);
  });

  it('행이 0건이어도 헤더만으로 정상 생성된다 — 빈 파일이 열리지 않으면 사용자는 오류로 읽는다', async () => {
    const ws = await load(await buildXlsxBuffer({
      sheetName: 'S', columns: [{ header: 'A' }], rows: [],
    }));
    expect(ws.getCell(1, 1).value).toBe('A');
    expect(ws.autoFilter).toBeFalsy();
  });

  it('한글 파일명은 RFC 5987로 보존되고 ASCII 폴백이 함께 나간다', () => {
    const d = xlsxContentDisposition('발송통계_2026-07-01_2026-07-31.xlsx');
    expect(d).toContain("filename*=UTF-8''");
    expect(d).toContain(encodeURIComponent('발송통계_2026-07-01_2026-07-31.xlsx'));
    expect(d).toMatch(/filename="[\x20-\x7E]+"/); // 폴백은 ASCII만
    expect(XLSX_CONTENT_TYPE).toContain('spreadsheetml.sheet');
  });
});

describe('발송통계 xlsx — CSV와 같은 행을 쓴다 (2026-07-25)', () => {
  const input = {
    webRows: [
      { period: '2026-07', type_label: 'SMS', sent: 100, success: 95, fail: 5, pending: 0 },
      { period: '2026-07', type_label: '카카오알림톡', sent: 20, success: 16, fail: 4, pending: 0 },
    ],
    testRows: [{ period: '2026-07', type_label: '테스트 SMS', sent: 3, success: 3, fail: 0 }],
    agentRows: [{
      period: '2026-07', agent_send_id: 'B0069', cust_name: '마리오아울렛_EBIZ', store_id: '200',
      type_label: '카카오알림톡', sent: 175, success: 173, fail: 2, pending: 0,
    }],
  };

  it('★ xlsx 데이터 행이 CSV 데이터 행과 정확히 같다 — 형식이 둘이어도 숫자는 하나여야 한다', async () => {
    const ws = await load(await buildManageStatsXlsx(input, { title: 'T', caption: 'C' }));
    const rows = buildManageStatsRows(input);
    const headerIdx = 4; // 제목 + 설명 + 빈줄 + 헤더
    rows.forEach((expected, i) => {
      const actual = (ws.getRow(headerIdx + 1 + i).values as any[]).slice(1);
      expect(actual.map((v) => (v === undefined || v === null ? '' : v))).toEqual(expected);
    });
    // CSV도 같은 행에서 나온다
    const csv = buildManageStatsCsv(input);
    expect(csv.split('\n')).toHaveLength(rows.length + 1); // 헤더 + 데이터
  });

  it('채널 열이 웹·테스트·에이전트를 구분한다', async () => {
    const ws = await load(await buildManageStatsXlsx(input, {}));
    const channels = [2, 3, 4, 5].map((r) => ws.getCell(r, 1).value); // 제목 없음 → 1행 헤더
    expect(channels).toEqual(['웹', '웹', '테스트', '에이전트']);
  });

  it('수량 4열이 numeric으로 지정돼 있다', () => {
    const numeric = MANAGE_STATS_COLUMNS.filter((c) => c.numeric).map((c) => c.header);
    expect(numeric).toEqual(['전송', '성공', '실패', '대기']);
  });
});
