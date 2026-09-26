/**
 * 준비분 잠금 CT(withStagingLock) — 같은 준비분 작업을 직렬화 (★2026-09-26 F38 · Codex 3차 2R high 2건)
 *
 * 1R 처방(DB advisory 잠금 연결 + 본문은 풀 연결)은 잠금 연결을 쥔 채 본문이 풀을 또 빌려, 동시 요청이 풀(20)을 채우면 교착됐다.
 * 또 잠금 키가 입력 문자열 그대로라 같은 UUID의 대소문자·하이픈 표기를 바꾸면 다른 잠금이 됐다.
 * 처방: 프로세스 안 키별 뮤텍스(기다리는 동안 DB 연결을 쥐지 않는다 · 백엔드는 PM2 fork 단일 프로세스 = ecosystem.config.js instances 1)
 *       + 키 = UUID 16진수 32자리 소문자(표기 차이 무시).
 */
import { describe, it, expect, vi } from 'vitest';

const connect = vi.fn();
vi.mock('../../config/database', () => ({ default: { connect: (...a: any[]) => (connect as any)(...a), query: vi.fn() }, query: vi.fn() }));

import { withStagingLock } from '../staging-sweeper';

const ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('withStagingLock', () => {
  it('같은 준비분(표기만 다른 UUID 포함)은 한 번에 하나씩 · DB 연결을 쥐지 않는다', async () => {
    const order: string[] = [];
    const a = withStagingLock(ID, async () => { order.push('a:start'); await tick(); order.push('a:end'); return 'a'; });
    const b = withStagingLock(`{${ID.toUpperCase()}}`, async () => { order.push('b:start'); await tick(); order.push('b:end'); return 'b'; });
    const c = withStagingLock(ID.replace(/-/g, ''), async () => { order.push('c:start'); return 'c'; });
    expect(await Promise.all([a, b, c])).toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start']);
    expect(connect).not.toHaveBeenCalled();
  });

  it('다른 준비분은 서로 기다리지 않는다', async () => {
    const order: string[] = [];
    const a = withStagingLock(ID, async () => { order.push('a:start'); await tick(); order.push('a:end'); });
    const b = withStagingLock('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', async () => { order.push('b:start'); });
    await Promise.all([a, b]);
    expect(order.indexOf('b:start')).toBeLessThan(order.indexOf('a:end'));
  });

  it('본문이 던져도 잠금을 풀어 다음 작업이 돈다', async () => {
    await expect(withStagingLock(ID, async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await withStagingLock(ID, async () => 'next')).toBe('next');
  });
});
