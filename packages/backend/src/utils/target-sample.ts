/**
 * target-sample.ts — 타겟 첫 고객 조회 컨트롤타워 (CT-A, B5/B6 통합)
 *
 * 자동발송/캠페인 미리보기/스팸테스트에서 "타겟 필터에 매칭되는 첫 고객 1명"을
 * 가져오는 인라인 SELECT가 4곳 이상 산재해 있어서 일관성을 잃고 있었음.
 *
 * 이 컨트롤타워가 단일 진입점이 되어, 다음 5가지를 모두 보장한다:
 *   1) CT-01 buildFilterQueryCompat 로 타겟 필터 적용 (birth_month/숫자/날짜 등 동적)
 *   2) is_active = true AND sms_opt_in = true 기본 필터
 *   3) ★ store_code 격리 (자동발송 ac.store_code 또는 캠페인 store_code)
 *   4) ★ CT-03 buildUnsubscribeFilter 로 사용자별 수신거부 제외
 *   5) custom_fields JSONB flat 처리 — replaceMessageVars/replaceVariables 양쪽 호환
 *
 * 사용처:
 *   - utils/auto-campaign-worker.ts (runMessageGeneration, executePreSendSpamTest)
 *   - routes/auto-campaigns.ts (POST /preview-sample — 자동발송 모달 스팸필터 직전)
 *   - routes/ai.ts (recommend-target sample_customer_raw 생성)
 *
 * ⚠️ 절대 금지:
 *   - "SELECT * FROM customers ... ORDER BY updated_at DESC LIMIT 1" 인라인 작성 금지
 *   - 반드시 이 함수를 통할 것 (D88/D91/B5 재발 방지)
 */

import { query } from '../config/database';
import { buildFilterQueryCompat } from './customer-filter';
import { buildUnsubscribeFilter } from './unsubscribe-helper';
import { FIELD_DISPLAY_MAP, reverseDisplayValue } from './standard-field-map';

export interface TargetSampleOptions {
  /** 회사 ID — 필수 */
  companyId: string;
  /** 타겟 필터 (mixed 형식, AI/캠페인용) — 비어있으면 전체 타겟에서 추출 */
  targetFilter?: any;
  /** 발송 주체 사용자 ID — 수신거부 필터 적용 (없으면 수신거부 필터 스킵) */
  userId?: string | null;
  /** 매장 코드 — 자동발송 ac.store_code (브랜드 격리) */
  storeCode?: string | null;
}

export interface TargetSampleResult {
  /** column 키 raw + custom_fields flat (replaceVariables 호환) */
  raw: Record<string, any> | null;
  /** 매칭 여부 — false면 raw=null */
  matched: boolean;
}

/**
 * 타겟 필터에 매칭되는 첫 고객 1명을 조회한다.
 *
 * 정렬: ORDER BY updated_at DESC NULLS LAST LIMIT 1
 *   - 가장 최근 활동 고객 우선 (대표성 + 데이터 신선도)
 *
 * 반환:
 *   - matched=true 시 raw 객체 (column + custom_fields flat)
 *   - 매칭 0건이면 matched=false, raw=null
 */
export async function fetchTargetSampleCustomer(
  options: TargetSampleOptions
): Promise<TargetSampleResult> {
  const { companyId, targetFilter, userId, storeCode } = options;

  // 1) 타겟 필터 SQL (CT-01 컨트롤타워)
  const filterResult = buildFilterQueryCompat(targetFilter || {}, companyId);

  // 2) store_code 필터 (브랜드 격리) — 동적 파라미터 인덱스
  let paramIdx = filterResult.nextIndex;
  const extraParams: any[] = [];
  let storeFilter = '';
  if (storeCode) {
    storeFilter = ` AND c.store_code = $${paramIdx++}`;
    extraParams.push(storeCode);
  }

  // 3) 수신거부 필터 (CT-03) — userId 있을 때만
  let unsubFilter = '';
  if (userId) {
    unsubFilter = buildUnsubscribeFilter(`$${paramIdx++}`, 'c.phone');
    extraParams.push(userId);
  }

  // 4) 최종 SELECT
  const sql = `
    SELECT * FROM customers c
    WHERE c.company_id = $1
      AND c.is_active = true
      AND c.sms_opt_in = true
      ${filterResult.where}
      ${storeFilter}
      ${unsubFilter}
    ORDER BY c.updated_at DESC NULLS LAST
    LIMIT 1
  `;

  try {
    const result = await query(sql, [companyId, ...filterResult.params, ...extraParams]);
    if (result.rows.length === 0) {
      return { raw: null, matched: false };
    }
    const row = result.rows[0];
    // custom_fields JSONB를 평탄화하여 합침 (replaceVariables/replaceMessageVars 호환)
    const flat = { ...row, ...(row.custom_fields || {}) };
    // ★ B+0407-1: enum 필드(gender F→여성) 미리 변환
    //   frontend의 모든 표시 컨트롤타워가 이미 변환된 값을 받음 → 일관 표시 보장
    for (const fk of Object.keys(FIELD_DISPLAY_MAP)) {
      if (flat[fk] != null) {
        flat[fk] = reverseDisplayValue(fk, flat[fk]);
      }
    }
    return { raw: flat, matched: true };
  } catch (err: any) {
    console.error('[target-sample] 타겟 첫 고객 조회 실패:', err.message);
    return { raw: null, matched: false };
  }
}
