/**
 * ★ 디자인 4.0 M0 — 인앱(SDK) 골든 스냅샷 (2026-07-14)
 *
 * design-core 이관(M1~M3) 전 SDK 테마 토큰·블록 렌더 출력을 동결.
 * SDK는 코어를 직접 import하지 못하므로(순수 브라우저 번들) 값은 미러로 유지되고,
 * 이 스냅샷 + M3 동기 테스트가 미러 드리프트를 기계 차단한다.
 * 시간 종속 블록(countdown)은 제외 — 스냅샷 결정성 보장.
 */
import { describe, it, expect } from 'vitest';
import { resolveTheme, SIGNATURE_THEME_KEYS, INAPP_FONT_CATALOG, type ThemeKey } from '../inapp-theme';
import { renderBlocks, type BlockRenderContext, type ContentBlock } from '../inapp-blocks';

const BASE_KEYS: ThemeKey[] = ['auto', 'light', 'dark', 'brand', 'vibrant', 'minimal'];

function makeCtx(over: Partial<BlockRenderContext> = {}): BlockRenderContext {
  return {
    theme: resolveTheme('light', '#4f46e5'),
    template: 'center_modal',
    replaceVars: (t: string) => t.replace(/\{\{\s*customer\.name\s*\}\}/g, '김민수'),
    absoluteImageUrl: (u: string) => u,
    onButtonClick: () => {},
    reducedMotion: true,
    isAd: false,
    ...over,
  };
}

function renderHtml(blocks: ContentBlock[], over: Partial<BlockRenderContext> = {}): string {
  const root = document.createElement('div');
  renderBlocks(root, blocks, makeCtx(over));
  return root.innerHTML;
}

const SAMPLE: ContentBlock[] = [
  { type: 'eyebrow', text: 'NOTICE' } as ContentBlock,
  { type: 'headline', text: '{{ customer.name }}님께 드리는 안내', size: 'lg' } as ContentBlock,
  { type: 'body', text: '새로운 소식이 도착했어요.' } as ContentBlock,
  { type: 'benefit', text: '[혜택 안내 — 직접 작성해주세요]' } as ContentBlock,
  { type: 'cta_group', layout: 'stack', buttons: [{ id: 'btn_primary', label: '확인하기', action_url: 'https://shop.example.com', style: 'primary' }] } as ContentBlock,
];

describe('M0 골든 — 인앱 테마 토큰 13종 동결', () => {
  it('기본 6종 (accent 미설정)', () => {
    for (const key of BASE_KEYS) {
      expect(resolveTheme(key, null)).toMatchSnapshot(`theme-${key}-default`);
    }
  });

  it('시그니처 7종 (accent 미설정 = 테마 기본색)', () => {
    for (const key of SIGNATURE_THEME_KEYS) {
      expect(resolveTheme(key, null)).toMatchSnapshot(`theme-${key}-default`);
    }
  });

  it('회사 accent 지정 시 13종 전부 accent 우선', () => {
    for (const key of [...BASE_KEYS, ...SIGNATURE_THEME_KEYS]) {
      const t = resolveTheme(key, '#10b981');
      if (key === 'vibrant') {
        expect(t.surface).toBe('#10b981'); // vibrant는 면이 회사색
      } else {
        expect(t.accent).toBe('#10b981');
      }
    }
  });

  it('서체 카탈로그 6종 동결', () => {
    expect(INAPP_FONT_CATALOG).toMatchSnapshot();
  });
});

describe('M0 골든 — 인앱 블록 렌더 동결', () => {
  it('라이트 글래스(기존 발행물 기본) 렌더', () => {
    expect(renderHtml(SAMPLE)).toMatchSnapshot();
  });

  it('시그니처 에디토리얼(디자인 3.0) 렌더', () => {
    expect(renderHtml(SAMPLE, { theme: resolveTheme('editorial', null) })).toMatchSnapshot();
  });

  it('다크 시그니처(luxury-dark) 렌더', () => {
    expect(renderHtml(SAMPLE, { theme: resolveTheme('luxury-dark', null) })).toMatchSnapshot();
  });
});
