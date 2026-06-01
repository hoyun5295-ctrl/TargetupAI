/**
 * ai-credit-adjust.verify.ts — 종량제 Phase 4 크레딧 지급/조정 + 이번달 사용량 단위검증
 *
 * 실행: npx ts-node packages/backend/src/utils/__tests__/ai-credit-adjust.verify.ts
 * (DB 연결 불필요 — 순수 함수 + mock client.)
 */
import assert from 'node:assert';
import { sumDeductRows } from '../ai-credit-calc';
import { adjustCreditWithClient } from '../ai-credit-tx';

let passed = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok - ${name}`);
}

/** loadCreditRow의 SELECT에만 행을 돌려주는 mock client. */
function mockClient(row: any, dupOpts?: { dupExists?: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    async query(sql: string, _params?: any[]) {
      calls.push(sql.trim().split('\n')[0]);
      if (sql.includes('ai_credit_transactions') && sql.includes('idempotency_key') && sql.trim().startsWith('SELECT')) {
        return { rows: dupOpts?.dupExists ? [{ ok: 1 }] : [] };
      }
      if (sql.includes('SELECT') && sql.includes('ai_credits_purchased')) return { rows: [row] };
      return { rows: [] };
    },
  };
}

(async () => {
  console.log('[ai-credit] sumDeductRows (이번달 사용량 = deduct 합)');
  await ok('deduct만 합산', () =>
    assert.strictEqual(sumDeductRows([{ type: 'deduct', amount: 20 }, { type: 'grant', amount: 50 }, { type: 'deduct', amount: 2 }]), 22));
  await ok('빈 배열 = 0', () => assert.strictEqual(sumDeductRows([]), 0));
  await ok('reset/grant 제외', () =>
    assert.strictEqual(sumDeductRows([{ type: 'reset', amount: 1000 }, { type: 'grant', amount: 200 }]), 0));
  await ok('amount 문자열 방어', () =>
    assert.strictEqual(sumDeductRows([{ type: 'deduct', amount: '5' as any }]), 5));

  console.log('[ai-credit] adjustCreditWithClient (수동 지급/조정 트랜잭션)');
  await ok('grant +200 (보유 0) → purchasedAfter 200', async () => {
    const c = mockClient({ purchased: 0, base: 0 });
    const r = await adjustCreditWithClient(c as any, { companyId: 'c1', amount: 200, type: 'grant', adminId: 'a1', reason: '입금 확인' }, new Date());
    assert.strictEqual(r.purchasedAfter, 200);
    assert.ok(c.calls.includes('COMMIT'));
  });
  await ok('admin_deduct 50 (보유 200) → 150', async () => {
    const c = mockClient({ purchased: 200, base: 0 });
    const r = await adjustCreditWithClient(c as any, { companyId: 'c1', amount: 50, type: 'admin_deduct', adminId: 'a1', reason: '회수' }, new Date());
    assert.strictEqual(r.purchasedAfter, 150);
  });
  await ok('admin_deduct 부족(보유 10, 차감 50) → throw + ROLLBACK', async () => {
    const c = mockClient({ purchased: 10, base: 0 });
    await assert.rejects(() => adjustCreditWithClient(c as any, { companyId: 'c1', amount: 50, type: 'admin_deduct', adminId: 'a1', reason: 'x' }, new Date()));
    assert.ok(c.calls.includes('ROLLBACK'));
  });
  await ok('금액 0 이하 → throw', async () => {
    const c = mockClient({ purchased: 100, base: 0 });
    await assert.rejects(() => adjustCreditWithClient(c as any, { companyId: 'c1', amount: 0, type: 'grant', adminId: 'a1', reason: 'x' }, new Date()));
  });

  console.log('[ai-credit] adjustCreditWithClient 멱등 (idempotencyKey 중복 차단)');
  await ok('키 있고 dup 없음 → 정상 지급', async () => {
    const c = mockClient({ purchased: 0, base: 0 });
    const r = await adjustCreditWithClient(c as any, { companyId: 'c1', amount: 100, type: 'grant', adminId: 'a1', reason: 'x', idempotencyKey: 'k1' }, new Date());
    assert.strictEqual(r.purchasedAfter, 100);
    assert.ok(c.calls.includes('COMMIT'));
  });
  await ok('키 있고 dup 있음 → throw + ROLLBACK, 지급 UPDATE 없음', async () => {
    const c = mockClient({ purchased: 0, base: 0 }, { dupExists: true });
    await assert.rejects(() => adjustCreditWithClient(c as any, { companyId: 'c1', amount: 100, type: 'grant', adminId: 'a1', reason: 'x', idempotencyKey: 'k1' }, new Date()));
    assert.ok(c.calls.includes('ROLLBACK'));
    assert.ok(!c.calls.some((s) => s.includes('UPDATE companies')), '지급 UPDATE 없어야');
  });
  await ok('키 없으면 멱등 SELECT 안 함(기존 동작 보존)', async () => {
    const c = mockClient({ purchased: 0, base: 0 });
    await adjustCreditWithClient(c as any, { companyId: 'c1', amount: 100, type: 'grant', adminId: 'a1', reason: 'x' }, new Date());
    assert.ok(!c.calls.some((s) => s.includes('ai_credit_transactions') && s.includes('idempotency_key') && s.startsWith('SELECT')), '멱등 SELECT 호출 안 함');
  });

  console.log(`\n${passed} assertions passed`);
})();
