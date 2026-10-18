/**
 * ★ 2026-10-18 F0 — 플래너 대상은 「전체 고객」 축을 명시한다(설계서 docs/2026-10-18-planner-v2-design.md §3-0).
 *
 * 고정하는 것
 *   ① 축 없이 부르면 빈 조건 = AudienceEmptyError(1005 「빈 조건 = 전체 금지」) — 옛 호출이 막히던 이유
 *   ② 플래너 대상 함수는 segmentKey 'all' 로 컴파일을 부른다(확인 화면 수 · 승인 · 당일 발송이 같은 문)
 *   ③ 'all' 계약 = 추가 조건 없음(빈 술어)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({
  pool: { connect: vi.fn() },
  // 행사 meta(받는 사람 없음 = 전체 · ★ 1018 대상은 행사 행에서 읽는다)
  query: vi.fn(async (sql: string) => (/FROM planner_events/.test(sql) ? { rows: [{ meta: {} }] } : { rows: [] })),
}));

const compileSpy = vi.fn(async (_input: any) => ({ filterWhere: '', filterParams: [], segmentKey: 'all', basis: 'segment' }));
vi.mock('../operator-audience', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    compileOperatorAudience: (input: any) => compileSpy(input),
    resolveOperatorStoreScope: vi.fn(async () => ({ blocked: false, baseParams: ['co-1'], storeFilter: '' })),
    resolveOperatorAudienceGates: vi.fn(async () => ({})),
  };
});

import { resolvePlannerAudience } from '../planner-audience';
import { SEGMENT_CONTRACTS } from '../automarketing-segment';

describe('F0 플래너 대상 = 전체 고객 축 명시', () => {
  beforeEach(() => { compileSpy.mockClear(); });

  it('① 축 없이 컴파일하면 빈 조건 오류다(옛 호출이 막히던 자리)', async () => {
    const real: any = await vi.importActual('../operator-audience');
    await expect(real.compileOperatorAudience({ companyId: 'co-1', baseParams: ['co-1'] }))
      .rejects.toBeInstanceOf(real.AudienceEmptyError);
  });

  it('② 플래너 대상 함수는 segmentKey all 로 부른다(전체 · 참여자 둘 다)', async () => {
    const all = await resolvePlannerAudience({ companyId: 'co-1', createdBy: 'u-1', mode: 'all', plannerEventId: 'ev-1' });
    expect(all.blocked).toBe(false);
    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(compileSpy.mock.calls[0][0]).toMatchObject({ companyId: 'co-1', baseParams: ['co-1'], segmentKey: 'all' });

    await resolvePlannerAudience({ companyId: 'co-1', createdBy: 'u-1', mode: 'participants', plannerEventId: 'ev-1' });
    expect(compileSpy.mock.calls[1][0]).toMatchObject({ segmentKey: 'all' });
  });

  it('③ all 계약 = 추가 조건 없음', () => {
    const c = SEGMENT_CONTRACTS.find((x) => x.key === 'all');
    expect(c).toBeTruthy();
    expect(c!.build([], {} as any, { now: new Date() } as any)).toBe('');
  });
});
