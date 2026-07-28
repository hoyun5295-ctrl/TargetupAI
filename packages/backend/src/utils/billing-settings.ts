/**
 * ★ CT: 정산 설정·정산 담당자·계산서 날짜 산식 (2026-07-28)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §1-1·§1-2·§5.
 * 소비처: 고객사 상세 "정산" 탭(저장·조회) · 거래내역서 일괄발급(좌우 기본값·수신자 해석) ·
 *         발송 메일(수신자) · 세금계산서 워커(작성일자·자동발급 기한).
 *
 * 원칙:
 *  - 실행자(updated_by)는 id만 기록하고 users FK를 걸지 않는다(슈퍼관리자는 super_admins 소속 — 23503 사고).
 *  - 날짜 산식은 **순수 함수**다. Date 문자열 연산으로 TZ 개입을 차단한다(toISOString 하루 밀림 계열 방지).
 */

import pool from '../config/database';

export type BillingIssueScope = 'combined' | 'by_user';
export type TaxbillDayPolicy = 'last_day' | 'first_day' | 'manual';

const ISSUE_SCOPES: BillingIssueScope[] = ['combined', 'by_user'];
const DAY_POLICIES: TaxbillDayPolicy[] = ['last_day', 'first_day', 'manual'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CompanyBillingSettings {
  issueScope: BillingIssueScope;
  taxbillDayPolicy: TaxbillDayPolicy;
}

/** 설정 행이 없으면 기본값(전체 발급 · 말일) — 행 생성은 저장 시에만. */
export async function getCompanyBillingSettings(companyId: string, db: any = pool): Promise<CompanyBillingSettings> {
  const r = await db.query(
    `SELECT issue_scope, taxbill_day_policy FROM company_billing_settings WHERE company_id = $1::uuid`,
    [companyId],
  );
  if (r.rows.length === 0) return { issueScope: 'combined', taxbillDayPolicy: 'last_day' };
  return {
    issueScope: r.rows[0].issue_scope as BillingIssueScope,
    taxbillDayPolicy: r.rows[0].taxbill_day_policy as TaxbillDayPolicy,
  };
}

export async function upsertCompanyBillingSettings(
  db: any,
  companyId: string,
  s: { issueScope: string; taxbillDayPolicy: string; updatedBy?: string | null },
): Promise<void> {
  if (!ISSUE_SCOPES.includes(s.issueScope as BillingIssueScope)) {
    throw new Error(`발행 단위 값이 올바르지 않습니다: ${s.issueScope}`);
  }
  if (!DAY_POLICIES.includes(s.taxbillDayPolicy as TaxbillDayPolicy)) {
    throw new Error(`계산서 발급일자 정책 값이 올바르지 않습니다: ${s.taxbillDayPolicy}`);
  }
  const updatedBy = s.updatedBy && UUID_RE.test(s.updatedBy) ? s.updatedBy : null;
  await db.query(
    `INSERT INTO company_billing_settings (company_id, issue_scope, taxbill_day_policy, updated_by, updated_at)
     VALUES ($1::uuid, $2, $3, $4::uuid, NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       issue_scope        = EXCLUDED.issue_scope,
       taxbill_day_policy = EXCLUDED.taxbill_day_policy,
       updated_by         = EXCLUDED.updated_by,
       updated_at         = NOW()`,
    [companyId, s.issueScope, s.taxbillDayPolicy, updatedBy],
  );
}

export interface BillingContactRow {
  id: string;
  user_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  taxbill_biz_number: string | null;
  taxbill_company_name: string | null;
  taxbill_ceo_name: string | null;
  taxbill_address: string | null;
  taxbill_biz_type: string | null;
  taxbill_biz_item: string | null;
}

export async function listBillingContacts(companyId: string, db: any = pool): Promise<BillingContactRow[]> {
  const r = await db.query(
    `SELECT id, user_id, contact_name, contact_email,
            taxbill_biz_number, taxbill_company_name, taxbill_ceo_name,
            taxbill_address, taxbill_biz_type, taxbill_biz_item
       FROM billing_contacts WHERE company_id = $1::uuid
      ORDER BY (user_id IS NOT NULL), created_at`,
    [companyId],
  );
  return r.rows as BillingContactRow[];
}

export interface BillingContactInput {
  userId: string | null; // null = 회사 레벨
  contactName?: string | null;
  contactEmail?: string | null;
  taxbillBizNumber?: string | null;
  taxbillCompanyName?: string | null;
  taxbillCeoName?: string | null;
  taxbillAddress?: string | null;
  taxbillBizType?: string | null;
  taxbillBizItem?: string | null;
}

const trimOrNull = (v: any): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * 담당자·사업자 UPSERT. 회사 레벨(user_id NULL)과 계정 레벨을 partial unique 인덱스에 각각 맞춘다.
 * ⚠ 계정 레벨은 **그 회사 소속 계정인지** 호출부(라우트 트랜잭션)가 먼저 검증한다 — 여기서는 값만 쓴다.
 */
export async function upsertBillingContact(
  db: any,
  companyId: string,
  input: BillingContactInput,
  updatedBy?: string | null,
): Promise<void> {
  const by = updatedBy && UUID_RE.test(updatedBy) ? updatedBy : null;
  const vals = [
    companyId,
    trimOrNull(input.contactName),
    trimOrNull(input.contactEmail),
    trimOrNull(input.taxbillBizNumber),
    trimOrNull(input.taxbillCompanyName),
    trimOrNull(input.taxbillCeoName),
    trimOrNull(input.taxbillAddress),
    trimOrNull(input.taxbillBizType),
    trimOrNull(input.taxbillBizItem),
    by,
  ];
  if (input.userId) {
    await db.query(
      `INSERT INTO billing_contacts (
         company_id, user_id, contact_name, contact_email,
         taxbill_biz_number, taxbill_company_name, taxbill_ceo_name,
         taxbill_address, taxbill_biz_type, taxbill_biz_item, updated_by
       ) VALUES ($1::uuid, $11::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)
       ON CONFLICT (company_id, user_id) WHERE user_id IS NOT NULL DO UPDATE SET
         contact_name = EXCLUDED.contact_name,
         contact_email = EXCLUDED.contact_email,
         taxbill_biz_number = EXCLUDED.taxbill_biz_number,
         taxbill_company_name = EXCLUDED.taxbill_company_name,
         taxbill_ceo_name = EXCLUDED.taxbill_ceo_name,
         taxbill_address = EXCLUDED.taxbill_address,
         taxbill_biz_type = EXCLUDED.taxbill_biz_type,
         taxbill_biz_item = EXCLUDED.taxbill_biz_item,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [...vals, input.userId],
    );
  } else {
    await db.query(
      `INSERT INTO billing_contacts (
         company_id, user_id, contact_name, contact_email,
         taxbill_biz_number, taxbill_company_name, taxbill_ceo_name,
         taxbill_address, taxbill_biz_type, taxbill_biz_item, updated_by
       ) VALUES ($1::uuid, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)
       ON CONFLICT (company_id) WHERE user_id IS NULL DO UPDATE SET
         contact_name = EXCLUDED.contact_name,
         contact_email = EXCLUDED.contact_email,
         taxbill_biz_number = EXCLUDED.taxbill_biz_number,
         taxbill_company_name = EXCLUDED.taxbill_company_name,
         taxbill_ceo_name = EXCLUDED.taxbill_ceo_name,
         taxbill_address = EXCLUDED.taxbill_address,
         taxbill_biz_type = EXCLUDED.taxbill_biz_type,
         taxbill_biz_item = EXCLUDED.taxbill_biz_item,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      vals,
    );
  }
}

// ═══════════════════════════════════════════════════════════
// 계산서 날짜 산식 (순수 — 워커·발송·화면이 공유)
// ═══════════════════════════════════════════════════════════

/**
 * (순수) 작성일자. `billing_end`(YYYY-MM-DD)의 달을 대상월로 본다.
 *  - last_day  → 대상월 말일 (7월분=07-31, 30일 달이면 30일, 2월이면 28/29일)
 *  - first_day → 익월 1일 (7월분=08-01, 12월분=익년 01-01)
 *  - manual    → null (직접선택 — 사람이 지정할 때까지 없음)
 * 문자열 연산만 쓴다 — Date의 로컬 TZ 보정이 끼면 하루가 밀린다(0726 toISOString 계열).
 */
export function computeTaxbillIssueDate(policy: TaxbillDayPolicy, billingEnd: string): string | null {
  if (policy === 'manual') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(billingEnd || ''))) {
    throw new Error(`기간 종료일 형식이 올바르지 않습니다: ${billingEnd}`);
  }
  const y = Number(billingEnd.slice(0, 4));
  const m = Number(billingEnd.slice(5, 7)); // 1-based
  if (policy === 'last_day') {
    // Date.UTC(y, m, 0) = 그 달 말일 (m은 1-based라 그대로 "다음 달 0일")
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  }
  // first_day — 익월 1일 (12월이면 익년 1월)
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/**
 * (순수) 자동 발급 시각 = min(발송 +3일, 대상월 익월 10일 00:00 KST).
 * 세금계산서는 공급월 익월 10일까지 발급해야 하므로, 3일 대기가 그 기한을 넘지 않게 캡을 건다.
 * 캡에 걸리면 10일 자정(KST) 도래 즉시 자동 발급 대상이 된다 — 기한 안이다.
 */
export function computeTaxbillDueAt(sentAtMs: number, billingEnd: string): Date {
  const threeDays = sentAtMs + 3 * 24 * 60 * 60 * 1000;
  const y = Number(billingEnd.slice(0, 4));
  const m = Number(billingEnd.slice(5, 7)); // 1-based → Date.UTC의 0-based로 쓰면 그대로 "익월"
  const capUtcMs = Date.UTC(y, m, 10, 0, 0, 0) - 9 * 60 * 60 * 1000; // 익월 10일 00:00 KST
  return new Date(Math.min(threeDays, capUtcMs));
}
