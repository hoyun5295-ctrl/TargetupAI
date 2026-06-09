/**
 * alimtalk-emphasize.verify.ts — 강조표기형 k_etc_json 생성(buildAlimtalkEtcJson) 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/alimtalk-emphasize.verify.ts
 * (DB import 0 — 순수. 치환 함수 주입형. ★ QTmsg 매뉴얼: 알림톡 k_etc_json = {title}만, senderkey 제외.)
 */
import assert from 'node:assert';
import { buildAlimtalkEtcJson } from '../alimtalk-emphasize';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[alimtalk-emphasize] buildAlimtalkEtcJson');

ok('title + 치환 → {title:치환값} (senderkey 없음)', () => {
  const r = buildAlimtalkEtcJson({
    emphasizeTitle: '#{이름}님 주문',
    substitute: (raw) => raw.replace('#{이름}', '홍길동'),
  });
  const o = JSON.parse(r!);
  assert.strictEqual(o.title, '홍길동님 주문');
  assert.ok(!('senderkey' in o)); // ★ 매뉴얼: 알림톡은 senderkey 제외 (7300 근본원인)
});

ok('title만(치환 미주입) → {title:원문}', () => {
  assert.strictEqual(buildAlimtalkEtcJson({ emphasizeTitle: '안내' }), JSON.stringify({ title: '안내' }));
});

ok('emphasizeTitle 없음 → undefined (etcJson 미전달)', () => {
  assert.strictEqual(buildAlimtalkEtcJson({}), undefined);
  assert.strictEqual(buildAlimtalkEtcJson({ emphasizeTitle: '' }), undefined);
  assert.strictEqual(buildAlimtalkEtcJson({ emphasizeTitle: null }), undefined);
});

ok('치환 결과가 빈 문자열이어도 원문 truthy면 title 키 유지', () => {
  const o = JSON.parse(buildAlimtalkEtcJson({ emphasizeTitle: '#{없는변수}', substitute: () => '' })!);
  assert.strictEqual(o.title, '');
});

ok('출력 JSON은 title 키 하나뿐 (senderkey 절대 없음 — 알림톡 전용 CT)', () => {
  const o = JSON.parse(buildAlimtalkEtcJson({ emphasizeTitle: '안내', substitute: (r) => r })!);
  assert.deepStrictEqual(Object.keys(o), ['title']);
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
