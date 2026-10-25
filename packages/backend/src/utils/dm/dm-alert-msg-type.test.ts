/**
 * ★ 2026-10-25 원장 #66 — DM 알림 문자 종류 = 실제 나갈 문장의 바이트(옛: 늘 LMS · 화면은 「SMS 짧게 · 저단가」)
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../messageUtils', async (orig) => {
  const real: any = await orig();
  return { ...real, prepareFieldMappings: vi.fn(async () => ({})), getOpt080Number: vi.fn(async () => '0801234567') };
});

import { resolveDmAlertMsgType } from './dm-alert-msg-type';

const base = { companyId: 'c', userId: 'u', isAd: false, names: ['김하나'], links: ['https://hlj.kr/AbCdEf12'] };

describe('resolveDmAlertMsgType', () => {
  it('짧게를 고르지 않으면 장문(지금 그대로)', async () => {
    expect(await resolveDmAlertMsgType({ ...base, preferSms: false, template: '%고객명%님 새 소식 %기타1%' })).toBe('LMS');
  });
  it('짧게 + 가장 긴 이름 · 링크로도 90바이트 안 = 단문', async () => {
    expect(await resolveDmAlertMsgType({ ...base, preferSms: true, template: '%고객명%님 새 소식 %기타1%' })).toBe('SMS');
  });
  it('가장 긴 수신자 값으로 잰다(한 명이라도 넘으면 장문)', async () => {
    const long = '가'.repeat(30);
    expect(await resolveDmAlertMsgType({ ...base, preferSms: true, names: ['김', long], template: '%고객명%님 새 소식 %기타1%' })).toBe('LMS');
  });
  it('광고면 (광고) · 무료수신거부 줄까지 넣고 잰다', async () => {
    const t = `${'가'.repeat(22)} %기타1%`;   // 68바이트 · 광고 = (광고) 6 + 줄 1 + 무료거부080 18 = 93
    expect(await resolveDmAlertMsgType({ ...base, preferSms: true, template: t })).toBe('SMS');
    expect(await resolveDmAlertMsgType({ ...base, preferSms: true, isAd: true, template: t })).toBe('LMS');
  });
  it('이름 · 링크 말고 다른 %항목% · Liquid 가 있으면 값 길이를 모르니 장문', async () => {
    expect(await resolveDmAlertMsgType({ ...base, preferSms: true, template: '%등급% 혜택 %기타1%' })).toBe('LMS');
    expect(await resolveDmAlertMsgType({ ...base, preferSms: true, template: '{{ customer.name }} %기타1%' })).toBe('LMS');
  });
});
