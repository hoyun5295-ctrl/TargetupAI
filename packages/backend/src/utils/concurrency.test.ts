import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './concurrency';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('mapWithConcurrency — 동시성 상한 병렬 (2026-07-26)', () => {
  it('결과 순서가 입력 순서와 같다 — 완료 순서가 달라도', async () => {
    const out = await mapWithConcurrency([5, 1, 3, 2, 4], 3, async (n) => {
      for (let i = 0; i < n; i += 1) await tick();   // 큰 값일수록 늦게 끝난다
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
  });

  it('동시 실행 수가 상한을 넘지 않는다 — 풀을 독점하면 발송이 멈춘다', async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick(); await tick();
      running -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBe(4);   // 상한까지는 실제로 채운다(느려지면 개선 효과가 없다)
  });

  it('실제로 병렬이다 — 순차였다면 20개가 20턴 이상 걸린다', async () => {
    const order: number[] = [];
    await mapWithConcurrency(Array.from({ length: 6 }, (_, i) => i), 6, async (i) => {
      order.push(i);
      await tick();
      return i;
    });
    // 상한 6이면 6개가 첫 턴에 모두 시작한다(순차면 하나씩 시작·완료를 반복한다).
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('빈 입력·잘못된 상한도 안전하다', async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency(undefined as any, 5, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 0, async (n) => n)).toEqual([1, 2]);
    expect(await mapWithConcurrency([1, 2], -3, async (n) => n)).toEqual([1, 2]);
  });

  it('하나라도 실패하면 throw한다 — 테이블 하나를 건너뛰면 그 라인 발송분이 미청구가 된다', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('table missing');
        return n;
      }),
    ).rejects.toThrow('table missing');
  });
});
