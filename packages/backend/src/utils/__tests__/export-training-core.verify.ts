/**
 * export-training-core.verify.ts — 학습 데이터셋 변환 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/export-training-core.verify.ts
 * (DB import 0 — 발송/제안 row → JSONL 예시 변환. 라벨은 실데이터에서만, 임의 상수 0.)
 */
import assert from 'node:assert';
import {
  buildGenerationExample,
  buildPreferenceExample,
  buildSpamExample,
  buildSpamFilterExample,
  splitTrainVal,
} from '../export-training-core';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[export-training-core] buildGenerationExample — userPrompt 있는 발송만 (입력→메시지)');
ok('userPrompt 없으면 null', () =>
  assert.strictEqual(buildGenerationExample({ userPrompt: null, finalMessage: '여름 세일', messageType: 'LMS', isAd: true }), null));
ok('userPrompt 있으면 system/user/assistant 3건 + 최종 메시지', () => {
  const ex = buildGenerationExample({ userPrompt: '여름 세일 알려줘', finalMessage: '[brand] 여름 세일 시작', messageType: 'LMS', isAd: true })!;
  assert.strictEqual(ex.messages.length, 3);
  assert.strictEqual(ex.messages[2].role, 'assistant');
  assert.strictEqual(ex.messages[2].content, '[brand] 여름 세일 시작');
  assert.ok(ex.messages[1].content.includes('여름 세일 알려줘'), ex.messages[1].content);
});

console.log('[export-training-core] buildPreferenceExample — status 기반 선호(임의 상수 0)');
ok('approved → desirable', () =>
  assert.strictEqual(buildPreferenceExample({ objective: '휴면 회수', message: '오랜만이에요', status: 'approved' })!.label, 'desirable'));
ok('auto_executed → desirable', () =>
  assert.strictEqual(buildPreferenceExample({ objective: '재구매', message: '재입고', status: 'auto_executed' })!.label, 'desirable'));
ok('rejected → undesirable', () =>
  assert.strictEqual(buildPreferenceExample({ objective: 'x', message: 'y', status: 'rejected' })!.label, 'undesirable'));
ok('pending/expired → null (신호 없음)', () => {
  assert.strictEqual(buildPreferenceExample({ objective: 'x', message: 'y', status: 'pending' }), null);
  assert.strictEqual(buildPreferenceExample({ objective: 'x', message: '', status: 'approved' }), null);
});

console.log('[export-training-core] buildSpamExample — spam_blocked 실측 → block/pass');
ok('spam_blocked>0 → block', () =>
  assert.strictEqual(buildSpamExample({ features: { char_length: 40 }, spamBlocked: 3 })!.label, 'block'));
ok('spam_blocked 0/없음 → pass', () => {
  assert.strictEqual(buildSpamExample({ features: { char_length: 40 }, spamBlocked: 0 })!.label, 'pass');
  assert.strictEqual(buildSpamExample({ features: { char_length: 40 }, spamBlocked: null })!.label, 'pass');
});
ok('features 없으면 null', () =>
  assert.strictEqual(buildSpamExample({ features: null, spamBlocked: 0 }), null));

console.log('[export-training-core] buildSpamFilterExample — 스팸필터 판정(blocked 하나라도 → block)');
ok('blocked 포함 → block', () =>
  assert.strictEqual(buildSpamFilterExample({ features: { char_length: 40 }, results: ['blocked'] })!.label, 'block'));
ok('전부 pass → pass', () =>
  assert.strictEqual(buildSpamFilterExample({ features: { char_length: 40 }, results: ['pass', 'pass'] })!.label, 'pass'));
ok('pass+blocked 혼재 → block (하나라도 차단)', () =>
  assert.strictEqual(buildSpamFilterExample({ features: { char_length: 40 }, results: ['pass', 'blocked'] })!.label, 'block'));
ok('pass+timeout → pass (pass 있음)', () =>
  assert.strictEqual(buildSpamFilterExample({ features: { char_length: 40 }, results: ['pass', 'timeout'] })!.label, 'pass'));
ok('timeout/failed/빈 배열 → null (판정 불가)', () => {
  assert.strictEqual(buildSpamFilterExample({ features: { char_length: 40 }, results: ['timeout', 'failed'] }), null);
  assert.strictEqual(buildSpamFilterExample({ features: { char_length: 40 }, results: [] }), null);
});
ok('features 없으면 null (blocked여도)', () =>
  assert.strictEqual(buildSpamFilterExample({ features: null, results: ['blocked'] }), null));

console.log('[export-training-core] splitTrainVal — 결정적 분리(난수 X)');
ok('10건 valEvery 5 → train 8 / val 2 (인덱스 4·9)', () => {
  const { train, val } = splitTrainVal(Array.from({ length: 10 }, (_, i) => i), 5);
  assert.strictEqual(train.length, 8);
  assert.strictEqual(val.length, 2);
  assert.deepStrictEqual(val, [4, 9]);
});
ok('같은 입력 → 같은 분리(결정적)', () => {
  const a = splitTrainVal([1, 2, 3, 4, 5, 6], 3);
  const b = splitTrainVal([1, 2, 3, 4, 5, 6], 3);
  assert.deepStrictEqual(a, b);
});

console.log(`\n[export-training-core] ${passed} passed`);
