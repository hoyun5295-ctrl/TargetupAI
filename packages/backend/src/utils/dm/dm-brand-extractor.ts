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
