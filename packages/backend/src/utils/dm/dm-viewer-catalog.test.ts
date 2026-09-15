/**
 * dm-viewer-catalog.test.ts — 슬라이드 모드 "카탈로그 보기"(PC 책 펼침) 게이트·출력 계약 (2026-09-15)
 *
 * 접수(Harold · 참고 = 메이크뷰 DM): 완성 이미지 슬라이드 DM을 PC에서 열면 430px 한 열이라 카탈로그 느낌이 없다.
 * 여기서 고정하는 것 —
 *   ① 게이트 = layout_mode slides · 펼친 뒤 전 장이 이미지 무대(isSwipeImagePage) · 2장 이상. 조건 밖 DM은 카탈로그 표식 0(기존 출력 그대로).
 *   ② 게이트 on = body 표식 + 책 크롬 마크업 + og 메타(제목·첫 장 절대 URL) + 핀치 확대 허용 viewport.
 *   ③ 추적은 기존 함수(updateCurrent·bumpSection)를 호출한다(비콘 본문 무변경) · 기존 키보드 핸들러는 카탈로그 활성 시 넘긴다(이중 처리 0).
 *   ④ PC 판정 = 폭 768 이상(터치형은 1024 이상) · PC에서 기존 뷰어·띠·화살표는 숨긴다 · 모바일 띠에는 전체보기 버튼만 더한다.
 *   ⑤ 카탈로그 블록 안 문구 = 줄표·native dialog·모델명 0.
 */
import { describe, it, expect } from 'vitest';
import { renderDmViewerHtml } from './dm-viewer';

const gallery = (id: string, urls: string[], layout: string | undefined = 'list_1xN') => ({
  id, type: 'gallery', order: 0, visible: true,
  props: { images: urls.map((u) => ({ url: u })), ...(layout ? { layout } : {}), full_bleed: true },
});

// short_code 에 'cat' 이 들어가면 스크립트의 CODE = 'dm-cat001' 이 표식 검사(not.toContain('dm-cat'))에 걸린다 — 픽스처는 'book'.
const base = { short_code: 'book001', title: '카탈로그 DM', store_name: '테스트몰', layout_mode: 'slides' };

/** 완성 이미지 업로드(슬라이드) 형태 — 장마다 이미지 1장 갤러리 */
const imageDm = {
  ...base,
  pages: [
    { id: 'p1', sections: [gallery('g1', ['/api/dm/images/c1/a.jpg'])] },
    { id: 'p2', sections: [gallery('g2', ['/api/dm/images/c1/b.jpg'])] },
    { id: 'p3', sections: [gallery('g3', ['https://cdn.example.test/c.jpg'])] },
  ],
};
/** 갤러리 3장 한 장 DM — 뷰어가 3장으로 펼친 뒤 판정해야 한다 */
const expandDm = { ...base, pages: [{ id: 'p1', sections: [gallery('g1', ['/api/dm/images/c1/a.jpg', '/api/dm/images/c1/b.jpg', '/api/dm/images/c1/c.jpg'])] }] };
/** 혼합 장(제목·버튼) + 이미지 장 — 게이트 밖 */
const mixedDm = {
  ...base,
  pages: [
    { id: 'p1', sections: [
      { id: 's1', type: 'hero', order: 0, visible: true, props: { headline: '헤드라인' } },
      { id: 's2', type: 'cta', order: 1, visible: true, props: { buttons: [{ label: '보기', url: 'https://x.test' }] } },
    ] },
    { id: 'p2', sections: [gallery('g1', ['/api/dm/images/c1/a.jpg', '/api/dm/images/c1/b.jpg'])] },
  ],
};
/** 1장짜리 — 책이 될 수 없다 */
const oneDm = { ...base, pages: [{ id: 'p1', sections: [gallery('g1', ['/api/dm/images/c1/a.jpg'])] }] };

const CATALOG_MARKS = ['data-dm-catalog="1"', 'class="dm-cat"', 'data-dm-cat="grid"', 'data-dm-cat="mgrid"', 'property="og:image"', '/* dm-cat:start */'];

/** 카탈로그 조각만 잘라낸다 — CSS 블록(첫 start~end) + 스크립트 블록(마지막 start~end). 그 사이 기존 뷰어 코드는 대상이 아니다. */
function catalogBlock(html: string): string {
  const s1 = html.indexOf('/* dm-cat:start */');
  const e1 = html.indexOf('/* dm-cat:end */', s1);
  const s2 = html.lastIndexOf('/* dm-cat:start */');
  const e2 = html.lastIndexOf('/* dm-cat:end */');
  expect(s1).toBeGreaterThan(-1);
  expect(e1).toBeGreaterThan(s1);
  expect(s2).toBeGreaterThan(e1);
  expect(e2).toBeGreaterThan(s2);
  return html.slice(s1, e1) + '\n' + html.slice(s2, e2);
}

describe('카탈로그 보기 게이트 — 전 장 이미지 무대 · 2장 이상', () => {
  it('장마다 이미지 1장인 슬라이드 DM = 게이트 on', () => {
    const html = renderDmViewerHtml(imageDm, '/api/dm/v');
    for (const m of CATALOG_MARKS) expect(html).toContain(m);
  });

  it('갤러리 N장 한 장 DM = 펼친 뒤(3장 무대) 판정 = on', () => {
    const html = renderDmViewerHtml(expandDm, '/api/dm/v');
    expect((html.match(/class="dm-page dm-page--stage"/g) || []).length).toBe(3);
    expect(html).toContain('data-dm-catalog="1"');
  });

  it('혼합 장 · scroll 모드 · 1장 = 게이트 off — 카탈로그 표식 0 · viewport 현행(user-scalable=no) · og 0', () => {
    for (const dm of [mixedDm, { ...imageDm, layout_mode: 'scroll' }, oneDm]) {
      const html = renderDmViewerHtml(dm, '/api/dm/v');
      for (const m of CATALOG_MARKS) expect(html).not.toContain(m);
      expect(html).not.toContain('dm-cat');
      expect(html).toContain('maximum-scale=1.0,user-scalable=no');
      expect(html).not.toContain('property="og:');
    }
  });
});

describe('게이트 on 출력 계약', () => {
  const html = renderDmViewerHtml(imageDm, '/api/dm/v');

  it('og 메타 = 제목(상호 - 제목) · 첫 장 절대 URL(상대 경로는 서비스 주소를 붙인다)', () => {
    expect(html).toContain('<meta property="og:title" content="테스트몰 - 카탈로그 DM">');
    expect(html).toContain('<meta property="og:image" content="https://hanjul.ai/api/dm/v/images/c1/a.jpg">');
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('첫 장이 이미 절대 URL이면 그대로 쓴다', () => {
    const h = renderDmViewerHtml({ ...imageDm, pages: [imageDm.pages[2], imageDm.pages[0]] }, '/api/dm/v');
    expect(h).toContain('<meta property="og:image" content="https://cdn.example.test/c.jpg">');
  });

  it('viewport = 핀치 확대 허용(최대 3배) · 현행 잠금 문구 0', () => {
    expect(html).toContain('maximum-scale=3.0,user-scalable=yes');
    expect(html).not.toContain('user-scalable=no');
  });

  it('추적 = 기존 updateCurrent·bumpSection 호출(비콘 본문 무변경) · 기존 키보드 핸들러는 카탈로그 활성 시 넘긴다', () => {
    const cat = catalogBlock(html);
    expect(cat).toMatch(/updateCurrent\(/);
    expect(cat).toMatch(/bumpSection\(/);
    expect(cat).not.toContain('sendBeacon');           // 비콘은 기존 sendTrack 한 곳
    expect(html).toContain('if (dmCatalogOn) return;');
    // 가드는 기존 ←/→ 핸들러 안에 있어야 한다
    const kb = html.slice(html.indexOf("e.key === 'ArrowRight'") - 400, html.indexOf("e.key === 'ArrowRight'"));
    expect(kb).toContain('if (dmCatalogOn) return;');
  });

  it('PC 판정 = 768 · 터치형 1024 · PC에서 기존 뷰어·띠·화살표 숨김 · 모바일 띠에 전체보기 버튼', () => {
    const cat = catalogBlock(html);
    expect(cat).toContain('innerWidth >= 768');
    expect(cat).toContain('innerWidth < 1024');
    expect(cat).toMatch(/body\.dm-cat-pc \.dm-viewer[^{]*\{display:none/);
    expect(cat).toMatch(/body\.dm-cat-pc[^{]*\.dm-page-dots[^{]*\{display:none/);
    expect(html).toMatch(/<div class="dm-page-dots">[\s\S]{0,200}data-dm-cat="mgrid"/);
  });

  it('책 구성 요소 — 낱장 넘김 · 두 쪽/한 쪽 · 확대 · 전체화면 · 전체보기 · 안내 · 처음/마지막', () => {
    expect(html).toContain('data-dm-cat="sheet"');
    expect(html).toContain('data-dm-cat="dual"');
    expect(html).toContain('data-dm-cat="single"');
    expect(html).toContain('data-dm-cat="fit"');
    expect(html).toContain('data-dm-cat="full"');
    expect(html).toContain('data-dm-cat="help"');
    expect(html).toContain('data-dm-cat="first"');
    expect(html).toContain('data-dm-cat="last"');
    expect(html).toContain('requestFullscreen');
    // 동작 축소 설정 = 넘김 대신 크로스페이드
    expect(html).toContain('prefers-reduced-motion');
  });

  it('카탈로그 블록 문구 = 줄표 0 · native dialog 0 · 모델명 0 · 이모지 0', () => {
    const s = html.indexOf('<!-- dm-cat -->');
    const e = html.indexOf('<!-- /dm-cat -->');
    expect(s).toBeGreaterThan(-1);
    const markup = html.slice(s, e);
    const cat = catalogBlock(html);
    for (const seg of [markup, cat]) {
      expect(seg).not.toContain('—');
      expect(seg).not.toMatch(/\b(alert|confirm|prompt)\(/);
      expect(seg).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic/);
      expect(seg).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });
});
