/**
 * ★ 디자인 4.0 M1 — design-core 값 동일성 + 품질 게이트 테스트 (2026-07-14)
 *
 * 코어 상수가 현행 채널 값과 동일함을 기계 대조 — M2(코어 소비 전환)의 안전망.
 * backend 공개 API(dm-tokens·email-tokens·dm-art-direction)와 대조한다.
 * FE·SDK 미러 대조는 design-core-mirror.test.ts(M3) 담당.
 */
import { describe, it, expect } from 'vitest';
import { CORE_PALETTES, getCorePalette, signaturePaletteIds } from '../palette';
import { CORE_TYPE_SCALE, CORE_DENSITY_SCALE, CORE_TONE_DEFAULTS, CHANNEL_CAPABILITIES, resolveTreatmentFailClosed } from '../art-direction';
import { CORE_FONTS, coreGoogleFontsUrl } from '../fonts';
import { recommendPalettesForTone, EMAIL_TEMPLATE_THEME, INAPP_SCENARIO_CARD_STYLE } from '../recommend';
import { CORE_GOLDEN_TEMPLATES, validateAllGoldenTemplates, validateGoldenTemplate } from '../template-registry';
import { compileTemplateForDm, compileTemplateForEmail, compileTemplateForInapp } from '../template-compilers';
import { DM_FONT_CATALOG, DM_TYPOGRAPHY } from '../../dm/dm-tokens';
import { EMAIL_FONT_CATALOG } from '../../email/email-tokens';
import { normalizeArtDirection, artDirectionToCssVars, TREATMENTS } from '../../dm/dm-art-direction';
import { EMAIL_TREATMENTS, selectEmailTreatment } from '../../email/email-blocks';
import { INAPP_THEME_KEYS } from '../../inapp-message';

describe('M1 — 코어 타입스케일/밀도 == 현행 채널 값', () => {
  it('DM artDirectionToCssVars 출력과 코어 값 일치 (3 타입스케일)', () => {
    for (const ts of ['editorial', 'bold', 'minimal'] as const) {
      const css = artDirectionToCssVars(normalizeArtDirection({ typeScale: ts }, 'general'));
      const core = CORE_TYPE_SCALE[ts];
      expect(css).toContain(`--dm-fs-hero:${core.hero}`);
      expect(css).toContain(`--dm-fw-hero:${core.heroWeight}`);
      expect(css).toContain(`--dm-ls-hero:${core.heroLs}`);
      expect(css).toContain(`--dm-fs-h1:${core.h1}`);
    }
  });

  it('DM 밀도 배율과 코어 값 일치', () => {
    for (const d of ['compact', 'standard', 'airy'] as const) {
      const css = artDirectionToCssVars(normalizeArtDirection({ spacingDensity: d }, 'general'));
      expect(css).toContain(`--dm-section-pad-scale:${CORE_DENSITY_SCALE[d]}`);
    }
  });

  it('기본(미설정) 타입스케일 = DM_TYPOGRAPHY.scale.hero와 동일 계열(40px 에디토리얼 기준)', () => {
    expect(CORE_TYPE_SCALE.editorial.hero).toBe(DM_TYPOGRAPHY.scale.hero.size);
    expect(String(DM_TYPOGRAPHY.scale.hero.weight)).toBe(CORE_TYPE_SCALE.editorial.heroWeight);
  });

  it('톤 기본 경향 — DM 소비값과 동일(에디토리얼/볼드/미니멀 축)', () => {
    const premium = artDirectionToCssVars(normalizeArtDirection(null, 'general', 'premium'));
    expect(premium).toContain(`--dm-fs-hero:${CORE_TYPE_SCALE[CORE_TONE_DEFAULTS.premium.typeScale].hero}`);
    const urgent = artDirectionToCssVars(normalizeArtDirection(null, 'general', 'urgent'));
    expect(urgent).toContain(`--dm-fs-hero:${CORE_TYPE_SCALE[CORE_TONE_DEFAULTS.urgent.typeScale].hero}`);
  });
});

describe('M1 — 코어 서체 카탈로그 == 현행 2벌(backend)', () => {
  it('DM_FONT_CATALOG 6종과 id/label/css/google 일치', () => {
    expect(CORE_FONTS.length).toBe(DM_FONT_CATALOG.length);
    for (let i = 0; i < CORE_FONTS.length; i++) {
      expect(CORE_FONTS[i].id).toBe(DM_FONT_CATALOG[i].id);
      expect(CORE_FONTS[i].label).toBe(DM_FONT_CATALOG[i].label);
      expect(CORE_FONTS[i].css).toBe(DM_FONT_CATALOG[i].css);
      expect(CORE_FONTS[i].google).toBe(DM_FONT_CATALOG[i].google);
    }
  });

  it('EMAIL_FONT_CATALOG 6종과 id/match/emailCss/google 일치', () => {
    expect(CORE_FONTS.length).toBe(EMAIL_FONT_CATALOG.length);
    for (let i = 0; i < CORE_FONTS.length; i++) {
      expect(CORE_FONTS[i].id).toBe(EMAIL_FONT_CATALOG[i].id);
      expect(CORE_FONTS[i].match).toBe(EMAIL_FONT_CATALOG[i].match);
      expect(CORE_FONTS[i].emailCss).toBe(EMAIL_FONT_CATALOG[i].css);
      expect(CORE_FONTS[i].google).toBe(EMAIL_FONT_CATALOG[i].google);
    }
  });

  it('coreGoogleFontsUrl — 카탈로그 밖 문자열 = null (화이트리스트)', () => {
    expect(coreGoogleFontsUrl('"Evil Font", cursive')).toBeNull();
    expect(coreGoogleFontsUrl('"Noto Serif KR", serif')).toContain('Noto+Serif+KR');
    expect(coreGoogleFontsUrl(undefined, null)).toBeNull();
  });
});

describe('M1 — 팔레트/추천/화이트리스트 구조', () => {
  it('근원 팔레트 8종 + 시그니처 7종(minimal 제외)', () => {
    expect(CORE_PALETTES.length).toBe(8);
    expect(signaturePaletteIds()).toEqual(['editorial', 'luxury-dark', 'bold-sale', 'soft-pastel', 'paper', 'city-night', 'festive']);
  });

  it('인앱 테마 화이트리스트 = 기본 6 + 코어 시그니처 7 (INAPP_THEME_KEYS 대조)', () => {
    expect(INAPP_THEME_KEYS.length).toBe(13);
    for (const id of signaturePaletteIds()) {
      expect(INAPP_THEME_KEYS as readonly string[]).toContain(id);
    }
  });

  it('전 팔레트 hex 형식 + 아트디렉션 enum 유효', () => {
    for (const p of CORE_PALETTES) {
      expect(p.primary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['editorial', 'bold', 'minimal']).toContain(p.artDirection.typeScale);
      if (p.inapp.signature) expect(p.inapp.defaultAccent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('톤 추천 — dm-themes recommendedTones 이관값 보존', () => {
    expect(recommendPalettesForTone('premium')).toEqual(['editorial', 'luxury-dark', 'city-night']);
    expect(recommendPalettesForTone('urgent')).toEqual(['bold-sale', 'city-night', 'festive']);
    expect(recommendPalettesForTone(undefined)).toEqual([]);
  });

  it('이메일 템플릿→테마 12종 + 인앱 시나리오 형태 7종 — 전부 등록 팔레트/유효 값', () => {
    expect(Object.keys(EMAIL_TEMPLATE_THEME).length).toBe(12);
    for (const id of Object.values(EMAIL_TEMPLATE_THEME)) expect(getCorePalette(id)).toBeTruthy();
    expect(Object.keys(INAPP_SCENARIO_CARD_STYLE).length).toBe(7);
  });

  it('fail-closed 공용 해석기 — DM·이메일 허용표 규약과 동일 동작', () => {
    expect(resolveTreatmentFailClosed(TREATMENTS, 'hero', 'typographic')).toBe('typographic');
    expect(resolveTreatmentFailClosed(TREATMENTS, 'hero', 'nope')).toBe('classic');
    expect(resolveTreatmentFailClosed(EMAIL_TREATMENTS, 'coupon', 'spotlight')).toBe(selectEmailTreatment('coupon', 'spotlight'));
    expect(resolveTreatmentFailClosed(EMAIL_TREATMENTS, 'coupon', 'ticket')).toBe(selectEmailTreatment('coupon', 'ticket'));
  });

  it('채널 능력표 — 이메일 모션 0·인앱 그레인 0 명시', () => {
    expect(CHANNEL_CAPABILITIES.email.motion).toBe(false);
    expect(CHANNEL_CAPABILITIES.inapp.grain).toBe(false);
    expect(CHANNEL_CAPABILITIES.dm.motion).toBe(true);
  });
});

describe('M4 — 정예 10종 품질 게이트', () => {
  it('등록 10종 전건 게이트 위반 0', () => {
    expect(CORE_GOLDEN_TEMPLATES.length).toBe(10);
    expect(validateAllGoldenTemplates()).toEqual([]);
  });

  it('difference 서술 전건 유일', () => {
    const set = new Set(CORE_GOLDEN_TEMPLATES.map((t) => t.difference.trim()));
    expect(set.size).toBe(10);
  });

  it('게이트가 불량 템플릿을 실제로 거른다', () => {
    const bad = {
      ...CORE_GOLDEN_TEMPLATES[0],
      id: 'bad',
      difference: '짧음',
      story: { logic: '', blocks: [{ role: 'hook', kind: 'headline', copy: { headline: '20% 할인!' } }] },
      dataSlots: [],
    } as any;
    const v = validateGoldenTemplate(bad, CORE_GOLDEN_TEMPLATES);
    const gates = v.map((x) => x.gate);
    expect(gates).toContain(1); // difference 부실
    expect(gates).toContain(2); // 스토리 논리 부재
    expect(gates).toContain(3); // 데이터 슬롯 0
    expect(gates).toContain(6); // 혜택 수치
  });
});

describe('M4 — 채널 컴파일러(가지) 산출 유효성', () => {
  it('DM — 전 템플릿이 유효 섹션 골격 + 팔레트 패치 산출', () => {
    for (const t of CORE_GOLDEN_TEMPLATES) {
      const { sections, brandKitPatch } = compileTemplateForDm(t, { contact: { phone: '1544-0000' } });
      expect(sections[0].type).toBe('header');
      expect(sections[sections.length - 1].type).toBe('footer');
      expect(sections.length).toBeGreaterThanOrEqual(4);
      // 구도 값이 DM 허용표 안인지 (fail-closed 렌더러 이중 검증과 별개로 컴파일 단계 보장)
      for (const s of sections) {
        const tr = (s as any).treatment;
        if (tr) expect(resolveTreatmentFailClosed(TREATMENTS, s.type as string, tr)).toBe(tr);
      }
      expect(brandKitPatch.art_direction?.theme).toBe(t.design.palette);
    }
  });

  it('이메일 — 전 템플릿이 화이트리스트 섹션 + 안전 구도만 산출', () => {
    const WHITELIST = ['header', 'hero', 'text_card', 'cta', 'coupon', 'promo_code', 'product_carousel', 'gallery', 'store_info', 'sns', 'reviews', 'footer', 'countdown'];
    for (const t of CORE_GOLDEN_TEMPLATES) {
      const { sections, design } = compileTemplateForEmail(t, { contact: { phone: '1544-0000' } });
      for (const s of sections) {
        expect(WHITELIST).toContain(s.type as string);
        const tr = (s as any).treatment;
        if (tr && EMAIL_TREATMENTS[s.type as string]) {
          expect(selectEmailTreatment(s.type as string, tr)).toBe(tr);
        }
      }
      expect(design.theme).toBe(t.design.palette);
      expect(design.palette?.primary).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('인앱 — 전 템플릿이 허용 블록 + 화이트리스트 테마만 산출 + CTA URL placeholder', () => {
    const BLOCK_TYPES = ['eyebrow', 'headline', 'body', 'benefit', 'cta_group', 'media', 'divider'];
    for (const t of CORE_GOLDEN_TEMPLATES) {
      const c = compileTemplateForInapp(t);
      expect(INAPP_THEME_KEYS as readonly string[]).toContain(c.theme);
      for (const b of c.content_blocks) {
        expect(BLOCK_TYPES).toContain(String(b.type));
      }
      const cta = c.content_blocks.find((b) => b.type === 'cta_group') as any;
      if (cta) expect(cta.buttons[0].action_url).toBe('[URL — 회사 admin 수정]');
    }
  });

  it('혜택 수치 0 — 3채널 산출물 직렬화에 금지 패턴 없음', () => {
    const re = /\d+\s*%|\d+\s*원|무료|증정|사은품/;
    for (const t of CORE_GOLDEN_TEMPLATES) {
      expect(re.test(JSON.stringify(compileTemplateForDm(t).sections))).toBe(false);
      expect(re.test(JSON.stringify(compileTemplateForEmail(t).sections))).toBe(false);
      expect(re.test(JSON.stringify(compileTemplateForInapp(t).content_blocks))).toBe(false);
    }
  });

  it('실데이터 엣지 — 긴 상품명·빈 이미지에도 골격 성립(게이트 4 기계 표본)', () => {
    const t = CORE_GOLDEN_TEMPLATES.find((x) => x.id === 'cart-recovery')!;
    const { sections } = compileTemplateForDm(t);
    const pc = sections.find((s) => s.type === 'product_carousel') as any;
    expect(pc).toBeTruthy();
    expect(Array.isArray(pc.props.products)).toBe(true); // 빈 상품 = 편집기/자동채움이 주입
  });
});
