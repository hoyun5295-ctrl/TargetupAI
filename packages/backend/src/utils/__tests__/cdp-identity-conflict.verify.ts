/**
 * cdp-identity-conflict.verify.ts — email 매칭 고객 ≠ phone 보유 고객 충돌 감지 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/cdp-identity-conflict.verify.ts
 * (DB import 0 — detectIdentityConflict 순수 함수만. 자동 병합 금지, 충돌이면 플래그만.)
 */
import assert from 'node:assert';
import { detectIdentityConflict } from '../cdp-identity-conflict';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[cdp-identity-conflict] detectIdentityConflict — email/phone 다른 고객 충돌 감지');

ok('email=A, phone 보유자=A 동일 → 충돌 없음', () =>
  assert.deepStrictEqual(detectIdentityConflict({ chosenCustomerId: 'A', phoneHolderId: 'A' }), { conflict: false }));

ok('email=A, phone 보유자=B 다름 → phone_conflict', () =>
  assert.deepStrictEqual(detectIdentityConflict({ chosenCustomerId: 'A', phoneHolderId: 'B' }), { conflict: true, kind: 'phone_conflict' }));

ok('phone 보유자 없음(null) → 충돌 없음', () =>
  assert.deepStrictEqual(detectIdentityConflict({ chosenCustomerId: 'A', phoneHolderId: null }), { conflict: false }));

ok('chosen 없음(신규 생성 경로) → 충돌 없음', () =>
  assert.deepStrictEqual(detectIdentityConflict({ chosenCustomerId: null, phoneHolderId: 'B' }), { conflict: false }));

ok('둘 다 없음 → 충돌 없음', () =>
  assert.deepStrictEqual(detectIdentityConflict({ chosenCustomerId: null, phoneHolderId: null }), { conflict: false }));

console.log(`\n[cdp-identity-conflict] ${passed}/5 passed`);
