/**
 * 로그 민감정보 마스킹
 * 전화번호, 이메일, API 키 등을 로그에 기록할 때 부분 마스킹
 */

// ─── 마스킹 규칙 ────────────────────────────────────────

/**
 * 전화번호 마스킹: 01012345678 → 010****5678
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return '****';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.length < 8) return '****';
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
  ['apisecret', maskApiKey],
  ['api_secret', maskApiKey],
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

/** 오류에서 로그에 남길 필드(허용 목록). 네트워크 오류 진단에 쓰는 값만 */
const ERROR_FIELDS = ['code', 'errno', 'syscall', 'address', 'port', 'status'] as const;
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
function errorToPlain(err: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: err.name, message: err.message };
  if (err.stack) out.stack = err.stack;
  const src = err as unknown as Record<string, unknown>;
  for (const f of ERROR_FIELDS) {
    const v = src[f];
    if (typeof v === 'string' || typeof v === 'number') out[f] = v;
  }
  // axios 오류: 응답 상태와 서버가 돌려준 안내 문장, 요청 주소만 남긴다
  const response = src.response as { status?: unknown; data?: unknown } | undefined;
  if (response && typeof response === 'object') {
    if (typeof response.status === 'number') out.status = response.status;
    const data = response.data as { error?: unknown; message?: unknown } | undefined;
    if (data && typeof data === 'object') {
      const serverMessage = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : '';
      if (serverMessage) out.serverMessage = serverMessage.slice(0, 300);
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

function maskValue(key: string, value: unknown, seen: WeakSet<object>, depth: number): unknown {
  const maskFn = SENSITIVE_KEYS.get(key.toLowerCase());
  if (maskFn && typeof value === 'string') return maskFn(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (value instanceof Error) {
    seen.add(value);
    return maskObject(errorToPlain(value), seen, depth + 1);
  }
  if (isPlainObject(value)) return maskObject(value, seen, depth + 1);
  // 클래스 인스턴스(axios 헤더 객체·Buffer 등)는 직렬화가 toJSON 결과를 쓴다. 그 결과가 평범한 객체면 그것을 가린다.
  if (!(value instanceof Date)) {
    const withJson = value as { toJSON?: () => unknown };
    if (typeof withJson.toJSON === 'function') {
      try {
        const j = withJson.toJSON();
        if (isPlainObject(j)) {
          seen.add(value);
          return maskObject(j, seen, depth + 1);
        }
      } catch {
        // toJSON 실패는 원래 값을 그대로 둔다(직렬화 단계가 판단한다)
      }
    }
  }
  return value;
}

function maskObject(obj: Record<string, unknown>, seen: WeakSet<object>, depth: number): Record<string, unknown> {
  seen.add(obj);
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    masked[key] = maskValue(key, value, seen, depth);
  }
  return masked;
}

/**
 * 객체 내 민감 필드를 자동으로 마스킹합니다.
 * 원본 객체를 수정하지 않고 새 객체를 반환합니다.
 * ⛔ 순환 참조는 `[Circular]`, 너무 깊은 곳은 `[Truncated]`로 끊는다(★2026-09-13 · 무한 재귀로 로그 호출이 죽던 것).
 */
export function maskSensitiveData(obj: Record<string, unknown>): Record<string, unknown> {
  return maskObject(obj, new WeakSet<object>(), 0);
}
