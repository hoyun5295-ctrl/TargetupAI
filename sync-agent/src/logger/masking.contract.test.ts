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
import { scrubText, maskRecordKey, maskPhone } from './masking';

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

  it('같은 객체를 두 필드에 넘겨도(순환 아님) 둘 다 제대로 찍힌다', () => {
    const shared = { tableName: 'CUSTOMER' };
    const out = logOnce({ source: shared, target: shared });
    expect(out).not.toContain('[Circular]');
    expect(out.match(/"tableName":"CUSTOMER"/g)?.length).toBe(2);
  });

  it('DB 드라이버 오류의 구조화된 진단 값은 남고, 쿼리 원문·자유 문장(행 값이 들어가는 detail)은 남지 않는다', () => {
    const dbErr = Object.assign(new Error('Invalid column name'), {
      number: 207, state: 1, lineNumber: 3, serverName: 'DBSRV', sqlState: '42S22', constraint: 'customers_email_key',
      detail: 'Key (email)=(row-value@example.com) already exists.', hint: 'HINT-ROW-VALUE', sqlMessage: 'MSG-ROW-VALUE',
      sql: 'SELECT secret_col FROM t',
    });
    const out = logOnce({ error: dbErr }, 'error');
    expect(out).toContain('"number":207');
    expect(out).toContain('"sqlState":"42S22"');
    expect(out).toContain('"constraint":"customers_email_key"');
    expect(out).not.toContain('row-value@example.com');
    expect(out).not.toContain('HINT-ROW-VALUE');
    expect(out).not.toContain('MSG-ROW-VALUE');
    expect(out).not.toContain('SELECT secret_col FROM t');
  });

  it('실제 드라이버처럼 message·sqlMessage·stack에 같은 행 값이 들어 있어도 이메일·휴대폰 번호는 가리고 오류 문장은 남긴다(Codex 5R)', () => {
    // ★2026-09-13(3) 드라이버 문장 모양 그대로(끝 구문이 메시지 끝) · 값 안에 이메일과 번호가 함께 있는 경우
    const text = "Duplicate entry 'row-value@example.com 01000001234' for key 'email'";
    const dbErr = Object.assign(new Error(text), { code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000', sqlMessage: text });
    const out = logOnce({ error: dbErr }, 'error');
    expect(out, '이메일 원문이 남았다').not.toContain('row-value@example.com');
    expect(out, '휴대폰 번호 원문이 남았다').not.toContain('01000001234');
    expect(out).toContain('Duplicate entry');
    // ★2026-09-13(3) 중복 키 값 자리는 통째로 가린다(이메일만이 아니라 이름 같은 값도 남지 않게)
    expect(out).toContain("Duplicate entry '***' for key 'email'");
    expect(out).toContain('"errno":1062');
  });

  it('문장 안 휴대폰 번호는 흔한 표기(공백·괄호·+82)도 가리고, 유닉스 시각 같은 숫자는 건드리지 않는다(Codex 6R)', () => {
    for (const raw of ['010 0000 1234', '(010)0000-1234', '+82-10-0000-1234', '+821000001234', '010-0000-1234', '+82 (0)10-0000-1234']) {
      const out = scrubText(`dup value ${raw} end`);
      expect(out, raw).not.toContain(raw);
      expect(out, raw).toContain('****1234');
    }
    expect(scrubText('ts=1694567890 port=5432 v1.10.12')).toBe('ts=1694567890 port=5432 v1.10.12');
  });

  it('긴 토큰에서도 이메일 탐색이 오래 걸리지 않고, 서버 안내 문장은 가린 뒤 자른다(Codex 6R)', () => {
    const long = 'a'.repeat(200_000) + '@';
    const started = Date.now();
    scrubText(long);
    expect(Date.now() - started, '긴 토큰 처리 시간').toBeLessThan(1000);

    const config = { method: 'post', url: '/api/sync/customers' };
    const response = { status: 400, data: { error: `${' '.repeat(286)}alice@example.com 오류` }, headers: {}, config, statusText: 'Bad Request' };
    const err = new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', config as any, {}, response as any);
    const out = logOnce({ error: err }, 'error');
    expect(out, '잘린 경계의 이메일 앞부분이 남았다').not.toContain('alice@');
  });

  it('일반 Error는 메시지가 남는다(종전에는 JSON에서 {}로 비었다)', () => {
    const out = logOnce({ error: new Error('연결 거부') }, 'error');
    expect(out).toContain('연결 거부');
  });
});

describe('★2026-09-13 적대검토 등재분: 시크릿은 앞뒤도 남기지 않고, 행 식별값의 번호는 표기와 무관하게 가린다', () => {
  it('apiSecret·api_secret은 전부 가린다(앞뒤 4자도 남기지 않는다 · 등재 ⑤)', () => {
    const out = logOnce({
      apiSecret: 'zzzz0000111122223333444455556666',
      api_secret: 'yyyy0000111122223333444455557777',
      apiKey: 'tk_abcd00001111wxyz',
    });
    expect(out).not.toContain('zzzz');
    expect(out).not.toContain('6666');
    expect(out).not.toContain('yyyy');
    expect(out).toContain('"apiSecret":"********"');
    expect(out).toContain('"api_secret":"********"');
    // 키는 식별값이라 종전대로 앞뒤 4자를 남긴다(현장에서 어느 키인지 대조한다)
    expect(out).toContain('"apiKey":"tk_a****wxyz"');
  });

  it('행 식별값(recordKey)은 정규화에 실패한 표기의 번호도 가린다(등재 ⑥)', () => {
    // 번호로 보이는 조각은 뒤 4자리만 남긴다(행 대조용). 공용 maskPhone(앞 3 + 뒤 4)은 8~9자리에서 한두 자리만 가린다(워크플로 2R)
    expect(maskRecordKey('010-0000-1234')).toBe('****1234');
    expect(maskRecordKey('10 0000 1234')).toBe('****1234'); // 앞 0이 빠진 엑셀 숫자 표기
    expect(maskRecordKey('ORD-77|01000001234')).toBe('ORD-77|****1234'); // 원본 PK를 이은 값
    expect(maskRecordKey('2345-6789')).toBe('****6789'); // 국번 없는 유선 4+4
    expect(maskRecordKey('02-123-4567')).toBe('****4567');
    // 전각 숫자로 적힌 번호(워크플로 3R low · 정규화도 실패해 원문 그대로 식별값이 된다)
    expect(maskRecordKey('０１０００００１２３４')).toBe('****1234');
    // ★워크플로 1R: 가장 짧은 온전한 국내 번호(국번 없는 유선 3+4 = 7자리)는 통째로 가린다
    expect(maskRecordKey('234-5678')).toBe('****');
    expect(maskRecordKey('unknown')).toBe('unknown');
    expect(maskRecordKey('row@example.com')).toBe('r***@example.com');
  });
});

describe('★2026-09-13(3) 수용 위험 제거: DB 오류 문장의 행 값 자리 · ICU 없는 숫자 · 진단 필드', () => {
  it('드라이버가 행 값을 싣는 자리는 값이 무엇이든 가리고, 오류 종류·키·열 이름은 남긴다', () => {
    const cases: Array<[string, string, string]> = [
      ["Duplicate entry '홍길동-서울' for key 'uk_name'", '홍길동', "Duplicate entry '***' for key 'uk_name'"],
      ["Incorrect integer value: '홍길동' for column 'age' at row 1", '홍길동', "Incorrect integer value: '***' for column 'age'"],
      // 끝 모양(' for column)이 없는 문장은 문장 끝까지 가린다
      ["Truncated incorrect DOUBLE value: '홍길동'", '홍길동', "Truncated incorrect DOUBLE value: '***"],
      ['invalid input syntax for type integer: "홍길동"', '홍길동', 'invalid input syntax for type integer: "***"'],
      ['invalid input value for enum gender: "홍길동"', '홍길동', 'invalid input value for enum gender: "***"'],
      ['Key (name)=(홍길동) already exists.', '홍길동', 'Key (name)=(***) already exists'],
      ["Cannot insert duplicate key row in object 'dbo.customers' with unique index 'ix_name'. The duplicate key value is (홍길동, 서울).", '홍길동', 'The duplicate key value is (***).'],
      ["Conversion failed when converting the nvarchar value '홍길동' to data type int.", '홍길동', "converting the nvarchar value '***' to data type int"],
    ];
    for (const [raw, secret, kept] of cases) {
      const out = scrubText(raw);
      expect(out, raw).not.toContain(secret);
      expect(out, raw).toContain(kept);
    }
  });

  it('값 안의 따옴표·개행·끝 모양·긴 값, 끝 모양이 없는 문장에서도 값이 남지 않는다(Codex 적대 1R high)', () => {
    const cases: Array<[string, string]> = [
      ['invalid input syntax for type integer: "x"홍길동"', '홍길동'],
      ["Duplicate entry '홍\n길동' for key 'uk_name'", '길동'],
      ["Duplicate entry 'a' for key b 홍길동' for key 'uk_name'", '홍길동'],
      [`Duplicate entry '${'가'.repeat(600)}홍길동' for key 'uk_name'`, '홍길동'],
      ["Duplicate entry '홍길동", '홍길동'],
      ['Key (name)=(홍길동) already exists 뒤) already exists', '뒤'],
      ["Conversion failed when converting the nvarchar value 'a' to data type 홍길동' to data type int.", '홍길동'],
      // Codex 2R high: 끝 구문이 없는 형식에 끝 모양 조각이 섞인 값
      ["Truncated incorrect DOUBLE value: 'aaa' for column SECRET'", 'SECRET'],
      // 값 안의 가짜 끝 구문이 줄 끝에 오고 다음 줄에 비밀값이 이어진다(진짜 끝 구문은 그 뒤에 있다)
      ["Incorrect integer value: 'aaa' for column 'x' at row 1\nSECRET' for column 'age' at row 1", 'SECRET'],
      ["Duplicate entry 'a' for key 'k'\nSECRET' for key 'uk_name'", 'SECRET'],
      // Codex 3R medium: 진짜 끝 구문이 모양에서 벗어나면(키 이름에 따옴표) 앞줄 가짜 끝 구문으로 물러나지 않는다
      ["Duplicate entry 'a' for key 'k'\nSECRET' for key 't.uk'name'", 'SECRET'],
      ["Duplicate entry 'a' for key 'k'\nSECRET' for key 'uk'\n    at 가짜 줄", 'SECRET'],
      // Codex 6R medium: 서로 다른 DB 오류가 합쳐진 문장(앞 형식 치환이 뒤 형식의 시작 표식을 지우던 것)
      ["Duplicate entry 'x' for key 'uk'\nTruncated incorrect DOUBLE value: 'a' for key '홍길동'", '홍길동'],
      ["Truncated incorrect DOUBLE value: 'a'\nDuplicate entry '홍길동' for key 'uk'", '홍길동'],
      ['invalid input syntax for type integer: "x"\nKey (name)=(홍길동) already exists.', '홍길동'],
    ];
    for (const [raw, secret] of cases) {
      expect(scrubText(raw), raw.slice(0, 40)).not.toContain(secret);
    }
    expect(scrubText("Duplicate entry 'a' for key b 홍길동' for key 'uk_name'")).toContain("for key 'uk_name'");
  });

  it('로그의 오류 스택은 통째로 가린다: DB 값 자리가 있으면 값이 남지 않고, 보통 오류는 프레임이 남는다(Codex 5R medium)', () => {
    const err = new Error("Duplicate entry '홍길동' for key 'uk_name'");
    err.stack = `Error: ${err.message}\n    at Query.execute (/app/node_modules/mysql2/lib/query.js:10:5)\n    at run (/app/sync.js:3:1)`;
    const out = logOnce({ error: err }, 'error');
    expect(out).not.toContain('홍길동');
    expect(out).toContain('"message":"Duplicate entry \'***\' for key \'uk_name\'"');
    // 스택 생성 뒤 메시지가 바뀌어도 스택의 값이 남지 않는다
    const changed = new Error("Duplicate entry '홍길동' for key 'uk_name'");
    changed.stack = `Error: ${changed.message}\n    at run (sync.js:1:1)`;
    changed.message = 'Duplicate entry';
    expect(logOnce({ error: changed }, 'error')).not.toContain('홍길동');
    // DB 값 자리가 없는 보통 오류는 프레임이 그대로다
    const plain = new Error('연결 거부');
    plain.stack = 'Error: 연결 거부\n    at connect (/app/db.js:7:3)';
    expect(logOnce({ error: plain }, 'error')).toContain('at connect (/app/db.js:7:3)');
  });

  it('Codex 4R medium: 경계를 모르는 문자열은 스택 모양 줄을 믿지 않는다(값 안에서 잘린 가짜 스택 줄)', () => {
    for (const raw of [
      "Duplicate entry 'x' for key 'k'\n    at 홍길동:1:2",
      "Incorrect integer value: 'x' for column 'c' at row 1\n    at 홍길동 (a.js:1:2)",
      'invalid input syntax for type integer: "x"\n    at 홍길동:1:2',
    ]) {
      expect(scrubText(raw), raw.slice(0, 30)).not.toContain('홍길동');
    }
    // 로그 경로도 원본 메시지가 스택에 그대로 있으면 그 경계만 믿는다(메시지 자체가 잘린 값이면 끝까지 가린다)
    const err = new Error("Duplicate entry 'x' for key 'k'\n    at 홍길동:1:2");
    expect(logOnce({ error: err }, 'error')).not.toContain('홍길동');
  });

  it('로그 경로(message·stack)에서도 값 자리가 가려진다', () => {
    const text = "Duplicate entry '홍길동' for key 'uk_name'";
    const out = logOnce({ error: Object.assign(new Error(text), { code: 'ER_DUP_ENTRY', errno: 1062 }) }, 'error');
    expect(out).not.toContain('홍길동');
  });

  it('긴 값·닫는 따옴표가 없는 문장에서도 오래 걸리지 않는다', () => {
    const started = Date.now();
    scrubText(`Duplicate entry '${'x'.repeat(200_000)}`);
    scrubText(`Key (a)=(${'y'.repeat(200_000)}`);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('행 식별값: 아랍-인도 숫자도 번호로 센다(NFKC로 바뀌지 않는 블록)', () => {
    expect(maskRecordKey('٠١٠٠٠٠٠١٢٣٤')).toBe('****1234');
    expect(maskRecordKey('۰۱۰۰۰۰۰۱۲۳۴')).toBe('****1234');
  });

  it('행 식별값: NFKC가 아무 일도 하지 않는 환경(ICU 없는 빌드)에서도 전각 숫자를 센다', () => {
    const original = String.prototype.normalize;
    String.prototype.normalize = function (this: string) { return String(this); } as any;
    try {
      expect(maskRecordKey('０１０００００１２３４')).toBe('****1234');
    } finally {
      String.prototype.normalize = original;
    }
  });

  it('PostgreSQL 진단 위치·형식과 mysql2 fatal(불리언)은 남긴다', () => {
    const pgErr = Object.assign(new Error('value too long'), { code: '22001', file: 'varchar.c', line: '638', dataType: 'character varying', internalPosition: '3' });
    const out = logOnce({ error: pgErr }, 'error');
    expect(out).toContain('"file":"varchar.c"');
    expect(out).toContain('"line":"638"');
    expect(out).toContain('"dataType":"character varying"');
    expect(out).toContain('"internalPosition":"3"');
    const myErr = Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true });
    expect(logOnce({ error: myErr }, 'error')).toContain('"fatal":true');
  });
});

describe('★2026-09-13(3) 공용 maskPhone: 11자리 이상은 종전 모양, 8~10자리는 뒤 4자리만(싱크 ⓓ)', () => {
  it('11자리 이상 모양은 그대로다(기존 로그·미리보기 무변경)', () => {
    expect(maskPhone('01000001234')).toBe('010****1234');
    expect(maskPhone('010-0000-1234')).toBe('010****1234');
  });

  it('8~10자리는 앞자리를 남기지 않는다(종전은 8자리에서 1자리만 가렸다)', () => {
    expect(maskPhone('1588-1234')).toBe('****1234');
    expect(maskPhone('2345-6789')).toBe('****6789');
    expect(maskPhone('02-123-4567')).toBe('****4567');
    expect(maskPhone('02-1234-5678')).toBe('****5678');
    expect(maskPhone('031-123-4567')).toBe('****4567');
  });

  it('7자리 이하·빈 값은 통째로 가린다', () => {
    expect(maskPhone('234-5678')).toBe('****');
    expect(maskPhone('')).toBe('****');
  });

  it('어느 길이든 최소 4자리를 가린다', () => {
    for (let len = 8; len <= 13; len++) {
      const raw = '0' + '123456789012'.slice(0, len - 1);
      const shown = maskPhone(raw).replace(/\D/g, '').length;
      expect(len - shown, `len=${len}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('로그 phone 키 경로에서도 짧은 번호의 앞자리가 남지 않는다', () => {
    const out = logOnce({ phone: '02-123-4567', customer_phone: '1588-1234' });
    expect(out).toContain('"phone":"****4567"');
    expect(out).toContain('"customer_phone":"****1234"');
  });
});
