/**
 * ★ 2026-09-27 만들기 개편 S12·S13 — 주소 하나 → 재료 프리필.
 *   AI 0 · 렌더 대기 0 · 종료 행사 제외(표시 정리) · 사진은 회사 서빙 경로 사본 · 같은 회사·주소 10분 캐시 ·
 *   면허 = 담당자가 카드마다 켜는 "이 문구 그대로 쓰기"(모든 카드와 같은 규칙 · 서버 추측 판정 0 · Codex 3R~12R 결론).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readBrandPage, normalizeReadUrl, pageCardHash, __clearPageReadCache,
  type PageReaderDeps,
} from '../brand-page-reader';
import { normalizeBuildMaterials, resolveBuildProducts } from '../ai-auto-build-materials';

const C = '11111111-1111-4111-8111-111111111111';
const C2 = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-09-27T03:00:00Z');

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(2600);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const PAGE = `<html><head><title>하루온 이벤트</title><meta name="theme-color" content="#9a4f2c"></head><body>
<img class="logo" src="https://shop.example.com/img/logo.png" alt="HARUON logo">
<ul>
<li><a href="https://shop.example.com/event/1"><img src="https://shop.example.com/img/b1.jpg" alt="가을 신상 모음전"><strong>가을 신상 모음전</strong><p class="date">2026.10.01 ~ 2026.10.10</p></a></li>
<li><a href="https://shop.example.com/event/2"><img src="https://shop.example.com/img/b2.jpg" alt="회원 추가 혜택"><strong>회원 추가 혜택</strong><p class="date">2026.10.01 ~ 2026.12.31</p></a></li>
<li><a href="https://shop.example.com/event/3"><img src="https://shop.example.com/img/b3.jpg" alt="지난 여름 세일"><strong>지난 여름 세일</strong><p class="date">2026.07.01 ~ 2026.07.31</p></a></li>
</ul></body></html>`;

function deps(over: Partial<PageReaderDeps> = {}): PageReaderDeps & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    fetchHtml: async (url) => { calls.push(`html:${url}`); return { html: PAGE, baseUrl: url, finalUrl: url }; },
    render: async (url, opts) => { calls.push(`render:${opts.queueWaitMs}`); return { ok: false, failure: { reason: 'busy', detail: 'x' } }; },
    fetchImage: async (u) => { calls.push(`img:${u}`); return { buffer: png(u.includes('logo') ? 200 : 1200, u.includes('logo') ? 60 : 900), mime: 'image/png', ext: 'png' }; },
    storeImage: () => () => `/api/cdp/inapp/image/${C}/img${++n}.png`,
    mallHosts: async () => [],
    now: () => NOW,
    ...over,
  };
}

beforeEach(() => __clearPageReadCache());

describe('S12 주소 정규화', () => {
  it('http(s) · 스킴 없으면 https · 공백·긴 주소·호스트 없는 값 거부', () => {
    expect(normalizeReadUrl('shop.example.com/event')).toBe('https://shop.example.com/event');
    expect(normalizeReadUrl('https://shop.example.com/e#top')).toBe('https://shop.example.com/e');
    expect(normalizeReadUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeReadUrl('https://a b.com')).toBeNull();
    expect(normalizeReadUrl('localhost')).toBeNull();
    expect(normalizeReadUrl('x'.repeat(600))).toBeNull();
  });
});

describe('S12 readBrandPage', () => {
  it('행사 카드(종료 행사 제외) · 사진 사본(회사 경로) · 로고 · 색 · 렌더는 대기 0 으로만 · AI 0', async () => {
    const d = deps();
    const r = await readBrandPage(C, 'https://shop.example.com/event', d);
    expect(r.cards.map((c) => c.title)).toEqual(['가을 신상 모음전', '회원 추가 혜택']);
    expect(r.cards[0].imageUrl?.startsWith(`/api/cdp/inapp/image/${C}/`)).toBe(true);
    expect(r.cards[0].hash).toBe(pageCardHash(r.cards[0].title, r.cards[0].text));
    expect(r.logoUrl?.startsWith(`/api/cdp/inapp/image/${C}/`)).toBe(true);
    expect(r.brandColor).toBe('#9a4f2c');
    expect(d.calls.filter((c) => c.startsWith('render:'))).toEqual(['render:0']);
    expect(r.rendered).toBe(false);
    expect(r.readId).toMatch(/^[a-f0-9]{32}$/);
    expect(r.mallDomain).toBe(false);
  });
  it('같은 회사·같은 주소는 10분 캐시(크롤 1회) · 다른 회사는 새로 읽는다', async () => {
    const d = deps();
    const a = await readBrandPage(C, 'https://shop.example.com/event', d);
    const b = await readBrandPage(C, 'https://shop.example.com/event', d);
    expect(b.cached).toBe(true);
    expect(b.readId).toBe(a.readId);
    expect(d.calls.filter((c) => c.startsWith('html:'))).toHaveLength(1);
    const other = await readBrandPage(C2, 'https://shop.example.com/event', d);
    expect(other.readId).not.toBe(a.readId);
  });
  it('몰 연동 도메인이면 mallDomain = true', async () => {
    const r = await readBrandPage(C, 'https://www.shop.example.com/event', deps({ mallHosts: async () => ['shop.example.com'] }));
    expect(r.mallDomain).toBe(true);
  });
  it('페이지를 못 읽으면 READ_FAILED(422) · 형식이 틀리면 URL_INVALID(400)', async () => {
    await expect(readBrandPage(C, 'https://shop.example.com/x', deps({ fetchHtml: async () => null }))).rejects.toMatchObject({ status: 422, code: 'READ_FAILED' });
    await expect(readBrandPage(C, 'ftp://x', deps())).rejects.toMatchObject({ status: 400, code: 'URL_INVALID' });
  });
});

// ★ 2026-09-27 Codex 3R~12R 결론 — 읽어 온 카드는 재료다. 면허(할인율·기간 그대로 쓰기)는 담당자가 카드마다 켠다(서버 추측 판정 0).
//   지난 행사를 빼는 것은 표시 정리일 뿐 면허와 무관하다.
describe('읽어 온 카드 = 재료 · 지난 행사 제외(표시 정리)', () => {
  it('카드에 면허 판정 필드가 없다(면허 = 화면 체크)', async () => {
    const r = await readBrandPage(C, 'https://shop.example.com/event', deps());
    expect(r.cards.length).toBeGreaterThan(0);
    for (const c of r.cards) {
      expect('licensable' in c).toBe(false);
      expect('endDate' in c).toBe(false);
    }
    expect(r.cards[0].periodRaw).toBe('2026.10.01 ~ 2026.10.10');
  });
  it('목록 카드 없는 페이지: 날짜가 전부 지났으면 카드 0(자르지 않은 원문 기준) · 날짜가 없으면 카드 1', async () => {
    const long = `<html><head><title>가을 특가</title></head><body><h1>가을 특가 전 품목 30% 할인</h1><p>${'혜택 안내 문구입니다. '.repeat(700)}</p><p>행사 기간 2026.07.01 ~ 2026.07.31</p></body></html>`;
    const r = await readBrandPage(C, 'https://shop.example.com/long', deps({ fetchHtml: async (url) => ({ html: long, baseUrl: url, finalUrl: url }) }));
    expect(r.cards).toHaveLength(0);
    __clearPageReadCache();
    const plain = `<html><head><title>가을 특가</title></head><body><h1>가을 특가 전 품목 30% 할인</h1></body></html>`;
    const p2 = await readBrandPage(C, 'https://shop.example.com/plain', deps({ fetchHtml: async (url) => ({ html: plain, baseUrl: url, finalUrl: url }) }));
    expect(p2.cards).toHaveLength(1);
  });
  it('목록 카드: 추출기 종료일(마크업 속성의 두 자리 연도 포함)이 지났으면 뺀다', async () => {
    const html = `<html><head><title>이벤트</title></head><body><ul>
<li data-period="26.7.1(수) ~ 26.7.31(금)"><a href="https://shop.example.com/event/9"><img src="https://shop.example.com/img/s9.jpg" alt="지난 특가"><strong>지난 특가 모음</strong></a></li>
<li data-period="26.9.1(화) ~ 26.10.31(토)"><a href="https://shop.example.com/event/10"><img src="https://shop.example.com/img/s10.jpg" alt="가을 특가"><strong>가을 특가 모음</strong></a></li>
</ul></body></html>`;
    const r = await readBrandPage(C, 'https://shop.example.com/list9', deps({ fetchHtml: async (url) => ({ html, baseUrl: url, finalUrl: url }) }));
    expect(r.cards.map((c) => c.title)).toEqual(['가을 특가 모음']);
  });
  it('지난 목록 카드를 전부 뺀 페이지를 페이지 한 장으로 되살리지 않는다(13R)', async () => {
    const html = `<html><head><title>여름 특가 50% 할인</title></head><body><ul>
<li data-period="26.7.1(수) ~ 26.7.31(금)"><a href="https://shop.example.com/event/11"><img src="https://shop.example.com/img/s11.jpg" alt="여름 특가"><strong>여름 특가 50% 할인</strong></a></li>
</ul></body></html>`;
    const r = await readBrandPage(C, 'https://shop.example.com/list11', deps({ fetchHtml: async (url) => ({ html, baseUrl: url, finalUrl: url }) }));
    expect(r.cards).toHaveLength(0);
  });
});

describe('S13 재료 계약 — readId·readHash · 홈페이지 상품(site)', () => {
  const base = { version: 1, attemptToken: '44444444-4444-4444-8444-444444444444', expectedTotal: 5, channel: 'dm' };
  it('카드 readId(32 hex)·readHash(16 hex)만 받는다', () => {
    const ok = normalizeBuildMaterials({ ...base, eventCards: [{ id: 'c1', title: '가을', text: '가을 신상', readId: 'a'.repeat(32), readHash: 'b'.repeat(16) }] }, C);
    expect(ok.ok && ok.materials.eventCards[0]).toMatchObject({ readId: 'a'.repeat(32), readHash: 'b'.repeat(16) });
    const bad = normalizeBuildMaterials({ ...base, eventCards: [{ id: 'c1', title: '가을', text: '가을 신상', readId: 'zz', readHash: 'b'.repeat(16) }] }, C);
    expect(bad.ok && bad.materials.eventCards[0].readId).toBeUndefined();
  });
  it('site 상품 = 회사 경로 사본 + http 링크일 때만 · 가격은 버린다 · 카드는 가격 없음', () => {
    const n = normalizeBuildMaterials({ ...base, eventCards: [{ id: 'c1', title: '가을', text: '가을 신상' }], products: [
      { source: 'site', name: '세럼', url: 'https://shop.example.com/p/1', imageUrl: `/api/cdp/inapp/image/${C}/s1.png`, price: 9999 },
      { source: 'site', name: '외부 사진', url: 'https://shop.example.com/p/2', imageUrl: 'https://evil.example.com/x.png' },
      { source: 'site', name: '남의 회사', url: 'https://shop.example.com/p/3', imageUrl: `/api/cdp/inapp/image/${C2}/x.png` },
    ] }, C);
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.materials.products).toHaveLength(1);
    expect(n.materials.products[0]).toMatchObject({ source: 'site', price: null, salePrice: null, discountRate: null });
    const res = resolveBuildProducts(n.materials.products, {});
    expect(res.cards[0]).toMatchObject({ name: '세럼', price: null, discount_price: null, source: 'site', link_url: 'https://shop.example.com/p/1' });
  });
});

describe('S13 생성 배선 — 주소 읽기 면허 = 화면 체크(서버 추측 판정 0) · 감사 기록은 요청 도달 뒤', () => {
  it('campaign-quick 소스 계약', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '../campaign-quick.ts'), 'utf-8');
    const prep = src.slice(src.indexOf('function prepareBuildMaterials('), src.indexOf('function prepareBuildMaterials(') + 2500);
    expect(prep).not.toContain('readLicense');
    expect(src).not.toContain('readLicenseOf');
    const gen = src.slice(src.indexOf('export async function generateFromBuildMaterials('));
    expect(gen.indexOf('deps.auditRead(')).toBeGreaterThan(-1);
    expect(gen.indexOf('deps.auditRead(')).toBeLessThan(gen.indexOf('deps.checkCredit('));
    const route = fs.readFileSync(path.join(__dirname, '../../routes/event-campaigns.ts'), 'utf-8');
    expect(route).toContain("eventCampaignRouter.post('/materials/read-url'");
    expect(route).toContain('tryAcquireInflight(lockKey)');
    vi.restoreAllMocks();
  });
});
