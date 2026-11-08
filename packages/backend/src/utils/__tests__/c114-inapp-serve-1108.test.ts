/**
 * ★ 2026-11-08 C114 인앱 서빙 = 내보내지 않음 0 · 옛 앱 변환 · 웹뷰 호스트(설계서 docs/2026-11-08-c114-roadmap-v2-design.md §3 I-1 · I-2 · §5)
 *   CT-V1 서빙 변환 표(모양 × 장 수 × caps 없음 · 넷 · webview · 일부) · 대체 줄이 그려지는 쪽인지 SDK 판정으로 다시 읽기
 *   CT-V2 webview 낱말 = 판 넷 · CT-V1' 편집기 「구버전 앱 모습」 거울(legacyAppPreviewOf) = 서버 변환과 같은 결과
 *   웹뷰 페이지 = CSP connect-src 'none' · 스크립트 = self + nonce · 부팅 글이 API 를 부르지 않는다
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  gateInAppForClient, toServedMessage, legacyServeTransform, parseInAppClientCaps, withInAppImageFit, inAppDeadlineText,
  INAPP_CLIENT_CAPS,
} from '../inapp-message';
import { buildInAppWebviewPage, INAPP_WEBVIEW_SDK_PATH } from '../inapp-webview-page';
import { ASPECT_RATIOS } from '../image-fit-spec';
import { parseFitOption } from '../image-serve';
import { usesPosterFrame, drawsWithPosterFrame } from '../../../../sdk-js/src/poster-frame';
import { legacyAppPreviewOf, inAppDeadlineText as feDeadline } from '../../../../frontend/src/components/inapp/legacy-app-view';

const IMG = (n: number) => `/api/cdp/inapp/image/11111111-2222-3333-4444-555555555555/p${n}.jpg`;
const serve = (m: any, capsRaw: string | undefined) => {
  const caps = parseInAppClientCaps(capsRaw);
  return legacyServeTransform(toServedMessage(gateInAppForClient(m, caps)), caps);
};
const msg = (design: any, slides: number, over: Record<string, any> = {}): any => ({
  id: 'm1', template: 'full_image', title: '제목', body: '본문', badgeText: null, imageUrl: IMG(0), buttons: [],
  endAt: '2026-11-30T14:59:00.000Z', design,
  posterSlides: Array.from({ length: slides }, (_, i) => ({ image_url: IMG(i), title: `장${i}`, body: `본문${i}` })),
  ...over,
});
const ALL = INAPP_CLIENT_CAPS.join(',');

describe('CT-V2 webview 낱말', () => {
  it('webview = 판 넷 · 다른 낱말과 섞여도 넷', () => {
    expect([...parseInAppClientCaps('webview')].sort()).toEqual([...INAPP_CLIENT_CAPS].sort());
    expect([...parseInAppClientCaps('foo,webview')].sort()).toEqual([...INAPP_CLIENT_CAPS].sort());
  });
});

describe('CT-V1 서빙 변환 표 — 내보내지 않음 0', () => {
  const designs: Record<string, any> = {
    baked_sheet: { poster_text: 'baked' }, baked_card: { poster_text: 'baked', poster_frame: 'card' },
    overlay: {}, live_card: { poster_frame: 'card' },
    coupon: { poster_strip: { type: 'coupon', code: 'HELLO10' } }, countdown: { poster_strip: { type: 'countdown' } },
    baked_coupon: { poster_text: 'baked', poster_strip: { type: 'coupon', code: 'HELLO10' } },
    event_card: { poster_layout: 'event_card' }, banner_sheet: { poster_layout: 'banner_sheet' },
  };
  for (const [name, d] of Object.entries(designs)) for (const n of [1, 3]) for (const caps of [undefined, 'webview', ALL, 'poster_baked', 'frame_card', 'strip_coupon']) {
    it(`${name} × ${n}장 × caps=${caps ?? '없음'} = 내보낸다(null 0)`, () => {
      const out = serve(msg(d, n), caps);
      expect(out).toBeTruthy();
      expect(out.posterSlides!.length).toBe(n);
    });
  }

  it('웹 SDK · 웹뷰(판 넷) = 변환 0(통짜 글 비우기만 · 틀 · 띠 · 그림 주소 그대로)', () => {
    for (const caps of [ALL, 'webview']) {
      const out = serve(msg({ poster_text: 'baked', poster_frame: 'card', poster_strip: { type: 'coupon', code: 'X1' } }, 3), caps);
      expect(out.design).toEqual({ poster_text: 'baked', poster_frame: 'card', poster_strip: { type: 'coupon', code: 'X1' } });
      expect(out.posterSlides!.map((s) => s.image_url)).toEqual([IMG(0), IMG(1), IMG(2)]);
    }
  });

  // ★ C116 D9 대체 맞춤 = ?fit=inapp(1:1 캔버스 + 안전 칸) · 한 장 · flat(imageUrl)도(팝폰 한 장 = 66% 상한 cover 로 잘렸다)
  it('옛 앱(caps 없음) · 카드 = 틀 지움(장 수 무관) · 장 그림 · flat 그림 = ?fit=inapp(여러 장 · 한 장)', () => {
    const multi = serve(msg({ poster_frame: 'card' }, 3), undefined);
    expect(multi.design).toEqual({});
    expect(multi.posterSlides!.map((s) => s.image_url)).toEqual([0, 1, 2].map((i) => `${IMG(i)}?fit=inapp`));
    expect(multi.imageUrl).toBe(`${IMG(0)}?fit=inapp`);
    const one = serve(msg({ poster_frame: 'card' }, 1), undefined);
    expect(one.posterSlides![0].image_url).toBe(`${IMG(0)}?fit=inapp`);
    expect(one.imageUrl).toBe(`${IMG(0)}?fit=inapp`);
  });

  it('옛 앱 · 통짜 = 글 비움(옛 앱은 글이 비면 막을 안 그린다) · 대체 글 = 장 제목', () => {
    const out = serve(msg({ poster_text: 'baked' }, 2), undefined);
    expect(out.title).toBe('');
    expect(out.body).toBe('');
    expect(out.posterSlides![0]).toMatchObject({ alt: '장0' });
    expect((out.posterSlides![0] as any).title).toBeUndefined();
  });

  it('옛 앱 · 쿠폰 · 남은 시간 = 띠 지움 + 글 한 줄(메시지 본문 · 첫 장 본문)', () => {
    const c = serve(msg({ poster_strip: { type: 'coupon', code: 'HELLO10' } }, 2), undefined);
    expect(c.design).toEqual({});
    expect(c.body).toBe('본문\n쿠폰 코드 HELLO10');
    expect(c.posterSlides![0].body).toBe('본문0\n쿠폰 코드 HELLO10');
    expect(c.posterSlides![1].body).toBe('본문1');
    const t = serve(msg({ poster_strip: { type: 'countdown' } }, 1), undefined);
    expect(t.body).toBe('본문\n11월 30일 23:59까지');
    const none = serve(msg({ poster_strip: { type: 'countdown' } }, 1, { endAt: null }), undefined);
    expect(none.body).toBe('본문');
  });

  it('(Codex 설계 1R ①) poster_baked 만 가진 앱 + 통짜 쿠폰 = 통짜를 글 얹기로 내려 대체 줄이 그려진다', () => {
    const out = serve(msg({ poster_text: 'baked', poster_strip: { type: 'coupon', code: 'HELLO10' } }, 1), 'poster_baked');
    expect(out.design?.poster_text).toBeUndefined();
    expect(out.design?.poster_strip).toBeUndefined();
    expect(out.posterSlides![0].body).toBe('쿠폰 코드 HELLO10');
    // SDK 그리는 판정으로 다시 읽기 = 통짜(글 안 그림)가 아니다 · 새 틀 경로
    expect(drawsWithPosterFrame(out.design)).toBe(true);
    expect(usesPosterFrame(out.design)).toBe(false);
    // 대체 줄이 없는 통짜는 내리지 않는다
    expect(serve(msg({ poster_text: 'baked' }, 1), 'poster_baked').design).toEqual({ poster_text: 'baked' });
  });

  it('옛 앱 · 이벤트 카드 = 장 image_fit contain · 배너 시트 = 그대로 · v4 판이 하나라도 있으면 fit 0', () => {
    expect(serve(msg({ poster_layout: 'event_card' }, 2), undefined).posterSlides!.every((s) => s.image_fit === 'contain')).toBe(true);
    expect(serve(msg({ poster_layout: 'banner_sheet' }, 2), undefined).posterSlides!.map((s) => s.image_url)).toEqual([IMG(0), IMG(1)]);
    expect(serve(msg({}, 3), 'frame_card').posterSlides!.map((s) => s.image_url)).toEqual([IMG(0), IMG(1), IMG(2)]);
  });

  it('저장 행 무변경(사본만)', () => {
    const m = msg({ poster_frame: 'card', poster_strip: { type: 'coupon', code: 'A' } }, 2);
    const snap = JSON.parse(JSON.stringify(m));
    serve(m, undefined);
    expect(m).toEqual(snap);
  });
});

describe('그림 미리 맞춤 주소 · 비율 표', () => {
  // ★ C116 D9 · Codex 설계 1R ⑦ = 우리 그림 판정 = toOwnImageRef(믿는 호스트만) · 같은 경로 남의 호스트 = 그대로
  it('우리 그림만 ?fit=inapp · 남의 주소 · 남의 호스트 같은 경로 · 이미 fit = 그대로 · 쿼리 이어 붙임', () => {
    expect(withInAppImageFit(IMG(1))).toBe(`${IMG(1)}?fit=inapp`);
    expect(withInAppImageFit(`https://app.hanjul.ai${IMG(1)}`)).toBe(`https://app.hanjul.ai${IMG(1)}?fit=inapp`);
    expect(withInAppImageFit(`https://evil.example${IMG(1)}`)).toBe(`https://evil.example${IMG(1)}`);
    expect(withInAppImageFit('/api/cdp/inapp/example-image/beauty-1/0?v=123')).toBe('/api/cdp/inapp/example-image/beauty-1/0?v=123&fit=inapp');
    expect(withInAppImageFit('https://mall.example/a.jpg')).toBe('https://mall.example/a.jpg');
    expect(withInAppImageFit(`${IMG(1)}?fit=1x1`)).toBe(`${IMG(1)}?fit=1x1`);
    expect(withInAppImageFit('/api/cdp/inapp/image/../../etc/p.jpg')).toBe('/api/cdp/inapp/image/../../etc/p.jpg');
  });
  it('서빙 CT = inapp(1:1 + 안전 칸) 를 읽는다 · 옛 4x5 지움(무시) · 1x1 그대로', () => {
    expect(ASPECT_RATIOS.inapp).toEqual({ w: 1, h: 1, safe: { w: 0.8, h: 0.92 } });
    expect(ASPECT_RATIOS['4x5']).toBeUndefined();
    expect(parseFitOption({ fit: '4x5' })).toBeNull();
    expect(parseFitOption({ fit: 'inapp' })).toEqual({ aspect: 'inapp', mode: 'pad' });
    expect(parseFitOption({ fit: '1x1' })).toEqual({ aspect: '1x1', mode: 'pad' });
  });
  it('예시 그림 서빙도 ?fit= 을 읽는다(올린 그림과 같은 CT 규칙)', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'routes', 'cdp.ts'), 'utf8');
    const ex = route.slice(route.indexOf("router.get('/inapp/example-image/:id/:slide'"), route.indexOf("router.get('/inapp/webview'"));
    expect(ex).toContain('getServePath(file.absPath, parseFitOption(req.query))');
  });
});

describe("CT-V1' 편집기 「구버전 앱 모습」 = 서버 변환(caps 없음)과 같은 결과", () => {
  const cases: Array<[string, any, number]> = [
    ['통짜', { poster_text: 'baked' }, 2],
    ['카드', { poster_frame: 'card', dismiss_mode: 'snooze_day' }, 3],
    ['쿠폰', { poster_strip: { type: 'coupon', code: 'HELLO10' } }, 2],
    ['남은 시간', { poster_strip: { type: 'countdown' } }, 1],
    ['통짜 쿠폰', { poster_text: 'baked', poster_strip: { type: 'coupon', code: 'Z9' } }, 1],
    ['사진 위 글', {}, 3],
  ];
  for (const [name, d, n] of cases) {
    it(name, () => {
      const m = msg(d, n);
      const server = serve(m, undefined);
      const fe = legacyAppPreviewOf(d, m.posterSlides, m.endAt);
      const { dismiss_mode: _x, ...serverDesign } = server.design || {};
      expect(fe.design).toEqual(serverDesign);
      // 글(제목 · 본문) = 같은 값 · 그림 주소 미리 맞춤은 그리는 쪽(맞추기)이 같은 결과를 낸다
      expect(fe.slides.map((s: any) => [s.title ?? '', s.body ?? ''])).toEqual(server.posterSlides!.map((s: any) => [s.title ?? '', s.body ?? '']));
    });
  }
  it('게시 끝 시각 글 = 서버와 같다', () => {
    for (const v of ['2026-11-30T14:59:00.000Z', '2026-01-01T00:00:00Z', null, 'x']) expect(feDeadline(v as any)).toBe(inAppDeadlineText(v as any));
  });
});

describe('웹뷰 페이지(계약 v5)', () => {
  const page = buildInAppWebviewPage('abc123');
  it("CSP = connect-src 'none' · script = self + nonce · default none", () => {
    expect(page.csp).toContain("connect-src 'none'");
    expect(page.csp).toContain("script-src 'self' 'nonce-abc123'");
    expect(page.csp).toContain("default-src 'none'");
  });
  it('SDK = 서빙 최신 판 · 부팅 글 = nonce · API 호출 0 · 한 번만 그린다', () => {
    expect(page.html).toContain(`<script src="${INAPP_WEBVIEW_SDK_PATH}"></script>`);
    expect(page.html).toContain('<script nonce="abc123">');
    for (const bad of [/fetch\s*\(/, /XMLHttpRequest/, /sendBeacon/]) expect(page.html).not.toMatch(bad);
    expect(page.html).toContain('window.Hanjullo.renderInAppForHost(v)');
    expect(page.html).toContain('if(done)return;');
    expect(page.html).toContain('window.__HJL_INAPP__');
  });
  it('nonce 는 영숫자만(헤더 · 속성 깨기 0)', () => {
    expect(buildInAppWebviewPage('a"b;c').csp).toContain("'nonce-abc'");
  });
  it('라우트 = 공개 · 이 페이지만 CSP 덮어쓰기', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'routes', 'cdp.ts'), 'utf8');
    const r = route.slice(route.indexOf("router.get('/inapp/webview'"), route.indexOf("router.get('/inapp/active'"));
    expect(r).toContain("res.setHeader('Content-Security-Policy', page.csp);");
    expect(r).not.toContain('requireCdp');
  });
});
