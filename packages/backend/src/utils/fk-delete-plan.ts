/**
 * fk-delete-plan.ts — 회사 데이터 삭제 계획 · 백업 · 삭제 공용 CT(★ 2026-10-20 퇴역 시연 회사 삭제 스크립트에서 꺼냄)
 *
 * 어떤 표를 얼마나 지우는지는 **DB 카탈로그가 정한다**(손으로 적은 표 목록 없음 · LESSONS_DB 「전수는 카탈로그가 정한다」).
 *   ① 시작 표(roots)의 그 회사 행  ② 그 행을 외래키로 가리키는 행(삭제 규칙 NO ACTION · RESTRICT · CASCADE · 재귀)
 *   SET NULL · SET DEFAULT 자식은 DB 가 비우므로 지우지 않는다(값만 비워지는 외래키로 알린다).
 *
 * 쓰는 곳:
 *   - scripts/purge-retired-demo-company.ts : 시작 표 = 회사 행 + company_id 칸이 있는 모든 표(회사 통째)
 *   - scripts/reset-synthetic-test-company.ts : 시작 표 = customers · purchases(테스트 회사의 고객 데이터만)
 *
 * 지킴(호출부가 blocking · foreignTotal 을 보고 멈춘다):
 *   - 지울 행 중 company_id 가 이 회사가 아닌 행 · 외래키 대상이 삭제 집합 밖(다른 회사 · 소유 증명 불가)인 행 → foreign
 *   - 자기참조 · 순환 외래키(지우는 규칙)가 지울 행이 있는 표에 걸리면 → blocking
 *   - 여러 칸 외래키가 지울 표를 가리키면 → blocking(다루지 않는 모양)
 */
import fs from 'fs';

export interface FkEdge { name: string; child: string; parent: string; childCols: string[]; parentCols: string[]; delType: string }
export interface DeleteCycle { fk: string; tables: string[]; note: string }
export interface DeleteRoot { pred: string; depth: number; via: string }
export interface DeleteGraph {
  affected: Set<string>;
  preds: Map<string, { pred: string; depth: number; via: string[] }>;
  cycles: DeleteCycle[];
  warnings: string[];
}
export interface DeletePlanRow { table: string; depth: number; pred: string; rows: number; foreign: number; via: string[] }
export interface DeletePlan {
  plan: DeletePlanRow[];
  total: number;
  foreignTotal: number;
  warnings: string[];
  setNull: FkEdge[];
  blocking: boolean;
}
export interface FkCatalog { fks: FkEdge[]; hasCompanyId: Set<string> }

export const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;
const DEL_RULE: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
const LOG_LIKE = /(audit|_logs?$|_log_|history|issued|access)/;
const removing = (fk: FkEdge) => fk.delType === 'a' || fk.delType === 'r' || fk.delType === 'c';

/** 외래키 지도 · company_id 칸이 있는 표(public 스키마 · 실제 표만). 배열 칸은 ::text 로 받아 드라이버가 배열로 읽게 한다. */
export async function loadFkCatalog(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }): Promise<FkCatalog> {
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
  const fks: FkEdge[] = fkr.rows.map((r: any) => ({ name: r.name, child: r.child, parent: r.parent, childCols: r.child_cols, parentCols: r.parent_cols, delType: r.del }));
  const scoped = await client.query(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id'`,
  );
  return { fks, hasCompanyId: new Set<string>(scoped.rows.map((r: any) => String(r.table_name))) };
}

/**
 * 순수 계산 — 시작 표에서 지우는 규칙의 외래키 자식을 따라가 표마다 조건(재귀 · 순환은 건너뛰고 기록)과 깊이(부모보다 깊게 = 먼저 지운다)를 정한다.
 * 시작 표의 조건은 roots 가 준다($1 = 회사 id). 시작 표가 다른 시작 표의 자식이기도 하면 두 조건을 OR 로 잇는다.
 */
export function buildDeleteGraph(fks: FkEdge[], roots: ReadonlyMap<string, DeleteRoot>): DeleteGraph {
  const affected = new Set<string>(roots.keys());
  for (let changed = true; changed;) {
    changed = false;
    for (const fk of fks) {
      if (removing(fk) && affected.has(fk.parent) && !affected.has(fk.child)) { affected.add(fk.child); changed = true; }
    }
  }
  const warnings: string[] = [];
  const cycles: DeleteCycle[] = [];
  for (const fk of fks) {
    if (removing(fk) && affected.has(fk.parent) && fk.childCols.length !== 1) warnings.push(`여러 칸 외래키 ${fk.name}(${fk.child} → ${fk.parent}): 이 계획기가 다루지 않는 모양`);
    if (removing(fk) && affected.has(fk.parent) && fk.child === fk.parent) cycles.push({ fk: fk.name, tables: [fk.child], note: '자기참조' });
  }
  const preds = new Map<string, { pred: string; depth: number; via: string[] }>();
  const stack = new Set<string>();
  const build = (t: string): { pred: string; depth: number } => {
    const hit = preds.get(t);
    if (hit) return hit;
    stack.add(t);
    const conds: string[] = [];
    const via: string[] = [];
    let depth = 0;
    const root = roots.get(t);
    if (root) { conds.push(root.pred); via.push(root.via); depth = Math.max(depth, root.depth); }
    for (const fk of fks) {
      if (fk.child !== t || !removing(fk) || !affected.has(fk.parent) || fk.childCols.length !== 1) continue;
      if (stack.has(fk.parent)) { if (fk.parent !== t) cycles.push({ fk: fk.name, tables: [...stack], note: '여러 표에 걸친 순환' }); continue; }
      const p = build(fk.parent);
      conds.push(`${qi(fk.childCols[0])} IN (SELECT ${qi(fk.parentCols[0])} FROM ${qi(fk.parent)} WHERE ${p.pred})`);
      via.push(`${fk.parent}.${fk.parentCols[0]} (${DEL_RULE[fk.delType]})`);
      depth = Math.max(depth, p.depth + 1);
    }
    stack.delete(t);
    const entry = { pred: conds.length ? `(${conds.join(' OR ')})` : 'false', depth, via };
    preds.set(t, entry);
    return entry;
  };
  for (const t of affected) build(t);
  return { affected, preds, cycles, warnings };
}

/**
 * 표마다 지울 행 수와 소유를 증명하지 못한 행 수를 센다(같은 트랜잭션 · $1 = 회사 id).
 *   ①company_id 칸이 있으면 이 회사여야 한다 ②외래키 대상이 회사 표면 이 회사만 · 대상 표에 company_id 가 있으면 다른 회사 행을 가리키면 안 된다
 *   ③대상 표에 company_id 가 없으면 소유를 판정할 수 없다 → 삭제 집합 밖을 가리키면 foreign(보수적)
 */
export async function planDeletion(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  catalog: FkCatalog,
  roots: ReadonlyMap<string, DeleteRoot>,
  companyId: string,
): Promise<DeletePlan> {
  const { fks, hasCompanyId } = catalog;
  const g = buildDeleteGraph(fks, roots);
  const plan: DeletePlanRow[] = [];
  for (const t of g.affected) {
    const { pred, depth, via } = g.preds.get(t)!;
    if (pred === 'false') continue;
    const n = await client.query(`SELECT COUNT(*)::int AS n FROM ${qi(t)} WHERE ${pred}`, [companyId]);
    const rows = Number(n.rows[0].n || 0);
    if (rows === 0) continue;
    const outside: string[] = [];
    if (hasCompanyId.has(t) && t !== 'companies') outside.push(`${qi('company_id')} IS DISTINCT FROM $1::uuid`);
    for (const fk of fks) {
      if (fk.child !== t || fk.childCols.length !== 1 || !g.affected.has(fk.parent)) continue;
      const col = qi(fk.childCols[0]);
      const pcol = qi(fk.parentCols[0]);
      if (fk.parent === 'companies') {
        outside.push(`(${col} IS NOT NULL AND ${col} <> $1::uuid)`);
      } else if (hasCompanyId.has(fk.parent)) {
        outside.push(`${col} IN (SELECT ${pcol} FROM ${qi(fk.parent)} WHERE ${qi('company_id')} IS NOT NULL AND ${qi('company_id')} <> $1::uuid)`);
      } else {
        const p = g.preds.get(fk.parent)!;
        outside.push(`(${col} IS NOT NULL AND ${col} NOT IN (SELECT ${pcol} FROM ${qi(fk.parent)} WHERE ${p.pred} AND ${pcol} IS NOT NULL))`);
      }
    }
    let foreign = 0;
    if (outside.length) {
      const f = await client.query(`SELECT COUNT(*)::int AS n FROM ${qi(t)} WHERE ${pred} AND (${outside.join(' OR ')})`, [companyId]);
      foreign = Number(f.rows[0].n || 0);
    }
    plan.push({ table: t, depth, pred, rows, foreign, via });
  }
  plan.sort((a, b) => (b.depth - a.depth) || a.table.localeCompare(b.table));
  const planTables = new Set(plan.map((p) => p.table));
  const setNull = fks.filter((fk) => (fk.delType === 'n' || fk.delType === 'd') && g.affected.has(fk.parent) && planTables.has(fk.parent));
  const liveCycles = g.cycles.filter((cy) => cy.tables.some((t) => planTables.has(t)));
  const warnings = [...g.warnings];
  for (const cy of g.cycles) {
    warnings.push(`순환 외래키 ${cy.fk}(${cy.tables.join(' → ')} · ${cy.note}): ${liveCycles.includes(cy) ? '지울 행이 있는 표라 막음' : '지울 행이 없는 표라 영향 없음'}`);
  }
  return {
    plan,
    total: plan.reduce((s, p) => s + p.rows, 0),
    foreignTotal: plan.reduce((s, p) => s + p.foreign, 0),
    warnings: [...new Set(warnings)],
    setNull,
    blocking: g.warnings.some((w) => w.startsWith('여러 칸')) || liveCycles.length > 0,
  };
}

/** 점검 출력(두 스크립트 공용) */
export function printDeletePlan(p: DeletePlan, title: string): void {
  console.log(`\n── ${title} ──`);
  for (const r of p.plan) {
    console.log(`${String(r.rows).padStart(7)}  ${r.table}${LOG_LIKE.test(r.table) ? '  [기록성 표]' : ''}${r.foreign ? `  [삭제 집합 밖을 가리킴 ${r.foreign}]` : ''}  ← ${r.via.join(' · ')}`);
  }
  if (p.setNull.length) console.log(`(값만 비워지는 외래키 ${p.setNull.length}개: ${p.setNull.map((f) => `${f.child}.${f.childCols.join(',')}`).join(' · ')})`);
  for (const w of p.warnings) console.log(`주의: ${w}`);
  console.log(`총 ${p.total}행 · 소유를 증명하지 못한 행 ${p.foreignTotal}행`);
}

/**
 * 지우기 전 지울 행 전부를 새 파일(독점 생성 'wx' · 권한 600 · JSON 한 줄씩)로 남기고, 깊은 표부터 지운다. 표마다 지운 수 = 센 수가 아니면 throw.
 * 트랜잭션(BEGIN · ROLLBACK · COMMIT)은 호출부가 쥔다 — throw 를 받으면 호출부가 되돌린다.
 */
export async function backupThenDelete(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> },
  p: DeletePlan,
  companyId: string,
  backupPath: string,
): Promise<void> {
  // 'wx' = 이미 있으면(파일 · 링크) 실패 → 권한 600 이 새 파일에만 적용되는 문제 · 링크 따라 덮어쓰기를 막는다
  const fd = fs.openSync(backupPath, 'wx', 0o600);
  fs.fchmodSync(fd, 0o600);
  try {
    for (const r of p.plan) {
      const rows = await client.query(`SELECT row_to_json(x) AS j FROM ${qi(r.table)} x WHERE ${r.pred}`, [companyId]);
      for (const row of rows.rows) fs.writeSync(fd, `${JSON.stringify({ table: r.table, row: row.j })}\n`);
    }
  } finally {
    fs.closeSync(fd);
  }
  for (const r of p.plan) {
    const d = await client.query(`DELETE FROM ${qi(r.table)} WHERE ${r.pred}`, [companyId]);
    if (d.rowCount !== r.rows) throw new Error(`${r.table} 지운 수(${d.rowCount})가 센 수(${r.rows})와 달라 멈춥니다. 백업 파일은 남아 있습니다: ${backupPath}`);
  }
}
