/**
 * 문안 placeholder 판정·치환 — 단일 정의 (2026-08-08)
 *
 * 왜 있나
 *   AI 문안의 `[혜택 안내 — 직접 수정해주세요]`·`[URL 입력]`을 사용자가 **본문에서 직접 고치게** 시키고 있었다
 *   (Harold 접수 — 문장 안에서 자리를 찾아 지우고 이어 붙이는 텍스트 수술).
 *   혜택과 링크는 AI가 못 지어내는 값이라 사용자 입력이 정당한 자리다 — 값만 받고 치환은 기계가 한다.
 *
 * 패턴 규약
 *   시스템이 **실제로 심는 표기**만 잡는다. 넓히면 정상 문구를 지운다.
 *   - 혜택: 대괄호 안에 "혜택" + 완전한 안내 문구("직접 수정해주세요" 또는 "직접 작성해주세요").
 *     ⛔ 키워드 낱개('직접')로 넓히지 않는다 — `[혜택은 앱에서 직접 확인하세요]` 같은 정상 안내문이
 *     placeholder로 오인돼 값 하나로 통째 치환된다(Codex 1R 실결함).
 *   - 링크: `[URL 입력]` 고정 표기(생성기 프롬프트가 심는 값). 대소문자·공백만 관용한다.
 *   백엔드 차단기가 심는 값(`copy-benefit-detector.ts BENEFIT_PLACEHOLDER`)과의 일치는
 *   parity 테스트가 실제 값 대조로 고정한다(journey-benefit-input.test.ts).
 */

const BENEFIT_PLACEHOLDER_SOURCE = '\\[[^\\[\\]\\n]*혜택[^\\[\\]\\n]*직접\\s*(?:수정|작성)해\\s*주세요[^\\[\\]\\n]*\\]';
const URL_PLACEHOLDER_SOURCE = '\\[\\s*URL\\s*입력\\s*\\]';

/** 본문에 혜택 placeholder가 남아 있는가. */
export function hasBenefitPlaceholder(text: string | null | undefined): boolean {
  // /g 플래그의 lastIndex 공유를 피하려고 매번 새로 만든다.
  return new RegExp(BENEFIT_PLACEHOLDER_SOURCE).test(String(text || ''));
}

/** 본문에 링크 placeholder가 남아 있는가. */
export function hasUrlPlaceholder(text: string | null | undefined): boolean {
  return new RegExp(URL_PLACEHOLDER_SOURCE, 'i').test(String(text || ''));
}

/** placeholder 전부를 입력한 혜택으로 치환한다. 혜택이 비면 원문 그대로. */
export function fillBenefitPlaceholders(text: string | null | undefined, benefit: string): string {
  const src = String(text || '');
  const value = String(benefit || '').trim();
  if (!value) return src;
  return src.replace(new RegExp(BENEFIT_PLACEHOLDER_SOURCE, 'g'), value);
}

/** placeholder 전부를 입력한 링크로 치환한다. 링크가 비면 원문 그대로. */
export function fillUrlPlaceholders(text: string | null | undefined, url: string): string {
  const src = String(text || '');
  const value = String(url || '').trim();
  if (!value) return src;
  return src.replace(new RegExp(URL_PLACEHOLDER_SOURCE, 'gi'), value);
}

/**
 * 발송 문안에 넣어도 되는 링크인가 — `http(s)://` 로 시작하는 것만.
 * ⛔ 우리가 스킴을 붙여 주지 않는다: 사용자가 의도한 주소가 아닐 수 있고,
 *   틀린 링크는 발송 뒤에 되돌릴 수 없다. 형식이 아니면 넣지 않고 알린다.
 */
export function isSendableUrl(url: string | null | undefined): boolean {
  const value = String(url || '').trim();
  if (!value || /\s/.test(value)) return false;
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(value);
}
