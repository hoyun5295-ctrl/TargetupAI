/**
 * outbound-guard.test.ts — 서버 밖 요청 SSRF 가드(★ 2026-10-27 자사몰 대비 K8 · 묶음 0)
 *
 * axios 를 mock 하지 않는다 — 가드는 axios → transport(넓은 헤더) · follow-redirects → Node 소켓 lookup 을 실제로 지나야 증명된다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import axios from 'axios';
import { isPrivateIp, guardedLookup, isBlockedLiteralHost, assertOutboundUrl, OUTBOUND_AXIOS_GUARD, OUTBOUND_BLOCKED } from '../outbound-guard';
import { wooWideHeaderTransport } from '../woocommerce-client';

describe('사설 범위 = 옛 두 사본(DM · 영업)의 합집합', () => {
  it('막는 주소', () => {
    for (const ip of [
      '0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '100.127.255.255', '169.254.169.254', '172.16.0.1', '172.31.255.255',
      '192.168.0.1', '198.18.0.1', '198.19.255.255', '224.0.0.1', '255.255.255.255', 'not-an-ip',
      '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'febf::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:100.64.0.1',
    ]) expect(isPrivateIp(ip), ip).toBe(true);
  });
  it('여는 주소', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.15.0.1', '172.32.0.1', '198.20.0.1', '223.255.255.255', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
  it('★Codex 1R — IPv6 안에 IPv4 를 싣는 꼴(16진 매핑 · 펼친 꼴 · 호환 · 번역 · NAT64 · 6to4) = 그 IPv4 로 판정 · 못 읽는 글자 = 차단', () => {
    for (const ip of [
      '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:7f00:0001', '::ffff:a9fe:a9fe', '::ffff:0a00:0001',
      '::7f00:1', '::127.0.0.1', '::ffff:0:7f00:1', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b:1::1', '2002:7f00:1::', '2002:a9fe:a9fe::1',
      '[::ffff:7f00:1]', 'fe80::1%eth0', 'fec0::1', '2001:db8::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '100::1', 'ff02::1',
      '1::2::3', ':::1', '12345::1', 'g::1', '::ffff:999.0.0.1',
    ]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1', '2606:4700:4700::1111', '2001:4860:4860:0:0:0:0:8888']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
    expect(() => assertOutboundUrl('http://[::ffff:7f00:1]:8080/wp-json')).toThrow();
    expect(() => OUTBOUND_AXIOS_GUARD.beforeRedirect({ hostname: '::ffff:7f00:1' })).toThrow();
    expect(() => OUTBOUND_AXIOS_GUARD.beforeRedirect({ hostname: '[::ffff:a9fe:a9fe]' })).toThrow();
    // WHATWG URL 이 매핑 주소를 16진으로 바꿔 내보내는 꼴 그대로(우회 반례 원문)
    expect(new URL('http://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
    expect(isBlockedLiteralHost(new URL('http://[::ffff:127.0.0.1]/').hostname)).toBe(true);
  });
  it('IP 리터럴 호스트 판정(대괄호 IPv6 포함) · 이름은 lookup 가드 몫', () => {
    expect(isBlockedLiteralHost('127.0.0.1')).toBe(true);
    expect(isBlockedLiteralHost('[::1]')).toBe(true);
    expect(isBlockedLiteralHost('8.8.8.8')).toBe(false);
    expect(isBlockedLiteralHost('localhost')).toBe(false);
    expect(() => assertOutboundUrl('http://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => assertOutboundUrl('https://[::1]:8443/')).toThrow();
    expect(() => assertOutboundUrl('https://shop.example.com/wp-json')).not.toThrow();
  });
  it('리다이렉트 홉의 사설 IP 리터럴 = 거절', () => {
    expect(() => OUTBOUND_AXIOS_GUARD.beforeRedirect({ hostname: '10.0.0.5' })).toThrow();
    expect(() => OUTBOUND_AXIOS_GUARD.beforeRedirect({ hostname: 'shop.example.com' })).not.toThrow();
  });
});

describe('lookup 가드 — 이름이 사설 주소로 풀리면 연결 0', () => {
  it('localhost = 막힘(오류 코드)', async () => {
    const err: any = await new Promise((resolve) => guardedLookup('localhost', { all: true }, (e: unknown) => resolve(e)));
    expect(err?.code).toBe(OUTBOUND_BLOCKED);
  });
});

describe('axios 실물 — 넓은 헤더 transport · follow-redirects 가 lookup 가드를 따른다', () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(`${req.headers.host}${req.url}`);
      if (req.url === '/start') { res.statusCode = 302; res.setHeader('Location', `http://b.test:${port}/next`); res.end(); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end('[]');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  it('넓은 헤더 transport(인증 호출 · 리다이렉트 0) = localhost 연결 거절 · 서버 도달 0', async () => {
    hits.length = 0;
    const err: any = await axios.get(`http://localhost:${port}/x`, { timeout: 5000, validateStatus: () => true, maxRedirects: 0, ...OUTBOUND_AXIOS_GUARD, transport: wooWideHeaderTransport as any }).catch((e) => e);
    expect(err?.code).toBe(OUTBOUND_BLOCKED);
    expect(hits).toEqual([]);
  });

  it('리다이렉트를 따라가는 호출(Store API · maxRedirects 3) = 다음 홉도 가드를 지난다', async () => {
    hits.length = 0;
    // 첫 홉 a.test 만 시험 서버로 풀어 주고, 그 밖 이름은 실제 가드에 맡긴다(b.test → 가드가 해석 실패 · localhost 계열은 차단)
    const lookup = (host: string, opts: unknown, cb: (...a: any[]) => void) =>
      host === 'a.test' ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : guardedLookup('localhost', opts, cb);
    const err: any = await axios.get(`http://a.test:${port}/start`, { timeout: 5000, validateStatus: () => true, maxRedirects: 3, ...OUTBOUND_AXIOS_GUARD, lookup: lookup as any }).catch((e) => e);
    expect(hits).toEqual([`a.test:${port}/start`]);
    expect(err?.code).toBe(OUTBOUND_BLOCKED);
  });
});
