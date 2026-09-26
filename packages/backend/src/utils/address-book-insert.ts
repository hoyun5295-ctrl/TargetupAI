/**
 * ★ CT: 주소록 연락처 적재 (★2026-09-26 한줄로 V2 R1-01)
 *
 * 옛 저장·추가 라우트는 연락처마다 INSERT를 하나씩 기다렸고 트랜잭션이 없었다
 * → 중간에 하나 실패하면 앞쪽만 저장된 채 오류(일부 저장) · 10만 건이면 왕복 10만 번.
 * 이제 unnest 배열 INSERT 한 문장 = 전부 저장하거나 전부 안 한다 · 왕복 1번.
 * 번호 정규화·중복·무효 판정은 호출부가 끝낸 행만 넘긴다(이 함수는 적재만).
 */
import { query } from '../config/database';

export interface AddressBookRow {
  phone: string;
  name: string | null;
  extra1: string | null;
  extra2: string | null;
  extra3: string | null;
}

export async function insertAddressBookContacts(input: {
  companyId: string;
  userId: string | null | undefined;
  groupName: string;
  rows: AddressBookRow[];
}): Promise<number> {
  const { rows } = input;
  if (rows.length === 0) return 0;
  const r = await query(
    `INSERT INTO address_books (company_id, user_id, group_name, phone, name, extra1, extra2, extra3)
     SELECT $1, $2, $3, x.phone, x.name, x.extra1, x.extra2, x.extra3
       FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS x(phone, name, extra1, extra2, extra3)`,
    [
      input.companyId,
      input.userId ?? null,
      input.groupName,
      rows.map((c) => c.phone),
      rows.map((c) => c.name),
      rows.map((c) => c.extra1),
      rows.map((c) => c.extra2),
      rows.map((c) => c.extra3),
    ],
  );
  return r.rowCount ?? rows.length;
}
