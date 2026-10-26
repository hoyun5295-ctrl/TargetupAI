/**
 * ★2026-10-27 보안 극대화 7번 감사 — 출발지 IP 허용 판정 한 곳(ip-allowlist)
 *   A3 = 080 수신거부 콜백이 nginx 한 겹뿐이었다 → 앱도 같은 목록으로 거른다(기본값 = nginx 와 같은 6개 · 1027 실측)
 *   A4 = 알림톡 웹훅 IP 검사가 환경 변수가 없으면 통과였다 → 없으면 거부
 */
import { describe, it, expect } from 'vitest';
import { parseIpAllowlist, isIpAllowed, isOpt080CallbackIp, OPT080_CALLBACK_DEFAULT_IPS } from '../ip-allowlist';
import { isAllowedWebhookIp } from '../alimtalk-webhook-handler';
import { isInternalAlertCallerAllowed } from '../internal-alert-access';

describe('ip-allowlist — 판정 한 곳', () => {
  it('빈 목록 · 값 없음 = 거부(닫힌 쪽)', () => {
    expect(isIpAllowed('203.0.113.7', parseIpAllowlist(''))).toBe(false);
    expect(isIpAllowed('203.0.113.7', parseIpAllowlist(undefined))).toBe(false);
    expect(isIpAllowed('', parseIpAllowlist('203.0.113.7'))).toBe(false);
  });
  it('::ffff: 접두 · 공백 · 형식 아닌 조각', () => {
    const s = parseIpAllowlist(' 203.0.113.7 , 10.0.0 , abc ');
    expect([...s]).toEqual(['203.0.113.7']);
    expect(isIpAllowed('::ffff:203.0.113.7', s)).toBe(true);
    expect(isIpAllowed('203.0.113.70', s)).toBe(false);
  });
  it('같은 주소의 다른 표기 — 대문자 ::FFFF: · 0:0:0:0:0:ffff: 꼴(Codex 3R)', () => {
    const s = parseIpAllowlist('203.0.113.7');
    expect(isIpAllowed('::FFFF:203.0.113.7', s)).toBe(true);
    expect(isIpAllowed('0:0:0:0:0:ffff:203.0.113.7', s)).toBe(true);
    expect(isIpAllowed('0000:0000:0000:0000:0000:FFFF:203.0.113.7', s)).toBe(true);
    expect(isAllowedWebhookIp('::FFFF:203.0.113.7', '203.0.113.7')).toBe(true);
  });
});

describe('A3 080 수신거부 콜백 — 앱 두 번째 겹', () => {
  it('기본값 = nginx 와 같은 6개(1027 실측)', () => {
    expect([...parseIpAllowlist(OPT080_CALLBACK_DEFAULT_IPS)]).toEqual([
      '121.156.104.161', '121.156.104.162', '121.156.104.163', '121.156.104.164', '121.156.104.165', '183.98.207.13',
    ]);
  });
  it('목록 안 = 통과 · 밖 · 루프백 = 거부 · 환경 변수로 덮으면 그 목록만', () => {
    expect(isOpt080CallbackIp('121.156.104.163', '')).toBe(true);
    expect(isOpt080CallbackIp('::ffff:183.98.207.13', undefined)).toBe(true);
    expect(isOpt080CallbackIp('203.0.113.7', '')).toBe(false);
    expect(isOpt080CallbackIp('127.0.0.1', '')).toBe(false);
    expect(isOpt080CallbackIp('121.156.104.163', '198.51.100.1')).toBe(false);
    expect(isOpt080CallbackIp('198.51.100.1', '198.51.100.1')).toBe(true);
  });
});

describe('A4 알림톡 웹훅 IP — 값이 없으면 거부', () => {
  it('환경 값 없음 · 빈 값 = 거부(옛 = 통과)', () => {
    expect(isAllowedWebhookIp('203.0.113.7', undefined)).toBe(false);
    expect(isAllowedWebhookIp('203.0.113.7', '')).toBe(false);
    expect(isAllowedWebhookIp('203.0.113.7', ' , ')).toBe(false);
  });
  it('목록 안 = 통과(::ffff: 포함) · 밖 = 거부', () => {
    expect(isAllowedWebhookIp('203.0.113.7', '198.51.100.1,203.0.113.7')).toBe(true);
    expect(isAllowedWebhookIp('::ffff:203.0.113.7', '203.0.113.7')).toBe(true);
    expect(isAllowedWebhookIp('203.0.113.8', '203.0.113.7')).toBe(false);
    expect(isAllowedWebhookIp(undefined, '203.0.113.7')).toBe(false);
  });
});

describe('내부 알림 출발지 — 판정 이전 뒤 동작 그대로', () => {
  it('루프백 = 통과 · 목록 안 = 통과 · 밖 = 거부', () => {
    expect(isInternalAlertCallerAllowed('127.0.0.1', '')).toBe(true);
    expect(isInternalAlertCallerAllowed('::1', '')).toBe(true);
    expect(isInternalAlertCallerAllowed('58.227.193.65', '58.227.193.65')).toBe(true);
    expect(isInternalAlertCallerAllowed('58.227.193.66', '58.227.193.65')).toBe(false);
  });
});
