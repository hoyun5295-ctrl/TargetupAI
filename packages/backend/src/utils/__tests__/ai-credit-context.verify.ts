/**
 * ai-credit-context.verify.ts — 묶음 컨텍스트(AsyncLocalStorage) 단위 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/ai-credit-context.verify.ts
 */
import assert from 'node:assert';
import { runInCreditBundle, isInCreditBundle } from '../ai-credit-context';

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok - ${name}`);
}

(async () => {
  console.log('[ai-credit-context] 묶음 컨텍스트');
  await ok('밖에서는 false', async () => {
    assert.strictEqual(isInCreditBundle(), false);
  });
  await ok('runInCreditBundle 안에서는 true', async () => {
    await runInCreditBundle(async () => {
      assert.strictEqual(isInCreditBundle(), true);
    });
  });
  await ok('중첩도 true', async () => {
    await runInCreditBundle(async () => {
      await runInCreditBundle(async () => {
        assert.strictEqual(isInCreditBundle(), true);
      });
      assert.strictEqual(isInCreditBundle(), true);
    });
  });
  await ok('run 종료 후 다시 false', async () => {
    await runInCreditBundle(async () => {});
    assert.strictEqual(isInCreditBundle(), false);
  });
  await ok('await 비동기 경계 넘어도 유지', async () => {
    await runInCreditBundle(async () => {
      await new Promise((r) => setImmediate(r));
      assert.strictEqual(isInCreditBundle(), true);
    });
  });
  await ok('반환값 전달', async () => {
    const v = await runInCreditBundle(async () => 42);
    assert.strictEqual(v, 42);
  });

  console.log(`\n${passed} assertions passed`);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
