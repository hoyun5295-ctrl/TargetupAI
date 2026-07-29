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
  /** 자동 일괄발급 대상에서 뺀다 — 우리 정산으로 발행할 수 없어 사람이 따로 처리하는 회사. */
  manualBilling: boolean;
}

/** 설정 행이 없으면 기본값(전체 발급 · 말일 · 자동 발급 대상) — 행 생성은 저장 시에만. */
export async function getCompanyBillingSettings(companyId: string, db: any = pool): Promise<CompanyBillingSettings> {
  const r = await db.query(
    `SELECT issue_scope, taxbill_day_policy, manual_billing FROM company_billing_settings WHERE company_id = $1::uuid`,
    [companyId],
  );
  if (r.rows.length === 0) return { issueScope: 'combined', taxbillDayPolicy: 'last_day', manualBilling: false };
  return {
    issueScope: r.rows[0].issue_scope as BillingIssueScope,
    taxbillDayPolicy: r.rows[0].taxbill_day_policy as TaxbillDayPolicy,
    manualBilling: r.rows[0].manual_billing === true,
  };
}

/**
 * ★ 2026-07-29 `manualBilling`은 **페이로드에 없으면 기존 값을 보존**한다(undefined = 미전송).
 *   담당자·사업자 6필드와 같은 함정이다 — UPSERT가 EXCLUDED로 통째 덮으므로, 이 키를 담지 않는 옛 번들이
 *   한 번 저장하면 "수동 정산 회사" 표시가 조용히 풀려 다음 일괄발급에 딸려 들어간다.
 */
export async function upsertCompanyBillingSettings(
  db: any,
  companyId: string,
  s: { issueScope: string; taxbillDayPolicy: string; manualBilling?: boolean; updatedBy?: string | null },
): Promise<void> {
  if (!ISSUE_SCOPES.includes(s.issueScope as BillingIssueScope)) {
    throw new Error(`발행 단위 값이 올바르지 않습니다: ${s.issueScope}`);
  }
  if (!DAY_POLICIES.includes(s.taxbillDayPolicy as TaxbillDayPolicy)) {
    throw new Error(`계산서 발급일자 정책 값이 올바르지 않습니다: ${s.taxbillDayPolicy}`);
  }
  const updatedBy = s.updatedBy && UUID_RE.test(s.updatedBy) ? s.updatedBy : null;
  const manualProvided = s.manualBilling !== undefined;
  await db.query(
    `INSERT INTO company_billing_settings (company_id, issue_scope, taxbill_day_policy, manual_billing, updated_by, updated_at)
     VALUES ($1::uuid, $2, $3, $5::boolean, $4::uuid, NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       issue_scope        = EXCLUDED.issue_scope,
       taxbill_day_policy = EXCLUDED.taxbill_day_policy,
       manual_billing     = CASE WHEN $6 THEN EXCLUDED.manual_billing ELSE company_billing_settings.manual_billing END,
       updated_by         = EXCLUDED.updated_by,
       updated_at         = NOW()`,
    [companyId, s.issueScope, s.taxbillDayPolicy, updatedBy, s.manualBilling === true, manualProvided],
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

/** 사업자등록번호 정규화 — 숫자 10자리만 통과시키고 `000-00-00000`으로 통일한다. */
export function normalizeBizNumber(raw: any): string | null {
  const s = trimOrNull(raw);
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  if (d.length !== 10) {
    throw new Error(`사업자등록번호는 숫자 10자리여야 합니다 (입력: ${s})`);
  }
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/**
 * 담당자·사업자 UPSERT. 회사 레벨(user_id NULL)과 계정 레벨을 partial unique 인덱스에 각각 맞춘다.
 * ⚠ 계정 레벨은 **그 회사 소속 계정인지** 호출부(라우트 트랜잭션)가 먼저 검증한다 — 여기서는 값만 쓴다.
 *
 * ★ 2026-07-28 사업자 6필드가 **페이로드에 아예 없으면 기존 값을 보존**한다.
 *   UPSERT가 EXCLUDED로 통째 덮기 때문에, 담당자만 담아 보내는 호출(배포 후 캐시된 옛 번들 등) 한 번에
 *   등록해둔 계산서 사업자가 조용히 NULL이 되던 구멍을 막는다.
 *   빈 문자열('')은 "지움"이라 그대로 NULL이 된다 — **미전송과 지움을 구분한다.**
 *   6필드는 한 사업자의 신원이라 개별이 아니라 묶음으로 판단한다(SoT §5-1 — 부분 병합 금지).
 */
export async function upsertBillingContact(
  db: any,
  companyId: string,
  input: BillingContactInput,
  updatedBy?: string | null,
): Promise<void> {
  const by = updatedBy && UUID_RE.test(updatedBy) ? updatedBy : null;
  const taxbillProvided = [
    input.taxbillBizNumber, input.taxbillCompanyName, input.taxbillCeoName,
    input.taxbillAddress, input.taxbillBizType, input.taxbillBizItem,
  ].some((v) => v !== undefined);
  const vals = [
    companyId,
    trimOrNull(input.contactName),
    trimOrNull(input.contactEmail),
    normalizeBizNumber(input.taxbillBizNumber),
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
         taxbill_biz_number   = CASE WHEN $12 THEN EXCLUDED.taxbill_biz_number   ELSE billing_contacts.taxbill_biz_number   END,
         taxbill_company_name = CASE WHEN $12 THEN EXCLUDED.taxbill_company_name ELSE billing_contacts.taxbill_company_name END,
         taxbill_ceo_name     = CASE WHEN $12 THEN EXCLUDED.taxbill_ceo_name     ELSE billing_contacts.taxbill_ceo_name     END,
         taxbill_address      = CASE WHEN $12 THEN EXCLUDED.taxbill_address      ELSE billing_contacts.taxbill_address      END,
         taxbill_biz_type     = CASE WHEN $12 THEN EXCLUDED.taxbill_biz_type     ELSE billing_contacts.taxbill_biz_type     END,
         taxbill_biz_item     = CASE WHEN $12 THEN EXCLUDED.taxbill_biz_item     ELSE billing_contacts.taxbill_biz_item     END,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [...vals, input.userId, taxbillProvided],
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
         taxbill_biz_number   = CASE WHEN $11 THEN EXCLUDED.taxbill_biz_number   ELSE billing_contacts.taxbill_biz_number   END,
         taxbill_company_name = CASE WHEN $11 THEN EXCLUDED.taxbill_company_name ELSE billing_contacts.taxbill_company_name END,
         taxbill_ceo_name     = CASE WHEN $11 THEN EXCLUDED.taxbill_ceo_name     ELSE billing_contacts.taxbill_ceo_name     END,
         taxbill_address      = CASE WHEN $11 THEN EXCLUDED.taxbill_address      ELSE billing_contacts.taxbill_address      END,
         taxbill_biz_type     = CASE WHEN $11 THEN EXCLUDED.taxbill_biz_type     ELSE billing_contacts.taxbill_biz_type     END,
         taxbill_biz_item     = CASE WHEN $11 THEN EXCLUDED.taxbill_biz_item     ELSE billing_contacts.taxbill_biz_item     END,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [...vals, taxbillProvided],
    );
  }
}

// ═══════════════════════════════════════════════════════════
// 공급받는자 사업자 (순수 — PDF·메일·계산서가 공유)
// ═══════════════════════════════════════════════════════════

/** 거래내역서·계산서의 공급받는자 6필드. 한 사업자의 신원이라 **항상 묶음으로** 다룬다. */
export interface TaxbillParty {
  companyName: string | null;
  bizNumber: string | null;
  ceoName: string | null;
  address: string | null;
  bizType: string | null;
  bizItem: string | null;
  /** 어디서 왔는지 — 화면·로그가 근거를 설명할 수 있어야 한다 */
  source: 'account' | 'company_contact' | 'companies';
}

const pick = (v: any): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * (순수) 공급받는자 사업자 = **계정 → 회사(billing_contacts) → companies** 3단.
 *
 * ★ 2026-07-29 PDF가 `companies`만 보고 있어서, 정산 탭에서 등록한 사업자가 인쇄물에 반영되지 않았다
 *   (Harold 실측 — 등록했는데 `대표: -`, `사업자번호: -`로 나감). 저장 화면만 먼저 나가고 읽는 쪽이 없었다.
 *
 * ⚠ **단계를 섞지 않는다.** 상호는 계정에서, 대표자는 회사에서 가져오면 국세청 신고물에
 *   실재하지 않는 사업자가 찍힌다. 판정 기준은 **사업자등록번호 하나**다 — 그 값이 있는 첫 단계를
 *   통째로 채택하고, 나머지 필드가 비어 있으면 비어 있는 채로 간다(빈 칸이 조합된 거짓보다 낫다).
 *   SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §5-1.
 */
export function pickTaxbillParty(row: any): TaxbillParty {
  const build = (
    source: TaxbillParty['source'],
    companyName: any, bizNumber: any, ceoName: any, address: any, bizType: any, bizItem: any,
  ): TaxbillParty => ({
    source,
    companyName: pick(companyName), bizNumber: pick(bizNumber), ceoName: pick(ceoName),
    address: pick(address), bizType: pick(bizType), bizItem: pick(bizItem),
  });

  if (pick(row?.acct_taxbill_biz_number)) {
    return build('account',
      row?.acct_taxbill_company_name, row?.acct_taxbill_biz_number, row?.acct_taxbill_ceo_name,
      row?.acct_taxbill_address, row?.acct_taxbill_biz_type, row?.acct_taxbill_biz_item);
  }
  if (pick(row?.co_taxbill_biz_number)) {
    return build('company_contact',
      row?.co_taxbill_company_name, row?.co_taxbill_biz_number, row?.co_taxbill_ceo_name,
      row?.co_taxbill_address, row?.co_taxbill_biz_type, row?.co_taxbill_biz_item);
  }
  // 기본정보 탭의 회사 사업자정보. 여기도 비면 인쇄물에 `-`가 찍힌다(그게 지금 화면이다).
  return build('companies',
    row?.company_name, row?.business_number, row?.ceo_name,
    row?.address, row?.business_type, row?.business_category);
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
 * (순수) 자동 발급 시각 = min(**발송일 기준** 3일 뒤 09:00 KST, 대상월 익월 10일 00:00 KST).
 *
 * ★ 2026-07-28 Harold 지시로 "발송 시각 +72시간"에서 **발송일로 잘라 세는 방식**으로 바꿨다.
 *   5일에 보냈으면 보낸 날을 1일로 쳐서 5·6·7일 사흘을 주고, **8일 아침 9시**에 자동 발급 대상이 된다.
 *   시각이 아니라 날짜로 자르니 밤 11시에 보낸 고객과 아침 9시에 보낸 고객이 같은 마감을 받는다.
 *   (KST 09:00 = 같은 날 UTC 00:00 — KST가 UTC+9이라 자정 계산이 그대로 09시가 된다)
 *
 * 세금계산서는 공급월 익월 10일까지 발급해야 하므로 그 기한을 넘지 않게 캡을 건다.
 * 캡에 걸리면 10일 자정(KST) 도래 즉시 자동 발급 대상이 된다 — 기한 안이다.
 */
export function computeTaxbillDueAt(sentAtMs: number, billingEnd: string): Date {
  // 발송 시각을 KST 달력 날짜로 읽는다(+9시간 후 UTC 필드를 보면 그것이 KST 날짜다).
  const kst = new Date(sentAtMs + 9 * 60 * 60 * 1000);
  const threeDays = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 3, 0, 0, 0);
  const y = Number(billingEnd.slice(0, 4));
  const m = Number(billingEnd.slice(5, 7)); // 1-based → Date.UTC의 0-based로 쓰면 그대로 "익월"
  const capUtcMs = Date.UTC(y, m, 10, 0, 0, 0) - 9 * 60 * 60 * 1000; // 익월 10일 00:00 KST
  return new Date(Math.min(threeDays, capUtcMs));
}
