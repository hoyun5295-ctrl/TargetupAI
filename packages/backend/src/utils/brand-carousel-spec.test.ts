/**
 * 캐러셀 규격 계약 — attachment_method.pdf §5.3
 *
 * ★2026-08-28 신설. 자유형 5종 개통 축에서 캐러셀 검사를 신설하면서 함께 만들었다.
 *
 * 왜 `assertCarouselSpec`을 직접 부르는가 —
 *   캐러셀 유형은 아직 `BUBBLE_TYPE_OPENED`(발송 개방 원장)에 없다. 실측 1건을 통과해야 들어간다.
 *   그래서 `buildBrandQueuePayload` 경로로는 앞단 게이트에 먼저 막혀 **검사기까지 도달하지 못한다.**
 *   검사 로직이 맞는지는 지금 고정해 두고, 경로 통합은 유형이 열리는 날 추가한다.
 *
 * ⛔ 이 파일의 숫자를 손으로 고치지 마라 — 값의 출처는 `BUBBLE_TYPES[*].carousel`(CT)이다.
 *    기대값을 CT에서 읽어 쓰는 이유가 그것이다(문서와 코드가 갈리면 테스트가 먼저 깨져야 한다).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  assertCarouselSpec,
  buildCarouselJson,
  buildAttachmentJson,
  buildBrandQueuePayload,
  BUBBLE_TYPES,
  BUBBLE_TYPE_OPENED,
  SUPPORTED_BUBBLE_TYPES,
  BrandMessageBuildError,
} from './brand-message';

const FEED = BUBBLE_TYPES.CAROUSEL_FEED;
const COMM = BUBBLE_TYPES.CAROUSEL_COMMERCE;

/** 규격을 지키는 최소 카드 (피드) */
const feedCard = (over: Record<string, any> = {}) => ({
  header: '신상 20% 할인',
  message: '가을에 딱 맞는 부클 니트',
  attachment: { image: { img_url: 'https://img/1.jpg' } },
  ...over,
});

/** 규격을 지키는 최소 카드 (커머스) */
const commCard = (over: Record<string, any> = {}) => ({
  attachment: {
    image: { img_url: 'https://img/1.jpg' },
    commerce: { title: '부클 니트', regular_price: 89000 },
  },
  ...over,
});

const intro = (over: Record<string, any> = {}) => ({
  header: '가을 기획전',
  content: '선착순 한정 특가',
  image_url: 'https://img/intro.jpg',
  ...over,
});

const run = (spec: typeof FEED, carousel: any) =>
  () => assertCarouselSpec(spec, carousel, spec.label);

describe('캐러셀 규격 (§5.3)', () => {
  // ── 인트로(head) ────────────────────────────────────────────────
  it('피드는 인트로를 쓸 수 없다', () => {
    expect(run(FEED, { head: intro(), list: [feedCard(), feedCard()] }))
      .toThrow(BrandMessageBuildError);
  });

  it('커머스는 인트로를 쓸 수 있다', () => {
    expect(run(COMM, { head: intro(), list: [commCard()] })).not.toThrow();
  });

  it('인트로 제목이 상한을 넘으면 막는다', () => {
    const over = 'ㄱ'.repeat(COMM.carousel!.introHeaderMax + 1);
    expect(run(COMM, { head: intro({ header: over }), list: [commCard()] }))
      .toThrow(/제목은 최대/);
  });

  it('인트로 제목에는 줄바꿈을 넣을 수 없다', () => {
    expect(run(COMM, { head: intro({ header: '가을\n기획전' }), list: [commCard()] }))
      .toThrow(/줄바꿈/);
  });

  it('인트로 내용 줄바꿈은 상한까지만 허용한다', () => {
    const nl = COMM.carousel!.introContentNewline;
    // ⛔ 줄바꿈을 문자열 **끝**에 붙이면 안 된다 — `strFieldOrThrow`가 trim하므로 검사에 닿지 않는다.
    //    사용자가 끝에 엔터를 치는 경우는 그렇게 걷히는 것이 맞고, 세는 대상은 문장 사이의 줄바꿈이다.
    const lines = (n: number) => Array(n + 1).fill('a').join('\n');
    expect(run(COMM, { head: intro({ content: lines(nl) }), list: [commCard()] })).not.toThrow();
    expect(run(COMM, { head: intro({ content: lines(nl + 1) }), list: [commCard()] })).toThrow(/줄바꿈/);
  });

  it('인트로 이미지가 없으면 막는다', () => {
    expect(run(COMM, { head: intro({ image_url: '' }), list: [commCard()] }))
      .toThrow(/이미지가 필요/);
  });

  it('다른 링크를 넣었으면 모바일 링크가 필요하다', () => {
    expect(run(COMM, { head: intro({ url_pc: 'https://pc' }), list: [commCard()] }))
      .toThrow(/모바일 링크가 필요/);
    expect(run(COMM, { head: intro({ url_pc: 'https://pc', url_mobile: 'https://m' }), list: [commCard()] }))
      .not.toThrow();
  });

  // ── 카드 수(list) ───────────────────────────────────────────────
  it('인트로가 없으면 카드는 2~6장이다', () => {
    const { listMin, listMax } = FEED.carousel!;
    expect(run(FEED, { list: Array(listMin - 1).fill(0).map(() => feedCard()) })).toThrow(/카드는/);
    expect(run(FEED, { list: Array(listMin).fill(0).map(() => feedCard()) })).not.toThrow();
    expect(run(FEED, { list: Array(listMax).fill(0).map(() => feedCard()) })).not.toThrow();
    expect(run(FEED, { list: Array(listMax + 1).fill(0).map(() => feedCard()) })).toThrow(/카드는/);
  });

  it('인트로를 쓰면 카드 상한이 줄어든다', () => {
    const { listMaxWithIntro } = COMM.carousel!;
    const cards = (n: number) => Array(n).fill(0).map(() => commCard());
    expect(run(COMM, { head: intro(), list: cards(listMaxWithIntro) })).not.toThrow();
    expect(run(COMM, { head: intro(), list: cards(listMaxWithIntro + 1) })).toThrow(/인트로를 쓰면/);
  });

  // ── 카드 필드 사용 가부 ─────────────────────────────────────────
  it('피드는 제목과 내용이 필수다', () => {
    expect(run(FEED, { list: [feedCard({ header: '' }), feedCard()] })).toThrow(/제목이 필요/);
    expect(run(FEED, { list: [feedCard({ message: '' }), feedCard()] })).toThrow(/내용이 필요/);
  });

  it('피드는 부가 정보를 쓸 수 없다', () => {
    expect(run(FEED, { list: [feedCard({ additional_content: '무료배송' }), feedCard()] }))
      .toThrow(/부가 정보를 사용하지 않습니다/);
  });

  it('커머스는 제목과 내용을 쓸 수 없다', () => {
    expect(run(COMM, { list: [commCard({ header: '제목' }), commCard()] }))
      .toThrow(/제목을 사용하지 않습니다/);
    expect(run(COMM, { list: [commCard({ message: '내용' }), commCard()] }))
      .toThrow(/내용을 사용하지 않습니다/);
  });

  it('커머스는 부가 정보를 쓸 수 있고 상한이 걸린다', () => {
    const max = COMM.carousel!.itemAdditionalMax;
    expect(run(COMM, { list: [commCard({ additional_content: 'ㄱ'.repeat(max) }), commCard()] })).not.toThrow();
    expect(run(COMM, { list: [commCard({ additional_content: 'ㄱ'.repeat(max + 1) }), commCard()] }))
      .toThrow(/부가 정보는 최대/);
  });

  it('카드 내용 길이와 줄바꿈에 상한이 있다', () => {
    const { itemMessageMax, itemMessageNewline } = FEED.carousel!;
    expect(run(FEED, { list: [feedCard({ message: 'ㄱ'.repeat(itemMessageMax + 1) }), feedCard()] }))
      .toThrow(/내용은 최대/);
    const lines = (n: number) => Array(n + 1).fill('a').join('\n');
    expect(run(FEED, { list: [feedCard({ message: lines(itemMessageNewline) }), feedCard()] })).not.toThrow();
    expect(run(FEED, { list: [feedCard({ message: lines(itemMessageNewline + 1) }), feedCard()] }))
      .toThrow(/줄바꿈/);
  });

  // ── 카드 버튼 ───────────────────────────────────────────────────
  it('카드 버튼은 상한을 넘을 수 없다', () => {
    const max = FEED.carousel!.itemButtonMax;
    const btn = { name: '구매', type: 'WL', url_mobile: 'https://m' };
    const withBtns = (n: number) => feedCard({
      attachment: { image: { img_url: 'https://img/1.jpg' }, button: Array(n).fill(btn) },
    });
    expect(run(FEED, { list: [withBtns(max), feedCard()] })).not.toThrow();
    expect(run(FEED, { list: [withBtns(max + 1), feedCard()] })).toThrow(/버튼은 최대/);
  });

  it('카드 버튼명은 유형별 상한을 따른다 (캐러셀 = 8자)', () => {
    const max = FEED.maxButtonName;
    const card = (name: string) => feedCard({
      attachment: { image: { img_url: 'https://img/1.jpg' }, button: [{ name, type: 'WL', url_mobile: 'https://m' }] },
    });
    expect(run(FEED, { list: [card('ㄱ'.repeat(max)), feedCard()] })).not.toThrow();
    expect(run(FEED, { list: [card('ㄱ'.repeat(max + 1)), feedCard()] })).toThrow(/버튼명은 최대/);
  });

  it('모르는 버튼 종류는 막는다', () => {
    const card = feedCard({
      attachment: { image: { img_url: 'https://img/1.jpg' }, button: [{ name: '구매', type: 'ZZ' }] },
    });
    expect(run(FEED, { list: [card, feedCard()] })).toThrow(/지원하지 않는 버튼 종류/);
  });

  // ── 더보기(tail) ────────────────────────────────────────────────
  it('더보기를 쓰면 모바일 링크가 필요하다', () => {
    expect(run(FEED, { list: [feedCard(), feedCard()], tail: { url_pc: 'https://pc' } }))
      .toThrow(/모바일 링크가 필요/);
  });

  it('더보기 링크에는 변수를 쓸 수 없다', () => {
    expect(run(FEED, { list: [feedCard(), feedCard()], tail: { url_mobile: 'https://m/#{이름}' } }))
      .toThrow(/변수를 사용할 수 없습니다/);
  });

  it('더보기를 쓰지 않으면 검사하지 않는다', () => {
    expect(run(FEED, { list: [feedCard(), feedCard()] })).not.toThrow();
  });
});

describe('캐러셀 조립 (buildCarouselJson)', () => {
  it('카드가 없으면 아무것도 만들지 않는다', () => {
    expect(buildCarouselJson({ cards: [] })).toBeNull();
  });

  it('인트로를 안 쓰면 head 키 자체가 없다', () => {
    const out = JSON.parse(buildCarouselJson({
      cards: [{ header: '제목', message: '내용' }, { header: '제목2', message: '내용2' }],
    })!);
    expect(out).not.toHaveProperty('head');
    expect(out.list).toHaveLength(2);
  });

  it('빈 필드는 키를 만들지 않는다 (커머스 카드에 header가 남지 않는다)', () => {
    const out = JSON.parse(buildCarouselJson({
      cards: [{ commerce: { title: '니트', regular_price: 89000 } }],
    })!);
    expect(out.list[0]).not.toHaveProperty('header');
    expect(out.list[0]).not.toHaveProperty('message');
    expect(out.list[0].attachment.commerce.title).toBe('니트');
  });

  it('카드 첨부는 ATTACHMENT와 같은 조립기를 쓴다', () => {
    const image = { img_url: 'https://img/1.jpg' };
    const buttons = [{ name: '구매', type: 'WL' as const, url_mobile: 'https://m' }];
    const card = JSON.parse(buildCarouselJson({ cards: [{ image, buttons }] })!).list[0].attachment;
    const flat = JSON.parse(buildAttachmentJson({ image, buttons })!);
    expect(card).toEqual(flat);
  });

  it('더보기는 지정했을 때만 실린다', () => {
    const base = { cards: [{ header: 'a', message: 'b' }, { header: 'c', message: 'd' }] };
    expect(JSON.parse(buildCarouselJson(base)!)).not.toHaveProperty('tail');
    const withTail = JSON.parse(buildCarouselJson({ ...base, tail: { url_mobile: 'https://m' } })!);
    expect(withTail.tail.url_mobile).toBe('https://m');
  });

  // ── 왕복: 조립기가 만든 것은 검사기를 지나야 한다 ──
  //   이 둘이 갈리면 "화면에서는 됐는데 발송이 안 되는" 상태가 된다.
  it('조립한 피드 캐러셀이 검사기를 통과한다', () => {
    const json = buildCarouselJson({
      cards: [
        { header: '신상 20%', message: '가을 신상', image: { img_url: 'https://img/1.jpg' },
          buttons: [{ name: '구매', type: 'WL', url_mobile: 'https://m' }] },
        { header: '한정 수량', message: '데일리 코트', image: { img_url: 'https://img/2.jpg' } },
      ],
      tail: { url_mobile: 'https://maisonblanc.kr/autumn' },
    })!;
    expect(() => assertCarouselSpec(FEED, JSON.parse(json), FEED.label)).not.toThrow();
  });

  it('조립한 커머스 캐러셀이 인트로와 함께 검사기를 통과한다', () => {
    const json = buildCarouselJson({
      intro: { header: '가을 기획전', content: '선착순 한정', image_url: 'https://img/intro.jpg' },
      cards: [
        { commerce: { title: '니트', regular_price: 89000, discount_price: 62300, discount_rate: 30 },
          image: { img_url: 'https://img/1.jpg' }, additional_content: '무료배송' },
      ],
      tail: { url_mobile: 'https://maisonblanc.kr/autumn' },
    })!;
    expect(() => assertCarouselSpec(COMM, JSON.parse(json), COMM.label)).not.toThrow();
  });
});

describe('발송 개방 원장 (BUBBLE_TYPE_OPENED)', () => {
  it('열린 유형과 원장 키가 같다', () => {
    expect([...SUPPORTED_BUBBLE_TYPES]).toEqual(Object.keys(BUBBLE_TYPE_OPENED));
  });

  it('실측을 지나지 않은 5종은 아직 닫혀 있다', () => {
    for (const t of ['WIDE_ITEM_LIST', 'PREMIUM_VIDEO', 'COMMERCE', 'CAROUSEL_FEED', 'CAROUSEL_COMMERCE']) {
      expect(BUBBLE_TYPE_OPENED[t], `${t}는 실측 1건 전에는 열 수 없다`).toBeUndefined();
    }
  });

  it('열린 유형은 실측 근거를 함께 갖는다', () => {
    for (const [code, rec] of Object.entries(BUBBLE_TYPE_OPENED)) {
      expect(rec.since, `${code}: 개방일이 필요하다`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rec.note.length, `${code}: 개방 근거가 필요하다`).toBeGreaterThan(0);
    }
  });
});

/**
 * 조립기 경로 왕복 (★2026-09-22 신설 · 0922 접수 "필수값을 다 넣었는데 [상품 정보가 필요 합니다]")
 *
 * 위 검사들은 `assertCarouselSpec`을 **직접** 부른다. 그런데 접수의 거절은 검사기가 아니라 그 앞
 * 말풍선 검사(`assertBrandContentSpec`)에서 났다 — 유형을 가리지 않고 최상위 `attachment.commerce`를
 * 요구해 캐러셀 커머스가 100% 막혔다. 상품 정보는 규격상 **카드가 소유한다**(§5.3).
 * 부품별 테스트가 전부 초록인데 경로가 죽어 있던 0920과 같은 부류라, 화면이 보내는 형태 그대로
 * 조립기를 지나는 길을 여기서 고정한다(시험 개방 `BUBBLE_TYPE_TRIAL`로 그 길이 열려 있다).
 */
describe('캐러셀 커머스 — 조립기 경로(buildBrandQueuePayload)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2027-08-18T00:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  const BASE = {
    typeDef: 'FREE' as const, senderKey: 'sk-test', targeting: 'I', isAd: true,
    sendAt: '2027-08-18 10:00:00', trialAllowed: true, etcJsonMax: 8192,
  };
  const KAKAO_IMG = 'https://mud-kage.kakao.com/dn/abc/btsXXXX/yyyyyyyy/img_l.jpg';
  const SHOP = 'https://shop.example.co.kr/p/1001';

  /** 화면(brandRich.richPayload)이 카드 하나로 보내는 형태 */
  const card = (commerce?: Record<string, any>) => ({
    image: { img_url: KAKAO_IMG },
    buttons: [{ name: '구매', type: 'WL' as const, url_mobile: SHOP }],
    ...(commerce ? { commerce } : {}),
  });
  /** ⛔ attachmentJson은 비운다 — 캐러셀은 말풍선 첨부를 싣지 않는다(화면과 같은 형태) */
  const build = (cards: any[]) => () => buildBrandQueuePayload({
    ...BASE, bubbleType: 'CAROUSEL_COMMERCE',
    attachmentJson: buildAttachmentJson({}),
    carouselJson: buildCarouselJson({ cards }),
  });
  const GOODS = { title: '부클 니트', regular_price: 89000 };

  it('카드가 상품 정보를 갖추면 최상위 commerce 없이 통과한다', () => {
    expect(build([card(GOODS), card(GOODS)])).not.toThrow();
  });

  it('인트로를 함께 써도 통과한다', () => {
    expect(() => buildBrandQueuePayload({
      ...BASE, bubbleType: 'CAROUSEL_COMMERCE',
      attachmentJson: buildAttachmentJson({}),
      carouselJson: buildCarouselJson({
        intro: { header: '가을 기획전', content: '선착순 한정', image_url: KAKAO_IMG },
        cards: [card(GOODS), card(GOODS)],
      }),
    })).not.toThrow();
  });

  it('상품 정보가 없는 카드는 그 카드 번호와 함께 거절한다', () => {
    expect(build([card(GOODS), card()])).toThrow(/2번째 카드.*상품 정보가 필요/);
  });

  it('정상가가 없는 카드도 거절한다', () => {
    expect(build([card({ title: '부클 니트' }), card(GOODS)])).toThrow(/1번째 카드.*상품 정상가가 필요/);
  });

  it('단일 커머스는 최상위 상품 정보를 그대로 요구한다 (캐러셀 예외가 번지지 않는다)', () => {
    const single = (commerce?: Record<string, any>) => () => buildBrandQueuePayload({
      ...BASE, bubbleType: 'COMMERCE',
      attachmentJson: buildAttachmentJson({
        image: { img_url: KAKAO_IMG },
        buttons: [{ name: '구매', type: 'WL', url_mobile: SHOP }],
        ...(commerce ? { commerce: commerce as any } : {}),
      }),
    });
    expect(single()).toThrow(/상품 정보가 필요/);
    expect(single({ title: '부클 니트' })).toThrow(/상품 정상가가 필요/);
    expect(single(GOODS)).not.toThrow();
  });
});
