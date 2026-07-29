// utils/prepaid.ts
// ★ 메시징 컨트롤타워 — 선불 잔액 관리의 유일한 진입점
// 포인트 차감/환불은 이 모듈을 통해서만 수행한다.
// 하드코딩 금지. DB 기반 단가 조회.

import pool, { query } from '../config/database';
import { buildDeductDescription } from './deduct-reference';
// ★ 2026-07-26 단가의 부가세 기준(`companies.unit_price_basis`)을 해석하는 유일한 경로.
//   선불 잔액은 고객이 입금한 현금이라 **부가세 포함가**로 깎아야 한다.
//   전환 전 회사는 저장값이 곧 포함가라 이 배선으로 차감액이 바뀌지 않는다.
import { resolveChargeUnitPrice, resolveChargeUnitPriceDetailed } from './unit-price';
import { sendSystemAlert } from './system-alert';
import { parseDeductDescription } from './deduct-reference';

/**
 * 이 (유형 × 참조)에 실제로 **차감된 총액과 건수**, 그리고 그 둘로 되살린 **정산 단가**.
 * (★ 2026-07-26 — 환불·회수는 "지금 단가"가 아니라 "차감 당시 단가"로 계산해야 한다.)
 *
 * 왜: `차감 = 성공 + 순환불`이 성립하려면 실패 1건을 되돌리는 금액이 그 1건을 깎은 금액과 같아야 한다.
 *   현재 단가를 곱하면 단가가 바뀐 순간 그 차이만큼 회계가 어긋난다 — 전 업체 단가를 재입력하는
 *   지금은 확실히 발동한다(선불 38사).
 *
 * 되읽을 수 없는 옛 행이 하나라도 섞이면 건수를 신뢰할 수 없으므로 `unitPrice = null`로 돌려주고,
 * 호출부가 현재 단가로 폴백한다(기존 동작). 총액은 어느 경우든 정확하다.
 */
export interface DeductLedger {
  totalDeducted: number;
  deductedCount: number;
  /** 되살린 정산 단가. `null` = 되읽기 실패(호출부는 **정산하지 않고 멈춘다**) */
  unitPrice: number | null;
  /** 차감 원장은 있는데 설명을 되읽지 못했다 — 추측으로 돈을 움직이면 안 되는 상태 */
  unresolved: boolean;
}

async function loadDeductLedger(
  db: any, companyId: string, referenceType: string, referenceId: string, messageType: string,
): Promise<DeductLedger> {
  const rows = await db.query(
    `SELECT amount, description FROM balance_transactions
      WHERE company_id = $1 AND type = 'deduct' AND reference_type = $4 AND reference_id = $2
        AND (message_type = $3 OR message_type IS NULL)`,
    [companyId, referenceId, messageType, referenceType]
  );
  let totalDeducted = 0;
  let deductedCount = 0;
  let allParsed = rows.rows.length > 0;
  for (const r of rows.rows as any[]) {
    totalDeducted += Number(r.amount) || 0;
    const parsed = parseDeductDescription(r.description);
    if (parsed) deductedCount += parsed.count;
    else allParsed = false;
  }
  totalDeducted = Math.round(totalDeducted * 100) / 100;
  const unitPrice = allParsed && deductedCount > 0
    ? Math.round((totalDeducted / deductedCount) * 100) / 100
    : null;
  // 차감이 있는데 단가를 못 되살렸다 = 위험 상태. 현재 단가로 폴백하면 단가가 바뀐 뒤엔 틀린 금액이 나간다.
  return { totalDeducted, deductedCount, unitPrice, unresolved: totalDeducted > 0 && unitPrice === null };
}

/**
 * 되읽기 실패를 드러낸다. (★ 2026-07-26 Codex #6 — 현재 단가 폴백 폐기)
 *
 * 정산을 멈추는 쪽이 안전한 이유: 환불 함수는 idempotent하고 sweeper가 30초마다 다시 부르므로,
 * 원인을 고치면 **다음 사이클에 자동으로 밀린 환불이 나간다.** 반대로 틀린 금액이 한 번 나가면
 * 되돌리는 경로(reverse)를 또 태워야 한다.
 */
async function warnUnresolvedLedger(companyId: string, referenceId: string, messageType: string, where: string) {
  const msg = `[선불정산중단] ${where} — 차감 원장 설명을 되읽지 못해 정산을 멈췄다. company=${companyId} ref=${referenceId} ${messageType}`;
  console.error(msg);
  await sendSystemAlert({
    dedupKey: `prepaid-ledger-unresolved:${referenceId}:${messageType}`,
    message: `선불 정산 중단 — 차감 원장 설명을 되읽지 못했습니다(환불/회수 보류). company=${companyId} ref=${referenceId} ${messageType}`,
  }).catch(() => { /* 경보 실패가 정산을 막지는 않는다 */ });
}

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
  // 후불은 트랜잭션을 열지 않는다 — 발송마다 부르는 경로라 103사(후불)의 비용을 늘리지 않는다.
  const pre = await query('SELECT billing_type FROM companies WHERE id = $1', [companyId]);
  if (pre.rows.length === 0) return { ok: false, error: '회사 정보를 찾을 수 없습니다' };
  if (pre.rows[0].billing_type !== 'prepaid') return { ok: true, amount: 0 };

  // ★ 2026-07-26 잔액 갱신과 원장 INSERT를 **한 트랜잭션**으로 묶는다(Codex #3).
  //   전에는 `query`(=pool.query) 두 문장이라 각각 즉시 커밋됐다 — INSERT가 실패하면
  //   **잔액만 깎이고 차감 이력이 없는** 상태가 남고, 그러면 환불·sweep이 근거를 잃는다.
  //   회사 행을 `FOR UPDATE`로 잠가 같은 회사의 차감·환불이 서로를 덮지 않게 직렬화한다.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const co = await client.query(
      `SELECT billing_type, balance, unit_price_basis, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, cost_per_brand
         FROM companies WHERE id = $1 FOR UPDATE`,
      [companyId]
    );
    if (co.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: '회사 정보를 찾을 수 없습니다' };
    }
    const c = co.rows[0];
    if (c.billing_type !== 'prepaid') {
      await client.query('ROLLBACK');
      return { ok: true, amount: 0 };
    }

    // ★ 2026-07-26 단가 미설정이면 **발송을 막는다**(Codex #2). 전에는 0원으로 통과시켜
    //   단가가 비어 있는 선불 회사가 공짜로 발송했다. 명시적 0원 계약은 그대로 통과시킨다.
    const resolved = resolveChargeUnitPriceDetailed(c, messageType);
    if (resolved.unset) {
      await client.query('ROLLBACK');
      console.error(`[선불차감차단] company=${companyId} ${messageType} 단가 미설정 — 차감 없이 발송되는 것을 막았다`);
      return {
        ok: false,
        error: `${messageType} 단가가 설정되지 않아 발송할 수 없습니다. 슈퍼관리자 단가설정에서 단가를 입력해 주세요.`,
        amount: 0,
      };
    }
    if (resolved.unknownType) {
      console.warn(`[선불차감] company=${companyId} 알 수 없는 발송 유형 '${messageType}' — 단가 축이 없어 0원 처리한다`);
    }
    const unitPrice = resolved.price;

    const totalAmount = Math.round(unitPrice * count * 100) / 100; // 부동소수점 보정
    if (totalAmount === 0) {
      await client.query('ROLLBACK');
      return { ok: true, amount: 0 };
    }

    // Atomic 차감: balance >= totalAmount 일 때만 성공
    const result = await client.query(
      'UPDATE companies SET balance = balance - $1, updated_at = NOW() WHERE id = $2 AND balance >= $1 RETURNING balance',
      [totalAmount, companyId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: `잔액이 부족합니다. 필요: ${totalAmount.toLocaleString()}원 / 현재: ${Number(c.balance).toLocaleString()}원`,
        amount: totalAmount,
        balance: Number(c.balance),
        insufficientBalance: true,
      };
    }

    // 거래 기록 — ★ D98: created_by 추가 (사용자별 사용금액 격리)
    // ★ D145 PDF 후속 (2026-05-07): message_type 컬럼 추가 — both 채널 발송 시 messageType별 환불 분리
    // ★ 2026-07-07: reference_type를 유형별로 기록 + 설명에 유형 라벨(스팸/테스트 위장 해소)
    // ★ 설명에 담기는 건수·단가는 환불·회수·sweep이 되읽는 **정산의 근거**다(parseDeductDescription).
    await client.query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method, created_by, message_type)
       VALUES ($1, 'deduct', $2, $3, $4, $5, $6, 'system', $7, $8)`,
      [companyId, totalAmount, result.rows[0].balance, buildDeductDescription(referenceType, messageType, count, unitPrice), referenceType, referenceId, createdBy || null, messageType]
    );
    await client.query('COMMIT');

    console.log(`[선불차감] company=${companyId} ${messageType}×${count} = ${totalAmount}원 차감 → 잔액 ${result.rows[0].balance}원`);
    return { ok: true, amount: totalAmount, balance: Number(result.rows[0].balance) };
  } catch (e: any) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
    console.error('[선불차감] 롤백:', e?.message || e);
    return { ok: false, error: '차감 처리 중 오류가 발생했습니다' };
  } finally {
    client.release();
  }
}

/**
 * 환불 원인(항아리) 키 — ★ 2026-07-27 (B-0727-2).
 * 같은 캠페인의 환불이라도 원인이 다르면 서로 독립적으로 정산돼야 한다.
 * 문자열을 호출부에 흩뿌리지 않는다(오타 하나가 항아리를 갈라 이중 환불이 된다).
 *  - NOT_LOADED: 차감했는데 큐에 안 들어간 분. 워커 종결과 sweeper가 **같은 키로 만나 수렴**한다.
 *  - FAIL      : 게이트웨이가 실패로 확정한 분(결과 도착에 따라 커진다).
 *  - CANCEL    : 예약 취소로 큐에서 지운 분.
 *  - TEST      : 테스트 발송 실패분(전 건이 고정 reference를 공유하는 별개 경로).
 */
export const REFUND_KEYS = {
  NOT_LOADED: 'notloaded',
  FAIL: 'fail',
  CANCEL: 'cancel',
  TEST: 'test',
} as const;

/**
 * 선불 환불 (실패건 또는 취소) — 중복 환불 방지 포함
 * @param referenceType - ★ 2026-07-07: 차감과 같은 유형이어야 매칭됨(차감↔환불 쌍 = reference_type+reference_id).
 *   기본 'campaign'(캠페인 발송 환불 대부분). 테스트 발송 실패 환불은 차감이 'test'이므로 'test'를 넘긴다.
 */
export async function prepaidRefund(
  companyId: string, count: number, messageType: string, campaignId: string, reason: string,
  referenceType: string = 'campaign',
  // ★ 2026-07-27 (B-0727-1): count 해석 방식.
  //   'cumulative'(기본) = count가 이 캠페인·유형의 **누적 총 환불 목표**. 기존 전 호출부 계약 그대로.
  //   'additional'      = count가 **이번에 추가로 환불할 건수**. 잠금 안에서 읽은 기존 환불액에 더해 목표를 만든다.
  //   취소처럼 "원인이 다른 환불"이 뒤이어 올 때 누적으로 넘기면, 앞 환불이 더 크면 뒤 환불이 통째로 삼켜진다
  //   (워커가 미적재 6,000건을 환불한 뒤 사용자가 대기 4,000건을 취소하면 두 번째 호출이 0원).
  //   ★ 2026-07-27 (B-0727-2) refundKey = **환불 원인**. 같은 캠페인이라도 원인이 다르면 별도 항아리로 센다.
  //     'notloaded'(차감했는데 큐에 안 들어감) / 'fail'(게이트웨이 실패) / 'cancel'(예약 취소) / 'test'(테스트 발송).
  //     키를 주면 그 원인의 총액만 목표로 삼으므로, 원인이 다른 환불끼리 서로를 삼키지 않고 재호출도 안전하다.
  //     키 없이 쌓인 옛 환불이 그 캠페인에 하나라도 있으면 자동으로 옛 단일 항아리 계산으로 되돌아간다.
  //   ★ forceKeyedPot — 키 이전 환불(unkeyed)이 있어도 그 키 항아리로 계산한다.
  //     취소처럼 "이 원인의 환불은 캠페인당 한 번뿐이라 그 항아리가 반드시 비어 있음"이 보장되는 경우에만 쓴다.
  //     레거시 폴백으로 떨어지면 목표를 전역 누적과 비교하게 되어, 재시도가 이중 환불되거나(additional)
  //     기존 환불에 삼켜져 미환불로 굳는다(cumulative). 항아리를 강제하면 둘 다 사라진다.
  opts: { mode?: 'cumulative' | 'additional'; refundKey?: string; forceKeyedPot?: boolean } = {}
): Promise<{ refunded: number; ok: boolean }> {
  if (count <= 0) return { refunded: 0, ok: true };
  // 후불은 트랜잭션을 열지 않는다(차감과 같은 이유).
  const pre = await query('SELECT billing_type FROM companies WHERE id = $1', [companyId]);
  if (pre.rows.length === 0) return { refunded: 0, ok: false };
  if (pre.rows[0].billing_type !== 'prepaid') return { refunded: 0, ok: true };

  // ★ 2026-07-26 환불 전 과정을 **한 트랜잭션·행 잠금** 안에서 한다(Codex #3).
  //   전에는 누적 환불액을 잠금 없이 읽고 잔액 UPDATE와 원장 INSERT를 따로 커밋했다:
  //   ① 동시 호출 둘이 같은 `alreadyRefunded=0`을 보고 각자 전액을 환불(D145 폴라초이스 113,559원 계열)
  //   ② INSERT가 실패하면 잔액만 늘고 환불 이력이 없어 다음 호출이 또 환불한다.
  //   회사 행을 잠그면 그 회사의 차감·환불·회수가 한 줄로 선다.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const co = await client.query(
      `SELECT billing_type, balance, unit_price_basis, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, cost_per_brand
         FROM companies WHERE id = $1 FOR UPDATE`,
      [companyId]
    );
    if (co.rows.length === 0) {
      await client.query('ROLLBACK');
      return { refunded: 0, ok: false };
    }
    if (co.rows[0].billing_type !== 'prepaid') {
      await client.query('ROLLBACK');
      return { refunded: 0, ok: true };
    }
    const c = co.rows[0];

    // ★ 2026-07-26 환불 단가 = **차감 당시 단가**. 현재 단가를 곱하면 단가가 바뀐 뒤의 환불이
    //   차감과 짝이 안 맞아 `차감 = 성공 + 순환불`이 깨진다.
    //   되읽지 못하면 **현재 단가로 폴백하지 않고 멈춘다**(Codex #6) — 추측으로 돈을 움직이지 않는다.
    //   환불은 idempotent하고 sweeper가 30초마다 다시 부르므로, 원인을 고치면 다음 사이클에 자동으로 나간다.
    const ledger = await loadDeductLedger(client, companyId, referenceType, campaignId, messageType);
    if (ledger.unresolved) {
      await client.query('ROLLBACK');
      await warnUnresolvedLedger(companyId, campaignId, messageType, 'prepaidRefund');
      return { refunded: 0, ok: false };   // 단가 미상 = 처리 못 함 → 호출측이 재시도해야 한다
    }
    const unitPrice = ledger.unitPrice ?? resolveChargeUnitPrice(c, messageType);
    if (unitPrice <= 0) {
      await client.query('ROLLBACK');
      // ★ 2026-07-27 (B-0727-1): 단가 0을 무조건 실패로 보면 안 된다.
      //   차감 원장이 아예 없으면(0원 계약 등) 돌려줄 돈 자체가 없으므로 처리 완료다.
      //   ok=false로 두면 호출측 재시도 큐에 영원히 남아 다른 환불 의무까지 밀어낸다.
      //   차감액은 있는데 단가만 복원 못 한 경우에만 실패로 본다(재시도해야 할 진짜 채무).
      return { refunded: 0, ok: ledger.totalDeducted <= 0 };
    }

    // 이미 환불된 금액 — **잠근 뒤에** 읽어야 동시 호출이 같은 값을 보고 이중 환불하지 않는다.
    // ★ D145 PDF 후속 (2026-05-07): messageType 필터 — both 채널 발송 시 SMS/카카오 환불 분리
    //   기존 row(message_type=NULL) 호환 — NULL은 옛 패턴이므로 함께 합산
    // ★ 2026-07-27 (B-0727-2): 원인별 항아리 분리 — 같은 캠페인이라도 미적재·실패·취소는 서로 다른 채무다.
    //   한 항아리에 합치면 먼저 나간 큰 환불이 뒤에 오는 다른 원인의 환불을 통째로 삼킨다.
    //   `unkeyed` = 키 도입 이전에 쌓인 환불액. 하나라도 있으면 그 캠페인은 옛 방식(단일 항아리)으로 계속 계산한다
    //   — 키별 합계가 0으로 보여 이미 돌려준 돈을 또 돌려주는 것을 막는 안전장치다.
    const existing = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS total,
              COALESCE(SUM(amount) FILTER (WHERE refund_key IS NULL), 0) AS unkeyed,
              COALESCE(SUM(amount) FILTER (WHERE refund_key = $5), 0) AS for_key
         FROM balance_transactions
        WHERE company_id = $1 AND type = 'refund' AND reference_type = $4 AND reference_id = $2
          AND (message_type = $3 OR message_type IS NULL)`,
      [companyId, campaignId, messageType, referenceType, opts.refundKey ?? null]
    );
    const alreadyRefunded = Number(existing.rows[0].total);
    const unkeyedRefunded = Number(existing.rows[0].unkeyed);
    const refundedForKey = Number(existing.rows[0].for_key);
    const totalDeducted = ledger.totalDeducted;
    // 키 계산 적용 조건 = 키를 넘겼고, 이 캠페인에 키 없는 옛 환불이 없을 것.
    const useKeyedPot = !!opts.refundKey && (opts.forceKeyedPot === true || unkeyedRefunded <= 0);
    const potAlready = useKeyedPot ? refundedForKey : alreadyRefunded;

    // ★ D145 P0+ (2026-05-07): idempotent 환불 패턴 — 호출측 누적값 + 함수측 차이 계산
    //   count = "이 캠페인의 총 실패 건수"(누적). 함수가 alreadyRefunded와 비교해 차이만 환불한다.
    //   차감 한도 안전망(totalDeducted − alreadyRefunded)으로 무한환불 0%.
    // ★ 2026-07-27: 'additional'은 잠금 안에서 읽은 기존 환불액 위에 이번 몫을 얹어 목표를 만든다.
    //   같은 트랜잭션·행 잠금 안이라 두 호출이 같은 기존값을 보고 각자 더하는 경합이 생기지 않는다.
    //   키 항아리를 쓰면 목표는 그 원인 하나의 총액이라 'additional'과 'cumulative'가 같아진다
    //   (같은 키로 다시 불려도 그 키의 기존액과 비교하므로 반복 호출이 안전하다).
    const requestedRefund = Math.round(unitPrice * count * 100) / 100;
    const targetTotalRefund = (!useKeyedPot && opts.mode === 'additional')
      ? Math.round((potAlready + requestedRefund) * 100) / 100
      : requestedRefund;
    const additionalRefund = Math.round((targetTotalRefund - potAlready) * 100) / 100;
    if (additionalRefund <= 0) {
      await client.query('ROLLBACK');
      return { refunded: 0, ok: true };   // 이미 충분히 환불됨 (idempotency)
    }

    const refundAmount = Math.round(Math.min(additionalRefund, totalDeducted - alreadyRefunded) * 100) / 100;
    if (refundAmount <= 0) {
      await client.query('ROLLBACK');
      return { refunded: 0, ok: true };   // 차감 한도 도달 — 더 돌려줄 것이 없다(정상)
    }

    const result = await client.query(
      'UPDATE companies SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING balance',
      [refundAmount, companyId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return { refunded: 0, ok: false };
    }

    // ★ D150-2 (2026-05-09) — description 행 단위 일치: 신규 환불 건수 표시 + 누적 보존
    // ★ 2026-07-27: 누적 표기는 **실제 원장에 남은 금액** 기준(목표가 아니라). 차감 한도에 잘렸을 때
    //   목표 건수를 적으면 감사 문구가 실제보다 크게 남는다.
    const newRefundCount = Math.round(refundAmount / unitPrice);
    const cumulativeCount = Math.round((potAlready + refundAmount) / unitPrice);
    const desc = potAlready > 0
      ? `${reason} (${messageType} 추가 ${newRefundCount}건 × ${unitPrice}원, 누적 ${cumulativeCount}건)`
      : `${reason} (${messageType} ${cumulativeCount}건 × ${unitPrice}원)`;
    await client.query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method, message_type, refund_key)
       VALUES ($1, 'refund', $2, $3, $4, $7, $5, 'system', $6, $8)`,
      [companyId, refundAmount, result.rows[0].balance, desc, campaignId, messageType, referenceType, opts.refundKey ?? null]
    );
    await client.query('COMMIT');

    console.log(`[선불환불] company=${companyId} ${refundAmount}원 환불 → 잔액 ${result.rows[0].balance}원`);
    return { refunded: refundAmount, ok: true };
  } catch (e: any) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
    console.error('[선불환불] 롤백:', e?.message || e);
    // ★ 2026-07-27 (B-0727-1): 옛 반환은 `{refunded:0}`뿐이라 "이미 충분히 환불됨"과 "환불 실패"가
    //   구분되지 않았다. 호출측이 실패를 못 보고 캠페인을 종결해 영구 미환불이 됐다.
    return { refunded: 0, ok: false };
  } finally {
    client.release();
  }
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
  // 후불은 트랜잭션을 열지 않는다.
  const pre = await query('SELECT billing_type FROM companies WHERE id = $1', [companyId]);
  if (pre.rows.length === 0 || pre.rows[0].billing_type !== 'prepaid') return { reversed: 0, netRefundedAmt: 0, skipped: true };

  // ★ 2026-07-26 판정과 회수를 **한 트랜잭션·행 잠금** 안에서 한다(Codex #3).
  //   전에는 환불 집계를 트랜잭션 밖에서 읽고 나서 커넥션을 잡아, 두 사이클이 같은 초과분을
  //   각자 회수해 고객에게서 두 번 빼갈 수 있었다.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const co = await client.query(
      `SELECT billing_type, unit_price_basis, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, cost_per_brand
         FROM companies WHERE id = $1 FOR UPDATE`,
      [companyId]
    );
    if (co.rows.length === 0 || co.rows[0].billing_type !== 'prepaid') {
      await client.query('ROLLBACK');
      return { reversed: 0, netRefundedAmt: 0, skipped: true };
    }
    const c = co.rows[0];

    // ★ 회수도 **차감 당시 단가**로 한다. 정당 한도(`maxLegitRefundCount × 단가`)를 현재 단가로 재면,
    //   단가를 올린 뒤엔 한도가 부풀어 초과 환불을 못 잡고(회사 손해), 내린 뒤엔 정상 환불을
    //   초과로 오인해 회수한다(고객 손해). 되읽지 못하면 회수하지 않고 멈춘다(Codex #6).
    const ledger = await loadDeductLedger(client, companyId, 'campaign', campaignId, messageType);
    if (ledger.unresolved) {
      await client.query('ROLLBACK');
      await warnUnresolvedLedger(companyId, campaignId, messageType, 'prepaidReverseOverRefund');
      return { reversed: 0, netRefundedAmt: 0, skipped: true };
    }
    const unitPrice = ledger.unitPrice ?? resolveChargeUnitPrice(c, messageType);
    if (unitPrice <= 0) {
      await client.query('ROLLBACK');
      return { reversed: 0, netRefundedAmt: 0, skipped: true };
    }

    // 누적 환불 / 이미 되돌린 분 / 타임아웃 환불 존재 여부 — 잠근 뒤 한 번에 집계
    const agg = await client.query(
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
    if (Number(agg.rows[0].timeout_refunds) > 0) {
      await client.query('ROLLBACK');
      return { reversed: 0, netRefundedAmt: netRefunded, skipped: true };
    }

    const maxLegit = Math.round(unitPrice * Math.max(0, Math.floor(maxLegitRefundCount)) * 100) / 100;
    const excess = Math.round((netRefunded - maxLegit) * 100) / 100;
    if (excess <= 0) {
      await client.query('ROLLBACK');
      return { reversed: 0, netRefundedAmt: netRefunded, skipped: false }; // 정당 한도 이내 (idempotency)
    }

    const bal = await client.query(
      'UPDATE companies SET balance = balance - $1, updated_at = NOW() WHERE id = $2 RETURNING balance',
      [excess, companyId]
    );
    if (bal.rows.length === 0) throw new Error(`company_id=${companyId} 잔액 갱신 실패`);
    const newBalance = Number(bal.rows[0].balance);
    await client.query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method, message_type)
       VALUES ($1, 'admin_deduct', $2, $3, $4, 'campaign', $5, 'system', $6)`,
      [companyId, -excess, newBalance, `초과 환불 reverse (정당 한도 ${Math.max(0, Math.floor(maxLegitRefundCount))}건 초과분 자동 회수, ${messageType})`, campaignId, messageType]
    );
    await client.query('COMMIT');
    console.log(`[초과환불reverse] company=${companyId} ${messageType} campaign=${campaignId} ${excess}원 회수 → 잔액 ${newBalance}원`);
    return { reversed: excess, netRefundedAmt: Math.round((netRefunded - excess) * 100) / 100, skipped: false };
  } catch (e: any) {
    try { await client.query('ROLLBACK'); } catch (rb: any) {
      console.error('[초과환불reverse] 롤백 실패:', rb?.message || rb);
    }
    console.error('[초과환불reverse] 롤백:', e?.message || e);
    return { reversed: 0, netRefundedAmt: 0, skipped: false };
  } finally {
    client.release();
  }
}
