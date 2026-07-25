import { describe, it, expect } from 'vitest';
import { expandMonthlyRange } from './stats-period';

describe('expandMonthlyRange — 월별 조회 기간 확장 (2026-07-25)', () => {
  it('daily는 받은 값을 그대로 돌려준다', () => {
    expect(expandMonthlyRange('daily', '2026-07-25', '2026-07-25')).toEqual({
      startDate: '2026-07-25', endDate: '2026-07-25',
    });
  });

  it('★ monthly는 그 달 전체로 넓힌다 — 엑셀 웹 행만 안 넓혀 하루치가 한 달로 라벨링되던 결함', () => {
    expect(expandMonthlyRange('monthly', '2026-07-25', '2026-07-25')).toEqual({
      startDate: '2026-07-01', endDate: '2026-07-31',
    });
  });

  it('30일 달 말일이 정확하다', () => {
    expect(expandMonthlyRange('monthly', '2026-06-15', '2026-06-15')).toEqual({
      startDate: '2026-06-01', endDate: '2026-06-30',
    });
  });

  it('2월 — 평년 28일', () => {
    expect(expandMonthlyRange('monthly', '2026-02-10', '2026-02-10')).toEqual({
      startDate: '2026-02-01', endDate: '2026-02-28',
    });
  });

  it('2월 — 윤년 29일', () => {
    expect(expandMonthlyRange('monthly', '2028-02-10', '2028-02-10')).toEqual({
      startDate: '2028-02-01', endDate: '2028-02-29',
    });
  });

  it('12월 — 해를 넘기지 않는다', () => {
    expect(expandMonthlyRange('monthly', '2026-12-05', '2026-12-05')).toEqual({
      startDate: '2026-12-01', endDate: '2026-12-31',
    });
  });

  it('여러 달에 걸친 기간 — 시작은 첫 달 1일, 끝은 끝 달 말일', () => {
    expect(expandMonthlyRange('monthly', '2026-03-20', '2026-05-02')).toEqual({
      startDate: '2026-03-01', endDate: '2026-05-31',
    });
  });

  it('값이 없으면 없는 채로 둔다 — 임의로 만들어내지 않는다', () => {
    expect(expandMonthlyRange('monthly', undefined, undefined)).toEqual({
      startDate: undefined, endDate: undefined,
    });
    expect(expandMonthlyRange('monthly', '2026-07-25', undefined)).toEqual({
      startDate: '2026-07-01', endDate: undefined,
    });
  });

  it('멱등 — 이미 넓힌 값을 다시 넣어도 같다', () => {
    const once = expandMonthlyRange('monthly', '2026-07-25', '2026-07-25');
    const twice = expandMonthlyRange('monthly', once.startDate, once.endDate);
    expect(twice).toEqual(once);
  });

  it('옛 인라인 구현(화면·에이전트)과 결과가 같다 — 통합해도 회귀 0', () => {
    // stats-aggregation.ts / pay-stats.ts에 각각 있던 옛 규칙을 그대로 재현해 대조한다.
    const legacy = (view: 'daily' | 'monthly', s?: string, e?: string) => {
      if (view !== 'monthly') return { startDate: s, endDate: e };
      let ls = s, le = e;
      if (ls) ls = ls.substring(0, 7) + '-01';
      if (le) { const d = new Date(le); d.setMonth(d.getMonth() + 1, 0); le = d.toISOString().split('T')[0]; }
      return { startDate: ls, endDate: le };
    };
    const cases: Array<[string, string]> = [
      ['2026-01-31', '2026-01-31'], ['2026-02-01', '2026-02-28'], ['2028-02-29', '2028-02-29'],
      ['2026-04-15', '2026-04-15'], ['2026-07-25', '2026-08-03'], ['2026-11-30', '2026-12-31'],
    ];
    for (const [s, e] of cases) {
      expect(expandMonthlyRange('monthly', s, e)).toEqual(legacy('monthly', s, e));
      expect(expandMonthlyRange('daily', s, e)).toEqual(legacy('daily', s, e));
    }
  });
});
