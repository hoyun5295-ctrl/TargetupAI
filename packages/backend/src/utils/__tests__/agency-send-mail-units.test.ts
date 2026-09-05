/**
 * 대행발송 이메일 첨부 분류 계약 (★2026-09-05 §21-4 · 다중 접수 판정 경계)
 *
 * ⛔ 이 파일이 지키는 것 = **오늘 도는 두 경로가 한 글자도 안 바뀐다**.
 *   표 파일 1개(자립형) · 표 파일 2개(요청서 + 별도 명단)는 다중 신설 전후로 결과가 같아야 한다.
 *   다중은 **지금 100% 반려되던 조합**(자립형 2장 이상)에서만 열린다.
 *
 * 자립형 = 한 파일에 "내용"(또는 구양식 "요청서") 시트 + "고객리스트" 시트가 다 있는 통일 양식.
 *   구양식(요청서 + 별도 명단)은 hasRecipientSheet가 false라 자립형이 아니고, 따라서 다중에 못 든다.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildIntakeUnits, MAX_FORMS } from '../agency-send-mail-worker';

/** 시트 이름 목록으로 xlsx 버퍼 하나를 만든다(파서는 시트 이름으로 자립형을 판정한다) */
const book = (sheetNames: string[]): Buffer => {
  const wb = XLSX.utils.book_new();
  for (const name of sheetNames) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['구 분', '내 용'], ['문자타입', 'LMS']]), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const att = (filename: string, content: Buffer) => ({ filename, content });

/** 자립형 = 내용 + 고객리스트 */
const standalone = (name: string) => att(name, book(['내용', '고객리스트']));
/** 구양식 요청서 = 요청서 시트만(명단 없음) */
const oldForm = (name: string) => att(name, book(['요청서']));
/** 명단 전용 = 요청서로 안 읽힌다 */
const listOnly = (name: string) => att(name, book(['Sheet1']));

describe('buildIntakeUnits — 표 파일 1개 (오늘 도는 경로 · 무변경)', () => {
  it('자립형 1장이면 단건. formBuf와 listBuf가 같은 파일이다', () => {
    const r = buildIntakeUnits([standalone('요청서.xlsx')]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toHaveLength(1);
    expect(r.units[0].formBuf).toBe(r.units[0].listBuf);
    expect(r.units[0].listName).toBe('요청서.xlsx');
  });

  it('구양식 1장(명단 시트 없음)은 반려 — 오늘 사유 그대로', () => {
    const r = buildIntakeUnits([oldForm('요청서.xlsx')]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('form_not_identified');
  });

  it('요청서로 안 읽히는 파일 1장도 반려', () => {
    const r = buildIntakeUnits([listOnly('명단.xlsx')]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('form_not_identified');
  });
});

describe('buildIntakeUnits — 표 파일 2개 (오늘 도는 경로 · 무변경)', () => {
  it('구양식 요청서 + 별도 명단이면 단건. 명단은 별도 파일이 이긴다', () => {
    const form = oldForm('요청서.xlsx');
    const list = listOnly('고객명단.xlsx');
    const r = buildIntakeUnits([form, list]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toHaveLength(1);
    expect(r.units[0].formBuf).toBe(form.content);
    expect(r.units[0].listBuf).toBe(list.content);
    expect(r.units[0].listName).toBe('고객명단.xlsx');
  });

  it('첨부 순서가 뒤집혀도 요청서를 내용으로 가른다(파일명 추론 금지)', () => {
    const list = listOnly('aaa.xlsx');
    const form = oldForm('zzz.xlsx');
    const r = buildIntakeUnits([list, form]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units[0].formBuf).toBe(form.content);
  });

  it('자립형 1장 + 명단 1장이면 별도 명단이 이긴다(오늘 동작)', () => {
    const form = standalone('요청서.xlsx');
    const list = listOnly('명단.xlsx');
    const r = buildIntakeUnits([form, list]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toHaveLength(1);
    expect(r.units[0].listBuf).toBe(list.content);
  });

  it('둘 다 요청서로 안 읽히면 반려 — 오늘 사유 그대로', () => {
    const r = buildIntakeUnits([listOnly('a.xlsx'), listOnly('b.xlsx')]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('form_not_identified');
  });

  it('⛔ 구양식 2장(둘 다 명단 시트 없음)은 다중이 아니다 — 짝을 정할 신호가 없다', () => {
    const r = buildIntakeUnits([oldForm('a.xlsx'), oldForm('b.xlsx')]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('form_not_identified');
  });
});

describe('buildIntakeUnits — 다중 (지금 100% 반려되던 조합에서만 열린다)', () => {
  it('자립형 2장이면 접수 2건. 각 건은 자기 파일만 본다', () => {
    const a = standalone('9월_금강.xlsx');
    const b = standalone('9월_시세이도.xlsx');
    const r = buildIntakeUnits([a, b]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toHaveLength(2);
    expect(r.units[0].formBuf).toBe(a.content);
    expect(r.units[0].listBuf).toBe(a.content);
    expect(r.units[1].formBuf).toBe(b.content);
    expect(r.units[0].fileName).toBe('9월_금강.xlsx');
    expect(r.units[1].fileName).toBe('9월_시세이도.xlsx');
  });

  it('자립형 5장까지 받는다(첨부 순서를 그대로 유지한다)', () => {
    const names = ['1.xlsx', '2.xlsx', '3.xlsx', '4.xlsx', '5.xlsx'];
    const r = buildIntakeUnits(names.map(standalone));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units.map((u) => u.fileName)).toEqual(names);
  });

  it('상한을 넘으면 too_many_forms', () => {
    const r = buildIntakeUnits(Array.from({ length: MAX_FORMS + 1 }, (_, i) => standalone(`${i}.xlsx`)));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('too_many_forms');
  });

  it('⛔ 3장 이상에서 하나라도 자립형이 아니면 반려 — 짝짓기를 파일명으로 추론하지 않는다', () => {
    const r = buildIntakeUnits([standalone('a.xlsx'), standalone('b.xlsx'), listOnly('c.xlsx')]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('attachments_invalid');
  });

  it('⛔ 요청서 2 + 명단 2 조합은 다중이 아니다(같은 이유)', () => {
    const r = buildIntakeUnits([oldForm('a.xlsx'), listOnly('a-list.xlsx'), oldForm('b.xlsx'), listOnly('b-list.xlsx')]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('attachments_invalid');
  });
});

describe('buildIntakeUnits — 표 파일 0개', () => {
  it('표 파일이 하나도 없으면 반려', () => {
    const r = buildIntakeUnits([]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('attachments_invalid');
  });
});

describe('상한 상수 계약', () => {
  it('MAX_FORMS는 첨부 개수 상한을 넘지 않는다 — 넘으면 표 N장이 too_many_files로 조용히 반려된다', () => {
    expect(MAX_FORMS).toBeLessThanOrEqual(5);
  });
});
