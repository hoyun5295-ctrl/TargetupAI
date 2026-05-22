/**
 * ★ CT-49: 한국 자사몰 도메인 인지 + external_id 추출 — D190 #1 (2026-05-22)
 *
 * 단축 URL 클릭 시 target URL이 한국 자사몰 도메인이면 자동 인지 + external_id 추출
 * → cdp_identity_links 자동 매칭 (한국 네이티브 최적화 본질)
 *
 * 지원 자사몰 5종 + 글로벌 2종:
 *   - 카페24 (cafe24.com)
 *   - 네이버 스마트스토어 (smartstore.naver.com / shopping.naver.com)
 *   - 메이크샵 (makeshop.co.kr)
 *   - imweb (imweb.me / imweb.com)
 *   - 식스샵 (sixshop.com)
 *   - Shopify (myshopify.com — 글로벌)
 *   - WooCommerce (도메인 가변 — CDP integration 매트릭스 별 인지)
 *
 * 영구 원칙:
 *   - 추출 실패 시 externalId=null 반환 (인지는 성공)
 *   - 도메인 미인지 시 provider='unknown' 반환 (CDP 매칭 skip)
 *   - 보안: javascript:/data:/file: 차단은 short-url.ts 영역 (본 영역은 인지만)
 */

export type KoreanEcommerceProvider =
  | 'cafe24'
  | 'naver_smartstore'
  | 'makeshop'
  | 'imweb'
  | 'sixshop'
  | 'shopify'
  | 'unknown';

export interface DomainDetectionResult {
  provider: KoreanEcommerceProvider;
  isKoreanEcommerce: boolean;
  externalId: string | null;
}

interface ProviderPattern {
  provider: KoreanEcommerceProvider;
  isKorean: boolean;
  domainRegex: RegExp;
  externalIdExtractors: Array<(url: URL) => string | null>;
}

const PROVIDER_PATTERNS: ProviderPattern[] = [
  {
    provider: 'cafe24',
    isKorean: true,
    // 카페24 표준 도메인 + 커스텀 도메인 (자사몰 운영 시 *.cafe24.com 또는 mall.cafe24.com 패턴)
    domainRegex: /(?:^|\.)cafe24\.com$/i,
    externalIdExtractors: [
      // 카페24 표준 query: ?member_id=XXX / ?mid=XXX / ?user_id=XXX
      (url) => url.searchParams.get('member_id'),
      (url) => url.searchParams.get('mid'),
      (url) => url.searchParams.get('user_id'),
      // path 패턴: /member/XXX
      (url) => {
        const match = url.pathname.match(/\/member\/([^\/\?]+)/);
        return match ? match[1] : null;
      },
    ],
  },
  {
    provider: 'naver_smartstore',
    isKorean: true,
    domainRegex: /(?:^|\.)(?:smartstore|shopping)\.naver\.com$/i,
    externalIdExtractors: [
      // 네이버 스마트스토어: ?nv_mid=XXX / ?member_id=XXX
      (url) => url.searchParams.get('nv_mid'),
      (url) => url.searchParams.get('member_id'),
      // path 패턴: /members/XXX
      (url) => {
        const match = url.pathname.match(/\/members\/([^\/\?]+)/);
        return match ? match[1] : null;
      },
    ],
  },
  {
    provider: 'makeshop',
    isKorean: true,
    domainRegex: /(?:^|\.)makeshop\.co\.kr$/i,
    externalIdExtractors: [
      (url) => url.searchParams.get('member_id'),
      (url) => url.searchParams.get('user_id'),
      (url) => url.searchParams.get('mid'),
    ],
  },
  {
    provider: 'imweb',
    isKorean: true,
    // imweb.me (한국 SaaS) + imweb.com
    domainRegex: /(?:^|\.)(?:imweb\.me|imweb\.com)$/i,
    externalIdExtractors: [
      (url) => url.searchParams.get('member_id'),
      (url) => url.searchParams.get('user_id'),
      (url) => url.searchParams.get('uid'),
    ],
  },
  {
    provider: 'sixshop',
    isKorean: true,
    domainRegex: /(?:^|\.)sixshop\.com$/i,
    externalIdExtractors: [
      (url) => url.searchParams.get('member_id'),
      (url) => url.searchParams.get('mid'),
      (url) => url.searchParams.get('user_id'),
    ],
  },
  {
    provider: 'shopify',
    isKorean: false,
    // Shopify 표준 도메인 (글로벌)
    domainRegex: /(?:^|\.)myshopify\.com$/i,
    externalIdExtractors: [
      // Shopify customer ID: ?customer_id=XXX 또는 path /account/XXX
      (url) => url.searchParams.get('customer_id'),
      (url) => {
        const match = url.pathname.match(/\/account\/([^\/\?]+)/);
        return match ? match[1] : null;
      },
    ],
  },
];

/**
 * URL이 한국 자사몰 (또는 Shopify) 도메인인지 자동 인지 + external_id 추출
 * - 인지 실패 시 provider='unknown', isKoreanEcommerce=false 반환
 * - external_id 추출 실패 시 externalId=null (인지는 성공)
 * - URL 파싱 실패 시 모두 unknown 반환
 */
export function detectKoreanEcommerce(fullUrl: string): DomainDetectionResult {
  let url: URL;
  try {
    url = new URL(fullUrl);
  } catch {
    return { provider: 'unknown', isKoreanEcommerce: false, externalId: null };
  }

  // 보안: http/https 외 protocol 차단 (javascript:/data:/file: 등)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { provider: 'unknown', isKoreanEcommerce: false, externalId: null };
  }

  for (const pattern of PROVIDER_PATTERNS) {
    if (pattern.domainRegex.test(url.hostname)) {
      // external_id 추출 시도 (extractor 순차 호출, 첫 정답 반환)
      let externalId: string | null = null;
      for (const extractor of pattern.externalIdExtractors) {
        try {
          const extracted = extractor(url);
          if (extracted && extracted.trim().length > 0) {
            externalId = extracted.trim();
            break;
          }
        } catch {
          // 추출 실패 — 다음 extractor 시도
        }
      }
      return {
        provider: pattern.provider,
        isKoreanEcommerce: pattern.isKorean,
        externalId,
      };
    }
  }

  return { provider: 'unknown', isKoreanEcommerce: false, externalId: null };
}

/**
 * provider 한글 라벨 반환 (UI 노출용)
 */
export function getKoreanEcommerceLabel(provider: KoreanEcommerceProvider): string {
  const labelMap: Record<KoreanEcommerceProvider, string> = {
    cafe24: '카페24',
    naver_smartstore: '네이버 스마트스토어',
    makeshop: '메이크샵',
    imweb: 'imweb',
    sixshop: '식스샵',
    shopify: 'Shopify',
    unknown: '기타',
  };
  return labelMap[provider];
}

/**
 * 모바일 user-agent 인지 (한국 모바일 점유율 80%+ 정합 — 모바일 우선 정합)
 * - 향후 모바일 URL 자동 정정 영역 (PC/모바일 URL 분리된 자사몰 영역)
 */
export function isMobileUserAgent(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false;
  return /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
}
