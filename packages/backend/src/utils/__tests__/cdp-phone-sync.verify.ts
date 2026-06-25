/**
 * cdp-phone-sync.verify.ts — 자사몰 회원 phone 자동 갱신 판정 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/cdp-phone-sync.verify.ts
 * (DB import 0 — decidePhoneUpdate 순수 함수만. 입력 phone은 호출부에서 normalizePhone 경유 가정.)
 */
import assert from 'node:assert';
import { decidePhoneUpdate } from '../cdp-phone-sync';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[cdp-phone-sync] decidePhoneUpdate — 자동 갱신/충돌 skip/noop 판정');

ok('incoming 없음 → noop', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: null, conflictHolderId: null, selfId: 'A' }), 'noop'));

ok('현재값과 동일 → noop', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: '01011112222', conflictHolderId: null, selfId: 'A' }), 'noop'));

ok('자유번호(점유자 없음) + 변경 → update', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: '01033334444', conflictHolderId: null, selfId: 'A' }), 'update'));

ok('현재 phone NULL이고 incoming 있음 + 점유자 없음 → update', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: null, incomingPhone: '01033334444', conflictHolderId: null, selfId: 'A' }), 'update'));

ok('타 고객(B)이 그 번호 점유 → skip_conflict(자동변경 금지)', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: '01033334444', conflictHolderId: 'B', selfId: 'A' }), 'skip_conflict'));

ok('점유자가 자기 자신(A) → update (충돌 아님)', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: '01033334444', conflictHolderId: 'A', selfId: 'A' }), 'update'));

ok('incoming 빈 문자열 → noop (falsy 안전)', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: '', conflictHolderId: null, selfId: 'A' }), 'noop'));

console.log(`\n[cdp-phone-sync] ${passed}/7 passed`);
