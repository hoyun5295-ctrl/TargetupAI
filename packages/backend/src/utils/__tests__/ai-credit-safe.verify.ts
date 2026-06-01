/**
 * ai-credit-safe.verify.ts — deductCreditSafe 재시도/멱등/로그 단위 검증 (deductFn 주입)
 *
 * 실행: npx ts-node packages/backend/src/utils/__tests__/ai-credit-safe.verify.ts
 * deductFn·sleep을 주입해 DB 없이 검증한다. 핵심:
 *  - 일시 오류 재시도 복구(누수 차단) + aiCallLogId 없을 때 재시도 멱등키 동일(오차감 차단) 둘 다.
 */
import assert from 'node:assert';
import { deductCreditSafe, InsufficientCreditError } from '../ai-credit';

const noSleep = (_ms: number) => Promise.resolve();

/** behavior 순서대로 ok/fail(일시)/insufficient(잔액부족)을 흉내내는 mock deduct. 호출 opts 기록. */
function makeDeduct(behavior: Array<'ok' | 'fail' | 'insufficient'>) {
  const calls: any[] = [];
  let i = 0;
  const fn = async (opts: any) => {
    calls.push(opts);
    const b = behavior[Math.min(i, behavior.length - 1)];
    i++;
    if (b === 'insufficient') throw new InsufficientCreditError(opts.cost, 0);
    if (b === 'fail') throw new Error('deadlock(일시)');
    return { deducted: true, fromBase: opts.cost, fromPurchased: 0, baseAfter: 0, purchasedAfter: 0 };
  };
  return { fn, calls };
}

function captureLog(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: any[]) => { logs.push(a.map(String).join(' ')); };
  return { logs, restore: () => { console.log = orig; } };
}

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok - ${name}`);
}

const BASE = { companyId: 'c1', cost: 10, source: 'orchestrate', createdBy: 'u1' };

(async () => {
  console.log('[ai-credit-safe] 1회 성공 → 재시도 없음');
  await ok('성공 시 deductFn 1회', async () => {
    const d = makeDeduct(['ok']);
    await deductCreditSafe({ ...BASE, aiCallLogId: 'log1' }, { deductFn: d.fn, sleep: noSleep });
    assert.strictEqual(d.calls.length, 1);
  });

  console.log('[ai-credit-safe] 일시 실패 2회 후 성공 → 재시도로 복구(누수 차단)');
  await ok('fail,fail,ok → deductFn 3회', async () => {
    const d = makeDeduct(['fail', 'fail', 'ok']);
    await deductCreditSafe({ ...BASE, aiCallLogId: 'log2' }, { deductFn: d.fn, sleep: noSleep });
    assert.strictEqual(d.calls.length, 3);
  });

  console.log('[ai-credit-safe] 3회 모두 실패 → [CREDIT][MISS] 로그');
  await ok('영구 실패 시 deductFn 3회 + MISS 로그', async () => {
    const d = makeDeduct(['fail', 'fail', 'fail']);
    const cap = captureLog();
    try { await deductCreditSafe({ ...BASE, aiCallLogId: 'log3' }, { deductFn: d.fn, sleep: noSleep }); }
    finally { cap.restore(); }
    assert.strictEqual(d.calls.length, 3);
    assert.ok(cap.logs.some((l) => l.includes('[CREDIT][MISS]')), 'MISS 로그 있어야');
  });

  console.log('[ai-credit-safe] 잔액 부족 → 재시도 없이 [CREDIT][SKIP]');
  await ok('InsufficientCredit은 deductFn 1회 + SKIP 로그', async () => {
    const d = makeDeduct(['insufficient']);
    const cap = captureLog();
    try { await deductCreditSafe({ ...BASE, aiCallLogId: 'log4' }, { deductFn: d.fn, sleep: noSleep }); }
    finally { cap.restore(); }
    assert.strictEqual(d.calls.length, 1, '재시도 없이 1회');
    assert.ok(cap.logs.some((l) => l.includes('[CREDIT][SKIP]')), 'SKIP 로그 있어야');
  });

  console.log('[ai-credit-safe] aiCallLogId 없음 → fallback 멱등키 + 재시도 내내 동일(오차감 차단)');
  await ok('fallback 키 부여 + 재시도 동일', async () => {
    const d = makeDeduct(['fail', 'ok']);
    await deductCreditSafe({ ...BASE, aiCallLogId: null }, { deductFn: d.fn, sleep: noSleep });
    assert.strictEqual(d.calls.length, 2);
    const k0 = d.calls[0].idempotencyKey;
    const k1 = d.calls[1].idempotencyKey;
    assert.ok(typeof k0 === 'string' && k0.startsWith('fallback:'), 'fallback 키 부여');
    assert.strictEqual(k0, k1, '재시도 멱등키 동일 → 이중 차감 차단');
  });

  console.log('[ai-credit-safe] aiCallLogId 있음 → idempotencyKey 미지정(원래 키 사용)');
  await ok('logId 있으면 idempotencyKey undefined', async () => {
    const d = makeDeduct(['ok']);
    await deductCreditSafe({ ...BASE, aiCallLogId: 'log5' }, { deductFn: d.fn, sleep: noSleep });
    assert.strictEqual(d.calls[0].idempotencyKey, undefined);
    assert.strictEqual(d.calls[0].aiCallLogId, 'log5');
  });

  console.log('[ai-credit-safe] no-op — companyId 없음 / cost 0');
  await ok('companyId 없으면 차감 시도 0', async () => {
    const d = makeDeduct(['ok']);
    await deductCreditSafe({ ...BASE, companyId: null, aiCallLogId: 'log6' }, { deductFn: d.fn, sleep: noSleep });
    assert.strictEqual(d.calls.length, 0);
  });
  await ok('cost 0이면 차감 시도 0', async () => {
    const d = makeDeduct(['ok']);
    await deductCreditSafe({ ...BASE, cost: 0, aiCallLogId: 'log7' }, { deductFn: d.fn, sleep: noSleep });
    assert.strictEqual(d.calls.length, 0);
  });

  console.log(`\n${passed} assertions passed`);
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
