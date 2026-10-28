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

import { UserFacingError, CdpPhoneRequiredError } from './http-error';
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
// ★ 2026-09-18 자사몰 적재의 분류코드 기록 — 형제 적재 경로(upload·sync·단건)와 같은 줄을 CT 하나가 소유한다
import { linkCustomerStore } from './customer-store-link';
import {
  upsertStoreConsent, applyMissingConsentRule, consentClockSql, consentSourceAt, memberLinkExistsSql,
  isConsentClockMissing, warnConsentClockMissingOnce, type MemberIdFormat,
} from './mall-consent';

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
  /**
   * ★2026-10-02 「이 호출은 그 회원의 **회원 정보**이고, 그 동의 키로 읽었는데 값이 없다」 + 읽은 동의 키 이름 + 그 몰의 회원 연결 식별자 모양.
   * - 실렸을 때만 「회원 정보에 값이 없으면 동의」 규칙(CT mall-consent · 연동 행 meta.consent_missing_agree_key)이 그 몰 소속 행의 모름을 채운다.
   * - 생략 = 종전 그대로. ⛔ **주문에서 온 식별에는 싣지 않는다**(회원·비회원 모두) — 주문에는 동의 키가 실리지 않고
   *   비회원 주문도 전화번호로 회원 고객에 합쳐진다. `smsOptIn` 이 있으면 무시된다(명시 값이 진실).
   */
  profileConsentAbsent?: { consentKey: string; memberIdPrefix: string; memberIdRestPattern: string };
  /**
   * ★ 2026-10-27 자사몰 대비 K2-2 — smsOptIn 을 본 원천 시각(ISO). 웹훅 = 받은 시각 · 가져오기 = 읽은 시각 · 비우면 지금.
   * 동의 쓰기는 그 자원에서 본 것 중 가장 늦은 시각 이상일 때만(같은 시각이면 NO 만 · 소속 행 · 고객 행 같은 조각).
   */
  consentAt?: string;
  /**
   * ★ 1027 K2-1 — smsOptIn 이 **주문 본문**에서 왔다(회원 정보가 아님). 그 고객에게 그 몰의 회원 연결이 있으면 무시(회원 정보만 진실) ·
   * 고객 행은 만들 때와 NO 로 내릴 때만. syncOrder 만 싣는다(OrderInput.smsOptIn).
   */
  consentFromOrder?: boolean;
  /** ★ 1027 K2-1 · K2-3 — 그 몰의 회원 연결 식별자 모양(우커머스 = `{몰}:` + 숫자). 없으면 비회원 꼴(guest: · order:)이 아닌 연결을 회원으로 본다 */
  memberIdFormat?: MemberIdFormat;
  /**
   * 분류코드 (2026-09-18 · 설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-3)
   * - 이 회원이 들어온 몰의 분류코드. 주면 고객을 customer_stores 에 그 코드로 기록한다
   *   (사용자 범위 필터 utils/store-scope.ts 가 그 표를 거친다 = 상시 원칙 "사용자는 분류코드로 자기 것만").
   * - 생략 = 지금과 1바이트도 다르지 않다(단일몰·무분류 회사). ⛔ 요청 본문 값을 여기에 넣지 마라 —
   *   호출부가 연동 행(서버가 정한 값)에서 읽어 넘긴다.
   */
  storeCode?: string;
  /**
   * ★ 2026-10-28 자사몰 대비 K4 — 식별 신뢰 등급(I5). 'profile'(기본) = 몰 서버의 회원 정보 · 'order' = 주문의 주문자 정보.
   * order 는 고객 칸의 **빈 칸만** 채우고 전화번호를 바꾸지 않는다(주문자 칸이 회원 프로필을 덮지 않게 · M6) · 동의는 K2 그대로.
   * 브라우저는 이 함수를 부르지 않는다(연결만 · cdp-events.ts · R23).
   */
  tier?: 'profile' | 'order';
  /**
   * ★ 2026-10-28 Codex R1 #5 — 몰 서버가 비밀키로 보낸 호출(/identify · /order · /bulk-import)이다. 그 연결에 서버 확인 시각(server_verified_at)을 남긴다
   * → 브라우저 잇기(linkBrowserMember)가 출처 sdk 연결 중 이 표시가 있는 것만 근거로 쓴다(옛 브라우저 identify 가 만든 sdk 연결은 표시 없음 = 근거 아님).
   */
  serverVerified?: boolean;
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

/**
 * 동의 값이 **아예 없는가**(키 없음 · null · 빈 문자열). 해석하지 못한 글자(예: 알 수 없는 낱말)는 「없음」이 아니다 — 모름으로 둔다.
 * ★2026-10-02 「회원 정보에 동의 값이 없으면 동의」 규칙(CT mall-consent)이 「없음」과 「모르는 값」을 가르는 자리.
 */
export function isConsentAbsent(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  return typeof raw === 'string' && raw.trim() === '';
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

// 신규 고객 휴대폰 없음 = 그 건만 못 넣음(정의 = http-error.ts · ★1028 K11 적재 오류 판정 CT 가 이 모듈 없이 읽게 옮김 · 기존 import 는 여기서 그대로)
export { CdpPhoneRequiredError };

/**
 * 자사몰 회원을 한줄로 customers에 매핑/upsert.
 * - 매칭 우선순위: source+external_id → email → phone → 신규 생성
 * - phone은 normalizePhone() 경유 (D162 영구 fix 정합)
 */
export async function identifyCustomer(
  companyId: string,
  input: IdentifyInput
): Promise<IdentifyResult> {
  // ★ 1028 Codex R2 #2 · R3 #1 · R4 #1(같은 뿌리 세 번 → 구조로 닫음) · R5 #1 — 서버 확인 표시 = 이번 서버 호출이 그 연결을 처음 만들거나
  //   고객 없는 연결에 고객을 붙일 때만 · 표시는 연결과 **같은 문장**에서(식별 전에 「없으면 고객 없는 확인 연결 · 고객 없는 연결이면 표시」 · 뒤 식별이 그 연결에 고객을 붙임
  //   = 사이에서 끊겨도 다시 시도가 같은 연결을 이어 받는다). 있던 미확인 연결(고객 있음)은 승격하지 않는다: 휴대폰 · 이메일은 같은 서버 호출 길이 쓸 수 있는
  //   칸이라 근거로 쓰면 앞 호출이 쓴 값이 다음 호출의 근거가 되는 순환이 생긴다. 옛 브라우저 연결 정리 = 원장 C73-S8.
  if (input.serverVerified && input.source && input.externalId) await preMarkServerLink(companyId, input.source, input.externalId);
  return identifyCustomerRow(companyId, input);
}

let serverVerifiedColumnWarned = false;
/** 서버 호출의 연결 자리 — 없으면 고객 없는 확인 연결을 만들고 · 고객 없는 연결이면 표시 · 고객 있는 연결은 그대로(한 문장) · 칸이 없으면 = 원장 C73-DDL-4 전 · 경고 1회 · 지금 동작 */
async function preMarkServerLink(companyId: string, source: string, externalId: string): Promise<void> {
  try {
    await query(
      `INSERT INTO cdp_identity_links (id, company_id, customer_id, source, external_id, created_at, updated_at, server_verified_at)
       VALUES (gen_random_uuid(), $1::uuid, NULL, $2, $3, NOW(), NOW(), NOW())
       ON CONFLICT (company_id, source, external_id) DO UPDATE SET server_verified_at = NOW()
        WHERE cdp_identity_links.customer_id IS NULL AND cdp_identity_links.server_verified_at IS NULL`,
      [companyId, source, externalId],
    );
  } catch (err: any) {
    if (err?.code !== '42703') throw err;
    if (!serverVerifiedColumnWarned) { serverVerifiedColumnWarned = true; console.warn('[CDP Identity] cdp_identity_links.server_verified_at 칸 없음(DDL-4 전) — 서버 확인 표시를 건너뜁니다'); }
  }
}

async function identifyCustomerRow(
  companyId: string,
  input: IdentifyInput
): Promise<IdentifyResult> {
  if (!input.source || !input.externalId) {
    throw new UserFacingError(400, 'CDP_INPUT', 'source와 externalId는 필수입니다.');
  }

  const normalizedPhone = input.phone ? normalizePhone(input.phone) : null;
  const email = input.email?.toLowerCase().trim() || null;
  const consentAt = consentSourceAt(input.consentAt);   // ★ 1027 K2-2 — 동의 시계(없으면 지금 = 동기 호출의 받은 시각)

  // ★ 2026-09-22 몰별 수신동의(설계서 docs/2026-09-22-mall-consent-isolation-design.md §4-2 · H2):
  //   분류코드가 실린 호출(= 몰 단위 연동)의 수신동의는 **그 몰의 소속 행**이 진실이다(아래 recordStoreMembership).
  //   고객 1행의 sms_opt_in 은 **올리지 않는다** — 안 그러면 나중에 들어온 몰의 동의가 앞선 몰의 미동의를 덮는다(0922 실측 3,729명).
  //   ⛔ 단 **철회(false)는 고객 행에도 내린다**(Codex 0922 R1): 몰 동의 읽기(ENV)가 켜지기 전과 관리자·여정·자동발송은 아직 고객 행을 읽는다.
  //      철회를 버리면 거부한 사람에게 나간다. 내리는 방향은 "덜 보낸다"뿐이고, 몰 사용자 발송은 ENV ON 뒤 소속 행만 본다(H2).
  //   storeCode 가 없는 호출(기존 호출처 전부)은 rowInput === input 이라 1바이트도 다르지 않다.
  const baseRowInput: IdentifyInput = input.storeCode
    ? { ...input, smsOptIn: input.smsOptIn === false ? false : undefined }
    : input;
  // ★ 2026-10-27 자사몰 대비 K2-1 — 주문 본문의 동의는 그 고객에게 그 몰의 회원 연결이 없을 때만 · 고객 행은 만들 때와 NO 로 내릴 때만.
  //   (고객 확정 뒤 판정 — 기존 고객에게 YES 는 고객 행에 올리지 않는다 · 소속 행은 recordStoreMembership 이 같은 판정으로)
  const rowInputFor = async (existingCustomerId: string | null): Promise<IdentifyInput> => {
    if (!input.consentFromOrder || baseRowInput.smsOptIn === undefined || !existingCustomerId) return baseRowInput;
    if (baseRowInput.smsOptIn === true) return { ...baseRowInput, smsOptIn: undefined };
    return (await hasMallMemberLink(companyId, existingCustomerId, input)) ? { ...baseRowInput, smsOptIn: undefined } : baseRowInput;
  };

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
      await syncCustomerFields(companyId, linkRow.customer_id, await rowInputFor(linkRow.customer_id), normalizedPhone, email);
      await query(
        `UPDATE cdp_identity_links
         SET external_email = COALESCE($2, external_email),
             external_phone = COALESCE($3, external_phone),
             last_seen_at = NOW(),
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [linkRow.id, email, normalizedPhone]
      );
      // ★ 2026-09-18: 조기 반환 경로도 분류 기록을 지난다(빠뜨리면 이미 연결된 회원만 영영 분류 밖에 남는다)
      await recordStoreMembership(companyId, linkRow.customer_id, input);
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
      throw new CdpPhoneRequiredError();
    }
    // 2026-06-10 정정: sms_opt_in 무조건 true → 명시 동의값만 반영, 미전달 신규는 false.
    // (동의 없는 자사몰 회원이 광고 발송 대상이 되던 구조 차단 — 정보통신망법 사전 동의)
    // ★ 2026-10-27 자사몰 대비 K2-4 — 새 고객 = 시계 칸에 원천 시각 · 같은 번호 행과 부딪히면(비활성 행) 그 행 값은 시계 조각을 지난다.
    //   ON CONFLICT 갈래는 이미 있는 고객이라 주문 본문의 YES 는 올리지 않는다(만들 때와 NO 로 내릴 때만 · K2-1).
    const insertOptIn = baseRowInput.smsOptIn ?? null;
    const conflictOptIn = input.consentFromOrder && insertOptIn === true ? null : insertOptIn;
    const buildInsert = (clock: boolean): { sql: string; params: any[] } => {
      const params: any[] = [
        companyId, normalizedPhone, input.name || null, email, input.gender || null,
        normalizeDate(input.birthDate) || null, input.grade || null, input.address || null,
        JSON.stringify(input.customFields || {}), `cdp_${input.source}`, insertOptIn, conflictOptIn,
      ];
      let atRef = '';
      if (clock) { params.push(consentAt); atRef = `$${params.length}::timestamptz`; }
      const ok = consentOkSql(params, 'customers', '$12::boolean', atRef, input);
      const keep = (col: string): string => fieldWriteSql(input, `EXCLUDED.${col}`, `customers.${col}`);
      return {
        params,
        sql: `INSERT INTO customers (
        id, company_id, phone, name, email,
        gender, birth_date, grade, address,
        custom_fields, source, is_active, sms_opt_in,${clock ? ' consent_source_at,' : ''}
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2, $3, $4,
        $5, $6, $7, $8,
        $9::jsonb, $10, true, COALESCE($11::boolean, false),${clock ? ` CASE WHEN $11::boolean IS NOT NULL THEN ${atRef} END,` : ''}
        NOW(), NOW()
      )
      ON CONFLICT (company_id, phone)
      DO UPDATE SET
        name = ${keep('name')},
        email = ${keep('email')},
        gender = ${keep('gender')},
        birth_date = ${keep('birth_date')},
        grade = ${keep('grade')},
        address = ${keep('address')},
        sms_opt_in = CASE WHEN ${ok} THEN $12::boolean ELSE customers.sms_opt_in END,${clock ? `
        consent_source_at = CASE WHEN ${ok} THEN ${atRef} ELSE customers.consent_source_at END,` : ''}
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS was_inserted`,
      };
    };
    const newCustomer = await runConsentClocked('customers', buildInsert);
    customerId = newCustomer.rows[0].id;
    wasCreated = !!newCustomer.rows[0].was_inserted;
    if (!wasCreated) wasMerged = true;
  } else {
    // 매칭된 기존 customer에 필드 sync
    await syncCustomerFields(companyId, customerId, await rowInputFor(customerId), normalizedPhone, email);
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

  // ★ 2026-09-18: 고객이 확정된 뒤 분류 기록(신규 · email 매칭 · phone 매칭 공통). 두 몰의 회원 = 고객 1행 + 소속 2행.
  await recordStoreMembership(companyId, customerId!, input);

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

/**
 * ★ 2026-10-04 몰 회원 탈퇴 = 그 회원의 광고 수신 철회(고객 행 sms_opt_in = false · 싱크·자사몰 전수점검 I2 · 결정 ③).
 * 0922 몰 동의 설계와 같은 방향 — 철회는 고객 행에도 내린다(관리자·여정·자동발송이 고객 행을 읽는다).
 * ⛔ 영구 수신거부 표(unsubscribes)로 옮기지 않는다(D93 · unsubscribe-helper brandRefusalCopyCond 주석 — 몰 동의로 보내는 계정이
 *   다시 동의해도 풀리지 않게 된다). 연결된 고객이 없으면 0(모르는 회원을 만들지 않는다).
 */
export async function withdrawMemberConsent(
  companyId: string,
  source: string,
  externalId: string,
  /** ★ 2026-10-27 자사몰 대비 K2-2 · K5 — 탈퇴를 본 원천 시각(삭제 시각 · 모르면 받은 시각) */
  sourceAt: string,
  /** ★ 1028 K5 — 그 연동 행의 분류코드(있으면 그 몰 소속 행에 명시 NO · 출처 `{source}:deleted` · 고객 행은 건드리지 않는다) */
  storeCode?: string | null,
): Promise<number> {
  if (!source || !externalId) return 0;
  // 분류코드 몰 = 그 몰 소속 행이 동의의 진실(다른 매장 동의 · 고객 행 불변) · 연결 행은 지우지 않는다(다시 가입하면 같은 고객)
  if (typeof storeCode === 'string' && storeCode.trim()) {
    const linked = await query(
      `SELECT DISTINCT customer_id FROM cdp_identity_links
        WHERE company_id = $1::uuid AND source = $2 AND external_id = $3 AND customer_id IS NOT NULL`,
      [companyId, source, externalId],
    );
    let n = 0;
    for (const row of linked.rows) {
      if (await upsertStoreConsent(companyId, row.customer_id, storeCode, false, `${source}:deleted`, sourceAt)) n++;
    }
    return n;
  }
  const r = await runConsentClocked('customers', (clock) => {
    const params: any[] = [companyId, source, externalId];
    let clockSet = '';
    let clockWhere = '';
    if (clock) {
      params.push(consentSourceAt(sourceAt));
      clockSet = `, consent_source_at = $${params.length}::timestamptz`;
      clockWhere = `AND ${consentClockSql('consent_source_at', `$${params.length}::timestamptz`, 'false')}`;
    }
    // 시계 판 = 이미 NO 인 행도 시계는 앞으로(값이 같아도 시계 한 칸 · 늦게 온 옛 YES 가 탈퇴를 못 넘게) · 지금 동작 판 = 바뀌는 행만(옛 그대로)
    return {
      params,
      sql: `UPDATE customers SET sms_opt_in = false${clockSet}, updated_at = NOW()
      WHERE company_id = $1::uuid
        AND id IN (
          SELECT customer_id FROM cdp_identity_links
           WHERE company_id = $1::uuid AND source = $2 AND external_id = $3 AND customer_id IS NOT NULL
        )
        ${clock ? clockWhere : 'AND (sms_opt_in IS NULL OR sms_opt_in = true)'}`,
    };
  });
  return r.rowCount || 0;
}

/**
 * ★ 2026-10-28 자사몰 대비 K4 — 회원 토큰이 증명한 브라우저 회원을 고객에 **잇기만** 한다(고객 칸 쓰기 0 · I5 · M5).
 * 근거 = 같은 회원 번호의 서버 연결(source ≠ 'sdk' = 몰 서버가 보낸 회원 정보 · 주문)이 가리키는 고객 **하나**.
 * 서로 다른 고객 둘 이상 · 서버 연결 없음 = null(익명). 찾으면 브라우저 연결(source 'sdk')도 그 고객으로 맞춘다 —
 * 인앱 표시 · 구독 · 노출 기록이 그 연결을 읽는다(옛: 브라우저 identify 가 이 연결을 만들며 이름 · 이메일 · 전화를 덮었다).
 */
export async function linkBrowserMember(companyId: string, externalId: string): Promise<{ customerId: string; linkId: string } | null> {
  if (!externalId) return null;
  // 근거 = 서버 연결(몰 어댑터 출처 · 또는 sdk 출처 중 서버 비밀키 호출이 확인한 것 · Codex R1 #5) · 칸이 없으면(DDL-4 전) 몰 어댑터 출처만
  const sql = (verifiedSdk: boolean) =>
    `SELECT DISTINCT customer_id FROM cdp_identity_links
      WHERE company_id = $1::uuid AND external_id = $2 AND customer_id IS NOT NULL
        AND (source <> 'sdk'${verifiedSdk ? ' OR server_verified_at IS NOT NULL' : ''})
      ORDER BY customer_id
      LIMIT 2`;
  const r = await query(sql(true), [companyId, externalId]).catch((err: any) => {
    if (err?.code !== '42703') throw err;
    return query(sql(false), [companyId, externalId]);
  });
  if (r.rows.length !== 1) return null;
  const customerId: string = r.rows[0].customer_id;
  const link = await query(
    `INSERT INTO cdp_identity_links (id, company_id, customer_id, source, external_id, last_seen_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'sdk', $3, NOW(), NOW(), NOW())
     ON CONFLICT (company_id, source, external_id) DO UPDATE SET
       customer_id = EXCLUDED.customer_id, last_seen_at = NOW(), updated_at = NOW()
     RETURNING id`,
    [companyId, customerId, externalId]
  );
  return { customerId, linkId: link.rows[0].id };
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
    throw new UserFacingError(400, 'CDP_INPUT', 'source와 externalId는 필수입니다.');
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

/**
 * 분류코드가 오면 고객을 그 분류에 기록한다. 없으면 아무 일도 하지 않는다(쿼리 0).
 * ⛔ 실패는 식별을 막지 않는다 — 분류 기록 때문에 회원·주문 적재가 유실되면 안 된다(다음 이벤트에서 다시 기록된다).
 */
async function recordStoreMembership(
  companyId: string,
  customerId: string,
  /** 식별 입력 원본(동결 전) — 분류코드 · 그 몰이 준 수신동의(명시 값일 때만) · 출처 · 식별자 · 「회원 정보에 값 없음」 표시 */
  input: Pick<IdentifyInput, 'storeCode' | 'smsOptIn' | 'source' | 'externalId' | 'profileConsentAbsent' | 'consentAt' | 'consentFromOrder' | 'memberIdFormat'>,
): Promise<void> {
  const { storeCode, smsOptIn, source } = input;
  if (!storeCode) return;
  try {
    await linkCustomerStore(companyId, customerId, storeCode);
  } catch (err: any) {
    console.warn('[CDP Identity] 분류 기록 실패 (식별 자체는 완료):', err?.message || err);
  }
  // ★ 2026-09-22: 몰 동의는 소속 행이 단독으로 갖는다(CT mall-consent · 다른 몰의 행에는 닿지 않는다).
  //   ★ 2026-10-02: 위 분류 기록이 실패했어도 명시 값은 CT 가 행을 만들어 남긴다(거부가 조용히 빠지지 않게).
  // ⛔ 이 쓰기의 실패는 삼키지 않는다(Codex 0922 R1) — 철회(false)가 조용히 사라지면 그 몰에서 거부한 사람에게 계속 나간다.
  //    던지면 웹훅은 재처리 경로로, 가져오기는 그 건만 failed 로 남는다. 컬럼 미존재(42703)는 CT 가 안에서 처리한다.
  if (smsOptIn !== undefined) {
    // ★ 2026-10-27 자사몰 대비 K2-1 — 주문 본문의 동의 = 그 몰의 회원 연결이 없는 고객에게만(회원은 회원 정보가 진실)
    if (input.consentFromOrder) {
      if (await hasMallMemberLink(companyId, customerId, input)) return;
      await upsertStoreConsent(companyId, customerId, storeCode, smsOptIn, source || 'unknown', consentSourceAt(input.consentAt));
      return;
    }
    // ★ 1027 K2-3 — 회원 정보의 동의 = 그 고객에게 그 몰의 다른 회원 연결이 있으면 YES 거절(가족 번호 · NO 만 받음)
    await upsertStoreConsent(companyId, customerId, storeCode, smsOptIn, source || 'unknown', consentSourceAt(input.consentAt),
      { source: source || 'unknown', externalId: input.externalId, format: input.memberIdFormat ?? null });
    return;
  }
  // ★ 2026-10-02 「회원 정보에 동의 값이 없으면 동의」 규칙(CT mall-consent · 연동 행 meta.consent_missing_agree_key).
  //   회원 정보에서 값이 없음을 확인한 호출만 넘긴다. 켜진 몰·키인가 · 모름인가 · 다른 회원 연결이 없는가는 전부 CT 의 SQL 한 문장이 본다.
  //   실패는 삼킨다 — 못 채우면 모름으로 남아 발송에서 빠질 뿐이다(덜 보내는 방향 · 다음 회원 정보 수신에서 다시 채운다).
  //   철회 쓰기(위)와 달리 던져서 재처리시킬 이유가 없고, 던지면 회원 적재가 이 규칙 때문에 멈춘다.
  const absent = input.profileConsentAbsent;
  if (!absent) return;
  try {
    await applyMissingConsentRule(companyId, customerId, storeCode, {
      source: source || 'unknown',
      externalId: input.externalId,
      consentKey: absent.consentKey,
      memberIdPrefix: absent.memberIdPrefix,
      memberIdRestPattern: absent.memberIdRestPattern,
    }, consentSourceAt(input.consentAt));
  } catch (err: any) {
    console.warn('[CDP Identity] 회원 정보 동의 값 없음 규칙 적용 실패 (식별 자체는 완료 · 모름으로 남는다):', err?.message || err);
  }
}

/**
 * ★ 2026-10-27 자사몰 대비 K2-4 — 고객 행 동의를 써도 되는가(SQL 조각): 값이 실렸고 · 시계 조각(atRef 가 있을 때) · YES 면 그 몰의 다른 회원 연결 없음(가족 번호).
 *   주문 본문의 동의(consentFromOrder)는 가족 번호 대상이 아니다(회원 연결이 있으면 호출 전에 이미 빠진다).
 */
function consentOkSql(params: any[], table: string, optInRef: string, atRef: string, input: IdentifyInput, companyRef = '$1::uuid', customerRef = `${table}.id`): string {
  const clock = atRef ? ` AND ${consentClockSql(`${table}.consent_source_at`, atRef, optInRef)}` : '';
  const family = !input.consentFromOrder && input.source && input.externalId
    ? ` AND (${optInRef} = false OR NOT ${memberLinkExistsSql(params, { companyRef, customerRef, source: input.source, excludeExternalId: input.externalId, format: input.memberIdFormat ?? null })})`
    : '';
  return `(${optInRef} IS NOT NULL${clock}${family})`;
}

/** 시계 칸이 있으면 시계 판, 없으면(DDL-3 전 · 42703) 지금 동작 판으로 한 번 더(경고 1회) */
async function runConsentClocked(table: string, build: (clock: boolean) => { sql: string; params: any[] }): Promise<any> {
  try {
    const q = build(true);
    return await query(q.sql, q.params);
  } catch (err: any) {
    if (!isConsentClockMissing(err)) throw err;
    warnConsentClockMissingOnce(table);
    const q = build(false);
    return await query(q.sql, q.params);
  }
}

/** 그 고객에게 그 몰의 회원 연결이 있는가(주문 본문 동의 판정 · K2-1) */
async function hasMallMemberLink(companyId: string, customerId: string, input: Pick<IdentifyInput, 'source' | 'memberIdFormat'>): Promise<boolean> {
  const params: any[] = [companyId, customerId];
  const r = await query(`SELECT ${memberLinkExistsSql(params, { companyRef: '$1::uuid', customerRef: '$2::uuid', source: input.source, format: input.memberIdFormat ?? null })} AS has`, params);
  return r.rows[0]?.has === true;
}

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

/**
 * 고객 칸 하나를 쓰는 SQL 조각(K4 · I5) — profile = 들어온 값이 있으면 덮음 · order = 그 칸이 비었을 때만 채움.
 * 새 행 INSERT · 같은 번호 충돌 갱신 · 기존 고객 갱신 세 자리가 같은 조각을 쓴다(R1).
 */
function fieldWriteSql(input: IdentifyInput, incoming: string, existing: string): string {
  return input.tier === 'order' ? `COALESCE(${existing}, ${incoming})` : `COALESCE(${incoming}, ${existing})`;
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
  // ★ 2026-10-27 자사몰 대비 K2-4 — 동의 칸은 시계 조각 · 가족 번호를 지난다(소속 행과 같은 조각 · 다른 칸은 그대로)
  await runConsentClocked('customers', (clock) => {
    const params: any[] = [
      customerId,
      input.name || null,
      email,
      input.gender || null,
      normalizeDate(input.birthDate) || null,
      input.grade || null,
      input.address || null,
      JSON.stringify(input.customFields || {}),
      input.smsOptIn ?? null,
      companyId,
    ];
    let atRef = '';
    if (clock) { params.push(consentSourceAt(input.consentAt)); atRef = `$${params.length}::timestamptz`; }
    const ok = consentOkSql(params, 'customers', '$9::boolean', atRef, input, '$10::uuid', '$1::uuid');
    return {
      params,
      sql: `UPDATE customers SET
      name = ${fieldWriteSql(input, '$2', 'name')},
      email = ${fieldWriteSql(input, '$3', 'email')},
      gender = ${fieldWriteSql(input, '$4', 'gender')},
      birth_date = ${fieldWriteSql(input, '$5', 'birth_date')},
      grade = ${fieldWriteSql(input, '$6', 'grade')},
      address = ${fieldWriteSql(input, '$7', 'address')},
      custom_fields = ${input.tier === 'order' ? `$8::jsonb || COALESCE(custom_fields, '{}'::jsonb)` : `COALESCE(custom_fields, '{}'::jsonb) || $8::jsonb`},
      sms_opt_in = CASE WHEN ${ok} THEN $9::boolean ELSE sms_opt_in END,${clock ? `
      consent_source_at = CASE WHEN ${ok} THEN ${atRef} ELSE consent_source_at END,` : ''}
      updated_at = NOW()
    WHERE id = $1::uuid AND company_id = $10::uuid`,
    };
  });

  // ★ A1·A4 (2026-06-25): phone 자동 갱신 + 충돌(타 고객 점유 / email-phone 불일치) 검수 플래그.
  //   - 번호 변경 회원이 이전 번호로 남아 발송 실패하던 문제(A1) 해소: 점유자 없으면 자동 갱신.
  //   - 그 번호를 같은 회사 다른 활성 고객이 보유하면(A4 email매칭 ≠ phone보유자 포함) 자동변경 금지 + 플래그.
  //   ★ 1028 K4 — 주문자 정보(tier order)는 전화번호를 바꾸지 않는다(주문자 칸 = 받는 사람 · 선물 주문이 회원 번호를 덮던 M6).
  if (normalizedPhone && input.tier !== 'order') {
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
