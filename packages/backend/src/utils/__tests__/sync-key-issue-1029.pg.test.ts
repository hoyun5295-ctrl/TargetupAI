// replaces: none
/**
 * 싱크에이전트 키 발급 CT — 실 PostgreSQL 판(★ 2026-10-29 · 설계서 docs/2026-10-29-sync-key-origin-required-design.md §5-2 · 뿌리 R29)
 *
 * 주장이 SQL 에 기댄다: 한 트랜잭션(키 UPDATE · 이전 발급 회수 · `cidr <<= cidr` 덮음 · 등록) · 회사 조건 조회(전체 300건 목록과 무관) ·
 * 등록 행을 출발지 판정(`evaluateMachineOrigin`)이 같은 서버 요청 꼴로 통과시키는가. 등급은 흉내(등급표 · 판정 함수는 진짜).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

const ROLES = new Map<string, string>();
vi.mock('../admin-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../admin-role')>()),
  fetchAdminRole: vi.fn(async (id: string | null | undefined) => (id && ROLES.get(id)) || 'support'),
}));
vi.mock('../audit-log', () => ({ recordAuditLog: vi.fn(async () => undefined) }));

import { issueSyncAgentKeys, listAgentOrigins, SYNC_KEY_ORIGIN_REASON } from '../sync-key-issue';
import { evaluateMachineOrigin } from '../geo-access';
import { verifySecret } from '../secret-hash';
import { recordAuditLog } from '../audit-log';

const SUPER = '00000000-0000-0000-0000-00000000a291';
const LEAD = '00000000-0000-0000-0000-00000000a292';
const SUPPORT = '00000000-0000-0000-0000-00000000a293';
const CO = '00000000-0000-0000-0000-0000000c1291';
const CO_RANGE = '00000000-0000-0000-0000-0000000c1292';
const CO_OTHER = '00000000-0000-0000-0000-0000000c1293';
const CO_DENY = '00000000-0000-0000-0000-0000000c1294';
const NO_CO = '00000000-0000-0000-0000-0000000c1299';

const keyOf = async (id: string) => (await query(`SELECT api_key, api_secret_hash, api_secret FROM companies WHERE id = $1::uuid`, [id])).rows[0];
const rowsOf = async (id: string) =>
  (await query(
    `SELECT host(cidr) || '/' || masklen(cidr) AS cidr, reason, is_active, approved_by::text AS approved_by, expires_at
       FROM access_origin_allowlist WHERE company_id = $1::uuid AND scope = 'company_agent' ORDER BY created_at, cidr`,
    [id],
  )).rows;
const addRow = (companyId: string, cidr: string, reason: string, expiresAt: string | null = null) =>
  query(
    `INSERT INTO access_origin_allowlist (id, scope, company_id, user_id, cidr, reason, approved_by, approved_at, expires_at, is_active, created_at)
     VALUES (gen_random_uuid(), 'company_agent', $1::uuid, NULL, $2::cidr, $3, NULL, NOW(), $4, true, NOW())`,
    [companyId, cidr, reason, expiresAt],
  );

beforeAll(async () => {
  ROLES.set(SUPER, 'super');
  ROLES.set(LEAD, 'lead');
  ROLES.set(SUPPORT, 'support');
  for (const id of [CO, CO_RANGE, CO_OTHER, CO_DENY]) await insertMinimalRow(pool, 'companies', { id });
});

describe('발급 = 키 + 출발지 한 번에', () => {
  it('성공 = 키 바뀜 · 시크릿 해시 맞음 · 옛 원문 칸 비움 · company_agent 발급 행 1 · 출발지 판정이 같은 서버 요청 꼴을 통과', async () => {
    await query(`UPDATE companies SET api_key = 'tk_old', api_secret = 'old-plain' WHERE id = $1::uuid`, [CO]);
    const r = await issueSyncAgentKeys({ companyId: CO, originIp: '::FFFF:203.0.113.10', actorUserId: SUPER });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ originIp: '203.0.113.10', originCidr: '203.0.113.10/32', originAdded: true, revokedOrigins: [] });
    const k = await keyOf(CO);
    expect(k.api_key).toBe(r.apiKey);
    expect(k.api_key).not.toBe('tk_old');
    expect(k.api_secret).toBeNull();
    expect(verifySecret(r.apiSecret, { hash: k.api_secret_hash, plain: null }).ok).toBe(true);
    expect(await rowsOf(CO)).toEqual([{ cidr: '203.0.113.10/32', reason: SYNC_KEY_ORIGIN_REASON, is_active: true, approved_by: SUPER, expires_at: null }]);
    for (const ip of ['203.0.113.10', '::ffff:203.0.113.10']) {
      expect(await evaluateMachineOrigin({ ip, companyId: CO, scope: 'company_agent' })).toMatchObject({ decision: 'allow', registered: true });
    }
  });

  it('같은 IP 다시 = 행 그대로 1 · 회수 0 · 키는 또 바뀜', async () => {
    const before = (await keyOf(CO)).api_key;
    const r = await issueSyncAgentKeys({ companyId: CO, originIp: '203.0.113.10', actorUserId: LEAD });
    expect(r).toMatchObject({ ok: true, originAdded: false, revokedOrigins: [] });
    expect((await keyOf(CO)).api_key).not.toBe(before);
    expect((await rowsOf(CO)).filter((x) => x.is_active)).toHaveLength(1);
  });

  it('다른 IP = 새 발급 행 활성 · 옛 발급 행 비활성(지우지 않음) · 손으로 등록한 다른 사유 행은 그대로 · 옛 IP 는 막힘', async () => {
    await addRow(CO, '198.51.100.7/32', '본사 백업 서버');
    const r = await issueSyncAgentKeys({ companyId: CO, originIp: '203.0.113.20', actorUserId: SUPER });
    expect(r).toMatchObject({ ok: true, originAdded: true, revokedOrigins: ['203.0.113.10/32'] });
    const rows = await rowsOf(CO);
    expect(rows.find((x) => x.cidr === '203.0.113.10/32')).toMatchObject({ is_active: false, reason: SYNC_KEY_ORIGIN_REASON });
    expect(rows.find((x) => x.cidr === '203.0.113.20/32')).toMatchObject({ is_active: true, reason: SYNC_KEY_ORIGIN_REASON });
    expect(rows.find((x) => x.cidr === '198.51.100.7/32')).toMatchObject({ is_active: true, reason: '본사 백업 서버' });
    expect(await evaluateMachineOrigin({ ip: '203.0.113.10', companyId: CO, scope: 'company_agent' })).toMatchObject({ registered: false });
    expect(vi.mocked(recordAuditLog).mock.calls.some(([a]) => a.action === 'access_origin_exception_revoked')).toBe(true);
    const keyAudit = vi.mocked(recordAuditLog).mock.calls.map(([a]) => a).filter((a) => a.action === 'sync_key_regenerate').pop();
    expect(keyAudit?.details).toEqual({ apiKeyTail: r.ok ? r.apiKey.slice(-4) : '', originCidr: '203.0.113.20/32', revokedOrigins: ['203.0.113.10/32'] });
    expect(JSON.stringify(vi.mocked(recordAuditLog).mock.calls)).not.toContain(r.ok ? r.apiSecret : '-');
  });

  it('만료 없는 대역 행이 덮으면 등록 생략 · 만료 있는 행만 덮으면 등록', async () => {
    await addRow(CO_RANGE, '203.0.113.0/24', '본사 대역');
    expect(await issueSyncAgentKeys({ companyId: CO_RANGE, originIp: '203.0.113.30', actorUserId: SUPER })).toMatchObject({ ok: true, originAdded: false });
    expect((await rowsOf(CO_RANGE)).map((x) => x.cidr)).toEqual(['203.0.113.0/24']);

    await addRow(CO_OTHER, '198.51.100.0/24', '출장', '2099-12-31T23:59:59+09:00');
    expect(await issueSyncAgentKeys({ companyId: CO_OTHER, originIp: '198.51.100.9', actorUserId: SUPER })).toMatchObject({ ok: true, originAdded: true });
    expect((await rowsOf(CO_OTHER)).map((x) => x.cidr).sort()).toEqual(['198.51.100.0/24', '198.51.100.9/32']);
  });

  it('회사 없음 = 404 · 출발지 행 0', async () => {
    expect(await issueSyncAgentKeys({ companyId: NO_CO, originIp: '203.0.113.40', actorUserId: SUPER })).toEqual({
      ok: false, status: 404, code: 'COMPANY_NOT_FOUND', error: '회사를 찾을 수 없습니다.',
    });
    expect(await rowsOf(NO_CO)).toEqual([]);
  });

  it('support · 미등록 직원 = 403 · 키 그대로 · 행 0 / 사설 IP = 400 · 키 그대로', async () => {
    await query(`UPDATE companies SET api_key = 'tk_deny' WHERE id = $1::uuid`, [CO_DENY]);
    for (const actor of [SUPPORT, '00000000-0000-0000-0000-00000000a29f', null]) {
      expect(await issueSyncAgentKeys({ companyId: CO_DENY, originIp: '203.0.113.50', actorUserId: actor })).toEqual({
        ok: false, status: 403, code: 'ORIGIN_GRANT_FORBIDDEN', error: '키 발급은 국외 접근 통제를 바꿀 수 있는 등급만 할 수 있습니다.',
      });
    }
    expect(await issueSyncAgentKeys({ companyId: CO_DENY, originIp: '192.168.0.10', actorUserId: SUPER })).toMatchObject({ ok: false, status: 400, code: 'ORIGIN_IP_INVALID' });
    expect((await keyOf(CO_DENY)).api_key).toBe('tk_deny');
    expect(await rowsOf(CO_DENY)).toEqual([]);
  });
});

describe('접속 허용 IP 조회 = 그 회사 것만 · 전체 300건 목록과 무관(설계서 §2-5)', () => {
  it('다른 회사 활성 행 301개가 더 최신이어도 그 회사 발급 행이 보이고 · 회수하면 빠지고 판정이 막힘으로', async () => {
    await query(
      `INSERT INTO access_origin_allowlist (id, scope, company_id, user_id, cidr, reason, approved_by, approved_at, expires_at, is_active, created_at)
       SELECT gen_random_uuid(), 'company_agent', $1::uuid, NULL, ('198.18.' || (g / 256) || '.' || (g % 256) || '/32')::cidr, '다른 회사', NULL,
              NOW() + interval '1 hour', NULL, true, NOW()
         FROM generate_series(1, 301) g`,
      [CO_OTHER],
    );
    await query(
      `INSERT INTO access_origin_allowlist (id, scope, company_id, user_id, cidr, reason, approved_by, approved_at, expires_at, is_active, created_at)
       VALUES (gen_random_uuid(), 'global', NULL, NULL, '203.0.113.99/32'::cidr, '대표 출장', NULL, NOW(), NOW() + interval '1 day', true, NOW())`,
    );
    const list = await listAgentOrigins(CO, LEAD);
    expect(list).toMatchObject({ canIssue: true, canRevoke: true });
    expect(typeof list.enforced).toBe('boolean');
    expect(list.origins.map((o) => o.ip).sort()).toEqual(['198.51.100.7', '203.0.113.20']);
    const issued = list.origins.find((o) => o.ip === '203.0.113.20')!;
    expect(issued).toMatchObject({ reason: SYNC_KEY_ORIGIN_REASON, expires_at: null, is_expired: false });

    // 국외 접근 통제 회수 문장(admin.ts DELETE /geo/exceptions/:id 와 같은 문장)
    await query(`UPDATE access_origin_allowlist SET is_active = false WHERE id = $1 AND is_active = true RETURNING id`, [issued.id]);
    expect((await listAgentOrigins(CO, LEAD)).origins.map((o) => o.ip)).toEqual(['198.51.100.7']);
    expect(await evaluateMachineOrigin({ ip: '203.0.113.20', companyId: CO, scope: 'company_agent' })).toMatchObject({ registered: false });
  });

  it('대역 행은 접두 길이와 함께 · 만료 지난 활성 행도 보이고 표시', async () => {
    await addRow(CO_RANGE, '198.51.100.64/26', '지난 출장', '2000-01-01T00:00:00+09:00');
    const ips = (await listAgentOrigins(CO_RANGE, SUPER)).origins;
    expect(ips.find((o) => o.ip === '203.0.113.0/24')).toMatchObject({ is_expired: false });
    expect(ips.find((o) => o.ip === '198.51.100.64/26')).toMatchObject({ is_expired: true });
  });

  it('support = 행 0 · 발급 · 회수 거짓', async () => {
    expect(await listAgentOrigins(CO, SUPPORT)).toMatchObject({ canIssue: false, canRevoke: false, origins: [] });
  });
});
