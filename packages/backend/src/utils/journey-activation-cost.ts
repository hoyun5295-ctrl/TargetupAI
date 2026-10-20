/**
 * journey-activation-cost.ts — 처음 켜기 크레딧 판정 한 곳(★ 2026-10-20 여정 V.3 묶음 1 · 설계서 §5-1)
 *
 * 처음 켜기 200 은 **계보당 1번**: 초안이면서 계보 뿌리가 자기 자신(계보 없음 포함)일 때만 받는다. 새 판(lineage_id = 다른 여정) 초안은 0.
 *   원 여정 lineage_id 는 첫 새 판 때 자기 id 로 채워지고(journey-lineage createNewVersion) 새 판은 뿌리를 물려받는다 → 원장 조회 0회.
 *   계보 컬럼이 없으면(lineage_id 미조회 = undefined) 옛 동작(초안 = 200).
 * 켜기 게이트(journey-activation) · 목록 · 상세 · 지도 응답이 이 함수 하나를 쓴다 → 화면이 상태로 200 을 다시 매기지 않는다.
 * (journey-activation ↔ journey-lifecycle-map 순환 import 를 피하려고 따로 둔다 · 의존 = 단가표뿐)
 */
import { getCreditCost } from './ai-credit-calc';

export function chargesFirstActivation(row: { id: string; status: string; lineage_id?: string | null }): boolean {
  if (String(row.status) !== 'draft') return false;
  return !row.lineage_id || String(row.lineage_id) === String(row.id);
}

/** 화면에 보일 처음 켜기 크레딧(0 = 이번 켜기는 무료). */
export function activationCostOf(row: { id: string; status: string; lineage_id?: string | null }): number {
  return chargesFirstActivation(row) ? getCreditCost('journey-activate') : 0;
}
