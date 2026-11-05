// replaces: none
/**
 * C103 F8 · 이의신청 「변경 없음」 → 같은 장 새 확인 메일 — 주소 그대로(routes/billing.ts) · 실 PostgreSQL
 * 설계서 docs/2026-11-05-intake-1104-fix-design.md §3 F8 · 기대값 = 설계서 문장을 손으로 따라간 값.
 *
 * 시험이 쥐는 것 = 메일 보내기(nodemailer) · 거래내역서 PDF 만들기 · 슈퍼관리자 문. 적재 · 발송 선점 · 전달 확정 SQL 은 원본 그대로 돈다.
 * 수신 주소 = 도달 불가(.invalid) · 메일 실발송 0.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID, randomBytes } from 'crypto';
import express from 'express';

const mail = vi.hoisted(() => ({ sent: [] as any[], mode: 'ok' as 'ok' | 'timeout' }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: any) => {
        mail.sent.push(m);
        if (mail.mode === 'timeout') { const e: any = new Error('ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; }
        return { accepted: [m.to], rejected: [] };
      },
    }),
  },
}));
vi.mock('../billing-pdf', async (orig) => ({
  ...(await orig<any>()),
  loadBillingStatementData: async () => ({ bil: { ai_credit_supply: 0, subtotal: 0 }, items: [] }),
  renderBillingStatementPdf: async () => ({ displayFilename: 't.pdf', pdfPath: `__no_such_${randomBytes(4).toString('hex')}.pdf` }),
}));
vi.mock('../billing-invoice-lines', async (orig) => ({
  ...(await orig<any>()),
  checkInvoiceLinesAgainstHeader: () => ({ ok: true, linesSum: 0, aiCreditSupply: 0, subtotal: 0, diff: 0 }),
}));
// 문 = 슈퍼관리자 통과(원본 모듈은 불러오지 않는다 · 시험 셸에 JWT 비밀 0)
vi.mock('../../middlewares/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { userId: '00000000-0000-0000-0000-00000000c108', userType: 'super_admin' }; next(); },
  requireSuperAdmin: (_req: any, _res: any, next: any) => next(),
  requireCompanyAdmin: (_req: any, _res: any, next: any) => next(),
}));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import billingRouter from '../../routes/billing';

let server: Server;
let base = '';

async function objectedSheet() {
  const co = randomUUID();
  const billing = randomUUID();
  const icId = randomUUID();
  const token = randomBytes(24).toString('hex');
  await insertMinimalRow(pool, 'companies', { id: co, company_name: '이의 해소 시험', name: '이의 해소 시험' });
  await insertMinimalRow(pool, 'billing_recipients', { company_id: co, doc_type: 'statement', email: `t-${randomBytes(3).toString('hex')}@example.invalid`, is_primary: true, is_active: true });
  await insertMinimalRow(pool, 'billings', { id: billing, company_id: co, scope: 'combined', billing_start: '2026-10-01', billing_end: '2026-10-31', total_amount: 11000, emailed_at: new Date(), emailed_to: 'old@example.invalid' });
  await insertMinimalRow(pool, 'invoice_confirmations', { id: icId, billing_id: billing, company_id: co, token, recipient_email: 'old@example.invalid', taxbill_status: 'objected', objection_at: new Date(), objection_text: '수량 확인 부탁', sent_at: new Date() });
  return { co, billing, icId, token };
}
const put = async (id: string) => {
  const r = await fetch(`${base}/confirmations/${id}/objection-resolve`, { method: 'PUT' });
  return { status: r.status, body: await r.json() as any };
};
const rowsOf = async (billing: string) => (await pool.query(
  `SELECT id, token, taxbill_status, superseded_at, objection_resolved_at FROM invoice_confirmations WHERE billing_id = $1 ORDER BY created_at`, [billing],
)).rows;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/billing', billingRouter);
  server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/billing`;
}, 120_000);
afterAll(() => new Promise<void>((done) => server.close(() => done())));

describe('F8 R6 · 이의신청 「변경 없음」(주소 · 실 PG)', () => {
  it('칸 존재(덤프 · 쓰기 0 이던 칸) = objection_resolved_at · superseded_at', async () => {
    const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'invoice_confirmations' AND column_name IN ('objection_resolved_at', 'superseded_at') ORDER BY 1`);
    expect(r.rows.map((x: any) => x.column_name)).toEqual(['objection_resolved_at', 'superseded_at']);
  });

  it('옛 행 = 해소 · 무효 → 같은 장 새 토큰 행 = 메일에 실린 토큰 · 자동 발행 대상(pending) · 발송 표시 새로 · 두 번째 = 409', async () => {
    mail.sent.length = 0; mail.mode = 'ok';
    const s = await objectedSheet();
    const r = await put(s.icId);
    expect(r).toMatchObject({ status: 200, body: { success: true, message: '확인 메일을 다시 보냈어요.' } });
    const rows = await rowsOf(s.billing);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: s.icId, token: s.token, taxbill_status: 'objected' });
    expect(rows[0].superseded_at).not.toBeNull();
    expect(rows[0].objection_resolved_at).not.toBeNull();
    expect(rows[1].superseded_at).toBeNull();
    expect(rows[1].token).not.toBe(s.token);
    expect(rows[1].taxbill_status).toBe('pending');
    expect(mail.sent).toHaveLength(1);
    expect(String(mail.sent[0].html)).toContain(`/api/invoice-view/${rows[1].token}`);
    expect(String(mail.sent[0].to)).toMatch(/@example\.invalid$/);
    const b = (await pool.query(`SELECT emailed_at, emailed_to FROM billings WHERE id = $1`, [s.billing])).rows[0];
    expect(b.emailed_at).not.toBeNull();
    expect(b.emailed_to).toBe(mail.sent[0].to);
    expect((await put(s.icId)).status).toBe(409);
    expect(mail.sent).toHaveLength(1);
  });

  it('발송 불확정(SMTP 응답 불명) = 성공이라 말하지 않는다 · 발송 표시는 남긴다 · 새 행 = 승격 0(manual_wait)', async () => {
    mail.sent.length = 0; mail.mode = 'timeout';
    const s = await objectedSheet();
    const r = await put(s.icId);
    expect(r).toMatchObject({ status: 200, body: { success: false, code: 'MAIL_UNCERTAIN' } });
    const rows = await rowsOf(s.billing);
    expect(rows[1]).toMatchObject({ taxbill_status: 'manual_wait', superseded_at: null });
    expect((await pool.query(`SELECT emailed_at FROM billings WHERE id = $1`, [s.billing])).rows[0].emailed_at).not.toBeNull();
    mail.mode = 'ok';
  });

  it('이의신청이 아닌 행 · 계산서가 발급 대기 이상인 장 = 409 · 메일 0', async () => {
    mail.sent.length = 0;
    const s = await objectedSheet();
    await pool.query(`UPDATE invoice_confirmations SET taxbill_status = 'pending' WHERE id = $1`, [s.icId]);
    expect((await put(s.icId)).status).toBe(409);
    const t = await objectedSheet();
    await insertMinimalRow(pool, 'taxbill_issues', { billing_id: t.billing, company_id: t.co, status: 'ready' });
    expect((await put(t.icId)).body.code).toBe('BILLING_TAXBILL_ALREADY_ISSUED');
    expect(mail.sent).toHaveLength(0);
    expect((await rowsOf(t.billing))[0].superseded_at).toBeNull();
    // ★ Codex 구현 1R high — 발행 실패(failed · 305 = 외부에 실존할 수 있음)도 막는다
    const f = await objectedSheet();
    await insertMinimalRow(pool, 'taxbill_issues', { billing_id: f.billing, company_id: f.co, status: 'failed' });
    expect((await put(f.icId)).body.code).toBe('BILLING_TAXBILL_ALREADY_ISSUED');
    expect(mail.sent).toHaveLength(0);
    expect((await rowsOf(f.billing))[0].superseded_at).toBeNull();
  });

  it('상태 탭(이의신청) = 살아 있는 행만 · 전체 = 이력 그대로', async () => {
    const s = await objectedSheet();
    await put(s.icId);
    const tab = await (await fetch(`${base}/confirmations?status=objected&start=2026-10-01&end=2026-10-31`)).json() as any;
    expect(tab.confirmations.some((x: any) => x.id === s.icId)).toBe(false);
    const all = await (await fetch(`${base}/confirmations?start=2026-10-01&end=2026-10-31`)).json() as any;
    expect(all.confirmations.find((x: any) => x.id === s.icId)?.objection_resolved_at).toBeTruthy();
  });
});
