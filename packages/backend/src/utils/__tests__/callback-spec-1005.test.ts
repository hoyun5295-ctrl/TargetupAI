/**
 * ★1005 발신번호 규격(세칙) — 특수한 유형의 부가통신사업 재등록 증빙 ⑥
 *
 * 못 박는 것:
 *   1. 세부지침 제16조 · 제13조제4항 규격(utils/callback-spec.ts). 같은 시험 벡터를 비토 게이트웨이(Go · JS)도 쓴다.
 *   2. 발신번호가 만들어지거나 바뀌는 길목 5곳과 발송 직전 회신번호 검사 3곳이 전부 이 함수를 지난다(길이만 보던 인라인 검사 0).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkCallbackSpec } from '../callback-spec';

const VALID = [
  '010-1234-5678', '02-403-8517', '031-123-4567', '064-123-4567', '011-123-4567',
  '1800-8125', '15881234', '1644-0000', '070-1234-5678', '080-719-6700', '060-123-4567',
  '0505-123-4567', '050512345678', '030312345678', '(02) 403-8517', '02.403.8517',
];
const INVALID = [
  '', '   ', 'abc', '+82-10-1234-5678', '010-123-4567', '0101234567', '01012345678901',
  '1588-12345', '1588123', '112', '1335', '1004', '12345678', '0212345',
  '02-1588-1234', '031-1600-1234', '031-080-1234', '02-0123-4567', '0505123456789',
];

describe('발신번호 규격(세부지침 제16조 · 제13조제4항)', () => {
  it.each(VALID)('%s = 허용', (n) => {
    const v = checkCallbackSpec(n);
    expect(v.ok, JSON.stringify(v)).toBe(true);
    if (v.ok) expect(v.digits).toBe(n.replace(/\D/g, ''));
  });

  it.each(INVALID)('%s = 거부', (n) => {
    const v = checkCallbackSpec(n);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('CALLBACK_SPEC_VIOLATION');
      expect(v.message).not.toMatch(/[A-Za-z_]{6,}/); // 사용자 문구에 내부 식별자 없음
    }
  });

  it('null · undefined · 숫자형도 던지지 않고 거부한다', () => {
    expect(checkCallbackSpec(null).ok).toBe(false);
    expect(checkCallbackSpec(undefined).ok).toBe(false);
    expect(checkCallbackSpec(1588).ok).toBe(false);
  });
});

describe('길목 배선 — 길이만 보던 인라인 검사가 남지 않는다', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
  const FILES = ['../../routes/admin.ts', '../../routes/manage-callbacks.ts', '../../routes/campaigns.ts', '../sender-registration.ts'];

  it.each(FILES)('%s 에 「length < 8 || length > 11」 회신번호 검사가 없다', (p) => {
    expect(read(p)).not.toMatch(/\.length < 8 \|\| [A-Za-z]+\.length > 11/);
  });

  it('등록 길목은 저장 전에 규격을 본다(직접 등록 · 고객사 등록 · 신청 접수 · 신청 승인)', () => {
    const fn = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start) + 1));
    const admin = read('../../routes/admin.ts');
    const post = fn(admin, "router.post('/callback-numbers'", 'INSERT INTO callback_numbers');
    expect(post).toMatch(/checkCallbackSpec\(phone\)/);
    const put = admin.slice(admin.indexOf('R280 — 번호가 바뀌면'), admin.indexOf('UPDATE callback_numbers', admin.indexOf('R280 — 번호가 바뀌면')));
    expect(put).toMatch(/checkCallbackSpec\(phone\)/);
    const mc = read('../../routes/manage-callbacks.ts');
    expect(mc.slice(0, mc.indexOf('INSERT INTO callback_numbers'))).toMatch(/checkCallbackSpec\(phone\)/);
    const sr = read('../sender-registration.ts');
    const create = fn(sr, 'export async function createRegistration(', 'INSERT INTO sender_registrations');
    expect(create).toMatch(/checkCallbackSpec\(data\.phone\)/);
    const approve = fn(sr, 'export async function approveRegistration(', 'INSERT INTO callback_numbers');
    expect(approve).toMatch(/checkCallbackSpec\(reg\.phone\)/);
  });

  // Codex 1R high — 개별 회신번호는 위 3곳을 타지 않는다. 등록 번호 집합에서 위반 번호를 빼야 그 길목 전부가 같이 막힌다
  it('등록 번호 집합(getRegisteredCallbackSet)이 규격 위반 번호를 뺀다', () => {
    const src = read('../callback-filter.ts');
    const start = src.indexOf('export async function getRegisteredCallbackSet(');
    const body = src.slice(start, src.indexOf('\nexport ', start + 1));
    expect(body).toMatch(/\.filter\(\(r: any\) => checkCallbackSpec\(r\.phone\)\.ok\)/);
  });

  it('발송 직전 회신번호 검사 3곳이 규격 함수를 부른다', () => {
    const src = read('../../routes/campaigns.ts');
    expect((src.match(/checkCallbackSpec\(/g) || []).length).toBe(3);
    expect((src.match(/code: 'INVALID_CALLBACK_FORMAT'/g) || []).length).toBe(3);
  });
});
