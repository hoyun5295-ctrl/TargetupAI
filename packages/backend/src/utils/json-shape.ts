/**
 * json-shape.ts — 외부 API 응답의 **구조만** 뽑는 CT (★2026-08-10 신설)
 *
 * 왜 필요한가
 *   네이버·메이크샵 CDP 매핑은 "실데이터로 응답 스키마를 확정한 뒤에 붙인다"가 영구 룰이다(추측 금지).
 *   그래서 preview 엔드포인트가 raw를 PM2 로그로 흘리고 있었는데, **그 raw에는 회원 이름·휴대폰이 그대로 들어간다.**
 *   스키마를 확정하는 데 필요한 것은 값이 아니라 **키 이름과 값의 형식**이다.
 *   값을 남기지 않으면 로그에 개인정보가 쌓이지 않고, 그 출력을 그대로 옮겨 적어도 안전하다.
 *
 * 무엇을 남기고 무엇을 지우는가
 *   - 키 이름 · 중첩 구조 · 배열 길이 · 타입 = 남긴다 (매핑에 필요한 전부)
 *   - 문자열 값 = **마스킹된 형식**만 남긴다. 숫자는 9, 로마자는 a, 그 외 글자(한글 등)는 *,
 *     구분자(-:/T. 공백 등)는 그대로. `2026-08-10T09:30:00` → `9999-99-99T99:99:99`,
 *     `010-1234-5678` → `999-9999-9999`, `홍길동` → `***`.
 *     날짜 형식·전화 형식·코드 자릿수를 그대로 읽을 수 있으면서 내용은 복원되지 않는다.
 *   - 숫자·불리언·null = 타입만.
 *
 * ⛔ 이 함수의 출력에 원본 값이 섞이면 존재 이유가 사라진다. 새 분기를 넣을 때 그 한 줄을 먼저 확인한다.
 */

const MAX_KEYS_PER_OBJECT = 60;
const MAX_STRING_PATTERN = 64;

/**
 * ISO-8601 시각 — `T`·`Z`가 글자가 아니라 **구분자**다. 일반 규칙(로마자 → a)에 맡기면
 * `9999-99-99a99:99:99`가 되어 날짜 형식인지 읽을 수 없다(매핑에서 가장 자주 확인하는 형식이다).
 * 그렇다고 `T`·`Z`를 어디서나 남기면 이름의 첫 글자가 새므로, **시각 모양일 때만** 자릿수만 가린다.
 */
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** 문자열을 형식으로만 남긴다 — 숫자 9 / 로마자 a / 그 외 글자 * / 구분자 원문. */
function maskString(s: string): string {
  const cut = s.length > MAX_STRING_PATTERN ? s.slice(0, MAX_STRING_PATTERN) : s;
  if (ISO_LIKE.test(cut)) return cut.replace(/\d/g, '9');
  let out = '';
  for (const ch of cut) {
    if (ch >= '0' && ch <= '9') out += '9';
    else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) out += 'a';
    else if (/[\s\-_:/.,+@()[\]{}]/.test(ch)) out += ch;   // 구분자는 형식의 일부라 남긴다
    else out += '*';                                        // 한글 등 그 외 글자
  }
  return s.length > MAX_STRING_PATTERN ? `${out}…(len=${s.length})` : `${out}`;
}

/**
 * 값의 구조 서술. 배열은 길이와 **첫 원소의 구조**만(원소마다 구조가 다르면 그건 응답 설계 문제라 따로 본다).
 * depth를 넘으면 `…`로 끊는다 — 깊은 구조를 다 펼치려다 로그 한 줄이 수천 자가 되는 것을 막는다.
 */
export function describeJsonShape(value: unknown, maxDepth = 5, depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (depth >= maxDepth) return `[${value.length}×…]`;
    return `[${value.length}×${describeJsonShape(value[0], maxDepth, depth + 1)}]`;
  }
  const t = typeof value;
  if (t === 'string') return `"${maskString(value as string)}"`;
  if (t === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (t === 'boolean') return 'bool';
  if (t !== 'object') return t;

  if (depth >= maxDepth) return '{…}';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const shown = keys.slice(0, MAX_KEYS_PER_OBJECT);
  const body = shown.map((k) => `${k}: ${describeJsonShape(obj[k], maxDepth, depth + 1)}`).join(', ');
  const more = keys.length > shown.length ? `, …+${keys.length - shown.length}키` : '';
  return `{${body}${more}}`;
}
