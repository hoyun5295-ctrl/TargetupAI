import { describe, test, expect } from 'vitest';
import { dropEmptyColumns } from './excel-columns';

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
