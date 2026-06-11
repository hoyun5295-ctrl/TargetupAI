/**
 * sms-table-split.ts — 라이브 큐 / 월별 이력 테이블 분리 (순수, DB import 0)
 *
 * ★ 2026-06-11: 캠페인 결과 집계가 라이브 큐와 월별 이력(_YYYYMM)을 합산하면, 에이전트가 행을
 * 큐→이력으로 옮기는(복사 후 삭제) 사이에 같은 행이 양쪽에서 잡혀 부풀린 값이 PG에 굳는다
 * (toun28 6/11: 실재 7,171행 vs 기록 7,520 — 합이 target을 넘는 순간 재동기화에서 영구 제외).
 * 결과는 이력에서만, 대기는 라이브에서만 세기 위한 분리 헬퍼.
 */
export function splitLiveAndLogTables(tables: string[]): { live: string[]; logs: string[] } {
  const live: string[] = [];
  const logs: string[] = [];
  for (const t of tables) {
    if (/_\d{6}$/.test(t)) logs.push(t);
    else live.push(t);
  }
  return { live, logs };
}

export interface CampaignAggCounts { total: number; success: number; fail: number; pending: number }

/**
 * 이력/라이브 부분 집계를 정합성 100% 카운트로 병합 (순수).
 * - success/fail = 이력만 (append-only — 과대 불가능)
 * - pending = 이력 대기 + 라이브 대기 (이동 중 행은 라이브에서 비대기라 제외 → 이력 1회만)
 * - total = 이력 전체 + 라이브 대기 (같은 원리)
 */
export function mergeCampaignCounts(
  log: { t?: number; s?: number; f?: number; p?: number } | undefined,
  livePending: number | undefined,
): CampaignAggCounts {
  const lp = Math.max(0, Number(livePending || 0));
  const success = Math.max(0, Number(log?.s || 0));
  const fail = Math.max(0, Number(log?.f || 0));
  const pending = Math.max(0, Number(log?.p || 0)) + lp;
  const total = Math.max(0, Number(log?.t || 0)) + lp;
  return { total, success, fail, pending };
}
