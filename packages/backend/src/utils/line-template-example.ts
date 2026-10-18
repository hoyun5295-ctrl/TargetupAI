/**
 * line-template-example.ts — 템플릿 예시(가상 업체) 렌더 (★ 2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md §2-7)
 *
 * 예시 = **진짜 조립 함수 + 진짜 렌더러**에 가상 업체 고정 재료를 넣은 결과(손으로 만든 목업 0 · 보이는 것 = 나오는 것).
 * 요청 준비(회사 경로 사진 검사)를 지나지 않는다 — 예시 사진은 저장소 정적 파일(frontend/public/diagnosis-examples/assets).
 * 순수 · AI 0 · DB 0 · 날짜만 nowMs 로 받는다(마감 예시).
 */
import { randomUUID } from 'crypto';
import { renderDmViewerHtml } from './dm/dm-viewer';
import { renderEmailSections } from './email/email-section-renderer';
import type { DmBrandKit } from './dm/dm-tokens';
import { formatLinePeriodEnd, kstDayOf } from './one-line-steps';
import type { LineTemplate, LineLayout, LineChannel } from './design-core/line-templates';
import { composeLineDm, composeLineEmail, composeLineInapp, type LineMaterials, type LineInAppMessage } from './line-template-compose';
import { lineExampleCopy } from './line-template-copy';

/** 'YYYY-MM-DD'(KST 오늘 + days) */
export function kstDatePlus(nowMs: number, days: number): string {
  const d = kstDayOf(nowMs + days * 86_400_000);
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export function lineExampleMaterials(t: LineTemplate, nowMs: number): LineMaterials {
  const ex = t.example;
  const periodEnd = ex.periodDays !== null ? kstDatePlus(nowMs, ex.periodDays) : null;
  return {
    brandName: ex.company,
    hero: ex.hero ? { url: ex.hero } : null,
    products: ex.products.map((p) => ({ name: p.name, price: p.price, ...(p.discount_price ? { discount_price: p.discount_price } : {}), image_url: p.image_url, link_url: 'https://example.com/product' })),
    textProducts: [],
    benefit: ex.benefit,
    periodEnd,
    periodLabel: periodEnd ? `${formatLinePeriodEnd(periodEnd)}까지` : null,
    link: 'https://example.com/event',
  };
}

const exampleKit = (t: LineTemplate): DmBrandKit => ({ primary_color: t.design.primary, accent_color: t.design.accent } as DmBrandKit);

/** 예시 한 벌 — DM · 이메일 = html · 인앱 = 메시지 JSON(화면이 인앱 미리보기 부품으로 그린다) */
export function renderLineTemplateExample(t: LineTemplate, channel: LineChannel, layout: LineLayout, nowMs: number): { html: string; layout: LineLayout } | { message: LineInAppMessage } {
  const m = lineExampleMaterials(t, nowMs);
  const copy = lineExampleCopy(t);
  if (channel === 'inapp') return { message: composeLineInapp(t, m, copy) };
  if (channel === 'email') {
    const r = composeLineEmail(t, m, copy, () => randomUUID());
    return { html: renderEmailSections(r.sections, { brandKit: exampleKit(t), storeName: m.brandName }), layout: 'page' };
  }
  const r = composeLineDm(t, layout, m, copy, () => randomUUID());
  const dm = { title: `${m.brandName} 예시`, store_name: m.brandName, layout_mode: r.layoutMode, pages: r.pages, sections: r.sections, brand_kit: { ...exampleKit(t), ...r.brandKitPatch }, short_code: '' };
  return { html: renderDmViewerHtml(dm, ''), layout: r.layout };
}
