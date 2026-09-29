/**
 * 발송 전 집계에 더한 확인 두 가지 (★2026-09-29 한줄로 V2 R112 · countStagingChecks)
 *
 * 직접 타겟 발송이 옛 동기 경로(/direct-send)에서 받던 두 확인을 적재 경로에서도 준다:
 *   ① 이름 빈 행 수(%이름% 경고) ② 수신자별 회신번호 제외(없음·미등록 · callback-filter CT 그대로 · 동기 경로와 같은 응답 모양)
 * 요청한 것만 센다(직접발송 창은 요청하지 않는다 = 무변경).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-vitest';

const queryMock = vi.fn(async (..._a: any[]): Promise<any> => ({ rows: [], rowCount: 0 }));
vi.mock('../../config/database', () => ({
  query: (...a: any[]) => (queryMock as any)(...a),
  pool: { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) },
  mysqlQuery: async () => [],
}));
const registered = vi.fn(async (..._a: any[]) => new Set<string>(['0200000000']));
vi.mock('../callback-filter', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    filterByIndividualCallback: (rows: any[], companyId: string, userId?: string) => {
      // 실제 CT 판정 규칙(없음 → 미등록)을 그대로 따르되 등록 번호만 대역으로 준다
      const missing = rows.filter((r) => !r.callback || !String(r.callback).trim());
      const rest = rows.filter((r) => r.callback && String(r.callback).trim());
      return registered(companyId, userId).then((set) => {
        const ok = rest.filter((r) => set.has(String(r.callback).replace(/\D/g, '')));
        const unreg = rest.length - ok.length;
        return {
          filtered: ok, callbackMissingCount: missing.length, callbackUnregisteredCount: unreg,
          callbackSkippedCount: missing.length + unreg, unregisteredDetails: [],
        };
      });
    },
  };
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { countStagingChecks, planIndividualCallbackExclusion } from '../direct-send-core';
import { parkedStagingId, parkStagingRows, restoreParkedStagingRows, dropParkedStagingRows } from '../staging-sweeper';

const applyPlan = (dedup: boolean) => planIndividualCallbackExclusion('s', 'co', 'u', dedup);

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  registered.mockClear();
});

describe('수신자별 회신번호 제외 = 차감 전 확정 · 원본 id 하나 · 뺄 행은 보관 칸으로 옮겼다 되돌린다(★Codex 1R·2R·3R high)', () => {
  it('판정: 중복제거 켬 = 번호당 첫 행으로 판정 · 제외된 번호는 그 번호 행 전부를 옮긴다(워커가 남기는 집합) · 판정은 읽기만', async () => {
    queryMock.mockResolvedValueOnce({ rows: [
      { id: 1, phone: '01000000001', callback: '0200000000' },
      { id: 2, phone: '01000000002', callback: '' },           // 첫 행이 없음 → 이 번호 제외
      { id: 3, phone: '01000000002', callback: '0200000000' }, // 같은 번호 뒤 행(첫 행 판정을 따른다)
      { id: 4, phone: '01000000003', callback: '0311111111' }, // 미등록
      { id: 5, phone: '01000000001', callback: '' },           // 통과한 번호의 뒤 행 = 남긴다(워커 중복제거가 첫 행을 남긴다)
    ] });
    const r = await applyPlan(true);
    expect(r).toEqual({ moveIds: ['2', '3', '4'], removed: 2, remaining: 1, callbackMissingCount: 1, callbackUnregisteredCount: 1 });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('판정: 중복제거 끔 = 행마다', async () => {
    queryMock.mockResolvedValueOnce({ rows: [
      { id: 1, phone: '01000000001', callback: '0200000000' },
      { id: 2, phone: '01000000001', callback: '' },
    ] });
    const r = await applyPlan(false);
    expect(r.moveIds).toEqual(['2']);
    expect(r.remaining).toBe(1);
  });

  it('보관 칸 id = 원본에서 정해진다(같은 원본 = 같은 칸 · uuid 표기 무관 = 잠금 키와 같은 정규화 · uuid 모양)', () => {
    const a1 = parkedStagingId('abcdef00-0000-4000-8000-000000000001');
    expect(parkedStagingId('ABCDEF00-0000-4000-8000-000000000001')).toBe(a1);
    expect(parkedStagingId('{abcdef00000040008000000000000001}')).toBe(a1);
    expect(a1).not.toBe(parkedStagingId('abcdef00-0000-4000-8000-000000000002'));
    expect(a1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('★Codex 4R — 보관 칸 id 는 서버 비밀키 HMAC(비밀키가 다르면 다른 칸 · 없으면 만들지 않는다 = 바깥에서 계산 불가)', () => {
    const saved = process.env.JWT_SECRET;
    const x = parkedStagingId('abcdef00-0000-4000-8000-000000000001');
    process.env.JWT_SECRET = 'another-secret';
    expect(parkedStagingId('abcdef00-0000-4000-8000-000000000001')).not.toBe(x);
    delete process.env.JWT_SECRET;
    expect(() => parkedStagingId('abcdef00-0000-4000-8000-000000000001')).toThrow('JWT_SECRET');
    process.env.JWT_SECRET = saved;
  });

  it('옮김 = 같은 회사 · 고른 행만 · 칸 id 로 · 빈 목록이면 DB 에 가지 않는다', async () => {
    expect(await parkStagingRows('s', 'co', [])).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 2 });
    expect(await parkStagingRows('s', 'co', ['2', '3'])).toBe(2);
    const [sql, params] = queryMock.mock.calls[0] as any[];
    expect(String(sql)).toContain('WHERE staging_id = $1::uuid AND company_id = $2::uuid AND id = ANY($4::bigint[])');
    expect(params).toEqual(['s', 'co', parkedStagingId('s'), ['2', '3']]);
  });

  it('되돌리기 = 살아 있는 캠페인이 원본을 가리키면 되돌리지 않는다(같은 문장 안 조건) · 지우기 = 칸만', async () => {
    await restoreParkedStagingRows('s', 'co');
    const [sql, params] = queryMock.mock.calls[0] as any[];
    expect(String(sql)).toContain('SET staging_id = $1::uuid');
    expect(String(sql)).toContain("NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.staging_id = $1::uuid AND COALESCE(c.send_phase, '') <> 'failed')");
    expect(params).toEqual(['s', 'co', parkedStagingId('s')]);
    await dropParkedStagingRows('s', 'co');
    const [dsql, dparams] = queryMock.mock.calls[1] as any[];
    expect(String(dsql)).toContain('DELETE FROM campaign_send_staging WHERE staging_id = $2::uuid AND company_id = $1::uuid');
    expect(dparams).toEqual(['co', parkedStagingId('s')]);
  });

  it('확정 입구 순서: 이미 접수됨(409) → 끊긴 칸 되돌리기 → 만료 → 판정 → 옮김 → 원본으로 건수 확정 → 캠페인 생성(원본 id) → 마무리(되돌리기 → 남은 칸 지우기)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
    const at = src.indexOf("router.post('/direct-send/commit',");
    const route = src.slice(at, src.indexOf('\nrouter.', at + 10));
    const order = [
      "COALESCE(send_phase, '') <> 'failed' LIMIT 1",
      "code: 'STAGING_COMMITTED'",
      'await restoreParkedStagingRows(stagingId, companyId);\n      if ((await resolveStagingCommitState(stagingId, companyId))',
      "code: 'STAGING_EXPIRED'",
      'planIndividualCallbackExclusion(',
      'parkStagingRows(stagingId, companyId, plan.moveIds)',
      'countStagingFiltered(stagingId,',
      'createDirectSendCampaign({\n            stagingId,',
      '} finally {',
      'await restoreParkedStagingRows(stagingId, companyId);\n            await dropParkedStagingRows(stagingId, companyId);',
    ].map((m) => {
      const i = route.indexOf(m);
      expect(i, `표지 없음: ${m}`).toBeGreaterThan(-1);
      return i;
    });
    for (let k = 1; k < order.length; k++) expect(order[k - 1]).toBeLessThan(order[k]);
    expect(route).not.toMatch(/DELETE FROM campaign_send_staging/);
    expect(route).not.toContain('commitStagingId');
  });
});

describe('countStagingChecks', () => {
  it('아무것도 요청하지 않으면 DB에 가지 않는다', async () => {
    expect(await countStagingChecks('s', 'co', { nameEmpty: false, individualCallback: false, dedupEnabled: true })).toEqual({});
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('이름 빈 행 = 회사 조건 · 공백만인 이름도 빈 것으로', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ c: 4 }] });
    const r = await countStagingChecks('s', 'co', { nameEmpty: true, individualCallback: false, dedupEnabled: true });
    expect(r).toEqual({ nameEmptyCount: 4 });
    const [sql, params] = queryMock.mock.calls[0] as any[];
    expect(String(sql)).toContain("COALESCE(btrim(name), '') = ''");
    expect(params).toEqual(['s', 'co']);
  });

  it('회신번호: 중복제거를 켜면 번호당 첫 행만 · 일부 제외면 확인 창 응답(동기 경로 모양)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [
      { phone: '01000000001', callback: '02-0000-0000' },
      { phone: '01000000001', callback: '' },            // 같은 번호 두 번째 행 = 안 본다
      { phone: '01000000002', callback: '' },            // 없음
      { phone: '01000000003', callback: '0311111111' },  // 미등록
    ] });
    const r = await countStagingChecks('s', 'co', { nameEmpty: false, individualCallback: true, callbackUserId: 'u', dedupEnabled: true });
    expect(r.callbackConfirm).toMatchObject({
      callbackConfirmRequired: true, callbackMissingCount: 1, callbackUnregisteredCount: 1, remainingCount: 1,
    });
    expect(r.callbackError).toBeUndefined();
    expect(registered).toHaveBeenCalledWith('co', 'u');
  });

  it('회신번호 제외 뒤 실제 발송 인원 = 남은 번호에서 수신거부까지 뺀다(발송 확인 창 숫자)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [
      { phone: '01000000001', callback: '0200000000' },
      { phone: '01000000004', callback: '0200000000' },
      { phone: '01000000002', callback: '' },
    ] });
    queryMock.mockResolvedValueOnce({ rows: [{ phone: '01000000004' }] }); // 남은 둘 중 하나가 수신거부
    const r = await countStagingChecks('s', 'co', {
      nameEmpty: false, individualCallback: true, dedupEnabled: true, applyUnsub: true, unsubUserId: 'u',
    });
    expect(r.callbackConfirm?.remainingCount).toBe(2);
    expect(r.sendCountAfterCallback).toBe(1);
    const [sql, params] = queryMock.mock.calls[1] as any[];
    expect(String(sql)).toContain('FROM unsubscribes WHERE user_id = $1 AND phone = ANY($2::text[])');
    expect(params).toEqual(['u', ['01000000001', '01000000004']]);
  });

  it('회신번호: 전원 제외면 확인 창 대신 오류 응답', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ phone: '01000000002', callback: '' }] });
    const r = await countStagingChecks('s', 'co', { nameEmpty: false, individualCallback: true, dedupEnabled: true });
    expect(r.callbackConfirm).toBeUndefined();
    expect(r.callbackError).toBeTruthy();
  });

  it('회신번호: 전원 통과면 아무것도 더하지 않는다', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ phone: '01000000001', callback: '0200000000' }] });
    expect(await countStagingChecks('s', 'co', { nameEmpty: false, individualCallback: true, dedupEnabled: false })).toEqual({});
  });
});
