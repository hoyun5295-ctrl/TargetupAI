/**
 * line-template-outreach-bank.ts — AI 영업 템플릿 문구 묶음(검증된 문구 · 업종 결 · 재료 채움 · ★ 2026-10-18 · 설계서 docs/2026-10-18-outreach-line-template-design.md)
 *
 * AI 는 문구를 쓰지 않고 이 묶음에서 고른다(Codex R1~R3: 사람이 고르지 않는 경로에서 AI 자유 문장의 값 · 혜택 결합은 사후 검사로 닫히지 않는다).
 * 품질은 묶음의 폭(템플릿 × 칸 × 업종 결)과 재료 채움(브랜드 이름 · 대표 상품 이름)으로 올린다(Harold 1018 「퀄리티는 늘 베스트」).
 * 값이 필요한 자리(혜택 원문 · 조건 · 기간 · 가격 · 행사 제목 · 표지 그림)는 코드가 재료에서 그대로 놓는다.
 *
 * ⛔ 불변(계약 테스트가 전량 검사)
 *   - 칸마다 0번 = 모든 업종 · 마감 근거 없이 · 채움 자리 없이 쓰는 기본 문구(AI 실패 · 고르지 않은 칸 = 0번).
 *   - 숫자 0 · 혜택 낱말 0(할인 · 쿠폰 · 적립 · 증정 · 무료 …) · 줄표 · 따옴표 0 · 칸 글자 상한 안(채운 뒤 넘으면 그 문구는 후보에서 빠진다).
 *   - 「세일」 = 빅세일 묶음에만 · 「새로 · 신상 · 새 」 = 신상품 묶음에만 · 끝 · 마감 · 곧 = needs 'deadline'(면허 카드 종료일이 있을 때만).
 *   - 채움 자리 = {brand} · {product} 만 · 바로 뒤에 받침 따라 바뀌는 조사(이 · 가 · 을 · 를 · 은 · 는 · 와 · 과 · 로)를 두지 않는다.
 *   - {product} 는 계절 안내 · 중립 문장에만(그 상품이 세일 · 신상이라고 단정하지 않는다).
 *   - 효과 · 품질 단정 0(최고 · 1위 · 완벽 · 효과 · 보장).
 */
import type { LineTemplateId, LineCopyKey } from './design-core/line-templates';
import { INDUSTRY_CODES } from './industry-codes';

/** 문구 결 = 업종 군(우리 고객사 업종: 뷰티 · 의류 · 요식업 · 커머스) */
export type OutreachTone = 'beauty' | 'fashion' | 'food' | 'commerce';

const TONE_OF_INDUSTRY: Record<string, OutreachTone> = {
  beauty: 'beauty', health: 'beauty',
  fashion: 'fashion', sports: 'fashion', baby: 'fashion',
  food: 'food',
};

/** 업종 코드(industry-codes 15종) → 문구 결 · 표에 없으면 커머스 */
export function outreachToneOf(industry: string | null | undefined): OutreachTone {
  return (industry && TONE_OF_INDUSTRY[industry]) || 'commerce';
}

export const OUTREACH_TONE_LABEL: Record<OutreachTone, string> = { beauty: '뷰티', fashion: '패션 · 의류', food: '식품 · 외식', commerce: '커머스' };

/** 문구 결 → 업종 코드 목록(학습 레시피 집계 단위 · 커머스 = 표에 없는 업종 전부 + etc) */
export function outreachToneIndustries(tone: OutreachTone): string[] {
  return INDUSTRY_CODES.filter((c) => outreachToneOf(c) === tone);
}

export interface OutreachBankLine { text: string; tone?: OutreachTone; needs?: 'deadline' }

/** 채움 값(재료 원문) — 브랜드 이름 · 대표 상품 이름 */
export interface OutreachFills { brand: string; product: string | null }

const L = (text: string, tone?: OutreachTone): OutreachBankLine => (tone ? { text, tone } : { text });
const D = (text: string): OutreachBankLine => ({ text, needs: 'deadline' });

/** 템플릿 · 칸마다 고를 수 있는 문구(0번 = 기본). 묶음에 없는 칸 = 템플릿 기본 문구(AI 영업에서 쓰지 않는 칸) */
export const OUTREACH_COPY_BANK: Readonly<Record<LineTemplateId, Partial<Record<LineCopyKey, readonly OutreachBankLine[]>>>> = {
  'big-sale': {
    cover_tag: [L('SALE'), L('SPECIAL SALE'), L('BIG SALE'), L('ON SALE')],
    cover_headline: [
      L('세일을 시작합니다'), L('지금 세일 중이에요'), L('기다리던 세일이 왔어요'), L('{brand} 세일'),
      L('뷰티 세일을 시작해요', 'beauty'), L('루틴을 채울 세일이에요', 'beauty'),
      L('스타일 세일을 시작해요', 'fashion'), L('옷장을 채울 세일이에요', 'fashion'),
      L('맛있는 세일이 시작됐어요', 'food'), L('식탁을 채울 세일이에요', 'food'),
      L('장바구니를 채울 세일이에요', 'commerce'),
    ],
    cover_sub: [
      L('놓치기 전에 확인해 보세요'), L('마음에 드는 상품을 먼저 골라 보세요'), L('{brand} 세일 소식을 전해 드려요'),
      L('아끼는 루틴을 채워 두기 좋은 때예요', 'beauty'), L('자주 쓰는 제품을 미리 챙겨 두세요', 'beauty'),
      L('옷장을 채워 두기 좋은 때예요', 'fashion'), L('이번 시즌 스타일을 골라 보세요', 'fashion'),
      L('좋아하는 메뉴를 담아 두세요', 'food'), L('오늘 식탁에 올릴 메뉴를 골라 보세요', 'food'),
      L('필요한 것을 미리 담아 두세요', 'commerce'),
    ],
    story_headline: [
      L('지금 담아 두세요'), L('세일 상품을 모았어요'), L('놓치기 아까운 상품'),
      L('루틴에 더해 보세요', 'beauty'), L('이번에 골라 보세요', 'fashion'), L('오늘의 장바구니', 'food'), L('미리 담아 두세요', 'commerce'),
    ],
    story_body: [
      L('인기 상품은 먼저 품절될 수 있어요. 원하는 상품을 먼저 확인해 보세요'),
      L('세일 상품을 한곳에 모았어요. 천천히 둘러보고 골라 보세요'),
      L('자주 쓰는 제품을 미리 챙겨 두기 좋은 때예요. 원하는 상품을 먼저 확인해 보세요', 'beauty'),
      L('피부 고민에 맞는 제품을 천천히 골라 보세요. 인기 상품은 먼저 품절될 수 있어요', 'beauty'),
      L('마음에 드는 스타일을 먼저 골라 두세요. 인기 상품은 먼저 품절될 수 있어요', 'fashion'),
      L('지금 입기 좋은 옷부터 둘러보세요. 사이즈는 먼저 품절될 수 있어요', 'fashion'),
      L('좋아하는 메뉴를 넉넉히 담아 두세요. 인기 상품은 먼저 품절될 수 있어요', 'food'),
      L('집에서 즐기기 좋은 메뉴를 모았어요. 천천히 둘러보세요', 'food'),
      L('자주 찾는 상품을 미리 챙겨 두세요. 인기 상품은 먼저 품절될 수 있어요', 'commerce'),
    ],
    closing_headline: [
      L('세일 상품을 둘러보세요'), L('지금 확인해 보세요'), L('원하는 상품을 담아 두세요'),
      D('세일이 곧 끝나요'), D('마감 전에 만나 보세요'),
    ],
    closing_body: [
      L('원하는 상품을 지금 담아 두세요'), L('자세한 내용은 아래 버튼에서 확인해 주세요'), L('{brand} 세일 상품을 지금 확인해 보세요'),
      D('세일이 끝나기 전에 원하는 상품을 담아 두세요'),
    ],
    cta_label: [L('세일 상품 보기'), L('세일 보러 가기'), L('지금 쇼핑하기'), L('세일 메뉴 보기', 'food')],
    email_preheader: [L('세일 상품을 한눈에 모았어요'), L('지금 진행 중인 세일을 확인해 보세요'), L('{brand} 세일 소식을 전해 드려요')],
  },
  'special-event': {
    cover_tag: [L('EVENT'), L('SPECIAL'), L('FOR YOU')],
    cover_headline: [
      L('특별한 이벤트를 준비했어요'), L('이벤트 소식을 전해요'), L('{brand} 이벤트 소식'), L('함께해 주세요'),
      L('뷰티 이벤트를 준비했어요', 'beauty'), L('스타일 이벤트를 준비했어요', 'fashion'), L('맛있는 이벤트를 준비했어요', 'food'),
      L('알찬 이벤트를 준비했어요', 'commerce'),
    ],
    cover_sub: [
      L('자세한 내용을 확인해 주세요'), L('함께해 주세요'), L('{brand} 고객을 위해 준비했어요'),
      L('아끼는 루틴과 함께 만나 보세요', 'beauty'), L('좋아하는 스타일과 함께 만나 보세요', 'fashion'),
      L('좋아하는 메뉴와 함께 만나 보세요', 'food'), L('필요한 것을 챙기며 함께해 주세요', 'commerce'),
    ],
    story_headline: [L('이렇게 준비했어요'), L('이벤트 안내'), L('참여 방법')],
    story_body: [
      L('이벤트 내용과 참여 방법은 아래 버튼에서 확인해 주세요'),
      L('자세한 조건은 이벤트 페이지에서 확인해 주세요'),
      L('{brand} 고객을 위해 준비한 이벤트예요. 자세한 조건은 이벤트 페이지에서 확인해 주세요'),
    ],
    closing_headline: [L('놓치지 마세요'), L('지금 확인해 보세요'), L('함께해 주세요'), D('마감 전에 참여해 주세요')],
    closing_body: [
      L('이벤트 내용을 지금 확인해 보세요'), L('자세한 내용은 아래 버튼에서 확인해 주세요'),
      D('이벤트가 끝나기 전에 참여해 주세요'),
    ],
    cta_label: [L('이벤트 보기'), L('참여하기'), L('이벤트 보러 가기'), L('혜택 확인하기')],
    email_preheader: [L('진행 중인 이벤트를 소개해요'), L('이벤트 내용을 한눈에 확인해 보세요'), L('{brand} 이벤트 소식을 전해 드려요')],
  },
  'new-launch': {
    cover_tag: [L('NEW'), L('NEW ARRIVAL'), L('JUST IN')],
    cover_headline: [
      L('새로운 상품을 소개합니다'), L('새로 나온 상품이에요'), L('{brand} 신상품 소식'),
      L('새로운 뷰티 소식이에요', 'beauty'), L('새로 나온 뷰티 아이템', 'beauty'),
      L('새로 들어온 스타일', 'fashion'), L('새 시즌 스타일이 왔어요', 'fashion'),
      L('새로운 메뉴를 소개해요', 'food'), L('새 메뉴가 나왔어요', 'food'),
      L('새로 나온 아이템이에요', 'commerce'),
    ],
    cover_sub: [L('지금 가장 먼저 만나 보세요'), L('새로운 소식을 전해 드려요'), L('{brand} 새 소식을 먼저 전해 드려요')],
    story_headline: [L('이번에 새로 나왔어요'), L('새로 나온 상품'), L('새로 나온 메뉴', 'food')],
    story_body: [
      L('자세한 내용은 상품 페이지에서 확인해 보세요'),
      L('새로 나온 상품을 소개해요. 자세한 내용은 상품 페이지에서 확인해 보세요'),
      L('새로 나온 아이템을 소개해요. 자세한 성분과 사용법은 상품 페이지에서 확인해 보세요', 'beauty'),
      L('새로 들어온 스타일을 소개해요. 사이즈와 소재는 상품 페이지에서 확인해 보세요', 'fashion'),
      L('새로 나온 메뉴를 소개해요. 자세한 내용은 아래에서 확인해 보세요', 'food'),
    ],
    closing_headline: [L('지금 바로 만나 보세요'), L('먼저 만나 보세요')],
    closing_body: [
      L('새로 나온 상품을 가장 먼저 확인해 보세요'), L('{brand} 새 소식을 지금 확인해 보세요'),
      L('새로 나온 아이템을 루틴에 더해 보세요', 'beauty'), L('새로 들어온 스타일을 먼저 입어 보세요', 'fashion'),
      L('새로 나온 메뉴를 가장 먼저 확인해 보세요', 'food'), L('새로 나온 아이템을 먼저 만나 보세요', 'commerce'),
    ],
    cta_label: [L('신상품 보러 가기'), L('새 상품 보기'), L('새 메뉴 보기', 'food')],
    email_preheader: [L('새로 나온 상품을 소개해요'), L('{brand} 신상품 소식을 전해 드려요'), L('새로 나온 메뉴를 소개해요', 'food')],
  },
  season: {
    cover_tag: [L('SEASON'), L('PICK'), L('SEASON PICK'), L('CURATION')],
    cover_headline: [
      L('이 계절에 어울리는 제안'), L('지금 만나기 좋은 상품'), L('{brand} 추천 상품'),
      L('지금 챙기기 좋은 뷰티', 'beauty'), L('지금 쓰기 좋은 아이템', 'beauty'),
      L('지금 입기 좋은 스타일', 'fashion'), L('계절 옷장 제안', 'fashion'),
      L('지금 먹기 좋은 메뉴', 'food'), L('계절을 담은 식탁', 'food'),
      L('지금 쓰기 좋은 아이템', 'commerce'),
    ],
    cover_sub: [
      L('계절을 담은 추천을 모았어요'), L('지금 둘러보기 좋은 상품을 모았어요'), L('{product}부터 둘러보세요'),
      L('계절에 맞는 루틴을 골라 보세요', 'beauty'), L('계절에 맞는 스타일을 골라 보세요', 'fashion'), L('계절에 맞는 메뉴를 골라 보세요', 'food'),
    ],
    story_headline: [L('계절이 바뀌는 지금'), L('천천히 둘러보세요'), L('{brand} 추천')],
    story_body: [
      L('이 계절에 잘 어울리는 것들을 골라 담았어요. 천천히 둘러보세요'),
      L('지금 둘러보기 좋은 상품을 모았어요. 마음에 드는 상품을 찾아보세요'),
      L('{product}부터 천천히 둘러보세요. 마음에 드는 상품을 찾아보세요'),
      L('계절에 맞춰 챙기기 좋은 제품을 모았어요. 천천히 둘러보세요', 'beauty'),
      L('계절에 맞춰 입기 좋은 스타일을 모았어요. 천천히 둘러보세요', 'fashion'),
      L('계절에 맞춰 즐기기 좋은 메뉴를 모았어요. 천천히 둘러보세요', 'food'),
      L('계절에 맞춰 쓰기 좋은 아이템을 모았어요. 천천히 둘러보세요', 'commerce'),
    ],
    closing_headline: [L('지금 만나 보세요'), L('마음에 드는 상품을 찾아보세요'), L('천천히 둘러보세요')],
    closing_body: [L('자세한 내용은 아래 버튼에서 확인해 주세요'), L('계절이 지나기 전에 확인해 보세요'), L('{brand} 추천 상품을 지금 확인해 보세요')],
    cta_label: [L('추천 보러 가기'), L('상품 보러 가기'), L('지금 쇼핑하기'), L('메뉴 보러 가기', 'food')],
    email_preheader: [L('지금 둘러보기 좋은 상품을 모았어요'), L('계절을 담은 추천을 모았어요'), L('{brand} 추천 상품을 모았어요')],
  },
};

/** 결 · 마감 근거로 지금 쓸 수 있는가(채움 전) */
export function outreachBankUsable(line: OutreachBankLine | undefined, tone: OutreachTone, hasDeadline: boolean): boolean {
  return !!line && (!line.tone || line.tone === tone) && (line.needs !== 'deadline' || hasDeadline);
}

/** 채운 문장 — 채움 값이 없거나 칸 상한을 넘으면 null(그 문구는 후보에서 빠진다) */
export function outreachBankText(line: OutreachBankLine, fills: OutreachFills, max: number): string | null {
  let missing = false;
  const text = line.text.replace(/\{(brand|product)\}/g, (_m, k: 'brand' | 'product') => {
    const v = String(fills[k] || '').replace(/\s+/g, ' ').trim();
    if (!v) missing = true;
    return v;
  });
  return missing || text.length > max ? null : text;
}
