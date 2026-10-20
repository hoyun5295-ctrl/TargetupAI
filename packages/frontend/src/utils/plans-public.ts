/**
 * plans-public.ts — 공개 요금제 표(/api/plans · 로그인 없이 열린다) 한 줄 읽기 (★ 2026-10-21 진단 띠 쿠폰)
 *
 * 화면에 요금제 이름 · 월 금액을 쓸 때 값은 plans 원장에서 읽는다(상수로 쓰지 않는다 · 요금이 바뀌면 화면도 따라온다).
 * 못 읽으면 null — 부르는 쪽은 금액 없이도 뜨게 그린다.
 * ※ TrialUpsellModal · PricingPage 는 아직 /api/plans 를 직접 부른다(이 CT 로 옮기는 것은 별건).
 */
export interface PublicPlan {
  name: string;
  monthlyPrice: number;
}

export async function fetchPublicPlan(planCode: string): Promise<PublicPlan | null> {
  try {
    const res = await fetch('/api/plans');
    const data = await res.json().catch(() => ({}));
    const row = (data.plans || []).find((p: any) => String(p.plan_code).toUpperCase() === planCode.toUpperCase());
    if (!row) return null;
    return { name: String(row.plan_name || ''), monthlyPrice: Number(row.monthly_price) || 0 };
  } catch {
    return null;
  }
}
