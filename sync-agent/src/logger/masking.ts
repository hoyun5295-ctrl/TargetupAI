/**
 * 로그 민감정보 마스킹
 * 전화번호, 이메일, API 키 등을 로그에 기록할 때 부분 마스킹
 */

// ─── 마스킹 규칙 ────────────────────────────────────────

/**
 * 전화번호 마스킹: 01012345678 → 010****5678
 */
/**
 *  - 11자리 이상(010 휴대폰·050X 안심번호·+82 표기): 앞 3 + **** + 뒤 4 (종전 모양 그대로)
 *  - 8~10자리(대표번호 8 · 02 지역 9~10 · 지역·구형 휴대폰 10): **** + 뒤 4
 *    ★2026-09-13(3) 싱크 ⓓ 종전 규칙은 가리는 자릿수가 "자릿수 - 7"이라 8자리는 1자리, 9자리는 2자리만 가렸다.
 *  - 7자리 이하: 통째로 ****
 * ⛔ 11자리 이상 모양을 바꾸지 않는다(기존 로그·매핑 미리보기의 휴대폰 모양).
 */
const PHONE_KEEP_PREFIX_MIN_DIGITS = 11;

export function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return '****';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.length < 8) return '****';
  if (cleaned.length < PHONE_KEEP_PREFIX_MIN_DIGITS) return '****' + cleaned.slice(-4);
  return cleaned.slice(0, 3) + '****' + cleaned.slice(-4);
}

/**
 * 이메일 마스킹: user@example.com → u***@example.com
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '****';
  const [local, domain] = email.split('@');
  const maskedLocal = local.charAt(0) + '***';
  return `${maskedLocal}@${domain}`;
}

/**
 * API 키 마스킹: abcdef123456 → abcd****3456
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

/**
 * 비밀번호 마스킹: 항상 완전 마스킹
 */
export function maskPassword(_password: string): string {
  return '********';
}

// ─── 객체 내 민감정보 자동 마스킹 ───────────────────────

/**
 * 키는 **소문자로 맞춰** 찾는다. HTTP 헤더는 대소문자가 섞여 온다(axios `X-Sync-Secret`).
 * ★2026-09-13 서버 인증 헤더 3종을 더했다. axios 오류를 로그에 넘기면 `config.headers`에 원문으로 실리고,
 *   그 로그는 `report_logs` 명령으로 서버 DB까지 올라간다(Codex·적대검토 지적).
 */
const SENSITIVE_KEYS = new Map<string, (v: string) => string>([
  ['phone', maskPhone],
  ['customer_phone', maskPhone],
  ['email', maskEmail],
  ['apikey', maskApiKey],
  ['api_key', maskApiKey],
  // ★2026-09-13 시크릿은 앞뒤 4자도 남기지 않는다(적대검토 등재분 ⑤). 키는 어느 키인지 대조할 식별값이라 앞뒤를 남기지만,
  //   시크릿은 대조할 일이 없고 남긴 글자만큼 추측 공간이 줄어든다.
  ['apisecret', maskPassword],
  ['api_secret', maskPassword],
  ['password', maskPassword],
  ['secret', maskPassword],
  ['x-sync-apikey', maskApiKey],
  ['x-sync-secret', maskPassword],
  ['authorization', maskPassword],
]);

/** 중첩 한도. 넘으면 그 아래는 적지 않는다(로그 한 줄이 끝없이 커지는 것을 막는다) */
const MAX_DEPTH = 8;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * 오류에서 로그에 남길 필드(허용 목록). 네트워크 오류와 **DB 드라이버 진단 값**(문자열·숫자만).
 * ★2026-09-13 적대검토 2R: 허용 목록으로 바꾸며 DB 오류 진단 필드(MSSQL number·state·lineNumber, Oracle errorNum·offset,
 *   PostgreSQL routine·constraint, MySQL sqlState)가 빠져, 현장 진단에 쓰던 로그 줄이 비었다(기존 동작 회귀).
 *   ⛔ **구조화된 값만** 넣는다(코드·번호·위치·이름). `sql`(쿼리 원문)과 자유 문장 `detail`·`hint`·`sqlMessage`는 넣지 않는다 —
 *      제약 위반의 detail에는 행 값(이메일·전화·비밀값)이 그대로 들어간다(Codex 4R high).
 */
const ERROR_FIELDS = [
  'code', 'errno', 'syscall', 'address', 'port', 'status',
  'number', 'state', 'class', 'lineNumber', 'serverName', 'procName',
  'errorNum', 'offset',
  'severity', 'routine', 'schema', 'table', 'column', 'constraint', 'position',
  // ★2026-09-13(3) PostgreSQL 진단 위치·형식(싱크 등재분 ⑧ · 구조화된 값이라 행 값이 들어가지 않는다)
  'file', 'line', 'dataType', 'internalPosition',
  'sqlState',
  // ★2026-09-13(3) mysql2 연결 치명 여부(불리언)
  'fatal',
] as const;
/** axios 요청 설정에서 남길 필드(허용 목록). ⛔ `data`(요청 본문)·`headers`는 넣지 않는다 */
const REQUEST_FIELDS = ['method', 'url', 'baseURL', 'timeout'] as const;

/**
 * Error를 로그에 남길 **허용 목록** 필드만 가진 평범한 객체로 옮긴다.
 * ⛔ Error를 그대로 따라 내려가지 않는다: axios 오류는 요청·소켓 객체를 물고 있고 그 안이 **순환**한다
 *   (follow-redirects `_currentRequest._redirectable`). 따라 내려가면 콜 스택이 넘쳐 로그 호출이 예외를 던진다.
 * ⛔ axios `toJSON` 결과를 통째로 쓰지 않는다(★2026-09-13 Codex 2R high): 그 안의 `config.data`는 **JSON 문자열**이라
 *   키 기준 마스킹을 통과하고, 에이전트 등록 요청 본문에는 `apiKey`·`apiSecret`이 들어 있다.
 *   가릴 것을 찾아 지우는 대신 남길 것만 고른다.
 */
/**
 * 자유 문장 안의 이메일·휴대폰 번호를 가린다(★2026-09-13 Codex 5R high 부분 수용).
 * DB 오류 문장에는 충돌한 행 값이 들어간다(MySQL `Duplicate entry '...' for key` 등). 키가 없는 문장이라
 * 키 기준 마스킹이 닿지 않는다. ⛔ 문장을 통째로 지우지는 않는다: 설치 초기부터 현장 진단이 이 문장에 기댄다.
 * 이메일·번호 외의 값(이름 등)이 문장에 남을 수 있는 것은 FEATURE-SYNC-AGENT §10에 수용 위험으로 적었다.
 */
// ⛔ 길이 상한을 둔다(Codex 6R): 상한이 없으면 '@'가 없는 긴 토큰에서 시작 위치마다 끝까지 다시 읽어 제곱 시간이 된다.
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;
// 국내형(010-1234-5678 · 010 1234 5678 · (010)1234-5678)과 국제형(+82-10-1234-5678 · +821012345678).
// ⛔ 맨 앞 0 또는 +82를 요구한다: 없으면 유닉스 시각 같은 10자리 숫자(1694567890)가 번호로 가려져 진단을 망친다.
//   국제형의 `(0)` 표기(+82 (0)10-1234-5678)도 받는다(Codex 7R). 표기 가림은 흔한 형태를 막는 최선 노력이다(FEATURE-SYNC-AGENT §10).
const MOBILE_IN_TEXT = /(?<!\d)(?:\+82[-\s]?(?:\(0\)[-\s]?|\(?0?)|\(?0)1[016789]\)?[-\s]?\d{3,4}[-\s]?\d{4}(?!\d)/g;

/**
 * DB 오류 문장에서 드라이버가 **행 값을 싣는 자리**를 가린다(★2026-09-13(3) · 수용 위험 제거).
 * 종전에는 이메일·번호만 가려 이름 같은 값이 남았다. 값 앞 모양(시작)은 드라이버마다 정해져 있어 그 뒤를 `***`로 바꾼다.
 * 오류 종류·키 이름·열 이름·제약 이름은 남긴다(현장 진단은 그것으로 한다).
 * ⛔ 값의 끝은 **줄 끝에 붙은 온전한 끝 구문**(드라이버가 문장 맨 뒤에 붙이는 모양)만 인정하고, 그중 가장 뒤의 것을 쓴다.
 *   끝 구문이 없는 형식(`Truncated incorrect … value: '값'`)이거나 끝 구문을 못 찾으면 **문장 끝까지** 가린다.
 *   ★Codex 적대 1R·2R high(같은 뿌리 두 번 → 구조로 고침): 값 안의 따옴표·개행·끝 모양 조각을 끝으로 잘못 잡아 뒷부분이 남았다.
 *   값 안에 가짜 끝 구문이 있어도 진짜 끝 구문은 늘 그 뒤(줄 끝)에 있으므로 가장 뒤의 줄 끝 구문이 진짜다. 모자라게 가리지 않고 넘치게 가린다.
 * ⛔ 되돌이가 커지지 않게 모든 반복에 길이 상한을 둔다(제곱 시간 방지).
 */
const LINE_END = String.raw`(?=\r?\n|$)`;
const DB_VALUE_SLOTS: Array<{ start: RegExp; end: RegExp | null }> = [
  // MySQL: Duplicate entry '홍길동-1' for key 'uk_name'
  { start: /Duplicate entry '/g, end: new RegExp(String.raw`' for key '[^'\n]{0,128}'` + LINE_END, 'g') },
  // MySQL: Incorrect integer value: '값' for column 'age' at row 1
  { start: /Incorrect \w{1,30} value: '/g, end: new RegExp(String.raw`' for column '[^'\n]{0,128}' at row \d{1,12}` + LINE_END, 'g') },
  // MySQL: Truncated incorrect DOUBLE value: '값'  (끝 구문이 없다 → 문장 끝까지)
  { start: /Truncated incorrect \w{1,30} value: '/g, end: null },
  // PostgreSQL: invalid input syntax for type integer: "값" · invalid input value for enum gender: "값"
  { start: /invalid input (?:syntax for type|value for enum) [^:\n]{1,80}: "/g, end: new RegExp('"' + LINE_END, 'g') },
  // PostgreSQL detail가 문장에 붙어 올 때: Key (email)=(값) already exists. · is not present in table "t". · is still referenced from table "t".
  {
    start: /Key \([^)\n]{1,200}\)=\(/g,
    end: new RegExp(String.raw`\) (?:already exists|is not present in table "[^"\n]{0,128}"|is still referenced from table "[^"\n]{0,128}")\.?` + LINE_END, 'g'),
  },
  // MSSQL: The duplicate key value is (값).  (뒤에 The statement has been terminated. 가 붙기도 한다)
  { start: /The duplicate key value is \(/g, end: new RegExp(String.raw`\)\.(?: The statement has been terminated\.)?` + LINE_END, 'g') },
  // MSSQL: Conversion failed when converting the varchar value '값' to data type int.
  { start: /converting the \w{1,30} value '/g, end: new RegExp(String.raw`' to data type \w{1,30}\.?` + LINE_END, 'g') },
];

/**
 * 문장 끝 = 끝 공백을 뺀 위치.
 * ★Codex 적대 3R·4R medium: 끝 구문은 **문장 전체의 끝**에 있을 때만 진짜다. 줄 끝만 보면 진짜 끝 구문이 모양에서 벗어날 때
 *   앞줄 가짜 구문으로 물러났고(3R), 스택 모양 줄을 빼고 끝을 정하면 값 안에서 잘린 가짜 스택 줄을 믿었다(4R).
 *   ⛔ 임의 문자열의 모양·메시지 위치로 본문 경계를 정하지 않는다. 스택도 통째로 한 문장이다(errorToPlain).
 */
function textBodyEnd(text: string): number {
  let pos = text.length;
  while (pos > 0 && /\s/.test(text[pos - 1])) pos -= 1;
  return pos;
}

/**
 * ★Codex 적대 6R medium: 형식마다 차례로 바꾸면 앞 형식의 치환이 다른 DB 값의 시작 표식을 지워, 합쳐진 오류 문장에서 뒤 값이 남았다.
 *   → **원문에서** 모든 형식의 가릴 구간을 먼저 모으고, 겹치는 구간을 합친 뒤 한 번에 바꾼다.
 * 구간 = 값 시작부터, 끝 구문이 문장 끝(끝 공백 제외)에 딱 붙어 있으면 그 앞까지, 아니면 문장 끝까지.
 * 형식마다 "문장 끝에 붙은 끝 구문"은 하나뿐이라 한 번만 찾는다(시작 표식이 많아도 선형).
 */
function maskDbValues(text: string): string {
  const bodyEnd = textBodyEnd(text);
  const spans: Array<[number, number]> = [];
  for (const { start, end } of DB_VALUE_SLOTS) {
    let tailAt = -1;
    if (end) {
      end.lastIndex = 0;
      for (let e = end.exec(text); e; e = end.exec(text)) {
        if (e.index + e[0].length === bodyEnd) tailAt = e.index;
        end.lastIndex = e.index + Math.max(1, e[0].length);
      }
    }
    start.lastIndex = 0;
    for (let m = start.exec(text); m; m = start.exec(text)) {
      const valueAt = m.index + m[0].length;
      spans.push([valueAt, tailAt >= valueAt ? tailAt : text.length]);
      start.lastIndex = m.index + Math.max(1, m[0].length);
    }
  }
  if (spans.length === 0) return text;
  spans.sort((a, b) => a[0] - b[0]);
  let out = '';
  let pos = 0;
  let [curStart, curEnd] = spans[0];
  for (let i = 1; i <= spans.length; i++) {
    const next = spans[i];
    if (next && next[0] <= curEnd) {
      curEnd = Math.max(curEnd, next[1]);
      continue;
    }
    out += `${text.slice(pos, curStart)}***`;
    pos = curEnd;
    if (next) [curStart, curEnd] = next;
  }
  return out + text.slice(pos);
}

export function scrubText(text: string): string {
  return maskDbValues(text)
    .replace(EMAIL_IN_TEXT, (m) => maskEmail(m))
    .replace(MOBILE_IN_TEXT, (m) => maskPhone(m));
}

/**
 * 동기화 오류의 행 식별값(`recordKey`)을 로그용으로 가린다(★2026-09-13 적대검토 등재분 ⑥).
 * 값은 고객 DB의 전화번호 원문이거나 원본 PK 값을 `|`로 이은 문자열이다. **정규화에 실패한 행**이라 표기가 제각각이어서
 * (앞 0 빠진 엑셀 숫자·국번 없는 번호) 문장 패턴(`scrubText`)만으로는 못 잡는다.
 * 조각마다 숫자가 7자리 이상이면 번호로 보고 가린다. 7 = 가장 짧은 온전한 국내 번호(국번 없는 유선 3자리 + 4자리 · ★워크플로 1R).
 * 가린 모양: 7자리는 통째로 `****`, 8자리 이상은 **뒤 4자리만** 남긴다(`****1234` · 행 대조용).
 * ⛔ 공용 `maskPhone`을 쓰지 않는다(★워크플로 2R). 공용 함수는 11자리 이상에서 앞 3자리를 남기는데, 행 식별값은
 *   표기가 제각각이라(앞 0 빠진 숫자 등) 자릿수로 번호 종류를 가를 수 없다 → 번호로 보이면 뒤 4자리만 남긴다.
 * ⛔ 날짜·주문번호처럼 숫자가 긴 PK 조각도 함께 가려져 로그만으로 행을 찾기 어려워진다. 이 로그는 로그 요청 명령으로
 *   서버에 올라가므로 개인정보 쪽을 택했다(FEATURE-SYNC-AGENT §10에 수용 비용으로 적었다).
 */
const RECORD_KEY_PHONE_MIN_DIGITS = 7;

/** 숫자 블록의 0 코드포인트: 전각(０) · 아랍-인도(٠) · 확장 아랍-인도(۰) */
const DIGIT_BLOCK_ZEROS = [0xff10, 0x0660, 0x06f0];

/**
 * 반각 숫자로 옮긴다(★2026-09-13(3) · 수용 위험 제거). NFKC만으로는 ICU 없이 빌드된 실행 파일에서 전각 숫자가 그대로 남고(아무 일도 안 한다),
 * 아랍-인도 숫자는 NFKC로도 바뀌지 않는다. NFKC(원문자·위첨자 등 종전 동작 유지) 뒤에 세 블록을 코드포인트로 직접 옮긴다.
 */
function toAsciiDigits(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFKC')) {
    const cp = ch.codePointAt(0) as number;
    const zero = DIGIT_BLOCK_ZEROS.find((z) => cp >= z && cp <= z + 9);
    out += zero === undefined ? ch : String(cp - zero);
  }
  return out;
}

function maskRecordKeyPart(part: string): string {
  // 전각 숫자(０-９)·아랍-인도 숫자도 번호로 센다(★워크플로 3R · ★(3) ICU 없는 빌드에서도)
  const digits = toAsciiDigits(part).replace(/[^0-9]/g, '');
  if (digits.length < RECORD_KEY_PHONE_MIN_DIGITS) return scrubText(part);
  return digits.length > RECORD_KEY_PHONE_MIN_DIGITS ? `****${digits.slice(-4)}` : '****';
}

export function maskRecordKey(key: string): string {
  return String(key ?? '').split('|').map(maskRecordKeyPart).join('|');
}

function errorToPlain(err: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: err.name, message: scrubText(String(err.message ?? '')) };
  // ★2026-09-13(3) 스택은 **통째로 한 문장**으로 가린다(Codex 적대 4R·5R medium). 스택 모양 줄이나 메시지 위치로 경계를 나누면
  //   값 안에서 잘린 가짜 스택 줄·생성 뒤 바뀐 메시지에 속아 값이 남았다. DB 값 자리가 있으면 그 뒤(프레임 포함)가 전부 가려지고,
  //   DB 값 자리가 없는 보통 오류는 프레임이 그대로 남는다. 진단은 코드·번호·제약 이름 필드와 메시지로 한다.
  if (err.stack) out.stack = scrubText(err.stack);
  const src = err as unknown as Record<string, unknown>;
  for (const f of ERROR_FIELDS) {
    const v = src[f];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[f] = v;
  }
  // axios 오류: 응답 상태와 서버가 돌려준 안내 문장, 요청 주소만 남긴다
  const response = src.response as { status?: unknown; data?: unknown } | undefined;
  if (response && typeof response === 'object') {
    if (typeof response.status === 'number') out.status = response.status;
    const data = response.data as { error?: unknown; message?: unknown } | undefined;
    if (data && typeof data === 'object') {
      const serverMessage = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : '';
      // 가린 뒤에 자른다(Codex 6R): 먼저 자르면 경계에 걸린 이메일이 패턴에서 빠져 앞부분이 그대로 남는다
      if (serverMessage) out.serverMessage = scrubText(serverMessage).slice(0, 300);
    }
  }
  const config = src.config as Record<string, unknown> | undefined;
  if (config && typeof config === 'object') {
    const request: Record<string, unknown> = {};
    for (const f of REQUEST_FIELDS) {
      const v = config[f];
      if (typeof v === 'string' || typeof v === 'number') request[f] = v;
    }
    if (Object.keys(request).length > 0) out.request = request;
  }
  return out;
}

/**
 * 순환 판정은 **지금 내려가고 있는 경로(조상)** 로만 한다(★2026-09-13 적대검토 2R).
 * 한 번 본 객체를 모두 기억하면, 같은 객체를 두 필드에 넘긴 정상 로그(순환 아님)가 `[Circular]`로 찍힌다.
 */
function withAncestor<T>(ancestors: WeakSet<object>, obj: object, fn: () => T): T {
  ancestors.add(obj);
  try {
    return fn();
  } finally {
    ancestors.delete(obj);
  }
}

function maskValue(key: string, value: unknown, ancestors: WeakSet<object>, depth: number): unknown {
  const maskFn = SENSITIVE_KEYS.get(key.toLowerCase());
  if (maskFn && typeof value === 'string') return maskFn(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (ancestors.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (value instanceof Error) {
    return withAncestor(ancestors, value, () => maskObject(errorToPlain(value), ancestors, depth + 1));
  }
  if (isPlainObject(value)) return maskObject(value, ancestors, depth + 1);
  // 클래스 인스턴스(axios 헤더 객체·Buffer 등)는 직렬화가 toJSON 결과를 쓴다. 그 결과가 평범한 객체면 그것을 가린다.
  if (!(value instanceof Date)) {
    const withJson = value as { toJSON?: () => unknown };
    if (typeof withJson.toJSON === 'function') {
      try {
        const j = withJson.toJSON();
        if (isPlainObject(j)) {
          return withAncestor(ancestors, value, () => maskObject(j, ancestors, depth + 1));
        }
      } catch {
        // toJSON 실패는 원래 값을 그대로 둔다(직렬화 단계가 판단한다)
      }
    }
  }
  return value;
}

function maskObject(obj: Record<string, unknown>, ancestors: WeakSet<object>, depth: number): Record<string, unknown> {
  return withAncestor(ancestors, obj, () => {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      masked[key] = maskValue(key, value, ancestors, depth);
    }
    return masked;
  });
}

/**
 * 객체 내 민감 필드를 자동으로 마스킹합니다.
 * 원본 객체를 수정하지 않고 새 객체를 반환합니다.
 * ⛔ 순환 참조는 `[Circular]`, 너무 깊은 곳은 `[Truncated]`로 끊는다(★2026-09-13 · 무한 재귀로 로그 호출이 죽던 것).
 */
export function maskSensitiveData(obj: Record<string, unknown>): Record<string, unknown> {
  return maskObject(obj, new WeakSet<object>(), 0);
}
