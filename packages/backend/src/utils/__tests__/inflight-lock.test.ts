/**
 * inflight-lock.test.ts — 프로세스 안 동시 실행 잠금(★2026-09-14 T4 · AI 자동제작 §6-5 "동시 생성(같은 회사) = 409" 의 배관). DB 0.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { tryAcquireInflight, releaseInflight, isInflight, clearInflightForTest } from '../inflight-lock';

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
