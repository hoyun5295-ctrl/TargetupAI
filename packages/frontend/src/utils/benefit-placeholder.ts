/**
 * 혜택 placeholder 판정·치환 — 단일 정의 (2026-08-08)
 *
 * 왜 있나
 *   AI 문안의 `[혜택 안내 — 직접 수정해주세요]`를 사용자가 **본문 텍스트에서 직접 고치게** 시키고 있었다
 *   (Harold 접수 — 문장 안에서 자리를 찾아 지우고 이어 붙이는 텍스트 수술). 혜택은 AI가 못 지어내는
 *   유일한 값이라 입력이 정당한 자리다 — 값만 받고 치환은 기계가 한다.
 *
 * 패턴 규약
 *   대괄호 안에 "혜택"과 **완전한 안내 문구**("직접 수정해주세요" 또는 "직접 작성해주세요")가
 *   함께 있는 토큰만 placeholder다. 시스템이 실제로 심는 표기 두 벌(여정 '수정해' · 인앱 '작성해' — 실측)이 기준이다.
 *   - ⛔ 키워드 낱개('직접')로 넓히지 않는다 — `[혜택은 앱에서 직접 확인하세요]` 같은 **정상 안내문**이
 *     placeholder로 오인돼 혜택 값 하나로 통째로 치환된다(Codex 1R 실결함).
 *   - `[URL 입력]`은 혜택이 아니다 — 건드리지 않는다.
 *   백엔드 차단기가 심는 값(`copy-benefit-detector.ts BENEFIT_PLACEHOLDER`)과의 일치는
 *   parity 테스트가 실제 값 대조로 고정한다(journey-benefit-input.test.ts).
 */

const BENEFIT_PLACEHOLDER_SOURCE = '\\[[^\\[\\]\\n]*혜택[^\\[\\]\\n]*직접\\s*(?:수정|작성)해\\s*주세요[^\\[\\]\\n]*\\]';

/** 본문에 혜택 placeholder가 남아 있는가. */
export function hasBenefitPlaceholder(text: string | null | undefined): boolean {
  // /g 플래그의 lastIndex 공유를 피하려고 매번 새로 만든다.
  return new RegExp(BENEFIT_PLACEHOLDER_SOURCE).test(String(text || ''));
}

/** placeholder 전부를 입력한 혜택으로 치환한다. 혜택이 비면 원문 그대로. */
export function fillBenefitPlaceholders(text: string | null | undefined, benefit: string): string {
  const src = String(text || '');
  const value = String(benefit || '').trim();
  if (!value) return src;
  return src.replace(new RegExp(BENEFIT_PLACEHOLDER_SOURCE, 'g'), value);
}
