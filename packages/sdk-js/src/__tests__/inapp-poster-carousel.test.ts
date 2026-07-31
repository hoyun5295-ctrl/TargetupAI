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

// ★ 2026-07-31 이미지 클릭 랜딩 — 링크 설정 시에만 이미지가 클릭 대상(role=link)이 된다
describe('이미지 클릭 랜딩 (imageLinkUrl · slide link_url)', () => {
  beforeEach(() => { stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; });

  it('캐러셀 — link_url 있는 슬라이드 이미지만 role=link + pointer', () => {
    const mod = makeModule();
    const slides = [
      { image_url: '/s1.jpg', link_url: 'https://mall.example/event' },
      { image_url: '/s2.jpg' },
    ];
    mod.renderPoster(baseMsg({ posterSlides: slides }), 'x', 'y', '/s1.jpg', '', [], 'fade', null, { customer: {} });
    const imgs = document.querySelectorAll('[data-hjl-carousel] img');
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
