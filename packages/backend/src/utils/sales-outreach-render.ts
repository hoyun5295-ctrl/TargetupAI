/**
 * ★ 2026-09-06 AI 영업 아웃리치 S1 — 렌더 크롤 클라이언트 + 재료 승격 판정·병합(순수) + 재료 v2 조립(순수)
 * 설계 = docs/2026-09-06-campaign-engine-design.md §S1
 *
 * 두 층:
 *  ① 클라이언트(네트워크 = 127.0.0.1 워커만): renderPageGuarded — 워커가 안 떠 있으면(ECONNREFUSED) 즉시 실패를 돌려준다(대기 0).
 *     사용자는 기다리지 않고 정적 결과로 전진한다. 다른 렌더가 진행 중(409)이어도 같다. 실패 사유는 3값 별 키로 남긴다(불변 21).
 *  ② 순수 층: countMaterials(정적 HTML 재료 계측) · shouldEscalateToRender(승격 조건 4개 중 하나) · unionStrings/unionProducts/mergeCtaLinks(정적+렌더 합집합 ·
 *     렌더가 앞) · buildMaterialsV2(brand_profile.materials 조립 · DDL 0).
 *
 * 승격 조건(회의 수렴안 D1): 정적 재료가 상품 4 미만 · 이미지 후보 2 미만 · 본문 1,500자 미만 · 혜택가 쌍 0 중 하나면 렌더로 승격한다.
 * 서버 렌더 대형몰은 정적으로 끝나고(큐 점유 0), SPA 몰은 반드시 승격된다(아이소이 정적 = 텍스트 385자 · 상품 0).
 */
import http from 'node:http';
import {
  extractProducts, extractImageCandidates, extractImageCandidatesDetailed, extractProofSignals, productKey,
  type OutreachProduct, type ImageCandidateDetail, type ProofSignals, type OutreachEventCard,
} from './sales-outreach-media';
import type { RenderMeta } from './sales-outreach-render-guard';

export const OUTREACH_RENDER_URL = (process.env.OUTREACH_RENDER_URL || 'http://127.0.0.1:4317').replace(/\/+$/, '');
/** 워커 응답 대기 상한 — 워커 벽시계(최대 45초)보다 길게. 워커 미기동은 ECONNREFUSED 즉시라 이 값과 무관하다. */
export const OUTREACH_RENDER_REQUEST_TIMEOUT_MS = 60_000;

export interface RenderPaletteEntry { hex: string; weight: number; sources: string[] }
export interface RenderResult {
  finalUrl: string;
  html: string;
  text: string;
  screenshotBase64: string | null;
  meta: RenderMeta;
  /** ★ 0906(3) 렌더된 페이지의 브랜드 팔레트(계산된 스타일 · 채도 있는 색 · 면적 가중 · 최대 8) */
  palette: RenderPaletteEntry[];
  /** ★ 0906(3) 첫 화면(뷰포트 · 900px)만 담은 JPEG */
  screenshotViewportBase64: string | null;
}

const hexRgb = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * 팔레트 → 브랜드 주색 1개(순수). 채도 0.25 이상 · 밝기 0.08~0.78(흰 배경·검정 글자 제외) 중 가중치 최대. 없으면 null(호출부가 무채색 톤으로 간다 · 기본 보라 금지).
 */
export function pickBrandColorFromPalette(palette: ReadonlyArray<RenderPaletteEntry> | null | undefined): string | null {
  if (!Array.isArray(palette) || palette.length === 0) return null;
  const scored = palette.map((p) => {
    const rgb = hexRgb(p.hex);
    if (!rgb) return null;
    const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (sat < 0.25 || lum < 0.08 || lum > 0.78) return null;
    return { hex: p.hex.toLowerCase(), weight: Number(p.weight) || 0 };
  }).filter((x): x is { hex: string; weight: number } => !!x);
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.weight - a.weight);
  return scored[0].hex;
}
export type RenderFailureReason = 'unavailable' | 'busy' | 'blocked' | 'timeout' | 'error';
export type RenderOutcome =
  | { ok: true; result: RenderResult }
  | { ok: false; failure: { reason: RenderFailureReason; detail: string } };

/** 워커에 렌더 1건을 요청한다. 워커 부재·점유·차단·시간 초과는 전부 {ok:false}로 돌아온다(throw 0). */
export function renderPageGuarded(url: string, opts: { deadlineMs?: number; screenshot?: boolean; requestTimeoutMs?: number; baseUrl?: string; viewportWidth?: number; screenshotViewport?: boolean } = {}): Promise<RenderOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: RenderOutcome) => { if (!settled) { settled = true; resolve(v); } };
    let endpoint: URL;
    try { endpoint = new URL('/render', (opts.baseUrl || OUTREACH_RENDER_URL).replace(/\/+$/, '')); } catch { done({ ok: false, failure: { reason: 'error', detail: 'OUTREACH_RENDER_URL 형식 불명' } }); return; }
    const body = JSON.stringify({ url, deadlineMs: opts.deadlineMs, screenshot: !!opts.screenshot, viewportWidth: opts.viewportWidth, screenshotViewport: !!opts.screenshotViewport });
    const timeoutMs = opts.requestTimeoutMs && opts.requestTimeoutMs > 0 ? opts.requestTimeoutMs : OUTREACH_RENDER_REQUEST_TIMEOUT_MS;
    const req = http.request(
      {
        host: endpoint.hostname, port: endpoint.port || 80, path: endpoint.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode === 409) { done({ ok: false, failure: { reason: 'busy', detail: '다른 렌더가 진행 중' } }); return; }
          let parsed: any = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
          if (res.statusCode !== 200 || !parsed) { done({ ok: false, failure: { reason: 'error', detail: `워커 응답 ${res.statusCode || 0}` } }); return; }
          if (parsed.ok === true && typeof parsed.html === 'string') {
            done({ ok: true, result: { finalUrl: String(parsed.finalUrl || url), html: parsed.html, text: String(parsed.text || ''), screenshotBase64: parsed.screenshotBase64 || null, meta: parsed.meta, palette: Array.isArray(parsed.palette) ? parsed.palette : [], screenshotViewportBase64: parsed.screenshotViewportBase64 || null } });
            return;
          }
          const reason: RenderFailureReason = parsed.reason === 'blocked' || parsed.reason === 'timeout' ? parsed.reason : 'error';
          done({ ok: false, failure: { reason, detail: String(parsed.detail || '렌더 실패').slice(0, 300) } });
        });
        res.on('error', (e) => done({ ok: false, failure: { reason: 'error', detail: String(e?.message || e).slice(0, 200) } }));
      },
    );
    const timer = setTimeout(() => { req.destroy(new Error('timeout')); done({ ok: false, failure: { reason: 'timeout', detail: `워커 응답 ${timeoutMs}ms 초과` } }); }, timeoutMs);
    req.on('error', (e: any) => {
      clearTimeout(timer);
      const code = String(e?.code || '');
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') done({ ok: false, failure: { reason: 'unavailable', detail: `렌더 워커 미기동(${code})` } });
      else done({ ok: false, failure: { reason: 'error', detail: String(e?.message || e).slice(0, 200) } });
    });
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}

// ===== 재료 계측 · 승격 판정(순수) =====

export interface MaterialCounts {
  products: number;
  discountPairs: number;
  imageCandidates: number;
  textChars: number;
  priceMentions: number;
}

const PRICE_MENTION_RE = /(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원/g;

/** HTML → 본문 텍스트 글자 수(script·style 제외 · 순수) */
export function visibleTextChars(html: string): number {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/** 정적(또는 렌더) HTML 하나의 재료 계측 — 승격 판정과 화면 카드가 같은 숫자를 쓴다. */
export function countMaterials(html: string, base: string): MaterialCounts {
  const products = extractProducts(html, base, 12);
  return {
    products: products.length,
    discountPairs: products.filter((p) => p.discount_price !== null && p.price !== null && p.discount_price < (p.price as number)).length,
    imageCandidates: extractImageCandidates(html, base, 24).length,
    textChars: visibleTextChars(html),
    priceMentions: (String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').match(PRICE_MENTION_RE) || []).length,
  };
}

/** 승격 임계(회의 수렴안) — 하나라도 미달이면 렌더 */
export const RENDER_ESCALATION = { minProducts: 4, minImages: 2, minTextChars: 1500, minDiscountPairs: 1 } as const;

export type EscalationReason = 'static_unavailable' | 'few_products' | 'few_images' | 'thin_text' | 'no_discount_pairs';

export function shouldEscalateToRender(counts: MaterialCounts | null): { escalate: boolean; reasons: EscalationReason[] } {
  if (!counts) return { escalate: true, reasons: ['static_unavailable'] };
  const reasons: EscalationReason[] = [];
  if (counts.products < RENDER_ESCALATION.minProducts) reasons.push('few_products');
  if (counts.imageCandidates < RENDER_ESCALATION.minImages) reasons.push('few_images');
  if (counts.textChars < RENDER_ESCALATION.minTextChars) reasons.push('thin_text');
  if (counts.discountPairs < RENDER_ESCALATION.minDiscountPairs) reasons.push('no_discount_pairs');
  return { escalate: reasons.length > 0, reasons };
}

// ===== 합집합(순수 · 렌더가 앞 · 정적이 뒤) =====

export function unionStrings(primary: readonly string[], secondary: readonly string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of [primary, secondary]) {
    for (const s of list) {
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export function unionProducts(primary: readonly OutreachProduct[], secondary: readonly OutreachProduct[], max: number): OutreachProduct[] {
  const out: OutreachProduct[] = [];
  const seen = new Set<string>();
  for (const list of [primary, secondary]) {
    for (const p of list) {
      const k = productKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export function unionImageDetails(primary: readonly ImageCandidateDetail[], secondary: readonly ImageCandidateDetail[], max: number): ImageCandidateDetail[] {
  const out: ImageCandidateDetail[] = [];
  const seen = new Set<string>();
  for (const list of [primary, secondary]) {
    for (const d of list) {
      if (!d?.url || seen.has(d.url)) continue;
      seen.add(d.url);
      out.push({ ...d, order: out.length });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** 키워드별 딥링크 표 병합 — 앞 표가 이기고 빈 키만 뒤에서 채운다 */
export function mergeCtaLinks(primary: Record<string, string>, secondary: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...secondary };
  for (const [k, v] of Object.entries(primary || {})) if (v) out[k] = v;
  return out;
}

// ===== 재료 v2(brand_profile.materials · DDL 0) =====

export type MaterialSource = 'static' | 'render' | 'mixed';

export interface OutreachMaterialsV2 {
  v: 2;
  source: MaterialSource;
  /** 상품(목록 카드 기준 · 상세 격상 전) — 가격 쌍·할인율·평점·리뷰수·뱃지는 원문에 문자열로 있을 때만 */
  products: OutreachProduct[];
  /** 배너 후보(문서 순서 · alt 동반) */
  banners: ImageCandidateDetail[];
  /** 사회적 증거(원문 문자열 그대로 · 없으면 null) */
  proof: ProofSignals;
  /** ★ v3 이벤트 목록 카드(행사 페이지 1홉 HTML 에서 · 원 URL · 최대 6) · 옛 기록에는 없다 */
  eventCards: OutreachEventCard[];
  counts: {
    products: number; discountPairs: number; banners: number; textChars: number; priceMentions: number;
    /** 정적 계측(승격 판정 입력) · 렌더가 없으면 counts 와 같다 */
    staticTextChars: number; staticProducts: number;
    /** ★ v3 카드 수 */
    eventCards: number;
  };
  escalation: { attempted: boolean; reasons: EscalationReason[] };
  collectedAt: string;
}

export function buildMaterialsV2(input: {
  source: MaterialSource;
  products: OutreachProduct[];
  banners: ImageCandidateDetail[];
  text: string;
  staticCounts: MaterialCounts | null;
  escalation: { attempted: boolean; reasons: EscalationReason[] };
  /** ★ v3 이벤트 목록 카드(없으면 []) */
  eventCards?: OutreachEventCard[];
  now?: Date;
}): OutreachMaterialsV2 {
  const proof = extractProofSignals(input.text || '');
  const eventCards = Array.isArray(input.eventCards) ? input.eventCards : [];
  return {
    v: 2,
    source: input.source,
    products: input.products,
    banners: input.banners,
    proof,
    eventCards,
    counts: {
      products: input.products.length,
      discountPairs: input.products.filter((p) => p.discount_price !== null && p.price !== null && (p.discount_price as number) < (p.price as number)).length,
      banners: input.banners.length,
      textChars: String(input.text || '').length,
      priceMentions: (String(input.text || '').match(PRICE_MENTION_RE) || []).length,
      staticTextChars: input.staticCounts?.textChars ?? 0,
      staticProducts: input.staticCounts?.products ?? 0,
      eventCards: eventCards.length,
    },
    escalation: input.escalation,
    collectedAt: (input.now || new Date()).toISOString(),
  };
}

/** 렌더 HTML에서 배너 후보(alt 동반)를 뽑는다 — 같은 순수 추출기, 호출부 편의 래퍼 */
export function bannersOf(html: string, base: string, max = 24): ImageCandidateDetail[] {
  return extractImageCandidatesDetailed(html, base, max);
}
