# 모바일DM 퀄리티 Phase 1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, 이 세션 순차 — CLAUDE.md no_parallel_tasks). Steps use checkbox (`- [ ]`).

**Goal:** 신규 16섹션 렌더를 디자인 토큰 기반으로 격상하고, AI가 캠페인별 비주얼 컨셉을 설계해 입혀 "AI가 만들어준" 완성형 DM을 만든다.

**Architecture:** ① 공통 SSR 프리미티브(토큰 기반 카드/아이콘/필드)를 만들어 16섹션이 공유(DRY). ② 순수 함수로 AI 비주얼 컨셉을 섹션에 적용(`applyVisualDirection`) + 이미지 없는 자리에 무드 배경(`buildMoodBackground`). ③ AI 비주얼 디렉터가 컨셉 JSON을 설계 → `oneShotGenerate`에 주입. 순수 함수는 DB-free TDD, 렌더는 HTML 골든 점검, SSOT(backend renderer ↔ frontend 미러) 동시.

**Tech Stack:** TypeScript, ts-node(`*.verify.ts`), `dm-section-renderer.ts`, `dm-ai.ts`, `dm-tokens.ts`(DM_COLOR_TOKENS.industry·DM_SHADOW·getContrastRatio).

**영구 룰:** AI 임의 혜택 X(컨셉은 디자인만, %/원/쿠폰 생성 X) · 모델명 UI 노출 0 · 박-단어 0 · native dialog 0 · 하드코딩 hex 0(토큰만) · SSOT 동시.

---

## 파일 구조

- Create: `packages/backend/src/utils/dm/dm-render-primitives.ts` — 토큰 기반 SSR 빌딩블록(아이콘 SVG·이벤트 카드 셸·필드 행). 순수.
- Create: `packages/backend/src/utils/dm/dm-visual-direction.ts` — `buildMoodBackground`·`applyVisualDirection`·`normalizeVisualConcept`·대비 보정. 순수(DB import 0).
- Create: `packages/backend/src/utils/__tests__/dm-render-primitives.verify.ts`
- Create: `packages/backend/src/utils/__tests__/dm-visual-direction.verify.ts`
- Modify: `packages/backend/src/utils/dm/dm-section-renderer.ts` — 신규 16섹션이 프리미티브 사용, 하드코딩 색·이모지 제거, 무드 배경 적용.
- Modify: `packages/backend/src/utils/dm/dm-ai.ts` — `designVisualConcept` AI 디렉터 + `oneShotGenerate` 주입.
- Modify: `packages/frontend/src/utils/dm-section-defaults.ts` + `packages/frontend/src/styles/dm-builder.css` — 미러/스타일 동기화(편집 미리보기).

---

## Task 1: 공통 SSR 프리미티브 (토큰 기반)

**Files:**
- Create: `packages/backend/src/utils/dm/dm-render-primitives.ts`
- Test: `packages/backend/src/utils/__tests__/dm-render-primitives.verify.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// dm-render-primitives.verify.ts
// 실행: npx ts-node packages/backend/src/utils/__tests__/dm-render-primitives.verify.ts
import assert from 'node:assert';
import { dmIcon, dmEventCard, ICON_NAMES } from '../dm/dm-render-primitives';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

ok('dmIcon은 인라인 SVG(currentColor) 반환, 이모지 아님', () => {
  const svg = dmIcon('gift');
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('currentColor'));
  assert.ok(!/\p{Emoji_Presentation}/u.test(svg));
});
ok('알 수 없는 아이콘은 빈 문자열(깨진 출력 0)', () =>
  assert.strictEqual(dmIcon('___none___' as any), ''));
ok('dmEventCard는 토큰 변수만(하드코딩 hex 0)', () => {
  const html = dmEventCard({ accentVar: '--dm-accent', body: '<div>x</div>' });
  assert.ok(html.includes('var(--dm-'));
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(html));
});
ok('ICON_NAMES에 이벤트/인터랙션 핵심 아이콘 포함', () =>
  ['gift','wheel','ticket','clock','poll','mail','star','image'].forEach(n =>
    assert.ok(ICON_NAMES.includes(n as any), `${n} 누락`)));

console.log(`\n${passed} assertions passed`);
```

- [ ] **Step 2: 실패 확인**

Run: `npx ts-node packages/backend/src/utils/__tests__/dm-render-primitives.verify.ts`
Expected: FAIL — `Cannot find module '../dm/dm-render-primitives'` 또는 TS2307.

- [ ] **Step 3: 최소 구현**

```ts
// dm-render-primitives.ts — 토큰 기반 SSR 빌딩블록(외부 의존 0, 순수)
export const ICON_NAMES = ['gift','wheel','ticket','clock','poll','survey','mail','star','image','map','play','heart'] as const;
export type IconName = typeof ICON_NAMES[number];

// 단색 라인 아이콘(24x24, currentColor). 이모지 대체. 필요한 path만 최소.
const ICON_PATHS: Record<IconName, string> = {
  gift:   '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7C12 7 9 2 6.5 4S8 7 12 7zM12 7c0 0 3-5 5.5-3S16 7 12 7z"/>',
  wheel:  '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  ticket: '<path d="M3 7h18v4a2 2 0 000 4v2H3v-2a2 2 0 000-4z"/><path d="M15 7v10" stroke-dasharray="2 2"/>',
  clock:  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  poll:   '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  survey: '<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4"/>',
  mail:   '<path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/>',
  star:   '<path d="M12 3l2.9 6 6.6.6-5 4.3 1.6 6.5L12 17l-6.1 3.4L7.5 14l-5-4.3 6.6-.6z"/>',
  image:  '<path d="M3 5h18v14H3z"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 17l-6-6-9 9"/>',
  map:    '<path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3-6-3zM9 3v15M15 6v15"/>',
  play:   '<circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3z"/>',
  heart:  '<path d="M12 21C12 21 3 14 3 8a4.5 4.5 0 019-1 4.5 4.5 0 019 1c0 6-9 13-9 13z"/>',
};

export function dmIcon(name: IconName, size = 22): string {
  const p = ICON_PATHS[name];
  if (!p) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/** 이벤트/강조 섹션 공통 셸 — 토큰 그라데이션 + 라운드 + 그림자. accentVar는 CSS 변수명. */
export function dmEventCard(opts: { accentVar: string; body: string; icon?: IconName }): string {
  const icon = opts.icon ? `<div style="color:var(${opts.accentVar});margin-bottom:var(--dm-sp-3)">${dmIcon(opts.icon, 26)}</div>` : '';
  return `<div style="padding:var(--dm-sp-6) var(--dm-sp-5);background:var(--dm-neutral-50);border:1px solid var(--dm-neutral-200);border-radius:var(--dm-radius-xl);box-shadow:var(--dm-shadow-md);margin:var(--dm-sp-3) 0">${icon}${opts.body}</div>`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx ts-node packages/backend/src/utils/__tests__/dm-render-primitives.verify.ts`
Expected: PASS — `4 assertions passed`.

- [ ] **Step 5: 커밋** (Harold 직접 — plan 가이드)

```
git add packages/backend/src/utils/dm/dm-render-primitives.ts packages/backend/src/utils/__tests__/dm-render-primitives.verify.ts
git commit -m "feat(dm): 토큰 기반 SSR 렌더 프리미티브(아이콘·이벤트 카드)"
```

---

## Task 2: 이벤트 4섹션 토큰화 (lucky_draw·roulette·instant_coupon·limited_quantity)

**Files:**
- Modify: `packages/backend/src/utils/dm/dm-section-renderer.ts` (renderLuckyDraw·renderRoulette·renderInstantCoupon·renderLimitedQuantity)

**변경 규칙(전 섹션 공통):**
- import 추가: `import { dmIcon, dmEventCard } from './dm-render-primitives';`
- 큰 이모지(🎁🎡🎟️⏳) → `dmIcon('gift'|'wheel'|'ticket'|'clock')`.
- 하드코딩 색(`#fef3c7`·`#fde68a`·`#d97706`·`#7c3aed`·`#fee2e2`·`#ef4444` 등) → 토큰: 배경 `var(--dm-neutral-50)`, 강조 `var(--dm-accent)`/`var(--dm-primary)`, 경계 `var(--dm-neutral-200)`, 버튼은 `.dm-cta dm-cta-primary` 클래스.
- 박스 셸은 `dmEventCard({accentVar, icon, body})`로 통일(중복 제거).

- [ ] **Step 1: renderLuckyDraw 교체**

```ts
function renderLuckyDraw(p: any): string {
  const fields = Array.isArray(p?.form_fields) ? p.form_fields : [];
  const inputs = fields.map((f: any) => {
    const t = f.name === 'phone' ? 'tel' : f.name === 'email' ? 'email' : 'text';
    const ph = f.name === 'name' ? '이름' : f.name === 'phone' ? '전화번호' : '이메일';
    return `<input type="${t}" data-field="${escapeHtml(f.name)}" placeholder="${ph}" style="padding:12px;border:1px solid var(--dm-neutral-300);border-radius:var(--dm-radius-md);font-size:var(--dm-fs-small);background:var(--dm-bg);margin-bottom:var(--dm-sp-2);display:block;width:100%"/>`;
  }).join('');
  const body = `
    <div style="font-size:var(--dm-fs-h3);font-weight:700;margin-bottom:var(--dm-sp-2)">${escapeHtml(p.title || '[추첨 이벤트 제목]')}</div>
    ${p.description ? `<div style="font-size:var(--dm-fs-small);color:var(--dm-neutral-700);margin-bottom:var(--dm-sp-3);line-height:1.6">${escapeHtml(p.description)}</div>` : ''}
    ${inputs}
    <label style="display:flex;align-items:flex-start;gap:6px;font-size:var(--dm-fs-tiny);color:var(--dm-neutral-600);margin-bottom:var(--dm-sp-3)"><input type="checkbox" data-consent style="margin-top:2px"/><span>${escapeHtml(p.consent_text || '')}</span></label>
    <button data-dm-submit class="dm-cta dm-cta-primary" style="width:100%">응모하기</button>
    ${p.draw_at ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:var(--dm-sp-2);text-align:center">발표: ${escapeHtml(new Date(p.draw_at).toLocaleString('ko-KR'))}</div>` : ''}
    <div data-dm-result style="display:none"></div>`;
  return `<div class="dm-section dm-lucky-draw" data-dm-form>${dmEventCard({ accentVar: '--dm-accent', icon: 'gift', body })}</div>`;
}
```

- [ ] **Step 2: renderRoulette 교체** (휠은 토큰 conic-gradient + 이모지 제거)

```ts
function renderRoulette(p: any): string {
  const segs = Array.isArray(p?.segments) ? p.segments.map((s: any) => ({ id: String(s.id), label: String(s.label || '') })) : [];
  const body = `
    <div style="font-size:var(--dm-fs-h3);font-weight:700;margin-bottom:var(--dm-sp-3)">${escapeHtml(p.title || '룰렛 이벤트')}</div>
    <div data-dm-wheel style="width:200px;height:200px;border-radius:var(--dm-radius-full);background:conic-gradient(var(--dm-primary) 0deg 45deg,var(--dm-primary-light) 45deg 90deg,var(--dm-accent) 90deg 135deg,var(--dm-neutral-100) 135deg 180deg,var(--dm-primary) 180deg 225deg,var(--dm-primary-light) 225deg 270deg,var(--dm-accent) 270deg 315deg,var(--dm-neutral-100) 315deg 360deg);margin:var(--dm-sp-3) auto;border:4px solid var(--dm-bg);box-shadow:var(--dm-shadow-md)"></div>
    <button data-dm-spin class="dm-cta dm-cta-primary">룰렛 돌리기</button>
    ${p.one_spin_per_user ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:var(--dm-sp-2)">1인 1회 한정</div>` : ''}
    <div data-dm-result style="display:none"></div>`;
  return `<div class="dm-section dm-roulette" data-dm-roulette data-segments="${escapeHtml(JSON.stringify(segs))}">${dmEventCard({ accentVar: '--dm-primary', icon: 'wheel', body })}</div>`;
}
```

- [ ] **Step 3: renderInstantCoupon 교체**

```ts
function renderInstantCoupon(p: any): string {
  const body = `
    <div style="font-size:var(--dm-fs-h3);font-weight:700;color:var(--dm-primary);margin-bottom:var(--dm-sp-2)">${escapeHtml(p.coupon_label || '')}</div>
    <div style="font-size:var(--dm-fs-small);color:var(--dm-neutral-700);margin-bottom:var(--dm-sp-3)">${escapeHtml(p.discount_description || '')}</div>
    ${p.expires_at ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-primary);margin-bottom:var(--dm-sp-3);font-weight:600">만료: ${escapeHtml(new Date(p.expires_at).toLocaleString('ko-KR'))}</div>` : ''}
    <button class="dm-cta dm-cta-primary">쿠폰 받기</button>
    ${p.conditions ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:var(--dm-sp-2)">${escapeHtml(p.conditions)}</div>` : ''}
    ${p.usage_instructions ? `<div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-500);margin-top:4px">${escapeHtml(p.usage_instructions)}</div>` : ''}`;
  // 쿠폰은 점선 강조 — dmEventCard 대신 점선 셸(토큰)
  return `<div class="dm-section dm-instant-coupon"><div style="padding:var(--dm-sp-6) var(--dm-sp-5);background:var(--dm-primary-light);border:2px dashed var(--dm-primary);border-radius:var(--dm-radius-xl);margin:var(--dm-sp-3) 0"><div style="color:var(--dm-primary);margin-bottom:var(--dm-sp-3)">${dmIcon('ticket', 26)}</div>${body}</div></div>`;
}
```

- [ ] **Step 4: renderLimitedQuantity 교체**

```ts
function renderLimitedQuantity(p: any): string {
  const remaining = p.current_remaining ?? p.total_quantity ?? 0;
  const total = p.total_quantity || 1;
  const percent = Math.max(0, Math.min(100, (remaining / total) * 100));
  const body = `
    <div style="font-size:var(--dm-fs-h3);font-weight:700;margin-bottom:var(--dm-sp-2)">${escapeHtml(p.title || '[선착순 이벤트 제목]')}</div>
    ${p.description ? `<div style="font-size:var(--dm-fs-small);color:var(--dm-neutral-700);margin-bottom:var(--dm-sp-3);line-height:1.6">${escapeHtml(p.description)}</div>` : ''}
    <div style="margin-bottom:var(--dm-sp-3)">
      <div style="font-size:var(--dm-fs-tiny);color:var(--dm-neutral-600);margin-bottom:6px;display:flex;justify-content:space-between"><span>남은 수량</span><span style="font-weight:700">${remaining} / ${total}</span></div>
      <div style="width:100%;height:8px;background:var(--dm-neutral-200);border-radius:var(--dm-radius-full);overflow:hidden"><div style="width:${percent}%;height:100%;background:var(--dm-accent)"></div></div>
    </div>
    <button class="dm-cta dm-cta-primary" style="width:100%">선착순 참여하기</button>`;
  return `<div class="dm-section dm-limited-quantity">${dmEventCard({ accentVar: '--dm-accent', icon: 'clock', body })}</div>`;
}
```

- [ ] **Step 5: 하드코딩 hex 잔존 확인 + 커밋**

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json` (Push-Location 후) → exit 0
Run(자가 grep): 위 4함수 영역에 `#[0-9a-fA-F]{3,6}` 0건, 이모지 0건.
커밋: `git commit -m "feat(dm): 이벤트 4섹션 토큰화(하드코딩 색·이모지 제거)"`

---

## Task 3: 인터랙션 4섹션 (poll·survey·email_capture·click_rewards)

**Files:** Modify `dm-section-renderer.ts`

**변경 규칙:** Task 2와 동일(이모지→`dmIcon('poll'|'survey'|'mail'|'heart')`, 하드코딩 색→토큰, 셸→`dmEventCard` 또는 토큰 박스, 버튼→`.dm-cta`). `data-dm-*` 속성·`data-field`·`data-consent`·`data-dm-result`는 보존(클라이언트 스크립트 연동).

- [ ] **Step 1: renderPoll·renderSurvey 교체** — 배경 `var(--dm-neutral-50)`, 옵션 행 `var(--dm-neutral-100)`+`var(--dm-radius-md)`, 제목 `var(--dm-fs-h3)`. (color-coded 하드코딩 제거)
- [ ] **Step 2: renderEmailCapture 교체** — 입력/버튼 토큰화, 버튼 `.dm-cta dm-cta-primary`, `data-dm-submit`·`data-consent` 보존.
- [ ] **Step 3: renderClickRewards 교체** — 이모지 iconMap → `dmIcon('heart')` 등, 진행률 바 토큰화.
- [ ] **Step 4:** tsc 0 + 자가 grep(hex/이모지 0) + 커밋 `feat(dm): 인터랙션 4섹션 토큰화`.

---

## Task 4: 시각 5섹션 (product_carousel·gallery·slideshow·tab_cards·reviews)

**Files:** Modify `dm-section-renderer.ts`

**변경 규칙:** 제목 `var(--dm-fs-h3)` 통일, placeholder 박스는 Task 8(무드 배경)에서 교체하므로 여기선 토큰 색만(`var(--dm-neutral-100)`·이탤릭 제거 → 옅은 안내). reviews 별점은 `dmIcon('star')` 채움/빈 별 대비, 카드 `var(--dm-neutral-50)`+`--dm-radius-md`.

- [ ] **Step 1:** renderProductCarousel·renderGallery·renderSlideshow 토큰화(이미지 없을 때 박스는 무드 배경 자리표시 클래스 `dm-mood-slot` 부여 — Task 8 연동).
- [ ] **Step 2:** renderReviews 별점 `dmIcon('star')`, renderTabCards 토큰화.
- [ ] **Step 3:** tsc 0 + grep + 커밋 `feat(dm): 시각 5섹션 토큰화`.

---

## Task 5: 임베드 3섹션 (youtube·instagram·map)

**Files:** Modify `dm-section-renderer.ts`

- [ ] **Step 1:** renderYoutubeEmbed·renderInstagramEmbed·renderMapStoreLocator의 하드코딩 색(`#fdf2f8` 등)·이모지(📷🗺️)를 `dmIcon('play'|'image'|'map')` + 토큰으로. 지도 placeholder는 `dm-mood-slot`.
- [ ] **Step 2:** tsc 0 + grep + 커밋 `feat(dm): 임베드 3섹션 토큰화`.

---

## Task 6: AI 비주얼 디렉션 순수 코어

**Files:**
- Create: `packages/backend/src/utils/dm/dm-visual-direction.ts`
- Test: `packages/backend/src/utils/__tests__/dm-visual-direction.verify.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// dm-visual-direction.verify.ts
// 실행: npx ts-node packages/backend/src/utils/__tests__/dm-visual-direction.verify.ts
import assert from 'node:assert';
import { normalizeVisualConcept, buildMoodBackground, pickReadableText, applyVisualDirection } from '../dm/dm-visual-direction';

let passed = 0;
function ok(n: string, fn: () => void){ fn(); passed++; console.log(`  ok - ${n}`); }

ok('normalize: 잘못된 hex/누락은 안전 기본값', () => {
  const c = normalizeVisualConcept({ palette: { primary: 'zzz', accent: '#ec4899' } } as any, 'beauty');
  assert.ok(/^#([0-9a-f]{6})$/i.test(c.palette.primary)); // 보정됨
  assert.strictEqual(c.palette.accent.toLowerCase(), '#ec4899');
});
ok('buildMoodBackground: 토큰/hex 그라데이션 문자열', () => {
  const g = buildMoodBackground({ primary: '#1e3a8a', accent: '#d4af37', surface: '#fff', on_surface: '#111' }, 'luxury');
  assert.ok(g.includes('linear-gradient') || g.includes('radial-gradient'));
  assert.ok(g.includes('#1e3a8a'));
});
ok('pickReadableText: 어두운 배경=흰 글자', () =>
  assert.strictEqual(pickReadableText('#171717'), '#ffffff'));
ok('pickReadableText: 밝은 배경=진한 글자', () =>
  assert.strictEqual(pickReadableText('#fafafa'), '#111111'));
ok('applyVisualDirection: hero에 accent_color·mood 주입(이미지 있으면 무드 skip)', () => {
  const concept = normalizeVisualConcept({ palette: { primary: '#1e3a8a', accent: '#d4af37' }, hero_treatment: 'gradient' } as any, 'luxury');
  const out = applyVisualDirection([{ id: '1', type: 'hero', order: 0, visible: true, props: { headline: 'x' } } as any], concept);
  assert.ok(out[0].accent_color);
  assert.ok((out[0] as any).props.mood_background); // 이미지 없으니 무드 주입
});
ok('applyVisualDirection: 혜택 문구 생성 0(텍스트 props 불변)', () => {
  const concept = normalizeVisualConcept({} as any, 'general');
  const out = applyVisualDirection([{ id: '1', type: 'coupon', order: 0, visible: true, props: { discount_label: '' } } as any], concept);
  assert.strictEqual((out[0] as any).props.discount_label, ''); // 빈 값 유지(혜택 생성 X)
});

console.log(`\n${passed} assertions passed`);
```

- [ ] **Step 2: 실패 확인** — Run 위 명령, Expected FAIL(모듈 없음).

- [ ] **Step 3: 최소 구현**

```ts
// dm-visual-direction.ts — AI 비주얼 컨셉 정규화·적용·무드 배경(순수, DB import 0)
import { DM_COLOR_TOKENS, getContrastRatio } from './dm-tokens';
import type { Section } from './dm-section-registry';

export type VisualConcept = {
  palette: { primary: string; accent: string; surface: string; on_surface: string };
  mood: string;
  hero_treatment: 'gradient' | 'color_block' | 'image';
  emphasis_sections: string[];
  type_scale: 'bold' | 'editorial' | 'minimal';
};

const HEX = /^#([0-9a-fA-F]{6})$/;
function safeHex(v: unknown, fallback: string): string {
  if (typeof v === 'string') {
    const s = v.trim();
    if (HEX.test(s)) return s;
    if (/^#([0-9a-fA-F]{3})$/.test(s)) return '#' + s.slice(1).split('').map(c => c + c).join('');
  }
  return fallback;
}

export function pickReadableText(bgHex: string): string {
  const dark = '#111111', light = '#ffffff';
  return getContrastRatio(light, bgHex) >= getContrastRatio(dark, bgHex) ? light : dark;
}

type IndustryKey = keyof typeof DM_COLOR_TOKENS.industry;
function industryColors(industry: string): { primary: string; accent: string } {
  const k = industry as IndustryKey;
  return DM_COLOR_TOKENS.industry[k] || { primary: DM_COLOR_TOKENS.brand.primary, accent: DM_COLOR_TOKENS.brand.accent };
}

export function normalizeVisualConcept(raw: Partial<VisualConcept> & { palette?: any }, industry: string): VisualConcept {
  const ind = industryColors(industry);
  const primary = safeHex(raw?.palette?.primary, ind.primary);
  const accent = safeHex(raw?.palette?.accent, ind.accent);
  const surface = safeHex(raw?.palette?.surface, DM_COLOR_TOKENS.neutral[0]);
  const on_surface = safeHex(raw?.palette?.on_surface, pickReadableText(surface));
  const treatment = (['gradient','color_block','image'] as const).includes(raw?.hero_treatment as any) ? raw!.hero_treatment! : 'gradient';
  const typeScale = (['bold','editorial','minimal'] as const).includes(raw?.type_scale as any) ? raw!.type_scale! : 'bold';
  return {
    palette: { primary, accent, surface, on_surface },
    mood: typeof raw?.mood === 'string' ? raw!.mood!.slice(0, 40) : '',
    hero_treatment: treatment,
    emphasis_sections: Array.isArray(raw?.emphasis_sections) ? raw!.emphasis_sections!.map(String).slice(0, 6) : [],
    type_scale: typeScale,
  };
}

export function buildMoodBackground(palette: VisualConcept['palette'], mood: string): string {
  // 두 브랜드 색의 135도 그라데이션 — 사진 없이도 완성형 비주얼
  return `linear-gradient(135deg, ${palette.primary} 0%, ${palette.accent} 100%)`;
}

/** 컨셉을 섹션에 적용 — 색·무드만, 텍스트(혜택) props는 절대 불변. */
export function applyVisualDirection(sections: Section[], concept: VisualConcept): Section[] {
  return sections.map((s) => {
    const next: any = { ...s, accent_color: s.accent_color || concept.palette.accent };
    const hasImage = !!(s.props as any)?.image_url;
    if ((s.type === 'hero') && !hasImage && concept.hero_treatment !== 'image') {
      next.props = { ...(s.props as any), mood_background: buildMoodBackground(concept.palette, concept.mood), mood_text: pickReadableText(concept.palette.primary) };
    }
    return next as Section;
  });
}
```

- [ ] **Step 4: 통과 확인** — Run, Expected `6 assertions passed`.
- [ ] **Step 5: 커밋** `feat(dm): AI 비주얼 컨셉 순수 코어(정규화·무드·대비)`.

---

## Task 7: AI 비주얼 디렉터 + oneShotGenerate 주입

**Files:** Modify `packages/backend/src/utils/dm/dm-ai.ts`

- [ ] **Step 1: `designVisualConcept` 추가** (dm-ai.ts)

```ts
import { normalizeVisualConcept, applyVisualDirection, type VisualConcept } from './dm-visual-direction';

const VISUAL_DIRECTOR_SYSTEM = `당신은 모바일 DM 아트 디렉터입니다.
브랜드·목적·업종·톤을 보고 이 캠페인의 비주얼 컨셉(색 팔레트·무드·강조)을 설계합니다.
제약:
- 색은 HEX. 브랜드 색이 주어지면 그와 조화되게, 없으면 업종 무드에 맞게.
- 디자인 디렉션만. 상품명·가격·할인율·혜택 문구 등 사실은 만들지 않는다.
- JSON만 출력:
{ "palette": { "primary":"#xxxxxx","accent":"#xxxxxx","surface":"#xxxxxx","on_surface":"#xxxxxx" },
  "mood":"한두 단어","hero_treatment":"gradient|color_block|image","emphasis_sections":["hero"],"type_scale":"bold|editorial|minimal" }`;

export async function designVisualConcept(spec: CampaignSpec, brandKit?: DmBrandKit, companyId?: string): Promise<VisualConcept> {
  try {
    const userMessage = `브랜드: ${spec.brand.name || '(미정)'} / 목적: ${spec.objective} / 업종: ${spec.industry} / 톤: ${spec.tone}` +
      (brandKit?.primary_color ? ` / 브랜드색: ${brandKit.primary_color}` : '');
    const text = await callAIWithFallback({
      system: VISUAL_DIRECTOR_SYSTEM, userMessage, maxTokens: 400, temperature: 0.7,
      model: 'opus', companyId, source: 'dm-visual',
    });
    return normalizeVisualConcept(extractJson(text), spec.industry || 'general');
  } catch (e: any) {
    console.warn('[designVisualConcept] fallback:', e?.message);
    return normalizeVisualConcept({}, spec.industry || 'general'); // 실패해도 업종 기본 팔레트
  }
}
```

- [ ] **Step 2: `oneShotGenerate`에 주입** (sections 생성 후, return 직전)

```ts
// (sections 채운 뒤)
const concept = await designVisualConcept(spec, undefined, opts.companyId);
const directed = applyVisualDirection(sections, concept);
const layoutMode = decideLayoutMode(directed);
const pages = splitSectionsIntoPages(directed, layoutMode);
return { spec, sections: directed, brandKit: { ...brandKit }, scenario: opts.scenario, layoutMode, pages };
```

- [ ] **Step 3:** backend tsc 0(heap 4096) + 자가 grep(모델명 UI 0 — 이 파일은 backend라 주석 OK / 혜택 단어 생성 0).
- [ ] **Step 4: 커밋** `feat(dm): AI 비주얼 디렉터 + oneShot 주입`.

---

## Task 8: 무드 배경 렌더 반영 + placeholder 정제

**Files:** Modify `dm-section-renderer.ts`

- [ ] **Step 1: renderHero가 mood_background 사용** — `props.image_url` 없고 `props.mood_background` 있으면 검정 배경 대신 그 그라데이션 + `mood_text` 색.

```ts
// renderHero 내부 background 결정부
const moodBg = (props as any).mood_background as string | undefined;
const baseBg = img ? 'var(--dm-neutral-900)' : (moodBg || 'var(--dm-neutral-900)');
const textColor = (props as any).mood_text || '#fff';
// 컨테이너 background:${baseBg}, 텍스트 color:${textColor}
```

- [ ] **Step 2: `dm-mood-slot` placeholder 정제** — 시각 섹션 빈 이미지 자리(Task 4·5에서 부여)를 옅은 토큰 배경 + `dmIcon('image')` + 보조 안내로. 발송/미리보기에서 휑하지 않게.
- [ ] **Step 3:** HTML 골든 — hero 무드 배경 시 검정(`--dm-neutral-900`) 미사용 확인. tsc 0. 커밋 `feat(dm): 무드 배경 렌더 + placeholder 정제`.

---

## Task 9: frontend 미러 + CSS 동기화

**Files:** Modify `packages/frontend/src/utils/dm-section-defaults.ts`, `packages/frontend/src/styles/dm-builder.css`

- [ ] **Step 1:** backend 렌더 변경(아이콘·토큰·무드)을 편집 미리보기 미러에 반영(편집 화면이 발송과 같은 모습이도록). `dm-mood-slot`·`.dm-cta` 스타일 dm-builder.css에 추가.
- [ ] **Step 2:** frontend tsc 0(`npx tsc --noEmit` in packages/frontend) + native dialog/모델명/박-단어 grep 0. 커밋 `feat(dm): 편집 미리보기 미러·CSS 동기화`.

---

## Task 10: 통합 검증

- [ ] **Step 1:** 두 verify 재실행 (render-primitives·visual-direction) 전부 pass.
- [ ] **Step 2:** backend tsc 0 + frontend tsc 0.
- [ ] **Step 3:** 전역 자가 grep — `dm-section-renderer.ts`에 하드코딩 hex 0(토큰 conic/gradient 제외 검토), 이모지 0, 박-단어 0, 모델명 UI 0.
- [ ] **Step 4:** 표준 종료 멘트 후 Harold 배포(backend pm2 restart + frontend build:safe).

---

## Self-Review (작성자 점검)

- **Spec coverage:** 단위 A(렌더 격상)=Task 1~5·8, 단위 B(AI 비주얼 디렉션)=Task 6·7·8, SSOT=Task 9, 검증=Task 10. 핵심 가치(AI가 만들어준다)=Task 6·7(컨셉 설계)+8(무드 완성형). 누락 없음.
- **Placeholder:** Task 3·4·5는 변경 규칙 + 대상 함수 명시(Task 2의 코드 패턴을 같은 규칙으로 — full repeat 대신 규칙·토큰 매핑 제시). 모호한 "적절히" 표현 0.
- **Type 일관:** `VisualConcept`·`normalizeVisualConcept`·`applyVisualDirection`·`buildMoodBackground`·`pickReadableText`·`dmIcon`·`dmEventCard` 시그니처 Task 간 일치.
- **영구 룰:** AI 혜택 생성 X(Task 6 테스트로 고정), 모델명 backend 한정, 토큰화로 하드코딩 hex 제거.
