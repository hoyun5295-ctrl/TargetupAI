/**
 * mapRow 복합 매핑(쪼개진 전화번호 이어붙이기) 테스트
 *
 * 배경(2026-06-30 isae 원격 설치 실측): 고객 DB가 휴대폰을 핸드폰1='010' / 핸드폰2='1234' /
 * 핸드폰3='5678' 3칸으로 쪼개 저장. 한 칸만 phone에 매핑하면 전 고객이 '010' 하나로 뭉쳐
 * 식별키(phone)가 붕괴된다. 같은 표준 필드에 매핑된 소스 컬럼을 끝자리 숫자 순으로 이어붙인다.
 */
import { describe, it, expect } from 'vitest';
import { mapRow } from './index';

describe('mapRow — 복합 매핑(쪼개진 전화번호)', () => {
  it('여러 소스 컬럼이 phone으로 매핑되면 순서대로 이어붙인다', () => {
    const mapping = { 핸드폰1: 'phone', 핸드폰2: 'phone', 핸드폰3: 'phone', 성명: 'name' };
    const row = { 성명: '홍길동', 핸드폰1: '010', 핸드폰2: '1234', 핸드폰3: '5678' };
    const out = mapRow(row, mapping);
    expect(out.phone).toBe('01012345678');
    expect(out.name).toBe('홍길동');
  });

  it('이어붙이는 순서는 끝자리 숫자 기준(매핑 삽입 순서와 무관)', () => {
    const mapping = { 핸드폰3: 'phone', 핸드폰1: 'phone', 핸드폰2: 'phone' };
    const row = { 핸드폰1: '010', 핸드폰2: '1234', 핸드폰3: '5678' };
    expect(mapRow(row, mapping).phone).toBe('01012345678');
  });

  it('빈/널 조각은 건너뛴다', () => {
    const mapping = { 핸드폰1: 'phone', 핸드폰2: 'phone', 핸드폰3: 'phone' };
    const row = { 핸드폰1: '010', 핸드폰2: null, 핸드폰3: '5678' };
    expect(mapRow(row, mapping).phone).toBe('0105678');
  });

  it('모든 조각이 비면 phone은 null', () => {
    const mapping = { 핸드폰1: 'phone', 핸드폰2: 'phone' };
    const row = { 핸드폰1: '', 핸드폰2: null };
    expect(mapRow(row, mapping).phone).toBeNull();
  });

  it('단일 매핑은 기존대로 값 그대로', () => {
    const mapping = { CUST_HP: 'phone' };
    const row = { CUST_HP: '01099998888' };
    expect(mapRow(row, mapping).phone).toBe('01099998888');
  });

  it('주소는 공백으로 잇는다(주소1 + 주소2)', () => {
    const mapping = { 주소1: 'address', 주소2: 'address' };
    const row = { 주소1: '서울시 강남구', 주소2: '테헤란로 123' };
    expect(mapRow(row, mapping).address).toBe('서울시 강남구 테헤란로 123');
  });

  it('전화번호는 구분자 없이 잇는다', () => {
    const mapping = { 핸드폰1: 'phone', 핸드폰2: 'phone' };
    const row = { 핸드폰1: '010', 핸드폰2: '12345678' };
    expect(mapRow(row, mapping).phone).toBe('01012345678');
  });

  it('custom 슬롯은 이어붙이지 않고 각자 보존', () => {
    const mapping = { A: 'custom_1', B: 'custom_2' };
    const row = { A: 'x', B: 'y' };
    const out = mapRow(row, mapping) as any;
    expect(out.custom_fields).toEqual({ custom_1: 'x', custom_2: 'y' });
  });

  it('매핑에 있으나 row에 없는 컬럼은 무시(기존 동작 유지)', () => {
    const mapping = { 핸드폰1: 'phone', 핸드폰2: 'phone', 없는컬럼: 'name' };
    const row = { 핸드폰1: '010', 핸드폰2: '12345678' };
    const out = mapRow(row, mapping);
    expect(out.phone).toBe('01012345678');
    expect('name' in out).toBe(false);
  });
});
