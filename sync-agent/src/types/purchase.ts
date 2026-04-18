/**
 * 구매내역 데이터 타입 정의
 */

import { z } from 'zod';

// ─── Zod 스키마 ─────────────────────────────────────────

export const PurchaseSchema = z.object({
  // 필수
  customer_phone: z.string().min(1, '고객 전화번호는 필수입니다'),
  purchase_date: z.string().min(1, '구매일시는 필수입니다'),
  total_amount: z.number({ required_error: '총금액은 필수입니다' }),

  // 매장
  store_code: z.string().nullish(),
  store_name: z.string().nullish(),

  // 상품
  product_code: z.string().nullish(),
  product_name: z.string().nullish(),
  quantity: z.number().int().nullish(),
  unit_price: z.number().nullish(),

  // 확장
  custom_fields: z.record(z.unknown()).nullish(),
});

export type Purchase = z.infer<typeof PurchaseSchema>;

// ─── 검증 헬퍼 ─────────────────────────────────────────

export interface PurchaseValidationResult {
  valid: Purchase[];
  invalid: Array<{
    raw: Record<string, unknown>;
    errors: z.ZodError;
  }>;
}

export function validatePurchases(rows: Record<string, unknown>[]): PurchaseValidationResult {
  const valid: Purchase[] = [];
  const invalid: PurchaseValidationResult['invalid'] = [];

  for (const row of rows) {
    const result = PurchaseSchema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ raw: row, errors: result.error });
    }
  }

  return { valid, invalid };
}
