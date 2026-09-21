/**
 * sns-signed-media.ts — 플랫폼이 미디어를 가져갈 서명 URL (순수 CT) · 2026-09-21 S2
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-7 · 불변 §2-14.
 *
 * 왜 서명인가: Meta 계열은 미디어를 **URL 로 가져간다**(`mediaTransfer: 'pull_url'`). 그 서버에는 우리 로그인이
 * 없으니 그 시간 동안만 열리는 주소가 필요하다. 인앱 이미지처럼 영구 공개로 두면 고객사 소재가 영원히 열린다(§9-8).
 *
 * ⛔ **1회용이 아니다.** OAuth state 와 정반대다 — 플랫폼은 같은 URL 을 여러 번 부를 수 있고(재시도·캐시 검증),
 *   1회용으로 만들면 두 번째 호출에서 게시가 깨진다. `salt` 는 추측 방지용이다.
 * ⛔ **쿼리스트링이 아니라 경로 세그먼트**에 싣는다. Range 재요청에서 쿼리가 떨어지는 클라이언트가 있어
 *   영상 전송이 중간에 죽는다(§7 ⑨).
 * ⛔ 유효 판정의 **절반만** 여기 있다. 나머지(target 상태 결박·시간 상한·미디어 교체 감지)는 DB 를 봐야 하므로
 *   라우트가 한다. 서명만 통과했다고 열어 주면 게시가 끝난 뒤에도 주소가 산다.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.SNS_MEDIA_SIGN_SECRET || process.env.JWT_SECRET || '';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 서명이 살아 있을 수 있는 절대 상한. 상태 결박과 **함께** 걸린다(둘 중 하나라도 어긋나면 404). */
export const SNS_MEDIA_ABSOLUTE_TTL_MS = 36 * 60 * 60 * 1000;

export interface SnsMediaTokenPayload {
  targetId: string;
  mediaId: string;
  companyId: string;
  /** 추측 방지용 무작위 값. 같은 target·media 에는 **고정**이다(URL 이 흔들리면 플랫폼 캐시가 깨진다). */
  salt: string;
}

export function signSnsMediaToken(p: SnsMediaTokenPayload, secret: string = SECRET): string {
  const payload = Buffer.from(JSON.stringify({
    t: p.targetId, m: p.mediaId, c: p.companyId, s: p.salt,
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** 서명·형식 통과 시 payload, 아니면 null. **시간·상태는 여기서 보지 않는다**(라우트 몫). */
export function verifySnsMediaToken(token: unknown, secret: string = SECRET): SnsMediaTokenPayload | null {
  if (!secret || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  let parsed: { t?: string; m?: string; c?: string; s?: string };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const targetId = String(parsed.t || '');
  const mediaId = String(parsed.m || '');
  const companyId = String(parsed.c || '');
  const salt = String(parsed.s || '');
  if (!UUID_RE.test(targetId) || !UUID_RE.test(mediaId) || !UUID_RE.test(companyId) || !salt) return null;

  return { targetId, mediaId, companyId, salt };
}

/**
 * 이 target 의 서명 URL 이 지금 살아 있어야 하는가 — **DB 에서 읽은 값으로** 판정한다.
 * 순수 함수로 둔 이유 = 이 규칙이 라우트 안에 흩어지면 조건 하나가 빠져도 아무도 모른다.
 */
export function isSnsMediaUrlLive(row: {
  status: string;
  container_created_at: Date | null;
  created_at: Date;
  verified_at: Date | null;
}, now: Date = new Date()): boolean {
  // 종결·확정은 즉시 만료 — 게시가 끝났는데 주소가 살아 있을 이유가 없다.
  if (row.verified_at) return false;
  if (!['claimed', 'submitted'].includes(row.status)) return false;

  // 절대 상한(36h) — 어떤 경우에도 이보다 오래 살지 않는다.
  if (now.getTime() - new Date(row.created_at).getTime() > SNS_MEDIA_ABSOLUTE_TTL_MS) return false;

  // 컨테이너를 만들었다면 그 시각 + 26h(인스타 컨테이너 만료 24h 보다 넉넉히).
  if (row.container_created_at) {
    const limit = new Date(row.container_created_at).getTime() + 26 * 60 * 60 * 1000;
    if (now.getTime() > limit) return false;
  }
  return true;
}
