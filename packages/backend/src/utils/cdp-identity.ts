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
// ★ 2026-08-14: normalizeDate 추가 — 자사몰(카페24 등)이 준 생일 문자열이 정규화 없이 SQL 파라미터로
//   들어가 달력에 없는 값이면 PG가 행을 거절하던 자리(sync·upload와 동일 결함).
import { normalizePhone, normalizeDate } from './normalize';
// ★ D214+ (2026-05-24) Unified Customer Profile 정합 — link 변경 시 active_sources 재계산 fire-and-forget
import { recomputeProfile } from './unified-customer-profile';
// ★ 2026-06-25 (A1·A4) phone 자동 갱신 + identity 충돌 판정 순수 함수 + 검수 플래그 recorder
import { decidePhoneUpdate } from './cdp-phone-sync';
import { detectIdentityConflict } from './cdp-identity-conflict';
import { recordIdentityReview } from './cdp-identity-review';

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
  /**
   * 마케팅 수신동의 (2026-06-10 신설 — 정보통신망법 사전 동의)
   * - true/false 명시 전달 시 그 값을 반영
   * - undefined: 기존 고객은 현재 값 유지, 신규 생성은 false (동의 확인 전 발송 차단이 안전)
   */
  smsOptIn?: boolean;
}

/**
 * 자사몰이 보내는 다양한 동의 표기(boolean/'true'/'Y'/'1' 등)를 boolean | undefined로 정규화.
 * 미전달·해석 불가 = undefined (기존값 유지 / 신규는 false).
 */
export function parseConsentValue(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).trim().toLowerCase();
  if (['true', 'y', 'yes', '1', 'agree', 'agreed', 't'].includes(s)) return true;
  if (['false', 'n', 'no', '0', 'disagree', 'denied', 'f'].includes(s)) return false;
  return undefined;
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

  // 2026-06-10 정정: customer_id가 연결된 link만 조기 반환.
  // 이전에는 customer_id NULL인 link(이벤트가 identify보다 먼저 온 회원)도 여기서 끝나
  // customers 행이 영원히 안 만들어지는 결함이 있었다 → NULL이면 아래 매칭/생성으로 계속 진행.
  let healAnonymousLinkId: string | null = null;
  if (existingLink.rows.length > 0) {
    const linkRow = existingLink.rows[0];
    if (linkRow.customer_id) {
      // 기존 연결 완료 link → last_seen 갱신 + customer 컬럼 변경 사항만 update
      await syncCustomerFields(companyId, linkRow.customer_id, input, normalizedPhone, email);
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
    // customer_id NULL link = 식별 전 이벤트가 만든 link → 아래에서 customer 연결 후 과거 이벤트 소급
    healAnonymousLinkId = linkRow.id;
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
    // 2026-06-10 정정: sms_opt_in 무조건 true → 명시 동의값만 반영, 미전달 신규는 false.
    // (동의 없는 자사몰 회원이 광고 발송 대상이 되던 구조 차단 — 정보통신망법 사전 동의)
    const newCustomer = await query(
      `INSERT INTO customers (
        id, company_id, phone, name, email,
        gender, birth_date, grade, address,
        custom_fields, source, is_active, sms_opt_in,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2, $3, $4,
        $5, $6, $7, $8,
        $9::jsonb, $10, true, COALESCE($11::boolean, false),
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
        sms_opt_in = COALESCE($11::boolean, customers.sms_opt_in),
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS was_inserted`,
      [
        companyId,
        normalizedPhone,
        input.name || null,
        email,
        input.gender || null,
        normalizeDate(input.birthDate) || null,
        input.grade || null,
        input.address || null,
        JSON.stringify(input.customFields || {}),
        `cdp_${input.source}`,
        input.smsOptIn ?? null,
      ]
    );
    customerId = newCustomer.rows[0].id;
    wasCreated = !!newCustomer.rows[0].was_inserted;
    if (!wasCreated) wasMerged = true;
  } else {
    // 매칭된 기존 customer에 필드 sync
    await syncCustomerFields(companyId, customerId, input, normalizedPhone, email);
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

  // ★ 2026-06-10: 식별 전 이벤트가 만든 link였다면 그 link의 과거 이벤트에 customer_id 소급
  //   (healing 경로에서만 실행 — company_id 조건 동반으로 회사 인덱스 활용)
  if (healAnonymousLinkId && customerId) {
    try {
      // ★ 2026-08-02 §11-5(§9-N5) — created_at(도착 축)도 갱신. 여정 커서가 소급분을 잡게 한다
      //   (cdp-events ingest 소급과 같은 계약 — 익명이던 행은 커서가 소비한 적이 없어 중복 진입 0).
      const backfilled = await query(
        `UPDATE cdp_events SET customer_id = $3::uuid, created_at = NOW()
         WHERE company_id = $1::uuid AND identity_link_id = $2::uuid AND customer_id IS NULL
           AND received_at >= NOW() - INTERVAL '30 days'`,
        [companyId, healAnonymousLinkId, customerId]
      );
      if ((backfilled.rowCount || 0) > 0) {
        console.log(`[CDP Identity] 식별 전 이벤트 ${backfilled.rowCount}건 customer 소급 연결 (link=${healAnonymousLinkId})`);
      }
    } catch (err) {
      console.warn('[CDP Identity] 과거 이벤트 소급 연결 실패 (식별 자체는 완료):', err);
    }
  }

  // ★ D214+ (2026-05-24) unified profile 재계산 (fire-and-forget — active_sources / primary_source / preferred_channel)
  void recomputeProfile(companyId, customerId!).catch((err) => {
    console.warn('[CDP Identity] recomputeProfile 실패 (identifyCustomer 흐름 유지):', err);
  });

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

/** 같은 회사에서 normalizedPhone을 보유한 활성 고객 id 1건(없으면 null). A1/A4 phone 충돌 판정 공용. */
async function findPhoneHolderId(companyId: string, normalizedPhone: string | null): Promise<string | null> {
  if (!normalizedPhone) return null;
  const r = await query(
    `SELECT id FROM customers
     WHERE company_id = $1::uuid AND phone = $2 AND is_active = true
     ORDER BY created_at ASC LIMIT 1`,
    [companyId, normalizedPhone]
  );
  return r.rows.length > 0 ? r.rows[0].id : null;
}

async function syncCustomerFields(
  companyId: string,
  customerId: string,
  input: IdentifyInput,
  normalizedPhone: string | null,
  email: string | null
): Promise<void> {
  // 자사몰이 제공한 필드만 COALESCE 덮어쓰기 (NULL은 기존 값 유지)
  // sms_opt_in은 명시 전달된 경우에만 반영 (동의 부여/철회 모두 자사몰 값이 권위)
  await query(
    `UPDATE customers SET
      name = COALESCE($2, name),
      email = COALESCE($3, email),
      gender = COALESCE($4, gender),
      birth_date = COALESCE($5, birth_date),
      grade = COALESCE($6, grade),
      address = COALESCE($7, address),
      custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $8::jsonb,
      sms_opt_in = COALESCE($9::boolean, sms_opt_in),
      updated_at = NOW()
    WHERE id = $1::uuid`,
    [
      customerId,
      input.name || null,
      email,
      input.gender || null,
      normalizeDate(input.birthDate) || null,
      input.grade || null,
      input.address || null,
      JSON.stringify(input.customFields || {}),
      input.smsOptIn ?? null,
    ]
  );

  // ★ A1·A4 (2026-06-25): phone 자동 갱신 + 충돌(타 고객 점유 / email-phone 불일치) 검수 플래그.
  //   - 번호 변경 회원이 이전 번호로 남아 발송 실패하던 문제(A1) 해소: 점유자 없으면 자동 갱신.
  //   - 그 번호를 같은 회사 다른 활성 고객이 보유하면(A4 email매칭 ≠ phone보유자 포함) 자동변경 금지 + 플래그.
  if (normalizedPhone) {
    const cur = await query(`SELECT phone FROM customers WHERE id = $1::uuid`, [customerId]);
    const currentPhone: string | null = cur.rows[0]?.phone ?? null;
    if (normalizedPhone !== currentPhone) {
      const holderId = await findPhoneHolderId(companyId, normalizedPhone);
      const decision = decidePhoneUpdate({ currentPhone, incomingPhone: normalizedPhone, conflictHolderId: holderId, selfId: customerId });
      if (decision === 'update') {
        await query(`UPDATE customers SET phone = $2, updated_at = NOW() WHERE id = $1::uuid`, [customerId, normalizedPhone]);
      } else if (decision === 'skip_conflict') {
        const conflict = detectIdentityConflict({ chosenCustomerId: customerId, phoneHolderId: holderId });
        console.warn(`[CDP Identity] phone 충돌 — customer=${customerId} 점유자=${holderId} (자동변경 skip + 검수 플래그)`);
        await recordIdentityReview({
          companyId,
          customerId,
          kind: conflict.kind ?? 'phone_conflict',
          detail: { reason: 'phone_holder_conflict', incomingPhone: normalizedPhone, currentPhone, conflictHolderId: holderId, email },
        });
      }
    }
  }
}
