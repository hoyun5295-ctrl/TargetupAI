/**
 * journey-points-trigger.ts — 포인트 소멸 trigger 설정 정규화 (Phase 8)
 *   DB import 0 — 순수.
 *
 * 2모드:
 *   - inactivity   = points >= N AND 미사용(recent_purchase_date 오래됨/없음).
 *   - annual_date  = points >= N AND 회사 지정 연 소멸일(MM-DD) D-N일 전.
 *
 * 임계 N·일수·소멸일은 회사가 여정에서 설정. 소멸일은 고객 필드가 아니라 여정 정책(회사 1개 날짜).
 */

export interface PointsExpiringConfig {
  pointsMin: number;
  mode: 'inactivity' | 'annual_date';
  inactiveDays: number;
  daysBefore: number;
  expiryMonthDay: string; // 'MM-DD' (검증 통과한 값) 또는 '' (미설정/오류)
}

export function isValidMmdd(mmdd: string): boolean {
  if (!/^\d{2}-\d{2}$/.test(mmdd)) return false;
  const [m, d] = mmdd.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/** 미설정(null/빈/NaN) → 기본값, 설정값(0 포함) → [min,max] 클램프. `|| ` falsy 함정 회피. */
export function clampInt(val: any, def: number, min: number, max: number): number {
  if (val == null || val === '' || Number.isNaN(Number(val))) return def;
  return Math.max(min, Math.min(max, Math.floor(Number(val))));
}

export function resolvePointsExpiringConfig(filters: Record<string, any>): PointsExpiringConfig {
  const f = filters || {};
  const pointsMin = clampInt(f.points_min, 0, 0, Number.MAX_SAFE_INTEGER);
  const mode: 'inactivity' | 'annual_date' = f.expiry_mode === 'annual_date' ? 'annual_date' : 'inactivity';
  const inactiveDays = clampInt(f.inactive_days, 180, 1, 100000);
  const daysBefore = clampInt(f.days_before, 14, 0, 90);
  const raw = String(f.expiry_month_day || '').trim();
  const expiryMonthDay = isValidMmdd(raw) ? raw : '';
  return { pointsMin, mode, inactiveDays, daysBefore, expiryMonthDay };
}
