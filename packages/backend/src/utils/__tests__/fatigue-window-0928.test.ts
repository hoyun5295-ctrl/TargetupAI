/**
 * 피로도 판정 창 = 실제로 나가는 날 기준 (★2026-09-28 한줄로 V2 m076 후속 · 적대 검토 지적)
 *
 * m076 이 기록을 「적재한 날」에서 「실제로 나가는 날」로 바꿨는데 판정은 여전히 「오늘부터 과거 N일, 위쪽 끝 없음」이었다.
 * 그래서 다음 주 예약 광고가 오늘부터 다음 주 + N일까지 계속 다른 광고를 막았다(예전보다 더 길게 과차단).
 *
 * 못 박는 것
 *   1. 판정 창 = [나가는 첫날 − (N−1), 나가는 마지막 날]. 지정이 없으면 오늘 하루(즉시 발송).
 *   2. 창 밖(미래) 예약분은 세지 않는다. 형식이 틀린 날짜는 오늘로 본다.
 *   3. 자동마케팅 추출 SQL 절도 위쪽 끝(오늘)을 갖는다.
 *   4. AI 발송·직접발송은 나가는 날(예약·분할)을 창으로 넘긴다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn() }));
import { query } from '../../config/database';
import { getFatigueBlockedSet, isFatigueBlocked } from '../fatigue-guard';
import { buildFatigueGuardClause } from '../fatigue-guard-core';

const q = query as unknown as ReturnType<typeof vi.fn>;
const cap = { days: 7, max: 2 };

beforeEach(() => {
  q.mockReset();
  q.mockResolvedValue({ rows: [] });
});

describe('대량 판정(getFatigueBlockedSet) 창', () => {
  it('나가는 날 범위를 넘기면 [첫날 − (N−1), 마지막 날] 로 센다', async () => {
    await getFatigueBlockedSet('c-1', cap, ['010-1234-5678'], { from: '2026-10-01', to: '2026-10-03' });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toMatch(/day >= \(COALESCE\(\$5::date, \(NOW\(\) AT TIME ZONE 'Asia\/Seoul'\)::date\) - \(\$3::int - 1\)\)/);
    expect(sql).toMatch(/day <= COALESCE\(\$6::date, \(NOW\(\) AT TIME ZONE 'Asia\/Seoul'\)::date\)/);
    expect(params.slice(4)).toEqual(['2026-10-01', '2026-10-03']);
  });

  it('지정이 없거나 형식이 틀리면 오늘 하루로 본다', async () => {
    await getFatigueBlockedSet('c-1', cap, ['01012345678']);
    expect(q.mock.calls[0][1].slice(4)).toEqual([null, null]);
    await getFatigueBlockedSet('c-1', cap, ['01012345678'], { from: '10/01', to: '2026-13-99x' });
    expect(q.mock.calls[1][1].slice(4)).toEqual([null, null]);
  });
});

describe('단건 판정(isFatigueBlocked) 창', () => {
  it('위쪽 끝(오늘)이 있다 — 미래 예약분은 오늘 판정에서 세지 않는다', async () => {
    await isFatigueBlocked('c-1', cap, '01012345678');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toMatch(/day <= COALESCE\(\$6::date, \(NOW\(\) AT TIME ZONE 'Asia\/Seoul'\)::date\)/);
    expect(params.slice(4)).toEqual([null, null]);
  });
});

describe('자동마케팅 추출 절(buildFatigueGuardClause)', () => {
  it('위쪽 끝(오늘)을 갖는다', () => {
    const clause = buildFatigueGuardClause(['company'], cap, 'c');
    expect(clause).toContain("AND f.day <= (NOW() AT TIME ZONE 'Asia/Seoul')::date");
  });
});

describe('발송 경로가 나가는 날을 창으로 넘긴다', () => {
  const camp = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
  it('AI 발송 = 예약일(없으면 오늘) 하루', () => {
    expect(camp).toMatch(/getFatigueBlockedSet\(companyId, fatigueCap, filteredCustomers\.map\(\(c: any\) => c\.phone\), \{ from: aiSendDay, to: aiSendDay \}\)/);
  });
  it('직접발송 = 첫날 ~ 마지막 날(분할이면 마지막 차수의 날)', () => {
    expect(camp).toMatch(/getFatigueBlockedSet\(companyId, directFatigueCap, dbRows\.map\(\(r: any\) => String\(r\.phone \|\| ''\)\), directFatigueSpan\)/);
    expect(camp).toContain('splitSendTime(directSendBase, finalRecipients.length - 1, split)');
  });
  it('기준 시각은 한 번만 만들어 판정·분할 적재·기록이 같은 값을 쓴다(Codex 1R medium)', () => {
    expect(camp).toContain('const directSendBase = scheduled && scheduledAt ? new Date(scheduledAt) : new Date();');
    expect(camp).toContain('const splitBase = directSendBase;');
    expect(camp).not.toContain('const splitBase = scheduled && scheduledAt');
    expect(camp).not.toContain('directFatigueBase');
  });
});
