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

/**
 * ★ 2026-09-28 한줄로 V2 m076 후속 — 판정 창 = [나가는 첫날 − (N−1), 나가는 마지막 날] (KST 'YYYY-MM-DD').
 *   기록이 「실제로 나가는 날」이라 판정도 그 날 기준이어야 한다. 옛 판정은 「오늘부터 과거 N일 · 위쪽 끝 없음」이라
 *   다음 주 예약 광고가 오늘부터 다음 주 + N일까지 다른 광고를 막았다. 지정이 없거나 형식이 틀리면 오늘 하루(즉시 발송).
 */
export interface FatigueSpan { from: string; to: string }
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function spanParams(span?: FatigueSpan | null): [string | null, string | null] {
  const ok = !!span && DAY_RE.test(span.from) && DAY_RE.test(span.to) && span.from <= span.to;
  return ok ? [span!.from, span!.to] : [null, null];
}

/** 대량 경로용 — 상한 도달 전화번호 집합(정규화). 오류 = 빈 Set(차단 없음으로 진행). */
export async function getFatigueBlockedSet(
  companyId: string,
  cap: FatigueCap,
  phones: string[],
  span?: FatigueSpan | null,
): Promise<Set<string>> {
  const blocked = new Set<string>();
  try {
    const uniq = Array.from(new Set(phones.map((p) => normalizePhone(p || '')).filter(Boolean)));
    const [from, to] = spanParams(span);
    const BATCH = 5000;
    for (let i = 0; i < uniq.length; i += BATCH) {
      const batch = uniq.slice(i, i + BATCH);
      const r = await query(
        `SELECT phone FROM send_fatigue_daily
          WHERE company_id = $1::uuid AND phone = ANY($2::text[])
            AND day >= (COALESCE($5::date, (NOW() AT TIME ZONE 'Asia/Seoul')::date) - ($3::int - 1))
            AND day <= COALESCE($6::date, (NOW() AT TIME ZONE 'Asia/Seoul')::date)
          GROUP BY phone
         HAVING SUM(sent_count) >= $4::int`,
        [companyId, batch, cap.days, cap.max, from, to],
      );
      for (const row of r.rows as any[]) blocked.add(String(row.phone));
    }
  } catch (err: any) {
    console.warn('[fatigue-guard] 차단 집합 조회 실패 (차단 없음으로 진행):', err?.message);
  }
  return blocked;
}

/** 단건 판정 (여정 실행기 등) — 오류 = false(차단 없음). 창은 getFatigueBlockedSet 과 같다(지정 없음 = 오늘 하루). */
export async function isFatigueBlocked(companyId: string, cap: FatigueCap, phone: string, span?: FatigueSpan | null): Promise<boolean> {
  try {
    const p = normalizePhone(phone || '');
    if (!p) return false;
    const r = await query(
      `SELECT 1 FROM send_fatigue_daily
        WHERE company_id = $1::uuid AND phone = $2
          AND day >= (COALESCE($5::date, (NOW() AT TIME ZONE 'Asia/Seoul')::date) - ($3::int - 1))
          AND day <= COALESCE($6::date, (NOW() AT TIME ZONE 'Asia/Seoul')::date)
       HAVING SUM(sent_count) >= $4::int`,
      [companyId, p, cap.days, cap.max, ...spanParams(span)],
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
/**
 * @param sendDays ★ 2026-09-28 한줄로 V2 m076 — 수신자마다 **실제로 나가는 날**(KST 'YYYY-MM-DD'). 같은 순서 · 없거나 틀리면 오늘.
 *   전에는 예약·분할 발송도 전부 적재한 날(오늘)로 세서, 내일 나갈 광고가 오늘 다른 광고를 막고 정작 내일 상한 판정에는 안 보였다.
 */
export async function recordFatigueSends(
  companyId: string,
  rawPhones: string[],
  sendDays?: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  try {
    const pairs: [string, string | null][] = [];
    rawPhones.forEach((p, i) => {
      const phone = normalizePhone(p || '');
      if (!phone) return;
      const d = sendDays?.[i];
      pairs.push([phone, typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null]);
    });
    if (!companyId || pairs.length === 0) return;
    const BATCH = 10000;
    for (let i = 0; i < pairs.length; i += BATCH) {
      const batch = pairs.slice(i, i + BATCH);
      await query(
        `INSERT INTO send_fatigue_daily (company_id, phone, day, sent_count)
         SELECT $1::uuid, v.phone, v.day, COUNT(*)
           FROM (SELECT u.phone, COALESCE(u.day, (NOW() AT TIME ZONE 'Asia/Seoul')::date) AS day
                   FROM UNNEST($2::text[], $3::date[]) AS u(phone, day)) v
          GROUP BY v.phone, v.day
         ON CONFLICT (company_id, phone, day)
         DO UPDATE SET sent_count = send_fatigue_daily.sent_count + EXCLUDED.sent_count`,
        [companyId, batch.map((x) => x[0]), batch.map((x) => x[1])],
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
