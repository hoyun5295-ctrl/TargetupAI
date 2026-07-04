// copy-best-ranker.ts — cold-start 문안 베스트 선별(순수). 성과 데이터가 없어도 작동한다.
//   Tier 0 신호(지금): 사람 선택(final_source) + 저스팸(spam_blocked) + 구조 루브릭(CTA).
//   Tier 1/2(클릭·전환)는 성과 신호가 쌓이면 successRate 가중으로 자연 상승(설계 §6).
import { hasCta } from './copy-text-metrics';

export interface CandidateRow {
  final_message: string;
  final_source?: string | null; // 'manual' | 'selected_as_is' | 'edited'
  spam_blocked?: number | null;  // >0 = 스팸 걸린 이력
  sent_count?: number | null;
  success_count?: number | null;
}

export interface RankedCandidate {
  text: string;
  score: number;
}

/** cold-start 종합 점수. 임의 상수로 채우지 않고, 있는 신호만 가감(없으면 폴백). */
export function scoreCandidate(row: CandidateRow): number {
  let score = 0;
  // 사람 선택 신호(Tier 0): 실무자가 고른/수정한 문안 우대
  const fs = row.final_source || '';
  if (fs === 'selected_as_is' || fs === 'edited') score += 0.3;
  else if (fs === 'manual') score += 0.15;
  // 스팸 이력: 없으면 우대, 있으면 강한 감점
  if ((row.spam_blocked || 0) > 0) score -= 0.5;
  else score += 0.2;
  // 성과(있을 때만): successRate 가산 (Tier 1/2 승급 지점)
  const sent = row.sent_count || 0;
  if (sent > 0) score += Math.min((row.success_count || 0) / sent, 1) * 0.4;
  // 구조 루브릭: CTA 포함
  if (hasCta(row.final_message || '')) score += 0.15;
  return score;
}

/** 점수 내림차순 상위 N. 동점은 입력 순서 유지. 빈 본문 제외, 텍스트 dedup. */
export function rankBestCandidates(rows: CandidateRow[], limit: number): RankedCandidate[] {
  const scored = rows
    .map((r, i) => ({ text: (r.final_message || '').trim(), score: scoreCandidate(r), i }))
    .filter((x) => x.text.length > 0);
  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));

  const seen = new Set<string>();
  const out: RankedCandidate[] = [];
  for (const s of scored) {
    const key = s.text.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: s.text, score: s.score });
    if (out.length >= limit) break;
  }
  return out;
}
