/**
 * Target-UP 데이터 정규화 유틸리티
 *
 * 다양한 고객사 DB의 값을 Target-UP 표준값으로 변환
 * 모든 정규화 로직을 한 곳에서 관리
 *
 * 사용처: customers.ts, ai.ts, upload.ts, sync agent 등
 */
export declare function normalizeGender(value: any): string | null;
/** 필터용: 표준값 → DB에 존재할 수 있는 모든 변형값 배열 */
export declare function getGenderVariants(standardValue: string): string[];
export declare function normalizeGrade(value: any): string | null;
/** 필터용: 표준값 → DB에 존재할 수 있는 모든 변형값 배열 */
export declare function getGradeVariants(standardValue: string): string[];
export declare function normalizeRegion(value: any): string | null;
/** 필터용: 표준값 → DB에 존재할 수 있는 모든 변형값 배열 */
export declare function getRegionVariants(standardValue: string): string[];
export declare function normalizeSmsOptIn(value: any): boolean | null;
export declare function normalizeMarried(value: any): boolean | null;
export declare function normalizePhone(value: any): string | null;
/**
 * 한국 전화번호 유효성 검증
 * - 010: 11자리 (010XXXXXXXX)
 * - 011/016/017/018/019: 10~11자리 (구번호 허용)
 * - 050x: 안심번호 (0502, 0503, 0504, 0505, 0506, 0507, 0508) → 11~12자리
 * - 01/050x 외 → false
 */
export declare function isValidKoreanPhone(phone: string): boolean;
/**
 * 한국 유선 전화번호 유효성 검증
 * - 02: 서울 (9~10자리: 02XXXXXXX 또는 02XXXXXXXX)
 * - 031~055: 지역번호 (10~11자리)
 * - 070: 인터넷전화 (11자리)
 * - 080: 수신자부담 (11자리)
 * - 1588/1544/1577 등: 대표번호 (8자리)
 */
export declare function isValidKoreanLandline(phone: string): boolean;
/**
 * 매장전화번호 정규화 (유선번호 + 휴대폰 모두 허용)
 * - 유선번호: 02, 031~055, 070, 080, 1588 등
 * - 휴대폰: 010, 011~019
 * - 하이픈 포함 형태로 반환
 */
export declare function normalizeStorePhone(value: any): string | null;
export declare function normalizeAge(value: any): number | null;
export declare function ageFromBirthYear(birthYear: number): number;
export declare function ageFromBirthDate(birthDate: string | Date): number | null;
export declare function normalizeAmount(value: any): number | null;
export declare function normalizeDate(value: any): string | null;
/**
 * ★ D95: 커스텀 필드 값 정규화 — upload.ts / sync.ts에서 호출
 * Date 객체 또는 JS Date.toString() 문자열이면 normalizeDate로 YYYY-MM-DD 변환.
 * 일반 문자열(건성, 매트 등)은 그대로 반환. YYMMDD 6자리 같은 모호한 값은 건드리지 않음.
 */
export declare function normalizeCustomFieldValue(val: any): string;
export interface NormalizedCustomer {
    phone: string | null;
    name: string | null;
    gender: string | null;
    birth_date: string | null;
    age: number | null;
    email: string | null;
    grade: string | null;
    region: string | null;
    points: number | null;
    total_purchase_amount: number | null;
    recent_purchase_date: string | null;
    sms_opt_in: boolean | null;
    is_married: boolean | null;
    [key: string]: any;
}
export declare function normalizeCustomerRecord(raw: Record<string, any>): NormalizedCustomer;
export declare const STANDARD_VALUES: {
    readonly gender: readonly ["M", "F"];
    readonly grade: readonly ["VVIP", "VIP", "GOLD", "SILVER", "BRONZE", "NORMAL"];
    readonly region: readonly ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
    readonly sms_opt_in: readonly [true, false];
    readonly is_married: readonly [true, false];
};
export declare function buildGenderFilter(value: string, paramIndex: number): {
    sql: string;
    params: any[];
    nextIndex: number;
};
export declare function buildRegionFilter(value: string, paramIndex: number): {
    sql: string;
    params: any[];
    nextIndex: number;
};
export declare function buildGradeFilter(value: string | string[], paramIndex: number): {
    sql: string;
    params: any[];
    nextIndex: number;
};
export declare function normalizeEmail(value: any): string | null;
export declare function normalizeByFieldKey(fieldKey: string, value: any): any;
//# sourceMappingURL=normalize.d.ts.map