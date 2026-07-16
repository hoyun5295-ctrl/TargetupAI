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

// ★ 2026-07-16 M1 — 3000 → 8000 확대 (행사 원문 통째 붙여넣기 지원 — DM 재개편 설계서 §2-1)
import { callAIWithFallback } from '../services/ai';

export const EVENT_TEXT_MAX = 8000;

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

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-16 M1 — EventBrief 구조화 계약 (DM 재개편 설계서 §2-2. 3채널 공용)
//
// 근본: 행사 원문이 CampaignSpec(목적·톤·혜택 1개) 요약 병목을 거치며 기간·품목별 혜택·
// 유의사항이 소실되던 것을, "원문 → 구조 브리프(기계 검증) → 카피 생성에 원문+브리프 직투입 →
// 반영 커버리지 게이트"로 교체한다. 없는 항목은 null 정직 — AI 임의 혜택 금지 영구 룰 양립.
// ════════════════════════════════════════════════════════════════════

export interface EventBriefBenefit {
  /** 적용 대상·조건 (원문 표기, 검증 실패 시 null) */
  target: string | null;
  /** 혜택 내용 — benefitMatchesEventText 통과분만 */
  content: string;
}

export interface EventBrief {
  event_name: string | null;
  /** 기간 원문 표기 그대로 ("이번 주말까지", "7/20~7/27") */
  period_raw: string | null;
  /** 종료일 YYYY-MM-DD (AI가 원문 기간에서 계산 — 파생값. period_raw 실존 시에만 유효) */
  period_end: string | null;
  place: string | null;
  brand: string | null;
  tone_hint: string | null;
  benefits: EventBriefBenefit[];
  products: ExtractedEventProduct[];
  /** 유의사항·안내 — 원문 실존(정규화 포함) 통과분만 */
  notices: string[];
  /** 원문 URL 전부 — AI 무관, 정규식 결정적 추출 */
  links: string[];
}

/** 정규화(소문자·공백 제거) 부분 문자열 포함 판정 — 원문 실존/커버리지 공용 */
export function textContainsNormalized(haystack: any, needle: any): boolean {
  const norm = (s: any) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
  const n = norm(needle);
  if (!n) return false;
  return norm(haystack).includes(n);
}

/** 원문에서 URL 결정적 추출 (중복 제거, 꼬리 문장부호 정리) */
export function extractLinksFromText(text: any): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let m: RegExpExecArray | null;
  const s = String(text ?? '');
  while ((m = re.exec(s)) !== null) {
    const u = m[0].replace(/[.,)\]]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, 20);
}

/** 이름 토큰 절반 이상이 대상 텍스트에 실존하는지 (상품명 커버리지 — validateProducts와 동일 기준) */
export function nameTokensCovered(name: any, targetText: any): boolean {
  const norm = String(targetText ?? '').toLowerCase().replace(/[\s,]+/g, '');
  const tokens = String(name ?? '').toLowerCase().split(/\s+/).filter((t) => t.replace(/[^0-9a-z가-힣]/g, '').length >= 2);
  if (tokens.length === 0) return false;
  const hit = tokens.filter((t) => norm.includes(t.replace(/[\s,]+/g, ''))).length;
  return hit * 2 >= tokens.length;
}

/**
 * 카피 문자열 안 혜택·수치 토큰이 전부 행사 원문에 실존하는지 — 출구 가드 (지시는 뚫린다, 보장은 코드).
 * 혜택성 토큰이 없는 카피(분위기·구조 문장)는 통과.
 * ★ Codex 1R 정정 2건: ① 비수치 혜택 단어(무료배송·쿠폰·사은품·증정 등)도 검사 — 지어낸 비수치 혜택 차단
 * ② 숫자 토큰은 경계 검사 — "34,000원"이 원문 "134,000원"의 부분 문자열로 통과하는 우회 차단.
 */
export function copyFactsExistInText(copyText: any, eventText: any): boolean {
  const tokens = String(copyText ?? '').match(
    /\d[\d.,]*\s*(?:%|퍼센트|원|만원|천원)|[12]\s*\+\s*1|무료\s*배송|무료|쿠폰|사은품|적립|증정/g,
  );
  if (!tokens || tokens.length === 0) return true;
  const norm = (s: any) => String(s ?? '').toLowerCase().replace(/(\d),(?=\d)/g, '$1').replace(/\s+/g, '');
  const e = norm(eventText);
  if (!e) return false;
  return tokens.every((tk) => {
    const t = norm(tk);
    if (/^\d/.test(t)) {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<!\\d)${esc}`).test(e);
    }
    return e.includes(t);
  });
}

/**
 * AI 추출 결과 → 원문 실존 기계 검증 통과분만 담은 EventBrief (순수 — 계약 테스트 고정).
 * 원문에 없는 항목은 버리거나 null — 환각이 브리프에 실릴 수 없다.
 */
export function validateBriefAgainstText(raw: any, eventText: any): EventBrief {
  const text = String(eventText ?? '');
  const keepIfInText = (v: any, max = 120): string | null => {
    const s = String(v ?? '').trim().slice(0, max);
    return s && textContainsNormalized(text, s) ? s : null;
  };
  const benefits: EventBriefBenefit[] = [];
  if (Array.isArray(raw?.benefits)) {
    for (const b of raw.benefits) {
      const content = String(b?.content ?? '').trim().slice(0, 200);
      if (!content || !benefitMatchesEventText(content, text)) continue;
      // ★ Codex 1R — 적용 조건(target)이 있는데 원문 실존 검증에 실패하면 혜택째 제외.
      //   조건만 떨구면 "VIP 한정 20%"가 무조건 "20%"로 확대되는 사실 왜곡 (fail-closed).
      const rawTarget = String(b?.target ?? '').trim();
      const target = rawTarget ? keepIfInText(rawTarget, 80) : null;
      if (rawTarget && !target) continue;
      benefits.push({ target, content });
      if (benefits.length >= 8) break;
    }
  }
  const notices: string[] = [];
  if (Array.isArray(raw?.notices)) {
    for (const n of raw.notices) {
      const s = String(n ?? '').trim().slice(0, 150);
      if (!s || !textContainsNormalized(text, s)) continue;
      if (!notices.includes(s)) notices.push(s);
      if (notices.length >= 6) break;
    }
  }
  const periodRaw = keepIfInText(raw?.period_raw, 60);
  const periodEndRaw = String(raw?.period_end ?? '').trim();
  // ★ Codex 1R — period_end는 AI 파생값이라 원문 대조가 불가: 형식 + 현재 기준 ±400일 상식 가드로
  //   날짜 계산 오류(엉뚱한 연도 등)가 카운트다운·쿠폰 만료에 실리는 것 차단. 밖이면 폐기(수동 지정 경로 유지).
  const periodEnd = (() => {
    if (!periodRaw || !/^\d{4}-\d{2}-\d{2}$/.test(periodEndRaw)) return null;
    const t = Date.parse(`${periodEndRaw}T00:00:00+09:00`);
    if (!Number.isFinite(t) || Math.abs(t - Date.now()) > 400 * 24 * 3600 * 1000) return null;
    return periodEndRaw;
  })();
  return {
    event_name: keepIfInText(raw?.event_name, 80),
    period_raw: periodRaw,
    period_end: periodEnd,
    place: keepIfInText(raw?.place, 80),
    brand: keepIfInText(raw?.brand, 40),
    tone_hint: String(raw?.tone_hint ?? '').trim().slice(0, 30) || null,
    benefits,
    products: validateProductsAgainstEventText(raw?.products, text),
    notices,
    links: extractLinksFromText(text),
  };
}

export interface BriefCoverageItem {
  kind: 'event_name' | 'benefit' | 'product' | 'period' | 'notice' | 'link';
  label: string;
}

/**
 * 브리프 항목이 생성물(직렬화 텍스트)에 반영됐는지 — 반영 커버리지 게이트 (순수, 채널 중립).
 * contentText = 채널 조립기가 넘기는 콘텐츠 직렬화(JSON 등). 미반영 항목을 숨기지 않고 돌려준다.
 */
export function computeBriefCoverage(brief: EventBrief, contentText: string): { missing: BriefCoverageItem[] } {
  const missing: BriefCoverageItem[] = [];
  if (brief.event_name && !textContainsNormalized(contentText, brief.event_name)) {
    missing.push({ kind: 'event_name', label: brief.event_name });
  }
  for (const b of brief.benefits) {
    // ★ Codex 1R — 적용 조건(target)까지 반영돼야 커버 (조건 없는 혜택 확대 표시 차단)
    const contentOk = benefitMatchesEventText(b.content, contentText);
    const targetOk = !b.target || textContainsNormalized(contentText, b.target);
    if (!contentOk || !targetOk) missing.push({ kind: 'benefit', label: (b.target ? `${b.target} — ${b.content}` : b.content).slice(0, 60) });
  }
  for (const p of brief.products) {
    if (!nameTokensCovered(p.name, contentText)) missing.push({ kind: 'product', label: p.name });
  }
  if (brief.period_raw || brief.period_end) {
    const ok = (brief.period_raw && textContainsNormalized(contentText, brief.period_raw))
      || (brief.period_end && contentText.includes(brief.period_end));
    if (!ok) missing.push({ kind: 'period', label: brief.period_raw || brief.period_end || '' });
  }
  for (const n of brief.notices) {
    if (!textContainsNormalized(contentText, n)) missing.push({ kind: 'notice', label: n.slice(0, 60) });
  }
  for (const l of brief.links) {
    if (!contentText.includes(l)) missing.push({ kind: 'link', label: l });
  }
  return { missing };
}

const EVENT_BRIEF_SYSTEM = `당신은 행사 원문을 구조화하는 파서입니다. 원문에 적힌 사실만 추출하고, 없는 항목은 null 또는 빈 배열로 둡니다. 창작 절대 금지.

규칙:
- event_name = 행사 이름 (원문 표기 그대로. 명시가 없으면 null — 지어내지 않는다)
- period_raw = 기간 표현 원문 그대로 ("이번 주말까지", "7/20~7/27" 등. 없으면 null)
- period_end = 기간 종료일 YYYY-MM-DD (period_raw가 상대 표현이면 현재 한국 시각 기준 계산. period_raw가 null이면 null)
- place = 장소·채널 (원문 표기. 없으면 null)
- brand = 브랜드·상호 (원문 표기. 없으면 null)
- tone_hint = 원문이 풍기는 톤 힌트 한 단어 (예: premium/urgent/friendly. 모호하면 null)
- benefits = 혜택 목록. content는 원문 표기 그대로(수치·조건 포함), target은 적용 대상·조건(원문 표기, 없으면 null). 상품 개별 할인가는 products에 담고 benefits에는 상품 외 혜택(증정·쿠폰·배송 등)을 담는다
- notices = 유의사항·안내 문장 (원문 표기 그대로, 문장 단위. 없으면 빈 배열)
- products = 상품 목록: name(원문 표기, 앞뒤 라벨 정리만 허용) · price(정가 — 원문 숫자 그대로 콤마 제거 정수) · discount_price(할인가, 원문에 있을 때만) · discount_rate(할인율 %, 원문에 있을 때만) · link_url(그 상품 블록의 URL 원문 글자 그대로 — 창작·축약·변형 금지, 없으면 생략). 가격 없는 상품·상품 없는 원문 = 빈 배열

JSON만 출력:
{ "event_name": null, "period_raw": null, "period_end": null, "place": null, "brand": null, "tone_hint": null,
  "benefits": [{ "target": null, "content": "" }], "notices": [],
  "products": [{ "name": "", "price": 0, "discount_price": 0, "discount_rate": 0, "link_url": "" }] }`;

/** extractJson 미러 (dm-ai.ts와 동일 동작 — 코드펜스/앞뒤 잡음 제거 후 첫 JSON 객체 파싱) */
function briefExtractJson(raw: string): any {
  const cleaned = String(raw ?? '').replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('JSON 없음');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * 행사 원문 → EventBrief (AI 구조화 추출 + 원문 실존 기계 검증).
 * 추출 실패 = 최소 브리프(링크만 결정적 추출) — 생성 흐름은 계속되고 커버리지가 정직하게 보고한다.
 */
export async function extractEventBrief(eventText: string, companyId?: string): Promise<EventBrief> {
  const text = normalizeEventText(eventText);
  const fallback: EventBrief = {
    event_name: null, period_raw: null, period_end: null, place: null, brand: null, tone_hint: null,
    benefits: [], products: [], notices: [], links: extractLinksFromText(text),
  };
  if (!text) return fallback;
  try {
    const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00');
    const raw = await callAIWithFallback({
      system: EVENT_BRIEF_SYSTEM,
      userMessage: `현재 한국 시각: ${kst}\n\n[행사 원문]\n${text}\n\n위 원문을 JSON으로 구조화하세요.`,
      maxTokens: 3000,
      temperature: 0,
      model: 'sonnet',
      companyId,
      source: 'dm-event-brief', // 종량제: 맵 미등록=0 — 생성 묶음 안 집계만
    });
    return validateBriefAgainstText(briefExtractJson(raw), text);
  } catch (err) {
    console.log('[extractEventBrief] 추출 실패 — 최소 브리프 폴백:', (err as any)?.message);
    return fallback;
  }
}
