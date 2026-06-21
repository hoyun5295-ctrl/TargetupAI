/**
 * dm-section-layout.ts — AI가 설계한 섹션 chain의 안전 정규화 (순수, DB import 0)
 *
 * AI(dm-ai.designSectionLayout)가 콘텐츠 기반으로 섹션 타입 순서를 제안하면,
 * 발송 가능한 형태로 가드한다: header 맨 앞·footer 맨 끝·유효 타입만·maxCount 준수·최소 전환 보장.
 * 빠른 시작 시나리오(SCENARIO_MAP)는 고정이라 이 경로를 안 탄다 — 자유 프롬프트 전용.
 */
import { SECTION_META, isValidSectionType, type SectionType } from './dm-section-registry';

/**
 * AI 제안 섹션 타입 배열 → 안전한 chain.
 * - 유효 타입만(미지원 제거)
 * - header 1개를 맨 앞, footer 1개를 맨 끝(없으면 보강, 여럿이면 1개)
 * - 중간 섹션 순서 보존 + 타입별 maxCount 준수(초과분 제거)
 * - cta 최소 1개 보장(전환 동선), 콘텐츠 섹션(hero/text_card) 최소 1개 보장
 */
export function normalizeSectionChain(types: SectionType[], _objective?: string): SectionType[] {
  const valid = (Array.isArray(types) ? types : []).filter(isValidSectionType);
  const middleRaw = valid.filter((t) => t !== 'header' && t !== 'footer');

  const counts: Record<string, number> = {};
  const middle: SectionType[] = [];
  for (const t of middleRaw) {
    const max = SECTION_META[t].maxCount;
    counts[t] = (counts[t] || 0) + 1;
    if (counts[t] <= max) middle.push(t);
  }

  // 콘텐츠 섹션 최소 보장(맨 앞) — 빈/빈약한 제안도 휑하지 않게
  if (!middle.some((t) => t === 'hero' || t === 'text_card')) middle.unshift('hero');
  // 전환 동선 최소 보장
  if (!middle.includes('cta')) middle.push('cta');

  return ['header', ...middle, 'footer'];
}
