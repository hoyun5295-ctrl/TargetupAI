// copy-quality-loop.ts — 생성→채점→재생성 오케스트레이터.
//   ⚠️ 절대 생성 미차단: generate/채점 실패 시 초안(또는 최고점)으로 폴백한다.
import { scoreCopy } from './copy-quality-score';

export async function generateWithQualityLoop(input: {
  channel: string;
  bannedWords?: string[];
  maxRounds?: number; // 재생성 상한(기본 2)
  generate: (feedback?: string[]) => Promise<string>;
}): Promise<{ text: string; total: number; rounds: number }> {
  const maxRounds = input.maxRounds ?? 2;
  let best = { text: '', total: -1 };
  let feedback: string[] | undefined;

  for (let round = 0; round <= maxRounds; round++) {
    let draft = '';
    try {
      draft = await input.generate(feedback);
    } catch {
      return { text: best.text, total: Math.max(best.total, 0), rounds: round };
    }
    let s;
    try {
      s = scoreCopy({ text: draft, channel: input.channel, bannedWords: input.bannedWords });
    } catch {
      return { text: draft, total: 0, rounds: round + 1 };
    }
    if (s.total > best.total) best = { text: draft, total: s.total };
    if (s.pass) return { text: draft, total: s.total, rounds: round + 1 };
    feedback = s.feedback;
  }
  return { text: best.text, total: best.total, rounds: maxRounds + 1 };
}
