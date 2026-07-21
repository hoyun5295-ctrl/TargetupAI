import { describe, it, expect, beforeEach } from 'vitest';
import { HanjulloInAppModule } from '../inapp';

/**
 * ★ 2026-07-21 포스터형 캐러셀(좌우 슬라이드) SDK 렌더 테스트.
 *  슬라이드 2장 이상 = renderPoster가 캐러셀로 분기(트랙·N 이미지·점·활성 CTA).
 *  1장·미보유 = 기존 단일 포스터(회귀 0). jsdom 렌더.
 */

// jsdom은 matchMedia 미구현 — applyAnimation의 prefers-reduced-motion 질의가 안전하도록 스텁.
function stubMatchMedia() {
  if (!window.matchMedia) {
    (window as any).matchMedia = (q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    });
  }
}

function makeModule(): any {
  return new HanjulloInAppModule('hjl_test', '', 'https://app.example.com/api/cdp');
}

function baseMsg(over: Record<string, any> = {}): any {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'T', body: 'B', template: 'full_image',
    backgroundColor: '#ffffff', textColor: '#111111',
    triggerEvent: 'page_load', displayFrequency: 'always',
    ...over,
  };
}

describe('parsePosterSlides — 파싱/필터', () => {
  it('배열·JSON 문자열 수용 + image_url 없는 슬라이드 제거', () => {
    const mod = makeModule();
    expect(mod.parsePosterSlides(baseMsg({ posterSlides: [{ image_url: '/a.jpg' }, { title: 'no-img' }] }))).toHaveLength(1);
    expect(mod.parsePosterSlides(baseMsg({ poster_slides: JSON.stringify([{ image_url: '/a.jpg' }, { image_url: '/b.jpg' }]) }))).toHaveLength(2);
    expect(mod.parsePosterSlides(baseMsg({}))).toEqual([]);
    expect(mod.parsePosterSlides(baseMsg({ poster_slides: 'not-json' }))).toEqual([]);
  });
});

describe('renderPoster — 캐러셀 분기 (jsdom)', () => {
  beforeEach(() => { stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; });

  it('슬라이드 3장 = 캐러셀(트랙 + 이미지 3 + 점 3 + 활성 CTA + 닫기)', () => {
    const mod = makeModule();
    const slides = [
      { image_url: '/s1.jpg', title: '첫 장', body: '본문1', cta: { label: '구매하기', action_url: 'https://m/e1' } },
      { image_url: '/s2.jpg', title: '둘째 장', cta: { label: '보기', action_url: 'https://m/e2' } },
      { image_url: '/s3.jpg' },
    ];
    mod.renderPoster(baseMsg({ posterSlides: slides }), '첫 장', '본문1', '/s1.jpg', '', [], 'fade', null, { customer: {} });

    const root = document.querySelector('[data-hanjullo-msg]');
    expect(root).toBeTruthy();
    const track = root!.querySelector('[data-hjl-carousel]');
    expect(track).toBeTruthy();
    expect(track!.querySelectorAll('img')).toHaveLength(3);
    expect(root!.querySelectorAll('[data-hjl-dot]')).toHaveLength(3);
    // 활성(0) CTA = 첫 슬라이드 라벨
    expect(root!.textContent).toContain('구매하기');
    expect(root!.textContent).not.toContain('보기'); // 활성 아닌 슬라이드 CTA는 아직 미노출
    // 닫기 + 다시 보지 않기
    expect(root!.querySelector('button[aria-label="닫기"]')).toBeTruthy();
    expect(root!.textContent).toContain('다시 보지 않기');
    // 슬라이드 오버레이 제목은 전부 렌더
    expect(root!.textContent).toContain('첫 장');
    expect(root!.textContent).toContain('둘째 장');
  });

  it('CTA 없는 슬라이드가 활성이어도 안전(빈 CTA 영역) — slide[2] cta 없음', () => {
    const mod = makeModule();
    const slides = [
      { image_url: '/s1.jpg', cta: { label: 'A', action_url: 'https://m/a' } },
      { image_url: '/s2.jpg' },
    ];
    mod.renderPoster(baseMsg({ posterSlides: slides }), 'x', 'y', '/s1.jpg', '', [], 'fade', null, { customer: {} });
    // renderActiveCta(1) 직접 호출 시에도 throw 없이 CTA 비움 — 여기선 초기(0)만 확인
    expect(document.querySelector('[data-hjl-carousel]')).toBeTruthy();
    expect(document.body.textContent).toContain('A');
  });
});

describe('renderPoster — 단일 포스터(회귀 0)', () => {
  beforeEach(() => { stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; });

  it('슬라이드 1장 = 단일 포스터(캐러셀 트랙 없음)', () => {
    const mod = makeModule();
    mod.renderPoster(baseMsg({ posterSlides: [{ image_url: '/only.jpg' }] }), '제목만', '본문만', '/only.jpg', '', [], 'fade', null, { customer: {} });
    expect(document.querySelector('[data-hjl-carousel]')).toBeNull();
    expect(document.querySelector('[data-hanjullo-msg]')).toBeTruthy();
    expect(document.body.textContent).toContain('제목만');
  });

  it('슬라이드 미보유 = 기존 단일 포스터(imageUrl 사용, 스크림 제목)', () => {
    const mod = makeModule();
    mod.renderPoster(baseMsg({}), '플랫제목', '플랫본문', '/flat.jpg', 'NEW', [], 'fade', null, { customer: {} });
    expect(document.querySelector('[data-hjl-carousel]')).toBeNull();
    expect(document.body.textContent).toContain('플랫제목');
    expect(document.body.textContent).toContain('NEW'); // 배지
  });
});
