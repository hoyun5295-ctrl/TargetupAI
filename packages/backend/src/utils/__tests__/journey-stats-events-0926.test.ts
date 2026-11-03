/**
 * 여정 통계 — 클릭은 자기 회사 이벤트만 · 전환은 실제로 저장되는 구매 이벤트로 센다 (★2026-09-26 한줄로 V2 R1-43)
 *
 * ①단계별 클릭 수 하위 쿼리가 회사 조건 없이 모든 회사의 message_click을 훑었다(속도 · 격리).
 * ②전환 수가 event_name = 'order'를 셌는데, 이벤트 CT는 표준 이름만 저장하고 주문은 'purchase'로 남긴다(cdp-orders) → 전환 항상 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { STANDARD_EVENT_NAMES } from '../cdp-events';

const src = readFileSync(join(__dirname, '..', 'journey-stats.ts'), 'utf8');

describe('여정 통계 이벤트', () => {
  it('전환은 저장되는 표준 이름 purchase로 센다', () => {
    expect((STANDARD_EVENT_NAMES as readonly string[])).toContain('purchase');
    expect((STANDARD_EVENT_NAMES as readonly string[])).not.toContain('order');
    expect(src).not.toContain("ce.event_name = 'order'");
    // 고친 두 곳 · ★ 2026-10-25 #13 — 대조군 비교는 목표 판정 한 곳(journey-goal-purchase · 그 안도 purchase)
    // ★ 2026-11-02 두 곳 = 결제된 구매 CT(netPurchaseSql · 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-0 CT-J3)
    // ★ 2026-11-04 C99 T8 — 두 곳 = 두 문 CT(단계 = CT-D4 purchaseAfterSql · 세그먼트 = CT-D2 purchaseFactsSql · 둘 다 안에서 netPurchaseSql)
    expect(src).toContain("${purchaseAfterSql('cv.customer_id', '(SELECT company_id FROM journeys WHERE id = $1::uuid)'");
    expect(src).toContain("INNER JOIN (${purchaseFactsSql({ companyRef: '(SELECT company_id FROM journeys WHERE id = $1::uuid)', customerIdsRef: 'ARRAY(SELECT customer_id FROM ex)' })}) f");
    expect(src).not.toContain('isMallPurchaseDoorForJourneyStats');
    expect(src).not.toMatch(/ce\.event_name = 'purchase'/);
    expect(src).toContain("${purchasedSinceEntrySql('e', 'j.company_id', `j.trigger_event = 'customer.created'`)} AS conv");
  });

  it('단계 클릭 수는 그 여정 회사의 이벤트만', () => {
    // ★ 2026-11-02 클릭 = CT-J9 조각(회사 · 여정 · 칸 · journey-click journeyClickSql)
    expect(src).toContain("WHERE ${journeyClickSql('ce', { companyExpr: '(SELECT company_id FROM journeys WHERE id = $1::uuid)', journeyExpr: '$1::uuid', stepExpr: 's.id' })}");
  });
});
