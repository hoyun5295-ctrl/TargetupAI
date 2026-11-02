// replaces: none
/**
 * 스팸 판정 4값 · 확인 문자 · 같은 검사 이어 보기 · 보내기 전 재작성 후보 — 실 PostgreSQL 판
 * (★ 2026-11-01 여정 재발 방지 B1-4 · 설계서 docs/2026-11-01-journey-recurrence-prevention-design.md §2 B1-4 · §4).
 * 새 칸 · 새 표(원장 C89-DDL-1~5)는 이 파일의 사본에 원장 블록을 그대로 실행해 만든다(원장 SQL 도 함께 검증).
 * 바깥(테스트 문자 적재 · 운영 경보 · 크레딧 원장)만 시험이 쥔다.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const ctl = vi.hoisted(() => ({
  sms: [] as Array<{ phone: string; text: string; ref: string }>,
  alerts: [] as string[],
  charged: new Map<string, number>(),
  refunds: [] as string[],
}));
vi.mock('../sms-queue', async (orig) => {
  const real: any = await orig();
  return { ...real, insertTestSmsQueue: async (phone: string, _cb: string, text: string, _t: string, ref: string) => { ctl.sms.push({ phone, text, ref }); } };
});
vi.mock('../system-alert', async (orig) => {
  const real: any = await orig();
  return { ...real, sendSystemAlert: async (p: any) => { ctl.alerts.push(String(p.dedupKey)); return 1; } };
});
vi.mock('../ai-credit', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    chargedAmountByKey: async (_c: string, key: string) => ctl.charged.get(key) ?? null,
    refundCredit: async (o: any) => { ctl.refunds.push(String(o.idempotencyKey)); return { refunded: true, amount: o.amount }; },
  };
});

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import {
  decideSpamResult, spamCheckFor, readSpamTestOutcome, noteAfterDecidedReport, resetSpamStampCache, computeMessageHash, enqueueSpamTest,
} from '../spam-test-queue';
import { withTransaction } from '../../config/database';
import { heldResultJson } from '../agency-send-worker';
import { runSpamProbeCycle, matchProbeReport, measureSpamVerdicts, probeText, resetSpamProbeSchemaCache } from '../spam-probe';
import {
  claimCandidate, saveCandidate, readCandidate, sweepPretestCandidates, regenChargeKey, resetCandidatesReady, candidateStillMine, moveCandidate,
} from '../journey-pretest-candidate';

const CO = '00000000-0000-0000-0000-0000000c1101';
const US = '00000000-0000-0000-0000-0000000a1101';
const JO = '00000000-0000-0000-0000-0000000b1101';
const ST = '00000000-0000-0000-0000-0000000d1101';
const SNAP = '00000000-0000-0000-0000-0000000e1101';
const CB = '0215441234';

async function newTest(o: { minutesAgo: number; rows: Array<{ phone: string; carrier: string; result: string | null; received?: boolean }>; hash?: string; subject?: string | null }): Promise<{ testId: string; rowIds: string[] }> {
  const t = await pool.query(
    `INSERT INTO spam_filter_tests (company_id, user_id, callback_number, message_content_sms, message_hash, status, source, subject, created_at, completed_at)
     VALUES ($1, $2, $3, '본문', $4, 'completed', 'auto_ai', $5, NOW() - ($6::int * INTERVAL '1 minute'), NOW() - ($6::int * INTERVAL '1 minute'))
     RETURNING id`,
    [CO, US, CB, o.hash ?? `h${Math.random().toString(16).slice(2, 12)}`, o.subject ?? null, o.minutesAgo],
  );
  const testId = String(t.rows[0].id);
  const rowIds: string[] = [];
  for (const r of o.rows) {
    const x = await pool.query(
      `INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone, received, result) VALUES ($1, $2, 'SMS', $3, $4, $5) RETURNING id`,
      [testId, r.carrier, r.phone, r.received ?? false, r.result],
    );
    rowIds.push(String(x.rows[0].id));
  }
  return { testId, rowIds };
}
const resultOf = async (id: string) => (await pool.query(`SELECT result, first_result, decided_at, late_report_at FROM spam_filter_test_results WHERE id = $1`, [id])).rows[0];

beforeAll(async () => {
  // ★ 2026-11-02 C98-DDL-2 = 가입 근거 칸(표준 필드 「가입일」 = customers.joined_at · 첫 수신자 표본이 표준 칸을 읽는다)
  for (const id of ['C89-DDL-1', 'C89-DDL-2', 'C89-DDL-3', 'C89-DDL-4', 'C89-DDL-5', 'C98-DDL-2']) await pool.query(ledgerBlockSql(id));
  resetSpamStampCache();
  resetSpamProbeSchemaCache();
  resetCandidatesReady();
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: US, company_id: CO, user_type: 'user', is_active: true, login_id: 't-1101-spam' });
  await pool.query(
    `INSERT INTO spam_filter_devices (device_id, carrier, phone, is_active, last_body_report_at) VALUES
       ('dev-lg', 'LGU', '01000000001', true, NOW() - INTERVAL '1 day'),
       ('dev-kt', 'KT', '01000000002', true, NULL)`,
  );
  await insertMinimalRow(pool, 'journey_step_snapshots', { id: SNAP, company_id: CO, journey_id: JO, step_id: ST });
});
beforeEach(() => { ctl.sms.length = 0; ctl.alerts.length = 0; ctl.refunds.length = 0; ctl.charged.clear(); });

describe('결과 행 판정 기록(DDL-B)', () => {
  it('확인 중 = 처음 판정만 남고 확정 시각 없음 · 장애(시간 초과) = 확정 시각 · 이미 판정된 행은 0행', async () => {
    const { rowIds } = await newTest({ minutesAgo: 0, rows: [{ phone: '01000000001', carrier: 'LGU', result: null }, { phone: '01000000002', carrier: 'KT', result: null }] });
    expect(await decideSpamResult('unconfirmed', rowIds[0])).toBe(1);
    expect(await decideSpamResult('timeout', rowIds[1])).toBe(1);
    expect(await decideSpamResult('blocked', rowIds[0])).toBe(0);
    const a = await resultOf(rowIds[0]);
    expect([a.result, a.first_result, a.decided_at]).toEqual(['unconfirmed', 'unconfirmed', null]);
    const b = await resultOf(rowIds[1]);
    expect(b.first_result).toBe('timeout');
    expect(b.decided_at).not.toBeNull();
  });
});

describe('확인 문자(DDL-C · DDL-E)', () => {
  it('창(10분)이 닫힌 확인 중 행 = 본문 보고 단말이면 확인 문자 1통 · 그 보고 = 원 행 차단 확정 · 다른 검사로 넘어가지 않음', async () => {
    const { rowIds } = await newTest({ minutesAgo: 11, rows: [{ phone: '01000000001', carrier: 'LGU', result: 'unconfirmed' }] });
    const c1 = await runSpamProbeCycle();
    expect(c1.claimed).toBe(1);
    expect(ctl.sms).toHaveLength(1);
    const probe = (await pool.query(`SELECT status, nonce, message_hash, deadline_at FROM spam_test_probes WHERE result_id = $1`, [rowIds[0]])).rows[0];
    expect(probe.status).toBe('sent');
    expect(probe.deadline_at).not.toBeNull();
    expect(ctl.sms[0].text).toBe(probeText(probe.nonce));
    expect(probe.message_hash).toBe(computeMessageHash(probeText(probe.nonce)));
    // 같은 주기를 다시 돌려도 두 번 보내지 않는다(행당 하나)
    await runSpamProbeCycle();
    expect(ctl.sms).toHaveLength(1);
    // 앱 보고(통신사 머리말 붙음) = 그 확인 문자
    expect(await matchProbeReport({ devicePhone: '01000000001', carrier: 'LGU', messageContent: `[Web발신]\n${probeText(probe.nonce)}` })).toBe('probe');
    const r = await resultOf(rowIds[0]);
    expect(r.result).toBe('blocked');
    expect(r.decided_at).not.toBeNull();
    // 같은 보고가 또 와도 확인 문자다(일반 검사로 넘기지 않음)
    expect(await matchProbeReport({ devicePhone: '01000000001', carrier: 'LGU', messageContent: probeText(probe.nonce) })).toBe('probe');
  });

  it('본문 보고가 7일 안에 없는 단말 = 확인 문자 없이 검사 장애 + 경보 · 창 안(10분 전)은 기다린다', async () => {
    const fresh = await newTest({ minutesAgo: 3, rows: [{ phone: '01000000002', carrier: 'KT', result: 'unconfirmed' }] });
    const old = await newTest({ minutesAgo: 12, rows: [{ phone: '01000000002', carrier: 'KT', result: 'unconfirmed' }] });
    const c = await runSpamProbeCycle();
    expect(c.errored).toBe(1);
    expect(ctl.sms).toHaveLength(0);
    expect((await resultOf(old.rowIds[0])).result).toBe('error');
    expect((await resultOf(fresh.rowIds[0])).result).toBe('unconfirmed');
    expect(ctl.alerts.some((k) => k.startsWith('spam-probe-device:KT'))).toBe(true);
  });

  it('기한(5분) 안에 보고가 없는 확인 문자 = 단말 장애(error) · 늦은 확인 문자 보고는 차단으로 바꾸지 않음', async () => {
    const { rowIds } = await newTest({ minutesAgo: 30, rows: [{ phone: '01000000001', carrier: 'LGU', result: 'unconfirmed' }] });
    await runSpamProbeCycle();
    await pool.query(`UPDATE spam_test_probes SET deadline_at = NOW() - INTERVAL '1 second' WHERE result_id = $1`, [rowIds[0]]);
    const c = await runSpamProbeCycle();
    expect(c.expired).toBeGreaterThanOrEqual(1);
    expect((await resultOf(rowIds[0])).result).toBe('error');
    const nonce = (await pool.query(`SELECT nonce FROM spam_test_probes WHERE result_id = $1`, [rowIds[0]])).rows[0].nonce;
    expect(await matchProbeReport({ devicePhone: '01000000001', carrier: 'LGU', messageContent: probeText(nonce) })).toBe('probe');
    expect((await resultOf(rowIds[0])).result).toBe('error');
  });

  it('발송 전에 멈춘 claim = 2분 뒤 한 번 더 · 상한(2) 뒤 expired → error', async () => {
    const { rowIds } = await newTest({ minutesAgo: 40, rows: [{ phone: '01000000001', carrier: 'LGU', result: 'unconfirmed' }] });
    await pool.query(
      `INSERT INTO spam_test_probes (result_id, phone, carrier, nonce, message_hash, status, claimed_at) VALUES ($1, '01000000001', 'LGU', 'AAAAAA', 'hash-stuck-1', 'claimed', NOW() - INTERVAL '3 minutes')`,
      [rowIds[0]],
    );
    await runSpamProbeCycle();
    expect(ctl.sms.filter((s) => s.text === probeText('AAAAAA'))).toHaveLength(1);
    const p = (await pool.query(`SELECT status, attempts FROM spam_test_probes WHERE result_id = $1`, [rowIds[0]])).rows[0];
    expect([p.status, Number(p.attempts)]).toEqual(['sent', 2]);
    const { rowIds: r2 } = await newTest({ minutesAgo: 40, rows: [{ phone: '01000000001', carrier: 'LGU', result: 'unconfirmed' }] });
    await pool.query(
      `INSERT INTO spam_test_probes (result_id, phone, carrier, nonce, message_hash, status, attempts, claimed_at) VALUES ($1, '01000000001', 'LGU', 'BBBBBB', 'hash-stuck-2', 'claimed', 2, NOW() - INTERVAL '3 minutes')`,
      [r2[0]],
    );
    await runSpamProbeCycle();
    expect((await resultOf(r2[0])).result).toBe('error');
  });

  it('본문 없는 보고 = 확인 문자를 쓰는 단말이면 무시 · 그 밖 단말은 종전 짝짓기', async () => {
    expect(await matchProbeReport({ devicePhone: '01000000001', carrier: 'LGU', messageContent: '' })).toBe('ignored');
    expect(await matchProbeReport({ devicePhone: '01000000002', carrier: 'KT', messageContent: '' })).toBe('none');
    expect(await matchProbeReport({ devicePhone: '01000000002', carrier: 'KT', messageContent: '일반 검사 문안' })).toBe('none');
  });
});

describe('같은 검사 이어 보기(spamCheckFor) · 지금 결과', () => {
  it('같은 회사 · 회신번호 · 해시 · 유형 · 제목 · 오늘 = 그 검사 · 제목이 다르면 없음 · 결과 = 확인 중', async () => {
    const hash = computeMessageHash('이어 보기 문안 1101');
    const { testId } = await newTest({ minutesAgo: 1, hash, rows: [{ phone: '01000000001', carrier: 'LGU', result: 'unconfirmed' }, { phone: '01000000002', carrier: 'KT', result: 'pass', received: true }] });
    const same = await spamCheckFor({ companyId: CO, callback: '02-1544-1234', hash, msgType: 'SMS', subject: null });
    expect(same?.testId).toBe(testId);
    expect(same?.outcome).toBe('unconfirmed');
    expect(await spamCheckFor({ companyId: CO, callback: CB, hash, msgType: 'SMS', subject: '다른 제목' })).toBeNull();
    expect(await spamCheckFor({ companyId: CO, callback: CB, hash, msgType: 'LMS', subject: null })).toBeNull();
  });
  it('어제 검사는 잇지 않는다(한국 날짜) · 진행 중 = pending · 결과 0행 = error', async () => {
    const hash = computeMessageHash('어제 문안 1101');
    await newTest({ minutesAgo: 60 * 30, hash, rows: [{ phone: '01000000001', carrier: 'LGU', result: 'pass', received: true }] });
    expect(await spamCheckFor({ companyId: CO, callback: CB, hash, msgType: 'SMS', subject: null })).toBeNull();
    const { testId } = await newTest({ minutesAgo: 0, rows: [{ phone: '01000000001', carrier: 'LGU', result: null }] });
    await pool.query(`UPDATE spam_filter_tests SET status = 'active' WHERE id = $1`, [testId]);
    expect((await readSpamTestOutcome(testId)).outcome).toBe('pending');
    const empty = await newTest({ minutesAgo: 0, rows: [] });
    expect((await readSpamTestOutcome(empty.testId)).outcome).toBe('error');
  });
});

describe('하루 측정(R36)', () => {
  it('처음 확인 중 → 최종 통과 비율 · 확정 뒤 수신 1건 이상 = 경보', async () => {
    const { testId, rowIds } = await newTest({ minutesAgo: 1, rows: [{ phone: '01000000009', carrier: 'SKT', result: null }] });
    await decideSpamResult('unconfirmed', rowIds[0]);
    await pool.query(`UPDATE spam_filter_test_results SET result = 'pass', received = true, decided_at = NOW() WHERE id = $1`, [rowIds[0]]);
    const late = await newTest({ minutesAgo: 1, rows: [{ phone: '01000000009', carrier: 'SKT', result: 'blocked' }] });
    await noteAfterDecidedReport(late.testId, '01000000009', 'SKT', 'SMS');
    expect((await resultOf(late.rowIds[0])).late_report_at).not.toBeNull();
    const m = await measureSpamVerdicts();
    const skt = m!.rows.find((x) => x.carrier === 'SKT' && x.phone === '01000000009')!;
    expect(skt.unconfirmed).toBe(1);
    expect(skt.passed).toBe(1);
    expect(skt.afterDecided).toBe(1);
    expect(ctl.alerts).toContain('spam-verdict-after-decided');
    void testId;
  });
});

describe('구현 2라운드(Codex 구현 1R) — 한 문장 · 한 트랜잭션', () => {
  it('같은 키 동시 등록 둘 = 검사 하나(키 잠금 아래 다시 찾음 · 둘째는 이어 보기)', async () => {
    const p = { companyId: CO, userId: US, callbackNumber: CB, messageContentSms: '동시 등록 시험 문안 1101', messageType: 'SMS' as const, source: 'auto_ai' as const, skipPrepaid: true, reuseSameDay: true };
    const [a, b] = await Promise.all([enqueueSpamTest(p), enqueueSpamTest(p)]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.testId).toBe(b.testId);
    expect([a.reused, b.reused].filter(Boolean)).toHaveLength(1);
    const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM spam_filter_tests WHERE message_content_sms = $1`, [p.messageContentSms])).rows[0].n;
    expect(n).toBe(1);
  });
  it('닫힌 확인 문자인데 원 행이 확인 중이면 주기가 그 결과로 맞춘다(받음 = 차단 · 기한 지남 = 장애)', async () => {
    const r1 = await newTest({ minutesAgo: 50, rows: [{ phone: '01000000001', carrier: 'LGU', result: 'unconfirmed' }] });
    const r2 = await newTest({ minutesAgo: 50, rows: [{ phone: '01000000001', carrier: 'LGU', result: 'unconfirmed' }] });
    await pool.query(
      `INSERT INTO spam_test_probes (result_id, phone, carrier, nonce, message_hash, status) VALUES
         ($1, '01000000001', 'LGU', 'CCCCCC', 'hash-recon-1', 'received'), ($2, '01000000001', 'LGU', 'DDDDDD', 'hash-recon-2', 'expired')`,
      [r1.rowIds[0], r2.rowIds[0]],
    );
    await runSpamProbeCycle();
    expect((await resultOf(r1.rowIds[0])).result).toBe('blocked');
    expect((await resultOf(r2.rowIds[0])).result).toBe('error');
  });
  it('확인 문자 받음 = 확인 문자 닫기와 원 행 차단이 한 문장(늦은 보고가 먼저 통과로 고친 행은 그대로)', async () => {
    const { rowIds } = await newTest({ minutesAgo: 60, rows: [{ phone: '01000000001', carrier: 'LGU', result: 'unconfirmed' }] });
    await runSpamProbeCycle();
    const nonce = (await pool.query(`SELECT nonce FROM spam_test_probes WHERE result_id = $1`, [rowIds[0]])).rows[0].nonce;
    await pool.query(`UPDATE spam_filter_test_results SET result = 'pass', received = true WHERE id = $1`, [rowIds[0]]);
    expect(await matchProbeReport({ devicePhone: '01000000001', carrier: 'LGU', messageContent: probeText(nonce) })).toBe('probe');
    expect((await resultOf(rowIds[0])).result).toBe('pass');
    expect((await pool.query(`SELECT status FROM spam_test_probes WHERE result_id = $1`, [rowIds[0]])).rows[0].status).toBe('received');
  });
  it('대행발송 검사 중 후보 = 상태 되돌림과 한 문장(setStatus 꼴 · 캐스트 없는 jsonb 칸 · 소유권 토큰 조건) · 지우기', async () => {
    const R = '00000000-0000-0000-0000-0000000f3101';
    const TOK = '00000000-0000-0000-0000-0000000f4101';
    await insertMinimalRow(pool, 'agency_send_requests', { id: R, company_id: CO, callback_number: CB, original_content: '원문', current_content: '원문', requested_at: new Date(), manager_phone: '01000000000', phone_column: 'phone', lock_token: TOK, last_test_result: JSON.stringify({ batchId: 'b1' }) });
    const cur = (await pool.query(`SELECT last_test_result, content_version FROM agency_send_requests WHERE id = $1`, [R])).rows[0];
    // setStatus 가 만드는 문장 꼴 그대로(status = $2 · lock_at · lock_token · last_test_result = $n · 토큰 조건)
    const SET = `UPDATE agency_send_requests SET status = $2, revision = revision + 1, updated_at = NOW(), lock_at = $3, lock_token = $4, last_test_result = $5 WHERE id = $1::uuid AND lock_token = $6::uuid`;
    const other = await pool.query(SET, [R, 'received', null, null, heldResultJson(cur, '다듬은 글', 2), '00000000-0000-0000-0000-000000000000']);
    expect(other.rowCount).toBe(0);
    await pool.query(SET, [R, 'received', null, null, heldResultJson(cur, '다듬은 글', 2), TOK]);
    const row = (await pool.query(`SELECT status, lock_token, last_test_result, content_version FROM agency_send_requests WHERE id = $1`, [R])).rows[0];
    expect([row.status, row.lock_token]).toEqual(['received', null]);
    expect(row.last_test_result.batchId).toBe('b1');
    expect(row.last_test_result.heldCandidate).toEqual({ content: '다듬은 글', rounds: 2, version: Number(row.content_version) });
    await pool.query(`UPDATE agency_send_requests SET lock_token = $2 WHERE id = $1`, [R, TOK]);
    await pool.query(SET, [R, 'received', null, null, heldResultJson(row, null, 0), TOK]);
    const after = (await pool.query(`SELECT last_test_result FROM agency_send_requests WHERE id = $1`, [R])).rows[0].last_test_result;
    expect(after).toEqual({ batchId: 'b1' });
    expect(heldResultJson({ last_test_result: null }, null, 0)).toBeNull();
  });
});

describe('보내기 전 재작성 후보(DDL-D)', () => {
  it('claim = 최신 판일 때만 · 판마다 한 번(taken) · 저장 = 내 토큰 · 정산 직전 확인', async () => {
    await insertMinimalRow(pool, 'journeys', { id: JO, company_id: CO, created_by: US, name: '시험 여정', status: 'active', start_kind: 'event', trigger_event: 'customer.created', callback_number: CB });
    expect(await claimCandidate(JO, ST, '00000000-0000-0000-0000-0000000f1101')).toBe('stale');
    const c = await claimCandidate(JO, ST, SNAP);
    expect(typeof c === 'object' && c.token).toBeTruthy();
    const token = (c as { token: string }).token;
    expect(await claimCandidate(JO, ST, SNAP)).toBe('taken');
    expect(await candidateStillMine(SNAP, token)).toBe(true);
    expect(await saveCandidate(SNAP, '00000000-0000-0000-0000-000000000000', '남의 글', null)).toBe(false);
    expect(await saveCandidate(SNAP, token, '고친 글', null)).toBe(true);
    expect(await candidateStillMine(SNAP, token)).toBe(false);
    const row = await readCandidate(SNAP);
    expect([row?.status, row?.body]).toEqual(['testing', '고친 글']);
    // ★ 2026-11-02 검사 통과 = testing → passed(한 번만 · 원문 반영은 applyPassedCandidate)
    expect(await moveCandidate(SNAP, ['testing'], 'passed')).toBe(true);
    expect(await moveCandidate(SNAP, ['testing'], 'passed')).toBe(false);
    expect((await readCandidate(SNAP))?.status).toBe('passed');
  });
  it('만드는 중 10분 넘음 = failed · 실제 차감이 있으면 크레딧 환불(원 키 · 고정 환불 키) · 차감 0 이면 환불 0', async () => {
    const S2 = '00000000-0000-0000-0000-0000000e2101';
    const S3 = '00000000-0000-0000-0000-0000000e3101';
    for (const s of [S2, S3]) {
      await insertMinimalRow(pool, 'journey_step_snapshots', { id: s, company_id: CO, journey_id: JO, step_id: ST });
      await pool.query(
        `INSERT INTO journey_pretest_candidates (snapshot_id, step_id, status, claim_token, claimed_at) VALUES ($1, $2, 'generating', gen_random_uuid(), NOW() - INTERVAL '11 minutes')`,
        [s, ST],
      );
    }
    ctl.charged.set(regenChargeKey(CO, S2), 1);
    const out = await sweepPretestCandidates();
    expect(out.expired).toBe(2);
    expect((await readCandidate(S2))?.status).toBe('failed');
    expect(ctl.refunds).toEqual([`refund:${regenChargeKey(CO, S2)}`]);
  });
});
