// ============================================================
// ip-allowlist.ts — 출발지 IP 허용 목록 판정 컨트롤타워(순수 · DB 0)
// ============================================================
// ★2026-10-27 보안 극대화 7번 감사 — 같은 판정이 세 곳에 따로 있었다(내부 알림 · 알림톡 웹훅 · 080 콜백 = nginx 한 겹뿐).
//   판정 = 여기 한 곳 · 빈 목록 = 거부(닫힌 쪽 · 옛 알림톡 웹훅은 값이 없으면 통과였다).
// 판정 IP = req.ip. app.ts 가 trust proxy 'loopback' 이라 nginx 를 거친 요청은 nginx 가 붙인 실제 출발지다
//   (호출자가 X-Forwarded-For 를 꾸며도 맨 오른쪽 = nginx 가 본 주소만 쓴다). ::ffff: 접두는 normalizeIp 가 벗긴다.
// ============================================================

import { normalizeIp } from './geo-access';

/** 같은 주소의 다른 표기를 하나로 — 대문자 · 0:0:0:0:0:ffff: 꼴(Codex 3R) → normalizeIp(::ffff: 접두를 벗긴다) */
function canonicalIp(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/^0{1,4}(:0{1,4}){4}:ffff:/, '::ffff:');
  return normalizeIp(s);
}

/** 쉼표로 적은 허용 주소 → 정리한 집합. IP 형식이 아닌 조각은 버린다(대역 표기 미지원). */
export function parseIpAllowlist(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of String(raw ?? '').split(',')) {
    const ip = canonicalIp(part);
    if (ip) out.add(ip);
  }
  return out;
}

/** 출발지가 허용 집합에 있는가 — 빈 집합이면 거부 */
export function isIpAllowed(rawIp: string | null | undefined, allowed: Set<string>): boolean {
  const ip = canonicalIp(rawIp);
  return !!ip && allowed.has(ip);
}

/**
 * 080 수신거부 콜백(나래인터넷) 출발지 — nginx `sites-enabled/targetup` 의 `location = /api/unsubscribes/080callback` 허용 6개와 같은 목록
 * (1027 Harold 실측). 앱이 두 번째 겹으로 같은 판정을 한다(보안 설계서 §4 원칙 1 · 모든 방어는 두 겹).
 * 기본값을 코드에 둔 이유 = 법정 수신거부 경로가 환경 변수 한 줄 누락으로 끊기면 안 된다. 업체가 주소를 바꾸면 nginx 와 함께
 * OPT080_CALLBACK_ALLOWED_IPS 로 덮는다(status/OPS.md §2-2-E ⑧-3).
 */
export const OPT080_CALLBACK_DEFAULT_IPS = '121.156.104.161,121.156.104.162,121.156.104.163,121.156.104.164,121.156.104.165,183.98.207.13';

export function isOpt080CallbackIp(rawIp: string | null | undefined, override: string | null | undefined = process.env.OPT080_CALLBACK_ALLOWED_IPS): boolean {
  return isIpAllowed(rawIp, parseIpAllowlist(override && override.trim() ? override : OPT080_CALLBACK_DEFAULT_IPS));
}
