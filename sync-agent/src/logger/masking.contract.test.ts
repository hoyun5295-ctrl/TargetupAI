/**
 * 로그 마스킹 계약 테스트 (★2026-09-12 신설)
 *
 *   경위: 마스킹 포맷이 `info.meta`만 보고 있었는데 호출부는 전부 `logger.info(메시지, { ... })` 형태라
 *   winston이 그 객체를 info **최상위에 병합**한다. 그래서 마스킹이 한 번도 동작하지 않았고
 *   비밀번호가 평문으로 로그에 남았다. 소스 전체에 `{ meta: ... }`로 넘기는 호출이 0건이었다.
 *
 *   이 테스트는 **실제 호출부와 같은 형태**로 로그를 찍어 결과 문자열을 검사한다.
 *   ⛔ 마스킹 함수 단위 테스트로 대체하지 마라 — 함수는 멀쩡했고 **연결이 끊겨 있었다**.
 *      끊김을 잡으려면 포맷을 통과한 최종 출력이어야 한다.
 */
import { describe, it, expect } from 'vitest';
import winston from 'winston';
import { Writable } from 'stream';
import { maskSensitiveData } from './masking';

/** logger/index.ts의 마스킹 포맷과 같은 구현(그 파일은 파일 transport를 만들어 테스트에서 부르지 않는다) */
const maskingFormat = winston.format((info) => {
  const masked = maskSensitiveData(info as unknown as Record<string, unknown>);
  for (const key of Object.keys(masked)) {
    (info as unknown as Record<string, unknown>)[key] = masked[key];
  }
  return info;
});

/** 한 줄을 찍어 최종 출력 문자열을 돌려준다 */
function logOnce(meta: Record<string, unknown>): string {
  let out = '';
  const sink = new Writable({
    write(chunk, _enc, cb) { out += chunk.toString(); cb(); },
  });
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(maskingFormat(), winston.format.json()),
    transports: [new winston.transports.Stream({ stream: sink })],
  });
  logger.info('테스트 메시지', meta);
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

  it('winston 내부 심볼이 살아 있어 transport가 출력을 만든다', () => {
    // 새 객체로 갈아끼우면 Symbol.for('message')가 사라져 출력이 비어 버린다.
    const out = logOnce({ any: 'value' });
    expect(out.trim().length, '출력이 비었다 = 심볼이 끊겼다').toBeGreaterThan(0);
    expect(out).toContain('"level":"info"');
  });
});
