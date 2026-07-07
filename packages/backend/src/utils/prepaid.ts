// utils/prepaid.ts
// ★ 메시징 컨트롤타워 — 선불 잔액 관리의 유일한 진입점
// 포인트 차감/환불은 이 모듈을 통해서만 수행한다.
// 하드코딩 금지. DB 기반 단가 조회.

import { query } from '../config/database';
import { buildDeductDescription } from './deduct-reference';

/**
 * 선불 차감
 * @param createdBy - ★ D98: 차감 실행 사용자 ID (user_id 기반 사용금액 격리용)
 * @param referenceType - ★ 2026-07-07: 차감 유형(campaign/test/spam/journey/brand). 기본 'campaign'(하위호환).
 *   차감이력에서 스팸/테스트 차감이 일반 발송으로 위장되던 결함 수정 — 차감↔환불은 (reference_type,reference_id)
 *   쌍으로 매칭되므로 짝이 되는 prepaidRefund 호출도 같은 referenceType을 넘겨야 한다.
 */
export async function prepaidDeduct(
  companyId: string, count: number, messageType: string, referenceId: string, createdBy?: string,
  referenceType: string = 'campaign'
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
  // ★ D145 PDF 후속 (2026-05-07): message_type 컬럼 추가 — both 채널 발송 시 messageType별 환불 분리
  // ★ 2026-07-07: reference_type를 유형별로 기록 + 설명에 유형 라벨(스팸/테스트 위장 해소)
  await query(
    `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method, created_by, message_type)
     VALUES ($1, 'deduct', $2, $3, $4, $5, $6, 'system', $7, $8)`,
    [companyId, totalAmount, result.rows[0].balance, buildDeductDescription(referenceType, messageType, count, unitPrice), referenceType, referenceId, createdBy || null, messageType]
  );

  console.log(`[선불차감] company=${companyId} ${messageType}×${count} = ${totalAmount}원 차감 → 잔액 ${result.rows[0].balance}원`);
  return { ok: true, amount: totalAmount, balance: Number(result.rows[0].balance) };
}

/**
 * 선불 환불 (실패건 또는 취소) — 중복 환불 방지 포함
 * @param referenceType - ★ 2026-07-07: 차감과 같은 유형이어야 매칭됨(차감↔환불 쌍 = reference_type+reference_id).
 *   기본 'campaign'(캠페인 발송 환불 대부분). 테스트 발송 실패 환불은 차감이 'test'이므로 'test'를 넘긴다.
 */
export async function prepaidRefund(
  companyId: string, count: number, messageType: string, campaignId: string, reason: string,
  referenceType: string = 'campaign'
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
     WHERE company_id = $1 AND type = 'refund' AND reference_type = $4 AND reference_id = $2
       AND (message_type = $3 OR message_type IS NULL)`,
    [companyId, campaignId, messageType, referenceType]
  );
  const alreadyRefunded = Number(existing.rows[0].total);

  // 원래 차감 금액 조회
  const deducted = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM balance_transactions
     WHERE company_id = $1 AND type = 'deduct' AND reference_type = $4 AND reference_id = $2
       AND (message_type = $3 OR message_type IS NULL)`,
    [companyId, campaignId, messageType, referenceType]
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
       VALUES ($1, 'refund', $2, $3, $4, $7, $5, 'system', $6)`,
      [companyId, refundAmount, result.rows[0].balance, desc, campaignId, messageType, referenceType]
    );
    console.log(`[선불환불] company=${companyId} ${refundAmount}원 환불 → 잔액 ${result.rows[0].balance}원`);
  }

  return { refunded: refundAmount };
}

/**
 * 선불 초과 환불 되돌림 — 누적 환불이 정당 한도(차감 − 성공 − 대기)를 넘은 초과분만 회수(차감).
 * ★ 2026-06-29 신설 — sweep/부분실패 등 어떤 경로의 환불이든 정당 한도를 넘으면 자동 보정.
 *   배경: sent_count 과소 기록·과거 ratchet 고착으로 누적 환불이 (차감−성공)을 넘은 초과 환불 51,722원 실측.
 *   prepaidRefund는 한 방향(올림)만이라 한 번 부풀면 영구히 굳음 → 양방향 수렴을 위해 reverse 신설.
 *
 * @param maxLegitRefundCount 정당 환불 상한 건수 = 차감 − 성공 − 대기 (MySQL 실측, 호출측 계산)
 *
 * 호출 전제(호출측 settle 가드 의무): 적재·정산 끝난 캠페인(대기 0 + 경과 + 집계 유효)에서만. 발송 중 호출 금지.
 *
 * idempotent: 이미 한도에 맞춰졌으면 0. 같은 maxLegitRefundCount 반복 호출 시 추가 차감 0.
 * 안전:
 *   - net 환불 = SUM(refund) − SUM(모든 '환불 reverse' admin_deduct) → 타임아웃 reverse와 이중 차감 X
 *   - '타임아웃 실패 환불' row가 있는 캠페인은 기존 타임아웃 reverse가 소유 → skip (이중 차감 차단)
 *   - 트랜잭션(BEGIN/COMMIT/ROLLBACK) 잔액 차감 + INSERT 원자성
 */
export async function prepaidReverseOverRefund(
  companyId: string, maxLegitRefundCount: number, messageType: string, campaignId: string
): Promise<{ reversed: number; netRefundedAmt: number; skipped: boolean }> {
  const co = await query(
    'SELECT billing_type, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1',
    [companyId]
  );
  if (co.rows.length === 0 || co.rows[0].billing_type !== 'prepaid') return { reversed: 0, netRefundedAmt: 0, skipped: true };

  const c = co.rows[0];
  const unitPrice = messageType === 'SMS' ? Number(c.cost_per_sms || 0)
    : messageType === 'LMS' ? Number(c.cost_per_lms || 0)
    : messageType === 'MMS' ? Number(c.cost_per_mms || 0)
    : messageType === 'KAKAO' ? Number(c.cost_per_kakao || 0) : 0;
  if (unitPrice <= 0) return { reversed: 0, netRefundedAmt: 0, skipped: true };

  // 누적 환불 / 이미 되돌린 분 / 타임아웃 환불 존재 여부 — 한 번에 집계
  //   message_type=NULL 옛 row 호환 (prepaidRefund와 동일 필터)
  const agg = await query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE type = 'refund'), 0) AS refunded,
       COALESCE(SUM(-amount) FILTER (WHERE type = 'admin_deduct' AND description LIKE '%환불 reverse%'), 0) AS reversed,
       COALESCE(SUM(CASE WHEN type = 'refund' AND description LIKE '%타임아웃 실패 환불%' THEN 1 ELSE 0 END), 0) AS timeout_refunds
     FROM balance_transactions
     WHERE company_id = $1 AND reference_type = 'campaign' AND reference_id = $2
       AND (message_type = $3 OR message_type IS NULL)`,
    [companyId, campaignId, messageType]
  );
  const refunded = Number(agg.rows[0].refunded);
  const alreadyReversed = Number(agg.rows[0].reversed); // 양수
  const netRefunded = Math.round((refunded - alreadyReversed) * 100) / 100;

  // 타임아웃 환불이 있는 캠페인은 기존 타임아웃 reverse가 소유 — 이중 차감 차단 + 불변식 검증도 위임(skipped)
  if (Number(agg.rows[0].timeout_refunds) > 0) return { reversed: 0, netRefundedAmt: netRefunded, skipped: true };

  const maxLegit = Math.round(unitPrice * Math.max(0, Math.floor(maxLegitRefundCount)) * 100) / 100;
  const excess = Math.round((netRefunded - maxLegit) * 100) / 100;
  if (excess <= 0) return { reversed: 0, netRefundedAmt: netRefunded, skipped: false }; // 정당 한도 이내 (idempotency)

  await query('BEGIN');
  try {
    const bal = await query(
      'UPDATE companies SET balance = balance - $1, updated_at = NOW() WHERE id = $2 RETURNING balance',
      [excess, companyId]
    );
    if (bal.rows.length === 0) throw new Error(`company_id=${companyId} 잔액 갱신 실패`);
    const newBalance = Number(bal.rows[0].balance);
    await query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method, message_type)
       VALUES ($1, 'admin_deduct', $2, $3, $4, 'campaign', $5, 'system', $6)`,
      [companyId, -excess, newBalance, `초과 환불 reverse (정당 한도 ${Math.max(0, Math.floor(maxLegitRefundCount))}건 초과분 자동 회수, ${messageType})`, campaignId, messageType]
    );
    await query('COMMIT');
    console.log(`[초과환불reverse] company=${companyId} ${messageType} campaign=${campaignId} ${excess}원 회수 → 잔액 ${newBalance}원`);
    return { reversed: excess, netRefundedAmt: Math.round((netRefunded - excess) * 100) / 100, skipped: false };
  } catch (e: any) {
    await query('ROLLBACK');
    console.error('[초과환불reverse] 롤백:', e?.message || e);
    return { reversed: 0, netRefundedAmt: netRefunded, skipped: false };
  }
}
