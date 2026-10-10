/**
 * line-mall-cards.ts — 한 줄 DM·이메일: 사람이 고른 몰 상품 → 확정 카드 CT (★ 2026-10-10 · 설계서 docs/2026-10-10-oneline-dm-email-design.md §3 · §4)
 *
 * "이름은 찾기에만 · 확정은 사람의 탭 · 값은 상품번호 재조회" — 재조회 함수는 AI 자동제작 것을 그대로 쓴다(새 재조회 0).
 *
 * ⛔ 불변
 *   - **재조회가 ok 인 상품만 카드다.** 품절 · 못 찾음 · 몰 장애 · 사진 없음 · 담당 범위 밖 = 카드에서 빼고 사유만 남긴다
 *     (화면 값으로 채우는 길이 없다 · 이 경로는 이름 · 가격을 받지 않는다).
 *   - **카드에 discount_rate 를 쓰지 않는다** — 정가 · 판매가만 실어 DM · 이메일 렌더러가 같은 할인율을 낸다(렌더러 무접촉).
 *   - 가격 · 링크는 AI 프롬프트를 지나지 않는다(카피 생성 뒤 코드가 싣는다 · AI 자동제작 불변 2).
 *   - 할인가를 계산하지 않는다 — 한 줄의 「30%」는 혜택 문구로만 쓰이고, 몰 값과 다르면 안내 한 줄(잠금 · 질문 아님).
 */
import type { Section } from './dm/dm-section-registry';
import type { BuildMallLookup, BuildMallProvider } from './ai-auto-build-materials';
import type { IntegrationActor } from './integration-scope';
import type { LineProductRef } from './one-line-facts';
import { lineBenefitPercents, lineMoneyAmounts } from './one-line-facts';
import { accessiblePrimaryOf, outreachArtDirection } from './sales-outreach-look';
import { normalizeEmailDesign, type EmailDesign } from './email/email-tokens';

/** 상품 슬라이드 항목(DM · 이메일 공용 모양) — discount_rate 없음 */
export interface LineMallCard {
  name: string;
  /** 정가(정가가 없으면 판매가) */
  price: number;
  /** 판매가 < 정가일 때만 */
  discount_price?: number;
  image_url: string;
  link_url?: string;
}

export interface LineMallExcluded { provider: string; no: string; name: string | null; reason: string }

export interface LineMallDeps {
  /** 상품번호 재조회(AI 자동제작 lookupMallProductsByNo 그대로) */
  lookupMall(companyId: string, provider: BuildMallProvider, nos: readonly string[]): Promise<BuildMallLookup>;
  /** 우커머스 몰을 이 담당자가 다룰 수 있는가(회사 소속 + 분류코드 범위 · /search 와 같은 판정) */
  wooScope(companyId: string, provider: string, actor: IntegrationActor): Promise<boolean>;
}

/** 실제 배선 — 무거운 모듈(DB · 몰 클라이언트)은 부를 때 읽는다(순수 테스트가 DB 모듈을 끌어오지 않게). */
export function defaultLineMallDeps(): LineMallDeps {
  return {
    lookupMall: async (companyId, provider, nos) => {
      const { defaultBuildDeps } = await import('./campaign-quick');
      return defaultBuildDeps().lookupMall(companyId, provider, nos);
    },
    wooScope: async (companyId, provider, actor) => {
      const [{ normalizeWooMallId }, { getWooIntegration }, { canTouchIntegration }] = await Promise.all([
        import('./woocommerce-core'), import('./woocommerce-client'), import('./integration-scope'),
      ]);
      const mallId = normalizeWooMallId(provider.slice('woocommerce:'.length));
      const integ = mallId ? await getWooIntegration(companyId, mallId) : undefined;
      return !!integ && canTouchIntegration(actor, integ.storeCode);
    },
  };
}

/**
 * 고른 상품 → 확정 카드 + 뺀 상품 사유. 몰마다 한 번 재조회 · 카드 순서 = 고른 순서.
 * ⛔ 우커머스 범위 밖 몰은 재조회도 하지 않는다(provider 문자열로 남의 몰을 찍어 읽는 길 차단 · 0918 범위 설계).
 */
export async function resolveLineMallCards(
  companyId: string,
  actor: IntegrationActor,
  refs: readonly LineProductRef[],
  deps: LineMallDeps = defaultLineMallDeps(),
): Promise<{ cards: LineMallCard[]; excluded: LineMallExcluded[] }> {
  const byProvider = new Map<string, string[]>();
  for (const r of refs) byProvider.set(r.provider, [...(byProvider.get(r.provider) || []), r.no]);
  const lookups = new Map<string, BuildMallLookup | 'scope'>();
  for (const [provider, nos] of byProvider) {
    if (provider.startsWith('woocommerce:')) {
      let allowed = false;
      try { allowed = await deps.wooScope(companyId, provider, actor); } catch { allowed = false; }
      if (!allowed) { lookups.set(provider, 'scope'); continue; }
    }
    try {
      lookups.set(provider, await deps.lookupMall(companyId, provider as BuildMallProvider, nos));
    } catch {
      lookups.set(provider, { failed: true, byCode: {} });
    }
  }
  const cards: LineMallCard[] = [];
  const excluded: LineMallExcluded[] = [];
  for (const r of refs) {
    const lookup = lookups.get(r.provider);
    const miss = (reason: string, name: string | null = null) => excluded.push({ provider: r.provider, no: r.no, name, reason });
    if (lookup === 'scope') { miss('담당 범위가 아닌 몰이에요'); continue; }
    if (!lookup || lookup.failed) { miss('몰 응답을 받지 못했어요'); continue; }
    const hit = lookup.byCode[r.no];
    if (!hit) { miss('몰에서 찾지 못했어요'); continue; }
    if (hit.status !== 'ok') { miss(hit.reason); continue; }
    if (!hit.imageUrl) { miss('상품 사진이 없어요', hit.name); continue; }
    const regular = hit.price > 0 ? hit.price : hit.salePrice;
    const card: LineMallCard = { name: hit.name, price: regular, image_url: hit.imageUrl };
    if (hit.salePrice > 0 && hit.salePrice < regular) card.discount_price = hit.salePrice;
    if (hit.productUrl) card.link_url = hit.productUrl;
    cards.push(card);
  }
  return { cards, excluded };
}

/**
 * (순수) 확정 카드를 섹션에 놓는다 — 첫 상품 슬라이드의 상품을 통째로 바꾸고(제목 · 모양 값은 그대로),
 * 다른 상품 슬라이드는 뺀다(AI 가 쓴 상품 · 가격이 고객에게 나가지 않게). 상품 슬라이드가 없으면 히어로 뒤(없으면 머리 뒤 · 그것도 없으면 맨 앞)에 하나 넣는다.
 * 순서(order)는 다시 매긴다 · 입력은 바꾸지 않는다 · 카드 0 = 그대로.
 */
export function placeLineMallCards(
  sections: readonly Section[],
  cards: readonly LineMallCard[],
  opts: { newId: () => string; makeCarousel: (order: number) => Section },
): Section[] {
  if (cards.length === 0) return sections as Section[];
  const items = cards.map((c) => ({ id: opts.newId(), ...c }));
  const firstIdx = sections.findIndex((s) => s.type === 'product_carousel');
  let out: Section[];
  if (firstIdx >= 0) {
    out = sections
      .filter((s, i) => s.type !== 'product_carousel' || i === firstIdx)
      .map((s) => (s === sections[firstIdx] ? { ...s, props: { ...(s.props as Record<string, unknown>), products: items } as Section['props'] } : s));
  } else {
    const heroIdx = sections.findIndex((s) => s.type === 'hero');
    const headerIdx = sections.findIndex((s) => s.type === 'header');
    const at = heroIdx >= 0 ? heroIdx + 1 : headerIdx >= 0 ? headerIdx + 1 : 0;
    const base = opts.makeCarousel(at);
    const carousel = { ...base, props: { ...(base.props as Record<string, unknown>), products: items } as Section['props'] };
    out = [...sections.slice(0, at), carousel, ...sections.slice(at)];
  }
  return out.map((s, i) => ({ ...s, order: i }));
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/**
 * (순수) 한 줄의 할인율 · 가격과 몰 값이 다를 때의 안내(결과 화면 한 줄 · 잠금 아님).
 * 카드 = 몰 값 · 한 줄의 % = 혜택 문구라 결과는 같다 — 사람이 알아차리게만 한다. 같으면 0줄.
 */
export function linePriceNotes(line: string, cards: readonly LineMallCard[]): string[] {
  if (cards.length === 0) return [];
  const notes: string[] = [];
  const pcts = lineBenefitPercents(line);
  if (pcts.length > 0) {
    const rates = cards.map((c) => (c.discount_price && c.price > c.discount_price ? Math.round((1 - c.discount_price / c.price) * 100) : 0));
    const typed = pcts.map((p) => `${p}%`).join('·');
    if (rates.every((r) => r === 0)) {
      notes.push(`몰 판매가에는 적어 주신 할인(${typed})이 반영돼 있지 않아요. 쿠폰이나 추가 할인이면 그대로 두셔도 돼요`);
    } else {
      const differ = Array.from(new Set(rates.filter((r) => r > 0 && !pcts.includes(r))));
      if (differ.length > 0) notes.push(`적어 주신 할인율(${typed})과 몰 할인율(${differ.map((r) => `${r}%`).join('·')})이 달라요. 상품 가격은 몰 판매가 그대로 실었어요`);
    }
  }
  const amounts = lineMoneyAmounts(line);
  if (amounts.length > 0) {
    const prices = new Set<number>();
    for (const c of cards) { prices.add(c.price); if (c.discount_price) prices.add(c.discount_price); }
    if (!amounts.some((a) => prices.has(a))) notes.push(`한 줄의 가격(${won(amounts[0])})과 몰 가격이 달라요. 상품 카드는 몰 가격으로 실었어요`);
  }
  return notes;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** (순수) 회사가 **저장한** 주색이 흰 글자와 읽히는 색이면 그 값(보정 포함) · 없거나 못 쓰는 색 = null(오늘과 같게 둔다). */
export function linePinnedPrimary(companyRaw: Record<string, unknown> | null | undefined): string | null {
  const raw = companyRaw && typeof companyRaw.primary_color === 'string' ? companyRaw.primary_color : null;
  return raw ? accessiblePrimaryOf(raw) : null;
}

/**
 * (순수) 한 줄 DM brand_kit = 회사 저장 킷 + AI tone · art_direction(회사 저장값이 이긴다) + 고정 주색.
 * 회사가 저장한 킷이 없으면 AI 킷 그대로(오늘과 같다). 회사 원본 주색은 싣지 않는다(흰 · 연한 색 CTA 재발 방지 · 고정값만).
 */
export function mergeLineBrandKit(
  companyRaw: Record<string, unknown> | null | undefined,
  aiKit: Record<string, unknown>,
  pinned: string | null,
): Record<string, unknown> {
  if (!companyRaw) return pinned ? { ...aiKit, primary_color: pinned } : { ...aiKit };
  const { primary_color: _drop, ...company } = companyRaw;
  const out: Record<string, unknown> = {
    ...aiKit,
    ...company,
    art_direction: { ...(isObj(aiKit.art_direction) ? aiKit.art_direction : {}), ...(isObj(companyRaw.art_direction) ? companyRaw.art_direction : {}) },
  };
  if (pinned) out.primary_color = pinned;
  return out;
}

/** (순수) 한 줄 이메일 design = 고정 주색 + 회사 저장 아트디렉션(없으면 업종 기본) + 프리헤더. */
export function lineEmailDesign(input: {
  pinned: string | null;
  companyArtDirection: unknown;
  industry: string | null;
  preheader: string | null;
}): EmailDesign | null {
  const ad = isObj(input.companyArtDirection) && Object.keys(input.companyArtDirection).length > 0
    ? input.companyArtDirection
    : outreachArtDirection(input.industry);
  return normalizeEmailDesign({
    ...(input.pinned ? { palette: { primary: input.pinned } } : {}),
    art_direction: ad,
    ...(input.preheader ? { preheader: input.preheader } : {}),
  });
}
