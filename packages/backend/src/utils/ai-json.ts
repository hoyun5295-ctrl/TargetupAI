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
 * ★ 2026-09-30 WP6 — 화면에 글자 그대로 찍히는(whitespace-pre-wrap) AI 자유 답변의 출구.
 *   새 모델은 지시가 있어도 굵은 글씨(**) · 머리글(#) · 목록 기호를 붙이는 일이 잦다. 지시는 확률적이라 출구에서 한 번 더 본다.
 *   글 내용은 바꾸지 않는다. 걷는 것 = 굵게 · 기울임 쌍 표시 · 줄머리 머리글 # · 가로줄 · 코드 울타리 · 인라인 백틱.
 *   줄머리 목록 기호(- * +)는 "· "로 바꾼다. 쌍이 아닌 * 한 글자(예: "*표시 항목")는 둔다.
 */
/**
 * ★ 2026-10-26 Codex 2R — AI JSON 칸을 고객 글로 쓸 때 = 글(또는 숫자)일 때만 · 그 밖(객체 · 배열 · 참거짓)은 fallback.
 *   옛: String(x || '') 라 객체 칸이 「[object Object]」 글이 되어 화면에 나가고 「쓸 결과」로 세어 돈을 걷었다.
 */
export function aiStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

export function plainTextFromAi(text: string): string {
  return String(text || '')
    .replace(/```[a-z]*[ \t]*\n?/gi, '')
    .split('\n')
    .map((line) => line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s*([-*_])(\s*\1){2,}\s*$/, '')
      .replace(/^(\s*)[-*+]\s+/, '$1· '))
    .join('\n')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * AI 응답 텍스트에서 JSON 객체/배열을 안전하게 추출 + parse.
 * @throws 추출/parse 실패 시 Error (호출부 catch에서 fallback 처리)
 */
export function extractJsonFromAiText<T = any>(text: string): T {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    console.warn(`[ai-json] 빈 AI 응답 · at=${aiJsonCaller()}`);
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

  // 1차 정상 파싱 → 실패 시(문자열 내부 raw 제어문자 등) escape 후 1회 재파싱.
  try {
    return JSON.parse(s) as T;
  } catch (firstErr) {
    const repaired = escapeControlCharsInJsonStrings(s);
    if (repaired !== s) {
      try { return JSON.parse(repaired) as T; } catch { /* 아래 = 경고 1줄 + 처음 오류 */ }
    }
    // 3) ★2026-10-26 끝내 못 읽음 = 흔적을 남기고 던진다(호출부 fallback · 조용한 실패 0 · 경위 = 나인 직접발송 맞춤법 「실패」).
    //    덩어리를 건지거나 AI 가 뜻한 덩어리를 짐작하지 않는다 — 건지기 규칙은 반례가 계속 나왔다(Codex 1R~3R:
    //    예시 덩어리 채택 · 깨진 객체의 안쪽 배열 · 깨진 교정 + 예시). 다시 묻기는 호출부 몫(맞춤법 = 1회 · 캐시 0).
    //    답 원문 · 파서 오류 문장(원문 조각이 들어간다)은 남기지 않는다 = 고객 글이 로그로 새지 않게.
    console.warn(`[ai-json] 읽기 실패 · len=${text.length} · at=${aiJsonCaller()}`);
    throw firstErr;
  }
}

/** 실패 로그용 호출 위치(파일:줄 · 원문 0) */
function aiJsonCaller(): string {
  const line = (new Error().stack || '').split('\n')[3] || '';
  return line.trim().replace(/^at\s+/, '').slice(0, 160);
}
