// utils/prepaid.ts
// ★ 메시징 컨트롤타워 — 선불 잔액 관리의 유일한 진입점
// 포인트 차감/환불은 이 모듈을 통해서만 수행한다.
// 하드코딩 금지. DB 기반 단가 조회.

import { query } from '../config/database';

/**
 * 선불 차감
 * @param createdBy - ★ D98: 차감 실행 사용자 ID (user_id 기반 사용금액 격리용)
 */
export async function prepaidDeduct(
  companyId: string, count: number, messageType: string, referenceId: string, createdBy?: string
): Promise<{ ok: boolean; error?: string; amount?: number; balance?: number; insufficientBalance?: boolean }> {
  const co = await query(
    'SELECT billing_type, balance, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1',
    [companyId]
  );
  if (co.rows.length === 0) return { ok: false, error: '회사 정보를 찾을 수 없습니다' };

  const c = co.rows[0];
  if (c.billing_type !== 'prepaid') return { ok: true, amount: 0 }; // 후불은 패스

  const unitPrice = messageType === 'SMS' ? Number(c.cost_per_sms || 0)
    : messageType === 'LMS' ? Number(c.cost_per_lms || 0)
    : messageType === 'MMS' ? Number(c.cost_per_mms || 0)
    : messageType === 'KAKAO' ? Number(c.cost_per_kakao || 0) : 0;

  const totalAmount = Math.round(unitPrice * count * 100) / 100; // 부동소수점 보정
  if (totalAmount === 0) return { ok: true, amount: 0 };

  // Atomic 차감: balance >= totalAmount 일 때만 성공
  const result = await query(
    'UPDATE companies SET balance = balance - $1, updated_at = NOW() WHERE id = $2 AND balance >= $1 RETURNING balance',
    [totalAmount, companyId]
  );

  if (result.rows.length === 0) {
    return {
      ok: false,
      error: `잔액이 부족합니다. 필요: ${totalAmount.toLocaleString()}원 / 현재: ${Number(c.balance).toLocaleString()}원`,
      amount: totalAmount,
      balance: Number(c.balance),
      insufficientBalance: true
    };
  }

  // 거래 기록 — ★ D98: created_by 추가 (사용자별 사용금액 격리)
  // ★ D145 PDF 후속 (2026-05-07): message_type 컬럼 박음 — both 채널 발송 시 messageType별 환불 분리
  await query(
    `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method, created_by, message_type)
     VALUES ($1, 'deduct', $2, $3, $4, 'campaign', $5, 'system', $6, $7)`,
    [companyId, totalAmount, result.rows[0].balance, `${messageType} ${count}건 발송 차감 (건당 ${unitPrice}원)`, referenceId, createdBy || null, messageType]
  );

  console.log(`[선불차감] company=${companyId} ${messageType}×${count} = ${totalAmount}원 차감 → 잔액 ${result.rows[0].balance}원`);
  return { ok: true, amount: totalAmount, balance: Number(result.rows[0].balance) };
}

/** 선불 환불 (실패건 또는 취소) — 중복 환불 방지 포함 */
export async function prepaidRefund(
  companyId: string, count: number, messageType: string, campaignId: string, reason: string
): Promise<{ refunded: number }> {
  const co = await query(
    'SELECT billing_type, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1',
    [companyId]
  );
  if (co.rows.length === 0 || co.rows[0].billing_type !== 'prepaid') return { refunded: 0 };
  if (count <= 0) return { refunded: 0 };

  const c = co.rows[0];
  const unitPrice = messageType === 'SMS' ? Number(c.cost_per_sms || 0)
    : messageType === 'LMS' ? Number(c.cost_per_lms || 0)
    : messageType === 'MMS' ? Number(c.cost_per_mms || 0)
    : messageType === 'KAKAO' ? Number(c.cost_per_kakao || 0) : 0;

  // 이미 환불된 금액 조회 (중복 환불 방지)
  // ★ D145 PDF 후속 (2026-05-07): messageType 필터 — both 채널 발송 시 SMS/카카오 환불 분리
  //   기존 row(message_type=NULL) 호환 — NULL은 옛 패턴이므로 함께 합산
  //   사고 사례: directChannel='both' SMS 환불(15,000원) → 카카오 환불 호출 시 alreadyRefunded=15,000으로
  //              누적되어 카카오 환불 차단됨 → 카카오 실패분 환불 누락
  //   해결: messageType별로 alreadyRefunded/totalDeducted 분리 조회
  const existing = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM balance_transactions
     WHERE company_id = $1 AND type = 'refund' AND reference_type = 'campaign' AND reference_id = $2
       AND (message_type = $3 OR message_type IS NULL)`,
    [companyId, campaignId, messageType]
  );
  const alreadyRefunded = Number(existing.rows[0].total);

  // 원래 차감 금액 조회
  const deducted = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM balance_transactions
     WHERE company_id = $1 AND type = 'deduct' AND reference_type = 'campaign' AND reference_id = $2
       AND (message_type = $3 OR message_type IS NULL)`,
    [companyId, campaignId, messageType]
  );
  const totalDeducted = Number(deducted.rows[0].total);

  // ★ D145 P0+ (2026-05-07): idempotent 환불 패턴 — 호출측 누적값 + 함수측 차이 계산
  //   설계: count = "이 캠페인의 총 실패 건수"(누적). 함수가 alreadyRefunded와 비교해 차이만 환불.
  //   - 호출측은 매번 누적 fail 그대로 보냄 (delta 계산 불필요, 호출/함수 의미 일치)
  //   - 함수가 idempotent — 같은 count 반복 호출해도 추가 환불 0
  //   - fail 증가 시 자동으로 차이만큼만 환불 (sync-results 누락 사고 자동 보정)
  //   - 차감 한도 안전망(totalDeducted - alreadyRefunded)으로 무한환불 0%
  //   사고 사례 검증:
  //   - D145 P0 폴라초이스 5/4: 같은 fail로 24회 호출 → 113,559원 이상지급
  //     → 새 패턴: 2회차부터 additionalRefund=0 → 자동 차단 ✅
  //   - D145 트렉스타 5/7: delta 계산 깨져서 사실상 누적값 호출 → D145 가드가 정상 환불 차단 → 607건 누락
  //     → 새 패턴: 누적값이 정상 의미 → 자연스럽게 차이만 환불 + 5/8 sync에서 누락분 자동 보정 ✅
  const targetTotalRefund = Math.round(unitPrice * count * 100) / 100;
  const additionalRefund = Math.round((targetTotalRefund - alreadyRefunded) * 100) / 100;

  if (additionalRefund <= 0) return { refunded: 0 };  // 이미 충분히 환불됨 (idempotency)

  // 차감 한도 안전망 — 누적 환불이 차감 총액 초과 절대 금지
  const refundAmount = Math.round(Math.min(additionalRefund, totalDeducted - alreadyRefunded) * 100) / 100;
  if (refundAmount <= 0) return { refunded: 0 };

  const result = await query(
    'UPDATE companies SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING balance',
    [refundAmount, companyId]
  );

  if (result.rows.length > 0) {
    // ★ D150-2 (2026-05-09) PDF #3 — description 행 단위 일치: 신규 환불 건수 표시 + 누적 보존
    //   직원 신고: 트렉스타 5/7 11:50:11 행 "LMS 112건 × 26.4원" + 환불 +1,161.6원 → "112×26.4=2,956.8원이어야 하는데?" 오해
    //   원인: count=누적fail, refundAmount=차액 → 행 단위 모순 (전체 누적은 정확)
    const newRefundCount = Math.round(refundAmount / unitPrice);
    const desc = alreadyRefunded > 0
      ? `${reason} (${messageType} 추가 ${newRefundCount}건 × ${unitPrice}원, 누적 ${count}건)`
      : `${reason} (${messageType} ${count}건 × ${unitPrice}원)`;
    await query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method, message_type)
       VALUES ($1, 'refund', $2, $3, $4, 'campaign', $5, 'system', $6)`,
      [companyId, refundAmount, result.rows[0].balance, desc, campaignId, messageType]
    );
    console.log(`[선불환불] company=${companyId} ${refundAmount}원 환불 → 잔액 ${result.rows[0].balance}원`);
  }

  return { refunded: refundAmount };
}
