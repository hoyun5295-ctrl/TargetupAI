/**
 * ★ CT: 세금계산서 상태 전이 워커 (2026-07-28)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §5.
 * 5분 주기:
 *   1) `pending`이고 기한(taxbill_due_at = min(발송+3일, 익월 10일 00:00 KST)) 도래 → `due`
 *   2) `confirmed`·`due` → `ready` (발급 큐)
 *
 * ★ 2026-07-30 팝빌 연동 — ready 이후를 utils/taxbill-popbill.ts `issueReadyTaxbills`가 소비한다.
 *    단 이중 게이트(POPBILL_ENABLED='true' + ENV 3종) 안에서만 — 게이트가 닫혀 있으면 예전처럼
 *    `ready`가 종착지고 어떤 외부 호출도 없다(슈퍼관리자 "계산서 발급 대기" 목록에 보인다).
 *  - `manual_wait`(직접선택 정책)·`objected`(이의신청)는 어떤 전이에도 걸리지 않는다 — 사람 몫.
 *  - `superseded_at`(재발급 무효화) 행도 제외.
 */

import pool from '../config/database';
import { isPopbillEnabled, issueReadyTaxbills, processTaxbillEmailResends } from './taxbill-popbill';
// ★ 2026-08-04 이의신청 내부 통지 — 이의 트랜잭션에서 SMTP를 부르면 회사 자원을 든 채 메일 서버를
//   기다려 그 회사 발행이 멈춘다. 내구 기록(objection_at)만 남기고 여기서 소비한다.
import { processObjectionNotifications } from './invoice-confirm';

const log = (msg: string) => console.log(`[세금계산서워커] ${msg}`);

async function tick(): Promise<void> {
  try {
    const due = await pool.query(
      `UPDATE invoice_confirmations
          SET taxbill_status = 'due'
        WHERE taxbill_status = 'pending'
          AND superseded_at IS NULL
          AND taxbill_due_at <= NOW()`,
    );
    // ★ Codex 1R HIGH 수용 — ready 전이와 **동시에** 세금계산서 장부(taxbill_issues) 행을 만든다.
    //   이 행이 팝빌 호출부가 소비할 발급 큐이자 내역 페이지의 원본이다. 금액은 그 장(billings)의
    //   확정값 스냅샷. NOT EXISTS로 멱등 — 워커가 겹쳐 돌아도 원본 장부는 장당 1행이다.
    const ready = await pool.query(
      `WITH moved AS (
         UPDATE invoice_confirmations
            SET taxbill_status = 'ready'
          WHERE taxbill_status IN ('confirmed', 'due')
            AND superseded_at IS NULL
            -- ★ 2026-08-07(2) 취소된 원본 장에 승인번호가 남아 있으면(웹훅 대사 기록 — 외부에 문서 실존)
            --   집지 않는다. 아래 NOT EXISTS는 cancelled를 멱등에서 빼므로, 여기서 안 막으면 외부에
            --   실존하는 문서와 같은 건의 새 원본이 나간다. 해소는 팝빌 대사 뒤 사람 몫(fail-closed).
            AND NOT EXISTS (
              SELECT 1 FROM taxbill_issues t
               WHERE t.confirmation_id = invoice_confirmations.id AND t.kind = 'original'
                 AND t.status = 'cancelled' AND t.nts_confirm_num IS NOT NULL
            )
        RETURNING id, billing_id, company_id, taxbill_issue_date
       )
       INSERT INTO taxbill_issues (
         confirmation_id, billing_id, company_id, kind, issue_date,
         supply_amount, tax_amount, total_amount, status
       )
       SELECT m.id, m.billing_id, m.company_id, 'original', m.taxbill_issue_date,
              b.subtotal, b.vat, b.total_amount, 'ready'
         FROM moved m
         JOIN billings b ON b.id = m.billing_id
        WHERE NOT EXISTS (
          -- ★ 2026-08-05 취소된 장은 멱등 판정에서 뺀다. 그러지 않으면 [발급 대기 취소]나 이의신청으로
          --   한 번 cancelled가 된 추적행은 영원히 새 장부를 못 만들어, 다시 발행하려 해도 조용히 멈춘다.
          --   진행 중(ready, submitted)과 완료(issued) 행은 그대로 막으므로 이중 발행은 여전히 없다.
          SELECT 1 FROM taxbill_issues t
           WHERE t.confirmation_id = m.id AND t.kind = 'original' AND t.status <> 'cancelled'
        )`,
    );
    if ((due.rowCount || 0) > 0 || (ready.rowCount || 0) > 0) {
      log(`기한 도래 ${due.rowCount || 0}건 → due · 발급 대기 장부 생성 ${ready.rowCount || 0}건 → taxbill_issues ready`);
    }

    // ★ 2026-07-30 팝빌 발행 패스 — 게이트가 닫혀 있으면 함수가 스스로 skip을 돌려준다(외부 호출 0).
    //   여기서 한 번 더 isPopbillEnabled를 보는 것은 로그 소음 방지용이다(5분마다 skip 로그 금지).
    if (isPopbillEnabled()) {
      const pass = await issueReadyTaxbills(10);
      if (pass.skipped) log(`발행 패스 건너뜀 — ${pass.skipped}`);
      // ★ 2026-07-31(2) 참조 재전송 패스 — 발행 락 밖 별도 소비(내구 pending 행·타임아웃·재시도 상한).
      //   같은 tick에서 발행 직후 돌아 "발행 직후 참조 수신" 안내가 성립한다. 결과 로그는 패스 내부가 남긴다.
      const resend = await processTaxbillEmailResends(20);
      if (resend.skipped && resend.skipped.includes('미생성')) log(`재전송 패스 건너뜀 — ${resend.skipped}`);
    }

    // ★ 2026-08-04 이의신청 통지 — 팝빌 게이트와 무관하다(계산서가 아니라 우리 담당자에게 가는 메일).
    //   자기 try로 감싼다 — ALTER 미실행 환경에서 이 패스가 tick 전체(상태 전이·발행)를 멈추면 안 된다.
    try {
      const objection = await processObjectionNotifications(10);
      if (objection.sent > 0 || objection.failed > 0) {
        log(`이의신청 통지 ${objection.sent}건 발송${objection.failed > 0 ? ` · 실패 ${objection.failed}건` : ''}`);
      }
    } catch (objErr: any) {
      const omsg = objErr?.message || '';
      if (omsg.includes('does not exist') && (omsg.includes('relation') || omsg.includes('column'))) {
        log('이의신청 통지 건너뜀 — DB 마이그레이션 미실행(invoice_confirmations.objection_notified_at 추가 필요)');
      } else {
        console.error('[세금계산서워커] 이의신청 통지 실패:', omsg || objErr);
      }
    }
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('does not exist') && (msg.includes('relation') || msg.includes('column'))) {
      log('DB 마이그레이션 미실행 — invoice_confirmations 테이블 생성 필요. 이번 주기는 건너뛴다.');
      return;
    }
    console.error('[세금계산서워커] tick 실패:', msg || err);
  }
}

export function startTaxbillWorker(): void {
  // 부팅 30초 후 1회 + 5분 주기. 상태 전이 UPDATE 두 문장뿐이라 가볍다.
  setTimeout(() => { void tick(); }, 30 * 1000);
  setInterval(() => { void tick(); }, 5 * 60 * 1000);
  log(`시작 — 5분 주기 (pending→due, confirmed·due→ready${isPopbillEnabled() ? ', 팝빌 발행 패스 ON' : '. 팝빌 게이트 닫힘 — ready에서 정지'})`);
}
