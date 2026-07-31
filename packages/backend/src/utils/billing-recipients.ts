/**
 * ★ CT: 정산 메일 수신자 (2026-07-31 신설)
 *
 * SoT = status/SCHEMA.md `billing_recipients` 절.
 * 소비처: 일괄발급 컨펌 메일(invoice-confirm) · 일괄발급 목록 "메일 없음" 뱃지(billing-bulk) ·
 *         개별 정산서 메일 / 거래내역서 메일(routes/billing) · 세금계산서 공급받는자 담당자(taxbill-popbill).
 *
 * ★ 왜 테이블을 새로 팠는가 — 수신자 원장이 **셋으로 갈려 있었다.**
 *   일괄발급 컨펌·뱃지·계산서는 `billing_contacts.contact_email`을, 개별 정산서·거래내역서 메일은
 *   `companies.contact_email`을 봤다. 같은 담당자인데 경로마다 다른 주소로 나갈 수 있었고,
 *   실측하니 `billing_contacts`에 메일이 든 행은 **1개뿐**인데 `companies` 쪽은 100사였다
 *   (= 그대로 일괄발급을 돌렸으면 100사 중 99사가 "이메일 미등록"으로 조용히 스킵됐다).
 *   여기에 "유형별 수신자"와 "복수 수신자"를 얹으면 갈래가 넷이 된다. 그래서 원장을 하나로 모았다.
 *
 * 원칙:
 *  - **폴백을 두지 않는다.** 이관은 DDL과 같은 트랜잭션에서 끝냈다(0731). 폴백을 남기면 원장이 다시 셋이 된다.
 *  - `companies.contact_email`은 정산 축에서 분리 — 가입·일일 인사이트가 쓰는 회사 대표 연락처로 남는다.
 *  - 수신자 0명은 **정상 경로**다. 그 장만 발송에서 빠지고 화면에 "메일 없음"으로 뜬다(현행 동작 유지).
 *  - 실행자(created_by)는 id만 기록하고 users FK를 걸지 않는다(슈퍼관리자 23503 원칙).
 */

import pool from '../config/database';

/** 거래내역서(컨펌 대상) / 세금계산서. `both`는 두지 않는다 — 둘 다면 행 2개. */
export type BillingDocType = 'statement' | 'taxbill';

export const BILLING_DOC_TYPES: BillingDocType[] = ['statement', 'taxbill'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BillingRecipientRow {
  id: string;
  user_id: string | null;
  doc_type: BillingDocType;
  email: string;
  name: string | null;
  is_primary: boolean;
  is_active: boolean;
}

/**
 * 한 장(scope)의 실제 수신자.
 * `primary` = 거래내역서면 **추적행(토큰)이 달리는 1명**, 세금계산서면 **팝빌 발행(invoiceeEmail1)에 넘길 1명**.
 * `cc` = 거래내역서면 같은 메일을 사본으로 받는 나머지, 세금계산서면 **발행 확정 직후 팝빌 sendEmail 재전송**으로
 *        같은 계산서 메일을 받는 나머지(★2026-07-31(2) 개방 — taxbill-popbill selectTaxbillResendTargets).
 *
 * ⚠ **참조도 그 메일의 컨펌 링크로 컨펌·이의를 남길 수 있다**(본문이 같으므로). 권한을 나누지 않은 것은
 *   의도다 — 컨펌은 그 회사의 의사표시이고 참조도 같은 회사 담당자다. 대표에게만 링크를 보내려면
 *   수신자별로 본문을 나눠야 하고, 그러면 "메일 1통 = 추적행 1개" 구조가 깨진다.
 *   대신 **상태는 갈라지지 않는다** — 추적행이 장당 하나뿐이라 누가 누르든 한 곳에만 기록된다.
 */
export interface ResolvedRecipients {
  primary: { email: string; name: string | null } | null;
  cc: string[];
}

export function isBillingDocType(v: any): v is BillingDocType {
  return v === 'statement' || v === 'taxbill';
}

/**
 * (순수) **부분 거부를 성공으로 세지 않기 위한 판정.**
 *
 * nodemailer는 수신자 일부만 거부되면 reject 하지 않고 `rejected` 배열을 담아 성공 반환한다.
 * 참조(cc)를 붙인 뒤로는 "받아야 할 사람은 거부·참조만 수락"이 가능해졌는데, 그대로 두면
 * 발송 이력과 3일 자동발급 타이머만 확정되고 정작 고객은 문서를 못 받는다.
 *
 * ★ 2026-07-31 발송 지점이 셋(일괄발급 컨펌·정산서·거래내역서)이라 판정을 여기 한 곳에 둔다 —
 *   같은 검사를 각 파일에 적으면 네 번째 발송 경로가 생길 때 또 빠진다(실제로 한 곳이 빠져 있었다).
 */
export function isRecipientRejected(mailInfo: any, email: string): boolean {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return false;
  const rejected: string[] = Array.isArray(mailInfo?.rejected)
    ? mailInfo.rejected.map((x: any) => String(x))
    : [];
  return rejected.some((x) => x.toLowerCase().includes(target));
}

const trimOrNull = (v: any): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/** 회사의 전체 수신자(비활성 포함 — 화면 편집용). */
export async function listBillingRecipients(companyId: string, db: any = pool): Promise<BillingRecipientRow[]> {
  const r = await db.query(
    `SELECT id, user_id, doc_type, email, name, is_primary, is_active
       FROM billing_recipients
      WHERE company_id = $1::uuid
      ORDER BY doc_type, (user_id IS NOT NULL), is_primary DESC, created_at`,
    [companyId],
  );
  return r.rows as BillingRecipientRow[];
}

/**
 * (순수) 행 목록에서 한 scope의 수신자를 고른다 — 계정 레벨이 있으면 그것만, 없으면 회사 레벨.
 * `billing_contacts`의 3단 판정(계정 → 회사)과 **같은 축**이다. 축이 다르면 화면마다 대상이 달라진다.
 * 비활성(is_active=false)은 제외한다.
 */
export function pickRecipients(
  rows: BillingRecipientRow[],
  userId: string | null,
  docType: BillingDocType,
): ResolvedRecipients {
  const ofType = rows.filter((r) => r.doc_type === docType && r.is_active !== false);
  const scoped = userId ? ofType.filter((r) => String(r.user_id || '') === String(userId)) : [];
  const pool_ = scoped.length > 0 ? scoped : ofType.filter((r) => r.user_id === null);

  if (pool_.length === 0) return { primary: null, cc: [] };
  const primaryRow = pool_.find((r) => r.is_primary === true) || pool_[0];
  const cc = pool_
    .filter((r) => r.id !== primaryRow.id)
    .map((r) => String(r.email || '').trim())
    .filter((e) => e !== '');
  return { primary: { email: String(primaryRow.email).trim(), name: primaryRow.name ?? null }, cc };
}

/** 한 scope의 수신자 해석 — 위 두 함수를 묶은 것. 소비처는 대부분 이것만 부른다. */
export async function resolveBillingRecipients(
  companyId: string,
  userId: string | null,
  docType: BillingDocType,
  db: any = pool,
): Promise<ResolvedRecipients> {
  const rows = await listBillingRecipients(companyId, db);
  return pickRecipients(rows, userId, docType);
}

export interface BillingRecipientInput {
  userId: string | null; // null = 회사 레벨
  docType: BillingDocType;
  email: string;
  name?: string | null;
  isPrimary?: boolean;
  isActive?: boolean;
}

/**
 * 수신자 등록·수정.
 * ⚠ 계정 레벨은 **그 회사 소속 계정인지** 호출부(라우트 트랜잭션)가 먼저 검증한다 — 여기서는 값만 쓴다.
 * ⚠ `is_primary`는 partial unique 2본이 (회사,계정,유형)당 1명을 강제한다. 새 대표를 세울 때는
 *   **같은 트랜잭션에서** 기존 대표를 내린 뒤 넣어야 유니크 위반이 안 난다 — 그래서 이 함수가 직접 내린다.
 */
export async function upsertBillingRecipient(
  db: any,
  companyId: string,
  input: BillingRecipientInput,
  createdBy?: string | null,
): Promise<void> {
  const email = trimOrNull(input.email);
  if (!email || !EMAIL_RE.test(email)) {
    throw new Error(`수신자 이메일 형식이 올바르지 않습니다: ${input.email}`);
  }
  if (!isBillingDocType(input.docType)) {
    throw new Error(`알 수 없는 문서 유형입니다: ${input.docType}`);
  }
  const by = createdBy && UUID_RE.test(createdBy) ? createdBy : null;
  const isPrimary = input.isPrimary === true;
  const isActive = input.isActive !== false;
  const lower = email.toLowerCase();

  if (isPrimary) {
    // 같은 scope의 기존 대표를 먼저 내린다(자기 자신 제외는 아래 UPSERT가 다시 세운다).
    if (input.userId) {
      await db.query(
        `UPDATE billing_recipients SET is_primary = false, updated_at = NOW()
          WHERE company_id = $1::uuid AND user_id = $2::uuid AND doc_type = $3
            AND is_primary = true AND lower(email) <> $4`,
        [companyId, input.userId, input.docType, lower],
      );
    } else {
      await db.query(
        `UPDATE billing_recipients SET is_primary = false, updated_at = NOW()
          WHERE company_id = $1::uuid AND user_id IS NULL AND doc_type = $2
            AND is_primary = true AND lower(email) <> $3`,
        [companyId, input.docType, lower],
      );
    }
  }

  const vals = [companyId, input.docType, email, trimOrNull(input.name), isPrimary, isActive, by];
  if (input.userId) {
    await db.query(
      `INSERT INTO billing_recipients (company_id, user_id, doc_type, email, name, is_primary, is_active, created_by)
       VALUES ($1::uuid, $8::uuid, $2, $3, $4, $5::boolean, $6::boolean, $7::uuid)
       ON CONFLICT (company_id, user_id, doc_type, lower(email)) WHERE user_id IS NOT NULL DO UPDATE SET
         name = EXCLUDED.name, is_primary = EXCLUDED.is_primary, is_active = EXCLUDED.is_active, updated_at = NOW()`,
      [...vals, input.userId],
    );
  } else {
    await db.query(
      `INSERT INTO billing_recipients (company_id, user_id, doc_type, email, name, is_primary, is_active, created_by)
       VALUES ($1::uuid, NULL, $2, $3, $4, $5::boolean, $6::boolean, $7::uuid)
       ON CONFLICT (company_id, doc_type, lower(email)) WHERE user_id IS NULL DO UPDATE SET
         name = EXCLUDED.name, is_primary = EXCLUDED.is_primary, is_active = EXCLUDED.is_active, updated_at = NOW()`,
      vals,
    );
  }
}

/**
 * 수신자 삭제 — 회사 스코프를 조건에 넣어 남의 회사 행을 지울 수 없게 한다.
 *
 * ★ 2026-07-31 **대표를 지우면 같은 스코프의 다음 행이 승계한다.**
 *   승계가 없으면 `pickRecipients`가 남은 행 중 하나를 대표처럼 쓰게 되고,
 *   화면에는 `참조`라고 적힌 사람이 컨펌 권한자·계산서 발행 주소가 된다(Codex 적대검증 high).
 *   ⚠ DELETE와 승계 UPDATE는 **한 트랜잭션**이어야 한다 — 호출부(라우트)가 감싼다.
 */
export async function deleteBillingRecipient(db: any, companyId: string, id: string): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM billing_recipients WHERE id = $1::uuid AND company_id = $2::uuid
      RETURNING user_id, doc_type, is_primary`,
    [id, companyId],
  );
  if (r.rows.length === 0) return false;
  const gone = r.rows[0];
  if (gone.is_primary !== true) return true;

  // 남은 활성 행 중 가장 먼저 등록된 행이 대표를 잇는다(등록 순서 = 사람이 기대하는 순서).
  if (gone.user_id) {
    await db.query(
      `UPDATE billing_recipients SET is_primary = true, updated_at = NOW()
        WHERE id = (SELECT id FROM billing_recipients
                     WHERE company_id = $1::uuid AND user_id = $2::uuid AND doc_type = $3
                       AND is_active = true
                     ORDER BY created_at LIMIT 1)`,
      [companyId, gone.user_id, gone.doc_type],
    );
  } else {
    await db.query(
      `UPDATE billing_recipients SET is_primary = true, updated_at = NOW()
        WHERE id = (SELECT id FROM billing_recipients
                     WHERE company_id = $1::uuid AND user_id IS NULL AND doc_type = $2
                       AND is_active = true
                     ORDER BY created_at LIMIT 1)`,
      [companyId, gone.doc_type],
    );
  }
  return true;
}
