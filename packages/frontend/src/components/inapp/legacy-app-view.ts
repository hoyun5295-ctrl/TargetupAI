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
 *   여러 장 그림 4:5 미리 맞춤은 그리는 쪽(PosterSheetPreview overlay 여러 장 = 맞추기)이 같은 결과를 낸다.
 */
export function legacyAppPreviewOf<S extends Record<string, any>>(
  design: Record<string, any> | null | undefined, slides: S[], endAt?: string | number | Date | null,
): { design: Record<string, any>; slides: S[] } {
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
  return { design: d, slides: out };
}

/**
 * ★ 2026-11-08 C116 D11 「구버전 앱 모습」 갈래 = 서버 inAppBakePlan(판 없는 옛 앱) 의 화면 거울(백엔드 계약 시험 c116 이 같은 표본으로 대조).
 *   참 = 서버가 구워 보낸다(틀 · 띠 · 통짜 그대로 그림 · 정지 미리보기) · 거짓 = 지금 대체 거울(legacyAppPreviewOf).
 *   판정 = 틀로 그림(이벤트 카드 · 배너 아님) · 그릴 그림 ≥ 1 · 전부 우리 그림 주소 · 그리는 글에 개인화 낱말 0(통짜 = 글을 그리지 않음).
 *   ⛔ 화면은 회사 · 믿는 호스트 환경값을 모른다 — 우리 그림 = 상대 경로 또는 hanjul.ai · app.hanjul.ai 절대 주소(서버 기본값과 같음).
 */
const OWN_IMG_PATH_RE = /^\/api\/cdp\/inapp\/image\/[^/]+\/[^/?#]+$/;
const OWN_IMG_HOSTS = new Set(['hanjul.ai', 'app.hanjul.ai']);
export function isOwnInAppImageUrl(url: unknown): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  if (u.startsWith('/api/cdp/inapp/image/')) return OWN_IMG_PATH_RE.test(u.split(/[?#]/)[0]);
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return false;
    return OWN_IMG_HOSTS.has(x.hostname.toLowerCase().replace(/\.$/, '')) && OWN_IMG_PATH_RE.test(x.pathname);
  } catch {
    return false;
  }
}
/** 개인화 낱말(%이름% 꼴 · {{ customer.x }}) — 서버 textHasPersonalizationVar 의 화면 근사(표본 대조) */
const PERSONAL_RE = /%[가-힣A-Za-z0-9_]{1,20}%|\{\{\s*customer\./;
export function legacyAppWillBake(input: {
  design: Record<string, any> | null | undefined;
  slides: Array<Record<string, any>>;
  imageUrl?: string | null;
  texts?: Array<unknown>;
}): boolean {
  const d = input.design && typeof input.design === 'object' ? input.design : {};
  const layout = String(d.poster_layout || '');
  if (layout === 'event_card' || layout === 'banner_sheet') return false;
  const has = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  const drawn = (Array.isArray(input.slides) ? input.slides : []).filter((s) => s && has(s.image_url));
  const images = drawn.length > 0 ? drawn.map((s) => s.image_url) : (has(input.imageUrl) ? [input.imageUrl] : []);
  if (images.length === 0 || !images.every(isOwnInAppImageUrl)) return false;
  // 그림에 그리는 칸만(서버 inAppHasPersonalTokens 와 같음 · Codex 구현 1R ④) — 통짜 = 글 칸을 그리지 않고 띠만 · 장 버튼 글 = 앱이 그린다
  const strip = d.poster_strip && typeof d.poster_strip === 'object' ? d.poster_strip : null;
  const texts: unknown[] = [strip?.label, strip?.code];
  if (d.poster_text !== 'baked') {
    texts.push(...(input.texts || []));
    for (const s of drawn) texts.push(s.title, s.body, s.eyebrow, s.subtitle);
  }
  return !texts.some((t) => typeof t === 'string' && PERSONAL_RE.test(t));
}

/** ★ C116 Codex 구현 1R ⑤ 서버 굽기 화면 · 안전 칸(백엔드 INAPP_BAKE_VIEW · ASPECT_RATIOS.inapp.safe 와 같은 값 · 계약 시험 대조) */
export const LEGACY_BAKE_VIEW = { width: 390, height: 844 } as const;
export const LEGACY_BAKE_SAFE = { w: 0.8, h: 0.92 } as const;
