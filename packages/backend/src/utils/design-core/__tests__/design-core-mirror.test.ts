/**
 * ★ 디자인 4.0 M3 — 미러 동기 테스트 (2026-07-14)
 *
 * 물리 격리(패키지 분리)로 코드 공유가 불가한 FE·SDK 미러의 값을 코어와 기계 대조.
 * 수동 SSOT 주석 동기(사고 표면) → 자동 검증으로 승격. 미러 드리프트 = 이 테스트가 즉시 적발.
 *
 * 교차 패키지 import는 vitest(esbuild)만 수행 — backend tsc는 테스트 파일 제외(tsconfig exclude)라
 * 빌드 영향 0. FE 파일의 react/store import는 전부 type-only(트랜스파일 시 소거)임을 전제로 하며,
 * 그 전제가 깨지면 이 테스트가 import 단계에서 실패해 즉시 드러난다.
 */
import { describe, it, expect } from 'vitest';
import { CORE_PALETTES, signaturePaletteIds } from '../palette';
import { CORE_TYPE_SCALE, CORE_DENSITY_SCALE } from '../art-direction';
import { CORE_FONTS } from '../fonts';
import { EMAIL_TEMPLATE_THEME } from '../recommend';
import { paletteToDmBrandKitPatch, paletteToEmailDesign } from '../template-compilers';
import { TREATMENTS as BE_DM_TREATMENTS } from '../../dm/dm-art-direction';
import { EMAIL_TREATMENTS as BE_EMAIL_TREATMENTS } from '../../email/email-blocks';
import { INAPP_THEME_KEYS } from '../../inapp-message';

// ── FE 미러 (frontend 패키지 — 순수 상수/type-only import 파일만) ──
import { DM_FONT_CATALOG as FE_DM_FONT_CATALOG, dmArtDirectionCssVars as feArtDirectionCssVars } from '../../../../../frontend/src/utils/dm-tokens';
import { DM_TREATMENTS as FE_DM_TREATMENTS } from '../../../../../frontend/src/utils/dm-treatment';
import { DM_DESIGN_THEMES as FE_DM_THEMES } from '../../../../../frontend/src/utils/dm-themes';
import { EMAIL_DESIGN_THEMES as FE_EMAIL_THEMES, EMAIL_TREATMENT_OPTIONS as FE_EMAIL_TREATMENT_OPTIONS } from '../../../../../frontend/src/utils/email-themes';
import { EMAIL_TEMPLATES as FE_EMAIL_TEMPLATES } from '../../../../../frontend/src/utils/email-templates';
import {
  resolveTheme as feResolveTheme,
  SIGNATURE_THEME_KEYS as FE_SIGNATURE_KEYS,
  INAPP_FONT_CATALOG as FE_INAPP_FONT_CATALOG,
} from '../../../../../frontend/src/components/inapp/blockTheme';

// ── SDK 미러 (sdk-js 패키지 — 순수 파일) ──
import {
  resolveTheme as sdkResolveTheme,
  SIGNATURE_THEME_KEYS as SDK_SIGNATURE_KEYS,
  INAPP_FONT_CATALOG as SDK_INAPP_FONT_CATALOG,
  type ThemeKey,
} from '../../../../../sdk-js/src/inapp-theme';

describe('M3 — DM FE 미러 == 코어', () => {
  it('타입스케일·밀도 CSS 변수 (FE 캔버스 == 코어 값)', () => {
    for (const ts of ['editorial', 'bold', 'minimal'] as const) {
      const vars = feArtDirectionCssVars({ typeScale: ts }) as Record<string, string>;
      expect(vars['--dm-fs-hero']).toBe(CORE_TYPE_SCALE[ts].hero);
      expect(vars['--dm-fw-hero']).toBe(CORE_TYPE_SCALE[ts].heroWeight);
      expect(vars['--dm-ls-hero']).toBe(CORE_TYPE_SCALE[ts].heroLs);
      expect(vars['--dm-fs-h1']).toBe(CORE_TYPE_SCALE[ts].h1);
    }
    for (const d of ['compact', 'standard', 'airy'] as const) {
      const vars = feArtDirectionCssVars({ spacingDensity: d }) as Record<string, string>;
      expect(vars['--dm-section-pad-scale']).toBe(String(CORE_DENSITY_SCALE[d]));
    }
  });

  it('서체 카탈로그 (FE == 코어)', () => {
    expect(FE_DM_FONT_CATALOG.length).toBe(CORE_FONTS.length);
    for (let i = 0; i < CORE_FONTS.length; i++) {
      expect(FE_DM_FONT_CATALOG[i].id).toBe(CORE_FONTS[i].id);
      expect(FE_DM_FONT_CATALOG[i].label).toBe(CORE_FONTS[i].label);
      expect(FE_DM_FONT_CATALOG[i].css).toBe(CORE_FONTS[i].css);
      expect(FE_DM_FONT_CATALOG[i].google).toBe(CORE_FONTS[i].google);
    }
  });

  it('구도 허용표 (FE == BE — 10섹션 전수)', () => {
    expect(Object.keys(FE_DM_TREATMENTS).sort()).toEqual(Object.keys(BE_DM_TREATMENTS).sort());
    for (const k of Object.keys(BE_DM_TREATMENTS)) {
      expect([...FE_DM_TREATMENTS[k]]).toEqual([...BE_DM_TREATMENTS[k]]);
    }
  });

  it('테마 8종 — FE dm-themes kit == 코어 파생(paletteToDmBrandKitPatch)', () => {
    expect(FE_DM_THEMES.length).toBe(CORE_PALETTES.length);
    for (const pal of CORE_PALETTES) {
      const fe = FE_DM_THEMES.find((t) => t.id === pal.id)!;
      expect(fe, `FE dm-themes에 ${pal.id} 부재`).toBeTruthy();
      expect(fe.kit).toEqual(paletteToDmBrandKitPatch(pal));
      expect(fe.swatches).toEqual(pal.swatches);
    }
  });
});

describe('M3 — 이메일 FE 미러 == 코어', () => {
  it('테마 8종 — FE email-themes design == 코어 파생(paletteToEmailDesign)', () => {
    expect(FE_EMAIL_THEMES.length).toBe(CORE_PALETTES.length);
    for (const pal of CORE_PALETTES) {
      const fe = FE_EMAIL_THEMES.find((t) => t.id === pal.id)!;
      expect(fe, `FE email-themes에 ${pal.id} 부재`).toBeTruthy();
      expect(fe.design).toEqual(paletteToEmailDesign(pal));
      expect(fe.swatches).toEqual(pal.swatches);
    }
  });

  it('FE 구도 픽커 옵션 ⊆ BE EMAIL_TREATMENTS (허용표 밖 옵션 노출 차단)', () => {
    for (const [section, options] of Object.entries(FE_EMAIL_TREATMENT_OPTIONS)) {
      const allowed = BE_EMAIL_TREATMENTS[section];
      expect(allowed, `BE 허용표에 ${section} 부재`).toBeTruthy();
      for (const o of options) {
        expect(allowed, `${section}.${o.value} 허용표 밖`).toContain(o.value);
      }
    }
  });

  it('FE 골든 템플릿 → 테마 매핑 == 코어 EMAIL_TEMPLATE_THEME', () => {
    for (const t of FE_EMAIL_TEMPLATES) {
      const feTheme = t.design?.theme;
      const coreTheme = EMAIL_TEMPLATE_THEME[t.key];
      expect(feTheme, `${t.key} 테마 미지정`).toBeTruthy();
      expect(feTheme).toBe(coreTheme);
    }
    expect(Object.keys(EMAIL_TEMPLATE_THEME).length).toBe(FE_EMAIL_TEMPLATES.length);
  });
});

describe('M3 — 인앱 SDK·FE 미러 == 코어', () => {
  const ALL_KEYS = ['auto', 'light', 'dark', 'brand', 'vibrant', 'minimal', ...SDK_SIGNATURE_KEYS] as ThemeKey[];

  it('시그니처 키 목록 — SDK == FE == 코어(signaturePaletteIds)', () => {
    expect([...SDK_SIGNATURE_KEYS]).toEqual(signaturePaletteIds());
    expect([...FE_SIGNATURE_KEYS]).toEqual(signaturePaletteIds());
    expect([...INAPP_THEME_KEYS]).toEqual(['auto', 'light', 'dark', 'brand', 'vibrant', 'minimal', ...signaturePaletteIds()]);
  });

  it('시그니처 기본 강조색 — SDK 해석값 == 코어 inapp.defaultAccent', () => {
    for (const pal of CORE_PALETTES.filter((p) => p.inapp.signature)) {
      const t = sdkResolveTheme(pal.id, null);
      expect(t.accent, `${pal.id} 기본 accent 불일치`).toBe(pal.inapp.defaultAccent);
    }
  });

  it('테마 토큰 전량 — FE blockTheme == SDK inapp-theme (13키 × 기본/회사색/다크)', () => {
    for (const key of ALL_KEYS) {
      expect(feResolveTheme(key, null)).toEqual(sdkResolveTheme(key, null));
      expect(feResolveTheme(key, '#10b981')).toEqual(sdkResolveTheme(key, '#10b981'));
      expect(feResolveTheme(key, null, { prefersDark: true })).toEqual(sdkResolveTheme(key, null, { prefersDark: true }));
    }
  });

  it('서체 카탈로그 — SDK == FE == 코어(css/google)', () => {
    expect(SDK_INAPP_FONT_CATALOG.length).toBe(CORE_FONTS.length);
    for (let i = 0; i < CORE_FONTS.length; i++) {
      expect(SDK_INAPP_FONT_CATALOG[i].id).toBe(CORE_FONTS[i].id);
      expect(SDK_INAPP_FONT_CATALOG[i].css).toBe(CORE_FONTS[i].css);
      expect(SDK_INAPP_FONT_CATALOG[i].google).toBe(CORE_FONTS[i].google);
      expect(FE_INAPP_FONT_CATALOG[i].css).toBe(CORE_FONTS[i].css);
      expect(FE_INAPP_FONT_CATALOG[i].google).toBe(CORE_FONTS[i].google);
    }
  });
});
