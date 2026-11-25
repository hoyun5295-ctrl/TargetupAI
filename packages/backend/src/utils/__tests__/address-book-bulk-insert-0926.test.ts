/**
 * 주소록 저장·추가 = 한 문장으로 전부 저장하거나 전부 안 한다 (★2026-09-26 한줄로 V2 R1-01)
 *
 * 옛: 연락처마다 INSERT를 하나씩 기다렸고 트랜잭션이 없었다 → 중간에 하나 실패하면 앞쪽만 저장된 채 500(일부 저장).
 *     10만 건이면 왕복 10만 번.
 * 처방: 적재 CT 하나(insertAddressBookContacts) = unnest 배열 INSERT 한 문장(원자적 · 왕복 1번). 저장·추가 두 라우트가 같이 쓴다.
 * ★ 2026-11-25 C163(R108) — 같은 한 문장이 칸 폭을 넘는 수를 세고 넘는 것이 없을 때만 넣는다(실제 PG 판정 = phone-width-1125.pg).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn(async () => ({ rows: [{ inserted: 2, long_group: false, long_phone: 0, long_name: 0, long_extra: 0 }], rowCount: 1 }));
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (queryMock as any)(...a) }));

import { insertAddressBookContacts } from '../address-book-insert';

describe('insertAddressBookContacts', () => {
  beforeEach(() => queryMock.mockClear());

  it('한 문장 · 열마다 배열 하나 · 넣은 수 = 문장이 돌려준 수', async () => {
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
    expect(String(sql)).toContain('INSERT INTO address_books (company_id, user_id, group_name, phone, name, extra1, extra2, extra3)');
    expect(params[3]).toEqual(['01000000001', '01000000002']);
    expect(params[4]).toEqual(['가', null]);
  });

  it('빈 목록이면 DB에 가지 않는다', async () => {
    expect(await insertAddressBookContacts({ companyId: 'co', userId: 'u', groupName: 'g', rows: [] })).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('칸 폭을 넘는 것이 있으면 넣지 않고 400 사용자 오류(무엇이 넘었는지)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ inserted: 0, long_group: false, long_phone: 0, long_name: 3, long_extra: 0 }], rowCount: 1 });
    await expect(insertAddressBookContacts({
      companyId: 'co', userId: 'u', groupName: 'g', rows: [{ phone: '01000000001', name: 'x', extra1: null, extra2: null, extra3: null }],
    })).rejects.toMatchObject({ status: 400, code: 'ADDRESS_BOOK_TEXT_TOO_LONG', message: '이름이 50자를 넘는 연락처가 3건 있습니다. 50자 이내로 줄여 다시 저장해 주세요.' });
    queryMock.mockResolvedValueOnce({ rows: [{ inserted: 0, long_group: true, long_phone: 0, long_name: 0, long_extra: 0 }], rowCount: 1 });
    await expect(insertAddressBookContacts({
      companyId: 'co', userId: 'u', groupName: 'g', rows: [{ phone: '01000000001', name: 'x', extra1: null, extra2: null, extra3: null }],
    })).rejects.toMatchObject({ status: 400, message: '그룹 이름은 100자까지 쓸 수 있습니다.' });
  });
});
