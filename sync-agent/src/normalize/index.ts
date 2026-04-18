/**
 * 데이터 정규화 진입점
 * 매핑된 데이터를 Target-UP 표준 포맷으로 정규화
 */

import { normalizePhone, normalizeStorePhone } from './phone';
import { normalizeGender } from './gender';
import { normalizeDate, normalizeTimestamp } from './date';
import { normalizeAmount } from './amount';
import { normalizeRegion } from './region';
import { normalizeGrade } from './grade';
import { getLogger } from '../logger';

const logger = getLogger('normalize');

// ─── 고객 데이터 정규화 ─────────────────────────────────

/**
 * 매핑된 고객 레코드를 정규화합니다.
 * 원본 객체를 수정하지 않고 새 객체를 반환합니다.
 */
export function normalizeCustomer(
  mapped: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...mapped };

  // 전화번호 (필수)
  if ('phone' in result) {
    result.phone = normalizePhone(result.phone);
  }

  // 성별
  if ('gender' in result) {
    result.gender = normalizeGender(result.gender);
  }

  // 날짜 필드 (v1.5.0: 레거시 last_purchase_date/wedding_anniversary 제거)
  const dateFields = ['birth_date', 'recent_purchase_date'];
  for (const field of dateFields) {
    if (field in result) {
      result[field] = normalizeDate(result[field]);
    }
  }

  // 생년월일 파생 필드 계산
  if (result.birth_date && typeof result.birth_date === 'string') {
    const parts = result.birth_date.split('-');
    if (parts.length === 3) {
      result.birth_year = result.birth_year ?? parseInt(parts[0], 10);
      result.birth_month_day = result.birth_month_day ?? `${parts[1]}-${parts[2]}`;

      // 나이 계산
      if (!result.age) {
        const birthYear = parseInt(parts[0], 10);
        const currentYear = new Date().getFullYear();
        result.age = currentYear - birthYear;
      }
    }
  }

  // 금액 필드 (v1.5.0: 레거시 total_purchase/avg_order_value 제거)
  const amountFields = ['recent_purchase_amount', 'total_purchase_amount'];
  for (const field of amountFields) {
    if (field in result) {
      result[field] = normalizeAmount(result[field]);
    }
  }

  // 정수 필드 (v1.5.0: 레거시 ltv_score 제거)
  const intFields = ['points', 'purchase_count', 'age'];
  for (const field of intFields) {
    if (field in result && result[field] !== null && result[field] !== undefined) {
      const num = Number(result[field]);
      result[field] = isNaN(num) ? null : Math.round(num);
    }
  }

  // 지역
  if ('region' in result) {
    result.region = normalizeRegion(result.region);
  }

  // 등급
  if ('grade' in result) {
    result.grade = normalizeGrade(result.grade);
  }

  // 이메일 (trim + lowercase)
  if ('email' in result && result.email) {
    const email = String(result.email).trim().toLowerCase();
    result.email = email || null;
  }

  // 매장전화번호 — M-2: normalizeStorePhone() 적용 (유선/휴대폰/대표번호 모두 허용)
  if ('store_phone' in result && result.store_phone) {
    result.store_phone = normalizeStorePhone(result.store_phone);
  }

  // 불리언 필드 (v1.5.0: 레거시 is_opt_out/is_active/is_married 제거)
  const boolFields = ['sms_opt_in'];
  for (const field of boolFields) {
    if (field in result) {
      result[field] = normalizeBoolean(result[field]);
    }
  }

  return result;
}

// ─── 구매 데이터 정규화 ─────────────────────────────────

/**
 * 매핑된 구매 레코드를 정규화합니다.
 */
export function normalizePurchase(
  mapped: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...mapped };

  // 전화번호
  if ('customer_phone' in result) {
    result.customer_phone = normalizePhone(result.customer_phone);
  }

  // 구매일시
  if ('purchase_date' in result) {
    result.purchase_date = normalizeTimestamp(result.purchase_date);
  }

  // 금액
  const amountFields = ['total_amount', 'unit_price'];
  for (const field of amountFields) {
    if (field in result) {
      result[field] = normalizeAmount(result[field]);
    }
  }

  // 수량
  if ('quantity' in result && result.quantity !== null && result.quantity !== undefined) {
    const num = Number(result.quantity);
    result.quantity = isNaN(num) ? null : Math.round(num);
  }

  return result;
}

// ─── 배치 정규화 ────────────────────────────────────────

export interface NormalizationResult {
  normalized: Record<string, unknown>[];
  /** 정규화 후 필수 필드가 누락된 레코드 */
  dropped: Array<{
    row: Record<string, unknown>;
    reason: string;
  }>;
}

/**
 * 고객 데이터 배치를 정규화합니다.
 * phone이 null인 레코드는 dropped로 분류됩니다.
 */
export function normalizeCustomerBatch(rows: Record<string, unknown>[]): NormalizationResult {
  const normalized: Record<string, unknown>[] = [];
  const dropped: NormalizationResult['dropped'] = [];

  for (const row of rows) {
    const result = normalizeCustomer(row);

    if (!result.phone) {
      dropped.push({ row, reason: '전화번호 정규화 실패 또는 누락' });
      continue;
    }

    normalized.push(result);
  }

  if (dropped.length > 0) {
    logger.warn(`고객 정규화: ${dropped.length}건 제외 (총 ${rows.length}건 중)`);
  }

  return { normalized, dropped };
}

/**
 * 구매 데이터 배치를 정규화합니다.
 */
export function normalizePurchaseBatch(rows: Record<string, unknown>[]): NormalizationResult {
  const normalized: Record<string, unknown>[] = [];
  const dropped: NormalizationResult['dropped'] = [];

  for (const row of rows) {
    const result = normalizePurchase(row);

    if (!result.customer_phone) {
      dropped.push({ row, reason: '고객 전화번호 정규화 실패 또는 누락' });
      continue;
    }
    if (!result.purchase_date) {
      dropped.push({ row, reason: '구매일시 정규화 실패 또는 누락' });
      continue;
    }

    normalized.push(result);
  }

  if (dropped.length > 0) {
    logger.warn(`구매 정규화: ${dropped.length}건 제외 (총 ${rows.length}건 중)`);
  }

  return { normalized, dropped };
}

// ─── 유틸 ───────────────────────────────────────────────

function normalizeBoolean(raw: unknown): boolean | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'boolean') return raw;

  const value = String(raw).trim().toLowerCase();

  if (['true', '1', 'y', 'yes', '예', 'o', 'Y'].includes(value)) return true;
  if (['false', '0', 'n', 'no', '아니오', 'x', 'N'].includes(value)) return false;

  return null;
}

// Re-exports
export { normalizePhone, normalizeStorePhone, isValidKoreanLandline } from './phone';
export { normalizeGender } from './gender';
export { normalizeDate, normalizeTimestamp } from './date';
export { normalizeAmount } from './amount';
export { normalizeRegion } from './region';
export { normalizeGrade } from './grade';
