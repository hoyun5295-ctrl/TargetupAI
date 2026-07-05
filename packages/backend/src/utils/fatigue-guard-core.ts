/**
 * CT: fatigue-guard-core.ts — 발송 피로도 보호 순수 로직 (2026-07-05)
 *
 * DB import 0 (순수) — operator-recipients 등 순수 SQL 빌더가 import해도 verify 테스트가 깨지지 않는다.
 * DB 접근 함수(판정/기록/프루닝)는 fatigue-guard.ts 담당.
 *
 * 정책 (Harold 확정 2026-07-05):
 *  - 회사 opt-in — companies.fatigue_cap_days/fatigue_cap_max 둘 다 설정된 회사만 게이트 동작 (NULL = 비활성 = 현행 그대로)
 *  - 광고성(is_ad)만 카운트·게이트. 정보성(거래 통지 알림톡 등)·담당자/시스템 알림은 대상 아님
 *  - 직접발송 수동 입력 수신자(고객DB id 없음)는 게이트 제외 (사용자 명시 행동)
 *  - 기록은 항상(광고성 발송 전 경로), 판정은 opt-in — 나중에 켜는 순간부터 정확히 동작
 */

export interface FatigueCap {
  /** 판정 윈도우 (최근 N일, 1~30) */
  days: number;
  /** 윈도우 안 허용 최대 광고 발송 건수 (1~100) */
  max: number;
}

/** 설정값 정규화 — 둘 다 유효(>=1)해야 활성. 아니면 null(비활성). */
export function normalizeFatigueCap(daysRaw: unknown, maxRaw: unknown): FatigueCap | null {
  const days = Number(daysRaw);
  const max = Number(maxRaw);
  if (!Number.isFinite(days) || !Number.isFinite(max)) return null;
  if (days < 1 || max < 1) return null;
  return { days: Math.min(Math.floor(days), 30), max: Math.min(Math.floor(max), 100) };
}

/**
 * 서버사이드 추출 SQL(자동마케팅 staging 등)용 피로도 anti-join 절.
 * 전제: $1 = company_id (buildSendableStagingInsertSql 계약과 동일). params에 days·max를 push한다.
 * HAVING(GROUP BY 없음) = 집계 쿼리라 조건 충족 시 1행 → NOT EXISTS로 차단 판정.
 */
export function buildFatigueGuardClause(params: any[], cap: FatigueCap, alias = 'c'): string {
  params.push(cap.days);
  const daysIdx = params.length;
  params.push(cap.max);
  const maxIdx = params.length;
  return `AND NOT EXISTS (
         SELECT 1 FROM send_fatigue_daily f
          WHERE f.company_id = $1
            AND f.phone = regexp_replace(COALESCE(${alias}.phone, ''), '[^0-9]', '', 'g')
            AND f.day >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date - ($${daysIdx}::int - 1))
         HAVING SUM(f.sent_count) >= $${maxIdx}::int
       )`;
}
