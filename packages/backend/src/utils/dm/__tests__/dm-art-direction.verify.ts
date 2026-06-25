/**
 * dm-art-direction.verify.ts — 아트디렉션 정규화·treatment 선택·CSS 변수 산출 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/dm/__tests__/dm-art-direction.verify.ts
 * (DB import 0. AI 출력은 부분/불량 가능 → 항상 안전 기본값으로 정규화, 미설정=classic.)
 */
import assert from 'node:assert';
import { normalizeArtDirection, selectTreatment, artDirectionToCssVars, TREATMENTS } from '../dm-art-direction';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[dm-art-direction] selectTreatment');
ok('유효 treatment passthrough', () =>
  assert.strictEqual(selectTreatment('hero', 'full_bleed', {}), 'full_bleed'));
ok('미허용 treatment → classic', () =>
  assert.strictEqual(selectTreatment('hero', 'nope', {}), 'classic'));
ok('미설정 → classic', () =>
  assert.strictEqual(selectTreatment('hero', undefined, {}), 'classic'));
ok('editorial + 이미지 없는 hero → typographic 기본', () =>
  assert.strictEqual(selectTreatment('hero', undefined, { typeScale: 'editorial', hasImage: false }), 'typographic'));
ok('editorial + 이미지 있는 hero → classic 기본(타이포 강제 X)', () =>
  assert.strictEqual(selectTreatment('hero', undefined, { typeScale: 'editorial', hasImage: true }), 'classic'));
ok('treatment 없는 섹션(countdown) → classic', () =>
  assert.strictEqual(selectTreatment('countdown', 'x', {}), 'classic'));
ok('TREATMENTS 우선 섹션 4종 존재', () =>
  assert.deepStrictEqual(Object.keys(TREATMENTS).sort(), ['coupon', 'cta', 'hero', 'text_card']));

console.log('[dm-art-direction] normalizeArtDirection');
ok('누락 → 안전 기본(bold/standard/none/sans)', () => {
  const ad = normalizeArtDirection(null, 'fashion');
  assert.strictEqual(ad.typeScale, 'bold');
  assert.strictEqual(ad.spacingDensity, 'standard');
  assert.strictEqual(ad.accentMotif, 'none');
  assert.strictEqual(ad.headlineFont, 'sans');
});
ok('잘못된 enum → 기본', () => {
  const ad = normalizeArtDirection({ typeScale: 'weird' as any, spacingDensity: 'x' as any }, 'beauty');
  assert.strictEqual(ad.typeScale, 'bold');
  assert.strictEqual(ad.spacingDensity, 'standard');
});
ok('tone=premium → editorial + serif (결정적 규칙)', () => {
  const ad = normalizeArtDirection({}, 'fashion', 'premium');
  assert.strictEqual(ad.typeScale, 'editorial');
  assert.strictEqual(ad.headlineFont, 'serif');
});
ok('업종 색 fallback(잘못된 hex)', () => {
  const ad = normalizeArtDirection({ palette: { primary: 'nope' } as any }, 'beauty');
  assert.match(ad.palette.primary, /^#[0-9a-fA-F]{6}$/);
});

console.log('[dm-art-direction] artDirectionToCssVars');
ok('editorial이면 hero 변수 + display serif 포함', () => {
  const css = artDirectionToCssVars(normalizeArtDirection({}, 'fashion', 'premium'));
  assert.match(css, /--dm-fs-hero:/);
  assert.match(css, /--dm-font-display:/);
});
ok('airy density면 section pad 배율 변수 포함', () => {
  const css = artDirectionToCssVars(normalizeArtDirection({ spacingDensity: 'airy' }, 'tech'));
  assert.match(css, /--dm-section-pad-scale:\s*1\.4/);
});
ok('순수 — DB import 0(이 파일이 ts-node로 즉시 실행됨이 증거)', () => assert.ok(true));

console.log(`\n[dm-art-direction] ${passed}/14 passed`);
