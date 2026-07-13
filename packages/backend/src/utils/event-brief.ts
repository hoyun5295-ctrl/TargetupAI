/**
 * ★ CT: 행사 캠페인 공용 브리프 (2026-07-07(4))
 *
 * 행사 내용 자유 텍스트(한 줄이든 줄바꿈 나열이든) → 3채널 생성기(모바일DM one-shot /
 * 이메일 generate-sections / 인앱 ai-generate)에 동일하게 주입하는 프롬프트 블록 + 혜택 실존 검증.
 *
 * ⛔ 영구 룰 양립 (AI 임의 혜택 금지):
 *   - AI가 지어내는 혜택은 여전히 금지. "행사 원문에 사용자가 직접 적은 혜택"만 원문 그대로 통과.
 *   - 기계 검증 = benefitMatchesEventText: 혜택 핵심 토큰(수치·%·원·쿠폰 등)이 행사 원문에
 *     실존해야 통과 — AI 환각 혜택은 원문에 없어 자동 탈락한다.
 */

export const EVENT_TEXT_MAX = 3000;

export function normalizeEventText(raw: any): string {
  return String(raw ?? '').trim().slice(0, EVENT_TEXT_MAX);
}

/** 행사 원문 + 사용 규칙 프롬프트 블록 — 3채널 생성기 공용 (빈 원문 = 빈 문자열) */
export function buildEventPromptBlock(eventText: string): string {
  const t = normalizeEventText(eventText);
  if (!t) return '';
  return `[행사 내용 — 사용자가 직접 입력한 사실. 이 캠페인은 아래 행사를 알리는 것]
${t}

[행사 내용 사용 규칙 — 절대 준수]
- 행사명·기간·대상·조건은 위 원문에 적힌 것만 사용 (원문에 없는 사실 지어내기 금지)
- 혜택(%·원·쿠폰·무료·사은품 등)은 위 원문에 적힌 표현만 원문 그대로 인용 — 원문에 혜택이 없으면 혜택 자리는 기존 placeholder 규칙을 따른다
- 원문에 기간이 있으면 마감 임박감을, 대상이 있으면 그 대상에게 말 걸듯 반영`;
}

/**
 * ★ 2026-07-08 행사 원문 → 상품 구조 추출 검증 (DM one-shot + 이메일 generate-sections 공용)
 *
 * AI가 추출한 상품(name/price/discount_price/discount_rate)이 행사 원문에 실존하는지 기계 검증.
 * - 가격 숫자(정가·할인가)는 원문(콤마·공백 제거)에 그 숫자가 그대로 실존해야 통과 — 환각 가격 자동 탈락
 * - 할인율은 "N%"가 원문에 실존해야 통과 (없으면 rate만 버리고 상품은 유지 — 렌더러가 가격으로 자동 계산)
 * - 상품명은 토큰 절반 이상이 원문에 실존해야 통과 (AI가 접두 라벨 등을 다듬는 것 허용)
 */
export interface ExtractedEventProduct {
  name: string;
  price: number;
  discount_price?: number;
  discount_rate?: number;
  // ★ 2026-07-13 — 상품 블록에 붙은 상품 URL (원문 실존 검증 통과분만)
  link_url?: string;
}

export function validateProductsAgainstEventText(products: any, eventText: any): ExtractedEventProduct[] {
  const src = String(eventText ?? '').toLowerCase().replace(/[\s,]+/g, '');
  if (!src || !Array.isArray(products)) return [];
  // 숫자 실존 검증용 원문 — 숫자 사이 콤마만 제거(공백 유지). 공백까지 지우면 "상품1 1000"이
  // "상품11000"으로 붙어 경계 검사가 정상 가격을 오탐 탈락시킨다.
  const srcNum = String(eventText ?? '').toLowerCase().replace(/(\d),(?=\d)/g, '$1');
  // 숫자 경계 실존 검증 — 부분 문자열 우회 차단 (예: 환각 34000이 원문 134,000 안에서 매치되는 것 방지)
  const numExists = (n: number, suffix = '') => new RegExp(`(?<!\\d)${n}${suffix}(?!\\d)`).test(srcNum);
  const out: ExtractedEventProduct[] = [];
  for (const raw of products) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String((raw as any).name ?? '').trim().slice(0, 80);
    const price = Math.round(Number((raw as any).price));
    if (!name || !Number.isFinite(price) || price <= 0) continue;
    // 가격 실존 검증 (콤마 제거 원문 안 숫자 그대로 — 경계 매치)
    if (!numExists(price)) continue;
    let discountPrice: number | undefined = Math.round(Number((raw as any).discount_price));
    if (!Number.isFinite(discountPrice) || discountPrice! <= 0 || discountPrice! >= price || !numExists(discountPrice!)) {
      discountPrice = undefined;
    }
    let discountRate: number | undefined = Math.round(Number((raw as any).discount_rate));
    if (!Number.isFinite(discountRate) || discountRate! <= 0 || discountRate! >= 100 || !numExists(discountRate!, '%')) {
      discountRate = undefined;
    }
    // 상품명 토큰 절반 이상 실존 (2자 이상 토큰 기준)
    const tokens = name.toLowerCase().split(/\s+/).filter((t) => t.replace(/[^0-9a-z가-힣]/g, '').length >= 2);
    if (tokens.length > 0) {
      const hit = tokens.filter((t) => src.includes(t.replace(/[\s,]+/g, ''))).length;
      if (hit * 2 < tokens.length) continue;
    }
    // ★ 2026-07-13 — 상품 URL: http/https + 원문에 글자 그대로 실존해야 통과 (가격 실존 검증과 동일 원칙 — 환각/변형 URL 차단).
    //   탈락 시 상품은 유지하고 URL만 제거.
    let linkUrl: string | undefined = String((raw as any).link_url ?? '').trim().replace(/[.,)\]]+$/, '');
    if (!linkUrl || !/^https?:\/\//i.test(linkUrl) || !String(eventText ?? '').includes(linkUrl)) {
      linkUrl = undefined;
    }
    out.push({ name, price, ...(discountPrice ? { discount_price: discountPrice } : {}), ...(discountRate ? { discount_rate: discountRate } : {}), ...(linkUrl ? { link_url: linkUrl } : {}) });
    if (out.length >= 8) break;
  }
  // ★ 2026-07-13 — AI가 URL을 빠뜨린 상품은 원문 구간 기반으로 결정적 배정 (모호하면 미배정)
  return assignProductLinksFromText(out, String(eventText ?? ''));
}

/**
 * ★ 2026-07-13 — 상품 URL 결정적 배정 (순수 함수).
 * 원문에서 각 상품명의 위치(앵커)를 잡고, "이 상품 앵커 ~ 다음 상품 앵커" 구간에 URL이 정확히 1개일 때만 배정.
 * 구간에 URL이 0개거나 2개 이상(모호)이면 미배정 — 증정 안내 문단 등 상품 아닌 텍스트의 URL 오배정 방지.
 * 이미 link_url이 있는 상품(검증 통과분)은 그대로 둔다.
 */
export function assignProductLinksFromText(products: ExtractedEventProduct[], eventText: string): ExtractedEventProduct[] {
  const text = String(eventText ?? '');
  if (!text || products.length === 0) return products;
  const urls: Array<{ url: string; index: number }> = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    urls.push({ url: m[0].replace(/[.,)\]]+$/, ''), index: m.index });
  }
  if (urls.length === 0) return products;
  // 상품별 앵커 = "그 상품명 토큰이 가장 많이 포함된 줄"의 시작 위치 (토큰 절반 이상 포함해야 인정).
  // 단일 토큰 매칭은 브랜드명("시세이도")이 전 상품 줄에 공통이라 첫 줄에 오배정된다 — 줄 단위 다수결로 정정.
  // 탐색 시작점을 앞 상품 앵커 뒤로 좁혀 상품 순서(추출 순서=원문 순서)를 유지.
  const lines: Array<{ start: number; text: string }> = [];
  let off = 0;
  for (const ln of text.split('\n')) {
    lines.push({ start: off, text: ln.toLowerCase() });
    off += ln.length + 1;
  }
  let searchFrom = 0;
  const anchors: number[] = products.map((p) => {
    const tokens = p.name.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    if (tokens.length === 0) return -1;
    let best = -1;
    let bestScore = 0;
    for (const ln of lines) {
      if (ln.start < searchFrom) continue;
      const score = tokens.filter((t) => ln.text.includes(t)).length;
      if (score > bestScore) { bestScore = score; best = ln.start; }
    }
    if (best < 0 || bestScore * 2 < tokens.length) return -1;
    searchFrom = best + 1;
    return best;
  });
  return products.map((p, i) => {
    let end = text.length;
    for (let j = i + 1; j < products.length; j++) {
      if (anchors[j] >= 0) { end = anchors[j]; break; }
    }
    let next = p;
    // ★ AI가 붙인 URL도 구간 검증 — "원문에 있는데 자기 상품 구간 밖"이면 오배치로 보고 폐기 후 재배정 (Codex 지적:
    //   verbatim 통과 URL의 오배치 우회 차단). 앵커를 못 잡은 상품·원문에 없는 URL은 반증 불가라 기존 값 유지.
    if (next.link_url && anchors[i] >= 0) {
      const occursSomewhere = urls.some((u) => u.url === next.link_url);
      const occursInRange = urls.some((u) => u.url === next.link_url && u.index > anchors[i] && u.index < end);
      if (occursSomewhere && !occursInRange) next = { ...next, link_url: undefined };
    }
    if (next.link_url || anchors[i] < 0) return next;
    const inRange = urls.filter((u) => u.index > anchors[i] && u.index < end);
    if (inRange.length !== 1) return next;
    return { ...next, link_url: inRange[0].url };
  });
}

/**
 * 혜택 문구가 행사 원문에 실제로 존재하는지 검증.
 * - 수치·혜택 토큰(20%, 5만원, 1+1, 무료배송, 쿠폰, 사은품, 적립 등)이 있으면 전 토큰이 원문에 실존해야 통과
 * - 토큰이 없으면 정규화(공백 제거) 부분 문자열로 판정
 */
export function benefitMatchesEventText(benefitText: any, eventText: any): boolean {
  const norm = (s: any) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
  const b = norm(benefitText);
  const e = norm(eventText);
  if (!b || !e) return false;
  const tokens = String(benefitText ?? '').match(/\d[\d.,]*\s*(?:%|퍼센트|원|만원|천원)|1\s*\+\s*1|무료\s*배송|무료|쿠폰|사은품|적립/g);
  if (tokens && tokens.length > 0) return tokens.every((tk) => e.includes(norm(tk)));
  return e.includes(b);
}
