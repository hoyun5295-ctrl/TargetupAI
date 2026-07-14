/**
 * ★ 디자인 4.0 — 3채널 적용 왕복 테스트 (2026-07-14 Harold 지시: "세 경로에 완벽 적용됐는지가 더 중요")
 *
 * 컴파일 산출물이 각 채널의 실제 렌더러·저장 게이트를 끝까지 통과하는지 실행으로 증명한다.
 *   DM     : compileTemplateForDm → renderSections (발행물 SSR 실렌더)
 *   이메일 : compileTemplateForEmail → normalizeEmailDesign → renderEmailSections (발송 HTML 실렌더)
 *   인앱   : compileTemplateForInapp → sanitizeContentBlocks/normalizeTheme/sanitizeInAppDesign (저장 게이트 실통과)
 * 추가로 "혜택 placeholder → 채널 미편집 차단 게이트" 연동까지 확인 (AI 임의 혜택 영구 룰의 끝단).
 */
import { describe, it, expect } from 'vitest';
import { CORE_GOLDEN_TEMPLATES } from '../template-registry';
import { compileTemplateForDm, compileTemplateForEmail, compileTemplateForInapp } from '../template-compilers';
import { renderSections } from '../../dm/dm-section-renderer';
import { normalizeArtDirection } from '../../dm/dm-art-direction';
import type { DmBrandKit } from '../../dm/dm-tokens';
import { renderEmailSections } from '../../email/email-section-renderer';
import { normalizeEmailDesign } from '../../email/email-tokens';
import {
  sanitizeContentBlocks, normalizeTheme, normalizeCardStyle, sanitizeInAppDesign, blocksHaveUneditedPlaceholder,
} from '../../inapp-message';

const CONTACT = { contact: { phone: '1544-0000' }, brandName: '한줄로상회' };
/** 스토리 블록의 사용자 노출 카피 전부 (헤드라인·본문) */
function copyTexts(tplId: string): string[] {
  const t = CORE_GOLDEN_TEMPLATES.find((x) => x.id === tplId)!;
  return t.story.blocks.flatMap((b) => [b.copy?.headline, b.copy?.body].filter(Boolean) as string[]);
}

describe('왕복 — DM: 컴파일 → 발행물 SSR 실렌더', () => {
  it('10종 전건 — 카피 보존·고객센터 주입·깨진 값 0', () => {
    for (const t of CORE_GOLDEN_TEMPLATES) {
      const c = compileTemplateForDm(t, CONTACT);
      const ad = normalizeArtDirection(c.brandKitPatch.art_direction as any, 'general');
      const html = renderSections(c.sections, { brandKit: c.brandKitPatch as DmBrandKit, artDirection: ad });
      expect(html.length, `${t.id} 렌더 빈 출력`).toBeGreaterThan(500);
      for (const copy of copyTexts(t.id)) {
        // %고객명%은 발송 시 치환 — 골격 렌더에는 원문 그대로 보존돼야 함
        expect(html, `${t.id} 카피 유실: ${copy.slice(0, 20)}`).toContain(copy.slice(0, 10));
      }
      expect(html, `${t.id} 고객센터 미주입`).toContain('1544-0000');
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('[object Object]');
      expect(html).not.toContain('<script');
    }
  });

  it('마감 세일 — 카운트다운 배너 + 스티키 CTA 구도가 실렌더에 반영', () => {
    const t = CORE_GOLDEN_TEMPLATES.find((x) => x.id === 'deadline-sale')!;
    const c = compileTemplateForDm(t, CONTACT);
    const html = renderSections(c.sections, { brandKit: c.brandKitPatch as DmBrandKit });
    expect(html).toContain('data-treatment="banner"');
    expect(html).toContain('data-treatment="sticky"');
  });

  it('에디토리얼 계열 — 타이포 히어로 구도가 실렌더에 반영', () => {
    const t = CORE_GOLDEN_TEMPLATES.find((x) => x.id === 'new-arrival')!;
    const c = compileTemplateForDm(t, CONTACT);
    const html = renderSections(c.sections, { brandKit: c.brandKitPatch as DmBrandKit });
    expect(html).toContain('data-treatment="typographic"');
  });
});

describe('왕복 — 이메일: 컴파일 → design 정규화 → 발송 HTML 실렌더', () => {
  it('10종(이메일 포함 채널) 전건 — 카피 보존·고객센터·테마 색 반영·깨진 값 0', () => {
    for (const t of CORE_GOLDEN_TEMPLATES.filter((x) => x.channels.email.include)) {
      const c = compileTemplateForEmail(t, CONTACT);
      const design = normalizeEmailDesign(c.design);
      expect(design, `${t.id} design 정규화 전탈락`).not.toBeNull();
      expect(design!.theme, `${t.id} 테마 키 유실`).toBe(t.design.palette);
      const html = renderEmailSections(c.sections, { design });
      expect(html.length, `${t.id} 렌더 빈 출력`).toBeGreaterThan(500);
      for (const copy of copyTexts(t.id)) {
        expect(html, `${t.id} 카피 유실: ${copy.slice(0, 20)}`).toContain(copy.slice(0, 10));
      }
      expect(html, `${t.id} 고객센터 미주입`).toContain('1544-0000');
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('[object Object]');
    }
  });

  it('혜택 placeholder → 발송 차단 게이트 패턴에 걸리는 형태로 HTML에 도달', () => {
    // email.ts 발송 게이트 = /\[[^\[\]\n]{0,60}(직접|입력해|작성해)[^\[\]\n]{0,60}\]/ — 아래 문자열이 그 패턴과 일치
    for (const id of ['deadline-sale', 'vip-private']) {
      const t = CORE_GOLDEN_TEMPLATES.find((x) => x.id === id)!;
      const c = compileTemplateForEmail(t, CONTACT);
      const html = renderEmailSections(c.sections, { design: normalizeEmailDesign(c.design) });
      expect(html, `${id} 혜택 placeholder 유실 — 미편집 발송 차단 불가`).toMatch(/\[[^\[\]\n]{0,60}(직접|입력해|작성해)[^\[\]\n]{0,60}\]/);
    }
  });

  it('다크 테마(vip-private=luxury-dark) — 다크 셸 값이 실렌더에 반영', () => {
    const t = CORE_GOLDEN_TEMPLATES.find((x) => x.id === 'vip-private')!;
    const c = compileTemplateForEmail(t, CONTACT);
    const html = renderEmailSections(c.sections, { design: normalizeEmailDesign(c.design) });
    expect(html).toContain('#171717'); // 다크 카드 면 리터럴 원칙
  });
});

describe('왕복 — 인앱: 컴파일 → 저장 게이트(정규화·화이트리스트) 실통과', () => {
  it('10종 전건 — 블록 무손실 통과·테마/형태 강등 0·design 보존', () => {
    for (const t of CORE_GOLDEN_TEMPLATES.filter((x) => x.channels.inapp.include)) {
      const c = compileTemplateForInapp(t);
      const sanitized = sanitizeContentBlocks(c.content_blocks as any[]);
      expect(sanitized.length, `${t.id} sanitize에서 블록 유실 (${c.content_blocks.length}→${sanitized.length})`).toBe(c.content_blocks.length);
      expect(normalizeTheme(c.theme), `${t.id} 테마 강등`).toBe(c.theme);
      expect(normalizeCardStyle(c.card_style), `${t.id} 카드 형태 강등`).toBe(c.card_style);
      const design = sanitizeInAppDesign(c.design);
      expect(design, `${t.id} design 전탈락`).not.toBeNull();
      expect((design as any).motion).toBe('rich');
    }
  });

  it('혜택 placeholder → 저장 차단 게이트 연동 (benefit 포함 = 차단, 미포함 = 저장 가능)', () => {
    for (const t of CORE_GOLDEN_TEMPLATES.filter((x) => x.channels.inapp.include)) {
      const c = compileTemplateForInapp(t);
      const sanitized = sanitizeContentBlocks(c.content_blocks as any[]);
      const hasBenefit = c.content_blocks.some((b) => b.type === 'benefit');
      expect(blocksHaveUneditedPlaceholder(sanitized), `${t.id} placeholder 게이트 불일치`).toBe(hasBenefit);
    }
  });

  it('CTA 버튼 — placeholder URL이 게이트를 통과해 보존(이동 차단은 SDK 몫)', () => {
    const t = CORE_GOLDEN_TEMPLATES.find((x) => x.id === 'welcome-first')!;
    const sanitized = sanitizeContentBlocks(compileTemplateForInapp(t).content_blocks as any[]);
    const cta = sanitized.find((b: any) => b.type === 'cta_group') as any;
    expect(cta).toBeTruthy();
    expect(cta.buttons?.length).toBeGreaterThan(0);
  });
});
