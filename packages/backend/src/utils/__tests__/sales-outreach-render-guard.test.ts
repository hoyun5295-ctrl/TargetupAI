/**
 * sales-outreach-render-guard.test.ts — 렌더 크롤 가드 판정(순수) 행동 테스트 (2026-09-06 · S1)
 * 네트워크 0 · 크롬 0. 워커가 쓰는 판정 함수를 문자열 입력으로만 검증한다.
 */
import { describe, it, expect } from 'vitest';
import {
  registrableDomain, isSameSite, decideRequest, parseConnectTarget, isAllowedProxyPort, clampDeadline, RENDER_DEFAULTS,
} from '../sales-outreach-render-guard';

describe('registrableDomain · isSameSite', () => {
  it('co.kr 은 세 라벨, com 은 두 라벨', () => {
    expect(registrableDomain('www.isoi.co.kr')).toBe('isoi.co.kr');
    expect(registrableDomain('cfront.isoi.co.kr')).toBe('isoi.co.kr');
    expect(registrableDomain('www.innisfree.com')).toBe('innisfree.com');
    expect(registrableDomain('shop.brand.co.kr')).toBe('brand.co.kr');
    expect(registrableDomain('brand.jp')).toBe('brand.jp');
  });
  it('같은 사이트 = 등록 가능 도메인 일치(관용 서브도메인 무시)', () => {
    expect(isSameSite('www.isoi.co.kr', 'www.isoi.co.kr')).toBe(true);
    expect(isSameSite('www.isoi.co.kr', 'm.isoi.co.kr')).toBe(true);
    expect(isSameSite('www.isoi.co.kr', 'event.isoi.co.kr')).toBe(true);
    expect(isSameSite('www.isoi.co.kr', 'www.isoi.com')).toBe(false);
    expect(isSameSite('a.co.kr', 'b.co.kr')).toBe(false);
    expect(isSameSite('', 'x.com')).toBe(false);
  });
});

describe('decideRequest', () => {
  const H = 'www.isoi.co.kr';
  it('메인 프레임 문서 이동은 같은 사이트만', () => {
    expect(decideRequest({ resourceType: 'document', url: 'https://www.isoi.co.kr/event/1', initialHost: H, isMainFrame: true })).toBe('allow');
    expect(decideRequest({ resourceType: 'document', url: 'https://www.isoi.com/', initialHost: H, isMainFrame: true })).toBe('abort');
    expect(decideRequest({ resourceType: 'document', url: 'https://accounts.google.com/', initialHost: H, isMainFrame: true })).toBe('abort');
  });
  it('서브프레임 문서는 차단(광고·로그인 iframe)', () => {
    expect(decideRequest({ resourceType: 'document', url: 'https://www.isoi.co.kr/frame', initialHost: H, isMainFrame: false })).toBe('abort');
  });
  it('이미지·스타일·스크립트·xhr 은 다른 호스트라도 허용(CDN)', () => {
    for (const t of ['image', 'stylesheet', 'script', 'font', 'xhr', 'fetch']) {
      expect(decideRequest({ resourceType: t, url: 'https://cfront.isoi.co.kr/a.png', initialHost: H, isMainFrame: false }), t).toBe('allow');
      expect(decideRequest({ resourceType: t, url: 'https://cdn.jsdelivr.net/x.css', initialHost: H, isMainFrame: false }), t).toBe('allow');
    }
  });
  it('media·websocket·eventsource·ping·other 는 차단 · http(s) 외 스킴 차단', () => {
    for (const t of ['media', 'websocket', 'eventsource', 'ping', 'other', 'manifest']) {
      expect(decideRequest({ resourceType: t, url: 'https://cfront.isoi.co.kr/v.mp4', initialHost: H, isMainFrame: false }), t).toBe('abort');
    }
    expect(decideRequest({ resourceType: 'image', url: 'file:///etc/passwd', initialHost: H, isMainFrame: false })).toBe('abort');
    expect(decideRequest({ resourceType: 'image', url: 'data:image/png;base64,AAAA', initialHost: H, isMainFrame: false })).toBe('abort');
    expect(decideRequest({ resourceType: 'image', url: 'not a url', initialHost: H, isMainFrame: false })).toBe('abort');
  });
});

describe('parseConnectTarget · isAllowedProxyPort · clampDeadline', () => {
  it('host:port · 포트 없음 = 443 · IPv6 대괄호', () => {
    expect(parseConnectTarget('www.isoi.co.kr:443')).toEqual({ host: 'www.isoi.co.kr', port: 443 });
    expect(parseConnectTarget('WWW.ISOI.CO.KR')).toEqual({ host: 'www.isoi.co.kr', port: 443 });
    expect(parseConnectTarget('[2001:db8::1]:8443')).toEqual({ host: '2001:db8::1', port: 8443 });
    expect(parseConnectTarget('bad host:443')).toBeNull();
    expect(parseConnectTarget('host:70000')).toBeNull();
    expect(parseConnectTarget('')).toBeNull();
  });
  it('웹 포트만 허용(22·25·3306·5432·6379 거절)', () => {
    expect(isAllowedProxyPort(443)).toBe(true);
    expect(isAllowedProxyPort(80)).toBe(true);
    for (const p of [22, 25, 3306, 5432, 6379, 9090, 23388]) expect(isAllowedProxyPort(p), String(p)).toBe(false);
  });
  it('벽시계 상한은 [3초, 45초]로 묶인다', () => {
    expect(clampDeadline(undefined)).toBe(RENDER_DEFAULTS.deadlineMs);
    expect(clampDeadline(0)).toBe(RENDER_DEFAULTS.deadlineMs);
    expect(clampDeadline(1)).toBe(3_000);
    expect(clampDeadline(999_999)).toBe(RENDER_DEFAULTS.maxDeadlineMs);
    expect(clampDeadline(12_345)).toBe(12_345);
  });
});
