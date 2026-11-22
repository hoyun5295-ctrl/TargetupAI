/**
 * c154-m1-queue-facts.ts — 발송 원장 굴리기를 켜기 전에 서버에서 재는 사실(★ 2026-11-22 C154-M1 · 설계서 docs/2026-11-22-c154-send-ledger-rollup-design.md D2 · §7)
 *
 * 왜: 굴리기는 결과가 확정된 캠페인의 낱행을 큐 · 월별 이력 표에서 「캠페인(app_etc1) = ? · 줄 번호(seqno) > ?」로 나눠 읽는다.
 *     그 문장이 표 전체를 훑지 않는지(색인 · 실행 계획 · 실제 걸리는 시간)는 코드로 알 수 없다 → 단계를 열기(V3_STAGE_ROLLUP) 전에 서버에서 본다.
 *
 * 무엇을(★ 구현 Codex 2R — 캠페인을 골라 보지 않는다 · **여는 범위에서 굴릴 캠페인 전부**가 쓰는 표를 본다):
 *   ① 범위의 회사에서 굴리는 창 안 확정 캠페인 **전부**를 읽는다(표본 없음) → 캠페인마다 낱행을 두는 표를 굴리기와 같은 함수로 푼다 → 표(읽는 꼴 포함)의 합집합.
 *   ② 표마다 색인 목록 → 캠페인 칸(app_etc1)으로 시작하는 색인이 없으면 그 표는 읽지 않고 FAIL.
 *   ③ 색인이 있으면 그 표를 쓰는 캠페인 전부의 줄 수를 세어(캠페인 칸 색인만 훑는다) 읽기 비용을 정하는 값이 가장 큰 캠페인을 고른다.
 *      전 행 읽기 = 그 표에 줄이 가장 많은 캠페인 하나.
 *      만료 실패만 읽기 = 둘(★ 구현 Codex 3R): 그 표에 줄이 가장 많은 캠페인(색인에서 훑는 줄 수) + **만료 실패 줄이 가장 많은 캠페인**(돌려받는 줄 수 · 같은 조건 글자로 센다).
 *   ④ 고른 캠페인마다 그 id 로 첫 쪽과 둘째 쪽(첫 쪽의 마지막 줄 번호 뒤)의 EXPLAIN · 첫 쪽을 실제로 읽는 시간.
 *      범위 안 어느 캠페인도 그 표에 줄이 없으면(rows-in-scope 0) 굴리기가 거기서 하는 읽기는 빈 읽기뿐이다 → 실행 계획과 빈 읽기 한 번의 시간으로 본다.
 *
 * 지킴:
 *   - 읽기만 · 큐 표 SQL 은 CT-04 의 것만(smsCampaignRowsSql · smsCampaignRowsAfter · smsBatchAggByGroup) · 읽은 줄(번호 · 결과)은 출력하지 않는다(줄 수 · 시간만)
 *   - 한 표에 한 쪽(최대 5,000줄)만 읽는다 · 줄 수 세기는 캠페인 500개씩
 *   - 부하: all 이면 창 안 낱행 전체의 캠페인 칸 색인을 한 번 훑는다(굴리기가 켜지면 어차피 읽는 줄) → 발송이 한가한 시간에 실행
 *
 * 실행(운영 서버 · packages/backend · pull 뒤):
 *   npx ts-node scripts/c154-m1-queue-facts.ts <회사 id> [<회사 id> ...]     ← 그 회사들만(C154-ENV-1 앞 = 사내 회사 id)
 *   npx ts-node scripts/c154-m1-queue-facts.ts all                           ← 창 안에 확정 캠페인이 있는 전 회사(C154-ENV-2 앞)
 *
 * 보는 법: 마지막 줄 `M1 verdict pass` 면 통과. `M1 verdict FAIL …` 이면 그 표 줄(index-on-campaign no · type=ALL · 한 쪽 3초 초과 · error)을 보고하고 단계를 열지 않는다.
 *   extra 에 filesort 가 보이면 한 쪽의 비용이 그 캠페인의 줄 수에 비례한다(가장 큰 캠페인으로 잰 시간이 그 표의 최댓값).
 */
import 'dotenv/config';
import pool, { withBoundedMysql } from '../src/config/database';
import { getCampaignSmsTablesFor, smsCampaignRowsSql, smsCampaignRowsAfter, smsBatchAggByGroup, CAMPAIGN_EXPIRED_ROWS_WHERE } from '../src/utils/sms-queue';
import { classifyResultTables } from '../src/utils/sms-table-split';
import { ROLL_PAGE, ROLLUP_WINDOW_DAYS, ROLL_ROWS_MAX, rollupScopeSql } from '../src/utils/send-ledger-rollup';

const ASK_MS = 15_000;
/** 한 쪽을 읽는 데 이보다 오래 걸리면 통과로 보지 않는다(굴리기의 문장 상한은 5초) */
const PAGE_SLOW_MS = 3_000;
const COUNT_BATCH = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Camp { id: string; company_id: string; created_by: string | null; send_config: any; sent_at: any; scheduled_at: any; created_at: any; rows: number }

/** 범위 안에서 굴릴 캠페인 전부(굴리기의 대상 조건과 같다 · 이미 굴렸는지는 보지 않는다 = 창 전체) */
async function scopeCampaigns(all: boolean, ids: string[]): Promise<Camp[]> {
  const r = await pool.query(
    `SELECT c.id, c.company_id, c.created_by, c.send_config, c.sent_at, c.scheduled_at, c.created_at,
            (COALESCE(c.success_count, 0) + COALESCE(c.fail_count, 0))::int AS rows
       FROM campaigns c
      WHERE c.status = 'completed' AND c.result_final = true AND ${rollupScopeSql('c')}
        AND c.sent_at IS NOT NULL AND c.sent_at > NOW() - ($3::int * INTERVAL '1 day')
        AND ($1::boolean OR c.company_id = ANY($2::uuid[]))`,
    [all, ids, ROLLUP_WINDOW_DAYS],
  );
  return r.rows as Camp[];
}

/** 그 표에 (조건에 맞는) 줄이 가장 많은 캠페인(없으면 null) — 캠페인 칸 색인이 있는 표에서만 부른다 · where = 파라미터 없는 정적 조건 */
async function heaviestIn(table: string, campIds: string[], where?: string): Promise<{ id: string; rows: number } | null> {
  let best: { id: string; rows: number } | null = null;
  for (let i = 0; i < campIds.length; i += COUNT_BATCH) {
    const counts = await smsBatchAggByGroup([table], 'app_etc1', 'COUNT(*) AS n', campIds.slice(i, i + COUNT_BATCH), where);
    for (const [id, v] of counts) {
      const n = Number(v.n) || 0;
      if (n > 0 && (!best || n > best.rows)) best = { id, rows: n };
    }
  }
  return best;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes('all');
  const ids = args.filter((a) => UUID.test(a));
  if (!all && ids.length === 0) {
    console.error('M1 usage: npx ts-node scripts/c154-m1-queue-facts.ts <company-id> [...]  |  all');
    process.exit(2);
  }
  const version = await withBoundedMysql(ASK_MS, (run) => run('SELECT VERSION() AS v', []));
  console.log(`M1 mysql-version ${(version as any[])[0]?.v}`);

  const camps = await scopeCampaigns(all, ids);
  const companies = new Set(camps.map((c) => String(c.company_id)));
  const largest = camps.reduce((m, c) => Math.max(m, Number(c.rows) || 0), 0);
  console.log(`M1 scope ${all ? 'all' : `${ids.length} companies`} · companies-with-campaigns ${companies.size} · campaigns ${camps.length} · largest ${largest} rows · page ${ROLL_PAGE} · cap ${ROLL_ROWS_MAX}`);

  // 표(읽는 꼴 포함) → 그 표를 쓰는 캠페인 전부. 같은 표라도 캠페인에 따라 「전 행」 · 「만료 실패만」으로 갈린다 → 꼴마다 따로 본다
  const byTable = new Map<string, { table: string; expiredOnly: boolean; campIds: string[] }>();
  const add = (table: string, expiredOnly: boolean, id: string) => {
    const key = `${table}|${expiredOnly ? 1 : 0}`;
    const hit = byTable.get(key) || { table, expiredOnly, campIds: [] };
    hit.campIds.push(id);
    byTable.set(key, hit);
  };
  for (const c of camps) {
    const { resultTables, pendingLiveTables } = classifyResultTables(await getCampaignSmsTablesFor(String(c.company_id), c));
    for (const t of resultTables) add(t, false, String(c.id));
    for (const t of pendingLiveTables) add(t, true, String(c.id));
  }
  console.log(`M1 tables-in-use ${byTable.size}`);

  const bad: string[] = [];
  const indexed = new Map<string, { lead: boolean; text: string }>();
  for (const { table, expiredOnly, campIds } of [...byTable.values()].sort((a, b) => a.table.localeCompare(b.table) || Number(a.expiredOnly) - Number(b.expiredOnly))) {
    const tag = `${table}${expiredOnly ? ' (expired-only)' : ''}`;
    if (!indexed.has(table)) {
      const idx = await withBoundedMysql(ASK_MS, (run) => run(`SHOW INDEX FROM ${table}`, [])) as any[];
      const byName = new Map<string, string[]>();
      for (const r of idx.sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index))) {
        byName.set(String(r.Key_name), [...(byName.get(String(r.Key_name)) || []), String(r.Column_name)]);
      }
      indexed.set(table, {
        lead: [...byName.values()].some((cols) => String(cols[0]).toLowerCase() === 'app_etc1'),
        text: [...byName.entries()].map(([k, cols]) => `${k}(${cols.join(',')})`).join(' '),
      });
    }
    const { lead, text } = indexed.get(table)!;
    if (!lead) {
      // 캠페인 칸 색인이 없는 표 = 세기 · 읽기가 전부 전체 훑기다 → 읽지 않고 실패로 적는다
      bad.push(tag);
      console.log(`M1 ${tag} index-on-campaign no · indexes ${text} · campaigns ${campIds.length} · FAIL`);
      continue;
    }
    const sql = smsCampaignRowsSql(table, ROLL_PAGE, expiredOnly);
    // 읽을 캠페인 = 비용을 정하는 값마다 가장 큰 것(전 행 = 줄 수 하나 · 만료 실패만 = 훑는 줄 수 + 돌려받는 줄 수)
    const scan = await heaviestIn(table, campIds);
    const hit = expiredOnly ? await heaviestIn(table, campIds, CAMPAIGN_EXPIRED_ROWS_WHERE) : null;
    const probes: Array<{ id: string; note: string }> = [];
    if (scan) probes.push({ id: scan.id, note: `heaviest-campaign-rows ${scan.rows}` });
    if (hit && hit.id !== scan?.id) probes.push({ id: hit.id, note: `most-expired-rows ${hit.rows}` });
    else if (hit) probes[0].note += ` (expired-rows ${hit.rows})`;
    if (probes.length === 0) probes.push({ id: campIds[0], note: 'rows-in-scope 0' });
    const full = (e: any) => String(e?.type || '').toUpperCase() === 'ALL' || !e?.key;
    let failed = false;
    for (const p of probes) {
      const ex1 = (await withBoundedMysql(ASK_MS, (run) => run(`EXPLAIN ${sql}`, [p.id, 0])) as any[])[0] || {};
      // 첫 쪽을 실제로 읽는다(줄은 출력하지 않는다) → 걸린 시간 · 둘째 쪽의 줄 번호
      const t0 = Date.now();
      let page: Array<{ seqno: number }> = [];
      let readErr = '';
      try { page = await smsCampaignRowsAfter(table, p.id, 0, ROLL_PAGE, expiredOnly); } catch (e: any) { readErr = String(e?.message || e); }
      const ms = Date.now() - t0;
      const lastSeq = page.length > 0 ? Number(page[page.length - 1].seqno) : 0;
      const ex2 = lastSeq > 0 ? (await withBoundedMysql(ASK_MS, (run) => run(`EXPLAIN ${sql}`, [p.id, lastSeq])) as any[])[0] || {} : null;
      const fail = full(ex1) || (ex2 !== null && full(ex2)) || ms > PAGE_SLOW_MS || !!readErr;
      if (fail) failed = true;
      console.log(
        `M1 ${tag} index-on-campaign yes · indexes ${text}`
        + ` · campaigns ${campIds.length} · ${p.note}`
        + ` · page1 rows=${page.length} ms=${ms}${readErr ? ` error=${readErr}` : ''}`
        + ` · explain1 type=${ex1.type} key=${ex1.key ?? ''} rows=${ex1.rows ?? ''} extra=${ex1.Extra ?? ''}`
        + (ex2 ? ` · explain2 type=${ex2.type} key=${ex2.key ?? ''} rows=${ex2.rows ?? ''} extra=${ex2.Extra ?? ''}` : ' · explain2 (one page only)')
        + (fail ? ' · FAIL' : ''),
      );
    }
    if (failed) bad.push(tag);
  }
  if (largest > ROLL_ROWS_MAX) console.log(`M1 note largest campaign exceeds the ${ROLL_ROWS_MAX}-row cap = it will not be rolled`);
  console.log(bad.length === 0 ? 'M1 verdict pass' : `M1 verdict FAIL ${bad.join(' · ')}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('M1 failed:', err?.message || err); process.exit(1); });
