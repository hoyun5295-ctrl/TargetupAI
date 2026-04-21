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
  // ★ D131 후속(2026-04-21): 한국 고객 DB에는 한글 로컬파트 이메일("김민수@kakao.com")이 흔함.
  //   Zod .email()은 RFC 5322 엄격 regex로 한글 거부 → 전체 레코드 탈락 발생.
  //   실고객사 데이터를 받아들이는 원칙상 형식 검증 제거 + 빈 문자열만 null 처리.
  //   잘못된 이메일은 서버 쪽 표시 시점에서만 처리 (예: 메일 발송 API 미지원 표시).
  email: z.preprocess((v) => (v === '' ? null : v), z.string().nullish()),

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
