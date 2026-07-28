/**
 * ★ CT: 세금계산서 상태 전이 워커 (2026-07-28)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §5.
 * 5분 주기:
 *   1) `pending`이고 기한(taxbill_due_at = min(발송+3일, 익월 10일 00:00 KST)) 도래 → `due`
 *   2) `confirmed`·`due` → `ready` (발급 큐)
 *
 * ⛔ 팝빌 미연동 상태에서는 `ready`가 종착지다 — 여기서 멈추고 슈퍼관리자 "계산서 발급 대기" 목록에 보인다.
 *    연동 후 이 워커 뒤에 발급 호출(utils/taxbill-popbill.ts)이 붙는다. 그 전에는 어떤 외부 호출도 없다.
 *  - `manual_wait`(직접선택 정책)·`objected`(이의신청)는 어떤 전이에도 걸리지 않는다 — 사람 몫.
 *  - `superseded_at`(재발급 무효화) 행도 제외.
 */

import pool from '../config/database';

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
      log(`기한 도래 ${due.rowCount || 0}건 → due · 발급 대기 장부 생성 ${ready.rowCount || 0}건 → taxbill_issues ready (팝빌 연동 전 — 발급 호출 없음)`);
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
  log('시작 — 5분 주기 (pending→due, confirmed·due→ready. 팝빌 연동 전이라 ready에서 정지)');
}
