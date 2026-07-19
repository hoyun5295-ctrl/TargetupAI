/**
 * utils/dm-event-assembly.ts — 판독 구조(events[]) → DM 섹션 디터미니스틱 조립 (2026-07-19)
 *
 * ★ Harold 확정: 기획전 스샷 N장 → 판독 구조화(백엔드 extractEventsFromImages) → 이 유틸이
 *   행사마다 [히어로(제목·부제·혜택 verbatim) + 상품 슬라이드(제품명·정가·할인가·할인율)]를
 *   기존 섹션 타입으로 그대로 조립한다. AI 자유 생성이 아니라 코드 매핑 = "70% 완성" 보장.
 *
 * 원칙:
 *  - 문구·가격은 판독 verbatim만 사용(날조 0). 안 보인 값(0·빈)은 비워 둔다.
 *  - 상품 이미지는 스샷에서 추출 불가 → 빈 자리(편집기에서 라이브러리/업로드 = "자잘한 손질").
 *  - 순수 함수 — DB/IO 0.
 */
import { createSection, type Section } from './dm-section-defaults';

export interface ExtractedEventProduct {
  name: string;
  price?: number;
  sale_price?: number;
  discount_rate?: number;
}
export interface ExtractedEvent {
  brand?: string;
  title?: string;
  subtitle?: string;
  benefit?: string;
  products?: ExtractedEventProduct[];
}

/** events[] → DM 섹션 배열. 행사 = 히어로 + 상품 슬라이드(상품 있을 때). */
export function buildDmSectionsFromEvents(eventsIn: Array<Record<string, any>>): Section[] {
  const events = (eventsIn || []).filter(Boolean) as ExtractedEvent[];
  const sections: Section[] = [];
  let order = 0;

  for (const ev of events) {
    const title = String(ev.title || '').trim();
    const subtitle = String(ev.subtitle || '').trim();
    const benefit = String(ev.benefit || '').trim();
    const brand = String(ev.brand || '').trim();
    const products = (Array.isArray(ev.products) ? ev.products : []).filter((p) => p && String(p.name || '').trim());

    // 히어로 — 행사 제목·부제·혜택 verbatim (제목 없으면 브랜드명으로)
    if (title || subtitle || benefit || brand) {
      const subCopy = [subtitle, benefit].filter(Boolean).join('\n');
      sections.push(createSection('hero', order++, {
        headline: title || brand || '행사 안내',
        sub_copy: subCopy || undefined,
        align: 'center',
        height: 'md',
      }));
    }

    // 상품 슬라이드 — 제품명·정가·할인가·할인율 (이미지는 빈 자리 = 편집기에서 채움)
    if (products.length > 0) {
      sections.push(createSection('product_carousel', order++, {
        title: brand || undefined,
        products: products.map((p, i) => ({
          id: `ev-${order}-${i}`,
          image_url: '',
          name: String(p.name).trim(),
          price: Number(p.price) > 0 ? Number(p.price) : (Number(p.sale_price) > 0 ? Number(p.sale_price) : 0),
          discount_price: Number(p.sale_price) > 0 && Number(p.price) > 0 ? Number(p.sale_price) : undefined,
          discount_rate: Number(p.discount_rate) > 0 ? Number(p.discount_rate) : undefined,
        })),
      }));
    }
  }
  return sections;
}

/** DM 제목 파생 — 첫 행사 제목(없으면 브랜드) 기준. */
export function deriveDmTitleFromEvents(eventsIn: Array<Record<string, any>>): string {
  const first = (eventsIn || []).find((e) => e && (e.title || e.brand)) as ExtractedEvent | undefined;
  return String(first?.title || first?.brand || '행사 캠페인').trim().slice(0, 30) || '행사 캠페인';
}

/** 요약(토스트용) — 행사 N건·상품 M개. */
export function summarizeEvents(eventsIn: Array<Record<string, any>>): { events: number; products: number } {
  const events = (eventsIn || []).filter(Boolean) as ExtractedEvent[];
  return {
    events: events.length,
    products: events.reduce((s, e) => s + ((Array.isArray(e.products) ? e.products : []).length), 0),
  };
}
