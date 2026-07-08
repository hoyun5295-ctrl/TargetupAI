/**
 * ★ CT: DB 마이그레이션 미실행 503 분기 (db_alter_safety_net 룰, 2026-07-08)
 *
 * 신규 테이블/컬럼을 참조하는 endpoint에서, DDL(CREATE/ALTER)이 아직 실행되지 않은
 * 배포 순간에 500(column/relation does not exist) 대신 사용자 친화 503을 반환한다.
 *
 * - 42P01 relation does not exist  → 테이블 미생성 (신규 CREATE TABLE 대기)
 * - 42703 column does not exist     → 컬럼 미추가 (ALTER 대기)
 *
 * (기존 routes/cdp.ts 인라인 handleDbMigrationError는 column만 검사 → 신규 테이블은 못 잡음.
 *  이 CT는 테이블·컬럼 둘 다 커버. cdp.ts를 이 CT로 통일하는 것은 후속 정리.)
 */
import { Response } from 'express';

export function handleDbMigrationError(err: any, res: Response, tableName: string): boolean {
  const msg = String(err?.message || '');
  const code = String(err?.code || '');
  const missing =
    code === '42P01' ||
    code === '42703' ||
    (msg.includes('does not exist') && (msg.includes('column') || msg.includes('relation')));
  if (missing) {
    res.status(503).json({
      success: false,
      error: `DB 마이그레이션 필요 — 운영자에게 ${tableName} 테이블/컬럼 생성(CREATE/ALTER) 실행 요청 의무`,
      code: 'DB_MIGRATION_PENDING',
    });
    return true;
  }
  return false;
}
