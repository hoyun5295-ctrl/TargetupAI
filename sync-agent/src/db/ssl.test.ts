/**
 * mysql.ssl.test.ts — 암호화(TLS) 연결 옵션 해석 (★ 2026-07-27)
 *
 * 배경: 클라우드 DB(AWS Aurora/RDS)는 `require_secure_transport=ON`이면 평문 연결을 거부한다.
 *   2026-07-27 MySQL 8.0.45 실측 — 옵션 없으면 `ER_SECURE_TRANSPORT_REQUIRED`(3159),
 *   ssl 옵션만 주면 TLS_AES_256_GCM_SHA384로 접속 성공.
 *
 * 계약:
 *  - ssl 미설정/false = undefined → mysql2에 ssl 키를 아예 넘기지 않는다(기존 평문 동작 보존)
 *  - ssl=true, CA 없음 = 암호화만(검증 생략)
 *  - ssl=true, CA 있음 = 검증까지
 *  - CA 파일을 못 읽으면 던진다 — 평문으로 조용히 내려가지 않는다
 */
import { describe, it, expect } from 'vitest';
import { resolveDbSslOption, readDbCa } from './ssl';

const CA = Buffer.from('---CA---');
const okRead = () => CA;
const failRead = () => {
  throw new Error('ENOENT: no such file');
};

describe('resolveDbSslOption (mysql·pg·mssql 공용)', () => {
  it('ssl 미설정 = undefined (평문 — 기존 사내망 동작 그대로)', () => {
    expect(resolveDbSslOption({}, okRead)).toBeUndefined();
    expect(resolveDbSslOption({ ssl: false }, okRead)).toBeUndefined();
  });

  it('ssl=true + CA 없음 = 암호화만, 인증서 검증 생략', () => {
    expect(resolveDbSslOption({ ssl: true }, okRead)).toEqual({ rejectUnauthorized: false });
  });

  it('CA 경로가 공백뿐이면 CA 미지정과 같게 처리', () => {
    expect(resolveDbSslOption({ ssl: true, sslCaPath: '   ' }, okRead)).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('ssl=true + CA 경로 = 검증까지 수행', () => {
    expect(resolveDbSslOption({ ssl: true, sslCaPath: '/etc/ssl/rds-ca.pem' }, okRead)).toEqual({
      ca: CA,
      rejectUnauthorized: true,
    });
  });

  it('CA 파일을 못 읽으면 던진다 — 평문 폴백 금지(암호화된 줄 아는 상태 차단)', () => {
    expect(() => resolveDbSslOption({ ssl: true, sslCaPath: '/no/such.pem' }, failRead)).toThrow(
      /TLS CA 파일을 읽을 수 없습니다/,
    );
  });

  it('CA를 지정해도 ssl=false면 평문 — 켜는 스위치는 ssl 하나뿐', () => {
    expect(resolveDbSslOption({ ssl: false, sslCaPath: '/etc/ssl/rds-ca.pem' }, okRead)).toBeUndefined();
  });

  // ★ Codex 2R-4: mssql이 CA를 읽지도 않고 trustServerCertificate만 뒤집던 결함을 이 CT로 닫았다.
  //   어댑터 3종이 같은 함수를 쓰므로 "CA를 줬는데 검증이 안 되는" 상태가 구조적으로 안 생긴다.
  it('readDbCa — 읽기 실패는 던진다(무검증·평문 폴백 없음)', () => {
    expect(readDbCa('/etc/ssl/rds-ca.pem', okRead)).toEqual(CA);
    expect(() => readDbCa('/no/such.pem', failRead)).toThrow(/TLS CA 파일을 읽을 수 없습니다/);
  });
});
