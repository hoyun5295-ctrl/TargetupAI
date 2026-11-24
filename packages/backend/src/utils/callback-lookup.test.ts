/**
 * 발신번호 조회 CT — 특부가 갱신 1-1 ④ (★2026-11-23)
 *
 * 못 박는 것:
 *   1. 입력 번호는 숫자만 남겨 8 ~ 12자리일 때만 받는다(하이픈 · 공백 무관).
 *   2. 등록 정보 · 발송 이력 모두 저장된 번호의 숫자만 비교한다(저장 꼴이 달라도 같은 번호로 찾는다).
 *   3. 발송 이력은 작성 중(draft) 캠페인을 빼고, 최신 순 20건씩 쪽을 나눈다.
 *   4. 보낸 계정 = 캠페인의 계정 ID · 이용자명, 발송 방식 = 발송 축 CT 의 이름.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('./callback-filter', () => ({
  CALLBACK_ASSIGNEES_SQL: `'[]'::json AS assignees`,
  describeCallbackUsage: vi.fn(async (rows: any[]) => new Map(rows.map((r) => [r.id, { usage_scope: 'assigned', assignees: [{ loginId: 'kim01', name: '김담당' }] }]))),
}));

import { query } from '../config/database';
import { parseLookupPhone, parseLookupPage, lookupCallbackNumber, CALLBACK_LOOKUP_PAGE_SIZE } from './callback-lookup';

const q = query as unknown as ReturnType<typeof vi.fn>;

describe('입력 번호 · 쪽 번호', () => {
  it('하이픈 · 공백을 떼고 8 ~ 12자리만 받는다', () => {
    expect(parseLookupPhone('010-1234-5678')).toBe('01012345678');
    expect(parseLookupPhone(' 1588 0000 ')).toBe('15880000');
    expect(parseLookupPhone('0505-123-45678')).toBe('050512345678');
    expect(parseLookupPhone('1234567')).toBeNull();
    expect(parseLookupPhone('0101234567890')).toBeNull();
    expect(parseLookupPhone(undefined)).toBeNull();
    expect(parseLookupPhone('abc')).toBeNull();
  });
  it('쪽 번호는 1 이상 정수만 · 그 밖은 1', () => {
    expect(parseLookupPage('3')).toBe(3);
    expect(parseLookupPage('0')).toBe(1);
    expect(parseLookupPage('-2')).toBe(1);
    expect(parseLookupPage('1.5')).toBe(1);
    expect(parseLookupPage(undefined)).toBe(1);
  });
});

describe('조회', () => {
  beforeEach(() => {
    q.mockReset();
    q.mockResolvedValueOnce({ rows: [{ id: 'cn-1', company_id: 'co-1', phone: '010-1234-5678', label: '대표', assignment_scope: 'assigned', created_at: '2026-10-01T00:00:00Z', company_name: '가나상사', assignees: [] }] })
      .mockResolvedValueOnce({ rows: [{ n: 41 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ca-1', campaign_name: '11월 안내', send_type: 'direct', status: 'completed', sent_at: '2026-11-20T01:00:00Z', scheduled_at: null, created_at: '2026-11-20T00:59:00Z', target_count: 10, success_count: 9, fail_count: 1, company_name: '가나상사', login_id: 'kim01', user_name: '김담당' }] });
  });

  it('등록 정보와 발송 이력을 숫자만 비교해 찾는다', async () => {
    await lookupCallbackNumber('01012345678', 1);
    const [regSql, regArgs] = q.mock.calls[0];
    expect(regSql).toMatch(/regexp_replace\(COALESCE\(cn\.phone, ''\), '\\D', '', 'g'\) = \$1/);
    expect(regArgs).toEqual(['01012345678']);
    const [cntSql] = q.mock.calls[1];
    expect(cntSql).toMatch(/regexp_replace\(COALESCE\(ca\.callback_number, ''\), '\\D', '', 'g'\) = \$1/);
    expect(cntSql).toMatch(/<> 'draft'/);
  });

  it('최신 순 20건씩 · 쪽에 맞는 OFFSET', async () => {
    await lookupCallbackNumber('01012345678', 3);
    const [pageSql, pageArgs] = q.mock.calls[2];
    expect(pageSql).toMatch(/ORDER BY COALESCE\(ca\.sent_at, ca\.scheduled_at, ca\.created_at\) DESC/);
    expect(pageSql).toMatch(/<> 'draft'/);
    expect(pageArgs).toEqual(['01012345678', CALLBACK_LOOKUP_PAGE_SIZE, 2 * CALLBACK_LOOKUP_PAGE_SIZE]);
  });

  it('계정 ID · 이용자명 · 발신일 · 발송 방식 이름을 돌려준다', async () => {
    const r = await lookupCallbackNumber('01012345678', 1);
    expect(r.total).toBe(41);
    expect(r.registrations[0]).toMatchObject({ companyName: '가나상사', usageScope: 'assigned', assignees: [{ loginId: 'kim01', name: '김담당' }] });
    expect(r.sends[0]).toMatchObject({ loginId: 'kim01', userName: '김담당', sentAt: '2026-11-20T01:00:00.000Z', sendType: '직접발송', successCount: 9, failCount: 1 });
  });
});
