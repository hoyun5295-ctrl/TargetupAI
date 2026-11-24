// replaces: none
/**
 * 확인 판 등록 · 읽기 · 닫기 — 실 PostgreSQL 판(★ 2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §6-3 · §6-2-2 · §9 · §11)
 *   DDL-1 · DDL-2(설계서 §9 그대로)를 이 사본에 실행해 칸 · 유일 부분 인덱스를 만든다(DDL 문장도 함께 검증).
 *   등록 = 그 통신사 결과 행 하나 · 출처 spam_diag · 차감 0 · 같은 판 두 번 = 같은 판 · 하루 상한 직렬화. 닫기 = 열린 값만 error · queued 판 completed · 확인 문자 expired.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

const loaded = vi.hoisted(() => ({ n: 0 }));   // ★ 배포 3 Codex 1R — 관문이 적재까지 갔는가
vi.mock('../sms-queue', async (orig) => ({ ...(await orig() as any), insertTestSmsQueue: async () => { loaded.n += 1; } }));
vi.mock('../system-alert', async (orig) => ({ ...(await orig() as any), sendSystemAlert: async () => 1 }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { enqueueSpamTest, RENDERED_SAMPLE_MARK, resetSpamStampCache, sendDiagTestRow } from '../spam-test-queue';
import { resetSpamProbeSchemaCache } from '../spam-probe';
import { diagEnabledFor } from '../spam-diag-gate';
import { registerDiag, buildSpamBlockHints, closeDiagnosis, lockDiagResultRows, readDiagChecks, spamHintLine } from '../spam-diag';

const CO = randomUUID();
const US = randomUUID();
const CB = '0221231125';   // 합성 번호(규격 통과 · 도달 불가 시험 값)
const TEXT = '(광고) 하늘몰 겨울 행사\n>https://tinyurl.example/zz9\n■ 최대 35% 할인\n무료 수신거부 080-000-0000';

/** 막힌 부모 검사(렌더 끝난 글 · KT 막힘 · 그 밖 통과) */
async function parent(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO spam_filter_tests (id, company_id, user_id, callback_number, message_content_lms, message_hash, status, source, first_recipient, created_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'completed', 'manual', $7, NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '4 minutes')`,
    [id, CO, US, CB, TEXT, `h-${id.slice(0, 8)}`, JSON.stringify({ [RENDERED_SAMPLE_MARK]: true })],
  );
  for (const [carrier, result] of [['SKT', 'pass'], ['KT', 'blocked'], ['LGU', 'pass']]) {
    await pool.query(`INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone, received, result) VALUES ($1, $2, 'LMS', $3, $4, $5)`,
      [id, carrier, `0100000112${carrier.length}`, result === 'pass', result]);
  }
  return id;
}

beforeAll(async () => {
  for (const id of ['C89-DDL-1', 'C89-DDL-2', 'C89-DDL-3', 'C89-DDL-4', 'C89-DDL-5', 'C98-DDL-2']) await pool.query(ledgerBlockSql(id));   // C98-DDL-2 = customers.joined_at(등록의 표본 고객 읽기)
  // 설계서 §9 DDL-1 · DDL-2 그대로
  await pool.query(`SET lock_timeout = '3s'; ALTER TABLE spam_filter_tests ADD COLUMN IF NOT EXISTS diag_of uuid NULL;`);
  await pool.query(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_spam_filter_tests_diag ON spam_filter_tests (diag_of, variant_id) WHERE diag_of IS NOT NULL;`);
  // ★ 1124 설계서 §9 DDL-4 그대로(회사 스위치 · 슈퍼관리자)
  await pool.query(`SET lock_timeout = '3s'; ALTER TABLE companies ADD COLUMN IF NOT EXISTS spam_diag_enabled boolean NOT NULL DEFAULT false;`);
  resetSpamStampCache();
  resetSpamProbeSchemaCache();
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: US, company_id: CO, user_type: 'user', is_active: true, login_id: `t-1124-reg-${US.slice(0, 8)}` });
  await insertMinimalRow(pool, 'sender_numbers', { company_id: CO, phone_number: CB, is_active: true });
  // KT 단말 두 대(★ 배포 2 Codex 1R — 확인 판은 한 대만 쓴다)
  for (const [carrier, phone] of [['SKT', '01000001123'], ['KT', '01000001122'], ['KT', '01000001129'], ['LGU', '01000001124']]) {
    await pool.query(`INSERT INTO spam_filter_devices (device_id, carrier, phone, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`, [`dev-1124-${carrier}-${phone}`, carrier, phone]);
  }
  await pool.query(`UPDATE companies SET spam_diag_enabled = true WHERE id = $1`, [CO]);
});

describe('확인 판 등록(registerDiag → enqueueSpamTest diag)', () => {
  it('판 ① = 막힌 통신사(KT) 결과 행 하나 · 출처 spam_diag · diag_of = 부모 · K1 · 주소만 빠진 글 · 차감 거래 0', async () => {
    const p = await parent();
    const r = await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US });
    expect(r).toMatchObject({ ok: true, reused: false });
    const t = (await pool.query(`SELECT source, diag_of, variant_id, message_content_lms, status FROM spam_filter_tests WHERE id = $1`, [(r as any).testId])).rows[0];
    expect(t).toMatchObject({ source: 'spam_diag', diag_of: p, variant_id: 'K1', status: 'queued' });
    expect(t.message_content_lms).not.toContain('tinyurl');
    expect(t.message_content_lms).toContain('(광고)');
    expect(t.message_content_lms).toContain('수신거부');
    const rows = (await pool.query(`SELECT carrier FROM spam_filter_test_results WHERE test_id = $1`, [(r as any).testId])).rows;
    expect(rows.map((x: any) => x.carrier)).toEqual(['KT']);
    const tx = await pool.query(`SELECT 1 FROM balance_transactions WHERE reference_id = $1`, [String((r as any).testId)]);
    expect(tx.rows.length).toBe(0);
  });

  it('같은 판 두 번 = 같은 판(결과 행 · 상한 소모 0) · 다음 판 자격은 판 ① 확정 전 = 없음', async () => {
    const p = await parent();
    const a = await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US });
    const b = await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US });
    expect((b as any).testId).toBe((a as any).testId);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM spam_filter_tests WHERE diag_of = $1`, [p])).rows[0].n).toBe(1);
    const c = await registerDiag({ parentTestId: p, carrier: 'KT', variant: 2, actorUserId: US });
    expect(c).toMatchObject({ ok: false, reason: 'no_variant' });
  });

  it('★ 배포 2 Codex 1R — 부르는 쪽 조건이 거짓(진단이 이미 닫힘 · 접수 버전이 바뀜) = 판 0 · 부모가 그 사이 통과로 바뀜 = 판 0', async () => {
    const p = await parent();
    expect(await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US, guard: async () => false })).toMatchObject({ ok: false });
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM spam_filter_tests WHERE diag_of = $1`, [p])).rows[0].n).toBe(0);
    const q = await parent();
    const h = await buildSpamBlockHints(q);   // 막힘일 때 읽은 판단
    await pool.query(`UPDATE spam_filter_test_results SET result = 'pass', received = true WHERE test_id = $1 AND carrier = 'KT'`, [q]);
    expect(await registerDiag({ parentTestId: q, carrier: 'KT', variant: 1, actorUserId: US, hint: h! })).toMatchObject({ ok: false, reason: 'not_blocked' });
  });

  it('회사 스위치 꺼짐 · 막히지 않은 통신사 · 확인 판을 부모로 = 판 0', async () => {
    const p = await parent();
    await pool.query(`UPDATE companies SET spam_diag_enabled = false WHERE id = $1`, [CO]);
    expect(await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US })).toMatchObject({ ok: false, reason: 'off' });
    await pool.query(`UPDATE companies SET spam_diag_enabled = true WHERE id = $1`, [CO]);
    expect(await registerDiag({ parentTestId: p, carrier: 'SKT', variant: 1, actorUserId: US })).toMatchObject({ ok: false });
    const d = await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US });
    expect(await registerDiag({ parentTestId: (d as any).testId, carrier: 'KT', variant: 1, actorUserId: US })).toMatchObject({ ok: false });
  });

  it('하루 상한 = 서로 다른 부모 둘이 마지막 한 자리를 함께 노려도 하나만(고정 키 잠금 아래 셈)', async () => {
    const [p1, p2] = [await parent(), await parent()];
    const used = (await pool.query(`SELECT COUNT(*)::int AS n FROM spam_filter_tests WHERE source = 'spam_diag' AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`)).rows[0].n;
    const reg = (p: string) => enqueueSpamTest({
      companyId: CO, userId: US, callbackNumber: CB, messageContentLms: '고친 글', messageType: 'LMS',
      source: 'spam_diag', skipPrepaid: true, rendered: true, variantId: 'K1',
      diag: { parentTestId: p, carrier: 'KT', capPerCallback: 1000, capTotal: used + 1 },
    });
    const out = await Promise.all([reg(p1), reg(p2)]);
    expect(out.filter((o) => o.ok).length).toBe(1);
    expect(out.find((o) => !o.ok)).toMatchObject({ errorCode: 'DIAG_CAP', error: 'total' });
  });
});

describe('읽기 · 닫기', () => {
  it('A = 주소가 맨 앞 · 판 상태 읽기 · 닫기 = 열린 결과 error · queued 판 completed · 그 뒤 한 줄 = 확인 못 함', async () => {
    const p = await parent();
    const h = await buildSpamBlockHints(p);
    expect(h?.carriers.map((c) => c.carrier)).toEqual(['KT']);
    expect(h?.carriers[0].suspects[0].kind).toBe('url');
    expect(h?.carriers[0].next).toBe(1);
    expect(spamHintLine(h!)).toBe('막혔을 수 있는 부분: 글 속 주소');
    const r = await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US });
    expect((await readDiagChecks(p, TEXT)).byCarrier.KT).toMatchObject({ v1: 'queued' });
    await closeDiagnosis(p);
    const t = (await pool.query(`SELECT status FROM spam_filter_tests WHERE id = $1`, [(r as any).testId])).rows[0];
    expect(t.status).toBe('completed');
    const res = (await pool.query(`SELECT result FROM spam_filter_test_results WHERE test_id = $1`, [(r as any).testId])).rows[0];
    expect(res.result).toBe('error');
    const h2 = await buildSpamBlockHints(p);
    expect(spamHintLine(h2!)).toBe('확인을 마치지 못했어요.');
  });

  it('★ 배포 3 Codex 1R — 회사 스위치 끄기 저장이 관문보다 먼저 커밋되면 검사 문자 관문은 꺼짐을 읽는다(관문이 끄기 커밋을 기다림 · 적재 0)', async () => {
    const p = await parent();
    const r = await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US });
    const tid = String((r as any).testId);
    const row = (await pool.query(`SELECT id, phone FROM spam_filter_test_results WHERE test_id = $1`, [tid])).rows[0];
    await pool.query(`UPDATE spam_filter_tests SET status = 'active' WHERE id = $1`, [tid]);   // 대기열이 집은 판
    const a = await pool.connect();
    loaded.n = 0;
    try {
      await a.query('BEGIN');
      await a.query(`UPDATE companies SET spam_diag_enabled = false WHERE id = $1`, [CO]);   // 슈퍼관리자 끄기 저장(커밋 전)
      const gate = sendDiagTestRow({ testId: tid, parentTestId: p, companyId: CO, userId: US, callback: CB, rowId: String(row.id), phone: String(row.phone), messageType: 'LMS', content: '글', title: '' });
      gate.catch(() => undefined);
      await new Promise((res) => setTimeout(res, 500));
      await a.query('COMMIT');
      expect(await gate).toBe(false);
      expect(loaded.n).toBe(0);
      expect((await pool.query(`SELECT result FROM spam_filter_test_results WHERE id = $1`, [row.id])).rows[0].result).toBe('error');
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      a.release();
      await pool.query(`UPDATE companies SET spam_diag_enabled = true WHERE id = $1`, [CO]);
    }
  });

  it('★ 배포 3 Codex 3R — 시간 상한은 회사 행 읽기 한 문장에만 · 읽은 뒤 그 트랜잭션의 직전 값으로 되돌린다', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL statement_timeout = '7s'`);
      expect(await diagEnabledFor(CO, (sql, params) => c.query(sql, params))).toBe(true);
      expect((await c.query(`SELECT current_setting('statement_timeout') AS v`)).rows[0].v).toBe('7s');
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });

  it('★ 배포 3 Codex 2R — 다른 쓰기가 회사 행을 오래 쥐어도 관문은 대기 상한(2초) 안에 거부로 끝난다(적재 0 · 대기열이 멈추지 않음)', async () => {
    const p = await parent();
    const r = await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US });
    const tid = String((r as any).testId);
    const row = (await pool.query(`SELECT id, phone FROM spam_filter_test_results WHERE test_id = $1`, [tid])).rows[0];
    await pool.query(`UPDATE spam_filter_tests SET status = 'active' WHERE id = $1`, [tid]);
    const a = await pool.connect();
    loaded.n = 0;
    try {
      await a.query('BEGIN');
      await a.query(`SELECT id FROM companies WHERE id = $1 FOR UPDATE`, [CO]);   // 선불 차감 등 회사 행을 쥔 쓰기(끝나지 않음)
      const t0 = Date.now();
      const sent = await sendDiagTestRow({ testId: tid, parentTestId: p, companyId: CO, userId: US, callback: CB, rowId: String(row.id), phone: String(row.phone), messageType: 'LMS', content: '글', title: '' });
      const took = Date.now() - t0;
      expect(sent).toBe(false);
      expect(loaded.n).toBe(0);
      expect(took).toBeLessThan(6_000);
      expect((await pool.query(`SELECT result FROM spam_filter_test_results WHERE id = $1`, [row.id])).rows[0].result).toBe('error');
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      a.release();
    }
  }, 20_000);

  it('★ 배포 2 Codex 4R — 4a 확정(판 행 잠금 + 진단 닫기)과 확인 문자 기한 처리(확인 문자 → 결과 행)가 겹쳐도 교착 0', async () => {
    const p = await parent();
    const r = await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US });
    const childRes = String((await pool.query(`SELECT id FROM spam_filter_test_results WHERE test_id = $1`, [(r as any).testId])).rows[0].id);
    await pool.query(`UPDATE spam_filter_test_results SET result = 'unconfirmed' WHERE id = $1`, [childRes]);
    const probe = (await pool.query(
      `INSERT INTO spam_test_probes (result_id, phone, carrier, nonce, message_hash, status, claimed_at, sent_at, deadline_at)
       VALUES ($1, '01000001122', 'KT', $2, $3, 'sent', NOW(), NOW(), NOW()) RETURNING id`,
      [childRes, randomUUID().slice(0, 6).toUpperCase(), `hash-4r-${childRes.slice(0, 8)}`],
    )).rows[0].id;
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await a.query(`UPDATE spam_test_probes SET status = 'expired', decided_at = NOW() WHERE id = $1`, [probe]);   // 기한 처리 = 확인 문자 먼저
      await b.query('BEGIN');
      const runB = (sql: string, params?: any[]) => b.query(sql, params);
      // settleAgencyDiag4a 의 순서 그대로(판 행 잠금 → 다시 판정 → 진단 닫기)
      const bDone = (async () => { await lockDiagResultRows(p, runB); await closeDiagnosis(p, runB); await b.query('COMMIT'); })();
      bDone.catch(() => undefined);
      await new Promise((res) => setTimeout(res, 500));
      const up = await a.query(`UPDATE spam_filter_test_results SET result = 'error' WHERE id = $1 AND result = 'unconfirmed'`, [childRes]);   // 그다음 결과 행
      await a.query('COMMIT');
      await bDone;
      expect(up.rowCount).toBe(1);
      const after = (await pool.query(`SELECT p.status, r.result FROM spam_test_probes p JOIN spam_filter_test_results r ON r.id = p.result_id WHERE p.id = $1`, [probe])).rows[0];
      expect(after).toEqual({ status: 'expired', result: 'error' });
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
  });

  it('판 ① 도착 = 「주소를 빼니 도착」 · 정해진 값은 닫기가 건드리지 않는다', async () => {
    const p = await parent();
    const r = await registerDiag({ parentTestId: p, carrier: 'KT', variant: 1, actorUserId: US });
    await pool.query(`UPDATE spam_filter_test_results SET received = true, result = 'pass' WHERE test_id = $1`, [(r as any).testId]);
    await pool.query(`UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW() WHERE id = $1`, [(r as any).testId]);
    await closeDiagnosis(p);
    const h = await buildSpamBlockHints(p);
    expect(spamHintLine(h!)).toBe('글 속 주소를 빼니 KT에 도착했어요. 주소를 바꿔 보세요.');
    expect(spamHintLine(h!, true)).toBe('글 속 주소를 빼니 KT에 도착했습니다. 주소를 바꿔 주세요.');
  });
});
