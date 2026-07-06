import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveTheme, pickReadableText, relativeLuminance, isHexColor } from '../inapp-theme';
import {
  renderBlocks, isBlockAllowed, normalizeCardStyle, planCardLayout, renderPosterHero, renderTicketPerforation,
  type BlockRenderContext, type ContentBlock,
} from '../inapp-blocks';

/**
 * D230+ — In-app 블록 렌더 + 테마 해석 테스트.
 * 레거시 보존(content_blocks 없는 메시지 = 기존 렌더)은 inapp-enhancements.test에서 별도 보장.
 */

// ════════════════════════════════════════════════════════════════════
// 테마 해석
// ════════════════════════════════════════════════════════════════════

describe('resolveTheme', () => {
  it('light/dark 기본 면 토큰', () => {
    // 2026-07-07 디자인 2.0 — dark 면 #161b30 / 글자 #f2f4fb (그라데이션 면 surfaceBg 동반)
    const light = resolveTheme('light', null);
    expect(light.surface).toBe('#ffffff');
    expect(light.textPrimary).toBe('#0f172a');
    expect(light.surfaceBg).toContain('linear-gradient');
    const dark = resolveTheme('dark', null);
    expect(dark.surface).toBe('#161b30');
    expect(dark.textPrimary).toBe('#f2f4fb');
    expect(dark.surfaceBg).toContain('linear-gradient');
  });

  it('auto는 prefersDark에 따라 light/dark', () => {
    expect(resolveTheme('auto', null, { prefersDark: false }).surface).toBe('#ffffff');
    expect(resolveTheme('auto', null, { prefersDark: true }).surface).toBe('#161b30');
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
    expect(resolveTheme('minimal', null).radius).toBe(12); // 2026-07-07(2) 디자인 언어 2.1 — 모노 에디토리얼
    expect(resolveTheme('light', null).radius).toBe(24);
    expect(resolveTheme('brand', '#10b981').accent).toBe('#10b981');
    expect(resolveTheme('이상한값' as any, null).key).toBe('auto');
  });

  // ★ 2026-07-07(2) 디자인 언어 2.1 — "테마 = 색깔놀이" 재발 차단 고정 테스트.
  //   라이트 계열 3키(light/brand/minimal)의 면·버튼·라벨 구조가 서로 반드시 달라야 한다.
  it('테마 6종은 서로 다른 디자인 언어 (면·버튼·라벨 구조 차별)', () => {
    const accent = '#10b981';
    const light = resolveTheme('light', accent);
    const dark = resolveTheme('dark', accent);
    const brand = resolveTheme('brand', accent);
    const vibrant = resolveTheme('vibrant', accent);
    const minimal = resolveTheme('minimal', accent);

    // 면(surfaceBg) 전부 상이 — light≠brand≠minimal≠vibrant≠dark
    const faces = [light.surfaceBg, dark.surfaceBg, brand.surfaceBg, vibrant.surfaceBg, minimal.surfaceBg];
    expect(new Set(faces).size).toBe(5);

    // brand = 브랜드 밴드(상단 6px accent 레이어) + 솔리드 칩 + 헤드라인 accent 바 + 플랫 accent 버튼
    expect(brand.surfaceBg).toContain('100% 6px');
    expect(brand.surfaceBg).toContain(accent);
    expect(brand.eyebrowVariant).toBe('chip_solid');
    expect(brand.headlineAccentBar).toBe(true);
    expect(brand.buttonPrimaryBg).toBe(accent);

    // minimal = 모노 에디토리얼 (플랫 면 + 민무늬 라벨 + 모노 불릿 + 잉크 버튼 + 링 없음)
    expect(minimal.surfaceBg).toBe('#ffffff');
    expect(minimal.eyebrowVariant).toBe('plain');
    expect(minimal.bulletVariant).toBe('mono');
    expect(minimal.dividerVariant).toBe('solid');
    expect(minimal.buttonPrimaryBg).toBe('#111827');
    expect(minimal.ring).toBe('');

    // vibrant = 알약 반전 버튼 + 샤인 레이어
    expect(vibrant.buttonRadius).toBe(999);
    expect(vibrant.surfaceBg).toContain('radial-gradient');

    // dark = accent 글로우 레이어
    expect(dark.surfaceBg).toContain('radial-gradient');
    expect(dark.surfaceBg).toContain('#1b2140');

    // light = 글래스 그라데이션 버튼
    expect(light.buttonPrimaryBg).toContain('linear-gradient');
    expect(light.eyebrowVariant).toBe('chip');
  });

  it('brand는 prefersDark와 무관하게 화이트 쇼케이스 고정', () => {
    const a = resolveTheme('brand', '#10b981', { prefersDark: true });
    const b = resolveTheme('brand', '#10b981', { prefersDark: false });
    expect(a.surface).toBe('#ffffff');
    expect(a.surfaceBg).toBe(b.surfaceBg);
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

  it('디자인 언어 2.1 — 테마별 블록 구조가 실제로 달라진다', () => {
    // minimal: plain 라벨(칩 배경 X) + 모노 불릿(배지 span 없이 svg 직결)
    const minimalTheme = resolveTheme('minimal', '#10b981');
    const m = render([
      { type: 'eyebrow', text: 'NEW' },
      { type: 'bullets', items: [{ text: '항목' }] },
    ], { theme: minimalTheme });
    expect((m.firstElementChild as HTMLElement).style.background).toBe('');
    const monoRow = m.children[1].firstElementChild as HTMLElement;
    expect(monoRow.firstElementChild?.tagName.toLowerCase()).toBe('svg');

    // light(badge): 불릿 아이콘이 원형 배지 span 안에
    const l = render([{ type: 'bullets', items: [{ text: '항목' }] }]);
    const badgeRow = l.children[0].firstElementChild as HTMLElement;
    expect(badgeRow.firstElementChild?.tagName.toLowerCase()).toBe('span');

    // brand: 헤드라인 아래 accent 바 (래퍼 자식 2개) + 솔리드 칩 라벨
    const brandTheme = resolveTheme('brand', '#10b981');
    const b = render([
      { type: 'eyebrow', text: 'VIP' },
      { type: 'headline', text: '헤드라인' },
    ], { theme: brandTheme });
    expect((b.children[0] as HTMLElement).style.background).toContain('rgb(16, 185, 129)'); // jsdom이 #10b981을 rgb로 정규화
    expect((b.children[1] as HTMLElement).children.length).toBe(2);
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

describe('카드 형태 축 (2026-07-07(2) 디자인 언어 2.1)', () => {
  it('normalizeCardStyle 화이트리스트 — 미지원 값은 classic', () => {
    expect(normalizeCardStyle('bubble')).toBe('bubble');
    expect(normalizeCardStyle('ticket')).toBe('ticket');
    expect(normalizeCardStyle('poster')).toBe('poster');
    expect(normalizeCardStyle('classic')).toBe('classic');
    expect(normalizeCardStyle('없는값')).toBe('classic');
    expect(normalizeCardStyle(null)).toBe('classic');
    expect(normalizeCardStyle(undefined)).toBe('classic');
  });

  it('poster 배치 — 첫 이미지 미디어=히어로 승격, eyebrow/headline 각 첫 1개=overlay, 나머지=main', () => {
    const blocks: ContentBlock[] = [
      { type: 'eyebrow', text: 'NEW' },
      { type: 'media', variant: 'image', url: '/uploads/a.png' },
      { type: 'headline', text: '헤드라인' },
      { type: 'body', text: '본문' },
      { type: 'cta_group', buttons: [{ label: '보기' }] },
    ];
    const plan = planCardLayout(blocks, 'poster');
    expect(plan.hero?.url).toBe('/uploads/a.png');
    expect(plan.overlay.map((b) => b.type)).toEqual(['eyebrow', 'headline']);
    expect(plan.main.map((b) => b.type)).toEqual(['body', 'cta_group']);

    // 이미지 없으면 hero=null (강조색 면 히어로), overlay는 그대로
    const noImg = planCardLayout(blocks.filter((b) => b.type !== 'media'), 'poster');
    expect(noImg.hero).toBeNull();
    expect(noImg.overlay.length).toBe(2);
  });

  it('ticket 배치 — 마지막 cta_group부터 스터브 분리, cta 없거나 첫 블록이면 전부 main', () => {
    const blocks: ContentBlock[] = [
      { type: 'headline', text: 'H' },
      { type: 'benefit', text: '혜택' },
      { type: 'cta_group', buttons: [{ label: '받기' }] },
      { type: 'footer', text: '유의사항' },
    ];
    const plan = planCardLayout(blocks, 'ticket');
    expect(plan.main.map((b) => b.type)).toEqual(['headline', 'benefit']);
    expect(plan.stub.map((b) => b.type)).toEqual(['cta_group', 'footer']);

    const noCta = planCardLayout([{ type: 'headline', text: 'H' }], 'ticket');
    expect(noCta.stub.length).toBe(0);
    expect(noCta.main.length).toBe(1);
  });

  it('renderPosterHero — 이미지=img+스크림+흰 헤드라인 / 무이미지=강조색 면', () => {
    const ctx = makeCtx();
    const withImg = renderPosterHero(planCardLayout([
      { type: 'media', variant: 'image', url: '/uploads/a.png' },
      { type: 'headline', text: '포스터 헤드라인' },
    ], 'poster'), ctx);
    expect(withImg?.querySelector('img')).toBeTruthy();
    expect(withImg?.textContent).toContain('포스터 헤드라인');

    const noImg = renderPosterHero(planCardLayout([{ type: 'headline', text: 'H' }], 'poster'), ctx);
    expect(noImg?.querySelector('img')).toBeNull();
    expect(noImg?.getAttribute('style') || (noImg as HTMLElement).style.background).toBeTruthy();
  });

  it('renderTicketPerforation — 점선 1 + 펀치홀 2', () => {
    const row = renderTicketPerforation(resolveTheme('light', '#4f46e5'));
    expect(row.children.length).toBe(3);
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
