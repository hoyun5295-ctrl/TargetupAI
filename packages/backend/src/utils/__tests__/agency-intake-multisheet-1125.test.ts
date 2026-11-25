/**
 * ★ 2026-11-25 한 파일 여러 건 · 시세이도 실물 꼴(설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §6-1 · §7 · §8-1 · §8-2).
 * 기대값 출처 = 시세이도 `2610_SH_11월 생일자_문안.xlsx` 의 시트 짜임(요청서 「정기문자(생일_X)」 + 「고객리스트N」 다섯 짝 ·
 * 「테스트번호 (오른쪽 테스트 명단 참고) →」 · 「이미지 파일명 ①PT 가격 인상 후」). 번호는 도달 불가 합성 값.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { planAgencyWorkbook, agencyUnitLabel } from '../agency-send-workbook';
import { parseAgencyRequestForm, parseAgencyRecipientList, pickStoreCallbackColumn, agencyRowsLookLikeList } from '../agency-send-form';

/** 시세이도 꼴 요청서 시트(A열 비움 · B열 라벨 · 오른쪽 테스트 명단 표) */
function formSheet(content: string, image: string, image2 = '②'): any[][] {
  return [
    [null, '구 분', '내 용'],
    [null, '브랜드명 (과금부서)', 'SHISEIDO', null, null, null, '테스트 명단'],
    [null, '문자타입', null, null, null, null, '고객명', '휴대폰번호', '소속매장명', '매장전화번호'],
    [null, '발송날짜 및 시간', '12월 1일 오후 12시', null, null, null, '가', '010-0000-0001', '강남', '02-0000-0000'],
    [null, '테스트번호\n(여러 개 가능)', '(오른쪽 테스트 명단 참고) →', null, null, null, '나', '010-0000-0002', '강남', '02-0000-0000'],
    [null, '메시지 제목\n(LMS,MMS만 해당)', '(광고) HAPPY BIRTHDAY'],
    [null, '메시지 내용', content],
    [],
    [null, '발신번호'],
    [null, '이미지 파일명\n(MMS만 해당)', image],
    [null, null, image2],
    [null, null, '③'],
  ];
}
const listSheet = (): any[][] => [['고객명', '휴대폰번호', '소속 매장', '매장번호'], ['다', '010-0000-0003', '신세계 강남', '02-0000-0001']];

function book(sheets: Array<[string, any[][]]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('planAgencyWorkbook — 짝 가르기', () => {
  it('시세이도 꼴 다섯 짝 = 다섯 건(시트 이름 그대로)', () => {
    const grades = ['PT', 'GOLD', 'SILVER', 'RED', 'WHITE'];
    const buf = book(grades.flatMap((g, i): Array<[string, any[][]]> => [[`정기문자(생일_${g})`, formSheet(`${g} 문안`, `①${g}`)], [`고객리스트${i + 1}`, listSheet()]]));
    const plan = planAgencyWorkbook(buf);
    expect(plan.kind).toBe('pairs');
    if (plan.kind !== 'pairs') return;
    expect(plan.pairs).toEqual(grades.map((g, i) => ({ formSheet: `정기문자(생일_${g})`, listSheet: `고객리스트${i + 1}` })));
  });
  it('짝 시트로 읽은 값 = 그 시트의 값(둘째 짝 문안 · 명단)', () => {
    const buf = book([['정기문자(생일_PT)', formSheet('PT 문안', '①PT')], ['고객리스트1', listSheet()], ['정기문자(생일_GOLD)', formSheet('GOLD 문안', '①GD')], ['고객리스트2', [['이름', '전화'], ['라', '010-0000-0009']]]]);
    expect(parseAgencyRequestForm(buf, { formSheet: '정기문자(생일_GOLD)' }).content).toBe('GOLD 문안');
    expect(parseAgencyRecipientList(buf, { listSheet: '고객리스트2' }).headers).toEqual(['이름', '전화']);
  });
  it('시세이도 한 짝(표준 이름 아님) = 한 건', () => {
    const plan = planAgencyWorkbook(book([['정기문자(생일_PT)', formSheet('PT', '①PT')], ['고객리스트1', listSheet()]]));
    expect(plan).toEqual({ kind: 'pairs', pairs: [{ formSheet: '정기문자(생일_PT)', listSheet: '고객리스트1' }] });
  });
  it('오늘 경로 그대로: 표준 한 짝(+ 작성 안내) · 요청서만(별도 명단 꼴) · 명단만 · 자유 명단', () => {
    expect(planAgencyWorkbook(book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['작성 안내', [[null, '문안 항목', '설명']]]]))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(book([['요청서', formSheet('a', '')]]))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(book([['고객리스트', listSheet()]]))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(book([['Sheet1', listSheet()]]))).toEqual({ kind: 'single' });
  });
  it('표준 파일의 안내 · 참고 탭에 문안 · 발송 설명 줄이 있어도 오늘 경로 그대로', () => {
    expect(planAgencyWorkbook(book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['작성 안내', formSheet('설명', '')]]))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['메모', [[null, '문안', '설명만']]]]))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['메모', [[null, '문안', '적는 법'], [null, '보낼 시각', '예: 12월 1일']]]]))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['메모', [[null, '문안'], [null, '보낼 시각']]]]))).toEqual({ kind: 'single' });
  });
  it('표준 이름 + 추가 짝 = 조용히 빠지지 않는다(이어 붙어 있으면 두 건 · ★1125(2) 번호 없는 명단도 바로 뒤면 그 건의 명단)', () => {
    const p1 = planAgencyWorkbook(book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['내용2', formSheet('b', '')], ['고객리스트2', listSheet()]]));
    expect(p1).toEqual({ kind: 'pairs', pairs: [{ formSheet: '내용', listSheet: '고객리스트' }, { formSheet: '내용2', listSheet: '고객리스트2' }] });
    const p2 = planAgencyWorkbook(book([['내용1', formSheet('a', '')], ['고객리스트1', listSheet()], ['내용2', formSheet('b', '')], ['고객리스트2', listSheet()]]));
    expect(p2).toEqual({ kind: 'pairs', pairs: [{ formSheet: '내용1', listSheet: '고객리스트1' }, { formSheet: '내용2', listSheet: '고객리스트2' }] });
  });
  it('메모 탭이 짝을 가로채지 못한다 · 이름이 요청서인 시트가 짝 없이 남으면 반려(Codex 설계 5R)', () => {
    const memo = (): any[][] => [[null, '문안', '지난달 문안'], [null, '보낼 시각', '11월 1일']];
    expect(planAgencyWorkbook(book([['내용', formSheet('a', '')], ['메모', memo()], ['고객리스트', listSheet()]]))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(book([['내용1', formSheet('a', '')], ['고객리스트1', listSheet()], ['내용2', formSheet('b', '')], ['메모', memo()], ['고객리스트2', listSheet()]])).kind).toBe('invalid');
    expect(planAgencyWorkbook(book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['내용2', formSheet('b', '')]])).kind).toBe('invalid');
  });
  it('짝 번호 어긋남 · 번갈아 깨짐 · 요청서 하나에 명단 둘 = 반려(시트 이름을 사유에)', () => {
    const swap = planAgencyWorkbook(book([['내용1', formSheet('a', '')], ['고객리스트2', listSheet()], ['내용2', formSheet('b', '')], ['고객리스트1', listSheet()]]));
    expect(swap.kind).toBe('invalid');
    if (swap.kind === 'invalid') expect(swap.reasons.join(' ')).toContain('고객리스트2');
    expect(planAgencyWorkbook(book([['A안', formSheet('a', '')], ['B안', formSheet('b', '')], ['고객리스트1', listSheet()], ['고객리스트2', listSheet()]])).kind).toBe('invalid');
    expect(planAgencyWorkbook(book([['A안', formSheet('a', '')], ['고객리스트1', listSheet()], ['고객리스트2', listSheet()]])).kind).toBe('invalid');
  });
});

describe('요청서 해석 — 시세이도 실물 칸', () => {
  const buf = book([['정기문자(생일_PT)', formSheet('(광고) 소중한 [고객명] 고객님', '①PT 가격 인상 후', '②보조 이미지')], ['고객리스트1', listSheet()]]);
  const f = parseAgencyRequestForm(buf, { formSheet: '정기문자(생일_PT)' });
  it('「테스트번호」 칸에 번호가 없으면 오른쪽 테스트 명단 표의 휴대폰번호 열', () => {
    expect(f.managerPhones).toEqual(['01000000001', '01000000002']);
  });
  it('이미지 파일명 ① ② 줄 = 이름표(번호표 뺌)', () => {
    expect(f.imageFileNames).toEqual(['PT 가격 인상 후', '보조 이미지']);
  });
  it('빈 발신번호는 해석기 오류가 아니다(명단을 아는 분석이 판정)', () => {
    expect(f.callbackRaw).toBe('');
    expect(f.errors.map((e) => e.field)).not.toContain('회신번호');
  });
});

describe('pickStoreCallbackColumn — 빈 발신번호 = 명단 매장번호 열', () => {
  const rows = [{ 휴대폰번호: '01000000003', 매장번호: '0200000001' }, { 휴대폰번호: '01000000004', 매장번호: '0200000002' }];
  it('매장 전화 열 하나 · 유선 = 그 열', () => {
    expect(pickStoreCallbackColumn(['고객명', '휴대폰번호', '소속 매장', '매장번호'], rows, '휴대폰번호').column).toBe('매장번호');
  });
  it('수신자 열과 같거나 휴대폰 값 열이면 고르지 않는다 · 후보 둘이면 고르지 않는다', () => {
    expect(pickStoreCallbackColumn(['매장번호'], rows, '매장번호').column).toBeNull();
    expect(pickStoreCallbackColumn(['휴대폰번호', '매장번호'], [{ 매장번호: '01000000005' }, { 매장번호: '01000000006' }], '휴대폰번호').column).toBeNull();
    expect(pickStoreCallbackColumn(['매장번호', '지점전화'], rows, null)).toEqual({ column: null, candidates: ['매장번호', '지점전화'] });
  });
});

describe('Codex 설계 6R — 명단 하나 분기 · 이미지 이름 맞추기 · 메일 단위', () => {
  it('명단 하나여도 번호 어긋남 · 짝 없는 요청서 = 반려', () => {
    expect(planAgencyWorkbook(book([['내용1', formSheet('a', '')], ['고객리스트2', listSheet()]])).kind).toBe('invalid');
    expect(planAgencyWorkbook(book([['정기문자(생일_PT)', formSheet('a', '')], ['고객리스트1', listSheet()], ['정기문자(생일_GOLD)', formSheet('b', '')]])).kind).toBe('invalid');
  });
});

import { matchAgencyUnitImages, agencyImageNameKey } from '../agency-send-workbook';
describe('matchAgencyUnitImages — 자리 ↔ 첨부 1:1(설계서 §7)', () => {
  it('요청서 칸 「VIP 골드.jpg」 ↔ 첨부 「vip골드.JPG」 = 같은 키', () => {
    expect(agencyImageNameKey('①VIP 골드.jpg')).toBe(agencyImageNameKey('vip골드.JPG'));
  });
  it('시세이도 꼴 다섯 건 = 이름대로', () => {
    const r = matchAgencyUnitImages(
      [{ label: 'PT', names: ['PT 가격 인상 후'] }, { label: 'GOLD', names: ['GD'] }],
      ['GD.jpg', 'PT 가격 인상 후.jpg'], 3,
    );
    expect(r).toEqual({ ok: true, assign: [[1], [0]] });
  });
  it('맞는 첨부 없음 · 남는 첨부 · 두 곳에 쓰임 · 이름 겹침 = 반려', () => {
    expect(matchAgencyUnitImages([{ label: 'A', names: ['x'] }], ['y.jpg'], 3).ok).toBe(false);
    expect(matchAgencyUnitImages([{ label: 'A', names: ['x'] }], ['x.jpg', 'z.jpg'], 3).ok).toBe(false);
    expect(matchAgencyUnitImages([{ label: 'A', names: ['x'] }, { label: 'B', names: ['x'] }], ['x.jpg'], 3).ok).toBe(false);
    expect(matchAgencyUnitImages([{ label: 'A', names: ['x', 'x'] }], ['x.jpg'], 3).ok).toBe(false);
    expect(matchAgencyUnitImages([{ label: 'A', names: ['x'] }], ['x.jpg', 'X.png'], 3).ok).toBe(false);
  });
});

import { buildIntakeUnits } from '../agency-send-mail-worker';
import { computeWorkbookPlan } from '../agency-send-parse-isolated';
describe('buildIntakeUnits — 한 파일 여러 건 · 오늘 분기 그대로', () => {
  const shiseido = book([['정기문자(생일_PT)', formSheet('a', '①PT')], ['고객리스트1', listSheet()], ['정기문자(생일_GOLD)', formSheet('b', '①GD')], ['고객리스트2', listSheet()]]);
  it('짝 파일 하나 = 짝마다 단위(시트 이름 · 건 이름)', () => {
    const r = buildIntakeUnits([{ filename: '생일.xlsx', content: shiseido }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units.map((u) => [u.fileName, u.formSheet, u.listSheet])).toEqual([
      ['생일.xlsx / 정기문자(생일_PT)', '정기문자(생일_PT)', '고객리스트1'],
      ['생일.xlsx / 정기문자(생일_GOLD)', '정기문자(생일_GOLD)', '고객리스트2'],
    ]);
  });
  it('요청서 + 별도 명단 두 파일 = 오늘 그대로 한 단위', () => {
    const r = buildIntakeUnits([{ filename: '요청서.xlsx', content: book([['요청서', formSheet('a', '')]]) }, { filename: '명단.xlsx', content: book([['Sheet1', listSheet()]]) }]);
    expect(r.ok && r.units.length).toBe(1);
  });
  it('짝 파일 + 별도 명단 파일 = 반려', () => {
    const r = buildIntakeUnits([{ filename: '생일.xlsx', content: shiseido }, { filename: '명단.xlsx', content: book([['Sheet1', listSheet()]]) }]);
    expect(r.ok).toBe(false);
  });
});

describe('Codex 구현 1R — 표준 이름 요청서 두 장 · 이미지 라벨 두 줄', () => {
  it('요청서 · 내용 · 고객리스트 = 반려(오늘 고르기가 명단 앞 시트와 다른 시트를 고를 수 있다)', () => {
    expect(planAgencyWorkbook(book([['요청서', formSheet('a', '')], ['내용', formSheet('b', '')], ['고객리스트', listSheet()]])).kind).toBe('invalid');
  });
  it('빈 「이미지 파일명」 줄 + 값 있는 「이미지파일명」 줄 = 값을 놓치지 않는다', () => {
    const rows = formSheet('a', '');
    rows.push([null, '이미지파일명', '①골드 배너']);
    const buf = book([['정기문자(생일_GOLD)', rows], ['고객리스트1', listSheet()]]);
    expect(parseAgencyRequestForm(buf, { formSheet: '정기문자(생일_GOLD)' }).imageFileNames).toEqual(['골드 배너']);
  });
});

describe('Codex 구현 2R — 같은 이름 두 자리', () => {
  it('① 배너 ② 배너 = 두 자리 그대로 → 첨부 한 장이면 맞추기에서 반려', () => {
    const buf = book([['정기문자(생일_PT)', formSheet('a', '①배너.jpg', '②배너.jpg')], ['고객리스트1', listSheet()]]);
    const names = parseAgencyRequestForm(buf, { formSheet: '정기문자(생일_PT)' }).imageFileNames;
    expect(names).toEqual(['배너.jpg', '배너.jpg']);
    expect(matchAgencyUnitImages([{ label: 'PT', names }], ['배너.jpg'], 3).ok).toBe(false);
  });
});

describe('Codex 구현 3R — 건 이름 200자 · 이미지 라벨 묶음', () => {
  it('파일 이름이 길어도 200자 안 · 시트 이름은 그대로 끝에', () => {
    const label = agencyUnitLabel('가'.repeat(400) + '.xlsx', '정기문자(생일_PT)');
    expect(label.length).toBeLessThanOrEqual(200);
    expect(label.endsWith(' / 정기문자(생일_PT)')).toBe(true);
    expect(agencyUnitLabel('짧은.xlsx', '정기문자(생일_GD)')).toBe('짧은.xlsx / 정기문자(생일_GD)');
  });
});

describe('★1125 한 파일 안 짝 = 건 수 상한 없음 · 따로 첨부한 파일 = 5개까지(Harold 「제한없어 이어붙어있으면」)', () => {
  const pairsBook = (n: number) => book(Array.from({ length: n }, (_, i) => [
    [`정기문자(생일_G${i + 1})`, formSheet(`등급${i + 1}`, '')] as [string, any[][]],
    [`고객리스트${i + 1}`, listSheet()] as [string, any[][]],
  ]).flat());
  it('24시트(12짝) 한 파일 = 12건', () => {
    const r = buildIntakeUnits([{ filename: '생일.xlsx', content: pairsBook(12) }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toHaveLength(12);
    expect(r.units.map((u) => u.formSheet)).toEqual(Array.from({ length: 12 }, (_, i) => `정기문자(생일_G${i + 1})`));
  });
  it('짝 파일 하나 + 자립형 다섯 = 따로 첨부 여섯 → too_many_forms', () => {
    const standalone = () => book([['요청서', formSheet('a', '')], ['고객리스트', listSheet()]]);
    const r = buildIntakeUnits([{ filename: '생일.xlsx', content: pairsBook(2) }, ...Array.from({ length: 5 }, (_, i) => ({ filename: `${i}.xlsx`, content: standalone() }))]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('too_many_forms');
  });
});

describe('★1125 상한을 풀며 함께 닫은 둘(Codex 상한 1R) — 명단 시트만 읽기 · 값싼 판정이 이미지 맞춤 앞', () => {
  const src = (p: string) => require('fs').readFileSync(require('path').resolve(__dirname, p), 'utf8') as string;
  it('짝 명단 읽기 = 그 시트 값 그대로(다른 짝 명단이 섞이지 않는다) · 소스 = 시트만 골라 읽고 안 되면 전체', () => {
    const buf = book([
      ['정기문자(생일_PT)', formSheet('a', '')], ['고객리스트1', [['고객명', '휴대폰번호'], ['가', '010-0000-0011']]],
      ['정기문자(생일_GD)', formSheet('b', '')], ['고객리스트2', [['고객명', '휴대폰번호'], ['나', '010-0000-0022'], ['다', '010-0000-0023']]],
    ]);
    expect(parseAgencyRecipientList(buf, { listSheet: '고객리스트1' }).rows.map((r) => r['고객명'])).toEqual(['가']);
    expect(parseAgencyRecipientList(buf, { listSheet: '고객리스트2' }).rows.map((r) => r['고객명'])).toEqual(['나', '다']);
    const form = src('../agency-send-form.ts');
    const body = form.slice(form.indexOf('export function parseAgencyRecipientList('));
    expect(body.slice(0, 2500)).toMatch(/XLSX\.read\(buffer, \{ \.\.\.SHEET_READ_OPTS, sheets: \[sheetName\] \}\)/);
    // ★(2) 이미 읽은 통합 문서를 받으면 그 판을 쓴다(다시 읽지 않는다) · 안 받았을 때만 시트 → 전체 차례
    expect(body.slice(0, 3000)).toMatch(/let sheet = opts\.workbook \? opts\.workbook\.Sheets\[sheetName\]/);
    expect(body.slice(0, 3000)).toMatch(/if \(!sheet && !opts\.workbook\) sheet = XLSX\.read\(buffer, SHEET_READ_OPTS\)\.Sheets\[sheetName\]/);
  });
  it('메일: 압축 · 첨부 개수 · 용량 판정이 이미지 맞춤(prepareMailMmsImages)보다 앞이다', () => {
    const worker = src('../agency-send-mail-worker.ts');
    const prep = worker.indexOf('await prepareMailMmsImages(imageAtts, MAX_ATTACH_FILES)');
    expect(prep).toBeGreaterThan(0);
    for (const code of ["'zip_not_allowed'", "'too_many_files'", "'attachments_too_large'"]) {
      const at = worker.indexOf(code);
      expect(at, code).toBeGreaterThan(0);
      expect(at, `${code} 가 이미지 맞춤 뒤에 있다`).toBeLessThan(prep);
    }
  });
});

describe('★1125(2) 명단 = 요청서 바로 뒤 시트 — 실 접수 「이메일 대행(문안 5건일 경우)」 꼴(접수 384 · 385 반려)', () => {
  const people = (n: number): any[][] => [['이름', '휴대폰', '매장'], ...Array.from({ length: n }, (_, i) => [`테스트${i + 1}`, `010-0000-00${String(10 + i)}`, '강남'])];
  const grades = ['PT', 'GOLD', 'SILVER', 'RED', 'WHITE'];
  it('「정기문자(생일_PT)」 + 「정기문자(생일_PT)리스트」 다섯 짝 = 다섯 건(명단 이름이 고객리스트N 이 아니어도)', () => {
    const buf = book(grades.flatMap((g): Array<[string, any[][]]> => [[`정기문자(생일_${g})`, formSheet(`${g} 문안`, '')], [`정기문자(생일_${g})리스트`, people(4)]]));
    expect(planAgencyWorkbook(buf)).toEqual({ kind: 'pairs', pairs: grades.map((g) => ({ formSheet: `정기문자(생일_${g})`, listSheet: `정기문자(생일_${g})리스트` })) });
    const r = buildIntakeUnits([{ filename: '이메일 대행.xlsx', content: buf }]);
    expect(r.ok && r.units.map((u) => u.listSheet)).toEqual(grades.map((g) => `정기문자(생일_${g})리스트`));
  });
  it('이름에 리스트 · 명단이 없어도 휴대폰 열이 있는 바로 뒤 시트 = 그 건의 명단(「Sheet2」 · 「DB」)', () => {
    const buf = book([['A안', formSheet('a', '')], ['Sheet2', people(3)], ['B안', formSheet('b', '')], ['DB', people(2)]]);
    expect(planAgencyWorkbook(buf)).toEqual({ kind: 'pairs', pairs: [{ formSheet: 'A안', listSheet: 'Sheet2' }, { formSheet: 'B안', listSheet: 'DB' }] });
  });
  it('표준 이름 요청서 + 이름이 명단인 시트 한 장 = 한 건(「요청서」 + 「수신자명단」)', () => {
    expect(planAgencyWorkbook(book([['요청서', formSheet('a', '')], ['수신자명단', people(3)]]))).toEqual({ kind: 'pairs', pairs: [{ formSheet: '요청서', listSheet: '수신자명단' }] });
  });
  it('명단이 아닌 것 = 오늘 경로 그대로(빈 기본 시트 · 연락처 한 칸 메모) · 명단 꼴 판정 = 번호 두 줄 이상', () => {
    expect(planAgencyWorkbook(book([['요청서', formSheet('a', '')], ['Sheet2', []], ['Sheet3', []]]))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(book([['요청서', formSheet('a', '')], ['문의처', [['담당자 연락처'], ['010-0000-0099']]]]))).toEqual({ kind: 'single' });
    expect(agencyRowsLookLikeList(people(2))).toBe(true);
    expect(agencyRowsLookLikeList([['담당자 연락처'], ['010-0000-0099']])).toBe(false);
    expect(agencyRowsLookLikeList([['이름', '메모'], ['가', '방문 예정'], ['나', '전화 요망']])).toBe(false);
  });
  it('표준 파일에 남는 명단 꼴 시트가 있어도 오늘 경로 그대로(「이전리스트」)', () => {
    expect(planAgencyWorkbook(book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['이전리스트', people(3)]]))).toEqual({ kind: 'single' });
  });
  it('어긋남은 반려: 다른 요청서 이름의 명단이 뒤에 · 짝 없는 명단 · 명단 번호가 차례대로 아님 · 명단이 요청서 앞', () => {
    const cross = planAgencyWorkbook(book([['정기문자(생일_PT)', formSheet('a', '')], ['정기문자(생일_GOLD)리스트', people(2)], ['정기문자(생일_GOLD)', formSheet('b', '')], ['정기문자(생일_PT)리스트', people(2)]]));
    expect(cross.kind).toBe('invalid');
    if (cross.kind === 'invalid') expect(cross.reasons[0]).toContain('「정기문자(생일_GOLD)리스트」은 이름이 요청서 시트 「정기문자(생일_GOLD)」의 명단인데 「정기문자(생일_PT)」 바로 뒤');
    const orphan = planAgencyWorkbook(book([['A안', formSheet('a', '')], ['A안리스트', people(2)], ['남는시트', people(3)]]));
    expect(orphan.kind).toBe('invalid');
    if (orphan.kind === 'invalid') expect(orphan.reasons.join(' ')).toContain('「남는시트」');
    expect(planAgencyWorkbook(book([['A안', formSheet('a', '')], ['고객리스트2', listSheet()], ['B안', formSheet('b', '')], ['고객리스트1', listSheet()]])).kind).toBe('invalid');
    expect(planAgencyWorkbook(book([['A안리스트', people(2)], ['A안', formSheet('a', '')]])).kind).toBe('invalid');
  });
  it('명단 번호가 건너뛰어도 차례대로면 받는다(「고객리스트1」 · 「고객리스트3」)', () => {
    expect(planAgencyWorkbook(book([['A안', formSheet('a', '')], ['고객리스트1', listSheet()], ['B안', formSheet('b', '')], ['고객리스트3', listSheet()]])).kind).toBe('pairs');
  });
  it('메일 두 파일(요청서 파일 + 별도 명단 파일) = 오늘 분기 그대로 · 요청서 파일 안 명단 꼴 시트보다 별도 명단이 이긴다', () => {
    const formFile = book([['요청서', formSheet('a', '')], ['수신자명단', people(3)]]);
    const listFile = book([['Sheet1', people(5)]]);
    const r = buildIntakeUnits([{ filename: '요청서.xlsx', content: formFile }, { filename: '명단.xlsx', content: listFile }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toHaveLength(1);
    expect(r.units[0].listBuf).toBe(listFile);
    expect(r.units[0].formSheet).toBeUndefined();
  });
});

describe('★1125(2) 메일 두 파일 = 오늘 분기가 먼저(넓어진 짝 판정이 오늘 받던 메일을 막지 않는다)', () => {
  const people = (n: number): any[][] => [['이름', '휴대폰'], ...Array.from({ length: n }, (_, i) => [`테스트${i + 1}`, `010-0000-00${String(10 + i)}`])];
  const memo = (): any[][] => [[null, '문안', '지난달 문안'], [null, '보낼 시각', '11월 1일']];
  it('명단 파일 안에 요청서 꼴 메모 탭이 있어도 요청서 파일 + 명단 파일로 한 건', () => {
    const formFile = book([['요청서', formSheet('a', '')]]);
    const listFile = book([['명단', people(4)], ['메모', memo()]]);
    expect(planAgencyWorkbook(listFile).kind).toBe('invalid');
    const r = buildIntakeUnits([{ filename: '요청서.xlsx', content: formFile }, { filename: '명단.xlsx', content: listFile }]);
    expect(r.ok && r.units.length).toBe(1);
    expect(r.ok && r.units[0].listBuf).toBe(listFile);
  });
  it('요청서가 둘 이상 든 파일 + 다른 파일 = 오늘 분기로 가지 않는다(한 건만 접수되고 나머지가 빠지지 않게)', () => {
    const multi = book([['요청서', formSheet('a', '')], ['요청서리스트', people(2)], ['B안', formSheet('b', '')], ['B안리스트', people(2)]]);
    const r = buildIntakeUnits([{ filename: '여러건.xlsx', content: multi }, { filename: '명단.xlsx', content: book([['Sheet1', people(3)]]) }]);
    expect(r.ok).toBe(false);
  });
  it('요청서 파일의 판정이 반려(짝 없는 요청서)면 두 파일이어도 반려', () => {
    const bad = book([['요청서', formSheet('a', '')], ['요청서리스트', people(2)], ['내용2', formSheet('b', '')]]);
    const r = buildIntakeUnits([{ filename: '요청서.xlsx', content: bad }, { filename: '명단.xlsx', content: book([['Sheet1', people(3)]]) }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('sheet_pairs_invalid');
  });
});

describe('★1125(2) Codex 짝 1R — 테스트 탭 · 표준 한 짝 뒤 추가 짝 · 보조 탭이 있는 두 파일 · 한 번 읽기', () => {
  const people = (n: number): any[][] => [['이름', '휴대폰'], ...Array.from({ length: n }, (_, i) => [`테스트${i + 1}`, `010-0000-00${String(10 + i)}`])];
  it('이름에 테스트가 든 탭은 받는 사람 명단이 아니다(「테스트 명단」이 실제 발송 대상에 붙지 않는다)', () => {
    expect(planAgencyWorkbook(book([['A안', formSheet('a', '')], ['테스트 명단', people(3)]]))).toEqual({ kind: 'single' });
    const p = planAgencyWorkbook(book([['A안', formSheet('a', '')], ['테스트 명단', people(3)], ['A안리스트', people(4)]]));
    expect(p.kind).toBe('invalid');
    if (p.kind === 'invalid') expect(p.reasons.join(' ')).toContain('「A안」');
  });
  it('표준 한 짝 뒤에 다른 이름의 완전한 짝이 붙어 있으면 두 건(둘째 건이 조용히 빠지지 않는다)', () => {
    const buf = book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['정기문자(생일_GOLD)', formSheet('b', '')], ['정기문자(생일_GOLD)리스트', people(3)]]);
    expect(planAgencyWorkbook(buf)).toEqual({ kind: 'pairs', pairs: [{ formSheet: '내용', listSheet: '고객리스트' }, { formSheet: '정기문자(생일_GOLD)', listSheet: '정기문자(생일_GOLD)리스트' }] });
  });
  it('메일 두 파일: 요청서 파일에 보조 탭(「메모」 · 「이전리스트」)이 있어도 별도 명단 파일로 한 건', () => {
    const formFile = book([['요청서', formSheet('a', '')], ['메모', [['지난달 참고']]], ['이전리스트', people(3)]]);
    const listFile = book([['Sheet1', people(5)]]);
    const plan = planAgencyWorkbook(formFile);
    expect(plan.kind).toBe('invalid');
    if (plan.kind === 'invalid') expect(plan.requestSheets).toBe(1);
    const r = buildIntakeUnits([{ filename: '요청서.xlsx', content: formFile }, { filename: '명단.xlsx', content: listFile }]);
    expect(r.ok && r.units.length).toBe(1);
    expect(r.ok && r.units[0].listBuf).toBe(listFile);
  });
  it('짝 파일 = 한 번 읽은 판에서 짝마다 해석(시트만 따로 읽은 값과 같다) · onlyPair = 그 짝만 명단', () => {
    const buf = book([
      ['정기문자(생일_PT)', formSheet('PT 문안', '①PT')], ['정기문자(생일_PT)리스트', people(3)],
      ['정기문자(생일_GOLD)', formSheet('GOLD 문안', '①GD')], ['정기문자(생일_GOLD)리스트', people(5)],
    ]);
    const all = computeWorkbookPlan(buf);
    expect(all.plan.kind).toBe('pairs');
    expect(all.imageNames).toEqual([['PT'], ['GD']]);
    expect(all.parsed?.map((p) => p?.list?.rows.length)).toEqual([3, 5]);
    expect(all.parsed?.[1]?.form.content).toBe('GOLD 문안');
    expect(all.parsed?.[1]?.list).toEqual(parseAgencyRecipientList(buf, { listSheet: '정기문자(생일_GOLD)리스트' }));
    expect(all.parsed?.[0]?.form).toEqual(parseAgencyRequestForm(buf, { formSheet: '정기문자(생일_PT)' }));
    const one = computeWorkbookPlan(buf, 1);
    expect(one.parsed?.[0]).toBeNull();
    expect(one.parsed?.[1]?.list?.rows.length).toBe(5);
    expect(one.imageNames).toEqual([['PT'], ['GD']]);
  });
  it('메일 단위 = 판정이 준 해석을 들고 간다(건마다 파일을 다시 읽지 않는다)', () => {
    const buf = book([['A안', formSheet('a', '')], ['A안리스트', people(2)], ['B안', formSheet('b', '')], ['B안리스트', people(4)]]);
    const iso = computeWorkbookPlan(buf);
    const r = buildIntakeUnits([{ filename: 'x.xlsx', content: buf }], [iso]);
    expect(r.ok && r.units.map((u) => u.pre?.list?.rows.length)).toEqual([2, 4]);
  });
});

describe('★1125(2) Codex 짝 2R — 표준 한 건 사이의 보조 명단 · 별도 명단 파일의 테스트 탭', () => {
  const people = (n: number, name = '테스트'): any[][] => [['이름', '휴대폰'], ...Array.from({ length: n }, (_, i) => [`${name}${i + 1}`, `010-0000-00${String(10 + i)}`])];
  it('「내용」 「이전리스트」 「고객리스트」 = 오늘 경로 한 건(표준 요청서 바로 뒤 보조 명단이 추가 짝이 아니다)', () => {
    expect(planAgencyWorkbook(book([['내용', formSheet('a', '')], ['이전리스트', people(3)], ['고객리스트', listSheet()]]))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(book([['요청서', formSheet('a', '')], ['이전명단', people(3)], ['고객명단', listSheet()]]))).toEqual({ kind: 'single' });
  });
  it('별도 명단 파일의 시트 고르기 = 오늘 그대로(표준 이름 → 첫 시트) · 탭 이름 일부로 첫 시트를 건너뛰지 않는다(Codex 짝 3R)', () => {
    const real = book([['당첨 안내 대상', people(4, '이번달')], ['지난달 명단', people(2, '지난달')]]);
    expect(parseAgencyRecipientList(real).rows.map((r) => r['이름'])).toEqual(['이번달1', '이번달2', '이번달3', '이번달4']);
    const exact = book([['테스트 명단', people(2, '직원')], ['고객리스트', listSheet()]]);
    expect(parseAgencyRecipientList(exact).headers).toEqual(['고객명', '휴대폰번호', '소속 매장', '매장번호']);
  });
  it('표준 이름이 섞여 있어도 두 건으로 깔끔히 갈리면 두 건(「내용」 「VIP리스트」 「일반 고객 발송」 「고객리스트」 · Codex 짝 3R)', () => {
    const buf = book([['내용', formSheet('VIP 문안', '')], ['VIP리스트', people(2, 'VIP')], ['일반 고객 발송', formSheet('일반 문안', '')], ['고객리스트', listSheet()]]);
    expect(planAgencyWorkbook(buf)).toEqual({ kind: 'pairs', pairs: [{ formSheet: '내용', listSheet: 'VIP리스트' }, { formSheet: '일반 고객 발송', listSheet: '고객리스트' }] });
  });
  it('깔끔히 갈리지 않는 표준 한 건은 오늘 경로 그대로(요청서 꼴 메모가 표준 명단 바로 앞 · 명단이 요청서 앞)', () => {
    const memo = (): any[][] => [[null, '문안', '지난달 문안'], [null, '보낼 시각', '11월 1일']];
    expect(planAgencyWorkbook(book([['내용', formSheet('a', '')], ['메모', memo()], ['고객리스트', listSheet()]]))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(book([['고객리스트', listSheet()], ['내용', formSheet('a', '')]]))).toEqual({ kind: 'single' });
  });
});

describe('★1125(2) Codex 짝 4R — 짝이 둘인데 남는 명단 · 숨김 탭', () => {
  const people = (n: number, name = '테스트'): any[][] => [['이름', '휴대폰'], ...Array.from({ length: n }, (_, i) => [`${name}${i + 1}`, `010-0000-00${String(10 + i)}`])];
  /** 숨김 여부를 실은 통합 문서(hidden = 숨길 시트 이름) */
  const bookHidden = (sheets: Array<[string, any[][]]>, hidden: string[]): Buffer => {
    const wb = XLSX.utils.book_new();
    for (const [name, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
    wb.Workbook = { Sheets: sheets.map(([name]) => ({ name, Hidden: hidden.includes(name) ? 1 : 0 })) } as any;
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };
  it('짝이 둘 성립 + 남는 명단 = 파일 전체 반려(표준 한 건으로 줄어 둘째 건이 빠지지 않는다)', () => {
    const p = planAgencyWorkbook(book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['GOLD', formSheet('b', '')], ['GOLD리스트', people(2)], ['이전리스트', people(3)]]));
    expect(p.kind).toBe('invalid');
    if (p.kind === 'invalid') expect(p.reasons.join(' ')).toContain('「이전리스트」');
    const r = buildIntakeUnits([{ filename: 'x.xlsx', content: book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['GOLD', formSheet('b', '')], ['GOLD리스트', people(2)], ['이전리스트', people(3)]]) }]);
    expect(r.ok).toBe(false);
  });
  it('숨김 탭이 표준 두 탭을 감싸도 오늘 경로 한 건(지난달 문안 · 명단이 이번 것과 짝지어지지 않는다)', () => {
    const buf = bookHidden([['지난달 발송', formSheet('지난달 문안', '')], ['고객리스트', listSheet()], ['내용', formSheet('이번 문안', '')], ['이전리스트', people(3)]], ['지난달 발송', '이전리스트']);
    expect(planAgencyWorkbook(buf)).toEqual({ kind: 'single' });
  });
  it('숨김 탭이 낀 여러 건 · 비표준 파일 = 숨긴 시트 이름을 적어 반려(짝을 만들지 않는다 · Codex 짝 4R ~ 6R)', () => {
    const expectHidden = (buf: Buffer, ...hiddenSheets: string[]) => {
      const p = planAgencyWorkbook(buf);
      expect(p.kind).toBe('invalid');
      if (p.kind !== 'invalid') return;
      expect(p.reasons).toHaveLength(1);
      expect(p.reasons[0]).toContain('숨겨진 시트');
      for (const n of hiddenSheets) expect(p.reasons[0]).toContain(`「${n}」`);
    };
    // 숨긴 요청서 뒤의 명단이 앞 요청서에 붙던 꼴(이름이 그 요청서의 명단 · 일반 이름 명단 둘 다)
    expectHidden(bookHidden([['A안', formSheet('a', '')], ['B안', formSheet('b', '')], ['B안리스트', people(3)], ['C안', formSheet('c', '')], ['C안리스트', people(2)]], ['B안']), 'B안');
    expectHidden(bookHidden([['A안', formSheet('a', '')], ['B안', formSheet('b', '')], ['고객리스트2', people(3)]], ['B안']), 'B안');
    // 이름에 명단이 든 숨긴 요청서(내용은 요청서) 뒤의 일반 이름 명단
    expectHidden(bookHidden([['A안', formSheet('a', '')], ['B안 명단 발송', formSheet('b', '')], ['고객리스트2', people(3)], ['C안', formSheet('c', '')], ['C안리스트', people(2)]], ['B안 명단 발송']), 'B안 명단 발송');
    // 숨겨 둔 지난달 표준 탭 + 보이는 다른 짝 · 숨겨 보관한 지난달 짝 · 사이에 낀 숨긴 명단
    expectHidden(bookHidden([['내용', formSheet('지난달', '')], ['고객리스트', listSheet()], ['GOLD', formSheet('이번', '')], ['GOLD리스트', people(2)]], ['내용', '고객리스트']), '내용', '고객리스트');
    expectHidden(bookHidden([['A안', formSheet('a', '')], ['A안리스트', people(2)], ['지난달', formSheet('old', '')], ['지난달리스트', people(5)]], ['지난달', '지난달리스트']), '지난달', '지난달리스트');
    expectHidden(bookHidden([['A안', formSheet('a', '')], ['지난달리스트', people(5)], ['A안리스트', people(2)]], ['지난달리스트']), '지난달리스트');
  });
  it('오늘 경로가 실제로 읽을 명단이 숨김이면 오늘 경로로 넘기지 않는다(「고객명단(숨김)」 「내용」 「고객리스트」 · Codex 짝 7R)', () => {
    const buf = bookHidden([['고객명단', people(5, '지난달')], ['내용', formSheet('a', '')], ['고객리스트', listSheet()]], ['고객명단']);
    // 해석기가 고르는 명단 = 파일 차례로 처음 나오는 표준 이름 = 숨긴 고객명단
    expect(parseAgencyRecipientList(buf).rows.length).toBe(5);
    const p = planAgencyWorkbook(buf);
    expect(p.kind).toBe('invalid');
    if (p.kind === 'invalid') expect(p.reasons[0]).toContain('「고객명단」');
  });
  it('숨김 탭이 있어도 표준 한 건(오늘 고르는 두 시트가 보임)은 오늘 경로 그대로', () => {
    expect(planAgencyWorkbook(bookHidden([['고객리스트', listSheet()], ['내용', formSheet('a', '')], ['고객리스트2', people(3)]], ['고객리스트2']))).toEqual({ kind: 'single' });
    expect(planAgencyWorkbook(bookHidden([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['지난달', formSheet('old', '')], ['지난달리스트', people(5)]], ['지난달', '지난달리스트']))).toEqual({ kind: 'single' });
  });
});

// ★ 2026-11-25 C163(R108 · Codex 설계 2R #2 · 4R) — 담당자 · 테스트 명단 번호 칸 폭(20자)
describe('요청서 담당자 번호 칸 폭 — 순서 · 10명 자르기 그대로 · 다 넘으면 테스트 명단으로 넘어가지 않고 폭 수만 넘긴다', () => {
  const LONG = '0'.repeat(21);
  const withCell = (cell: string, testPhones: [string, string]) => {
    const s = formSheet('문안', '');
    s[3][7] = testPhones[0];
    s[4][2] = cell;
    s[4][7] = testPhones[1];
    return parseAgencyRequestForm(book([['요청서', s], ['고객리스트', listSheet()]]), { formSheet: '요청서' });
  };
  it('담당자 칸 번호가 모두 넘으면 = 담당자 0 · managerTooLong · 「없음」 오류 줄 없음(분석이 덮어쓰기 기준으로 판정)', () => {
    const f = withCell(LONG, ['010-0000-0001', '010-0000-0002']);
    expect(f.managerPhones).toEqual([]);
    expect(f.managerTooLong).toBe(1);
    expect(f.errors.map((e) => e.field)).not.toContain('담당자 번호');
  });
  it('테스트 명단 번호가 모두 넘어도 = 폭 수로 넘긴다(Codex 설계 4R)', () => {
    const f = withCell('(오른쪽 테스트 명단 참고) →', [LONG, LONG + '1']);
    expect(f.managerPhones).toEqual([]);
    expect(f.managerTooLong).toBe(2);
    expect(f.errors.map((e) => e.field)).not.toContain('담당자 번호');
  });
  it('하나라도 맞으면 그 번호만 · 10 ~ 20자 번호만 있으면 지금과 같다', () => {
    expect(withCell(`${LONG}, 010-0000-0009`, ['010-0000-0001', '010-0000-0002']).managerPhones).toEqual(['01000000009']);
    expect(withCell('(오른쪽 테스트 명단 참고) →', ['010-0000-0001', '010-0000-0002'])).toMatchObject({ managerPhones: ['01000000001', '01000000002'], managerTooLong: 0 });
  });
});
