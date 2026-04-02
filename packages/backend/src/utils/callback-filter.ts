/**
 * CT-08: callback-filter.ts — 개별회신번호 필터링 컨트롤타워
 *
 * 역할: 개별회신번호(callback) 사용 시 고객/수신자 필터링의 유일한 진입점
 * - store_phone → callback 폴백
 * - callback 미보유 고객 제외
 * - 미등록 회신번호 고객 제외
 * - 제외 사유 에러 응답 생성
 *
 * 적용 파일: campaigns.ts (AI send, direct-send, 자동발송 등 모든 발송 경로)
 *
 * ★ D75 교훈: 동일 로직이 campaigns.ts 2곳에 인라인 중복 → 컨트롤타워로 통합
 */

import { query } from '../config/database';
import { normalizePhone } from './normalize-phone';

/** 미등록 회신번호별 제외 상세 */
export interface UnregisteredCallbackDetail {
  /** 미등록 회신번호 (정규화된 번호) */
  phone: string;
  /** 해당 회신번호로 인해 제외된 고객 수 */
  excludedCount: number;
}

/** 개별회신번호 필터링 결과 */
export interface CallbackFilterResult {
  /** 필터링 후 남은 고객/수신자 배열 */
  filtered: any[];
  /** callback + store_phone 둘 다 없어서 제외된 건수 */
  callbackMissingCount: number;
  /** 미등록 회신번호로 제외된 건수 */
  callbackUnregisteredCount: number;
  /** 총 제외 건수 */
  callbackSkippedCount: number;
  /** 미등록 회신번호별 제외 상세 (확인 모달용) */
  unregisteredDetails: UnregisteredCallbackDetail[];
}

/**
 * 개별회신번호 필터링 — 모든 발송 경로의 유일한 진입점
 *
 * 1단계: 지정된 컬럼(callbackColumn)에서 회신번호 추출 → callback에 복사
 *        callbackColumn 미지정 시 기존 동작: callback → store_phone 폴백
 * 2단계: callback이 여전히 없는 고객 제외
 * 3단계: callback이 미등록 발신번호인 고객 제외
 * 3단계 추가(D91): assignment_scope='assigned'인 번호는 배정된 사용자만 사용 가능
 *
 * @param customers - 필터링 대상 고객/수신자 배열
 * @param companyId - 회사 ID (등록 발신번호 조회용)
 * @param userId - 발송자 user_id (assignment_scope 필터링용, 선택)
 * @param callbackColumn - 회신번호로 사용할 컬럼명 (선택, 미지정 시 callback→store_phone 폴백)
 * @returns CallbackFilterResult
 */
export async function filterByIndividualCallback(
  customers: any[],
  companyId: string,
  userId?: string,
  callbackColumn?: string
): Promise<CallbackFilterResult> {
  let filtered = [...customers];
  let callbackMissingCount = 0;
  let callbackUnregisteredCount = 0;

  // 1단계: 회신번호 컬럼 결정
  if (callbackColumn) {
    // ★ D99: 지정된 컬럼의 값을 callback으로 복사
    // custom_fields JSONB 내부 키(custom_1~15)도 지원
    // ★ D100: 지정 컬럼 값이 비어있으면 store_phone → callback 폴백 추가
    for (const c of filtered) {
      let val = c[callbackColumn];
      // custom_fields JSONB 내부 키 처리
      if (!val && c.custom_fields && callbackColumn.startsWith('custom_')) {
        val = c.custom_fields[callbackColumn];
      }
      c.callback = val ? String(val).trim() : '';
      // 지정 컬럼 비어있으면 store_phone 폴백
      if (!c.callback && c.store_phone && c.store_phone.trim()) {
        c.callback = c.store_phone;
      }
    }
  } else {
    // 기존 동작: store_phone → callback 폴백
    for (const c of filtered) {
      if ((!c.callback || !c.callback.trim()) && c.store_phone && c.store_phone.trim()) {
        c.callback = c.store_phone;
      }
    }
  }

  // 2단계: callback 미보유 고객 제외
  const beforeMissing = filtered.length;
  filtered = filtered.filter((c: any) => c.callback && c.callback.trim());
  callbackMissingCount = beforeMissing - filtered.length;
  if (callbackMissingCount > 0) {
    console.log(`[개별회신번호] callback+store_phone 없는 고객 ${callbackMissingCount}명 제외 (${filtered.length}명 남음)`);
  }

  // 3단계: 미등록 회신번호 고객 제외 + 번호별 상세 수집
  // D91: assignment_scope='assigned'인 번호는 해당 사용자에게 배정된 경우만 허용
  const unregisteredDetails: UnregisteredCallbackDetail[] = [];
  const callbackPhones = [...new Set(filtered.map((c: any) => normalizePhone(c.callback || '')).filter(Boolean))];
  if (callbackPhones.length > 0) {
    // 등록된 발신번호 조회 (sender_numbers + callback_numbers)
    // D91: userId가 있으면 assignment_scope 필터 적용 — 'all' 또는 본인 배정된 'assigned'만 허용
    let registeredSql = `
      SELECT REPLACE(phone_number, '-', '') as phone FROM sender_numbers WHERE company_id = $1 AND is_active = true
      UNION SELECT REPLACE(cn.phone, '-', '') as phone FROM callback_numbers cn WHERE cn.company_id = $1
    `;
    const registeredParams: any[] = [companyId];

    if (userId) {
      // assignment_scope 컬럼 존재 시에만 필터 적용 (하위호환)
      try {
        await query(`SELECT assignment_scope FROM callback_numbers LIMIT 0`);
        registeredSql = `
          SELECT REPLACE(phone_number, '-', '') as phone FROM sender_numbers WHERE company_id = $1 AND is_active = true
          UNION SELECT REPLACE(cn.phone, '-', '') as phone FROM callback_numbers cn
          WHERE cn.company_id = $1
            AND (
              cn.assignment_scope = 'all'
              OR cn.assignment_scope IS NULL
              OR EXISTS (
                SELECT 1 FROM callback_number_assignments cna
                WHERE cna.callback_number_id = cn.id AND cna.user_id = $2
              )
            )
        `;
        registeredParams.push(userId);
      } catch {
        // assignment_scope 컬럼 미존재 — 기존 쿼리 유지
      }
    }

    const registeredResult = await query(registeredSql, registeredParams);
    const registeredSet = new Set((registeredResult.rows as any[]).map((r: any) => r.phone));

    // 미등록 회신번호별 제외 인원수 집계
    const unregCountMap = new Map<string, number>();
    const beforeUnreg = filtered.length;
    filtered = filtered.filter((c: any) => {
      const normalized = normalizePhone(c.callback || '');
      if (registeredSet.has(normalized)) return true;
      // 미등록 또는 미배정 — 번호별 카운트 집계
      unregCountMap.set(normalized, (unregCountMap.get(normalized) || 0) + 1);
      return false;
    });
    callbackUnregisteredCount = beforeUnreg - filtered.length;

    // 상세 배열 생성 (제외 인원 많은 순 정렬)
    for (const [phone, count] of unregCountMap.entries()) {
      unregisteredDetails.push({ phone, excludedCount: count });
    }
    unregisteredDetails.sort((a, b) => b.excludedCount - a.excludedCount);

    if (callbackUnregisteredCount > 0) {
      console.log(`[개별회신번호] 미등록 회신번호 고객 ${callbackUnregisteredCount}명 제외 (${filtered.length}명 남음)`,
        unregisteredDetails.map(d => `${d.phone}(${d.excludedCount}명)`).join(', '));
    }
  }

  return {
    filtered,
    callbackMissingCount,
    callbackUnregisteredCount,
    callbackSkippedCount: callbackMissingCount + callbackUnregisteredCount,
    unregisteredDetails,
  };
}

/**
 * 개별회신번호 제외 사유 에러 응답 생성 — 모든 발송 경로 공통
 *
 * @param callbackMissingCount - callback 미보유 제외 건수
 * @param callbackUnregisteredCount - 미등록 회신번호 제외 건수
 * @returns 에러 응답 객체 (res.json()으로 전달)
 */
export function buildCallbackErrorResponse(
  callbackMissingCount: number,
  callbackUnregisteredCount: number
): {
  error: string;
  callbackMissingCount: number;
  callbackUnregisteredCount: number;
  isCallbackIssue: boolean;
} {
  const reasons: string[] = [];
  if (callbackMissingCount > 0) reasons.push(`회신번호 미보유 ${callbackMissingCount}명`);
  if (callbackUnregisteredCount > 0) reasons.push(`미등록 회신번호 ${callbackUnregisteredCount}명`);
  const reasonText = reasons.length > 0 ? reasons.join(', ') + ' 제외' : '모두 제외됨';

  return {
    error: `발송 대상이 없습니다. (${reasonText})`,
    callbackMissingCount,
    callbackUnregisteredCount,
    isCallbackIssue: callbackMissingCount > 0 || callbackUnregisteredCount > 0,
  };
}

/**
 * ★ D103: 개별회신번호 resolve 컨트롤타워
 * 발송 루프에서 "이 고객/수신자의 회신번호"를 결정하는 유일한 진입점.
 * campaigns.ts AI발송(793), 직접발송(1524,1568), auto-campaign-worker(609)에서
 * 인라인으로 각각 다르게 처리하던 로직을 통합.
 *
 * CT-08 filterByIndividualCallback이 사전 필터링 + customer.callback 세팅 완료한 상태에서,
 * 발송 루프에서 최종 회신번호를 결정.
 *
 * @param customer - 고객/수신자 객체 (callback이 CT-08에서 세팅됨)
 * @param useIndividualCallback - 개별회신번호 사용 여부
 * @param defaultCallback - 기본 회신번호 (캠페인 설정 또는 대표번호)
 * @returns normalizePhone 적용된 최종 회신번호
 */
export function resolveCustomerCallback(
  customer: Record<string, any>,
  useIndividualCallback: boolean,
  defaultCallback: string
): string {
  if (useIndividualCallback && customer.callback) {
    return normalizePhone(customer.callback);
  }
  return normalizePhone(defaultCallback);
}

/**
 * ★ D103: 전화번호 형태 값 판별
 * 숫자+하이픈만으로 구성된 7자리 이상 문자열이 한국 전화번호 패턴에 맞는지 판별.
 * 개별회신번호 드롭다운에서 전화번호 필드만 동적으로 표시하기 위한 컨트롤타워.
 */
export function isPhoneLikeValue(value: any): boolean {
  if (value == null || value === '') return false;
  const str = String(value).trim();
  // 숫자+하이픈+공백+괄호+점만 허용
  const cleaned = str.replace(/[\s\-\(\)\.]/g, '');
  if (!/^\d+$/.test(cleaned)) return false;
  if (cleaned.length < 7 || cleaned.length > 15) return false;
  // 한국 전화번호 패턴: 01X(휴대폰), 02(서울), 03X-06X(지역), 050X(안심), 070(인터넷), 080(수신거부), 1XXX(대표)
  return /^(01[016789]|02|0[3-6]\d|050\d|070|080|1[0-9]{3})/.test(cleaned);
}

/**
 * ★ D103: 전화번호 형태 필드 자동 감지
 * 샘플 데이터에서 각 필드의 값을 검사하여 전화번호 형태인 필드만 반환.
 * enabled-fields API, 직접발송 파일 업로드 등에서 회신번호 드롭다운 필터링에 사용.
 *
 * @param samples - 샘플 데이터 배열 (최대 10건)
 * @param fields - 검사 대상 필드 목록 [{field_key, display_name}]
 * @param excludeKeys - 제외할 필드 키 (기본: ['phone'] — 수신자 번호이므로 회신번호 불가)
 * @returns 전화번호 형태 데이터가 있는 필드 목록
 */
export function detectPhoneFields(
  samples: Record<string, any>[],
  fields: { field_key: string; display_name: string }[],
  excludeKeys: string[] = ['phone', 'sms_opt_in']
): { field_key: string; display_name: string }[] {
  if (!samples.length || !fields.length) return [];

  return fields.filter(f => {
    if (excludeKeys.includes(f.field_key)) return false;

    // 값이 있는 샘플만 검사
    const values = samples
      .map(s => {
        // custom_fields JSONB 내부 키 지원
        let val = s[f.field_key];
        if (val == null && s.custom_fields && f.field_key.startsWith('custom_')) {
          val = s.custom_fields[f.field_key];
        }
        return val;
      })
      .filter(v => v != null && String(v).trim() !== '');

    if (values.length === 0) return false;

    // 50% 이상이 전화번호 형태면 전화번호 필드로 판정
    const phoneCount = values.filter(v => isPhoneLikeValue(v)).length;
    return phoneCount / values.length >= 0.5;
  });
}

/**
 * 미등록 회신번호 확인 요청 응답 생성 — 발송 전 사용자 확인용
 *
 * 제외 대상이 있지만 발송 가능한 수신자가 남아있을 때,
 * confirmCallbackExclusion 없이 호출하면 이 응답을 반환하여
 * 프론트에서 확인 모달을 띄운 후 재호출하도록 유도한다.
 *
 * @param cbResult - filterByIndividualCallback 결과
 * @param remainingCount - 필터링 후 남은 발송 대상 수
 * @returns 확인 요청 응답 객체
 */
export function buildCallbackConfirmResponse(
  cbResult: CallbackFilterResult,
  remainingCount: number
): {
  callbackConfirmRequired: boolean;
  callbackMissingCount: number;
  callbackUnregisteredCount: number;
  unregisteredDetails: UnregisteredCallbackDetail[];
  remainingCount: number;
  message: string;
} {
  const reasons: string[] = [];
  if (cbResult.callbackMissingCount > 0) reasons.push(`회신번호 미보유 ${cbResult.callbackMissingCount}명`);
  if (cbResult.callbackUnregisteredCount > 0) reasons.push(`미등록 회신번호 ${cbResult.callbackUnregisteredCount}명`);

  return {
    callbackConfirmRequired: true,
    callbackMissingCount: cbResult.callbackMissingCount,
    callbackUnregisteredCount: cbResult.callbackUnregisteredCount,
    unregisteredDetails: cbResult.unregisteredDetails,
    remainingCount,
    message: `${reasons.join(', ')} 제외 후 ${remainingCount}명에게 발송됩니다.`,
  };
}
