/**
 * woocommerce-header-limit.test.ts — 우커머스 인증 호출의 응답 헤더 수신 상한(★0921 · B-0921 HPE_HEADER_OVERFLOW)
 *
 * 운영 실측(iroirotokyo.net · scripts/diagnose-woo-headers.ts): 관리자 키로 인증된 REST 응답에 Query Monitor 가
 *   X-QM-php_errors-error-1~23 (줄당 약 1KB · 합계 20,196 bytes)을 실어 헤더 합계 21,494 bytes → Node 기본 상한 16,384 초과.
 * axios 를 mock 하지 않는다 — 상한은 axios → transport → Node HTTP 파서를 실제로 지나야 증명된다(대역이 실물보다 관대하면 결함을 덮는다).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));

import axios from 'axios';
import { wooWideHeaderTransport, WOO_MAX_HEADER_BYTES } from '../woocommerce-client';

let server: http.Server;
let base = '';

/** 운영 실측과 같은 모양 — 번호만 다른 디버깅 헤더 N줄 · 줄당 약 1KB */
function sendWithDebugHeaders(res: http.ServerResponse, lines: number): void {
  for (let i = 1; i <= lines; i++) res.setHeader(`X-QM-php_errors-error-${i}`, 'e'.repeat(960));
  res.setHeader('Content-Type', 'application/json');
  res.end('[]');
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const lines = Number(new URL(req.url || '/', 'http://x').searchParams.get('lines') || 0);
    sendWithDebugHeaders(res, lines);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const opts = { timeout: 5000, validateStatus: () => true, maxRedirects: 0 };

describe('우커머스 인증 호출 — 응답 헤더 수신 상한', () => {
  it('기준선: 기본 상한(16KB)에서는 23줄(약 22KB) 응답이 HPE_HEADER_OVERFLOW 로 떨어진다(운영 오류 재현)', async () => {
    expect(http.maxHeaderSize).toBe(16384);
    const err: any = await axios.get(`${base}/?lines=23`, opts).catch((e) => e);
    expect(err?.code).toBe('HPE_HEADER_OVERFLOW');
  });
  it('wooWideHeaderTransport 를 실으면 같은 응답을 받는다', async () => {
    const res = await axios.get(`${base}/?lines=23`, { ...opts, transport: wooWideHeaderTransport as any });
    expect(res.status).toBe(200);
    expect(res.data).toEqual([]);
    expect(Object.keys(res.headers).filter((k) => k.startsWith('x-qm-'))).toHaveLength(23);
  });
  it('상한은 무한이 아니다 — WOO_MAX_HEADER_BYTES 를 넘는 응답은 여전히 거부된다', async () => {
    expect(WOO_MAX_HEADER_BYTES).toBe(256 * 1024);
    const lines = Math.ceil(WOO_MAX_HEADER_BYTES / 960) + 20;
    const err: any = await axios.get(`${base}/?lines=${lines}`, { ...opts, transport: wooWideHeaderTransport as any }).catch((e) => e);
    expect(err?.code).toBe('HPE_HEADER_OVERFLOW');
  });
});
