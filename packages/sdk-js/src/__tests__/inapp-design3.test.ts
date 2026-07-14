import { describe, it, expect, vi } from 'vitest';
import {
  resolveTheme, inappGoogleFontsUrl, safeFontFamily, SIGNATURE_THEME_KEYS, INAPP_FONT_CATALOG,
} from '../inapp-theme';
import {
  renderBlocks, resolveInAppTreatment, INAPP_TREATMENTS,
  type BlockRenderContext,
} from '../inapp-blocks';

/**
 * ★ 2026-07-14 인앱 디자인 3.0 고정 테스트
 * - 시그니처 테마 7종 토큰 + 다크 면 리터럴 원칙 + 회사 accent 우선
 * - 기존 6테마 골든 보존 (아트디렉션 축 미설정 = 현행 렌더 불변)
 * - 구도 허용표 fail-closed / 서체 URL 화이트리스트 / 헤드라인 마커 / product 링크 / 모션 게이트
 */

function ctx(over: Partial<BlockRenderContext> = {}): BlockRenderContext {
  return {
    theme: resolveTheme('light', null),
    template: 'center_modal',
    replaceVars: (t) => t,
    absoluteImageUrl: (u) => u,
    onButtonClick: () => {},
    reducedMotion: false,
    ...over,
  };
}

describe('시그니처 테마 7종 (디자인 3.0)', () => {
  it('7키 전부 자기 토큰 반환 (auto 폴백 아님)', () => {
    for (const key of SIGNATURE_THEME_KEYS) {
      const t = resolveTheme(key, null);
      expect(t.key).toBe(key);
    }
  });

  it('다크 면 리터럴 원칙 — luxury-dark/city-night 자기 면 색 고정', () => {
    expect(resolveTheme('luxury-dark', null).surface).toBe('#0e1018');
    expect(resolveTheme('city-night', null).surface).toBe('#0b1220');
  });

  it('테마 기본 강조색 — 회사 accent 미설정 시 자기 기본, 설정 시 회사색 우선', () => {
    expect(resolveTheme('luxury-dark', null).accent).toBe('#d4af37');
    expect(resolveTheme('festive', null).accent).toBe('#e11d48');
    expect(resolveTheme('luxury-dark', '#123456').accent).toBe('#123456');
  });

  it('아트디렉션 축 내장 — 서체 페어링·배율·밀도·모티프', () => {
    const ed = resolveTheme('editorial', null);
    expect(ed.displayFont).toContain('Noto Serif KR');
    expect(ed.headlineScale).toBeGreaterThan(1);
    expect(ed.density).toBe('airy');
    expect(ed.motif).toBe('rule');
    const bs = resolveTheme('bold-sale', null);
    expect(bs.displayFont).toContain('Black Han Sans');
    expect(bs.density).toBe('compact');
  });

  it('골든 보존 — 기존 6테마는 아트디렉션 축 미설정 (현행 렌더 불변)', () => {
    for (const key of ['auto', 'light', 'dark', 'brand', 'vibrant', 'minimal']) {
      const t = resolveTheme(key, null);
      expect(t.displayFont).toBeUndefined();
      expect(t.headlineScale).toBeUndefined();
      expect(t.density).toBeUndefined();
      expect(t.motif).toBeUndefined();
    }
    // 기존 토큰 값 스팟 체크 (변경 금지)
    expect(resolveTheme('light', null).surface).toBe('#ffffff');
    expect(resolveTheme('dark', null).surface).toBe('#161b30');
    expect(resolveTheme('minimal', null).buttonPrimaryBg).toBe('#111827');
    expect(resolveTheme('auto', null).radius).toBe(24);
  });

  it('무효 키 = auto 폴백 (구버전 안전)', () => {
    expect(resolveTheme('no-such-theme', null).key).toBe('auto');
  });
});

describe('구도(treatment) fail-closed', () => {
  it('허용 조합만 통과, 미허용·미지정 = classic', () => {
    expect(resolveInAppTreatment('center_modal', 'classic', 'framed')).toBe('framed');
    expect(resolveInAppTreatment('center_modal', 'classic', 'typographic')).toBe('typographic');
    expect(resolveInAppTreatment('slide_in', 'classic', 'framed')).toBe('classic'); // slide_in엔 framed 없음
    expect(resolveInAppTreatment('center_modal', 'poster', 'framed')).toBe('classic'); // 자기 구도 형태
    expect(resolveInAppTreatment('toast', 'classic', 'typographic')).toBe('classic'); // 카드형 아님
    expect(resolveInAppTreatment('center_modal', 'classic', undefined)).toBe('classic');
    expect(resolveInAppTreatment('center_modal', 'classic', 'evil')).toBe('classic');
  });

  it('허용표는 카드형 classic 조합만 정의 (poster/ticket/bubble = 자기 구도)', () => {
    for (const k of Object.keys(INAPP_TREATMENTS)) {
      expect(k.endsWith('|classic')).toBe(true);
    }
  });
});

describe('서체 실로딩 화이트리스트', () => {
  it('카탈로그 매칭 시에만 Google Fonts URL', () => {
    expect(inappGoogleFontsUrl('"Noto Serif KR", serif')).toContain('fonts.googleapis.com');
    expect(inappGoogleFontsUrl('"Noto Serif KR", serif')).toContain('Noto+Serif+KR');
    expect(inappGoogleFontsUrl('"Pretendard Variable", sans-serif')).toBeNull(); // 시스템 폴백 — 로드 불필요
    expect(inappGoogleFontsUrl('Comic Sans MS')).toBeNull(); // 카탈로그 밖 = 로드 안 함
    expect(inappGoogleFontsUrl('javascript:alert(1)')).toBeNull();
    expect(inappGoogleFontsUrl(undefined, null)).toBeNull();
  });

  it('safeFontFamily — font-family 밖 문자 제거', () => {
    expect(safeFontFamily('"Noto Serif KR", serif', '')).toBe('"Noto Serif KR", serif');
    expect(safeFontFamily('</style><script>alert(1)</script>', 'x')).not.toContain('<');
    expect(safeFontFamily(undefined, 'fallback')).toBe('fallback');
  });

  it('카탈로그 6종 — DM_FONT_CATALOG 계열 미러', () => {
    expect(INAPP_FONT_CATALOG).toHaveLength(6);
    expect(INAPP_FONT_CATALOG.filter((c) => c.google).length).toBe(5); // pretendard만 null
  });
});

describe('헤드라인 3.0 — 마커·서체·배율 (골든: 미설정 = 현행)', () => {
  it('emphasis 미설정 = 평문 그대로 (span 없음 — 기존 발행물 불변)', () => {
    const root = document.createElement('div');
    renderBlocks(root, [{ type: 'headline', text: '헤드라인' }], ctx());
    const head = root.firstElementChild as HTMLElement;
    expect(head.textContent).toBe('헤드라인');
    expect(head.querySelector('span')).toBeNull();
    expect(head.style.fontSize).toBe('19px'); // 현행 기본 크기
    expect(head.style.fontFamily).toBe('');
  });

  it('emphasis=marker → accent 워시 span / underline → 밑줄 span', () => {
    const root = document.createElement('div');
    renderBlocks(root, [
      { type: 'headline', text: '마커', emphasis: 'marker' },
      { type: 'headline', text: '밑줄', emphasis: 'underline' },
    ], ctx());
    const spans = root.querySelectorAll('span');
    expect(spans.length).toBe(2);
    expect((spans[0] as HTMLElement).style.background).toContain('linear-gradient');
    expect((spans[1] as HTMLElement).style.boxShadow).toContain('inset');
  });

  it('시그니처 테마 = 전용 서체 + 배율 + 모티프 마크', () => {
    const root = document.createElement('div');
    renderBlocks(root, [{ type: 'headline', text: '화보' }], ctx({ theme: resolveTheme('editorial', null) }));
    // motif(rule) 마크가 wrap을 만든다
    const wrap = root.firstElementChild as HTMLElement;
    const mark = wrap.firstElementChild as HTMLElement;
    expect(mark.style.height).toBe('3px'); // rule 모티프
    const head = wrap.children[1] as HTMLElement;
    expect(head.style.fontFamily).toContain('Noto Serif KR');
    expect(parseFloat(head.style.fontSize)).toBeGreaterThan(19); // headlineScale 1.12
  });

  it('typographic 구도 = 헤드라인 1.25배', () => {
    const root = document.createElement('div');
    renderBlocks(root, [{ type: 'headline', text: '타이포' }], ctx({ treatment: 'typographic' }));
    const head = root.firstElementChild as HTMLElement;
    expect(parseFloat(head.style.fontSize)).toBe(23.8); // 19 × 1.25 = 23.75 → 소수 1자리 반올림
  });
});

describe('product 블록 링크 (디자인 3.0)', () => {
  it('link_url http(s) = 카드 클릭 이동 표면 (onButtonClick 경유 — 추적+닫기+safeNavigate 단일 길목)', () => {
    const onClick = vi.fn();
    const root = document.createElement('div');
    renderBlocks(root, [{ type: 'product', name: '상품', price: 10000, link_url: 'https://shop.example.com/p/1' }], ctx({ onButtonClick: onClick }));
    const card = root.firstElementChild as HTMLElement;
    expect(card.getAttribute('role')).toBe('link');
    expect(card.style.cursor).toBe('pointer');
    card.click();
    expect(onClick).toHaveBeenCalledWith('product', 'https://shop.example.com/p/1');
  });

  it('link_url 미설정·비http = 현행 비클릭 카드 그대로 (골든 보존)', () => {
    const onClick = vi.fn();
    const root = document.createElement('div');
    renderBlocks(root, [
      { type: 'product', name: 'A', price: 1000 },
      { type: 'product', name: 'B', price: 1000, link_url: 'javascript:alert(1)' },
    ], ctx({ onButtonClick: onClick }));
    for (const card of Array.from(root.children) as HTMLElement[]) {
      expect(card.getAttribute('role')).toBeNull();
      card.click();
    }
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('모션 2.0 게이트 (미설정 = 현행 무모션)', () => {
  it('ctx.motion 미지정 = CTA 애니메이션 없음 (기존 발행물 불변)', () => {
    const root = document.createElement('div');
    renderBlocks(root, [{ type: 'cta_group', buttons: [{ label: '보기', style: 'primary' }] }], ctx());
    const btn = root.querySelector('button') as HTMLElement;
    expect(btn.style.animation).toBe('');
  });

  it('ctx.motion=true = 대표 CTA 맥동 + 쿠폰 샤인', () => {
    const root = document.createElement('div');
    renderBlocks(root, [
      { type: 'benefit', text: '혜택 문구' },
      { type: 'cta_group', buttons: [{ label: '보기', style: 'primary' }, { label: '나중에', style: 'secondary' }] },
    ], ctx({ motion: true }));
    const btns = root.querySelectorAll('button');
    expect((btns[0] as HTMLElement).style.animation).toContain('hjl-cta-pulse');
    expect((btns[1] as HTMLElement).style.animation).toBe(''); // 보조 버튼은 맥동 없음
    expect(root.innerHTML).toContain('hjl-shine'); // benefit 샤인 띠
  });

  it('spotlight 구도 = benefit 대형 승격 (ticket 카드와 동일 골격)', () => {
    const rootA = document.createElement('div');
    renderBlocks(rootA, [{ type: 'benefit', text: '혜택' }], ctx({ treatment: 'spotlight' }));
    const big = rootA.firstElementChild as HTMLElement;
    // 대형 승격 = 점선 티켓이 아니라 accentSoft 면 (dashed 없음)
    expect(big.style.border).toBe('');
    const rootB = document.createElement('div');
    renderBlocks(rootB, [{ type: 'benefit', text: '혜택' }], ctx());
    expect((rootB.firstElementChild as HTMLElement).style.border).toContain('dashed');
  });
});
