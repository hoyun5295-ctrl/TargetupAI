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

// ★ 2026-11-08 C114 I-3 — 사진 위 글(overlay) = 새 틀(poster-frame.ts) · 옛 4:5 cover 캐러셀 · 옛 단일 포스터 경로는 지웠다(잘림 0)
describe('renderPoster — 사진 위 글 = 새 틀 (jsdom)', () => {
  beforeEach(() => { stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; });
  const part = (name: string) => Array.from(document.querySelectorAll(`[data-hjl-part="${name}"]`)) as HTMLElement[];

  it('슬라이드 3장 = 바닥 시트 틀 · 글 얹기 · 그림 3 · 쪽 번호 · 활성 장 버튼 · 닫기 · 다시 보지 않기', () => {
    const mod = makeModule();
    const slides = [
      { image_url: '/s1.jpg', title: '첫 장', body: '본문1', cta: { label: '구매하기', action_url: 'https://m/e1' } },
      { image_url: '/s2.jpg', title: '둘째 장', cta: { label: '보기', action_url: 'https://m/e2' } },
      { image_url: '/s3.jpg' },
    ];
    mod.renderPoster(baseMsg({ posterSlides: slides }), '첫 장', '본문1', '/s1.jpg', '', [], 'fade', null, { customer: {} });
    const root = document.querySelector('[data-hanjullo-msg]') as HTMLElement;
    expect(root.getAttribute('data-hjl-frame')).toBe('sheet');
    expect(root.getAttribute('data-hjl-text')).toBe('live');
    expect(part('image')).toHaveLength(3);
    expect(part('pager-text')[0].textContent).toBe('1 / 3');
    expect(part('cta')[0].textContent).toBe('구매하기');
    expect(root.textContent).toContain('첫 장');
    expect(root.textContent).toContain('둘째 장');
    expect(root.textContent).toContain('다시 보지 않기');
  });

  it('그림 = 잘라 채우기(cover) 0 · 4:5 상자 0', () => {
    const mod = makeModule();
    mod.renderPoster(baseMsg({ posterSlides: [{ image_url: '/s1.jpg' }, { image_url: '/s2.jpg' }] }), 'x', 'y', '/s1.jpg', '', [], 'fade', null, { customer: {} });
    for (const im of part('image')) {
      expect(im.style.objectFit).not.toBe('cover');
    }
    const all = Array.from(document.querySelectorAll('[data-hanjullo-msg] *')) as HTMLElement[];
    expect(all.some((e) => (e.style as any).aspectRatio === '4 / 5')).toBe(false);
  });

  it('슬라이드 1장 · 미보유(flat) = 같은 틀 · 원본 비율 · 스크림 제목 · 배지', () => {
    const mod = makeModule();
    mod.renderPoster(baseMsg({ posterSlides: [{ image_url: '/only.jpg' }] }), '제목만', '본문만', '/only.jpg', '', [], 'fade', null, { customer: {} });
    expect((document.querySelector('[data-hanjullo-msg]') as HTMLElement).getAttribute('data-hjl-frame')).toBe('sheet');
    document.body.innerHTML = '';
    mod.renderPoster(baseMsg({}), '플랫제목', '플랫본문', '/flat.jpg', 'NEW', [], 'fade', null, { customer: {} });
    expect(document.body.textContent).toContain('플랫제목');
    expect(document.body.textContent).toContain('NEW');
    expect(part('image')).toHaveLength(1);
  });

  it('(C114 Codex 구현 1R ①) 한 장 + 버튼 · 그림 링크가 바깥 칸에만 = 옛 한 장 포스터처럼 그대로', () => {
    const mod = makeModule();
    mod.renderPoster(baseMsg({ posterSlides: [{ image_url: '/only.jpg' }], imageLinkUrl: 'https://mall.example/land' }), '바깥 제목', '바깥 본문', '/only.jpg', '',
      [{ id: 'b1', label: '바깥 버튼', action_url: 'https://mall.example/x', style: 'primary', background_color: '#111827', text_color: '#ffffff' }], 'fade', null, { customer: {} });
    expect(part('cta')[0].textContent).toBe('바깥 버튼');
    expect(document.body.textContent).toContain('바깥 제목');
    expect((part('image')[0] as HTMLElement).getAttribute('role')).toBe('link');
  });

  it('여러 장 = 장 값 그대로(바깥 버튼으로 채우지 않는다 · 옛 캐러셀 규칙)', () => {
    const mod = makeModule();
    mod.renderPoster(baseMsg({ posterSlides: [{ image_url: '/a.jpg' }, { image_url: '/b.jpg' }] }), 'x', 'y', '/a.jpg', '',
      [{ id: 'b1', label: '바깥 버튼', action_url: 'https://mall.example/x', style: 'primary' }], 'fade', null, { customer: {} });
    expect(document.body.textContent).not.toContain('바깥 버튼');
  });

  it('(Codex 구현 2R) 바깥 칸 폴백 = 새 틀 모양만 · 이벤트 카드 · 배너 시트 · 통짜 한 장 = 장 그대로', async () => {
    const { frameSlidesWithFlat } = await import('../poster-frame');
    const flat = { image_url: '/f.jpg', title: '바깥', body: '바깥 본문', eyebrow: null, cta: { label: '바깥 버튼', action_url: '/x' }, link_url: '/l' };
    const one = [{ image_url: '/a.jpg' }];
    expect(frameSlidesWithFlat(one as any, flat, {})[0]).toMatchObject({ title: '바깥', cta: { label: '바깥 버튼' }, link_url: '/l' });
    for (const d of [{ poster_layout: 'event_card' }, { poster_layout: 'banner_sheet' }, { poster_text: 'baked' }, { poster_frame: 'card' }]) {
      expect(frameSlidesWithFlat(one as any, flat, d), JSON.stringify(d)).toEqual(one);
    }
    expect(frameSlidesWithFlat([], flat, { poster_layout: 'event_card' })[0]).toMatchObject({ image_url: '/f.jpg', title: '바깥' });
  });

  it('(Codex 구현 3R) 장 없는 시트 첫 장 = 배지(badge_text) eyebrow 보존 · 기존 장에는 바깥 배지를 섞지 않음', async () => {
    const { frameSlidesWithFlat } = await import('../poster-frame');
    const flat = { image_url: '/f.jpg', title: '바깥', body: '', eyebrow: '오늘만', cta: null, link_url: null };
    for (const d of [{ poster_layout: 'event_card' }, { poster_layout: 'banner_sheet' }, {}]) {
      expect(frameSlidesWithFlat([], flat, d)[0].eyebrow, JSON.stringify(d)).toBe('오늘만');
    }
    expect(frameSlidesWithFlat([{ image_url: '/a.jpg' }] as any, flat, { poster_layout: 'event_card' })[0].eyebrow).toBeUndefined();
  });

  it('그림도 장도 없음 = 가운데 팝업 폴백', () => {
    const mod = makeModule();
    mod.renderPoster(baseMsg({}), '제목', '본문', null, '', [], 'fade', null, { customer: {} });
    expect(document.querySelector('[data-hjl-frame]')).toBeNull();
    expect(document.body.textContent).toContain('제목');
  });
});

// ★ 2026-07-31 이미지 클릭 랜딩 — 링크 설정 시에만 이미지가 클릭 대상(role=link)이 된다
describe('이미지 클릭 랜딩 (imageLinkUrl · slide link_url)', () => {
  beforeEach(() => { stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; });

  it('여러 장 — link_url 있는 슬라이드 이미지만 role=link + pointer', () => {
    const mod = makeModule();
    const slides = [
      { image_url: '/s1.jpg', link_url: 'https://mall.example/event' },
      { image_url: '/s2.jpg' },
    ];
    mod.renderPoster(baseMsg({ posterSlides: slides }), 'x', 'y', '/s1.jpg', '', [], 'fade', null, { customer: {} });
    const imgs = document.querySelectorAll('[data-hjl-part="image"]');
    expect(imgs).toHaveLength(2);
    expect((imgs[0] as HTMLElement).getAttribute('role')).toBe('link');
    expect((imgs[0] as HTMLElement).style.cursor).toBe('pointer');
    expect((imgs[1] as HTMLElement).getAttribute('role')).toBeNull(); // 링크 없음 = 기존 무동작
  });

  it('단일 포스터 — imageLinkUrl 설정 시 hero가 role=link', () => {
    const mod = makeModule();
    mod.renderPoster(baseMsg({ imageLinkUrl: 'https://mall.example/land' }), '제목', '본문', '/one.jpg', '', [], 'fade', null, { customer: {} });
    const hero = document.querySelector('[data-hanjullo-msg] img') as HTMLElement;
    expect(hero.getAttribute('role')).toBe('link');
  });

  it('블록이 진실인 메시지 — legacy 폴백 렌더에서도 잔존 링크가 되살아나지 않는다 (Codex 2R)', () => {
    const mod = makeModule();
    // 블록 렌더 예외 시 legacy 렌더러가 같은 msg로 호출되는 폴백 경로를 그대로 재현:
    // content_blocks 보유 + 과거 잔존 image_link_url → 판독 단계 fail-closed로 무동작이어야 한다.
    mod.renderCenterModal(
      baseMsg({
        template: 'center_modal',
        imageLinkUrl: 'https://mall.example/stale-campaign',
        content_blocks: [{ type: 'headline', text: '블록 제목' }],
      }),
      '제목', '본문', '/hero.jpg', '', [], 'fade', null, { customer: {} },
    );
    const hero = document.querySelector('[data-hanjullo-msg] img') as HTMLElement;
    expect(hero.getAttribute('role')).toBeNull();
  });

  it('손상된 블록 문자열(파싱 실패)도 fail-closed — 잔존 링크 미배선 (Codex 3R)', () => {
    const mod = makeModule();
    mod.renderCenterModal(
      baseMsg({ template: 'center_modal', imageLinkUrl: 'https://mall.example/stale', content_blocks: '{not-json' }),
      '제목', '본문', '/hero.jpg', '', [], 'fade', null, { customer: {} },
    );
    const hero = document.querySelector('[data-hanjullo-msg] img') as HTMLElement;
    expect(hero.getAttribute('role')).toBeNull();
  });

  it('블록 값이 비배열(판정 불가)이어도 fail-closed (Codex 3R)', () => {
    const mod = makeModule();
    mod.renderCenterModal(
      baseMsg({ template: 'center_modal', imageLinkUrl: 'https://mall.example/stale', contentBlocks: { bad: true } }),
      '제목', '본문', '/hero.jpg', '', [], 'fade', null, { customer: {} },
    );
    const hero = document.querySelector('[data-hanjullo-msg] img') as HTMLElement;
    expect(hero.getAttribute('role')).toBeNull();
  });

  it('정상 파싱된 빈 배열(블록 없음)은 링크 허용 — flat 메시지 기능 보존', () => {
    const mod = makeModule();
    mod.renderCenterModal(
      baseMsg({ template: 'center_modal', imageLinkUrl: 'https://mall.example/ok', content_blocks: '[]' }),
      '제목', '본문', '/hero.jpg', '', [], 'fade', null, { customer: {} },
    );
    const hero = document.querySelector('[data-hanjullo-msg] img') as HTMLElement;
    expect(hero.getAttribute('role')).toBe('link');
  });

  it('단일 포스터 — 링크 미설정 = role 없음(회귀 0)', () => {
    const mod = makeModule();
    mod.renderPoster(baseMsg({}), '제목', '본문', '/one.jpg', '', [], 'fade', null, { customer: {} });
    const hero = document.querySelector('[data-hanjullo-msg] img') as HTMLElement;
    expect(hero.getAttribute('role')).toBeNull();
  });

  it('중앙 모달 — snake_case(image_link_url)도 수용', () => {
    const mod = makeModule();
    mod.renderCenterModal(
      baseMsg({ template: 'center_modal', image_link_url: 'https://mall.example/p' }),
      '제목', '본문', '/hero.jpg', '', [], 'fade', null, { customer: {} },
    );
    const hero = document.querySelector('[data-hanjullo-msg] img') as HTMLElement;
    expect(hero.getAttribute('role')).toBe('link');
  });
});

// ★ 2026-07-31 (Codex 1R ①) — 메시지 DOM 제거는 SDK 래퍼 마커로만 판정한다.
//   옛 parentElement 추론은 inline_card에서 고객사 호스트 컨테이너를 삭제했다(호스트 보존 회귀 고정).
describe('removeMessageDom — 고객사 호스트 컨테이너 보존', () => {
  beforeEach(() => {
    stubMatchMedia();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    // track()의 fetch 왕복은 이 테스트의 관심사가 아님 — 네트워크 스텁
    (globalThis as any).fetch = () => Promise.resolve({ ok: true, json: async () => ({}) });
  });

  it('inline_card — 이미지 클릭이 몰 호스트 컨테이너와 이웃 콘텐츠를 보존한다', () => {
    const mod = makeModule();
    const host = document.createElement('div');
    host.id = 'mall-host';
    const sibling = document.createElement('p');
    sibling.textContent = '몰 자체 콘텐츠';
    host.appendChild(sibling);
    document.body.appendChild(host);

    mod.renderInlineCard(
      baseMsg({ template: 'inline_card', imageLinkUrl: 'https://mall.example/event' }),
      '제목', '본문', '/inline.jpg', '', [], { customer: {}, containerSelector: '#mall-host' },
    );
    const img = host.querySelector('[data-hanjullo-msg] img') as HTMLElement;
    expect(img.getAttribute('role')).toBe('link');

    img.click();
    // 호스트·이웃은 살아 있고 메시지 루트만 제거
    expect(document.getElementById('mall-host')).toBeTruthy();
    expect(host.textContent).toContain('몰 자체 콘텐츠');
    expect(host.querySelector('[data-hanjullo-msg]')).toBeNull();
  });

  it('inline_card — CTA 버튼 클릭도 호스트를 보존한다(같은 뿌리 전수 수정)', () => {
    const mod = makeModule();
    const host = document.createElement('div');
    host.id = 'mall-host-2';
    document.body.appendChild(host);

    mod.renderInlineCard(
      baseMsg({ template: 'inline_card' }),
      '제목', '본문', null, '',
      [{ id: 'btn_primary', label: '보기', action_url: 'https://mall.example/p', style: 'primary' }],
      { customer: {}, containerSelector: '#mall-host-2' },
    );
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '보기') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(document.getElementById('mall-host-2')).toBeTruthy();
    expect(host.querySelector('[data-hanjullo-msg]')).toBeNull();
  });

  it('포스터(모달류) — 이미지 클릭 시 SDK 래퍼(data-hanjullo-wrap)까지 제거', () => {
    const mod = makeModule();
    mod.renderPoster(baseMsg({ imageLinkUrl: 'https://mall.example/land' }), '제목', '본문', '/one.jpg', '', [], 'fade', null, { customer: {} });
    const wrap = document.querySelector('[data-hanjullo-wrap]') as HTMLElement;
    expect(wrap).toBeTruthy();
    const hero = wrap.querySelector('[data-hanjullo-msg] img') as HTMLElement;
    hero.click();
    expect(document.querySelector('[data-hanjullo-wrap]')).toBeNull();
    expect(document.querySelector('[data-hanjullo-msg]')).toBeNull();
  });
});
