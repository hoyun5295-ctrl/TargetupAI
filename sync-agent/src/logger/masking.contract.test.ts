/**
 * 로그 마스킹 계약 테스트 (★2026-09-12 신설 · ★2026-09-13 실제 포맷 사용 + 순환·axios 오류 사례)
 *
 *   경위: 마스킹 포맷이 `info.meta`만 보고 있었는데 호출부는 전부 `logger.info(메시지, { ... })` 형태라
 *   winston이 그 객체를 info **최상위에 병합**한다. 그래서 마스킹이 한 번도 동작하지 않았고
 *   비밀번호가 평문으로 로그에 남았다. 소스 전체에 `{ meta: ... }`로 넘기는 호출이 0건이었다.
 *
 *   0913: 그 정정이 info 전체를 따라 내려가게 되자, axios 오류(요청 객체가 순환한다)를 넘기는 순간
 *   무한 재귀로 로그 호출이 예외를 던졌다. 첫 등록 실패 시 로컬 모드 계속·전송 실패 시 오프라인 큐 저장이
 *   그 로그 호출 뒤에 있어 둘 다 죽는 경로였다(적대검토 high).
 *
 *   이 테스트는 **실제 호출부와 같은 형태**로 로그를 찍어 결과 문자열을 검사한다.
 *   ⛔ 마스킹 함수 단위 테스트로 대체하지 마라 — 함수는 멀쩡했고 **연결이 끊겨 있었다**.
 *   ⛔ 포맷을 여기서 다시 구현하지 마라 — `logger/index.ts`가 내보내는 그 포맷을 쓴다(복사본은 원본이 바뀌어도 통과한다).
 */
import { describe, it, expect } from 'vitest';
import winston from 'winston';
import { Writable } from 'stream';
import { AxiosError, AxiosHeaders } from 'axios';
import { maskingFormat, consoleFormat } from './index';

/** 한 줄을 찍어 최종 출력 문자열을 돌려준다(index.ts 루트 로거와 같은 순서: 마스킹 → errors → json) */
function logOnce(meta: Record<string, unknown>, level: 'info' | 'error' = 'info'): string {
  let out = '';
  const sink = new Writable({
    write(chunk, _enc, cb) { out += chunk.toString(); cb(); },
  });
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(maskingFormat(), winston.format.errors({ stack: true }), winston.format.json()),
    transports: [new winston.transports.Stream({ stream: sink })],
  });
  logger.log(level, '테스트 메시지', meta);
  return out;
}

describe('로그 마스킹: 실제 호출 형태(logger.info(메시지, {...}))에서 동작한다', () => {
  it('비밀번호·시크릿·전화·이메일이 원문 그대로 남지 않는다', () => {
    const out = logOnce({
      password: 'P@ssw0rd-REAL',
      api_secret: 'abcdef0123456789abcdef0123456789',
      apiSecret: 'zzzzzz9876543210zzzzzz9876543210',
      phone: '01012345678',
      email: 'user@example.com',
    });

    expect(out, '비밀번호가 평문으로 남았다').not.toContain('P@ssw0rd-REAL');
    expect(out, '시크릿이 평문으로 남았다').not.toContain('abcdef0123456789abcdef0123456789');
    expect(out, '시크릿(camelCase)이 평문으로 남았다').not.toContain('zzzzzz9876543210zzzzzz9876543210');
    expect(out, '전화번호가 평문으로 남았다').not.toContain('01012345678');
    expect(out, '이메일이 평문으로 남았다').not.toContain('user@example.com');

    expect(out).toContain('********');
    expect(out).toContain('010****5678');
    expect(out).toContain('u***@example.com');
  });

  it('마스킹 대상이 아닌 필드와 메시지는 그대로 둔다(기존 로그 읽기 무변경)', () => {
    const out = logOnce({ tableName: 'CUSTOMER', timestampCol: 'updated_at', rowCount: 4000 });
    expect(out).toContain('"tableName":"CUSTOMER"');
    expect(out).toContain('"timestampCol":"updated_at"');
    expect(out).toContain('"rowCount":4000');
    expect(out).toContain('테스트 메시지');
  });

  it('중첩 객체 안의 민감정보도 마스킹한다', () => {
    const out = logOnce({ config: { db: { user: 'sync_reader', password: 'INNER-SECRET' } } });
    expect(out, '중첩된 비밀번호가 평문으로 남았다').not.toContain('INNER-SECRET');
    expect(out).toContain('"user":"sync_reader"');
  });

  it('호출자가 넘긴 객체는 바꾸지 않는다(설정 객체의 비밀번호로 이후 접속한다)', () => {
    const config = { db: { password: 'KEEP-ME' } };
    logOnce({ config });
    expect(config.db.password).toBe('KEEP-ME');
  });

  it('winston 내부 심볼이 살아 있어 transport가 출력을 만든다', () => {
    // 새 객체로 갈아끼우면 Symbol.for('message')가 사라져 출력이 비어 버린다.
    const out = logOnce({ any: 'value' });
    expect(out.trim().length, '출력이 비었다 = 심볼이 끊겼다').toBeGreaterThan(0);
    expect(out).toContain('"level":"info"');
  });
});

describe('로그 마스킹: 순환·오류 객체에서 로그 호출이 예외를 던지지 않는다(★2026-09-13)', () => {
  it('순환 참조 객체를 넘겨도 한 줄이 찍힌다', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', a };
    a.b = b;
    let out = '';
    expect(() => { out = logOnce({ graph: a }); }).not.toThrow();
    expect(out).toContain('[Circular]');
  });

  it('axios 오류(요청 객체 순환 + 인증 헤더)를 넘겨도 죽지 않고 인증 헤더가 원문으로 남지 않는다', () => {
    const headers = new AxiosHeaders({ 'X-Sync-ApiKey': 'tk_live_key_0123456789abcdef', 'X-Sync-Secret': 'SECRET-HEADER-VALUE-0123456789abcdef' });
    // follow-redirects 요청 객체처럼 자기 자신을 가리키는 요청
    const request: Record<string, unknown> = {};
    request._currentRequest = { _redirectable: request };
    const err = new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', { headers } as any, request);
    let out = '';
    expect(() => { out = logOnce({ error: err }, 'error'); }).not.toThrow();
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out, '시크릿 헤더가 평문으로 남았다').not.toContain('SECRET-HEADER-VALUE-0123456789abcdef');
    expect(out, 'API 키 헤더가 평문으로 남았다').not.toContain('tk_live_key_0123456789abcdef');
    expect(out).toContain('Request failed with status code 401');
  });

  it('등록 요청 본문(config.data JSON 문자열)의 apiKey·apiSecret이 남지 않고, 상태·서버 안내·요청 주소는 남는다(★Codex 2R high)', () => {
    const body = JSON.stringify({ apiKey: 'tk_body_key_0123456789abcdef', apiSecret: 'BODY-SECRET-0123456789abcdef0123456789', agentName: 'a' });
    const config = { method: 'post', url: '/api/sync/register', baseURL: 'https://example.invalid', data: body, headers: new AxiosHeaders({ 'X-Sync-Secret': 'H-SECRET-0123456789' }) };
    const response = { status: 401, data: { error: '인증 실패' }, headers: {}, config, statusText: 'Unauthorized' };
    const err = new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config as any, {}, response as any);
    for (const fmt of ['file', 'console'] as const) {
      let out = '';
      const sink = new Writable({ write(chunk, _enc, cb) { out += chunk.toString(); cb(); } });
      const logger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(maskingFormat(), winston.format.errors({ stack: true })),
        transports: [new winston.transports.Stream({ stream: sink, format: fmt === 'file' ? winston.format.json() : consoleFormat })],
      });
      logger.error('Agent 등록 실패', { error: err });
      expect(out, `${fmt}: 본문 시크릿이 남았다`).not.toContain('BODY-SECRET-0123456789abcdef0123456789');
      expect(out, `${fmt}: 본문 API 키가 남았다`).not.toContain('tk_body_key_0123456789abcdef');
      expect(out, `${fmt}: 헤더 시크릿이 남았다`).not.toContain('H-SECRET-0123456789');
      expect(out).toContain('401');
      expect(out).toContain('인증 실패');
      expect(out).toContain('/api/sync/register');
    }
  });

  it('콘솔 출력은 순환 참조가 남은 클래스 인스턴스를 받아도 던지지 않는다', () => {
    class Node { self: Node; constructor() { this.self = this; } }
    let out = '';
    const sink = new Writable({ write(chunk, _enc, cb) { out += chunk.toString(); cb(); } });
    const logger = winston.createLogger({
      level: 'info',
      format: maskingFormat(),
      transports: [new winston.transports.Stream({ stream: sink, format: consoleFormat })],
    });
    expect(() => logger.info('순환 인스턴스', { node: new Node() })).not.toThrow();
    expect(out).toContain('순환 인스턴스');
  });

  it('일반 Error는 메시지가 남는다(종전에는 JSON에서 {}로 비었다)', () => {
    const out = logOnce({ error: new Error('연결 거부') }, 'error');
    expect(out).toContain('연결 거부');
  });
});
