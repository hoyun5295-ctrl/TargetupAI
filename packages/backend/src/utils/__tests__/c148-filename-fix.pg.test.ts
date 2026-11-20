// replaces: none
/**
 * C148 §7 D 옛 첨부 이름 깨짐 고쳐 쓰기 — 실 PostgreSQL(★ 2026-11-20 · 설계서 docs/2026-11-20-c148-staff-tickets-three-design.md §7-1 · §7-3)
 *   원장 블록 C148-DML-1 글자 그대로를 바깥 트랜잭션 안에서 돌린다(운영 = psql -1) · 이름 = 시험 값
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import { restoreUploadFileName } from '../mms-image-fit';

/** multer 가 latin1 로 읽던 꼴(10-19 이전 저장값) */
const broken = (name: string) => Buffer.from(name, 'utf8').toString('latin1');
const CO = randomUUID();
const USER = randomUUID();
const run = async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(ledgerBlockSql('C148-DML-1'));
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
};

const NFD = '가나.png'.normalize('NFD');   // macOS 분해형(조합용 자모)
const ids = { mBroken: randomUUID(), mOk: randomUUID(), mLatin: randomUUID(), mNull: randomUUID(), rMixed: randomUUID(), rNotArray: randomUUID(), aBroken: randomUUID(), aNfd: randomUUID(), aCafe: randomUUID(), aDouble: randomUUID(), aAscii: randomUUID() };

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: USER, company_id: CO, user_type: 'admin', is_active: true, login_id: `t-c148d-${CO.slice(0, 6)}` });
  const mgr = (id: string, name: string | null) => insertMinimalRow(pool, 'sender_managers', {
    id, company_id: CO, status: 'approved',
    authorization_doc: name === null ? null : { originalName: name, storedName: 's.pdf', filePath: '/x/s.pdf', fileSize: 1, uploadedAt: '2026-09-01T00:00:00Z' },
  });
  await mgr(ids.mBroken, broken('(인비토)위임장.pdf'));
  await mgr(ids.mOk, '정상 위임장.pdf');
  await mgr(ids.mLatin, 'Â².png');
  await mgr(ids.mNull, null);
  await insertMinimalRow(pool, 'sender_registrations', {
    id: ids.rMixed, company_id: CO, requested_by: USER, phone: '02-1888-0001', number_type: 'other', status: 'approved',
    // node-postgres 는 JS 배열을 PG 배열 꼴로 보낸다 → jsonb 칸에는 JSON 글로
    documents: JSON.stringify([
      { type: 'telecom_cert', originalName: 'ok.pdf', storedName: 'a.pdf', extra: 1 },
      { type: 'consent_form', originalName: broken('사용 동의서.pdf'), storedName: 'b.pdf', extra: 2 },
      { type: 'employment_cert', originalName: null, storedName: 'c.pdf' },
    ]),
  });
  await insertMinimalRow(pool, 'sender_registrations', { id: ids.rNotArray, company_id: CO, requested_by: USER, phone: '02-1888-0002', number_type: 'company', status: 'pending', documents: { odd: true } });
  const asset = (id: string, filename: string) => insertMinimalRow(pool, 'cdp_assets', { id, company_id: CO, kind: 'uploaded', url: `/x/${id}`, filename, origin: 'brand' });
  await asset(ids.aBroken, broken('포스터.png'));
  await asset(ids.aNfd, broken(NFD));
  await asset(ids.aCafe, 'café.png');
  await asset(ids.aDouble, broken(broken('한글.png')));   // 두 번 깨진 값 = 한 겹 풀어도 한글 아님 = 그대로
  await asset(ids.aAscii, 'poster_final.png');
});

describe('C148-DML-1 옛 첨부 이름 고쳐 쓰기(실 PG)', () => {
  it('깨진 이름만 한글로 · 정상 · 라틴 · NULL · 배열 아님 · 두 번 깨짐 = 그대로 · 배열 순서 · 다른 키 유지 · 백업 = 바뀐 행 · 두 번째 실행 = 바뀜 0', async () => {
    await run();
    const m = async (id: string) => (await pool.query(`SELECT authorization_doc FROM sender_managers WHERE id = $1::uuid`, [id])).rows[0].authorization_doc;
    expect((await m(ids.mBroken)).originalName).toBe('(인비토)위임장.pdf');
    expect((await m(ids.mBroken)).storedName).toBe('s.pdf');
    expect((await m(ids.mOk)).originalName).toBe('정상 위임장.pdf');
    expect((await m(ids.mLatin)).originalName).toBe('Â².png');
    expect(await m(ids.mNull)).toBeNull();
    const docs = (await pool.query(`SELECT documents FROM sender_registrations WHERE id = $1::uuid`, [ids.rMixed])).rows[0].documents;
    expect(docs.map((d: any) => d.originalName)).toEqual(['ok.pdf', '사용 동의서.pdf', null]);
    expect(docs.map((d: any) => d.storedName)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(docs[1].extra).toBe(2);
    expect((await pool.query(`SELECT documents FROM sender_registrations WHERE id = $1::uuid`, [ids.rNotArray])).rows[0].documents).toEqual({ odd: true });
    const a = async (id: string) => (await pool.query(`SELECT filename FROM cdp_assets WHERE id = $1::uuid`, [id])).rows[0].filename;
    expect(await a(ids.aBroken)).toBe('포스터.png');
    expect(await a(ids.aNfd)).toBe(NFD);
    expect(await a(ids.aCafe)).toBe('café.png');
    expect(await a(ids.aDouble)).toBe(broken(broken('한글.png')));
    expect(await a(ids.aAscii)).toBe('poster_final.png');

    const mine = async () => (await pool.query(
      `SELECT src, row_id::text AS row_id, old_value FROM c148_filename_fix_backup WHERE row_id = ANY($1::uuid[]) ORDER BY src, row_id`,
      [Object.values(ids)],
    )).rows;
    const b1 = await mine();
    expect(b1.map((r: any) => `${r.src}:${r.row_id}`).sort()).toEqual([`asset:${ids.aBroken}`, `asset:${ids.aNfd}`, `manager:${ids.mBroken}`, `registration:${ids.rMixed}`].sort());
    expect(b1.find((r: any) => r.row_id === ids.mBroken).old_value.originalName).toBe(broken('(인비토)위임장.pdf'));

    // DML 과 앱 업로드 복원(restoreUploadFileName · 10-19 부터 새 업로드)이 깨진 한글 이름에서 같은 결과(두 규칙이 갈리면 옛 줄 · 새 줄 이름이 다르게 남는다)
    for (const name of ['(인비토)위임장.pdf', '사용 동의서.pdf', '포스터.png', NFD]) expect(restoreUploadFileName(broken(name))).toBe(name);
    expect(restoreUploadFileName('café.png')).toBe('café.png');

    // 두 번째 실행 = 바뀜 0 · 백업 그대로(처음 값)
    await run();
    expect((await m(ids.mBroken)).originalName).toBe('(인비토)위임장.pdf');
    expect(await a(ids.aNfd)).toBe(NFD);
    expect(await mine()).toEqual(b1);
  });
});
