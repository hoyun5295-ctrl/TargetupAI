/**
 * 주소록 저장·추가 = 한 문장으로 전부 저장하거나 전부 안 한다 (★2026-09-26 한줄로 V2 R1-01)
 *
 * 옛: 연락처마다 INSERT를 하나씩 기다렸고 트랜잭션이 없었다 → 중간에 하나 실패하면 앞쪽만 저장된 채 500(일부 저장).
 *     10만 건이면 왕복 10만 번.
 * 처방: 적재 CT 하나(insertAddressBookContacts) = unnest 배열 INSERT 한 문장(원자적 · 왕복 1번). 저장·추가 두 라우트가 같이 쓴다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn(async () => ({ rows: [], rowCount: 2 }));
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (queryMock as any)(...a) }));

import { insertAddressBookContacts } from '../address-book-insert';

describe('insertAddressBookContacts', () => {
  beforeEach(() => queryMock.mockClear());

  it('한 문장 · 열마다 배열 하나', async () => {
    const n = await insertAddressBookContacts({
      companyId: 'co', userId: 'u', groupName: 'g',
      rows: [
        { phone: '01000000001', name: '가', extra1: null, extra2: null, extra3: null },
        { phone: '01000000002', name: null, extra1: 'x', extra2: null, extra3: null },
      ],
    });
    expect(n).toBe(2);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = (queryMock.mock.calls[0] as any[]);
    expect(String(sql)).toContain('FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[])');
    expect(params[3]).toEqual(['01000000001', '01000000002']);
    expect(params[4]).toEqual(['가', null]);
  });

  it('빈 목록이면 DB에 가지 않는다', async () => {
    expect(await insertAddressBookContacts({ companyId: 'co', userId: 'u', groupName: 'g', rows: [] })).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('라우트 배선', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'routes', 'address-books.ts'), 'utf8');
  it('연락처별 INSERT가 남아 있지 않고 두 라우트가 적재 CT를 쓴다', () => {
    expect(src).not.toContain('INSERT INTO address_books');
    expect((src.match(/await insertAddressBookContacts\(/g) || []).length).toBe(2);
  });
});
