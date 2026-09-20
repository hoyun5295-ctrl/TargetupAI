/**
 * 브랜드메시지 시험 개방 계약 (★2026-09-20 신설)
 *
 * 무엇을 고정하나
 *   1. 시험 원장(`BUBBLE_TYPE_TRIAL`)의 유형은 **시험 계정의 발송에서만** 조립기를 통과한다.
 *      `BUBBLE_TYPE_OPENED`(실측 0000을 본 유형만)의 계약은 그대로다 — 그쪽은 brand-message.test.ts·
 *      brand-carousel-spec.test.ts가 이미 못 박고 있다.
 *   2. 시험 계정 명단(ENV)이 비면 **아무도 시험 계정이 아니다**(rollout-gate의 「빈 명단 = 전면」과 반대).
 *   3. 본문 없는 유형은 `msg_contents`를 비운 채로 조립된다(0828 게이트웨이 MESSAGE 계약).
 *   4. `k_etc_json` 한도는 호출부가 넘긴 적재 테이블 폭을 따른다. 미지정 = 1024.
 *
 * 0828에 「경로 통합은 유형이 열리는 날 추가한다」고 미뤄 둔 조립기 경로 테스트가 이것이다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildBrandQueuePayload,
  buildAttachmentJson,
  buildCarouselJson,
  isBrandTrialLogin,
  isTrialBubbleType,
  BUBBLE_TYPE_TRIAL,
  BUBBLE_TYPE_OPENED,
  BUBBLE_TYPES,
  BrandMessageBuildError,
} from './brand-message';

const IN_WINDOW = '2027-08-18 10:00:00';
const ENV_KEY = 'BRAND_TRIAL_LOGIN_IDS';
let savedEnv: string | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2027-08-18T00:00:00Z'));
  savedEnv = process.env[ENV_KEY];
});
afterEach(() => {
  vi.useRealTimers();
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

const BASE = { typeDef: 'FREE' as const, senderKey: 'sk-test', targeting: 'I', isAd: true, sendAt: IN_WINDOW };
const IMG = 'https://mud-kage.kakao.com/dn/abc/btsXXXX/yyyyyyyy/img_l.jpg';
const URL = 'https://shop.example.co.kr/p/1001';

const commerceAttachment = () => buildAttachmentJson({
  image: { img_url: IMG },
  commerce: { title: '클래식 트렌치 코트', regular_price: 189000, discount_price: 132300, discount_rate: 30 },
  buttons: [{ name: '구매하기', type: 'WL', url_mobile: URL }],
});

const feedCarousel = (n: number) => buildCarouselJson({
  cards: Array.from({ length: n }, (_, i) => ({
    header: `카드 ${i + 1}`,
    message: '가'.repeat(90),
    image: { img_url: IMG, img_link: URL },
    buttons: [{ name: '자세히', type: 'WL', url_mobile: URL }],
  })),
  tail: { url_mobile: URL },
});

describe('시험 원장', () => {
  it('열린 원장과 겹치지 않는다 — 한 유형이 두 원장에 동시에 있으면 시험 표식이 의미를 잃는다', () => {
    for (const code of Object.keys(BUBBLE_TYPE_TRIAL)) {
      expect(BUBBLE_TYPE_OPENED[code], code).toBeUndefined();
      expect(BUBBLE_TYPES[code], `${code} 규격 누락`).toBeDefined();
      expect(isTrialBubbleType(code)).toBe(true);
    }
    expect(isTrialBubbleType('TEXT')).toBe(false);
    expect(isTrialBubbleType('NOPE')).toBe(false);
  });

  it('두 원장을 합치면 규격에 있는 8종 전부다 — 어느 쪽에도 없는 유형은 보낼 길이 없다', () => {
    const all = [...Object.keys(BUBBLE_TYPE_OPENED), ...Object.keys(BUBBLE_TYPE_TRIAL)].sort();
    expect(all).toEqual(Object.keys(BUBBLE_TYPES).sort());
  });
});

describe('시험 계정 명단 (ENV)', () => {
  it('명단이 비면 아무도 시험 계정이 아니다', () => {
    delete process.env[ENV_KEY];
    expect(isBrandTrialLogin('psy5868')).toBe(false);
    process.env[ENV_KEY] = '   ';
    expect(isBrandTrialLogin('psy5868')).toBe(false);
  });

  it('명단에 있는 계정만 — 대소문자·공백은 무시한다', () => {
    process.env[ENV_KEY] = ' psy5868 , Other01 ';
    expect(isBrandTrialLogin('psy5868')).toBe(true);
    expect(isBrandTrialLogin('PSY5868')).toBe(true);
    expect(isBrandTrialLogin('other01')).toBe(true);
    expect(isBrandTrialLogin('someone')).toBe(false);
    expect(isBrandTrialLogin('')).toBe(false);
    expect(isBrandTrialLogin(null)).toBe(false);
  });
});

describe('조립기 입구 — 시험 유형은 시험 계정의 발송에서만 통과한다', () => {
  it('일반 발송(trialAllowed 없음·false)은 종전대로 막힌다', () => {
    for (const trialAllowed of [undefined, false]) {
      expect(() => buildBrandQueuePayload({
        ...BASE, bubbleType: 'COMMERCE', trialAllowed, attachmentJson: commerceAttachment(),
      })).toThrow(/아직 지원하지 않습니다/);
    }
  });

  it('시험 발송이어도 원장에 없는 유형은 막힌다', () => {
    expect(() => buildBrandQueuePayload({ ...BASE, bubbleType: 'NOPE', trialAllowed: true, message: '본문' }))
      .toThrow(/아직 지원하지 않습니다/);
  });

  it('시험 발송의 커머스 — 통과하고, 본문 없는 유형이라 msg_contents가 빈 채로 조립된다', () => {
    const out = buildBrandQueuePayload({
      ...BASE, bubbleType: 'COMMERCE', trialAllowed: true,
      additionalContent: '무료 배송', attachmentJson: commerceAttachment(),
    });
    expect(out.msgContents).toBe('');
    const etc = JSON.parse(out.etcJson);
    expect(etc.CHAT_BUBBLE_TYPE).toBe('COMMERCE');
    expect(etc.ADDITIONAL_CONTENT).toBe('무료 배송');
    expect(etc.ATTACHMENT.commerce.discount_rate).toBe(30);
    expect(etc.MESSAGE).toBeUndefined();
  });

  it('시험 발송이어도 규격 검사는 그대로 받는다 — 커머스에 버튼이 없으면 막힌다', () => {
    const noButton = buildAttachmentJson({
      image: { img_url: IMG }, commerce: { title: '상품', regular_price: 1000 },
    });
    expect(() => buildBrandQueuePayload({ ...BASE, bubbleType: 'COMMERCE', trialAllowed: true, attachmentJson: noButton }))
      .toThrow(BrandMessageBuildError);
  });
});

describe('k_etc_json 한도 — 적재 테이블 폭을 따른다', () => {
  it('캐러셀 피드 카드 4장은 1024를 넘는다 — 폭을 안 넘기면 막히고, 8192를 넘기면 통과한다', () => {
    const carouselJson = feedCarousel(4);
    const args = { ...BASE, bubbleType: 'CAROUSEL_FEED', trialAllowed: true, carouselJson };
    expect(() => buildBrandQueuePayload(args)).toThrow(/너무 깁니다.*최대 1024자/);
    const out = buildBrandQueuePayload({ ...args, etcJsonMax: 8192 });
    expect(out.etcJson.length).toBeGreaterThan(1024);
    expect(out.msgContents).toBe('');
    expect(JSON.parse(out.etcJson).CAROUSEL.list).toHaveLength(4);
  });

  it('넘겨받은 폭도 넘으면 그 폭을 사유에 적어 막는다', () => {
    const args = { ...BASE, bubbleType: 'CAROUSEL_FEED', trialAllowed: true, carouselJson: feedCarousel(6) };
    expect(() => buildBrandQueuePayload({ ...args, etcJsonMax: 1500 })).toThrow(/최대 1500자/);
  });

  it('1024보다 작은 값·이상한 값은 1024로 본다 — 한도를 실수로 좁히거나 없애지 못한다', () => {
    const args = { ...BASE, bubbleType: 'CAROUSEL_FEED', trialAllowed: true, carouselJson: feedCarousel(4) };
    for (const bad of [0, 100, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildBrandQueuePayload({ ...args, etcJsonMax: bad as number }), String(bad)).toThrow(/최대 1024자/);
    }
  });
});
