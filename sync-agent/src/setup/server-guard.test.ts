/**
 * ★ 2026-10-29 설치 마법사 입구 = 이 PC 브라우저만(뿌리 R28) — 설계서 docs/2026-10-29-sync-agent-node24-wizard-loopback-design.md §2-1 · §2-2
 *   Host 대조 = 이 PC 브라우저가 연 악성 페이지가 DNS 재바인딩으로 같은 출처가 되어 들어오는 길을 닫는다.
 *   압축 본문 거절 = 공격자 Brotli 를 node:zlib 로 푸는 자리(CVE-2026-111497)를 Node 판과 무관하게 닫는다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { createSetupApp } from './server';

let server: http.Server | null = null;

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

/** 빈 포트를 먼저 받고 그 번호로 앱을 만든다(Host 허용 목록이 포트를 품는다) */
async function start(): Promise<number> {
  const srv = http.createServer();
  server = srv;
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const { port } = srv.address() as AddressInfo;
  srv.on('request', createSetupApp(port, () => {}));
  return port;
}

function send(port: number, o: { method?: string; path: string; host?: string; headers?: Record<string, string>; body?: Buffer }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: o.method ?? 'GET', path: o.path, headers: { host: o.host ?? `127.0.0.1:${port}`, ...(o.headers || {}) } },
      (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on('error', reject);
    req.end(o.body);
  });
}

const json = (v: unknown) => Buffer.from(JSON.stringify(v));

describe('설치 마법사 입구 — Host 대조', () => {
  it('이 PC 브라우저의 Host(127.0.0.1:포트 · localhost:포트) = 통과', async () => {
    const port = await start();
    expect((await send(port, { path: '/api/setup/ping' })).status).toBe(200);
    expect((await send(port, { path: '/api/setup/ping', host: `localhost:${port}` })).status).toBe(200);
    expect((await send(port, { path: '/', host: `LOCALHOST:${port}` })).status).toBe(200);
  });

  it('남의 이름 · 다른 포트 · 이름 덧붙임 = 403(주소마다 · 저장 주소 포함)', async () => {
    const port = await start();
    for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`, `127.0.0.1.evil.example:${port}`, `localhost.evil.example:${port}`]) {
      expect((await send(port, { path: '/api/setup/ping', host })).status, host).toBe(403);
      expect((await send(port, { path: '/', host })).status, host).toBe(403);
      const save = await send(port, { method: 'POST', path: '/api/setup/save', host, headers: { 'content-type': 'application/json' }, body: json({ config: {} }) });
      expect(save.status, host).toBe(403);
    }
  });
});

describe('설치 마법사 입구 — 압축 본문', () => {
  it('br · gzip · deflate 본문 = 풀지 않고 415', async () => {
    const port = await start();
    const raw = json({ type: 'mysql', host: '192.0.2.1', port: '3306', database: 'x', username: 'x', password: 'x' });
    for (const [enc, body] of [['br', zlib.brotliCompressSync(raw)], ['gzip', zlib.gzipSync(raw)], ['deflate', zlib.deflateSync(raw)]] as const) {
      const r = await send(port, { method: 'POST', path: '/api/setup/test-db', headers: { 'content-type': 'application/json', 'content-encoding': enc }, body });
      expect(r.status, enc).toBe(415);
    }
  });

  it('압축 안 한 JSON 본문 = 그대로 읽힌다(마법사 화면이 보내는 꼴)', async () => {
    const port = await start();
    const r = await send(port, { method: 'POST', path: '/api/setup/auto-mapping', headers: { 'content-type': 'application/json' }, body: json({ columns: ['HP', 'CUST_NM'], target: 'customers' }) });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).success).toBe(true);
  });
});
