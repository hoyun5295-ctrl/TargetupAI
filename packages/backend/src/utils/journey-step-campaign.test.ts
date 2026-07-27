/**
 * journey-step-campaign.test.ts — 여정 step campaign 저장값 계약 (★ 2026-07-27)
 *
 * 배경: 여정 알림톡 step이 `campaigns.message_type = 'KAKAO'`를 넣어
 * `campaigns_message_type_check` 위반으로 INSERT가 깨졌고, 진입한 6건이 5분마다 재시도하며
 * 발송이 하나도 나가지 않았다(journey_step_logs 0건, PM2 로그에만 실패가 반복).
 *
 * 제약 실측(2026-07-27 pg_constraint): message_type ∈ (SMS, LMS, MMS, KMS, FMS, GMS).
 * 운영 실측: 알림톡 캠페인 102건 = message_type 'LMS' + send_channel 'alimtalk'.
 *   → 카카오 구분 축은 send_channel이고 message_type이 아니다.
 */
import { describe, it, expect } from 'vitest';
import { toCampaignMessageType } from './journey-step-campaign';

describe('toCampaignMessageType — campaigns.message_type 저장값', () => {
  it('KAKAO는 LMS로 — CHECK 허용값이 아니라서 넣으면 INSERT가 깨진다', () => {
    expect(toCampaignMessageType('KAKAO')).toBe('LMS');
    expect(toCampaignMessageType('kakao')).toBe('LMS');
  });

  it('허용값은 그대로 통과 (실측 제약 6종)', () => {
    for (const t of ['SMS', 'LMS', 'MMS', 'KMS', 'FMS', 'GMS']) {
      expect(toCampaignMessageType(t)).toBe(t);
    }
  });

  it('소문자·공백은 정규화', () => {
    expect(toCampaignMessageType(' sms ')).toBe('SMS');
    expect(toCampaignMessageType('mms')).toBe('MMS');
  });

  it('빈 값·미지 값은 LMS로 안전 변환 — 발송을 막지 않는다', () => {
    expect(toCampaignMessageType('')).toBe('LMS');
    expect(toCampaignMessageType(undefined as any)).toBe('LMS');
    expect(toCampaignMessageType(null as any)).toBe('LMS');
    expect(toCampaignMessageType('EMAIL')).toBe('LMS');
    expect(toCampaignMessageType('알림톡')).toBe('LMS');
  });
});
