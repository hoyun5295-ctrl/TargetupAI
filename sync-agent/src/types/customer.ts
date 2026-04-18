/**
 * 고객 데이터 타입 정의
 * Target-UP standard_fields 기준
 *
 * v1.5.0 (M-1): 서버가 무시하는 레거시 필드 9개 전부 제거.
 *   제거 대상: registered_store_number, last_purchase_date, total_purchase,
 *              avg_order_value, ltv_score, wedding_anniversary,
 *              is_married, is_opt_out, is_active
 *   사유: 서버 FIELD_MAP(standard-field-map.ts)에 없는 필드 → 네트워크/검증 낭비.
 *        custom 데이터는 custom_1~custom_15 슬롯으로 매핑하여 전송.
 */

import { z } from 'zod';

// ─── Zod 스키마 (유효성 검증용) ─────────────────────────

export const CustomerSchema = z.object({
  // 필수
  phone: z.string().min(1, '전화번호는 필수입니다'),

  // 기본 정보
  name: z.string().nullish(),
  gender: z.enum(['M', 'F']).nullish(),
  birth_date: z.string().nullish(),       // YYYY-MM-DD
  birth_year: z.number().int().nullish(),
  birth_month_day: z.string().nullish(),  // MM-DD
  age: z.number().int().nullish(),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().email().nullish()),

  // 주소/지역
  address: z.string().nullish(),
  region: z.string().nullish(),

  // 등급/포인트
  grade: z.string().nullish(),
  points: z.number().int().nullish(),

  // 매장 정보
  store_code: z.string().nullish(),
  store_name: z.string().nullish(),
  store_phone: z.string().nullish(),
  registered_store: z.string().nullish(),
  registration_type: z.string().nullish(),

  // 구매 집계
  recent_purchase_date: z.string().nullish(),
  recent_purchase_amount: z.number().nullish(),
  recent_purchase_store: z.string().nullish(),
  total_purchase_amount: z.number().nullish(),
  purchase_count: z.number().int().nullish(),

  // 수신 동의
  sms_opt_in: z.boolean().nullish(),

  // 확장
  custom_fields: z.record(z.unknown()).nullish(),
});

export type Customer = z.infer<typeof CustomerSchema>;

// ─── 검증 헬퍼 ─────────────────────────────────────────

export interface CustomerValidationResult {
  valid: Customer[];
  invalid: Array<{
    raw: Record<string, unknown>;
    errors: z.ZodError;
  }>;
}

export function validateCustomers(rows: Record<string, unknown>[]): CustomerValidationResult {
  const valid: Customer[] = [];
  const invalid: CustomerValidationResult['invalid'] = [];

  for (const row of rows) {
    const result = CustomerSchema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ raw: row, errors: result.error });
    }
  }

  return { valid, invalid };
}
