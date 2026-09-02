/**
 * 싱크 컬럼 매핑 계약 (SoT) — 소스 컬럼을 어떤 표준 필드로 보낼 수 있는가.
 *
 * ★ 2026-09-02 신설. 경위: 아난티 구매 매핑이 **고객 필드로 채워져 있었다**
 *   (`CHEK_TRAN_TEL -> phone`, `CHEK_TRAN_ADAT -> recent_purchase_date`).
 *   에이전트는 구매 행에서 `customer_phone`·`purchase_date`를 찾는데 둘 다 없으니
 *   `NORMALIZE_FAILED`로 **98,600건을 통째로 버렸다**(성공 0). 서버까지 오지도 못했다.
 *   그때까지 `update_config`는 "mapping 객체가 있는가"만 봤고 값이 그 대상의 필드인지,
 *   필수 필드가 있는지는 한 번도 보지 않았다. 잘못된 매핑이 그대로 저장돼 전량 드롭이 됐다.
 *
 * ⛔ 이 표는 **에이전트가 실제로 읽는 키**와 같은 벌이어야 한다.
 *   고객 = `normalizeCustomerBatch`가 `result.phone` 없으면 드롭
 *   구매 = `normalizePurchaseBatch`가 `result.customer_phone` / `result.purchase_date` 없으면 드롭
 *   (sync-agent/src/normalize/index.ts). 여기를 넓히기 전에 그쪽이 그 키를 읽는지 먼저 확인한다.
 *
 * ⛔ 프론트 `AdminDashboard.tsx`의 `SYNC_CUSTOMER_TARGET_FIELDS` / `SYNC_PURCHASE_TARGET_FIELDS`와
 *   같은 벌이다. 한쪽만 고치면 화면에서 고를 수 있는데 저장이 거절되는(또는 그 반대) 어긋남이 된다.
 *   `__tests__/sync-mapping-fields.test.ts`가 두 파일을 대조해 어긋나면 실패한다.
 */

/** custom_1 ~ custom_15 — 고객·구매 양쪽 공통 슬롯 */
export const SYNC_CUSTOM_SLOTS: string[] = Array.from({ length: 15 }, (_, i) => `custom_${i + 1}`);

/** 고객 동기화에서 소스 컬럼이 갈 수 있는 표준 필드 */
export const SYNC_CUSTOMER_TARGET_FIELDS: string[] = [
  'phone', 'name', 'gender', 'birth_date', 'email', 'address', 'region', 'grade',
  'store_phone', 'points', 'store_code', 'store_name', 'registered_store',
  'registered_store_number', 'registration_type', 'callback', 'sms_opt_in',
  'recent_purchase_date', 'recent_purchase_amount', 'recent_purchase_store',
  'total_purchase_amount', 'purchase_count', ...SYNC_CUSTOM_SLOTS,
];

/**
 * 구매 필드 설명표 — 목록과 뜻을 한자리에 둔다.
 * ★ AI 매핑 프롬프트(`ai-mapping.ts`)가 이 표로 "구매 테이블에는 이 필드들이 있다"를 알려 준다.
 *   종전에는 대상과 무관하게 **고객 필드 목록만** 줬고, 그래서 AI가 구매 테이블에도
 *   `phone`·`recent_purchase_date`를 골랐다(아난티 매핑이 정확히 그 결과 · BUGS B-0902-4).
 *   AI가 고를 수 없는 필드는 매핑에 나타날 수 없다 — 목록이 곧 게이트다.
 */
export const SYNC_PURCHASE_FIELD_GUIDE: Array<{ key: string; label: string; hint?: string }> = [
  { key: 'customer_phone', label: '고객 전화번호', hint: '필수. 이 값이 없으면 그 구매 행은 통째로 버려진다' },
  { key: 'purchase_date', label: '구매일시', hint: '필수. 날짜 또는 날짜시각' },
  { key: 'total_amount', label: '결제 금액', hint: '그 건의 총액' },
  { key: 'quantity', label: '수량' },
  { key: 'store_code', label: '매장 코드' },
  { key: 'store_name', label: '매장명' },
  { key: 'product_code', label: '상품 코드' },
  { key: 'product_name', label: '상품명' },
  { key: 'unit_price', label: '단가' },
];

/** 구매 동기화에서 소스 컬럼이 갈 수 있는 표준 필드 */
export const SYNC_PURCHASE_TARGET_FIELDS: string[] = [
  ...SYNC_PURCHASE_FIELD_GUIDE.map((f) => f.key), ...SYNC_CUSTOM_SLOTS,
];

/**
 * 대상별 필수 필드 — 이게 매핑에 없으면 에이전트가 **그 대상 전량을 드롭**한다.
 * 하나라도 빠진 매핑은 "동기화가 되는데 0건"이라는 가장 나쁜 형태로 끝난다.
 */
export const SYNC_REQUIRED_TARGET_FIELDS: Record<'customers' | 'purchases', string[]> = {
  customers: ['phone'],
  purchases: ['customer_phone', 'purchase_date'],
};

export interface SyncMappingIssue {
  target: 'customers' | 'purchases';
  /** 'unknown_field' = 그 대상의 필드가 아님 · 'missing_required' = 필수 필드가 매핑에 없음 */
  kind: 'unknown_field' | 'missing_required';
  message: string;
}

const ALLOWED: Record<'customers' | 'purchases', string[]> = {
  customers: SYNC_CUSTOMER_TARGET_FIELDS,
  purchases: SYNC_PURCHASE_TARGET_FIELDS,
};

/**
 * 매핑 한 대상(customers 또는 purchases)을 검사한다.
 *
 * @param target   검사할 대상
 * @param mapping  { 소스컬럼: 표준필드 } — 에이전트가 저장하는 그 형태
 * @param opts.requireAll  true면 필수 필드 누락도 문제로 잡는다(전체 교체 저장 시).
 *   부분 갱신이면 false로 두어 "이번에 보낸 것만" 검사한다.
 */
export function validateSyncMappingTarget(
  target: 'customers' | 'purchases',
  mapping: Record<string, unknown>,
  opts: { requireAll: boolean },
): SyncMappingIssue[] {
  const issues: SyncMappingIssue[] = [];
  const allowed = new Set(ALLOWED[target]);
  const usedTargets = new Set<string>();

  for (const [sourceColumn, targetField] of Object.entries(mapping || {})) {
    if (targetField === null || targetField === undefined || targetField === '') continue;
    const field = String(targetField);
    usedTargets.add(field);
    if (!allowed.has(field)) {
      // 다른 대상의 필드를 잘못 고른 경우를 콕 집어 알려 준다(아난티가 정확히 이 형태였다).
      const otherTarget = target === 'purchases' ? 'customers' : 'purchases';
      const belongsToOther = new Set(ALLOWED[otherTarget]).has(field);
      issues.push({
        target,
        kind: 'unknown_field',
        message: belongsToOther
          ? `${sourceColumn} -> ${field}: '${field}'는 ${otherTarget} 필드입니다. ${target}에는 쓸 수 없습니다.`
          : `${sourceColumn} -> ${field}: ${target}에 없는 필드입니다.`,
      });
    }
  }

  if (opts.requireAll) {
    for (const required of SYNC_REQUIRED_TARGET_FIELDS[target]) {
      if (!usedTargets.has(required)) {
        issues.push({
          target,
          kind: 'missing_required',
          message: `필수 필드 '${required}'가 매핑에 없습니다. 이대로 저장하면 ${target} 동기화가 전량 실패합니다.`,
        });
      }
    }
  }

  return issues;
}

/** 매핑 payload 전체(customers·purchases)를 검사한다. customFieldLabels는 필드 매핑이 아니라 제외. */
export function validateSyncMapping(
  mapping: { customers?: Record<string, unknown>; purchases?: Record<string, unknown> },
  opts: { requireAll: boolean },
): SyncMappingIssue[] {
  const issues: SyncMappingIssue[] = [];
  if (mapping?.customers) issues.push(...validateSyncMappingTarget('customers', mapping.customers, opts));
  if (mapping?.purchases) issues.push(...validateSyncMappingTarget('purchases', mapping.purchases, opts));
  return issues;
}
