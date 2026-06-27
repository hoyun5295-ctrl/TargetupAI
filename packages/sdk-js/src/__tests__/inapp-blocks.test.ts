import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveTheme, pickReadableText, relativeLuminance, isHexColor } from '../inapp-theme';
import { renderBlocks, isBlockAllowed, type BlockRenderContext, type ContentBlock } from '../inapp-blocks';

/**
 * D230+ — In-app 블록 렌더 + 테마 해석 테스트.
 * 레거시 보존(content_blocks 없는 메시지 = 기존 렌더)은 inapp-enhancements.test에서 별도 보장.
 */

// ════════════════════════════════════════════════════════════════════
// 테마 해석
// ════════════════════════════════════════════════════════════════════

describe('resolveTheme', () => {
  it('light/dark 기본 면 토큰', () => {
    const light = resolveTheme('light', null);
    expect(light.surface).toBe('#ffffff');
    expect(light.textPrimary).toBe('#0f172a');
    const dark = resolveTheme('dark', null);
    expect(dark.surface).toBe('#14182b');
    expect(dark.textPrimary).toBe('#eef1f8');
  });

  it('auto는 prefersDark에 따라 light/dark', () => {
    expect(resolveTheme('auto', null, { prefersDark: false }).surface).toBe('#ffffff');
    expect(resolveTheme('auto', null, { prefersDark: true }).surface).toBe('#14182b');
  });

  it('accent_color(hex)를 accent로 사용, 비-hex는 기본 accent', () => {
    expect(resolveTheme('light', '#ff0066').accent).toBe('#ff0066');
    // gradient 문자열 등 비-hex는 기본값
    expect(resolveTheme('light', 'linear-gradient(135deg,#a,#b)').accent).toBe('#6d5cf0');
  });

  it('vibrant는 면이 accent로 채워지고 글자는 대비색', () => {
    const t = resolveTheme('vibrant', '#4f46e5');
    expect(t.surface).toBe('#4f46e5');
    expect(t.textPrimary).toBe('#ffffff'); // 어두운 accent → 흰 글자
    expect(t.accentText).toBe('#4f46e5');  // 버튼 글자 = 회사색
  });

  it('accentText는 accent 명도에 따라 대비 보정', () => {
    expect(resolveTheme('light', '#fde047').accentText).toBe('#0f172a'); // 밝은 accent → 진한 글자
    expect(resolveTheme('light', '#4f46e5').accentText).toBe('#ffffff'); // 어두운 accent → 흰 글자
  });

  it('minimal/brand 키 안전 처리 + 알 수 없는 키는 auto', () => {
    expect(resolveTheme('minimal', null).radius).toBe(18);
    expect(resolveTheme('brand', '#10b981').accent).toBe('#10b981');
    expect(resolveTheme('이상한값' as any, null).key).toBe('auto');
  });

  it('색 유틸', () => {
    expect(isHexColor('#fff')).toBe(true);
    expect(isHexColor('#abcdef')).toBe(true);
    expect(isHexColor('rgb(0,0,0)')).toBe(false);
    expect(relativeLuminance('#ffffff')).toBeGreaterThan(0.9);
    expect(relativeLuminance('#000000')).toBeLessThan(0.05);
    expect(pickReadableText('#ffffff')).toBe('#0f172a');
    expect(pickReadableText('#000000')).toBe('#ffffff');
  });
});

// ════════════════════════════════════════════════════════════════════
// 블록 렌더
// ════════════════════════════════════════════════════════════════════

function makeCtx(over: Partial<BlockRenderContext> = {}): BlockRenderContext {
  return {
    theme: resolveTheme('light', '#4f46e5'),
    template: 'center_modal',
    replaceVars: (t: string) => t.replace(/\{\{\s*customer\.name\s*\}\}/g, '김민수'),
    absoluteImageUrl: (u: string) => u,
    onButtonClick: () => {},
    reducedMotion: true, // stagger 끄고 즉시 표시 → DOM 단언 안정
    isAd: false,
    ...over,
  };
}

function render(blocks: ContentBlock[], over: Partial<BlockRenderContext> = {}): HTMLElement {
  const root = document.createElement('div');
  renderBlocks(root, blocks, makeCtx(over));
  return root;
}

describe('renderBlocks — 블록 타입', () => {
  it('headline/body/eyebrow 텍스트 렌더 + 변수 치환', () => {
    const root = render([
      { type: 'eyebrow', text: 'NEW' },
      { type: 'headline', text: '{{ customer.name }}님 환영합니다' },
      { type: 'body', text: '본문 내용' },
    ]);
    expect(root.textContent).toContain('NEW');
    expect(root.textContent).toContain('김민수님 환영합니다');
    expect(root.textContent).toContain('본문 내용');
    expect(root.children.length).toBe(3);
  });

  it('빈 텍스트 블록은 skip', () => {
    const root = render([{ type: 'headline', text: '' }, { type: 'body', text: '  ' }]);
    expect(root.children.length).toBe(0);
  });

  it('benefit 기본 placeholder 표시', () => {
    const root = render([{ type: 'benefit' }]);
    expect(root.textContent).toContain('[혜택 안내 — 직접 작성해주세요]');
    // 점선 티켓 스타일
    expect(root.firstElementChild?.getAttribute('style')).toContain('dashed');
  });

  it('cta_group 버튼 렌더 + 클릭 콜백(id+url)', () => {
    const onClick = vi.fn();
    const root = render([{
      type: 'cta_group',
      buttons: [
        { id: 'go', label: '자세히 보기', action_url: 'https://x.test/p', style: 'primary' },
        { id: 'no', label: '닫기', action_url: null, style: 'ghost' },
      ],
    }], { onButtonClick: onClick });
    const btns = root.querySelectorAll('button');
    expect(btns.length).toBe(2);
    (btns[0] as HTMLButtonElement).click();
    expect(onClick).toHaveBeenCalledWith('go', 'https://x.test/p');
    (btns[1] as HTMLButtonElement).click();
    expect(onClick).toHaveBeenCalledWith('no', null);
  });

  it('media: icon은 svg, image(url)는 img, image(url 없음)은 skip', () => {
    const icon = render([{ type: 'media', variant: 'icon', icon: 'gift' }]);
    expect(icon.querySelector('svg')).toBeTruthy();

    const img = render([{ type: 'media', variant: 'image', url: '/uploads/a.png' }]);
    expect(img.querySelector('img')).toBeTruthy();

    const empty = render([{ type: 'media', variant: 'image' }]);
    expect(empty.children.length).toBe(0);
  });

  it('rating 별점 + 캡션', () => {
    const root = render([{ type: 'rating', value: 4.6, count: 128 }]);
    expect(root.querySelectorAll('svg').length).toBe(5);
    expect(root.textContent).toContain('4.6');
    expect(root.textContent).toContain('후기 128');
  });

  it('bullets 항목 렌더', () => {
    const root = render([{ type: 'bullets', items: [{ text: '무료 배송' }, { text: '당일 출고' }] }]);
    expect(root.textContent).toContain('무료 배송');
    expect(root.textContent).toContain('당일 출고');
  });

  it('product: 이름 있으면 카드, 없으면 skip', () => {
    const ok = render([{ type: 'product', name: '베스트셀러 가방', meta: '리뷰 많은 상품' }]);
    expect(ok.textContent).toContain('베스트셀러 가방');
    const skip = render([{ type: 'product', name: '' }]);
    expect(skip.children.length).toBe(0);
  });

  it('divider/spacer 렌더', () => {
    const root = render([{ type: 'divider' }, { type: 'spacer', size: 'lg' }]);
    expect(root.children.length).toBe(2);
  });

  it('미지원 type은 skip', () => {
    const root = render([{ type: 'unknown_block' }, { type: 'headline', text: 'OK' }]);
    expect(root.children.length).toBe(1);
    expect(root.textContent).toContain('OK');
  });

  it('object 아닌 블록은 안전 skip', () => {
    const root = render([null as any, 'str' as any, { type: 'headline', text: 'OK' }]);
    expect(root.children.length).toBe(1);
  });
});

describe('renderBlocks — 템플릿별 허용 필터', () => {
  it('toast는 cta_group/media skip, headline/body는 표시', () => {
    expect(isBlockAllowed('toast', 'cta_group')).toBe(false);
    expect(isBlockAllowed('toast', 'media')).toBe(false);
    expect(isBlockAllowed('toast', 'headline')).toBe(true);
    const root = render([
      { type: 'headline', text: '토스트' },
      { type: 'cta_group', buttons: [{ label: 'X', action_url: null }] },
      { type: 'media', variant: 'icon', icon: 'bell' },
    ], { template: 'toast' });
    expect(root.querySelector('button')).toBeNull();
    expect(root.querySelector('svg')).toBeNull();
    expect(root.textContent).toContain('토스트');
  });

  it('floating_button은 cta_group만 허용', () => {
    expect(isBlockAllowed('floating_button', 'cta_group')).toBe(true);
    expect(isBlockAllowed('floating_button', 'headline')).toBe(false);
  });

  it('정의 없는 템플릿은 전부 허용(안전 default)', () => {
    expect(isBlockAllowed('made_up', 'benefit')).toBe(true);
  });
});

describe('renderBlocks — is_ad 자동 footer', () => {
  it('is_ad이고 footer 블록 없으면 (광고) 자동 주입', () => {
    const root = render([{ type: 'headline', text: '세일' }], { isAd: true });
    expect(root.textContent).toContain('(광고)');
  });

  it('footer 블록 있으면 (광고) prefix 1회만', () => {
    const root = render([{ type: 'footer', text: '문의 1234' }], { isAd: true });
    const occurrences = (root.textContent || '').match(/\(광고\)/g) || [];
    expect(occurrences.length).toBe(1);
    expect(root.textContent).toContain('문의 1234');
  });

  it('is_ad 아니면 (광고) 미주입', () => {
    const root = render([{ type: 'headline', text: '안내' }], { isAd: false });
    expect(root.textContent).not.toContain('(광고)');
  });
});

describe('renderBlocks — 모션 접근성', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reducedMotion=true면 즉시 표시(초기 opacity:0 미적용)', () => {
    const root = render([{ type: 'headline', text: 'A' }, { type: 'body', text: 'B' }], { reducedMotion: true });
    Array.from(root.children).forEach((c) => {
      expect((c as HTMLElement).style.opacity).not.toBe('0');
    });
  });
});
