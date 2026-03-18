// ============================================================
//  CT-10: sender-registration.ts — 발신번호 등록 신청/승인/반려 컨트롤타워
//  역할: 발신번호 등록 워크플로우의 유일한 진입점
//        - 고객사관리자: 담당자 등록, 발신번호 등록 신청, 내 신청 조회
//        - 슈퍼관리자: 승인 대기 목록 조회, 문서 확인, 승인/반려
//        - 승인 시 callback_numbers에 자동 INSERT (manage-callbacks.ts 재활용)
// ============================================================

import pool from '../config/database';

// ============================================================
//  타입 정의
// ============================================================

export interface ManagerDocInfo {
  originalName: string;
  storedName: string;
  filePath: string;
  fileSize: number;
  uploadedAt: string;
}

export interface SenderManager {
  id: string;
  company_id: string;
  manager_name: string;
  manager_phone: string;
  manager_email: string | null;
  authorization_doc: ManagerDocInfo | null;
  status: string; // pending | approved | rejected | inactive
  reviewed_by: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
  // JOIN 필드 (조회 시)
  company_name?: string;
  reviewed_by_name?: string;
}

export interface DocumentInfo {
  type: 'telecom_cert' | 'authorization' | 'consent_form' | 'employment_cert' | 'business_relation';
  originalName: string;
  storedName: string;
  filePath: string;
  fileSize: number;
  uploadedAt: string;
}

export interface SenderRegistration {
  id: string;
  company_id: string;
  requested_by: string;
  phone: string;
  label: string | null;
  store_code: string | null;
  store_name: string | null;
  number_type: 'company' | 'other'; // 회사명의 / 기타명의
  documents: DocumentInfo[];
  request_note: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  approved_callback_id: string | null;
  created_at: string;
  updated_at: string;
  // JOIN 필드 (조회 시)
  company_name?: string;
  requested_by_name?: string;
  reviewed_by_name?: string;
}

// ============================================================
//  발신번호 관리 담당자 (sender_managers)
// ============================================================

/** 담당자 목록 조회 (inactive 제외) */
export async function getManagers(companyId: string): Promise<SenderManager[]> {
  const result = await pool.query(
    `SELECT * FROM sender_managers WHERE company_id = $1 AND status != 'inactive' ORDER BY created_at DESC`,
    [companyId]
  );
  return result.rows;
}

/** 담당자 등록 (위임장 첨부 시 status='pending' → 슈퍼관리자 승인 필요) */
export async function createManager(
  companyId: string,
  data: { managerName: string; managerPhone: string; managerEmail?: string; authorizationDoc?: ManagerDocInfo }
): Promise<SenderManager> {
  const result = await pool.query(
    `INSERT INTO sender_managers (company_id, manager_name, manager_phone, manager_email, authorization_doc, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING *`,
    [
      companyId,
      data.managerName,
      data.managerPhone,
      data.managerEmail || null,
      data.authorizationDoc ? JSON.stringify(data.authorizationDoc) : null,
    ]
  );
  return result.rows[0];
}

/** 담당자 수정 */
export async function updateManager(
  managerId: string,
  companyId: string,
  data: { managerName?: string; managerPhone?: string; managerEmail?: string }
): Promise<SenderManager | null> {
  const result = await pool.query(
    `UPDATE sender_managers
     SET manager_name = COALESCE($1, manager_name),
         manager_phone = COALESCE($2, manager_phone),
         manager_email = COALESCE($3, manager_email),
         updated_at = now()
     WHERE id = $4 AND company_id = $5
     RETURNING *`,
    [data.managerName, data.managerPhone, data.managerEmail, managerId, companyId]
  );
  return result.rows[0] || null;
}

/** 담당자 삭제 (soft delete) */
export async function deleteManager(managerId: string, companyId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE sender_managers SET status = 'inactive', updated_at = now()
     WHERE id = $1 AND company_id = $2 AND status != 'inactive'`,
    [managerId, companyId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================
//  담당자 위임장 승인/반려 (슈퍼관리자)
// ============================================================

/** 담당자 승인 대기 목록 (슈퍼관리자용) */
export async function getPendingManagers(): Promise<SenderManager[]> {
  const result = await pool.query(
    `SELECT sm.*, c.company_name
     FROM sender_managers sm
     LEFT JOIN companies c ON sm.company_id = c.id
     WHERE sm.status = 'pending'
     ORDER BY sm.created_at ASC`
  );
  return result.rows;
}

/** 전체 담당자 목록 (슈퍼관리자용, 필터 가능) */
export async function getAllManagers(status?: string): Promise<SenderManager[]> {
  let sql = `
    SELECT sm.*, c.company_name,
           sa.name as reviewed_by_name
    FROM sender_managers sm
    LEFT JOIN companies c ON sm.company_id = c.id
    LEFT JOIN super_admins sa ON sm.reviewed_by = sa.id
    WHERE sm.status != 'inactive'
  `;
  const params: any[] = [];

  if (status) {
    sql += ' AND sm.status = $1';
    params.push(status);
  }

  sql += ' ORDER BY sm.created_at DESC';
  const result = await pool.query(sql, params);
  return result.rows;
}

/** 담당자 위임장 승인 */
export async function approveManager(
  managerId: string,
  reviewedBy: string
): Promise<SenderManager> {
  const result = await pool.query(
    `UPDATE sender_managers
     SET status = 'approved',
         reviewed_by = $1,
         reviewed_at = now(),
         updated_at = now()
     WHERE id = $2 AND status = 'pending'
     RETURNING *`,
    [reviewedBy, managerId]
  );
  if (result.rows.length === 0) {
    throw new Error('승인 대기 상태의 담당자를 찾을 수 없습니다.');
  }
  return result.rows[0];
}

/** 담당자 위임장 반려 */
export async function rejectManager(
  managerId: string,
  reviewedBy: string,
  rejectReason: string
): Promise<SenderManager> {
  const result = await pool.query(
    `UPDATE sender_managers
     SET status = 'rejected',
         reviewed_by = $1,
         reviewed_at = now(),
         reject_reason = $2,
         updated_at = now()
     WHERE id = $3 AND status = 'pending'
     RETURNING *`,
    [reviewedBy, rejectReason, managerId]
  );
  if (result.rows.length === 0) {
    throw new Error('승인 대기 상태의 담당자를 찾을 수 없습니다.');
  }
  return result.rows[0];
}

/** 담당자 승인 대기 건수 (배지용) */
export async function getPendingManagerCount(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM sender_managers WHERE status = 'pending'`
  );
  return parseInt(result.rows[0].cnt, 10);
}

/** 승인된 담당자가 있는지 확인 (발신번호 등록 전제조건) */
export async function hasApprovedManager(companyId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM sender_managers WHERE company_id = $1 AND status = 'approved' LIMIT 1`,
    [companyId]
  );
  return result.rows.length > 0;
}

// ============================================================
//  발신번호 등록 신청 (sender_registrations)
// ============================================================

/** 등록 신청 생성 */
export async function createRegistration(data: {
  companyId: string;
  requestedBy: string;
  phone: string;
  label?: string;
  storeCode?: string;
  storeName?: string;
  numberType?: 'company' | 'other';
  documents: DocumentInfo[];
  requestNote?: string;
}): Promise<SenderRegistration> {
  // 승인된 담당자 존재 여부 체크 (1차 위임장 승인 완료 필수)
  const approved = await hasApprovedManager(data.companyId);
  if (!approved) {
    throw new Error('먼저 담당자 등록 및 위임장 승인을 완료해주세요.');
  }

  // 중복 신청 체크: 같은 회사에서 같은 번호로 pending 상태인 건이 있으면 차단
  const dupCheck = await pool.query(
    `SELECT id FROM sender_registrations
     WHERE company_id = $1 AND phone = $2 AND status = 'pending'`,
    [data.companyId, data.phone]
  );
  if (dupCheck.rows.length > 0) {
    throw new Error('이미 동일 번호로 승인 대기 중인 신청이 있습니다.');
  }

  // 이미 등록된 번호인지 체크
  const existCheck = await pool.query(
    `SELECT id FROM callback_numbers WHERE company_id = $1 AND phone = $2`,
    [data.companyId, data.phone]
  );
  if (existCheck.rows.length > 0) {
    throw new Error('이미 등록된 발신번호입니다.');
  }

  const result = await pool.query(
    `INSERT INTO sender_registrations
       (company_id, requested_by, phone, label, store_code, store_name, number_type, documents, request_note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.companyId,
      data.requestedBy,
      data.phone,
      data.label || null,
      data.storeCode || null,
      data.storeName || null,
      data.numberType || 'company',
      JSON.stringify(data.documents),
      data.requestNote || null,
    ]
  );
  return result.rows[0];
}

/** 고객사의 신청 목록 조회 */
export async function getRegistrationsByCompany(
  companyId: string
): Promise<SenderRegistration[]> {
  const result = await pool.query(
    `SELECT sr.*, u.name as requested_by_name
     FROM sender_registrations sr
     LEFT JOIN users u ON sr.requested_by = u.id
     WHERE sr.company_id = $1
     ORDER BY sr.created_at DESC`,
    [companyId]
  );
  return result.rows;
}

/** 승인 대기 목록 조회 (슈퍼관리자용) */
export async function getPendingRegistrations(): Promise<SenderRegistration[]> {
  const result = await pool.query(
    `SELECT sr.*, c.company_name, u.name as requested_by_name
     FROM sender_registrations sr
     LEFT JOIN companies c ON sr.company_id = c.id
     LEFT JOIN users u ON sr.requested_by = u.id
     WHERE sr.status = 'pending'
     ORDER BY sr.created_at ASC`
  );
  return result.rows;
}

/** 전체 신청 목록 조회 (슈퍼관리자용, 필터 가능) */
export async function getAllRegistrations(
  status?: string
): Promise<SenderRegistration[]> {
  let sql = `
    SELECT sr.*, c.company_name, u.name as requested_by_name,
           sa.name as reviewed_by_name
    FROM sender_registrations sr
    LEFT JOIN companies c ON sr.company_id = c.id
    LEFT JOIN users u ON sr.requested_by = u.id
    LEFT JOIN super_admins sa ON sr.reviewed_by = sa.id
  `;
  const params: any[] = [];

  if (status) {
    sql += ' WHERE sr.status = $1';
    params.push(status);
  }

  sql += ' ORDER BY sr.created_at DESC';

  const result = await pool.query(sql, params);
  return result.rows;
}

/** 단건 조회 */
export async function getRegistrationById(
  registrationId: string
): Promise<SenderRegistration | null> {
  const result = await pool.query(
    `SELECT sr.*, c.company_name, u.name as requested_by_name,
            sa.name as reviewed_by_name
     FROM sender_registrations sr
     LEFT JOIN companies c ON sr.company_id = c.id
     LEFT JOIN users u ON sr.requested_by = u.id
     LEFT JOIN super_admins sa ON sr.reviewed_by = sa.id
     WHERE sr.id = $1`,
    [registrationId]
  );
  return result.rows[0] || null;
}

/** 승인 처리 — callback_numbers에 INSERT + 상태 변경 */
export async function approveRegistration(
  registrationId: string,
  reviewedBy: string
): Promise<{ registration: SenderRegistration; callbackNumber: any }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 신청 건 조회 (FOR UPDATE 잠금)
    const regResult = await client.query(
      `SELECT * FROM sender_registrations WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [registrationId]
    );
    if (regResult.rows.length === 0) {
      throw new Error('승인 대기 상태의 신청을 찾을 수 없습니다.');
    }
    const reg = regResult.rows[0] as SenderRegistration;

    // 2. 이미 등록된 번호인지 다시 확인 (동시성 방어)
    const existCheck = await client.query(
      `SELECT id FROM callback_numbers WHERE company_id = $1 AND phone = $2`,
      [reg.company_id, reg.phone]
    );
    if (existCheck.rows.length > 0) {
      throw new Error('이미 등록된 발신번호입니다. 신청을 반려 처리해주세요.');
    }

    // 3. callback_numbers에 INSERT (manage-callbacks.ts의 POST / 로직 재현)
    const cbResult = await client.query(
      `INSERT INTO callback_numbers (company_id, phone, label, is_default, store_code, store_name)
       VALUES ($1, $2, $3, false, $4, $5)
       RETURNING *`,
      [reg.company_id, reg.phone, reg.label, reg.store_code, reg.store_name]
    );
    const callbackNumber = cbResult.rows[0];

    // 4. 신청 상태 업데이트
    const updResult = await client.query(
      `UPDATE sender_registrations
       SET status = 'approved',
           reviewed_by = $1,
           reviewed_at = now(),
           approved_callback_id = $2,
           updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [reviewedBy, callbackNumber.id, registrationId]
    );

    await client.query('COMMIT');

    return {
      registration: updResult.rows[0],
      callbackNumber,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** 반려 처리 */
export async function rejectRegistration(
  registrationId: string,
  reviewedBy: string,
  rejectReason: string
): Promise<SenderRegistration> {
  const result = await pool.query(
    `UPDATE sender_registrations
     SET status = 'rejected',
         reviewed_by = $1,
         reviewed_at = now(),
         reject_reason = $2,
         updated_at = now()
     WHERE id = $3 AND status = 'pending'
     RETURNING *`,
    [reviewedBy, rejectReason, registrationId]
  );
  if (result.rows.length === 0) {
    throw new Error('승인 대기 상태의 신청을 찾을 수 없습니다.');
  }
  return result.rows[0];
}

/** 승인 대기 건수 조회 (슈퍼관리자 대시보드 배지용) — 담당자 + 발신번호 합산 */
export async function getPendingCount(): Promise<{ managers: number; registrations: number; total: number }> {
  const mgrResult = await pool.query(
    `SELECT COUNT(*) as cnt FROM sender_managers WHERE status = 'pending'`
  );
  const regResult = await pool.query(
    `SELECT COUNT(*) as cnt FROM sender_registrations WHERE status = 'pending'`
  );
  const managers = parseInt(mgrResult.rows[0].cnt, 10);
  const registrations = parseInt(regResult.rows[0].cnt, 10);
  return { managers, registrations, total: managers + registrations };
}
