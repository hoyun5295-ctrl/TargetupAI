/**
 * 한 번뿐인 사건 경보 = 항목 키로 모아 보내기(★ 2026-11-02 설계 docs/2026-11-01-credit-control-tower-design.md §17 · 대장 R14 넓힘)
 *
 * 못 박는 것(자리마다 판정 자리에서)
 *   1. 서로 다른 사건 = 서로 다른 항목 키(옛: 공용 · 메일함 키라 쿨다운 안의 둘째 사건이 버려졌다) · 같은 사건을 다시 보면 같은 키
 *   2. 닫기 계약 — 사건을 닫는 쓰기(반려 · 실패로 닫음 · 경로 비움 · 이상 행 닫음)는 원장 넣기가 참일 때만 · 넣은 항목만(설계 2R)
 *   3. A4 묶음 조회 실패 = 넣지도 닫지도 않음 · A5 후보 = 커서 순환(닫지 못한 줄이 뒤 PDF 를 막지 않는다 · 설계 3R)
 *   4. 주기 패스(C1) = 실패를 모아 한 주기 1통
 *   5. B1 테스트 발송 환불 = 요청 참조:종류 · 미룬 묶음 실행기(묶음 끝에 원장 · 다음 묶음이 던져도 남음) · 한 번 보내기 회복(한 회차 1통)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const m = vi.hoisted(() => ({
  persistOk: true,
  persisted: [] as any[],
  queued: [] as any[],
  alerted: [] as any[],
  flushed: [] as string[],
  calls: [] as Array<{ sql: string; params: any[] }>,
  handler: ((_sql: string, _params: any[]) => ({ rows: [] as any[], rowCount: 0 })) as (sql: string, params: any[]) => any,
  groups: {} as Record<string, number>,
  groupFail: false,
  execs: [] as Array<{ sql: string; params: any[] }>,
  sender: { outcome: 'unregistered' } as any,
  refund: null as null | ((key: string) => any),
}));

vi.mock('../../config/database', () => ({
  default: { connect: vi.fn(async () => { throw new Error('시험에서 연결 안 함'); }), query: vi.fn() },
  query: vi.fn(async (sql: string, params: any[] = []) => { m.calls.push({ sql, params }); return m.handler(sql, params); }),
  withTransaction: vi.fn(async () => { throw new Error('시험에서 트랜잭션 안 씀'); }),
  lockPool: { connect: vi.fn(async () => { throw new Error('주입: 잠금 연결 실패'); }) },
}));
vi.mock('../system-alert', async (orig) => ({
  ...(await orig<any>()),
  persistPassFailures: vi.fn(async (o: any) => { m.persisted.push(o); return m.persistOk; }),
  queuePassFailures: vi.fn(async (o: any) => { m.queued.push(o); }),
  flushPassAlerts: vi.fn(async (pass: string) => { m.flushed.push(pass); return 0; }),
  alertPassFailures: vi.fn(async (o: any) => { m.alerted.push(o); return 0; }),
  sendSystemAlert: vi.fn(async () => 0),
}));
vi.mock('../sms-queue', async (orig) => ({
  ...(await orig<any>()),
  getQueueTableSets: vi.fn(async () => ({ bulk: ['SMSQ_SEND_1'], bito: ['SMSQ_SEND_B1'], all: ['SMSQ_SEND_1', 'SMSQ_SEND_B1'] })),
  smsCountAll: vi.fn(async (_t: string[], where: string, params: any[]) => {
    if (where.includes("rsv1 = '3'")) return 0;   // QTmsg 만료 규칙 = 이번 시험 밖
    if (m.execs.length > 0) return 0;              // 닫은 뒤 다시 세기
    return params.reduce((n: number, g: string) => n + (m.groups[g] || 0), 0);
  }),
  smsGroupByAll: vi.fn(async (_t: string[], field: string) => {
    if (field.includes('CONCAT')) { if (m.groupFail) throw new Error('mysql gone'); return { ...m.groups }; }
    return {};   // 캠페인별 로그용
  }),
  smsExecAll: vi.fn(async (_t: string[], sql: string, params: any[]) => { m.execs.push({ sql, params }); }),
}));
vi.mock('../agency-send-email', async (orig) => ({ ...(await orig<any>()), resolveEmailSender: vi.fn(async () => m.sender) }));
vi.mock('../ai-credit', async (orig) => ({
  ...(await orig<any>()),
  chargedAmountByKey: vi.fn(async () => 3),
  refundCredit: vi.fn(async (o: any) => { if (m.refund) return m.refund(o.idempotencyKey); return { refunded: true }; }),
}));

beforeEach(() => {
  m.persistOk = true; m.persisted.length = 0; m.queued.length = 0; m.alerted.length = 0; m.flushed.length = 0; m.calls.length = 0;
  m.handler = () => ({ rows: [], rowCount: 0 }); m.groups = {}; m.groupFail = false; m.execs.length = 0;
  m.sender = { outcome: 'unregistered' }; m.refund = null;
});
const keysOf = (o: any) => o.failures.map((f: any) => f.key);

describe('A4 발송 대기열 이상 상태값 닫기(expired-pending-sweeper)', () => {
  it('묶음(캠페인 · 상태값)마다 한 항목 · 넣은 묶음만 UPDATE 조건에 싣는다', async () => {
    const { sweepExpiredPendingOnce } = await import('../expired-pending-sweeper');
    m.groups = { 'camp-1|67108964': 12, '|70000000': 1 };
    const out = await sweepExpiredPendingOnce();
    expect(m.persisted).toHaveLength(1);
    expect(m.persisted[0].pass).toBe('queue-abnormal-status-closed');
    expect(keysOf(m.persisted[0])).toEqual(['camp-1:67108964', '-:70000000']);
    expect(m.persisted[0].failures[0].error).toContain('상태값 67108964 · 12행');
    expect(m.execs).toHaveLength(1);
    expect(m.execs[0].sql).toContain("CONCAT(COALESCE(app_etc1, ''), '|', status_code) IN (?, ?)");
    expect(m.execs[0].params).toEqual(['camp-1|67108964', '|70000000']);
    expect(m.flushed).toEqual(['queue-abnormal-status-closed']);
    expect(out).toEqual({ failed: 13, remain: 0 });
  });

  it('설계 1R-2 — 닫기가 실패해 다음 분에 같은 행을 다시 보면 같은 키(새 사건으로 세지 않는다)', async () => {
    const { sweepExpiredPendingOnce } = await import('../expired-pending-sweeper');
    m.groups = { 'camp-1|67108964': 12 };
    m.persistOk = false;   // 이번 분 = 못 닫음
    await sweepExpiredPendingOnce();
    m.persistOk = true;
    await sweepExpiredPendingOnce();
    expect(m.persisted.map(keysOf)).toEqual([['camp-1:67108964'], ['camp-1:67108964']]);
  });

  it('설계 2R-2 — 묶음 조회 실패 = 넣지도 닫지도 않는다(다음 분)', async () => {
    const { sweepExpiredPendingOnce } = await import('../expired-pending-sweeper');
    m.groups = { 'camp-1|67108964': 12 };
    m.groupFail = true;
    await sweepExpiredPendingOnce();
    expect(m.persisted).toHaveLength(0);
    expect(m.execs).toHaveLength(0);
  });

  it('설계 2R-1 — 원장 넣기가 거짓이면 닫지 않는다(남은 행 = 그대로 · 다음 분에 같은 키로)', async () => {
    const { sweepExpiredPendingOnce } = await import('../expired-pending-sweeper');
    m.groups = { 'camp-1|67108964': 12 };
    m.persistOk = false;
    const out = await sweepExpiredPendingOnce();
    expect(m.execs).toHaveLength(0);
    expect(out).toEqual({ failed: 0, remain: 12 });
    expect(m.flushed).toEqual([]);
  });
});

describe('A5 보관 기한 풀분석 PDF(retention-sweeper)', () => {
  let tmp = '';
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-a5-')); });
  afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 무시 */ } });

  it('밖 경로 = 작업 id 마다 한 항목 · 원장에 넣은 때만 그 작업 경로를 비운다', async () => {
    const { sweepExpiredAnalysisPdfs } = await import('../retention-sweeper');
    const pdfDir = path.join(tmp, 'pdfs');
    fs.mkdirSync(pdfDir, { recursive: true });
    m.handler = (sql) => (sql.includes('FROM full_analysis_jobs')
      ? { rows: [{ id: 'job-a', pdf_path: path.join(tmp, 'x', 'a.pdf'), at_text: 't1', bound_text: 'b' }, { id: 'job-b', pdf_path: path.join(tmp, 'y', 'b.pdf'), at_text: 't2', bound_text: 'b' }] }
      : { rows: [], rowCount: 1 });
    await sweepExpiredAnalysisPdfs({ pdfDir });
    expect(keysOf(m.persisted[0])).toEqual(['job-a', 'job-b']);
    expect(m.persisted[0].pass).toBe('retention-pdf-outside');
    const clear = m.calls.filter((c) => c.sql.startsWith('UPDATE full_analysis_jobs'));
    expect(clear.map((c) => c.params)).toEqual([[['job-a', 'job-b']]]);
    expect(m.flushed).toEqual(['retention-pdf-outside']);
  });

  it('설계 2R-1 — 원장 넣기가 거짓이면 경로를 비우지 않는다(다음 바퀴에 다시)', async () => {
    const { sweepExpiredAnalysisPdfs } = await import('../retention-sweeper');
    m.persistOk = false;
    m.handler = (sql) => (sql.includes('FROM full_analysis_jobs')
      ? { rows: [{ id: 'job-a', pdf_path: path.join(tmp, 'x', 'a.pdf'), at_text: 't1', bound_text: 'b' }] }
      : { rows: [], rowCount: 1 });
    await sweepExpiredAnalysisPdfs({ pdfDir: path.join(tmp, 'pdfs') });
    expect(m.calls.filter((c) => c.sql.startsWith('UPDATE full_analysis_jobs'))).toEqual([]);
  });

  it('설계 3R — 후보 = 커서 순환: 꽉 찬 회차 뒤에는 마지막 줄 뒤부터(상한 그대로) · 덜 차면 새 바퀴', async () => {
    const { sweepExpiredAnalysisPdfs } = await import('../retention-sweeper');
    m.persistOk = false;   // 원장 표 없음 = 밖 경로 1,000 이 그대로 남는 꼴(Codex 3R)
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `job-${i}`, pdf_path: path.join(tmp, 'out', `${i}.pdf`), at_text: `2026-07-01 00:00:${String(i % 60).padStart(2, '0')}+00`, bound_text: '2026-08-04 00:00:00+00' }));
    const sels: any[][] = [];
    let n = 0;
    m.handler = (sql, params) => {
      if (!sql.includes('FROM full_analysis_jobs')) return { rows: [], rowCount: 0 };
      sels.push(params);
      n += 1;
      return { rows: n === 1 ? full : [{ id: 'job-late', pdf_path: path.join(tmp, 'pdfs', 'late.pdf'), at_text: '2026-07-02 00:00:00+00', bound_text: '2026-08-04 00:00:00+00' }] };
    };
    await sweepExpiredAnalysisPdfs({ pdfDir: path.join(tmp, 'pdfs') });
    await sweepExpiredAnalysisPdfs({ pdfDir: path.join(tmp, 'pdfs') });
    await sweepExpiredAnalysisPdfs({ pdfDir: path.join(tmp, 'pdfs') });
    expect(sels[0]).toEqual([null, null, null]);
    expect(sels[1]).toEqual([full[999].at_text, 'job-999', '2026-08-04 00:00:00+00']);   // 막힌 1,000 줄 뒤부터 · 상한 그대로
    expect(sels[2]).toEqual([null, null, null]);   // 덜 찬 회차 = 새 바퀴(막힌 줄은 다시)
    const del = m.calls.filter((c) => c.sql.startsWith('UPDATE full_analysis_jobs'));
    expect(del.map((c) => c.params[0])).toContainEqual(['job-late']);   // 뒤 정상 PDF 는 지워졌다
  });
});

describe('A1 · A2 대행발송 메일함(agency-send-mail-worker)', () => {
  const ctxOf = (from: string, uidl: string) => ({
    client: { top: vi.fn(async () => Buffer.from(`From: ${from}\r\nMessage-ID: <${uidl}@example.invalid>\r\nSubject: t\r\n\r\n`)) } as any,
    mailbox: 'intake@example.invalid', octets: new Map<number, number>(), now: new Date(),
  });
  const intakeDb = () => {
    let id = 0;
    m.handler = (sql) => {
      if (sql.includes('FROM agency_send_email_intake WHERE mailbox')) return { rows: [] };
      if (sql.startsWith('INSERT INTO agency_send_email_intake')) return { rows: [{ id: `intake-${++id}`, status: 'claimed', attempt_count: 1 }] };
      return { rows: [], rowCount: 1 };
    };
  };
  const rejects = () => m.calls.filter((c) => c.sql.includes('UPDATE agency_send_email_intake') && c.params[1] === 'rejected');

  it('A1 — 미등록 발신 = 보낸 주소(소문자)마다 한 항목 · 원장에 넣은 때만 반려로 닫는다', async () => {
    const { processMessage } = await import('../agency-send-mail-worker');
    intakeDb();
    await processMessage(ctxOf('Kim <Kim@Example.invalid>', 'u1'), 1, 'u1');
    await processMessage(ctxOf('lee@example.invalid', 'u2'), 2, 'u2');
    expect(m.persisted.map(keysOf)).toEqual([['kim@example.invalid'], ['lee@example.invalid']]);
    expect(m.persisted[0].pass).toBe('agency-mail-unknown-sender');
    expect(rejects()).toHaveLength(2);
    expect(m.flushed).toEqual(['agency-mail-unknown-sender', 'agency-mail-unknown-sender']);
  }, 30000);

  it('A1 설계 2R-1 · 구현 1R · 2R — 원장 넣기가 거짓이면 반려로 닫지 않는다(미등록 판정 = 선점과 같은 쓰기 · 틱 앞 단계가 다시 넣는다)', async () => {
    const { processMessage } = await import('../agency-send-mail-worker');
    intakeDb();
    m.persistOk = false;
    await processMessage(ctxOf('park@example.invalid', 'u3'), 3, 'u3');
    expect(m.persisted).toHaveLength(1);
    expect(rejects()).toHaveLength(0);
    const claim = m.calls.filter((c) => c.sql.startsWith('INSERT INTO agency_send_email_intake'));
    expect(claim).toHaveLength(1);
    expect(claim[0].params[5]).toBe('unregistered');
    expect(m.calls.some((c) => c.sql.startsWith("UPDATE agency_send_email_intake SET reason = 'unregistered'"))).toBe(false);   // 따로 하던 표식 쓰기 0(틈 0)
  }, 30000);

  it('구현 2R — 미등록 판정 = 선점과 같은 쓰기(실패 재선점 · 멈춘 선점 재선점 · 새 행 셋 다)', async () => {
    const { claimIntake } = await import('../agency-send-mail-worker');
    const old = '2020-01-01T00:00:00Z';
    for (const existing of [
      { id: 'f1', status: 'failed', attempt_count: 3, claimed_at: old, next_attempt_at: null },
      { id: 's1', status: 'claimed', attempt_count: 2, claimed_at: old, next_attempt_at: null },
      null,
    ]) {
      m.calls.length = 0;
      m.handler = (sql) => (sql.includes('FROM agency_send_email_intake WHERE mailbox') ? { rows: existing ? [existing] : [] } : { rows: [{ id: 'r', status: 'claimed', attempt_count: 1 }] });
      expect(await claimIntake('intake@example.invalid', 'u1', null, 'h', 'x@example.invalid', 'unregistered')).toEqual({ id: 'r', status: 'claimed', attempt_count: 1 });
      const write = m.calls.find((c) => /^(UPDATE|INSERT INTO) agency_send_email_intake/.test(c.sql));
      expect(write!.sql).toMatch(/reason = COALESCE\(\$\d, reason\)|status, reason\)/);
      expect(write!.params).toContain('unregistered');
    }
  });

  it('구현 2R — 일반 catch(markProcessFailure)는 경보만 남은 접수(마지막 시도의 미등록 판정)를 실패로 덮지 않는다 · 보통 행은 그대로 실패 + 다음 시도', async () => {
    const { markProcessFailure } = await import('../agency-send-mail-worker');
    const rowOf = (uidl: string, reason: string | null, attempt: number) => ({
      id: `id-${uidl}`, uidl, status: 'claimed', attempt_count: attempt, claimed_at: new Date().toISOString(), next_attempt_at: null, reason, from_email: 'x@example.invalid',
    });
    let current: any = null;
    m.handler = (sql) => (sql.includes('uidl = ANY($2::text[])') ? { rows: current ? [current] : [] } : { rows: [], rowCount: 1 });
    const failsFor = (id: string) => m.calls.filter((c) => c.sql.includes('SET status = $2') && c.params[0] === id && c.params[1] === 'failed');
    current = rowOf('m1', 'unregistered', 4);
    await markProcessFailure('intake@example.invalid', 'm1', new Error('일시 장애'));
    expect(failsFor('id-m1')).toHaveLength(0);
    current = rowOf('m2', null, 2);
    await markProcessFailure('intake@example.invalid', 'm2', new Error('일시 장애'));
    expect(failsFor('id-m2')).toHaveLength(1);
  });

  it('A2 · 구현 1R — 선점 소진 = 메일함:uidl 마다 한 항목 · 원장에 넣은 때만 실패로 닫는다(틱 앞 단계 · 메일함 호출 0) · 선점 함수는 닫지도 경보하지도 않는다', async () => {
    const { closeAlertPendingIntakes, claimIntake } = await import('../agency-send-mail-worker');
    const old = '2020-01-01T00:00:00Z';
    const rows = [
      { id: '1', uidl: 'u8', status: 'claimed', attempt_count: 4, claimed_at: old, next_attempt_at: null, reason: null, from_email: null },
      { id: '2', uidl: 'u9', status: 'claimed', attempt_count: 4, claimed_at: old, next_attempt_at: null, reason: 'timeout', from_email: null },
    ];
    const fails = () => m.calls.filter((c) => c.sql.includes("SET status = 'failed'"));
    m.persistOk = false;
    await closeAlertPendingIntakes('intake@example.invalid', rows);
    expect(fails()).toHaveLength(0);
    m.persistOk = true;
    await closeAlertPendingIntakes('intake@example.invalid', rows);
    expect(fails()).toHaveLength(1);
    expect(fails()[0].params[0]).toEqual(['1', '2']);   // 넣은 항목만
    expect(m.persisted.map(keysOf)).toEqual([['intake@example.invalid:u8', 'intake@example.invalid:u9'], ['intake@example.invalid:u8', 'intake@example.invalid:u9']]);
    expect(m.persisted[0].pass).toBe('agency-mail-claim-exhausted');
    m.handler = (sql) => (sql.includes('FROM agency_send_email_intake WHERE mailbox')
      ? { rows: [{ id: 'row-1', status: 'claimed', attempt_count: 4, claimed_at: old, next_attempt_at: null }] }
      : { rows: [], rowCount: 0 });
    expect(await claimIntake('intake@example.invalid', 'u8', null, 'h', null)).toBeNull();
    expect(m.persisted).toHaveLength(2);
    expect(fails()).toHaveLength(1);
  }, 30000);

  it('구현 1R(high) — 경보만 남은 접수는 처리 목록에 안 들어간다 = 앞자리 10통(소진 5 · 미등록 판정 5)이 원장 장애로 남아도 뒤 메일이 처리된다', async () => {
    const { pickIntakeTodo, alertPendingKind } = await import('../agency-send-mail-worker');
    const now = Date.parse('2026-11-02T00:00:00Z');
    const old = '2026-11-01T00:00:00Z';
    const pending = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), uidl: `p${i}`, status: 'claimed', attempt_count: i < 5 ? 4 : 1, claimed_at: old, next_attempt_at: null, reason: i < 5 ? null : 'unregistered', from_email: null,
    }));
    expect(pending.map((r) => alertPendingKind(r, now))).toEqual([...Array(5).fill('claim-exhausted'), ...Array(5).fill('unknown-sender')]);
    const uidls = [...pending.map((r, i) => ({ seq: i + 1, uidl: r.uidl })), { seq: 11, uidl: 'new-1' }, { seq: 12, uidl: 'stale-1' }];
    const known = [...pending, { id: '99', uidl: 'stale-1', status: 'claimed', attempt_count: 2, claimed_at: old, next_attempt_at: null, reason: null, from_email: null }];
    expect(pickIntakeTodo(uidls, known, now).map((u) => u.uidl)).toEqual(['new-1', 'stale-1']);   // 옛: p0 ~ p9 가 틱 10칸을 매분 다 차지
  });

  it('구현 1R(medium) · 2R — 틱 배선: 경보만 남은 접수 닫기 = 잠금 직후 한 번(메일함 상태 · 연결 · 빈 메일함 앞) · 그 실패는 틱을 막지 않는다 · 처리 목록 = pickIntakeTodo · 일반 catch = markProcessFailure', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'agency-send-mail-worker.ts'), 'utf8');
    const tick = src.slice(src.indexOf('export async function runAgencyMailTick('));
    const close = tick.indexOf('await closeAlertPendingForMailbox(mailbox).catch(');
    expect(close).toBeGreaterThan(tick.indexOf('held = true;'));
    expect(close).toBeLessThan(tick.indexOf('const state = await loadMailState(mailbox);'));
    expect(close).toBeLessThan(tick.indexOf('Pop3Client.connect('));
    expect(close).toBeLessThan(tick.indexOf('if (uidls.length === 0) return;'));
    expect(tick.split('closeAlertPendingForMailbox(').length - 1).toBe(1);
    expect(tick).toContain('const todo = pickIntakeTodo(uidls, known, Date.now());');
    expect(tick).not.toContain('CLAIM_STALE_MS) return true;');   // 처리 목록 판정은 pickIntakeTodo 한 곳(두 벌 0)
    expect(tick).toContain('await markProcessFailure(mailbox, u.uidl, err);');
  });
});

describe('A3 · C1', () => {
  it('A3 — 멈춘 시도 = 접수마다 한 항목(키 = 접수 id)', async () => {
    const { alertStuckAttempt } = await import('../agency-send-worker');
    alertStuckAttempt('req-1');
    alertStuckAttempt('req-2');
    await vi.waitFor(() => expect(m.alerted).toHaveLength(2));
    expect(m.alerted.map(keysOf)).toEqual([['req-1'], ['req-2']]);
    expect(m.alerted[0].pass).toBe('agency-dispatch-stuck');
    expect(m.alerted[0].total).toBeUndefined();   // 사건 모드
  }, 60000);

  it('C1 — 재작성 환불 대조 실패 = 한 주기 1통(판마다 항목 · 주기 모드) · 성공한 판은 빠진다', async () => {
    const { sweepPretestCandidates } = await import('../journey-pretest-candidate');
    m.handler = (sql) => {
      if (sql.includes('information_schema.tables')) return { rows: [{ n: 1 }] };
      if (sql.startsWith('UPDATE journey_pretest_candidates')) return { rows: [] };
      if (sql.includes("c.status = 'failed'")) return { rows: [{ snapshot_id: 's1', company_id: 'co-1' }, { snapshot_id: 's2', company_id: 'co-2' }, { snapshot_id: 's3', company_id: 'co-3' }] };
      return { rows: [] };
    };
    m.refund = (key) => { if (key.includes(':s2')) return { refunded: true }; throw new Error('db timeout'); };
    await sweepPretestCandidates();
    expect(m.alerted).toHaveLength(1);
    expect(m.alerted[0].pass).toBe('journey-pretest-regen-refund');
    expect(keysOf(m.alerted[0])).toEqual(['s1', 's3']);
    expect(m.alerted[0].total).toBe(3);
  }, 30000);
});

describe('B1 · 미룬 묶음(실행기 · 한 번 보내기 회복)', () => {
  it('B1 — 테스트 발송 환불 미완 = 요청 참조:종류마다 한 항목(옛: 회사:종류 키 6시간 = 같은 회사 둘째 요청의 환불이 버려졌다) · 사건 모드', async () => {
    const { reportTestRefundMiss } = await import('../prepaid');
    await reportTestRefundMiss({ companyId: 'co-1', ref: 'test-r1', type: 'SMS', count: 2, kind: '실패 환불 미완' });
    await reportTestRefundMiss({ companyId: 'co-1', ref: 'test-r2', type: 'SMS', count: 1, kind: '실패 환불 미완' });
    await reportTestRefundMiss({ companyId: 'co-1', ref: 'test-r1', type: 'SMS', count: 2, kind: '보상 환불 실패' });
    expect(m.queued.map(keysOf)).toEqual([['test-r1:SMS'], ['test-r2:SMS'], ['test-r1:SMS']]);   // 같은 요청 · 종류 = 같은 항목
    expect(m.queued.every((o) => o.pass === 'test-refund-miss' && o.total === undefined)).toBe(true);
    await vi.waitFor(() => expect(m.flushed).toEqual(['test-refund-miss', 'test-refund-miss', 'test-refund-miss']));
  });

  it('B1 — 라우트 4곳 = 응답 전에 원장(await) · 요청 참조 키 · 옛 회사 · 종류 키 0', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
    expect(src.match(/await reportTestRefundMiss\(\{ companyId, ref: TEST_REF, type: (?:doneType|axis\.type), count: /g)).toHaveLength(4);
    expect(src).not.toContain('test-refund-miss:');
  });

  it('실행기 — 실패로 닫은 실행 = 묶음 끝에 원장(항목 = 실행 · 사건 모드) · 다음 묶음 조회가 던져도 사라지지 않는다', async () => {
    const { runJourneyExecutor } = await import('../journey-executor');
    let due = 0;
    // ★ 1102 묶음 발송 — 묶음 먼저 고르기(WITH due) → 그 (여정 · 칸) 실행 → 묶음 처리 예외 = 실행 집합 전부 기록(상한 = failed)
    m.handler = (sql) => {
      if (sql.includes('WITH due AS (')) {
        due += 1;
        if (due === 1) return { rows: [{ journey_id: 'j-1', current_step_order: 0, company_id: 'co-1' }] };
        throw new Error('db gone');
      }
      if (sql.includes('WHERE e.journey_id = $1::uuid AND e.current_step_order = $2')) return { rows: [{ execution_id: 'exe-1', journey_id: 'j-1', company_id: 'co-1', current_step_order: 0 }, { execution_id: 'exe-2', journey_id: 'j-1', company_id: 'co-1', current_step_order: 0 }] };
      if (sql.includes('SELECT je.id FROM journey_executions je JOIN journeys j')) throw new Error('주입: 처리 실패');
      if (sql.startsWith('UPDATE journey_executions') && sql.includes('error_count')) return { rows: [{ id: 'exe-1', status: 'failed' }, { id: 'exe-2', status: 'failed' }] };
      return { rows: [] };
    };
    await expect(runJourneyExecutor()).rejects.toThrow('db gone');
    expect(m.alerted).toHaveLength(1);
    expect(m.alerted[0].pass).toBe('journey-exec-failed');
    expect(keysOf(m.alerted[0]).sort()).toEqual(['exe-1', 'exe-2']);   // 같은 여정의 둘째 실행도 따로(옛: 여정 키 6시간)
    expect(m.alerted[0].total).toBeUndefined();
  }, 60000);

  it('한 번 보내기 회복 — 넣기 실패 = 한 회차 1통(항목 = 여정 · 주기 모드 · 대상 = 이번 회차에 본 여정 수)', async () => {
    const { recoverPendingOneShots, resetOneShotRecoveryCursor } = await import('../journey-anchor-scheduler');
    resetOneShotRecoveryCursor();
    m.handler = (sql) => {
      if (sql.includes('information_schema.columns') && sql.includes('one_shot_dispatch_pending_at')) return { rows: [{ n: 2 }] };
      if (sql.includes("start_kind = 'one_shot'") && sql.includes('LIMIT')) return { rows: [{ id: 'j-1', company_id: 'co-1', approved_by: null }, { id: 'j-2', company_id: 'co-1', approved_by: null }] };
      return { rows: [] };
    };
    expect(await recoverPendingOneShots()).toEqual({ checked: 2, dispatched: 0 });   // 잠금 연결 = 주입 실패(목업 lockPool)
    expect(m.alerted).toHaveLength(1);
    expect(m.alerted[0].pass).toBe('journey-one-shot-dispatch');
    expect(keysOf(m.alerted[0])).toEqual(['j-1', 'j-2']);
    expect(m.alerted[0].total).toBe(2);
  }, 60000);
});
