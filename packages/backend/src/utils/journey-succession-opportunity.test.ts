/**
 * 이어달리기(다음 수 추천) — 기회 엔진의 succession 신호 (2026-08-08, 설계서 §5)
 *
 * 못 박는 것:
 *   1. 근거 없으면 안 뜬다 — 전환 관측(goal_met)이 0이면 추천하지 않는다(지어내지 않는다).
 *   2. dedup 축은 trigger_event다 — template_code로 되돌리면 repeat 3종이 서로를 오차단한다(설계서 사실 10).
 *   3. capability가 잠기면 안 뜬다 — 구매 데이터가 없는 회사에 구매 여정을 권하지 않는다(정답표 금지).
 *   4. 소급 금지 고지가 카드에 항상 실린다 — 빠지면 "켜 뒀는데 0건" 오해가 추천 경로로 재발한다.
 *   5. 화면에 내부 용어(trigger_event·goal_met)가 나가지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({
  query: vi.fn(),
  pool: { connect: vi.fn() },
}));
vi.mock('./company-data-profile', () => ({
  getCompanyJourneyFacts: vi.fn(),
}));

import { query } from '../config/database';
import { getCompanyJourneyFacts } from './company-data-profile';
import { buildJourneyOpportunities, successionObjectiveFor } from './journey-opportunities';
import { TRIGGER_CONTRACTS } from './journey-trigger-capability';

const q = query as unknown as ReturnType<typeof vi.fn>;
const facts = getCompanyJourneyFacts as unknown as ReturnType<typeof vi.fn>;
const COMPANY_ID = '11111111-1111-1111-1111-111111111111';

/** 구매 판정이 열린 회사(휴면·첫구매·재구매 전부 구매 데이터 하나로 열린다). */
const PURCHASE_READY = {
  canJudgeNewCustomer: true,
  hasRecentPurchaseDate: true,
  hasBirthday: false,
  hasPoints: false,
  hasGrade: false,
  hasGradeOrder: false,
  hasPurchaseEvents: true,
  hasCartEvents: false,
  hasBrowseEvents: false,
  hasShippedEvents: false,
};

/**
 * 기회 엔진이 던지는 질의를 내용으로 갈라 답한다(호출 순서에 기대지 않는다).
 *  - activeRows: 활성 여정 (template_code · trigger_event)
 *  - convRows: 전환 관측 (goal_met 집계)
 */
function mockEngine(opts: {
  activeRows?: Array<{ template_code: string; trigger_event: string }>;
  convRows?: Array<{ trigger_event: string; goal_met_count: number; value_at_stake: number }>;
}) {
  const activeRows = opts.activeRows || [];
  const convRows = opts.convRows || [];
  q.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes('DISTINCT template_code')) return { rows: activeRows };
    if (s.includes('PERCENTILE_CONT')) return { rows: [{ median_aov: 0, median_days: null, p75_days: null }] };
    if (s.includes('cart_cnt')) {
      // 기존 6신호는 전부 0 — 이 테스트는 이어달리기 축만 본다.
      return { rows: [{ cart_cnt: 0, cart_val: 0, onb_cnt: 0, dorm_cnt: 0, dorm_val: 0, bday_cnt: 0, repur_cnt: 0, repur_val: 0, wish_cnt: 0 }] };
    }
    if (s.includes("e.status = 'goal_met'")) return { rows: convRows };
    return { rows: [] };
  });
}

beforeEach(() => {
  q.mockReset();
  facts.mockReset();
  facts.mockResolvedValue(PURCHASE_READY);
});

const succession = (list: any[]) => list.filter((c) => c.type === 'succession');

describe('이어달리기 추천 — 근거가 있을 때만', () => {
  it('전환 관측이 없으면 추천하지 않는다 (근거 없는 추천을 지어내지 않는다)', async () => {
    mockEngine({ convRows: [] });
    expect(succession(await buildJourneyOpportunities(COMPANY_ID))).toHaveLength(0);
  });

  it('휴면 여정에서 복귀한 고객이 있으면 휴면 복귀 여정을 권한다', async () => {
    mockEngine({ convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 150000 }] });
    const cards = succession(await buildJourneyOpportunities(COMPANY_ID));
    expect(cards).toHaveLength(1);
    expect(cards[0].preferTriggerEvent).toBe('customer.dormant_return');
    expect(cards[0].count).toBe(3);
    expect(cards[0].valueAtStake).toBe(150000);
    expect(cards[0].templateCode).toBe('repeat');
  });

  it('신규가입 → 첫 구매 · 첫 구매 → 재구매 간선도 같은 규칙으로 뜬다', async () => {
    mockEngine({
      convRows: [
        { trigger_event: 'customer.created', goal_met_count: 5, value_at_stake: 0 },
        { trigger_event: 'purchase.first', goal_met_count: 2, value_at_stake: 0 },
      ],
    });
    const cards = succession(await buildJourneyOpportunities(COMPANY_ID));
    expect(cards.map((c) => c.preferTriggerEvent).sort()).toEqual(['cdp.purchase', 'purchase.first']);
  });

  it('전환 수가 0인 행은 카드가 되지 않는다', async () => {
    mockEngine({ convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 0, value_at_stake: 0 }] });
    expect(succession(await buildJourneyOpportunities(COMPANY_ID))).toHaveLength(0);
  });
});

describe('이미 있는 여정은 다시 권하지 않는다 — dedup 축은 trigger_event', () => {
  it('후속 트리거의 활성 여정이 있으면 미노출', async () => {
    mockEngine({
      activeRows: [{ template_code: 'repeat', trigger_event: 'customer.dormant_return' }],
      convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 0 }],
    });
    expect(succession(await buildJourneyOpportunities(COMPANY_ID))).toHaveLength(0);
  });

  it('같은 template_code(repeat)의 다른 트리거가 활성이어도 노출된다 (축을 template_code로 되돌리면 여기서 깨진다)', async () => {
    mockEngine({
      activeRows: [{ template_code: 'repeat', trigger_event: 'cdp.purchase' }],
      convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 0 }],
    });
    const cards = succession(await buildJourneyOpportunities(COMPANY_ID));
    expect(cards, 'repeat 3종이 서로를 오차단하면 이어달리기가 통째로 죽는다').toHaveLength(1);
    expect(cards[0].preferTriggerEvent).toBe('customer.dormant_return');
  });

  it('같은 후속을 두 곳이 가리켜도 카드는 하나다', async () => {
    mockEngine({
      convRows: [
        { trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 0 },
        { trigger_event: 'customer.dormant', goal_met_count: 9, value_at_stake: 0 },
      ],
    });
    const cards = succession(await buildJourneyOpportunities(COMPANY_ID));
    expect(cards).toHaveLength(1);
    expect(cards[0].count, '근거가 큰 쪽을 남긴다').toBe(9);
  });
});

describe('전환 관측 질의 — 무엇을 세고 무엇으로 격리하는가', () => {
  const goalMetSql = () => String((q.mock.calls.find((c: any[]) => String(c[0]).includes("e.status = 'goal_met'")) || [])[0] || '');

  it('사람 단위로 센다 — 실행 행으로 세면 재진입한 고객이 여러 명이 된다', async () => {
    mockEngine({ convRows: [] });
    await buildJourneyOpportunities(COMPANY_ID);
    const sql = goalMetSql();
    expect(sql, '같은 고객의 goal_met 실행이 둘이면 "2명이 복귀했어요"가 된다').toMatch(/SELECT DISTINCT[\s\S]*e\.customer_id/);
    expect(sql, '집계는 고객 단위 CTE 위에서 한다').toMatch(/FROM converted/);
  });

  it('회사 격리는 여정을 지난다 — journey_executions에는 company_id 컬럼이 없다', async () => {
    mockEngine({ convRows: [] });
    await buildJourneyOpportunities(COMPANY_ID);
    const sql = goalMetSql();
    expect(sql).toMatch(/JOIN journeys j ON j\.id = e\.journey_id AND j\.company_id = \$1::uuid/);
    expect(sql).toMatch(/c\.company_id = \$1::uuid/);
    expect(
      sql,
      'SCHEMA 실측 — journey_executions에 company_id는 없다. 넣으면 tsc는 통과하고 런타임에 질의가 깨진다',
    ).not.toMatch(/e\.company_id/);
  });
});

describe('간선과 문구는 함께 늘어난다', () => {
  it('모든 후속 트리거에 목표 골격이 있다 (없으면 추천이 조용히 안 뜨고 "이어서 만들기"도 못 만든다)', () => {
    const missing = TRIGGER_CONTRACTS.flatMap((c) => c.nextEvents || []).filter((e) => !successionObjectiveFor(e));
    expect(missing, `문구 없는 간선: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('capability — 정답표를 갖지 않는다', () => {
  it('구매 데이터가 없는 회사에는 구매 여정을 권하지 않는다', async () => {
    facts.mockResolvedValue({ ...PURCHASE_READY, hasPurchaseEvents: false });
    mockEngine({ convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 0 }] });
    expect(succession(await buildJourneyOpportunities(COMPANY_ID))).toHaveLength(0);
  });

  it('판정 조회가 실패하면 추천을 접는다 — 다른 카드는 그대로 나간다 (fail-closed)', async () => {
    facts.mockRejectedValue(new Error('boom'));
    mockEngine({ convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 0 }] });
    const all = await buildJourneyOpportunities(COMPANY_ID);
    expect(succession(all)).toHaveLength(0);
    expect(Array.isArray(all)).toBe(true);
  });
});

describe('카드 문구 — 완화 금지', () => {
  it('소급 금지 고지가 항상 실린다', async () => {
    mockEngine({ convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 0 }] });
    const [card] = succession(await buildJourneyOpportunities(COMPANY_ID));
    expect(card.notices?.[0], '이 문장이 빠지면 "켜 뒀는데 0건" 오해가 추천 경로로 재발한다').toContain('앞으로');
  });

  it('재구매 여정이 활성일 때 휴면 복귀를 권하면 겹침을 알린다', async () => {
    mockEngine({
      activeRows: [{ template_code: 'repeat', trigger_event: 'cdp.purchase' }],
      convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 0 }],
    });
    const [card] = succession(await buildJourneyOpportunities(COMPANY_ID));
    expect(card.notices?.join(' ')).toContain('둘 다 발송될 수 있어요');
  });

  it('겹치는 여정이 없으면 겹침 안내를 붙이지 않는다', async () => {
    mockEngine({ convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 0 }] });
    const [card] = succession(await buildJourneyOpportunities(COMPANY_ID));
    expect(card.notices).toHaveLength(1);
  });

  it('내부 용어를 화면에 내보내지 않는다', async () => {
    mockEngine({ convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 0 }] });
    const [card] = succession(await buildJourneyOpportunities(COMPANY_ID));
    const text = [card.title, card.description, card.suggestedObjective, ...(card.notices || [])].join(' ');
    for (const word of ['goal_met', 'trigger_event', 'template_code', 'journey_executions']) {
      expect(text, `고객 화면에 내부 용어가 나간다: ${word}`).not.toContain(word);
    }
  });

  it('AI 임의 혜택(%·원·쿠폰·무료)을 목표 골격에 넣지 않는다', async () => {
    mockEngine({ convRows: [{ trigger_event: 'customer.dormant', goal_met_count: 3, value_at_stake: 0 }] });
    const [card] = succession(await buildJourneyOpportunities(COMPANY_ID));
    expect(card.suggestedObjective).not.toMatch(/\d+\s*%|\d+\s*원|쿠폰|무료/);
  });
});
