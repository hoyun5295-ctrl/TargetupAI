/**
 * CT: fatigue-guard.ts — 발송 피로도 보호 (2026-07-05)
 *
 * 한 고객이 여러 경로(AI캠페인·직접타겟·자동발송·자동마케팅·여정)에 동시에 걸려 과다 수신하는 것을
 * 회사 opt-in 상한("최근 N일 광고 M건")으로 차단하는 전역 게이트.
 *
 * 데이터: send_fatigue_daily(company_id, phone, day KST, sent_count) — 30일+ 보존, 프루닝 워커가 45일 초과분 삭제.
 *  - 키 = 전화번호: 고객DB 미등록 수신자(주소록/파일)까지 커버. day는 KST 기준.
 *  - 기록 = 광고성(is_ad) 발송 큐 커밋 직후 fire-and-forget(+N). 실패 = 경고 로그뿐(발송 무영향).
 *  - 판정 = 각 발송 경로의 차감 이전 지점(환불 배관 불필요). 42P01/42703 = 게이트 무시(현행 유지).
 *
 * 대상/제외 (2026-07-05 전수 grep 영향표):
 *  - 대상: campaigns.ts AI발송 · direct-send(고객DB id 행만) · direct-send-processor(staging) ·
 *          auto-campaign-worker · continuous-operator(staging SQL anti-join) · journey-executor(단건)
 *  - 제외: internal-alert/system-alert(시스템) · journey-pretest-notifier/campaign-sync-worker/
 *          continuous-operator notifyOperatorAdmins/alimtalk-jobs(담당자 알림) · spam-test(테스트) · 정보성(is_ad=false)
 *
 * 주의: customer_send_stats(예측 분모 전용 — 발송 대상 선정 사용 금지 계약)와 별개 테이블.
 *       피로도는 예측이 아니라 명확한 규칙(N일 M건)이라 타겟 게이트 사용이 정당하다.
 */
import { query } from '../config/database';
import { normalizePhone } from './normalize-phone';
import { FatigueCap, normalizeFatigueCap } from './fatigue-guard-core';

export type { FatigueCap } from './fatigue-guard-core';
export { buildFatigueGuardClause, normalizeFatigueCap } from './fatigue-guard-core';

/** 회사 피로도 상한 조회 — 미설정/컬럼 미존재(42703) = null(게이트 비활성). */
export async function getFatigueCap(companyId: string): Promise<FatigueCap | null> {
  try {
    const r = await query(
      `SELECT fatigue_cap_days, fatigue_cap_max FROM companies WHERE id = $1::uuid`,
      [companyId],
    );
    return normalizeFatigueCap(r.rows[0]?.fatigue_cap_days, r.rows[0]?.fatigue_cap_max);
  } catch {
    // 42703(컬럼 미마이그레이션) 포함 — 비활성으로 우아한 열화 (현행 유지)
    return null;
  }
}

/** 대량 경로용 — 상한 도달 전화번호 집합(정규화). 오류 = 빈 Set(차단 없음으로 진행). */
export async function getFatigueBlockedSet(
  companyId: string,
  cap: FatigueCap,
  phones: string[],
): Promise<Set<string>> {
  const blocked = new Set<string>();
  try {
    const uniq = Array.from(new Set(phones.map((p) => normalizePhone(p || '')).filter(Boolean)));
    const BATCH = 5000;
    for (let i = 0; i < uniq.length; i += BATCH) {
      const batch = uniq.slice(i, i + BATCH);
      const r = await query(
        `SELECT phone FROM send_fatigue_daily
          WHERE company_id = $1::uuid AND phone = ANY($2::text[])
            AND day >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date - ($3::int - 1))
          GROUP BY phone
         HAVING SUM(sent_count) >= $4::int`,
        [companyId, batch, cap.days, cap.max],
      );
      for (const row of r.rows as any[]) blocked.add(String(row.phone));
    }
  } catch (err: any) {
    console.warn('[fatigue-guard] 차단 집합 조회 실패 (차단 없음으로 진행):', err?.message);
  }
  return blocked;
}

/** 단건 판정 (여정 실행기 등) — 오류 = false(차단 없음). */
export async function isFatigueBlocked(companyId: string, cap: FatigueCap, phone: string): Promise<boolean> {
  try {
    const p = normalizePhone(phone || '');
    if (!p) return false;
    const r = await query(
      `SELECT 1 FROM send_fatigue_daily
        WHERE company_id = $1::uuid AND phone = $2
          AND day >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date - ($3::int - 1))
       HAVING SUM(sent_count) >= $4::int`,
      [companyId, p, cap.days, cap.max],
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * 광고성 발송 기록 (+1/전화번호, KST 오늘) — 발송 큐 커밋 직후 fire-and-forget(void)로만 호출.
 * 호출부가 is_ad를 판단한다(정보성은 호출하지 않음). 실패 = 경고 로그뿐(발송·응답 무영향).
 */
export async function recordFatigueSends(companyId: string, rawPhones: string[]): Promise<void> {
  try {
    const phones = rawPhones.map((p) => normalizePhone(p || '')).filter(Boolean);
    if (!companyId || phones.length === 0) return;
    const BATCH = 10000;
    for (let i = 0; i < phones.length; i += BATCH) {
      const batch = phones.slice(i, i + BATCH);
      await query(
        `INSERT INTO send_fatigue_daily (company_id, phone, day, sent_count)
         SELECT $1::uuid, u.phone, (NOW() AT TIME ZONE 'Asia/Seoul')::date, COUNT(*)
           FROM UNNEST($2::text[]) AS u(phone)
          GROUP BY u.phone
         ON CONFLICT (company_id, phone, day)
         DO UPDATE SET sent_count = send_fatigue_daily.sent_count + EXCLUDED.sent_count`,
        [companyId, batch],
      );
    }
  } catch (err: any) {
    // 42P01(테이블 미생성) 포함 — 발송 무영향, 카운터만 일시 누락
    console.warn('[fatigue-guard] 피로도 카운터 적재 실패 (발송 무영향):', err?.message);
  }
}

/** 45일 초과 버킷 삭제 (상한 윈도우 최대 30일 + 여유). */
export async function pruneFatigueDaily(): Promise<void> {
  try {
    await query(`DELETE FROM send_fatigue_daily WHERE day < ((NOW() AT TIME ZONE 'Asia/Seoul')::date - 45)`);
  } catch (err: any) {
    console.warn('[fatigue-guard] 프루닝 실패 (무영향):', err?.message);
  }
}

/** 프루닝 워커 — 6시간 주기 (app.ts 기동 시 등록). */
export function startFatiguePruneWorker(): void {
  setInterval(() => { void pruneFatigueDaily(); }, 6 * 60 * 60 * 1000);
  setTimeout(() => { void pruneFatigueDaily(); }, 60 * 1000); // 기동 1분 후 1회
}
