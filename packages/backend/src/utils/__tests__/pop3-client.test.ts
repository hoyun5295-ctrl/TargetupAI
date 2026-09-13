/**
 * ★2026-09-13 POP3 multiline 수신 계약(적대검토 medium: 받을 때마다 버퍼 전체를 이어 붙여 O(n²)).
 *
 * 수신 방식을 바꿔도 **결과는 한 바이트도 달라지면 안 된다**: 본문·dot-stuffing 해제·끝 표시 뒤에 이어 온
 * 다음 응답·빈 본문·도중 끊김. 이메일 접수의 유일한 입구라 여기가 틀리면 메일이 통째로 안 들어온다.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { Pop3Client, Pop3Error } from '../pop3-client';

class FakeSocket extends EventEmitter {
  written: string[] = [];
  onWrite: (line: string) => void = () => {};
  write(data: string) { this.written.push(data); this.onWrite(data); return true; }
  destroy() { /* 테스트에서는 닫힘을 직접 보낸다 */ }
}

const makeClient = (sock: FakeSocket, timeoutMs = 3000) => new (Pop3Client as any)(sock, timeoutMs) as Pop3Client;

/** 조각마다 이벤트 루프를 한 번씩 넘겨 실제 네트워크처럼 여러 번 깨운다 */
async function feedChunks(sock: FakeSocket, chunks: Buffer[]): Promise<void> {
  for (const c of chunks) {
    await new Promise((r) => setImmediate(r));
    sock.emit('data', c);
  }
}

function split(buf: Buffer, size: number): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size));
  return out;
}

describe('Pop3Client multiline 수신', () => {
  it('큰 본문을 작은 조각으로 받아도 본문·dot-stuffing 해제·다음 응답이 그대로다', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 20000; i++) lines.push(`line-${i}`);
    lines.splice(123, 0, '..dotted');
    const stuffed = lines.join('\r\n');
    const expected = stuffed.replace('\r\n..dotted', '\r\n.dotted');
    const raw = Buffer.from(`+OK ${stuffed.length} octets\r\n${stuffed}\r\n.\r\n+OK bye\r\n`, 'binary');

    const sock = new FakeSocket();
    const client = makeClient(sock);
    sock.onWrite = (line) => { if (line.startsWith('RETR')) void feedChunks(sock, split(raw, 7)); };
    const body = await client.retr(1);
    expect(body.toString('binary')).toBe(expected);

    sock.onWrite = () => {};
    const next = await client.command('QUIT');
    expect(next.ok).toBe(true);
    expect(next.first).toBe('+OK bye');
  });

  it('끝 표시가 조각 경계에 걸쳐도 찾는다', async () => {
    const body = 'x'.repeat(5000);
    const sock = new FakeSocket();
    const client = makeClient(sock);
    sock.onWrite = (line) => {
      if (line.startsWith('RETR')) {
        void feedChunks(sock, [
          Buffer.from(`+OK\r\n${body}\r\n.`, 'binary'),
          Buffer.from('\r', 'binary'),
          Buffer.from('\n+OK next\r\n', 'binary'),
        ]);
      }
    };
    const got = await client.retr(1);
    expect(got.toString('binary')).toBe(body);
    sock.onWrite = () => {};
    expect((await client.command('NOOP')).first).toBe('+OK next');
  });

  it('빈 본문과 한 조각에 다 온 짧은 본문', async () => {
    const sock = new FakeSocket();
    const client = makeClient(sock);
    sock.onWrite = (line) => {
      if (line.startsWith('UIDL')) void feedChunks(sock, [Buffer.from('+OK\r\n.\r\n')]);
      if (line.startsWith('LIST')) void feedChunks(sock, [Buffer.from('+OK 2 messages\r\n1 100\r\n2 200\r\n.\r\n')]);
    };
    expect(await client.uidl()).toEqual([]);
    expect(await client.list()).toEqual([{ seq: 1, octets: 100 }, { seq: 2, octets: 200 }]);
  });

  it('본문 도중 연결이 끊기면 network 오류로 끝난다(멈추지 않는다)', async () => {
    const sock = new FakeSocket();
    const client = makeClient(sock);
    sock.onWrite = (line) => {
      if (line.startsWith('RETR')) {
        void (async () => {
          await feedChunks(sock, split(Buffer.from(`+OK\r\n${'y'.repeat(3000)}`, 'binary'), 500));
          await new Promise((r) => setImmediate(r));
          sock.emit('close');
        })();
      }
    };
    const err = await client.retr(1).catch((e) => e);
    expect(err).toBeInstanceOf(Pop3Error);
    expect((err as Pop3Error).kind).toBe('network');
  });
});
