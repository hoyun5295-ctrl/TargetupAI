/**
 * journey-operation-release.ts — 여정 운영 크레딧 「잡아 둔 날」 되돌리기(★ 2026-10-20 여정 V.3 · Codex 적대 A 1R · 2R)
 *
 * 왜 있나
 *   운영 크레딧(계보당 하루 10)은 「문자를 보낸 날만」 받는다. 그런데 판정과 차감을 한 지점에 두면 둘 중 하나가 깨진다.
 *     - 확인만 하고 보낸 뒤 차감(옛) = 그 사이 다른 요청이 크레딧을 쓰면 차감이 잔액 부족으로 거절돼 무과금 발송이 확정된다(1R A1).
 *     - 보내기 전에 차감(1R 처방) = 그 뒤 피로도 · 회신번호 · 적재 실패로 그날 한 통도 안 나가도 차감이 남는다(2R).
 *   그래서 보내기 전 차감은 「그날 몫을 잡아 두는 것」으로 보고, **하루가 끝난 뒤** 그 계보 · 그 날짜에 실제 발송(sent)이 0건이면
 *   그 차감을 되돌린다. 하루가 끝난 뒤에만 판정하므로 진행 중인 발송과 엇갈리지 않는다(같은 날 다른 실행이 보내는 중인데 되돌리는 경합 0).
 *
 * 결과를 아직 모르는 표식('sending' · 적재 중단)도 보낸 것으로 본다 — 뒤에 가드가 'sent' 로 확정할 수 있어서다.
 *   표식이 지워지면(큐에 없음 = 안 나감) 다음 회차에 그날이 0건이 되어 그때 되돌린다(모르면 돌려주지 않는다).
 * 멱등 = 되돌림 키 `release:` + 원 차감 키(refundCredit 이 같은 키를 두 번 돌려주지 않는다 · 원 차감 키로 버킷 복원).
 * 키 둘째 마디 = 계보 뿌리(V.3) 또는 옛 판 여정 id(V.3 전) — 둘 다 그 계보의 발송으로 본다.
 */
import { query } from '../config/database';
import { refundCredit } from './ai-credit';
import { lineageColumnsReady } from './journey-lineage';

/** 한 번에 되돌릴 최대 건수(10분 주기 작업 · 넘치면 다음 회차). */
const RELEASE_BATCH = 500;
/** 뒤돌아볼 날수(그보다 오래된 차감은 보지 않는다 · 배포 전 차감은 전부 보낸 뒤 받은 것이라 대상이 아니다). */
const RELEASE_LOOKBACK_DAYS = 8;

/** 되돌릴 후보 조회 SQL — 시험이 조건을 고정한다. $1 = 계보 뿌리 식을 쓰는가(컬럼 가드). */
export function releaseCandidatesSql(rootSql: string): string {
  return `SELECT t.company_id, t.idempotency_key, t.amount
       FROM ai_credit_transactions t
      WHERE t.source = 'journey-operation' AND t.type = 'deduct'
        AND t.created_at > NOW() - INTERVAL '${RELEASE_LOOKBACK_DAYS} days'
        AND split_part(t.idempotency_key, ':', 3) < to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date, 'YYYYMMDD')
        AND NOT EXISTS (SELECT 1 FROM ai_credit_transactions r WHERE r.idempotency_key = 'release:' || t.idempotency_key)
        AND NOT EXISTS (
          SELECT 1 FROM journey_step_logs l
            JOIN journey_executions e ON e.id = l.execution_id
            JOIN journeys j ON j.id = e.journey_id
           WHERE j.company_id = t.company_id
             AND (j.id::text = split_part(t.idempotency_key, ':', 2) OR (${rootSql})::text = split_part(t.idempotency_key, ':', 2))
             AND l.status IN ('sent', 'sending')
             AND to_char((l.sent_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYYMMDD') = split_part(t.idempotency_key, ':', 3)
        )
      ORDER BY t.created_at ASC
      LIMIT ${RELEASE_BATCH}`;
}

/** 지난 날(KST) 운영 차감 중 그 계보가 그날 한 통도 안 보낸 것을 되돌린다. 반환 = 되돌린 건수. */
export async function releaseUnusedOperationCredits(): Promise<{ released: number }> {
  const rootSql = (await lineageColumnsReady().catch(() => false)) ? 'COALESCE(j.lineage_id, j.id)' : 'j.id';
  const r = await query(releaseCandidatesSql(rootSql));
  let released = 0;
  for (const row of r.rows as Array<{ company_id: string; idempotency_key: string; amount: number }>) {
    const key = String(row.idempotency_key);
    try {
      const res = await refundCredit({
        companyId: String(row.company_id),
        amount: Math.abs(Number(row.amount) || 0),
        source: 'journey-operation',
        reason: '문자를 보내지 않은 날의 여정 운영 크레딧 되돌림',
        idempotencyKey: `release:${key}`,
        originalIdempotencyKey: key,
      });
      if (res.refunded) released += 1;
    } catch (e: any) {
      console.warn(`[Journey Operation Release] 되돌림 실패 key=${key}:`, e?.message || e);
    }
  }
  if (released > 0) console.log(`[Journey Operation Release] 보내지 않은 날 운영 크레딧 ${released}건 되돌림`);
  return { released };
}
