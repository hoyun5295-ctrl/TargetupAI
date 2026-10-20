/**
 * 여정 V.3 묶음 4 — 지도 서버: 여정마다 상태 한 줄 · 겹침 고치기 · 요약 숫자(2026-10-20 · 설계서 §10-3)
 *
 * 화면은 의미를 추론하지 않는다(1009 설계서 §1) — 문장 · 고치기 행동은 서버가 짓는다.
 * 순서 = 막힘(시스템 멈춤) > 손볼 곳 > 조용(켜졌는데 들어온 고객 0) > 잘 됨 · 사람이 멈춤 · 초안 · 끝남은 따로.
 */
import { describe, it, expect } from 'vitest';
import { journeyHealth, overlapFixFor } from '../journey-lifecycle-map';

const base = (over: Record<string, any> = {}) => ({
  id: 'J', name: '신규 가입', status: 'active', triggerEvent: 'customer.created', windowDays: 42, goalLabel: '구매 확인',
  counts: { activeNow: 84, inProgress: 84, entered: 312, goalMet: 41, completed: 200 },
  graph: { edges: [], exitSlots: [], issues: [] as string[] }, broadAudience: false, activationCost: 0, pause: null, ...over,
}) as any;

describe('journeyHealth', () => {
  it('잘 됨 = 최근 W일 들어옴 · 목표로 마침', () => {
    expect(journeyHealth(base(), [], [])).toEqual({ tone: 'good', text: '최근 42일 312명 들어옴 · 41명 구매 확인', fix: null });
  });
  it('조용 = 켜졌는데 최근 W일 들어온 고객 0', () => {
    expect(journeyHealth(base({ counts: { activeNow: 0, inProgress: 0, entered: 0, goalMet: 0, completed: 0 } }), [], []).tone).toBe('quiet');
  });
  it('손볼 곳 = 보내는 선이 새면(목표 종료 꺼짐) 그 여정에 · 고치기 행동은 선의 것', () => {
    const fix = { action: 'goal_exit_on', journeyId: 'J', label: '목표를 이루면 멈춤 켜기' };
    const h = journeyHealth(base(), [{ fromJourneyId: 'J', toJourneyId: 'K', state: 'leak', reason: '구매해도 끝까지 보내요.', fix } as any], []);
    expect(h).toEqual({ tone: 'fix', text: '구매해도 끝까지 보내요.', fix });
  });
  it('다시 받기 꺼짐은 받는 여정에 붙는다', () => {
    const fix = { action: 'allow_reentry_on', journeyId: 'K', label: '다음 구매 때 다시 받기 켜기' };
    const line = { fromJourneyId: 'J', toJourneyId: 'K', state: 'reentry_off', reason: '받는 여정이 같은 고객을 다시 받지 않아요.', fix } as any;
    expect(journeyHealth(base(), [line], []).tone).toBe('good');
    expect(journeyHealth(base({ id: 'K' }), [line], []).tone).toBe('fix');
  });
  it('해소할 수 있는 겹침 = 손볼 곳 · 해소 길 없는 겹침은 손볼 곳이 아니다', () => {
    const fix = { action: 'exclude_dormant_return', journeyId: 'J', label: '돌아온 고객은 환영만' };
    expect(journeyHealth(base(), [], [{ a: 'J', b: 'R', concurrentActive: 0, text: '같은 구매에 문자 2통 · 휴면 복귀', fix } as any]).tone).toBe('fix');
    expect(journeyHealth(base(), [], [{ a: 'J', b: 'P', concurrentActive: 0, text: '같은 구매에 문자 2통 · 상품', fix: null } as any]).tone).toBe('good');
  });
  it('시스템 멈춤 = 막힘(멈춘 이유 사람 말) · 사람 멈춤 = 멈춤', () => {
    const blocked = journeyHealth(base({ status: 'paused', pause: { kind: 'credit', text: '이번 달 크레딧이 모자라 여정을 멈췄어요.', fix: { action: 'plan_upgrade', label: '요금제 올리기 신청' } } }), [], []);
    expect(blocked.tone).toBe('blocked');
    expect(blocked.text).toBe('이번 달 크레딧이 모자라 여정을 멈췄어요.');
    expect(journeyHealth(base({ status: 'paused', pause: { kind: 'manual', text: '멈춰 둔 여정이에요.', fix: null } }), [], []).tone).toBe('paused');
  });
  it('초안 = 처음 켜기 크레딧(서버 판정) · 끝남', () => {
    expect(journeyHealth(base({ status: 'draft', activationCost: 200 }), [], []).text).toBe('아직 켜지 않았어요 · 처음 켜기 200크레딧');
    expect(journeyHealth(base({ status: 'draft', activationCost: 0 }), [], []).text).toBe('아직 켜지 않았어요 · 추가 크레딧 0');
    expect(journeyHealth(base({ status: 'ended' }), [], []).tone).toBe('ended');
  });
});

describe('overlapFixFor', () => {
  const J = (id: string, triggerEvent: string, name = id) => ({ id, triggerEvent, name, status: 'active' }) as any;
  it('주문 완료 ↔ 휴면 복귀 = 돌아온 고객은 환영만(주문 완료 여정에)', () => {
    expect(overlapFixFor(J('O', 'cdp.purchase', '주문 완료'), J('R', 'customer.dormant_return', '휴면 복귀'))).toEqual({ action: 'exclude_dormant_return', journeyId: 'O', label: '돌아온 고객은 환영만(한 통만)' });
  });
  it('주문 완료 ↔ 첫 구매 = 첫 구매 고객 빼기', () => {
    expect(overlapFixFor(J('F', 'purchase.first'), J('O', 'cdp.purchase'))).toEqual({ action: 'exclude_first_purchase', journeyId: 'O', label: '첫 구매 고객은 빼기(한 통만)' });
  });
  it('상품 ↔ 주문 완료 = 해소 길 없음', () => {
    expect(overlapFixFor(J('P', 'purchase.product'), J('O', 'cdp.purchase'))).toBeNull();
  });
});
