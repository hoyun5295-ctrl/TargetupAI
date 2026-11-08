/**
 * legacy-app-view.ts — ★ 2026-11-08 C114 I-2 · K2 옛 앱(웹뷰를 붙이지 않은 앱 · caps 없음)이 실제로 받는 꼴 · React 0 · 순수.
 *   서버 legacyServeTransform(utils/inapp-message.ts) 의 거울 — 백엔드 계약 시험(c114-inapp-serve-1108)이 같은 표본으로 두 함수를 대조한다.
 */

/** 게시 끝 시각 → 「11월 30일 23:59」(한국 시각) — 서버 inAppDeadlineText 와 같은 글(계약 시험이 묶는다) */
export function inAppDeadlineText(endAt: string | number | Date | null | undefined): string | null {
  if (endAt === null || endAt === undefined || endAt === '') return null;
  const ms = endAt instanceof Date ? endAt.getTime() : new Date(endAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const k = new Date(ms + 9 * 3600 * 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${p2(k.getUTCHours())}:${p2(k.getUTCMinutes())}`;
}

/**
 * ★ 2026-11-08 C114 I-2 · K2 편집기 「구버전 앱 모습」 = 서버가 옛 앱(caps 없음)에 실제로 보내는 꼴(서버 legacyServeTransform 거울 · 계약 시험이 표본 표로 묶는다).
 *   틀 지움 · 통짜 = 글 비움 · 띠 = 글 한 줄(통짜면 글 얹기로 내림) · 하루 보지 않기 = 옛 앱에 없다(다시 보지 않기).
 *   ★ C116-B D6 장 그림 주소 = 서버가 실제로 내주는 맞춤 주소(legacyAppImageUrl · 정사각 · 가운데 80% · 무대색 그림을 서버에서 받아 그린다 · 그리개 손대지 않음).
 *   unknown = 호스트 목록을 아직 몰라 주소를 정할 수 없는 장이 있음(두 자리 = 확인 중 · 실패 칸).
 */
export function legacyAppPreviewOf<S extends Record<string, any>>(
  design: Record<string, any> | null | undefined, slides: S[], endAt: string | number | Date | null | undefined, hosts: OwnHostsSnapshot,
  flatImageUrl?: string | null,
): { design: Record<string, any>; slides: S[]; unknown: boolean; full: boolean } {
  const { poster_frame: _f, dismiss_mode: _d, ...base } = design || {};
  let d: Record<string, any> = base;
  const baked = d.poster_text === 'baked';
  let out: S[] = baked
    ? slides.map((s) => { const { title: _t, body: _b, eyebrow: _e, subtitle: _s, ...rest } = s; return rest as S; })
    : slides.slice();
  const strip = d.poster_strip && typeof d.poster_strip === 'object' ? d.poster_strip : null;
  if (strip && (strip.type === 'coupon' || strip.type === 'countdown')) {
    const line = strip.type === 'coupon'
      ? (String(strip.code || '').trim() ? `쿠폰 코드 ${String(strip.code).trim()}` : '')
      : (inAppDeadlineText(endAt) ? `${inAppDeadlineText(endAt)}까지` : '');
    const { poster_strip: _p, ...r1 } = d;
    d = r1;
    if (line) {
      if (d.poster_text === 'baked') { const { poster_text: _t, ...r2 } = d; d = r2; }
      out = out.map((s, i) => (i === 0 ? { ...s, body: String(s.body ?? '').trim() ? `${String(s.body).trim()}\n${line}` : line } : s));
    }
  }
  let unknown = false;
  // ★ C118 B2 그리는 그림 전부 인앱용(`.full.`) = 여백 0(inappfull) · 서버 inAppAllFullBleed 거울(장 없으면 flat 그림)
  const drawnUrls = out.filter((s) => s && typeof s.image_url === 'string' && s.image_url.trim()).map((s) => String(s.image_url));
  const fullUrls = drawnUrls.length > 0 ? drawnUrls : (flatImageUrl && String(flatImageUrl).trim() ? [String(flatImageUrl)] : []);
  const full = fullUrls.length > 0 && fullUrls.every((u) => isFullBleedInAppImageUrl(u, hosts));
  out = out.map((s) => {
    if (!s || typeof s.image_url !== 'string') return s;
    const u = legacyAppImageUrl(s.image_url, d, hosts, full);
    if (u === null) { unknown = true; return s; }
    return { ...s, image_url: u };
  });
  return { design: d, slides: out, unknown, full };
}

/**
 * ★ 2026-11-08 C116-B D6 「우리 그림」 판정 = 서버가 내려준 믿는 호스트 목록(GET /api/cdp/inapp/own-image-hosts · 서버 CT trustedImageHosts)으로만.
 *   세 값 = own · foreign · unknown — 목록을 아직 못 받았거나(loading) 실패(error)했고 기본 넷 밖의 절대 주소 = unknown(짐작 0 · Codex 설계 3R ② · 4R ①).
 *   상대 경로(우리 그림 길) = 늘 own(서버 toOwnImageRef 와 같음).
 */
export type OwnHostsSnapshot = { status: 'loading' | 'ready' | 'error'; hosts: ReadonlySet<string> };
/** 서버 trustedImageHosts 의 기본 넷(환경값 없이도 늘 든 값 · brand-image-resolver.ts) */
export const DEFAULT_OWN_IMAGE_HOSTS: ReadonlySet<string> = new Set(['hanjul.ai', 'app.hanjul.ai', 'localhost', '127.0.0.1']);
export type InAppImageOwnership = 'own' | 'foreign' | 'unknown';
const OWN_IMG_PATH_RE = /^\/api\/cdp\/inapp\/image\/[^/]+\/[^/?#]+$/;
export function inAppImageOwnership(url: unknown, hosts: OwnHostsSnapshot): InAppImageOwnership {
  const u = String(url || '').trim();
  if (!u) return 'foreign';
  if (u.startsWith('/api/cdp/inapp/image/')) return OWN_IMG_PATH_RE.test(u.split(/[?#]/)[0]) ? 'own' : 'foreign';
  let x: URL;
  try { x = new URL(u); } catch { return 'foreign'; }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') return 'foreign';
  if (!OWN_IMG_PATH_RE.test(x.pathname)) return 'foreign';
  const host = x.hostname.toLowerCase().replace(/\.$/, '');
  if (hosts.hosts.has(host)) return 'own';
  if (hosts.status === 'ready') return 'foreign';
  return DEFAULT_OWN_IMAGE_HOSTS.has(host) ? 'own' : 'unknown';
}

/**
 * ★ 2026-11-08 C116 D11 · C116-B 「구버전 앱 모습」 갈래 = 서버 inAppBakePlan(caps 없음) 의 화면 거울(백엔드 계약 시험이 같은 표본으로 대조).
 *   참 = 서버가 구워 보낸다 · 거짓 = 대체 거울(legacyAppPreviewOf) · unknown = 호스트 목록을 아직 몰라 판정 보류(두 자리 = 확인 중 · 실패 칸).
 *   판정 = 틀로 그림(이벤트 카드 · 배너 아님) · 그릴 그림 ≥ 1 · 전부 우리 그림 · 그리는 글에 개인화 낱말 0(통짜 = 글을 그리지 않음).
 *   확정 거짓(바깥 그림 · 개인화 · 레이아웃)이 하나라도 있으면 unknown 보다 먼저 거짓.
 */
/** 개인화 낱말(%이름% 꼴 · {{ customer.x }}) — 서버 textHasPersonalizationVar 의 화면 근사(표본 대조) */
const PERSONAL_RE = /%[가-힣A-Za-z0-9_]{1,20}%|\{\{\s*customer\./;
export function legacyAppWillBake(input: {
  design: Record<string, any> | null | undefined;
  slides: Array<Record<string, any>>;
  imageUrl?: string | null;
  texts?: Array<unknown>;
}, hosts: OwnHostsSnapshot): boolean | 'unknown' {
  const d = input.design && typeof input.design === 'object' ? input.design : {};
  const layout = String(d.poster_layout || '');
  if (layout === 'event_card' || layout === 'banner_sheet') return false;
  const has = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  const drawn = (Array.isArray(input.slides) ? input.slides : []).filter((s) => s && has(s.image_url));
  const images = drawn.length > 0 ? drawn.map((s) => s.image_url) : (has(input.imageUrl) ? [input.imageUrl] : []);
  if (images.length === 0) return false;
  const owned = images.map((u) => inAppImageOwnership(u, hosts));
  if (owned.includes('foreign')) return false;
  // 그림에 그리는 칸만(서버 inAppHasPersonalTokens 와 같음 · Codex 구현 1R ④) — 통짜 = 글 칸을 그리지 않고 띠만 · 장 버튼 글 = 앱이 그린다
  const strip = d.poster_strip && typeof d.poster_strip === 'object' ? d.poster_strip : null;
  const texts: unknown[] = [strip?.label, strip?.code];
  if (d.poster_text !== 'baked') {
    texts.push(...(input.texts || []));
    for (const s of drawn) texts.push(s.title, s.body, s.eyebrow, s.subtitle);
  }
  if (texts.some((t) => typeof t === 'string' && PERSONAL_RE.test(t))) return false;
  if (owned.includes('unknown')) return 'unknown';
  // ★ C118 B2 통짜 시트(띠 · 카드 0) + 전부 인앱용 그림 = 그림이 곧 완성본 → 굽지 않고 원본(서버 inAppBakePlan 과 같은 갈래)
  const stripType = strip ? String((strip as any).type || '') : '';
  if (images.every((u) => isFullBleedInAppImageUrl(u, hosts)) && d.poster_text === 'baked' && d.poster_frame !== 'card' && stripType !== 'coupon' && stripType !== 'countdown') return false;
  return true;
}
/** ★ C118 B2 여백 0 으로 굽는가 = 전부 인앱용 그림 + 시트 틀 + 띠 0(서버 inAppBakePlan fullCompose 거울 · 구운 모습 미리보기 = 여백 0 · 정지 모서리 0) */
export function legacyAppBakesFull(slides: Array<Record<string, any>>, imageUrl: string | null | undefined, hosts: OwnHostsSnapshot, design?: Record<string, any> | null): boolean {
  const d = design && typeof design === 'object' ? design : {};
  const strip = d.poster_strip && typeof d.poster_strip === 'object' ? String(d.poster_strip.type || '') : '';
  if (d.poster_frame === 'card' || strip === 'coupon' || strip === 'countdown') return false;
  const has = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  const drawn = (Array.isArray(slides) ? slides : []).filter((s) => s && has(s.image_url)).map((s) => s.image_url);
  const images = drawn.length > 0 ? drawn : (has(imageUrl) ? [imageUrl] : []);
  return images.length > 0 && images.every((u) => isFullBleedInAppImageUrl(u, hosts));
}

/**
 * ★ C116-B D1 · D6 대체 길 그림 주소 = 서버 withInAppImageFit(정규화) + legacyServeTransform 레이아웃 갈래의 거울.
 *   이벤트 카드 · 배너 시트 = 그대로 · 다른 fit 값 = 그대로 · 우리 그림 · 예시 그림 = 우리 맞춤 표시를 걷고 지금 판을 붙임 · 바깥 = 그대로 · unknown = null.
 */
export const LEGACY_FIT_REV = 2;
/** ★ C118 B2 서버 ASPECT_RATIOS.inappfull.rev 와 같은 값(계약 시험 대조) */
export const LEGACY_FULL_FIT_REV = 1;
const EXAMPLE_IMG_RE = /^\/api\/cdp\/inapp\/example-image\/[^/?#]+\/\d+$/;
export function legacyAppImageUrl(url: unknown, design: Record<string, any> | null | undefined, hosts: OwnHostsSnapshot, full = false): string | null {
  const raw = String(url ?? '').trim();
  if (!raw) return raw;
  const layout = String((design && typeof design === 'object' ? design.poster_layout : '') || '');
  if (layout === 'event_card' || layout === 'banner_sheet') return raw;
  const h = raw.indexOf('#');
  const hash = h >= 0 ? raw.slice(h) : '';
  const noHash = h >= 0 ? raw.slice(0, h) : raw;
  const q = noHash.indexOf('?');
  const base = q >= 0 ? noHash.slice(0, q) : noHash;
  const params = q >= 0 ? noHash.slice(q + 1).split('&').filter(Boolean) : [];
  const keyOf = (p: string) => p.split('=')[0];
  if (params.some((p) => keyOf(p) === 'fit' && p !== 'fit=inapp' && p !== 'fit=inappfull')) return raw;
  if (!EXAMPLE_IMG_RE.test(base)) {
    const own = inAppImageOwnership(base, hosts);
    if (own === 'foreign') return raw;
    if (own === 'unknown') return null;
  }
  const rest = params.filter((p) => keyOf(p) !== 'fit' && keyOf(p) !== 'fr');
  return `${base}?${[...rest, full ? `fit=inappfull&fr=${LEGACY_FULL_FIT_REV}` : `fit=inapp&fr=${LEGACY_FIT_REV}`].join('&')}${hash}`;
}

/** ★ C118 B2 스튜디오 인앱용 그림 = 우리 그림 길 + 파일 이름 `.full.`(서버 isFullBleedInAppImage 거울 · 그림을 바꾸면 주소가 바뀌어 저절로 빠진다) */
const FULL_BLEED_PATH_RE = /^\/api\/cdp\/inapp\/image\/[^/]+\/[^/?#]+\.full\.[a-z]{3,4}$/i;
export function isFullBleedInAppImageUrl(url: unknown, hosts?: OwnHostsSnapshot): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  let path = u.split(/[?#]/)[0];
  if (!path.startsWith('/')) {
    try { path = new URL(u).pathname; } catch { return false; }
    if (hosts && inAppImageOwnership(u.split(/[?#]/)[0], hosts) !== 'own') return false;
  }
  return FULL_BLEED_PATH_RE.test(path);
}

/** ★ C116 Codex 구현 1R ⑤ · C116-B 서버 굽기 화면 · 안전 칸 · 무대색(백엔드 INAPP_BAKE_VIEW · ASPECT_RATIOS.inapp · INAPP_STAGE_FILL 과 같은 값 · 계약 시험 대조) */
export const LEGACY_BAKE_VIEW = { width: 390, height: 844 } as const;
export const LEGACY_BAKE_SAFE = { w: 0.8, h: 0.8 } as const;
export const LEGACY_STAGE_FILL = '#111827';
/** 장 무대색 = 장 bg_color(3 · 6자리 hex) · 아니면 기본(서버 inAppStageColor 와 같음) */
export function legacyStageOf(bg: unknown): string {
  const v = typeof bg === 'string' ? bg.trim() : '';
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : LEGACY_STAGE_FILL;
}
