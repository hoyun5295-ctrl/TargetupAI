/**
 * 백엔드 normalizePhone 국가코드 계약 (★2026-09-13(3) · 싱크에이전트 미러와 같은 표)
 *
 *   '+82' 분기는 위에서 '+'를 먼저 지워 도달하지 않았다. 지운 뒤에도 결과가 같아야 한다(동작 변화 0).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalizePhone } from '../normalize';

describe('normalizePhone 국가코드·표기(백엔드 원본)', () => {
  it.each([
    ['+821000001234', '01000001234'],
    ['821000001234', '01000001234'],
    ['+82-10-0000-1234', '01000001234'],
    ['010-0000-1234', '01000001234'],
    ['1000001234', '01000001234'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('도달하지 않는 +82 분기가 없다(82 분기는 남는다)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../normalize.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function normalizePhone('), src.indexOf('export function normalizePhone(') + 700);
    expect(fn).not.toContain("startsWith('+82')");
    expect(fn).toContain("startsWith('82')");
  });
});
