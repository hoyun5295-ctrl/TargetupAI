import { describe, test, expect } from 'vitest';
import { buildChannelEligibilityWhere } from './channel-eligibility';

// ════════════════════════════════════════════════════════════════════
// 채널별 발송 자격 WHERE — 각 채널의 "권위" 발송 경로와 미리보기 인원수가
// 일치해야 한다(LESSONS D230+). 아래 기대값은 각 발송 경로의 실제 WHERE를 grep으로 확정한 것.
//   - email : email-channel.ts RECIPIENT_SAFETY_WHERE (email_opt_in NULL 허용, is_active 미적용)
//   - dm    : ai-segment-generator previewMatching 문자 발송 base (sms_opt_in 강제)
//   - kakao : journey-executor 발송 직전 안전필터(is_active·sms_opt_in·is_opt_out·is_invalid)
//   - inapp : inapp-segment-matcher(CT-78) is_active 만
// ════════════════════════════════════════════════════════════════════

describe('buildChannelEligibilityWhere — 채널별 발송 자격 WHERE (발송 경로와 일치)', () => {
  test('email — 발송 경로 RECIPIENT_SAFETY_WHERE 미러 (email_opt_in NULL 허용·is_active 미적용)', () => {
    expect(buildChannelEligibilityWhere('email')).toBe(
      "c.email IS NOT NULL AND c.email LIKE '%@%' AND c.email_opt_in IS DISTINCT FROM false AND c.is_opt_out IS DISTINCT FROM true AND c.is_invalid IS DISTINCT FROM true",
    );
  });

  test('dm — 문자 발송 자격 base (is_active·sms_opt_in 강제 + opt_out/invalid NULL 안전)', () => {
    expect(buildChannelEligibilityWhere('dm')).toBe(
      'c.is_active = true AND c.sms_opt_in = true AND (c.is_opt_out = false OR c.is_opt_out IS NULL) AND (c.is_invalid = false OR c.is_invalid IS NULL)',
    );
  });

  test('kakao — 발송 직전 안전필터(문자 자격과 동일, sms_opt_in 포함)', () => {
    expect(buildChannelEligibilityWhere('kakao')).toBe(
      'c.is_active = true AND c.sms_opt_in = true AND (c.is_opt_out = false OR c.is_opt_out IS NULL) AND (c.is_invalid = false OR c.is_invalid IS NULL)',
    );
  });

  test('inapp — CT-78 표시 자격은 is_active 만(별도 식별자 컬럼 없음)', () => {
    expect(buildChannelEligibilityWhere('inapp')).toBe('c.is_active = true');
  });

  test('alias 인자로 컬럼 접두사를 바꿀 수 있다', () => {
    expect(buildChannelEligibilityWhere('inapp', 'cust')).toBe('cust.is_active = true');
  });

  test('지원하지 않는 채널은 throw (자동완화·임의 통과 금지)', () => {
    expect(() => buildChannelEligibilityWhere('sms' as any)).toThrow();
  });

  test('안전하지 않은 alias는 throw (SQL injection 차단)', () => {
    expect(() => buildChannelEligibilityWhere('email', 'c; DROP TABLE customers')).toThrow();
  });
});
