/**
 * 주소록 번호 앞자리 0 복원 (2026-09-14 박성용 접수 cmu0wlphl02fxjnlucoe2mbh1)
 *
 * 못 박는 것:
 *   1. 엑셀·CSV가 떨어뜨린 휴대폰 앞 0(10자리 1[016789]…)은 저장할 때 붙여서 저장한다.
 *   2. 이미 0 없이 저장된 번호는 조회(불러오기)·다운로드에서 붙여서 내보낸다(DB 무변경).
 *   3. 기존 그룹에 추가할 때 0 없는 옛 번호와 0 있는 새 번호는 같은 번호로 보고 중복 제외한다.
 *   4. 이미 0이 있는 번호·길이가 맞지 않는 번호는 건드리지 않는다.
 *
 * 테스트 번호는 형식만 맞는 도달 불가 값(010-0000-000x)만 쓴다.
 */
import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../config/database', () => ({ query: vi.fn(), mysqlQuery: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../middlewares/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { companyId: 'c-1', userId: 'u-1', userType: 'company_admin' };
    next();
  },
}));
vi.mock('../utils/privacy-audit', () => ({ logPrivacyExport: vi.fn(async () => undefined) }));

import express from 'express';
import * as XLSX from 'xlsx';
import { query } from '../config/database';
import addressBooksRouter from './address-books';

const q = query as unknown as ReturnType<typeof vi.fn>;

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/address-books', addressBooksRouter);
  server = await new Promise<Server>((resolveServer) => {
    const s = app.listen(0, () => resolveServer(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/address-books`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

/** SQL 종류별 응답. storedPhones = 그룹에 이미 저장된 번호(0 없는 옛 저장분 포함) */
function mockDb(storedPhones: string[] = []) {
  q.mockImplementation(async (sql: string) => {
    if (/COUNT\(\*\)::int AS cnt FROM address_books\s+WHERE company_id = \$1 AND group_name/i.test(sql)) {
      return { rows: [{ cnt: storedPhones.length }] };
    }
    if (/COUNT\(\*\)::int AS cnt FROM address_books WHERE company_id = \$1$/i.test(sql.trim())) {
      return { rows: [{ cnt: 0 }] };
    }
    if (/SELECT COUNT\(\*\) FROM address_books/i.test(sql)) return { rows: [{ count: '0' }] };
    if (/SELECT phone FROM address_books/i.test(sql)) return { rows: storedPhones.map((phone) => ({ phone })) };
    if (/SELECT id, phone, name/i.test(sql)) {
      return { rows: storedPhones.map((phone, i) => ({ id: `id-${i}`, phone, name: null, extra1: null, extra2: null, extra3: null })) };
    }
    if (/SELECT phone, name, extra1/i.test(sql)) {
      return { rows: storedPhones.map((phone) => ({ phone, name: '', extra1: '', extra2: '', extra3: '' })) };
    }
    return { rows: [], rowCount: 1 };
  });
}

const insertedPhones = () =>
  q.mock.calls
    .filter(([sql]: any[]) => /INSERT INTO address_books/i.test(String(sql)))
    // ★ 2026-09-26 R1-01 — 적재 CT가 한 문장(unnest 배열)으로 싣는다: $4 = 번호 배열
    .flatMap(([, params]: any[]) => (Array.isArray(params[3]) ? params[3] : [params[3]]));

async function post(path: string, body: any) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

describe('주소록 저장 — 엑셀이 떨어뜨린 앞 0을 붙여 저장한다', () => {
  beforeEach(() => { q.mockReset(); mockDb(); });

  it('0 빠진 휴대폰 10자리는 0을 붙여 저장한다', async () => {
    const { data } = await post('', { groupName: 'g', contacts: [{ phone: '1000000001' }, { phone: 1000000002 }] });
    expect(data.success).toBe(true);
    expect(insertedPhones()).toEqual(['01000000001', '01000000002']);
  });

  it('이미 0이 있는 번호와 하이픈 번호는 숫자만 남기고 그대로 둔다', async () => {
    await post('', { groupName: 'g', contacts: [{ phone: '010-0000-0003' }, { phone: '0212345678' }] });
    expect(insertedPhones()).toEqual(['01000000003', '0212345678']);
  });
});

describe('주소록 추가 — 0 없는 옛 번호와 0 있는 새 번호는 같은 번호다', () => {
  beforeEach(() => { q.mockReset(); });

  it('옛 저장분 1000000004가 있으면 01000000004 추가는 중복으로 제외된다', async () => {
    mockDb(['1000000004']);
    const { data } = await post('/g/append', { contacts: [{ phone: '01000000004' }, { phone: '1000000005' }] });
    expect(data.duplicateCount).toBe(1);
    expect(insertedPhones()).toEqual(['01000000005']);
  });
});

describe('주소록 조회·다운로드 — 옛 저장분도 0을 붙여 내보낸다', () => {
  beforeEach(() => { q.mockReset(); mockDb(['1000000006', '01000000007']); });

  it('그룹 조회(불러오기) 응답 번호에 0이 붙는다', async () => {
    const res = await fetch(`${base}/g`);
    const data = await res.json();
    expect(data.contacts.map((c: any) => c.phone)).toEqual(['01000000006', '01000000007']);
  });

  it('엑셀 다운로드의 번호 열에 0이 붙는다', async () => {
    const res = await fetch(`${base}/g/export`);
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows.map((r) => String(r['번호']))).toEqual(['01000000006', '01000000007']);
  });
});
