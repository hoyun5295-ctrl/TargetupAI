/**
 * cafe24-install-state.verify.ts — 카페24 설치(앱스토어) OAuth state 서명·검증 (순수, DB 무관)
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/cafe24-install-state.verify.ts
 * 핵심: 로그인 없는 설치 동선의 state를 HMAC 서명으로 위조 차단 + TTL. 토큰 저장 없음(계약 고객 전용 모델).
 */
import assert from 'node:assert';
import { signCafe24InstallState, verifyCafe24InstallState } from '../cafe24-install-state';

const SECRET = 'test-secret-123';
let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[1] 정상 round-trip');
{
  const now = 1_700_000_000_000;
  const state = signCafe24InstallState('myshop', now, SECRET);
  ok('mall_id 복원', () => assert.deepStrictEqual(verifyCafe24InstallState(state, { secret: SECRET, now }), { mallId: 'myshop' }));
}

console.log('[2] 위조 차단');
{
  const now = 1_700_000_000_000;
  const state = signCafe24InstallState('myshop', now, SECRET);
  const dot = state.indexOf('.');
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  ok('payload 변조 → null', () => assert.strictEqual(verifyCafe24InstallState(`${payload}x.${sig}`, { secret: SECRET, now }), null));
  ok('sig 변조 → null', () => assert.strictEqual(verifyCafe24InstallState(`${payload}.${sig}x`, { secret: SECRET, now }), null));
  ok('다른 비밀키 → null', () => assert.strictEqual(verifyCafe24InstallState(state, { secret: 'other-secret', now }), null));
  ok('빈 비밀키 → null', () => assert.strictEqual(verifyCafe24InstallState(state, { secret: '', now }), null));
}

console.log('[3] TTL / 형식 구분');
{
  const now = 1_700_000_000_000;
  const state = signCafe24InstallState('myshop', now, SECRET);
  ok('10분 이내 → 통과', () => assert.deepStrictEqual(verifyCafe24InstallState(state, { secret: SECRET, now: now + 5 * 60 * 1000 }), { mallId: 'myshop' }));
  ok('10분 초과 → null', () => assert.strictEqual(verifyCafe24InstallState(state, { secret: SECRET, now: now + 11 * 60 * 1000 }), null));
  ok('미래 ts → null', () => assert.strictEqual(verifyCafe24InstallState(signCafe24InstallState('myshop', now + 30 * 60 * 1000, SECRET), { secret: SECRET, now }), null));
  const companyState = Buffer.from(JSON.stringify({ company_id: 'c1', nonce: 'n1', ts: now })).toString('base64url');
  ok('점 없는 company state → null(일반 경로로)', () => assert.strictEqual(verifyCafe24InstallState(companyState, { secret: SECRET, now }), null));
}

console.log(`\n${passed} assertions passed — cafe24-install-state`);
