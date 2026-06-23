import { describe, test, expect } from 'vitest';
import { dropEmptyColumns, dropEmptyHeaderColumns, isFirstRowHeaderRow } from './excel-columns';

describe('dropEmptyColumns — 헤더·데이터 전부 빈 열만 제거 (직접발송 빈열 노출 차단)', () => {
  test('이새 케이스: 꼬리 빈 열(G~J)은 제거, 데이터 있는 무헤더 열(E)은 유지', () => {
    const data = [
      ['매장명', '매장전화번호', '고객번호', '고객명', null, '고객핸드폰번호', null, null, null, null],
      ['AK수원', '031-240-1323', 'SP2001793', '김세현', null, '010-7570-1422', null, null, null, null],
      ['AK수원', '031-240-1323', 'SP2001194', '서인숙', 'SMS수신여부N', '010-9717-8860', null, null, null, null],
    ];
    const out = dropEmptyColumns(data);
    // 유지: 0~3(헤더+데이터), 4(E — 헤더 없지만 3행에 데이터), 5(F). 제거: 6~9(G~J 전무).
    expect(out[0]).toEqual(['매장명', '매장전화번호', '고객번호', '고객명', null, '고객핸드폰번호']);
    expect(out[2]).toEqual(['AK수원', '031-240-1323', 'SP2001194', '서인숙', 'SMS수신여부N', '010-9717-8860']);
    expect(out.length).toBe(3);
  });

  test('빈 열이 없으면 원본 그대로(동일 참조 반환 — 빠른 경로)', () => {
    const data = [['a', 'b'], ['1', '2']];
    expect(dropEmptyColumns(data)).toBe(data);
  });

  test('값 0은 데이터로 인정(빈 열 아님) — D150-3 falsy 사고 회귀 방지', () => {
    const data = [['수량', null], [0, null]];
    const out = dropEmptyColumns(data);
    expect(out[0]).toEqual(['수량']);
    expect(out[1]).toEqual([0]);
  });

  test('공백문자만 있는 열은 빈 열로 제거', () => {
    const data = [['a', '  '], ['1', ' ']];
    const out = dropEmptyColumns(data);
    expect(out[0]).toEqual(['a']);
  });

  test('빈 배열은 그대로 반환', () => {
    expect(dropEmptyColumns([])).toEqual([]);
  });

  test('행마다 길이가 달라도 최대 열 수 기준으로 판정', () => {
    const data = [['a', 'b', null], ['1'], ['2', 'y']];
    // 열0: a/1/2 데이터, 열1: b//y 데이터, 열2: null뿐 → 제거
    const out = dropEmptyColumns(data);
    expect(out[0]).toEqual(['a', 'b']);
    expect(out[1]).toEqual(['1', undefined]);
    expect(out[2]).toEqual(['2', 'y']);
  });
});

describe('dropEmptyHeaderColumns — 헤더 빈 열 제외(직접발송 컬럼5·7 재발 차단)', () => {
  test('헤더 빈 + 드문 값 열(E·G)은 제거, 헤더 있는 열은 유지', () => {
    const data = [
      ['매장명', '매장전화번호', '고객번호', '고객명', null, '고객핸드폰번호', null],
      ['AK수원', '031-240-1323', 'SP2001793', '김세현', null, '010-7570-1422', null],
      ['AK수원', '031-240-1323', 'SP2001194', '서인숙', 'SMS수신여부N', '010-9717-8860', '메모'],
    ];
    const out = dropEmptyHeaderColumns(data);
    // E(idx4·2행중1)·G(idx6·2행중1) 제거. 헤더 있는 0~3·5 유지.
    expect(out[0]).toEqual(['매장명', '매장전화번호', '고객번호', '고객명', '고객핸드폰번호']);
    expect(out[2]).toEqual(['AK수원', '031-240-1323', 'SP2001194', '서인숙', '010-9717-8860']);
  });

  test('헤더 없지만 모든 데이터 행에 값이 꽉 찬 열은 유지(진짜 무헤더 데이터 열·손실 방지)', () => {
    const data = [
      ['이름', null],
      ['김철수', '010-1111-2222'],
      ['이영희', '010-3333-4444'],
    ];
    const out = dropEmptyHeaderColumns(data);
    expect(out[0]).toEqual(['이름', null]);
    expect(out[1]).toEqual(['김철수', '010-1111-2222']);
    expect(out[2]).toEqual(['이영희', '010-3333-4444']);
  });

  test('값 0은 데이터로 인정(공백만 제외) — falsy 회귀 방지', () => {
    const data = [['수량', null], ['10', 0], ['20', 0]];
    const out = dropEmptyHeaderColumns(data);
    // idx1: 헤더 없지만 모든 데이터 행에 값(0 포함) → 유지 → 두 열 모두 유지(원본 그대로 반환)
    expect(out).toBe(data);
  });

  test('헤더 모두 있으면 원본 그대로(빠른 경로)', () => {
    const data = [['a', 'b'], ['1', '2']];
    expect(dropEmptyHeaderColumns(data)).toBe(data);
  });

  test('빈 배열은 그대로 반환', () => {
    expect(dropEmptyHeaderColumns([])).toEqual([]);
  });
});

describe('isFirstRowHeaderRow — 첫 행이 헤더인지 판정(텍스트 셀 존재)', () => {
  test('텍스트 헤더가 있으면 true', () => {
    expect(isFirstRowHeaderRow(['매장명', '전화번호', null])).toBe(true);
  });

  test('전부 숫자/전화번호면 false(데이터 행)', () => {
    expect(isFirstRowHeaderRow(['010-1111-2222', '12345'])).toBe(false);
  });

  test('빈 행은 false', () => {
    expect(isFirstRowHeaderRow([null, '', '  '])).toBe(false);
  });
});
