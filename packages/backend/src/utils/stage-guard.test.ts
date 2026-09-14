/**
 * 주기 워커 단계 겹침 가드 (★2026-09-13(3) · B-0825-7)
 */
import { describe, it, expect, vi } from 'vitest';
import { createStageGuard } from './stage-guard';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: any) => void;
  const p = new Promise<void>((r, j) => { resolve = r; reject = j; });
  return { p, resolve, reject };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createStageGuard', () => {
  it('같은 이름이 돌고 있으면 새로 시작하지 않고 onSkip을 부른다', async () => {
    const onSkip = vi.fn();
    const g = createStageGuard(onSkip);
    const d = deferred();
    const fn = vi.fn(() => d.p);
    const first = g.run('a', fn);
    await flush();
    await expect(g.run('a', fn)).resolves.toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledWith('a', expect.any(Number));
    d.resolve();
    await first;
  });

  it('다른 이름은 동시에 돈다(단계 사이 겹침은 종전과 같다)', async () => {
    const g = createStageGuard();
    const d = deferred();
    const b = vi.fn(async () => {});
    const first = g.run('a', () => d.p);
    await flush();
    await expect(g.run('b', b)).resolves.toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    d.resolve();
    await first;
  });

  it('건너뛴 요청이 여러 번이어도 끝난 직후 한 번만 이어 돈다', async () => {
    const g = createStageGuard();
    let n = 0;
    const d = deferred();
    const fn = () => { n += 1; return n === 1 ? d.p : Promise.resolve(); };
    const first = g.run('a', fn);
    await flush();
    await g.run('a', fn);
    await g.run('a', fn);
    d.resolve();
    await first;
    expect(n).toBe(2);
  });

  it('같은 마이크로태스크에서 두 번 불러도 한 번만 돈다(판정이 대기 전에 동기)', async () => {
    const g = createStageGuard();
    const fn = vi.fn(async () => {});
    const [a, b] = await Promise.all([g.run('a', fn), g.run('a', fn)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('던지면 가드가 풀리고 이어 돌기는 버린다', async () => {
    const g = createStageGuard();
    const d = deferred();
    const first = g.run('a', () => d.p);
    await flush();
    await g.run('a', async () => {});
    d.reject(new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    expect(g.runningForMs('a')).toBeNull();
    const fn = vi.fn(async () => {});
    await expect(g.run('a', fn)).resolves.toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
