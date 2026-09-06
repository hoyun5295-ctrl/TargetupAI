/**
 * ★ 2026-09-06 AI 영업 아웃리치 S1 — 렌더 크롤 가드 판정(순수 · 네트워크 0 · DB 0)
 * 설계 = docs/2026-09-06-campaign-engine-design.md §S1
 *
 * 왜 별도 파일인가: 렌더 워커(workers/outreach-render-worker.ts)와 계약 테스트가 같은 판정을 공유한다.
 * 워커 안에 인라인으로 두면 테스트가 크롬을 띄워야 한다. 판정은 전부 문자열 입력 → 값 출력이다.
 *
 * 판정 셋:
 *  ① 문서 이동(main frame navigation)은 처음 호스트와 같은 사이트(등록 가능 도메인 기준)만 허용 — 지역 리다이렉트·로그인 이탈 차단.
 *  ② 서브리소스(image·stylesheet·script·font·xhr·fetch)는 허용, media·websocket·eventsource·ping·other 는 차단.
 *  ③ CONNECT 대상(host:port) 파싱 — 프록시가 여기서 얻은 호스트를 DNS 가드(resolvePublicAddress)에 넘긴다.
 * IP 사설 판정은 여기 없다 — utils/dm/dm-brand-extractor.ts 의 isPrivateIp·resolvePublicAddress 가 유일한 소유자다(불변 7).
 */

/** 등록 가능 도메인 앞에 붙는 관용 서브도메인 */
const LEADING_SUBDOMAINS = /^(www|m|shop|store|mobile|kr|ko|en|jp|global)\./i;

/** 2단계 공용 접미사(co.kr 등) — 마지막 두 라벨만 비교하면 a.co.kr 과 b.co.kr 이 같은 사이트가 된다 */
const SECOND_LEVEL_SUFFIX = /^(co|or|ne|go|ac|re|pe|hs|ms|es|sc|kg|mil)\.kr$|^(co|com|net|org|ac|gov|edu)\.(jp|uk|au|nz|in|sg|hk|tw|id|th|vn|my|ph)$|^com\.(cn|br|mx|tr|ar)$/i;

export function normalizeHost(host: string): string {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '');
}

/** 등록 가능 도메인(휴리스틱) — isoi.co.kr · innisfree.com · shop.brand.co.kr → brand.co.kr */
export function registrableDomain(host: string): string {
  const h = normalizeHost(host);
  if (!h || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return h;
  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return h;
  const lastTwo = labels.slice(-2).join('.');
  if (SECOND_LEVEL_SUFFIX.test(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

/** 처음 호스트와 같은 사이트인가(문서 이동 허용 기준). 관용 서브도메인 차이는 같은 사이트로 본다. */
export function isSameSite(initialHost: string, host: string): boolean {
  const a = registrableDomain(normalizeHost(initialHost).replace(LEADING_SUBDOMAINS, ''));
  const b = registrableDomain(normalizeHost(host).replace(LEADING_SUBDOMAINS, ''));
  return !!a && a === b;
}

export type ResourceDecision = 'allow' | 'abort';

/** 차단 리소스 유형 — 스트리밍·양방향·비콘. 렌더 결과(DOM)에 기여하지 않고 예산만 먹는다. */
const BLOCKED_RESOURCE_TYPES = new Set(['media', 'websocket', 'eventsource', 'ping', 'other', 'texttrack', 'manifest', 'signedexchange', 'cspviolationreport']);

/** 요청 1건의 허용/차단(순수). http(s) 외 스킴 차단 · 문서 이동은 같은 사이트 + 메인 프레임만 · 서브프레임 문서 차단. */
export function decideRequest(input: { resourceType: string; url: string; initialHost: string; isMainFrame: boolean }): ResourceDecision {
  let u: URL;
  try { u = new URL(input.url); } catch { return 'abort'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'abort';
  const type = String(input.resourceType || '').toLowerCase();
  if (BLOCKED_RESOURCE_TYPES.has(type)) return 'abort';
  if (type === 'document') {
    if (!input.isMainFrame) return 'abort';
    return isSameSite(input.initialHost, u.hostname) ? 'allow' : 'abort';
  }
  return 'allow';
}

/** CONNECT 요청 대상 "host:port" → {host, port}. IPv6 대괄호 허용. 포트 없음 = 443. 형식 불명 = null. */
export function parseConnectTarget(target: string): { host: string; port: number } | null {
  const t = String(target || '').trim();
  if (!t) return null;
  const v6 = t.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
  if (v6) {
    const port = v6[2] ? Number(v6[2]) : 443;
    return port > 0 && port <= 65535 ? { host: v6[1].toLowerCase(), port } : null;
  }
  const m = t.match(/^([^:/\s]+)(?::(\d{1,5}))?$/);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : 443;
  if (!(port > 0 && port <= 65535)) return null;
  return { host: m[1].toLowerCase(), port };
}

/** 프록시가 허용하는 목적지 포트 — 웹 자산만(80·443·8080·8443). 그 밖(22·25·3306·5432·6379…)은 연결 자체를 거절한다. */
export const ALLOWED_PROXY_PORTS: ReadonlySet<number> = new Set([80, 443, 8080, 8443]);

export function isAllowedProxyPort(port: number): boolean {
  return ALLOWED_PROXY_PORTS.has(port);
}

/** 렌더 예산 기본값 — 잡당 벽시계 25초(sweeper 좀비 15분 대비 충분히 짧다) · 총 바이트 20MB · HTML 직렬화 3MB · 텍스트 20,000자 */
export const RENDER_DEFAULTS = {
  deadlineMs: 25_000,
  maxDeadlineMs: 45_000,
  maxBytes: 20_000_000,
  maxHtmlChars: 3_000_000,
  maxTextChars: 20_000,
  /** 문서 이동(리다이렉트 포함) 상한 — 홈 1회 + 리다이렉트 3홉 */
  maxNavigations: 4,
  /** 스크린샷 최대 높이(px) — 무한 스크롤 페이지 폭주 차단 */
  maxScreenshotHeight: 6_000,
} as const;

/** 잡당 벽시계 상한 결정(순수) — 호출부 요청값을 [3초, maxDeadlineMs]로 묶는다 */
export function clampDeadline(requested: number | undefined | null): number {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return RENDER_DEFAULTS.deadlineMs;
  return Math.max(3_000, Math.min(RENDER_DEFAULTS.maxDeadlineMs, Math.floor(n)));
}

export interface RenderMeta {
  engine: 'chrome';
  elapsedMs: number;
  /** 프록시가 센 업스트림 바이트(정확) */
  bytes: number;
  blockedRequests: number;
  navigations: number;
  textChars: number;
  imgCount: number;
  imgWide: number;
  /** 크롬 sandbox 사용 여부 — false 는 서버가 사용자 네임스페이스를 막아 --no-sandbox 로 기동한 경우(로그·문서로 남긴다) */
  sandbox: boolean;
  timedOut: boolean;
}
