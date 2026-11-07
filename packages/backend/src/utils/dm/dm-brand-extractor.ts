/**
 * dm-brand-extractor.ts — 외부 페이지 보호 요청 · 상품 og:image · 행사 원문 글
 *
 * 기능:
 *  1. 보호된 외부 요청(fetchHtmlGuarded · 사설 주소 차단 · 홉마다 DNS 고정)
 *  2. 상품 URL → og:image(fetchProductOgImages) · 행사 원문 글(extractEventTextFromHtml)
 *
 * 정책:
 *  - User-Agent 설정 (일부 사이트가 봇 차단)
 *  - 5초 timeout
 *  - 리다이렉트 허용 (최대 3회)
 *  - 상대 URL은 base URL로 absolute 변환
 *
 * 소비처: 보호된 외부 요청(fetchHtmlGuarded) · 상품 og:image · 행사 원문 글 — ★ 2026-11-07 C113 K18 = 브랜드 키트 URL 추출(메인 추출 · 패치 변환)은
 *  쓰는 곳 0(화면 모달이 07-21 제거된 뒤 남은 사슬)이라 지웠다.
 */

import http from 'node:http';
import https from 'node:https';
import { isPrivateIp, resolvePublicAddress, pinnedLookup } from '../outbound-guard';

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

// ── ★ 2026-07-13 DNS 해석 레벨 SSRF 가드 → ★ 2026-10-27 utils/outbound-guard.ts 로 옮김(자사몰 대비 K8 · 판정기 한 곳) ──
// 이 파일은 그대로 부르고 옛 import 자리(렌더 워커 · 시험)를 위해 재export 한다.
export { isPrivateIp, resolvePublicAddress, pinnedLookup };

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
  maxBytes: number = MAX_HTML_BYTES,
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
        lookup: pinnedLookup(pinned) as never,
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
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          settleReject(new Error('response too large'));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          if (settled) return;
          const room = maxBytes - size;
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
 *  ★ 2026-07-13 (Codex 2R) — 홉마다 DNS 해석 → 공인 검증 → 그 IP로 연결 고정(requestPinned) + 바이트 상한.
 *  ★ 2026-08-24 export — 영업 아웃리치 크롤이 재사용(가드 없는 extractBrandFromUrl 경로는 아웃리치에서 사용 금지). */
/** 본문 상한·타임아웃 선택 인자(★ 2026-09-05) — 기본은 현행(200KB · 5초 · og 메타용). 페이지 전체가 필요한 소비처(아웃리치 재료 수집)만 올려 쓴다.
 *  200KB 절단이 상품·갤러리를 잘라 아웃리치 DM이 빈 껍데기가 됐다(이니스프리 395KB 실측). 기존 호출부 5곳은 인자를 안 넘기므로 동작 무변경. */
export interface FetchHtmlOptions { maxBytes?: number; timeoutMs?: number }

export async function fetchHtmlGuarded(url: string, opts?: FetchHtmlOptions): Promise<{ html: string; baseUrl: string; finalUrl: string } | null> {
  const timeoutMs = opts?.timeoutMs && opts.timeoutMs > 0 ? Math.min(opts.timeoutMs, 20_000) : FETCH_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes && opts.maxBytes > 0 ? Math.min(opts.maxBytes, 2_000_000) : MAX_HTML_BYTES;
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
      const res = await requestPinned(current, pinned, timeoutMs, maxBytes);
      if (res.status >= 300 && res.status < 400) {
        if (!res.location) return null;
        current = new URL(res.location, current).toString();
        continue; // 다음 홉에서 가드·해석·고정 재검증
      }
      if (res.status < 200 || res.status >= 300 || !res.body) return null;
      // ★ 2026-09-05 finalUrl = 최종 홉 전체 URL(경로 상대 자산 절대화·리다이렉트 호스트 대조용). 기존 호출부는 baseUrl만 읽는다.
      return { html: res.body, baseUrl: new URL(current).origin, finalUrl: current };
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
 * HTML 문자열 → 행사 원문 텍스트. ★ 2026-08-26 fetchEventTextFromUrl 본문을 그대로 옮긴 것(동작 무변경).
 * 이미 HTML을 손에 든 호출자가 같은 URL을 두 번 긁지 않도록 분리했다(영업 아웃리치 크롤).
 * maxLen 기본값 6000 = 옮기기 전 상수. 기본값 호출은 옛 결과와 문자 단위로 같다.
 */
export function extractEventTextFromHtml(html: string, maxLen = 6000): string | null {
  const meta = parseMetaTags(html);
  const head = [meta.get('og:title'), meta.get('og:description')].filter(Boolean).join('\n');
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  const merged = [head, t].filter(Boolean).join('\n');
  return merged ? merged.slice(0, maxLen) : null;
}

/**
 * ★ 2026-07-16 M3 — 행사 URL → 페이지 본문 텍스트 (브리프 입력기 "URL 붙여넣기" 축).
 * fetchHtmlGuarded(SSRF 가드·핀 고정) 재사용. 반환 텍스트는 사용자 입력칸에 넣어
 * 눈으로 확인·보정 후 생성에 쓰인다(이미지 판독과 동일한 사람 검증 이중).
 * 봇 차단 사이트(네이버 스마트스토어 429 실측 등) = null — 호출측이 정직하게 안내.
 */
export async function fetchEventTextFromUrl(url: string): Promise<string | null> {
  const page = await fetchHtmlGuarded(url);
  if (!page) return null;
  return extractEventTextFromHtml(page.html);
}
