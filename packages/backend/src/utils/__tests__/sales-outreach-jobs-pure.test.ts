/**
 * sales-outreach-jobs-pure.test.ts — 잡 CT의 순수 함수 행동 테스트 (2026-09-05 · 설계서 D-1)
 * DB·AI는 mock(순수 함수만 실행) · 네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import {
  materialText, stripMaterialForPrompt, buildCopyPrompt, computeSendLock, hasDisqualifyingMarker, isFutureDate,
  filterQuoteCandidates, normalizeHomepageKey, findEventPageLink, appendTestSend, detailOf,
} from '../sales-outreach-jobs';
import { getActiveStyleGuide } from '../sales-outreach-style';
import { BENEFIT_PLACEHOLDER } from '../copy-benefit-detector';

describe('materialText · stripMaterialForPrompt', () => {
  it('전량 우선 · 발췌 폴백 · 예산 절단', () => {
    expect(materialText('전량'.repeat(10), '발췌', 6)).toBe('전량전량전량');
    expect(materialText(null, '발췌본문', 100)).toBe('발췌본문');
    expect(materialText('', '', 100)).toBe('');
  });
  it('면허 밖 혜택 자리를 지운다(placeholder 잔존 0)', () => {
    const out = stripMaterialForPrompt('가을 신상 30% 할인. 편안한 코튼 소재.', '');
    expect(out).not.toContain(BENEFIT_PLACEHOLDER);
    expect(out).not.toContain('30%');
    expect(out).toContain('편안한 코튼 소재');
  });
  it('면허 인용의 수치는 남는다', () => {
    const out = stripMaterialForPrompt('가을 신상 30% 할인. 편안한 코튼 소재.', '가을 신상 30% 할인');
    expect(out).toContain('30%');
  });
});

describe('buildCopyPrompt', () => {
  it('재료 블록·추가 정보 블록이 실리고 면허 밖 수치는 프롬프트에 없다', () => {
    const guide = getActiveStyleGuide();
    const promptMaterial = stripMaterialForPrompt('겨울 시즌오프 최대 50% 할인. 울 코트 라인업.', '');
    const p = buildCopyPrompt(guide, { companyName: '브랜드', industry: 'fashion', selected: null, promptMaterial, extraNotes: '담당자 김과장' });
    expect(p.user).toContain('[홈페이지에서 읽은 내용]');
    expect(p.user).toContain('울 코트 라인업');
    expect(p.user).not.toContain('50%');
    expect(p.user).toContain('[담당자 추가 정보]');
    expect(p.system).toContain('{{DM_LINK}}');
    expect(p.system).not.toMatch(/sonnet|opus|haiku|claude|gpt-/i);
  });
});

describe('computeSendLock (불변 3 개정 · 5사유)', () => {
  const asset = { html: '<p>본문 수신거부 안내</p>', subject: '제목', placeholderCount: 0 };
  it('전부 통과', () => {
    expect(computeSendLock({ mailerReady: true, unsub: '수신거부 안내' }, asset)).toEqual({ locked: false, reasons: [] });
  });
  it('발신 계정·수신거부 문구 미설정', () => {
    const r = computeSendLock({ mailerReady: false, unsub: '' }, asset);
    expect(r.locked).toBe(true);
    expect(r.reasons).toEqual(['SENDER_NOT_CONFIGURED', 'UNSUB_NOTICE_MISSING']);
  });
  it('조립본 부재는 그 사유로 끝난다', () => {
    expect(computeSendLock({ mailerReady: true, unsub: 'x' }, null).reasons).toEqual(['NO_EMAIL']);
    expect(computeSendLock({ mailerReady: true, unsub: 'x' }, { html: '', subject: '' }).reasons).toEqual(['NO_EMAIL']);
  });
  it('placeholder 잔존(서버 숫자) · 문구 미반영', () => {
    expect(computeSendLock({ mailerReady: true, unsub: '없는 문구' }, { ...asset, placeholderCount: 2 }).reasons).toEqual(['PLACEHOLDER_REMAINS', 'UNSUB_NOT_APPLIED']);
  });
  it('구 asset(필드 없음)은 html+subject 문자열 스캔 폴백', () => {
    expect(computeSendLock({ mailerReady: true, unsub: '안내' }, { html: `<p>${BENEFIT_PLACEHOLDER} 안내</p>`, subject: '제목' }).reasons).toEqual(['PLACEHOLDER_REMAINS']);
    expect(computeSendLock({ mailerReady: true, unsub: '안내' }, { html: '<p>안내</p>', subject: `${BENEFIT_PLACEHOLDER}` }).reasons).toEqual(['PLACEHOLDER_REMAINS']);
  });
});

describe('인용 판정', () => {
  it('hasDisqualifyingMarker — 대소문자 무시', () => {
    expect(hasDisqualifyingMarker('가을 세일 SOLD OUT')).toBe(true);
    expect(hasDisqualifyingMarker('가을 세일 진행 중')).toBe(false);
  });
  it('isFutureDate — 형식·미래', () => {
    const now = new Date('2026-09-05T00:00:00+09:00');
    expect(isFutureDate('2026-09-30', now)).toBe(true);
    expect(isFutureDate('2026-09-04', now)).toBe(false);
    expect(isFutureDate('9월 30일', now)).toBe(false);
    expect(isFutureDate(null, now)).toBe(false);
  });
  it('filterQuoteCandidates — 원문별 재대조·출처 URL·짧음·불일치·종료 표현·계측', () => {
    const now = new Date('2026-09-05T00:00:00+09:00');
    const home = '가을 감사제 전 품목 할인 진행 중입니다. 자세한 내용은 행사 페이지에서.';
    const sub = '9월 30일까지 신규 회원 첫구매 쿠폰을 드립니다.';
    const parsed = [
      { quote: '가을 감사제 전 품목 할인 진행 중입니다.', start_date: null, end_date: '2026-09-30' },
      { quote: '신규 회원 첫구매 쿠폰을 드립니다.', end_date: null },
      { quote: '짧음', end_date: null },
      { quote: '원문에 없는 문장을 지어냈습니다.', end_date: null },
      { quote: '가을 감사제 종료 안내입니다 정말로', end_date: null },
    ];
    const r = filterQuoteCandidates(parsed, { home, sub }, { home: 'https://a.com/', sub: 'https://a.com/event' }, now);
    expect(r.meta).toEqual({ rawCandidates: 3, matched: 2, shortDropped: 1, mismatched: 0, markerDropped: 0 }); // 최대 3개만 본다
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]).toMatchObject({ sourceUrl: 'https://a.com/', benefitLicensed: true, origin: 'crawl' });
    expect(r.candidates[1]).toMatchObject({ sourceUrl: 'https://a.com/event', benefitLicensed: false });
    const r2 = filterQuoteCandidates([parsed[3]], { home, sub }, { home: 'https://a.com/', sub: 'https://a.com/event' }, now);
    expect(r2.meta.mismatched).toBe(1);
    expect(r2.candidates).toEqual([]);
    const r3 = filterQuoteCandidates([parsed[4]], { home: parsed[4].quote, sub: null }, { home: 'https://a.com/' }, now);
    expect(r3.meta.markerDropped).toBe(1);
    expect(filterQuoteCandidates('not-array', { home }, { home: 'x' }, now).candidates).toEqual([]);
  });
});

describe('normalizeHomepageKey · findEventPageLink · appendTestSend · detailOf', () => {
  it('호스트(www 제거) + 첫 경로 세그먼트', () => {
    expect(normalizeHomepageKey('https://www.Brand.co.kr/')).toBe('brand.co.kr');
    expect(normalizeHomepageKey('https://smartstore.naver.com/BrandShop/products/1')).toBe('smartstore.naver.com/brandshop');
    expect(normalizeHomepageKey('not a url')).toBe('not a url');
  });
  it('행사 상세 링크 1개(같은 호스트 · 홈 제외 · 로그인 제외)', () => {
    const html = `<a href="/member/login">이벤트 로그인</a><a href="https://other.com/event">타사 이벤트</a><a href="/">홈</a><a href="/event/autumn?x=1&amp;y=2">가을 기획전</a><a href="/event/2">두번째</a>`;
    expect(findEventPageLink(html, 'https://www.brand.co.kr/')).toBe('https://www.brand.co.kr/event/autumn?x=1&y=2');
    expect(findEventPageLink('<a href="/about">회사소개</a>', 'https://www.brand.co.kr/')).toBeNull();
  });
  it('검수 발송 이력은 최대 20건 · 최신이 뒤', () => {
    const list = Array.from({ length: 20 }, (_, i) => ({ to: `u${i}@x.com`, outcome: 'sent', at: 'a', by: null }));
    const out = appendTestSend(list, { to: 'new@x.com', outcome: 'sent', at: 'b', by: 'ceo' });
    expect(out).toHaveLength(20);
    expect(out[19].to).toBe('new@x.com');
    expect(appendTestSend('garbage', { to: 'a@x.com', outcome: 'sent', at: 'b', by: null })).toHaveLength(1);
  });
  it('detailOf — 공백 정규화 · 300자', () => {
    expect(detailOf(new Error('a  b\n c'))).toBe('a b c');
    expect(detailOf({ message: 'x'.repeat(400) })).toHaveLength(300);
    expect(detailOf(null)).toBe('');
  });
});
