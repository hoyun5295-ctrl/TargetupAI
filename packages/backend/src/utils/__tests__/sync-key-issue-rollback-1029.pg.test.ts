// replaces: none
/**
 * 싱크에이전트 키 발급 CT — 등록이 실패하면 키 · 회수까지 전부 되돌린다(★ 2026-10-29 · 설계서 §2-1 3 · §5-2 · 실 PG)
 * 등록 CT 만 흉내로 실패시킨다(트랜잭션 · 키 UPDATE · 회수 문장은 진짜).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

vi.mock('../admin-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../admin-role')>()),
  fetchAdminRole: vi.fn(async () => 'super'),
}));
vi.mock('../audit-log', () => ({ recordAuditLog: vi.fn(async () => undefined) }));
vi.mock('../geo-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../geo-access')>()),
  insertOriginException: vi.fn(async () => { throw new Error('시험 · 등록 실패'); }),
}));

import { issueSyncAgentKeys, SYNC_KEY_ORIGIN_REASON } from '../sync-key-issue';
import { recordAuditLog } from '../audit-log';

const CO = '00000000-0000-0000-0000-0000000c12a1';

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await query(`UPDATE companies SET api_key = 'tk_keep' WHERE id = $1::uuid`, [CO]);
  await query(
    `INSERT INTO access_origin_allowlist (id, scope, company_id, user_id, cidr, reason, approved_by, approved_at, expires_at, is_active, created_at)
     VALUES (gen_random_uuid(), 'company_agent', $1::uuid, NULL, '203.0.113.10/32'::cidr, $2, NULL, NOW(), NULL, true, NOW())`,
    [CO, SYNC_KEY_ORIGIN_REASON],
  );
});

describe('등록 실패 = 전부 되돌림', () => {
  it('던짐 · 키 그대로 · 옛 발급 행 활성 그대로 · 감사 0', async () => {
    await expect(issueSyncAgentKeys({ companyId: CO, originIp: '203.0.113.20', actorUserId: '00000000-0000-0000-0000-00000000a2a1' })).rejects.toThrow('시험 · 등록 실패');
    expect((await query(`SELECT api_key FROM companies WHERE id = $1::uuid`, [CO])).rows[0].api_key).toBe('tk_keep');
    const rows = (await query(`SELECT host(cidr) AS ip, is_active FROM access_origin_allowlist WHERE company_id = $1::uuid`, [CO])).rows;
    expect(rows).toEqual([{ ip: '203.0.113.10', is_active: true }]);
    expect(recordAuditLog).not.toHaveBeenCalled();
  });
});
