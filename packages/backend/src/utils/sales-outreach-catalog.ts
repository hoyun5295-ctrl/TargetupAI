/**
 * sales-outreach-catalog.ts — ★ 2026-09-15 아웃리치 카탈로그 DM(Harold "AI 영업에 카탈로그 적용")
 *
 * 크롤 사본만으로(AI 호출 0 · 크레딧 0 · 내부 전용 회사 계정) 장마다 이미지 1장인 slides DM 을 하나 더 발행하고(settings.catalog · PC 책 펼침 · 휴대폰 슬라이드)
 * 제안 메일 3번째 버튼 "카탈로그 보기"(sales-outreach-produce.ts buildProposalEmailSections)와 검토 화면 "담당자가 열 주소"가 그 주소를 쓴다.
 *
 * 장 구성 = 포스터(있으면) → 상품 카드(≤6 · 서버 합성 1200×1600 · 흰 바탕 + 브랜드색 8% 틴트 · 상품 사본 contain · 상품명 캡션) → 행사 슬라이스(≤3 · selectEventSlices 그대로).
 * 2쪽 미만이면 만들지 않는다(뷰어 자격 isCatalogDm = 2쪽 이상). 링크 = 상품 URL · 히어로 링크 · 행사 상세(모바일 탭 이동 · PC 책은 링크 없음 = 범위 밖 기록).
 * 캡션 게이트 = 포스터 문구와 같은 posterTextOk(숫자 0 · 혜택어 0) · 가격은 이미지에 넣지 않는다(이미지 글자 숫자 0 원칙 · 가격은 DM 상품 카드가 글자로 낸다).
 * 실패 격리 = 호출부(sales-outreach-jobs.ts producing_dm)가 try/catch · 카탈로그 실패는 DM 단계를 실패시키지 않는다(catalogSkipped 'error').
 * 파기 = purgeOutreachJobArtifacts 가 catalogDmId 중지 + catalogImageUrls 삭제 · 재조립 = stopSupersededDms 가 옛 catalogDmId 중지.
 */
import fs from 'fs';
import sharp from 'sharp';
import {
  composeImage, writeTempBuffer, findTempFile, allocTempPath, writeTempMeta, moveTempToPermanent, inappImageLocalPath, type ComposeTypography,
} from './image-studio';
import { createDm, publishDm } from './dm/dm-builder';
import { catalogPagesOf, type CatalogPageImage } from './dm/dm-catalog-pages';
import { selectEventSlices, OUTREACH_STD_EVENT_SLICES_MAX, type EventSliceMaterial } from './sales-outreach-slices';
import {
  PUBLIC_BASE, productNameForImage, outreachPosterFontPath, assertOutreachPublisher, outreachDmUrlsOf, galleryLinkOf, fetchImageGuarded,
  type OutreachMedia, type PublishedDmRef,
} from './sales-outreach-produce';
import type { EngineEventCard } from './campaign-engine';
import type { Section } from './dm/dm-section-registry';
import type { DmBrandKit } from './dm/dm-tokens';

export const OUTREACH_CATALOG_PRODUCTS_MAX = 6;
export const OUTREACH_CATALOG_SLICES_MAX = OUTREACH_STD_EVENT_SLICES_MAX;
export const OUTREACH_CATALOG_MIN_PAGES = 2;
/** 상품 카드 캔버스(3:4 · 포스터와 같은 비율) */
export const OUTREACH_CATALOG_CARD = { width: 1200, height: 1600 } as const;
/** 흰 바탕에 섞는 브랜드색 비율 */
export const OUTREACH_CATALOG_TINT = 0.08;
/** 상품 사본 확대 상한(400px 사본이 흐려지지 않게) */
export const OUTREACH_CATALOG_UPSCALE_MAX = 2;
/** 캡션 길이 상한 */
export const OUTREACH_CATALOG_CAPTION_MAX = 30;
/** 카탈로그 DM 쪽·섹션 id 접두(레시피 provenance · AI 자동제작 'catalog' 와 구분) */
export const OUTREACH_CATALOG_ID_PREFIX = 'so-cat';

export type CatalogSkip = 'too_few_images' | 'error';
export interface CatalogPlanPage { kind: 'poster' | 'product' | 'slice'; url: string; linkUrl: string | null; caption: string | null }
export interface CatalogPlan { pages: CatalogPlanPage[]; skipped: CatalogSkip | null }
export interface CatalogBuildResult {
  catalogDmId: string | null;
  catalogUrl: string | null;
  catalogViewerUrl: string | null;
  catalogPages: number;
  /** 서버가 합성한 상품 카드 파일(파기 때 삭제) */
  catalogImageUrls: string[];
  catalogSkipped: CatalogSkip | null;
}
export type Rgb = { r: number; g: number; b: number };

/**
 * 상품명 → 쪽 캡션(순수). 괄호·대괄호 안 제거 · 공백 정리 · 포스터 문구 게이트(2자 이상 · 숫자 0 · 혜택어 0) · 30자 이내. 아니면 null(글자 없이 사진만).
 * ★ 2026-09-24 품질 A(A6) — 용량·수량·판번호 낱말("50g"·"2.0")은 떼고 업체명의 숫자는 게이트 밖(productNameForImage · 포스터 부제와 같은 규칙).
 *   톤28 실측: 상품명 거의 전부가 용량 표기 때문에 캡션 0 이었다.
 */
export function catalogCaptionOf(name: string | null | undefined, companyName: string | null = null): string | null {
  const t = productNameForImage(name, companyName);
  if (!t || t.length > OUTREACH_CATALOG_CAPTION_MAX) return null;
  return t;
}

/** 카드 바탕색(순수) — 흰 바탕 92% + 브랜드색 8%. 6자리 hex 가 아니면 흰색. */
export function catalogTintOf(brandColor: string | null | undefined): Rgb {
  const m = String(brandColor || '').trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return { r: 255, g: 255, b: 255 };
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(255 * (1 - OUTREACH_CATALOG_TINT) + c * OUTREACH_CATALOG_TINT);
  return { r: mix((n >> 16) & 255), g: mix((n >> 8) & 255), b: mix(n & 255) };
}

export interface CatalogPlanInput {
  posterUrl: string | null;
  media: OutreachMedia | null;
  eventCards: readonly EngineEventCard[] | null | undefined;
  eventSlices: EventSliceMaterial | null | undefined;
  ctaLinks: Record<string, string>;
  homepageUrl: string;
  /** ★ 2026-09-24 품질 A — 캡션 숫자 게이트에서 가릴 업체명 */
  companyName?: string | null;
}

/**
 * 장 구성(순수) — 포스터 → 상품(이미지·링크·이름 있는 것 ≤6) → 행사 슬라이스(판정 선별 ≤3). 같은 주소는 1번. 2쪽 미만 = skipped.
 * 히어로 링크 = 첫 행사 카드 상세 → 기획전 딥링크 → 홈(표준 조립 standardMaterialsOf 와 같은 우선순위).
 */
export function planOutreachCatalog(input: CatalogPlanInput): CatalogPlan {
  const pages: CatalogPlanPage[] = [];
  const seen = new Set<string>();
  const push = (p: CatalogPlanPage) => { if (p.url && !seen.has(p.url)) { seen.add(p.url); pages.push(p); } };
  const cards = (input.eventCards || []).filter((c) => c && String(c.title || '').trim());
  const galleryLink = galleryLinkOf({ ctaLinks: input.ctaLinks || {}, homepageUrl: input.homepageUrl });
  const heroLink = cards[0]?.detailUrl || galleryLink;
  if (input.posterUrl) push({ kind: 'poster', url: String(input.posterUrl), linkUrl: heroLink, caption: null });
  const products = (input.media?.products || [])
    .filter((p) => p && p.image_url && p.link_url && String(p.name || '').trim())
    .slice(0, OUTREACH_CATALOG_PRODUCTS_MAX);
  for (const p of products) push({ kind: 'product', url: String(p.image_url), linkUrl: String(p.link_url), caption: catalogCaptionOf(p.name, input.companyName || null) });
  const sliceLink = input.eventSlices?.detailUrl || input.homepageUrl;
  // ★ 2026-09-24 품질 A(A6) — 카탈로그 쪽은 판정이 배너·상품인 슬라이스만(글자 없는 풍경 사진 한 쪽 = 카탈로그가 아니다 · 톤28 실측 해안 항공사진).
  //   DM 행사 블록 선별(selectEventSlices)은 그대로 두고 여기서만 거른다. 판정이 없으면(모델 부재) 종전.
  const kinds = input.media?.imageKinds || null;
  for (const s of selectEventSlices(input.media?.slices || [], kinds, OUTREACH_CATALOG_SLICES_MAX)) {
    if (kinds) { const k = kinds[s.url]?.kind; if (k !== 'banner' && k !== 'product') continue; }
    push({ kind: 'slice', url: s.url, linkUrl: sliceLink, caption: null });
  }
  if (pages.length < OUTREACH_CATALOG_MIN_PAGES) return { pages: [], skipped: 'too_few_images' };
  return { pages, skipped: null };
}

/**
 * 상품 카드 캔버스(sharp · AI 0) — 틴트 바탕 1200×1600 · 상품 사본을 위 띠(높이 8%~72% · 폭 80%) 안에 contain(확대 2배 상한) · 알파는 틴트 위에 편평화.
 * 캡션 글자는 여기 안 찍는다(호출부가 파이썬 합성기 typography 로 찍는다 · 한글 폰트 보증). JPEG 90.
 */
export async function renderCatalogCardBuffer(product: Buffer, opts: { tint: Rgb }): Promise<{ buffer: Buffer; width: number; height: number }> {
  const W = OUTREACH_CATALOG_CARD.width;
  const H = OUTREACH_CATALOG_CARD.height;
  const boxW = Math.round(W * 0.8);
  const boxTop = Math.round(H * 0.08);
  const boxH = Math.round(H * 0.72) - boxTop;
  // ★ 2026-09-24 품질 A(A6) — 원본의 균일 바탕 여백을 먼저 잘라 상품을 크게(톤28 실측: 흰 여백째 contain → 상품이 위쪽에 작게). 자를 게 없거나 실패하면 원본.
  let base = product;
  try {
    const trimmed = await sharp(product, { failOn: 'none' }).trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
    if (trimmed.info.width >= 8 && trimmed.info.height >= 8) base = trimmed.data;
  } catch { base = product; }
  const src = sharp(base, { failOn: 'none' });
  const meta = await src.metadata();
  const sw = Number(meta.width) || 1;
  const sh = Number(meta.height) || 1;
  const scale = Math.min(boxW / sw, boxH / sh, OUTREACH_CATALOG_UPSCALE_MAX);
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));
  const placed = await src.flatten({ background: opts.tint }).resize({ width: tw, height: th, fit: 'fill' }).png().toBuffer();
  const left = Math.round((W - tw) / 2);
  const top = boxTop + Math.round((boxH - th) / 2);
  const buffer = await sharp({ create: { width: W, height: H, channels: 3, background: opts.tint } })
    .composite([{ input: placed, left, top }])
    .jpeg({ quality: 90 })
    .toBuffer();
  return { buffer, width: W, height: H };
}

/** 우리 사본 URL → 바이트. 로컬 실물이 있으면 디스크에서, 아니면 guarded fetch(https · 사설망 차단). 못 읽으면 null. */
export async function readCatalogSource(url: string): Promise<Buffer | null> {
  const local = inappImageLocalPath(url);
  if (local) {
    try { if (fs.existsSync(local)) return fs.readFileSync(local); } catch { /* 폴백 */ }
  }
  const fetched = await fetchImageGuarded(url).catch(() => null);
  return fetched?.buffer || null;
}

/** 캡션 타이포 1줄(순수) — 카드 아래 띠(y 0.84) 가운데 · 폭 맞춤(3:4) · 바탕이 밝으니 짙은 글자. */
export function catalogCaptionTypography(caption: string, fontPath: string | null): ComposeTypography[] {
  const wh = OUTREACH_CATALOG_CARD.width / OUTREACH_CATALOG_CARD.height;
  const size = Math.max(0.02, Math.min(0.04, (0.9 * wh) / Math.max(1, caption.length)));
  return [{ text: caption, fontPath, size, color: '#111111', align: 'center', x: 0.5, y: 0.84, weight: 'bold' } as ComposeTypography];
}

/**
 * 상품 카드 1장 합성 → 영구 저장 → 공개 URL. 실패(사본 못 읽음 · 합성 예외)는 null(호출부는 상품 사본 원본을 그대로 쪽으로 쓴다).
 */
export async function composeCatalogProductCard(input: { companyId: string; imageUrl: string; caption: string | null; brandColor: string | null; fontPath: string | null }): Promise<string | null> {
  try {
    const src = await readCatalogSource(input.imageUrl);
    if (!src) return null;
    const card = await renderCatalogCardBuffer(src, { tint: catalogTintOf(input.brandColor) });
    const baseId = writeTempBuffer(input.companyId, card.buffer, { kind: 'composite', ext: 'jpeg', mime: 'image/jpeg', width: card.width, height: card.height });
    let finalId = baseId;
    if (input.caption) {
      const baseFile = findTempFile(input.companyId, baseId);
      if (!baseFile) return null;
      const out = allocTempPath(input.companyId, 'jpeg');
      const composed = await composeImage({
        bgPath: baseFile.absPath, cutoutPath: null, layout: null, outPath: out.absPath, format: 'jpeg',
        typography: catalogCaptionTypography(input.caption, input.fontPath),
      });
      writeTempMeta(input.companyId, out.tempId, { kind: 'composite', ext: 'jpeg', mime: 'image/jpeg', width: composed.width, height: composed.height });
      finalId = out.tempId;
      try { fs.unlinkSync(baseFile.absPath); fs.unlinkSync(baseFile.absPath.replace(/\.jpeg$/, '.json')); } catch { /* 스윕이 치운다 */ }
    }
    const moved = moveTempToPermanent(input.companyId, finalId);
    return moved ? PUBLIC_BASE + moved.url : null;
  } catch (err: any) {
    console.log('[sales-outreach] 카탈로그 상품 카드 합성 실패(사본 원본으로):', input.imageUrl.slice(0, 120), err?.message);
    return null;
  }
}

/** 카탈로그 DM 발행(createDm + publishDm · 1회 · 내부 전용 회사 계정 자기 확인 · 라우트 미경유 = 미차감). */
export async function publishOutreachCatalogDm(images: readonly CatalogPageImage[], input: { companyId: string; userId: string; companyName: string; brandKit: DmBrandKit }): Promise<PublishedDmRef> {
  assertOutreachPublisher(input);
  const pages = catalogPagesOf(images, OUTREACH_CATALOG_ID_PREFIX);
  const sections = pages.flatMap((p) => p.sections) as unknown as Section[];
  const dm = await createDm(input.companyId, input.userId, {
    // ★ 2026-09-24 품질 A(A3) — 카톡 링크 미리보기(og:title)에 내부 표식 노출 0 · 학습 제외는 원장 연결(payload.catalogDmId)
    title: `${input.companyName} 카탈로그`.slice(0, 200),
    sections,
    pages,
    layout_mode: 'slides',
    settings: { catalog: true },
    brand_kit: input.brandKit,
    ai_prompt: '',
    approval_status: 'draft',
  } as any);
  const published = await publishDm(String(dm.id), input.companyId);
  if (!published?.short_code) throw new Error('카탈로그 DM 발행 주소를 만들지 못했습니다.');
  return { dmId: String(dm.id), ...outreachDmUrlsOf(published.short_code) };
}

/**
 * 계획 → 상품 카드 합성 → 발행. 계획이 skipped 면 그대로 skipped. 합성 실패 쪽은 사본 원본으로(쪽 수 유지).
 * 던지지 않는 것은 합성만 · 발행 예외는 호출부 try/catch(격리)로 올린다.
 */
export async function buildOutreachCatalog(input: { companyId: string; userId: string; companyName: string; brandColor: string | null; brandKit: DmBrandKit; plan: CatalogPlan }): Promise<CatalogBuildResult> {
  const none: CatalogBuildResult = { catalogDmId: null, catalogUrl: null, catalogViewerUrl: null, catalogPages: 0, catalogImageUrls: [], catalogSkipped: null };
  if (input.plan.skipped || input.plan.pages.length < OUTREACH_CATALOG_MIN_PAGES) return { ...none, catalogSkipped: input.plan.skipped || 'too_few_images' };
  const fontPath = outreachPosterFontPath();
  const images: CatalogPageImage[] = [];
  const made: string[] = [];
  for (const p of input.plan.pages) {
    if (p.kind === 'product') {
      const card = await composeCatalogProductCard({ companyId: input.companyId, imageUrl: p.url, caption: p.caption, brandColor: input.brandColor, fontPath });
      if (card) made.push(card);
      images.push({ url: card || p.url, link_url: p.linkUrl });
    } else {
      images.push({ url: p.url, link_url: p.linkUrl });
    }
  }
  const pub = await publishOutreachCatalogDm(images, input);
  return { catalogDmId: pub.dmId, catalogUrl: pub.dmUrl, catalogViewerUrl: pub.viewerUrl, catalogPages: images.length, catalogImageUrls: made, catalogSkipped: null };
}
