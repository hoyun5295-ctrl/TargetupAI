/**
 * ★ 2026-07-21 포스터형 캐러셀(좌우 슬라이드) — 슬라이드 순수 함수 계약 테스트.
 *
 * 근본: 포스터형(full_image)이 "1 메시지 = 1 이미지"였는데 스타벅스식 좌우 스와이프(N장)로 확장.
 *   1 메시지 = N 슬라이드. 각 슬라이드 = 이미지(필수) + 오버레이 제목/본문 + CTA 1개(슬라이드별 링크).
 *   slide[0]은 flat(image_url·title·body·buttons)으로 합성 저장 → 구버전 앱·flat 소비자가 "첫 장"을 단일 포스터로 표시(비파괴 폴백).
 *   이 테스트가 정규화·혜택 placeholder 차단·flat 합성 계약을 고정한다.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizePosterSlides,
  posterSlidesHaveUneditedPlaceholder,
  composeFlatFromPosterSlides,
  sanitizePosterSlidesActionUrls,
  resolveImageLinkUrlPatch,
  POSTER_SLIDE_MAX,
} from '../inapp-message';

describe('sanitizePosterSlides — 슬라이드 정규화', () => {
  it('image_url 없는 슬라이드는 제거 (포스터 성립 X)', () => {
    const out = sanitizePosterSlides([
      { image_url: '/api/cdp/inapp/image/co/1.jpg', title: 'A' },
      { title: '이미지 없음' },
      { image_url: '   ' },
      { image_url: '/api/cdp/inapp/image/co/2.jpg' },
    ]);
    expect(out.map((s) => s.image_url)).toEqual([
      '/api/cdp/inapp/image/co/1.jpg',
      '/api/cdp/inapp/image/co/2.jpg',
    ]);
  });

  it('최대 5장으로 자른다', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ image_url: `/i/${i}.jpg` }));
    expect(sanitizePosterSlides(many)).toHaveLength(POSTER_SLIDE_MAX);
    expect(POSTER_SLIDE_MAX).toBe(5);
  });

  it('제목·본문 trim, 빈 값은 생략', () => {
    const [s] = sanitizePosterSlides([{ image_url: '/i.jpg', title: '  봄 세일  ', body: '   ' }]);
    expect(s.title).toBe('봄 세일');
    expect(s.body).toBeUndefined();
  });

  it('CTA action_url 무해화(위험 스킴 null) + 라벨만 있어도 유지', () => {
    const [s] = sanitizePosterSlides([{
      image_url: '/i.jpg',
      cta: { label: '자세히', action_url: 'javascript:alert(1)' },
    }]);
    expect(s.cta).toEqual({ label: '자세히', action_url: null });
  });

  it('CTA 라벨·링크 둘 다 없으면 cta 생략', () => {
    const [s] = sanitizePosterSlides([{ image_url: '/i.jpg', cta: { background_color: '#000000' } }]);
    expect(s.cta).toBeUndefined();
  });

  it('CTA 색은 hex(3/4/6/8자리)만, camelCase actionUrl 흡수', () => {
    const [s] = sanitizePosterSlides([{
      image_url: '/i.jpg',
      cta: { label: '이동', actionUrl: 'https://mall.example/p', background_color: '#ff0000', text_color: 'red' },
    }]);
    expect(s.cta).toEqual({ label: '이동', action_url: 'https://mall.example/p', background_color: '#ff0000' });
    // text_color='red'(비-hex)는 탈락
    expect(s.cta?.text_color).toBeUndefined();
  });

  it('오버레이 색 hex만 · 크기 clamp(제목 14~32 / 본문 10~22)', () => {
    const [s] = sanitizePosterSlides([{
      image_url: '/i.jpg',
      title_color: '#ffffff', body_color: 'white',
      title_size: 40, body_size: 12,
    }]);
    expect(s.title_color).toBe('#ffffff');
    expect(s.body_color).toBeUndefined();   // 'white' 비-hex
    expect(s.title_size).toBeUndefined();   // 40 > 32
    expect(s.body_size).toBe(12);
  });

  it('placeholder URL("[URL — 회사 admin 수정]")은 보존 (이동만 차단)', () => {
    const [s] = sanitizePosterSlides([{
      image_url: '/i.jpg',
      cta: { label: '자세히', action_url: '[URL — 회사 admin 수정]' },
    }]);
    expect(s.cta?.action_url).toBe('[URL — 회사 admin 수정]');
  });

  it('배열 아님·null = 빈 배열', () => {
    expect(sanitizePosterSlides(null)).toEqual([]);
    expect(sanitizePosterSlides('x' as any)).toEqual([]);
    expect(sanitizePosterSlides([null, 3, 'x'])).toEqual([]);
  });
});

describe('posterSlidesHaveUneditedPlaceholder — 혜택 placeholder 차단(AI 임의 혜택 룰)', () => {
  it('제목·본문·CTA 라벨의 미편집 혜택 placeholder 검출', () => {
    expect(posterSlidesHaveUneditedPlaceholder([{ image_url: '/i.jpg', title: '[혜택 안내 — 직접 작성해주세요]' }])).toBe(true);
    expect(posterSlidesHaveUneditedPlaceholder([{ image_url: '/i.jpg', body: '지금 [직접 작성해주세요]' }])).toBe(true);
    expect(posterSlidesHaveUneditedPlaceholder([{ image_url: '/i.jpg', cta: { label: '직접 작성해주세요' } }])).toBe(true);
  });

  it('편집 완료된 슬라이드 = false', () => {
    expect(posterSlidesHaveUneditedPlaceholder([{ image_url: '/i.jpg', title: '봄 세일', body: '20% 할인', cta: { label: '보기' } }])).toBe(false);
    expect(posterSlidesHaveUneditedPlaceholder([])).toBe(false);
    expect(posterSlidesHaveUneditedPlaceholder(null as any)).toBe(false);
  });
});

describe('composeFlatFromPosterSlides — slide[0] → flat 합성(구버전 폴백)', () => {
  it('slide[0]의 이미지·제목·본문·CTA를 flat으로', () => {
    const flat = composeFlatFromPosterSlides(
      [
        { image_url: '/first.jpg', title: '첫 장', body: '첫 본문', cta: { label: '구매', action_url: 'https://m/e', background_color: '#111111' } },
        { image_url: '/second.jpg', title: '둘째 장' },
      ],
      { title: '메시지 제목', body: '메시지 본문', imageUrl: null, buttons: [] },
    );
    expect(flat.imageUrl).toBe('/first.jpg');
    expect(flat.title).toBe('첫 장');
    expect(flat.body).toBe('첫 본문');
    expect(flat.buttons).toHaveLength(1);
    expect(flat.buttons[0]).toMatchObject({ id: 'btn_primary', label: '구매', action_url: 'https://m/e', style: 'primary', background_color: '#111111' });
  });

  it('slide[0]에 제목/본문/CTA 없으면 fallback(메시지 레벨) 유지', () => {
    const flat = composeFlatFromPosterSlides(
      [{ image_url: '/first.jpg' }],
      { title: '메시지 제목', body: '메시지 본문', imageUrl: null, buttons: [{ id: 'x', label: '기존', action_url: '/e', style: 'primary' }] },
    );
    expect(flat.imageUrl).toBe('/first.jpg');
    expect(flat.title).toBe('메시지 제목');
    expect(flat.body).toBe('메시지 본문');
    expect(flat.buttons).toEqual([{ id: 'x', label: '기존', action_url: '/e', style: 'primary' }]);
  });

  it('슬라이드 없음 = fallback 그대로', () => {
    const flat = composeFlatFromPosterSlides([], { title: 'T', body: 'B', imageUrl: '/m.jpg', buttons: [] });
    expect(flat).toMatchObject({ title: 'T', body: 'B', imageUrl: '/m.jpg', buttons: [] });
  });
});

// ★ 2026-07-31 이미지 클릭 랜딩 — 슬라이드 link_url + 메시지 image_link_url 계약
describe('sanitizePosterSlides — 슬라이드 link_url(이미지 클릭 링크)', () => {
  it('정상 링크는 저장, camelCase(linkUrl)도 수용', () => {
    const [a, b] = sanitizePosterSlides([
      { image_url: '/1.jpg', link_url: 'https://mall.example/event' },
      { image_url: '/2.jpg', linkUrl: 'https://mall.example/p2' },
    ]);
    expect(a.link_url).toBe('https://mall.example/event');
    expect(b.link_url).toBe('https://mall.example/p2');
  });

  it('위험 스킴은 탈락(필드 자체 생략) — 미설정과 동일한 무동작', () => {
    const [s] = sanitizePosterSlides([{ image_url: '/1.jpg', link_url: 'javascript:alert(1)' }]);
    expect(s.link_url).toBeUndefined();
  });

  it('미설정이면 필드 없음 (기존 발행물 회귀 0)', () => {
    const [s] = sanitizePosterSlides([{ image_url: '/1.jpg', title: 'A' }]);
    expect('link_url' in s).toBe(false);
  });
});

describe('sanitizePosterSlidesActionUrls — 서빙 재정규화(cta + link_url)', () => {
  it('프로토콜 없는 도메인을 https로 보정 (cta·link_url 동일 기준)', () => {
    const out = sanitizePosterSlidesActionUrls([
      { image_url: '/1.jpg', cta: { label: 'a', action_url: 'www.poppon.co.kr/e' }, link_url: 'www.poppon.co.kr/land' },
    ]);
    expect(out[0].cta.action_url).toMatch(/^https:\/\//);
    expect(out[0].link_url).toMatch(/^https:\/\//);
  });

  it('link_url 없는 슬라이드는 그대로 (필드 미추가)', () => {
    const out = sanitizePosterSlidesActionUrls([{ image_url: '/1.jpg' }]);
    expect('link_url' in out[0]).toBe(false);
  });
});

describe('resolveImageLinkUrlPatch — image_link_url 입력 해석(부분 PUT presence)', () => {
  it('미제공 = 유지(set:false)', () => {
    expect(resolveImageLinkUrlPatch({})).toEqual({ set: false, value: null });
  });

  it('명시 null = 비우기(set:true, null)', () => {
    expect(resolveImageLinkUrlPatch({ image_link_url: null })).toEqual({ set: true, value: null });
  });

  it('camelCase 우선 + 무해화(위험 스킴 = null 클리어)', () => {
    expect(resolveImageLinkUrlPatch({ imageLinkUrl: 'https://m.example/e', image_link_url: 'x' }).value).toBe('https://m.example/e');
    expect(resolveImageLinkUrlPatch({ imageLinkUrl: 'javascript:alert(1)' })).toEqual({ set: true, value: null });
  });
});
