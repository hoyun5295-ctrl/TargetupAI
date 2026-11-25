/**
 * ★ CT: 주소록 연락처 적재 (★2026-09-26 한줄로 V2 R1-01)
 *
 * 옛 저장·추가 라우트는 연락처마다 INSERT를 하나씩 기다렸고 트랜잭션이 없었다
 * → 중간에 하나 실패하면 앞쪽만 저장된 채 오류(일부 저장) · 10만 건이면 왕복 10만 번.
 * 이제 unnest 배열 INSERT 한 문장 = 전부 저장하거나 전부 안 한다 · 왕복 1번.
 * 번호 정규화·중복·무효 판정은 호출부가 끝낸 행만 넘긴다.
 *
 * ★ 2026-11-25 C163(뿌리 R108) 칸 폭 — 그룹 이름 · 이름 · 기타 칸이 폭을 넘으면 PG 가 문장 전체를 거절해(22001)
 *   「서버 오류」만 보였다(9/15 3분에 8번 · 7/10 · 9/14 번호 칸). 같은 한 문장 안에서 PG 가 보는 글자로 넘는 수를 세고(varcharFitsSql),
 *   넘는 것이 있으면 넣지 않고 무엇이 넘었는지 알려 준다(UserFacingError 400). 칸 폭 안이면 지금과 같은 행이 들어간다.
 */
import { query } from '../config/database';
import { ADDRESS_BOOK_WIDTH, PHONE_COLUMN_WIDTH, varcharFitsSql } from './column-width';
import { UserFacingError } from './http-error';

export interface AddressBookRow {
  phone: string;
  name: string | null;
  extra1: string | null;
  extra2: string | null;
  extra3: string | null;
}

const W = ADDRESS_BOOK_WIDTH;
const over = (expr: string, width: number) => `NOT ${varcharFitsSql(expr, width)}`;

/** 한 문장: 넘는 수를 세고(chk) · 넘는 것이 없을 때만 넣는다(ins) */
export const ADDRESS_BOOK_INSERT_SQL = `
  WITH x AS (
    SELECT * FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS x(phone, name, extra1, extra2, extra3)
  ), chk AS (
    SELECT ${over('$3::text', W.groupName)} AS long_group,
           COUNT(*) FILTER (WHERE ${over('x.phone', PHONE_COLUMN_WIDTH)})::int AS long_phone,
           COUNT(*) FILTER (WHERE ${over('x.name', W.name)})::int AS long_name,
           COUNT(*) FILTER (WHERE ${over('x.extra1', W.extra)} OR ${over('x.extra2', W.extra)} OR ${over('x.extra3', W.extra)})::int AS long_extra
      FROM x
  ), ins AS (
    INSERT INTO address_books (company_id, user_id, group_name, phone, name, extra1, extra2, extra3)
    SELECT $1::uuid, $2::uuid, $3::text, x.phone, x.name, x.extra1, x.extra2, x.extra3
      FROM x, chk
     WHERE NOT chk.long_group AND chk.long_phone = 0 AND chk.long_name = 0 AND chk.long_extra = 0
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM ins)::int AS inserted, chk.long_group, chk.long_phone, chk.long_name, chk.long_extra FROM chk`;

const TOO_LONG = 'ADDRESS_BOOK_TEXT_TOO_LONG';

export async function insertAddressBookContacts(input: {
  companyId: string;
  userId: string | null | undefined;
  groupName: string;
  rows: AddressBookRow[];
}): Promise<number> {
  const { rows } = input;
  if (rows.length === 0) return 0;   // 빈 묶음 · 중복만 있는 추가 = 지금처럼 DB 에 가지 않는다
  const r = await query(ADDRESS_BOOK_INSERT_SQL, [
    input.companyId,
    input.userId ?? null,
    input.groupName,
    rows.map((c) => c.phone),
    rows.map((c) => c.name),
    rows.map((c) => c.extra1),
    rows.map((c) => c.extra2),
    rows.map((c) => c.extra3),
  ]);
  const c = r.rows[0];
  if (c.long_group) throw new UserFacingError(400, TOO_LONG, `그룹 이름은 ${W.groupName}자까지 쓸 수 있습니다.`);
  if (c.long_phone > 0) throw new UserFacingError(400, TOO_LONG, `휴대폰 번호가 ${PHONE_COLUMN_WIDTH}자를 넘는 연락처가 ${c.long_phone}건 있습니다. 번호를 확인해 다시 저장해 주세요.`);
  if (c.long_name > 0) throw new UserFacingError(400, TOO_LONG, `이름이 ${W.name}자를 넘는 연락처가 ${c.long_name}건 있습니다. ${W.name}자 이내로 줄여 다시 저장해 주세요.`);
  if (c.long_extra > 0) throw new UserFacingError(400, TOO_LONG, `기타 칸이 ${W.extra}자를 넘는 연락처가 ${c.long_extra}건 있습니다. ${W.extra}자 이내로 줄여 다시 저장해 주세요.`);
  return c.inserted;
}
