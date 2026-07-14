/**
 * product-paste.ts — 상품 정보 붙여넣기 결정적 파서 (2026-07-14 Harold 지시)
 *
 * "상품명 / 가격 → 할인% 할인가 / URL" 블록 텍스트를 상품 항목으로 변환.
 * 이메일·DM 공용 ProductCarouselEditor가 소비 — 편집 중 어느 시점에든 상품을 붙여넣어 추가.
 * AI 호출 0·크레딧 0 — 붙여넣은 원문 숫자·URL만 그대로 옮긴다(창작 불가 구조).
 *
 * 인식 규칙:
 *  - URL 줄(^https?://)  = 직전 상품의 링크
 *  - "N원" 포함 줄       = 직전 상품명의 가격줄 (금액 2개면 앞=정가·뒤=할인가, N% = 할인율)
 *  - 그 외 텍스트 줄     = 새 상품명 (가격도 링크도 못 얻은 이름 줄 = 행사 제목 등으로 보고 버림)
 */

export interface PastedProduct {
  name: string;
  price?: number;
  discount_price?: number;
  discount_rate?: number;
  link_url?: string;
}

const URL_RE = /^https?:\/\//i;
const AMOUNT_RE = /([\d][\d,]*)\s*원/g;
const PCT_RE = /(\d{1,3})\s*%/;

export function parsePastedProducts(text: string, max = 8): PastedProduct[] {
  const out: PastedProduct[] = [];
  let cur: PastedProduct | null = null;

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
