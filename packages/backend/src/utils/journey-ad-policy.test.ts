import { describe, test, expect } from 'vitest';
import { resolveJourneyAdFlag } from './journey-ad-policy';

describe('resolveJourneyAdFlag — 비카카오 여정은 무조건 광고 표기 (정보통신망법)', () => {
  test('SMS 여정은 AI가 isAd=false로 내려도 광고 강제(true)', () => {
    expect(resolveJourneyAdFlag('sms', false)).toBe(true);
  });

  test('LMS 여정 isAd 미지정도 광고(true)', () => {
    expect(resolveJourneyAdFlag('lms', undefined)).toBe(true);
  });

  test('MMS 대문자도 광고(true)', () => {
    expect(resolveJourneyAdFlag('MMS', false)).toBe(true);
  });

  test('빈 채널/null/미지정은 비카카오로 간주 → 광고(true)', () => {
    expect(resolveJourneyAdFlag('', false)).toBe(true);
    expect(resolveJourneyAdFlag(null, false)).toBe(true);
    expect(resolveJourneyAdFlag(undefined, false)).toBe(true);
  });

  // ★ 2026-11-02 설계서 3-11(D16) — 알림톡 = 늘 정보성(저장값 · 요청값과 무관)
  test('카카오(알림톡)는 늘 정보성(false) — 요청값이 true · 미지정이어도', () => {
    expect(resolveJourneyAdFlag('kakao', false)).toBe(false);
    expect(resolveJourneyAdFlag('KAKAO', undefined)).toBe(false);
    expect(resolveJourneyAdFlag('kakao', true)).toBe(false);
  });
});
