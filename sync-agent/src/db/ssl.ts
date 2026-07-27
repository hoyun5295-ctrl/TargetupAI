/**
 * ssl.ts — DB 암호화(TLS) 연결 옵션 단일 소스 (★ 2026-07-27, Codex 2R 정정)
 *
 * 클라우드 DB(AWS Aurora/RDS, Azure SQL 등)는 `require_secure_transport=ON`이면 평문 연결을 거부한다.
 * 2026-07-27 MySQL 8.0.45 실측 — 옵션 없으면 `ER_SECURE_TRANSPORT_REQUIRED`(3159),
 * ssl 옵션만 주면 TLS_AES_256_GCM_SHA384로 접속 성공.
 *
 * 어댑터 3종(mysql·pg·mssql)이 각자 해석하면 규칙이 갈린다 — CA 읽기·검증 여부 판정은 여기 하나뿐이다.
 * (Codex 2R: mssql이 `sslCaPath`를 읽지도 않고 `trustServerCertificate`만 뒤집어, CA를 지정해도
 *  검증이 안 되고 잘못된 경로도 안 잡히던 결함을 이 CT로 닫는다.)
 */
import fs from 'fs';
import type { DbConnectionConfig } from './types';

export type DbSslConfig = Pick<DbConnectionConfig, 'ssl' | 'sslCaPath'>;

/** 해석된 TLS 옵션. undefined = 평문(기존 사내망 동작 그대로). */
export interface ResolvedDbSsl {
  /** CA 번들 — 지정된 경우에만. 있으면 서버 인증서를 검증한다. */
  ca?: Buffer;
  /** false = 암호화만 하고 인증서 검증 생략(사설·자체서명 허용). */
  rejectUnauthorized: boolean;
}

/**
 * CA 파일 읽기 — 못 읽으면 **던진다**.
 * 조용히 평문이나 무검증으로 내려가면 "검증되는 줄 아는" 상태가 되므로 설치 단계에서 드러낸다(fail-closed).
 */
export function readDbCa(caPath: string, readFile: (p: string) => Buffer = (p) => fs.readFileSync(p)): Buffer {
  try {
    return readFile(caPath);
  } catch (err: any) {
    throw new Error(`DB TLS CA 파일을 읽을 수 없습니다 (${caPath}): ${err?.message || err}`);
  }
}

/**
 * (순수) DB 설정 → TLS 옵션.
 * - `ssl:false`(기본) → undefined. 사내망 MySQL·MariaDB·MSSQL은 지금까지처럼 평문으로 붙는다.
 * - `ssl:true` + CA 없음 → `{ rejectUnauthorized: false }`. **암호화는 하되 인증서 검증은 생략**.
 *   Aurora는 AWS RDS CA로 서명돼 있어 검증하려면 CA 번들을 고객사 서버에 깔아야 한다 —
 *   VPC 안 연결이라 거기까지 요구하면 설치가 막힌다. 검증이 필요하면 CA 경로를 지정한다.
 * - `ssl:true` + CA 경로 → `{ ca, rejectUnauthorized: true }`. 검증까지 수행.
 */
export function resolveDbSslOption(
  cfg: DbSslConfig,
  readFile: (p: string) => Buffer = (p) => fs.readFileSync(p),
): ResolvedDbSsl | undefined {
  if (!cfg.ssl) return undefined;
  const caPath = String(cfg.sslCaPath || '').trim();
  if (!caPath) return { rejectUnauthorized: false };
  return { ca: readDbCa(caPath, readFile), rejectUnauthorized: true };
}
