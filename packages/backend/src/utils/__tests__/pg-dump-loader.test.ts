/**
 * 실 PG 시험층 덤프 검사(★ 2026-10-27 설계서 §2-5 · DB 없음)
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { prepareDump, parseSchemaMeta, pgTestDir } from './pg/dump';

const dump = (body: string, version = '15.15 (Debian 15.15-1.pgdg120+1)', end = true): string =>
  `--\n-- PostgreSQL database dump\n--\n\n\\restrict AbCdEf123\n\n-- Dumped from database version ${version}\n-- Dumped by pg_dump version 15.15\n\nSET statement_timeout = 0;\n${body}\n${end ? '--\n-- PostgreSQL database dump complete\n--\n\n\\unrestrict AbCdEf123\n' : ''}`;

describe('덤프 싣기 전 검사', () => {
  it('정상 덤프 = \\restrict · \\unrestrict 줄만 빠지고 나머지는 그대로', () => {
    const p = prepareDump(dump('CREATE TABLE public.t (id integer);'));
    expect(p.sql).not.toMatch(/^\\/m);
    expect(p.sql).toContain('CREATE TABLE public.t (id integer);');
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('판 줄 없음 = 실패', () => {
    expect(() => prepareDump('CREATE TABLE t ();\n-- PostgreSQL database dump complete\n')).toThrow(/판 줄/);
  });
  it('운영 판이 15.15 가 아님 = 실패(그릇 판도 바꿔야 한다)', () => {
    expect(() => prepareDump(dump('SELECT 1;', '16.4'))).toThrow(/16\.4/);
    expect(() => prepareDump(dump('SELECT 1;', '15.150'))).toThrow(/15\.150/);
  });
  it('끝 표식 없음(잘린 파일) = 실패', () => {
    expect(() => prepareDump(dump('CREATE TABLE t ();', undefined, false))).toThrow(/끝 표식/);
  });
  it('허용 밖 psql 줄(\\connect · \\i) = 실패', () => {
    expect(() => prepareDump(dump('\\connect targetup'))).toThrow(/psql 줄/);
    expect(() => prepareDump(dump('\\i /etc/passwd'))).toThrow(/psql 줄/);
  });
  it('머리 SELECT 출력(schema.meta.json) = 다섯 칸이 다 있어야 한다', () => {
    const ok = { server_version: '15.15', datcollate: 'en_US.utf8', timezone: 'Etc/UTC', at: '2026-10-27T00:00:00Z', fingerprint: 'abc' };
    expect(parseSchemaMeta(JSON.stringify(ok))).toEqual(ok);
    expect(() => parseSchemaMeta(JSON.stringify({ ...ok, fingerprint: '' }))).toThrow(/fingerprint/);
    expect(() => parseSchemaMeta(JSON.stringify({ ...ok, datcollate: undefined }))).toThrow(/datcollate/);
  });
  it('자리 = %USERPROFILE%\\.hanjul-pgtest(앱이 돌려 쓰는 AppData 아님 · 앱 안팎이 같은 스탬프 · B-1028-4) · USERPROFILE 없으면 실패', () => {
    expect(pgTestDir({ USERPROFILE: 'C:\\Users\\u', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' })).toBe(join('C:\\Users\\u', '.hanjul-pgtest'));
    expect(() => pgTestDir({ LOCALAPPDATA: 'C:\\L' })).toThrow(/USERPROFILE/);
  });
});
