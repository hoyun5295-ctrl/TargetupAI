/**
 * 운영 기록 대장 계약 (★2026-10-03 전송자격인증 3.1 ④ · 3.3 · 4.3)
 *
 * 왜 있나
 *   이 대장은 심사에 「점검했다 · 바꿨다」의 증거로 낸다. 날짜를 지어낼 수 있거나, 쓴 뒤에 고칠 수 있거나,
 *   쓴 사람이 스스로 확인할 수 있으면 증거가 아니다(Harold 1003 「날짜는 실제대로」).
 *
 * 못 박는 것
 *   1. 작성 시각은 서버 시각(감사 기록 행)이다. 점검 대상 월은 이번 달보다 뒤일 수 없다. 변경 일시는 미래일 수 없다.
 *   2. 고치기 · 지우기가 없다(이 CT 에 UPDATE · DELETE 문이 없다). 정정은 있는 기록을 가리키는 새 기록이다.
 *   3. 작성자는 확인할 수 없고, 확인은 기록마다 한 번이며 기록 id 로 잠근 뒤 판단한다.
 *   4. 작성자 · 확인자 이름은 계정에서 읽는다(화면이 보낸 값을 쓰지 않는다).
 *   5. 한줄로 로그 점검은 서버가 그 달을 세어 기록에 얼린다(화면이 보낸 수치를 쓰지 않는다).
 *   6. 실패를 삼키지 않는다(대장 작성이 조용히 사라지면 기록이 아니다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const client = { query: vi.fn(), release: vi.fn() };
vi.mock('../../config/database', () => {
  const pool = { connect: vi.fn() };
  return { query: vi.fn(), pool, default: pool };
});

import pool, { query } from '../../config/database';
import {
  validateOpsRecord, currentKstMonth, createOpsRecord, confirmOpsRecord, listOpsRecords, loadOpsActor,
  OpsRecordError, OPS_ACTION_CREATED, OPS_ACTION_CONFIRMED,
} from '../ops-records';

const q = query as unknown as ReturnType<typeof vi.fn>;
const connect = (pool as any).connect as ReturnType<typeof vi.fn>;
const NOW = new Date('2026-10-03T07:00:00+09:00');
const ACTOR = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', loginId: 'ceo', name: '유호윤' };
const OTHER = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', loginId: 'suran', name: '서수란' };
const REC_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const expectReject = (fn: () => unknown, message: RegExp) => {
  try {
    fn();
  } catch (e: any) {
    expect(e).toBeInstanceOf(OpsRecordError);
    expect(e.message).toMatch(message);
    return;
  }
  throw new Error('거절되지 않았다');
};

beforeEach(() => {
  q.mockReset();
  connect.mockReset();
  client.query.mockReset();
  client.release.mockReset();
  connect.mockResolvedValue(client);
});

describe('입력 검사 — 날짜를 지어내지 못한다', () => {
  const base = { kind: 'log_review', system: 'hanjul', period: '2026-09', title: '9월 점검', content: '이상 없음' };

  it('한국 시각 기준 이번 달', () => {
    expect(currentKstMonth(new Date('2026-09-30T15:30:00Z'))).toBe('2026-10');
    expect(currentKstMonth(new Date('2026-09-30T14:59:00Z'))).toBe('2026-09');
  });

  it('지난 달 · 이번 달 점검은 받고, 다음 달은 거절한다', () => {
    expect(validateOpsRecord(base, NOW).period).toBe('2026-09');
    expect(validateOpsRecord({ ...base, period: '2026-10' }, NOW).period).toBe('2026-10');
    expectReject(() => validateOpsRecord({ ...base, period: '2026-11' }, NOW), /이번 달보다 뒤/);
    expectReject(() => validateOpsRecord({ ...base, period: '2026-9' }, NOW), /대상 월/);
    expectReject(() => validateOpsRecord({ ...base, period: '2025-12' }, NOW), /확인해/);
  });

  it('작성 시각을 입력으로 받지 않는다(넘겨도 버린다)', () => {
    const out: any = validateOpsRecord({ ...base, createdAt: '2026-09-01T00:00:00+09:00', recorder: { name: '가짜' } }, NOW);
    expect(out.createdAt).toBeUndefined();
    expect(out.recorder).toBeUndefined();
  });

  it('이상이 있으면 후속 조치가 필요하다', () => {
    expectReject(() => validateOpsRecord({ ...base, anomaly: true }, NOW), /후속 조치/);
    expect(validateOpsRecord({ ...base, anomaly: true, followUp: '시험 Agent 정지' }, NOW).anomaly).toBe(true);
  });

  it('게이트웨이 점검은 근거가 필요하다(이 화면이 직접 세지 못한다)', () => {
    expectReject(() => validateOpsRecord({ ...base, system: 'gateway' }, NOW), /근거/);
    expect(validateOpsRecord({ ...base, system: 'gateway', evidence: '접속 이력 9월 성공 718 · 거부 15' }, NOW).system).toBe('gateway');
  });

  it('방화벽 변경 — 미래 일시 · 사유 없음 · 근거 없음을 거절한다', () => {
    const fw = { kind: 'firewall_change', system: 'gateway', title: '9443 출발지 추가', content: 'ufw allow', reason: '고객사 연동', evidence: '명령 기록 0908', occurredAt: '2026-09-08T21:26:00+09:00' };
    expect(validateOpsRecord(fw, NOW).occurredAt).toBe('2026-09-08T12:26:00.000Z');
    expectReject(() => validateOpsRecord({ ...fw, occurredAt: '2026-10-04T00:00:00+09:00' }, NOW), /지금보다 뒤/);
    // ★(Codex 1R) 허용치 없음 — 1분 뒤도 거절한다(자정 직전에 「내일」 변경이 들어가지 않게)
    expectReject(() => validateOpsRecord({ ...fw, occurredAt: '2026-10-03T07:01:00+09:00' }, NOW), /지금보다 뒤/);
    expect(validateOpsRecord({ ...fw, occurredAt: '2026-10-03T07:00:00+09:00' }, NOW).occurredAt).toBe('2026-10-02T22:00:00.000Z');
    expectReject(() => validateOpsRecord({ ...fw, reason: ' ' }, NOW), /사유/);
    expectReject(() => validateOpsRecord({ ...fw, evidence: '' }, NOW), /근거/);
    expectReject(() => validateOpsRecord({ ...fw, occurredAt: 'x' }, NOW), /변경 일시/);
  });

  it('종류 · 시스템 · 요지 · 내용 · 정정 대상 형식', () => {
    expectReject(() => validateOpsRecord({ ...base, kind: 'other' }, NOW), /종류/);
    expectReject(() => validateOpsRecord({ ...base, system: 'x' }, NOW), /시스템/);
    expectReject(() => validateOpsRecord({ ...base, title: '' }, NOW), /요지/);
    expectReject(() => validateOpsRecord({ ...base, content: '' }, NOW), /점검 내용/);
    expectReject(() => validateOpsRecord({ ...base, supersedes: 'not-a-uuid' }, NOW), /정정할 기록/);
  });
});

describe('작성', () => {
  it('서버가 그 달을 세어 얼려 두고, 작성자는 계정 값 · 작성 시각은 DB 시각이다', async () => {
    const calls: Array<{ sql: string; params: any[] }> = [];
    q.mockImplementation(async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (/GROUP BY action/.test(sql)) return { rows: [{ action: 'login_fail', n: 12 }, { action: 'mfa_locked', n: 1 }] };
      if (/HAVING COUNT\(\*\) >= 5/.test(sql)) return { rows: [{ login_id: 'abc', fails: 7, ips: 2 }] };
      if (/INSERT INTO audit_logs/.test(sql)) return { rows: [{ created_at: '2026-10-03T07:01:02.000Z' }] };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
    const input = validateOpsRecord({ kind: 'log_review', system: 'hanjul', period: '2026-09', title: '9월', content: '확인', anomaly: false }, NOW);
    const saved = await createOpsRecord({ input, actor: ACTOR });
    expect(saved.createdAt).toBe('2026-10-03T07:01:02.000Z');
    const ins = calls.find((c) => /INSERT INTO audit_logs/.test(c.sql))!;
    expect(ins.params[0]).toBe(ACTOR.id);
    expect(ins.params[1]).toBe(OPS_ACTION_CREATED);
    expect(ins.params[3]).toBe(saved.id);
    const details = JSON.parse(ins.params[4]);
    expect(details.recorder).toEqual({ id: ACTOR.id, loginId: 'ceo', name: '유호윤' });
    expect(details.summary.month).toBe('2026-09');
    expect(details.summary.counts.login_fail).toBe(12);
    expect(details.summary.counts.login_success).toBe(0);
    expect(details.summary.failConcentration).toEqual([{ loginId: 'abc', fails: 7, ips: 2 }]);
    // 그 달의 범위를 한국 시각으로 자른다
    expect(calls.find((c) => /GROUP BY action/.test(c.sql))!.sql).toContain("AT TIME ZONE 'Asia/Seoul'");
  });

  it('입력에 작성자가 섞여 들어와도 계정 값으로 덮는다', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/INSERT INTO audit_logs/.test(sql)) return { rows: [{ created_at: '2026-10-03T07:01:02.000Z' }] };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
    const input: any = { ...validateOpsRecord({ kind: 'access_review', system: 'common', period: '2026-09', title: 't', content: 'c' }, NOW),
      recorder: { id: OTHER.id, loginId: 'fake', name: '가짜' } };
    await createOpsRecord({ input, actor: ACTOR });
    expect(JSON.parse(q.mock.calls[0][1][4]).recorder).toEqual({ id: ACTOR.id, loginId: 'ceo', name: '유호윤' });
  });

  it('게이트웨이 · 방화벽 기록은 서버 집계를 붙이지 않는다', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/INSERT INTO audit_logs/.test(sql)) return { rows: [{ created_at: '2026-10-03T07:01:02.000Z' }] };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
    const input = validateOpsRecord({ kind: 'firewall_change', system: 'gateway', title: 't', content: 'c', reason: 'r', evidence: 'e', occurredAt: '2026-09-08T21:26:00+09:00' }, NOW);
    await createOpsRecord({ input, actor: ACTOR });
    const details = JSON.parse(q.mock.calls[0][1][4]);
    expect(details.summary).toBeNull();
  });

  it('정정 대상이 없으면 쓰지 않는다', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/SELECT 1 FROM audit_logs/.test(sql)) return { rows: [] };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
    const input = validateOpsRecord({ kind: 'access_review', system: 'common', period: '2026-09', title: 't', content: 'c', supersedes: REC_ID }, NOW);
    await expect(createOpsRecord({ input, actor: ACTOR })).rejects.toThrow('정정할 기록');
    expect(q.mock.calls.some((c) => /INSERT/.test(c[0]))).toBe(false);
  });

  it('저장 실패를 삼키지 않는다', async () => {
    q.mockImplementation(async () => { throw new Error('db down'); });
    const input = validateOpsRecord({ kind: 'access_review', system: 'common', period: '2026-09', title: 't', content: 'c' }, NOW);
    await expect(createOpsRecord({ input, actor: ACTOR })).rejects.toThrow('db down');
  });
});

describe('확인 — 작성자 아닌 사람이 한 번만', () => {
  function wire(opts: { recorderId?: string; exists?: boolean; confirmed?: boolean }) {
    client.query.mockImplementation(async (sql: string, params: any[]) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/SELECT user_id, details FROM audit_logs/.test(sql)) {
        expect(params[0]).toBe(OPS_ACTION_CREATED);
        return { rows: opts.exists === false ? [] : [{ user_id: opts.recorderId, details: { recorder: { id: opts.recorderId } } }] };
      }
      if (/SELECT 1 FROM audit_logs/.test(sql)) {
        expect(params[0]).toBe(OPS_ACTION_CONFIRMED);
        return { rows: opts.confirmed ? [{ '?column?': 1 }] : [] };
      }
      if (/INSERT INTO audit_logs/.test(sql)) return { rows: [{ created_at: '2026-10-03T08:00:00.000Z' }] };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
  }

  it('다른 관리자는 확인할 수 있다 — 기록 id 로 잠근 뒤 넣는다', async () => {
    wire({ recorderId: ACTOR.id });
    const done = await confirmOpsRecord({ recordId: REC_ID, actor: OTHER, comment: '확인함' });
    expect(done.confirmedAt).toBe('2026-10-03T08:00:00.000Z');
    const sqls = client.query.mock.calls.map((c) => c[0]);
    const lockAt = sqls.findIndex((s) => /pg_advisory_xact_lock/.test(s));
    const checkAt = sqls.findIndex((s) => /SELECT 1 FROM audit_logs/.test(s));
    const insAt = sqls.findIndex((s) => /INSERT INTO audit_logs/.test(s));
    expect(lockAt).toBeGreaterThan(0);
    expect(checkAt).toBeGreaterThan(lockAt);
    expect(insAt).toBeGreaterThan(checkAt);
    expect(client.query.mock.calls[lockAt][1]).toEqual([`ops_record:${REC_ID}`]);
    expect(sqls).toContain('COMMIT');
    const ins = client.query.mock.calls[insAt][1];
    expect(ins[1]).toBe(OPS_ACTION_CONFIRMED);
    expect(JSON.parse(ins[4]).confirmer).toEqual({ id: OTHER.id, loginId: 'suran', name: '서수란' });
    expect(client.release).toHaveBeenCalled();
  });

  it('작성자 본인은 확인할 수 없다', async () => {
    wire({ recorderId: ACTOR.id });
    await expect(confirmOpsRecord({ recordId: REC_ID, actor: ACTOR })).rejects.toThrow('작성한 사람은 확인할 수 없습니다');
    expect(client.query.mock.calls.some((c) => /INSERT/.test(c[0]))).toBe(false);
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
  });

  it('이미 확인된 기록은 다시 확인하지 않는다', async () => {
    wire({ recorderId: ACTOR.id, confirmed: true });
    await expect(confirmOpsRecord({ recordId: REC_ID, actor: OTHER })).rejects.toThrow('이미 확인된');
  });

  it('★(Codex 1R) 기록 번호를 대문자로 보내도 소문자 하나로 잠그고 조회 · 저장한다', async () => {
    wire({ recorderId: ACTOR.id });
    await confirmOpsRecord({ recordId: REC_ID.toUpperCase(), actor: OTHER });
    const calls = client.query.mock.calls;
    const lock = calls.find((c) => /pg_advisory_xact_lock/.test(c[0]))!;
    expect(lock[1]).toEqual([`ops_record:${REC_ID}`]);
    for (const c of calls.filter((c) => /audit_logs/.test(c[0]))) {
      expect(c[1]).toContain(REC_ID);
      expect(c[1]).not.toContain(REC_ID.toUpperCase());
    }
  });

  it('정정 대상 번호도 소문자로 접는다', () => {
    const out = validateOpsRecord({ kind: 'access_review', system: 'common', period: '2026-09', title: 't', content: 'c', supersedes: REC_ID.toUpperCase() }, NOW);
    expect(out.supersedes).toBe(REC_ID);
  });

  it('없는 기록 · 형식이 틀린 id', async () => {
    wire({ exists: false });
    await expect(confirmOpsRecord({ recordId: REC_ID, actor: OTHER })).rejects.toThrow('찾지 못했습니다');
    await expect(confirmOpsRecord({ recordId: 'x', actor: OTHER })).rejects.toThrow('찾지 못했습니다');
  });
});

describe('목록 · 작성자 조회', () => {
  it('확인 여부를 붙여 돌려주고, 모르는 걸러보기 값은 무시한다', async () => {
    q.mockImplementation(async (_sql: string, params: any[]) => {
      expect(params[4]).toBeNull();
      expect(params[5]).toBe('gateway');
      return {
        rows: [{
          id: REC_ID, created_at: '2026-10-03T07:01:02.000Z',
          details: { kind: 'log_review', system: 'gateway', period: '2026-09', title: 't', content: 'c', anomaly: true, followUp: 'f', evidence: 'e', recorder: { id: ACTOR.id, loginId: 'ceo', name: '유호윤' } },
          confirmed_at: '2026-10-03T08:00:00.000Z',
          confirm_details: { confirmer: { loginId: 'suran', name: '서수란' }, comment: 'ok' },
        }],
      };
    });
    const rows = await listOpsRecords({ kind: 'drop table', system: 'gateway' });
    expect(rows[0]).toMatchObject({ id: REC_ID, kind: 'log_review', anomaly: true, confirmedAt: '2026-10-03T08:00:00.000Z', confirmer: { loginId: 'suran', name: '서수란' } });
    expect(rows[0].recorder).toEqual({ loginId: 'ceo', name: '유호윤' });
  });

  it('작성자는 사용 중인 슈퍼관리자 계정에서 읽는다', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: ACTOR.id, login_id: 'ceo', name: '유호윤' }] });
    expect(await loadOpsActor(ACTOR.id)).toEqual(ACTOR);
    expect(q.mock.calls[0][0]).toContain('is_active = true');
    q.mockResolvedValueOnce({ rows: [] });
    expect(await loadOpsActor(OTHER.id)).toBeNull();
    expect(await loadOpsActor(null)).toBeNull();
  });
});

describe('배선', () => {
  const SRC = resolve(__dirname, '../..');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => (l.trimStart().startsWith('//') ? '' : l)).join('\n');

  it('고치기 · 지우기 문장이 없다(대장은 쌓이기만 한다)', () => {
    const ct = strip(readFileSync(join(SRC, 'utils/ops-records.ts'), 'utf8'));
    expect(ct).not.toMatch(/UPDATE\s+audit_logs/i);
    expect(ct).not.toMatch(/DELETE\s+FROM\s+audit_logs/i);
    expect(ct).not.toContain('recordAuditLog');
    const route = strip(readFileSync(join(SRC, 'routes/admin-ops-records.ts'), 'utf8'));
    expect(route).not.toMatch(/router\.(put|patch|delete)\(/);
  });

  it('조회는 canRead, 작성 · 확인 · 집계는 canWrite 로 막는다', () => {
    const route = readFileSync(join(SRC, 'routes/admin-ops-records.ts'), 'utf8');
    expect(route).toContain('router.use(authenticate, requireSuperAdmin);');
    const block = (start: string) => route.slice(route.indexOf(start), route.indexOf('\n});', route.indexOf(start)));
    expect(block("router.get('/', ")).toContain("canRead(role, 'opsRecords')");
    expect(block("router.post('/', ")).toContain("canWrite(role, 'opsRecords')");
    expect(block("router.post('/:id/confirm'")).toContain("canWrite(role, 'opsRecords')");
    expect(block("router.get('/log-review-summary'")).toContain("canWrite(role, 'opsRecords')");
    expect(readFileSync(join(SRC, 'app.ts'), 'utf8')).toContain("app.use('/api/admin/ops-records', adminOpsRecordsRoutes);");
  });

  it('등급표 — 대표 · 지원팀장은 작성 · 확인, 지원팀원은 조회만', async () => {
    const { PERMISSION_MATRIX } = await import('../admin-role');
    const row = PERMISSION_MATRIX.find((r) => r.key === 'opsRecords');
    expect(row?.levels).toEqual({ super: 'RW', lead: 'RW', support: 'R' });
  });

  it('화면 — 작성일 칸이 없고, 고치기 · 지우기 버튼이 없고, 자기 기록에는 확인 버튼이 없다', () => {
    const tab = readFileSync(resolve(SRC, '../../frontend/src/components/admin/OpsRecordsTab.tsx'), 'utf8');
    expect(tab).not.toMatch(/createdAt:\s*form/);
    expect(tab).not.toMatch(/method: '(PUT|PATCH|DELETE)'/);
    expect(tab).toContain('canConfirm={!!meta?.canWrite && !r.confirmedAt && !mine}');
    expect(tab).not.toMatch(/\b(alert|confirm|prompt)\(/);
  });

  it('★(Codex 2R) 화면의 「지금」은 서버 시각 기준이다 — 서버가 시각을 내려 주고 화면이 그 차이를 반영한다', () => {
    const route = readFileSync(join(SRC, 'routes/admin-ops-records.ts'), 'utf8');
    expect(route).toContain('serverNow: new Date().toISOString(),');
    const tab = readFileSync(resolve(SRC, '../../frontend/src/components/admin/OpsRecordsTab.tsx'), 'utf8');
    expect(tab).toContain('serverClockOffsetMs = serverMs - Date.now();');
    expect(tab).toContain('const d = new Date(Date.now() + serverClockOffsetMs + 9 * 3600_000);');
    expect(tab).toContain('max={nowLocalInput() || undefined}');
    // ★(Codex 3R) 서버 시각을 못 받았으면 「지금」을 만들지 않는다
    expect(tab).toContain("if (!serverClockSynced) return '';");
    expect(tab).toMatch(/serverClockSynced = true;[\s\S]{0,80}\} else \{\s*serverClockSynced = false;/);
  });
});
