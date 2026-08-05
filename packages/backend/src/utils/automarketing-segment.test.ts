// automarketing-segment 순수 계약 테스트 (2026-08-03 타겟팅 재설계 A-6)
//  계약의 값어치는 "축이 정해지면 SQL이 정해진다"에 있다. 그 성질을 여기서 고정한다.
import { describe, it, expect } from 'vitest';
import {
  SEGMENT_KEYS, CompanySegmentFacts,
  resolveSegmentAvailability, normalizeSegmentKey, normalizeSegmentParams,
  buildSegmentPredicate, kstDateMinusDays, kstMonth,
} from './automarketing-segment';

const FULL: CompanySegmentFacts = {
  hasRecentPurchaseDate: true, hasBirthday: true, hasGradeValues: true, hasGradeOrder: true,
  hasPurchaseCount: true, hasPurchaseAmount: true,
};
const NONE: CompanySegmentFacts = {
  hasRecentPurchaseDate: false, hasBirthday: false, hasGradeValues: false, hasGradeOrder: false,
  hasPurchaseCount: false, hasPurchaseAmount: false,
};
/** 변화 축은 비교할 지난 회차가 있어야 컴파일된다 — 순수 테스트에서는 이 id 하나로 표현한다. */
const OPERATOR = '44444444-4444-4444-4444-444444444444';
const at = (iso: string) => new Date(iso);
const availabilityOf = (facts: CompanySegmentFacts, key: string) =>
  resolveSegmentAvailability(facts).find((a) => a.key === key)!;

describe('resolveSegmentAvailability — 근거가 있는 축만 열린다', () => {
  it('근거가 다 있으면 전 축이 열린다', () => {
    const all = resolveSegmentAvailability(FULL);
    expect(all.map((a) => a.key)).toEqual(SEGMENT_KEYS);
    expect(all.every((a) => a.available)).toBe(true);
  });

  it('변화 축만 지난 회차 비교를 요구한다 — 상태 축은 요구하지 않는다', () => {
    const byKey = Object.fromEntries(resolveSegmentAvailability(FULL).map((a) => [a.key, a.needsCycleBaseline]));
    // 자동마케팅 고유 어휘 = 회차와 회차 사이의 변화. 여정은 사람마다 시계가 따로 돌아 구간을 못 자른다.
    expect(byKey.grade_up).toBe(true);
    expect(byKey.first_purchase).toBe(true);
    expect(byKey.returned).toBe(true);
    expect(byKey.went_quiet).toBe(true);
    expect(byKey.spent_more).toBe(true);
    for (const k of ['all', 'dormant', 'recent_buyers', 'vip', 'birthday', 'new_customers']) {
      expect(byKey[k]).toBe(false);
    }
  });

  it('구매 횟수·금액 근거가 각각 자기 축만 잠근다', () => {
    const noCount = resolveSegmentAvailability({ ...FULL, hasPurchaseCount: false });
    expect(noCount.find((a) => a.key === 'first_purchase')!.available).toBe(false);
    expect(noCount.find((a) => a.key === 'spent_more')!.available).toBe(true);

    const noAmount = resolveSegmentAvailability({ ...FULL, hasPurchaseAmount: false });
    expect(noAmount.find((a) => a.key === 'spent_more')!.available).toBe(false);
    expect(noAmount.find((a) => a.key === 'first_purchase')!.available).toBe(true);
  });

  it('근거가 하나도 없으면 전체·신규만 열린다 (나머지는 잠긴다)', () => {
    const open = resolveSegmentAvailability(NONE).filter((a) => a.available).map((a) => a.key);
    expect(open).toEqual(['all', 'new_customers']);
  });

  it('최근 구매일이 없으면 휴면·최근구매가 함께 잠긴다', () => {
    const facts = { ...FULL, hasRecentPurchaseDate: false };
    expect(availabilityOf(facts, 'dormant').available).toBe(false);
    expect(availabilityOf(facts, 'recent_buyers').available).toBe(false);
    expect(availabilityOf(facts, 'dormant').reason).toContain('구매');
  });

  it('등급 값은 있는데 순서를 안 정했으면 사유가 "순서를 정하라"로 갈린다', () => {
    const noOrder = availabilityOf({ ...FULL, hasGradeOrder: false }, 'vip');
    expect(noOrder.available).toBe(false);
    expect(noOrder.reason).toContain('순서');

    const noGrade = availabilityOf({ ...FULL, hasGradeOrder: false, hasGradeValues: false }, 'vip');
    expect(noGrade.available).toBe(false);
    expect(noGrade.reason).not.toContain('순서');
  });

  it('사유는 고객 언어로만 쓴다 — 컬럼명·내부 용어가 새지 않는다', () => {
    const banned = ['recent_purchase_date', 'birth_date', 'customer_grade_ranks', 'grade_order', 'SQL', 'NULL', 'jsonb'];
    for (const facts of [FULL, NONE]) {
      for (const a of resolveSegmentAvailability(facts)) {
        for (const w of banned) expect(a.reason).not.toContain(w);
      }
    }
  });
});

describe('normalizeSegmentParams — 담당자 입력을 계약 범위로 자른다', () => {
  it('없으면 기본값(휴면 90일 · 최근구매 30일 · 신규 30일)', () => {
    expect(normalizeSegmentParams('dormant', undefined)).toEqual({ days: 90 });
    expect(normalizeSegmentParams('recent_buyers', {})).toEqual({ days: 30 });
    expect(normalizeSegmentParams('new_customers', null)).toEqual({ days: 30 });
  });

  it('범위를 벗어나면 자르고, 숫자가 아니면 기본값으로 되돌린다', () => {
    expect(normalizeSegmentParams('dormant', { days: 0 })).toEqual({ days: 1 });
    expect(normalizeSegmentParams('dormant', { days: 99999 })).toEqual({ days: 3650 });
    expect(normalizeSegmentParams('dormant', { days: '30일' })).toEqual({ days: 90 });
    expect(normalizeSegmentParams('dormant', { days: 45.9 })).toEqual({ days: 45 });
  });

  it('파라미터가 없는 축은 빈 객체 — 임의 키가 실려도 통과하지 않는다', () => {
    expect(normalizeSegmentParams('vip', { days: 10, evil: 1 })).toEqual({});
    expect(normalizeSegmentParams('all', { days: 10 })).toEqual({});
  });
});

describe('buildSegmentPredicate — 축이 정해지면 SQL이 정해진다(결정성)', () => {
  const now = at('2026-08-03T05:00:00Z');   // KST 2026-08-03 14:00

  it('전체 고객 = 조건 없음 (추가 세분화 금지)', () => {
    const params: any[] = ['CID'];
    expect(buildSegmentPredicate('all', null, params, { now })).toBe('');
    expect(params).toEqual(['CID']);
  });

  it('휴면 = 마지막 구매일이 기준 이전 + 구매 기록 없는 고객은 제외', () => {
    const params: any[] = ['CID'];
    const sql = buildSegmentPredicate('dormant', { days: 90 }, params, { now });
    expect(sql).toContain('c.recent_purchase_date IS NOT NULL');
    expect(sql).toContain('c.recent_purchase_date <= $2');
    expect(params).toEqual(['CID', '2026-05-05']);
  });

  it('최근 구매 = 기준 이내', () => {
    const params: any[] = ['CID'];
    const sql = buildSegmentPredicate('recent_buyers', { days: 30 }, params, { now });
    expect(sql).toContain('c.recent_purchase_date >= $2');
    expect(params[1]).toBe('2026-07-04');
  });

  it('이번 달 생일 = 발송 월(KST) 일치', () => {
    const params: any[] = ['CID'];
    const sql = buildSegmentPredicate('birthday', null, params, { now });
    expect(sql).toContain('EXTRACT(MONTH FROM c.birth_date) = $2');
    expect(params[1]).toBe(8);
  });

  it('상위 등급 = 확인된 상위 등급 값 배열', () => {
    const params: any[] = ['CID'];
    const sql = buildSegmentPredicate('vip', null, params, { now, topGradeValues: ['VVIP', '다이아'] });
    expect(sql).toContain('c.grade = ANY($2::text[])');
    expect(params[1]).toEqual(['VVIP', '다이아']);
  });

  it('상위 등급 값이 없으면 조용한 0건 대신 멈춘다', () => {
    expect(() => buildSegmentPredicate('vip', null, ['CID'], { now, topGradeValues: [] })).toThrow();
    expect(() => buildSegmentPredicate('vip', null, ['CID'], { now })).toThrow();
  });

  it('신규 등록 = 등록 시각 기준 N일 이내', () => {
    const params: any[] = ['CID'];
    const sql = buildSegmentPredicate('new_customers', { days: 30 }, params, { now });
    expect(sql).toContain('c.created_at >= $2');
    expect(params[1]).toBe('2026-07-04T05:00:00.000Z');
  });

  it('같은 축·같은 파라미터·같은 시각이면 언제 만들어도 같은 SQL·같은 값', () => {
    const a: any[] = ['CID']; const b: any[] = ['CID'];
    const s1 = buildSegmentPredicate('dormant', { days: 60 }, a, { now });
    const s2 = buildSegmentPredicate('dormant', { days: 60 }, b, { now });
    expect(s1).toBe(s2);
    expect(a).toEqual(b);
  });

  it('알 수 없는 축은 만들지 않는다', () => {
    expect(() => buildSegmentPredicate('vvip_predicted' as any, null, ['CID'], { now })).toThrow();
  });

  it('파라미터 값은 항상 바인드로 나간다 — 문자열이 SQL에 박히지 않는다', () => {
    const params: any[] = ['CID'];
    const sql = buildSegmentPredicate('dormant', { days: "1; DROP TABLE customers" }, params, { now });
    expect(sql).not.toContain('DROP');
    expect(params[1]).toBe('2026-05-05');   // 숫자가 아니면 기본값 90일
  });
});

describe('KST 경계 — 우리 프로세스 시계가 아니라 KST 날짜로 자른다', () => {
  it('UTC 자정 직전(KST 다음 날 오전)은 KST 날짜를 쓴다', () => {
    expect(kstDateMinusDays(at('2026-08-03T15:30:00Z'), 0)).toBe('2026-08-04');
    expect(kstMonth(at('2026-12-31T15:30:00Z'))).toBe(1);
  });
  it('UTC 자정 직후(KST 같은 날 오전)', () => {
    expect(kstDateMinusDays(at('2026-08-03T00:30:00Z'), 0)).toBe('2026-08-03');
    expect(kstMonth(at('2026-08-03T00:30:00Z'))).toBe(8);
  });
});

describe('normalizeSegmentKey — 화이트리스트 밖은 계약이 아니다', () => {
  it('등록된 축만 통과', () => {
    for (const k of SEGMENT_KEYS) expect(normalizeSegmentKey(k)).toBe(k);
    // ⛔ 사건 반응(장바구니·상품 조회)은 여정이 소유한다 — 여기 들어오면 안 된다.
    for (const bad of ['', null, undefined, 'VIP', 'ltv_top', 1, {}, 'cart_abandoned', 'browsed_no_purchase']) {
      expect(normalizeSegmentKey(bad)).toBeNull();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// 변화 축 — 지난 회차와 지금을 비교한다 (2026-08-04)
// ════════════════════════════════════════════════════════════════════
describe('변화 축 — 비교 대상이 없으면 조건을 만들지 않는다', () => {
  const now = at('2026-08-03T05:00:00Z');

  it('지난 회차의 주인이 없으면 사유와 함께 멈춘다 (조용한 0건 금지)', () => {
    for (const key of ['grade_up', 'first_purchase', 'returned', 'went_quiet', 'spent_more']) {
      expect(() => buildSegmentPredicate(key as any, null, ['CID'], { now }))
        .toThrow(/첫 회차에 기준을 잡고/);
    }
  });

  it('짝은 고객 행 id로 맞춘다 — 전화번호로 이으면 남의 과거와 비교된다', () => {
    const params: any[] = ['CID'];
    const sql = buildSegmentPredicate('grade_up', null, params, { now, operatorId: OPERATOR });
    expect(sql).toContain('s.customer_id = c.id');
    expect(sql).not.toContain('s.phone = c.phone');
    expect(params).toEqual(['CID', OPERATOR]);
  });

  it('스냅샷에도 회사 결합을 건다 — 어긋난 쌍이 와도 남의 회사 과거와 비교되지 않는다', () => {
    for (const key of ['grade_up', 'first_purchase', 'returned', 'went_quiet', 'spent_more']) {
      const sql = buildSegmentPredicate(key as any, null, ['CID'], { now, operatorId: OPERATOR });
      expect(sql).toContain('s.company_id = c.company_id');
    }
  });

  it('★ 구매 파생 전환 3종은 "그 구매가 이 구간에서 일어났는가"를 함께 건다 — backfill 오인 차단', () => {
    // 과거 주문 뒤늦은 연결·옛 날짜 보정은 카운트·금액을 움직이지만 이 구간의 행동이 아니다.
    const guard = "c.recent_purchase_date >= ((s.observed_at AT TIME ZONE 'Asia/Seoul')::date)";
    for (const key of ['first_purchase', 'returned', 'spent_more']) {
      const sql = buildSegmentPredicate(key as any, null, ['CID'], { now, operatorId: OPERATOR });
      expect(sql).toContain(guard);
      expect(sql).toContain('c.recent_purchase_date IS NOT NULL');
    }
    // 등급 상승·발길 끊김은 구매 발생형이 아니라 이 가드를 걸지 않는다(끊김은 "구매 없음"이 조건).
    expect(buildSegmentPredicate('grade_up', null, ['CID'], { now, operatorId: OPERATOR })).not.toContain(guard);
    expect(buildSegmentPredicate('went_quiet', null, ['CID'], { now, operatorId: OPERATOR })).not.toContain(guard);
  });

  it('구매 증가 최소 금액은 0을 받지 않는다 — 0이면 변화 없는 전원이 대상이 된다', () => {
    expect(normalizeSegmentParams('spent_more', { amount: 0 })).toEqual({ amount: 1 });
    expect(normalizeSegmentParams('spent_more', { amount: -5000 })).toEqual({ amount: 1 });
    expect(normalizeSegmentParams('spent_more', null)).toEqual({ amount: 100000 });
  });

  it('등급 상승은 양쪽 순위가 모두 있고 실제로 올라간 경우만 — 같은 급은 상승이 아니다', () => {
    const sql = buildSegmentPredicate('grade_up', null, ['CID'], { now, operatorId: OPERATOR });
    expect(sql).toContain('ro.rank_order IS NOT NULL');
    expect(sql).toContain('rn.rank_order IS NOT NULL');
    expect(sql).toContain('rn.rank_order > ro.rank_order');
  });

  it('발길 끊김은 "그 사이 구매 없음"을 함께 건다 — 휴면과 다른 축이다', () => {
    const params: any[] = ['CID'];
    const sql = buildSegmentPredicate('went_quiet', { days: 45 }, params, { now, operatorId: OPERATOR });
    expect(sql).toContain('IS NOT DISTINCT FROM s.recent_purchase_date');
    expect(sql).toContain('COALESCE(c.purchase_count, 0) = COALESCE(s.purchase_count, 0)');
    // 기준선은 스냅샷을 찍은 날에서 뺀다(오늘에서 빼면 회차 간격만큼 창이 밀린다) + 오늘 기준 경과일.
    expect(params).toEqual(['CID', OPERATOR, 45, '2026-06-19']);
  });

  it('구매 증가는 증가분으로 본다 — 누적 총액 비교가 아니다', () => {
    const params: any[] = ['CID'];
    const sql = buildSegmentPredicate('spent_more', { amount: 300000 }, params, { now, operatorId: OPERATOR });
    expect(sql).toContain('COALESCE(c.total_purchase_amount, 0) - COALESCE(s.total_purchase_amount, 0)');
    expect(params[2]).toBe(300000);
  });

  it('파라미터는 계약 범위로 잘려 바인드로 나간다', () => {
    const params: any[] = ['CID'];
    buildSegmentPredicate('spent_more', { amount: 999999999999 }, params, { now, operatorId: OPERATOR });
    expect(params[2]).toBe(100000000);
    const p2: any[] = ['CID'];
    const sql = buildSegmentPredicate('returned', { days: "1; DROP TABLE customers" }, p2, { now, operatorId: OPERATOR });
    expect(sql).not.toContain('DROP');
    expect(p2[2]).toBe(90);   // 숫자가 아니면 기본값
  });

  it('같은 축·같은 파라미터·같은 회차면 언제 만들어도 같은 SQL·같은 값', () => {
    const a: any[] = ['CID']; const b: any[] = ['CID'];
    const s1 = buildSegmentPredicate('went_quiet', { days: 60 }, a, { now, operatorId: OPERATOR });
    const s2 = buildSegmentPredicate('went_quiet', { days: 60 }, b, { now, operatorId: OPERATOR });
    expect(s1).toBe(s2);
    expect(a).toEqual(b);
  });
});
