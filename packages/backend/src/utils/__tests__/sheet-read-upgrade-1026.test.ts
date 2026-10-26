/**
 * ★2026-10-26 의존성 보안판 — xlsx 0.18.5(npm · 프로토타입 오염 · ReDoS) → SheetJS 공식 0.20.3 회귀
 *
 * 고정 파일 3종(fixtures/sheet-upgrade-1026.xlsx · .xls · .csv)은 0.18.5 로 만들었다(휴대폰 = 도달 불가 010-0 대역).
 * 운영 코드의 읽기 옵션 묶음 그대로 읽고, 저장 직전 정규화(CT)를 지난 값이 엑셀에 보이는 값과 같은지 본다.
 *   업로드(upload.ts 4곳) · 수신거부(unsubscribes.ts) · DM 당첨자(dm.ts) · 영업 대량 등록(sales-outreach-bulk.ts) · 내보내기(customers · address-books)
 * 대행발송 읽기(agency-send-form.ts)는 sheet-date-cell.test.ts · agency-send-* 시험이 맡는다.
 * 날짜+시각 셀의 업로드 값(normalizeDate 올림)은 판과 무관한 기존 동작이라 여기서 고정하지 않는다.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import { normalizeDate, normalizePhone } from '../normalize';

// 운영(tsc → CommonJS)은 require('xlsx') = xlsx.js 를 연다. vitest 의 import 는 xlsx.mjs(파일 읽기에 set_fs 가 필요한 판)로 가므로
// 운영과 같은 판을 require 로 연다.
const XLSX: typeof import('xlsx') = createRequire(__filename)('xlsx');

const DIR = path.join(__dirname, 'fixtures');
const FILES = ['sheet-upgrade-1026.xlsx', 'sheet-upgrade-1026.xls', 'sheet-upgrade-1026.csv'];
const UPLOAD_OPTS = { type: 'file' as const, cellFormula: false, cellHTML: false, cellStyles: false, cellDates: true, raw: false, sheetStubs: false };
const UNSUB_OPTS = { type: 'file' as const, cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false, raw: false, sheetStubs: false };
const first = (wb: XLSX.WorkBook) => wb.Sheets[wb.SheetNames[0]];

describe.each(FILES)('엑셀 읽기 회귀 — %s', (file) => {
  const p = path.join(DIR, file);

  it('업로드 = 날짜만 셀 · 글자 날짜 · 휴대폰 · 숫자 · 쉼표 따옴표 메모', () => {
    const rows = XLSX.utils.sheet_to_json(first(XLSX.readFile(p, UPLOAD_OPTS)), { header: 1, defval: null }) as any[][];
    expect(rows[0]).toEqual(['이름', '휴대폰', '생일', '가입일시', '포인트', '메모']);
    expect(rows.slice(1).map((r) => normalizeDate(r[2]))).toEqual(['1990-05-15', '2000-01-01', '1985-12-31']);
    expect(rows.slice(1).map((r) => normalizePhone(r[1]))).toEqual(['01000000001', '01000000002', '01000000003']);
    expect(rows.slice(1).map((r) => r[0])).toEqual(['김하나', '이둘', '박셋']);
    expect(rows.slice(1).map((r) => r[4])).toEqual([12345, 0, 1234567.5]);
    expect(rows[3][5]).toBe('쉼표, "따옴표"');
    expect(rows[2][5]).toBeNull();
  });

  it('수신거부 = 첫 열 · 휴대폰 열을 그대로 읽는다', () => {
    const rows = XLSX.utils.sheet_to_json(first(XLSX.readFile(p, UNSUB_OPTS)), { header: 1, defval: null }) as any[][];
    expect(rows.slice(1).map((r) => normalizePhone(r[1]))).toEqual(['01000000001', '01000000002', '01000000003']);
  });

  it('DM 당첨자 = 머리줄을 열쇠로 읽는다', () => {
    const json = XLSX.utils.sheet_to_json(first(XLSX.read(fs.readFileSync(p), { type: 'buffer' }))) as any[];
    expect(json.map((r) => r['이름'])).toEqual(['김하나', '이둘', '박셋']);
    expect(json.map((r) => normalizePhone(r['휴대폰']))).toEqual(['01000000001', '01000000002', '01000000003']);
  });

  it('영업 대량 등록 = 보이는 글자로 읽는다(휴대폰 앞 0 유지)', () => {
    const rows = XLSX.utils.sheet_to_json(first(XLSX.read(fs.readFileSync(p), { type: 'buffer' })), { header: 1, raw: false, defval: '' }) as string[][];
    expect(rows[1][0]).toBe('김하나');
    expect(rows[1][1]).toBe('01000000001');
    expect(rows[3][1]).toBe('010-0000-0003');
    expect(rows[2][5]).toBe('');
  });
});

describe('엑셀 내보내기 회귀 (고객 DB · 주소록)', () => {
  it('json_to_sheet → xlsx 쓰기 → 다시 읽기 = 같은 값(휴대폰 글자 · 빈 칸 · 쉼표 따옴표)', () => {
    const ws = XLSX.utils.json_to_sheet([
      { 이름: '김하나', 휴대폰: '01000000001', 포인트: 12345, 메모: null },
      { 이름: '이둘', 휴대폰: '01000000002', 포인트: 0, 메모: '쉼표, "따옴표"' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '고객DB');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const back = XLSX.utils.sheet_to_json(XLSX.read(buf, { type: 'buffer' }).Sheets['고객DB'], { header: 1, defval: null });
    expect(back).toEqual([
      ['이름', '휴대폰', '포인트', '메모'],
      ['김하나', '01000000001', 12345, null],
      ['이둘', '01000000002', 0, '쉼표, "따옴표"'],
    ]);
  });
});
