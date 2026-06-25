/**
 * provider-registry-ui.verify.ts — listProvidersForUI 분류(available/coming_soon) 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/provider-registry-ui.verify.ts
 * (provider-registry.ts는 DB import 0 — buildProvidersForUI에 fake 어댑터 배열을 직접 주입해 검증.)
 */
import assert from 'node:assert';
import { buildProvidersForUI } from '../provider-registry';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const fake = (provider: string, connectMethod: any, available: boolean) => ({
  provider, displayName: provider,
  capabilities: { oauth: false, webhook: false, webhookSignatureVerification: false, adminApi: false },
  connectMethod, available,
});

console.log('[provider-registry-ui] buildProvidersForUI — available 직접 사용(추론 폐기)');

const out = buildProvidersForUI([
  fake('cafe24', 'oauth', true),
  fake('godo', 'polling', true),     // 폴링형도 available true면 available
  fake('gabia', 'webhook', true),
  fake('shopify', 'none', false),    // 스켈레톤 → coming_soon
]);

ok('cafe24(oauth, available) → available', () =>
  assert.strictEqual(out.find(p => p.provider === 'cafe24')!.status, 'available'));
ok('godo(polling, available) → available (추론이면 oauth/webhook 없어 coming_soon 됐을 케이스)', () =>
  assert.strictEqual(out.find(p => p.provider === 'godo')!.status, 'available'));
ok('godo connectMethod 보존', () =>
  assert.strictEqual(out.find(p => p.provider === 'godo')!.connectMethod, 'polling'));
ok('gabia(webhook, available) → available', () =>
  assert.strictEqual(out.find(p => p.provider === 'gabia')!.status, 'available'));
ok('shopify(none, available=false) → coming_soon', () =>
  assert.strictEqual(out.find(p => p.provider === 'shopify')!.status, 'coming_soon'));

console.log(`\n[provider-registry-ui] ${passed}/5 passed`);
