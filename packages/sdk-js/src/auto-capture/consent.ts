/**
 * Consent mode 4 분리 자동 감지 (§12 #4 Harold 확정).
 * data-hjl-consent-{analytics,marketing,ad,kakao} body attribute 영역.
 * 한국 정보통신망법 흐름 — analytics + marketing + ad + kakao 분리.
 */

export interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  ad: boolean;
  kakao: boolean;
}

const CHANNELS = ['analytics', 'marketing', 'ad', 'kakao'] as const;

function parseBool(v: string | null): boolean {
  if (!v) return false;
  return v.toLowerCase() === 'true' || v === '1';
}

export function detectConsent(): ConsentState {
  const result: ConsentState = {
    analytics: false,
    marketing: false,
    ad: false,
    kakao: false,
  };
  if (typeof document === 'undefined' || !document.body) {
    return result;
  }
  for (const ch of CHANNELS) {
    const value = document.body.getAttribute(`data-hjl-consent-${ch}`);
    result[ch] = parseBool(value);
  }
  return result;
}
