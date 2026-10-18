/**
 * utils/sample-customer.ts — 상위(1위) 고객 행 → 표시명 · Liquid 필드 매핑 + 조회 열 목록
 * ★ 2026-10-18 routes/ai.ts 에서 원형 이동(AI 한줄로 intake 가 같은 매핑을 쓴다 · 인라인 두 벌 금지). 본문은 한 글자도 바꾸지 않았다.
 */
import { getColumnFields, renderFieldValue } from './standard-field-map';

// ★ 2026-06-29: sample-customer row → 표시명/Liquid 필드 매핑 (여정 trigger·AI Operator filters 두 경로 공용 — 인라인 중복 제거)
export function mapSampleCustomerRow(row: any): { sampleCustomer: Record<string, string | number | null>; sampleCustomerFields: Record<string, any> } {
  // ★ 2026-07-09: 하드코딩 라벨/컬럼 테이블 폐기 — FIELD_MAP 단일 소스 파생.
  //   sampleCustomer 키 = FIELD_MAP displayName(발송 사전 키와 동일) → 미리보기 매칭 = 실제 발송 매칭 100% 일치
  //   (옛 하드코딩은 '등급'·'등록매장'·'최근구매액' 등이 발송 사전 displayName과 어긋나 미리보기만 매칭·발송 빈칸이던 근본 원인).
  //   표시값 = renderFieldValue(발송 치환과 동일 포맷). Liquid 필드(sampleCustomerFields) = column 키 + 예측 점수 fallback.
  const sampleCustomer: Record<string, string | number | null> = {};
  const sampleCustomerFields: Record<string, any> = {};
  for (const f of getColumnFields()) {
    if (f.fieldKey === 'phone' || f.fieldKey === 'sms_opt_in') continue;
    const raw = row[f.columnName];
    const empty = raw === null || raw === undefined || raw === '';
    sampleCustomer[f.displayName] = empty ? null : renderFieldValue(raw, f.fieldKey);
    sampleCustomerFields[f.columnName] = empty ? null : (f.dataType === 'number' ? Number(raw) : raw);
  }
  // Predictive 점수 = 중립 0.5 fallback (Liquid customer.churn_risk 등 — 실제 발송 시 cdp_customer_predictions 정합)
  sampleCustomerFields.churn_risk = 0.5;
  sampleCustomerFields.purchase_likelihood = 0.5;
  sampleCustomerFields.click_score = 0.5;
  return { sampleCustomer, sampleCustomerFields };
}

// ★ 2026-07-09: 샘플 고객 SELECT 컬럼 = FIELD_MAP 컬럼 필드 단일 소스 (mapSampleCustomerRow와 동일 집합). phone/sms_opt_in 제외.
//   컬럼명은 FIELD_MAP 컨트롤타워 값(주입 불가) — filterVarCatalogByData가 이미 운영 쿼리하는 검증된 컬럼 집합.
export const SAMPLE_CUSTOMER_COLUMNS = getColumnFields()
  .filter((f) => f.fieldKey !== 'phone' && f.fieldKey !== 'sms_opt_in')
  .map((f) => f.columnName)
  .join(', ');
