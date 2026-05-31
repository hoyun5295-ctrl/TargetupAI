/**
 * ★ CT: AI 응답 JSON 안전 추출 컨트롤타워 (D227+ AI Operator 본문 0 bytes 사고 정정)
 *
 * 사고 배경
 *   generateMessages 등 AI 호출부가 각자 인라인으로 코드펜스(```json)만 벗겨 JSON.parse 했다.
 *   AI(Opus)가 Brand Voice few-shot 학습 후 코드펜스 없이 설명/본문을 섞어 응답하면
 *   `JSON.parse(원문)`이 첫 글자(예: '%')에서 SyntaxError → catch → 잘못된 fallback → 본문 빈 채 노출.
 *   (운영 로그 2026-05-31: `Unexpected token '%', "%고객명%님, 안녕"... is not valid JSON`)
 *
 * 본 컨트롤타워
 *   1. 코드펜스(```json / ```) 있으면 우선 추출
 *   2. 없으면 설명문이 앞뒤로 섞여도 첫 '{'~마지막 '}' (또는 '['~']') 구간만 잘라 parse
 *   3. 그래도 실패 시 throw (호출부 catch가 fallback 처리 — 단 fallback은 올바른 필드명 의무)
 *
 * 영구 원칙
 *   - 인라인 JSON 추출 정의 금지 — AI 호출부는 모두 본 함수 import 사용
 */

/**
 * AI 응답 텍스트에서 JSON 객체/배열을 안전하게 추출 + parse.
 * @throws 추출/parse 실패 시 Error (호출부 catch에서 fallback 처리)
 */
export function extractJsonFromAiText<T = any>(text: string): T {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('extractJsonFromAiText: 빈 AI 응답');
  }

  let s = text.trim();

  // 1) 코드펜스 우선 추출 (```json ... ``` 또는 ``` ... ```)
  const fenceJson = s.match(/```json\s*([\s\S]*?)```/i);
  if (fenceJson && fenceJson[1].trim()) {
    s = fenceJson[1].trim();
  } else {
    const fenceAny = s.match(/```\s*([\s\S]*?)```/);
    if (fenceAny && fenceAny[1].trim()) {
      s = fenceAny[1].trim();
    }
  }

  // 2) 설명문 혼입 방어 — 첫 '{'~마지막 '}' 또는 첫 '['~마지막 ']' 구간만 추출
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  let start = -1;
  let endChar = '}';
  if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) {
    start = firstObj;
    endChar = '}';
  } else if (firstArr >= 0) {
    start = firstArr;
    endChar = ']';
  }
  if (start >= 0) {
    const end = s.lastIndexOf(endChar);
    if (end > start) {
      s = s.slice(start, end + 1);
    }
  }

  return JSON.parse(s) as T;
}
