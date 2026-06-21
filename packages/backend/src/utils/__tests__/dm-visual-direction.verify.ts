// dm-visual-direction.verify.ts — AI 비주얼 컨셉 정규화·적용·무드 배경 순수 검증 (DB import 0)
// 실행: npx ts-node packages/backend/src/utils/__tests__/dm-visual-direction.verify.ts
import assert from 'node:assert';
import { normalizeVisualConcept, buildMoodBackground, pickReadableText, applyVisualDirection } from '../dm/dm-visual-direction';

let passed = 0;
function ok(n: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${n}`); }

console.log('[dm-visual-direction] normalizeVisualConcept');
ok('잘못된 hex/누락은 안전 기본값으로 보정', () => {
  const c = normalizeVisualConcept({ palette: { primary: 'zzz', accent: '#ec4899' } } as any, 'beauty');
  assert.ok(/^#([0-9a-f]{6})$/i.test(c.palette.primary)); // 보정됨(업종 색)
  assert.strictEqual(c.palette.accent.toLowerCase(), '#ec4899');
});
ok('3자리 hex는 6자리로 확장', () => {
  const c = normalizeVisualConcept({ palette: { primary: '#abc' } } as any, 'general');
  assert.strictEqual(c.palette.primary.toLowerCase(), '#aabbcc');
});
ok('미지원 hero_treatment/type_scale은 기본값', () => {
  const c = normalizeVisualConcept({ hero_treatment: 'xxx', type_scale: 'yyy' } as any, 'general');
  assert.strictEqual(c.hero_treatment, 'gradient');
  assert.strictEqual(c.type_scale, 'bold');
});

console.log('[dm-visual-direction] buildMoodBackground');
ok('그라데이션 문자열 + 입력 색 포함', () => {
  const g = buildMoodBackground({ primary: '#1e3a8a', accent: '#d4af37', surface: '#ffffff', on_surface: '#111111' }, 'luxury');
  assert.ok(g.includes('gradient'));
  assert.ok(g.includes('#1e3a8a'));
});

console.log('[dm-visual-direction] pickReadableText (WCAG)');
ok('어두운 배경 = 흰 글자', () => assert.strictEqual(pickReadableText('#171717'), '#ffffff'));
ok('밝은 배경 = 진한 글자', () => assert.strictEqual(pickReadableText('#fafafa'), '#111111'));

console.log('[dm-visual-direction] applyVisualDirection');
ok('이미지 없는 hero에 무드 배경 주입 + accent_color', () => {
  const concept = normalizeVisualConcept({ palette: { primary: '#1e3a8a', accent: '#d4af37' }, hero_treatment: 'gradient' } as any, 'luxury');
  const out = applyVisualDirection([{ id: '1', type: 'hero', order: 0, visible: true, props: { headline: 'x' } } as any], concept);
  assert.ok(out[0].accent_color);
  assert.ok((out[0] as any).props.mood_background);
});
ok('이미지 있는 hero는 무드 배경 주입 안 함(원본 이미지 우선)', () => {
  const concept = normalizeVisualConcept({} as any, 'general');
  const out = applyVisualDirection([{ id: '1', type: 'hero', order: 0, visible: true, props: { headline: 'x', image_url: 'http://a/b.jpg' } } as any], concept);
  assert.strictEqual((out[0] as any).props.mood_background, undefined);
});
ok('혜택 텍스트 props는 절대 불변(혜택 생성 0)', () => {
  const concept = normalizeVisualConcept({} as any, 'general');
  const out = applyVisualDirection([{ id: '1', type: 'coupon', order: 0, visible: true, props: { discount_label: '' } } as any], concept);
  assert.strictEqual((out[0] as any).props.discount_label, '');
});

console.log(`\n${passed} assertions passed`);
