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
export interface RenderImage { src: string; w: number; h: number; rw: number; rh: number; top: number; href?: string | null }
/** 재료(brand_profile.eventSlices.images) — 원 URL · 원본 크기 · 문서 순서 */
export interface EventSliceImage { url: string; width: number; height: number; order: number }
/** brand_profile.eventSlices — 슬라이스 묶음(원 URL · 사본은 media.slices). ★ v4 source = 어느 입구에서 찾았나(면허 카드 상세 · 홈에 걸린 프로모션 페이지) */
export interface EventSliceMaterial { detailUrl: string; finalUrl: string; images: EventSliceImage[]; candidates: number; at: string; source?: 'event_card' | 'promo_page' }
/** ★ v4 홈 상단 배너(렌더 기하 · 원 URL · 감싸는 앵커 href) — 갤러리 후보의 맨 앞(히어로 = 홈 첫 배너 · 불변 26) */
export interface HeroBanner { url: string; width: number; height: number; href: string | null; order: number }

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
    out.push({ url: i.src, width: w, height: h, href: i.href && /^https?:\/\//i.test(String(i.href)) ? String(i.href) : null, order: out.length });
    if (out.length >= OUTREACH_HERO_MAX) break;
  }
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
}

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
  const kept: StoredImage[] = [];
  let total = 0;
  for (const s of input.slices) {
    if (!s || !s.url) continue;
    const h = sliceHeightAt600(s);
    if (kept.length >= OUTREACH_SLICE_MIN && total + h > budget) break;
    kept.push(s);
    total += h;
    if (kept.length >= OUTREACH_SLICE_MAX) break;
  }
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
  const cta = mk('cta', 'so-slice-cta', 2, {
    buttons: [{ label: input.ctaLabel, url: input.detailUrl, style: 'primary' }],
    layout: 'stack',
  });
  const footer = mk('footer', 'so-slice-footer', 3, {
    ...(input.legal?.legal ? { legal_text: input.legal.legal } : {}),
    ...(input.legal?.csPhone ? { cs_phone: input.legal.csPhone } : {}),
    show_unsubscribe_link: true,
  });
  return [header, gallery, cta, footer];
}
