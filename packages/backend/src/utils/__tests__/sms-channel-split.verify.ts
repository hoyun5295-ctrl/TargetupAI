/**
 * sms-channel-split.verify.ts — 알림톡/대체발송 채널 분류·집계 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/sms-channel-split.verify.ts
 * (DB import 0 — msg_type/k_oriseq/status_code 분류 + 채널별 성공·실패 집계 순수 함수.)
 * 2026-06-07: 대체발송 SMS/LMS 세분화(substitute → substitute_lms / substitute_sms) — 정산 단가 구분.
 */
import assert from 'node:assert';
import { classifyMsgChannel, tallySmsChannelCounts } from '../sms-result-map';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[sms-channel-split] classifyMsgChannel');
ok('K → alimtalk', () => assert.strictEqual(classifyMsgChannel('K', null), 'alimtalk'));
ok('L + k_oriseq>0 → substitute_lms (LMS 대체)', () => assert.strictEqual(classifyMsgChannel('L', 361669), 'substitute_lms'));
ok('L + k_oriseq 문자열 → substitute_lms', () => assert.strictEqual(classifyMsgChannel('L', '361669'), 'substitute_lms'));
ok('L + k_oriseq NULL → lms', () => assert.strictEqual(classifyMsgChannel('L', null), 'lms'));
ok('L + k_oriseq 0 → lms', () => assert.strictEqual(classifyMsgChannel('L', 0), 'lms'));
ok('S + k_oriseq>0 → substitute_sms (SMS 대체)', () => assert.strictEqual(classifyMsgChannel('S', 361669), 'substitute_sms'));
ok('S + k_oriseq NULL → sms', () => assert.strictEqual(classifyMsgChannel('S', null), 'sms'));
ok('M → mms', () => assert.strictEqual(classifyMsgChannel('M', null), 'mms'));
ok('알 수 없는 타입 → other', () => assert.strictEqual(classifyMsgChannel('X', null), 'other'));

console.log('[sms-channel-split] tallySmsChannelCounts');
ok('K 6(성공4·실패2) + LMS대체 2(성공2)', () => {
  const r = tallySmsChannelCounts([
    { msg_type: 'K', k_oriseq: null, status_code: 1800, cnt: 4 },
    { msg_type: 'K', k_oriseq: null, status_code: 7300, cnt: 2 },
    { msg_type: 'L', k_oriseq: 361669, status_code: 1000, cnt: 1 },
    { msg_type: 'L', k_oriseq: 361670, status_code: 1000, cnt: 1 },
  ]);
  assert.strictEqual(r.alimtalk.total, 6);
  assert.strictEqual(r.alimtalk.success, 4);
  assert.strictEqual(r.alimtalk.fail, 2);
  assert.strictEqual(r.substitute_lms.total, 2);
  assert.strictEqual(r.substitute_lms.success, 2);
  assert.strictEqual(r.substitute_lms.fail, 0);
});
ok('SMS 대체 → substitute_sms 분리(일반 SMS와 섞이지 않음)', () => {
  const r = tallySmsChannelCounts([
    { msg_type: 'S', k_oriseq: 361700, status_code: 6, cnt: 3 },
    { msg_type: 'S', k_oriseq: 361701, status_code: 7, cnt: 1 },
  ]);
  assert.strictEqual(r.substitute_sms.total, 4);
  assert.strictEqual(r.substitute_sms.success, 3);
  assert.strictEqual(r.substitute_sms.fail, 1);
  assert.strictEqual(r.sms.total, 0);
});
ok('일반 LMS·SMS는 별도 채널, 대기(100) 분리', () => {
  const r = tallySmsChannelCounts([
    { msg_type: 'L', k_oriseq: null, status_code: 1000, cnt: 5 },
    { msg_type: 'S', k_oriseq: null, status_code: 6, cnt: 3 },
    { msg_type: 'S', k_oriseq: null, status_code: 100, cnt: 1 },
  ]);
  assert.strictEqual(r.lms.success, 5);
  assert.strictEqual(r.sms.success, 3);
  assert.strictEqual(r.sms.pending, 1);
  assert.strictEqual(r.substitute_lms.total, 0);
  assert.strictEqual(r.substitute_sms.total, 0);
});
ok('빈 입력 → 전 채널 0', () => {
  const r = tallySmsChannelCounts([]);
  assert.strictEqual(r.alimtalk.total, 0);
  assert.strictEqual(r.substitute_lms.total, 0);
  assert.strictEqual(r.substitute_sms.total, 0);
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
