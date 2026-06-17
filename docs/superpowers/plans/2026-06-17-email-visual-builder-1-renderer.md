# Email 비주얼 빌더 ① 렌더러+저장+배선 — 구현 계획

> **For agentic workers:** superpowers:subagent-driven-development 또는 executing-plans로 Task 단위 실행. 단계는 체크박스(`- [ ]`).
> **git/배포(CLAUDE.md):** 비토는 코드만 작성. git·배포·DB ALTER 실행은 Harold님. 각 Task는 tsc/verify 스크립트 게이트로 닫는다.
> **3분할 중 1번** — ② AI 블록 생성, ③ 비주얼 에디터는 별도 계획서. 본 계획만으로 "Section[] → 예쁜 이메일 HTML → 발송"이 동작한다.

**Goal:** DM 섹션 모델(`Section[]`)을 이메일 클라이언트에서 안 깨지는 고급 HTML로 렌더하는 엔진과, 그 결과를 기존 이메일 발송·트래킹·크레딧에 배선한다.

**Architecture:** DM 디자인 토큰(리터럴 값)을 인라인 스타일로 치환하는 이메일 전용 렌더러를 신규 작성. DM 웹 렌더러(`dm-section-renderer.ts`)는 무변경. `email_campaigns.sections`(JSONB) 추가 — sections 있으면 html_body는 렌더 산출물, 없으면 기존 raw HTML 흐름 보존.

**Tech Stack:** TypeScript·Express·PostgreSQL(JSONB)·ts-node verify 스크립트(backend는 vitest 없음). 이메일 HTML = `<table>` 인라인 CSS.

---

## File Structure

- `packages/backend/src/utils/email/email-blocks.ts` — `EMAIL_BLOCK_WHITELIST` + 비호환 블록 정적 대체 맵 (단일 상수)
- `packages/backend/src/utils/email/email-tokens.ts` — 브랜드킷 → 인라인 값 해석 (`resolveEmailBrand`), DM 토큰 읽기 차용
- `packages/backend/src/utils/email/email-section-renderer.ts` — `renderEmailSections(sections, ctx): string` + 블록별 렌더 함수 (핵심)
- `packages/backend/scripts/verify-email-renderer.ts` — 골든 + 이메일 안전 린트 (ts-node, 기존 `verify-email-ai.ts` 패턴)
- `packages/backend/src/routes/email.ts` — 캠페인 POST/PATCH가 sections 받으면 렌더 → html_body (배선만)
- `packages/backend/src/utils/email-channel.ts` — createEmailCampaign/updateEmailCampaign에 sections 저장 (배선)
- DB: `email_campaigns.sections jsonb` ALTER (Harold 실행)

DM 모델은 **읽기 차용만** (`import type { Section } from '../dm/dm-section-registry'`). DM 파일 무변경.

---

## Task 1: DB 컬럼 검증 + ALTER (Harold 실행)

**Files:** 없음 (DB)

- [ ] **Step 1: 컬럼 존재 검증 SQL을 Harold님께 제공**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'email_campaigns' AND column_name = 'sections';
```
기대: 0행(아직 없음). 있으면 타입이 jsonb인지 확인.

- [ ] **Step 2: ALTER (Harold 실행 — 결과 0행 확인 후)**

```sql
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS sections jsonb;
```

- [ ] **Step 3: SCHEMA.md 갱신**

`status/SCHEMA.md` email_campaigns 절에 `sections | jsonb | 비주얼 빌더 Section[] (null=manual HTML)` 행 추가 + 실측 날짜.

- [ ] **Step 4: 게이트**

코드는 `handleDbMigrationError`(기존 503 분기)가 있어 미마이그레이션 시 안전. ALTER 전 배포돼도 sections 미사용 경로는 무손.

---

## Task 2: 이메일 블록 화이트리스트 (단일 상수)

**Files:**
- Create: `packages/backend/src/utils/email/email-blocks.ts`
- Test: `packages/backend/scripts/verify-email-renderer.ts` (Task 4에서 생성, 여기선 상수만)

- [ ] **Step 1: 화이트리스트 + 정적 대체 맵 작성**

```ts
import type { SectionType } from '../dm/dm-section-registry';

// 이메일에서 정적으로 안전 렌더되는 블록만. 보이면 작동 불변식 — 이 집합 밖은 렌더 0.
export const EMAIL_BLOCK_WHITELIST: readonly SectionType[] = [
  'header', 'hero', 'text_card', 'cta', 'coupon', 'promo_code',
  'product_carousel', 'gallery', 'store_info', 'sns', 'reviews', 'footer',
] as const;

// 비호환(인터랙티브/JS/임베드) → 이메일에선 정적 대체 또는 스킵.
//  'static': 정적 요약 렌더, 'skip': 렌더 0(에디터 메뉴에서도 제외)
export const EMAIL_INCOMPATIBLE: Record<string, 'static' | 'skip'> = {
  countdown: 'static',       // D-day 텍스트만
  video: 'static',           // 썸네일 + 링크
  youtube_embed: 'static',   // 썸네일 + 링크
  instagram_embed: 'static', // 링크
  map_store_locator: 'static', // 주소 텍스트
  poll: 'skip', survey: 'skip', email_capture: 'skip', click_rewards: 'skip',
  lucky_draw: 'skip', roulette: 'skip', instant_coupon: 'skip', limited_quantity: 'skip',
  tab_cards: 'static', slideshow: 'static',
};

export function isEmailRenderable(type: string): boolean {
  return (EMAIL_BLOCK_WHITELIST as readonly string[]).includes(type) || EMAIL_INCOMPATIBLE[type] === 'static';
}
```

- [ ] **Step 2: 게이트** — `cd packages/backend && npx tsc --noEmit` → 0.

---

## Task 3: 이메일 토큰 해석 (브랜드킷 → 인라인 값)

**Files:**
- Create: `packages/backend/src/utils/email/email-tokens.ts`

- [ ] **Step 1: 작성 — DM 토큰(리터럴) 읽기 차용 + 브랜드킷 override**

```ts
import { DM_COLOR_TOKENS, DM_TYPOGRAPHY, DM_SPACING, DM_RADIUS } from '../dm/dm-tokens';
import type { DmBrandKit } from '../dm/dm-tokens';

export interface EmailBrand {
  primary: string; primaryHover: string; accent: string;
  text: string; textMuted: string; bg: string; cardBg: string; border: string;
  fontFamily: string; mono: string;
  sp: typeof DM_SPACING; radius: typeof DM_RADIUS; type: typeof DM_TYPOGRAPHY.scale;
}

// 브랜드킷이 있으면 primary/accent override, 없으면 DM 기본 brand 토큰.
export function resolveEmailBrand(brandKit?: DmBrandKit | null): EmailBrand {
  return {
    primary: brandKit?.primaryColor || DM_COLOR_TOKENS.brand.primary,
    primaryHover: brandKit?.primaryColor ? darken(brandKit.primaryColor) : DM_COLOR_TOKENS.brand.primaryHover,
    accent: brandKit?.accentColor || DM_COLOR_TOKENS.brand.accent,
    text: DM_COLOR_TOKENS.neutral[800],
    textMuted: DM_COLOR_TOKENS.neutral[500],
    bg: DM_COLOR_TOKENS.neutral[100],
    cardBg: DM_COLOR_TOKENS.neutral[0],
    border: DM_COLOR_TOKENS.neutral[200],
    fontFamily: DM_TYPOGRAPHY.fontFamily.primary,
    mono: DM_TYPOGRAPHY.fontFamily.mono,
    sp: DM_SPACING, radius: DM_RADIUS, type: DM_TYPOGRAPHY.scale,
  };
}

// 단순 명도 하강(hover 색) — 임의 상수 아닌 결정적 변환.
function darken(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, ((n >> 16) & 255) - 24), g = Math.max(0, ((n >> 8) & 255) - 24), b = Math.max(0, (n & 255) - 24);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
```
주: `DmBrandKit`의 실제 필드명(primaryColor/accentColor)은 구현 직전 `dm-tokens.ts`에서 확인해 일치시킨다(추측 금지 — 다르면 그 이름으로 교체).

- [ ] **Step 2: 게이트** — tsc 0.

---

## Task 4: 렌더러 스캐폴드 + 골든/린트 하니스 (TDD 시작)

**Files:**
- Create: `packages/backend/src/utils/email/email-section-renderer.ts`
- Create: `packages/backend/scripts/verify-email-renderer.ts`

- [ ] **Step 1: 실패 검증 스크립트 먼저 작성**

```ts
// scripts/verify-email-renderer.ts — ts-node 실행. backend vitest 없음 → verify 스크립트 패턴.
import { renderEmailSections } from '../src/utils/email/email-section-renderer';
import type { Section } from '../src/utils/dm/dm-section-registry';

let fail = 0;
const ok = (c: boolean, label: string) => { console.log((c ? 'PASS ' : 'FAIL ') + label); if (!c) fail++; };

const sample: Section[] = [
  { id: 's1', type: 'hero', props: { headline: '여름 신상 입고', sub_copy: '지금 만나보세요', align: 'center', height: 'md' } } as any,
];
const html = renderEmailSections(sample, { brandKit: null });

// 골든: 핵심 구조
ok(html.includes('여름 신상 입고'), 'hero headline 렌더');
ok(/<table[\s\S]*max-width:\s*600px/i.test(html), '600px table 셸');

// 이메일 안전 린트 (허접/깨짐 차단)
ok(!/var\(--/.test(html), 'CSS 변수 0건');
ok(!/<style[\s>]/i.test(html), '<style> 태그 0건');
ok(!/<script/i.test(html), '<script> 0건');
ok(!/display\s*:\s*flex/i.test(html), 'flex 0건');
ok(!/display\s*:\s*grid/i.test(html), 'grid 0건');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 실패 확인** — `cd packages/backend && npx ts-node scripts/verify-email-renderer.ts` → FAIL(renderEmailSections 미정의).

- [ ] **Step 3: 렌더러 셸 + 디스패치 작성**

```ts
// email-section-renderer.ts — Section[] → 이메일 안전 HTML. DM 웹 렌더러와 별개.
import type { Section } from '../dm/dm-section-registry';
import { resolveEmailBrand, type EmailBrand } from './email-tokens';
import { EMAIL_BLOCK_WHITELIST, EMAIL_INCOMPATIBLE } from './email-blocks';
import { escapeHtml, safeUrl } from '../dm/dm-section-renderer';
import type { DmBrandKit } from '../dm/dm-tokens';

export interface EmailRenderCtx { brandKit?: DmBrandKit | null; storeName?: string; publicBase?: string; }

// 이메일 절대 이미지 URL (상대경로면 publicBase 접두).
function emailImg(src: string | undefined, publicBase?: string): string {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  return `${(publicBase || 'https://hanjul.ai').replace(/\/$/, '')}/${String(src).replace(/^\//, '')}`;
}

function renderBlock(s: Section, b: EmailBrand, ctx: EmailRenderCtx): string {
  const renderable = (EMAIL_BLOCK_WHITELIST as readonly string[]).includes(s.type);
  const fallback = EMAIL_INCOMPATIBLE[s.type];
  if (!renderable && fallback !== 'static') return ''; // skip — 깨진 HTML 0
  switch (s.type) {
    case 'hero': return renderHero(s.props as any, b, ctx);
    // ... Task 5에서 블록별 추가
    default: return renderable ? '' : '';
  }
}

export function renderEmailSections(sections: Section[], ctx: EmailRenderCtx): string {
  const b = resolveEmailBrand(ctx.brandKit);
  const inner = (sections || []).map((s) => renderBlock(s, b, ctx)).join('\n');
  // 이메일 셸 — 600px 중앙 table, 아웃룩 대비 role=presentation.
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${b.bg};margin:0;padding:0">
  <tr><td align="center" style="padding:${b.sp[5]} ${b.sp[3]}">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${b.cardBg};border-radius:${b.radius.lg || '16px'};overflow:hidden;font-family:${b.fontFamily}">
      ${inner}
    </table>
  </td></tr></table>`;
}

// 대표 블록 — 패턴 기준. 나머지는 Task 5에서 동일 패턴.
function renderHero(p: { image_url?: string; headline: string; sub_copy?: string; align: 'left'|'center'|'right'; height: string }, b: EmailBrand, ctx: EmailRenderCtx): string {
  const img = emailImg(p.image_url, ctx.publicBase);
  const align = p.align || 'center';
  return `<tr><td style="padding:0">
    ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(p.headline)}" width="600" style="width:100%;max-width:600px;display:block;border:0">` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:${b.sp[8]} ${b.sp[6]};text-align:${align}">
      <div style="font-size:${b.type.hero.size};line-height:${b.type.hero.lineHeight};font-weight:${b.type.hero.weight};letter-spacing:${b.type.hero.letterSpacing};color:${b.text};margin:0">${escapeHtml(p.headline)}</div>
      ${p.sub_copy ? `<div style="font-size:${b.type.body.size};line-height:${b.type.body.lineHeight};color:${b.textMuted};margin-top:${b.sp[3]}">${escapeHtml(p.sub_copy)}</div>` : ''}
    </td></tr></table>
  </td></tr>`;
}
```

- [ ] **Step 4: 통과 확인** — `npx ts-node scripts/verify-email-renderer.ts` → ALL PASS.

- [ ] **Step 5: 게이트** — tsc 0.

---

## Task 5: 나머지 이메일 블록 (각 골든 + 동일 패턴)

각 블록 = Task 4의 renderHero 패턴(인라인 토큰 값 + escapeHtml + emailImg + table 셀) 그대로. 블록 1개당 하위 스텝 4개: 골든 추가 → FAIL 확인 → 렌더 함수 작성 → PASS. 블록 props는 `dm-section-registry.ts`에서 직접 확인해 일치(추측 금지).

- [ ] **header** (logo/banner — `dm-section-renderer.ts:renderHeader` 참조, 단 flex→table·CSS변수→리터럴 변환)
- [ ] **text_card** (image_position top/left/right/bottom → 이메일은 top/bottom만, left/right는 table 2열)
- [ ] **cta** (버튼 = `<a>`를 table 셀 배경 padding으로 — 이미지 버튼 금지, primary/secondary/outline 스타일)
- [ ] **coupon / promo_code** (정적 코드 카드 — mono 폰트, 점선 테두리)
- [ ] **product_carousel → 정적 2열 그리드** (이미지+이름+가격, 스크롤 없음)
- [ ] **gallery → 이미지 행** (1~2열 table)
- [ ] **store_info / sns / reviews** (정적 텍스트·링크)
- [ ] **footer** (회사명·주소·수신거부 자리 — 수신거부 링크는 발송 시 자동 부착이므로 자리만)
- [ ] **정적 대체**: countdown(D-day 텍스트), video/youtube_embed(썸네일+링크), instagram_embed(링크), map_store_locator(주소)
- [ ] 각 블록 후 `npx ts-node scripts/verify-email-renderer.ts` ALL PASS 유지.

---

## Task 6: text_body 자동 추출 (도달률 — 이미지 차단 대비)

**Files:**
- Modify: `packages/backend/src/utils/email/email-section-renderer.ts`

- [ ] **Step 1: 골든 추가** — `extractEmailText(sections)`가 헤드라인·본문·버튼 라벨을 순수 텍스트로.

```ts
ok(extractEmailText(sample).includes('여름 신상 입고'), 'text 추출 — hero headline');
ok(!/[<>]/.test(extractEmailText(sample)), 'text에 태그 0건');
```

- [ ] **Step 2: 구현** — Section[] 순회하며 텍스트 필드(headline/sub_copy/body/label 등) 수집 → 줄바꿈 결합.
- [ ] **Step 3: PASS + tsc 0.**

---

## Task 7: 라우트·채널 배선 (sections → 렌더 → html_body)

**Files:**
- Modify: `packages/backend/src/routes/email.ts` (POST/PATCH /campaigns)
- Modify: `packages/backend/src/utils/email-channel.ts` (create/update + get)

- [ ] **Step 1: createEmailCampaign/updateEmailCampaign에 sections 파라미터 추가** — sections 있으면 컬럼 저장, get 시 반환.
- [ ] **Step 2: 라우트에서 sections 받으면 렌더** — POST/PATCH가 `sections` 받으면 `renderEmailSections` → html_body + `extractEmailText` → text_body 동시 세팅 후 저장. sections 없으면 기존 html_body 직접 흐름 보존.

```ts
// POST /campaigns 안 — sections 우선
let html_body = req.body.html_body, text_body = req.body.text_body, sections = req.body.sections || null;
if (Array.isArray(sections) && sections.length > 0) {
  const brandKit = await getCompanyBrandKit(auth.companyId); // dm-brand-kit 차용(있으면)
  html_body = renderEmailSections(sections, { brandKit, publicBase: process.env.PUBLIC_BASE_URL });
  text_body = extractEmailText(sections);
}
// 이후 createEmailCampaign에 { ..., htmlBody: html_body, textBody: text_body, sections }
```
주: `getCompanyBrandKit` 실제 함수명은 `dm-brand-kit.ts`에서 확인(없으면 brandKit null로 진행 — 기본 토큰).

- [ ] **Step 3: 게이트** — tsc 0. `handleDbMigrationError`가 sections 컬럼 미존재 503 처리하는지 확인(이미 패턴 있음).

---

## Task 8: 최종 검증

- [ ] **Step 1:** `cd packages/backend && npx tsc --noEmit` → 0.
- [ ] **Step 2:** `npx ts-node scripts/verify-email-renderer.ts` → ALL PASS (전 블록 골든 + 이메일 안전 린트 0건).
- [ ] **Step 3:** 박-단어/모델명 grep 0 — `grep -rnE "박[음힘는을힌지혀힙히혔힐았]|Opus|Sonnet|GPT" src/utils/email/`.
- [ ] **Step 4:** 샘플 Section[] 렌더 HTML을 테스트 발송(SMTP 설정된 회사)으로 Gmail·아웃룩·네이버·모바일 실측 = 운영 영역(Harold/직원).

---

## 자가 검토

- **Spec 커버리지:** §4-1 렌더러=Task 3·4·5, §4-2 블록선별=Task 2·5, §4-5 저장배선=Task 1·7, §6 도달률 text_body=Task 6, §9 테스트=Task 4·8. §4-3 에디터·§4-4 AI = 계획서 ②③.
- **불변식:** 화이트리스트 밖 블록 = 렌더 0(Task 4 renderBlock skip). 깨진 HTML 차단.
- **무손:** sections null = 기존 raw HTML 흐름 그대로(Task 7 분기). DM 파일 읽기 차용만.
- **추측 차단:** DmBrandKit 필드명·블록 props·브랜드킷 함수명은 구현 직전 원본 확인 명시(Task 3·5·7).
