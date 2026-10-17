/**
 * mall-providers.ts — 이 회사(이 담당자)가 상품을 불러올 수 있는 몰 목록 CT (★ 2026-10-17 · 설계서 docs/2026-10-17-oneline-steps-modal-design.md §3-1 · §6)
 *
 * 옛: `/api/mall-products/providers` 라우트 안에 있었고 카페24 연동 상태를 보지 않아 휴면 · 해제 카페24 도 「연동됨」으로 셌다
 *   (`getCafe24Integration` 은 상태를 거르지 않는다 · 재조회는 status active 만 받는다 → 검색 · 확정이 늘 실패).
 * 이제 피커 탭 · 한 줄 단계 판정 · 한 줄 몰 후보가 같은 함수를 쓴다(판정 한 벌).
 *
 * ⛔ relookup = 상품번호로 다시 읽을 수 있는 몰(카페24 활성 · 우커머스). 네이버는 검색은 되지만 재조회가 없어 한 줄 확정에 못 쓴다.
 */
import { getCafe24Integration } from './cafe24-client';
import { getNaverCommerceIntegration } from './naver-commerce-client';
import { listWooIntegrations } from './woocommerce-client';
import { canTouchIntegration, type IntegrationActor } from './integration-scope';

export interface MallProviderEntry {
  provider: string;
  label: string;
  /** 상품번호로 다시 읽을 수 있는가(한 줄 확정 · 단계 판정에 쓸 수 있는 몰) */
  relookup: boolean;
  /** 몰 첫 화면 주소(버튼 주소 기본값 후보) */
  home: string | null;
}

/**
 * 연동 몰 목록. `relookupOnly` 면 재조회 가능한 몰만. 몰마다 따로 시도한다 — 한 몰 조회가 실패해도 나머지를 돌려주고
 * `failed` 로 「모름」을 알린다(「없음」과 「확인하지 못함」을 한 값으로 접지 않는다 · LESSONS_BACKEND 79).
 */
export async function listMallProviders(companyId: string, actor: IntegrationActor, opts: { relookupOnly?: boolean } = {}): Promise<{ list: MallProviderEntry[]; failed: boolean }> {
  const list: MallProviderEntry[] = [];
  let failed = false;
  try {
    const cafe = await getCafe24Integration(companyId);
    if (cafe && cafe.status === 'active') list.push({ provider: 'cafe24', label: '카페24', relookup: true, home: `https://${cafe.mallId}.cafe24.com/` });
  } catch { failed = true; }
  if (!opts.relookupOnly) {
    try {
      const naver = await getNaverCommerceIntegration(companyId);
      if (naver) list.push({ provider: 'naver', label: '네이버 스마트스토어', relookup: false, home: null });
    } catch { failed = true; }
  }
  try {
    // 우커머스 — 몰별 탭(해제 몰 제외 · Store API 가 공개라 연결 검증 전에도 상품은 읽힌다) · 사용자는 자기 분류코드 몰만
    const woo = (await listWooIntegrations(companyId)).filter((m) => canTouchIntegration(actor, m.storeCode));
    for (const m of woo) list.push({ provider: `woocommerce:${m.mallId}`, label: `우커머스 · ${m.mallId}`, relookup: true, home: m.siteUrl || null });
  } catch { failed = true; }
  return { list, failed };
}
