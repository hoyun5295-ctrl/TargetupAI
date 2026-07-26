import { describe, it, expect } from 'vitest';
import { billingLedgerFingerprint, hasAgentMapping, type AgentLedgerRow, type BillingLedger } from './billing-ledger';

const co = (o: Record<string, any> = {}) => ({
  cost_per_sms: 9, cost_per_lms: 27, cost_per_mms: 90, cost_per_kakao: 8,
  cost_per_test_sms: null, cost_per_test_lms: null, ...o,
});

const ag = (o: Partial<AgentLedgerRow> = {}): AgentLedgerRow => ({
  id: 'cai-1', agent_send_id: 'D0018', billing_type: 'postpaid',
  cost_per_sms: null, cost_per_lms: null, cost_per_mms: null, cost_per_kakao: null, ...o,
});

describe('billingLedgerFingerprint — 발행 중 원장 변경 감지 (2026-07-26)', () => {
  it('같은 값이면 같은 지문', () => {
    expect(billingLedgerFingerprint(co(), [ag()])).toBe(billingLedgerFingerprint(co(), [ag()]));
  });

  it('읽는 순서가 달라도 같은 지문 — 정렬을 고정한다', () => {
    const a = billingLedgerFingerprint(co(), [ag({ id: 'a' }), ag({ id: 'b' })]);
    const b = billingLedgerFingerprint(co(), [ag({ id: 'b' }), ag({ id: 'a' })]);
    expect(a).toBe(b);
  });

  it('발송ID 단가를 채우면 지문이 바뀐다 — 직원이 단가를 넣는 그 순간을 잡는다', () => {
    expect(billingLedgerFingerprint(co(), [ag()]))
      .not.toBe(billingLedgerFingerprint(co(), [ag({ cost_per_sms: 9 })]));
  });

  it('선불↔후불 전환이 지문에 잡힌다 — 사용량은 빠졌는데 단가만 남는 경로 차단', () => {
    expect(billingLedgerFingerprint(co(), [ag({ billing_type: 'prepaid' })]))
      .not.toBe(billingLedgerFingerprint(co(), [ag({ billing_type: 'postpaid' })]));
  });

  it('회사 단가 변경도 잡는다 — 에이전트만 묶으면 같은 결함이 웹에 남는다', () => {
    expect(billingLedgerFingerprint(co(), [ag()]))
      .not.toBe(billingLedgerFingerprint(co({ cost_per_mms: 100 }), [ag()]));
  });

  it('미설정(NULL)과 명시적 0원을 다른 지문으로 본다 — 청구에서 다르게 다뤄지는 값이다', () => {
    expect(billingLedgerFingerprint(co({ cost_per_mms: null }), []))
      .not.toBe(billingLedgerFingerprint(co({ cost_per_mms: 0 }), []));
  });

  it('발송ID가 추가되면 지문이 바뀐다', () => {
    expect(billingLedgerFingerprint(co(), [ag()]))
      .not.toBe(billingLedgerFingerprint(co(), [ag(), ag({ id: 'cai-2', agent_send_id: 'D0049' })]));
  });

  it('빈 입력에 안전하다', () => {
    expect(typeof billingLedgerFingerprint(null, [])).toBe('string');
    expect(typeof billingLedgerFingerprint(undefined, undefined as any)).toBe('string');
  });
});

describe('hasAgentMapping — 에이전트 조회를 시도할지 판정', () => {
  const ledger = (rows: AgentLedgerRow[]): BillingLedger => ({
    agentRows: rows, postpaidSendIds: new Set(), postpaidPriceRows: [],
    companyPriceRow: co(), usageType: 'both', fingerprint: '',
  });

  it('매핑이 있으면 true', () => {
    expect(hasAgentMapping(ledger([ag()]))).toBe(true);
  });

  it('매핑이 0이면 false — 순수 웹 회사가 PAY DB 미설정으로 발행 중단되는 것을 막는 판정', () => {
    expect(hasAgentMapping(ledger([]))).toBe(false);
  });

  it('선불만 있어도 매핑은 있는 것이다 — 제외 사유를 설명하려면 조회해야 한다', () => {
    expect(hasAgentMapping(ledger([ag({ billing_type: 'prepaid' })]))).toBe(true);
  });
});
