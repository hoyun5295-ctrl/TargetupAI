/**
 * reset-synthetic-test-company.ts — 시연이 아닌 테스트 회사의 고객 데이터를 합성 데이터로 바꾼다
 *   (★ 2026-10-20 Harold 지시 · 인비토 회사 = suran · gwchae · sgbaek · mobile 공통 · 실발송은 그대로)
 *
 * 하는 일:
 *   ① 지금 고객 · 구매와 그 행을 외래키로 가리키는 행(삭제 계획 = 공용 CT utils/fk-delete-plan · DB 카탈로그가 정한다)을
 *      권한 600 백업 파일로 남긴 뒤 한 트랜잭션으로 지운다
 *   ② 싱크 시크릿 새로 발급: 파일 먼저(권한 600) → 서버엔 해시(끊겨도 파일의 키가 이 회사 것이면 그 시크릿으로 이어 간다)
 *   ③ 합성 고객 3,000명 + 어제까지의 구매 타임라인을 싱크 수집 경로(루프백)로 넣는다(시연 회사 hanjulai 와 같은 데이터)
 *   여정 · 자동마케팅은 만들지 않는다(테스트하는 사람이 직접) · 수신거부 목록은 건드리지 않는다
 *
 * 지킴(하나라도 어기면 아무것도 안 한다):
 *   - 회사 id 가 ENV SYNTHETIC_DATA_COMPANY_IDS(허용 목록)에 있다 · 시연 회사가 아니다 · 싱크 키가 있고 싱크 사용 중이다
 *   - 그 회사 고객 번호 · 구매 번호가 **전부 가짜 번호**(SYNTHETIC_PHONE_PATTERN)다 — 실제 고객 데이터를 지우는 길을 막는다
 *   - 삭제 계획에 보호 표(PROTECTED_TABLES)가 끼거나 소유를 증명하지 못한 행 · 순환 외래키가 있으면 멈춘다
 *   - 실행은 --apply --expect=<점검 총 건수> 일 때만 · REPEATABLE READ 한 트랜잭션 · 회사 행 FOR UPDATE 뒤 자격을 다시 확인 ·
 *     다시 센 수 ≠ expect 면 중단 · 표마다 지운 수 = 센 수가 아니면 전부 되돌린다
 *
 * 실행(운영 서버 · packages/backend · 새 코드 배포 뒤 · 서버가 떠 있어야 한다 · .env 에 SYNTHETIC_DATA_COMPANY_IDS 를 먼저 적는다):
 *   점검: npx ts-node scripts/reset-synthetic-test-company.ts <회사 id>
 *   실행: npx ts-node scripts/reset-synthetic-test-company.ts <회사 id> --apply --expect=<점검 총 건수>
 * 끝나면 시크릿 파일 한 줄(SYNTHETIC_SYNC_KEYS=…)을 .env 에 옮기고 재기동 → 매일 합성 데이터 워커가 이 회사도 돈다.
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { query, pool } from '../src/config/database';
import { hashSecret } from '../src/utils/secret-hash';
import { loadFkCatalog, planDeletion, printDeletePlan, backupThenDelete, qi, type DeleteRoot } from '../src/utils/fk-delete-plan';
import {
  pushDemoSeed, syntheticDataCompanyIds, SYNTHETIC_PHONE_PATTERN, DEMO_SEED_CUSTOMERS, expectedSeedPurchaseCount, kstDate,
} from '../src/utils/demo-data';

/** 고객 데이터 재설정이 절대 지우면 안 되는 표 — 계획에 끼면 멈춘다(수신거부 = 법정 기록 · 회사 · 계정 · 발송 · 돈) */
const PROTECTED_TABLES = ['unsubscribes', 'companies', 'users', 'campaigns', 'billings', 'billing_items', 'balance_transactions'];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const companyId = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
  const apply = args.includes('--apply');
  const expectArg = args.find((a) => a.startsWith('--expect='));
  const expect = expectArg ? Number(expectArg.split('=')[1]) : NaN;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(companyId)) throw new Error('회사 id(uuid)를 첫 인자로 주세요.');
  if (apply && !Number.isInteger(expect)) throw new Error('--apply 에는 --expect=<점검 총 건수> 가 필요합니다.');
  if (!syntheticDataCompanyIds().has(companyId)) throw new Error('허용 목록(.env SYNTHETIC_DATA_COMPANY_IDS)에 없는 회사입니다. 먼저 적어 주세요.');

  // ── ① 고객 데이터 지우기(점검 = 쓰기 0)
  let apiKey = '';
  const client = await pool.connect();
  try {
    await client.query(apply ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
    if (apply) {
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await client.query(`SELECT id FROM companies WHERE id = $1::uuid FOR UPDATE`, [companyId]);
    }
    const c = await client.query(`SELECT id, company_name, is_demo, api_key, use_db_sync FROM companies WHERE id = $1::uuid`, [companyId]);
    if (c.rows.length === 0) throw new Error('회사가 없습니다.');
    const co = c.rows[0];
    if (co.is_demo === true) throw new Error('시연 회사입니다. 시연 회사는 setup-demo-company.ts 로 다룹니다.');
    if (!co.api_key) throw new Error('이 회사에 싱크 키가 없습니다. 중단합니다.');
    if (co.use_db_sync !== true) throw new Error('이 회사는 싱크 사용(use_db_sync)이 꺼져 있습니다. 중단합니다.');
    apiKey = String(co.api_key);

    // 전원 가짜 번호인가 — 번호가 없거나 가짜 모양이 아니면 실제 고객 데이터일 수 있다
    const bad = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM customers WHERE company_id = $1::uuid AND (phone IS NULL OR phone !~ $2)) AS customers,
              (SELECT COUNT(*)::int FROM purchases WHERE company_id = $1::uuid AND (customer_phone IS NULL OR customer_phone !~ $2)) AS purchases`,
      [companyId, SYNTHETIC_PHONE_PATTERN],
    );
    const badCustomers = Number(bad.rows[0].customers);
    const badPurchases = Number(bad.rows[0].purchases);
    if (badCustomers > 0 || badPurchases > 0) {
      throw new Error(`가짜 번호가 아닌 고객 ${badCustomers}명 · 구매 ${badPurchases}건이 있어 지우지 않습니다(실제 고객 데이터일 수 있습니다).`);
    }

    const catalog = await loadFkCatalog(client);
    const own: DeleteRoot = { pred: `${qi('company_id')} = $1::uuid`, depth: 1, via: 'company_id' };
    const p = await planDeletion(client, catalog, new Map([['customers', own], ['purchases', own]]), companyId);
    printDeletePlan(p, `지울 대상: ${co.company_name} 고객 데이터 (${companyId})`);
    const hit = p.plan.filter((r) => PROTECTED_TABLES.includes(r.table)).map((r) => r.table);
    if (hit.length) {
      await client.query('ROLLBACK');
      throw new Error(`보호 표(${hit.join(', ')})까지 지워지는 계획이라 멈춥니다. 위 목록을 그대로 보내 주세요.`);
    }
    if (p.foreignTotal > 0 || p.blocking) {
      await client.query('ROLLBACK');
      throw new Error('삭제 집합 밖을 가리키는 행 · 순환 외래키 · 다루지 않는 외래키가 있어 지우지 않습니다. 위 목록을 그대로 보내 주세요.');
    }
    if (!apply) {
      await client.query('ROLLBACK');
      console.log(`\n점검만 했습니다(쓰기 0). 실행하려면: npx ts-node scripts/reset-synthetic-test-company.ts ${companyId} --apply --expect=${p.total}`);
      return;
    }
    if (p.total !== expect) {
      await client.query('ROLLBACK');
      throw new Error(`다시 센 총 건수(${p.total})가 --expect(${expect})와 달라 지우지 않습니다.`);
    }
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const backupPath = path.join(os.homedir(), `synthetic-reset-${companyId}-${stamp}.jsonl`);
    await backupThenDelete(client, p, companyId, backupPath);
    const left = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM customers WHERE company_id = $1::uuid) AS customers,
              (SELECT COUNT(*)::int FROM purchases WHERE company_id = $1::uuid) AS purchases`,
      [companyId],
    );
    if (Number(left.rows[0].customers) + Number(left.rows[0].purchases) !== 0) throw new Error('지운 뒤에도 고객 · 구매가 남아 전부 되돌립니다.');
    await client.query('COMMIT');
    console.log(`\n지웠습니다: 총 ${p.total}행 · 백업 파일 ${backupPath}(권한 600 · 확인 뒤 지우세요)`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  // ── ② 싱크 시크릿 — 이 회사 키의 파일이 있으면 그 시크릿으로 해시를 다시 맞추고, 없으면 새로 발급한다: 파일 먼저(권한 600 · 새 파일만) → 해시
  const secretOut = process.env.SYNTHETIC_SECRET_OUT || path.join(os.homedir(), `synthetic-sync-${companyId.slice(0, 8)}.env`);
  let secret: string | null = null;
  if (fs.existsSync(secretOut)) {
    const m = fs.readFileSync(secretOut, 'utf8').match(/^SYNTHETIC_SYNC_KEYS=([^:\s]+):([0-9a-f]+)\s*$/m);
    if (!m || m[1] !== apiKey) throw new Error(`${secretOut} 가 이 회사 키 파일이 아닙니다. 다른 경로(SYNTHETIC_SECRET_OUT)를 주거나 그 파일을 확인해 주세요.`);
    secret = m[2];
  } else {
    secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretOut, `SYNTHETIC_SYNC_KEYS=${apiKey}:${secret}\n`, { mode: 0o600, flag: 'wx' });
    console.log(`싱크 시크릿을 새로 발급해 파일에 적었습니다: ${secretOut}(권한 600)`);
  }
  const upd = await query(`UPDATE companies SET api_secret_hash = $2, api_secret = NULL WHERE id = $1::uuid AND is_demo = false AND api_key = $3`, [companyId, hashSecret(secret), apiKey]);
  if (upd.rowCount !== 1) throw new Error('싱크 시크릿을 서버에 맞추지 못했습니다(회사 키가 바뀌었을 수 있습니다). 중단합니다.');

  // ── ③ 합성 고객 · 구매 — 완료 판정 = 고객 수와 v2 구매 건수가 그날 기대값에 닿았는가(덜 들어갔으면 이 단계만 다시: 같은 키라 이중 적재 0)
  const now = new Date();
  const today = kstDate(now);
  const seeded = await pushDemoSeed({ apiKey, apiSecret: secret }, now);
  console.log(`고객 ${seeded.customers}명 · 구매 ${seeded.purchases}건을 싱크 경로로 넣었습니다.`);
  const counts = await query(
    `SELECT (SELECT COUNT(*)::int FROM customers WHERE company_id = $1::uuid) AS customers,
            (SELECT COUNT(*)::int FROM purchases WHERE company_id = $1::uuid AND source_row_key LIKE 'demo-v2-%') AS purchases`,
    [companyId],
  );
  const gotCustomers = Number(counts.rows[0].customers);
  const gotPurchases = Number(counts.rows[0].purchases);
  const wantPurchases = expectedSeedPurchaseCount(today);
  console.log(`확인: 고객 ${gotCustomers}명(기대 ${DEMO_SEED_CUSTOMERS}) · 구매 ${gotPurchases}건(기대 ${wantPurchases})`);
  if (gotCustomers < DEMO_SEED_CUSTOMERS || gotPurchases < wantPurchases) {
    throw new Error('합성 데이터가 덜 들어갔습니다. 서버가 떠 있는지 확인하고 같은 명령(점검 → 실행)을 다시 실행해 주세요.');
  }
  console.log(`\n끝났습니다. ${secretOut} 의 한 줄을 .env 에 옮기고 서버를 재기동하면 매일 07시 이후 합성 데이터가 이어서 쌓입니다.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('테스트 회사 재설정 실패:', err?.message || err);
  process.exit(1);
});
