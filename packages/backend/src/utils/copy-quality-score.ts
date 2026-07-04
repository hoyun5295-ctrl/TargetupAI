// copy-quality-score.ts — 도메인 규칙 + 스팸 위험 + 브랜드 금지어를 통합 채점(순수).
//   문안 두뇌 자기검수 루프가 이 결과로 통과/재생성을 결정한다.
import { checkDomainRules } from './copy-domain-rules';
import { scoreSpamRisk, SPAM_FAIL_THRESHOLD } from './copy-spam-risk';

export function scoreCopy(input: {
  text: string;
  channel: string;
  bannedWords?: string[];
}): { pass: boolean; total: number; feedback: string[] } {
  const feedback: string[] = [];

  const domain = checkDomainRules(input.text, input.channel);
  feedback.push(...domain.violations);

  const spam = scoreSpamRisk(input.text);
  if (spam.score >= SPAM_FAIL_THRESHOLD) {
    feedback.push(`스팸 위험 높음(${spam.hits.join(', ') || '특수문자 과다'})`);
  }

  const banned = (input.bannedWords || []).filter((w) => w && input.text.includes(w));
  if (banned.length > 0) feedback.push(`금지어 사용: ${banned.join(', ')}`);

  const pass = domain.pass && spam.score < SPAM_FAIL_THRESHOLD && banned.length === 0;
  // total: 1에서 위반·위험 차감(랭킹·로그용)
  const total = Math.max(0, 1 - domain.violations.length * 0.2 - spam.score - banned.length * 0.3);
  return { pass, total, feedback };
}
