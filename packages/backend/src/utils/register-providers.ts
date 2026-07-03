/**
 * ★ CDP Provider 등록 단일 출처 — 2026-06-25 (gap 7: routes/cdp.ts import 부수효과 의존 제거)
 *   app.ts 부팅 시 1회 import로 모든 어댑터를 registry에 등록. 로드 순서 취약성 차단.
 *   스켈레톤 2종(makeshop/imweb)은 provider-registry.ts 모듈 로드 시 자동 등록. (shopify/sixshop/woocommerce는 2026-07-04 제거 — 자체 호스팅 webhook 흡수)
 */
import { registerProvider } from './provider-registry';
import { cafe24Adapter } from './cafe24-client';
import { naverSmartStoreAdapter } from './naver-commerce-client';
import { customSelfHostedAdapter } from './custom-self-hosted-adapter';
import { godoAdapter } from './godo-adapter';
import { gabiaAdapter } from './gabia-adapter';
import { imwebAdapter } from './imweb-client';

let registered = false;

/** 멱등 — 부팅 1회. 중복 register는 Map 덮어쓰기라 무해. */
export function registerAllProviders(): void {
  if (registered) return;
  registerProvider(cafe24Adapter);
  registerProvider(naverSmartStoreAdapter);
  registerProvider(customSelfHostedAdapter);
  registerProvider(godoAdapter);
  registerProvider(gabiaAdapter);
  registerProvider(imwebAdapter);
  registered = true;
}
