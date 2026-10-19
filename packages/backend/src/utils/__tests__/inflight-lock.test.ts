/**
 * inflight-lock.test.ts — 프로세스 안 동시 실행 잠금(★2026-09-14 T4 · AI 자동제작 §6-5 "동시 생성(같은 회사) = 409" 의 배관). DB 0.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { tryAcquireInflight, releaseInflight, isInflight, clearInflightForTest, singleFlight, joinInflight } from '../inflight-lock';

beforeEach(() => clearInflightForTest());

describe('inflight-lock', () => {
  it('같은 키 두 번 = 두 번째 false · 해제 뒤 다시 true · 다른 키는 독립', () => {
    expect(tryAcquireInflight('a')).toBe(true);
    expect(isInflight('a')).toBe(true);
    expect(tryAcquireInflight('a')).toBe(false);
    expect(tryAcquireInflight('b')).toBe(true);
    releaseInflight('a');
    expect(isInflight('a')).toBe(false);
    expect(tryAcquireInflight('a')).toBe(true);
    expect(isInflight('b')).toBe(true);
  });
  it('빈 키는 잡지 않는다(fail-closed) · 안 잡은 키 해제는 무해', () => {
    expect(tryAcquireInflight('')).toBe(false);
    expect(isInflight('')).toBe(false);
    releaseInflight('없는키');
    expect(isInflight('없는키')).toBe(false);
  });
});

// ★ 2026-10-19 B-1010-3 · B-1005-1② — 같은 사람 · 같은 생성의 겹친 요청 = 409 · 핸들러가 끝나야 놓는다(연결 닫힘으로 놓지 않는다 · Codex E1)
describe('singleFlight', () => {
  const mkRes = () => {
    const r: any = new EventEmitter();
    r.code = 0; r.body = null;
    r.status = (c: number) => { r.code = c; return r; };
    r.json = (b: any) => { r.body = b; return r; };
    return r;
  };
  it('같은 회사 · 같은 사용자 둘째 = 409 IN_FLIGHT · 연결이 닫혀도 핸들러가 끝나기 전엔 잡고 있다 · 끝난 뒤 다시 통과 · 다른 사용자 · 다른 종류는 독립', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let runs = 0;
    const wrapped = singleFlight('dm-generate', async () => { runs++; await gate; });
    const a = { user: { companyId: 'c1', userId: 'u1' } };
    const r1 = mkRes();
    const first = wrapped(a, r1);
    const r2 = mkRes(); await wrapped(a, r2);
    expect(r2.code).toBe(409);
    expect(r2.body.code).toBe('IN_FLIGHT');
    r1.emit('close');
    const r3 = mkRes(); await wrapped(a, r3);
    expect(r3.code).toBe(409);
    const other = singleFlight('dm-generate', async () => { runs++; });
    await other({ user: { companyId: 'c1', userId: 'u2' } }, mkRes());
    await singleFlight('email-generate', async () => { runs++; })(a, mkRes());
    expect(runs).toBe(3);
    release(); await first;
    await wrapped(a, mkRes());
    expect(runs).toBe(4);
  });
  it('핸들러가 던져도 놓는다 · 회사 · 사용자 없는 요청 = 잠금 없이 실행', async () => {
    const a = { user: { companyId: 'c9', userId: 'u9' } };
    const boom = singleFlight('dm-generate', async () => { throw new Error('x'); });
    await expect(boom(a, mkRes())).rejects.toThrow('x');
    let runs = 0;
    const ok = singleFlight('dm-generate', async () => { runs++; });
    await ok(a, mkRes());
    await ok({}, mkRes()); await ok({}, mkRes());
    expect(runs).toBe(3);
  });
});

// ★ 2026-10-19 B-1010-5 — 같은 키 동시 실행 = 한 번만 돌고 모두 같은 결과 · 끝나면 다시 돈다
describe('joinInflight', () => {
  it('겹친 두 호출 = fn 1번 · 같은 값 · 끝난 뒤 새 호출 = 다시 실행', async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fn = async () => { runs++; await gate; return runs; };
    const a = joinInflight('k', fn);
    const b = joinInflight('k', fn);
    release();
    expect(await a).toBe(1);
    expect(await b).toBe(1);
    expect(runs).toBe(1);
    expect(await joinInflight('k', async () => { runs++; return runs; })).toBe(2);
  });
});
