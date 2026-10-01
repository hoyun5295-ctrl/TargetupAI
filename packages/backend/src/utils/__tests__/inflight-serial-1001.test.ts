/**
 * ★ 2026-10-01 CT inflight-lock runSerial — 같은 키의 실행을 한 줄로 세운다(둘째는 거절이 아니라 기다린다)
 *   쓰는 곳 = 우커머스 웹훅 점검·제거(몰 단위 한 줄 · 설계서 docs/2026-09-14-woocommerce-integration-design.md §8 불변 17)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runSerial, tryAcquireInflight, releaseInflight, clearInflightForTest } from '../inflight-lock';

const deferred = <T = void>() => { let resolve!: (v: T) => void; let reject!: (e: any) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const tick = () => new Promise<void>((r) => setImmediate(r));

beforeEach(() => clearInflightForTest());

describe('runSerial', () => {
  it('같은 키는 들어온 순서대로 하나씩 — 앞 실행이 끝나기 전에는 다음이 시작하지 않는다', async () => {
    const log: string[] = [];
    const a = deferred();
    const first = runSerial('k', async () => { log.push('a 시작'); await a.promise; log.push('a 끝'); return 1; });
    const second = runSerial('k', async () => { log.push('b 시작'); return 2; });
    await tick(); await tick();
    expect(log).toEqual(['a 시작']);
    a.resolve();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(log).toEqual(['a 시작', 'a 끝', 'b 시작']);
  });
  it('다른 키는 서로 기다리지 않는다', async () => {
    const log: string[] = [];
    const a = deferred();
    const first = runSerial('k1', async () => { await a.promise; log.push('k1'); });
    await runSerial('k2', async () => { log.push('k2'); });
    expect(log).toEqual(['k2']);
    a.resolve();
    await first;
    expect(log).toEqual(['k2', 'k1']);
  });
  it('한 줄이 끝나며 흔적을 지워도 다른 줄의 순서는 그대로다(끝난 줄만 지운다)', async () => {
    const log: string[] = [];
    const a = deferred();
    const first = runSerial('k1', async () => { await a.promise; log.push('k1 첫째'); });
    await runSerial('k2', async () => undefined);
    await tick();
    const second = runSerial('k1', async () => { log.push('k1 둘째'); });
    await tick(); await tick();
    expect(log).toEqual([]);
    a.resolve();
    await first; await second;
    expect(log).toEqual(['k1 첫째', 'k1 둘째']);
  });
  it('앞 실행이 실패해도 다음 차례는 돈다 · 오류는 그 실행을 부른 쪽에만 돌아간다', async () => {
    const first = runSerial('k', async () => { throw new Error('앞이 실패'); });
    const second = runSerial('k', async () => '뒤는 성공');
    await expect(first).rejects.toThrow('앞이 실패');
    expect(await second).toBe('뒤는 성공');
  });
  it('줄이 비면 흔적이 남지 않는다(끝난 뒤 새 실행은 바로 돈다) · 빈 키는 줄 세우지 않는다', async () => {
    await runSerial('k', async () => undefined);
    await tick();
    const log: string[] = [];
    await runSerial('k', async () => { log.push('바로'); });
    expect(log).toEqual(['바로']);
    const hold = deferred();
    const blocked = runSerial('', async () => { await hold.promise; return 'x'; });
    expect(await runSerial('', async () => 'y')).toBe('y');   // 빈 키끼리는 서로 막지 않는다
    hold.resolve();
    expect(await blocked).toBe('x');
  });
  it('거절형 잠금(tryAcquireInflight)과 서로 영향을 주지 않는다 — 같은 키 이름이어도 별개', async () => {
    expect(tryAcquireInflight('k')).toBe(true);
    expect(await runSerial('k', async () => 'ok')).toBe('ok');
    expect(tryAcquireInflight('k')).toBe(false);
    releaseInflight('k');
  });
});
