/**
 * product-paste.ts — 상품 정보 붙여넣기 결정적 파서 (2026-07-14 Harold 지시)
 *
 * "상품명 / 가격 → 할인% 할인가 / URL" 블록 텍스트를 상품 항목으로 변환.
 * 이메일·DM 공용 ProductCarouselEditor가 소비 — 편집 중 어느 시점에든 상품을 붙여넣어 추가.
 * AI 호출 0·크레딧 0 — 붙여넣은 원문 숫자·URL만 그대로 옮긴다(창작 불가 구조).
 *
 * 인식 규칙:
 *  - URL 줄(^https?://)  = 직전 상품의 링크
 *  - 가격줄              = 직전 상품명의 가격 (금액 2개면 앞=정가·뒤=할인가, N% = 할인율)
 *  - 그 외 텍스트 줄     = 새 상품명 (가격도 링크도 못 얻은 이름 줄 = 행사 제목 등으로 보고 버림)
 *
 * ★2026-09-10 가격은 줄 끝에서 찾는다 (임은지 접수 cmttecy030bzejnotrwhqhzeh · 탭 카드 상품 목록 "가격만 보인다")
 *  - 옛 규칙은 "원"이 붙은 숫자만 가격으로 봐서 "35,000"을 새 상품명으로 읽고 진짜 이름을 버렸다.
 *    한 줄에 "이름 35,000원"을 쓰면 가격줄로 읽혔는데 받을 상품이 없어 상품이 통째로 사라졌다.
 *  - 가격으로 보는 것: ①"원"이 붙은 금액(옛 그대로) ②숫자만 있는 줄(35,000 · 35000 · ₩35,000)
 *    ③이름 뒤 줄 끝의 쉼표 묶음 숫자("헤라 파운데이션 35,000"). 연도·모델 번호(2025 · 21)는 가격으로 안 본다.
 *  - 가격 앞에 이름이 있으면: 가격을 기다리는 상품이 있으면 그 상품의 가격줄("정가 85,000원"),
 *    없으면 앞은 새 상품명·끝은 가격으로 나눈다.
 *  - 이 함수의 백엔드 복제본 = backend `utils/dm/dm-tab-content.ts` parseTabProductList(발행 렌더).
 *    ⛔ 한쪽만 바꾸지 마라 — 결과 일치는 dm-editor-parity.test.ts가 고정한다.
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
