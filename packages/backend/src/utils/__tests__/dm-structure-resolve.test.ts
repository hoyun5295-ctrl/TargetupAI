/**
 * dm-structure-resolve.test.ts — 참조 골격 순수 함수 계약 (2026-09-03 · 설계서 §9 5~9)
 *
 * 고정하는 것
 *  - 골든 19건(직원 실물 DM 10 · 이메일 9)의 유형 판정이 설계서 §5-2 표와 같다
 *  - 골든 DM 10건을 normalizeSectionChain에 넣어도 순서가 보존되고, footer 부착 4건·상한 초과 제거 0건이 **명시 승인**된 변화의 전부다
 *  - reduceStructure는 더하지 않는다(부분집합) · avail 전부 unknown이면 항등
 *  - resolveStructure 사다리(human > scenario > learned > null) · 같은 seed = 같은 결과 · seed가 다르면 한 값에 고정되지 않는다
 *  - renderStructureBlock 출력에 URL·브랜드명·시퀀스 원문이 없다(입력이 stats뿐)
 *  - appendChains는 같은 ref.id를 무시하고 serving을 보존한다
 */
import { describe, it, expect } from 'vitest';
import {
  AVAIL_UNKNOWN,
  appendChains,
  buildSkeletonContent,
  deriveSkeletonStats,
  emptySkeletonMeta,
  extractTypeSequence,
  inferAuthorType,
  normalizationNotes,
  pickVariant,
  reduceStructure,
  resolveStructure,
  stableHash,
  type Avail,
  type SkeletonChain,
} from '../dm/dm-structure-resolve';
import { renderStructureBlock } from '../email/email-structure-prompt';
import { normalizeSectionChain } from '../dm/dm-section-layout';
import type { SectionType } from '../dm/dm-section-registry';

const seq = (s: string): SectionType[] => s.split('>') as SectionType[];

/** 설계서 §5-2 골든 표 — 브랜드 단위로 DM·이메일 유형이 일치한다 */
const GOLDEN_DM: Array<[string, string, 'media' | 'catalog']> = [
  ['조선미녀', 'header>video>countdown>product_carousel>reviews>gallery>tab_cards>product_carousel>text_card>slideshow>instant_coupon>footer', 'media'],
  ['무신사', 'header>hero>slideshow>cta>gallery>countdown>youtube_embed>gallery>promo_code>instagram_embed', 'media'],
  ['3CE', 'header>hero>product_carousel>youtube_embed>cta>slideshow>text_card>gallery>slideshow>sns', 'media'],
  ['지그재그', 'header>slideshow>product_carousel>tab_cards>youtube_embed>countdown>product_carousel>cta>sns', 'media'],
  ['유니클로', 'header>youtube_embed>hero>product_carousel>product_carousel>coupon>countdown>slideshow>cta>gallery>gallery>store_info', 'media'],
  ['이폴리움', 'header>hero>cta>gallery>product_carousel>cta>footer', 'catalog'],
  ['올리브영', 'header>hero>cta>product_carousel>product_carousel>gallery>gallery>cta>countdown>footer', 'catalog'],
  ['쿠팡', 'header>hero>cta>product_carousel>hero>product_carousel>cta>cta>cta>footer', 'catalog'],
  ['에이블리', 'header>coupon>product_carousel>cta>product_carousel>gallery>cta>gallery>cta>countdown>footer', 'catalog'],
  ['스파오', 'header>hero>slideshow>product_carousel>product_carousel>product_carousel>gallery>cta>gallery>footer', 'catalog'],
];

const GOLDEN_EMAIL: Array<[string, string, 'media' | 'catalog']> = [
  ['조선미녀', 'header>gallery>hero>text_card>text_card>product_carousel>cta', 'media'],
  ['무신사', 'header>gallery>hero>text_card>product_carousel>text_card>product_carousel>coupon>cta', 'media'],
  ['3CE', 'header>hero>product_carousel>product_carousel>text_card>cta', 'media'],
  ['지그재그', 'header>gallery>text_card>product_carousel>text_card>product_carousel>text_card>cta', 'media'],
  ['유니클로', 'header>hero>text_card>product_carousel>coupon>cta>text_card>gallery>cta>gallery>gallery>store_info', 'media'],
  ['올리브영', 'header>hero>text_card>product_carousel>text_card>cta>footer', 'catalog'],
  ['쿠팡', 'header>hero>cta>text_card>product_carousel>text_card>product_carousel>cta>cta>cta>footer', 'catalog'],
  ['에이블리', 'header>hero>text_card>coupon>product_carousel>text_card>cta>footer', 'catalog'],
  ['스파오', 'header>hero>text_card>product_carousel>cta>text_card>cta>gallery>footer', 'catalog'],
];

function chainsOf(golden: Array<[string, string, 'media' | 'catalog']>, kind: 'dm' | 'email'): SkeletonChain[] {
  return golden.map(([name, s, type], i) => ({
    seq: seq(s),
    author_type: type,
    author_type_source: 'auto',
    src: 'human_edited',
    ref: { kind, id: `${kind}-${name}`, promoted_at: `2026-09-03T00:00:0${i % 10}.000Z`, promoted_by: 'test' },
  }));
}

describe('extractTypeSequence — type만 읽는다', () => {
  it('props 안의 값은 결과에 없다 · 무효 타입은 버린다', () => {
    const out = extractTypeSequence([
      { type: 'header', props: { brand_name: '유니클로', logo_url: 'https://x.test/logo.png' } },
      { type: 'hero', props: { headline: '1년에 단 한 번' } },
      { type: 'nope', props: {} },
      null,
      { type: 'cta', props: { buttons: [{ url: 'https://x.test' }] } },
    ]);
    expect(out).toEqual(['header', 'hero', 'cta']);
    expect(JSON.stringify(out)).not.toMatch(/유니클로|https|headline/);
  });
});

describe('inferAuthorType — 골든 19건 = 설계서 §5-2', () => {
  it('DM 10건', () => {
    for (const [name, s, expected] of GOLDEN_DM) {
      expect(inferAuthorType(seq(s), 'DM'), name).toBe(expected);
    }
  });
  it('EMAIL 9건', () => {
    for (const [name, s, expected] of GOLDEN_EMAIL) {
      expect(inferAuthorType(seq(s), 'EMAIL'), name).toBe(expected);
    }
  });
});

describe('normalizeSectionChain × 골든 DM 10건 — 명시 승인된 변화만', () => {
  it('순서 보존 · footer 부착 4건 · cta 최소 보장 1건(조선미녀) · hero 최소 보장 2건(지그재그·에이블리) · 상한 초과 제거 0건', () => {
    const footerAppended: string[] = [];
    const ctaAdded: string[] = [];
    const heroAdded: string[] = [];
    // 원본 중간 순서(header/footer 제외)는 정규화 결과의 부분 수열이다 — 최소 보장(hero 앞·cta 뒤)만 끼어든다
    const isSubsequence = (needle: string[], hay: string[]) => {
      let i = 0;
      for (const t of hay) if (i < needle.length && needle[i] === t) i++;
      return i === needle.length;
    };
    for (const [name, s] of GOLDEN_DM) {
      const original = seq(s);
      const normalized = normalizeSectionChain(original);
      const mid = (arr: string[]) => arr.filter((t) => t !== 'header' && t !== 'footer');
      expect(isSubsequence(mid(original), mid(normalized)), name).toBe(true);
      const notes = normalizationNotes(original, normalized);
      if (notes.includes('끝에 footer가 붙습니다')) footerAppended.push(name);
      if (notes.includes('cta가 최소 구성으로 추가됩니다')) ctaAdded.push(name);
      if (notes.includes('hero가 최소 구성으로 추가됩니다')) heroAdded.push(name);
      expect(notes.filter((n) => n.includes('상한 초과')), name).toEqual([]);
      expect(notes.filter((n) => n.includes('최소 구성') && !n.startsWith('cta') && !n.startsWith('hero')), name).toEqual([]);
    }
    expect(footerAppended.sort()).toEqual(['3CE', '무신사', '유니클로', '지그재그'].sort());
    expect(ctaAdded).toEqual(['조선미녀']);
    expect(heroAdded.sort()).toEqual(['에이블리', '지그재그'].sort());
  });
});

describe('deriveSkeletonStats · buildSkeletonContent', () => {
  it('DM 10건 통계 — n·len·by_type·상한 없음', () => {
    const stats = deriveSkeletonStats(chainsOf(GOLDEN_DM, 'dm'));
    expect(stats.n).toBe(10);
    expect(stats.len).toEqual({ p50: 10, min: 7, max: 12 });
    expect(stats.by_type).toEqual({ media: 5, catalog: 5 });
    expect(stats.freq.product_carousel).toBe(0.9); // 무신사만 product_carousel이 없다(실물)
    expect(stats.opening[0]).toEqual(['header', 'hero', 0.6]);
    expect(stats.closing[0]).toEqual(['footer', 0.6]);
    expect(JSON.stringify(stats)).not.toMatch(/maxCount|cap/);
  });
  it('content에 유형 라벨·브랜드명이 없다', () => {
    const stats = deriveSkeletonStats(chainsOf(GOLDEN_DM, 'dm'));
    const text = buildSkeletonContent(stats, 'DM');
    expect(text).toMatch(/섹션 수: 보통 10개\(7~12\)/);
    expect(text).not.toMatch(/media|catalog|조선미녀|무신사|유니클로/);
  });
  it('빈 chains = n 0 · 빈 통계(예외 없음)', () => {
    const stats = deriveSkeletonStats([]);
    expect(stats.n).toBe(0);
    expect(stats.len).toEqual({ p50: 0, min: 0, max: 0 });
  });
});

describe('renderStructureBlock — 통계만, 원문 0', () => {
  it('stats 없음 = 빈 문자열(현행 프롬프트와 문자 단위 동일)', () => {
    expect(renderStructureBlock(null)).toBe('');
    expect(renderStructureBlock(deriveSkeletonStats([]))).toBe('');
  });
  it('출력에 URL·브랜드명·시퀀스 원문(>)·유형 라벨이 없다', () => {
    const block = renderStructureBlock(deriveSkeletonStats(chainsOf(GOLDEN_EMAIL, 'email')));
    expect(block).toContain('참조 골격 9건');
    expect(block).not.toMatch(/https?:|www\.|조선미녀|무신사|쿠팡|media|catalog|>/);
  });
});

describe('reduceStructure — 더하기 없음', () => {
  const base = seq('header>hero>countdown>product_carousel>youtube_embed>sns>coupon>cta>footer');
  it('avail 전부 unknown = 항등', () => {
    const r = reduceStructure(base, AVAIL_UNKNOWN);
    expect(r.types).toEqual(base);
    expect(r.removed).toEqual([]);
  });
  it('absent 축만 빠지고 반환은 부분집합', () => {
    const avail: Avail = { products: 'absent', benefit: 'absent', embeds: 'absent', social: 'absent' };
    const r = reduceStructure(base, avail);
    expect(r.types).toEqual(seq('header>hero>cta>footer'));
    expect(r.removed.sort()).toEqual(['countdown', 'coupon', 'product_carousel', 'sns', 'youtube_embed'].sort());
    for (const t of r.types) expect(base).toContain(t);
    expect(r.types.length).toBeLessThanOrEqual(base.length);
  });
  it('present는 유지', () => {
    const r = reduceStructure(base, { products: 'present', productCount: 2, benefit: 'present', embeds: 'unknown', social: 'unknown' });
    expect(r.types).toEqual(base);
  });
});

describe('resolveStructure — 사다리·결정성', () => {
  const learned = appendChains(emptySkeletonMeta(), chainsOf(GOLDEN_DM, 'dm')).meta;
  it('human > scenario > learned', () => {
    const human = seq('header>hero>cta>footer');
    const scenario = seq('header>coupon>cta>footer');
    expect(resolveStructure({ human, scenario, learned, variant: 'media', seed: 's', avail: AVAIL_UNKNOWN }))
      .toMatchObject({ types: human, source: 'human', chainIdx: null });
    expect(resolveStructure({ scenario, learned, variant: 'media', seed: 's', avail: AVAIL_UNKNOWN }))
      .toMatchObject({ types: scenario, source: 'scenario', chainIdx: null });
    const r = resolveStructure({ learned, variant: 'media', seed: 's', avail: AVAIL_UNKNOWN });
    expect(r.source).toBe('learned');
    expect(r.chainIdx).not.toBeNull();
    expect(learned.chains[r.chainIdx as number].author_type).toBe('media');
  });
  it('어느 축도 없으면 null(ai) — 호출부가 기존 경로', () => {
    expect(resolveStructure({ learned: null, variant: 'media', seed: 's', avail: AVAIL_UNKNOWN }))
      .toEqual({ types: null, source: 'ai', chainIdx: null, removed: [] });
    expect(resolveStructure({ learned: emptySkeletonMeta(), variant: 'media', seed: 's', avail: AVAIL_UNKNOWN }).types).toBeNull();
  });
  it('같은 seed = 100회 동일 · seed가 다르면 한 값에 고정되지 않는다', () => {
    const first = resolveStructure({ learned, variant: 'catalog', seed: 'company:행사:2026-09-03', avail: AVAIL_UNKNOWN });
    for (let i = 0; i < 100; i++) {
      expect(resolveStructure({ learned, variant: 'catalog', seed: 'company:행사:2026-09-03', avail: AVAIL_UNKNOWN })).toEqual(first);
    }
    const idxs = new Set<number>();
    for (let i = 0; i < 40; i++) {
      idxs.add(resolveStructure({ learned, variant: 'catalog', seed: `c:${i}:2026-09-03`, avail: AVAIL_UNKNOWN }).chainIdx as number);
    }
    expect(idxs.size).toBeGreaterThan(1);
  });
  it('유형이 없으면 전체에서 고른다 · 감산 결과가 reduced로 실린다', () => {
    const onlyMedia = appendChains(emptySkeletonMeta(), chainsOf(GOLDEN_DM.slice(0, 5), 'dm')).meta;
    const r = resolveStructure({ learned: onlyMedia, variant: 'catalog', seed: 'x', avail: { products: 'absent', benefit: 'absent', embeds: 'absent', social: 'absent' } });
    expect(r.source).toBe('learned');
    expect(r.types).not.toContain('product_carousel');
    expect(r.removed.length).toBeGreaterThan(0);
  });
});

describe('pickVariant · stableHash', () => {
  it('상품 3개 이상 = catalog · 미만 = media · 모르면 해시 교대', () => {
    expect(pickVariant({ ...AVAIL_UNKNOWN, products: 'present', productCount: 3 }, 's')).toBe('catalog');
    expect(pickVariant({ ...AVAIL_UNKNOWN, products: 'present', productCount: 2 }, 's')).toBe('media');
    const seen = new Set([pickVariant(AVAIL_UNKNOWN, 'a'), pickVariant(AVAIL_UNKNOWN, 'b'), pickVariant(AVAIL_UNKNOWN, 'c'), pickVariant(AVAIL_UNKNOWN, 'd')]);
    expect(seen.size).toBe(2);
  });
  it('stableHash는 결정적·비음수', () => {
    expect(stableHash('한줄로')).toBe(stableHash('한줄로'));
    expect(stableHash('a')).not.toBe(stableHash('b'));
    expect(stableHash('x')).toBeGreaterThanOrEqual(0);
  });
});

describe('appendChains — append · 중복 무시 · serving 보존', () => {
  it('같은 ref.id는 건너뛰고 serving·perf는 그대로', () => {
    const first = appendChains(emptySkeletonMeta(), chainsOf(GOLDEN_DM.slice(0, 3), 'dm'));
    expect(first.added).toBe(3);
    const withServing = { ...first.meta, serving: { enabled: true, enabled_by: 'ceo', enabled_at: '2026-09-03T00:00:00.000Z' } };
    const second = appendChains(withServing, chainsOf(GOLDEN_DM.slice(2, 5), 'dm'));
    expect(second.added).toBe(2);
    expect(second.skippedDuplicate).toBe(1);
    expect(second.meta.chains.length).toBe(5);
    expect(second.meta.serving).toEqual(withServing.serving);
    expect(second.meta.stats.n).toBe(5);
  });
});
