/**
 * ★ CT: 거래내역서 발송·컨펌 추적 생성 (2026-07-28)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §3·§4.
 * 일괄발급 배치가 발행 성공 직후 호출한다 — 장(billing)마다 수신자를 해석해
 * 메일을 보내고 `invoice_confirmations` 행(토큰·타이머)을 남긴다.
 *
 * 원칙:
 *  - 수신자 해석: `billing_recipients`(CT) 단일 원장. 계정 장(by_user) = 그 계정 수신자 / 회사 장·공통 장 = 회사 레벨.
 *    대표 1명만 토큰 행을 받고 참조는 사본(cc)만 받는다 — 여러 명이 각각 컨펌·이의를 내면 상태가 갈라진다.
 *  - 이메일 없는 수신자 = 그 장은 자동화에서 빠진다(행을 만들지 않는다 — 타이머가 돌면 안 된다).
 *  - **메일 발송 성공 후에만 행을 INSERT한다.** 반대로 하면 SMTP 실패 시 고객이 링크를 못 받았는데
 *    3일 타이머가 돌아 자동 발급으로 이어진다 — 돈에 닿는 방향이라 죽은 링크(희귀)보다 나쁘다.
 *  - 메일 문안은 초안이다(Harold 검토 예정 — 설계문서 §9).
 */

import { randomBytes } from 'crypto';
import { unlinkSync } from 'node:fs';
import nodemailer from 'nodemailer';
import pool from '../config/database';
import {
  getCompanyBillingSettings,
  computeTaxbillIssueDate, computeTaxbillDueAt,
} from './billing-settings';
// ★ 2026-07-31 수신자는 billing_recipients가 소유한다(CT). 그전엔 billing_contacts의 컬럼 한 쌍이라
//   유형별로도 인원수로도 늘어나지 못했고, 개별 메일 경로는 companies.contact_email을 따로 보고 있었다.
import { listBillingRecipients, pickRecipients, isRecipientRejected } from './billing-recipients';
// ★ 2026-07-28 거래내역서 PDF를 메일에 첨부한다. 첨부가 없어서 웹페이지에서 항목표를 다시 그려야 했고,
//   그 페이지가 "확인"과 "컨펌"을 한 화면에 섞어 버튼 뜻이 흐려졌다(Harold 2026-07-28).
//   장(billings 행)마다 PDF가 따로다 — 전체 발급은 한 장, 계정별 발급은 계정 장 각각 + 공통 장.
import { loadBillingStatementData, renderBillingStatementPdf } from './billing-pdf';
import { buildInvoiceLines, checkInvoiceLinesAgainstHeader } from './billing-invoice-lines';
import { INVITO_INFO } from '../config/defaults';

/** 발송 총시간 상한(ms) — send-email 라우트와 동일 60초. 행 잠금·풀 커넥션 체류의 상한이다. */
const MAIL_TOTAL_TIMEOUT_MS = 60_000;

const getTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hiworks.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 40000,
});

const esc = (s: any) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface SheetForConfirm {
  id: string;
  scope: string;           // 'combined' | 'by_user' | 'common'
  user_id: string | null;
  total_amount: any;
}

/**
 * 컨펌 버튼 + 이의 안내 — **두 발송 경로가 같은 문구를 쓴다.**
 *
 * ★ 2026-08-04 신설(서수란 0803·0804 접수). 정산서 메일이 두 벌이었는데 컨펌·이의 안내가
 * 일괄발급 쪽에만 있었다. 개별 발송(정산 목록의 발송 모달)으로 나간 메일에는 버튼도 이의 링크도
 * 없어서, 업체가 "수량이 다르다"고 말할 창구 자체가 그 메일에 없었다(제주한라병원 LMS 3건 차이).
 * 본문 전체를 합치지 않고 이 블록만 공용으로 둔다 — 문구가 한 곳이면 갈라지지 않는다.
 */
export function renderConfirmBlockHtml(viewUrl: string): string {
  return `
      <div style="text-align:center;margin:20px 0 0;">
        <a href="${viewUrl}" style="display:inline-block;padding:14px 30px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">컨펌하기</a>
      </div>
      <p style="font-size:12px;color:#6b7280;line-height:1.7;margin:14px 0 0;">
        컨펌해 주시면 세금계산서 발행이 진행됩니다.<br/>
        3일 안에 응답이 없으면 내역이 확정된 것으로 보고 발행이 진행됩니다.<br/>
        <b>수량이나 금액이 다르면 같은 화면에서 이의신청을 남겨 주세요.</b> 확인 후 정정해 다시 보내드립니다.
      </p>`;
}

/**
 * 이 장의 컨펌 토큰을 확보한다 — 살아 있는 추적행이 있으면 그 토큰, 없으면 만든다.
 *
 * **호출측 트랜잭션 안에서 부른다**(client를 받는 이유) — 발송 표시와 같은 트랜잭션이어야
 * "메일은 나갔는데 추적행이 없는" 상태가 생기지 않는다.
 *
 * 수신자를 화면에서 바꿔 보내도 **기존 추적행의 `recipient_email`은 건드리지 않는다.**
 * 추적행은 장당 하나이고 누가 링크를 누르든 한 곳에만 기록돼야 상태가 갈라지지 않는다.
 */
export async function ensureConfirmationToken(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  opts: {
    billingId: string;
    companyId: string;
    /** 계정 장이면 그 계정, 회사·공통 장이면 null */
    userId: string | null;
    /** 새로 만들 때 기록할 수신자 */
    email: string;
    cc: string[];
    /** 청구 종료일(YYYY-MM-DD) — 계산서 발행일·마감 계산 기준 */
    billingEnd: string;
  },
): Promise<string> {
  const found = await client.query(
    `SELECT token FROM invoice_confirmations
      WHERE billing_id = $1::uuid AND superseded_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [opts.billingId],
  );
  if (found.rows.length > 0) return String(found.rows[0].token);

  const settings = await getCompanyBillingSettings(opts.companyId);
  const token = randomBytes(24).toString('hex'); // 48자 — 컬럼 varchar(64)
  await client.query(
    // ★ 2026-08-04 **`manual_wait`으로 만든다**(Codex 재검증 critical) — 자동 발행 타이머는
    //   메일이 실제로 나간 뒤에만 돌아야 한다. `pending`으로 먼저 만들면 SMTP 실패·타임아웃으로
    //   고객이 못 받았는데도 3일 뒤 세금계산서가 자동 발행된다. 승격은 `markConfirmationDelivered`.
    `INSERT INTO invoice_confirmations (
       billing_id, company_id, recipient_user_id, recipient_email, token,
       sent_at, taxbill_status, taxbill_issue_date, taxbill_due_at, cc_emails
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, NOW(), 'manual_wait', $6::date, $7, $8::text[])`,
    [
      opts.billingId, opts.companyId, opts.userId, opts.email, token,
      computeTaxbillIssueDate(settings.taxbillDayPolicy, opts.billingEnd),
      computeTaxbillDueAt(Date.now(), opts.billingEnd),
      opts.cc.length > 0 ? opts.cc : null,
    ],
  );
  return token;
}

/**
 * 메일이 실제로 나간 뒤 컨펌 행을 **자동 발행 대상으로 승격**한다.
 *
 * ★ 2026-08-04 신설(Codex 재검증 critical·high). 전달 여부와 자동 발행 정책이 한 컬럼에 섞여 있어
 * ①전달 전에 타이머가 돌고 ②전달 불명으로 내려둔 행이 재발송에 성공해도 영영 수동에 갇혔다.
 * 이제 만들 때는 항상 멈춰 있고, **여기서만** 정책대로 열린다. 마감은 실제 발송 시각 기준으로 다시 잡는다.
 * 회사 정책이 `manual`(직접선택)이면 승격하지 않는다 — 그건 전달 상태가 아니라 정책이다.
 */
export async function markConfirmationDelivered(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  opts: { billingId: string; companyId: string; billingEnd: string; email?: string },
): Promise<void> {
  const settings = await getCompanyBillingSettings(opts.companyId);
  if (settings.taxbillDayPolicy === 'manual') return;
  await client.query(
    `UPDATE invoice_confirmations
        SET taxbill_status = 'pending', sent_at = NOW(), taxbill_due_at = $2,
            recipient_email = COALESCE($3, recipient_email)
      WHERE billing_id = $1::uuid AND superseded_at IS NULL AND taxbill_status = 'manual_wait'`,
    [opts.billingId, computeTaxbillDueAt(Date.now(), opts.billingEnd), opts.email || null],
  );
}

export interface ConfirmSendSummary {
  sent: number;            // 메일 발송 + 추적 행 생성
  skippedNoEmail: number;  // 담당자 이메일 미등록 — 자동화 제외
  mailFailed: number;      // SMTP 실패 — 행 미생성(수동 재발송 대상)
  manualWait: number;      // 직접선택 정책 — 자동 발급 제외로 생성된 행 수
  // ★ 2026-07-28 두 축을 나눈다 — 하나로 세면 일시적 디스크 장애에도 운영자가 멀쩡한 묶음을 지우고 재발행한다.
  mismatchBlocked: number; // 항목합 ≠ 공급가액. 금액이 틀린 문서라 **재발송으로 안 풀린다** — 삭제 후 재발행
  renderFailed: number;    // 조회·렌더·디스크 장애. 금액과 무관하니 **재시도하면 풀린다** — 삭제 대상 아님
}

// ═══════════════════════════════════════════════════════════
// 미발송 재시도 (★2026-07-28 재구성)
// ═══════════════════════════════════════════════════════════
//
// 발행은 메일 단계보다 **먼저 커밋된다.** 그래서 발송이 막히면 장은 남고 메일만 안 나간 상태가 되는데,
// 일괄발급을 다시 돌리면 기존 장 때문에 `BILLING_PERIOD_OVERLAP`에 먼저 막혀 재시도할 길이 없었다.
// ⇒ **발행은 그대로 두고 통지 단계만 다시 태운다.**
//
// 재구성 후에는 별도 판정이 필요 없다 — 적재 단계가 "이미 나갔거나 살아 있는 추적행이 있으면 건너뛴다"를
// 트랜잭션 안에서 보장하므로, 같은 함수를 그대로 다시 부르면 그것이 곧 멱등 재시도다.
// 여기서는 "어느 장들을 다시 태울지"만 고른다.

export interface RetryResult extends ConfirmSendSummary {
  /** 재시도 대상으로 잡힌 장 수. 0이면 보낼 것이 없었다는 뜻(이미 다 나갔거나 장을 못 찾았다). */
  targeted: number;
  companyName: string | null;
}

export async function retryUnsentConfirmations(billingId: string): Promise<RetryResult> {
  const empty: RetryResult = {
    sent: 0, skippedNoEmail: 0, mailFailed: 0, manualWait: 0,
    mismatchBlocked: 0, renderFailed: 0, targeted: 0, companyName: null,
  };

  // 입력은 **장 id**다. `batch_id`는 장이 2개 이상일 때만 생기므로(billing-issue.ts),
  // batch 기준으로만 받으면 기본 단위인 전체 발급(장 1개)에 복구 경로가 닿지 않는다.
  // 장이 묶음의 일부면 형제 장까지 함께 태운다.
  const r = await pool.query(
    `WITH target AS (
       SELECT batch_id, company_id, billing_start, billing_end FROM billings WHERE id = $1::uuid
     )
     SELECT b.id, b.scope, b.user_id, b.total_amount, b.company_id,
            to_char(b.billing_start, 'YYYY-MM-DD') AS billing_start,
            to_char(b.billing_end,   'YYYY-MM-DD') AS billing_end,
            c.company_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       JOIN target t ON (
              (t.batch_id IS NOT NULL
                AND b.batch_id = t.batch_id AND b.company_id = t.company_id
                AND b.billing_start = t.billing_start AND b.billing_end = t.billing_end)
           OR (t.batch_id IS NULL AND b.id = $1::uuid)
            )
      WHERE b.emailed_at IS NULL
      ORDER BY b.id`,
    [billingId],
  );
  if (r.rows.length === 0) return empty;

  const first = r.rows[0];
  const summary = await createAndSendConfirmations({
    companyId: String(first.company_id),
    companyName: String(first.company_name || ''),
    billingStart: String(first.billing_start),
    billingEnd: String(first.billing_end),
    sheets: r.rows.map((row: any) => ({
      id: String(row.id), scope: String(row.scope), user_id: row.user_id ? String(row.user_id) : null,
      total_amount: row.total_amount,
    })),
  });
  return { ...summary, targeted: r.rows.length, companyName: String(first.company_name || '') };
}
/** 발행 직후 장별 메일 발송 + 컨펌 추적 행 생성. 실패는 집계로 돌려주고 던지지 않는다(발행 자체는 성공이다). */
export async function createAndSendConfirmations(opts: {
  companyId: string;
  companyName: string;
  billingStart: string;
  billingEnd: string;
  sheets: SheetForConfirm[];
}): Promise<ConfirmSendSummary> {
  const { companyId, companyName, billingStart, billingEnd, sheets } = opts;
  const summary: ConfirmSendSummary = {
    sent: 0, skippedNoEmail: 0, mailFailed: 0, manualWait: 0,
    mismatchBlocked: 0, renderFailed: 0,
  };

  const settings = await getCompanyBillingSettings(companyId);
  // 계정 장(by_user)이면 그 계정 수신자, 아니면 회사 레벨 — 판정은 CT가 한다(축이 갈리면 화면마다 대상이 달라진다).
  const recipientRows = await listBillingRecipients(companyId);

  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  const periodLabel = `${billingStart} ~ ${billingEnd}`;
  const issueDate = computeTaxbillIssueDate(settings.taxbillDayPolicy, billingEnd);
  const initialStatus = settings.taxbillDayPolicy === 'manual' ? 'manual_wait' : 'pending';

  const transporter = getTransporter();

  // ═══ 1단계: 적재 — "누가 통지 대상인가"를 **메일보다 먼저 DB에 확정한다** ═══
  //
  // ★ 2026-07-28 재구성. 그전에는 발송이 성공한 뒤에야 추적행을 만들었다. 그래서 "이 장이 통지됐는가"의
  //   진실이 메일이 나간 뒤에만 생겼고, 중간에 무엇이든 어긋나면 상태가 어디에도 남지 않았다.
  //   부분 발송·중복 발송·고아 PDF·커넥션 고갈은 전부 그 하나에서 파생된 가지였다 —
  //   preflight, 회사 세션 잠금, 발송 직전 재확인, 렌더본 추적을 하나씩 덧대도 다음 구멍이 계속 나왔다.
  //   ⇒ 행을 **먼저** 만든다. 이 트랜잭션이 끝나면 대상자 명단은 DB에 있고, 그 뒤 무엇이 실패해도
  //     남은 행이 곧 재시도 목록이다. 그래서 덧댔던 장치들이 전부 필요 없어졌다.
  //
  // 여기서 메일을 보내지 않고 PDF도 만들지 않는다(2단계에서 장별로 만든다 — 안 나간 렌더본이 남지 않는다).
  type Claimed = { sheet: SheetForConfirm; name: string | null; email: string; cc: string[]; token: string };
  const claimed: Claimed[] = [];
  const claimClient = await pool.connect();
  try {
    await claimClient.query('BEGIN');
    await claimClient.query(`SET LOCAL lock_timeout = '10s'`);
    for (const sheet of sheets) {
      const resolved = pickRecipients(
        recipientRows,
        sheet.scope === 'by_user' && sheet.user_id ? String(sheet.user_id) : null,
        'statement',
      );
      const email = String(resolved.primary?.email || '').trim();
      if (!email) {
        // 이메일 미등록은 그 장만 자동 발송에서 빠지는 정상 경로다 — 다른 장을 멈추지 않는다.
        summary.skippedNoEmail += 1;
        continue;
      }
      // 장을 잠그고, 이미 나갔거나 살아 있는 추적행이 있으면 건너뛴다. 이 두 조건이 중복 발송 자물쇠다.
      const row = await claimClient.query(
        `SELECT b.id, b.emailed_at,
                EXISTS (SELECT 1 FROM invoice_confirmations ic
                         WHERE ic.billing_id = b.id AND ic.superseded_at IS NULL) AS has_confirmation
           FROM billings b WHERE b.id = $1::uuid FOR UPDATE`,
        [sheet.id],
      );
      if (row.rows.length === 0) {
        console.error(`[일괄발급][장없음] billing=${sheet.id} — 적재 중 장이 사라져 건너뛴다.`);
        summary.mailFailed += 1;
        continue;
      }
      if (row.rows[0].emailed_at || row.rows[0].has_confirmation === true) {
        console.log(`[일괄발급][이미적재] billing=${sheet.id} — 추적행이 이미 있거나 발송된 장이다. 다시 만들지 않는다.`);
        continue;
      }
      const token = randomBytes(24).toString('hex'); // 48자 — 컬럼 varchar(64)
      await claimClient.query(
        `INSERT INTO invoice_confirmations (
           billing_id, company_id, recipient_user_id, recipient_email, token,
           sent_at, taxbill_status, taxbill_issue_date, taxbill_due_at, cc_emails
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, NOW(), $6, $7::date, $8, $9::text[])`,
        [
          sheet.id, companyId,
          sheet.scope === 'by_user' ? sheet.user_id : null,
          // ★ 2026-08-04 적재는 항상 멈춘 상태로 — 자동 발행 타이머는 메일이 실제로 나간 뒤에만 돈다.
          //   승격은 아래 2단계의 발송 성공 지점에서 `markConfirmationDelivered`가 한다.
          email, token, 'manual_wait', issueDate,
          computeTaxbillDueAt(Date.now(), billingEnd),
          // 참조는 사본만 받는다 — 토큰 행을 따로 만들면 A는 컨펌·B는 이의인 상태가 생겨 판정이 갈라진다.
          resolved.cc.length > 0 ? resolved.cc : null,
        ],
      );
      claimed.push({ sheet, name: resolved.primary?.name ?? null, email, cc: resolved.cc, token });
    }
    await claimClient.query('COMMIT');
  } catch (claimErr: any) {
    try { await claimClient.query('ROLLBACK'); } catch { /* 아래 로그가 사실을 전달한다 */ }
    console.error(`[일괄발급][적재실패] company=${companyId} — ${claimErr?.message || claimErr}. 메일은 한 통도 나가지 않았다.`);
    summary.mailFailed += sheets.length;
    return summary;
  } finally {
    claimClient.release();
  }

  // ═══ 2단계: 전송 — 적재된 행을 하나씩 실제로 내보낸다 ═══
  //   여기서 무엇이 실패해도 행은 남는다. 남은 행이 곧 재시도 목록이라 "부분 발송"이 복구 가능한 상태가 된다.
  //   PDF는 보내기 직전에 만든다 — 안 나간 렌더본이 디스크에 남지 않는다.
  for (const { sheet, name, email, cc, token } of claimed) {
    const viewUrl = `${base}/api/invoice-view/${token}`;
    const amount = Number(sheet.total_amount) || 0;

    // ★ 2026-07-28 버튼은 하나다. 내역은 첨부 PDF가 담당하고, 이 링크는 컨펌 화면으로만 보낸다.
    //   ("확인 · 컨펌"으로 붙여두면 누르는 순간 컨펌된 것처럼 읽힌다 — Harold 2026-07-28)
    const html = `
      <div style="max-width:560px;margin:0 auto;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1f2937;">
        <div style="padding:28px 24px;border:1px solid #e5e7eb;border-radius:12px;">
          <p style="font-size:18px;font-weight:700;margin:0 0 4px;">거래내역서를 보내드립니다</p>
          <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">${esc(companyName)} · ${esc(periodLabel)}</p>
          <p style="font-size:14px;line-height:1.7;margin:0 0 16px;">
            안녕하세요, ${esc(name || '담당자')}님.<br/>
            ${esc(periodLabel)} 이용분 거래내역서를 <b>첨부</b>해 드렸습니다. 내용을 확인하신 뒤 아래 버튼을 눌러 주세요.
          </p>
          <p style="font-size:15px;margin:0 0 20px;">청구 금액(부가세 포함): <b>${amount.toLocaleString()}원</b></p>
${renderConfirmBlockHtml(viewUrl)}
        </div>
      </div>`;

    // 이 장의 PDF는 **보내기 직전에** 만든다. 미리 만들어 두면 발송이 막힌 회차마다 렌더본이 그대로 쌓인다.
    //   정합 검사는 다운로드 라우트와 같은 것을 쓴다 — 항목합이 공급가액과 어긋나는 문서는 회수가 안 된다.
    let attachment: { filename: string; path: string };
    try {
      const pdfData = await loadBillingStatementData(sheet.id);
      if (!pdfData) throw new Error('정산 행을 찾지 못했습니다');
      const check = checkInvoiceLinesAgainstHeader(
        buildInvoiceLines(pdfData.items),
        Number(pdfData.bil.ai_credit_supply) || 0,
        Number(pdfData.bil.subtotal) || 0,
      );
      if (!check.ok) {
        console.error(`[일괄발급][정합실패] billing=${sheet.id} — 항목합 ${check.linesSum} + 크레딧 ${check.aiCreditSupply} ≠ 공급가액 ${check.subtotal} (차이 ${check.diff}). 금액을 정정한 뒤 재시도해야 한다.`);
        summary.mismatchBlocked += 1;
        continue; // 추적행은 남는다 — 금액을 고치면 [메일 재시도]로 그대로 이어진다
      }
      const rendered = await renderBillingStatementPdf(pdfData.bil, pdfData.items);
      attachment = { filename: rendered.displayFilename, path: rendered.pdfPath };
    } catch (pdfErr: any) {
      console.error(`[일괄발급][PDF실패] billing=${sheet.id} — ${pdfErr?.message || pdfErr}. 재시도 가능한 장애다.`);
      summary.renderFailed += 1;
      continue; // 마찬가지로 추적행이 남아 재시도 대상이 된다
    }

    // 발송 표시를 SMTP **앞에** 남기고 그 트랜잭션 안에서 보낸다(이 레포의 정석 — 발송 중 삭제 차단).
    //   실패하면 ROLLBACK으로 표시가 지워져 추적행과 함께 그대로 재시도 대상이 된다.
    const client = await pool.connect();
    let mailWasSent = false;
    try {
      await client.query('BEGIN');
      // 잠금 대기·발송 총시간에 명시 상한을 건다(nodemailer 타임아웃 3종은 총 소요시간 상한이 아니다).
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      // 발송 소유권을 조건부 UPDATE 하나로 잡는다 — 0행이면 다른 요청이 이미 가져갔다는 뜻이다.
      const claimRes = await client.query(
        `UPDATE billings SET emailed_at = NOW(), emailed_to = $2
          WHERE id = $1::uuid AND emailed_at IS NULL RETURNING id`,
        [sheet.id, email],
      );
      if (claimRes.rowCount === 0) {
        await client.query('ROLLBACK');
        try { unlinkSync(attachment.path); } catch { /* 안 나간 렌더본은 남기지 않는다 */ }
        console.log(`[일괄발급][중복차단] billing=${sheet.id} — 다른 요청이 먼저 가져갔다(또는 장이 사라졌다).`);
        continue;
      }
      await client.query(
        `UPDATE billings SET emailed_at = COALESCE(emailed_at, NOW()), emailed_to = COALESCE(emailed_to, $2)
          WHERE id = $1::uuid`,
        [sheet.id, email],
      );

      // 총 60초 상한 — 넘으면 발송 여부 불확정. sendMail은 취소되지 않으므로 "안 갔다"로 단정할 수 없다.
      let mailTimedOut = false;
      const mailInfo: any = await Promise.race([
        transporter.sendMail({
          // 고객문의 메일과 같은 계정(SMTP_USER)이다 — 표시명·회신 주소만 명시한다.
          from: `"한줄로" <${process.env.SMTP_USER || INVITO_INFO.email}>`,
          replyTo: INVITO_INFO.email,
          to: email,
          // 참조는 같은 본문을 사본으로 받는다 — 그 안의 컨펌 링크로 참조도 컨펌할 수 있다(의도).
          //   상태는 갈라지지 않는다: 추적행이 장당 하나뿐이라 누가 누르든 한 곳에만 기록된다.
          ...(cc.length > 0 ? { cc } : {}),
          subject: `[한줄로] ${companyName} 거래내역서 (${billingStart.slice(0, 7)}) — 확인 요청`,
          html,
          attachments: [attachment],
        }),
        new Promise((_, reject) => setTimeout(() => { mailTimedOut = true; reject(new Error('MAIL_TOTAL_TIMEOUT')); }, MAIL_TOTAL_TIMEOUT_MS)),
      ]).catch(async (raceErr) => {
        if (mailTimedOut) {
          // 발송 불확정 — 표시를 **커밋해 남긴다**(전달됐을 수 있으므로 중복 발송을 막는 쪽을 택한다).
          //   추적행은 이미 1단계에서 만들어졌고, 마감은 아래에서 못 채우므로 적재 시점 값이 남는다.
          await client.query('COMMIT');
          console.error(`[일괄발급][발송불확정] billing=${sheet.id} to=${email} — ${MAIL_TOTAL_TIMEOUT_MS / 1000}초 초과. 발송 여부 불명, 표식만 남김. 수동 확인 필요.`);
        }
        throw raceErr;
      });
      // ★ 2026-07-31 부분 거부를 성공으로 세지 않는다(판정은 CT — 발송 지점 셋이 같은 규칙을 쓴다).
      //   여기서 던지면 아래 catch가 ROLLBACK 하고(발송 표시 원복) 추적행은 남아 재시도 대상이 된다.
      if (isRecipientRejected(mailInfo, email)) {
        throw new Error(`대표 수신자가 메일 서버에서 거부되었습니다 (${email})`);
      }
      mailWasSent = true;

      // 실제로 나간 시각으로 추적행을 확정한다. 마감은 **발송일 기준** 3일 뒤 09:00 KST(익월 10일 캡).
      //   적재는 오늘 값으로 넣어두는데, 재시도가 다음 날 성공하면 그날 기준으로 다시 잡혀야 한다.
      // ★ 2026-08-04 여기서 **처음으로** 자동 발행 대상이 된다(정책이 manual이면 그대로 멈춰 있다).
      await markConfirmationDelivered(client, {
        billingId: sheet.id, companyId, billingEnd, email,
      });
      await client.query('COMMIT');
    } catch (err: any) {
      try { await client.query('ROLLBACK'); } catch { /* 타임아웃 경로는 이미 COMMIT됨 — 무해한 no-op */ }
      if (mailWasSent) {
        // 메일은 나갔는데 확정 UPDATE가 롤백됐다 — 표시만 되살려 발송 사실을 보존한다(중복 발송 차단 유지).
        console.error(`[일괄발급][확정실패] billing=${sheet.id} to=${email} — 메일은 발송됨. 수동 확인 필요:`, err?.message || err);
        try {
          await pool.query(
            `UPDATE billings SET emailed_at = COALESCE(emailed_at, NOW()), emailed_to = COALESCE(emailed_to, $2) WHERE id = $1::uuid`,
            [sheet.id, email],
          );
        } catch { /* 장 자체가 사라진 경우 — 위 로그로 충분 */ }
      } else if (String(err?.message) !== 'MAIL_TOTAL_TIMEOUT') {
        console.error(`[일괄발급][메일실패] billing=${sheet.id} to=${email}:`, err?.message || err);
        // 안 나간 첨부는 남기지 않는다. 추적행은 살아 있으니 재시도하면 새로 렌더된다.
        try { unlinkSync(attachment.path); } catch { /* 이미 없으면 그만 */ }
      }
      summary.mailFailed += 1;
      continue;
    } finally {
      client.release();
    }

    summary.sent += 1;
    if (initialStatus === 'manual_wait') summary.manualWait += 1;
  }

  return summary;
}

// ═══════════════════════════════════════════════════════════
// 이의신청 내부 통지 (★2026-08-04 서수란 접수)
// ═══════════════════════════════════════════════════════════
//
// 이의는 DB에만 남고 아무에게도 알리지 않았다 — 현황판에 들어가 봐야 알 수 있었다.
// **이의 트랜잭션에서 메일을 보내지 않는다**: 그 트랜잭션은 발급 큐를 보류하며 회사 자원을 잡고 있고,
// 거기서 SMTP를 기다리면 응답 없는 메일 서버 하나가 그 회사 발행을 통째로 멈춘다
// (0731 `taxbill_email_resends`에서 이미 굳은 계약). `objection_at`이 이미 내구 기록이라
// 별도 큐도 필요 없다 — 워커가 "아직 통지 안 한 이의"를 집어 보낸다.

/** 재시도 상한 — 넘으면 그 행은 더 보내지 않는다(수동 확인 몫). `taxbill_email_resends`와 같은 값. */
const OBJECTION_NOTIFY_MAX_ATTEMPTS = 5;
let objectionRecipientWarned = false;

/** (순수) ENV 수신처 파싱 — 쉼표 구분, 형식이 맞는 주소만. */
export function parseObjectionAlertList(raw: any): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? '').split(',')) {
    const e = part.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

export interface ObjectionNotifyResult { sent: number; failed: number; skipped?: string }

/** 미통지 이의를 내부 담당자에게 메일로 알린다. 워커가 5분마다 부른다. */
export async function processObjectionNotifications(limit = 10): Promise<ObjectionNotifyResult> {
  const to = parseObjectionAlertList(process.env.BILLING_OBJECTION_ALERT_TO);
  const bcc = parseObjectionAlertList(process.env.BILLING_OBJECTION_ALERT_BCC);
  if (to.length === 0 && bcc.length === 0) {
    // 조용히 넘기면 이의가 영영 묻힌다 — 기동 후 한 번은 반드시 남긴다.
    if (!objectionRecipientWarned) {
      objectionRecipientWarned = true;
      console.error('[이의통지] 수신처 미설정(BILLING_OBJECTION_ALERT_TO/BCC) — 이의신청이 들어와도 메일이 나가지 않습니다.');
    }
    return { sent: 0, failed: 0, skipped: '수신처 미설정' };
  }

  // ★ 2026-08-04 패스 전체를 advisory lock으로 단일화한다(Codex 적대검증 high).
  //   조회·시도증가·발송·확정이 각각 다른 트랜잭션이라, tick이 겹치거나 인스턴스가 둘이면
  //   같은 이의를 두 번 보낸다. 세금계산서 재전송 패스와 같은 방식이다.
  // ⚠ 세션 락은 **연결에 귀속**된다 — `pool.query`로 잡고 풀면 해제가 다른 연결에서 돌아 실패하고,
  //   그 사이 소유 연결이 다른 실행에 대여되면 재진입으로 중복 실행이 뚫린다(Codex 재검증 high).
  //   전용 client를 잡아 획득부터 해제까지 그 연결로 유지한다.
  const lockClient = await pool.connect();
  let held = false;
  try {
    const lock = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext('billing-objection-notify')) AS ok`);
    if (!lock.rows[0]?.ok) return { sent: 0, failed: 0, skipped: '다른 실행이 처리 중' };
    held = true;
    return await runObjectionNotifications(limit, to, bcc);
  } finally {
    if (held) {
      try {
        const un = await lockClient.query(`SELECT pg_advisory_unlock(hashtext('billing-objection-notify')) AS ok`);
        if (!un.rows[0]?.ok) console.error('[이의통지] advisory lock 해제 실패 — 연결 반납으로 정리됨');
      } catch (unErr: any) {
        console.error('[이의통지] advisory lock 해제 오류:', unErr?.message || unErr);
      }
    }
    lockClient.release();
  }
}

async function runObjectionNotifications(limit: number, to: string[], bcc: string[]): Promise<ObjectionNotifyResult> {
  const rows = await pool.query(
    `SELECT ic.id, ic.objection_text, ic.recipient_email, ic.token, ic.objection_notify_attempts,
            to_char(ic.objection_at, 'YYYY-MM-DD HH24:MI') AS objection_at,
            to_char(b.billing_start, 'YYYY-MM-DD') AS billing_start,
            to_char(b.billing_end,   'YYYY-MM-DD') AS billing_end,
            b.total_amount, c.company_name
       FROM invoice_confirmations ic
       JOIN billings b ON b.id = ic.billing_id
       JOIN companies c ON c.id = ic.company_id
      WHERE ic.objection_at IS NOT NULL
        AND ic.objection_notified_at IS NULL
        AND ic.objection_notify_attempts < $2
      ORDER BY ic.objection_at
      LIMIT $1`,
    [limit, OBJECTION_NOTIFY_MAX_ATTEMPTS],
  );
  if (rows.rows.length === 0) return { sent: 0, failed: 0 };

  const transporter = getTransporter();
  let sent = 0;
  let failed = 0;
  for (const r of rows.rows) {
    // 시도 횟수를 **보내기 전에** 올린다 — 여기서 죽어도 다음 tick이 같은 행을 무한히 다시 잡지 않는다.
    await pool.query(
      `UPDATE invoice_confirmations SET objection_notify_attempts = objection_notify_attempts + 1 WHERE id = $1::uuid`,
      [r.id],
    );
    const amount = Number(r.total_amount) || 0;
    const html = `
      <div style="max-width:560px;margin:0 auto;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1f2937;">
        <div style="padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
          <p style="font-size:17px;font-weight:700;margin:0 0 4px;">거래내역서 이의신청이 접수됐습니다</p>
          <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">${esc(r.company_name)} · ${esc(r.billing_start)} ~ ${esc(r.billing_end)}</p>
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:6px 0;color:#6b7280;width:110px;">접수 시각</td><td style="padding:6px 0;">${esc(r.objection_at)}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">청구 금액</td><td style="padding:6px 0;">${amount.toLocaleString()}원</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">수신 담당자</td><td style="padding:6px 0;">${esc(r.recipient_email)}</td></tr>
          </table>
          <div style="margin:16px 0 0;padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:14px;line-height:1.7;white-space:pre-wrap;">${esc(r.objection_text)}</div>
          <p style="font-size:12px;color:#6b7280;line-height:1.7;margin:16px 0 0;">
            이 건은 세금계산서 자동 발행에서 제외돼 있습니다.<br/>
            수량·금액을 정정한 뒤 수정 재발행하면 새 컨펌 메일이 나갑니다.
          </p>
        </div>
      </div>`;
    try {
      await transporter.sendMail({
        from: `"한줄로 정산" <${process.env.SMTP_USER || INVITO_INFO.email}>`,
        replyTo: INVITO_INFO.email,
        ...(to.length > 0 ? { to } : {}),
        ...(bcc.length > 0 ? { bcc } : {}),
        subject: `[한줄로] 이의신청 — ${r.company_name} (${String(r.billing_start).slice(0, 7)})`,
        html,
      });
      await pool.query(
        `UPDATE invoice_confirmations SET objection_notified_at = NOW() WHERE id = $1::uuid`,
        [r.id],
      );
      sent += 1;
    } catch (err: any) {
      failed += 1;
      const attemptsNow = (Number(r.objection_notify_attempts) || 0) + 1;
      console.error(`[이의통지][실패] confirmation=${r.id} ${r.company_name} (${attemptsNow}/${OBJECTION_NOTIFY_MAX_ATTEMPTS}):`, err?.message || err);
      // 상한에 닿으면 더는 시도하지 않는다 — 조용히 사라지면 이의가 묻히므로 한 줄을 크게 남긴다.
      if (attemptsNow >= OBJECTION_NOTIFY_MAX_ATTEMPTS) {
        console.error(`[이의통지][포기] confirmation=${r.id} ${r.company_name} — ${OBJECTION_NOTIFY_MAX_ATTEMPTS}회 실패로 자동 통지를 중단합니다. 슈퍼관리자 이의신청 목록에서 직접 확인해주세요.`);
      }
    }
  }
  return { sent, failed };
}
