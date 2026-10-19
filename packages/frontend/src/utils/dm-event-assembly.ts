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

/** 숫자가 든 글인가 — 숫자 판정 · 빼기의 단일 규칙(확인 창 판정과 조립이 같은 규칙을 쓴다 · F1b) */
const hasDigit = (v: unknown): boolean => /\p{Nd}/u.test(String(v ?? ''));   // 유니코드 숫자 전부(전각 ５ 포함 · F2)

/** ★ 2026-10-19 B-1017-1① — 사진에서 읽은 숫자(가격 · 할인가 · 할인율 · 숫자가 든 제목 · 부제 · 혜택 · 브랜드 · 상품명)가 있는가(있으면 화면이 쓸지 묻는다) */
export function eventsHaveNumbers(eventsIn: Array<Record<string, any>>): boolean {
  return (eventsIn || []).filter(Boolean).some((ev: any) =>
    [ev?.title, ev?.subtitle, ev?.benefit, ev?.brand].some(hasDigit)
    || (Array.isArray(ev?.products) ? ev.products : []).some((p: any) => hasDigit(p?.name) || Number(p?.price) > 0 || Number(p?.sale_price) > 0 || Number(p?.discount_rate) > 0));
}

/**
 * events[] → DM 섹션 배열. 행사 = 히어로 + 상품 슬라이드(상품 있을 때).
 * ★ 2026-10-19 B-1017-1① keepNumbers = 사진에서 읽은 숫자도 그대로 쓴다(사람이 고른 때만 · 10-10 H3).
 *   false(기본) = 가격 · 할인가 · 할인율을 비우고, 숫자가 든 글(제목 · 부제 · 혜택 · 브랜드)은 싣지 않고, 이름에 숫자가 든 상품은 뺀다
 *   (사진을 잘못 읽은 숫자가 고객에게 나가지 않게 · eventsHaveNumbers 와 같은 hasDigit).
 */
export function buildDmSectionsFromEvents(eventsIn: Array<Record<string, any>>, opts: { keepNumbers?: boolean } = {}): Section[] {
  const keepNumbers = opts.keepNumbers === true;
  const events = (eventsIn || []).filter(Boolean) as ExtractedEvent[];
  const sections: Section[] = [];
  let order = 0;

  for (const ev of events) {
    const text = (v: unknown) => { const t = String(v || '').trim(); return keepNumbers || !hasDigit(t) ? t : ''; };
    const title = text(ev.title);
    const subtitle = text(ev.subtitle);
    const benefit = text(ev.benefit);
    const brand = text(ev.brand);
    const products = (Array.isArray(ev.products) ? ev.products : []).filter((p) => p && text(p.name));

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
          price: !keepNumbers ? 0 : Number(p.price) > 0 ? Number(p.price) : (Number(p.sale_price) > 0 ? Number(p.sale_price) : 0),
          discount_price: keepNumbers && Number(p.sale_price) > 0 && Number(p.price) > 0 ? Number(p.sale_price) : undefined,
          discount_rate: keepNumbers && Number(p.discount_rate) > 0 ? Number(p.discount_rate) : undefined,
        })),
      }));
    }
  }
  return sections;
}

/** DM 제목 파생 — 첫 행사 제목(없으면 브랜드) 기준. keepNumbers 가 아니면 숫자가 든 글은 건너뛴다(조립과 같은 규칙). */
export function deriveDmTitleFromEvents(eventsIn: Array<Record<string, any>>, opts: { keepNumbers?: boolean } = {}): string {
  const ok = (v: unknown) => !!String(v || '').trim() && (opts.keepNumbers === true || !hasDigit(v));
  const pick = (eventsIn || []).filter(Boolean).flatMap((e: any) => [e.title, e.brand]).find(ok);
  return String(pick || '행사 캠페인').trim().slice(0, 30) || '행사 캠페인';
}

/** 요약(토스트용) — 행사 N건·상품 M개. */
export function summarizeEvents(eventsIn: Array<Record<string, any>>): { events: number; products: number } {
  const events = (eventsIn || []).filter(Boolean) as ExtractedEvent[];
  return {
    events: events.length,
    products: events.reduce((s, e) => s + ((Array.isArray(e.products) ? e.products : []).length), 0),
  };
}
