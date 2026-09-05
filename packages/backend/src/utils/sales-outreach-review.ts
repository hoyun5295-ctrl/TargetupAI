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
  | 'NO_PRODUCTS' | 'FEW_PRODUCTS' | 'FEW_GALLERY' | 'CTA_ALL_HOME' | 'NO_LEGAL' | 'FEW_SECTIONS' | 'NO_BRAND_EMAIL' | 'NO_LOOK';

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
}

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
  }
  if (!input.legal || (!input.legal.legal && !input.legal.csPhone)) w.push({ code: 'NO_LEGAL' });
  if (input.brandSections !== undefined && input.brandSections !== null && input.brandSections.length === 0) w.push({ code: 'NO_BRAND_EMAIL', value: 0 });
  return { warnings: w };
}
