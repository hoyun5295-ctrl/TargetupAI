/**
 * ★ 2026-11-25 한 파일 여러 건 · 시세이도 실물 꼴(설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §6-1 · §7 · §8-1 · §8-2).
 * 기대값 출처 = 시세이도 `2610_SH_11월 생일자_문안.xlsx` 의 시트 짜임(요청서 「정기문자(생일_X)」 + 「고객리스트N」 다섯 짝 ·
 * 「테스트번호 (오른쪽 테스트 명단 참고) →」 · 「이미지 파일명 ①PT 가격 인상 후」). 번호는 도달 불가 합성 값.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { planAgencyWorkbook, agencyUnitLabel } from '../agency-send-workbook';
import { parseAgencyRequestForm, parseAgencyRecipientList, pickStoreCallbackColumn } from '../agency-send-form';

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
  it('표준 이름 + 추가 짝 = 조용히 빠지지 않는다(번호 없는 명단 = 반려 · 번호 있으면 두 건)', () => {
    const p1 = planAgencyWorkbook(book([['내용', formSheet('a', '')], ['고객리스트', listSheet()], ['내용2', formSheet('b', '')], ['고객리스트2', listSheet()]]));
    expect(p1.kind).toBe('invalid');
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
