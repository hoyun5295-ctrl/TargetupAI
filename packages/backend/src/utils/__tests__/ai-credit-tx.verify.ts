/**
 * ai-credit-tx.verify.ts — _deductWithClient 트랜잭션 흐름 단위 검증 (mock client)
 *
 * 실행: npx ts-node packages/backend/src/utils/__tests__/ai-credit-tx.verify.ts
 * ai-credit-tx는 client 주입식이라 pool/config 의존이 없어 DB 연결 없이 검증된다.
 * 핵심: dup 체크가 FOR UPDATE(잠금) 뒤에 오는지 — 동시 재시도 이중 차감 방지의 근거.
 */
import assert from 'node:assert';
import { _deductWithClient, InsufficientCreditError } from '../ai-credit-tx';

interface Call { sql: string; params?: any[]; }

function makeMockClient(opts: { row: any | null; dupExists?: boolean }) {
  const calls: Call[] = [];
  return {
    calls,
    async query(sql: string, params?: any[]) {
      const s = sql.trim();
      calls.push({ sql: s, params });
      if (/^BEGIN|^COMMIT|^ROLLBACK/.test(s)) return { rows: [], rowCount: 0 };
      if (/FOR UPDATE OF c/.test(s)) return { rows: opts.row ? [opts.row] : [] };
      if (/SELECT 1 FROM ai_credit_transactions/.test(s)) return { rows: opts.dupExists ? [{ ok: 1 }] : [] };
      if (/^UPDATE companies/.test(s)) return { rows: [], rowCount: 1 };
      if (/^INSERT INTO ai_credit_transactions/.test(s)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
}

function sqlKinds(calls: Call[]): string[] {
  return calls.map((c) => {
    const s = c.sql;
    if (/^BEGIN/.test(s)) return 'BEGIN';
    if (/^COMMIT/.test(s)) return 'COMMIT';
    if (/^ROLLBACK/.test(s)) return 'ROLLBACK';
    if (/FOR UPDATE OF c/.test(s)) return 'LOCK';
    if (/SELECT 1 FROM ai_credit_transactions/.test(s)) return 'IDEM';
    if (/^UPDATE companies/.test(s)) return 'UPDATE';
    if (/^INSERT INTO ai_credit_transactions/.test(s)) return 'INSERT';
    return 'OTHER';
  });
}

const NOW = new Date('2026-06-01T03:00:00Z');     // KST 6월
const SAME_MONTH_RESET = '2026-06-01T00:00:00Z';  // 같은 KST 월 → 리셋 불필요

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok - ${name}`);
}

(async () => {
  console.log('[ai-credit-tx] 정상 차감 (base 충분) — dup 체크가 잠금 뒤에 온다');
  await ok('순서 BEGIN→LOCK→IDEM→UPDATE→INSERT→COMMIT', async () => {
    const client = makeMockClient({ row: { base: 100, purchased: 50, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 800 } });
    const r = await _deductWithClient(client, { companyId: 'c1', cost: 10, source: 'orchestrate', aiCallLogId: 'log1' }, NOW);
    assert.deepStrictEqual(sqlKinds(client.calls), ['BEGIN', 'LOCK', 'IDEM', 'UPDATE', 'INSERT', 'COMMIT']);
    const lockIdx = client.calls.findIndex((c) => /FOR UPDATE OF c/.test(c.sql));
    const idemIdx = client.calls.findIndex((c) => /SELECT 1 FROM ai_credit_transactions/.test(c.sql));
    assert.ok(lockIdx >= 0 && idemIdx > lockIdx, 'dup 체크(IDEM)는 FOR UPDATE(LOCK) 뒤여야 함');
    assert.strictEqual(r.deducted, true);
    assert.strictEqual(r.fromBase, 10);
    assert.strictEqual(r.fromPurchased, 0);
    assert.strictEqual(r.baseAfter, 90);
  });

  console.log('[ai-credit-tx] 2버킷 — base 부족 시 purchased 보충(mixed)');
  await ok('base 3 + cost 10 → base3 purchased7, bucket=mixed', async () => {
    const client = makeMockClient({ row: { base: 3, purchased: 50, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 0 } });
    const r = await _deductWithClient(client, { companyId: 'c1', cost: 10, source: 'dm-ai', aiCallLogId: 'log2' }, NOW);
    assert.strictEqual(r.fromBase, 3);
    assert.strictEqual(r.fromPurchased, 7);
    assert.strictEqual(r.baseAfter, 0);
    assert.strictEqual(r.purchasedAfter, 43);
    const insert = client.calls.find((c) => /^INSERT INTO ai_credit_transactions/.test(c.sql));
    assert.ok(insert && insert.params && insert.params[2] === 'mixed', 'bucket=mixed');
  });

  console.log('[ai-credit-tx] idempotent — 이미 차감된 key는 skip');
  await ok('dup 존재 → BEGIN→LOCK→IDEM→ROLLBACK, UPDATE/INSERT 없음', async () => {
    const client = makeMockClient({ row: { base: 100, purchased: 50, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 800 }, dupExists: true });
    const r = await _deductWithClient(client, { companyId: 'c1', cost: 10, source: 'orchestrate', aiCallLogId: 'log1' }, NOW);
    assert.deepStrictEqual(sqlKinds(client.calls), ['BEGIN', 'LOCK', 'IDEM', 'ROLLBACK']);
    assert.strictEqual(r.deducted, false);
    assert.ok(!client.calls.some((c) => /^UPDATE companies/.test(c.sql)), 'UPDATE 없어야');
  });

  console.log('[ai-credit-tx] 잔액 부족 — ROLLBACK + throw, 차감 안 함');
  await ok('base3+purchased4 < cost10 → InsufficientCreditError, UPDATE 없음', async () => {
    const client = makeMockClient({ row: { base: 3, purchased: 4, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 0 } });
    let threw: any = null;
    try {
      await _deductWithClient(client, { companyId: 'c1', cost: 10, source: 'orchestrate', aiCallLogId: 'log3' }, NOW);
    } catch (e) { threw = e; }
    assert.ok(threw instanceof InsufficientCreditError, 'InsufficientCreditError throw');
    assert.strictEqual(threw.required, 10);
    assert.strictEqual(threw.available, 7);
    assert.ok(client.calls.some((c) => /^ROLLBACK/.test(c.sql)), 'ROLLBACK 호출');
    assert.ok(!client.calls.some((c) => /^UPDATE companies/.test(c.sql)), 'UPDATE 없어야');
  });

  console.log('[ai-credit-tx] aiCallLogId 없음 — dup 체크(IDEM) 생략');
  await ok('idemKey 없으면 BEGIN→LOCK→UPDATE→INSERT→COMMIT (IDEM 없음)', async () => {
    const client = makeMockClient({ row: { base: 100, purchased: 0, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 800 } });
    const r = await _deductWithClient(client, { companyId: 'c1', cost: 5, source: 'orchestrate-subagent' }, NOW);
    assert.deepStrictEqual(sqlKinds(client.calls), ['BEGIN', 'LOCK', 'UPDATE', 'INSERT', 'COMMIT']);
    assert.strictEqual(r.deducted, true);
  });

  console.log('[ai-credit-tx] 월 리셋 — 지난달이면 reset(base=planCredits) 후 차감');
  await ok('지난달 → reset UPDATE/INSERT 후 차감, base는 planCredits서 출발', async () => {
    const client = makeMockClient({ row: { base: 0, purchased: 0, cap: null, reset_at: '2026-05-01T00:00:00Z', plan_credits: 800 } });
    const r = await _deductWithClient(client, { companyId: 'c1', cost: 10, source: 'orchestrate', aiCallLogId: 'log4' }, NOW);
    assert.deepStrictEqual(sqlKinds(client.calls), ['BEGIN', 'LOCK', 'IDEM', 'UPDATE', 'INSERT', 'UPDATE', 'INSERT', 'COMMIT']);
    assert.strictEqual(r.deducted, true);
    assert.strictEqual(r.fromBase, 10);
    assert.strictEqual(r.baseAfter, 790);  // 800 리셋 후 10 차감
  });

  console.log('[ai-credit-tx] 크레딧제 미적용 — plan_credits NULL + 구매 0 → 차감 skip(차단 X)');
  await ok('plan_credits null & purchased 0 → BEGIN→LOCK→ROLLBACK, 차감 안 함', async () => {
    const client = makeMockClient({ row: { base: 0, purchased: 0, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: null } });
    const r = await _deductWithClient(client, { companyId: 'c1', cost: 10, source: 'orchestrate', aiCallLogId: 'logX' }, NOW);
    assert.strictEqual(r.deducted, false);
    assert.deepStrictEqual(sqlKinds(client.calls), ['BEGIN', 'LOCK', 'ROLLBACK']);
  });
  await ok('plan_credits null이어도 구매분 있으면 차감 진행', async () => {
    const client = makeMockClient({ row: { base: 0, purchased: 30, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: null } });
    const r = await _deductWithClient(client, { companyId: 'c1', cost: 10, source: 'orchestrate', aiCallLogId: 'logY' }, NOW);
    assert.strictEqual(r.deducted, true);
    assert.strictEqual(r.fromPurchased, 10);
    assert.strictEqual(r.purchasedAfter, 20);
  });

  console.log('[ai-credit-tx] 후불 — 한도 내 음수 허용(overage), bucket=overage');
  await ok('postpaid overage100, base0 purchased0 cost5 → 차감, baseAfter=-5', async () => {
    const client = makeMockClient({ row: { base: 0, purchased: 0, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 1000, billing_type: 'postpaid', overage_limit: 100 } });
    const r = await _deductWithClient(client, { companyId: 'c1', cost: 5, source: 'orchestrate', aiCallLogId: 'pp1' }, NOW);
    assert.strictEqual(r.deducted, true);
    assert.strictEqual(r.baseAfter, -5);
    assert.strictEqual(r.purchasedAfter, 0);
    const insert = client.calls.find((c) => /^INSERT INTO ai_credit_transactions/.test(c.sql));
    assert.ok(insert && insert.params && insert.params[2] === 'overage', 'bucket=overage');
  });

  console.log('[ai-credit-tx] 후불 — 한도 초과 throw');
  await ok('postpaid overage3, base0 purchased0 cost5 → InsufficientCreditError, UPDATE 없음', async () => {
    const client = makeMockClient({ row: { base: 0, purchased: 0, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 1000, billing_type: 'postpaid', overage_limit: 3 } });
    let threw: any = null;
    try {
      await _deductWithClient(client, { companyId: 'c1', cost: 5, source: 'orchestrate', aiCallLogId: 'pp2' }, NOW);
    } catch (e) { threw = e; }
    assert.ok(threw instanceof InsufficientCreditError, 'throw (5 > 0+3)');
    assert.ok(!client.calls.some((c) => /^UPDATE companies/.test(c.sql)), 'UPDATE 없어야');
  });

  console.log('[ai-credit-tx] 후불 — base로 커버되면 음수 안 감');
  await ok('postpaid overage100, base10 cost5 → baseAfter=5, bucket=base', async () => {
    const client = makeMockClient({ row: { base: 10, purchased: 0, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 1000, billing_type: 'postpaid', overage_limit: 100 } });
    const r = await _deductWithClient(client, { companyId: 'c1', cost: 5, source: 'orchestrate', aiCallLogId: 'pp3' }, NOW);
    assert.strictEqual(r.baseAfter, 5);
    const insert = client.calls.find((c) => /^INSERT INTO ai_credit_transactions/.test(c.sql));
    assert.ok(insert && insert.params && insert.params[2] === 'base', 'bucket=base');
  });

  console.log('[ai-credit-tx] 후불 — 이미 음수에서 한도 경계');
  await ok('postpaid overage10, base-8 cost2 → baseAfter=-10 허용', async () => {
    const client = makeMockClient({ row: { base: -8, purchased: 0, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 1000, billing_type: 'postpaid', overage_limit: 10 } });
    const r = await _deductWithClient(client, { companyId: 'c1', cost: 2, source: 'orchestrate', aiCallLogId: 'pp4' }, NOW);
    assert.strictEqual(r.deducted, true);
    assert.strictEqual(r.baseAfter, -10);
  });
  await ok('postpaid overage10, base-8 cost3 → -11 초과 throw', async () => {
    const client = makeMockClient({ row: { base: -8, purchased: 0, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 1000, billing_type: 'postpaid', overage_limit: 10 } });
    let threw: any = null;
    try {
      await _deductWithClient(client, { companyId: 'c1', cost: 3, source: 'orchestrate', aiCallLogId: 'pp5' }, NOW);
    } catch (e) { threw = e; }
    assert.ok(threw instanceof InsufficientCreditError, 'throw (-8-3=-11 < -10)');
  });

  console.log('[ai-credit-tx] 선불 — overage_limit 있어도 무시(0에서 차단)');
  await ok('prepaid overage999, base0 purchased0 cost5 → throw(선불은 overage 무시)', async () => {
    const client = makeMockClient({ row: { base: 0, purchased: 0, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 1000, billing_type: 'prepaid', overage_limit: 999 } });
    let threw: any = null;
    try {
      await _deductWithClient(client, { companyId: 'c1', cost: 5, source: 'orchestrate', aiCallLogId: 'pp6' }, NOW);
    } catch (e) { threw = e; }
    assert.ok(threw instanceof InsufficientCreditError, '선불은 overage 무시 → throw');
  });

  console.log('[ai-credit-tx] overage_credits 기록 (한도 음수 초과분 shortfall만, 청구 대상)');
  await ok('후불 overage: overage_credits = shortfall (base2 cost5 → 3)', async () => {
    const client = makeMockClient({ row: { base: 2, purchased: 0, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 1000, billing_type: 'postpaid', overage_limit: 100 } });
    await _deductWithClient(client, { companyId: 'c1', cost: 5, source: 'orchestrate', aiCallLogId: 'ov1' }, NOW);
    const insert = client.calls.find((c) => /^INSERT INTO ai_credit_transactions/.test(c.sql));
    assert.ok(insert && insert.params && insert.params[9] === 3, 'overage_credits = shortfall 3 (기본분 2 제외)');
  });
  await ok('기본분 충당: overage_credits = 0 (청구 대상 아님)', async () => {
    const client = makeMockClient({ row: { base: 100, purchased: 0, cap: null, reset_at: SAME_MONTH_RESET, plan_credits: 800 } });
    await _deductWithClient(client, { companyId: 'c1', cost: 10, source: 'orchestrate', aiCallLogId: 'ov2' }, NOW);
    const insert = client.calls.find((c) => /^INSERT INTO ai_credit_transactions/.test(c.sql));
    assert.ok(insert && insert.params && insert.params[9] === 0, 'overage_credits = 0');
  });

  console.log(`\n${passed} assertions passed`);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
