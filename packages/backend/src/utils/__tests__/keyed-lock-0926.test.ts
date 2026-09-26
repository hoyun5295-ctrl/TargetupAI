/**
 * 프로세스 안 키별 잠금 공용 CT (★2026-09-26 한줄로 V2 — Codex 4차 2R high: 초안 삭제 ↔ 발송 시작 경합 · S1-H07 동시 발송)
 *
 * 준비분 잠금(staging-sweeper withStagingLock)에 있던 뮤텍스를 한 벌로 뽑았다. 백엔드는 PM2 fork 단일 프로세스라
 * 프로세스 안 잠금이 모든 요청을 덮는다(클러스터로 바꾸면 이 파일만 바꾼다). 기다리는 동안 DB 연결을 쥐지 않는다.
 *
 * 못 박는 것
 *   1. 같은 이름공간·같은 키는 한 번에 하나씩(들어온 순서) · 이름공간이 다르면 서로 기다리지 않는다.
 *   2. 본문이 던져도 풀린다.
 *   3. 캠페인 발송 시작 잠금은 UUID 표기(대소문자·하이픈·중괄호)가 달라도 같은 키.
 */
import { describe, it, expect } from 'vitest';
import { withKeyedLock, withCampaignStartLock } from '../keyed-lock';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('withKeyedLock', () => {
  it('같은 이름공간·키는 순서대로 하나씩', async () => {
    const log: string[] = [];
    const a = withKeyedLock('ns', 'k', async () => { log.push('a+'); await tick(); log.push('a-'); });
    const b = withKeyedLock('ns', 'k', async () => { log.push('b+'); await tick(); log.push('b-'); });
    await Promise.all([a, b]);
    expect(log).toEqual(['a+', 'a-', 'b+', 'b-']);
  });

  it('이름공간이 다르면 같은 키라도 서로 기다리지 않는다', async () => {
    const log: string[] = [];
    const a = withKeyedLock('ns1', 'k', async () => { log.push('a+'); await tick(); log.push('a-'); });
    const b = withKeyedLock('ns2', 'k', async () => { log.push('b+'); await tick(); log.push('b-'); });
    await Promise.all([a, b]);
    expect(log.slice(0, 2).sort()).toEqual(['a+', 'b+']);
  });

  it('본문이 던져도 다음 작업이 돈다', async () => {
    await expect(withKeyedLock('ns', 'x', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withKeyedLock('ns', 'x', async () => 7)).resolves.toBe(7);
  });
});

describe('withCampaignStartLock', () => {
  it('UUID 표기만 다른 입력은 한 줄에 선다', async () => {
    const log: string[] = [];
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const a = withCampaignStartLock(id, async () => { log.push('a+'); await tick(); log.push('a-'); });
    const b = withCampaignStartLock(`{${id.toUpperCase()}}`, async () => { log.push('b+'); await tick(); log.push('b-'); });
    await Promise.all([a, b]);
    expect(log).toEqual(['a+', 'a-', 'b+', 'b-']);
  });
});
