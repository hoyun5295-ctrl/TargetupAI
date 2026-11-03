/**
 * db-errors.ts — DB 스키마 부재를 사용자 안내로 바꾸는 판정 (★ 2026-08-25 신설)
 *
 * CLAUDE.md `db_alter_safety_net`: ALTER로 추가한 컬럼을 쓰는 endpoint는 컬럼 부재를
 * **503 + `DB_MIGRATION_PENDING`** 으로 돌려준다. 500으로 흘리면 고객 화면에 DB 문법 오류가 뜬다.
 *
 * ⚠ 같은 판정이 이미 여러 파일에 인라인으로 흩어져 있다(`msg.includes('column') && msg.includes('does not exist')`).
 *   그것들을 이 함수로 모으는 일은 이번 축 밖이라 손대지 않았다(별도 과제).
 *   **새로 쓰는 자리는 여기를 쓴다** — 판정을 또 한 벌 인라인으로 적지 않는다.
 */

import { UserFacingError } from './http-error';

/** PG가 없는 컬럼·테이블을 만났을 때(42703 / 42P01)인가 */
export function isMissingSchemaError(err: any): boolean {
  const code = String(err?.code || '');
  if (code === '42703' || code === '42P01') return true;
  const msg = String(err?.message || '').toLowerCase();
  return (msg.includes('column') || msg.includes('relation')) && msg.includes('does not exist');
}

/**
 * ★ 2026-11-04 C99 — 라우트 밖(공용 쓰기 CT)에서 칸 부재를 503 DB_MIGRATION_PENDING 사용자 오류로 바꿔 던진다(그 밖 오류는 그대로).
 *   라우트의 UserFacingError 처리(status · code)가 그대로 응답한다.
 */
export async function migrationPendingOn503<T>(alterHint: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isMissingSchemaError(err)) throw new UserFacingError(503, 'DB_MIGRATION_PENDING', migrationPendingBody(alterHint).error);
    throw err;
  }
}

/** 마이그레이션 대기 응답 본문. 라우트가 503과 함께 그대로 돌려준다 */
export function migrationPendingBody(alterHint: string): { success: false; code: 'DB_MIGRATION_PENDING'; error: string } {
  return {
    success: false,
    code: 'DB_MIGRATION_PENDING',
    error: `DB 마이그레이션이 필요합니다. ${alterHint} 실행을 요청해 주세요.`,
  };
}
