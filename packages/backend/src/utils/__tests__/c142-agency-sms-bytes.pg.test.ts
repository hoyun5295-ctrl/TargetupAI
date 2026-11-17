// replaces: none
/**
 * C142 — 대행 SMS 길이(뿌리 R68 길이 축) · 실 PostgreSQL 판(★ 2026-11-17 · 설계서 docs/2026-11-17-c142-staff-tickets-design.md §1 C · §4)
 *   새 SQL = 저장된 명단을 (row_no, id) 순 2,000줄씩 읽는 keyset(measureAgencyRequestSmsBytes) · DDL 0(있는 칸만).
 *   1. 쪽 경계 = 2,100줄 명단에서 가장 긴 문장이 마지막 쪽에 있어도 잡는다(메모리 명단 측정과 같은 값)
 *   2. 문안 고치기(editAgencyContentTx) = 넘는 글은 400 SMS_BYTES_OVER · 행 그대로 · 90 안 글은 길이 관문을 지난다
 *   3. LMS 접수 = 재지 않는다(null)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { measureAgencyRequestSmsBytes, measureAgencyMaxSmsBytes, agencySmsBytesOver, AGENCY_SMS_MEASURE_PAGE } from '../agency-send-preview';
import { editAgencyContentTx } from '../agency-send-change';
import { SMS_MAX_BYTES } from '../message-byte';

const CO = randomUUID();
const SMS = randomUUID();
const LMS = randomUUID();
const N = AGENCY_SMS_MEASURE_PAGE + 100;
const names: string[] = [];

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C142 대행' });
  for (const [id, type] of [[SMS, 'SMS'], [LMS, 'LMS']] as const) {
    await insertMinimalRow(pool, 'agency_send_requests', {
      id, company_id: CO, status: 'awaiting_approval', message_type: type, is_ad: false,
      current_content: '%이름%님 안내', original_content: '%이름%님 안내', var_mapping: JSON.stringify({ 이름: 'B' }),
      requested_at: new Date(Date.now() + 3 * 24 * 3600 * 1000), revision: 0, callback_number: '0212345678',
      ...(type === 'LMS' ? { subject: '안내' } : {}),
    });
  }
  // 앞 쪽은 짧은 이름 · 마지막 쪽 마지막 줄만 긴 이름(쪽을 넘겨 읽지 못하면 놓친다)
  for (let i = 1; i <= N; i += 1) names.push(i === N ? 'A'.repeat(95) : `가${i}`);
  await query(
    `INSERT INTO agency_send_recipients (request_id, row_no, phone, vars)
     SELECT $1::uuid, g, '0100000' || lpad(g::text, 4, '0'), jsonb_build_object('이름', ($2::text[])[g])
       FROM generate_series(1, $3::int) g`,
    [SMS, names, N],
  );
});

describe('C142 대행 SMS 길이(실 PG)', () => {
  it('1. 쪽 경계 — 마지막 쪽의 가장 긴 문장을 잡는다 · 메모리 명단 측정과 같은 값', async () => {
    const row = (await query(`SELECT * FROM agency_send_requests WHERE id = $1::uuid`, [SMS])).rows[0];
    const fromDb = await measureAgencyRequestSmsBytes(row, row.current_content);
    const inMemory = await measureAgencyMaxSmsBytes({
      companyId: CO, userId: null, content: row.current_content, isAd: false, adText: row.ad_text,
      recipients: names.map((n) => ({ vars: { 이름: n } })),
    });
    expect(fromDb).toBe(inMemory);
    expect(fromDb).toBeGreaterThan(SMS_MAX_BYTES);
    expect(await agencySmsBytesOver(row, row.current_content)).toBe(fromDb);
    // 그 줄이 없으면 90 안
    const shortOnly = await measureAgencyMaxSmsBytes({ companyId: CO, userId: null, content: row.current_content, isAd: false, adText: row.ad_text, recipients: names.slice(0, -1).map((n) => ({ vars: { 이름: n } })) });
    expect(shortOnly).toBeLessThanOrEqual(SMS_MAX_BYTES);
  });

  it('2. 문안 고치기 — 넘는 글 = 400 SMS_BYTES_OVER · 행 그대로 · 90 안 글 = 길이 관문 통과', async () => {
    const before = (await query(`SELECT current_content, revision, content_version FROM agency_send_requests WHERE id = $1::uuid`, [SMS])).rows[0];
    const over = await editAgencyContentTx({ requestId: SMS, companyId: CO, ownerUserId: null, revision: before.revision, change: { kind: 'text', content: '%이름%님 겨울 안내' }, via: 'screen' });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.code).toBe('SMS_BYTES_OVER');
      expect(over.status).toBe(400);
      expect(over.error).toMatch(/가장 긴 문장이 \d+바이트/);
    }
    const after = (await query(`SELECT current_content, revision, content_version FROM agency_send_requests WHERE id = $1::uuid`, [SMS])).rows[0];
    expect(after).toEqual(before);
    // 변수 없는 짧은 글 = 길이 관문을 지난다(뒤 관문 = 회신번호 등은 이 시험 밖 · 길이 막힘 코드가 아니면 된다)
    const fits = await editAgencyContentTx({ requestId: SMS, companyId: CO, ownerUserId: null, revision: before.revision, change: { kind: 'text', content: '이번 주 안내 드려요' }, via: 'screen' });
    if (!fits.ok) expect(fits.code).not.toBe('SMS_BYTES_OVER');
    // 같은 이름 칸이라도 긴 이름 줄이 문장을 90 넘게 만들면 막힌다(변수 있는 글은 명단 전원 기준)
    const withVar = await editAgencyContentTx({ requestId: SMS, companyId: CO, ownerUserId: null, revision: before.revision, change: { kind: 'text', content: '%이름%님' }, via: 'screen' });
    expect(!withVar.ok && withVar.code).toBe('SMS_BYTES_OVER');
  });

  it('3. LMS 접수 = 재지 않는다', async () => {
    const row = (await query(`SELECT * FROM agency_send_requests WHERE id = $1::uuid`, [LMS])).rows[0];
    expect(await agencySmsBytesOver(row, 'X'.repeat(300))).toBe(null);
  });
});
