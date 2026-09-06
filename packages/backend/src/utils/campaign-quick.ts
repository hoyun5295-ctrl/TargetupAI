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
import { createDm } from './dm/dm-builder';
import { getCompanyBrandKit } from './dm/dm-brand-kit';
import { getBrandBasicInfo } from './brand-basic-info';
import { getCreditCost } from './ai-credit-calc';
import { checkCredit, deductCreditSafe } from './ai-credit';
import { loadPlanContext, canUseFeature } from './plan-guard';
import { normalizeEventText, EVENT_TEXT_MAX } from './event-brief';
import { extractEventsFromImages, sniffImageMediaType, MAX_EVENT_IMAGES, type ExtractedEvent } from './event-image-extract';
import { readImageSize } from './sales-outreach-media';
import { assembleDmCampaign, type EngineMaterials, type EngineResult, type EngineEventCard } from './campaign-engine';
import { outreachEngineDeps, produceOutreachBrandEmail } from './sales-outreach-produce';
import { OUTREACH_DM_LAYOUT_MODE, type OutreachLookStats } from './sales-outreach-look';

// routes/dm.ts · utils/dm/dm-viewer-utils.ts 와 동일 정의 미러(서빙 경로 /api/dm/v/images/{companyId}/{filename})
const DM_IMAGE_DIR = path.join(process.cwd(), 'uploads', 'dm-images');

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

  const brandKit = await getCompanyBrandKit(companyId);
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
