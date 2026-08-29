/**
 * deposit-approve.ts — 무통장입금 승인 효과 CT (★2026-08-28(3) 신설 · Harold 지시 "문자 링크로 바로 승인")
 *
 * 종전에는 이 트랜잭션이 관리자 라우트(`PUT /api/admin/deposit-requests/:id/approve`)에 인라인이었다.
 * 링크 승인(무로그인 · 문자 속 주소)이 생기면서 입구가 둘이 되어, 효과를 여기 한 벌로 옮겼다
 * (게이트는 효과가 만들어지는 함수 안 · 선례 = agency-send-approve.ts). **본문은 원본 복사 이동**이다.
 *
 * ⛔ 0819 Codex 2R(critical) 계약 유지: 조회·잔액 증가·원장·상태 변경을 **한 트랜잭션 + FOR UPDATE**로.
 *   두 관리자가 동시에 승인해도(혹은 화면과 링크가 동시에 눌러도) 두 번째는 "이미 처리됨"으로 떨어진다.
 * ⛔ 명의 확인 보류(held_reason) 건은 resolveHold 없이 승인되지 않는다(전송자격인증 2.3).
 *   링크 입구는 resolveHold를 절대 보내지 않는다 — 소명 확인은 관리 화면에서만.
 * ⛔ 링크 승인의 감사 = via·전화번호를 원장 description과 admin_note에 남긴다.
 *   confirmed_by(uuid)·balance_transactions.admin_id는 링크 경로에서 NULL이다 — pending 행이
 *   confirmed_by 없이 INSERT되어 운영에 실존하므로 NULL 허용은 구조로 확정돼 있다.
 */
import pool from '../config/database';

export type DepositApproveOutcome =
  | { ok: true; newBalance: number; depositReq: any }
  | { ok: false; status: number; error: string; code?: string; heldReason?: string; explanationNote?: string | null };

export async function approveDepositRequestTx(opts: {
  depositRequestId: string;
  /** 승인 관리자(화면 입구). 링크 입구 = null */
  adminId: string | null;
  adminNote?: string | null;
  /** 명의 확인 보류 건을 소명 확인 후 승인(관리 화면 전용). 링크 입구는 항상 미지정 */
  resolveHold?: boolean;
  via: 'admin' | 'link';
  /** via='link'일 때 승인한 담당자 번호(감사) */
  linkPhone?: string | null;
}): Promise<DepositApproveOutcome> {
  const { depositRequestId: id, adminId, adminNote, via } = opts;

  const depClient = await pool.connect();
  let newBalance = 0;
  let depositReq: any = null;
  try {
    await depClient.query('BEGIN');
    const reqResult = await depClient.query(
      // 컬럼을 명시한다 — dr.* 는 신규 컬럼이 없는 스키마에서도 성공해 확인 게이트가 조용히 통과된다
      `SELECT dr.id, dr.company_id, dr.amount, dr.depositor_name, dr.status,
              dr.payment_method, dr.admin_note, dr.confirmed_by, dr.confirmed_at, dr.created_at,
              dr.held_reason, dr.held_at, dr.explanation_note
         FROM deposit_requests dr
        WHERE dr.id = $1
        FOR UPDATE`,
      [id]
    );

    if (reqResult.rows.length === 0) {
      await depClient.query('ROLLBACK');
      return { ok: false, status: 404, error: '충전 요청을 찾을 수 없습니다.' };
    }
    depositReq = reqResult.rows[0];

    const companyRes = await depClient.query(
      'SELECT company_name, billing_type, balance FROM companies WHERE id = $1 FOR UPDATE',
      [depositReq.company_id]
    );
    Object.assign(depositReq, companyRes.rows[0] || {});

    if (depositReq.status !== 'pending') {
      await depClient.query('ROLLBACK');
      return { ok: false, status: 400, error: '이미 처리된 요청입니다.' };
    }

    // ★ 2026-08-19 전송자격인증 2.3 — 명의 확인이 걸린 건은 **확인했다는 표시 없이 승인되지 않는다**.
    //   기준이 요구하는 "처리 결과를 계정별로 기록"이 이 확인에서 나온다. 자동 통과 경로를 만들지 않는다.
    if (depositReq.held_reason && opts.resolveHold !== true) {
      await depClient.query('ROLLBACK');
      return {
        ok: false, status: 400,
        error: '입금자명 확인이 필요한 요청입니다. 소명을 확인한 뒤 승인해주세요.',
        code: 'HOLD_CONFIRMATION_REQUIRED',
        heldReason: depositReq.held_reason,
        explanationNote: depositReq.explanation_note || null,
      };
    }

    if (depositReq.billing_type !== 'prepaid') {
      await depClient.query('ROLLBACK');
      return { ok: false, status: 400, error: '선불 고객사가 아닙니다.' };
    }

    // 1. 잔액 충전
    const balanceResult = await depClient.query(
      'UPDATE companies SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING balance',
      [depositReq.amount, depositReq.company_id]
    );

    // 2. balance_transactions 기록 — 링크 승인은 어느 번호가 눌렀는지까지 원장에 남긴다(부인 방지)
    newBalance = Number(balanceResult.rows[0].balance);
    const description = via === 'link'
      ? `무통장입금 승인 (입금자: ${depositReq.depositor_name} · 링크 승인 ${opts.linkPhone || '번호 미상'})`
      : `무통장입금 승인 (입금자: ${depositReq.depositor_name})`;
    await depClient.query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_before, balance_after, description, reference_type, reference_id, admin_id, payment_method)
       VALUES ($1, 'deposit_charge', $2, $3, $4, $5, 'deposit_request', $6, $7, 'bank_transfer')`,
      [
        depositReq.company_id,
        depositReq.amount,
        newBalance - Number(depositReq.amount),
        newBalance,
        description,
        id,
        adminId
      ]
    );

    // 3. deposit_requests 상태 변경
    await depClient.query(
      `UPDATE deposit_requests SET status = 'confirmed', confirmed_by = $1, confirmed_at = NOW(), admin_note = $2 WHERE id = $3`,
      [adminId, adminNote || null, id]
    );

    await depClient.query('COMMIT');
    return { ok: true, newBalance, depositReq };
  } catch (txErr: any) {
    await depClient.query('ROLLBACK').catch(() => {});
    const msg = String(txErr?.message || '');
    if (msg.includes('column') && msg.includes('does not exist')) {
      return { ok: false, status: 503, error: 'DB 마이그레이션 필요: deposit_requests ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' };
    }
    console.error('충전 요청 승인 실패:', txErr);
    return { ok: false, status: 500, error: '충전 요청 승인 실패' };
  } finally {
    depClient.release();
  }
}
