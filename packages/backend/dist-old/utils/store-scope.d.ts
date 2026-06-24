export type StoreScopeResult = {
    type: 'no_filter';
} | {
    type: 'filtered';
    storeCodes: string[];
} | {
    type: 'blocked';
};
/**
 * company_user의 store 격리 범위를 결정
 * company_admin/super_admin은 이 함수를 호출하지 않음 (전체 조회 가능)
 */
export declare function getStoreScope(companyId: string, userId: string): Promise<StoreScopeResult>;
//# sourceMappingURL=store-scope.d.ts.map