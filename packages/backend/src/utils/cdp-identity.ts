/**
 * ★ CT-20: 한줄로 CDP Identity Resolution 컨트롤타워 — D172 (2026-05-19)
 *
 * 🎯 목적
 *   자사몰 외부 회원 (external_id/email/phone) → 한줄로 customers.id 매핑 + upsert.
 *   - cdp_identity_links 테이블에 link 박음 (1:N — 한 customer가 여러 source/external_id 박힘 가능)
 *   - customers는 기존 UNIQUE (company_id, store_code, phone) 정합 활용
 *   - 신규 자사몰 회원 → customers row INSERT + cdp_identity_links INSERT
 *   - 기존 자사몰 회원 → cdp_identity_links UPDATE last_seen_at + customers row 변경 시 UPDATE
 *
 * 🔍 매칭 우선순위 (Identity Resolution 알고리즘)
 *   1. (company_id, source, external_id) 매칭 → 기존 link 그대로 활용
 *   2. (company_id, email) 매칭 → 기존 customer + 신규 link 박음
 *   3. (company_id, phone) 매칭 → 기존 customer + 신규 link 박음 (phone normalize 박힘)
 *   4. 모두 미매칭 → customers INSERT + link INSERT (신규 회원)
 *
 * ⛔ 영구 원칙 (Harold 명시)
 *   - 타겟 매칭 0건 시 자동완화 X (D171 memory/feedback_no_target_auto_relax.md)
 *   - 자사몰 데이터를 한줄로 customers로 박을 때 phone 정규화 필수 (D162 memory/project_d162_unsubscribe_dual_fix.md)
 *   - source/external_id 미박힘 시 link 박지 X (비회원 이벤트 별도 처리)
 */

import { query } from '../config/database';
import { normalizePhone } from './normalize';

// ═══════════════════════════════════════════════════════════
// 타입
// ═══════════════════════════════════════════════════════════

export interface IdentifyInput {
  source: string;              // 'cafe24' / 'shopify' / 'custom_sdk' / 'webhook' 등
  externalId: string;          // 자사몰 회원 ID
  email?: string;
  phone?: string;
  name?: string;
  // 표준 컬럼 (customers 직접 매핑)
  birthDate?: string;          // ISO date string
  gender?: 'M' | 'F' | string;
  grade?: string;
  address?: string;
  // 추가 필드 (custom_fields JSONB에 박음)
  customFields?: Record<string, any>;
}

export interface IdentifyResult {
  customerId: string;          // 한줄로 customers.id
  linkId: string;              // cdp_identity_links.id
  wasCreated: boolean;         // 신규 INSERT 여부
  wasMerged: boolean;          // 기존 customer에 link 추가 여부
}

// ═══════════════════════════════════════════════════════════
// 메인 — identify (upsert)
// ═══════════════════════════════════════════════════════════

/**
 * 자사몰 회원을 한줄로 customers에 매핑/upsert.
 * - 매칭 우선순위: source+external_id → email → phone → 신규 생성
 * - phone은 normalizePhone() 경유 (D162 영구 fix 정합)
 */
export async function identifyCustomer(
  companyId: string,
  input: IdentifyInput
): Promise<IdentifyResult> {
  if (!input.source || !input.externalId) {
    throw new Error('source와 externalId는 필수입니다.');
  }

  const normalizedPhone = input.phone ? normalizePhone(input.phone) : null;
  const email = input.email?.toLowerCase().trim() || null;

  // ★ 1단계: 기존 link 매칭 (source + external_id)
  const existingLink = await query(
    `SELECT id, customer_id FROM cdp_identity_links
     WHERE company_id = $1::uuid AND source = $2 AND external_id = $3
     LIMIT 1`,
    [companyId, input.source, input.externalId]
  );

  if (existingLink.rows.length > 0) {
    const linkRow = existingLink.rows[0];
    // 기존 link → last_seen 갱신 + customer 컬럼 변경 사항만 update
    if (linkRow.customer_id) {
      await syncCustomerFields(linkRow.customer_id, input, normalizedPhone, email);
    }
    await query(
      `UPDATE cdp_identity_links
       SET external_email = COALESCE($2, external_email),
           external_phone = COALESCE($3, external_phone),
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid`,
      [linkRow.id, email, normalizedPhone]
    );
    return {
      customerId: linkRow.customer_id,
      linkId: linkRow.id,
      wasCreated: false,
      wasMerged: false,
    };
  }

  // ★ 2단계: email 매칭 (회사 단위)
  let customerId: string | null = null;
  let wasMerged = false;

  if (email) {
    const byEmail = await query(
      `SELECT id FROM customers
       WHERE company_id = $1::uuid AND LOWER(email) = $2 AND is_active = true
       ORDER BY created_at ASC
       LIMIT 1`,
      [companyId, email]
    );
    if (byEmail.rows.length > 0) {
      customerId = byEmail.rows[0].id;
      wasMerged = true;
    }
  }

  // ★ 3단계: phone 매칭
  if (!customerId && normalizedPhone) {
    const byPhone = await query(
      `SELECT id FROM customers
       WHERE company_id = $1::uuid AND phone = $2 AND is_active = true
       ORDER BY created_at ASC
       LIMIT 1`,
      [companyId, normalizedPhone]
    );
    if (byPhone.rows.length > 0) {
      customerId = byPhone.rows[0].id;
      wasMerged = true;
    }
  }

  // ★ 4단계: 신규 customer INSERT
  let wasCreated = false;
  if (!customerId) {
    if (!normalizedPhone) {
      throw new Error('신규 회원 생성 시 phone은 필수입니다 (UNIQUE 제약 정합).');
    }
    const newCustomer = await query(
      `INSERT INTO customers (
        id, company_id, phone, name, email,
        gender, birth_date, grade, address,
        custom_fields, source, is_active, sms_opt_in,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2, $3, $4,
        $5, $6, $7, $8,
        $9::jsonb, $10, true, true,
        NOW(), NOW()
      )
      ON CONFLICT (company_id, COALESCE(store_code, '__NONE__'::varchar), phone)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, customers.name),
        email = COALESCE(EXCLUDED.email, customers.email),
        gender = COALESCE(EXCLUDED.gender, customers.gender),
        birth_date = COALESCE(EXCLUDED.birth_date, customers.birth_date),
        grade = COALESCE(EXCLUDED.grade, customers.grade),
        address = COALESCE(EXCLUDED.address, customers.address),
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS was_inserted`,
      [
        companyId,
        normalizedPhone,
        input.name || null,
        email,
        input.gender || null,
        input.birthDate || null,
        input.grade || null,
        input.address || null,
        JSON.stringify(input.customFields || {}),
        `cdp_${input.source}`,
      ]
    );
    customerId = newCustomer.rows[0].id;
    wasCreated = !!newCustomer.rows[0].was_inserted;
    if (!wasCreated) wasMerged = true;
  } else {
    // 매칭된 기존 customer에 필드 sync
    await syncCustomerFields(customerId, input, normalizedPhone, email);
  }

  // ★ link INSERT (모든 경로 공통)
  const linkInsert = await query(
    `INSERT INTO cdp_identity_links (
      id, company_id, customer_id, source, external_id,
      external_email, external_phone, last_seen_at,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4,
      $5, $6, NOW(),
      NOW(), NOW()
    )
    ON CONFLICT (company_id, source, external_id) DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      external_email = COALESCE(EXCLUDED.external_email, cdp_identity_links.external_email),
      external_phone = COALESCE(EXCLUDED.external_phone, cdp_identity_links.external_phone),
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING id`,
    [
      companyId,
      customerId,
      input.source,
      input.externalId,
      email,
      normalizedPhone,
    ]
  );

  return {
    customerId: customerId!,
    linkId: linkInsert.rows[0].id,
    wasCreated,
    wasMerged,
  };
}

// ═══════════════════════════════════════════════════════════
// 비회원 이벤트용 anonymous link (external_id만 박힘, customer_id NULL)
// ═══════════════════════════════════════════════════════════

/**
 * 비회원 자사몰 방문자 추적용 link. customer_id = NULL.
 * 추후 동일 external_id로 회원 가입 시 identifyCustomer가 link.customer_id 박음.
 */
export async function ensureAnonymousLink(
  companyId: string,
  source: string,
  externalId: string
): Promise<string> {
  if (!source || !externalId) {
    throw new Error('source와 externalId는 필수입니다.');
  }
  const result = await query(
    `INSERT INTO cdp_identity_links (
      id, company_id, customer_id, source, external_id,
      last_seen_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, NULL, $2, $3,
      NOW(), NOW(), NOW()
    )
    ON CONFLICT (company_id, source, external_id) DO UPDATE SET
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING id`,
    [companyId, source, externalId]
  );
  return result.rows[0].id;
}

// ═══════════════════════════════════════════════════════════
// 헬퍼 — customer 필드 sync (기존 customer에 자사몰 신규 정보 박음)
// ═══════════════════════════════════════════════════════════

async function syncCustomerFields(
  customerId: string,
  input: IdentifyInput,
  normalizedPhone: string | null,
  email: string | null
): Promise<void> {
  // 자사몰이 제공한 필드만 COALESCE 덮어쓰기 (NULL은 기존 값 유지)
  await query(
    `UPDATE customers SET
      name = COALESCE($2, name),
      email = COALESCE($3, email),
      gender = COALESCE($4, gender),
      birth_date = COALESCE($5, birth_date),
      grade = COALESCE($6, grade),
      address = COALESCE($7, address),
      custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $8::jsonb,
      updated_at = NOW()
    WHERE id = $1::uuid`,
    [
      customerId,
      input.name || null,
      email,
      input.gender || null,
      input.birthDate || null,
      input.grade || null,
      input.address || null,
      JSON.stringify(input.customFields || {}),
    ]
  );
  // phone 변경은 UNIQUE 제약 충돌 위험 — 호출부에서 별도 확인 필요. 여기서는 skip.
  void normalizedPhone;
}
