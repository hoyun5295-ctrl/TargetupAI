/**
 * ★ CT: 거래내역서 발송·컨펌 추적 생성 (2026-07-28)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §3·§4.
 * 일괄발급 배치가 발행 성공 직후 호출한다 — 장(billing)마다 수신자를 해석해
 * 메일을 보내고 `invoice_confirmations` 행(토큰·타이머)을 남긴다.
 *
 * 원칙:
 *  - 수신자 해석: 계정 장(by_user) = 그 계정의 정산 담당자 / 회사 장·공통 장 = 회사 레벨 담당자.
 *  - 이메일 없는 수신자 = 그 장은 자동화에서 빠진다(행을 만들지 않는다 — 타이머가 돌면 안 된다).
 *  - **메일 발송 성공 후에만 행을 INSERT한다.** 반대로 하면 SMTP 실패 시 고객이 링크를 못 받았는데
 *    3일 타이머가 돌아 자동 발급으로 이어진다 — 돈에 닿는 방향이라 죽은 링크(희귀)보다 나쁘다.
 *  - 메일 문안은 초안이다(Harold 검토 예정 — 설계문서 §9).
 */

import { randomBytes } from 'crypto';
import nodemailer from 'nodemailer';
import pool from '../config/database';
import {
  getCompanyBillingSettings, listBillingContacts,
  computeTaxbillIssueDate, computeTaxbillDueAt,
} from './billing-settings';

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

export interface ConfirmSendSummary {
  sent: number;            // 메일 발송 + 추적 행 생성
  skippedNoEmail: number;  // 담당자 이메일 미등록 — 자동화 제외
  mailFailed: number;      // SMTP 실패 — 행 미생성(수동 재발송 대상)
  manualWait: number;      // 직접선택 정책 — 자동 발급 제외로 생성된 행 수
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
  const summary: ConfirmSendSummary = { sent: 0, skippedNoEmail: 0, mailFailed: 0, manualWait: 0 };

  const settings = await getCompanyBillingSettings(companyId);
  const contacts = await listBillingContacts(companyId);
  const companyContact = contacts.find((c) => c.user_id === null) || null;
  const byUser = new Map(contacts.filter((c) => c.user_id).map((c) => [String(c.user_id), c]));

  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  const periodLabel = `${billingStart} ~ ${billingEnd}`;
  const issueDate = computeTaxbillIssueDate(settings.taxbillDayPolicy, billingEnd);
  const initialStatus = settings.taxbillDayPolicy === 'manual' ? 'manual_wait' : 'pending';

  const transporter = getTransporter();

  for (const sheet of sheets) {
    const contact = sheet.scope === 'by_user' && sheet.user_id
      ? (byUser.get(String(sheet.user_id)) || null)
      : companyContact;
    const email = String(contact?.contact_email || '').trim();
    if (!email) {
      summary.skippedNoEmail += 1;
      continue;
    }

    const token = randomBytes(24).toString('hex'); // 48자 — 컬럼 varchar(64)
    const viewUrl = `${base}/api/invoice-view/${token}`;
    const amount = Number(sheet.total_amount) || 0;

    // ★ 메일 문안 초안 — 확정 문구는 Harold 검토 후 교체(설계문서 §9).
    const html = `
      <div style="max-width:560px;margin:0 auto;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1f2937;">
        <div style="padding:28px 24px;border:1px solid #e5e7eb;border-radius:12px;">
          <p style="font-size:18px;font-weight:700;margin:0 0 4px;">한줄로 거래내역서 확인 요청</p>
          <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">${esc(companyName)} · ${esc(periodLabel)}</p>
          <p style="font-size:14px;line-height:1.7;margin:0 0 16px;">
            안녕하세요, ${esc(contact?.contact_name || '담당자')}님.<br/>
            ${esc(periodLabel)} 이용분 거래내역서가 발행되어 안내드립니다.
          </p>
          <p style="font-size:15px;margin:0 0 20px;">청구 금액(부가세 포함): <b>${amount.toLocaleString()}원</b></p>
          <a href="${viewUrl}" style="display:inline-block;padding:12px 22px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">거래내역서 확인 · 컨펌하기</a>
          <p style="font-size:12px;color:#6b7280;line-height:1.7;margin:20px 0 0;">
            내용 확인 후 [컨펌]을 눌러 주시면 세금계산서 발행이 진행됩니다.<br/>
            내용에 이견이 있으시면 같은 화면의 [이의신청]으로 의견을 남겨 주세요.<br/>
            3일 안에 응답이 없으면 내역이 확정된 것으로 보고 세금계산서 발행이 진행됩니다.
          </p>
        </div>
      </div>`;

    // ★ Codex 3R HIGH 수용 — 삭제 경합을 **행 잠금 트랜잭션**으로 봉인한다. 마커 선행만으로는
    //   사유를 적은 삭제가 가드를 통과해 "마커 → 삭제 → 발송" 순서가 남았다.
    //   이 코드베이스의 정석을 그대로 미러링한다: 정산서 메일 라우트가 "행 잠금을 든 트랜잭션
    //   안에서 SMTP를 부른다"(위 transporter 주석·타임아웃 15/15/40초로 잠금 시간 유계).
    //   FOR UPDATE를 잡고 있는 동안 삭제는 대기하고, COMMIT 후에는 마커가 보여 발송 보호에 걸린다.
    //   실패 모드: 발송 실패 → ROLLBACK(마커·행 없음, 메일도 없음 — 깨끗). 발송 후 DB 실패 →
    //   ROLLBACK 후 마커만 자동커밋으로 재적용(발송 사실 보존) + 죽은 링크는 1R 이월 그대로
    //   (복구 = 삭제 후 재발행). outbox 체계는 설계문서 §9 이월.
    const client = await pool.connect();
    let mailWasSent = false;
    try {
      await client.query('BEGIN');
      // ★ Codex 4R 수용 — 잠금 대기·발송 총시간에 **명시 상한**을 건다(기존 send-email 라우트 정석 미러).
      //   nodemailer 타임아웃 3종은 연결·인사·소켓 무활동 기준이라 총 발송시간 상한이 아니다 —
      //   저속 응답 서버면 행 잠금·풀 커넥션을 무기한 쥔다. lock_timeout은 남의 잠금을 기다리는 쪽 상한.
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      const locked = await client.query(
        `SELECT id FROM billings WHERE id = $1::uuid FOR UPDATE`,
        [sheet.id],
      );
      if (locked.rows.length === 0) {
        await client.query('ROLLBACK');
        console.error(`[일괄발급][장삭제경합] billing=${sheet.id} — 발송 직전에 장이 사라져 발송을 중단한다.`);
        summary.mailFailed += 1;
        continue;
      }
      await client.query(
        `UPDATE billings SET emailed_at = COALESCE(emailed_at, NOW()), emailed_to = COALESCE(emailed_to, $2)
          WHERE id = $1::uuid`,
        [sheet.id, email],
      );

      // 총 60초 상한 — 넘으면 발송 여부 불확정. sendMail은 취소되지 않으므로 "안 갔다"로 단정할 수 없다.
      let mailTimedOut = false;
      await Promise.race([
        transporter.sendMail({
          from: process.env.SMTP_USER,
          to: email,
          subject: `[한줄로] ${companyName} 거래내역서 확인 요청 (${billingStart.slice(0, 7)})`,
          html,
        }),
        new Promise((_, reject) => setTimeout(() => { mailTimedOut = true; reject(new Error('MAIL_TOTAL_TIMEOUT')); }, MAIL_TOTAL_TIMEOUT_MS)),
      ]).catch(async (raceErr) => {
        if (mailTimedOut) {
          // 발송 불확정 — 마커는 **커밋해 남긴다**(전달됐을 수 있어 삭제·중복 보호 유지).
          //   추적 행은 만들지 않는다 — 도착 불명 메일에 3일 타이머를 걸면 고객이 못 본 채 자동 발급된다.
          await client.query('COMMIT');
          console.error(`[일괄발급][발송불확정] billing=${sheet.id} to=${email} — ${MAIL_TOTAL_TIMEOUT_MS / 1000}초 초과. 발송 여부 불명, 표식만 남김. 수동 확인 필요.`);
        }
        throw raceErr;
      });
      mailWasSent = true;

      await client.query(
        `INSERT INTO invoice_confirmations (
           billing_id, company_id, recipient_user_id, recipient_email, token,
           sent_at, taxbill_status, taxbill_issue_date, taxbill_due_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, NOW(), $6, $7::date, $8)`,
        [
          sheet.id, companyId,
          sheet.scope === 'by_user' ? sheet.user_id : null,
          email, token, initialStatus, issueDate,
          computeTaxbillDueAt(Date.now(), billingEnd),
        ],
      );
      await client.query('COMMIT');
    } catch (err: any) {
      try { await client.query('ROLLBACK'); } catch { /* 타임아웃 경로는 이미 COMMIT됨 — 무해한 no-op */ }
      if (mailWasSent) {
        // 메일은 나갔는데 행·마커가 롤백됐다 — 마커만 되살려 발송 사실을 보존한다(삭제 보호 유지).
        console.error(`[일괄발급][추적행실패] billing=${sheet.id} to=${email} — 메일은 발송됨, 링크 무효 상태. 수동 확인 필요:`, err?.message || err);
        try {
          await pool.query(
            `UPDATE billings SET emailed_at = COALESCE(emailed_at, NOW()), emailed_to = COALESCE(emailed_to, $2) WHERE id = $1::uuid`,
            [sheet.id, email],
          );
        } catch { /* 장 자체가 사라진 경우 — 위 로그로 충분 */ }
      } else if (String(err?.message) !== 'MAIL_TOTAL_TIMEOUT') {
        // 타임아웃(발송 불확정)은 race 안에서 이미 로그·마커 커밋까지 끝냈다 — 여기선 일반 실패만 남긴다.
        console.error(`[일괄발급][메일실패] billing=${sheet.id} to=${email}:`, err?.message || err);
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
