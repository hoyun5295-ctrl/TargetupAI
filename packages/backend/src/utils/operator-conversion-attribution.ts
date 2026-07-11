/**
 * operator-conversion-attribution.ts — 자동마케팅 변형 전환(구매) 자동 귀속 (2026-07-12 C-3①)
 *
 * 귀속 규칙 = automarketing-roi와 동일(발송 후 7일 안 cdp purchase/order 실측) — 귀속 창이 닫힌
 * (발송 +7일 경과) 발송분만 1회 확정 귀속해, 그때 발송된 변형의 conversion_count에 누적한다.
 * 발송 변형 = 그 제안에서 sent_count가 누적된 변형(발송은 제안당 1개 변형 — dispatchProposalSend).
 *
 * 멱등 = operator_proposals.conversion_attributed_at (신규 컬럼).
 * 컬럼 미생성(마이그레이션 전) = 전체 skip(안전) — ALTER 후 다음 사이클부터 자동 활성
 * (recap_notified_at·prep_reminder_sent_for와 동일한 신규 컬럼 양립 패턴).
 */

import { query } from '../config/database';
import { recordVariantReward } from './bandit-optimizer';

export async function runOperatorConversionAttribution(
  companyId: string,
): Promise<{ attributed: number; skipped: boolean }> {
  let rows: any[] = [];
  try {
    const r = await query(
      `SELECT p.id, p.auto_sent_at,
              (SELECT v.id FROM operator_proposal_variants v
                WHERE v.proposal_id = p.id AND v.sent_count > 0
                ORDER BY v.sent_count DESC LIMIT 1) AS sent_variant_id
         FROM operator_proposals p
        WHERE p.company_id = $1::uuid
          AND p.status = 'sent'
          AND p.auto_sent_at IS NOT NULL
          AND p.auto_sent_at <= NOW() - INTERVAL '7 days'
          AND p.conversion_attributed_at IS NULL
        ORDER BY p.auto_sent_at ASC
        LIMIT 50`,
      [companyId],
    );
    rows = r.rows;
  } catch (err: any) {
    if ((err?.message || '').includes('does not exist')) {
      console.warn('[OperatorConversion] conversion_attributed_at 미생성 — 전환 귀속 skip (ALTER 대기)');
      return { attributed: 0, skipped: true };
    }
    throw err;
  }

  let attributed = 0;
  for (const row of rows) {
    try {
      // 발송 후 7일 창의 구매 실측 — automarketing-roi와 동일 이벤트·창 (임의 상수 0).
      // ★ Codex 정정: 창 상한 = min(+7일, 같은 회사의 다음 자동마케팅 발송 시각) — 연속 발송 창 겹침 시
      //   같은 구매가 여러 제안 변형에 이중 귀속되는 왜곡 차단(구매 1건 = 최대 1제안 귀속).
      const conv = await query(
        `SELECT COUNT(*)::int AS purchases
           FROM cdp_events
          WHERE company_id = $1::uuid
            AND event_name IN ('purchase', 'order')
            AND occurred_at >= $2
            AND occurred_at < LEAST(
                  $2::timestamptz + INTERVAL '7 days',
                  COALESCE((SELECT MIN(p2.auto_sent_at) FROM operator_proposals p2
                             WHERE p2.company_id = $1::uuid AND p2.status = 'sent'
                               AND p2.auto_sent_at > $2::timestamptz),
                           $2::timestamptz + INTERVAL '7 days'))`,
        [companyId, row.auto_sent_at],
      );
      const purchases = Number(conv.rows[0]?.purchases) || 0;
      if (purchases > 0 && row.sent_variant_id) {
        await recordVariantReward({ variantId: row.sent_variant_id, sent: 0, clicked: 0, converted: purchases });
      }
      // 구매 0건·변형 미확인도 귀속 완료로 마킹 — 창이 닫힌 발송분을 매일 재조회하지 않는다.
      await query(`UPDATE operator_proposals SET conversion_attributed_at = NOW() WHERE id = $1::uuid`, [row.id]);
      attributed++;
    } catch (e: any) {
      console.warn('[OperatorConversion] 귀속 경고:', row.id, e?.message);
    }
  }
  return { attributed, skipped: false };
}
