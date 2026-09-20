/**
 * sns-auth-state.ts — SNS OAuth state 서명·검증 순수 CT (2026-09-20 S1)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-10.
 *   "state(`woocommerce-auth-state.ts` 형식 복제 · payload 에 `company_id`·`platform`·`stateNonce`)"
 *
 * 형식 = `${base64url(payload)}.${base64url(hmac_sha256(payload))}` — 우커머스·카페24와 같은 형식.
 * 여기는 **서명·형식·TTL 만** 담당한다. 1회용 보장은 라우트가 `sns_oauth_states` 행으로 한다
 * (DELETE ... WHERE state_nonce=$1 AND company_id=$2 AND expires_at > NOW() RETURNING · 0행 = 400).
 *
 * ⛔ 서명만으로는 재사용을 막지 못한다 — 승인 창을 한 번 통과한 URL 을 다시 열면 같은 state 가 또 온다.
 *   그래서 두 겹이다: 서명(위조 차단) + DB 1회용(재사용 차단).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { isSnsPlatform, SNS_OAUTH_STATE_TTL_MS, type SnsPlatform } from './sns-constants';

/** 서명 비밀키 — 서버 전용. JWT 서명 비밀 재사용(전 배포에 존재 · 우커머스 선례와 같은 폴백). */
const DEFAULT_SECRET = process.env.SNS_AUTH_STATE_SECRET || process.env.JWT_SECRET || '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SnsStateInput {
  companyId: string;
  platform: SnsPlatform;
  nonce: string;
  ts: number;
}

export interface SnsStateVerified {
  companyId: string;
  platform: SnsPlatform;
  nonce: string;
}

export function signSnsState(input: SnsStateInput, secret: string = DEFAULT_SECRET): string {
  const payload = Buffer.from(JSON.stringify({
    sns: true,
    company_id: input.companyId,
    platform: input.platform,
    nonce: input.nonce,
    ts: input.ts,
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** 서명·형식·TTL 통과 시 값, 아니면 null. 어떤 이유로 실패했는지는 밖으로 알리지 않는다. */
export function verifySnsState(state: unknown, opts: { secret?: string; now?: number } = {}): SnsStateVerified | null {
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

  let parsed: { sns?: boolean; company_id?: string; platform?: string; nonce?: string; ts?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed.sns !== true || typeof parsed.ts !== 'number' || !parsed.nonce) return null;

  const companyId = String(parsed.company_id || '');
  if (!UUID_RE.test(companyId)) return null;
  if (!isSnsPlatform(parsed.platform)) return null;
  if (now - parsed.ts > SNS_OAUTH_STATE_TTL_MS) return null;   // 만료
  if (parsed.ts - now > SNS_OAUTH_STATE_TTL_MS) return null;   // 미래 ts(시계 왜곡·위조) 방어

  return { companyId, platform: parsed.platform, nonce: String(parsed.nonce) };
}
