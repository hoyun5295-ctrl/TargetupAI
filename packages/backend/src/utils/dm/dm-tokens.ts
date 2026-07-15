/**
 * dm-tokens.ts (backend) — 모바일 DM 빌더 디자인 토큰 (뷰어 HTML 렌더용)
 *
 * ⚠️ SSOT(Single Source of Truth) — 값은 반드시 frontend와 동기화
 *    프론트 미러: packages/frontend/src/utils/dm-tokens.ts
 *    CSS 변수 매핑: packages/frontend/src/styles/dm-builder.css
 *    값 변경 시 세 파일 동시 수정 필수.
 *
 * 용도: dm-viewer.ts가 HTML 렌더 시 <style>:root{...}</style> 블록을 인라인 주입.
 *       외부 CDN 의존 없이 뷰어 HTML 자체에 토큰을 내장.
 *
 * 설계서: status/DM-PRO-DESIGN.md §8
 */

// ────────────── Color ──────────────

export const DM_COLOR_TOKENS = {
  neutral: {
    0:    '#ffffff',
    50:   '#fafafa',
    100:  '#f5f5f5',
    200:  '#e5e5e5',
    300:  '#d4d4d4',
    400:  '#a3a3a3',
    500:  '#737373',
    600:  '#525252',
    700:  '#404040',
    800:  '#262626',
    900:  '#171717',
    1000: '#000000',
  },
  brand: {
    primary:      '#4f46e5',
    primaryHover: '#4338ca',
    primaryLight: '#eef2ff',
    accent:       '#f59e0b',
  },
  semantic: {
    success: '#10b981',
    warning: '#f59e0b',
    error:   '#ef4444',
    info:    '#3b82f6',
  },
  industry: {
    beauty:  { primary: '#ec4899', accent: '#fbcfe8' },
    fashion: { primary: '#18181b', accent: '#fde68a' },
    food:    { primary: '#ea580c', accent: '#fef3c7' },
    tech:    { primary: '#0ea5e9', accent: '#cffafe' },
    luxury:  { primary: '#1e3a8a', accent: '#d4af37' },
  },
} as const;

// ────────────── Typography ──────────────

export const DM_TYPOGRAPHY = {
  fontFamily: {
    primary: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
    serif:   '"Noto Serif KR", serif',
    mono:    '"JetBrains Mono", Menlo, Consolas, monospace',
  },
  // ★ 2026-07-02 디자인 시스템 v2 — 디스플레이급 타입 스케일 상향 (Harold 동의).
  //   SSOT: frontend/src/utils/dm-tokens.ts + styles/dm-builder.css 동시 수정 필수.
  scale: {
    hero:  { size: '40px', lineHeight: '1.15', weight: 800, letterSpacing: '-0.03em' },
    h1:    { size: '28px', lineHeight: '1.25', weight: 700, letterSpacing: '-0.02em' },
    h2:    { size: '22px', lineHeight: '1.35', weight: 700, letterSpacing: '-0.01em' },
    h3:    { size: '18px', lineHeight: '1.4', weight: 600, letterSpacing: '0' },
    body:  { size: '16px', lineHeight: '1.65', weight: 400, letterSpacing: '0' },
    small: { size: '13px', lineHeight: '1.55', weight: 400, letterSpacing: '0' },
    tiny:  { size: '11px', lineHeight: '1.4', weight: 400, letterSpacing: '0' },
  },
} as const;

// ────────────── Spacing / Radius / Shadow ──────────────

export const DM_SPACING = {
  0:  '0',
  1:  '4px',
  2:  '8px',
  3:  '12px',
  4:  '16px',
  5:  '20px',
  6:  '24px',
  8:  '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
} as const;

export const DM_RADIUS = {
  none:  '0',
  sm:    '4px',
  md:    '8px',
  lg:    '12px',
  xl:    '16px',
  '2xl': '24px',
  full:  '9999px',
} as const;

// ★ 2026-07-02 v2 — 슬레이트 틴트의 넓고 부드러운 그림자 (SSOT 3파일 동기)
export const DM_SHADOW = {
  sm: '0 1px 2px rgba(15,23,42,0.06)',
  md: '0 6px 16px -4px rgba(15,23,42,0.10), 0 2px 6px -2px rgba(15,23,42,0.06)',
  lg: '0 12px 28px -6px rgba(15,23,42,0.12), 0 4px 10px -4px rgba(15,23,42,0.06)',
  xl: '0 24px 48px -12px rgba(15,23,42,0.16), 0 10px 18px -8px rgba(15,23,42,0.06)',
} as const;

// ────────────── BrandKit 타입 ──────────────

export type DmBrandKit = {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  neutral_color?: string;
  background_color?: string;
  font_family?: string;
  // ★ 2026-07-13 디자인 3.0 — 헤드라인 전용 서체(미설정 = font_family와 동일 = 기존 출력 그대로)
  font_display?: string;
  tone?: 'premium' | 'friendly' | 'urgent' | 'elegant' | 'playful';
  contact?: { phone?: string; email?: string; website?: string };
  sns?: { instagram?: string; youtube?: string; kakao?: string; naver?: string };
  // ★ 2026-07-13 디자인 3.0 — DM 단위 아트디렉션 영속화. brand_kit JSONB 동승(dm_versions 스냅샷 포함, DDL 0).
  //   뷰어가 normalizeArtDirection으로 정규화해 주입. 미설정 = 중립 기본(현행과 동일).
  art_direction?: {
    theme?: string;
    typeScale?: 'editorial' | 'bold' | 'minimal';
    headlineFont?: 'sans' | 'serif';
    spacingDensity?: 'compact' | 'standard' | 'airy';
    accentMotif?: 'none' | 'rule' | 'index' | 'bracket' | 'dot';
    sectionDivider?: 'none' | 'hairline' | 'gap' | 'rule';
    grain?: boolean;
  };
};

// ────────────── 서체 카탈로그 (디자인 3.0) ──────────────

/**
 * ★ 2026-07-13 — 큐레이션 서체 카탈로그. SSOT: frontend/src/utils/dm-tokens.ts 동기.
 * css = brandKit.font_family/font_display에 저장되는 font-family 문자열(기존 저장값 하위호환).
 * google = Google Fonts css2 파라미터(null = 별도 로드 불필요 — Pretendard는 뷰어가 항상 로드).
 * ★ 2026-07-14 디자인 4.0 M2 — 소유 = design-core/fonts CORE_FONTS (값 무변 파생).
 */
import { CORE_FONTS } from '../design-core/fonts';
export const DM_FONT_CATALOG: ReadonlyArray<{ id: string; label: string; css: string; google: string | null }> =
  CORE_FONTS.map((c) => ({ id: c.id, label: c.label, css: c.css, google: c.google }));

/** ★ 2026-07-13 (Codex 지적) — 브랜드킷 서체 문자열 무해화: font-family에 필요한 문자만 허용.
 *  <style> 블록 raw 삽입 경로의 저장형 XSS 차단 (font_family는 기존부터 raw 삽입이던 표면 — 부류 통합 차단). */
export function safeFontFamily(v: string | undefined, fallback: string): string {
  if (!v || typeof v !== 'string') return fallback;
  const cleaned = v.replace(/[^\w\s,"'\-]/g, '').trim();
  return cleaned || fallback;
}

/** font-family 문자열(들)에서 필요한 Google Fonts css2 URL 생성 — 매칭 0건이면 null (기존 DM = null → 링크 미추가) */
export function dmGoogleFontsUrl(...families: Array<string | undefined>): string | null {
  const params: string[] = [];
  for (const f of families) {
    if (!f) continue;
    for (const c of DM_FONT_CATALOG) {
      if (!c.google) continue;
      const first = c.css.split(',')[0].replace(/"/g, '').trim();
      if (f.includes(first) && !params.includes(c.google)) params.push(c.google);
    }
  }
  if (params.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${params.map((p) => `family=${p}`).join('&')}&display=swap`;
}

// ────────────── CSS 변수 렌더러 (뷰어 HTML 삽입용) ──────────────

/**
 * 뷰어 HTML의 <head> 안 <style> 블록에 주입할 :root CSS 문자열 반환.
 * brandKit이 있으면 기본값을 override.
 */
export function renderDmTokensCss(brandKit?: DmBrandKit): string {
  const primary   = brandKit?.primary_color    || DM_COLOR_TOKENS.brand.primary;
  const secondary = brandKit?.secondary_color  || DM_COLOR_TOKENS.neutral[700];
  const accent    = brandKit?.accent_color     || DM_COLOR_TOKENS.brand.accent;
  const neutral   = brandKit?.neutral_color    || DM_COLOR_TOKENS.neutral[700];
  const bg        = brandKit?.background_color || DM_COLOR_TOKENS.neutral[0];
  // ★ 2026-07-13 (Codex 지적) — 서체 문자열 무해화 후 삽입 (raw <style> 삽입 XSS 차단)
  const fontPri   = safeFontFamily(brandKit?.font_family, DM_TYPOGRAPHY.fontFamily.primary);
  // ★ 2026-07-13 디자인 3.0 — 헤드라인 전용 서체(미설정 = 본문과 동일 = 기존 출력과 동일)
  const fontDisp  = safeFontFamily(brandKit?.font_display, fontPri);

  // ★ 2026-07-13 디자인 3.0 — 배경색이 어두우면 중립 스케일 자동 반전(다크 테마 DM 전면 지원).
  //   밝은 배경(기본) = 추가 출력 0줄 → 기존 발행물 CSS 무변화(골든 보존).
  const darkBg = getContrastRatio('#ffffff', bg) >= 4.5;
  const darkVars = darkBg ? `
  --dm-neutral-0: #1b2130;
  --dm-neutral-50: #161b28;
  --dm-neutral-100: #1e2433;
  --dm-neutral-200: #2c3347;
  --dm-neutral-300: #3a4257;
  --dm-neutral-400: #8b94a7;
  --dm-neutral-500: #9aa3b5;
  --dm-neutral-600: #b7bfce;
  --dm-neutral-700: #cdd4e0;
  --dm-neutral-800: #e4e8f0;
  --dm-neutral-900: #f2f5fa;
  --dm-neutral-1000: #ffffff;
  --dm-primary-light: color-mix(in srgb, ${primary} 22%, #141926);
` : '';

  return `
:root {
  --dm-neutral-0: ${DM_COLOR_TOKENS.neutral[0]};
  --dm-neutral-50: ${DM_COLOR_TOKENS.neutral[50]};
  --dm-neutral-100: ${DM_COLOR_TOKENS.neutral[100]};
  --dm-neutral-200: ${DM_COLOR_TOKENS.neutral[200]};
  --dm-neutral-300: ${DM_COLOR_TOKENS.neutral[300]};
  --dm-neutral-400: ${DM_COLOR_TOKENS.neutral[400]};
  --dm-neutral-500: ${DM_COLOR_TOKENS.neutral[500]};
  --dm-neutral-600: ${DM_COLOR_TOKENS.neutral[600]};
  --dm-neutral-700: ${DM_COLOR_TOKENS.neutral[700]};
  --dm-neutral-800: ${DM_COLOR_TOKENS.neutral[800]};
  --dm-neutral-900: ${DM_COLOR_TOKENS.neutral[900]};
  --dm-neutral-1000: ${DM_COLOR_TOKENS.neutral[1000]};

  --dm-primary: ${primary};
  --dm-primary-hover: ${DM_COLOR_TOKENS.brand.primaryHover};
  --dm-primary-light: ${DM_COLOR_TOKENS.brand.primaryLight};
  --dm-secondary: ${secondary};
  --dm-accent: ${accent};
  --dm-neutral: ${neutral};
  --dm-bg: ${bg};

  --dm-success: ${DM_COLOR_TOKENS.semantic.success};
  --dm-warning: ${DM_COLOR_TOKENS.semantic.warning};
  --dm-error: ${DM_COLOR_TOKENS.semantic.error};
  --dm-info: ${DM_COLOR_TOKENS.semantic.info};

  --dm-font-primary: ${fontPri};
  --dm-font-serif: ${DM_TYPOGRAPHY.fontFamily.serif};
  --dm-font-mono: ${DM_TYPOGRAPHY.fontFamily.mono};
  --dm-font-display: ${fontDisp};

  --dm-fs-hero: ${DM_TYPOGRAPHY.scale.hero.size};
  --dm-fw-hero: ${DM_TYPOGRAPHY.scale.hero.weight};
  --dm-ls-hero: ${DM_TYPOGRAPHY.scale.hero.letterSpacing};
  --dm-fs-h1: ${DM_TYPOGRAPHY.scale.h1.size};
  --dm-fs-h2: ${DM_TYPOGRAPHY.scale.h2.size};
  --dm-fs-h3: ${DM_TYPOGRAPHY.scale.h3.size};
  --dm-fs-body: ${DM_TYPOGRAPHY.scale.body.size};
  --dm-fs-small: ${DM_TYPOGRAPHY.scale.small.size};
  --dm-fs-tiny: ${DM_TYPOGRAPHY.scale.tiny.size};

  --dm-lh-hero: ${DM_TYPOGRAPHY.scale.hero.lineHeight};
  --dm-lh-h1: ${DM_TYPOGRAPHY.scale.h1.lineHeight};
  --dm-lh-h2: ${DM_TYPOGRAPHY.scale.h2.lineHeight};
  --dm-lh-h3: ${DM_TYPOGRAPHY.scale.h3.lineHeight};
  --dm-lh-body: ${DM_TYPOGRAPHY.scale.body.lineHeight};
  --dm-lh-small: ${DM_TYPOGRAPHY.scale.small.lineHeight};
  --dm-lh-tiny: ${DM_TYPOGRAPHY.scale.tiny.lineHeight};

  --dm-sp-0: 0; --dm-sp-1: 4px; --dm-sp-2: 8px; --dm-sp-3: 12px;
  --dm-sp-4: 16px; --dm-sp-5: 20px; --dm-sp-6: 24px; --dm-sp-8: 32px;
  --dm-sp-10: 40px; --dm-sp-12: 48px; --dm-sp-16: 64px; --dm-sp-20: 80px;
  --dm-section-pad-scale: 1;

  --dm-radius-none: 0; --dm-radius-sm: 4px; --dm-radius-md: 8px;
  --dm-radius-lg: 12px; --dm-radius-xl: 16px; --dm-radius-2xl: 24px;
  --dm-radius-full: 9999px;

  --dm-shadow-sm: ${DM_SHADOW.sm};
  --dm-shadow-md: ${DM_SHADOW.md};
  --dm-shadow-lg: ${DM_SHADOW.lg};
  --dm-shadow-xl: ${DM_SHADOW.xl};
${darkVars}}
`.trim();
}

/**
 * 뷰어 HTML의 <head> 안에 삽입할 기본 리셋/공통 CSS.
 * 토큰 변수 :root 블록은 renderDmTokensCss()로 별도 주입.
 */
export function renderDmBaseCss(): string {
  return `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  font-family: var(--dm-font-primary);
  font-size: var(--dm-fs-body);
  line-height: var(--dm-lh-body);
  color: var(--dm-neutral-900);
  background: var(--dm-neutral-100);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
a { color: inherit; text-decoration: none; }
img { max-width: 100%; display: block; }
button { font-family: inherit; cursor: pointer; border: 0; background: transparent; }

.dm-viewer {
  max-width: var(--dm-mobile-max, 430px);
  min-height: 100vh;
  margin: 0 auto;
  background: var(--dm-bg);
}

.dm-section {
  position: relative;
  /* ★ 2026-07-02(2) 한국어 단어 단위 줄바꿈 + 넘침 방지 — 긴 문구 잘림 근본 차단 */
  word-break: keep-all;
  overflow-wrap: anywhere;
}

/* ★ 2026-07-02(2) 타이포 유틸 — 에디터(dm-builder.css)와 동일 정의. 그동안 발행물에 이 클래스 정의가
   빠져 있어 .dm-text-hero(쿠폰 라벨·히어로 기본 구도 헤드라인 등)가 본문 크기로 렌더되던 결함 수정. */
.dm-text-hero  { font-size: var(--dm-fs-hero);  line-height: var(--dm-lh-hero);  font-weight: 800; letter-spacing: -0.02em; }
.dm-text-h1    { font-size: var(--dm-fs-h1);    line-height: var(--dm-lh-h1);    font-weight: 700; letter-spacing: -0.01em; }
.dm-text-h2    { font-size: var(--dm-fs-h2);    line-height: var(--dm-lh-h2);    font-weight: 700; }
.dm-text-h3    { font-size: var(--dm-fs-h3);    line-height: var(--dm-lh-h3);    font-weight: 600; }
.dm-text-body  { font-size: var(--dm-fs-body);  line-height: var(--dm-lh-body);  font-weight: 400; }
.dm-text-small { font-size: var(--dm-fs-small); line-height: var(--dm-lh-small); font-weight: 400; }
.dm-text-tiny  { font-size: var(--dm-fs-tiny);  line-height: var(--dm-lh-tiny);  font-weight: 400; }
/* ★ 2026-07-02 v2 — 오버라인 라벨(자간 넓은 소형 라벨 → 큰 헤드라인 3단 위계의 1단) */
.dm-overline   { font-size: 11px; font-weight: 700; letter-spacing: 0.18em; }

/* ★ 2026-07-02 v2 — 소형 화면 타입 축소 (디스플레이급 스케일의 375px 이하 보정) */
@media (max-width: 375px) {
  :root { --dm-fs-hero: 34px; --dm-fs-h1: 25px; }
}

/* ★ 2026-07-02(5) 발행물 디자인 격상 — 버튼 여백/자간/그림자 정돈 (이메일 톤)
   ★ 2026-07-07(5) 디자인 2.0 — 그라데이션 면 + 강조색 그림자 + 프레스 마이크로 인터랙션 (인앱 2.0 톤).
     값 변경 시 frontend/src/styles/dm-builder.css .dm-cta 동시 수정 필수 (에디터·발행물 시각 일치). */
.dm-cta {
  display: inline-block;
  padding: 14px 28px;
  min-height: 44px;
  min-width: 44px;
  border-radius: 14px;
  font-size: var(--dm-fs-body);
  font-weight: 800;
  letter-spacing: -0.01em;
  text-align: center;
  background: linear-gradient(180deg, var(--dm-primary) 0%, var(--dm-primary-hover) 100%);
  color: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.14), 0 8px 20px -6px rgba(15, 23, 42, 0.28);
  transition: filter 150ms ease-out, transform 100ms ease-out, box-shadow 150ms ease-out;
}
.dm-cta:hover { filter: brightness(1.06); box-shadow: 0 2px 4px rgba(15, 23, 42, 0.14), 0 12px 26px -6px rgba(15, 23, 42, 0.32); }
.dm-cta:active { transform: scale(0.97); }
.dm-cta-secondary { background: var(--dm-neutral-100); color: var(--dm-neutral-900); box-shadow: inset 0 0 0 1px var(--dm-neutral-200); }
.dm-cta-outline { background: transparent; border: 2px solid var(--dm-primary); color: var(--dm-primary); box-shadow: none; }

/* ★ 2026-07-07(5) 섹션 스크롤 리빌 — 뷰어 JS가 화면 밖 섹션에만 .dm-reveal 부여(no-JS = 전부 즉시 표시).
   reduced-motion은 JS에서 부여 자체를 건너뛴다. */
.dm-reveal { opacity: 0; transform: translateY(16px); }
.dm-reveal.dm-in {
  opacity: 1;
  transform: none;
  transition: opacity 550ms cubic-bezier(0.22, 1, 0.36, 1), transform 550ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* ★ 2026-07-07(5) 데스크탑 열람 — 슬레이트 틴트 배경 + 페이지 프레임 앰비언트 그림자 (모바일 무영향) */
@media (min-width: 480px) {
  body { background: linear-gradient(180deg, #eef0f5 0%, #e7eaf1 100%); }
  .dm-viewer { box-shadow: 0 24px 80px -24px rgba(15, 23, 42, 0.22), 0 2px 8px rgba(15, 23, 42, 0.06); }
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0ms !important; transition-duration: 0ms !important; }
}

@media (max-width: 375px) {
  :root { --dm-fs-hero: 28px; --dm-fs-h1: 22px; }
}
@media (max-width: 320px) {
  :root { --dm-fs-hero: 24px; --dm-fs-h1: 20px; }
}

/* 빈 이미지/콘텐츠 자리 — 휑한 빈칸 대신 옅은 점선 박스로 정제 */
.dm-mood-slot {
  background: var(--dm-neutral-50);
  border: 1px dashed var(--dm-neutral-300);
  border-radius: var(--dm-radius-lg);
  color: var(--dm-neutral-400);
}
`.trim();
}

// ────────────── 디자인 3.0 뷰어 CSS (2026-07-13) ──────────────

/**
 * ★ 2026-07-13 디자인 3.0 — 뷰어 전용 추가 CSS.
 *   ① 모션 2.0(CTA 맥동·쿠폰 샤인·히어로 켄번즈·초침 팝·게이지 성장·아이템 스태거)
 *   ② 아트디렉션 모티프/디바이더(body[data-dm-*])  ③ 섹션 배경면 클래스(dm-bgx-*)
 *   ④ 헤드라인 강조  ⑤ 그레인  ⑥ 스티키 CTA
 * reduced-motion = base css의 전역 0ms 규칙이 함께 적용되어 모션 전체 무력화.
 * 캔버스 미러: frontend/src/styles/dm-builder.css "디자인 3.0" 절 동기 수정 필수.
 */
export function renderDmDesign3Css(): string {
  return `
/* ── 모션 2.0: 시그니처 ── */
@keyframes dmCtaPulse { 0%,100% { box-shadow:0 1px 2px rgba(15,23,42,0.14), 0 8px 20px -6px rgba(15,23,42,0.28); } 50% { box-shadow:0 2px 4px rgba(15,23,42,0.16), 0 12px 30px -4px color-mix(in srgb, var(--dm-primary) 55%, transparent); } }
.dm-cta-primary { animation: dmCtaPulse 3.2s ease-in-out 1.6s infinite; }
@keyframes dmShine { 0% { transform: translateX(-160%) skewX(-18deg); } 60%,100% { transform: translateX(240%) skewX(-18deg); } }
.dm-coupon-card { position: relative; overflow: hidden; }
.dm-coupon-card::after { content:""; position:absolute; top:0; bottom:0; left:0; width:46%; pointer-events:none;
  background:linear-gradient(105deg, transparent 20%, rgba(255,255,255,0.32) 50%, transparent 80%);
  transform:translateX(-160%) skewX(-18deg); animation:dmShine 4.6s ease-in-out 1.2s infinite; }
@keyframes dmKenburns { from { transform: scale(1.06); } to { transform: scale(1); } }
.dm-hero-media { animation: dmKenburns 12s cubic-bezier(0.22,1,0.36,1) both; }
@keyframes dmSecPop { 0% { transform: scale(1.16); opacity: 0.8; } 45%,100% { transform: scale(1); opacity: 1; } }
.dm-countdown .cd-num[data-unit="s"] { display:inline-block; animation: dmSecPop 1s ease-out infinite; }
.dm-reveal .dm-lq-bar { transform: scaleX(0); transform-origin: left center; }
.dm-reveal.dm-in .dm-lq-bar { transform: scaleX(1); transition: transform 1.1s cubic-bezier(0.22,1,0.36,1) 0.25s; }
/* 리빌 아이템 스태거 — 상품/갤러리 카드가 차례로 떠오름 */
.dm-reveal :is(.dm-pc-items, .dm-gal-grid) > * { opacity:0; transform:translateY(12px); }
.dm-reveal.dm-in :is(.dm-pc-items, .dm-gal-grid) > * { opacity:1; transform:none;
  transition:opacity 500ms cubic-bezier(0.22,1,0.36,1), transform 500ms cubic-bezier(0.22,1,0.36,1); }
.dm-reveal.dm-in :is(.dm-pc-items, .dm-gal-grid) > :nth-child(2) { transition-delay: 0.07s; }
.dm-reveal.dm-in :is(.dm-pc-items, .dm-gal-grid) > :nth-child(3) { transition-delay: 0.14s; }
.dm-reveal.dm-in :is(.dm-pc-items, .dm-gal-grid) > :nth-child(4) { transition-delay: 0.21s; }
.dm-reveal.dm-in :is(.dm-pc-items, .dm-gal-grid) > :nth-child(5) { transition-delay: 0.28s; }
.dm-reveal.dm-in :is(.dm-pc-items, .dm-gal-grid) > :nth-child(6) { transition-delay: 0.35s; }

/* ── 섹션 배경면 (dm-bgx-*) — --dm-bg·중립 스케일을 섹션 범위로 재정의 ── */
.dm-bgx-soft { --dm-bg: color-mix(in srgb, var(--dm-primary) 6%, #ffffff); background: var(--dm-bg); }
.dm-bgx-tint { --dm-bg: color-mix(in srgb, var(--dm-primary) 14%, #ffffff); background: var(--dm-bg); }
.dm-bgx-dark { --dm-bg:#12151f; background:#12151f;
  --dm-neutral-0:#1b2130; --dm-neutral-50:#161b28; --dm-neutral-100:#1e2433; --dm-neutral-200:#2c3347;
  --dm-neutral-300:#3a4257; --dm-neutral-400:#8b94a7; --dm-neutral-500:#9aa3b5; --dm-neutral-600:#b7bfce;
  --dm-neutral-700:#cdd4e0; --dm-neutral-800:#e4e8f0; --dm-neutral-900:#f2f5fa; --dm-neutral-1000:#ffffff;
  --dm-primary-light: color-mix(in srgb, var(--dm-primary) 22%, #141926); }
.dm-bgx-gradient { --dm-bg: rgba(255,255,255,0);
  background: linear-gradient(155deg, var(--dm-primary), var(--dm-grad-to, color-mix(in srgb, var(--dm-primary) 35%, var(--dm-accent))));
  --dm-neutral-900:#ffffff; --dm-neutral-800:#f4f6fb; --dm-neutral-700:rgba(255,255,255,0.88);
  --dm-neutral-600:rgba(255,255,255,0.75); --dm-neutral-500:rgba(255,255,255,0.62); --dm-neutral-400:rgba(255,255,255,0.5);
  --dm-neutral-300:rgba(255,255,255,0.35); --dm-neutral-200:rgba(255,255,255,0.25); --dm-neutral-100:rgba(255,255,255,0.14);
  --dm-neutral-50:rgba(255,255,255,0.08); --dm-neutral-0:rgba(255,255,255,0.1); --dm-primary-light:rgba(255,255,255,0.14); }
.dm-bgx-glass { --dm-bg: rgba(255,255,255,0.6); background: rgba(255,255,255,0.6);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.dm-pullup { position:relative; z-index:2; margin-top:-26px; border-radius:24px 24px 0 0; overflow:hidden;
  box-shadow:0 -12px 32px -14px rgba(15,23,42,0.25); }
.dm-divider-svg { display:block; line-height:0; margin-bottom:-1px; color: var(--dm-bg); }
/* ★ 2026-07-15 그라데이션 연결부(임은지 신고) — 연결부는 섹션 하단이라 그라데이션 끝색(--dm-grad-to)으로 착색해야 이어짐(기존 시작색 var(--dm-primary)=배경 윗부분 색만 반영). 배경면 gradient 정의와 동일 폴백. */
.dm-bgx-gradient + .dm-divider-svg, .dm-bgx-gradient .dm-divider-svg { color: var(--dm-grad-to, color-mix(in srgb, var(--dm-primary) 35%, var(--dm-accent))); }
/* ★ 2026-07-14 하단 연결부 미반영(남지현 신고) — divider가 배경면 div 바깥이라 color:var(--dm-bg)가 페이지 기본 흰색으로 풀림. 배경면 변형별 실제 색 지정. */
.dm-bgx-soft + .dm-divider-svg, .dm-bgx-soft .dm-divider-svg { color: color-mix(in srgb, var(--dm-primary) 6%, #ffffff); }
.dm-bgx-tint + .dm-divider-svg, .dm-bgx-tint .dm-divider-svg { color: color-mix(in srgb, var(--dm-primary) 14%, #ffffff); }
.dm-bgx-dark + .dm-divider-svg, .dm-bgx-dark .dm-divider-svg { color: #12151f; }
.dm-bgx-glass + .dm-divider-svg, .dm-bgx-glass .dm-divider-svg { color: rgba(255,255,255,0.6); }
.dm-divider-svg svg { display:block; width:100%; height:26px; }
.dm-sticky-cta { position:sticky; bottom:0; z-index:40; }
.dm-sticky-bar { backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }

/* ── 아트디렉션 모티프 — 제목(.dm-text-h2) 장식 ── */
body[data-dm-motif="rule"] .dm-section .dm-text-h2::before { content:""; display:block; width:30px; height:3px;
  background:var(--dm-accent); border-radius:2px; margin-bottom:10px; }
body[data-dm-motif="dot"] .dm-section .dm-text-h2::after { content:"."; color:var(--dm-primary); }
body[data-dm-motif="bracket"] .dm-section .dm-text-h2::before { content:"「"; color:var(--dm-accent); margin-right:2px; }
body[data-dm-motif="bracket"] .dm-section .dm-text-h2::after { content:"」"; color:var(--dm-accent); margin-left:2px; }
body[data-dm-motif="index"] .dm-viewer { counter-reset: dmsec; }
body[data-dm-motif="index"] .dm-section-wrap:not([data-section-type="header"]):not([data-section-type="footer"]) { counter-increment: dmsec; }
body[data-dm-motif="index"] .dm-section-wrap:not([data-section-type="header"]):not([data-section-type="footer"]) .dm-text-h2::before {
  content: counter(dmsec, decimal-leading-zero); display:block; font-size:11px; font-weight:800; letter-spacing:0.2em;
  color:var(--dm-primary); margin-bottom:8px; font-family:var(--dm-font-mono); }

/* ── 아트디렉션 섹션 디바이더 ── */
body[data-dm-divider="hairline"] .dm-page > .dm-section-wrap + .dm-section-wrap { border-top:1px solid var(--dm-neutral-200); }
body[data-dm-divider="gap"] .dm-page > .dm-section-wrap + .dm-section-wrap { margin-top:14px; }
body[data-dm-divider="rule"] .dm-page > .dm-section-wrap + .dm-section-wrap::before { content:""; display:block; width:44px; height:2px;
  background:var(--dm-primary); opacity:0.6; margin:18px auto; border-radius:2px; }

/* ── 헤드라인 강조 ── */
.dm-em-marker { background:linear-gradient(180deg, transparent 55%, color-mix(in srgb, var(--dm-accent) 45%, transparent) 55%);
  border-radius:2px; padding:0 2px; box-decoration-break:clone; -webkit-box-decoration-break:clone; }
.dm-em-underline { text-decoration:underline; text-decoration-color:var(--dm-accent); text-decoration-thickness:0.14em; text-underline-offset:0.18em; }

/* ── 필름 그레인 (테마 옵션) ── */
.dm-grain { position:fixed; inset:0; z-index:90; pointer-events:none; opacity:0.05; mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E"); }
`.trim();
}

/** 디자인 3.0 — 섹션 연결부(웨이브/사선/커브) SVG. fill=currentColor → .dm-divider-svg의 color(--dm-bg)로 착색 */
export function renderDmDividerSvg(shape: 'wave' | 'slant' | 'curve'): string {
  const paths: Record<string, string> = {
    wave:  'M0 0 H375 V8 C312 24 250 24 187 14 C125 4 62 4 0 16 Z',
    slant: 'M0 0 H375 V4 L0 22 Z',
    curve: 'M0 0 H375 V6 C250 24 125 24 0 6 Z',
  };
  return `<div class="dm-divider-svg" aria-hidden="true"><svg viewBox="0 0 375 26" preserveAspectRatio="none"><path d="${paths[shape] || paths.wave}" fill="currentColor"/></svg></div>`;
}

// ────────────── WCAG 대비 계산 (검수 엔진용) ──────────────

/**
 * 두 색의 WCAG 대비비 계산. AA 기준 4.5:1 이상.
 */
export function getContrastRatio(fgHex: string, bgHex: string): number {
  const lum = (hex: string): number => {
    const h = hex.replace('#', '');
    if (h.length !== 6) return 0;
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const ch = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const l1 = lum(fgHex);
  const l2 = lum(bgHex);
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/** brandKit의 primary_color가 흰 배경에서 WCAG AA 통과하는지 확인 */
export function isBrandKitPrimaryAccessible(brandKit?: DmBrandKit): boolean {
  const primary = brandKit?.primary_color || DM_COLOR_TOKENS.brand.primary;
  return getContrastRatio(primary, '#ffffff') >= 4.5;
}
