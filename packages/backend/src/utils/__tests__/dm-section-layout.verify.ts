// dm-section-layout.verify.ts — AI 섹션 chain 안전 정규화 순수 검증 (DB import 0)
// 실행: npx ts-node packages/backend/src/utils/__tests__/dm-section-layout.verify.ts
import assert from 'node:assert';
import { normalizeSectionChain } from '../dm/dm-section-layout';

let passed = 0;
function ok(n: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${n}`); }

console.log('[dm-section-layout] normalizeSectionChain');
ok('header 없으면 맨 앞에 추가', () => {
  const r = normalizeSectionChain(['hero', 'cta'] as any, 'sale');
  assert.strictEqual(r[0], 'header');
});
ok('footer 없으면 맨 끝에 추가', () => {
  const r = normalizeSectionChain(['header', 'hero', 'cta'] as any, 'sale');
  assert.strictEqual(r[r.length - 1], 'footer');
});
ok('header 여러 개 → 맨 앞 1개로', () => {
  const r = normalizeSectionChain(['header', 'hero', 'header', 'cta'] as any, 'sale');
  assert.strictEqual(r.filter((t) => t === 'header').length, 1);
  assert.strictEqual(r[0], 'header');
});
ok('유효하지 않은 타입 제거', () => {
  const r = normalizeSectionChain(['header', '___bad___', 'hero', 'cta'] as any, 'sale');
  assert.ok(!r.includes('___bad___' as any));
});
ok('maxCount 초과 제거 (hero 최대 2)', () => {
  const r = normalizeSectionChain(['header', 'hero', 'hero', 'hero', 'cta'] as any, 'sale');
  assert.ok(r.filter((t) => t === 'hero').length <= 2);
});
ok('cta 없으면 추가 (최소 전환 보장)', () => {
  const r = normalizeSectionChain(['header', 'hero'] as any, 'sale');
  assert.ok(r.includes('cta'));
});
ok('빈 입력 → 최소 chain(header/콘텐츠/cta/footer)', () => {
  const r = normalizeSectionChain([] as any, 'sale');
  assert.ok(r.includes('header') && r.includes('footer') && r.includes('cta'));
  assert.ok(r.length >= 3);
});
ok('중간 섹션 순서 보존', () => {
  const r = normalizeSectionChain(['header', 'coupon', 'countdown', 'cta', 'footer'] as any, 'sale');
  assert.ok(r.indexOf('coupon') < r.indexOf('countdown'));
});

console.log(`\n${passed} assertions passed`);
