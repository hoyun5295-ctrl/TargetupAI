/**
 * alimtalk-button.verify.ts — 알림톡 버튼(kakao_templates.buttons) → QTmsg k_button_json 변환 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/alimtalk-button.verify.ts
 * (DB import 0 — 순수 변환. QTmsg 매뉴얼 4.0 k_button_json 형식: name{i}/type{i}/url{i}_1/url{i}_2, 최대 5.)
 */
import assert from 'node:assert';
import { convertButtonsToQTmsg } from '../alimtalk-button';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[alimtalk-button] convertButtonsToQTmsg');
ok('빈 배열 / null → null', () => {
  assert.strictEqual(convertButtonsToQTmsg([]), null);
  assert.strictEqual(convertButtonsToQTmsg(null), null);
  assert.strictEqual(convertButtonsToQTmsg(undefined), null);
});
ok('웹링크 버튼 1개 → name1/type1/url1_1', () => {
  const r = convertButtonsToQTmsg([{ buttonName: '주문 확인', buttonType: 'WL', buttonUrlMobile: 'http://a.com/m', buttonUrlPc: 'http://a.com/pc' }]);
  const o = JSON.parse(r!);
  assert.strictEqual(o.name1, '주문 확인');
  assert.strictEqual(o.type1, '2');           // WL → 2
  assert.strictEqual(o.url1_1, 'http://a.com/m');
  assert.strictEqual(o.url1_2, 'http://a.com/pc');
});
ok('버튼 2개 — name2/type2까지', () => {
  const r = convertButtonsToQTmsg([
    { buttonName: '버튼1', buttonType: 'WL', buttonUrlMobile: 'http://1.com' },
    { buttonName: '버튼2', buttonType: 'AC' },
  ]);
  const o = JSON.parse(r!);
  assert.strictEqual(o.name1, '버튼1');
  assert.strictEqual(o.name2, '버튼2');
  assert.strictEqual(o.type2, '6');           // AC(채널추가) → 6
});
ok('타입 매핑 — DS=1 / AL=3 / BK=4 / MD=5', () => {
  const o = JSON.parse(convertButtonsToQTmsg([
    { buttonName: 'a', buttonType: 'DS' },
    { buttonName: 'b', buttonType: 'AL', buttonUrlMobile: 'http://b' },
    { buttonName: 'c', buttonType: 'BK' },
    { buttonName: 'd', buttonType: 'MD' },
  ])!);
  assert.strictEqual(o.type1, '1');
  assert.strictEqual(o.type2, '3');
  assert.strictEqual(o.type3, '4');
  assert.strictEqual(o.type4, '5');
});
ok('알 수 없는 타입 → 기본 2(웹링크)', () => {
  const o = JSON.parse(convertButtonsToQTmsg([{ buttonName: 'x', buttonType: 'ZZ' }])!);
  assert.strictEqual(o.type1, '2');
});
ok('5개 초과 → 최대 5개만', () => {
  const o = JSON.parse(convertButtonsToQTmsg(
    Array.from({ length: 7 }, (_, i) => ({ buttonName: `b${i}`, buttonType: 'WL', buttonUrlMobile: 'http://x' }))
  )!);
  assert.ok('name5' in o);
  assert.ok(!('name6' in o));
});
ok('대체 필드명(name/url1/url2) 호환', () => {
  const o = JSON.parse(convertButtonsToQTmsg([{ name: '대체', type: 'WL', url1: 'http://m', url2: 'http://p' }])!);
  assert.strictEqual(o.name1, '대체');
  assert.strictEqual(o.url1_1, 'http://m');
  assert.strictEqual(o.url1_2, 'http://p');
});
ok('IMC 응답 형식(name/linkType/linkMo/linkPc) 대응', () => {
  const o = JSON.parse(convertButtonsToQTmsg([{ name: '주문조회', linkType: 'WL', linkMo: 'http://mo', linkPc: 'http://pc' }])!);
  assert.strictEqual(o.name1, '주문조회');
  assert.strictEqual(o.type1, '2');       // linkType WL → 2
  assert.strictEqual(o.url1_1, 'http://mo');  // linkMo
  assert.strictEqual(o.url1_2, 'http://pc');  // linkPc
});
ok('IMC 봇키워드(BK) linkType 매핑', () => {
  const o = JSON.parse(convertButtonsToQTmsg([{ name: '문의', linkType: 'BK' }])!);
  assert.strictEqual(o.type1, '4');
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
