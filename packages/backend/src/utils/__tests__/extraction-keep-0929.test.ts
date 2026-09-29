/**
 * 직접 타겟 추출 보관본 (★2026-09-29 한줄로 V2 R112 · 설계 docs/2026-09-28-v2-round4-send-redesign.md §2-1)
 *
 * 옛: /api/customers/extract가 고객 전체를 브라우저로 보내고, 화면이 그 명단을 발송 요청에 다시 실었다.
 * 새: 추출 결과를 발송 준비 표에 보관하고 화면에는 건수·앞 15명·가장 긴 값만 준다. 발송은 직접발송과 같은 적재·확정 길.
 * 이 파일이 고정하는 것:
 *   - keep 없는 /extract 응답은 옛날과 같다(브랜드메시지 창 AI 타겟추출) · 옮긴 SELECT 조립·평면화는 원본과 같은 결과
 *   - 번호가 비었거나 20자를 넘는 행은 넣지 않는다(staging.phone varchar(20) NOT NULL · 0929 information_schema)
 *   - 적재는 한 트랜잭션(중간 실패 = 한 행도 안 남는다)
 *   - 커밋된 보관본은 바꾸지 않는다(409) · 만료(23시간 · 행 없음)는 410
 *   - 개인정보를 돌려주는 조회는 사용자 매장 범위를 다시 건다
 *   - 발송 전 집계는 요청한 확인만 더한다(직접발송 무변경)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn(async (..._a: any[]): Promise<any> => ({ rows: [], rowCount: 0 }));
const clientQuery = vi.fn(async (..._a: any[]): Promise<any> => ({ rows: [], rowCount: 0 }));
const release = vi.fn();
vi.mock('../../config/database', () => ({
  query: (...a: any[]) => (queryMock as any)(...a),
  pool: { connect: async () => ({ query: (...a: any[]) => (clientQuery as any)(...a), release }) },
}));
const scopeMock = vi.fn(async (..._a: any[]): Promise<any> => ({ type: 'no_filter' }));
vi.mock('../store-scope', () => ({ getStoreScope: (...a: any[]) => (scopeMock as any)(...a) }));

import {
  buildExtractSelect, buildKeptSelect, KEEP_PHONE_ONLY_ERROR, flattenExtractRow, keepablePhone, keepableCallback, longestValues,
  keepExtraction, readExtractionState, removeFromExtraction, fillExtractionCallback, searchExtraction, readExtractionRows,
  resolveExtractionScope, EXTRACTION_SAMPLE_SIZE,
} from '../extraction-keep';
import { getColumnFields } from '../standard-field-map';
import { STAGING_COMMIT_MAX_AGE_HOURS } from '../staging-sweeper';

const routesDir = join(__dirname, '..', '..', 'routes');
const customersSrc = readFileSync(join(routesDir, 'customers.ts'), 'utf8');
const campaignsSrc = readFileSync(join(routesDir, 'campaigns.ts'), 'utf8');
const sliceRoute = (src: string, head: string) => {
  const at = src.indexOf(head);
  return src.slice(at, src.indexOf('\nrouter.', at + 10));
};

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  clientQuery.mockReset();
  clientQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  release.mockClear();
  scopeMock.mockReset();
  scopeMock.mockImplementation(async () => ({ type: 'no_filter' }));
});

describe('추출 SELECT 조립(원본 그대로 옮김)', () => {
  it('기본 = phone · FIELD_MAP 실컬럼 순서 + region·custom_fields·callback', () => {
    const r = buildExtractSelect(undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const expected = [...getColumnFields().map(f => (f.columnName === 'phone' ? 'phone as phone' : f.columnName)), 'region', 'custom_fields', 'callback'].join(', ');
    expect(r.selectClause).toBe(expected);
    expect(r.phoneExpr).toBe('phone');
  });

  it('custom_1~15 번호 칸 = jsonb 접근식 별칭', () => {
    const r = buildExtractSelect('custom_3');
    expect(r.ok && r.phoneExpr).toBe("custom_fields->>'custom_3'");
    expect(r.ok && r.selectClause).toContain("custom_fields->>'custom_3' as phone");
  });

  it('모르는 식별자·주입 문자열은 거절(옛 400 문구 그대로)', () => {
    for (const bad of ['custom_16', 'phone; DROP TABLE x', '(select 1)', 'custom_0']) {
      const r = buildExtractSelect(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('유효하지 않은 전화번호 필드입니다.');
    }
  });

  it('평면화 = custom_fields 풀기 + 값 String 박제(원본 보존)', () => {
    const flat = flattenExtractRow({ phone: '01000000101', name: '김', custom_fields: { custom_1: 1200, custom_2: null } });
    expect(flat.custom_fields).toBeUndefined();
    expect(flat.custom_1).toBe('1200');
    expect(flat.custom_2).toBe('');
    expect(flat.name).toBe('김');
  });

  it('/extract 라우트가 CT를 쓴다 · keep 없으면 옛 응답 모양 그대로', () => {
    const route = sliceRoute(customersSrc, "router.post('/extract',");
    expect(route).toContain('buildExtractSelect(phoneField)');
    expect(route).toContain('result.rows.map(flattenExtractRow)');
    expect(route).not.toContain("custom_fields->>'${requestedPhoneField}'"); // 인라인 조립 잔존 0
    expect(route).toMatch(/res\.json\(\{\s*success: true,\s*count: flatRecipients\.length,\s*recipients: flatRecipients\s*\}\)/);
    // 개인정보 조회 기록은 두 갈래 모두 전에 남는다
    expect(route.indexOf('logPrivacyView(')).toBeLessThan(route.indexOf('await keepExtraction('));
  });
});

describe('보관 값 규칙', () => {
  it('번호 = 숫자만 · 1~20자 · 그 밖은 넣지 않는다', () => {
    expect(keepablePhone('010-0000-0101')).toBe('01000000101');
    expect(keepablePhone('')).toBeNull();
    expect(keepablePhone(null)).toBeNull();
    expect(keepablePhone('1'.repeat(21))).toBeNull();
    expect(keepablePhone('1'.repeat(20))).toBe('1'.repeat(20));
  });

  it('수신자별 회신번호 = 앞뒤 공백 뗀 원문 · 20자 넘으면 숫자만 · 그래도 넘으면 비움', () => {
    expect(keepableCallback(' 02-000-0000 ')).toBe('02-000-0000');
    expect(keepableCallback('   ')).toBeNull();
    expect(keepableCallback('대표번호: 02-0000-0000 (내선 1)')).toBe('02000000001');
    expect(keepableCallback('9'.repeat(25))).toBeNull();
  });

  it('가장 긴 값 = 칸마다 · getMaxByteMessage와 같은 읽기(0 → 빈 값)', () => {
    const l = longestValues([
      { name: '김', grade: 'VIP', points: 0 },
      { name: '남궁민수', grade: 'G', points: 12345, obj: { a: 1 } },
    ]);
    expect(l.name).toBe('남궁민수');
    expect(l.grade).toBe('VIP');
    expect(l.points).toBe('12345');
    expect(l.obj).toBeUndefined();
  });

  it('★Codex 1R high — 보관 추출은 phone 칸만(회사 안 유일 = 보관 행 하나에 고객 하나 · 다른 번호 칸은 같은 값의 남의 고객이 붙는다)', () => {
    expect(buildKeptSelect(undefined).ok).toBe(true);
    expect(buildKeptSelect('phone').ok).toBe(true);
    for (const f of ['custom_1', 'store_phone', 'x']) {
      const r = buildKeptSelect(f);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(KEEP_PHONE_ONLY_ERROR);
    }
  });

  it('keep 추출·보관본 입구 넷은 phone 전용 조립을 쓰고 · 옛 추출은 그대로 번호 칸을 고를 수 있다', () => {
    const route = sliceRoute(customersSrc, "router.post('/extract',");
    expect(route).toContain('req.body?.keep === true ? buildKeptSelect(phoneField) : buildExtractSelect(phoneField)');
    for (const head of ["router.post('/extractions/:id/search',", "router.post('/extractions/:id/rows',", "router.post('/extractions/:id/callback',"]) {
      expect(sliceRoute(customersSrc, head)).toContain('buildKeptSelect(req.body?.phoneField)');
    }
  });
});

describe('보관 적재(keepExtraction)', () => {
  it('번호 없는·긴 행은 빼고 세고 · 한 트랜잭션 · 표본 15 · 만료 = 23시간 뒤', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ phone: `010-0000-${String(1000 + i)}`, name: `n${i}` }));
    rows.push({ phone: '', name: 'x' }, { phone: '1'.repeat(25), name: 'y' });
    const before = Date.now();
    const r = await keepExtraction('co', rows);
    expect(r.count).toBe(20);
    expect(r.skippedNoPhone).toBe(2);
    expect(r.sample).toHaveLength(EXTRACTION_SAMPLE_SIZE);
    expect(r.sample[0].name).toBe('n0'); // 추출 순서(최근 등록 순) 그대로
    expect(r.longest.name).toBe('n10');
    const sqls = clientQuery.mock.calls.map((c: any[]) => String(c[0]));
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    const ins = clientQuery.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO campaign_send_staging')) as any[];
    expect(String(ins[0])).toContain('UNNEST($3::text[], $4::text[])');
    expect(ins[1][2]).toHaveLength(20);
    expect(ins[1][2][0]).toBe('01000001000');
    expect(release).toHaveBeenCalledTimes(1);
    const exp = new Date(r.expiresAt as string).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + STAGING_COMMIT_MAX_AGE_HOURS * 3600_000);
  });

  it('보관할 행이 없으면 DB에 가지 않고 id 없음', async () => {
    const r = await keepExtraction('co', [{ phone: '' }]);
    expect(r.extractionId).toBeNull();
    expect(r.count).toBe(0);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('적재 도중 실패하면 ROLLBACK · 오류는 그대로 올린다', async () => {
    clientQuery.mockImplementation(async (sql: any) => {
      if (String(sql).includes('INSERT')) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    });
    await expect(keepExtraction('co', [{ phone: '01000000001' }])).rejects.toThrow('boom');
    expect(clientQuery.mock.calls.map((c: any[]) => String(c[0]))).toContain('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('보관본 상태·빼기·회신번호 채우기', () => {
  it('행 없음·23시간 지남 = expired · 캠페인이 가리키면 committed', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ n: 0, stale: null, committed: false }] });
    expect((await readExtractionState('e', 'co')).state).toBe('expired');
    queryMock.mockResolvedValueOnce({ rows: [{ n: 5, stale: true, committed: false }] });
    expect((await readExtractionState('e', 'co')).state).toBe('expired');
    queryMock.mockResolvedValueOnce({ rows: [{ n: 5, stale: false, committed: true }] });
    expect((await readExtractionState('e', 'co')).state).toBe('committed');
    queryMock.mockResolvedValueOnce({ rows: [{ n: 5, stale: false, committed: false }] });
    expect(await readExtractionState('e', 'co')).toEqual({ state: 'ok', count: 5 });
    expect(String(queryMock.mock.calls[0][0])).toContain('company_id = $2::uuid');
  });

  it('빼기: 끊긴 확정의 보관 칸을 먼저 되돌린다 · 커밋된 보관본은 409 · DELETE 없음', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // 되돌리기(보관 칸 · Codex 3R)
    queryMock.mockResolvedValueOnce({ rows: [{ n: 5, stale: false, committed: true }] });
    const r = await removeFromExtraction('e', 'co', ['01000000001']);
    expect(r).toMatchObject({ ok: false, status: 409, code: 'STAGING_COMMITTED' });
    expect(queryMock.mock.calls.some((c: any[]) => String(c[0]).includes('DELETE'))).toBe(false);
    expect(String(queryMock.mock.calls[0][0])).toContain('SET staging_id = $1::uuid');
  });

  it('빼기: 만료 410 · 정상 = 숫자만·중복 없이 회사 조건 DELETE · 남은 건수', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    queryMock.mockResolvedValueOnce({ rows: [{ n: 0, stale: null, committed: false }] });
    expect(await removeFromExtraction('e', 'co', ['01000000001'])).toMatchObject({ ok: false, status: 410, code: 'EXTRACTION_EXPIRED' });

    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    queryMock.mockResolvedValueOnce({ rows: [{ n: 10, stale: false, committed: false }] });
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 2 });
    const r = await removeFromExtraction('e', 'co', ['010-0000-0001', '01000000001', '010-0000-0002', '']);
    expect(r).toEqual({ ok: true, count: 8, changed: 2 });
    const del = queryMock.mock.calls.find((c: any[]) => String(c[0]).includes('DELETE')) as any[];
    expect(String(del[0])).toContain('company_id = $2::uuid AND phone = ANY($3::text[])');
    expect(del[1][2]).toEqual(['01000000001', '01000000002']);
  });

  it('회신번호 채우기: 모르는 칸 400 · 커밋 409', async () => {
    expect(await fillExtractionCallback('e', 'co', 'x; drop')).toMatchObject({ ok: false, status: 400 });
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    queryMock.mockResolvedValueOnce({ rows: [{ n: 5, stale: false, committed: true }] });
    expect(await fillExtractionCallback('e', 'co', 'custom_2')).toMatchObject({ ok: false, status: 409 });
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('회신번호 채우기: 비우기 → 채우기 → 빈 행 세기가 한 트랜잭션 · 고객은 phone(유일)으로만 잇는다', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // 되돌리기(보관 칸)
    queryMock.mockResolvedValueOnce({ rows: [{ n: 7, stale: false, committed: false }] });
    clientQuery.mockImplementation(async (sql: any) => {
      if (String(sql).includes('COUNT(*)')) return { rows: [{ n: 3 }] };
      if (String(sql).includes('FROM (')) return { rows: [], rowCount: 4 };
      return { rows: [], rowCount: 0 };
    });
    const r = await fillExtractionCallback('e', 'co', 'custom_2');
    expect(r).toEqual({ ok: true, count: 7, changed: 4, missing: 3 });
    const sqls = clientQuery.mock.calls.map((c: any[]) => String(c[0]));
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toContain('SET callback = NULL');
    expect(sqls[2]).toContain("c.custom_fields->>'custom_2'");
    expect(sqls[2]).toContain('SELECT c.phone AS phone');
    expect(sqls[2]).not.toContain('regexp_replace(COALESCE(c.custom_fields');
    expect(sqls[2]).toContain('c.is_active = true');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
  });
});

describe('개인정보를 돌려주는 조회 = 매장 범위', () => {
  const sel = { selectClause: 'phone as phone, name', phoneExpr: 'phone' };

  it('검색: 숫자만 LIKE · 최대 50 · 매장 코드가 있으면 customer_stores 조건', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ n: 3 }] });
    queryMock.mockResolvedValueOnce({ rows: [{ phone: '01000001204', name: '문' }] });
    const r = await searchExtraction({ extractionId: 'e', companyId: 'co', digits: '1204', select: sel, storeCodes: ['S1'] });
    expect(r.matched).toBe(3);
    expect(r.rows).toHaveLength(1);
    const [sql, params] = queryMock.mock.calls[1] as any[];
    expect(String(sql)).toContain('customer_stores WHERE company_id = $1 AND store_code = ANY($5::text[])');
    expect(String(sql)).toContain('is_active = true');
    expect(params).toEqual(['co', 'e', '%1204%', 50, ['S1']]);
  });

  it('전체 행: 매장 범위 없으면 조건 없음 · 추출 순서', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await readExtractionRows({ extractionId: 'e', companyId: 'co', select: sel, storeCodes: null });
    const [sql, params] = queryMock.mock.calls[0] as any[];
    expect(String(sql)).not.toContain('customer_stores');
    expect(String(sql)).toContain('ORDER BY created_at DESC');
    expect(params).toEqual(['co', 'e']);
  });

  it('범위 판정 = 사용자만 · 관리자는 제한 없음', async () => {
    expect(await resolveExtractionScope('co', 'u', 'company_admin')).toBeNull();
    expect(scopeMock).not.toHaveBeenCalled();
    scopeMock.mockResolvedValueOnce({ type: 'filtered', storeCodes: ['A'] });
    expect(await resolveExtractionScope('co', 'u', 'company_user')).toEqual(['A']);
    scopeMock.mockResolvedValueOnce({ type: 'blocked' });
    expect(await resolveExtractionScope('co', 'u', 'company_user')).toBe('blocked');
  });

  it('검색·전체 행 입구는 범위를 CT로 걸고 개인정보 조회 기록을 남긴다', () => {
    for (const head of ["router.post('/extractions/:id/search',", "router.post('/extractions/:id/rows',"]) {
      const route = sliceRoute(customersSrc, head);
      expect(route).toContain('resolveExtractionScope(companyId, req.user?.userId, req.user?.userType)');
      expect(route).toContain("kind: 'customer_extract'");
      expect(route).toContain("code: 'EXTRACTION_EXPIRED'");
    }
  });
});

describe('발송 전 집계(/direct-send/count) = 요청한 확인만 더한다', () => {
  it('요청 플래그가 없으면 옛 응답 그대로(직접발송)', () => {
    const route = sliceRoute(campaignsSrc, "router.post('/direct-send/count',");
    expect(route).toContain('(includeNameEmpty === true || !!useIndividualCallback)');
    expect(route).not.toMatch(/useIndividualCallback === true/);
    expect(route).toContain(': {};');
    expect(route).toContain('callbackAssignmentUserId((req as any).user?.userType, userId)');
  });
});
