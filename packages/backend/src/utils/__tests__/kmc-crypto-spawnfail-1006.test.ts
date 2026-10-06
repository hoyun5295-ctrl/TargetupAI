/**
 * ★ 2026-10-06 Codex 1R high — 암호화 모듈이 통로 없이 실패해도(파일 기술자 고갈 EMFILE 등) 서버가 내려가지 않는다.
 *   통로 없는 자식 프로세스를 돌려주고 뒤이어 error 이벤트를 쏘는 spawn 으로 바꿔 끼운다.
 *   오류를 받는 곳이 없으면 EventEmitter 가 그 오류를 던져 이 시험이 「처리되지 않은 오류」로 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';

const emitted: EventEmitter[] = [];
vi.mock('child_process', async (orig) => {
  const real = await orig<typeof import('child_process')>();
  return {
    ...real,
    spawn: vi.fn(() => {
      const child: any = new EventEmitter();
      child.stdin = null; child.stdout = null; child.stderr = null; child.exitCode = null;
      child.kill = vi.fn();
      emitted.push(child);
      setTimeout(() => child.emit('error', Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' })), 10);
      return child;
    }),
  };
});

import { kmcCrypto, __resetKmcCryptoForTest } from '../kmc-crypto';

describe('KMC 모듈 통로 없는 실패', () => {
  it('그 호출만 실패하고, 뒤따르는 error 이벤트도 받아 서버를 내리지 않는다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(kmcCrypto({ file: '/no/where/KmcCrypto' }, 'enc', 'A')).rejects.toThrow('KMC_CRYPTO_SPAWN_FAILED');
    await new Promise((r) => setTimeout(r, 40)); // 뒤따르는 error 이벤트가 지나가게
    expect(emitted).toHaveLength(1);
    expect(emitted[0].listenerCount('error')).toBeGreaterThan(0);
    // 다음 호출은 다시 띄우려 하고, 같은 방식으로 실패만 한다
    await expect(kmcCrypto({ file: '/no/where/KmcCrypto' }, 'enc', 'B')).rejects.toThrow('KMC_CRYPTO_SPAWN_FAILED');
    await new Promise((r) => setTimeout(r, 40));
    expect(emitted).toHaveLength(2);
    __resetKmcCryptoForTest();
    errSpy.mockRestore();
  });
});
