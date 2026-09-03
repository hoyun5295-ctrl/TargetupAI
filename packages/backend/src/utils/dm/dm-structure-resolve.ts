/**
 * dm-structure-resolve.ts — 참조 골격 학습층 순수 함수 (2026-09-03 · docs/2026-09-03-reference-skeleton-learning-design.md §5)
 *
 * 직원 실물에서 뽑은 섹션 골격(타입 순서·통계)을 생성 CT가 **결정적으로** 고르게 하는 계산 전부.
 * ⛔ DB·AI·ENV·Date import 0 — 입력은 타입 배열과 seed 문자열뿐이다. props를 읽는 코드가 여기 있으면 안 된다(계약 테스트).
 * ⛔ 더하기 없음 — reduceStructure는 입력의 부분집합만 돌려준다. 최소 골격(header·콘텐츠·cta·footer)은 normalizeSectionChain이 보장한다.
 * ⛔ 상한은 registry(SECTION_META.maxCount)만 소유 — 여기서는 p50·범위만 센다.
 * ⛔ 유형 라벨(media/catalog)은 chain 선택 키로만 쓴다 — 프롬프트 문구·사용자 화면 문안에 넣지 않는다.
 */
import { isValidSectionType, type SectionType } from './dm-section-registry';

export type SkeletonChannel = 'DM' | 'EMAIL';
export type AuthorType = 'media' | 'catalog';
export type AvailState = 'present' | 'absent' | 'unknown';
export type StructureSource = 'human' | 'scenario' | 'learned' | 'ai';

/** 재료 유무 3값 — unknown이면 그 축은 감산하지 않는다(불변 10과 같은 형태: 모름을 없음으로 접지 않는다). */
export interface Avail {
  products: AvailState;
  /** products가 present일 때만 의미 있음 */
  productCount?: number;
  benefit: AvailState;
  embeds: AvailState;
  social: AvailState;
}

export const AVAIL_UNKNOWN: Readonly<Avail> = Object.freeze({
  products: 'unknown', benefit: 'unknown', embeds: 'unknown', social: 'unknown',
});

export interface SkeletonChainRef {
  kind: 'dm' | 'email';
  id: string;
  promoted_at: string;
  promoted_by: string | null;
}

export interface SkeletonChain {
  seq: SectionType[];
  author_type: AuthorType;
  author_type_source: 'auto' | 'human';
  /** human = ai_prompt 없음 · human_edited = AI 초안을 사람이 편집(참조 10건 전부 이 값 · 0903 실측) */
  src: 'human' | 'human_edited';
  ref: SkeletonChainRef;
}

export interface SkeletonStats {
  n: number;
  len: { p50: number; min: number; max: number };
  /** [첫 타입, 둘째 타입, 비율] 상위 3 */
  opening: Array<[string, string, number]>;
  /** [마지막 타입, 비율] 상위 2 */
  closing: Array<[string, number]>;
  /** 타입별 건당 등장 수(등장한 건만) p50·max */
  repeat: Record<string, { p50: number; max: number }>;
  /** 타입별 등장 비율(그 타입을 1개 이상 가진 건 / n) */
  freq: Record<string, number>;
  cta: { p50: number; max: number };
  text_card: { p50: number; max: number };
  by_type: Record<AuthorType, number>;
}

export interface SkeletonMeta {
  v: 1;
  chains: SkeletonChain[];
  stats: SkeletonStats;
  perf: { basis: string | null; n: number; confident: boolean; updated_at: string | null };
  serving: { enabled: boolean; enabled_by: string | null; enabled_at: string | null };
}

/** DM 유형 판정에 쓰는 미디어 섹션 — 2개 이상이면 media(실물 10건 5:5 · 작성자 축과 일치). */
export const MEDIA_SECTION_TYPES: readonly SectionType[] = ['video', 'youtube_embed', 'instagram_embed', 'slideshow'];
/** 혜택 면허·원문이 없으면 빠지는 섹션(아웃리치 불변 4·5 · 플래너 혜택 원문 원칙). */
export const BENEFIT_SECTION_TYPES: readonly SectionType[] = ['countdown', 'coupon', 'instant_coupon', 'promo_code', 'limited_quantity'];
/** 타사 콘텐츠 임베드 — 아웃리치는 상시 제외. */
export const EMBED_SECTION_TYPES: readonly SectionType[] = ['youtube_embed', 'instagram_embed', 'video'];
/** 타사 채널·후기 — 아웃리치는 상시 제외. */
export const SOCIAL_SECTION_TYPES: readonly SectionType[] = ['sns', 'reviews'];

/**
 * 섹션 배열 → 타입 순서. **`type` 키만 읽는다.** 유효하지 않은 타입·객체가 아닌 항목은 버린다.
 * 승격 경로가 props를 손에 쥐지 않게 하는 유일한 입구.
 */
export function extractTypeSequence(sections: unknown): SectionType[] {
  if (!Array.isArray(sections)) return [];
  const out: SectionType[] = [];
  for (const s of sections) {
    if (!s || typeof s !== 'object') continue;
    const t = String((s as { type?: unknown }).type || '');
    if (isValidSectionType(t)) out.push(t);
  }
  return out;
}

/** 유형 추정 — DM: 미디어 섹션 2개 이상 = media / EMAIL: footer 마감 = catalog(설계서 §5-2 골든 19건 고정). */
export function inferAuthorType(seq: readonly string[], channel: SkeletonChannel): AuthorType {
  if (channel === 'EMAIL') {
    return seq.length > 0 && seq[seq.length - 1] === 'footer' ? 'catalog' : 'media';
  }
  const media = seq.filter((t) => (MEDIA_SECTION_TYPES as readonly string[]).includes(t)).length;
  return media >= 2 ? 'media' : 'catalog';
}

/** 하위 중앙값(짝수 개면 아래쪽) — 정수 통계라 보간하지 않는다. 빈 배열 = 0. */
function p50(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function countOf(seq: readonly string[], type: string): number {
  let n = 0;
  for (const t of seq) if (t === type) n++;
  return n;
}

/** chains 전체에서 통계를 다시 센다(저장 때마다 재계산 · 손으로 고치지 않는다). */
export function deriveSkeletonStats(chains: readonly SkeletonChain[]): SkeletonStats {
  const n = chains.length;
  const lens = chains.map((c) => c.seq.length);
  const openingCount = new Map<string, number>();
  const closingCount = new Map<string, number>();
  const perTypeCounts = new Map<string, number[]>();
  const presence = new Map<string, number>();
  const by_type: Record<AuthorType, number> = { media: 0, catalog: 0 };

  for (const c of chains) {
    by_type[c.author_type] = (by_type[c.author_type] || 0) + 1;
    if (c.seq.length >= 2) {
      const key = `${c.seq[0]}>${c.seq[1]}`;
      openingCount.set(key, (openingCount.get(key) || 0) + 1);
    }
    if (c.seq.length >= 1) {
      const last = c.seq[c.seq.length - 1];
      closingCount.set(last, (closingCount.get(last) || 0) + 1);
    }
    const seen = new Set<string>();
    for (const t of c.seq) {
      if (seen.has(t)) continue;
      seen.add(t);
      presence.set(t, (presence.get(t) || 0) + 1);
      const cnt = countOf(c.seq, t);
      const arr = perTypeCounts.get(t) || [];
      arr.push(cnt);
      perTypeCounts.set(t, arr);
    }
  }

  const opening = [...openingCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([k, v]) => { const [a, b] = k.split('>'); return [a, b, round2(v / n)] as [string, string, number]; });
  const closing = [...closingCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([k, v]) => [k, round2(v / n)] as [string, number]);
  const repeat: Record<string, { p50: number; max: number }> = {};
  for (const [t, arr] of perTypeCounts) repeat[t] = { p50: p50(arr), max: Math.max(...arr) };
  const freq: Record<string, number> = {};
  for (const [t, v] of presence) freq[t] = round2(v / n);
  const ctaCounts = chains.map((c) => countOf(c.seq, 'cta'));
  const textCardCounts = chains.map((c) => countOf(c.seq, 'text_card'));

  return {
    n,
    len: { p50: p50(lens), min: n ? Math.min(...lens) : 0, max: n ? Math.max(...lens) : 0 },
    opening,
    closing,
    repeat,
    freq,
    cta: { p50: p50(ctaCounts), max: n ? Math.max(...ctaCounts) : 0 },
    text_card: { p50: p50(textCardCounts), max: n ? Math.max(...textCardCounts) : 0 },
    by_type,
  };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * 통계 → 사람 가독 요약(관리자 패널 `content` · 이메일 프롬프트 블록 본문 공용).
 * 입력이 stats뿐이라 브랜드명·URL·문구가 들어올 자리가 없다. 유형 라벨도 쓰지 않는다(불변 10).
 */
export function buildSkeletonContent(stats: SkeletonStats, channel: SkeletonChannel): string {
  const unit = channel === 'EMAIL' ? '블록' : '섹션';
  const lines: string[] = [];
  lines.push(`- ${unit} 수: 보통 ${stats.len.p50}개(${stats.len.min}~${stats.len.max})`);
  if (stats.opening.length) {
    lines.push(`- 시작: ${stats.opening.map(([a, b, r]) => `${a} 다음 ${b}(${pct(r)})`).join(' · ')}`);
  }
  const bodyTypes = ['product_carousel', 'text_card', 'gallery', 'slideshow'];
  const body = bodyTypes
    .filter((t) => stats.repeat[t])
    .map((t) => `${t} 보통 ${stats.repeat[t].p50}개(최대 ${stats.repeat[t].max} · ${pct(stats.freq[t] || 0)}의 건에 등장)`);
  if (body.length) lines.push(`- 본문: ${body.join(' · ')}`);
  lines.push(`- 행동 유도(cta): 보통 ${stats.cta.p50}개, 최대 ${stats.cta.max}`);
  if (stats.closing.length) {
    lines.push(`- 마감: ${stats.closing.map(([t, r]) => `${t}(${pct(r)})`).join(' · ')}`);
  }
  const skip = new Set(['header', 'footer', 'hero', 'cta', ...bodyTypes]);
  const others = Object.entries(stats.freq)
    .filter(([t]) => !skip.has(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([t, r]) => `${t} ${pct(r)}`);
  if (others.length) lines.push(`- 자주 쓰는 구성: ${others.join(' · ')}`);
  return lines.join('\n');
}

/** seed의 일자 키(KST YYYY-MM-DD) — Date는 호출부가 넘긴다(이 파일은 시계를 갖지 않는다). */
export function seedDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** djb2 32비트 — 난수 대신 seed 문자열로 결정적 선택. */
export function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/**
 * 유형 선택 — 상품 3개 이상 = 상품형(catalog 실물의 정의가 carousel 반복), 3개 미만 = media,
 * 상품을 모르면 seed 해시 교대(한 회사가 늘 같은 골격이 되는 단조 방지).
 */
export function pickVariant(avail: Avail, seed: string): AuthorType {
  if (avail.products === 'present') return (avail.productCount || 0) >= 3 ? 'catalog' : 'media';
  return stableHash(seed) % 2 === 0 ? 'catalog' : 'media';
}

/** 감산 — 재료가 없는(absent) 축의 섹션만 뺀다. unknown = 그대로. 반환은 항상 입력의 부분집합. */
export function reduceStructure(types: readonly SectionType[], avail: Avail): { types: SectionType[]; removed: SectionType[] } {
  const drop = new Set<string>();
  if (avail.products === 'absent') drop.add('product_carousel');
  if (avail.benefit === 'absent') for (const t of BENEFIT_SECTION_TYPES) drop.add(t);
  if (avail.embeds === 'absent') for (const t of EMBED_SECTION_TYPES) drop.add(t);
  if (avail.social === 'absent') for (const t of SOCIAL_SECTION_TYPES) drop.add(t);
  if (drop.size === 0) return { types: [...types], removed: [] };
  const kept: SectionType[] = [];
  const removed: SectionType[] = [];
  for (const t of types) {
    if (drop.has(t)) { if (!removed.includes(t)) removed.push(t); continue; }
    kept.push(t);
  }
  return { types: kept, removed };
}

export interface ResolveInput {
  /** 사람이 고른 구성(원스텝 `structure` · 아웃리치 명시 전달) — 최상위 */
  human?: readonly SectionType[] | null;
  /** 빠른 시작 시나리오 고정 구성 — 사용자가 클릭한 구성(0813 연장) */
  scenario?: readonly SectionType[] | null;
  /** 참조 골격(serving 여부는 조회 함수가 이미 걸렀다) */
  learned?: SkeletonMeta | null;
  variant: AuthorType;
  seed: string;
  avail: Avail;
}

export interface ResolveResult {
  /** null = 어느 축도 없음 → 호출부는 기존 AI 설계 경로를 그대로 탄다 */
  types: SectionType[] | null;
  source: StructureSource;
  chainIdx: number | null;
  removed: SectionType[];
}

/** 사다리: human > scenario > learned > null(ai). 이 함수 하나가 순위를 소유한다(불변 4). */
export function resolveStructure(i: ResolveInput): ResolveResult {
  if (i.human && i.human.length > 0) return { types: [...i.human], source: 'human', chainIdx: null, removed: [] };
  if (i.scenario && i.scenario.length > 0) return { types: [...i.scenario], source: 'scenario', chainIdx: null, removed: [] };
  const chains = i.learned?.chains || [];
  const indexed = chains.map((c, idx) => ({ c, idx })).filter((x) => Array.isArray(x.c.seq) && x.c.seq.length >= 3);
  let pool = indexed.filter((x) => x.c.author_type === i.variant);
  if (pool.length === 0) pool = indexed;
  if (pool.length === 0) return { types: null, source: 'ai', chainIdx: null, removed: [] };
  const pick = pool[stableHash(i.seed) % pool.length];
  const r = reduceStructure(pick.c.seq, i.avail);
  return { types: r.types, source: 'learned', chainIdx: pick.idx, removed: r.removed };
}

export function emptySkeletonMeta(): SkeletonMeta {
  return {
    v: 1,
    chains: [],
    stats: deriveSkeletonStats([]),
    perf: { basis: null, n: 0, confident: false, updated_at: null },
    serving: { enabled: false, enabled_by: null, enabled_at: null },
  };
}

/** append — 같은 ref.id는 무시 · stats 재계산 · perf·serving 보존(치환하면 두 번째 승격이 첫 번째를 지운다: 불변 8). */
export function appendChains(meta: SkeletonMeta | null | undefined, newChains: readonly SkeletonChain[]): { meta: SkeletonMeta; added: number; skippedDuplicate: number } {
  const base = meta && Array.isArray(meta.chains) ? meta : emptySkeletonMeta();
  const seen = new Set(base.chains.map((c) => c.ref?.id).filter(Boolean));
  const chains = [...base.chains];
  let added = 0;
  let skippedDuplicate = 0;
  for (const c of newChains) {
    if (c.ref?.id && seen.has(c.ref.id)) { skippedDuplicate++; continue; }
    if (c.ref?.id) seen.add(c.ref.id);
    chains.push(c);
    added++;
  }
  return {
    meta: {
      v: 1,
      chains,
      stats: deriveSkeletonStats(chains),
      perf: base.perf || { basis: null, n: 0, confident: false, updated_at: null },
      serving: base.serving || { enabled: false, enabled_by: null, enabled_at: null },
    },
    added,
    skippedDuplicate,
  };
}

/** 정규화 예고 — 원본과 정규화 결과의 차이를 사람 문장으로(자동 보정을 조용히 하지 않는다). */
export function normalizationNotes(original: readonly string[], normalized: readonly string[]): string[] {
  const notes: string[] = [];
  if (original.length > 0 && original[0] !== 'header' && normalized[0] === 'header') notes.push('앞에 header가 붙습니다');
  if (original.length > 0 && original[original.length - 1] !== 'footer' && normalized[normalized.length - 1] === 'footer') notes.push('끝에 footer가 붙습니다');
  const types = new Set<string>([...original, ...normalized]);
  for (const t of types) {
    const before = countOf(original, t);
    const after = countOf(normalized, t);
    if (t === 'header' || t === 'footer') continue;
    if (before > after) notes.push(`${t} ${before - after}개가 상한 초과로 빠집니다`);
    if (before === 0 && after > 0) notes.push(`${t}가 최소 구성으로 추가됩니다`);
  }
  return notes;
}
