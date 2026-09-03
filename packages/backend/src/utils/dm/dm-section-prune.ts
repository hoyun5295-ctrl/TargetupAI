/**
 * dm-section-prune.ts — 데이터가 없는 섹션 제거 + 페이지 재조립 (순수 · 2026-09-03)
 *
 * AI가 골격을 잡아도 재료(상품·이미지·기간·코드)가 없으면 "[상품을 추가해주세요]" 같은 빈 껍데기가 남는다.
 * 사람이 채울 화면(편집기·플래너 초안)에서는 그 자리가 안내이지만, **자동 발행되는 산출물(AI 영업 DM)** 에서는 결함이다.
 * 이 함수는 핵심 데이터가 비어 있는 섹션을 지우고, 남은 섹션으로 pages를 다시 만든다.
 * ⛔ header·hero·text_card·cta·footer는 지우지 않는다(최소 골격 = normalizeSectionChain이 보장하는 형태 그대로).
 * ⛔ 데이터 규칙을 모르는 타입은 지우지 않는다(모름을 없음으로 접지 않는다).
 */
import type { Section, SectionType } from './dm-section-registry';
import { decideLayoutMode, splitSectionsIntoPages, type DmLayoutMode } from './dm-page-split';

const nonEmpty = (v: unknown): boolean => String(v ?? '').trim() !== '';
const isPlaceholder = (v: unknown): boolean => /\[[^\]]*(직접|추가|입력)[^\]]*\]/.test(String(v ?? ''));

/** 이 섹션이 그리려는 핵심 데이터가 있는가. 규칙이 없는 타입 = true(보존). */
export function hasSectionData(s: Section): boolean {
  const p: any = (s && typeof s.props === 'object' && s.props) ? s.props : {};
  switch (s.type) {
    case 'product_carousel':
      return (Array.isArray(p.products) ? p.products : []).some((x: any) => nonEmpty(x?.name) && !isPlaceholder(x?.name));
    case 'gallery':
      return (Array.isArray(p.images) ? p.images : []).some((x: any) => nonEmpty(x?.url));
    case 'slideshow':
      return (Array.isArray(p.slides) ? p.slides : []).some((x: any) => nonEmpty(x?.image_url));
    case 'video':
      return nonEmpty(p.video_url);
    case 'countdown':
      return nonEmpty(p.end_datetime);
    case 'coupon':
      return nonEmpty(p.discount_label) && !isPlaceholder(p.discount_label);
    case 'promo_code':
      return nonEmpty(p.code) && !isPlaceholder(p.code);
    case 'store_info':
      return nonEmpty(p.address) || nonEmpty(p.phone) || nonEmpty(p.business_hours);
    case 'sns':
      return (Array.isArray(p.channels) ? p.channels : []).length > 0;
    case 'tab_cards':
      return (Array.isArray(p.tabs) ? p.tabs : []).some((t: any) => nonEmpty(t?.content) && !isPlaceholder(t?.content));
    default:
      return true;
  }
}

const ALWAYS_KEEP: ReadonlySet<string> = new Set<SectionType>(['header', 'hero', 'text_card', 'cta', 'footer']);

/** 핵심 데이터가 없는 섹션 제거. 반환은 입력의 부분집합(더하기 0). */
export function pruneEmptyDmSections(sections: readonly Section[]): { sections: Section[]; removed: SectionType[] } {
  const kept: Section[] = [];
  const removed: SectionType[] = [];
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!s || typeof s !== 'object') continue;
    if (ALWAYS_KEEP.has(s.type) || hasSectionData(s)) { kept.push(s); continue; }
    if (!removed.includes(s.type)) removed.push(s.type);
  }
  return { sections: kept, removed };
}

/** order 재부여 + 레이아웃 모드·pages 재조립(편집기=발송 파리티: sections와 pages는 같은 배열에서 나온다). */
export function rebuildDmPages(sections: readonly Section[]): { sections: Section[]; layoutMode: DmLayoutMode; pages: Section[][] } {
  const ordered = sections.map((s, i) => ({ ...s, order: i }));
  const layoutMode = decideLayoutMode(ordered);
  const pages = splitSectionsIntoPages(ordered, layoutMode);
  return { sections: ordered, layoutMode, pages };
}
