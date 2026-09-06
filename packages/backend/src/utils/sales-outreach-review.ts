/**
 * ★ 2026-09-05(3) AI 영업 아웃리치 — 검수 축 순수 CT (재료 재선택 · 섹션 숨김 override · 품질 경고) · DB 0 · AI 0
 * 설계 = docs/2026-09-05-ai-sales-outreach-refinement-design.md §22 C4 (브레인스토밍 5역할 수렴안)
 *
 * 세 가지 전부 "사람이 되돌리는 길"이고 잠금은 하나도 늘리지 않는다(불변 3 · 잠금 5종은 computeSendLock 하나).
 * - 재료 재선택: 검토 화면에서 상품·갤러리를 빼거나 순서를 바꾼다. 저장 형태 = `brand_profile.mediaSelection`(우리 사본 URL 화이트리스트).
 *   사람이 고른 것도 서버 게이트(폭 실측·인물 판정)를 이미 지난 사본뿐이다(후보 URL이 아니라 통과분 URL만 받는다).
 * - 섹션 숨김: `stage_results.section_overrides[kind].hidden = ['gallery#2', ...]` **override 데이터**로 저장하고,
 *   재생성 뒤 같은 조립 함수가 재적용한다(불변 16 = 같은 조립 함수 · 사람 편집이 조용히 사라지지 않게). 줄이는 방향(숨기기)만 —
 *   새 문장 작성은 기존 /copy에 한정(불변 12). 키 = `type#n`(같은 type 안 1-based 순번) — 재생성으로 순번이 바뀌면 그 순번에 다시 적용된다(문서 §22).
 * - 품질 경고: 세면 보이는 결함(상품 0 · 갤러리 부족 · CTA 전부 홈 · 법정 표기 없음 · 섹션 부족)을 코드가 센다. 발송을 막지 않는다 —
 *   화면이 잠금 사유 목록 옆에 색만 달리해 보여주고 바로가기를 단다. 임계값은 미검증(첫 10건 뒤 재조정)이라 계약 테스트로 굳히지 않는다.
 */
import type { Section } from './dm/dm-section-registry';
import type { OutreachProduct, ProofSignals } from './sales-outreach-media';

// ===== 재료 게이트(★ 2026-09-06 S2 · 회의 수렴안 D3) =====

/** 임계 — 상품 4 · 배너 2 · 행사 1 중 **둘 이상** 충족 = enough. ⚠ 미검증(회의 합의 초안) · 첫 운영 10건 뒤 재조정. 상수는 OUTREACH_QUALITY_THRESHOLDS 이웃에 둔다. */
export const OUTREACH_MATERIAL_GATE = { products: 4, banners: 2, events: 1, minAxes: 2 } as const;

export type MaterialAxis = 'products' | 'banners' | 'events';
export interface MaterialGateCounts { products: number; banners: number; events: number }
export interface MaterialGate {
  verdict: 'enough' | 'thin';
  counts: MaterialGateCounts;
  passed: MaterialAxis[];
  missing: MaterialAxis[];
  at: string;
}

/**
 * 재료 충족 판정(순수). StageOutcome 3값을 건드리지 않는다(별 키 `stage_results.material`). 제작은 계속하고 발송만 잠근다(MATERIAL_THIN · computeSendLock 3번째 인자).
 * 사람이 화면에서 재료 수를 보고 해제(`stage_results.material_override`)할 수 있다 — fail-closed 와 1클릭 규약이 함께 성립하는 형태.
 */
export function assessMaterialSufficiency(counts: MaterialGateCounts, now: Date = new Date()): MaterialGate {
  const c: MaterialGateCounts = {
    products: Math.max(0, Number(counts?.products) || 0),
    banners: Math.max(0, Number(counts?.banners) || 0),
    events: Math.max(0, Number(counts?.events) || 0),
  };
  const passed: MaterialAxis[] = [];
  const missing: MaterialAxis[] = [];
  (c.products >= OUTREACH_MATERIAL_GATE.products ? passed : missing).push('products');
  (c.banners >= OUTREACH_MATERIAL_GATE.banners ? passed : missing).push('banners');
  (c.events >= OUTREACH_MATERIAL_GATE.events ? passed : missing).push('events');
  return { verdict: passed.length >= OUTREACH_MATERIAL_GATE.minAxes ? 'enough' : 'thin', counts: c, passed, missing, at: now.toISOString() };
}

// ===== 사실 수치 근거(★ 2026-09-06 S2 · 회의 수렴안 D3) =====

/** 혜택어가 섞인 문자열은 근거로 넣지 않는다(면허 축은 그대로 · 사실 수치만 통과) */
const BENEFIT_WORD_RE = /%|할인|쿠폰|증정|무료|사은품|적립|세일|특가|이벤트/;

/**
 * 재료에서 그대로 뽑은 사실 수치 문자열(가격) — `stripUnauthorizedBenefits`의 originalBody 에 면허 인용문 뒤에 이어 붙이는 근거.
 * 공용 CT 시그니처는 바꾸지 않는다(불변 20 · 호출부가 근거 원문을 넓힌다). 코드가 만든 문장·할인율·혜택어는 넣지 않는다.
 */
export function factQuoteOf(materials: { products?: readonly OutreachProduct[] | null; proof?: ProofSignals | null } | null | undefined): string {
  if (!materials) return '';
  const out: string[] = [];
  for (const p of materials.products || []) {
    for (const v of [p.price, p.discount_price]) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        const s = `${Math.round(v).toLocaleString('ko-KR')}원`;
        if (!BENEFIT_WORD_RE.test(s) && !out.includes(s)) out.push(s);
      }
    }
  }
  // 구분자 ' · ' — 차단기는 공백만 있는 2자 이하 간격의 자리를 한 덩어리로 합치므로(원본 '10% 할인' 보호 규칙) 줄바꿈으로 이으면 가격 둘이 한 자리가 되어 대조에 실패한다
  return out.slice(0, 40).join(' · ');
}

// ===== 재료 재선택 =====

export interface OutreachMediaSelection {
  /** 남길 상품 = 우리 사본 image_url(고유) · 순서 = 배열 순서 */
  products: string[];
  /** 남길 갤러리 = 우리 사본 url · 순서 = 배열 순서 */
  gallery: string[];
  selectedAt?: string;
  selectedBy?: string | null;
}

export const MEDIA_SELECTION_MAX = 40;

type MediaLike = { gallery: Array<{ url: string }>; products: Array<{ image_url: string }> };

/** 요청 본문 → 선택(화이트리스트 검증). 통과분 URL이 아닌 값·중복·상한 초과 = 거절. 둘 다 비면 EMPTY(빈 재료로 다시 만들 이유가 없다). */
export function validateOutreachMediaSelection(media: MediaLike | null | undefined, raw: unknown):
  { ok: true; selection: OutreachMediaSelection } | { ok: false; reason: 'INVALID' | 'UNKNOWN_ITEM' | 'EMPTY' | 'NO_MEDIA' } {
  if (!media) return { ok: false, reason: 'NO_MEDIA' };
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'INVALID' };
  const r = raw as { products?: unknown; gallery?: unknown };
  const toList = (v: unknown): string[] | null => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > MEDIA_SELECTION_MAX) return null;
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== 'string' || !x.trim()) return null;
      if (!out.includes(x)) out.push(x);
    }
    return out;
  };
  const products = toList(r.products);
  const gallery = toList(r.gallery);
  if (!products || !gallery) return { ok: false, reason: 'INVALID' };
  const knownP = new Set((media.products || []).map((p) => p.image_url));
  const knownG = new Set((media.gallery || []).map((g) => g.url));
  if (products.some((u) => !knownP.has(u)) || gallery.some((u) => !knownG.has(u))) return { ok: false, reason: 'UNKNOWN_ITEM' };
  if (products.length === 0 && gallery.length === 0) return { ok: false, reason: 'EMPTY' };
  return { ok: true, selection: { products, gallery } };
}

/** 선택을 재료에 적용(순수). 선택이 없으면 그대로. 선택에 있는데 재료에 없는 URL(재수집 뒤)은 조용히 건너뛴다 = 재수집이 선택을 무효화한다. */
export function applyOutreachMediaSelection<M extends MediaLike>(media: M | null, sel: OutreachMediaSelection | null | undefined): M | null {
  if (!media || !sel) return media;
  const byP = new Map((media.products || []).map((p) => [p.image_url, p] as const));
  const byG = new Map((media.gallery || []).map((g) => [g.url, g] as const));
  const products = (sel.products || []).map((u) => byP.get(u)).filter((x): x is M['products'][number] => !!x);
  const gallery = (sel.gallery || []).map((u) => byG.get(u)).filter((x): x is M['gallery'][number] => !!x);
  return { ...media, products, gallery };
}

// ===== 섹션 숨김 override =====

export interface SectionOverride {
  hidden: string[];
  updatedAt?: string;
  updatedBy?: string | null;
}

export const SECTION_OVERRIDE_MAX = 30;
/** 숨길 수 없는 골격(header·footer). hero·text_card·cta는 숨길 수 있다(줄이는 방향). */
export const SECTION_OVERRIDE_PROTECTED: readonly string[] = ['header', 'footer'];
/** 숨긴 뒤 남아야 하는 최소 섹션 수 */
export const SECTION_OVERRIDE_MIN_REMAIN = 3;

/** 섹션 배열의 안정 키 `type#n`(같은 type 안 1-based 순번). 재생성으로 배열이 바뀌면 같은 순번에 재적용된다. */
export function sectionKeysOf(sections: readonly Section[]): string[] {
  const ordinal: Record<string, number> = {};
  return (Array.isArray(sections) ? sections : []).filter((s) => s && typeof s === 'object').map((s) => {
    const t = String(s.type);
    ordinal[t] = (ordinal[t] || 0) + 1;
    return `${t}#${ordinal[t]}`;
  });
}

export function validateSectionOverride(raw: unknown, current: readonly Section[]):
  { ok: true; override: SectionOverride } | { ok: false; reason: 'INVALID' | 'UNKNOWN_KEY' | 'PROTECTED' | 'TOO_FEW_REMAIN' } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'INVALID' };
  const hiddenRaw = (raw as { hidden?: unknown }).hidden;
  if (hiddenRaw !== undefined && !Array.isArray(hiddenRaw)) return { ok: false, reason: 'INVALID' };
  // 상한은 루프 전에(거대 배열이 이벤트 루프를 잡지 않게) · 중복 제거는 Set
  if (Array.isArray(hiddenRaw) && hiddenRaw.length > SECTION_OVERRIDE_MAX) return { ok: false, reason: 'INVALID' };
  const seen = new Set<string>();
  for (const k of (hiddenRaw as unknown[]) || []) {
    if (typeof k !== 'string' || !/^[a-z_]+#\d{1,3}$/.test(k)) return { ok: false, reason: 'INVALID' };
    seen.add(k);
  }
  const hidden = Array.from(seen);
  const keys = sectionKeysOf(current);
  if (hidden.some((k) => !keys.includes(k))) return { ok: false, reason: 'UNKNOWN_KEY' };
  if (hidden.some((k) => SECTION_OVERRIDE_PROTECTED.includes(k.split('#')[0]))) return { ok: false, reason: 'PROTECTED' };
  if (keys.length - hidden.length < SECTION_OVERRIDE_MIN_REMAIN) return { ok: false, reason: 'TOO_FEW_REMAIN' };
  return { ok: true, override: { hidden } };
}

/**
 * override 적용(순수). 반환은 입력의 부분집합(더하기 0). missed = 현재 배열에 그 순번이 없어 적용하지 못한 키.
 * 재생성 뒤 재적용에서 배열이 줄어 있으면 검증 때의 바닥(최소 잔존 · cta 보존)이 깨질 수 있다 → 그때는 **전부 건너뛴다**(skipped=true · 원본 그대로).
 */
export function applySectionOverrides(sections: readonly Section[], override: SectionOverride | null | undefined): { sections: Section[]; applied: number; missed: string[]; skipped?: boolean } {
  const list = (Array.isArray(sections) ? sections : []).filter((s) => s && typeof s === 'object');
  const hidden = new Set((override?.hidden || []).filter((k) => typeof k === 'string'));
  if (hidden.size === 0) return { sections: list.slice(), applied: 0, missed: [] };
  const keys = sectionKeysOf(list);
  const out: Section[] = [];
  let applied = 0;
  list.forEach((s, i) => {
    if (hidden.has(keys[i]) && !SECTION_OVERRIDE_PROTECTED.includes(String(s.type))) { applied++; return; }
    out.push(s);
  });
  const missed = Array.from(hidden).filter((k) => !keys.includes(k));
  const hadCta = list.some((s) => s.type === 'cta');
  if (applied > 0 && (out.length < SECTION_OVERRIDE_MIN_REMAIN || (hadCta && !out.some((s) => s.type === 'cta')))) {
    return { sections: list.slice(), applied: 0, missed: Array.from(hidden), skipped: true };
  }
  return { sections: out, applied, missed };
}

// ===== 품질 경고(세면 보이는 것 · 잠금 아님) =====

export type OutreachQualityCode =
  | 'NO_PRODUCTS' | 'FEW_PRODUCTS' | 'FEW_GALLERY' | 'CTA_ALL_HOME' | 'NO_LEGAL' | 'FEW_SECTIONS' | 'NO_BRAND_EMAIL' | 'NO_LOOK'
  /** ★ 2026-09-06 S2 — 헤드라인이 비어 업체명으로 대체됐다(실물 표본 0건 형태 · 경고 · 잠금 아님) */
  | 'HERO_FALLBACK'
  /** ★ 2026-09-06 S3 — 발행 DM 375폭 캡처 vision 채점(디자이너 8항목) 미달(경고 · 잠금 아님 · 워커·모델 부재면 없음) */
  | 'VISION_NO_HERO_IMAGE' | 'VISION_NO_PRICE_PAIR' | 'VISION_NO_CTA_BAR' | 'VISION_DUP_IMAGE' | 'VISION_TEXT_UNREADABLE' | 'VISION_GRAY_BOX' | 'VISION_NUMBER_LEAK' | 'VISION_FEW_SECTIONS';

export interface OutreachQualityWarning { code: OutreachQualityCode; value?: number }

/** 임계값 — ⚠ 미검증(회의 합의 초안). 첫 운영 10건 뒤 재조정 · 계약 테스트로 굳히지 않는다. */
export const OUTREACH_QUALITY_THRESHOLDS = {
  /** 상품 이 수 미만 = FEW_PRODUCTS(캐러셀 2묶음이 안 찬다) */
  products: 4,
  /** 갤러리 이 수 미만 = FEW_GALLERY(갤러리 1묶음도 안 찬다) */
  gallery: 2,
  /** DM 섹션 이 수 미만 = FEW_SECTIONS */
  sections: 6,
} as const;

export interface QualityInput {
  dmSections: readonly Section[] | null | undefined;
  brandSections: readonly Section[] | null | undefined;
  media: { gallery: Array<{ url: string }>; products: Array<{ image_url: string }> } | null | undefined;
  legal: { legal: string | null; csPhone: string | null } | null | undefined;
  homepageUrl: string;
  /** 룩 배정 수(dm asset look.treatments + backgrounds) · undefined = 옛 asset(경고 안 냄) */
  lookAssigned?: number;
  /** ★ 2026-09-06 S2 dm asset heroFallback(sanitize 후처리가 헤드라인을 업체명으로 채웠는가) · undefined = 옛 asset */
  heroFallback?: boolean;
  /** ★ 2026-09-06 S3 dm asset visionScore.items(캡처 채점 2값) · null/undefined = 채점 없음 */
  dmVision?: { items?: Partial<Record<string, boolean>> | null } | null;
}

/** vision 항목 → 경고 코드(false 일 때만) */
export const VISION_WARNING_OF: Readonly<Record<string, OutreachQualityCode>> = {
  hero_image_full: 'VISION_NO_HERO_IMAGE',
  price_pair_visible: 'VISION_NO_PRICE_PAIR',
  cta_bar_visible: 'VISION_NO_CTA_BAR',
  no_duplicate_image: 'VISION_DUP_IMAGE',
  text_readable: 'VISION_TEXT_UNREADABLE',
  gray_box_zero: 'VISION_GRAY_BOX',
  number_leak_zero: 'VISION_NUMBER_LEAK',
  sections_enough: 'VISION_FEW_SECTIONS',
};

function normUrl(u: string): string {
  return String(u || '').trim().replace(/\/+$/, '').toLowerCase();
}

export function assessOutreachQuality(input: QualityInput): { warnings: OutreachQualityWarning[] } {
  const w: OutreachQualityWarning[] = [];
  const products = input.media?.products?.length || 0;
  const gallery = input.media?.gallery?.length || 0;
  if (products === 0) w.push({ code: 'NO_PRODUCTS', value: 0 });
  else if (products < OUTREACH_QUALITY_THRESHOLDS.products) w.push({ code: 'FEW_PRODUCTS', value: products });
  if (gallery < OUTREACH_QUALITY_THRESHOLDS.gallery) w.push({ code: 'FEW_GALLERY', value: gallery });
  const dm = (input.dmSections || []).filter((s) => s && typeof s === 'object');
  if (dm.length > 0) {
    const ctaUrls = dm.filter((s) => s.type === 'cta').flatMap((s) => {
      const b: any[] = Array.isArray((s.props as any)?.buttons) ? (s.props as any).buttons : [];
      return b.map((x) => normUrl(String(x?.url || '')));
    }).filter(Boolean);
    const home = normUrl(input.homepageUrl);
    if (ctaUrls.length > 0 && ctaUrls.every((u) => u === home)) w.push({ code: 'CTA_ALL_HOME', value: ctaUrls.length });
    if (dm.length < OUTREACH_QUALITY_THRESHOLDS.sections) w.push({ code: 'FEW_SECTIONS', value: dm.length });
    if (typeof input.lookAssigned === 'number' && input.lookAssigned === 0) w.push({ code: 'NO_LOOK', value: 0 });
    if (input.heroFallback === true) w.push({ code: 'HERO_FALLBACK' });
    const items = input.dmVision?.items || null;
    if (items) for (const [k, v] of Object.entries(items)) if (v === false && VISION_WARNING_OF[k]) w.push({ code: VISION_WARNING_OF[k] });
  }
  if (!input.legal || (!input.legal.legal && !input.legal.csPhone)) w.push({ code: 'NO_LEGAL' });
  if (input.brandSections !== undefined && input.brandSections !== null && input.brandSections.length === 0) w.push({ code: 'NO_BRAND_EMAIL', value: 0 });
  return { warnings: w };
}

// ===== ★ 2026-09-06 S4 열람(순수 · 설계서 §6) — 새 테이블 0 · 식별자 0 · 문장은 서버가 완성한다 =====

export type ViewerUaClass = 'mobile' | 'desktop' | 'bot';
export const OUTREACH_PREVIEW_VIEWS_CAP = 50;
export const OUTREACH_PREVIEW_MERGE_MS = 60_000;
export const OUTREACH_UNREAD_DAYS = 3;

/** UA 3분류 — 자동 수집기(미리보기 봇·크롤러) · 모바일 · 데스크톱. UA 원문은 저장하지 않는다(식별자 0). */
export function classifyViewerUa(ua: string | null | undefined): ViewerUaClass {
  const s = String(ua || '');
  if (!s || /bot|crawl|spider|preview|fetch|slurp|facebookexternalhit|whatsapp|telegram|discord|twitter|linkedin|skype|curl|wget|python-requests|headless/i.test(s)) return 'bot';
  if (/Mobile|Android|iPhone|iPad|iPod/i.test(s)) return 'mobile';
  return 'desktop';
}

export interface PreviewViewEntry { at: string; ua: ViewerUaClass; n: number; last?: string }
export interface PreviewViews { total: number; human: number; bot: number; first_at: string | null; last_at: string | null; entries: PreviewViewEntry[] }

/**
 * 산출물 페이지 열람 1건 합산 — 같은 UA 분류가 60초 안에 다시 오면 마지막 항목의 n 만 올린다(새로고침 폭주 흡수) · 항목 상한 50(오래된 것부터 버림) · 총계는 항목과 별도로 항상 +1.
 */
export function mergePreviewView(prev: PreviewViews | null | undefined, hit: { at: string; ua: ViewerUaClass }): PreviewViews {
  const base: PreviewViews = prev && typeof prev === 'object'
    ? { total: Number(prev.total) || 0, human: Number(prev.human) || 0, bot: Number(prev.bot) || 0, first_at: prev.first_at || null, last_at: prev.last_at || null, entries: Array.isArray(prev.entries) ? prev.entries.slice() : [] }
    : { total: 0, human: 0, bot: 0, first_at: null, last_at: null, entries: [] };
  base.total += 1;
  if (hit.ua === 'bot') base.bot += 1; else base.human += 1;
  if (!base.first_at) base.first_at = hit.at;
  base.last_at = hit.at;
  const last = base.entries[base.entries.length - 1];
  const lastAt = last ? new Date(last.last || last.at).getTime() : NaN;
  const hitAt = new Date(hit.at).getTime();
  if (last && last.ua === hit.ua && Number.isFinite(lastAt) && Number.isFinite(hitAt) && hitAt - lastAt >= 0 && hitAt - lastAt <= OUTREACH_PREVIEW_MERGE_MS) {
    base.entries[base.entries.length - 1] = { ...last, n: (Number(last.n) || 1) + 1, last: hit.at };
  } else {
    base.entries.push({ at: hit.at, ua: hit.ua, n: 1 });
    if (base.entries.length > OUTREACH_PREVIEW_VIEWS_CAP) base.entries.splice(0, base.entries.length - OUTREACH_PREVIEW_VIEWS_CAP);
  }
  return base;
}

/** 산출물 페이지 열람 중 기준 시각 이후의 사람 열람 수(항목 n 합산 · 항목 상한에 잘린 옛 열람은 세지 않는다) */
export function previewHumanViewsSince(pv: PreviewViews | null | undefined, sinceIso: string | null | undefined): number {
  if (!pv || !Array.isArray(pv.entries)) return 0;
  const since = sinceIso ? new Date(sinceIso).getTime() : NaN;
  let n = 0;
  for (const e of pv.entries) {
    if (e.ua === 'bot') continue;
    const at = new Date(e.last || e.at).getTime();
    if (!Number.isFinite(since) || (Number.isFinite(at) && at >= since)) n += Number(e.n) || 1;
  }
  return n;
}

export interface DmViewAgg { viewers: number; opens: number; firstAt: string | null; lastAt: string | null; seconds: number; scroll: number | null; afterForward: number }
export interface OutreachViewSummary {
  dm: DmViewAgg | null;
  preview: { total: number; human: number; bot: number; afterForward: number; firstAt: string | null; lastAt: string | null } | null;
  /** 업체 전달 표시 뒤 3일이 지났는데 열람 신호(DM · 산출물 페이지 사람 열람)가 0 */
  unread3d: boolean;
  /** 재접촉 후보 = unread3d 와 같다(확정 신호 0) · 이름을 따로 둔 이유: 화면 문장·필터가 이 뜻으로 읽는다 */
  recontact: boolean;
  sentences: string[];
}

const kstDay = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
};

/**
 * 열람 요약 + 문장(서버 완성 · 화면은 그대로 보인다). 숫자를 지어내지 않는다: 집계가 없으면(null) 그 축 문장을 내지 않는다.
 * 메일 픽셀은 없다(첫 오픈 = 우리 자신) · 전달 표시 전 열람은 내부 확인일 수 있어 그렇게 말한다.
 */
export function summarizeOutreachViews(input: {
  dm: DmViewAgg | null; preview: PreviewViews | null; forwardedAt: string | null; stage: string; now?: Date;
}): OutreachViewSummary {
  const now = input.now || new Date();
  const dm = input.dm;
  const pvAfter = previewHumanViewsSince(input.preview, input.forwardedAt);
  const preview = input.preview
    ? { total: Number(input.preview.total) || 0, human: Number(input.preview.human) || 0, bot: Number(input.preview.bot) || 0, afterForward: pvAfter, firstAt: input.preview.first_at || null, lastAt: input.preview.last_at || null }
    : null;
  const fwdMs = input.forwardedAt ? new Date(input.forwardedAt).getTime() : NaN;
  const forwardedLongAgo = Number.isFinite(fwdMs) && now.getTime() - fwdMs >= OUTREACH_UNREAD_DAYS * 24 * 60 * 60 * 1000;
  const signalAfterForward = (dm ? dm.afterForward : 0) + pvAfter;
  const unread3d = forwardedLongAgo && signalAfterForward === 0;
  const sentences: string[] = [];
  if (dm) {
    if (dm.viewers > 0) {
      const parts = [`모바일 DM을 ${dm.viewers}대 기기에서 ${Math.max(dm.opens, dm.viewers)}회 열어 보았습니다`];
      if (dm.lastAt) parts.push(`마지막 ${kstDay(dm.lastAt)}`);
      if (dm.seconds > 0) parts.push(`머문 시간 합계 ${dm.seconds}초`);
      if (dm.scroll !== null && dm.scroll !== undefined) parts.push(`끝까지 본 비율 최대 ${dm.scroll}%`);
      sentences.push(parts.join(' · ') + '.');
      if (input.forwardedAt) sentences.push(dm.afterForward > 0 ? `업체 전달 표시 뒤 열람 ${dm.afterForward}건.` : '업체 전달 표시 뒤 모바일 DM 열람은 아직 없습니다.');
    } else {
      sentences.push('모바일 DM 열람 기록이 아직 없습니다.');
    }
  }
  if (preview) {
    if (preview.human > 0) {
      const p = `산출물 페이지를 사람이 ${preview.human}회 열었습니다` + (preview.lastAt ? ` · 마지막 ${kstDay(preview.lastAt)}` : '') + (preview.bot > 0 ? ` · 자동 수집기 ${preview.bot}회 제외` : '') + '.';
      sentences.push(p);
      if (input.forwardedAt) sentences.push(pvAfter > 0 ? `그중 업체 전달 표시 뒤 ${pvAfter}회.` : '업체 전달 표시 전 열람만 있어 내부 확인일 수 있습니다.');
    } else if (preview.total > 0) {
      sentences.push(`산출물 페이지 열람은 자동 수집기 ${preview.bot}회뿐입니다.`);
    }
  }
  if (unread3d) sentences.push(`업체 전달 뒤 ${OUTREACH_UNREAD_DAYS}일 동안 열람이 없습니다. 재접촉 후보입니다.`);
  if (input.stage === 'sent' && !input.forwardedAt) sentences.push('업체 전달 표시가 없어 열람이 내부 확인인지 업체인지 가르지 못합니다.');
  return { dm, preview, unread3d, recontact: unread3d, sentences };
}
