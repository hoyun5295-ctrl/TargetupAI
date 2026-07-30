// copy-label-sweeper.ts — 여정·브랜드 KAKAO 결과를 학습 코퍼스에 라벨만 환류.
//   ⚠️ 라벨 전용: prepaidRefund·campaigns 상태·발송 큐 절대 미변경(campaign-lifecycle 환불 루프와 분리 → 이중환불 0).
//   ★ 2026-07-30 재구축: 브랜드도 SMSQ(msg_type='F'·app_etc1)로 합류 — 두 arm 모두 SMSQ 집계 하나를 쓴다.
//   ※ 여정 SMS/LMS/MMS 라벨은 후속(회사별 SMS 테이블 집계 필요). 현재 스윕은 KAKAO 한정.
import pool from '../config/database';
import { getSourceRef, updateTrainingMetrics } from './training-logger';
import { getCompanySmsTablesWithLogs, smsCampaignCountsSafe } from './sms-queue';

/** 회사·유저별 테이블을 풀어 SMSQ 집계(app_etc1) — 두 arm 공용. */
async function aggByCampaign(rows: Array<{ id: string; company_id: string; created_by: string | null }>) {
  const byUser = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.company_id}::${r.created_by || ''}`;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key)!.push(r.id);
  }
  const out = new Map<string, { success: number; fail: number }>();
  for (const [key, ids] of byUser) {
    const [cid, uid] = key.split('::');
    const tables = await getCompanySmsTablesWithLogs(cid, uid || undefined);
    for (const [g, v] of await smsCampaignCountsSafe(tables, ids)) {
      out.set(g, { success: v.success, fail: v.fail });
    }
  }
  return out;
}

/** 여정·브랜드 KAKAO 문안에 성공/실패 라벨을 환류(멱등 — updateTrainingMetrics는 절대값 SET). */
export async function sweepKakaoLearningLabels(): Promise<{ labeled: number }> {
  let labeled = 0;

  // 1) 브랜드메시지(SMSQ msg_type='F') — app_etc1 = campaignId, source_ref=`${id}:brand`
  try {
    const brand = await pool.query(
      `SELECT id, company_id, created_by FROM campaigns
       WHERE send_channel = 'kakao_brand' AND created_at >= NOW() - INTERVAL '7 days'`,
    );
    const aggMap = await aggByCampaign(brand.rows);
    for (const c of brand.rows) {
      try {
        const agg = aggMap.get(c.id);
        if (agg && agg.success + agg.fail > 0) {
          await updateTrainingMetrics({
            sourceRef: getSourceRef(`${c.id}:brand`),
            sentCount: agg.success + agg.fail,
            successCount: agg.success,
            failCount: agg.fail,
          });
          labeled++;
        }
      } catch { /* 개별 라벨 실패 무영향 */ }
    }
  } catch (err) {
    console.warn('[label-sweep] 브랜드 조회 실패:', (err as Error)?.message);
  }

  // 2) 여정 알림톡(SMSQ) — app_etc1 = campaignId, source_ref=hmac(campaignId) 평문
  try {
    const jr = await pool.query(
      `SELECT c.id, c.company_id, c.created_by FROM journey_step_campaigns jsc
       JOIN campaigns c ON c.id = jsc.campaign_id
       WHERE c.send_channel = 'alimtalk'
         AND jsc.send_date::text >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')`,
    );
    const aggMap = await aggByCampaign(jr.rows);
    for (const r of jr.rows) {
      try {
        const agg = aggMap.get(r.id);
        if (agg && agg.success + agg.fail > 0) {
          await updateTrainingMetrics({
            sourceRef: getSourceRef(r.id),
            sentCount: agg.success + agg.fail,
            successCount: agg.success,
            failCount: agg.fail,
          });
          labeled++;
        }
      } catch { /* 개별 라벨 실패 무영향 */ }
    }
  } catch (err) {
    console.warn('[label-sweep] 여정 알림톡 조회 실패:', (err as Error)?.message);
  }

  return { labeled };
}

/** 30분 주기 라벨 스윕 워커. 부팅 1분 뒤 첫 실행. 실패해도 서버 무영향. */
export function startCopyLabelSweeperWorker(): void {
  const INTERVAL_MS = 30 * 60 * 1000;
  const run = async () => {
    try {
      const { labeled } = await sweepKakaoLearningLabels();
      if (labeled > 0) console.log(`[label-sweep] KAKAO 학습 라벨 ${labeled}건 환류`);
    } catch (err) {
      console.warn('[label-sweep] tick 오류(무영향):', (err as Error)?.message);
    }
  };
  setTimeout(run, 60 * 1000);
  setInterval(run, INTERVAL_MS);
  console.log('[label-sweep] 워커 시작 — 30분 주기(여정·브랜드 KAKAO 학습 라벨)');
}
