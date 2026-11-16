/**
 * dm-reco-order.ts — 상품 묶음(product_carousel)의 「받는 분마다 관심 상품을 앞에」 (★ 2026-11-14 C133 F2 ① · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-4)
 *
 * DM = 여는 순간(뷰어가 그 고객을 아는 때) · 이메일 = 보내는 순간(받는 사람마다) 순서만 바뀐다. 새 내용이 생기지 않는다:
 *   후보 = 담당자가 그 묶음에 넣은 상품들 그대로(그림 · 가격 · 링크 = 고른 값) · 고른 한 상품이 맨 앞으로 갈 뿐이다.
 *   이 파일 = 그 받는 사람에게 **앞세울 자리(reco_front)** 를 묶음에 싣는다 · 순서를 바꿔 그리는 것 = 렌더러(product-signal-text recoOrderedProducts ·
 *   발행 렌더와 이메일 렌더가 reco_order 를 직접 읽는다 = 속성 계약이 그 소비를 탐침으로 확인한다).
 *   고르기 = 여정 문자의 추천 자리와 같은 함수(product-reco pickRecoIndex · 본 뒤 안 산 것 중 가장 최근 → 순서에서 안 산 첫 상품 → 없음 = 저장 순서).
 *   고객을 모르면 · 추천 상품이 닫힌 회사면 · 읽지 못하면 = 저장한 순서 그대로(열람 · 발송을 막지 않는다).
 * ⛔ 예측으로 고르지 않는다(관측한 조회 · 구매 사실의 순서 규칙뿐).
 */
import { v3Live } from '../v3-stage';
import { pickRecoIndex } from '../product-reco';

type AnySection = { type: string; props?: any };

/** 순서 바꾸기를 켠 상품 묶음인가(상품이 둘 이상일 때만 뜻이 있다) — reco_order 를 읽는 한 자리 */
function wantsRecoOrder(s: AnySection): boolean {
  return s?.type === 'product_carousel' && s.props?.reco_order === true && Array.isArray(s.props.products) && s.props.products.length > 1;
}

/**
 * 이 묶음들에 순서 바꾸기를 할 것인가 — 켠 묶음이 하나라도 있고(상품 둘 이상) 그 회사에 추천 상품이 열려 있다.
 *   받는 사람이 여럿인 발송(이메일)은 이 판정을 한 번만 한다(받는 사람마다 요금제를 다시 읽지 않는다).
 */
export async function recoOrderOn(sections: readonly AnySection[], companyId: string): Promise<boolean> {
  if (!companyId || !sections.some(wantsRecoOrder)) return false;
  return v3Live('reco', companyId);
}

/**
 * 그 받는 사람에게 앞세울 자리를 실은 묶음들(입력은 바꾸지 않는다) — 열람 길 · 발송 길이 렌더 직전에 늘 부른다.
 *   on = recoOrderOn 의 답(그 회사에 열려 있고 켠 묶음이 있다). 켠 묶음마다:
 *     on 이고 고객을 알면 그 고객으로 한 번 고른다(product-reco pickRecoIndex · 실패 = null) → 고른 자리 = props.reco_front.
 *     고르지 않는 모든 경우(닫힌 회사 · 모르는 고객 · 못 고름 · 이미 맨 앞)에는 그 칸을 **지운다**.
 *   = 문서에 그 칸이 들어 있어도(편집기는 쓰지 않는 값) 어느 길에서든 받는 사람 자신의 자리이거나 없다. 남의 자리 · 저장된 자리가 그려지는 길 0.
 */
export async function markRecoFront<T extends AnySection>(sections: readonly T[], customerId: string | null | undefined, companyId: string, on: boolean): Promise<T[]> {
  const out: T[] = [];
  for (const s of sections) {
    if (!wantsRecoOrder(s)) { out.push(s); continue; }
    const products: any[] = s.props.products;
    const picked = on && customerId ? await pickRecoIndex(companyId, customerId, products.map((p) => String(p?.name ?? ''))) : null;
    const { reco_front: _stale, ...rest } = s.props;
    out.push({ ...s, props: picked !== null && picked > 0 ? { ...rest, reco_front: picked } : rest });
  }
  return out;
}

/** 받는 사람이 한 명인 길(DM 열람) — 개방 판정과 싣기를 한 번에(고객을 모르면 요금제를 읽지 않는다) */
export async function applyRecoOrder<T extends AnySection>(sections: readonly T[], customerId: string | null | undefined, companyId: string): Promise<T[]> {
  return markRecoFront(sections, customerId, companyId, !!customerId && await recoOrderOn(sections, companyId));
}
