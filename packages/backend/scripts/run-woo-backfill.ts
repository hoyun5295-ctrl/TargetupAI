/**
 * run-woo-backfill.ts — 우커머스 기존 회원·주문 가져오기를 **서버 재기동 없이** 별도 프로세스로 돌린다 (★0921)
 *
 * 왜: 업무시간에 백엔드를 다시 띄우지 않고, 실몰·실DB 로 새 코드를 끝까지 통과시킨다(운영 앱과 같은 함수 runWooBackfill 을 그대로 부른다).
 *     끝나면 몰 행의 meta.woo_backfill.stage = 'done' 이 되어, 돌고 있는 앱의 워커도 그 몰을 다시 가져오지 않는다.
 *     중간에 끊겨도(SSH 끊김·오류) 진행이 페이지마다 저장돼 있어 같은 명령을 다시 치면 멈춘 자리에서 이어 간다.
 *
 * 실행(운영 서버):
 *   cd packages/backend && npx ts-node scripts/run-woo-backfill.ts iroirotokyo.net          (그 몰만)
 *   cd packages/backend && npx ts-node scripts/run-woo-backfill.ts iroirotokyo.net --all    (그 몰 먼저 · 나머지 몰도 이어서)
 *
 * 하는 일: 대상 몰(해제 아님 · active · REST 키 있음)을 하나씩 runWooBackfill → 30초마다 진행 1줄 출력.
 * 출력: 몰 식별자·단계·페이지·건수뿐(키·개인정보 0). 몰 쪽에는 GET 만 보낸다. 우리 DB 에는 앱과 같은 적재(멱등)를 한다.
 */
import 'dotenv/config';
import { query } from '../src/config/database';
import { runWooBackfill, WooApiError } from '../src/utils/woocommerce-client';

const PROGRESS_EVERY_MS = 30000;

interface Target { company_id: string; mall_id: string }

async function progressLine(t: Target): Promise<string> {
  const r = await query(
    `SELECT meta->'woo_backfill' AS b FROM company_integrations
      WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,
    [t.company_id, t.mall_id],
  );
  const b = r.rows[0]?.b;
  if (!b) return `${t.mall_id} (상태 없음)`;
  return `${t.mall_id} stage=${b.stage} 회원쪽=${b.customers_page} 주문쪽=${b.orders_page} 회원=${b.customers_imported} 주문=${b.orders_imported} 번호없음=${(b.customers_no_phone || 0) + (b.orders_no_phone || 0)} 실패=${b.failed || 0}`;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2).map((a) => String(a).trim().toLowerCase()).filter(Boolean);
  const all = args.includes('--all');
  const named = args.filter((a) => !a.startsWith('--'));
  if (!all && named.length === 0) { console.error('사용법: npx ts-node scripts/run-woo-backfill.ts <몰 식별자 ...> [--all]   (적은 몰부터 · --all 이면 나머지도 이어서)'); return 2; }

  const rows = await query(
    `SELECT company_id, mall_id FROM company_integrations
      WHERE provider = 'woocommerce' AND status = 'active' AND connected_at IS NOT NULL
        AND COALESCE(meta->>'woo_consumer_key', '') <> '' AND COALESCE(meta->>'woo_consumer_secret', '') <> ''
      ORDER BY connected_at ASC`,
  );
  const eligible = rows.rows as Target[];
  // 적은 몰을 적은 순서대로 먼저 · --all 이면 나머지를 연결 시각 순으로 뒤에 붙인다
  const targets: Target[] = [
    ...named.flatMap((m) => eligible.filter((t) => t.mall_id === m)),
    ...(all ? eligible.filter((t) => !named.includes(t.mall_id)) : []),
  ];
  if (targets.length === 0) { console.error(`대상 몰이 없습니다(active · REST 키 있는 몰만): ${args.join(' ')}`); return 1; }
  console.log(`대상 ${targets.length}몰: ${targets.map((t) => t.mall_id).join(', ')}`);

  let failedMalls = 0;
  for (const t of targets) {
    const started = Date.now();
    console.log(`\n── ${t.mall_id} 시작 · ${await progressLine(t)}`);
    const timer = setInterval(() => { progressLine(t).then((l) => console.log(`   … ${l}`)).catch(() => undefined); }, PROGRESS_EVERY_MS);
    try {
      const st = await runWooBackfill(t.company_id, t.mall_id);
      console.log(`── ${t.mall_id} 끝 stage=${st.stage} 회원=${st.customers_imported} 주문=${st.orders_imported} 번호없음=${st.customers_no_phone + st.orders_no_phone} 실패=${st.failed}${st.truncated ? ' (상한 도달)' : ''} · ${Math.round((Date.now() - started) / 1000)}초`);
    } catch (e: any) {
      failedMalls++;
      console.error(`── ${t.mall_id} 중단 code=${e instanceof WooApiError ? e.code : 'unknown'} — ${e?.message || e}`);
      console.error(`   ${await progressLine(t).catch(() => '')}`);
      console.error('   같은 명령을 다시 실행하면 멈춘 자리에서 이어 갑니다.');
    } finally {
      clearInterval(timer);
    }
  }
  return failedMalls === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error('실행 실패:', e?.message || e); process.exit(1); });
