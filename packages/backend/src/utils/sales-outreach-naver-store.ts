/**
 * ★ 2026-09-24 B 네이버 스토어 전용 판독기(순수 · DB 0 · 네트워크 0) — 설계 = docs/2026-09-24-outreach-naver-store-reader-design.md
 *
 * 입력 = 직원 브라우저에 떠 있던 스토어 화면의 `window.__PRELOADED_STATE__` 중 허용 칸(북마크 판 2 가 뽑아 보낸 것 ·
 *   저장본 업로드는 파일 안 스크립트에서 같은 칸을 뽑는다). 모든 브랜드스토어·스마트스토어가 네이버 한 틀이라 판독기 하나가 전부를 읽는다.
 * 출력 = 기획(메뉴) · 상품(정가·할인가·할인율·리뷰) · 관심고객수 → 확인 화면 행사 후보(storeCandidatesOf · eventCandidatesView).
 *
 * ⛔ 보는 사람의 회원·주소 칸(naverMember·myAddress·my·addressBook …)은 허용 목록 밖이다 — 버튼과 서버 두 곳 모두 허용 목록으로 거른다.
 * ⛔ 기획 판정 규칙(꼬리표·이모지·보이는 배너)의 근거는 톤28 원본 1건이다(미검증 · 설계서 §5 다른 스토어 2건 실측).
 */
import type { EventCandidate } from './sales-outreach-jobs';
import { naverStoreUrlOf } from './sales-outreach-direct';

/** 북마크·서버가 함께 쓰는 허용 칸(최상위) */
export const NAVER_STORE_STATE_KEYS = ['bsProductCollection', 'widgetContents', 'categoryMenu', 'keepStore', 'channel', 'homeSetting'] as const;
export const NAVER_STORE_PRODUCTS_MAX = 12;
export const NAVER_STORE_CAMPAIGNS_MAX = 6;
/** 기획이 아닌 고정 메뉴(공백 뺀 소문자) */
const FIXED_MENU = new Set(['홈', '전체상품', '전체', '전체보기', '정기구독', 'best', '베스트']);

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const squash = (s: unknown): string => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const cleanMenuName = (n: unknown): string => String(n ?? '').replace(/\p{Extended_Pictographic}|️|‍/gu, '').replace(/\s+/g, ' ').trim();

export interface NaverStoreProduct {
  id: string;
  /** 이름(대괄호 꼬리표 뺀 것) */
  name: string;
  /** 대괄호 꼬리표("[톤캉스]" → 톤캉스) */
  tags: string[];
  price: number | null;
  /** 할인가(정가보다 작을 때만) */
  salePrice: number | null;
  discountRatio: number | null;
  reviewCount: number | null;
  rating: number | null;
}
export interface NaverStoreCampaign {
  id: string;
  /** 메뉴 이름(이모지 뗀 것) */
  name: string;
  /** 스토어 메뉴 주소(코드 템플릿) */
  link: string;
  evidence: Array<'tag' | 'emoji' | 'banner'>;
  productIds: string[];
  /** 대표 상품(할인율 → 리뷰 수 순) */
  lead: { name: string; price: number | null; salePrice: number | null; discountRatio: number | null } | null;
}
export interface NaverStoreMaterial {
  storeName: string | null;
  interestCount: number | null;
  campaigns: NaverStoreCampaign[];
  products: NaverStoreProduct[];
}

/** 허용 칸만(순수) — 필요한 칸만 남긴다: channel = 이름·주소 · keepStore = 수 · categoryMenu = 1단 메뉴 · homeSetting = 위젯 */
export function pickNaverStoreState(raw: unknown): Record<string, unknown> | null {
  if (!isObj(raw)) return null;
  return {
    bsProductCollection: isObj(raw.bsProductCollection) ? raw.bsProductCollection : {},
    widgetContents: isObj(raw.widgetContents) ? raw.widgetContents : {},
    categoryMenu: { firstCategories: Array.isArray(raw.categoryMenu?.firstCategories) ? raw.categoryMenu.firstCategories : [] },
    keepStore: { count: num(raw.keepStore?.count) },
    channel: { channelName: typeof raw.channel?.channelName === 'string' ? raw.channel.channelName : null, url: typeof raw.channel?.url === 'string' ? raw.channel.url : null },
    homeSetting: { widgets: isObj(raw.homeSetting?.widgets) ? raw.homeSetting.widgets : {} },
  };
}

/** 문자열 안의 JS 객체 리터럴 하나를 괄호 짝으로 잘라낸다(문자열·이스케이프 인식) */
function sliceObjectLiteral(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let p = start; p < s.length; p++) {
    const ch = s[p];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return s.slice(start, p + 1); }
  }
  return null;
}

/** 저장본 HTML → 허용 칸(순수). 스크립트의 `__PRELOADED_STATE__={…}`(undefined 는 null 로) · 없거나 못 읽으면 null */
export function naverStoreStateFromHtml(html: string): Record<string, unknown> | null {
  const s = String(html || '');
  const i = s.indexOf('__PRELOADED_STATE__');
  if (i < 0) return null;
  const j = s.indexOf('{', i);
  if (j < 0) return null;
  const lit = sliceObjectLiteral(s, j);
  if (!lit) return null;
  try {
    return pickNaverStoreState(JSON.parse(lit.replace(/(?<=[:[,])undefined(?=[,\]}])/g, 'null')));
  } catch {
    return null;
  }
}

function productOf(p: Obj): NaverStoreProduct | null {
  const id = p?.id !== undefined && p?.id !== null ? String(p.id) : '';
  const raw = String(p?.dispName || p?.name || '').replace(/\s+/g, ' ').trim();
  if (!id || !raw) return null;
  const tags = Array.from(raw.matchAll(/\[([^\]]{1,20})\]/g)).map((m) => m[1].trim()).filter(Boolean);
  const name = raw.replace(/\[[^\]]{1,20}\]/g, ' ').replace(/\s+/g, ' ').trim() || raw;
  const price = num(p.salePrice);
  const sale = num(p.benefitsView?.discountedSalePrice);
  const ratio = num(p.benefitsView?.discountedRatio);
  return {
    id, name, tags,
    price: price && price > 0 ? price : null,
    salePrice: sale && sale > 0 && price && sale < price ? sale : null,
    discountRatio: ratio && ratio > 0 && ratio < 100 ? Math.round(ratio) : null,
    reviewCount: num(p.reviewAmount?.totalReviewCount),
    rating: num(p.reviewAmount?.averageReviewScore),
  };
}

/** 상품 합집합 — 베스트 → 신상 → 위젯의 simpleProducts(깊이 5) · id 1번 */
function collectProducts(state: Obj): NaverStoreProduct[] {
  const lists: unknown[][] = [];
  const bs = isObj(state.bsProductCollection) ? state.bsProductCollection : {};
  if (Array.isArray(bs.bestProducts)) lists.push(bs.bestProducts);
  if (Array.isArray(bs.newProducts)) lists.push(bs.newProducts);
  const walk = (x: unknown, depth: number) => {
    if (depth > 5 || !isObj(x)) return;
    for (const [k, v] of Object.entries(x)) {
      if (k === 'simpleProducts' && Array.isArray(v)) lists.push(v);
      else if (isObj(v)) walk(v, depth + 1);
    }
  };
  walk(state.widgetContents, 0);
  const seen = new Map<string, NaverStoreProduct>();
  for (const l of lists) {
    for (const p of l) {
      const x = isObj(p) ? productOf(p) : null;
      if (x && !seen.has(x.id)) seen.set(x.id, x);
    }
  }
  return [...seen.values()];
}

/**
 * 허용 칸 → 판독 결과(순수). 기획 = 1단 메뉴 중 근거가 하나라도 있는 것(메뉴 순서 · ≤6):
 *   ① 이름이 상품 꼬리표로 2개 이상 쓰임 ② 이름에 이모지 ③ 보이는 배너가 그 메뉴로 링크 · 고정 메뉴 제외.
 *   기획의 상품 = 꼬리표가 같은 상품 ∪ 보이는 상품 묶음(제목이 같은 것)의 상품. 메뉴·상품이 모두 없으면 null.
 */
export function parseNaverStoreState(state: unknown, store: { kind: 'brand' | 'smartstore'; slug: string }): NaverStoreMaterial | null {
  if (!isObj(state)) return null;
  const all = collectProducts(state);
  const byId = new Map(all.map((p) => [p.id, p] as const));
  const base = naverStoreUrlOf(`${store.kind}:${store.slug}`);
  const widgets: Obj = isObj(state.homeSetting?.widgets) ? state.homeSetting.widgets : {};
  const promoItems: unknown[] = Array.isArray(widgets.promotionManageWidget?.generalPromotion?.items) ? widgets.promotionManageWidget.generalPromotion.items : [];
  const bannerLinks = promoItems.filter((it) => isObj(it) && it.visible === true).map((it) => String((it as Obj).linkUrl || ''));
  const groups = Object.values(widgets)
    .filter((w): w is Obj => isObj(w) && w.type === 'CUSTOM_PRODUCT' && w.visible === true && !!w.titleSettings?.title)
    .map((w) => ({ key: squash(cleanMenuName(w.titleSettings.title)), ids: (Array.isArray(w.productNos) ? w.productNos : []).map((x: unknown) => String(x)) }));
  const cats: unknown[] = Array.isArray(state.categoryMenu?.firstCategories) ? state.categoryMenu.firstCategories : [];
  const campaigns: NaverStoreCampaign[] = [];
  for (const c of cats) {
    if (!isObj(c) || !base) continue;
    const id = String(c.id || '');
    const rawName = String(c.name || '');
    const name = cleanMenuName(rawName);
    if (!/^[0-9A-Za-z]{8,64}$/.test(id) || name.length < 2 || FIXED_MENU.has(squash(name))) continue;
    const key = squash(name);
    const tagged = all.filter((p) => p.tags.some((t) => squash(t) === key)).map((p) => p.id);
    const grouped = groups.filter((g) => g.key === key).flatMap((g) => g.ids);
    const evidence: NaverStoreCampaign['evidence'] = [];
    if (tagged.length >= 2) evidence.push('tag');
    if (EMOJI_RE.test(rawName)) evidence.push('emoji');
    if (bannerLinks.some((u) => u.includes(`/category/${id}`))) evidence.push('banner');
    if (!evidence.length) continue;
    const productIds = Array.from(new Set([...tagged, ...grouped]));
    const members = productIds.map((pid) => byId.get(pid)).filter((p): p is NaverStoreProduct => !!p);
    const lead = members.slice().sort((a, b) => (b.discountRatio || 0) - (a.discountRatio || 0) || (b.reviewCount || 0) - (a.reviewCount || 0))[0] || null;
    campaigns.push({
      id, name, link: `${base}/category/${id}`, evidence, productIds,
      lead: lead ? { name: lead.name, price: lead.price, salePrice: lead.salePrice, discountRatio: lead.discountRatio } : null,
    });
    if (campaigns.length >= NAVER_STORE_CAMPAIGNS_MAX) break;
  }
  if (!campaigns.length && !all.length) return null;
  return {
    storeName: typeof state.channel?.channelName === 'string' ? state.channel.channelName : null,
    interestCount: num(state.keepStore?.count),
    campaigns,
    products: all.slice(0, NAVER_STORE_PRODUCTS_MAX),
  };
}

const won = (n: number): string => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
const cutName = (s: string, n: number): string => {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp >= Math.floor(n / 2) ? cut.slice(0, sp) : cut).trim();
};

/** 기획 본문 한 줄(순수) — "대표 상품 12,900원(66%) 외 N개" · 대표 상품이 없으면 null(가격은 가져온 시각의 스토어 표시값) */
export function storeLeadLineOf(c: Pick<NaverStoreCampaign, 'lead' | 'productIds'> | null | undefined): string | null {
  const l = c?.lead;
  if (!l || !String(l.name || '').trim()) return null;
  const price = l.salePrice ? `${won(l.salePrice)}${l.discountRatio ? `(${l.discountRatio}%)` : ''}` : l.price ? won(l.price) : '';
  const more = Math.max(0, (Array.isArray(c?.productIds) ? c!.productIds.length : 0) - 1);
  return `${[cutName(l.name, 24), price].filter(Boolean).join(' ')}${more ? ` 외 ${more}개` : ''}`;
}

/**
 * store_grab(판 2) → 행사 후보(순수). 기획마다 카드 후보 1장: 제목 = 기획 이름 · 링크 = 메뉴 · 면허 = 스토어에 지금 걸려 있음
 * (불변 42 "홈 게시 = 진행 중"과 같은 논법) · 본문(parts.benefit) = 대표 상품 한 줄. 판 1(글자)·빈 값 = [].
 */
export function storeCandidatesOf(grab: unknown): EventCandidate[] {
  if (!isObj(grab) || grab.v !== 2 || !isObj(grab.material)) return [];
  const campaigns: unknown[] = Array.isArray(grab.material.campaigns) ? grab.material.campaigns : [];
  return campaigns.filter((c): c is NaverStoreCampaign => isObj(c) && !!String(c.name || '').trim() && !!c.link)
    .slice(0, NAVER_STORE_CAMPAIGNS_MAX)
    .map((c) => ({
      quote: c.name, sourceUrl: c.link, startDate: null, endDate: null, benefitLicensed: true, origin: 'card' as const,
      source: 'naver_store' as const, title: c.name, periodRaw: null, bannerUrl: null, detailUrl: c.link,
      parts: { title: c.name, benefit: storeLeadLineOf(c), period: null },
    }));
}

/**
 * 확인 화면·확정이 함께 부르는 후보 목록(순수) — 홈페이지 후보(옛 스토어 후보는 뺀다) 뒤에 지금 store_grab 의 스토어 후보.
 * 스토어가 없으면 종전 목록과 같다. 확정은 화면이 본 store_grab 시각을 대조해 번호가 어긋나지 않게 한다(confirmSelectionCore).
 */
export function eventCandidatesView(base: readonly EventCandidate[] | null | undefined, grab: unknown): EventCandidate[] {
  return [...(Array.isArray(base) ? base : []).filter((c) => c?.source !== 'naver_store'), ...storeCandidatesOf(grab)];
}
