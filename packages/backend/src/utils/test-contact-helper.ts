/**
 * ★ CT-11: test-contact-helper.ts — 담당자 사전수신 컨트롤타워
 *
 * 역할: 담당자(test_contacts) 조회/추가/삭제의 유일한 진입점
 * 적용 파일: test-contacts.ts (CRUD API), campaigns.ts (test-send)
 *
 * D97: 항상 사용자별 격리 — 각자 자기 담당자만 관리
 * 기존 공용(user_id=NULL) 데이터는 모든 사용자에게 보임 (하위호환)
 */

import { query } from '../config/database';

export interface TestContact {
  id?: string;
  name: string;
  phone: string;
  user_id?: string | null;
  created_at?: string;
}

/**
 * 사용자별 담당자 목록 조회
 * - 본인 것(user_id=userId) + 기존 공용(user_id=NULL) 포함
 */
export async function getUserTestContacts(companyId: string, userId: string): Promise<TestContact[]> {
  const result = await query(
    `SELECT id, name, phone, user_id, created_at
     FROM test_contacts
     WHERE company_id = $1 AND (user_id = $2 OR user_id IS NULL)
     ORDER BY created_at ASC`,
    [companyId, userId]
  );
  return result.rows;
}

/**
 * 담당자 추가 (항상 사용자별)
 * - user_id = userId로 저장
 * - 중복 체크: 본인 것 중에서만
 */
export async function addTestContact(
  companyId: string,
  userId: string,
  name: string,
  phone: string
): Promise<{ success: boolean; contact?: TestContact; error?: string }> {
  const cleanedPhone = phone.replace(/-/g, '');

  // 중복 체크
  const dup = await query(
    `SELECT id FROM test_contacts WHERE company_id = $1 AND phone = $2 AND user_id = $3`,
    [companyId, cleanedPhone, userId]
  );
  if (dup.rows.length > 0) {
    return { success: false, error: '이미 등록된 번호입니다' };
  }

  const result = await query(
    `INSERT INTO test_contacts (company_id, user_id, name, phone)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [companyId, userId, name, cleanedPhone]
  );

  return { success: true, contact: result.rows[0] };
}

/**
 * 담당자 삭제
 * - 본인 것(user_id=userId) 또는 공용(user_id=NULL)만 삭제 가능
 */
export async function deleteTestContact(
  id: string,
  companyId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const contactResult = await query(
    'SELECT user_id FROM test_contacts WHERE id = $1 AND company_id = $2',
    [id, companyId]
  );

  if (contactResult.rows.length === 0) {
    return { success: false, error: '담당자를 찾을 수 없습니다' };
  }

  const contactOwnerId = contactResult.rows[0].user_id;

  // 본인 것이거나 공용(user_id=NULL)만 삭제 가능
  if (contactOwnerId && contactOwnerId !== userId) {
    return { success: false, error: '삭제 권한이 없습니다' };
  }

  await query('DELETE FROM test_contacts WHERE id = $1', [id]);
  return { success: true };
}
