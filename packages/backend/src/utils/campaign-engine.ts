/**
 * ★ 2026-09-06 S5 캠페인 조립 엔진 — AI 뒤 **결정 구간**(재료 채우기 → 혜택 차단 → 빈 섹션 정리 → 카운트다운 위치 → 룩 → 사람 숨김 → 사회적 증거 → 페이지)의 단일 소유자.
 * 설계 = docs/2026-09-06-campaign-engine-design.md §7.
 *
 * 계약:
 *  - 이 파일은 `sales-outreach-*` 를 하나도 import 하지 않는다(순환 참조 차단 · 계약 테스트). 생성기·채우기·차단기·룩은 전부 **주입(deps)** 이다.
 *  - 아웃리치(영업 샘플)와 고객 입구(재료 업로드)가 같은 순서를 탄다. 순서가 갈라지면 한쪽만 고쳐진다.
 *  - 발행·DB·크레딧은 여기 없다(호출자 소유). 엔진은 섹션·페이지·통계만 돌려준다.
 *  - `options.entry` 는 채우기(fill)의 4번째 인자로 그대로 전달된다 — ★ v3 아웃리치 = gallery 0(행사 카드 → text_card+cta) · 고객 = 현행. 엔진 순서는 분기 0.
 */
import type { Section } from './dm/dm-section-registry';

export type EngineChannel = 'DM' | 'EMAIL';
export type EngineEntry = 'outreach' | 'customer';

export interface EngineImage {
  url: string; width?: number; height?: number; /** 홈페이지 배너 문구(정리본) · 캡션 원천 */ alt?: string;
  /** ★ v3 고객 재료 카드 묶음 식별자(행사 카드별 이미지) · 없으면 옛 경로(히어로 + 갤러리) */
  group?: string;
}
export interface EngineProduct {
  name: string; price: number | null; discount_price: number | null; image_url: string; link_url?: string;
  width?: number; height?: number; discount_rate?: number | string | null; rating?: number | string | null; review_count?: number | string | null; badges?: string[];
  /** ★ v3 수상·순위 원문 조각(≤3 · 스포트라이트 카드 재료) */
  awards?: string[];
}

/**
 * ★ 2026-09-06 v3 행사 카드(이벤트 목록 페이지 카드 1개 = 행사 1개) — 아웃리치(크롤 · 사본 URL)와 고객 입구(업로드)가 같은 모양.
 * title·periodRaw 는 원문 문자열(재대조 통과) · bannerUrl 은 우리 사본(또는 업로드 서빙 경로) · endDate 는 YYYY-MM-DD(면허 판정은 호출자).
 */
export interface EngineEventCard {
  title: string;
  periodRaw: string | null;
  endDate: string | null;
  bannerUrl: string | null;
  bannerSize?: { width: number; height: number } | null;
  detailUrl: string | null;
  /** 면허(원문 재대조 + 미래 종료일 · 고객 입구 = 사용자가 "그대로 씁니다" 체크) */
  licensed: boolean;
  /** ★ 고객 입구 — 이 카드에 묶인 업로드 이미지 묶음 식별자(EngineImage.group 과 짝) · 아웃리치는 없음 */
  group?: string;
  /** ★ 고객 입구 — 카드 본문(사용자가 쓴 행사 내용 · 카드 text_card body) */
  text?: string;
}

/** 조립 재료 — 원천(크롤·업로드)이 무엇이든 여기서는 같은 모양이다 */
export interface EngineMaterials {
  companyName: string;
  industry: string | null;
  homepageUrl: string;
  siteTitle: string | null;
  /** 프롬프트 재료(면허 밖 혜택 자리를 지운 본문) */
  material: string;
  extraNotes: string | null;
  products: EngineProduct[];
  gallery: EngineImage[];
  logoUrl: string | null;
  posterUrl: string | null;
  posterSize: { width: number; height: number } | null;
  bannerUrl: string | null;
  bannerSize: { width: number; height: number } | null;
  ctaLinks: Record<string, string>;
  legal: { legal: string | null; csPhone: string | null } | null;
  /** 혜택 수치 면허 원문(없으면 '') — 차단기의 기준. 아웃리치 = 재대조 통과 인용 · 고객 입구 = 사용자가 직접 쓴 텍스트만 */
  licensedQuote: string;
  proof: unknown | null;
  /** ★ 2026-09-06(2) 포스터 캡션(포스터 3칸의 title · 숫자 0) — 포스터 블록 아래 한 줄 */
  posterCaption?: string | null;
  /** ★ v3 행사 카드(선택 순서 = DM 등장 순서 · ≤3 · 없으면 옛 경로) */
  eventCards?: EngineEventCard[];
}

export interface EngineOptions {
  entry: EngineEntry;
  channel: EngineChannel;
  /** 참조 골격이 준 구성 순서 힌트(없으면 예시 리듬) */
  skeletonTypes: readonly string[] | null;
  /** 사람이 숨긴 섹션(override) · 재생성 뒤에도 재적용 */
  sectionOverride: unknown | null;
  /** 저장된 최종 섹션으로 재발행(AI 0 · 채우기 0 · 숨김 재실행 전용) */
  presetSections: Section[] | null;
  layoutMode: string;
}

export interface EngineGenInput {
  companyName: string; industry: string | null; homepageUrl: string; siteTitle: string | null; material: string; extraNotes: string | null;
  products: EngineProduct[]; galleryCount: number; skeletonTypes: readonly string[] | null; entry: EngineEntry;
  /** 홈페이지 배너 문구 목록(정리본) — 갤러리 앞 설명 카드는 이 안에서만 */
  bannerCaptions: readonly string[];
  /** ★ v3 행사 카드(제목·기간 원문) — 프롬프트 재료 블록 [진행 중 행사] */
  eventCards?: readonly EngineEventCard[];
}

/** 주입 의존 — 구현은 호출자 축 파일이 소유한다(아웃리치 = sales-outreach-produce.ts `outreachEngineDeps`) */
export interface EngineDeps<TStats = unknown, TDims = unknown, TOverride = unknown> {
  generate(input: EngineGenInput): Promise<{ sections: Section[]; exemplars: { picked: number; total: number } }>;
  buildDims(gallery: readonly EngineImage[], products: readonly EngineProduct[], posterUrl: string | null, posterSize: { width: number; height: number } | null): TDims;
  /** ★ v3 entry 가 4번째(마지막) 인자 — 아웃리치 = gallery 0 · 행사 카드 → text_card+cta / 고객 = 현행 */
  fill(sections: readonly Section[], materials: EngineMaterials, channel: EngineChannel, entry: EngineEntry): { sections: Section[]; filled: number };
  sanitize(sections: readonly Section[], licensedQuote: string, companyName: string): { sections: Section[]; stripped: number; removed: string[]; heroFallback: boolean };
  prune(sections: readonly Section[]): { sections: Section[]; removed: string[] };
  orderCountdown(sections: readonly Section[]): Section[];
  applyLook(sections: readonly Section[], channel: EngineChannel, dims: TDims): { sections: Section[]; stats: TStats };
  lookStats(sections: readonly Section[]): TStats;
  applyOverride(sections: readonly Section[], override: TOverride | null): { sections: Section[]; applied: number; missed: string[]; skipped?: boolean };
  insertProof(sections: readonly Section[], proof: unknown | null, companyName: string): { sections: Section[]; inserted: boolean };
  rebuild(sections: readonly Section[]): { sections: Section[] };
  splitPages(sections: readonly Section[], layoutMode: string): unknown[];
}

export interface EngineResult<TStats = unknown> {
  /** 최종 섹션(override·증거 카드 적용 후 · 발행본) */
  sections: Section[];
  /** override 적용 전(다음 숨김의 기준) */
  sectionsBase: Section[];
  pages: unknown[];
  look: TStats;
  sectionTypes: string[];
  benefitStripped: number;
  heroFallback: boolean;
  proofInserted: boolean;
  exemplars: { picked: number; total: number };
  /** 생성 뒤 데이터가 비어 지운 섹션 타입(중복 제거) */
  removed: string[];
  filled: number;
  hidden: { applied: number; missed: string[]; skipped: boolean };
  /** 이번 조립이 AI 생성을 거쳤는가(preset 재발행 = false) */
  generated: boolean;
}

/**
 * DM 조립(결정 구간). 순서는 아웃리치 0905(3)~S2 에서 실측으로 굳힌 그대로:
 *  생성 → 채우기 → 차단 → 정리 → 카운트다운 위치 → 룩 → [override] → 증거 카드 → 재구성 → 통계 → 페이지.
 * override 는 룩 뒤(숨김은 발행 직전의 사람 결정) · 증거 카드는 override 뒤(숨김 순번 보존) · 통계는 발행본 기준.
 */
export async function assembleDmCampaign<TStats, TDims, TOverride>(
  m: EngineMaterials,
  opts: EngineOptions,
  deps: EngineDeps<TStats, TDims, TOverride>,
): Promise<EngineResult<TStats>> {
  const dims = deps.buildDims(m.gallery, m.products, m.posterUrl, m.posterSize);
  let exemplars = { picked: 0, total: 0 };
  let benefitStripped = 0;
  let heroFallback = false;
  let filled = 0;
  let removed: string[] = [];
  let sectionsBase: Section[];
  let generated = false;
  if (opts.presetSections && opts.presetSections.length > 0) {
    // 섹션 숨김 재실행 — 저장된 최종 섹션(룩 이미 실림)을 그대로 다시(AI 0 · 채우기 0)
    sectionsBase = opts.presetSections;
  } else {
    const gen = await deps.generate({
      companyName: m.companyName, industry: m.industry, homepageUrl: m.homepageUrl, siteTitle: m.siteTitle, material: m.material, extraNotes: m.extraNotes,
      products: m.products, galleryCount: m.gallery.length + (m.posterUrl ? 1 : 0), skeletonTypes: opts.skeletonTypes, entry: opts.entry,
      bannerCaptions: m.gallery.map((g) => String(g.alt || '').trim()).filter(Boolean),
      eventCards: m.eventCards || [],
    });
    generated = true;
    exemplars = gen.exemplars;
    const filledR = deps.fill(gen.sections, m, opts.channel, opts.entry);
    filled = filledR.filled;
    const sanitized = deps.sanitize(filledR.sections, m.licensedQuote, m.companyName);
    benefitStripped = sanitized.stripped;
    heroFallback = sanitized.heroFallback;
    const pruned = deps.prune(sanitized.sections);
    removed = Array.from(new Set([...sanitized.removed, ...pruned.removed]));
    // 카운트다운은 마지막 CTA 직전(위치만 · 룩 배정 전에 순서 확정)
    const ordered = deps.orderCountdown(pruned.sections);
    // 룩은 정리 뒤(최종 순서 확정 뒤) 코드가 섹션 최상위에 입힌다
    const looked = deps.applyLook(ordered, opts.channel, dims);
    sectionsBase = looked.sections;
  }
  // 사람이 숨긴 섹션은 override 데이터로 재적용(같은 조립 경로)
  const overridden = deps.applyOverride(sectionsBase, (opts.sectionOverride as TOverride | null) || null);
  // 사회적 증거 카드 — override 뒤(숨김 순번 보존) · 재료 원문 숫자만
  const withProof = deps.insertProof(overridden.sections, m.proof, m.companyName);
  const rebuilt = deps.rebuild(withProof.sections);
  // 발행본 기준 룩 통계(숨김으로 줄어든 뒤) — 화면·품질 경고가 읽는 값은 발행본과 같아야 한다
  const look = deps.lookStats(rebuilt.sections);
  const pages = deps.splitPages(rebuilt.sections, opts.layoutMode);
  return {
    sections: rebuilt.sections,
    sectionsBase,
    pages,
    look,
    sectionTypes: rebuilt.sections.map((s) => String(s.type)),
    benefitStripped,
    heroFallback,
    proofInserted: withProof.inserted,
    exemplars,
    removed,
    filled,
    hidden: { applied: overridden.applied, missed: overridden.missed, skipped: overridden.skipped === true },
    generated,
  };
}
