/**
 * 여정 결함 0 (★ 2026-10-23) — 주소 문 · 오류 매핑 · 주인 한 곳
 *   담당자(company_user) = 자기가 만든 여정만(캠페인 · 자동발송과 같다) · 500 에 오류 원문 0 · 모든 여정 주소가 journeyGate 를 지난다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn() }));
vi.mock('../plan-guard', () => ({ loadPlanContext: vi.fn(async () => ({ planCode: 'PRO' })), isAiOperatorAllowed: vi.fn(() => true) }));

import { query } from '../../config/database';
import { journeyGate, journeyError } from '../journey-route';
import { JourneyInputError } from '../journey-step-limits';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const J = '11111111-1111-4111-8111-111111111111';
const fakeRes = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
};
const reqOf = (userType: string, params: Record<string, string> = {}) => ({ user: { companyId: 'c1', userId: 'u1', userType }, params } as any);

describe('주인 문', () => {
  beforeEach(() => mockQuery.mockReset());

  it('담당자가 남의 여정을 열면 404(있는지도 알리지 않는다) · 주인 조건이 SQL 에 실린다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = fakeRes();
    const g = await journeyGate(reqOf('company_user', { id: J }), res);
    expect(g).toBeNull();
    expect(res.statusCode).toBe(404);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('created_by::text');
    expect(params).toEqual([J, 'c1', 'u1']);
  });

  it('관리자는 회사 전체(주인 조건 없음) · 자원 없는 주소는 확인 쿼리 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = fakeRes();
    const g = await journeyGate(reqOf('company_admin', { id: J }), res);
    expect(g).toMatchObject({ companyId: 'c1', ownOnly: false });
    expect(String(mockQuery.mock.calls[0][0])).not.toContain('created_by');
    mockQuery.mockReset();
    const g2 = await journeyGate(reqOf('company_user'), fakeRes());
    expect(g2).toMatchObject({ ownOnly: true });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('칸 주소(stepId)도 그 칸의 여정 주인을 본다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ journey_id: J }] }).mockResolvedValueOnce({ rows: [] });
    const res = fakeRes();
    const g = await journeyGate(reqOf('company_user', { stepId: '22222222-2222-4222-8222-222222222222' }), res);
    expect(g).toBeNull();
    expect(res.statusCode).toBe(404);
  });
});

describe('오류 매핑 한 벌', () => {
  it('500 에 원문을 내보내지 않는다 · CHECK 23514 = 503 · 입력 오류 = 400', () => {
    const r1 = fakeRes();
    journeyError(r1, new Error('relation "x" syntax error at or near SELECT'), 't', '여정 생성 실패');
    expect(r1.statusCode).toBe(500);
    expect(r1.body.error).toBe('여정 생성 실패');
    const r2 = fakeRes();
    journeyError(r2, Object.assign(new Error('violates check'), { code: '23514' }), 't', 'x');
    expect(r2.statusCode).toBe(503);
    expect(r2.body.code).toBe('DB_MIGRATION_PENDING');
    const r3 = fakeRes();
    journeyError(r3, new JourneyInputError('칸이 너무 많아요'), 't', 'x');
    expect(r3.statusCode).toBe(400);
    const r4 = fakeRes();
    journeyError(r4, new Error('column "entry_ends_on" does not exist'), 't', 'x');
    expect(r4.statusCode).toBe(503);
  });
});

describe('모든 여정 주소가 같은 문 · 같은 오류 매핑을 지난다(새 주소가 우회하면 실패)', () => {
  const src = readFileSync(resolve(__dirname, '../../routes/ai.ts'), 'utf8');
  const blocks = src.split(/\n(?=router\.(?:get|post|put|patch|delete)\()/).filter((b) => /^router\.\w+\('\/operator\/(journeys|preview-target-samples|grade-ranks)/.test(b));
  it('여정 주소 전부 journeyGate(★1023 = 57 · 한 줄 패키지 · 새 판 주소 삭제 · 질문표 프리셋 추가)', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(55);
    const noGate = blocks.filter((b) => !b.includes('await journeyGate(req, res)')).map((b) => b.split('\n')[0]);
    expect(noGate).toEqual([]);
  });
  it('여정 주소 안에 따로 쓴 문(loadPlanContext · isAiOperatorAllowed) 0 · 500 원문 0', () => {
    const own = blocks.filter((b) => /loadPlanContext\(|isAiOperatorAllowed\(/.test(b)).map((b) => b.split('\n')[0]);
    expect(own).toEqual([]);
    const raw = blocks.filter((b) => /status\(500\)\.json\(\{[^}]*err\?\.message/.test(b)).map((b) => b.split('\n')[0]);
    expect(raw).toEqual([]);
  });
  it('목록 · 지도 · 묶음 켜기 · 붙이기 후보 · 붙일 앞 여정 = 주인 조건', () => {
    expect(src).toContain('listJourneys(companyId, status, gate)');
    expect(src).toMatch(/journeys-activate-batch[\s\S]*?accessibleJourneyIds\(gate\)/);
    expect(src).toMatch(/attach-candidates[\s\S]*?accessibleJourneyIds\(gate\)/);
    expect(src).toMatch(/canAccessJourney\(gate, afterId\)/);
    const map = readFileSync(resolve(__dirname, '../journey-lifecycle-map.ts'), 'utf8');
    expect(map).toContain('ownsOnlyOwnJourneys(viewerUserId)');
  });
});
