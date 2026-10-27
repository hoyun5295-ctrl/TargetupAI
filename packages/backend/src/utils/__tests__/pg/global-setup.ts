/**
 * test:pg globalSetup(주 프로세스 · ★ 2026-10-27 설계서 §2-3 · §2-5 · §2-8)
 * 안전문 → 그릇 판 · 시간대 → 덤프 검사 · 정렬 → 찌꺼기 청소 → t_tpl(덤프) · t_tpl_closed(+ 원장 §2) · t_tpl_after(+ 원장 §1) → 시작 줄
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { assertPgTestEnv } from './gate';
import { withAdmin } from './admin';
import { pgTestDir, prepareDump, parseSchemaMeta, sha256, PROD_PG_VERSION } from './dump';
import { SCHEMA_FINGERPRINT_SQL } from './fingerprint';
import { BACKEND_ROOT } from './stamp';
import { pgTestUrl, PG_TEST_START_HINT } from '../../../../scripts/test-pg-env.mjs';
import { parseLedger } from '../../../../scripts/deploy-ledger-lib.mjs';

export const TEMPLATES = ['t_tpl', 't_tpl_closed', 't_tpl_after'] as const;
export const LEDGER_PATH = join(BACKEND_ROOT, '..', '..', 'status', 'DEPLOY-LEDGER.md');

async function onDb<T>(db: string, work: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: pgTestUrl(db) });
  await c.connect();
  try { return await work(c); } finally { await c.end().catch(() => undefined); }
}

/** 원천 해시가 COMMENT 와 같으면 그대로 · 다르면 지우고 다시 짓는다 · 짓다 실패하면 지우고 던진다 */
async function ensureTemplate(name: (typeof TEMPLATES)[number], from: string | null, source: string, notes: Map<string, string | null>,
  build: (c: Client) => Promise<void>): Promise<boolean> {
  if (notes.get(name) === source) return false;
  await withAdmin(async (a) => {
    await a.exec(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await a.exec(from ? `CREATE DATABASE ${name} TEMPLATE ${from}` : `CREATE DATABASE ${name}`);
  });
  try {
    await onDb(name, build);
  } catch (err) {
    await withAdmin((a) => a.exec(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    throw err;
  }
  await withAdmin((a) => a.exec(`COMMENT ON DATABASE ${name} IS '${source}'`));
  return true;
}

const runBlock = async (c: Client, b: { kind: string; id: string; sql: string }): Promise<void> => {
  try {
    if (b.kind === 'dml') {
      await c.query('BEGIN');
      try { await c.query(b.sql); } finally { await c.query('ROLLBACK'); }
    } else {
      await c.query(b.sql);
    }
  } catch (err: any) {
    throw new Error(`[test:pg 원장] 블록 ${b.kind}:${b.id} 실패 · ${err?.code ?? ''} ${err?.message ?? err}`);
  }
};

export default async function setup(): Promise<void> {
  assertPgTestEnv(process.env, process.cwd());
  const dir = pgTestDir();

  let version: string;
  let timezone: string;
  let dbs: Array<{ datname: string; datcollate: string; note: string | null }>;
  try {
    ({ version, timezone, dbs } = await withAdmin(async (a) => ({
      version: (await a.select('version'))[0].server_version,
      timezone: (await a.select('timezone'))[0].TimeZone,
      dbs: await a.select('databases'),
    })));
  } catch (err: any) {
    throw new Error(`[test:pg] 시험 그릇에 닿지 않는다(${err?.code ?? err?.message}) · Harold 님: ${PG_TEST_START_HINT} · 그릇이 없으면 설계서 §2-1 명령`);
  }
  if (!String(version).startsWith(`${PROD_PG_VERSION} `) && String(version) !== PROD_PG_VERSION) {
    throw new Error(`[test:pg] 그릇 판 ${version} ≠ 운영 ${PROD_PG_VERSION}`);
  }

  const dumpFile = join(dir, 'schema.sql');
  const metaFile = join(dir, 'schema.meta.json');
  if (!existsSync(dumpFile) || !existsSync(metaFile)) {
    throw new Error(`[test:pg] 덤프 없음(${dumpFile} · schema.meta.json) · 다음 「배포 시작하자」 때 받는다(원장 PGT-DUMP)`);
  }
  const dump = prepareDump(readFileSync(dumpFile, 'utf8'));
  const meta = parseSchemaMeta(readFileSync(metaFile, 'utf8'));
  const collate = dbs.find((d) => d.datname === 'postgres')?.datcollate;
  if (meta.datcollate !== collate) throw new Error(`[test:pg] 정렬 운영 ${meta.datcollate} ≠ 그릇 ${collate} · 그릇 이미지 계열을 운영과 맞춘다`);
  const utc = (tz: string): string => (/^(Etc\/)?(UTC|UCT|Universal|Zulu)$/.test(tz) ? 'UTC' : tz);
  if (utc(meta.timezone) !== utc(timezone)) throw new Error(`[test:pg] 시간대 운영 ${meta.timezone} ≠ 그릇 ${timezone}`);

  // 찌꺼기 청소(세 template 밖의 t_ DB · 죽은 실행이 남긴 것)
  const notes = new Map(dbs.map((d) => [d.datname, d.note]));
  await withAdmin(async (a) => {
    for (const d of dbs) {
      if (d.datname.startsWith('t_') && !(TEMPLATES as readonly string[]).includes(d.datname)) await a.exec(`DROP DATABASE IF EXISTS ${d.datname} WITH (FORCE)`);
    }
  });

  const ledger = parseLedger(readFileSync(LEDGER_PATH, 'utf8'));
  const applied = ledger.blocks.filter((b: any) => b.section === 'applied');
  const pending = ledger.blocks.filter((b: any) => b.section === 'pending');
  if (applied.some((b: any) => b.kind !== 'ddl')) throw new Error('[test:pg 원장] §2 덤프 뒤 적용분에는 ddl 블록만 둔다');

  // 원천 해시 = 덤프 + 운영 머리 SELECT 의 정의 해시(둘 중 하나만 바뀌어도 다시 짓고 다시 대조 · Codex 구현 R1 #2)
  // 짓기 안에서 대조까지 끝낸 뒤에만 COMMENT(표식)를 쓴다 = 대조 전에 끊겨도 다음 실행이 캐시로 건너뛰지 않는다
  const srcTpl = sha256(`${dump.sha256}|${meta.fingerprint}`);
  await ensureTemplate('t_tpl', null, srcTpl, notes, async (c) => {
    await c.query(dump.sql);
    const fp = await onDb('t_tpl', async (f) => (await f.query(SCHEMA_FINGERPRINT_SQL)).rows[0].fingerprint);   // 기본 search_path 연결(적재 연결은 비워 둠)
    if (fp !== meta.fingerprint) throw new Error(`[test:pg] 복원한 덤프의 정의 해시 ${fp} ≠ 운영 머리 SELECT ${meta.fingerprint} · 복원 차이(확장 · 판 · 권한)를 본다`);
  });
  const srcClosed = sha256(srcTpl + applied.map((b: any) => `${b.id}\n${b.sql}`).join('\n'));
  await ensureTemplate('t_tpl_closed', 't_tpl', srcClosed, notes, async (c) => { for (const b of applied) await runBlock(c, b); });
  const srcAfter = sha256(srcClosed + pending.map((b: any) => `${b.kind}:${b.id}\n${b.sql}`).join('\n'));
  await ensureTemplate('t_tpl_after', 't_tpl_closed', srcAfter, notes, async (c) => {
    for (const b of pending.filter((x: any) => x.kind === 'ddl')) await runBlock(c, b);
    for (const b of pending.filter((x: any) => x.kind === 'dml')) await runBlock(c, b);
  });

  console.log(`[test:pg] 덤프 ${meta.at} · 덤프 뒤 적용 DDL ${applied.length} · 마지막 해시 대조 ${ledger.head['마지막 해시 대조'] || '없음'} · 대기 블록 ${pending.length} 시험 통과(t_tpl_after)`);
}
