/**
 * company-create.ts — 회사 생성 코어 CT (2026-07-20 Track C M2 부속)
 *
 * 기원: routes/companies.ts POST /(슈퍼관리자 회사 생성)의 INSERT + 부속 처리 2건을
 * 게이트웨이 bill 일괄 회사 생성(routes/gateway-templates.ts bulk-create-companies)과
 * 공유하기 위해 추출. 동작 불변 — INSERT 컬럼·순서·자동 생성값(api_key/secret·db_name)·
 * 부속 처리(ensureSystemSyncUser·customer_code_sequences) 전부 기존 경로 그대로.
 *
 * 에러는 raw 전파(23505 중복 등) — 사용자 응답 분기는 호출 라우트가 담당.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { ensureSystemSyncUser } from './system-sync-user';

export interface CreateCompanyParams {
  companyCode: string;
  companyName: string;
  businessNumber?: string | null;
  ceoName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  planId?: string | null;
  dataInputMethod?: string;
  usageType?: 'web' | 'agent' | 'both';
  createdBy?: string | null;
}

export async function createCompanyCore(p: CreateCompanyParams): Promise<any> {
  const apiKey = `tk_${crypto.randomBytes(24).toString('hex')}`;
  const apiSecret = crypto.randomBytes(32).toString('hex');
  const dbName = `targetup_${p.companyCode.toLowerCase()}`;

  const result = await query(
    `INSERT INTO companies (
      name, company_code, company_name, business_number, ceo_name,
      contact_name, contact_email, contact_phone, address,
      plan_id, data_input_method, api_key, api_secret, db_name,
      created_by, usage_type
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *`,
    [
      p.companyName, p.companyCode, p.companyName, p.businessNumber ?? null, p.ceoName ?? null,
      p.contactName ?? null, p.contactEmail ?? null, p.contactPhone ?? null, p.address ?? null,
      p.planId ?? null, p.dataInputMethod ?? 'file', apiKey, apiSecret, dbName,
      p.createdBy ?? null, p.usageType ?? 'web',
    ],
  );

  const newCompanyId = result.rows[0].id;

  // ===== SyncAgent v1.5.0: 시스템 가상 user + customer_code 시퀀스 자동 생성 =====
  // 설계서 §9-3 — 트리거 대신 애플리케이션 로직 선택(추천 B안). 실패는 생성 자체를 막지 않음(기존 동작 유지).
  try {
    await ensureSystemSyncUser(newCompanyId);
  } catch (sysErr) {
    console.error('[Company Create] 시스템 user 생성 실패:', sysErr);
  }
  try {
    await query(
      `INSERT INTO customer_code_sequences (company_id, last_number)
       VALUES ($1, 0)
       ON CONFLICT (company_id) DO NOTHING`,
      [newCompanyId],
    );
  } catch (seqErr) {
    console.error('[Company Create] customer_code_sequences 초기화 실패:', seqErr);
  }

  return result.rows[0];
}

/**
 * 회사 관리자(company_admin) 계정 생성 — manage-users.ts POST / INSERT 미러(에러 raw 전파).
 * must_change_password=true 고정 → 최초 로그인 시 비밀번호 변경 강제(auth.ts 기존 흐름).
 * 게이트웨이 bill 일괄 회사 생성(에이전트 전용 업체) 전용 부속.
 */
export async function createCompanyAdminUser(
  companyId: string,
  loginId: string,
  password: string,
  name: string,
): Promise<any> {
  const passwordHash = await bcrypt.hash(password, 10);
  const r = await query(
    `INSERT INTO users (company_id, login_id, password_hash, name, user_type, status, must_change_password)
     VALUES ($1, $2, $3, $4, 'company_admin', 'active', true)
     RETURNING id, login_id, name, user_type`,
    [companyId, loginId, passwordHash, name],
  );
  return r.rows[0];
}
