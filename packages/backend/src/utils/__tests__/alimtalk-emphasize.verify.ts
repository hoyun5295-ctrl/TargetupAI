/**
 * alimtalk-emphasize.verify.ts — 강조표기형 k_etc_json 생성(buildAlimtalkEtcJson) 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/alimtalk-emphasize.verify.ts
 * (DB import 0 — 순수. 치환 함수 주입형. k_etc_json = {senderkey, title}.)
 */
import assert from 'node:assert';
import { buildAlimtalkEtcJson } from '../alimtalk-emphasize';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[alimtalk-emphasize] buildAlimtalkEtcJson');

ok('senderKey만 → {senderkey}', () => {
  const r = buildAlimtalkEtcJson({ senderKey: 'KEY_ABC' });
  assert.strictEqual(r, JSON.stringify({ senderkey: 'KEY_ABC' }));
});

ok('senderKey + title + 치환 → 치환된 title 포함', () => {
  const r = buildAlimtalkEtcJson({
    senderKey: 'KEY_ABC',
    emphasizeTitle: '#{이름}님 주문',
    substitute: (raw) => raw.replace('#{이름}', '홍길동'),
  });
  const o = JSON.parse(r!);
  assert.strictEqual(o.senderkey, 'KEY_ABC');
  assert.strictEqual(o.title, '홍길동님 주문');
});

ok('title만(senderKey 없음) → {title}', () => {
  const r = buildAlimtalkEtcJson({ emphasizeTitle: '안내' });
  assert.strictEqual(r, JSON.stringify({ title: '안내' }));
});

ok('senderKey·title 모두 없음 → undefined', () => {
  assert.strictEqual(buildAlimtalkEtcJson({}), undefined);
  assert.strictEqual(buildAlimtalkEtcJson({ senderKey: '', emphasizeTitle: '' }), undefined);
  assert.strictEqual(buildAlimtalkEtcJson({ senderKey: null, emphasizeTitle: null }), undefined);
});

ok('substitute 미주입 + title → 원문 그대로', () => {
  const r = buildAlimtalkEtcJson({ senderKey: 'K', emphasizeTitle: '#{이름}님' });
  const o = JSON.parse(r!);
  assert.strictEqual(o.title, '#{이름}님');
});

ok('emphasizeTitle 없으면 title 키 생략', () => {
  const o = JSON.parse(buildAlimtalkEtcJson({ senderKey: 'K' })!);
  assert.ok(!('title' in o));
});

ok('치환 결과가 빈 문자열이어도 원문 truthy면 title 키 유지', () => {
  const o = JSON.parse(buildAlimtalkEtcJson({ senderKey: 'K', emphasizeTitle: '#{없는변수}', substitute: () => '' })!);
  assert.strictEqual(o.title, '');
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
