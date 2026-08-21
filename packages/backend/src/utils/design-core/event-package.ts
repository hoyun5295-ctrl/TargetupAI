/**
 * ★ CT design-core/event-package.ts — 행사 자동 완성 템플릿 선택기 (디자인 4.0 M5, 2026-07-14)
 *
 * 행사 원문(정규화 텍스트)의 성격 → 정예 골든 템플릿 결정적 매칭. 임의 산식 0 — 키워드 표만.
 * 대상 = event_text 데이터 슬롯을 가진 행사 적합 템플릿 3종(마감 세일/신상 발표/행사 초대).
 * 주입 = 3채널 생성기 프롬프트에 스토리 구조 힌트 1블록(buildEventTemplateHintBlock).
 *   빈 행사 원문 = '' 반환 → 기존 생성 경로 그대로(선택기 우회 폴백 — 회귀 0).
 * 검증(가격·URL verbatim·혜택 실존)은 기존 event-brief 게이트가 그대로 담당 — 여기선 무접촉.
 */
import { getGoldenTemplate, type CoreGoldenTemplate } from './template-registry';

/** 마감/시한 신호 — 손실 회피 골격(deadline-sale) */
const DEADLINE_RE = /마감|한정|오늘만|이번\s*주말|D-\d|디데이|까지만|선착순|얼리버드|타임\s*세일|품절\s*임박/;
/** 신상 공개 신호 — 비주얼 공개 골격(new-arrival) */
const NEW_ARRIVAL_RE = /신상|신제품|새\s*상품|뉴\s*컬렉션|컬렉션\s*공개|출시|입고|런칭|론칭|첫\s*공개/;

export type EventTemplateMatch = {
  template: CoreGoldenTemplate;
  /** 어떤 신호로 골랐는지 — 결정 근거(디버그·로그용, 사용자 노출 아님) */
  matchedBy: 'deadline' | 'new_arrival' | 'default_invite';
};

/**
 * 행사 원문 → 정예 템플릿 결정적 매칭.
 * 우선순위: 마감 신호 > 신상 신호 > 기본(행사 초대). 빈 원문 = null(선택기 우회).
 */
export function selectGoldenTemplateForEvent(eventText: string | null | undefined): EventTemplateMatch | null {
  const text = (eventText || '').trim();
  if (!text) return null;
  if (DEADLINE_RE.test(text)) {
    const t = getGoldenTemplate('deadline-sale');
    if (t) return { template: t, matchedBy: 'deadline' };
  }
  if (NEW_ARRIVAL_RE.test(text)) {
    const t = getGoldenTemplate('new-arrival');
    if (t) return { template: t, matchedBy: 'new_arrival' };
  }
  const t = getGoldenTemplate('event-invite');
  return t ? { template: t, matchedBy: 'default_invite' } : null;
}

/**
 * 행사 원문 → 3채널 생성기 프롬프트 주입 블록.
 * 스토리 구조·조판 방향만 힌트 — 혜택·사실은 event-brief 원문 규칙이 계속 지배.
 * 빈 원문 = '' (기존 프롬프트 완전 무변 — 롤백 = 호출 1줄 제거).
 */
export function buildEventTemplateHintBlock(eventText: string | null | undefined): string {
  const match = selectGoldenTemplateForEvent(eventText);
  if (!match) return '';
  const t = match.template;
  return `[정예 템플릿 힌트: 이 행사에 어울리는 스토리 구조]
- 템플릿: ${t.label}
- 스토리 순서: ${t.story.logic}
- 조판 방향: '${t.design.palette}' 테마 계열 (색·서체는 회사 브랜드 설정이 항상 우선)
- 위 순서를 골격으로 삼되, 혜택·기간·가격은 여전히 행사 원문에 있는 내용만 사용한다.`;
}
