/**
 * ★ CT-F03 — 전단AI 과금/결제 컨트롤타워
 *
 * 한줄로 utils/prepaid.ts와 완전 분리.
 * - 전단AI는 매장당 월 15만원 + 문자 100% 선불 (후불 없음)
 * - 과금 주체: flyer_users (매장). flyer_companies(총판)는 상위 차단만.
 * - flyer_billing_history에 월별 청구 기록
 *
 * D113: 매장별 과금 체계로 전환. canFlyerStoreSend + deductFlyerPrepaid + refundFlyerPrepaid 신설.
 * 기존 canFlyerCompanySend는 총판 레벨 체크용으로 유지 (하위호환).
 */
export interface FlyerBillingSummary {
    company_id: string;
    month: string;
    sms_count: number;
    lms_count: number;
    mms_count: number;
    total_cost: number;
}
/**
 * 회사 월 발송량 집계 (flyer_campaigns 기준).
 * 기본 정액 15만원 + 초과분 (단가 x 발송수) 계산.
 */
export declare function aggregateFlyerMonthlyUsage(companyId: string, yearMonth: string): Promise<FlyerBillingSummary>;
/**
 * 월별 청구 기록 생성 (매월 1일 배치에서 호출).
 */
export declare function recordFlyerMonthlyBilling(companyId: string, yearMonth: string): Promise<void>;
/**
 * [하위호환] 총판(flyer_companies) 레벨 발송 가능 여부.
 * 총판 정지 시 하위 전체 매장 차단. canFlyerStoreSend에서 내부 호출됨.
 */
export declare function canFlyerCompanySend(companyId: string): Promise<{
    ok: boolean;
    reason?: string;
}>;
/**
 * ★ D113: 매장(flyer_users) 레벨 발송 가능 여부 확인.
 * 1. 매장 payment_status + plan_expires_at 체크
 * 2. 총판(flyer_companies) 레벨도 체크 (상위 차단)
 */
export declare function canFlyerStoreSend(userId: string): Promise<{
    ok: boolean;
    reason?: string;
}>;
/**
 * ★ D113: 선불 잔액 차감 (Atomic).
 * prepaid_balance >= totalAmount 조건부 UPDATE로 잔액 부족 시 실패 반환.
 */
export declare function deductFlyerPrepaid(userId: string, count: number, messageType: 'SMS' | 'LMS' | 'MMS'): Promise<{
    ok: boolean;
    deducted?: number;
    balance?: number;
    reason?: string;
}>;
/**
 * ★ D113: 선불 잔액 환불 (발송 취소 시).
 */
export declare function refundFlyerPrepaid(userId: string, amount: number): Promise<{
    ok: boolean;
    balance?: number;
}>;
//# sourceMappingURL=flyer-billing.d.ts.map