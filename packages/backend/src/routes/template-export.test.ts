/**
 * 템플릿 엑셀 다운로드 라우트 3종 (2026-09-23 숭실원격평생교육원 요청)
 *
 * 못 박는 것:
 *   1. `/templates/export`·`/brand-templates/export` 가 `/:templateCode`·`/:templateKey` 에 잡히지 않고 엑셀을 돌려준다.
 *   2. 조회 범위는 로그인한 회사 하나다(쿼리 첫 인자 = 토큰의 companyId).
 *   3. 응답은 엑셀이 실제로 여는 파일이고, 원래 이름(filename*)은 한글 「종류_날짜.xlsx」다.
 */
import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../config/database', () => ({ query: vi.fn(), mysqlQuery: vi.fn(), pool: { connect: vi.fn() }, default: { connect: vi.fn() } }));
vi.mock('../middlewares/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { companyId: 'c-1', userId: 'u-1', userType: 'company_user' };
    next();
  },
  requireSuperAdmin: (_req: any, res: any) => res.status(403).json({ success: false }),
  requireCompanyAdmin: (_req: any, res: any) => res.status(403).json({ success: false }),
  requireUuidId: (_req: any, _res: any, next: any) => next('route'),
}));

import express from 'express';
import ExcelJS from 'exceljs';
import { query } from '../config/database';
import alimtalkRouter from './alimtalk';
import companiesRouter from './companies';

const q = query as unknown as ReturnType<typeof vi.fn>;

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/companies', companiesRouter);
  app.use('/api/alimtalk', alimtalkRouter);
  server = await new Promise<Server>((resolveServer) => {
    const s = app.listen(0, () => resolveServer(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

beforeEach(() => {
  q.mockReset();
});

/** `filename*=UTF-8''<접두사 인코딩>_YYYYMMDD.xlsx` */
function dispositionOf(prefix: string): RegExp {
  return new RegExp(`filename\\*=UTF-8''${encodeURIComponent(`${prefix}_`)}\\d{8}\\.xlsx`);
}

async function sheetOf(res: Response): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
  return wb.worksheets[0];
}

describe('GET /api/alimtalk/templates/export', () => {
  it('회사 범위로 조회해 엑셀을 돌려준다', async () => {
    q.mockResolvedValue({
      rows: [{ template_name: '수강신청 안내', template_code: 'T0001', status: 'APR', message_type: 'BA', emphasize_type: 'NONE', content: '본문' }],
    });
    const res = await fetch(`${base}/alimtalk/templates/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect(res.headers.get('content-disposition')).toMatch(dispositionOf('알림톡템플릿'));
    expect(q).toHaveBeenCalledTimes(1);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toMatch(/FROM kakao_templates t/);
    expect(params).toEqual(['c-1']);
    const ws = await sheetOf(res);
    expect(ws.getCell(5, 1).value).toBe('수강신청 안내');
    expect(ws.getCell(5, 6).value).toBe('승인');
  });
});

describe('GET /api/alimtalk/brand-templates/export', () => {
  it('회사 범위·ACTIVE 로 조회해 엑셀을 돌려준다', async () => {
    q.mockResolvedValue({ rows: [{ manage_name: '가을 할인', template_key: 'BRT_1', chat_bubble_type: 'TEXT', status: 'ACTIVE' }] });
    const res = await fetch(`${base}/alimtalk/brand-templates/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(dispositionOf('브랜드템플릿'));
    const [sql, params] = q.mock.calls[0];
    expect(sql).toMatch(/FROM brand_message_templates b/);
    expect(sql).toMatch(/b\.status = 'ACTIVE'/);
    expect(params).toEqual(['c-1']);
    const ws = await sheetOf(res);
    expect(ws.getCell(5, 1).value).toBe('가을 할인');
    expect(ws.getCell(5, 5).value).toBe('텍스트');
  });
});

describe('GET /api/companies/rcs-templates/export', () => {
  it('회사 범위로 조회해 엑셀을 돌려준다', async () => {
    q.mockResolvedValue({ rows: [{ template_name: '예약 확인', message_type: 'rcs_sms', status: 'approved' }] });
    const res = await fetch(`${base}/companies/rcs-templates/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(dispositionOf('RCS템플릿'));
    const [sql, params] = q.mock.calls[0];
    expect(sql).toMatch(/FROM rcs_templates WHERE company_id = \$1/);
    expect(params).toEqual(['c-1']);
    const ws = await sheetOf(res);
    expect(ws.getCell(5, 1).value).toBe('예약 확인');
    expect(ws.getCell(5, 3).value).toBe('승인');
  });

  it('템플릿이 0건이어도 머리행만 있는 엑셀을 돌려준다', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await fetch(`${base}/companies/rcs-templates/export`);
    expect(res.status).toBe(200);
    const ws = await sheetOf(res);
    expect(ws.getCell(4, 1).value).toBe('템플릿명');
  });
});
