/**
 * sender-auth — 발신 인증(추가 인증) 판정 (★2026-09-12 전송자격인증 3.5)
 *
 * 무엇을 지키는가
 *   이 게이트 코드는 시범 명단과 무관하게 **전 고객의 발송 경로를 지나간다.**
 *   판정이 한 번 틀리면 고객 발송이 통째로 막힌다. 그래서 "막는다"보다 "안 막는다"를 먼저 못 박는다.
 *
 * 못 박는 것:
 *   1. 스위치가 없으면 **아무도** 인증을 요구받지 않는다 — 배포만으로는 발송이 바뀌지 않는다.
 *   2. 명단 밖 고객은 번호가 있고 스위치가 켜져 있어도 요구받지 않는다.
 *   3. 다중인증(3.4)과 **축이 분리되어 있다** — 한쪽 스위치가 다른 쪽을 켜지 않는다.
 *   4. 담당자 번호가 없으면 요구하지 않는다(보낼 곳이 없다).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SYSTEM_SMS_CALLBACK = '18008125';
});
vi.mock('../config/database', () => ({ query: vi.fn(), mysqlQuery: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('./sms-queue', () => ({
  getAuthSmsTable: vi.fn(async () => 'SMSQ_SEND_11'),
  getTestSmsTables: vi.fn(async () => ['SMSQ_SEND_10']),
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { query, mysqlQuery } from '../config/database';
import {
  isSenderAuthEnforced, isSenderAuthPilotTarget, isSenderAuthRequiredFor,
  isSenderAuthSchemaMissing, senderNumberKey, evaluateSenderAuthSession,
  SENDER_AUTH_TRUST_HOURS, SENDER_AUTH_MAX_ATTEMPTS, SENDER_AUTH_ANY_CALLBACK,
  checkSenderAuthGate, verifySenderAuthChallenge,
} from './sender-auth';

const NOW = new Date('2026-09-12T12:00:00+09:00');
const PILOT = { login_id: 'hoyun', mfa_phone: '01052958517' };

const KEYS = ['SENDER_AUTH_ENFORCE_FROM', 'SENDER_AUTH_PILOT_LOGIN_IDS', 'MFA_ENFORCE_FROM', 'MFA_PILOT_LOGIN_IDS'];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function enablePilot() {
  process.env.SENDER_AUTH_ENFORCE_FROM = '2026-09-12T00:00:00+09:00';
  process.env.SENDER_AUTH_PILOT_LOGIN_IDS = 'hoyun,psy5868,suran';
}

describe('안 막는다 — 통제가 켜지기 전에는 아무도 영향을 받지 않는다', () => {
  it('★스위치가 없으면 시범 명단 계정도 요구받지 않는다', () => {
    delete process.env.SENDER_AUTH_ENFORCE_FROM;
    process.env.SENDER_AUTH_PILOT_LOGIN_IDS = 'hoyun,psy5868,suran';
    expect(isSenderAuthEnforced(NOW)).toBe(false);
    expect(isSenderAuthRequiredFor(PILOT, NOW)).toBe(false);
  });

  it('★명단 밖 고객은 스위치가 켜져 있어도 요구받지 않는다', () => {
    enablePilot();
    expect(isSenderAuthRequiredFor({ login_id: 'kumkang4', mfa_phone: '01012345678' }, NOW)).toBe(false);
  });

  it('시행일 값이 날짜가 아니면 미시행 — 오타로 전 고객 발송을 막지 않는다', () => {
    process.env.SENDER_AUTH_ENFORCE_FROM = '구월십이일';
    process.env.SENDER_AUTH_PILOT_LOGIN_IDS = 'hoyun';
    expect(isSenderAuthEnforced(NOW)).toBe(false);
    expect(isSenderAuthRequiredFor(PILOT, NOW)).toBe(false);
  });

  it('시행일 전이면 미시행', () => {
    process.env.SENDER_AUTH_ENFORCE_FROM = '2026-09-20T00:00:00+09:00';
    process.env.SENDER_AUTH_PILOT_LOGIN_IDS = 'hoyun';
    expect(isSenderAuthRequiredFor(PILOT, NOW)).toBe(false);
  });

  it('담당자 번호가 없으면 명단 계정이어도 요구하지 않는다 (보낼 곳이 없다)', () => {
    enablePilot();
    expect(isSenderAuthRequiredFor({ login_id: 'hoyun', mfa_phone: null }, NOW)).toBe(false);
    expect(isSenderAuthRequiredFor({ login_id: 'hoyun', mfa_phone: '' }, NOW)).toBe(false);
  });

  it('계정 정보 자체가 없으면 요구하지 않는다', () => {
    enablePilot();
    expect(isSenderAuthRequiredFor(null as any, NOW)).toBe(false);
    expect(isSenderAuthRequiredFor({}, NOW)).toBe(false);
  });
});

describe('막는다 — 시범 명단 계정은 인증을 요구받는다', () => {
  it('스위치 + 명단 + 번호가 다 맞으면 요구한다', () => {
    enablePilot();
    expect(isSenderAuthRequiredFor(PILOT, NOW)).toBe(true);
    expect(isSenderAuthRequiredFor({ login_id: 'suran', mfa_phone: '01030635257' }, NOW)).toBe(true);
    expect(isSenderAuthRequiredFor({ login_id: 'PSY5868', mfa_phone: '01055775868' }, NOW)).toBe(true);
  });

  it('명단 판정은 대소문자·공백을 무시한다', () => {
    process.env.SENDER_AUTH_ENFORCE_FROM = '2026-09-12T00:00:00+09:00';
    process.env.SENDER_AUTH_PILOT_LOGIN_IDS = ' hoyun , psy5868 ';
    expect(isSenderAuthPilotTarget(' HOYUN ')).toBe(true);
    expect(isSenderAuthPilotTarget('suran')).toBe(false);
  });
});

describe('★축 분리 — 다중인증 스위치가 발신 인증을 켜지 않는다', () => {
  it('다중인증만 켜져 있으면 발신 인증은 미시행', () => {
    delete process.env.SENDER_AUTH_ENFORCE_FROM;
    delete process.env.SENDER_AUTH_PILOT_LOGIN_IDS;
    process.env.MFA_ENFORCE_FROM = '2026-09-11T00:00:00+09:00';
    process.env.MFA_PILOT_LOGIN_IDS = 'hoyun,psy5868,suran';
    expect(isSenderAuthEnforced(NOW)).toBe(false);
    expect(isSenderAuthRequiredFor(PILOT, NOW)).toBe(false);
  });

  it('발신 인증만 켜져 있어도 발신 인증은 시행된다', () => {
    delete process.env.MFA_ENFORCE_FROM;
    delete process.env.MFA_PILOT_LOGIN_IDS;
    enablePilot();
    expect(isSenderAuthRequiredFor(PILOT, NOW)).toBe(true);
  });

  it('발신 인증 명단은 자기 ENV만 본다 — 다중인증 명단을 빌려 쓰지 않는다', () => {
    process.env.SENDER_AUTH_ENFORCE_FROM = '2026-09-12T00:00:00+09:00';
    process.env.SENDER_AUTH_PILOT_LOGIN_IDS = 'suran';
    process.env.MFA_PILOT_LOGIN_IDS = 'hoyun';
    expect(isSenderAuthPilotTarget('suran')).toBe(true);
    expect(isSenderAuthPilotTarget('hoyun')).toBe(false);
  });

  /**
   * ★ Codex 적대검토 high — 시행일만 넣고 명단을 빠뜨리면 담당자 번호가 등록된 **전 고객**이 걸린다.
   * 다중인증은 그 의미(빈 명단 = 전면)를 이미 쓰고 있어 건드리지 않고, 발신 인증만 반대로 접는다.
   */
  it('★명단이 비면 발신 인증은 시행되지 않는다 — 실수 한 번이 전 고객 차단이 되지 않는다', () => {
    process.env.SENDER_AUTH_ENFORCE_FROM = '2026-09-12T00:00:00+09:00';
    delete process.env.SENDER_AUTH_PILOT_LOGIN_IDS;
    expect(isSenderAuthPilotTarget('kumkang4')).toBe(false);
    expect(isSenderAuthRequiredFor(PILOT, NOW)).toBe(false);
    process.env.SENDER_AUTH_PILOT_LOGIN_IDS = '  ,  ';
    expect(isSenderAuthRequiredFor(PILOT, NOW)).toBe(false);
  });
});

/**
 * 24시간 세션 — 기준 3.5의 "동일 세션·일정 시간 유지 + 접속환경 변경 시 재인증".
 * 못 박는 것: 시간이 남아 있어도 **접속 환경이 바뀌면 다시 묻는다**. 탈취 계정이 하루를 그냥 쓰지 못한다.
 */
describe('24시간 세션 판정', () => {
  const REQ: any = { ip: '119.203.154.248', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' } };
  const LIVE = {
    ip_address: '119.203.154.99',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0)',
    age_seconds: 23 * 3600,
  };

  it('인증한 적이 없으면 첫 인증', () => {
    expect(evaluateSenderAuthSession(null, REQ)).toEqual({ alive: false, reason: 'first' });
    expect(evaluateSenderAuthSession(undefined, REQ)).toEqual({ alive: false, reason: 'first' });
  });

  it('24시간 안 · 같은 IP 대역 · 같은 브라우저면 통과한다', () => {
    expect(evaluateSenderAuthSession(LIVE, REQ)).toEqual({ alive: true });
  });

  it('24시간이 지나면 만료', () => {
    const old = { ...LIVE, age_seconds: SENDER_AUTH_TRUST_HOURS * 3600 + 1 };
    expect(evaluateSenderAuthSession(old, REQ)).toEqual({ alive: false, reason: 'expired' });
  });

  it('★IP 대역이 바뀌면 시간이 남아 있어도 재인증', () => {
    const moved = { ...LIVE, ip_address: '211.234.56.78' };
    expect(evaluateSenderAuthSession(moved, REQ)).toEqual({ alive: false, reason: 'environment' });
  });

  it('★브라우저가 바뀌면 시간이 남아 있어도 재인증', () => {
    const other = { ...LIVE, user_agent: 'Mozilla/5.0 (iPhone)' };
    expect(evaluateSenderAuthSession(other, REQ)).toEqual({ alive: false, reason: 'environment' });
  });

  it('★경과 시간이 문자열로 와도 숫자로 읽는다 (PG numeric은 문자열로 온다)', () => {
    expect(evaluateSenderAuthSession({ ...LIVE, age_seconds: '82800' as any }, REQ)).toEqual({ alive: true });
    expect(evaluateSenderAuthSession({ ...LIVE, age_seconds: '90000' as any }, REQ)).toEqual({ alive: false, reason: 'expired' });
  });

  it('경과 시간을 못 읽으면 만료로 본다 — 모르면 다시 묻는다', () => {
    expect(evaluateSenderAuthSession({ ...LIVE, age_seconds: null as any }, REQ)).toEqual({ alive: false, reason: 'expired' });
    expect(evaluateSenderAuthSession({ ...LIVE, age_seconds: 'NaN' as any }, REQ)).toEqual({ alive: false, reason: 'expired' });
  });
});

describe('발신번호 비교 키 — 표기가 달라도 같은 번호는 같은 키', () => {
  it('숫자만 남긴다', () => {
    expect(senderNumberKey('02-3467-8612')).toBe('0234678612');
    expect(senderNumberKey(' 1644-3583 ')).toBe('16443583');
    expect(senderNumberKey('031)393-2100')).toBe('0313932100');
  });

  it('값이 없으면 빈 문자열 — 빈 키로는 세션이 성립하지 않는다', () => {
    expect(senderNumberKey(null)).toBe('');
    expect(senderNumberKey(undefined)).toBe('');
    expect(senderNumberKey('  ')).toBe('');
  });
});

describe('테이블 미생성 감지 — 기능만 쉬고 발송은 살린다', () => {
  it('42P01과 relation does not exist를 잡는다', () => {
    expect(isSenderAuthSchemaMissing({ code: '42P01' })).toBe(true);
    expect(isSenderAuthSchemaMissing({ message: 'relation "sender_auth_challenges" does not exist' })).toBe(true);
  });

  it('그 밖의 오류는 스키마 문제가 아니다', () => {
    expect(isSenderAuthSchemaMissing({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isSenderAuthSchemaMissing(null)).toBe(false);
  });
});

/**
 * 발송 게이트 — 이 코드는 시범 명단과 무관하게 전 고객의 발송 요청이 통과한다.
 * 못 박는 것:
 *   1. 스위치가 꺼져 있으면 DB를 한 번도 건드리지 않는다(비용도 위험도 0).
 *   2. 테이블이 없거나 예상 못 한 오류가 나면 발송을 살린다.
 *   3. 요구할 때만 인증번호를 보낸다 — 통과하는 경로에서는 문자가 나가지 않는다.
 */
describe('발송 게이트', () => {
  const q = query as unknown as ReturnType<typeof vi.fn>;
  const mq = mysqlQuery as unknown as ReturnType<typeof vi.fn>;
  const REQ: any = { ip: '119.203.154.248', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' } };
  const USER = '11111111-1111-1111-1111-111111111111';
  const COMPANY = '22222222-2222-2222-2222-222222222222';
  const BASE = { req: REQ, userId: USER, companyId: COMPANY, callback: '02-3467-8612', recipientCount: 1 };
  const AGENT = 'Mozilla/5.0 (Windows NT 10.0)';

  function wire(opts: { user?: any; session?: any } = {}) {
    q.mockReset();
    mq.mockReset();
    mq.mockResolvedValue({});
    q.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM users/i.test(s)) {
        return { rows: opts.user === null ? [] : [opts.user ?? { login_id: 'hoyun', mfa_phone: '01052958517' }] };
      }
      if (/FROM sender_auth_challenges/i.test(s) && /verified_at IS NOT NULL/i.test(s)) {
        return { rows: opts.session ? [opts.session] : [] };
      }
      if (/FROM sender_auth_challenges/i.test(s)) return { rows: [] };
      if (/INSERT INTO sender_auth_challenges/i.test(s)) return { rows: [{ id: 'sac-1' }] };
      return { rows: [] };
    });
  }

  it('스위치가 없으면 조회 0회로 통과한다 — 전 고객 발송 경로에 비용이 0이다', async () => {
    wire();
    delete process.env.SENDER_AUTH_ENFORCE_FROM;
    const gate = await checkSenderAuthGate(BASE);
    expect(gate).toEqual({ ok: true });
    expect(q).toHaveBeenCalledTimes(0);
    expect(mq).toHaveBeenCalledTimes(0);
  });

  it('명단 밖 계정은 계정 확인 한 번으로 통과한다 — 인증번호를 보내지 않는다', async () => {
    wire({ user: { login_id: 'kumkang4', mfa_phone: '01012345678' } });
    enablePilot();
    const gate = await checkSenderAuthGate(BASE);
    expect(gate).toEqual({ ok: true });
    expect(mq).toHaveBeenCalledTimes(0);
  });

  it('담당자 번호가 없는 계정은 통과한다', async () => {
    wire({ user: { login_id: 'hoyun', mfa_phone: null } });
    enablePilot();
    expect(await checkSenderAuthGate(BASE)).toEqual({ ok: true });
    expect(mq).toHaveBeenCalledTimes(0);
  });

  it('계정 행을 못 찾으면 통과한다', async () => {
    wire({ user: null });
    enablePilot();
    expect(await checkSenderAuthGate(BASE)).toEqual({ ok: true });
  });

  /**
   * ★ Codex 적대검토 high — 발신번호가 없다고 통과시키면 그 발송은 기본번호·개별번호로 나간다.
   * 모르면 통제를 끄는 것이 아니라 **계정 축으로 더 넓게** 잡는다.
   */
  it('★발신번호를 특정할 수 없으면 계정 축으로 인증을 요구한다 — 통과시키지 않는다', async () => {
    wire();
    enablePilot();
    const gate: any = await checkSenderAuthGate({ ...BASE, callback: '' });
    expect(gate.ok).toBe(false);
    const insert = q.mock.calls.find(([sql]: any[]) => /INSERT INTO sender_auth_challenges/i.test(String(sql)));
    expect(insert[1]).toContain(SENDER_AUTH_ANY_CALLBACK);
  });

  it('★개별 회신번호 발송도 계정 축으로 인증을 요구한다 — 번호가 행마다 달라 특정되지 않는다', async () => {
    wire();
    enablePilot();
    const gate: any = await checkSenderAuthGate({ ...BASE, useIndividualCallback: true });
    expect(gate.ok).toBe(false);
    const insert = q.mock.calls.find(([sql]: any[]) => /INSERT INTO sender_auth_challenges/i.test(String(sql)));
    expect(insert[1]).toContain(SENDER_AUTH_ANY_CALLBACK);
    expect(insert[1]).not.toContain('0234678612');
  });

  it('24시간 인증이 살아 있으면 통과한다 — 매번 묻지 않는다', async () => {
    wire({ session: { ip_address: '119.203.154.11', user_agent: AGENT, age_seconds: 3600 } });
    enablePilot();
    expect(await checkSenderAuthGate(BASE)).toEqual({ ok: true });
    expect(mq).toHaveBeenCalledTimes(0);
  });

  it('인증 이력이 없으면 인증을 요구하고 인증번호를 보낸다', async () => {
    wire();
    enablePilot();
    const gate: any = await checkSenderAuthGate(BASE);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('first');
    expect(gate.challengeId).toBe('sac-1');
    expect(gate.maskedPhone).toBe('010-****-8517');
    expect(mq).toHaveBeenCalledTimes(1);
  });

  it('인증번호 평문을 저장하지 않는다', async () => {
    wire();
    enablePilot();
    await checkSenderAuthGate(BASE);
    const insert = q.mock.calls.find(([sql]: any[]) => /INSERT INTO sender_auth_challenges/i.test(String(sql)));
    const sent = String(mq.mock.calls[0][1][2]);
    const code = sent.match(/\d{6}/)[0];
    expect(insert[1]).not.toContain(code);
  });

  it('발신번호는 숫자 키로 저장한다 — 표기가 달라도 같은 인증으로 본다', async () => {
    wire();
    enablePilot();
    await checkSenderAuthGate(BASE);
    const insert = q.mock.calls.find(([sql]: any[]) => /INSERT INTO sender_auth_challenges/i.test(String(sql)));
    expect(insert[1]).toContain('0234678612');
  });

  it('★세션은 인증 성공 축(verified_at)으로만 본다 — 폐기한 코드를 성공으로 읽지 않는다', async () => {
    wire();
    enablePilot();
    await checkSenderAuthGate(BASE);
    const lookup = q.mock.calls.find(([sql]: any[]) =>
      /FROM sender_auth_challenges/i.test(String(sql)) && /ORDER BY verified_at/i.test(String(sql)));
    expect(lookup, '세션 조회가 verified_at 축을 쓰지 않는다').toBeTruthy();
    const discard = q.mock.calls.find(([sql]: any[]) => /UPDATE sender_auth_challenges/i.test(String(sql)));
    expect(String(discard[0]), '폐기가 verified_at을 건드린다').not.toMatch(/verified_at\s*=/);
  });

  it('접속 환경이 바뀌면 시간이 남아 있어도 다시 묻는다', async () => {
    wire({ session: { ip_address: '211.234.56.78', user_agent: AGENT, age_seconds: 3600 } });
    enablePilot();
    const gate: any = await checkSenderAuthGate(BASE);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('environment');
  });

  it('테이블이 아직 없으면 발송을 살린다', async () => {
    wire();
    enablePilot();
    q.mockImplementation(async (sql: string) => {
      if (/FROM users/i.test(String(sql))) return { rows: [{ login_id: 'hoyun', mfa_phone: '01052958517' }] };
      const err: any = new Error('relation "sender_auth_challenges" does not exist');
      err.code = '42P01';
      throw err;
    });
    expect(await checkSenderAuthGate(BASE)).toEqual({ ok: true });
    expect(mq).toHaveBeenCalledTimes(0);
  });

  it('예상 못 한 오류가 나도 발송을 살린다', async () => {
    wire();
    enablePilot();
    q.mockImplementation(async () => { throw new Error('connection terminated'); });
    expect(await checkSenderAuthGate(BASE)).toEqual({ ok: true });
  });

  it('인증번호 발송이 실패해도 발송을 살린다', async () => {
    wire();
    enablePilot();
    mq.mockRejectedValue(new Error('mysql down'));
    expect(await checkSenderAuthGate(BASE)).toEqual({ ok: true });
  });

  /**
   * ★ Codex 적대검토 high — 건수로 재인증을 걸면 인증에 성공해도 같은 건수라 또 걸려 **발송을 끝낼 수 없다**
   *   (일회성 승인 소비 장치가 있어야 성립하는 축이다). 기준 값도 정해지지 않았다.
   *   그래서 이 축을 만들지 않는다 — 건수는 인증 여부를 바꾸지 않는다.
   */
  it('★건수로는 재인증하지 않는다 — 인증에 성공하고도 못 보내는 길을 만들지 않는다', async () => {
    wire({ session: { ip_address: '119.203.154.11', user_agent: AGENT, age_seconds: 3600 } });
    enablePilot();
    expect(await checkSenderAuthGate({ ...BASE, recipientCount: 500000 })).toEqual({ ok: true });
  });

  it('[소스 스캔] 건수 축이 코드에 남아 있지 않다', () => {
    const ct = readFileSync(resolve(__dirname, './sender-auth.ts'), 'utf8');
    expect(ct).not.toMatch(/SENDER_AUTH_BULK_OVER|bulkThreshold|'bulk'/);
  });
});

/**
 * 인증번호 검증 — 못 박는 것:
 *   1. 성공은 `verified_at`을 찍는다. 이것이 24시간 세션의 유일한 근거다.
 *   2. 한 번 쓴 코드는 다시 통과하지 못한다.
 *   3. 시도 한도를 넘기면 잠근다.
 */
describe('인증번호 검증', () => {
  const q = query as unknown as ReturnType<typeof vi.fn>;
  const REQ: any = { ip: '119.203.154.248', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' } };
  const USER = '11111111-1111-1111-1111-111111111111';
  const HASH = bcrypt.hashSync('123456', 8);

  function wireRow(row: any) {
    q.mockReset();
    q.mockImplementation(async (sql: string) => {
      if (/FROM sender_auth_challenges/i.test(String(sql))) return { rows: row ? [row] : [] };
      if (/UPDATE sender_auth_challenges/i.test(String(sql))) return { rows: [{ attempts: (row?.attempts ?? 0) + 1 }] };
      return { rows: [] };
    });
  }

  const LIVE = {
    code_hash: HASH, attempts: 0, phone: '01052958517',
    callback_number: '0234678612', company_id: 'c1', expired: false, consumed: false,
  };

  it('없는 인증 건은 통과하지 않는다', async () => {
    wireRow(null);
    expect(await verifySenderAuthChallenge({ challengeId: 'x', userId: USER, code: '123456', req: REQ })).toEqual({ status: 'invalid', remaining: 0 });
  });

  it('만료된 인증 건', async () => {
    wireRow({ ...LIVE, expired: true });
    expect(await verifySenderAuthChallenge({ challengeId: 'x', userId: USER, code: '123456', req: REQ })).toEqual({ status: 'expired' });
  });

  it('이미 쓴 인증 건은 다시 통과하지 못한다', async () => {
    wireRow({ ...LIVE, consumed: true });
    expect(await verifySenderAuthChallenge({ challengeId: 'x', userId: USER, code: '123456', req: REQ })).toEqual({ status: 'expired' });
  });

  it('코드가 틀리면 시도를 올린다', async () => {
    wireRow(LIVE);
    const verdict = await verifySenderAuthChallenge({ challengeId: 'x', userId: USER, code: '999999', req: REQ });
    expect(verdict.status).toBe('invalid');
    const bump = q.mock.calls.find(([sql]: any[]) => /attempts = attempts \+ 1/i.test(String(sql)));
    expect(bump).toBeTruthy();
  });

  it('시도 한도를 넘긴 인증 건은 잠근다', async () => {
    wireRow({ ...LIVE, attempts: SENDER_AUTH_MAX_ATTEMPTS });
    expect(await verifySenderAuthChallenge({ challengeId: 'x', userId: USER, code: '123456', req: REQ })).toEqual({ status: 'locked' });
  });

  /**
   * ★ Codex 적대검토 high — SELECT와 UPDATE가 갈라져 있으면, 다른 요청이 그 사이에 코드를 잠그거나
   *   폐기해도 정답 요청이 무조건 verified_at을 찍는다. 성공 UPDATE 자체에 조건을 건다.
   */
  it('★성공 기록은 미소비·미만료·시도 한도 안일 때만 남는다 (한 문장으로 원자화)', async () => {
    wireRow(LIVE);
    await verifySenderAuthChallenge({ challengeId: 'x', userId: USER, code: '123456', req: REQ });
    const success = q.mock.calls.find(([sql]: any[]) =>
      /UPDATE sender_auth_challenges/i.test(String(sql)) && /verified_at\s*=\s*NOW\(\)/i.test(String(sql)));
    const sql = String(success[0]);
    expect(sql, '소비 여부를 안 본다').toMatch(/consumed_at IS NULL/);
    expect(sql, '만료 여부를 안 본다').toMatch(/expires_at > NOW\(\)/);
    expect(sql, '시도 한도를 안 본다').toMatch(/attempts </);
  });

  it('★조건에 걸려 한 행도 못 바꾸면 성공이 아니다 — 경쟁에서 진 요청은 통과하지 못한다', async () => {
    q.mockReset();
    q.mockImplementation(async (sql: string) => {
      if (/FROM sender_auth_challenges/i.test(String(sql))) return { rows: [LIVE] };
      return { rows: [] };
    });
    const verdict = await verifySenderAuthChallenge({ challengeId: 'x', userId: USER, code: '123456', req: REQ });
    expect(verdict).toEqual({ status: 'expired' });
  });

  it('★코드가 맞으면 verified_at을 찍는다 — 이것이 24시간 세션의 근거다', async () => {
    wireRow(LIVE);
    const verdict = await verifySenderAuthChallenge({ challengeId: 'x', userId: USER, code: '123456', req: REQ });
    expect(verdict).toEqual({ status: 'ok', callbackNumber: '0234678612' });
    const success = q.mock.calls.find(([sql]: any[]) =>
      /UPDATE sender_auth_challenges/i.test(String(sql)) && /verified_at\s*=\s*NOW\(\)/i.test(String(sql)));
    expect(success, '성공인데 verified_at을 찍지 않는다').toBeTruthy();
  });
});

/**
 * 감사 기록 — 4.1 "추가인증 로그" 증적. 발급·성공 두 종류가 남아야 심사에서 흐름이 보인다.
 * ⛔ 인증번호 평문과 번호 원문은 기록에 남기지 않는다(0911 삭제 기록 원문 제거와 같은 규율).
 */
describe('재발급 쿨다운·오류 기록', () => {
  const q = query as unknown as ReturnType<typeof vi.fn>;
  const ct = readFileSync(resolve(__dirname, './sender-auth.ts'), 'utf8');

  /**
   * ★ Codex 적대검토 medium — 쿨다운 조회가 시도 한도에 걸린 코드를 제외하면,
   *   오답 5회 직후 재시도만으로 60초를 건너뛰고 새 문자·attempts 0인 코드가 나온다(추측 한도 무력화).
   */
  it('★쿨다운 조회는 시도 횟수를 보지 않는다 — 오답으로 쿨다운을 초기화할 수 없다', () => {
    const seg = ct.slice(ct.indexOf('const recent = await query('), ct.indexOf('const alive = recent.rows[0]'));
    expect(seg, '쿨다운 조회가 attempts를 본다').not.toMatch(/attempts/);
    expect(seg).toMatch(/created_at/);
  });

  /**
   * ★ Codex 적대검토 medium — mysql2는 오류 객체에 매개변수가 끼워진 SQL을 담는다.
   *   인증문자 적재가 실패하면 그 SQL에 담당자 번호와 평문 인증번호가 들어 있다.
   */
  it('★판정 실패 기록에 오류 객체를 통째로 넘기지 않는다', () => {
    const seg = ct.slice(ct.indexOf('[발신인증]'));
    expect(seg, '오류 객체를 그대로 찍는다').not.toMatch(/,\s*error\s*\)/);
  });
});

describe('감사 기록', () => {
  const q = query as unknown as ReturnType<typeof vi.fn>;
  const mq = mysqlQuery as unknown as ReturnType<typeof vi.fn>;
  const REQ: any = { ip: '119.203.154.248', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' } };
  const USER = '11111111-1111-1111-1111-111111111111';

  function auditRows() {
    return q.mock.calls.filter(([sql]: any[]) => /INSERT INTO audit_logs/i.test(String(sql))).map((c: any[]) => c[1]);
  }

  it('★인증을 요구하면 요청 기록이 남는다', async () => {
    q.mockReset(); mq.mockReset(); mq.mockResolvedValue({});
    q.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM users/i.test(s)) return { rows: [{ login_id: 'hoyun', mfa_phone: '01052958517' }] };
      if (/INSERT INTO sender_auth_challenges/i.test(s)) return { rows: [{ id: 'sac-1' }] };
      return { rows: [] };
    });
    enablePilot();
    await checkSenderAuthGate({ req: REQ, userId: USER, companyId: 'c1', callback: '02-3467-8612', recipientCount: 1 });
    const rows = auditRows();
    expect(rows.some((p: any[]) => p[1] === 'sender_auth_challenge')).toBe(true);
  });

  it('★인증에 성공하면 성공 기록이 남는다', async () => {
    const HASH = bcrypt.hashSync('123456', 8);
    q.mockReset();
    q.mockImplementation(async (sql: string) => {
      if (/FROM sender_auth_challenges/i.test(String(sql))) {
        return { rows: [{ code_hash: HASH, attempts: 0, phone: '01052958517', callback_number: '0234678612', company_id: 'c1', expired: false, consumed: false }] };
      }
      // 성공 UPDATE는 조건이 붙어 있고 RETURNING으로 바뀐 행을 돌려준다 — 운영 DB와 같은 모양으로 둔다
      if (/UPDATE sender_auth_challenges/i.test(String(sql))) return { rows: [{ id: 'sac-1' }] };
      return { rows: [] };
    });
    await verifySenderAuthChallenge({ challengeId: 'x', userId: USER, code: '123456', req: REQ });
    expect(auditRows().some((p: any[]) => p[1] === 'sender_auth_success')).toBe(true);
  });

  it('★기록에 인증번호 평문과 번호 원문이 없다', async () => {
    q.mockReset(); mq.mockReset(); mq.mockResolvedValue({});
    q.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM users/i.test(s)) return { rows: [{ login_id: 'hoyun', mfa_phone: '01052958517' }] };
      if (/INSERT INTO sender_auth_challenges/i.test(s)) return { rows: [{ id: 'sac-1' }] };
      return { rows: [] };
    });
    enablePilot();
    await checkSenderAuthGate({ req: REQ, userId: USER, companyId: 'c1', callback: '02-3467-8612', recipientCount: 1 });
    const code = String(mq.mock.calls[0][1][2]).match(/\d{6}/)[0];
    const detail = JSON.parse(auditRows().find((p: any[]) => p[1] === 'sender_auth_challenge')[4]);
    expect(detail.phone_masked).toBe('010-****-8517');
    expect(Object.values(detail)).not.toContain(code);
    expect(JSON.stringify(auditRows())).not.toContain('01052958517');
  });
});

/**
 * [소스 스캔] 발송 경로 배선 — 세 경로가 **판정 CT 하나**를 부른다.
 * 못 박는 것: 라우트가 조건을 다시 조립하지 않는다(시행일·명단을 라우트에서 읽지 않는다).
 * 경로가 늘면 이 테스트가 먼저 깨져야 한다 — 조용히 빠진 경로는 인증 없는 발송 구멍이다.
 */
describe('[소스 스캔] 발송 경로 배선', () => {
  const src = readFileSync(resolve(__dirname, '../routes/campaigns.ts'), 'utf8');

  it('이용자 지시 발송 3경로가 게이트를 부른다', () => {
    const calls = src.match(/checkSenderAuthGate\(/g) || [];
    expect(calls.length, '게이트 호출 수가 3이 아니다').toBe(3);
  });

  it('게이트 뒤에는 발송을 세우고 인증 요구를 돌려준다 — 응답도 CT가 만든다', () => {
    const replies = src.match(/senderAuthRejection\(/g) || [];
    expect(replies.length, '거절 응답 수가 게이트 수와 다르다').toBe(3);
    expect(src, '응답 코드를 라우트가 직접 적었다').not.toMatch(/'SENDER_AUTH_REQUIRED'/);
  });

  /**
   * ★ Codex 적대검토 high 후속 — 행마다 회신번호가 다른 발송은 번호를 하나로 특정할 수 없다.
   *   라우트가 이 축을 안 넘기면 게이트는 기본번호로 인증을 통과시키고, 실제 발송은 다른 번호로 나간다.
   */
  /**
   * ★ Codex 적대검토 2R high ×2 — 뿌리는 하나다.
   *   **게이트가 보는 값과 실제 발송이 쓰는 값이 달랐다.**
   *   ① 캠페인 발송은 `use_individual_callback`을 컬럼 유무와 AND해서 확정하는데(D100),
   *      게이트는 원본을 봐서 개별 모드로 오인하고 계정 축 인증을 통과시켰다.
   *   ② 직접발송은 값을 truthy로 쓰는데 게이트만 `=== true`로 봐서,
   *      문자열 "true"가 오면 게이트는 특정 번호 인증을 재사용하고 발송은 개별번호로 나갔다.
   *   그래서 게이트는 **발송이 실제로 쓰는 그 값**을 그대로 받는다.
   */
  it('★게이트가 개별 모드를 발송과 다르게 읽지 않는다 — 엄격 비교 금지', () => {
    expect(src, '게이트만 === true로 읽으면 문자열 값에서 발송과 갈린다')
      .not.toMatch(/useIndividualCallback === true/);
  });

  it('★캠페인 발송 게이트는 확정된 개별 모드·실제 발신번호를 쓴다', () => {
    const derived = src.indexOf('const useIndividualCallback = (campaign.use_individual_callback');
    const gate = src.indexOf('const senderGate = await checkSenderAuthGate(');
    expect(derived, '캠페인 개별 모드 확정 지점을 못 찾았다').toBeGreaterThan(-1);
    expect(gate, '게이트가 개별 모드 확정보다 앞에 있다').toBeGreaterThan(derived);
    const call = src.slice(gate, src.indexOf('});', gate));
    expect(call, '게이트가 기본 회신번호 폴백을 안 본다').toMatch(/campaign\.callback_number \|\| defaultCallback/);
  });

  /**
   * ★ Codex 적대검토 3R 범위 밖 지적 — 알림톡 적재는 개별 회신번호를 쓰지 않고 **공통 회신번호 고정**이다
   *   (`campaigns.ts` 알림톡 payload · `direct-send-processor.ts` 둘 다 `callback` 하나를 쓴다).
   *   그런데 게이트만 개별 모드로 보면 계정 축(`*`) 인증으로 그 번호 발송이 통과한다.
   */
  it('★알림톡은 개별 회신번호 축에서 뺀다 — 적재가 공통 회신번호를 쓴다', () => {
    for (const name of ['commitIndividualCallback', 'directIndividualCallback']) {
      const at = src.indexOf(`const ${name} =`);
      expect(at, `${name} 확정이 없다`).toBeGreaterThan(-1);
      expect(src.slice(at, at + 200), `${name}이 알림톡을 빼지 않는다`).toMatch(/!== 'alimtalk'/);
    }
    expect(src).toMatch(/useIndividualCallback: commitIndividualCallback/);
    expect(src).toMatch(/useIndividualCallback: directIndividualCallback/);
  });

  it('★게이트 호출 3곳이 전부 개별 회신번호 축을 넘긴다', () => {
    const calls: string[] = [];
    let at = src.indexOf('checkSenderAuthGate({');
    while (at !== -1) {
      calls.push(src.slice(at, src.indexOf('});', at)));
      at = src.indexOf('checkSenderAuthGate({', at + 1);
    }
    expect(calls.length, '게이트 호출 수').toBe(3);
    for (const call of calls) {
      expect(call, '개별 회신번호 축을 안 넘기는 게이트 호출이 있다').toMatch(/useIndividualCallback/);
    }
  });

  it('라우트가 시행일·명단을 다시 읽지 않는다 — 판정은 CT가 소유한다', () => {
    expect(src).not.toMatch(/SENDER_AUTH_ENFORCE_FROM/);
    expect(src).not.toMatch(/SENDER_AUTH_PILOT_LOGIN_IDS/);
    expect(src).not.toMatch(/isSenderAuthEnforced\(/);
  });

  it('검증 endpoint는 판정 CT를 부르고 조건을 다시 조립하지 않는다', () => {
    const auth = readFileSync(resolve(__dirname, '../routes/auth.ts'), 'utf8');
    expect(auth).toMatch(/verifySenderAuthChallenge\(/);
    expect(auth).not.toMatch(/SENDER_AUTH_PILOT_LOGIN_IDS/);
  });
});

/**
 * [소스 스캔] 화면 배선 — 발송을 부르는 화면마다 인증 팝업이 이어져야 한다.
 * 못 박는 것: 화면은 응답 코드만 보고 움직인다(시행일·명단을 프론트가 다시 읽지 않는다).
 * 배선이 빠진 화면은 사용자에게 "인증이 필요합니다"만 띄우고 입력할 곳을 안 주는 막다른 길이 된다.
 */
describe('[소스 스캔] 화면 배선', () => {
  const FE = resolve(__dirname, '../../../frontend/src');
  const hook = readFileSync(resolve(FE, 'hooks/useSenderAuth.ts'), 'utf8');
  const dashboard = readFileSync(resolve(FE, 'pages/Dashboard.tsx'), 'utf8');
  const operator = readFileSync(resolve(FE, 'pages/AiOperatorPage.tsx'), 'utf8');

  it('인증 흐름은 훅 하나가 갖는다 — 화면마다 복제하지 않는다', () => {
    expect(hook).toMatch(/\/api\/auth\/sender-auth\/verify/);
    for (const [name, src] of [['Dashboard', dashboard], ['AiOperatorPage', operator]] as const) {
      expect(src, `${name}이 훅을 쓰지 않는다`).toMatch(/useSenderAuth\(\)/);
      expect(src, `${name}이 검증 endpoint를 직접 부른다`).not.toMatch(/sender-auth\/verify/);
    }
  });

  /**
   * 화면이 서버 발송을 부르는 자리는 6곳이다(백엔드 게이트 3개를 이 6곳이 나눠 친다).
   *   직접발송 · 타겟발송 · AI 오퍼레이터 승인 · AI 캠페인 생성발송 2곳 · AI 캠페인 이어보내기.
   * 한 곳이라도 빠지면 그 화면은 "인증이 필요합니다"만 띄우고 입력할 곳을 안 주는 막다른 길이 된다.
   */
  it('화면의 발송 호출 6곳이 전부 인증 요구를 받는다', () => {
    const count = (src: string) =>
      (src.match(/senderAuth\.handleResponse\(/g) || []).length
      + (src.match(/senderAuth\.handleError\(/g) || []).length;
    expect(count(dashboard), 'Dashboard 배선 수').toBe(5);
    expect(count(operator), 'AiOperatorPage 배선 수').toBe(1);
  });

  it('★인증 뒤 AI 캠페인은 다시 만들지 않고 그 캠페인만 다시 보낸다 — 중복 행·중복 차감 금지', () => {
    const resume = dashboard.slice(
      dashboard.indexOf('const resumeAiCampaignSend'),
      dashboard.indexOf('const handleCallbackConfirmSend'));
    expect(resume, '이어보내기 구간이 안 잡혔다').toContain('campaignsApi.send(campaignId');
    expect(resume, '이어보내기가 캠페인을 다시 만든다').not.toContain('campaignsApi.create');
  });

  it('화면이 판정을 다시 조립하지 않는다', () => {
    for (const src of [hook, dashboard, operator]) {
      expect(src).not.toMatch(/SENDER_AUTH_ENFORCE_FROM|SENDER_AUTH_PILOT_LOGIN_IDS/);
    }
  });

  it('인증을 통과하면 눌렀던 발송을 다시 실행한다 — 사용자가 다시 입력하지 않는다', () => {
    expect(hook).toMatch(/retryRef\.current/);
    expect(dashboard).toMatch(/handleResponse\(data, \(\) => executeDirectSend\(/);
    expect(dashboard).toMatch(/handleResponse\(data, \(\) => executeTargetSend\(/);
    expect(operator).toMatch(/handleResponse\(sendData, \(\) => performDirectSend\(/);
  });
});
