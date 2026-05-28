import { describe, it, expect, beforeEach } from 'vitest';
import { detectConsent } from '../consent';

describe('Consent auto-detection (§12 #4 4 분리)', () => {
  beforeEach(() => {
    document.body.removeAttribute('data-hjl-consent-analytics');
    document.body.removeAttribute('data-hjl-consent-marketing');
    document.body.removeAttribute('data-hjl-consent-ad');
    document.body.removeAttribute('data-hjl-consent-kakao');
  });

  it('consent 4 분리 attribute 누락 시 default = 4 모두 false', () => {
    expect(detectConsent()).toEqual({
      analytics: false,
      marketing: false,
      ad: false,
      kakao: false,
    });
  });

  it('data-hjl-consent-marketing="true" 안 marketing 한정 true', () => {
    document.body.setAttribute('data-hjl-consent-marketing', 'true');
    expect(detectConsent()).toEqual({
      analytics: false,
      marketing: true,
      ad: false,
      kakao: false,
    });
  });

  it('4 분리 모두 "true" 안 4 모두 true', () => {
    document.body.setAttribute('data-hjl-consent-analytics', 'true');
    document.body.setAttribute('data-hjl-consent-marketing', 'true');
    document.body.setAttribute('data-hjl-consent-ad', 'true');
    document.body.setAttribute('data-hjl-consent-kakao', 'true');
    expect(detectConsent()).toEqual({
      analytics: true,
      marketing: true,
      ad: true,
      kakao: true,
    });
  });

  it('"false" / "0" / "" 값 = false 흐름', () => {
    document.body.setAttribute('data-hjl-consent-marketing', 'false');
    document.body.setAttribute('data-hjl-consent-ad', '0');
    document.body.setAttribute('data-hjl-consent-kakao', '');
    expect(detectConsent()).toEqual({
      analytics: false,
      marketing: false,
      ad: false,
      kakao: false,
    });
  });
});
