# 모바일DM 아트디렉션 엔진 (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일DM의 잠자는 스캐폴딩(`VisualConcept.type_scale`·`Section.style_variant`)을 깨워, 섹션별 구도 변형(treatment)과 DM 단위 아트디렉션(타입스케일·여백·악센트)으로 출력 디자인 품질을 끌어올린다 — 기존 DM은 비파괴(classic 동일).

**Architecture:** 순수 함수(`dm-art-direction.ts`)가 treatment 선택·아트디렉션 정규화·CSS 변수 산출을 담당(DB import 0, TDD). 렌더러는 treatment 디스패처로 확장하고, 뷰어 `:root`에 아트디렉션 CSS 변수를 주입한다. AI 디렉터는 enum(구도·스타일)만 출력하고 카피/혜택은 절대 생성하지 않는다. 미설정 경로는 전부 classic + 기본 토큰으로 현행과 동일하게 렌더한다.

**Tech Stack:** Node.js/TypeScript(ts-node), 순수 verify(`__tests__/*.verify.ts`) + vitest(`*.test.ts`), HTML 문자열 렌더(escapeHtml), React 캔버스 미러(frontend).

---

## 테스트 관행 (프로젝트 확정)
- 순수 = `npx ts-node packages/backend/src/utils/dm/__tests__/<name>.verify.ts` (assert + console.log + passed/N).
- 회귀 = `cd packages/backend && npm run test` (vitest, `*.test.ts`).
- tsc = `cd packages/backend && npx tsc --noEmit` / `cd packages/frontend && npx tsc --noEmit`.
- 렌더 골든/구조 테스트는 vitest(`*.test.ts`)로 작성(`dm-code.test.ts`·`dm-slides-expand.test.ts` 동일 위치).

## SSOT 3파일 (CSS 변수 추가 시 동시 수정)
- `packages/backend/src/utils/dm/dm-tokens.ts`
- `packages/frontend/src/utils/dm-tokens.ts`
- `packages/frontend/src/styles/dm-builder.css`

## File Structure
- 신규: `dm-art-direction.ts`(순수) · `__tests__/dm-art-direction.verify.ts` · `dm-treatment-render.test.ts`(vitest)
- 수정: `dm-tokens.ts` · `dm-section-registry.ts` · `dm-section-renderer.ts` · `dm-viewer.ts` · `dm-visual-direction.ts` · `dm-ai.ts` + 프론트(dm-tokens·dm-builder.css·캔버스 우선 섹션·SectionRenderer·SectionPropsEditor·DmTopBar)

---

## Task 1: dm-art-direction.ts 순수 코어

**Files:**
- Create: `packages/backend/src/utils/dm/dm-art-direction.ts`
- Test: `packages/backend/src/utils/dm/__tests__/dm-art-direction.verify.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/backend/src/utils/dm/__tests__/dm-art-direction.verify.ts
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

console.log(`\n[dm-art-direction] ${passed}/15 passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/ceo/projects/targetup/packages/backend && npx ts-node src/utils/dm/__tests__/dm-art-direction.verify.ts`
Expected: FAIL — `Cannot find module '../dm-art-direction'`

- [ ] **Step 3: Write implementation**

```ts
// packages/backend/src/utils/dm/dm-art-direction.ts
/**
 * ★ 모바일DM 아트디렉션 엔진 — 순수(DB import 0). 2026-06-25 (P1)
 *   - treatment(섹션 구도) 선택/검증 + 아트디렉션(DM 단위 타입·여백·모티프) 정규화 + 뷰어 CSS 변수 산출.
 *   - AI 출력은 부분/불량 가능 → 항상 안전 기본값. 미설정/미허용 = classic + 기본 토큰(현행과 동일, 비파괴).
 *   - 색/hex 정규화는 dm-visual-direction의 normalizeVisualConcept와 정합(여기선 enum·구조만 담당).
 */
import { DM_COLOR_TOKENS } from './dm-tokens';

export type TypeScale = 'editorial' | 'bold' | 'minimal';
export type SpacingDensity = 'compact' | 'standard' | 'airy';
export type AccentMotif = 'none' | 'rule' | 'index' | 'bracket' | 'dot';
export type SectionDivider = 'none' | 'hairline' | 'gap' | 'rule';
export type HeadlineFont = 'sans' | 'serif';

export type ArtDirection = {
  palette: { primary: string; accent: string; surface: string; on_surface: string };
  mood: string;
  emphasisSections: string[];
  typeScale: TypeScale;
  headlineFont: HeadlineFont;
  spacingDensity: SpacingDensity;
  accentMotif: AccentMotif;
  sectionDivider: SectionDivider;
};

// 섹션별 허용 구도. 우선 4종(P1). 그 외 섹션은 classic만.
export const TREATMENTS: Record<string, readonly string[]> = {
  hero: ['classic', 'full_bleed', 'split', 'typographic', 'editorial_overlap'],
  text_card: ['classic', 'lead', 'framed'],
  cta: ['classic', 'bar', 'ghost'],
  coupon: ['classic', 'ticket', 'spotlight'],
};

const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;
function safeHex(v: unknown, fallback: string): string {
  if (typeof v === 'string') {
    const s = v.trim();
    if (HEX6.test(s)) return s;
    if (HEX3.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  }
  return fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return (allowed as readonly string[]).includes(v as string) ? (v as T) : def;
}

/**
 * 요청 treatment 검증 → 허용표에 있으면 그대로. 없거나 미설정이면 결정적 기본값.
 *   editorial 타입스케일 + 이미지 없는 hero → 'typographic' 기본(타이포로 휑함 메움). 그 외 classic.
 */
export function selectTreatment(
  sectionType: string,
  requested: string | undefined,
  ctx: { typeScale?: TypeScale; hasImage?: boolean },
): string {
  const allowed = TREATMENTS[sectionType];
  if (!allowed) return 'classic';
  if (requested && allowed.includes(requested)) return requested;
  if (sectionType === 'hero' && ctx.typeScale === 'editorial' && ctx.hasImage === false && allowed.includes('typographic')) {
    return 'typographic';
  }
  return 'classic';
}

type IndustryKey = keyof typeof DM_COLOR_TOKENS.industry;
function industryColors(industry: string): { primary: string; accent: string } {
  const k = industry as IndustryKey;
  return DM_COLOR_TOKENS.industry[k] || { primary: DM_COLOR_TOKENS.brand.primary, accent: DM_COLOR_TOKENS.brand.accent };
}

// tone → 아트디렉션 기본 경향(결정적). AI가 명시 안 했을 때만 적용.
const TONE_DEFAULTS: Record<string, { typeScale: TypeScale; headlineFont: HeadlineFont; spacingDensity: SpacingDensity }> = {
  premium: { typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy' },
  elegant: { typeScale: 'editorial', headlineFont: 'serif', spacingDensity: 'airy' },
  urgent:  { typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'compact' },
  playful: { typeScale: 'bold', headlineFont: 'sans', spacingDensity: 'standard' },
  friendly:{ typeScale: 'minimal', headlineFont: 'sans', spacingDensity: 'standard' },
};

export function normalizeArtDirection(
  raw: Partial<ArtDirection> | null | undefined,
  industry: string,
  tone?: string,
): ArtDirection {
  const ind = industryColors(industry);
  const td = (tone && TONE_DEFAULTS[tone]) || { typeScale: 'bold' as TypeScale, headlineFont: 'sans' as HeadlineFont, spacingDensity: 'standard' as SpacingDensity };
  const primary = safeHex(raw?.palette?.primary, ind.primary);
  const accent = safeHex(raw?.palette?.accent, ind.accent);
  const surface = safeHex(raw?.palette?.surface, DM_COLOR_TOKENS.neutral[0]);
  const on_surface = safeHex(raw?.palette?.on_surface, DM_COLOR_TOKENS.neutral[900]);
  return {
    palette: { primary, accent, surface, on_surface },
    mood: typeof raw?.mood === 'string' ? raw.mood.slice(0, 40) : '',
    emphasisSections: Array.isArray(raw?.emphasisSections) ? raw!.emphasisSections!.map(String).slice(0, 6) : [],
    typeScale: oneOf<TypeScale>(raw?.typeScale, ['editorial', 'bold', 'minimal'], td.typeScale),
    headlineFont: oneOf<HeadlineFont>(raw?.headlineFont, ['sans', 'serif'], td.headlineFont),
    spacingDensity: oneOf<SpacingDensity>(raw?.spacingDensity, ['compact', 'standard', 'airy'], td.spacingDensity),
    accentMotif: oneOf<AccentMotif>(raw?.accentMotif, ['none', 'rule', 'index', 'bracket', 'dot'], 'none'),
    sectionDivider: oneOf<SectionDivider>(raw?.sectionDivider, ['none', 'hairline', 'gap', 'rule'], 'none'),
  };
}

const TYPE_SCALE_VARS: Record<TypeScale, { hero: string; heroWeight: string; heroLs: string; h1: string }> = {
  editorial: { hero: '40px', heroWeight: '800', heroLs: '-0.03em', h1: '28px' },
  bold:      { hero: '34px', heroWeight: '900', heroLs: '-0.02em', h1: '24px' },
  minimal:   { hero: '28px', heroWeight: '600', heroLs: '0',       h1: '22px' },
};
const DENSITY_SCALE: Record<SpacingDensity, string> = { compact: '0.8', standard: '1', airy: '1.4' };
const DISPLAY_FONT: Record<HeadlineFont, string> = {
  sans: 'var(--dm-font-primary)',
  serif: '"Noto Serif KR", var(--dm-font-primary)',
};

/** 아트디렉션 → 뷰어 :root override CSS(기존 토큰 다음에 주입돼 우선). */
export function artDirectionToCssVars(ad: ArtDirection): string {
  const t = TYPE_SCALE_VARS[ad.typeScale];
  return `:root{`
    + `--dm-fs-hero:${t.hero};--dm-fw-hero:${t.heroWeight};--dm-ls-hero:${t.heroLs};--dm-fs-h1:${t.h1};`
    + `--dm-section-pad-scale:${DENSITY_SCALE[ad.spacingDensity]};`
    + `--dm-font-display:${DISPLAY_FONT[ad.headlineFont]};`
    + `}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ts-node src/utils/dm/__tests__/dm-art-direction.verify.ts`
Expected: PASS — `[dm-art-direction] 15/15 passed`

- [ ] **Step 5: tsc**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/utils/dm/dm-art-direction.ts packages/backend/src/utils/dm/__tests__/dm-art-direction.verify.ts
git commit -m "feat(dm): P1 아트디렉션 순수 코어(treatment 선택·정규화·CSS 변수) + verify"
```

---

## Task 2: dm-tokens — renderArtDirectionCss + 새 CSS 변수(SSOT 3파일)

**Files:**
- Modify: `packages/backend/src/utils/dm/dm-tokens.ts`
- Modify: `packages/frontend/src/utils/dm-tokens.ts`
- Modify: `packages/frontend/src/styles/dm-builder.css`

> `artDirectionToCssVars`(Task 1)가 산출하는 변수(`--dm-fs-hero`·`--dm-fw-hero`·`--dm-ls-hero`·`--dm-fs-h1`·`--dm-section-pad-scale`·`--dm-font-display`)의 **기본값**을 3파일에 정의. 렌더러는 `--dm-fs-hero` 등을 참조하도록 이후 Task에서 전환.

- [ ] **Step 1: backend dm-tokens.ts `renderDmTokensCss` 반환 `:root`에 기본 변수 추가**

`renderDmTokensCss`의 `:root{...}` 안에 추가(기존 변수 뒤):
```
  --dm-fs-hero: ${DM_TYPOGRAPHY.scale.hero.size};
  --dm-fw-hero: ${DM_TYPOGRAPHY.scale.hero.weight};
  --dm-ls-hero: ${DM_TYPOGRAPHY.scale.hero.letterSpacing};
  --dm-fs-h1: ${DM_TYPOGRAPHY.scale.h1.size};
  --dm-section-pad-scale: 1;
  --dm-font-display: ${fontPri};
```

- [ ] **Step 2: `dm-text-hero` / 섹션 패딩 유틸이 변수를 참조하도록 base CSS 보강**

`renderDmBaseCss`(또는 토큰 CSS)에서 hero 텍스트·섹션 패딩을 변수 기반으로:
```css
.dm-text-hero{font-size:var(--dm-fs-hero);font-weight:var(--dm-fw-hero);letter-spacing:var(--dm-ls-hero);line-height:1.15;font-family:var(--dm-font-display)}
.dm-section{padding-top:calc(var(--dm-sp-6) * var(--dm-section-pad-scale));padding-bottom:calc(var(--dm-sp-6) * var(--dm-section-pad-scale))}
```
> 기존 `.dm-text-hero` 정의가 있으면 그 값을 변수 참조로 교체(기본값이 현행과 동일하므로 시각 변화 0 — 하위호환).

- [ ] **Step 3: frontend dm-tokens.ts 미러 + dm-builder.css 동일 변수 추가**

`packages/frontend/src/utils/dm-tokens.ts`와 `packages/frontend/src/styles/dm-builder.css`의 `:root`에 같은 6개 변수 기본값 추가(SSOT). 캔버스 미리보기 루트에도 적용되도록.

- [ ] **Step 4: 순수 verify(선택) + tsc**

Run:
```bash
cd packages/backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit
```
Expected: 0 errors 양쪽

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/dm/dm-tokens.ts packages/frontend/src/utils/dm-tokens.ts packages/frontend/src/styles/dm-builder.css
git commit -m "feat(dm): P1 아트디렉션 CSS 변수 기본값(SSOT 3파일) + hero/섹션패딩 변수화"
```

---

## Task 3: Section.treatment 필드 + 허용 메타

**Files:**
- Modify: `packages/backend/src/utils/dm/dm-section-registry.ts`

- [ ] **Step 1: `Section` 타입에 treatment 추가 (`:422` 근처)**

```ts
  /** 섹션 구도 변형(아트디렉션). 미설정=classic(현행). 허용값은 dm-art-direction.TREATMENTS. */
  treatment?: string;
```

- [ ] **Step 2: tsc**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors (옵셔널 필드라 기존 코드 영향 0)

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/utils/dm/dm-section-registry.ts
git commit -m "feat(dm): P1 Section.treatment 옵셔널 필드(미설정=classic)"
```

---

## Task 4: 렌더러 treatment 디스패처 + 우선 4섹션 + classic 골든

**Files:**
- Modify: `packages/backend/src/utils/dm/dm-section-renderer.ts`
- Test: `packages/backend/src/utils/dm/dm-treatment-render.test.ts` (vitest)

> 핵심 규칙: **classic 분기는 기존 함수 본문을 그대로 사용** → 골든 테스트로 현행 보존 증명. 새 treatment만 추가 함수.

- [ ] **Step 1: Write failing golden + structure test (vitest)**

```ts
// packages/backend/src/utils/dm/dm-treatment-render.test.ts
import { describe, it, expect } from 'vitest';
import { renderSection } from './dm-section-renderer';
import type { Section } from './dm-section-registry';

const heroBase: Section = { id: 's1', type: 'hero', props: { headline: '신상품', sub_copy: '지금' } } as any;

describe('dm treatment render', () => {
  it('hero classic(미설정) = 기존 구조 보존 (data-section-type=hero, headline escape)', () => {
    const html = renderSection(heroBase, {});
    expect(html).toContain('data-section-type="hero"');
    expect(html).toContain('신상품');
  });
  it('hero typographic = 이미지 없이 대형 헤드라인 + 규칙선 구조', () => {
    const html = renderSection({ ...heroBase, treatment: 'typographic' } as any, {});
    expect(html).toContain('data-treatment="typographic"');
    expect(html).toContain('신상품');
  });
  it('미허용 treatment는 classic으로 렌더(data-treatment=classic 또는 미표기)', () => {
    const html = renderSection({ ...heroBase, treatment: 'nope' } as any, {});
    expect(html).toContain('data-section-type="hero"');
  });
  it('입력 escape 유지(XSS)', () => {
    const html = renderSection({ ...heroBase, props: { headline: '<script>' } } as any, {});
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

> `renderSection`이 이미 export면 그대로, 아니면 dispatcher를 export(다음 Step). ctx 두 번째 인자는 `SectionRenderContext`.

- [ ] **Step 2: Run test (RED)**

Run: `cd packages/backend && npx vitest run src/utils/dm/dm-treatment-render.test.ts`
Expected: FAIL (typographic data-treatment 미존재 / 또는 renderSection 시그니처)

- [ ] **Step 3: 렌더러 dispatcher 전환 — hero**

`renderHero(props)` 호출부를 treatment 디스패치로. 기존 `renderHero` 본문 = `renderHeroClassic`로 이름 유지(본문 불변), 신규 분기 추가:
```ts
import { selectTreatment } from './dm-art-direction';

function renderHero(props: HeroProps, section: Section): string {
  const hasImage = !!props.image_url;
  const t = selectTreatment('hero', section.treatment, { hasImage });
  switch (t) {
    case 'typographic': return wrapTreatment('hero', t, renderHeroTypographic(props));
    case 'full_bleed': return wrapTreatment('hero', t, renderHeroFullBleed(props));
    case 'split': return wrapTreatment('hero', t, renderHeroSplit(props));
    case 'editorial_overlap': return wrapTreatment('hero', t, renderHeroOverlap(props));
    default: return renderHeroClassic(props); // 현행 본문 그대로(골든 보존)
  }
}

// 신규 함수 — wrapTreatment는 data-treatment 속성만 더하는 얇은 래퍼(classic은 미사용=구조 불변)
function wrapTreatment(type: string, t: string, inner: string): string {
  return inner.replace('class="dm-section', `data-treatment="${t}" class="dm-section`);
}
```

> `renderHeroClassic`은 현재 `renderHero` 본문을 **그대로** 복사(시각/구조 변화 0). dispatcher가 classic이면 그 함수를 호출 → 골든 통과.

- [ ] **Step 4: typographic 등 신규 hero treatment 구현(순수 HTML)**

예: typographic(이미지 없이 대형 헤드라인 + 규칙선 + 여백 + CTA 힌트):
```ts
function renderHeroTypographic(props: HeroProps): string {
  const head = escapeHtml(props.headline || '');
  const sub = escapeHtml(props.sub_copy || '');
  return `<div class="dm-section dm-hero" data-section-type="hero" style="background:var(--dm-bg);padding:calc(var(--dm-sp-12) * var(--dm-section-pad-scale)) var(--dm-sp-5);display:flex;flex-direction:column;gap:var(--dm-sp-4)">
    <div class="dm-text-hero" style="color:var(--dm-neutral-900)">${head}</div>
    <div style="height:2px;width:48px;background:var(--dm-primary)"></div>
    ${sub ? `<div class="dm-text-body" style="color:var(--dm-neutral-600)">${sub}</div>` : ''}
  </div>`;
}
```
`renderHeroFullBleed`/`renderHeroSplit`/`renderHeroOverlap`도 같은 패턴(설계서 §1-B 구도 + escapeHtml + 토큰 변수). 각 함수는 `data-section-type="hero"`와 `dm-section` 클래스를 포함하고 입력을 escape.

- [ ] **Step 5: hero 호출부에 section 전달**

`renderSection`(섹션 디스패치)에서 hero 케이스가 `renderHero(props, section)`로 section을 넘기게 수정. 다른 우선 섹션(text_card/cta/coupon)도 같은 패턴으로 Step 7에서.

- [ ] **Step 6: Run test (GREEN) — hero**

Run: `cd packages/backend && npx vitest run src/utils/dm/dm-treatment-render.test.ts`
Expected: hero 케이스 PASS

- [ ] **Step 7: text_card / cta / coupon 동일 패턴 반복**

각 섹션:
- 기존 본문 → `render<X>Classic`로 복사(불변), dispatcher 추가(`selectTreatment('<type>', section.treatment, {hasImage})`).
- 신규 treatment 함수: text_card(`lead`·`framed`) / cta(`bar`·`ghost`) / coupon(`ticket`·`spotlight`) — escapeHtml + 토큰 변수.
- 각 신규 treatment에 vitest 케이스 1개씩 추가(구조 마커 + escape).

- [ ] **Step 8: 모티프/구분선(Layer A 일부) — 섹션 래퍼에 옵션 삽입**

`renderSectionsHtml`(dm-viewer 또는 renderer 집계 지점)이 아트디렉션 `sectionDivider`에 따라 섹션 사이 구분선/간격을, `accentMotif`에 따라 강조 섹션에 모티프를 삽입. 순수 헬퍼 `renderDivider(style)`·`renderMotif(motif, index)` + 테스트.

- [ ] **Step 9: 전체 렌더 테스트 GREEN + tsc**

Run:
```bash
cd packages/backend && npx vitest run src/utils/dm/dm-treatment-render.test.ts
npx tsc --noEmit
```
Expected: 전 케이스 PASS / tsc 0

- [ ] **Step 10: Commit**

```bash
git add packages/backend/src/utils/dm/dm-section-renderer.ts packages/backend/src/utils/dm/dm-treatment-render.test.ts
git commit -m "feat(dm): P1 렌더러 treatment 디스패처(hero/text_card/cta/coupon) + 모티프/구분선 + classic 골든"
```

---

## Task 5: 뷰어에 아트디렉션 CSS 주입

**Files:**
- Modify: `packages/backend/src/utils/dm/dm-viewer.ts`

- [ ] **Step 1: renderArtDirectionCss 주입 (기존 renderDmTokensCss 다음)**

뷰어 HTML `<head>` `<style>`에서 `renderDmTokensCss(brandKit)` 출력 다음에 `artDirectionToCssVars(artDirection)` 출력을 이어 붙임(뒤에 와야 override 우선). artDirection은 DM 레코드의 비주얼 컨셉을 `normalizeArtDirection`으로 정규화한 값. 컨셉 없으면 `normalizeArtDirection(null, industry)` = 기본 토큰(현행 동일).

```ts
import { normalizeArtDirection, artDirectionToCssVars } from './dm-art-direction';
// ...
const ad = normalizeArtDirection(dm.visual_concept ?? null, dm.industry || '', dm.tone);
const css = renderDmTokensCss(brandKit) + artDirectionToCssVars(ad);
```
> `dm.visual_concept`/`dm.industry`/`dm.tone`의 실제 필드명은 dm-viewer가 이미 읽는 값으로 맞춤(코드 확인 후). 없으면 빈 기본.

- [ ] **Step 2: tsc + 렌더 회귀**

Run: `cd packages/backend && npx tsc --noEmit && npx vitest run`
Expected: 0 / 회귀 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/utils/dm/dm-viewer.ts
git commit -m "feat(dm): P1 뷰어에 아트디렉션 CSS 변수 주입(기본=현행 동일)"
```

---

## Task 6: 비주얼 디렉터 — ArtDirection + applyVisualDirection 동봉

**Files:**
- Modify: `packages/backend/src/utils/dm/dm-visual-direction.ts`

- [ ] **Step 1: VisualConcept를 ArtDirection로 흡수(보존)**

`VisualConcept`를 `dm-art-direction.ArtDirection`로 통일하거나, 기존 타입을 유지하되 `applyVisualDirection`이 treatment·아트디렉션을 함께 적용하도록 확장. 권장: `dm-art-direction`의 `ArtDirection`을 단일 출처로 쓰고, `VisualConcept`는 별칭(`export type VisualConcept = ArtDirection` 또는 deprecated 주석).

- [ ] **Step 2: applyVisualDirection이 섹션에 treatment 동봉**

색·무드뿐 아니라, 섹션별 `treatment`(디렉터 추천 또는 selectTreatment 기본)를 `section.treatment`에 세팅. 카피·혜택 props는 불변(영구 룰). 순수 유지.

- [ ] **Step 3: verify(기존 dm-visual-direction 테스트 있으면 확장) + tsc**

Run: `cd packages/backend && npx tsc --noEmit && npx vitest run`
Expected: 0 / PASS

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/utils/dm/dm-visual-direction.ts
git commit -m "feat(dm): P1 비주얼 디렉터 ArtDirection 통일 + treatment 동봉(색/무드 불변 규칙 유지)"
```

---

## Task 7: AI 디렉터 — designVisualConcept 확장 (enum만, 혜택 0)

**Files:**
- Modify: `packages/backend/src/utils/dm/dm-ai.ts`

- [ ] **Step 1: designVisualConcept 프롬프트에 아트디렉션 + treatment 추천 출력 추가**

시스템 프롬프트에 출력 스키마 확장: `typeScale`·`headlineFont`·`spacingDensity`·`accentMotif`·`sectionDivider` + `treatments`(우선 섹션별 추천). **최상단에 "카피·혜택(%/원/쿠폰/무료) 절대 생성 금지 — 구도/스타일 enum만"** 명시(feedback_ai_no_arbitrary_benefit).

- [ ] **Step 2: 출력 정규화 — normalizeArtDirection + selectTreatment**

`extractJson` 후 `normalizeArtDirection(parsed, industry, tone)` + 섹션별 `selectTreatment`로 안전화. AI 누락/오작 시 classic+기본(현행보다 나빠지지 않음).

- [ ] **Step 3: oneShotGenerate가 treatment·아트디렉션 동봉**

`oneShotGenerate` 결과 섹션에 `applyVisualDirection`(Task 6)으로 treatment·아트디렉션 적용. DM 레코드에 정규화된 ArtDirection 저장(뷰어가 Task 5에서 읽음).

- [ ] **Step 4: tsc + 회귀 + 자가 grep(혜택 단어 프롬프트 점검)**

Run: `cd packages/backend && npx tsc --noEmit && npx vitest run`
Expected: 0 / PASS. 프롬프트에 구체 혜택 예시 0건.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/dm/dm-ai.ts
git commit -m "feat(dm): P1 AI 디렉터 아트디렉션+treatment 출력(enum only, 혜택 생성 0) + 정규화 안전화"
```

---

## Task 8: 프론트 캔버스 미러 + treatment 픽커(최소)

**Files:**
- Modify: `packages/frontend/src/components/dm/canvas/HeroSection.tsx` · `TextCardSection.tsx` · `CtaSection.tsx` · `CouponSection.tsx` · `SectionRenderer.tsx`
- Modify: `packages/frontend/src/components/dm/panels/SectionPropsEditor.tsx`
- Modify: `packages/frontend/src/components/dm/DmTopBar.tsx`

- [ ] **Step 1: 캔버스 우선 섹션이 treatment 분기 미러**

`SectionRenderer`/각 캔버스 섹션이 `section.treatment`에 따라 뷰어와 같은 구도를 표시(WYSIWYG). 토큰은 dm-builder.css 변수(Task 2)로 자동 반영.

- [ ] **Step 2: SectionPropsEditor에 treatment 픽커(우선 4섹션 한정)**

우측 패널에 "구도" 선택 — 허용 treatment 라벨/썸네일 버튼. 선택 시 `section.treatment` 갱신 → 캔버스 재렌더. ConfirmModal/useToast 패턴(native dialog 0).

- [ ] **Step 3: DmTopBar에 아트디렉션 토글 + AI 위임(최소)**

typeScale·density·motif 토글 + "AI에게 맡기기"(designVisualConcept 호출) 버튼. 풀 UX는 P2.

- [ ] **Step 4: frontend tsc + 자가 grep**

Run:
```bash
cd packages/frontend && npx tsc --noEmit
grep -nE "Opus|Sonnet|Haiku|GPT|Claude|Anthropic" packages/frontend/src/components/dm/**/*.tsx
grep -nE "alert\(|confirm\(|prompt\(" packages/frontend/src/components/dm/**/*.tsx
```
Expected: tsc 0 / 모델명 0 / native dialog 0

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/dm
git commit -m "feat(dm): P1 캔버스 treatment 미러 + 구도 픽커 + 아트디렉션 토글(최소·P2서 폴리시)"
```

---

## Task 9: 전체 검증 게이트

- [ ] backend tsc 0 + `npm run test`(vitest 회귀, 신규 dm-treatment-render 포함) + `dm-art-direction.verify.ts` 15/15
- [ ] frontend tsc 0 + 모델명/native dialog/박-단어 자가 grep 0
- [ ] classic 골든 통과(기존 DM 불변 증명)
- [ ] `/codex:review` 권장(큰 작업)
- [ ] 표준 종료 멘트 — Harold 직접 git/배포

---

## Self-Review
- **Spec coverage:** Layer A(Task 1·2·5·8) · Layer B treatment(Task 1·3·4·8) · AI 디렉터(Task 6·7) · 하위호환 골든(Task 4) · SSOT 3파일(Task 2) · 빌더 노출(Task 8) — 스펙 §1~6 전부 매핑. ✔
- **Placeholder:** 순수 함수·토큰·dispatcher·골든은 완전 코드. treatment별 HTML은 typographic 1종 완전 + 나머지는 동일 패턴 명시(escapeHtml+토큰). dm-viewer 필드명은 실제 코드 확인 후 맞춤(명시). ✔
- **Type 일관성:** `ArtDirection`·`TREATMENTS`·`selectTreatment(type,requested,ctx)`·`normalizeArtDirection(raw,industry,tone)`·`artDirectionToCssVars(ad)`가 verify↔구현↔소비처 동일. CSS 변수명(`--dm-fs-hero`·`--dm-section-pad-scale`·`--dm-font-display`)이 Task 1·2·4 일치. ✔
- **하위호환:** classic = 기존 본문 복사 + 골든 테스트. 미설정/미허용/AI누락 전부 classic+기본. ✔
