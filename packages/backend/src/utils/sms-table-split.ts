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

/**
 * 표시용 전송건수 정합 (순수) — 전송 = max(적재 실측 sent_count, 성공+실패+대기).
 *
 * ★ 2026-06-15 버그3 fix: 완료 캠페인 표시가 전송(sent_count=적재 실측)과 성공/실패(큐 결과)를
 *   서로 다른 소스에서 읽어, 제외분(무효/수신거부)이 실패에 포함된 옛 캠페인에서 "성공+실패 > 전송"이
 *   노출됐다(시세이도 6/9: 전송 1613 vs 성공+실패 1646). 옛 캠페인은 제외 건수 기록(send_config.exclusions)이
 *   없어 실패에서 되빼기가 불가 → 전송을 성공+실패+대기 이상으로 올려 정합(대기 = 전송-성공-실패 ≥ 0).
 *   적재값이 더 크면(결과 일부 미도착) 전송=적재 유지 → 건5(전송 0으로 보임) 회귀 방지.
 *   정합 캠페인(에이스 6/12 등)은 no-op(전송=적재=성공+실패+대기). 목록·요약·상세·엑셀 동일 적용 의무.
 */
export function reconcileSentCount(
  sentCount: number | null | undefined,
  success: number,
  fail: number,
  pending: number,
): number {
  const loaded = Math.max(0, Number(sentCount) || 0);
  const resultSum = Math.max(0, Number(success) || 0) + Math.max(0, Number(fail) || 0) + Math.max(0, Number(pending) || 0);
  return Math.max(loaded, resultSum);
}

export interface DisplayCounts { sent: number; success: number; fail: number; pending: number }

/**
 * ★ 2026-06-17 카운트 표시 단일 산식 (순수) — 전송·성공·실패·대기를 한 곳에서 계산.
 *   재발 차단: 표면(목록·상세·통계·CSV)마다 sent/대기를 따로 계산하던 분산을 종결한다.
 *   - 완료(result_final): 대기 = 적재 − 성공 − 실패 (status 104 결과 미수신·늦은 리포트 잔여). 캐시 정확 시 0.
 *   - 진행중: 대기 = 실측(MySQL status 100/104 + 카카오 대기).
 *   전송 = reconcileSentCount = max(적재, 성공+실패+대기).
 *   소비처: getCampaignResultCounts(결과/통계/상세/CSV) — frontend 자체 파생 금지, 이 값을 그대로 표시.
 */
export function computeDisplayCounts(
  resultFinal: boolean,
  sentCount: number | null | undefined,
  success: number,
  fail: number,
  livePending: number,
): DisplayCounts {
  const s = Math.max(0, Number(success) || 0);
  const f = Math.max(0, Number(fail) || 0);
  const lp = resultFinal ? 0 : Math.max(0, Number(livePending) || 0);
  const sent = reconcileSentCount(sentCount, s, f, lp);
  // 대기: 진행중 = 실측 라이브 대기. 완료 = 적재 잔여(전송 − 성공 − 실패) — status 104 결과 미수신 또는 캐시 누락(worker가 정정).
  const pending = resultFinal ? Math.max(0, sent - s - f) : lp;
  return { sent, success: s, fail: f, pending };
}
