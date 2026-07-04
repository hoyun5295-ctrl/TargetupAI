// copy-label-sweeper.ts — 여정·브랜드 KAKAO 결과를 학습 코퍼스에 라벨만 환류.
//   ⚠️ 라벨 전용: prepaidRefund·campaigns 상태·발송 큐 절대 미변경(campaign-lifecycle 환불 루프와 분리 → 이중환불 0).
//   결과 시스템 2종: 브랜드메시지=IMC(REQUEST_UID) / 여정 알림톡=SMSQ(app_etc1). 각각 대응 집계 재사용.
//   ※ 여정 SMS/LMS/MMS 라벨은 후속(회사별 SMS 테이블 집계 필요). 현재 스윕은 KAKAO 한정.
import pool from '../config/database';
import { getSourceRef, updateTrainingMetrics } from './training-logger';
import { kakaoAgg, kakaoBatchAggByGroup } from './sms-queue';

/** 여정·브랜드 KAKAO 문안에 성공/실패 라벨을 환류(멱등 — updateTrainingMetrics는 절대값 SET). */
export async function sweepKakaoLearningLabels(): Promise<{ labeled: number }> {
  let labeled = 0;

  // 1) 브랜드메시지(IMC) — REQUEST_UID = campaignId, source_ref=`${id}:brand`
  try {
    const brand = await pool.query(
      `SELECT id FROM campaigns
       WHERE send_channel = 'kakao_brand' AND created_at >= NOW() - INTERVAL '7 days'`,
    );
    for (const c of brand.rows) {
      try {
        const agg = await kakaoAgg('REQUEST_UID = ?', [c.id]);
        if (agg.success + agg.fail > 0) {
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
      `SELECT c.id FROM journey_step_campaigns jsc
       JOIN campaigns c ON c.id = jsc.campaign_id
       WHERE c.send_channel = 'alimtalk'
         AND jsc.send_date::text >= to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')`,
    );
    const ids = jr.rows.map((r: any) => r.id);
    if (ids.length > 0) {
      const aggMap = await kakaoBatchAggByGroup(ids);
      for (const id of ids) {
        try {
          const agg = aggMap.get(id);
          if (agg && agg.success + agg.fail > 0) {
            await updateTrainingMetrics({
              sourceRef: getSourceRef(id),
              sentCount: agg.success + agg.fail,
              successCount: agg.success,
              failCount: agg.fail,
            });
            labeled++;
          }
        } catch { /* 개별 라벨 실패 무영향 */ }
      }
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
