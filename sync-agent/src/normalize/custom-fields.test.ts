/**
 * 동기화 custom_1~15 값 계약 (★2026-09-13(3) 싱크 ⓒ)
 *
 *   mapRow는 custom 슬롯을 custom_fields 아래에 넣는데 normalizeCustomer는 최상위 custom_N만 보아, 동기화 경로에서는
 *   custom 값이 드라이버가 준 모양 그대로 나갔다. 날짜 컬럼은 JS Date → JSON 직렬화로 **UTC ISO 문자열**이 되어
 *   (KST 자정 날짜가 전날 15:00Z로) 원본과 다른 글자가 저장되고 문자에도 그 글자가 들어갔다.
 *   원칙(custom 원본 100% 보존): 원본 DB가 보여 주는 벽시계 글자로 되돌리고, 문자열·숫자·불리언은 한 글자도 바꾸지 않는다.
 *   드라이버별 벽시계 성분: mysql2 = 로컬(timezone 기본 'local') · tedious = UTC 성분(useUTC 기본 true) ·
 *   PostgreSQL 어댑터 = 로컬 Date를 toISOString으로 넘김.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeCustomer, normalizeSyncCustomFieldValue as f } from './index';

describe('동기화 custom 값: 원본 DB 벽시계 글자로', () => {
  it('mysql 로컬 Date: 날짜만이면 YYYY-MM-DD, 시각이 있으면 YYYY-MM-DD HH:mm:ss', () => {
    expect(f(new Date(2026, 0, 1), 'mysql')).toBe('2026-01-01');
    expect(f(new Date(2026, 3, 16, 15, 0, 0), 'mysql')).toBe('2026-04-16 15:00:00');
    expect(f(new Date(2026, 3, 16, 15, 0, 0, 250), 'mysql')).toBe('2026-04-16 15:00:00.250');
  });

  it('mssql(tedious useUTC) Date: UTC 성분이 벽시계다', () => {
    expect(f(new Date(Date.UTC(2026, 0, 1)), 'mssql')).toBe('2026-01-01');
    expect(f(new Date(Date.UTC(2026, 3, 16, 15, 30, 5)), 'mssql')).toBe('2026-04-16 15:30:05');
  });

  it('postgresql 어댑터가 넘긴 ISO(로컬 Date의 toISOString)는 벽시계 글자로 되돌린다', () => {
    expect(f(new Date(2026, 0, 1).toISOString(), 'postgresql')).toBe('2026-01-01');
    expect(f(new Date(2026, 3, 16, 9, 5, 0).toISOString(), 'postgresql')).toBe('2026-04-16 09:05:00');
  });

  it('ISO 모양 문자열도 mysql·mssql에서는 원본 문자열이다(드라이버가 Date로 주는 곳)', () => {
    const s = new Date(2026, 0, 1).toISOString();
    expect(f(s, 'mysql')).toBe(s);
    expect(f(s, 'mssql')).toBe(s);
  });

  it.each(['20260416150000', '250103', '1,800', '건성', ' 앞뒤공백 ', '2026-01-01'])('문자열은 한 글자도 바꾸지 않는다: %s', (s) => {
    expect(f(s, 'postgresql')).toBe(s);
    expect(f(s, 'mysql')).toBe(s);
  });

  it('숫자·불리언·null·빈 문자열은 그대로(타입 유지)', () => {
    expect(f(12.5, 'mssql')).toBe(12.5);
    expect(f(true, 'mysql')).toBe(true);
    expect(f(null, 'mysql')).toBeNull();
    expect(f('', 'mysql')).toBe('');
  });

  it('bigint는 문자열로(직렬화 예외 방지)', () => {
    expect(f(9007199254740993n, 'mysql')).toBe('9007199254740993');
  });
});

describe('normalizeCustomer가 custom_fields를 정리한다', () => {
  it('중첩 custom_fields를 새 객체로 정리하고, Buffer 키는 빼며(저장된 값을 지우지 않게), 넘긴 객체는 바꾸지 않는다', () => {
    const d = new Date(2026, 0, 1);
    const mapped = { phone: '01000001234', custom_fields: { custom_1: d, custom_2: 'x', custom_3: null, custom_4: Buffer.from('a') } };
    const out = normalizeCustomer(mapped, { dbType: 'mysql' }) as any;
    expect(out.custom_fields).toEqual({ custom_1: '2026-01-01', custom_2: 'x', custom_3: null });
    expect('custom_4' in out.custom_fields).toBe(false);
    expect(mapped.custom_fields.custom_1).toBe(d);
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('dbType 없이 불러도 문자열 custom은 그대로다(기존 호출 무변경)', () => {
    const out = normalizeCustomer({ phone: '01000001234', custom_fields: { custom_1: '2026-01-01' } }) as any;
    expect(out.custom_fields).toEqual({ custom_1: '2026-01-01' });
  });

  it('엔진은 원본 DB 종류를 넘긴다', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../sync/engine.ts'), 'utf8');
    expect(src).toMatch(/normalizeCustomerBatch\(mapped, \{ dbType: this\.db\.dbType \}\)/);
  });
});
