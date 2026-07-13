/**
 * dm-brand-extractor.ts — URL → 브랜드 메타 자동 추출
 *
 * 기능:
 *  1. URL fetch → HTML
 *  2. <meta>/<link> 파싱: og:title, og:image, og:site_name, theme-color, apple-touch-icon, favicon
 *  3. DmBrandKit 부분 반환 (사용자 확인 후 override)
 *
 * 정책:
 *  - User-Agent 설정 (일부 사이트가 봇 차단)
 *  - 5초 timeout
 *  - 리다이렉트 허용 (최대 3회)
 *  - 상대 URL은 base URL로 absolute 변환
 *
 * 소비처:
 *  - dm-brand-kit.ts의 suggestBrandKitFromUrl
 *  - routes/dm.ts POST /brand-kit/extract
 */

import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { DmBrandKit } from './dm-tokens';

export type BrandExtractResult = {
  site_name?: string;
  title?: string;
  description?: string;
  logo_url?: string;
  favicon_url?: string;
  og_image_url?: string;
  primary_color?: string;
  theme_color?: string;
  contact?: { phone?: string; email?: string; website?: string };
  sns?: { instagram?: string; youtube?: string; kakao?: string; naver?: string };
};

const FETCH_TIMEOUT_MS = 5000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; TargetUpDMBot/1.0; +https://hanjul.ai)';

/** 안전하게 절대 URL로 변환. 실패 시 undefined */
function toAbsoluteUrl(maybeUrl: string | undefined, baseUrl: string): string | undefined {
  if (!maybeUrl) return undefined;
  try {
    return new URL(maybeUrl, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/** HTML에서 모든 meta 태그 파싱 (name/property/content) */
function parseMetaTags(html: string): Map<string, string> {
  const map = new Map<string, string>();
  // <meta name="..." content="..." /> 또는 <meta property="..." content="..." />
  const re = /<meta\s+([^>]+?)\/?>/gi;
  const attrRe = /(\w[\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const pairs: { [k: string]: string } = {};
    let a: RegExpExecArray | null;
    const reLocal = new RegExp(attrRe.source, 'gi');
    while ((a = reLocal.exec(attrs)) !== null) {
      const key = a[1].toLowerCase();
      const val = a[2] ?? a[3] ?? a[4] ?? '';
      pairs[key] = val;
    }
    const key = pairs['property'] || pairs['name'] || pairs['http-equiv'];
    const content = pairs['content'];
    if (key && content) {
      map.set(key.toLowerCase(), content);
    }
  }
  return map;
}

/** <link rel="..." href="..." /> 파싱 */
function parseLinkTags(html: string): Array<{ rel: string; href: string; sizes?: string }> {
  const result: Array<{ rel: string; href: string; sizes?: string }> = [];
  const re = /<link\s+([^>]+?)\/?>/gi;
  const attrRe = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const pairs: { [k: string]: string } = {};
    let a: RegExpExecArray | null;
    const reLocal = new RegExp(attrRe.source, 'gi');
    while ((a = reLocal.exec(attrs)) !== null) {
      const key = a[1].toLowerCase();
      const val = a[2] ?? a[3] ?? a[4] ?? '';
      pairs[key] = val;
    }
    if (pairs['rel'] && pairs['href']) {
      result.push({ rel: pairs['rel'].toLowerCase(), href: pairs['href'], sizes: pairs['sizes'] });
    }
  }
  return result;
}

/** <title>…</title> 파싱 */
function parseTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].trim()) : undefined;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/** 가장 큰 favicon/apple-touch-icon 선택 */
function pickBestIcon(
  links: Array<{ rel: string; href: string; sizes?: string }>,
  baseUrl: string,
): string | undefined {
  const iconLinks = links.filter((l) =>
    /(^|\s)(apple-touch-icon|icon|shortcut icon|mask-icon)(\s|$)/.test(l.rel),
  );
  if (iconLinks.length === 0) return undefined;
  // sizes의 첫 숫자를 기준으로 가장 큰 것 선택 (apple-touch-icon 우선)
  const scored = iconLinks.map((l) => {
    const sizeMatch = l.sizes?.match(/(\d+)/);
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
    const bonus = l.rel.includes('apple-touch-icon') ? 1000 : 0;
    return { ...l, score: size + bonus };
  });
  scored.sort((a, b) => b.score - a.score);
  return toAbsoluteUrl(scored[0].href, baseUrl);
}

/** 본문 텍스트에서 전화/이메일/SNS URL 추출 */
function extractContactHints(html: string, baseUrl: string): {
  phone?: string;
  email?: string;
  instagram?: string;
  youtube?: string;
  kakao?: string;
  naver?: string;
} {
  // mailto:/tel: 링크 우선
  const mailMatch = html.match(/mailto:([^"'\s<>]+)/i);
  const telMatch = html.match(/tel:([0-9+\-\s()]+)/i);

  const igMatch = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([\w.]+)/i);
  const ytMatch = html.match(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:@)?([\w.-]+)/i);
  const kakaoMatch = html.match(/https?:\/\/pf\.kakao\.com\/([\w_-]+)/i);
  const naverMatch = html.match(/https?:\/\/(?:smartstore|blog|cafe|m)\.naver\.com\/([\w.-]+)/i);

  const phoneTextMatch = html.match(/(\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4})/);

  return {
    phone: telMatch ? telMatch[1].trim() : phoneTextMatch?.[1],
    email: mailMatch?.[1],
    instagram: igMatch ? toAbsoluteUrl(igMatch[0], baseUrl) : undefined,
    youtube: ytMatch ? toAbsoluteUrl(ytMatch[0], baseUrl) : undefined,
    kakao: kakaoMatch ? toAbsoluteUrl(kakaoMatch[0], baseUrl) : undefined,
    naver: naverMatch ? toAbsoluteUrl(naverMatch[0], baseUrl) : undefined,
  };
}

/** HEX 색상 유효성 체크 */
function isValidHexColor(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());
}

// ────────────── Main API ──────────────

/**
 * URL에서 브랜드 메타 추출.
 * 실패 시 빈 객체 반환 (예외 throw 하지 않음).
 */
export async function extractBrandFromUrl(targetUrl: string): Promise<BrandExtractResult> {
  let normalizedUrl = targetUrl.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  // URL 유효성 체크
  let baseUrl: string;
  try {
    const u = new URL(normalizedUrl);
    baseUrl = u.origin;
  } catch {
    return {};
  }

  // fetch with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return {};
    html = await res.text();
  } catch {
    return {};
  } finally {
    clearTimeout(timeoutId);
  }

  // 너무 큰 페이지는 앞부분만 (메타는 <head>에 있음)
  const headPart = html.slice(0, 200_000);

  const meta = parseMetaTags(headPart);
  const links = parseLinkTags(headPart);
  const pageTitle = parseTitle(headPart);

  const siteName =
    meta.get('og:site_name') ||
    meta.get('application-name') ||
    undefined;

  const title =
    meta.get('og:title') ||
    meta.get('twitter:title') ||
    pageTitle ||
    undefined;

  const description =
    meta.get('og:description') ||
    meta.get('description') ||
    meta.get('twitter:description') ||
    undefined;

  const ogImage =
    meta.get('og:image') ||
    meta.get('og:image:url') ||
    meta.get('twitter:image') ||
    undefined;

  const themeColorRaw =
    meta.get('theme-color') ||
    meta.get('msapplication-tilecolor') ||
    undefined;
  const themeColor =
    themeColorRaw && isValidHexColor(themeColorRaw) ? themeColorRaw : undefined;

  const favicon = pickBestIcon(links, baseUrl);
  const ogImageAbs = toAbsoluteUrl(ogImage, baseUrl);

  const contactHints = extractContactHints(headPart, baseUrl);

  return {
    site_name: siteName || title,
    title,
    description,
    logo_url: favicon || ogImageAbs,
    favicon_url: favicon,
    og_image_url: ogImageAbs,
    primary_color: themeColor,
    theme_color: themeColor,
    contact: {
      phone: contactHints.phone,
      email: contactHints.email,
      website: baseUrl,
    },
    sns: {
      instagram: contactHints.instagram,
      youtube: contactHints.youtube,
      kakao: contactHints.kakao,
      naver: contactHints.naver,
    },
  };
}

// ────────────── 상품 URL → og:image 자동 채움 (★ 2026-07-13 디자인 3.0) ──────────────

/** 외부 fetch 허용 판정 — 사설/내부 호스트 차단 (행사 원문의 사용자 입력 URL을 서버가 fetch하는 경로라 SSRF 가드 동반) */
function isFetchableProductUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (!host.includes('.')) return false; // localhost·단일 라벨 호스트 차단
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    return true;
  } catch {
    return false;
  }
}

// ── ★ 2026-07-13 DNS 해석 레벨 SSRF 가드 (Codex 적대 리뷰 지적 정정) ──
// 호스트명 문자열 검사만으로는 "공개 도메인이 사설 IP로 풀리는" 우회를 못 막는다 →
// fetch 직전 홉마다 DNS 해석 결과(전 주소)가 공인망인지 확인. 하나라도 사설/예약 = 차단(보수).
// 한계: 조회↔fetch 사이 재바인딩(TOCTOU)은 이 층에서 못 막는다 — 소켓 IP 고정은 별도 과제로 문서화.

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

/** 사설/예약 IP 판정 (순수 — SSRF 가드 회귀 테스트용 export) */
export function isPrivateIp(addr: string): boolean {
  const ip = addr.toLowerCase();
  if (ip.includes(':')) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);  // v4-mapped v6
    if (mapped) return isPrivateIpV4(mapped[1]);
    if (ip === '::' || ip === '::1') return true;                  // 미지정·루프백
    if (/^f[cd]/.test(ip)) return true;                            // fc00::/7 ULA
    if (/^fe[89ab]/.test(ip)) return true;                         // fe80::/10 링크로컬
    if (/^ff/.test(ip)) return true;                               // 멀티캐스트
    return false;
  }
  return isPrivateIpV4(ip);
}

/** 호스트명 → 검증된 공인 주소 1개 (전 해석 주소가 공인이어야 통과 — 하나라도 사설이면 차단). */
async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: number } | null> {
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

const MAX_HTML_BYTES = 200_000;

/** 검증된 IP로 연결을 고정한 단발 GET (Codex 2R 정정) —
 *  ① lookup 콜백이 검증 주소만 돌려줘 fetch류의 자체 DNS 재해석(리바인딩 창)을 제거.
 *     TLS SNI·인증서 검증은 host(호스트명) 기준 그대로 유지.
 *  ② 본문은 스트리밍으로 MAX_HTML_BYTES에서 절단(og 메타는 <head>라 충분) — 거대 응답 메모리 압박 차단.
 *     Content-Length가 상한 초과로 선언된 응답은 즉시 거절. */
function requestPinned(
  urlStr: string,
  pinned: { address: string; family: number },
  timeoutMs: number,
): Promise<{ status: number; location?: string; body?: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    // ★ 2026-07-14 (Codex 5R) — options.timeout은 "무활동" 타임아웃이라 잘게 흘리는(trickle) 응답이
    //   요청을 무기한 붙잡는다 → 벽시계 절대 마감을 별도로 걸고 모든 종료 경로에서 해제.
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const settleResolve = (v: { status: number; location?: string; body?: string }) => {
      if (settled) return; settled = true;
      if (deadline) clearTimeout(deadline);
      resolve(v);
    };
    const settleReject = (e: Error) => {
      if (settled) return; settled = true;
      if (deadline) clearTimeout(deadline);
      reject(e);
    };
    const req = mod.request(
      {
        protocol: u.protocol,
        host: u.hostname,
        port: u.port || (u.protocol === 'https:' ? '443' : '80'),
        path: `${u.pathname}${u.search}` || '/',
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        lookup: ((_h: string, _o: unknown, cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) =>
          cb(null, pinned.address, pinned.family)) as never,
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400) {
          const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
          res.destroy(); // redirect 본문은 읽지 않음(무제한 drain 차단)
          settleResolve({ status, location });
          return;
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
          res.destroy();
          settleReject(new Error('response too large'));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          if (settled) return;
          const room = MAX_HTML_BYTES - size;
          if (c.length >= room) {
            chunks.push(c.subarray(0, room));
            res.destroy(); // 상한 도달 — 여기까지만 사용(og 메타는 head에 있음)
            settleResolve({ status, body: Buffer.concat(chunks).toString('utf8') });
            return;
          }
          size += c.length;
          chunks.push(c);
        });
        res.on('end', () => settleResolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (e) => settleReject(e));
      },
    );
    deadline = setTimeout(() => {
      req.destroy(new Error('deadline'));
      settleReject(new Error('deadline'));
    }, timeoutMs);
    req.on('timeout', () => { req.destroy(new Error('timeout')); settleReject(new Error('timeout')); });
    req.on('error', (e) => settleReject(e as Error));
    req.end();
  });
}

/** 리다이렉트 홉(최대 3)마다 호스트 가드를 재검증하는 HTML fetch — 공개 URL이 내부 주소로 redirect하는 우회 차단 (Codex 지적).
 *  ★ 2026-07-13 (Codex 2R) — 홉마다 DNS 해석 → 공인 검증 → 그 IP로 연결 고정(requestPinned) + 바이트 상한. */
async function fetchHtmlGuarded(url: string): Promise<{ html: string; baseUrl: string } | null> {
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    if (!isFetchableProductUrl(current)) return null;
    let pinned: { address: string; family: number } | null = null;
    try {
      pinned = await resolvePublicAddress(new URL(current).hostname.toLowerCase());
    } catch {
      return null;
    }
    if (!pinned) return null;
    try {
      const res = await requestPinned(current, pinned, FETCH_TIMEOUT_MS);
      if (res.status >= 300 && res.status < 400) {
        if (!res.location) return null;
        current = new URL(res.location, current).toString();
        continue; // 다음 홉에서 가드·해석·고정 재검증
      }
      if (res.status < 200 || res.status >= 300 || !res.body) return null;
      return { html: res.body, baseUrl: new URL(current).origin };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 상품 URL 배열 → 각 페이지의 og:image URL 배열 (순서 보존, 실패/미지원 = undefined).
 * 행사 원문 추출 상품에 이미지를 자동으로 채우는 용도. 전 URL 병렬(최대 8개 — 추출기 상한과 동일).
 */
export async function fetchProductOgImages(urls: Array<string | undefined>): Promise<Array<string | undefined>> {
  return Promise.all(urls.map(async (url) => {
    if (!url) return undefined;
    try {
      const page = await fetchHtmlGuarded(url);
      if (!page) return undefined;
      const meta = parseMetaTags(page.html);
      const og = meta.get('og:image') || meta.get('og:image:url') || meta.get('twitter:image');
      if (!og) return undefined;
      const abs = toAbsoluteUrl(og, page.baseUrl);
      return abs && /^https?:\/\//i.test(abs) ? abs : undefined;
    } catch {
      return undefined;
    }
  }));
}

/**
 * BrandExtractResult → DmBrandKit 부분값으로 변환.
 * 사용자가 UI에서 확인 후 updateCompanyBrandKit으로 적용.
 */
export function toBrandKitPatch(result: BrandExtractResult): Partial<DmBrandKit> {
  const patch: Partial<DmBrandKit> = {};
  if (result.logo_url) patch.logo_url = result.logo_url;
  if (result.primary_color) patch.primary_color = result.primary_color;
  if (result.contact && (result.contact.phone || result.contact.email || result.contact.website)) {
    patch.contact = {
      phone: result.contact.phone,
      email: result.contact.email,
      website: result.contact.website,
    };
  }
  if (result.sns && (result.sns.instagram || result.sns.youtube || result.sns.kakao || result.sns.naver)) {
    patch.sns = {
      instagram: result.sns.instagram,
      youtube: result.sns.youtube,
      kakao: result.sns.kakao,
      naver: result.sns.naver,
    };
  }
  return patch;
}
