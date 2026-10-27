/**
 * 서버가 밖으로 나가는 요청의 SSRF 가드 — 사설 · 예약 주소 판정과 연결 주소 고정의 유일한 소유자
 * (★ 2026-10-27 자사몰 대비 설계 K8 · 묶음 0 · 원장 = docs/2026-10-27-mall-integration-hardening-design.md).
 *
 * 옛 소유 = dm/dm-brand-extractor.ts(DM 은 재export 로 그대로 부른다) + sales-outreach-produce.ts 사본(삭제).
 * 두 사본의 사설 범위는 합집합이다(DM 판이 영업 판을 모두 포함 · 범위 표 시험 = __tests__/outbound-guard.test.ts).
 * geo-access.ts 의 같은 이름 함수는 로그인 · 기계 출발지의 클라이언트 IP 분류라 이 파일 대상이 아니다(R1 계약 사유 줄).
 */
import { lookup } from 'node:dns/promises';
import { lookup as lookupCb, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';

function isPrivateIpV4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return true; // 형식 불명 = 차단(보수)
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;               // 예약·사설·루프백
  if (a === 100 && b >= 64 && b <= 127) return true;               // 100.64/10 CGN
  if (a === 169 && b === 254) return true;                         // 링크로컬(메타데이터 서비스 포함)
  if (a === 172 && b >= 16 && b <= 31) return true;                // 172.16/12
  if (a === 192 && b === 168) return true;                         // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true;            // 벤치마크 예약
  if (a >= 224) return true;                                       // 멀티캐스트·예약·브로드캐스트
  return false;
}

/**
 * IPv6 글자 → 16비트 8칸(못 읽으면 null) — 줄임(::) · 끝 점 표기 IPv4 · 대괄호 · 영역 표시(%) 를 푼다.
 * ★ 2026-10-27 Codex 1R — 글자 앞머리로 판정하면 WHATWG URL 이 매핑 주소를 16진(::ffff:7f00:1)으로 바꿔 내보낸 꼴이 빠져나갔다.
 */
function parseIPv6(raw: string): number[] | null {
  let s = raw.toLowerCase().replace(/^\[|\]$/g, '');
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  const lastColon = s.lastIndexOf(':');
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(tail);
    if (!m) return null;
    const b = m.slice(1).map(Number);
    if (b.some((x) => x > 255)) return null;
    s = `${s.slice(0, lastColon + 1)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (x: string): number[] | null => {
    if (x === '') return [];
    const out: number[] = [];
    for (const h of x.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const left = part(halves[0]);
  const right = halves.length === 2 ? part(halves[1]) : [];
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const fill = 8 - left.length - right.length;
  if (fill < 1) return null;
  return [...left, ...new Array(fill).fill(0), ...right];
}

const v4Of = (hi: number, lo: number): string => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** 16비트 8칸 IPv6 의 사설 · 예약 판정 — 안에 IPv4 를 싣는 꼴(매핑 · 호환 · 번역 · NAT64 · 6to4)은 그 IPv4 를 같은 판정으로 */
function isPrivateIpV6(h: number[]): boolean {
  const zero = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);
  if (zero(0, 8)) return true;                                                   // :: 미지정
  if (zero(0, 7) && h[7] === 1) return true;                                     // ::1 루프백
  if (zero(0, 5) && h[5] === 0xffff) return isPrivateIpV4(v4Of(h[6], h[7]));    // ::ffff:a.b.c.d 매핑
  if (zero(0, 6)) return isPrivateIpV4(v4Of(h[6], h[7]));                         // ::a.b.c.d 호환(옛 꼴)
  if (zero(0, 4) && h[4] === 0xffff && h[5] === 0) return isPrivateIpV4(v4Of(h[6], h[7]));   // ::ffff:0:a.b.c.d 번역
  if (h[0] === 0x64 && h[1] === 0xff9b && zero(2, 6)) return isPrivateIpV4(v4Of(h[6], h[7]));   // 64:ff9b::/96 NAT64
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) return true;              // 64:ff9b:1::/48 로컬 NAT64
  if (h[0] === 0x100 && zero(1, 4)) return true;                                 // 100::/64 버림
  if (h[0] === 0x2001 && h[1] === 0) return true;                                // 2001::/32 Teredo(안의 주소를 믿지 않는다)
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;                           // 2001:db8::/32 문서용
  if (h[0] === 0x2002) return isPrivateIpV4(v4Of(h[1], h[2]));                   // 2002::/16 6to4
  if ((h[0] & 0xfe00) === 0xfc00) return true;                                   // fc00::/7 ULA
  if ((h[0] & 0xffc0) === 0xfe80) return true;                                   // fe80::/10 링크로컬
  if ((h[0] & 0xffc0) === 0xfec0) return true;                                   // fec0::/10 옛 사이트 로컬
  if ((h[0] & 0xff00) === 0xff00) return true;                                   // ff00::/8 멀티캐스트
  return false;
}

/** 사설/예약 IP 판정 (순수 — SSRF 가드 회귀 테스트용 export) · 못 읽는 글자 = 차단(보수) */
export function isPrivateIp(addr: string): boolean {
  const ip = String(addr || '').trim().toLowerCase();
  if (ip.includes(':')) {
    const h = parseIPv6(ip);
    return h ? isPrivateIpV6(h) : true;
  }
  return isPrivateIpV4(ip);
}

/** 호스트명 → 검증된 공인 주소 1개 (전 해석 주소가 공인이어야 통과 — 하나라도 사설이면 차단). */
/** ★ 2026-09-06 export — 아웃리치 렌더 워커의 로컬 프록시가 같은 판정기를 재사용한다(새 판정기 0 · 불변 7). 동작 무변경. */
export async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: number } | null> {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return isPrivateIpV4(hostname) ? null : { address: hostname, family: 4 };
  if (hostname.includes(':')) return isPrivateIp(hostname) ? null : { address: hostname, family: 6 }; // IPv6 리터럴(new URL이 대괄호 제거)
  try {
    const addrs = await lookup(hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return null;
    return { address: addrs[0].address, family: addrs[0].family };
  } catch {
    return null; // 해석 실패 = 차단
  }
}

/**
 * ★ 2026-09-05 [B-0905-1] 고정 IP lookup 콜백 — Node 20은 `autoSelectFamily`가 기본 on이라 소켓이
 *   `lookup(host, { all: true }, cb)`로 부르고 **배열**을 기대한다. 옛 형태 `cb(err, address, family)`만 돌려주면
 *   `ERR_INVALID_IP_ADDRESS`로 연결 자체가 실패해 fetchHtmlGuarded가 전 사이트 null을 냈다(운영 실측 2026-09-05 · 로컬 0/12).
 *   두 호출 형태를 모두 받는다(순수 · 계약 테스트 = __tests__/dm-brand-extractor-lookup.test.ts).
 */
export function pinnedLookup(pinned: { address: string; family: number }) {
  return (_hostname: string, options: unknown, cb: (...args: any[]) => void): void => {
    if (options && typeof options === 'object' && (options as { all?: boolean }).all) {
      cb(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    cb(null, pinned.address, pinned.family);
  };
}

/** 가드가 연결을 막았다는 오류 코드(호출부가 「연결할 수 없음」 갈래로 읽는다) */
export const OUTBOUND_BLOCKED = 'EOUTBOUNDBLOCKED';

function blockedError(host: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`outbound blocked: ${host}`), { code: OUTBOUND_BLOCKED });
}

/**
 * 연결마다 부르는 lookup 가드(axios `lookup` · Node 요청 옵션 자리) — 해석한 주소 전부가 공인일 때만 그 주소로 잇는다.
 * 소켓이 바로 이 결과로 연결하므로 검사와 연결 사이 재해석 창이 없다. 리다이렉트 홉도 같은 옵션을 물려받아 홉마다 지난다.
 * IP 리터럴 호스트는 Node 가 lookup 을 부르지 않는다 → isBlockedLiteralHost 를 요청 전 · 리다이렉트마다 함께 본다.
 */
export function guardedLookup(hostname: string, options: unknown, cb: (...args: any[]) => void): void {
  lookupCb(hostname, { all: true }, (err, addrs: LookupAddress[]) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return cb(blockedError(hostname));
    if (options && typeof options === 'object' && (options as { all?: boolean }).all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

/** 호스트가 IP 리터럴이고 사설 · 예약이면 true(lookup 을 지나지 않는 길 · 대괄호 IPv6 포함) */
export function isBlockedLiteralHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '');
  return isIP(h) !== 0 && isPrivateIp(h);
}

/** axios 설정 조각 — 연결마다 lookup 가드 · 리다이렉트 홉의 IP 리터럴 거절. 첫 주소의 리터럴 판정은 assertOutboundUrl. */
export const OUTBOUND_AXIOS_GUARD = {
  lookup: guardedLookup,
  beforeRedirect: (opts: { hostname?: string; host?: string }) => {
    const host = String(opts.hostname || opts.host || '');
    if (isBlockedLiteralHost(host)) throw blockedError(host);
  },
};

/** 요청 전 첫 주소 판정 — IP 리터럴 사설 주소면 OUTBOUND_BLOCKED 를 던진다 */
export function assertOutboundUrl(url: string): void {
  const host = new URL(url).hostname;
  if (isBlockedLiteralHost(host)) throw blockedError(host);
}
