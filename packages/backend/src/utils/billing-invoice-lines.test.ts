import { describe, it, expect } from 'vitest';
import { buildInvoiceLines, checkInvoiceLinesAgainstHeader, invoiceLineLabel } from './billing-invoice-lines';

const item = (o: Record<string, any> = {}) => ({
  channel: 'web', message_type: 'SMS', unit_price: 9, success_count: 10, amount: 90, ...o,
});

describe('buildInvoiceLines — 청구서 항목 줄 (2026-07-26)', () => {
  it('같은 채널·유형·단가면 한 줄로 합쳐진다', () => {
    const lines = buildInvoiceLines([item({ success_count: 10, amount: 90 }), item({ success_count: 5, amount: 45 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ label: 'SMS', count: 15, amount: 135, unitPrice: 9 });
  });

  it('에이전트 줄이 만들어진다 — 헤더 컬럼에는 이 칸이 없어서 항목표에서 빠져 있었다', () => {
    const lines = buildInvoiceLines([
      item({ success_count: 100, amount: 900 }),
      item({ channel: 'agent', message_type: 'LMS', unit_price: 22, success_count: 1000, amount: 22000 }),
    ]);
    expect(lines.map((l) => l.label)).toEqual(['SMS', '에이전트 LMS']);
    expect(lines[1].amount).toBe(22000);
  });

  it('단가가 다르면 줄을 나눈다 — 에이전트는 발송ID별 단가라 합치면 단가 칸이 거짓말이 된다', () => {
    const lines = buildInvoiceLines([
      item({ channel: 'agent', message_type: 'SMS', unit_price: 9, success_count: 10, amount: 90 }),
      item({ channel: 'agent', message_type: 'SMS', unit_price: 11, success_count: 10, amount: 110 }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.unitPrice)).toEqual([9, 11]);
  });

  it('수량 0이고 금액 0인 줄은 만들지 않는다', () => {
    expect(buildInvoiceLines([item({ success_count: 0, amount: 0 })])).toEqual([]);
  });

  it('채널 → 유형 순으로 정렬된다', () => {
    const lines = buildInvoiceLines([
      item({ channel: 'spam', message_type: 'SPAM_SMS' }),
      item({ channel: 'agent', message_type: 'SMS' }),
      item({ channel: 'test', message_type: 'TEST_SMS' }),
      item({ channel: 'web', message_type: 'LMS' }),
      item({ channel: 'web', message_type: 'SMS' }),
    ]);
    expect(lines.map((l) => l.channel)).toEqual(['web', 'web', 'agent', 'test', 'spam']);
    expect(lines[0].typeKey).toBe('SMS');
  });

  it('모르는 유형키도 줄로 나온다 — 조용히 사라지면 그 수량이 청구서에서 증발한다', () => {
    const lines = buildInvoiceLines([item({ channel: 'agent', message_type: 'G', success_count: 42833, amount: 0 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toBe('에이전트 G');
  });

  it('빈 입력에 안전하다', () => {
    expect(buildInvoiceLines([])).toEqual([]);
    expect(buildInvoiceLines(undefined as any)).toEqual([]);
  });
});

describe('요금제 항목 (2026-07-26 ④)', () => {
  it('요금제 줄이 항목표 맨 앞에 온다 — 청구서 항목 1번', () => {
    const lines = buildInvoiceLines([
      item({ channel: 'web', message_type: 'SMS', success_count: 10, amount: 90 }),
      item({ channel: 'plan', message_type: 'PLAN_PRO', unit_price: 1000000, success_count: 0, amount: 709677 }),
    ]);
    expect(lines[0].label).toBe('요금제 PRO');
    expect(lines[0].amount).toBe(709677);
  });

  it('수량 0이어도 금액이 있으면 줄이 나온다 — 요금제는 수량 축이 없다', () => {
    const lines = buildInvoiceLines([item({ channel: 'plan', message_type: 'PLAN_BASIC', success_count: 0, amount: 350000 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0].count).toBe(0);
  });

  it('구간이 나뉘면 단가가 달라 줄도 나뉜다 — 월 중간 변경', () => {
    const lines = buildInvoiceLines([
      item({ channel: 'plan', message_type: 'PLAN_BASIC', unit_price: 350000, success_count: 0, amount: 101613 }),
      item({ channel: 'plan', message_type: 'PLAN_PRO', unit_price: 1000000, success_count: 0, amount: 709677 }),
    ]);
    expect(lines.map((l) => l.label)).toEqual(['요금제 BASIC', '요금제 PRO']);
  });

  it('0원 요금제(FREE)는 줄을 만들지 않는다', () => {
    expect(buildInvoiceLines([item({ channel: 'plan', message_type: 'PLAN_FREE', unit_price: 0, success_count: 0, amount: 0 })])).toEqual([]);
  });
});

describe('invoiceLineLabel — 채널 접두', () => {
  it('웹은 접두 없이, 에이전트는 접두를 붙인다', () => {
    expect(invoiceLineLabel('web', 'SMS')).toBe('SMS');
    expect(invoiceLineLabel('agent', 'LMS')).toBe('에이전트 LMS');
  });

  it('테스트·스팸은 유형 라벨이 이미 구분된다', () => {
    expect(invoiceLineLabel('test', 'TEST_SMS')).toBe('테스트 SMS');
    expect(invoiceLineLabel('spam', 'SPAM_LMS')).toBe('스팸필터 LMS');
  });

  it('카카오는 알림톡으로 — 발송통계 엑셀과 같은 이름', () => {
    expect(invoiceLineLabel('web', 'KAKAO')).toBe('카카오알림톡');
  });
});

describe('checkInvoiceLinesAgainstHeader — 렌더 전 정합 (2026-07-26)', () => {
  const line = (amount: number) => ({ channel: 'web', typeKey: 'SMS', label: 'SMS', unitPrice: 9, count: 1, amount });

  it('맞으면 ok', () => {
    expect(checkInvoiceLinesAgainstHeader([line(900), line(22000)], 4000, 26900).ok).toBe(true);
  });

  it('에이전트 줄이 빠지면 잡힌다 — 고객이 세로로 더하면 안 맞는 그 상태', () => {
    const r = checkInvoiceLinesAgainstHeader([line(900)], 0, 22900);
    expect(r.ok).toBe(false);
    expect(r.diff).toBe(-22000);
  });

  it('AI 크레딧을 빼먹으면 잡힌다 — 크레딧은 billing_items 행이 없다', () => {
    expect(checkInvoiceLinesAgainstHeader([line(900)], 0, 4900).ok).toBe(false);
  });

  it('기존 발행분(크레딧만 있는 청구서)도 통과한다', () => {
    expect(checkInvoiceLinesAgainstHeader([], 4000, 4000).ok).toBe(true);
  });

  it('빈 입력에 안전하다', () => {
    expect(checkInvoiceLinesAgainstHeader([], 0, 0).ok).toBe(true);
    expect(checkInvoiceLinesAgainstHeader(undefined as any, 0, 0).ok).toBe(true);
  });
});

// ============================================================
//  요금제 줄 — 구간 분리·전용 일수 컬럼 (★ 2026-07-26 Codex 3차)
// ============================================================

const planItem = (o: Record<string, any> = {}) => ({
  channel: 'plan', message_type: 'PLAN_BASIC', unit_price: 350000,
  success_count: 0, total_count: 0, fail_count: 0, pending_count: 0,
  item_date: '2026-07-01', plan_days: 31, plan_month_days: 31, amount: 350000, ...o,
});

describe('buildInvoiceLines — 요금제 줄 (2026-07-26)', () => {
  it('일수를 전용 컬럼에서 읽는다 — 발송 수량 컬럼은 0이어야 한다', () => {
    const lines = buildInvoiceLines([planItem({ plan_days: 9, plan_month_days: 31, amount: 101613 })]);
    expect(lines[0].quantityText).toBe('9일 / 31일');
    expect(lines[0].planDays).toBe(9);
    expect(lines[0].count).toBe(0);
  });

  it('같은 플랜·같은 단가라도 구간이 다르면 줄이 나뉜다 — 6월분과 7월분이 합쳐지면 수량 문구가 거짓이 된다', () => {
    const lines = buildInvoiceLines([
      planItem({ item_date: '2026-06-10', plan_days: 21, plan_month_days: 30, amount: 245000 }),
      planItem({ item_date: '2026-07-01', plan_days: 31, plan_month_days: 31, amount: 350000 }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.quantityText)).toEqual(['21일 / 30일', '31일 / 31일']);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(595000);
  });

  it('구간이 여럿이면 항목명에 적용 구간이 붙는다 — 어느 달 줄인지 고객이 검산할 수 있게', () => {
    const lines = buildInvoiceLines([planItem({ item_date: '2026-07-01', plan_days: 9, plan_month_days: 31, amount: 101613 })]);
    expect(lines[0].label).toBe('요금제 BASIC (07-01~07-09)');
  });

  it('하루짜리 구간은 시작일만 적는다', () => {
    const lines = buildInvoiceLines([planItem({ item_date: '2026-07-31', plan_days: 1, plan_month_days: 31, amount: 11290 })]);
    expect(lines[0].label).toBe('요금제 BASIC (07-31~07-31)');
  });

  it('구간 순서는 시작일로 고정된다 — 같은 단가라 정렬 tie가 생긴다(D150-4 계열)', () => {
    const lines = buildInvoiceLines([
      planItem({ item_date: '2026-07-10', plan_days: 22, plan_month_days: 31, amount: 248387 }),
      planItem({ item_date: '2026-06-20', plan_days: 11, plan_month_days: 30, amount: 128333 }),
    ]);
    expect(lines.map((l) => l.itemDate)).toEqual(['2026-06-20', '2026-07-10']);
  });

  it('발송 줄은 일자로 나뉘지 않는다 — 채널·유형·단가로 합쳐야 청구서가 읽힌다', () => {
    const lines = buildInvoiceLines([
      item({ item_date: '2026-07-01', success_count: 10, amount: 90 }),
      item({ item_date: '2026-07-02', success_count: 5, amount: 45 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].count).toBe(15);
  });
});

// ============================================================
//  발행 → 저장 → 청구서 한 바퀴 (★ 2026-07-26)
//  요금제 행이 낀 상태에서 "항목 세로합 + 크레딧 = 공급가액"이 성립하는지.
//  이 불변식이 깨진 청구서는 고객이 항목을 더해보면 바로 드러난다.
// ============================================================

describe('요금제 포함 청구서 세로합 (2026-07-26)', () => {
  // `/generate`가 billing_items에 넣는 그 컬럼으로 되돌린다(PG round-trip 모사)
  const toRow = (i: any) => ({
    channel: i.channel, item_date: i.itemDate, message_type: i.typeKey,
    total_count: i.total, success_count: i.success, fail_count: i.fail, pending_count: i.pending,
    unit_price: i.unitPrice, amount: i.amount,
    plan_days: i.planDays, plan_month_days: i.planMonthDays,
  });

  const rows = [
    // 요금제: 7/1~7/9 BASIC(350,000), 7/10~7/31 PRO(1,000,000) — 월 중간 변경
    { channel: 'plan', itemDate: '2026-07-01', typeKey: 'PLAN_BASIC', total: 0, success: 0, fail: 0, pending: 0,
      planDays: 9, planMonthDays: 31, unitPrice: 350000, amount: 101613 },
    { channel: 'plan', itemDate: '2026-07-10', typeKey: 'PLAN_PRO', total: 0, success: 0, fail: 0, pending: 0,
      planDays: 22, planMonthDays: 31, unitPrice: 1000000, amount: 709677 },
    { channel: 'web', itemDate: '2026-07-03', typeKey: 'SMS', total: 100, success: 98, fail: 2, pending: 0,
      planDays: null, planMonthDays: null, unitPrice: 9, amount: 882 },
    { channel: 'agent', itemDate: '2026-07-03', typeKey: 'LMS', total: 500, success: 500, fail: 0, pending: 0,
      planDays: null, planMonthDays: null, unitPrice: 22, amount: 11000 },
  ];

  it('요금제 2구간 + 웹 + 에이전트 + 크레딧이 공급가액과 정확히 맞는다', () => {
    const aiCreditSupply = 40000;
    const subtotal = rows.reduce((s, i) => s + i.amount, 0) + aiCreditSupply;
    const lines = buildInvoiceLines(rows.map(toRow));
    expect(checkInvoiceLinesAgainstHeader(lines, aiCreditSupply, subtotal).ok).toBe(true);
    // 요금제 두 구간이 각각 한 줄로 남는다 — 합쳐지면 수량 문구가 한쪽만 남아 거짓이 된다
    expect(lines.filter((l) => l.channel === 'plan')).toHaveLength(2);
    expect(lines[0].label).toBe('요금제 BASIC (07-01~07-09)');
  });

  it('요금제 행은 발송 수량 합계에 섞이지 않는다 — 화면 tfoot이 이 값을 더한다', () => {
    const dbRows = rows.map(toRow);
    expect(dbRows.reduce((s, r) => s + Number(r.total_count), 0)).toBe(600);
    expect(dbRows.reduce((s, r) => s + Number(r.fail_count), 0)).toBe(2);
  });
});
