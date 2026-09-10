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
 * ★2026-09-10 가격은 줄 끝에서 찾는다(임은지 접수 cmttecy030bzejnotrwhqhzeh) — 규칙 설명은 FE 원본 머리 주석이 소유한다.
 *   ⛔ 이 파일은 FE `product-paste.ts`의 본체를 **그대로 복사**한 것이다(함수·타입 이름만 다르다). 손으로 고치지 말고
 *   FE를 고친 뒤 같은 방식으로 다시 복사한다. 결과 일치 = dm-editor-parity.test.ts.
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
/** 숫자만 있는 가격줄: 35,000 · 35000 · ₩35,000 (쉼표 묶음 또는 세 자리 이상) */
const PRICE_ONLY_RE = /^₩?\s*(\d{1,3}(?:,\d{3})+|\d{3,})\s*원?$/;
/** 이름 뒤 줄 끝의 "원" 없는 가격: 쉼표 묶음만(연도·모델 번호를 가격으로 오인하지 않게) */
const TRAILING_BARE_PRICE_RE = /^(.*?)[\s:|/·-]+₩?\s*(\d{1,3}(?:,\d{3})+)$/;
/** 가격 앞 글이 상품명으로 볼 만한가(글자가 있어야 한다 · "→ 15%" 같은 기호·숫자만은 아니다) */
const NAME_CHAR_RE = /[A-Za-z가-힣]/;

const toAmount = (s: string) => Math.round(Number(s.replace(/,/g, '')));

/** 한 줄에서 가격을 찾는다. lead = 가격 앞 글 · priceText = 할인율을 찾을 가격 부분 */
function readPriceLine(ln: string): { lead: string; amounts: number[]; priceText: string } | null {
  const hits = [...ln.matchAll(AMOUNT_RE)].filter((m) => toAmount(m[1]) > 0);
  if (hits.length > 0) {
    const at = hits[0].index ?? 0;
    return { lead: ln.slice(0, at), amounts: hits.map((m) => toAmount(m[1])), priceText: ln.slice(at) };
  }
  const only = ln.match(PRICE_ONLY_RE);
  if (only) return { lead: '', amounts: [toAmount(only[1])], priceText: ln };
  const tail = ln.match(TRAILING_BARE_PRICE_RE);
  if (tail) return { lead: tail[1], amounts: [toAmount(tail[2])], priceText: tail[2] };
  return null;
}

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

    const pl = readPriceLine(ln);
    if (pl) {
      const lead = pl.lead.replace(/[\s:|/·,-]+$/, '').trim();
      // 가격을 기다리는 상품이 있으면 이 줄은 그 상품의 가격줄이다("정가 85,000원" 같은 이름표 포함 · 옛 규칙).
      // 없고 가격 앞에 이름이 있으면 한 줄에 "이름 가격"을 쓴 것이다 → 새 상품으로 나눈다.
      const awaiting = !!(cur && cur.name && !cur.price);
      if (!awaiting && NAME_CHAR_RE.test(lead)) {
        if (cur) flush();
        cur = { name: lead.slice(0, 80) };
      }
      if (!cur || !cur.name) continue; // 상품명 없는 가격줄 = 무시
      cur.price = pl.amounts[0];
      if (pl.amounts.length > 1 && pl.amounts[1] < pl.amounts[0]) cur.discount_price = pl.amounts[1];
      const pct = pl.priceText.match(PCT_RE);
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
