/**
 * ★ 2026-10-06 한국모바일인증 암호화 모듈 호출(`kmc-crypto.ts`) — 실제 자식 프로세스로 규약을 시험한다.
 *   KMC 실행 파일 대신 같은 규약(`모드:번호^*값` → `번호:결과` · EUC-KR)으로 답하는 가짜 모듈을 Node 로 띄운다.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { kmcCrypto, isKmcToken, __resetKmcCryptoForTest, type KmcCommand } from '../kmc-crypto';

let dir = '';
let cmd: KmcCommand;

const FAKE = String.raw`
const rl = require('readline').createInterface({ input: process.stdin });
const out = (id, s) => process.stdout.write(id + ':' + s + '\r\n');
rl.on('line', (line) => {
  const m = /^(enc|dec|msg):(\d+)\^\*(.*)$/.exec(line);
  if (!m) return;
  const [, mode, id, input] = m;
  if (input === 'CRASH') process.exit(3);
  if (input === 'HANG') return;
  if (input === 'SLOW') { setTimeout(() => out(id, 'slow'), 80); return; }
  if (mode === 'dec' && input === 'NAME') {
    // 홍길동(EUC-KR) — 한 줄을 두 번에 나눠 보낸다(조각 이어 붙이기 확인)
    process.stdout.write(id + ':');
    setTimeout(() => process.stdout.write(Buffer.from([0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf, 0x0a])), 20);
    return;
  }
  out(id, mode + '(' + input + ')');
});
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kmc-fake-'));
  const file = join(dir, 'fake-kmc.js');
  writeFileSync(file, FAKE);
  cmd = { file: process.execPath, args: [file] };
});
afterEach(() => __resetKmcCryptoForTest());
afterAll(() => { __resetKmcCryptoForTest(); rmSync(dir, { recursive: true, force: true }); });

describe('KMC 암호화 모듈 규약', () => {
  it('enc · dec · msg 를 번호로 짝지어 돌려준다(CRLF 줄 끝도)', async () => {
    expect(await kmcCrypto(cmd, 'enc', 'ABC')).toBe('enc(ABC)');
    expect(await kmcCrypto(cmd, 'msg', 'X1')).toBe('msg(X1)');
    expect(await kmcCrypto(cmd, 'dec', 'Y2')).toBe('dec(Y2)');
  });

  it('여러 요청이 동시에 나가고 늦게 온 답도 제 요청에 붙는다', async () => {
    const [a, b, c] = await Promise.all([kmcCrypto(cmd, 'enc', 'SLOW'), kmcCrypto(cmd, 'enc', 'B'), kmcCrypto(cmd, 'dec', 'C')]);
    expect([a, b, c]).toEqual(['slow', 'enc(B)', 'dec(C)']);
  });

  it('결과 글자는 EUC-KR 로 풀고, 나뉘어 온 줄도 이어 붙인다', async () => {
    expect(await kmcCrypto(cmd, 'dec', 'NAME')).toBe('홍길동');
  });

  it('줄바꿈 · 빈 값 · 모르는 모드는 모듈에 쓰지 않고 거절한다', async () => {
    await expect(kmcCrypto(cmd, 'enc', 'A\nenc:1^*B')).rejects.toThrow('KMC_CRYPTO_INPUT');
    await expect(kmcCrypto(cmd, 'enc', '')).rejects.toThrow('KMC_CRYPTO_INPUT');
    await expect(kmcCrypto(cmd, 'xxx' as any, 'A')).rejects.toThrow('KMC_CRYPTO_MODE');
  });

  it('모듈이 죽으면 기다리던 요청은 실패하고, 다음 호출은 새로 띄워 처리한다', async () => {
    const waiting = kmcCrypto(cmd, 'enc', 'SLOW');
    const crash = kmcCrypto(cmd, 'enc', 'CRASH');
    await expect(crash).rejects.toThrow(/KMC_CRYPTO_EXITED/);
    await expect(waiting).rejects.toThrow(/KMC_CRYPTO_EXITED/);
    expect(await kmcCrypto(cmd, 'enc', 'AGAIN')).toBe('enc(AGAIN)');
  });

  it('실행 파일이 없으면 서버를 죽이지 않고 그 요청만 실패한다', async () => {
    await expect(kmcCrypto({ file: join(dir, 'no-such-kmc') }, 'enc', 'A')).rejects.toThrow(/KMC_CRYPTO_(SPAWN_FAILED|STDIN|EXITED)/);
    expect(await kmcCrypto(cmd, 'enc', 'OK')).toBe('enc(OK)');
  });

  it('바깥에서 온 암호문 모양 판정', () => {
    expect(isKmcToken('A'.repeat(128))).toBe(true);
    expect(isKmcToken('KMC000002-AB+/=_')).toBe(true);
    expect(isKmcToken('AB\nCD')).toBe(false);
    expect(isKmcToken('AB^*CD')).toBe(false);
    expect(isKmcToken('')).toBe(false);
    expect(isKmcToken(123)).toBe(false);
    expect(isKmcToken('A'.repeat(6001))).toBe(false);
  });
});

describe('KMC 암호화 모듈 — 멈춤', () => {
  it('10초 안에 답이 없으면 실패하고 모듈을 내린다(다음 호출은 새로 띄운다)', async () => {
    const hung = kmcCrypto(cmd, 'enc', 'HANG');
    await expect(hung).rejects.toThrow('KMC_CRYPTO_TIMEOUT');
    expect(await kmcCrypto(cmd, 'enc', 'NEXT')).toBe('enc(NEXT)');
  }, 15_000);
});
