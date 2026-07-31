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
          SELECT 1 FROM taxbill_issues t WHERE t.confirmation_id = m.id AND t.kind = 'original'
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
