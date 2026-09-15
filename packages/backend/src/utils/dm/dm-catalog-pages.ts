/**
 * dm-catalog-pages.ts — 카탈로그 DM 쪽 조립(순수 · DB 0)
 *
 * ★ 2026-09-15 카탈로그 DM = slides + 장마다 `list_1xN` 갤러리 1장(뷰어 자격 = dm-viewer-catalog.ts isCatalogDm · settings.catalog 는 호출부가 심는다).
 *   AI 자동제작 카탈로그 채널(campaign-quick.ts buildCatalogDm)과 아웃리치 카탈로그(sales-outreach-catalog.ts)가 같은 함수로 쪽을 짠다.
 *   link_url 은 있을 때만 싣는다(모바일 뷰어가 이미지를 링크로 감싼다 · dm-section-renderer renderGallery).
 */
import type { SlidePage } from './dm-slides-expand';

export interface CatalogPageImage { url: string; link_url?: string | null }

/** 이미지 N장 → 쪽 N개. id = `{prefix}-p{n}` · 섹션 id = `{prefix}-p{n}-img`(기본 prefix 'catalog' = AI 자동제작 현행 그대로). */
export function catalogPagesOf(images: readonly CatalogPageImage[], idPrefix = 'catalog'): SlidePage[] {
  return images.map((im, i) => ({
    id: `${idPrefix}-p${i + 1}`,
    sections: [{
      id: `${idPrefix}-p${i + 1}-img`, type: 'gallery', order: 0, visible: true,
      props: { images: [{ url: im.url, ...(im.link_url ? { link_url: im.link_url } : {}) }], layout: 'list_1xN', full_bleed: true },
    }],
  }));
}
