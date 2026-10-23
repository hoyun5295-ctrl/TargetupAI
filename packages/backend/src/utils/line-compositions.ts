/**
 * line-compositions.ts — 풍성한 구성 5종(정답 틀 먼저 · 재료는 칸에 입힌다 · 빈 칸은 묻는다)
 *   ★ 2026-10-22 Harold 「풍성하게 템플릿을 먼저 구성하고, 한줄로 물어보는 재료들을 거기에 맞춰서 입히는 방식 · 부족한 건 넣어 달라고」
 *   설계서 docs/2026-10-22-oneline-ct-design.md §4 · §11-2 · §11-6.
 *
 * ⛔ 불변
 *   - 구성(구역 · 순서 · 꾸밈)은 이 파일이 정한다. 재료 칸표(`slots`)가 곧 진단 기준이다(`diagnoseComposition` 한 곳).
 *   - 칸 세 종류: block = 비면 만들기 막음 · suggest = 막지 않음(두뇌 초안을 고치게) · drop = 지어낼 수 없음(비면 구역이 빠진다).
 *   - 칸이 비면 그 구역을 뺀다(자리표시 0). 같은 사진은 한 결과물에 한 번. 주 버튼은 하나.
 *   - 가격 · 사진 · 링크 · 혜택 원문 · 날짜는 AI 를 지나지 않는다. AI 는 문구 칸(`LineRichCopy`)만.
 *   - 순수(DB · AI · 시각 0) · 섹션 id 는 주입.
 */
import type { Section } from './dm/dm-section-registry';
import type { LineCard, NewId, LineInAppMessage } from './line-template-compose';

export type LineCompositionId = 'spotlight' | 'showcase' | 'lookbook' | 'menu' | 'event';
export const LINE_COMPOSITION_IDS: readonly LineCompositionId[] = ['spotlight', 'showcase', 'lookbook', 'menu', 'event'];
export function isLineCompositionId(v: unknown): v is LineCompositionId {
  return typeof v === 'string' && (LINE_COMPOSITION_IDS as readonly string[]).includes(v);
}

export interface LineRichPoint { title: string; body: string; image_url?: string | null }
export interface LineRichProduct extends LineCard { category?: string | null }

export interface LineRichMaterials {
  brandName: string;
  logoUrl?: string | null;
  csPhone?: string | null;
  legal?: string | null;
  /** 첫 화면 그림 · asIs = 글자가 박힌 그림(스튜디오 헤드라인 · 덮지 않고 아래 문구는 받침 · 기간만) */
  poster: { url: string; asIs?: boolean; linkUrl?: string } | null;
  products: LineRichProduct[];
  /** 특징 · 코디 제안 · 맛 꼬리표 · 참여 방법(구성마다 뜻이 다르다 · 칸의 ask 가 묻는 말) */
  points: LineRichPoint[];
  /** 사용 단계(주인공 상품) */
  steps: LineRichPoint[];
  /** 분위기 · 대표 사진(룩북 · 메뉴판) */
  mood: string[];
  proof: Array<{ body: string; author: string; rating: number }>;
  benefit: string | null;
  benefitNote?: string | null;
  couponCode?: string | null;
  periodEnd: string | null;
  periodLabel: string | null;
  link: string | null;
  store?: { address?: string; business_hours?: string; phone?: string } | null;
}

/** 문구 칸(AI 가 채운다 · 칸마다 상한 · 빈 칸 = 기본 문구) */
export type LineRichCopyKey =
  | 'headline' | 'sub' | 'pointsTitle' | 'stepsTitle' | 'productsTitle' | 'moreTitle'
  | 'closingHeadline' | 'closingBody' | 'ctaLabel'
  | 'email_subject' | 'email_preheader' | 'inapp_title' | 'inapp_body';
export type LineRichCopy = Record<LineRichCopyKey, string>;
export interface LineRichCopyField { key: LineRichCopyKey; max: number; fallback: string; hint: string }

export type LineSlotLevel = 'block' | 'suggest' | 'drop';
/** 채우는 방법(화면이 버튼을 고른다 · 화면은 판정하지 않는다) */
export type LineSlotFill = 'mall' | 'upload' | 'paste' | 'url' | 'studio' | 'text' | 'date' | 'draft';

export interface LineCompositionSlot {
  key: keyof LineRichMaterials;
  /** 화면에서 묻는 말 */
  ask: string;
  /** 왜 필요한가(한 줄) */
  why: string;
  level: LineSlotLevel;
  /** 이 개수보다 적으면 빈 칸 */
  min: number;
  max: number;
  fill: LineSlotFill[];
}

export interface LineComposition {
  id: LineCompositionId;
  label: string;
  desc: string;
  primary: string;
  accent: string;
  /** 리듬 띠(연한 바탕) */
  tint: string;
  slots: LineCompositionSlot[];
  copy: LineRichCopyField[];
  /** 추천 규칙(한 줄 낱말 · 업종) */
  match: RegExp;
  industries: string[];
}

const CHANNEL_COPY = (subject: string, pre: string, title: string, body: string): LineRichCopyField[] => [
  { key: 'email_subject', max: 40, fallback: subject, hint: '이메일 제목 · 받은편지함에서 열고 싶게' },
  { key: 'email_preheader', max: 60, fallback: pre, hint: '이메일 미리보기 문장 · 제목을 보완' },
  { key: 'inapp_title', max: 20, fallback: title, hint: '앱 · 쇼핑몰 화면 팝업 제목' },
  { key: 'inapp_body', max: 50, fallback: body, hint: '팝업 본문 한두 문장' },
];
const BASE_COPY = (o: Partial<Record<LineRichCopyKey, string>>): LineRichCopyField[] => [
  { key: 'headline', max: 20, fallback: o.headline || '새 소식을 전해요', hint: '첫 화면 아래 큰 제목 한 줄' },
  { key: 'sub', max: 40, fallback: o.sub || '지금 확인해 보세요', hint: '큰 제목을 받쳐 주는 한 문장' },
  { key: 'pointsTitle', max: 16, fallback: o.pointsTitle || '이런 점이 좋아요', hint: '특징 · 코디 · 참여 방법 구역 제목' },
  { key: 'stepsTitle', max: 16, fallback: o.stepsTitle || '이렇게 쓰세요', hint: '사용 단계 구역 제목' },
  { key: 'productsTitle', max: 18, fallback: o.productsTitle || '지금 만나 보세요', hint: '상품 진열 구역 제목' },
  { key: 'moreTitle', max: 16, fallback: o.moreTitle || '함께 보면 좋아요', hint: '더 보기 상품 구역 제목' },
  { key: 'closingHeadline', max: 18, fallback: o.closingHeadline || '지금 만나 보세요', hint: '마무리 제목' },
  { key: 'closingBody', max: 60, fallback: o.closingBody || '자세한 내용은 버튼을 눌러 확인해 주세요', hint: '마무리 한두 문장(숫자 금지)' },
  { key: 'ctaLabel', max: 10, fallback: o.ctaLabel || '자세히 보기', hint: '버튼 글자' },
];

const PROOF_SLOT: LineCompositionSlot = { key: 'proof', ask: '고객 후기 2~3개', why: '믿을 만한 이유가 있으면 더 눌러요', level: 'drop', min: 1, max: 3, fill: ['paste'] };

export const LINE_COMPOSITIONS: readonly LineComposition[] = [
  {
    id: 'spotlight', label: '주인공 상품', desc: '신제품 · 단품 · 뷰티 · 대표 상품을 크게 · 특징 · 사용 단계 · 후기',
    primary: '#be185d', accent: '#9d174d', tint: '#fdf2f8',
    match: /신상|신제품|출시|런칭|론칭|새로|새 상품|새상품|첫 선|첫선|단독|리뉴얼|앰플|세럼|크림|토너|에센스/,
    industries: ['beauty', 'health', 'baby', 'digital', 'pet'],
    slots: [
      { key: 'products', ask: '대표 상품(사진 · 가격) · 함께 쓰면 좋은 상품', why: '대표 상품이 첫 화면 다음에 크게 실려요', level: 'block', min: 1, max: 5, fill: ['mall', 'upload', 'url'] },
      { key: 'points', ask: '이 상품의 특징 3가지', why: '왜 사야 하는지를 한눈에 보여 줘요', level: 'suggest', min: 3, max: 3, fill: ['draft', 'text', 'upload'] },
      { key: 'steps', ask: '사용 순서(1 · 2 · 3단계)', why: '쓰는 법을 알면 장바구니에 담아요', level: 'suggest', min: 2, max: 3, fill: ['draft', 'text', 'upload'] },
      PROOF_SLOT,
      { key: 'benefit', ask: '출시 혜택(할인 · 사은품)', why: '혜택이 있으면 띠로 크게 실어요', level: 'suggest', min: 1, max: 1, fill: ['text'] },
      { key: 'periodEnd', ask: '혜택 마감일', why: '남은 시간을 함께 보여 줘요', level: 'drop', min: 1, max: 1, fill: ['date'] },
      { key: 'couponCode', ask: '할인 코드(있으면)', why: '결제할 때 넣는 코드를 크게 보여 줘요', level: 'drop', min: 1, max: 1, fill: ['text'] },
    ],
    copy: [...BASE_COPY({ headline: '새로 나왔어요', pointsTitle: '이런 점이 달라요', stepsTitle: '이렇게 쓰세요', moreTitle: '함께 쓰면 좋아요', closingHeadline: '지금 만나 보세요', ctaLabel: '자세히 보기' }),
      ...CHANNEL_COPY('새로 나온 상품을 소개해요', '지금 가장 먼저 만나 보세요', '새로 나왔어요', '지금 가장 먼저 만나 보세요')],
  },
  {
    id: 'showcase', label: '세일 진열장', desc: '빅세일 · 시즌오프 · 특가 · 마감 · 혜택 · 인기 순위 · 종류별 진열',
    primary: '#b91c1c', accent: '#111827', tint: '#fef2f2',
    match: /세일|할인|특가|블프|블랙\s*프라이데이|감사제|시즌\s*오프|클리어런스|가격\s*인하|\d+\s*%|퍼센트|반값|최대/,
    industries: ['fashion', 'home', 'digital', 'sports'],
    slots: [
      { key: 'benefit', ask: '세일 혜택(예: 최대 30%)', why: '세일 진열장은 혜택이 제목이에요', level: 'block', min: 1, max: 1, fill: ['text'] },
      { key: 'periodEnd', ask: '세일 마감일', why: '마감 띠가 서두르게 만들어요', level: 'block', min: 1, max: 1, fill: ['date'] },
      { key: 'products', ask: '세일 상품 4개 이상(종류가 있으면 종류도)', why: '인기 순위와 종류별 진열로 실려요', level: 'block', min: 4, max: 12, fill: ['mall', 'upload', 'url'] },
      { key: 'couponCode', ask: '할인 코드(있으면)', why: '결제할 때 넣는 코드를 크게 보여 줘요', level: 'drop', min: 1, max: 1, fill: ['text'] },
      PROOF_SLOT,
    ],
    copy: [...BASE_COPY({ headline: '시즌 세일을 시작해요', sub: '올해 가장 좋은 가격', productsTitle: '지금 가장 많이 담는 상품', moreTitle: '더 둘러보기', closingHeadline: '세일은 곧 끝나요', closingBody: '마감 전에 원하는 상품을 담아 두세요', ctaLabel: '세일 상품 보기' }),
      ...CHANNEL_COPY('시즌 세일이 시작됐어요', '원하는 상품을 지금 확인하세요', '세일이 시작됐어요', '원하는 상품을 지금 확인해 보세요')],
  },
  {
    id: 'lookbook', label: '룩북', desc: '패션 신상 · 시즌 무드 · 분위기 사진 · 종류별 상품 · 코디 제안',
    primary: '#1c1917', accent: '#a16207', tint: '#faf7f2',
    match: /룩북|코디|입고|FW|SS|가을\s*신상|겨울\s*신상|봄\s*신상|여름\s*신상|컬렉션|스타일/i,
    industries: ['fashion'],
    slots: [
      { key: 'mood', ask: '분위기 사진 3장(착용 · 매장 · 화보)', why: '룩북은 분위기 사진이 첫인상이에요', level: 'block', min: 2, max: 3, fill: ['upload', 'mall', 'studio'] },
      { key: 'products', ask: '신상 4개 이상(종류가 있으면 종류도)', why: '종류별로 나눠 진열해요', level: 'block', min: 4, max: 12, fill: ['mall', 'upload', 'url'] },
      { key: 'points', ask: '코디 제안 2가지', why: '어떻게 입을지 보여 주면 함께 담아요', level: 'suggest', min: 2, max: 2, fill: ['draft', 'text', 'upload'] },
      { key: 'benefit', ask: '신상 혜택(있으면)', why: '혜택이 있으면 띠로 실어요', level: 'drop', min: 1, max: 1, fill: ['text'] },
    ],
    copy: [...BASE_COPY({ headline: '새 시즌을 입어요', sub: '이번 시즌 신상을 가장 먼저', pointsTitle: '이렇게 입어 보세요', productsTitle: '이번 시즌 신상', closingHeadline: '새 시즌, 먼저 만나요', closingBody: '신상은 수량이 많지 않아요', ctaLabel: '신상 보러 가기' }),
      ...CHANNEL_COPY('새 시즌 신상이 들어왔어요', '이번 시즌 스타일을 먼저 만나 보세요', '신상이 들어왔어요', '이번 시즌 스타일을 먼저 만나 보세요')],
  },
  {
    id: 'menu', label: '메뉴판', desc: '외식 · 계절 메뉴 · 대표 메뉴 크게 · 메뉴 진열 · 후기 · 매장 안내',
    primary: '#9a3412', accent: '#7c2d12', tint: '#fff7ed',
    match: /메뉴|신메뉴|음료|커피|디저트|맛집|식당|매장|포장|배달|런치|점심|저녁|브런치|한정\s*메뉴/,
    industries: ['food'],
    slots: [
      { key: 'mood', ask: '대표 메뉴 사진(크게 쓸 한 장 + 더 있으면)', why: '음식은 사진이 먼저 손님을 불러요', level: 'block', min: 1, max: 3, fill: ['upload', 'studio'] },
      { key: 'products', ask: '메뉴(사진 · 가격) 4개 이상', why: '메뉴판으로 진열해요', level: 'block', min: 2, max: 8, fill: ['upload', 'mall'] },
      { key: 'points', ask: '대표 메뉴의 맛 · 재료 꼬리표 3개', why: '맛을 짧게 짚어 주면 먹고 싶어져요', level: 'suggest', min: 3, max: 3, fill: ['draft', 'text'] },
      PROOF_SLOT,
      { key: 'store', ask: '매장 주소 · 영업시간 · 전화', why: '찾아오는 길을 바로 보여 줘요', level: 'suggest', min: 1, max: 1, fill: ['text'] },
      { key: 'benefit', ask: '방문 혜택(있으면)', why: '혜택이 있으면 띠로 실어요', level: 'drop', min: 1, max: 1, fill: ['text'] },
    ],
    copy: [...BASE_COPY({ headline: '새 메뉴가 나왔어요', sub: '지금만 만나는 맛', pointsTitle: '대표 메뉴', productsTitle: '이번 메뉴', closingHeadline: '먼저 맛보세요', closingBody: '자리가 금방 차요. 미리 예약해 주세요', ctaLabel: '예약하기' }),
      ...CHANNEL_COPY('새 메뉴가 나왔어요', '지금만 만나는 맛을 소개해요', '새 메뉴가 나왔어요', '지금만 만나는 맛을 소개해요')],
  },
  {
    id: 'event', label: '이벤트', desc: '회원의 날 · 참여 행사 · 참여 방법 1·2·3 · 혜택 · 마감',
    primary: '#4338ca', accent: '#312e81', tint: '#eef2ff',
    match: /이벤트|회원의?\s*날|참여|응모|추첨|경품|출석|룰렛|챌린지|가입|초대|추천인|래플/,
    industries: ['service', 'culture', 'edu', 'travel', 'finance', 'etc'],
    slots: [
      { key: 'points', ask: '참여 방법(1 · 2 · 3단계)', why: '어떻게 참여하는지가 먼저 보여야 해요', level: 'suggest', min: 3, max: 3, fill: ['draft', 'text'] },
      { key: 'benefit', ask: '참여 혜택', why: '무엇을 받는지가 이벤트의 이유예요', level: 'block', min: 1, max: 1, fill: ['text'] },
      { key: 'periodEnd', ask: '이벤트 마감일', why: '마감 띠가 서두르게 만들어요', level: 'block', min: 1, max: 1, fill: ['date'] },
      { key: 'couponCode', ask: '쿠폰 코드(있으면)', why: '결제할 때 넣는 코드를 크게 보여 줘요', level: 'drop', min: 1, max: 1, fill: ['text'] },
      { key: 'products', ask: '함께 보여 줄 상품(있으면)', why: '참여 뒤 바로 살 수 있게 해요', level: 'drop', min: 1, max: 4, fill: ['mall', 'upload', 'url'] },
    ],
    copy: [...BASE_COPY({ headline: '이벤트를 열었어요', sub: '참여만 해도 혜택을 드려요', pointsTitle: '참여 방법', productsTitle: '함께 보면 좋은 상품', closingHeadline: '마감 전에 참여하세요', closingBody: '혜택은 마감일까지만 드려요', ctaLabel: '참여하기' }),
      ...CHANNEL_COPY('이벤트가 열렸어요', '참여만 해도 혜택을 드려요', '이벤트가 열렸어요', '참여만 해도 혜택을 드려요')],
  },
];

export function getLineComposition(id: unknown): LineComposition | null {
  return LINE_COMPOSITIONS.find((c) => c.id === id) ?? null;
}

/** (순수) 기본 문구(AI 실패 · 시안 · 시험) */
export function compositionFallbackCopy(c: LineComposition): LineRichCopy {
  return Object.fromEntries(c.copy.map((f) => [f.key, f.fallback])) as LineRichCopy;
}

/** 한 줄 · 업종 → 구성 추천(규칙 · AI 실패 때 · 판단 대체) — 점수 = 낱말 일치 2 + 업종 1 · 같으면 목록 순서 */
export function rankCompositions(line: string, industry: string | null): Array<{ id: LineCompositionId; score: number; recommended: boolean }> {
  const ranked = LINE_COMPOSITIONS.map((c, i) => ({ id: c.id, i, score: (c.match.test(line) ? 2 : 0) + (industry && c.industries.includes(industry) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return ranked.map((r, k) => ({ id: r.id, score: r.score, recommended: k === 0 }));
}

const filledCount = (m: LineRichMaterials, key: keyof LineRichMaterials): number => {
  const v = m[key];
  if (Array.isArray(v)) return v.filter((x) => (typeof x === 'string' ? !!x.trim() : !!x && Object.values(x as object).some(Boolean))).length;
  if (v && typeof v === 'object') return Object.values(v).some(Boolean) ? 1 : 0;
  return typeof v === 'string' ? (v.trim() ? 1 : 0) : v ? 1 : 0;
};

/** 인앱 한 장에 실리는 칸(표지 · 혜택 · 대표 상품 · 버튼)만 */
const INAPP_KEYS = new Set<keyof LineRichMaterials>(['products', 'benefit']);

/**
 * (순수) 채널에 실제로 실리는 칸 · 개수(재료 판 · 요리 관문이 같은 함수 · Codex CT R2).
 *   인앱 = 상품 1개 · 혜택만 · 이메일 = 상품 6개까지 · 마감(빠지는 칸)은 이메일에서 묻지 않는다.
 */
export function compositionChannelSlots(c: LineComposition, channel: 'dm' | 'email' | 'inapp'): LineCompositionSlot[] {
  const out: LineCompositionSlot[] = [];
  for (const s of c.slots) {
    if (channel === 'inapp' && !INAPP_KEYS.has(s.key)) continue;
    if (channel === 'email' && s.key === 'periodEnd' && s.level === 'drop') continue;
    if (s.key === 'products') {
      const max = channel === 'inapp' ? 1 : channel === 'email' ? Math.min(s.max, 6) : s.max;
      out.push({ ...s, max, min: Math.min(s.min, max) });
    } else out.push(s);
  }
  return out;
}

/** 재료 칸 → 재료 판 단계 키(화면 · 요청 본문이 쓰는 이름) */
const SLOT_STEP_KEY: Partial<Record<keyof LineRichMaterials, string>> = { periodEnd: 'period', steps: 'usage', couponCode: 'coupon_code' };
export const slotStepKey = (key: keyof LineRichMaterials): string => SLOT_STEP_KEY[key] ?? String(key);

export interface LineSlotDiagnosis extends LineCompositionSlot {
  /** 재료 판 단계 키 */
  step: string;
  /** 지금 가진 수 */
  have: number;
  filled: boolean;
}

/**
 * (순수) ③ 진단 한 곳 — 채널에 실리는 칸마다 가진 수 · 찼는가(★ 2026-10-23 설계서 docs/2026-10-23-oneline-ct-complete-design.md A1).
 *   재료 판 · 미리보기(빈 칸 수 · 점선) · 요리 관문 · 플래너 관문 · 시연이 이것만 본다. 화면은 이 답을 그린다(판정하지 않는다).
 */
export function diagnoseComposition(c: LineComposition, m: LineRichMaterials, channel: 'dm' | 'email' | 'inapp'): LineSlotDiagnosis[] {
  return compositionChannelSlots(c, channel).map((s) => {
    const have = filledCount(m, s.key);
    return { ...s, step: slotStepKey(s.key), have, filled: have >= s.min };
  });
}
/** 만들기를 막는 빈 칸 */
export const diagnosisBlocking = (d: readonly LineSlotDiagnosis[]): LineSlotDiagnosis[] => d.filter((s) => s.level === 'block' && !s.filled);
/** 빈 칸 전부(미리보기 점선 · 빈 칸 수) */
export const diagnosisMissing = (d: readonly LineSlotDiagnosis[]): LineSlotDiagnosis[] => d.filter((s) => !s.filled);

interface P { type: Section['type']; props: Record<string, unknown>; treatment?: string; part: string; tint?: boolean }

const card = (p: LineRichProduct) => ({
  name: p.name,
  price: p.price ?? 0,
  ...(p.discount_price && p.price && p.discount_price < p.price ? { discount_price: p.discount_price } : {}),
  image_url: p.image_url,
  ...(p.link_url ? { link_url: p.link_url } : {}),
});

/** 같은 사진은 한 번(원래 주소 기준) — 이미 쓴 주소면 null */
function useOnce(seen: Set<string>, url: string | null | undefined): string | null {
  const u = String(url || '').trim();
  if (!u || seen.has(u)) return null;
  seen.add(u);
  return u;
}

function cover(m: LineRichMaterials, c: LineRichCopy, comp: LineComposition, seen: Set<string>): P[] {
  const poster = m.poster ? useOnce(seen, m.poster.url) : null;
  if (poster) {
    // 글자가 박힌 그림(스튜디오 헤드라인) = 같은 말을 두 번 하지 않는다 → 아래 문구는 받침 문장 · 기간만
    const headline = m.poster!.asIs ? '' : c.headline;
    const body = [c.sub, m.periodLabel].filter(Boolean).join('\n');
    return [
      { type: 'gallery', props: { title: '', images: [{ url: poster, link_url: m.poster!.linkUrl || m.link || '', caption: '' }], layout: 'list_1xN', full_bleed: true, enable_zoom: false, enable_fullscreen: false }, part: 'cover' },
      { type: 'text_card', props: { ...(headline ? { headline } : {}), body, align: 'center', image_position: 'top' }, treatment: 'classic', part: 'cover-copy' },
    ];
  }
  return [{ type: 'hero', props: { headline: c.headline, sub_copy: [c.sub, m.periodLabel].filter(Boolean).join('\n'), align: 'center', height: 'lg', mood_background: `linear-gradient(160deg, ${comp.primary} 0%, ${comp.accent} 100%)`, mood_text: '#ffffff' }, treatment: 'classic', part: 'cover' }];
}

/**
 * 사진 묶음 한 구역 — 장수마다 빈 칸 없는 배치(★ 2026-10-23 B1 · 렌더러는 2열이라 1장 · 2장(첫 장 크게)에서 옆 칸이 비었다).
 *   1장 = 한 줄 크게(원본 비율) · 2장 = 2열 · 3장 = 첫 장 크게 + 2열.
 */
function photoGroup(urls: readonly string[], link: string | null, part: string, tint = false): P | null {
  if (urls.length === 0) return null;
  const images = urls.map((u) => ({ url: u, link_url: link || '', caption: '' }));
  const layout = urls.length === 1 ? 'list_1xN' : 'grid_2x2';
  return { type: 'gallery', props: { title: '', images, layout, full_bleed: false, enable_zoom: false, enable_fullscreen: false }, ...(urls.length === 3 ? { treatment: 'mosaic' } : {}), part, tint };
}

const title = (text: string, part: string, tint = false): P => ({ type: 'text_card', props: { headline: text, align: 'center', image_position: 'top' }, treatment: 'classic', part: `${part}-title`, tint });

/** 특징 · 코디 = 사진 카드(좌우 번갈아 · 사진은 한 번) · 사진 없는 칸 = 번호 카드 */
function pointCards(points: LineRichPoint[], part: string, tagOf: (i: number) => string, seen: Set<string>, tint = false): P[] {
  return points.map((pt, i) => {
    const img = useOnce(seen, pt.image_url);
    return {
      type: 'text_card' as const,
      props: { tag: tagOf(i), headline: pt.title, body: pt.body, align: 'left', ...(img ? { image_url: img, image_position: i % 2 === 0 ? 'left' : 'right' } : { image_position: 'top' }) },
      treatment: 'classic',
      part,
      tint,
    };
  });
}

/** 사진 없는 단계 셋 = 한 구역(번호 · 제목 · 한 줄 · 글 카드 세 번 반복 0) */
function numberedList(points: LineRichPoint[], heading: string, part: string, tint = false): P {
  return {
    type: 'text_card',
    props: { headline: heading, body: points.map((p, i) => `${i + 1}. ${p.title}${p.body ? `\n   ${p.body}` : ''}`).join('\n\n'), align: 'left', image_position: 'top' },
    treatment: 'framed',
    part,
    tint,
  };
}

/** 사용 단계 = 알약 탭(STEP 1 · 2 · 3) · 사진이 있는 단계 = 그림 탭 · 없으면 글 */
function stepTabs(steps: LineRichPoint[], comp: LineComposition, seen: Set<string>): P {
  return {
    type: 'tab_cards',
    props: {
      tabs: steps.map((s, i) => {
        const img = useOnce(seen, s.image_url);
        return img ? { label: `STEP ${i + 1}`, content_type: 'image', content: img } : { label: `STEP ${i + 1}`, content_type: 'text', content: `${s.title}\n${s.body}` };
      }),
      default_tab_index: 0,
      tab_active_bg: comp.primary,
      tab_active_text_color: '#ffffff',
    },
    part: 'steps',
  };
}

/** 상품 진열 — 사진은 한 번(앞 구역이 쓴 상품 사진은 빼고) */
function productGrid(list: LineRichProduct[], heading: string, part: string, seen: Set<string>, tint = false): P | null {
  const items = list.filter((p) => useOnce(seen, p.image_url)).map(card);
  if (items.length === 0) return null;
  return { type: 'product_carousel', props: { ...(heading ? { title: heading } : {}), products: items, image_fit: 'contain', background_color: '#ffffff' }, treatment: 'classic', part, tint };
}

/** 종류별 진열 — 종류가 둘 이상일 때만 · 2개 미만 종류는 「그 밖에 추천」으로 합친다(외톨이 0) */
function categoryGrids(list: LineRichProduct[], seen: Set<string>): P[] {
  const by = new Map<string, LineRichProduct[]>();
  for (const p of list) {
    const k = String(p.category || '').trim();
    if (!k) continue;
    by.set(k, [...(by.get(k) || []), p]);
  }
  const big = [...by.entries()].filter(([, v]) => v.length >= 2);
  const small = [...by.entries()].filter(([, v]) => v.length < 2).flatMap(([, v]) => v);
  const groups: Array<[string, LineRichProduct[]]> = [...big.slice(0, 3)];
  if (small.length >= 2) groups.push(['그 밖에 추천', small]);
  if (groups.length < 2) return [];
  return groups.flatMap(([cat, items], i) => {
    const grid = productGrid(items.slice(0, 4), '', `cat-${i}`, seen, i % 2 === 1);
    return grid ? [title(cat, `cat-${i}`, i % 2 === 1), grid] : [];
  });
}

const reviews = (m: LineRichMaterials, heading: string, comp: LineComposition): P | null => (m.proof.length > 0
  ? { type: 'reviews', props: { title: heading, reviews: m.proof.slice(0, 3), show_average_rating: true, star_color: comp.primary }, part: 'proof' }
  : null);

const coupon = (m: LineRichMaterials, comp: LineComposition): P | null => (m.benefit
  ? { type: 'coupon', props: { discount_label: m.benefit, card_bg_color: comp.primary, label_color: '#ffffff' }, treatment: 'spotlight', part: 'benefit' }
  : null);

/** 혜택 조건 글(띠 안 조건 칸은 진한 바탕 위 작은 글씨라 안 읽힌다 → 띠 바로 아래 또렷한 글 카드) */
const benefitNote = (m: LineRichMaterials): P | null => (m.benefit && m.benefitNote
  ? { type: 'text_card', props: { body: m.benefitNote, align: 'center', image_position: 'top' }, treatment: 'classic', part: 'benefit-note' }
  : null);

const promo = (m: LineRichMaterials): P | null => (m.couponCode
  ? { type: 'promo_code', props: { code: m.couponCode, description: '결제할 때 이 코드를 넣어 주세요', instructions: '주문서 할인 코드 칸에 입력' }, treatment: 'light', part: 'code' }
  : null);

const countdown = (m: LineRichMaterials, comp: LineComposition): P | null => (m.periodEnd
  ? { type: 'countdown', props: { end_datetime: `${m.periodEnd}T23:59:59+09:00`, urgency_text: '마감까지', show_days: true, show_hours: true, show_minutes: true, show_seconds: false, background_color: comp.accent, urgency_color: '#ffffff' }, treatment: 'banner', part: 'deadline' }
  : null);

function closing(m: LineRichMaterials, c: LineRichCopy): P[] {
  return [
    { type: 'text_card', props: { headline: c.closingHeadline, body: c.closingBody, align: 'center', image_position: 'top' }, treatment: 'classic', part: 'closing' },
    { type: 'cta', props: { buttons: [{ label: c.ctaLabel, url: m.link || '', style: 'primary' }], layout: 'stack' }, treatment: 'bar', part: 'cta' },
  ];
}

/**
 * (순수) 구성 + 재료 + 문구 → 구역 목록(빈 칸 = 그 구역 없음).
 *   리듬: 마감 띠(진한 강조색)와 혜택 띠(주색)는 붙여 두지 않는다 · 번갈이 구역은 연한 바탕(tint).
 */
export function compositionParts(comp: LineComposition, m: LineRichMaterials, c: LineRichCopy): P[] {
  const seen = new Set<string>();
  const out: Array<P | null> = [...cover(m, c, comp, seen)];
  const [lead, ...rest] = m.products;
  switch (comp.id) {
    case 'spotlight': {
      if (lead && useOnce(seen, lead.image_url)) out.push({ type: 'product_carousel', props: { products: [card(lead)], image_fit: 'contain', caption_bg_color: comp.tint, background_color: '#ffffff' }, treatment: 'focus', part: 'lead' });
      // ★ 2026-10-22 특징 = 2개 이상일 때만(한 장짜리 특징 칸 0 · 시연 판정)
      if (m.points.length >= 2) {
        const withImg = m.points.some((p) => p.image_url);
        out.push(...(withImg ? [title(c.pointsTitle, 'points', true), ...pointCards(m.points.slice(0, 3), 'points', (i) => `POINT ${i + 1}`, seen, true)] : [numberedList(m.points.slice(0, 3), c.pointsTitle, 'points', true)]));
      }
      if (m.steps.length) out.push(title(c.stepsTitle, 'steps'), stepTabs(m.steps.slice(0, 3), comp, seen));
      out.push(coupon(m, comp), benefitNote(m));
      out.push(reviews(m, '먼저 써 본 고객 후기', comp));
      if (rest.length) out.push(productGrid(rest.slice(0, 4), c.moreTitle, 'more', seen, true));
      out.push(promo(m), countdown(m, comp));
      break;
    }
    case 'showcase': {
      out.push(countdown(m, comp));
      // 순위 = 앞 4개 · 남는 상품이 하나뿐이면 순위에 합친다(뒤 진열에 외톨이 한 장 0)
      const topN = m.products.length === 5 ? 5 : 4;
      const top = m.products.slice(0, topN).map((p, i) => ({ ...p, name: `${i + 1}위 · ${p.name}` }));
      out.push(productGrid(top, c.productsTitle, 'ranking', seen));
      out.push(coupon(m, comp), benefitNote(m));
      const grids = categoryGrids(m.products.slice(topN), seen);
      out.push(...(grids.length ? grids : [productGrid(m.products.slice(topN, topN + 4), c.moreTitle, 'more', seen, true)]));
      out.push(reviews(m, '먼저 산 고객 후기', comp), promo(m));
      break;
    }
    case 'lookbook': {
      out.push(photoGroup(m.mood.map((u) => useOnce(seen, u)).filter((u): u is string => !!u).slice(0, 3), m.link, 'mood'));
      const grids = categoryGrids(m.products, seen);
      out.push(...(grids.length ? grids : [productGrid(m.products.slice(0, 4), c.productsTitle, 'products', seen)]));
      if (m.points.length) out.push(title(c.pointsTitle, 'looks', true), ...pointCards(m.points.slice(0, 2), 'looks', (i) => `LOOK ${i + 1}`, seen, true));
      out.push(coupon(m, comp), benefitNote(m));
      break;
    }
    case 'menu': {
      // ★ 2026-10-22 대표 = 대표 메뉴 자기 카드(사진 · 이름 · 가격 · 링크 · 분위기 사진을 쓰면 「대표 메뉴 ○○」 아래 다른 음식이 나온다 · 시연 판정) · 첫 화면이 이미 썼으면 칸을 뺀다
      if (lead && useOnce(seen, lead.image_url)) out.push({ type: 'product_carousel', props: { products: [card(lead)], image_fit: 'contain', caption_bg_color: comp.tint, background_color: '#ffffff' }, treatment: 'focus', part: 'signature' });
      if (m.points.length) out.push({ type: 'text_card', props: { tag: '대표 메뉴', headline: lead?.name || c.pointsTitle, body: m.points.slice(0, 3).map((p) => `# ${p.title}`).join('   '), align: 'left', image_position: 'top' }, treatment: 'classic', part: 'tags', tint: true });
      out.push(productGrid(m.products.slice(0, 6), c.productsTitle, 'menu', seen));
      out.push(photoGroup(m.mood.map((u) => useOnce(seen, u)).filter((u): u is string => !!u).slice(0, 2), m.link, 'more-photos'));
      out.push(reviews(m, '다녀간 손님 후기', comp));
      if (m.store && Object.values(m.store).some(Boolean)) out.push({ type: 'store_info', props: { ...m.store }, treatment: 'card', part: 'store' });
      out.push(coupon(m, comp), benefitNote(m));
      break;
    }
    case 'event': {
      if (m.points.length) {
        const withImg = m.points.some((p) => p.image_url);
        out.push(...(withImg ? [title(c.pointsTitle, 'how', true), ...pointCards(m.points.slice(0, 3), 'how', (i) => `STEP ${i + 1}`, seen, true)] : [numberedList(m.points.slice(0, 3), c.pointsTitle, 'how', true)]));
      }
      out.push(coupon(m, comp), benefitNote(m), promo(m));
      if (m.products.length) out.push(productGrid(m.products.slice(0, 4), c.productsTitle, 'products', seen));
      out.push(countdown(m, comp));
      break;
    }
  }
  out.push(...closing(m, c));
  return out.filter((p): p is P => !!p);
}

function toSection(p: P, comp: LineComposition, newId: NewId): Section {
  return {
    id: newId(p.part), type: p.type, order: 0, visible: true,
    ...(p.treatment ? { treatment: p.treatment } : {}),
    // 번갈이 구역 = 브랜드 색에서 뽑은 연한 바탕(렌더러 배경면 'tint' · DM 뷰어 · 편집기 같은 값)
    ...(p.tint ? { background: 'tint' as const } : {}),
    props: p.props,
  } as Section;
}

function header(m: LineRichMaterials, newId: NewId): Section {
  return { id: newId('header'), type: 'header', order: 0, visible: true, props: { variant: 'logo', brand_name: m.brandName, ...(m.logoUrl ? { logo_url: m.logoUrl } : {}), align: 'center', brand_size: 'sm' } } as Section;
}
function footer(m: LineRichMaterials, newId: NewId): Section {
  return { id: newId('footer'), type: 'footer', order: 0, visible: true, props: { ...(m.legal ? { legal_text: m.legal } : {}), ...(m.csPhone ? { cs_phone: m.csPhone } : {}), show_unsubscribe_link: true } } as Section;
}

/** 앞 구역에 붙는 부분(같은 장 · 슬라이드로 바꿀 때 장을 나누지 않는다) */
const JOIN_PREV = new Set(['cover-copy', 'benefit-note', 'code', 'deadline', 'cta']);

/**
 * DM — 세로 한 페이지가 기본 · 섹션마다 장 키(`tpl_slot` = p{장}.{부분})를 단다(편집기에서 슬라이드로 바꾸면 이 키로 장을 묶는다 · 1017 계약).
 *   장 나눔 = 구역 제목은 다음 구역과 한 장 · 받침(문구 · 조건 · 코드 · 마감 · 버튼)은 앞 장 · 그 밖 = 새 장.
 */
export function composeRichDm(comp: LineComposition, m: LineRichMaterials, c: LineRichCopy, newId: NewId): { sections: Section[]; pages: Section[][]; brandKitPatch: { primary_color: string; accent_color: string } } {
  const parts = compositionParts(comp, m, c);
  const sections: Section[] = [];
  let page = 0;
  let prevTitle = false;
  parts.forEach((p, i) => {
    if (i > 0 && !JOIN_PREV.has(p.part) && !prevTitle) page++;
    prevTitle = p.part.endsWith('-title');
    sections.push({ ...toSection(p, comp, newId), tpl_slot: `p${page}.${p.part}` } as Section);
  });
  if (m.brandName || m.logoUrl) sections.unshift({ ...header(m, newId), tpl_slot: 'p0.header' } as Section);
  sections.push({ ...footer(m, newId), tpl_slot: `p${page}.footer` } as Section);
  sections.forEach((s, i) => { s.order = i; });
  const pages: Section[][] = [];
  for (const s of sections) {
    const n = Number(/^p(\d+)\./.exec(String((s as any).tpl_slot || ''))?.[1] ?? 0);
    (pages[n] = pages[n] || []).push(s);
  }
  return { sections, pages: pages.filter(Boolean), brandKitPatch: { primary_color: comp.primary, accent_color: comp.accent } };
}

/**
 * 이메일 — 같은 구역 순서 · 이메일 렌더러가 아는 구역으로 바꿔 싣는다.
 *   탭(STEP) = 펼친 번호 목록 · 색면 표지 = 흰 바탕 큰 제목(이메일 렌더러에 색면이 없다) · 쿠폰 = classic · 번갈이 바탕 0.
 */
export function composeRichEmail(comp: LineComposition, m: LineRichMaterials, c: LineRichCopy, newId: NewId): { sections: Section[]; subject: string; preheader: string } {
  const parts = compositionParts(comp, m, c).map((p): P => {
    if (p.type === 'tab_cards') {
      const steps = m.steps.slice(0, 3);
      return { type: 'text_card', props: { body: steps.map((s, i) => `${i + 1}. ${s.title}${s.body ? ` · ${s.body}` : ''}`).join('\n'), align: 'left', image_position: 'top' }, treatment: 'classic', part: p.part };
    }
    if (p.type === 'hero' && !p.props.image_url) { const { mood_background: _bg, mood_text: _tx, ...rest } = p.props; return { ...p, props: { ...rest, height: 'sm' } }; }
    if (p.type === 'coupon') return { ...p, treatment: 'classic' };
    if (p.type === 'text_card' && p.treatment === 'framed') return { ...p, treatment: 'classic' };
    return p;
  });
  const sections: Section[] = [];
  if (m.brandName || m.logoUrl) sections.push(header(m, newId));
  for (const p of parts) sections.push(toSection({ ...p, tint: false }, comp, newId));
  sections.push(footer(m, newId));
  sections.forEach((s, i) => { s.order = i; });
  return { sections, subject: c.email_subject, preheader: c.email_preheader };
}

/** 인앱 — center_modal 한 장(첫 화면 그림 · 꼬리표 · 제목 · 본문 · 혜택 · 대표 상품 · 버튼 · SDK 가 아는 블록만) */
export function composeRichInapp(comp: LineComposition, m: LineRichMaterials, c: LineRichCopy): LineInAppMessage {
  const product = m.products[0] ?? null;
  const image = m.poster?.url ?? m.mood[0] ?? null;
  const blocks: Array<Record<string, unknown>> = [];
  if (image) blocks.push({ type: 'media', variant: 'image', url: image });
  blocks.push({ type: 'eyebrow', text: comp.label });
  blocks.push({ type: 'headline', text: c.inapp_title });
  blocks.push({ type: 'body', text: [c.inapp_body, m.periodLabel].filter(Boolean).join(' · ') });
  if (m.benefit) blocks.push({ type: 'benefit', text: m.benefit });
  if (product && product.image_url !== image) {
    blocks.push({
      type: 'product', name: product.name, image: product.image_url,
      ...(product.price ? { price: product.price } : {}),
      ...(product.discount_price && product.price && product.discount_price < product.price ? { discount_price: product.discount_price } : {}),
      ...(product.link_url ? { link_url: product.link_url } : {}),
    });
  }
  const url = m.link || product?.link_url || null;
  blocks.push({ type: 'cta_group', buttons: [{ label: c.ctaLabel, action_url: url, style: 'primary' }] });
  return {
    template: 'center_modal', title: c.inapp_title, body: c.inapp_body, badge_text: comp.label, image_url: image,
    buttons: [{ id: 'b0', label: c.ctaLabel, action_url: url, style: 'primary', background_color: comp.primary, text_color: '#ffffff' }],
    content_blocks: blocks, theme: comp.id === 'showcase' ? 'bold-sale' : comp.id === 'event' ? 'festive' : 'editorial', card_style: 'classic', accent_color: comp.primary,
  };
}

/** 품질 관문(섹션 단계) — 빈 상품 · 자리표시 글자 · 같은 사진 반복 · 주 버튼 둘 이상 */
export function compositionGate(sections: readonly Section[]): string[] {
  const out: string[] = [];
  const imgs: string[] = [];
  let ctas = 0;
  const PH = /추가해주세요|직접 작성|직접 입력|입력해주세요|\[URL/;
  for (const s of sections) {
    const p = (s.props || {}) as Record<string, any>;
    if (s.type === 'product_carousel') {
      if (!Array.isArray(p.products) || p.products.length === 0) out.push('빈 상품 섹션');
      for (const it of p.products || []) if (it?.image_url) imgs.push(String(it.image_url));
    }
    if (s.type === 'hero' && p.image_url) imgs.push(String(p.image_url));
    if (s.type === 'gallery') for (const im of p.images || []) if (im?.url) imgs.push(String(im.url));
    if (s.type === 'text_card' && p.image_url) imgs.push(String(p.image_url));
    if (s.type === 'reviews' && (!Array.isArray(p.reviews) || !p.reviews.some((r: any) => r?.body))) out.push('빈 후기 섹션');
    if (s.type === 'cta') ctas += Array.isArray(p.buttons) ? p.buttons.filter((b: any) => b?.style !== 'outline').length : 0;
    const text = s.type === 'reviews' ? '' : JSON.stringify(p);
    if (PH.test(text)) out.push(`자리표시 글자(${s.type})`);
  }
  if (imgs.filter((u, i) => imgs.indexOf(u) !== i).length > 0) out.push('같은 사진 반복');
  if (ctas > 1) out.push('버튼 둘 이상');
  return out;
}

/** (순수) 구역 수(머리 · 꼬리 제외) — 6 미만이면 재료 판이 짚는다 */
export function compositionBodyCount(sections: readonly Section[]): number {
  return sections.filter((s) => s.type !== 'header' && s.type !== 'footer').length;
}
