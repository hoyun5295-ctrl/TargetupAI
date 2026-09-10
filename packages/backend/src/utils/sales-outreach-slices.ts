/**
 * ★ 2026-09-09 기획전 슬라이스 조립 모드(AI 영업) — 재료 판정 · 자격 · 구성(AI 0 · 문안 0).
 * 설계 = docs/2026-09-06-outreach-v3-brand-page-recomposition-design.md §18.
 *
 * 경위: 아이소이 실측(0908~0909). 우리 골격으로 다시 그린 DM 보다, 브랜드 디자이너가 만든 기획전 페이지의
 *   세로 슬라이스(960px 이미지 15장)를 그대로 이어 붙인 시안이 압도적으로 좋았다(Harold 판정 · 프로토타입 캡처 대조).
 *   퀄리티 상한이 "우리 골격"에서 "브랜드 디자이너"로 바뀌고, 모델의 일은 그리기에서 고르기로 줄어든다.
 *
 * 계약:
 *  - 재료 = 렌더 워커가 준 이미지 기하(원본 폭·높이 · 렌더 폭·높이 · 세로 위치). 정적 HTML 에는 기하가 없다.
 *    세로로 이어진(간격 ≤ OUTREACH_SLICE_GAP_MAX) 넓은(원본 ≥600 · 렌더 ≥480 · 가로세로비 ≤3.2) 이미지 묶음 중 가장 긴 것 하나.
 *  - 자격 = 사람이 고른 행사 카드 중 면허(미래 종료일) 있는 카드의 상세 페이지일 것 + 그 슬라이스 사본이 OUTREACH_SLICE_MIN 이상.
 *  - 구성 = header · gallery(list_1xN · full_bleed · 슬라이스마다 상세 링크) · cta(라벨은 호출부가 eventCtaLabel 로 만든다) · footer.
 *    문안·혜택 생성 0 · 슬라이스 안 글자는 이미지라 못 고친다(버튼도 이미지 → 카드 전체 링크로만 동작).
 *  - 이 파일은 sales-outreach-produce.ts 를 import 하지 않는다(순환 차단 · produce 가 이 파일을 쓴다).
 */
import type { Section, SectionType } from './dm/dm-section-registry';
import { getDefaultProps } from './dm/dm-section-registry';
import type { EngineEventCard } from './campaign-engine';
import type { StoredImage } from './sales-outreach-media';

/** 렌더 워커가 준 이미지 1장의 기하 — src · 원본 폭(w)·높이(h) · 렌더 폭(rw)·높이(rh) · 문서 위 세로 위치(top) · ★ v4 감싸는 앵커 href(없으면 null · 옛 워커 = 키 없음) */
export interface RenderImage { src: string; w: number; h: number; rw: number; rh: number; top: number; href?: string | null; alt?: string }
/** 재료(brand_profile.eventSlices.images) — 원 URL · 원본 크기 · 문서 순서 */
export interface EventSliceImage { url: string; width: number; height: number; order: number }
/** brand_profile.eventSlices — 슬라이스 묶음(원 URL · 사본은 media.slices). ★ v4 source = 어느 입구에서 찾았나(면허 카드 상세 · 홈에 걸린 프로모션 페이지) */
export interface EventSliceMaterial { detailUrl: string; finalUrl: string; images: EventSliceImage[]; candidates: number; at: string; source?: 'event_card' | 'promo_page' }
/** ★ v4 홈 상단 배너(렌더 기하 · 원 URL · 감싸는 앵커 href) — 갤러리 후보의 맨 앞(히어로 = 홈 첫 배너 · 불변 26) */
export interface HeroBanner { url: string; width: number; height: number; href: string | null; order: number; /** ★ 2026-09-10 렌더 alt(글자 카드 ↔ 배너 대조 원천 · 없으면 키 없음) */ alt?: string }

export const OUTREACH_SLICE_MIN = 3;
export const OUTREACH_SLICE_MAX = 20;
/** 원본 폭 하한 = 갤러리와 같은 600 */
export const OUTREACH_SLICE_MIN_WIDTH = 600;
/** 렌더 폭 하한(1280 뷰포트 기준 · 본문 폭 960 이 대표) */
export const OUTREACH_SLICE_MIN_RENDER_WIDTH = 480;
/** 가로세로비 상한 — 3.2 를 넘으면 띠 배너(메뉴·하단 배너)라 슬라이스가 아니다(아이소이 실측: 슬라이스 0.68~1.84 · 하단 배너 3.67·5.94) */
export const OUTREACH_SLICE_MAX_ASPECT = 3.2;
/**
 * 세로 간격 허용(px) — ★ v4 600 으로 넓힘(재료 축 · 설계서 §19). 기획전 슬라이스는 0 간격으로 이어지지만(아이소이),
 * 프로모션·스토리 페이지는 넓은 이미지 사이에 글 블록이 선다(톤28 펩타시카 220~475px). 폭 일치(±15%)와 비율 게이트가 띠 배너·상품 격자를 거른다.
 */
export const OUTREACH_SLICE_GAP_MAX = 600;
/** ★ v4 홈 상단 배너 판정 — 문서 위쪽(px) · 원본 폭 하한 · 가로형 하한(폭/높이) · 최대 장수 */
export const OUTREACH_HERO_TOP_MAX = 300;
export const OUTREACH_HERO_MIN_WIDTH = 900;
export const OUTREACH_HERO_MIN_ASPECT = 1.2;
export const OUTREACH_HERO_MAX = 8;
/** 같은 묶음의 렌더 폭 허용 오차(비율) */
export const OUTREACH_SLICE_WIDTH_TOLERANCE = 0.15;
/** 600폭 환산 누적 높이 예산(px) — 아이소이 실측: 히어로 1 + 혜택 7 + 상품 카드 2 = 5,290 */
export const OUTREACH_SLICE_HEIGHT_BUDGET_600 = 5400;
/** ★ v4-2 프로모션·스토리 페이지에서 온 슬라이스 상한(사진이 DM 을 다 먹지 않게 · 상품 카드 자리를 남긴다 · 톤28 실측) */
export const OUTREACH_SLICE_PROMO_MAX = 4;
/** ★ v4-2 슬라이스 모드에 싣는 상품 카드 상한 */
export const OUTREACH_SLICE_PRODUCTS_MAX = 4;
/** ★ v4-2 사이트명·공식몰 같은 제목(카드 제목으로 못 쓴다 · 버튼 문구도 상품형으로) */
const SITE_LIKE_TITLE_RE = /공식몰|공식\s*스토어|온라인\s*스토어|official|store|shop|홈페이지|mall/i;
const GENERIC_ALT_WORD_RE = /^(?:이미지|배너|썸네일|사진|image\d*|img\d*|banner\d*|photo\d*|thumb(?:nail)?\d*)$/i;

const EXCLUDE_RE = /(logo|favicon|sprite|btn_|icon|\.svg(\?|$)|\.gif(\?|$)|1x1|pixel|blank)/i;

/** 슬라이스 1장의 600폭 환산 높이(정수 px) */
export function sliceHeightAt600(s: { width: number; height: number }): number {
  const w = Number(s.width) || 0;
  const h = Number(s.height) || 0;
  return w > 0 ? Math.round((h * 600) / w) : 0;
}

/**
 * 렌더된 이미지 기하 → 세로로 이어진 넓은 이미지 묶음(가장 긴 것 하나 · 문서 순서). 3장 미만 = null.
 * candidates = 폭·비율 게이트를 통과한 장수(중복 제거 후 · 근거 패널용).
 */
export function detectEventSlices(images: readonly RenderImage[]): { images: EventSliceImage[]; candidates: number } | null {
  const cands = (Array.isArray(images) ? images : [])
    .filter((i) => i && typeof i.src === 'string' && /^https?:\/\//i.test(i.src) && !EXCLUDE_RE.test(i.src))
    .filter((i) => Number(i.w) >= OUTREACH_SLICE_MIN_WIDTH && Number(i.h) > 0 && Number(i.rw) >= OUTREACH_SLICE_MIN_RENDER_WIDTH && Number(i.rh) >= 120)
    .filter((i) => Number(i.w) / Number(i.h) <= OUTREACH_SLICE_MAX_ASPECT)
    .slice()
    .sort((a, b) => a.top - b.top);
  // 같은 주소가 이어 붙어 있으면 한 번만(반응형 중복 삽입)
  const dedup: RenderImage[] = [];
  for (const c of cands) if (!dedup.length || dedup[dedup.length - 1].src !== c.src) dedup.push(c);
  const runs: RenderImage[][] = [];
  let cur: RenderImage[] = [];
  for (const c of dedup) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const gap = c.top - (prev.top + prev.rh);
      const w0 = cur[0].rw;
      const widthOk = Math.abs(c.rw - w0) <= w0 * OUTREACH_SLICE_WIDTH_TOLERANCE;
      if (widthOk && gap <= OUTREACH_SLICE_GAP_MAX && gap >= -OUTREACH_SLICE_GAP_MAX) { cur.push(c); continue; }
      runs.push(cur);
    }
    cur = [c];
  }
  if (cur.length) runs.push(cur);
  const best = runs.reduce<RenderImage[]>((a, b) => (b.length > a.length ? b : a), []);
  if (best.length < OUTREACH_SLICE_MIN) return null;
  return {
    images: best.slice(0, OUTREACH_SLICE_MAX).map((i, idx) => ({ url: i.src, width: Number(i.w), height: Number(i.h), order: idx })),
    candidates: dedup.length,
  };
}

/**
 * ★ v4 홈 상단 배너(순수) — 렌더 기하에서 문서 위쪽(≤300px)에 놓인 넓은(원본 ≥900) 가로형(폭/높이 ≥1.2) 이미지. 같은 주소 1번 · 문서 순서 · 최대 8.
 * 슬라이더는 같은 이미지를 앞뒤로 복제해 두므로(톤28 홈 14장 → 7장) 주소로 중복을 접는다. 세로형(모바일용 복제)과 작은 로고·아이콘은 빠진다.
 */
export function heroBannersOf(images: readonly RenderImage[]): HeroBanner[] {
  const out: HeroBanner[] = [];
  const seen = new Set<string>();
  for (const i of Array.isArray(images) ? images : []) {
    if (!i || typeof i.src !== 'string' || !/^https?:\/\//i.test(i.src) || EXCLUDE_RE.test(i.src)) continue;
    const w = Number(i.w) || 0; const h = Number(i.h) || 0;
    if (w < OUTREACH_HERO_MIN_WIDTH || h <= 0 || w / h < OUTREACH_HERO_MIN_ASPECT) continue;
    if (Number(i.top) > OUTREACH_HERO_TOP_MAX) continue;
    if (seen.has(i.src)) continue;
    seen.add(i.src);
    const alt = String(i.alt || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    out.push({ url: i.src, width: w, height: h, href: i.href && /^https?:\/\//i.test(String(i.href)) ? String(i.href) : null, order: out.length, ...(alt ? { alt } : {}) });
    if (out.length >= OUTREACH_HERO_MAX) break;
  }
  return out;
}

/** ★ 2026-09-10 행사 대표 이미지(순수) — 렌더한 행사 페이지에서 원본 폭 ≥600 · 비율 ≤4(띠 배너 제외) · 문서 위쪽(top)이 가장 앞선 것 1장. 없으면 null. */
export const OUTREACH_EVENT_BANNER_MAX_ASPECT = 4;
export function pickEventBannerImage(images: readonly RenderImage[]): RenderImage | null {
  const list = (Array.isArray(images) ? images : []).filter((i) => {
    if (!i || typeof i.src !== 'string' || !/^https?:\/\//i.test(i.src) || EXCLUDE_RE.test(i.src)) return false;
    const w = Number(i.w) || 0; const h = Number(i.h) || 0;
    return w >= OUTREACH_SLICE_MIN_WIDTH && h > 0 && w / h <= OUTREACH_EVENT_BANNER_MAX_ASPECT;
  });
  if (!list.length) return null;
  return [...list].sort((a, b) => (Number(a.top) || 0) - (Number(b.top) || 0))[0];
}

const squashText = (s: string) => String(s || '').replace(/\s+/g, '').toLowerCase();

/**
 * ★ v4-2 코드가 세우는 프로모션 카드의 제목(순수) — 슬라이스 첫 장들의 alt("Farm to Product 사진" → "Farm to Product") → 경로 마지막 조각("peptacica") → 페이지 title 앞부분 → "기획 페이지".
 * 사이트명·"공식몰" 류(톤28 실측: title "톤28 공식몰")는 제목이 아니다. AI 0.
 */
export function promoCardTitleOf(images: readonly RenderImage[], pageUrl: string, pageTitle: string | null | undefined, siteName: string | null | undefined): string {
  const site = squashText(siteName || '');
  const siteLike = (t: string) => !t || t.length < 2 || SITE_LIKE_TITLE_RE.test(t) || (!!site && (squashText(t) === site || squashText(t).replace(site, '').length < 2));
  for (const i of Array.isArray(images) ? images : []) {
    const raw = String(i?.alt || '').replace(/\s+/g, ' ').trim();
    if (!raw || GENERIC_ALT_WORD_RE.test(raw)) continue;
    const t = raw.replace(/\s*(?:사진|이미지|배너|썸네일|image|banner|photo)\s*$/i, '').trim();
    if (t.length >= 2 && !siteLike(t) && !/^\d+$/.test(t)) return t.slice(0, 80);
  }
  let seg = '';
  try { seg = decodeURIComponent(new URL(pageUrl).pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]{2,5}$/i, '').trim(); } catch { seg = ''; }
  if (seg.length >= 2 && !/^\d+$/.test(seg) && !siteLike(seg)) return seg.slice(0, 80);
  const title = String(pageTitle || '').replace(/\s+/g, ' ').replace(/\s*[|\-–:]\s*[^|\-–:]{1,30}$/, '').trim();
  if (title.length >= 2 && !siteLike(title)) return title.slice(0, 80);
  return '기획 페이지';
}

/** ★ v4-2 슬라이스 모드 버튼 문구 — 제목이 사이트명·공식몰 류면 "상품 자세히 보기", 아니면 호출부가 만든 제목형 라벨 */
export function sliceCtaLabel(title: string | null | undefined, companyName: string, fallbackLabel: string): string {
  const t = String(title || '').trim();
  const comp = squashText(companyName);
  if (!t || SITE_LIKE_TITLE_RE.test(t) || (!!comp && squashText(t) === comp) || t === '기획 페이지') return '상품 자세히 보기';
  // 제목형 라벨이 낱말 경계 절단으로 제목의 60% 미만만 남았으면("Farm to Product" → "Farm to 보기" = 47%) 상품형으로 · "추석선물세트 특별 기획전" → "추석선물세트 특별 보기"(69%)는 그대로
  const kept = String(fallbackLabel || '').replace(/\s*보기$/, '').trim();
  if (kept.length < t.length * 0.6) return '상품 자세히 보기';
  return fallbackLabel;
}

// ===== ★ v4-3 이미지 판정 선별(모델은 분류만 · 고르기는 코드) =====

/** 이미지 종류 — 광고 배너(디자인·글자) / 상품 사진 / 문서(인증서·표·글 캡처) / 풍경·인물 분위기 사진 / 그 외 */
export type OutreachImageKind = 'banner' | 'product' | 'document' | 'photo' | 'other';
export interface ImageKindJudge { kind: OutreachImageKind; text: boolean }
const IMAGE_KINDS: readonly OutreachImageKind[] = ['banner', 'product', 'document', 'photo', 'other'];

/** 모델 응답(JSON) → n장 판정 배열(순수). 형식이 아니면 null · 빠진 칸은 other/false. */
export function parseImageKinds(raw: string, n: number): ImageKindJudge[] | null {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const items = Array.isArray(j?.items) ? j.items : null;
  if (!items) return null;
  const out: ImageKindJudge[] = Array.from({ length: Math.max(0, n) }, () => ({ kind: 'other', text: false }));
  for (const it of items) {
    const i = Number(it?.i);
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    const kind = String(it?.kind || '').toLowerCase() as OutreachImageKind;
    out[i] = { kind: IMAGE_KINDS.includes(kind) ? kind : 'other', text: it?.text === true || String(it?.text).toLowerCase() === 'true' };
  }
  return out;
}

/** ★ v4-3 슬라이스 선별 상한 — 홈 배너 앞자리 2 · 분위기 사진 1 */
export const OUTREACH_SLICE_LEAD_BANNERS = 2;
export const OUTREACH_SLICE_PHOTO_MAX = 1;

/**
 * ★ v4-3 슬라이스 선별(순수) — 판정(kinds · 사본 URL 키)이 있으면 문서를 빼고, 프로모션·스토리 페이지면 홈 상단 배너(글자 있는 것 우선 · ≤2)를 앞에 두고
 * 배너·상품 → 분위기 사진(≤1) 순으로 고른다(같은 종류 안에서는 문서 순서). 판정이 없으면(모델 부재) 프로모션 = 홈 배너 2 + 슬라이스 2, 기획전 = 그대로.
 * 결과가 2장 미만이면 선별 전 슬라이스로 되돌린다(선별이 산출물을 비우지 않게). 상한 maxSlices · 같은 주소 1번.
 */
export function selectSliceImages(
  slices: readonly StoredImage[],
  kinds: Readonly<Record<string, ImageKindJudge>> | null | undefined,
  opts: { source: 'event_card' | 'promo_page' | undefined; heroBanners: readonly StoredImage[]; maxSlices: number },
): StoredImage[] {
  const max = Math.max(1, opts.maxSlices);
  const kindOf = (s: StoredImage): ImageKindJudge | null => (kinds && s && kinds[s.url]) ? kinds[s.url] : null;
  const dedupe = (list: StoredImage[]) => { const seen = new Set<string>(); return list.filter((s) => s && s.url && !seen.has(s.url) && (seen.add(s.url), true)); };
  const fallback = () => dedupe([...slices]).slice(0, max);
  if (opts.source !== 'promo_page') {
    if (!kinds) return fallback();
    const kept = slices.filter((s) => kindOf(s)?.kind !== 'document');
    return dedupe(kept.length >= OUTREACH_SLICE_MIN ? kept : [...slices]).slice(0, max);
  }
  const heroes = (opts.heroBanners || []).filter((h) => h && h.url);
  // 판정 없음 = 홈 배너 앞자리(≤2) 뒤에 슬라이스를 순서대로(상한까지) — 홈 배너가 없으면 슬라이스만 상한까지
  if (!kinds) return dedupe([...heroes.slice(0, OUTREACH_SLICE_LEAD_BANNERS), ...slices]).slice(0, max);
  const heroLead = heroes
    .filter((h) => { const k = kindOf(h); return !k || k.kind === 'banner' || k.kind === 'product'; })
    .sort((a, b) => Number(kindOf(b)?.text === true) - Number(kindOf(a)?.text === true))
    .slice(0, OUTREACH_SLICE_LEAD_BANNERS);
  const body = slices.filter((s) => kindOf(s)?.kind !== 'document');
  const strong = body.filter((s) => { const k = kindOf(s)?.kind; return k === 'banner' || k === 'product'; });
  const photos = body.filter((s) => kindOf(s)?.kind === 'photo').slice(0, OUTREACH_SLICE_PHOTO_MAX);
  const picked = dedupe([...heroLead, ...strong, ...photos]).slice(0, max);
  return picked.length >= 2 ? picked : fallback();
}

/** ★ v5 행사 블록 안 슬라이스 선별 상한 — 분위기 사진 2 */
export const OUTREACH_EVENT_PHOTO_MAX = 2;

/**
 * ★ v5 행사 블록 안 슬라이스 선별(순수) — 홈 배너는 히어로 자리라 여기 안 들어온다. 판정이 있으면 문서 제외 · 배너·상품 → 분위기 사진(≤2) 순 · 상한 max.
 * 판정이 없으면 순서대로 max. 문서만 남아 0장이면 0장(문서를 되살리지 않는다 · 톤28 인증서 실측).
 */
export function selectEventSlices(slices: readonly StoredImage[], kinds: Readonly<Record<string, ImageKindJudge>> | null | undefined, max: number): StoredImage[] {
  const cap = Math.max(0, max);
  const list = (Array.isArray(slices) ? slices : []).filter((s) => s && s.url);
  const seen = new Set<string>();
  const dedupe = (l: StoredImage[]) => l.filter((s) => !seen.has(s.url) && (seen.add(s.url), true));
  if (!kinds) return dedupe([...list]).slice(0, cap);
  const kindOf = (s: StoredImage) => kinds[s.url] || null;
  const body = list.filter((s) => kindOf(s)?.kind !== 'document');
  const strong = body.filter((s) => { const k = kindOf(s)?.kind; return k === 'banner' || k === 'product'; });
  const photos = body.filter((s) => { const k = kindOf(s)?.kind; return k === 'photo' || k === 'other' || !k; }).slice(0, OUTREACH_EVENT_PHOTO_MAX);
  return dedupe([...strong, ...photos]).slice(0, cap);
}

// ===== ★ v5 표준 조립(직원 DM 공식 · Harold 0909) — 스튜디오 히어로 → 상품 큐레이션 → 행사 나열 → 버튼 · AI 0 =====

/** 히어로 1장 — 스튜디오 포스터(행사 문구를 얹어 생성) 우선 · 없으면 홈 캠페인 배너 사본 · 없으면 카드 배너 */
export interface StandardHero { url: string; kind: 'poster' | 'banner' | 'card'; linkUrl: string }
/** 행사 1건 — 제목·기간 줄(호출부가 만든다 · 수치 검증은 호출부) · 배너 사본 · 링크 · 그 행사의 슬라이스(선별 뒤 · ≤3) */
export interface StandardEvent { title: string; periodLine: string; imageUrl: string | null; linkUrl: string; ctaLabel: string; slices?: readonly StoredImage[] }
export interface ComposeStandardInput {
  companyName: string;
  logoUrl: string | null;
  channel: 'DM' | 'EMAIL';
  hero: StandardHero | null;
  products: readonly SliceProduct[];
  events: readonly StandardEvent[];
  /** 마지막 버튼(대표 목적지) */
  ctaLabel: string;
  ctaUrl: string;
  legal: { legal: string | null; csPhone: string | null } | null;
}
export const OUTREACH_STD_PRODUCTS_MAX = 6;
export const OUTREACH_STD_EVENTS_MAX = 3;
export const OUTREACH_STD_EVENT_SLICES_MAX = 3;

/**
 * 표준 순서(고정 · AI 0): header · hero(gallery 1장 풀폭 · 포스터/배너 원본 비율) · product_carousel(≤6) · [행사 N: text_card(배너·제목·기간) + gallery(슬라이스 ≤3) + cta] · cta · footer.
 * id 접두 `so-std-` = 레시피 provenance. 상품·행사가 둘 다 없으면 호출부가 이 조립을 쓰지 않는다(옛 AI 골격).
 */
export function composeOutreachStandard(input: ComposeStandardInput): Section[] {
  const out: Section[] = [];
  let order = 0;
  out.push(mk('header', 'so-std-header', order++, {
    variant: 'logo', align: input.channel === 'EMAIL' ? 'left' : 'center', brand_name: input.companyName,
    ...(input.logoUrl ? { logo_url: input.logoUrl } : {}), ...(input.channel === 'DM' ? { brand_size: 'lg' } : {}),
  }));
  if (input.hero && input.hero.url) {
    // id 에 히어로 종류를 싣는다(코덱스 자문 Q3 수용 · 레시피가 poster/banner/card 를 정확히 기록해야 학습 라벨이 맞다)
    out.push(mk('gallery', `so-std-hero-${input.hero.kind}`, order++, {
      title: '', images: [{ url: input.hero.url, link_url: input.hero.linkUrl, caption: '' }], layout: 'list_1xN', full_bleed: true, enable_zoom: false, enable_fullscreen: false,
    }));
  }
  const products = (input.products || []).filter((p) => p && p.image_url && p.link_url && String(p.name || '').trim()).slice(0, OUTREACH_STD_PRODUCTS_MAX);
  if (products.length) {
    out.push(mk('product_carousel', 'so-std-products', order++, {
      title: '',
      products: products.map((p) => ({
        name: String(p.name).trim().slice(0, 60), image_url: p.image_url, link_url: p.link_url,
        price: p.price !== null && p.price > 0 ? p.price : 0,
        ...(p.discount_price !== null && p.discount_price > 0 ? { discount_price: p.discount_price } : {}),
      })),
      layout: 'grid', show_indicator: true, auto_slide: false,
    }));
  }
  const events = (input.events || []).filter((e) => e && String(e.title || '').trim() && e.linkUrl).slice(0, OUTREACH_STD_EVENTS_MAX);
  events.forEach((e, i) => {
    const n = i + 1;
    out.push(mk('text_card', `so-std-event${n}`, order++, {
      tag: '이벤트', headline: String(e.title).trim().slice(0, 40), body: e.periodLine || '', align: 'left',
      ...(e.imageUrl ? { image_url: e.imageUrl, image_position: 'top' } : {}),
    }));
    const slices = (e.slices || []).filter((s) => s && s.url && s.url !== e.imageUrl).slice(0, OUTREACH_STD_EVENT_SLICES_MAX);
    if (slices.length) {
      out.push(mk('gallery', `so-std-slices${n}`, order++, {
        title: '', images: slices.map((s) => ({ url: s.url, link_url: e.linkUrl, caption: '' })), layout: 'list_1xN', full_bleed: true, enable_zoom: false, enable_fullscreen: false,
      }));
    }
    out.push(mk('cta', `so-std-cta-event${n}`, order++, { buttons: [{ label: e.ctaLabel, url: e.linkUrl, style: 'primary' }], layout: 'stack' }));
  });
  // 대표 버튼 — 마지막 행사 버튼과 목적지가 같으면 겹치지 않게 생략
  const lastEvent = events[events.length - 1];
  if (!lastEvent || lastEvent.linkUrl !== input.ctaUrl) {
    out.push(mk('cta', 'so-std-cta', order++, { buttons: [{ label: input.ctaLabel, url: input.ctaUrl, style: 'primary' }], layout: 'stack' }));
  }
  out.push(mk('footer', 'so-std-footer', order++, {
    ...(input.legal?.legal ? { legal_text: input.legal.legal } : {}), ...(input.legal?.csPhone ? { cs_phone: input.legal.csPhone } : {}), show_unsubscribe_link: true,
  }));
  return out;
}

/** 상세 주소 대조 키 — 해시·끝 슬래시·대소문자 차이를 무시한다 */
export function normalizeUrlKey(u: string | null | undefined): string {
  return String(u || '').trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * 슬라이스 모드 자격 — 사람이 고른 카드(순서 유지) 중 면허 있고 재료의 상세 주소와 같은 카드 + 그 슬라이스 사본(재료 순서) ≥ 3.
 * 사본은 media.slices 에서 srcUrl 로 되찾는다(collectOutreachMedia 가 재료 순서대로 저장한다).
 */
export function sliceModeCard(
  cards: readonly EngineEventCard[] | null | undefined,
  material: EventSliceMaterial | null | undefined,
  mediaSlices: readonly StoredImage[] | null | undefined,
): { card: EngineEventCard; slices: StoredImage[] } | null {
  if (!material || !Array.isArray(material.images) || material.images.length < OUTREACH_SLICE_MIN) return null;
  const key = normalizeUrlKey(material.detailUrl);
  if (!key) return null;
  const card = (Array.isArray(cards) ? cards : []).find((c) => c && c.licensed && c.detailUrl && normalizeUrlKey(c.detailUrl) === key);
  if (!card) return null;
  const bySrc = new Map((Array.isArray(mediaSlices) ? mediaSlices : []).filter((s) => s && s.srcUrl).map((s) => [s.srcUrl, s] as const));
  const slices = material.images.map((i) => bySrc.get(i.url)).filter((s): s is StoredImage => !!s);
  if (slices.length < OUTREACH_SLICE_MIN) return null;
  return { card, slices };
}

export interface ComposeSliceInput {
  companyName: string;
  logoUrl: string | null;
  /** 사본(재료 순서) */
  slices: readonly StoredImage[];
  detailUrl: string;
  /** 호출부가 eventCtaLabel(card) 로 만든 라벨(수치 0 · 카드 제목형) */
  ctaLabel: string;
  legal: { legal: string | null; csPhone: string | null } | null;
  channel: 'DM' | 'EMAIL';
  /** 600폭 환산 누적 높이 예산 · 기본 OUTREACH_SLICE_HEIGHT_BUDGET_600 · 최소 3장은 예산과 무관하게 싣는다 */
  heightBudget600?: number;
  /** ★ v4-2 슬라이스 장수 상한(프로모션·스토리 페이지 = OUTREACH_SLICE_PROMO_MAX) · 없으면 OUTREACH_SLICE_MAX */
  maxSlices?: number;
  /** ★ v4-2 상품 카드(사본 URL · 링크 · 가격은 있을 때만) — 1개 이상이면 슬라이스 뒤에 product_carousel 로 싣는다(최대 4) */
  products?: readonly SliceProduct[];
}

/** ★ v4-2 슬라이스 모드 상품 카드 재료(media.products 의 사본 URL) */
export interface SliceProduct { name: string; image_url: string; link_url: string; price: number | null; discount_price: number | null }

function mk(type: SectionType, id: string, order: number, props: Record<string, unknown>): Section {
  return {
    id, type, order, visible: true,
    props: { ...((getDefaultProps(type) as unknown as Record<string, unknown>) || {}), ...props },
  } as unknown as Section;
}

/**
 * 4블록 구성(순서 고정) — header · gallery(list_1xN · full_bleed · 슬라이스마다 상세 링크 · 캡션 0) · cta · footer.
 * DM 과 EMAIL 은 헤더 정렬만 다르다(fillOutreachDmMediaV3 의 헤더 규칙과 같다). id 접두 `so-slice-` = 레시피 provenance(src 'slice').
 */
export function composeSliceSections(input: ComposeSliceInput): Section[] {
  const budget = typeof input.heightBudget600 === 'number' && input.heightBudget600 > 0 ? input.heightBudget600 : OUTREACH_SLICE_HEIGHT_BUDGET_600;
  const maxSlices = Math.max(OUTREACH_SLICE_MIN, Math.min(OUTREACH_SLICE_MAX, typeof input.maxSlices === 'number' && input.maxSlices > 0 ? input.maxSlices : OUTREACH_SLICE_MAX));
  const kept: StoredImage[] = [];
  let total = 0;
  for (const s of input.slices) {
    if (!s || !s.url) continue;
    const h = sliceHeightAt600(s);
    if (kept.length >= OUTREACH_SLICE_MIN && total + h > budget) break;
    kept.push(s);
    total += h;
    if (kept.length >= maxSlices) break;
  }
  // ★ v4-2 상품 카드(있을 때만 · 최대 4 · 사본 URL·링크 있는 것만 · 가격 없으면 0 = 렌더러가 가격 줄을 비운다)
  const products = (input.products || []).filter((p) => p && p.image_url && p.link_url && String(p.name || '').trim()).slice(0, OUTREACH_SLICE_PRODUCTS_MAX);
  const header = mk('header', 'so-slice-header', 0, {
    variant: 'logo',
    align: input.channel === 'EMAIL' ? 'left' : 'center',
    brand_name: input.companyName,
    ...(input.logoUrl ? { logo_url: input.logoUrl } : {}),
    ...(input.channel === 'DM' ? { brand_size: 'lg' } : {}),
  });
  const gallery = mk('gallery', 'so-slice-gallery', 1, {
    title: '',
    images: kept.map((s) => ({ url: s.url, link_url: input.detailUrl, caption: '' })),
    layout: 'list_1xN',
    full_bleed: true,
    enable_zoom: false,
    enable_fullscreen: false,
  });
  const productSection = products.length
    ? mk('product_carousel', 'so-slice-products', 2, {
      title: '',
      products: products.map((p) => ({
        name: String(p.name).trim().slice(0, 60), image_url: p.image_url, link_url: p.link_url,
        price: p.price !== null && p.price > 0 ? p.price : 0,
        ...(p.discount_price !== null && p.discount_price > 0 ? { discount_price: p.discount_price } : {}),
      })),
      layout: 'grid',
      show_indicator: true,
      auto_slide: false,
    })
    : null;
  const cta = mk('cta', 'so-slice-cta', productSection ? 3 : 2, {
    buttons: [{ label: input.ctaLabel, url: input.detailUrl, style: 'primary' }],
    layout: 'stack',
  });
  const footer = mk('footer', 'so-slice-footer', productSection ? 4 : 3, {
    ...(input.legal?.legal ? { legal_text: input.legal.legal } : {}),
    ...(input.legal?.csPhone ? { cs_phone: input.legal.csPhone } : {}),
    show_unsubscribe_link: true,
  });
  return productSection ? [header, gallery, productSection, cta, footer] : [header, gallery, cta, footer];
}
