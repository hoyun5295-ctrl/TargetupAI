/**
 * ★ 2026-11-25 대행 접수 실수 잡기(설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §3 · §4-1 · §8-3).
 * 기대값 출처 = 실물 문장(수스 c8f7f2b0 「"OOO점만의  행사!"」 · 시세이도 생일 문안 [고객명] [소속매장명] [소속매장전화번호])과 손으로 정한 예.
 */
import { describe, it, expect } from 'vitest';
import {
  findAgencyBlanks, matchBlankColumns, findSuffixDup, countEmptyVarRows,
  convertBracketVars, applySlotFills, agencyBlankApprovalLine, agencyBlankIntakeLines, blankLabel,
} from '../agency-send-blanks';

const texts = (c: string) => findAgencyBlanks(c).map(blankLabel);

describe('findAgencyBlanks — 기호 꼴', () => {
  it('수스 실물 「OOO점만의 행사」 = 빈 자리 하나 · 접미어 점은 따로', () => {
    const b = findAgencyBlanks('"수스" "OOO점만의  행사!"');
    expect(b).toHaveLength(1);
    expect(b[0].text).toBe('OOO');
    expect(b[0].suffix).toBe('점');
    expect(blankLabel(b[0])).toBe('OOO점');
  });
  it('한국어 자리 표시 ○○ · ㅇㅇㅇ · □□ 를 잡는다', () => {
    expect(texts('○○점에서 기다립니다')).toEqual(['○○점']);
    expect(texts('ㅇㅇㅇ님 생일 축하드려요')).toEqual(['ㅇㅇㅇ']);
    expect(texts('□□매장 오픈')).toEqual(['□□매장']);
    expect(texts('XX 지점 방문 시')).toEqual(['XX']);
  });
  it('오탐 0: XXL · OOTD · 000원 · 1,000점 · ★★ · 구분선 · ZOOM', () => {
    expect(texts('XXL 사이즈 입고')).toEqual([]);
    expect(texts('오늘의 OOTD 추천')).toEqual([]);
    expect(texts('10,000원 할인 · 1,000점 적립')).toEqual([]);
    expect(texts('★★ 오늘만 ★★')).toEqual([]);
    expect(texts('ㅡㅡㅡㅡㅡㅡ\n○○○○○○○○')).toEqual([]);
    expect(texts('ZOOM 강의 안내')).toEqual([]);
  });
  it('5개 이상 연속 = 장식으로 본다', () => {
    expect(texts('OOOOO점')).toEqual([]);
  });
  it('변수 · 주소 · 수신거부 줄 안은 보지 않는다', () => {
    expect(texts('%이름%님 https://ex.com/OOO점\n무료수신거부 080-000-0000 OO점')).toEqual([]);
  });
});

describe('findAgencyBlanks — 괄호 꼴', () => {
  it('낱말 표와 같은 괄호 = 빈 자리 · 머리말은 아님', () => {
    expect(texts('[시세이도] 소중한 [고객명] 고객님 · [매장명]에서')).toEqual(['[고객명]', '[매장명]']);
    expect(texts('(광고) [공식몰 단독 혜택] 11월25일(수)')).toEqual([]);
  });
  it('낱말 조각 + 필드 끝말 = 빈 자리(시세이도 [소속매장명] [소속매장전화번호]) · 문안만으로 · 안내 머리말은 아님', () => {
    expect(texts('*장소: [소속매장명]\n*문의: [소속매장전화번호]')).toEqual(['[소속매장명]', '[소속매장전화번호]']);
    expect(texts('[매장 안내] [번호표 이벤트] [지점 오픈] [매장 선착순 100명] [매장 선착순 １００명] [매장 선착순 ⑩명]')).toEqual([]);
  });
});

describe('convertBracketVars — 명단 열과 같은 이름의 [ ] = 변수(§8-3)', () => {
  it('[고객명] → %고객명% · 머리말 [시세이도] 그대로 · 이름 다른 괄호 그대로', () => {
    const r = convertBracketVars('(광고) [시세이도] 소중한 [고객명] 고객님\n*장소: [소속매장명]', ['고객명', '휴대폰번호', '소속 매장']);
    expect(r.content).toBe('(광고) [시세이도] 소중한 %고객명% 고객님\n*장소: [소속매장명]');
    expect(r.converted).toEqual([{ from: '[고객명]', column: '고객명' }]);
  });
  it('열 이름에 공백이 있으면 공백을 뺀 이름으로 넣는다(같은 이름 연결 규칙이 공백을 무시)', () => {
    const r = convertBracketVars('[소속 매장]', ['소속 매장']);
    expect(r.content).toBe('%소속매장%');
  });
});

describe('matchBlankColumns — 후보 열 · 점 세기', () => {
  const headers = ['고객명', '휴대폰번호', '소속매장명', '매장번호'];
  const rows = [
    { 소속매장명: '여수교동점' }, { 소속매장명: '광양' }, { 소속매장명: '순천점' }, { 소속매장명: '' },
  ];
  it('OOO점 → 매장 열 후보 · 점 끝 2 · 아님 1 · 빈 값 1 · 실제 예시', () => {
    const blank = findAgencyBlanks('OOO점만의 행사')[0];
    const c = matchBlankColumns(blank, headers, rows);
    expect(c.map((x) => x.column)).toEqual(['소속매장명']);
    expect(c[0]).toMatchObject({ endsWithSuffix: 2, notSuffix: 1, empty: 1, exampleWithSuffix: '여수교동점', exampleWithoutSuffix: '광양' });
  });
  it('[소속매장명] ↔ 열 「소속 매장」 느슨히 맞음', () => {
    const blank = findAgencyBlanks('[소속매장명]')[0];
    expect(matchBlankColumns(blank, ['고객명', '소속 매장'], []).map((x) => x.column)).toEqual(['소속 매장']);
  });
  it('열 이름이 달라도 값 절반 이상이 「점」으로 끝나면 매장 후보', () => {
    const blank = findAgencyBlanks('OOO점')[0];
    const c = matchBlankColumns(blank, ['이름', '비고'], [{ 비고: 'A점' }, { 비고: 'B점' }, { 비고: 'C' }]);
    expect(c.map((x) => x.column)).toEqual(['비고']);
  });
});

describe('applySlotFills — 채우기(§4-1)', () => {
  const base = '"OOO점만의 행사" [고객명]님';
  it('열로 통째(OOO점) · 앞부분만(OOO) · 직접 적은 이름', () => {
    expect(applySlotFills(base, [{ start: 1, end: 5, before: 'OOO점', column: '소속 매장' }], ['소속 매장']))
      .toMatchObject({ ok: true, content: '"%소속매장%만의 행사" [고객명]님' });
    expect(applySlotFills(base, [{ start: 1, end: 4, before: 'OOO', column: '매장' }], ['매장']))
      .toMatchObject({ ok: true, content: '"%매장%점만의 행사" [고객명]님' });
    expect(applySlotFills(base, [{ start: 1, end: 5, before: 'OOO점', text: '여수교동점' }], []))
      .toMatchObject({ ok: true, content: '"여수교동점만의 행사" [고객명]님' });
  });
  it('두 자리 = 큰 위치부터 적용해 앞 위치가 안 밀린다', () => {
    const r = applySlotFills(base, [
      { start: 1, end: 5, before: 'OOO점', text: '광양점' },
      { start: 12, end: 17, before: '[고객명]', column: '고객명' },
    ], ['고객명']);
    expect(r).toMatchObject({ ok: true, content: '"광양점만의 행사" %고객명%님' });
  });
  it('고른 열 = 명시 연결 이름표(mapping) · 같은 이름에 다른 열 = 반려 · 빈 자리가 아닌 곳 = 반려', () => {
    const ok = applySlotFills(base, [{ start: 12, end: 17, before: '[고객명]', column: '고객 명' }], ['고객 명']);
    expect(ok).toEqual({ ok: true, content: '"OOO점만의 행사" %고객명%님', mapping: { 고객명: '고객 명' } });
    const two = applySlotFills('OOO점 [고객명]', [
      { start: 0, end: 4, before: 'OOO점', column: '소속 매장' }, { start: 5, end: 10, before: '[고객명]', column: '소속매장' },
    ], ['소속 매장', '소속매장']);
    expect(two.ok).toBe(false);
    expect(applySlotFills(base, [{ start: 8, end: 10, before: '행사', text: '세일' }], []).ok).toBe(false);
  });
  it('그 자리 글이 다르면 · 겹치면 · 없는 열이면 · 둘 다 비면 반려', () => {
    expect(applySlotFills(base, [{ start: 1, end: 5, before: 'XXX점', text: 'A' }], []).ok).toBe(false);
    expect(applySlotFills(base, [
      { start: 1, end: 5, before: 'OOO점', text: 'A' }, { start: 3, end: 6, before: 'O점만', text: 'B' },
    ], []).ok).toBe(false);
    expect(applySlotFills(base, [{ start: 1, end: 5, before: 'OOO점', column: '없는열' }], ['매장']).ok).toBe(false);
    expect(applySlotFills(base, [{ start: 1, end: 5, before: 'OOO점' }], []).ok).toBe(false);
  });
});

describe('findSuffixDup · countEmptyVarRows', () => {
  it('%열%점 인데 값도 점으로 끝남 = 점점', () => {
    const d = findSuffixDup('%매장%점만의 행사', [{ 매장: '여수교동점' }, { 매장: '광양' }, { 매장: '순천점' }]);
    expect(d).toEqual([{ name: '매장', suffix: '점', count: 2, example: '여수교동점점' }]);
  });
  it('「%이름%은」 같은 조사는 보지 않는다', () => {
    expect(findSuffixDup('%이름%은 특별해요', [{ 이름: '김은' }])).toEqual([]);
  });
  it('문안에 쓴 항목마다 빈 값 행 수(공백만 = 빈 값 · 키 없음 = 빈 값)', () => {
    expect(countEmptyVarRows('%매장%만의 행사 %이름%님', [{ 매장: '', 이름: '가' }, { 이름: '나' }, { 매장: ' ', 이름: '' }, { 매장: 'A점', 이름: '라' }]))
      .toEqual([{ name: '매장', count: 3 }, { name: '이름', count: 1 }]);
  });
});

describe('고객 문장 — 줄표 · 가운뎃점 0', () => {
  it('접수 알림 · 승인 문자 줄', () => {
    const blanks = findAgencyBlanks('OOO점만의 행사 [고객명]님');
    const lines = agencyBlankIntakeLines({ blanks, suffixDups: [{ name: '매장', suffix: '점', count: 2, example: '여수교동점점' }], emptyRows: [{ name: '매장', count: 12 }] });
    expect(lines[0]).toBe('문안에 채우지 않은 자리가 있습니다: OOO점, [고객명]');
    expect(lines.join('\n')).toContain('2명은 「매장」 값이 이미 점으로 끝나 이렇게 나갑니다: 여수교동점점');
    expect(lines.join('\n')).toContain('명단 12명은 「매장」 칸이 비어 있어 그 자리가 빈칸으로 나갑니다.');
    expect(agencyBlankApprovalLine(blanks)).toBe('문안에 채우지 않은 자리(OOO점, [고객명])가 있습니다. 승인 전에 확인해 주세요.');
    for (const l of [...lines, agencyBlankApprovalLine(blanks)]) {
      expect(l).not.toMatch(/[—·]/);
    }
  });
  it('빈 자리 없으면 빈 줄', () => {
    expect(agencyBlankIntakeLines({ blanks: [], suffixDups: [], emptyRows: [] })).toEqual([]);
    expect(agencyBlankApprovalLine([])).toBe('');
  });
});

describe('Codex 구현 1R — 숫자 뒤 괄호 변수 · 080 줄', () => {
  it('「11/25[매장명]」 = 숫자 뒤라 변수로 안 바꾼다(괄호 그대로 = 빈 자리로 남아 알림 · 승인 확인)', () => {
    const r = convertBracketVars('11/25[매장명] 방문 [고객명]님', ['매장명', '고객명']);
    expect(r.content).toBe('11/25[매장명] 방문 %고객명%님');
    expect(r.converted).toEqual([{ from: '[고객명]', column: '고객명' }]);
    expect(texts(r.content)).toEqual(['[매장명]']);
  });
  it('열 채우기도 숫자 바로 뒤면 반려', () => {
    expect(applySlotFills('11/25OOO점', [{ start: 5, end: 9, before: 'OOO점', column: '매장' }], ['매장']).ok).toBe(false);
  });
  it('가격 · 상품번호의 080 은 본다 · 수신거부 줄 · 080 전화번호 줄만 뺀다', () => {
    expect(texts('[고객명]님, 1,080원 할인')).toEqual(['[고객명]']);
    expect(texts('무료수신거부 OO점')).toEqual([]);
    expect(texts('문의 080-123-4567 OO점')).toEqual([]);
  });
});

describe('Codex 구현 2R — 앞자리 직접 입력이 뒤 열 채우기를 깨뜨림', () => {
  it('「[이름][지점명]」 = 앞 = 2 · 뒤 = 열 → 최종 「2%지점명%」 = 반려', () => {
    const r = applySlotFills('[이름][지점명] 방문', [
      { start: 0, end: 4, before: '[이름]', text: '2' },
      { start: 4, end: 9, before: '[지점명]', column: '지점명' },
    ], ['지점명']);
    expect(r.ok).toBe(false);
  });
});

describe('Codex 구현 3R — 채운 자리마다 최종 위치 대조', () => {
  it('「[가][지점명]」 = 앞 = 「%지점명」 직접 입력은 % 금지로 반려', () => {
    const r = applySlotFills('[가][지점명] 방문', [
      { start: 0, end: 3, before: '[가]', text: '%지점명' },
      { start: 3, end: 8, before: '[지점명]', column: '지점명' },
    ], ['지점명']);
    expect(r.ok).toBe(false);
  });
  it('두 자리를 같은 열로 채우면 둘 다 그 자리에서 변수로 읽힌다', () => {
    const r = applySlotFills('[지점명] 안내 [지점명] 방문', [
      { start: 0, end: 5, before: '[지점명]', column: '지점명' },
      { start: 9, end: 14, before: '[지점명]', column: '지점명' },
    ], ['지점명']);
    expect(r).toMatchObject({ ok: true, content: '%지점명% 안내 %지점명% 방문' });
  });
});

describe('Codex 구현 4R — 채운 뒤 원래 있던 항목도 그 자리에서 읽혀야 한다', () => {
  it('「[이름]%매장명% 행사」 = 이름에 숫자로 끝나는 값 → 원래 항목이 퍼센트가 됨 = 반려', () => {
    const r = applySlotFills('[이름]%매장명% 행사', [{ start: 0, end: 4, before: '[이름]', text: '12' }], ['매장명']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('%매장명%');
  });
  it('숫자로 끝나지 않는 값 = 원래 항목 그대로 읽힘', () => {
    const r = applySlotFills('[이름]%매장명% 행사', [{ start: 0, end: 4, before: '[이름]', text: '가나' }], ['매장명']);
    expect(r).toMatchObject({ ok: true, content: '가나%매장명% 행사' });
  });
  it('요청서 숫자 바로 뒤 열 채우기 = 요청서를 고치라는 반려', () => {
    const r = applySlotFills('1[지점명] 방문', [{ start: 1, end: 6, before: '[지점명]', column: '지점명' }], ['지점명']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('요청서에서');
  });
});
