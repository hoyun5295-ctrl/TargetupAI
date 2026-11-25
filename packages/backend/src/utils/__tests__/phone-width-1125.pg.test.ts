// replaces: none
/**
 * C163 번호 칸 폭 판정 한 곳(뿌리 R108) · 실 PostgreSQL 판
 *   (★ 2026-11-25 · 설계서 docs/2026-11-25-phone-width-root-design.md §6 · 접수 = 1125 18:35 직접발송 적재 22001)
 *   0. 판정 = PG: 같은 글자를 실제 varchar 칸에 넣은 결과 = fitsVarchar = varcharFitsSql · 폭 상수 = information_schema(R108-4).
 *   1. 적재 라우트: 정상 명단 = 응답 글자까지 그대로 · 넘는 번호 · 회신 행만 빠진다(효과 = 적재 표 재조회) · 배열 칸 = 400.
 *   2. 주소록 저장 · 추가: 넘는 번호 = 무효 · 넘는 이름 = 400 · 넣은 행 0 · 중복만 있는 추가 = 그대로 성공.
 *   3. 대행 접수 코어: 넘는 번호 수신자만 빠지고 접수 1건 · 담당자가 모두 넘으면 400(DB 에 닿기 전).
 * 라우터 손잡이를 직접 부른다(c160 · c143 과 같은 꼴) · 번호 = 도달 불가 합성 010-0000-xxxx · 넘는 값 = 숫자 21개.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../middlewares/auth', () => ({ authenticate: (_req: any, _res: any, next: any) => next() }));
vi.mock('../../config/database', async (orig) => ({
  ...(await orig<any>()),
  mysqlQuery: vi.fn(async () => []),
}));
vi.mock('../../config/defaults', async (orig) => {
  const real: any = await orig();
  return { ...real, redis: { set: vi.fn(async () => 'OK'), get: vi.fn(async () => null), del: vi.fn(async () => 1) } };
});

import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import campaignsRouter from '../../routes/campaigns';
import addressBooksRouter from '../../routes/address-books';
import { PHONE_COLUMN_WIDTH, ADDRESS_BOOK_WIDTH, fitsVarchar, varcharFitsSql } from '../column-width';
import { createRequestCore, MANAGER_PHONE_TOO_LONG_ERROR } from '../agency-send-intake';

const CO = randomUUID();
const USER = randomUUID();
const LONG = '0'.repeat(21);            // 숫자 21개 = 번호 칸(20)을 넘는다 · 휴대폰 아님(도달 불가)
const ph = (n: number) => `0100000${String(n).padStart(4, '0')}`;

function handle(router: any, method: 'post', path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route.methods?.[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
async function call(router: any, path: string, body: any, params: Record<string, string> = {}) {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: any) { out.body = b; return res; } };
  await handle(router, 'post', path)({ params, query: {}, body, user: { companyId: CO, userId: USER, userType: 'admin' } }, res);
  return out;
}
const stagedRows = async (sid: string) =>
  (await pool.query(`SELECT phone, callback FROM campaign_send_staging WHERE staging_id = $1::uuid ORDER BY id`, [sid])).rows;

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C163 번호 칸 폭 시험' });
  await insertMinimalRow(pool, 'users', { id: USER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1163', login_id: 't-1125-c163-width' });
});

describe('0 판정 = PG(R108-4)', () => {
  it('폭 상수 = information_schema', async () => {
    const w = await pool.query(
      `SELECT table_name || '.' || column_name AS k, character_maximum_length AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND ((table_name = 'campaign_send_staging' AND column_name IN ('phone', 'callback'))
           OR (table_name = 'agency_send_recipients' AND column_name IN ('phone', 'callback'))
           OR (table_name = 'unsubscribes' AND column_name = 'phone')
           OR (table_name = 'address_books' AND column_name IN ('phone', 'group_name', 'name', 'extra1', 'extra2', 'extra3')))`);
    const m = Object.fromEntries(w.rows.map((r: any) => [r.k, Number(r.n)]));
    for (const k of ['campaign_send_staging.phone', 'campaign_send_staging.callback', 'agency_send_recipients.phone', 'agency_send_recipients.callback', 'unsubscribes.phone', 'address_books.phone']) {
      expect(m[k], k).toBe(PHONE_COLUMN_WIDTH);
    }
    expect(m['address_books.group_name']).toBe(ADDRESS_BOOK_WIDTH.groupName);
    expect(m['address_books.name']).toBe(ADDRESS_BOOK_WIDTH.name);
    for (const k of ['address_books.extra1', 'address_books.extra2', 'address_books.extra3']) expect(m[k], k).toBe(ADDRESS_BOOK_WIDTH.extra);
  });

  it('같은 글자를 실제 varchar(20) 칸에 넣은 결과 = fitsVarchar = varcharFitsSql', async () => {
    const samples = [
      '0'.repeat(20), LONG, `${'0'.repeat(20)}     `, `${'0'.repeat(18)} 1   `, `${'0'.repeat(19)} 1   `, `${'0'.repeat(20)}\t`,
      '😀'.repeat(20), '😀'.repeat(21), '가'.repeat(20), '가'.repeat(21), '', ' '.repeat(40), '010-0000-1111',
    ];
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('CREATE TEMP TABLE w20 (v varchar(20)) ON COMMIT DROP');
      for (const s of samples) {
        await c.query('SAVEPOINT p');
        let pgAccepts = true;
        try { await c.query('INSERT INTO w20 (v) VALUES ($1)', [s]); } catch { pgAccepts = false; }
        await c.query('ROLLBACK TO SAVEPOINT p');
        const sqlSays = (await c.query(`SELECT ${varcharFitsSql('$1::text', 20)} AS ok`, [s])).rows[0].ok;
        expect({ s, js: fitsVarchar(s, 20), sql: sqlSays }).toEqual({ s, js: pgAccepts, sql: pgAccepts });
      }
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});

describe('1 직접발송 · 알림톡 적재(/direct-send/stage)', () => {
  it('정상 명단 = 응답 본문 그대로(skipped 키 없음) · 행 그대로', async () => {
    const out = await call(campaignsRouter, '/direct-send/stage', { recipients: [{ phone: ph(1), name: '가' }, { phone: ph(2), callback: '0212345678' }] });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ success: true, stagingId: out.body.stagingId, staged: 2 });
    expect(await stagedRows(out.body.stagingId)).toEqual([{ phone: ph(1), callback: null }, { phone: ph(2), callback: '0212345678' }]);
  });

  it('넘는 번호 · 넘는 회신번호 행만 빠지고(짝 그대로) 뺀 수를 알린다 · 끝 공백 회신은 PG 처럼 잘려 들어간다', async () => {
    const out = await call(campaignsRouter, '/direct-send/stage', {
      recipients: [
        { phone: ph(11), callback: '0212345678' },
        { phone: LONG },
        { phone: ph(12), callback: '0'.repeat(21) },
        { phone: ph(13), callback: `${'1'.repeat(20)}   ` },
        { phone: ph(14), callback: null },
      ],
    });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ success: true, stagingId: out.body.stagingId, staged: 3, skipped: 2 });
    expect(await stagedRows(out.body.stagingId)).toEqual([
      { phone: ph(11), callback: '0212345678' }, { phone: ph(13), callback: '1'.repeat(20) }, { phone: ph(14), callback: null },
    ]);
  });

  it('덧붙이는 묶음(stagingId)에서 행이 모두 빠져도 200 · 앞 묶음 행 그대로', async () => {
    const first = await call(campaignsRouter, '/direct-send/stage', { recipients: [{ phone: ph(21) }] });
    const next = await call(campaignsRouter, '/direct-send/stage', { stagingId: first.body.stagingId, recipients: [{ phone: LONG }] });
    expect(next.status).toBe(200);
    expect(next.body).toEqual({ success: true, stagingId: first.body.stagingId, staged: 0, skipped: 1 });
    expect(await stagedRows(first.body.stagingId)).toEqual([{ phone: ph(21), callback: null }]);
  });

  it('배열 · 객체 칸 = 400(수신자와 칸이 어긋나지 않게) · 넣은 행 0', async () => {
    const before = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE company_id = $1`, [CO])).rows[0].n);
    const out = await call(campaignsRouter, '/direct-send/stage', { recipients: [{ phone: ph(31), callback: ['0212345678'] }, { phone: ph(32) }] });
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ success: false, code: 'RECIPIENT_FORMAT', error: '수신자 목록 형식이 올바르지 않습니다.' });
    const after = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE company_id = $1`, [CO])).rows[0].n);
    expect(after).toBe(before);
  });
});

describe('2 주소록 저장 · 추가', () => {
  const stored = async (g: string) => (await pool.query(`SELECT phone, name FROM address_books WHERE company_id = $1 AND group_name = $2 ORDER BY phone`, [CO, g])).rows;

  it('저장 = 넘는 번호는 10자 미만처럼 빠지고 나머지는 그대로 저장', async () => {
    const out = await call(addressBooksRouter, '/', { groupName: 'C163-a', contacts: [{ phone: ph(41), name: '가' }, { phone: LONG, name: '나' }] });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ success: true, message: '1건 저장 완료', insertCount: 1 });
    expect(await stored('C163-a')).toEqual([{ phone: ph(41), name: '가' }]);
  });

  it('저장 = 이름이 50자를 넘으면 400 그 문장 · 넣은 행 0', async () => {
    const out = await call(addressBooksRouter, '/', { groupName: 'C163-b', contacts: [{ phone: ph(42), name: '가'.repeat(51) }, { phone: ph(43), name: '나' }] });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ success: false, code: 'ADDRESS_BOOK_TEXT_TOO_LONG', error: '이름이 50자를 넘는 연락처가 1건 있습니다. 50자 이내로 줄여 다시 저장해 주세요.' });
    expect(await stored('C163-b')).toEqual([]);
  });

  it('추가 = 넘는 번호는 무효 N건 · 중복만 있으면 지금처럼 성공(DB 판정 없음)', async () => {
    const a = await call(addressBooksRouter, '/:groupName/append', { contacts: [{ phone: ph(44), name: '다' }, { phone: LONG }] }, { groupName: 'C163-a' });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ success: true, appendedCount: 1, duplicateCount: 0, invalidCount: 1 });
    const d = await call(addressBooksRouter, '/:groupName/append', { contacts: [{ phone: ph(44) }] }, { groupName: 'C163-a' });
    expect(d.body).toMatchObject({ success: true, appendedCount: 0, duplicateCount: 1, invalidCount: 0 });
    expect((await stored('C163-a')).map((r: any) => r.phone)).toEqual([ph(41), ph(44)]);
  });
});

describe('3 대행 접수 코어', () => {
  const pre = { registeredSet: new Set(['0500000000']), window: { startHour: 0, endHour: 24 } as { startHour: number | null; endHour: number | null } };
  const base = {
    messageType: 'SMS', content: 'C163 번호 칸 폭 시험', callbackNumber: '0500000000',
    requestedAt: new Date(Date.now() + 300 * 60000).toISOString(),
  };

  it('넘는 번호 수신자만 빠지고 접수 1건(효과 = 명단 표 재조회)', async () => {
    const r: any = await createRequestCore({ companyId: CO, userId: USER }, {
      ...base, managerPhones: [ph(51)],
      recipients: [{ phone: ph(52), vars: {} }, { phone: LONG, vars: {} }, { phone: ph(53), vars: {} }],
    }, undefined, pre);
    expect(r.ok).toBe(true);
    const rows = (await pool.query(`SELECT phone FROM agency_send_recipients WHERE request_id = $1 ORDER BY row_no`, [r.request.id])).rows;
    expect(rows.map((x: any) => x.phone)).toEqual([ph(52), ph(53)]);
  });

  it('적은 담당자 번호가 모두 넘으면 400(DB 에 닿기 전) · 하나라도 맞으면 그 번호만', async () => {
    const bad: any = await createRequestCore({ companyId: CO, userId: USER }, { ...base, managerPhones: [LONG], recipients: [{ phone: ph(54), vars: {} }] }, undefined, pre);
    expect(bad).toMatchObject({ ok: false, status: 400, error: MANAGER_PHONE_TOO_LONG_ERROR });
    const ok: any = await createRequestCore({ companyId: CO, userId: USER }, { ...base, managerPhones: [LONG, ph(55)], recipients: [{ phone: ph(56), vars: {} }] }, undefined, pre);
    expect(ok.ok).toBe(true);
    expect(ok.request.manager_phones).toEqual([ph(55)]);
  });
});
