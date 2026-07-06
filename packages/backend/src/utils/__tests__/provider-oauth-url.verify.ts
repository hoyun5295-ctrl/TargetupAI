/**
 * provider-oauth-url.verify.ts — 카페24 authorize URL 빌더 (순수, 자격 주입)
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/provider-oauth-url.verify.ts
 * 핵심: client_id/redirect_uri는 주입된 creds 그대로(회사 BYO든 env든 무관) — model B 토대.
 * ★ 2026-07-06: 네이버 절 삭제 — 커머스 API는 client_credentials(authorize URL 없음, 서버 실측 확정).
 */
import assert from 'node:assert';
import { buildCafe24AuthorizeUrl } from '../provider-oauth-url';

const creds = { clientId: 'CID', clientSecret: 'SEC', redirectUri: 'https://app.hanjul.ai/api/cafe24/oauth/callback' };

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[1] 카페24 authorize URL');
{
  const url = buildCafe24AuthorizeUrl(creds, 'myshop', 'ST', 'mall.read_customer,mall.read_order');
  const u = new URL(url);
  ok('mall_id 서브도메인', () => assert.strictEqual(u.host, 'myshop.cafe24api.com'));
  ok('authorize 경로', () => assert.strictEqual(u.pathname, '/api/v2/oauth/authorize'));
  ok('client_id = 주입 creds', () => assert.strictEqual(u.searchParams.get('client_id'), 'CID'));
  ok('redirect_uri = 주입 creds', () => assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://app.hanjul.ai/api/cafe24/oauth/callback'));
  ok('response_type=code', () => assert.strictEqual(u.searchParams.get('response_type'), 'code'));
  ok('state·scope 전달', () => { assert.strictEqual(u.searchParams.get('state'), 'ST'); assert.strictEqual(u.searchParams.get('scope'), 'mall.read_customer,mall.read_order'); });
}

console.log('[2] 카페24 mall_id 형식 오류 → throw');
{
  ok('잘못된 mall_id throw', () => assert.throws(() => buildCafe24AuthorizeUrl(creds, 'bad mall!', 'ST', 'x')));
}

console.log(`\n${passed} assertions passed — provider-oauth-url`);
