/**
 * ★ 2026-10-01 미리 만든 모바일 DM 불러오기 (서수란 접수 cmunppsm · 설계 = memory project_2026_1001_ai_sales_tickets)
 *
 * 닫힘 사슬
 *   ① importOutreachDm — 목록 고르기·주소 붙여넣기 → 같은 영업 계정의 발행 DM 만 · AI 영업 DM 거절 · 잠금(ready → producing_email)
 *      안에서 imported 기록 추가 · 이미 쓰는 DM 은 아무것도 안 함 · 잠금 실패 시 캡처 사본 정리
 *   ② 파기 = 이 건이 직접 만든 DM 만 중지(불러온 지원팀 DM 은 건드리지 않는다 · 캡처 사본은 지운다)
 *   ③ 블록 숨기기·레시피 승격 = 불러온 DM 이면 분명한 안내로 거절(지원팀 DM 재발행·복제 0)
 *   ④ 후보 목록 = 발행 DM 중 AI 영업이 만들지 않은 것(조건 상수를 그대로 싣는다)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const h = await vi.hoisted(async () => {
  // 파기 함수는 캡처 사본을 같은 파일 안 함수로 지운다 → 대역 대신 임시 폴더의 진짜 파일로 확인한다(모듈 로드 전에 경로를 정한다)
  const os = await import('os');
  const p = await import('path');
  const imageDir = p.join(os.tmpdir(), `outreach-dm-import-1001-${process.pid}`);
  process.env.INAPP_IMAGE_PATH = imageDir;
  return { query: vi.fn(), stopDm: vi.fn(), capture: vi.fn(), unlink: vi.fn(), imageDir };
});

vi.mock('../../config/database', () => ({ query: h.query }));
vi.mock('../audit-log', async (orig) => ({ ...(await orig<any>()), isSalesOutreachOperator: vi.fn(async () => true) }));
vi.mock('../dm/dm-builder', async (orig) => ({ ...(await orig<any>()), stopDm: h.stopDm }));
vi.mock('../sales-outreach-produce', async (orig) => ({
  ...(await orig<any>()),
  getOutreachContext: () => ({ companyId: '00000000-0000-0000-0000-0000000000c0', userId: '00000000-0000-0000-0000-0000000000e0' }),
  captureOutreachDmFirstScreen: h.capture,
}));
vi.mock('../sales-outreach-purge', async (orig) => ({ ...(await orig<any>()), unlinkPublicImage: h.unlink }));

import { importOutreachDm, listImportableOutreachDms, hideOutreachSections, promoteOutreachRecipe, OutreachError } from '../sales-outreach-jobs';
import { purgeOutreachJobArtifacts } from '../sales-outreach-purge';
import { OUTREACH_MADE_DM_SQL } from '../sales-outreach-dm-ownership';

const CO = '00000000-0000-0000-0000-0000000000c0';
const JOB = '00000000-0000-0000-0000-0000000000a1';
const SUPPORT_DM = '00000000-0000-0000-0000-000000000d05';
const OP = '00000000-0000-0000-0000-0000000000e0';
const CAPTURE = `/api/cdp/inapp/image/${CO}/cap-1.jpg`;

interface World {
  job?: Record<string, unknown> | null;
  dm?: Record<string, unknown> | null;
  latestDm?: Record<string, unknown> | null;
  resetOk?: boolean;
  insertOk?: boolean;
}

function install(w: World) {
  h.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const q = String(sql);
    if (q.includes('SELECT stage, mail_result, purged_at, stage_results FROM sales_outreach_jobs')) return { rows: w.job === null ? [] : [w.job ?? { stage: 'ready', mail_result: null, purged_at: null, stage_results: {} }] };
    if (q.includes('FROM dm_pages d WHERE d.id = $1') || q.includes('FROM dm_pages d WHERE d.company_id = $1 AND d.short_code = $2')) return { rows: w.dm ? [w.dm] : [] };
    if (q.includes('FROM dm_recipient_tokens t JOIN dm_pages d')) return { rows: [] };
    if (q.includes("SELECT payload FROM sales_outreach_assets WHERE job_id = $1 AND kind = $2")) return { rows: params[1] === 'dm' && w.latestDm ? [{ payload: w.latestDm }] : [] };
    if (q.includes('UPDATE sales_outreach_jobs') && q.includes('lock_token = $4')) return { rows: w.resetOk === false ? [] : [{ id: JOB }] };
    if (q.includes('INSERT INTO sales_outreach_assets') && q.includes('lock_token = $5')) return { rows: w.insertOk === false ? [] : [{ id: 1 }] };
    return { rows: [] };
  });
}

const insertCall = () => h.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sales_outreach_assets') && String(sql).includes('lock_token = $5'));
const resetCall = () => h.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE sales_outreach_jobs') && String(sql).includes('lock_token = $4'));

beforeEach(() => {
  h.query.mockReset();
  h.stopDm.mockReset();
  h.capture.mockReset();
  h.unlink.mockReset();
  h.capture.mockResolvedValue(CAPTURE);
  h.stopDm.mockResolvedValue({ row: { id: 'x' }, block: null });
});

describe('① importOutreachDm', () => {
  it('목록에서 고른 지원팀 DM → 잠금 안에서 imported 기록 · 메일 재조립 단계로', async () => {
    install({ dm: { id: SUPPORT_DM, title: '금강제화 가을 신상', short_code: 'AbC123x', status: 'published', made: false }, latestDm: { dmId: 'ai-dm-1' } });
    const r = await importOutreachDm(JOB, { dmId: SUPPORT_DM }, OP);
    expect(r).toMatchObject({ dmId: SUPPORT_DM, captured: true, unchanged: false });
    expect(r.dmUrl).toMatch(/AbC123x$/);
    const reset = resetCall()!;
    expect(reset[1][1]).toBe('producing_email');
    expect(reset[1][4]).toEqual(['ready']);
    const ins = insertCall()!;
    const payload = JSON.parse(String(ins[1][2]));
    expect(payload).toMatchObject({ dmId: SUPPORT_DM, imported: true, importedFrom: 'list', captureUrl: CAPTURE, catalogDmId: null, catalogUrl: null });
    expect(ins[1][3]).toBe('producing_email');
    expect(ins[1][4]).toBe(reset[1][3]); // 같은 잠금 토큰
    expect(h.capture).toHaveBeenCalledWith(expect.stringMatching(/\/api\/dm\/v\/dm-AbC123x$/), CO);
  });

  it('붙여 넣은 단축 주소 → 단축 코드로 찾는다', async () => {
    install({ dm: { id: SUPPORT_DM, title: 't', short_code: 'AbC123x', status: 'published', made: false }, latestDm: null });
    const r = await importOutreachDm(JOB, { link: 'https://hlj.kr/AbC123x' }, OP);
    expect(r.unchanged).toBe(false);
    const byCode = h.query.mock.calls.find(([sql]) => String(sql).includes('d.short_code = $2'));
    expect(byCode![1]).toEqual([CO, 'AbC123x']);
    expect(JSON.parse(String(insertCall()![1][2])).importedFrom).toBe('link');
  });

  it('AI 영업이 만든 DM · 발행 전 DM · 없는 DM · 형식 밖 주소 · 제작 완료 전 = 거절하고 잠그지 않는다', async () => {
    const cases: Array<[World, { dmId?: string; link?: string }, RegExp]> = [
      [{ dm: { id: SUPPORT_DM, short_code: 'AbC123x', status: 'published', made: true } }, { dmId: SUPPORT_DM }, /AI 영업이 만든 DM/],
      [{ dm: { id: SUPPORT_DM, short_code: 'AbC123x', status: 'stopped', made: false } }, { dmId: SUPPORT_DM }, /발행된 DM만/],
      [{ dm: null }, { dmId: SUPPORT_DM }, /찾지 못했습니다/],
      [{ dm: null }, { link: '금강제화' }, /주소 형식이 아닙니다/],
      [{ job: { stage: 'producing_dm', mail_result: null, purged_at: null, stage_results: {} } }, { dmId: SUPPORT_DM }, /제작 완료 상태에서만/],
      [{ job: { stage: 'ready', mail_result: 'sending', purged_at: null, stage_results: {} } }, { dmId: SUPPORT_DM }, /제작 완료 상태에서만/],
      [{}, {}, /고르거나 주소를/],
    ];
    for (const [w, input, msg] of cases) {
      h.query.mockReset();
      install(w);
      await expect(importOutreachDm(JOB, input, OP)).rejects.toThrow(msg);
      expect(resetCall()).toBeUndefined();
      expect(h.capture).not.toHaveBeenCalled();
    }
  });

  it('이미 쓰는 DM 이면 아무것도 바꾸지 않는다(캡처·잠금 0)', async () => {
    install({ dm: { id: SUPPORT_DM, short_code: 'AbC123x', status: 'published', made: false }, latestDm: { dmId: SUPPORT_DM, dmUrl: 'https://hlj.kr/AbC123x', captureUrl: CAPTURE } });
    const r = await importOutreachDm(JOB, { dmId: SUPPORT_DM }, OP);
    expect(r).toMatchObject({ unchanged: true, captured: true });
    expect(resetCall()).toBeUndefined();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('잠금을 못 잡거나 기록을 못 넣으면 CONFLICT + 캡처 사본을 지운다', async () => {
    for (const w of [{ resetOk: false }, { insertOk: false }]) {
      h.query.mockReset(); h.unlink.mockReset();
      install({ dm: { id: SUPPORT_DM, short_code: 'AbC123x', status: 'published', made: false }, latestDm: null, ...w });
      const err = await importOutreachDm(JOB, { dmId: SUPPORT_DM }, OP).catch((e) => e);
      expect(err).toBeInstanceOf(OutreachError);
      expect((err as OutreachError).code).toBe('CONFLICT');
      expect(h.unlink).toHaveBeenCalledWith(CAPTURE);
    }
  });
});

describe('② 파기 = 이 건이 직접 만든 DM 만 중지', () => {
  it('AI DM · 카탈로그 짝은 중지 · 불러온 지원팀 DM 은 중지하지 않는다 · 불러온 기록의 캡처 사본은 지운다', async () => {
    const file = path.join(h.imageDir, CO, 'cap-1.jpg');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    h.query.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("kind = 'dm'")) return { rows: [
        { payload: { dmId: 'ai-dm-1', catalogDmId: 'ai-cat-1' } },
        { payload: { dmId: SUPPORT_DM, imported: true, captureUrl: CAPTURE } },
      ] };
      return { rows: [] };
    });
    const r = await purgeOutreachJobArtifacts(JOB, CO);
    expect(h.stopDm.mock.calls.map((c) => c[0])).toEqual(['ai-dm-1', 'ai-cat-1']);
    expect(r).toEqual({ dmsStopped: 2, filesDeleted: 1 });
    expect(fs.existsSync(file)).toBe(false);
    fs.rmSync(h.imageDir, { recursive: true, force: true });
  });
});

describe('③ 불러온 DM 이면 블록 숨기기·레시피 승격을 분명한 안내로 거절', () => {
  it('블록 숨기기(dm)', async () => {
    h.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const q = String(sql);
      if (q.includes('SELECT stage, stage_results FROM sales_outreach_jobs')) return { rows: [{ stage: 'ready', stage_results: {} }] };
      if (q.includes('SELECT payload FROM sales_outreach_assets') && params[1] === 'dm') return { rows: [{ payload: { dmId: SUPPORT_DM, imported: true } }] };
      return { rows: [] };
    });
    await expect(hideOutreachSections(JOB, { kind: 'dm', hidden: ['hero#1'] }, OP)).rejects.toThrow(/불러온 DM은 여기서 블록을 숨길 수 없습니다/);
  });
  it('레시피 승격', async () => {
    h.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const q = String(sql);
      if (q.includes('SELECT stage, company_name, industry_category, stage_results FROM sales_outreach_jobs')) return { rows: [{ stage: 'ready', company_name: '금강제화', industry_category: 'fashion', stage_results: {} }] };
      if (q.includes('SELECT payload FROM sales_outreach_assets') && params[1] === 'dm') return { rows: [{ payload: { dmId: SUPPORT_DM, imported: true } }] };
      return { rows: [] };
    });
    await expect(promoteOutreachRecipe(JOB, OP)).rejects.toThrow(/불러온 DM을 쓰는 건은 레시피를 올리지 않습니다/);
  });
});

describe('④ 후보 목록', () => {
  it('영업 계정의 발행 DM 중 AI 영업이 만들지 않은 것 · 최근 수정 순 · 주소는 단축 주소 규칙', async () => {
    h.query.mockImplementation(async () => ({ rows: [{ id: SUPPORT_DM, title: '금강제화 가을 신상', short_code: 'AbC123x', updated_at: '2026-10-01T00:00:00Z', sections: [], brand_kit: {}, first_page: null }] }));
    const items = await listImportableOutreachDms(OP);
    const [sql, params] = h.query.mock.calls[0];
    expect(String(sql)).toContain(`NOT ${OUTREACH_MADE_DM_SQL}`);
    expect(String(sql)).toContain("d.status = 'published'");
    expect(String(sql)).toContain('ORDER BY d.updated_at DESC');
    expect(params[0]).toBe(CO);
    expect(items[0]).toMatchObject({ id: SUPPORT_DM, title: '금강제화 가을 신상', cover: null });
    expect(items[0].dmUrl).toMatch(/AbC123x$/);
  });
});
