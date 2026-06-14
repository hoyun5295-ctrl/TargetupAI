/**
 * dm-page-split.verify.ts — DM 레이아웃 모드 결정 + 페이지 분할 순수 코어 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/dm-page-split.verify.ts
 */
import assert from 'node:assert';
import { decideLayoutMode, splitSectionsIntoPages } from '../dm/dm-page-split';

// 순수함수는 s.type과 배열 조작만 보므로 최소 객체로 충분 (DB·레지스트리 런타임 의존 0)
const mk = (type: string, order = 0): any => ({ id: `${type}-${order}`, type, order, props: {}, visible: true });
const types = (page: any[]): string[] => page.map((s) => s.type);

let passed = 0;
const ok = (n: string, f: () => void) => {
  f();
  passed++;
  console.log(`  ok - ${n}`);
};

console.log('[decideLayoutMode]');
ok('상품 슬라이드가 있으면 slides', () => {
  assert.strictEqual(decideLayoutMode([mk('header'), mk('product_carousel'), mk('footer')]), 'slides');
});
ok('갤러리가 있으면 slides', () => {
  assert.strictEqual(decideLayoutMode([mk('hero'), mk('gallery')]), 'slides');
});
ok('슬라이드쇼가 있으면 slides', () => {
  assert.strictEqual(decideLayoutMode([mk('slideshow')]), 'slides');
});
ok('시각 카드(상품/갤러리/슬라이드쇼)가 없으면 scroll', () => {
  assert.strictEqual(decideLayoutMode([mk('header'), mk('hero'), mk('coupon'), mk('cta'), mk('footer')]), 'scroll');
});
ok('빈 섹션 = scroll', () => {
  assert.strictEqual(decideLayoutMode([]), 'scroll');
});

console.log('[splitSectionsIntoPages]');
ok('scroll = 전체 한 페이지', () => {
  const pages = splitSectionsIntoPages([mk('header'), mk('hero'), mk('cta'), mk('footer')], 'scroll');
  assert.strictEqual(pages.length, 1);
  assert.strictEqual(pages[0].length, 4);
});
ok('slides = 인트로(header+hero) 1장 + 콘텐츠 각 1장 + footer는 마지막 장에 병합', () => {
  const pages = splitSectionsIntoPages([mk('header'), mk('hero'), mk('product_carousel'), mk('cta'), mk('footer')], 'slides');
  assert.strictEqual(pages.length, 3);
  assert.deepStrictEqual(types(pages[0]), ['header', 'hero']);
  assert.deepStrictEqual(types(pages[1]), ['product_carousel']);
  assert.deepStrictEqual(types(pages[2]), ['cta', 'footer']);
});
ok('slides + footer 없음 = 콘텐츠 각 1장 단독', () => {
  const pages = splitSectionsIntoPages([mk('header'), mk('hero'), mk('gallery'), mk('cta')], 'slides');
  assert.strictEqual(pages.length, 3);
  assert.deepStrictEqual(types(pages[0]), ['header', 'hero']);
  assert.deepStrictEqual(types(pages[2]), ['cta']);
});
ok('slides + 인트로 없이 콘텐츠로 시작', () => {
  const pages = splitSectionsIntoPages([mk('product_carousel'), mk('gallery')], 'slides');
  assert.strictEqual(pages.length, 2);
});
ok('slides 인트로만 = 1장', () => {
  const pages = splitSectionsIntoPages([mk('header'), mk('hero')], 'slides');
  assert.strictEqual(pages.length, 1);
  assert.deepStrictEqual(types(pages[0]), ['header', 'hero']);
});
ok('slides 빈 배열 = 안전(한 페이지)', () => {
  const pages = splitSectionsIntoPages([], 'slides');
  assert.strictEqual(pages.length, 1);
});

console.log(`\npassed ${passed}`);
