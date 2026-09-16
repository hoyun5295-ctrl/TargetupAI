/**
 * dm-catalog-render.ts — 쪽 템플릿 → 쪽 이미지 1장 합성 (sharp + 파이썬 글자 합성)
 *
 * ★ 2026-09-16 (Harold 승인) 템플릿이 정한 자리에 고객 사진을 얹고 글자를 새겨 1200×1600 이미지 한 장을 만든다.
 *   결과는 장 1개(갤러리 1장)가 되므로 카탈로그 책 자격(dm-slides-expand isSwipeImagePage)을 그대로 통과한다.
 *
 * 자리·줄 나눔·글자 항목 = dm-catalog-templates.ts(순수) 소유. 이 파일은 **실행**만 한다.
 * 글자는 파이썬 합성기(image-studio composeImage)가 찍는다 — 한글 폰트 보증이 거기 있다.
 * 숫자(가격·할인율)는 새기지 않는다. 상품 정보는 쪽 밖 칩이 담당한다(설계서 §5-3).
 */
import fs from 'fs';
import sharp from 'sharp';
import {
  composeImage, writeTempBuffer, findTempFile, allocTempPath, writeTempMeta, moveTempToPermanent, inappImageLocalPath, type ComposeTypography,
} from '../image-studio';
import { dmImageLocalPath } from './dm-viewer-utils';
import {
  CATALOG_PAGE, catalogTemplateOf, imageSlotPx, catalogTypographyOf,
  type CatalogTemplateKey, type CatalogTextValues, type CatalogImageSlot,
} from './dm-catalog-templates';

export interface Rgb { r: number; g: number; b: number }

/** 흰 바탕에 브랜드색을 옅게 섞은 쪽 바탕(아웃리치 카탈로그 카드와 같은 8%) */
export const CATALOG_TINT_RATIO = 0.08;
export function catalogTintRgb(brandColor: string | null | undefined): Rgb {
  const hex = String(brandColor || '').trim();
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return { r: 255, g: 255, b: 255 };
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * CATALOG_TINT_RATIO);
  return { r: mix((n >> 16) & 255), g: mix((n >> 8) & 255), b: mix(n & 255) };
}

export interface CatalogPlacement { slot: CatalogImageSlot; src: string; px: { left: number; top: number; width: number; height: number } }
export interface CatalogRenderPlan {
  template: CatalogTemplateKey;
  placements: CatalogPlacement[];
  /** 자리에 견줘 모자란 사진 수(0이면 다 찼다) */
  missingPhotos: number;
  /** 사진 자리가 없는 템플릿(마무리 안내)인가 */
  textOnly: boolean;
}

/**
 * 템플릿 + 사진 목록 → 배치 계획(순수). 사진이 자리보다 적으면 있는 만큼만 얹고 모자란 수를 알린다.
 * 사진이 자리보다 많으면 앞에서부터 자리 수만큼 쓴다.
 */
export function planCatalogPage(template: CatalogTemplateKey, photos: readonly string[]): CatalogRenderPlan {
  const tpl = catalogTemplateOf(template);
  const usable = (photos || []).map((p) => String(p || '').trim()).filter(Boolean);
  const placements: CatalogPlacement[] = [];
  tpl.images.forEach((slot, i) => {
    const src = usable[i];
    if (!src) return;
    placements.push({ slot, src, px: imageSlotPx(slot) });
  });
  return {
    template: tpl.key,
    placements,
    missingPhotos: Math.max(0, tpl.images.length - usable.length),
    textOnly: tpl.images.length === 0,
  };
}

/** 우리 저장본(DM 업로드·소재 라이브러리)만 읽는다. 외부 주소는 합성에 쓰지 않는다(고객 입구 = 자기 사진) */
export function readLocalImage(url: string): Buffer | null {
  const local = dmImageLocalPath(url) || inappImageLocalPath(url);
  if (!local) return null;
  try { return fs.existsSync(local) ? fs.readFileSync(local) : null; } catch { return null; }
}

/** 표지처럼 사진이 쪽 전체를 덮는 템플릿의 아래쪽 어둠(글자가 읽히게) */
function veilSvg(): Buffer {
  const { width: W, height: H } = CATALOG_PAGE;
  const top = Math.round(H * 0.52);
  return Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="rgb(10,8,22)" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="rgb(10,8,22)" stop-opacity="0.78"/></linearGradient></defs>` +
    `<rect x="0" y="${top}" width="${W}" height="${H - top}" fill="url(#v)"/></svg>`,
  );
}

/** 사진 1장을 자리 크기에 맞춘 버퍼로 (cover = 채우고 잘라냄 · contain = 안에 넣고 여백은 바탕색) */
async function fitPhoto(buf: Buffer, p: CatalogPlacement, bg: Rgb): Promise<Buffer> {
  return sharp(buf, { failOn: 'none' })
    .flatten({ background: bg })
    .resize({
      width: p.px.width,
      height: p.px.height,
      fit: p.slot.fit === 'cover' ? 'cover' : 'contain',
      position: 'attention',
      background: bg,
    })
    .png()
    .toBuffer();
}

export interface CatalogPageInput {
  companyId: string;
  template: CatalogTemplateKey;
  /** 자리 순서대로 쓸 사진(우리 저장본 주소) */
  photos: readonly string[];
  texts: CatalogTextValues;
  brandColor?: string | null;
  /** 한글 글꼴 경로(미지정이면 합성기 기본 글꼴) */
  fontPath?: string | null;
}

/**
 * 쪽 1장 합성 → 영구 저장 → 공개 경로(/api/cdp/inapp/image/...) 반환.
 * 사진을 하나도 못 읽고 글자 자리도 비면 null(호출부가 그 쪽을 만들지 않는다).
 */
export async function renderCatalogTemplatePage(input: CatalogPageInput): Promise<string | null> {
  const { width: W, height: H } = CATALOG_PAGE;
  const tpl = catalogTemplateOf(input.template);
  const bg = catalogTintRgb(input.brandColor);
  const plan = planCatalogPage(input.template, input.photos);
  const typo = catalogTypographyOf(input.template, input.texts, input.fontPath ?? null);
  if (plan.placements.length === 0 && typo.length === 0) return null;

  try {
    const layers: Array<{ input: Buffer; left: number; top: number }> = [];
    for (const p of plan.placements) {
      const src = readLocalImage(p.src);
      if (!src) continue;
      layers.push({ input: await fitPhoto(src, p, bg), left: p.px.left, top: p.px.top });
    }
    if (tpl.veil && layers.length > 0) layers.push({ input: veilSvg(), left: 0, top: 0 });

    const base = await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
      .composite(layers)
      .jpeg({ quality: 90 })
      .toBuffer();

    const baseId = writeTempBuffer(input.companyId, base, { kind: 'composite', ext: 'jpeg', mime: 'image/jpeg', width: W, height: H });
    let finalId = baseId;

    if (typo.length > 0) {
      const found = findTempFile(input.companyId, baseId);
      if (!found) return null;
      const out = allocTempPath(input.companyId, 'jpeg');
      const composed = await composeImage({
        bgPath: found.absPath, cutoutPath: null, layout: null, outPath: out.absPath, format: 'jpeg',
        typography: typo as unknown as ComposeTypography[],
      });
      writeTempMeta(input.companyId, out.tempId, { kind: 'composite', ext: 'jpeg', mime: 'image/jpeg', width: composed.width, height: composed.height });
      finalId = out.tempId;
      try { fs.unlinkSync(found.absPath); fs.unlinkSync(found.absPath.replace('.jpeg', '.json')); } catch { /* 스윕이 치운다 */ }
    }

    const moved = moveTempToPermanent(input.companyId, finalId);
    return moved ? moved.url : null;
  } catch (err: any) {
    console.error('[dm-catalog-render] 쪽 합성 실패:', input.template, err?.message);
    return null;
  }
}
