/**
 * ★ 카페24 설치(앱스토어) OAuth state — 순수 서명/검증 CT (2026-07-05, DB import 0)
 *
 * 배경: 카페24 앱 심사·설치 동선은 "계정(한줄로 로그인) 없는 상태"로 앱을 실행한다.
 *   기존 /oauth/authorize는 로그인+회사관리자 인증을 요구해 심사위원이 OAuth를 시작조차 못 했다
 *   (심사 반려 #1 OAuth 미완료 · #3 로그인 벽/가입 없음의 뿌리).
 * 이 CT는 로그인 없이 시작하는 설치 OAuth 전용 state를 만든다. company_id가 없으므로 DB nonce 대신
 *   서버 비밀키 HMAC 서명으로 위조를 차단하고 TTL로 재사용을 막는다.
 *   설치 콜백은 토큰 교환(=설치 인증)만 하고 회사에 저장하지 않는다 — 한줄로는 선 계약 후 발급 모델이라
 *   계정 자동생성·발송은 없다(계약 고객은 로그인 후 자사몰 연동에서 몰을 연결).
 *
 * state 형식: `${base64url(payload)}.${base64url(hmac_sha256(payload))}`
 *   - payload = { install: true, mall_id, ts }
 *   - 점(`.`)이 없는 기존 company state(base64url 단일 토큰)와 형식이 겹치지 않아 콜백에서 안전하게 구분된다.
 */

import { createHmac, timingSafeEqual } from 'crypto';

// 서명 비밀키 — 서버 전용(클라이언트 비노출). 앱 client_secret 재사용, 없으면 webhook api key.
const DEFAULT_SECRET = process.env.CAFE24_CLIENT_SECRET || process.env.CAFE24_WEBHOOK_API_KEY || '';
const INSTALL_STATE_TTL_MS = 10 * 60 * 1000; // 10분

/**
 * 설치 OAuth용 서명 state 생성.
 * @param mallId 호출부가 정규식으로 검증한 몰 아이디(소문자)
 * @param ts 발급 시각(ms) — 라우트는 Date.now(), 테스트는 고정값 주입
 * @param secret 기본 = 서버 비밀키(테스트 주입용 파라미터)
 */
export function signCafe24InstallState(mallId: string, ts: number, secret: string = DEFAULT_SECRET): string {
  const payload = Buffer.from(JSON.stringify({ install: true, mall_id: mallId, ts })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/**
 * 설치 state 검증. 서명·TTL·형식 통과 시 { mallId }, 아니면 null.
 * null이면 호출부는 기존 company state 경로로 넘어간다(형식이 달라 오판 없음).
 */
export function verifyCafe24InstallState(
  state: string,
  opts: { secret?: string; now?: number } = {},
): { mallId: string } | null {
  const secret = opts.secret ?? DEFAULT_SECRET;
  const now = opts.now ?? Date.now();
  if (!secret) return null;

  const dot = state.indexOf('.');
  if (dot <= 0) return null; // 점 없는 company state(base64url)는 여기서 걸러짐

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

  let parsed: { install?: boolean; mall_id?: string; ts?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed.install !== true || !parsed.mall_id || typeof parsed.ts !== 'number') return null;
  if (now - parsed.ts > INSTALL_STATE_TTL_MS) return null;        // 만료
  if (parsed.ts - now > INSTALL_STATE_TTL_MS) return null;        // 미래 ts(시계 왜곡·위조) 방어
  return { mallId: String(parsed.mall_id) };
}
