// dm-render-primitives.verify.ts — 토큰 기반 SSR 프리미티브 순수 검증 (DB import 0)
// 실행: npx ts-node packages/backend/src/utils/__tests__/dm-render-primitives.verify.ts
import assert from 'node:assert';
import { dmIcon, dmEventCard, ICON_NAMES } from '../dm/dm-render-primitives';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[dm-render-primitives] dmIcon');
ok('dmIcon은 인라인 SVG(currentColor) 반환, 이모지 아님', () => {
  const svg = dmIcon('gift');
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('currentColor'));
  assert.ok(!/\p{Emoji_Presentation}/u.test(svg));
});
ok('알 수 없는 아이콘은 빈 문자열(깨진 출력 0)', () =>
  assert.strictEqual(dmIcon('___none___' as any), ''));

console.log('[dm-render-primitives] dmEventCard');
ok('dmEventCard는 토큰 변수만(하드코딩 hex 0)', () => {
  const html = dmEventCard({ accentVar: '--dm-accent', body: '<div>x</div>' });
  assert.ok(html.includes('var(--dm-'));
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(html));
});
ok('dmEventCard body를 그대로 품고 icon 지정 시 svg 포함', () => {
  const html = dmEventCard({ accentVar: '--dm-accent', body: '<p>본문</p>', icon: 'gift' });
  assert.ok(html.includes('<p>본문</p>'));
  assert.ok(html.includes('<svg'));
});

console.log('[dm-render-primitives] ICON_NAMES');
ok('이벤트/인터랙션 핵심 아이콘 포함', () =>
  ['gift', 'wheel', 'ticket', 'clock', 'poll', 'mail', 'star', 'image'].forEach((n) =>
    assert.ok((ICON_NAMES as readonly string[]).includes(n), `${n} 누락`)));

console.log(`\n${passed} assertions passed`);
