/**
 * season-context.ts — 월별 한국 시즌 달력 + 업종 톤 (자동마케팅 계절 문안 소스)
 *
 * 자동마케팅(Continuous Operator)이 매달 그 달 계절감에 맞는 문안을 생성할 때 쓰는 순수 CT.
 * objective(고정 목표)는 그대로 두고, 계절은 톤·소재로만 프롬프트에 주입한다(§6-8).
 *
 * 참고: journey-ai-generator.ts에도 같은 표가 있으나, 여정 배포분 보호를 위해 이번엔
 *       그 파일을 건드리지 않는다. 추후 journey를 이 CT로 이관 예정(중복 정리 — 별도 작업).
 */

export const SEASON_BY_MONTH: Record<number, { season: string; keywords: string[] }> = {
  1:  { season: '겨울', keywords: ['새해', '새출발', '신년 계획', '추위', '연말정산'] },
  2:  { season: '겨울 끝', keywords: ['설날', '발렌타인데이', '입학 준비', '봄맞이'] },
  3:  { season: '봄', keywords: ['새 학기', '봄꽃', '환절기', '새로운 시작', '화이트데이'] },
  4:  { season: '봄', keywords: ['벚꽃', '봄나들이', '식목일', '야외활동'] },
  5:  { season: '봄 끝', keywords: ['가정의달', '어린이날', '어버이날', '스승의날', '부부의날'] },
  6:  { season: '초여름', keywords: ['호국보훈의달', '현충일', '여름맞이', '장마 준비'] },
  7:  { season: '여름', keywords: ['장마', '바캉스', '휴가', '제헌절'] },
  8:  { season: '여름', keywords: ['휴가 절정', '광복절', '여름 마무리', '개학 준비'] },
  9:  { season: '가을', keywords: ['추석', '한가위', '환절기', '가을맞이'] },
  10: { season: '가을', keywords: ['단풍', '국군의날', '개천절', '한글날'] },
  11: { season: '늦가을', keywords: ['빼빼로데이', '수능', '김장', '겨울맞이'] },
  12: { season: '겨울', keywords: ['크리스마스', '연말', '송년', '새해 준비'] },
};

/** 주어진 시각(UTC)을 KST로 변환해 그 달의 시즌 컨텍스트를 반환. now 인자를 받아 순수 테스트 가능. */
export function getSeasonContext(now: Date): { month: number; season: string; keywords: string[] } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC → KST
  const month = kst.getUTCMonth() + 1;
  const ctx = SEASON_BY_MONTH[month] || { season: '계절', keywords: [] };
  return { month, season: ctx.season, keywords: ctx.keywords };
}

/** orchestrate 문안 생성에 주입할 계절 프롬프트 블록. objective는 불변, 계절은 톤·소재로만. */
export function buildSeasonPromptBlock(month: number, businessType: string | null): string {
  const ctx = SEASON_BY_MONTH[month] || { season: '계절', keywords: [] };
  const biz = businessType && businessType.trim() ? businessType.trim() : '일반';
  return [
    `[이번 달 계절 컨텍스트: KST]`,
    `- 현재 ${month}월 (${ctx.season})`,
    `- 시즌 키워드: ${ctx.keywords.join(', ')}`,
    `- 업종(${biz})에 맞는 톤으로 위 시즌 감성을 자연스럽게 녹이세요.`,
    `- 단, 목표 자체는 바꾸지 마세요. 계절은 인사·소재로만 얹습니다.`,
  ].join('\n');
}

/**
 * 메시지 생성 sub-agent에 넘길 objective 합성 — orchestrate / orchestrateWithAI 공통.
 * seasonHint가 있으면 빈 줄로 이어 붙이고, 없으면 objective 그대로 둔다.
 * objective·타겟·차감은 불변 — 계절 힌트는 문안 생성 입력에만 얹는 용도.
 */
export function buildMessageObjective(objective: string, seasonHint?: string | null): string {
  const obj = (objective || '').trim();
  const hint = (seasonHint || '').trim();
  return hint ? `${obj}\n\n${hint}` : obj;
}
