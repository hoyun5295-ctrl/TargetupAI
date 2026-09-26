/**
 * 카페24 스크립트태그 = 지금 키로 맞춘다 (★2026-09-26 한줄로 V2 R1-30)
 *
 * 옛: 스크립트태그는 회사 공개 키를 ?k= 로 싣는데, "이미 우리 태그가 있으면 끝"이라
 *     /cdp/issue-key 재발급으로 키가 바뀌어도 몰은 옛 키를 계속 썼다 → 몰 행동 수집 401.
 *     그리고 재발급은 스크립트태그를 다시 맞추지도 않았다.
 * 처방: ①우리 태그가 지금 주소(키·SDK 판)와 다르면 새 태그를 먼저 올리고 옛 태그를 지운다
 *         (먼저 지우면 올리기 실패 시 수집이 끊긴다 · 옛 키 태그는 이미 폐기된 키라 이중 수집이 없다).
 *       ②키 재발급 직후 그 회사 카페24 몰 전부에 ①을 돌린다(실패는 격리 · 재발급 응답에 영향 없음).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('../../config/database', () => ({ query: (...a: any[]) => queryMock(...a) }));
const apiMock = vi.fn();
vi.mock('../cafe24-client', () => ({
  getCafe24Integration: vi.fn(async () => ({ mall_id: 'testmall' })),
  cafe24ApiCall: (...a: any[]) => apiMock(...a),
  getCafe24ByoCredentials: vi.fn(async () => null),
}));
vi.mock('../cdp-auth', () => ({ issueCdpKeyPair: vi.fn() }));

import { ensureCafe24ScriptTag } from '../cafe24-scripttag';

const CO = '00000000-0000-4000-8000-000000000001';
const NEW_KEY = 'pk_test_new';
const base = 'https://app.hanjul.ai/api/cafe24/sdk/v0.3.9/hanjul.min.js';
const NEW_SRC = `${base}?k=${NEW_KEY}`;
const OLD_SRC = `${base}?k=pk_test_old`;

function db() {
  queryMock.mockImplementation(async (q: any) => {
    const sql = String(q);
    if (sql.includes('SELECT cdp_api_key FROM companies')) return { rows: [{ cdp_api_key: NEW_KEY }] };
    return { rows: [], rowCount: 1 };
  });
}
const calls = () => apiMock.mock.calls.map((c) => `${c[2]?.method} ${c[1]}`);

describe('ensureCafe24ScriptTag 키 맞춤', () => {
  beforeEach(() => { queryMock.mockReset(); apiMock.mockReset(); db(); });

  it('옛 키 태그면 새 태그를 먼저 올리고 옛 태그를 지운다', async () => {
    apiMock.mockImplementation(async (_i: any, path: string, opt: any) => {
      if (opt.method === 'GET') return { scripttags: [{ script_no: 11, src: OLD_SRC }] };
      if (opt.method === 'POST') return { scripttag: { script_no: 22 } };
      return {};
    });
    await ensureCafe24ScriptTag(CO, 'testmall');
    expect(calls()).toEqual(['GET /scripttags', 'POST /scripttags', 'DELETE /scripttags/11']);
    expect(apiMock.mock.calls[1][2].body.request.src).toBe(NEW_SRC);
    const meta = queryMock.mock.calls.filter((c) => String(c[0]).includes('UPDATE company_integrations'));
    expect(meta.some((c) => String(c[1][2]).includes('"scripttag_no":22'))).toBe(true);
  });

  it('새 태그 올리기가 실패하면 옛 태그를 지우지 않는다(수집을 끊지 않는다)', async () => {
    apiMock.mockImplementation(async (_i: any, _p: string, opt: any) => {
      if (opt.method === 'GET') return { scripttags: [{ script_no: 11, src: OLD_SRC }] };
      if (opt.method === 'POST') throw new Error('post failed');
      return {};
    });
    await expect(ensureCafe24ScriptTag(CO, 'testmall')).rejects.toThrow('post failed');
    expect(calls()).not.toContain('DELETE /scripttags/11');
  });

  it('지금 주소 태그가 있으면 그대로 두고 남은 옛 태그만 지운다', async () => {
    apiMock.mockImplementation(async (_i: any, _p: string, opt: any) => {
      if (opt.method === 'GET') return { scripttags: [{ script_no: 11, src: OLD_SRC }, { script_no: 12, src: NEW_SRC }] };
      return {};
    });
    await ensureCafe24ScriptTag(CO, 'testmall');
    expect(calls()).toEqual(['GET /scripttags', 'DELETE /scripttags/11']);
  });

  it('지금 주소 태그 하나뿐이면 아무것도 바꾸지 않는다', async () => {
    apiMock.mockImplementation(async (_i: any, _p: string, opt: any) => {
      if (opt.method === 'GET') return { scripttags: [{ script_no: 12, src: NEW_SRC }] };
      return {};
    });
    await ensureCafe24ScriptTag(CO, 'testmall');
    expect(calls()).toEqual(['GET /scripttags']);
  });
});

describe('키 재발급 배선', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'routes', 'cdp.ts'), 'utf8');
  const route = src.slice(src.indexOf("router.post('/issue-key'"), src.indexOf("router.post('/issue-key'") + 3000);
  it('재발급 뒤 그 회사 카페24 몰 스크립트태그를 다시 맞춘다(격리)', () => {
    const iIssue = route.indexOf('const pair = await issueCdpKeyPair(companyId);');
    const iResync = route.indexOf('void resyncCafe24ScriptTagsForCompany(companyId)');
    expect(iIssue).toBeGreaterThan(-1);
    expect(iResync).toBeGreaterThan(iIssue);
  });
});
