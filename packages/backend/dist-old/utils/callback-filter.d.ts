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
export declare function filterByIndividualCallback(customers: any[], companyId: string, userId?: string, callbackColumn?: string): Promise<CallbackFilterResult>;
/**
 * 개별회신번호 제외 사유 에러 응답 생성 — 모든 발송 경로 공통
 *
 * @param callbackMissingCount - callback 미보유 제외 건수
 * @param callbackUnregisteredCount - 미등록 회신번호 제외 건수
 * @returns 에러 응답 객체 (res.json()으로 전달)
 */
export declare function buildCallbackErrorResponse(callbackMissingCount: number, callbackUnregisteredCount: number): {
    error: string;
    callbackMissingCount: number;
    callbackUnregisteredCount: number;
    isCallbackIssue: boolean;
};
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
export declare function resolveCustomerCallback(customer: Record<string, any>, useIndividualCallback: boolean, defaultCallback: string): string;
/**
 * ★ D103: 전화번호 형태 값 판별
 * 숫자+하이픈만으로 구성된 7자리 이상 문자열이 한국 전화번호 패턴에 맞는지 판별.
 * 개별회신번호 드롭다운에서 전화번호 필드만 동적으로 표시하기 위한 컨트롤타워.
 */
export declare function isPhoneLikeValue(value: any): boolean;
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
export declare function detectPhoneFields(samples: Record<string, any>[], fields: {
    field_key: string;
    display_name: string;
    data_type?: string;
}[], excludeKeys?: string[]): {
    field_key: string;
    display_name: string;
}[];
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
export declare function buildCallbackConfirmResponse(cbResult: CallbackFilterResult, remainingCount: number): {
    callbackConfirmRequired: boolean;
    callbackMissingCount: number;
    callbackUnregisteredCount: number;
    unregisteredDetails: UnregisteredCallbackDetail[];
    remainingCount: number;
    message: string;
};
//# sourceMappingURL=callback-filter.d.ts.map