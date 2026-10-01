/**
 * ★ 2026-10-01 B-1001-7 구매이력 화면 = 구매 원장 + 자사몰 매출 반영 주문 (이에스페이먼트 "구매이력이 안 보인다")
 *   운영 실측: 4몰 주문 가져오기 완료 · cdp_events 결제 확정 28,269건 · purchases 0행 → 화면 0건.
 *   ⛔ 원장에는 쓰지 않는다(여정이 두 원천을 다 읽어 중복 발송 위험) — 읽는 화면만 합친다.
 *   실제 실행은 일회용 PostgreSQL 16 으로 확인(자사몰 행 · 매장 칸 · 옛 결제 행 포함 · 환불·결제 전·표식 되돌림·미연결·타사 제외 · KST 날짜).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { purchaseHistorySourceSql } from '../purchase-history-source';
import { REVENUE_STATUSES } from '../cdp-order-revenue';

const SRC = resolve(__dirname, '../..');
const sql = purchaseHistorySourceSql('$1');

describe('구매이력 원천 SQL', () => {
  it('두 원천을 같은 칸으로 합치고 둘 다 회사로 먼저 좁힌다', () => {
    expect(sql).toContain('FROM purchases p0');
    expect(sql).toContain('WHERE p0.company_id = $1');
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('FROM cdp_events e');
    expect(sql).toContain('WHERE e.company_id = $1');
    expect(sql).toMatch(/\) p$/);
    for (const col of ['id', 'company_id', 'customer_id', 'purchase_date', 'store_code', 'store_name', 'product_name', 'quantity', 'total_amount', 'origin']) {
      expect(sql, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
  it('자사몰 행 = 매출 반영(CT-86 isRevenueApplied 규칙) · 차감 제외 · 고객 연결된 주문 이벤트만', () => {
    expect(sql).toContain("e.event_name = 'purchase'");
    expect(sql).toContain('e.customer_id IS NOT NULL');
    expect(sql).toContain(`(e.properties->'revenue_applied' = 'true'::jsonb OR (NOT (e.properties ? 'revenue_applied') AND e.properties->>'status' IN (${REVENUE_STATUSES.map((x) => `'${x}'`).join(', ')})))`);
    expect(sql).toContain("COALESCE(e.properties->'revenue_reversed' = 'true'::jsonb, false) = false");
  });
  it('매장 = provider 별 규칙 · 이벤트당 연동 행 최대 1(Codex R1) · 구매일 = KST 벽시계', () => {
    expect(sql).toContain('LEFT JOIN LATERAL (');
    expect(sql).toContain('ci.company_id = e.company_id AND ci.provider = e.source');
    // 두 갈래는 배타(Codex R2) — 접두 비교는 우커머스에만. 접두 없는 주문번호가 연동 mall_id 와 우연히 같아도 붙지 않는다
    expect(sql).toContain("(e.source = 'woocommerce' AND ci.mall_id = split_part(e.properties->>'order_id', ':', 1))");
    expect(sql).not.toMatch(/AND \(ci\.mall_id = split_part/);
    expect(sql).not.toContain("ORDER BY (ci.mall_id =");
    expect(sql).toContain("OR (e.source <> 'woocommerce'");
    expect(sql).toContain('(SELECT COUNT(*) FROM company_integrations c1 WHERE c1.company_id = e.company_id AND c1.provider = e.source) = 1');
    expect(sql).toContain('LIMIT 1');
    expect(sql).toContain("(e.occurred_at AT TIME ZONE 'Asia/Seoul') AS purchase_date");
  });
  it('같은 고객 · 같은 날 · 같은 금액의 원장 행이 있으면 자사몰 행을 뺀다(ERP 에도 오는 자사몰 주문 이중 표시 방지 · Codex R1)', () => {
    expect(sql).toMatch(/AND NOT EXISTS \(\s+SELECT 1 FROM purchases px\s+WHERE px\.company_id = e\.company_id AND px\.customer_id = e\.customer_id\s+AND px\.purchase_date::date = \(e\.occurred_at AT TIME ZONE 'Asia\/Seoul'\)::date\s+AND px\.total_amount = CASE WHEN/);
  });
  it('구매 원장에 자사몰 주문을 쓰지 않는다(여정 중복 발송 방지) — INSERT INTO purchases 는 싱크 적재만', () => {
    const orders = readFileSync(resolve(SRC, 'utils/cdp-orders.ts'), 'utf8');
    expect(orders).not.toMatch(/INSERT INTO purchases/);
  });
});

describe('구매이력 API 두 곳이 같은 원천을 쓴다', () => {
  const routes = readFileSync(resolve(SRC, 'routes/customers.ts'), 'utf8');
  it('관리 > 구매내역(목록·요약·매장별·고객별)', () => {
    expect(routes).toContain("const fromJoin = `FROM ${purchaseHistorySourceSql('$1')} JOIN customers c ON c.id = p.customer_id AND c.company_id = p.company_id`;");
  });
  it('고객별 구매내역 창(요약·목록) — 옛 purchases 직접 조회 0', () => {
    const at = routes.indexOf("router.get('/:id/purchases'");
    const body = routes.slice(at, routes.indexOf('\nrouter.', at + 10));
    expect((body.match(/purchaseHistorySourceSql\('\$2'\)/g) || []).length).toBe(2);
    expect(body).not.toMatch(/FROM purchases\b/);
  });
});
