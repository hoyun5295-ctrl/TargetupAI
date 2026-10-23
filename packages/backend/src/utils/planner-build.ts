/**
 * planner-build.ts — 플래너 재료 → 완성본(모바일 DM · 메일) 생성 CT (★ 2026-10-04 보강 B2 · 설계서 §5-2 · §6-2 · Q1)
 *
 * 담당자가 행사에 모바일 DM·메일을 고르면 재료(사진·글·몰 상품)를 넣고 [담고 만들기]를 누른다. 그 한 번이
 * **만들기 화면과 같은 AI 자동제작 엔진**(`generateFromBuildMaterials`)을 부른다 — 플래너 전용 생성기를 두지 않는다
 * (옛 oneShotGenerate·generateEmailSections 빈 자리 초안 폐기 · 설계서 §1 구조 사실).
 *
 * ⛔ 불변
 *   - **생성은 사람 클릭으로만**(§3-3). 워커는 이 파일을 부르지 않는다 — 엔진의 금액 결박(expectedTotal)이 전제하는
 *     "금액을 본 사람"을 지킨다. 견적(`quotePlannerBuild`)과 생성이 같은 재료 조립 함수를 쓴다(화면 금액 = 차감 금액).
 *   - **혜택은 고객사 기입 verbatim**(§3-5) — 행사 행 원본(행사명 · 기간 · 혜택)으로 서버가 첫 카드를 "그대로 쓰기"로 고정 조립한다.
 *     화면이 보낸 행사 정보는 쓰지 않는다(재료 카드에는 담당자 사진·글만).
 *   - 돈 단위 = 화면이 누를 때마다 만든 시도 토큰(엔진 계약 그대로 · 같은 토큰 재시도 = 재차감 0).
 *     **같은 토큰으로 이미 붙은 완성본이 있으면 엔진을 다시 부르지 않고 그것을 돌려준다**(재시도 고아 0 · §6-2).
 *   - 회사 단위 동시 생성 잠금은 만들기 화면과 같은 키(엔진 계약 · 같은 회사가 동시에 두 개를 만들지 않는다).
 *   - 완성본은 그 채널의 승인 전 접점(planned)에 붙인다. 승인 뒤에는 다시 만들 수 없다(읽기 전용 · F10).
 */
import { createHash } from 'crypto';
import { generateFromBuildMaterials, quoteFromBuildMaterials, defaultBuildDeps, readableCustomerBrandKit, type BuildDeps } from './campaign-quick';
import {
  buildInflightKey, aiAutoBuildEnabled, AI_AUTO_BUILD_CARD_IMAGES, buildIdempotencyKey, mallProductNoOf, resolveBuildProducts,
  type BuildMallLookup, type BuildMallProvider, type BuildProduct,
} from './ai-auto-build-materials';
import { tryAcquireInflight, releaseInflight } from './inflight-lock';
import { query } from '../config/database';
import {
  PlannerEventRow, PlannerMaterials, loadPlannerEvent, patchEventMeta, plannerBuildInputHash, isEventEditable,
} from './planner-event';
import { checkChannelReadiness } from './planner-channel-gate';
import { InsufficientCreditError, isChargedByKey } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { runInCreditBundle } from './ai-credit-context';
import { getLineTemplate, type LineTemplate } from './design-core/line-templates';
import { draftLineTemplate, buildLineTemplateDm, buildLineTemplateEmail, lineTemplateBrand, lineTemplateDmMarker } from './line-template-run';
import { getLineComposition, draftLineCook, buildLineCookDm, buildLineCookEmail, lineCompositionDmMarker } from './one-line-ct';
import { diagnoseComposition, diagnosisBlocking, compositionChannelSlots, type LineComposition, type LineRichMaterials } from './line-compositions';
import { linePinnedPrimary, mergeLineBrandKit, lineEmailDesign, type LineMallCard } from './line-mall-cards';
import { resolveLinePage, isLinePageError } from './line-template-page';
import { lineStepsCollected } from './line-steps-context';
import { getCompanyBrandKitRaw } from './dm/dm-brand-kit';
import { pagesFromSectionGroups } from './dm/dm-builder';

export class PlannerBuildError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
    this.name = 'PlannerBuildError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** (순수) 'YYYY-MM-DD' → 'YYYY.MM.DD' — 연도가 있는 날짜라 엔진이 카운트다운 종료일로 읽을 수 있다. */
function dotted(d: string): string {
  return d.replace(/-/g, '.');
}

/**
 * (순수) 엔진 재료 v1 조립 — 견적과 생성이 같은 함수를 쓴다.
 *  카드1 = 행사 원본(행사명 · 혜택 · 기간)을 "그대로 쓰기"로 고정 + 담당자 사진(첫 사진 = 첫 화면)
 *  카드2 = 담당자 글(있으면 · 담당자가 고른 "이 문구 그대로 쓰기" 그대로)
 *  상품 = 재료의 몰/글줄 상품 · 메일은 광고 표시를 서버가 강제한다(§6-2).
 */
export function buildPlannerEngineMaterials(
  ev: Pick<PlannerEventRow, 'title' | 'benefitText' | 'startsOn' | 'endsOn'>,
  materials: PlannerMaterials,
  channel: 'dm' | 'email',
  attemptToken: string,
  expectedTotal: number,
): Record<string, unknown> {
  const period = ev.startsOn === ev.endsOn ? `기간 ${dotted(ev.startsOn)} 하루` : `기간 ${dotted(ev.startsOn)} ~ ${dotted(ev.endsOn)}`;
  const factLines = [String(ev.benefitText || '').trim(), period].filter(Boolean);
  const cards: Array<Record<string, unknown>> = [{
    id: 'planner-event',
    title: ev.title,
    text: factLines.join('\n'),
    link: null,
    licensed: true,
    images: materials.images.slice(0, AI_AUTO_BUILD_CARD_IMAGES).map((im) => ({ url: im.url, width: im.width, height: im.height })),
  }];
  const text = materials.text.trim();
  if (text) {
    const first = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
    cards.push({ id: 'planner-board', title: first.slice(0, 40), text, link: null, licensed: materials.licensed, images: [] });
  }
  return {
    version: 1,
    attemptToken,
    expectedTotal,
    channel,
    isAd: channel === 'email' ? true : null,
    eventCards: cards,
    products: materials.products.map((p) => ({
      source: p.source, provider: p.provider, code: p.code, name: p.name,
      price: p.price, salePrice: p.salePrice, discountRate: p.discountRate, url: p.url, imageUrl: p.imageUrl,
    })),
    features: null,
    brandName: null,
    catalogImages: [],
    catalogTitle: null,
  };
}

// ── ★ 2026-10-18 v2-1 템플릿 완성본(설계서 docs/2026-10-18-planner-v2-design.md §3-4) ─────────────────────
// 조립 = 1017 함수 그대로(draftLineTemplate · buildLineTemplateDm/Email) · 저장 · 차감 · 회수 = 엔진 부품 그대로(BuildDeps · quick: 키) ·
// 문구 = AI 1회(크레딧 묶음 · 원가 0) · AI 근거에서 혜택 · 기간 · 페이지 글을 뺀다(factsOnly) → 혜택 원문 · 마감 · 행사명은 코드가 놓는다.
// 돈 = 기존 키(DM 5 · 메일 3) · 한 줄 완성 10 없음 · 새 키 0. 스위치 = 자동제작 + 한 줄 단계 + 템플릿(1017 스위치 그대로 · 밖이면 400).

/** 이 회사에서 플래너 템플릿 완성본을 만들 수 있는가(1017 스위치 그대로 · 자동제작 엔진 개방 안에서) */
export function plannerTemplatesEnabled(companyId: string): boolean {
  return aiAutoBuildEnabled(companyId);
}

/** ★ 2026-10-22 플래너 완성본 틀 = 옛 템플릿 4종 또는 한줄 CT 구성 5종(설계서 docs/2026-10-22-oneline-ct-design.md §5 · C4) */
export type PlannerTemplateDef = { kind: 'tpl'; t: LineTemplate } | { kind: 'comp'; comp: LineComposition };
export function plannerTemplateDef(id: unknown): PlannerTemplateDef | null {
  const t = getLineTemplate(id);
  if (t) return { kind: 'tpl', t };
  const comp = getLineComposition(id);
  return comp ? { kind: 'comp', comp } : null;
}
/** (순수) 옛 템플릿이 정한 상품 최소 · 혜택 필수(구성 5종 = ③ 진단 `diagnoseComposition` 한 곳) */
function plannerNeeds(t: LineTemplate): { productsMin: number; benefitRequired: boolean } {
  return { productsMin: t.needs.products.min, benefitRequired: t.needs.benefit === 'required' };
}

/** 구성 막는 칸 → 플래너 빠진 재료 키(화면 문구 표와 같은 이름) */
const PLANNER_SLOT_KEY: Partial<Record<keyof LineRichMaterials, string>> = { products: 'product_photos', mood: 'photos', benefit: 'benefit', periodEnd: 'period' };

/**
 * (순수) 플래너 구성 재료(★ 2026-10-23 진단 한 곳 · A1) — 견적 · 생성 관문이 요리와 같은 진단을 쓴다.
 *   상품 = 사진 있는 몰 상품(구성은 사진 없는 상품을 싣지 않는다) · 첫 사진 = 첫 화면 · 나머지 = 분위기 사진 · 마감 = 행사 마지막 날.
 */
export function plannerCompositionMaterials(ev: Pick<PlannerEventRow, 'benefitText' | 'endsOn'>, m: PlannerMaterials): LineRichMaterials {
  const ph = plannerCompositionPhotos(m);
  return {
    brandName: '', poster: ph.hero ? { url: ph.hero } : null,
    products: m.products.filter((p) => p.source === 'mall' && !!p.imageUrl).map((p) => ({ name: p.name, price: p.price ?? null, image_url: String(p.imageUrl) })),
    points: [], steps: [], mood: ph.mood, proof: [],
    benefit: String(ev.benefitText || '').trim() || null, periodEnd: ev.endsOn || null, periodLabel: null, link: m.link || null,
  };
}

/**
 * (순수) 플래너 구성 재료 — 올린 첫 사진 = 첫 화면 · 나머지 = 분위기 사진(★ 2026-10-22 · Codex CT R1 · 룩북 · 메뉴판 사진 구역이 비던 구멍).
 *   구성 상품은 사진이 있어야 실린다(몰 상품 사진 · 플래너 직접 상품은 사진 칸이 없다) → 견적 · 생성이 같은 셈을 쓴다.
 */
export function plannerCompositionPhotos(m: PlannerMaterials): { hero: string | null; mood: string[]; productsWithPhoto: number } {
  const urls = m.images.map((x) => x.url).filter(Boolean);
  return {
    hero: urls[0] ?? null,
    mood: urls.slice(1, 4),
    productsWithPhoto: m.products.filter((p) => p.source === 'mall' && !!p.imageUrl).length,
  };
}

/** (순수) 템플릿이 정한 필수 재료 — 버튼 주소(빈 주소 = 발행 때 막힌다) · 상품 최소 · 혜택 필수 · (구성) 사진 있는 상품 · 분위기 사진. 빈 배열 = 통과. */
export function plannerTemplateMissing(t: LineTemplate | PlannerTemplateDef, ev: Pick<PlannerEventRow, 'benefitText'> & Partial<Pick<PlannerEventRow, 'endsOn'>>, m: PlannerMaterials, channel: 'dm' | 'email' = 'dm'): string[] {
  const d: PlannerTemplateDef = 'kind' in t ? t : { kind: 'tpl', t };
  const missing: string[] = [];
  if (!m.link) missing.push('link');
  if (d.kind === 'comp') {
    for (const s of diagnosisBlocking(diagnoseComposition(d.comp, plannerCompositionMaterials({ benefitText: ev.benefitText, endsOn: ev.endsOn ?? '' }, m), channel))) {
      const k = PLANNER_SLOT_KEY[s.key];
      if (k && !missing.includes(k)) missing.push(k);
    }
    return missing;
  }
  const need = plannerNeeds(d.t);
  if (m.products.length < need.productsMin) missing.push('products');
  if (need.benefitRequired && !String(ev.benefitText || '').trim()) missing.push('benefit');
  return missing;
}

/** (순수) 구성 막는 칸의 최소 개수(빠진 재료 문장 · 재조회 뒤 다시 보기) */
function plannerSlotMin(comp: LineComposition, channel: 'dm' | 'email', key: keyof LineRichMaterials): number {
  return compositionChannelSlots(comp, channel).find((s) => s.key === key && s.level === 'block')?.min ?? 0;
}

/** (순수) 템플릿 견적 — 엔진과 같은 키 · 같은 단가(판독 0) · 크레딧제 미적용 = 0 */
export function plannerTemplateQuote(channel: 'dm' | 'email', creditEnabled: boolean): { total: number; parts: Array<{ key: string; label: string; cost: number }> } {
  const key = channel === 'email' ? 'email-ai-generate' : 'dm-ai-generate';
  const cost = creditEnabled ? getCreditCost(key) : 0;
  return { total: cost, parts: [{ key, label: channel === 'email' ? '이메일 생성' : '모바일 DM 생성', cost }] };
}

/** (순수) 템플릿 과금 지문 — 생성 결과에 닿는 입력 전부(템플릿 · 배치 · 재료 지문 · 행사 사실 · 채널) · 같은 시도 같은 입력 = 같은 키 */
export function plannerTemplateBillingHash(ev: Pick<PlannerEventRow, 'title' | 'startsOn' | 'endsOn' | 'benefitText'>, m: PlannerMaterials, channel: 'dm' | 'email'): string {
  return createHash('sha256').update(JSON.stringify(['planner-template', channel, m.template?.id, m.template?.layout, plannerBuildInputHash(ev, m)])).digest('hex');
}

/**
 * (순수) 재조회 결과 → 템플릿 상품. 사진 있는 상품 = 카드(엔진 병합 그대로 · 품절 제외) · 그 밖 = 글 상품(이름 · 가격 그대로).
 * 카드가 된 몰 상품(상품번호)과 같은 이름의 카드는 글 상품으로 다시 싣지 않는다.
 */
export function plannerTemplateProducts(products: readonly BuildProduct[], lookups: Record<string, BuildMallLookup | undefined>): { cards: LineMallCard[]; textProducts: Array<{ name: string; price?: number }> } {
  const resolved = resolveBuildProducts(products, lookups);
  const cards: LineMallCard[] = resolved.cards.map((c) => ({
    name: c.name, price: c.price ?? 0, ...(c.discount_price ? { discount_price: c.discount_price } : {}), image_url: c.image_url, ...(c.link_url ? { link_url: c.link_url } : {}),
  }));
  const excluded = new Set(resolved.excluded.map((e) => e.code));
  const carded = new Set(resolved.cards.map((c) => (c.code ? `code:${c.code}` : `name:${c.name}`)));
  const textProducts: Array<{ name: string; price?: number }> = [];
  for (const p of products) {
    const no = mallProductNoOf(p);
    if (p.source === 'mall' && no && excluded.has(no)) continue;
    if ((no && carded.has(`code:${no}`)) || carded.has(`name:${p.name}`)) continue;
    if (textProducts.some((x) => x.name === p.name)) continue;
    const price = p.salePrice ?? p.price;
    textProducts.push(price ? { name: p.name, price } : { name: p.name });
  }
  return { cards, textProducts };
}

/**
 * 템플릿 완성본 1채널 — 엔진과 같은 돈 순서: 재료 게이트 → 견적 결박(409) → 몰 재조회 → 잔액(402) → 문구 AI(묶음 안) → 조립 · 품질 관문 →
 * 초안 행 → 차감(원장 호출이 던지면 행을 거둔다 · 낸 결말만 건넨다 · 그 밖은 행을 거두고 503).
 */
export async function buildPlannerTemplateChannel(input: {
  ev: PlannerEventRow;
  materials: PlannerMaterials;
  channel: 'dm' | 'email';
  token: string;
  expectedTotal: number;
  userId: string | null;
}, deps: BuildDeps = defaultBuildDeps()): Promise<{ draftId: string; deductOutcome: string }> {
  const { ev, materials, channel } = input;
  const def = plannerTemplateDef(materials.template?.id);
  if (!def || !materials.template) throw new PlannerBuildError(400, 'TEMPLATE_INVALID', '고른 템플릿을 찾지 못했어요. 템플릿을 다시 골라 주세요.');
  const productsMin = def.kind === 'comp' ? plannerSlotMin(def.comp, channel, 'products') : plannerNeeds(def.t).productsMin;
  const missing = plannerTemplateMissing(def, ev, materials, channel);
  if (missing.length > 0) {
    throw new PlannerBuildError(400, 'MATERIAL_THIN', missing.includes('link') ? '버튼을 누르면 갈 행사 페이지 주소를 넣어 주세요.'
      : missing.includes('products') ? `이 템플릿은 상품이 ${Math.max(1, productsMin)}개 이상 있어야 해요.`
        : missing.includes('product_photos') ? `이 구성은 사진 있는 몰 상품이 ${Math.max(1, productsMin)}개 이상 있어야 해요.`
          : missing.includes('photos') && def.kind === 'comp' ? `이 구성은 첫 화면 사진 말고도 사진이 ${plannerSlotMin(def.comp, channel, 'mood')}장 더 있어야 해요.`
            : missing.includes('period') ? '행사 마지막 날을 정해 주세요.'
              : '이 템플릿은 혜택을 적어야 해요.', { missing });
  }
  let creditEnabled: boolean;
  try { creditEnabled = await deps.creditEnabled(ev.companyId); } catch {
    throw new PlannerBuildError(503, 'CREDIT_LOOKUP_UNAVAILABLE', '크레딧 잔액을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  const quote = plannerTemplateQuote(channel, creditEnabled);
  if (quote.total !== (Number(input.expectedTotal) || 0)) throw new PlannerBuildError(409, 'QUOTE_CHANGED', '견적이 바뀌었어요. 금액을 다시 확인하고 눌러 주세요.', { quote });
  // 몰 재조회(엔진 부품) — 장애 = "가격 확인 못함"으로 접는다(생성 계속)
  const products = materials.products as unknown as BuildProduct[];
  const byProvider = new Map<BuildMallProvider, string[]>();
  for (const p of products) {
    const no = mallProductNoOf(p);
    if (p.source !== 'mall' || !p.provider || !no) continue;
    byProvider.set(p.provider as BuildMallProvider, [...(byProvider.get(p.provider as BuildMallProvider) || []), no]);
  }
  const lookups: Record<string, BuildMallLookup> = {};
  for (const [provider, nos] of byProvider) {
    lookups[provider] = await deps.lookupMall(ev.companyId, provider, Array.from(new Set(nos))).catch(() => ({ failed: true, byCode: {} }));
  }
  const goods = plannerTemplateProducts(products, lookups);
  // ★ Codex B 1R — 재조회 뒤 실제로 실릴 상품 수로 필수 재료를 다시 본다(유일한 상품이 품절로 빠지면 상품 없는 완성본에 생성비가 나간다 · AI · 저장 · 차감 전에 막는다)
  if ((def.kind === 'comp' ? goods.cards.length : goods.cards.length + goods.textProducts.length) < productsMin) {
    throw new PlannerBuildError(400, 'MATERIAL_THIN', '고른 상품이 품절이거나 몰에서 확인되지 않아 이 템플릿을 만들 수 없어요. 상품을 다시 골라 주세요.', { missing: ['products'] });
  }
  // ★ Codex B 1R — 같은 시도가 이미 냈으면(차감 뒤 접점 연결 · 기록이 실패한 재시도) 잔액을 다시 보지 않는다 — 차감은 같은 키 = 중복 0 ·
  //   옛: 잔액을 다 쓴 고객은 이미 낸 완성본을 행사에 되붙이지 못했다. 조회 실패 = 안 낸 것으로(잔액 검사를 한다 · 넓히지 않는다).
  const idempotencyKey = buildIdempotencyKey(ev.companyId, channel, input.token, plannerTemplateBillingHash(ev, materials, channel));
  const alreadyPaid = await isChargedByKey(ev.companyId, idempotencyKey).catch(() => false);
  if (!alreadyPaid) {
    try {
      await deps.checkCredit(ev.companyId, quote.total);
    } catch (err: any) {
      if (err instanceof InsufficientCreditError) throw err;
      throw new PlannerBuildError(503, 'CREDIT_LOOKUP_UNAVAILABLE', '크레딧 잔액을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }
  // 표지 사진 = 올린 첫 사진 → 행사 페이지 표지(읽기 실패 = 사진 없이 · 막지 않는다 · AI 0 · 0원)
  let hero: string | null = materials.images[0]?.url || null;
  if (!hero && materials.link) {
    const pg = await resolveLinePage(ev.companyId, { url: materials.link, licensedHashes: [] }).catch(() => null);
    if (pg && !isLinePageError(pg)) hero = pg.banner;
  }
  const kitRaw = (await getCompanyBrandKitRaw(ev.companyId).catch(() => null)) as Record<string, unknown> | null;
  const brand = await lineTemplateBrand(ev.companyId, kitRaw);
  const pinned = linePinnedPrimary(kitRaw);
  const genKey = channel === 'email' ? 'email-ai-generate' : 'dm-ai-generate';
  // ★ 2026-10-22 구성 5종 = 한줄 CT 요리(문구 AI 1회 · 값 = 코드 · 표지 아래 큰 제목 = 행사명) · 옛 템플릿 = 1018 그대로
  const cook = def.kind === 'comp'
    ? await runInCreditBundle(() => draftLineCook({
      composition: def.comp, channel, companyId: ev.companyId, line: ev.title, ...brand, brandName: brand.brandName,
      pinnedPrimary: pinned, cards: goods.cards, heroUpload: hero, heroAsIs: false, proof: [], page: null,
      benefitAnswer: String(ev.benefitText || '').trim() || null, periodEnd: ev.endsOn, link: materials.link || null,
      rich: { points: [], usage: [], mood: plannerCompositionPhotos(materials).mood, couponCode: null, store: null, benefitNote: null, categories: [] },
    }, { userId: input.userId || undefined, source: genKey }))
    : null;
  if (cook && ev.title.trim().length <= 20) cook.copy.headline = ev.title.trim();
  const draft = def.kind === 'tpl' ? await runInCreditBundle(() => draftLineTemplate({
    template: def.t, channel, companyId: ev.companyId, line: ev.title, ...brand, brandName: brand.brandName,
    pinnedPrimary: pinned, cards: goods.cards, textProducts: goods.textProducts, heroUpload: hero, page: null,
    benefitAnswer: String(ev.benefitText || '').trim() || null, periodEnd: ev.endsOn, link: materials.link || null,
  }, { userId: input.userId || undefined, source: genKey }, { factsOnly: true })) : null;
  // 행사명 = 코드가 표지 제목에(회의론자 4 · AI 문구 대신) · 기간 표시는 원문 종료일(lineTemplateMaterials 가 periodEnd 로 놓는다)
  if (draft) draft.materials.coverHeadline = ev.title;

  let draftId = '';
  if (channel === 'dm') {
    const dmR = cook
      ? (() => { const r = buildLineCookDm(cook); const slides = materials.template!.layout === 'slides' && r.pages.length >= 3; return { sections: r.sections, pages: (slides ? r.pages : [r.sections]).map((sections) => ({ sections })), layoutMode: slides ? 'slides' as const : 'scroll' as const, brandKitPatch: r.brandKitPatch }; })()
      : buildLineTemplateDm(draft!, materials.template.layout);
    const row = await deps.createDm(ev.companyId, input.userId || '', {
      title: ev.title.slice(0, 200), sections: dmR.sections, pages: pagesFromSectionGroups(dmR.pages.map((pg) => pg.sections)),
      layout_mode: dmR.layoutMode, brand_kit: mergeLineBrandKit(kitRaw, { ...dmR.brandKitPatch }, pinned),
      ai_prompt: ev.title.slice(0, 2000), approval_status: 'draft', template_id: def.kind === 'comp' ? lineCompositionDmMarker(def.comp.id) : lineTemplateDmMarker(def.t.id),
    });
    draftId = String(row.id);
  } else {
    const em = cook ? buildLineCookEmail(cook) : buildLineTemplateEmail(draft!);
    const basic = await deps.basicInfo(ev.companyId).catch(() => null);
    const design = lineEmailDesign({
      pinned: cook ? cook.comp.primary : draft!.t.design.primary, companyArtDirection: kitRaw?.art_direction ?? null,
      industry: String((basic as any)?.industry_code || '').trim() || null, preheader: em.preheader.slice(0, 90),
    });
    const brandKit = readableCustomerBrandKit(await deps.brandKit(ev.companyId));
    const rendered = deps.renderEmail(em.sections, brandKit, design || undefined);
    // 메일 제목 = 행사명(코드 · 템플릿 기본 제목의 시제가 예고 메일과 어긋나지 않게) · 광고 = 늘 켬(회의론자 4)
    const campaign = await deps.createEmail({
      companyId: ev.companyId, createdBy: input.userId || '', name: ev.title.slice(0, 60), subject: ev.title.slice(0, 60),
      htmlBody: rendered.html, textBody: rendered.text, isAd: true, aiGenerated: true, sections: em.sections, ...(design ? { design } : {}),
    } as any);
    draftId = String(campaign.id);
  }
  let outcome: string;
  try {
    outcome = await deps.deductOutcome({ companyId: ev.companyId, cost: getCreditCost(genKey), source: genKey, createdBy: input.userId || null, idempotencyKey, throwOnInsufficient: true });
  } catch (err) {
    await (channel === 'dm' ? deps.deleteDm(draftId, ev.companyId) : deps.deleteEmail(ev.companyId, draftId)).catch(() => false);
    throw err;
  }
  // 낸 결말(냄 · 같은 키 · 크레딧제 미적용 면제)만 건넨다(회의론자 3 · 1017 판정 재사용) · 그 밖 = 행을 거두고 다시 시도하게
  if (!lineStepsCollected(outcome as any)) {
    await (channel === 'dm' ? deps.deleteDm(draftId, ev.companyId) : deps.deleteEmail(ev.companyId, draftId)).catch(() => false);
    console.log(`[CREDIT][MISS] planner-template company=${ev.companyId} channel=${channel} key=${idempotencyKey} draft=${draftId} outcome=${outcome}`);
    throw new PlannerBuildError(503, 'CREDIT_STATE_UNKNOWN', '크레딧 기록을 확인하지 못해 만든 완성본을 거뒀어요. 잠시 후 다시 시도해 주세요.');
  }
  return { draftId, deductOutcome: outcome };
}

interface TouchpointLite { id: string; channel: string; status: string; asset_ref: string | null; exec_meta: Record<string, any> | null }

async function loadEventTouchpointsLite(companyId: string, eventId: string): Promise<TouchpointLite[]> {
  const r = await query(
    `SELECT id, channel, status, asset_ref, exec_meta FROM planner_touchpoints
      WHERE event_id = $1::uuid AND company_id = $2::uuid ORDER BY created_at ASC`,
    [eventId, companyId],
  );
  return r.rows as TouchpointLite[];
}

/** 재료를 쓸 수 있는가(행사 상태 · 채널 존재 · 준비 판정) — 견적·생성 공통 앞단. */
async function assertBuildable(ev: PlannerEventRow, channel: 'dm' | 'email', tps: TouchpointLite[]): Promise<void> {
  if (!isEventEditable(ev.status)) {
    throw new PlannerBuildError(409, 'NOT_EDITABLE', '승인한 행사는 다시 만들 수 없습니다. 바꾸려면 먼저 승인을 풀어 주세요.');
  }
  if (!tps.some((t) => t.channel === channel && t.status === 'planned')) {
    throw new PlannerBuildError(400, 'CHANNEL_NOT_IN_EVENT', channel === 'dm' ? '이 행사에 모바일 DM이 없습니다.' : '이 행사에 메일이 없습니다.');
  }
  const readiness = await checkChannelReadiness(channel, { companyId: ev.companyId, userId: ev.createdBy, phase: 'plan' });
  if (!readiness.ok) {
    throw new PlannerBuildError(400, 'CHANNEL_LOCKED', readiness.reason || '지금은 이 채널을 만들 수 없습니다.', { settingsPath: readiness.settingsPath });
  }
}

export interface PlannerBuildQuote {
  channel: 'dm' | 'email';
  total: number;
  parts: Array<{ key: string; label: string; cost: number }>;
  gate: { ok: boolean; missing?: string[] };
  creditEnabled: boolean;
}

/** 견적 — 생성과 같은 재료 조립 · 같은 엔진 견적 함수(단일 출처). 차감·AI·초안 0. */
export async function quotePlannerBuild(input: { companyId: string; eventId: string; ownerId: string | null; channels: Array<'dm' | 'email'> }): Promise<PlannerBuildQuote[]> {
  const ev = await loadPlannerEvent(input.companyId, input.eventId, input.ownerId);
  if (!ev) throw new PlannerBuildError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  if (!aiAutoBuildEnabled(ev.companyId)) throw new PlannerBuildError(403, 'FEATURE_DISABLED', '재료로 완성본을 만드는 기능이 아직 열리지 않았습니다.');
  const materials = ev.meta.materials;
  if (!materials) throw new PlannerBuildError(400, 'MATERIALS_EMPTY', '먼저 재료를 넣어 주세요.');
  const tps = await loadEventTouchpointsLite(ev.companyId, ev.id);
  const out: PlannerBuildQuote[] = [];
  for (const channel of Array.from(new Set(input.channels))) {
    await assertBuildable(ev, channel, tps);
    // ★ 2026-10-18 템플릿을 고른 행사 = 템플릿 견적(같은 키 · 같은 단가) · 스위치 밖이면 400(옛 엔진으로 몰래 바꾸지 않는다)
    if (materials.template) { out.push(await quotePlannerTemplate(ev, materials, channel)); continue; }
    // 견적은 토큰 값과 무관하다(엔진 계약) — 형식만 맞춘 값을 넣는다.
    const q = await quoteFromBuildMaterials({
      companyId: ev.companyId,
      materials: buildPlannerEngineMaterials(ev, materials, channel, QUOTE_TOKEN, 0),
    });
    out.push({ channel, total: q.quote.total, parts: q.quote.parts, gate: q.gate as any, creditEnabled: q.creditEnabled });
  }
  return out;
}

/** ★ 2026-10-18 템플릿 견적(저장 전 · 저장 뒤 공통) — 스위치 · 필수 재료 · 엔진과 같은 키의 금액 */
async function quotePlannerTemplate(ev: Pick<PlannerEventRow, 'companyId' | 'benefitText'> & Partial<Pick<PlannerEventRow, 'endsOn'>>, materials: PlannerMaterials, channel: 'dm' | 'email'): Promise<PlannerBuildQuote> {
  if (!plannerTemplatesEnabled(ev.companyId)) throw new PlannerBuildError(400, 'TEMPLATE_DISABLED', '템플릿 완성본은 아직 이 회사에 열리지 않았어요. 템플릿 없이 담아 주세요.');
  const t = plannerTemplateDef(materials.template?.id);
  if (!t) throw new PlannerBuildError(400, 'TEMPLATE_INVALID', '고른 템플릿을 찾지 못했어요. 템플릿을 다시 골라 주세요.');
  let creditEnabled: boolean;
  try { creditEnabled = await defaultBuildDeps().creditEnabled(ev.companyId); } catch {
    throw new PlannerBuildError(503, 'CREDIT_LOOKUP_UNAVAILABLE', '크레딧 잔액을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  const q = plannerTemplateQuote(channel, creditEnabled);
  const missing = plannerTemplateMissing(t, ev, materials, channel);
  return { channel, total: q.total, parts: q.parts, gate: missing.length === 0 ? { ok: true } : { ok: false, missing }, creditEnabled };
}

/** 견적 토큰(엔진 계약상 금액과 무관 · 형식만) */
const QUOTE_TOKEN = '00000000-0000-4000-8000-000000000000';

/**
 * 담기 전 견적 — 기입 창 버튼 금액([담고 만들기 · N크레딧])을 저장 전에도 서버가 정한다(§5-2 · 화면 금액 = 서버 견적).
 * 저장하지 않는다 · 차감·AI·초안 0. 생성은 저장 뒤 행사 행 원본으로 다시 조립하므로 여기 값은 표시 근거일 뿐이다
 * (화면은 저장 뒤 행사 견적과 다르면 금액 확인 창을 띄운다).
 */
export async function quotePlannerDraft(input: {
  companyId: string;
  userId: string | null;
  draft: { title: string; startsOn: string; endsOn: string; benefitText: string | null };
  materials: PlannerMaterials;
  channels: Array<'dm' | 'email'>;
}): Promise<PlannerBuildQuote[]> {
  if (!aiAutoBuildEnabled(input.companyId)) throw new PlannerBuildError(403, 'FEATURE_DISABLED', '재료로 완성본을 만드는 기능이 아직 열리지 않았습니다.');
  const out: PlannerBuildQuote[] = [];
  for (const channel of Array.from(new Set(input.channels))) {
    const readiness = await checkChannelReadiness(channel, { companyId: input.companyId, userId: input.userId, phase: 'plan' });
    if (!readiness.ok) {
      throw new PlannerBuildError(400, 'CHANNEL_LOCKED', readiness.reason || '지금은 이 채널을 만들 수 없습니다.', { settingsPath: readiness.settingsPath, channel });
    }
    if (input.materials.template) { out.push(await quotePlannerTemplate({ companyId: input.companyId, benefitText: input.draft.benefitText, endsOn: input.draft.endsOn }, input.materials, channel)); continue; }
    const q = await quoteFromBuildMaterials({
      companyId: input.companyId,
      materials: buildPlannerEngineMaterials(input.draft, input.materials, channel, QUOTE_TOKEN, 0),
    });
    out.push({ channel, total: q.quote.total, parts: q.quote.parts, gate: q.gate as any, creditEnabled: q.creditEnabled });
  }
  return out;
}

export interface PlannerBuildResult {
  channel: 'dm' | 'email';
  draftId: string;
  reused: boolean;
  deductOutcome: string | null;
}

/**
 * 생성 — 사람이 [담고 만들기]를 눌렀을 때만(라우트가 부른다). 순서:
 *   행사·채널·준비 판정 → 같은 토큰 완성본 있으면 그대로 → 회사 잠금 → building 표식 → 엔진 → 접점에 붙임 → 생성 기록 → 표식 해제.
 * 엔진 오류(AiAutoBuildError · 잔액 부족)는 그대로 던진다 — 라우트가 엔진 라우트와 같은 매핑으로 답한다.
 */
export async function runPlannerBuild(input: {
  companyId: string;
  userId: string | null;
  ownerId: string | null;
  eventId: string;
  channel: 'dm' | 'email';
  attemptToken: string;
  expectedTotal: number;
}): Promise<PlannerBuildResult> {
  const token = String(input.attemptToken || '').toLowerCase();
  if (!UUID_RE.test(token)) throw new PlannerBuildError(400, 'BAD_TOKEN', '요청 형식이 맞지 않아요. 화면을 새로고침한 뒤 다시 시도해 주세요.');
  const ev = await loadPlannerEvent(input.companyId, input.eventId, input.ownerId);
  if (!ev) throw new PlannerBuildError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  if (!aiAutoBuildEnabled(ev.companyId)) throw new PlannerBuildError(403, 'FEATURE_DISABLED', '재료로 완성본을 만드는 기능이 아직 열리지 않았습니다.');
  const materials = ev.meta.materials;
  if (!materials) throw new PlannerBuildError(400, 'MATERIALS_EMPTY', '먼저 재료를 넣어 주세요.');
  const tps = await loadEventTouchpointsLite(ev.companyId, ev.id);
  await assertBuildable(ev, input.channel, tps);

  // 같은 토큰으로 이미 붙었다(재시도·더블클릭) — 엔진을 다시 부르지 않는다(초안 행 고아 0 · 재차감 0).
  const prior = ev.meta.build?.[input.channel];
  if (prior && prior.token === token && tps.some((t) => t.channel === input.channel && t.asset_ref === prior.draftId)) {
    return { channel: input.channel, draftId: prior.draftId, reused: true, deductOutcome: null };
  }

  const lockKey = buildInflightKey(ev.companyId);
  if (!tryAcquireInflight(lockKey)) {
    throw new PlannerBuildError(409, 'IN_FLIGHT', '지금 만드는 중이에요. 완성되면 이어서 진행해 주세요.');
  }
  // ★ 2026-10-04 Codex 1R H8 — "만드는 중" 표식은 안내가 아니라 **잠금**이다(조건부 한 문장). 승인 · 고치기 · 지우기가 이 표식을 보고 멈추고,
  //   그 사이 승인됐으면(고칠 수 없는 상태) 여기서 멈춘다 → 엔진을 부르지 않는다(생성비 0).
  const marked = await query(
    `UPDATE planner_events
        SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('building', jsonb_build_object('channels', jsonb_build_array($3::text), 'at', to_jsonb(NOW())))
      WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('draft', 'briefed', 're_brief')
        AND (meta->'building' IS NULL OR jsonb_typeof(meta->'building') <> 'object'
             OR (meta->'building'->>'at')::timestamptz < NOW() - interval '10 minutes')
        -- ★ Codex 2R H8 — 읽은 입력이 그대로일 때만(그 사이 저장이 재료·채널을 바꿨으면 리비전이 올랐다 · 붙일 접점이 없으면 만들지 않는다)
        AND COALESCE((meta->>'revision')::int, 0) = $4
        AND EXISTS (SELECT 1 FROM planner_touchpoints t
                     WHERE t.event_id = planner_events.id AND t.company_id = planner_events.company_id
                       AND t.channel = $3 AND t.status = 'planned')
      RETURNING id`,
    [ev.id, ev.companyId, input.channel, Number(ev.meta.revision) || 0],
  ).catch((e: any) => { releaseInflight(lockKey); throw e; });
  if (marked.rows.length === 0) {
    releaseInflight(lockKey);
    throw new PlannerBuildError(409, 'IN_FLIGHT', '지금 만드는 중이거나 행사 상태가 바뀌었어요. 화면을 새로고침해 주세요.');
  }
  try {
    // ★ 2026-10-18 템플릿을 고른 행사 = 템플릿 완성본(1017 조립 · 엔진 부품) · 스위치 밖 = 400(옛 엔진으로 몰래 바꾸지 않는다)
    if (materials.template && !plannerTemplatesEnabled(ev.companyId)) {
      throw new PlannerBuildError(400, 'TEMPLATE_DISABLED', '템플릿 완성본은 아직 이 회사에 열리지 않았어요. 템플릿 없이 담아 주세요.');
    }
    const r = materials.template
      ? await buildPlannerTemplateChannel({ ev, materials, channel: input.channel, token, expectedTotal: Number(input.expectedTotal) || 0, userId: input.userId })
      : await generateFromBuildMaterials({
        companyId: ev.companyId,
        userId: input.userId,
        materials: buildPlannerEngineMaterials(ev, materials, input.channel, token, Number(input.expectedTotal) || 0),
        channel: input.channel,
      });
    // 승인 전 접점(planned)에만 붙인다 — 그 사이 승인된 행은 건드리지 않는다(효과로 판정).
    const attached = await query(
      `UPDATE planner_touchpoints
          SET asset_ref = $4::uuid,
              exec_meta = COALESCE(exec_meta, '{}'::jsonb) || jsonb_build_object('build_token', $5::text, 'built_at', to_jsonb(NOW()))
        WHERE event_id = $1::uuid AND company_id = $2::uuid AND channel = $3 AND status = 'planned'
        RETURNING id`,
      [ev.id, ev.companyId, input.channel, r.draftId, token],
    );
    if (attached.rows.length === 0) {
      console.warn(`[planner-build] 완성본을 붙일 접점이 없음(그 사이 승인·삭제) event=${ev.id} ch=${input.channel} draft=${r.draftId}`);
      throw new PlannerBuildError(409, 'STATE_CHANGED', '그 사이 행사 상태가 바뀌어 완성본을 붙이지 못했습니다. 화면을 새로고침해 주세요.');
    }
    // materialsHash = 완성본 입력 지문(재료 + 행사 사실 · plannerBuildInputHash) — 행사 사실만 고쳐도 낡은 완성본으로 본다
    const record = { token, draftId: r.draftId, materialsHash: plannerBuildInputHash(ev, materials), builtAt: new Date().toISOString() };
    // 확인 대기 중 다시 만들었다면 문안·확인 링크도 새로 — 행사를 재료 단계(draft)로 되돌리고 리비전을 올린다.
    // ★ 2026-10-18 채널 한 칸만 쓴다(회의론자 2 · 옛: build 통째 교체 = 앞서 만든 다른 채널 기록을 지울 수 있다)
    await patchEventMeta({
      companyId: ev.companyId,
      eventId: ev.id,
      buildRecord: { channel: input.channel, record },
      nullKeys: ['preview'],
      bumpRevision: true,
      status: 'draft',
      fromStatuses: ['draft', 'briefed', 're_brief'],
    });
    console.log(`[planner-build] 완성본 생성 event=${ev.id} ch=${input.channel} draft=${r.draftId} outcome=${r.deductOutcome}`);
    return { channel: input.channel, draftId: r.draftId, reused: false, deductOutcome: r.deductOutcome };
  } finally {
    releaseInflight(lockKey);
    await patchEventMeta({ companyId: ev.companyId, eventId: ev.id, nullKeys: ['building'] }).catch(() => null);
  }
}
