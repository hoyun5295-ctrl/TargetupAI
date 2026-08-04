// operator-audience — 대상 조건 컴파일 단일 문 (2026-08-03 타겟팅 재설계 1R 정정 회귀)
//  Codex 적대검증이 짚은 두 구멍을 행동으로 고정한다.
//   ① 알 수 없는 축이 legacy로 강등돼 빈 WHERE(= 전체 고객)로 열리던 것
//   ② 잠긴 축이 조용히 0건이 아니라 사유와 함께 멈추는 것
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn(), pool: {} }));

import { query } from '../config/database';
import { compileOperatorAudience, resolveOperatorStoreScope } from './operator-audience';

const q = query as unknown as ReturnType<typeof vi.fn>;
const COMPANY = '11111111-1111-1111-1111-111111111111';

/** facts 조회(customers 채움 카운트) + 등급 서열 판정 순서로 응답을 채운다. */
const mockFacts = (opts: {
  recentPurchase?: number; birthday?: number; gradeValues?: number; rankCount?: number;
  purchaseCount?: number; purchaseAmount?: number;
  /** 회차 스냅샷 표가 운영에 있는가(2026-08-04 변화 축). 미지정 = 있음. */
  snapshotTable?: boolean;
}) => {
  q.mockReset();
  q.mockImplementation(async (sql: string) => {
    if (/COUNT\(\*\) FILTER \(WHERE recent_purchase_date/.test(sql)) {
      return {
        rows: [{
          recent_purchase: opts.recentPurchase ?? 0,
          birthday: opts.birthday ?? 0,
          grade_values: opts.gradeValues ?? 0,
          purchase_count_filled: opts.purchaseCount ?? 0,
          purchase_amount_filled: opts.purchaseAmount ?? 0,
        }],
        rowCount: 1,
      };
    }
    if (/COUNT\(DISTINCT r\.rank_order\)/.test(sql)) {
      return { rows: [{ n: opts.rankCount ?? 0 }], rowCount: 1 };
    }
    if (/FROM customer_grade_ranks r/.test(sql)) {
      return { rows: [{ grade_value: 'VVIP', rank_order: 3 }, { grade_value: '골드', rank_order: 2 }], rowCount: 2 };
    }
    if (/information_schema\.tables/.test(sql)) {
      return opts.snapshotTable === false ? { rows: [], rowCount: 0 } : { rows: [{ '?column?': 1 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
};

beforeEach(() => { q.mockReset(); q.mockResolvedValue({ rows: [], rowCount: 0 }); });

describe('알 수 없는 축 — fail-closed', () => {
  it('값이 있는데 등록되지 않은 축이면 멈춘다 (legacy 빈 WHERE로 강등 금지)', async () => {
    await expect(compileOperatorAudience({ companyId: COMPANY, segmentKey: 'ltv_top_10', legacyFilters: {} }))
      .rejects.toThrow(/알 수 없는 발송 대상 축/);
    expect(q).not.toHaveBeenCalled();
  });

  // ⛔ 2026-08-04 표본 정정 — 미등록 축 표본은 **영원히 축이 될 수 없는 값**이어야 한다.
  //   종전 표본 'cart_abandoned'는 언제든 실제 축이 될 수 있는 이름이라, 그날 이 단정은
  //   "잠긴 축" 사유로도 통과해 **초록인 채 fail-closed 불변식만 사라진다**(메시지를 안 보는
  //   toThrow()라 더 조용하다). 예측 기반 축은 feedback_prediction_never_selects_target으로
  //   영구 금지라 표본으로 안전하다. 메시지까지 고정해 "무엇 때문에 멈췄는지"를 함께 단정한다.
  it('버전 스큐로 온 축도 전체 고객으로 열리지 않는다', async () => {
    await expect(compileOperatorAudience({ companyId: COMPANY, segmentKey: 'ltv_top_10' }))
      .rejects.toThrow(/알 수 없는 발송 대상 축/);
  });

  it('공백만 있는 값은 미지정으로 본다 (옛 행 호환)', async () => {
    const r = await compileOperatorAudience({ companyId: COMPANY, segmentKey: '   ', legacyFilters: { grade: 'VIP' } });
    expect(r.basis).toBe('legacy_filters');
    expect(r.segmentKey).toBeNull();
    expect(r.filterWhere).toContain('grade');
  });

  it('축 미지정 = 옛 방식 그대로 (마이그레이션 없음)', async () => {
    const r = await compileOperatorAudience({ companyId: COMPANY, segmentKey: null, legacyFilters: { grade: 'VIP' } });
    expect(r.basis).toBe('legacy_filters');
    expect(r.filterParams).toEqual(['VIP']);
  });
});

describe('잠긴 축 — 사유와 함께 멈춘다', () => {
  it('최근 구매일 데이터가 없으면 휴면 축은 컴파일하지 않는다', async () => {
    mockFacts({ recentPurchase: 0, birthday: 5, gradeValues: 5, rankCount: 2 });
    await expect(compileOperatorAudience({ companyId: COMPANY, segmentKey: 'dormant' }))
      .rejects.toThrow(/마지막 구매일/);
  });

  it('등급 순서를 안 정했으면 상위 등급 축은 컴파일하지 않는다', async () => {
    mockFacts({ recentPurchase: 5, birthday: 5, gradeValues: 5, rankCount: 1 });
    await expect(compileOperatorAudience({ companyId: COMPANY, segmentKey: 'vip' }))
      .rejects.toThrow(/등급 순서/);
  });
});

describe('저장된 미지의 축 — 매핑에서 깎이지 않고 컴파일에서 멈춘다 (2R 정정)', () => {
  it('DB에 남은 알 수 없는 축은 legacy로 강등되지 않는다', async () => {
    // mapRowToOperator가 원문을 보존하므로 컴파일이 이 값을 그대로 받는다.
    // 표본은 위와 같은 이유로 영구 금지 축(예측 기반)을 쓴다.
    await expect(compileOperatorAudience({ companyId: COMPANY, segmentKey: 'predicted_churn_risk', legacyFilters: {} }))
      .rejects.toThrow(/알 수 없는 발송 대상 축/);
  });
});

describe('매장 발송 범위 — DB 원시 역할값으로 판정한다 (6R)', () => {
  /** users.user_type 실측값 = admin / user / system. JWT의 company_user는 DB에 없다. */
  const mockScope = (opts: {
    role?: string | null; rowMissing?: boolean;
    storeCodes?: string[] | null; assignedMatches?: boolean; companyHasStores?: boolean;
  }) => {
    q.mockReset();
    q.mockImplementation(async (sql: string) => {
      if (/SELECT user_type FROM users/.test(sql)) {
        // 자격 조건(is_active AND status='active')은 SQL이 거른다 — 여기서는 "행이 없다"로 표현한다.
        expect(sql).toContain("status = 'active'");
        expect(sql).toContain('is_active = true');
        return opts.rowMissing ? { rows: [], rowCount: 0 } : { rows: [{ user_type: opts.role }], rowCount: 1 };
      }
      if (/SELECT store_codes FROM users/.test(sql)) return { rows: [{ store_codes: opts.storeCodes ?? null }], rowCount: 1 };
      if (/has_match/.test(sql)) return { rows: [{ has_match: opts.assignedMatches === true }], rowCount: 1 };
      if (/has_stores/.test(sql)) return { rows: [{ has_stores: opts.companyHasStores === true }], rowCount: 1 };
      if (/AS e\b/.test(sql)) return { rows: [{ e: opts.companyHasStores === true }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
  };
  const USER = '33333333-3333-3333-3333-333333333333';

  it("admin·system은 회사 전체", async () => {
    for (const role of ['admin', 'system']) {
      mockScope({ role });
      const r = await resolveOperatorStoreScope(COMPANY, USER);
      expect(r).toEqual({ storeFilter: '', baseParams: [COMPANY], blocked: false });
    }
  });

  it("★ 일반 사용자('user')는 제한 대상 — 토큰 어휘(company_user)로 판정하면 여기서 전사로 승격됐다", async () => {
    mockScope({ role: 'user', storeCodes: ['A'], assignedMatches: true });
    const r = await resolveOperatorStoreScope(COMPANY, USER);
    expect(r.blocked).toBe(false);
    expect(r.storeFilter).toContain('store_code = ANY($2::text[])');
    expect(r.baseParams).toEqual([COMPANY, ['A']]);
  });

  it('매장 미배정 + 회사에 매장 체계 있음 → 보류(전사 발송 금지)', async () => {
    mockScope({ role: 'user', storeCodes: null, companyHasStores: true });
    expect((await resolveOperatorStoreScope(COMPANY, USER)).blocked).toBe(true);
  });

  it('배정 코드가 하나도 안 맞아도 전사로 넓히지 않는다 (읽기 화면의 no_filter 폴백과 다른 판단)', async () => {
    mockScope({ role: 'user', storeCodes: ['OLD'], assignedMatches: false, companyHasStores: true });
    expect((await resolveOperatorStoreScope(COMPANY, USER)).blocked).toBe(true);
  });

  it('매장 체계 자체가 없는 회사는 나눌 범위가 없다 → 전체', async () => {
    mockScope({ role: 'user', storeCodes: ['GHOST'], assignedMatches: false, companyHasStores: false });
    const r = await resolveOperatorStoreScope(COMPANY, USER);
    expect(r.blocked).toBe(false);
    expect(r.storeFilter).toBe('');
  });

  it('소유자 없음·삭제됨·타사 계정 → 보류(권한 확대 금지)', async () => {
    mockScope({ role: 'admin' });
    expect((await resolveOperatorStoreScope(COMPANY, null)).blocked).toBe(true);
    mockScope({ rowMissing: true });
    expect((await resolveOperatorStoreScope(COMPANY, USER)).blocked).toBe(true);
  });

  it('모르는 역할값은 승격하지 않는다', async () => {
    mockScope({ role: 'manager', storeCodes: null, companyHasStores: true });
    expect((await resolveOperatorStoreScope(COMPANY, USER)).blocked).toBe(true);
  });
});

describe('열린 축 — 계약이 SQL을 만든다', () => {
  it('휴면 축은 구매 기록 없는 고객을 포함하지 않는다', async () => {
    mockFacts({ recentPurchase: 5, birthday: 5, gradeValues: 5, rankCount: 2 });
    const r = await compileOperatorAudience({ companyId: COMPANY, segmentKey: 'dormant', segmentParams: { days: 60 } });
    expect(r.basis).toBe('segment');
    expect(r.segmentKey).toBe('dormant');
    expect(r.filterWhere).toContain('c.recent_purchase_date IS NOT NULL');
    expect(r.filterParams).toHaveLength(1);
  });

  it('상위 등급 축은 지금 고객에게 있는 등급 중 최상위 급만 쓴다', async () => {
    mockFacts({ recentPurchase: 5, birthday: 5, gradeValues: 5, rankCount: 2 });
    const r = await compileOperatorAudience({ companyId: COMPANY, segmentKey: 'vip' });
    expect(r.filterWhere).toContain('c.grade = ANY');
    expect(r.filterParams[0]).toEqual(['VVIP']);   // rank_order 3 = 최상위 급만
  });

  it('계약이 정해지면 옛 filters는 조건에 섞이지 않는다', async () => {
    mockFacts({ recentPurchase: 5, birthday: 5, gradeValues: 5, rankCount: 2 });
    const r = await compileOperatorAudience({
      companyId: COMPANY, segmentKey: 'recent_buyers', legacyFilters: { region: '서울' },
    });
    expect(r.filterWhere).not.toContain('region');
  });
});

// ════════════════════════════════════════════════════════════════════
// 변화 축 (2026-08-04) — 자동마케팅만 가진 어휘. 여정은 사람마다 시계가 따로 돌아 구간을 못 자른다.
//   ⛔ 이 describe는 **아래 두 describe보다 먼저** 온다. isCycleSnapshotReady가 "준비됨"만 캐시하므로
//     표 있음을 먼저 단정하면 표 없음 케이스가 캐시에 가려 초록으로 통과한다(조용히 의미만 사라진다).
// ════════════════════════════════════════════════════════════════════
const OPERATOR = '44444444-4444-4444-4444-444444444444';

describe('변화 축 — 회차 스냅샷 표가 없으면 조건을 만들지 않는다', () => {
  it('표 미생성이면 42P01을 화면에 흘리지 않고 마이그레이션 코드로 멈춘다', async () => {
    mockFacts({ recentPurchase: 5, gradeValues: 5, rankCount: 2, snapshotTable: false });
    await expect(compileOperatorAudience({
      companyId: COMPANY, segmentKey: 'grade_up', operatorId: OPERATOR,
    })).rejects.toMatchObject({ code: 'DB_MIGRATION_PENDING' });
  });
});

describe('변화 축 — 비교할 지난 회차가 없으면 사유와 함께 멈춘다', () => {
  it('신규 등록(오퍼레이터 없음)에서는 조건을 만들지 않는다', async () => {
    mockFacts({ recentPurchase: 5, gradeValues: 5, rankCount: 2 });
    await expect(compileOperatorAudience({ companyId: COMPANY, segmentKey: 'grade_up' }))
      .rejects.toThrow(/첫 회차에 기준을 잡고/);
  });

  it('빈 문자열 오퍼레이터도 "없음"으로 본다 (공백이 조건을 열지 않는다)', async () => {
    mockFacts({ recentPurchase: 5, purchaseCount: 5 });
    await expect(compileOperatorAudience({ companyId: COMPANY, segmentKey: 'first_purchase', operatorId: '  ' }))
      .rejects.toThrow(/첫 회차에 기준을 잡고/);
  });

  it('근거가 없으면 오퍼레이터가 있어도 잠긴다 (등급 순서 미확인)', async () => {
    mockFacts({ recentPurchase: 5, gradeValues: 5, rankCount: 1 });
    await expect(compileOperatorAudience({ companyId: COMPANY, segmentKey: 'grade_up', operatorId: OPERATOR }))
      .rejects.toThrow(/등급 순서/);
  });
});

describe('변화 축 — 열리면 지난 회차와 비교하는 조건을 만든다', () => {
  it('등급 상승은 양쪽 등급이 모두 순서표에 있고 순위가 올라간 경우만', async () => {
    mockFacts({ recentPurchase: 5, gradeValues: 5, rankCount: 2 });
    const r = await compileOperatorAudience({ companyId: COMPANY, segmentKey: 'grade_up', operatorId: OPERATOR });
    expect(r.basis).toBe('segment');
    expect(r.filterWhere).toContain('operator_cycle_snapshots');
    // 짝은 고객 행 id — 전화번호로 이으면 매장별 다른 행의 과거와 비교된다.
    expect(r.filterWhere).toContain('s.customer_id = c.id');
    expect(r.filterWhere).toContain('rn.rank_order > ro.rank_order');
    expect(r.filterParams).toEqual([OPERATOR]);
  });

  it('첫 구매 전환은 지난 회차 0회 → 지금 1회 이상만', async () => {
    mockFacts({ purchaseCount: 5 });
    const r = await compileOperatorAudience({ companyId: COMPANY, segmentKey: 'first_purchase', operatorId: OPERATOR });
    expect(r.filterWhere).toContain('COALESCE(s.purchase_count, 0) = 0');
    expect(r.filterWhere).toContain('COALESCE(c.purchase_count, 0) >= 1');
  });

  it('발길 끊김은 "그 사이 구매 없음"까지 함께 건다 — 휴면(계속 안 산 사람)과 다르다', async () => {
    mockFacts({ recentPurchase: 5 });
    const r = await compileOperatorAudience({
      companyId: COMPANY, segmentKey: 'went_quiet', segmentParams: { days: 45 }, operatorId: OPERATOR,
    });
    expect(r.filterWhere).toContain('IS NOT DISTINCT FROM s.recent_purchase_date');
    expect(r.filterWhere).toContain('COALESCE(c.purchase_count, 0) = COALESCE(s.purchase_count, 0)');
    // 기준 날짜는 **스냅샷을 찍은 날**에서 뺀다 — 오늘에서 빼면 회차 간격만큼 창이 밀린다.
    expect(r.filterWhere).toContain("(s.observed_at AT TIME ZONE 'Asia/Seoul')::date");
    expect(r.filterParams[0]).toBe(OPERATOR);
    expect(r.filterParams[1]).toBe(45);
  });

  it('구매 증가는 지난 회차 대비 증가분으로 판단한다 (누적 총액 비교 아님)', async () => {
    mockFacts({ purchaseAmount: 5 });
    const r = await compileOperatorAudience({
      companyId: COMPANY, segmentKey: 'spent_more', segmentParams: { amount: 300000 }, operatorId: OPERATOR,
    });
    expect(r.filterWhere).toContain('COALESCE(c.total_purchase_amount, 0) - COALESCE(s.total_purchase_amount, 0)');
    expect(r.filterParams[1]).toBe(300000);
  });

  it('구매 금액 정보가 없으면 구매 증가 축은 잠긴다', async () => {
    mockFacts({ purchaseAmount: 0 });
    await expect(compileOperatorAudience({ companyId: COMPANY, segmentKey: 'spent_more', operatorId: OPERATOR }))
      .rejects.toThrow(/구매 금액 정보/);
  });
});
