/**
 * 실 PG 시험층 관리 연결 허용 목록(★ 2026-10-27 설계서 §2-4 · D1 허가 = t_ DB 생성 · 삭제 · DB 없음)
 */
import { describe, it, expect } from 'vitest';
import { assertAdminExec } from './pg/admin';

describe('관리 연결 — 허용 목록 문장만', () => {
  it.each([
    'CREATE DATABASE t_tpl',
    'CREATE DATABASE t_tpl_closed TEMPLATE t_tpl',
    'CREATE DATABASE t_f_1_ab12cd34 TEMPLATE t_tpl_closed',
    'DROP DATABASE IF EXISTS t_f_1_ab12cd34 WITH (FORCE)',
    `COMMENT ON DATABASE t_tpl IS '${'a'.repeat(64)}'`,
  ])('통과: %s', (sql) => {
    expect(() => assertAdminExec(sql)).not.toThrow();
  });
  it.each([
    'DROP DATABASE postgres',
    'DROP DATABASE IF EXISTS postgres',
    'CREATE DATABASE x',
    'CREATE DATABASE "t_x"',
    'CREATE DATABASE t_x; DROP DATABASE postgres',
    'CREATE DATABASE t_x TEMPLATE postgres',
    'ALTER DATABASE t_tpl RENAME TO postgres2',
    "COMMENT ON DATABASE t_tpl IS 'x'); DROP DATABASE postgres; --'",
    'DROP ROLE postgres',
    'CREATE DATABASE T_X',
  ])('거절: %s', (sql) => {
    expect(() => assertAdminExec(sql)).toThrow(/허용 목록 밖/);
  });
});
