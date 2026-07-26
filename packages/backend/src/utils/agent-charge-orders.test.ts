import { describe, it, expect } from 'vitest';
import {
  parseAgentChargeOrder,
  parseRejectReason,
  canTransition,
  AGENT_CHARGE_ORDER_MIN,
  AGENT_CHARGE_ORDER_MAX,
} from './agent-charge-orders';

/**
 * ★ 2026-07-27 §5-4 계약 테스트 — 고객사 충전 요청.
 * 요청은 잔액을 건드리지 않지만, 여기서 새는 값이 그대로 §5-3 충전 실행 폼에 자동으로 채워지므로
 * "고객사 입력 → 직원 1클릭 실행" 경로의 첫 관문이 이 파서다.
 */

const ok = { agentSendId: 'D0078', amount: 2000000, depositorName: '런소프트' };

describe('parseAgentChargeOrder', () => {
  it('정상 입력을 정규화해 통과시킨다', () => {
    const r = parseAgentChargeOrder({ ...ok, expectedAt: '2026-07-28', memo: ' 7월분 ' });
    expect(r).toEqual({
      agentSendId: 'D0078',
      amount: 2000000,
      depositorName: '런소프트',
      expectedAt: '2026-07-28',
      memo: '7월분',
    });
  });

  it('선택 항목은 없으면 null로 떨어진다', () => {
    const r = parseAgentChargeOrder(ok) as any;
    expect(r.expectedAt).toBeNull();
    expect(r.memo).toBeNull();
  });

  it('앞뒤 공백을 제거한다', () => {
    const r = parseAgentChargeOrder({ agentSendId: ' D0078 ', amount: 5000, depositorName: '  홍길동 ' }) as any;
    expect(r.agentSendId).toBe('D0078');
    expect(r.depositorName).toBe('홍길동');
  });

  // ── 음수·0 = 요청 창구에서 차단 (상계는 내부 전용) ──────────────────────────
  it('음수 금액을 거부한다 — 고객사 입력으로 차감이 접수되면 안 된다', () => {
    const r = parseAgentChargeOrder({ ...ok, amount: -1000 });
    expect(r).toHaveProperty('error');
    expect((r as any).error).toContain('0보다');
  });

  it('0원을 거부한다', () => {
    expect(parseAgentChargeOrder({ ...ok, amount: 0 })).toHaveProperty('error');
  });

  it('음수 문자열도 거부한다', () => {
    expect(parseAgentChargeOrder({ ...ok, amount: '-5000' })).toHaveProperty('error');
  });

  // ── 금액 형식 ────────────────────────────────────────────────────────────
  it('소수 금액을 거부한다 — 입금액은 원 단위로 떨어진다', () => {
    expect(parseAgentChargeOrder({ ...ok, amount: 1000.5 })).toHaveProperty('error');
  });

  it('숫자가 아닌 금액을 거부한다', () => {
    expect(parseAgentChargeOrder({ ...ok, amount: '이백만' })).toHaveProperty('error');
    expect(parseAgentChargeOrder({ ...ok, amount: '' })).toHaveProperty('error');
    expect(parseAgentChargeOrder({ ...ok, amount: null })).toHaveProperty('error');
  });

  it('지수 표기를 거부한다 — 1e9가 10억으로 통과하면 안 된다', () => {
    expect(parseAgentChargeOrder({ ...ok, amount: '1e9' })).toHaveProperty('error');
  });

  it('하한 미만을 거부하고 하한 정확값은 통과시킨다', () => {
    expect(parseAgentChargeOrder({ ...ok, amount: AGENT_CHARGE_ORDER_MIN - 1 })).toHaveProperty('error');
    expect(parseAgentChargeOrder({ ...ok, amount: AGENT_CHARGE_ORDER_MIN })).not.toHaveProperty('error');
  });

  it('상한 초과를 거부하고 상한 정확값은 통과시킨다', () => {
    expect(parseAgentChargeOrder({ ...ok, amount: AGENT_CHARGE_ORDER_MAX + 1 })).toHaveProperty('error');
    expect(parseAgentChargeOrder({ ...ok, amount: AGENT_CHARGE_ORDER_MAX })).not.toHaveProperty('error');
  });

  // ── 필수값 ──────────────────────────────────────────────────────────────
  it('발송ID 누락을 거부한다', () => {
    expect(parseAgentChargeOrder({ ...ok, agentSendId: '   ' })).toHaveProperty('error');
  });

  it('입금자명 누락을 거부한다', () => {
    expect(parseAgentChargeOrder({ ...ok, depositorName: '' })).toHaveProperty('error');
  });

  it('입금자명 길이 상한을 넘기면 거부한다', () => {
    expect(parseAgentChargeOrder({ ...ok, depositorName: 'ㄱ'.repeat(51) })).toHaveProperty('error');
  });

  it('메모 길이 상한을 넘기면 거부한다', () => {
    expect(parseAgentChargeOrder({ ...ok, memo: 'ㄱ'.repeat(201) })).toHaveProperty('error');
  });

  // ── 날짜 ────────────────────────────────────────────────────────────────
  it('날짜 형식이 아니면 거부한다', () => {
    expect(parseAgentChargeOrder({ ...ok, expectedAt: '2026/07/28' })).toHaveProperty('error');
    expect(parseAgentChargeOrder({ ...ok, expectedAt: '20260728' })).toHaveProperty('error');
  });

  it('존재하지 않는 날짜를 거부한다', () => {
    expect(parseAgentChargeOrder({ ...ok, expectedAt: '2026-13-01' })).toHaveProperty('error');
  });
});

describe('parseRejectReason', () => {
  it('사유 없는 반려를 거부한다 — 고객사가 이유를 알 수 없게 된다', () => {
    expect(parseRejectReason({ reason: '   ' })).toHaveProperty('error');
  });

  it('정상 사유를 통과시킨다', () => {
    expect(parseRejectReason({ reason: ' 입금 미확인 ' })).toEqual({ reason: '입금 미확인' });
  });

  it('길이 상한을 넘기면 거부한다', () => {
    expect(parseRejectReason({ reason: 'ㄱ'.repeat(201) })).toHaveProperty('error');
  });
});

describe('canTransition', () => {
  it('접수 대기에서 실행·반려로만 간다', () => {
    expect(canTransition('pending', 'processing')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('pending', 'fulfilled')).toBe(false);
  });

  it('처리 중에서 완료 또는 되돌림만 허용한다', () => {
    expect(canTransition('processing', 'fulfilled')).toBe(true);
    expect(canTransition('processing', 'pending')).toBe(true);
    expect(canTransition('processing', 'rejected')).toBe(false);
  });

  it('종결 상태는 되돌리지 않는다', () => {
    expect(canTransition('fulfilled', 'pending')).toBe(false);
    expect(canTransition('fulfilled', 'processing')).toBe(false);
    expect(canTransition('rejected', 'pending')).toBe(false);
  });
});
