// ===========================================================================
// utils/campaign-sweep-scope.ts — 환불·결과 동기화 sweep 대상 캠페인 상태 (CT)
// ---------------------------------------------------------------------------
// ★ 2026-08-04 신설.
//
// 왜 상수 하나로 뽑았나:
//   같은 "sweep 대상 상태" 집합이 두 파일에 문자열로 복제돼 있었다 —
//   `mysql-refund-sweeper.ts`(후보 SELECT + PG 카운트 갱신 UPDATE)와
//   `campaign-lifecycle.ts`(직접발송 결과 동기화). 한쪽에만 상태를 더하면
//   그 캠페인은 한 워커에는 보이고 다른 워커에는 안 보이는 상태가 되어,
//   "환불은 되는데 카운트가 안 맞는다" 같은 반쪽 수렴이 남는다.
//
// 'failed'가 들어 있는 이유:
//   예외 경로로 종결된 캠페인(`campaigns.status='failed'`)의 catch 환불은
//   "그 시점에 적재되지 않은 몫" 1회뿐이다. 이미 큐에 들어간 뒤 통신사에서
//   실패한 몫은 MySQL 실측으로만 드러나므로, 후보에서 빼면 그 돈은 영영
//   환불되지 않는다(초과 회수·머니 불변식 감시도 함께 멈춘다).
//
// 여기 없는 상태:
//   'scheduled'(아직 발송 전 — 결과 축이 없다) · 'cancelled'(취소 경로가
//   자기 환불을 소유한다) · 'draft'. 소비처가 각자 필요하면 OR로 덧붙인다
//   (예: lifecycle은 예약 시각이 지난 scheduled를 따로 본다).
// ===========================================================================

/** 환불·결과 동기화 sweep이 보는 캠페인 상태. 늘리면 두 워커가 함께 늘어난다. */
export const SWEEPABLE_CAMPAIGN_STATUSES = ['sending', 'completed', 'failed'] as const;

export type SweepableCampaignStatus = (typeof SWEEPABLE_CAMPAIGN_STATUSES)[number];

/**
 * SQL `IN (...)` 안에 그대로 넣는 리터럴 목록.
 * 값이 이 파일의 코드 상수라 외부 입력이 섞일 여지가 없다(파라미터 인덱스를
 * 쓰지 않는 이유 — 두 소비처의 파라미터 번호가 달라 인덱스를 공유할 수 없다).
 */
export const SWEEPABLE_CAMPAIGN_STATUS_SQL = SWEEPABLE_CAMPAIGN_STATUSES
  .map((s) => `'${s}'`)
  .join(', ');

/** 런타임 판정이 필요한 곳(워커 내부 분기)에서 쓴다. */
export function isSweepableCampaignStatus(status: string | null | undefined): boolean {
  return !!status && (SWEEPABLE_CAMPAIGN_STATUSES as readonly string[]).includes(status);
}
