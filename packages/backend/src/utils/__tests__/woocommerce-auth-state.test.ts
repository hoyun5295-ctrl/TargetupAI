/**
 * woocommerce-auth-state.test.ts — 우커머스 앱 인증(wc-auth) state 서명·검증 + authorize URL (① 1클릭 연결 · 순수 · DB 0)
 *  카페24 install state(cafe24-install-state.ts) 와 같은 형식: `${base64url(payload)}.${base64url(hmac)}` · TTL · 미래 ts 방어.
 *  우커머스가 콜백에 user_id 로 되돌려 주는 값이 이 state 라, 서명이 없으면 누구나 콜백을 위조해 남의 회사에 키를 꽂을 수 있다.
 */
import { describe, it, expect } from 'vitest';
import {
  WOO_AUTH_STATE_TTL_MS,
  WOO_AUTH_SCOPE,
  signWooAuthState,
  verifyWooAuthState,
  buildWooAuthorizeUrl,
} from '../woocommerce-auth-state';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const MALL = 'ilbonimo.com';
const SECRET = 'test-secret';
const NOW = 1_800_000_000_000;

describe('sign/verify', () => {
  it('왕복: 서명 → 검증 = 같은 회사·몰·nonce · 형식 = payload.sig(base64url)', () => {
    const s = signWooAuthState({ companyId: COMPANY, mallId: MALL, nonce: 'n1', ts: NOW }, SECRET);
    expect(s).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyWooAuthState(s, { secret: SECRET, now: NOW + 1000 })).toEqual({ companyId: COMPANY, mallId: MALL, nonce: 'n1' });
  });
  it('변조·다른 secret·점 없음·비문자열 → null', () => {
    const s = signWooAuthState({ companyId: COMPANY, mallId: MALL, nonce: 'n1', ts: NOW }, SECRET);
    const [p, sig] = s.split('.');
    expect(verifyWooAuthState(`${p}x.${sig}`, { secret: SECRET, now: NOW })).toBeNull();
    expect(verifyWooAuthState(s, { secret: 'other', now: NOW })).toBeNull();
    expect(verifyWooAuthState(p, { secret: SECRET, now: NOW })).toBeNull();
    expect(verifyWooAuthState('', { secret: SECRET, now: NOW })).toBeNull();
    expect(verifyWooAuthState(undefined as any, { secret: SECRET, now: NOW })).toBeNull();
  });
  it('TTL(30분) 만료 · 미래 ts → null · secret 비면 null', () => {
    const s = signWooAuthState({ companyId: COMPANY, mallId: MALL, nonce: 'n1', ts: NOW }, SECRET);
    expect(WOO_AUTH_STATE_TTL_MS).toBe(30 * 60 * 1000);
    expect(verifyWooAuthState(s, { secret: SECRET, now: NOW + WOO_AUTH_STATE_TTL_MS + 1 })).toBeNull();
    expect(verifyWooAuthState(s, { secret: SECRET, now: NOW - WOO_AUTH_STATE_TTL_MS - 1 })).toBeNull();
    expect(verifyWooAuthState(s, { secret: '', now: NOW })).toBeNull();
  });
  it('몰 식별자·회사 uuid 형식이 아니면 검증 단계에서 null(payload 위조 방어)', () => {
    const bad = signWooAuthState({ companyId: 'not-uuid', mallId: MALL, nonce: 'n', ts: NOW }, SECRET);
    expect(verifyWooAuthState(bad, { secret: SECRET, now: NOW })).toBeNull();
    const bad2 = signWooAuthState({ companyId: COMPANY, mallId: 'localhost', nonce: 'n', ts: NOW }, SECRET);
    expect(verifyWooAuthState(bad2, { secret: SECRET, now: NOW })).toBeNull();
  });
});

describe('buildWooAuthorizeUrl — 우커머스 내장 앱 인증 엔드포인트(/wc-auth/v1/authorize · 0914 두 몰에서 302 실측)', () => {
  it('origin 은 저장 몰 주소 · scope read_write(웹훅 생성에 쓰기 필요) · user_id = state · return/callback 은 우리 https 주소', () => {
    const u = new URL(buildWooAuthorizeUrl('https://www.ilbonimo.com/', 'STATE.SIG', 'https://app.hanjul.ai/'));
    expect(u.origin + u.pathname).toBe('https://www.ilbonimo.com/wc-auth/v1/authorize');
    expect(u.searchParams.get('app_name')).toBe('한줄로');
    expect(u.searchParams.get('scope')).toBe(WOO_AUTH_SCOPE);
    expect(WOO_AUTH_SCOPE).toBe('read_write');
    expect(u.searchParams.get('user_id')).toBe('STATE.SIG');
    expect(u.searchParams.get('return_url')).toBe('https://app.hanjul.ai/api/woocommerce/auth-return');
    expect(u.searchParams.get('callback_url')).toBe('https://app.hanjul.ai/api/woocommerce/auth-callback');
  });
  it('호스트만 주면 https://{host}', () => {
    expect(buildWooAuthorizeUrl(MALL, 's', 'https://app.hanjul.ai')).toMatch(/^https:\/\/ilbonimo\.com\/wc-auth\/v1\/authorize\?/);
  });
});
