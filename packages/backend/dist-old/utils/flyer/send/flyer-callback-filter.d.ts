/**
 * ★ CT-F06 — 전단AI 회신번호 해석/필터 컨트롤타워
 *
 * 한줄로 utils/callback-filter.ts와 완전 분리.
 * - 회사의 기본 회신번호 조회 (flyer_callback_numbers.is_default=true)
 * - 발송 시 callback 결정: 사용자 지정 → 기본 → 에러
 * - 개별 회신번호 기능은 Phase B 이후 (지금은 단일 기본값 사용)
 */
export interface CallbackResolveResult {
    callback: string | null;
    source: 'requested' | 'default' | 'none';
    error?: string;
}
/**
 * 회사의 모든 회신번호 조회.
 */
export declare function getFlyerCallbackNumbers(companyId: string): Promise<Array<{
    id: string;
    phone: string;
    label: string | null;
    is_default: boolean;
}>>;
/**
 * 발송에 사용할 회신번호 결정.
 * requested가 있으면 해당 번호가 등록되어 있는지 검증.
 * 없으면 is_default=true 번호 사용.
 */
export declare function resolveFlyerCallback(companyId: string, requested?: string | null): Promise<CallbackResolveResult>;
//# sourceMappingURL=flyer-callback-filter.d.ts.map