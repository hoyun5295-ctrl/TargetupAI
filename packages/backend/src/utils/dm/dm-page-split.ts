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

/**
 * 섹션 배열을 레이아웃 모드별 페이지 그룹으로 분할.
 *   - scroll : 전체를 한 페이지로 (세로 스크롤)
 *   - slides : [header+hero 인트로] / 콘텐츠 섹션 각 1장 / footer는 마지막 장에 병합
 * 원본 배열은 변형하지 않는다(순수).
 */
export function splitSectionsIntoPages(sections: Section[], mode: DmLayoutMode): Section[][] {
  if (mode !== 'slides' || sections.length === 0) return [sections];

  const pages: Section[][] = [];

  // 1) 앞쪽 연속된 header/hero를 인트로 한 장으로
  let i = 0;
  const intro: Section[] = [];
  while (i < sections.length && INTRO_TYPES.includes(sections[i].type)) {
    intro.push(sections[i]);
    i++;
  }
  if (intro.length) pages.push(intro);

  // 2) 나머지 — 끝의 footer는 따로 떼어 마지막 장에 붙인다(단독 footer 슬라이드 방지)
  const rest = sections.slice(i);
  let footer: Section | null = null;
  if (rest.length > 0 && rest[rest.length - 1].type === 'footer') {
    footer = rest[rest.length - 1];
    rest.pop();
  }

  // 3) 콘텐츠 섹션 각 1장
  for (const sec of rest) pages.push([sec]);

  // 4) footer는 마지막 장에 병합(장이 없으면 단독)
  if (footer) {
    if (pages.length > 0) pages[pages.length - 1].push(footer);
    else pages.push([footer]);
  }

  // 5) 안전망 — 어떤 이유로든 비면 전체 한 장
  if (pages.length === 0) pages.push(sections);

  return pages;
}
