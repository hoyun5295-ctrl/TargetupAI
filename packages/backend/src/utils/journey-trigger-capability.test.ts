/**
 * 여정 가능 여부 판정 — 회사가 준 데이터로만 가른다 (2026-08-01, 설계서 §2-3)
 *
 * 못 박는 것:
 *   1. 8종이 빠짐없이 판정된다 — 목록에서 빠지면 화면이 그 트리거를 그냥 열어버린다.
 *   2. 근거가 없으면 잠근다 — "일단 만들게 두고 0건"이 이 제품이 고치려는 병이다.
 *   3. 예약은 회사 데이터와 무관하게 잠긴다 — 예약을 받는 연동 자체가 없다.
 *   4. 사유는 고객 언어다 — 컬럼명·테이블명·내부 용어가 화면에 나가면 안 된다.
 */
import { describe, it, expect } from 'vitest';
import {
  TRIGGER_KEYS,
  resolveTriggerAvailability,
  toAvailabilityMap,
  hasAnyAvailableTrigger,
  triggerKeyForEvent,
  type CompanyJourneyFacts,
} from './journey-trigger-capability';

/** 저장되는 trigger_event 8종 + 상시 + 모르는 값. */
const STORED_EVENTS: Array<[string, string | null]> = [
  ['cdp.purchase', 'purchase'],
  ['purchase.first', 'first_purchase'],           // ★ §11-5 신설(#2)
  ['customer.dormant_return', 'dormant_return'],  // ★ §11-5 신설(#5)
  ['customer.cycle_lapsed', 'cycle_lapsed'],      // ★ §11-5 신설(#6)
  ['cdp.browse_no_purchase', 'browse'],           // ★ §11-5 신설(#12)
  ['cdp.reservation_created', 'reservation'],
  ['cdp.cart_abandon', 'cart'],
  ['custom_order_shipped', 'shipped'],
  ['customer.created', 'signup'],
  ['customer.dormant', 'dormant'],
  ['customer.birthday_approaching', 'birthday'],
  ['customer.points_expiring', 'points'],
  ['custom', null],
  ['customer.grade_changed', 'grade'],            // ★ §11-5 신설(#7)
  ['purchase.product', 'product'],                // ★ 0930 V2 3차 상품 재구매
  ['customer.made_up_thing', null],
];

const NOTHING: CompanyJourneyFacts = {
  canJudgeNewCustomer: false,
  hasRecentPurchaseDate: false,
  hasBirthday: false,
  hasPoints: false,
  hasGrade: false,
  hasPurchaseEvents: false,
  hasCartEvents: false,
  hasBrowseEvents: false,
  hasShippedEvents: false,
};

const map = (f: CompanyJourneyFacts) => toAvailabilityMap(resolveTriggerAvailability(f));

describe('트리거 8종 전수 판정', () => {
  it('빠짐없이 판정한다', () => {
    const list = resolveTriggerAvailability(NOTHING);
    expect(list).toHaveLength(TRIGGER_KEYS.length);
    expect([...list.map((a) => a.key)].sort()).toEqual([...TRIGGER_KEYS].sort());
  });

  it('데이터가 하나도 없으면 전부 잠긴다', () => {
    const list = resolveTriggerAvailability(NOTHING);
    expect(list.every((a) => !a.available)).toBe(true);
    expect(hasAnyAvailableTrigger(list)).toBe(false);
  });

  it('잠긴 사유가 트리거마다 다르다 — 무엇을 연동해야 하는지 알 수 있게', () => {
    const reasons = resolveTriggerAvailability(NOTHING).map((a) => a.reason);
    expect(new Set(reasons).size).toBeGreaterThanOrEqual(5);
  });
});

describe('근거별 개방', () => {
  it('구매이력이 있으면 신규가입이 열린다', () => {
    expect(map({ ...NOTHING, canJudgeNewCustomer: true }).signup.available).toBe(true);
  });

  it('최근구매일이 있으면 휴면이 열린다', () => {
    expect(map({ ...NOTHING, hasRecentPurchaseDate: true }).dormant.available).toBe(true);
  });

  it('생년월일이 있으면 생일이 열린다', () => {
    expect(map({ ...NOTHING, hasBirthday: true }).birthday.available).toBe(true);
  });

  it('포인트가 있으면 포인트 소멸이 열린다', () => {
    expect(map({ ...NOTHING, hasPoints: true }).points.available).toBe(true);
  });

  it('주문·장바구니·배송 기록이 각각 그 트리거만 연다', () => {
    expect(map({ ...NOTHING, hasPurchaseEvents: true }).purchase.available).toBe(true);
    expect(map({ ...NOTHING, hasPurchaseEvents: true }).cart.available).toBe(false);
    expect(map({ ...NOTHING, hasCartEvents: true }).cart.available).toBe(true);
    expect(map({ ...NOTHING, hasShippedEvents: true }).shipped.available).toBe(true);
  });

  it('한 근거가 다른 트리거를 열지 않는다', () => {
    const m = map({ ...NOTHING, hasPoints: true });
    for (const k of TRIGGER_KEYS) {
      if (k !== 'points') expect(m[k].available).toBe(false);
    }
  });
});

describe('예약은 구조적으로 잠긴다', () => {
  it('데이터가 전부 있어도 잠긴다 — 예약을 받는 연동 자체가 없다', () => {
    const all: CompanyJourneyFacts = {
      canJudgeNewCustomer: true, hasRecentPurchaseDate: true, hasBirthday: true, hasPoints: true, hasGrade: true, hasGradeOrder: true,
      hasPurchaseEvents: true, hasCartEvents: true, hasBrowseEvents: true, hasShippedEvents: true,
      hasProductPurchases: true,   // ★ 0930 V2 3차 — 상품 단위 구매(상품 재구매 여정 근거)
    };
    expect(map(all).reservation.available).toBe(false);
    // 나머지는 전부 열려야 한다(예약만 막는 것이지 전부 막는 게 아니다).
    expect(resolveTriggerAvailability(all).filter((a) => a.available)).toHaveLength(TRIGGER_KEYS.length - 1);
  });
});

describe('저장값 → 화면 key 매핑 (표 기반 전수)', () => {
  it.each(STORED_EVENTS)('%s → %s', (event, expected) => {
    expect(triggerKeyForEvent(event)).toBe(expected);
  });

  it('8종이 서로 다른 key로 매핑된다 — 하나라도 겹치면 게이트가 남의 판정을 쓴다', () => {
    const keys = STORED_EVENTS.map(([, k]) => k).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...new Set(keys)].sort()).toEqual([...TRIGGER_KEYS].sort());
  });
});

// ★ 2026-11-01 Harold — 수신자 상한 = 선택(옛 「전 트리거 필수」 판정 · 면제 목록 시험은 지웠다 · 선택 계약 = __tests__/journey-v3-edit-1020.test.ts · journey-deploy2-1101.test.ts)

describe('사유는 고객 언어로만 쓴다', () => {
  const allReasons = [
    ...resolveTriggerAvailability(NOTHING).map((a) => a.reason),
    ...resolveTriggerAvailability({
      canJudgeNewCustomer: true, hasRecentPurchaseDate: true, hasBirthday: true, hasPoints: true, hasGrade: true, hasGradeOrder: true,
      hasPurchaseEvents: true, hasCartEvents: true, hasBrowseEvents: true, hasShippedEvents: true,
    }).map((a) => a.reason),
  ];

  it('컬럼명·테이블명·내부 용어가 없다', () => {
    // LESSONS_META — 내부 코드명·개발 용어의 사용자 노출 금지(주석은 허용, 화면 문구는 고객 언어).
    const banned = [
      'customers', 'cdp_events', 'purchases', 'journey', 'trigger_event', 'company_id',
      'recent_purchase_date', 'purchase_count', 'birth_date', 'null', 'NULL', 'CT-', 'SDK',
    ];
    for (const r of allReasons) {
      for (const b of banned) {
        expect(r.includes(b), `사유에 내부 용어 "${b}"가 있다: ${r}`).toBe(false);
      }
    }
  });

  it('사유가 비어 있지 않다', () => {
    for (const r of allReasons) expect(r.trim().length).toBeGreaterThan(5);
  });
});

/**
 * ★ 2026-08-02 — 등급은 **상승만** 발화한다. 값만 있고 서열이 없으면 방향을 못 가리므로 열지 않는다.
 *   이 게이트가 없던 시절의 판정은 "값이 다르면 진입"이라 **떨어진 고객에게도 축하가 나갔다.**
 */
describe('등급 — 서열을 확인해야 열린다', () => {
  const base = {
    canJudgeNewCustomer: true, hasRecentPurchaseDate: true, hasBirthday: true, hasPoints: true,
    hasPurchaseEvents: true, hasCartEvents: true, hasBrowseEvents: true, hasShippedEvents: true,
  };
  const gradeOf = (facts: any) => resolveTriggerAvailability(facts).find((x) => x.key === 'grade')!;

  it('등급 값이 없으면 등급 정보를 안내한다', () => {
    const r = gradeOf({ ...base, hasGrade: false, hasGradeOrder: false });
    expect(r.available).toBe(false);
    expect(r.reason).toContain('등급 정보가 없어요');
  });

  it('값은 있는데 서열을 안 정했으면 잠그고 무엇을 하면 되는지 말한다', () => {
    const r = gradeOf({ ...base, hasGrade: true, hasGradeOrder: false });
    expect(r.available).toBe(false);
    expect(r.reason).toContain('등급 순서');
  });

  it('서열까지 확인됐을 때만 열리고, 문구도 상승으로 말한다', () => {
    const r = gradeOf({ ...base, hasGrade: true, hasGradeOrder: true });
    expect(r.available).toBe(true);
    expect(r.reason).toContain('올라가면');
  });
});
