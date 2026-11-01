/**
 * AI 영업 전용 혜택 거름 — 허가 인용문에 **글자 그대로** 있는 혜택 덩어리만 남긴다.
 *
 * ★ 2026-11-01 여정 재발 방지 설계 B1-1(docs/2026-11-01-journey-recurrence-prevention-design.md)
 *   공용 탐지기(`copy-benefit-detector.ts`)의 혜택 판정은 값 · 종류 짝 하나(`findInventedBenefits` · `replaceInventedBenefits`)로 모였다.
 *   영업 모듈만 「허가 인용문에 글자 그대로 있는 덩어리만」을 일부러 쓴다(LESSONS 1018 R1) — 그래서 옛 몸통을
 *   이 파일로 옮겼다(원본 복사 · 동작 같음 · 옛 공용 이름은 지움). 영업 파일 밖에서 부르지 않는다(뿌리 대장 R33).
 */
import { findBenefitSpans, BENEFIT_PLACEHOLDER } from './copy-benefit-detector';

/**
 * **AI가 지어낸 구체 혜택을 자리째 되돌린다.**
 *
 * 프롬프트는 경계가 아니다 — "구체 혜택을 쓰지 마라"는 지시를 어긴 응답은 그대로 저장·발송될 수 있다.
 * @param originalBody 허가 인용문. **여기 그대로 있던 것만** 남는다.
 *   비우면 구체 혜택은 전부 placeholder가 된다 — 지어낼 근거가 없기 때문이다.
 */
export function stripUnlicensedQuoteBenefits(message: string, originalBody = ''): string {
  const text = String(message || '');
  if (!text.trim()) return text;

  const spans = findBenefitSpans(text);
  if (spans.length === 0) return text;

  // ⛔ 원본도 **같은 파서로** 자리를 뽑아 자리끼리 대조한다 (Codex 5R).
  //   `includes`로 보면 출력의 '5% 할인'이 원본 '15% 할인' 한가운데 걸려 다른 금액인데도 통과한다.
  //   비교 키는 공백만 정리한다(줄바꿈으로 쓴 '무료\n배송'과 '무료 배송'은 같은 자리다).
  //   ⚠ 한계 — 원본이 "무료배송은 제공하지 않습니다"여도 그 자리는 근거로 인정된다.
  //     부정 문맥 판정은 다시 열린 문제라 여기서 풀지 않는다. 다듬기는 사람이 후보를 골라 넣는 흐름이라 그 자리에서 걸러진다.
  const spanKey = (t: string) => t.replace(/\s+/g, ' ').trim();
  const allowed = new Set(findBenefitSpans(String(originalBody || '')).map((s) => spanKey(s.text)));
  const invented = spans.filter((s) => !allowed.has(spanKey(s.text)));
  if (invented.length === 0) return text;

  // 뒤에서부터 바꾼다 — 앞을 먼저 바꾸면 뒤 자리의 위치가 밀린다.
  let out = text;
  for (const s of invented.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + BENEFIT_PLACEHOLDER + out.slice(s.end);
  }
  // 붙어 버린 placeholder 중복 정리.
  const dup = BENEFIT_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return out.replace(new RegExp(`(?:${dup})(?:[\\s,]*${dup})+`, 'g'), BENEFIT_PLACEHOLDER);
}
