/**
 * sales-outreach-render.test.ts — 렌더 클라이언트·승격 판정·합집합·재료 v2(2026-09-06 · S1)
 * 크롬 0 · 외부 네트워크 0. 클라이언트는 127.0.0.1 임시 서버로만 검증한다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  renderPageGuarded, countMaterials, shouldEscalateToRender, RENDER_ESCALATION, unionStrings, unionProducts, unionImageDetails, mergeCtaLinks,
  buildMaterialsV2, visibleTextChars,
} from '../sales-outreach-render';

const servers: http.Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r())); });

async function serve(handler: http.RequestListener): Promise<string> {
  const s = http.createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

describe('renderPageGuarded 클라이언트', () => {
  it('워커 미기동(ECONNREFUSED) = 즉시 unavailable · throw 0', async () => {
    const dead = await serve(() => undefined);
    await new Promise<void>((r) => servers.pop()!.close(() => r()));
    const r = await renderPageGuarded('https://www.isoi.co.kr', { requestTimeoutMs: 3000, baseUrl: dead });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reason).toBe('unavailable');
  });
  it('409 = busy · 200 ok 본문 = 결과 매핑 · 200 실패 본문 = 사유 전달', async () => {
    let mode: 'busy' | 'ok' | 'blocked' = 'busy';
    const base = await serve((req, res) => {
      if (mode === 'busy') { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'busy' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (mode === 'ok') res.end(JSON.stringify({ ok: true, finalUrl: 'https://www.isoi.co.kr/', html: '<html><body>렌더</body></html>', text: '렌더', screenshotBase64: null, meta: { engine: 'chrome', elapsedMs: 10, bytes: 1, blockedRequests: 0, navigations: 1, textChars: 2, imgCount: 0, imgWide: 0, sandbox: true, timedOut: false } }));
      else res.end(JSON.stringify({ ok: false, reason: 'blocked', detail: '최종 호스트 이탈' }));
    });
    const busy = await renderPageGuarded('https://www.isoi.co.kr', { baseUrl: base });
    expect(busy.ok).toBe(false); if (!busy.ok) expect(busy.failure.reason).toBe('busy');
    mode = 'ok';
    const ok = await renderPageGuarded('https://www.isoi.co.kr', { baseUrl: base });
    expect(ok.ok).toBe(true); if (ok.ok) { expect(ok.result.html).toContain('렌더'); expect(ok.result.meta.engine).toBe('chrome'); }
    mode = 'blocked';
    const bl = await renderPageGuarded('https://www.isoi.co.kr', { baseUrl: base });
    expect(bl.ok).toBe(false); if (!bl.ok) { expect(bl.failure.reason).toBe('blocked'); expect(bl.failure.detail).toContain('이탈'); }
  });
  it('기본 진입점은 renderPageGuarded 를 export 한다(모듈 형태 고정)', () => {
    expect(typeof renderPageGuarded).toBe('function');
  });
});

describe('countMaterials · shouldEscalateToRender', () => {
  const rich = `<html><body>${'본문 '.repeat(700)}
    ${[1, 2, 3, 4, 5].map((i) => `<a href="/product/${i}0"><img src="/p${i}.jpg"><p>상품 이름 ${i} 코튼</p><span>${i}9,000원</span><del>${i + 1}9,000원</del></a>`).join('')}
    <img src="/banner1.jpg"><img src="/banner2.jpg"></body></html>`;
  const shell = `<html><head><meta property="og:image" content="/share.jpg"></head><body>사이트 연결이 잠시 지연되고 있습니다</body></html>`;
  it('서버 렌더 대형몰 형태는 승격하지 않는다', () => {
    const c = countMaterials(rich, 'https://www.brand.com/');
    expect(c.products).toBeGreaterThanOrEqual(RENDER_ESCALATION.minProducts);
    expect(c.discountPairs).toBeGreaterThanOrEqual(1);
    expect(c.imageCandidates).toBeGreaterThanOrEqual(RENDER_ESCALATION.minImages);
    expect(c.textChars).toBeGreaterThanOrEqual(RENDER_ESCALATION.minTextChars);
    expect(shouldEscalateToRender(c)).toEqual({ escalate: false, reasons: [] });
  });
  it('SPA 껍데기는 승격 사유 4개가 전부 켜진다 · 정적 실패(null)는 static_unavailable', () => {
    const c = countMaterials(shell, 'https://www.isoi.co.kr/');
    expect(c.products).toBe(0);
    const e = shouldEscalateToRender(c);
    expect(e.escalate).toBe(true);
    expect(e.reasons).toEqual(['few_products', 'few_images', 'thin_text', 'no_discount_pairs']);
    expect(shouldEscalateToRender(null)).toEqual({ escalate: true, reasons: ['static_unavailable'] });
  });
  it('visibleTextChars 는 script·style 을 뺀다', () => {
    expect(visibleTextChars('<script>var a = "가나다라마바사";</script><style>.a{}</style><p>본문</p>')).toBe(2);
  });
});

describe('합집합 · 재료 v2', () => {
  it('렌더가 앞 · 정적이 뒤 · 중복 제거 · 상한', () => {
    expect(unionStrings(['a', 'b'], ['b', 'c', 'd'], 3)).toEqual(['a', 'b', 'c']);
    const p = (name: string, link: string) => ({ name, price: 1000, discount_price: null, image_url: 'https://x/i.jpg', link_url: link });
    const u = unionProducts([p('렌더 상품', 'https://x/product/1')], [p('정적 상품', 'https://x/product/1'), p('정적 둘', 'https://x/product/2')], 10);
    expect(u.map((x) => x.name)).toEqual(['렌더 상품', '정적 둘']);
    const d = unionImageDetails([{ url: 'https://x/a.jpg', alt: 'A', order: 0 }], [{ url: 'https://x/a.jpg', alt: '중복', order: 0 }, { url: 'https://x/b.jpg', alt: 'B', order: 1 }], 10);
    expect(d).toEqual([{ url: 'https://x/a.jpg', alt: 'A', order: 0 }, { url: 'https://x/b.jpg', alt: 'B', order: 1 }]);
    expect(mergeCtaLinks({ 쿠폰: 'https://x/coupon' }, { 쿠폰: 'https://x/old', 세일: 'https://x/sale' })).toEqual({ 쿠폰: 'https://x/coupon', 세일: 'https://x/sale' });
  });
  it('buildMaterialsV2 는 계측·사회적 증거·승격 기록을 한 자리에 모은다(DDL 0 · jsonb 키)', () => {
    const m = buildMaterialsV2({
      source: 'render',
      products: [{ name: '세럼', price: 149000, discount_price: 79000, image_url: 'https://x/1.png', link_url: 'https://x/product/1', discount_rate: 46 }],
      banners: [{ url: 'https://x/b.jpg', alt: '추석 기획전', order: 0 }],
      text: '455,083 개의 리얼 리뷰 · 79,000원 · 4.9 (20,389) 4.9 (8,679)',
      staticCounts: { products: 0, discountPairs: 0, imageCandidates: 1, textChars: 385, priceMentions: 0 },
      escalation: { attempted: true, reasons: ['few_products', 'thin_text'] },
      now: new Date('2026-09-06T00:00:00Z'),
    });
    expect(m.v).toBe(2);
    expect(m.counts).toEqual({ products: 1, discountPairs: 1, banners: 1, textChars: m.counts.textChars, priceMentions: 1, staticTextChars: 385, staticProducts: 0 });
    expect(m.proof.reviewTotal).toBe(455083);
    expect(m.proof.rating).toBe(4.9);
    expect(m.escalation.attempted).toBe(true);
    expect(m.collectedAt).toBe('2026-09-06T00:00:00.000Z');
  });
});
