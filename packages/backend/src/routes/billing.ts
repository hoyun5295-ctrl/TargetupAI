import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import pool, { mysqlQuery } from '../config/database';
import { SUCCESS_CODES_SQL } from '../utils/sms-result-map';
import { INVITO_INFO } from '../config/defaults';
import { CREDIT_UNIT_PRICE } from '../utils/ai-credit-calc';
// ★ 2026-07-25 사용량 집계 CT — 청구서(이 파일)와 발송통계 엑셀이 같은 집계를 쓴다(정산 정합).
//   미리보기(/preview)도 여기를 거친다 — 미리보기와 발행 금액이 갈라지지 않게 하는 유일한 장치다.
import {
  buildCompanyUsageByDay, buildBillingTotals, selectBillingSendIds, aggregateBillingSendIds, smsAggByRunDateType, resolveBillingUnitPrices,
  getTablesForBillingPeriod, getBillingCompanyTables, MSG_TYPE_TO_USAGE_KEY, logUnbillableUsageKeys,
} from '../utils/send-usage-aggregation';
// ★ 2026-07-26 정산 재구성 ② — 청구 상세를 채널 축(웹·에이전트·테스트·스팸)으로 저장한다.
//   그 전까지 청구 집계는 `sales.RSRM_SalesStts`를 전혀 읽지 않아 `usage_type='both'` 회사 17곳의
//   게이트웨이 발송분이 청구서에서 통째로 빠져 있었다.
import {
  buildBillingUsageRows, diffBillingRowsVsDayData, priceBillingRows,
  resolveBillingUnitPricesDetailed, findUnsetPricedTypes, summarizeBlockList, findBlockingPendingRows,
  // ★ 2026-07-28 발행 전용 식별자(장 분할·항등식·계정 정리·청크)는 utils/billing-issue.ts로 이동했다.
  buildPlanBillingItems, toDayKey,
  // ★ 2026-08-04 추가 항목(080·부가서비스)의 파생 계약 — 반영 현황 화면이 **발행과 같은 함수**로
  //   실제 청구 금액을 계산한다. 화면이 따로 더하면 그 순간 청구서와 갈라진다.
  buildExtraBillingItems, extraRowUserId, EXTRA_ITEM_SOURCE_SELECT, EXTRA_ITEM_SOURCE_JOIN,
  type PricedBillingItem, type BillingScope,
} from '../utils/send-usage-aggregation';
import { loadBillingLedger } from '../utils/billing-ledger';
import { floorWon, vatOfSupply } from '../utils/money';
import { drawPartyBlock, drawThanksNote, THANKS_NOTE_HEIGHT } from '../utils/pdf-party-block';
// ★ 2026-07-28 PDF 생성 CT — 라우트 인라인이었던 것을 추출. 일괄발급·메일 첨부가 같은 함수를 쓴다.
import { renderBillingStatementPdf, renderInvoicePdf, loadBillingStatementData, loadInvoicePdfData } from '../utils/billing-pdf';
// ★ 2026-08-04 컨펌 토큰·안내 문구는 일괄발급과 **같은 CT**를 쓴다 — 개별 발송 메일에만 컨펌 버튼이
//   없어서 업체가 이의를 낼 창구가 없었다(서수란 0803·0804 접수).
import { retryUnsentConfirmations, ensureConfirmationToken, renderConfirmBlockHtml, markConfirmationDelivered } from '../utils/invoice-confirm';
import { normalizeUnitPriceBasis } from '../utils/unit-price';
import { buildInvoiceLines, checkInvoiceLinesAgainstHeader, sumFlooredInvoiceLines, invoiceLineLabel } from '../utils/billing-invoice-lines';
import { resolveBillingScopeLabel } from '../utils/billing-scope-label';
import {
  loadPlanChanges, buildPlanSegments, sumPlanSegments, evaluatePlanHistoryGate,
  countPlanChanges, planChangesFingerprint,
} from '../utils/plan-proration';
// ★ 2026-07-27 발송ID 표시명(발급명) 단일 소스 — 청구서 상세·미리보기도 화면과 같은 이름을 쓴다.
import { getAgentCustNameMap } from '../utils/pay-stats';
// ★ 2026-07-28 발행 코어 CT — /generate와 거래내역서 일괄발급 배치가 같은 함수를 쓴다(동작 무변경 추출).
import {
  issueBilling, issueMinimumChargeBilling, BillingIssueError,
  // ★ 2026-08-04 미리보기가 발행과 **같은 문**으로 기간 축 차단을 판정한다(별건 5 — 미리보기 통과 후 발행 실패).
  readBillingPeriodConflicts, describeBillingPeriodConflict,
} from '../utils/billing-issue';
// ★ 2026-08-05 요금제 무료 제공 — 미리보기가 발행과 같은 공제를 적용하게 한다(§2-4 규약)
import { readFreeDeductibleForBilling } from '../utils/free-messaging';
// ★ 2026-08-05 청구 수량 정의 CT — 미리보기가 발행·인쇄와 같은 식을 쓰게 한다
import { billableQuantity } from '../utils/billing-types';
// ★ 2026-07-30 수정세금계산서 — 사유별 장 구성 계약(순수). 라우트는 이 계획을 트랜잭션 INSERT만 한다.
// ★ 2026-08-05 발행 완료분 메일 재발송(서수란 접수) — 재발행이 아니라 같은 문서번호로 메일만 다시 보낸다.
import { planModifyIssue, ModifyPlanError, resendIssuedTaxbillEmail, TaxbillResendError } from '../utils/taxbill-popbill';
// ★ 2026-07-28 정산 설정·담당자 CT — 고객사 상세 "정산" 탭 + 일괄발급·발송·계산서 워커가 공유.
import {
  getCompanyBillingSettings, upsertCompanyBillingSettings,
  listBillingContacts, upsertBillingContact, normalizeBizNumber,
} from '../utils/billing-settings';
// ★ 2026-07-31 정산 메일 수신자 CT — 유형별(거래내역서/세금계산서)·복수 수신자를 이 원장 하나가 소유한다.
//   그전엔 이 라우트만 `companies.contact_email`을 봐서 일괄발급과 개별 발송의 수신자가 갈릴 수 있었다.
import {
  listBillingRecipients, resolveBillingRecipients, upsertBillingRecipient,
  deleteBillingRecipient, isBillingDocType, isRecipientRejected,
} from '../utils/billing-recipients';
// ★ 2026-07-28 일괄발급 배치 CT — 대상 산출·job 실행·진행률.
import {
  listUnbilledPostpaid, createBulkJob, getBulkJob, findRunningBulkJob,
  listManualCompletions, addManualCompletions, removeManualCompletion, isWholeMonthPeriod,
} from '../utils/billing-bulk';
// ★ 2026-07-28 사업자등록증 자동입력 — 정산 탭 모달 (vision 판독, 크레딧 미차감)
import multer from 'multer';
import { sniffImageMediaType } from '../utils/event-image-extract';
import { extractBizRegistration } from '../utils/biz-registration-extract';
// ★ 2026-07-30 080 청구 CT (서수란 접수 — 번호 매핑 + KT 명세서 판독·반영)
import {
  list080Numbers, normalize080Number, format080Number,
  extractKtStatement, validateKtStatement, reconcileKtStatement, applyKtStatement,
  signKtStatement, addManualExtraItems, deleteExtraItem,
} from '../utils/billing-080';

// SMTP transporter (재사용)
// ★ 2026-07-26 타임아웃 3종 명시 — 정산서 발송은 **행 잠금을 든 트랜잭션 안에서** SMTP를 부른다.
//   타임아웃이 없으면 메일 서버가 응답을 안 줄 때 그 트랜잭션이 커넥션과 잠금을 무한정 붙잡고,
//   그 회사의 삭제·상태변경이 함께 멈춘다. 값은 정산 발송(월 1회, 첨부 있음) 기준으로 넉넉히 잡았다.
const getTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hiworks.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 40000,
});

// (2026-07-30 3R) 옛 로컬 smsAggByRunAndType 삭제 — 청킹·인덱스 힌트·정산 전용 풀을 전부 우회하는
// 인라인 집계였다. 이제 utils/send-usage-aggregation의 aggregateBillingSendIds + smsAggByRunDateType 하나만 쓴다.

// ※ 옛 `loadAgentUnitPriceRows`는 삭제했다(2026-07-26).
//   라우트 안에 정의한 인라인 헬퍼였고(`no_inline_duplication` 위반), 같은 원장을 집계 CT가 또 따로 읽어
//   두 조회 사이에 값이 바뀌면 조용히 어긋났다. 이제 `utils/billing-ledger.ts` 한 스냅샷을 쓴다.

const router = Router();

// ============================================================
//  정산(Billing) API — 슈퍼관리자 전용
//  마운트: /api/admin/billing
// ============================================================

// ★ 전체 라우트에 인증 + 슈퍼관리자 권한 적용
router.use(authenticate, requireSuperAdmin);

// ============================================================
//  정산(Billing) CRUD
// ============================================================

// POST /generate - 정산 데이터 생성 (월별 집계)
router.post('/generate', async (req: Request, res: Response) => {
  // ★ 2026-07-28 발행 코어를 utils/billing-issue.ts로 추출(동작 무변경) — 거래내역서 일괄발급 배치와 공유한다.
  //   차단·검증 실패는 BillingIssueError(status·body)로 올라오고, 여기서는 HTTP로 옮기기만 한다.
  //   코드·문구·상태코드 계약은 코어가 그대로 들고 있다(billing-route-invariants.test.ts가 코어 소스를 스캔한다).
  try {
    const { company_id, user_id, billing_start, billing_end } = req.body;
    const adminId = (req as any).user?.userId;
    const result = await issueBilling({
      company_id, user_id, billing_start, billing_end,
      scope: (req.body || {}).scope ?? null,
      adminId,
    });
    return res.json(result);
  } catch (error: any) {
    if (error instanceof BillingIssueError) {
      return res.status(error.status).json(error.body);
    }
    const emsg = error?.message || '';
    if (emsg.includes('column') && emsg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — billing_items.channel·store_id·plan_days·plan_month_days, billings.scope·batch_id, ai_credit_transactions.overage_credits·billed_billing_id 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('정산 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /list - 정산 목록
router.get('/list', async (req: Request, res: Response) => {
  try {
    const { company_id, year, status, unsent } = req.query;
    let sql = `SELECT b.*, c.company_name, u.name as user_name
               FROM billings b
               JOIN companies c ON c.id = b.company_id
               LEFT JOIN users u ON u.id = b.user_id
               WHERE 1=1`;
    const params: any[] = [];

    if (company_id) { params.push(company_id); sql += ` AND b.company_id = $${params.length}`; }
    if (year) { params.push(year); sql += ` AND b.billing_year = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND b.status = $${params.length}`; }
    // ★ 2026-07-28 발행됐는데 고객에게 안 나간 장 필터. 일괄발급에서 정합 검사에 걸려 발송을 막은 장은
    //   `invoice_confirmations` 행이 없어 컨펌 추적 목록에도 안 뜬다 — 작업 note 한 줄이 사라지면
    //   발행만 되고 잊히는 장이 남는다. 여기서 항상 다시 찾을 수 있어야 한다.
    if (String(unsent || '') === '1') { sql += ' AND b.emailed_at IS NULL'; }
    sql += ' ORDER BY b.billing_year DESC, b.billing_month DESC, b.created_at DESC';

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (error: any) {
    console.error('정산 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /bulk/retry-confirmations — 발행은 됐는데 메일이 안 나간 묶음만 컨펌 단계 재시도 (★2026-07-28)
//   발행을 다시 하지 않는다(기간 중복에 막힌다). 이미 나간 장은 대상에서 빠지므로 두 번 눌러도 중복 발송이 없다.
router.post('/bulk/retry-confirmations', async (req: Request, res: Response) => {
  try {
    // ★ 2026-07-28 입력은 장 id다 — batch_id는 장이 2개 이상일 때만 생겨서 기본 발급(단일 장)에 안 닿는다.
    const billingId = String((req.body || {}).billing_id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(billingId)) {
      return res.status(400).json({ error: '재시도할 정산(billing_id)이 올바르지 않습니다.' });
    }
    const r = await retryUnsentConfirmations(billingId);
    if (r.targeted === 0) {
      return res.json({ success: true, targeted: 0, message: '재시도할 미발송 장이 없습니다(이미 발송됐거나 장을 찾지 못했습니다).' });
    }
    const blocked = r.mismatchBlocked + r.renderFailed;
    return res.json({
      success: true,
      targeted: r.targeted,
      summary: r,
      message: blocked > 0
        ? `아직 ${blocked}장이 막혀 한 통도 보내지 않았습니다 (금액 불일치 ${r.mismatchBlocked} · PDF 장애 ${r.renderFailed}). 원인을 해소한 뒤 다시 시도해 주세요.`
        : `${r.sent}건 발송했습니다.`
          + (r.skippedNoEmail > 0 ? ` 이메일 미등록 ${r.skippedNoEmail}장은 제외했습니다.` : ''),
    });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — invoice_confirmations 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('컨펌 재시도 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /company-users/:companyId - 고객사 사용자 목록
router.get('/company-users/:companyId', async (req: Request, res: Response) => {
  try {
    // ★ D131 후속: billing 고객사 사용자 목록에서 system 가상 계정 제외
    const result = await pool.query(
      `SELECT id, name, login_id, department, role
       FROM users WHERE company_id = $1 AND is_active = true AND COALESCE(is_system, false) = false
       ORDER BY name`,
      [req.params.companyId]
    );
    return res.json(result.rows);
  } catch (error: any) {
    console.error('사용자 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ═══ 정산 설정·담당자 — 고객사 상세 "정산" 탭 (2026-07-28) ═══
//   SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §2. CT = utils/billing-settings.ts.

// GET /company-billing-settings/:companyId — 설정(발행 단위·계산서 날짜 정책) + 담당자 목록
router.get('/company-billing-settings/:companyId', async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const settings = await getCompanyBillingSettings(companyId);
    const contacts = await listBillingContacts(companyId);
    // ★ 2026-07-31 수신자는 별도 원장(복수·유형별)이라 함께 내려준다. 담당자 행의 연락처 컬럼은 더 이상 읽지 않는다.
    const recipients = await listBillingRecipients(companyId);
    return res.json({ settings, contacts, recipients });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — company_billing_settings·billing_contacts 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('정산 설정 조회 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /company-billing-settings/:companyId — 정산 탭 전체 저장 (설정 + 회사 담당자 + 계정 담당자·사업자)
//   한 트랜잭션. 계정 담당자는 **이 회사 소속 계정인지** 검증 후에만 쓴다(남의 회사 계정 차단).
router.put('/company-billing-settings/:companyId', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { companyId } = req.params;
    const adminId = (req as any).user?.userId || null;
    const { issue_scope, taxbill_day_policy, manual_billing, company_contact, account_contacts } = (req.body || {}) as any;

    // ★ 2026-07-28 사업자등록번호는 **트랜잭션 전에 전부** 검증한다.
    //   BEGIN 안에서 던지면 한 줄 때문에 같이 입력한 다른 값까지 통째로 롤백되고,
    //   오류 문구에 어느 계정인지가 없어 계정이 많은 회사에서는 찾기가 일이다. 한 번에 다 알려준다.
    const bizErrors: string[] = [];
    const checkBiz = (label: string, v: any) => {
      try { normalizeBizNumber(v); } catch { bizErrors.push(`${label}: ${String(v ?? '').trim()}`); }
    };
    if (company_contact && typeof company_contact === 'object') {
      checkBiz('회사 기본 사업자', company_contact.taxbill_biz_number);
    }
    for (const c of (Array.isArray(account_contacts) ? account_contacts : [])) {
      if (c?.user_id) checkBiz(String(c.label || c.name || c.user_id), c.taxbill_biz_number);
    }
    if (bizErrors.length > 0) {
      return res.status(400).json({
        error: `사업자등록번호는 숫자 10자리여야 합니다 — ${bizErrors.join(' / ')}`,
        code: 'BILLING_CONTACT_INVALID',
      });
    }

    await client.query('BEGIN');
    await upsertCompanyBillingSettings(client, companyId, {
      issueScope: String(issue_scope || 'combined'),
      taxbillDayPolicy: String(taxbill_day_policy || 'last_day'),
      // ★ 2026-07-29 키가 없으면 undefined 그대로 넘겨 기존 값을 보존한다(CT가 미전송/지움을 구분).
      manualBilling: manual_billing === undefined ? undefined : manual_billing === true,
      updatedBy: adminId,
    });
    if (company_contact && typeof company_contact === 'object') {
      // ★ 2026-07-28 회사 기본 계산서 사업자도 함께 저장한다.
      //   CT·컬럼(billing_contacts.taxbill_*)은 처음부터 회사 레벨(user_id NULL)을 받게 되어 있었는데
      //   여기서 6필드를 빼고 넘겨 화면이 열려도 값이 들어갈 곳이 없었다. 계정 레벨(아래)과 같은 필드다.
      await upsertBillingContact(client, companyId, {
        userId: null,
        contactName: company_contact.name,
        contactEmail: company_contact.email,
        taxbillBizNumber: company_contact.taxbill_biz_number,
        taxbillCompanyName: company_contact.taxbill_company_name,
        taxbillCeoName: company_contact.taxbill_ceo_name,
        taxbillAddress: company_contact.taxbill_address,
        taxbillBizType: company_contact.taxbill_biz_type,
        taxbillBizItem: company_contact.taxbill_biz_item,
      }, adminId);
    }
    const list = Array.isArray(account_contacts) ? account_contacts : [];
    if (list.length > 0) {
      const ids = Array.from(new Set(list.map((c: any) => String(c?.user_id || '')).filter(Boolean)));
      const owned = await client.query(
        `SELECT id FROM users WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
        [companyId, ids],
      );
      const okIds = new Set(owned.rows.map((r: any) => String(r.id)));
      const bad = ids.filter((i) => !okIds.has(i));
      if (bad.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `이 회사 소속이 아닌 계정이 포함되어 저장을 중단했습니다 (${bad.length}건).`,
          code: 'BILLING_CONTACT_USER_MISMATCH',
        });
      }
      for (const c of list) {
        if (!c?.user_id) continue;
        await upsertBillingContact(client, companyId, {
          userId: String(c.user_id),
          contactName: c.name,
          contactEmail: c.email,
          taxbillBizNumber: c.taxbill_biz_number,
          taxbillCompanyName: c.taxbill_company_name,
          taxbillCeoName: c.taxbill_ceo_name,
          taxbillAddress: c.taxbill_address,
          taxbillBizType: c.taxbill_biz_type,
          taxbillBizItem: c.taxbill_biz_item,
        }, adminId);
      }
    }
    await client.query('COMMIT');
    return res.json({ success: true, message: '정산 설정이 저장되었습니다.' });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch { /* 아래 응답이 사실을 전달한다 */ }
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — company_billing_settings·billing_contacts 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    // ★ 2026-07-28 입력값 검증 실패는 사람이 고칠 수 있는 문제라 400으로 그대로 알린다(500 노출 금지).
    if (emsg.includes('사업자등록번호') || emsg.includes('값이 올바르지 않습니다')) {
      return res.status(400).json({ error: emsg, code: 'BILLING_CONTACT_INVALID' });
    }
    console.error('정산 설정 저장 오류:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ═══ 정산 메일 수신자 (2026-07-31) — CT = utils/billing-recipients.ts ═══
//   거래내역서 받는 사람과 세금계산서 받는 사람이 다른 고객사가 있고, 둘 다 여러 명일 수 있다(서수란 접수).
//   유형(doc_type)·인원수·귀속(회사/계정)이 전부 행으로 표현된다 — 컬럼 한 쌍으로는 셋 다 표현이 안 됐다.

// POST /company-billing-settings/:companyId/recipients — 등록·수정(같은 이메일이면 갱신)
router.post('/company-billing-settings/:companyId/recipients', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { companyId } = req.params;
    const adminId = (req as any).user?.userId || null;
    const { user_id, doc_type, email, name, is_primary, is_active } = (req.body || {}) as any;
    if (!isBillingDocType(doc_type)) {
      return res.status(400).json({ success: false, error: '문서 유형은 거래내역서(statement)/세금계산서(taxbill) 중 하나여야 합니다.' });
    }
    const scopeUserId = String(user_id || '').trim() || null;
    if (scopeUserId) {
      // 남의 회사 계정으로 수신자를 만들면 그 계정 장의 청구서가 엉뚱한 곳으로 나간다.
      const own = await client.query(
        `SELECT 1 FROM users WHERE id = $1::uuid AND company_id = $2::uuid`,
        [scopeUserId, companyId],
      );
      if (own.rows.length === 0) {
        return res.status(400).json({ success: false, error: '선택한 사용자가 이 고객사 소속이 아닙니다.' });
      }
    }
    await client.query('BEGIN');
    await upsertBillingRecipient(client, companyId, {
      userId: scopeUserId,
      docType: doc_type,
      email: String(email || ''),
      name,
      isPrimary: is_primary === true,
      isActive: is_active !== false,
    }, adminId);
    await client.query('COMMIT');
    return res.json({ success: true, recipients: await listBillingRecipients(companyId) });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch { /* 아래 응답이 사실을 전달한다 */ }
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — billing_recipients 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    if (emsg.includes('이메일') || emsg.includes('문서 유형')) {
      return res.status(400).json({ success: false, error: emsg });
    }
    console.error('정산 수신자 저장 오류:', error);
    return res.status(500).json({ success: false, error: emsg || '수신자 저장 실패' });
  } finally {
    client.release();
  }
});

// DELETE /company-billing-settings/:companyId/recipients/:id
router.delete('/company-billing-settings/:companyId/recipients/:id', async (req: Request, res: Response) => {
  // 삭제와 대표 승계는 한 트랜잭션 — 중간에 끊기면 대표가 없는 스코프가 남는다.
  const client = await pool.connect();
  try {
    const { companyId, id } = req.params;
    await client.query('BEGIN');
    const ok = await deleteBillingRecipient(client, companyId, id);
    if (!ok) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: '삭제할 수신자를 찾을 수 없습니다.' });
    }
    await client.query('COMMIT');
    return res.json({ success: true, recipients: await listBillingRecipients(companyId) });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch { /* 아래 응답이 사실을 전달한다 */ }
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — billing_recipients 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('정산 수신자 삭제 오류:', emsg || error);
    return res.status(500).json({ success: false, error: '수신자 삭제 실패' });
  } finally {
    client.release();
  }
});

// ※ 귀속 선택용 계정 목록은 **위 `/company-users/:companyId`(193행)를 그대로 쓴다.**
//   같은 경로를 또 등록하면 Express가 먼저 등록된 쪽만 실행해 새 핸들러는 죽은 코드가 된다.

// ═══ 거래내역서 일괄발급 (2026-07-28) — SoT §3. CT = utils/billing-bulk.ts ═══

// GET /bulk/unbilled?start&end — 후불·해당 기간 미발급 회사 목록 (담기 리스트)
router.get('/bulk/unbilled', async (req: Request, res: Response) => {
  try {
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
      return res.status(400).json({ error: '기간(start·end)이 올바르지 않습니다.' });
    }
    const companies = await listUnbilledPostpaid(start, end);
    return res.json({ companies });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — 일괄발급 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('일괄발급 대상 조회 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ═══ 수동 정산완료 (★2026-07-29) — 우리 정산으로 발행할 수 없는 회사의 그 달 처리 기록 ═══
//   청구서를 만들지 않는다. 미발급 목록에서만 빠지고, 해제하면 곧바로 돌아온다.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BULK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 새 테이블·컬럼 미생성 상태를 500이 아니라 503으로 알린다(db_alter_safety_net). */
const isMigrationPending = (error: any): boolean => {
  const m = error?.message || '';
  return m.includes('does not exist') && (m.includes('relation') || m.includes('column'));
};
const MIGRATION_MSG = 'DB 마이그레이션 필요 — billing_manual_completions 테이블·company_billing_settings.manual_billing 컬럼 생성 요청';

// GET /bulk/manual-completions?start&end — 그 기간 수동완료 목록
router.get('/bulk/manual-completions', async (req: Request, res: Response) => {
  try {
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end) {
      return res.status(400).json({ error: '기간(start·end)이 올바르지 않습니다.' });
    }
    const rows = await listManualCompletions(start, end);
    return res.json({ rows });
  } catch (error: any) {
    if (isMigrationPending(error)) return res.status(503).json({ error: MIGRATION_MSG, code: 'DB_MIGRATION_PENDING' });
    console.error('수동 정산완료 조회 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /bulk/manual-completions — 선택 회사를 그 달 수동완료로 기록
router.post('/bulk/manual-completions', async (req: Request, res: Response) => {
  try {
    const { period_start, period_end, company_ids, reason } = (req.body || {}) as any;
    if (!DATE_RE.test(String(period_start)) || !DATE_RE.test(String(period_end)) || String(period_start) > String(period_end)) {
      return res.status(400).json({ error: '기간(period_start·period_end)이 올바르지 않습니다.' });
    }
    // ★ 2026-07-29 달 단위로만 받는다 — 하루짜리 기록이 그 달 전체를 가리는 매출 누락 경로를 입구에서 막는다.
    if (!isWholeMonthPeriod(String(period_start), String(period_end))) {
      return res.status(400).json({ error: '수동 정산완료는 달 단위로만 기록합니다 — 대상월 1일부터 말일까지여야 합니다.' });
    }
    const ids = Array.from(new Set((Array.isArray(company_ids) ? company_ids : []).map((v: any) => String(v))));
    if (ids.length === 0) return res.status(400).json({ error: '수동 정산완료로 표시할 회사를 선택해 주세요.' });
    for (const id of ids) {
      if (!BULK_UUID_RE.test(id)) return res.status(400).json({ error: '회사 식별자가 올바르지 않습니다.' });
    }
    const text = String(reason ?? '').trim();
    const { added, skipped } = await addManualCompletions(
      ids, String(period_start), String(period_end),
      text === '' ? null : text.slice(0, 500),
      (req as any).user?.userId || null,
    );
    return res.json({ success: true, added, skipped });
  } catch (error: any) {
    if (isMigrationPending(error)) return res.status(503).json({ error: MIGRATION_MSG, code: 'DB_MIGRATION_PENDING' });
    console.error('수동 정산완료 기록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /bulk/manual-completions/:id — 해제(미발급 목록으로 되돌림)
router.delete('/bulk/manual-completions/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    if (!BULK_UUID_RE.test(id)) return res.status(400).json({ error: '기록 식별자가 올바르지 않습니다.' });
    const removed = await removeManualCompletion(id);
    if (!removed) return res.status(404).json({ error: '이미 해제된 기록입니다.' });
    return res.json({ success: true });
  } catch (error: any) {
    if (isMigrationPending(error)) return res.status(503).json({ error: MIGRATION_MSG, code: 'DB_MIGRATION_PENDING' });
    console.error('수동 정산완료 해제 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /bulk/jobs — 일괄발급 시작 (비동기 배치 — 진행률은 GET /bulk/jobs/:id 폴링)
router.post('/bulk/jobs', async (req: Request, res: Response) => {
  try {
    const { period_start, period_end, items } = (req.body || {}) as any;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(period_start)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(period_end)) || String(period_start) > String(period_end)) {
      return res.status(400).json({ error: '기간(period_start·period_end)이 올바르지 않습니다.' });
    }
    // ★ 2026-07-29 일괄발급도 달 단위로만 받는다(화면이 월만 보낸다). 수동완료와 같은 격자에 놓여야
    //   "6월 수동완료 + 6/25~7/25 일괄발급" 같은 부분 겹침 자체가 생기지 않는다. 임의 기간은 단건 발행 경로다.
    if (!isWholeMonthPeriod(String(period_start), String(period_end))) {
      return res.status(400).json({ error: '일괄발급은 달 단위로만 실행합니다 — 대상월 1일부터 말일까지여야 합니다.' });
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return res.status(400).json({ error: '발급할 회사를 담아 주세요.' });
    for (const it of list) {
      if (!UUID_RE.test(String(it?.company_id || ''))) return res.status(400).json({ error: '회사 식별자가 올바르지 않습니다.' });
      if (it?.scope !== 'combined' && it?.scope !== 'by_user') return res.status(400).json({ error: `발행 단위 값이 올바르지 않습니다: ${it?.scope}` });
    }
    // 실행 중 job이 있으면 새 job을 막는다 — 진행률 화면 혼선·중복 클릭 차단(회사 단위 이중 발행은 코어 잠금이 별도로 막는다).
    const running = await findRunningBulkJob();
    if (running) {
      return res.status(409).json({ error: '이미 실행 중인 일괄발급이 있습니다. 완료 후 다시 시도해 주세요.', code: 'BULK_JOB_RUNNING', job_id: running });
    }
    const { jobId } = await createBulkJob(
      String(period_start), String(period_end),
      list.map((it: any) => ({ companyId: String(it.company_id), scope: it.scope })),
      (req as any).user?.userId || null,
    );
    return res.json({ success: true, job_id: jobId });
  } catch (error: any) {
    // ★ Codex 1R MEDIUM 수용 — 트랜잭션 안 재검사(TOCTOU 차단)가 던진 실행 중 충돌은 409로.
    if (error?.code === 'BULK_JOB_RUNNING') {
      return res.status(409).json({ error: error.message, code: 'BULK_JOB_RUNNING', job_id: error.jobId || null });
    }
    // ★ 2026-07-29 트랜잭션 안 대상 재판정에 걸린 건 사람이 목록을 다시 불러오면 풀리는 상태다 — 409로 알린다.
    if (error?.code === 'BULK_TARGET_NOT_BILLABLE') {
      return res.status(409).json({ error: error.message, code: 'BULK_TARGET_NOT_BILLABLE', company_ids: error.companyIds || [] });
    }
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — 일괄발급 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('일괄발급 시작 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /bulk/jobs/:id — 진행률 폴링 (job 헤더 + item 목록)
router.get('/bulk/jobs/:id', async (req: Request, res: Response) => {
  try {
    const data = await getBulkJob(String(req.params.id));
    if (!data) return res.status(404).json({ error: '일괄발급 작업을 찾을 수 없습니다.' });
    return res.json(data);
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — 일괄발급 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('일괄발급 조회 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /confirmations?start&end&status — 컨펌·이의신청·계산서 상태 목록 (슈퍼관리자 현황판)
router.get('/confirmations', async (req: Request, res: Response) => {
  try {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start || '')) ? String(req.query.start) : null;
    const end = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end || '')) ? String(req.query.end) : null;
    const ALLOWED = ['pending', 'confirmed', 'due', 'objected', 'manual_wait', 'ready', 'issued'];
    const status = ALLOWED.includes(String(req.query.status || '')) ? String(req.query.status) : null;
    // ★ Codex 1R 수용 — date는 to_char로 못 박고(파서가 Date 객체로 줘 표시가 깨진다),
    //   501건을 읽어 500 초과 여부(truncated)를 화면에 알린다(조용한 절단 차단).
    const r = await pool.query(
      // ★ 2026-08-05 대리 컨펌 2컬럼은 `to_jsonb`로 읽는다 — ALTER 실행 전에도 이 현황판이 깨지지 않는다
      //   (컬럼이 없으면 키가 없어 NULL. plan-guard의 advanced_access_enabled와 같은 규약).
      //   현황판이 통째로 죽으면 그 달 컨펌·발급 상태를 볼 방법이 사라진다 — 표시 하나 때문에 그걸 걸지 않는다.
      `SELECT ic.id, ic.billing_id, ic.recipient_email, ic.recipient_user_id, ic.sent_at,
              ic.confirmed_at, ic.objection_at, ic.objection_text,
              (to_jsonb(ic) ->> 'confirmed_by_admin') AS confirmed_by_admin,
              (to_jsonb(ic) ->> 'confirm_note')       AS confirm_note,
              ic.taxbill_status, to_char(ic.taxbill_issue_date, 'YYYY-MM-DD') AS taxbill_issue_date,
              ic.taxbill_due_at, ic.issued_at, ic.superseded_at,
              to_char(b.billing_start, 'YYYY-MM-DD') AS billing_start,
              to_char(b.billing_end, 'YYYY-MM-DD')   AS billing_end,
              b.total_amount, b.scope AS billing_scope,
              c.company_name, u.name AS account_name
         FROM invoice_confirmations ic
         JOIN billings b ON b.id = ic.billing_id
         JOIN companies c ON c.id = ic.company_id
         LEFT JOIN users u ON u.id = ic.recipient_user_id
        WHERE ($1::date IS NULL OR b.billing_end >= $1::date)
          AND ($2::date IS NULL OR b.billing_start <= $2::date)
          AND ($3::text IS NULL OR ic.taxbill_status = $3::text)
        ORDER BY ic.sent_at DESC
        LIMIT 501`,
      [start, end, status],
    );
    const truncated = r.rows.length > 500;
    return res.json({ confirmations: truncated ? r.rows.slice(0, 500) : r.rows, truncated });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — invoice_confirmations 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('컨펌 현황 조회 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /taxbill-issues?start&end&status — 세금계산서 장부 목록 (원본+수정 — 컨펌 추적과 다른 축)
router.get('/taxbill-issues', async (req: Request, res: Response) => {
  try {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start || '')) ? String(req.query.start) : null;
    const end = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end || '')) ? String(req.query.end) : null;
    const ALLOWED = ['ready', 'submitted', 'issued', 'failed', 'cancelled'];
    const status = ALLOWED.includes(String(req.query.status || '')) ? String(req.query.status) : null;
    const r = await pool.query(
      `SELECT t.id, t.kind, t.modify_code, t.org_nts_confirm_num, t.invoicer_mgt_key, t.nts_confirm_num,
              to_char(t.issue_date, 'YYYY-MM-DD') AS issue_date,
              t.supply_amount, t.tax_amount, t.total_amount, t.status, t.error,
              t.created_at, t.issued_at,
              to_char(b.billing_start, 'YYYY-MM-DD') AS billing_start,
              to_char(b.billing_end, 'YYYY-MM-DD')   AS billing_end,
              c.company_name
         FROM taxbill_issues t
         LEFT JOIN billings b ON b.id = t.billing_id
         LEFT JOIN companies c ON c.id = t.company_id
        WHERE ($1::date IS NULL OR COALESCE(b.billing_end, t.issue_date) >= $1::date)
          AND ($2::date IS NULL OR COALESCE(b.billing_start, t.issue_date) <= $2::date)
          AND ($3::text IS NULL OR t.status = $3::text)
        ORDER BY t.created_at DESC
        LIMIT 501`,
      [start, end, status],
    );
    const truncated = r.rows.length > 500;
    return res.json({ issues: truncated ? r.rows.slice(0, 500) : r.rows, truncated });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — taxbill_issues 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('세금계산서 장부 조회 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /taxbill-issues/:id/modify — 수정세금계산서 발급 요청 (사유 1·2·4·6)
//   장 구성은 planModifyIssue(순수·사유별 부호 계약)가 정하고, 여기는 그 계획을 한 트랜잭션으로
//   ready에 넣기만 한다 — 실제 발행·효과 검증은 워커(issueReadyTaxbills)의 몫.
router.post('/taxbill-issues/:id/modify', async (req: Request, res: Response) => {
  try {
    const origId = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(origId)) return res.status(400).json({ error: '장부 id 형식 오류' });
    const body = (req.body || {}) as any;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 당초 장 — 발행 완료(승인번호 보유)만 수정 대상. FOR UPDATE로 이중 클릭 직렬화.
      const o = await client.query(
        `SELECT t.id, t.confirmation_id, t.billing_id, t.company_id, t.status, t.nts_confirm_num,
                to_char(t.issue_date, 'YYYY-MM-DD') AS issue_date,
                t.supply_amount, t.tax_amount, t.total_amount
           FROM taxbill_issues t
          WHERE t.id = $1::uuid
            FOR UPDATE`,
        [origId],
      );
      const orig = o.rows[0];
      if (!orig) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: '장부를 찾을 수 없습니다.' });
      }
      if (orig.status !== 'issued' || !String(orig.nts_confirm_num || '').trim()) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: '발행 완료(국세청승인번호 수신) 상태에서만 수정발행이 가능합니다. 전송실패 건은 팝빌 사이트에서 재전송 후 진행해 주세요.' });
      }
      // 같은 당초 장의 수정이 아직 진행 중이면 중복 생성 차단(연타·동시 요청).
      const inflight = await client.query(
        `SELECT count(*)::int AS cnt FROM taxbill_issues
          WHERE org_nts_confirm_num = $1 AND status IN ('ready', 'submitted')`,
        [orig.nts_confirm_num],
      );
      if (Number(inflight.rows[0]?.cnt ?? 0) > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: '이 장의 수정발행이 이미 진행 중입니다. 완료 후 다시 시도해 주세요.' });
      }

      // 사유별 장 계획(순수) — 계약 위반은 throw로 떨어져 400이 된다.
      const planned = planModifyIssue(
        {
          ntsConfirmNum: orig.nts_confirm_num,
          issueDate: String(orig.issue_date),
          supplyAmount: Number(orig.supply_amount),
          taxAmount: Number(orig.tax_amount),
          totalAmount: Number(orig.total_amount),
        },
        {
          code: Number(body.code),
          writeDate: body.write_date ?? null,
          // 금액은 원형 그대로 — 여기서 Number()를 걸면 Number('')=0이 검증(requiredInt)보다 먼저
          // 값을 굳혀 빈 입력이 0원 장이 된다(0730 Codex 4R ③). 검증·변환은 planModifyIssue가 한다.
          deltaSupply: body.delta_supply,
          deltaTax: body.delta_tax,
          correctedSupply: body.corrected_supply,
          correctedTax: body.corrected_tax,
        },
      );

      for (const row of planned) {
        await client.query(
          `INSERT INTO taxbill_issues (
             confirmation_id, billing_id, company_id, kind, modify_code, org_nts_confirm_num,
             issue_date, supply_amount, tax_amount, total_amount, status, created_by
           ) VALUES ($1, $2, $3, 'modify', $4, $5, $6::date, $7, $8, $9, 'ready', $10)`,
          [
            orig.confirmation_id, orig.billing_id, orig.company_id,
            row.modifyCode, row.orgNtsConfirmNum, row.issueDate,
            row.supplyAmount, row.taxAmount, row.totalAmount,
            (req as any).user?.userId ?? null,
          ],
        );
      }
      await client.query('COMMIT');
      return res.json({
        success: true,
        message: `수정세금계산서 ${planned.length}장을 발급 대기에 올렸습니다. (사유 ${body.code})`,
        planned: planned.map((p) => ({ issueDate: p.issueDate, supply: p.supplyAmount, tax: p.taxAmount, total: p.totalAmount })),
      });
    } catch (txErr: any) {
      try { await client.query('ROLLBACK'); } catch { /* 응답이 사실을 전달한다 */ }
      // 계약 위반(전용 타입)만 400 — 코드 첫 글자 휴리스틱은 DB·연결 장애까지 400으로 숨긴다(Codex 3R ④).
      if (txErr instanceof ModifyPlanError) {
        return res.status(400).json({ error: txErr.message });
      }
      throw txErr;
    } finally {
      client.release();
    }
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — taxbill_issues 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('수정세금계산서 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /taxbill-issues/:id/retry — 실패 장 재시도 (failed → ready)
//   문서번호가 행마다 결정적이라 재시도가 같은 번호로 나간다 = 팝빌 쪽 중복 발행 없음.
//   사유 1 반쪽(부만 발행·정 실패)도 이 경로로 정 장만 다시 올려 짝을 완성한다.
router.post('/taxbill-issues/:id/retry', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: '장부 id 형식 오류' });
    const r = await pool.query(
      `UPDATE taxbill_issues SET status = 'ready', error = NULL
        WHERE id = $1::uuid AND status = 'failed'
        RETURNING id`,
      [id],
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ error: '실패 상태의 장만 재시도할 수 있습니다. (이미 처리 중이거나 발행된 장일 수 있습니다)' });
    }
    return res.json({ success: true, message: '발급 대기에 다시 올렸습니다. 5분 주기 워커가 재발행합니다.' });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — taxbill_issues 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('세금계산서 재시도 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /taxbill-issues/:id/resend-email — 발행 완료분 메일 재발송 (★2026-08-05 서수란 접수)
//   업체가 "계산서를 못 받았다"고 할 때 쓰는 유일한 창구다. 그전에는 목록·수정발급·실패 재시도뿐이라
//   담당자가 할 수 있는 것이 수정세금계산서밖에 없었다(그건 국세청에 문서를 한 장 더 만든다).
//   여기서는 **문서를 만들지 않는다** — 팝빌에 있는 그 문서를 같은 번호로 다시 메일링할 뿐이다.
router.post('/taxbill-issues/:id/resend-email', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: '장부 id 형식 오류' });
    const email = String((req.body as any)?.email || '').trim();
    const r = await resendIssuedTaxbillEmail({
      issueId: id, email: email || null, adminId: (req as any).user?.userId || null,
    });
    return res.json({
      success: true,
      sent: r.sent,
      failed: r.failed,
      message: r.failed.length > 0
        ? `${r.sent.length}곳으로 다시 보냈습니다. 실패 ${r.failed.length}곳 — ${r.failed.map((f) => f.email).join(', ')}`
        : `${r.sent.join(', ')}로 계산서 메일을 다시 보냈습니다.`,
    });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — taxbill_issues 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('세금계산서 메일 재발송 오류:', emsg || error);
    // ★ Codex 3R medium 수용 — **분류된 실패만 그 상태로 돌려준다.**
    //   전부 422로 내리면 팝빌 게이트가 닫힌 것도 SDK가 죽은 것도 "입력 오류"로 기록되어
    //   5xx 알림과 재시도 판단이 막힌다. 유일한 재발송 창구라 그 누락이 오래간다.
    if (error instanceof TaxbillResendError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    // 미분류 = 우리가 모르는 장애다. 원인 문구는 로그에만 남기고 500으로 올린다.
    return res.status(500).json({ error: '계산서 메일 재발송에 실패했습니다.', code: 'TAXBILL_RESEND_FAILED' });
  }
});

// PUT /confirmations/:id/admin-confirm — 업체 확인을 관리자가 대신 기록 (★2026-08-05 서수란 접수)
//
//   컨펌 링크를 누르지 않고 메일·전화로 "이 날짜로 발행해 달라"고 알려오는 회사가 있다
//   (시세이도 = 각 부서가 거래내역서를 보고 PO 때문에 발행일자를 통보). 작성일자 지정에 컨펌 관문을
//   세우면서 이 창구를 함께 열지 않으면 그 회사들은 **어느 경로로도 계산서를 낼 수 없게 된다** —
//   차단 기준은 "틀린 금액이 나가는가" 하나이고, 확인을 받은 건을 막는 것은 그 기준이 아니다.
//
//   고객이 직접 누른 컨펌과 구분되도록 누가·무엇을 근거로 기록했는지 함께 남긴다(NULL = 고객 직접).
router.put('/confirmations/:id/admin-confirm', async (req: Request, res: Response) => {
  try {
    const note = String((req.body as any)?.note || '').trim().slice(0, 200);
    if (!note) {
      return res.status(400).json({ error: '어떻게 확인받았는지(메일·전화·담당자)를 적어주세요. 나중에 근거가 됩니다.' });
    }
    const adminId = (req as any).user?.userId || null;
    // 효과 검증 — 바뀐 행이 없으면 성공이라고 말하지 않는다(6원칙 ②).
    //   ⛔ **날짜 직접선택(`manual_wait`) 건에만 연다.** 자동 정책 건은 고객 컨펌 또는 기한 도래가
    //   이미 큐를 움직이므로 여기서 손댈 이유가 없고, 열어 두면 기한 전 발행을 사람이 앞당기는 길이 된다.
    const r = await pool.query(
      `UPDATE invoice_confirmations
          SET confirmed_at = NOW(), confirmed_by_admin = $2::uuid, confirm_note = $3
        WHERE id = $1::uuid AND taxbill_status = 'manual_wait'
          AND confirmed_at IS NULL AND objection_at IS NULL
          AND superseded_at IS NULL AND issued_at IS NULL
        RETURNING id`,
      [String(req.params.id), adminId, note],
    );
    if (r.rows.length === 0) {
      return res.status(409).json({
        error: '날짜 지정 대기 건 중 아직 컨펌되지 않은 것만 기록할 수 있습니다. (이미 컨펌·이의신청·발행됐거나 자동 발급 대상일 수 있습니다) 목록을 새로고침해 주세요.',
      });
    }
    return res.json({ success: true, message: '업체 확인을 기록했습니다. 이제 작성일자를 지정할 수 있습니다.' });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요 — invoice_confirmations.confirmed_by_admin·confirm_note 컬럼 ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('업체 확인 기록 오류:', emsg || error);
    return res.status(500).json({ error: '업체 확인 기록에 실패했습니다.' });
  }
});

// PUT /confirmations/:id/issue-date — 직접선택(중간정산) 건의 작성일자 지정 → 발급 큐 진입
router.put('/confirmations/:id/issue-date', async (req: Request, res: Response) => {
  try {
    const issueDate = String((req.body as any)?.issue_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
      return res.status(400).json({ error: '작성일자(issue_date)가 올바르지 않습니다. YYYY-MM-DD 형식으로 지정해 주세요.' });
    }
    // ★ Codex 2R HIGH 수용 — 직접선택 건도 ready 전이와 **같은 트랜잭션**에서 장부(taxbill_issues)를 만든다.
    //   워커 CTE는 confirmed·due만 소비하므로, 여기서 안 만들면 이 건은 팝빌 소비 큐에 영영 안 들어간다.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // ★ 2026-08-05 (서수란 접수) **컨펌 없이는 발급 큐에 올리지 않는다.**
      //   `ready`는 팝빌 발행 큐라 5분 워커가 그대로 국세청 문서를 만든다. 그전에는 이 UPDATE가
      //   `manual_wait`이기만 하면 통과시켜, 날짜를 지정하는 순간 업체 확인 없이 계산서가 발행됐다
      //   (한국고용노동교육원 08-03 실측 — 컨펌 기록이 없는데 발급 완료).
      //   자동 정책(pending→due→ready)은 컨펌 또는 기한 도래를 지나는데 **직접선택만 관문이 없었다.**
      //   업체가 메일·전화로 확인해 준 경우는 [업체 확인 기록](/admin-confirm)으로 `confirmed_at`을 남긴 뒤 지정한다 —
      //   막기만 하면 부서가 발행일자를 통보하는 회사(시세이도류)가 영영 발행 불가가 된다.
      const cur = await client.query(
        `SELECT taxbill_status, confirmed_at FROM invoice_confirmations
          WHERE id = $1::uuid AND superseded_at IS NULL FOR UPDATE`,
        [String(req.params.id)],
      );
      if (cur.rows.length === 0 || String(cur.rows[0].taxbill_status) !== 'manual_wait') {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: '날짜 지정 대기 상태인 건을 찾을 수 없습니다. (이미 처리됐거나 재발급된 건일 수 있습니다)' });
      }
      if (!cur.rows[0].confirmed_at) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: '업체 컨펌 전에는 계산서를 발급할 수 없습니다. 업체가 컨펌 링크를 누르거나, 메일·전화로 확인받았다면 [업체 확인 기록]을 남긴 뒤 작성일자를 지정해 주세요.',
          code: 'TAXBILL_CONFIRM_REQUIRED',
        });
      }
      const r = await client.query(
        `UPDATE invoice_confirmations
            SET taxbill_issue_date = $2::date, taxbill_status = 'ready'
          WHERE id = $1::uuid AND taxbill_status = 'manual_wait' AND superseded_at IS NULL
            AND confirmed_at IS NOT NULL
        RETURNING id, billing_id, company_id, taxbill_issue_date`,
        [String(req.params.id), issueDate],
      );
      if (r.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: '날짜 지정 대기 상태인 건을 찾을 수 없습니다. (이미 처리됐거나 재발급된 건일 수 있습니다)' });
      }
      const m = r.rows[0];
      await client.query(
        `INSERT INTO taxbill_issues (
           confirmation_id, billing_id, company_id, kind, issue_date,
           supply_amount, tax_amount, total_amount, status
         )
         SELECT $1::uuid, b.id, $2::uuid, 'original', $3::date, b.subtotal, b.vat, b.total_amount, 'ready'
           FROM billings b WHERE b.id = $4::uuid
            AND NOT EXISTS (SELECT 1 FROM taxbill_issues t WHERE t.confirmation_id = $1::uuid AND t.kind = 'original')`,
        [m.id, m.company_id, m.taxbill_issue_date, m.billing_id],
      );
      await client.query('COMMIT');
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch { /* 응답이 사실을 전달한다 */ }
      throw txErr;
    } finally {
      client.release();
    }
    return res.json({ success: true, message: `작성일자 ${issueDate}로 발급 대기에 올렸습니다.` });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — invoice_confirmations 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('작성일자 지정 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /biz-registration-extract — 사업자등록증 이미지 → 사업자 정보 자동입력 (정산 탭 모달)
//   크레딧 미차감(슈퍼관리자 내부 기능). CT = utils/biz-registration-extract.ts.
const bizRegUpload = multer({
  storage: multer.memoryStorage(),
  // ★ 2026-07-30 PDF 허용(서수란 접수 — 고객사 보관 파일 90%가 PDF) + 스캔 PDF 대비 10MB로 상향
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime)) cb(null, true);
    else cb(new Error('JPG, PNG, WebP 이미지 또는 PDF만 업로드 가능합니다.'));
  },
});
/** PDF 매직 바이트(%PDF) — 확장자·mimetype 위장 차단. 이미지 스니핑과 같은 원칙이다. */
const sniffPdf = (buf: Buffer): boolean => buf.length >= 4 && buf.toString('latin1', 0, 4) === '%PDF';
router.post('/biz-registration-extract', (req: Request, res: Response) => {
  bizRegUpload.single('image')(req as any, res as any, async (uploadErr: any) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, error: uploadErr.message || '파일 업로드 오류' });
    }
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ success: false, error: '사업자등록증 이미지 또는 PDF를 올려주세요.' });
      // 매직 바이트 검증 — 확장자·mimetype 위장 차단(event-image-extract 자산 재사용 + PDF 스니핑)
      const sniffed = sniffPdf(file.buffer) ? 'application/pdf' : sniffImageMediaType(file.buffer);
      if (!sniffed) return res.status(400).json({ success: false, error: '파일 형식을 확인할 수 없습니다. JPG/PNG/WebP 이미지나 PDF로 다시 올려주세요.' });
      const info = await extractBizRegistration({
        image: { media_type: sniffed, data: file.buffer.toString('base64') },
        adminId: (req as any).user?.userId || null,
      });
      return res.json({ success: true, info });
    } catch (error: any) {
      console.error('사업자등록증 판독 오류:', error?.message || error);
      return res.status(500).json({ success: false, error: error?.message || '사업자등록증 판독 실패' });
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 080 청구 (★2026-07-30 서수란 접수 — 번호↔회사 매핑 + KT 명세서 업로드 → 통화료 자동 귀속)
//   CT = utils/billing-080.ts. 금액은 전부 공급가(VAT는 청구서가 파생 — 0726 원칙).
// ════════════════════════════════════════════════════════════════

// GET /080-numbers — 매핑 목록 (회사명 조인)
router.get('/080-numbers', async (_req: Request, res: Response) => {
  try {
    const numbers = await list080Numbers();
    return res.json({ success: true, numbers: numbers.map((n) => ({ ...n, display_number: format080Number(n.number) })) });
  } catch (error: any) {
    console.error('080 번호 목록 오류:', error?.message || error);
    return res.status(500).json({ success: false, error: '080 번호 목록 조회 실패' });
  }
});

// POST /080-numbers — 등록/수정 (id 있으면 수정). 번호는 숫자만 저장·전사 유일.
router.post('/080-numbers', async (req: Request, res: Response) => {
  try {
    const { id, number, company_id, user_id, label, monthly_fee_supply, kt_fee_supply, charge_call_fee, is_active, memo } = req.body || {};
    const digits = normalize080Number(number);
    if (digits.length < 9) return res.status(400).json({ success: false, error: '080 번호를 정확히 입력해주세요.' });
    if (!company_id) return res.status(400).json({ success: false, error: '회사를 선택해주세요.' });
    // ★ 2026-07-31 귀속 축 — 비면 고객사 전체, 값이 있으면 그 계정. **그 회사 소속인지 여기서 검증한다**
    //   (남의 회사 계정 id를 넣으면 그 계정 장에 엉뚱한 청구가 붙는다).
    const scopeUserId = String(user_id || '').trim() || null;
    if (scopeUserId) {
      const own = await pool.query(
        `SELECT 1 FROM users WHERE id = $1::uuid AND company_id = $2::uuid`,
        [scopeUserId, company_id],
      );
      if (own.rows.length === 0) {
        return res.status(400).json({ success: false, error: '선택한 사용자가 그 고객사 소속이 아닙니다.' });
      }
    }
    const monthlyFee = Math.round(Number(monthly_fee_supply));
    const ktFee = Math.round(Number(kt_fee_supply));
    if (!Number.isFinite(monthlyFee) || monthlyFee < 0 || !Number.isFinite(ktFee) || ktFee < 0) {
      return res.status(400).json({ success: false, error: '이용료·부가서비스 금액(공급가)을 0 이상 정수로 입력해주세요.' });
    }
    const params = [
      digits, company_id, String(label || '').slice(0, 100) || null,
      monthlyFee, ktFee, charge_call_fee !== false, is_active !== false,
      String(memo || '').slice(0, 500) || null, scopeUserId,
    ];
    if (id) {
      // ★ 2026-08-04 **회사를 바꾸면 미소비 반영분도 함께 옮긴다**(서수란 0803 접수 3 — 리스킨).
      //   반영 항목의 회사 축은 스냅샷이 소유하므로, 매핑만 옮기면 옛 회사 청구서에 그대로 남는다.
      //   "인비토로 바꿨는데 계속 리스킨으로 청구된다"가 정확히 그 증상이었다.
      //   발행과 같은 회사 잠금을 **양쪽 다** 잡고, 어느 쪽이든 그 달 발행이 있으면 옮기지 않는다.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const prev = await client.query(
          `SELECT number, company_id FROM billing_080_numbers WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (prev.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, error: '수정할 번호를 찾을 수 없습니다.' });
        }
        const fromCompany = String(prev.rows[0].company_id);
        const fromNumber = String(prev.rows[0].number);
        // 번호 표기를 고친 경우에도 같이 옮긴다 — `source_ref`가 옛 번호로 남으면 그 반영분은 매핑을
        // 잃어버려(고아) 그 회사 발행이 통째로 막힌다.
        const relinked = fromCompany !== String(company_id) || fromNumber !== digits;
        // 잠금은 항상 같은 순서로 잡는다 — 두 요청이 서로를 기다리는 교착을 만들지 않는다.
        for (const cid of Array.from(new Set([fromCompany, String(company_id)])).sort()) {
          await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('billing'))`, [cid]);
        }
        let moved = 0;
        if (relinked) {
          // ★ 소비 여부를 가리지 않는다(Codex 2R high 수용) — 미소비 행만 보면 **이미 청구서에 실린**
          //   반영분이 옛 회사에 남는다. 그 청구서를 지우는 순간 FK가 그 행을 미소비로 되돌리는데
          //   매핑은 이미 옮겨져 있어 옛 회사 발행이 영구히 막히고, 새 회사 재반영도 전역 UNIQUE에 걸린다.
          const blocked = await client.query(
            `SELECT 1 FROM billings b
               JOIN billing_extra_items e
                 ON e.company_id = $1::uuid AND e.source_ref = $3
              WHERE b.company_id IN ($1::uuid, $2::uuid)
                AND b.billing_start <= (e.period_month + INTERVAL '1 month' - INTERVAL '1 day')::date
                AND b.billing_end >= e.period_month
              LIMIT 1`,
            [fromCompany, String(company_id), fromNumber],
          );
          if (blocked.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              success: false,
              error: '그 번호의 반영분이 걸린 달에 이미 발행된 정산이 있어 회사·번호를 바꿀 수 없습니다. 그 정산을 삭제하고 반영을 취소한 뒤 다시 시도해주세요.',
              code: 'BILLING_080_TRANSFER_BLOCKED',
            });
          }
          const mv = await client.query(
            `UPDATE billing_extra_items SET company_id = $2::uuid, source_ref = $4
              WHERE company_id = $1::uuid AND source_ref = $3 AND billed_billing_id IS NULL`,
            [fromCompany, String(company_id), fromNumber, digits],
          );
          moved = mv.rowCount || 0;
        }
        const r = await client.query(
          `UPDATE billing_080_numbers SET number=$1, company_id=$2, label=$3, monthly_fee_supply=$4,
                  kt_fee_supply=$5, charge_call_fee=$6, is_active=$7, memo=$8, user_id=$9::uuid, updated_at=NOW()
            WHERE id=$10 RETURNING id`,
          [...params, id],
        );
        await client.query('COMMIT');
        return res.json({ success: true, id: r.rows[0].id, moved_items: moved });
      } catch (txErr) {
        try { await client.query('ROLLBACK'); } catch { /* 아래 catch가 사실을 전달한다 */ }
        throw txErr;
      } finally {
        client.release();
      }
    }
    const r = await pool.query(
      `INSERT INTO billing_080_numbers (number, company_id, label, monthly_fee_supply, kt_fee_supply, charge_call_fee, is_active, memo, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid) RETURNING id`,
      params,
    );
    return res.json({ success: true, id: r.rows[0].id });
  } catch (error: any) {
    if (String(error?.code) === '23505') {
      // 번호 중복 등록이거나, 회사·번호를 옮길 때 대상 번호에 그 달 반영분이 이미 있는 경우다.
      return res.status(409).json({
        success: false,
        error: '이미 등록된 번호이거나, 옮기려는 번호에 그 달 반영분이 이미 있습니다. 목록에서 확인한 뒤 반영을 취소하고 다시 시도해주세요.',
      });
    }
    // ★ 2026-07-31 `user_id` ALTER 미실행 서버에서 500 대신 안내로 (db_alter_safety_net)
    const emsg080 = error?.message || '';
    if (emsg080.includes('does not exist') && (emsg080.includes('column') || emsg080.includes('relation'))) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — billing_080_numbers.user_id 컬럼 추가 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('080 번호 저장 오류:', emsg080 || error);
    return res.status(500).json({ success: false, error: '080 번호 저장 실패' });
  }
});

// DELETE /080-numbers/:id — 매핑 삭제. 반영된 항목(billing_extra_items)은 남는다(청구 근거 보존).
router.delete('/080-numbers/:id', async (req: Request, res: Response) => {
  try {
    const r = await pool.query(`DELETE FROM billing_080_numbers WHERE id = $1 RETURNING id`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '삭제할 번호를 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (error: any) {
    console.error('080 번호 삭제 오류:', error?.message || error);
    return res.status(500).json({ success: false, error: '080 번호 삭제 실패' });
  }
});

// POST /kt-statement/parse — KT 명세서 PDF/이미지 판독 (저장 0 — 결과는 화면 확인용)
//   검산 실패도 결과와 함께 돌려준다(valid=false) — 화면이 사유를 보여주고 [반영]만 막는다.
router.post('/kt-statement/parse', (req: Request, res: Response) => {
  bizRegUpload.single('image')(req as any, res as any, async (uploadErr: any) => {
    if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message || '파일 업로드 오류' });
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ success: false, error: 'KT 명세서 PDF 또는 이미지를 올려주세요.' });
      const sniffed = sniffPdf(file.buffer) ? 'application/pdf' : sniffImageMediaType(file.buffer);
      if (!sniffed) return res.status(400).json({ success: false, error: '파일 형식을 확인할 수 없습니다. PDF나 JPG/PNG로 다시 올려주세요.' });
      const parsed = await extractKtStatement({
        image: { media_type: sniffed, data: file.buffer.toString('base64') },
        adminId: (req as any).user?.userId || null,
      });
      const validation = validateKtStatement(parsed);
      const rows = await reconcileKtStatement(parsed.entries);
      return res.json({
        success: true,
        usage_period: parsed.usage_period,
        count_080: parsed.count_080,
        total_080: parsed.total_080,
        valid: validation.ok,
        validation_errors: validation.errors,
        rows,
        // ★ 판독 결과 전문 + 서버 서명 — [반영]이 이걸 그대로 되보내고 서버가 서명·검산을 다시 확인한다.
        //   서명은 **검산 통과 결과에만** 발급한다(Codex 3R — 무효 전문에 서명을 주면 NaN→null→0 왕복으로
        //   "판독 불가 통화료"가 0원으로 반영될 길이 열린다). 서명 없음 = 반영 불가.
        entries: parsed.entries,
        signature: validation.ok ? signKtStatement(parsed) : null,
      });
    } catch (error: any) {
      console.error('KT 명세서 판독 오류:', error?.message || error);
      return res.status(500).json({ success: false, error: error?.message || 'KT 명세서 판독 실패' });
    }
  });
});

// POST /kt-statement/apply — 판독 결과 확정 반영 → billing_extra_items 생성.
//   ★ 입력 = 판독 결과 전문(statement) — CT가 검산을 서버에서 다시 실행한다(클라이언트 금액 신뢰 금지 — Codex 1R).
router.post('/kt-statement/apply', async (req: Request, res: Response) => {
  try {
    const { period_month, statement, signature } = req.body || {};
    if (!statement || !Array.isArray(statement.entries) || statement.entries.length === 0) {
      return res.status(400).json({ success: false, error: '반영할 판독 결과가 없습니다. 명세서를 다시 판독해주세요.' });
    }
    const result = await applyKtStatement({
      periodMonth: String(period_month || ''),
      statement,
      signature: String(signature || ''),
      adminId: (req as any).user?.userId || null,
    });
    return res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('KT 명세서 반영 오류:', error?.message || error);
    return res.status(400).json({ success: false, error: error?.message || 'KT 명세서 반영 실패' });
  }
});

// GET /extra-items?month=YYYY-MM — 그 달 반영 현황 (회사별)
//   ★ 2026-08-04 매핑 원장을 함께 읽어 **실제로 청구될 금액**을 발행과 같은 함수로 계산해 내린다.
//     그전에는 스냅샷 금액(`supply_amount`)을 그대로 보여줬는데, 매핑을 고쳐도 그 값이 안 바뀌어
//     화면이 옛 금액을 사실인 것처럼 보여줬다(서수란 0803 접수의 화면 쪽 얼굴).
router.get('/extra-items', async (req: Request, res: Response) => {
  try {
    const month = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ success: false, error: '조회 월 형식: YYYY-MM' });
    const r = await pool.query(
      `SELECT e.id, e.company_id, c.company_name, e.kind, e.label, e.supply_amount, e.source_ref, e.created_at,
              e.billed_billing_id, e.period_month,
              eu.name AS user_name, eu.login_id AS user_login_id,
              enu.name AS map_user_name, enu.login_id AS map_user_login_id,
${EXTRA_ITEM_SOURCE_SELECT}
         FROM billing_extra_items e
         JOIN companies c ON c.id = e.company_id
${EXTRA_ITEM_SOURCE_JOIN}
        WHERE e.period_month = ($1 || '-01')::date
        ORDER BY c.company_name, e.source_ref, e.kind`,
      [month],
    );
    // 행마다 파생 항목(이용료·부가서비스·통화료)을 CT로 계산 — 청구서에 실릴 모습 그대로다.
    const items = r.rows.map((row: any) => {
      const kind = String(row.kind);
      const parts = buildExtraBillingItems([row]);
      const billed = !!row.billed_billing_id;
      return {
        ...row,
        // 귀속은 080이면 매핑 원장, 수기 항목이면 자기 값 — 발행의 장 분배와 같은 판정.
        sheet_user_id: extraRowUserId(row),
        sheet_user_name: kind === 'manual' ? row.user_name : row.map_user_name,
        sheet_user_login_id: kind === 'manual' ? row.user_login_id : row.map_user_login_id,
        // 항목명은 청구서 항목줄과 **같은 함수**에서 온다 — 화면과 인쇄물의 이름이 갈라지지 않는다.
        //   ★ 2026-08-04 이미 발행에 실린 행은 파생값을 보여주지 않는다(Codex 적대검증 수용) — 청구서는
        //   `billing_items`에 굳어 있는데 원장을 고치면 화면 숫자만 바뀌어 "발행액이 바뀐 것처럼" 읽힌다.
        billable_parts: billed ? [] : parts.map((p) => ({ type_key: p.typeKey, label: invoiceLineLabel('extra', p.typeKey), amount: p.amount })),
        billable_supply: billed ? null : parts.reduce((s, p) => s + p.amount, 0),
        // 매핑이 사라진 현행 스냅샷 = 그 회사 발행이 막힌다(BILLING_080_MAPPING_MISSING).
        blocks_issue: kind === '080_call' && !row.map_found,
        // 비활성 = 사람이 명시한 청구 중단. 매핑 없음과 다른 상태다.
        inactive: !!row.map_found && row.map_is_active === false,
        // ★ 2026-08-05 매핑이 다른 회사로 옮겨졌다 = 이 회사 청구가 아니다(옛 종류 행 포함).
        //   조용히 빼면 담당자는 "왜 안 청구되지"를 알 수 없다 — 상태로 드러낸다.
        moved_to_other_company: kind !== 'manual' && !!row.map_exists_any && !row.map_found,
        // 옛 `080_fee`·`080_svc` 행 중 현행 스냅샷과 겹쳐 청구되지 않는 것(정리 대상).
        legacy_superseded: kind !== 'manual' && kind !== '080_call' && !!row.has_call_snapshot,
      };
    });
    return res.json({ success: true, items });
  } catch (error: any) {
    console.error('추가 항목 조회 오류:', error?.message || error);
    return res.status(500).json({ success: false, error: '추가 항목 조회 실패' });
  }
});

// DELETE /extra-items?month=YYYY-MM&company_id=&kind=kt|manual — 반영 취소 (회사 단위·발행 전만).
//   ★ 단일 트랜잭션 + 발행과 같은 회사 잠금 + DELETE 조건에 미소비(billed_billing_id IS NULL) —
//     발행과 경합해도 소비된 근거 행은 구조적으로 지워지지 않는다(Codex 1R 수용). 발행 존재 조회는 안내용이다.
//   ★ 2026-08-04 `kind` 필수. 그전에는 그 회사·그 달의 **미소비 전 항목**을 지워서, KT 반영을 되돌리면
//     사람이 손으로 입력한 부가서비스까지 함께 사라졌다(시세이도 단축 URL 25행 = 125만원 규모).
//     범위를 안 주면 지우지 않는다(fail-closed).
router.delete('/extra-items', async (req: Request, res: Response) => {
  const month = String(req.query.month || '');
  const companyId = String(req.query.company_id || '');
  const kind = String(req.query.kind || '');
  if (!/^\d{4}-\d{2}$/.test(month) || !companyId) {
    return res.status(400).json({ success: false, error: 'month(YYYY-MM)와 company_id가 필요합니다.' });
  }
  if (kind !== 'kt' && kind !== 'manual') {
    return res.status(400).json({ success: false, error: '취소 범위(kind=kt 또는 manual)가 필요합니다.' });
  }
  // 리터럴 분기 — `kt`는 옛 080_fee·080_svc 잔존 행까지 함께 정리해야 해서 접두 매칭이다.
  const kindClause = kind === 'kt' ? `kind LIKE '080\\_%'` : `kind = 'manual'`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('billing'))`, [companyId]);
    const billed = await client.query(
      `SELECT id FROM billings WHERE company_id = $1
         AND billing_start <= (($2 || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date
         AND billing_end >= ($2 || '-01')::date LIMIT 1`,
      [companyId, month],
    );
    if (billed.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: '그 달 정산이 이미 발행돼 있어 취소할 수 없습니다. 발행 삭제 후 취소해주세요(발행 삭제 시 항목은 자동으로 미소비로 돌아옵니다).' });
    }
    const r = await client.query(
      `DELETE FROM billing_extra_items
        WHERE company_id = $1 AND period_month = ($2 || '-01')::date AND billed_billing_id IS NULL
          AND ${kindClause}`,
      [companyId, month],
    );
    await client.query('COMMIT');
    return res.json({ success: true, deleted: r.rowCount || 0 });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch { /* release가 파기 */ }
    console.error('추가 항목 취소 오류:', error?.message || error);
    return res.status(500).json({ success: false, error: '추가 항목 취소 실패' });
  } finally {
    client.release();
  }
});

// POST /extra-items — 부가서비스 수기 항목 추가 (★2026-07-30 Harold 확정 — 시세이도 URL 장당 5만 등)
router.post('/extra-items', async (req: Request, res: Response) => {
  try {
    const { company_id, user_id, month, label, unit_supply, qty } = req.body || {};
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {
      return res.status(400).json({ success: false, error: '대상월 형식: YYYY-MM' });
    }
    // ★ 2026-07-31 귀속 계정 — 080 매핑과 같은 축·같은 검증(남의 회사 계정 차단).
    const extraUserId = String(user_id || '').trim() || null;
    if (extraUserId) {
      const own = await pool.query(
        `SELECT 1 FROM users WHERE id = $1::uuid AND company_id = $2::uuid`,
        [extraUserId, String(company_id || '')],
      );
      if (own.rows.length === 0) {
        return res.status(400).json({ success: false, error: '선택한 사용자가 그 고객사 소속이 아닙니다.' });
      }
    }
    const result = await addManualExtraItems({
      companyId: String(company_id || ''),
      userId: extraUserId,
      periodMonth: `${month}-01`,
      label: String(label || ''),
      unitSupply: unit_supply,
      qty,
      adminId: (req as any).user?.userId || null,
    });
    return res.json({ success: true, ...result });
  } catch (error: any) {
    // ★ 2026-07-31 `user_id` ALTER 미실행 서버에서 사람이 고칠 수 없는 오류를 400으로 흘리지 않는다.
    const emsgX = error?.message || '';
    if (emsgX.includes('does not exist') && (emsgX.includes('column') || emsgX.includes('relation'))) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — billing_extra_items.user_id 컬럼 추가 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('부가서비스 항목 추가 오류:', emsgX || error);
    return res.status(400).json({ success: false, error: emsgX || '항목 추가 실패' });
  }
});

// DELETE /extra-items/:id — 항목 개별 삭제 (미소비만 — 발행에 실린 행은 발행 삭제로만 복귀)
router.delete('/extra-items/:id', async (req: Request, res: Response) => {
  try {
    const ok = await deleteExtraItem(String(req.params.id));
    if (!ok) return res.status(409).json({ success: false, error: '이미 발행에 실렸거나 없는 항목입니다. 발행에 실린 항목은 발행 삭제 시 자동으로 되돌아옵니다.' });
    return res.json({ success: true });
  } catch (error: any) {
    console.error('부가서비스 항목 삭제 오류:', error?.message || error);
    return res.status(500).json({ success: false, error: '항목 삭제 실패' });
  }
});

// ════════════════════════════════════════════════════════════════
// 수량 수정 발행 (★2026-08-04 서수란 접수 — 업체와 수량이 다를 때 사람이 조정해 다시 내보낸다)
//   CT = utils/billing-qty-adjust.ts. 조정 축은 회사×기간이라 삭제·재발행에도 살아남는다.
// ════════════════════════════════════════════════════════════════

/**
 * 그 정산의 회사·기간·장 계정을 읽는다 — 조정 축이 발행이 아니라 기간이라 매번 이 변환이 필요하다.
 * `user_id`는 그 **장**의 계정이다. 계정별 발행 회사는 장마다 수량이 다르므로 조정도 장 단위로 붙는다.
 */
async function loadBillingPeriod(billingId: string) {
  const r = await pool.query(
    `SELECT company_id, user_id, to_char(billing_start, 'YYYY-MM-DD') AS billing_start,
            to_char(billing_end, 'YYYY-MM-DD') AS billing_end, scope
       FROM billings WHERE id = $1::uuid`,
    [billingId],
  );
  return r.rows[0] || null;
}

// GET /:id/qty-adjustments — 그 장의 청구 줄 + 거기 걸린 조정
//   ★ 화면은 "실제 수량"을 입력하고 델타는 서버가 준 `base`로 계산한다 — 사람에게 −3을 계산시키지 않는다.
//   `base` = 조정을 빼기 전 원래 수량. 이미 조정이 반영된 청구서에서 또 조정할 때 이중 적용을 막는 값이다.
router.get('/:id/qty-adjustments', async (req: Request, res: Response) => {
  try {
    const bil = await loadBillingPeriod(String(req.params.id));
    if (!bil) return res.status(404).json({ success: false, error: '정산을 찾을 수 없습니다.' });
    // ★ 2026-08-04 "이 청구서가 얼마를 실었는가"는 **발행이 적어 둔 `applied_delta`**가 답한다.
    //   시각 비교(`billings.created_at > 조정.updated_at`)는 조정을 수정하는 순간 이미 실린 델타까지
    //   미적용으로 뒤집혀 base가 통째로 어긋났다(Codex 재검증 high). 추론을 버리고 기록을 읽는다.
    const r = await pool.query(
      `SELECT a.*, u.name AS user_name, u.login_id AS user_login_id
         FROM billing_qty_adjustments a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.company_id = $1::uuid AND a.period_start = $2::date AND a.period_end = $3::date
          AND a.user_id IS NOT DISTINCT FROM $4::uuid
        ORDER BY a.channel, a.type_key`,
      [bil.company_id, bil.billing_start, bil.billing_end, bil.user_id],
    );
    // 항목줄은 청구서·PDF와 **같은 함수**로 만든다 — 화면이 따로 묶으면 표시 수량이 인쇄물과 갈라진다.
    const itemRows = await pool.query(
      `SELECT * FROM billing_items WHERE billing_id = $1::uuid
        ORDER BY channel ASC, item_date ASC, message_type ASC, id ASC`,
      [req.params.id],
    );
    // 저장된 델타(표시용)와 **이 청구서에 실제로 실린 델타**(base 계산용)를 나눠 센다.
    const deltaByKey = new Map<string, number>();
    const appliedByKey = new Map<string, number>();
    for (const a of r.rows) {
      const k = `${a.channel} ${a.type_key}`;
      const d = Number(a.qty_delta) || 0;
      deltaByKey.set(k, (deltaByKey.get(k) || 0) + d);
      appliedByKey.set(k, (appliedByKey.get(k) || 0) + (Number(a.applied_delta) || 0));
    }
    const rawLines = buildInvoiceLines(itemRows.rows)
      // 요금제·추가 항목은 수량 축이 없다 — 조정 대상이 아니다.
      .filter((l) => l.channel !== 'plan' && l.channel !== 'extra');
    // ★ 같은 (채널·유형)에 단가가 여러 개면 조정 키가 어느 줄을 가리키는지 정해지지 않는다
    //   (발송ID별 단가가 다른 에이전트가 그렇다). 그런 유형은 조정 대상에서 뺀다 — fail-closed.
    const priceCount = new Map<string, Set<number>>();
    for (const l of rawLines) {
      const k = `${l.channel} ${l.typeKey}`;
      if (!priceCount.has(k)) priceCount.set(k, new Set());
      priceCount.get(k)!.add(l.unitPrice);
    }
    const lines = rawLines.map((l) => {
      const k = `${l.channel} ${l.typeKey}`;
      const delta = deltaByKey.get(k) || 0;
      const applied = appliedByKey.get(k) || 0;
      const multiPrice = (priceCount.get(k)?.size || 1) > 1;
      return {
        channel: l.channel, type_key: l.typeKey, label: l.label,
        unit_price: l.unitPrice, count: l.count, amount: l.amount,
        delta, base: l.count - applied,
        adjustable: !multiPrice,
        not_adjustable_reason: multiPrice ? '같은 유형에 단가가 여러 개입니다(발송ID별 단가) — 화면에서 조정할 수 없습니다' : null,
      };
    });
    return res.json({
      success: true,
      // 재발행은 삭제 뒤에 회사·기간·발행 단위를 다시 넘겨야 한다 — 삭제 응답에는 그 값이 없으므로 여기서 준다.
      company_id: bil.company_id,
      // `billings.scope`는 **장**의 축(combined·by_user·common)이고 발행 단위는 둘뿐이다.
      // 공통 장은 계정별 발행에서만 생기므로 재발행 단위는 by_user다.
      issue_scope: String(bil.scope) === 'combined' ? 'combined' : 'by_user',
      period: { start: bil.billing_start, end: bil.billing_end },
      sheet_user_id: bil.user_id || null,
      adjustments: r.rows,
      lines,
    });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — billing_qty_adjustments 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('수량 조정 조회 오류:', emsg || error);
    return res.status(500).json({ success: false, error: '수량 조정 조회 실패' });
  }
});

// POST /:id/qty-adjustments — 조정 등록·갱신(같은 축은 UPSERT). 발행 전/후 아무 때나 넣을 수 있고,
//   실제 반영은 발행이 한다. `reason`은 필수 — 왜 고쳤는지가 없으면 다음 달에 아무도 모른다.
router.post('/:id/qty-adjustments', async (req: Request, res: Response) => {
  try {
    const bil = await loadBillingPeriod(String(req.params.id));
    if (!bil) return res.status(404).json({ success: false, error: '정산을 찾을 수 없습니다.' });
    // ★ 귀속 계정은 **그 장**의 것을 그대로 쓴다 — 화면이 따로 고르게 하면 장과 조정이 어긋난다.
    const { channel, type_key, qty_delta, reason, agent_id } = req.body || {};
    const ch = String(channel || '').trim();
    const tk = String(type_key || '').trim();
    const delta = Math.round(Number(qty_delta));
    const why = String(reason || '').trim().slice(0, 1000);
    if (!ch || !tk) return res.status(400).json({ success: false, error: '채널과 유형을 지정해주세요.' });
    if (!Number.isSafeInteger(delta) || delta === 0) {
      return res.status(400).json({ success: false, error: '조정 수량은 0이 아닌 정수로 입력해주세요(줄이려면 음수).' });
    }
    if (why.length < 2) return res.status(400).json({ success: false, error: '조정 사유를 입력해주세요.' });
    // ★ 2026-08-04 단가가 여러 개인 유형은 조정 키가 어느 줄을 가리키는지 정해지지 않는다 — 화면 판정과
    //   같은 검사를 서버가 다시 한다(화면만 막으면 API 직접 호출로 뚫린다).
    const priceRows = await pool.query(
      `SELECT DISTINCT unit_price FROM billing_items
        WHERE billing_id = $1::uuid AND channel = $2 AND message_type = $3`,
      [req.params.id, ch, tk],
    );
    if (priceRows.rows.length > 1) {
      return res.status(422).json({
        success: false,
        error: '이 유형은 발송ID별로 단가가 달라 화면에서 수량을 조정할 수 없습니다. 발송ID 단위 조정이 필요하면 알려주세요.',
        code: 'BILLING_QTY_ADJUST_MULTI_PRICE',
      });
    }
    if (priceRows.rows.length === 0) {
      return res.status(422).json({ success: false, error: '그 유형의 청구 항목이 이 정산에 없습니다.', code: 'BILLING_QTY_ADJUST_UNMATCHED' });
    }
    const scopeUserId = bil.user_id ? String(bil.user_id) : null;
    const r = await pool.query(
      `INSERT INTO billing_qty_adjustments
         (company_id, period_start, period_end, channel, type_key, user_id, agent_id, qty_delta, reason, created_by)
       VALUES ($1::uuid, $2::date, $3::date, $4, $5, $6::uuid, $7::uuid, $8, $9, $10)
       ON CONFLICT (company_id, period_start, period_end, channel, type_key,
                    COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET qty_delta = EXCLUDED.qty_delta, reason = EXCLUDED.reason,
                     created_by = EXCLUDED.created_by, updated_at = now()
       RETURNING id`,
      [bil.company_id, bil.billing_start, bil.billing_end, ch, tk, scopeUserId,
        String(agent_id || '').trim() || null, delta, why, (req as any).user?.userId || null],
    );
    return res.json({ success: true, id: r.rows[0].id });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('does not exist') && (emsg.includes('relation') || emsg.includes('column'))) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — billing_qty_adjustments 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('수량 조정 저장 오류:', emsg || error);
    return res.status(500).json({ success: false, error: '수량 조정 저장 실패' });
  }
});

// DELETE /qty-adjustments/:adjId — 조정 삭제. 발행에 이미 반영됐으면 그 발행을 다시 내야 되돌아간다.
router.delete('/qty-adjustments/:adjId', async (req: Request, res: Response) => {
  try {
    const r = await pool.query(`DELETE FROM billing_qty_adjustments WHERE id = $1::uuid RETURNING id`, [req.params.adjId]);
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '삭제할 조정을 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (error: any) {
    console.error('수량 조정 삭제 오류:', error?.message || error);
    return res.status(500).json({ success: false, error: '수량 조정 삭제 실패' });
  }
});

// ════════════════════════════════════════════════════════════════
// 최소과금 (★2026-07-30 Harold 확정 — 금액이 안 나오는 업체 = 기본요금 정액 발행·일괄발급 담기 제외)
// ════════════════════════════════════════════════════════════════

// GET /minimum-charge?month=YYYY-MM — 등록 회사 목록 + 그 달 발행 여부
router.get('/minimum-charge', async (req: Request, res: Response) => {
  try {
    const month = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ success: false, error: '조회 월 형식: YYYY-MM' });
    const r = await pool.query(
      `SELECT s.company_id, c.company_name, s.min_charge_supply,
              (SELECT b.id FROM billings b
                WHERE b.company_id = s.company_id
                  AND b.billing_start <= (($1 || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date
                  AND b.billing_end >= ($1 || '-01')::date
                LIMIT 1) AS billed_id
         FROM company_billing_settings s
         JOIN companies c ON c.id = s.company_id
        WHERE s.min_charge_supply IS NOT NULL
        ORDER BY c.company_name`,
      [month],
    );
    return res.json({ success: true, companies: r.rows });
  } catch (error: any) {
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션이 필요합니다. 운영자에게 company_billing_settings 컬럼 추가(ALTER)를 요청해주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('최소과금 목록 오류:', msg || error);
    return res.status(500).json({ success: false, error: '최소과금 목록 조회 실패' });
  }
});

// POST /minimum-charge — 등록/수정/해제 (min_charge_supply null = 해제). UPSERT는 이 컬럼만 만진다.
router.post('/minimum-charge', async (req: Request, res: Response) => {
  try {
    const { company_id, min_charge_supply } = req.body || {};
    if (!company_id) return res.status(400).json({ success: false, error: '회사를 선택해주세요.' });
    let value: number | null = null;
    if (min_charge_supply !== null && min_charge_supply !== undefined) {
      if (!(typeof min_charge_supply === 'number' && Number.isSafeInteger(min_charge_supply)) || min_charge_supply <= 0) {
        return res.status(400).json({ success: false, error: '최소과금(공급가)을 1원 이상 정수로 입력해주세요.' });
      }
      value = min_charge_supply;
    }
    await pool.query(
      `INSERT INTO company_billing_settings (company_id, min_charge_supply, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (company_id) DO UPDATE SET min_charge_supply = EXCLUDED.min_charge_supply, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [company_id, value, (req as any).user?.userId || null],
    );
    return res.json({ success: true });
  } catch (error: any) {
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션이 필요합니다. 운영자에게 company_billing_settings 컬럼 추가(ALTER)를 요청해주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('최소과금 저장 오류:', msg || error);
    return res.status(500).json({ success: false, error: '최소과금 저장 실패' });
  }
});

// POST /minimum-charge/issue — 등록 회사 전부 그 달 정액 발행 (회사별 독립 — 부분 실패 허용)
router.post('/minimum-charge/issue', async (req: Request, res: Response) => {
  try {
    const month = String((req.body || {}).month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ success: false, error: '대상월 형식: YYYY-MM' });
    const start = `${month}-01`;
    const endRes = await pool.query(`SELECT (($1 || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date::text AS d`, [month]);
    const end = String(endRes.rows[0].d);
    const list = await pool.query(
      `SELECT s.company_id, c.company_name FROM company_billing_settings s
         JOIN companies c ON c.id = s.company_id
        WHERE s.min_charge_supply IS NOT NULL ORDER BY c.company_name`,
    );
    const issued: any[] = [];
    const skipped: any[] = [];
    for (const row of list.rows) {
      try {
        const r = await issueMinimumChargeBilling({
          company_id: row.company_id, billing_start: start, billing_end: end,
          adminId: (req as any).user?.userId || null,
        });
        issued.push({ company_id: row.company_id, company_name: row.company_name, total_amount: r.billing.total_amount });
      } catch (e: any) {
        skipped.push({
          company_id: row.company_id, company_name: row.company_name,
          reason: e instanceof BillingIssueError ? String(e.body?.error || e.message) : String(e?.message || e).slice(0, 200),
        });
      }
    }
    return res.json({ success: true, issued, skipped });
  } catch (error: any) {
    console.error('최소과금 일괄 발행 오류:', error?.message || error);
    return res.status(500).json({ success: false, error: '최소과금 발행 실패' });
  }
});

// GET /agent-price-gaps - 단가가 비어 있는 에이전트 발송ID 목록
//   ★ 2026-07-26 신설. 발송ID 단가가 비면 그 회사 발행이 422로 막히는데, 어디가 빈지 알 방법이
//   "회사를 하나씩 발행해 본다"뿐이었다. 실측(2026-07-26) 283개 발송ID 단가가 전부 미설정이라
//   마감일에 그걸 하나씩 찾아다니게 된다.
//   선불 발송ID는 청구 대상이 아니므로 제외한다.
router.get('/agent-price-gaps', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT c.id AS company_id, c.company_name, c.usage_type,
              cai.agent_send_id,
              cai.cost_per_sms IS NULL AS sms_unset,
              cai.cost_per_lms IS NULL AS lms_unset,
              cai.cost_per_mms IS NULL AS mms_unset,
              cai.cost_per_kakao IS NULL AS kakao_unset,
              cai.cost_per_brand IS NULL AS brand_unset
         FROM company_agent_ids cai
         JOIN companies c ON c.id = cai.company_id
        WHERE cai.billing_type = 'postpaid'
          AND (cai.cost_per_sms IS NULL OR cai.cost_per_lms IS NULL
               OR cai.cost_per_mms IS NULL OR cai.cost_per_kakao IS NULL
               OR cai.cost_per_brand IS NULL)
        ORDER BY c.company_name, cai.agent_send_id`,
    );

    const byCompany = new Map<string, any>();
    for (const r of result.rows as any[]) {
      const key = String(r.company_id);
      if (!byCompany.has(key)) {
        byCompany.set(key, {
          company_id: key, company_name: r.company_name, usage_type: r.usage_type, send_ids: [],
        });
      }
      byCompany.get(key).send_ids.push({
        agent_send_id: r.agent_send_id,
        unset: [
          r.sms_unset ? 'SMS' : '', r.lms_unset ? 'LMS' : '',
          r.mms_unset ? 'MMS' : '', r.kakao_unset ? 'KAKAO' : '',
          r.brand_unset ? 'BRAND' : '',
        ].filter(Boolean),
      });
    }
    const companies = Array.from(byCompany.values());
    return res.json({
      companies,
      company_count: companies.length,
      send_id_count: result.rows.length,
    });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('column') && emsg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — company_agent_ids.billing_type·cost_per_* 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('에이전트 단가 공백 조회 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  정산 파라미터 라우트 (/:id — 리터럴 라우트 뒤에 배치)
// ============================================================

// GET /:id/items - 정산 일자별 상세
router.get('/:id/items', async (req: Request, res: Response) => {
  try {
    const billing = await pool.query(
      `SELECT b.*, c.company_name, u.name as user_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (billing.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }

    const items = await pool.query(
      // ★ 2026-07-26 정렬에 channel·발송ID 추가. 축이 계정·발송ID로 쪼개지면서 같은 날 같은 유형 행이
      //   여러 줄 생기는데 tie-breaker가 없어 순서가 비결정적이었다(D150-4와 같은 계열).
      // ★ 2026-07-26 발송ID 병기 — 에이전트 행이 어느 발송ID 것인지가 정산 대조의 근거다.
      //   JOIN 대상(`company_agent_ids.id`)·FK(`billing_items_agent_id_fkey`)는 pg_constraint 실측 확인분.
      // ★ 2026-07-31 계정명 병기(서수란 접수) — PDF와 같은 조인. 구분 칸이 웹 행에 늘 '한줄로'만 찍어
      //   한 회사 안에서 어느 계정(지점)이 쓴 발송인지 청구서·화면 어디서도 구분할 수 없었다.
      `SELECT bi.*, cai.agent_send_id, u.name AS user_name, u.login_id AS user_login_id
         FROM billing_items bi
         LEFT JOIN company_agent_ids cai ON cai.id = bi.agent_id
         LEFT JOIN users u ON u.id = bi.user_id
        WHERE bi.billing_id = $1
        ORDER BY bi.channel ASC, bi.item_date ASC, bi.message_type ASC,
                 cai.agent_send_id ASC NULLS FIRST, bi.user_id ASC NULLS FIRST, bi.id ASC`,
      [req.params.id]
    );

    // ★ 2026-07-26 항목 줄을 서버가 함께 내린다. 화면이 따로 합산하면 그 값이 청구서와 갈릴 수 있고,
    //   "화면 금액 ≠ 청구서 금액"은 정산에서 가장 나쁜 부류다. PDF·이메일과 같은 함수를 쓴다.
    const lines = buildInvoiceLines(items.rows);
    const headerCheck = checkInvoiceLinesAgainstHeader(
      lines, Number(billing.rows[0]?.ai_credit_supply) || 0, Number(billing.rows[0]?.subtotal) || 0,
    );

    // ★ 2026-07-26 날짜를 문자열로 내린다(Codex 3차 MEDIUM 수용).
    //   PG `date`는 드라이버가 **로컬 자정 Date**로 주고, JSON 직렬화는 그걸 UTC ISO로 바꾼다.
    //   그래서 화면(`String(item.item_date).slice(5,10)`)에 하루 앞선 날짜가 찍혔다 —
    //   집계·PDF는 `toDayKey`로 고쳤는데 이 응답만 원본 Date를 그대로 흘려보내고 있었다.
    //   같은 이유로 헤더의 청구 기간도 함께 내린다(모달·엑셀 파일명이 이 값을 쓴다).
    const bil = billing.rows[0];
    // ★ 2026-07-27 발급명 병기 — 상세 모달의 '구분' 칸이 발송ID만 보여주면 어느 계정인지 사람이 못 읽는다.
    //   이름 소스는 게이트웨이 원장 하나(RSRM_SalesMst.CustNm). 조회 실패해도 발송ID는 그대로 나온다.
    const custNameMap = await getAgentCustNameMap();
    return res.json({
      billing: {
        ...bil,
        billing_start: toDayKey(bil.billing_start),
        billing_end: toDayKey(bil.billing_end),
      },
      items: items.rows.map((r: any) => {
        const cust_name = r.agent_send_id ? custNameMap.get(String(r.agent_send_id)) || null : null;
        // ★ 2026-07-31 구분 칸을 **서버가 확정해서 내린다** — 화면이 자기 판정을 또 두면 청구서와 갈린다
        //   (실제로 갈려 있었다: 발급명은 화면에만, `extra` 행은 화면에서 원문 노출).
        return {
          ...r,
          item_date: toDayKey(r.item_date),
          cust_name,
          scope_label: resolveBillingScopeLabel({ ...r, cust_name }),
        };
      }),
      lines,
      header_check: headerCheck,
    });
  } catch (error: any) {
    console.error('정산 상세 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /:id/status - 정산 상태 변경
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['draft', 'confirmed', 'paid'].includes(status)) {
      return res.status(400).json({ error: '유효한 상태: draft, confirmed, paid' });
    }
    const result = await pool.query(
      `UPDATE billings SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('정산 상태 변경 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /:id - 정산 삭제
//   ★ 2026-08-04 핸들러를 이름 있는 함수로 뺐다(동작 무변경) — 수정 재발행이 **같은 삭제 문**을 쓴다.
//   화면에서 [삭제]와 [발행]을 두 번 호출하던 것이 결함이었다: 사이에 무엇이든 실패하면 정산이
//   삭제된 채 남는다(Codex 적대검증 critical). 한 요청 안에서 삭제하고 곧바로 다시 발행한다.
const handleBillingDelete = async (req: Request, res: Response) => {
  const reissue = (req.body || {}).__reissue === true;
  const client = await pool.connect();
  try {
    // ★ 2026-07-25 삭제와 후불 크레딧 billed 되돌림을 한 트랜잭션으로.
    //   billed_invoice_id는 FK가 아니라 정산이 지워져도 billed=true가 그대로 남는다.
    //   화면은 기간 겹침 409에서 "삭제 후 재생성"을 안내하는데, 그대로 두면 재생성 시
    //   `billed = false` 필터에 걸려 그 충전분이 영구히 청구되지 않는다(정상 운영 동작에서 돈이 샌다).
    await client.query('BEGIN');

    // 1) 대상 식별 — **여기서는 잠그지 않는다.**
    //   ★ 2026-07-26 개별 행을 먼저 잠그고 그 다음 묶음 전체를 잠그면, 같은 묶음의 서로 다른 장을
    //   동시에 지울 때 A가 1번 장을, B가 2번 장을 쥔 채 서로의 행을 기다려 데드락이 된다(Codex 3차 MEDIUM).
    //   묶음 축(회사·기간·batch_id)만 읽고, 잠금은 아래에서 **한 문장·id 순서로 한 번만** 잡는다.
    const check = await client.query(
      `SELECT id, status, emailed_at, email_sent_at, batch_id, company_id, billing_start, billing_end, scope
         FROM billings WHERE id = $1::uuid`,
      [req.params.id],
    );
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }

    const target = check.rows[0];


    // 2) 삭제 대상 묶음을 **한 문장으로, id 순서로** 잠근다.
    //   ★ 2026-07-26 CRITICAL 정정 — 그 전에는 `batch_id`만으로 형제를 찾았다.
    //   `batch_id`는 발행이 만드는 UUID라 지금 다른 회사와 충돌할 일은 없지만,
    //   **다른 회사의 청구서를 지울 수 있는 SQL이 돈 경로에 남아 있는 것 자체**가 결함이다.
    //   회사·기간을 함께 걸면 그 구조가 사라진다(묶음은 정의상 한 회사·한 기간이다).
    //   ★ 정렬 고정 = 데드락 회피. PG는 Sort 위에서 LockRows를 돌려 정렬된 순서로 잠근다.
    const batchSql = `SELECT id, status, emailed_at, email_sent_at FROM billings
                       WHERE batch_id = $1::uuid AND company_id = $2::uuid
                         AND billing_start = $3::date AND billing_end = $4::date
                       ORDER BY id FOR UPDATE`;
    const singleSql = `SELECT id, status, emailed_at, email_sent_at FROM billings
                        WHERE id = $1::uuid ORDER BY id FOR UPDATE`;
    // 날짜는 `toDayKey`로 내린다 — Date를 그대로 넘기면 드라이버가 오프셋 포함 문자열로 보내고
    // 세션 TZ(Etc/UTC)의 `::date` 캐스트가 하루 앞으로 밀어 형제 조회가 0행이 된다.
    const targetsRes = await client.query(
      target.batch_id ? batchSql : singleSql,
      target.batch_id
        ? [target.batch_id, target.company_id, toDayKey(target.billing_start), toDayKey(target.billing_end)]
        : [req.params.id],
    );
    if (targetsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }

    // 3) 상태 판정은 **잠근 뒤** 그 행들로만 한다.
    //   ★ 2026-07-26 HIGH 정정 — 그 전에는 형제 상태 집계가 잠금 전에 돌아서,
    //   집계와 잠금 사이에 형제가 confirmed로 바뀌거나 메일이 나가면 그걸 못 보고 그냥 지웠다.
    const locked = targetsRes.rows as any[];
    // 잠금을 기다리는 동안 대상 자체가 지워졌으면 그대로 끝낸다 — 형제만 남은 상태로 지우면 안 된다.
    if (!locked.some((r) => String(r.id) === String(req.params.id))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    const isIssued = locked.some((r) => String(r.status) !== 'draft');
    const isEmailed = locked.some((r) => r.emailed_at || r.email_sent_at);
    const issuedStatuses = Array.from(new Set(locked.map((r) => String(r.status)))).join(',');

    // ★ 2026-07-26 상태 가드. 그 전에는 확정(confirmed)·수금(paid)된 청구서도, 이미 고객에게
    //   메일로 나간 청구서도 아무 확인 없이 지워졌다. 화면이 기간 중복 시 "삭제 후 재생성"을
    //   안내하고 있어서 그 경로가 실제로 눌린다.
    //
    //   완전히 거부하지는 않는다 — 틀린 금액이 이미 나갔으면 **반드시 지우고 다시 보내야** 하고,
    //   삭제가 막히면 `ai_credit_requests.billed` 되돌림 경로까지 함께 막혀 크레딧이 영구 미청구가 된다.
    //   대신 사유를 받아 기록으로 남긴다.
    const deleteReason = String((req.body || {}).reason || '').trim();
    if ((isIssued || isEmailed) && !deleteReason) {
      await client.query('ROLLBACK');
      const why = [
        isIssued ? `상태가 ${issuedStatuses}` : '',
        isEmailed ? '고객에게 메일 발송됨' : '',
      ].filter(Boolean).join(' / ');
      return res.status(422).json({
        error: `이미 발행이 끝난 정산입니다 (${why}). 삭제하려면 사유를 입력해 주세요. 잘못된 금액이 나갔다면 삭제 후 재발행이 맞습니다.`,
        code: 'BILLING_DELETE_NEEDS_REASON',
        status: target.status,
        emailed: isEmailed,
      });
    }
    if (deleteReason) {
      console.log(`[정산삭제][사유] billing=${req.params.id} status=${target.status} emailed=${isEmailed} reason=${deleteReason.slice(0, 200)}`);
    }

    // 4) 묶음 단위 삭제(Codex 2차 수용). 계정별 발행은 계정 장 N + 공통 장 1이 한 묶음인데,
    //   개별 삭제를 허용하면 공통 장만 지워지고 계정 장은 남는다. 그 상태에서 회사+기간 중복검사가
    //   재발행을 막으므로 **부분 청구가 영구화**된다. 원자적으로 만들었으면 원자적으로 지워야 한다.
    const targetIds = locked.map((r) => String(r.id));

    // ★ 2026-08-04 수정 재발행 가드 — **세금계산서가 이미 국세청에 나간 건은 지우고 다시 만들 수 없다.**
    //   지우면 `taxbill_issues.billing_id`가 SET NULL로 끊기고, 새 정산에서 원본이 한 장 더 발행된다.
    //   되돌릴 수 없는 문서라 fail-closed. 정정은 수정세금계산서 경로다(Codex 적대검증 critical).
    if (reissue) {
      // ★ `ready`도 막는다(Codex 재검증 critical) — 발급 큐에 들어간 상태다. 워커가 그 행을 집어
      //   외부로 발행하는 동안 여기서 장을 지우면, 발행은 옛 내용으로 나가고 새 장이 다시 원본 발행
      //   대상이 되어 **국세청에 같은 건이 두 장** 나간다. `FOR UPDATE`로 워커와 줄을 세운다.
      const issuedBill = await client.query(
        `SELECT 1 FROM taxbill_issues
          WHERE billing_id = ANY($1::uuid[]) AND status IN ('ready', 'submitted', 'issued')
          FOR UPDATE`,
        [targetIds],
      );
      const issuedConfirm = issuedBill.rows.length > 0 ? null : await client.query(
        `SELECT 1 FROM invoice_confirmations
          WHERE billing_id = ANY($1::uuid[]) AND taxbill_status IN ('ready', 'issued')
            AND superseded_at IS NULL LIMIT 1`,
        [targetIds],
      );
      if (issuedBill.rows.length > 0 || (issuedConfirm && issuedConfirm.rows.length > 0)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: '이 정산은 세금계산서가 발급 대기 이상 단계에 있어 수량 수정 재발행을 할 수 없습니다. 이미 발행됐다면 수정세금계산서로 정정해주세요.',
          code: 'BILLING_TAXBILL_ALREADY_ISSUED',
        });
      }

      // ★ 2026-08-04 **삭제하기 전에** 조정이 적용 가능한지 본다(Codex 재검증 high 완화).
      //   삭제와 재발행은 트랜잭션이 둘이라, 재발행이 422로 막히면 정산만 사라진 채 남는다.
      //   재발행 실패의 실질 원인 둘(조정 대상 줄 없음·조정 후 음수)을 여기서 미리 걸러낸다.
      const adjRows = await client.query(
        `SELECT channel, type_key, agent_id, qty_delta, applied_delta
           FROM billing_qty_adjustments
          WHERE company_id = $1::uuid AND period_start = $2::date AND period_end = $3::date`,
        [target.company_id, toDayKey(target.billing_start), toDayKey(target.billing_end)],
      );
      if (adjRows.rows.length > 0) {
        const agg = await client.query(
          `SELECT channel, message_type, agent_id, unit_price, SUM(success_count)::int AS cnt
             FROM billing_items WHERE billing_id = ANY($1::uuid[])
            GROUP BY channel, message_type, agent_id, unit_price`,
          [targetIds],
        );
        const bad: string[] = [];
        for (const a of adjRows.rows) {
          const hits = agg.rows.filter((g: any) =>
            String(g.channel) === String(a.channel)
            && String(g.message_type) === String(a.type_key)
            && (a.agent_id ? String(g.agent_id || '') === String(a.agent_id) : true));
          if (hits.length === 0) { bad.push(`${a.channel}/${a.type_key} — 청구 항목 없음`); continue; }
          const base = hits.reduce((s: number, g: any) => s + (Number(g.cnt) || 0), 0) - (Number(a.applied_delta) || 0);
          if (base + (Number(a.qty_delta) || 0) < 0) {
            bad.push(`${a.channel}/${a.type_key} — 조정 후 ${base + (Number(a.qty_delta) || 0)}건`);
          }
        }
        if (bad.length > 0) {
          await client.query('ROLLBACK');
          return res.status(422).json({
            error: `수량 조정을 적용할 수 없어 재발행을 중단했습니다 (${bad.join(', ')}). 기존 정산은 그대로 있습니다 — 조정을 고친 뒤 다시 시도해주세요.`,
            code: 'BILLING_QTY_ADJUST_PREFLIGHT',
          });
        }
      }
    }

    // ★ 2026-08-04 이 장들이 실었던 수량 조정을 미적용으로 되돌린다 — 조정 자체는 회사×기간 축이라
    //   남고, "어느 청구서에 얼마가 실렸는가"만 지운다. 안 되돌리면 재발행 화면의 원래 수량이 틀어진다.
    await client.query(
      `UPDATE billing_qty_adjustments SET applied_delta = 0, applied_billing_id = NULL
        WHERE applied_billing_id = ANY($1::uuid[])`,
      [targetIds],
    );

    const restored = await client.query(
      `UPDATE ai_credit_requests
          SET billed = false, billed_invoice_id = NULL
        WHERE billed_invoice_id = ANY($1::uuid[])
        RETURNING id`,
      [targetIds]
    );

    // ★ 2026-07-26 초과사용 크레딧 마커 되돌림. FK가 `ON DELETE SET NULL`이라 아래 DELETE만으로도
    //   풀리지만, 몇 건이 다시 청구 대상이 됐는지 로그로 남기려면 명시 UPDATE가 필요하다.
    const restoredOverage = await client.query(
      `UPDATE ai_credit_transactions SET billed_billing_id = NULL
        WHERE billed_billing_id = ANY($1::uuid[])
        RETURNING id`,
      [targetIds]
    );

    // billing_items는 ON DELETE CASCADE로 자동 삭제 (billing_items_billing_id_fkey confdeltype='c' 실측)
    await client.query('DELETE FROM billings WHERE id = ANY($1::uuid[])', [targetIds]);

    await client.query('COMMIT');
    if (restored.rowCount) {
      console.log(`[정산삭제] billing=${req.params.id} 후불 크레딧 충전 ${restored.rowCount}건 미청구 상태로 복구`);
    }
    if (restoredOverage.rowCount) {
      console.log(`[정산삭제] billing=${req.params.id} 초과사용 크레딧 ${restoredOverage.rowCount}건 미청구 상태로 복구`);
    }
    // ★ 2026-08-04 수정 재발행 — 삭제가 커밋된 **같은 요청 안에서** 곧바로 다시 발행한다.
    //   회사·기간·발행 단위는 서버가 잠근 행에서 다시 구한다(화면이 넘긴 값을 믿지 않는다 —
    //   조회가 실패해 옛 값이 남아 있으면 다른 회사로 발행될 수 있었다).
    //   수량 조정은 회사×기간 축이라 이 재발행에 그대로 다시 실린다.
    if (reissue) {
      const issueScope = String(target.scope) === 'combined' ? 'combined' : 'by_user';
      try {
        const out = await issueBilling({
          company_id: String(target.company_id),
          scope: issueScope,
          billing_start: toDayKey(target.billing_start),
          billing_end: toDayKey(target.billing_end),
          adminId: (req as any).user?.userId || null,
        });
        return res.json({ success: true, deleted_ids: targetIds, reissued: true, billing: out.billing, sheet_count: out.sheet_count });
      } catch (reErr: any) {
        // 삭제는 이미 커밋됐다 — 되돌릴 수 없으므로 상태를 정확히 알린다.
        const body = reErr instanceof BillingIssueError ? reErr.body : { error: String(reErr?.message || reErr) };
        console.error(`[정산][수정재발행실패] company=${target.company_id} ${toDayKey(target.billing_start)}~${toDayKey(target.billing_end)} — 삭제는 완료됨:`, body?.error || reErr);
        return res.status(reErr instanceof BillingIssueError ? reErr.status : 500).json({
          ...body,
          code: body?.code || 'BILLING_REISSUE_FAILED',
          deleted: true,
          error: `기존 정산은 삭제됐지만 재발행에 실패했습니다 — ${body?.error || '알 수 없는 오류'}. 원인을 고친 뒤 정산 목록에서 같은 기간으로 다시 발행해주세요.`,
        });
      }
    }

    return res.json({
      success: true,
      restored_credit_requests: restored.rowCount || 0,
      restored_overage_transactions: restoredOverage.rowCount || 0,
      deleted_ids: targetIds,
      batch_id: target.batch_id || null,
    });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch (rbError: any) {
      console.error('정산 삭제 롤백 실패:', rbError?.message || rbError);
    }
    const emsg = error?.message || '';
    if (emsg.includes('column') && emsg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — billings.batch_id·ai_credit_transactions.billed_billing_id 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('정산 삭제 오류:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};
router.delete('/:id', handleBillingDelete);

// POST /:id/reissue — 수량 정정 후 수정 재발행 (★2026-08-04 서수란 접수)
//   삭제와 재발행을 **한 요청**으로 묶는다. 화면이 두 번 호출하면 사이의 어떤 실패도
//   "정산만 사라진 상태"를 남기고, 조회 실패로 남아 있던 옛 회사·기간으로 발행할 여지도 있었다.
router.post('/:id/reissue', async (req: Request, res: Response) => {
  (req as any).body = { ...(req.body || {}), __reissue: true, reason: String((req.body || {}).reason || '').trim() || '수량 정정 후 수정 재발행' };
  return handleBillingDelete(req, res);
});

// ============================================================
//  정산 PDF 생성
//  TODO: PDF 렌더링 로직을 services/pdfService.ts로 분리
// ============================================================

// GET /:id/pdf - 정산 PDF (2페이지: 요약 + 일자별 상세)
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    // 1) 정산 + 상세 = CT(utils/billing-pdf.ts). 컨펌 요청 메일 첨부가 같은 행·같은 정렬을 쓴다.
    const data = await loadBillingStatementData(req.params.id);
    if (!data) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    const { bil, items } = data;

    // ★ 2026-07-26 렌더 전 정합 검사. PDF는 고객에게 나가고 이메일은 회수가 안 된다.
    //   항목 줄 합 + AI 크레딧이 헤더 공급가액과 다르면 그 청구서는 세로 합이 안 맞는 문서다.
    const headerCheck = checkInvoiceLinesAgainstHeader(
      buildInvoiceLines(items), Number(bil.ai_credit_supply) || 0, Number(bil.subtotal) || 0,
    );
    if (!headerCheck.ok) {
      console.log(`[정산][PDF정합실패] billing=${req.params.id} — 항목합 ${headerCheck.linesSum} + 크레딧 ${headerCheck.aiCreditSupply} ≠ 공급가액 ${headerCheck.subtotal} (차이 ${headerCheck.diff})`);
      return res.status(422).json({
        error: '청구서 항목 합계가 공급가액과 일치하지 않아 PDF 생성을 중단했습니다. 이대로 내보내면 고객이 항목을 더한 값과 합계가 어긋납니다.',
        code: 'BILLING_ITEM_HEADER_MISMATCH',
        check: headerCheck,
      });
    }

    // 3) PDF 생성 = CT(utils/billing-pdf.ts). 라우트·메일·발급이 같은 함수를 쓴다.
    const fs = require("fs");
    const { pdfPath, displayFilename } = await renderBillingStatementPdf(bil, items);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(displayFilename)}"`);
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);
    // ★ 2026-07-28 다운로드본은 임시다. 렌더마다 새 파일이라 정리하지 않으면 누를 때마다 쌓인다.
    //   보존해야 하는 건 "고객에게 실제로 보낸" 첨부뿐이고 그건 메일 경로가 따로 남긴다.
    //   읽기 스트림이 닫힌 뒤에 지운다 — 핸들이 열린 채 unlink하면 윈도우에서 실패한다.
    fileStream.on('close', () => { try { fs.unlinkSync(pdfPath); } catch { /* 이미 없거나 잠김 — 다음 렌더가 새 파일을 쓴다 */ } });

  } catch (error: any) {
    console.error('정산 PDF 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});


// ============================================================
//  거래내역서(Invoice) API
// ============================================================

// GET /preview - 정산 미리보기 = 발행 드라이런
//   ★ 2026-07-25 전면 재작성. 자체 SQL을 전부 버리고 발행(`POST /generate`)과 **같은 함수**를 호출한다.
//   기존 미리보기는 발행과 네 축이 달라 같은 기간인데 금액이 어긋났다:
//     ① campaign_runs 상태조건 없음(발행은 status='completed'만) → 미완료 발송까지 셈
//     ② 일반발송에 sendreq_time 기간조건을 덧붙임(발행은 run 집합으로만 기간을 정함)
//     ③ 브랜드메시지 REQUEST_DATE 기간조건 없음(발행은 있음)
//     ④ 후불 AI 크레딧 미포함(발행은 청구에 합산)
//   미리보기가 실제 청구액과 다르면 그걸 보고 발행하는 사람이 틀린 금액을 승인하게 된다.
//   여기서는 계산만 하고 아무것도 쓰지 않는다 — billed 플래그는 발행에서만 바뀐다.
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const { company_id, start, end, type = 'combined', user_id } = req.query;

    if (!company_id || !start || !end) {
      return res.status(400).json({ error: '필수 파라미터: company_id, start, end' });
    }
    const companyId = String(company_id);
    const startDate = String(start);
    const endDate = String(end);
    const userId = user_id ? String(user_id) : undefined;

    // 1) 회사 단가 — 발행과 같은 해석(명시된 0원 보존)
    const companyResult = await pool.query(
      `SELECT company_name, billing_type, created_at,
              cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
              cost_per_test_sms, cost_per_test_lms, service_type
       FROM companies WHERE id = $1`,
      [companyId]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다' });
    }
    const company = companyResult.rows[0];
    // 발행과 같은 스냅샷 경로를 쓴다 — 미리보기만 다른 값을 읽으면 금액이 갈라진다.
    const ledger = await loadBillingLedger(companyId);
    const { prices, unsetKeys: webUnsetPriceKeys } = resolveBillingUnitPricesDetailed(ledger.companyPriceRow);
    // 미리보기는 계산만 하므로 선불 회사도 막지 않는다. 대신 발행이 차단된다는 사실을 함께 돌려준다.
    const billable = company.billing_type !== 'prepaid';

    // 2) 사용량 — 발행과 완전히 같은 집계(일반·테스트·스팸·브랜드메시지 전부 포함)
    const dayData = await buildCompanyUsageByDay({ companyId, startDate, endDate, userId });
    const totals = buildBillingTotals(dayData);
    logUnbillableUsageKeys(dayData, `미리보기 company=${companyId} ${startDate}~${endDate}`);

    // ★ 2026-07-26 에이전트 포함 청구 상세 — 발행과 **같은 함수**를 쓴다.
    //   미리보기만 에이전트를 빼면 미리보기 금액과 실제 청구액이 갈라진다(0725에 고친 결함과 같은 계열).
    //   여기서는 막지 않고 발행이 막힐 이유를 billing_guard로 함께 알린다.
    const usage = await buildBillingUsageRows({ companyId, startDate, endDate, userId, ledger });
    const axisDiffs = diffBillingRowsVsDayData(usage.rows, dayData);
    // ★ 2026-07-31 결과 미확정(대기) — 발행 차단과 **같은 함수·같은 입력**(상세 행)으로 판정한다.
    //   일자축(dayData)으로 보면 에이전트 대기가 빠져 미리보기만 통과하는 어긋남이 생긴다(Codex 2R).
    const previewPending = findBlockingPendingRows(usage.rows);
    // ★ 2026-08-05 미리보기도 **발행과 같은 공제**를 적용한다 — 다르면 "미리보기 금액 ≠ 발행 금액"이 된다.
    //   읽기 전용이라 반복 미리보기가 무료 수량을 소모하지 않는다(마커는 발행에서만 쓰인다).
    let previewFreeDeductible: Record<string, number>;
    try {
      previewFreeDeductible = await readFreeDeductibleForBilling(companyId, startDate, endDate);
    } catch (e: any) {
      // 발행과 같은 이유로 미리보기도 막는다 — 여기서 통과시키면 "미리보기 통과 후 발행 503"이 된다(§2-4).
      if (e?.code === 'DB_MIGRATION_PENDING') {
        return res.status(503).json({
          success: false,
          error: '요금제 무료 제공 정보를 읽을 수 없습니다. DB 마이그레이션(무료 메시징 4문) 실행이 필요합니다.',
          code: 'DB_MIGRATION_PENDING',
        });
      }
      throw e;
    }
    const priced = priceBillingRows(
      usage.rows, prices, ledger.postpaidPriceRows,
      normalizeUnitPriceBasis(ledger.companyPriceRow?.unit_price_basis),
      previewFreeDeductible,
    );
    const unbillable = priced.unbillableTypes;
    const webUnsetPriced = findUnsetPricedTypes(webUnsetPriceKeys, usage.rows);
    const agentAmount = priced.amountByChannel.agent;
    // ★ 2026-07-26 요금제 일할 — 발행과 같은 함수. 미리보기만 빼면 금액이 갈라진다.
    const planSegments = buildPlanSegments(await loadPlanChanges(companyId, endDate), startDate, endDate);
    // 원 단위 절사가 행 단위라, 미리보기 총액도 **발행이 저장할 그 행들**에서 더해야 값이 갈라지지 않는다.
    // (구 `sumPlanSegments` 합계는 절사 전 값이라 발행 금액과 몇 원 어긋난다 — 쓰지 않는다.)
    const previewItems = [...buildPlanBillingItems(planSegments), ...priced.items];
    // 발행이 막힐 이유를 미리보기에서 **같은 함수로** 판정한다 — 다른 기준으로 판정하면
    // 미리보기는 통과인데 발행만 422가 되고, 마감일에 그 차이를 찾을 시간이 없다.
    const planGate = evaluatePlanHistoryGate({
      segments: planSegments,
      billingStart: startDate,
      billingEnd: endDate,
      companyCreatedDay: company.created_at ? toDayKey(company.created_at) : null,
      monthlyPrice: Number(ledger.companyPriceRow?.plan_monthly_price) || 0,
      // 발행과 같은 입력 — 여기만 빼면 미리보기는 통과하고 발행만 422가 된다.
      planAssigned: Boolean(ledger.companyPriceRow?.plan_id),
      historyTotal: await countPlanChanges(companyId),
    });

    // 3) 후불 AI 크레딧 — 발행과 같은 기준. 읽기만 하고 billed는 건드리지 않는다.
    //    사용자 지정이면 발행이 크레딧을 청구하지 않으므로 미리보기도 0으로 둔다(금액 일치).
    let chargeSupply = 0, chargeCount = 0, overageCount = 0;
    if (!userId) {
      const creditChargeRes = await pool.query(
        `SELECT credits, supply_amount FROM ai_credit_requests
          WHERE company_id = $1::uuid AND status = 'approved' AND billed = false
            -- ★ 2026-07-26 KST 경계 — 발행과 같은 축이라야 미리보기 금액이 갈라지지 않는다.
            AND processed_at >= ($2 || ' 00:00:00+09')::timestamptz
            AND processed_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz`,
        [companyId, startDate, endDate]
      );
      chargeSupply = creditChargeRes.rows.reduce((s: number, r: any) => s + Number(r.supply_amount || 0), 0);
      chargeCount = creditChargeRes.rows.reduce((s: number, r: any) => s + Number(r.credits || 0), 0);
      const overageRes = await pool.query(
        `SELECT COALESCE(SUM(overage_credits), 0) AS oc FROM ai_credit_transactions
          WHERE company_id = $1::uuid AND type = 'deduct' AND overage_credits > 0
            -- ★ 2026-07-26 청구 완료 마커를 발행과 같은 기준으로 본다 — 이미 청구된 초과사용분을
            -- 미리보기가 다시 세면 미리보기 금액과 실제 청구액이 갈라진다.
            AND billed_billing_id IS NULL
            -- ★ 2026-07-26 KST 경계. PG 세션 TZ가 Etc/UTC라 date 캐스트로 쓰면 경계가 KST 09:00이 된다.
            -- 발송 집계는 KST 자정으로 고쳤는데 크레딧만 UTC로 남아 있어 청구 월이 또 어긋났다.
            AND created_at >= ($2 || ' 00:00:00+09')::timestamptz
            AND created_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz`,
        [companyId, startDate, endDate]
      );
      overageCount = Number(overageRes.rows[0]?.oc) || 0;
    }
    const aiCreditCount = chargeCount + overageCount;
    const aiCreditSupply = chargeSupply + overageCount * CREDIT_UNIT_PRICE;

    // 4) 금액 — 발행 코어와 같은 절사 경로(항목줄 1회 절사 — 0730 정정 후 일자행은 소수라
    //    raw 합산이면 미리보기에 소수가 노출되고 실발행과 갈린다. Codex 0730 지적 ② 수용).
    //    계정별(by_account) 발행은 장별 절사라 이 합산 미리보기와 1원 수준 차이가 날 수 있다 —
    //    장 = 독립 문서 = 절사 단위이므로 의도된 차이다(billing-issue 주석 참조).
    const subtotal = sumFlooredInvoiceLines(previewItems as any) + aiCreditSupply;
    const vat = vatOfSupply(subtotal);
    const totalAmount = subtotal + vat;

    const test = {
      test_sms: totals.TEST_SMS,
      test_lms: totals.TEST_LMS,
      test_sms_amount: floorWon(totals.TEST_SMS * prices.TEST_SMS),
      test_lms_amount: floorWon(totals.TEST_LMS * prices.TEST_LMS),
    };
    const spam = {
      spam_sms: totals.SPAM_SMS,
      spam_lms: totals.SPAM_LMS,
      spam_sms_amount: floorWon(totals.SPAM_SMS * prices.SPAM_SMS),
      spam_lms_amount: floorWon(totals.SPAM_LMS * prices.SPAM_LMS),
    };
    const ai_credit = { count: aiCreditCount, supply_amount: aiCreditSupply };
    const amounts = { subtotal, vat, total_amount: totalAmount };
    // ★ 2026-07-26 에이전트(게이트웨이) 항목 — 일자 × 발송ID × 유형. 대상ID는 청구 축이 아니다.
    // ★ 2026-07-27 발급명 병기 — 발송ID만으론 어느 계정인지 안 읽힌다(이름 규칙은 전 화면 공통).
    const previewCustNames = await getAgentCustNameMap();
    const agent = {
      amount: agentAmount,
      rows: priced.items
        .filter((it) => it.channel === 'agent')
        .map((it) => ({
          item_date: it.itemDate, agent_send_id: it.agentSendId, type_key: it.typeKey,
          cust_name: it.agentSendId ? previewCustNames.get(String(it.agentSendId)) || null : null,
          sent: it.total, success: it.success, unit_price: it.unitPrice, amount: it.amount,
        })),
      excluded_prepaid_send_ids: usage.excludedPrepaidSendIds,
    };
    // ★ 2026-07-26 요금제 항목 — 플랜 × 적용기간, 변경 시 일할. 청구서 항목 1번.
    //   금액은 발행이 저장할 값(구간별 원 미만 절사)과 같아야 한다.
    const plan = {
      amount: previewItems.filter((i) => i.channel === 'plan').reduce((s, i) => s + (Number(i.amount) || 0), 0),
      segments: planSegments.map((s) => ({
        plan_code: s.planCode, monthly_price: s.monthlyPrice,
        from: s.from, to: s.to, days: s.days, month_days: s.monthDays, amount: floorWon(s.amount),
      })),
    };
    // 발행 가능 여부를 미리보기에서 먼저 알린다 — 선불 회사·축 불일치·단가 미설정은 발행이 막힌다.
    // ★ 2026-07-26 차단 사유를 **발행과 전건 일치**시켰다(Codex 3차 MEDIUM 수용).
    //   에이전트 매핑 0과 요금제 이력 공백은 발행에서 422로 막는데 미리보기에는 없어서,
    //   미리보기로 확인하고 발행을 눌렀는데 막히는 상태였다 — 미리보기의 존재 이유가 그 반대다.
    const blockers: string[] = [];
    const blockerCodes: string[] = [];
    const block = (code: string, msg: string) => { blockerCodes.push(code); blockers.push(msg); };
    if (!billable) block('PREPAID_COMPANY_NOT_BILLABLE', '선불 고객사 — 발송 시점에 잔액에서 이미 차감되어 월 정산서 발행 시 이중 청구');
    if (axisDiffs.length > 0) block('BILLING_AXIS_MISMATCH', '청구 상세와 사용량 집계 수량 불일치');
    // ★ 2026-08-04 기간 축 차단 2종(겹치는 발행·수동 정산완료) — 발행이 409로 막는 사유인데 미리보기에 없어
    //   "미리보기 통과 → 발행 실패"가 났다(0731 별건 5). 판정·문구를 발행과 **같은 함수**에서 받는다.
    const periodConflict = describeBillingPeriodConflict(
      await readBillingPeriodConflicts(companyId, startDate, endDate),
    );
    if (periodConflict) block(periodConflict.code, periodConflict.message);
    // ★ 2026-07-31 결과 미확정 — **차단하지 않고 보여준다**(billing-issue와 같은 판정·같은 정책).
    //   차단으로 두면 채널별 종결 의미가 달라 구멍이 남는 채 "막혔으니 안전"이라는 거짓 확신을 주고,
    //   워커 교착 시 정산이 멈춘다. 수치는 아래 billing_guard.pending_types로 화면에 내려 사람이 판단한다.
    if (unbillable.length > 0) block('UNBILLABLE_TYPE_KEY', `청구 단가가 정의되지 않은 유형: ${summarizeBlockList(unbillable.map((u) => u.key))}`);
    if (webUnsetPriced.length > 0) block('WEB_UNIT_PRICE_UNSET', `고객사 단가 미설정: ${summarizeBlockList(webUnsetPriced.map((u) => u.key))}`);
    if (priced.missingAgentPrices.length > 0) block('AGENT_UNIT_PRICE_MISSING', `에이전트 발송ID 단가 미설정: ${summarizeBlockList(priced.missingAgentPrices.map((m) => `${m.agentSendId} ${m.typeKey}`))}`);
    if (usage.agentMappingMissing) block('AGENT_MAPPING_MISSING', `에이전트 사용 설정(usage_type=${ledger.usageType})인데 발송ID 매핑 0건 — 게이트웨이 발송분이 통째로 빠진다`);
    if (!planGate.ok) {
      block('PLAN_HISTORY_MISSING', planGate.blockReason === 'history_absent'
        ? '요금제가 배정돼 있는데 요금제 변경 이력이 0건 — 구독료가 0원으로 빠진다'
        : `요금제 이력이 중간에 끊김 ${planGate.gap!.from}~${planGate.gap!.to} (${planGate.gap!.days}일) — 그 구간 구독료가 0원으로 빠진다`);
    }
    const billing_guard = {
      billable: billable && blockers.length === 0,
      billing_type: company.billing_type || null,
      reason: blockers.length > 0 ? blockers.join(' / ') : null,
      blocker_codes: blockerCodes,
      unbillable_types: unbillable,
      unset_price_types: webUnsetPriced,
      axis_mismatches: axisDiffs,
      missing_agent_prices: priced.missingAgentPrices,
      agent_mapping_missing: usage.agentMappingMissing,
      plan_gap: planGate.gap,
      // ★ 2026-07-31 결과 미확정(대기) — 차단은 아니지만 **그대로 발행하면 0원으로 굳고 재청구가 불가능**하다.
      //   발행 전에 사람이 보고 판단하라고 내려보낸다(채널·유형·건수·최종 발송일·오래 남았는지).
      pending_types: previewPending,
      // 차단은 아니지만 금액에 영향이 있다 — "그 기간 앞부분은 요금제 없음"을 미리보기에서 보여준다.
      plan_uncovered_head: planGate.uncoveredHead,
    };

    if (type === 'brand') {
      // 매장(발신번호) 축은 청구 집계에 없다. 그래서 **같은 ID 집합·같은 테이블·같은 where**를 매장별로
      // 나누기만 한다 — 그러면 매장 합계가 아래 combined 합계와 항상 일치한다.
      // ★ 2026-07-30 (2R): ID 집합이 이벤트 축/기간 한정 캠페인 축 둘로 갈렸다 — 집계 CT와 같은 규칙으로
      //   두 번 모아야 합계가 일치한다(캠페인 축을 기간 없이 넣으면 인접 월 재발송분이 이중 계상).
      const billingIds = await selectBillingSendIds({ companyId, startDate, endDate, userId });
      const allBillingIds = [...billingIds.eventIds, ...billingIds.periodCampaignIds];
      const brandMap: Record<string, any> = {};
      const ensureStore = (code: string, name: string) => {
        if (!brandMap[code]) {
          brandMap[code] = { store_code: code, store_name: name, sms_success: 0, lms_success: 0, mms_success: 0, kakao_success: 0, brand_success: 0 };
        }
        return brandMap[code];
      };

      if (allBillingIds.length > 0) {
        const storeRes = await pool.query(
          `SELECT cr.id AS run_id, cb.store_code, cb.store_name
             FROM campaign_runs cr
             JOIN campaigns c ON c.id = cr.campaign_id
             LEFT JOIN callback_numbers cb ON cb.phone = c.callback_number AND cb.company_id = c.company_id
            WHERE cr.id = ANY($1::uuid[])
            UNION
           SELECT c2.id AS run_id, cb2.store_code, cb2.store_name
             FROM campaigns c2
             LEFT JOIN callback_numbers cb2 ON cb2.phone = c2.callback_number AND cb2.company_id = c2.company_id
            WHERE c2.id = ANY($1::uuid[])`,
          [allBillingIds]
        );
        const storeMap: Record<string, { store_code: string; store_name: string }> = {};
        storeRes.rows.forEach((r: any) => {
          storeMap[r.run_id] = { store_code: r.store_code || 'default', store_name: r.store_name || '본사' };
        });

        const companyTables = await getBillingCompanyTables(companyId);
        const billingTables = await getTablesForBillingPeriod(companyTables, startDate, endDate);
        // ★ 2026-07-30 (3R): 집계는 공용 CT 경로 하나로 — 청킹(RUN_ID_IN_CHUNK)·FORCE INDEX 힌트·
        //   정산 전용 풀(mysqlBillingQuery)을 다 지나는 aggregateBillingSendIds + smsAggByRunDateType.
        //   (옛 로컬 smsAggByRunAndType은 셋 다 우회해 대형 고객사 월말 미리보기가 풀스캔이었다 — 삭제.)
        //   run×일자 행을 run×유형으로 합산하는 것은 아래 forEach가 그대로 한다(일자 축은 무시).
        const rows = await aggregateBillingSendIds(billingTables, billingIds, smsAggByRunDateType, startDate, endDate);
        rows.forEach((row: any) => {
          const store = storeMap[row.run_id] || { store_code: 'default', store_name: '본사' };
          const b = ensureStore(store.store_code, store.store_name);
          const n = Number(row.success_count) || 0;
          switch (MSG_TYPE_TO_USAGE_KEY[row.msg_type]) {
            case 'SMS': b.sms_success += n; break;
            case 'LMS': b.lms_success += n; break;
            case 'MMS': b.mms_success += n; break;
            case 'KAKAO': b.kakao_success += n; break;
            // ★ 2026-07-30 (2R): 브랜드 F행 — 빠지면 매장별 상세 합이 combined 합계와 갈린다.
            case 'BRAND': b.brand_success += n; break;
          }
        });
      }

      // (2026-07-30) 옛 IMC 차액 보정 삭제 — 브랜드가 같은 SMSQ 집계로 합류해 차액 축 자체가 사라졌다.

      const brands = Object.values(brandMap).map((b: any) => ({
        ...b,
        sms_amount: b.sms_success * prices.SMS,
        lms_amount: b.lms_success * prices.LMS,
        mms_amount: b.mms_success * prices.MMS,
        kakao_amount: b.kakao_success * prices.KAKAO,
        brand_amount: b.brand_success * prices.BRAND,
      }));

      return res.json({ type: 'brand', brands, test, spam, agent, plan, ai_credit, amounts, billing_guard });
    }

    // ★ 2026-08-05 미리보기 수량·금액도 **청구 수량**(성공 − 무료 공제)이어야 한다.
    //   `totals`는 일자축 성공 합이라 무료를 모르는데 발행은 공제 후로 나간다 —
    //   그대로 두면 같은 응답 안에서 미리보기 금액과 발행 예정 금액이 갈린다(§2-4 "미리보기는 발행과 같은 값").
    //   빼는 값은 한도가 아니라 **실제 배분된 양**(priced.items의 freeCount)이다.
    const previewFreeByType: Record<string, number> = {};
    for (const it of priced.items) {
      const f = Number((it as any).freeCount) || 0;
      if (it.channel !== 'web' || f <= 0) continue;
      previewFreeByType[it.typeKey] = (previewFreeByType[it.typeKey] || 0) + f;
    }
    const billableQty = (key: string) =>
      billableQuantity({ success: Number((totals as any)[key]) || 0, freeCount: previewFreeByType[key] || 0 });
    const summary = {
      sms_success: billableQty('SMS'),
      lms_success: billableQty('LMS'),
      mms_success: billableQty('MMS'),
      kakao_success: billableQty('KAKAO'),
      brand_success: totals.BRAND,
      sms_amount: billableQty('SMS') * prices.SMS,
      lms_amount: billableQty('LMS') * prices.LMS,
      mms_amount: billableQty('MMS') * prices.MMS,
      kakao_amount: billableQty('KAKAO') * prices.KAKAO,
      brand_amount: totals.BRAND * prices.BRAND,
    };

    return res.json({ type: 'combined', summary, test, spam, agent, plan, ai_credit, amounts, billing_guard });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('column') && emsg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — company_agent_ids.billing_type·cost_per_* 및 ai_credit_transactions.overage_credits 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('정산 미리보기 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ※ 옛 buildTestSummary·buildSpamSummary는 삭제했다(2026-07-25).
//   테스트·스팸 수량도 발행과 같은 집계(buildCompanyUsageByDay의 TEST_*/SPAM_* 유형키)에서 나온다.
//   같은 숫자를 두 군데서 따로 세면 언젠가 갈라진다.

// POST /invoices - 거래내역서 생성
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const {
      company_id, store_code, store_name, billing_start, billing_end,
      invoice_type = 'combined', billing_id,
      sms_success_count = 0, sms_unit_price = 0,
      lms_success_count = 0, lms_unit_price = 0,
      mms_success_count = 0, mms_unit_price = 0,
      kakao_success_count = 0, kakao_unit_price = 0,
      test_sms_count = 0, test_sms_unit_price = 0,
      test_lms_count = 0, test_lms_unit_price = 0,
      spam_filter_count = 0, spam_filter_unit_price = 0,
      notes, created_by
    } = req.body;

    if (!company_id || !billing_start || !billing_end) {
      return res.status(400).json({ error: '필수: company_id, billing_start, billing_end' });
    }

    // ★ 2026-07-26 거래내역서도 **항목별 원 미만 절사**다(Harold 지시). 단가가 소수 둘째 자리라
    //   유형별 금액이 소수로 떨어지고, 고객이 항목을 세로로 더한 값이 공급가액과 맞아야 한다.
    //   PDF의 유형별 행도 같은 함수를 거치므로 표와 합계가 정확히 일치한다.
    const subtotal =
      floorWon(sms_success_count * sms_unit_price) +
      floorWon(lms_success_count * lms_unit_price) +
      floorWon(mms_success_count * mms_unit_price) +
      floorWon(kakao_success_count * kakao_unit_price) +
      floorWon(test_sms_count * test_sms_unit_price) +
      floorWon(test_lms_count * test_lms_unit_price) +
      floorWon(spam_filter_count * spam_filter_unit_price);
    const vat = vatOfSupply(subtotal);
    const total_amount = subtotal + vat;

    const result = await pool.query(
      `INSERT INTO billing_invoices (
        company_id, store_code, store_name, billing_start, billing_end, invoice_type, billing_id,
        sms_success_count, sms_unit_price, lms_success_count, lms_unit_price,
        mms_success_count, mms_unit_price, kakao_success_count, kakao_unit_price,
        test_sms_count, test_sms_unit_price, test_lms_count, test_lms_unit_price,
        spam_filter_count, spam_filter_unit_price,
        subtotal, vat, total_amount, status, notes, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'draft',$25,$26
      ) RETURNING *`,
      [
        company_id, store_code || null, store_name || null, billing_start, billing_end, invoice_type, billing_id || null,
        sms_success_count, sms_unit_price, lms_success_count, lms_unit_price,
        mms_success_count, mms_unit_price, kakao_success_count, kakao_unit_price,
        test_sms_count, test_sms_unit_price, test_lms_count, test_lms_unit_price,
        spam_filter_count, spam_filter_unit_price,
        subtotal, vat, total_amount, notes || null, created_by || null
      ]
    );

    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('거래내역서 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /invoices - 거래내역서 목록
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    const { company_id, status } = req.query;
    // ★ 수정: c.name → c.company_name (companies 테이블 컬럼명 일치)
    let sql = `SELECT bi.*, c.company_name
               FROM billing_invoices bi
               JOIN companies c ON c.id = bi.company_id
               WHERE 1=1`;
    const params: any[] = [];

    if (company_id) { params.push(company_id); sql += ` AND bi.company_id = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND bi.status = $${params.length}`; }
    sql += ' ORDER BY bi.created_at DESC';

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (error: any) {
    console.error('거래내역서 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /invoices/:id - 거래내역서 상세
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    // ★ 수정: c.name → c.company_name
    const result = await pool.query(
      `SELECT bi.*, c.company_name, c.business_number, c.ceo_name, c.address
       FROM billing_invoices bi
       JOIN companies c ON c.id = bi.company_id
       WHERE bi.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('거래내역서 상세 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /invoices/:id/status - 상태 변경
router.put('/invoices/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['draft', 'confirmed', 'paid'].includes(status)) {
      return res.status(400).json({ error: '유효한 상태: draft, confirmed, paid' });
    }
    const result = await pool.query(
      `UPDATE billing_invoices SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('상태 변경 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  거래내역서 PDF
//  TODO: 정산 PDF와 공통 렌더링 로직을 services/pdfService.ts로 분리
// ============================================================

// GET /invoices/:id/pdf - PDF 거래내역서 생성 & 다운로드
router.get('/invoices/:id/pdf', async (req: Request, res: Response) => {
  try {
    // 다운로드와 메일이 **같은 로더**를 쓴다 — 각자 조회하면 두 문서의 사업자가 갈린다.
    const inv = await loadInvoicePdfData(req.params.id);
    if (!inv) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }

    // PDF 생성 = CT(utils/billing-pdf.ts). 라우트·메일·발급이 같은 함수를 쓴다.
    const fs = require("fs");
    const { pdfPath, displayFilename } = await renderInvoicePdf(inv);

    // ★ 2026-07-28 `pdf_path` 기록 폐기 — 다운로드본은 응답 뒤 지우므로 경로를 남기면 없는 파일을 가리킨다.
    //   이 컬럼을 읽는 코드는 전 소스에 없다(grep 확인). 보존이 필요한 건 메일로 나간 첨부뿐이다.
    await pool.query('UPDATE billing_invoices SET updated_at = now() WHERE id = $1', [req.params.id]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(displayFilename)}"`);
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);
    fileStream.on('close', () => { try { fs.unlinkSync(pdfPath); } catch { /* 위 정산서 다운로드와 같은 이유 */ } });

  } catch (error: any) {
    // ★ 2026-07-29 거래내역서 PDF가 billing_contacts(공급받는자 사업자)에 의존하게 됐다 —
    //   그 테이블·컬럼이 없으면 500이 아니라 마이그레이션 안내를 낸다(db_alter_safety_net).
    if (isMigrationPending(error)) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — billing_contacts 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('PDF 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  정산서 메일 발송
// ============================================================

// POST /:id/send-email - 정산서 PDF 메일 발송
//
// ★ 2026-07-26 이 라우트가 **화면이 실제로 부르는 그 라우트**다.
//   `app.ts:319`가 `/api/admin/billing`에 이 라우터를, 323이 `/api/admin`에 admin 라우터를 마운트하므로
//   `POST /api/admin/billing/:id/send-email`은 여기서 잡히고 admin.ts의 동명 라우트는 **닿지 않는다.**
//   그 사실을 몰라서 두 가지가 어긋나 있었다:
//     ① 응답에 `success`가 없어 화면이 `if (!res.data?.success)`로 **실발송을 "발송 실패"로 표시** →
//        운영자가 재발송 → 고객이 같은 청구서를 두 번 받는다.
//     ② 화면이 넘긴 수신자·제목을 무시하고 `contact_email`로만 보냈고,
//        화면이 표시하는 발송 이력 컬럼(`emailed_at`)은 아무도 채우지 않아 영구 공백이었다.
//   본문은 **서버가 만든다** — 항목표가 `billing_items`에서 나오고 정합 검사를 통과해야 하므로
//   화면이 만든 본문을 그대로 보내면 그 검사를 우회한다(LESSONS_META §19 이메일 본문).
router.post('/:id/send-email', async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const adminId = (req as any).user?.userId || null;

    // 1) 정산 + 회사 정보 조회
    const result = await pool.query(
      // ★ 2026-07-31 수신자는 여기서 읽지 않는다 — `billing_recipients`(CT)가 단일 원장이다.
      //   그전엔 이 라우트만 `companies.contact_email`을 봐서, 같은 회사인데 일괄발급은 A에게
      //   개별 재발송은 B에게 나갈 수 있었다. `contact_name`은 본문 인사말 표시용으로만 남긴다.
      `SELECT b.*, c.company_name, c.contact_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    const bil = result.rows[0];

    // 수신자·제목은 화면에서 그 자리에 고칠 수 있다(담당자가 바뀌는 일이 흔하다). 없으면 등록된 담당자.
    const toOverride = String((req.body || {}).to || '').trim();
    if (toOverride && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toOverride)) {
      return res.status(400).json({ error: `수신자 이메일 형식이 올바르지 않습니다: ${toOverride}` });
    }
    // 이 장의 축(회사 장이면 user_id NULL, 계정 장이면 그 계정)으로 수신자를 해석한다 — 일괄발급과 같은 판정.
    const resolvedTo = await resolveBillingRecipients(String(bil.company_id), bil.user_id ? String(bil.user_id) : null, 'statement');
    const sendTo = toOverride || String(resolvedTo.primary?.email || '');
    // 화면에서 수신자를 직접 바꾼 경우엔 참조를 붙이지 않는다 — 그 자리에서 지정한 한 사람에게만 보낸다.
    const ccList = toOverride ? [] : resolvedTo.cc;
    const subjectOverride = String((req.body || {}).subject || '').trim();

    if (!sendTo) {
      return res.status(400).json({ error: '고객사 담당자 이메일이 등록되어 있지 않습니다. 수신자를 직접 입력해 주세요.' });
    }

    // 2) PDF는 여기서 만든다 (★2026-07-28) — 예전에는 디스크에 파일이 있는지 확인하고 없으면 400을 돌려주며
    //    "먼저 다운로드하라"고 했다. 파일명 규칙을 재구성해 찾는 방식이라 규칙이 바뀌면 조용히 깨지고,
    //    운영자가 순서를 외워야 했다. CT로 직접 렌더하면 항상 방금 만든 최신 문서가 나간다.
    const pdfData = await loadBillingStatementData(req.params.id);
    if (!pdfData) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다.' });
    }
    const { pdfPath, displayFilename } = await renderBillingStatementPdf(pdfData.bil, pdfData.items);
    const pdfFilename = displayFilename;

    const n = (v: any) => Number(v) || 0;
    const bStart = toDayKey(bil.billing_start);
    const bEnd = toDayKey(bil.billing_end);

    // ★ 2026-07-26 메일 항목표도 `billing_items`에서 만든다 — PDF와 **같은 함수**.
    //   그 전에는 헤더 컬럼을 직접 그려서 에이전트 줄이 없었고, PDF와 별개 코드라
    //   PDF만 고치면 메일에서만 틀린 청구서가 나가는 구조였다.
    //   메일은 회수가 안 되므로 보내기 전에 정합을 확인한다.
    const emailItems = await pool.query(
      `SELECT * FROM billing_items WHERE billing_id = $1
        ORDER BY channel ASC, item_date ASC, message_type ASC, id ASC`,
      [req.params.id],
    );
    const emailLines = buildInvoiceLines(emailItems.rows);
    const emailCheck = checkInvoiceLinesAgainstHeader(emailLines, n(bil.ai_credit_supply), n(bil.subtotal));
    if (!emailCheck.ok) {
      console.log(`[정산][메일정합실패] billing=${req.params.id} — 항목합 ${emailCheck.linesSum} + 크레딧 ${emailCheck.aiCreditSupply} ≠ 공급가액 ${emailCheck.subtotal}`);
      return res.status(422).json({
        error: '청구서 항목 합계가 공급가액과 일치하지 않아 메일 발송을 중단했습니다. 보낸 메일은 되돌릴 수 없습니다.',
        code: 'BILLING_ITEM_HEADER_MISMATCH',
        check: emailCheck,
      });
    }
    const LINE_BG: Record<string, string> = { web: '', agent: ' background: #EFF6FF;', test: ' background: #FFFBEB;', spam: ' background: #FEF3C7;' };
    const lineRowsHtml = emailLines.map((l) => `<tr style="border-bottom: 1px solid #F3F4F6;${LINE_BG[l.channel] || ''}">
              <td style="padding: 8px 0; color: #6B7280;">${l.label}</td>
              <td style="padding: 8px 0; text-align: right;">${l.quantityText ? `${l.quantityText} × ₩${l.unitPrice.toLocaleString()}/월` : `${l.count.toLocaleString()}건 × ₩${l.unitPrice.toLocaleString()}`}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${l.amount.toLocaleString()}</td>
            </tr>`).join('');

    // 3) 메일 발송
    // ★ 2026-08-04 컨펌 링크는 트랜잭션 안에서 확보한 토큰으로 만든다 — 본문을 함수로 둔다.
    const buildHtmlBody = (viewUrl: string | null) => `
      <div style="font-family: 'Apple SD Gothic Neo', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #4338ca, #6366F1); padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 20px;">📊 정산서 안내</h2>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${bil.company_name} | ${bil.billing_year}년 ${bil.billing_month}월</p>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #E5E7EB; border-top: none;">
          <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">
            안녕하세요, ${bil.contact_name || bil.company_name} 담당자님.<br/>
            <strong>${bStart} ~ ${bEnd}</strong> 기간 정산서를 안내드립니다.
          </p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
            ${lineRowsHtml}
            ${n(bil.ai_credit_supply) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6; background: #F5F3FF;">
              <td style="padding: 8px 0; color: #6B7280;">AI 크레딧</td>
              <td style="padding: 8px 0; text-align: right;">${n(bil.ai_credit_count).toLocaleString()} 크레딧</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${n(bil.ai_credit_supply).toLocaleString()}</td>
            </tr>` : ''}
          </table>
          <div style="background: #EEF2FF; padding: 16px; border-radius: 8px; text-align: right;">
            <span style="font-size: 13px; color: #6B7280;">공급가액 ₩${n(bil.subtotal).toLocaleString()} + VAT ₩${n(bil.vat).toLocaleString()}</span><br/>
            <span style="font-size: 20px; font-weight: 700; color: #4338CA;">합계 ₩${n(bil.total_amount).toLocaleString()}</span>
          </div>
          ${viewUrl ? renderConfirmBlockHtml(viewUrl) : ''}
          <p style="font-size: 13px; color: #9CA3AF; margin-top: 16px;">
            상세 내역은 첨부된 PDF를 확인해주세요.<br/>
            문의사항이 있으시면 ${INVITO_INFO.phone}로 연락 부탁드립니다.
          </p>
        </div>
        <div style="padding: 16px; text-align: center; font-size: 11px; color: #9CA3AF; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; background: #F9FAFB;">
          본 메일은 INVITO 한줄로 시스템에서 자동 발송되었습니다.
        </div>
      </div>
    `;

    // ★ 2026-07-26 발송 표시와 SMTP를 **한 트랜잭션 안에서, 행 잠금을 든 채로** 한다(Codex 5차 #1·#2 수용).
    //   4차 수정은 표시를 SMTP 앞으로 옮기고 곧바로 COMMIT했다. 그러면 잠금이 발송 전에 풀려서,
    //   SMTP가 도는 몇 초 동안 사유를 적은 삭제가 통과한다 — 고객은 **이미 삭제된 청구서**를 받고
    //   크레딧 마커는 풀려 재발행에 다시 들어간다. 표시를 앞으로 옮긴 것만으로는 그 창이 닫히지 않는다.
    //   잠금을 든 채 보내면 삭제는 발송이 끝날 때까지 기다렸다가 "이미 메일 나감" 상태를 보게 된다.
    //
    //   실패 시 되돌림도 손으로 하지 않는다 — `ROLLBACK` 하나가 표시를 원상복구한다.
    //   손으로 되돌리면 잠금 전에 읽은 낡은 값을 쓰게 되어 **다른 요청의 성공 이력까지 지운다**(5차 #2).
    //
    //   재발송은 막지 않되 확인을 받는다. 잠금 후 이미 발송 이력이 있으면 409로 되돌려
    //   화면이 "언제·누구에게 나갔다"를 보여주고 다시 누르게 한다(`resend: true`).
    // 재발송 확인은 **확인한 그 이력에 묶는다**(Codex 6차 ①-4). `resend: true`만 보면,
    // A가 확인 화면을 보는 동안 B가 먼저 재발송한 경우 A의 클릭이 B의 발송을 못 보고 그대로 또 보낸다.
    // 화면은 409에서 받은 `emailed_at`을 `resend_of`로 되돌려주고, 서버는 잠근 행의 값과 같을 때만 통과시킨다.
    const allowResend = (req.body || {}).resend === true;
    const resendOf = String((req.body || {}).resend_of || '').trim();
    const mailClient = await pool.connect();
    let emailedAt: any = null;
    let mailSent = false;   // SMTP가 메일을 넘긴 뒤인가 — COMMIT 실패 시 안내를 가르는 축
    // 타임아웃은 "실패"가 아니라 **발송 여부 미확정**이다 — 우리가 기다리기를 그만둔 것이고
    // SMTP는 그 뒤에도 전달을 끝낼 수 있다. 일반 실패로 내리면 운영자가 다시 눌러 중복 발송한다.
    let mailTimedOut = false;
    const MAIL_TOTAL_TIMEOUT_MS = 60000;
    try {
      await mailClient.query('BEGIN');
      // 잠금 대기 상한 — SMTP를 잠금 안에서 하므로 대기자가 커넥션을 무한정 물면 풀이 마른다(기본 20).
      // 10초면 정상 발송(수 초)은 통과하고, 앞 건이 길어질 때 뒤 요청은 커넥션을 놓고 물러난다.
      await mailClient.query(`SET LOCAL lock_timeout = '10s'`);
      const locked = await mailClient.query(
        'SELECT id, emailed_at, emailed_to, email_sent_at FROM billings WHERE id = $1::uuid FOR UPDATE',
        [req.params.id],
      );
      if (locked.rows.length === 0) {
        await mailClient.query('ROLLBACK');
        return res.status(404).json({ error: '발송 준비 중 정산이 삭제되었습니다. 메일은 발송되지 않았습니다.' });
      }
      // 판정은 **잠근 행**으로 한다 — 트랜잭션 밖에서 읽은 값으로 판정하면 그 사이 나간 메일을 못 본다.
      const already = locked.rows[0];
      const lastSentAt = already.emailed_at || already.email_sent_at || null;
      const alreadySent = Boolean(lastSentAt);
      const confirmedThisOne = allowResend && !!resendOf && !!lastSentAt
        && new Date(resendOf).getTime() === new Date(lastSentAt).getTime();
      if (alreadySent && !confirmedThisOne) {
        await mailClient.query('ROLLBACK');
        return res.status(409).json({
          error: allowResend && resendOf
            ? `확인한 뒤 다른 발송이 있었습니다 (${already.emailed_to || '수신자 미상'}). 최신 발송 이력을 확인하고 다시 시도해 주세요.`
            : `이미 발송된 정산서입니다 (${already.emailed_to || '수신자 미상'}). 다시 보내려면 재발송을 확인해 주세요.`,
          code: 'BILLING_ALREADY_EMAILED',
          emailed_at: lastSentAt,
          emailed_to: already.emailed_to,
        });
      }

      const marked = await mailClient.query(
        `UPDATE billings SET email_sent_at = now(), emailed_at = now(), emailed_to = $2, emailed_by = $3, updated_at = now()
          WHERE id = $1::uuid RETURNING emailed_at`,
        [req.params.id, sendTo, adminId],
      );
      emailedAt = marked.rows[0]?.emailed_at || null;

      // ★ 2026-08-04 컨펌 토큰을 **같은 트랜잭션에서** 확보한다 — 메일은 나갔는데 추적행이 없으면
      //   업체가 링크를 눌러도 유효하지 않은 링크가 되고, 이의를 낼 창구가 다시 사라진다.
      //   살아 있는 추적행이 있으면 그 토큰을 그대로 쓴다(재발송에도 링크가 바뀌지 않는다).
      //
      //   토큰을 못 만들면 **보내지 않는다.** 컨펌 블록만 빼고 보내면 업체는 이의를 낼 창구가 없는데
      //   3일 뒤 자동 계산서는 그대로 나간다 — 조용히 빠지는 쪽이 더 나쁘다(fail-closed).
      let token: string;
      try {
        token = await ensureConfirmationToken(mailClient, {
          billingId: String(req.params.id),
          companyId: String(bil.company_id),
          userId: bil.user_id ? String(bil.user_id) : null,
          email: sendTo,
          cc: ccList,
          billingEnd: bEnd,
        });
      } catch (tokenErr: any) {
        const tmsg = String(tokenErr?.message || '');
        if (tmsg.includes('does not exist') && (tmsg.includes('relation') || tmsg.includes('column'))) {
          throw new Error('DB 마이그레이션 필요 — invoice_confirmations 테이블·컬럼 확인 요청. 컨펌 링크 없는 정산서는 보내지 않습니다.');
        }
        throw tokenErr;
      }
      const viewUrl = `${String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '')}/api/invoice-view/${token}`;
      const htmlBody = buildHtmlBody(viewUrl);

      // SMTP는 잠금 안에서. 타임아웃이 없으면 이 트랜잭션이 커넥션과 잠금을 무한정 붙잡는다.
      //   nodemailer의 `socketTimeout`은 **비활동** 상한이라 총 소요 시간을 못 막는다(6차 ①-1) —
      //   조금씩 계속 오가면 40초를 넘길 수 있다. 그래서 총 시간 상한을 여기서 따로 건다.
      const transporter = getTransporter();
      let mailTimer: NodeJS.Timeout | undefined;
      await Promise.race([
        transporter.sendMail({
          from: `"INVITO 정산" <${process.env.SMTP_USER}>`,
          to: sendTo,
          ...(ccList.length > 0 ? { cc: ccList } : {}),
          bcc: process.env.SMTP_BCC || '',
          subject: subjectOverride || `[INVITO] ${bil.company_name} ${bil.billing_year}년 ${bil.billing_month}월 정산서`,
          html: htmlBody,
          attachments: [{ filename: pdfFilename, path: pdfPath }],
        }).then((info: any) => {
          // ★ 2026-07-31 부분 거부를 성공으로 세지 않는다(판정은 CT — 발송 지점 셋이 같은 규칙).
          if (isRecipientRejected(info, sendTo)) {
            throw new Error(`수신자가 메일 서버에서 거부되었습니다 (${sendTo})`);
          }
          mailSent = true;
        }),
        new Promise((_, reject) => {
          mailTimer = setTimeout(() => {
            mailTimedOut = true;
            reject(new Error(`메일 발송이 ${MAIL_TOTAL_TIMEOUT_MS / 1000}초를 넘겨 기다리기를 중단했습니다`));
          }, MAIL_TOTAL_TIMEOUT_MS);
        }),
      ]).finally(() => { if (mailTimer) clearTimeout(mailTimer); });

      // ★ 2026-08-04 메일이 실제로 나간 지금에야 자동 발행 대상으로 승격한다(정책 manual이면 그대로).
      //   재발송으로 살아난 건도 여기서 마감이 다시 잡혀 "수동에 영영 갇히는" 경로가 사라진다.
      await markConfirmationDelivered(mailClient, {
        billingId: String(req.params.id),
        companyId: String(bil.company_id),
        billingEnd: bEnd,
        email: sendTo,
      });

      await mailClient.query('COMMIT');
    } catch (mailErr: any) {
      // ★ 2026-07-26 Codex 7차 ① — 타임아웃은 **되돌리지 않고 커밋한다.**
      //   `Promise.race`는 우리가 기다리기를 그만두게 할 뿐 `sendMail`을 취소하지 못한다.
      //   그래서 이력을 롤백하면 "메일은 뒤이어 전달됐는데 이력은 없음"이 되고, 다음 클릭이
      //   409 확인을 만나지 못해 **중복 발송**이 된다.
      //   두 불확실 중 고객에게 두 번 가는 쪽을 막는다 — 표시를 남기면 다음 클릭은 반드시 재발송 확인을 거친다.
      if (mailTimedOut) {
        try {
          // 전달 불명 — 컨펌 행은 만들 때부터 `manual_wait`이라 승격하지 않으면 자동 발행이 돌지 않는다.
          //   여기서는 아무것도 승격하지 않고 그대로 커밋한다(발송 표시만 남겨 중복 발송을 막는다).
          await mailClient.query('COMMIT');
          console.error(`[정산][메일발송미확정] billing=${req.params.id} to=${sendTo} — ${MAIL_TOTAL_TIMEOUT_MS / 1000}초 초과로 대기 중단. 발송 여부 불명이라 발송 표시는 남긴다(중복 발송 차단).`);
        } catch (commitErr: any) {
          try { await mailClient.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
          console.error(`[정산][메일발송미확정·이력유실] billing=${req.params.id} to=${sendTo}:`, commitErr?.message || commitErr);
        }
        // 커넥션 반납은 아래 `finally`가 한다 — 여기서 또 부르면 이중 release로 터진다.
        return res.status(504).json({
          error: '메일 서버 응답이 늦어 발송 여부를 확인할 수 없습니다. 고객에게 메일이 갔을 수 있어 발송 이력을 남겨 두었습니다. 수신 확인 후 필요하면 재발송해 주세요.',
          code: 'BILLING_EMAIL_SEND_UNCERTAIN',
        });
      }
      try { await mailClient.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
      console.error(`[정산][메일발송실패] billing=${req.params.id} to=${sendTo} 발송여부=${mailSent ? '나감' : '미발송'}:`, mailErr?.message || mailErr);
      // ★ 발송은 됐는데 COMMIT이 실패한 경우(6차 ①-3) — 메일은 회수 불가인데 이력은 롤백됐다.
      //   이걸 일반 실패로 내리면 운영자가 다시 눌러 **중복 발송**한다(409 확인도 이력이 없어 안 걸린다).
      //   그래서 전용 코드로 "나갔을 수 있다"를 알린다. 되돌릴 수 없는 상태는 숨기지 않는다.
      if (mailSent) {
        console.error(`[정산][메일이력유실] billing=${req.params.id} to=${sendTo} — 메일은 발송됐고 발송 이력은 기록되지 않았다. 수동 확인 필요.`);
        return res.status(500).json({
          error: '메일은 발송됐지만 발송 이력 기록에 실패했습니다. 고객에게는 메일이 갔을 수 있으니 수신 확인 후 재발송을 판단해 주세요.',
          code: 'BILLING_EMAIL_LOG_LOST',
        });
      }
      // ★ 타임아웃 = 발송 여부 미확정. 우리가 기다리기를 그만뒀을 뿐이고 SMTP는 뒤이어 전달을 끝낼 수 있다.
      //   이력은 롤백됐으므로 재발송 확인(409)도 걸리지 않는다 — 그 사실을 그대로 알려 중복 발송을 막는다.
      if (mailTimedOut) {
        console.error(`[정산][메일발송미확정] billing=${req.params.id} to=${sendTo} — ${MAIL_TOTAL_TIMEOUT_MS / 1000}초 초과로 대기 중단. 발송 여부 불명, 이력 미기록.`);
        return res.status(504).json({
          error: '메일 서버 응답이 늦어 발송 여부를 확인할 수 없습니다. 고객에게 메일이 갔을 수 있으니 수신 확인 후 재발송을 판단해 주세요.',
          code: 'BILLING_EMAIL_SEND_UNCERTAIN',
        });
      }
      throw mailErr;
    } finally {
      mailClient.release();
    }

    // ★ `success: true`를 반드시 담는다 — 화면이 이 필드로 성공을 판정한다(없으면 실발송을 실패로 표시).
    return res.json({
      success: true,
      message: '정산서 메일이 발송되었습니다.',
      sent_to: sendTo,
      emailed_to: sendTo,
      emailed_at: emailedAt,
    });
  } catch (error: any) {
    console.error('정산서 메일 발송 오류:', error);
    return res.status(500).json({ error: '메일 발송에 실패했습니다: ' + error.message });
  }
});

// ============================================================
//  거래내역서 메일 발송 (리터럴 라우트 — /:id 보다 먼저!)
// ============================================================

// POST /invoices/:id/send-email - 거래내역서 PDF 메일 발송
router.post('/invoices/:id/send-email', async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');

    // 1) 거래내역서 + 회사 정보 조회
    const inv = await loadInvoicePdfData(req.params.id);
    if (!inv) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }

    // ★ 2026-07-31 수신자는 `billing_recipients`(CT) 단일 원장. 계정 축은 사업자 판정과 같은 값을 쓴다.
    const invTo = await resolveBillingRecipients(
      String(inv.company_id),
      inv.billing_user_id ? String(inv.billing_user_id) : null,
      'statement',
    );
    const invSendTo = String(invTo.primary?.email || '');
    if (!invSendTo) {
      return res.status(400).json({ error: '고객사 담당자 이메일이 등록되어 있지 않습니다.' });
    }

    // 2) PDF는 여기서 만든다 (★2026-07-28 — 위 정산서 메일과 같은 이유. 다운로드 선행 요구 폐기)
    const bStart = toDayKey(inv.billing_start);
    const bEnd = toDayKey(inv.billing_end);
    const { pdfPath, displayFilename } = await renderInvoicePdf(inv);
    const pdfFilename = displayFilename;

    const n = (v: any) => Number(v) || 0;

    // 3) 메일 발송
    const htmlBody = `
      <div style="font-family: 'Apple SD Gothic Neo', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #4338ca, #6366F1); padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 20px;">📋 거래내역서 안내</h2>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${inv.company_name}${inv.store_name ? ` / ${inv.store_name}` : ''} | ${bStart} ~ ${bEnd}</p>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #E5E7EB; border-top: none;">
          <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">
            안녕하세요, ${inv.contact_name || inv.company_name} 담당자님.<br/>
            <strong>${bStart} ~ ${bEnd}</strong> 기간 거래내역서를 안내드립니다.
          </p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
            ${n(inv.sms_success_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">SMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.sms_success_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.sms_success_count) * n(inv.sms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(inv.lms_success_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">LMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.lms_success_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.lms_success_count) * n(inv.lms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(inv.mms_success_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">MMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.mms_success_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.mms_success_count) * n(inv.mms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(inv.spam_filter_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6; background: #FEF3C7;">
              <td style="padding: 8px 0; color: #6B7280;">스팸필터</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.spam_filter_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.spam_filter_count) * n(inv.spam_filter_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
          </table>
          <div style="background: #EEF2FF; padding: 16px; border-radius: 8px; text-align: right;">
            <span style="font-size: 13px; color: #6B7280;">공급가액 ₩${n(inv.subtotal).toLocaleString()} + VAT ₩${n(inv.vat).toLocaleString()}</span><br/>
            <span style="font-size: 20px; font-weight: 700; color: #4338CA;">합계 ₩${n(inv.total_amount).toLocaleString()}</span>
          </div>
          <p style="font-size: 13px; color: #9CA3AF; margin-top: 16px;">
            상세 내역은 첨부된 PDF를 확인해주세요.<br/>
            문의사항이 있으시면 ${INVITO_INFO.phone}로 연락 부탁드립니다.
          </p>
        </div>
        <div style="padding: 16px; text-align: center; font-size: 11px; color: #9CA3AF; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; background: #F9FAFB;">
          본 메일은 INVITO 한줄로 시스템에서 자동 발송되었습니다.
        </div>
      </div>
    `;

    const transporter = getTransporter();
    const invMailInfo: any = await transporter.sendMail({
      from: `"INVITO 정산" <${process.env.SMTP_USER}>`,
      to: invSendTo,
      ...(invTo.cc.length > 0 ? { cc: invTo.cc } : {}),
      bcc: process.env.SMTP_BCC || '',
      subject: `[INVITO] ${inv.company_name}${inv.store_name ? ` (${inv.store_name})` : ''} 거래내역서 (${bStart} ~ ${bEnd})`,
      html: htmlBody,
      attachments: [{ filename: pdfFilename, path: pdfPath }],
    });

    // ★ 2026-07-31 같은 판정을 여기에도 — 세 번째 발송 경로만 빠져 있었다(Codex 2R 범위 밖 지적).
    //   발송 기록을 남기기 **전에** 본다. 뒤에 두면 안 나간 메일이 "발송됨"으로 굳는다.
    if (isRecipientRejected(invMailInfo, invSendTo)) {
      return res.status(502).json({ error: `수신자가 메일 서버에서 거부되었습니다 (${invSendTo})` });
    }

    // 4) 발송 기록
    await pool.query(
      'UPDATE billing_invoices SET email_sent_at = now(), updated_at = now() WHERE id = $1',
      [req.params.id]
    );

    return res.json({ message: '거래내역서 메일이 발송되었습니다.', sent_to: invSendTo, cc: invTo.cc });
  } catch (error: any) {
    if (isMigrationPending(error)) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — billing_contacts 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('거래내역서 메일 발송 오류:', error);
    return res.status(500).json({ error: '메일 발송에 실패했습니다: ' + error.message });
  }
});

export default router;
