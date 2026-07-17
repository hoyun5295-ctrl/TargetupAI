/**
 * ★ 2026-07-17 — 캠페인별 MySQL 조회 테이블 축소 게이트 순수 코어.
 *
 * 배경: stats/campaigns 집계가 "회사+사용자 전 라인 합집합"(이새 27개 테이블)을 매번 훑던 것을,
 * 0611부터 적재 워커가 campaigns.send_config.sentTables에 기록하는 "실제 INSERT 테이블"로 좁힌다.
 *
 * ★ Codex 2R 정정(2026-07-17): 시간 창(발송월 ±1개월) 방식 폐기 — 선예약 직접발송(sent_at=적재 시각)과
 * 장기 분할 발송(수개월에 걸친 sendreq_time)이 창 밖 LOG로 빠지는 두 결함이 같은 뿌리(시간 축 가정).
 * 축소는 "라인 축"으로만 한다: 기록된 LIVE 테이블 + 그 라인의 전 존재 LOG. 캠페인 행은 적재된
 * 테이블(sentTables) 또는 그 라인의 월별 아카이브에만 있을 수 있으므로 시간 가정 없이 정확성이 보장된다.
 *
 * 이 파일은 판정만 담당하는 순수 함수(외부 import 0)이며, 실제 테이블 해석 배선은
 * stats-aggregation.ts resolveCampaignTableGroups가 담당한다. (순수 코어 분리 — 유닛 테스트 대상)
 */

export interface CampaignTableMeta {
  id: string;
  company_id: string;
  created_by: string | null;
  /** campaigns.send_config (jsonb) — sentTables: 적재 워커가 기록한 실제 INSERT 테이블 */
  send_config?: any;
  sent_at?: Date | string | null;
  scheduled_at?: Date | string | null;
  created_at?: Date | string | null;
}

/** LIVE 큐 테이블명만 허용 (SMSQ_SEND_4 등). LOG(_YYYYMM)·임의 문자열은 기록 경로 제외. */
const LIVE_TABLE_PATTERN = /^SMSQ_SEND_\d+$/;

/**
 * send_config.sentTables에서 유효한 LIVE 테이블 기록을 추출한다.
 * 빈 배열 = 기록 없음 → 현행 (company,user) 라인 합집합 fallback.
 * (실존 여부 최종 확인은 배선부가 실제 테이블 목록과 교차 검증 — 미실존 기록도 fallback)
 */
export function recordedLiveTables(c: CampaignTableMeta): string[] {
  const sentTables = c.send_config?.sentTables;
  if (!Array.isArray(sentTables)) return [];
  const out: string[] = [];
  for (const t of sentTables) {
    if (typeof t === 'string' && LIVE_TABLE_PATTERN.test(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * 전체 테이블 목록에서 특정 LIVE 라인의 월별 LOG 테이블만 골라낸다.
 * 언더스코어 경계 + 6자리 월 검증 — `SMSQ_SEND_1`이 `SMSQ_SEND_13_202607`을 잡는 오매칭 차단
 * (LESSONS_BACKEND `${t}_` 경계 교훈).
 */
export function logTablesForLive(live: string, allTables: string[]): string[] {
  const prefix = `${live}_`;
  return allTables.filter(
    (t) => t.startsWith(prefix) && /^\d{6}$/.test(t.slice(prefix.length)),
  );
}
