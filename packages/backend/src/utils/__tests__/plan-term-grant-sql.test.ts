/**
 * 무료 메시징 지급 SQL × 선불 이용 기간 제외 조건 (★2026-10-04 · Codex 2R·3R medium)
 *
 * 못 박는 것: 지급 INSERT 가 ①정산 실패 회사 목록 ②관리 회사 전부 제외 ③정산 기준일(DB 오늘과 대조)을
 * 실제 인자로 싣는다. 인자 없음 = 빈 목록 · false · null(기존 지급과 같은 결과).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const seen: Array<{ sql: string; params: any[] }> = [];
vi.mock('../../config/database', () => {
  const q = async (sql: string, params: any[] = []) => { seen.push({ sql, params }); return { rows: [], rowCount: 0 }; };
  return { default: { query: q, connect: async () => ({ query: q, release: () => {} }) }, pool: { query: q }, query: q };
});

import { grantFreeMessagingForCurrentMonth } from '../free-messaging';

beforeEach(() => { seen.length = 0; });

describe('지급 SQL 제외 조건', () => {
  it('인자를 그대로 싣는다', async () => {
    await grantFreeMessagingForCurrentMonth({ excludeCompanyIds: ['11111111-1111-1111-1111-111111111111'], planTermSettledOn: '2026-10-31' });
    const ins = seen.filter((x) => x.sql.includes('INSERT INTO free_messaging_grants'));
    expect(ins.length).toBeGreaterThan(0);
    for (const x of ins) {
      expect(x.params.slice(2)).toEqual([['11111111-1111-1111-1111-111111111111'], false, '2026-10-31']);
      expect(x.sql).toContain("$5::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date");
      expect(x.sql).toContain('NOT (c.id = ANY($3::uuid[]))');
    }
  });
  it('인자 없음 = 빈 목록 · false · null', async () => {
    await grantFreeMessagingForCurrentMonth();
    const ins = seen.filter((x) => x.sql.includes('INSERT INTO free_messaging_grants'));
    for (const x of ins) expect(x.params.slice(2)).toEqual([[], false, null]);
  });
  it('형식이 아닌 기준일은 싣지 않는다(null)', async () => {
    await grantFreeMessagingForCurrentMonth({ planTermSettledOn: '10/31' });
    const ins = seen.filter((x) => x.sql.includes('INSERT INTO free_messaging_grants'));
    for (const x of ins) expect(x.params[4]).toBeNull();
  });
});
