/**
 * 운영 schema-only 덤프 자리 · 싣기 전 검사(★ 2026-10-27 설계서 §2-5)
 * 자리 = 저장소 밖 %USERPROFILE%\.hanjul-pgtest(운영 구조 전체가 git 에 들어가지 않는다).
 *   ★ 2026-10-28 B-1028-4 — 옛 자리 %LOCALAPPDATA%\hanjul-pgtest 는 Claude 데스크톱 앱 안에서 돈 프로그램의 쓰기가 Windows 에 의해
 *   앱 전용 폴더(%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Local\…)로 돌려져, 앱 밖 PowerShell(tp-push pre-push 시험)이 통과 스탬프를 못 읽었다.
 *   사용자 폴더(AppData 밖)는 돌려지지 않아 앱 안 · 밖이 같은 파일을 본다.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const PROD_PG_VERSION = '15.15';

export function pgTestDir(env: Record<string, string | undefined> = process.env): string {
  if (!env.USERPROFILE) throw new Error('[test:pg] USERPROFILE 없음 · 덤프 · 스탬프 자리를 정할 수 없다');
  return join(env.USERPROFILE, '.hanjul-pgtest');
}

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export interface PreparedDump { sql: string; sha256: string }

/** 판 줄 · 끝 표식 · psql 전용 줄(\restrict · \unrestrict 만 빼고 그 밖은 실패) */
export function prepareDump(text: string): PreparedDump {
  const v = /^-- Dumped from database version (\S+)/m.exec(text);
  if (!v) throw new Error('[test:pg 덤프] 판 줄(Dumped from database version) 없음');
  if (v[1] !== PROD_PG_VERSION) throw new Error(`[test:pg 덤프] 운영 판 ${v[1]} ≠ 그릇 판 ${PROD_PG_VERSION} · 그릇 판도 같이 바꿔야 한다`);
  if (!/^-- PostgreSQL database dump complete\s*$/m.test(text)) throw new Error('[test:pg 덤프] 끝 표식 없음(잘린 파일)');
  const lines = text.split(/\r?\n/).filter((line) => {
    if (!line.startsWith('\\')) return true;
    if (/^\\(un)?restrict \S+$/.test(line)) return false;
    throw new Error(`[test:pg 덤프] 허용 밖 psql 줄 = ${line.slice(0, 40)}`);
  });
  return { sql: lines.join('\n'), sha256: sha256(text) };
}

export interface SchemaMeta { server_version: string; datcollate: string; timezone: string; at: string; fingerprint: string }

export function parseSchemaMeta(text: string): SchemaMeta {
  const m = JSON.parse(text);
  for (const k of ['server_version', 'datcollate', 'timezone', 'at', 'fingerprint']) {
    if (typeof m?.[k] !== 'string' || !m[k]) throw new Error(`[test:pg 덤프] schema.meta.json 에 ${k} 없음`);
  }
  return m as SchemaMeta;
}
