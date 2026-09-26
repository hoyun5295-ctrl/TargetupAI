/**
 * 분석 미리보기 이탈 위험 고객 수 = DB가 센 수 하나 (★2026-09-26 한줄로 V2 R1-14)
 *
 * 옛: `GROUP BY cu.id HAVING ...`라 이탈 위험 고객 1명당 1행을 Node로 가져와 rows.length로 셌다
 *     (고객×구매 조인 · 창 열 때마다 · 고객 수만큼 행 전송).
 * 처방: 같은 뜻의 NOT EXISTS 카운트 한 행("최근 90일 구매가 없는 활성 고객").
 *   MAX(구매일) < 90일 전 또는 구매 없음 ⇔ 90일 안 구매가 하나도 없음(구매일 NULL 행은 양쪽 다 무시).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'routes', 'analysis.ts'), 'utf8');

describe('이탈 위험 고객 수', () => {
  it('고객별 GROUP BY 행을 가져오지 않는다', () => {
    expect(src).not.toMatch(/GROUP BY cu\.id\s+HAVING MAX\(pu\.purchase_date\)/);
  });
  it('NOT EXISTS 카운트 한 행을 읽는다', () => {
    expect(src).toContain('AND NOT EXISTS (SELECT 1 FROM purchases pu WHERE pu.customer_id = cu.id AND pu.purchase_date >= NOW() - INTERVAL \'90 days\')');
    expect(src).toContain('const churnCount = Number(churnResult.rows[0]?.churn_risk_count) || 0;');
    expect(src).not.toContain('const churnCount = churnResult.rows.length;');
  });
});
