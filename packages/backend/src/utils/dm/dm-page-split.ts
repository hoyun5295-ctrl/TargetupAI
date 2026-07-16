/**
 * dm-page-split.ts — DM 레이아웃 모드 결정 + 페이지 분할 순수 코어 (DB/IO 의존 0)
 *
 * AI 자동생성·편집 토글 양쪽이 같은 규칙으로 페이지를 나눈다.
 * 순수 함수라 node:assert + ts-node로 단위 검증한다(__tests__/dm-page-split.verify.ts).
 */
import type { Section, SectionType } from './dm-section-registry';

export type DmLayoutMode = 'scroll' | 'slides';

/** 페이지를 별도 슬라이드로 쪼개면 좋은 시각 콘텐츠 섹션 — 하나라도 있으면 슬라이드 모드 권장 */
const SLIDE_TRIGGER_TYPES: SectionType[] = ['product_carousel', 'gallery', 'slideshow'];
/** 앞쪽 인트로로 한 장에 묶는 섹션 */
const INTRO_TYPES: SectionType[] = ['header', 'hero'];

/**
 * 섹션 구성으로 레이아웃 모드를 자동 결정.
 * 시각 카드형(상품 슬라이드·갤러리·슬라이드쇼)이 하나라도 있으면 slides, 아니면 scroll.
 * 시나리오·자연어 공통 — 내용 기반이라 하드 매핑보다 견고하다.
 */
export function decideLayoutMode(sections: Section[]): DmLayoutMode {
  return sections.some((s) => SLIDE_TRIGGER_TYPES.includes(s.type)) ? 'slides' : 'scroll';
}

// ★ 2026-07-16 M2 슬라이드 스토리보드 — 혼자서도 한 장을 꽉 채우는 "리치" 섹션
//   (상품·이미지·영상·인터랙션 = 자체 콘텐츠 밀도 보유). 그 외 "얇은" 섹션은 단독 장 금지.
const RICH_SOLO_TYPES: SectionType[] = [
  'product_carousel', 'gallery', 'slideshow', 'video', 'youtube_embed', 'instagram_embed',
  'survey', 'roulette', 'lucky_draw', 'reviews', 'map_store_locator', 'tab_cards',
];

/** 섹션이 단독으로 한 장을 채울 밀도인지 — 콘텐츠 개수까지 검사 (빈 캐러셀은 리치 아님) */
export function isRichSolo(s: Section): boolean {
  if (!RICH_SOLO_TYPES.includes(s.type)) return false;
  const p: any = s.props || {};
  if (s.type === 'product_carousel') return Array.isArray(p.products) && p.products.length >= 2;
  if (s.type === 'gallery') return Array.isArray(p.images) && p.images.length >= 1;
  if (s.type === 'slideshow') return Array.isArray(p.slides) && p.slides.length >= 1;
  return true;
}

/** 얇은 섹션 묶음 상한 — 한 장에 2~3개가 알찬 밀도 (1개 = 헐렁, 4개+ = 스크롤 유발) */
const THIN_PAGE_MAX = 3;

/**
 * 섹션 배열을 레이아웃 모드별 페이지 그룹으로 분할.
 *   - scroll : 전체를 한 페이지로 (세로 스크롤)
 *   - slides : ★ 2026-07-16 M2 스토리보드 — 표지(header+hero+직후 countdown) /
 *              리치 섹션(상품·이미지·인터랙션) 단독 장 / 얇은 섹션은 2~3개 묶음 장 /
 *              끝의 홀로 남은 얇은 장·footer는 앞 장에 병합. "섹션 1개짜리 헐렁한 장"이
 *              구조적으로 안 나온다 (설계서 §2-3 밀도 규칙 — 계약 테스트 고정).
 * 원본 배열은 변형하지 않는다(순수).
 */
export function splitSectionsIntoPages(sections: Section[], mode: DmLayoutMode): Section[][] {
  if (mode !== 'slides' || sections.length === 0) return [sections];

  const pages: Section[][] = [];

  // 1) 표지 — 앞쪽 연속 header/hero가 "hero(비주얼 앵커)를 포함할 때만" 표지 장.
  //    header 단독은 표지가 못 된다(헐렁) — 얇은 흐름에 합류시켜 다음 콘텐츠와 묶는다.
  let i = 0;
  const leading: Section[] = [];
  while (i < sections.length && INTRO_TYPES.includes(sections[i].type)) {
    leading.push(sections[i]);
    i++;
  }
  const hasHero = leading.some((s) => s.type === 'hero');
  const intro: Section[] = hasHero ? [...leading] : [];
  if (hasHero && i < sections.length && sections[i].type === 'countdown') {
    intro.push(sections[i]);
    i++;
  }
  if (intro.length) pages.push(intro);

  // 2) 나머지 — 끝의 footer는 따로 떼어 마지막 장에 붙인다(단독 footer 슬라이드 방지)
  const rest = hasHero ? sections.slice(i) : [...leading, ...sections.slice(i)];
  let footer: Section | null = null;
  if (rest.length > 0 && rest[rest.length - 1].type === 'footer') {
    footer = rest[rest.length - 1];
    rest.pop();
  }

  // 3) 스토리보드 — 리치는 단독 장, 얇은 섹션은 2~3개 묶음
  let thinBuffer: Section[] = [];
  const flushThin = () => {
    if (thinBuffer.length > 0) {
      pages.push(thinBuffer);
      thinBuffer = [];
    }
  };
  for (const sec of rest) {
    if (isRichSolo(sec)) {
      // ★ Codex 1R — 리치 직전에 얇은 섹션 1개가 홀로 남으면 리치 장에 동승 (인트로 텍스트+상품 = 자연 밀도.
      //   홀로 flush되던 결함 — "얇은 단독 장 구조적 차단" 불변식 완성)
      if (thinBuffer.length === 1) {
        pages.push([thinBuffer[0], sec]);
        thinBuffer = [];
      } else {
        flushThin();
        pages.push([sec]);
      }
    } else {
      thinBuffer.push(sec);
      if (thinBuffer.length >= THIN_PAGE_MAX) flushThin();
    }
  }
  // 끝에 홀로 남은 얇은 섹션 1개 = 앞 장에 병합 (헐렁한 마지막 장 방지).
  // 단 앞 장이 이미 상한(3)이면 놔둔다 — footer 병합이 2개로 채운다. 리치 단독 장에는 병합 허용(상품 아래 CTA 등 자연스러운 밀도).
  if (thinBuffer.length === 1 && pages.length > 0) {
    const prev = pages[pages.length - 1];
    const prevIsRich = prev.length === 1 && isRichSolo(prev[0]);
    if (prevIsRich || prev.length < THIN_PAGE_MAX) {
      pages[pages.length - 1] = [...prev, thinBuffer[0]];
      thinBuffer = [];
    }
  }
  flushThin();

  // 4) footer는 마지막 장에 병합(장이 없으면 단독)
  if (footer) {
    if (pages.length > 0) pages[pages.length - 1] = [...pages[pages.length - 1], footer];
    else pages.push([footer]);
  }

  // 5) 안전망 — 어떤 이유로든 비면 전체 한 장
  if (pages.length === 0) pages.push(sections);

  return pages;
}
