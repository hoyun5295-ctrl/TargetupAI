/**
 * dm-tab-content.ts — 탭 카드 content_type='product_list' 파서 (백엔드 SSR 발행용).
 *
 * ★ 2026-07-22 (임은지) 탭 카드 content_type = 텍스트 / 이미지 URL / 상품 목록 옵션이 편집기엔 있으나
 *   발행·편집 모두 텍스트로만 렌더되던 죽은 옵션(F8) → 실제 렌더 구현. 상품 목록은 상품 슬라이드 붙여넣기와
 *   같은 형식("상품명 / 가격 / URL" 줄 블록)을 소비한다(사용자가 이미 아는 형식·일관 UX).
 *
 * FE `utils/product-paste.ts`(parsePastedProducts)의 백엔드 미러 — 발행 SSR은 프론트 TS를 프로덕션에서
 * import할 수 없어 로직을 복제한다(registry ↔ defaults 복제와 동일 패턴). 교차 패키지 결과 일치는
 * dm-tab-content.test.ts가 고정한다("붙여넣은 숫자·URL만 그대로" — 창작 0).
 */

export interface TabProduct {
  name: string;
  price?: number;
  discount_price?: number;
  discount_rate?: number;
  link_url?: string;
}

const URL_RE = /^https?:\/\//i;
const AMOUNT_RE = /([\d][\d,]*)\s*원/g;
const PCT_RE = /(\d{1,3})\s*%/;

/** "상품명 / 가격 / URL" 블록 텍스트 → 상품 항목. FE parsePastedProducts와 동일 규칙(교차 패키지 고정). */
export function parseTabProductList(text: string, max = 8): TabProduct[] {
  const out: TabProduct[] = [];
  let cur: TabProduct | null = null;

  const flush = () => {
    if (cur && cur.name && (cur.price || cur.link_url)) out.push(cur);
    cur = null;
  };

  for (const raw of String(text || '').split('\n')) {
    const ln = raw.trim();
    if (!ln) continue;

    if (URL_RE.test(ln)) {
      const url = ln.replace(/[.,)\]]+$/, '');
      if (cur && cur.name) {
        cur.link_url = url;
        flush(); // URL이 상품 블록의 끝
      } else if (out.length > 0 && !out[out.length - 1].link_url) {
        out[out.length - 1].link_url = url;
      }
      continue;
    }

    const amounts = [...ln.matchAll(AMOUNT_RE)]
      .map((m) => Math.round(Number(m[1].replace(/,/g, ''))))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (amounts.length > 0) {
      if (!cur || !cur.name) continue; // 상품명 없는 가격줄 = 무시
      cur.price = amounts[0];
      if (amounts.length > 1 && amounts[1] < amounts[0]) cur.discount_price = amounts[1];
      const pct = ln.match(PCT_RE);
      if (pct) {
        const r = Number(pct[1]);
        if (r > 0 && r < 100) cur.discount_rate = r;
      }
      continue;
    }

    // 일반 텍스트 = 새 상품명 시작
    if (cur) flush();
    cur = { name: ln.slice(0, 80) };
  }
  flush();
  return out.slice(0, Math.max(1, max));
}
