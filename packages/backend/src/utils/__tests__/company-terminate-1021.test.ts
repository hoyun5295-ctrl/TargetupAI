/**
 * 고객사 해지 = 한 길 (★ 2026-10-21 실사 준비 S3 · D-19)
 *   계약: 사유 필수 · 상태 + 계정 잠금 + 세션 끊기 + 해지 기록 = 한 트랜잭션(Codex 1R high) ·
 *         고객사 관리자에게 사유 안내 문자는 커밋 뒤(실패해도 해지 유지 · 결과는 안내 문자 기록) ·
 *         회사 수정 라우트는 「해지로 바꾸기」를 거부한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const tx: Array<{ sql: string; params: any[] }> = [];
const q: Array<{ sql: string; params: any[] }> = [];
const recorded: any[] = [];
let companyRow: any;
let campaignCount = '0';
let lockedRows: any[] = [];
const notices: Array<{ phone: string; text: string }> = [];
let noticeFails = false;
let txClient: any = null;

vi.mock('../../config/database', () => ({
  default: {
    connect: vi.fn(async () => {
      txClient = {
        query: vi.fn(async (sql: string, params: any[] = []) => {
          tx.push({ sql, params });
          if (sql.startsWith('SELECT company_name, status FROM companies')) return { rows: companyRow ? [companyRow] : [] };
          if (sql.includes('UPDATE users SET status')) return { rows: lockedRows };
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      return txClient;
    }),
  },
  query: vi.fn(async (sql: string, params: any[] = []) => {
    q.push({ sql, params });
    if (sql.includes('FROM campaigns')) return { rows: [{ count: campaignCount }] };
    return { rows: [] };
  }),
}));
vi.mock('../session-manager', () => ({ invalidateCompanySessions: vi.fn(async () => 3) }));
vi.mock('../audit-log', () => ({ recordAuditLog: vi.fn(async (input: any) => { recorded.push(input); }) }));
vi.mock('../account-action', () => ({
  restrictionReasonMessage: (r: string) => `문구:${r}`,
  sendRestrictionNotice: vi.fn(async (phone: string, text: string) => {
    if (noticeFails) throw new Error('SYSTEM_SMS_CALLBACK 없음');
    notices.push({ phone, text });
  }),
}));

import { terminateCompany } from '../company-terminate';
import { invalidateCompanySessions } from '../session-manager';

const sqls = () => tx.map((x) => x.sql);
const at = (needle: string) => sqls().findIndex((s) => s.includes(needle));
const terminatedRecord = () => {
  const row = tx.find((x) => x.sql.includes("'company_terminated'"));
  return row ? JSON.parse(row.params[2]) : null;
};
const noticeRecord = () => recorded.find((r) => r.action === 'company_termination_notice')?.details ?? null;

beforeEach(() => {
  tx.length = 0; q.length = 0; recorded.length = 0; notices.length = 0; noticeFails = false; campaignCount = '0'; txClient = null;
  companyRow = { company_name: '시험사', status: 'active' };
  lockedRows = [
    { id: 'u1', login_id: 'boss', user_type: 'admin', mfa_phone: '010-0000-0001', phone: '01000000009' },
    { id: 'u2', login_id: 'boss2', user_type: 'admin', mfa_phone: null, phone: '01000000001' },
    { id: 'u3', login_id: 'staff', user_type: 'user', mfa_phone: '01000000002', phone: null },
  ];
  vi.mocked(invalidateCompanySessions).mockClear();
});

describe('terminateCompany', () => {
  it('사유가 없거나 모르는 값 = 400 · DB 를 건드리지 않는다', async () => {
    for (const reason of [undefined, '', 'merge']) {
      const r = await terminateCompany({ companyId: 'co-1', reason });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('TERMINATE_REASON_REQUIRED');
    }
    expect(q).toHaveLength(0);
    expect(tx).toHaveLength(0);
  });

  it('진행 · 예약 캠페인이 있으면 400 · 트랜잭션 안 연다', async () => {
    campaignCount = '1';
    const r = await terminateCompany({ companyId: 'co-1', reason: 'contract_end' });
    expect(r.ok).toBe(false);
    expect(tx).toHaveLength(0);
  });

  it('이미 해지 = 400 · 되돌림 · 세션 · 고지 · 기록 없음', async () => {
    companyRow = { company_name: '시험사', status: 'terminated' };
    const r = await terminateCompany({ companyId: 'co-1', reason: 'contract_end' });
    expect(r.ok).toBe(false);
    expect(sqls()).toContain('ROLLBACK');
    expect(invalidateCompanySessions).not.toHaveBeenCalled();
    expect(notices).toHaveLength(0);
    expect(terminatedRecord()).toBeNull();
  });

  it('상태 · 잠금 · 세션 · 해지 기록 = 커밋 전 같은 연결 → 커밋 뒤 관리자 번호(같은 번호 한 번)에만 안내 → 안내 기록', async () => {
    const r = await terminateCompany({ companyId: 'co-1', reason: 'spam_report', note: '  신고 3건 확인 ', actorUserId: 'sa-1' });
    expect(r).toMatchObject({ ok: true, companyName: '시험사', lockedUsers: 3, killedSessions: 3, notified: 1, notifyFailed: 0 });
    const commit = sqls().indexOf('COMMIT');
    expect(sqls()[0]).toBe('BEGIN');
    expect(at("SET status = 'terminated'")).toBeLessThan(commit);
    expect(at('UPDATE users SET status')).toBeLessThan(commit);
    expect(at("'company_terminated'")).toBeGreaterThan(at('UPDATE users SET status'));
    expect(at("'company_terminated'")).toBeLessThan(commit);
    expect(invalidateCompanySessions).toHaveBeenCalledWith('co-1', txClient);
    expect(terminatedRecord()).toMatchObject({ companyName: '시험사', before: 'active', reason: 'spam_report', note: '신고 3건 확인', lockedUsers: 3, killedSessions: 3 });
    expect(tx.find((x) => x.sql.includes("'company_terminated'"))!.params[0]).toBe('sa-1');
    expect(q.some((x) => x.sql.includes('audit_logs'))).toBe(false);
    expect(notices).toEqual([{ phone: '01000000001', text: '문구:spam_report' }]);
    expect(noticeRecord()).toMatchObject({ reason: 'spam_report', notified: 1, notifyFailed: 0 });
  });

  it('트랜잭션 안에서 실패(해지 기록 INSERT 등) = 되돌리고 예외 · 고지 없음', async () => {
    const realConnect = (await import('../../config/database')).default.connect as any;
    realConnect.mockImplementationOnce(async () => ({
      query: vi.fn(async (sql: string) => {
        tx.push({ sql, params: [] });
        if (sql.startsWith('SELECT company_name, status FROM companies')) return { rows: [companyRow] };
        if (sql.includes('UPDATE users SET status')) return { rows: lockedRows };
        if (sql.includes("'company_terminated'")) throw new Error('insert failed');
        return { rows: [] };
      }),
      release: vi.fn(),
    }));
    await expect(terminateCompany({ companyId: 'co-1', reason: 'contract_end' })).rejects.toThrow('insert failed');
    expect(sqls()).toContain('ROLLBACK');
    expect(sqls()).not.toContain('COMMIT');
    expect(notices).toHaveLength(0);
  });

  it('안내 문자 실패 = 해지 유지 · 예외 없음 · 실패를 안내 기록에', async () => {
    noticeFails = true;
    const r = await terminateCompany({ companyId: 'co-1', reason: 'contract_end' });
    expect(r).toMatchObject({ ok: true, notified: 0, notifyFailed: 1 });
    expect(sqls()).toContain('COMMIT');
    expect(noticeRecord()).toMatchObject({ notified: 0, notifyFailed: 1, notifyErrors: ['SYSTEM_SMS_CALLBACK 없음'] });
  });

  it('관리자 번호가 없으면 no_phone 을 안내 기록에', async () => {
    lockedRows = [{ id: 'u3', login_id: 'staff', user_type: 'user', mfa_phone: '01000000002', phone: null }];
    const r = await terminateCompany({ companyId: 'co-1', reason: 'admin_action' });
    expect(r).toMatchObject({ ok: true, notified: 0, notifyFailed: 0 });
    expect(noticeRecord().notifyErrors).toEqual(['no_phone']);
  });
});

describe('세션 끊기 CT — 연결을 넘기면 그 연결로(해지 트랜잭션), 안 넘기면 지금처럼', () => {
  const src = readFileSync(join(__dirname, '..', 'session-manager.ts'), 'utf8').replace(/\r\n/g, '\n');
  it('기본값 = 풀 query · 본문은 넘겨받은 db 로', () => {
    const fn = src.slice(src.indexOf('export async function invalidateCompanySessions('));
    expect(fn.slice(0, 400)).toContain('= { query },');
    expect(fn.slice(0, 500)).toContain('const result = await db.query(');
  });
});

describe('라우트 — 해지는 한 길', () => {
  const ROUTES = join(__dirname, '..', '..', 'routes');
  const admin = readFileSync(join(ROUTES, 'admin.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('해지 버튼 라우트 = CT 만 부른다(사유 · 메모 전달)', () => {
    const del = admin.slice(admin.indexOf("router.delete('/companies/:id',"), admin.indexOf('// ===== 대시보드 카드 설정 API'));
    expect(del).toContain('terminateCompany({');
    expect(del).toContain('reason: req.body?.reason');
    expect(del).not.toMatch(/UPDATE companies|INSERT INTO audit_logs/);
  });

  it('회사 수정 라우트 = 해지 아닌 회사를 해지로 바꾸면 UPDATE 전에 되돌리고 400', () => {
    const put = admin.slice(admin.indexOf("router.put('/companies/:id', authenticate"));
    const guard = put.indexOf("if (status === 'terminated' && beforePlan.rows[0].status !== 'terminated') {");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(put.indexOf('status = COALESCE($5, status)'));
    const block = put.slice(guard, guard + 400);
    expect(block.indexOf("await planClient.query('ROLLBACK');")).toBeLessThan(block.indexOf('return res.status(400)'));
    expect(block).toContain("code: 'TERMINATE_VIA_BUTTON'");
  });

  it("routes/ 어디에도 companies 를 'terminated' 로 직접 바꾸는 SQL 이 없다", () => {
    for (const name of readdirSync(ROUTES).filter((n) => n.endsWith('.ts'))) {
      expect(readFileSync(join(ROUTES, name), 'utf8'), name).not.toMatch(/SET\s+status\s*=\s*'terminated'/);
    }
  });
});
