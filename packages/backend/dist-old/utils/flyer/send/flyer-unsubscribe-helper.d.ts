/**
 * ★ CT-F02 — 전단AI 수신거부 컨트롤타워
 *
 * 한줄로 utils/unsubscribe-helper.ts와 완전 분리.
 * 데이터 저장: flyer_unsubscribes 테이블
 * 격리 키: flyer_users.id (user_id 기준)
 *
 * 필터 패턴:
 *   AND NOT EXISTS (
 *     SELECT 1 FROM flyer_unsubscribes fu
 *     WHERE fu.user_id = $발송자 AND fu.phone = c.phone
 *   )
 */
/**
 * 발송 WHERE 절에 삽입할 수신거부 제외 필터 생성.
 */
export declare function buildFlyerUnsubscribeFilter(userIdRef: string, phoneRef: string): string;
/**
 * 수신거부 단건 등록 (수동 등록 / 080 콜백 / 관리자 추가).
 */
export declare function registerFlyerUnsubscribe(userId: string, companyId: string, phone: string, source?: 'manual' | 'reply' | '080_ars' | 'admin'): Promise<void>;
/**
 * 수신거부 여부 조회 (단건).
 */
export declare function isFlyerUnsubscribed(userId: string, phone: string): Promise<boolean>;
/**
 * 수신거부 목록 조회 (사용자 기준).
 */
export declare function getFlyerUnsubscribes(userId: string, options?: {
    page?: number;
    pageSize?: number;
    search?: string;
}): Promise<{
    items: any[];
    total: number;
}>;
export declare function deleteFlyerUnsubscribes(userId: string, phones: string[]): Promise<number>;
/**
 * 발송 대상 phone 목록에서 수신거부 번호 제거.
 */
export declare function filterOutFlyerUnsubscribed(userId: string, phones: string[]): Promise<string[]>;
//# sourceMappingURL=flyer-unsubscribe-helper.d.ts.map