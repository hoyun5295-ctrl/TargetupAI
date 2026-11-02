/**
 * 주기 패스 경보 = 한 주기 1통(★ 2026-11-01 설계서 docs/2026-11-01-credit-control-tower-design.md §16-6 · 1101 회사마다 경보 100통)
 * ★ 2026-11-02 Codex 구현 1R-2 — 쿨다운이 한 번뿐인 확정 실패를 삼키지 않는다(알린 항목 기억 · 못 보낸 항목은 다음 통에 · 10분마다 다시)
 * ★ 2026-11-02 설계 §17 — 사건 모드(total 없음) · 못 보낸 항목 = PG 원장(재기동에도 남음 · 1R-1) · 닫기 계약(원장에 쓴 때만 참 · 2R)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** 원장 표 흉내(system_alert_pending · 넣기 = 같은 키는 첫 줄 그대로 · 읽기 = 들어온 순 · 지우기 = 키 목록) — 모듈을 다시 불러도(재기동) 남는다 */
const ledger = new Map<string, any>();
let seq = 0;
let ledgerDown: '' | 'missing' | 'down' = '';
/** 진짜 sendSystemAlert 가 적재한 문자(재기동 뒤 기본 보내기 · 표 없음 상태 경보 확인용 · 적재 함수는 가짜라 밖으로 안 나간다) */
const loaded: any[] = [];
vi.mock('../internal-company', () => ({ isInternalCompany: vi.fn(async (id: string) => id === 'internal-co') }));
vi.mock('../../config/database', () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    if (!sql.includes('system_alert_pending')) return { rows: [] };   // system_alert_state(쿨다운) = 늘 처음
    if (ledgerDown) {
      const e: any = new Error(ledgerDown === 'missing' ? 'relation "system_alert_pending" does not exist' : 'Connection terminated');
      if (ledgerDown === 'missing') e.code = '42P01';
      throw e;
    }
    if (sql.startsWith('INSERT')) {
      const [pass, keys, cos, errs, title, action, total] = params;
      keys.forEach((k: string, i: number) => {
        const id = `${pass}\u0001${k}`;
        if (!ledger.has(id)) ledger.set(id, { pass, item_key: k, company_id: cos[i], error: errs[i], title, action, total, seq: seq++ });
      });
      return { rows: [] };
    }
    if (sql.includes('SELECT DISTINCT pass')) return { rows: [...new Set([...ledger.values()].map((r) => r.pass))].map((pass) => ({ pass })) };
    if (sql.startsWith('SELECT')) {
      const lim = Number(/LIMIT (\d+)/.exec(sql)![1]);
      return { rows: [...ledger.values()].filter((r) => r.pass === params[0]).sort((a, b) => a.seq - b.seq).slice(0, lim) };
    }
    if (sql.startsWith('DELETE')) {
      for (const k of params[1]) ledger.delete(`${params[0]}\u0001${k}`);
      return { rows: [] };
    }
    throw new Error(`모르는 문장: ${sql.slice(0, 40)}`);
  }),
}));
vi.mock('../sms-queue', () => ({
  getAuthSmsTable: vi.fn(async () => 'SMSQ_AUTH'),
  bulkInsertSmsQueue: vi.fn(async (_t: any, rows: any[][]) => { loaded.push(...rows); return rows.length; }),
}));

import { alertPassFailures, flushPendingPassAlerts, persistPassFailures, queuePassFailures, flushPassAlerts } from '../system-alert';

const sent: any[] = [];
/** 보내기 가짜 — open 이 거짓이면 쿨다운처럼 0(못 보냄) */
let open = true;
const send = async (p: any) => { if (!open) return 0; sent.push(p); return 1; };
const T0 = new Date('2026-11-02T01:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60 * 1000);
const left = (pass: string) => [...ledger.values()].filter((r) => r.pass === pass).map((r) => r.item_key);

describe('alertPassFailures — 실패를 모아 한 통', () => {
  beforeEach(() => { sent.length = 0; open = true; ledgerDown = ''; ledger.clear(); loaded.length = 0; });

  it('85곳 실패 = 경보 1통 · 오류 종류별 곳 수(많은 순) · 키 = 패스 이름(1시간 쿨다운) · 보낸 줄은 원장에서 지운다', async () => {
    const failures = [
      ...Array.from({ length: 80 }, (_, i) => ({ companyId: `c${i}`, error: 'column "seq" of relation "ai_credit_transactions" does not exist' })),
      ...Array.from({ length: 5 }, (_, i) => ({ companyId: `d${i}`, error: 'timeout 3000ms' })),
    ];
    const n = await alertPassFailures({ pass: 'credit-close', title: 'AI 크레딧 월 마감이 일부 회사에서 실패했습니다.', failures, total: 141, action: '서버 로그를 확인해 주세요.', now: T0 }, send);
    expect(n).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].dedupKey).toBe('pass:credit-close');
    expect(sent[0].cooldownMs).toBe(60 * 60 * 1000);
    expect(sent[0].companyId).toBeNull();
    expect(sent[0].details[0]).toBe('새 실패 85곳 · 마지막 주기 실패 85곳 / 대상 141곳');
    expect(sent[0].details[1]).toMatch(/^오류 80곳: column "seq"/);
    expect(sent[0].details[2]).toMatch(/^오류 5곳: timeout N ?ms/);
    expect(left('credit-close')).toEqual([]);
  });

  it('같은 실패가 이어지면 6시간 안에는 다시 보내지 않고 6시간 뒤 되새긴다', async () => {
    const f = [{ companyId: 'c1', error: 'e' }];
    await alertPassFailures({ pass: 'repeat', title: 't', failures: f, total: 1, action: 'a', now: at(0) }, send);
    await alertPassFailures({ pass: 'repeat', title: 't', failures: f, total: 1, action: 'a', now: at(10) }, send);
    await alertPassFailures({ pass: 'repeat', title: 't', failures: f, total: 1, action: 'a', now: at(5 * 60) }, send);
    expect(sent).toHaveLength(1);
    await alertPassFailures({ pass: 'repeat', title: 't', failures: f, total: 1, action: 'a', now: at(6 * 60) }, send);
    expect(sent).toHaveLength(2);
  });

  it('Codex 1R-2 반례 — A 를 알린 뒤 쿨다운 안에 생긴 다른 확정 실패 B 는 버리지 않고 다음 통에 싣는다(B 는 다시 일어나지 않아도)', async () => {
    await alertPassFailures({ pass: 'gtm', title: 't', failures: [{ companyId: 'c1', error: '8회 초과: x', key: 'rowA' }], total: 1, action: 'a', now: at(0) }, send);
    open = false;   // 10:01 = 1시간 쿨다운 안(보내기가 0 을 돌려줌)
    expect(await alertPassFailures({ pass: 'gtm', title: 't', failures: [{ companyId: 'c2', error: '8회 초과: y', key: 'rowB' }], total: 1, action: 'a', now: at(1) }, send)).toBe(0);
    expect(left('gtm')).toEqual(['rowB']);   // 못 보낸 항목 = 원장에 남는다
    // B 는 failed 로 바뀌어 다음 주기에 다시 안 잡힌다 = 실패 0 인 주기가 이어진다
    expect(await alertPassFailures({ pass: 'gtm', title: 't', failures: [], total: 0, action: 'a', now: at(30) }, send)).toBe(0);
    open = true;    // 쿨다운 끝
    expect(await alertPassFailures({ pass: 'gtm', title: 't', failures: [], total: 0, action: 'a', now: at(61) }, send)).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1].details[0]).toBe('새 실패 1곳 · 마지막 주기 실패 0곳 / 대상 0곳');
    expect(sent[1].details[1]).toMatch(/^오류 1곳: N회 초과: y/);
    expect(left('gtm')).toEqual([]);
  });

  it('부르는 쪽이 다시 부르지 않아도(사건 경로) 남은 항목은 다시 보내 본다', async () => {
    open = false;
    await alertPassFailures({ pass: 'credit-hold', title: 't', failures: [{ companyId: 'c1', error: 'held', key: 'k1' }], total: 1, action: 'a', now: at(0) }, send);
    expect(sent).toHaveLength(0);
    open = true;
    await flushPendingPassAlerts(at(10));
    expect(sent).toHaveLength(1);
    expect(sent[0].dedupKey).toBe('pass:credit-hold');
    await flushPendingPassAlerts(at(20));
    expect(sent).toHaveLength(1);   // 보낸 항목은 다시 안 보낸다
  });

  it('Codex 2R-1 반례 — A 를 보내는 동안 들어온 B(쿨다운으로 못 보냄)는 A 가 성공해도 남아 다음에 간다', async () => {
    let release!: (n: number) => void;
    const slow = (p: any) => new Promise<number>((r) => { release = (n) => { if (n > 0) sent.push(p); r(n); }; });
    const first = alertPassFailures({ pass: 'race', title: 't', failures: [{ companyId: 'c1', error: 'a', key: 'A' }], total: 1, action: 'a', now: at(0) }, slow);
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    // A 를 보내는 중 = 같은 이름은 한 통씩 → B 는 원장에 남는다
    expect(await alertPassFailures({ pass: 'race', title: 't', failures: [{ companyId: 'c2', error: 'b', key: 'B' }], total: 1, action: 'a', now: at(0) }, slow)).toBe(0);
    release(1);
    expect(await first).toBe(1);
    expect(sent[0].details[0]).toBe('새 실패 1곳 · 마지막 주기 실패 1곳 / 대상 1곳');
    expect(left('race')).toEqual(['B']);   // 보낸 A 만 지웠다
    // B 는 쿨다운 뒤 그 이름의 다음 부름(실패 0)에 실린다
    expect(await alertPassFailures({ pass: 'race', title: 't', failures: [], total: 0, action: 'a', now: at(61) }, send)).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1].details[1]).toMatch(/^오류 1곳: b/);
  });

  it('설계 1R-1 반례 — 못 보낸 한 번뿐인 사건은 재기동(모듈 새로 불러옴)에도 원장에 남아 부팅 보내기로 나간다', async () => {
    open = false;
    await alertPassFailures({ pass: 'boot', title: '대행발송 메일함에 등록되지 않은 주소에서 메일이 왔습니다.', failures: [{ companyId: null, error: '보낸 주소 a@example.invalid', key: 'a@example.invalid' }], action: 'a', now: at(0) }, send);
    expect(sent).toHaveLength(0);
    vi.resetModules();
    const fresh = await import('../system-alert');   // 재기동 = 알린 항목 · 메모리 대기 · 보내기 가짜가 모두 사라진 새 프로세스
    const phones = process.env.SYSTEM_ALERT_PHONES;
    process.env.SYSTEM_ALERT_PHONES = '01000000000';   // 형식만 맞는 번호 · 적재 함수가 가짜라 밖으로 안 나간다
    try {
      await fresh.flushPendingPassAlerts(at(61));
    } finally {
      if (phones === undefined) delete process.env.SYSTEM_ALERT_PHONES; else process.env.SYSTEM_ALERT_PHONES = phones;
    }
    expect(loaded).toHaveLength(1);
    expect(String(loaded[0][2])).toContain('새 1건');
    expect(String(loaded[0][2])).toContain('보낸 주소 a@example.invalid');
    expect(left('boot')).toEqual([]);
  });

  it('사건 모드(total 없음) — 첫 줄 「새 N건」 · 글 숫자 그대로 · 같은 글은 뒤에 (N건)', async () => {
    await alertPassFailures({
      pass: 'event', title: 't', action: 'a', now: at(0), failures: [
        { companyId: null, key: 'r1', error: '예약 시각이 30분 넘게 지난 시도' },
        { companyId: null, key: 'r2', error: '예약 시각이 30분 넘게 지난 시도' },
        { companyId: null, key: 'g1', error: '상태값 67108964 · 12행' },
      ],
    }, send);
    expect(sent[0].details).toEqual(['새 3건', '예약 시각이 30분 넘게 지난 시도 (2건)', '상태값 67108964 · 12행']);
  });

  it('원장 한 통 상한(1,000)을 넘으면 「남은 항목은 다음 통」 · 남은 줄은 다음 통에', async () => {
    open = false;
    const many = Array.from({ length: 1001 }, (_, i) => ({ companyId: null, error: `e${i}`, key: `k${i}` }));
    await alertPassFailures({ pass: 'big', title: 't', failures: many, action: 'a', now: at(0) }, send);
    open = true;
    await flushPassAlerts('big', at(61));
    expect(sent[0].details[0]).toBe('새 1000건');
    expect(sent[0].details[1]).toBe('남은 항목은 다음 통에 싣습니다');
    expect(left('big')).toEqual(['k1000']);
    await flushPassAlerts('big', at(122));
    expect(sent[1].details[0]).toBe('새 1건');
    expect(left('big')).toEqual([]);
  });

  it('설계 2R 닫기 계약 — 원장에 못 쓰면 거짓(닫지 않는다) · 쓰면 참 · 6시간 안에 알린 항목뿐이면 쓰지 않고 참', async () => {
    const spec = { pass: 'close', title: 't', action: 'a', failures: [{ companyId: null, error: '경로 /x', key: 'job1' }], now: at(0) };
    ledgerDown = 'down';
    expect(await persistPassFailures(spec)).toBe(false);
    ledgerDown = '';
    expect(await persistPassFailures(spec)).toBe(true);
    expect(left('close')).toEqual(['job1']);
    expect(await alertPassFailures({ ...spec, failures: [] }, send)).toBe(1);   // 보냄 = 알린 항목
    expect(left('close')).toEqual([]);
    expect(await persistPassFailures({ ...spec, now: at(30) })).toBe(true);   // 6시간 안 = 이미 알림 · 다시 쓰지 않는다
    expect(left('close')).toEqual([]);
  });

  it('설계 2R — 원장에 못 쓴 메모리 대기는 DB 가 돌아오면 원장으로 옮긴다(그 뒤 재기동에도 남는다)', async () => {
    ledgerDown = 'down';
    await queuePassFailures({ pass: 'mem', title: 't', action: 'a', failures: [{ companyId: null, error: '환불 미완 · SMS 3건', key: 'ref1:SMS' }], now: at(0) });
    expect(left('mem')).toEqual([]);
    ledgerDown = '';
    open = false;   // 쿨다운이라 못 보내도
    expect(await alertPassFailures({ pass: 'mem', title: 't', action: 'a', failures: [], now: at(10) }, send)).toBe(0);
    expect(left('mem')).toEqual(['ref1:SMS']);   // 원장으로 옮겨졌다
  });

  it('원장 표 없음(42P01) = 거짓 + 「경보 원장 표 없음」 이어지는 상태 경보', async () => {
    ledgerDown = 'missing';
    const phones = process.env.SYSTEM_ALERT_PHONES;
    process.env.SYSTEM_ALERT_PHONES = '01000000000';
    try {
      expect(await persistPassFailures({ pass: 'ddl', title: 't', action: 'a', failures: [{ companyId: null, error: 'e', key: 'x' }], now: at(0) })).toBe(false);
      await vi.waitFor(() => expect(loaded.length).toBe(1));
    } finally {
      if (phones === undefined) delete process.env.SYSTEM_ALERT_PHONES; else process.env.SYSTEM_ALERT_PHONES = phones;
    }
    expect(String(loaded[0][2])).toContain('경보 원장 표가 없어');
  });

  it('원장이 내려가 있으면 메모리 대기 · 상한(500)을 넘은 항목은 버리지만 그 수를 다음 통에 알린다', async () => {
    ledgerDown = 'down';
    open = false;
    const many = Array.from({ length: 501 }, (_, i) => ({ companyId: `c${i}`, error: 'e', key: `k${i}` }));
    await alertPassFailures({ pass: 'cap', title: 't', failures: many, total: 501, action: 'a', now: at(0) }, send);
    open = true;
    await flushPendingPassAlerts(at(61));
    const msg = sent.find((p) => p.dedupKey === 'pass:cap');
    expect(msg.details[0]).toBe('새 실패 500곳 · 마지막 주기 실패 501곳 / 대상 501곳');
    expect(msg.details[1]).toBe('상한을 넘어 생략 1곳(서버 로그)');
  });

  it('항목 = key(없으면 회사) — 같은 회사의 다른 항목은 따로 센다', async () => {
    await alertPassFailures({ pass: 'keyed', title: 't', failures: [{ companyId: 'c1', error: 'e', key: 'm1' }, { companyId: 'c1', error: 'e', key: 'm2' }], total: 2, action: 'a', now: at(0) }, send);
    expect(sent[0].details[0]).toBe('새 실패 2곳 · 마지막 주기 실패 2곳 / 대상 2곳');
  });

  it('실패 0 = 보내지 않음 · 사내 회사만 실패 = 보내지 않음(로그만)', async () => {
    expect(await alertPassFailures({ pass: 'x', title: 't', failures: [], total: 3, action: 'a' }, send)).toBe(0);
    expect(await alertPassFailures({ pass: 'x', title: 't', failures: [{ companyId: 'internal-co', error: 'e' }], total: 3, action: 'a' }, send)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('사내 회사 실패는 세지 않는다 · 회사 없는 실패(전역)는 센다', async () => {
    await alertPassFailures({ pass: 'mixed', title: 't', failures: [{ companyId: 'internal-co', error: 'e' }, { companyId: 'c1', error: 'e' }, { companyId: null, error: 'e2' }], total: 3, action: 'a' }, send);
    expect(sent[0].details[0]).toBe('새 실패 2곳 · 마지막 주기 실패 2곳 / 대상 3곳');
  });
});
