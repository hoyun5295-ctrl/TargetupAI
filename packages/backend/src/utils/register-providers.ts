/**
 * ★ CDP Provider 등록 단일 출처 — 2026-06-25 (gap 7: routes/cdp.ts import 부수효과 의존 제거)
 *   app.ts 부팅 시 1회 import로 모든 어댑터를 registry에 등록. 로드 순서 취약성 차단.
 *   (shopify/sixshop/woocommerce는 2026-07-04 제거 — 자체 호스팅 webhook 흡수. makeshop/imweb는 실 어댑터로 승격.
 *    가비아(퍼스트몰)는 2026-07-06 제거 — 개방 API 폐쇄형(개발자센터·공개 문서 없음)이라 자체 호스팅 흡수. 실고객사/파트너 제휴 시 재추가.)
 */
import { registerProvider } from './provider-registry';
import { cafe24Adapter } from './cafe24-client';
import { naverSmartStoreAdapter } from './naver-commerce-client';
import { customSelfHostedAdapter } from './custom-self-hosted-adapter';
import { godoAdapter } from './godo-adapter';
import { imwebAdapter } from './imweb-client';
import { makeshopAdapter } from './makeshop-client';
// ★ 2026-09-14 우커머스(워드프레스) 전용 어댑터 — 0704 "자체 호스팅 웹훅 흡수"를 뒤집음(우커머스 기본 웹훅은 우리 표준 헤더·본문이 아니라 그대로 안 붙는다)
import { woocommerceAdapter } from './woocommerce-adapter';

let registered = false;

/** 멱등 — 부팅 1회. 중복 register는 Map 덮어쓰기라 무해. */
export function registerAllProviders(): void {
  if (registered) return;
  registerProvider(cafe24Adapter);
  registerProvider(naverSmartStoreAdapter);
  registerProvider(customSelfHostedAdapter);
  registerProvider(godoAdapter);
  registerProvider(imwebAdapter);
  registerProvider(makeshopAdapter);
  registerProvider(woocommerceAdapter);
  registered = true;
}
