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
 *   3. parse 실패 시 문자열 내부 raw 제어문자를 escape 후 1회 재파싱 (2026-06-30 회귀 정정).
 *   4. 그래도 실패 시 throw (호출부 catch가 fallback 처리 — 단 fallback은 올바른 필드명 의무)
 *
 * 2026-06-30 회귀(AI Operator fallback 사고): 문안 풍성화 후 AI가 여러 줄 LMS 본문을 응답 JSON에
 *   escape 안 된 raw 줄바꿈(0x0A 등)으로 담으면 JSON.parse가 "Bad control character in string literal"로
 *   거부 → generateMessages가 비상 골격(getFallbackVariants)으로 떨어져 혜택·개인화 전부 무시. AI가 줄바꿈을
 *   escape로 내보낼지 raw로 내보낼지 비결정적이라 같은 프롬프트도 될 때/안 될 때가 생겼다. 본 함수가 문자열
 *   내부 제어문자만 escape해 항상 파싱되게 한다(구조부 공백은 보존).
 *
 * 영구 원칙
 *   - 인라인 JSON 추출 정의 금지 — AI 호출부는 모두 본 함수 import 사용
 */

/**
 * JSON 문자열 리터럴 안의 raw 제어문자(0x00~0x1F)만 escape한다. 구조부(공백/개행)는 그대로 둔다.
 *   문자열 경계는 " 토글로 추적하고, 백슬래시 이스케이프(\" \\ 등)는 건너뛴다.
 *   이미 escape된 \n(역슬래시+n)은 raw 제어문자가 아니므로 건드리지 않는다(이중 escape 방지).
 */
export function escapeControlCharsInJsonStrings(jsonStr: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString) {
      const code = jsonStr.charCodeAt(i);
      if (code < 0x20) {
        switch (ch) {
          case '\n': out += '\\n'; break;
          case '\r': out += '\\r'; break;
          case '\t': out += '\\t'; break;
          case '\b': out += '\\b'; break;
          case '\f': out += '\\f'; break;
          default: out += '\\u' + code.toString(16).padStart(4, '0');
        }
        continue;
      }
    }
    out += ch;
  }
  return out;
}

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

  // 1차 정상 파싱 → 실패 시(문자열 내부 raw 제어문자 등) escape 후 1회 재파싱. 그래도 실패하면 throw.
  try {
    return JSON.parse(s) as T;
  } catch (firstErr) {
    const repaired = escapeControlCharsInJsonStrings(s);
    if (repaired !== s) {
      return JSON.parse(repaired) as T; // 재파싱 실패 시 throw → 호출부 fallback
    }
    throw firstErr;
  }
}
