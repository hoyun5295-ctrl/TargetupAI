/**
 * 브랜드 발송 창 캐러셀 상태 (frontend/src/components/brand-send/brandRich.ts) — 2026-09-23
 *
 * 못 박는 것 (0923 박성용 접수 「캐러셀커머스 카드 갯수 표기 오류」):
 *   유형을 고르면 카드가 「인트로 미사용 최소」 2장으로 깔리고, 인트로를 켜도 그대로 남아
 *   비어 있는 카드 2가 「카드 2: 이미지를 넣어 주세요」로 발송을 막았다(인트로를 쓰면 1장부터가 규격).
 *   → 인트로를 켜고 끌 때 끝쪽의 손대지 않은 빈 카드만 그 상태의 최소 장수에 맞춘다. 입력한 카드는 건드리지 않는다.
 */
import { describe, it, expect } from 'vitest';
import {
  emptyCard,
  fitCarouselCards,
  initialRich,
  isEmptyRichCard,
  richBlockReason,
  toggleCarouselIntro,
} from '../../../../frontend/src/components/brand-send/brandRich';

const CODE = 'CAROUSEL_COMMERCE';
const filled = () => ({ ...emptyCard(), commerce: { title: '상품', regular: '1000', discount: '', rate: '' } });

describe('isEmptyRichCard — 손대지 않은 카드인가', () => {
  it('새 카드는 비어 있다', () => {
    expect(isEmptyRichCard(emptyCard())).toBe(true);
  });
  it('어느 칸이든 입력이 있으면 비어 있지 않다', () => {
    expect(isEmptyRichCard({ ...emptyCard(), imgLink: 'https://a.example' })).toBe(false);
    expect(isEmptyRichCard({ ...emptyCard(), additional: '특가' })).toBe(false);
    expect(isEmptyRichCard(filled())).toBe(false);
    expect(isEmptyRichCard({ ...emptyCard(), buttons: [{ name: '', type: 'WL' }] })).toBe(false);
    expect(isEmptyRichCard({ ...emptyCard(), image: { url: 'u', assetId: 'a', kind: 'carousel', name: 'n' } })).toBe(false);
  });
});

describe('fitCarouselCards — 최소 장수에 맞춘다(끝쪽 빈 카드만)', () => {
  const isEmpty = (c: string) => c === '';
  const make = () => '';
  it('끝쪽 빈 카드를 최소까지 뺀다', () => {
    expect(fitCarouselCards(['a', ''], 1, isEmpty, make)).toEqual(['a']);
  });
  it('입력한 카드는 빼지 않는다', () => {
    expect(fitCarouselCards(['a', 'b'], 1, isEmpty, make)).toEqual(['a', 'b']);
    expect(fitCarouselCards(['', 'b'], 1, isEmpty, make)).toEqual(['', 'b']);
  });
  it('최소보다 적으면 빈 카드를 채운다', () => {
    expect(fitCarouselCards(['a'], 2, isEmpty, make)).toEqual(['a', '']);
  });
  it('최소 아래로는 빼지 않는다', () => {
    expect(fitCarouselCards(['', ''], 1, isEmpty, make)).toEqual(['']);
  });
});

describe('richBlockReason — 캐러셀 커머스 카드 버튼 최소 1개 (★0923 재오픈 · 카카오 1030)', () => {
  const img = { url: 'https://hanjul.ai/a.jpg', assetId: 'a1', kind: 'carousel', name: 'a.jpg', w: 800, h: 600 };
  const btn = { name: '구매', type: 'WL', url_mobile: 'https://shop.example.co.kr/p/1' };
  const ready = (buttons: any[]) => ({
    ...emptyCard(), image: img, commerce: { title: '상품', regular: '1000', discount: '', rate: '' }, buttons,
  });
  const state = (buttons: any[]) => ({ ...initialRich(CODE), cards: [ready(buttons), ready(buttons)] });

  it('버튼이 없는 카드는 발송 전에 막는다', () => {
    expect(richBlockReason(CODE, state([]), ['WL'])).toMatch(/카드 1: 버튼을 1개 이상/);
  });
  it('카드마다 웹링크 버튼이 있으면 통과한다', () => {
    expect(richBlockReason(CODE, state([btn]), ['WL'])).toBe('');
  });
  it('피드는 카드 버튼 없이도 이 이유로 막지 않는다 (최소 0)', () => {
    const feed = { ...initialRich('CAROUSEL_FEED') };
    feed.cards = feed.cards.map(() => ({ ...emptyCard(), image: img, header: '제목', message: '내용' }));
    expect(richBlockReason('CAROUSEL_FEED', feed, ['WL'])).not.toMatch(/버튼을 1개 이상/);
  });
});

describe('toggleCarouselIntro — 캐러셀 커머스', () => {
  it('처음 상태(카드 2장)에서 인트로를 켜면 빈 카드 2가 빠진다', () => {
    const st = initialRich(CODE);
    expect(st.cards).toHaveLength(2);
    const on = toggleCarouselIntro(CODE, st, true);
    expect(on.introOn).toBe(true);
    expect(on.cards).toHaveLength(1);
  });
  it('인트로를 켠 뒤에는 카드 1장만으로 「카드 2」 거절이 나오지 않는다', () => {
    const on = toggleCarouselIntro(CODE, initialRich(CODE), true);
    expect(richBlockReason(CODE, on, ['WL'])).not.toMatch(/카드 2/);
  });
  it('카드 2에 입력이 있으면 인트로를 켜도 남긴다', () => {
    const st = { ...initialRich(CODE), cards: [emptyCard(), filled()] };
    expect(toggleCarouselIntro(CODE, st, true).cards).toHaveLength(2);
  });
  it('인트로를 끄면 최소 2장으로 다시 채운다', () => {
    const on = toggleCarouselIntro(CODE, initialRich(CODE), true);
    const off = toggleCarouselIntro(CODE, on, false);
    expect(off.introOn).toBe(false);
    expect(off.cards).toHaveLength(2);
  });
});
