/**
 * PII masking 7 분류 (§12 #7 Harold 확정).
 * email + 휴대폰 + 카드 + 주민 + URL token + 계좌 + 세션토큰.
 * SDK 안 1차 마스킹 + 백엔드 ingestion 안 2차 마스킹 (이중 안전망 흐름).
 */

const PATTERNS = {
  jwt: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
  rrn: /\b(\d{6})-?(\d{7})\b/g,
  card: /\b(\d{4})[-\s]?\d{4}[-\s]?\d{4}[-\s]?(\d{4})\b/g,
  phone: /\b(01[0-9])[-\s]?(\d{3,4})[-\s]?(\d{4})\b/g,
  account: /\b(\d{3})[-\s]?(\d{3})[-\s]?(\d{6})\b|\b(\d{3})\d{8,11}(\d{3})\b/g,
  email: /\b([a-zA-Z0-9])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
};

const URL_TOKEN_KEYS = [
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'token',
  'secret',
  'password',
  'session',
  'sessionid',
];

function maskString(s: string): string {
  let out = s;
  out = out.replace(PATTERNS.jwt, '[REDACTED_TOKEN]');
  out = out.replace(PATTERNS.rrn, (_m, p1) => `${p1}-*******`);
  out = out.replace(PATTERNS.card, (m, p1, p2) => {
    if (m.includes('-')) return `${p1}-****-****-${p2}`;
    return `${p1}********${p2}`;
  });
  out = out.replace(PATTERNS.phone, (m, p1, _p2, p3) => {
    if (m.includes('-')) return `${p1}-****-${p3}`;
    return `${p1}****${p3}`;
  });
  out = out.replace(PATTERNS.account, (m, p1, _p2, p3, q1, q2) => {
    if (m.includes('-') && p1) return `${p1}-***-***${p3.slice(-3)}`;
    if (q1) return `${q1}********${q2}`;
    return m;
  });
  out = out.replace(PATTERNS.email, (m, p1, domain) => {
    const local = m.split('@')[0];
    if (local.length <= 1) return m;
    return `${p1}${'*'.repeat(local.length - 1)}@${domain}`;
  });
  return out;
}

export function maskPII(input: unknown): unknown {
  if (typeof input === 'string') {
    return maskString(input);
  }
  if (Array.isArray(input)) {
    return input.map(maskPII);
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = maskPII(v);
    }
    return out;
  }
  return input;
}

export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of URL_TOKEN_KEYS) {
      if (u.searchParams.has(key)) {
        u.searchParams.set(key, '[REDACTED]');
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}
