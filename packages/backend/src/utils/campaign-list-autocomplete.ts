/**
 * CT: 캠페인 목록의 「결과가 다 왔으면 완료」 — ★ 2026-11-14 C134(B-1114-1 · 뿌리 R96 · R1)
 *   (설계서 docs/2026-11-14-journey-step-campaign-owner-design.md P1)
 *
 * 캠페인 목록(사용자 GET /api/campaigns · 관리자 목록)은 보내는 중인 캠페인의 결과가 다 왔으면(대기 0 + 성공 · 실패 > 0)
 * 화면에 「완료」로 보여 주고, 뒤에서 DB 상태도 completed 로 맞춘다(★ D144 P4/P7 후속 2026-05-07). 이 판정과 문장이 두 라우트에
 * 인라인으로 두 벌 있었고, 둘 다 여정 단계 캠페인을 가리지 않았다 → 하루 동안 이어 쓰는 단계 캠페인이 목록을 여는 순간 닫혔다.
 *
 * 규칙: **여정 단계 캠페인은 이 판정의 대상이 아니다** — 보이는 상태도 저장된 상태 그대로(그날은 보내는 중 · 여정이 닫은 다음 날부터 완료)
 *   · DB 를 닫는 대상 고르기와 문장 조건 양쪽에서 빠진다(여정의 단계 캠페인은 여정이 닫는다 = journey-step-campaign closeFinishedStepCampaigns).
 *   보이는 값과 저장값을 같게 두는 이유 = 목록은 저장된 상태로 거르고(상태 필터 · 건수 · 쪽) 그 뒤에 보이는 상태를 계산한다.
 *   여정 행만 「보이는 완료 · 저장은 보내는 중」이면 완료 필터에서 빠지고 보내는 중 필터에 완료로 보이는 줄이 남는다(Codex 설계 1R).
 */
import { query } from '../config/database';
import { JOURNEY_STEP_SEND_TYPE, NOT_JOURNEY_STEP_SQL } from './journey-step-campaign';

export interface ListCounts { success: number; fail: number; pending: number }

/** (순수) 목록에 보일 상태 — 보내는 중 + 대기 0 + 결과 하나 이상 = 완료로 보인다. 그 밖 · 여정 단계 캠페인 = 저장된 상태 그대로. */
export function listEffectiveStatus(status: string, counts: ListCounts, sendType?: string | null): string {
  if (sendType === JOURNEY_STEP_SEND_TYPE) return status;
  if (status === 'sending' && Number(counts.pending) === 0 && (Number(counts.success) > 0 || Number(counts.fail) > 0)) return 'completed';
  return status;
}

/** (순수) DB 상태를 completed 로 맞출 대상 — 완료로 보이는 보내는 중 캠페인 가운데 여정 단계 캠페인이 아닌 것. */
export function autoCompleteTargetIds(
  rows: ReadonlyArray<{ id: string; status: string; send_type?: string | null }>,
  countsOf: (id: string) => ListCounts,
): string[] {
  const ids: string[] = [];
  for (const c of rows) {
    if (c.status !== 'sending') continue;
    if (listEffectiveStatus(c.status, countsOf(c.id), c.send_type) === 'completed') ids.push(c.id);
  }
  return ids;
}

/** 닫는 문장 — 대상 고르기가 틀려도 여정 행은 이 조건에서 빠진다(문장이 마지막 문). */
export const LIST_AUTO_COMPLETE_SQL =
  `UPDATE campaigns SET status = 'completed', updated_at = NOW()
    WHERE id = ANY($1::uuid[]) AND status = 'sending' AND ${NOT_JOURNEY_STEP_SQL}`;

/** 뒤에서 맞춘다(응답을 기다리게 하지 않는다 · 실패 = 경고 로그 · 다음 목록 조회가 다시 한다). logPrefix = 종전 로그 머리 그대로. */
export function applyListAutoComplete(ids: string[], logPrefix: string): void {
  if (!ids || ids.length === 0) return;
  query(LIST_AUTO_COMPLETE_SQL, [ids]).catch((e) => console.warn(`${logPrefix} sending→completed 자동 정리 실패:`, e?.message));
}
