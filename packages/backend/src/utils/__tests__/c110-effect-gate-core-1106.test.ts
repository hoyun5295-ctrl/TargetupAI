// replaces: none
/**
 * C110 순수 CT 시험 — 효과 판정(effect-measure-core) · 광고 관문 규칙(ad-send-gate-core)
 * 설계서 docs/2026-11-06-c110-effect-proof-priority-design.md §2-3 ~ §2-5 · §3-2 · §8 단위 두 줄.
 */
import { describe, it, expect } from 'vitest';
import { liftVerdict, fisherTwoSided, zTwoSided, neededPerGroup, LIFT_VERDICT_LABEL } from '../effect-measure-core';
import {
  AD_BRANCHES, normalizePriorityOrder, higherBranches, branchOfDirect, normalizeHoldoutPct,
  campaignHoldoutDrawable, adGateNotice, emptyAdGateCounts, kstDaysInSpan, buildAdGateSettingsUpdate,
} from '../ad-send-gate-core';

describe('effect-measure-core 판정', () => {
  it('어느 쪽이든 30명 미만 = 아직 판단 이름', () => {
    const r = liftVerdict({ n: 1000, buyers: 100, revenue: 1e6 }, { n: 29, buyers: 1, revenue: 1000 });
    expect(r.verdict).toBe('insufficient');
    expect(r.sentence).toContain('아직 판단 이릅니다');
    expect(r.pValue).toBeNull();
  });

  it('30명 · 구매자 0 = 아직 판단 이름(계산 불가 문장)', () => {
    const r = liftVerdict({ n: 30, buyers: 0, revenue: 0 }, { n: 30, buyers: 0, revenue: 0 });
    expect(r.verdict).toBe('insufficient');
    expect(r.neededPerGroup).toBeNull();
    expect(r.sentence).toContain('구매가 더 쌓여야');
  });

  it('기대 빈도 5 미만 = 피셔(970명 중 3 · 30명 중 1 = p ≈ 0.115 → 뚜렷하지 않음 · Codex 설계 1R #7)', () => {
    const r = liftVerdict({ n: 970, buyers: 3, revenue: 30000 }, { n: 30, buyers: 1, revenue: 10000 });
    expect(r.test).toBe('fisher');
    expect(r.pValue!).toBeGreaterThan(0.11);
    expect(r.pValue!).toBeLessThan(0.12);
    expect(r.verdict).toBe('unclear');
    // 같은 표를 z 로 보면 0.01 근처(그래서 피셔가 필요)
    expect(zTwoSided(3, 970, 1, 30)).toBeLessThan(0.02);
  });

  it('큰 표본 · 뚜렷한 차이 = 효과 있음 · 늘어난 매출 = (1인 매출 차) × 받은 수', () => {
    const r = liftVerdict({ n: 2000, buyers: 200, revenue: 4_000_000 }, { n: 500, buyers: 25, revenue: 500_000 });
    expect(r.test).toBe('z');
    expect(r.verdict).toBe('positive');
    expect(r.incRevenue).toBe(Math.round((4_000_000 / 2000 - 500_000 / 500) * 2000));
    expect(Math.round(r.incBuyers)).toBe(100);
    expect(r.sentence).toContain('높았습니다');
    expect(r.sentence).toContain('2,000,000원');
  });

  it('낮으면 효과 낮음', () => {
    const r = liftVerdict({ n: 2000, buyers: 40, revenue: 0 }, { n: 500, buyers: 50, revenue: 0 });
    expect(r.verdict).toBe('negative');
    expect(r.sentence).toContain('낮았습니다');
  });

  it('p 0.05 경계 — 유의하지 않으면 뚜렷하지 않음', () => {
    const r = liftVerdict({ n: 400, buyers: 48, revenue: 0 }, { n: 400, buyers: 36, revenue: 0 });
    expect(r.test).toBe('z');
    expect(r.pValue!).toBeGreaterThan(0.05);
    expect(r.verdict).toBe('unclear');
  });

  it('관문 장애 기간(limited) = 유의해도 보류 문장', () => {
    const r = liftVerdict({ n: 2000, buyers: 200, revenue: 0 }, { n: 500, buyers: 25, revenue: 0 }, { limited: true });
    expect(r.verdict).toBe('unclear');
    expect(r.sentence).toContain('판단을 보류합니다');
  });

  it('피셔 = 대칭 표에서 1 · 극단 표에서 작다', () => {
    expect(fisherTwoSided(5, 10, 5, 10)).toBeCloseTo(1, 6);
    expect(fisherTwoSided(10, 10, 0, 10)).toBeLessThan(0.001);
  });

  it('필요 인원 = 차이 0 이면 null · 아니면 양수', () => {
    expect(neededPerGroup(0.1, 0.1)).toBeNull();
    expect(neededPerGroup(0.12, 0.1)).toBeGreaterThan(1000);
  });

  it('판정 띠 이름 네 개', () => {
    expect(Object.keys(LIFT_VERDICT_LABEL).sort()).toEqual(['insufficient', 'negative', 'positive', 'unclear']);
  });
});

describe('ad-send-gate-core 규칙', () => {
  it('순서 = 일곱 갈래가 정확히 한 번씩일 때만', () => {
    expect(normalizePriorityOrder([...AD_BRANCHES])).toEqual([...AD_BRANCHES]);
    expect(normalizePriorityOrder(['journey'])).toBeNull();
    expect(normalizePriorityOrder([...AD_BRANCHES.slice(0, 6), 'journey'])).toBeNull();
    expect(normalizePriorityOrder([...AD_BRANCHES.slice(0, 6), 'nope'])).toBeNull();
    expect(normalizePriorityOrder(null)).toBeNull();
  });

  it('더 높은 갈래 = 회사 순서의 앞 · 순서를 바꾸면 바뀐다', () => {
    expect(higherBranches([...AD_BRANCHES], 'journey')).toEqual([]);
    expect(higherBranches([...AD_BRANCHES], 'ai')).toEqual(['journey', 'planner', 'agency', 'automarketing']);
    const mine = ['direct', 'journey', 'planner', 'agency', 'automarketing', 'ai', 'dm'] as any;
    expect(higherBranches(mine, 'journey')).toEqual(['direct']);
  });

  it('직접 발송 배관 갈래 = operator 만 AI 캠페인', () => {
    expect(branchOfDirect('operator')).toBe('ai');
    expect(branchOfDirect('direct')).toBe('direct');
    expect(branchOfDirect(undefined)).toBe('direct');
  });

  it('비율 범위 밖 = 0(꺼짐)', () => {
    expect(normalizeHoldoutPct(5, 10)).toBe(5);
    expect(normalizeHoldoutPct(11, 10)).toBe(0);
    expect(normalizeHoldoutPct(30, 30)).toBe(30);
    expect(normalizeHoldoutPct(0, 30)).toBe(0);
    expect(normalizeHoldoutPct('x', 30)).toBe(0);
  });

  it('D11 — 적격 × 비율 ≥ 3000 일 때만 추첨', () => {
    expect(campaignHoldoutDrawable(200, 20)).toBe(true);
    expect(campaignHoldoutDrawable(149, 20)).toBe(false);
    expect(campaignHoldoutDrawable(10, 30)).toBe(false);
    expect(campaignHoldoutDrawable(1000, 0)).toBe(false);
  });

  it('안내 한 줄 · 0 이면 빈 문자열', () => {
    expect(adGateNotice(emptyAdGateCounts())).toBe('');
    expect(adGateNotice({ global_holdout: 1, campaign_holdout: 2, priority: 3 })).toBe('대조군 3명, 우선순위 3명을 뺐습니다.');   // ★ C113 D17 이음 = 쉼표
  });

  it('설정 저장 문장 = 자리표시자 $N · 보낸 칸만 · 순서 틀림 = throw(구현 1R #1)', () => {
    const all = buildAdGateSettingsUpdate('co', { global_holdout_pct: 5, campaign_holdout_pct: 10, send_priority_order: [...AD_BRANCHES] })!;
    expect(all.params).toEqual(['co', 5, 10, [...AD_BRANCHES]]);
    expect(all.sql).toContain('global_holdout_pct IS DISTINCT FROM $2::smallint THEN NOW()');
    expect(all.sql).toContain('global_holdout_pct = $2::smallint');
    expect(all.sql).toContain('campaign_holdout_pct = $3::smallint');
    expect(all.sql).toContain('send_priority_order = $4::text[]');
    expect(all.sql).toContain('WHERE c.id = $1');
    expect(all.sql).not.toContain(' AND ');   // 조건 없이 부르면 회사 id 하나(요금제 조건 = 관문 CT saveAdGateSettings 가 넘김)
    expect(buildAdGateSettingsUpdate('co', { campaign_holdout_pct: 5 }, 'PAID')!.sql).toMatch(/WHERE c\.id = \$1 AND PAID$/);
    expect((all.sql.match(/\$\d+/g) || []).every((m) => Number(m.slice(1)) <= all.params.length)).toBe(true);
    const one = buildAdGateSettingsUpdate('co', { campaign_holdout_pct: 99 })!;
    expect(one.params).toEqual(['co', null]);
    expect(one.sql).toContain('campaign_holdout_pct = $2::smallint');
    expect(buildAdGateSettingsUpdate('co', { send_priority_order: null })!.params).toEqual(['co', null]);
    expect(() => buildAdGateSettingsUpdate('co', { send_priority_order: ['journey'] })).toThrow();
    expect(buildAdGateSettingsUpdate('co', {})).toBeNull();
  });

  it('span 날짜 = 오름차순 전부', () => {
    expect(kstDaysInSpan('2026-11-06', '2026-11-08')).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
    expect(kstDaysInSpan('2026-11-06', '2026-11-06')).toEqual(['2026-11-06']);
  });
});
