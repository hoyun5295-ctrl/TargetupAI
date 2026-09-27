/**
 * brand-page-reader.ts — 주소 하나 → 재료 v1 프리필 (★ 2026-09-27 만들기 개편 S12 · Harold 결재 ①②)
 *
 * 담당자가 자기 홈페이지·행사 페이지 주소를 붙여넣으면 AI 영업의 **순수 추출 부품**으로 재료를 채운다:
 *   행사 카드(≤3 · 이벤트 목록 카드 → 없으면 그 페이지 한 장) · 사진 사본(≤6 · 폭 ≥600) · 로고 사본 · 브랜드 색 · 홈페이지 상품(≤4 · 사진 사본 · 가격 없음).
 *
 * ⛔ AI 0회. 크롤은 가드 경로만(`fetchHtmlGuarded` · 렌더 워커) · 렌더는 **대기 0**(워커가 AI 영업을 돌리는 중이면 정적 결과로 간다 · 불변 10).
 * ⛔ 사진은 이 회사 서빙 경로(`/api/cdp/inapp/image/{회사}/…`)에 **사본**으로 둔다 — 재료 게이트(`isCompanyImageUrl`)가 절대 URL 을 거부한다.
 * ⛔ 면허는 여기서 정하지 않는다. 읽어 온 카드는 **재료**다 — 할인율·기간을 그대로 쓰려면 담당자가 카드마다 "이 문구 그대로 쓰기"를
 *    직접 켠다(직접 입력 판과 같은 규칙 · 불변 1). ★ Codex 3R~12R 결론: 페이지 글·마크업으로 행사 진행 여부를 추측해 면허를 주던 판정은
 *    닫히지 않는 문제라 걷어 냈다(설계서 §10). `readId`·`hash` 는 감사 기록·과금 지문용.
 * ⛔ 종료일이 지난 행사는 카드에서 뺀다(표시 정리 · 면허와 무관).
 */
import * as crypto from 'crypto';
import { fetchHtmlGuarded } from './dm/dm-brand-extractor';
import {
  OUTREACH_FETCH_OPTS, OUTREACH_GALLERY_MIN_WIDTH, OUTREACH_PRODUCT_MIN_WIDTH,
  extractEventListCards, extractImageCandidates, extractLogoCandidates, extractProducts, extractRenderedProductCards,
  pickStoredImagesDetail, readImageSize, pngLooksWhite, resolveBrandColorGuarded, decodeHtmlEntities,
  type GuardedImageFetcher, type ImageStorer, type OutreachProduct,
} from './sales-outreach-media';
import { renderPageGuarded, countMaterials, shouldEscalateToRender, pickBrandColorFromPalette, type RenderOutcome, type RenderRequestOptions } from './sales-outreach-render';
import { buildOutreachEventText } from './sales-outreach-extract';
import { parseLicensedEndDate } from './sales-outreach-jobs';
import { fetchImageGuarded } from './sales-outreach-produce';
import { writeTempBuffer, moveTempToPermanent } from './image-studio';
import { getCafe24Integration } from './cafe24-client';
import { listWooIntegrations } from './woocommerce-client';

export const PAGE_READ_TTL_MS = 10 * 60 * 1000;
export const PAGE_READ_CARDS_MAX = 3;
export const PAGE_READ_IMAGES_MAX = 6;
export const PAGE_READ_PRODUCTS_MAX = 4;
const PAGE_READ_CACHE_MAX = 500;
const CARD_TEXT_MAX = 600;

export interface PageReadCard {
  id: string;
  title: string;
  text: string;
  /** 페이지에 적힌 기간 줄 원문(목록 카드만 · 해석하지 않은 그대로) */
  periodRaw: string | null;
  /** 사본 URL(회사 서빙 경로) · 없으면 null */
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  link: string;
  /** 카드 지문 16(제목·본문) — 생성 요청이 이 값과 readId 를 싣고 온다(감사·과금 지문) */
  hash: string;
}
export interface PageReadProduct { name: string; url: string; imageUrl: string; width: number | null; height: number | null }
export interface PageReadResult {
  readId: string;
  finalUrl: string;
  host: string;
  cards: PageReadCard[];
  images: Array<{ url: string; width: number; height: number }>;
  logoUrl: string | null;
  brandColor: string | null;
  products: PageReadProduct[];
  /** 렌더로 읽었는가(정적 재료가 얇아 승격 · 워커 점유 중이면 false) */
  rendered: boolean;
  /** 이 회사 몰 연동 도메인인가(강 증명) — 아니면 확인 창에서 도메인 실명 고지로 동의받는다(결재 ②) */
  mallDomain: boolean;
  cached: boolean;
}

export class PageReadError extends Error {
  constructor(public status: number, public code: 'URL_INVALID' | 'READ_FAILED', message: string) { super(message); }
}

type CacheEntry = { companyId: string; urlKey: string; at: number; result: PageReadResult };
const cacheById = new Map<string, CacheEntry>();
const idByKey = new Map<string, string>();

function sweep(now: number): void {
  for (const [id, e] of cacheById) {
    if (now - e.at > PAGE_READ_TTL_MS) { cacheById.delete(id); idByKey.delete(`${e.companyId}|${e.urlKey}`); }
  }
  while (cacheById.size > PAGE_READ_CACHE_MAX) {
    const first = cacheById.keys().next().value as string | undefined;
    if (!first) break;
    const e = cacheById.get(first);
    cacheById.delete(first);
    if (e) idByKey.delete(`${e.companyId}|${e.urlKey}`);
  }
}

/** 주소 정규화(순수) — http(s) · 500자 · 공백 0 · 해시 제거. 형식이 아니면 null. */
export function normalizeReadUrl(raw: unknown): string | null {
  let s = String(raw ?? '').trim();
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    u.hash = '';
    return u.toString();
  } catch { return null; }
}

/** 카드 지문 16(순수) — 제목·본문. */
export function pageCardHash(title: string, text: string): string {
  return crypto.createHash('sha1').update(`${String(title || '').trim()}\n${String(text || '').trim()}`).digest('hex').slice(0, 16);
}

function todayKst(now: number): string {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function visibleText(html: string): string {
  return decodeHtmlEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function pageTitleOf(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{2,120})["']/i)
    || html.match(/<meta[^>]+content=["']([^"']{2,120})["'][^>]+property=["']og:title["']/i);
  const t = og ? og[1] : ((html.match(/<title[^>]*>([\s\S]{2,160}?)<\/title>/i) || [])[1] || '');
  return decodeHtmlEntities(t).replace(/\s+/g, ' ').trim().slice(0, 60);
}

export interface PageReaderDeps {
  fetchHtml: (url: string) => Promise<{ html: string; baseUrl: string; finalUrl: string } | null>;
  render: (url: string, opts: RenderRequestOptions) => Promise<RenderOutcome>;
  fetchImage: GuardedImageFetcher;
  storeImage: (companyId: string) => ImageStorer;
  mallHosts: (companyId: string) => Promise<string[]>;
  now: () => number;
}

export const defaultPageReaderDeps: PageReaderDeps = {
  fetchHtml: (url) => fetchHtmlGuarded(url, OUTREACH_FETCH_OPTS),
  render: (url, opts) => renderPageGuarded(url, opts),
  fetchImage: (u) => fetchImageGuarded(u),
  storeImage: (companyId) => (buffer, meta) => {
    const tempId = writeTempBuffer(companyId, buffer, { kind: 'source', ext: meta.ext, mime: meta.mime, width: meta.width, height: meta.height } as any);
    const moved = moveTempToPermanent(companyId, tempId);
    return moved ? moved.url : null; // 상대 경로(회사 서빙 경로 · 재료 게이트 통과)
  },
  mallHosts: async (companyId) => {
    const hosts: string[] = [];
    try {
      const cafe = await getCafe24Integration(companyId);
      if (cafe && cafe.status === 'active' && cafe.mallId) hosts.push(`${cafe.mallId}.cafe24.com`);
    } catch { /* 없음 */ }
    try {
      for (const w of await listWooIntegrations(companyId)) {
        if (w.siteUrl) { try { hosts.push(new URL(w.siteUrl).hostname); } catch { /* 형식 불명 */ } }
      }
    } catch { /* 없음 */ }
    return hosts.map((h) => h.toLowerCase().replace(/^www\./, ''));
  },
  now: () => Date.now(),
};

/**
 * 주소 한 장을 읽어 재료 프리필을 만든다. 같은 회사·같은 주소는 10분 캐시(readId 재사용).
 * 실패 = PageReadError(URL_INVALID 400 · READ_FAILED 422) — 화면은 "사진·글을 직접 넣어 주세요"로 넘어간다.
 */
export async function readBrandPage(companyId: string, rawUrl: unknown, deps: PageReaderDeps = defaultPageReaderDeps): Promise<PageReadResult> {
  const url = normalizeReadUrl(rawUrl);
  if (!url) throw new PageReadError(400, 'URL_INVALID', '주소 형식이 맞지 않아요. 예: https://www.우리회사.com/event');
  const now = deps.now();
  sweep(now);
  const cachedId = idByKey.get(`${companyId}|${url}`);
  const hit = cachedId ? cacheById.get(cachedId) : undefined;
  if (hit && hit.companyId === companyId && now - hit.at <= PAGE_READ_TTL_MS) return { ...hit.result, cached: true };

  const stat = await deps.fetchHtml(url);
  let html = stat?.html || '';
  let base = stat?.finalUrl || stat?.baseUrl || url;
  let rendered = false;
  let palette: Array<{ hex: string; weight: number; sources: string[] }> = [];
  const counts = stat ? countMaterials(stat.html, stat.baseUrl) : null;
  if (!stat || shouldEscalateToRender(counts).escalate) {
    // 렌더 대기 0 — 워커 점유(AI 영업 일괄) · 부재 · 차단이면 정적 결과로 간다(실패 아님)
    const r = await deps.render(url, { queueWaitMs: 0, deadlineMs: 20_000, requestTimeoutMs: 30_000 });
    if (r.ok) { html = r.result.html; base = r.result.finalUrl || base; rendered = true; palette = r.result.palette || []; }
  }
  if (!html) throw new PageReadError(422, 'READ_FAILED', '페이지를 읽지 못했어요. 주소를 확인하거나 사진·글을 직접 넣어 주세요.');

  let host = '';
  try { host = new URL(base).hostname.toLowerCase(); } catch { host = ''; }
  const today = todayKst(now);

  // ① 행사 카드 — 이벤트 목록 카드(원문 문자열 · AI 0) → 없으면 이 페이지 한 장. 종료일이 지난 카드는 뺀다(표시 정리).
  //   종료일 = 추출기가 읽은 기간 줄(목록) · 페이지 한 장은 자르지 않은 보이는 글의 가장 늦은 날짜(전부 지났으면 끝난 페이지).
  type Draft = { title: string; text: string; periodRaw: string | null; imageSrc: string | null; link: string };
  const extracted = extractEventListCards(html, base, parseLicensedEndDate, 8);
  const listCards = extracted.filter((c) => !c.endDate || c.endDate >= today);
  let drafts: Draft[] = listCards.slice(0, PAGE_READ_CARDS_MAX).map((c) => ({
    title: c.title.slice(0, 40),
    text: [c.title, c.periodRaw ? `기간 ${c.periodRaw}` : ''].filter(Boolean).join('\n').slice(0, CARD_TEXT_MAX),
    periodRaw: c.periodRaw, imageSrc: c.imageUrl, link: c.linkUrl,
  }));
  // ★ Codex 6R·13R — 페이지 한 장은 추출기가 목록 카드를 **하나도 못 찾았을 때만**. 지난 카드를 전부 뺀 목록 페이지를 되살리면
  //   마크업 속성에만 있던 종료일이 사라져 지난 행사가 재료로 다시 들어온다.
  if (extracted.length === 0) {
    const text = (buildOutreachEventText(html) || '').slice(0, CARD_TEXT_MAX);
    const title = pageTitleOf(html).slice(0, 40);
    const end = parseLicensedEndDate(visibleText(html)).end;
    if ((title || text) && (!end || end >= today)) drafts = [{ title, text, periodRaw: null, imageSrc: null, link: base }];
  }

  // ② 사진 사본 — 카드 배너 먼저 · 그다음 페이지 이미지(문서 순서) · 폭 ≥600 · 최대 6
  const store = deps.storeImage(companyId);
  const cands = [...drafts.map((d) => d.imageSrc).filter((u): u is string => !!u), ...extractImageCandidates(html, base, 24)]
    .filter((u, i, arr) => arr.indexOf(u) === i);
  const pick = await pickStoredImagesDetail(cands, PAGE_READ_IMAGES_MAX, OUTREACH_GALLERY_MIN_WIDTH, deps.fetchImage, store, { deadlineMs: 20_000 });
  const bySrc = new Map(pick.images.map((im) => [im.srcUrl, im]));

  // ③ 로고 사본 — 크기·비율·흰 로고 거른 첫 장
  let logoUrl: string | null = null;
  for (const u of extractLogoCandidates(html, base).slice(0, 6)) {
    try {
      const img = await deps.fetchImage(u);
      if (!img || img.buffer.length > 400_000) continue;
      const size = readImageSize(img.buffer);
      if (!size || size.width < 60 || size.width / size.height < 0.5 || size.width / size.height > 8) continue;
      if (img.ext === 'png' && pngLooksWhite(img.buffer)) continue;
      logoUrl = store(img.buffer, { ext: img.ext, mime: img.mime, width: size.width, height: size.height });
      if (logoUrl) break;
    } catch { /* 다음 후보 */ }
  }

  // ④ 브랜드 색 — 렌더 팔레트 → 메타·아이콘 지배색
  let brandColor = pickBrandColorFromPalette(palette);
  if (!brandColor) {
    try { brandColor = (await resolveBrandColorGuarded(html, base, deps.fetchImage)).color; } catch { brandColor = null; }
  }

  // ⑤ 홈페이지 상품 — 사진 사본(폭 ≥400) · 가격 없음(가격은 몰 재조회만 · 불변 9) · 같은 호스트 링크만
  const rawProducts: OutreachProduct[] = [...(rendered ? extractRenderedProductCards(html, base, 8) : []), ...extractProducts(html, base, 8)];
  const products: PageReadProduct[] = [];
  const seenName = new Set<string>();
  for (const p of rawProducts) {
    if (products.length >= PAGE_READ_PRODUCTS_MAX) break;
    const key = p.name.replace(/\s+/g, '').toLowerCase();
    if (!p.name || seenName.has(key) || !p.image_url) continue;
    try { if (new URL(p.link_url).hostname.toLowerCase() !== host) continue; } catch { continue; }
    const got = await pickStoredImagesDetail([p.image_url], 1, OUTREACH_PRODUCT_MIN_WIDTH, deps.fetchImage, store, { deadlineMs: 8_000, maxTries: 1 });
    const im = got.images[0];
    if (!im) continue;
    seenName.add(key);
    products.push({ name: p.name.slice(0, 60), url: p.link_url, imageUrl: im.url, width: im.width, height: im.height });
  }

  const cards: PageReadCard[] = drafts.map((d, i) => {
    const im = d.imageSrc ? bySrc.get(d.imageSrc) : undefined;
    return {
      id: `read${i + 1}`,
      title: d.title,
      text: d.text,
      periodRaw: d.periodRaw,
      imageUrl: im ? im.url : null,
      imageWidth: im ? im.width : null,
      imageHeight: im ? im.height : null,
      link: d.link,
      hash: pageCardHash(d.title, d.text),
    };
  });
  const cardImageUrls = new Set(cards.map((c) => c.imageUrl).filter(Boolean));
  const images = pick.images.filter((im) => !cardImageUrls.has(im.url)).map((im) => ({ url: im.url, width: im.width, height: im.height }));

  const mallHosts = await deps.mallHosts(companyId).catch(() => [] as string[]);
  const bare = host.replace(/^www\./, '');
  const readId = crypto.randomBytes(16).toString('hex');
  const result: PageReadResult = {
    readId, finalUrl: base, host, cards, images, logoUrl, brandColor, products, rendered,
    mallDomain: !!bare && mallHosts.includes(bare), cached: false,
  };
  cacheById.set(readId, { companyId, urlKey: url, at: now, result });
  idByKey.set(`${companyId}|${url}`, readId);
  return result;
}

/** 감사 기록용 — readId 가 가리키는 호스트(없으면 null) */
export function readHostOf(companyId: string, readId: string | null | undefined): string | null {
  if (!readId) return null;
  const e = cacheById.get(readId);
  return e && e.companyId === companyId ? e.result.host : null;
}

/** 테스트 전용 — 캐시 비우기 */
export function __clearPageReadCache(): void { cacheById.clear(); idByKey.clear(); }
