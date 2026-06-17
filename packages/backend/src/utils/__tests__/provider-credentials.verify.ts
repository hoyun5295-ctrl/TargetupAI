/**
 * provider-credentials.verify.ts — 회사별 BYO OAuth 자격 해석 (순수, DB import 0)
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/provider-credentials.verify.ts
 * 핵심: 회사 meta 자격 3종 완비 → company / 부분·없음 → env fallback / 둘 다 없음 → missing(503 안내용).
 */
import assert from 'node:assert';
import { resolveProviderOAuthCredentials } from '../provider-credentials';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[1] 회사 자격 완비 → company 우선');
{
  const r = resolveProviderOAuthCredentials(
    { app_client_id: 'C', app_client_secret: 'S', app_redirect_uri: 'https://app.hanjul.ai/cb' },
    { clientId: 'ENV', clientSecret: 'ENVS', redirectUri: 'https://env/cb' },
  );
  ok('회사 자격 완비 → company', () => {
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.source, 'company');
    assert.strictEqual(r.credentials.clientId, 'C');
    assert.strictEqual(r.credentials.redirectUri, 'https://app.hanjul.ai/cb');
  });
}

console.log('[2] 회사 자격 없음 + env만 → env fallback');
{
  const r = resolveProviderOAuthCredentials(null, { clientId: 'ENV', clientSecret: 'ENVS', redirectUri: 'https://env/cb' });
  ok('env fallback', () => {
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.source, 'env');
    assert.strictEqual(r.credentials.clientId, 'ENV');
  });
}

console.log('[3] 둘 다 없음 → missing');
{
  const r = resolveProviderOAuthCredentials(null, null);
  ok('missing', () => {
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.strictEqual(r.reason, 'missing');
  });
}

console.log('[4] 회사 자격 부분(redirect 누락) → company 미채택, env 채택');
{
  const r = resolveProviderOAuthCredentials(
    { app_client_id: 'C', app_client_secret: 'S' },
    { clientId: 'ENV', clientSecret: 'ENVS', redirectUri: 'https://env/cb' },
  );
  ok('부분 자격 → env', () => {
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.source, 'env');
  });
}

console.log('[5] 공백 문자열 = 미사용');
{
  const r = resolveProviderOAuthCredentials({ app_client_id: '   ', app_client_secret: 'S', app_redirect_uri: 'x' }, null);
  ok('공백 client_id → company 미채택 → missing', () => {
    assert.ok(!r.ok);
  });
}

console.log(`\n${passed} assertions passed — provider-credentials`);
