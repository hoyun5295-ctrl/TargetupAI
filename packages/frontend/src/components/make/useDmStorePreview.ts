/**
 * useDmStorePreview — 지금 고치는 DM(스토어 상태)을 서버 뷰어로 그린다(★ 2026-09-27 만들기 개편 S10 · 무저장 미리보기).
 * 본문 = 스토어 저장 본문과 같은 모양(pages + 평평한 sections + layout_mode + settings.catalog/effect + brand_kit + title).
 */
import { useMemo } from 'react';
import { useDmBuilderStore } from '../../stores/dmBuilderStore';
import { fetchDmPreview, useRenderedHtml } from '../../hooks/useRenderedHtml';

export function useDmStorePreview(enabled: boolean) {
  const dmId = useDmBuilderStore((s) => s.dmId);
  const title = useDmBuilderStore((s) => s.title);
  const pages = useDmBuilderStore((s) => s.pages);
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const layoutMode = useDmBuilderStore((s) => s.layoutMode);
  const catalogView = useDmBuilderStore((s) => s.catalogView);
  const pageEffect = useDmBuilderStore((s) => s.pageEffect);
  const body = useMemo(() => ({
    title,
    pages,
    sections: pages.flatMap((p) => p.sections),
    layout_mode: layoutMode,
    settings: {
      catalog: layoutMode === 'slides' && catalogView,
      ...(layoutMode === 'slides' && pageEffect !== 'slide' ? { effect: pageEffect } : {}),
    },
    brand_kit: brandKit,
  }), [title, pages, brandKit, layoutMode, catalogView, pageEffect]);
  const key = enabled && dmId ? `${dmId}|${JSON.stringify(body)}` : null;
  const r = useRenderedHtml(key, (signal) => fetchDmPreview(dmId as string, body, signal), 400);
  const kind = layoutMode === 'slides' ? (catalogView ? 'catalog' : 'dm-slides') : 'dm';
  return { ...r, kind: kind as 'dm' | 'dm-slides' | 'catalog' };
}
