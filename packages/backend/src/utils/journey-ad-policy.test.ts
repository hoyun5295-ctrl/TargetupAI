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

  test('카카오(알림톡)는 정보성 허용 — isAd=false면 false 유지', () => {
    expect(resolveJourneyAdFlag('kakao', false)).toBe(false);
  });

  test('카카오 isAd 미지정/true는 true (기본 광고)', () => {
    expect(resolveJourneyAdFlag('KAKAO', undefined)).toBe(true);
    expect(resolveJourneyAdFlag('kakao', true)).toBe(true);
  });
});
