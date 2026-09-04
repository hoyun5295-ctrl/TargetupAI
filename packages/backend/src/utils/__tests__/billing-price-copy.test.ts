/**
 * 정산 단가 화면 문구가 **실제 게이트와 같은 말을 하는가** (2026-09-04 신설 · 서수란 접수 후속).
 *
 * 접수는 "랩디 발행이 막힌다"였는데, 그 안에 별도 오해가 하나 섞여 있었다 —
 * "단가설정 화면 설명에는 미지정하면 청구서 발행이 차단된다고 나와 있지만
 *  사용하지 않는 업체들은 단가 미지정인데 발행이 되었습니다."
 *
 * 화면이 틀렸다. 실제 게이트는 **그 유형으로 성공 발송이 있을 때만** 막고
 * (`findUnsetPricedTypes`·`priceBillingRows` 둘 다 success > 0 조건),
 * 테스트 단가는 비면 SMS·LMS를 상속한다(`TEST_SMS: testSmsRaw ?? sms`).
 * 그런데 화면은 값이 비기만 하면 조건 없이 "청구서 발행이 차단됩니다"라고 했다.
 *
 * 이 파일은 **문구와 게이트가 갈라지는 것**을 막는다. 문구를 되돌리면 여기서 깨진다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findUnsetPricedTypes, priceBillingRows, type BillingUsageRow, type AgentUnitPriceRow } from '../send-usage-aggregation';

const admin = readFileSync(resolve(process.cwd(), '../frontend/src/pages/AdminDashboard.tsx'), 'utf8');

describe('단가 화면 문구 ↔ 발행 게이트 일치 (2026-09-04)', () => {
  it('게이트는 실적이 없으면 막지 않는다 — 문구의 근거', () => {
    const rows: BillingUsageRow[] = [
      { channel: 'web', itemDate: '2026-08-01', typeKey: 'BRAND', userId: 'u1', agentSendId: null, total: 0, success: 0, fail: 0, pending: 0 },
    ];
    expect(findUnsetPricedTypes(['BRAND'], rows), '실적 0인데 막으면 안 쓰는 업체가 전부 걸린다').toEqual([]);
  });

  it('게이트는 실적이 있으면 막는다', () => {
    const rows: BillingUsageRow[] = [
      { channel: 'web', itemDate: '2026-08-01', typeKey: 'BRAND', userId: 'u1', agentSendId: null, total: 10, success: 10, fail: 0, pending: 0 },
    ];
    expect(findUnsetPricedTypes(['BRAND'], rows).map((u) => u.key)).toEqual(['BRAND']);
  });

  it('에이전트 단가도 성공 수량이 있을 때만 미설정으로 잡는다', () => {
    const zero: BillingUsageRow[] = [
      { channel: 'agent', itemDate: '2026-08-01', typeKey: 'BRAND', userId: null, agentSendId: 'V0001', total: 0, success: 0, fail: 0, pending: 0 },
    ];
    const prices: AgentUnitPriceRow[] = [
      { id: 'a1', agent_send_id: 'V0001', cost_per_sms: 7.2, cost_per_lms: 23.5, cost_per_mms: 50, cost_per_kakao: 4.5, cost_per_brand: null },
    ];
    expect(priceBillingRows(zero, {}, prices, 'vat_excluded').missingAgentPrices).toEqual([]);
  });

  it('화면 문구가 조건을 밝힌다 — "비어 있으면 무조건 차단"이라고 말하지 않는다', () => {
    expect(admin, '옛 단정 문구가 되살아났다 — 게이트는 실적 있는 유형만 막는다')
      .not.toContain('미설정. 청구서 발행이 차단됩니다');
    expect(admin, '조건(발송 실적)을 밝히는 문구가 없다')
      .toContain('이 유형으로 발송이 있으면 청구서 발행이 차단됩니다');
  });

  it('테스트 단가는 차단이 아니라 상속이라고 말한다', () => {
    expect(admin, '테스트 단가는 비면 SMS·LMS를 상속하는데 차단으로 표시하면 거짓이다')
      .toContain('단가를 따릅니다');
  });

  it('채울 칸이 없는 유형에는 "단가를 채우라"고 하지 않는다', () => {
    expect(admin, 'UNBILLABLE_TYPE_KEY 전용 안내가 없다 — 운영자가 단가 화면을 뒤지게 된다')
      .toContain("includes('UNBILLABLE_TYPE_KEY')");
    expect(admin).toContain('단가를 입력할 칸이 없어');
  });
});
