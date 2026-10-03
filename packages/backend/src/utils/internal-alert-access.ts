// ============================================================
// internal-alert-access.ts — 시스템 알림 API(/api/internal/dist-alert) 호출 출발지 판정
// ============================================================
// 기본 = 같은 서버(루프백)만. 환경변수 INTERNAL_ALERT_ALLOWED_IPS 에 적은 주소(쉼표 구분 · 정확한 IP 하나씩)만 더 허용한다.
//   ★2026-10-03 게이트웨이 서버(.65) 백업 실패 경보를 한줄로 서버와 같은 휴대폰 LMS 로 받기 위해 신설
//   (전송자격인증 4.1 ⑤ · 4.2 ⑤ · Harold 1003 A안). 값이 없으면 종전과 같다(루프백만).
// 판정 IP = req.ip. app.ts 가 trust proxy 'loopback' 이라, nginx 를 거친 요청은 nginx 가 붙인 실제 출발지로 판정된다
//   (호출자가 X-Forwarded-For 를 꾸며 보내도 맨 오른쪽 = nginx 가 본 주소만 쓴다).
// ============================================================

import { normalizeIp } from './geo-access';

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** 쉼표로 적은 허용 주소를 정리한다. IP 형식이 아닌 조각은 버린다(대역 표기 미지원). */
export function parseInternalAlertAllowedIps(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of String(raw ?? '').split(',')) {
    const ip = normalizeIp(part);
    if (ip) out.add(ip.toLowerCase());
  }
  return out;
}

/** 시스템 알림 API 를 불러도 되는 출발지인가 — 루프백 또는 INTERNAL_ALERT_ALLOWED_IPS 에 적은 주소 */
export function isInternalAlertCallerAllowed(
  rawIp: string | null | undefined,
  allowedRaw: string | null | undefined = process.env.INTERNAL_ALERT_ALLOWED_IPS,
): boolean {
  const ip = normalizeIp(rawIp)?.toLowerCase();
  if (!ip) return false;
  if (LOOPBACK.has(ip)) return true;
  return parseInternalAlertAllowedIps(allowedRaw).has(ip);
}
