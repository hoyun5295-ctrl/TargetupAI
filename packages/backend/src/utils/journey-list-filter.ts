/**
 * 여정/실행 목록 status 필터 — SQL 주입 차단(화이트리스트 검증). DB import 0 — 순수.
 *
 * status는 라우트가 req.query/body에서 받은 값이라 신뢰 불가(타입 캐스팅은 런타임 보장 X).
 * 화이트리스트에 있는 값일 때만 SQL 조각에 넣고, 그 외(미지정·이상값·주입 시도)는 안전 기본값으로 떨어뜨린다.
 */

const JOURNEY_STATUSES = ['draft', 'active', 'paused', 'ended'];
const EXECUTION_STATUSES = ['active', 'completed', 'paused', 'failed', 'ended', 'goal_met', 'holdout'];  // ★ 2026-07-10 목표 달성 종료 · 2026-07-11 홀드아웃 대조군

/** 여정 목록 WHERE 조각(company_id 절 뒤에 이어붙임). archived 분리 + status 화이트리스트. */
export function journeyListWhere(status?: string): string {
  if (status === 'archived') return `AND archived_at IS NOT NULL`;
  if (status && status !== 'all' && JOURNEY_STATUSES.includes(status)) {
    return `AND status = '${status}' AND archived_at IS NULL`;
  }
  return `AND archived_at IS NULL`;
}

/** 실행 목록 status 필터 조각(e.status). 화이트리스트에 없으면 빈 문자열(필터 없음). */
export function executionStatusFilter(status?: string): string {
  if (status && EXECUTION_STATUSES.includes(status)) return `AND e.status = '${status}'`;
  return '';
}
