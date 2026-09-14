/**
 * 우커머스 앱 인증(wc-auth) state — 순수 서명/검증 CT (2026-09-14 ① 1클릭 연결 · DB import 0)
 *
 * 우커머스에는 카페24 앱스토어 승인과 같은 앱 인증 엔드포인트가 내장돼 있다(0914 일본이모·렌즈007 두 몰에서 302 실측):
 *   GET {몰}/wc-auth/v1/authorize?app_name=&scope=read_write&user_id=<state>&return_url=<우리 https>&callback_url=<우리 https>
 *   → 몰 관리자 로그인 → 승인 → 우커머스 서버가 callback_url 에 JSON POST { key_id, user_id, consumer_key, consumer_secret, key_permissions }
 *   → 브라우저는 return_url?success=1&user_id=<state> 로 돌아온다.
 *
 * user_id 가 곧 우리 state 다. 서명이 없으면 누구나 콜백을 위조해 남의 회사 행에 키를 꽂을 수 있으므로
 * 카페24 install state(cafe24-install-state.ts)와 같은 형식으로 HMAC 서명 + TTL 을 건다:
 *   `${base64url(payload)}.${base64url(hmac_sha256(payload))}` · payload = { woo: true, company_id, mall_id, nonce, ts }
 * 1회용 보장은 라우트가 cdp_webhook_deliveries(oauth_state 행 · nonce)로 한다 — 여기는 서명·형식·TTL 만.
 *
 * ⛔ 콜백 본문 필드명(consumer_key · consumer_secret · key_permissions)은 우커머스 문서 기준 · 실 도착 1건으로 최종 확인(게이트 ②).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { normalizeWooMallId, wooSiteOrigin } from './woocommerce-core';

// 서명 비밀키 — 서버 전용(클라이언트 비노출). JWT 서명 비밀을 재사용(전 배포에 존재).
const DEFAULT_SECRET = process.env.WOO_AUTH_STATE_SECRET || process.env.JWT_SECRET || '';

/** 관리자가 몰에 로그인하고 승인까지 걸리는 시간을 넉넉히(카페24 install 10분보다 길다) */
export const WOO_AUTH_STATE_TTL_MS = 30 * 60 * 1000;
export const WOO_AUTH_APP_NAME = '한줄로';
/** 웹훅을 우리가 REST 로 만들어야 하므로 쓰기까지 */
export const WOO_AUTH_SCOPE = 'read_write';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WooAuthStateInput {
  companyId: string;
  mallId: string;
  nonce: string;
  ts: number;
}

export interface WooAuthStateVerified {
  companyId: string;
  mallId: string;
  nonce: string;
}

export function signWooAuthState(input: WooAuthStateInput, secret: string = DEFAULT_SECRET): string {
  const payload = Buffer.from(JSON.stringify({ woo: true, company_id: input.companyId, mall_id: input.mallId, nonce: input.nonce, ts: input.ts })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** 서명·형식·TTL 통과 시 { companyId, mallId, nonce }, 아니면 null. */
export function verifyWooAuthState(state: unknown, opts: { secret?: string; now?: number } = {}): WooAuthStateVerified | null {
  const secret = opts.secret ?? DEFAULT_SECRET;
  const now = opts.now ?? Date.now();
  if (!secret || typeof state !== 'string') return null;
  const dot = state.indexOf('.');
  if (dot <= 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let parsed: { woo?: boolean; company_id?: string; mall_id?: string; nonce?: string; ts?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed.woo !== true || typeof parsed.ts !== 'number' || !parsed.nonce) return null;
  const companyId = String(parsed.company_id || '');
  const mallId = String(parsed.mall_id || '');
  if (!UUID_RE.test(companyId)) return null;
  if (normalizeWooMallId(mallId) !== mallId) return null;
  if (now - parsed.ts > WOO_AUTH_STATE_TTL_MS) return null;   // 만료
  if (parsed.ts - now > WOO_AUTH_STATE_TTL_MS) return null;   // 미래 ts(시계 왜곡·위조) 방어
  return { companyId, mallId, nonce: String(parsed.nonce) };
}

/** 몰의 앱 인증 URL. 몰 주소는 저장된 값(호스트 또는 URL) · 우리 주소는 APP_BASE_URL(https 필수 · 우커머스가 검사한다). */
export function buildWooAuthorizeUrl(siteOrHost: string, state: string, base: string = process.env.APP_BASE_URL || 'https://app.hanjul.ai'): string {
  const ours = base.replace(/\/$/, '');
  const u = new URL(`${wooSiteOrigin(siteOrHost)}/wc-auth/v1/authorize`);
  u.searchParams.set('app_name', WOO_AUTH_APP_NAME);
  u.searchParams.set('scope', WOO_AUTH_SCOPE);
  u.searchParams.set('user_id', state);
  u.searchParams.set('return_url', `${ours}/api/woocommerce/auth-return`);
  u.searchParams.set('callback_url', `${ours}/api/woocommerce/auth-callback`);
  return u.toString();
}
