// copy-spam-risk.ts — 스팸 위험 스캔(순수, 로컬 초고속). 시드 사전은 추후 오프라인 마이너가 보강.
// ⚠️ 로컬 사전은 위험 완화용이며 통신사 실제 판정 보장 아님(실제 스팸필터 테스트는 사용자 별도 동작).
export const SPAM_SEED_LEXICON: string[] = [
  '대출', '도박', '카지노', '바카라', '토토', '성인', '19금',
  '당첨', '경품', '공짜', '무료체험', '보장', '수익', '재테크',
  '몸매', '다이어트보장', '최저가보장', '100%',
];

/** 이 점수 이상이면 재생성 유도(스팸 위험 미달). scoreCopy·생성 루프가 공유하는 단일 임계값. */
export const SPAM_FAIL_THRESHOLD = 0.5;

/** 0~1 스팸 위험 점수 + 걸린 신호. 실제 스팸필터 호출 없음(로컬 대조만). */
export function scoreSpamRisk(text: string): { score: number; hits: string[] } {
  const t = String(text || '');
  if (!t.trim()) return { score: 0, hits: [] };
  const hits: string[] = [];
  for (const w of SPAM_SEED_LEXICON) if (t.includes(w)) hits.push(w);

  let score = Math.min(hits.length * 0.25, 0.8);
  // 과도한 특수문자/느낌표 가산
  const bangs = (t.match(/[!★☆♥♡~]/g) || []).length;
  if (bangs >= 4) score += 0.2;
  else if (bangs >= 2) score += 0.1;

  return { score: Math.min(score, 1), hits };
}
