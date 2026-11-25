// replaces: none
/**
 * ★ 2026-11-25 대행 접수 실수 잡기 · 한 파일 여러 건 — 새 SQL 실 PostgreSQL 판(설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §5 · §7).
 *   새 SQL = ① 문안 항목 값이 빈 수신자 수(loadAgencyEmptyVarRows) ② 메일 3층 중복 대조에 제목 · 이미지 이름(findAcceptedEmailDuplicate)
 *   ③ 승인 판정의 빈 자리 확인(approveAgencyRequestTx · 사전 · 잠금 구간). 새 칸 · 새 표 0.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID, createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { loadAgencyEmptyVarRows } from '../agency-send-intake';
import { findAcceptedEmailDuplicate } from '../agency-send-mail-worker';
import { approveAgencyRequestTx } from '../agency-send-approve';
import { emailDupTimeSql } from '../agency-send-state';

const CO = randomUUID();
const OWNER = randomUUID();
const WHEN = new Date(Date.now() + 3 * 86400_000).toISOString();

const request = async (over: Record<string, unknown> = {}) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'agency_send_requests', {
    id, company_id: CO, created_by: OWNER, callback_number: '0212345678', manager_phone: '01000000001',
    current_content: '안내', original_content: '안내', requested_at: WHEN, phone_column: '휴대폰', ...over,
  });
  return id;
};
const recipient = async (requestId: string, rowNo: number, phone: string, vars: Record<string, unknown>) => {
  await pool.query(
    `INSERT INTO agency_send_recipients (request_id, row_no, phone, vars) VALUES ($1::uuid, $2, $3, $4::jsonb)`,
    [requestId, rowNo, phone, JSON.stringify(vars)],
  );
};

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1111', login_id: `t-slip-${OWNER.slice(0, 8)}` });
});

describe('① 문안 항목 값이 빈 수신자 수(실 PG)', () => {
  it('항목마다 빈 값 · 공백 · 키 없음을 센다 · 빈 행이 없는 항목은 빠진다', async () => {
    const id = await request({ current_content: '%매장%만의 행사 %이름%님' });
    await recipient(id, 1, '01000000011', { 매장: '여수교동점', 이름: '가' });
    await recipient(id, 2, '01000000012', { 매장: '', 이름: '나' });
    await recipient(id, 3, '01000000013', { 매장: '  ', 이름: '다' });
    await recipient(id, 4, '01000000014', { 이름: '라' });
    await recipient(id, 5, '01000000015', { 매장: null, 이름: '마' });
    expect(await loadAgencyEmptyVarRows({ id, current_content: '%매장%만의 행사 %이름%님' })).toEqual([{ name: '매장', count: 4 }]);
  });
  it('항목이 없는 문안 = 조회 0', async () => {
    expect(await loadAgencyEmptyVarRows({ id: randomUUID(), current_content: '항목 없는 문안' })).toEqual([]);
  });
});

describe('② 메일 3층 중복 대조 = 제목 · 이미지 바이트 지문까지(실 PG)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slip-1125-'));
  const save = (name: string, bytes: string) => { const fp = path.join(tmp, name); fs.writeFileSync(fp, bytes); return fp; };
  const digest = (bytes: string) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  it('같은 그림 = 이름이 달라도 중복 · 그림이 다르면 이름이 같아도 중복 아님 · 제목이 다르면 중복 아님', async () => {
    const content = `생일 축하 ${randomUUID().slice(0, 6)}`;
    const id = await request({ current_content: content, original_content: content, subject: '생일', status: 'received', mms_image_paths: JSON.stringify([save('a.jpg', 'PT-그림')]), mms_image_names: JSON.stringify(['PT.jpg']) });
    await recipient(id, 1, '01000000021', {});
    await recipient(id, 2, '01000000022', {});
    const base = { companyId: CO, requestedAtIso: WHEN, content, phones: ['01000000021', '01000000022'], subject: '생일', dupTimeSql: emailDupTimeSql(false),
      recipients: [{ phone: '01000000021', callback: '0212345678', vars: {} }, { phone: '01000000022', callback: '0212345678', vars: {} }] };
    expect(await findAcceptedEmailDuplicate({ ...base, imageDigests: [digest('PT-그림')], imageNames: ['다른이름.jpg'] })).toBe(true);
    expect(await findAcceptedEmailDuplicate({ ...base, imageDigests: [digest('GD-그림')], imageNames: ['PT.jpg'] })).toBe(false);
    expect(await findAcceptedEmailDuplicate({ ...base, imageDigests: [], imageNames: [] })).toBe(false);
    expect(await findAcceptedEmailDuplicate({ ...base, subject: '다른 제목', imageDigests: [digest('PT-그림')], imageNames: ['PT.jpg'] })).toBe(false);
  });
  it('저장 파일을 못 읽는 옛 행 = 원본 이름 차례로 보수 대조 · 이미지 없는 행 = 이미지 없는 접수와 중복', async () => {
    const content = `안내 ${randomUUID().slice(0, 6)}`;
    const gone = await request({ current_content: content, original_content: content, status: 'received', mms_image_paths: JSON.stringify([path.join(tmp, '없는파일.jpg')]), mms_image_names: JSON.stringify(['옛.jpg']) });
    await recipient(gone, 1, '01000000031', {});
    const base = { companyId: CO, requestedAtIso: WHEN, content, phones: ['01000000031'], subject: '', dupTimeSql: emailDupTimeSql(false), recipients: [{ phone: '01000000031', callback: '0212345678', vars: {} }] };
    expect(await findAcceptedEmailDuplicate({ ...base, imageDigests: ['x'], imageNames: ['옛.jpg'] })).toBe(true);
    expect(await findAcceptedEmailDuplicate({ ...base, imageDigests: ['x'], imageNames: ['새.jpg'] })).toBe(false);
    const content2 = `안내 ${randomUUID().slice(0, 6)}`;
    const plain = await request({ current_content: content2, original_content: content2, status: 'received' });
    await recipient(plain, 1, '01000000032', {});
    expect(await findAcceptedEmailDuplicate({ ...base, content: content2, phones: ['01000000032'], recipients: [{ phone: '01000000032', callback: '0212345678', vars: {} }], imageDigests: [], imageNames: [] })).toBe(true);
  });
  it('받는 사람 문안 값 · 회신번호만 바로잡은 재전송 = 중복 아님(Codex 구현 1R)', async () => {
    const content = `%매장%만의 행사 ${randomUUID().slice(0, 6)}`;
    const id = await request({ current_content: content, original_content: content, status: 'received' });
    await pool.query(`INSERT INTO agency_send_recipients (request_id, row_no, phone, vars, callback) VALUES ($1::uuid, 1, '01000000041', '{"매장":"OOO"}'::jsonb, '0212345678')`, [id]);
    const base = { companyId: CO, requestedAtIso: WHEN, content, phones: ['01000000041'], subject: '', dupTimeSql: emailDupTimeSql(false), imageDigests: [], imageNames: [] };
    expect(await findAcceptedEmailDuplicate({ ...base, recipients: [{ phone: '01000000041', callback: '0212345678', vars: { 매장: 'OOO' } }] })).toBe(true);
    expect(await findAcceptedEmailDuplicate({ ...base, recipients: [{ phone: '01000000041', callback: '0212345678', vars: { 매장: '여수교동점' } }] })).toBe(false);
    expect(await findAcceptedEmailDuplicate({ ...base, recipients: [{ phone: '01000000041', callback: '0299999999', vars: { 매장: 'OOO' } }] })).toBe(false);
  });
  it('고정 발신번호만 바로잡은 재전송 = 중복 아님(행 회신번호가 비면 대표 번호로 나간다 · Codex 구현 2R)', async () => {
    const content = `고정 번호 ${randomUUID().slice(0, 6)}`;
    const id = await request({ current_content: content, original_content: content, status: 'received', callback_number: '02-1234-5678' });
    await recipient(id, 1, '01000000051', {});
    const base = { companyId: CO, requestedAtIso: WHEN, content, phones: ['01000000051'], subject: '', dupTimeSql: emailDupTimeSql(false), imageDigests: [], imageNames: [] };
    expect(await findAcceptedEmailDuplicate({ ...base, recipients: [{ phone: '01000000051', callback: '0212345678', vars: {} }] })).toBe(true);
    expect(await findAcceptedEmailDuplicate({ ...base, recipients: [{ phone: '01000000051', callback: '0287654321', vars: {} }] })).toBe(false);
  });
  it('행 순서만 바뀐 같은 명단 = 중복 · 번호별 발신번호를 서로 바꾼 명단 = 중복 아님(대표 번호 = 첫 행이라 순서로 바뀐다 · Codex 구현 3R)', async () => {
    const content = `매장 번호 ${randomUUID().slice(0, 6)}`;
    // 열 방식: 대표 번호 = 첫 행 번호(0211110001) · 행마다 회신번호
    const id = await request({ current_content: content, original_content: content, status: 'received', callback_number: '0211110001' });
    await pool.query(
      `INSERT INTO agency_send_recipients (request_id, row_no, phone, vars, callback) VALUES ($1::uuid, 1, '01000000061', '{}'::jsonb, '0211110001'), ($1::uuid, 2, '01000000062', '{}'::jsonb, '0222220002')`,
      [id],
    );
    const base = { companyId: CO, requestedAtIso: WHEN, content, phones: ['01000000061', '01000000062'], subject: '', dupTimeSql: emailDupTimeSql(false), imageDigests: [], imageNames: [] };
    // 다시 온 메일은 행 순서가 반대(대표 번호가 0222220002 가 됨) · 받는 사람마다 나가는 번호는 같다
    expect(await findAcceptedEmailDuplicate({ ...base, recipients: [
      { phone: '01000000062', callback: '0222220002', vars: {} }, { phone: '01000000061', callback: '0211110001', vars: {} },
    ] })).toBe(true);
    expect(await findAcceptedEmailDuplicate({ ...base, recipients: [
      { phone: '01000000061', callback: '0222220002', vars: {} }, { phone: '01000000062', callback: '0211110001', vars: {} },
    ] })).toBe(false);
  });
});

describe('③ 승인 판정의 빈 자리 확인(실 PG)', () => {
  it('빈 자리가 있는 문안 = 확인 없으면 409 BLANK_ACK_REQUIRED(상태 그대로) · 확인하면 그 사유로는 막지 않는다', async () => {
    const id = await request({ current_content: '"OOO점만의 행사!"', original_content: '"OOO점만의 행사!"', status: 'awaiting_approval', approval_requested_at: new Date().toISOString() });
    const rev = Number((await pool.query(`SELECT revision FROM agency_send_requests WHERE id = $1::uuid`, [id])).rows[0].revision);
    const no = await approveAgencyRequestTx({ requestId: id, revision: rev, companyId: CO, approvedBy: OWNER, via: 'screen' });
    expect(no.ok).toBe(false);
    if (!no.ok) {
      expect(no.status).toBe(409);
      expect(no.code).toBe('BLANK_ACK_REQUIRED');
      expect(no.error).toContain('OOO점');
    }
    expect((await pool.query(`SELECT status FROM agency_send_requests WHERE id = $1::uuid`, [id])).rows[0].status).toBe('awaiting_approval');
    const yes = await approveAgencyRequestTx({ requestId: id, revision: rev, companyId: CO, approvedBy: OWNER, via: 'screen', blankAck: true });
    expect(yes.ok ? 'ok' : yes.code).not.toBe('BLANK_ACK_REQUIRED');
  });
  it('빈 자리가 없는 문안 = 확인값과 무관(빈 자리 사유 0)', async () => {
    const id = await request({ current_content: '%이름%님 생일 축하', original_content: '%이름%님 생일 축하', status: 'awaiting_approval', approval_requested_at: new Date().toISOString() });
    const rev = Number((await pool.query(`SELECT revision FROM agency_send_requests WHERE id = $1::uuid`, [id])).rows[0].revision);
    const out = await approveAgencyRequestTx({ requestId: id, revision: rev, companyId: CO, approvedBy: OWNER, via: 'screen' });
    expect(out.ok ? 'ok' : out.code).not.toBe('BLANK_ACK_REQUIRED');
  });
});
