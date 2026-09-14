/**
 * normalizePhone 국가코드·표기 계약 (★2026-09-13(3) 싱크 ⓔ)
 *
 *   '+82' 분기는 바로 위에서 '+'를 먼저 지워 한 번도 도달하지 않았다. 지운 뒤에도 결과가 같아야 한다(동작 변화 0).
 *   ⛔ '82' 분기는 남긴다. 이 표가 두 분기를 헷갈려 지우는 실수를 잡는다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePhone, normalizeCustomerBatch } from './index';

describe('normalizePhone 국가코드·표기', () => {
  it.each([
    ['+821000001234', '01000001234'],
    ['821000001234', '01000001234'],
    ['+82-10-0000-1234', '01000001234'],
    ['+82 10 0000 1234', '01000001234'],
    ['(+82)10.0000.1234', '01000001234'],
    ['010-0000-1234', '01000001234'],
    ['1000001234', '01000001234'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([['1588-1234'], [''], [null], [undefined]])('%s → null', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('+82 번호가 배치 정규화에서 드롭되지 않는다', () => {
    const r = normalizeCustomerBatch([{ phone: '+82-10-0000-1234' }]);
    expect(r.dropped).toHaveLength(0);
    expect(r.normalized[0].phone).toBe('01000001234');
  });

  it('도달하지 않는 +82 분기가 없다(82 분기는 남는다)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'index.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function normalizePhone('), src.indexOf('export function normalizePhone(') + 600);
    expect(fn).not.toContain("startsWith('+82')");
    expect(fn).toContain("startsWith('82')");
  });
});
