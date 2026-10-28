// replaces: none
/**
 * 담당자 통지 받는 사람(pickOwnerContact) — 실 PostgreSQL 판(★ 2026-10-28 B-1028-1 · Codex 1R 테넌트 격리)
 *
 * 운영 문장을 글자 그대로 돌린다. 지키는 것 = 받는 사람은 그 회사 안에서만(만든 계정 → 관리자) · 다른 회사 계정이 만든 계정 칸에 있어도 그 사람에게 가지 않는다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { pickOwnerContact } from '../owner-contact';

const A = '00000000-0000-0000-0000-0000000000a1';
const B = '00000000-0000-0000-0000-0000000000b1';
const A_ADMIN = '00000000-0000-0000-0000-00000000a0a1';
const A_USER = '00000000-0000-0000-0000-00000000a0b1';
const A_NOPHONE = '00000000-0000-0000-0000-00000000a0c1';
const B_USER = '00000000-0000-0000-0000-00000000b0b1';

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: A });
  await insertMinimalRow(pool, 'companies', { id: B });
  await insertMinimalRow(pool, 'users', { id: A_ADMIN, company_id: A, user_type: 'admin', is_active: true, phone: '010-0000-0001', login_id: 't-a-admin' });
  await insertMinimalRow(pool, 'users', { id: A_USER, company_id: A, user_type: 'user', is_active: true, phone: '010 0000 0002', login_id: 't-a-user' });
  await insertMinimalRow(pool, 'users', { id: A_NOPHONE, company_id: A, user_type: 'user', is_active: true, phone: '02-000-0000', login_id: 't-a-nophone' });
  await insertMinimalRow(pool, 'users', { id: B_USER, company_id: B, user_type: 'user', is_active: true, phone: '010-0000-0003', login_id: 't-b-user' });
});

describe('받는 사람 = 그 회사 안 · 만든 계정 → 관리자', () => {
  it('만든 계정 번호가 맞으면 그 계정', async () => {
    expect(await pickOwnerContact(A, A_USER)).toEqual({ userId: A_USER, phone: '01000000002' });
  });
  it('만든 계정이 휴대폰 꼴이 아니면 관리자 · 만든 계정이 없으면 관리자', async () => {
    expect(await pickOwnerContact(A, A_NOPHONE)).toEqual({ userId: A_ADMIN, phone: '01000000001' });
    expect(await pickOwnerContact(A, null)).toEqual({ userId: A_ADMIN, phone: '01000000001' });
  });
  it('다른 회사 계정이 만든 계정 칸에 있어도 그 사람에게 가지 않는다(회사 A 관리자)', async () => {
    expect(await pickOwnerContact(A, B_USER)).toEqual({ userId: A_ADMIN, phone: '01000000001' });
  });
  it('그 회사에 관리자가 없고 만든 계정이 다른 회사 사람이면 null(다른 회사 사람으로 메우지 않는다)', async () => {
    expect(await pickOwnerContact(B, A_ADMIN)).toBeNull();
  });
});
