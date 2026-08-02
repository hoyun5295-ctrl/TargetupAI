/**
 * 활성화 게이트 — 발송이 시작되는 길목에서 막는다 (2026-08-01, Codex 4R 수용)
 *
 * 왜 활성화인가
 *   화면 잠금만으로는 샌다. 자연어 생성 경로는 잠금을 안 보고, 가능 여부 조회가 실패해도 우회된다.
 *   활성화는 어느 경로로 만들어졌든 반드시 지나는 한 곳이다.
 *
 * 못 박는 것:
 *   1. 데이터로 만들 수 없는 여정은 활성화되지 않는다 — 사유를 그대로 돌려준다.
 *   2. 예약은 회사 데이터와 무관하게 막힌다(예약을 받는 연동 자체가 없다).
 *   3. 상태형 여정은 수신자 상한 없이 켜지지 않는다 — 유예는 이관 폭발을 미룰 뿐 막지 못한다.
 *   4. 조건을 갖추면 통과한다(과잉 차단 아님).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('./company-data-profile', () => ({ getCompanyJourneyFacts: vi.fn() }));
vi.mock('../services/ai', () => ({ callAIWithFallback: vi.fn() }));
vi.mock('./company-memory', () => ({ buildMemoryPromptContext: vi.fn() }));

import { query } from '../config/database';
import { getCompanyJourneyFacts } from './company-data-profile';
import { activateJourney } from './journey-builder';

const q = query as unknown as ReturnType<typeof vi.fn>;
const facts = getCompanyJourneyFacts as unknown as ReturnType<typeof vi.fn>;

const COMPANY = '22222222-2222-2222-2222-222222222222';
const JOURNEY = '11111111-1111-1111-1111-111111111111';
const USER = '33333333-3333-3333-3333-333333333333';

const OK_STEP = {
  order: 1, type: 'message', channel: 'lms',
  message: '%고객명%님, 오랜만에 인사드립니다. 편하실 때 들러 주세요.',
  subject: '오랜만입니다', delay: 0,
};

const NO_FACTS = {
  canJudgeNewCustomer: false, hasRecentPurchaseDate: false, hasBirthday: false, hasPoints: false, hasGrade: false,
  hasPurchaseEvents: false, hasCartEvents: false, hasBrowseEvents: false, hasShippedEvents: false,
};
const ALL_FACTS = {
  canJudgeNewCustomer: true, hasRecentPurchaseDate: true, hasBirthday: true, hasPoints: true, hasGrade: true, hasGradeOrder: true,
  hasPurchaseEvents: true, hasCartEvents: true, hasBrowseEvents: true, hasShippedEvents: true,
};

/** 활성화 대상 여정 1건을 돌려주는 상세 SELECT. 그 밖 호출은 빈 결과(UPDATE 미적중 = 활성화 안 됨). */
function mockJourney(over: Record<string, unknown>) {
  q.mockImplementation(async (sql: string) => {
    if (/FROM journeys j/.test(sql) && /json_agg/.test(sql)) {
      return {
        rows: [{
          callback_number: '0212345678',
          status: 'draft',
          start_kind: 'event',
          anchor_date: null,
          trigger_event: 'customer.dormant',
          threshold_recipients_per_step: 500,
          steps: [OK_STEP],
          ...over,
        }],
      };
    }
    if (/UPDATE journeys SET/.test(sql)) return { rows: [{ id: JOURNEY }] };
    return { rows: [], rowCount: 0 };
  });
}

const activate = () => activateJourney(COMPANY, JOURNEY, USER);
const didActivate = () => q.mock.calls.some(([sql]) => typeof sql === 'string' && /UPDATE journeys SET/.test(sql) && /status = 'active'/.test(sql));

describe('데이터로 만들 수 없는 여정은 활성화되지 않는다', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('최근 구매일이 없으면 휴면 여정을 켜지 못한다', async () => {
    mockJourney({ trigger_event: 'customer.dormant' });
    facts.mockResolvedValue(NO_FACTS);

    const r = await activate();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('최근 구매일');
    expect(didActivate()).toBe(false);
  });

  it('구매이력이 없으면 신규가입 여정을 켜지 못한다', async () => {
    mockJourney({ trigger_event: 'customer.created' });
    facts.mockResolvedValue(NO_FACTS);

    const r = await activate();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('구분할 정보가 없어요');
    expect(didActivate()).toBe(false);
  });

  it('예약은 데이터가 전부 있어도 막힌다 — 예약을 받는 연동 자체가 없다', async () => {
    mockJourney({ trigger_event: 'cdp.reservation_created', threshold_recipients_per_step: 100 });
    facts.mockResolvedValue(ALL_FACTS);

    const r = await activate();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('예약');
    expect(didActivate()).toBe(false);
  });

  it('가능 여부를 확인하지 못하면 활성화가 실패한다 — 발송 개시라 fail-closed', async () => {
    mockJourney({ trigger_event: 'customer.dormant' });
    facts.mockRejectedValue(new Error('조회 실패'));

    await expect(activate()).rejects.toThrow();
    expect(didActivate()).toBe(false);
  });
});

describe('상태형 여정은 수신자 상한 없이 켜지지 않는다', () => {
  beforeEach(() => { vi.clearAllMocks(); facts.mockResolvedValue(ALL_FACTS); });

  it('상한이 비어 있으면 거부한다 — 유예는 이관 폭발을 미룰 뿐 막지 못한다', async () => {
    mockJourney({ trigger_event: 'customer.dormant', threshold_recipients_per_step: null });

    const r = await activate();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('최대 인원');
    expect(didActivate()).toBe(false);
  });

  it('상시 세그먼트도 상한이 필요하다', async () => {
    mockJourney({ trigger_event: 'custom', start_kind: 'standing', threshold_recipients_per_step: null });

    const r = await activate();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('최대 인원');
  });

  // ★ 2026-08-01 5R 정정 — 생일도 상한 대상이 됐다. 생년월일 대량 적재가 그날 코호트를 한꺼번에 만든다.
  it('생일도 상한이 필요하다', async () => {
    mockJourney({ trigger_event: 'customer.birthday_approaching', threshold_recipients_per_step: null });

    const r = await activate();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('최대 인원');
  });

  it('커서 트리거도 상한이 필요하다 — §11-5(§9-C6 종결)', async () => {
    // 옛 면제 근거("대량 적재가 과거 이벤트를 만들지 않는다")는 §11-4 원장 문이 깼다 —
    // 첫 full sync가 발생 시각 창(3일) 안 구매를 한꺼번에 만든다. 전면 필수가 정답.
    mockJourney({ trigger_event: 'cdp.purchase', threshold_recipients_per_step: null });

    const r = await activate();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('최대 인원');
  });
});

describe('조건을 갖추면 통과한다', () => {
  beforeEach(() => { vi.clearAllMocks(); facts.mockResolvedValue(ALL_FACTS); });

  it('데이터가 있고 상한이 있으면 켜진다', async () => {
    mockJourney({ trigger_event: 'customer.dormant', threshold_recipients_per_step: 500 });

    const r = await activate();
    expect(r.ok).toBe(true);
    expect(didActivate()).toBe(true);
  });
});

// ★ 2026-08-01 Codex 5R — 매핑 누락이 게이트를 우회하던 구멍. 저장되는 값 전부를 표로 고정한다.
describe('저장되는 trigger_event 전수 — 데이터가 다 있고 상한도 있을 때', () => {
  beforeEach(() => { vi.clearAllMocks(); facts.mockResolvedValue(ALL_FACTS); });

  const CASES: Array<[string, boolean]> = [
    ['cdp.purchase', true],
    ['purchase.first', true],                     // ★ §11-5 신설(#2)
    ['customer.dormant_return', true],            // ★ §11-5 신설(#5)
    ['customer.cycle_lapsed', true],              // ★ §11-5 신설(#6)
    ['cdp.browse_no_purchase', true],             // ★ §11-5 신설(#12)
    ['cdp.cart_abandon', true],
    ['custom_order_shipped', true],
    ['customer.created', true],
    ['customer.dormant', true],
    ['customer.birthday_approaching', true],
    ['customer.points_expiring', true],
    ['custom', true],
    ['cdp.reservation_created', false],          // 예약을 받는 연동 자체가 없다
    ['purchase.made_up', false],                  // 모르는 값 = 조용한 0건 → fail-closed
    ['customer.grade_changed', true],             // ★ §11-5 신설(#7)
    ['customer.made_up_thing', false],
    ['', false],                                  // 빈 값도 막힌다
  ];

  it.each(CASES)('%s → 활성화 %s', async (event, expected) => {
    // ★ §11-5(§9-N1·N6): 장바구니는 쿨다운, 포인트는 양수 임계가 활성화 요건이 됐다 — 요건 충족값으로 mock.
    mockJourney({
      trigger_event: event,
      threshold_recipients_per_step: 500,
      allow_reentry: event === 'cdp.cart_abandon' ? true : false,
      reentry_cooldown_days: event === 'cdp.cart_abandon' ? 7 : 0,
      trigger_filters: event === 'customer.points_expiring' ? { points_min: 1000 } : {},
    });
    const r = await activate();
    expect(r.ok).toBe(expected);
    expect(didActivate()).toBe(expected);
  });

  // ★ §11-5(§9-N1) — 장바구니 쿨다운 0은 24시간 창 동안 5분마다 재발송·재차감이던 결함의 뿌리.
  it('장바구니 재진입 쿨다운 0 → 활성화 거부', async () => {
    mockJourney({
      trigger_event: 'cdp.cart_abandon', threshold_recipients_per_step: 500,
      allow_reentry: true, reentry_cooldown_days: 0, trigger_filters: {},
    });
    const r = await activate();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('최소 1일');
  });

  // ★ §11-5(§9-N6) — points_min 0은 사실상 전원이다.
  it('포인트 임계 0 → 활성화 거부', async () => {
    mockJourney({
      trigger_event: 'customer.points_expiring', threshold_recipients_per_step: 500,
      allow_reentry: false, reentry_cooldown_days: 0, trigger_filters: { points_min: 0 },
    });
    const r = await activate();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('1 이상');
  });

  it('모르는 값은 사유를 남긴다 — 왜 못 켜는지 사용자가 알아야 한다', async () => {
    mockJourney({ trigger_event: 'customer.made_up_thing', threshold_recipients_per_step: 500 });
    const r = await activate();
    expect(r.reason).toContain('지원하지 않는 발송 조건');
  });
});
