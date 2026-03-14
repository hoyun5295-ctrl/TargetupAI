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
}

/**
 * 개별회신번호 필터링 — 모든 발송 경로의 유일한 진입점
 *
 * 1단계: callback이 없으면 store_phone으로 폴백
 * 2단계: callback이 여전히 없는 고객 제외
 * 3단계: callback이 미등록 발신번호인 고객 제외
 *
 * @param customers - 필터링 대상 고객/수신자 배열 (callback, store_phone 필드 필요)
 * @param companyId - 회사 ID (등록 발신번호 조회용)
 * @returns CallbackFilterResult
 */
export async function filterByIndividualCallback(
  customers: any[],
  companyId: string
): Promise<CallbackFilterResult> {
  let filtered = [...customers];
  let callbackMissingCount = 0;
  let callbackUnregisteredCount = 0;

  // 1단계: store_phone → callback 폴백
  for (const c of filtered) {
    if ((!c.callback || !c.callback.trim()) && c.store_phone && c.store_phone.trim()) {
      c.callback = c.store_phone;
    }
  }

  // 2단계: callback 미보유 고객 제외
  const beforeMissing = filtered.length;
  filtered = filtered.filter((c: any) => c.callback && c.callback.trim());
  callbackMissingCount = beforeMissing - filtered.length;
  if (callbackMissingCount > 0) {
    console.log(`[개별회신번호] callback+store_phone 없는 고객 ${callbackMissingCount}명 제외 (${filtered.length}명 남음)`);
  }

  // 3단계: 미등록 회신번호 고객 제외
  const callbackPhones = [...new Set(filtered.map((c: any) => normalizePhone(c.callback || '')).filter(Boolean))];
  if (callbackPhones.length > 0) {
    const registeredResult = await query(
      `SELECT REPLACE(phone_number, '-', '') as phone FROM sender_numbers WHERE company_id = $1 AND is_active = true
       UNION SELECT REPLACE(phone, '-', '') as phone FROM callback_numbers WHERE company_id = $1`,
      [companyId]
    );
    const registeredSet = new Set((registeredResult.rows as any[]).map((r: any) => r.phone));
    const beforeUnreg = filtered.length;
    filtered = filtered.filter((c: any) => registeredSet.has(normalizePhone(c.callback || '')));
    callbackUnregisteredCount = beforeUnreg - filtered.length;
    if (callbackUnregisteredCount > 0) {
      console.log(`[개별회신번호] 미등록 회신번호 고객 ${callbackUnregisteredCount}명 제외 (${filtered.length}명 남음)`);
    }
  }

  return {
    filtered,
    callbackMissingCount,
    callbackUnregisteredCount,
    callbackSkippedCount: callbackMissingCount + callbackUnregisteredCount,
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
