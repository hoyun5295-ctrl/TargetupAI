/**
 * ★2026-09-13(3) 대행발송 엑셀 날짜 셀 — 엑셀에 보이는 벽시계 그대로 읽는다
 *
 * xlsx 0.18.5 `cellDates:true`는 서버 시간대(KST)에서 52초 이른 Date를 만든다(0913 실측).
 *  · 명단 값: Date → 저장형 ISO(UTC) → 고객 문자에 "2026-09-01T05:29:08.000Z"가 들어갔다
 *  · 요청서 보낼 시각: 14:30 셀 → "14:29", 날짜만 셀 → 전날 "23:59"로 조용히 접수됐다
 * 일련번호를 달력 산술(SSF)로 풀어 시간대를 거치지 않는다.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { formatSheetDateCode } from '../normalize';
import { parseAgencyRecipientList, parseAgencyRequestForm } from '../agency-send-form';

type Cell = string | number | { t: 'n'; v: number; z: string };

function book(sheetName: string, rows: Cell[][]): Buffer {
  const ws: Record<string, any> = {};
  rows.forEach((r, ri) => r.forEach((c, ci) => {
    const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
    ws[addr] = typeof c === 'object' ? { ...c } : typeof c === 'number' ? { t: 'n', v: c } : { t: 's', v: c };
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: Math.max(...rows.map((r) => r.length)) - 1 } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// 2026-09-01 = 46266 · 14:30 = 0.6041666667
const DATE_TIME = { t: 'n' as const, v: 46266.6041666667, z: 'yyyy-mm-dd hh:mm' };
const DATE_ONLY = { t: 'n' as const, v: 46266, z: 'yyyy-mm-dd' };

describe('formatSheetDateCode', () => {
  it('날짜만 · 날짜+시각 · 시각만 · 초', () => {
    expect(formatSheetDateCode({ D: 46266, y: 2026, m: 9, d: 1, H: 0, M: 0, S: 0 })).toBe('2026-09-01');
    expect(formatSheetDateCode({ D: 46266, y: 2026, m: 9, d: 1, H: 14, M: 30, S: 0 })).toBe('2026-09-01 14:30');
    expect(formatSheetDateCode({ D: 0, y: 1900, m: 1, d: 0, H: 14, M: 30, S: 0 })).toBe('14:30');
    expect(formatSheetDateCode({ D: 46266, y: 2026, m: 9, d: 1, H: 14, M: 30, S: 1 })).toBe('2026-09-01 14:30:01');
  });
});

describe('명단: 날짜 셀은 엑셀에 보이는 벽시계 글자로 읽는다', () => {
  it('날짜+시각 · 날짜만 · 시각만(서식 무관) · 숫자와 문자는 종전 그대로', () => {
    const buf = book('고객명단', [
      ['전화번호', '방문일시', '생일', '마감', '시각', '포인트'],
      ['01000001111', DATE_TIME, { t: 'n', v: 32874, z: 'yyyy-mm-dd' }, { t: 'n', v: 46266.6041666667, z: 'm/d/yy h:mm' }, { t: 'n', v: 0.6041666667, z: 'h:mm' }, 1200],
    ]);
    const list = parseAgencyRecipientList(buf);
    expect(list.rows[0]['방문일시']).toBe('2026-09-01 14:30');
    expect(list.rows[0]['생일']).toBe('1990-01-01');
    expect(list.rows[0]['마감']).toBe('2026-09-01 14:30');
    expect(list.rows[0]['시각']).toBe('14:30');
    expect(list.rows[0]['포인트']).toBe(1200);
    expect(list.rows[0]['전화번호']).toBe('01000001111');
    expect(Object.values(list.rows[0]).some((v) => v instanceof Date)).toBe(false);
  });
});

describe('요청서: 보낼 시각 날짜 셀', () => {
  it('14:30 셀은 14:30으로 읽는다(1분 이르게 접수되지 않는다)', () => {
    const f = parseAgencyRequestForm(book('요청서', [['보낼 시각', DATE_TIME]]));
    expect(f.requestedAtText).toBe('2026-09-01 14:30');
    expect(f.requestedAt?.getHours()).toBe(14);
    expect(f.requestedAt?.getMinutes()).toBe(30);
  });

  it('날짜만 적힌 셀은 전날 23:59로 조용히 접수하지 않고 읽지 못했다고 반려한다', () => {
    const f = parseAgencyRequestForm(book('요청서', [['보낼 시각', DATE_ONLY]]));
    expect(f.requestedAtText).toBe('2026-09-01');
    expect(f.requestedAt).toBeNull();
    expect(f.errors.some((e) => e.field === '보낼 시각')).toBe(true);
  });
});
