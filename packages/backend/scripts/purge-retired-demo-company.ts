/**
 * purge-retired-demo-company.ts — 은퇴한 시연 회사 완전 삭제(★ 2026-10-10 Harold 지시 "목록에서도 아예 없애기")
 *
 * 지우는 대상 = 회사 행 + 그 회사 데이터 전부. 표 목록은 DB 가 정한다(손으로 적은 표 목록 없음):
 *   ① companies 의 그 행  ② company_id 칸이 있는 모든 표의 그 회사 행
 *   ③ ①② 행을 외래키로 가리키는 행(삭제 규칙 NO ACTION · RESTRICT · CASCADE · 재귀) — SET NULL · SET DEFAULT 는 DB 가 비우므로 지우지 않는다.
 *
 * 지킴(하나라도 어기면 아무것도 안 한다):
 *   - 대상 회사 = is_demo true + 회사 코드 HJDEMO_ 로 시작(시드 --rebuild 가 붙인 은퇴 표식) + 로그인 hanjulai 없음 + 지금 .env 싱크 키의 회사가 아님
 *   - 지울 행 중 company_id 가 이 회사가 아닌 행(다른 회사 · 빈 값)이 하나라도 있으면 중단(다른 회사 데이터 0)
 *   - 여러 칸 외래키가 지울 행을 가리키면 중단(이 스크립트가 다루지 않는 모양)
 *   - 실행은 --apply --expect=<점검 총 건수> 일 때만 · 한 트랜잭션 · 회사 행 FOR UPDATE · 다시 센 수 ≠ expect 면 중단
 *   - 지우기 전에 지울 행 전부를 권한 600 파일(JSON 한 줄씩)로 남긴다(되돌릴 길) · 표마다 지운 수 = 센 수가 아니면 롤백
 *
 * 실행(운영 서버 · packages/backend):
 *   점검: npx ts-node scripts/purge-retired-demo-company.ts <회사 id>
 *   삭제: npx ts-node scripts/purge-retired-demo-company.ts <회사 id> --apply --expect=<점검 총 건수>
 */
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pool from '../src/config/database';

const RETIRED_CODE_PREFIX = 'HJDEMO_';
const DEMO_LOGIN_ID = 'hanjulai';

interface Fk { name: string; child: string; parent: string; childCols: string[]; parentCols: string[]; delType: string }
interface PlanRow { table: string; depth: number; pred: string; rows: number; foreign: number; via: string[] }

const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;
const DEL_RULE: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
const LOG_LIKE = /(audit|_logs?$|_log_|history|issued|access)/;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const companyId = (args.find((a) => !a.startsWith('--')) || '').trim();
  const apply = args.includes('--apply');
  const expectArg = args.find((a) => a.startsWith('--expect='));
  const expect = expectArg ? Number(expectArg.split('=')[1]) : NaN;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) throw new Error('회사 id(uuid)를 첫 인자로 주세요.');
  if (apply && !Number.isInteger(expect)) throw new Error('--apply 에는 --expect=<점검 총 건수> 가 필요합니다.');

  const client = await pool.connect();
  try {
    // ── 대상 확인
    const c = await client.query(`SELECT id, company_code, is_demo, api_key FROM companies WHERE id = $1::uuid`, [companyId]);
    if (c.rows.length === 0) throw new Error('회사가 없습니다.');
    const co = c.rows[0];
    if (co.is_demo !== true) throw new Error('시연 회사가 아닙니다. 중단합니다.');
    if (!String(co.company_code || '').startsWith(RETIRED_CODE_PREFIX)) throw new Error(`은퇴 표식(${RETIRED_CODE_PREFIX}) 회사가 아닙니다. 중단합니다.`);
    const login = await client.query(`SELECT 1 FROM users WHERE company_id = $1::uuid AND login_id = $2 LIMIT 1`, [companyId, DEMO_LOGIN_ID]);
    if (login.rows.length) throw new Error(`${DEMO_LOGIN_ID} 계정이 아직 이 회사에 있습니다. 중단합니다.`);
    const liveKey = (process.env.DEMO_SYNC_API_KEY || '').trim();
    if (liveKey && String(co.api_key || '') === liveKey) throw new Error('지금 매일 합성 데이터 워커가 쓰는 회사입니다. 중단합니다.');

    // ── 외래키 지도(DB 가 정한다)
    const fkr = await client.query(
      `SELECT c.conname AS name, cl.relname AS child, pl.relname AS parent, c.confdeltype AS del,
              array_agg(ca.attname::text ORDER BY k.ord) AS child_cols, array_agg(pa.attname::text ORDER BY k.ord) AS parent_cols
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_namespace cn ON cn.oid = cl.relnamespace AND cn.nspname = 'public'
         JOIN pg_class pl ON pl.oid = c.confrelid
         JOIN pg_namespace pn ON pn.oid = pl.relnamespace AND pn.nspname = 'public'
         CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(ck, fk, ord)
         JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.ck
         JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.fk
        WHERE c.contype = 'f'
        GROUP BY c.conname, cl.relname, pl.relname, c.confdeltype`,
    );
    const fks: Fk[] = fkr.rows.map((r: any) => ({ name: r.name, child: r.child, parent: r.parent, childCols: r.child_cols, parentCols: r.parent_cols, delType: r.del }));
    const scoped = await client.query(
      `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'company_id'`,
    );
    const hasCompanyId = new Set<string>(scoped.rows.map((r: any) => String(r.table_name)));

    // ── 지울 표 집합(도달 가능성) — 회사 · company_id 표에서 시작해 외래키 자식(지우는 규칙만)을 따라간다
    const removing = (fk: Fk) => fk.delType === 'a' || fk.delType === 'r' || fk.delType === 'c';
    const affected = new Set<string>(['companies', ...Array.from(hasCompanyId)]);
    for (let changed = true; changed;) {
      changed = false;
      for (const fk of fks) {
        if (removing(fk) && affected.has(fk.parent) && !affected.has(fk.child)) { affected.add(fk.child); changed = true; }
      }
    }
    const warnings: string[] = [];
    for (const fk of fks) {
      if (removing(fk) && affected.has(fk.parent) && fk.childCols.length !== 1) warnings.push(`여러 칸 외래키 ${fk.name}(${fk.child} → ${fk.parent}) — 이 스크립트가 다루지 않는 모양`);
    }

    // ── 표마다 조건(재귀 · 순환은 건너뛰고 기록) · 깊이(부모보다 깊게 = 먼저 지운다)
    const predMemo = new Map<string, string>();
    const depthMemo = new Map<string, number>();
    const viaMemo = new Map<string, string[]>();
    const stack = new Set<string>();
    const build = (t: string): { pred: string; depth: number } => {
      if (predMemo.has(t)) return { pred: predMemo.get(t)!, depth: depthMemo.get(t)! };
      stack.add(t);
      const conds: string[] = [];
      const via: string[] = [];
      let depth = 0;
      if (t === 'companies') { conds.push(`${qi('id')} = $1::uuid`); via.push('대상 회사'); }
      if (t !== 'companies' && hasCompanyId.has(t)) { conds.push(`${qi('company_id')} = $1::uuid`); via.push('company_id'); depth = Math.max(depth, 1); }
      for (const fk of fks) {
        if (fk.child !== t || !removing(fk) || !affected.has(fk.parent) || fk.childCols.length !== 1) continue;
        if (stack.has(fk.parent)) { if (fk.parent !== t) warnings.push(`순환 외래키 ${fk.name}(${fk.child} → ${fk.parent}) — 이 경로는 따로 따라가지 않음`); continue; }
        const p = build(fk.parent);
        conds.push(`${qi(fk.childCols[0])} IN (SELECT ${qi(fk.parentCols[0])} FROM ${qi(fk.parent)} WHERE ${p.pred})`);
        via.push(`${fk.parent}.${fk.parentCols[0]} (${DEL_RULE[fk.delType]})`);
        depth = Math.max(depth, p.depth + 1);
      }
      stack.delete(t);
      const pred = conds.length ? `(${conds.join(' OR ')})` : 'false';
      predMemo.set(t, pred); depthMemo.set(t, depth); viaMemo.set(t, via);
      return { pred, depth };
    };

    await client.query('BEGIN');
    if (apply) {
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await client.query(`SELECT id FROM companies WHERE id = $1::uuid FOR UPDATE`, [companyId]);
    }
    const plan: PlanRow[] = [];
    for (const t of affected) {
      const { pred, depth } = build(t);
      if (pred === 'false') continue;
      const n = await client.query(`SELECT COUNT(*)::int AS n FROM ${qi(t)} WHERE ${pred}`, [companyId]);
      const rows = Number(n.rows[0].n || 0);
      if (rows === 0) continue;
      let foreign = 0;
      if (hasCompanyId.has(t) && t !== 'companies') {
        const f = await client.query(`SELECT COUNT(*)::int AS n FROM ${qi(t)} WHERE ${pred} AND ${qi('company_id')} IS DISTINCT FROM $1::uuid`, [companyId]);
        foreign = Number(f.rows[0].n || 0);
      }
      plan.push({ table: t, depth, pred, rows, foreign, via: viaMemo.get(t) || [] });
    }
    plan.sort((a, b) => (b.depth - a.depth) || a.table.localeCompare(b.table));
    const total = plan.reduce((s, p) => s + p.rows, 0);
    const foreignTotal = plan.reduce((s, p) => s + p.foreign, 0);

    console.log(`\n── 지울 대상: 회사 ${companyId} (${co.company_code}) ──`);
    for (const p of plan) {
      console.log(`${String(p.rows).padStart(7)}  ${p.table}${LOG_LIKE.test(p.table) ? '  [기록성 표]' : ''}${p.foreign ? `  ⚠다른 회사·빈 값 ${p.foreign}` : ''}  ← ${p.via.join(' · ')}`);
    }
    const setNull = fks.filter((fk) => (fk.delType === 'n' || fk.delType === 'd') && affected.has(fk.parent) && plan.some((p) => p.table === fk.parent));
    if (setNull.length) console.log(`(값만 비워지는 외래키 ${setNull.length}개: ${setNull.map((f) => `${f.child}.${f.childCols.join(',')}`).join(' · ')})`);
    for (const w of [...new Set(warnings)]) console.log(`주의: ${w}`);
    console.log(`총 ${total}행 · 다른 회사·빈 값 ${foreignTotal}행`);

    if (foreignTotal > 0 || warnings.some((w) => w.startsWith('여러 칸'))) {
      await client.query('ROLLBACK');
      throw new Error('다른 회사 · 빈 값 행이 걸리거나 다루지 않는 외래키가 있어 지우지 않습니다. 위 목록을 그대로 보내 주세요.');
    }
    if (!apply) {
      await client.query('ROLLBACK');
      console.log(`\n점검만 했습니다(쓰기 0). 지우려면: npx ts-node scripts/purge-retired-demo-company.ts ${companyId} --apply --expect=${total}`);
      return;
    }
    if (total !== expect) {
      await client.query('ROLLBACK');
      throw new Error(`다시 센 총 건수(${total})가 --expect(${expect})와 달라 지우지 않습니다.`);
    }

    // ── 백업(지우기 전 · 권한 600) → 깊은 표부터 지우기 → 표마다 지운 수 = 센 수
    const backupPath = path.join(os.homedir(), `demo-purge-${companyId}.jsonl`);
    const fd = fs.openSync(backupPath, 'w', 0o600);
    try {
      for (const p of plan) {
        const rows = await client.query(`SELECT row_to_json(x) AS j FROM ${qi(p.table)} x WHERE ${p.pred}`, [companyId]);
        for (const r of rows.rows) fs.writeSync(fd, `${JSON.stringify({ table: p.table, row: r.j })}\n`);
      }
    } finally {
      fs.closeSync(fd);
    }
    for (const p of plan) {
      const d = await client.query(`DELETE FROM ${qi(p.table)} WHERE ${p.pred}`, [companyId]);
      if (d.rowCount !== p.rows) {
        await client.query('ROLLBACK');
        throw new Error(`${p.table} 지운 수(${d.rowCount})가 센 수(${p.rows})와 달라 전부 되돌렸습니다. 백업 파일은 남아 있습니다: ${backupPath}`);
      }
    }
    const left = await client.query(`SELECT COUNT(*)::int AS n FROM companies WHERE id = $1::uuid`, [companyId]);
    if (Number(left.rows[0].n) !== 0) {
      await client.query('ROLLBACK');
      throw new Error('회사 행이 남아 전부 되돌렸습니다.');
    }
    await client.query('COMMIT');
    console.log(`\n지웠습니다: 총 ${total}행 · 백업 파일 ${backupPath}(권한 600 · 확인 뒤 지우세요)`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('은퇴한 시연 회사 삭제 실패:', err?.message || err);
  process.exit(1);
});
