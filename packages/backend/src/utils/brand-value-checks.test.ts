/**
 * 브랜드메시지 조립기 값 검사 계약 (★2026-09-20 신설)
 *
 * 무엇을 고정하나
 *   1. 프리미엄 동영상의 `video_url`은 카카오TV 주소만 통과한다(0920 실측 = 유튜브 주소가 큐에 들어간 뒤 카카오 동영상 오류로 죽었다).
 *   2. 커머스 가격은 규격 범위 안이어야 한다(정상가·할인가 0~99,999,999 · 할인율 0~100 · 정액할인 0~999,999).
 *   3. **오늘 열린 자리**(와이드 리스트 아이템 · 캐러셀 인트로·카드·더보기)의 링크는 http(s)로 시작해야 한다.
 *   4. 말풍선 버튼 링크는 **여기서 막지 않는다** — 운영 중인 유형과 예약분이 같은 조립기를 지나므로,
 *      카카오가 실제로 거절하는지 실측한 뒤에 넓힌다. 이 테스트가 그 범위 결정을 못 박는다(넓힐 때 의도 변경).
 *   5. 거절 사유 변환기(`sanitizeImcMessageForUser`)는 라우트에서 공용 유틸로 옮겨도 출력이 같다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildBrandQueuePayload, buildAttachmentJson, buildCarouselJson, BrandMessageBuildError } from './brand-message';
import { sanitizeImcMessageForUser } from './alimtalk-api';
import { isHttpLinkOrVariable } from './normalize';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2027-08-18T00:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

const BASE = { typeDef: 'FREE' as const, senderKey: 'sk-test', targeting: 'I', isAd: true, sendAt: '2027-08-18 10:00:00', trialAllowed: true };
const IMG = 'https://mud-kage.kakao.com/dn/abc/btsXXXX/yyyyyyyy/img_l.jpg';
const URL_OK = 'https://shop.example.co.kr/p/1001';

describe('프리미엄 동영상 — 카카오TV 주소만', () => {
  const build = (videoUrl: string) => buildBrandQueuePayload({
    ...BASE, bubbleType: 'PREMIUM_VIDEO', message: '영상으로 만나 보세요',
    attachmentJson: buildAttachmentJson({ video: { video_url: videoUrl } }),
  });

  it('유튜브 주소는 조립 단계에서 거절한다', () => {
    expect(() => build('https://youtu.be/abcdefghijk?si=xyz')).toThrow(BrandMessageBuildError);
    expect(() => build('https://youtu.be/abcdefghijk?si=xyz')).toThrow(/카카오TV/);
    expect(() => build('https://www.youtube.com/watch?v=abcdefghijk')).toThrow(/카카오TV/);
  });

  it('호스트를 흉내 낸 주소·스킴 없는 주소도 거절한다', () => {
    expect(() => build('https://tv.kakao.com.evil.example/v/1')).toThrow(/카카오TV/);
    expect(() => build('tv.kakao.com/v/422641013')).toThrow(/카카오TV/);
  });

  it('카카오TV 주소 두 형태는 통과한다', () => {
    expect(() => build('https://tv.kakao.com/v/422641013')).not.toThrow();
    expect(() => build('https://tv.kakao.com/channel/1391/cliplink/455082924')).not.toThrow();
  });
});

describe('커머스 — 가격 범위', () => {
  const build = (commerce: Record<string, any>) => buildBrandQueuePayload({
    ...BASE, bubbleType: 'COMMERCE',
    attachmentJson: buildAttachmentJson({
      image: { img_url: IMG }, commerce: commerce as any,
      buttons: [{ name: '구매하기', type: 'WL', url_mobile: URL_OK }],
    }),
  });

  it('범위 안은 통과한다', () => {
    expect(() => build({ title: '코트', regular_price: 99_999_999 })).not.toThrow();
    expect(() => build({ title: '코트', regular_price: 189000, discount_price: 132300, discount_rate: 30 })).not.toThrow();
    expect(() => build({ title: '코트', regular_price: 189000, discount_price: 179000, discount_fixed: 10000 })).not.toThrow();
  });

  it('범위 밖·정수 아님은 항목 이름과 함께 거절한다', () => {
    expect(() => build({ title: '코트', regular_price: 100_000_000 })).toThrow(/정상가/);
    expect(() => build({ title: '코트', regular_price: 189000, discount_price: -1, discount_rate: 30 })).toThrow(/할인가/);
    expect(() => build({ title: '코트', regular_price: 189000, discount_price: 1000, discount_rate: 101 })).toThrow(/할인율/);
    expect(() => build({ title: '코트', regular_price: 189000, discount_price: 1000, discount_fixed: 1_000_000 })).toThrow(/할인금액/);
    expect(() => build({ title: '코트', regular_price: 1890.5 })).toThrow(/정상가/);
  });
});

describe('링크 형식 — 오늘 열린 자리', () => {
  const items = (url: string) => [
    { img_url: IMG, url_mobile: URL_OK },
    { title: '둘', img_url: IMG, url_mobile: url },
    { title: '셋', img_url: IMG, url_mobile: URL_OK },
  ];
  const wideList = (url: string) => buildBrandQueuePayload({
    ...BASE, bubbleType: 'WIDE_ITEM_LIST', header: '이번 주 추천',
    attachmentJson: buildAttachmentJson({ itemList: items(url) as any }),
  });
  const feed = (over: { imgLink?: string; btnUrl?: string; tail?: string }) => buildBrandQueuePayload({
    ...BASE, bubbleType: 'CAROUSEL_FEED', etcJsonMax: 8192,
    carouselJson: buildCarouselJson({
      cards: [1, 2].map((i) => ({
        header: `카드 ${i}`, message: '내용',
        image: { img_url: IMG, ...(i === 2 && over.imgLink ? { img_link: over.imgLink } : {}) },
        buttons: [{ name: '자세히', type: 'WL', url_mobile: i === 2 && over.btnUrl ? over.btnUrl : URL_OK }],
      })),
      ...(over.tail ? { tail: { url_mobile: over.tail } } : {}),
    }),
  });

  it('와이드 리스트 아이템 링크 — 스킴 없는 주소를 몇 번째인지와 함께 거절한다', () => {
    expect(() => wideList(URL_OK)).not.toThrow();
    expect(() => wideList('www.hanjul.ai')).toThrow(/2번째 아이템.*http/);
  });

  it('캐러셀 — 카드 이미지 링크 · 카드 버튼 링크 · 더보기 링크', () => {
    expect(() => feed({})).not.toThrow();
    expect(() => feed({ imgLink: 'www.hanjul.ai' })).toThrow(/2번째 카드 이미지.*http/);
    expect(() => feed({ btnUrl: 'www.hanjul.ai' })).toThrow(/2번째 카드 1번째 버튼.*http/);
    expect(() => feed({ tail: 'www.hanjul.ai' })).toThrow(/더보기.*http/);
  });

  it('변수로 시작하는 링크는 치환 뒤에 정해지므로 통과한다', () => {
    expect(() => wideList('#{상품링크}')).not.toThrow();
    expect(isHttpLinkOrVariable('#{상품링크}')).toBe(true);
    expect(isHttpLinkOrVariable('HTTPS://A.CO')).toBe(true);
    expect(isHttpLinkOrVariable('ftp://a.co')).toBe(false);
    expect(isHttpLinkOrVariable('')).toBe(false);
  });

  it('말풍선 버튼 링크는 조립기가 막지 않는다 — 운영 중 유형·예약분 보호(넓힐 때 이 테스트의 의도를 바꾼다)', () => {
    expect(() => buildBrandQueuePayload({
      ...BASE, bubbleType: 'TEXT', message: '본문',
      attachmentJson: buildAttachmentJson({ buttons: [{ name: '바로가기', type: 'WL', url_mobile: 'www.hanjul.ai' }] }),
    })).not.toThrow();
  });
});

describe('거절 사유 변환기 — 이동 전후 출력 고정', () => {
  it('영문 예외명과 파일명을 걷어 내고 사유만 남긴다', () => {
    expect(sanitizeImcMessageForUser('InvalidImageShapeException(가로:세로 비율은 2:1여야 합니다, ë틀ɑì틀´.jpg)', '4000'))
      .toBe('가로:세로 비율은 2:1여야 합니다');
  });
  it('중계사 명칭을 지운다', () => {
    expect(sanitizeImcMessageForUser('IMC 서버 오류', undefined)).toBe('서버 오류');
  });
  it('원문이 없으면 폴백 + 코드', () => {
    expect(sanitizeImcMessageForUser('', '4000', '이미지 규격을 확인해 주세요')).toBe('이미지 규격을 확인해 주세요 (코드 4000)');
    expect(sanitizeImcMessageForUser(undefined, undefined)).toBe('요청 처리에 실패했습니다');
  });
});
