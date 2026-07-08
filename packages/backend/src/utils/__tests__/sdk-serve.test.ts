import { describe, it, expect } from 'vitest';
import { serveSdkFile } from '../sdk-serve';

/**
 * ★ 2026-07-08 SDK 서빙 CT — 인앱 SDK 교차출처 서빙 + 버전 폴백.
 * 팝폰(정적 미배포 v0.3.6 스니펫)이 SPA index.html 대신 실제 SDK를 받게 하는 폴백을 실제 커밋 파일로 검증.
 */
function mockRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    statusCode: 200,
    body: null as any,
    contentType: null as any,
    setHeader(k: string, v: string) { this.headers[k] = v; return this; },
    status(c: number) { this.statusCode = c; return this; },
    type(t: string) { this.contentType = t; return this; },
    send(b: any) { this.body = b; return this; },
  };
  return res;
}

describe('serveSdkFile', () => {
  it('존재하는 버전(v0.3.9) = 그대로 서빙 + application/javascript + CORS', () => {
    const res = mockRes();
    serveSdkFile({ params: { version: 'v0.3.9' } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('application/javascript');
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(1000);
    expect(res.headers['X-Hjl-Sdk-Fallback']).toBeUndefined();
  });

  it('★ 미배포 버전(v0.3.6 = 팝폰) = 최신 커밋 버전으로 폴백 서빙 (index.html 아님)', () => {
    const res = mockRes();
    serveSdkFile({ params: { version: 'v0.3.6' } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('application/javascript');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).length).toBeGreaterThan(1000);
    // 폴백 헤더에 실제 서빙된 최신 버전이 찍힌다
    expect(res.headers['X-Hjl-Sdk-Fallback']).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('버전 형식 오류 = 400 (경로 조작 차단)', () => {
    const res = mockRes();
    serveSdkFile({ params: { version: '../../etc/passwd' } } as any, res as any);
    expect(res.statusCode).toBe(400);
  });
});
