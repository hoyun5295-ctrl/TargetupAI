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

const SENSITIVE_KEYS = new Map<string, (v: string) => string>([
  ['phone', maskPhone],
  ['customer_phone', maskPhone],
  ['email', maskEmail],
  ['apiKey', maskApiKey],
  ['api_key', maskApiKey],
  ['apiSecret', maskApiKey],
  ['api_secret', maskApiKey],
  ['password', maskPassword],
  ['secret', maskPassword],
]);

/**
 * 객체 내 민감 필드를 자동으로 마스킹합니다.
 * 원본 객체를 수정하지 않고 새 객체를 반환합니다.
 */
export function maskSensitiveData(obj: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const maskFn = SENSITIVE_KEYS.get(key);
    if (maskFn && typeof value === 'string') {
      masked[key] = maskFn(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskSensitiveData(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }

  return masked;
}
