// replaces: none
/**
 * 경보 원장 · A5 커서 순환 — 실 PostgreSQL 판(★ 2026-11-02 설계서 docs/2026-11-01-credit-control-tower-design.md §17-3 · §17-4)
 *
 * 운영 문장을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본 · 대기 DDL C94-DDL-1 을 사본에 얹는다).
 *   1. 경보 원장 = 같은 키 한 줄(첫 글 그대로) · 못 보내면 남고 · 보내면 읽은 키만 지운다 · 이름 목록으로 다시 보낸다
 *   2. 넣는 글 = NUL 제거 · 길이 상한(독 항목이 넣기를 막지 않는다)
 *   3. A5 후보 = 커서 순환 — 지우지 못한 줄 1,000 이 앞을 막아도 뒤 PDF 가 다음 회차에 지워진다(설계 3R · 옛 오래된 순 LIMIT 1000 = 영영 정지)
 *   4. A1 · A2 메일 접수(Codex 구현 1R · 2R) = 원장 대조 칸 · 미등록 판정 = 선점 쓰기 셋(새 행 · 실패 재선점 · 멈춘 선점 재선점) · 경보만 남은 접수 닫기(메일함 목록과 무관 · 반려 · 실패 묶음 ANY bigint[]) · 원장에 넣은 항목만 닫는다
 * 보내기 = 가짜(문자 0) · 사내 회사 판정 = 가짜(전부 바깥 회사).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pool, query } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';

vi.mock('../internal-company', async (orig) => ({ ...(await orig<any>()), isInternalCompany: vi.fn(async () => false) }));
vi.mock('../agency-send-email', async (orig) => ({ ...(await orig<any>()), resolveEmailSender: vi.fn(async () => ({ outcome: 'unregistered' })) }));

import { alertPassFailures, persistPassFailures, flushPendingPassAlerts } from '../system-alert';
import { sweepExpiredAnalysisPdfs } from '../retention-sweeper';
import { processMessage, readKnownIntakes, closeAlertPendingForMailbox } from '../agency-send-mail-worker';

const sent: any[] = [];
let open = true;
const send = async (p: any) => { if (!open) return 0; sent.push(p); return 1; };
const ledgerRows = async (pass: string) =>
  (await query(`SELECT item_key, company_id, error, total FROM system_alert_pending WHERE pass = $1 ORDER BY created_at, item_key`, [pass])).rows;

let tmp = '';
beforeAll(async () => {
  await pool.query(ledgerBlockSql('C94-DDL-1'));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-pg-'));
});
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 무시 */ } });

describe('경보 원장 system_alert_pending — 실 PG', () => {
  it('같은 키 = 한 줄(첫 글 그대로) · 못 보내면 남는다 · 보내면 읽은 키만 지운다', async () => {
    open = false;
    await alertPassFailures({ pass: 'pg-a', title: 't', action: 'a', failures: [{ companyId: null, key: 'k1', error: '첫 글' }] }, send);
    await alertPassFailures({ pass: 'pg-a', title: 't', action: 'a', failures: [{ companyId: null, key: 'k1', error: '둘째 글' }, { companyId: '00000000-0000-0000-0000-00000000000a', key: 'k2', error: 'e2' }] }, send);
    expect(await ledgerRows('pg-a')).toEqual([
      { item_key: 'k1', company_id: null, error: '첫 글', total: null },
      { item_key: 'k2', company_id: '00000000-0000-0000-0000-00000000000a', error: 'e2', total: null },
    ]);
    open = true;
    await flushPendingPassAlerts(new Date());   // 이름 목록(SELECT DISTINCT pass)으로 다시 보낸다
    expect(sent.at(-1).dedupKey).toBe('pass:pg-a');
    expect(sent.at(-1).details[0]).toBe('새 2건');
    expect(await ledgerRows('pg-a')).toEqual([]);
  });

  it('주기 모드 = 대상 수 칸 · 넣는 글 = NUL 제거 · 500자 상한', async () => {
    expect(await persistPassFailures({ pass: 'pg-b', title: 't', action: 'a', total: 7, failures: [{ companyId: null, key: 'n1', error: `a\u0000b${'x'.repeat(2000)}` }] })).toBe(true);
    const r = await ledgerRows('pg-b');
    expect(r).toHaveLength(1);
    expect(r[0].total).toBe(7);
    expect(r[0].error.length).toBe(500);
    expect(r[0].error.startsWith('abx')).toBe(true);
  });
});

describe('A5 보관 기한 PDF 후보 = 커서 순환 — 실 PG(retention-sweeper 문장 그대로)', () => {
  it('지우지 못한 줄 1,000 이 앞을 막아도 뒤 PDF 는 다음 회차에 지워지고 · 덜 찬 회차 뒤에는 새 바퀴', async () => {
    const pdfDir = path.join(tmp, 'pdfs');
    const stuck = path.join(pdfDir, 'stuck-dir');   // 폴더 = 파일 지우기가 실패한다(지우지 못한 줄 = 그대로 남는다)
    fs.mkdirSync(stuck, { recursive: true });
    const late = path.join(pdfDir, 'late.pdf');
    fs.writeFileSync(late, 'x');
    await query(
      `INSERT INTO full_analysis_jobs (company_id, period, status, pdf_path, updated_at)
       SELECT gen_random_uuid(), '2026-07', 'done', $1, NOW() - INTERVAL '200 days' + g * INTERVAL '1 second' FROM generate_series(1, 1000) g`,
      [stuck],
    );
    await query(
      `INSERT INTO full_analysis_jobs (company_id, period, status, pdf_path, updated_at) VALUES (gen_random_uuid(), '2026-08', 'done', $1, NOW() - INTERVAL '100 days')`,
      [late],
    );
    expect(await sweepExpiredAnalysisPdfs({ pdfDir })).toBe(0);   // 회차 1 = 막힌 1,000 줄(지우기 실패) · 꽉 참 = 커서
    expect(fs.existsSync(late)).toBe(true);
    expect(await sweepExpiredAnalysisPdfs({ pdfDir })).toBe(1);   // 회차 2 = 커서 뒤 = 뒤 PDF 를 지운다(옛 문장은 같은 1,000 줄만 다시 골랐다)
    expect(fs.existsSync(late)).toBe(false);
    const left = await query(`SELECT COUNT(*)::int AS n FROM full_analysis_jobs WHERE pdf_path = $1`, [late]);
    expect(left.rows[0].n).toBe(0);
    expect(await sweepExpiredAnalysisPdfs({ pdfDir })).toBe(0);   // 회차 2 가 덜 참 = 새 바퀴 → 막힌 줄을 다시 본다(여전히 실패)
    const stuckLeft = await query(`SELECT COUNT(*)::int AS n FROM full_analysis_jobs WHERE pdf_path = $1`, [stuck]);
    expect(stuckLeft.rows[0].n).toBe(1000);
  }, 120000);
});

describe('A1 · A2 메일 접수 — 실 PG(agency-send-mail-worker 문장 그대로 · Codex 구현 1R)', () => {
  it('원장 대조 칸 · 미등록 판정 표식 · 경보만 남은 접수 닫기 = 원장에 넣은 항목만 반려 · 실패로 닫는다', async () => {
    const MB = 'intake-pg@example.invalid';
    await query(
      `INSERT INTO agency_send_email_intake (mailbox, uidl, message_hash, status, attempt_count, claimed_at)
       VALUES ($1, 'x1', 'h-x1', 'claimed', 4, NOW() - INTERVAL '1 hour'), ($1, 'x2', 'h-x2', 'claimed', 4, NOW() - INTERVAL '1 hour'),
              ($1, 'y1', 'h-y1', 'claimed', 2, NOW()), ($1, 'w1', 'h-w1', 'claimed', 4, NOW()),
              ($1, 's1', 'h-s1', 'claimed', 2, NOW() - INTERVAL '1 hour')`,
      [MB],
    );
    await query(`INSERT INTO agency_send_email_intake (mailbox, uidl, message_hash, status, reason, attempt_count, next_attempt_at) VALUES ($1, 'r1', 'h-r1', 'failed', 'timeout', 3, NOW() - INTERVAL '1 minute')`, [MB]);
    // 메일함에서 지워진 메일(목록에 없음)의 미등록 판정 표식 행 = 그래도 닫힌다
    await query(`INSERT INTO agency_send_email_intake (mailbox, uidl, message_hash, from_email, status, reason, attempt_count) VALUES ($1, 'z1', 'h-z1', 'Gone@Example.invalid', 'claimed', 'unregistered', 1)`, [MB]);
    // A1 = 새 메일 · 미등록 → 표식(선점 그대로 · reason unregistered) → 원장 → 반려
    let from = 'Kim <Kim@Example.invalid>';
    const client = { top: async () => Buffer.from(`From: ${from}\r\nMessage-ID: <pg-${from.length}@example.invalid>\r\nSubject: t\r\n\r\n`) } as any;
    await processMessage({ client, mailbox: MB, octets: new Map(), now: new Date() }, 1, 'n1');   // 새 행 INSERT(판정 같이)
    from = 'Re@Example.invalid';
    await processMessage({ client, mailbox: MB, octets: new Map(), now: new Date() }, 2, 'r1');   // 실패 재선점 UPDATE(판정 같이 · 시도 3 → 4)
    from = 'Stale Kim <St@Example.invalid>';
    await processMessage({ client, mailbox: MB, octets: new Map(), now: new Date() }, 3, 's1');   // 멈춘 선점 재선점 UPDATE(판정 같이 · 시도 2 → 3)
    const known = await readKnownIntakes(MB, ['x1', 'x2', 'y1', 'n1']);
    expect(known.map((r) => r.uidl).sort()).toEqual(['n1', 'x1', 'x2', 'y1']);
    expect(Object.keys(known[0]).sort()).toEqual(['attempt_count', 'claimed_at', 'from_email', 'id', 'next_attempt_at', 'reason', 'status', 'uidl']);
    // A2 = 소진 둘 → 원장 → 실패(묶음 ANY bigint[]) · 아직 소진 아닌 y1 · 처리 중(10분 안) w1 은 그대로
    await closeAlertPendingForMailbox(MB);
    const st = Object.fromEntries((await query(
      `SELECT uidl, status, reason, reply_status, attempt_count FROM agency_send_email_intake WHERE mailbox = $1`, [MB])).rows.map((r: any) => [r.uidl, [r.status, r.reason, r.reply_status, r.attempt_count]]));
    expect(st).toEqual({
      n1: ['rejected', 'unregistered', 'skipped', 0],
      r1: ['rejected', 'unregistered', 'skipped', 4],
      s1: ['rejected', 'unregistered', 'skipped', 3],
      x1: ['failed', 'claim_exhausted', null, 4],
      x2: ['failed', 'claim_exhausted', null, 4],
      y1: ['claimed', null, null, 2],
      w1: ['claimed', null, null, 4],
      z1: ['rejected', 'unregistered', 'skipped', 1],
    });
    expect((await ledgerRows('agency-mail-unknown-sender')).map((r: any) => r.item_key).sort()).toEqual(['gone@example.invalid', 'kim@example.invalid', 're@example.invalid', 'st@example.invalid']);
    expect((await ledgerRows('agency-mail-claim-exhausted')).map((r: any) => r.item_key)).toEqual([`${MB}:x1`, `${MB}:x2`]);
  });
});
