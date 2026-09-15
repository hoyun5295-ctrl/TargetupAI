/**
 * ★ 2026-09-06 S5 재료 입구(고객 체험) — 이미지 몇 장 + 행사 텍스트 → 아웃리치 엔진(결정 구간 공용)이 모바일 DM 초안을 조립한다.
 * 설계 = docs/2026-09-06-campaign-engine-design.md §7 (회의론자 12건 반영).
 *
 *  - 재료 사본 = DM 이미지 저장소(uploads/dm-images/{companyId} · dm.ts upload-image 와 같은 경로·같은 공개 서빙) · 라이브러리 등재 0.
 *    사본 회수 회차는 두지 않는다(DM 편집기 업로드 이미지와 같은 수명 · 화면 문구가 그렇게 말한다).
 *  - 텍스트가 비었을 때만 판독(vision · 3크레딧 · 성공 시만 · extractEventsFromImages 안에서 차감).
 *  - 면허 = origin 'user' 텍스트만. 판독본(origin 'vision')은 재료로만 쓰고 혜택 수치는 차단기가 걷는다(사용자가 편집·확정하면 다음 생성에서 user 로 승격).
 *  - 배치 규칙은 fillOutreachDmMedia 그대로(1장 = 히어로 · 2~5장 = 히어로 + 갤러리 2장 묶음 · 업로드 이미지는 상품 카드에 붙이지 않는다 · 이미지 없는 상품은 카드 금지 → 상품은 재료 텍스트로만).
 *  - 성공 직후 approval_status='draft' DM 1행 생성 → id 응답([DM 편집으로]가 같은 id) · 크레딧 = 기존 키 dm-ai-generate · 멱등키 quick:{draftId}.
 *  - ENV 회사 목록(CAMPAIGN_MATERIALS_COMPANY_IDS) = 노출 스위치 + 효과 함수 안 판정(비면 전 회사).
 *  - 발송·정산 무접촉 · 신규 크레딧 키 0 · 무료 회차 0.
 */
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createDm, deleteDm } from './dm/dm-builder';
import { getCompanyBrandKit } from './dm/dm-brand-kit';
import { getBrandBasicInfo } from './brand-basic-info';
import { getCreditCost } from './ai-credit-calc';
import { checkCredit, deductCreditSafe, deductCreditOutcome, getCreditState, InsufficientCreditError, type DeductOutcome } from './ai-credit';
import { loadPlanContext, canUseFeature } from './plan-guard';
import { normalizeEventText, EVENT_TEXT_MAX } from './event-brief';
import { extractEventsFromImages, sniffImageMediaType, MAX_EVENT_IMAGES, type ExtractedEvent } from './event-image-extract';
import { readImageSize } from './sales-outreach-media';
import { assembleDmCampaign, type EngineMaterials, type EngineResult, type EngineEventCard, type EngineOptions, type EngineFeaturesResult } from './campaign-engine';
import { outreachEngineDeps, produceOutreachBrandEmail, type BrandEmailResult, type BrandEmailImpl } from './sales-outreach-produce';
// ★ 2026-09-15 AI 자동제작 고객 채우기(사용자 재료 우선 · 아웃리치 채우기 무변경) · 이메일 후처리 순수 함수
import { customerEngineDeps, fillCustomerStandard, customerFillNotes, keepLastCtaBar, licensedPreheaderOf } from './campaign-customer-fill';
import { OUTREACH_DM_LAYOUT_MODE, OUTREACH_NEUTRAL_PRIMARY, accessiblePrimaryOf, outreachArtDirection, lookStatsOf, type OutreachLookStats } from './sales-outreach-look';
import { createEmailCampaign, deleteEmailCampaign, type CreateCampaignInput } from './email-channel';
import { isSmtpConfigured } from './company-smtp-client';
import { renderEmailSections, extractEmailText } from './email/email-section-renderer';
import { normalizeEmailDesign } from './email/email-tokens';
import { getCafe24Integration, getCafe24ByoCredentials, fetchCafe24ProductsByNoRaw } from './cafe24-client';
import { cafe24ProductAvailability, normalizeCafe24Product, wooStoreProductAvailability, normalizeWooStoreProduct } from './mall-product-normalize';
// ★ 2026-09-14 W5 우커머스 — 몰별 Store API(공개) 상품번호 재조회(include) · 회사 소속 몰만
import { getWooIntegration, fetchWooStoreProductsRaw } from './woocommerce-client';
import { normalizeWooMallId } from './woocommerce-core';
import { parseLicensedEndDate } from './sales-outreach-jobs';
import { runInCreditBundle } from './ai-credit-context';
import type { Section } from './dm/dm-section-registry';
import {
  aiAutoBuildEnabled, normalizeBuildMaterials, judgeImageRoles, checkMinimumMaterials, buildMaterialsHash, buildBillingHash, buildIdempotencyKey, buildReadIdempotencyKey, imagesHashOf, mallProductNoOf, resolveBuildProducts,
  companyImagePrefixes, isCompanyImageUrl, AiAutoBuildError,
  type BuildChannel, type BuildEventCard, type BuildMallProvider, type BuildMallLookup, type BuildImageRoleJudgement,
  type BuildMaterials, type BuildImage, type BuildGateResult,
} from './ai-auto-build-materials';

// routes/dm.ts · utils/dm/dm-viewer-utils.ts 와 동일 정의 미러(서빙 경로 /api/dm/v/images/{companyId}/{filename})
const DM_IMAGE_DIR = path.join(process.cwd(), 'uploads', 'dm-images');

/**
 * ★ 2026-09-15 임은지 접수(흰 CTA) · 고객 입구 산출물의 주색 보정.
 * 회사 브랜드 킷 주색을 그대로 실으면 흰색·연한 색일 때 DM CTA 바(글자 #fff 고정)와 이메일 반전 버튼(글자 = 주색)이 흰 바탕 흰 글자가 된다.
 * AI 영업과 같은 규칙(accessiblePrimaryOf · 못 쓰면 무채색 OUTREACH_NEUTRAL_PRIMARY)을 산출물에만 적용한다. 회사 킷 원장은 바꾸지 않는다.
 * 이메일은 미리보기·발송이 회사 킷으로 다시 렌더하므로 호출부가 같은 값을 캠페인 design.palette.primary 에도 싣는다.
 */
export function readableCustomerBrandKit<T extends { primary_color?: unknown }>(kit: T): T & { primary_color: string } {
  const raw = typeof kit?.primary_color === 'string' ? kit.primary_color : null;
  return { ...kit, primary_color: accessiblePrimaryOf(raw) || OUTREACH_NEUTRAL_PRIMARY } as T & { primary_color: string };
}

export const QUICK_MATERIALS_MAX_IMAGES = MAX_EVENT_IMAGES;
/** ★ v3 행사 카드 상한 · 카드당 이미지 상한(총 9 · 설계서 §10) */
export const QUICK_EVENT_CARDS_MAX = 3;
export const QUICK_EVENT_CARD_IMAGES = 3;
export const QUICK_CARD_UPLOAD_MAX = QUICK_EVENT_CARDS_MAX * QUICK_EVENT_CARD_IMAGES;

/** ENV 회사 목록 — 비면 전 회사 노출 · 있으면 목록 회사만(노출 스위치이자 효과 함수 안 판정) */
export function quickMaterialsEnabled(companyId: string | null | undefined, env: string | undefined = process.env.CAMPAIGN_MATERIALS_COMPANY_IDS): boolean {
  const list = String(env || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  return !!companyId && list.includes(String(companyId));
}

export interface QuickQuote { total: number; parts: Array<{ key: string; label: string; cost: number }> }

/**
 * 견적(순수) — 생성 1건(dm-ai-generate) + 텍스트가 비고 이미지가 있으면 판독(event-image-extract). 신규 키 0.
 * ★ v3 reads = 판독 호출 수(카드 대표 이미지 묶음 1회 · 호출 1회 = 3크레딧 고정 · 곱셈 금지) · 옛 호출(hasText/imageCount)은 reads 를 그 둘로 정한다.
 */
export function quoteQuickCampaign(input: { imageCount: number; hasText: boolean; reads?: number }): QuickQuote {
  const parts: QuickQuote['parts'] = [];
  const reads = typeof input.reads === 'number' ? Math.max(0, Math.min(1, Math.floor(input.reads))) : (!input.hasText && input.imageCount > 0 ? 1 : 0);
  if (reads > 0) parts.push({ key: 'event-image-extract', label: '이미지 판독', cost: getCreditCost('event-image-extract') });
  parts.push({ key: 'dm-ai-generate', label: '모바일 DM 생성', cost: getCreditCost('dm-ai-generate') });
  return { total: parts.reduce((a, p) => a + p.cost, 0), parts };
}

/** 요금제 잠금(mobile_dm) — 견적 응답에 싣는다(라우트 미들웨어와 같은 판정 함수) */
export async function quickPlanLocked(companyId: string): Promise<boolean> {
  try {
    const ctx = await loadPlanContext(companyId);
    if (!ctx) return true;
    return !canUseFeature(ctx, 'mobile_dm').allowed;
  } catch {
    return true;
  }
}

export interface SavedMaterialImage { url: string; width: number | null; height: number | null }

/** 업로드 이미지 사본 저장(매직 바이트 판별 · 5장(카드 업로드는 9) · 크기 실측) — 저장 경로·서빙 URL 은 DM 업로드와 동일 */
export function saveMaterialImages(companyId: string, files: ReadonlyArray<{ buffer: Buffer; originalname?: string }>, max = QUICK_MATERIALS_MAX_IMAGES): SavedMaterialImage[] {
  const dir = path.join(DM_IMAGE_DIR, companyId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const out: SavedMaterialImage[] = [];
  for (const f of files.slice(0, max)) {
    const mt = sniffImageMediaType(f.buffer);
    if (!mt) continue; // 위장 업로드 · 미지원 형식은 조용히 건너뛴다(응답 images 수로 드러난다)
    const ext = mt === 'image/png' ? '.png' : mt === 'image/webp' ? '.webp' : '.jpg';
    const filename = `${uuidv4()}${ext}`;
    fs.writeFileSync(path.join(dir, filename), f.buffer);
    const size = readImageSize(f.buffer);
    out.push({ url: `/api/dm/v/images/${companyId}/${filename}`, width: size?.width ?? null, height: size?.height ?? null });
  }
  return out;
}

export interface QuickMaterials {
  images: Array<{ url: string; width: number | null; height: number | null }>;
  event_text: string;
  /** 텍스트 원천 — user 만 면허 · vision(판독본)·empty 는 재료로만 */
  origin: 'user' | 'vision' | 'empty';
  events: ExtractedEvent[] | null;
  link: string | null;
  brand_name: string | null;
}

/**
 * 요청 재료 정규화(순수) — 이미지 URL 은 **이 회사의** DM 이미지 서빙 경로만(다른 회사·외부 URL 거부) · 5장 · 텍스트 상한 · 링크 http(s).
 * origin 은 클라이언트 주장이 아니라 서버가 판정한다: 텍스트가 비면 empty · extracted=true 로 표시된 텍스트는 vision · 그 외 user.
 */
export function normalizeQuickMaterials(raw: unknown, companyId: string): QuickMaterials {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const prefix = `/api/dm/v/images/${companyId}/`;
  const images = (Array.isArray(r.images) ? r.images : [])
    .map((im: any) => {
      const url = String(im?.url || '').trim();
      if (!url.startsWith(prefix) || !/^[A-Za-z0-9._-]+$/.test(url.slice(prefix.length))) return null;
      const w = Number(im?.width); const h = Number(im?.height);
      return { url, width: Number.isFinite(w) && w > 0 ? Math.floor(w) : null, height: Number.isFinite(h) && h > 0 ? Math.floor(h) : null };
    })
    .filter((x): x is { url: string; width: number | null; height: number | null } => !!x)
    .slice(0, QUICK_MATERIALS_MAX_IMAGES);
  const eventText = normalizeEventText(r.event_text).slice(0, EVENT_TEXT_MAX);
  const extracted = r.extracted === true || r.origin === 'vision';
  const origin: QuickMaterials['origin'] = !eventText ? 'empty' : extracted ? 'vision' : 'user';
  const events = Array.isArray(r.events)
    ? (r.events as any[]).filter((e) => e && typeof e === 'object').slice(0, 10).map((e) => ({
      brand: String(e.brand || '').slice(0, 60), title: String(e.title || '').slice(0, 120), subtitle: String(e.subtitle || '').slice(0, 200), benefit: String(e.benefit || '').slice(0, 200),
      products: (Array.isArray(e.products) ? e.products : []).slice(0, 12).map((p: any) => ({ name: String(p?.name || '').slice(0, 80), price: Number(p?.price) || 0, sale_price: Number(p?.sale_price) || 0, discount_rate: Number(p?.discount_rate) || 0 })).filter((p: any) => p.name),
    }))
    : null;
  let link: string | null = null;
  const rawLink = String(r.link || '').trim();
  if (rawLink) { try { const u = new URL(rawLink); if (u.protocol === 'http:' || u.protocol === 'https:') link = u.toString().slice(0, 500); } catch { link = null; } }
  const brand = String(r.brand_name || '').trim().slice(0, 60) || null;
  return { images, event_text: eventText, origin, events: events && events.length ? events : null, link, brand_name: brand };
}

// ===== ★ 2026-09-06 v3 행사 카드(고객 재료 페이지 · 설계서 §10) =====

export interface QuickEventCard {
  id: string;
  title: string;
  text: string;
  /** 사용자가 "이 문구를 그대로 씁니다" 를 체크 = 면허(수치 그대로) */
  licensed: boolean;
  images: Array<{ url: string; width: number | null; height: number | null }>;
  link: string | null;
}

/**
 * 요청 eventCards 정규화(순수 · normalizeQuickMaterials 의 형제 · 기존 함수 무변경) — 카드 ≤3 · 카드당 이미지 ≤3 · 이 회사 서빙 경로만 · 제목 40자 · 본문 EVENT_TEXT_MAX · 링크 http(s).
 * 제목도 이미지도 없는 카드는 버린다. id 는 클라이언트 값(문자·숫자·-_ 만 · 40자) 없으면 순번.
 */
export function normalizeQuickEventCards(raw: unknown, companyId: string): QuickEventCard[] {
  const prefix = `/api/dm/v/images/${companyId}/`;
  const list = Array.isArray(raw) ? raw : [];
  const out: QuickEventCard[] = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const title = String(r.title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const images = (Array.isArray(r.images) ? r.images : [])
      .map((im: any) => {
        const url = String(im?.url || '').trim();
        if (!url.startsWith(prefix) || !/^[A-Za-z0-9._-]+$/.test(url.slice(prefix.length))) return null;
        const w = Number(im?.width); const h = Number(im?.height);
        return { url, width: Number.isFinite(w) && w > 0 ? Math.floor(w) : null, height: Number.isFinite(h) && h > 0 ? Math.floor(h) : null };
      })
      .filter((x): x is { url: string; width: number | null; height: number | null } => !!x)
      .slice(0, QUICK_EVENT_CARD_IMAGES);
    if (!title && images.length === 0) continue;
    let link: string | null = null;
    const rawLink = String(r.link || '').trim();
    if (rawLink) { try { const u = new URL(rawLink); if (u.protocol === 'http:' || u.protocol === 'https:') link = u.toString().slice(0, 500); } catch { link = null; } }
    const idRaw = String(r.id || '').trim();
    out.push({
      id: /^[A-Za-z0-9_-]{1,40}$/.test(idRaw) ? idRaw : `card${out.length + 1}`,
      title,
      text: normalizeEventText(r.text).slice(0, EVENT_TEXT_MAX),
      licensed: r.licensed === true,
      images,
      link,
    });
    if (out.length >= QUICK_EVENT_CARDS_MAX) break;
  }
  return out;
}

/**
 * 행사 카드 → 엔진 재료 조각(순수) — gallery(group) · material('[행사 1] …') · ctaLinks[group] · licensedQuote(면허 카드 text ' · ') · eventCards(엔진 카드 · 첫 이미지 = 배너 · group 결속).
 * 기존 경로(normalizeQuickMaterials)와 같은 모양으로 펴서 같은 엔진에 태운다.
 */
export function materialsFromEventCards(cards: readonly QuickEventCard[]): {
  gallery: Array<{ url: string; width?: number; height?: number; group: string }>;
  material: string;
  ctaLinks: Record<string, string>;
  licensedQuote: string;
  eventCards: EngineEventCard[];
  link: string | null;
} {
  const gallery: Array<{ url: string; width?: number; height?: number; group: string }> = [];
  const lines: string[] = [];
  const ctaLinks: Record<string, string> = {};
  const licensed: string[] = [];
  const eventCards: EngineEventCard[] = [];
  cards.forEach((c, i) => {
    const group = c.id;
    for (const im of c.images) gallery.push({ url: im.url, width: im.width ?? undefined, height: im.height ?? undefined, group });
    const head = c.title || `행사 ${i + 1}`;
    lines.push(`[행사 ${i + 1}] ${head}${c.text ? `\n${c.text}` : ''}`);
    if (c.link) ctaLinks[group] = c.link;
    if (c.licensed && c.text) licensed.push(c.text);
    if (c.licensed && c.title) licensed.push(c.title);
    eventCards.push({
      title: head,
      periodRaw: null,
      endDate: null,
      bannerUrl: c.images[0]?.url || null,
      bannerSize: c.images[0]?.width && c.images[0]?.height ? { width: c.images[0].width, height: c.images[0].height } : null,
      detailUrl: c.link,
      licensed: c.licensed,
      group,
      text: c.text || undefined,
    });
  });
  return { gallery, material: lines.join('\n\n').slice(0, 6000), ctaLinks, licensedQuote: licensed.join(' · '), eventCards, link: cards.find((c) => c.link)?.link || null };
}

/** 판독 구조(events) → 프롬프트 재료 텍스트(사실만 · 이미지 없는 상품은 카드가 아니라 글줄) */
export function materialTextFromEvents(events: ExtractedEvent[] | null, eventText: string): string {
  const lines: string[] = [];
  if (eventText) lines.push(eventText);
  for (const e of events || []) {
    const head = [e.title, e.subtitle].filter(Boolean).join(' · ');
    if (head) lines.push(head);
    if (e.benefit) lines.push(`혜택: ${e.benefit}`);
    for (const p of e.products || []) {
      const price = p.sale_price ? `${p.sale_price.toLocaleString()}원${p.price ? ` (정가 ${p.price.toLocaleString()}원)` : ''}` : p.price ? `${p.price.toLocaleString()}원` : '';
      lines.push(`- ${p.name}${price ? ` ${price}` : ''}`);
    }
  }
  return Array.from(new Set(lines)).join('\n').slice(0, 6000);
}

export interface QuickGenerateResult {
  draftId: string;
  sections: EngineResult<OutreachLookStats>['sections'];
  pages: unknown[];
  layout_mode: string;
  brand_kit: Record<string, unknown>;
  look: OutreachLookStats;
  benefitStripped: number;
  heroFallback: boolean;
  materialsMeta: { images: number; imagesUsed: number; textChars: number; origin: QuickMaterials['origin']; licensed: boolean; products: number; sections: number; ctaCount: number; eventCards?: number };
}

/**
 * 재료 → 엔진 → 초안 DM. 크레딧: 생성 전 잔액 확인 → 초안 행 생성 뒤 차감(멱등 quick:{draftId} · 같은 초안에 두 번 차감되지 않는다).
 * 판독은 여기서 하지 않는다(재료 입구 라우트가 텍스트 비었을 때만 선행 · 그 3크레딧은 판독 함수가 차감).
 */
export async function generateDmFromMaterials(input: { companyId: string; userId: string | null | undefined; materials: unknown; industry?: string | null }): Promise<QuickGenerateResult> {
  const companyId = String(input.companyId);
  if (!quickMaterialsEnabled(companyId)) throw new Error('이 기능은 아직 열리지 않았습니다.');
  const m = normalizeQuickMaterials(input.materials, companyId);
  // ★ v3 행사 카드(≤3) — 있으면 카드가 재료의 1순위(옛 images·event_text 는 카드가 없을 때의 경로 그대로)
  const cards = normalizeQuickEventCards((input.materials as any)?.eventCards, companyId);
  const fromCards = cards.length ? materialsFromEventCards(cards) : null;
  if (!fromCards && m.images.length === 0 && !m.event_text) throw new Error('이미지 1장 이상 또는 행사 내용을 입력해주세요.');
  const genCost = getCreditCost('dm-ai-generate');
  await checkCredit(companyId, genCost);

  const brandKit = readableCustomerBrandKit(await getCompanyBrandKit(companyId));
  const basic = await getBrandBasicInfo(companyId).catch(() => null);
  const companyName = m.brand_name || String(basic?.brand_name || '').trim() || String(basic?.company_name || '').trim() || '우리 브랜드';
  const material = fromCards
    ? [fromCards.material, materialTextFromEvents(m.events, m.event_text)].filter(Boolean).join('\n\n').slice(0, 6000)
    : (materialTextFromEvents(m.events, m.event_text) || '(행사 텍스트 없음 · 올린 이미지 중심으로 구성)');
  const engineMaterials: EngineMaterials = {
    companyName,
    industry: input.industry || String(basic?.industry_code || '').trim() || null,
    homepageUrl: fromCards?.link || m.link || '',
    siteTitle: null,
    material,
    extraNotes: null,
    products: [],
    gallery: fromCards ? fromCards.gallery : m.images.map((im) => ({ url: im.url, width: im.width ?? undefined, height: im.height ?? undefined })),
    logoUrl: null,
    posterUrl: null,
    posterSize: null,
    bannerUrl: null,
    bannerSize: null,
    ctaLinks: fromCards ? fromCards.ctaLinks : {},
    legal: null,
    // 면허 = 사용자가 직접 쓴 텍스트만(카드 = "그대로 씁니다" 체크한 카드의 문구 · 옛 경로 = origin user)
    licensedQuote: [fromCards?.licensedQuote || '', m.origin === 'user' ? m.event_text : ''].filter(Boolean).join(' · '),
    proof: null,
    eventCards: fromCards ? fromCards.eventCards : undefined,
  };
  const r = await assembleDmCampaign(engineMaterials, {
    entry: 'customer', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: OUTREACH_DM_LAYOUT_MODE,
  }, outreachEngineDeps());

  const dm = await createDm(companyId, String(input.userId || ''), {
    title: `[재료로 만든 초안] ${companyName}`.slice(0, 200),
    sections: r.sections,
    pages: r.pages as any,
    layout_mode: OUTREACH_DM_LAYOUT_MODE,
    brand_kit: brandKit as any,
    ai_prompt: material.slice(0, 2000),
    approval_status: 'draft',
  } as any);
  const draftId = String(dm.id);
  await deductCreditSafe({ companyId, cost: genCost, source: 'dm-ai-generate', createdBy: input.userId || null, idempotencyKey: `quick:${draftId}` });

  const imagesUsed = new Set<string>();
  for (const s of r.sections) {
    const p: any = (s as any).props || {};
    if (typeof p.image_url === 'string' && p.image_url) imagesUsed.add(p.image_url);
    if (Array.isArray(p.images)) for (const im of p.images) if (im?.url) imagesUsed.add(String(im.url));
  }
  return {
    draftId,
    sections: r.sections,
    pages: r.pages,
    layout_mode: OUTREACH_DM_LAYOUT_MODE,
    brand_kit: (brandKit as unknown as Record<string, unknown>) || {},
    look: r.look,
    benefitStripped: r.benefitStripped,
    heroFallback: r.heroFallback,
    materialsMeta: {
      images: fromCards ? fromCards.gallery.length : m.images.length,
      imagesUsed: (fromCards ? fromCards.gallery : m.images).filter((im) => imagesUsed.has(im.url)).length,
      textChars: fromCards ? fromCards.material.length : m.event_text.length,
      origin: m.origin,
      licensed: !!(fromCards?.licensedQuote) || m.origin === 'user',
      products: (m.events || []).reduce((a, e) => a + (e.products || []).length, 0),
      sections: r.sections.length,
      ctaCount: r.sections.filter((s) => String((s as any).type) === 'cta').length,
      eventCards: cards.length,
    },
  };
}

/** 재료 입구 라우트가 쓰는 판독(텍스트가 비었을 때만) — 반환 텍스트는 origin 'vision' */
export async function extractMaterialsText(input: { companyId: string; userId: string | null | undefined; files: ReadonlyArray<{ buffer: Buffer; mimetype: string }> }): Promise<{ eventText: string; events: ExtractedEvent[] | null }> {
  const images = input.files.map((f) => ({ media_type: sniffImageMediaType(f.buffer) || f.mimetype, data: f.buffer.toString('base64') }));
  const r = await extractEventsFromImages({ images, companyId: input.companyId, userId: input.userId || undefined });
  return { eventText: r.eventText, events: r.events };
}

// ===== ★ 2026-09-06 S6 이메일 합류 — 같은 재료 · 이메일 독립 계약(아웃리치 브랜드 이메일 시안 경로 그대로) =====

export interface QuickEmailResult {
  sections: Awaited<ReturnType<typeof produceOutreachBrandEmail>>['sections'];
  subject: string;
  preheader: string;
  name: string;
  benefitStripped: number;
  look: OutreachLookStats;
  materialsMeta: { images: number; textChars: number; origin: QuickMaterials['origin']; licensed: boolean; sections: number };
}

/**
 * 재료 → 이메일 블록(아웃리치 브랜드 이메일 시안과 같은 함수 · 상품 묶음 앞 text_card 3칸 계약 · EMAIL 룩). 발행·저장은 없다(편집기가 현재 블록을 교체).
 * 크레딧 = 기존 키 email-ai-generate(생성 전 잔액 확인 · 성공 뒤 차감 · 기존 라우트와 같은 순서).
 */
export async function generateEmailFromMaterials(input: { companyId: string; userId: string | null | undefined; materials: unknown; industry?: string | null }): Promise<QuickEmailResult> {
  const companyId = String(input.companyId);
  if (!quickMaterialsEnabled(companyId)) throw new Error('이 기능은 아직 열리지 않았습니다.');
  const m = normalizeQuickMaterials(input.materials, companyId);
  if (m.images.length === 0 && !m.event_text) throw new Error('이미지 1장 이상 또는 행사 내용을 입력해주세요.');
  const cost = getCreditCost('email-ai-generate');
  await checkCredit(companyId, cost);
  const basic = await getBrandBasicInfo(companyId).catch(() => null);
  const companyName = m.brand_name || String(basic?.brand_name || '').trim() || String(basic?.company_name || '').trim() || '우리 브랜드';
  const material = materialTextFromEvents(m.events, m.event_text) || '(행사 텍스트 없음 · 올린 이미지 중심으로 구성)';
  const r = await produceOutreachBrandEmail({
    companyName, industry: input.industry || String(basic?.industry_code || '').trim() || null, homepageUrl: m.link || '', siteTitle: null,
    material, extraNotes: null, benefitLicensed: m.origin === 'user', licensedQuote: m.origin === 'user' ? m.event_text : '',
    posterUrl: null, posterSize: null, bannerUrl: null, bannerSize: null,
    media: { gallery: m.images.map((im) => ({ url: im.url, width: im.width || 0, height: im.height || 0, srcUrl: im.url } as any)), products: [], collectedAt: new Date().toISOString(), stats: { galleryCandidates: m.images.length, galleryPassed: m.images.length, productLinks: 0, productsFound: 0, productsPassed: 0 } },
    mediaSelection: null, ctaLinks: {}, legal: null, brandColor: null, proof: null,
    entry: 'customer',
  });
  await deductCreditSafe({ companyId, cost, source: 'email-ai-generate', createdBy: input.userId || null });
  return {
    sections: r.sections,
    subject: r.subject,
    preheader: r.preheader,
    name: `재료로 만든 이메일 · ${companyName}`.slice(0, 60),
    benefitStripped: r.benefitStripped,
    look: r.look,
    materialsMeta: { images: m.images.length, textChars: m.event_text.length, origin: m.origin, licensed: m.origin === 'user', sections: r.sections.length },
  };
}

// ===== ★ 2026-09-14 T3 AI 자동제작 v1(materials.version === 1) — 설계서 docs/2026-09-14-ai-auto-build-design.md §2-9·§2-10·§5·§6-5·§6-6 =====
//  옛 요청(version 없음)은 위 v0 함수 그대로. v1 = 판정(정규화·이미지 실물·게이트·SMTP·몰 재조회·견적 결박) → checkCredit → 판독(텍스트 0) → 조립 → 초안 행 → 차감(키 = attemptToken).
//  I/O 경계는 BuildDeps 로 주입(계약 테스트가 순서·키·행 수를 검증) · defaultBuildDeps 가 실물 배선.

/** 인앱(소재 라이브러리) 이미지 실물 경로 — `utils/assets.ts`·`routes/cdp.ts` 와 동일 정의(단일 env 소스) */
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');
/**
 * 판독 결과 재사용(같은 회사 · 같은 이미지 조합 · 10분 · §5 "재차감 0").
 * ★Codex 1R(0914) medium 수용 — 캐시 적중 여부를 **견적·잔액 확인·실차감이 같은 판정**으로 읽는다(적중 = 판독 부품 자체가 빠진다 · 표시 = 차감).
 */
const BUILD_VISION_TTL_MS = 10 * 60 * 1000;
/**
 * 캐시 항목은 **정산 상태**를 든다(★Codex 2R 0914 high 수용): 판독 직후 = 미정산(readKey 보관). 조립 실패로 초안이 안 생기면 미정산이 남고,
 * 미정산 캐시는 견적에 판독 부품을 그대로 남기며(표시 = 차감) 다음 초안 성공 때 **처음 읽은 시도의 readKey** 로 멱등 차감한 뒤 정산으로 전이한다.
 * 정산된 캐시만 무료 재사용(견적에서 판독 제외)이다.
 */
interface VisionCacheEntry { at: number; eventText: string; events: ExtractedEvent[] | null; settled: boolean; readKey: string }
const buildVisionCache = new Map<string, VisionCacheEntry>();
export function clearBuildVisionCache(): void { buildVisionCache.clear(); }
function visionCacheKeyOf(companyId: string, urls: readonly string[]): string { return `${companyId}|${imagesHashOf(urls)}`; }
function freshVisionCache(key: string): VisionCacheEntry | null {
  const hit = buildVisionCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= BUILD_VISION_TTL_MS) { buildVisionCache.delete(key); return null; }
  return hit;
}

export interface BuildReadImage { exists: boolean; buffer: Buffer | null; mediaType?: string | null; width: number | null; height: number | null }
export interface BuildDeps {
  enabled(companyId: string): boolean;
  creditEnabled(companyId: string): Promise<boolean>;
  checkCredit(companyId: string, cost: number): Promise<void>;
  deductOutcome(opts: Parameters<typeof deductCreditOutcome>[0]): Promise<DeductOutcome>;
  smtpConfigured(companyId: string): Promise<boolean>;
  lookupMall(companyId: string, provider: BuildMallProvider, productNos: readonly string[]): Promise<BuildMallLookup>;
  readImage(url: string, companyId: string): BuildReadImage;
  extractFromImages(input: { images: Array<{ media_type: string; data: string }>; companyId: string; userId?: string }): Promise<{ eventText: string; events: ExtractedEvent[] | null }>;
  brandKit(companyId: string): Promise<Record<string, unknown>>;
  basicInfo(companyId: string): Promise<{ brand_name?: unknown; company_name?: unknown; industry_code?: unknown } | null>;
  assembleDm(materials: EngineMaterials, opts: EngineOptions): Promise<EngineResult<OutreachLookStats>>;
  produceEmail(input: Parameters<typeof produceOutreachBrandEmail>[0], impl?: BrandEmailImpl): Promise<BrandEmailResult>;
  createDm(companyId: string, userId: string, data: Record<string, unknown>): Promise<{ id: string }>;
  deleteDm(id: string, companyId: string): Promise<boolean>;
  createEmail(input: CreateCampaignInput): Promise<{ id: string }>;
  deleteEmail(companyId: string, campaignId: string): Promise<boolean>;
  renderEmail(sections: Section[], brandKit: Record<string, unknown>, design?: ReturnType<typeof normalizeEmailDesign>): { html: string; text: string };
}

/** 서빙 URL → 디스크 경로(파일명 문자 제한은 isCompanyImageUrl 이 이미 걸렀다) */
function buildImageDiskPath(url: string, companyId: string): string | null {
  const [dmPrefix, libPrefix] = companyImagePrefixes(companyId);
  if (url.startsWith(dmPrefix)) return path.join(DM_IMAGE_DIR, companyId, url.slice(dmPrefix.length));
  if (url.startsWith(libPrefix)) return path.join(INAPP_IMAGE_BASE, companyId, url.slice(libPrefix.length));
  return null;
}

function readBuildImage(url: string, companyId: string): BuildReadImage {
  const p = buildImageDiskPath(url, companyId);
  if (!p || !fs.existsSync(p)) return { exists: false, buffer: null, width: null, height: null };
  try {
    const buffer = fs.readFileSync(p);
    const size = readImageSize(buffer);
    return { exists: true, buffer, mediaType: sniffImageMediaType(buffer), width: size?.width ?? null, height: size?.height ?? null };
  } catch {
    return { exists: false, buffer: null, width: null, height: null };
  }
}

/**
 * 몰 재조회(상품번호 기준 · 불변 3) — 카페24만(네이버는 단건 조회 API 가 없어 피커 값 + "가격 확인 못함") · 연동 상태 active 만 인정(LESSONS_BACKEND) ·
 * 품절·미전시 = unavailable + 사유 · 응답에 없음 = 못 찾음. 호출부가 예외를 failed 로 접는다(502 금지).
 */
async function lookupMallProductsByNo(companyId: string, provider: BuildMallProvider, productNos: readonly string[]): Promise<BuildMallLookup> {
  if (provider.startsWith('woocommerce:')) {
    const mallId = normalizeWooMallId(provider.slice('woocommerce:'.length));
    const integ = mallId ? await getWooIntegration(companyId, mallId) : undefined;
    if (!integ) return { failed: true, byCode: {} };
    const rawList = await fetchWooStoreProductsRaw(integ.siteUrl, { ids: productNos, limit: productNos.length });
    const byCode: BuildMallLookup['byCode'] = {};
    for (const p of rawList) {
      const no = p?.id != null ? String(p.id) : '';
      if (!no) continue;
      const avail = wooStoreProductAvailability(p);
      if (avail !== 'ok') { byCode[no] = { status: 'unavailable', reason: avail === 'sold_out' ? '품절' : '판매 중지' }; continue; }
      const norm = normalizeWooStoreProduct(p, integ.mallId);
      if (!norm) continue;
      byCode[no] = { status: 'ok', name: norm.name, price: norm.price, salePrice: norm.salePrice, discountRate: norm.discountRate, imageUrl: norm.imageUrl, productUrl: norm.productUrl };
    }
    return { failed: false, byCode };
  }
  if (provider !== 'cafe24') return { failed: false, byCode: {} };
  const integ = await getCafe24Integration(companyId);
  if (!integ || integ.status !== 'active') return { failed: true, byCode: {} };
  const creds = await getCafe24ByoCredentials(companyId, integ.mallId).catch(() => undefined);
  const rawList = await fetchCafe24ProductsByNoRaw(integ, productNos, creds);
  const byCode: BuildMallLookup['byCode'] = {};
  for (const p of rawList) {
    const no = p?.product_no != null ? String(p.product_no) : '';
    if (!no) continue;
    const avail = cafe24ProductAvailability(p);
    if (avail !== 'ok') { byCode[no] = { status: 'unavailable', reason: avail === 'sold_out' ? '품절' : '판매 중지 또는 미전시' }; continue; }
    const norm = normalizeCafe24Product(p, integ.mallId);
    if (!norm) continue;
    byCode[no] = { status: 'ok', name: norm.name, price: norm.price, salePrice: norm.salePrice, discountRate: norm.discountRate, imageUrl: norm.imageUrl, productUrl: norm.productUrl };
  }
  return { failed: false, byCode };
}

export function defaultBuildDeps(): BuildDeps {
  return {
    enabled: (companyId) => aiAutoBuildEnabled(companyId),
    creditEnabled: async (companyId) => (await getCreditState(companyId)).creditEnabled,
    checkCredit: (companyId, cost) => checkCredit(companyId, cost),
    deductOutcome: (o) => deductCreditOutcome(o),
    smtpConfigured: (companyId) => isSmtpConfigured(companyId),
    lookupMall: (companyId, provider, nos) => lookupMallProductsByNo(companyId, provider, nos),
    readImage: (url, companyId) => readBuildImage(url, companyId),
    extractFromImages: (input) => extractEventsFromImages(input),
    brandKit: async (companyId) => (await getCompanyBrandKit(companyId)) as unknown as Record<string, unknown>,
    basicInfo: (companyId) => getBrandBasicInfo(companyId),
    assembleDm: (m, opts) => assembleDmCampaign(m, opts, customerEngineDeps()),
    produceEmail: (input, impl) => produceOutreachBrandEmail(input, impl),
    createDm: (companyId, userId, data) => createDm(companyId, userId, data as any),
    deleteDm: (id, companyId) => deleteDm(id, companyId),
    createEmail: (input) => createEmailCampaign(input),
    deleteEmail: (companyId, campaignId) => deleteEmailCampaign(companyId, campaignId),
    renderEmail: (sections, brandKit, design) => ({
      html: renderEmailSections(sections, { brandKit: brandKit as any, design: design || null, publicBase: process.env.PUBLIC_BASE_URL }),
      text: extractEmailText(sections),
    }),
  };
}

/**
 * v1 견적(순수 · §5) — 채널 키 그대로(dm 5 · email 3) + 판독은 텍스트 0 이고 이미지가 있을 때만 1회(분리 표기 "이미지 글자 읽기") · 신규 키 0 · 크레딧제 미적용 = 0.
 * 화면 금액의 단일 출처. 생성 라우트는 같은 함수로 expectedTotal 을 결박한다(다르면 409).
 */
export function quoteBuildMaterials(input: { channel: BuildChannel; textChars: number; imageCount: number; creditEnabled?: boolean; visionCached?: boolean }): QuickQuote {
  const priced = input.creditEnabled !== false;
  const costOf = (key: string) => (priced ? getCreditCost(key) : 0);
  const parts: QuickQuote['parts'] = [];
  // 판독 부품 = 텍스트 0 + 이미지 있음 + **캐시에 없음**(적중이면 판독도 차감도 없다 · 견적과 생성이 같은 판정)
  if (input.textChars <= 0 && input.imageCount > 0 && !input.visionCached) parts.push({ key: 'event-image-extract', label: '이미지 글자 읽기', cost: costOf('event-image-extract') });
  if (input.channel === 'email') parts.push({ key: 'email-ai-generate', label: '이메일 생성', cost: costOf('email-ai-generate') });
  else parts.push({ key: 'dm-ai-generate', label: '모바일 DM 생성', cost: costOf('dm-ai-generate') });
  return { total: parts.reduce((a, p) => a + p.cost, 0), parts };
}

export interface BuildMaterialsMeta {
  images: number;
  imagesUsed: number;
  /** 실물 파일이 없어 뺀 장 수(§6-5 "이미지 일부 실패 = 그 장만 제외") */
  imagesDropped: number;
  textChars: number;
  origin: 'user' | 'empty';
  licensed: boolean;
  reads: 0 | 1;
  visionCached: boolean;
  /** 카드가 된 상품 수 · 글줄로만 들어간 상품 수 */
  products: number;
  productsText: number;
  mallUnverified: string[];
  mallFailed: boolean;
  excluded: Array<{ code: string; name: string; reason: string }>;
  sections: number;
  ctaCount: number;
  eventCards: number;
  /** 화면 썸네일 배지의 단일 출처(§6-3) */
  imageRoles: BuildImageRoleJudgement[];
  features: EngineFeaturesResult;
  /** ★ 2026-09-15 고객 채우기 사유 문장(링크 없는 카드 · 자리가 없어 뺀 상품) · 결과 바 "미반영" 목록이 그대로 싣는다 */
  notes: string[];
  /** 견적 결박용 지문(uuid 불변 · 세 요소) */
  materialsHash: string;
  /** 과금용 지문(정규화 입력 전체 · 멱등키 뒷부분) */
  billingHash: string;
}

export interface BuildGenerateResult {
  channel: BuildChannel;
  /** 결과 참조 = DM 초안 id 또는 이메일 campaignId(돈 단위 아님) */
  draftId: string;
  attemptToken: string;
  idempotencyKey: string;
  deductOutcome: DeductOutcome;
  /** 이번 시도에서 판독을 실제로 했을 때만(캐시 적중·판독 없음 = null) */
  readDeductOutcome: DeductOutcome | null;
  quote: QuickQuote;
  sections: Section[];
  pages: unknown[];
  layout_mode: string;
  brand_kit: Record<string, unknown>;
  look: OutreachLookStats;
  benefitStripped: number;
  heroFallback: boolean;
  subject: string | null;
  preheader: string | null;
  name: string;
  materialsMeta: BuildMaterialsMeta;
}

interface BuildPrepared {
  m: BuildMaterials;
  cards: BuildEventCard[];
  images: BuildImage[];
  roles: BuildImageRoleJudgement[];
  gate: BuildGateResult;
  imagesDropped: number;
  files: Map<string, BuildReadImage>;
}

/**
 * 공통 앞단(견적·생성이 같은 함수 = 화면 배지·버튼 잠금·금액의 단일 출처) — 개방(403) → 정규화(400) → 라우트 채널 고정(400) →
 * 이미지 실물(없는 장 제외 · 치수는 빈 값만 실측) → 역할 판정 → 최소 재료 게이트(결과만 · 던지는 것은 호출부).
 */
function prepareBuildMaterials(rawMaterials: unknown, companyId: string, deps: BuildDeps, channel?: BuildChannel): BuildPrepared {
  if (!deps.enabled(companyId)) throw new AiAutoBuildError(403, 'FEATURE_DISABLED', '이 기능은 아직 열리지 않았습니다.');
  const norm = normalizeBuildMaterials(rawMaterials, companyId);
  if (!norm.ok) throw new AiAutoBuildError(400, 'MATERIALS_INVALID', norm.error, { field: norm.field });
  const m = norm.materials;
  // 라우트가 고정한 채널(DM 라우트 = dm · 이메일 라우트 = email)과 재료의 채널이 다르면 거부 — 다른 채널의 행·차감을 만들지 않는다
  if (channel && m.channel !== channel) throw new AiAutoBuildError(400, 'MATERIALS_INVALID', '요청한 채널과 재료의 채널이 다릅니다.', { field: 'channel' });
  let imagesDropped = 0;
  const files = new Map<string, BuildReadImage>();
  const cards: BuildEventCard[] = m.eventCards.map((c) => ({
    ...c,
    images: c.images.flatMap((im) => {
      const f = deps.readImage(im.url, companyId);
      if (!f.exists) { imagesDropped++; return []; }
      files.set(im.url, f);
      return [{ url: im.url, width: im.width ?? f.width, height: im.height ?? f.height }];
    }),
  }));
  const images = cards.flatMap((c) => c.images);
  const roles = judgeImageRoles(images);
  return { m, cards, images, roles, gate: checkMinimumMaterials(m, roles), imagesDropped, files };
}

/** 원장 조회 실패 = 503(§6-5 · "모르는 것을 미차감으로 접지 않는다") · 잔액 부족(InsufficientCreditError)은 그대로 */
async function creditEnabledOrThrow(deps: BuildDeps, companyId: string): Promise<boolean> {
  try {
    return await deps.creditEnabled(companyId);
  } catch (err: any) {
    console.log(`[ai-auto-build] 크레딧 상태 조회 실패 company=${companyId} err=${err?.message}`);
    throw new AiAutoBuildError(503, 'CREDIT_LOOKUP_UNAVAILABLE', '크레딧 잔액을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

export interface BuildQuoteResult {
  channel: BuildChannel;
  quote: QuickQuote;
  gate: BuildGateResult;
  imageRoles: BuildImageRoleJudgement[];
  textChars: number;
  images: number;
  imagesDropped: number;
  creditEnabled: boolean;
  /** 이메일만 · DM 은 null */
  smtpConfigured: boolean | null;
  materialsHash: string;
}

/**
 * v1 견적(§4-2 sticky 바 · §5 화면 금액의 단일 출처) — 생성과 같은 앞단(정규화 · 이미지 실물 · 역할 · 게이트)을 지나 견적만 낸다.
 * 차감 · AI · 초안 0. 게이트 미달은 오류가 아니라 결과(버튼 잠금 사유) · 이메일이면 SMTP 상태를 함께(세그먼트 비활성 사유).
 */
export async function quoteFromBuildMaterials(
  input: { companyId: string; materials: unknown; channel?: BuildChannel },
  deps: BuildDeps = defaultBuildDeps(),
): Promise<BuildQuoteResult> {
  const companyId = String(input.companyId);
  const { m, images, roles, gate, imagesDropped } = prepareBuildMaterials(input.materials, companyId, deps, input.channel);
  const creditEnabled = await creditEnabledOrThrow(deps, companyId);
  // 정산된 캐시만 판독 부품을 뺀다(미정산 = 판독비가 아직 남아 있다)
  const visionCached = !!freshVisionCache(visionCacheKeyOf(companyId, images.map((im) => im.url)))?.settled;
  const quote = quoteBuildMaterials({ channel: m.channel, textChars: m.textChars, imageCount: images.length, creditEnabled, visionCached });
  const smtpConfigured = m.channel === 'email' ? await deps.smtpConfigured(companyId) : null;
  return { channel: m.channel, quote, gate, imageRoles: roles, textChars: m.textChars, images: images.length, imagesDropped, creditEnabled, smtpConfigured, materialsHash: buildMaterialsHash(m, roles) };
}

/** 라우트 응답(편집기 착지 키 draft_id · campaign_id · 옛 응답 키 유지) — DM·이메일 라우트가 같은 매핑을 쓴다 */
export function buildGenerateResponse(r: BuildGenerateResult): Record<string, unknown> {
  return {
    channel: r.channel,
    draft_id: r.draftId,
    campaign_id: r.channel === 'email' ? r.draftId : null,
    attempt_token: r.attemptToken,
    idempotency_key: r.idempotencyKey,
    deduct_outcome: r.deductOutcome,
    quote: r.quote,
    sections: r.sections,
    pages: r.pages,
    layout_mode: r.layout_mode,
    brand_kit: r.brand_kit,
    spec: null,
    scenario: null,
    brief: null,
    coverage: null,
    look: r.look,
    benefitStripped: r.benefitStripped,
    heroFallback: r.heroFallback,
    subjects: r.subject ? [r.subject] : [],
    preheader: r.preheader,
    name: r.name,
    materials: r.materialsMeta,
  };
}

/**
 * v1 조립 — 모든 판정은 차감 앞(§2-10) · 돈 단위 = attemptToken(§2-9) · 실패 계약(§6-5).
 *  순서: 개방 → 정규화 → 채널 고정 → 이미지 실물(없는 장 제외 · 치수 실측) → 최소 재료 게이트 → (이메일) SMTP → 몰 재조회 → 견적 결박(409) → checkCredit(402 · 원장 조회 실패 503)
 *        → 판독(텍스트 0 · 캐시) → 조립(AI) → 초안 행 → 차감(deductCreditOutcome · duplicate 무료 · failed 는 행 유지 + [CREDIT][MISS]).
 *  차감 호출 자체가 던지면(원장 이전 실패) 만든 행을 거둔다(고아 0). 그 밖의 오류는 던지고 라우트가 status 로 답한다.
 */
export async function generateFromBuildMaterials(
  input: { companyId: string; userId: string | null | undefined; materials: unknown; industry?: string | null; channel?: BuildChannel },
  deps: BuildDeps = defaultBuildDeps(),
): Promise<BuildGenerateResult> {
  const companyId = String(input.companyId);
  const userId = input.userId ? String(input.userId) : '';
  const { m, cards, images, roles, gate, imagesDropped, files } = prepareBuildMaterials(input.materials, companyId, deps, input.channel);
  if (!gate.ok) throw new AiAutoBuildError(400, 'MATERIAL_THIN', '재료가 부족해요. 행사 내용 40자 이상 또는 첫 화면이 될 사진 1장을 넣어 주세요.', { missing: gate.missing });
  if (m.channel === 'email' && !(await deps.smtpConfigured(companyId))) {
    throw new AiAutoBuildError(400, 'SMTP_REQUIRED', '이메일 발신 설정이 먼저 필요해요. 설정 메뉴에서 발신 메일을 등록해 주세요.');
  }

  // 몰 재조회(상품번호) — 장애는 "가격 확인 못함"으로 접는다(생성 계속 · 502 금지)
  const byProvider = new Map<BuildMallProvider, string[]>();
  for (const p of m.products) {
    const no = mallProductNoOf(p);
    if (p.source !== 'mall' || !p.provider || !no) continue;
    const list = byProvider.get(p.provider) || [];
    if (!list.includes(no)) list.push(no);
    byProvider.set(p.provider, list);
  }
  const lookups: Record<string, BuildMallLookup> = {};
  for (const [provider, nos] of byProvider) {
    try {
      lookups[provider] = await deps.lookupMall(companyId, provider, nos);
    } catch (err: any) {
      console.log(`[ai-auto-build] 몰 재조회 실패(가격 확인 못함으로 계속) company=${companyId} provider=${provider} n=${nos.length} err=${err?.message}`);
      lookups[provider] = { failed: true, byCode: {} };
    }
  }
  const resolved = resolveBuildProducts(m.products, lookups);

  // 견적 결박(표시 ≠ 차감 차단) → 잔액(402 는 InsufficientCreditError)
  const creditEnabled = await creditEnabledOrThrow(deps, companyId);
  // 판독 여부는 견적과 같은 판정(캐시 적중 = 판독 없음 · 견적에 판독 부품 없음). 견적 뒤 캐시가 만료됐으면 합계가 달라져 409 → 화면이 견적을 다시 받는다.
  const imageUrls = images.map((im) => im.url);
  const visionKey = visionCacheKeyOf(companyId, imageUrls);
  const cachedVision = freshVisionCache(visionKey);
  // 판독 부품(reads) = 텍스트 0 + 이미지 있음 + **정산된 캐시 없음**(미정산 캐시 = 재료는 재사용해도 판독비는 이번 초안에서 청구) · 견적과 같은 판정
  const visionSettled = !!cachedVision?.settled;
  const reads: 0 | 1 = m.textChars <= 0 && images.length > 0 && !visionSettled ? 1 : 0;
  const quote = quoteBuildMaterials({ channel: m.channel, textChars: m.textChars, imageCount: images.length, creditEnabled, visionCached: visionSettled });
  if (quote.total !== m.expectedTotal) throw new AiAutoBuildError(409, 'QUOTE_CHANGED', '견적이 바뀌었어요. 금액을 다시 확인하고 눌러 주세요.', { quote });
  try {
    await deps.checkCredit(companyId, quote.total);
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) throw err;
    console.log(`[ai-auto-build] 잔액 확인 실패 company=${companyId} err=${err?.message}`);
    throw new AiAutoBuildError(503, 'CREDIT_LOOKUP_UNAVAILABLE', '크레딧 잔액을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }

  // 판독(텍스트 0 + 이미지 + 캐시 없음) — **크레딧 묶음 안**에서 돌려 AI 호출의 자체 차감(3)을 끄고, 판독비는 초안이 생긴 뒤 시도 토큰 멱등키로 따로 차감한다
  //   (★Codex 1R 0914 high 수용: 산출물 없는 판독비 0 · 같은 시도 재요청 재차감 0). 캐시 적중 = 재료만 재사용(판독·차감 0) · 판독본은 재료로만(면허 0).
  let visionText = '';
  let visionEvents: ExtractedEvent[] | null = null;
  /** 이번 초안에서 판독비를 청구해야 하는가(방금 읽었거나 미정산 캐시를 썼다) · 키 = 처음 읽은 시도의 것 */
  let readKeyToCharge: string | null = null;
  if (cachedVision) {
    visionText = cachedVision.eventText; visionEvents = cachedVision.events;
    if (!cachedVision.settled) readKeyToCharge = cachedVision.readKey;
  } else if (reads) {
    const payload = images
      .map((im) => files.get(im.url))
      .filter((f): f is BuildReadImage => !!f && !!f.buffer)
      .map((f) => ({ media_type: f.mediaType || 'image/jpeg', data: (f.buffer as Buffer).toString('base64') }));
    const r = await runInCreditBundle(() => deps.extractFromImages({ images: payload, companyId, userId: userId || undefined }));
    visionText = r.eventText; visionEvents = r.events;
    readKeyToCharge = buildReadIdempotencyKey(companyId, m.attemptToken, imagesHashOf(imageUrls));
    buildVisionCache.set(visionKey, { at: Date.now(), eventText: r.eventText, events: r.events, settled: false, readKey: readKeyToCharge });
  }

  // 엔진 재료 — 카드 → 같은 조각(materialsFromEventCards) · 면허 카드 종료일(연도 있는 표기만) → 카운트다운 재료 · 상품 = 카드(몰 이미지) + 글줄(면허)
  const brandKit = readableCustomerBrandKit(await deps.brandKit(companyId));
  const basic = await deps.basicInfo(companyId).catch(() => null);
  const companyName = m.brandName || String(basic?.brand_name || '').trim() || String(basic?.company_name || '').trim() || '우리 브랜드';
  const industry = input.industry || String(basic?.industry_code || '').trim() || null;
  // ★ 2026-09-15 업종 아트디렉션(타이포 스케일·여백·구분선) · 회사 킷에 저장값이 있으면 그 값 · DM 킷과 이메일 design 이 같은 값을 쓴다(원장 무변경)
  const artDirection = brandKit.art_direction && typeof brandKit.art_direction === 'object' ? brandKit.art_direction : outreachArtDirection(industry);
  const fromCards = materialsFromEventCards(cards);
  const eventCards: EngineEventCard[] = fromCards.eventCards.map((ec, i) => {
    const c = cards[i];
    if (!c || !c.licensed || !c.text) return ec;
    const d = parseLicensedEndDate(c.text);
    return d.end ? { ...ec, endDate: d.end } : ec;
  });
  const productText = resolved.textLines.join('\n');
  const material = [fromCards.material, productText, materialTextFromEvents(visionEvents, visionText)].filter(Boolean).join('\n\n').slice(0, 6000)
    || '(행사 텍스트 없음 · 올린 이미지 중심으로 구성)';
  const licensedQuote = [fromCards.licensedQuote, ...resolved.textLines.map((l) => l.replace(/^- /, ''))].filter(Boolean).join(' · ');
  const engineMaterials: EngineMaterials = {
    companyName, industry, homepageUrl: fromCards.link || '', siteTitle: null, material, extraNotes: null,
    // ★ 2026-09-15 로고 = 회사 킷 로고 중 이 회사 서빙 경로만(외부 핫링크·파비콘 0)
    products: resolved.cards, gallery: fromCards.gallery, logoUrl: isCompanyImageUrl(brandKit.logo_url, companyId) ? String(brandKit.logo_url).trim() : null, posterUrl: null, posterSize: null, bannerUrl: null, bannerSize: null,
    ctaLinks: fromCards.ctaLinks, legal: null, licensedQuote, proof: null, eventCards,
  };
  const materialsHash = buildMaterialsHash(m, roles);
  const billingHash = buildBillingHash(m);
  const idempotencyKey = buildIdempotencyKey(companyId, m.channel, m.attemptToken, billingHash);
  const genKey = m.channel === 'email' ? 'email-ai-generate' : 'dm-ai-generate';
  const genCost = getCreditCost(genKey);

  // 조립 → 초안 행 → 차감. 이메일 렌더는 행 앞(렌더 실패 = 행 0).
  let draftId = '';
  let sections: Section[] = [];
  let pages: unknown[] = [];
  let look: OutreachLookStats;
  let benefitStripped = 0;
  let heroFallback = false;
  let features: EngineFeaturesResult;
  let subject: string | null = null;
  let preheader: string | null = null;
  let name = '';
  if (m.channel === 'dm') {
    const r = await deps.assembleDm(engineMaterials, {
      entry: 'customer', channel: 'DM', skeletonTypes: null, sectionOverride: null, presetSections: null, layoutMode: OUTREACH_DM_LAYOUT_MODE, features: m.features,
    });
    sections = r.sections; pages = r.pages; look = r.look; benefitStripped = r.benefitStripped; heroFallback = r.heroFallback; features = r.features;
    name = `[AI 자동제작] ${companyName}`.slice(0, 200);
    const dm = await deps.createDm(companyId, userId, {
      title: name, sections, pages, layout_mode: OUTREACH_DM_LAYOUT_MODE, brand_kit: { ...brandKit, art_direction: artDirection }, ai_prompt: material.slice(0, 2000), approval_status: 'draft',
    });
    draftId = String(dm.id);
  } else {
    const r = await deps.produceEmail({
      companyName, industry, homepageUrl: fromCards.link || '', siteTitle: null, material, extraNotes: null,
      benefitLicensed: !!licensedQuote, licensedQuote, posterUrl: null, posterSize: null, bannerUrl: null, bannerSize: null,
      media: {
        gallery: fromCards.gallery.map((g) => ({ url: g.url, width: g.width || 0, height: g.height || 0, srcUrl: g.url } as any)),
        products: resolved.cards as any,
        collectedAt: new Date().toISOString(),
        stats: { galleryCandidates: fromCards.gallery.length, galleryPassed: fromCards.gallery.length, productLinks: resolved.cards.length, productsFound: resolved.cards.length, productsPassed: resolved.cards.length },
      },
      mediaSelection: null, ctaLinks: fromCards.ctaLinks, legal: null, brandColor: null, proof: null, entry: 'customer', eventCards, features: m.features,
    }, { fill: (s, ch) => fillCustomerStandard(s, engineMaterials, ch) });
    // ★ 2026-09-15 CTA 풀폭 띠는 마지막 1개만(공용 룩 무변경) · 프리헤더는 면허 밖 수치를 거른 값만
    sections = keepLastCtaBar(r.sections); pages = []; look = lookStatsOf(sections); benefitStripped = r.benefitStripped; features = r.features; subject = r.subject; preheader = licensedPreheaderOf(r.preheader, licensedQuote) || null;
    name = `AI 자동제작 · ${companyName}`.slice(0, 60);
    // 미리보기·발송은 캠페인 design 으로 다시 렌더한다 · 생성 렌더와 저장이 같은 design 을 쓴다(주색 보정 · 업종 아트디렉션 · 프리헤더)
    const design = normalizeEmailDesign({ palette: { primary: brandKit.primary_color }, art_direction: artDirection, ...(preheader ? { preheader } : {}) });
    const rendered = deps.renderEmail(sections, brandKit, design);
    const campaign = await deps.createEmail({
      companyId, createdBy: userId, name, subject: subject || name, htmlBody: rendered.html, textBody: rendered.text,
      isAd: m.isAd === true, aiGenerated: true, sections,
      design,
    });
    draftId = String(campaign.id);
  }

  let deductOutcome: DeductOutcome;
  try {
    deductOutcome = await deps.deductOutcome({ companyId, cost: genCost, source: genKey, createdBy: userId || null, idempotencyKey });
  } catch (err) {
    // 원장 호출 자체가 던진 것 = 차감 이전 실패 → 만든 행을 거둔다(고아 0). 결말(failed)은 여기 오지 않는다(행 유지).
    try {
      if (m.channel === 'dm') await deps.deleteDm(draftId, companyId);
      else await deps.deleteEmail(companyId, draftId);
    } catch (cleanupErr: any) {
      console.log(`[ai-auto-build] 초안 회수 실패 company=${companyId} draft=${draftId} err=${cleanupErr?.message}`);
    }
    throw err;
  }
  if (deductOutcome === 'failed') {
    console.log(`[CREDIT][MISS] ai-auto-build company=${companyId} channel=${m.channel} key=${idempotencyKey} attemptToken=${m.attemptToken} draft=${draftId} cost=${genCost}`);
  }
  // 판독비 — 방금 읽었거나 미정산 캐시를 썼을 때 · 키 = 처음 읽은 시도의 것(멱등) · 성공·중복 = 캐시 정산 전이 · 생성비 차감 뒤 실패 = 행 유지(회수 0) · 던지면 failed 로 접고 [CREDIT][MISS]
  let readDeductOutcome: DeductOutcome | null = null;
  if (readKeyToCharge) {
    const readCost = getCreditCost('event-image-extract');
    try {
      readDeductOutcome = await deps.deductOutcome({ companyId, cost: readCost, source: 'event-image-extract', createdBy: userId || null, idempotencyKey: readKeyToCharge });
    } catch (err: any) {
      console.log(`[ai-auto-build] 판독비 차감 호출 실패 company=${companyId} key=${readKeyToCharge} err=${err?.message}`);
      readDeductOutcome = 'failed';
    }
    if (readDeductOutcome === 'failed') {
      console.log(`[CREDIT][MISS] ai-auto-build-read company=${companyId} key=${readKeyToCharge} attemptToken=${m.attemptToken} draft=${draftId} cost=${readCost}`);
    } else {
      const entry = buildVisionCache.get(visionKey);
      if (entry) entry.settled = true;
    }
  }

  const imagesUsed = new Set<string>();
  for (const s of sections) {
    const p: any = (s as any).props || {};
    if (typeof p.image_url === 'string' && p.image_url) imagesUsed.add(p.image_url);
    if (Array.isArray(p.images)) for (const im of p.images) if (im?.url) imagesUsed.add(String(im.url));
  }
  return {
    channel: m.channel,
    draftId,
    attemptToken: m.attemptToken,
    idempotencyKey,
    deductOutcome,
    readDeductOutcome,
    quote,
    sections,
    pages,
    layout_mode: OUTREACH_DM_LAYOUT_MODE,
    brand_kit: brandKit,
    look,
    benefitStripped,
    heroFallback,
    subject,
    preheader,
    name,
    materialsMeta: {
      images: images.length,
      imagesUsed: images.filter((im) => imagesUsed.has(im.url)).length,
      imagesDropped,
      textChars: m.textChars,
      origin: m.origin,
      licensed: !!fromCards.licensedQuote,
      reads,
      visionCached: !!cachedVision,
      products: resolved.cards.length,
      productsText: resolved.textLines.length,
      mallUnverified: resolved.mallUnverified,
      mallFailed: resolved.mallFailed,
      excluded: resolved.excluded,
      sections: sections.length,
      ctaCount: sections.filter((s) => String((s as any).type) === 'cta').length,
      eventCards: cards.length,
      imageRoles: roles,
      features,
      notes: customerFillNotes(engineMaterials, m.channel === 'email' ? 'EMAIL' : 'DM'),
      materialsHash,
      billingHash,
    },
  };
}
