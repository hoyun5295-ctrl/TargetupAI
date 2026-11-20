// replaces: none
/**
 * C148 T3 기타명의 무선 발신번호 = 명의자 본인인증 + 1인 3회선 — 실 PostgreSQL(★ 2026-11-20 · 설계서 docs/2026-11-20-c148-staff-tickets-three-design.md §3 · §4)
 *   표 = 원장 블록 C148-DDL-1 글자 그대로 · 인증기관 = 시험 구현(이름 · 번호 · DI 를 그대로 믿음) · 번호 = 형식만 맞는 시험 값(발송 0)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID, createHash } from 'crypto';
import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import { registerIdentityProvider } from '../identity-verify';
import { startSenderOwnerVerification, completeSenderOwnerVerification, lockOwnerLine } from '../sender-owner-verify';
import { createRegistration, approveRegistration } from '../sender-registration';
import { countCompanyLines } from '../sender-line-limit';

const CO = randomUUID();
const CO2 = randomUUID();
const ADMIN = randomUUID();
const OTHER_ADMIN = randomUUID();
const SUPER = randomUUID();
const req = {} as any;
const DOCS = [{ type: 'consent_form', originalName: 'a.pdf', storedName: 'a.pdf', filePath: '/x/a.pdf', fileSize: 1, uploadedAt: '2026-11-20T00:00:00Z' }] as any;

let seq = 0;
const phone = () => `010-1${String(++seq).padStart(3, '0')}-4${String(seq).padStart(3, '0')}`;

async function verified(userId: string, companyId: string, p: string, di: string | null): Promise<string> {
  const s = await startSenderOwnerVerification({ userId, companyId, req });
  if (s.status !== 'started') throw new Error('시작 실패');
  const done = await completeSenderOwnerVerification({ userId, companyId, verificationId: s.verificationId, payload: { name: '홍길동', phone: p, di }, req });
  if (done.status !== 'verified') throw new Error(`완료 실패 ${done.status}`);
  return s.verificationId;
}
const apply = (p: string, vid: unknown, userId = ADMIN, companyId = CO) =>
  createRegistration({ companyId, requestedBy: userId, phone: p, numberType: 'other', documents: DOCS, ownerVerificationId: vid });

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C148-DDL-1'));
  registerIdentityProvider({
    name: 'c148test',
    async buildStart() { return { mode: 'popup_form', action: 'https://example.invalid/', fields: {} }; },
    async verify(payload: any) { return { name: String(payload?.name || ''), phone: String(payload?.phone || ''), dupKey: payload?.di ?? null, providerTxId: null }; },
  });
  for (const c of [CO, CO2]) await insertMinimalRow(pool, 'companies', { id: c });
  await insertMinimalRow(pool, 'users', { id: ADMIN, company_id: CO, user_type: 'admin', is_active: true, phone: '010-1000-0001', mfa_phone: '010-1000-0001', login_id: 't-c148-admin' });
  await insertMinimalRow(pool, 'users', { id: OTHER_ADMIN, company_id: CO2, user_type: 'admin', is_active: true, login_id: 't-c148-other' });
  await insertMinimalRow(pool, 'super_admins', { id: SUPER });
  for (const c of [CO, CO2]) await insertMinimalRow(pool, 'sender_managers', { company_id: c, status: 'approved' });
});

describe('C148 T3 명의자 본인인증 CT', () => {
  it('완료 = 전용 표에만 확정 · 로그인 본인인증 표 · 계정 담당자 번호 무접촉', async () => {
    const before = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM identity_verifications`)).rows[0].n);
    const vid = await verified(ADMIN, CO, '010-1999-0001', 'DI-A');
    const row = (await pool.query(`SELECT status, verified_phone, dup_key_hash FROM sender_owner_verifications WHERE id = $1::uuid`, [vid])).rows[0];
    expect(row.status).toBe('verified');
    expect(row.verified_phone).toBe('01019990001');
    expect(row.dup_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM identity_verifications`)).rows[0].n)).toBe(before);
    const u = (await pool.query(`SELECT phone, mfa_phone FROM users WHERE id = $1::uuid`, [ADMIN])).rows[0];
    expect(u).toMatchObject({ phone: '010-1000-0001', mfa_phone: '010-1000-0001' });
  });
  it('DI 없음 = 거절 · 같은 건 두 번째 완료 · 다른 계정 · 다른 회사 = 만료', async () => {
    const s = await startSenderOwnerVerification({ userId: ADMIN, companyId: CO, req });
    if (s.status !== 'started') throw new Error('시작 실패');
    expect(await completeSenderOwnerVerification({ userId: ADMIN, companyId: CO, verificationId: s.verificationId, payload: { name: '홍길동', phone: '010-1999-0002', di: null }, req }))
      .toMatchObject({ status: 'rejected', reason: 'no_dup_key' });
    expect((await completeSenderOwnerVerification({ userId: OTHER_ADMIN, companyId: CO2, verificationId: s.verificationId, payload: { name: '홍길동', phone: '010-1999-0002', di: 'X' }, req })).status).toBe('expired');
    expect((await completeSenderOwnerVerification({ userId: ADMIN, companyId: CO, verificationId: s.verificationId, payload: { name: '홍길동', phone: '010-1999-0002', di: 'X' }, req })).status).toBe('verified');
    expect((await completeSenderOwnerVerification({ userId: ADMIN, companyId: CO, verificationId: s.verificationId, payload: { name: '홍길동', phone: '010-1999-0002', di: 'X' }, req })).status).toBe('expired');
  });
});

describe('C148 T3 기타명의 무선 신청', () => {
  it('인증 없음 · 다른 번호 · 30분 지남 · 다른 계정 · 대기(미확정) = 거절 / 정상 = 신청 + 인증 건 연결 / 재사용 = 거절', async () => {
    const p = phone();
    await expect(apply(p, undefined)).rejects.toThrow(/본인인증을 먼저/);
    const vWrong = await verified(ADMIN, CO, phone(), 'DI-B');
    await expect(apply(p, vWrong)).rejects.toThrow(/번호와 신청한 발신번호가 달라요/);
    const vStale = await verified(ADMIN, CO, p, 'DI-B');
    await pool.query(`UPDATE sender_owner_verifications SET verified_at = NOW() - INTERVAL '31 minutes' WHERE id = $1::uuid`, [vStale]);
    await expect(apply(p, vStale)).rejects.toThrow(/30분이 지났어요/);
    const vOther = await verified(OTHER_ADMIN, CO2, p, 'DI-B');
    await expect(apply(p, vOther)).rejects.toThrow(/찾지 못했어요/);
    const s = await startSenderOwnerVerification({ userId: ADMIN, companyId: CO, req });
    await expect(apply(p, s.status === 'started' ? s.verificationId : null)).rejects.toThrow(/찾지 못했어요/);
    const vOk = await verified(ADMIN, CO, p, 'DI-B');
    const reg = await apply(p, vOk);
    expect(reg.owner_verification_id).toBe(vOk);
    expect(reg.number_type).toBe('other');
    // 재사용 = 그 신청이 반려돼 같은 번호로 다시 내도 같은 인증 건은 못 쓴다(부분 유일 인덱스)
    await pool.query(`UPDATE sender_registrations SET status = 'rejected' WHERE id = $1::uuid`, [reg.id]);
    await expect(apply(p, vOk)).rejects.toThrow(/이미 다른 신청에 쓰였어요/);
  });

  it('같은 DI 3회선(대기 + 승인) 뒤 넷째 = 거절 · 승인 번호를 지우면 다시 셈에서 빠진다 · 다른 DI 는 따로 센다', async () => {
    const di = 'DI-C';
    const regs = [];
    for (let i = 0; i < 3; i++) { const p = phone(); regs.push(await apply(p, await verified(ADMIN, CO, p, di))); }
    await approveRegistration(regs[0].id, SUPER);
    const p4 = phone();
    await expect(apply(p4, await verified(ADMIN, CO, p4, di))).rejects.toThrow(/최대 3회선/);
    const pOther = phone();
    expect((await apply(pOther, await verified(ADMIN, CO, pOther, 'DI-D'))).id).toBeTruthy();
    const cb = (await pool.query(`SELECT approved_callback_id FROM sender_registrations WHERE id = $1::uuid`, [regs[0].id])).rows[0].approved_callback_id;
    await pool.query(`DELETE FROM callback_numbers WHERE id = $1::uuid`, [cb]);
    const p5 = phone();
    expect((await apply(p5, await verified(ADMIN, CO, p5, di))).id).toBeTruthy();
  });

  it('승인 = 자기 제외 셈 · 같은 DI 대기 3건 승인 셋 모두 통과', async () => {
    const di = 'DI-E';
    const regs = [];
    for (let i = 0; i < 3; i++) { const p = phone(); regs.push(await apply(p, await verified(ADMIN, CO, p, di))); }
    for (const r of regs) expect((await approveRegistration(r.id, SUPER)).registration.status).toBe('approved');
  });

  it('★ 설계 Codex 1R #3 — 같은 회사 · 명의자 접수는 한 잠금으로 줄 선다(앞 접수가 커밋 전이면 뒤 접수는 기다리고 · 커밋 뒤 셈 = 남은 1회선에 하나만)', async () => {
    // ★ 1120 변이 M4(잠금 끄기)를 옛 「둘을 같이 띄우기」 시험이 못 잡았다(실제로는 거의 차례로 돌아 잠금 없이도 하나만 성공) → 앞 접수를 커밋 전으로 붙잡아 결정적으로 본다
    const di = 'DI-F';
    const hash = createHash('sha256').update(di).digest('hex');
    for (let i = 0; i < 2; i++) { const p = phone(); await apply(p, await verified(ADMIN, CO, p, di)); }
    const pa = phone();
    const pb = phone();
    const va = await verified(ADMIN, CO, pa, di);
    const vb = await verified(ADMIN, CO, pb, di);
    const holder = await pool.connect();
    let committed = false;
    let broken = false;
    // ★ 구현 Codex 4R — 뒤 접수의 성공 · 실패를 만든 즉시 받는다(처리되지 않은 거절 0) · 끝까지 회수한다
    let later: Promise<{ ok: true } | { ok: false; e: any }> | null = null;
    try {
      await holder.query('BEGIN');
      const holderPid = Number((await holder.query('SELECT pg_backend_pid() AS p')).rows[0].p);
      await lockOwnerLine((s, p) => holder.query(s, p), CO, hash);
      await holder.query(
        `INSERT INTO sender_registrations (company_id, requested_by, phone, number_type, documents, owner_verification_id)
         VALUES ($1::uuid, $2::uuid, $3, 'other', '[]'::jsonb, $4::uuid)`,
        [CO, ADMIN, pa, va],
      );
      later = apply(pb, vb).then(() => ({ ok: true as const }), (e: any) => ({ ok: false as const, e }));
      // ★ 구현 Codex 4R — 시간 짐작(「800ms 안 끝남」) 대신 DB 로 본다: 뒤 접수 세션이 앞 연결에 막혀 기다리는가(잠금이 없으면 끝내 안 보임 = 실패)
      let blocked = false;
      for (let i = 0; i < 50 && !blocked; i++) {
        const w = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))`, [holderPid]);
        blocked = Number(w.rows[0].n) > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 100));
      }
      expect(blocked).toBe(true);
      await holder.query('COMMIT');
      committed = true;
      const r = await later;
      expect(r.ok).toBe(false);
      expect(String((r as any).e?.message)).toMatch(/최대 3회선/);
    } finally {
      // 판정이 중간에 실패해도 잠금 · 미커밋 행을 남기지 않는다(되돌리기 실패 = 연결을 버린다 · 처음 오류 그대로)
      if (!committed) { try { await holder.query('ROLLBACK'); } catch { broken = true; } }
      holder.release(broken ? true : undefined);
      if (later) await later;
    }
  });

  it('회사 무선 셈 = 승인된 기타명의 휴대폰은 빼고 회사명의 휴대폰 · 유선은 그대로', async () => {
    const c = randomUUID();
    await insertMinimalRow(pool, 'companies', { id: c });
    const u = randomUUID();
    await insertMinimalRow(pool, 'users', { id: u, company_id: c, user_type: 'admin', is_active: true, login_id: `t-c148-${c.slice(0, 6)}` });
    const own = randomUUID();
    const other = randomUUID();
    const land = randomUUID();
    await insertMinimalRow(pool, 'callback_numbers', { id: own, company_id: c, phone: '010-1888-0001' });
    await insertMinimalRow(pool, 'callback_numbers', { id: other, company_id: c, phone: '010-1888-0002' });
    await insertMinimalRow(pool, 'callback_numbers', { id: land, company_id: c, phone: '02-1888-0003' });
    await insertMinimalRow(pool, 'sender_registrations', { company_id: c, requested_by: u, phone: '010-1888-0002', number_type: 'other', status: 'approved', approved_callback_id: other });
    expect(await countCompanyLines(c)).toEqual({ mobile: 1, landline: 1 });
  });
});
