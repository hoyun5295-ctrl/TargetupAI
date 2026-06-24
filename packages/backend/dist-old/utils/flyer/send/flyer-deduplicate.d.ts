/**
 * ★ CT-F07 — 전단AI 수신자 중복제거 컨트롤타워
 *
 * 한줄로 utils/deduplicate.ts의 normalizePhone 기반 중복제거 패턴을
 * 전단AI 발송 경로 전용으로 재사용.
 */
export interface FlyerRecipient {
    phone: string;
    [key: string]: any;
}
/**
 * phone 기준 중복제거. 정규화(normalizePhone) 후 Set으로 dedupe.
 * 앞쪽 레코드 유지, 뒤쪽 중복 제거.
 */
export declare function deduplicateFlyerRecipients<T extends FlyerRecipient>(recipients: T[]): T[];
/**
 * 중복제거 결과 통계.
 */
export declare function deduplicateWithStats<T extends FlyerRecipient>(recipients: T[]): {
    deduplicated: T[];
    originalCount: number;
    removedCount: number;
};
//# sourceMappingURL=flyer-deduplicate.d.ts.map