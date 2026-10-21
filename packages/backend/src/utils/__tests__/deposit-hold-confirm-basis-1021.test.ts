/**
 * 소명 없는 명의 확인 보류 건 = 「확인 근거」 없이는 승인되지 않는다 (★ 2026-10-21 실사 준비 S4 · D-17)
 *   계약: 보류 + 소명 없음 + 근거 10자 미만 = 400 · 잔액 · 원장 · 상태 그대로(되돌림).
 *         근거가 있으면 승인 · 관리자 메모에 근거. 소명이 있거나 보류가 아니면 지금과 같다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sqls: Array<{ sql: string; params: any[] }> = [];
let depositRow: any;

vi.mock('../../config/database', () => ({
  default: {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params: any[] = []) => {
        sqls.push({ sql, params });
        if (sql.includes('FROM deposit_requests dr')) return { rows: [depositRow] };
        if (sql.startsWith('SELECT company_name')) return { rows: [{ company_name: '시험사', billing_type: 'prepaid', balance: '1000' }] };
        if (sql.startsWith('UPDATE companies SET balance')) return { rows: [{ balance: '21000' }] };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    })),
  },
  query: vi.fn(),
}));

import { approveDepositRequestTx, HOLD_CONFIRM_BASIS_MIN } from '../deposit-approve';

const base = { id: 'd1', company_id: 'co-1', amount: '20000', depositor_name: '입금자', status: 'pending' };
const ran = (s: string) => sqls.some((x) => x.sql.includes(s));
const noteWritten = () => sqls.find((x) => x.sql.includes("SET status = 'confirmed'"))?.params[1];

beforeEach(() => { sqls.length = 0; });

describe('approveDepositRequestTx — 소명 없는 보류 건의 확인 근거', () => {
  it('보류 + 소명 없음 + 근거 없음 = 400 HOLD_CONFIRM_BASIS_REQUIRED · 잔액 안 건드리고 되돌린다', async () => {
    depositRow = { ...base, held_reason: '입금자명 불일치', explanation_note: null };
    const r = await approveDepositRequestTx({ depositRequestId: 'd1', adminId: 'a1', resolveHold: true, via: 'admin' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(400); expect(r.code).toBe('HOLD_CONFIRM_BASIS_REQUIRED'); }
    expect(ran('UPDATE companies SET balance')).toBe(false);
    expect(ran('INSERT INTO balance_transactions')).toBe(false);
    expect(ran('ROLLBACK')).toBe(true);
  });

  it('근거가 공백 · 10자 미만이면 같은 400', async () => {
    depositRow = { ...base, held_reason: '입금자명 불일치', explanation_note: '   ' };
    for (const basis of ['          ', '통화 확인함']) {
      const r = await approveDepositRequestTx({ depositRequestId: 'd1', adminId: 'a1', resolveHold: true, confirmBasis: basis, via: 'admin' });
      expect(r.ok).toBe(false);
    }
    expect(HOLD_CONFIRM_BASIS_MIN).toBe(10);
  });

  it('근거 10자 이상 = 승인 · 관리자 메모에 「[확인 근거]」 · 결과에 근거', async () => {
    depositRow = { ...base, held_reason: '입금자명 불일치', explanation_note: null };
    const basis = '담당자 통화로 대표자 개인 계좌 확인';
    const r = await approveDepositRequestTx({ depositRequestId: 'd1', adminId: 'a1', adminNote: '확인', resolveHold: true, confirmBasis: `  ${basis} `, via: 'admin' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.confirmBasis).toBe(basis);
    expect(noteWritten()).toBe(`확인 · [확인 근거] ${basis}`);
    expect(ran('COMMIT')).toBe(true);
  });

  it('소명이 있는 보류 건 = 근거 없이 지금처럼 승인 · 메모 그대로', async () => {
    depositRow = { ...base, held_reason: '입금자명 불일치', explanation_note: '대표자 개인 명의 입금입니다' };
    const r = await approveDepositRequestTx({ depositRequestId: 'd1', adminId: 'a1', adminNote: '확인', resolveHold: true, via: 'admin' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.confirmBasis).toBeNull();
    expect(noteWritten()).toBe('확인');
  });

  it('보류가 아닌 건 = 지금과 같다(근거 무시 · 메모 없으면 NULL)', async () => {
    depositRow = { ...base, held_reason: null, explanation_note: null };
    const r = await approveDepositRequestTx({ depositRequestId: 'd1', adminId: 'a1', confirmBasis: '보낼 일 없는 근거 열 글자 이상', via: 'admin' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.confirmBasis).toBeNull();
    expect(noteWritten()).toBeNull();
  });

  it('resolveHold 없는 보류 건(링크 입구) = 근거 판정 전에 종전 400 HOLD_CONFIRMATION_REQUIRED', async () => {
    depositRow = { ...base, held_reason: '입금자명 불일치', explanation_note: null };
    const r = await approveDepositRequestTx({ depositRequestId: 'd1', adminId: null, confirmBasis: '링크는 근거를 보내지 않는다', via: 'link' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('HOLD_CONFIRMATION_REQUIRED');
  });
});

describe('화면 입구 · 감사 기록 배선', () => {
  const admin = readFileSync(join(__dirname, '..', '..', 'routes', 'admin.ts'), 'utf8').replace(/\r\n/g, '\n');
  const route = admin.slice(admin.indexOf("router.put('/deposit-requests/:id/approve'"), admin.indexOf("router.put('/deposit-requests/:id/reject'"));
  it('승인 라우트가 근거를 CT에 넘기고, 보류 처리 기록에 CT가 확정한 근거를 남긴다', () => {
    expect(route).toContain('confirmBasis: req.body?.confirmBasis,');
    expect(route).toContain('confirmBasis: outcome.confirmBasis,');
  });
});
