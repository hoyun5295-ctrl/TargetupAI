/**
 * utils/cdp-display.ts — 자사몰 연동 표시 라벨·포맷 CT (★2026-08-10 Phase 5)
 *
 * ⛔ 자사몰 화면의 라벨 표와 숫자 포맷은 여기 하나만 둔다.
 *   페이지를 컴포넌트로 가르면서 같은 표가 두 벌이 되기 쉬운 자리라(한쪽만 고쳐지는 죽은 사본),
 *   가르기 **전에** 단일 출처로 올린다.
 *
 * source 라벨은 `cdp_events.source`·`customers.primary_source` 실값 기준이다 —
 * 식별자 매핑(화면 키 ↔ DB provider ↔ 이벤트 source) 자체는 `cdp-provider-keys.ts`가 소유하고,
 * 여기는 **사람에게 보여줄 이름**만 갖는다. 두 파일의 역할을 섞지 않는다.
 */

export const SOURCE_LABEL: Record<string, string> = {
  custom_sdk: '자체 SDK',
  cdp_self_hosted: '자체 호스팅',
  cafe24: '카페24',
  shopify: 'Shopify',
  makeshop: '메이크샵',
  imweb: 'imweb',
  sixshop: '식스샵',
  woocommerce: 'WooCommerce',
  naver: '네이버 스마트스토어',
  sync: '싱크에이전트',
  upload: '파일 업로드',
  manual: '수동 입력',
};

export const CHANNEL_LABEL: Record<string, string> = {
  KAKAO: '알림톡',
  LMS: '장문 SMS',
  SMS: '단문 SMS',
  EMAIL: '이메일',
  WEB_PUSH: '웹 푸시',
  IN_APP: '인앱',
  NONE: '발송 불가',
};

export const CHANNEL_COLOR: Record<string, string> = {
  KAKAO: '#fbbf24',
  LMS: '#a78bfa',
  SMS: '#60a5fa',
  EMAIL: '#34d399',
  WEB_PUSH: '#fb7185',
  IN_APP: '#22d3ee',
  NONE: '#64748b',
};

export const formatPct = (n: number) => `${(n * 100).toFixed(1)}%`;
export const formatWon = (n: number) => `${Math.round(n).toLocaleString()}원`;
