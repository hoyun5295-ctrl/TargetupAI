/**
 * 수량 수정 발행 계약 — 판정 축은 **청구서에 인쇄되는 줄과 같다** (2026-08-05 신설)
 *
 * 왜 이 파일이 있나:
 *   서수란 0804 접수(제주한라병원 7월 LMS 9,438 → 9,435)로 수량 조정을 만들었는데, 음수 판정 키에
 *   귀속 축을 넣어 **정상 하향 조정이 거부**되는 사고가 축을 바꿔 두 번 났다.
 *     0804 = 계정(userId) 축 · 0805 = 발송ID(agentId) 축 → 재오픈.
 *   조정 행은 귀속 축이 비어 있을 수 있어(발송ID 미지정 = agent_id NULL, DB 실측), 키에 그 축이 있으면
 *   조정만 다른 버킷에 홀로 떨어져 합계가 델타 그대로(-3)가 된다.
 *   ⇒ 판정 키 = buildInvoiceLines의 키(채널·유형·단가). 이 계약이 깨지면 발행이 막힌다.
 */
import { describe, it, expect } from 'vitest';
import { buildAdjustmentBillingItems, findNegativeAdjustedTypes, QtyAdjustmentError } from './billing-qty-adjust';

/** 항목줄 하나 — 판정이 보는 필드만 채운다(나머지는 계약과 무관). */
const item = (o: {
  channel: string; typeKey: string; success: number; unitPrice: number;
  agentId?: string | null; userId?: string | null;
}) => ({
  channel: o.channel,
  itemDate: '2026-07-01',
  typeKey: o.typeKey,
  userId: o.userId ?? null,
  agentSendId: null,
  agentId: o.agentId ?? null,
  total: o.success, success: o.success, fail: 0, pending: 0,
  planDays: null, planMonthDays: null,
  unitPrice: o.unitPrice,
  amount: o.success * o.unitPrice,
  amountExact: o.success * o.unitPrice,
}) as any;

describe('findNegativeAdjustedTypes — 판정 축 = 인쇄 줄 축', () => {
  it('★재오픈 회귀: 발송ID 미지정 조정(-3)이 발송ID 있는 원본과 같은 버킷으로 합쳐진다', () => {
    const sheet = [
      item({ channel: 'agent', typeKey: 'LMS', success: 9438, unitPrice: 22.8, agentId: 'AG-1' }),
      item({ channel: 'agent', typeKey: 'LMS', success: -3, unitPrice: 22.8, agentId: null }), // 조정
    ];
    expect(findNegativeAdjustedTypes(sheet)).toEqual([]);
  });

  it('★0804 회귀: 계정 미지정 조정(-3)도 같은 버킷으로 합쳐진다(합산 발행)', () => {
    const sheet = [
      item({ channel: 'web', typeKey: 'LMS', success: 100, unitPrice: 22.8, userId: 'U-1' }),
      item({ channel: 'web', typeKey: 'LMS', success: -3, unitPrice: 22.8, userId: null }),
    ];
    expect(findNegativeAdjustedTypes(sheet)).toEqual([]);
  });

  it('진짜 음수는 그대로 잡는다 — 실발송보다 큰 하향 조정', () => {
    const sheet = [
      item({ channel: 'agent', typeKey: 'LMS', success: 2, unitPrice: 22.8, agentId: 'AG-1' }),
      item({ channel: 'agent', typeKey: 'LMS', success: -5, unitPrice: 22.8, agentId: null }),
    ];
    const neg = findNegativeAdjustedTypes(sheet);
    expect(neg).toHaveLength(1);
    expect(neg[0]).toMatchObject({ channel: 'agent', typeKey: 'LMS', total: -3 });
  });

  it('단가가 다르면 다른 줄이다 — 다른 단가 줄의 잔량이 음수를 가리지 않는다', () => {
    const sheet = [
      item({ channel: 'web', typeKey: 'SMS', success: 1000, unitPrice: 9.9 }),
      item({ channel: 'web', typeKey: 'SMS', success: 1, unitPrice: 8.0 }),
      item({ channel: 'web', typeKey: 'SMS', success: -4, unitPrice: 8.0 }),
    ];
    const neg = findNegativeAdjustedTypes(sheet);
    expect(neg).toHaveLength(1);
    expect(neg[0].total).toBe(-3);
  });

  it('계정 축은 장이 가른다 — 장 안에 그 계정만 남으면 음수가 드러난다', () => {
    // splitBillingSheets 이후의 한 장(계정 A만)
    const sheetA = [
      item({ channel: 'web', typeKey: 'LMS', success: 2, unitPrice: 22.8, userId: 'A' }),
      item({ channel: 'web', typeKey: 'LMS', success: -3, unitPrice: 22.8, userId: null }),
    ];
    expect(findNegativeAdjustedTypes(sheetA)).toHaveLength(1);
  });

  it('요금제·추가 항목은 수량 축이 없어 판정에서 뺀다', () => {
    const sheet = [
      item({ channel: 'plan', typeKey: 'BASIC', success: -1, unitPrice: 50000 }),
      item({ channel: 'extra', typeKey: '080', success: -1, unitPrice: 100000 }),
    ];
    expect(findNegativeAdjustedTypes(sheet)).toEqual([]);
  });
});

describe('buildAdjustmentBillingItems — 단가는 그 기간 실제 청구 줄에서 빌린다', () => {
  const priced = [
    item({ channel: 'agent', typeKey: 'LMS', success: 9438, unitPrice: 22.8, agentId: 'AG-1' }),
  ];

  it('발송ID 미지정 조정도 같은 채널·유형 줄에서 단가를 빌린다', () => {
    const out = buildAdjustmentBillingItems(
      [{ id: 'a1', channel: 'agent', type_key: 'LMS', agent_id: null, qty_delta: -3 } as any],
      priced, '2026-07-01',
    );
    expect(out).toHaveLength(1);
    expect(out[0].unitPrice).toBe(22.8);
    expect(out[0].success).toBe(-3);
    expect(out[0].amountExact).toBeCloseTo(-68.4, 6);
  });

  it('delta 0은 줄을 만들지 않는다', () => {
    expect(buildAdjustmentBillingItems(
      [{ id: 'a2', channel: 'agent', type_key: 'LMS', agent_id: null, qty_delta: 0 } as any],
      priced, '2026-07-01',
    )).toEqual([]);
  });

  it('그 기간에 대응 줄이 없으면 조용히 0원으로 넘기지 않고 막는다', () => {
    expect(() => buildAdjustmentBillingItems(
      [{ id: 'a3', channel: 'web', type_key: 'MMS', agent_id: null, qty_delta: -3 } as any],
      priced, '2026-07-01',
    )).toThrow(QtyAdjustmentError);
  });
});
