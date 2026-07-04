// copy-domain-rules.ts — 채널별 문안 규칙(순수).
//   광고표기(광고)·무료수신거부는 발송단에서 시스템이 부착하므로 여기선 미검사(오검 방지).
import { smsByteLength, hasCta } from './copy-text-metrics';

const BYTE_LIMIT: Record<string, number> = { SMS: 90, LMS: 2000, MMS: 2000, KAKAO: 1000 };

export function checkDomainRules(
  text: string,
  channel: string,
): { pass: boolean; violations: string[] } {
  const t = String(text || '');
  const violations: string[] = [];
  const limit = BYTE_LIMIT[channel] ?? 2000;

  const bytes = smsByteLength(t);
  if (bytes > limit) violations.push(`${channel} 바이트 초과(${bytes}/${limit})`);
  if (t.trim().length < 5) violations.push('본문이 너무 짧음');
  if (!hasCta(t)) violations.push('행동 유도(CTA) 표현 없음');

  return { pass: violations.length === 0, violations };
}
