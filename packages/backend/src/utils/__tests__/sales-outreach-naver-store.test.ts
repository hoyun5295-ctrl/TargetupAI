/**
 * sales-outreach-naver-store.test.ts — ★ 2026-09-24 B 네이버 스토어 전용 판독기(설계 = docs/2026-09-24-outreach-naver-store-reader-design.md)
 * 고정 자료 = Harold 가 저장한 톤28 브랜드스토어 화면의 __PRELOADED_STATE__ 에서 허용 칸만 남긴 것(회원·주소 칸 0). 네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import {
  parseNaverStoreState, pickNaverStoreState, naverStoreStateFromHtml, storeCandidatesOf, eventCandidatesView, NAVER_STORE_STATE_KEYS,
} from '../sales-outreach-naver-store';

const STATE = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/naver-store-toun28-state.json'), 'utf8'));
const STORE = { kind: 'brand' as const, slug: 'toun28' };
const src = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('parseNaverStoreState — 톤28 원본', () => {
  const m = parseNaverStoreState(STATE, STORE)!;
  it('가게 이름 · 관심고객수 · 상품(중복 0 · 정가·할인가·할인율·리뷰)', () => {
    expect(m.storeName).toBe('톤28');
    expect(m.interestCount).toBe(118182);
    expect(m.products.length).toBeGreaterThan(5);
    expect(m.products.length).toBeLessThanOrEqual(12);
    expect(new Set(m.products.map((p) => p.id)).size).toBe(m.products.length);
    const cream = m.products.find((p) => p.name.includes('새벽 크림 2.0'))!;
    expect(cream).toMatchObject({ price: 38000, salePrice: 12900, discountRatio: 66 });
    expect(cream.tags).toContain('톤캉스');
    expect(cream.reviewCount).toBeGreaterThan(0);
  });
  it('기획 = 메뉴 중 꼬리표·이모지·보이는 배너 근거가 있는 것(메뉴 순서) · 고정·상품 분류 메뉴는 제외', () => {
    expect(m.campaigns.map((c) => c.name)).toEqual(['톤캉스', '추석선물', '슈퍼 적립', 'NEW']);
    const t = m.campaigns[0];
    expect(t.evidence).toEqual(expect.arrayContaining(['tag', 'emoji']));
    expect(t.link).toBe('https://brand.naver.com/toun28/category/980c00b0ec4b46debf0eb0acb7abdcf2');
    expect(t.productIds.length).toBeGreaterThanOrEqual(10);
    // 보이는 상품 묶음 제목 "NEW" 의 상품이 NEW 기획의 상품이 된다
    expect(m.campaigns[3].productIds.length).toBeGreaterThanOrEqual(6);
  });
  it('상태가 아니거나 메뉴·상품이 모두 없으면 null', () => {
    expect(parseNaverStoreState(null, STORE)).toBeNull();
    expect(parseNaverStoreState({ keepStore: { count: 3 } }, STORE)).toBeNull();
  });
});

describe('허용 목록 — 보는 사람의 회원·주소 칸은 서버로 오지 않는다', () => {
  it('pickNaverStoreState 는 허용 칸만 · channel·keepStore·categoryMenu 는 필요한 칸만', () => {
    const raw = { ...STATE, naverMember: { id: 'x', name: 'y' }, myAddress: [{ zip: '1' }], my: { a: 1 }, channel: { channelName: '톤28', url: 'toun28', seller: { phone: '010-9999-0000' } }, keepStore: { count: 1, kept: true } };
    const p = pickNaverStoreState(raw)!;
    expect(Object.keys(p).sort()).toEqual([...NAVER_STORE_STATE_KEYS].sort());
    const s = JSON.stringify(p);
    expect(s).not.toMatch(/naverMember|myAddress|"my"|seller|010-9999-0000|"kept"/);
    expect(p.channel).toEqual({ channelName: '톤28', url: 'toun28' });
  });
  it('naverStoreStateFromHtml — 저장본 안 스크립트(undefined 포함)를 읽어 허용 칸만', () => {
    const html = '<html><script>window.__PRELOADED_STATE__={"a":undefined,"keepStore":{"count":5},"naverMember":{"id":"x"},"categoryMenu":{"firstCategories":[{"id":"c1","name":"가을세일🍂"}]}}</script></html>';
    const p = naverStoreStateFromHtml(html)!;
    expect(p.keepStore).toEqual({ count: 5 });
    expect(JSON.stringify(p)).not.toContain('naverMember');
    expect(naverStoreStateFromHtml('<html>상태 없음</html>')).toBeNull();
  });
});

describe('행사 후보 — 스토어 기획 카드 · 목록 합치기는 함수 하나', () => {
  const material = parseNaverStoreState(STATE, STORE)!;
  const grab = { v: 2, store: 'brand:toun28', material, at: '2026-09-24T01:00:00.000Z', by: null };
  it('storeCandidatesOf — 기획마다 카드 후보(origin card · naver_store · 링크 = 메뉴 · 면허 · 본문 = 대표 상품 1줄)', () => {
    const c = storeCandidatesOf(grab);
    expect(c.map((x) => x.title)).toEqual(['톤캉스', '추석선물', '슈퍼 적립', 'NEW']);
    expect(c[0]).toMatchObject({ origin: 'card', source: 'naver_store', quote: '톤캉스', detailUrl: material.campaigns[0].link, benefitLicensed: true, periodRaw: null, bannerUrl: null });
    expect(c[0].parts?.title).toBe('톤캉스');
    expect(c[0].parts?.benefit).toMatch(/\d{1,3}(,\d{3})*원\(\d{1,2}%\)/);
    expect(c[0].parts?.benefit).toMatch(/외 \d+개$/);
    // 상품이 없는 기획은 본문 없음
    expect(c[1].parts?.benefit ?? null).toBeNull();
    // 판 1(글자) 저장분 · 빈 값 = 후보 0
    expect(storeCandidatesOf({ text: '옛 글자', chars: 3, at: 'x' })).toEqual([]);
    expect(storeCandidatesOf(null)).toEqual([]);
  });
  it('eventCandidatesView — 홈페이지 후보 뒤에 스토어 후보 · 옛 스토어 후보는 빼고 새 것 · 스토어 없으면 종전 그대로', () => {
    const home = { quote: '추석 기획전', sourceUrl: 'https://www.toun28.com', startDate: null, endDate: null, benefitLicensed: false, origin: 'crawl' as const };
    const oldStore = { ...storeCandidatesOf(grab)[0], title: '옛 기획', quote: '옛 기획' };
    const v = eventCandidatesView([home, oldStore], grab);
    expect(v[0]).toEqual(home);
    expect(v.slice(1).map((x) => x.title)).toEqual(['톤캉스', '추석선물', '슈퍼 적립', 'NEW']);
    expect(eventCandidatesView([home], null)).toEqual([home]);
    expect(eventCandidatesView([home, oldStore], null)).toEqual([home]);
  });
});

describe('배선(소스 검사)', () => {
  it('가져오기는 판독 결과만 저장(v 2) · 상태·글자 원문 저장 0 · 서버 네트워크 0', () => {
    const s = src('sales-outreach-direct-jobs.ts');
    const i = s.indexOf('export async function grabOutreachStorePage(');
    const body = s.slice(i, s.indexOf('\nexport ', i + 10));
    expect(body).toContain('parseNaverStoreState(pickNaverStoreState(input.state)');
    expect(body).toContain('store_grab: { v: 2, store: store.value, material, at, by: operatorSuperAdminId || null }');
    expect(body).not.toMatch(/fetch\(|fetchHtmlGuarded|renderPageGuarded|input\.html/);
  });
  it('확인 화면과 확정이 같은 목록 함수를 부른다 · 확정은 화면이 본 store_grab 시각을 대조한다', () => {
    const jobs = src('sales-outreach-jobs.ts');
    expect(jobs).toContain('candidatesView: eventCandidatesView(');
    const core = jobs.slice(jobs.indexOf('async function confirmSelectionCore('), jobs.indexOf('async function confirmSelectionCore(') + 4000);
    expect(core).toContain('eventCandidatesView(');
    expect(core).toContain('storeGrabAt');
  });
});
