/**
 * CT: 싱크에이전트 시스템 가상 user 보장 (is_system=true) — 없으면 생성, 있으면 조회.
 *
 * ★ 42P08 fix (2026-07-01): 기존 sync.ts / companies.ts 인라인 INSERT가 `$1`을
 *   company_id(uuid)와 `'system_sync_' || $1::text`(text) 두 곳에 써서, PostgreSQL이
 *   같은 파라미터 $1을 uuid·text 양쪽으로 추론 → "inconsistent types deduced for
 *   parameter $1 (text versus uuid)" 42P08로 매번 실패했다(D162 계열).
 *   → company_id는 `$1::uuid`, login_id 접미사는 별도 `$2::text`로 타입을 고정한다.
 *   두 곳에 흩어진 동일 INSERT를 이 CT로 통합(인라인 중복 제거, controltower_first).
 *
 * login_id = 'system_sync_<companyId>', user_type='system'. 회사당 1명(ON CONFLICT DO NOTHING).
 * 결과 데이터는 기존과 동일 — 타입 힌트만 명시해 42P08만 제거한다(로직·컬럼 변경 없음).
 */
import { query } from '../config/database';

export async function ensureSystemSyncUser(companyId: string): Promise<string | null> {
  // 1. 이미 있으면 그대로 사용
  const existing = await query(
    `SELECT id FROM users WHERE company_id = $1::uuid AND is_system = true LIMIT 1`,
    [companyId],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  // 2. 없으면 생성 — 타입 고정($1::uuid + $2::text)으로 42P08 차단
  const created = await query(
    `INSERT INTO users (id, company_id, login_id, user_type, name, is_active, is_system, password_hash, status)
     VALUES (gen_random_uuid(), $1::uuid, 'system_sync_' || $2::text, 'system', '싱크에이전트 (시스템)', true, true, '', 'active')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [companyId, companyId],
  );
  if (created.rows[0]?.id) return created.rows[0].id;

  // 3. 경합으로 이미 생성된 경우 재조회
  const re = await query(
    `SELECT id FROM users WHERE company_id = $1::uuid AND is_system = true LIMIT 1`,
    [companyId],
  );
  return re.rows[0]?.id || null;
}
