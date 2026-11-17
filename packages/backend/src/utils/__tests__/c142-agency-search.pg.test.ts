// replaces: none
/**
 * C142 — 슈퍼관리자 대행 조회(남지현 접수 · 뿌리 R73 넓힘) · 실 PostgreSQL 판(★ 2026-11-17 · 설계서 §1 D · §4 K-D1)
 *   새 SQL 둘 = GET /api/admin/agency-send 의 서버 조건(검색어 · 접수구분 · 날짜 기준 · 상한 + 잘림) · readRecentRejectedIntakes(검색어 · 받은 날짜) · DDL 0.
 *   라우트는 인증 미들웨어를 건너뛰고 마지막 처리 함수만 부른다(가짜 요청 · 응답).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

// 인증 미들웨어는 시험 대상이 아니다(라우트의 마지막 처리 함수만 부른다) · 원본은 JWT_SECRET 이 없으면 프로세스를 끝낸다
vi.mock('../../middlewares/auth', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { authenticate: pass, requireSuperAdmin: pass, requireUuidId: () => pass, requireBestLayoutViewer: pass, requireAdminArea: () => pass };
});
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import adminRouter from '../../routes/admin';
import { readRecentRejectedIntakes } from '../agency-send-intake';

const CO = randomUUID();
const OTHER = randomUUID();
const USER = randomUUID();
const OLD = randomUUID();
const NEW = randomUUID();
const ELSE = randomUUID();

async function listVia(q: Record<string, string>): Promise<{ status: number; body: any }> {
  const layer: any = (adminRouter as any).stack.find((l: any) => l.route?.path === '/agency-send' && l.route.methods?.get);
  const handle = layer.route.stack[layer.route.stack.length - 1].handle;
  let status = 200;
  let body: any = null;
  const res: any = { status(s: number) { status = s; return res; }, json(b: any) { body = b; return res; } };
  await handle({ query: q, user: { userType: 'super_admin' } } as any, res);
  return { status, body };
}
const ids = (b: any) => (b.requests || []).map((r: any) => r.id).sort();

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C142검색회사' });
  await insertMinimalRow(pool, 'companies', { id: OTHER, company_name: '다른회사' });
  await insertMinimalRow(pool, 'users', { id: USER, company_id: CO, user_type: 'admin', is_active: true, login_id: 'c142-search', name: '남시험' });
  // OLD = 접수 2026-01-05 00:30 서울(= 01-04 15:30 UTC · 서울 날짜 경계) · 발송일 2026-01-10
  await insertMinimalRow(pool, 'agency_send_requests', {
    id: OLD, company_id: CO, created_by: USER, status: 'expired', source: 'email', file_name: 'old.xlsx',
    current_content: '오래된 겨울 문안 100% 할인', original_content: '오래된 겨울 문안 100% 할인',
    created_at: '2026-01-04T15:30:00Z', requested_at: '2026-01-10T02:00:00Z',
  });
  await insertMinimalRow(pool, 'agency_send_requests', {
    id: NEW, company_id: CO, created_by: USER, status: 'awaiting_approval', file_name: 'new.xlsx',
    current_content: '새 문안', original_content: '새 문안', created_at: '2026-11-17T01:00:00Z', requested_at: '2026-11-20T02:30:00Z',
  });
  await insertMinimalRow(pool, 'agency_send_requests', {
    id: ELSE, company_id: OTHER, status: 'cancelled', file_name: 'else.xlsx',
    current_content: '다른 회사 문안', original_content: '다른 회사 문안', created_at: '2026-01-05T03:00:00Z', requested_at: '2026-01-06T03:00:00Z',
  });
  for (const [uidl, co, from, at] of [
    ['c142-a', CO, 'staff@c142.example', '2026-11-16T16:10:00Z'],   // 서울 11-17 01:10
    ['c142-b', OTHER, 'x@else.example', '2026-11-16T14:50:00Z'],    // 서울 11-16 23:50
  ] as const) {
    await insertMinimalRow(pool, 'agency_send_email_intake', {
      mailbox: 'c142', uidl, message_hash: uidl, from_email: from, company_id: co, status: 'rejected', reason: 'unregistered', claimed_at: at,
    });
  }
});

describe('C142 대행 조회(실 PG)', () => {
  it('검색어 = 고객사 · 신청자 · 아이디 · 파일명 · 문안 · 200건 상한 안이면 잘림 0', async () => {
    const all = await listVia({});
    expect(all.status).toBe(200);
    expect(all.body.truncated).toBe(false);
    expect(ids(await listVia({ q: 'C142검색' }).then((r) => r.body))).toEqual([NEW, OLD].sort());
    expect(ids(await listVia({ q: '남시험' }).then((r) => r.body))).toEqual([NEW, OLD].sort());
    expect(ids(await listVia({ q: 'c142-search' }).then((r) => r.body))).toEqual([NEW, OLD].sort());
    expect(ids(await listVia({ q: 'old.xlsx' }).then((r) => r.body))).toEqual([OLD]);
    expect(ids(await listVia({ q: '겨울 문안' }).then((r) => r.body))).toEqual([OLD]);   // 문안으로만 맞는 접수
    // LIKE 특수문자 = 글자 그대로(100% = 「100%」 · 아무 글자나가 아님)
    expect(ids(await listVia({ q: '100%' }).then((r) => r.body))).toEqual([OLD]);
    expect(ids(await listVia({ q: '_' }).then((r) => r.body))).toEqual([]);
  });

  it('날짜 = 서울 날짜 경계 · 접수일 / 발송일 · 접수구분 · 상태와 함께', async () => {
    expect(ids((await listVia({ date_by: 'created', from: '2026-01-05', to: '2026-01-05' })).body)).toEqual([ELSE, OLD].sort());
    expect(ids((await listVia({ date_by: 'created', from: '2026-01-04', to: '2026-01-04' })).body)).toEqual([]);
    expect(ids((await listVia({ date_by: 'requested', from: '2026-01-10', to: '2026-01-10' })).body)).toEqual([OLD]);
    expect(ids((await listVia({ date_by: 'requested', from: '2026-11-20' })).body)).toEqual([NEW]);
    expect(ids((await listVia({ source: 'email' })).body)).toEqual([OLD]);
    expect(ids((await listVia({ source: 'screen', q: 'C142' })).body)).toEqual([NEW]);   // 접수구분 없음 = 화면
    expect(ids((await listVia({ status: 'expired', q: 'C142' })).body)).toEqual([OLD]);
    // 날짜 모양이 아니면 거르지 않는다(SQL 에 넣지 않는다)
    expect((await listVia({ from: "2026-01-01' OR 1=1 --" })).status).toBe(200);
  });

  it('메일 반려 검색 = 회사명 · 보낸 주소 · 받은 날짜(서울) · 거르지 않으면 최근 20 그대로', async () => {
    const plain = await readRecentRejectedIntakes();
    expect(plain.truncated).toBe(false);
    expect(plain.rows.map((r) => r.uidl)).toEqual(expect.arrayContaining(['c142-a', 'c142-b']));
    expect((await readRecentRejectedIntakes({ q: 'C142검색' })).rows.map((r) => r.uidl)).toEqual(['c142-a']);
    expect((await readRecentRejectedIntakes({ q: 'else.example' })).rows.map((r) => r.uidl)).toEqual(['c142-b']);
    expect((await readRecentRejectedIntakes({ from: '2026-11-17', to: '2026-11-17' })).rows.map((r) => r.uidl)).toEqual(['c142-a']);
    expect((await readRecentRejectedIntakes({ from: '2026-11-16', to: '2026-11-16' })).rows.map((r) => r.uidl)).toEqual(['c142-b']);
    expect((await readRecentRejectedIntakes({ q: '%' })).rows).toEqual([]);
    const n = Number((await query(`SELECT count(*)::int AS n FROM agency_send_email_intake`)).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
