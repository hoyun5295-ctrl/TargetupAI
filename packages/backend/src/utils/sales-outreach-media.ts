/**
 * ★ 2026-09-05 AI 영업 아웃리치 : 재료 수집 CT (상품 · 이미지 후보 · 딥링크 · 법정 표기 · 이미지 실측)
 * 설계 = docs/2026-09-05-ai-sales-outreach-refinement-design.md A-10 · A-10b · A-11(프로토타입 `scratch/proto/proto-lib.ts` 이식)
 *
 * 두 층으로 나뉜다.
 *  ① 순수 층(HTML 문자열만 받는다 · 네트워크 0): extractProducts · discoverProductLinks · extractImageCandidates ·
 *     findLinkByText · extractLegal · readImageSize · parseProductPage. 전부 export = 계약 테스트 대상.
 *  ② 네트워크 층(가드 fetch 재사용): fetchProductPageGuarded(1홉 · 같은 호스트만) · measureImageGuarded(직접 받아 폭·높이 확인 · 사본 저장).
 *
 * 규율:
 * - 새 fetch 경로를 만들지 않는다. HTML = `fetchHtmlGuarded`, 이미지 = 호출부가 넘긴 `fetchImageGuarded`(produce.ts 소유 · SSRF 가드 동일).
 * - 이미지 폭 게이트(갤러리 600 · 상품 400)는 상수 1곳. 미만은 탈락(흐릿한 썸네일이 산출물에 실리던 원인).
 * - 속성값의 HTML 엔티티(&amp;)는 절대화 직전에 푼다(29CM 전 이미지 404의 원인).
 * - 사본 저장은 기존 스튜디오 저장 경로(writeTempBuffer/moveTempToPermanent)만 쓴다(핫링크 0 · 파기 시 함께 삭제).
 */
import { fetchHtmlGuarded } from './dm/dm-brand-extractor';

/** 아웃리치 HTML 수집 옵션 — 공용 기본(200KB · 5초)은 og 메타용이라 상품·갤러리가 잘린다(이니스프리 395KB 실측 · 0905). 홈·행사 상세·상품 상세 전부 이것으로. */
export const OUTREACH_FETCH_OPTS = { maxBytes: 800_000, timeoutMs: 10_000 } as const;
export const OUTREACH_GALLERY_MIN_WIDTH = 600;
export const OUTREACH_PRODUCT_MIN_WIDTH = 400;
/** 사본으로 저장할 원본 상한(리사이즈 없음 · 이메일 임베드 용량 고려) */
export const OUTREACH_MEDIA_MAX_BYTES = 1_500_000;

export interface OutreachProduct {
  name: string;
  price: number | null;
  discount_price: number | null;
  image_url: string;
  link_url: string;
  /** ★ 2026-09-06 재료 v2(선택 · 카드 원문에 문자열로 있을 때만 · 없으면 키 자체가 없다) */
  discount_rate?: number;
  rating?: number;
  review_count?: number;
  badges?: string[];
}

/** ★ 2026-09-06 배너 후보 상세(문서 순서 · alt 동반) — extractImageCandidates 는 이것의 url 투영이다(동작 무변경) */
export interface ImageCandidateDetail { url: string; alt: string; order: number }

/** ★ 2026-09-06 사회적 증거(원문 문자열 그대로 · 혜택 수치가 아니다 · 없으면 null) */
export interface ProofSignals { reviewTotal: number | null; rating: number | null; rankLabel: string | null }

// ===== 문자열 유틸 =====

export function decodeHtmlEntities(s: string): string {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** 상대·엔티티 섞인 URL을 절대 URL로. CDN 리사이저 폭이 과대하면 1200으로 낮춘다(용량 상한 회피). 실패 = null. */
export function absolutizeAssetUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(decodeHtmlEntities(raw.trim()), base);
    for (const k of ['width', 'w']) {
      const v = Number(u.searchParams.get(k));
      if (v > 1400) u.searchParams.set(k, '1200');
    }
    const out = u.toString();
    return /^https?:\/\//i.test(out) ? out : null;
  } catch {
    return null;
  }
}

export function cleanProductName(n: string): string {
  return String(n || '').replace(/\s+/g, ' ')
    .replace(/\s*(판매가|소비자가|할인가|정가|적립금|회원가|쿠폰가|리뷰\s*\d+|품절|SOLD OUT)\s*$/i, '')
    .replace(/\s*(판매가|소비자가|할인가|정가)\s*$/i, '')
    .trim();
}

/** 상품 식별 키(중복 병합용) : 쿼리 식별자 → 한글 slug 경로 → 경로 식별자 → 이름 앞 40자 */
export function productKey(p: { name: string; link_url: string }): string {
  let dec = p.link_url;
  try { dec = decodeURIComponent(p.link_url); } catch { /* 그대로 */ }
  const m = p.link_url.match(/(?:product_no|goodsNo|goods_no|productId|prdNo|itemId|pid|goodsId|itemNo)=(\w+)/i)
    || dec.match(/\/product\/[^/]+\/(\d{2,})\//i)
    || p.link_url.match(/\/(?:products?|goods|item|prd|dp\/product)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : p.name.slice(0, 40);
}

export function isBadProductImage(u: string): boolean {
  return /(icon_|\/icon\/|og_image|share[-_]?image|\/web\/24_renewal\/|logo|placeholder|noimage|no_image)/i.test(u);
}

function bestImgFromTag(tag: string, base: string): string | null {
  const m = tag.match(/(?:ec-data-src|data-src|data-original|data-lazy|data-echo|data-srcset)=["']([^"']+)["']/i)
    || tag.match(/srcset=["']([^"']+)["']/i)
    || tag.match(/\ssrc=["']([^"']+)["']/i);
  if (!m) return null;
  let cand = m[1];
  if (/\s\d+[wx]/.test(cand)) {
    // srcset: 가장 큰 디스크립터
    const parts = cand.split(',').map((p) => p.trim().split(/\s+/)).map(([u, d]) => ({ u, d: Number((d || '0').replace(/[wx]/, '')) || 0 }));
    parts.sort((a, b) => b.d - a.d);
    cand = parts[0].u;
  }
  if (/^data:/.test(cand)) return null;
  return absolutizeAssetUrl(cand, base);
}

function bestImgInBlock(inner: string, base: string): string | null {
  const tags = inner.match(/<img[^>]*>/gi) || [];
  for (const t of tags) {
    const u = bestImgFromTag(t, base);
    if (u && !isBadProductImage(u) && !/\.svg(\?|$)|\.gif(\?|$)/i.test(u)) return u;
  }
  return null;
}

const PRICE_RE = /(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원/g;
const NAME_NOISE_RE = /\b(SALE|BEST|NEW|HOT|장바구니|찜|리뷰|구매|바로가기|쿠폰|관심상품|미리보기)\b/gi;

function pickName(text: string): string {
  return text.replace(PRICE_RE, ' ').replace(/\d{1,3}\s*%/g, ' ').replace(NAME_NOISE_RE, ' ')
    .split(/\s{2,}|\|/).map((s) => s.trim()).filter((s) => s.length >= 4).sort((a, b) => b.length - a.length)[0] || '';
}

function pricesOf(text: string): number[] {
  return Array.from(text.matchAll(PRICE_RE)).map((x) => Number(x[1].replace(/,/g, ''))).filter((n) => n >= 1000 && n < 10_000_000);
}

/** 쇼핑몰 목록 마크업 휴리스틱(순수): <a> 또는 <li> 안에 <img>와 "N원"이 함께 있으면 상품 카드로 본다. */
export function extractProducts(html: string, base: string, max = 12): OutreachProduct[] {
  const out: OutreachProduct[] = [];
  const seen = new Set<string>();
  const push = (inner: string, href: string) => {
    const text = stripTags(inner);
    const prices = pricesOf(text);
    if (prices.length === 0) return;
    const link = absolutizeAssetUrl(href, base);
    const image = bestImgInBlock(inner, base);
    if (!link || !image) return;
    const name = pickName(text);
    if (!name || name.length < 4) return;
    const key = name.slice(0, 40);
    if (seen.has(key)) return;
    seen.add(key);
    const sorted = [...prices].sort((a, b) => a - b);
    const item: OutreachProduct = {
      name: cleanProductName(name).slice(0, 80),
      price: sorted[sorted.length - 1],
      discount_price: sorted.length > 1 && sorted[0] < sorted[sorted.length - 1] ? sorted[0] : null,
      image_url: image,
      link_url: link,
    };
    // ★ 2026-09-06 재료 v2 — 카드 원문에 문자열로 있는 값만(계산·추정 0). 할인율은 가격 쌍이 있을 때만(단독 %는 잡음).
    const rr = text.match(/(?:^|[^\d.])([1-5]\.\d)\s*\(\s*(\d{1,3}(?:,\d{3})*|\d{1,7})\s*\)/);
    if (rr) { item.rating = Number(rr[1]); item.review_count = Number(rr[2].replace(/,/g, '')); }
    const pr = text.match(/(?:^|[^\d])(\d{1,2})\s*%/);
    if (pr && item.discount_price !== null) item.discount_rate = Number(pr[1]);
    const badges = Array.from(new Set((text.match(/\b(NEW|SALE|HOT|GIFT|BEST)\b/g) || []).map((b) => b.toUpperCase())));
    if (badges.length) item.badges = badges;
    out.push(item);
  };
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(html)) !== null && out.length < max) {
    if (m[2].length > 6000 || !/<img\b/i.test(m[2])) continue;
    push(m[2], m[1]);
  }
  if (out.length < 3) {
    const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let l: RegExpExecArray | null;
    while ((l = liRe.exec(html)) !== null && out.length < max) {
      const inner = l[1];
      if (inner.length > 8000 || !/<img\b/i.test(inner)) continue;
      const href = inner.match(/href=["']([^"'#]+)["']/i);
      if (!href) continue;
      push(inner, href[1]);
    }
  }
  const uniq: OutreachProduct[] = [];
  const keys = new Set<string>();
  for (const p of out) {
    const k = productKey(p);
    if (keys.has(k) || isBadProductImage(p.image_url)) continue;
    keys.add(k);
    uniq.push(p);
  }
  return uniq;
}

/** 태그의 width/height 속성이 둘 다 작으면 아이콘·메뉴 썸네일로 본다(실측 없이 거르는 1차 신호 · 속성이 없으면 모른다) */
function isTinyByAttr(tag: string): boolean {
  const w = Number((tag.match(/\swidth=["']?(\d+)/i) || [])[1]);
  const h = Number((tag.match(/\sheight=["']?(\d+)/i) || [])[1]);
  return Number.isFinite(w) && w > 0 && w < 200 && Number.isFinite(h) && h > 0 && h < 200;
}

/** 이미지 후보(순수): og:image 계열 + img(src·data-src·srcset) + <source srcset>. 로고·추적 픽셀·크기 속성 200px 미만 배제 · 확장자 없는 CDN URL 허용 · 상한 24(뒤 실측이 큰 것부터 고른다).
 *  ★ 2026-09-06 상세 판(alt·문서 순서 동반) — 기존 extractImageCandidates 는 이것의 url 투영이라 출력이 문자 단위로 같다. */
export function extractImageCandidatesDetailed(html: string, base: string, max = 24): ImageCandidateDetail[] {
  const found: Array<{ raw: string; alt: string }> = [];
  for (const re of [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) found.push({ raw: m[1], alt: '' });
  }
  const tagRe = /<(?:img|source)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = tagRe.exec(html)) !== null && scanned < 200) {
    scanned++;
    if (isTinyByAttr(m[0])) continue;
    const u = bestImgFromTag(m[0], base);
    if (!u) continue;
    const alt = decodeHtmlEntities((m[0].match(/\salt=["']([^"']*)["']/i) || [])[1] || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    found.push({ raw: u, alt });
  }
  const out: ImageCandidateDetail[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    const u = absolutizeAssetUrl(f.raw, base);
    if (!u) continue;
    if (/(logo|icon|favicon|sprite|\/(?:menu|nav|gnb)\/|banner_top|btn_|\.svg(\?|$)|\.gif(\?|$)|1x1|pixel|blank|share[-_]?image|og_image|\/web\/24_renewal\/)/i.test(u)) continue;
    if (/(ct\.pinterest\.com|facebook\.com\/tr|google-analytics|doubleclick|googletagmanager|analytics\.|\/tr\?|\/pixel)/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push({ url: u, alt: f.alt, order: out.length });
    if (out.length >= max) break;
  }
  return out;
}

export function extractImageCandidates(html: string, base: string, max = 24): string[] {
  return extractImageCandidatesDetailed(html, base, max).map((d) => d.url);
}

/**
 * ★ 2026-09-06 사회적 증거(순수 · 텍스트 입력) — 리뷰 총수·평점·수상/1위 표기를 원문 문자열에서만 읽는다. 혜택 수치(%·원·쿠폰)가 아니라
 * 그 업체가 자기 홈에 공표한 실적이다(회의 수렴안 D4 · 코드가 채우는 숫자 카드의 재료). 없으면 null · 계산·추정 0.
 */
export function extractProofSignals(text: string): ProofSignals {
  const t = String(text || '').replace(/\s+/g, ' ');
  let reviewTotal: number | null = null;
  for (const m of t.matchAll(/(\d{1,3}(?:,\d{3})+|\d{3,8})\s*(?:개|건)\s*의?\s*(?:리얼\s*|실제\s*|생생\s*)?(?:리뷰|후기|상품\s*평)/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 100 && (reviewTotal === null || n > reviewTotal)) reviewTotal = n;
  }
  if (reviewTotal === null) {
    for (const m of t.matchAll(/(?:리뷰|후기)\s*\(?\s*(\d{1,3}(?:,\d{3})+|\d{3,8})\s*\)?/g)) {
      const n = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(n) && n >= 100 && (reviewTotal === null || n > reviewTotal)) reviewTotal = n;
    }
  }
  let rating: number | null = null;
  const r1 = t.match(/(?:평점|별점|만족도)\s*[:：]?\s*([1-5]\.\d)/) || t.match(/★\s*([1-5]\.\d)/);
  if (r1) rating = Number(r1[1]);
  else {
    // 카드 반복형 "4.9 (20,389)" — 두 번 이상 나온 값만(단독 1회는 상품 하나의 평점일 뿐)
    const freq = new Map<string, number>();
    for (const m of t.matchAll(/(?:^|[^\d.])([1-5]\.\d)\s*\(\s*\d{1,3}(?:,\d{3})*\s*\)/g)) freq.set(m[1], (freq.get(m[1]) || 0) + 1);
    let best: [string, number] | null = null;
    for (const e of freq) if (!best || e[1] > best[1]) best = e;
    if (best && best[1] >= 2) rating = Number(best[0]);
  }
  const rk = t.match(/((?:\d{1,2}\s*년\s*(?:연속|간)?\s*)?(?:누적\s*)?(?:판매|매출)\s*[_ ]?1\s*위(?:\s*[가-힣A-Za-z]{1,12})?)/)
    || t.match(/([가-힣A-Za-z0-9 ]{2,24}\s*(?:어워즈|AWARDS?|Awards?)\s*(?:위너|WINNER|Winner|수상|대상))/)
    || t.match(/(\d{1,2}\s*관왕)/);
  const rankLabel = rk ? rk[1].replace(/\s+/g, ' ').trim().slice(0, 40) : null;
  return { reviewTotal, rating, rankLabel };
}

/** 홈 HTML의 상품형 링크(같은 호스트)만 골라낸다(순수). 상세 1홉 수집의 입력. */
export function discoverProductLinks(html: string, base: string, max = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let host: string;
  try { host = new URL(base).hostname; } catch { return []; }
  const re = /<a\b[^>]*href=["']([^"'#?]+(?:\?[^"']*)?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const u = absolutizeAssetUrl(m[1], base);
    if (!u) continue;
    try { if (new URL(u).hostname !== host) continue; } catch { continue; }
    let dec = u;
    try { dec = decodeURIComponent(u); } catch { /* 그대로 */ }
    const pathOk = /\/(product|products|goods|item|items|prd|prod|detail|shop\/detail|goods\/view|shop\/goodsView|p)\/?[A-Za-z0-9_\-]*\d/i.test(u)
      || /\/product\/[^\s"'/]+\/\d{2,}\//i.test(dec)
      || /(goodsNo|prdNo|productId|goods_no|product_no|goodsCd|itemId|prodId|pid|goodsId|itemNo)=\w*\d/i.test(u);
    if (!pathOk) continue;
    const key = u.replace(/#.*$/, '').replace(/[?&](utm_[^&]+|ref=[^&]+|display_group=[^&]+)/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

/** 앵커 텍스트 키워드 → 같은 호스트 링크(CTA 딥링크 · 순수). 로그인·장바구니류 제외. */
export function findLinkByText(html: string, base: string, keywords: string[]): string | null {
  let host = '';
  try { host = new URL(base).hostname; } catch { return null; }
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[2]).toLowerCase();
    if (!text || text.length > 60) continue;
    if (!keywords.some((k) => text.includes(k.toLowerCase()))) continue;
    const u = absolutizeAssetUrl(m[1], base);
    if (!u) continue;
    try { if (new URL(u).hostname !== host) continue; } catch { continue; }
    if (/\/(login|join|cart|mypage|member)/i.test(u)) continue;
    return u;
  }
  return null;
}

/** CTA 버튼 라벨에서 딥링크로 이을 키워드(라벨에 포함되면 그 키워드 링크를 찾는다) */
export const OUTREACH_CTA_KEYWORDS: readonly string[] = ['쿠폰', '기획전', '룩북', '앱', '이벤트', '랭킹', '신상', '컬렉션', '베스트', '세일', '혜택', '멤버십'];

/** 홈 HTML에서 CTA 키워드별 딥링크 표(순수). 크롤 단계가 계산해 brand_profile에 남긴다(HTML은 저장하지 않으므로). */
export function buildCtaLinkMap(html: string, base: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of OUTREACH_CTA_KEYWORDS) {
    const u = findLinkByText(html, base, [k]);
    if (u) out[k] = u;
  }
  return out;
}

/** 법정 표기(사업자·통신판매·대표·주소·CS) 원문 추출(순수). 2개 이상 잡혀야 표기로 인정. */
export function extractLegal(text: string): { legal: string | null; csPhone: string | null } {
  const t = String(text || '').replace(/\s+/g, ' ');
  const parts: string[] = [];
  const grab = (re: RegExp, label: string) => { const m = t.match(re); if (m) parts.push(label + ' ' + m[1].trim()); };
  grab(/(?:상호|회사명|법인명)\s*[:：]?\s*((?:\(주\)|주식회사|㈜)?\s?[가-힣A-Za-z0-9&.\- ]{2,30}?)(?=\s*(?:\||·|대표|사업자|주소|$))/, '상호');
  grab(/대표(?:이사|자)?\s*[:：]?\s*([가-힣]{2,4})/, '대표');
  grab(/사업자\s*등록\s*번호\s*[:：]?\s*(\d{3}-\d{2}-\d{5})/, '사업자등록번호');
  grab(/통신판매업?\s*신고(?:번호)?\s*[:：]?\s*((?:제\s*)?\d{4}-[가-힣]+-\d{3,5}(?:호)?)/, '통신판매업신고');
  grab(/주소\s*[:：]?\s*((?:\(\d{5}\)\s*)?(?:서울|경기|인천|부산|대구|대전|광주|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)[^|·]{5,60}?)(?=\s*(?:\||·|사업자|대표|통신|호스팅|이메일|$))/, '주소');
  const cs = t.match(/(?:고객센터|고객\s*상담|CS|문의|콜센터|대표번호)\s*[:：]?\s*((?:1\d{3}-\d{4})|(?:080-\d{3,4}-\d{4})|(?:0\d{1,2}-\d{3,4}-\d{4}))/) || t.match(/\b(1\d{3}-\d{4})\b/);
  return { legal: parts.length >= 2 ? parts.join(' | ') : null, csPhone: cs ? cs[1] : null };
}

function normalizeHex6(raw: string): string | null {
  const v = String(raw || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + v.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return null;
}

/** theme-color 메타 → 없으면 msapplication-TileColor(순수) : 6자리 hex로 정규화(3자리 확장). 그 외 null. */
export function parseThemeColorFromHtml(html: string): string | null {
  const pick = (name: string) => html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'));
  const m = pick('theme-color') || pick('msapplication-TileColor');
  return m ? normalizeHex6(m[1]) : null;
}

// ===== 브랜드 색 2차 원천 — 아이콘 PNG의 지배색(★ 0905(4) "전문가가 만든 느낌" · 색이 없으면 기본 토큰 보라가 나가 템플릿 티가 난다) =====
// ⛔ 로고 픽셀은 산출물에 쓰지 않는다(불변 11 · 상표). 여기서는 색 1개만 읽는다. PNG만(pngjs 순수 디코드 · favicon.ico·webp는 대상 밖).

/** 브랜드 색을 읽을 아이콘 후보(PNG만 · ≤3) — og:image가 PNG면 로고인 경우가 많다(이니스프리 실측) · apple-touch-icon · icon(png). */
export function extractBrandIconCandidates(html: string, base: string): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    const a = u ? absolutizeAssetUrl(u, base) : null;
    if (a && /\.png(\?|$)/i.test(a) && !out.includes(a)) out.push(a);
  };
  const og = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i);
  push(og?.[1]);
  for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi)) push(m[0].match(/href=["']([^"']+)["']/i)?.[1]);
  for (const m of html.matchAll(/<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]*>/gi)) {
    if (/image\/png|\.png/i.test(m[0])) push(m[0].match(/href=["']([^"']+)["']/i)?.[1]);
  }
  return out.slice(0, 3);
}

/**
 * PNG 픽셀에서 지배 채도색 1개(순수). 흰·검·회색·반투명은 뺀다. 색상 12° × 채도 2단 히스토그램의 최빈 빈 평균색.
 * 표본이 20픽셀 미만이면 null(무채색 로고 = 색 없음).
 */
export function dominantColorFromPng(buf: Buffer): string | null {
  if (!buf || buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  // pngjs는 타입 정의가 없어 require로 읽는다(순수 디코드 · 네트워크 0)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pngjs = require('pngjs') as { PNG: { sync: { read(b: Buffer): { width: number; height: number; data: Buffer } } } };
  let png: { width: number; height: number; data: Buffer };
  try { png = pngjs.PNG.sync.read(buf); } catch { return null; }
  const { width, height, data } = png;
  if (!width || !height || !data) return null;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const v = max / 255;
      const s = max === 0 ? 0 : (max - min) / max;
      if (s < 0.3 || v < 0.15) continue;
      const d = max - min;
      let h = 0;
      if (d) { h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
      const key = Math.floor(h / 12) * 2 + (s > 0.6 ? 1 : 0);
      const e = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      bins.set(key, e);
    }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of bins.values()) if (!best || e.n > best.n) best = e;
  if (!best || best.n < 20) return null;
  const hex = (n: number) => Math.round(n / best!.n).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

/** 로고로 쓰면 안 되는 이미지(흰 버전·로딩·푸터·제휴·앱 배지·SNS 아이콘) */
const LOGO_BAD_RE = /white|_wh\b|-wh\b|loading|footer|partner|payment|app-?store|google-?play|instagram|facebook|kakao|naver|youtube|badge|sprite/i;

/**
 * ★ 0905(5) 헤더 로고 후보(순수 · Harold 결재로 불변 11 개정 = 아웃리치 헤더에 한해 브랜드 로고 사본 허용).
 * 순서 = 헤더 영역 `<img … logo …>`(src·alt·class·id) → apple-touch-icon → og:image(PNG). 흰 버전·로딩·푸터·제휴·SNS 아이콘은 뺀다. ≤4.
 * 실물 판정(크기·비율·흰 로고)은 네트워크 층(collectOutreachMedia)이 받아 본 뒤 한다.
 */
export function extractLogoCandidates(html: string, base: string): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => { const a = u ? absolutizeAssetUrl(u, base) : null; if (a && !out.includes(a) && !LOGO_BAD_RE.test(a)) out.push(a); };
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags.slice(0, 300)) {
    if (!/logo/i.test(tag) || LOGO_BAD_RE.test(tag)) continue;
    push(bestImgFromTag(tag, base));
  }
  for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi)) push(m[0].match(/href=["']([^"']+)["']/i)?.[1]);
  const og = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i);
  if (og && /\.png(\?|$)/i.test(og[1])) push(og[1]);
  return out.slice(0, 4);
}

/**
 * ★ 2026-09-06 S3 알파 PNG 판정(순수) — 몰이 이미 누끼(투명 배경)로 준 상품 PNG(cfront `nuggi/*.png`)는 rembg(단일 워커 · 60초)를 거치지 않고 그대로 합성 재료로 쓴다.
 * 표본 픽셀의 alpha 가 하나라도 250 미만이면 true. PNG 가 아니거나 4MB 초과(디코드 비용)면 false(보수 = rembg 경로).
 */
export function pngHasAlpha(buf: Buffer): boolean {
  if (!buf || buf.length < 24 || buf.length > 4_000_000 || buf[0] !== 0x89 || buf[1] !== 0x50) return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pngjs = require('pngjs') as { PNG: { sync: { read(b: Buffer): { width: number; height: number; data: Buffer } } } };
  let png: { width: number; height: number; data: Buffer };
  try { png = pngjs.PNG.sync.read(buf); } catch { return false; }
  const { width, height, data } = png;
  if (!width || !height || !data) return false;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 20000)));
  for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
    if (data[(y * width + x) * 4 + 3] < 250) return true;
  }
  return false;
}

/** 흰(밝은) 로고인가 — 불투명 픽셀의 평균 명도가 0.9 이상이면 흰 배경 헤더에서 안 보인다(커버낫 실측 `woman_loading_white`). PNG가 아니면 false. */
export function pngLooksWhite(buf: Buffer): boolean {
  if (!buf || buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pngjs = require('pngjs') as { PNG: { sync: { read(b: Buffer): { width: number; height: number; data: Buffer } } } };
  let png: { width: number; height: number; data: Buffer };
  try { png = pngjs.PNG.sync.read(buf); } catch { return false; }
  const { width, height, data } = png;
  if (!width || !height) return false;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));
  let n = 0, bright = 0;
  for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) continue;
    n++;
    if (Math.max(data[i], data[i + 1], data[i + 2]) / 255 >= 0.9) bright++;
  }
  return n >= 20 && bright / n >= 0.9;
}

export type BrandColorSource = 'meta' | 'icon' | null;

/** 브랜드 색 해석(네트워크 층 · 가드 fetch 주입) — theme-color·TileColor → 아이콘 PNG 지배색. 실패 = null(뷰어 기본 토큰). source는 근거 패널용. */
export async function resolveBrandColorGuarded(
  html: string, base: string, fetcher: GuardedImageFetcher,
): Promise<{ color: string | null; source: BrandColorSource }> {
  const meta = parseThemeColorFromHtml(html);
  if (meta) return { color: meta, source: 'meta' };
  for (const u of extractBrandIconCandidates(html, base)) {
    try {
      const img = await fetcher(u);
      if (!img || img.buffer.length > 600_000) continue;
      const c = dominantColorFromPng(img.buffer);
      if (c) return { color: c, source: 'icon' };
    } catch { /* 다음 후보 */ }
  }
  return { color: null, source: null };
}

// ===== 이미지 헤더 실측(순수 · 외부 라이브러리 0) =====

/** JPEG·PNG·GIF·WebP 헤더에서 폭·높이만 읽는다. 모르는 형식 = null. */
export function readImageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0x47 && b[1] === 0x49) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') {
    const t = b.subarray(12, 16).toString();
    if (t === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (t === 'VP8L') { const x = b.readUInt32LE(21); return { width: (x & 0x3fff) + 1, height: ((x >> 14) & 0x3fff) + 1 }; }
    if (t === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ((mk >= 0xc0 && mk <= 0xc3) || (mk >= 0xc5 && mk <= 0xc7) || (mk >= 0xc9 && mk <= 0xcb) || (mk >= 0xcd && mk <= 0xcf)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// ===== 상품 상세 페이지 파싱(순수) + 1홉 수집(가드 fetch) =====

function metaOf(h: string, p: string): string {
  return (h.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i'))?.[1]
    || h.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, 'i'))?.[1]
    || '').trim();
}

function numish(v: unknown): number | null {
  if (typeof v === 'number' && v > 0) return v;
  if (typeof v === 'string') { const n = Number(v.replace(/[^\d.]/g, '')); return n > 0 ? n : null; }
  return null;
}

/** 상세 페이지 HTML → 상품 1건(순수). og:type product / product:price / ld+json Product / 본문 가격 순. 상품 페이지가 아니면 null. */
export function parseProductPage(html: string, finalUrl: string): OutreachProduct | null {
  const h = html;
  const name = decodeHtmlEntities(metaOf(h, 'og:title') || (h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''))
    .replace(/\s+/g, ' ').replace(/\s*[|\-–:]\s*[^|\-–:]{1,30}$/, '').trim();
  const image = absolutizeAssetUrl(metaOf(h, 'og:image') || metaOf(h, 'og:image:secure_url') || '', finalUrl);
  let price: number | null = numish(metaOf(h, 'product:price:amount') || metaOf(h, 'product:sale_price:amount') || metaOf(h, 'og:price:amount'));
  let orig: number | null = numish(metaOf(h, 'product:original_price:amount'));
  if (price === null) {
    const ld = Array.from(h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi))
      .map((x) => { try { return JSON.parse(x[1]); } catch { return null; } }).filter(Boolean);
    const findOffer = (v: any, d = 0): number | null => {
      if (!v || d > 8) return null;
      if (Array.isArray(v)) { for (const x of v) { const r = findOffer(x, d + 1); if (r) return r; } return null; }
      if (typeof v === 'object') {
        if (v.offers) { const o = Array.isArray(v.offers) ? v.offers[0] : v.offers; const p = numish(o?.price || o?.lowPrice); if (p) return p; }
        for (const k of Object.keys(v)) { const r = findOffer(v[k], d + 1); if (r) return r; }
      }
      return null;
    };
    price = findOffer(ld);
  }
  if (price === null) {
    const t = stripTags(h.slice(0, 200_000));
    const ps = pricesOf(t);
    if (ps.length) {
      const s = [...ps].sort((a, b) => a - b);
      price = s[s.length - 1];
      if (s.length > 1 && s[0] < price) { orig = price; price = s[0]; }
    }
  }
  const isProductPage = /product/i.test(metaOf(h, 'og:type')) || !!metaOf(h, 'product:price:amount') || /"@type"\s*:\s*"Product"/i.test(h);
  if (orig === null) {
    const t = stripTags(h.slice(0, 120_000));
    const om = t.match(/(정가|소비자가|정상가)\s*[:：]?\s*(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원/);
    if (om) { const v = Number(om[2].replace(/,/g, '')); if (price !== null && v > price) orig = v; }
  }
  if (!isProductPage || !name || !image || price === null || /온라인 스토어|공식몰|official/i.test(name) || isBadProductImage(image)) return null;
  return {
    name: cleanProductName(name).slice(0, 80),
    price: orig && orig > price ? orig : price,
    discount_price: orig && orig > price ? price : null,
    image_url: image,
    link_url: finalUrl,
  };
}

/** 상세 1홉(가드 fetch · 같은 호스트만). 다른 호스트로 리다이렉트되면 버린다(불변 18 개정). 실패 = null. */
export async function fetchProductPageGuarded(url: string, homeHost: string): Promise<OutreachProduct | null> {
  let page: { html: string; finalUrl: string } | null = null;
  try {
    const r = await fetchHtmlGuarded(url, OUTREACH_FETCH_OPTS);
    page = r ? { html: r.html, finalUrl: r.finalUrl } : null;
  } catch {
    page = null;
  }
  if (!page) return null;
  try { if (new URL(page.finalUrl).hostname !== homeHost) return null; } catch { return null; }
  return parseProductPage(page.html, page.finalUrl);
}

/** 링크 목록에서 상품 want개까지 순차 수집(예의상 순차 · 식별자 중복 병합). */
export async function collectProductsFromLinks(links: string[], homeHost: string, want = 6): Promise<OutreachProduct[]> {
  const got: OutreachProduct[] = [];
  const keys = new Set<string>();
  for (const l of links) {
    if (got.length >= want) break;
    const p = await fetchProductPageGuarded(l, homeHost);
    if (!p) continue;
    const k = productKey(p);
    if (keys.has(k)) continue;
    keys.add(k);
    got.push(p);
  }
  return got;
}

// ===== 이미지 실측 + 사본 저장(호출부가 가드 fetch·저장 함수를 주입한다 = 이 파일은 저장소·SSRF 규약을 모른다) =====

export interface StoredImage {
  /** 우리 서버 공개 URL(절대) */
  url: string;
  width: number;
  height: number;
  bytes: number;
  /** 원 출처 URL(고지·근거용) */
  srcUrl: string;
}

export type GuardedImageFetcher = (url: string) => Promise<{ buffer: Buffer; mime: string; ext: string } | null>;
export type ImageStorer = (buffer: Buffer, meta: { ext: string; mime: string; width: number; height: number }) => string | null;

/** 후보 1장을 받아 폭 게이트를 통과하면 사본을 저장하고 기록을 돌려준다. 미만·실패 = null. */
export async function measureAndStoreImage(
  url: string, minWidth: number, fetcher: GuardedImageFetcher, store: ImageStorer,
): Promise<StoredImage | null> {
  const img = await fetcher(url);
  if (!img || img.buffer.length < 2_000 || img.buffer.length > OUTREACH_MEDIA_MAX_BYTES) return null;
  const size = readImageSize(img.buffer);
  if (!size || size.width < minWidth) return null;
  const stored = store(img.buffer, { ext: img.ext, mime: img.mime, width: size.width, height: size.height });
  if (!stored) return null;
  return { url: stored, width: size.width, height: size.height, bytes: img.buffer.length, srcUrl: url };
}

/** ★ 0905(3) C3-2 갤러리 수집 벽시계 예산 — 후보 24개 순차 fetch가 느린 CDN에서 잡을 붙잡지 않게(초과 = 그때까지 통과분으로 진행 · 실패 아님) */
export const OUTREACH_GALLERY_DEADLINE_MS = 45_000;

export interface PickStoredImagesResult {
  images: StoredImage[];
  /** 실제로 받아 본 후보 수 */
  tried: number;
  /** 벽시계 예산에 걸려 남은 후보를 보지 못했는가 */
  timedOut: boolean;
}

/**
 * 후보 배열에서 실측 통과분만 · **문서(DOM) 순서 유지**(★0905(5) 홈 첫 배너가 히어로가 되게 · 면적 정렬 폐기) · 최대 n장.
 * 후보는 n*3까지만 시도(느린 CDN 방어 · 메뉴 아이콘이 앞에 몰린 사이트 대비)하고 deadlineMs(벽시계)를 넘기면 거기서 멈춘다. 시도 수·예산 초과는 stats로 돌려준다.
 */
export async function pickStoredImagesDetail(
  cands: string[], n: number, minWidth: number, fetcher: GuardedImageFetcher, store: ImageStorer,
  opts: { deadlineMs?: number; maxTries?: number } = {},
): Promise<PickStoredImagesResult> {
  const infos: StoredImage[] = [];
  const maxTries = opts.maxTries ?? n * 3;
  const deadline = Date.now() + (opts.deadlineMs ?? OUTREACH_GALLERY_DEADLINE_MS);
  let tried = 0;
  let timedOut = false;
  for (const c of cands) {
    if (infos.length >= n || tried >= maxTries) break;
    if (Date.now() > deadline) { timedOut = true; break; }
    tried++;
    const i = await measureAndStoreImage(c, minWidth, fetcher, store);
    if (i) infos.push(i);
  }
  return { images: infos.slice(0, n), tried, timedOut };
}

export async function pickStoredImages(
  cands: string[], n: number, minWidth: number, fetcher: GuardedImageFetcher, store: ImageStorer,
): Promise<StoredImage[]> {
  return (await pickStoredImagesDetail(cands, n, minWidth, fetcher, store)).images;
}
